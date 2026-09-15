// Electron main process: runs the casino inside the app so the host never has
// to open a terminal, and shows them the link to hand around the room.
import { app, BrowserWindow, ipcMain, clipboard, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { startCasino } from '../server/app.js';
import { CONFIG } from '../shared/config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  port: 3000,
  roundMinutes: 10,
  intermissionSeconds: 25,
  startCash: 2000,
  loanAmount: 400,
};

let settings = { ...DEFAULTS };
let casino = null;
let panelWindow = null;
let gameWindow = null;
let lastError = null;

// ------------------------------------------------------------------ settings

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    settings = { ...DEFAULTS, ...raw };
  } catch {
    settings = { ...DEFAULTS };
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('could not save settings:', err.message);
  }
}

// -------------------------------------------------------------------- casino

/** Walk up a few ports rather than dying because something else holds 3000. */
async function boot() {
  const wanted = Number(settings.port) || DEFAULTS.port;
  lastError = null;
  for (let port = wanted; port < wanted + 10; port++) {
    try {
      casino = await startCasino({ ...settings, port });
      if (port !== wanted) {
        lastError = `Port ${wanted} was busy — using ${port} instead.`;
      }
      return casino;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') {
        lastError = err.message;
        return null;
      }
    }
  }
  lastError = `Ports ${wanted}–${wanted + 9} are all in use. Pick a different one below.`;
  return null;
}

async function shutdown() {
  if (!casino) return;
  const c = casino;
  casino = null;
  await c.close();
}

async function restart(next) {
  settings = { ...settings, ...next };
  saveSettings();
  if (gameWindow && !gameWindow.isDestroyed()) gameWindow.close();
  await shutdown();
  await boot();
  pushUpdate();
  return status();
}

// -------------------------------------------------------------------- status

function status() {
  const running = !!casino;
  const base = {
    running,
    platform: process.platform,
    settings,
    notice: lastError,
    localUrl: running ? casino.localUrl : null,
    lanUrls: running ? casino.lanUrls : [],
    port: running ? casino.port : settings.port,
  };
  if (!running) return { ...base, round: null, players: [] };

  const round = casino.room.round;
  return {
    ...base,
    round: {
      number: round.number,
      phase: round.phase,
      secondsLeft: Math.max(0, Math.round((round.endsAt - Date.now()) / 1000)),
      event: round.event ? round.event.name : null,
    },
    players: casino.room.standings().map((p) => ({
      name: p.name, color: p.color, money: p.money, profit: p.profit, loans: p.loans,
    })),
    rules: {
      roundMinutes: CONFIG.ROUND_SECONDS / 60,
      startCash: CONFIG.STARTING_BANKROLL,
      loanAmount: CONFIG.LOAN_AMOUNT,
    },
  };
}

function pushUpdate() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.webContents.send('host:update', status());
  }
}

// ------------------------------------------------------------------- windows

function createPanel() {
  panelWindow = new BrowserWindow({
    width: 620,
    height: 900,
    minWidth: 480,
    minHeight: 620,
    backgroundColor: '#0a0710',
    title: 'Casino Royale — Host',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  panelWindow.loadFile(path.join(HERE, 'panel.html'));
  panelWindow.on('closed', () => { panelWindow = null; });
}

function openGameWindow() {
  if (!casino) return false;
  if (gameWindow && !gameWindow.isDestroyed()) {
    gameWindow.focus();
    return true;
  }
  gameWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#07050c',
    title: 'Casino Royale',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  gameWindow.loadURL(`http://127.0.0.1:${casino.port}`);
  gameWindow.on('closed', () => { gameWindow = null; });
  return true;
}

// ----------------------------------------------------------------------- ipc

ipcMain.handle('host:status', () => status());
ipcMain.handle('host:restart', (_e, next) => restart(next || {}));
ipcMain.handle('host:open-game', () => openGameWindow());
ipcMain.handle('host:copy', (_e, text) => { clipboard.writeText(String(text)); return true; });
ipcMain.handle('host:open-external', (_e, url) => shell.openExternal(String(url)));

// ---------------------------------------------------------------- lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (panelWindow) {
      if (panelWindow.isMinimized()) panelWindow.restore();
      panelWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    loadSettings();
    await boot();
    createPanel();
    setInterval(pushUpdate, 1000);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createPanel();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Warn before pulling the floor out from under a room full of players.
  let confirmedQuit = false;
  app.on('before-quit', (e) => {
    if (confirmedQuit || !casino || casino.playerCount() === 0) return;
    e.preventDefault();
    const n = casino.playerCount();
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['Keep hosting', 'Shut down anyway'],
      defaultId: 0,
      cancelId: 0,
      title: 'Players are still in the casino',
      message: `${n} ${n === 1 ? 'person is' : 'people are'} still playing.`,
      detail: 'Quitting now disconnects everyone and ends the round.',
    });
    if (choice === 1) {
      confirmedQuit = true;
      shutdown().then(() => app.quit());
    }
  });
}
