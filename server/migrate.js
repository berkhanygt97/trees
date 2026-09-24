// Bringing saves from older versions up to date. Nothing a farmer owned is
// ever dropped: money, fields, buildings, layouts, workers, restaurants, cars
// and guns all come across.
//
// Version 3 (Harvest Royale 3.0) moved the farms out of downtown into the
// neighbourhoods. Only two kinds of saved data were in world coordinates: where
// a farmer was standing and where each vehicle was parked. Anything that was
// on or around an old farm moves with it, keeping its place relative to the
// farm; anything downtown stays exactly where it was, because downtown did not
// move. A farmer's restaurant moves to a lot of the same size on their own
// hood's street, with everything in it.
//
// Every save is gated on its `version`, so a save is only ever moved once.
import * as OLD from './legacy/map-v2.js';
import {
  BOUNDS, PLOTS, LOT_BY_ID, LOTS, STATIC_BOXES, TOWN_SPAWN, lotPoint, lotYaw, lotSpots, plotSpawn,
} from '../shared/map.js';

export const SAVE_VERSION = 3;

/** Which version a save file is: 2.0 and 2.1 wrote 1, 2.2 wrote 2, older wrote nothing. */
export const versionOf = (raw) => (raw && Number.isFinite(raw.version) ? raw.version : 1);

/**
 * Where a v2 restaurant lot goes: the lot of the same size in the owner's
 * hood, on the same side of the street if the hood has one.
 * Returns the new lot id (unchanged for farmers without a hood).
 */
export function lotRemap(oldLotId, plot, taken = new Set()) {
  const old = OLD.LOT_BY_ID.get(Number(oldLotId));
  const size = old ? old.size : 'medium';
  const side = old ? old.side : 'north';
  if (plot == null || plot < 0) {
    // No hood: the Strip, where it always was.
    if (old && LOT_BY_ID.has(old.id) && !taken.has(old.id)) return old.id;
    const strip = LOTS.filter((l) => l.hood == null && !taken.has(l.id));
    const any = strip.find((l) => l.size === size) || strip[0];
    return any ? any.id : null;
  }
  const mine = LOTS.filter((l) => l.hood === plot && !taken.has(l.id));
  const pick = mine.find((l) => l.size === size && l.side === side)
    || mine.find((l) => l.size === size)
    || mine.find((l) => l.size === 'medium')
    || mine[0];
  return pick ? pick.id : null;
}

function insideBox(x, z, b, pad = 0) {
  return x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad;
}

/** Nudges a point out of any building it landed in, through the nearest wall. */
function pushOut(x, z, pad = 0.6) {
  for (let pass = 0; pass < 3; pass++) {
    const b = STATIC_BOXES.find((q) => insideBox(x, z, q, pad));
    if (!b) return [x, z, true];
    const opts = [[b.x0 - pad - 0.05, z], [b.x1 + pad + 0.05, z], [x, b.z0 - pad - 0.05], [x, b.z1 + pad + 0.05]];
    opts.sort((a, c) => Math.hypot(a[0] - x, a[1] - z) - Math.hypot(c[0] - x, c[1] - z));
    [x, z] = opts[0];
  }
  return [x, z, !STATIC_BOXES.some((q) => insideBox(x, z, q, pad))];
}

/**
 * Moves one saved position from the old valley to the new one.
 * `ctx` = { plot, lotMoves: Map(oldLotId -> newLotId), fallback: {pos, yaw} }.
 * Returns { pos, yaw, how }.
 */
export function relocate(pos, yaw, ctx) {
  const fallback = ctx.fallback || TOWN_SPAWN;
  if (!Array.isArray(pos) || pos.length < 3 || !pos.every(Number.isFinite)) {
    return { pos: [...fallback.pos], yaw: fallback.yaw, how: 'spawn' };
  }
  let [x, y, z] = pos;
  let how = 'kept';
  yaw = Number.isFinite(yaw) ? yaw : 0;

  // On or around an old farm: moves with the farm to its neighbourhood.
  const regions = OLD.PLOTS.map((p) => ({ p, r: OLD.plotRegion(p) }))
    .filter(({ r }) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1)
    .sort((a, b) => Math.abs(x - (a.p.x0 + 35)) - Math.abs(x - (b.p.x0 + 35)));
  if (regions.length) {
    const k = regions[0].p.index;
    x += PLOTS[k].x0 - OLD.PLOTS[k].x0;
    z += PLOTS[k].z0 - OLD.PLOTS[k].z0;
    how = `farm${k}`;
  } else {
    // Inside a Strip restaurant whose owner moved it: into the new building.
    for (const [from, to] of ctx.lotMoves || []) {
      const old = OLD.LOT_BY_ID.get(from);
      const neu = LOT_BY_ID.get(to);
      if (!old || !neu || from === to) continue;
      if (x >= old.x0 && x <= old.x1 && z >= old.z0 && z <= old.z1) {
        const [lx, lz] = OLD.lotLocal(old, x, z);
        [x, z] = lotPoint(neu, lx, lz);
        yaw += lotYaw(neu) - OLD.lotYaw(old);
        how = `lot${to}`;
        break;
      }
    }
  }

  x = Math.max(BOUNDS.minX + 1, Math.min(BOUNDS.maxX - 1, x));
  z = Math.max(BOUNDS.minZ + 1, Math.min(BOUNDS.maxZ - 1, z));
  const [px, pz, ok] = pushOut(x, z);
  if (!ok) return { pos: [...fallback.pos], yaw: fallback.yaw, how: 'spawn' };
  if (px !== x || pz !== z) how += '+nudged';
  // Keep untouched numbers exactly as they were saved.
  const moved = how !== 'kept';
  return { pos: moved ? [round2(px), Math.max(0, y || 0), round2(pz)] : [px, y, pz], yaw: moved ? round2(yaw) : yaw, how };
}

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Brings one player file up to version 3. Works on a copy; returns it.
 * Leaves defaults for new fields to migrateProfile (farm.js).
 */
export function upgradeProfile(raw) {
  const v = versionOf(raw);
  const p = JSON.parse(JSON.stringify(raw));
  if (v >= SAVE_VERSION) return p;
  const plot = Number.isInteger(p.plot) && p.plot >= 0 && p.plot < PLOTS.length ? p.plot : -1;
  p.plot = plot;
  const fallback = plot >= 0 ? plotSpawn(PLOTS[plot]) : TOWN_SPAWN;

  // Restaurants: 2.2 saved one as `restaurant`; early 3.0 builds a list.
  const list = Array.isArray(p.restaurants) ? p.restaurants : p.restaurant ? [p.restaurant] : [];
  const lotMoves = new Map();
  const taken = new Set();
  for (const res of list) {
    if (!res || typeof res !== 'object') continue;
    const to = lotRemap(res.lot, plot, taken);
    if (to == null) continue;        // cleanRestaurant keeps it out only if it has no lot at all
    lotMoves.set(Number(res.lot), to);
    taken.add(to);
    res.lot = to;
  }
  p.restaurants = list.filter((r) => r && typeof r === 'object' && LOT_BY_ID.has(r.lot));
  delete p.restaurant;
  // Staff follow their restaurant.
  for (const w of Array.isArray(p.workers) ? p.workers : []) {
    if (w && w.cfg && lotMoves.has(Number(w.cfg.lot))) w.cfg.lot = lotMoves.get(Number(w.cfg.lot));
  }

  const ctx = { plot, lotMoves, fallback };
  const me = relocate(p.pos, p.yaw, ctx);
  p.pos = me.pos;
  p.yaw = me.yaw;

  // Vehicles: runtime fields out, moved like everything else, and never
  // parked on top of each other.
  const placed = [];
  p.vehicles = (Array.isArray(p.vehicles) ? p.vehicles : []).filter((v) => v && v.model).map((veh) => {
    const { driver, speed, movedAt, ...v } = veh;
    let at;
    if (v.model === 'scooter' && p.restaurants.length) {
      const lot = LOT_BY_ID.get(p.restaurants[0].lot);
      const sp = lotSpots(lot).scooter;
      const [sx, sz] = lotPoint(lot, sp[0], sp[1]);
      at = { pos: [sx, 0, sz], yaw: lot.side === 'north' ? -Math.PI / 2 : Math.PI / 2 };
    } else {
      at = relocate(v.pos, v.yaw, ctx);
    }
    let [x, y, z] = at.pos;
    for (let n = 0; n < 12 && placed.some(([qx, qz]) => Math.hypot(qx - x, qz - z) < 3.5); n++) x += 4;
    placed.push([x, z]);
    return { ...v, pos: [x, y, z], yaw: at.yaw };
  });
  p.version = SAVE_VERSION;
  return p;
}

/** The world file needs nothing moved; new sections get their defaults where they are read. */
export function upgradeWorld(raw) {
  if (!raw) return raw;
  const w = JSON.parse(JSON.stringify(raw));
  w.version = SAVE_VERSION;
  return w;
}
