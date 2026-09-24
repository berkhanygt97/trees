import * as THREE from 'three';
import { GUN_BY_ID } from '/shared/catalog.js';

// Your gun, from the client's side: draw it, aim it, fire it, reload it.
// The server decides what was hit; we predict the magazine and the rate of
// fire so the trigger feels instant, and correct ourselves from 'ammo'.

const BASE_FOV = 78;

function raySphere(o, d, c, r) {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

export class Weapons {
  constructor({ scene, camera, net, hud, sfx, boars, controls }) {
    Object.assign(this, { scene, camera, net, hud, sfx, boars, controls });
    this.viewModel = null;
    this.owned = ['boltrifle'];
    this.gunId = 'boltrifle';
    this.out = false;
    this.aiming = false;
    this.mag = GUN_BY_ID.boltrifle.mag;
    this.reloadUntil = 0;
    this.lastShot = 0;
    this.kick = 0;
    this.tracers = [];
    const mat = new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 12; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, mat.clone());
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.nextTracer = 0;
  }

  get gun() { return GUN_BY_ID[this.gunId]; }
  get reloading() { return performance.now() < this.reloadUntil; }
  /** What to tell the server we are holding, for other players to see. */
  get held() { return this.out ? this.gunId : 0; }

  attach(viewModel) {
    this.viewModel = viewModel;
    viewModel.setGun(this.gunId);
  }

  /** From the wallet: which guns you own and which one is in your hands. */
  setOwned(guns, gun) {
    this.owned = guns || ['boltrifle'];
    if (gun && gun !== this.gunId) {
      this.gunId = gun;
      this.mag = this.gun.mag;
      if (this.viewModel) this.viewModel.setGun(gun);
    }
  }

  toggle() {
    this.out = !this.out;
    if (!this.out) this.setAiming(false);
    if (this.viewModel) this.viewModel.setDrawn(this.out);
    this.sfx.click();
    return this.out;
  }

  holster() {
    if (!this.out) return;
    this.out = false;
    this.setAiming(false);
    if (this.viewModel) this.viewModel.setDrawn(false);
  }

  setAiming(v) {
    this.aiming = !!v && this.out;
    this.controls.aiming = this.aiming;
  }

  cycle() {
    if (this.owned.length < 2) {
      this.hud.toast("You only own Grandpa's rifle. Rusty's Guns in town sells more.", 'info');
      return;
    }
    const next = this.owned[(this.owned.indexOf(this.gunId) + 1) % this.owned.length];
    this.net.send('equip', { gun: next });
    this.gunId = next;
    this.mag = this.gun.mag;
    this.reloadUntil = performance.now() + 800;
    if (this.viewModel) this.viewModel.setGun(next);
    this.hud.toast(`${this.gun.name}`, 'info');
  }

  reload() {
    if (!this.out || this.reloading || this.mag >= this.gun.mag) return;
    this.net.send('reload', {});
    this.reloadUntil = performance.now() + this.gun.reload * 1000;
    this.mag = this.gun.mag;
    this.viewModel.reload(this.gun.reload);
    this.sfx.reloadSound(this.gun.reload);
  }

  /** Pull the trigger. The server has the final say. */
  fire() {
    if (!this.out) return false;
    const now = performance.now();
    const gun = this.gun;
    if (this.reloading || now - this.lastShot < gun.rate * 1000) return false;
    if (this.mag <= 0) { this.sfx.dryFire(); this.reload(); return false; }
    this.lastShot = now;
    this.mag--;

    // Where the shot leaves and which way it goes: your eyes in first person;
    // in third person, from your head towards what the crosshair is on.
    const ray = this.aimRay ? this.aimRay() : null;
    const o = ray ? ray.o : this.camera.getWorldPosition(new THREE.Vector3());
    const d = ray ? ray.d : this.camera.getWorldDirection(new THREE.Vector3());
    // lag: boars are drawn ~one snapshot (100 ms) behind the server, plus the trip here.
    const lag = Math.round(100 + this.net.latency() / 2);
    this.net.send('shoot', { o: [o.x, o.y, o.z].map(r3), d: [d.x, d.y, d.z].map(r3), lag });

    this.viewModel.fire(gun.action === 'semi' ? 0.15 : gun.rate);
    this.sfx.gunshot(soundOf(gun.id), 1);
    if (gun.action === 'bolt') this.sfx.bolt();
    if (gun.action === 'pump' || gun.action === 'lever') this.sfx.pump();
    // The camera kicks up; most of it settles back.
    this.kick += gun.id === 'biggame' ? 0.06 : gun.id === 'shotgun' ? 0.05 : gun.action === 'semi' ? 0.018 : 0.035;
    this.controls.pitch = Math.min(1.45, this.controls.pitch + this.kick * 0.5);

    // Tracer from the muzzle to whatever this ray looks like it hits.
    let end = o.clone().addScaledVector(d, Math.min(gun.range, 90));
    let best = Infinity;
    for (const e of this.boars.aliveList()) {
      const t = raySphere(o, d, new THREE.Vector3(e.pos.x, 0.55, e.pos.z), 0.7);
      if (t != null && t < best && t < gun.range) { best = t; end = o.clone().addScaledVector(d, t); }
    }
    this.tracer(ray && ray.muzzle ? ray.muzzle : this.viewModel.muzzleWorld(new THREE.Vector3()), end);
    if (this.mag === 0) setTimeout(() => this.reload(), 350);
    return true;
  }

  tracer(from, to) {
    const tr = this.tracers[this.nextTracer++ % this.tracers.length];
    const a = tr.line.geometry.attributes.position.array;
    a[0] = from.x; a[1] = from.y; a[2] = from.z;
    a[3] = to.x; a[4] = to.y; a[5] = to.z;
    tr.line.geometry.attributes.position.needsUpdate = true;
    tr.line.visible = true;
    tr.life = 0.09;
    tr.line.material.opacity = 0.9;
  }

  // ------------------------------------------------------------ server

  onShotRes(d) {
    if (d.hits && d.hits.length) {
      const kill = d.hits.some((h) => h.kill);
      this.hud.hitmark(kill);
      this.sfx.hitmark(kill);
      if (d.hits.some((h) => h.head)) this.hud.pop('HEADSHOT', 'xp');
    }
  }

  onAmmo(d) {
    if (d.gun && d.gun !== this.gunId) {
      this.gunId = d.gun;
      if (this.viewModel) this.viewModel.setGun(d.gun);
    }
    this.mag = d.mag;
    const left = d.reloadUntil ? d.reloadUntil - Date.now() : 0;
    if (left > 0) this.reloadUntil = performance.now() + left;
  }

  /** Somebody else fired: hear it (quieter far away) and see the tracer. */
  onRemoteShot(d, listener) {
    const from = new THREE.Vector3(...d.o);
    const to = new THREE.Vector3(...d.e);
    const dist = listener.distanceTo(from);
    this.sfx.gunshot(soundOf(d.gun), Math.max(0, 1 - dist / 220) ** 1.5);
    if (dist < 200) this.tracer(from.add(new THREE.Vector3(0, -0.2, 0)), to);
  }

  // ------------------------------------------------------------ frame

  update(dt) {
    for (const tr of this.tracers) {
      if (tr.life <= 0) continue;
      tr.life -= dt;
      tr.line.material.opacity = Math.max(0, tr.life / 0.09) * 0.9;
      if (tr.life <= 0) tr.line.visible = false;
    }
    // Recoil settles most of the way back down.
    if (this.kick > 0) {
      const back = Math.min(this.kick, dt * 0.35);
      this.kick -= back;
      this.controls.pitch -= back * 0.35;
    }
    // Aiming zooms in.
    const base = this.baseFov || BASE_FOV;
    const want = this.aiming ? base / this.gun.zoom : base;
    if (Math.abs(this.camera.fov - want) > 0.05) {
      this.camera.fov += (want - this.camera.fov) * Math.min(1, dt * 12);
      this.camera.updateProjectionMatrix();
    }
    this.hud.setAmmo(this.out ? { mag: this.mag, max: this.gun.mag, name: this.gun.name, reloading: this.reloading } : null);
    const scoped = this.aiming && this.viewModel && this.viewModel.scoped;
    this.hud.setCrosshair(!this.out ? 'dot' : scoped ? 'scope' : this.aiming ? 'hide' : 'gun');
  }
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/** Which gunshot a gun makes. */
function soundOf(id) {
  return { shotgun: 'shotgun', biggame: 'biggame', pistol: 'pistol', smg: 'smg' }[id] || 'rifle';
}
