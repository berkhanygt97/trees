// Shared bits for the test scripts. No framework: each test file is a plain
// node script that prints PASS/FAIL lines and exits non-zero on any failure.
import { Room } from '../server/room.js';
import { STATION_BY_ID } from '../shared/map.js';

export function makeChecker() {
  const state = { fails: 0 };
  const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
    if (!ok) state.fails++;
  };
  const done = () => {
    console.log(state.fails ? `${state.fails} FAILED` : 'ALL PASSED');
    process.exit(state.fails ? 1 : 0);
  };
  return { check, done, state };
}

export function fakeWs() {
  const ws = {
    readyState: 1, bufferedAmount: 0, sent: [],
    send(m) { ws.sent.push(JSON.parse(m)); },
    terminate() {},
  };
  return ws;
}

/** A fake wall clock shared by everything in one test file. */
export const clock = { now: Date.now() };

/** Runs fn with Date.now pinned to the fake clock. */
export function withTime(fn) {
  const realNow = Date.now;
  Date.now = () => clock.now;
  try { return fn(); } finally { Date.now = realNow; }
}

/** Ticks the room for `ms` of fake wall time, so a minute takes no time. */
export function runFor(room, ms, step = 50) {
  const end = clock.now + ms;
  const realNow = Date.now;
  try {
    while (clock.now < end) {
      clock.now += step;
      Date.now = () => clock.now;
      room.tick();
    }
  } finally { Date.now = realNow; }
}

export function makeRoom(opts = {}) {
  return withTime(() => new Room({ timeScale: 1, ...opts }));
}

export function join(room, name, ws = fakeWs()) {
  return withTime(() => room.addPlayer(ws, name, `key-${name}`));
}

/** Stands a player on a station. */
export function at(p, stationId, room = null) {
  const st = STATION_BY_ID.get(stationId);
  if (!st) throw new Error(`no station ${stationId}`);
  const pos = room ? room.stationPos(st) : st.pos;
  p.pos = [pos[0], 0, pos[2]];
}

export const act = (room, p, t, d) => withTime(() => room.handle(p, { t, d }));
export const sent = (p, t) => p.ws.sent.filter((m) => m.t === t).map((m) => m.d);
