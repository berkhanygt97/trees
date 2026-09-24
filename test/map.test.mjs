// The map holds together: neighbourhoods do not overlap each other or
// downtown, every hood has a lot of every size, stations are unique and
// reachable, spawns and delivery doors are not inside walls, and every
// farm's default layout still fits its plot.
//   node test/map.test.mjs
import {
  BOUNDS, DOWNTOWN, PLOTS, PLOT_SIZE, LOTS, ALL_STATIONS, STATIC_BOXES, ROADS, deliverySpots, plotSpawn,
  defaultLayout, validateLayout, padStation, groundHeight, restaurantBoxes, lotPoint, lotSpots, HOODS, HQS,
} from '../shared/map.js';
import { HOOD_HOUSES, TAG_POINTS, hoodAt, hoodSpawn } from '../shared/hoods.js';
import { raidRoute, onRoad } from '../shared/roads.js';
import { makeChecker } from './helpers.mjs';

const { check, done } = makeChecker();
const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const inside = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
const inBox = (x, z, pad = 0.3) => STATIC_BOXES.some((b) => x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad);

// --- the big picture
check('six neighbourhoods, one per saved farm index', HOODS.length === 6 && PLOTS.length === 6 && PLOTS.every((p, i) => p.index === i && p.hood === i));
check('hoods do not overlap each other', HOODS.every((a, i) => HOODS.every((b, j) => i === j || !overlap(a, b))));
check('hoods do not overlap downtown', HOODS.every((h) => !overlap(h, DOWNTOWN)));
check('hoods are inside the world', HOODS.every((h) => h.x0 >= BOUNDS.minX && h.x1 <= BOUNDS.maxX && h.z0 >= BOUNDS.minZ && h.z1 <= BOUNDS.maxZ));
check('every farm sits in its own hood', PLOTS.every((p) => inside(HOODS[p.index], p.x0, p.z0) && inside(HOODS[p.index], p.x0 + PLOT_SIZE, p.z0 + PLOT_SIZE)));

// --- lots
for (const h of HOODS) {
  const mine = LOTS.filter((l) => l.hood === h.index);
  check(`${h.name}: five lots, small to large, all inside the hood`, mine.length === 5
    && ['small', 'medium', 'large'].every((s) => mine.some((l) => l.size === s))
    && mine.every((l) => inside(h, l.x0, l.z0) && inside(h, l.x1, l.z1)));
}
check('the Strip keeps its eight lots downtown', LOTS.filter((l) => l.hood == null).length === 8 && LOTS.filter((l) => l.hood == null).every((l) => inside(DOWNTOWN, l.x0, l.z0)));
check('lot ids are unique', new Set(LOTS.map((l) => l.id)).size === LOTS.length);
check('no lot overlaps a farm or another lot', LOTS.every((a) => LOTS.every((b) => a === b || !overlap(a, b))
  && PLOTS.every((p) => !overlap(a, { x0: p.x0, x1: p.x0 + PLOT_SIZE, z0: p.z0, z1: p.z0 + PLOT_SIZE }))));
check('no lot overlaps a building', LOTS.every((l) => !STATIC_BOXES.some((b) => overlap(l, b) && (b.h || 0) > 2)));
check('every restaurant faces a road', LOTS.every((l) => { const [x, z] = lotPoint(l, 0, lotSpots(l).street[1] - 3); return !!onRoad(x, z, 1); }));
check('restaurant walls stay inside their lot', LOTS.every((l) => restaurantBoxes(l).every((b) => b.x0 >= l.x0 - 0.01 && b.x1 <= l.x1 + 0.01 && b.z0 >= l.z0 - 0.01 && b.z1 <= l.z1 + 0.01)));

// --- stations, spawns and doors
const ids = ALL_STATIONS.map((s) => s.id);
check('station ids are unique', new Set(ids).size === ids.length, `${ids.length} stations`);
// Reachable: somewhere within the station's radius is open floor.
const reachable = (s) => [...Array(12).keys()].some((k) => {
  const a = (k / 12) * Math.PI * 2;
  return !inBox(s.pos[0] + Math.cos(a) * s.radius * 0.8, s.pos[2] + Math.sin(a) * s.radius * 0.8, 0.3);
}) || !inBox(s.pos[0], s.pos[2], 0.3);
check('every station can be reached', ALL_STATIONS.every((s) => s.plot != null || reachable(s)),
  ALL_STATIONS.filter((s) => s.plot == null && !reachable(s)).map((s) => s.id).join(','));
check('every farm spawn is on its hood street, in the open', PLOTS.every((p) => { const s = plotSpawn(p); return onRoad(s.pos[0], s.pos[2], 4) && !inBox(s.pos[0], s.pos[2]); }));
check('every hood spawn (the clubhouse) is in the open', HOODS.every((h) => { const s = hoodSpawn(h.index); return !inBox(s.pos[0], s.pos[2]) && hoodAt(s.pos[0], s.pos[2]) === h.index; }));
const spots = deliverySpots();
check('delivery doors: cottages, farm gates, houses, clubhouses, downtown', spots.length >= 60 && new Set(spots.map((s) => s.id)).size === spots.length, `${spots.length}`);
check('every delivery door is outside, inside the world', spots.every((s) => !inBox(s.pos[0], s.pos[2], 0.2) && inside(BOUNDS.minX !== undefined ? { x0: BOUNDS.minX, x1: BOUNDS.maxX, z0: BOUNDS.minZ, z1: BOUNDS.maxZ } : null, s.pos[0], s.pos[2])),
  spots.filter((s) => inBox(s.pos[0], s.pos[2], 0.2)).map((s) => s.id).join(','));
check('each hood has six houses and a clubhouse', HOODS.every((h) => HOOD_HOUSES.filter((q) => q.hood === h.index).length === 6 && HQS[h.index].hood === h.index));
check('tag walls are in their hood and reachable', TAG_POINTS.every((t) => hoodAt(t.x, t.z) === t.hood && !inBox(t.pos[0], t.pos[2], 0.2)));

// --- farms
for (const p of PLOTS) {
  const layout = defaultLayout();
  check(`farm ${p.index}: default layout fits`, validateLayout(layout).ok && padStation(p, 'house', layout)[2] > p.z0);
}

// --- ground and roads
check('ground is flat on every farm, lot, road and station', [...PLOTS.map((p) => [p.x0 + 35, p.z0 + 35]), ...LOTS.map((l) => [(l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2]),
  ...ROADS.map((r) => [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2]), ...ALL_STATIONS.map((s) => [s.pos[0], s.pos[2]])]
  .every(([x, z]) => Math.abs(groundHeight(x, z)) < 0.01 || Math.hypot(x, z + 160) < 130));
check('every hood street joins the ring road', HOODS.every((h) => { const pts = raidRoute(h.index, 'north'); return pts.every(([x, z]) => !!onRoad(x, z, 3)); }));

done();
