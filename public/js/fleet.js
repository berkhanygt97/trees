import * as THREE from 'three';
import { CONFIG } from '/shared/config.js';
import { buildVehicle, specOf } from './vehicles.js';

/**
 * Every vehicle in the valley. Parked ones sit where they were left (and are
 * solid); ones somebody else is driving glide between network snapshots; the
 * one you are driving is placed by your own controls every frame.
 */
export class Fleet {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.items = new Map();   // vehicle id -> entry
  }

  /** Full list from the server (someone bought, parked or climbed in). */
  set(list, myId) {
    const seen = new Set();
    for (const v of list) {
      seen.add(v.id);
      let e = this.items.get(v.id);
      if (!e || e.model !== v.model) {
        if (e) this._drop(e);
        const mesh = buildVehicle(v.model, v.color, { implement: v.implement, label: `${v.ownerName}` });
        this.scene.add(mesh.group);
        e = {
          id: v.id, model: v.model, mesh, spec: specOf(v.model),
          pos: new THREE.Vector3(), prev: new THREE.Vector3(), target: new THREE.Vector3(),
          yaw: 0, prevYaw: 0, targetYaw: 0, lastUpdate: performance.now(), speed: 0,
        };
        this.items.set(v.id, e);
      }
      e.owner = v.owner;
      e.ownerName = v.ownerName;
      e.color = v.color;
      e.implement = v.implement;
      e.mesh.setColor(v.color);
      e.mesh.setImplement(v.implement);
      const wasDriven = e.driver;
      e.driver = v.driver;
      // A parked car snaps to where the server says it is.
      if (!v.driver || !wasDriven) {
        e.pos.set(v.pos[0], v.pos[1] || 0, v.pos[2]);
        e.prev.copy(e.pos);
        e.target.copy(e.pos);
        e.yaw = e.prevYaw = e.targetYaw = v.yaw;
      }
      e.mine = v.driver && v.driver === myId;
    }
    for (const [id, e] of this.items) if (!seen.has(id)) { this._drop(e); this.items.delete(id); }
    this._refreshObstacles();
  }

  _drop(e) {
    this.scene.remove(e.mesh.group);
    e.mesh.dispose();
  }

  get(id) { return this.items.get(id); }

  /** Snapshot rows: [playerId, x, y, z, yaw, anim, vehicleId, vehicleYaw]. */
  applySnap(rows, myId) {
    const now = performance.now();
    for (const row of rows) {
      const [pid, x, y, z, , , vid, vyaw] = row;
      if (!vid || pid === myId) continue;
      const e = this.items.get(vid);
      if (!e) continue;
      e.prev.copy(e.pos);
      e.prevYaw = e.yaw;
      e.target.set(x, y, z);
      e.targetYaw = vyaw;
      e.speed = e.prev.distanceTo(e.target) * CONFIG.SNAPSHOT_HZ;
      e.lastUpdate = now;
    }
  }

  /** Nearest vehicle you own within reach, for the "F to drive" prompt. */
  nearestOwned(pos, owner, reach = 4.5) {
    let best = null;
    let bestD = Infinity;
    for (const e of this.items.values()) {
      if (e.owner !== owner || e.driver) continue;
      const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z) - e.spec.radius;
      if (d < reach && d < bestD) { best = e; bestD = d; }
    }
    return best;
  }

  _refreshObstacles() {
    this.world.dynamicObstacles = [...this.items.values()].map((e) => ({ x: e.pos.x, z: e.pos.z, r: e.spec.radius * 0.9, vehicle: e.id }));
  }

  update(dt, { myCarId, myPos, myYaw, mySpeed, mySteer, camera }) {
    const now = performance.now();
    let moved = false;
    for (const e of this.items.values()) {
      if (e.id === myCarId) {
        e.pos.copy(myPos);
        e.yaw = myYaw;
        e.speed = mySpeed;
        e.steer = mySteer;
      } else if (e.driver) {
        const t = Math.min(1.2, (now - e.lastUpdate) / (1000 / CONFIG.SNAPSHOT_HZ));
        e.pos.lerpVectors(e.prev, e.target, t);
        e.yaw = e.prevYaw + shortestAngle(e.prevYaw, e.targetYaw) * Math.min(1, t);
        moved = true;
      }
      e.mesh.group.position.copy(e.pos);
      e.mesh.group.rotation.y = e.yaw;
      e.mesh.update(dt, e.driver ? (e.id === myCarId ? e.speed : e.speed) : 0, e.id === myCarId ? e.steer : 0);
      const dist = camera.position.distanceTo(e.pos);
      e.mesh.showLabel(!e.driver, dist);
    }
    if (moved || myCarId) this._refreshObstacles();
  }

  /** Where a driver sits, in world space, for placing their avatar. */
  seatOf(e, out) {
    const [sx, sy, sz] = e.spec.seat;
    const cos = Math.cos(e.yaw);
    const sin = Math.sin(e.yaw);
    return out.set(e.pos.x + sx * cos + sz * sin, e.pos.y + sy, e.pos.z - sx * sin + sz * cos);
  }
}

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
