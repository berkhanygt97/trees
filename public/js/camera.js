import * as THREE from 'three';
import { groundHeight } from '/shared/map.js';

// The camera. Third person by default, San Andreas style: over your right
// shoulder on foot (closer in when you aim), a springy chase camera behind
// your car that swings wider at speed. V swaps to first person: your own
// eyes and hands on foot, the driver's seat and the dashboard in a car.
//
// The camera never goes through a wall or into a hill: it is pulled in
// towards you instead.

const EYE = 1.62;
const PIVOT = 1.55;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    let mode = 'tp';
    try { mode = localStorage.getItem('valley.view') || 'tp'; } catch { /* default */ }
    this.mode = mode === 'fp' ? 'fp' : 'tp';
    this.arm = 3.4;              // current on-foot arm length (eases between walk and aim)
    this.pos = new THREE.Vector3();
    this.fresh = true;           // snap instead of easing on the next frame
    this.shake = 0;
    this.fovBase = 72;
    this.fov = 72;
  }

  get firstPerson() { return this.mode === 'fp'; }

  toggle() {
    this.mode = this.mode === 'fp' ? 'tp' : 'fp';
    try { localStorage.setItem('valley.view', this.mode); } catch { /* ignore */ }
    this.fresh = true;
    return this.mode;
  }

  /** A jolt (a crash, a hit). */
  kick(amount) { this.shake = Math.min(1, this.shake + amount); }

  _shake(dt) {
    if (this.shake <= 0) return;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const s = this.shake * this.shake * 0.25;
    this.camera.position.x += (Math.random() - 0.5) * s;
    this.camera.position.y += (Math.random() - 0.5) * s;
    this.camera.position.z += (Math.random() - 0.5) * s;
  }

  // ------------------------------------------------------------ on foot

  /** s = { pos, yaw, pitch, aiming, bob, moving } */
  foot(dt, s) {
    const cam = this.camera;
    if (s.wasted) {
      // Up and back over the body, looking down, slowly pulling away.
      this.wastedT = (this.wastedT || 0) + dt;
      s = { ...s, pitch: -0.75, aiming: false };
      const armWas = this.arm;
      this.arm = 4.5 + this.wastedT * 0.8;
      const out = this._orbit(dt, s);
      this.arm = armWas;
      this.fresh = true;
      return out;
    }
    this.wastedT = 0;
    if (this.mode === 'fp') {
      cam.position.set(s.pos.x, s.pos.y + EYE + s.bob, s.pos.z);
      cam.rotation.set(0, 0, 0);
      cam.rotateY(s.yaw);
      cam.rotateX(s.pitch);
      this.fresh = true;
      this._shake(dt);
      return;
    }
    // Over the right shoulder; closer and tighter when aiming.
    const wantArm = s.aiming ? 1.7 : 3.4;
    this.arm += (wantArm - this.arm) * Math.min(1, dt * 10);
    this._orbit(dt, s);
  }

  /** Places the camera `this.arm` behind the pivot over your shoulder. */
  _orbit(dt, s) {
    const cam = this.camera;
    const shoulder = s.aiming ? 0.62 : 0.5;
    const cy = Math.cos(s.pitch);
    const dir = tmp.set(-Math.sin(s.yaw) * cy, Math.sin(s.pitch), -Math.cos(s.yaw) * cy);
    const right = tmp2.set(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    const pivot = new THREE.Vector3(s.pos.x, s.pos.y + PIVOT, s.pos.z).addScaledVector(right, shoulder);
    // Looking down pulls the camera up and over; looking up drops it behind.
    const want = pivot.clone().addScaledVector(dir, -this.arm);
    want.y += Math.max(0, -s.pitch) * 0.4;
    const safe = this._clear(pivot, want);
    if (this.fresh) { this.pos.copy(safe); this.fresh = false; } else this.pos.lerp(safe, Math.min(1, dt * 18));
    // Never let an easing camera sit inside something: pulling in is instant.
    if (safe.distanceToSquared(pivot) < this.pos.distanceToSquared(pivot)) this.pos.copy(safe);
    cam.position.copy(this.pos);
    cam.rotation.set(0, 0, 0);
    cam.rotateY(s.yaw);
    cam.rotateX(s.pitch);
    this._shake(dt);
  }

  // ------------------------------------------------------------ in a car

  /** s = { pos (Vector3), quat (THREE.Quaternion), yaw, speed, top, lookYaw, lookPitch, spec } */
  car(dt, s) {
    const cam = this.camera;
    if (this.mode === 'fp') {
      const [sx, sy, sz] = s.spec.seat;
      const seat = new THREE.Vector3(sx, sy + s.spec.eye * 0.9, sz).applyQuaternion(s.quat).add(s.pos);
      cam.position.copy(seat);
      cam.quaternion.copy(s.quat);
      cam.rotateY(s.lookYaw);
      cam.rotateX(s.lookPitch);
      this.fresh = true;
      this._setFov(dt, 74);
      this._shake(dt);
      return;
    }
    const [, h, dist] = s.spec.cam;
    const k = Math.min(1, Math.abs(s.speed) / Math.max(10, s.top));
    // Swing wider and lower as you go faster, and look a little ahead.
    const d = dist * (1 + k * 0.25);
    const yaw = s.yaw + s.lookYaw;
    const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const target = new THREE.Vector3(s.pos.x, s.pos.y + 1.2, s.pos.z)
      .addScaledVector(back, -Math.min(6, Math.abs(s.speed) * 0.12) * Math.sign(s.speed || 1));
    const want = new THREE.Vector3(s.pos.x, s.pos.y, s.pos.z).addScaledVector(back, d);
    want.y += h * (1 - k * 0.15) - s.lookPitch * 5;
    const ground = groundHeight(want.x, want.z) + 0.6;
    if (want.y < ground) want.y = ground;
    const safe = this._clear(new THREE.Vector3(s.pos.x, s.pos.y + 1.5, s.pos.z), want);
    if (this.fresh) { this.pos.copy(safe); this.fresh = false; }
    // A spring: the camera lags behind a turn and catches up.
    else this.pos.lerp(safe, 1 - Math.exp(-dt * (5 + k * 4)));
    if (safe.distanceToSquared(target) < this.pos.distanceToSquared(target) - 1) this.pos.lerp(safe, 0.5);
    cam.position.copy(this.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    this._setFov(dt, 70 + k * 16);
    this._shake(dt);
  }

  _setFov(dt, want) {
    this.fov += (want - this.fov) * Math.min(1, dt * 3);
    this.carFov = this.fov;
  }

  /**
   * The farthest point from `from` towards `to` that is not inside a wall or
   * the ground, with a little margin.
   */
  _clear(from, to) {
    const out = to.clone();
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return out;
    let tHit = 1;
    // Walls: 2D slab test against every box near the line, with its height.
    for (const b of this.world.boxesNear()) {
      if (Math.max(from.x, to.x) < b.x0 - 0.3 || Math.min(from.x, to.x) > b.x1 + 0.3
        || Math.max(from.z, to.z) < b.z0 - 0.3 || Math.min(from.z, to.z) > b.z1 + 0.3) continue;
      const t = segBox(from, dx, dy, dz, b);
      if (t != null && t < tHit) tHit = t;
    }
    // Hills: step along the line.
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      const x = from.x + dx * t;
      const z = from.z + dz * t;
      if (from.y + dy * t < groundHeight(x, z) + 0.3) { tHit = Math.min(tHit, (i - 1) / 8); break; }
    }
    if (tHit < 1) {
      const t = Math.max(0.12, tHit - 0.3 / len);
      out.set(from.x + dx * t, from.y + dy * t, from.z + dz * t);
    }
    return out;
  }
}

/** Where a segment first enters a box grown by 0.25 m (with height h), as 0..1, or null. */
function segBox(o, dx, dy, dz, b) {
  const m = 0.25;
  const h = (b.h || 4) + m;
  let t0 = 0;
  let t1 = 1;
  const axes = [[o.x, dx, b.x0 - m, b.x1 + m], [o.y, dy, -1, h], [o.z, dz, b.z0 - m, b.z1 + m]];
  for (const [p, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return null; continue; }
    let a = (lo - p) / d;
    let c = (hi - p) / d;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return t0 > 0 ? t0 : null;
}
