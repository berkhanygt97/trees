import * as THREE from 'three';
import { groundHeight } from '/shared/map.js';
import { createCharacter } from './character.js';

// Gang members and raiders, as the server simulates them (server/combat.js).
// 'unitlist' says who they are and how they look; 'units' snapshots say
// where they are ten times a second, and they glide in between.

const STATE = { idle: 0, patrol: 1, engage: 2, down: 3, flee: 4, work: 5, ride: 6, crack: 7, tag: 8, vandal: 9 };
const SNAP_MS = 100;

export class UnitsView {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();
    this.tmp = new THREE.Vector3();
  }

  setList(list, myColor) {
    const seen = new Set();
    for (const u of list || []) {
      seen.add(u.id);
      let e = this.items.get(u.id);
      if (e && JSON.stringify(e.look) !== JSON.stringify(u.look)) { this._drop(e); this.items.delete(u.id); e = null; }
      if (!e) {
        // Your own gang wear name tags; everyone else is just a face in the crowd.
        const tag = u.kind === 'gang' && u.color === myColor ? u.name : null;
        const char = createCharacter(u.look, { name: tag, tagColor: u.color, tagScale: 0.34 });
        this.scene.add(char.group);
        e = {
          id: u.id, kind: u.kind, owner: u.owner, color: u.color, gang: u.gang, look: u.look, char,
          prev: new THREE.Vector3(), target: new THREE.Vector3(), pos: new THREE.Vector3(),
          yaw: 0, targetYaw: 0, state: 0, hp: 100, flags: 0, lastUpdate: 0, fresh: true, speed: 0,
        };
        this.items.set(u.id, e);
      }
      e.name = u.name;
      e.char.setGun(u.gun || null);
    }
    for (const [id, e] of this.items) {
      if (!seen.has(id)) { this._drop(e); this.items.delete(id); }
    }
  }

  _drop(e) {
    this.scene.remove(e.char.group);
    e.char.dispose();
  }

  applySnap(rows) {
    const now = performance.now();
    for (const [id, x, z, yaw, state, hp, flags] of rows || []) {
      const e = this.items.get(id);
      if (!e) continue;
      if (e.fresh) {
        e.prev.set(x, 0, z);
        e.pos.copy(e.prev);
        e.fresh = false;
      } else {
        e.prev.copy(e.pos);
      }
      e.target.set(x, 0, z);
      e.targetYaw = yaw;
      e.state = state;
      e.hp = hp;
      e.flags = flags;
      e.lastUpdate = now;
    }
  }

  /** A unit fired: its gun kicks. Returns where the muzzle is, for the tracer. */
  onShot(d, out) {
    const e = this.items.get(d.uid);
    if (!e) return null;
    e.char.fire();
    return e.char.muzzleWorld(out);
  }

  /** Everyone still standing, for the radar and the crosshair. */
  aliveList() {
    const out = [];
    for (const e of this.items.values()) if (e.state !== STATE.down) out.push(e);
    return out;
  }

  update(dt, camera) {
    const now = performance.now();
    for (const e of this.items.values()) {
      const k = Math.min(1.25, (now - e.lastUpdate) / SNAP_MS);
      const before = this.tmp.copy(e.pos);
      e.pos.lerpVectors(e.prev, e.target, Math.min(1, k));
      const moved = Math.hypot(e.pos.x - before.x, e.pos.z - before.z);
      e.speed += ((dt > 0 ? moved / dt : 0) - e.speed) * Math.min(1, dt * 8);
      let d = e.targetYaw - e.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      e.yaw += d * Math.min(1, dt * 10);
      const g = e.char.group;
      g.position.set(e.pos.x, groundHeight(e.pos.x, e.pos.z), e.pos.z);
      // Characters are modelled facing +Z; yaw is measured from -Z.
      g.rotation.y = e.yaw + Math.PI;
      if (e.state === STATE.down) e.char.die();
      else if (e.char.dead) e.char.revive();
      e.char.setAiming(!!(e.flags & 1));
      e.char.setAction(e.state === STATE.crack ? 'crack' : e.state === STATE.tag ? 'spray' : e.state === STATE.vandal ? 'smash' : null);
      e.char.setBag(!!(e.flags & 4));
      const dist = camera.position.distanceTo(e.pos);
      e.char.setDistance(dist);
      e.char.scaleLabel(dist);
      // In the car: out of sight until they pile out.
      g.visible = dist < 260 && e.state !== STATE.ride;
      e.char.update(dt, e.speed > 0.3, !!(e.flags & 2), e.speed);
    }
  }
}
