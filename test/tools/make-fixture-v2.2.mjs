// Builds test/fixtures/v2.2 — a save folder exactly as Harvest Royale 2.2.0
// writes it. Run it ONLY on the 2.2.0 code (commit ba24531); later versions
// write a different format, and the whole point of the fixture is to prove
// that saves from 2.2 keep loading.
//
//   node test/tools/make-fixture-v2.2.mjs
//
// Seven farmers, chosen so every part of the old map is covered: a player and
// machines inside a farm, on the farm road, at the track, in the casino, at a
// cottage and on the Sunset Strip; restaurants on small, medium and large lots
// on both sides of the Strip; a custom farm layout; hired hands of every kind;
// and a seventh farmer who never got a farm.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room } from '../../server/room.js';
import { SaveStore } from '../../server/save.js';
import { validateLayout, defaultLayout, PLOTS } from '../../shared/map.js';
import { LEVEL_XP, HOUR_MS, DAY_MS } from '../../shared/catalog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'fixtures', 'v2.2');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const fakeWs = () => ({ readyState: 1, bufferedAmount: 0, send() {}, terminate() {} });
const room = new Room({ store: new SaveStore(out), timeScale: 1 });
const T = 11 * DAY_MS + 14 * HOUR_MS;          // day 12, 2pm
room.clock.time = T;
room.clock.weather = 'clear';
room.clock.weatherUntil = T + 2 * HOUR_MS;

const join = (name) => {
  const p = room.addPlayer(fakeWs(), name, `key-${name}`);
  p.created = 1790000000000 + name.length;
  return p;
};
const lvl = (p, level) => { p.xp = LEVEL_XP[level - 1] + 50; };
let wid = 0;
const worker = (p, role, name, extra = {}) => {
  const w = {
    id: `${p.slug}~${p.nextWid++}`, name, role, speed: [0.8, 1.1, 1.35, 0.95][wid++ % 4],
    trait: ['steady', 'keen', 'night', 'green'][wid % 4],
    look: { shirt: '#2e86de', skin: '#c68a5e', hair: '#2b1d14', hat: 'cap', beard: false, build: 1 },
    wage: 120, hired: 5, paidDay: 12, off: 0, cfg: {}, ...extra,
  };
  p.workers.push(w);
  return w;
};
const car = (p, model, pos, yaw, extra = {}) => {
  const v = { id: `${p.slug}#${p.nextVid++}`, model, color: '#d93a3a', pos, yaw, implement: null, ...extra };
  p.vehicles.push(v);
  return v;
};
const plant = (p, idx, crop, age) => { p.field.tiles[idx] = { c: crop, t: T - age, b: 0, w: -1, h: 1, r: 0 }; };

// ---------------------------------------------------------------- ann
// Plot 0. Mansion, every building, a custom layout, a big planted field,
// four farm hands, machines everywhere, and a busy pizzeria on lot 3.
const ann = join('Ann');
lvl(ann, 9);
ann.money = 412345;
ann.house = 3;
ann.field.size = 20;
ann.buildings = {
  coop: { animals: 8, feed: 60, stock: 4, last: T },
  barn: { animals: 4, feed: 40, stock: 2, last: T },
  pen: { animals: 3, feed: 50, stock: 1, last: T },
  mill: { recipe: 'flour', queue: 3, started: T - 20000, out: { flour: 2 } },
  dairy: { recipe: null, queue: 0, started: 0, out: { cheese: 1 } },
  bakery: { recipe: 'bread', queue: 2, started: T - 5000, out: {} },
};
const layout = defaultLayout();
layout.pads.barn = { x: 25, z: 13, rot: 1 };
layout.field = { x: 5, z: 65 };
if (!validateLayout(layout).ok) throw new Error(`ann's layout is invalid: ${validateLayout(layout).error}`);
ann.layout = layout;
const crops = ['wheat', 'carrot', 'potato', 'corn', 'tomato', 'pumpkin', 'strawberry'];
for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) {
  const idx = j * 20 + i;
  if ((i + j) % 5 === 0) ann.field.tiles[idx] = 0;
  else if ((i * 7 + j) % 11 === 0) ann.field.tiles[idx] = null;
  else plant(ann, idx, crops[(i + j) % crops.length], ((i * 13 + j * 7) % 10) * 30_000);
}
Object.assign(ann.inv, { wheat: 120, flour: 30, tomato: 44, corn: 20, cheese: 9, boar: 3, 'seed:pumpkin': 40 });
ann.implements = ['plow', 'seeder', 'tank'];
ann.guns = ['boltrifle', 'lever', 'semiauto'];
ann.gun = 'semiauto';
worker(ann, 'field', 'Earl', { cfg: { crop: 'corn', autobuy: true } });
worker(ann, 'animals', 'Dolores');
worker(ann, 'workshop', 'Hank', { cfg: { recipe: { bakery: 'cake' } } });
worker(ann, 'seller', 'Maybelle', { cfg: { sell: 'all', lastRun: '12:am' } });
// Pizzeria on lot 3 (large, north side of the Strip).
if (room.restaurants.buyLot(ann, 3, 'pizza').error) throw new Error('ann could not buy lot 3');
ann.money = 412345;
Object.assign(ann.restaurant, { served: 450, rep: 83.5, price: 1.15, earned: 51230, pantry: { flour: 14, tomato: 22, cheese: 6, corn: 8 } });
ann.restaurant.menu.soup = false;
worker(ann, 'cook', 'Otis');
worker(ann, 'waiter', 'Tammy');
worker(ann, 'driver', 'Cletus');
const plot0 = PLOTS[0];
car(ann, 'tractor', [plot0.x0 + 15, 0, plot0.z0 + 55], 1.2, { implement: 'seeder' });
car(ann, 'combine', [plot0.x0 + 52, 0, 217], Math.PI / 2);            // farm road, in front of her gate
car(ann, 'hyper', [95, 0, -160], Math.PI, { color: '#f2c14e' });        // at the track
ann.pos = [plot0.x0 + 30, 0, plot0.z0 + 20];                            // inside her farm
ann.yaw = 2.1;
ann.stats = { ...ann.stats, harvested: 5400, sold: 280000, orders: 31, boars: 44, served: 450, deliveries: 38, wagesPaid: 42000 };

// ---------------------------------------------------------------- ben
// Plot 1. Burger joint on lot 6 (small, south side), a full kitchen crew.
const ben = join('Ben');
lvl(ben, 6);
ben.money = 1e6;
if (room.restaurants.buyLot(ben, 6, 'burger').error) throw new Error('ben could not buy lot 6');
ben.money = 23456;
Object.assign(ben.restaurant, { served: 120, rep: 64, price: 0.95, earned: 9100, pantry: { flour: 3, beef: 4, potato: 10 }, autostock: false });
worker(ben, 'cook', 'Rosa');
worker(ben, 'waiter', 'Buck');
worker(ben, 'field', 'Vern', { cfg: { crop: 'potato', autobuy: false } });
ben.house = 1;
car(ben, 'pickup', [110, 0, 56], 0);                                    // on the Strip
ben.pos = [108, 0, 60];                                                 // on the Strip pavement
ben.yaw = -1.2;

// ---------------------------------------------------------------- cat
// Plot 2. Pizzeria-turned-café on lot 2 (medium, north), standing on the
// farm road in front of her gate.
const cat = join('Cat');
lvl(cat, 5);
cat.money = 1e6;
if (room.restaurants.buyLot(cat, 2, 'bakery').error) throw new Error('cat could not buy lot 2');
cat.money = 7777;
Object.assign(cat.restaurant, { served: 41, rep: 55, earned: 2100, pantry: { milk: 5, egg: 12, bread: 2 } });
const plot2 = PLOTS[2];
car(cat, 'sedan', [plot2.x0 + 30, 0, 216], -Math.PI / 2, { color: '#2f7de0' });
cat.pos = [plot2.x0 + 52, 0, 216];
cat.yaw = Math.PI;

// ---------------------------------------------------------------- dan
// Plot 3. No restaurant; in the casino, with his muscle car at the kerb.
const dan = join('Dan');
lvl(dan, 3);
dan.money = 1500;
car(dan, 'muscle', [8.8, 0, 90], Math.PI);
dan.pos = [-25, 0, -2];
dan.yaw = 0.3;

// ---------------------------------------------------------------- eve
// Plot 4. Out at a cottage on the farm road; her car by her gate.
const eve = join('Eve');
lvl(eve, 2);
eve.money = 900;
const plot4 = PLOTS[4];
car(eve, 'rustbucket', [plot4.x0 + 52, 0, 214], 0);
eve.pos = [95, 0, 233];
eve.yaw = 0;
for (let i = 0; i < 16; i++) plant(eve, i, 'carrot', 60_000 * (i % 4));

// ---------------------------------------------------------------- fay
// Plot 5. A brand-new farm, standing by her house.
const fay = join('Fay');
fay.pos = [PLOTS[5].x0 + 58, 0, PLOTS[5].z0 + 26];

// ---------------------------------------------------------------- gus
// No farm left for him. He bought the large south lot 7 anyway.
const gus = join('Gus');
if (gus.plot !== -1) throw new Error('gus should not have a farm');
lvl(gus, 4);
gus.money = 1e6;
if (room.restaurants.buyLot(gus, 7, 'burger').error) throw new Error('gus could not buy lot 7');
gus.money = 3210;
Object.assign(gus.restaurant, { served: 12, rep: 58, earned: 500 });
gus.pos = [136, 0, 58];
gus.yaw = 3;

room.save();

// Normalise the one thing that changes run to run.
for (const f of fs.readdirSync(path.join(out, 'players'))) {
  if (f.endsWith('.bak')) fs.rmSync(path.join(out, 'players', f));
}
for (const f of fs.readdirSync(out)) if (f.endsWith('.bak')) fs.rmSync(path.join(out, f));
console.log(`wrote ${fs.readdirSync(path.join(out, 'players')).length} players to ${out}`);
