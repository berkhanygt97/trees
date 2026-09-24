// Rival gangs raiding a hood. Only hoods whose boss is in the valley get hit,
// only once they are worth robbing, and harder the richer they are (or as the
// host sets it: relaxed, normal, hardcore).
//
// A raid: a warning (sooner with lookouts), then a car full of raiders comes
// down the avenue and into the hood street. They pile out and go to work:
// crack the fullest tills, spray their name on the walls, smash up buildings,
// trample the crops. Your soldiers fight, and with an armoury so does every
// worker; the rest shelter in the clubhouse. A raider with a bag of money
// heads back to the car; drop them and the bag falls where they stood, and
// you get it back by picking it up. If the car gets away, so does the money.
//
// Money never appears or vanishes: what is in bags or lying in the street is
// always put back into the tills if the raid is called off or the server
// stops. Only bags that drive away are lost.
import { CONFIG } from '../shared/config.js';
import {
  RIVALS, levelOf, lootShare, crackSeconds, raidWarning, hoodLevel, gangGun, money,
} from '../shared/catalog.js';
import { HOODS, HQS, HOOD_T, TAG_POINTS, hx, hz } from '../shared/hoods.js';
import { raidRoute } from '../shared/roads.js';
import { LOT_BY_ID, lotPoint, lotSpots, PLOTS, tileIndex } from '../shared/map.js';
import { gangLook } from './combat.js';
import { hoodBuildings, hpOf } from './hoods.js';
import { rnd, pick } from './rng.js';

const MIN = 60_000;
const FIRST_MS = 12 * MIN;
const EVERY_MIN_MS = 16 * MIN;
const EVERY_MAX_MS = 26 * MIN;
const RETRY_MS = 2 * MIN;
const RAID_MS = 4 * MIN;               // after this, whoever is left heads back to the car
const MIN_LEVEL = 4;
const MIN_WORTH = 30_000;
const LOOT_PICKUP = 1.8;
const LOOT_TIMEOUT_MS = 5 * MIN;       // unclaimed loot goes back to its till by itself
const TAG_MS = 4000;
const SMASH_S = 10;
const STOMP_TILES = 4;

export const RAID_MODES = {
  relaxed: { tier: -1, dmg: 0.6, every: 2 },
  normal: { tier: 0, dmg: 1, every: 1 },
  hardcore: { tier: 1, dmg: 1.3, every: 0.6 },
};

const mode = () => RAID_MODES[CONFIG.RAID_MODE] || RAID_MODES.normal;

/** How big a raid a hood this rich gets, 1..5. */
export function raidTier(netWorth, m = mode()) {
  const base = 1 + Math.floor(Math.log2(Math.max(1, netWorth) / 25_000));
  return Math.max(1, Math.min(5, base + m.tier));
}

export class Raids {
  constructor(room) {
    this.room = room;
    this.next = new Map();          // boss slug -> when (real ms) their next raid may come
    this.active = new Map();        // raid id -> raid
    this.loot = new Map();          // loot id -> { id, x, z, amount, owner, lot, hood, at }
    this.nextId = 1;
    this.lastTick = Date.now();
    this.lastCarSnap = 0;
    room.combat.brains.raider = {
      act: (u, dt, now) => this._act(u, dt, now),
      perceive: (u, best, d) => this._perceive(u, best, d),
      onDown: (u, by) => this._down(u, by),
    };
  }

  // ------------------------------------------------------------ scheduling

  eligible(p) {
    if (!p.ws || p.plot < 0 || !HQS[p.plot]) return false;
    if (levelOf(p.xp) < MIN_LEVEL) return false;
    return p.restaurants.length > 0 || this.room.netWorth(p) >= MIN_WORTH;
  }

  raidOn(hood) {
    for (const r of this.active.values()) if (r.hood === hood && r.phase !== 'over') return r;
    return null;
  }

  tick(now = Date.now()) {
    const dt = Math.min(0.2, (now - this.lastTick) / 1000);
    this.lastTick = now;
    for (const p of this.room.players.values()) {
      if (!this.eligible(p)) continue;
      if (!this.next.has(p.slug)) { this.next.set(p.slug, now + FIRST_MS * mode().every); continue; }
      if (now < this.next.get(p.slug)) continue;
      const busy = this.raidOn(p.plot)
        || (this.room.wars && this.room.wars.warOf && this.room.wars.warOf(p.slug))
        || [...this.room.wildlife.boars.values()].some((b) => b.plot === p.plot && b.state !== 'dead');
      if (busy) { this.next.set(p.slug, now + RETRY_MS); continue; }
      this.start(p, now);
      this.next.set(p.slug, now + (EVERY_MIN_MS + rnd() * (EVERY_MAX_MS - EVERY_MIN_MS)) * mode().every);
    }
    for (const raid of [...this.active.values()]) this._tickRaid(raid, dt, now);
    this._tickLoot(now);
    if (this.active.size && now - this.lastCarSnap >= 150) {
      this.lastCarSnap = now;
      this.room.broadcast('raidcars', [...this.active.values()].filter((r) => r.car).map((r) => [r.id, r2(r.car.x), r2(r.car.z), r2(r.car.yaw)]), true);
    }
  }

  // ------------------------------------------------------------- the raid

  /** Sends a raid at `p`'s hood now. Returns the raid. */
  start(p, now = Date.now(), { gang = null, tier = null } = {}) {
    const m = mode();
    const key = gang || pick(Object.keys(RIVALS));
    const rival = RIVALS[key];
    const t = tier || raidTier(this.room.netWorth(p), m);
    const warnMs = raidWarning(hoodLevel(p.hood, 'cctv')) * 1000;
    const from = rnd() < 0.5 ? 'north' : 'south';
    const route = raidRoute(p.plot, from);
    const length = route.reduce((a, pt, i) => (i ? a + Math.hypot(pt[0] - route[i - 1][0], pt[1] - route[i - 1][1]) : 0), 0);
    const raid = {
      id: `r${this.nextId++}`, hood: p.plot, owner: p.slug, gang: key, tier: t, dmg: m.dmg,
      phase: 'ride', startedAt: now, arriveAt: now + warnMs, until: now + warnMs + RAID_MS,
      car: {
        model: rival.car, color: rival.color, x: route[0][0], z: route[0][1], yaw: 0,
        route, leg: 1, speed: Math.max(10, Math.min(34, length / Math.max(1, warnMs / 1000))),
      },
      crew: [], escaped: 0, workers: [],
    };
    this.active.set(raid.id, raid);
    const n = Math.min(7, 2 + t);
    for (let i = 0; i < n; i++) {
      const gun = t >= 5 && i === 0 ? 'semiauto' : t >= 3 && i % 2 === 0 ? 'smg' : 'pistol';
      const u = this.room.combat.spawn({
        kind: 'raider', brain: 'raider', raid: raid.id, hood: p.plot, gang: key, name: rival.name, color: rival.color,
        look: raiderLook(rival, i), gun, x: raid.car.x, z: raid.car.z,
        hp: 60 + t * 15, maxHp: 60 + t * 15, acc: 0.26 + t * 0.04, dmgMul: m.dmg, state: 'ride', idle: 'ride',
        job: null, bag: null,
      });
      raid.crew.push(u.id);
    }
    this.room.broadcast('raid', this.publicRaid(raid));
    this.room.send(p.id, 'bigtext', { title: `${rival.name.toUpperCase()}!`, sub: `A carload is heading for ${HOODS[p.plot].name}. Get to your hood.`, color: '#ff6a3a' });
    this.room.toastAll(`🚨 ${rival.name} are on their way to ${p.name}'s hood!`, 'event');
    return raid;
  }

  publicRaid(r) {
    const rival = RIVALS[r.gang];
    return {
      id: r.id, hood: r.hood, owner: r.owner, gang: r.gang, name: rival.name, color: rival.color, tier: r.tier,
      phase: r.phase, arriveAt: r.arriveAt, car: r.car ? { model: r.car.model, color: r.car.color, x: r.car.x, z: r.car.z, yaw: r.car.yaw } : null,
      result: r.result || null,
    };
  }

  _crew(raid) { return raid.crew.map((id) => this.room.combat.units.get(id)).filter(Boolean); }

  _tickRaid(raid, dt, now) {
    const boss = this.room.profiles.get(raid.owner);
    // The boss left: the raid is called off and everything goes back.
    if (!boss || !boss.ws) { this.abort(raid, 'called off'); return; }
    const crew = this._crew(raid);
    const standing = crew.filter((u) => u.state !== 'down');

    if (raid.phase === 'ride') {
      if (this._drive(raid.car, dt, false)) {
        raid.phase = 'on';
        raid.arrivedAt = now;
        this._assignJobs(raid, boss);
        for (const u of standing) {
          u.state = 'advance';
          u.idle = 'advance';
          u.x = raid.car.x + (rnd() - 0.5) * 3;
          u.z = raid.car.z + (rnd() - 0.5) * 3;
        }
        this._rallyWorkers(raid, boss);
        this._scatterCustomers(boss);
        this.room.broadcast('raid', this.publicRaid(raid));
      } else {
        for (const u of standing) { u.x = raid.car.x; u.z = raid.car.z; }
      }
      return;
    }

    if (raid.phase === 'on') {
      if (!standing.length) { this._end(raid, 'repelled'); return; }
      // Time is up: everyone back to the car.
      if (now > raid.until) for (const u of standing) if (u.job !== 'car' && u.state !== 'incar') { u.job = 'car'; u.path = null; u.working = false; }
      if (standing.every((u) => u.state === 'incar')) {
        raid.phase = 'leaving';
        raid.car.route = [...raid.car.route].reverse();
        raid.car.leg = 1;
        this.room.broadcast('raid', this.publicRaid(raid));
      }
      return;
    }

    if (raid.phase === 'leaving') {
      for (const u of standing) { u.x = raid.car.x; u.z = raid.car.z; }
      if (this._drive(raid.car, dt, true)) {
        // Gone: whatever is in the car is gone with it.
        let lost = 0;
        for (const u of standing) if (u.bag) { lost += u.bag.amount; u.bag = null; }
        raid.escaped = lost;
        this._end(raid, lost > 0 ? 'robbed' : 'fled');
      }
    }
  }

  /** Moves the car along its route; true once it has reached the end. */
  _drive(car, dt, leaving) {
    const target = car.route[car.leg];
    if (!target) return true;
    const dx = target[0] - car.x;
    const dz = target[1] - car.z;
    const d = Math.hypot(dx, dz);
    const step = (leaving ? 22 : car.speed) * dt;
    car.yaw = Math.atan2(-dx, -dz);
    if (d <= step) {
      car.x = target[0];
      car.z = target[1];
      car.leg++;
      return car.leg >= car.route.length;
    }
    car.x += (dx / d) * step;
    car.z += (dz / d) * step;
    return false;
  }

  /**
   * Who does what: the fullest tills first, then a wall to tag, then
   * something to smash, then the crops.
   */
  _assignJobs(raid, boss) {
    const crew = this._crew(raid).filter((u) => u.state !== 'down');
    const tills = boss.restaurants.filter((r) => (r.till || 0) >= 50 && hpOf(boss, `r${r.lot}`) > 0).sort((a, b) => (b.till || 0) - (a.till || 0));
    const tags = TAG_POINTS.filter((t) => t.hood === raid.hood);
    const smash = hoodBuildings(boss).filter((b) => hpOf(boss, b.key) > 0);
    const jobs = [];
    for (const r of tills.slice(0, 2)) jobs.push({ kind: 'crack', lot: r.lot });
    // The wall nearest the car: right where everyone driving in will see it.
    const wall = tags.filter((t) => !this.room.tags.has(t.id) || this.room.tags.get(t.id).gang !== raid.gang)
      .sort((a, b) => Math.hypot(a.x - raid.car.x, a.z - raid.car.z) - Math.hypot(b.x - raid.car.x, b.z - raid.car.z))[0];
    if (wall) jobs.push({ kind: 'tag', tag: wall.id });
    for (const b of smash.sort(() => rnd() - 0.5).slice(0, 2)) jobs.push({ kind: 'smash', key: b.key });
    jobs.push({ kind: 'stomp' });
    crew.forEach((u, i) => { u.job = jobs[i % jobs.length]; u.jobT = 0; u.path = null; u.exit = null; });
  }

  /**
   * How to get to a job: a list of [x, z] points. Inside a restaurant that
   * means the pavement, the door, and in (walls are in the way otherwise).
   */
  _jobPath(raid, boss, job) {
    const inside = (lotId, last) => {
      const lot = LOT_BY_ID.get(lotId);
      const sp = lotSpots(lot);
      return [sp.street, sp.door, sp.inside, last(sp)].map(([a, b]) => lotPoint(lot, a, b));
    };
    if (job.kind === 'crack') return inside(job.lot, (sp) => sp.counter);
    if (job.kind === 'smash' && job.key.startsWith('r')) return inside(Number(job.key.slice(1)), (sp) => [1.5, sp.inside[1] + 2]);
    return [this._jobSpot(raid, boss, job)];
  }

  /** Where a job is done. */
  _jobSpot(raid, boss, job) {
    if (job.kind === 'crack') {
      const lot = LOT_BY_ID.get(job.lot);
      const sp = lotSpots(lot);
      const [x, z] = lotPoint(lot, sp.counter[0], sp.counter[1]);
      return [x, z];
    }
    if (job.kind === 'tag') {
      const t = TAG_POINTS.find((q) => q.id === job.tag);
      return [t.pos[0], t.pos[2]];
    }
    if (job.kind === 'smash') {
      if (job.key.startsWith('r')) {
        const lot = LOT_BY_ID.get(Number(job.key.slice(1)));
        const [x, z] = lotPoint(lot, 1.5, 3);
        return [x, z];
      }
      const h = HOODS[raid.hood];
      if (job.key === 'hq') { const q = HQS[raid.hood]; return [q.door[0] + 2, q.door[2] + 1]; }
      const house = HOOD_T.houses[Number(job.key.slice(1))];
      return [hx(h, house.door[0]), hz(h, house.door[1]) + 1];
    }
    if (job.kind === 'stomp') {
      const plot = PLOTS[raid.hood];
      return [plot.x0 + 35, plot.z0 + 40];
    }
    return [raid.car.x, raid.car.z];
  }

  // ------------------------------------------------------------- raider AI

  /** Raiders fight what they see, unless they are carrying a bag and are not cornered. */
  _perceive(u, best, d) {
    if (!best) return false;
    if (u.bag) return d < 10;
    if (u.state === 'crack' && d > 14) return false;
    return true;
  }

  _act(u, dt, now) {
    const raid = this.active.get(u.raid);
    if (!raid) return;
    if (u.state === 'ride' || u.state === 'incar') return;
    const boss = this.room.profiles.get(raid.owner);
    if (!boss) return;
    const C = this.room.combat;
    if (!u.job) u.job = 'car';
    if (!u.path) {
      // Out the way you came in, then to the job (or the car).
      const to = u.job === 'car' ? [[raid.car.x, raid.car.z]] : this._jobPath(raid, boss, u.job);
      u.path = [...(u.exit || []), ...to];
      u.exit = u.job !== 'car' && to.length > 1 ? to.slice(0, -1).reverse() : null;
      u.step = 0;
    }
    if (u.step < u.path.length) {
      const [tx, tz] = u.path[u.step];
      const last = u.step === u.path.length - 1;
      if (C.moveTo(u, tx, tz, 4.3, dt) < (last ? 1.1 : 0.7)) u.step++;
      u.state = u.job === 'car' ? 'move' : 'advance';
      u.running = true;
      return;
    }
    if (u.job === 'car') { u.state = 'incar'; u.idle = 'incar'; return; }
    u.working = true;
    u.running = false;
    u.jobT += dt;
    const job = u.job;
    if (job.kind === 'crack') {
      u.state = 'crack';
      if (u.jobT >= crackSeconds(hoodLevel(boss.hood, 'safes'))) {
        const take = this.room.restaurants.crackTill(job.lot, lootShare(hoodLevel(boss.hood, 'safes')), 0);
        if (take > 0) {
          u.bag = { amount: take, owner: boss.slug, lot: job.lot };
          if (boss.ws) this.room.error(boss, `${RIVALS[raid.gang].name} cracked a till: ${money(take)} in a bag. Stop them before they get to the car!`);
        }
        this._nextJob(u, raid, boss);
      }
    } else if (job.kind === 'tag') {
      u.state = 'tag';
      if (u.jobT * 1000 >= TAG_MS) {
        this.room.setTag(job.tag, { gang: raid.gang, name: RIVALS[raid.gang].name, color: RIVALS[raid.gang].color });
        this._nextJob(u, raid, boss);
      }
    } else if (job.kind === 'smash') {
      u.state = 'vandal';
      this.room.hoods.damage(boss, job.key, 5 * raid.dmg * dt * (1 + raid.tier * 0.2));
      if (u.jobT >= SMASH_S || hpOf(boss, job.key) <= 0) this._nextJob(u, raid, boss);
    } else if (job.kind === 'stomp') {
      u.state = 'vandal';
      if (u.jobT >= 1.6) {
        u.jobT = 0;
        u.stomped = (u.stomped || 0) + 1;
        this._stompTile(boss);
        if (u.stomped >= STOMP_TILES) this._nextJob(u, raid, boss);
      }
    }
  }

  /** Done with that: with a bag, back to the car; otherwise something else to smash. */
  _nextJob(u, raid, boss) {
    u.working = false;
    u.jobT = 0;
    u.path = null;
    if (u.bag) { u.job = 'car'; return; }
    const smash = hoodBuildings(boss).filter((b) => hpOf(boss, b.key) > 0);
    u.job = smash.length && rnd() < 0.7 ? { kind: 'smash', key: pick(smash).key } : 'car';
  }

  _stompTile(boss) {
    const tiles = [];
    for (let j = 0; j < boss.field.size; j++) {
      for (let i = 0; i < boss.field.size; i++) {
        const t = boss.field.tiles[tileIndex(i, j)];
        if (t && typeof t === 'object') tiles.push(tileIndex(i, j));
      }
    }
    if (!tiles.length) return;
    const idx = pick(tiles);
    boss.field.tiles[idx] = 0;
    this.room.broadcast('tiles', { plot: boss.plot, t: [[idx, 0]], eaten: true });
  }

  /** A raider went down: any bag they carried lands where they fell. */
  _down(u, by) {
    const raid = this.active.get(u.raid);
    if (u.bag) {
      const id = `l${this.nextId++}`;
      this.loot.set(id, { id, x: u.x, z: u.z, amount: u.bag.amount, owner: u.bag.owner, lot: u.bag.lot, hood: u.hood, at: Date.now() });
      u.bag = null;
      this._broadcastLoot();
    }
    if (raid && by && by.slug !== undefined) {
      const bounty = 150 * raid.tier;
      by.money += bounty;
      this.room._gainXp(by, 40 * raid.tier);
      this.room.send(by.id, 'toast', { text: `Dropped one of ${RIVALS[raid.gang].name} (+${money(bounty)})`, kind: 'good' });
      this.room.walletSoon(by);
    }
  }

  // ------------------------------------------------------------- the loot

  _tickLoot(now) {
    let changed = false;
    for (const [id, l] of this.loot) {
      const boss = this.room.profiles.get(l.owner);
      let back = now - l.at > LOOT_TIMEOUT_MS || !boss;
      if (!back && boss.ws && Math.hypot(boss.pos[0] - l.x, boss.pos[2] - l.z) < LOOT_PICKUP) {
        back = true;
        this.room.send(boss.id, 'toast', { text: `Got it back: ${money(l.amount)} is in the till again.`, kind: 'good' });
      }
      if (!back) continue;
      this._return(l.owner, l.lot, l.amount);
      this.loot.delete(id);
      changed = true;
    }
    if (changed) this._broadcastLoot();
  }

  _return(ownerSlug, lot, amount) {
    if (amount <= 0) return;
    if (this.room.restaurants.refill(lot, amount)) return;
    // The restaurant is gone: into the boss's pocket instead.
    const boss = this.room.profiles.get(ownerSlug);
    if (boss) { boss.money += amount; this.room.walletSoon(boss); }
  }

  publicLoot() { return [...this.loot.values()].map((l) => ({ id: l.id, x: r2(l.x), z: r2(l.z), amount: l.amount, owner: l.owner })); }

  _broadcastLoot() { this.room.broadcast('loot', this.publicLoot()); }

  /** Every bag and every dropped bag back in its till (the server is stopping). */
  returnAll() {
    for (const raid of this.active.values()) for (const u of this._crew(raid)) if (u.bag) { this._return(u.bag.owner, u.bag.lot, u.bag.amount); u.bag = null; }
    for (const l of this.loot.values()) this._return(l.owner, l.lot, l.amount);
    this.loot.clear();
  }

  /** How much money is in raiders' bags or lying in the street right now. */
  outstanding() {
    let n = 0;
    for (const raid of this.active.values()) for (const u of this._crew(raid)) if (u.bag) n += u.bag.amount;
    for (const l of this.loot.values()) n += l.amount;
    return n;
  }

  // ------------------------------------------------------ workers & customers

  /** Everyone on the payroll either fights (with an armoury) or shelters. */
  _rallyWorkers(raid, boss) {
    const armory = hoodLevel(boss.hood, 'armory');
    const q = HQS[boss.plot];
    const S = this.room.staff;
    for (const w of boss.workers) {
      if (w.role === 'soldier' || (w.hurtUntil && this.room.clock.time < w.hurtUntil)) continue;
      const at = S.interrupt(boss, w) || [q.spawn[0], q.spawn[2]];
      if (armory >= 1) {
        const u = this.room.combat.spawn({
          id: `w:${w.id}`, kind: 'gang', owner: boss.slug, hood: boss.plot, name: w.name, color: boss.color, worker: w.id,
          look: gangLook(boss.color, hashOf(w.id)), gun: gangGun(armory), x: at[0], z: at[1],
          hp: 80, maxHp: 80, acc: 0.35 + 0.05 * armory, idle: 'idle', state: 'idle',
        });
        raid.workers.push(u.id);
        S.setAway(w.id, 'Fighting off a raid');
      } else {
        S.setAway(w.id, 'Sheltering in the clubhouse', [q.spawn[0], q.spawn[2]]);
      }
    }
    S.broadcastList();
  }

  _releaseWorkers(raid, boss) {
    for (const id of raid.workers) this.room.combat.remove(id);
    raid.workers = [];
    if (boss) for (const w of boss.workers) this.room.staff.setAway(w.id, null);
    this.room.staff.broadcastList();
  }

  _scatterCustomers(boss) {
    for (const r of boss.restaurants) this.room.restaurants.scatter(r.lot);
  }

  // ---------------------------------------------------------------- endings

  _end(raid, how) {
    const boss = this.room.profiles.get(raid.owner);
    const rival = RIVALS[raid.gang];
    raid.phase = 'over';
    raid.result = { how, escaped: raid.escaped };
    for (const u of this._crew(raid)) if (u.state !== 'down') this.room.combat.remove(u.id);
    this._releaseWorkers(raid, boss);
    if (boss) {
      if (how === 'repelled' || how === 'fled') {
        const bounty = 800 * raid.tier;
        boss.money += bounty;
        this.room._gainXp(boss, 150 * raid.tier);
        boss.stats.raidsRepelled = (boss.stats.raidsRepelled || 0) + 1;
        this.room.send(boss.id, 'bigtext', { title: 'RAID REPELLED!', sub: `${rival.name} ran for it. Bounty: ${money(bounty)}`, color: '#f2c14e' });
        this.room.toastAll(`${boss.name}'s gang saw off ${rival.name}.`, 'info');
      } else {
        this.room.send(boss.id, 'bigtext', { title: 'THEY GOT AWAY', sub: `${rival.name} drove off with ${money(raid.escaped)}.`, color: '#ff6a5a' });
        this.room.toastAll(`${rival.name} robbed ${boss.name}'s hood and got away with ${money(raid.escaped)}.`, 'warn');
      }
      this.room.sendWallet(boss);
    }
    this.room.broadcast('raid', this.publicRaid(raid));
    this.active.delete(raid.id);
  }

  /** Called off (the boss left): nobody wins, every bag goes back. */
  abort(raid, why = 'called off') {
    const boss = this.room.profiles.get(raid.owner);
    for (const u of this._crew(raid)) {
      if (u.bag) { this._return(u.bag.owner, u.bag.lot, u.bag.amount); u.bag = null; }
      this.room.combat.remove(u.id);
    }
    for (const [id, l] of this.loot) if (l.hood === raid.hood) { this._return(l.owner, l.lot, l.amount); this.loot.delete(id); }
    this._broadcastLoot();
    this._releaseWorkers(raid, boss);
    raid.phase = 'over';
    raid.result = { how: why, escaped: 0 };
    this.room.broadcast('raid', this.publicRaid(raid));
    this.active.delete(raid.id);
  }

  publicState() {
    return { raids: [...this.active.values()].map((r) => this.publicRaid(r)), loot: this.publicLoot() };
  }
}

/** What a raider wears: their gang's colours, varied a little per head. */
function raiderLook(rival, i) {
  const skins = ['#f1c7a3', '#c68a5e', '#9c6644', '#e0ac80', '#6f4a33', '#8d5a3b', '#d9a27a'];
  return {
    outfit: rival.outfit, color: rival.color, accent: rival.accent, top: rival.top, legs: rival.legs,
    head: rival.head, mask: rival.mask, skin: skins[i % skins.length], shades: rival.outfit === 'biker' && i % 2 === 0,
    beard: rival.outfit === 'biker' ? 'full' : i % 3 === 0 ? 'goatee' : null,
  };
}

const hashOf = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };
const r2 = (v) => Math.round(v * 100) / 100;
