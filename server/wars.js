// Gang wars between two bosses. Declared at the clubhouse; a minute's
// warning while both gangs get ready; six minutes of fighting over the
// defender's hood; then whoever scored more wins. A tie goes to the defender.
//
// Scoring (the attacker scores in the defender's hood, the defender by
// seeing them off):
//   tag a wall +3, and +1 every 30 s it stays up
//   waste the other boss +2; down one of their gang +1
//   crack a till and get the bag home: +1 per $500
//   wreck a building +2
//
// The winner takes the pot (the declaration fee) and holds the loser's hood
// for a day, taking 20% of what its restaurants earn. Nobody else is ever
// caught in it: only the two sides can hurt each other.
//
// Both bosses must be online. If one leaves, there is a minute's grace; then
// the war ends, a win for the other side if the one who left was behind.
import { levelOf, money, DAY_MS } from '../shared/catalog.js';
import { HOODS, HQS, HOOD_T, TAG_POINTS, hx, hz } from '../shared/hoods.js';
import { LOT_BY_ID, lotPoint, lotSpots } from '../shared/map.js';
import { hoodBuildings, hpOf } from './hoods.js';

const MIN = 60_000;
export const WAR = {
  warnMs: 60_000,
  activeMs: 6 * MIN,
  cooldownMs: 20 * MIN,          // between one boss's declarations
  pairMs: 60 * MIN,              // before the same two can go again
  protectLossMs: 30 * MIN,
  protectWinMs: 15 * MIN,
  graceMs: 60_000,
  levelGap: 3,                   // you cannot declare on someone this many levels below you
  feeMin: 1000,
  feeShare: 0.02,
  turfCut: 0.2,
  tagMs: 4000,
  crackMs: 5000,
  smashMs: 5000,
  smashHp: 35,
  heldEvery: 30_000,
  reach: 3.2,
};

const pairKey = (a, b) => [a, b].sort().join('|');

export class Wars {
  constructor(room, saved) {
    this.room = room;
    this.turf = (saved && saved.turf) || {};              // hood -> { holder, holderName, color, until, cut }
    this.cooldowns = (saved && saved.cooldowns) || {};    // pair -> real time they can go again
    this.history = (saved && Array.isArray(saved.history) ? saved.history : []).slice(-30);
    this.war = null;                                      // one war at a time keeps the valley readable
    this.lastSync = 0;
  }

  toSave() { return { turf: this.turf, cooldowns: this.cooldowns, history: this.history.slice(-30) }; }

  // ---------------------------------------------------------------- queries

  /** Are these two bosses (slugs) at war right now (fighting, not just warned)? */
  atWar(a, b) {
    const w = this.war;
    if (!w || w.phase !== 'active' || !a || !b) return false;
    return (a === w.attacker && b === w.defender) || (a === w.defender && b === w.attacker);
  }

  warOf(slug) {
    const w = this.war;
    return w && w.phase !== 'over' && (w.attacker === slug || w.defender === slug) ? w : null;
  }

  /** Is this hood being fought over (so its boss comes round elsewhere)? */
  contested(hood) { return !!this.war && this.war.phase === 'active' && this.war.hood === hood; }

  fee(p) { return Math.max(WAR.feeMin, Math.round(this.room.netWorth(p) * WAR.feeShare / 10) * 10); }

  /** Why `a` cannot declare on `b`, or null if they can. */
  whyNot(a, b, now = Date.now()) {
    if (!b || a === b) return 'Pick somebody to go to war with';
    if (a.plot < 0) return 'You need a hood of your own';
    if (!b.ws) return `${b.name} is not in the valley`;
    if (b.plot < 0) return `${b.name} has no hood to fight over`;
    if (this.war && this.war.phase !== 'over') return 'There is already a war on';
    if (this.room.raids && (this.room.raids.raidOn(a.plot) || this.room.raids.raidOn(b.plot))) return 'Not while a hood is being raided';
    if (now < (a.war.lastDeclared || 0) + WAR.cooldownMs) return `Your gang needs ${Math.ceil(((a.war.lastDeclared + WAR.cooldownMs) - now) / MIN)} more minutes to regroup`;
    if (now < (b.war.protectUntil || 0)) return `${b.name}'s gang is licking its wounds for ${Math.ceil((b.war.protectUntil - now) / MIN)} more minutes`;
    if (now < (this.cooldowns[pairKey(a.slug, b.slug)] || 0)) return `You two fought too recently`;
    if (levelOf(a.xp) - levelOf(b.xp) >= WAR.levelGap) return `${b.name} is too small to pick on`;
    const fee = this.fee(a);
    if (a.money < fee) return `Declaring costs ${money(fee)}`;
    return null;
  }

  /** Everything the clubhouse panel needs to show. */
  summary(p) {
    const now = Date.now();
    const rivals = [];
    for (const q of this.room.players.values()) {
      if (q === p || q.plot < 0) continue;
      rivals.push({ slug: q.slug, name: q.name, gang: q.gang.name, color: q.color, level: levelOf(q.xp), why: this.whyNot(p, q, now) });
    }
    return { you: p.slug, fee: this.fee(p), rivals, war: this.war ? this.publicWar() : null };
  }

  publicWar() {
    const w = this.war;
    if (!w) return null;
    return {
      id: w.id, phase: w.phase, hood: w.hood, attacker: w.attacker, defender: w.defender,
      names: w.names, gangs: w.gangs, colors: w.colors, score: w.score, pot: w.pot,
      startsAt: w.startsAt, endsAt: w.endsAt, result: w.result || null,
    };
  }

  // ---------------------------------------------------------------- actions

  declare(a, b, now = Date.now()) {
    const why = this.whyNot(a, b, now);
    if (why) return { error: why };
    const fee = this.fee(a);
    a.money -= fee;
    a.war.lastDeclared = now;
    this.war = {
      id: `w${now}`, phase: 'warning', hood: b.plot, attacker: a.slug, defender: b.slug,
      names: { [a.slug]: a.name, [b.slug]: b.name }, gangs: { [a.slug]: a.gang.name, [b.slug]: b.gang.name },
      colors: { [a.slug]: a.color, [b.slug]: b.color },
      score: { [a.slug]: 0, [b.slug]: 0 }, pot: fee,
      startsAt: now + WAR.warnMs, endsAt: now + WAR.warnMs + WAR.activeMs,
      gone: {}, heldAt: now, bags: new Map(),
    };
    this.room.broadcast('war', this.publicWar());
    const text = `${a.gang.name} have declared war on ${b.gang.name}!`;
    this.room.toastAll(`⚔️ ${text}`, 'event');
    for (const q of [a, b]) this.room.send(q.id, 'bigtext', { title: 'WAR DECLARED', sub: q === a ? `On ${b.gang.name}. It starts in a minute: get to ${HOODS[b.plot].name}.` : `${a.gang.name} are coming for ${HOODS[b.plot].name} in a minute. Get home.`, color: '#ff4a3a' });
    return { ok: text };
  }

  surrender(p) {
    const w = this.warOf(p.slug);
    if (!w) return { error: 'You are not at war' };
    this._end(w, p.slug === w.attacker ? w.defender : w.attacker, `${p.name} gave up`);
    return { ok: 'You gave up. It happens.' };
  }

  /**
   * An attacker holding E at something in the defender's hood: a wall to
   * tag, a till to crack, a building to smash. Called every quarter second
   * while E is held; returns progress 0..1 (or an error).
   */
  work(p, kind, target, now = Date.now()) {
    const w = this.war;
    if (!w || w.phase !== 'active' || p.slug !== w.attacker) return { error: 'Only the attacking side does that, in a war' };
    if (p.koUntil && now < p.koUntil) return { error: 'You are down' };
    const spot = this._spot(w, kind, target);
    if (!spot) return { error: 'Nothing to do there' };
    if (Math.hypot(p.pos[0] - spot[0], p.pos[2] - spot[1]) > WAR.reach) return { error: 'Get closer' };
    // Anyone from the other side close by stops you.
    if (this._defenderNear(w, spot, 6)) return { error: 'Not with them breathing down your neck' };
    const need = kind === 'tag' ? WAR.tagMs : kind === 'crack' ? WAR.crackMs : WAR.smashMs;
    const key = `${kind}:${target}`;
    if (!p.warWork || p.warWork.key !== key || now - p.warWork.last > 700) p.warWork = { key, start: now, last: now };
    p.warWork.last = now;
    const k = Math.min(1, (now - p.warWork.start) / need);
    if (k < 1) return { k };
    p.warWork = null;
    const def = this.room.profiles.get(w.defender);
    if (kind === 'tag') {
      this.room.setTag(target, { gang: p.slug, name: p.gang.name, color: p.color });
      this._score(w, p.slug, 3, `${p.name} tagged a wall`);
    } else if (kind === 'crack') {
      if (p.bag) return { error: 'You are already carrying a bag' };
      const take = this.room.restaurants.crackTill(Number(target), 0.6, 0);
      if (take <= 0) return { error: 'That till is empty' };
      p.bag = { amount: take, owner: w.defender, lot: Number(target) };
      this.room.send(p.id, 'bigtext', { title: `${money(take)}!`, sub: 'Get it back to your clubhouse to bank it.', color: '#6dff7a' });
      if (def && def.ws) this.room.error(def, `${p.name} cracked one of your tills! Stop them getting home with ${money(take)}.`);
    } else if (kind === 'smash') {
      const before = hpOf(def, target);
      const hp = this.room.hoods.damage(def, target, WAR.smashHp);
      if (before > 0 && hp <= 0) this._score(w, p.slug, 2, `${p.name} wrecked a building`);
    }
    return { k: 1, done: true };
  }

  /** Where the thing an attacker works on is. */
  _spot(w, kind, target) {
    if (kind === 'tag') {
      const t = TAG_POINTS.find((q) => q.id === target && q.hood === w.hood);
      return t ? [t.pos[0], t.pos[2]] : null;
    }
    const def = this.room.profiles.get(w.defender);
    if (!def) return null;
    if (kind === 'crack') {
      const res = def.restaurants.find((r) => r.lot === Number(target));
      if (!res) return null;
      const lot = LOT_BY_ID.get(res.lot);
      const sp = lotSpots(lot);
      return lotPoint(lot, sp.counter[0], sp.counter[1]);
    }
    if (kind === 'smash') {
      const b = hoodBuildings(def).find((x) => x.key === target);
      if (!b) return null;
      return buildingDoor(def, b);
    }
    return null;
  }

  _defenderNear(w, spot, r) {
    const def = this.room.profiles.get(w.defender);
    if (def && def.ws && !(def.koUntil && Date.now() < def.koUntil) && Math.hypot(def.pos[0] - spot[0], def.pos[2] - spot[1]) < r) return true;
    for (const u of this.room.combat.units.values()) {
      if (u.owner === w.defender && u.state !== 'down' && Math.hypot(u.x - spot[0], u.z - spot[1]) < r) return true;
    }
    return false;
  }

  _score(w, slug, pts, why) {
    if (!w || w.phase !== 'active' || !(slug in w.score)) return;
    w.score[slug] += pts;
    this.room.broadcast('war', this.publicWar());
    if (why) this.room.broadcast('feed', { text: `${why} (+${pts})`, kind: 'war' });
  }

  // ------------------------------------------------------------ hooks

  /** Someone was wasted: points for the other side, and any bag hits the floor. */
  onWasted(p) {
    const w = this.war;
    if (p.bag) this._dropBag(p);
    if (!w || w.phase !== 'active') return;
    const other = p.slug === w.attacker ? w.defender : p.slug === w.defender ? w.attacker : null;
    if (!other) return;
    this._score(w, other, 2, `${w.names[other]}'s side wasted ${p.name}`);
  }

  /** A gang member went down: a point to whoever's side did it. */
  onUnitDown(u) {
    const w = this.war;
    if (!w || w.phase !== 'active' || !u.owner) return;
    const other = u.owner === w.attacker ? w.defender : u.owner === w.defender ? w.attacker : null;
    if (other) this._score(w, other, 1, null);
  }

  _dropBag(p) {
    const bag = p.bag;
    p.bag = null;
    const R = this.room.raids;
    const id = `l${R.nextId++}`;
    R.loot.set(id, { id, x: p.pos[0], z: p.pos[2], amount: bag.amount, owner: bag.owner, lot: bag.lot, hood: this.war ? this.war.hood : -1, at: Date.now() });
    R._broadcastLoot();
  }

  /** A bag carried by someone who left, or at the end of the war, goes home to its till. */
  _returnBag(p) {
    if (!p.bag) return;
    this.room.raids._return(p.bag.owner, p.bag.lot, p.bag.amount);
    p.bag = null;
  }

  /** How much of a hood's takings go to whoever holds it after a war. */
  turfCut(p, amount) {
    const t = this.turf[p.plot];
    if (!t || this.room.clock.time > t.until || t.holder === p.slug) return 0;
    const holder = this.room.profiles.get(t.holder);
    if (!holder) return 0;
    const cut = amount * t.cut;
    holder.money += cut;
    this.room.walletSoon(holder);
    return cut;
  }

  // ------------------------------------------------------------------ tick

  tick(now = Date.now()) {
    for (const [h, t] of Object.entries(this.turf)) if (this.room.clock.time > t.until) { delete this.turf[h]; this._syncTurf(); }
    for (const [k, until] of Object.entries(this.cooldowns)) if (now > until) delete this.cooldowns[k];
    const w = this.war;
    if (!w) return;
    if (w.phase === 'over') { this.war = null; return; }
    const a = this.room.profiles.get(w.attacker);
    const d = this.room.profiles.get(w.defender);
    // Someone walked out: a minute to come back.
    for (const q of [a, d]) {
      if (!q) continue;
      if (q.ws) { delete w.gone[q.slug]; continue; }
      if (!w.gone[q.slug]) w.gone[q.slug] = now;
      if (now - w.gone[q.slug] > WAR.graceMs) {
        const other = q === a ? d : a;
        const behind = w.score[q.slug] < w.score[other.slug];
        this._end(w, behind ? other.slug : null, `${q.name} left the valley`);
        return;
      }
    }
    if (w.phase === 'warning' && now >= w.startsAt) {
      w.phase = 'active';
      w.heldAt = now;
      this._mobilise(w);
      for (const q of [a, d]) if (q && q.ws) this.room.send(q.id, 'bigtext', { title: 'WAR!', sub: `${w.gangs[w.attacker]} vs ${w.gangs[w.defender]}: six minutes.`, color: '#ff4a3a' });
      this.room.broadcast('war', this.publicWar());
    }
    if (w.phase !== 'active') return;
    // Bags taken home to the clubhouse are banked.
    if (a && a.bag && a.plot >= 0) {
      const q = HQS[a.plot];
      if (Math.hypot(a.pos[0] - q.door[0], a.pos[2] - q.door[2]) < 4) {
        const amt = a.bag.amount;
        a.bag = null;
        a.money += amt;
        this.room.walletSoon(a);
        this._score(w, a.slug, Math.max(1, Math.floor(amt / 500)), `${a.name} banked ${money(amt)} of stolen takings`);
      }
    }
    // Tags that stay up keep scoring.
    if (now - w.heldAt >= WAR.heldEvery) {
      w.heldAt = now;
      let held = 0;
      for (const [id, tag] of this.room.tags) {
        const t = TAG_POINTS.find((q) => q.id === id);
        if (t && t.hood === w.hood && tag.gang === w.attacker) held++;
      }
      if (held) this._score(w, w.attacker, held, null);
    }
    if (now >= w.endsAt) {
      const s = w.score;
      const winner = s[w.attacker] > s[w.defender] ? w.attacker : w.defender;
      this._end(w, winner, 'time');
    }
    if (now - this.lastSync > 5000) { this.lastSync = now; this.room.broadcast('war', this.publicWar()); }
  }

  /** The attacker's soldiers roll up at the defender's hood; the defender's workers arm up. */
  _mobilise(w) {
    const h = HOODS[w.hood];
    const x = h.mirror ? h.x0 + 6 : h.x1 - 6;
    const z = hz(h, (HOOD_T.street.z0 + HOOD_T.street.z1) / 2);
    let i = 0;
    for (const u of this.room.combat.units.values()) {
      if (u.owner !== w.attacker || u.kind !== 'gang') continue;
      u.x = x + (i % 3) * 1.5;
      u.z = z - 2 + Math.floor(i / 3) * 1.5;
      u.route = [[hx(h, 216), hz(h, 110)], [hx(h, 150), z], [hx(h, 95), z], [hx(h, 150), z]];
      u.leg = 0;
      u.warSide = 'attack';
      i++;
    }
  }

  _end(w, winnerSlug, why) {
    const now = Date.now();
    w.phase = 'over';
    const a = this.room.profiles.get(w.attacker);
    const d = this.room.profiles.get(w.defender);
    const winner = winnerSlug ? this.room.profiles.get(winnerSlug) : null;
    const loser = winner ? (winner === a ? d : a) : null;
    for (const q of [a, d]) if (q) this._returnBag(q);
    if (winner) {
      winner.money += w.pot;
      this.room._gainXp(winner, 600);
      winner.stats.warsWon = (winner.stats.warsWon || 0) + 1;
      winner.war.protectUntil = now + WAR.protectWinMs;
    }
    if (loser) {
      loser.stats.warsLost = (loser.stats.warsLost || 0) + 1;
      loser.war.protectUntil = now + WAR.protectLossMs;
      if (loser.plot >= 0) {
        this.turf[loser.plot] = { holder: winner.slug, holderName: winner.name, gang: winner.gang.name, color: winner.color, until: this.room.clock.time + DAY_MS, cut: WAR.turfCut };
        this._syncTurf();
      }
    } else if (!winner && a) {
      a.money += w.pot;                    // no contest: the fee goes back
    }
    this.cooldowns[pairKey(w.attacker, w.defender)] = now + WAR.pairMs;
    w.result = { winner: winnerSlug, why, score: { ...w.score } };
    this.history.push({ at: now, attacker: w.attacker, defender: w.defender, winner: winnerSlug, score: { ...w.score } });
    // The attacker's soldiers go home.
    for (const u of [...this.room.combat.units.values()]) if (u.warSide === 'attack') this.room.combat.remove(u.id);
    this.room.broadcast('war', this.publicWar());
    for (const q of [a, d]) {
      if (!q || !q.ws) continue;
      const won = winner === q;
      const title = !winner ? 'NO CONTEST' : won ? 'VICTORY' : 'DEFEAT';
      const sub = !winner ? why : won ? `+${money(w.pot)}${loser && loser.plot >= 0 ? ` and ${HOODS[loser.plot].name} pays you 20% for a day` : ''}` : `${winner.gang.name} run your hood for a day.`;
      this.room.send(q.id, 'bigtext', { title, sub, color: won ? '#f2c14e' : '#ff6a5a' });
      this.room.sendWallet(q);
    }
    if (winner) this.room.toastAll(`${winner.gang.name} won the war (${w.score[w.attacker]}–${w.score[w.defender]}).`, 'event');
  }

  _syncTurf() {
    this.room.broadcast('turf', this.turf);
    for (const i of Object.keys(this.turf)) {
      const plot = this.room.publicPlot(Number(i));
      if (plot) this.room.broadcast('plot', plot);
    }
  }

  /** On disconnect: a carried bag goes home to its till. */
  onLeave(p) { this._returnBag(p); }
}

/** The front door of a building in a hood (for smashing it). */
export function buildingDoor(p, b) {
  const h = HOODS[p.plot];
  if (b.kind === 'restaurant') {
    const lot = LOT_BY_ID.get(b.lot);
    const sp = lotSpots(lot);
    return lotPoint(lot, sp.door[0], sp.door[1] - 1);
  }
  if (b.kind === 'hq') return [HQS[p.plot].door[0], HQS[p.plot].door[2]];
  const house = HOOD_T.houses[Number(b.key.slice(1))];
  return [hx(h, house.door[0]), hz(h, house.door[1])];
}

