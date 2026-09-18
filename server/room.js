import { CONFIG, STATIONS, AVATAR_COLORS, HATS, CIGAR, profitOf, money } from '../shared/config.js';
import { rnd, rndInt, pick } from './rng.js';
import { Round } from './round.js';
import * as Slots from './games/slots.js';
import * as Dice from './games/dice.js';
import { Blackjack } from './games/blackjack.js';
import { Roulette } from './games/roulette.js';
import { Crash } from './games/crash.js';
import { Horses } from './games/horses.js';
import { Robots } from './games/robots.js';

const STATION_BY_ID = new Map(STATIONS.map((s) => [s.id, s]));
const NAME_MAX = 14;

const SILLY_NAMES = ['Chip', 'Bust', 'Doubler', 'Lucky', 'Tilted', 'Whale', 'Grinder', 'Snake Eyes'];

export class Room {
  constructor() {
    this.players = new Map();
    this.nextId = 1;

    // Round first: the timed games ask it which event is running the moment
    // they are constructed.
    this.round = new Round(this);

    const hub = {
      broadcast: (type, data) => this.broadcast(type, data),
      pay: (playerId, amount, meta) => this.pay(playerId, amount, meta),
      result: (playerId, data) => this.send(playerId, 'result', data),
      eventId: () => this.round.eventId(),
    };

    this.games = {
      roulette: new Roulette(hub),
      crash: new Crash(hub),
      horses: new Horses(hub),
      robots: new Robots(hub),
      blackjack: new Blackjack(),
    };
    this.lastSnapshot = 0;
    this.lastBoard = 0;
  }

  // ---------------------------------------------------------------- players

  addPlayer(ws, rawName) {
    const id = String(this.nextId++);
    const used = new Set([...this.players.values()].map((p) => p.color));
    const free = AVATAR_COLORS.filter((c) => !used.has(c));
    const player = {
      id, ws,
      name: this._cleanName(rawName),
      color: free.length ? pick(free) : pick(AVATAR_COLORS),
      hat: pick(HATS),
      money: CONFIG.STARTING_BANKROLL,
      loans: 0,
      wagered: 0,
      biggestWin: 0,
      pos: [rnd() * 14 - 7, 0, 34 + rnd() * 3],
      yaw: 0,
      anim: 0,
      station: null,
      lastLoanAt: 0,
      betCooldowns: {},
      freeSpins: null,
      cigar: null,
      lastPuffAt: 0,
      joinedAt: Date.now(),
    };
    this.players.set(id, player);

    this.send(id, 'welcome', {
      id,
      config: CONFIG,
      you: this.publicPlayer(player),
      players: this.publicPlayers(),
      round: this.round.state(),
      games: {
        roulette: this.games.roulette.publicState(),
        crash: this.games.crash.publicState(),
        horses: this.games.horses.publicState(),
      },
    });
    this.sendWallet(player);
    this.broadcast('players', this.publicPlayers());
    this.toastAll(`${player.name} walked in.`, 'info');
    return player;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.games.blackjack.clear(id);
    this.players.delete(id);
    this.broadcast('players', this.publicPlayers());
    this.toastAll(`${p.name} cashed out and left.`, 'info');
  }

  _cleanName(raw) {
    let name = String(raw || '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, NAME_MAX);
    if (!name) name = `${pick(SILLY_NAMES)}${rndInt(90) + 10}`;
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    let candidate = name;
    let n = 2;
    while (taken.has(candidate.toLowerCase())) candidate = `${name.slice(0, NAME_MAX - 2)}${n++}`;
    return candidate;
  }

  publicPlayer(p) {
    // `cigar` rides along in the player list so everyone can see who is smoking.
    return { id: p.id, name: p.name, color: p.color, hat: p.hat, cigar: !!p.cigar };
  }

  publicPlayers() {
    return [...this.players.values()].map((p) => this.publicPlayer(p));
  }

  resetBankrolls() {
    for (const p of this.players.values()) {
      p.money = CONFIG.STARTING_BANKROLL;
      p.loans = 0;
      p.freeSpins = null;
      p.cigar = null;
      p.wagered = 0;
      p.biggestWin = 0;
      p.joinedAt = Date.now();
      this.games.blackjack.clear(p.id);
      this.sendWallet(p);
    }
    // Cigars are cleared above, so everyone needs a fresh player list or they
    // will keep seeing smoke that no longer exists.
    this.broadcast('players', this.publicPlayers());
  }

  standings() {
    return [...this.players.values()]
      .map((p) => ({
        id: p.id, name: p.name, color: p.color, hat: p.hat,
        money: Math.round(p.money), loans: p.loans,
        wagered: Math.round(p.wagered), biggestWin: Math.round(p.biggestWin),
        profit: profitOf(p),
      }))
      .sort((a, b) => b.profit - a.profit);
  }

  // ------------------------------------------------------------------ money

  sendWallet(p) {
    this.send(p.id, 'wallet', {
      money: Math.round(p.money),
      loans: p.loans,
      profit: profitOf(p),
      wagered: Math.round(p.wagered),
      canLoan: this.loanAvailableIn(p) === 0,
      loanIn: this.loanAvailableIn(p),
    });
  }

  /** Takes the stake off a player. Returns false if they cannot cover it. */
  wager(p, amount) {
    const amt = Math.round(amount);
    if (!Number.isFinite(amt) || amt < CONFIG.MIN_BET) return false;
    if (amt > CONFIG.MAX_BET) return false;
    if (p.money < amt) return false;
    p.money -= amt;
    p.wagered += amt;
    this.sendWallet(p);
    return true;
  }

  /** Give a stake back without it counting as a win (round ended mid-hand). */
  refund(playerId, amount) {
    const p = this.players.get(playerId);
    if (!p || amount <= 0) return;
    p.money += amount;
    p.wagered = Math.max(0, p.wagered - amount);
    this.sendWallet(p);
    this.send(p.id, 'toast', { text: `Round over — ${money(amount)} returned from the table.`, kind: 'warn' });
  }

  /** Called at the bell: nobody loses a stake to a spin that never happened. */
  abortOpenBets() {
    const refund = (playerId, amount) => this.refund(playerId, amount);
    this.games.roulette.abort(refund);
    this.games.crash.abort(refund);
    this.games.horses.abort(refund);
    this.games.robots.abort(refund);
    this.games.blackjack.abort(refund);
  }

  resetGames() {
    this.games.roulette.reset();
    this.games.crash.reset();
    this.games.horses.reset();
    this.games.robots.reset();
  }

  /** LAST CALL boosts winnings only, never the returned stake. */
  pay(playerId, amount, meta = {}) {
    const p = this.players.get(playerId);
    if (!p || amount <= 0) return 0;
    const boost = this.round.payBoost();
    let final = Math.round(amount);
    if (boost > 1) {
      const stake = meta.stake || 0;
      const winnings = Math.max(0, final - stake);
      final = Math.round(final + winnings * (boost - 1));
    }
    p.money += final;
    const net = final - (meta.stake || 0);
    if (net > p.biggestWin) p.biggestWin = net;
    this.sendWallet(p);
    if (meta.game && net >= 2500) {
      this.toastAll(`${p.name} just took $${net.toLocaleString('en-US')} off the ${labelFor(meta.game)}!`, 'big');
    }
    return final;
  }

  loanAvailableIn(p) {
    if (this.round.phase !== 'live') return -1;
    if (p.money > CONFIG.LOAN_MAX_BALANCE) return -1;
    const wait = CONFIG.LOAN_COOLDOWN_MS - (Date.now() - p.lastLoanAt);
    return wait > 0 ? wait : 0;
  }

  takeLoan(p) {
    const status = this.loanAvailableIn(p);
    if (status === -1) {
      return { ok: false, error: p.money > CONFIG.LOAN_MAX_BALANCE
        ? `The ATM only helps you below $${CONFIG.LOAN_MAX_BALANCE}`
        : 'The ATM is closed between rounds' };
    }
    if (status > 0) return { ok: false, error: `ATM recharging — ${Math.ceil(status / 1000)}s` };
    p.money += CONFIG.LOAN_AMOUNT;
    p.loans += CONFIG.LOAN_AMOUNT;
    p.lastLoanAt = Date.now();
    this.sendWallet(p);
    this.send(p.id, 'toast', { text: `Borrowed $${CONFIG.LOAN_AMOUNT}. It counts against your profit.`, kind: 'warn' });
    this.toastAll(`${p.name} hit the bankruptcy ATM. Again.`, 'info');
    return { ok: true };
  }

  // ------------------------------------------------------------- networking

  send(playerId, type, data) {
    const p = this.players.get(playerId);
    if (!p || p.ws.readyState !== 1) return;
    p.ws.send(JSON.stringify({ t: type, d: data }));
  }

  broadcast(type, data) {
    const payload = JSON.stringify({ t: type, d: data });
    for (const p of this.players.values()) {
      if (p.ws.readyState === 1) p.ws.send(payload);
    }
  }

  toastAll(text, kind = 'info') {
    this.broadcast('toast', { text, kind });
  }

  error(p, text) {
    this.send(p.id, 'toast', { text, kind: 'error' });
  }

  // --------------------------------------------------------------- stations

  nearStation(p, stationId) {
    const st = STATION_BY_ID.get(stationId);
    if (!st) return null;
    const dx = p.pos[0] - st.pos[0];
    const dz = p.pos[2] - st.pos[2];
    // Generous slack: LAN latency should never cost somebody a bet.
    const reach = st.radius + 3.5;
    return dx * dx + dz * dz <= reach * reach ? st : null;
  }

  // ---------------------------------------------------------------- message

  handle(p, msg) {
    switch (msg.t) {
      case 'move': return this.onMove(p, msg.d);
      case 'enter': return this.onEnter(p, msg.d);
      case 'exit': return this.onExit(p);
      case 'bet': return this.onBet(p, msg.d);
      case 'act': return this.onAct(p, msg.d);
      case 'loan': return this.takeLoan(p);
      case 'puff': return this.onPuff(p);
      case 'ping': return this.send(p.id, 'pong', { c: msg.d && msg.d.c, serverNow: Date.now() });
      default: return undefined;
    }
  }

  onMove(p, d) {
    if (!d || !Array.isArray(d.p) || d.p.length !== 3) return;
    const [x, y, z] = d.p;
    if (![x, y, z].every(Number.isFinite)) return;
    p.pos[0] = clamp(x, -60, 60);
    p.pos[1] = clamp(y, -2, 30);
    p.pos[2] = clamp(z, -60, 60);
    if (Number.isFinite(d.y)) p.yaw = d.y;
    p.anim = d.a | 0;
  }

  onEnter(p, d) {
    const st = this.nearStation(p, d && d.station);
    if (!st) return this.error(p, 'Walk up to it first');
    p.station = st.id;
    if (st.game === 'blackjack') {
      this.send(p.id, 'result', { game: 'blackjack', ...this.games.blackjack.stateFor(p.id) });
    }
    if (st.game === 'slots') {
      this.send(p.id, 'result', {
        game: 'slots', idle: true, freeLeft: p.freeSpins ? p.freeSpins.left : 0,
      });
    }
    if (st.game === 'roulette') this.send(p.id, 'game', this.games.roulette.publicState());
    if (st.game === 'crash') this.send(p.id, 'game', this.games.crash.publicState());
    if (st.game === 'horses') this.send(p.id, 'game', this.games.horses.publicState());
    if (st.game === 'robots') this.send(p.id, 'game', this.games.robots.publicState());
  }

  onExit(p) { p.station = null; }

  _guardBet(p, d, cooldownMs = 0) {
    if (this.round.phase !== 'live') { this.error(p, 'The floor is closed between rounds'); return null; }
    const st = this.nearStation(p, d && d.station);
    if (!st) { this.error(p, 'Walk up to the table first'); return null; }
    // Debounce per game, not globally: placing a roulette chip must not swallow
    // the blackjack deal you press a moment later.
    const now = Date.now();
    if (cooldownMs) {
      const last = p.betCooldowns[d.game] || 0;
      if (now - last < cooldownMs) return null;
      p.betCooldowns[d.game] = now;
    }
    const amount = Math.round(Number(d.amount));
    if (!Number.isFinite(amount) || amount < CONFIG.MIN_BET) {
      this.error(p, `Minimum bet is $${CONFIG.MIN_BET}`); return null;
    }
    if (amount > CONFIG.MAX_BET) { this.error(p, `Table limit is $${CONFIG.MAX_BET}`); return null; }
    if (p.money < amount) { this.error(p, 'Not enough chips'); return null; }
    return { st, amount };
  }

  onBet(p, d) {
    const game = d && d.game;

    if (game === 'slots') {
      const inFree = !!(p.freeSpins && p.freeSpins.left > 0);
      let stake;

      if (inFree) {
        // A free spin costs nothing, so it skips the wager but still has to
        // pass the same floor, proximity and debounce checks.
        if (this.round.phase !== 'live') return this.error(p, 'The floor is closed between rounds');
        if (!this.nearStation(p, d && d.station)) return this.error(p, 'Walk up to the machine first');
        const now = Date.now();
        if (now - (p.betCooldowns.slots || 0) < 450) return undefined;
        p.betCooldowns.slots = now;
        stake = p.freeSpins.stake;
      } else {
        const g = this._guardBet(p, d, 450); if (!g) return;
        if (!this.wager(p, g.amount)) return;
        stake = g.amount;
      }

      const boost = this.round.eventId() === 'happy_hour' ? 2 : 1;
      const res = Slots.spin(stake, boost, p.freeSpins);
      if (inFree) p.freeSpins.left--;

      if (res.triggered) {
        p.freeSpins = p.freeSpins && p.freeSpins.left > 0
          ? { ...p.freeSpins, left: p.freeSpins.left + Slots.FREE_SPINS }
          : { left: Slots.FREE_SPINS, stake };
      }
      if (res.payout > 0) this.pay(p.id, res.payout, { game: 'slots', stake });
      if (p.freeSpins && p.freeSpins.left <= 0) p.freeSpins = null;

      return this.send(p.id, 'result', {
        game: 'slots', ...res, stake, boost,
        freeLeft: p.freeSpins ? p.freeSpins.left : 0,
      });
    }

    if (game === 'dice') {
      const g = this._guardBet(p, d, 450); if (!g) return;
      const mode = d.mode === 'over' ? 'over' : 'under';
      const target = Math.round(Number(d.target));
      if (!Number.isFinite(target) || target < Dice.MIN_TARGET || target > Dice.MAX_TARGET) {
        return this.error(p, `Target must be between ${Dice.MIN_TARGET} and ${Dice.MAX_TARGET}`);
      }
      if (!this.wager(p, g.amount)) return;
      const edgeFree = this.round.eventId() === 'loaded_dice';
      const res = Dice.roll(g.amount, mode, target, edgeFree);
      if (res.payout > 0) this.pay(p.id, res.payout, { game: 'dice', stake: g.amount });
      return this.send(p.id, 'result', { game: 'dice', ...res, mode, target, stake: g.amount, edgeFree });
    }

    if (game === 'blackjack') {
      const g = this._guardBet(p, d, 300); if (!g) return;
      const bj = this.games.blackjack;
      const pre = bj.deal(p.id, g.amount);
      if (!pre.ok) return this.error(p, pre.error);
      if (!this.wager(p, g.amount)) { bj.clear(p.id); return; }
      if (pre.settled) this._settleBlackjack(p, pre.settled);
      return this.send(p.id, 'result', { game: 'blackjack', ...bj.stateFor(p.id) });
    }

    if (game === 'roulette') {
      const g = this._guardBet(p, d, 0); if (!g) return;
      const res = this.games.roulette.placeBet(p, { betId: d.betId, amount: g.amount });
      if (!res.ok) return this.error(p, res.error);
      return this.wager(p, g.amount);
    }

    if (game === 'crash') {
      const g = this._guardBet(p, d, 0); if (!g) return;
      const res = this.games.crash.placeBet(p, { rocket: d.rocket | 0, amount: g.amount });
      if (!res.ok) return this.error(p, res.error);
      return this.wager(p, g.amount);
    }

    if (game === 'horses') {
      const g = this._guardBet(p, d, 0); if (!g) return;
      const res = this.games.horses.placeBet(p, { horse: d.horse | 0, amount: g.amount });
      if (!res.ok) return this.error(p, res.error);
      return this.wager(p, g.amount);
    }

    if (game === 'robots') {
      const g = this._guardBet(p, d, 0); if (!g) return;
      const res = this.games.robots.placeBet(p, { robot: d.robot | 0, amount: g.amount });
      if (!res.ok) return this.error(p, res.error);
      return this.wager(p, g.amount);
    }

    if (game === 'cigar') return this.buyCigar(p, d);

    return this.error(p, 'Unknown game');
  }

  // ------------------------------------------------------------------ cigar

  /**
   * A cigar does nothing mechanically. It costs real money, which comes
   * straight off your profit, and everyone in the room can see it.
   */
  buyCigar(p, d) {
    if (this.round.phase !== 'live') return this.error(p, 'The counter is shut between rounds');
    if (!this.nearStation(p, d && d.station)) return this.error(p, 'Walk up to the counter first');
    if (p.cigar) return this.error(p, 'You already have one going');
    if (p.money < CIGAR.PRICE) return this.error(p, `A cigar costs ${money(CIGAR.PRICE)}`);

    // Deducted directly rather than through wager(): it is an expense, not a bet,
    // so it must not inflate the amount-wagered column.
    p.money -= CIGAR.PRICE;
    p.cigar = { puffs: CIGAR.PUFFS };
    this.sendWallet(p);
    this.broadcast('players', this.publicPlayers());
    this.send(p.id, 'result', { game: 'cigar', puffs: p.cigar.puffs, bought: true });
    this.toastAll(`${p.name} lit a cigar. Very classy.`, 'info');
    return undefined;
  }

  onPuff(p) {
    if (!p.cigar || p.cigar.puffs <= 0) return undefined;
    const now = Date.now();
    if (now - p.lastPuffAt < 700) return undefined;
    p.lastPuffAt = now;

    p.cigar.puffs--;
    this.broadcast('puff', { playerId: p.id });

    if (p.cigar.puffs <= 0) {
      p.cigar = null;
      this.broadcast('players', this.publicPlayers());
      this.send(p.id, 'toast', { text: 'Your cigar burned out.', kind: 'info' });
    }
    this.send(p.id, 'result', { game: 'cigar', puffs: p.cigar ? p.cigar.puffs : 0 });
    return undefined;
  }

  onAct(p, d) {
    const game = d && d.game;

    if (game === 'blackjack') {
      if (!this.nearStation(p, d.station)) return this.error(p, 'Walk up to the table first');
      const bj = this.games.blackjack;
      if (d.action === 'double') {
        const state = bj.stateFor(p.id);
        if (state.phase !== 'player') return this.error(p, 'No hand in play');
        if (p.money < state.bet) return this.error(p, 'Not enough chips to double');
      }
      const res = bj.action(p.id, d.action, this.round.eventId() === 'lucky_21');
      if (!res.ok) return this.error(p, res.error);
      if (res.extraStake) this.wager(p, res.extraStake);
      if (res.settled) this._settleBlackjack(p, res.settled);
      return this.send(p.id, 'result', { game: 'blackjack', ...bj.stateFor(p.id) });
    }

    if (game === 'crash') {
      if (d.action !== 'cashout') return;
      if (!this.nearStation(p, d.station)) return this.error(p, 'Get back to the lounge');
      const res = this.games.crash.cashOut(p);
      if (!res.ok) return this.error(p, res.error);
      return undefined;
    }

    if (game === 'roulette' && d.action === 'clear') {
      const res = this.games.roulette.clearBets(p);
      if (!res.ok) return this.error(p, res.error);
      p.money += res.refund;
      p.wagered -= res.refund;
      return this.sendWallet(p);
    }

    return undefined;
  }

  _settleBlackjack(p, settled) {
    if (settled.payout > 0) this.pay(p.id, settled.payout, { game: 'blackjack', stake: settled.bet });
  }

  // ------------------------------------------------------------------- tick

  tick() {
    const now = Date.now();
    this.round.tick(now);

    if (this.round.phase === 'live') {
      this.games.roulette.tick(now);
      this.games.crash.tick(now);
      this.games.horses.tick(now);
      this.games.robots.tick(now);
    }

    if (now - this.lastSnapshot >= 1000 / CONFIG.SNAPSHOT_HZ) {
      this.lastSnapshot = now;
      const snap = [];
      for (const p of this.players.values()) {
        snap.push([p.id, r2(p.pos[0]), r2(p.pos[1]), r2(p.pos[2]), r2(p.yaw), p.anim]);
      }
      if (snap.length) this.broadcast('snap', snap);
    }

    if (now - this.lastBoard >= 1500) {
      this.lastBoard = now;
      if (this.players.size) this.broadcast('board', this.standings());
      for (const p of this.players.values()) {
        if (p.money <= CONFIG.LOAN_MAX_BALANCE) this.sendWallet(p);
      }
    }
  }
}

function labelFor(game) {
  return { slots: 'slots', dice: 'dice', blackjack: 'blackjack table', roulette: 'roulette wheel', crash: 'rocket', horses: 'track' }[game] || 'floor';
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r2 = (v) => Math.round(v * 100) / 100;
