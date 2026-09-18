// European single-zero roulette. One wheel, everybody bets on the same spin.
// The full felt is supported — splits, streets, corners, six lines and the zero
// trios — and every bet is looked up in the shared table, so a client cannot
// invent one.
import { rndInt } from '../rng.js';
import { WHEEL, colorOf, BET_BY_ID } from '../../shared/roulette.js';

export { WHEEL, colorOf };

const PHASES = { betting: 24000, spinning: 9000, payout: 7000 };

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

  placeBet(player, { betId, amount }) {
    if (this.phase !== 'betting') return { ok: false, error: 'Betting is closed — wait for the next spin' };
    const def = BET_BY_ID.get(String(betId));
    if (!def) return { ok: false, error: 'That is not a bet on this table' };
    const entry = this.bets.get(player.id) || { name: player.name, list: [] };
    entry.list.push({ betId: def.id, amount });
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
        const def = BET_BY_ID.get(b.betId);
        if (def && def.numbers.includes(n)) {
          winStake += b.amount;
          let mult = def.mult;
          if (hotRed && def.type === 'red') mult = 3;
          const pay = Math.round(b.amount * mult);
          won += pay;
          lines.push(`${def.label} +${pay}`);
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
