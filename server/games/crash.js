// The Rocket: three rockets launch together, each climbing its own multiplier
// until it blows up. You back exactly one and cash out before yours goes.
//
// Every rocket draws its crash point from the same 1/(1-u) tail with a 3% house
// edge, but the draws are independent — so watching a 40x rocket sail past while
// yours dies at 1.04x is entirely possible, and is the whole point.
import { rnd } from '../rng.js';
import { ROCKETS } from '../../shared/config.js';

const BETTING_MS = 10000;
const CRASHED_MS = 6500;
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
    this.bets = new Map(); // playerId -> { name, rocket, amount, cashedAt, payout }
    this.history = [];     // [[c1, c2, c3], ...]
    this._enter('betting');
  }

  _enter(phase) {
    this.phase = phase;
    const now = Date.now();

    if (phase === 'betting') {
      this.bets.clear();
      this.crashPoints = null;
      this.crashTimes = null;
      this.until = now + BETTING_MS;
    } else if (phase === 'running') {
      const floor = this.hub.eventId() === 'rocket_fuel' ? 1.5 : 1.0;
      this.crashPoints = ROCKETS.map(() => rollCrashPoint(floor));
      this.crashTimes = this.crashPoints.map((c) => timeFor(c) * 1000);
      this.startAt = now;
      // The phase runs until the LAST rocket dies, so the slow burners stay up.
      this.until = now + Math.max(...this.crashTimes) + 900;
    } else {
      this._settle();
      this.history.unshift([...this.crashPoints]);
      this.history = this.history.slice(0, 10);
      this.until = now + CRASHED_MS;
    }
    this.hub.broadcast('game', this.publicState());
  }

  tick(now) {
    if (this.phase === 'running') {
      // Nudge a broadcast out each time a rocket dies so everyone's screen
      // agrees on the moment, rather than waiting for the phase to end.
      const dead = this.crashPoints.filter((_, i) => this._isDead(i, now)).length;
      if (dead !== this._deadSeen) {
        this._deadSeen = dead;
        this.hub.broadcast('game', this.publicState());
      }
    }
    if (now >= this.until) {
      this._deadSeen = 0;
      this._enter(this.phase === 'betting' ? 'running' : this.phase === 'running' ? 'crashed' : 'betting');
    }
  }

  _isDead(index, now = Date.now()) {
    if (this.phase === 'crashed') return true;
    if (this.phase !== 'running') return false;
    return now - this.startAt >= this.crashTimes[index];
  }

  /** Live multiplier for one rocket, frozen at its crash point once it blows. */
  _multiplierOf(index, now = Date.now()) {
    if (!this.crashPoints) return 1;
    if (this._isDead(index, now)) return this.crashPoints[index];
    return Math.min(multiplierAt((now - this.startAt) / 1000), this.crashPoints[index]);
  }

  placeBet(player, { rocket, amount }) {
    if (this.phase !== 'betting') return { ok: false, error: 'They have already launched — wait for the next flight' };
    if (this.bets.has(player.id)) return { ok: false, error: 'You are already aboard one of them' };
    if (!Number.isInteger(rocket) || rocket < 0 || rocket >= ROCKETS.length) {
      return { ok: false, error: 'No such rocket' };
    }
    this.bets.set(player.id, { name: player.name, rocket, amount, cashedAt: null, payout: 0 });
    this.hub.broadcast('game', this.publicState());
    return { ok: true };
  }

  cashOut(player) {
    if (this.phase !== 'running') return { ok: false, error: 'Nothing to cash out' };
    const bet = this.bets.get(player.id);
    if (!bet) return { ok: false, error: 'You did not board this flight' };
    if (bet.cashedAt) return { ok: false, error: 'Already cashed out' };

    const now = Date.now();
    if (this._isDead(bet.rocket, now)) {
      return { ok: false, error: `${ROCKETS[bet.rocket].name} is already scrap` };
    }

    const rounded = Math.floor(this._multiplierOf(bet.rocket, now) * 100) / 100;
    bet.cashedAt = rounded;
    bet.payout = Math.round(bet.amount * rounded);
    this.hub.pay(player.id, bet.payout, { game: 'crash', stake: bet.amount, detail: `${rounded.toFixed(2)}x` });
    this.hub.result(player.id, {
      game: 'crash', rocket: bet.rocket, cashedAt: rounded, payout: bet.payout, staked: bet.amount,
    });
    this.hub.broadcast('game', this.publicState());
    return { ok: true };
  }

  _settle() {
    for (const [playerId, bet] of this.bets) {
      if (!bet.cashedAt) {
        this.hub.result(playerId, {
          game: 'crash', rocket: bet.rocket, cashedAt: null, payout: 0,
          staked: bet.amount, crashPoint: this.crashPoints[bet.rocket],
        });
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
    const now = Date.now();
    const bets = [];
    for (const [playerId, b] of this.bets) {
      bets.push({ playerId, name: b.name, rocket: b.rocket, amount: b.amount, cashedAt: b.cashedAt, payout: b.payout });
    }
    return {
      game: 'crash', phase: this.phase, until: this.until, serverNow: now,
      startAt: this.startAt || null, growth: GROWTH,
      rockets: ROCKETS.map((r, i) => ({
        index: i, name: r.name, color: r.color,
        dead: this._isDead(i, now),
        // A rocket's crash point is a secret right up until it blows.
        crashPoint: this._isDead(i, now) ? this.crashPoints[i] : null,
        crashAt: this.crashTimes && this._isDead(i, now) ? this.startAt + this.crashTimes[i] : null,
      })),
      bets, history: this.history,
      fuelled: this.hub.eventId() === 'rocket_fuel',
    };
  }
}
