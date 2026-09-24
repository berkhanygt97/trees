// Where the smoke test stands and looks. `server(room, me)` runs in the host
// process (set the clock, force a raid...); `client(casino)` runs in the page.
// yaw 0 looks north (-z), yaw +PI/2 looks west; pitch is up/down in radians.
import { HOUR_MS, DAY_MS } from '../../shared/catalog.js';
import { PLOTS, HQS, plotSpawn } from '../../shared/map.js';
import { HOOD_STREETS } from '../../shared/hoods.js';

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
  { name: 'dusk', server: (room) => at(room, 19.2), pos: [street.x0 + 120, 0, midZ], yaw: -Math.PI / 2, pitch: 0.05 },
  { name: 'night', server: (room) => at(room, 23), pos: [street.x0 + 200, 0, midZ], yaw: -Math.PI / 2, pitch: 0.05 },
];
