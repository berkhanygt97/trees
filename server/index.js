import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { CONFIG } from '../shared/config.js';
import { Room } from './room.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;

// Host knobs, applied before anything reads CONFIG. The effective values ride
// along in the welcome message so every client agrees with the server.
const envNum = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
CONFIG.ROUND_SECONDS = Math.round(envNum('ROUND_MINUTES', CONFIG.ROUND_SECONDS / 60) * 60);
CONFIG.INTERMISSION_SECONDS = Math.round(envNum('INTERMISSION_SECONDS', CONFIG.INTERMISSION_SECONDS));
CONFIG.STARTING_BANKROLL = Math.round(envNum('START_CASH', CONFIG.STARTING_BANKROLL));
CONFIG.LOAN_AMOUNT = Math.round(envNum('LOAN_AMOUNT', CONFIG.LOAN_AMOUNT));

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

const room = new Room();
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
      player = room.addPlayer(ws, msg.d && msg.d.name);
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

// Drop connections that stopped answering (laptop lid closed mid-round).
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);
wss.on('close', () => clearInterval(heartbeat));

setInterval(() => room.tick(), Math.round(1000 / CONFIG.TICK_HZ));

function lanAddresses() {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const e of entries || []) {
      if (e.family === 'IPv4' && !e.internal) out.push(e.address);
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  const hasThree = fs.existsSync(THREE_PATH);
  console.log('');
  console.log('  ♠ ♥  C A S I N O   R O Y A L E   —   L A N   ♦ ♣');
  console.log('  ' + '-'.repeat(48));
  console.log(`  On this machine : http://localhost:${PORT}`);
  for (const ip of lanAddresses()) {
    console.log(`  For your guests : http://${ip}:${PORT}`);
  }
  console.log('  ' + '-'.repeat(48));
  console.log(`  Round length    : ${(CONFIG.ROUND_SECONDS / 60).toFixed(1)} minutes  (ROUND_MINUTES=…)`);
  console.log(`  Starting stack  : $${CONFIG.STARTING_BANKROLL.toLocaleString('en-US')}  (START_CASH=…)`);
  if (!hasThree) console.log('  !! three.js not found — run `npm install` first.');
  console.log('');
});
