import { STATIONS } from '/shared/config.js';
import { CASINO, STRIP } from '/shared/map.js';
import { pickCast } from '/shared/looks.js';
import { randomLook } from './people.js';

// Casino regulars and people out walking. Nothing about them is sent over the
// network: every client works out the same crowd from a shared seed and the
// server clock, so everybody sees the same woman win at slot machine 3 and the
// same tourist wander down the Strip, for zero bytes.

const SEED = 20260923;
const PATRONS = 14;
const WALKERS = 10;
const WALK = 1.3;

function hash(...xs) {
  let h = 2166136261 ^ SEED;
  for (const x of xs) { h = Math.imul(h ^ (x | 0), 16777619); h ^= h >>> 13; }
  return h >>> 0;
}
function rng(...xs) {
  let t = hash(...xs);
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------ casino spots
//
// Where a regular can be: at a slot machine, round a table, at the bar,
// watching the rocket or the horses. Each spot has the route in from its
// nearest door, avoiding the tables, and a pose once there.

const DOOR_L = [(CASINO.DOORS[0][0] + CASINO.DOORS[0][1]) / 2, CASINO.MAX_Z + 3];
const DOOR_R = [(CASINO.DOORS[1][0] + CASINO.DOORS[1][1]) / 2, CASINO.MAX_Z + 3];

function casinoSpots() {
  const spots = [];
  const add = (x, z, face, pose, prop, side) => {
    const door = side < 0 ? DOOR_L : DOOR_R;
    const inside = [door[0], CASINO.MAX_Z - 5];
    const aisle = [x < 0 ? Math.min(-12, x + 1) : Math.max(12, x - 1), 32];
    spots.push({ at: [x, z], face, pose, prop, route: [[door[0] + side * 30, door[1] + 8], door, inside, aisle, [x, Math.min(z + 0.01, 32)], [x, z]] });
  };
  for (const st of STATIONS) {
    const [x, , z] = st.pos;
    if (st.game === 'slots') add(x + 1.7, z + 0.9, -Math.PI / 2, 'play', null, -1);
    if (st.game === 'blackjack') for (const dz of [-1.6, 1.6]) add(x - 3.4, z + dz, Math.PI / 2, 'play', 'chips', 1);
  }
  // Round the roulette wheel, on the near side.
  for (const a of [-0.9, -0.3, 0.3, 0.9]) add(Math.sin(a) * 4.6, 20 + Math.cos(a) * 4.6, Math.PI + a, 'stand', 'chips', a < 0 ? -1 : 1);
  // At the bar, drink in hand.
  for (const x of [-6, -3, 0, 3, 6]) add(x, 32.5, 0, 'stand', 'drink', x < 0 ? -1 : 1);
  // Watching the rocket and the horses.
  for (const [x, z] of [[-6, 9], [6, 9], [-3, 10], [3, 10]]) add(x, z, Math.PI, 'stand', 'drink', x < 0 ? -1 : 1);
  for (const x of [-14, -6, 6, 14]) add(x, -12.5, Math.PI, 'stand', null, x < 0 ? -1 : 1);
  return spots;
}

// Pavements people wander along: main street and both sides of the Strip.
const WALKWAYS = [
  [[-8, 70], [-8, 205]], [[8, 70], [8, 205]],
  [[STRIP.x0 + 2, STRIP.z0 - 2], [STRIP.x1 - 2, STRIP.z0 - 2]],
  [[STRIP.x0 + 2, STRIP.z1 + 2], [STRIP.x1 - 2, STRIP.z1 + 2]],
  [[-60, 64], [60, 64]],
];

export class Crowd {
  constructor(npcs) {
    this.npcs = npcs;
    this.spots = casinoSpots();
    this.state = new Map();      // id -> last event key, so each event is sent to the view once
    this.acc = 1;
  }

  /** How busy the casino is at this in-game hour: quiet mornings, packed nights. */
  static busy(hour) {
    if (hour < 6) return 0.8;
    if (hour < 12) return 0.35;
    if (hour < 18) return 0.55;
    return 0.95;
  }

  update(dt, serverNow, hour) {
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.acc = 0;
    const T = serverNow / 1000;
    for (let i = 0; i < PATRONS; i++) this._patron(i, T, hour);
    for (let i = 0; i < WALKERS; i++) this._walker(i, T, hour);
  }

  _emit(id, key, ev) {
    if (this.state.get(id) === key) return;
    this.state.set(id, key);
    this.npcs.onEvent({ id, speed: WALK, ...ev });
  }

  /** A regular: comes in, plays a spot for a few minutes, goes home, comes back later. */
  _patron(i, T, hour) {
    const period = 170 + (hash(i, 1) % 140);
    const phase = hash(i, 2) % period;
    const c = Math.floor((T + phase) / period);
    const start = c * period - phase;
    const r = rng(i, c);
    const id = `cz${i}-${c}`;
    const prev = `cz${i}-${c - 1}`;
    // Only this patron's own spots, so two regulars never share a stool.
    const mine = this.spots.filter((_, k) => k % PATRONS === i);
    if (!mine.length) return;
    const spot = mine[Math.floor(r() * mine.length)];
    const look = randomLook(r, r() < 0.3 ? 'suit' : undefined);
    const comes = r() < Crowd.busy(hour);
    const len = pathLen(spot.route);
    const walk = len / WALK;
    const leaveAt = start + period - walk - 4;
    if (this.state.has(prev)) { this.npcs.remove(prev); this.state.delete(prev); }
    if (!comes) return;
    const t = T - start;
    if (T < leaveAt) {
      // Now and then a win (cheer) or a loss (a groan and a long face).
      const beat = Math.floor(T / 6);
      const mood = hash(i, beat) % 11;
      const pose = t > walk && spot.pose === 'play' && mood === 0 ? 'cheer' : spot.pose;
      const say = t > walk && mood === 0 ? '🎉' : t > walk && mood === 1 ? '😩' : '';
      this._emit(id, `in:${pose}:${say}`, { look, path: spot.route, t0: start * 1000, pose, face: spot.face, prop: spot.prop, say });
    } else {
      this._emit(id, 'out', { look, path: [...spot.route].reverse(), t0: leaveAt * 1000, pose: 'walk', bye: true, prop: spot.prop });
    }
  }

  /** Somebody out for a stroll, one end of a pavement to the other. */
  _walker(i, T, hour) {
    const period = 120 + (hash(i, 7) % 90);
    const phase = hash(i, 8) % period;
    const c = Math.floor((T + phase) / period);
    const start = c * period - phase;
    const r = rng(i + 100, c);
    const id = `st${i}-${c}`;
    const prev = `st${i}-${c - 1}`;
    if (this.state.has(prev)) { this.npcs.remove(prev); this.state.delete(prev); }
    // Fewer people about in the small hours.
    if (r() > (hour < 6 || hour > 23 ? 0.25 : 0.85)) return;
    const w = WALKWAYS[Math.floor(r() * WALKWAYS.length)];
    const [a, b] = r() < 0.5 ? [w[0], w[1]] : [w[1], w[0]];
    const k0 = r() * 0.4;
    const k1 = 0.6 + r() * 0.4;
    const p0 = [a[0] + (b[0] - a[0]) * k0, a[1] + (b[1] - a[1]) * k0];
    const p1 = [a[0] + (b[0] - a[0]) * k1, a[1] + (b[1] - a[1]) * k1];
    // Some of them are the town's regulars: the pizza guy, a patrol cop, a biker...
    const cast = r() < 0.4 ? pickCast(['civilian', 'law', 'tough'], r) : null;
    const look = cast ? { cast } : randomLook(r, r() < 0.3 ? 'tourist' : undefined);
    if ((T - start) * WALK > Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + 1) return;
    this._emit(id, 'walk', { look, path: [p0, p1], t0: start * 1000, pose: 'walk', bye: true, prop: !cast && r() < 0.3 ? 'bag' : null });
  }
}

function pathLen(path) {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return d;
}
