// Where the smoke test stands and looks. `server(room, me)` runs in the host
// process (set the clock, force a raid...); `client(casino)` runs in the page.
// yaw 0 looks north (-z), yaw +PI/2 looks west; pitch is up/down in radians.
import { HOUR_MS, DAY_MS } from '../../shared/catalog.js';
import { PLOTS, HQS, plotSpawn } from '../../shared/map.js';
import { HOOD_STREETS } from '../../shared/hoods.js';
import { RIVALS } from '../../shared/catalog.js';

const at = (room, hour) => {
  room.clock.time = Math.floor(room.clock.time / DAY_MS) * DAY_MS + hour * HOUR_MS;
  room.clock.weather = 'clear';
  room.clock.weatherUntil = room.clock.time + 3 * HOUR_MS;
  room.broadcast('clock', room.clock.state());
};
const street = HOOD_STREETS[0];
const midZ = (street.z0 + street.z1) / 2;

/** Hands you a car next to you, gets you in, and floors it. */
async function drive(page, room, me, model = 'muscle', secs = 3, keys = ['KeyW']) {
  await page.waitForTimeout(400);
  const [x, , z] = await page.evaluate(() => window.casino.controls.pos.toArray());
  me.pos = [x, 0, z];
  me.vehicles = me.vehicles.filter((v) => v.id !== `${me.slug}#smoke`);
  // Parked along the street, nose towards downtown.
  me.vehicles.push({ id: `${me.slug}#smoke`, model, color: '#d93a3a', pos: [x, 0, z + 3], yaw: -Math.PI / 2, implement: null });
  room.broadcast('vehicles', room.publicVehicles());
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.casino.controls.locked = true; });
  await page.waitForFunction((id) => window.casino.fleet.items.has(id), `${me.slug}#smoke`);
  await page.waitForTimeout(700);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(600);
  for (const k of keys) await page.keyboard.down(k);
  // Software rendering can crawl along at a frame or two a second, and the
  // simulation only catches up a few steps per frame: wait for the car, not
  // the clock.
  await page.waitForTimeout(secs * 1000);
  await page.waitForFunction(() => { const c = window.casino.controls.car; return c && Math.abs(c.speed) > 12; }, null, { timeout: 120_000, polling: 250 }).catch(() => {});
  const state = await page.evaluate(() => {
    const c = window.casino;
    return { car: !!c.controls.car, physics: !!(c.physics && c.physics.vehicle), speed: c.controls.car ? c.controls.car.speed : 0, pos: c.controls.pos.toArray() };
  });
  console.log(`      drive: in car ${state.car}, physics ${state.physics}, ${state.speed.toFixed(1)} m/s at ${state.pos.map((n) => n.toFixed(0)).join(',')}`);
  if (!state.car || !state.physics || Math.abs(state.speed) < 12) throw new Error(`driving did not work: ${JSON.stringify(state)}`);
}
const release = async (page, keys = ['KeyW', 'KeyA', 'KeyD', 'Space']) => { for (const k of keys) await page.keyboard.up(k); };

/** Everyone who can walk the valley, posed in a row in front of the camera. */
async function lineup(near = false) {
  const { createCharacter } = await import('/js/character.js');
  const c = window.casino;
  const eye = c.controls.pos;
  const cast = [
    [{ outfit: 'farmer', color: '#c0392b', head: 'straw' }, { speed: 0 }],
    [{ outfit: 'farmer', color: '#2e86de', head: 'flatcap' }, { speed: 7.2 }],
    [{ outfit: 'street', color: '#27ae60', accent: '#1e8449', head: 'bandana', top: 'tank' }, { speed: 12.5 }],
    [{ outfit: 'street', color: '#e67e22', accent: '#e67e22', head: 'bandana', mask: true, legs: 'khaki' }, { gun: 'semiauto', aim: true, pitch: 0.15 }],
    [{ outfit: 'biker', color: '#333', accent: '#8e1b1b' }, { gun: 'shotgun' }],
    [{ outfit: 'track', color: '#16a085', accent: '#ffffff' }, { gun: 'pistol', aim: true }],
    [{ outfit: 'street', color: '#8e44ad', accent: '#8e44ad', head: 'capback', top: 'hoodie', skin: '#8d5a3b' }, { seated: true }],
    [{ outfit: 'street', color: '#f1c40f', accent: '#111', head: 'beanie', skin: '#6b4430' }, { dead: true }],
  ];
  const people = cast.map(([look, how], i) => {
    const p = createCharacter(look, { name: look.outfit });
    p.group.position.set(eye.x + (near ? 3.2 : 6.5), 0, eye.z - 4.4 + i * 1.25);
    p.group.rotation.y = -Math.PI / 2 + 0.35;
    if (how.gun) p.setGun(how.gun);
    if (how.aim) p.setAiming(true);
    if (how.pitch) p.setAimPitch(how.pitch);
    if (how.seated) { p.setSeated(true); p.group.position.y = 0.45; }
    if (how.dead) p.die();
    c.scene.add(p.group);
    // Two seconds in already, however slowly the page is drawing.
    for (let k = 0; k < 20; k++) p.update(0.1, false, false, how.speed || 0);
    return { p, how };
  });
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const { p, how } of people) p.update(dt, false, false, how.speed || 0);
    requestAnimationFrame(tick);
  };
  tick();
}

export const VIEWS = [
  { name: 'spawn', server: (room) => at(room, 11) },
  { name: 'farm', pos: [plotSpawn(PLOTS[0]).pos[0] + 16, 0, PLOTS[0].z0 + 40], yaw: 0.6, pitch: -0.15 },
  { name: 'hood', pos: [street.x0 + 70, 0, midZ], yaw: -Math.PI / 2, pitch: 0.02 },
  { name: 'clubhouse', pos: [HQS[0].door[0] + 10, 0, HQS[0].door[2] + 14], yaw: 0.4, pitch: 0.08 },
  { name: 'avenue', pos: [-336, 0, 100], yaw: 0, pitch: 0 },
  { name: 'hills', client: (c) => { c.controls.pos.y = 40; }, pos: [-200, 0, -300], yaw: 2.4, pitch: -0.12 },
  { name: 'mountains', pos: [600, 0, 440], yaw: -0.6, pitch: 0.05 },
  { name: 'mainstreet', pos: [0, 0, 200], yaw: 0, pitch: 0 },
  { name: 'uptown', pos: [-150, 0, 216], yaw: 0.9, pitch: 0.2 },
  { name: 'hospital', pos: [150, 0, 216], yaw: 0.8, pitch: 0.08 },
  { name: 'downtown-night', server: (room) => at(room, 22.5), pos: [-60, 0, 216], yaw: 1.2, pitch: 0.12 },
  { name: 'plaza', pos: [20, 0, 90], yaw: 0.35, pitch: 0.05 },
  { name: 'strip', pos: [70, 0, 54], yaw: -Math.PI / 2, pitch: 0 },
  { name: 'casino', pos: [0, 0, 30], yaw: 0, pitch: -0.05 },
  { name: 'track', pos: [0, 0, -95], yaw: 0, pitch: -0.1 },
  { name: 'drive', pos: [HOOD_STREETS[0].x0 + 40, 0, (HOOD_STREETS[0].z0 + HOOD_STREETS[0].z1) / 2], yaw: -Math.PI / 2,
    steps: async (page, room, me) => { await drive(page, room, me, 'muscle', 3); }, wait: 200 },
  { name: 'drift', steps: async (page) => { await page.keyboard.down('KeyD'); await page.keyboard.down('Space'); await page.waitForTimeout(900); await release(page); }, wait: 100 },
  { name: 'cockpit', steps: async (page) => { await page.keyboard.press('KeyV'); await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); }, wait: 100 },
  { name: 'getout', steps: async (page) => { await release(page); await page.keyboard.press('KeyV'); await page.waitForTimeout(2500); await page.keyboard.press('KeyF'); }, wait: 1200 },
  { name: 'people', server: (room) => at(room, 11), pos: [street.x0 + 90, 0, midZ], yaw: -Math.PI / 2, pitch: -0.1,
    client: (c) => { c.rig.mode = 'fp'; c.rig.fresh = true; }, steps: async (page) => { await page.evaluate(lineup); }, wait: 2500 },
  { name: 'people-near', pos: [street.x0 + 150, 0, midZ + 2.6], yaw: -Math.PI / 2, pitch: -0.12,
    client: (c) => { c.rig.mode = 'fp'; c.rig.fresh = true; }, steps: async (page) => { await page.evaluate(lineup, true); }, wait: 2500 },
  { name: 'gangfight', server: (room, me) => {
    at(room, 15);
    me.money = 1e6;
    me.hood.up.armory = 2;
    for (const n of ['Tiny', 'Moose']) room.staff.hire(me, room.staff.candidates()[0].cid, 'soldier', n);
    room.combat.tick();
    const q = HQS[me.plot];
    const c = RIVALS.coyotes;
    for (let i = 0; i < 3; i++) {
      room.combat.spawn({ kind: 'raider', hood: me.plot, name: 'Coyote', gang: 'coyotes', color: c.color, gun: i ? 'pistol' : 'smg',
        look: { outfit: c.outfit, color: c.color, accent: c.accent, top: c.top, legs: c.legs, head: c.head, mask: c.mask, skin: ['#c68a5e', '#9c6644', '#e0ac80'][i] },
        x: q.spawn[0] + (me.plot >= 3 ? 22 : -22), z: q.spawn[2] + 18 + i * 2, acc: 0.1 });
    }
  }, client: (c) => { c.rig.mode = 'tp'; c.rig.fresh = true; },
    pos: [HQS[0].spawn[0] - 4, 0, HQS[0].spawn[2] + 10], yaw: Math.PI / 2 + 0.25, pitch: -0.05, wait: 4500 },
  { name: 'afternoon', server: (room) => at(room, 16.5), pos: [street.x0 + 45, 0, midZ], yaw: Math.PI / 2 + 0.5, pitch: -0.1,
    client: (c) => { c.rig.mode = 'tp'; c.rig.fresh = true; } },
  { name: 'dusk', client: (c) => { c.rig.mode = 'tp'; }, server: (room) => at(room, 19.2), pos: [street.x0 + 120, 0, midZ], yaw: -Math.PI / 2, pitch: 0.05 },
  { name: 'night', server: (room) => at(room, 23), pos: [street.x0 + 200, 0, midZ], yaw: -Math.PI / 2, pitch: 0.05 },
];
