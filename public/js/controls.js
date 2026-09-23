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
    this.yaw = 0;   // looking down -Z
    this.pitch = 0;
    this.onGround = true;
    this.keys = new Set();
    this.enabled = true;
    this.locked = false;
    this.sensitivity = 1;
    this.bob = 0;
    this.onStep = null;
    this.onBump = null;

    // Set while driving: { id, model, spec, yaw, speed, steer, vy, air, chase }.
    this.car = null;
    this.chase = true;
    this.lookYaw = 0;       // mouse look relative to the car
    this.lookPitch = -0.12;

    this._bind();
  }

  _bind() {
    this.dom.addEventListener('click', () => {
      if (this.enabled && !this.locked) this.dom.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) this.keys.clear();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const s = SENS_BASE * this.sensitivity;
      if (this.car) {
        this.lookYaw -= e.movementX * s;
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

  lock() { if (this.enabled) this.dom.requestPointerLock(); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  get driving() { return !!this.car; }

  // ------------------------------------------------------------- vehicles

  enterCar({ id, model, spec, pos, yaw }) {
    this.car = { id, model, spec, yaw, speed: 0, steer: 0, vy: 0, air: false };
    this.pos.set(pos[0], pos[1] || 0, pos[2]);
    this.lookYaw = 0;
    this.lookPitch = -0.12;
  }

  /** Step out beside the driver's door. Returns where the car was left. */
  exitCar() {
    const c = this.car;
    if (!c) return null;
    const parked = { pos: [this.pos.x, groundHeight(this.pos.x, this.pos.z), this.pos.z], yaw: c.yaw };
    const side = c.spec.radius + 1.0;
    const rx = Math.cos(c.yaw);
    const rz = -Math.sin(c.yaw);
    this.car = null;
    this.pos.x -= rx * side;
    this.pos.z -= rz * side;
    this.yaw = c.yaw;
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
    const active = this.locked && this.enabled;

    let fwd = 0;
    let strafe = 0;
    if (active) {
      if (k.has('KeyW') || k.has('ArrowUp')) fwd += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) fwd -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) strafe += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) strafe -= 1;
    }

    const sprinting = active && (k.has('ShiftLeft') || k.has('ShiftRight')) && fwd > 0;
    const speed = sprinting ? CONFIG.SPRINT_SPEED : CONFIG.WALK_SPEED;
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

    // Snappy but not frictionless.
    const accel = this.onGround ? 14 : 3;
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

    this.camera.position.set(this.pos.x, this.pos.y + CONFIG.EYE_HEIGHT + bobY, this.pos.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);

    return { moving, sprinting };
  }

  _drive(dt) {
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

    // Camera: chase cam by default, V for the driver's seat.
    const lookYaw = c.yaw + this.lookYaw;
    if (!k.has('KeyV')) this.lookYaw *= Math.pow(0.35, dt * (Math.abs(c.speed) > 3 ? 1 : 0.2));
    if (this.chase) {
      const [, h, dist] = c.spec.cam;
      const back = new THREE.Vector3(Math.sin(lookYaw), 0, Math.cos(lookYaw));
      const lift = h + this.lookPitch * -6;
      this.camera.position.set(this.pos.x + back.x * dist, this.pos.y + Math.max(1.2, lift), this.pos.z + back.z * dist);
      this.camera.lookAt(this.pos.x, this.pos.y + 1.4, this.pos.z);
    } else {
      const [sx, sy, sz] = c.spec.seat;
      const cos = Math.cos(c.yaw);
      const sin = Math.sin(c.yaw);
      // Seat offset in the car's frame (x right, z back).
      const wx = this.pos.x + sx * cos + sz * sin;
      const wz = this.pos.z - sx * sin + sz * cos;
      this.camera.position.set(wx, this.pos.y + sy + c.spec.eye * 0.9, wz);
      this.camera.rotation.set(0, 0, 0);
      this.camera.rotateY(lookYaw);
      this.camera.rotateX(this.lookPitch);
    }
    this.yaw = c.yaw;
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
