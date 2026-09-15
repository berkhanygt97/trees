// Six-runner sprint down a straight track. Odds are generated per race, the
// winner is drawn from those exact odds, and only then is a race simulated
// that finishes in that order — so what you see always matches what you were paid.
import { rnd, rndRange } from '../rng.js';
import { HORSES } from '../../shared/config.js';

const BETTING_MS = 26000;
const RESULTS_MS = 11000;
const TRACK_TAKE = 0.90; // 10% to the house

function drawFrom(probs, pool) {
  const total = pool.reduce((s, i) => s + probs[i], 0);
  let r = rnd() * total;
  for (const i of pool) {
    r -= probs[i];
    if (r <= 0) return i;
  }
  return pool[pool.length - 1];
}

export class Horses {
  constructor(hub) {
    this.hub = hub;
    this.bets = new Map(); // playerId -> { name, list: [{horse, amount}] }
    this.history = [];
    this.raceNo = 0;
    this._enter('betting');
  }

  _newCard() {
    const weights = HORSES.map(() => 0.45 + rnd() * 2.0);
    const total = weights.reduce((a, b) => a + b, 0);
    this.probs = weights.map((w) => w / total);
    this.odds = this.probs.map((p) => Math.max(1.25, Math.round((TRACK_TAKE / p) * 20) / 20));
    this.raceNo++;
  }

  _runRace() {
    const n = HORSES.length;
    const order = [];
    const remaining = [...Array(n).keys()];
    while (remaining.length) {
      const pickIdx = drawFrom(this.probs, remaining);
      order.push(pickIdx);
      remaining.splice(remaining.indexOf(pickIdx), 1);
    }
    // Finish times: winner fastest, field strung out behind by a realistic gap.
    const times = [rndRange(15.5, 18.0)];
    for (let i = 1; i < n; i++) times.push(times[i - 1] + rndRange(0.18, 1.1));

    this.finishTimes = new Array(n);
    order.forEach((horse, place) => { this.finishTimes[horse] = times[place]; });
    this.order = order;
    this.winner = order[0];
    this.phases = HORSES.map(() => rnd() * Math.PI * 2);
    this.raceDuration = Math.max(...this.finishTimes);
  }

  _enter(phase) {
    this.phase = phase;
    const now = Date.now();
    if (phase === 'betting') {
      this.bets.clear();
      this.winner = null;
      this.order = null;
      this._newCard();
      this.until = now + BETTING_MS;
    } else if (phase === 'racing') {
      this._runRace();
      this.startAt = now;
      this.until = now + (this.raceDuration + 1.2) * 1000;
    } else {
      this._settle();
      this.history.unshift({ raceNo: this.raceNo, winner: this.winner, odds: this.odds[this.winner] });
      this.history = this.history.slice(0, 8);
      this.until = now + RESULTS_MS;
    }
    this.hub.broadcast('game', this.publicState());
  }

  tick(now) {
    if (now >= this.until) {
      this._enter(this.phase === 'betting' ? 'racing' : this.phase === 'racing' ? 'results' : 'betting');
    }
  }

  /** 0..1 along the track for each runner at time `t` seconds into the race. */
  progressAt(t) {
    if (!this.finishTimes) return HORSES.map(() => 0);
    return this.finishTimes.map((T, i) => {
      const base = Math.min(1, t / T);
      if (base >= 1) return 1;
      // A decaying wobble so the lead changes hands mid-race.
      const wobble = 0.07 * Math.sin(t * 1.9 + this.phases[i]) * (1 - base);
      return Math.max(0, Math.min(0.999, base + wobble));
    });
  }

  placeBet(player, { horse, amount }) {
    if (this.phase !== 'betting') return { ok: false, error: 'They are already running — wait for the next race' };
    if (!Number.isInteger(horse) || horse < 0 || horse >= HORSES.length) return { ok: false, error: 'No such runner' };
    const entry = this.bets.get(player.id) || { name: player.name, list: [] };
    entry.list.push({ horse, amount, odds: this.odds[horse] });
    this.bets.set(player.id, entry);
    this.hub.broadcast('game', this.publicState());
    return { ok: true };
  }

  _settle() {
    const bonus = this.hub.eventId() === 'photo_finish' ? 1.5 : 1;
    for (const [playerId, entry] of this.bets) {
      let won = 0;
      let staked = 0;
      let winStake = 0;
      for (const b of entry.list) {
        staked += b.amount;
        if (b.horse === this.winner) {
          winStake += b.amount;
          won += Math.round(b.amount * b.odds * bonus);
        }
      }
      if (won > 0) this.hub.pay(playerId, won, { game: 'horses', stake: winStake, detail: HORSES[this.winner].name });
      this.hub.result(playerId, {
        game: 'horses', winner: this.winner, winnerName: HORSES[this.winner].name,
        staked, won, net: won - staked,
      });
    }
  }

  /** Round over: tear up the tickets on any race that never finished. */
  abort(refund) {
    if (this.phase !== 'results') {
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
      bets.push({ playerId, name: e.name, list: e.list, total: e.list.reduce((s, b) => s + b.amount, 0) });
    }
    return {
      game: 'horses', phase: this.phase, until: this.until, serverNow: Date.now(),
      raceNo: this.raceNo, odds: this.odds, startAt: this.startAt || null,
      finishTimes: this.phase === 'betting' ? null : this.finishTimes,
      phases: this.phase === 'betting' ? null : this.phases,
      winner: this.phase === 'results' ? this.winner : null,
      order: this.phase === 'results' ? this.order : null,
      bets, history: this.history,
      bonus: this.hub.eventId() === 'photo_finish',
    };
  }
}
