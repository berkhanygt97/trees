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
  { name: 'dusk', server: (room) => at(room, 19.2), pos: [street.x0 + 120, 0, midZ], yaw: -Math.PI / 2, pitch: 0.05 },
  { name: 'night', server: (room) => at(room, 23), pos: [street.x0 + 200, 0, midZ], yaw: -Math.PI / 2, pitch: 0.05 },
];
