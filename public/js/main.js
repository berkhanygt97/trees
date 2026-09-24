import * as THREE from 'three';
import { CONFIG, money } from '/shared/config.js';
import {
  CROP_BY_ID, ITEMS, VEHICLE_BY_ID, IMPLEMENT_BY_ID, nextAction, cropProgress, isWatered,
  DISH_BY_ID, DAY_MS, HOUR_MS, RESTAURANTS,
} from '/shared/catalog.js';
import { ALL_STATIONS, PLOTS, TILE, tileAt, tileCenter, groundHeight, padStation, STATIC_BOXES, RAMPS, LOT_BY_ID } from '/shared/map.js';
import { HQS } from '/shared/hoods.js';
import { terrainGrid } from '/shared/terrain.js';
import { net } from './net.js';
import { sfx } from './sfx.js';
import { hud } from './hud.js';
import { World } from './world.js';
import { Fleet } from './fleet.js';
import { Controls } from './controls.js';
import { createAvatar, createViewModel } from './avatar.js';
import { Smoke } from './fx.js';
import { GAME_UIS } from './ui/index.js';
import { Pipeline } from './post.js';
import { BoarView } from './boarsview.js';
import { Weapons } from './weapons.js';
import { buildCockpit } from './cockpit.js';
import { WorkerView } from './workersview.js';
import { RestaurantView } from './restaurantview.js';
import { NpcView } from './npcs.js';
import { Crowd } from './crowd.js';
import { shadowTexture } from './textures.js';
import { PerfMeter } from './perf.js';
import { CameraRig } from './camera.js';
import { markShadows } from './shadows.js';
import { Radar, zoneName } from './radar.js';
import { UnitsView } from './unitsview.js';
import { PhysicsWorld } from './physics/world.js';

const canvas = document.getElementById('scene');
const joinScreen = document.getElementById('join');
const nameInput = document.getElementById('name');
const enterBtn = document.getElementById('enter');
const joinStatus = document.getElementById('join-status');

let renderer, scene, camera, world, fleet, controls, viewModel, smoke, selfAvatar, pipeline, boars, weapons, workers, perf, rig;
let physics = null;               // Rapier, once it has loaded (driving falls back to the simple model until then)
let jobs = [];                    // today's Job Centre candidates
let restaurants, npcs, crowd;
let restaurantList = [];          // who owns which lot on the Strip
const restos = new Map();         // lot -> your restaurant's live state, for its counter panel
let beacon = null;                // the delivery destination marker
let lastDrop = 0;
let cockpit = null;              // { id, obj } for the vehicle you are sitting in
let hp = 100;
let koUntil = 0;
let koSpawn = null;
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

let autoJoin = false;
enterBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (!name) { joinStatus.textContent = 'Type a name — your farm is saved under it.'; return; }
  enterBtn.disabled = true;
  joinStatus.textContent = autoJoin ? 'Reconnecting to the valley…' : 'Walking in…';
  localStorage.setItem('valley.name', name);
  try {
    sfx.unlock();
    await net.connect(name);
  } catch (err) {
    enterBtn.disabled = false;
    if (autoJoin) {
      // The host may be restarting: keep knocking quietly.
      joinStatus.textContent = 'Host not answering yet — retrying…';
      setTimeout(() => enterBtn.click(), 3000);
    } else {
      joinStatus.textContent = err.message;
    }
  }
});

// After a dropped connection the page reloads itself and walks straight back in.
try {
  if (sessionStorage.getItem('valley.autojoin') && nameInput.value) {
    autoJoin = true;
    setTimeout(() => enterBtn.click(), 300);
  }
} catch { /* storage blocked: the player just clicks */ }

net.on('denied', (d) => {
  autoJoin = false;
  try { sessionStorage.removeItem('valley.autojoin'); } catch { /* ignore */ }
  joinStatus.textContent = d.reason;
  enterBtn.disabled = false;
});

const worldTime = () => clock.time + (net.now() - clock.serverNow) * clock.rate;

// ------------------------------------------------------------------ scene

function initScene() {
  // No MSAA: the world is drawn at a reduced resolution and scaled up soft anyway.
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0714);
  scene.fog = new THREE.Fog(0x140b1c, 45, 120);

  camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.1, 1400);

  world = new World(scene);
  fleet = new Fleet(scene, world);
  smoke = new Smoke(scene);
  controls = new Controls(camera, canvas, world);
  rig = new CameraRig(camera, world);
  controls.thirdPerson = !rig.firstPerson;
  controls.chase = controls.thirdPerson;
  pipeline = new Pipeline(renderer);
  // Quality presets also switch the sun's shadows.
  pipeline.onQuality = (q) => world.sky.setShadows(q.shadows);
  pipeline.onQuality(pipeline.quality);
  world.sky.focus = controls.pos;
  perf = new PerfMeter(renderer);
  boars = new BoarView(scene);
  units = new UnitsView(scene);
  workers = new WorkerView(scene);
  restaurants = new RestaurantView(scene);
  world.extraBoxes = restaurants.boxes;
  npcs = new NpcView(scene);
  crowd = new Crowd(npcs);
  beacon = makeBeacon();
  scene.add(beacon);
  const heard = (e) => Math.max(0, 1 - camera.position.distanceTo(e.pos) / 90);
  boars.onCharge = (e) => sfx.grunt(heard(e));
  boars.onHurt = (e) => sfx.squeal(heard(e) * 0.7);
  boars.onDeath = (e) => sfx.squeal(heard(e));
  weapons = new Weapons({ scene, camera, net, hud, sfx, boars, controls });
  weapons.aimRay = thirdPersonAim;
  controls.onStep = () => sfx.step();
  // Without physics (still loading, or switched off) bumps come from the simple model.
  controls.onBump = (v) => {
    if (v > 9) { sfx.crash(Math.min(1, v / 25)); rig.kick(Math.min(0.6, v / 30)); }
    // A hard knock with dinner on board spills it.
    if (v > 9 && hud.wallet.carrying) net.send('spill', {});
  };
  world.sky.onThunder = () => sfx.thunder();
  startPhysics();

  // Debug handle: useful when you are hosting and want to poke at the valley.
  window.casino = {
    THREE, controls, world, fleet, scene, camera, net, hud, gameStates, pipeline, boars, weapons, renderer, perf, rig,
    get physics() { return physics; },
    get units() { return units; },
    get radar() { return radar; },
    get workers() { return workers; },
    get npcs() { return npcs; },
    get restaurants() { return restaurants; },
    get restos() { return restos; },
    get cockpit() { return cockpit; },
    get hp() { return hp; },
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
    pipeline.resize();
  });
}

// ------------------------------------------------------------------ aiming

/**
 * Third person: the crosshair is the camera's line of sight, but the bullet
 * leaves your head. Find what the crosshair is on (a boar, a wall, the
 * ground) and aim from your head at that point.
 */
function thirdPersonAim() {
  if (rig.firstPerson) return null;
  const eye = new THREE.Vector3(controls.pos.x, controls.pos.y + 1.6, controls.pos.z);
  const o = camera.getWorldPosition(new THREE.Vector3());
  const d = camera.getWorldDirection(new THREE.Vector3());
  const range = (weapons.gun && weapons.gun.range) || 120;
  // Anything between the camera and you does not count.
  const tMin = Math.max(0, eye.clone().sub(o).dot(d));
  let t = tMin + range;
  for (const b of boars.aliveList()) {
    const hit = raySphereT(o, d, b.pos.x, 0.55, b.pos.z, 0.7);
    if (hit != null && hit > tMin && hit < t) t = hit;
  }
  for (const u of units.aliveList()) {
    const hit = raySphereT(o, d, u.pos.x, 1.2, u.pos.z, 0.45);
    if (hit != null && hit > tMin && hit < t) t = hit;
  }
  for (const b of world.boxesNear()) {
    const hit = rayBoxT(o, d, b);
    if (hit != null && hit > tMin && hit < t) t = hit;
  }
  for (let s = tMin; s < Math.min(t, tMin + 160); s += 2) {
    const p = o.clone().addScaledVector(d, s);
    if (p.y < groundHeight(p.x, p.z)) { t = s; break; }
  }
  const target = o.clone().addScaledVector(d, t);
  const dir = target.sub(eye).normalize();
  const right = new THREE.Vector3(Math.cos(controls.facing), 0, -Math.sin(controls.facing));
  const muzzle = selfAvatar.muzzleWorld(new THREE.Vector3())
    || eye.clone().addScaledVector(dir, 0.9).addScaledVector(right, 0.18).add(new THREE.Vector3(0, -0.22, 0));
  return { o: eye, d: dir, muzzle };
}

function raySphereT(o, d, cx, cy, cz, r) {
  const ox = o.x - cx;
  const oy = o.y - cy;
  const oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}

function rayBoxT(o, d, b) {
  let t0 = 0;
  let t1 = Infinity;
  for (const [p, v, lo, hi] of [[o.x, d.x, b.x0, b.x1], [o.y, d.y, -1, b.h || 4], [o.z, d.z, b.z0, b.z1]]) {
    if (Math.abs(v) < 1e-9) { if (p < lo || p > hi) return null; continue; }
    let a = (lo - p) / v;
    let c = (hi - p) / v;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return t0 > 0 ? t0 : null;
}

// ---------------------------------------------------------------- physics

async function startPhysics() {
  let mode = 'full';
  try { mode = localStorage.getItem('valley.physics') || 'full'; } catch { /* default */ }
  if (mode === 'simple') return;
  try {
    const RAPIER = (await import('@dimforge/rapier3d-compat')).default;
    await RAPIER.init();
    const p = new PhysicsWorld(RAPIER);
    p.addTerrain(terrainGrid());
    p.setBoxes('static', STATIC_BOXES);
    // Trees, posts and poles are solid; street furniture gets knocked over instead.
    p.setPosts('posts', world.staticObstacles.filter((o) => !o.prop), groundHeight);
    p.setRamps(RAMPS);
    p.onCrash = onCrash;
    physics = p;
    syncPhysicsBoxes();
    controls.physics = p;
    // Already sitting in a car: hand it over to the simulation.
    if (controls.car) {
      p.dropRemote(controls.car.id);
      p.startDriving(controls.car.model.id, [controls.pos.x, controls.pos.y, controls.pos.z], controls.car.yaw);
    }
  } catch (err) {
    console.warn('[physics] not available, using simple driving:', err.message);
  }
}

/** Farm buildings and restaurants appear and move; keep the physics walls in step. */
function syncPhysicsBoxes() {
  if (!physics) return;
  physics.setBoxes('farms', world.farms.boxes);
  physics.setBoxes('restaurants', restaurants.boxes);
}

let lastCrash = 0;
/** Your car hit something. `f` is the impact force per kilo of car. */
function onCrash(f) {
  const now = performance.now();
  if (f < 30 || now - lastCrash < 220) return;
  lastCrash = now;
  const k = Math.min(1, f / 320);
  sfx.crash(k);
  rig.kick(k * 0.9);
  if (f > 160 && hud.wallet.carrying) net.send('spill', {});
}

// ------------------------------------------------------------- net handlers

net.on('welcome', (d) => {
  try { sessionStorage.setItem('valley.autojoin', '1'); } catch { /* ignore */ }
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
  pipeline.overlayCamera.add(viewModel.group);
  weapons.attach(viewModel);
  boars.apply(d.boars || []);
  units.setList(d.unitlist || [], me.color);
  units.applySnap(d.units || []);
  workers.setList(d.workers || []);
  restaurantList = d.restaurants || [];
  restaurants.setList(restaurantList);
  world.extraBoxes = restaurants.boxes;
  for (const ev of d.npcs || []) npcs.onEvent(ev);
  syncPhysicsBoxes();

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
  world.hoods.setOwners(d.plots);
  radar = new Radar(document.getElementById('radar'));
  radar.setHoods(d.plots);
  hud.setHealth(hp);
  hud.setWeapon(null);
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
  for (const [id, x, y, z, yaw, anim, vid, , gun, , , ap] of rows) {
    if (id === me.id) continue;
    const a = avatars.get(id);
    if (!a) continue;
    a.avatar.setGun(gun || null);
    a.prev.copy(a.target);
    a.target.set(x, y, z);
    a.targetYaw = yaw;
    a.aimPitch = ap || 0;
    a.aiming = !!(anim & 4);
    a.vehicle = vid || null;
    a.lastUpdate = performance.now();
  }
  if (fleet) fleet.applySnap(rows, me.id);
});

net.on('wallet', (w) => {
  hud.setWallet(w);
  hud.setArmor(w.armor || 0);
  if (weapons) weapons.setOwned(w.guns, w.gun);
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

net.on('plot', (p) => {
  if (!world || !p) return;
  world.farms.setPlot(p);
  world.hoods.setOwners([p]);
  if (radar) radar.setHoods([p]);
  syncPhysicsBoxes();
  if (activePanel && activePanel.ui.onPlot && p.index === hud.wallet.plot) activePanel.ui.onPlot(p);
});

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

// ---------------------------------------------------------- boars and guns

net.on('boars', (rows) => { if (boars) boars.apply(rows); });
net.on('workers', (list) => { if (workers) workers.setList(list); });
net.on('wk', (ev) => { if (workers) workers.onEvent(ev); });
net.on('npc', (ev) => { if (npcs) npcs.onEvent(ev); });
net.on('restaurants', (list) => {
  restaurantList = list || [];
  if (!restaurants) return;
  restaurants.setList(restaurantList);
  world.extraBoxes = restaurants.boxes;
  syncPhysicsBoxes();
  if (activePanel && activePanel.ui.repaint) activePanel.ui.repaint();
});
net.on('resto', (s) => {
  if (!s) return;
  restos.set(s.lot, s);
  if (activePanel && activePanel.station.lot === s.lot && activePanel.ui.onResto) activePanel.ui.onResto(s);
});
net.on('delivered', (d) => {
  if (d.failed) { hud.toast('Too late — the customer gave up and ordered pizza from someone else.', 'error'); return; }
  const bits = [`+${money(d.paid)}`];
  if (d.tip) bits.push(`${money(d.tip)} tip`);
  if (d.late) bits.push('late: half price');
  if (d.damaged) bits.push('squashed: half tip');
  hud.toast(`🛵 Delivered! ${bits.join(' · ')}`, d.late ? 'warn' : 'big');
  hud.pop(`+${money(d.paid)}`, 'money');
  sfx.chip();
});
net.on('jobs', (list) => {
  jobs = list || [];
  if (activePanel && activePanel.ui.onJobs) activePanel.ui.onJobs();
});
net.on('shotres', (d) => { if (weapons) weapons.onShotRes(d); });
net.on('ammo', (d) => { if (weapons) weapons.onAmmo(d); });
net.on('shot', (d) => {
  if (!weapons) return;
  // A gang member's shot: the tracer leaves their gun.
  if (d.uid && units) {
    const m = units.onShot(d, tmpVec);
    if (m) d = { ...d, o: [m.x, m.y + 0.2, m.z] };
  }
  weapons.onRemoteShot(d, camera.position);
  const a = avatars.get(d.pid);
  if (a) a.avatar.fire();
});
net.on('unitlist', (list) => { if (units) units.setList(list, me.color); });
net.on('units', (rows) => { if (units) units.applySnap(rows); });

net.on('hurt', (d) => {
  hp = d.hp;
  hud.setHealth(hp);
  if (d.armor != null) hud.setArmor(d.armor);
  pipeline.ouch(Math.min(1, 0.35 + d.dmg / 40));
  sfx.hurt();
  if (!controls.car && d.dir) controls.knock(d.dir[0], d.dir[1], 7 + d.dmg * 0.1);
});

net.on('hp', (d) => { hp = d.hp; hud.setHealth(hp); if (d.armor != null) hud.setArmor(d.armor); });

net.on('ko', (d) => {
  koUntil = performance.now() + d.ms;
  koSpawn = d;
  controls.frozen = true;
  weapons.holster();
  if (activePanel) closePanel();
  hud.showKo(true, d.where || undefined);
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
  // Connection dropped: show it, then reload and rejoin under the same name.
  // The server hands the farm straight back to this browser.
  document.getElementById('disconnected').hidden = false;
  if (controls) controls.unlock();
  try { sessionStorage.setItem('valley.autojoin', '1'); } catch { /* ignore */ }
  setTimeout(() => location.reload(), 2000);
});

// ---------------------------------------------------------------- avatars

function addAvatar(p) {
  const avatar = createAvatar({ name: p.name, color: p.color, hat: p.hat });
  scene.add(avatar.group);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.3),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  scene.add(shadow);
  avatars.set(p.id, {
    avatar, shadow, color: p.color,
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
  if (st.lot != null) return (hud.wallet.restaurants || []).some((r) => r.lot === st.lot);
  if (st.game === 'hq') return st.hood === hud.wallet.plot;
  if (st.plot == null) return true;
  if (st.plot !== hud.wallet.plot) return false;
  if (st.pad === 'house' || st.pad === 'bin') return true;
  return !!(hud.wallet.buildings && hud.wallet.buildings[st.pad]);
}

/** Your farm's layout (where the planner put everything), or undefined for the default. */
function myLayout() {
  const p = world && world.farms.plots.get(hud.wallet.plot);
  return p && p.layout;
}

/** Where a station really is: farm buildings follow their owner's layout. */
function stationPos(st) {
  if (st.plot == null) return st.pos;
  const p = world.farms.plots.get(st.plot);
  return padStation(PLOTS[st.plot], st.pad, p && p.layout);
}

function findNearest() {
  if (!controls || controls.car) return null;
  let best = null;
  let bestD = Infinity;
  for (const st of ALL_STATIONS) {
    const pos = stationPos(st);
    const dx = controls.pos.x - pos[0];
    const dz = controls.pos.z - pos[2];
    if (Math.abs(dx) > 12 || Math.abs(dz) > 12) continue;
    const d = Math.hypot(dx, dz);
    if (d <= st.radius && d < bestD && stationUsable(st)) { best = st; bestD = d; }
  }
  return best;
}

function stationName(st) {
  if (st.lot != null) {
    const r = (hud.wallet.restaurants || []).find((q) => q.lot === st.lot);
    return r ? `Your ${RESTAURANTS[r.type].name} counter` : 'Your restaurant counter';
  }
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
    get myPlot() { return world ? world.farms.plots.get(hud.wallet.plot) : null; },
    get jobs() { return jobs; },
    get restaurants() { return restaurantList; },
    get resto() { return station.lot != null ? restos.get(station.lot) || null : null; },
    /** Swap this panel for another one at the same spot (the house opens the planner). */
    open: (game) => openPanel({ ...station, game }),
    worldTime,
  };
}

function openPanel(station) {
  // Swapping one panel for another (house -> planner) must not grab the mouse
  // back in between, or the new panel could not be clicked.
  if (activePanel) closePanel({ swap: true });
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

function closePanel({ swap = false } = {}) {
  if (!activePanel) return;
  activePanel.ui.destroy();
  activePanel = null;
  hud.closePanel();
  net.send('exit', {});
  if (!swap) relock();
}

let relockTimer = null;
function relock() {
  clearTimeout(relockTimer);
  controls.lock();
  // Browsers impose a short cooldown after an Esc-driven unlock; try once more.
  relockTimer = setTimeout(() => { if (!controls.locked && !hud.panelOpen) controls.lock(); }, 1400);
}

// ------------------------------------------------------------ deliveries

/** A tall glowing column over the door you are delivering to. */
function makeBeacon() {
  const g = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 60, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff3d9a, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  beam.position.y = 30;
  g.add(beam);
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 3, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x35e0ff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
  ring.position.y = 0.06;
  g.add(ring);
  g.visible = false;
  return g;
}

function updateDelivery(dt) {
  const c = hud.wallet && hud.wallet.carrying;
  if (!c) {
    beacon.visible = false;
    hud.setDelivery(null);
    return;
  }
  beacon.visible = true;
  beacon.position.set(c.pos[0], 0, c.pos[2]);
  beacon.children[1].rotation.y += dt;
  beacon.children[0].material.opacity = 0.25 + Math.sin(performance.now() / 200) * 0.1;
  const left = Math.max(0, Math.round((c.deadline - net.now()) / 1000));
  const dist = Math.round(Math.hypot(c.pos[0] - controls.pos.x, c.pos[2] - controls.pos.z));
  const dish = DISH_BY_ID[c.dish];
  hud.setDelivery(`🛵 ${dish ? dish.icon : ''} to ${c.dest} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · ${dist} m`, left < 20);
  // Close enough: hand it over (the server checks you really are there).
  if (dist < 5 && performance.now() - lastDrop > 1200) {
    lastDrop = performance.now();
    net.send('drop', {});
  }
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
  const layout = myLayout();
  const t = tileAt(plot, x, z, size, layout);
  if (!t) return null;
  const [cx, cz] = tileCenter(plot, t[0], t[1], layout);
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
  if (viewModel) viewModel.gesture();
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
    const t = tileAt(plot, x, z, size, myLayout());
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
  // It stops being a parked obstacle and becomes the car you drive.
  if (physics) physics.dropRemote(e.id);
  controls.enterCar({ id: e.id, model, spec: e.spec, pos: [e.pos.x, e.pos.y, e.pos.z], yaw: e.yaw });
  rig.fresh = true;
  e.driver = me.id;
  net.send('drive', { vid: e.id });
  weapons.holster();
  viewModel.group.visible = false;
  // Build the inside of the car: dashboard, cluster, wheel and your hands.
  cockpit = { id: e.id, obj: buildCockpit(model.body, e.spec, me.color) };
  e.mesh.group.add(cockpit.obj.group);
  cockpit.obj.group.visible = !controls.chase;
  cockpit.hides = e.mesh.body.userData.riderHides || [];
  for (const m of cockpit.hides) m.visible = controls.chase;
  hud.showSeeds(model.kind === 'machine');
  sfx.click();
  sfx.engineStart(model.kind === 'machine');
}

function leaveCar(tellServer = true) {
  const parked = controls.exitCar();
  if (!parked) return;
  if (tellServer) net.send('drive', { vid: null, pos: parked.pos, yaw: parked.yaw });
  // Park it level where it stopped (the fleet puts it back as a solid body).
  const e = fleet.get(parked.id || (cockpit && cockpit.id));
  if (e) { e.pos.set(parked.pos[0], parked.pos[1], parked.pos[2]); e.yaw = parked.yaw; e.mesh.group.quaternion.setFromEuler(new THREE.Euler(0, parked.yaw, 0)); }
  rig.fresh = true;
  dropCockpit();
  hud.setSpeedo(null);
  hud.showSeeds(hud.wallet.plot >= 0);
  sfx.engineStop();
}

function dropCockpit() {
  if (!cockpit) return;
  const e = fleet.get(cockpit.id);
  if (e) e.mesh.group.remove(cockpit.obj.group);
  for (const m of cockpit.hides || []) m.visible = true;
  cockpit.obj.dispose();
  cockpit = null;
}

/** Driving into a bin or a hydrant sends it flying. */
function knockProps(car) {
  const speed = Math.abs(car.speed);
  if (speed < 2.5) return;
  const r = car.spec.radius + 0.4;
  const v = physics && physics.vehicle ? physics.vehicle.velocity() : { x: -Math.sin(car.yaw) * car.speed, y: 0, z: -Math.cos(car.yaw) * car.speed };
  for (const o of world.obstaclesNear(controls.pos.x, controls.pos.z)) {
    if (!o.prop || o.gone) continue;
    if (Math.hypot(o.x - controls.pos.x, o.z - controls.pos.z) > r + o.r) continue;
    if (world.props.knock(o.prop, [v.x, v.y, v.z], physics, groundHeight)) {
      sfx.knock(Math.min(1, speed / 20));
      if (!physics) car.speed *= 0.92;
    }
  }
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
let triggerHeld = false;            // left button down with an automatic gun out

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
  if (e.code === 'KeyV') {
    // Third person (the default) or first person, on foot and in the car.
    const mode = rig.toggle();
    controls.thirdPerson = mode === 'tp';
    controls.chase = controls.thirdPerson;
    controls.lookYaw = 0;
    controls.lookPitch = controls.chase ? -0.12 : -0.08;
    if (cockpit) {
      cockpit.obj.group.visible = !controls.chase;
      for (const m of cockpit.hides) m.visible = controls.chase;
    }
    hud.toast(mode === 'tp' ? 'Camera: third person' : 'Camera: first person', 'info');
    return;
  }
  if (e.code === 'F3') {
    e.preventDefault();
    perf.toggle();
    return;
  }
  if (e.code === 'KeyP') {
    const q = pipeline.cycleQuality();
    hud.toast(`Graphics: ${q.name}`, 'info');
    return;
  }
  if (controls.frozen) return;
  if (e.code === 'KeyQ' && !controls.car) { weapons.toggle(); return; }
  if (e.code === 'KeyR') { weapons.reload(); return; }
  if (e.code === 'KeyT' && !controls.car) { weapons.cycle(); return; }
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
  if (!me || activePanel || !controls.locked || controls.frozen) return;
  if (e.button === 2) { weapons.setAiming(true); return; }
  if (e.button !== 0) return;
  if (weapons.out && !controls.car) {
    // Automatic guns keep firing while the trigger is held (see the loop).
    triggerHeld = true;
    if (weapons.fire()) selfAvatar.fire();
    return;
  }
  holding = true;
  lastWorkSent = 0;
  workAim();
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) { holding = false; triggerHeld = false; }
  if (e.button === 2 && weapons) weapons.setAiming(false);
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => {
  if (!me || activePanel || !controls || !controls.locked) return;
  hud.cycleSeed(e.deltaY > 0 ? 1 : -1);
}, { passive: true });

// ------------------------------------------------------------------- loop

let last = performance.now();
let lastMoveSent = 0;
let lastShadowMark = 0;
let radar = null;
let units = null;
let headlight = null;
let lastRadarBlips = 0;
let lastZone = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  perf.begin();
  const serverNow = net.now();
  const wt = worldTime();

  // Knocked out: fade to black, come round at your gate.
  let fade = 0;
  if (koUntil) {
    const left = koUntil - performance.now();
    fade = left > 700 ? Math.min(1, (performance.now() - (koUntil - koSpawn.ms)) / 500) : Math.max(0, left / 700);
    if (left <= 700 && koSpawn.spawn) {
      controls.pos.set(koSpawn.spawn[0], 0, koSpawn.spawn[2]);
      controls.yaw = koSpawn.yaw || 0;
      controls.pitch = 0;
      controls.vel.set(0, 0, 0);
      koSpawn.spawn = null;
    }
    if (left <= 0) {
      koUntil = 0;
      controls.frozen = false;
      hud.showKo(false);
    }
  }

  const move = controls.update(dt);
  const { moving, sprinting } = move;
  const car = controls.car;
  // On foot the world still steps: other people's cars, things you knocked over.
  if (physics && !car) physics.step(dt);

  // The camera: over your shoulder, behind your car, or your own eyes (V).
  if (car) {
    rig.car(dt, {
      pos: controls.pos, quat: controls.quat, yaw: car.yaw, speed: car.speed, top: car.model.top,
      lookYaw: controls.lookYaw, lookPitch: controls.lookPitch, spec: car.spec,
    });
  } else {
    rig.foot(dt, { pos: controls.pos, yaw: controls.yaw, pitch: controls.pitch, aiming: weapons.aiming, bob: move.bob || 0 });
  }
  weapons.baseFov = car && !rig.firstPerson ? rig.carFov : 78;

  fleet.update(dt, {
    myCarId: car ? car.id : null,
    myPos: controls.pos, myYaw: car ? car.yaw : 0, myQuat: car ? controls.quat : null,
    mySpeed: move.speed || 0, mySteer: move.steer || 0,
    night: world.sky.inside > 0.5 ? 0 : world.sky.night,
    camera,
  });
  // Every other vehicle is a solid body in the physics world.
  if (physics) {
    for (const e of fleet.items.values()) {
      if (car && e.id === car.id) continue;
      const q = e.mesh.group.quaternion;
      physics.setRemote(e.id, e.model, [e.pos.x, e.pos.y, e.pos.z], { x: q.x, y: q.y, z: q.z, w: q.w });
    }
    for (const id of physics.remoteIds()) if (!fleet.items.has(id)) physics.dropRemote(id);
  }

  // Remote players: interpolate between the last two snapshots.
  for (const a of avatars.values()) {
    const t = Math.min(1, (performance.now() - a.lastUpdate) / (1000 / CONFIG.SNAPSHOT_HZ));
    a.render.lerpVectors(a.prev, a.target, t);
    const e = a.vehicle ? fleet.get(a.vehicle) : null;
    if (e) {
      a.avatar.setSeated(true);
      a.avatar.setSteer(0);
      fleet.seatOf(e, a.avatar.group.position);
      a.avatar.group.rotation.y = e.yaw + Math.PI;
      a.avatar.update(dt, false, false, 0);
      a.shadow.visible = false;
    } else {
      a.avatar.setSeated(false);
      const wasMoving = a.prev.distanceToSquared(a.target) > 0.0004;
      a.avatar.group.position.copy(a.render);
      a.yaw += shortestAngle(a.yaw, a.targetYaw) * Math.min(1, dt * 12);
      // Avatars are modelled facing +Z; a player's yaw is measured from -Z.
      a.avatar.group.rotation.y = a.yaw + Math.PI;
      // How fast they really go, from the snapshots, sets their gait.
      const speed = wasMoving ? Math.hypot(a.target.x - a.prev.x, a.target.z - a.prev.z) * CONFIG.SNAPSHOT_HZ : 0;
      a.speed = (a.speed || 0) + (speed - (a.speed || 0)) * Math.min(1, dt * 8);
      a.avatar.setAiming(a.aiming);
      a.avatar.setAimPitch(a.aimPitch);
      const dist = camera.position.distanceTo(a.render);
      a.avatar.setDistance(dist);
      a.avatar.update(dt, wasMoving, false, a.speed);
      a.avatar.scaleLabel(dist);
      a.shadow.visible = true;
      a.shadow.position.set(a.render.x, a.render.y + 0.02, a.render.z);
    }
  }

  // Yourself: seen from behind in third person, sat in your car from the chase camera.
  if (!car) {
    const show = !rig.firstPerson && !koUntil;
    selfAvatar.group.visible = show;
    viewModel.group.visible = rig.firstPerson;
    if (show) {
      selfAvatar.setSeated(false);
      selfAvatar.group.position.copy(controls.pos);
      selfAvatar.group.rotation.set(0, controls.facing + Math.PI, 0);
      selfAvatar.setGun(weapons.held || null);
      selfAvatar.setAiming(weapons.aiming);
      selfAvatar.setAimPitch(controls.pitch);
      selfAvatar.update(dt, moving, sprinting, selfSpeed(dt));
    }
  }
  if (car) {
    const e = fleet.get(car.id);
    selfAvatar.group.visible = controls.chase && !!e;
    if (e) {
      selfAvatar.setSeated(true);
      const [sx, sy, sz] = car.spec.seat;
      selfAvatar.group.position.set(sx, sy, sz).applyQuaternion(controls.quat).add(controls.pos);
      selfAvatar.group.quaternion.copy(controls.quat).multiply(HALF_Y);
      selfAvatar.setSteer(-car.steer);
      selfAvatar.update(dt, false, false, 0);
    }
    hud.setSpeedo({
      speed: car.speed, top: car.model.top, body: car.model.body, night: world.sky.night,
      cockpit: !controls.chase, ...carLabel(car),
    });
    if (cockpit) cockpit.obj.update(dt, car.speed, car.model.top, car.steer, world.sky.night);
    if (e) e.mesh.setAir(Math.max(0, controls.pos.y - groundHeight(controls.pos.x, controls.pos.z)), !!physics);
    sfx.engineSpeed(car.speed / car.model.top);
    machineWork();
    knockProps(car);
  }

  // Position updates at ~20 Hz; the server relays snapshots at 15 Hz.
  if (now - lastMoveSent >= 50) {
    lastMoveSent = now;
    net.send('move', {
      p: [round2(controls.pos.x), round2(controls.pos.y), round2(controls.pos.z)],
      // Which way your body faces, and where you are aiming up or down.
      y: round2(controls.facing),
      ap: round2(controls.pitch),
      a: (moving ? (sprinting ? 2 : 1) : 0) | (weapons.out && weapons.aiming ? 4 : 0),
      vy: car ? round2(car.yaw) : undefined,
      vp: car ? round2(car.pitch || 0) : undefined,
      vr: car ? round2(car.roll || 0) : undefined,
      g: weapons.held || undefined,
    });
  }

  // Draw distance follows the fog; anything past it is never sent to the GPU.
  if (Math.abs(camera.far - world.sky.drawFar) > 4) {
    camera.far = world.sky.drawFar;
    camera.updateProjectionMatrix();
  }

  updateRadar(dt, now, car);
  if (triggerHeld && weapons.out && weapons.gun.auto && !car && controls.locked && weapons.fire()) selfAvatar.fire();

  // Your headlights light the road ahead after dark (a light from the pool).
  if (!headlight) headlight = world.lights.add([{ x: 0, y: -50, z: 0, color: 0xfff0d0, intensity: 0, range: 26, night: true, priority: 60 }])[0];
  if (car) {
    const r = car.spec.radius + 4;
    headlight.x = controls.pos.x - Math.sin(car.yaw) * r;
    headlight.z = controls.pos.z - Math.cos(car.yaw) * r;
    headlight.y = controls.pos.y + 1.2;
    headlight.intensity = 90;
  } else headlight.intensity = 0;

  // Shadow flags for whatever was added since last time (cars, people, farms).
  if (now - lastShadowMark > 1500) { lastShadowMark = now; markShadows(scene); }

  world.update(dt, {
    serverNow,
    worldTime: wt,
    camera,
    roulette: gameStates.roulette,
    crash: gameStates.crash,
    horses: gameStates.horses,
    robots: gameStates.robots,
  });

  if (viewModel && !car && rig.firstPerson) viewModel.update(dt, { moving, sprinting, aiming: weapons.aiming });
  weapons.update(dt);
  boars.update(dt);
  units.update(dt, camera);
  workers.update(dt, net.now(), camera.position);
  crowd.update(dt, net.now(), (worldTime() % DAY_MS) / HOUR_MS);
  npcs.update(dt, net.now(), camera.position);
  restaurants.update(dt, world.sky.night);
  updateDelivery(dt);
  smoke.update(dt);
  world.props.updateLoose(dt, physics);

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

  pipeline.render(scene, camera, {
    dusk: world.sky.dusk || 0,
    night: world.sky.inside > 0.5 ? 0 : world.sky.night,
    inside: world.sky.inside,
    fade,
    wasted: koUntil ? 1 : 0,
    flash: world.sky.flash * 0.25 * (1 - world.sky.inside),
    dt,
    overlayFov: 58 * (0.86 + 0.14 * camera.fov / 78),
    ambient: world.casino.ambient,
  });
  perf.end(dt);
}

const round2 = (v) => Math.round(v * 100) / 100;
const HALF_Y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

/** The radar, the zone caption and the weapon icon. */
const camDir = new THREE.Vector3();
function updateRadar(dt, now, car) {
  if (!radar) return;
  camera.getWorldDirection(camDir);
  const yaw = Math.atan2(-camDir.x, -camDir.z);
  if (now - lastRadarBlips > 200) {
    lastRadarBlips = now;
    const players = [];
    for (const [id, a] of avatars) {
      const p = a.render;
      const e = a.vehicle ? fleet.get(a.vehicle) : null;
      players.push({ x: p.x, z: p.z, color: a.color || '#fff', shape: 'arrow', yaw: e ? e.yaw : a.yaw, size: 5, edge: true, id });
    }
    radar.setBlips('players', players);
    radar.setBlips('restaurants', restaurantList.filter((r) => r.owner === me.slug).map((r) => {
      const lot = LOT_BY_ID.get(r.lot);
      return lot ? { x: (lot.x0 + lot.x1) / 2, z: (lot.z0 + lot.z1) / 2, color: '#f2c14e', shape: 'icon', label: 'R', size: 5, edge: false } : null;
    }).filter(Boolean));
    radar.setBlips('beacon', beacon.visible ? [{ x: beacon.position.x, z: beacon.position.z, color: '#e0302a', shape: 'marker', size: 6, edge: true }] : []);
    radar.setBlips('boars', boars.aliveList().map((b) => ({ x: b.pos.x, z: b.pos.z, color: '#c0392b', size: 3, edge: false })));
    // Raiders in red (always, with lookouts on the corner); gangs in their colours.
    const cctv = ((hud.wallet.hood || {}).up || {}).cctv || 0;
    radar.setBlips('units', units.aliveList().map((u) => (u.kind === 'raider'
      ? { x: u.pos.x, z: u.pos.z, color: '#ff2a2a', size: 4, edge: cctv > 0 }
      : { x: u.pos.x, z: u.pos.z, color: u.color, size: 3, edge: false })));
    if (me.plot >= 0 && HQS[me.plot]) {
      const d = HQS[me.plot].door;
      radar.setBlips('home', [{ x: d[0], z: d[2], color: me.color, shape: 'icon', label: 'H', size: 6, edge: true }]);
    }
  }
  radar.update(dt, { yaw, pos: controls.pos, facing: car ? car.yaw : controls.facing, speed: car ? car.speed : 0 });
  if (now - lastZone > 500) {
    lastZone = now;
    hud.zone(zoneName(controls.pos.x, controls.pos.z));
  }
  hud.setWeapon(weapons.out ? weapons.gun.id : null, weapons.out ? (weapons.reloading ? '...' : `${weapons.mag}-${weapons.gun.mag}`) : '');
}

/** How fast you are really going on foot (for your own walk cycle), smoothed. */
const lastSelfPos = new THREE.Vector3();
let selfSpeedNow = 0;
function selfSpeed(dt) {
  const d = Math.hypot(controls.pos.x - lastSelfPos.x, controls.pos.z - lastSelfPos.z);
  lastSelfPos.copy(controls.pos);
  const v = dt > 0 && d < 5 ? d / dt : 0;
  selfSpeedNow += (v - selfSpeedNow) * Math.min(1, dt * 10);
  return selfSpeedNow;
}

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

