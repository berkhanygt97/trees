// Restaurants on the Sunset Strip. Everything that touches money is decided
// here: who comes in, what they order (only what the pantry can make), who
// cooks it, when it is served, what they pay, and the delivery runs.
//
// Customers are server-side NPCs, but they are never streamed: each time one
// starts walking the server sends a single 'npc' event with the whole path,
// and clients walk them along it on their own.
import {
  ITEMS, RESTAURANTS, DISH_BY_ID, INGREDIENT_GROUPS,
  dishPrice, restoLevel, openTables, restoStaffCap, RESTO_DELIVERY_LEVEL, RESTO_VIP_LEVEL,
  REMODEL_SHARE, WHOLESALE, levelOf, money,
} from '../shared/catalog.js';
import {
  LOT_BY_ID, LOT_LEVEL, RESTO, lotPoint, lotYaw, lotTables, lotSpots, deliverySpots,
} from '../shared/map.js';
import { rnd, pick } from './rng.js';
import { takeItem } from './farm.js';

const TICK_MS = 250;
const WALK = 1.3;                     // customers stroll
const EAT_MS = 18_000;
const PATIENCE_MS = 100_000;
const COOK_BY_HAND_MS = 1500;         // you at the stove: quicker than most cooks
const AUTOSTOCK_MS = 10_000;
const STOCK_TARGET = 20;
const DELIVERY_GRACE_MS = 25_000;     // before a hired driver takes an order you ignored
const DELIVERY_TIP = 0.6;             // up to 60% on top, for a fast run
const DRIVER_TIP = 0.2;

const HOUR_RUSH = [0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.5, 0.8, 0.9, 0.7, 0.8, 1.4, 1.7, 1.5, 0.8, 0.7, 0.8, 1.1, 1.7, 1.9, 1.7, 1.2, 0.6, 0.3];

const SHIRTS = ['#c0392b', '#2e86de', '#27ae60', '#f39c12', '#8e44ad', '#16a085', '#e84393', '#00b894', '#fdcb6e', '#e17055', '#ffffff', '#2d3436', '#74b9ff', '#fd79a8'];
function customerLook(vip) {
  return {
    outfit: vip ? 'suit' : pick(['tee', 'tee', 'hawaii', 'dress', 'tourist', 'work', 'suit']),
    shirt: pick(SHIRTS),
    pants: pick(['#2d3436', '#34495e', '#636e72', '#b2bec3', '#6c5ce7', '#3d2b1f', '#dfe6e9']),
    skin: pick(['#f1c7a3', '#e0ac80', '#c68a5e', '#9c6644', '#6f4a33', '#f5d6c0']),
    hair: pick(['#2b1d14', '#6b4a2e', '#b58b4c', '#d9d6cf', '#1a1a1a', '#8a3b1e', '#e8c35a']),
    hat: vip ? 'tophat' : pick(['none', 'none', 'none', 'cap', 'visor', 'straw']),
    beard: rnd() < 0.25, long: rnd() < 0.4, build: 0.9 + rnd() * 0.22,
  };
}

const r2 = (v) => Math.round(v * 100) / 100;
const pt = (lot, lx, lz) => lotPoint(lot, lx, lz).map(r2);

export function newRestaurant(lot, type) {
  const menu = {};
  for (const d of RESTAURANTS[type].dishes) menu[d.id] = true;
  return {
    lot, type, served: 0, rep: 60, price: 1, menu, pantry: {}, autostock: true, open: true,
    earned: 0, day: { n: 0, served: 0, revenue: 0, walkouts: 0, deliveries: 0 },
  };
}

export class Restaurants {
  constructor(room) {
    this.room = room;
    this.rt = new Map();              // lot id -> runtime (customers, orders, deliveries)
    this.lastTick = 0;
    this.nextId = 1;
    this.pace = Math.max(1, Math.min(20, room.clock.scale || 1));
    this.spots = deliverySpots();
  }

  owner(lotId) {
    for (const p of this.room.profiles.values()) if (p.restaurant && p.restaurant.lot === lotId) return p;
    return null;
  }

  level(p) { return p.restaurant ? restoLevel(p.restaurant.served) : 0; }
  staffCap(p) { return p.restaurant ? restoStaffCap(this.level(p)) : 0; }

  _rt(lotId) {
    let r = this.rt.get(lotId);
    if (!r) {
      r = { customers: new Map(), orders: [], deliveries: [], nextArrival: 0, nextDelivery: 0, lastStock: 0, dirty: true, lastSent: 0 };
      this.rt.set(lotId, r);
    }
    return r;
  }

  // ------------------------------------------------------------- public views

  publicRestaurants() {
    const out = [];
    for (const p of this.room.profiles.values()) {
      if (!p.restaurant) continue;
      out.push({
        lot: p.restaurant.lot, owner: p.slug, ownerName: p.name, color: p.color, type: p.restaurant.type,
        level: this.level(p), open: p.restaurant.open,
      });
    }
    return out;
  }

  /** Everything the owner's counter panel shows. */
  stateFor(p) {
    const res = p.restaurant;
    if (!res) return null;
    const r = this._rt(res.lot);
    const now = Date.now();
    return {
      lot: res.lot, type: res.type, level: this.level(p), served: res.served, rep: Math.round(res.rep), price: res.price,
      menu: res.menu, pantry: res.pantry, autostock: res.autostock, open: res.open, earned: res.earned, day: res.day,
      tables: openTables(this.level(p), LOT_BY_ID.get(res.lot).tables),
      seated: r.customers.size,
      orders: r.orders.map((o) => {
        const c = r.customers.get(o.cid);
        return { oid: o.oid, dish: o.dish, state: o.state, table: c ? c.seat + 1 : 0, waited: c ? Math.round((now - c.sat) / 1000) : 0, patience: c ? Math.round((c.leaveAt - now) / 1000) : 0, vip: c && c.vip };
      }),
      deliveries: r.deliveries.filter((d) => d.state !== 'done').map((d) => ({
        id: d.id, dish: d.dish, dest: d.dest.label, pos: d.dest.pos, state: d.state, left: Math.round((d.deadline - now) / 1000), total: Math.round(d.total / 1000),
      })),
      carrying: p.carrying || null,
    };
  }

  _touch(lotId) { this._rt(lotId).dirty = true; }

  _push(p) {
    if (!p.ws || !p.restaurant) return;
    const r = this._rt(p.restaurant.lot);
    r.dirty = false;
    r.lastSent = Date.now();
    this.room.send(p.id, 'resto', this.stateFor(p));
  }

  // ------------------------------------------------------------ buying a lot

  buyLot(p, lotId, type) {
    const lot = LOT_BY_ID.get(Number(lotId));
    if (!lot) return { error: 'No such lot' };
    if (!RESTAURANTS[type]) return { error: 'Pick burger, pizza or bakery' };
    if (p.restaurant) return { error: 'You already run a restaurant' };
    if (this.owner(lot.id)) return { error: 'Somebody already owns that lot' };
    if (levelOf(p.xp) < LOT_LEVEL) return { error: `Restaurants unlock at farm level ${LOT_LEVEL}` };
    if (p.money < lot.price) return { error: `That lot costs ${money(lot.price)}` };
    p.money -= lot.price;
    p.restaurant = newRestaurant(lot.id, type);
    // A delivery scooter comes with every restaurant, parked out front.
    const sp = lotSpots(lot).scooter;
    const [x, z] = lotPoint(lot, sp[0], sp[1]);
    p.vehicles = p.vehicles.filter((v) => v.model !== 'scooter');
    p.vehicles.push({ id: `${p.slug}#scooter`, model: 'scooter', color: RESTAURANTS[type].neon, pos: [x, 0, z], yaw: lot.side === 'north' ? -Math.PI / 2 : Math.PI / 2, implement: null });
    this._rt(lot.id).nextArrival = Date.now() + 8000 / this.pace;
    return { lot };
  }

  remodel(p, type) {
    const res = p.restaurant;
    if (!res) return { error: 'You do not have a restaurant' };
    if (!RESTAURANTS[type] || type === res.type) return { error: 'Pick a different kind of restaurant' };
    const cost = Math.round(LOT_BY_ID.get(res.lot).price * REMODEL_SHARE);
    if (p.money < cost) return { error: `A refit costs ${money(cost)}` };
    const r = this._rt(res.lot);
    if (r.customers.size || r.deliveries.some((d) => d.state !== 'done')) return { error: 'Wait until the customers have gone' };
    p.money -= cost;
    res.type = type;
    res.menu = {};
    for (const d of RESTAURANTS[type].dishes) res.menu[d.id] = true;
    const scooter = p.vehicles.find((v) => v.model === 'scooter');
    if (scooter) scooter.color = RESTAURANTS[type].neon;
    return { cost };
  }

  // ---------------------------------------------------------------- pantry

  /** Items (not groups) a restaurant's enabled dishes need. */
  _needs(res) {
    const set = new Set();
    for (const d of RESTAURANTS[res.type].dishes) {
      if (!res.menu[d.id]) continue;
      for (const k of Object.keys(d.in)) for (const item of INGREDIENT_GROUPS[k] || [k]) set.add(item);
    }
    return [...set];
  }

  stock(p, item, qty) {
    const res = p.restaurant;
    if (!res) return { error: 'You do not have a restaurant' };
    const items = item === '*' ? this._needs(res) : [String(item)];
    let moved = 0;
    for (const k of items) {
      if (!ITEMS[k]) continue;
      const n = Math.min(p.inv[k] || 0, qty === 'all' || item === '*' ? Infinity : Math.max(1, Number(qty) || 10));
      if (n <= 0) continue;
      takeItem(p, k, n);
      res.pantry[k] = (res.pantry[k] || 0) + n;
      moved += n;
    }
    if (!moved) return { error: 'Nothing in your farm storage to bring' };
    return { moved };
  }

  wholesale(p, item, qty) {
    const res = p.restaurant;
    if (!res || !ITEMS[item] || !this._needs(res).includes(item)) return { error: 'The wholesaler does not do that' };
    const n = Math.max(1, Math.min(50, Math.round(Number(qty) || 10)));
    const cost = Math.round(ITEMS[item].price * WHOLESALE * n);
    if (p.money < cost) return { error: `${n} ${ITEMS[item].name.toLowerCase()} costs ${money(cost)} from the wholesaler` };
    p.money -= cost;
    res.pantry[item] = (res.pantry[item] || 0) + n;
    return { cost, n };
  }

  _autostock(p) {
    const res = p.restaurant;
    let moved = 0;
    for (const k of this._needs(res)) {
      const have = res.pantry[k] || 0;
      if (have >= STOCK_TARGET / 2) continue;
      const n = Math.min(p.inv[k] || 0, STOCK_TARGET - have);
      if (n <= 0) continue;
      takeItem(p, k, n);
      res.pantry[k] = have + n;
      moved += n;
    }
    return moved;
  }

  /** Takes a dish's ingredients out of the pantry, if they are all there. Returns what it took. */
  _reserve(res, dish) {
    const plan = [];
    const left = { ...res.pantry };
    for (const [k, n] of Object.entries(dish.in)) {
      const options = INGREDIENT_GROUPS[k] || [k];
      let need = n;
      for (const item of options) {
        const take = Math.min(need, left[item] || 0);
        if (take > 0) { plan.push([item, take]); left[item] -= take; need -= take; }
        if (!need) break;
      }
      if (need) return null;
    }
    for (const [item, n] of plan) {
      res.pantry[item] -= n;
      if (res.pantry[item] <= 0) delete res.pantry[item];
    }
    return plan;
  }

  _refund(res, plan) {
    for (const [item, n] of plan || []) res.pantry[item] = (res.pantry[item] || 0) + n;
  }

  /** A random dish the pantry can make, with its ingredients already taken out. */
  _pickDish(p) {
    const res = p.restaurant;
    const menu = [...this._available(p)].sort(() => rnd() - 0.5);
    for (const dish of menu) {
      const plan = this._reserve(res, dish);
      if (plan) return { dish, plan };
    }
    return {};
  }

  _available(p) {
    const res = p.restaurant;
    const lvl = this.level(p);
    return RESTAURANTS[res.type].dishes.filter((d) => res.menu[d.id] && d.level <= lvl);
  }

  // ------------------------------------------------------------- customers

  _arrivalGap(p) {
    const res = p.restaurant;
    const hour = Math.floor(this.room.clock.hour) % 24;
    const weather = this.room.clock.raining ? 0.7 : 1;
    const priceF = Math.max(0.3, 1.4 - 0.4 * res.price);
    const f = HOUR_RUSH[hour] * (0.5 + res.rep / 100) * priceF * weather * (0.8 + 0.1 * this.level(p));
    const mean = 45_000 / Math.max(0.05, f);
    return (mean * (0.5 + rnd())) / this.pace;
  }

  _spawnCustomer(p, lot, r, now) {
    const res = p.restaurant;
    const tables = lotTables(lot).slice(0, openTables(this.level(p), lot.tables));
    const taken = new Set([...r.customers.values()].map((c) => c.seat));
    const free = tables.map((t, i) => i).filter((i) => !taken.has(i));
    if (!free.length) return;
    // They read the menu in the window: only dishes the pantry can make.
    const { dish, plan } = this._pickDish(p);
    if (!dish) { res.status = 'Out of ingredients'; return; }
    const seat = pick(free);
    const [tx, tz] = tables[seat];
    const side = rnd() < 0.5 ? -1 : 1;
    const sp = lotSpots(lot);
    const path = [
      pt(lot, side * (lot.w / 2 + 10), sp.street[1]), pt(lot, 0, sp.street[1]), pt(lot, 0, RESTO.front - 0.4),
      pt(lot, 0, RESTO.entry), pt(lot, tx - 1.3, RESTO.entry), pt(lot, tx - 1.3, tz), pt(lot, tx - 0.85, tz),
    ];
    const vip = this.level(p) >= RESTO_VIP_LEVEL && rnd() < 0.15;
    const walk = pathMs(path, WALK) / this.pace;
    const c = {
      id: `c${this.nextId++}`, seat, dish: dish.id, vip, look: customerLook(vip), path, side,
      arrive: now + walk, sat: now + walk, leaveAt: now + walk + (PATIENCE_MS + 10_000 * this.level(p)) / this.pace, state: 'in', plan,
    };
    r.customers.set(c.id, c);
    // Seated on the left of the table, facing it.
    c.face = lotYaw(lot) + Math.PI / 2;
    this._npc(lot, c, { path, t0: now, pose: 'sit', say: vip ? '⭐' : '' });
    r.dirty = true;
  }

  _npc(lot, c, ev) {
    this.room.broadcast('npc', {
      id: c.id, lot: lot.id, look: c.look, vip: c.vip, speed: WALK * this.pace,
      face: c.face, prop: null, say: '', ...ev,
    });
  }

  /** Customer leaves: happy (paid) or not. */
  _leave(p, lot, r, c, now, happy) {
    const out = [...c.path].reverse();
    // Out the door and away along the pavement, the other way from where they came.
    out[out.length - 1] = pt(lot, -c.side * (lot.w / 2 + 12), lotSpots(lot).street[1]);
    this._npc(lot, c, { path: out, t0: now, pose: 'walk', bye: true, say: happy ? (c.vip ? '💎' : '😋') : '😠' });
    r.customers.delete(c.id);
    r.orders = r.orders.filter((o) => o.cid !== c.id);
    r.dirty = true;
  }

  _serve(p, lot, r, order, now) {
    const c = r.customers.get(order.cid);
    r.orders = r.orders.filter((o) => o !== order);
    if (!c) return;
    c.state = 'eating';
    c.doneAt = now + EAT_MS / this.pace;
    const dish = DISH_BY_ID[c.dish];
    this._npc(lot, c, { path: [c.path[c.path.length - 1]], t0: now, pose: 'eat', prop: 'drink', say: dish.icon });
    r.dirty = true;
  }

  _pay(p, lot, r, c, now) {
    const res = p.restaurant;
    const dish = DISH_BY_ID[c.dish];
    const before = this.level(p);
    const paid = Math.round(dishPrice(dish) * res.price * (c.vip ? 2 : 1));
    p.money += paid;
    res.earned += paid;
    res.served++;
    this._dayStat(res, 'served', 1);
    this._dayStat(res, 'revenue', paid);
    // Quick service keeps the regulars coming.
    const waited = (c.servedAt || now) - c.sat;
    res.rep = Math.min(100, res.rep + (waited < (PATIENCE_MS / this.pace) / 2 ? 1.5 : 0.5));
    this.room._gainXp(p, paid / 60);
    this._leave(p, lot, r, c, now, true);
    this._levelCheck(p, before);
    if (p.ws) this.room.sendWallet(p);
  }

  _levelCheck(p, before) {
    const after = this.level(p);
    if (after <= before) return;
    const unlocks = {
      2: 'more tables and room for more staff',
      3: 'DELIVERIES — phone orders to ride out on your scooter',
      4: 'more dishes and more tables',
      5: 'VIP customers who pay double, and a brighter sign',
    }[after] || 'more';
    this.room.toastAll(`${p.name}'s ${RESTAURANTS[p.restaurant.type].name.toLowerCase()} reached level ${after}!`, 'big');
    if (p.ws) this.room.send(p.id, 'toast', { text: `Restaurant level ${after}: ${unlocks}.`, kind: 'big' });
    this.room.broadcast('restaurants', this.publicRestaurants());
  }

  _dayStat(res, k, v) {
    const day = this.room.clock.day;
    if (res.day.n !== day) res.day = { n: day, served: 0, revenue: 0, walkouts: 0, deliveries: 0 };
    res.day[k] += v;
  }

  // -------------------------------------------------------------- player acts

  /** You, at the pass: cook the next order yourself. */
  cookByHand(p, oid) {
    const r = this._rt(p.restaurant.lot);
    const o = r.orders.find((q) => q.oid === Number(oid)) || r.orders.find((q) => q.state === 'queued');
    if (!o || o.state !== 'queued') return { error: 'Nothing waiting to be cooked' };
    o.state = 'cooking';
    o.by = 'owner';
    o.readyAt = Date.now() + COOK_BY_HAND_MS;
    r.dirty = true;
    return { ok: true };
  }

  /** You carry a ready plate out. */
  serveByHand(p, oid) {
    const lot = LOT_BY_ID.get(p.restaurant.lot);
    const r = this._rt(lot.id);
    const o = r.orders.find((q) => q.oid === Number(oid)) || r.orders.find((q) => q.state === 'ready');
    if (!o || o.state !== 'ready') return { error: 'Nothing is ready to serve' };
    const c = r.customers.get(o.cid);
    if (c) c.servedAt = Date.now();
    this._serve(p, lot, r, o, Date.now());
    return { ok: true };
  }

  // -------------------------------------------------------- restaurant staff

  /** Called by the Staff for cooks, waiters and drivers. */
  nextJob(p, w) {
    const res = p.restaurant;
    if (!res) return { why: 'No restaurant' };
    const lot = LOT_BY_ID.get(res.lot);
    const r = this._rt(lot.id);
    const sp = lotSpots(lot);
    const at = (lx, lz) => lotPoint(lot, lx, lz);
    if (!res.open) return { why: 'The restaurant is closed' };

    if (w.role === 'cook' || (w.role === 'waiter' && !this._hasRole(p, 'cook') && !r.orders.some((o) => o.state === 'ready'))) {
      const o = r.orders.find((q) => q.state === 'queued');
      if (o) {
        o.state = 'cooking';
        o.by = w.id;
        const dish = DISH_BY_ID[o.dish];
        // Green thumbs never burn anything; everyone else now and then has to start over.
        const burnt = w.trait !== 'green' && rnd() < 0.04;
        return {
          job: {
            act: 'cook', at: at(...(rnd() < 0.5 ? sp.stove : sp.oven)), base: dish.prep * (burnt ? 1.8 : 1),
            status: `Cooking ${dish.name.toLowerCase()}${burnt ? ' (again — burnt the first one)' : ''}`,
            apply: () => { if (r.orders.includes(o)) { o.state = 'ready'; r.dirty = true; } },
          },
        };
      }
    }
    if (w.role === 'waiter' || (w.role === 'cook' && !this._hasRole(p, 'waiter'))) {
      const o = r.orders.find((q) => q.state === 'ready');
      if (o) {
        const c = r.customers.get(o.cid);
        const table = lotTables(lot)[c ? c.seat : 0];
        o.state = 'serving';
        const dish = DISH_BY_ID[o.dish];
        return {
          job: {
            act: 'serve', at: at(table[0] - 1.3, table[1]), base: 2.2, status: `Serving ${dish.name.toLowerCase()} to table ${(c ? c.seat : 0) + 1}`,
            apply: () => {
              if (!r.orders.includes(o)) return;
              const cc = r.customers.get(o.cid);
              if (cc) cc.servedAt = Date.now();
              this._serve(p, lot, r, o, Date.now());
            },
          },
        };
      }
      if (w.role === 'waiter') return { why: r.customers.size ? 'Waiting on the kitchen' : 'Waiting for customers' };
    }
    if (w.role === 'driver') {
      const d = r.deliveries.find((q) => q.state === 'waiting' && Date.now() - q.created > DELIVERY_GRACE_MS / this.pace);
      if (d) {
        d.state = 'driver';
        const trip = (Math.hypot(d.dest.pos[0] - at(...sp.scooter)[0], d.dest.pos[2] - at(...sp.scooter)[1]) / 9) * 2 + 8;
        return {
          job: {
            act: 'deliver', at: at(sp.scooter[0] - 1, sp.scooter[1]), base: trip, status: `Riding a ${DISH_BY_ID[d.dish].name.toLowerCase()} to ${d.dest.label}`,
            apply: () => this._completeDelivery(p, lot, r, d, { driver: w }),
          },
        };
      }
      return { why: this.level(p) < RESTO_DELIVERY_LEVEL ? `Deliveries start at restaurant level ${RESTO_DELIVERY_LEVEL}` : 'No deliveries waiting' };
    }
    return { why: r.customers.size ? 'Waiting for orders' : 'Waiting for customers' };
  }

  _hasRole(p, role) { return p.workers.some((w) => w.role === role && w.off !== this.room.clock.day); }

  workSpot(p, w) {
    if (!p.restaurant) return null;
    const lot = LOT_BY_ID.get(p.restaurant.lot);
    const sp = lotSpots(lot);
    const spot = w.role === 'cook' ? sp.stove : w.role === 'driver' ? [sp.scooter[0] - 1, sp.scooter[1]] : sp.waiter;
    const [x, z] = lotPoint(lot, spot[0], spot[1]);
    return [x, 0, z];
  }

  // ------------------------------------------------------------- deliveries

  _newDelivery(p, lot, r, now) {
    const { dish, plan } = this._pickDish(p);
    if (!dish) return;
    const dest = pick(this.spots);
    const from = lotPoint(lot, 0, 0);
    const dist = Math.hypot(dest.pos[0] - from[0], dest.pos[2] - from[1]);
    const total = ((dist / 7 + 45) * 1000) / this.pace;
    const d = { id: this.nextId++, dish: dish.id, dest, created: now, deadline: now + total, total, state: 'waiting', plan };
    r.deliveries.push(d);
    r.dirty = true;
    if (p.ws) this.room.send(p.id, 'toast', { text: `📞 Delivery: ${dish.icon} ${dish.name} to ${dest.label}. Pick it up at your counter.`, kind: 'event' });
  }

  takeDelivery(p, id) {
    const r = this._rt(p.restaurant.lot);
    if (p.carrying) return { error: 'One delivery at a time' };
    const d = r.deliveries.find((q) => q.id === Number(id) && q.state === 'waiting');
    if (!d) return { error: 'That order has gone' };
    d.state = 'player';
    d.damaged = false;
    p.carrying = { id: d.id, lot: p.restaurant.lot, dish: d.dish, dest: d.dest.label, pos: d.dest.pos, deadline: d.deadline, total: d.total };
    r.dirty = true;
    return { delivery: p.carrying };
  }

  /** You arrived at the door with the food. The server checks you are really there. */
  dropOff(p) {
    const c = p.carrying;
    if (!c) return { error: 'You are not carrying anything' };
    const owner = p;
    const lot = LOT_BY_ID.get(c.lot);
    const r = this._rt(c.lot);
    const d = r.deliveries.find((q) => q.id === c.id);
    if (!d) { p.carrying = null; return { error: 'That order was cancelled' }; }
    if (Math.hypot(p.pos[0] - d.dest.pos[0], p.pos[2] - d.dest.pos[2]) > 6) return { error: `This goes to ${d.dest.label}` };
    return this._completeDelivery(owner, lot, r, d, { player: p });
  }

  /** A hard crash spills the food: the tip is halved. */
  spill(p) {
    const c = p.carrying;
    if (!c) return;
    const d = this._rt(c.lot).deliveries.find((q) => q.id === c.id);
    if (d && !d.damaged) {
      d.damaged = true;
      this.room.send(p.id, 'toast', { text: 'Ouch — the food got thrown about. That will cost you the tip.', kind: 'warn' });
    }
  }

  _completeDelivery(p, lot, r, d, { player = null, driver = null } = {}) {
    if (d.state === 'done') return { error: 'Already delivered' };
    const res = p.restaurant;
    const now = Date.now();
    const dish = DISH_BY_ID[d.dish];
    const base = dishPrice(dish) * res.price;
    let tip = 0;
    let late = false;
    if (driver) tip = base * DRIVER_TIP;
    else {
      late = now > d.deadline;
      tip = late ? 0 : base * DELIVERY_TIP * Math.max(0, (d.deadline - now) / d.total);
      if (d.damaged) tip /= 2;
    }
    const paid = Math.round((late ? base * 0.5 : base) + tip);
    const before = this.level(p);
    d.state = 'done';
    p.money += paid;
    res.earned += paid;
    res.served++;
    this._dayStat(res, 'served', 1);
    this._dayStat(res, 'deliveries', 1);
    this._dayStat(res, 'revenue', paid);
    res.rep = Math.max(0, Math.min(100, res.rep + (late ? -1 : 2)));
    p.stats.deliveries = (p.stats.deliveries || 0) + 1;
    this.room._gainXp(p, paid / 50);
    if (player) {
      player.carrying = null;
      this.room.send(player.id, 'delivered', { paid, tip: Math.round(tip), late, damaged: !!d.damaged });
    } else if (p.ws) {
      this.room.send(p.id, 'toast', { text: `${driver.name} delivered a ${dish.name.toLowerCase()} (+${money(paid)}).`, kind: 'info' });
    }
    r.deliveries = r.deliveries.filter((q) => q !== d);
    r.dirty = true;
    this._levelCheck(p, before);
    this.room.sendWallet(p);
    return { paid, tip, late };
  }

  // ------------------------------------------------------------------ tick

  tick(now = Date.now()) {
    if (now - this.lastTick < TICK_MS) return;
    this.lastTick = now;
    for (const p of this.room.profiles.values()) {
      const res = p.restaurant;
      if (!res) continue;
      const lot = LOT_BY_ID.get(res.lot);
      const r = this._rt(lot.id);

      if (res.autostock && now - r.lastStock > AUTOSTOCK_MS / this.pace) {
        r.lastStock = now;
        if (this._autostock(p)) { r.dirty = true; if (p.ws) this.room.sendWallet(p); }
      }

      // Customers only come in if somebody can cook: you (online) or a cook.
      const staffed = !!p.ws || this._hasRole(p, 'cook');
      if (res.open && staffed && now >= r.nextArrival) {
        r.nextArrival = now + this._arrivalGap(p);
        this._spawnCustomer(p, lot, r, now);
      }
      if (res.open && staffed && this.level(p) >= RESTO_DELIVERY_LEVEL && now >= r.nextDelivery) {
        r.nextDelivery = now + (this._arrivalGap(p) * 3.5);
        if (r.nextDelivery - now > 0 && r.deliveries.filter((d) => d.state !== 'done').length < 2) this._newDelivery(p, lot, r, now);
      }

      for (const c of [...r.customers.values()]) {
        if (c.state === 'in' && now >= c.arrive) {
          c.state = 'waiting';
          c.sat = now;
          r.orders.push({ oid: this.nextId++, cid: c.id, dish: c.dish, state: 'queued' });
          this._npc(lot, c, { path: [c.path[c.path.length - 1]], t0: now, pose: 'sit', say: DISH_BY_ID[c.dish].icon });
          r.dirty = true;
        } else if (c.state === 'waiting' && now >= c.leaveAt) {
          // Waited too long. Anything not yet cooked goes back in the pantry.
          const o = r.orders.find((q) => q.cid === c.id);
          if (o && o.state === 'queued') this._refund(res, c.plan);
          res.rep = Math.max(0, res.rep - 3);
          this._dayStat(res, 'walkouts', 1);
          this._leave(p, lot, r, c, now, false);
          if (p.ws) this.room.send(p.id, 'toast', { text: 'A customer got fed up waiting and walked out.', kind: 'warn' });
        } else if (c.state === 'eating' && now >= c.doneAt) {
          this._pay(p, lot, r, c, now);
        }
      }
      for (const o of r.orders) {
        if (o.state === 'cooking' && o.by === 'owner' && now >= o.readyAt) { o.state = 'ready'; r.dirty = true; }
      }
      for (const d of [...r.deliveries]) {
        if (d.state === 'waiting' && now > d.deadline) {
          this._refund(res, d.plan);
          res.rep = Math.max(0, res.rep - 2);
          r.deliveries = r.deliveries.filter((q) => q !== d);
          r.dirty = true;
          if (p.ws) this.room.send(p.id, 'toast', { text: 'A delivery order was cancelled — nobody took it.', kind: 'warn' });
        } else if (d.state === 'player' && now > d.deadline + 60_000 / this.pace) {
          for (const q of this.room.players.values()) if (q.carrying && q.carrying.id === d.id) { q.carrying = null; this.room.send(q.id, 'delivered', { failed: true }); }
          res.rep = Math.max(0, res.rep - 3);
          r.deliveries = r.deliveries.filter((q) => q !== d);
          r.dirty = true;
        }
      }
      if (r.dirty && now - r.lastSent > 400) this._push(p);
    }
  }

  /** Everybody in every restaurant right now, for someone who just joined. */
  snapshotNpcs(now = Date.now()) {
    const out = [];
    for (const [lotId, r] of this.rt) {
      for (const c of r.customers.values()) {
        const seat = c.path[c.path.length - 1];
        const pose = c.state === 'eating' ? 'eat' : 'sit';
        out.push({
          id: c.id, lot: lotId, look: c.look, vip: c.vip, speed: WALK * this.pace, face: c.face,
          path: c.state === 'in' ? c.path : [seat], t0: c.state === 'in' ? c.arrive - pathMs(c.path, WALK) / this.pace : now,
          pose, prop: c.state === 'eating' ? 'drink' : null, say: c.state === 'eating' ? '' : DISH_BY_ID[c.dish].icon,
        });
      }
    }
    return out;
  }
}

function pathMs(path, speed) {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return (d / speed) * 1000;
}

