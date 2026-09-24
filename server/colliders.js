// What bullets hit besides people: walls. Every building in the valley is a
// box with a height; a shot stops at the first one in its way, and a gang
// member only shoots at what they can actually see. Low things (farm fences,
// counters) stop a bullet only if it is fired low enough to meet them.
import { STATIC_BOXES, PLOTS, PAD_KEYS, LOT_BY_ID, padBox, restaurantBoxes } from '../shared/map.js';

const CELL = 32;
const PAD_H = { house: 6, bin: 1.2 };

export class Colliders {
  constructor(room) {
    this.room = room;
    this.staticGrid = gridOf(STATIC_BOXES);
    this.dynamicGrid = new Map();
    this.builtAt = -Infinity;
  }

  /** Farm buildings and restaurants come and go; rebuilt now and then. */
  _refresh() {
    const now = Date.now();
    if (now - this.builtAt < 3000) return;
    this.builtAt = now;
    const boxes = [];
    for (const p of this.room.profiles.values()) {
      if (p.plot >= 0 && PLOTS[p.plot]) {
        for (const pad of PAD_KEYS) {
          if (pad !== 'house' && pad !== 'bin' && !(p.buildings && p.buildings[pad])) continue;
          boxes.push({ ...padBox(PLOTS[p.plot], pad, 0.3, p.layout), h: PAD_H[pad] || 5 });
        }
      }
      for (const res of p.restaurants || []) {
        const lot = LOT_BY_ID.get(res.lot);
        if (!lot) continue;
        restaurantBoxes(lot).forEach((b, i) => boxes.push({ ...b, h: i === 5 ? 1.1 : 4.5 }));
      }
    }
    this.dynamicGrid = gridOf(boxes);
  }

  /**
   * How far along the ray (o + d * t, d a unit vector) the first wall is, up
   * to `maxT`; null if nothing is in the way.
   */
  segment(o, d, maxT) {
    this._refresh();
    const ex = o[0] + d[0] * maxT;
    const ez = o[2] + d[2] * maxT;
    let best = null;
    const seen = new Set();
    const i0 = Math.floor(Math.min(o[0], ex) / CELL);
    const i1 = Math.floor(Math.max(o[0], ex) / CELL);
    const j0 = Math.floor(Math.min(o[2], ez) / CELL);
    const j1 = Math.floor(Math.max(o[2], ez) / CELL);
    for (const grid of [this.staticGrid, this.dynamicGrid]) {
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const list = grid.get(`${i},${j}`);
          if (!list) continue;
          for (const b of list) {
            if (seen.has(b)) continue;
            seen.add(b);
            const t = rayBox(o, d, b);
            if (t != null && t <= maxT && (best == null || t < best)) best = t;
          }
        }
      }
    }
    return best;
  }

  /** Can someone at `a` see (and shoot) `b`? Both [x, y, z]. */
  los(a, b) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 0.01) return true;
    return this.segment(a, [d[0] / len, d[1] / len, d[2] / len], len - 0.3) == null;
  }

  /** Pushes a circle (a person) out of any wall; returns [x, z]. */
  pushOut(x, z, r = 0.35) {
    this._refresh();
    for (const grid of [this.staticGrid, this.dynamicGrid]) {
      const list = grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
      if (!list) continue;
      for (const b of list) {
        if ((b.h || 4) < 0.9) continue;
        const cx = Math.max(b.x0, Math.min(b.x1, x));
        const cz = Math.max(b.z0, Math.min(b.z1, z));
        const dx = x - cx;
        const dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          x = cx + (dx / d) * r;
          z = cz + (dz / d) * r;
        } else {
          // Inside: out through the nearest side.
          const opts = [[b.x0 - r - x, 0], [b.x1 + r - x, 0], [0, b.z0 - r - z], [0, b.z1 + r - z]];
          opts.sort((p, q) => Math.abs(p[0] + p[1]) - Math.abs(q[0] + q[1]));
          x += opts[0][0];
          z += opts[0][1];
        }
      }
    }
    return [x, z];
  }
}

function gridOf(boxes) {
  const grid = new Map();
  for (const b of boxes) {
    for (let i = Math.floor(b.x0 / CELL); i <= Math.floor(b.x1 / CELL); i++) {
      for (let j = Math.floor(b.z0 / CELL); j <= Math.floor(b.z1 / CELL); j++) {
        const k = `${i},${j}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(b);
      }
    }
  }
  return grid;
}

/** Where a ray first enters a box (from the ground up to its height), or null. */
export function rayBox(o, d, b) {
  let t0 = 0;
  let t1 = Infinity;
  const axes = [[o[0], d[0], b.x0, b.x1], [o[1], d[1], -2, b.h || 4], [o[2], d[2], b.z0, b.z1]];
  for (const [p, v, lo, hi] of axes) {
    if (Math.abs(v) < 1e-9) {
      if (p < lo || p > hi) return null;
      continue;
    }
    let a = (lo - p) / v;
    let c = (hi - p) / v;
    if (a > c) [a, c] = [c, a];
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return null;
  }
  // Starting inside a box (standing behind the counter) does not block.
  return t0 > 0 ? t0 : null;
}
