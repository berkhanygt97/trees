// Gang wars: who can declare on whom and what it costs, the warning, who can
// hurt whom, tagging, cracking a till and getting the bag home, points,
// winners (ties go to the defender), turf, cooldowns, and walking out.
//   node test/wars.test.mjs
import { LOTS } from '../shared/map.js';
import { HQS, TAG_POINTS } from '../shared/hoods.js';
import { HOUR_MS, LEVEL_XP, GUN_BY_ID } from '../shared/catalog.js';
import { WAR } from '../server/wars.js';
import { makeChecker, makeRoom, join, runFor, withTime, act, at, sent, clock } from './helpers.mjs';

const { check, done } = makeChecker();

const room = makeRoom();
room.clock.time = 12 * HOUR_MS;
const ann = join(room, 'Ann');
const ben = join(room, 'Ben');
const cy = join(room, 'Cy');
const W = room.wars;
const A = (who, t, d) => act(room, who, t, d);
for (const p of [ann, ben, cy]) { p.xp = LEVEL_XP[6]; p.money = 100_000; }
cy.xp = 0;

// Ben has a restaurant with money in the till.
const lot = LOTS.find((l) => room.lotAllowed(ben, l) && l.size === 'small');
at(ben, 'landoffice');
A(ben, 'buy', { station: 'landoffice', sku: `lot:${lot.id}`, type: 'burger' });
const res = ben.restaurants[0];
check('the defender has a restaurant', !!res);
res.till = 5000;
ben.pos = [0, 0, 60];

const reset = () => {
  for (const p of [ann, ben, cy]) { p.war.lastDeclared = 0; p.war.protectUntil = 0; }
  W.cooldowns = {};
  room.tags.clear();
};

// ----------------------------------------------------------- declaring
ann.pos = [0, 0, 60];
A(ann, 'war', { act: 'declare', target: ben.slug });
check('wars are declared at your clubhouse', !W.war);
at(ann, `h${ann.plot}-hq`);
A(ann, 'war', { act: 'declare', target: cy.slug });
check('not on somebody far smaller than you', !W.war && sent(ann, 'toast').some((e) => /too small/.test(e.text)));
const fee = W.fee(ann);
const m0 = ann.money;
A(ann, 'war', { act: 'declare', target: ben.slug });
check('declare war', W.war && W.war.attacker === ann.slug && W.war.defender === ben.slug && W.war.hood === ben.plot);
check('it costs a fee, which is the pot', ann.money === m0 - fee && W.war.pot === fee && fee >= WAR.feeMin);
check('both sides are told', sent(ben, 'bigtext').some((b) => b.title === 'WAR DECLARED') && sent(cy, 'war').length > 0);
A(cy, 'war', { act: 'declare', target: ann.slug });
check('one war at a time', W.war.defender === ben.slug);

// Nobody can hurt anybody during the warning.
const semi = GUN_BY_ID.semiauto;
const shoot = (from, to) => {
  const o = [from.pos[0], 1.6, from.pos[2]];
  const d = [to.pos[0] - o[0], to.pos[1] + 1.2 - o[1], to.pos[2] - o[2]];
  const l = Math.hypot(...d);
  return withTime(() => room.combat.shoot(from, semi, o, d.map((v) => v / l), 0));
};
ann.pos = [10, 0, 60];
ben.pos = [20, 0, 60];
shoot(ann, ben);
check('no shooting during the warning', ben.hp === 100);

runFor(room, WAR.warnMs + 200);
check('after a minute the war is on', W.war.phase === 'active');
ben.safeUntil = 0;
shoot(ann, ben);
check('the two sides can shoot each other', ben.hp < 100);
cy.pos = [30, 0, 60];
const cyHp = cy.hp;
shoot(ann, cy);
shoot(ben, cy);
check('nobody else gets caught in it', cy.hp === cyHp);
cy.pos = [15, 0, 58];
const benHp = ben.hp;
shoot(cy, ben);
check('and nobody else can join in', ben.hp === benHp);

// ----------------------------------------------------------- tagging
const wall = TAG_POINTS.find((t) => t.hood === ben.plot && t.k === 1);
ann.pos = [wall.pos[0], 0, wall.pos[2]];
ben.pos = [0, 0, 60];
const work = (kind, target, secs) => {
  let last = null;
  for (let t = 0; t <= secs * 1000; t += 250) {
    A(ann, 'war', { act: 'work', kind, target });
    last = sent(ann, 'warwork').pop();
    clock.now += 250;
  }
  return last;
};
const s0 = W.war.score[ann.slug];
work('tag', wall.id, 4.5);
check('tag a wall in their hood', room.tags.get(wall.id) && room.tags.get(wall.id).gang === ann.slug);
check('+3 for a tag', W.war.score[ann.slug] === s0 + 3);
const wall2 = TAG_POINTS.find((t) => t.hood === ben.plot && t.k === 3);
ann.pos = [wall2.pos[0], 0, wall2.pos[2]];
ben.pos = [wall2.pos[0] + 3, 0, wall2.pos[2]];
const blocked = work('tag', wall2.id, 1);
check('not with the defender right there', blocked && blocked.error);
ben.pos = [0, 0, 60];
const s1 = W.war.score[ann.slug];
runFor(room, WAR.heldEvery + 200);
check('a tag that stays up keeps scoring', W.war.score[ann.slug] > s1);

// ------------------------------------------------ crack a till, get it home
const st = `lot${lot.id}-counter`;
at(ann, st, room);
const till0 = res.till;
work('crack', String(lot.id), 5.5);
check('crack their till: a bag of their takings', ann.bag && ann.bag.amount === Math.round(till0 * 0.6) && Math.round(res.till) === till0 - ann.bag.amount);
check('the carrier is told to get it home', sent(ann, 'bigtext').some((b) => /clubhouse/.test(b.sub)));
const bagged = ann.bag.amount;
const money1 = ann.money;
const s2 = W.war.score[ann.slug];
ann.pos = [HQS[ann.plot].door[0], 0, HQS[ann.plot].door[2]];
runFor(room, 200);
check('get it to your clubhouse and it is banked', !ann.bag && ann.money === money1 + bagged);
check('+1 per $500', W.war.score[ann.slug] >= s2 + Math.floor(bagged / 500));

// Crack again, and get wasted on the way home: the bag hits the floor.
res.till = 4000;
at(ann, st, room);
work('crack', String(lot.id), 5.5);
check('another bag', !!ann.bag);
const sBen = W.war.score[ben.slug];
ann.safeUntil = 0;
withTime(() => room.hurtPlayer(ann, 999, [1, 0], 'shot', ben));
check('wasted: the bag drops where they fell', !ann.bag && [...room.raids.loot.values()].some((l) => l.owner === ben.slug));
check('+2 to the other side for wasting them', W.war.score[ben.slug] === sBen + 2);
const drop = [...room.raids.loot.values()].find((l) => l.owner === ben.slug);
ben.pos = [drop.x, 0, drop.z];
runFor(room, 200);
check('the defender picks it up and it is back in the till', Math.round(res.till) === 4000);

// ----------------------------------------------------------- the end
ben.pos = [0, 0, 60];
runFor(room, WAR.activeMs);
const result = sent(ann, 'war').pop();
check('the war ends when time is up', result.phase === 'over' && !W.war);
check('the attacker won on points', result.result.winner === ann.slug);
check('the winner gets the pot', sent(ann, 'bigtext').some((b) => b.title === 'VICTORY'));
check('and holds the loser\'s hood for a day', W.turf[ben.plot] && W.turf[ben.plot].holder === ann.slug);
check('everyone sees who holds it', sent(cy, 'plot').some((p) => p && p.index === ben.plot && p.holderColor === ann.color));
const annBefore = ann.money;
const tillBefore = res.till;
room.restaurants._credit(ben, res, 100);
check('20% of what the hood earns goes to the holder', Math.abs(ann.money - annBefore - 20) < 1e-6 && Math.abs(res.till - tillBefore - 80) < 1e-6);
check('the loser is protected for a while', ben.war.protectUntil > clock.now);
at(ann, `h${ann.plot}-hq`);
A(ann, 'war', { act: 'declare', target: ben.slug });
check('no going again straight away', !W.war);

// ------------------------------------------------ a tie goes to the defender
reset();
A(ann, 'war', { act: 'declare', target: ben.slug });
runFor(room, WAR.warnMs + WAR.activeMs + 500);
check('0-0: the defender wins', sent(ben, 'war').pop().result.winner === ben.slug);

// ------------------------------------------------ surrender
reset();
A(ann, 'war', { act: 'declare', target: ben.slug });
runFor(room, WAR.warnMs + 200);
A(ben, 'war', { act: 'surrender' });
check('giving up hands it to the other side', sent(ann, 'war').pop().result.winner === ann.slug);

// ------------------------------------------------ walking out
reset();
A(ann, 'war', { act: 'declare', target: ben.slug });
runFor(room, WAR.warnMs + 200);
W.war.score[ann.slug] = 5;
withTime(() => room.removePlayer(ben.id));
runFor(room, 30_000);
check('a minute\'s grace for whoever left', W.war && W.war.phase === 'active');
runFor(room, 31_000);
const last = sent(ann, 'war').pop();
check('then the war ends: left while behind, so the other side wins', last.phase === 'over' && last.result.winner === ann.slug);

done();
