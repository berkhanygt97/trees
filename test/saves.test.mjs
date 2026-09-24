// Old saves must keep working. Loads real save folders from earlier versions
// (test/fixtures), saves them in the current format, loads them again, and
// checks that nothing a player owns was lost on the way.
//
//   node test/saves.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room } from '../server/room.js';
import { SaveStore, SAVE_VERSION } from '../server/save.js';
import { defaultLayout } from '../shared/map.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let fails = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
  if (!ok) fails++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const strip = (vs) => vs.map(({ driver, speed, movedAt, ...v }) => v);

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

for (const version of fs.readdirSync(path.join(here, 'fixtures'))) {
  const src = path.join(here, 'fixtures', version);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `saves-${version}-`));
  copyDir(src, dir);
  const raw = Object.fromEntries(fs.readdirSync(path.join(src, 'players')).map((f) => {
    const d = JSON.parse(fs.readFileSync(path.join(src, 'players', f), 'utf8'));
    return [d.slug, d];
  }));
  const rawWorld = JSON.parse(fs.readFileSync(path.join(src, 'world.json'), 'utf8'));

  // First load, then write everything back out in the new format.
  const room = new Room({ store: new SaveStore(dir), timeScale: 1 });
  check(`${version}: world clock kept`, room.clock.time === rawWorld.clock.time, `${room.clock.time}`);
  room.save();

  // Load what we just wrote.
  const again = new Room({ store: new SaveStore(dir), timeScale: 1 });
  for (const [slug, r] of Object.entries(raw)) {
    const p = again.profiles.get(slug);
    const tag = `${version}/${slug}`;
    check(`${tag}: loads`, !!p);
    if (!p) continue;
    check(`${tag}: money, xp, house, plot`, p.money === r.money && p.xp === r.xp && p.house === r.house && p.plot === r.plot,
      `$${p.money} xp ${p.xp} house ${p.house}`);
    check(`${tag}: inventory`, same(p.inv, Object.fromEntries(Object.entries(r.inv).filter(([, n]) => n > 0))));
    check(`${tag}: field`, p.field.size === r.field.size && same(p.field.tiles.slice(0, 400), r.field.tiles.slice(0, 400)));
    check(`${tag}: buildings`, Object.entries(r.buildings).every(([k, v]) => same(p.buildings[k], v)) && ('pen' in r.buildings || p.buildings.pen === null),
      'every old building unchanged; the new cattle pen slot is empty');
    check(`${tag}: vehicles and implements`, same(strip(p.vehicles), strip(r.vehicles)) && same(p.implements, r.implements));
    check(`${tag}: guns (Grandpa's rifle for everyone)`, p.guns.includes('boltrifle') && (r.guns || []).every((g) => p.guns.includes(g)));
    check(`${tag}: stats kept`, Object.entries(r.stats || {}).every(([k, v]) => p.stats[k] === v || k === 'playSeconds'));
    check(`${tag}: farm layout kept (the original one before 2.2)`, same(p.layout, r.layout || defaultLayout()));
    check(`${tag}: hired hands kept`, same(p.workers, r.workers || []));
    check(`${tag}: restaurant kept`, same(p.restaurant, r.restaurant || null));
    const file = JSON.parse(fs.readFileSync(path.join(dir, 'players', `${slug}.json`), 'utf8'));
    check(`${tag}: written as save version ${SAVE_VERSION}`, file.version === SAVE_VERSION);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
