// Old saves must keep working. Loads real save folders from earlier versions
// (test/fixtures), saves them in the current format, loads them again, and
// checks that nothing a player owns was lost on the way — and that since 3.0
// moved the farms into the neighbourhoods, everything that was on a farm moved
// with it and everything downtown stayed put.
//
//   node test/saves.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room } from '../server/room.js';
import { SaveStore, SAVE_VERSION } from '../server/save.js';
import * as OLD from '../server/legacy/map-v2.js';
import {
  defaultLayout, PLOTS, LOT_BY_ID, STATIC_BOXES, BOUNDS, lotPoint, lotSpots,
} from '../shared/map.js';
import { makeChecker } from './helpers.mjs';

const { check, done } = makeChecker();
const here = path.dirname(fileURLToPath(import.meta.url));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** Which old farm (if any) a pre-3.0 position was on or around. */
function oldFarmAt([x, , z]) {
  const hits = OLD.PLOTS.filter((p) => { const r = OLD.plotRegion(p); return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1; });
  hits.sort((a, b) => Math.abs(x - (a.x0 + 35)) - Math.abs(x - (b.x0 + 35)));
  return hits.length ? hits[0].index : -1;
}
const inBox = ([x, , z]) => STATIC_BOXES.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);
const inBounds = ([x, , z]) => x >= BOUNDS.minX && x <= BOUNDS.maxX && z >= BOUNDS.minZ && z <= BOUNDS.maxZ;

/** Where a position from an old save should be now. */
function expected(pos, restaurantsBefore, restaurantsAfter) {
  const k = oldFarmAt(pos);
  if (k >= 0) return { pos: [pos[0] + PLOTS[k].x0 - OLD.PLOTS[k].x0, pos[1], pos[2] + PLOTS[k].z0 - OLD.PLOTS[k].z0], why: `moved with farm ${k}` };
  for (let i = 0; i < restaurantsBefore.length; i++) {
    const old = OLD.LOT_BY_ID.get(restaurantsBefore[i].lot);
    const neu = LOT_BY_ID.get(restaurantsAfter[i] && restaurantsAfter[i].lot);
    if (old && neu && old.id !== neu.id && pos[0] >= old.x0 && pos[0] <= old.x1 && pos[2] >= old.z0 && pos[2] <= old.z1) {
      const [lx, lz] = OLD.lotLocal(old, pos[0], pos[2]);
      const [x, z] = lotPoint(neu, lx, lz);
      return { pos: [x, pos[1], z], why: 'moved with the restaurant' };
    }
  }
  return { pos, why: 'downtown, unchanged' };
}
const near = (a, b, tol = 0.6) => Math.hypot(a[0] - b[0], a[2] - b[2]) <= tol;

for (const version of fs.readdirSync(path.join(here, 'fixtures')).sort()) {
  const src = path.join(here, 'fixtures', version);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `saves-${version}-`));
  copyDir(src, dir);
  const raw = Object.fromEntries(fs.readdirSync(path.join(src, 'players')).map((f) => {
    const d = JSON.parse(fs.readFileSync(path.join(src, 'players', f), 'utf8'));
    return [d.slug, d];
  }));
  const rawWorld = JSON.parse(fs.readFileSync(path.join(src, 'world.json'), 'utf8'));
  const wasOld = (rawWorld.version || 1) < 3;

  // First load, then write everything back out in the new format.
  const room = new Room({ store: new SaveStore(dir), timeScale: 1 });
  check(`${version}: world clock kept`, room.clock.time === rawWorld.clock.time, `${room.clock.time}`);
  if (wasOld) {
    check(`${version}: the old saves were backed up first`, fs.existsSync(path.join(dir, 'backup-pre-v3', 'world.json'))
      && Object.keys(raw).every((slug) => same(JSON.parse(fs.readFileSync(path.join(dir, 'backup-pre-v3', 'players', `${slug}.json`), 'utf8')), raw[slug])));
  }
  room.save();
  const written = Object.fromEntries(Object.keys(raw).map((slug) => [slug, fs.readFileSync(path.join(dir, 'players', `${slug}.json`), 'utf8')]));

  // Load what we just wrote.
  const again = new Room({ store: new SaveStore(dir), timeScale: 1 });
  for (const [slug, r] of Object.entries(raw)) {
    const p = again.profiles.get(slug);
    const tag = `${version}/${slug}`;
    check(`${tag}: loads`, !!p);
    if (!p) continue;
    check(`${tag}: money, xp, house, farm`, p.money === r.money && p.xp === r.xp && p.house === r.house && p.plot === r.plot,
      `$${p.money} xp ${p.xp} house ${p.house} farm ${p.plot}`);
    check(`${tag}: inventory`, same(p.inv, Object.fromEntries(Object.entries(r.inv).filter(([, n]) => n > 0))));
    check(`${tag}: field`, p.field.size === r.field.size && same(p.field.tiles.slice(0, 400), r.field.tiles.slice(0, 400)));
    check(`${tag}: buildings`, Object.entries(r.buildings).every(([k, v]) => same(p.buildings[k], v)) && ('pen' in r.buildings || p.buildings.pen === null),
      'every old building unchanged; a missing cattle pen slot is empty');
    check(`${tag}: implements, guns (Grandpa's rifle for everyone)`, same(p.implements, r.implements)
      && p.guns.includes('boltrifle') && (r.guns || []).every((g) => p.guns.includes(g)));
    check(`${tag}: stats kept`, Object.entries(r.stats || {}).every(([k, v]) => p.stats[k] === v || k === 'playSeconds'));
    check(`${tag}: farm layout kept (the original one before 2.2)`, same(p.layout, r.layout || defaultLayout()));
    const noLot = (ws) => ws.map(({ cfg, ...w }) => ({ ...w, cfg: (({ lot, ...c }) => c)(cfg || {}) }));
    check(`${tag}: hired hands kept`, same(noLot(p.workers), noLot(r.workers || [])));

    // Restaurants: same everything, on a lot of the same size in the farmer's own hood.
    const had = r.restaurants || (r.restaurant ? [r.restaurant] : []);
    const keep = ({ status, till, bankSlot, lot, ...x }) => x;
    check(`${tag}: restaurants kept (type, level, pantry, prices, menu)`, p.restaurants.length === had.length
      && had.every((h, i) => same(keep(p.restaurants[i]), keep(h))));
    for (const [i, res] of p.restaurants.entries()) {
      const lot = LOT_BY_ID.get(res.lot);
      const oldLot = OLD.LOT_BY_ID.get(had[i].lot) || LOT_BY_ID.get(had[i].lot);
      check(`${tag}: restaurant ${i + 1} is on a ${oldLot.size} lot ${p.plot >= 0 ? 'in their own neighbourhood' : 'on the Strip'}`,
        lot && lot.size === oldLot.size && (p.plot >= 0 ? lot.hood === p.plot : lot.hood == null && lot.id === had[i].lot), `lot ${res.lot}`);
    }
    if (p.restaurants.length) {
      const lots = p.restaurants.map((q) => q.lot);
      check(`${tag}: restaurant staff work at the moved restaurant`, p.workers.filter((w) => ['cook', 'waiter', 'driver'].includes(w.role)).every((w) => lots.includes(w.cfg.lot)));
    }

    // Vehicles and the farmer: moved with their farm, or left where they were downtown.
    const before = (r.vehicles || []);
    check(`${tag}: every vehicle kept`, same(p.vehicles.map((v) => [v.id, v.model, v.color, v.implement]), before.map((v) => [v.id, v.model, v.color, v.implement])));
    check(`${tag}: no runtime junk in the save`, p.vehicles.every((v) => !('speed' in v) && !('movedAt' in v) && !('driver' in v)));
    for (const v of before) {
      const now = p.vehicles.find((q) => q.id === v.id);
      if (!now) continue;
      if (v.model === 'scooter' && p.restaurants.length) {
        const lot = LOT_BY_ID.get(p.restaurants[0].lot);
        const sp = lotSpots(lot).scooter;
        const [sx, sz] = lotPoint(lot, sp[0], sp[1]);
        check(`${tag}: the scooter waits outside the restaurant`, near(now.pos, [sx, 0, sz], 5), now.pos.join(','));
        continue;
      }
      const want = wasOld ? expected(v.pos, had, p.restaurants) : { pos: v.pos, why: 'already 3.0' };
      check(`${tag}: ${v.model} ${want.why}`, near(now.pos, want.pos, 4.5), `${v.pos.map(Math.round)} -> ${now.pos.map(Math.round)}`);
    }
    for (const v of p.vehicles) check(`${tag}: ${v.model} is parked in the open`, !inBox(v.pos) && inBounds(v.pos), v.pos.join(','));
    const wantMe = wasOld ? expected(r.pos, had, p.restaurants) : { pos: r.pos, why: 'already 3.0' };
    check(`${tag}: the farmer is ${wantMe.why}`, near(p.pos, wantMe.pos, 1.5) && !inBox(p.pos) && inBounds(p.pos), `${r.pos.map(Math.round)} -> ${p.pos.map(Math.round)}`);

    const file = JSON.parse(written[slug]);
    check(`${tag}: written as save version ${SAVE_VERSION}`, file.version === SAVE_VERSION && !('restaurant' in file));
  }

  // Loading a 3.0 save moves nothing: the version gate makes it happen once.
  again.save();
  const third = Object.fromEntries(Object.keys(raw).map((slug) => [slug, JSON.parse(fs.readFileSync(path.join(dir, 'players', `${slug}.json`), 'utf8'))]));
  check(`${version}: loading it again moves nothing`, Object.entries(third).every(([slug, f]) => {
    const w = JSON.parse(written[slug]);
    return same(f.pos, w.pos) && same(f.vehicles, w.vehicles) && same(f.restaurants, w.restaurants);
  }));
  fs.rmSync(dir, { recursive: true, force: true });
}

done();
