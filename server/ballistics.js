// Bullets: rays, spheres, spread, and where something was a moment ago.
// Shared by everything that shoots or gets shot (boars, gangs, players).
import { rnd } from './rng.js';

/** Distance along a unit ray to a sphere, or null. */
export function raySphere(o, d, c, r) {
  const ox = o[0] - c[0];
  const oy = o[1] - c[1];
  const oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** A direction knocked off `d` by up to `spread` radians (a cone, evenly). */
export function spreadDir(d, spread) {
  if (!spread) return d;
  const a = rnd() * Math.PI * 2;
  const r = Math.sqrt(rnd()) * spread;
  // Any two vectors perpendicular to d.
  const up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(d, up));
  const v = cross(d, u);
  return norm([
    d[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r,
    d[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * r,
    d[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * r,
  ]);
}

/**
 * A short trail of where something has been ([time, x, z, yaw] entries), so
 * a shot can be judged against what the shooter actually saw.
 */
export class History {
  constructor(max = 10) { this.max = max; this.list = []; }

  push(t, x, z, yaw) {
    this.list.push([t, x, z, yaw]);
    if (this.list.length > this.max) this.list.shift();
  }

  /** [x, z, yaw] at time t, or null with no history. */
  at(t) { return poseAt(this.list, t); }
}

/** Where something stood at time `t`, from a trail; null if the trail is empty. */
export function poseAt(h, t) {
  if (!h || !h.length) return null;
  if (t <= h[0][0]) return [h[0][1], h[0][2], h[0][3]];
  for (let i = h.length - 1; i > 0; i--) {
    const a = h[i - 1];
    const c = h[i];
    if (t >= a[0]) {
      const k = c[0] > a[0] ? Math.min(1, (t - a[0]) / (c[0] - a[0])) : 1;
      return [a[1] + (c[1] - a[1]) * k, a[2] + (c[2] - a[2]) * k, c[3]];
    }
  }
  const last = h[h.length - 1];
  return [last[1], last[2], last[3]];
}
