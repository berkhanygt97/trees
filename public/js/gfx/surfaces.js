import * as THREE from 'three';

// Surfaces that react to light: every ground, wall and roof texture is
// generated as a set, a colour map, a normal map (from a height field, so
// mortar sits back from bricks, paving joints are grooves, cracks are cuts)
// and a roughness map (oil stains and glass shine, mortar and dirt do not).
// Everything tiles seamlessly and is seeded, so every machine makes the same.
//
// The pattern (height, roughness, shading) depends only on the kind of
// surface and is made once; the colour map is made per colour from it. So
// ten brick colours share one normal map and one roughness map.
//
// A surface: surface(kind, base) -> { map, normalMap, roughnessMap,
// normalScale, metal }. textures.js hands out the colour map as before and
// materials.js finds the rest from it (surfaceFor).

// ------------------------------------------------------------ helpers

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Tileable value-noise fbm over a square of `n` pixels. Returns Float32Array 0..1. */
function fbm(n, rnd, { period = 4, octaves = 5, gain = 0.5, stretch = [1, 1] } = {}) {
  const out = new Float32Array(n * n);
  let amp = 1;
  let total = 0;
  let p = period;
  for (let o = 0; o < octaves; o++) {
    const px = Math.max(1, Math.round(p * stretch[0]));
    const py = Math.max(1, Math.round(p * stretch[1]));
    const lat = new Float32Array(px * py);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    for (let y = 0; y < n; y++) {
      const fy = (y / n) * py;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % py) * px;
      const r1 = ((y0 + 1) % py) * px;
      for (let x = 0; x < n; x++) {
        const fx = (x / n) * px;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % px;
        const c1 = (x0 + 1) % px;
        const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * sx;
        const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * sx;
        out[y * n + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= gain;
    p *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

const wrap = (v, n) => ((v % n) + n) % n;

/** A soft round blob stamped (wrapping at the edges): fn(index, falloff 0..1). */
function blob(n, cx, cy, rx, ry, fn) {
  const x0 = Math.floor(cx - rx);
  const x1 = Math.ceil(cx + rx);
  const y0 = Math.floor(cy - ry);
  const y1 = Math.ceil(cy + ry);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d >= 1) continue;
      fn(wrap(y, n) * n + wrap(x, n), 1 - Math.sqrt(d));
    }
  }
}

/** A wandering line (a crack), `w` pixels wide: fn(index, strength 0..1). */
function crack(n, rnd, x, y, steps, len, w, fn) {
  let a = rnd() * Math.PI * 2;
  for (let s = 0; s < steps; s++) {
    a += (rnd() - 0.5) * 1.2;
    const nx = x + Math.cos(a) * len;
    const ny = y + Math.sin(a) * len;
    const k = Math.max(1, Math.ceil(len));
    for (let i = 0; i <= k; i++) {
      const px = x + ((nx - x) * i) / k;
      const py = y + ((ny - y) * i) / k;
      blob(n, px, py, w, w, fn);
    }
    x = nx;
    y = ny;
    w = Math.max(0.6, w * (0.93 + rnd() * 0.05));
  }
}

// ------------------------------------------------------------ patterns
//
// Each pattern fills, for an n x n tile (y down, like a canvas):
//   height 0..1, rough 0..1, tone (multiplies the base colour), and
//   optional masks that paint another colour over the base.

const PATTERNS = {
  asphalt(n, rnd) {
    const P = base(n, 0.85, 0.9);
    const big = fbm(n, rnd, { period: 3, octaves: 3 });
    const grit = fbm(n, rnd, { period: 96, octaves: 2 });
    for (let i = 0; i < n * n; i++) {
      P.tone[i] = 0.9 + (big[i] - 0.5) * 0.22 + (grit[i] - 0.5) * 0.35;
      P.height[i] = 0.5 + (grit[i] - 0.5) * 0.35;
      P.rough[i] = 0.9 - (grit[i] - 0.5) * 0.12;
    }
    // Aggregate: small stones in the tar, catching the light.
    for (let s = 0; s < n * n * 0.012; s++) {
      const t = 0.85 + rnd() * 0.7;
      blob(n, rnd() * n, rnd() * n, 0.8 + rnd() * 1.6, 0.8 + rnd() * 1.6, (i, f) => {
        P.height[i] += f * 0.35; P.tone[i] = P.tone[i] * (1 - f) + t * f; P.rough[i] -= f * 0.12;
      });
    }
    // Patched repairs: a different shade, slightly proud, with a seam.
    for (let p = 0; p < 4; p++) {
      const w = n * (0.08 + rnd() * 0.18);
      const h = n * (0.06 + rnd() * 0.12);
      const x0 = rnd() * n;
      const y0 = rnd() * n;
      const t = rnd() < 0.5 ? 0.78 : 1.18;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = wrap(Math.floor(y0 + y), n) * n + wrap(Math.floor(x0 + x), n);
          const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
          if (edge < 1.5) { P.height[i] -= 0.25; P.tone[i] *= 0.7; continue; }
          P.tone[i] *= t;
          P.height[i] += 0.04;
        }
      }
    }
    // Cracks, dark and deep.
    for (let c = 0; c < 5; c++) {
      crack(n, rnd, rnd() * n, rnd() * n, 10, n * 0.016, 1.3, (i, f) => {
        P.height[i] -= f * 0.45; P.tone[i] *= 1 - f * 0.35; P.rough[i] = Math.max(P.rough[i], 0.95);
      });
    }
    // Oil drips: dark and shiny.
    for (let o = 0; o < 5; o++) {
      const r = n * (0.02 + rnd() * 0.03);
      blob(n, rnd() * n, rnd() * n, r, r * (0.5 + rnd() * 0.6), (i, f) => {
        const k = Math.min(1, f * 1.8);
        P.tone[i] *= 1 - k * 0.3;
      });
    }
    return P;
  },

  paving(n, rnd) {
    // 1 m slabs on a 4 m tile, every other row offset by half a slab.
    const P = base(n, 0.8, 1);
    const cell = n / 4;
    const joint = Math.max(2, n / 128);
    const noise = fbm(n, rnd, { period: 16, octaves: 3 });
    const grain = fbm(n, rnd, { period: 128, octaves: 2 });
    const slabTone = Array.from({ length: 64 }, () => 0.88 + rnd() * 0.22);
    for (let y = 0; y < n; y++) {
      const row = Math.floor(y / cell);
      const off = row % 2 ? cell / 2 : 0;
      const ly = y - row * cell;
      for (let x = 0; x < n; x++) {
        const xx = wrap(x + off, n);
        const col = Math.floor(xx / cell);
        const lx = xx - col * cell;
        const d = Math.min(lx, ly, cell - 1 - lx, cell - 1 - ly);
        const i = y * n + x;
        const bevel = Math.min(1, Math.max(0, (d - joint) / joint));
        P.height[i] = 0.3 + 0.7 * bevel + (noise[i] - 0.5) * 0.08 * bevel;
        P.tone[i] = (d < joint ? 0.6 : slabTone[(row * 7 + col) % 64]) * (0.94 + (grain[i] - 0.5) * 0.3);
        P.rough[i] = d < joint ? 0.97 : 0.78 + (noise[i] - 0.5) * 0.15;
      }
    }
    return P;
  },

  brick(n, rnd) {
    // 8 courses a tile, running bond, recessed mortar.
    const P = base(n, 0.86, 1);
    P.masks.mortar = new Float32Array(n * n);
    const rows = 8;
    const rh = n / rows;
    const bw = rh * 2;
    const gap = Math.max(2, n / 96);
    const noise = fbm(n, rnd, { period: 32, octaves: 3 });
    const tones = Array.from({ length: 256 }, () => 0.78 + rnd() * 0.3);
    for (let y = 0; y < n; y++) {
      const row = Math.floor(y / rh);
      const off = row % 2 ? bw / 2 : 0;
      const ly = y - row * rh;
      for (let x = 0; x < n; x++) {
        const xx = wrap(x + off, n);
        const col = Math.floor(xx / bw);
        const lx = xx - col * bw;
        const d = Math.min(lx, ly, bw - 1 - lx, rh - 1 - ly);
        const i = y * n + x;
        if (d < gap) {
          P.mortar(i, 1);
          P.height[i] = 0.2 + noise[i] * 0.1;
          P.rough[i] = 0.97;
          P.tone[i] = 0.9 + (noise[i] - 0.5) * 0.2;
        } else {
          const bevel = Math.min(1, (d - gap) / (gap * 1.2));
          P.height[i] = 0.55 + 0.45 * bevel + (noise[i] - 0.5) * 0.12;
          P.tone[i] = tones[(row * 13 + col) % 256] * (0.9 + noise[i] * 0.2);
          P.rough[i] = 0.84 + (noise[i] - 0.5) * 0.1;
        }
      }
    }
    // Chips and pits.
    for (let s = 0; s < n * 0.6; s++) {
      blob(n, rnd() * n, rnd() * n, 1 + rnd() * 2.5, 1 + rnd() * 2, (i, f) => { P.height[i] -= f * 0.25; P.tone[i] *= 1 - f * 0.15; });
    }
    return P;
  },

  plank(n, rnd) {
    // Vertical boards with grain running along them.
    const P = base(n, 0.72, 1);
    const boards = 8;
    const bw = n / boards;
    const seam = Math.max(2, n / 128);
    const grain = fbm(n, rnd, { period: 2, octaves: 5, stretch: [8, 0.5] });
    const fine = fbm(n, rnd, { period: 64, octaves: 2, stretch: [2, 0.25] });
    const tones = Array.from({ length: boards }, () => 0.82 + rnd() * 0.3);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const b = Math.floor(x / bw);
        const lx = x - b * bw;
        const d = Math.min(lx, bw - 1 - lx);
        const i = y * n + x;
        const g = Math.sin((grain[i] * 18 + x * 0.02) * Math.PI);
        if (d < seam) {
          P.height[i] = 0.1; P.tone[i] = 0.45; P.rough[i] = 0.95;
        } else {
          P.height[i] = 0.7 + g * 0.05 + fine[i] * 0.08;
          P.tone[i] = tones[b] * (0.9 + g * 0.08 + (fine[i] - 0.5) * 0.2);
          P.rough[i] = 0.7 + (fine[i] - 0.5) * 0.2;
        }
      }
    }
    // Knots.
    for (let k = 0; k < 6; k++) {
      blob(n, rnd() * n, rnd() * n, n * 0.012, n * 0.024, (i, f) => { P.tone[i] *= 1 - f * 0.4; P.height[i] -= f * 0.08; });
    }
    return P;
  },

  plaster(n, rnd) {
    const P = base(n, 0.9, 1);
    const bump = fbm(n, rnd, { period: 24, octaves: 4, gain: 0.55 });
    const blot = fbm(n, rnd, { period: 3, octaves: 3 });
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        P.height[i] = bump[i];
        P.tone[i] = 0.94 + (blot[i] - 0.5) * 0.14 + (bump[i] - 0.5) * 0.06;
        P.rough[i] = 0.88 + (bump[i] - 0.5) * 0.1;
        // Grime and splash-back near the ground (the bottom of the tile).
        const up = (n - 1 - y) / n;
        if (up < 0.16) P.tone[i] *= 0.8 + up * 1.25 * (0.9 + blot[i] * 0.2);
      }
    }
    return P;
  },

  rooftile(n, rnd) {
    // Overlapping rows: each course rises to its bottom edge, then drops.
    const P = base(n, 0.72, 1);
    const rows = 8;
    const rh = n / rows;
    const tw = rh;
    const noise = fbm(n, rnd, { period: 32, octaves: 3 });
    const tones = Array.from({ length: 128 }, () => 0.82 + rnd() * 0.28);
    for (let y = 0; y < n; y++) {
      const row = Math.floor(y / rh);
      const ly = (y - row * rh) / rh;
      const off = row % 2 ? tw / 2 : 0;
      for (let x = 0; x < n; x++) {
        const xx = wrap(x + off, n);
        const col = Math.floor(xx / tw);
        const lx = (xx - col * tw) / tw;
        const i = y * n + x;
        // Curved (barrel) tiles across, rising towards the lip.
        const across = Math.sin(lx * Math.PI);
        P.height[i] = 0.25 + ly * 0.55 + across * 0.2 + (noise[i] - 0.5) * 0.05;
        const lip = ly > 0.88;
        P.tone[i] = tones[(row * 11 + col) % 128] * (lip ? 0.55 : 0.85 + across * 0.2) * (0.92 + noise[i] * 0.16);
        P.rough[i] = 0.68 + (noise[i] - 0.5) * 0.2;
      }
    }
    return P;
  },

  metal(n, rnd) {
    // Corrugated sheet, galvanised, streaked with rust from the top.
    const P = base(n, 0.42, 1);
    P.metal = new Float32Array(n * n).fill(0.85);
    P.masks.rust = new Float32Array(n * n);
    const period = n / 16;
    const noise = fbm(n, rnd, { period: 16, octaves: 4 });
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        P.height[i] = 0.5 + 0.5 * Math.sin((x / period) * Math.PI * 2);
        P.tone[i] = 0.9 + (noise[i] - 0.5) * 0.25;
        P.rough[i] = 0.38 + (noise[i] - 0.5) * 0.2;
      }
    }
    for (let s = 0; s < 14; s++) {
      const x0 = rnd() * n;
      const len = n * (0.15 + rnd() * 0.5);
      const w = 1.5 + rnd() * 4;
      for (let y = 0; y < len; y++) {
        const f = 1 - y / len;
        blob(n, x0 + Math.sin(y * 0.05) * 2, y, w, 1.5, (i, k) => {
          const r = Math.min(1, k * f * (0.6 + noise[i]));
          P.mask('rust', i, r);
          P.rough[i] = P.rough[i] * (1 - r) + 0.9 * r;
          P.metal[i] = P.metal[i] * (1 - r);
        });
      }
    }
    return P;
  },

  gravel(n, rnd) {
    const P = base(n, 0.92, 0.6);
    const noise = fbm(n, rnd, { period: 8, octaves: 3 });
    for (let i = 0; i < n * n; i++) { P.height[i] = 0.3 + noise[i] * 0.1; P.tone[i] = 0.75 + noise[i] * 0.2; }
    for (let s = 0; s < n * n * 0.03; s++) {
      const t = 0.7 + rnd() * 0.6;
      const r = 1.2 + rnd() * 2.6;
      blob(n, rnd() * n, rnd() * n, r, r * (0.7 + rnd() * 0.5), (i, f) => {
        const h = 0.3 + Math.sqrt(f) * 0.6;
        if (h > P.height[i]) { P.height[i] = h; P.tone[i] = t * (0.8 + f * 0.3); P.rough[i] = 0.8; }
      });
    }
    return P;
  },

  dirt(n, rnd) {
    const P = base(n, 0.95, 1);
    const big = fbm(n, rnd, { period: 4, octaves: 4 });
    const fine = fbm(n, rnd, { period: 64, octaves: 2 });
    for (let i = 0; i < n * n; i++) {
      P.height[i] = big[i] * 0.6 + fine[i] * 0.4;
      P.tone[i] = 0.82 + (big[i] - 0.5) * 0.4 + (fine[i] - 0.5) * 0.3;
    }
    for (let s = 0; s < n * n * 0.004; s++) {
      const t = 0.8 + rnd() * 0.6;
      const r = 1 + rnd() * 2.2;
      blob(n, rnd() * n, rnd() * n, r, r, (i, f) => { P.height[i] += f * 0.4; P.tone[i] = P.tone[i] * (1 - f) + t * f; });
    }
    return P;
  },

  terrain(n, rnd) {
    // Neutral ground detail: the terrain's vertex colours give the colour.
    const P = base(n, 0.95, 1);
    const big = fbm(n, rnd, { period: 6, octaves: 4 });
    const fine = fbm(n, rnd, { period: 96, octaves: 2 });
    for (let i = 0; i < n * n; i++) {
      P.height[i] = big[i] * 0.5 + fine[i] * 0.5;
      P.tone[i] = 0.84 + (big[i] - 0.5) * 0.3 + (fine[i] - 0.5) * 0.35;
    }
    // Blades and twigs: short light and dark strokes.
    for (let s = 0; s < n * n * 0.01; s++) {
      const x = rnd() * n;
      const y = rnd() * n;
      const t = rnd() < 0.5 ? 1.2 : 0.7;
      const len = 2 + rnd() * 4;
      for (let k = 0; k < len; k++) {
        const i = wrap(Math.floor(y - k), n) * n + wrap(Math.floor(x + (rnd() - 0.5)), n);
        P.tone[i] = t; P.height[i] += 0.2;
      }
    }
    return P;
  },

  grass(n, rnd) {
    // Short turf: dense light and dark blades, clumps, a little bare earth.
    const P = base(n, 0.9, 1);
    const clump = fbm(n, rnd, { period: 6, octaves: 4 });
    const fine = fbm(n, rnd, { period: 128, octaves: 2 });
    for (let i = 0; i < n * n; i++) {
      P.height[i] = clump[i] * 0.5 + fine[i] * 0.3;
      P.tone[i] = 0.8 + (clump[i] - 0.5) * 0.35 + (fine[i] - 0.5) * 0.3;
    }
    for (let s = 0; s < n * n * 0.05; s++) {
      const x = rnd() * n;
      const y = rnd() * n;
      const t = 0.65 + rnd() * 0.65;
      const len = 3 + rnd() * 6;
      const lean = (rnd() - 0.5) * 0.8;
      for (let k = 0; k < len; k++) {
        const i = wrap(Math.floor(y - k), n) * n + wrap(Math.floor(x + lean * k), n);
        const f = 1 - k / len;
        P.tone[i] = t * (0.85 + f * 0.3);
        P.height[i] = Math.max(P.height[i], 0.5 + f * 0.5);
        P.rough[i] = 0.8;
      }
    }
    return P;
  },

  rock(n, rnd) {
    // Weathered stone: big planes and cracks, lichen-dark patches.
    const P = base(n, 0.85, 1);
    const big = fbm(n, rnd, { period: 3, octaves: 6, gain: 0.55 });
    const mid = fbm(n, rnd, { period: 12, octaves: 4 });
    for (let i = 0; i < n * n; i++) {
      // Ridged: sharp creases between smooth faces.
      const r = 1 - Math.abs(big[i] * 2 - 1);
      P.height[i] = r * 0.7 + mid[i] * 0.3;
      P.tone[i] = 0.72 + big[i] * 0.4 + (mid[i] - 0.5) * 0.25;
      P.rough[i] = 0.78 + (mid[i] - 0.5) * 0.2;
    }
    for (let c = 0; c < 10; c++) {
      crack(n, rnd, rnd() * n, rnd() * n, 10, n * 0.02, 1.8, (i, f) => { P.height[i] -= f * 0.4; P.tone[i] *= 1 - f * 0.5; });
    }
    return P;
  },

  sand(n, rnd) {
    // Dry, fine, with wind ripples.
    const P = base(n, 0.97, 1);
    const big = fbm(n, rnd, { period: 4, octaves: 3 });
    const grain = fbm(n, rnd, { period: 128, octaves: 2 });
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const ripple = Math.sin((y / n) * Math.PI * 2 * 14 + big[i] * 6);
        P.height[i] = 0.5 + ripple * 0.12 + grain[i] * 0.3;
        P.tone[i] = 0.9 + (big[i] - 0.5) * 0.2 + (grain[i] - 0.5) * 0.25 + ripple * 0.03;
      }
    }
    return P;
  },

  water(n, rnd) {
    // Little wind ripples on still water.
    const P = base(n, 0.05, 1);
    const a = fbm(n, rnd, { period: 6, octaves: 4 });
    const b = fbm(n, rnd, { period: 16, octaves: 3 });
    for (let i = 0; i < n * n; i++) P.height[i] = a[i] * 0.6 + b[i] * 0.4;
    return P;
  },

  soil(n, rnd) {
    // Plowed furrows across the tile.
    const P = base(n, 0.96, 1);
    const noise = fbm(n, rnd, { period: 16, octaves: 3 });
    const period = n / 8;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const f = 0.5 + 0.5 * Math.sin((y / period) * Math.PI * 2);
        P.height[i] = f * 0.8 + noise[i] * 0.2;
        P.tone[i] = 0.72 + f * 0.3 + (noise[i] - 0.5) * 0.2;
      }
    }
    return P;
  },
};

function base(n, rough, tone) {
  const P = {
    n,
    height: new Float32Array(n * n).fill(0.5),
    rough: new Float32Array(n * n).fill(rough),
    tone: new Float32Array(n * n).fill(tone),
    metal: null,
    masks: {},
  };
  P.mask = (name, i, v) => { P.masks[name][i] = Math.max(P.masks[name][i], v); };
  P.mortar = (i, v) => P.mask('mortar', i, v);
  return P;
}

// How strongly each pattern's height bends the light, and the texture size.
const SPEC = {
  asphalt: { size: 1024, bump: 2.2 },
  paving: { size: 512, bump: 3.5 },
  brick: { size: 512, bump: 4 },
  plank: { size: 512, bump: 3 },
  plaster: { size: 512, bump: 1.8 },
  rooftile: { size: 512, bump: 5 },
  metal: { size: 512, bump: 4 },
  gravel: { size: 512, bump: 3 },
  dirt: { size: 512, bump: 2.5 },
  terrain: { size: 512, bump: 1.6 },
  soil: { size: 256, bump: 3 },
  grass: { size: 512, bump: 2 },
  rock: { size: 512, bump: 3.5 },
  sand: { size: 512, bump: 1.6 },
  water: { size: 256, bump: 1.4 },
};

// Photo textures (gfx/photo.js) cover some real size; the game tiles each
// kind of surface over this many metres, so a photo is repeated to fit.
// `tint`: recolour the photo to the colour asked for (brick, plaster...).
export const PHOTO_KINDS = {
  asphalt: { metres: 6, tint: false },
  paving: { metres: 4, tint: false },
  brick: { metres: 3.5, tint: true },
  plank: { metres: 2, tint: true },
  plaster: { metres: 3, tint: true },
  rooftile: { metres: 3, tint: true },
  metal: { metres: 2, tint: true },
  gravel: { metres: 4, tint: false },
  dirt: { metres: 6, tint: false },
  soil: { metres: 2, tint: false },
  grass: { metres: 6, tint: false },
  rock: { metres: 6, tint: false },
  sand: { metres: 6, tint: false },
};
const photos = new Map();          // kind -> { color, normal, rough, metres } (images)

/** Photo textures to use instead of the generated ones (from gfx/photo.js). */
export function usePhotos(kind, set) { if (PHOTO_KINDS[kind]) photos.set(kind, set); }
export function hasPhotos(kind) { return photos.has(kind); }

// The colours painted over the base by a pattern's masks.
const MASK_COLORS = { mortar: [0.72, 0.68, 0.6], rust: [0.42, 0.2, 0.08] };

// ------------------------------------------------------------ building

const patterns = new Map();      // kind -> { P, normalMap, roughnessMap }
const surfaces = new Map();      // kind|base -> surface
const bySource = new WeakMap();  // colour map's source -> surface

function dataTexture(data, n, srgb, h = n) {
  const t = new THREE.DataTexture(data, n, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Row y of the pattern (canvas orientation) lands in row n-1-y of the texture (v up). */
function patternFor(kind) {
  let entry = patterns.get(kind);
  if (entry) return entry;
  const spec = SPEC[kind];
  const n = spec.size;
  const P = PATTERNS[kind](n, mulberry(hashStr(kind)));
  const nor = new Uint8Array(n * n * 4);
  const rgh = new Uint8Array(n * n * 4);
  const s = spec.bump;
  const H = (x, y) => P.height[wrap(y, n) * n + wrap(x, n)];
  for (let y = 0; y < n; y++) {
    const ty = n - 1 - y;
    for (let x = 0; x < n; x++) {
      // Height rises with canvas y going down = texture v going down.
      const dx = (H(x + 1, y) - H(x - 1, y)) * 0.5 * s;
      const dv = -(H(x, y + 1) - H(x, y - 1)) * 0.5 * s;
      const nx = -dx;
      const ny = -dv;
      const l = Math.hypot(nx, ny, 1);
      const o = (ty * n + x) * 4;
      nor[o] = ((nx / l) * 0.5 + 0.5) * 255;
      nor[o + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      nor[o + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      nor[o + 3] = 255;
      const i = y * n + x;
      rgh[o] = 255;
      rgh[o + 1] = Math.max(0, Math.min(1, P.rough[i])) * 255;
      rgh[o + 2] = P.metal ? Math.max(0, Math.min(1, P.metal[i])) * 255 : 0;
      rgh[o + 3] = 255;
    }
  }
  entry = {
    P,
    normalMap: dataTexture(nor, n, false),
    roughnessMap: dataTexture(rgh, n, false),
  };
  patterns.set(kind, entry);
  return entry;
}

function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function linearToSrgb(c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055; }

/** The full set for a kind of surface in a base colour (hex string). */
export function surface(kind, baseHex = '#808080') {
  const key = `${kind}|${baseHex}`;
  let s = surfaces.get(key);
  if (s) return s;
  if (photos.has(kind)) {
    s = photoSurface(kind, baseHex);
    surfaces.set(key, s);
    bySource.set(s.map.source, s);
    return s;
  }
  const pat = patternFor(kind);
  const { P } = pat;
  const n = P.n;
  const c = new THREE.Color(baseHex);
  // Tone scales the colour in linear light, so shading looks natural.
  const lin = [srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b)];
  const masks = Object.entries(P.masks).map(([name, m]) => [m, MASK_COLORS[name].map(srgbToLinear)]);
  const out = new Uint8Array(n * n * 4);
  const avg = [0, 0, 0];
  for (let y = 0; y < n; y++) {
    const ty = n - 1 - y;
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const t = P.tone[i];
      let r = lin[0] * t;
      let g = lin[1] * t;
      let b = lin[2] * t;
      for (const [m, mc] of masks) {
        const k = m[i];
        if (k > 0) { r += (mc[0] * t - r) * k; g += (mc[1] * t - g) * k; b += (mc[2] * t - b) * k; }
      }
      const o = (ty * n + x) * 4;
      out[o] = Math.min(1, linearToSrgb(r)) * 255;
      out[o + 1] = Math.min(1, linearToSrgb(g)) * 255;
      out[o + 2] = Math.min(1, linearToSrgb(b)) * 255;
      out[o + 3] = 255;
      avg[0] += r; avg[1] += g; avg[2] += b;
    }
  }
  const map = dataTexture(out, n, true);
  s = {
    map,
    normalMap: pat.normalMap,
    roughnessMap: pat.roughnessMap,
    metal: !!P.metal,
    normalScale: 1,
    // Average colour in linear light (the terrain tints grass by it).
    avg: new THREE.Color(avg[0] / (n * n), avg[1] / (n * n), avg[2] / (n * n)),
  };
  surfaces.set(key, s);
  bySource.set(map.source, s);
  return s;
}

// ------------------------------------------------------------ photos

const photoMaps = new Map();       // kind -> { normalMap, roughnessMap } shared by every colour

/** The photo repeated to cover the game's tile for this kind of surface, as a canvas. */
function tiledCanvas(img, kind, metres) {
  const reps = Math.max(1, Math.round(PHOTO_KINDS[kind].metres / Math.max(0.1, metres || 2)));
  const size = Math.min(2048, img.width * reps);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const step = size / reps;
  for (let y = 0; y < reps; y++) for (let x = 0; x < reps; x++) g.drawImage(img, x * step, y * step, step, step);
  return cv;
}

function canvasTexture(cv, srgb) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function photoSurface(kind, baseHex) {
  const set = photos.get(kind);
  let shared = photoMaps.get(kind);
  if (!shared) {
    const rough = tiledCanvas(set.rough, kind, set.metres);
    // Roughness is read from green; for metal, blue says "this is metal".
    if (kind === 'metal') {
      const g = rough.getContext('2d');
      const d = g.getImageData(0, 0, rough.width, rough.height);
      for (let i = 0; i < d.data.length; i += 4) d.data[i + 2] = 215;
      g.putImageData(d, 0, 0);
    }
    shared = {
      normalMap: canvasTexture(tiledCanvas(set.normal, kind, set.metres), false),
      roughnessMap: canvasTexture(rough, false),
    };
    photoMaps.set(kind, shared);
  }
  const cv = tiledCanvas(set.color, kind, set.metres);
  const g = cv.getContext('2d');
  const d = g.getImageData(0, 0, cv.width, cv.height);
  const px = d.data;
  const avg = [0, 0, 0];
  for (let i = 0; i < px.length; i += 4) {
    avg[0] += srgbToLinear(px[i] / 255); avg[1] += srgbToLinear(px[i + 1] / 255); avg[2] += srgbToLinear(px[i + 2] / 255);
  }
  const count = px.length / 4;
  for (let k = 0; k < 3; k++) avg[k] /= count;
  if (PHOTO_KINDS[kind].tint) {
    // Recolour: keep the photo's detail, move its average to the colour asked for.
    const c = new THREE.Color(baseHex);
    const want = [srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b)];
    const k = want.map((w, i) => w / Math.max(1e-4, avg[i]));
    for (let i = 0; i < px.length; i += 4) {
      for (let ch = 0; ch < 3; ch++) px[i + ch] = Math.min(1, linearToSrgb(srgbToLinear(px[i + ch] / 255) * k[ch])) * 255;
    }
    g.putImageData(d, 0, 0);
    for (let ch = 0; ch < 3; ch++) avg[ch] = want[ch];
  }
  return {
    map: canvasTexture(cv, true),
    normalMap: shared.normalMap,
    roughnessMap: shared.roughnessMap,
    metal: kind === 'metal',
    normalScale: 1,
    avg: new THREE.Color(avg[0], avg[1], avg[2]),
    photo: true,
  };
}

/** The normal and roughness maps that go with a colour map (or a clone of it), if any. */
export function surfaceFor(map) {
  return map && map.source ? bySource.get(map.source) || null : null;
}

/** Registers extra maps for a colour map made elsewhere (facades, shop fronts). */
export function registerSurface(map, s) { bySource.set(map.source, s); }

/**
 * Makes normal and roughness maps from explicit fields, w x h in canvas
 * orientation (for painted textures like facades and shop fronts).
 */
export function mapsFromFields(w, h, height, rough, bump = 4) {
  const nor = new Uint8Array(w * h * 4);
  const rgh = new Uint8Array(w * h * 4);
  const H = (x, y) => height[wrap(y, h) * w + wrap(x, w)];
  for (let y = 0; y < h; y++) {
    const ty = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * 0.5 * bump;
      const dv = -(H(x, y + 1) - H(x, y - 1)) * 0.5 * bump;
      const l = Math.hypot(dx, dv, 1);
      const o = (ty * w + x) * 4;
      nor[o] = ((-dx / l) * 0.5 + 0.5) * 255;
      nor[o + 1] = ((-dv / l) * 0.5 + 0.5) * 255;
      nor[o + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      nor[o + 3] = 255;
      rgh[o] = 255;
      rgh[o + 1] = Math.max(0, Math.min(1, rough[y * w + x])) * 255;
      rgh[o + 2] = 0;
      rgh[o + 3] = 255;
    }
  }
  return { normalMap: dataTexture(nor, w, false, h), roughnessMap: dataTexture(rgh, w, false, h), normalScale: 1, metal: false };
}
