// THE SCRAPYARD — two robots, one cage, bet on who is still standing.
//
// Each match rolls fresh stats, then the matchup is Monte-Carloed a few thousand
// times through the very same fight engine that runs the real bout. The odds are
// therefore measured, not guessed, and the real fight is simply allowed to happen
// — unlike the horse race, nothing has to be steered towards a pre-drawn result.
import { rnd, rndRange, shuffle } from '../rng.js';
import { ROBOTS } from '../../shared/config.js';

const BETTING_MS = 24000;
const RESULTS_MS = 11000;
const STEP_MS = 620;          // one exchange
const MAX_STEPS = 70;         // hard stop -> decision
const TRACK_TAKE = 0.94;      // 6% to the house

const MOVES = ['hammers', 'clubs', 'rams', 'swings at', 'lands one on', 'cracks'];
const CRITS = ['CRITICAL', 'MASSIVE HIT', 'DEVASTATING'];

function rollStats() {
  return {
    hp: Math.round(rndRange(420, 620)),
    attack: rndRange(26, 46),
    defense: rndRange(6, 20),
    speed: rndRange(0.75, 1.35),
    crit: rndRange(0.05, 0.22),
  };
}

/**
 * Play one bout. `random` is injected so the odds pass can run millions of
 * cheap rolls while the real fight uses the crypto source.
 */
function simulate(a, b, random, log = null) {
  const hp = [a.hp, b.hp];
  const charge = [0, 0];
  const swings = [0, 0];
  let winner = -1;

  for (let step = 0; step < MAX_STEPS && winner < 0; step++) {
    charge[0] += a.speed;
    charge[1] += b.speed;

    for (const actor of [0, 1]) {
      if (charge[actor] < 1 || winner >= 0) continue;
      charge[actor] -= 1;

      const me = actor === 0 ? a : b;
      const foe = actor === 0 ? b : a;
      const target = 1 - actor;
      swings[actor]++;

      let type = 'hit';
      let dmg = 0;

      if (random() < 0.08) {
        type = 'miss';
      } else {
        dmg = Math.max(4, me.attack * (0.7 + random() * 0.6) - foe.defense * (0.4 + random() * 0.6));
        if (swings[actor] % 6 === 0) { type = 'special'; dmg *= 1.6; }
        else if (random() < me.crit) { type = 'crit'; dmg *= 2.2; }
        dmg = Math.round(dmg);
        hp[target] = Math.max(0, hp[target] - dmg);
      }

      if (log) {
        log.push({
          t: step * STEP_MS + (actor === 0 ? 0 : STEP_MS / 2),
          type, actor, dmg, hp: [hp[0], hp[1]],
        });
      }

      if (hp[target] <= 0) {
        winner = actor;
        if (log) log.push({ t: step * STEP_MS + STEP_MS, type: 'ko', actor, dmg: 0, hp: [hp[0], hp[1]] });
      }
    }
  }

  if (winner < 0) {
    // Went the distance: most metal left standing takes it.
    winner = hp[0] >= hp[1] ? 0 : 1;
    if (log) log.push({ t: MAX_STEPS * STEP_MS, type: 'decision', actor: winner, dmg: 0, hp: [hp[0], hp[1]] });
  }
  return { winner, hp, events: log };
}

/** Win probability for robot A, measured over `runs` bouts. */
function winProbability(a, b, runs = 4000) {
  let wins = 0;
  for (let i = 0; i < runs; i++) if (simulate(a, b, Math.random).winner === 0) wins++;
  return wins / runs;
}

// Independently rolled stats produce hopeless mismatches surprisingly often, and
// a 97%-certain fight is both dull to watch and impossible to price: the
// underdog's true chance is far below anything the odds can express, so its side
// of the book bleeds return. Re-roll until the bout is genuinely competitive.
const MIN_P = 0.22;
const MAX_P = 0.78;

function drawMatchup() {
  let best = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    const picked = shuffle([...ROBOTS.keys()]).slice(0, 2);
    const fighters = picked.map((i) => ({ ...ROBOTS[i], index: i, ...rollStats() }));
    // Cheap screening pass first; only the survivor earns an accurate estimate.
    const rough = winProbability(fighters[0], fighters[1], 400);
    if (rough < MIN_P || rough > MAX_P) {
      if (!best || Math.abs(rough - 0.5) < Math.abs(best.rough - 0.5)) best = { fighters, rough };
      continue;
    }
    return { fighters, p: winProbability(fighters[0], fighters[1]) };
  }
  // Nothing balanced turned up; take the closest and price it honestly.
  return { fighters: best.fighters, p: winProbability(best.fighters[0], best.fighters[1]) };
}

export class Robots {
  constructor(hub) {
    this.hub = hub;
    this.bets = new Map();   // playerId -> { name, list: [{ robot, amount, odds }] }
    this.history = [];
    this.matchNo = 0;
    this._enter('betting');
  }

  _newCard() {
    this.matchNo++;
    const { fighters, p } = drawMatchup();
    this.fighters = fighters;
    this.probs = [p, 1 - p];
    this.odds = this.probs.map((q) => Math.round((TRACK_TAKE / q) * 20) / 20);
  }

  _runFight() {
    const events = [];
    const res = simulate(this.fighters[0], this.fighters[1], rnd, events);
    this.winner = res.winner;
    this.events = events;
    this.fightMs = events.length ? events[events.length - 1].t + 900 : 5000;
  }

  _enter(phase) {
    this.phase = phase;
    const now = Date.now();
    if (phase === 'betting') {
      this.bets.clear();
      this.winner = null;
      this.events = null;
      this._newCard();
      this.until = now + BETTING_MS;
    } else if (phase === 'fighting') {
      this._runFight();
      this.startAt = now;
      this.until = now + this.fightMs;
    } else {
      this._settle();
      this.history.unshift({ matchNo: this.matchNo, winner: this.fighters[this.winner].name });
      this.history = this.history.slice(0, 6);
      this.until = now + RESULTS_MS;
    }
    this.hub.broadcast('game', this.publicState());
  }

  tick(now) {
    if (now >= this.until) {
      this._enter(this.phase === 'betting' ? 'fighting' : this.phase === 'fighting' ? 'results' : 'betting');
    }
  }

  placeBet(player, { robot, amount }) {
    if (this.phase !== 'betting') return { ok: false, error: 'They are already swinging — wait for the next bout' };
    if (robot !== 0 && robot !== 1) return { ok: false, error: 'No such robot' };
    const entry = this.bets.get(player.id) || { name: player.name, list: [] };
    entry.list.push({ robot, amount, odds: this.odds[robot] });
    this.bets.set(player.id, entry);
    this.hub.broadcast('game', this.publicState());
    return { ok: true };
  }

  _settle() {
    const bonus = this.hub.eventId() === 'robot_rage' ? 1.5 : 1;
    for (const [playerId, entry] of this.bets) {
      let won = 0;
      let staked = 0;
      let winStake = 0;
      for (const b of entry.list) {
        staked += b.amount;
        if (b.robot === this.winner) {
          winStake += b.amount;
          won += Math.round(b.amount * b.odds * bonus);
        }
      }
      const name = this.fighters[this.winner].name;
      if (won > 0) this.hub.pay(playerId, won, { game: 'robots', stake: winStake, detail: name });
      this.hub.result(playerId, {
        game: 'robots', winner: this.winner, winnerName: name, staked, won, net: won - staked,
      });
    }
  }

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
      game: 'robots', phase: this.phase, until: this.until, serverNow: Date.now(),
      matchNo: this.matchNo,
      fighters: this.fighters.map((f, i) => ({
        name: f.name, color: f.color, maxHp: f.hp, odds: this.odds[i],
      })),
      startAt: this.startAt || null,
      // The whole bout is handed over at once and replayed against the server
      // clock, so every screen in the room lands the same punch at the same moment.
      events: this.phase === 'betting' ? null : this.events,
      winner: this.phase === 'results' ? this.winner : null,
      bets, history: this.history,
      bonus: this.hub.eventId() === 'robot_rage',
    };
  }
}

export const __test = { simulate, winProbability, rollStats, drawMatchup };
