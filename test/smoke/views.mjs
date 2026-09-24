// Where the smoke test stands and looks. `server(room, me)` runs in the host
// process (set the clock, force a raid...); `client(casino)` runs in the page.
// yaw 0 looks north (-z); pitch is up/down in radians.
import { HOUR_MS, DAY_MS } from '../../shared/catalog.js';
import { PLOTS, plotSpawn } from '../../shared/map.js';

const at = (room, hour) => {
  room.clock.time = Math.floor(room.clock.time / DAY_MS) * DAY_MS + hour * HOUR_MS;
  room.clock.weather = 'clear';
  room.clock.weatherUntil = room.clock.time + 3 * HOUR_MS;
  room.broadcast('clock', room.clock.state());
};

export const VIEWS = [
  { name: 'spawn', server: (room) => at(room, 11) },
  { name: 'farm', pos: [plotSpawn(PLOTS[0]).pos[0] + 20, 0, PLOTS[0].z0 + 40], yaw: 0.6, pitch: -0.15 },
  { name: 'mainstreet', pos: [0, 0, 200], yaw: 0, pitch: 0 },
  { name: 'plaza', pos: [20, 0, 90], yaw: 0.35, pitch: 0.05 },
  { name: 'strip', pos: [70, 0, 54], yaw: -Math.PI / 2, pitch: 0 },
  { name: 'casino', pos: [0, 0, 30], yaw: 0, pitch: -0.05 },
  { name: 'track', pos: [0, 0, -95], yaw: 0, pitch: -0.1 },
  { name: 'dusk', server: (room) => at(room, 19.2), pos: [0, 0, 200], yaw: 0, pitch: 0.05 },
  { name: 'night', server: (room) => at(room, 23), pos: [90, 0, 54], yaw: -Math.PI / 2, pitch: 0 },
];
