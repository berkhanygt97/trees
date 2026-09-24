// The shape of the land. Downtown, the neighbourhoods and every road are
// flat; between them the ground rolls into San Andreas-style hills. Shared by
// the server and every client, and fully deterministic (no Math.random), so
// everyone stands on the same hill.
//
// Heights are worked out once on a 4 m grid and read back with bilinear
// sampling, so asking for the ground under your feet is cheap.

export const TERRAIN = {
  enabled: false,       // switched on once the ground mesh and physics follow it
  maxHeight: 22,        // the tallest hills, in metres
  rampIn: 60,           // metres over which the land rises away from anything flat
  cell: 4,              // grid spacing
  pad: 8,               // flat verge kept around every flat zone
};

let zones = [];
let bounds = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
let grid = null;
let cols = 0;
let rows = 0;

/** Called once by map.js with the world's flat areas and extent. */
export function configureTerrain(flatZones, worldBounds, margin = 300) {
  zones = flatZones;
  bounds = {
    minX: worldBounds.minX - margin, maxX: worldBounds.maxX + margin,
    minZ: worldBounds.minZ - margin, maxZ: worldBounds.maxZ + margin,
  };
  grid = null;
}

// ------------------------------------------------------------------ noise

function hash(i, j) {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x, z) {
  const i = Math.floor(x);
  const j = Math.floor(z);
  const fx = x - i;
  const fz = z - j;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * sx;
  const b = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * sx;
  return a + (b - a) * sz;
}

function fbm(x, z) {
  return vnoise(x / 180, z / 180) * 0.6 + vnoise(x / 70 + 13, z / 70 - 7) * 0.3 + vnoise(x / 25 - 31, z / 25 + 5) * 0.1;
}

/** Distance from (x, z) to the nearest flat zone (0 inside one). */
export function distToFlat(x, z) {
  let best = Infinity;
  for (const r of zones) {
    const dx = Math.max(r.x0 - TERRAIN.pad - x, 0, x - r.x1 - TERRAIN.pad);
    const dz = Math.max(r.z0 - TERRAIN.pad - z, 0, z - r.z1 - TERRAIN.pad);
    const d = Math.hypot(dx, dz);
    if (d < best) best = d;
    if (best === 0) return 0;
  }
  return best;
}

/** The land's height before ramps, worked out from scratch (slow; the grid caches it). */
export function rawTerrainHeight(x, z) {
  if (!TERRAIN.enabled) return 0;
  const d = distToFlat(x, z);
  if (d <= 0) return 0;
  const k = Math.min(1, d / TERRAIN.rampIn);
  const s = k * k * (3 - 2 * k);
  // Hills get taller towards the edge of the world.
  const edge = Math.max(0, Math.min(1, Math.max(
    (Math.abs(x) - 250) / 500,
    (Math.abs(z) - 200) / 300,
  )));
  return s * TERRAIN.maxHeight * (0.35 + 0.65 * edge) * (0.25 + fbm(x, z) * 1.1);
}

function build() {
  const c = TERRAIN.cell;
  cols = Math.ceil((bounds.maxX - bounds.minX) / c) + 1;
  rows = Math.ceil((bounds.maxZ - bounds.minZ) / c) + 1;
  grid = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) grid[j * cols + i] = rawTerrainHeight(bounds.minX + i * c, bounds.minZ + j * c);
  }
}

/** The land's height under (x, z). Zero on anything flat. */
export function terrainHeight(x, z) {
  if (!TERRAIN.enabled) return 0;
  if (!grid) build();
  const c = TERRAIN.cell;
  const gx = Math.max(0, Math.min(cols - 1.001, (x - bounds.minX) / c));
  const gz = Math.max(0, Math.min(rows - 1.001, (z - bounds.minZ) / c));
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const fx = gx - i;
  const fz = gz - j;
  const a = grid[j * cols + i] + (grid[j * cols + i + 1] - grid[j * cols + i]) * fx;
  const b = grid[(j + 1) * cols + i] + (grid[(j + 1) * cols + i + 1] - grid[(j + 1) * cols + i]) * fx;
  return a + (b - a) * fz;
}

/** The raw grid, for building the ground mesh and physics heightfield. */
export function terrainGrid() {
  if (!grid) build();
  return { grid, cols, rows, cell: TERRAIN.cell, minX: bounds.minX, minZ: bounds.minZ };
}
