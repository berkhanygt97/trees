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
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
};

// Libraries ship inside node_modules; serving them from there keeps the game
// fully playable with no internet connection at the party.
const THREE_PATH = path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.js');
const VENDOR = {
  '/vendor/three.module.js': THREE_PATH,
};
// Whole folders: three.js add-ons (geometry utilities, skeletons) and the physics engine.
const VENDOR_DIRS = [
  ['/vendor/three/addons/', path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm')],
  ['/vendor/rapier/', path.join(ROOT, 'node_modules', '@dimforge', 'rapier3d-compat')],
];
export const VENDOR_FILES = new Set(Object.values(VENDOR));

function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  if (VENDOR[clean]) return VENDOR[clean];
  for (const [prefix, dir] of VENDOR_DIRS) {
    if (!clean.startsWith(prefix)) continue;
    const full = path.normalize(path.join(dir, clean.slice(prefix.length)));
    return full.startsWith(dir + path.sep) ? full : null;
  }

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
  if (['relaxed', 'normal', 'hardcore'].includes(settings.raidMode)) CONFIG.RAID_MODE = settings.raidMode;
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
      if (VENDOR_FILES.has(file) || file.includes(`${path.sep}node_modules${path.sep}`)) {
        res.writeHead(500, { 'content-type': 'text/plain' })
           .end(`${path.basename(file)} is missing — run \`npm install\` in the project folder first.`);
        return;
      }
      res.writeHead(404).end('not found');
    }
  });

  const store = new SaveStore(settings.saveDir || DEFAULT_SAVE_DIR);
  const room = new Room({ store, timeScale: CONFIG.TIME_SCALE });
  const wss = new WebSocketServer({ server, maxPayload: 64 * 1024, perMessageDeflate: false });

  wss.on('connection', (ws) => {
    // The profile object outlives this socket (a reconnect takes it over), so
    // remember which session *this* socket owns and only ever act for that.
    let player = null;
    let sessionId = null;
    ws.missed = 0;
    ws.on('pong', () => { ws.missed = 0; });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;

      if (!player) {
        if (msg.t !== 'join') return;
        const res = room.addPlayer(ws, msg.d && msg.d.name, msg.d && msg.d.key);
        if (res.denied) {
          ws.send(JSON.stringify({ t: 'denied', d: { reason: res.denied } }));
          ws.close();
          return;
        }
        player = res;
        sessionId = res.id;
        return;
      }
      if (player.ws !== ws) return;   // taken over by a newer connection
      try {
        room.handle(player, msg);
      } catch (err) {
        console.error('[handler]', msg.t, err.message);
      }
    });

    const drop = () => {
      if (sessionId) room.removePlayer(sessionId);
      player = null;
      sessionId = null;
    };
    ws.on('close', drop);
    ws.on('error', drop);
  });

  // Drop connections that stopped answering, but only after three missed
  // pings in a row (45 s): a laptop busy loading the valley must not be kicked.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.missed >= 3) { ws.terminate(); continue; }
      ws.missed++;
      try { ws.ping(); } catch { /* socket already closing */ }
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
          // Money in raiders' bags (or lying in the street) goes back in the tills.
          room.raids.returnAll();
          for (const id of [...room.players.keys()]) room.removePlayer(id);
          room.save();
          for (const ws of wss.clients) ws.terminate();
          wss.close(() => server.close(() => done()));
        }),
      });
    });
  });
}
