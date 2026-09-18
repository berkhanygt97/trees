import * as THREE from 'three';
import { CONFIG, STATIONS, money } from '/shared/config.js';
import { net } from './net.js';
import { sfx } from './sfx.js';
import { hud } from './hud.js';
import { World } from './world.js';
import { Controls } from './controls.js';
import { createAvatar, createViewModel } from './avatar.js';
import { Smoke } from './fx.js';
import { GAME_UIS } from './ui/index.js';

const canvas = document.getElementById('scene');
const joinScreen = document.getElementById('join');
const nameInput = document.getElementById('name');
const enterBtn = document.getElementById('enter');
const joinStatus = document.getElementById('join-status');

let renderer, scene, camera, world, controls, viewModel, smoke;
const tmpVec = new THREE.Vector3();
let me = null;
const avatars = new Map();       // playerId -> { avatar, target, shadow }
const gameStates = { roulette: null, crash: null, horses: null, robots: null };
let activePanel = null;          // { station, ui }
let nearest = null;
let roundState = null;
let boardRows = [];

// --------------------------------------------------------------- bootstrap

nameInput.value = localStorage.getItem('casino.name') || '';
nameInput.focus();
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') enterBtn.click(); });

enterBtn.addEventListener('click', async () => {
  enterBtn.disabled = true;
  joinStatus.textContent = 'Walking in…';
  const name = nameInput.value.trim();
  localStorage.setItem('casino.name', name);
  try {
    sfx.unlock();
    await net.connect(name);
  } catch (err) {
    joinStatus.textContent = err.message;
    enterBtn.disabled = false;
  }
});

// ------------------------------------------------------------------ scene

function initScene() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0714);
  scene.fog = new THREE.Fog(0x140b1c, 45, 120);

  camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.1, 400);

  world = new World(scene);
  smoke = new Smoke(scene);
  controls = new Controls(camera, canvas, world);
  controls.onStep = () => sfx.step();

  // Debug handle: useful when you are hosting and want to poke at the room.
  window.casino = {
    controls, world, scene, camera, net, hud, gameStates,
    get panel() { return activePanel; },
    get viewModel() { return viewModel; },
    smoke,
    get round() { return roundState; },
  };

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

// ------------------------------------------------------------- net handlers

net.on('welcome', (d) => {
  // The host may have overridden round length, bankroll or loan size.
  if (d.config) Object.assign(CONFIG, d.config);
  me = d.you;
  hud.meId = me.id;
  joinScreen.hidden = true;
  initScene();
  hud.init();
  hud.setRound(d.round);
  roundState = d.round;

  viewModel = createViewModel(me.color);
  camera.add(viewModel.group);
  scene.add(camera);

  for (const p of d.players) {
    if (p.id === me.id) continue;
    addAvatar(p);
    avatars.get(p.id).avatar.setCigar(p.cigar);
  }
  Object.assign(gameStates, d.games);

  controls.pos.set(Math.random() * 12 - 6, 0, 33);
  controls.lock();
  hud.toast('Click the floor to look around. WASD to walk.', 'info');
  requestAnimationFrame(loop);
});

net.on('players', (list) => {
  const seen = new Set();
  for (const p of list) {
    seen.add(p.id);
    if (p.id !== me.id && !avatars.has(p.id)) addAvatar(p);
    const a = avatars.get(p.id);
    if (a) a.avatar.setCigar(p.cigar);
    if (p.id === me.id && viewModel) viewModel.setCigar(p.cigar);
  }
  for (const [id, a] of avatars) {
    if (!seen.has(id)) { scene.remove(a.avatar.group); scene.remove(a.shadow); a.avatar.dispose(); avatars.delete(id); }
  }
});

net.on('snap', (rows) => {
  for (const [id, x, y, z, yaw] of rows) {
    if (id === me.id) continue;
    const a = avatars.get(id);
    if (!a) continue;
    a.prev.copy(a.target);
    a.target.set(x, y, z);
    a.targetYaw = yaw;
    a.lastUpdate = performance.now();
  }
});

net.on('wallet', (w) => hud.setWallet(w));

// Somebody took a draw — puff smoke from their cigar.
net.on('puff', (d) => {
  if (!smoke) return;
  if (d.playerId === me.id) {
    if (viewModel && viewModel.hasCigar()) smoke.puff(viewModel.tipWorld(tmpVec), 12);
    return;
  }
  const a = avatars.get(d.playerId);
  if (a && a.avatar.hasCigar()) smoke.puff(a.avatar.tipWorld(tmpVec), 10);
});

net.on('round', (r) => {
  const wasLive = roundState && roundState.phase === 'live';
  roundState = r;
  hud.setRound(r);
  if (r.phase === 'live' && !wasLive) hud.hideFinals();
  if (activePanel && activePanel.ui.onRound) activePanel.ui.onRound(r);
});

net.on('board', (rows) => {
  boardRows = rows;
  hud.setBoard(rows);
  world.paintBoard(rows, me.id);
});

net.on('finals', (rows) => {
  boardRows = rows;
  hud.setBoard(rows);
  world.paintBoard(rows, me.id);
  hud.showFinals(rows);
  closePanel();
  const mine = rows.findIndex((r) => r.id === me.id);
  if (mine === 0) sfx.fanfare(); else sfx.alarm();
});

net.on('game', (s) => {
  gameStates[s.game] = s;
  if (activePanel && activePanel.ui.onState) activePanel.ui.onState(s);
});

net.on('result', (res) => {
  if (activePanel && activePanel.ui.onResult) activePanel.ui.onResult(res);
  else if (res.game === 'roulette' || res.game === 'horses' || res.game === 'crash') {
    // You can wander off mid-spin; you still get told what happened.
    const net_ = res.net != null ? res.net : (res.payout || 0) - (res.staked || 0);
    hud.feed(`${res.game} ${net_ >= 0 ? '+' : ''}${money(net_)}`, net_ > 0 ? 'win' : 'loss');
  }
});

net.on('toast', (t) => {
  hud.toast(t.text, t.kind);
  if (t.kind === 'event') sfx.alarm();
});

net.on('__closed', () => {
  document.getElementById('disconnected').hidden = false;
  if (controls) controls.unlock();
});

// ---------------------------------------------------------------- avatars

function addAvatar(p) {
  const avatar = createAvatar({ name: p.name, color: p.color, hat: p.hat });
  scene.add(avatar.group);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.6, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  scene.add(shadow);
  avatars.set(p.id, {
    avatar, shadow,
    prev: new THREE.Vector3(0, 0, 34),
    target: new THREE.Vector3(0, 0, 34),
    render: new THREE.Vector3(0, 0, 34),
    targetYaw: Math.PI,
    yaw: Math.PI,
    lastUpdate: performance.now(),
  });
}

// ----------------------------------------------------------- interaction

function findNearest() {
  if (!controls) return null;
  let best = null;
  let bestD = Infinity;
  for (const st of STATIONS) {
    const dx = controls.pos.x - st.pos[0];
    const dz = controls.pos.z - st.pos[2];
    const d = Math.hypot(dx, dz);
    if (d <= st.radius && d < bestD) { best = st; bestD = d; }
  }
  return best;
}

function openPanel(station) {
  if (activePanel) closePanel();
  const def = GAME_UIS[station.game];
  if (!def) return;
  const ctx = {
    station,
    meId: me.id,
    hud,
    send: (t, d) => net.send(t, d),
    toast: (text, kind = 'error') => hud.toast(text, kind),
    feed: (text, kind) => hud.feed(text, kind),
  };
  const ui = def.create(ctx);
  activePanel = { station, ui };
  hud.openPanel(def.title, ui.root, { chips: def.chips });
  if (ui.onState && gameStates[station.game]) ui.onState(gameStates[station.game]);
  if (ui.onRound && roundState) ui.onRound(roundState);
  net.send('enter', { station: station.id });
  controls.unlock();
  sfx.click();
}

function closePanel() {
  if (!activePanel) return;
  activePanel.ui.destroy();
  activePanel = null;
  hud.closePanel();
  net.send('exit', {});
  relock();
}

let relockTimer = null;
function relock() {
  clearTimeout(relockTimer);
  controls.lock();
  // Browsers impose a short cooldown after an Esc-driven unlock; try once more.
  relockTimer = setTimeout(() => { if (!controls.locked && !hud.panelOpen) controls.lock(); }, 1400);
}

addEventListener('keydown', (e) => {
  if (!me) return;

  if (e.code === 'Tab') {
    e.preventDefault();
    hud.showBoard(true);
    return;
  }
  if (e.code === 'KeyM') {
    hud.toast(sfx.toggleMute() ? 'Sound off' : 'Sound on', 'info');
    return;
  }

  if (activePanel) {
    const digit = /^Digit([1-6])$/.exec(e.code);
    if (activePanel.ui.onKey && activePanel.ui.onKey(e.code)) { e.preventDefault(); return; }
    if (digit) { hud.setChip(CONFIG.CHIPS[Number(digit[1]) - 1]); e.preventDefault(); return; }
    if (e.code === 'KeyQ' || e.code === 'Escape') { closePanel(); e.preventDefault(); }
    return;
  }

  if (e.code === 'KeyC') {
    // A cigar is smokeable anywhere on the floor, not just at the counter.
    if (viewModel && viewModel.hasCigar()) {
      if (viewModel.puff()) net.send('puff', {});
    } else {
      hud.toast('Buy a cigar at the counter by the door first', 'info');
    }
    return;
  }

  if (e.code === 'KeyE' && nearest) openPanel(nearest);
});

addEventListener('keyup', (e) => { if (e.code === 'Tab') hud.showBoard(false); });

// ------------------------------------------------------------------- loop

let last = performance.now();
let lastMoveSent = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const serverNow = net.now();

  const { moving, sprinting } = controls.update(dt);

  // Remote players: interpolate between the last two snapshots.
  for (const a of avatars.values()) {
    const t = Math.min(1, (performance.now() - a.lastUpdate) / (1000 / CONFIG.SNAPSHOT_HZ));
    a.render.lerpVectors(a.prev, a.target, t);
    const wasMoving = a.prev.distanceToSquared(a.target) > 0.0004;
    a.avatar.group.position.copy(a.render);
    a.yaw += shortestAngle(a.yaw, a.targetYaw) * Math.min(1, dt * 12);
    // Avatars are modelled facing +Z; a player's yaw is measured from -Z.
    a.avatar.group.rotation.y = a.yaw + Math.PI;
    a.avatar.update(dt, wasMoving, false);
    a.avatar.scaleLabel(camera.position.distanceTo(a.render));
    a.shadow.position.set(a.render.x, 0.02, a.render.z);
  }

  // Position updates at ~20 Hz; the server relays snapshots at 15 Hz, so
  // anything faster is bytes nobody reads.
  if (now - lastMoveSent >= 50) {
    lastMoveSent = now;
    net.send('move', {
      p: [round2(controls.pos.x), round2(controls.pos.y), round2(controls.pos.z)],
      y: round2(controls.yaw),
      a: moving ? (sprinting ? 2 : 1) : 0,
    });
  }

  world.update(dt, {
    serverNow,
    roulette: gameStates.roulette,
    crash: gameStates.crash,
    horses: gameStates.horses,
    robots: gameStates.robots,
  });

  if (viewModel) {
    const sway = Math.sin(controls.bob) * (moving ? 0.02 : 0.005);
    viewModel.group.position.x = sway;
    viewModel.group.position.y = -Math.abs(sway) * 0.6;
    viewModel.update(dt);
  }
  smoke.update(dt);

  // Interaction prompt.
  nearest = activePanel ? null : findNearest();
  if (activePanel) hud.setPrompt(null);
  else if (nearest) hud.setPrompt(promptFor(nearest));
  else hud.setPrompt(null);

  if (activePanel && activePanel.ui.tick) activePanel.ui.tick(serverNow);
  hud.tickClock(serverNow);
  if (roundState && roundState.phase === 'intermission') {
    hud.updateFinalsCountdown((roundState.endsAt - serverNow) / 1000);
  }

  renderer.render(scene, camera);
}

function promptFor(st) {
  if (st.game === 'atm') return `${st.name} — borrow ${money(CONFIG.LOAN_AMOUNT)}`;
  return st.name;
}

const round2 = (v) => Math.round(v * 100) / 100;

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
