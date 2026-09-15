// European single-zero roulette. One wheel, everybody bets on the same spin.
import { rndInt } from '../rng.js';

export const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];

const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const colorOf = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');

const PHASES = { betting: 22000, spinning: 9000, payout: 7000 };

export const BET_TYPES = {
  red:    { mult: 2, label: 'RED',   hit: (n) => colorOf(n) === 'red' },
  black:  { mult: 2, label: 'BLACK', hit: (n) => colorOf(n) === 'black' },
  odd:    { mult: 2, label: 'ODD',   hit: (n) => n !== 0 && n % 2 === 1 },
  even:   { mult: 2, label: 'EVEN',  hit: (n) => n !== 0 && n % 2 === 0 },
  low:    { mult: 2, label: '1-18',  hit: (n) => n >= 1 && n <= 18 },
  high:   { mult: 2, label: '19-36', hit: (n) => n >= 19 && n <= 36 },
  dozen1: { mult: 3, label: '1ST 12', hit: (n) => n >= 1 && n <= 12 },
  dozen2: { mult: 3, label: '2ND 12', hit: (n) => n >= 13 && n <= 24 },
  dozen3: { mult: 3, label: '3RD 12', hit: (n) => n >= 25 && n <= 36 },
  number: { mult: 36, label: 'STRAIGHT', hit: (n, v) => n === v },
};

export class Roulette {
  constructor(hub) {
    this.hub = hub;
    this.bets = new Map();     // playerId -> { name, list: [{type,value,amount}] }
    this.history = [];
    this._enter('betting');
  }

  _enter(phase) {
    this.phase = phase;
    this.until = Date.now() + PHASES[phase];
    if (phase === 'betting') {
      this.bets.clear();
      this.result = null;
    }
    if (phase === 'spinning') {
      this.result = WHEEL[rndInt(WHEEL.length)];
    }
    if (phase === 'payout') {
      this._settle();
      this.history.unshift(this.result);
      this.history = this.history.slice(0, 12);
    }
    this.hub.broadcast('game', this.publicState());
  }

  tick(now) {
    if (now >= this.until) {
      this._enter(this.phase === 'betting' ? 'spinning' : this.phase === 'spinning' ? 'payout' : 'betting');
    }
  }

  placeBet(player, { type, value, amount }) {
    if (this.phase !== 'betting') return { ok: false, error: 'Betting is closed — wait for the next spin' };
    const def = BET_TYPES[type];
    if (!def) return { ok: false, error: 'Unknown bet' };
    if (type === 'number' && !(Number.isInteger(value) && value >= 0 && value <= 36)) {
      return { ok: false, error: 'Pick a number from 0 to 36' };
    }
    const entry = this.bets.get(player.id) || { name: player.name, list: [] };
    entry.list.push({ type, value: type === 'number' ? value : null, amount });
    this.bets.set(player.id, entry);
    this.hub.broadcast('game', this.publicState());
    return { ok: true };
  }

  clearBets(player) {
    if (this.phase !== 'betting') return { ok: false, error: 'Too late to pull your chips back' };
    const entry = this.bets.get(player.id);
    if (!entry || !entry.list.length) return { ok: false, error: 'Nothing on the table' };
    const total = entry.list.reduce((s, b) => s + b.amount, 0);
    this.bets.delete(player.id);
    this.hub.broadcast('game', this.publicState());
    return { ok: true, refund: total };
  }

  _settle() {
    const n = this.result;
    const hotRed = this.hub.eventId() === 'hot_red';
    for (const [playerId, entry] of this.bets) {
      let won = 0;
      let staked = 0;
      let winStake = 0;
      const lines = [];
      for (const b of entry.list) {
        staked += b.amount;
        const def = BET_TYPES[b.type];
        if (def.hit(n, b.value)) {
          winStake += b.amount;
          let mult = def.mult;
          if (hotRed && b.type === 'red') mult = 3;
          const pay = Math.round(b.amount * mult);
          won += pay;
          lines.push(`${b.type === 'number' ? '#' + b.value : def.label} +${pay}`);
        }
      }
      if (won > 0) this.hub.pay(playerId, won, { game: 'roulette', stake: winStake, detail: lines.join('  ') });
      this.hub.result(playerId, {
        game: 'roulette', number: n, color: colorOf(n), staked, won, net: won - staked,
      });
    }
  }

  /** Round over: hand back anything still riding on an unresolved spin. */
  abort(refund) {
    if (this.phase !== 'payout') {
      for (const [playerId, entry] of this.bets) {
        const total = entry.list.reduce((sum, b) => sum + b.amount, 0);
        if (total > 0) refund(playerId, total);
      }
    }
    this.bets.clear();
  }

  reset() { this._enter('betting'); }

  publicState() {
    const bets = [];
    for (const [playerId, e] of this.bets) {
      bets.push({ playerId, name: e.name, total: e.list.reduce((s, b) => s + b.amount, 0), list: e.list });
    }
    return {
      game: 'roulette', phase: this.phase, until: this.until, serverNow: Date.now(),
      result: this.phase === 'betting' ? null : this.result,
      color: this.result != null ? colorOf(this.result) : null,
      bets, history: this.history,
      hotRed: this.hub.eventId() === 'hot_red',
    };
  }
}
