import * as THREE from 'three';
import { CONFIG } from '/shared/config.js';
import { BOUNDS, groundHeight } from '/shared/map.js';

const PLAYER_R = 0.45;
const SENS_BASE = 0.0022;

export class Controls {
  constructor(camera, dom, world) {
    this.camera = camera;
    this.dom = dom;
    this.world = world;

    this.pos = new THREE.Vector3(0, 0, 60);
    this.vel = new THREE.Vector3();
    this.yaw = 0;   // where the camera looks (down -Z at 0)
    this.pitch = 0;
    this.facing = 0;        // which way your body faces (third person turns you to where you walk)
    this.thirdPerson = true;
    this.physics = null;    // the Rapier world once it has loaded (physics/world.js)
    this.quat = new THREE.Quaternion();   // your car's full orientation while driving
    this.onGround = true;
    this.keys = new Set();
    this.enabled = true;
    this.locked = false;
    this.sensitivity = 1;
    this.bob = 0;
    this.onStep = null;
    this.onBump = null;

    // Set while driving: { id, model, spec, yaw, pitch, roll, speed, steer, vy, air }.
    this.car = null;
    this.chase = true;      // chase camera (third person) or the driver's seat
    this.frozen = false;    // knocked out: no control until you come round
    this.aiming = false;
    this.lookYaw = 0;       // mouse look relative to the car
    this.lookPitch = -0.12;

    this._bind();
  }

  _bind() {
    this.dom.addEventListener('click', () => {
      if (this.enabled && !this.locked) this._requestLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) this.keys.clear();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Slower while aiming down the sights, so small corrections are easy.
      const s = SENS_BASE * this.sensitivity * (this.aiming ? 0.55 : 1);
      if (this.frozen) return;
      if (this.car) {
        // In the seat you can turn your head, not spin round like an owl.
        const lim = this.chase ? Math.PI : 1.9;
        this.lookYaw = Math.max(-lim, Math.min(lim, this.lookYaw - e.movementX * s));
        this.lookPitch = Math.max(-0.9, Math.min(0.5, this.lookPitch - e.movementY * s));
        return;
      }
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space' && this.locked) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  lock() { if (this.enabled) this._requestLock(); }

  // Newer browsers return a promise that rejects when the page has no user
  // gesture yet (or runs headless); that is not an error worth reporting.
  _requestLock() {
    try {
      const p = this.dom.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* pointer lock unavailable */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  get driving() { return !!this.car; }

  // ------------------------------------------------------------- vehicles

  enterCar({ id, model, spec, pos, yaw }) {
    this.car = { id, model, spec, yaw, pitch: 0, roll: 0, speed: 0, steer: 0, vy: 0, air: false };
    this.pos.set(pos[0], pos[1] || 0, pos[2]);
    this.quat.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
    this.lookYaw = 0;
    this.lookPitch = this.chase ? -0.12 : -0.08;
    // With physics loaded, the car is a real simulated body from here on.
    if (this.physics) this.physics.startDriving(model.id, [this.pos.x, this.pos.y, this.pos.z], yaw);
  }

  /** A boar hit you: shove you away from it and up off your feet. */
  knock(dx, dz, strength = 9) {
    const len = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / len) * strength;
    this.vel.z += (dz / len) * strength;
    this.vel.y = 4.5;
    this.onGround = false;
  }

  /** Step out beside the driver's door. Returns where the car was left. */
  exitCar() {
    const c = this.car;
    if (!c) return null;
    if (this.physics) this.physics.stopDriving();
    const parked = { id: c.id, pos: [this.pos.x, groundHeight(this.pos.x, this.pos.z), this.pos.z], yaw: c.yaw };
    const side = c.spec.radius + 1.0;
    const rx = Math.cos(c.yaw);
    const rz = -Math.sin(c.yaw);
    this.car = null;
    this.pos.x -= rx * side;
    this.pos.z -= rz * side;
    this.yaw = c.yaw;
    this.facing = c.yaw;
    this.pitch = 0;
    this.vel.set(0, 0, 0);
    this._resolve(PLAYER_R);
    return parked;
  }

  // --------------------------------------------------------------- update

  update(dt) {
    return this.car ? this._drive(dt) : this._walk(dt);
  }

  _walk(dt) {
    const k = this.keys;
    const active = this.locked && this.enabled && !this.frozen;

    let fwd = 0;
    let strafe = 0;
    if (active) {
      if (k.has('KeyW') || k.has('ArrowUp')) fwd += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) fwd -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) strafe += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) strafe -= 1;
    }

    // Third person: sprint whichever way you are going; first person: forwards only.
    const sprinting = active && (k.has('ShiftLeft') || k.has('ShiftRight')) && (fwd > 0 || (this.thirdPerson && (fwd || strafe))) && !this.aiming;
    const speed = (sprinting ? CONFIG.SPRINT_SPEED : CONFIG.WALK_SPEED) * (this.aiming ? 0.5 : 1);
    const moving = fwd !== 0 || strafe !== 0;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let dx = 0;
    let dz = 0;
    if (moving) {
      const len = Math.hypot(fwd, strafe);
      const f = fwd / len;
      const s = strafe / len;
      dx = (-sin * f + cos * s) * speed;
      dz = (-cos * f - sin * s) * speed;
    }

    // Which way you face: where you walk (third person), or where you aim or look.
    if (!this.thirdPerson || this.aiming) this.facing = this.yaw;
    else if (moving && this.onGround) {
      const want = Math.atan2(-dx, -dz);
      this.facing += shortestAngle(this.facing, want) * Math.min(1, dt * 12);
    }

    // Snappy but not frictionless (and no steering at all mid-knockback).
    const accel = this.onGround ? 14 : 1.5;
    this.vel.x += (dx - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (dz - this.vel.z) * Math.min(1, accel * dt);

    if (active && k.has('Space') && this.onGround) {
      this.vel.y = CONFIG.JUMP_SPEED;
      this.onGround = false;
    }
    this.vel.y -= CONFIG.GRAVITY * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this._resolve(PLAYER_R);
    this.pos.y += this.vel.y * dt;
    const ground = groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= ground) { this.pos.y = ground; this.vel.y = 0; this.onGround = true; }
    else if (this.pos.y > ground + 0.05 && this.vel.y <= 0 && this.onGround) {
      // Walking off the top of a ramp: stay glued unless it is a real drop.
      if (this.pos.y - ground < 0.35) this.pos.y = ground;
      else this.onGround = false;
    }

    // Head bob, and a footstep on each down-beat.
    if (moving && this.onGround) {
      const prev = this.bob;
      this.bob += dt * (sprinting ? 15 : 10);
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bob / Math.PI) && this.onStep) this.onStep();
    } else {
      this.bob += dt * 1.6;
    }
    const bobY = (moving && this.onGround ? 0.055 : 0.012) * Math.sin(this.bob);
    return { moving, sprinting, bob: bobY };
  }

  /** Keys to a driving input: throttle -1..1, steer -1 (left) .. 1 (right), handbrake. */
  _input() {
    const k = this.keys;
    const active = this.locked && this.enabled;
    const gas = active && (k.has('KeyW') || k.has('ArrowUp'));
    const brake = active && (k.has('KeyS') || k.has('ArrowDown'));
    const left = active && (k.has('KeyA') || k.has('ArrowLeft'));
    const right = active && (k.has('KeyD') || k.has('ArrowRight'));
    return { throttle: (gas ? 1 : 0) - (brake ? 1 : 0), steer: (right ? 1 : 0) - (left ? 1 : 0), handbrake: active && k.has('Space') };
  }

  /** Driving with real physics: the simulation moves the car, we read it back. */
  _physicsDrive(dt) {
    const c = this.car;
    const input = this._input();
    const pose = this.physics.step(dt, input);
    if (!pose) return { moving: false, sprinting: false, speed: 0, steer: 0 };
    this.pos.set(pose.pos[0], pose.pos[1], pose.pos[2]);
    this.quat.set(pose.quat.x, pose.quat.y, pose.quat.z, pose.quat.w);
    c.yaw = pose.yaw;
    c.pitch = pose.pitch;
    c.roll = pose.roll;
    c.speed = this.physics.vehicle.speed;
    c.steer += (input.steer - c.steer) * Math.min(1, dt * 8);
    c.air = this.physics.vehicle.airTime > 0.2;
    if (this.chase) this.lookYaw *= Math.pow(0.35, dt * (Math.abs(c.speed) > 3 ? 1 : 0.2));
    this.yaw = c.yaw;
    this.facing = c.yaw;
    this.bob += dt;
    return { moving: Math.abs(c.speed) > 0.3, sprinting: false, speed: c.speed, steer: -c.steer };
  }

  _drive(dt) {
    if (this.physics && this.physics.vehicle) return this._physicsDrive(dt);
    const c = this.car;
    const m = c.model;
    const k = this.keys;
    const active = this.locked && this.enabled;
    const gas = active && (k.has('KeyW') || k.has('ArrowUp'));
    const brake = active && (k.has('KeyS') || k.has('ArrowDown'));
    const left = active && (k.has('KeyA') || k.has('ArrowLeft'));
    const right = active && (k.has('KeyD') || k.has('ArrowRight'));
    const hand = active && k.has('Space');

    // Throttle, brakes and reverse.
    if (!c.air) {
      if (gas) c.speed += (c.speed < 0 ? m.accel * 2.5 : m.accel) * dt;
      else if (brake) c.speed -= (c.speed > 0 ? m.accel * 2.5 : m.accel * 0.6) * dt;
      else c.speed -= Math.sign(c.speed) * Math.min(Math.abs(c.speed), (2 + Math.abs(c.speed) * 0.25) * dt);
      if (hand) c.speed -= Math.sign(c.speed) * Math.min(Math.abs(c.speed), m.accel * 3 * dt);
      c.speed = Math.max(-m.top * 0.35, Math.min(m.top, c.speed));
    }

    // Steering eases in, and bites less at top speed.
    const want = (left ? 1 : 0) - (right ? 1 : 0);
    c.steer += (want - c.steer) * Math.min(1, dt * 6);
    if (!c.air) {
      const grip = Math.min(1, Math.abs(c.speed) / 6) * (1 - 0.4 * Math.abs(c.speed) / m.top);
      c.yaw += c.steer * m.turn * grip * Math.sign(c.speed) * dt * (hand ? 1.6 : 1);
    }

    const fx = -Math.sin(c.yaw);
    const fz = -Math.cos(c.yaw);
    const before = groundHeight(this.pos.x, this.pos.z);
    this.pos.x += fx * c.speed * dt;
    this.pos.z += fz * c.speed * dt;
    const hit = this._resolve(c.spec.radius, c.id);
    if (hit) {
      const was = Math.abs(c.speed);
      c.speed *= 0.55;
      if (was > 6 && this.onBump) this.onBump(was);
    }

    // Ramps: follow the ground while it rises, fly when it drops away.
    const ground = groundHeight(this.pos.x, this.pos.z);
    if (!c.air) {
      if (ground >= this.pos.y - 0.05 || this.pos.y - ground < 0.15) {
        c.vy = (ground - before) / Math.max(dt, 1e-3);
        this.pos.y = ground;
      } else {
        c.air = true;   // launched
      }
    }
    if (c.air) {
      c.vy -= CONFIG.GRAVITY * 0.8 * dt;
      this.pos.y += c.vy * dt;
      if (this.pos.y <= ground) {
        this.pos.y = ground;
        if (c.vy < -6 && this.onBump) this.onBump(-c.vy);
        c.vy = 0;
        c.air = false;
      }
    }

    // (The camera itself is placed by camera.js.)
    if (this.chase) this.lookYaw *= Math.pow(0.35, dt * (Math.abs(c.speed) > 3 ? 1 : 0.2));
    this.quat.setFromEuler(new THREE.Euler(0, c.yaw, 0, 'YXZ'));
    this.yaw = c.yaw;
    this.facing = c.yaw;
    this.bob += dt;
    return { moving: Math.abs(c.speed) > 0.3, sprinting: false, speed: c.speed, steer: c.steer };
  }

  // ------------------------------------------------------------- collision

  /** Pushes a circle of radius r out of everything solid. True if it hit. */
  _resolve(r, ignoreVehicle = null) {
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      for (const o of this.world.obstaclesNear(this.pos.x, this.pos.z)) {
        if (ignoreVehicle && o.vehicle === ignoreVehicle) continue;
        if (o.gone) continue;             // knocked over
        const dx = this.pos.x - o.x;
        const dz = this.pos.z - o.z;
        const min = o.r + r;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          this.pos.x = o.x + (dx / d) * min;
          this.pos.z = o.z + (dz / d) * min;
          hit = true;
        }
      }
      for (const b of this.world.boxesNear()) {
        if (this.pos.x < b.x0 - r || this.pos.x > b.x1 + r || this.pos.z < b.z0 - r || this.pos.z > b.z1 + r) continue;
        const nx = Math.max(b.x0, Math.min(this.pos.x, b.x1));
        const nz = Math.max(b.z0, Math.min(this.pos.z, b.z1));
        const dx = this.pos.x - nx;
        const dz = this.pos.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        hit = true;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          this.pos.x = nx + (dx / d) * r;
          this.pos.z = nz + (dz / d) * r;
        } else {
          // Centre is inside the box: leave by the nearest face.
          const exits = [
            [this.pos.x - b.x0, -1, 0], [b.x1 - this.pos.x, 1, 0],
            [this.pos.z - b.z0, 0, -1], [b.z1 - this.pos.z, 0, 1],
          ].sort((a, c) => a[0] - c[0]);
          const [dist, ex, ez] = exits[0];
          this.pos.x += ex * (dist + r);
          this.pos.z += ez * (dist + r);
        }
      }
    }
    const m = r + 0.3;
    this.pos.x = Math.max(BOUNDS.minX + m, Math.min(BOUNDS.maxX - m, this.pos.x));
    this.pos.z = Math.max(BOUNDS.minZ + m, Math.min(BOUNDS.maxZ - m, this.pos.z));
    return hit;
  }
}

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
