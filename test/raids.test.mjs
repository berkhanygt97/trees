// Rival gang raids: who gets raided and how hard, the car and the crew,
// cracked tills and bags of money (dropped, picked up, driven off with),
// graffiti, workers downing tools to fight or shelter, and that money is
// never made or lost except when a car gets away.
//   node test/raids.test.mjs
import { LOTS } from '../shared/map.js';
import { TAG_POINTS } from '../shared/hoods.js';
import { CONFIG } from '../shared/config.js';
import { HOUR_MS, LEVEL_XP, lootShare } from '../shared/catalog.js';
import { raidTier, RAID_MODES } from '../server/raids.js';
import { makeChecker, makeRoom, join, runFor, withTime, act, at, sent, clock } from './helpers.mjs';

const { check, done } = makeChecker();

// ------------------------------------------------------------ how hard
check('a modest hood gets a small crew', raidTier(20_000, RAID_MODES.normal) === 1);
check('a rich one gets a big crew', raidTier(200_000, RAID_MODES.normal) === 4);
check('relaxed is one smaller, hardcore one bigger', raidTier(200_000, RAID_MODES.relaxed) === 3 && raidTier(200_000, RAID_MODES.hardcore) === 5);
check('never more than five', raidTier(1e9, RAID_MODES.hardcore) === 5 && raidTier(0, RAID_MODES.relaxed) === 1);

const room = makeRoom();
room.clock.time = 12 * HOUR_MS;
room.clock.weather = 'clear';
room.clock.weatherUntil = room.clock.time + 1000 * HOUR_MS;
const boss = join(room, 'Boss');
const away = join(room, 'Away');
const R = room.raids;
const C = room.combat;
const A = (who, t, d) => act(room, who, t, d);

// A restaurant with money in the till, and a couple of hands.
boss.money = 1e6;
boss.xp = LEVEL_XP[5];
const lot = LOTS.find((l) => room.lotAllowed(boss, l) && l.size === 'medium');
at(boss, 'landoffice');
A(boss, 'buy', { station: 'landoffice', sku: `lot:${lot.id}`, type: 'burger' });
const res = boss.restaurants[0];
check('the boss has a restaurant in the hood', !!res);
const cand = () => room.staff.candidates()[0].cid;
withTime(() => room.staff.hire(boss, cand(), 'cook', 'Cookie'));
withTime(() => room.staff.hire(boss, cand(), 'field', 'Hoss'));
boss.pos = [0, 0, 60];                   // downtown, out of the way
boss.money = 20_000;
res.till = 10_000;
const total = () => boss.money + boss.restaurants.reduce((a, r) => a + (r.till || 0), 0) + R.outstanding();

// ------------------------------------------------------------ scheduling
withTime(() => room.removePlayer(away.id));
runFor(room, 1000);
check('an online boss is put on the list', R.next.has(boss.slug));
check('an offline one is not', !R.next.has(away.slug));
R.next.set(boss.slug, clock.now - 1);
runFor(room, 200);
const first = [...R.active.values()][0];
check('the raid comes when it is due', !!first && first.hood === boss.plot);
check('the boss is warned', sent(boss, 'bigtext').length > 0 && sent(boss, 'raid').some((r) => r.phase === 'ride'));
const crewOf = (r) => [...C.units.values()].filter((u) => u.raid === r.id);
let crew = () => crewOf(first);
check(`a crew of ${2 + first.tier}`, crew().length === 2 + first.tier);
check('they arrive by car, not out of thin air', crew().every((u) => u.state === 'ride'));
R.abort(first);
check('a raid can be called off', !R.active.size && !crew().length);

// ------------------------------------------------------------ a raid, played out
const before = total();
const raid = withTime(() => R.start(boss, clock.now, { gang: 'coyotes', tier: 2 }));
crew = () => crewOf(raid);
runFor(room, 25_000);
check('the car gets there and they pile out', raid.phase === 'on' && crew().every((u) => u.state !== 'ride'));
check('workers shelter in the clubhouse (no armoury)', room.staff.staffFor(boss).every((w) => /Shelter/.test(w.status)));
let carrier = null;
for (let i = 0; i < 600 && !carrier; i++) { runFor(room, 100); carrier = crew().find((u) => u.bag); }
check('a raider cracks the till', !!carrier && carrier.bag.amount === Math.round(10_000 * lootShare(0)), carrier && carrier.bag.amount);
check('the money left the till and is in the bag', Math.round(res.till) === 10_000 - (carrier ? carrier.bag.amount : 0));
check('no money made or lost', Math.abs(total() - before) < 1);
const bagged = carrier.bag.amount;
const bounty0 = boss.money;
withTime(() => C.damageUnit(carrier, 9999, boss));
const drop = [...R.loot.values()][0];
check('drop them and the bag falls where they stood', drop && drop.amount === bagged && Math.hypot(drop.x - carrier.x, drop.z - carrier.z) < 0.01);
check('everyone sees the loot', sent(boss, 'loot').some((l) => l.length === 1));
const bounty = boss.money - bounty0;
check('a bounty for the kill', bounty === 300);
check('still no money made or lost', Math.abs(total() - bounty - before) < 1);
boss.pos = [drop.x, 0, drop.z];
runFor(room, 200);
check('pick the bag up and it goes back in the till', !R.loot.size && Math.round(res.till) >= 10_000 - 1);

// Tags on the walls.
const tagged = () => [...room.tags.entries()].filter(([id]) => TAG_POINTS.find((t) => t.id === id).hood === boss.plot);
for (let i = 0; i < 300 && !tagged().length; i++) runFor(room, 100);
check('they spray their name on a wall', tagged().length === 1 && tagged()[0][1].gang === 'coyotes');
check('which puts customers off', room.footfall(boss, res) < 1);

// Everyone else gets away (or not): run it out.
boss.pos = [0, 0, 60];
for (let i = 0; i < 1500 && R.active.size; i++) runFor(room, 200);
check('the raid ends', !R.active.size);
const how = sent(boss, 'raid').pop().result.how;
check('it ends one way or another', ['robbed', 'fled', 'repelled'].includes(how), how);
check('the money adds up: only what drove off is gone', Math.abs(total() + raid.escaped - bounty - before - (how === 'robbed' ? 0 : 800 * 2)) < 1,
  `${total()} + ${raid.escaped} vs ${before}`);
check('workers go back to work', room.staff.staffFor(boss).every((w) => !/Shelter|Fighting/.test(w.status)));

// ------------------------------------------------------------ scrubbing
const [tagId] = tagged()[0] || [];
if (tagId) {
  const t = TAG_POINTS.find((q) => q.id === tagId);
  boss.pos = [t.pos[0], 0, t.pos[2]];
  for (let i = 0; i < 14; i++) { A(boss, 'scrub', { tag: tagId }); clock.now += 250; }
  check('hold E at the wall and scrub it off', !room.tags.has(tagId));
}

// ----------------------------------------------- an armoury: workers fight
at(boss, `h${boss.plot}-hq`);
boss.money = 1e6;
A(boss, 'hood', { act: 'upgrade', key: 'armory' });
check('an armoury', boss.hood.up.armory === 1);
boss.pos = [0, 0, 60];
res.till = 4000;
const raid2 = withTime(() => R.start(boss, clock.now, { gang: 'devils', tier: 1 }));
runFor(room, 25_000);
const fighters = [...C.units.values()].filter((u) => u.id.startsWith('w:'));
check('with an armoury every worker picks up a gun', fighters.length === 2 && fighters.every((u) => u.gun === 'pistol'));
check('and is not walked about as a worker meanwhile', !room.staff.publicWorkers().some((w) => fighters.some((u) => u.worker === w.id)));
const before2 = total();
withTime(() => room.removePlayer(boss.id));
runFor(room, 200);
check('the boss leaves: the raid is called off', !R.active.has(raid2.id));
check('any bags go back in the tills', Math.abs(total() - before2) < 1 && R.outstanding() === 0);
check('and the workers stand down', ![...C.units.values()].some((u) => u.id.startsWith('w:')));

CONFIG.RAID_MODE = 'normal';
done();
