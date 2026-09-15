// The Rocket: a multiplier climbs, you cash out before it blows up.
// Crash point uses the standard 1/(1-u) tail with a 3% house edge.
import { rnd } from '../rng.js';

const BETTING_MS = 9000;
const CRASHED_MS = 6000;
const GROWTH = 0.075; // multiplier = e^(GROWTH * seconds)

export const multiplierAt = (seconds) => Math.exp(GROWTH * Math.max(0, seconds));
const timeFor = (mult) => Math.log(mult) / GROWTH;

function rollCrashPoint(floor) {
  const u = rnd();
  const raw = Math.floor((100 * 0.97) / (1 - u)) / 100;
  return Math.min(250, Math.max(floor, raw));
}

export class Crash {
  constructor(hub) {
    this.hub = hub;
    this.bets = new Map(); // playerId -> { name, amount, cashedAt, payout }
    this.history = [];
    this._enter('betting');
  }

  _enter(phase) {
    this.phase = phase;
    const now = Date.now();
    if (phase === 'betting') {
      this.bets.clear();
      this.crashPoint = null;
      this.until = now + BETTING_MS;
    } else if (phase === 'running') {
      const floor = this.hub.eventId() === 'rocket_fuel' ? 1.5 : 1.0;
      this.crashPoint = rollCrashPoint(floor);
      this.startAt = now;
      this.until = now + timeFor(this.crashPoint) * 1000;
    } else {
      this._settle();
      this.history.unshift(this.crashPoint);
      this.history = this.history.slice(0, 12);
      this.until = now + CRASHED_MS;
    }
    this.hub.broadcast('game', this.publicState());
  }

  tick(now) {
    if (now >= this.until) {
      this._enter(this.phase === 'betting' ? 'running' : this.phase === 'running' ? 'crashed' : 'betting');
    }
  }

  placeBet(player, { amount }) {
    if (this.phase !== 'betting') return { ok: false, error: 'Rocket already launched — wait for the next one' };
    if (this.bets.has(player.id)) return { ok: false, error: 'You are already on this launch' };
    this.bets.set(player.id, { name: player.name, amount, cashedAt: null, payout: 0 });
    this.hub.broadcast('game', this.publicState());
    return { ok: true };
  }

  cashOut(player) {
    if (this.phase !== 'running') return { ok: false, error: 'Nothing to cash out' };
    const bet = this.bets.get(player.id);
    if (!bet) return { ok: false, error: 'You did not bet this launch' };
    if (bet.cashedAt) return { ok: false, error: 'Already cashed out' };

    const now = Date.now();
    const mult = Math.min(multiplierAt((now - this.startAt) / 1000), this.crashPoint);
    const rounded = Math.floor(mult * 100) / 100;
    bet.cashedAt = rounded;
    bet.payout = Math.round(bet.amount * rounded);
    this.hub.pay(player.id, bet.payout, { game: 'crash', stake: bet.amount, detail: `${rounded.toFixed(2)}x` });
    this.hub.result(player.id, { game: 'crash', cashedAt: rounded, payout: bet.payout, staked: bet.amount });
    this.hub.broadcast('game', this.publicState());
    return { ok: true };
  }

  _settle() {
    for (const [playerId, bet] of this.bets) {
      if (!bet.cashedAt) {
        this.hub.result(playerId, { game: 'crash', cashedAt: null, payout: 0, staked: bet.amount, crashPoint: this.crashPoint });
      }
    }
  }

  /** Round over: anyone still in the air gets their stake back. */
  abort(refund) {
    for (const [playerId, bet] of this.bets) {
      if (!bet.cashedAt) refund(playerId, bet.amount);
    }
    this.bets.clear();
  }

  reset() { this._enter('betting'); }

  publicState() {
    const bets = [];
    for (const [playerId, b] of this.bets) {
      bets.push({ playerId, name: b.name, amount: b.amount, cashedAt: b.cashedAt, payout: b.payout });
    }
    return {
      game: 'crash', phase: this.phase, until: this.until, serverNow: Date.now(),
      startAt: this.startAt || null, growth: GROWTH,
      crashPoint: this.phase === 'crashed' ? this.crashPoint : null,
      bets, history: this.history,
      fuelled: this.hub.eventId() === 'rocket_fuel',
    };
  }
}
