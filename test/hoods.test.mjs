// Running a hood: clubhouse upgrades, the gang's name, building damage and
// repairs, what it does to the restaurants, rent, and that it all saves.
//   node test/hoods.test.mjs
import { LOTS } from '../shared/map.js';
import {
  HOUR_MS, DAY_MS, LEVEL_XP, HOOD_UPGRADES, soldierCap, repairCost, houseRent, streetFootfall,
} from '../shared/catalog.js';
import { migrateProfile, toSave } from '../server/farm.js';
import { makeChecker, makeRoom, join, runFor, withTime, act, at, sent } from './helpers.mjs';

const { check, done } = makeChecker();

const room = makeRoom();
room.clock.time = 12 * HOUR_MS;
const p = join(room, 'Boss');
const other = join(room, 'Nosy');
const A = (who, t, d) => act(room, who, t, d);
const hq = `h${p.plot}-hq`;

check('a new gang gets a name', typeof p.gang.name === 'string' && p.gang.name.length > 3, p.gang.name);
check('and a plain hood', Object.keys(p.hood.up).length === 0 && Object.keys(p.hood.hp).length === 0);

// ---------------------------------------------------------- upgrades
p.money = 1e6;
p.xp = LEVEL_XP[9];
p.pos = [0, 0, 60];
A(p, 'hood', { act: 'upgrade', key: 'hq' });
check('upgrades are bought at the clubhouse only', !p.hood.up.hq);
at(other, `h${other.plot}-hq`);
at(other, hq);
A(other, 'hood', { act: 'upgrade', key: 'hq' });
check('nobody else can use your clubhouse', !other.hood.up.hq && !p.hood.up.hq);
at(p, hq);
A(p, 'hood', { act: 'upgrade', key: 'hq' });
check('upgrade the clubhouse', p.hood.up.hq === 2 && p.money === 1e6 - HOOD_UPGRADES.hq.levels[0]);
check(`more room for soldiers (${soldierCap(2)})`, room.staff.capAt(p, 'hood') === soldierCap(2));
check('everyone sees the hood change', sent(other, 'plot').some((d) => d && d.index === p.plot && d.up && d.up.hq === 2));
const w = sent(p, 'wallet').pop();
check('the wallet lists upgrades, prices and buildings', w.hood && w.hood.up.hq === 2 && w.hood.next.hq.price === HOOD_UPGRADES.hq.levels[1] && w.hood.buildings.some((b) => b.key === 'hq'));
for (let i = 0; i < 5; i++) A(p, 'hood', { act: 'upgrade', key: 'billboard' });
check('an upgrade stops at its top level', p.hood.up.billboard === 1);
const poor = join(room, 'Poor');
poor.money = 1e6;
at(poor, `h${poor.plot}-hq`);
A(poor, 'hood', { act: 'upgrade', key: 'billboard' });
check(`the billboard waits for farm level ${HOOD_UPGRADES.billboard.level}`, !poor.hood.up.billboard);

// --------------------------------------------------------- gang name
A(p, 'hood', { act: 'rename', name: 'Tractor  Kings!!' });
check('rename the gang (tidied up)', p.gang.name === 'Tractor Kings');
A(p, 'hood', { act: 'rename', name: 'x' });
check('a name needs a few letters', p.gang.name === 'Tractor Kings');
check('everyone hears the new name', sent(other, 'players').some((l) => l.some((q) => q.gang === 'Tractor Kings')));

// ------------------------------------------ restaurants and their health
const lot = LOTS.find((l) => room.lotAllowed(p, l) && l.size === 'small');
at(p, 'landoffice');
A(p, 'buy', { station: 'landoffice', sku: `lot:${lot.id}`, type: 'burger' });
const res = p.restaurants.find((r) => r.lot === lot.id);
check('a restaurant in the hood', !!res);
const base = room.footfall(p, res);
check('the billboard brings customers', Math.abs(base - streetFootfall(0, 1)) < 1e-9, base.toFixed(2));
withTime(() => room.hoods.damage(p, `r${lot.id}`, 60));
check('damage is recorded', Math.round(p.hood.hp[`r${lot.id}`]) === 40);
check('a battered restaurant gets fewer customers', room.footfall(p, res) < base * 0.7);
check('everyone sees the damage', sent(other, 'bldg').some((b) => b.key === `r${lot.id}` && b.hp === 40));
withTime(() => room.hoods.damage(p, `r${lot.id}`, 100));
check('at zero it is wrecked and shut', room.closedFor(p, res) && /Wrecked/.test(room.closedFor(p, res)));

// Walls soak up some of it.
at(p, hq);
A(p, 'hood', { act: 'upgrade', key: 'walls' });
withTime(() => room.hoods.damage(p, 'hq', 50));
check('walls take the edge off (20% a level)', Math.round(p.hood.hp.hq) === 60);

// ------------------------------------------------------------- repairs
const cost = repairCost('restaurant', 0) + repairCost('hq', 60, 2);
const before = p.money;
A(p, 'hood', { act: 'repair', key: 'all' });
check('repair everything at the clubhouse, a little cheaper', Object.keys(p.hood.hp).length === 0 && before - p.money === Math.ceil(cost * 0.9 / 10) * 10, `${before - p.money} vs ${cost}`);
check('and the restaurant opens again', !room.closedFor(p, res));
A(p, 'hood', { act: 'repair', key: 'all' });
check('nothing to fix costs nothing', p.money === before - Math.ceil(cost * 0.9 / 10) * 10);

// ---------------------------------------------------------------- rent
A(p, 'hood', { act: 'upgrade', key: 'houses' });
withTime(() => room.hoods.damage(p, 'h0', 80));
const m0 = p.money;
room.clock.time = Math.ceil(room.clock.time / DAY_MS) * DAY_MS - 1000;
runFor(room, 3000);
check('rent comes in every morning (not from wrecked houses)', p.money - m0 >= Math.round(houseRent(1) * 5 / 6) - 5000 && sent(p, 'toast').some((t) => /Rent/.test(t.text)));

// ---------------------------------------------------------------- saves
const again = migrateProfile(JSON.parse(JSON.stringify(toSave(p))));
const sorted = (o) => JSON.stringify(Object.entries(o).sort());
check('the hood, the gang and the armour save', sorted(again.hood.up) === sorted(p.hood.up) && sorted(again.hood.hp) === sorted(p.hood.hp)
  && again.gang.name === 'Tractor Kings' && again.armor === p.armor, `${sorted(again.hood.up)} ${sorted(p.hood.up)}`);
const junk = migrateProfile({ name: 'X', slug: 'x', plot: 0, pos: [0, 0, 0], yaw: 0, hood: { up: { hq: 99, walls: -2, street: 2 }, hp: { r1: -5, hq: 50 } }, gang: { name: 42 } });
check('nonsense in a save is dropped, not trusted', junk.hood.up.hq === undefined && junk.hood.up.walls === undefined && junk.hood.up.street === 2 && junk.hood.hp.r1 === undefined && junk.hood.hp.hq === 50 && typeof junk.gang.name === 'string');

done();
