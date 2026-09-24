// Running a neighbourhood: the upgrades a boss buys at the clubhouse, the
// gang's name, and the health of the buildings (restaurants, the clubhouse,
// the houses) that raiders and rival gangs knock about.
//
// Restaurants ask here how busy they should be (footfall) and whether they
// can open at all (a wrecked one cannot).
import {
  HOOD_UPGRADES, hoodLevel, hoodMax, levelOf, money, repairCost, streetFootfall, wallsFactor, houseRent,
  GANG_NAME_MAX, RESTAURANTS,
} from '../shared/catalog.js';
import { HOOD_T } from '../shared/hoods.js';

const REPAIR_ALL_DISCOUNT = 0.9;

/** Every building in a hood that can be damaged, as { key, kind, label }. */
export function hoodBuildings(p) {
  const out = [];
  for (const res of p.restaurants || []) {
    out.push({ key: `r${res.lot}`, kind: 'restaurant', label: `${RESTAURANTS[res.type] ? RESTAURANTS[res.type].name : 'Restaurant'} (lot ${res.lot})`, lot: res.lot });
  }
  if (p.plot >= 0) {
    out.push({ key: 'hq', kind: 'hq', label: 'The clubhouse' });
    for (const h of HOOD_T.houses) out.push({ key: `h${h.k}`, kind: 'house', label: `No. ${h.k + 1}` });
  }
  return out;
}

export const hpOf = (p, key) => {
  const v = p.hood && p.hood.hp && p.hood.hp[key];
  return Number.isFinite(v) ? v : 100;
};

export class Hoods {
  constructor(room) {
    this.room = room;
  }

  /** How the upgrades, the clubhouse and the buildings look to the boss. */
  summary(p) {
    const lvl = levelOf(p.xp);
    return {
      up: Object.fromEntries(Object.keys(HOOD_UPGRADES).map((k) => [k, hoodLevel(p.hood, k)])),
      next: Object.fromEntries(Object.entries(HOOD_UPGRADES).map(([k, def]) => {
        const at = hoodLevel(p.hood, k);
        const price = at < hoodMax(k) ? def.levels[at - def.start] : null;
        return [k, { price, locked: lvl < def.level ? def.level : 0 }];
      })),
      buildings: hoodBuildings(p).map((b) => {
        const hp = hpOf(p, b.key);
        return { ...b, hp: Math.round(hp), cost: repairCost(b.kind, hp, b.kind === 'hq' ? hoodLevel(p.hood, 'hq') : 1) };
      }),
    };
  }

  // ------------------------------------------------------------- actions

  upgrade(p, key) {
    const def = HOOD_UPGRADES[key];
    if (!def) return { error: 'No such upgrade' };
    if (p.plot < 0) return { error: 'You need a hood first' };
    const at = hoodLevel(p.hood, key);
    if (at >= hoodMax(key)) return { error: `${def.name} is as good as it gets` };
    const lvl = levelOf(p.xp);
    if (lvl < def.level) return { error: `${def.name} opens up at farm level ${def.level}` };
    const price = def.levels[at - def.start];
    if (p.money < price) return { error: `${def.name} costs ${money(price)}` };
    p.money -= price;
    p.hood.up[key] = at + 1;
    this.room.broadcast('plot', this.room.publicPlot(p.plot));
    return { ok: `${def.name} is now level ${at + 1}` };
  }

  rename(p, raw) {
    const name = String(raw || '').replace(/[^\p{L}\p{N} '&.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, GANG_NAME_MAX);
    if (name.length < 3) return { error: 'A gang name needs at least three letters' };
    p.gang.name = name;
    this.room.broadcast('players', this.room.publicPlayers());
    if (p.plot >= 0) this.room.broadcast('plot', this.room.publicPlot(p.plot));
    return { ok: `Your gang is the ${name} now` };
  }

  /** Fixes one building (by key) or, with 'all', everything, for a little less. */
  repair(p, key) {
    const list = hoodBuildings(p).filter((b) => (key === 'all' || b.key === key) && hpOf(p, b.key) < 100);
    if (!list.length) return { error: 'Nothing needs fixing' };
    let cost = 0;
    for (const b of list) cost += repairCost(b.kind, hpOf(p, b.key), b.kind === 'hq' ? hoodLevel(p.hood, 'hq') : 1);
    if (key === 'all') cost = Math.ceil(cost * REPAIR_ALL_DISCOUNT / 10) * 10;
    if (p.money < cost) return { error: `That repair costs ${money(cost)}` };
    p.money -= cost;
    for (const b of list) {
      delete p.hood.hp[b.key];
      this._broadcastBuilding(p, b.key);
    }
    return { ok: list.length > 1 ? `Everything is patched up (${money(cost)})` : `${list[0].label} is patched up (${money(cost)})` };
  }

  /**
   * Knocks a building about. Walls soak some of it. Returns the new health.
   * A restaurant at zero is wrecked: it shuts until somebody pays to fix it.
   */
  damage(p, key, amount) {
    const before = hpOf(p, key);
    if (before <= 0) return 0;
    const hp = Math.max(0, before - amount * wallsFactor(hoodLevel(p.hood, 'walls')));
    if (hp >= 100) delete p.hood.hp[key];
    else p.hood.hp[key] = Math.round(hp * 10) / 10;
    if (Math.floor(hp / 10) !== Math.floor(before / 10) || hp <= 0) this._broadcastBuilding(p, key);
    if (hp <= 0 && before > 0 && key.startsWith('r') && p.ws) this.room.error(p, 'One of your restaurants has been wrecked! Repair it at the clubhouse.');
    return hp;
  }

  _broadcastBuilding(p, key) {
    this.room.broadcast('bldg', { hood: p.plot, owner: p.slug, key, hp: Math.round(hpOf(p, key)) });
    this.room.walletSoon(p);
  }

  // ------------------------------------------------------ restaurant hooks

  /** More customers with a nice street and a billboard; fewer if the place is falling down. */
  footfall(p, res) {
    let f = streetFootfall(hoodLevel(p.hood, 'street'), hoodLevel(p.hood, 'billboard'));
    if (hpOf(p, `r${res.lot}`) < 50) f *= 0.6;
    if (this.room.tagPenalty) f *= this.room.tagPenalty(p);
    return f;
  }

  closedFor(p, res) {
    return hpOf(p, `r${res.lot}`) <= 0 ? 'Wrecked — repair it at the clubhouse' : null;
  }

  /** Every morning: rent from the done-up houses. */
  collectRent() {
    for (const p of this.room.profiles.values()) {
      if (p.plot < 0) continue;
      const rent = houseRent(hoodLevel(p.hood, 'houses'));
      if (!rent) continue;
      // Houses with holes in them do not pay.
      let fine = 0;
      for (const h of HOOD_T.houses) if (hpOf(p, `h${h.k}`) >= 50) fine++;
      const paid = Math.round(rent * fine / HOOD_T.houses.length);
      if (!paid) continue;
      p.money += paid;
      if (p.ws) {
        this.room.send(p.id, 'toast', { text: `Rent came in from the houses: ${money(paid)}.`, kind: 'info' });
        this.room.walletSoon(p);
      }
    }
  }
}
