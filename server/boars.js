// Wild boars. They come out of the woods behind a farm, trot into the field
// and eat the crops. Get close and they charge you. They are tougher on
// higher-level farms. Everything here is simulated on the server so every
// player sees the same boars and every shot is judged in one place.
import { MINUTE, boarStats, levelOf } from '../shared/catalog.js';
import { PLOTS, PLOT_SIZE, tileCenter, tileIndex } from '../shared/map.js';
import { rnd } from './rng.js';

const RAID_MIN = 7 * MINUTE;         // world time between raids on one farm
const RAID_MAX = 13 * MINUTE;
const FIRST_RAID = 6 * MINUTE;       // grace period after a farmer arrives
const RAID_LENGTH_MS = 150_000;      // real time before a raid gives up
const EAT_MS = 2500;
const CORPSE_MS = 20_000;
const SIGHT = 11;                    // metres: close enough to get charged
const HIT_RANGE = 1.25;
const RUSH_UNTIL = 9;                // a wounded boar closes to this range, then charges
const LAG_MAX_MS = 300;              // how far back a shot may be judged (see shoot)
const BREATHER_HIT_MS = 2500;        // after a boar hits you, the herd gives you this long
const BREATHER_MISS_MS = 1200;       // ...and this long after you dodge one
const BODY_R = 0.65;
const HEAD_R = 0.32;

// windup = pawing the ground before a charge (your warning); rush = a wounded
// boar running at whoever shot it. Clients draw rush as a charge.
const STATE_CODE = { approach: 0, eat: 1, charge: 2, flee: 3, dead: 4, windup: 5, rush: 2 };
const ANGRY = new Set(['windup', 'charge', 'rush']);

export class Wildlife {
  constructor(room) {
    this.room = room;
    this.boars = new Map();
    this.nextId = 1;
    this.nextRaid = new Map();       // plot index -> world time of the next raid
    this.lastTick = Date.now();
    this.lastSnap = 0;
    this.hadBoars = false;
  }

  // --------------------------------------------------------------- raids

  _schedule(plot, now, first = false) {
    const wait = first ? FIRST_RAID + rnd() * (RAID_MAX - FIRST_RAID) : RAID_MIN + rnd() * (RAID_MAX - RAID_MIN);
    this.nextRaid.set(plot, now + wait);
  }

  _planted(p) {
    const out = [];
    const size = p.field.size;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const t = p.field.tiles[tileIndex(i, j)];
        if (t && typeof t === 'object') out.push([i, j]);
      }
    }
    return out;
  }

  /** Called when a farmer arrives, so nobody is raided the second they log in. */
  greet(p) {
    if (p.plot >= 0 && !this.nextRaid.has(p.plot)) this._schedule(p.plot, this.room.clock.time, true);
  }

  startRaid(p) {
    const plot = PLOTS[p.plot];
    const level = levelOf(p.xp);
    const st = boarStats(level);
    const until = Date.now() + RAID_LENGTH_MS;
    for (let k = 0; k < st.count; k++) {
      const id = this.nextId++;
      const x = plot.x0 + 8 + rnd() * (PLOT_SIZE - 16);
      const z = plot.z0 - 10 - rnd() * 8;
      this.boars.set(id, {
        id, plot: p.plot, owner: p.slug, level, x, z, home: [x, z], yaw: Math.PI,
        hp: st.hp, maxHp: st.hp, st, state: 'approach', target: null, t: 0,
        eaten: 0, until, cooldown: 1 + rnd() * 2, lastRoadkill: 0, hist: [], run: 0,
        // Staggered, so the herd arrives in a ragged line rather than as one blob.
        delay: k * 0.8 + rnd(),
      });
    }
    this.room.toastAll(`🐗 Wild boars are raiding ${p.name}'s field!`, 'event');
  }

  // ---------------------------------------------------------------- tick

  tick() {
    const now = Date.now();
    const dt = Math.min(0.2, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const world = this.room.clock.time;

    // Raids only hit farms whose owner is online and has something growing.
    for (const p of this.room.players.values()) {
      if (p.plot < 0) continue;
      if (!this.nextRaid.has(p.plot)) { this._schedule(p.plot, world, true); continue; }
      if (world < this.nextRaid.get(p.plot)) continue;
      const busy = [...this.boars.values()].some((b) => b.plot === p.plot && b.state !== 'dead');
      if (!busy && this._planted(p).length >= 4) this.startRaid(p);
      this._schedule(p.plot, world);
    }

    for (const b of this.boars.values()) {
      this._think(b, dt, now);
      // A short trail of where it has been, so shots can be judged against
      // what the shooter actually saw (see shoot).
      b.hist.push([now, b.x, b.z, b.yaw]);
      if (b.hist.length > 10) b.hist.shift();
    }
    this._roadkill(now);

    for (const [id, b] of this.boars) {
      if (b.state === 'dead' && now - b.diedAt > CORPSE_MS) this.boars.delete(id);
      if (b.state === 'flee' && b.gone) this.boars.delete(id);
    }

    if (now - this.lastSnap >= 100) {
      this.lastSnap = now;
      if (this.boars.size || this.hadBoars) {
        this.room.broadcast('boars', this.snapshot(), true);
        this.hadBoars = this.boars.size > 0;
      }
    }
  }

  snapshot() {
    return [...this.boars.values()].map((b) => [
      b.id, r2(b.x), r2(b.z), r2(b.yaw), STATE_CODE[b.state], Math.round((b.hp / b.maxHp) * 100), b.level,
    ]);
  }

  _owner(b) { return this.room.profiles.get(b.owner); }

  /**
   * Somebody else is already winding up or charging at this player, or one
   * just did and the herd is giving them a moment to get their breath back.
   */
  _taken(p, b) {
    if (p.boarBreather && Date.now() < p.boarBreather) return true;
    for (const o of this.boars.values()) {
      if (o !== b && o.target === p.id && (o.state === 'windup' || o.state === 'charge')) return true;
    }
    return false;
  }

  _canHit(p, now) {
    return p && !p.vehicle && !(p.koUntil && now < p.koUntil);
  }

  _nearestVictim(b) {
    let best = null;
    let bestD = SIGHT;
    for (const p of this.room.players.values()) {
      if (!this._canHit(p, Date.now()) || this._taken(p, b)) continue;
      const d = Math.hypot(p.pos[0] - b.x, p.pos[2] - b.z);
      if (d < bestD) { best = p; bestD = d; }
    }
    return best;
  }

  _moveTo(b, x, z, speed, dt) {
    const dx = x - b.x;
    const dz = z - b.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return 0;
    const step = Math.min(d, speed * dt);
    b.x += (dx / d) * step;
    b.z += (dz / d) * step;
    // Boars face where they are going; forward is -z at yaw 0, like players.
    b.yaw = Math.atan2(-dx, -dz);
    return d - step;
  }

  _think(b, dt, now) {
    if (b.state === 'dead') return;
    if (b.delay > 0) { b.delay -= dt; return; }
    b.cooldown -= dt;
    const owner = this._owner(b);
    const plot = PLOTS[b.plot];

    if (b.state !== 'flee' && (now > b.until || !owner || !owner.ws || b.eaten >= 4 + Math.floor(b.level / 2))) {
      b.state = 'flee';
    }

    // Anyone wandering too close gets charged, unless the boar is on its way out.
    // One boar at a time per farmer, and always with a warning first.
    if (b.state !== 'flee' && !ANGRY.has(b.state) && b.cooldown <= 0) {
      const victim = this._nearestVictim(b);
      if (victim) this._windup(b, victim);
    }

    switch (b.state) {
      case 'approach': {
        if (!b.target || !Array.isArray(b.target)) b.target = this._pickTile(b, owner);
        if (!b.target) { b.state = 'flee'; break; }
        const [cx, cz] = tileCenter(plot, b.target[0], b.target[1], owner.layout);
        // They rush the field at a trot, then slow down to graze.
        if (this._moveTo(b, cx, cz, b.st.walk * 2.5, dt) < 0.2) { b.state = 'eat'; b.t = EAT_MS / 1000; }
        break;
      }
      case 'eat': {
        const tile = owner.field.tiles[tileIndex(b.target[0], b.target[1])];
        if (!tile || typeof tile !== 'object') { b.state = 'approach'; b.target = null; break; }
        b.t -= dt;
        if (b.t <= 0) {
          const idx = tileIndex(b.target[0], b.target[1]);
          owner.field.tiles[idx] = 0;
          b.eaten++;
          this.room.broadcast('tiles', { plot: b.plot, t: [[idx, 0]], eaten: true });
          b.state = 'approach';
          b.target = null;
        }
        break;
      }
      case 'rush': {
        // Wounded: run at whoever shot it, then wind up once close enough.
        const p = this.room.players.get(b.target);
        b.t -= dt;
        if (!this._canHit(p, now) || b.t <= 0) { this._calm(b, 2); break; }
        const left = Math.hypot(p.pos[0] - b.x, p.pos[2] - b.z);
        if (left > RUSH_UNTIL) this._moveTo(b, p.pos[0], p.pos[2], b.st.charge * 0.8, dt);
        else if (!this._taken(p, b)) this._windup(b, p);
        else b.yaw = Math.atan2(-(p.pos[0] - b.x), -(p.pos[2] - b.z));
        break;
      }
      case 'windup': {
        // Head down, pawing the ground, turning to face you. Then it goes.
        const p = this.room.players.get(b.target);
        if (!this._canHit(p, now)) { this._calm(b, 1.5); break; }
        const dx = p.pos[0] - b.x;
        const dz = p.pos[2] - b.z;
        b.yaw = Math.atan2(-dx, -dz);
        b.t -= dt;
        if (b.t <= 0) {
          // It commits to a line: a few metres past where you were standing.
          b.state = 'charge';
          b.run = Math.min(20, Math.hypot(dx, dz) + 5);
          b.t = 4;
        }
        break;
      }
      case 'charge': {
        const p = this.room.players.get(b.target);
        b.t -= dt;
        if (!this._canHit(p, now) || b.t <= 0) { this._calm(b, 2.5); break; }
        // Mostly a straight line, so you can sidestep it; tougher boars steer more.
        const want = Math.atan2(-(p.pos[0] - b.x), -(p.pos[2] - b.z));
        let turn = want - b.yaw;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        const maxTurn = b.st.steer * dt;
        b.yaw += Math.max(-maxTurn, Math.min(maxTurn, turn));
        const step = b.st.charge * dt;
        b.x -= Math.sin(b.yaw) * step;
        b.z -= Math.cos(b.yaw) * step;
        b.run -= step;
        if (Math.hypot(p.pos[0] - b.x, p.pos[2] - b.z) < HIT_RANGE) {
          this.room.hurtPlayer(p, b.st.damage, [p.pos[0] - b.x, p.pos[2] - b.z], 'boar');
          p.boarBreather = now + BREATHER_HIT_MS;
          // Back off a couple of steps after the hit (forward is -sin, -cos).
          b.x += Math.sin(b.yaw) * 1.5;
          b.z += Math.cos(b.yaw) * 1.5;
          this._calm(b, 3.5);
        } else if (b.run <= 0) {
          // Missed: skids to a stop and has to catch its breath.
          p.boarBreather = now + BREATHER_MISS_MS;
          this._calm(b, 2);
        }
        break;
      }
      case 'flee': {
        const [hx, hz] = b.home;
        if (this._moveTo(b, hx, hz - 30, b.st.walk * 3, dt) < 0.5) b.gone = true;
        break;
      }
      default:
    }
  }

  _windup(b, p) {
    b.state = 'windup';
    b.target = p.id;
    b.t = b.st.windup;
  }

  _calm(b, cooldown) {
    b.state = 'approach';
    b.target = null;
    b.cooldown = cooldown;
  }

  _pickTile(b, owner) {
    if (!owner) return null;
    const planted = this._planted(owner);
    if (!planted.length) return null;
    // Nearest few, picked at random, so the herd spreads out over the field.
    const plot = PLOTS[b.plot];
    planted.sort((a, c) => {
      const [ax, az] = tileCenter(plot, a[0], a[1], owner.layout);
      const [cx, cz] = tileCenter(plot, c[0], c[1], owner.layout);
      return Math.hypot(ax - b.x, az - b.z) - Math.hypot(cx - b.x, cz - b.z);
    });
    return planted[Math.floor(rnd() * Math.min(6, planted.length))];
  }

  /** Driving into a boar hurts it. Hard. */
  _roadkill(now) {
    for (const p of this.room.players.values()) {
      if (!p.vehicle) continue;
      const v = p.vehicles.find((q) => q.id === p.vehicle);
      if (!v || !(v.speed > 5)) continue;
      const reach = v.model === 'combine' ? 3.4 : 2.2;
      for (const b of this.boars.values()) {
        if (b.state === 'dead' || now - b.lastRoadkill < 700) continue;
        if (Math.hypot(b.x - v.pos[0], b.z - v.pos[2]) > reach) continue;
        b.lastRoadkill = now;
        this.damage(b, v.speed * 8, p, false);
      }
    }
  }

  // ------------------------------------------------------------- shooting

  /**
   * Resolves one trigger pull. `origin` and `dir` come from the shooter's
   * camera; spread is rolled here. Returns { end, hits } for the effects.
   */
  shoot(p, gun, origin, dir, lagMs = 0) {
    const hits = new Map();   // boar -> { dmg, head }
    let end = null;
    // The shooter aimed at boars drawn a moment in the past (the snapshot
    // interval plus the trip across the LAN). Judge the shot against both
    // where each boar was then and where it is now, and take either: a boar
    // charging straight at you is otherwise very hard to hit.
    const then = Date.now() - Math.max(0, Math.min(LAG_MAX_MS, lagMs || 0));
    const poses = [];
    for (const b of this.boars.values()) {
      if (b.state === 'dead') continue;
      poses.push([b, b.x, b.z, b.yaw]);
      const past = poseAt(b, then);
      if (past && Math.hypot(past[0] - b.x, past[1] - b.z) > 0.05) poses.push([b, past[0], past[1], past[2]]);
    }
    for (let k = 0; k < gun.pellets; k++) {
      const d = spreadDir(dir, gun.spread);
      let best = null;
      for (const [b, x, z, yaw] of poses) {
        const fx = -Math.sin(yaw);
        const fz = -Math.cos(yaw);
        const head = raySphere(origin, d, [x + fx * 0.75, 0.62, z + fz * 0.75], HEAD_R);
        const body = raySphere(origin, d, [x, 0.55, z], BODY_R);
        const t = head != null && (body == null || head <= body + 0.2) ? head : body;
        if (t == null || t > gun.range) continue;
        if (!best || t < best.t) best = { b, t, head: t === head };
      }
      if (best) {
        const falloff = best.t > gun.range * 0.6 ? 1 - 0.5 * (best.t - gun.range * 0.6) / (gun.range * 0.4) : 1;
        const dmg = gun.damage * (best.head ? 2 : 1) * falloff;
        const h = hits.get(best.b) || { dmg: 0, head: false };
        h.dmg += dmg;
        h.head = h.head || best.head;
        hits.set(best.b, h);
        if (!end) end = [origin[0] + d[0] * best.t, origin[1] + d[1] * best.t, origin[2] + d[2] * best.t];
      }
      if (!end && k === 0) {
        const reach = Math.min(gun.range, 90);
        end = [origin[0] + d[0] * reach, origin[1] + d[1] * reach, origin[2] + d[2] * reach];
      }
    }
    const results = [];
    for (const [b, h] of hits) results.push({ id: b.id, head: h.head, kill: this.damage(b, h.dmg, p, true) });
    return { end, hits: results };
  }

  /** Applies damage. Returns true if that killed it. */
  damage(b, amount, by, angry) {
    if (b.state === 'dead') return false;
    b.hp -= amount;
    if (b.hp <= 0) {
      b.hp = 0;
      b.state = 'dead';
      b.diedAt = Date.now();
      if (by) this.room.boarKilled(by, b);
      return true;
    }
    // A wounded boar goes for whoever hurt it, if they are close enough.
    if (angry && by && !ANGRY.has(b.state) && b.state !== 'flee' && this._canHit(by, Date.now())) {
      const d = Math.hypot(by.pos[0] - b.x, by.pos[2] - b.z);
      if (d < RUSH_UNTIL && !this._taken(by, b)) this._windup(b, by);
      else if (d < 32) { b.state = 'rush'; b.target = by.id; b.t = 8; }
    }
    return false;
  }

  clearFor(plotIndex) {
    for (const b of this.boars.values()) if (b.plot === plotIndex && b.state !== 'dead') b.state = 'flee';
  }
}

// ------------------------------------------------------------------ maths

/** Where a boar stood at time `t`, from its trail; null if the trail is empty. */
function poseAt(b, t) {
  const h = b.hist;
  if (!h || !h.length) return null;
  if (t <= h[0][0]) return [h[0][1], h[0][2], h[0][3]];
  for (let i = h.length - 1; i > 0; i--) {
    const a = h[i - 1];
    const c = h[i];
    if (t >= a[0]) {
      const k = c[0] > a[0] ? Math.min(1, (t - a[0]) / (c[0] - a[0])) : 1;
      return [a[1] + (c[1] - a[1]) * k, a[2] + (c[2] - a[2]) * k, c[3]];
    }
  }
  return [h[h.length - 1][1], h[h.length - 1][2], h[h.length - 1][3]];
}

function spreadDir(d, spread) {
  if (!spread) return d;
  const a = rnd() * Math.PI * 2;
  const r = Math.sqrt(rnd()) * spread;
  // Any two vectors perpendicular to d.
  const up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(d, up));
  const v = cross(d, u);
  return norm([
    d[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r,
    d[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * r,
    d[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * r,
  ]);
}

/** Distance along a unit ray to a sphere, or null. */
export function raySphere(o, d, c, r) {
  const ox = o[0] - c[0];
  const oy = o[1] - c[1];
  const oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
const r2 = (v) => Math.round(v * 100) / 100;

