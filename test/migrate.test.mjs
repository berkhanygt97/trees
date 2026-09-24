// The v2 -> v3 move, piece by piece: positions on and around the old farms,
// the farm road, the woods, the Strip, bad data, and restaurant lots.
//   node test/migrate.test.mjs
import * as OLD from '../server/legacy/map-v2.js';
import { relocate, lotRemap, upgradeProfile, SAVE_VERSION } from '../server/migrate.js';
import { PLOTS, LOT_BY_ID, STATIC_BOXES, TOWN_SPAWN, plotSpawn, lotPoint } from '../shared/map.js';
import { makeChecker } from './helpers.mjs';

const { check, done } = makeChecker();
const ctx = { plot: 0, lotMoves: new Map(), fallback: plotSpawn(PLOTS[0]) };
const d = (k) => [PLOTS[k].x0 - OLD.PLOTS[k].x0, PLOTS[k].z0 - OLD.PLOTS[k].z0];
const eq = (a, b) => Math.abs(a[0] - b[0]) < 0.02 && Math.abs(a[2] - b[2]) < 0.02;

// --- positions
for (const k of [0, 2, 3, 5]) {
  const [dx, dz] = d(k);
  const inField = [OLD.PLOTS[k].x0 + 20, 0, 170];
  check(`farm ${k}: a spot in the field moves with the farm`, eq(relocate(inField, 0, ctx).pos, [inField[0] + dx, 0, inField[2] + dz]));
  const woods = [OLD.PLOTS[k].x0 + 30, 0, 125];
  check(`farm ${k}: the woods behind move too`, eq(relocate(woods, 0, ctx).pos, [woods[0] + dx, 0, woods[2] + dz]));
  const road = [OLD.PLOTS[k].x0 + 52, 0, 217];
  check(`farm ${k}: the farm road in front moves too`, eq(relocate(road, 0, ctx).pos, [road[0] + dx, 0, road[2] + dz]));
}
const gap = [OLD.PLOTS[0].x0 - 2, 0, 170];      // between farms 0 and 1, nearer 0
const [g0x, g0z] = d(0);
check('the gap between two farms goes with the nearer farm', eq(relocate(gap, 0, ctx).pos, [gap[0] + g0x, 0, gap[2] + g0z]));
check('downtown stays exactly where it was', eq(relocate([12.34, 0, 150], 1.2345, ctx).pos, [12.34, 0, 150]) && relocate([12.34, 0, 150], 1.2345, ctx).yaw === 1.2345);
check('the casino stays put', eq(relocate([-25, 0, -2], 0, ctx).pos, [-25, 0, -2]));
check('the cottages stay put', eq(relocate([95, 0, 233], 0, ctx).pos, [95, 0, 233]));
const bad = relocate([NaN, 0, 3], 0, ctx);
check('a broken position goes to the spawn', eq(bad.pos, ctx.fallback.pos));
check('a missing position goes to the spawn', eq(relocate(null, 0, ctx).pos, ctx.fallback.pos));
const far = relocate([5000, 0, -5000], 0, ctx);
check('anything off the map is brought back inside', Math.abs(far.pos[0]) <= 700 && Math.abs(far.pos[2]) <= 470);
const inWall = relocate([-40, 0, 0], 0, { ...ctx, fallback: TOWN_SPAWN });   // the casino's west wall is x -46..-45
check('nobody ends up inside a wall', !STATIC_BOXES.some((b) => { const [x, , z] = relocate([-45.5, 0, 0], 0, ctx).pos; return x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1; }) && !!inWall);

// Standing in your old Strip restaurant: into the new one, same spot inside.
const moves = new Map([[3, 103]]);
const oldLot = OLD.LOT_BY_ID.get(3);
const [ix, iz] = OLD.lotPoint(oldLot, 2, 8);
const moved = relocate([ix, 0, iz], 0, { plot: 0, lotMoves: moves, fallback: TOWN_SPAWN });
const [nx, nz] = lotPoint(LOT_BY_ID.get(103), 2, 8);
check('standing in your restaurant: you are in it after the move too', eq(moved.pos, [nx, 0, nz]), moved.how);

// --- lots
const all = [1, 2, 3, 4, 5, 6, 7, 8];
for (const k of [0, 3]) {
  const got = all.map((id) => lotRemap(id, k));
  check(`hood ${k}: every Strip lot maps to a lot of the same size there`, got.every((id, i) => LOT_BY_ID.get(id) && LOT_BY_ID.get(id).hood === k && LOT_BY_ID.get(id).size === OLD.LOT_BY_ID.get(all[i]).size), got.join(','));
}
check('same side of the street when there is one', LOT_BY_ID.get(lotRemap(2, 0)).side === 'north' && LOT_BY_ID.get(lotRemap(5, 0)).side === 'south');
check('no hood: the Strip lot stays', lotRemap(7, -1) === 7);
check('an unknown lot still gets a lot', LOT_BY_ID.has(lotRemap(99, 2)) && LOT_BY_ID.get(lotRemap(99, 2)).hood === 2);
check('two restaurants in one hood never share a lot', (() => { const t = new Set([lotRemap(2, 1)]); return lotRemap(4, 1, t) !== lotRemap(2, 1); })());

// --- a whole file
const raw = {
  version: 2, name: 'Zed', slug: 'zed', plot: 4, pos: [OLD.PLOTS[4].x0 + 10, 0, 150], yaw: 1,
  restaurant: { lot: 5, type: 'pizza', served: 12, rep: 70, price: 1, menu: {}, pantry: { tomato: 3 }, autostock: true, open: true, earned: 5, day: {} },
  workers: [{ id: 'zed~1', name: 'Al', role: 'cook', speed: 1, trait: 'steady', look: {}, wage: 100, hired: 1, paidDay: 1, off: 0, cfg: { lot: 5 } }],
  vehicles: [
    { id: 'zed#1', model: 'tractor', pos: [OLD.PLOTS[4].x0 + 10, 0, 150], yaw: 0, speed: 3, movedAt: 1 },
    { id: 'zed#2', model: 'sedan', pos: [OLD.PLOTS[4].x0 + 10.5, 0, 150.5], yaw: 0 },
    { id: 'zed#scooter', model: 'scooter', pos: [80, 0, 60], yaw: 0 },
  ],
};
const up = upgradeProfile(raw);
check('a whole 2.2 file comes out as version 3', up.version === SAVE_VERSION && !('restaurant' in up));
check('its restaurant moved to its own hood, staff with it', up.restaurants[0].lot === lotRemap(5, 4) && up.workers[0].cfg.lot === up.restaurants[0].lot);
check('vehicles parked on top of each other get spread out', Math.hypot(up.vehicles[0].pos[0] - up.vehicles[1].pos[0], up.vehicles[0].pos[2] - up.vehicles[1].pos[2]) >= 3.5);
check('runtime fields are dropped', !('speed' in up.vehicles[0]) && !('movedAt' in up.vehicles[0]));
check('the original is untouched', raw.restaurant.lot === 5 && raw.vehicles[0].speed === 3);
check('upgrading twice changes nothing', JSON.stringify(upgradeProfile(up)) === JSON.stringify(up));

done();
