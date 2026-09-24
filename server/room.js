import { CONFIG, AVATAR_COLORS, HATS, CIGAR, money } from '../shared/config.js';
import {
  CROP_BY_ID, ITEMS, SELLABLE, HOUSES, ANIMAL_HOUSES, PROCESSORS, PROCESS_QUEUE_MAX,
  FIELD_SIZES, FIELD_PRICES, FIELD_LEVELS, VEHICLE_BY_ID, MAX_VEHICLES,
  IMPLEMENT_BY_ID, PAINTS, RESALE, GUN_BY_ID, PLAYER_HP, WORKER_ROLES, RESTAURANTS, levelOf, levelProgress,
} from '../shared/catalog.js';
import {
  BOUNDS, PLOTS, STATION_BY_ID, TOWN_SPAWN, PAD_KEYS, plotSpawn, tileCenter, tileIndex,
  padStation, validateLayout, cleanLayout, defaultLayout, LOT_BY_ID, LOTS,
} from '../shared/map.js';
import { rnd, pick } from './rng.js';
import { CasinoEvents } from './casino-events.js';
import { Clock } from './clock.js';
import { Market, Orders } from './economy.js';
import { slugOf } from './save.js';
import { SAVE_VERSION, versionOf, upgradeProfile, upgradeWorld } from './migrate.js';
import { Wildlife } from './boars.js';
import { Staff } from './workers.js';
import { Restaurants } from './restaurants.js';
import {
  workTile, rainOn, lightningOn, settleBuildings, settleAnimals, settleProcessor,
  storageUsed, storageCap, storageFree, addItem, takeItem, newProfile, migrateProfile, toSave,
  feedAnimals, collectAnimals, loadProcessor, collectProcessor,
} from './farm.js';
import * as Slots from './games/slots.js';
import * as Dice from './games/dice.js';
import { Blackjack } from './games/blackjack.js';
import { Roulette } from './games/roulette.js';
import { Crash } from './games/crash.js';
import { Horses } from './games/horses.js';
import { Robots } from './games/robots.js';

const NAME_MAX = 14;
const HAND_REACH = 4.5;          // metres from a player to a tile they work by hand
const MACHINE_REACH = 8;         // metres from a tractor to a tile under its implement
const AUTOSAVE_MS = 30_000;
const RAIN_EVERY_MS = 20_000;

// Which counter sells what. A purchase is refused anywhere else.
const SHOP_OF = {
  seed: 'farmshop', feed: 'animalshop', animal: 'animalshop', coop: 'animalshop', barn: 'animalshop', pen: 'animalshop',
  mill: 'builder', dairy: 'builder', bakery: 'builder', house: 'builder',
  field: 'landoffice', lot: 'landoffice', implement: 'machinery', gun: 'gunshop',
};

const LAYOUT_FEE = 100;           // per building (or field) moved with the planner

const KO_MS = 4000;
const REGEN_DELAY_MS = 5000;
const REGEN_PER_S = 6;

export class Room {
  /**
   * `store` is a SaveStore (or null for a throwaway room in tests);
   * `timeScale` speeds up the world clock.
   */
  constructor({ store = null, timeScale = CONFIG.TIME_SCALE } = {}) {
    this.store = store;
    this.players = new Map();    // session id -> profile, online only
    this.byId = new Map();       // every session id ever issued -> profile (late payouts)
    this.profiles = new Map();   // slug -> profile, online and offline
    this.nextId = 1;

    let world = store ? store.loadWorld() : null;
    const raws = store ? store.loadPlayers() : [];
    // Saves from before 3.0 are copied aside once, then brought up to date.
    if (store && [world, ...raws].some((f) => f && versionOf(f) < SAVE_VERSION)) store.backupOnce('backup-pre-v3');
    world = upgradeWorld(world);
    for (const raw of dedupePlots(raws)) {
      const p = migrateProfile(upgradeProfile(raw));
      this.profiles.set(p.slug, p);
    }
    this.clock = new Clock(world && world.clock, timeScale);
    this.market = new Market(world && world.market);
    this.orders = new Orders(world && world.orders);
    this.orders.refill(this.clock.time, this._topLevel());

    this.round = new CasinoEvents(this);
    this.wildlife = new Wildlife(this);
    this.restaurants = new Restaurants(this);
    this.staff = new Staff(this, world && world.staff);

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
    this.lastSave = Date.now();
    this.lastRain = 0;
    this.lastClockSync = 0;
    this.lastWorld = this.clock.time;
    this.marketDirty = false;
  }

  // ---------------------------------------------------------------- players

  /**
   * Returns the profile, or { denied } if that name is already in the game.
   * `key` is a random id the browser keeps, so a player whose connection
   * dropped can walk straight back in and take over their own old session.
   */
  addPlayer(ws, rawName, key = null) {
    const name = this._cleanName(rawName);
    if (!name) return { denied: 'Type a name — it is how your farm is saved.' };
    const slug = slugOf(name);
    key = typeof key === 'string' ? key.slice(0, 64) : null;

    let p = this.profiles.get(slug);
    if (p && p.ws) {
      const sameBrowser = key && p.key === key;
      const stale = Date.now() - (p.lastSeen || 0) > 6000;
      if (!sameBrowser && !stale) return { denied: `${p.name} is already playing. Pick another name.` };
      const old = p.ws;
      this._detach(p);
      try { old.terminate(); } catch { /* already gone */ }
    }

    const isNew = !p;
    if (isNew) {
      const usedColors = new Set([...this.profiles.values()].map((q) => q.color));
      const freeColors = AVATAR_COLORS.filter((c) => !usedColors.has(c));
      const plot = this._freePlot();
      const spawn = plot >= 0 ? plotSpawn(PLOTS[plot]) : TOWN_SPAWN;
      p = newProfile({
        name, slug,
        color: freeColors.length ? pick(freeColors) : pick(AVATAR_COLORS),
        hat: pick(HATS),
        plot,
        cash: CONFIG.STARTING_BANKROLL,
        pos: [...spawn.pos], yaw: spawn.yaw,
      });
      this.profiles.set(slug, p);
    }

    const id = String(this.nextId++);
    Object.assign(p, {
      id, ws, key,
      lastSeen: Date.now(),
      anim: 0,
      station: null,
      betCooldowns: {},
      freeSpins: null,
      cigar: null,
      lastPuffAt: 0,
      vehicle: null,
      lastWorkAt: 0,
      joinedAt: Date.now(),
      // Health and the gun in your hands live only as long as the session.
      hp: PLAYER_HP,
      lastHurt: 0,
      koUntil: 0,
      mag: GUN_BY_ID[p.gun].mag,
      reloadUntil: 0,
      lastShot: 0,
    });
    this.players.set(id, p);
    this.byId.set(id, p);
    settleBuildings(p, this.clock.time);
    this.wildlife.greet(p);

    this.send(id, 'welcome', {
      id,
      config: CONFIG,
      you: this.publicPlayer(p),
      isNew,
      spawn: { pos: p.pos, yaw: p.yaw },
      players: this.publicPlayers(),
      round: this.round.state(),
      clock: this.clock.state(),
      market: this.market.state(),
      orders: this.orders.state(),
      plots: this.publicPlots(),
      vehicles: this.publicVehicles(),
      boars: this.wildlife.snapshot(),
      workers: this.staff.publicWorkers(),
      restaurants: this.restaurants.publicRestaurants(),
      npcs: this.restaurants.snapshotNpcs(),
      games: {
        roulette: this.games.roulette.publicState(),
        crash: this.games.crash.publicState(),
        horses: this.games.horses.publicState(),
      },
    });
    this.sendWallet(p);
    this.broadcast('players', this.publicPlayers());
    this.broadcast('plot', this.publicPlot(p.plot));
    if (isNew) {
      this.toastAll(`${p.name} moved to the valley.`, 'info');
      if (p.plot < 0) this.error(p, 'All six farms are taken — you can still play the casino and drive.');
    } else {
      this.toastAll(`${p.name} is back.`, 'info');
    }
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this._detach(p);
    this.saveProfile(p);
    this.broadcast('players', this.publicPlayers());
    this.broadcast('plot', this.publicPlot(p.plot));
    this.toastAll(`${p.name} went home for the night.`, 'info');
  }

  /** Ends a session without touching the farm: used on leave and on reconnect. */
  _detach(p) {
    // A blackjack hand in play is voided rather than lost.
    const hand = this.games.blackjack.hands.get(p.id);
    if (hand && hand.phase === 'player') p.money += hand.bet;
    this.games.blackjack.clear(p.id);
    this._leaveVehicle(p);
    this.players.delete(p.id);
    p.ws = null;
    p.stats.playSeconds += Math.round((Date.now() - p.joinedAt) / 1000);
    p.joinedAt = Date.now();
  }

  _cleanName(raw) {
    return String(raw || '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, NAME_MAX);
  }

  _freePlot() {
    const taken = new Set([...this.profiles.values()].map((p) => p.plot));
    for (const plot of PLOTS) if (!taken.has(plot.index)) return plot.index;
    return -1;
  }

  _topLevel() {
    let lvl = 1;
    for (const p of this.profiles.values()) lvl = Math.max(lvl, levelOf(p.xp));
    return lvl;
  }

  publicPlayer(p) {
    // `cigar` rides along in the player list so everyone can see who is smoking.
    return { id: p.id, slug: p.slug, name: p.name, color: p.color, hat: p.hat, cigar: !!p.cigar, plot: p.plot };
  }

  publicPlayers() {
    return [...this.players.values()].map((p) => this.publicPlayer(p));
  }

  // ------------------------------------------------------------------ plots

  publicPlot(index) {
    if (index == null || index < 0) return null;
    const owner = [...this.profiles.values()].find((p) => p.plot === index);
    if (!owner) return { index, owner: null };
    const b = owner.buildings;
    return {
      index,
      owner: owner.name,
      color: owner.color,
      online: !!owner.ws,
      size: owner.field.size,
      tiles: owner.field.tiles,
      house: owner.house,
      layout: owner.layout,
      buildings: {
        coop: b.coop ? b.coop.animals : null,
        barn: b.barn ? b.barn.animals : null,
        pen: b.pen ? b.pen.animals : null,
        mill: !!b.mill, dairy: !!b.dairy, bakery: !!b.bakery,
      },
    };
  }

  publicPlots() {
    return PLOTS.map((plot) => this.publicPlot(plot.index));
  }

  _ownerOf(index) {
    for (const p of this.profiles.values()) if (p.plot === index) return p;
    return null;
  }

  // --------------------------------------------------------------- vehicles

  publicVehicles() {
    const out = [];
    for (const p of this.profiles.values()) {
      for (const v of p.vehicles) {
        out.push({
          id: v.id, owner: p.slug, ownerName: p.name, model: v.model, color: v.color,
          pos: v.pos, yaw: v.yaw, implement: v.implement || null, driver: v.driver || null,
        });
      }
    }
    return out;
  }

  _findVehicle(p, vid) {
    return p.vehicles.find((v) => v.id === vid) || null;
  }

  _leaveVehicle(p, at) {
    if (!p.vehicle) return;
    const v = this._findVehicle(p, p.vehicle);
    if (v) {
      v.driver = null;
      if (at) { v.pos = at.pos; v.yaw = at.yaw; }
    }
    p.vehicle = null;
    this.broadcast('vehicles', this.publicVehicles());
  }

  // ---------------------------------------------------------- neighbourhoods

  /** You build on your own hood's street; farmers without a hood use the Strip downtown. */
  lotAllowed(p, lot) {
    return lot.hood == null ? p.plot < 0 : lot.hood === p.plot;
  }

  /** Lots this farmer may build on, for the Land Office. */
  lotIdsFor(p) {
    return LOTS.filter((l) => this.lotAllowed(p, l)).map((l) => l.id);
  }

  /**
   * Where a phone order goes: half the time somewhere in the restaurant's own
   * neighbourhood, otherwise downtown or (now and then) across the valley.
   */
  deliveryDest(p, lot, spots) {
    const r = rnd();
    const home = spots.filter((s) => lot.hood != null && s.hood === lot.hood);
    const town = spots.filter((s) => s.hood == null);
    const away = spots.filter((s) => s.hood != null && s.hood !== lot.hood);
    const pool = home.length && r < 0.5 ? home : town.length && r < 0.8 ? town : away.length ? away : spots;
    return pick(pool);
  }

  // ------------------------------------------------------------ net worth

  netWorth(p) {
    let assets = 0;
    for (const v of p.vehicles) assets += (VEHICLE_BY_ID[v.model] || { price: 0 }).price;
    for (const i of p.implements) assets += (IMPLEMENT_BY_ID[i] || { price: 0 }).price;
    for (const g of p.guns) assets += (GUN_BY_ID[g] || { price: 0 }).price;
    let tills = 0;
    for (const res of p.restaurants) {
      assets += (LOT_BY_ID.get(res.lot) || { price: 0 }).price;
      tills += res.till || 0;
    }
    assets += HOUSES[p.house].price;
    for (let k = 0; k < FIELD_SIZES.length; k++) if (FIELD_SIZES[k] <= p.field.size) assets += FIELD_PRICES[k];
    for (const [kind, def] of Object.entries(ANIMAL_HOUSES)) {
      const b = p.buildings[kind];
      if (b) assets += def.price + b.animals * def.animalPrice;
    }
    for (const [kind, def] of Object.entries(PROCESSORS)) if (p.buildings[kind]) assets += def.price;
    let goods = 0;
    for (const [item, qty] of Object.entries(p.inv)) goods += (ITEMS[item] ? ITEMS[item].price : 0) * qty;
    return Math.round(p.money + tills + assets * RESALE + goods);
  }

  standings() {
    return [...this.profiles.values()]
      .map((p) => ({
        id: p.ws ? p.id : null, name: p.name, color: p.color, hat: p.hat, online: !!p.ws,
        money: Math.round(p.money), netWorth: this.netWorth(p), level: levelOf(p.xp),
        wagered: Math.round(p.stats.wagered), biggestWin: Math.round(p.stats.biggestWin),
        harvested: p.stats.harvested,
      }))
      .sort((a, b) => b.netWorth - a.netWorth);
  }

  // ------------------------------------------------------------------ money

  sendWallet(p) {
    if (!p.ws) return;
    const now = this.clock.time;
    settleBuildings(p, now);
    const lp = levelProgress(p.xp);
    this.send(p.id, 'wallet', {
      money: Math.round(p.money),
      netWorth: this.netWorth(p),
      xp: p.xp, level: lp.level, levelFrac: lp.frac, levelNeed: lp.need, levelInto: lp.into,
      inv: p.inv,
      storage: { used: storageUsed(p), cap: storageCap(p) },
      house: p.house,
      plot: p.plot,
      fieldSize: p.field.size,
      implements: p.implements,
      guns: p.guns,
      gun: p.gun,
      buildings: p.buildings,
      charity: this._charityAvailable(p),
      vehicle: p.vehicle,
      stats: p.stats,
      staff: this.staff.staffFor(p),
      restaurants: this.restaurants.summary(p),
      restoSlots: this.restaurants.slots(p),
      lotIds: this.lotIdsFor(p),
      tills: Math.round(this.restaurants.tills(p)),
      carrying: p.carrying || null,
      staffCap: { farm: this.staff.capAt(p, 'farm'), restaurant: this.staff.capAt(p, 'restaurant') },
    });
  }

  /**
   * For updates that can happen many times a second (workers, restaurants):
   * the wallet goes out at most four times a second instead of every time.
   */
  walletSoon(p) {
    if (p.ws) p._walletDirty = true;
  }

  /** Takes the stake off a player. Returns false if they cannot cover it. */
  wager(p, amount) {
    const amt = Math.round(amount);
    if (!Number.isFinite(amt) || amt < CONFIG.MIN_BET) return false;
    if (amt > CONFIG.MAX_BET) return false;
    if (p.money < amt) return false;
    p.money -= amt;
    p.stats.wagered += amt;
    this.sendWallet(p);
    return true;
  }

  /** Give a stake back without it counting as a win (the server is shutting down). */
  refund(playerId, amount) {
    const p = this.byId.get(playerId);
    if (!p || amount <= 0) return;
    p.money += amount;
    p.stats.wagered = Math.max(0, p.stats.wagered - amount);
    this.sendWallet(p);
    this.send(p.id, 'toast', { text: `${money(amount)} returned from the table.`, kind: 'warn' });
  }

  /** Called on shutdown: nobody loses a stake to a spin that never happened. */
  abortOpenBets() {
    const refund = (playerId, amount) => this.refund(playerId, amount);
    this.games.roulette.abort(refund);
    this.games.crash.abort(refund);
    this.games.horses.abort(refund);
    this.games.robots.abort(refund);
    this.games.blackjack.abort(refund);
  }

  /** Winnings reach a player even if they walked out mid-spin. */
  pay(playerId, amount, meta = {}) {
    const p = this.byId.get(playerId);
    if (!p || amount <= 0) return 0;
    const final = Math.round(amount);
    p.money += final;
    const net = final - (meta.stake || 0);
    if (net > p.stats.biggestWin) p.stats.biggestWin = net;
    this.sendWallet(p);
    if (meta.game && net >= 2500) {
      this.toastAll(`${p.name} just took $${net.toLocaleString('en-US')} off the ${labelFor(meta.game)}!`, 'big');
    }
    return final;
  }

  _spend(p, amount) {
    if (p.money < amount) return false;
    p.money -= amount;
    return true;
  }

  _gainXp(p, xp) {
    const before = levelOf(p.xp);
    p.xp += Math.round(xp);
    const after = levelOf(p.xp);
    if (after > before) {
      this.send(p.id, 'toast', { text: `LEVEL ${after}! New things unlocked in town.`, kind: 'big' });
      this.toastAll(`${p.name} reached farm level ${after}.`, 'info');
    }
  }

  // ------------------------------------------------------------- networking

  send(playerId, type, data) {
    const p = this.players.get(playerId);
    if (!p || !p.ws || p.ws.readyState !== 1) return;
    p.ws.send(JSON.stringify({ t: type, d: data }));
  }

  /**
   * `droppable` messages (position snapshots) are skipped for a client whose
   * socket is backed up, so one slow laptop never piles up lag for itself.
   */
  broadcast(type, data, droppable = false) {
    const payload = JSON.stringify({ t: type, d: data });
    for (const p of this.players.values()) {
      if (!p.ws || p.ws.readyState !== 1) continue;
      if (droppable && p.ws.bufferedAmount > 256 * 1024) continue;
      p.ws.send(payload);
    }
  }

  toastAll(text, kind = 'info') {
    this.broadcast('toast', { text, kind });
  }

  error(p, text) {
    this.send(p.id, 'toast', { text, kind: 'error' });
  }

  // --------------------------------------------------------------- stations

  /** Where a station really is: farm buildings follow their owner's layout. */
  stationPos(st) {
    if (st.plot == null) return st.pos;
    const owner = this._ownerOf(st.plot);
    return padStation(PLOTS[st.plot], st.pad, owner && owner.layout);
  }

  nearStation(p, stationId) {
    const st = STATION_BY_ID.get(stationId);
    if (!st) return null;
    const pos = this.stationPos(st);
    const dx = p.pos[0] - pos[0];
    const dz = p.pos[2] - pos[2];
    // Generous slack: LAN latency should never cost somebody a bet.
    const reach = st.radius + 3.5;
    if (dx * dx + dz * dz > reach * reach) return null;
    // Farm buildings and restaurant counters answer to their owner only.
    if (st.plot != null && st.plot !== p.plot) return null;
    if (st.lot != null && !p.restaurants.some((r) => r.lot === st.lot)) return null;
    return st;
  }

  _atShop(p, d, game) {
    const st = this.nearStation(p, d && d.station);
    if (!st || st.game !== game) return null;
    return st;
  }

  // ---------------------------------------------------------------- message

  handle(p, msg) {
    p.lastSeen = Date.now();
    switch (msg.t) {
      case 'move': return this.onMove(p, msg.d);
      case 'enter': return this.onEnter(p, msg.d);
      case 'exit': return this.onExit(p);
      case 'bet': return this.onBet(p, msg.d);
      case 'act': return this.onAct(p, msg.d);
      case 'puff': return this.onPuff(p);
      case 'work': return this.onWork(p, msg.d);
      case 'buy': return this.onBuy(p, msg.d);
      case 'sell': return this.onSell(p, msg.d);
      case 'farm': return this.onFarmBuilding(p, msg.d);
      case 'layout': return this.onLayout(p, msg.d);
      case 'hire': return this.onHire(p, msg.d);
      case 'staff': return this.onStaff(p, msg.d);
      case 'resto': return this.onResto(p, msg.d);
      case 'drop': return this.onDrop(p);
      case 'spill': return this.restaurants.spill(p);
      case 'deliver': return this.onDeliver(p, msg.d);
      case 'charity': return this.onCharity(p, msg.d);
      case 'drive': return this.onDrive(p, msg.d);
      case 'implement': return this.onImplement(p, msg.d);
      case 'shoot': return this.onShoot(p, msg.d);
      case 'reload': return this.onReload(p);
      case 'equip': return this.onEquip(p, msg.d);
      case 'ping': return this.send(p.id, 'pong', { c: msg.d && msg.d.c, serverNow: Date.now() });
      default: return undefined;
    }
  }

  onMove(p, d) {
    if (!d || !Array.isArray(d.p) || d.p.length !== 3) return;
    const [x, y, z] = d.p;
    if (![x, y, z].every(Number.isFinite)) return;
    p.pos[0] = clamp(x, BOUNDS.minX, BOUNDS.maxX);
    p.pos[1] = clamp(y, -10, 120);
    p.pos[2] = clamp(z, BOUNDS.minZ, BOUNDS.maxZ);
    if (Number.isFinite(d.y)) p.yaw = d.y;
    // Where you aim up or down (for your gun on other screens), clamped to sense.
    p.aimPitch = Number.isFinite(d.ap) ? clamp(d.ap, -1.5, 1.5) : 0;
    p.anim = d.a | 0;
    // Which gun you are holding out, so everyone sees you carrying it.
    p.gunOut = typeof d.g === 'string' && p.guns.includes(d.g) ? d.g : null;
    if (p.vehicle) {
      const v = this._findVehicle(p, p.vehicle);
      if (v) {
        // Speed is only used to decide how hard a vehicle hits a boar.
        const now = Date.now();
        const dtm = (now - (v.movedAt || now)) / 1000;
        if (dtm > 0.01 && dtm < 1) {
          const inst = Math.hypot(p.pos[0] - v.pos[0], p.pos[2] - v.pos[2]) / dtm;
          v.speed = (v.speed || 0) * 0.5 + Math.min(inst, 80) * 0.5;
        }
        v.movedAt = now;
        v.pos = [p.pos[0], p.pos[1], p.pos[2]];
        if (Number.isFinite(d.vy)) v.yaw = d.vy;
        // Pitch and roll (hills, jumps, suspension) only matter while it moves.
        v.pitch = Number.isFinite(d.vp) ? clamp(d.vp, -Math.PI, Math.PI) : 0;
        v.roll = Number.isFinite(d.vr) ? clamp(d.vr, -Math.PI, Math.PI) : 0;
      }
    }
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
    if (st.game === 'market' || st.game === 'bin') this.send(p.id, 'market', this.market.state());
    if (st.game === 'orders') this.send(p.id, 'orders', this.orders.state());
    if (st.game === 'jobcentre') this.send(p.id, 'jobs', this.staff.candidates());
    if (st.game === 'restaurant') this.send(p.id, 'resto', this.restaurants.stateFor(p, st.lot));
    this.sendWallet(p);
  }

  onExit(p) { p.station = null; }

  // ================================================================ farming

  onWork(p, d) {
    if (!d || !Array.isArray(d.tiles) || p.plot < 0) return;
    const plot = PLOTS[p.plot];
    const now = this.clock.time;
    const size = p.field.size;
    const t = Date.now();

    let want = 'auto';
    let reachFrom = p.pos;
    let reach = HAND_REACH;
    let maxTiles = 1;

    if (d.vid) {
      const v = p.vehicle === d.vid ? this._findVehicle(p, d.vid) : null;
      if (!v) return;
      const model = VEHICLE_BY_ID[v.model];
      if (model.id === 'combine') want = 'harvest';
      else if (model.id === 'tractor' && v.implement) want = IMPLEMENT_BY_ID[v.implement].action;
      else return;
      reachFrom = v.pos;
      reach = MACHINE_REACH;
      maxTiles = model.swath * 2;
      if (t - p.lastWorkAt < 90) return;
    } else if (t - p.lastWorkAt < 180) {
      return;   // hands are slower than machines
    }
    p.lastWorkAt = t;

    const seed = typeof d.seed === 'string' ? d.seed : null;
    const changed = [];
    let harvested = null;
    let error = null;

    for (const pair of d.tiles.slice(0, maxTiles)) {
      if (!Array.isArray(pair)) continue;
      const i = pair[0] | 0;
      const j = pair[1] | 0;
      if (i < 0 || j < 0 || i >= size || j >= size) continue;
      const [cx, cz] = tileCenter(plot, i, j, p.layout);
      const dx = cx - reachFrom[0];
      const dz = cz - reachFrom[2];
      if (dx * dx + dz * dz > reach * reach) continue;
      const idx = tileIndex(i, j);
      const res = workTile(p, idx, want, { now, seed, raining: this.clock.raining });
      if (res.error) { error = res.error; break; }
      if (res.changed) {
        changed.push([idx, p.field.tiles[idx]]);
        if (res.harvested) {
          harvested = harvested || { item: res.harvested.item, qty: 0 };
          harvested.qty += res.harvested.qty;
        }
      }
    }

    if (changed.length) {
      this.broadcast('tiles', { plot: p.plot, t: changed });
      this.sendWallet(p);
    }
    if (harvested) this.send(p.id, 'harvest', harvested);
    // Machines hit the same problem many times a second; only say it once.
    if (error && (!d.vid || t - (p.lastWorkError || 0) > 2500)) {
      p.lastWorkError = t;
      this.error(p, error);
    }
  }

  // ------------------------------------------------------------------ shops

  onBuy(p, d) {
    const sku = String((d && d.sku) || '');
    const [kind, arg] = sku.split(':');
    const lvl = levelOf(p.xp);
    const deny = (text) => this.error(p, text);

    if (kind === 'vehicle') {
      const model = VEHICLE_BY_ID[arg];
      if (!model || model.hidden) return deny('No such model');
      const shop = model.kind === 'car' ? 'cardealer' : 'machinery';
      if (!this._atShop(p, d, shop)) return deny('Walk up to the counter first');
      if (p.vehicles.length >= MAX_VEHICLES) return deny(`You can own ${MAX_VEHICLES} vehicles. Nobody needs more.`);
      const color = PAINTS.includes(d.color) ? d.color : PAINTS[0];
      if (!this._spend(p, model.price)) return deny(`The ${model.name} costs ${money(model.price)}`);
      // Delivered to the kerb outside the shop, lined up so they never stack.
      const st = STATION_BY_ID.get(shop);
      const n = p.vehicles.length;
      const vehicle = {
        id: `${p.slug}#${p.nextVid++}`, model: model.id, color,
        pos: [8.8, 0, st.pos[2] - 10 + (n % 5) * 5], yaw: Math.PI, implement: null,
      };
      p.vehicles.push(vehicle);
      this.sendWallet(p);
      this.broadcast('vehicles', this.publicVehicles());
      this.send(p.id, 'result', { game: shop, bought: model.id });
      this.toastAll(`${p.name} bought a ${model.name}!`, model.price >= 50000 ? 'big' : 'info');
      return undefined;
    }

    const shop = SHOP_OF[kind];
    if (!shop) return deny('That is not for sale');
    if (!this._atShop(p, d, shop)) return deny('Walk up to the counter first');

    if (kind === 'seed') {
      const crop = CROP_BY_ID[arg];
      if (!crop) return deny('No such seed');
      if (lvl < crop.level) return deny(`${crop.name} unlocks at farm level ${crop.level}`);
      const qty = clamp(Math.round(Number(d.qty) || 10), 1, 500);
      if (!this._spend(p, crop.seed * qty)) return deny('Not enough money');
      addItem(p, `seed:${crop.id}`, qty);
      return this._bought(p, shop, `${qty} ${crop.name.toLowerCase()} seeds`);
    }

    if (kind === 'feed') {
      const qty = clamp(Math.round(Number(d.qty) || 20), 1, 500);
      if (!this._spend(p, ITEMS.feed.price * qty)) return deny('Not enough money');
      addItem(p, 'feed', qty);
      return this._bought(p, shop, `${qty} feed`);
    }

    if (kind === 'coop' || kind === 'barn' || kind === 'pen') {
      const def = ANIMAL_HOUSES[kind];
      if (p.plot < 0) return deny('You need a farm first');
      if (p.buildings[kind]) return deny(`You already have a ${def.name.toLowerCase()}`);
      if (lvl < def.level) return deny(`Unlocks at farm level ${def.level}`);
      if (!this._spend(p, def.price)) return deny(`A ${def.name.toLowerCase()} costs ${money(def.price)}`);
      p.buildings[kind] = { animals: 0, feed: 0, stock: 0, last: this.clock.time };
      this.broadcast('plot', this.publicPlot(p.plot));
      this.toastAll(`${p.name} built a ${def.name.toLowerCase()}.`, 'info');
      return this._bought(p, shop, def.name);
    }

    if (kind === 'animal') {
      const def = ANIMAL_HOUSES[arg];
      if (!def) return deny('No such animal');
      const b = p.buildings[arg];
      if (!b) return deny(`Build a ${def.name.toLowerCase()} first`);
      if (b.animals >= def.max) return deny(`Your ${def.name.toLowerCase()} is full`);
      if (!this._spend(p, def.animalPrice)) return deny(`A ${def.animalName.toLowerCase()} costs ${money(def.animalPrice)}`);
      settleAnimals(arg, b, this.clock.time);
      b.animals++;
      this.broadcast('plot', this.publicPlot(p.plot));
      return this._bought(p, shop, `a ${def.animalName.toLowerCase()}`);
    }

    if (kind === 'mill' || kind === 'dairy' || kind === 'bakery') {
      const def = PROCESSORS[kind];
      if (p.plot < 0) return deny('You need a farm first');
      if (p.buildings[kind]) return deny(`You already have a ${def.name.toLowerCase()}`);
      if (lvl < def.level) return deny(`Unlocks at farm level ${def.level}`);
      if (!this._spend(p, def.price)) return deny(`A ${def.name.toLowerCase()} costs ${money(def.price)}`);
      p.buildings[kind] = { recipe: null, queue: 0, started: 0, out: {} };
      this.broadcast('plot', this.publicPlot(p.plot));
      this.toastAll(`${p.name} built a ${def.name.toLowerCase()}.`, 'info');
      return this._bought(p, shop, def.name);
    }

    if (kind === 'house') {
      const tier = Number(arg);
      const def = HOUSES[tier];
      if (!def || tier !== p.house + 1) return deny('Upgrade one step at a time');
      if (p.plot < 0) return deny('You need a farm first');
      if (lvl < def.level) return deny(`Unlocks at farm level ${def.level}`);
      if (!this._spend(p, def.price)) return deny(`A ${def.name.toLowerCase()} costs ${money(def.price)}`);
      p.house = tier;
      this.broadcast('plot', this.publicPlot(p.plot));
      this.toastAll(`${p.name} moved into a ${def.name.toLowerCase()}!`, tier >= 2 ? 'big' : 'info');
      return this._bought(p, shop, def.name);
    }

    if (kind === 'field') {
      const step = Number(arg);
      if (p.plot < 0) return deny('You need a farm first');
      if (!FIELD_SIZES[step] || FIELD_SIZES[step - 1] !== p.field.size) return deny('Expand one step at a time');
      if (lvl < FIELD_LEVELS[step]) return deny(`Unlocks at farm level ${FIELD_LEVELS[step]}`);
      if (!this._spend(p, FIELD_PRICES[step])) return deny(`That costs ${money(FIELD_PRICES[step])}`);
      p.field.size = FIELD_SIZES[step];
      this.broadcast('plot', this.publicPlot(p.plot));
      return this._bought(p, shop, `a ${p.field.size}×${p.field.size} field`);
    }

    if (kind === 'lot') {
      const res = this.restaurants.buyLot(p, arg, d.type);
      if (res.error) return deny(res.error);
      this.broadcast('restaurants', this.restaurants.publicRestaurants());
      this.broadcast('vehicles', this.publicVehicles());
      this.staff.broadcastList();
      const kind = RESTAURANTS[res.res.type].name.toLowerCase();
      this.toastAll(`${p.name} opened a ${kind}!`, 'big');
      return this._bought(p, shop, `lot ${res.lot.id} (a ${kind})`);
    }

    if (kind === 'gun') {
      const def = GUN_BY_ID[arg];
      if (!def) return deny('No such gun');
      if (p.guns.includes(def.id)) return deny('You already own one');
      if (lvl < def.level) return deny(`Rusty will not sell you that before farm level ${def.level}`);
      if (!this._spend(p, def.price)) return deny(`The ${def.name} costs ${money(def.price)}`);
      p.guns.push(def.id);
      p.gun = def.id;
      p.mag = def.mag;
      p.reloadUntil = 0;
      this.send(p.id, 'ammo', { gun: p.gun, mag: p.mag, reloadUntil: 0 });
      return this._bought(p, shop, `a ${def.name}`);
    }

    if (kind === 'implement') {
      const def = IMPLEMENT_BY_ID[arg];
      if (!def) return deny('No such implement');
      if (p.implements.includes(def.id)) return deny(`You already own a ${def.name.toLowerCase()}`);
      if (!this._spend(p, def.price)) return deny(`A ${def.name.toLowerCase()} costs ${money(def.price)}`);
      p.implements.push(def.id);
      // Hitch it straight onto a tractor with nothing on the back.
      const tractor = p.vehicles.find((v) => v.model === 'tractor' && !v.implement);
      if (tractor) { tractor.implement = def.id; this.broadcast('vehicles', this.publicVehicles()); }
      return this._bought(p, shop, `a ${def.name.toLowerCase()}`);
    }

    return deny('That is not for sale');
  }

  _bought(p, shop, what) {
    this.sendWallet(p);
    this.send(p.id, 'result', { game: shop, bought: what });
    this.send(p.id, 'toast', { text: `Bought ${what}.`, kind: 'info' });
  }

  onSell(p, d) {
    const st = this.nearStation(p, d && d.station);
    if (!st || (st.game !== 'market' && st.game !== 'bin')) return this.error(p, 'Sell at the market or your shipping bin');
    // The shipping bin saves you the drive, and the middleman takes a cut.
    const rate = st.game === 'bin' ? 0.8 : 1;
    const items = d.item === '*' ? SELLABLE.filter((k) => p.inv[k] > 0) : [String(d.item)];
    let total = 0;
    let count = 0;
    let xp = 0;
    for (const item of items) {
      if (!SELLABLE.includes(item)) continue;
      const have = p.inv[item] || 0;
      const qty = d.item === '*' ? have : Math.min(have, Math.max(1, Math.round(Number(d.qty) || have)));
      if (qty <= 0) continue;
      takeItem(p, item, qty);
      const paid = Math.round(this.market.sell(item, qty) * rate);
      total += paid;
      count += qty;
      xp += paid / 50;
    }
    if (!count) return this.error(p, 'Nothing to sell');
    p.money += total;
    p.stats.sold += total;
    this._gainXp(p, xp);
    this.marketDirty = true;
    this.sendWallet(p);
    this.send(p.id, 'result', { game: st.game, sold: count, total });
    this.send(p.id, 'market', this.market.state());
    return undefined;
  }

  onCharity(p, d) {
    if (!this._atShop(p, d, 'farmshop')) return this.error(p, 'Walk up to the counter first');
    if (!this._charityAvailable(p)) return this.error(p, 'The farm shop only helps farmers who are truly stuck');
    p.charityDay = this.clock.day;
    addItem(p, 'seed:wheat', 20);
    this.sendWallet(p);
    this.send(p.id, 'toast', { text: 'The shopkeeper slides you 20 wheat seeds. "Pay it forward."', kind: 'info' });
    return undefined;
  }

  _charityAvailable(p) {
    if (p.money >= 50 || p.charityDay === this.clock.day || p.plot < 0) return false;
    if (Object.keys(p.inv).some((k) => k.startsWith('seed:'))) return false;
    if (p.field.tiles.some((t) => t && typeof t === 'object')) return false;
    return true;
  }

  // --------------------------------------------------------- farm buildings

  onFarmBuilding(p, d) {
    const st = this.nearStation(p, d && d.station);
    if (!st || st.plot == null) return this.error(p, 'Walk up to it first');
    const kind = st.pad;
    const now = this.clock.time;

    if (ANIMAL_HOUSES[kind]) {
      if (d.action === 'feed') {
        const res = feedAnimals(p, kind, now);
        if (res.error) return this.error(p, res.error);
      } else if (d.action === 'collect') {
        const res = collectAnimals(p, kind, now);
        if (res.error) return this.error(p, res.error);
        this._gainXp(p, res.xp);
        this.send(p.id, 'harvest', { item: res.item, qty: res.qty });
      }
      return this.sendWallet(p);
    }

    if (PROCESSORS[kind]) {
      if (d.action === 'load') {
        const res = loadProcessor(p, kind, d.recipe, d.count, now);
        if (res.error) return this.error(p, res.error);
      } else if (d.action === 'collect') {
        const res = collectProcessor(p, kind, now);
        if (res.error) return this.error(p, res.error);
        for (const g of res.got) {
          this._gainXp(p, g.xp);
          this.send(p.id, 'harvest', { item: g.item, qty: g.qty });
        }
      }
      return this.sendWallet(p);
    }

    return undefined;
  }

  // ----------------------------------------------------------- farm planner

  /** Moves and turns buildings and the field, from the planner at your house. */
  onLayout(p, d) {
    if (p.plot < 0) return this.error(p, 'You need a farm first');
    if (!this.nearStation(p, `p${p.plot}-house`)) return this.error(p, 'Plan your farm from your house');
    const want = d && d.reset ? defaultLayout() : d && d.layout;
    const check = validateLayout(want);
    if (!check.ok) return this.error(p, check.error || 'That layout does not fit');
    const next = cleanLayout(want);
    const old = p.layout;
    const moved = PAD_KEYS.filter((k) => JSON.stringify(old.pads[k]) !== JSON.stringify(next.pads[k])).length
      + (old.field.x !== next.field.x || old.field.z !== next.field.z ? 1 : 0);
    if (!moved) return this.send(p.id, 'result', { game: 'planner', saved: true, moved: 0 });
    const fee = moved * LAYOUT_FEE;
    if (!this._spend(p, fee)) return this.error(p, `Moving ${moved} thing${moved > 1 ? 's' : ''} costs ${money(fee)}`);
    p.layout = next;
    this.sendWallet(p);
    this.broadcast('plot', this.publicPlot(p.plot));
    this.send(p.id, 'result', { game: 'planner', saved: true, moved, fee });
    this.send(p.id, 'toast', { text: `The builders moved ${moved} thing${moved > 1 ? 's' : ''} for ${money(fee)}.`, kind: 'info' });
    return undefined;
  }

  // ---------------------------------------------------------------- workers

  onHire(p, d) {
    if (!this._atShop(p, d, 'jobcentre')) return this.error(p, 'Hiring happens at the Job Centre');
    const res = this.staff.hire(p, d.cid, d.role, d.name, d.lot);
    if (res.error) return this.error(p, res.error);
    const w = res.worker;
    this.sendWallet(p);
    this.send(p.id, 'jobs', this.staff.candidates());
    this.send(p.id, 'result', { game: 'jobcentre', hired: w.id });
    this.staff.broadcastList();
    this.toastAll(`${p.name} hired ${w.name} as a ${WORKER_ROLES[w.role].name.toLowerCase()}.`, 'info');
    return undefined;
  }

  /** Rename, reassign or let go: your own staff, from anywhere. */
  onStaff(p, d) {
    if (!d || typeof d.id !== 'string') return undefined;
    let res;
    if (d.action === 'rename') res = this.staff.rename(p, d.id, d.name);
    else if (d.action === 'config') res = this.staff.configure(p, d.id, d.cfg);
    else if (d.action === 'fire') res = this.staff.fire(p, d.id);
    else return undefined;
    if (res.error) return this.error(p, res.error);
    if (d.action === 'fire') this.send(p.id, 'toast', { text: `${res.worker.name} packed up and left. No hard feelings.`, kind: 'info' });
    if (d.action !== 'config') this.staff.broadcastList();
    this.sendWallet(p);
    return undefined;
  }

  // ------------------------------------------------------------ restaurants

  onResto(p, d) {
    if (!d || !p.restaurants.length) return this.error(p, 'You do not have a restaurant');
    // Which restaurant: the counter you are standing at.
    const st = this.nearStation(p, d.station || `lot${d.lot}-counter`);
    if (!st || st.lot == null) return this.error(p, 'Run the restaurant from its counter');
    const R = this.restaurants;
    const res = R.of(p, st.lot);
    if (!res) return this.error(p, 'That is not your restaurant');
    let out = {};
    switch (d.action) {
      case 'cook': out = R.cookByHand(p, res, d.oid); break;
      case 'serve': out = R.serveByHand(p, res, d.oid); break;
      case 'stock': out = R.stock(p, res, d.item, d.qty); break;
      case 'wholesale': out = R.wholesale(p, res, d.item, d.qty); break;
      case 'take': out = R.takeDelivery(p, res, d.id); break;
      case 'bank': {
        const amt = R.bank(p, res);
        if (!amt) out = { error: 'The till is empty' };
        else this.send(p.id, 'toast', { text: `Banked ${money(amt)} from the till.`, kind: 'info' });
        break;
      }
      case 'remodel': out = R.remodel(p, res, d.type); if (!out.error) this.broadcast('restaurants', R.publicRestaurants()); break;
      case 'menu': if (res.menu[d.dish] != null) res.menu[d.dish] = !!d.on; break;
      case 'price': res.price = clamp(Math.round(Number(d.value) * 20) / 20 || 1, 0.8, 1.5); break;
      case 'autostock': res.autostock = !!d.on; break;
      case 'open':
        res.open = !!d.on;
        this.broadcast('restaurants', R.publicRestaurants());
        break;
      default: return undefined;
    }
    if (out.error) return this.error(p, out.error);
    R._touch(res.lot);
    R._push(p, res);
    this.sendWallet(p);
    return undefined;
  }

  onDrop(p) {
    const res = this.restaurants.dropOff(p);
    if (res.error) return this.error(p, res.error);
    return undefined;
  }

  // ----------------------------------------------------------------- orders

  onDeliver(p, d) {
    if (!this._atShop(p, d, 'orders')) return this.error(p, 'Walk up to the board first');
    const order = this.orders.list.find((o) => o.id === Number(d.id));
    if (!order) return this.error(p, 'Somebody beat you to it');
    if ((p.inv[order.item] || 0) < order.qty) {
      return this.error(p, `You need ${order.qty} ${ITEMS[order.item].name.toLowerCase()}`);
    }
    this.orders.take(order.id);
    takeItem(p, order.item, order.qty);
    p.money += order.reward;
    p.stats.orders++;
    this._gainXp(p, order.xp);
    this.sendWallet(p);
    this.toastAll(`${p.name} filled an order for ${order.qty} ${ITEMS[order.item].name.toLowerCase()} — ${money(order.reward)}!`, 'big');
    this.orders.refill(this.clock.time, this._topLevel());
    this.broadcast('orders', this.orders.state());
    return undefined;
  }

  // --------------------------------------------------------------- vehicles

  onDrive(p, d) {
    const vid = d && d.vid;
    if (!vid) {
      const pos = d && Array.isArray(d.pos) && d.pos.every(Number.isFinite) ? d.pos : null;
      this._leaveVehicle(p, pos ? { pos, yaw: Number(d.yaw) || 0 } : null);
      this.sendWallet(p);
      return undefined;
    }
    const v = this._findVehicle(p, vid);
    if (!v) return this.error(p, 'That is not yours');
    const dx = v.pos[0] - p.pos[0];
    const dz = v.pos[2] - p.pos[2];
    if (dx * dx + dz * dz > 7 * 7) return this.error(p, 'Walk up to it first');
    if (p.vehicle) this._leaveVehicle(p);
    v.driver = p.id;
    p.vehicle = v.id;
    this.broadcast('vehicles', this.publicVehicles());
    this.sendWallet(p);
    return undefined;
  }

  onImplement(p, d) {
    const v = this._findVehicle(p, d && d.vid);
    if (!v || v.model !== 'tractor') return undefined;
    const want = d.id || null;
    if (want && !p.implements.includes(want)) return this.error(p, 'You do not own that');
    // One of each implement: take it off any other tractor first.
    if (want) for (const o of p.vehicles) if (o !== v && o.implement === want) o.implement = null;
    v.implement = want;
    this.broadcast('vehicles', this.publicVehicles());
    return undefined;
  }

  // ================================================================== guns

  onShoot(p, d) {
    const gun = GUN_BY_ID[p.gun];
    const now = Date.now();
    if (!gun || !d || !Array.isArray(d.o) || !Array.isArray(d.d)) return;
    if (p.vehicle || now < p.koUntil) return;
    const o = d.o.map(Number);
    let dir = d.d.map(Number);
    if (![...o, ...dir].every(Number.isFinite)) return;
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    if (len < 0.5) return;
    dir = dir.map((v) => v / len);
    // The muzzle has to be roughly where you are standing.
    if (Math.hypot(o[0] - p.pos[0], o[2] - p.pos[2]) > 3 || Math.abs(o[1] - p.pos[1] - 1.6) > 2) return;
    // Rate of fire (a little slack for LAN jitter), magazine and reload.
    if (now - p.lastShot < gun.rate * 1000 - 90 || now < p.reloadUntil || p.mag <= 0) {
      return this.send(p.id, 'ammo', { gun: p.gun, mag: p.mag, reloadUntil: p.reloadUntil });
    }
    p.lastShot = now;
    p.mag--;
    // How old the boars on the shooter's screen were (interpolation + half a
    // round trip); boars.js caps it.
    const res = this.wildlife.shoot(p, gun, o, dir, Number(d.lag) || 0);
    this.send(p.id, 'shotres', { hits: res.hits, mag: p.mag });
    // Everyone else hears it and sees the tracer.
    const payload = JSON.stringify({ t: 'shot', d: { pid: p.id, gun: gun.id, o: o.map(r2), e: res.end.map(r2) } });
    for (const q of this.players.values()) {
      if (q !== p && q.ws && q.ws.readyState === 1 && q.ws.bufferedAmount < 256 * 1024) q.ws.send(payload);
    }
  }

  onReload(p) {
    const gun = GUN_BY_ID[p.gun];
    const now = Date.now();
    if (!gun || now < p.reloadUntil || p.mag >= gun.mag) return;
    p.reloadUntil = now + gun.reload * 1000;
    p.mag = gun.mag;   // usable once the reload finishes
    this.send(p.id, 'ammo', { gun: p.gun, mag: p.mag, reloadUntil: p.reloadUntil });
  }

  onEquip(p, d) {
    const gun = GUN_BY_ID[d && d.gun];
    if (!gun || !p.guns.includes(gun.id)) return;
    if (gun.id === p.gun) return;
    p.gun = gun.id;
    p.mag = gun.mag;
    // Swapping is not a free reload: getting the other gun ready takes a moment.
    p.reloadUntil = Date.now() + 800;
    this.send(p.id, 'ammo', { gun: p.gun, mag: p.mag, reloadUntil: p.reloadUntil });
    this.sendWallet(p);
  }

  // ---------------------------------------------------------------- health

  hurtPlayer(p, dmg, dir, cause) {
    const now = Date.now();
    if (now < p.koUntil) return;
    p.hp = Math.max(0, p.hp - dmg);
    p.lastHurt = now;
    this.send(p.id, 'hurt', { hp: p.hp, dmg, dir, cause });
    if (p.hp <= 0) {
      p.koUntil = now + KO_MS;
      const plot = p.plot >= 0 ? PLOTS[p.plot] : null;
      const spawn = plot ? plotSpawn(plot) : TOWN_SPAWN;
      this.send(p.id, 'ko', { ms: KO_MS, spawn: spawn.pos, yaw: spawn.yaw });
      this.toastAll(`${p.name} got flattened by a wild boar.`, 'warn');
    }
  }

  _healthTick(now, dt) {
    for (const p of this.players.values()) {
      if (p.koUntil && now >= p.koUntil) {
        p.koUntil = 0;
        p.hp = PLAYER_HP;
        this.send(p.id, 'hp', { hp: p.hp });
        continue;
      }
      if (p.hp < PLAYER_HP && !p.koUntil && now - p.lastHurt > REGEN_DELAY_MS) {
        const before = Math.floor(p.hp);
        p.hp = Math.min(PLAYER_HP, p.hp + REGEN_PER_S * dt);
        if (Math.floor(p.hp) !== before && (Math.floor(p.hp) % 10 === 0 || p.hp >= PLAYER_HP)) this.send(p.id, 'hp', { hp: Math.floor(p.hp) });
      }
    }
  }

  /** Bounty, meat and bragging rights for whoever dropped it. */
  boarKilled(p, b) {
    const st = b.st;
    p.money += st.bounty;
    p.stats.boars = (p.stats.boars || 0) + 1;
    this._gainXp(p, st.xp);
    const meat = Math.min(st.meat, storageFree(p));
    if (meat > 0) addItem(p, 'boar', meat);
    this.sendWallet(p);
    this.send(p.id, 'harvest', { item: 'boar', qty: meat });
    const owner = this.profiles.get(b.owner);
    const whose = owner && owner !== p ? ` on ${owner.name}'s farm` : '';
    this.toastAll(`${p.name} dropped a wild boar${whose} (+${money(st.bounty)}).`, 'info');
  }

  // ================================================================= casino

  _guardBet(p, d, cooldownMs = 0) {
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
        // pass the same proximity and debounce checks.
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

  /** A cigar does nothing mechanically. It costs real money and everyone can see it. */
  buyCigar(p, d) {
    if (!this.nearStation(p, d && d.station)) return this.error(p, 'Walk up to the counter first');
    if (p.cigar) return this.error(p, 'You already have one going');
    if (p.money < CIGAR.PRICE) return this.error(p, `A cigar costs ${money(CIGAR.PRICE)}`);

    // Deducted directly rather than through wager(): it is an expense, not a bet.
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
      p.stats.wagered -= res.refund;
      return this.sendWallet(p);
    }

    return undefined;
  }

  _settleBlackjack(p, settled) {
    if (settled.payout > 0) this.pay(p.id, settled.payout, { game: 'blackjack', stake: settled.bet });
  }

  // =================================================================== tick

  tick() {
    const now = Date.now();
    const changes = this.clock.advance(now);
    const dtWorld = this.clock.time - this.lastWorld;
    this.lastWorld = this.clock.time;
    this.market.decay(dtWorld);

    if (changes.newDay) this._newDay();
    if (changes.weather) this._weatherChanged(changes.weather);
    if (this.clock.raining && now - this.lastRain >= RAIN_EVERY_MS) {
      this.lastRain = now;
      this._rain();
    }

    this.wildlife.tick();
    this.staff.tick(now);
    this.restaurants.tick(now);
    if (now - (this.lastWalletFlush || 0) >= 250) {
      this.lastWalletFlush = now;
      for (const p of this.players.values()) if (p._walletDirty) { p._walletDirty = false; this.sendWallet(p); }
    }
    this._healthTick(now, 1 / CONFIG.TICK_HZ);

    this.round.tick(now);
    this.games.roulette.tick(now);
    this.games.crash.tick(now);
    this.games.horses.tick(now);
    this.games.robots.tick(now);

    if (now - this.lastSnapshot >= 1000 / CONFIG.SNAPSHOT_HZ) {
      this.lastSnapshot = now;
      const snap = [];
      for (const p of this.players.values()) {
        const v = p.vehicle ? this._findVehicle(p, p.vehicle) : null;
        snap.push([p.id, r2(p.pos[0]), r2(p.pos[1]), r2(p.pos[2]), r2(p.yaw), p.anim, p.vehicle || 0, v ? r2(v.yaw) : 0, p.gunOut || 0,
          v ? r2(v.pitch || 0) : 0, v ? r2(v.roll || 0) : 0, r2(p.aimPitch || 0)]);
      }
      if (snap.length) this.broadcast('snap', snap, true);
    }

    if (now - this.lastClockSync >= 10_000) {
      this.lastClockSync = now;
      this.broadcast('clock', this.clock.state());
      if (this.marketDirty) { this.marketDirty = false; this.broadcast('market', this.market.state()); }
    }

    if (now - this.lastBoard >= 2000) {
      this.lastBoard = now;
      if (this.players.size) this.broadcast('board', this.standings());
      // Animals and ovens keep working; keep their open panels honest. Other
      // panels only need a wallet when something actually changed.
      for (const p of this.players.values()) {
        const st = p.station && STATION_BY_ID.get(p.station);
        if (st && ((st.plot != null && st.pad !== 'bin') || st.game === 'jobcentre')) this.sendWallet(p);
      }
    }

    if (now - this.lastSave >= AUTOSAVE_MS) this.save();
  }

  _newDay() {
    this.staff.payWages();
    this.market.newDay();
    this.orders.refill(this.clock.time, this._topLevel());
    this.broadcast('market', this.market.state());
    this.broadcast('orders', this.orders.state());
    this.broadcast('clock', this.clock.state());
    this.toastAll(`DAY ${this.clock.day} — market prices have moved and new orders are on the board.`, 'event');
  }

  _weatherChanged(w) {
    this.broadcast('clock', this.clock.state());
    const text = {
      clear: 'The sun is out.',
      cloudy: 'Clouds rolling in.',
      rain: 'It is raining — every field gets watered for free.',
      storm: 'THUNDERSTORM — lightning can scorch ripe crops. Harvest!',
    }[w];
    this.toastAll(text, w === 'storm' ? 'event' : 'info');
    if (w === 'storm') {
      for (const p of this.profiles.values()) {
        if (p.plot < 0) continue;
        const hits = lightningOn(p, this.clock.time, rnd);
        if (hits.length) {
          this.broadcast('tiles', { plot: p.plot, t: hits.map((i) => [i, p.field.tiles[i]]), strike: true });
          this.toastAll(`Lightning scorched ${hits.length} of ${p.name}'s ripe crops.`, 'warn');
        }
      }
    }
    if (this.clock.raining) { this.lastRain = Date.now(); this._rain(); }
  }

  _rain() {
    for (const p of this.profiles.values()) {
      if (p.plot < 0) continue;
      const touched = rainOn(p, this.clock.time);
      if (touched.length) this.broadcast('tiles', { plot: p.plot, t: touched.map((i) => [i, p.field.tiles[i]]) });
    }
  }

  // ------------------------------------------------------------------- save

  saveProfile(p) {
    if (!this.store) return;
    try {
      this.store.savePlayer(toSave(p));
    } catch (err) {
      console.error(`[save] could not save ${p.name}: ${err.message}`);
    }
  }

  /** Writes the world and every farm. Unchanged files are skipped. */
  save() {
    this.lastSave = Date.now();
    if (!this.store) return;
    const now = Date.now();
    for (const p of this.players.values()) {
      p.stats.playSeconds += Math.round((now - p.joinedAt) / 1000);
      p.joinedAt = now;
      settleBuildings(p, this.clock.time);
    }
    try {
      this.store.saveWorld({
        clock: this.clock.toSave(),
        market: this.market.toSave(),
        orders: this.orders.toSave(),
        staff: this.staff.toSave(),
      });
    } catch (err) {
      console.error(`[save] could not save the world: ${err.message}`);
    }
    for (const p of this.profiles.values()) this.saveProfile(p);
    this.store.lastSaveAt = Date.now();
  }
}

/**
 * Two farmers can never share a farm. A save folder that says otherwise (a
 * copied file, a hand edit) keeps the older farmer on it; the newer one gets
 * the first free farm, or none.
 */
function dedupePlots(raws) {
  const list = [...raws].sort((a, b) => (a.created || 0) - (b.created || 0));
  const used = new Set();
  for (const r of list) {
    const ok = Number.isInteger(r.plot) && r.plot >= 0 && r.plot < PLOTS.length;
    if (ok && !used.has(r.plot)) { used.add(r.plot); continue; }
    if (!ok && r.plot !== -1 && r.plot != null) console.warn(`[save] ${r.name} had farm ${r.plot}, which does not exist`);
    if (ok) console.warn(`[save] ${r.name} shared farm ${r.plot} with someone else; moving them`);
    const free = PLOTS.find((q) => !used.has(q.index));
    r.plot = ok || r.plot >= 0 ? (free ? free.index : -1) : -1;
    if (r.plot >= 0) used.add(r.plot);
  }
  return list;
}

function labelFor(game) {
  return { slots: 'slots', dice: 'dice', blackjack: 'blackjack table', roulette: 'roulette wheel', crash: 'rocket', horses: 'track', robots: 'robot cage' }[game] || 'floor';
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r2 = (v) => Math.round(v * 100) / 100;

