import { ITEMS, SELLABLE, CROPS, DAY_MS, MINUTE, levelOf } from '../shared/catalog.js';
import { rnd, rndInt, pick } from './rng.js';

// ------------------------------------------------------------------ market
//
// Prices wander a little each morning, and dumping a lot of one thing on the
// market pushes its price down for a while. Everyone shares one market, so
// three farmers all growing wheat will feel it.

const SAT_PER_DOLLAR = 1 / 40000;   // selling $4,000 of something knocks ~10% off
const SAT_MAX = 0.6;
const SAT_HALF_LIFE = 10 * MINUTE;  // world time

export class Market {
  constructor(saved) {
    this.drift = {};
    this.sat = {};
    for (const k of SELLABLE) {
      this.drift[k] = saved && saved.drift && Number.isFinite(saved.drift[k]) ? saved.drift[k] : 1;
      this.sat[k] = saved && saved.sat && Number.isFinite(saved.sat[k]) ? saved.sat[k] : 0;
    }
    this.yesterday = { ...this.drift, ...(saved && saved.yesterday) };
  }

  price(item) {
    const def = ITEMS[item];
    if (!def || def.sell === false) return 0;
    return Math.max(1, def.price * this.drift[item] * (1 - this.sat[item]));
  }

  /** Pays out for `qty` units, sliding the price down as they go. */
  sell(item, qty) {
    let total = 0;
    // Sell in small lots so a huge sale lowers its own price as it goes.
    let left = qty;
    while (left > 0) {
      const lot = Math.min(left, 25);
      const p = this.price(item);
      total += p * lot;
      this.sat[item] = Math.min(SAT_MAX, this.sat[item] + p * lot * SAT_PER_DOLLAR);
      left -= lot;
    }
    return Math.round(total);
  }

  decay(dtWorld) {
    const k = Math.pow(0.5, dtWorld / SAT_HALF_LIFE);
    for (const key of SELLABLE) this.sat[key] *= k;
  }

  /** Each morning, every price takes a small random step, pulled back towards normal. */
  newDay() {
    this.yesterday = { ...this.drift };
    for (const k of SELLABLE) {
      const step = (rnd() - 0.5) * 0.28;
      const pull = (1 - this.drift[k]) * 0.35;
      this.drift[k] = Math.max(0.7, Math.min(1.45, this.drift[k] * (1 + step) + pull));
    }
  }

  state() {
    const prices = {};
    const trend = {};
    for (const k of SELLABLE) {
      prices[k] = Math.round(this.price(k) * 100) / 100;
      trend[k] = Math.sign(Math.round((this.drift[k] - this.yesterday[k]) * 100));
    }
    return { prices, trend };
  }

  toSave() {
    return { drift: this.drift, sat: this.sat, yesterday: this.yesterday };
  }
}

// ------------------------------------------------------------------ orders
//
// Three delivery contracts are pinned to the board in the plaza at any time.
// First farmer to turn up with the goods takes the bonus.

const ORDER_COUNT = 3;

export class Orders {
  constructor(saved) {
    this.list = (saved && Array.isArray(saved.list)) ? saved.list : [];
    this.nextId = (saved && saved.nextId) || 1;
  }

  /** Top level among known farmers decides what the board asks for. */
  refill(now, topLevel = 1) {
    const day = Math.floor(now / DAY_MS) + 1;
    this.list = this.list.filter((o) => o.due >= day);
    let added = 0;
    while (this.list.length < ORDER_COUNT) {
      this.list.push(this._make(day, topLevel));
      added++;
    }
    return added;
  }

  _make(day, level) {
    const crops = CROPS.filter((c) => c.level <= Math.max(2, level)).map((c) => c.id);
    const pool = [...crops];
    if (level >= 3) pool.push('egg', 'flour');
    if (level >= 5) pool.push('milk');
    if (level >= 6) pool.push('cheese');
    if (level >= 7) pool.push('bread', 'cake');
    // Avoid two orders for the same thing.
    const taken = new Set(this.list.map((o) => o.item));
    const choices = pool.filter((i) => !taken.has(i));
    const item = pick(choices.length ? choices : pool);
    const unit = ITEMS[item].price;
    const target = 500 + rnd() * 1500 * Math.min(4, level);   // $ value of the goods
    const qty = Math.max(3, Math.round(target / unit / 5) * 5 || 5);
    const bonus = 1.4 + rndInt(5) * 0.1;
    return {
      id: this.nextId++,
      item, qty,
      reward: Math.round(qty * unit * bonus / 10) * 10,
      xp: Math.round(qty * unit * 0.15),
      due: day + 1 + rndInt(2),
    };
  }

  take(id) {
    const i = this.list.findIndex((o) => o.id === id);
    if (i < 0) return null;
    return this.list.splice(i, 1)[0];
  }

  state() { return this.list; }
  toSave() { return { list: this.list, nextId: this.nextId }; }
}

export { levelOf };
