// Hired hands. They are hired at the Job Centre, named by their boss, and
// work the farm (and later the restaurant) whenever the host is running,
// whether or not their boss is online.
//
// Everything they do goes through the same rule functions a player's button
// presses do (farm.js), so a worker can never do what the owner could not.
//
// Network: nothing is streamed. When a worker starts a job the server sends
// one small 'wk' event ("walk from A to B starting now, then do this for N
// ms"), and every client animates it by itself.
import {
  CROP_BY_ID, ITEMS, SELLABLE, ANIMAL_HOUSES, PROCESSORS, PROCESS_QUEUE_MAX,
  WORKER_ROLES, WORKER_TRAITS, WORKER_NAMES, FARM_WORKER_CAP,
  workerWage, workerSeconds, onShift, levelOf, cropProgress, isWatered, money,
} from '../shared/catalog.js';
import { PLOTS, padStation, tileCenter, tileIndex } from '../shared/map.js';
import { rnd, pick } from './rng.js';
import {
  workTile, waterTile, storageFree, addItem, takeItem,
  feedAnimals, collectAnimals, loadProcessor, collectProcessor, settleProcessor,
} from './farm.js';

const BOARD_SIZE = 6;
const TICK_MS = 250;
const WALK = 1.6;                  // metres a second at speed 1
const IDLE_RECHECK_MS = 2500;
const NAME_MAX = 16;
const SELL_RATE = 0.9;

// Seconds each job takes at speed 1.
const BASE = { plow: 2.6, plant: 2.2, water: 1.6, harvest: 2.6, feed: 4, collect: 3, load: 5, sell: 6 };

export const cleanWorkerName = (raw) => String(raw || '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, NAME_MAX);

/** A random look, so every hired hand is recognisable. */
function randomLook() {
  const shirts = ['#c0392b', '#2e86de', '#27ae60', '#f39c12', '#8e44ad', '#16a085', '#d35400', '#7f8c8d', '#e84393', '#00b894'];
  const skins = ['#f1c7a3', '#e0ac80', '#c68a5e', '#9c6644', '#6f4a33', '#f5d6c0'];
  const hairs = ['#2b1d14', '#6b4a2e', '#b58b4c', '#d9d6cf', '#1a1a1a', '#8a3b1e'];
  return {
    shirt: pick(shirts), skin: pick(skins), hair: pick(hairs),
    hat: pick(['cap', 'straw', 'none', 'bandana', 'cap']), beard: rnd() < 0.35, build: 0.9 + rnd() * 0.2,
  };
}

export class Staff {
  constructor(room, saved) {
    this.room = room;
    this.board = saved && saved.board && Array.isArray(saved.board.list) ? saved.board : { day: 0, list: [] };
    this.nextCid = (saved && saved.nextCid) || 1;
    this.rt = new Map();             // worker id -> runtime state (never saved)
    this.lastTick = 0;
    // Faster test worlds (TIME_SCALE) get faster workers too, up to a point.
    this.pace = Math.max(1, Math.min(20, room.clock.scale || 1));
  }

  toSave() { return { board: this.board, nextCid: this.nextCid }; }

  // ------------------------------------------------------------- job board

  /** Today's candidates; a fresh lot every morning. */
  candidates() {
    const day = this.room.clock.day;
    if (this.board.day !== day || !this.board.list.length) {
      const used = new Set();
      for (const p of this.room.profiles.values()) for (const w of p.workers) used.add(w.name);
      const names = WORKER_NAMES.filter((n) => !used.has(n));
      const list = [];
      for (let i = 0; i < BOARD_SIZE; i++) {
        const name = names.length ? names.splice(Math.floor(rnd() * names.length), 1)[0] : pick(WORKER_NAMES);
        // Mostly middling, now and then a star or a snail.
        const r = rnd();
        const speed = Math.round((r < 0.15 ? 0.6 + rnd() * 0.25 : r > 0.85 ? 1.3 + rnd() * 0.3 : 0.85 + rnd() * 0.45) * 100) / 100;
        list.push({ cid: this.nextCid++, name, speed, trait: pick(Object.keys(WORKER_TRAITS)), look: randomLook() });
      }
      this.board = { day, list };
    }
    return this.board.list;
  }

  // ------------------------------------------------------------ hire & fire

  /** How many work at a place ('farm', 'restaurant', or one restaurant by lot). */
  countAt(p, place, lot = null) {
    const first = p.restaurants[0] && p.restaurants[0].lot;
    return p.workers.filter((w) => WORKER_ROLES[w.role].place === place
      && (lot == null || ((w.cfg && w.cfg.lot) || first) === lot)).length;
  }

  capAt(p, place, lot = null) {
    if (place === 'farm') return p.plot >= 0 ? FARM_WORKER_CAP[p.house] : 0;
    const R = this.room.restaurants;
    if (!R) return 0;
    if (lot != null) return R.staffCap(R.of(p, lot));
    return p.restaurants.reduce((a, res) => a + R.staffCap(res), 0);
  }

  /** The restaurant a new member of staff goes to: the one asked for, or the first with room. */
  _pickLot(p, want) {
    const R = this.room.restaurants;
    const mine = p.restaurants.map((r) => r.lot);
    if (want != null && mine.includes(Number(want))) return Number(want);
    return mine.find((lot) => this.countAt(p, 'restaurant', lot) < R.staffCap(R.of(p, lot))) ?? mine[0] ?? null;
  }

  hire(p, cid, role, rawName, wantLot = null) {
    const cand = this.candidates().find((c) => c.cid === Number(cid));
    if (!cand) return { error: 'Somebody already hired them' };
    const def = WORKER_ROLES[role];
    if (!def) return { error: 'Pick a job for them' };
    if (def.place === 'restaurant' && !p.restaurants.length) return { error: 'You need a restaurant first' };
    if (def.place === 'farm' && p.plot < 0) return { error: 'You need a farm first' };
    const lot = def.place === 'restaurant' ? this._pickLot(p, wantLot) : null;
    const cap = this.capAt(p, def.place, lot);
    if (this.countAt(p, def.place, lot) >= cap) {
      return { error: def.place === 'farm'
        ? `Your house has room for ${cap} farm hand${cap === 1 ? '' : 's'}. A bigger house fits more.`
        : `That restaurant has room for ${cap} staff. Level it up for more.` };
    }
    const wage = workerWage(role, cand.speed, cand.trait);
    // The first day is paid up front.
    if (p.money < wage) return { error: `${cand.name} wants ${money(wage)} a day, paid up front` };
    p.money -= wage;
    p.stats.wagesPaid = (p.stats.wagesPaid || 0) + wage;
    const name = cleanWorkerName(rawName) || cand.name;
    const w = {
      id: `${p.slug}~${p.nextWid++}`, name, role, speed: cand.speed, trait: cand.trait, look: cand.look,
      wage, hired: this.room.clock.day, paidDay: this.room.clock.day, off: 0,
      cfg: defaultConfig(role, p, lot),
    };
    p.workers.push(w);
    this.board.list = this.board.list.filter((c) => c.cid !== cand.cid);
    this._spawn(p, w);
    return { worker: w };
  }

  fire(p, wid) {
    const i = p.workers.findIndex((w) => w.id === wid);
    if (i < 0) return { error: 'No such worker' };
    const [w] = p.workers.splice(i, 1);
    this.interrupt(p, w);
    this._release(p, w.id);
    this.rt.delete(w.id);
    return { worker: w };
  }

  rename(p, wid, raw) {
    const w = p.workers.find((q) => q.id === wid);
    if (!w) return { error: 'No such worker' };
    const name = cleanWorkerName(raw);
    if (!name) return { error: 'Give them a name' };
    w.name = name;
    return { worker: w };
  }

  configure(p, wid, cfg) {
    const w = p.workers.find((q) => q.id === wid);
    if (!w || !cfg || typeof cfg !== 'object') return { error: 'No such worker' };
    if (w.role === 'field') {
      if (cfg.crop != null) {
        const crop = CROP_BY_ID[cfg.crop];
        if (!crop) return { error: 'No such crop' };
        if (levelOf(p.xp) < crop.level) return { error: `${crop.name} unlocks at level ${crop.level}` };
        w.cfg.crop = crop.id;
      }
      if (cfg.autobuy != null) w.cfg.autobuy = !!cfg.autobuy;
    }
    if (w.role === 'workshop' && cfg.recipe && typeof cfg.recipe === 'object') {
      for (const [kind, id] of Object.entries(cfg.recipe)) {
        if (PROCESSORS[kind] && PROCESSORS[kind].recipes.some((r) => r.id === id)) w.cfg.recipe[kind] = id;
      }
    }
    if (w.role === 'seller' && ['crops', 'animal', 'goods', 'all'].includes(cfg.sell)) w.cfg.sell = cfg.sell;
    if (WORKER_ROLES[w.role].place === 'restaurant' && cfg.lot != null && Number(cfg.lot) !== w.cfg.lot) {
      const lot = Number(cfg.lot);
      const R = this.room.restaurants;
      if (!R.of(p, lot)) return { error: 'That is not your restaurant' };
      if (this.countAt(p, 'restaurant', lot) >= R.staffCap(R.of(p, lot))) return { error: 'That restaurant has no room for more staff' };
      this.interrupt(p, w);
      w.cfg.lot = lot;
    }
    return { worker: w };
  }

  // ------------------------------------------------------------------ wages

  /** Called at dawn. Unpaid workers take the day off; they do not quit. */
  payWages() {
    const day = this.room.clock.day;
    for (const p of this.room.profiles.values()) {
      if (!p.workers.length) continue;
      let paid = 0;
      const unpaid = [];
      for (const w of p.workers) {
        if (w.paidDay === day) continue;
        if (p.money >= w.wage) {
          p.money -= w.wage;
          paid += w.wage;
          w.paidDay = day;
          w.off = 0;
        } else {
          w.off = day;
          unpaid.push(w.name);
        }
      }
      p.stats.wagesPaid = (p.stats.wagesPaid || 0) + paid;
      if (p.ws) {
        if (paid) this.room.send(p.id, 'toast', { text: `Paid your staff ${money(paid)} in wages.`, kind: 'info' });
        if (unpaid.length) this.room.error(p, `Could not pay ${unpaid.join(', ')} — they are taking today off.`);
        this.room.sendWallet(p);
      }
    }
  }

  // --------------------------------------------------------------- network

  publicWorkers() {
    const out = [];
    for (const p of this.room.profiles.values()) {
      for (const w of p.workers) {
        const r = this.rt.get(w.id);
        out.push({ id: w.id, owner: p.slug, name: w.name, role: w.role, look: w.look, ev: r ? r.ev : null });
      }
    }
    return out;
  }

  /** The boss's view of their staff: who is doing what, and why not. */
  staffFor(p) {
    return p.workers.map((w) => {
      const r = this.rt.get(w.id);
      return { ...w, status: r ? r.status : 'Starting', done: r ? r.done : 0 };
    });
  }

  broadcastList() { this.room.broadcast('workers', this.publicWorkers()); }

  // ------------------------------------------------------------------- tick

  tick(now = Date.now()) {
    if (now - this.lastTick < TICK_MS) return;
    this.lastTick = now;
    for (const p of this.room.profiles.values()) {
      if (!p.workers.length) continue;
      for (const w of p.workers) {
        let r = this.rt.get(w.id);
        if (!r) r = this._spawn(p, w);
        if (now < r.until) continue;
        if (r.pending) {
          const fn = r.pending;
          r.pending = null;
          r.cancel = null;
          this._release(p, w.id);
          try { fn(); } catch (err) { console.error(`[workers] ${w.name}: ${err.message}`); }
          r.done++;
        }
        this._next(p, w, r, now);
      }
    }
  }

  _spawn(p, w) {
    const home = this._home(p, w);
    const r = { id: w.id, x: home[0], z: home[2], until: 0, pending: null, status: 'Starting', ev: null, done: 0 };
    this.rt.set(w.id, r);
    return r;
  }

  _home(p, w) {
    if (WORKER_ROLES[w.role].place === 'restaurant' && this.room.restaurants) {
      const spot = this.room.restaurants.workSpot(p, w);
      if (spot) return spot;
    }
    if (p.plot < 0) return [0, 0, 60];
    return padStation(PLOTS[p.plot], 'house', p.layout);
  }

  /** Picks the next job, or goes home, or waits. */
  _next(p, w, r, now) {
    const clock = this.room.clock;
    if (w.off === clock.day) return this._idle(r, now, 'Unpaid — took the day off', this._home(p, w), 'home');
    if (!onShift(w.trait, clock.hour)) return this._idle(r, now, 'Off shift', this._home(p, w), 'home');
    let job = null;
    let why = 'Nothing to do';
    const place = WORKER_ROLES[w.role].place;
    if (place === 'restaurant') {
      const res = this.room.restaurants ? this.room.restaurants.nextJob(p, w, r) : null;
      if (res && res.job) job = res.job;
      else if (res && res.why) why = res.why;
    } else {
      const res = this[`_job_${w.role}`](p, w, r);
      if (res.job) job = res.job;
      else why = res.why || why;
    }
    if (!job) return this._idle(r, now, why, null, 'idle');
    this._start(p, w, r, now, job);
    return undefined;
  }

  _idle(r, now, status, walkTo, act) {
    r.status = status;
    if (walkTo && Math.hypot(walkTo[0] - r.x, walkTo[2] - r.z) > 1) {
      // Walk home and stand there.
      const dist = Math.hypot(walkTo[0] - r.x, walkTo[2] - r.z);
      const walk = (dist / WALK) * 1000 / this.pace;
      r.ev = { from: [r2(r.x), r2(r.z)], to: [r2(walkTo[0]), r2(walkTo[2])], t0: now, walk: Math.round(walk), dur: 0, act };
      r.x = walkTo[0];
      r.z = walkTo[2];
      r.until = now + walk;
      this._emit(r);
    } else {
      r.until = now + IDLE_RECHECK_MS;
      if (!r.ev || r.ev.act !== act || r.ev.dur) {
        r.ev = { from: [r2(r.x), r2(r.z)], to: [r2(r.x), r2(r.z)], t0: now, walk: 0, dur: 0, act };
        this._emit(r);
      }
    }
  }

  /**
   * Stops whatever a worker is doing right now, without doing it: the job's
   * `cancel` puts things back (an order back in the queue, a tile unclaimed).
   * They stand where they are this moment and pick something new next tick.
   */
  interrupt(p, w, now = Date.now()) {
    const r = this.rt.get(w.id);
    if (!r) return null;
    const [x, z] = evPos(r.ev, now, [r.x, r.z]);
    if (r.pending && r.cancel) { try { r.cancel(); } catch (err) { console.error(`[workers] ${w.name}: ${err.message}`); } }
    r.pending = null;
    r.cancel = null;
    this._release(p, w.id);
    r.x = x;
    r.z = z;
    r.until = 0;
    r.ev = { from: [r2(x), r2(z)], to: [r2(x), r2(z)], t0: now, walk: 0, dur: 0, act: 'idle' };
    return [x, z];
  }

  /** Where a worker is right now, mid-walk or not. */
  posOf(w, now = Date.now()) {
    const r = this.rt.get(w.id);
    return r ? evPos(r.ev, now, [r.x, r.z]) : null;
  }

  /** job = { act, at: [x, z], base, apply, cancel?, claim?, status } */
  _start(p, w, r, now, job) {
    const dist = Math.hypot(job.at[0] - r.x, job.at[1] - r.z);
    const walk = (dist / (WALK * w.speed)) * 1000 / this.pace;
    const dur = workerSeconds(job.base || BASE[job.act] || 3, w.speed, w.trait) * 1000 / this.pace;
    r.ev = { from: [r2(r.x), r2(r.z)], to: [r2(job.at[0]), r2(job.at[1])], t0: now, walk: Math.round(walk), dur: Math.round(dur), act: job.act };
    r.x = job.at[0];
    r.z = job.at[1];
    r.until = now + walk + dur;
    r.pending = job.apply;
    r.cancel = job.cancel || null;
    r.keep = !!job.keep;
    r.status = job.status;
    if (job.claim != null) this._claim(p, w.id, job.claim);
    this._emit(r);
  }

  _emit(r) {
    this.room.broadcast('wk', { id: r.id, ...r.ev });
  }

  // Two hands never go for the same tile or building.
  _claim(p, wid, key) {
    if (!p._claims) p._claims = new Map();
    p._claims.set(wid, key);
  }

  _release(p, wid) { if (p._claims) p._claims.delete(wid); }

  _claimed(p, key, wid) {
    if (!p._claims) return false;
    for (const [id, k] of p._claims) if (k === key && id !== wid) return true;
    return false;
  }

  // ------------------------------------------------------------ field hand

  _job_field(p, w, r) {
    if (p.plot < 0) return { why: 'No farm' };
    const plot = PLOTS[p.plot];
    const now = this.room.clock.time;
    const size = p.field.size;
    const crop = CROP_BY_ID[w.cfg.crop] || CROP_BY_ID.wheat;
    const lvl = levelOf(p.xp);
    const canPlant = lvl >= crop.level && ((p.inv[`seed:${crop.id}`] || 0) > 0 || (w.cfg.autobuy && p.money >= crop.seed * 10));
    const full = storageFree(p) < crop.yield + 2;
    const raining = this.room.clock.raining;
    // Best job in priority order, nearest first within a priority.
    let best = null;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const idx = tileIndex(i, j);
        if (this._claimed(p, idx, w.id)) continue;
        const t = p.field.tiles[idx];
        let act = null;
        let rank = 0;
        if (t === null || t === undefined) { act = 'plow'; rank = 1; }
        else if (t === 0) { if (canPlant) { act = 'plant'; rank = 3; } }
        else if (cropProgress(t, now) >= 1) { if (!full) { act = 'harvest'; rank = 4; } }
        else if (!raining && !isWatered(t, now)) { act = 'water'; rank = 2; }
        if (!act) continue;
        const [x, z] = tileCenter(plot, i, j, p.layout);
        const d = Math.hypot(x - r.x, z - r.z);
        if (!best || rank > best.rank || (rank === best.rank && d < best.d)) best = { act, rank, d, idx, x, z };
      }
    }
    if (!best) {
      if (full) return { why: 'Storage is full' };
      if (lvl < crop.level) return { why: `${crop.name} is above your level` };
      if (!canPlant) return { why: `Out of ${crop.name.toLowerCase()} seeds` };
      return { why: 'Waiting for crops to grow' };
    }
    const room = this.room;
    const verb = { plow: 'Plowing', plant: `Planting ${crop.name.toLowerCase()}`, water: 'Watering', harvest: 'Harvesting' }[best.act];
    return {
      job: {
        act: best.act, at: [best.x, best.z], claim: best.idx, status: verb,
        apply: () => {
          const t = room.clock.time;
          if (best.act === 'plant' && !(p.inv[`seed:${crop.id}`] > 0) && w.cfg.autobuy && p.money >= crop.seed * 10) {
            // Buys a bag of ten at shop price when the shed runs dry.
            p.money -= crop.seed * 10;
            addItem(p, `seed:${crop.id}`, 10);
          }
          const res = workTile(p, best.idx, best.act, { now: t, seed: crop.id, raining: room.clock.raining });
          if (!res.changed) return;
          if (res.did === 'plant' && w.trait === 'green') {
            const tile = p.field.tiles[best.idx];
            if (tile && typeof tile === 'object') waterTile(tile, t);
          }
          room.broadcast('tiles', { plot: p.plot, t: [[best.idx, p.field.tiles[best.idx]]] });
          room.walletSoon(p);
        },
      },
    };
  }

  // --------------------------------------------------------- animal keeper

  _job_animals(p, w) {
    const now = this.room.clock.time;
    const room = this.room;
    let best = null;
    for (const [kind, def] of Object.entries(ANIMAL_HOUSES)) {
      const b = p.buildings[kind];
      if (!b || !b.animals || this._claimed(p, kind, w.id)) continue;
      const hasFeed = (p.inv.feed || 0) + (p.inv.wheat || 0) > 0;
      if (b.stock >= Math.max(1, def.stockCap * 0.4) && storageFree(p) > 0) best = best || { kind, act: 'collect' };
      else if (b.feed < def.feedCap * 0.4 && hasFeed) best = best || { kind, act: 'feed' };
      else if (b.stock > 0 && storageFree(p) > 0) best = best || { kind, act: 'collect' };
    }
    if (!best) {
      const any = Object.keys(ANIMAL_HOUSES).some((k) => p.buildings[k] && p.buildings[k].animals);
      if (!any) return { why: 'No animals yet' };
      if (storageFree(p) <= 0) return { why: 'Storage is full' };
      return { why: (p.inv.feed || 0) + (p.inv.wheat || 0) ? 'Animals are fed' : 'Out of feed and wheat' };
    }
    const at = padStation(PLOTS[p.plot], best.kind, p.layout);
    const name = ANIMAL_HOUSES[best.kind].name.toLowerCase();
    return {
      job: {
        act: best.act, at: [at[0], at[2]], claim: best.kind,
        status: best.act === 'feed' ? `Feeding the ${name}` : `Collecting at the ${name}`,
        apply: () => {
          const res = best.act === 'feed' ? feedAnimals(p, best.kind, now) : collectAnimals(p, best.kind, room.clock.time);
          if (res.error) return;
          if (res.xp) room._gainXp(p, res.xp);
          room.broadcast('plot', room.publicPlot(p.plot));
          room.walletSoon(p);
        },
      },
    };
  }

  // --------------------------------------------------------- workshop hand

  _job_workshop(p, w) {
    const now = this.room.clock.time;
    const room = this.room;
    let best = null;
    for (const [kind, def] of Object.entries(PROCESSORS)) {
      const b = p.buildings[kind];
      if (!b || this._claimed(p, kind, w.id)) continue;
      settleProcessor(kind, b, now);
      if (Object.keys(b.out).length && storageFree(p) > 0) { best = { kind, act: 'collect' }; break; }
      if (b.queue < PROCESS_QUEUE_MAX / 2) {
        // The chosen recipe first, then anything the storage can pay for.
        const want = w.cfg.recipe[kind] || def.recipes[0].id;
        const order = [def.recipes.find((q) => q.id === want), ...def.recipes.filter((q) => q.id !== want)].filter(Boolean);
        const recipe = order.find((q) => (!b.recipe || b.recipe === q.id)
          && Object.entries(q.in).every(([item, n]) => (p.inv[item] || 0) >= n));
        if (recipe) best = best || { kind, act: 'load', recipe: recipe.id };
      }
    }
    if (!best) {
      if (!Object.keys(PROCESSORS).some((k) => p.buildings[k])) return { why: 'No mill, dairy or bakery yet' };
      return { why: 'Waiting for ingredients' };
    }
    const at = padStation(PLOTS[p.plot], best.kind, p.layout);
    const name = PROCESSORS[best.kind].name.toLowerCase();
    return {
      job: {
        act: best.act, at: [at[0], at[2]], claim: best.kind,
        status: best.act === 'load' ? `Loading the ${name}` : `Emptying the ${name}`,
        apply: () => {
          const t = room.clock.time;
          if (best.act === 'load') {
            loadProcessor(p, best.kind, best.recipe, PROCESS_QUEUE_MAX, t);
          } else {
            const res = collectProcessor(p, best.kind, t);
            if (res.got) for (const g of res.got) room._gainXp(p, g.xp);
          }
          room.walletSoon(p);
        },
      },
    };
  }

  // ----------------------------------------------------------------- seller

  _job_seller(p, w) {
    const clock = this.room.clock;
    // Two runs a day: the morning and the afternoon market.
    const slot = `${clock.day}:${clock.hour < 13 ? 'am' : 'pm'}`;
    if (w.cfg.lastRun === slot) return { why: `Next run ${clock.hour < 13 ? 'this afternoon' : 'tomorrow morning'}` };
    const items = this._sellList(p, w.cfg.sell);
    if (!items.length) return { why: 'Nothing to sell' };
    const at = padStation(PLOTS[p.plot], 'bin', p.layout);
    const room = this.room;
    return {
      job: {
        act: 'sell', at: [at[0], at[2]], status: 'Taking goods to market',
        apply: () => {
          w.cfg.lastRun = slot;
          let total = 0;
          let count = 0;
          for (const item of this._sellList(p, w.cfg.sell)) {
            const qty = p.inv[item] || 0;
            if (qty <= 0 || !takeItem(p, item, qty)) continue;
            total += Math.round(room.market.sell(item, qty) * SELL_RATE);
            count += qty;
          }
          if (!count) return;
          p.money += total;
          p.stats.sold += total;
          room._gainXp(p, total / 50);
          room.marketDirty = true;
          if (p.ws) {
            room.send(p.id, 'toast', { text: `${w.name} sold ${count} goods for ${money(total)}.`, kind: 'info' });
            room.walletSoon(p);
          }
        },
      },
    };
  }

  _sellList(p, what = 'crops') {
    return SELLABLE.filter((k) => (p.inv[k] || 0) > 0 && (
      what === 'all' ? true
        : what === 'crops' ? ITEMS[k].kind === 'crop'
          : what === 'animal' ? ITEMS[k].kind === 'animal'
            : ITEMS[k].kind === 'goods'));
  }
}

function defaultConfig(role, p, lot = null) {
  if (WORKER_ROLES[role] && WORKER_ROLES[role].place === 'restaurant') return { lot };
  if (role === 'field') {
    // The most valuable seed they have, or wheat.
    const owned = Object.keys(p.inv).filter((k) => k.startsWith('seed:')).map((k) => k.slice(5)).filter((c) => CROP_BY_ID[c]);
    return { crop: owned.sort((a, b) => CROP_BY_ID[b].price - CROP_BY_ID[a].price)[0] || 'wheat', autobuy: true };
  }
  if (role === 'workshop') return { recipe: {} };
  if (role === 'seller') return { sell: 'crops' };
  return {};
}

const r2 = (v) => Math.round(v * 100) / 100;

/** Where a walk event puts someone at time `now`. */
export function evPos(ev, now, fallback = [0, 0]) {
  if (!ev) return fallback;
  const k = ev.walk > 0 ? Math.max(0, Math.min(1, (now - ev.t0) / ev.walk)) : 1;
  return [ev.from[0] + (ev.to[0] - ev.from[0]) * k, ev.from[1] + (ev.to[1] - ev.from[1]) * k];
}
