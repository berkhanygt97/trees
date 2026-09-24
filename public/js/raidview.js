import * as THREE from 'three';
import { groundHeight } from '/shared/map.js';
import { buildVehicle } from './vehicles.js';
import { glowTexture } from './textures.js';

// A raid as everyone sees it: the rival gang's car coming down the avenue,
// and bags of stolen money lying where a raider dropped them.
// (The raiders themselves are units: unitsview.js.)

export class RaidView {
  constructor(scene) {
    this.scene = scene;
    this.raids = new Map();        // raid id -> { info, car, prev, target, yaw, t }
    this.bags = new Map();         // loot id -> { group, x, z }
    this.t = 0;
  }

  setState(state) {
    for (const r of (state && state.raids) || []) this.onRaid(r);
    this.setLoot((state && state.loot) || []);
  }

  /** A raid started, arrived, left or ended. */
  onRaid(r) {
    let e = this.raids.get(r.id);
    if (r.phase === 'over') {
      if (e) { this._dropCar(e); this.raids.delete(r.id); }
      return e ? e.info : null;
    }
    if (!e) {
      e = { info: r, car: null, prev: new THREE.Vector3(), target: new THREE.Vector3(), pos: new THREE.Vector3(), yaw: 0, targetYaw: 0, at: 0 };
      this.raids.set(r.id, e);
    }
    e.info = r;
    if (r.car && !e.car) {
      e.car = buildVehicle(r.car.model, r.car.color, { label: r.name });
      this.scene.add(e.car.group);
      e.pos.set(r.car.x, 0, r.car.z);
      e.prev.copy(e.pos);
      e.target.copy(e.pos);
      e.yaw = e.targetYaw = r.car.yaw;
    }
    return r;
  }

  _dropCar(e) {
    if (!e.car) return;
    this.scene.remove(e.car.group);
    e.car.dispose();
    e.car = null;
  }

  onCars(rows) {
    const now = performance.now();
    for (const [id, x, z, yaw] of rows || []) {
      const e = this.raids.get(id);
      if (!e) continue;
      e.prev.copy(e.pos);
      e.target.set(x, 0, z);
      e.targetYaw = yaw;
      e.at = now;
    }
  }

  /** Raids going on, for the HUD and the radar. */
  list() { return [...this.raids.values()].map((e) => ({ ...e.info, pos: e.pos })); }

  setLoot(list) {
    const seen = new Set();
    for (const l of list) {
      seen.add(l.id);
      if (this.bags.has(l.id)) continue;
      const group = moneyBag();
      group.position.set(l.x, groundHeight(l.x, l.z), l.z);
      this.scene.add(group);
      this.bags.set(l.id, { group, x: l.x, z: l.z, amount: l.amount, owner: l.owner });
    }
    for (const [id, b] of this.bags) {
      if (seen.has(id)) continue;
      this.scene.remove(b.group);
      this.bags.delete(id);
    }
  }

  update(dt) {
    this.t += dt;
    const now = performance.now();
    for (const e of this.raids.values()) {
      if (!e.car) continue;
      const k = Math.min(1.2, (now - e.at) / 150);
      e.pos.lerpVectors(e.prev, e.target, Math.min(1, k));
      let d = e.targetYaw - e.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      e.yaw += d * Math.min(1, dt * 6);
      const speed = e.prev.distanceTo(e.target) / 0.15;
      e.car.group.position.set(e.pos.x, groundHeight(e.pos.x, e.pos.z), e.pos.z);
      e.car.group.rotation.set(0, e.yaw, 0);
      e.car.update(dt, speed, 0);
      e.car.showLabel(false, 0);
    }
    for (const b of this.bags.values()) {
      b.group.children[0].position.y = 0.35 + Math.sin(this.t * 3 + b.x) * 0.08;
      b.group.children[0].rotation.y += dt * 1.5;
    }
  }
}

/** A fat sack with a dollar sign, bobbing over a green glow. */
function moneyBag() {
  const g = new THREE.Group();
  const sack = new THREE.Group();
  const cloth = new THREE.MeshLambertMaterial({ color: 0x5d7a2e });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), cloth);
  body.scale.set(1, 0.85, 1);
  sack.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 0.16, 10), cloth);
  neck.position.y = 0.3;
  sack.add(neck);
  const tie = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 6, 12), new THREE.MeshLambertMaterial({ color: 0xc9a24a }));
  tie.rotation.x = Math.PI / 2;
  tie.position.y = 0.32;
  sack.add(tie);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = '#f2e6a0';
  c.font = 'bold 54px Impact, sans-serif';
  c.textAlign = 'center';
  c.fillText('$', 32, 52);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  for (const side of [1, -1]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    sign.position.set(0, 0.02, 0.28 * side);
    if (side < 0) sign.rotation.y = Math.PI;
    sack.add(sign);
  }
  g.add(sack);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({
    map: glowTexture(), color: 0x6dff7a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.05;
  g.add(glow);
  return g;
}
