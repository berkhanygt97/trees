// The whole world outside the casino: town, farms, roads and the race track.
// Like STATIONS, this is the single source of truth — the server uses it to
// check where people are standing and the client builds the scenery from it.
//
// Axes: +x is east, +z is south. The casino sits at the origin with its front
// doors at z = +40, facing the town.

import { STATIONS as CASINO_STATIONS, ROOM } from './config.js';

export const BOUNDS = { minX: -265, maxX: 265, minZ: -250, maxZ: 250 };

// --------------------------------------------------------------- casino

export const CASINO = {
  ...ROOM,
  WALL: 1,
  // Two doorways either side of the bar, wide enough to drive a car through.
  DOORS: [[-14, -9], [9, 14]],
};

// Axis-aligned boxes nobody can walk or drive through: { x0, x1, z0, z1 }.
function casinoBoxes() {
  const { MIN_X, MAX_X, MIN_Z, MAX_Z, WALL } = CASINO;
  const boxes = [
    { x0: MIN_X - WALL, x1: MAX_X + WALL, z0: MIN_Z - WALL, z1: MIN_Z },   // back
    { x0: MIN_X - WALL, x1: MIN_X, z0: MIN_Z - WALL, z1: MAX_Z + WALL },   // west
    { x0: MAX_X, x1: MAX_X + WALL, z0: MIN_Z - WALL, z1: MAX_Z + WALL },   // east
    // The horse track at the back of the room stays off limits.
    { x0: MIN_X, x1: MAX_X, z0: MIN_Z, z1: ROOM.RAIL_Z },
  ];
  // Front wall, broken by the doorways.
  let x = MIN_X - WALL;
  for (const [a, b] of CASINO.DOORS) {
    boxes.push({ x0: x, x1: a, z0: MAX_Z, z1: MAX_Z + WALL });
    x = b;
  }
  boxes.push({ x0: x, x1: MAX_X + WALL, z0: MAX_Z, z1: MAX_Z + WALL });
  return boxes;
}

export const insideCasino = (x, z) =>
  x > CASINO.MIN_X && x < CASINO.MAX_X && z > CASINO.MIN_Z && z < CASINO.MAX_Z;

// ----------------------------------------------------------------- roads

// Flat rectangles drawn on the ground: { x0, x1, z0, z1, kind }.
export const PLAZA = { x0: -62, x1: 62, z0: 41, z1: 68 };
export const ROADS = [
  { x0: -6, x1: 6, z0: 41, z1: 222, kind: 'street' },           // main street
  { x0: -265, x1: 265, z0: 212, z1: 222, kind: 'road' },        // farm road
  { x0: -60, x1: -50, z0: -104, z1: 68, kind: 'road' },         // west loop to the track
  { x0: 50, x1: 60, z0: -104, z1: 68, kind: 'road' },           // east loop to the track
];

// ------------------------------------------------------------------ town

// Shops are three walls and a roof, open to the street, with a counter inside.
// `open` is the side facing the street.
export const SHOPS = [
  { id: 'farmshop',   name: 'Farm Supply',       sign: 'FARM SUPPLY',   sub: 'seeds · feed · charity',     color: '#6bd66b', x0: -36, x1: -12, z0: 76,  z1: 94,  open: 'east' },
  { id: 'market',     name: 'Market',            sign: 'MARKET',        sub: 'we buy what you grow',       color: '#f2c14e', x0: -36, x1: -12, z0: 104, z1: 124, open: 'east' },
  { id: 'animalshop', name: 'Animal Shop',       sign: 'CLUCK & MOO',   sub: 'coops · barns · livestock',  color: '#ff9f43', x0: -36, x1: -12, z0: 134, z1: 152, open: 'east' },
  { id: 'builder',    name: "Builder's Yard",    sign: 'BUILDERS',      sub: 'houses · mills · bakeries',  color: '#4dc3ff', x0: -36, x1: -12, z0: 162, z1: 180, open: 'east' },
  { id: 'cardealer',  name: 'Car Dealer',        sign: 'MOTORS',        sub: 'no refunds, ever',           color: '#ff5d5d', x0: 12,  x1: 42,  z0: 72,  z1: 100, open: 'west' },
  { id: 'machinery',  name: 'Machinery Dealer',  sign: 'TRACTOR BARN',  sub: 'tractors · implements',      color: '#e3c25a', x0: 12,  x1: 36,  z0: 108, z1: 130, open: 'west' },
  { id: 'landoffice', name: 'Land Office',       sign: 'LAND OFFICE',   sub: 'bigger fields, bigger dreams', color: '#c471e8', x0: 12, x1: 36,  z0: 140, z1: 156, open: 'west' },
];

const SHOP_WALL = 0.6;

function shopBoxes(s) {
  const t = SHOP_WALL;
  const out = [
    { x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z0 + t },   // north
    { x0: s.x0, x1: s.x1, z0: s.z1 - t, z1: s.z1 },   // south
  ];
  if (s.open === 'east') out.push({ x0: s.x0, x1: s.x0 + t, z0: s.z0, z1: s.z1 });
  else out.push({ x0: s.x1 - t, x1: s.x1, z0: s.z0, z1: s.z1 });
  return out;
}

/** Where the counter stands: a few metres inside the open front. */
export function shopCounter(s) {
  const cz = (s.z0 + s.z1) / 2;
  return s.open === 'east' ? [s.x1 - 5, 0, cz] : [s.x0 + 5, 0, cz];
}

export const ORDERS_BOARD = { pos: [-24, 0, 56], yaw: Math.PI / 2 };

// ----------------------------------------------------------------- plots

// Six farms, three either side of the main street, all with their gate on the
// farm road. Only 3–4 people play, so there is room for new names to turn up.
export const PLOT_SIZE = 70;
export const PLOTS = [-110, -185, -260, 40, 115, 190].map((x0, index) => ({ index, x0, z0: 140 }));

export const TILE = 2;
// The field grows north-east from the corner nearest the gate.
const FIELD_X = 4;          // local x of the field's west edge
const FIELD_Z = 66;         // local z of the field's south edge
export const GATE = [46, 58];

export function tileCenter(plot, i, j) {
  return [plot.x0 + FIELD_X + TILE * i + TILE / 2, plot.z0 + FIELD_Z - TILE * j - TILE / 2];
}

/** Tile coordinates under a world point, or null if it is off the field. */
export function tileAt(plot, x, z, size) {
  const i = Math.floor((x - plot.x0 - FIELD_X) / TILE);
  const j = Math.floor((plot.z0 + FIELD_Z - z) / TILE);
  if (i < 0 || j < 0 || i >= size || j >= size) return null;
  return [i, j];
}

export const tileIndex = (i, j) => j * 20 + i;

// Building pads on each plot, in plot-local coordinates. Every building faces
// south; its station sits on the doorstep.
export const PADS = {
  house:  { x: 58, z: 14, w: 16, d: 16 },
  coop:   { x: 10, z: 13, w: 10, d: 8 },
  barn:   { x: 25, z: 13, w: 13, d: 10 },
  mill:   { x: 39, z: 13, w: 8,  d: 8 },
  dairy:  { x: 64, z: 33, w: 10, d: 8 },
  bakery: { x: 64, z: 46, w: 10, d: 8 },
  bin:    { x: 64, z: 60, w: 2.4, d: 1.6 },
};

export function padWorld(plot, pad) {
  const p = PADS[pad];
  return { x: plot.x0 + p.x, z: plot.z0 + p.z, w: p.w, d: p.d };
}

export function plotContains(plot, x, z) {
  return x >= plot.x0 && x <= plot.x0 + PLOT_SIZE && z >= plot.z0 && z <= plot.z0 + PLOT_SIZE;
}

function fenceBoxes(plot) {
  const { x0, z0 } = plot;
  const S = PLOT_SIZE;
  const t = 0.25;
  return [
    { x0, x1: x0 + S, z0, z1: z0 + t },
    { x0, x1: x0 + t, z0, z1: z0 + S },
    { x0: x0 + S - t, x1: x0 + S, z0, z1: z0 + S },
    { x0, x1: x0 + GATE[0], z0: z0 + S - t, z1: z0 + S },
    { x0: x0 + GATE[1], x1: x0 + S, z0: z0 + S - t, z1: z0 + S },
  ];
}

/** Where a brand-new farmer is dropped: at their own gate, facing the field. */
export function plotSpawn(plot) {
  return { pos: [plot.x0 + (GATE[0] + GATE[1]) / 2, 0, plot.z0 + PLOT_SIZE + 6], yaw: 0 };
}

// ------------------------------------------------------------ race track

// A stadium-shaped circuit north of the casino. Always open, nobody keeps score.
export const TRACK = { cx: 0, cz: -160, half: 70, r: 50, width: 14 };

// Ramps: centred at (x, z), rising along `dir` (radians, 0 = +x) over `len`.
export const RAMPS = [
  { x: 0, z: TRACK.cz - TRACK.r, dir: 0, len: 12, width: 9, h: 2.4 },
  { x: 0, z: TRACK.cz + TRACK.r, dir: Math.PI, len: 12, width: 9, h: 2.4 },
  { x: TRACK.cx, z: TRACK.cz, dir: Math.PI / 2, len: 10, width: 8, h: 3.2 },
];

/** Height of the ground under (x, z). Flat everywhere except the ramps. */
export function groundHeight(x, z) {
  let h = 0;
  for (const r of RAMPS) {
    const dx = x - r.x;
    const dz = z - r.z;
    const c = Math.cos(r.dir);
    const s = Math.sin(r.dir);
    const u = dx * c + dz * s;       // along the ramp
    const v = -dx * s + dz * c;      // across it
    if (Math.abs(v) <= r.width / 2 && Math.abs(u) <= r.len / 2) {
      h = Math.max(h, r.h * (u + r.len / 2) / r.len);
    }
  }
  return h;
}

// -------------------------------------------------------------- stations

export const TOWN_STATIONS = [
  ...SHOPS.map((s) => ({
    id: s.id, game: s.id, name: s.name, pos: shopCounter(s),
    yaw: s.open === 'east' ? -Math.PI / 2 : Math.PI / 2, radius: 5, solid: 0,
  })),
  { id: 'orders', game: 'orders', name: 'Orders Board', pos: ORDERS_BOARD.pos, yaw: ORDERS_BOARD.yaw, radius: 4, solid: 0 },
];

/** Plot stations only work for the plot's owner, and only once built. */
export const PLOT_STATIONS = PLOTS.flatMap((plot) => ['house', 'coop', 'barn', 'mill', 'dairy', 'bakery', 'bin'].map((pad) => {
  const p = padWorld(plot, pad);
  const doorstep = pad === 'bin' ? 1.8 : p.d / 2 + 2;
  return {
    id: `p${plot.index}-${pad}`, game: pad === 'bin' ? 'bin' : pad, plot: plot.index, pad,
    name: pad === 'bin' ? 'Shipping Bin' : pad[0].toUpperCase() + pad.slice(1),
    pos: [p.x, 0, p.z + doorstep], yaw: 0, radius: pad === 'bin' ? 3 : 4, solid: 0,
  };
}));

export const ALL_STATIONS = [...CASINO_STATIONS, ...TOWN_STATIONS, ...PLOT_STATIONS];
export const STATION_BY_ID = new Map(ALL_STATIONS.map((s) => [s.id, s]));

// ------------------------------------------------------------- colliders

export const STATIC_BOXES = [
  ...casinoBoxes(),
  ...SHOPS.flatMap(shopBoxes),
  ...PLOTS.flatMap(fenceBoxes),
  // The orders board's legs.
  { x0: ORDERS_BOARD.pos[0] - 0.4, x1: ORDERS_BOARD.pos[0] + 0.4, z0: ORDERS_BOARD.pos[2] - 2.2, z1: ORDERS_BOARD.pos[2] + 2.2 },
];

/** Footprints of farm buildings, which only exist once they are bought. */
export function padBox(plot, pad, shrink = 0) {
  const p = padWorld(plot, pad);
  return { x0: p.x - p.w / 2 + shrink, x1: p.x + p.w / 2 - shrink, z0: p.z - p.d / 2 + shrink, z1: p.z + p.d / 2 - shrink };
}

// Where new players and new cars appear.
export const TOWN_SPAWN = { pos: [0, 0, 60], yaw: 0 };
