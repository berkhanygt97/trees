// Restaurants: lots, pantry, customers, cooking and serving, staff, levels
// and the delivery runs.
//   node test/restaurants.test.mjs
import { Room } from '../server/room.js';
import { STATION_BY_ID, LOT_BY_ID, LOT_LEVEL } from '../shared/map.js';
import { HOUR_MS, LEVEL_XP, RESTO_LEVELS, DISH_BY_ID, dishPrice } from '../shared/catalog.js';

let fails = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
  if (!ok) fails++;
};
function fakeWs() {
  const ws = { readyState: 1, bufferedAmount: 0, sent: [], send(m) { ws.sent.push(JSON.parse(m)); }, terminate() {} };
  return ws;
}
let fakeNow = Date.now();
function runFor(room, ms, step = 50) {
  const end = fakeNow + ms;
  const realNow = Date.now;
  try {
    while (fakeNow < end) {
      fakeNow += step;
      Date.now = () => fakeNow;
      room.tick();
    }
  } finally { Date.now = realNow; }
}
const withTime = (fn) => { const realNow = Date.now; Date.now = () => fakeNow; try { return fn(); } finally { Date.now = realNow; } };

const room = new Room({ timeScale: 1 });
room.clock.time = 12 * HOUR_MS;          // lunchtime
room.clock.weather = 'clear';
room.clock.weatherUntil = room.clock.time + 100 * HOUR_MS;
const ws = fakeWs();
const p = withTime(() => room.addPlayer(ws, 'Chef', 'k1'));
const rival = withTime(() => room.addPlayer(fakeWs(), 'Rival', 'k2'));
const at = (who, id) => { const st = STATION_BY_ID.get(id); who.pos = [st.pos[0], 0, st.pos[2]]; };
const act = (who, t, d) => withTime(() => room.handle(who, { t, d }));
const got = (t) => ws.sent.filter((m) => m.t === t).map((m) => m.d);

// --- buying a lot
p.money = 200000;
at(p, 'landoffice');
act(p, 'buy', { station: 'landoffice', sku: 'lot:2', type: 'pizza' });
check(`lots need farm level ${LOT_LEVEL}`, !p.restaurant);
p.xp = LEVEL_XP[LOT_LEVEL - 1];
p.pos = [0, 0, 60];
act(p, 'buy', { station: 'landoffice', sku: 'lot:2', type: 'pizza' });
check('lots are sold at the Land Office only', !p.restaurant);
at(p, 'landoffice');
act(p, 'buy', { station: 'landoffice', sku: 'lot:2', type: 'pizza' });
check('buy a medium lot as a pizzeria', p.restaurant && p.restaurant.lot === 2 && p.restaurant.type === 'pizza' && p.money === 200000 - LOT_BY_ID.get(2).price);
check('a delivery scooter comes with it', p.vehicles.some((v) => v.model === 'scooter'));
act(p, 'buy', { station: 'landoffice', sku: 'lot:3', type: 'burger' });
check('one restaurant per farmer', p.restaurant.lot === 2);
rival.money = 200000; rival.xp = LEVEL_XP[LOT_LEVEL]; at(rival, 'landoffice');
withTime(() => room.handle(rival, { t: 'buy', d: { station: 'landoffice', sku: 'lot:2', type: 'burger' } }));
check('a taken lot cannot be bought', !rival.restaurant);

// --- the counter is the owner's only
at(rival, 'lot2-counter');
act(rival, 'resto', { action: 'price', value: 0.8 });
check('nobody else can run your restaurant', p.restaurant.price === 1);

// --- no ingredients, no customers
at(p, 'lot2-counter');
p.inv = {};
runFor(room, 60_000);
check('no ingredients: nobody gets served', p.restaurant.served === 0 && room.restaurants.rt.get(2).customers.size === 0);

// --- stock the pantry from the farm, then customers come in
p.inv = { tomato: 30, potato: 30 };
act(p, 'resto', { action: 'stock', item: '*' });
check('stock the pantry from farm storage', (p.restaurant.pantry.tomato || 0) === 30 && !(p.inv.tomato > 0));
const npcs0 = ws.sent.filter((m) => m.t === 'npc').length;
runFor(room, 120_000);
const r = room.restaurants.rt.get(2);
check('customers walk in and sit down', r.customers.size > 0, `${r.customers.size} seated`);
check('they arrive as path events, not position streams', ws.sent.filter((m) => m.t === 'npc').length > npcs0 && ws.sent.filter((m) => m.t === 'npc').every((m) => Array.isArray(m.d.path)));
check('orders only what the pantry can make (soup, wedges)', r.orders.length > 0 && r.orders.every((o) => ['soup', 'wedges'].includes(o.dish)), r.orders.map((o) => o.dish).join(','));

// --- cook and serve by hand, customer eats and pays
const money0 = p.money;
const o = r.orders.find((q) => q.state === 'queued');
act(p, 'resto', { action: 'cook', oid: o.oid });
runFor(room, 2000);
check('cooking by hand takes a moment', o.state === 'ready');
act(p, 'resto', { action: 'serve', oid: o.oid });
runFor(room, 20_000);
check('served customers eat and pay', p.money > money0 && p.restaurant.served === 1, `+$${p.money - money0}`);
check('the price is the menu price', p.money - money0 === dishPrice(DISH_BY_ID[o.dish]), `${o.dish} ${dishPrice(DISH_BY_ID[o.dish])}`);

// --- walkouts: nobody cooks, they leave, reputation drops, ingredients go back
const rep0 = p.restaurant.rep;
const pantry0 = (p.restaurant.pantry.tomato || 0) + (p.restaurant.pantry.potato || 0);
runFor(room, 150_000);
check('customers who wait too long walk out', p.restaurant.day.walkouts > 0 && p.restaurant.rep < rep0, `rep ${rep0} -> ${p.restaurant.rep.toFixed(1)}`);
check('uncooked orders go back in the pantry', (p.restaurant.pantry.tomato || 0) + (p.restaurant.pantry.potato || 0) >= pantry0 - r.orders.length * 3);

// --- staff: a cook and a waiter run it while the owner is away
p.inv = { tomato: 200, potato: 200, flour: 100, corn: 100 };
act(p, 'resto', { action: 'stock', item: '*' });
p.house = 3;
at(p, 'jobcentre');
const board = room.staff.candidates();
act(p, 'hire', { station: 'jobcentre', cid: board[0].cid, role: 'cook', name: 'Luigi' });
act(p, 'hire', { station: 'jobcentre', cid: board[1].cid, role: 'waiter', name: 'Mario' });
check('hire restaurant staff once you have a restaurant', p.workers.filter((w) => ['cook', 'waiter'].includes(w.role)).length === 2);
for (const w of p.workers) w.trait = 'steady';
// The boss goes home for the night; the staff keep the place running.
withTime(() => room.removePlayer(p.id));
const served0 = p.restaurant.served;
const m0 = p.money;
room.clock.time = Math.floor(room.clock.time / (20 * 60000)) * 20 * 60000 + 11 * HOUR_MS;
runFor(room, 240_000);
check('staff cook and serve with the owner offline', p.restaurant.served > served0 && p.money > m0, `${p.restaurant.served - served0} served, +$${p.money - m0}`);

// --- levels and deliveries
p.restaurant.served = RESTO_LEVELS[2];
const again = fakeWs();
const p2 = withTime(() => room.addPlayer(again, 'Chef', 'k1'));
check('same farmer back', p2 === p);
at(p, 'lot2-counter');
room.restaurants.rt.get(2).nextDelivery = 0;
runFor(room, 5000);
const dl = room.restaurants.rt.get(2).deliveries[0];
check('level 3 brings delivery orders', !!dl, dl && `${dl.dish} to ${dl.dest.label}`);
if (dl) {
  act(p, 'resto', { action: 'take', id: dl.id });
  check('take a delivery from the counter', p.carrying && p.carrying.id === dl.id);
  act(p, 'drop', {});
  check('dropping it off at the wrong place is refused', p.carrying && dl.state === 'player');
  const mm = p.money;
  p.pos = [dl.dest.pos[0], 0, dl.dest.pos[2]];
  act(p, 'drop', {});
  const paid = p.money - mm;
  const base = dishPrice(DISH_BY_ID[dl.dish]);
  check('a quick delivery pays the dish and a tip', !p.carrying && paid > base, `paid ${paid} for a ${base} dish`);
  const msg = again.sent.filter((m) => m.t === 'delivered').pop();
  check('you are told what you earned', msg && msg.d.paid === paid);
}
// A late one pays half.
room.restaurants.rt.get(2).nextDelivery = 0;
runFor(room, 3000);
const late = room.restaurants.rt.get(2).deliveries.find((d) => d.state === 'waiting');
if (late) {
  at(p, 'lot2-counter');
  act(p, 'resto', { action: 'take', id: late.id });
  runFor(room, late.total + 1000);
  const mm = p.money;
  p.pos = [late.dest.pos[0], 0, late.dest.pos[2]];
  act(p, 'drop', {});
  const base = dishPrice(DISH_BY_ID[late.dish]);
  check('a late delivery pays half and no tip', p.money - mm === Math.round(base * 0.5), `paid ${p.money - mm} for a ${base} dish`);
} else check('a second delivery order comes in', false);

// --- remodel
at(p, 'lot2-counter');
act(p, 'resto', { action: 'open', on: false });
room.restaurants.rt.get(2).customers.clear();
room.restaurants.rt.get(2).orders = [];
room.restaurants.rt.get(2).deliveries = [];
p.carrying = null;
const mr = p.money;
act(p, 'resto', { action: 'remodel', type: 'bakery' });
check('remodel into a bakery café for a quarter of the lot price', p.restaurant.type === 'bakery' && mr - p.money === LOT_BY_ID.get(2).price / 4);

// --- saved
const { toSave, migrateProfile } = await import('../server/farm.js');
const back = migrateProfile(JSON.parse(JSON.stringify(toSave(p))));
check('the restaurant is saved: lot, type, pantry, dishes served', back.restaurant && back.restaurant.lot === 2 && back.restaurant.type === 'bakery'
  && back.restaurant.served === p.restaurant.served && JSON.stringify(back.restaurant.pantry) === JSON.stringify(p.restaurant.pantry));

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
