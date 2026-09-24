// Fighting: armour, getting wasted and where you come round, your gang's
// soldiers, shooting raiders (and not your neighbours), walls stopping
// bullets, and gang members going to hospital.
//   node test/combat.test.mjs
import { HQS, hoodSpawn, HOSPITAL_DOOR } from '../shared/map.js';
import { HOUR_MS, LEVEL_XP, ARMOR, GUN_BY_ID, soldierCap } from '../shared/catalog.js';
import { makeChecker, makeRoom, join, runFor, withTime, act, at, sent, clock } from './helpers.mjs';

const { check, done } = makeChecker();

const room = makeRoom();
room.clock.time = 10 * HOUR_MS;
const ann = join(room, 'Ann');
const ben = join(room, 'Ben');
const A = (who, t, d) => act(room, who, t, d);
check('two farmers, two hoods', ann.plot >= 0 && ben.plot >= 0 && ann.plot !== ben.plot);

// ------------------------------------------------------------- armour
ann.money = 100000;
at(ann, 'gunshop');
A(ann, 'buy', { station: 'gunshop', sku: 'armor' });
check(`vests need farm level ${ARMOR.level}`, ann.armor === 0);
ann.xp = LEVEL_XP[ARMOR.level - 1];
A(ann, 'buy', { station: 'gunshop', sku: 'armor' });
check('buy a vest at Rusty\'s', ann.armor === ARMOR.max && ann.money === 100000 - ARMOR.price);
withTime(() => room.hurtPlayer(ann, 50, [1, 0], 'shot'));
check('armour soaks up most of a hit', Math.round(ann.hp) === 80 && Math.round(ann.armor) === 70, `hp ${ann.hp} armour ${ann.armor}`);

// ------------------------------------------------------ getting wasted
A(ann, 'buy', { station: 'gunshop', sku: 'gun:pistol' });
check('the new pistol is on sale', ann.guns.includes('pistol'));
withTime(() => room.hurtPlayer(ann, 500, [1, 0], 'shot', { name: 'Some Raider' }));
const ko = sent(ann, 'ko').pop();
check('wasted at zero health', ann.hp === 0 && ann.koUntil > clock.now && ko);
const home = hoodSpawn(ann.plot);
check('you come round at your own clubhouse', ko && ko.spawn[0] === home.pos[0] && ko.spawn[2] === home.pos[2], JSON.stringify(ko && ko.spawn));
check('the armour is gone', ann.armor === 0);
check('the stats remember it', ann.stats.wasted === 1);
runFor(room, 6500);
check('back on your feet with full health', ann.hp === 100 && !ann.koUntil);
withTime(() => room.hurtPlayer(ann, 30, [1, 0], 'shot'));
check('nobody can hurt you the moment you come round', ann.hp === 100);
runFor(room, 3500);
withTime(() => room.hurtPlayer(ann, 30, [1, 0], 'shot'));
check('...but they can after a few seconds', ann.hp === 70);

const drifter = join(room, 'Cy');
const dan = join(room, 'Dan');
const eve = join(room, 'Eve');
const fay = join(room, 'Fay');
const gus = join(room, 'Gus');
check('the seventh farmer has no hood', gus.plot === -1);
withTime(() => room.hurtPlayer(gus, 500, [1, 0], 'boar'));
const ko2 = sent(gus, 'ko').pop();
check('no hood: you come round at the hospital', ko2 && ko2.spawn[0] === HOSPITAL_DOOR.pos[0] && ko2.spawn[2] === HOSPITAL_DOOR.pos[2]);
for (const q of [drifter, dan, eve, fay]) withTime(() => room.removePlayer(q.id));

// ------------------------------------------------------------- soldiers
ann.money = 1e6;
const cands = () => room.staff.candidates();
const hire = (name) => withTime(() => room.staff.hire(ann, cands()[0].cid, 'soldier', name));
const h1 = hire('Tiny');
const h2 = hire('Moose');
const h3 = hire('Spider');
check(`the first clubhouse has room for ${soldierCap(1)} soldiers`, h1.worker && h2.worker && h3.error && /clubhouse/.test(h3.error), h3.error);
runFor(room, 500);
const soldiers = () => [...room.combat.units.values()].filter((u) => u.kind === 'gang' && u.owner === ann.slug);
check('soldiers turn out at the clubhouse', soldiers().length === 2
  && soldiers().every((u) => Math.hypot(u.x - HQS[ann.plot].spawn[0], u.z - HQS[ann.plot].spawn[2]) < 6));
check('they carry the gang gun', soldiers().every((u) => u.gun === 'pistol'));
check('and everyone is told who they are', sent(ben, 'unitlist').some((l) => l.some((u) => u.name === 'Tiny')));
const start = soldiers().map((u) => [u.x, u.z]);
runFor(room, 20_000);
check('they patrol the hood', soldiers().some((u, i) => Math.hypot(u.x - start[i][0], u.z - start[i][1]) > 5));
check('units stream to everyone', sent(ben, 'units').length > 50);
check('the staff room says they are on patrol', room.staff.staffFor(ann).filter((w) => w.role === 'soldier').every((w) => w.status === 'On patrol'));
check('soldiers are not walked about as farm hands', !room.staff.publicWorkers().some((w) => w.role === 'soldier'));

// ------------------------------------------------------------- shooting
const aim = (from, u) => {
  const o = [from.pos[0], 1.6, from.pos[2]];
  const t = [u.x, 1.2, u.z];
  const d = [t[0] - o[0], t[1] - o[1], t[2] - o[2]];
  const l = Math.hypot(...d);
  return { o, d: d.map((v) => v / l) };
};
const street = HQS[ann.plot].spawn;
ann.pos = [street[0] - 12, 0, street[2] + 8];
const raider = withTime(() => room.combat.spawn({ kind: 'raider', hood: ann.plot, name: 'Coyote', gun: 'pistol', x: ann.pos[0] - 10, z: ann.pos[2], acc: 0 }));
const semi = GUN_BY_ID.semiauto;
let r = aim(ann, raider);
const res = withTime(() => room.combat.shoot(ann, semi, r.o, r.d, 0));
check('a shot at a raider hits', res.hits.some((h) => h.kind === 'unit' && h.id === raider.id) && raider.hp < 100, `hp ${raider.hp}`);
for (let i = 0; i < 6 && raider.state !== 'down'; i++) { r = aim(ann, raider); withTime(() => room.combat.shoot(ann, semi, r.o, r.d, 0)); }
check('and enough of them put it down', raider.state === 'down');
check('the kill counts', ann.stats.kills >= 1);

// Behind the clubhouse wall: the bullet stops.
const q = HQS[ann.plot].building;
const behind = withTime(() => room.combat.spawn({ kind: 'raider', hood: ann.plot, name: 'Hider', gun: 'pistol', x: (q.x0 + q.x1) / 2, z: q.z0 - 3, acc: 0 }));
ann.pos = [(q.x0 + q.x1) / 2, 0, q.z1 + 4];
r = aim(ann, behind);
const blocked = withTime(() => room.combat.shoot(ann, semi, r.o, r.d, 0));
check('walls stop bullets', behind.hp === 100 && !blocked.hits.length);
room.combat.remove(behind.id);

// Neighbours are off limits outside a war.
ben.pos = [ann.pos[0] + 8, 0, ann.pos[2]];
const benHp = ben.hp;
r = { o: [ann.pos[0], 1.6, ann.pos[2]], d: [1, -0.05, 0] };
withTime(() => room.combat.shoot(ann, semi, r.o, r.d, 0));
check('you cannot shoot your neighbour unless you are at war', ben.hp === benHp);
const benTiny = [...room.combat.units.values()].find((u) => u.owner === ann.slug);
ben.pos = [benTiny.x - 6, 0, benTiny.z];
r = aim(ben, benTiny);
withTime(() => room.combat.shoot(ben, semi, r.o, r.d, 0));
check('...or their gang', benTiny.hp === 100);

// -------------------------------------------------- soldiers fight raiders
const [s1] = soldiers();
ann.pos = [street[0] + 40, 0, street[2] + 40];
const bad = withTime(() => room.combat.spawn({ kind: 'raider', hood: ann.plot, name: 'Devil', gun: 'pistol', x: s1.x + 12, z: s1.z, hp: 60, maxHp: 60 }));
runFor(room, 30_000);
check('soldiers take on a raider they can see', bad.state === 'down' || soldiers().some((u) => u.hp < 100), `raider ${bad.state} hp ${Math.round(bad.hp)}`);

// ------------------------------------------------- down and in hospital
const [s2] = soldiers();
const wid = s2.worker;
withTime(() => room.combat.damageUnit(s2, 1000, null));
const worker = ann.workers.find((w) => w.id === wid);
check('a downed soldier goes to hospital for a couple of hours', worker.hurtUntil > room.clock.time + HOUR_MS);
check('and the boss is told', sent(ann, 'toast').some((t) => /hospital/.test(t.text)));
runFor(room, 12_000);
check('they are carried off, and not back on patrol yet', !room.combat.units.has(`s:${wid}`));
check('the staff room says so', room.staff.staffFor(ann).find((w) => w.id === wid).status === 'In hospital');

// ------------------------------------------------------ the boss goes home
withTime(() => room.removePlayer(ann.id));
runFor(room, 500);
check('an offline boss\'s soldiers go home', soldiers().length === 0);

done();
