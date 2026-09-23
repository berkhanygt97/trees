// Electron main process: runs the game server inside the app so the host never
// has to open a terminal, shows them the link to hand around, and keeps the
// save files somewhere they can find them.
import { app, BrowserWindow, ipcMain, clipboard, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { startCasino } from '../server/app.js';
import { CONFIG } from '../shared/config.js';
import { DAY_MS, HOUR_MS } from '../shared/catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  port: 3000,
  startCash: 500,
  saveDir: '',          // empty = Documents/Harvest Royale/saves
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

const saveDir = () => settings.saveDir || path.join(app.getPath('documents'), 'Harvest Royale', 'saves');

// -------------------------------------------------------------------- server

/** Walk up a few ports rather than dying because something else holds 3000. */
async function boot() {
  const wanted = Number(settings.port) || DEFAULTS.port;
  lastError = null;
  for (let port = wanted; port < wanted + 10; port++) {
    try {
      casino = await startCasino({ ...settings, port, saveDir: saveDir() });
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
  if (!running) return { ...base, world: null, players: [], saves: { dir: saveDir(), files: [] } };

  const room = casino.room;
  const t = room.clock.time;
  const ev = room.round.event;
  return {
    ...base,
    world: {
      day: Math.floor(t / DAY_MS) + 1,
      hour: Math.floor((t % DAY_MS) / HOUR_MS),
      minute: Math.floor(((t % HOUR_MS) / HOUR_MS) * 60),
      weather: room.clock.weather,
      event: ev ? ev.name : null,
    },
    players: room.standings().map((p) => ({
      name: p.name, color: p.color, money: p.money, netWorth: p.netWorth, level: p.level, online: p.online,
    })),
    saves: {
      dir: casino.saveDir,
      files: room.store.list().length,
      lastSaveAt: room.store.lastSaveAt || 0,
    },
    rules: { startCash: CONFIG.STARTING_BANKROLL },
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
    title: 'Harvest Royale — Host',
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
    title: 'Harvest Royale',
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
ipcMain.handle('host:open-saves', () => {
  const dir = casino ? casino.saveDir : saveDir();
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});
ipcMain.handle('host:save-now', () => {
  if (casino) casino.save();
  return status();
});
ipcMain.handle('host:choose-saves', async () => {
  const res = await dialog.showOpenDialog(panelWindow, {
    title: 'Where should the save files live?',
    defaultPath: saveDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return status();
  return restart({ saveDir: res.filePaths[0] });
});

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

  // Always save on the way out, and warn before kicking out a valley full of people.
  let confirmedQuit = false;
  app.on('before-quit', (e) => {
    if (confirmedQuit || !casino) return;
    e.preventDefault();
    const n = casino.playerCount();
    if (n > 0) {
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        buttons: ['Keep hosting', 'Save and shut down'],
        defaultId: 0,
        cancelId: 0,
        title: 'Players are still in the valley',
        message: `${n} ${n === 1 ? 'person is' : 'people are'} still playing.`,
        detail: 'Everything is saved, but quitting disconnects everyone.',
      });
      if (choice !== 1) return;
    }
    confirmedQuit = true;
    shutdown().then(() => app.quit());
  });
}
