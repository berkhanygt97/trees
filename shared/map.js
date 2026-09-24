// The whole world outside the casino: town, farms, roads and the race track.
// Like STATIONS, this is the single source of truth — the server uses it to
// check where people are standing and the client builds the scenery from it.
//
// Axes: +x is east, +z is south. The casino sits at the origin with its front
// doors at z = +40, facing the town.

import { STATIONS as CASINO_STATIONS, ROOM } from './config.js';
import {
  HOODS, HOOD_LOTS, HOOD_HOUSES, HQS, HOOD_STREETS, HOOD_CONNECTORS, hoodPlotOrigin, hoodSpawn, hoodAt,
} from './hoods.js';
import { ALL_ROADS } from './roads.js';
import { downtownBoxes, HOSPITAL_DOOR } from './downtown.js';
import { configureTerrain, terrainHeight } from './terrain.js';

export { HOODS, HOOD_LOTS, HOOD_HOUSES, HQS, hoodSpawn, hoodAt, HOSPITAL_DOOR };

// 3.0: the valley grew. Downtown is where it always was, in the middle; the
// six neighbourhoods sit out to the west and east on a ring of avenues.
export const BOUNDS = { minX: -700, maxX: 700, minZ: -470, maxZ: 470 };
export const DOWNTOWN = { x0: -290, x1: 290, z0: -250, z1: 250 };

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
export const ROADS = ALL_ROADS;

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
  { id: 'gunshop',    name: 'Gun Shop',          sign: "RUSTY'S GUNS",  sub: 'boar problem? we can help',  color: '#9aa7ff', x0: 12,  x1: 36,  z0: 164, z1: 184, open: 'west' },
  { id: 'jobcentre',  name: 'Job Centre',        sign: 'JOB CENTRE',    sub: 'hard workers · fair wages',  color: '#5fe0c0', x0: -36, x1: -12, z0: 188, z1: 206, open: 'east' },
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

// Six farms, one in each neighbourhood, each with its gate on the hood's
// street. Only 4-5 people play, so there is room for new names to turn up.
// (Before 3.0 the six farms stood side by side on the farm road downtown;
// server/legacy/map-v2.js remembers where, for moving old saves.)
export const PLOT_SIZE = 70;
export const PLOTS = HOODS.map((h) => ({ index: h.index, hood: h.index, ...hoodPlotOrigin(h) }));

export const TILE = 2;
// The field grows north-east from the corner nearest the gate.
const FIELD_X = 4;          // local x of the field's west edge
const FIELD_Z = 66;         // local z of the field's south edge
export const GATE = [46, 58];

// Where a farm's field corner is. Farmers can move it with the planner; a
// missing layout means the original spot, so old saves look the same.
function fieldCorner(layout) {
  const f = layout && layout.field;
  return f ? [f.x, f.z] : [FIELD_X, FIELD_Z];
}

export function tileCenter(plot, i, j, layout) {
  const [fx, fz] = fieldCorner(layout);
  return [plot.x0 + fx + TILE * i + TILE / 2, plot.z0 + fz - TILE * j - TILE / 2];
}

/** Tile coordinates under a world point, or null if it is off the field. */
export function tileAt(plot, x, z, size, layout) {
  const [fx, fz] = fieldCorner(layout);
  const i = Math.floor((x - plot.x0 - fx) / TILE);
  const j = Math.floor((plot.z0 + fz - z) / TILE);
  if (i < 0 || j < 0 || i >= size || j >= size) return null;
  return [i, j];
}

export const tileIndex = (i, j) => j * 20 + i;

// Building pads on each plot, in plot-local coordinates. By default every
// building faces south; its station sits on the doorstep. A farmer's layout
// can move each one and turn it in quarter turns.
export const PADS = {
  house:  { x: 58, z: 14, w: 16, d: 16 },
  coop:   { x: 10, z: 13, w: 10, d: 8 },
  barn:   { x: 25, z: 13, w: 13, d: 10 },
  mill:   { x: 39, z: 13, w: 8,  d: 8 },
  dairy:  { x: 64, z: 33, w: 10, d: 8 },
  bakery: { x: 64, z: 46, w: 10, d: 8 },
  bin:    { x: 64, z: 60, w: 2.4, d: 1.6 },
  pen:    { x: 51.5, z: 42, w: 10, d: 12 },     // 2.2: the cattle pen
};

export const PAD_KEYS = Object.keys(PADS);

/** The layout every farm starts with (and every save from before layouts). */
export function defaultLayout() {
  return {
    pads: Object.fromEntries(PAD_KEYS.map((k) => [k, { x: PADS[k].x, z: PADS[k].z, rot: 0 }])),
    field: { x: FIELD_X, z: FIELD_Z },
  };
}

/**
 * A pad's world centre and footprint. `rot` is quarter turns: 0 faces south
 * (+z), 1 east, 2 north, 3 west. `yaw` is the matching three.js rotation.y,
 * and `door` the unit vector out of the front door.
 */
export function padWorld(plot, pad, layout) {
  const p = PADS[pad];
  const l = layout && layout.pads && layout.pads[pad];
  const rot = l ? ((l.rot | 0) % 4 + 4) % 4 : 0;
  const swap = rot % 2 === 1;
  const yaw = rot * (Math.PI / 2);
  return {
    x: plot.x0 + (l ? l.x : p.x), z: plot.z0 + (l ? l.z : p.z),
    w: swap ? p.d : p.w, d: swap ? p.w : p.d,
    rot, yaw, door: [Math.round(Math.sin(yaw)), Math.round(Math.cos(yaw))],
  };
}

/** Where a farm building's station (its doorstep) is, given the owner's layout. */
export function padStation(plot, pad, layout) {
  const p = padWorld(plot, pad, layout);
  const out = pad === 'bin' ? 1.8 : PADS[pad].d / 2 + 2;
  return [p.x + p.door[0] * out, 0, p.z + p.door[1] * out];
}

// ------------------------------------------------------------ farm planner

export const LAYOUT_MARGIN = 1;          // metres kept clear inside the fence
// Nothing may sit in front of the gate: the lane from the gate into the farm.
export const GATE_LANE = { x0: GATE[0] - 1, x1: GATE[1] + 1, z0: PLOT_SIZE - 12, z1: PLOT_SIZE };
export const FIELD_MAX_M = 40;           // a 20 x 20 field of 2 m tiles

/** Plot-local rectangles of everything in a layout, for overlap checks. */
export function layoutRects(layout) {
  const out = [];
  for (const k of PAD_KEYS) {
    const w = padWorld({ x0: 0, z0: 0 }, k, layout);
    out.push({ id: k, x0: w.x - w.w / 2, x1: w.x + w.w / 2, z0: w.z - w.d / 2, z1: w.z + w.d / 2 });
  }
  const [fx, fz] = fieldCorner(layout);
  // The field is checked at its biggest, so buying land later never lands on a building.
  out.push({ id: 'field', x0: fx, x1: fx + FIELD_MAX_M, z0: fz - FIELD_MAX_M, z1: fz });
  return out;
}

const overlaps = (a, b, gap = 0) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.z0 < b.z1 + gap && b.z0 < a.z1 + gap;

/**
 * Checks a proposed layout. Returns { ok: true } or { ok: false, bad: [ids],
 * error }. Shared, so the planner shows exactly what the server will accept.
 */
export function validateLayout(layout) {
  if (!layout || typeof layout !== 'object' || !layout.pads || !layout.field) return { ok: false, bad: [], error: 'No layout' };
  for (const k of PAD_KEYS) {
    const l = layout.pads[k];
    if (!l || ![l.x, l.z].every(Number.isFinite) || ![0, 1, 2, 3].includes(l.rot)) return { ok: false, bad: [k], error: 'Bad layout' };
  }
  if (![layout.field.x, layout.field.z].every(Number.isFinite)) return { ok: false, bad: ['field'], error: 'Bad layout' };
  const rects = layoutRects(layout);
  const bad = new Set();
  let error = null;
  for (const r of rects) {
    const m = r.id === 'field' ? 2 : LAYOUT_MARGIN;
    if (r.x0 < m || r.z0 < m || r.x1 > PLOT_SIZE - m || r.z1 > PLOT_SIZE - m) { bad.add(r.id); error = error || 'Keep everything inside the fence'; }
    if (overlaps(r, GATE_LANE)) { bad.add(r.id); error = error || 'Keep the lane from the gate clear'; }
  }
  for (let a = 0; a < rects.length; a++) {
    for (let b = a + 1; b < rects.length; b++) {
      if (overlaps(rects[a], rects[b], 1)) {
        bad.add(rects[a].id); bad.add(rects[b].id);
        error = error || (rects[a].id === 'field' || rects[b].id === 'field'
          ? 'Buildings cannot go where the field can grow to (the dashed square)'
          : 'Buildings cannot overlap');
      }
    }
  }
  return bad.size ? { ok: false, bad: [...bad], error } : { ok: true, bad: [] };
}

/** A layout from a save or a client, cleaned up; anything odd falls back to the default. */
export function cleanLayout(raw) {
  const def = defaultLayout();
  if (!raw || typeof raw !== 'object') return def;
  const out = { pads: {}, field: { ...def.field } };
  for (const k of PAD_KEYS) {
    const l = raw.pads && raw.pads[k];
    out.pads[k] = l && Number.isFinite(l.x) && Number.isFinite(l.z)
      ? { x: Math.round(l.x * 2) / 2, z: Math.round(l.z * 2) / 2, rot: ((l.rot | 0) % 4 + 4) % 4 }
      : { ...def.pads[k] };
  }
  if (raw.field && Number.isFinite(raw.field.x) && Number.isFinite(raw.field.z)) {
    out.field = { x: Math.round(raw.field.x), z: Math.round(raw.field.z) };
  }
  // A building added in an update (the cattle pen) gets its default spot, or
  // the first free one if the farmer already built something there.
  for (const k of PAD_KEYS) {
    const had = raw.pads && raw.pads[k] && Number.isFinite(raw.pads[k].x);
    if (had || validateLayout(out).ok) continue;
    const spot = freeSpot(out, k);
    if (spot) out.pads[k] = spot;
  }
  return validateLayout(out).ok ? out : def;
}

function freeSpot(layout, pad) {
  const p = PADS[pad];
  for (const rot of [0, 1]) {
    for (let z = 4; z < PLOT_SIZE - 4; z += 1) {
      for (let x = 4; x < PLOT_SIZE - 4; x += 1) {
        const test = { ...layout, pads: { ...layout.pads, [pad]: { x: x + (rot ? p.d : p.w) % 2 / 2, z: z + (rot ? p.w : p.d) % 2 / 2, rot } } };
        if (validateLayout(test).ok) return test.pads[pad];
      }
    }
  }
  return null;
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

/** Height of the ground under (x, z): the land (flat wherever anything is built) plus the ramps. */
export function groundHeight(x, z) {
  let h = terrainHeight(x, z);
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
// `pos` here is the default layout's doorstep; the real one depends on the
// owner's layout (see padStation), which the server and client both apply.
export const PLOT_STATIONS = PLOTS.flatMap((plot) => PAD_KEYS.map((pad) => ({
  id: `p${plot.index}-${pad}`, game: pad === 'bin' ? 'bin' : pad, plot: plot.index, pad,
  name: pad === 'bin' ? 'Shipping Bin' : pad[0].toUpperCase() + pad.slice(1),
  pos: padStation(plot, pad), yaw: 0, radius: pad === 'bin' ? 3 : 4, solid: 0,
})));

// ------------------------------------------------------------ sunset strip
//
// The restaurant district: a palm-lined boulevard running east from the plaza,
// with lots on both sides. Each lot is bought at the Land Office; the
// restaurant faces the boulevard.

export const STRIP = { x0: 62, x1: 200, z0: 49, z1: 59 };          // the boulevard itself
export const LOT_SIZES = {
  small:  { name: 'Corner Spot',   price: 15000, tables: 4 },
  medium: { name: 'Strip Unit',    price: 35000, tables: 8 },
  large:  { name: 'Boulevard Lot', price: 80000, tables: 12 },
};
export const LOT_LEVEL = 4;                                          // farm level needed to buy one

// The Strip's eight lots stay downtown, for farmers without a neighbourhood.
// Everyone else builds on the five lots of their own hood's street.
export const STRIP_LOTS = [
  // North side: front edge on the boulevard's north kerb, running back towards the casino.
  { id: 1, side: 'north', size: 'small',  x0: 70,  x1: 88,  z0: 22, z1: 45 },
  { id: 2, side: 'north', size: 'medium', x0: 92,  x1: 116, z0: 22, z1: 45 },
  { id: 3, side: 'north', size: 'large',  x0: 120, x1: 152, z0: 22, z1: 45 },
  { id: 4, side: 'north', size: 'medium', x0: 156, x1: 180, z0: 22, z1: 45 },
  // South side.
  { id: 5, side: 'south', size: 'medium', x0: 70,  x1: 94,  z0: 63, z1: 86 },
  { id: 6, side: 'south', size: 'small',  x0: 98,  x1: 116, z0: 63, z1: 86 },
  { id: 7, side: 'south', size: 'large',  x0: 120, x1: 152, z0: 63, z1: 86 },
  { id: 8, side: 'south', size: 'small',  x0: 156, x1: 174, z0: 63, z1: 86 },
].map((l) => ({ ...l, hood: null, label: `Strip ${l.id}` }));
export const LOTS = [...STRIP_LOTS, ...HOOD_LOTS]
  .map((l) => ({ ...l, ...LOT_SIZES[l.size], w: l.x1 - l.x0, d: l.z1 - l.z0 }));
export const LOT_BY_ID = new Map(LOTS.map((l) => [l.id, l]));

/**
 * A lot's own frame: `lx` across (0 in the middle), `lz` metres in from the
 * pavement. Returns world [x, z]. `yaw` turns a model so it faces the street.
 */
export function lotPoint(lot, lx, lz) {
  const cx = (lot.x0 + lot.x1) / 2;
  return lot.side === 'north' ? [cx + lx, lot.z1 - lz] : [cx - lx, lot.z0 + lz];
}
export const lotYaw = (lot) => (lot.side === 'north' ? 0 : Math.PI);

// Inside every restaurant (lot-local metres): a glass front with the door in
// the middle, a dining room, the counter (the pass), and the kitchen behind it.
export const RESTO = {
  front: 2,            // the front wall is this far in from the pavement
  doorHalf: 1.6,
  entry: 3.4,          // the aisle just inside the door
  passFromBack: 7,     // the counter is this far from the back wall
  back: 1,             // back wall this far from the lot's back edge
};

/** Where the tables are, in lot-local [lx, lz]. Customers sit on the left of theirs. */
export function lotTables(lot) {
  const inner = lot.w - 4;
  const cols = Math.max(1, Math.floor(inner / 5.5));
  const rows = [5.8, 9.2, 12.6];
  const out = [];
  for (const lz of rows) {
    for (let c = 0; c < cols; c++) {
      const lx = (c - (cols - 1) / 2) * 5.5 + 0.6;
      out.push([lx, lz]);
    }
  }
  return out.slice(0, lot.tables);
}

export function lotSpots(lot) {
  const back = lot.d - RESTO.back;
  const pass = back - RESTO.passFromBack;
  return {
    door: [0, RESTO.front],
    inside: [0, RESTO.entry],
    counter: [0, pass - 1.2],             // where the owner stands (the station)
    pass: [0, pass],                      // the counter top
    stove: [-2.2, back - 2],              // the cook's spot
    oven: [2.2, back - 2],
    waiter: [lot.w / 2 - 3.2, pass - 1],  // where waiters pick up
    kitchenGap: lot.w / 2 - 2.2,          // staff squeeze through at this end of the counter
    street: [0, -2.5],                    // the pavement out front
    scooter: [lot.w / 2 - 2.5, -4.5],     // the delivery scooter's parking spot
  };
}

/** Walls and the counter, as world boxes. Only exists once somebody builds there. */
export function restaurantBoxes(lot) {
  const t = 0.3;
  const back = lot.d - RESTO.back;
  const half = lot.w / 2 - 1;
  const sp = lotSpots(lot);
  const rect = (ax, az, bx, bz) => {
    const [x1, z1] = lotPoint(lot, ax, az);
    const [x2, z2] = lotPoint(lot, bx, bz);
    return { x0: Math.min(x1, x2), x1: Math.max(x1, x2), z0: Math.min(z1, z2), z1: Math.max(z1, z2) };
  };
  return [
    rect(-half, back, half, back + t),                               // back wall
    rect(-half - t, RESTO.front, -half, back),                       // side walls
    rect(half, RESTO.front, half + t, back),
    rect(-half, RESTO.front - t, -RESTO.doorHalf, RESTO.front),      // front, either side of the door
    rect(RESTO.doorHalf, RESTO.front - t, half, RESTO.front),
    rect(-half, sp.pass[1] - 0.4, sp.kitchenGap - 1.1, sp.pass[1] + 0.4),   // the counter
  ];
}

export const RESTAURANT_STATIONS = LOTS.map((lot) => {
  const sp = lotSpots(lot);
  const [x, z] = lotPoint(lot, sp.counter[0], sp.counter[1]);
  return { id: `lot${lot.id}-counter`, game: 'restaurant', lot: lot.id, name: 'Restaurant counter', pos: [x, 0, z], yaw: 0, radius: 2.6, solid: 0 };
});

// Places a delivery can go: every farm gate, the casino, the shops, the
// track, and the cottages along the farm road.
export const COTTAGES = [
  [-230, 238], [-165, 238], [-100, 238], [-30, 238], [30, 238], [95, 238], [160, 238], [228, 238],
].map(([x, z], i) => ({ id: i + 1, x, z }));

/** Every door a delivery can go to. `hood` says which neighbourhood it is in (null downtown). */
export function deliverySpots() {
  const out = [];
  COTTAGES.forEach((c, i) => out.push({ id: `c${c.id}`, hood: null, label: `Cottage ${i + 1} on Farm Road`, pos: [c.x, 0, c.z - 5] }));
  PLOTS.forEach((plot) => {
    const s = plotSpawn(plot);
    out.push({ id: `g${plot.index}`, hood: plot.index, label: `the ${HOODS[plot.index].short} farm gate`, pos: [s.pos[0], 0, s.pos[2] - 2] });
  });
  out.push({ id: 'casino', hood: null, label: 'the Casino door', pos: [0, 0, 46] });
  out.push({ id: 'track', hood: null, label: 'the race track grandstand', pos: [TRACK.cx + TRACK.half + 20, 0, TRACK.cz] });
  for (const shop of SHOPS) out.push({ id: `s-${shop.id}`, hood: null, label: shop.name, pos: shopCounter(shop) });
  for (const h of HOOD_HOUSES) out.push({ id: h.id, hood: h.hood, label: h.label, pos: h.door });
  for (const q of HQS) out.push({ id: `hq${q.hood}`, hood: q.hood, label: `the ${HOODS[q.hood].short} clubhouse`, pos: q.door });
  return out;
}

export const ALL_STATIONS = [...CASINO_STATIONS, ...TOWN_STATIONS, ...PLOT_STATIONS, ...RESTAURANT_STATIONS];
export const STATION_BY_ID = new Map(ALL_STATIONS.map((s) => [s.id, s]));

// ------------------------------------------------------------- colliders

// Every box has a height `h`: players and cars only care about the footprint,
// but bullets fly over a fence and not through a wall.
export const STATIC_BOXES = [
  ...casinoBoxes().map((b) => ({ ...b, h: CASINO.WALL_H })),
  ...SHOPS.flatMap((sh) => shopBoxes(sh).map((b) => ({ ...b, h: sh.id === 'cardealer' ? 7 : 6 }))),
  ...PLOTS.flatMap(fenceBoxes).map((b) => ({ ...b, h: 1.3 })),
  // The orders board's legs.
  { x0: ORDERS_BOARD.pos[0] - 0.4, x1: ORDERS_BOARD.pos[0] + 0.4, z0: ORDERS_BOARD.pos[2] - 2.2, z1: ORDERS_BOARD.pos[2] + 2.2, h: 3.4 },
  // Downtown's newer buildings, where the farms used to be.
  ...downtownBoxes(),
  // The neighbourhoods: every gang's clubhouse and the houses along each street.
  ...HQS.map((q) => ({ ...q.building, h: 8 })),
  ...HOOD_HOUSES.map((h) => ({ ...h.box, h: 3.2 })),
];

// Where the ground is flat: everything built, every road, the track. The
// hills roll in between.
export const FLAT_ZONES = [
  DOWNTOWN,
  ...HOODS.map((h) => ({ x0: h.x0, x1: h.x1, z0: h.z0, z1: h.z1 })),
  ...ROADS,
  ...HOOD_CONNECTORS,
];
configureTerrain(FLAT_ZONES, BOUNDS);

/** Footprints of farm buildings, which only exist once they are bought. */
export function padBox(plot, pad, shrink = 0, layout) {
  const p = padWorld(plot, pad, layout);
  return { x0: p.x - p.w / 2 + shrink, x1: p.x + p.w / 2 - shrink, z0: p.z - p.d / 2 + shrink, z1: p.z + p.d / 2 - shrink };
}

// Where new players and new cars appear.
export const TOWN_SPAWN = { pos: [0, 0, 60], yaw: 0 };
