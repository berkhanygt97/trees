// Fighting: every armed person who is not a player (your gang's soldiers, the
// rival gangs that come raiding) is a combat unit simulated here, and every
// trigger pull, a player's or a unit's, is judged here.
//
// Units think four times a second: look for someone hostile they can see,
// then keep a sensible distance, face them and shoot. Players' shots are
// rays, lag-compensated like the boars always were; units' shots are rolls
// (the closer, the stiller and the more in the open you are, the likelier
// they hit), and neither goes through a wall.
//
// Who can hurt whom:
//   - raiders fight every gang and the boss of the hood they are raiding,
//     and anyone who shoots at them;
//   - gangs fight raiders, and each other only while their bosses are at war;
//   - players can always shoot raiders, and each other (and each other's
//     gangs) only at war.
//
// Network: 'units' (a compact snapshot, 10 a second), 'unitlist' (who they
// are and what they look like, when that changes) and 'shot' (tracers).
import { GUN_BY_ID, gangGun, hoodLevel, soldierCap, HOUR_MS } from '../shared/catalog.js';
import { HQS, HOODS, HOOD_T, hz, hx } from '../shared/hoods.js';
import { raySphere, spreadDir, History } from './ballistics.js';
import { Colliders } from './colliders.js';
import { rnd } from './rng.js';

const THINK_S = 0.25;
const SNAP_MS = 100;
const SIGHT = 40;
const DOWN_MS = 9000;
const LAG_MAX_MS = 300;
const WALK = 1.7;
const RUN = 4.4;

export const UNIT_STATE = { idle: 0, patrol: 1, move: 1, advance: 1, engage: 2, down: 3, flee: 4, work: 5, ride: 6, incar: 6, crack: 7, tag: 8, vandal: 9 };

/** A gang member's look: street clothes with a bandana in the gang's colour. */
export function gangLook(color, seed = 0) {
  const tops = ['tee', 'tank', 'hoodie', 'tee', 'jersey'];
  const legs = ['jeans', 'khaki', 'jeans'];
  const skins = ['#f1c7a3', '#e0ac80', '#c68a5e', '#9c6644', '#6f4a33', '#8d5a3b'];
  const k = Math.abs(seed | 0);
  return {
    outfit: 'street', color, accent: color, top: tops[k % tops.length], legs: legs[(k >> 3) % legs.length],
    skin: skins[(k >> 5) % skins.length], head: (k >> 7) % 3 === 0 ? 'capback' : 'bandana', beard: (k >> 9) % 4 === 0 ? 'goatee' : null,
  };
}

const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return h; };

export class Combat {
  constructor(room) {
    this.room = room;
    this.units = new Map();
    this.nextId = 1;
    this.colliders = new Colliders(room);
    this.playerHist = new Map();     // player id -> History
    this.lastTick = Date.now();
    this.lastSnap = 0;
    this.hadUnits = false;
    this.listDirty = false;
    this.brains = {};                // name -> { act(u, dt, now), perceive?(u), onDown?(u, by) }
  }

  // ---------------------------------------------------------------- units

  /** A new unit. `def` fills in anything: kind, owner, hood, name, look, gun, x, z... */
  spawn(def) {
    const id = def.id || `u${this.nextId++}`;
    const gun = GUN_BY_ID[def.gun] || GUN_BY_ID.pistol;
    const u = {
      id, kind: 'gang', owner: null, hood: -1, name: '', look: {}, color: '#fff',
      x: 0, z: 0, yaw: 0, hp: 100, maxHp: 100, armor: 0, acc: 0.45, dmgMul: 1, rateMul: 1.8,
      state: 'idle', idle: 'idle', target: null, canSee: false, think: rnd() * THINK_S, strafe: rnd() < 0.5 ? 1 : -1,
      mag: gun.mag, reloadUntil: 0, lastShot: 0, aggro: new Set(), route: null, leg: 0, brain: null,
      ...def,
      gun: gun.id,
    };
    u.hist = new History(10);
    this.units.set(id, u);
    this.listDirty = true;
    return u;
  }

  remove(id) {
    if (this.units.delete(id)) this.listDirty = true;
  }

  unitsOf(pred) { return [...this.units.values()].filter(pred); }

  // --------------------------------------------------------------- hostility

  /** Would unit `u` attack `o` (a unit or a player) on sight? */
  hostile(u, o) {
    const wars = this.room.wars;
    if (o.slug !== undefined && o.ws !== undefined) {
      // A player.
      if (o.koUntil && Date.now() < o.koUntil) return false;
      if (u.aggro.has(o.id)) return true;
      if (u.kind === 'raider') {
        const boss = this.room._ownerOf(u.hood);
        return !!boss && boss.slug === o.slug;
      }
      return !!wars && u.owner && wars.atWar(u.owner, o.slug);
    }
    if (o.state === 'down') return false;
    if (u.kind === 'raider') return o.kind === 'gang';
    if (o.kind === 'raider') return true;
    return !!wars && u.owner && o.owner && u.owner !== o.owner && wars.atWar(u.owner, o.owner);
  }

  /** Can player `p` hurt this unit or player? */
  canHurt(p, o) {
    const wars = this.room.wars;
    if (o.slug !== undefined && o.ws !== undefined) return !!wars && wars.atWar(p.slug, o.slug);
    if (o.kind === 'raider') return true;
    return !!wars && !!o.owner && wars.atWar(p.slug, o.owner);
  }

  // ------------------------------------------------------------------ tick

  tick(now = Date.now()) {
    const dt = Math.min(0.2, (now - this.lastTick) / 1000);
    this.lastTick = now;
    for (const p of this.room.players.values()) {
      let h = this.playerHist.get(p.id);
      if (!h) { h = new History(12); this.playerHist.set(p.id, h); }
      h.push(now, p.pos[0], p.pos[2], p.yaw);
    }
    for (const id of this.playerHist.keys()) if (!this.room.players.has(id)) this.playerHist.delete(id);

    this._soldiers();

    for (const u of [...this.units.values()]) {
      if (u.state === 'down') {
        if (now - u.downAt > DOWN_MS) this.remove(u.id);
        continue;
      }
      u.think -= dt;
      if (u.think <= 0) {
        u.think = THINK_S;
        this._perceive(u);
      }
      this._act(u, dt, now);
      u.hist.push(now, u.x, u.z, u.yaw);
    }

    if (now - this.lastSnap >= SNAP_MS) {
      this.lastSnap = now;
      if (this.listDirty) {
        this.listDirty = false;
        this.room.broadcast('unitlist', this.unitList());
      }
      if (this.units.size || this.hadUnits) {
        this.room.broadcast('units', this.snapshot(), true);
        this.hadUnits = this.units.size > 0;
      }
    }
  }

  unitList() {
    return [...this.units.values()].map((u) => ({
      id: u.id, kind: u.kind, name: u.name, look: u.look, gun: u.gun, hood: u.hood, owner: u.owner, color: u.color, gang: u.gang || null,
    }));
  }

  snapshot() {
    return [...this.units.values()].map((u) => [
      u.id, r2(u.x), r2(u.z), r2(u.yaw), UNIT_STATE[u.state] ?? 0, Math.round((Math.max(0, u.hp) / u.maxHp) * 100),
      (u.state === 'engage' ? 1 : 0) | (u.running ? 2 : 0) | (u.bag ? 4 : 0),
    ]);
  }

  // ------------------------------------------------------------ perception

  _perceive(u) {
    const brain = u.brain && this.brains[u.brain];
    let best = null;
    let bestD = SIGHT;
    const eye = [u.x, 1.5, u.z];
    const consider = (o, x, z, y) => {
      const d = Math.hypot(x - u.x, z - u.z);
      if (d >= bestD) return;
      if (!this.hostile(u, o)) return;
      if (!this.colliders.los(eye, [x, y, z])) return;
      best = o;
      bestD = d;
    };
    for (const p of this.room.players.values()) consider(p, p.pos[0], p.pos[2], (p.pos[1] || 0) + 1.3);
    for (const o of this.units.values()) if (o !== u) consider(o, o.x, o.z, 1.3);
    // Some jobs (cracking a safe) matter more than a fight far away.
    if (brain && brain.perceive && !brain.perceive(u, best, bestD)) best = null;
    u.target = best;
    u.canSee = !!best;
    if (best) u.state = 'engage';
    else if (u.state === 'engage') u.state = u.idle;
  }

  // ---------------------------------------------------------------- acting

  _act(u, dt, now) {
    const brain = u.brain && this.brains[u.brain];
    if (u.state === 'engage' && u.target) {
      this._fight(u, dt, now);
      return;
    }
    u.running = false;
    if (brain && brain.act) { brain.act(u, dt, now); return; }
    if (u.route && u.route.length) this._patrol(u, dt);
  }

  _targetPos(t) {
    if (t.slug !== undefined && t.ws !== undefined) return [t.pos[0], (t.pos[1] || 0) + 1.2, t.pos[2]];
    return [t.x, 1.2, t.z];
  }

  _fight(u, dt, now) {
    const t = u.target;
    const alive = t.slug !== undefined && t.ws !== undefined ? this.room.players.has(t.id) && !(t.koUntil && now < t.koUntil) : this.units.has(t.id) && t.state !== 'down';
    if (!alive) { u.target = null; u.state = u.idle; return; }
    const [tx, , tz] = this._targetPos(t);
    const dx = tx - u.x;
    const dz = tz - u.z;
    const d = Math.hypot(dx, dz);
    const gun = GUN_BY_ID[u.gun];
    const want = Math.max(7, Math.min(22, gun.range * 0.3));
    // Close in, back off, and sidestep now and then: nobody stands still in a gunfight.
    if (rnd() < dt * 0.5) u.strafe = -u.strafe;
    let mx = 0;
    let mz = 0;
    if (d > want + 3) { mx = dx / d; mz = dz / d; } else if (d < want - 4) { mx = -dx / d; mz = -dz / d; }
    mx += (-dz / d) * u.strafe * 0.6;
    mz += (dx / d) * u.strafe * 0.6;
    const len = Math.hypot(mx, mz) || 1;
    const speed = d > want + 3 ? RUN : WALK;
    u.running = speed === RUN;
    this._step(u, u.x + (mx / len), u.z + (mz / len), speed, dt);
    u.yaw = Math.atan2(-dx, -dz);
    if (u.canSee) this._fire(u, t, d, now);
  }

  _patrol(u, dt) {
    const p = u.route[u.leg % u.route.length];
    u.state = 'patrol';
    if (this._step(u, p[0], p[1], WALK, dt) < 0.4) {
      u.leg++;
      u.pause = 1 + rnd() * 4;
    }
  }

  /** Walks towards (x, z); returns how far is left. Faces where it goes. */
  _step(u, x, z, speed, dt) {
    if (u.pause > 0) { u.pause -= dt; return Infinity; }
    const dx = x - u.x;
    const dz = z - u.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return 0;
    const s = Math.min(d, speed * dt);
    const [nx, nz] = this.colliders.pushOut(u.x + (dx / d) * s, u.z + (dz / d) * s, 0.35);
    u.x = nx;
    u.z = nz;
    u.yaw = Math.atan2(-dx, -dz);
    return d - s;
  }

  moveTo(u, x, z, speed, dt) { return this._step(u, x, z, speed, dt); }

  // --------------------------------------------------------------- shooting

  _fire(u, t, d, now) {
    const gun = GUN_BY_ID[u.gun];
    if (now < u.reloadUntil) return;
    if (now - u.lastShot < gun.rate * 1000 * u.rateMul) return;
    if (u.mag <= 0) {
      u.mag = gun.mag;
      u.reloadUntil = now + gun.reload * 1200;
      return;
    }
    u.lastShot = now;
    u.mag--;
    const isPlayer = t.slug !== undefined && t.ws !== undefined;
    let chance = u.acc * Math.max(0.12, Math.min(1, 1 - d / (gun.range * 1.1)));
    if (isPlayer) {
      const h = this.playerHist.get(t.id);
      const past = h && h.at(now - 400);
      if (past && Math.hypot(past[0] - t.pos[0], past[1] - t.pos[2]) > 1.6) chance *= 0.7;   // running
      if (t.vehicle) chance *= 0.55;
    } else if (t.running) chance *= 0.75;
    const o = [u.x, 1.45, u.z];
    const tp = this._targetPos(t);
    const hit = rnd() < chance;
    const dmg = gun.damage * u.dmgMul * (0.8 + rnd() * 0.4);
    let e = tp;
    if (hit) {
      if (isPlayer) this.room.hurtPlayer(t, dmg, [t.pos[0] - u.x, t.pos[2] - u.z], 'shot', u);
      else this.damageUnit(t, dmg, u);
    } else {
      // A miss goes past, a metre or so off.
      e = [tp[0] + (rnd() - 0.5) * 2.4, tp[1] + (rnd() - 0.3) * 1.2, tp[2] + (rnd() - 0.5) * 2.4];
    }
    this.room.broadcast('shot', { uid: u.id, gun: u.gun, o: o.map(r2), e: e.map(r2) }, true);
  }

  /**
   * A player's trigger pull: boars, units and (at war) other players, the
   * nearest hit per pellet, stopped by walls. Returns { end, hits }.
   */
  shoot(p, gun, origin, dir, lagMs = 0) {
    const now = Date.now();
    const then = now - Math.max(0, Math.min(LAG_MAX_MS, lagMs || 0));
    const targets = this.room.wildlife.targets(then);
    for (const u of this.units.values()) {
      if (u.state === 'down' || !this.canHurt(p, u)) continue;
      for (const pose of posesOf(u.hist, u.x, u.z, u.yaw, then)) targets.push({ kind: 'unit', id: u.id, ref: u, spheres: bodySpheres(pose[0], pose[1], u.crouch ? -0.5 : 0) });
    }
    for (const q of this.room.players.values()) {
      if (q === p || q.vehicle || (q.koUntil && now < q.koUntil) || !this.canHurt(p, q)) continue;
      const h = this.playerHist.get(q.id);
      for (const pose of posesOf(h && h.list, q.pos[0], q.pos[2], q.yaw, then)) targets.push({ kind: 'player', id: q.id, ref: q, spheres: bodySpheres(pose[0], pose[1], q.pos[1] || 0) });
    }

    const hits = new Map();       // ref -> { t, dmg, head, kind }
    let end = null;
    for (let k = 0; k < gun.pellets; k++) {
      const d = spreadDir(dir, gun.spread);
      const wall = this.colliders.segment(origin, d, gun.range);
      const reach = wall != null ? wall : gun.range;
      let best = null;
      for (const tg of targets) {
        let tHead = null;
        let tBody = null;
        let mulHead = 2;
        let mulBody = 1;
        for (const [c, r, m, isHead] of tg.spheres) {
          const t = raySphere(origin, d, c, r);
          if (t == null || t > reach) continue;
          if (isHead) { if (tHead == null || t < tHead) { tHead = t; mulHead = m; } } else if (tBody == null || t < tBody) { tBody = t; mulBody = m; }
        }
        // A head just behind the body still counts: that is what you aimed at.
        let hit = null;
        if (tHead != null && (tBody == null || tHead <= tBody + 0.2)) hit = { t: tHead, mul: mulHead, head: true };
        else if (tBody != null) hit = { t: tBody, mul: mulBody, head: false };
        if (hit && (!best || hit.t < best.t)) best = { tg, ...hit };
      }
      if (best) {
        const falloff = best.t > gun.range * 0.6 ? 1 - 0.5 * (best.t - gun.range * 0.6) / (gun.range * 0.4) : 1;
        const h = hits.get(best.tg.ref) || { dmg: 0, head: false, tg: best.tg };
        h.dmg += gun.damage * best.mul * falloff;
        h.head = h.head || best.head;
        hits.set(best.tg.ref, h);
        if (!end) end = [origin[0] + d[0] * best.t, origin[1] + d[1] * best.t, origin[2] + d[2] * best.t];
      } else if (!end && k === 0) {
        const r = Math.min(reach, 90);
        end = [origin[0] + d[0] * r, origin[1] + d[1] * r, origin[2] + d[2] * r];
      }
    }
    const results = [];
    for (const [ref, h] of hits) {
      if (h.tg.kind === 'boar') results.push({ id: ref.id, kind: 'boar', head: h.head, kill: this.room.wildlife.damage(ref, h.dmg, p, true) });
      else if (h.tg.kind === 'unit') results.push({ id: ref.id, kind: 'unit', head: h.head, kill: this.damageUnit(ref, h.dmg, p) });
      else {
        const before = ref.hp;
        this.room.hurtPlayer(ref, h.dmg, [ref.pos[0] - p.pos[0], ref.pos[2] - p.pos[2]], 'shot', p);
        results.push({ id: ref.id, kind: 'player', head: h.head, kill: before > 0 && ref.hp <= 0 });
      }
    }
    return { end: end || [origin[0] + dir[0] * 60, origin[1] + dir[1] * 60, origin[2] + dir[2] * 60], hits: results };
  }

  /** Damage to a unit; true if it went down. `by` is a player, a unit or null. */
  damageUnit(u, amount, by) {
    if (u.state === 'down') return false;
    if (u.armor > 0) {
      const soaked = Math.min(u.armor, amount * 0.6);
      u.armor -= soaked;
      amount -= soaked;
    }
    u.hp -= amount;
    // Whoever shot at them is now somebody to shoot back at.
    if (by && by.slug !== undefined) u.aggro.add(by.id);
    if (u.hp > 0) {
      if (by && u.state !== 'engage' && this.hostile(u, by)) { u.target = by; u.state = 'engage'; u.canSee = true; }
      return false;
    }
    u.hp = 0;
    u.state = 'down';
    u.downAt = Date.now();
    u.target = null;
    const brain = u.brain && this.brains[u.brain];
    if (brain && brain.onDown) brain.onDown(u, by);
    if (u.kind === 'gang') this._memberDown(u, by);
    if (this.room.wars) this.room.wars.onUnitDown(u, by);
    if (by && by.slug !== undefined) {
      by.stats.kills = (by.stats.kills || 0) + 1;
      if (this.room.onUnitKilled) this.room.onUnitKilled(by, u);
    }
    return true;
  }

  // --------------------------------------------------------------- soldiers

  /** Every online boss's soldiers patrol the hood; offline bosses' stay home. */
  _soldiers() {
    const want = new Set();
    const now = this.room.clock.time;
    for (const p of this.room.players.values()) {
      if (p.plot < 0 || !HQS[p.plot]) continue;
      const cap = soldierCap(hoodLevel(p.hood, 'hq'));
      const soldiers = p.workers.filter((w) => w.role === 'soldier').slice(0, cap);
      soldiers.forEach((w, i) => {
        if (w.hurtUntil && now < w.hurtUntil) return;
        const id = `s:${w.id}`;
        want.add(id);
        const u = this.units.get(id);
        const gun = gangGun(hoodLevel(p.hood, 'armory'));
        if (u) {
          if (u.gun !== gun && u.state !== 'engage') { u.gun = gun; u.mag = GUN_BY_ID[gun].mag; this.listDirty = true; }
          if (u.name !== w.name) { u.name = w.name; this.listDirty = true; }
          return;
        }
        const q = HQS[p.plot];
        const armory = hoodLevel(p.hood, 'armory');
        this.spawn({
          id, kind: 'gang', owner: p.slug, hood: p.plot, name: w.name, color: p.color, worker: w.id,
          look: gangLook(p.color, hash(w.id)), gun, x: q.spawn[0] + (i - 1) * 1.5, z: q.spawn[2] + 1.5,
          armor: armory >= 2 ? 50 : 0, acc: 0.5 + 0.05 * armory, idle: 'patrol', state: 'patrol',
          route: patrolRoute(p.plot, i), leg: i,
        });
      });
    }
    for (const u of this.units.values()) {
      if (u.kind === 'gang' && u.id.startsWith('s:') && !want.has(u.id) && u.state !== 'down') this.remove(u.id);
    }
  }

  /** A gang member went down: to the hospital for a couple of in-game hours. */
  _memberDown(u, by) {
    const boss = this.room.profiles.get(u.owner);
    if (!boss) return;
    const w = boss.workers.find((x) => x.id === u.worker);
    if (w) w.hurtUntil = this.room.clock.time + 2 * HOUR_MS;
    if (boss.ws) this.room.send(boss.id, 'toast', { text: `${u.name} is down${by && by.name ? ` (${by.name})` : ''}. They will be back from the hospital in a couple of hours.`, kind: 'warn' });
  }
}

// ------------------------------------------------------------------ helpers

/** Head, chest and legs: [centre, radius, damage x, is head]. */
function bodySpheres(x, z, y = 0) {
  return [
    [[x, y + 1.66, z], 0.15, 2, true],
    [[x, y + 1.2, z], 0.3, 1, false],
    [[x, y + 0.55, z], 0.26, 0.7, false],
  ];
}

/** Where something is now, and where it was at `then` if that is different. */
function posesOf(list, x, z, yaw, then) {
  const out = [[x, z, yaw]];
  if (list && list.length) {
    const h = new History();
    h.list = list;
    const past = h.at(then);
    if (past && Math.hypot(past[0] - x, past[1] - z) > 0.05) out.push(past);
  }
  return out;
}

/** A loop round the hood for soldiers: the clubhouse yard, the street, the farm gate. */
export function patrolRoute(hood, k = 0) {
  const h = HOODS[hood];
  const side = k % 2 ? HOOD_T.walk.s[0] + 1.5 : HOOD_T.walk.n[1] - 1.5;
  const zWalk = hz(h, side);
  const q = HQS[hood];
  const pts = [
    [q.spawn[0], q.spawn[2] + 2],
    [hx(h, 200), zWalk],
    [hx(h, 150), zWalk],
    [hx(h, 95), zWalk],
    [hx(h, 45), zWalk],
    [hx(h, 95), zWalk],
    [hx(h, 150), zWalk],
    [hx(h, 230), hz(h, 150)],       // through the park
  ];
  return pts;
}

const r2 = (v) => Math.round(v * 100) / 100;
