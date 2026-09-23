import * as THREE from 'three';
import { CONFIG, money } from '/shared/config.js';
import {
  CROP_BY_ID, ITEMS, VEHICLE_BY_ID, IMPLEMENT_BY_ID, nextAction, cropProgress, isWatered,
} from '/shared/catalog.js';
import { ALL_STATIONS, PLOTS, TILE, tileAt, tileCenter } from '/shared/map.js';
import { net } from './net.js';
import { sfx } from './sfx.js';
import { hud } from './hud.js';
import { World } from './world.js';
import { Fleet } from './fleet.js';
import { Controls } from './controls.js';
import { createAvatar, createViewModel } from './avatar.js';
import { Smoke } from './fx.js';
import { GAME_UIS } from './ui/index.js';

const canvas = document.getElementById('scene');
const joinScreen = document.getElementById('join');
const nameInput = document.getElementById('name');
const enterBtn = document.getElementById('enter');
const joinStatus = document.getElementById('join-status');

let renderer, scene, camera, world, fleet, controls, viewModel, smoke, selfAvatar;
const tmpVec = new THREE.Vector3();
let me = null;
const avatars = new Map();       // playerId -> { avatar, target, shadow }
const gameStates = { roulette: null, crash: null, horses: null, robots: null };
let activePanel = null;          // { station, ui }
let nearest = null;
let roundState = null;
let clock = { time: 0, rate: 1, serverNow: Date.now(), weather: 'clear' };
let market = null;
let orders = [];
let aim = null;                  // the tile under your crosshair, if it is yours
let nearCar = null;

const PAD_NAMES = {
  house: 'Your House', coop: 'Chicken Coop', barn: 'Cow Barn', mill: 'Windmill',
  dairy: 'Dairy', bakery: 'Bakery', bin: 'Shipping Bin',
};

// --------------------------------------------------------------- bootstrap

nameInput.value = localStorage.getItem('valley.name') || localStorage.getItem('casino.name') || '';
nameInput.focus();
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') enterBtn.click(); });

enterBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (!name) { joinStatus.textContent = 'Type a name — your farm is saved under it.'; return; }
  enterBtn.disabled = true;
  joinStatus.textContent = 'Walking in…';
  localStorage.setItem('valley.name', name);
  try {
    sfx.unlock();
    await net.connect(name);
  } catch (err) {
    joinStatus.textContent = err.message;
    enterBtn.disabled = false;
  }
});

net.on('denied', (d) => {
  joinStatus.textContent = d.reason;
  enterBtn.disabled = false;
});

const worldTime = () => clock.time + (net.now() - clock.serverNow) * clock.rate;

// ------------------------------------------------------------------ scene

function initScene() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0714);
  scene.fog = new THREE.Fog(0x140b1c, 45, 120);

  camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.1, 1400);

  world = new World(scene);
  fleet = new Fleet(scene, world);
  smoke = new Smoke(scene);
  controls = new Controls(camera, canvas, world);
  controls.onStep = () => sfx.step();
  controls.onBump = (v) => { if (v > 9) sfx.deny(); };
  world.sky.onThunder = () => sfx.alarm && sfx.alarm();

  // Debug handle: useful when you are hosting and want to poke at the valley.
  window.casino = {
    controls, world, fleet, scene, camera, net, hud, gameStates,
    get panel() { return activePanel; },
    get viewModel() { return viewModel; },
    smoke,
    get round() { return roundState; },
    get clock() { return clock; },
    get aim() { return aim; },
    worldTime,
  };

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

// ------------------------------------------------------------- net handlers

net.on('welcome', (d) => {
  if (d.config) Object.assign(CONFIG, d.config);
  me = d.you;
  hud.meId = me.id;
  joinScreen.hidden = true;
  initScene();
  hud.init();
  hud.setRound(d.round);
  roundState = d.round;
  clock = d.clock;
  market = d.market;
  orders = d.orders;
  world.sky.setWeather(clock.weather);

  viewModel = createViewModel(me.color);
  camera.add(viewModel.group);
  scene.add(camera);

  selfAvatar = createAvatar({ name: me.name, color: me.color, hat: me.hat, showLabel: false });
  selfAvatar.group.visible = false;
  scene.add(selfAvatar.group);

  for (const p of d.players) {
    if (p.id === me.id) continue;
    addAvatar(p);
    avatars.get(p.id).avatar.setCigar(p.cigar);
  }
  Object.assign(gameStates, d.games);
  hud.showSeeds(me.plot >= 0);
  world.farms.setPlots(d.plots);
  fleet.set(d.vehicles, me.id);

  controls.pos.set(d.spawn.pos[0], d.spawn.pos[1] || 0, d.spawn.pos[2]);
  controls.yaw = d.spawn.yaw || 0;
  controls.lock();
  if (d.isNew) {
    hud.toast(me.plot >= 0 ? 'This is your farm! Walk onto the field and press E to plow.' : 'Welcome to the valley.', 'big');
    setTimeout(() => hud.toast('Press H any time for help. Town is along the road to the middle of the valley.', 'info'), 4000);
  } else {
    hud.toast(`Welcome back, ${me.name}.`, 'info');
  }
  requestAnimationFrame(loop);
});

net.on('players', (list) => {
  const seen = new Set();
  for (const p of list) {
    seen.add(p.id);
    if (p.id !== me.id && !avatars.has(p.id)) addAvatar(p);
    const a = avatars.get(p.id);
    if (a) a.avatar.setCigar(p.cigar);
    if (p.id === me.id && viewModel) { viewModel.setCigar(p.cigar); selfAvatar.setCigar(p.cigar); }
  }
  for (const [id, a] of avatars) {
    if (!seen.has(id)) { scene.remove(a.avatar.group); scene.remove(a.shadow); a.avatar.dispose(); avatars.delete(id); }
  }
});

net.on('snap', (rows) => {
  for (const [id, x, y, z, yaw, , vid] of rows) {
    if (id === me.id) continue;
    const a = avatars.get(id);
    if (!a) continue;
    a.prev.copy(a.target);
    a.target.set(x, y, z);
    a.targetYaw = yaw;
    a.vehicle = vid || null;
    a.lastUpdate = performance.now();
  }
  if (fleet) fleet.applySnap(rows, me.id);
});

net.on('wallet', (w) => {
  hud.setWallet(w);
  if (activePanel && activePanel.ui.onWallet) activePanel.ui.onWallet(w);
});

net.on('clock', (c) => {
  clock = c;
  if (world) world.sky.setWeather(c.weather);
});

net.on('market', (m) => {
  market = m;
  if (activePanel && activePanel.ui.onMarket) activePanel.ui.onMarket(m);
});

net.on('orders', (o) => {
  orders = o;
  if (activePanel && activePanel.ui.onOrders) activePanel.ui.onOrders(o);
});

net.on('plot', (p) => { if (world && p) world.farms.setPlot(p); });

net.on('tiles', (d) => {
  if (!world) return;
  world.farms.applyTiles(d);
  if (d.strike) { world.sky.flash = 1; sfx.alarm && sfx.alarm(); }
});

net.on('harvest', (h) => {
  const it = ITEMS[h.item];
  hud.pop(`+${h.qty} ${it ? it.icon : ''}`, 'win');
  sfx.chip();
});

net.on('vehicles', (list) => {
  if (!fleet) return;
  fleet.set(list, me.id);
  // If the server does not have us in the car we think we are driving, get out.
  if (controls.car) {
    const e = fleet.get(controls.car.id);
    if (!e || (e.driver && e.driver !== me.id)) leaveCar(false);
  }
});

// Somebody took a draw — puff smoke from their cigar.
net.on('puff', (d) => {
  if (!smoke) return;
  if (d.playerId === me.id) {
    if (viewModel && viewModel.hasCigar() && !controls.car) smoke.puff(viewModel.tipWorld(tmpVec), 12);
    return;
  }
  const a = avatars.get(d.playerId);
  if (a && a.avatar.hasCigar()) smoke.puff(a.avatar.tipWorld(tmpVec), 10);
});

net.on('round', (r) => {
  roundState = r;
  hud.setRound(r);
  if (activePanel && activePanel.ui.onRound) activePanel.ui.onRound(r);
});

net.on('board', (rows) => {
  hud.setBoard(rows);
  world.paintBoard(rows, me.id);
});

net.on('game', (s) => {
  gameStates[s.game] = s;
  if (activePanel && activePanel.ui.onState) activePanel.ui.onState(s);
});

net.on('result', (res) => {
  if (activePanel && activePanel.ui.onResult) activePanel.ui.onResult(res);
  else if (res.game === 'roulette' || res.game === 'horses' || res.game === 'crash' || res.game === 'robots') {
    // You can wander off mid-spin; you still get told what happened.
    const net_ = res.net != null ? res.net : (res.payout || 0) - (res.staked || 0);
    hud.feed(`${res.game} ${net_ >= 0 ? '+' : ''}${money(net_)}`, net_ > 0 ? 'win' : 'loss');
  }
});

net.on('toast', (t) => {
  hud.toast(t.text, t.kind);
  if (t.kind === 'event') sfx.alarm();
  if (t.kind === 'error') sfx.deny();
});

net.on('__closed', () => {
  if (!me) return;   // a refused join closes the socket too
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
    prev: new THREE.Vector3(0, 0, 60),
    target: new THREE.Vector3(0, 0, 60),
    render: new THREE.Vector3(0, 0, 60),
    targetYaw: 0,
    yaw: 0,
    vehicle: null,
    lastUpdate: performance.now(),
  });
}

// ----------------------------------------------------------- interaction

function stationUsable(st) {
  if (st.plot == null) return true;
  if (st.plot !== hud.wallet.plot) return false;
  if (st.pad === 'house' || st.pad === 'bin') return true;
  return !!(hud.wallet.buildings && hud.wallet.buildings[st.pad]);
}

function findNearest() {
  if (!controls || controls.car) return null;
  let best = null;
  let bestD = Infinity;
  for (const st of ALL_STATIONS) {
    const dx = controls.pos.x - st.pos[0];
    const dz = controls.pos.z - st.pos[2];
    if (Math.abs(dx) > 12 || Math.abs(dz) > 12) continue;
    const d = Math.hypot(dx, dz);
    if (d <= st.radius && d < bestD && stationUsable(st)) { best = st; bestD = d; }
  }
  return best;
}

function stationName(st) {
  if (st.plot != null) return PAD_NAMES[st.pad] || st.name;
  return st.name;
}

function panelCtx(station) {
  return {
    station,
    meId: me.id,
    me,
    hud,
    send: (t, d) => net.send(t, d),
    toast: (text, kind = 'error') => hud.toast(text, kind),
    feed: (text, kind) => hud.feed(text, kind),
    get wallet() { return hud.wallet; },
    get market() { return market; },
    get orders() { return orders; },
    get vehicles() { return fleet ? [...fleet.items.values()].filter((e) => e.owner === me.slug) : []; },
    worldTime,
  };
}

function openPanel(station) {
  if (activePanel) closePanel();
  const def = GAME_UIS[station.game];
  if (!def) return;
  const ui = def.create(panelCtx(station));
  activePanel = { station, ui };
  const title = typeof def.title === 'function' ? def.title(station) : def.title;
  hud.openPanel(title, ui.root, { chips: def.chips });
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

// ---------------------------------------------------------------- farming

const rayDir = new THREE.Vector3();

/** Which of your tiles you are pointing at: the ground under the crosshair, or just ahead of your feet. */
function findAim() {
  const plotIndex = hud.wallet.plot;
  if (plotIndex == null || plotIndex < 0 || controls.car) return null;
  const plot = PLOTS[plotIndex];
  const size = hud.wallet.fieldSize || 8;
  let x = null;
  let z = null;
  camera.getWorldDirection(rayDir);
  if (rayDir.y < -0.05) {
    const t = -camera.position.y / rayDir.y;
    const hx = camera.position.x + rayDir.x * t;
    const hz = camera.position.z + rayDir.z * t;
    if (Math.hypot(hx - controls.pos.x, hz - controls.pos.z) <= 3.4) { x = hx; z = hz; }
  }
  if (x === null) {
    x = controls.pos.x - Math.sin(controls.yaw) * 1.3;
    z = controls.pos.z - Math.cos(controls.yaw) * 1.3;
  }
  const t = tileAt(plot, x, z, size);
  if (!t) return null;
  const [cx, cz] = tileCenter(plot, t[0], t[1]);
  const tile = world.farms.tile(plotIndex, t[0], t[1]);
  return { i: t[0], j: t[1], cx, cz, tile, action: nextAction(tile, worldTime()) };
}

function aimPrompt(a) {
  const now = worldTime();
  const seed = CROP_BY_ID[hud.seed];
  const seeds = hud.wallet.inv[`seed:${seed.id}`] || 0;
  switch (a.action) {
    case 'plow': return 'Plow this patch';
    case 'plant': return hud.wallet.level < seed.level
      ? `${seed.name} unlocks at level ${seed.level} — pick another seed (1–7)`
      : seeds ? `Plant ${seed.icon} ${seed.name} (${seeds} seeds)` : `No ${seed.name.toLowerCase()} seeds — buy some in town`;
    case 'water': return `Water the ${CROP_BY_ID[a.tile.c].name.toLowerCase()} · ${Math.floor(cropProgress(a.tile, now) * 100)}%`;
    case 'harvest': return `Harvest ${CROP_BY_ID[a.tile.c].icon} ${CROP_BY_ID[a.tile.c].name}`;
    default: {
      const crop = CROP_BY_ID[a.tile.c];
      return `${crop.icon} ${crop.name} growing · ${Math.floor(cropProgress(a.tile, now) * 100)}%${isWatered(a.tile, now) ? ' · 💧' : ''}`;
    }
  }
}

let lastWorkSent = 0;
function workAim() {
  if (!aim || aim.action === 'wait') return;
  const now = performance.now();
  if (now - lastWorkSent < 190) return;
  lastWorkSent = now;
  net.send('work', { tiles: [[aim.i, aim.j]], seed: hud.seed });
  if (aim.action === 'plow') sfx.step();
  else if (aim.action === 'water') sfx.click();
}

/** Tiles under a tractor's implement or a combine's header. */
let lastMachineWork = 0;
function machineWork() {
  const c = controls.car;
  if (!c || c.model.kind !== 'machine') return;
  const plotIndex = hud.wallet.plot;
  if (plotIndex == null || plotIndex < 0) return;
  const e = fleet.get(c.id);
  if (c.model.id === 'tractor' && !(e && e.implement)) return;
  const now = performance.now();
  if (now - lastMachineWork < 140) return;
  lastMachineWork = now;
  const plot = PLOTS[plotIndex];
  const size = hud.wallet.fieldSize;
  const fx = -Math.sin(c.yaw);
  const fz = -Math.cos(c.yaw);
  const rx = Math.cos(c.yaw);
  const rz = -Math.sin(c.yaw);
  const back = c.spec.work;   // positive is behind the machine, negative in front
  const n = c.model.swath;
  const seen = new Set();
  const tiles = [];
  for (let k = 0; k < n; k++) {
    const off = (k - (n - 1) / 2) * TILE;
    const x = controls.pos.x - fx * back + rx * off;
    const z = controls.pos.z - fz * back + rz * off;
    const t = tileAt(plot, x, z, size);
    if (!t) continue;
    const key = `${t[0]},${t[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tiles.push(t);
  }
  if (tiles.length) net.send('work', { tiles, vid: c.id, seed: hud.seed });
}

// --------------------------------------------------------------- vehicles

function enterCar(e) {
  const model = VEHICLE_BY_ID[e.model];
  controls.enterCar({ id: e.id, model, spec: e.spec, pos: [e.pos.x, e.pos.y, e.pos.z], yaw: e.yaw });
  e.driver = me.id;
  net.send('drive', { vid: e.id });
  viewModel.group.visible = false;
  hud.showSeeds(model.kind === 'machine');
  sfx.click();
  sfx.engineStart(model.kind === 'machine');
}

function leaveCar(tellServer = true) {
  const parked = controls.exitCar();
  if (!parked) return;
  if (tellServer) net.send('drive', { vid: null, pos: parked.pos, yaw: parked.yaw });
  viewModel.group.visible = true;
  selfAvatar.group.visible = false;
  hud.setSpeedo(null);
  hud.showSeeds(hud.wallet.plot >= 0);
  sfx.engineStop();
}

function cycleImplement() {
  const c = controls.car;
  if (!c || c.model.id !== 'tractor') return;
  const owned = hud.wallet.implements || [];
  if (!owned.length) { hud.toast('Buy a plow, seeder or water tank at the Tractor Barn', 'info'); return; }
  const e = fleet.get(c.id);
  const options = [null, ...owned];
  const next = options[(options.indexOf(e ? e.implement : null) + 1) % options.length];
  net.send('implement', { vid: c.id, id: next });
  hud.toast(next ? `Hitched the ${IMPLEMENT_BY_ID[next].name.toLowerCase()}` : 'Nothing hitched', 'info');
}

function carLabel(c) {
  if (c.model.id === 'tractor') {
    const e = fleet.get(c.id);
    const imp = e && e.implement ? IMPLEMENT_BY_ID[e.implement] : null;
    return {
      label: `TRACTOR · ${imp ? imp.name.toUpperCase() : 'NOTHING HITCHED'}`,
      hint: '<kbd>G</kbd> swap implement · <kbd>F</kbd> get out · <kbd>V</kbd> camera',
    };
  }
  if (c.model.id === 'combine') return { label: 'COMBINE HARVESTER', hint: 'drive over ripe crops · <kbd>F</kbd> get out' };
  return { label: c.model.name.toUpperCase(), hint: '<kbd>F</kbd> get out · <kbd>V</kbd> camera · <kbd>Space</kbd> handbrake' };
}

// ------------------------------------------------------------------- input

let holding = false;

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
  if (e.code === 'KeyH' && !activePanel) { hud.toggleHelp(); return; }

  if (activePanel) {
    const digit = /^Digit([1-6])$/.exec(e.code);
    if (activePanel.ui.onKey && activePanel.ui.onKey(e.code)) { e.preventDefault(); return; }
    if (digit && GAME_UIS[activePanel.station.game].chips) { hud.setChip(CONFIG.CHIPS[Number(digit[1]) - 1]); e.preventDefault(); return; }
    if (e.code === 'KeyQ' || e.code === 'Escape') { closePanel(); e.preventDefault(); }
    return;
  }
  if (e.code === 'Escape') hud.toggleHelp(false);

  const seedKey = /^Digit([1-7])$/.exec(e.code);
  if (seedKey) {
    const crop = Object.values(CROP_BY_ID)[Number(seedKey[1]) - 1];
    hud.setSeed(crop.id);
    return;
  }

  if (e.code === 'KeyF') {
    if (controls.car) leaveCar();
    else if (nearCar) enterCar(nearCar);
    return;
  }
  if (e.code === 'KeyV' && controls.car) { controls.chase = !controls.chase; return; }
  if (e.code === 'KeyG') { cycleImplement(); return; }

  if (e.code === 'KeyC') {
    // A cigar is smokeable anywhere, not just at the counter.
    if (viewModel && viewModel.hasCigar() && !controls.car) {
      if (viewModel.puff()) net.send('puff', {});
    } else if (!controls.car) {
      hud.toast('Buy a cigar at the counter inside the casino first', 'info');
    }
    return;
  }

  if (e.code === 'KeyE') {
    if (e.repeat) return;
    if (nearest) { openPanel(nearest); return; }
    holding = true;
    lastWorkSent = 0;
    workAim();
  }
});

addEventListener('keyup', (e) => {
  if (e.code === 'Tab') hud.showBoard(false);
  if (e.code === 'KeyE') holding = false;
});

addEventListener('mousedown', (e) => {
  if (!me || activePanel || !controls.locked || e.button !== 0) return;
  holding = true;
  lastWorkSent = 0;
  workAim();
});
addEventListener('mouseup', (e) => { if (e.button === 0) holding = false; });
addEventListener('wheel', (e) => {
  if (!me || activePanel || !controls || !controls.locked) return;
  hud.cycleSeed(e.deltaY > 0 ? 1 : -1);
}, { passive: true });

// ------------------------------------------------------------------- loop

let last = performance.now();
let lastMoveSent = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const serverNow = net.now();
  const wt = worldTime();

  const move = controls.update(dt);
  const { moving, sprinting } = move;
  const car = controls.car;

  fleet.update(dt, {
    myCarId: car ? car.id : null,
    myPos: controls.pos, myYaw: car ? car.yaw : 0,
    mySpeed: move.speed || 0, mySteer: move.steer || 0,
    camera,
  });

  // Remote players: interpolate between the last two snapshots.
  for (const a of avatars.values()) {
    const t = Math.min(1, (performance.now() - a.lastUpdate) / (1000 / CONFIG.SNAPSHOT_HZ));
    a.render.lerpVectors(a.prev, a.target, t);
    const e = a.vehicle ? fleet.get(a.vehicle) : null;
    if (e) {
      a.avatar.setSeated(true);
      fleet.seatOf(e, a.avatar.group.position);
      a.avatar.group.rotation.y = e.yaw + Math.PI;
      a.avatar.update(dt, false, false);
      a.shadow.visible = false;
    } else {
      a.avatar.setSeated(false);
      const wasMoving = a.prev.distanceToSquared(a.target) > 0.0004;
      a.avatar.group.position.copy(a.render);
      a.yaw += shortestAngle(a.yaw, a.targetYaw) * Math.min(1, dt * 12);
      // Avatars are modelled facing +Z; a player's yaw is measured from -Z.
      a.avatar.group.rotation.y = a.yaw + Math.PI;
      a.avatar.update(dt, wasMoving, false);
      a.avatar.scaleLabel(camera.position.distanceTo(a.render));
      a.shadow.visible = true;
      a.shadow.position.set(a.render.x, a.render.y + 0.02, a.render.z);
    }
  }

  // Yourself, sat in your own car (seen from the chase camera).
  if (car) {
    const e = fleet.get(car.id);
    selfAvatar.group.visible = controls.chase && !!e;
    if (e) {
      selfAvatar.setSeated(true);
      fleet.seatOf(e, selfAvatar.group.position);
      selfAvatar.group.rotation.y = car.yaw + Math.PI;
      selfAvatar.update(dt, false, false);
    }
    hud.setSpeedo({ speed: car.speed, ...carLabel(car) });
    sfx.engineSpeed(car.speed / car.model.top);
    machineWork();
  }

  // Position updates at ~20 Hz; the server relays snapshots at 15 Hz.
  if (now - lastMoveSent >= 50) {
    lastMoveSent = now;
    net.send('move', {
      p: [round2(controls.pos.x), round2(controls.pos.y), round2(controls.pos.z)],
      y: round2(controls.yaw),
      a: moving ? (sprinting ? 2 : 1) : 0,
      vy: car ? round2(car.yaw) : undefined,
    });
  }

  world.update(dt, {
    serverNow,
    worldTime: wt,
    camera,
    roulette: gameStates.roulette,
    crash: gameStates.crash,
    horses: gameStates.horses,
    robots: gameStates.robots,
  });

  if (viewModel && !car) {
    const sway = Math.sin(controls.bob) * (moving ? 0.02 : 0.005);
    viewModel.group.position.x = sway;
    viewModel.group.position.y = -Math.abs(sway) * 0.6;
    viewModel.update(dt);
  }
  smoke.update(dt);

  // What can you do right now?
  nearest = activePanel ? null : findNearest();
  aim = activePanel || nearest ? null : findAim();
  nearCar = activePanel || car ? null : fleet.nearestOwned(controls.pos, me.slug);

  if (activePanel || car) {
    hud.setPrompt(null);
    world.farms.hideMarker();
  } else if (nearest) {
    hud.setPrompt(stationName(nearest));
    world.farms.hideMarker();
  } else if (aim) {
    hud.setPrompt(aimPrompt(aim), aim.action === 'wait' ? '·' : 'E');
    world.farms.showMarker(aim.cx, aim.cz, aim.action !== 'wait');
    if (holding) workAim();
  } else {
    hud.setPrompt(null);
    world.farms.hideMarker();
  }
  hud.setPrompt2(nearCar ? `Drive your ${VEHICLE_BY_ID[nearCar.model].name}` : null);

  if (activePanel && activePanel.ui.tick) activePanel.ui.tick(serverNow);
  hud.setClock(wt, clock.weather);

  renderer.render(scene, camera);
}

const round2 = (v) => Math.round(v * 100) / 100;

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

