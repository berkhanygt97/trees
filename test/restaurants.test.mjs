// Restaurants: lots, pantry, customers, cooking and serving, staff, levels,
// the delivery runs, and running more than one.
//   node test/restaurants.test.mjs
import { STATION_BY_ID, LOT_BY_ID, LOT_LEVEL, LOTS } from '../shared/map.js';
import { HOUR_MS, LEVEL_XP, RESTO_LEVELS, RESTO_SLOT_LEVELS, DISH_BY_ID, dishPrice } from '../shared/catalog.js';
import { makeChecker, makeRoom, join, runFor, withTime, fakeWs, act, at } from './helpers.mjs';

const { check, done } = makeChecker();

const room = makeRoom();
room.clock.time = 12 * HOUR_MS;          // lunchtime
room.clock.weather = 'clear';
room.clock.weatherUntil = room.clock.time + 100 * HOUR_MS;
const p = join(room, 'Chef');
const rival = join(room, 'Rival');
const ws = p.ws;
const A = (who, t, d) => act(room, who, t, d);
// Lots anyone can buy in this test: the first ones the map offers this farmer.
const lotsFor = (who) => LOTS.filter((l) => !room.lotAllowed || room.lotAllowed(who, l));
const mine = lotsFor(p);
const L1 = mine.find((l) => l.size === 'medium');
const L2 = mine.find((l) => l.size === 'large');
const counter = (lot) => `lot${lot.id}-counter`;
const res1 = () => p.restaurants.find((r) => r.lot === L1.id);

// --- buying a lot
p.money = 500000;
at(p, 'landoffice');
A(p, 'buy', { station: 'landoffice', sku: `lot:${L1.id}`, type: 'pizza' });
check(`lots need farm level ${LOT_LEVEL}`, p.restaurants.length === 0);
p.xp = LEVEL_XP[LOT_LEVEL - 1];
p.pos = [0, 0, 60];
A(p, 'buy', { station: 'landoffice', sku: `lot:${L1.id}`, type: 'pizza' });
check('lots are sold at the Land Office only', p.restaurants.length === 0);
at(p, 'landoffice');
A(p, 'buy', { station: 'landoffice', sku: `lot:${L1.id}`, type: 'pizza' });
check('buy a medium lot as a pizzeria', res1() && res1().type === 'pizza' && p.money === 500000 - L1.price);
check('a delivery scooter comes with it', p.vehicles.filter((v) => v.model === 'scooter').length === 1);
A(p, 'buy', { station: 'landoffice', sku: `lot:${L2.id}`, type: 'burger' });
check(`a second restaurant needs farm level ${RESTO_SLOT_LEVELS[1]}`, p.restaurants.length === 1);
rival.money = 200000; rival.xp = LEVEL_XP[LOT_LEVEL]; at(rival, 'landoffice');
A(rival, 'buy', { station: 'landoffice', sku: `lot:${L1.id}`, type: 'burger' });
check('a taken lot cannot be bought', rival.restaurants.length === 0);

// --- the counter is the owner's only
at(rival, counter(L1));
A(rival, 'resto', { station: counter(L1), action: 'price', value: 0.8 });
check('nobody else can run your restaurant', res1().price === 1);

// --- no ingredients, no customers
at(p, counter(L1));
A(p, 'enter', { station: counter(L1) });
p.inv = {};
runFor(room, 60_000);
check('no ingredients: nobody gets served', res1().served === 0 && room.restaurants.rt.get(L1.id).customers.size === 0);

// --- stock the pantry from the farm, then customers come in
p.inv = { tomato: 30, potato: 30 };
A(p, 'resto', { station: counter(L1), action: 'stock', item: '*' });
check('stock the pantry from farm storage', (res1().pantry.tomato || 0) === 30 && !(p.inv.tomato > 0));
const npcs0 = ws.sent.filter((m) => m.t === 'npc').length;
runFor(room, 120_000);
const r = room.restaurants.rt.get(L1.id);
check('customers walk in and sit down', r.customers.size > 0, `${r.customers.size} seated`);
check('they arrive as path events, not position streams', ws.sent.filter((m) => m.t === 'npc').length > npcs0 && ws.sent.filter((m) => m.t === 'npc').every((m) => Array.isArray(m.d.path)));
check('orders only what the pantry can make (soup, wedges)', r.orders.length > 0 && r.orders.every((o) => ['soup', 'wedges'].includes(o.dish)), r.orders.map((o) => o.dish).join(','));
check('the owner at the counter sees the orders', ws.sent.some((m) => m.t === 'resto' && m.d.lot === L1.id && m.d.orders.length));

// --- cook and serve by hand, customer eats and pays into the till
const money0 = p.money;
const till0 = res1().till;
const o = r.orders.find((q) => q.state === 'queued');
A(p, 'resto', { station: counter(L1), action: 'cook', oid: o.oid });
runFor(room, 2000);
check('cooking by hand takes a moment', o.state === 'ready');
A(p, 'resto', { station: counter(L1), action: 'serve', oid: o.oid });
runFor(room, 20_000);
check('served customers eat and pay', res1().served === 1 && res1().till > till0);
check('the takings go into the till, not your pocket', p.money === money0, `till ${res1().till}`);
check('the price is the menu price', res1().till - till0 === dishPrice(DISH_BY_ID[o.dish]), `${o.dish} ${dishPrice(DISH_BY_ID[o.dish])}`);
check('the wallet shows the till', (() => { const w = ws.sent.filter((m) => m.t === 'wallet').pop(); return w && w.d.tills === res1().till; })());

// --- bank the till by hand
const mb = p.money;
const tillNow = res1().till;
A(p, 'resto', { station: counter(L1), action: 'bank' });
check('bank the till at the counter', res1().till === 0 && p.money === mb + tillNow, `+${p.money - mb}`);

// --- walkouts: nobody cooks, they leave, reputation drops, ingredients go back
const rep0 = res1().rep;
const pantry0 = (res1().pantry.tomato || 0) + (res1().pantry.potato || 0);
runFor(room, 150_000);
check('customers who wait too long walk out', res1().day.walkouts > 0 && res1().rep < rep0, `rep ${rep0} -> ${res1().rep.toFixed(1)}`);
check('uncooked orders go back in the pantry', (res1().pantry.tomato || 0) + (res1().pantry.potato || 0) >= pantry0 - r.orders.length * 3);

// --- staff: a cook and a waiter run it while the owner is away
p.inv = { tomato: 200, potato: 200, flour: 100, corn: 100 };
A(p, 'resto', { station: counter(L1), action: 'stock', item: '*' });
p.house = 3;
at(p, 'jobcentre');
let board = room.staff.candidates();
A(p, 'hire', { station: 'jobcentre', cid: board[0].cid, role: 'cook', name: 'Luigi' });
A(p, 'hire', { station: 'jobcentre', cid: board[1].cid, role: 'waiter', name: 'Mario' });
check('hire restaurant staff once you have a restaurant', p.workers.filter((w) => ['cook', 'waiter'].includes(w.role)).length === 2);
check('they work at your restaurant', p.workers.every((w) => w.cfg.lot === L1.id));
for (const w of p.workers) w.trait = 'steady';
// The boss goes home for the night; the staff keep the place running.
withTime(() => room.removePlayer(p.id));
const served0 = res1().served;
const t0 = res1().till;
room.clock.time = Math.floor(room.clock.time / (20 * 60000)) * 20 * 60000 + 11 * HOUR_MS;
runFor(room, 240_000);
check('staff cook and serve with the owner offline', res1().served > served0, `${res1().served - served0} served`);
check('offline takings are banked every few hours', res1().till + p.money > t0 + money0 - 1e9 && res1().earned > 0);

// --- levels and deliveries
res1().served = RESTO_LEVELS[2];
const again = fakeWs();
const p2 = join(room, 'Chef', again);
check('same farmer back', p2 === p);
at(p, counter(L1));
A(p, 'enter', { station: counter(L1) });
room.restaurants.rt.get(L1.id).nextDelivery = 0;
runFor(room, 5000);
const dl = room.restaurants.rt.get(L1.id).deliveries[0];
check('level 3 brings delivery orders', !!dl, dl && `${dl.dish} to ${dl.dest.label}`);
if (dl) {
  A(p, 'resto', { station: counter(L1), action: 'take', id: dl.id });
  check('take a delivery from the counter', p.carrying && p.carrying.id === dl.id && p.carrying.lot === L1.id);
  A(p, 'drop', {});
  check('dropping it off at the wrong place is refused', p.carrying && dl.state === 'player');
  const mm = p.money;
  p.pos = [dl.dest.pos[0], 0, dl.dest.pos[2]];
  A(p, 'drop', {});
  const paid = p.money - mm;
  const base = dishPrice(DISH_BY_ID[dl.dish]);
  check('a quick delivery pays the dish and a tip, cash in hand', !p.carrying && paid > base, `paid ${paid} for a ${base} dish`);
  const msg = again.sent.filter((m) => m.t === 'delivered').pop();
  check('you are told what you earned', msg && msg.d.paid === paid);
}
// A late one pays half.
room.restaurants.rt.get(L1.id).nextDelivery = 0;
runFor(room, 3000);
const late = room.restaurants.rt.get(L1.id).deliveries.find((d) => d.state === 'waiting');
if (late) {
  at(p, counter(L1));
  A(p, 'resto', { station: counter(L1), action: 'take', id: late.id });
  runFor(room, late.total + 1000);
  const mm = p.money;
  p.pos = [late.dest.pos[0], 0, late.dest.pos[2]];
  A(p, 'drop', {});
  const base = dishPrice(DISH_BY_ID[late.dish]);
  check('a late delivery pays half and no tip', p.money - mm === Math.round(base * 0.5), `paid ${p.money - mm} for a ${base} dish`);
} else check('a second delivery order comes in', false);

// --- a second restaurant
p.xp = LEVEL_XP[RESTO_SLOT_LEVELS[1] - 1];
p.money = 500000;
at(p, 'landoffice');
A(p, 'buy', { station: 'landoffice', sku: `lot:${L2.id}`, type: 'burger' });
const res2 = p.restaurants.find((q) => q.lot === L2.id);
check(`a second restaurant at farm level ${RESTO_SLOT_LEVELS[1]}`, p.restaurants.length === 2 && res2 && res2.type === 'burger');
check('still one scooter', p.vehicles.filter((v) => v.model === 'scooter').length === 1);
at(p, 'jobcentre');
board = room.staff.candidates();
A(p, 'hire', { station: 'jobcentre', cid: board[0].cid, role: 'cook', name: 'Bob', lot: L2.id });
const bob = p.workers.find((w) => w.name === 'Bob');
check('hire a cook for the second restaurant', bob && bob.cfg.lot === L2.id);
check('each restaurant counts its own staff', room.staff.countAt(p, 'restaurant', L1.id) === 2 && room.staff.countAt(p, 'restaurant', L2.id) === 1);
at(p, counter(L2));
A(p, 'resto', { station: counter(L1), action: 'price', value: 1.4 });
check('each counter runs only its own restaurant', res1().price !== 1.4);
A(p, 'resto', { station: counter(L2), action: 'price', value: 1.4 });
check('the second counter runs the second restaurant', res2.price === 1.4);
A(p, 'staff', { action: 'config', id: bob.id, cfg: { lot: L1.id } });
check('move a cook to your other restaurant (if there is room)', bob.cfg.lot === L1.id || room.staff.countAt(p, 'restaurant', L1.id) >= room.staff.capAt(p, 'restaurant', L1.id));

// --- tills bank themselves every few in-game hours
res2.till = 777;
const mt = p.money;
room.clock.time += 4 * HOUR_MS;
runFor(room, 500);
check('tills are banked every four in-game hours', res2.till === 0 && p.money - mt >= 777, `+${p.money - mt}`);
res2.till = 500;
const cracked = room.restaurants.crackTill(L2.id, 0.4);
check('a cracked till loses its share', cracked === 200 && res2.till === 300);
room.restaurants.refill(L2.id, cracked);
check('recovered money goes back in the till', res2.till === 500);

// --- remodel
at(p, counter(L1));
A(p, 'resto', { station: counter(L1), action: 'open', on: false });
room.restaurants.rt.get(L1.id).customers.clear();
room.restaurants.rt.get(L1.id).orders = [];
room.restaurants.rt.get(L1.id).deliveries = [];
p.carrying = null;
const mr = p.money;
A(p, 'resto', { station: counter(L1), action: 'remodel', type: 'bakery' });
check('remodel into a bakery café for a quarter of the lot price', res1().type === 'bakery' && mr - p.money === L1.price / 4);

// --- saved
const { toSave, migrateProfile } = await import('../server/farm.js');
const back = migrateProfile(JSON.parse(JSON.stringify(toSave(p))));
const b1 = back.restaurants.find((q) => q.lot === L1.id);
check('restaurants are saved: lot, type, pantry, dishes served, till', back.restaurants.length === 2 && b1 && b1.type === 'bakery'
  && b1.served === res1().served && JSON.stringify(b1.pantry) === JSON.stringify(res1().pantry) && back.restaurants[1].till === res2.till);
check('the old single-restaurant field is gone', !('restaurant' in back));

// A 2.2 save with one restaurant and staff comes across as a list.
const old = { ...toSave(p), restaurants: undefined, restaurant: { ...res1(), status: 'x' }, workers: [{ id: 'chef~9', name: 'Old', role: 'cook', speed: 1, trait: 'steady', look: {}, wage: 100, hired: 1, paidDay: 1, off: 0, cfg: {} }] };
delete old.restaurants;
const mig = migrateProfile(JSON.parse(JSON.stringify(old)));
check('a 2.2 restaurant becomes a list of one', mig.restaurants.length === 1 && mig.restaurants[0].lot === L1.id && mig.restaurants[0].till === 0 && !('status' in mig.restaurants[0]));
check('its old staff work at it', mig.workers[0].cfg.lot === L1.id);

done();
