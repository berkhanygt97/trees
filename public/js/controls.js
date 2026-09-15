import * as THREE from 'three';
import { CONFIG, ROOM } from '/shared/config.js';

const PLAYER_R = 0.45;
const SENS_BASE = 0.0022;

export class Controls {
  constructor(camera, dom, world) {
    this.camera = camera;
    this.dom = dom;
    this.world = world;

    this.pos = new THREE.Vector3(0, 0, 34);
    this.vel = new THREE.Vector3();
    this.yaw = 0;   // looking down -Z, into the casino
    this.pitch = 0;
    this.onGround = true;
    this.keys = new Set();
    this.enabled = true;
    this.locked = false;
    this.sensitivity = 1;
    this.bob = 0;
    this.onStep = null;

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

  update(dt) {
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

    this._move(this.vel.x * dt, this.vel.z * dt);
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; }

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

  _move(dx, dz) {
    this.pos.x += dx;
    this._resolve();
    this.pos.z += dz;
    this._resolve();
    this._bounds();
  }

  _resolve() {
    for (const o of this.world.obstacles) {
      const dx = this.pos.x - o.x;
      const dz = this.pos.z - o.z;
      const min = o.r + PLAYER_R;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        this.pos.x = o.x + (dx / d) * min;
        this.pos.z = o.z + (dz / d) * min;
      }
    }
  }

  _bounds() {
    const m = PLAYER_R + 0.3;
    this.pos.x = Math.max(ROOM.MIN_X + m, Math.min(ROOM.MAX_X - m, this.pos.x));
    this.pos.z = Math.max(ROOM.RAIL_Z + 0.7, Math.min(ROOM.MAX_Z - m, this.pos.z));
  }
}
