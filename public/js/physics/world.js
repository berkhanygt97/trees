// The physics world: the ground (the shared terrain grid as a heightfield),
// every wall, tree and ramp as static colliders, other people's cars as
// kinematic bodies moved from the network, and your own car as a real
// simulated vehicle. Steps at a fixed 60 Hz; the car's pose is interpolated
// between steps so it stays smooth at any frame rate.
//
// No DOM and no three.js: the tests drive this exact code in Node.
import { VehicleBody, quatMul, yawQuat } from './vehicle.js';
import { tuningFor } from './tuning.js';

const STEP = 1 / 60;
const HALF_TURN = { x: 0, y: 1, z: 0, w: 0 };

export class PhysicsWorld {
  /** `R` is an initialised RAPIER module. */
  constructor(R, { gravity = -14 } = {}) {
    this.R = R;
    this.world = new R.World({ x: 0, y: gravity, z: 0 });
    this.world.timestep = STEP;
    this.events = new R.EventQueue(true);
    this.groups = new Map();         // key -> [collider]
    this.remote = new Map();         // vehicle id -> { body, collider }
    this.vehicle = null;             // your car
    this.acc = 0;
    this.onCrash = null;             // (force per tonne, point) when your car hits something hard
    this.prev = null;
    this.cur = null;
  }

  // ------------------------------------------------------------ the world

  /** The ground: `grid` = terrainGrid() from shared/terrain.js. */
  addTerrain(grid) {
    const { cols, rows, cell, minX, minZ } = grid;
    const heights = new Float32Array(cols * rows);
    // Rapier wants column-major: each column (fixed x) holds every row (z).
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) heights[i * rows + j] = grid.grid[j * cols + i];
    const sx = (cols - 1) * cell;
    const sz = (rows - 1) * cell;
    const desc = this.R.ColliderDesc.heightfield(rows - 1, cols - 1, heights, { x: sx, y: 1, z: sz })
      .setTranslation(minX + sx / 2, -0.03, minZ + sz / 2)
      .setFriction(0.9);
    this._add('terrain', [this.world.createCollider(desc)]);
  }

  /** Walls and buildings: boxes { x0, x1, z0, z1, h }. Replaces anything under `key`. */
  setBoxes(key, boxes, { base = 0, defaultH = 4 } = {}) {
    this._clear(key);
    const list = [];
    for (const b of boxes) {
      const h = b.h || defaultH;
      const hx = Math.max(0.05, (b.x1 - b.x0) / 2);
      const hz = Math.max(0.05, (b.z1 - b.z0) / 2);
      const desc = this.R.ColliderDesc.cuboid(hx, h / 2, hz)
        .setTranslation((b.x0 + b.x1) / 2, base + h / 2, (b.z0 + b.z1) / 2)
        .setFriction(0.5);
      list.push(this.world.createCollider(desc));
    }
    this._add(key, list);
  }

  /** Trees, posts and poles: circles { x, z, r } as upright cylinders standing on `groundAt`. */
  setPosts(key, circles, groundAt = () => 0, h = 4) {
    this._clear(key);
    const list = [];
    for (const c of circles) {
      const desc = this.R.ColliderDesc.cylinder(h / 2, c.r)
        .setTranslation(c.x, groundAt(c.x, c.z) + h / 2, c.z)
        .setFriction(0.5);
      list.push(this.world.createCollider(desc));
    }
    this._add(key, list);
  }

  /** Ramps from shared/map.js: wedges rising along `dir`. */
  setRamps(ramps) {
    this._clear('ramps');
    const list = [];
    for (const r of ramps) {
      const L = r.len / 2;
      const W = r.width / 2;
      // Wedge in its own frame (u along, v across), then turned by dir.
      const pts = [[-L, 0, -W], [L, 0, -W], [L, r.h, -W], [-L, 0, W], [L, 0, W], [L, r.h, W]];
      const c = Math.cos(r.dir);
      const s = Math.sin(r.dir);
      const flat = [];
      for (const [u, y, v] of pts) flat.push(r.x + u * c - v * s, y, r.z + u * s + v * c);
      const desc = this.R.ColliderDesc.convexHull(new Float32Array(flat));
      if (desc) list.push(this.world.createCollider(desc.setFriction(0.8)));
    }
    this._add('ramps', list);
  }

  _add(key, list) { this.groups.set(key, [...(this.groups.get(key) || []), ...list]); }

  _clear(key) {
    for (const c of this.groups.get(key) || []) this.world.removeCollider(c, false);
    this.groups.delete(key);
  }

  // ---------------------------------------------------------- your car

  startDriving(modelId, pos, yaw) {
    this.stopDriving();
    this.vehicle = new VehicleBody(this.R, this.world, modelId, { pos, yaw });
    this.acc = 0;
    this.prev = this.cur = this.vehicle.pose();
    return this.vehicle;
  }

  stopDriving() {
    if (!this.vehicle) return null;
    const pose = this.vehicle.pose();
    this.vehicle.remove();
    this.vehicle = null;
    return pose;
  }

  // ------------------------------------------------------ other cars

  /** Somebody else's car (or a parked one): a solid shape that moves where the network says. */
  setRemote(id, modelId, pos, quat) {
    let e = this.remote.get(id);
    if (!e) {
      const t = tuningFor(modelId);
      const body = this.world.createRigidBody(this.R.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(pos[0], pos[1], pos[2]).setRotation(quat));
      const collider = this.world.createCollider(this.R.ColliderDesc.cuboid(t.wid / 2, t.height / 2, t.len / 2)
        .setTranslation(0, t.lift + t.height / 2, 0).setFriction(0.4), body);
      e = { body, collider };
      this.remote.set(id, e);
    }
    e.body.setNextKinematicTranslation({ x: pos[0], y: pos[1], z: pos[2] });
    e.body.setNextKinematicRotation(quat);
  }

  dropRemote(id) {
    const e = this.remote.get(id);
    if (!e) return;
    this.world.removeRigidBody(e.body);
    this.remote.delete(id);
  }

  remoteIds() { return [...this.remote.keys()]; }

  // --------------------------------------------------------------- step

  /**
   * Advances the world by real time `dt`, driving your car with `input`.
   * Returns your car's interpolated pose (or null if you are on foot).
   */
  step(dt, input = {}) {
    this.acc = Math.min(this.acc + dt, STEP * 5);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      if (this.vehicle) {
        this.prev = this.cur;
        this.vehicle.drive(input, STEP);
      }
      this.world.step(this.events);
      if (this.vehicle) this.cur = this.vehicle.pose();
      this._drainEvents();
    }
    if (!this.vehicle || !this.cur) return null;
    return lerpPose(this.prev || this.cur, this.cur, this.acc / STEP);
  }

  _drainEvents() {
    if (!this.vehicle) { this.events.clear(); return; }
    const mine = this.vehicle.collider.handle;
    const mass = this.vehicle.t.mass;
    this.events.drainContactForceEvents((e) => {
      if (e.collider1() !== mine && e.collider2() !== mine) return;
      const f = e.totalForceMagnitude() / mass;
      if (this.onCrash) this.onCrash(f);
    });
  }
}

function lerpPose(a, b, k) {
  const pos = [0, 1, 2].map((i) => a.pos[i] + (b.pos[i] - a.pos[i]) * k);
  // Short-way quaternion blend (nlerp is fine at 60 Hz).
  let { x, y, z, w } = b.quat;
  const dot = a.quat.x * x + a.quat.y * y + a.quat.z * z + a.quat.w * w;
  if (dot < 0) { x = -x; y = -y; z = -z; w = -w; }
  const q = { x: a.quat.x + (x - a.quat.x) * k, y: a.quat.y + (y - a.quat.y) * k, z: a.quat.z + (z - a.quat.z) * k, w: a.quat.w + (w - a.quat.w) * k };
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  q.x /= n; q.y /= n; q.z /= n; q.w /= n;
  const lerpA = (p, r) => p + shortest(p, r) * k;
  return { pos, quat: q, yaw: lerpA(a.yaw, b.yaw), pitch: a.pitch + (b.pitch - a.pitch) * k, roll: a.roll + (b.roll - a.roll) * k };
}

function shortest(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** The chassis frame of a model-frame yaw (for kinematic remote cars). */
export const chassisQuat = (yaw, pitch = 0, roll = 0) => {
  // YXZ: yaw about Y, then pitch about X, then roll about Z.
  const qy = yawQuat(yaw);
  const qx = { x: Math.sin(pitch / 2), y: 0, z: 0, w: Math.cos(pitch / 2) };
  const qz = { x: 0, y: 0, z: Math.sin(roll / 2), w: Math.cos(roll / 2) };
  return quatMul(quatMul(qy, qx), qz);
};
export { HALF_TURN };
