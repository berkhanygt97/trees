import * as THREE from 'three';
import { pbr } from './gfx/materials.js';
import { hideTexture, shadowTexture } from './textures.js';

// Wild boars as the players see them. The server owns where they are; this
// just glides them between snapshots, trots their legs, and knocks them over
// when they die.

const phong = (color, o = {}) => pbr(color, { shininess: 6, ...o });
const STATES = ['approach', 'eat', 'charge', 'flee', 'dead', 'windup'];

function box(parent, w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** A boar facing -Z, about 1.4 m long. Bigger levels grow bigger boars. */
function buildBoar(level) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hide = phong(0xffffff, { map: hideTexture() });
  const dark = phong(0x2a1d15);
  const tusk = phong(0xf0e6cc, { shininess: 60 });
  const snout = phong(0x8a5a4a);

  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), hide);
  torso.scale.set(0.95, 0.85, 1.55);
  torso.position.set(0, 0.62, 0.05);
  body.add(torso);
  // The hump over the shoulders, and a bristly ridge down the back.
  const hump = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), hide);
  hump.position.set(0, 0.84, -0.28);
  hump.scale.set(0.9, 0.8, 1);
  body.add(hump);
  for (let i = 0; i < 9; i++) {
    const bristle = box(body, 0.05, 0.12, 0.08, 0, 1.0 - i * 0.02, -0.42 + i * 0.11, dark);
    bristle.rotation.x = 0.4;
  }
  // Head: wedge-shaped, with snout, tusks, ears and little mean eyes.
  const head = new THREE.Group();
  head.position.set(0, 0.62, -0.62);
  body.add(head);
  const skull = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.55, 8), hide);
  skull.rotation.x = -Math.PI / 2;
  skull.scale.set(1, 1, 0.85);
  skull.position.z = -0.15;
  head.add(skull);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.09, 0.08, 10), snout);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, -0.02, -0.44);
  head.add(nose);
  for (const s of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.16, 6), tusk);
    t.position.set(s * 0.08, 0.02, -0.36);
    t.rotation.set(-0.6, 0, s * 0.5);
    head.add(t);
    const ear = box(head, 0.1, 0.14, 0.03, s * 0.14, 0.2, 0.02, dark);
    ear.rotation.set(-0.3, 0, s * 0.5);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), new THREE.MeshBasicMaterial({ color: 0x1a0505 }));
    eye.position.set(s * 0.12, 0.08, -0.14);
    head.add(eye);
  }
  const tail = box(body, 0.03, 0.03, 0.22, 0, 0.72, 0.72, dark);
  tail.rotation.x = -0.7;

  // Legs pivot at the body.
  const legs = [];
  for (const [x, z] of [[-0.2, -0.38], [0.2, -0.38], [-0.2, 0.42], [0.2, 0.42]]) {
    const hip = new THREE.Group();
    hip.position.set(x, 0.5, z);
    body.add(hip);
    box(hip, 0.1, 0.45, 0.11, 0, -0.22, 0, hide);
    box(hip, 0.09, 0.07, 0.12, 0, -0.47, -0.01, dark);
    legs.push(hip);
  }

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.8),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  root.add(shadow);

  const s = 0.85 + Math.min(0.5, level * 0.035);
  body.scale.setScalar(s);
  return { root, body, head, legs, shadow };
}

function hpBar() {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 8;
  const tex = new THREE.CanvasTexture(cv);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  sprite.scale.set(1, 0.14, 1);
  sprite.position.y = 1.45;
  return {
    sprite,
    set(frac) {
      const g = cv.getContext('2d');
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(0, 0, 64, 8);
      g.fillStyle = frac > 0.5 ? '#6bd66b' : frac > 0.25 ? '#f2c14e' : '#e0403a';
      g.fillRect(1, 1, 62 * frac, 6);
      tex.needsUpdate = true;
    },
  };
}

export class BoarView {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();
    this.t = 0;
  }

  /** Snapshot rows: [id, x, z, yaw, state, hp%, level]. */
  apply(rows) {
    const now = performance.now();
    const seen = new Set();
    for (const [id, x, z, yaw, st, hp, level] of rows) {
      seen.add(id);
      let e = this.items.get(id);
      if (!e) {
        const m = buildBoar(level);
        const bar = hpBar();
        m.root.add(bar.sprite);
        bar.sprite.visible = false;
        m.root.position.set(x, 0, z);
        m.root.rotation.y = yaw;
        this.scene.add(m.root);
        e = {
          id, m, bar, hp: 100, state: 'approach',
          prev: new THREE.Vector3(x, 0, z), target: new THREE.Vector3(x, 0, z), pos: new THREE.Vector3(x, 0, z),
          yaw, targetYaw: yaw, last: now, fall: 0, speed: 0,
        };
        this.items.set(id, e);
      }
      e.prev.copy(e.pos);
      e.target.set(x, 0, z);
      e.targetYaw = yaw;
      e.speed = e.prev.distanceTo(e.target) * 10;
      e.last = now;
      const state = STATES[st] || 'approach';
      if (state === 'dead' && e.state !== 'dead' && this.onDeath) this.onDeath(e);
      if (hp < e.hp && this.onHurt) this.onHurt(e);
      // The grunt is your warning: it comes as the boar starts pawing the ground.
      if ((state === 'windup' || state === 'charge') && e.state !== 'windup' && e.state !== 'charge' && this.onCharge) this.onCharge(e);
      e.state = state;
      if (hp !== e.hp) {
        e.hp = hp;
        e.bar.set(hp / 100);
      }
      e.bar.sprite.visible = hp < 100 && state !== 'dead';
    }
    for (const [id, e] of this.items) {
      if (!seen.has(id)) {
        this.scene.remove(e.m.root);
        e.m.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        this.items.delete(id);
      }
    }
  }

  /** Where each live boar is, for the client-side tracer to stop at. */
  aliveList() {
    return [...this.items.values()].filter((e) => e.state !== 'dead');
  }

  update(dt) {
    this.t += dt;
    const now = performance.now();
    for (const e of this.items.values()) {
      const k = Math.min(1.2, (now - e.last) / 100);
      e.pos.lerpVectors(e.prev, e.target, k);
      let d = e.targetYaw - e.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      e.yaw += d * Math.min(1, dt * 10);
      e.m.root.position.copy(e.pos);
      e.m.root.rotation.y = e.yaw;

      const { legs, body, head } = e.m;
      if (e.state === 'dead') {
        e.fall = Math.min(1, e.fall + dt * 3);
        body.rotation.z = e.fall * (Math.PI / 2);
        body.position.y = -e.fall * 0.25;
        legs.forEach((l) => { l.rotation.x = 0; });
        continue;
      }
      const moving = e.speed > 0.3;
      const rate = e.state === 'charge' ? 22 : moving ? 12 : 0;
      const sw = moving ? Math.sin(this.t * rate) * (e.state === 'charge' ? 0.9 : 0.5) : 0;
      legs[0].rotation.x = sw;
      legs[3].rotation.x = sw;
      legs[1].rotation.x = -sw;
      legs[2].rotation.x = -sw;
      body.position.y = moving ? Math.abs(Math.sin(this.t * rate)) * 0.05 : 0;
      // Grazing: head down, rooting about.
      head.rotation.x = e.state === 'eat' ? -0.5 + Math.sin(this.t * 6) * 0.15 : e.state === 'charge' ? 0.15 : 0;
      if (e.state === 'windup') {
        // Pawing the ground with a front hoof, head low, rocking: about to go.
        legs[0].rotation.x = -0.4 + Math.sin(this.t * 16) * 0.6;
        head.rotation.x = -0.35;
        body.rotation.x = Math.sin(this.t * 16) * 0.04;
        body.position.y = 0;
      } else {
        body.rotation.x = 0;
      }
    }
  }
}
