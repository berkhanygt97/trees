import * as THREE from 'three';
import { ROADS, STATIC_BOXES, LOTS, PLOTS, PLOT_SIZE, PLAZA } from '/shared/map.js';
import { BUILDINGS, LOTS_OPEN } from '/shared/downtown.js';
import { PARKS, HOODS } from '/shared/hoods.js';
import { live } from '../batcher.js';

// Street furniture: fire hydrants, bins, benches, newspaper boxes, phone
// booths and traffic lights. Hundreds of them, a few draw calls: each kind is
// one instanced mesh per part. Every prop is also listed in `this.items`
// ({ kind, x, z, yaw, r }) so the physics can knock them over later.

const lambert = (color, o = {}) => new THREE.MeshLambertMaterial({ color, ...o });

// A tiny seeded RNG so every client puts the same bin in the same place.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const along = (r) => (r.z1 - r.z0 > r.x1 - r.x0 ? 'z' : 'x');
const inRect = (x, z, r, pad = 0) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;

/** Parts of each kind of prop: [geometry, material, local offset [x,y,z]]. */
function kinds() {
  const red = lambert(0xc0281e);
  const yellow = lambert(0xe8b82a);
  const green = lambert(0x2f5a36);
  const steel = lambert(0x7d858f);
  const dark = lambert(0x2b2b30);
  const wood = lambert(0x8a5a30);
  const blue = lambert(0x2455a0);
  return {
    hydrant: { r: 0.3, parts: [
      [new THREE.CylinderGeometry(0.16, 0.2, 0.7, 8), red, [0, 0.35, 0]],
      [new THREE.SphereGeometry(0.17, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), yellow, [0, 0.7, 0]],
      [new THREE.CylinderGeometry(0.06, 0.06, 0.46, 6).rotateZ(Math.PI / 2), red, [0, 0.45, 0]],
    ] },
    bin: { r: 0.45, parts: [
      [new THREE.CylinderGeometry(0.34, 0.3, 1.0, 10), green, [0, 0.5, 0]],
      [new THREE.CylinderGeometry(0.37, 0.37, 0.08, 10), dark, [0, 1.02, 0]],
    ] },
    bench: { r: 0.9, parts: [
      [new THREE.BoxGeometry(1.8, 0.08, 0.5), wood, [0, 0.46, 0]],
      [new THREE.BoxGeometry(1.8, 0.4, 0.06), wood, [0, 0.8, -0.24]],
      [new THREE.BoxGeometry(0.08, 0.46, 0.46), dark, [-0.8, 0.23, 0]],
      [new THREE.BoxGeometry(0.08, 0.46, 0.46), dark, [0.8, 0.23, 0]],
    ] },
    news: { r: 0.35, parts: [
      [new THREE.BoxGeometry(0.5, 0.9, 0.45), blue, [0, 0.55, 0]],
      [new THREE.BoxGeometry(0.06, 0.12, 0.06), dark, [0, 0.06, 0]],
    ] },
    phone: { r: 0.6, parts: [
      [new THREE.BoxGeometry(0.9, 2.3, 0.9), steel, [0, 1.15, 0]],
      [new THREE.BoxGeometry(0.95, 0.25, 0.95), live(new THREE.MeshBasicMaterial({ color: 0x9fd4ff })), [0, 2.4, 0]],
    ] },
  };
}

export class Props {
  constructor(parent) {
    this.group = new THREE.Group();
    this.group.name = 'props';
    parent.add(this.group);
    this.items = [];
    this.obstacles = [];
    const rnd = seeded(7331);
    const blocked = (x, z) => {
      if (ROADS.some((r) => inRect(x, z, r, 0.4))) return true;
      if (STATIC_BOXES.some((b) => inRect(x, z, b, 1.2))) return true;
      if (LOTS.some((l) => inRect(x, z, l, 0.5))) return true;
      if (PLOTS.some((p) => inRect(x, z, { x0: p.x0, x1: p.x0 + PLOT_SIZE, z0: p.z0, z1: p.z0 + PLOT_SIZE }, 1.5))) return true;
      if (LOTS_OPEN.some((o) => inRect(x, z, o, 0.5))) return true;
      if (BUILDINGS.some((b) => inRect(x, z, b, 1.5))) return true;
      return this.items.some((i) => Math.hypot(i.x - x, i.z - z) < 3);
    };
    const put = (kind, x, z, yaw = 0) => {
      if (blocked(x, z)) return false;
      this.items.push({ kind, x, z, yaw });
      return true;
    };

    // Along the pavements of streets and roads: hydrants one side, bins and
    // newspaper boxes the other, never in a junction.
    for (const r of ROADS) {
      if (r.kind === 'avenue') continue;
      const ax = along(r);
      const [a, b] = ax === 'z' ? [r.z0, r.z1] : [r.x0, r.x1];
      const [c0, c1] = ax === 'z' ? [r.x0, r.x1] : [r.z0, r.z1];
      const step = r.kind === 'street' ? 26 : 48;
      for (let s = a + 8 + rnd() * 10; s < b - 8; s += step + rnd() * 10) {
        const crossing = ROADS.some((o) => o !== r && (ax === 'z' ? s > o.z0 - 6 && s < o.z1 + 6 && o.x0 <= r.x1 && o.x1 >= r.x0 : s > o.x0 - 6 && s < o.x1 + 6 && o.z0 <= r.z1 && o.z1 >= r.z0));
        if (crossing) continue;
        const o1 = c0 - 1.6;
        const o2 = c1 + 1.6;
        const at = (off) => (ax === 'z' ? [off, s] : [s, off]);
        const yaw = ax === 'z' ? Math.PI / 2 : 0;
        put('hydrant', ...at(o1), yaw);
        const kind = rnd() < 0.7 ? 'bin' : 'news';
        put(kind, ...at(o2), yaw);
      }
    }
    // Benches in the plaza and the parks, and a phone booth in every hood.
    for (const [x, z, yaw] of [[-40, 62, 0], [-30, 62, 0], [30, 62, 0], [40, 62, 0], [-45, 45, Math.PI], [45, 45, Math.PI]]) put('bench', x, z, yaw);
    put('phone', -56, 62, 0);
    put('phone', 56, 45, 0);
    for (const p of PARKS) {
      for (let k = 0; k < 4; k++) put('bench', p.x0 + 36 + k * 5, p.z1 - 3, Math.PI);
      put('bin', p.x0 + 34, p.z1 - 3);
    }
    for (const h of HOODS) {
      const hq = h.mirror ? h.x0 + 60 : h.x1 - 60;
      put('phone', hq, h.z0 + 137, 0);
      put('news', hq + 3, h.z0 + 137, 0);
    }

    this._instance();
    this._trafficLights();
  }

  _instance() {
    const byKind = new Map();
    for (const it of this.items) {
      if (!byKind.has(it.kind)) byKind.set(it.kind, []);
      byKind.get(it.kind).push(it);
    }
    const defs = kinds();
    this.defs = defs;
    const m = new THREE.Matrix4();
    const p = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    this.meshes = {};
    for (const [kind, list] of byKind) {
      const def = defs[kind];
      this.meshes[kind] = [];
      for (const [geo, mat, off] of def.parts) {
        const inst = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((it, i) => {
          q.setFromAxisAngle(up, it.yaw);
          m.compose(new THREE.Vector3(it.x, 0, it.z), q, one);
          p.makeTranslation(off[0], off[1], off[2]);
          inst.setMatrixAt(i, m.clone().multiply(p));
        });
        inst.computeBoundingSphere();
        this.group.add(inst);
        this.meshes[kind].push(inst);
      }
      for (const it of list) {
        it.r = def.r;
        it.index = list.indexOf(it);
        this.obstacles.push({ x: it.x, z: it.z, r: def.r, prop: it });
      }
    }
  }

  // --------------------------------------------------------- knocking over

  /**
   * A car drove into one. It goes flying (a physics body, if there is
   * physics) or just keels over, and is back in its place 25 s later.
   * `vel` = [vx, vy, vz] of whatever hit it.
   */
  knock(item, vel, physics, groundAt) {
    if (item.down) return false;
    item.down = true;
    const obstacle = this.obstacles.find((o) => o.prop === item);
    if (obstacle) obstacle.gone = true;
    // Hide the instance, and stand a loose copy of it in its place.
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const def = this.defs[item.kind];
    const loose = new THREE.Group();
    item.saved = [];
    this.meshes[item.kind].forEach((inst, k) => {
      const m = new THREE.Matrix4();
      inst.getMatrixAt(item.index, m);
      item.saved.push(m);
      inst.setMatrixAt(item.index, zero);
      inst.instanceMatrix.needsUpdate = true;
      const [geo, mat, off] = def.parts[k];
      const part = new THREE.Mesh(geo, mat);
      part.position.set(off[0], off[1], off[2]);
      loose.add(part);
    });
    const y0 = groundAt ? groundAt(item.x, item.z) : 0;
    loose.position.set(item.x, y0, item.z);
    loose.rotation.y = item.yaw;
    this.group.add(loose);
    const h = { hydrant: 0.8, bin: 1.05, bench: 0.9, news: 1.1, phone: 2.5 }[item.kind] || 1;
    const speed = Math.hypot(vel[0], vel[2]);
    const fly = [vel[0] * 0.9 + (Math.random() - 0.5) * 2, 2.5 + speed * 0.25, vel[2] * 0.9 + (Math.random() - 0.5) * 2];
    const entry = { item, loose, h, t: 0, body: null };
    if (physics) {
      entry.body = physics.addDebris({ r: Math.max(0.2, item.r * 0.8), h }, [item.x, y0 + h / 2 + 0.05, item.z], fly, item.kind === 'phone' ? 120 : 25);
      entry.body.setRotation({ x: 0, y: Math.sin(item.yaw / 2), z: 0, w: Math.cos(item.yaw / 2) }, true);
    } else {
      entry.fallDir = Math.atan2(vel[0], vel[2]);
    }
    this.loose = this.loose || [];
    this.loose.push(entry);
    // Never more than a few dozen lying about.
    if (this.loose.length > 30) this._restore(this.loose.shift(), physics);
    return true;
  }

  _restore(e, physics) {
    if (e.body && physics) physics.removeBody(e.body);
    this.group.remove(e.loose);
    const { item } = e;
    this.meshes[item.kind].forEach((inst, k) => {
      inst.setMatrixAt(item.index, item.saved[k]);
      inst.instanceMatrix.needsUpdate = true;
    });
    item.saved = null;
    item.down = false;
    const obstacle = this.obstacles.find((o) => o.prop === item);
    if (obstacle) obstacle.gone = false;
  }

  /** Moves loose props with their physics bodies; puts them back after a while. */
  updateLoose(dt, physics) {
    if (!this.loose || !this.loose.length) return;
    for (const e of [...this.loose]) {
      e.t += dt;
      if (e.body) {
        const p = e.body.translation();
        const q = e.body.rotation();
        // The body's centre is half way up; the loose copy stands on its base.
        const half = new THREE.Vector3(0, -e.h / 2, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
        e.loose.position.set(p.x + half.x, p.y + half.y, p.z + half.z);
        e.loose.quaternion.set(q.x, q.y, q.z, q.w);
      } else if (e.t < 0.6) {
        // No physics: it just keels over, away from the car.
        const k = Math.min(1, e.t / 0.5) * 1.45;
        e.loose.rotation.set(Math.cos(e.fallDir - e.item.yaw) * k, e.item.yaw, -Math.sin(e.fallDir - e.item.yaw) * k, 'YXZ');
      }
      if (e.t > 25) {
        this._restore(e, physics);
        this.loose.splice(this.loose.indexOf(e), 1);
      }
    }
  }

  /** Traffic lights where streets meet the bigger roads. They change, too. */
  _trafficLights() {
    const spots = [];
    const main = ROADS.filter((r) => r.kind !== 'avenue');
    const seen = new Set();
    for (const a of ROADS) {
      for (const b of main) {
        if (a === b || along(a) === along(b)) continue;
        const x0 = Math.max(a.x0, b.x0);
        const x1 = Math.min(a.x1, b.x1);
        const z0 = Math.max(a.z0, b.z0);
        const z1 = Math.min(a.z1, b.z1);
        if (x0 >= x1 || z0 >= z1) continue;
        const key = `${Math.round(x0)},${Math.round(z0)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Two corner poles per junction, diagonally opposite, one for each road.
        spots.push({ x: x0 - 1.2, z: z0 - 1.2, axis: along(a) }, { x: x1 + 1.2, z: z1 + 1.2, axis: along(b) });
      }
    }
    const n = spots.length;
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.12, 5, 8);
    const headGeo = new THREE.BoxGeometry(0.45, 1.3, 0.4);
    const lampGeo = new THREE.SphereGeometry(0.14, 8, 6);
    const poles = new THREE.InstancedMesh(poleGeo, lambert(0x3a3d42), n);
    const heads = new THREE.InstancedMesh(headGeo, lambert(0x2a2a2a), n);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, n * 3);
    const m = new THREE.Matrix4();
    spots.forEach((s, i) => {
      m.makeTranslation(s.x, 2.5, s.z); poles.setMatrixAt(i, m);
      m.makeTranslation(s.x, 5.4, s.z); heads.setMatrixAt(i, m);
      for (let k = 0; k < 3; k++) {
        m.makeTranslation(s.x, 5.8 - k * 0.4, s.z + (s.axis === 'x' ? 0.22 : 0) + (s.axis === 'z' ? 0 : 0));
        lamps.setMatrixAt(i * 3 + k, m);
      }
      this.obstacles.push({ x: s.x, z: s.z, r: 0.3 });
    });
    this.group.add(poles, heads, lamps);
    this.lights = { spots, lamps, phase: -1 };
    this._setLights(0);
  }

  /** 0: north-south roads green; 1: amber; 2: east-west green; 3: amber. */
  _setLights(phase) {
    const L = this.lights;
    if (!L || L.phase === phase) return;
    L.phase = phase;
    const c = new THREE.Color();
    const RED = [1, 0.15, 0.1];
    const AMB = [1, 0.7, 0.1];
    const GRN = [0.2, 1, 0.35];
    const OFF = 0.12;
    L.spots.forEach((s, i) => {
      const goes = (s.axis === 'z' && phase === 0) || (s.axis === 'x' && phase === 2);
      const amber = (s.axis === 'z' && phase === 1) || (s.axis === 'x' && phase === 3);
      const on = [!goes && !amber, amber, goes];
      [RED, AMB, GRN].forEach((col, k) => {
        const f = on[k] ? 1 : OFF;
        L.lamps.setColorAt(i * 3 + k, c.setRGB(col[0] * f, col[1] * f, col[2] * f));
      });
    });
    L.lamps.instanceColor.needsUpdate = true;
  }

  update(now = performance.now()) {
    // A 26-second cycle: 11 green, 2 amber, each way.
    const t = (now / 1000) % 26;
    this._setLights(t < 11 ? 0 : t < 13 ? 1 : t < 24 ? 2 : 3);
  }
}
