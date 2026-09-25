// Hired hands: hiring, names, speeds, wages, and that they really farm.
//   node test/workers.test.mjs
import { Room } from '../server/room.js';
import { STATION_BY_ID, PLOTS, padStation } from '../shared/map.js';
import { WORKER_ROLES, FARM_WORKER_CAP, HOUR_MS, DAY_MS, cropProgress } from '../shared/catalog.js';

let fails = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
  if (!ok) fails++;
};

function fakeWs() {
  const ws = { readyState: 1, bufferedAmount: 0, sent: [], send(m) { ws.sent.push(JSON.parse(m)); }, terminate() {} };
  return ws;
}

/** Runs the room's tick with a fake wall clock, so a minute takes no time. */
function runFor(room, ms, step = 50) {
  const start = room._fakeNow || Date.now();
  let t = start;
  const realNow = Date.now;
  try {
    while (t < start + ms) {
      t += step;
      Date.now = () => t;
      room.tick();
    }
  } finally {
    Date.now = realNow;
  }
  room._fakeNow = t;
}

const room = new Room({ timeScale: 1 });
// Mid-morning, so everybody is on shift.
room.clock.time = 9 * HOUR_MS;
const ws = fakeWs();
const p = room.addPlayer(ws, 'Boss', 'k1');
const other = room.addPlayer(fakeWs(), 'Nosy', 'k2');
const jc = STATION_BY_ID.get('jobcentre');
const at = (who, st) => { who.pos = [st.pos[0], 0, st.pos[2]]; };
const msgs = (t) => ws.sent.filter((m) => m.t === t).map((m) => m.d);

// --- the job board
const board = room.staff.candidates();
check('six candidates on the board', board.length === 6);
check('speeds between 0.6x and 1.6x', board.every((c) => c.speed >= 0.6 && c.speed <= 1.6), board.map((c) => c.speed).join(' '));

// --- hiring rules
p.money = 100000;
p.pos = [0, 0, 60];
room.handle(p, { t: 'hire', d: { station: 'jobcentre', cid: board[0].cid, role: 'field', name: 'Earl' } });
check('hiring away from the Job Centre is refused', p.workers.length === 0);
at(p, jc);
room.handle(p, { t: 'hire', d: { station: 'jobcentre', cid: board[0].cid, role: 'cook', name: 'X' } });
check('restaurant staff need a restaurant', p.workers.length === 0);
const money0 = p.money;
room.handle(p, { t: 'hire', d: { station: 'jobcentre', cid: board[0].cid, role: 'field', name: '  Big <b>Earl</b>!!  ' } });
const earl = p.workers[0];
if (earl) { earl.trait = 'steady'; earl.speed = 1; }   // 6am to 8pm at an average pace, so the test knows how much he gets done
check('hire a field hand with your own name for them', earl && earl.name === 'Big bEarlb', earl && earl.name);
check('the first day is paid up front', earl && money0 - p.money === earl.wage, `wage ${earl && earl.wage}`);
check('hired candidates leave the board', !room.staff.candidates().some((c) => c.cid === board[0].cid));
check('everyone is told about the new hire', other.ws.sent.some((m) => m.t === 'workers' && m.d.some((w) => w.name === 'Big bEarlb')));
room.handle(p, { t: 'hire', d: { station: 'jobcentre', cid: board[1].cid, role: 'field' } });
check(`a tent houses ${FARM_WORKER_CAP[0]} farm hand`, p.workers.length === 1);
p.house = 2;
room.handle(p, { t: 'hire', d: { station: 'jobcentre', cid: board[1].cid, role: 'seller' } });
check('a farmhouse houses more', p.workers.length === 2);

// --- rename, reassign, fire (from anywhere)
p.pos = [0, 0, 60];
room.handle(p, { t: 'staff', d: { action: 'rename', id: earl.id, name: 'Earl Jr.' } });
check('rename a worker', earl.name === 'Earl Jr.');
room.handle(other, { t: 'staff', d: { action: 'rename', id: earl.id, name: 'Stolen' } });
check('nobody else can rename your worker', earl.name === 'Earl Jr.');
room.handle(p, { t: 'staff', d: { action: 'config', id: earl.id, cfg: { crop: 'pumpkin' } } });
check('cannot assign a crop above your level', earl.cfg.crop !== 'pumpkin');
room.handle(p, { t: 'staff', d: { action: 'config', id: earl.id, cfg: { crop: 'carrot' } } });
check('assign a crop', earl.cfg.crop === 'carrot');
const seller = p.workers[1];
room.handle(p, { t: 'staff', d: { action: 'fire', id: seller.id } });
check('let a worker go', p.workers.length === 1);

// --- Earl farms: plow, plant, water, harvest, all through the farm rules
p.inv['seed:carrot'] = 30;
p.field.tiles.fill(null);
const tilesBefore = p.field.tiles.slice(0, 8).filter((t) => t !== null).length;
runFor(room, 90_000);
const worked = p.field.tiles.filter((t) => t !== null && t !== undefined).length;
check('Earl plows and plants on his own', worked >= 6 && tilesBefore === 0, `${worked} tiles worked in 90 s`);
check('planting uses the boss\'s seeds', (p.inv['seed:carrot'] || 0) < 30, `${p.inv['seed:carrot']} seeds left`);
check('clients get walk events, not position streams', msgs('wk').length > 5 && msgs('wk').every((e) => e.id && e.from && e.to && e.t0 != null));
// Fast-forward the crops (carrots take 4 world minutes) and let him harvest.
room.clock.time += 5 * 60_000;
const carrots0 = p.inv.carrot || 0;
runFor(room, 60_000);
check('Earl harvests into the boss\'s storage', (p.inv.carrot || 0) > carrots0, `${carrots0} -> ${p.inv.carrot}`);

// --- speed matters: a 1.5x hand does about 1.5x the work
function throughput(speed) {
  const r = new Room({ timeScale: 1 });
  r.clock.time = 9 * HOUR_MS;
  const q = r.addPlayer(fakeWs(), `T${speed}`, `t${speed}`);
  q.house = 3; q.money = 1e6; q.inv['seed:wheat'] = 999; q.field.size = 20; q.field.tiles.fill(null);
  q.workers.push({ id: 'x~1', name: 'T', role: 'field', speed, trait: 'steady', look: {}, wage: 1, hired: 1, paidDay: 1, off: 0, cfg: { crop: 'wheat', autobuy: true } });
  runFor(r, 120_000);
  return r.staff.rt.get('x~1').done;
}
const slow = throughput(0.8);
const fast = throughput(1.2);
check('speed changes how much gets done', fast / slow > 1.3 && fast / slow < 1.7, `0.8x did ${slow} jobs, 1.2x did ${fast}`);

// --- wages at dawn; unpaid workers take the day off, and come back when paid
p.money = 1;
const midnight = () => Math.ceil(room.clock.time / DAY_MS) * DAY_MS - 1;
room.clock.time = midnight();
runFor(room, 200);
check('an unpaid worker takes the day off', earl.off === room.clock.day, `off ${earl.off} day ${room.clock.day}`);
room.clock.time += 7 * HOUR_MS;   // morning: he would be on shift, if he had been paid
runFor(room, 20_000);
const idleNow = room.staff.rt.get(earl.id).status;
check('and says so', /day off/i.test(idleNow), idleNow);
p.money = 100000;
const m1 = p.money;
room.clock.time = midnight();
runFor(room, 200);
check('wages are paid the next morning', m1 - p.money === earl.wage && earl.off === 0, `paid ${m1 - p.money}`);

// --- off shift: everybody goes home at night
room.clock.time = Math.floor(room.clock.time / DAY_MS) * DAY_MS + 23 * HOUR_MS;
runFor(room, 30_000);
const home = padStation(PLOTS[p.plot], 'house', p.layout);
const rt = room.staff.rt.get(earl.id);
check('at night workers go home', Math.hypot(rt.x - home[0], rt.z - home[2]) < 1 && /shift/i.test(rt.status), rt.status);

// --- saves: workers survive a save and reload
const { toSave, migrateProfile } = await import('../server/farm.js');
const back = migrateProfile(JSON.parse(JSON.stringify(toSave(p))));
check('workers are saved with name, speed, trait, wage and settings',
  back.workers.length === 1 && back.workers[0].name === 'Earl Jr.' && back.workers[0].speed === earl.speed && back.workers[0].cfg.crop === 'carrot');

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
