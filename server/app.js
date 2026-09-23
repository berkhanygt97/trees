// The game server as a library, so it can be started by the CLI, by the
// desktop app, or by a test — anything that wants a room running.
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { CONFIG } from '../shared/config.js';
import { Room } from './room.js';
import { SaveStore } from './save.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

// three.js ships inside node_modules; serving it from there keeps the game
// fully playable with no internet connection at the party.
const THREE_PATH = path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.js');

function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  if (clean === '/vendor/three.module.js') return THREE_PATH;

  const base = clean.startsWith('/shared/') ? ROOT : path.join(ROOT, 'public');
  const rel = clean === '/' ? '/index.html' : clean;
  const full = path.normalize(path.join(base, rel));
  const allowed = clean.startsWith('/shared/') ? path.join(ROOT, 'shared') : path.join(ROOT, 'public');
  return full.startsWith(allowed) ? full : null;
}

/** Every IPv4 address a guest on the same network could reach this machine on. */
export function lanAddresses() {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const e of entries || []) {
      if (e.family === 'IPv4' && !e.internal) out.push(e.address);
    }
  }
  return out;
}

const positive = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Mutates the shared CONFIG so client and server agree on the same numbers. */
export function applySettings(settings = {}) {
  CONFIG.STARTING_BANKROLL = Math.round(positive(settings.startCash, CONFIG.STARTING_BANKROLL));
  CONFIG.TIME_SCALE = positive(settings.timeScale, 1);
  return CONFIG;
}

export const DEFAULT_SAVE_DIR = path.join(process.cwd(), 'saves');

/**
 * Boot a casino. Resolves once the port is actually bound, so callers can show
 * a link the moment it is real. Rejects with code EADDRINUSE if the port is taken.
 */
export function startCasino(settings = {}) {
  applySettings(settings);
  const port = Math.round(positive(settings.port, 3000));

  const server = http.createServer(async (req, res) => {
    const file = resolveFile(req.url || '/');
    if (!file) { res.writeHead(403).end('forbidden'); return; }
    try {
      const data = await fsp.readFile(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      res.end(data);
    } catch {
      if (file === THREE_PATH) {
        res.writeHead(500, { 'content-type': 'text/plain' })
           .end('three.js is missing — run `npm install` in the project folder first.');
        return;
      }
      res.writeHead(404).end('not found');
    }
  });

  const store = new SaveStore(settings.saveDir || DEFAULT_SAVE_DIR);
  const room = new Room({ store, timeScale: CONFIG.TIME_SCALE });
  const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

  wss.on('connection', (ws) => {
    let player = null;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;

      if (!player) {
        if (msg.t !== 'join') return;
        const res = room.addPlayer(ws, msg.d && msg.d.name);
        if (res.denied) {
          ws.send(JSON.stringify({ t: 'denied', d: { reason: res.denied } }));
          ws.close();
          return;
        }
        player = res;
        return;
      }
      try {
        room.handle(player, msg);
      } catch (err) {
        console.error('[handler]', msg.t, err.message);
      }
    });

    const drop = () => { if (player) { room.removePlayer(player.id); player = null; } };
    ws.on('close', drop);
    ws.on('error', drop);
  });

  // Drop connections that stopped answering (laptop lid closed mid-session).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15000);

  const ticker = setInterval(() => room.tick(), Math.round(1000 / CONFIG.TICK_HZ));

  return new Promise((resolve, reject) => {
    const onError = (err) => { cleanup(); reject(err); };
    const cleanup = () => {
      clearInterval(heartbeat);
      clearInterval(ticker);
      server.removeListener('error', onError);
    };

    server.once('error', onError);
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', onError);
      resolve({
        port,
        room,
        saveDir: store.dir,
        localUrl: `http://localhost:${port}`,
        lanUrls: lanAddresses().map((ip) => `http://${ip}:${port}`),
        playerCount: () => room.players.size,
        save: () => room.save(),
        close: () => new Promise((done) => {
          cleanup();
          // Hand back any stake still on a table, then write everything out.
          room.abortOpenBets();
          for (const id of [...room.players.keys()]) room.removePlayer(id);
          room.save();
          for (const ws of wss.clients) ws.terminate();
          wss.close(() => server.close(() => done()));
        }),
      });
    });
  });
}
