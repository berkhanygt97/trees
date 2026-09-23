import * as THREE from 'three';
import { VEHICLE_BY_ID } from '/shared/catalog.js';
import { labelSprite, shadowTexture } from './textures.js';

// Every vehicle is built from boxes and cylinders, like the rest of the world.
// Local frame: forward is -Z (the same as a player's yaw), up is +Y.

const phong = (color, o = {}) => new THREE.MeshPhongMaterial({ color, shininess: 40, specular: 0x333333, ...o });
const GLASS = phong(0x1c2530, { shininess: 90, specular: 0x8899aa });
const TYRE = phong(0x151515, { shininess: 5 });
const RIM = phong(0xc8c8c8, { shininess: 80 });
const CHROME = phong(0xdadada, { shininess: 100, specular: 0xffffff });
const HEAD = new THREE.MeshBasicMaterial({ color: 0xfff6d0 });
const TAIL = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
const DARK = phong(0x222226, { shininess: 10 });

/** Physical dimensions the controls and the farm need. */
export const SPECS = {
  hatch:   { radius: 1.3, seat: [-0.35, 0.45, 0.1],  cam: [0, 3.2, 7.5],  eye: 1.05 },
  pickup:  { radius: 1.45, seat: [-0.4, 0.6, -0.4],  cam: [0, 3.6, 8.5],  eye: 1.2 },
  sedan:   { radius: 1.4, seat: [-0.4, 0.45, 0],     cam: [0, 3.3, 8],    eye: 1.05 },
  muscle:  { radius: 1.45, seat: [-0.4, 0.4, 0.3],   cam: [0, 3.1, 8.2],  eye: 0.95 },
  coupe:   { radius: 1.4, seat: [-0.4, 0.35, 0.4],   cam: [0, 3.0, 8],    eye: 0.9 },
  limo:    { radius: 1.6, seat: [-0.4, 0.45, -2.4],  cam: [0, 4.0, 11.5], eye: 1.05 },
  hyper:   { radius: 1.4, seat: [-0.35, 0.28, 0.3],  cam: [0, 2.8, 7.8],  eye: 0.8 },
  tractor: { radius: 1.6, seat: [0, 1.3, 0.75],      cam: [0, 4.6, 9],    eye: 0.95, work: 3.4 },
  combine: { radius: 2.8, seat: [0, 3.4, -1.0],      cam: [0, 7.5, 14],   eye: 1.0, work: -4.6 },
};

export const specOf = (modelId) => SPECS[(VEHICLE_BY_ID[modelId] || {}).body] || SPECS.sedan;

function box(parent, w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function wheel(parent, r, w, x, y, z, wheels) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 18), TYRE);
  tyre.rotation.z = Math.PI / 2;
  g.add(tyre);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 10), RIM);
  rim.rotation.z = Math.PI / 2;
  g.add(rim);
  // A spoke so you can see it turn.
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, r * 0.9, 0.12), DARK);
  g.add(spoke);
  g.position.set(x, y, z);
  parent.add(g);
  wheels.push({ g, r, front: z < 0 });
  return g;
}

function lights(parent, w, y, front, back) {
  for (const s of [-1, 1]) {
    box(parent, 0.34, 0.16, 0.05, s * (w / 2 - 0.3), y, front - 0.02, HEAD);
    box(parent, 0.34, 0.14, 0.05, s * (w / 2 - 0.3), y, back + 0.02, TAIL);
  }
}

/** A generic car: lower body + cabin + four wheels, tuned per model. */
function car(g, wheels, paint, o) {
  const { len, wid, bodyH, lift, cabLen, cabH, cabZ, wheelR, roof = true } = o;
  const body = box(g, wid, bodyH, len, 0, lift + bodyH / 2, 0, paint);
  if (roof) {
    const cab = box(g, wid - 0.18, cabH, cabLen, 0, lift + bodyH + cabH / 2, cabZ, GLASS);
    box(g, wid - 0.14, 0.08, cabLen - 0.1, 0, lift + bodyH + cabH, cabZ, paint);
    // Pillars, so it reads as a car cabin rather than a black brick.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(g, 0.08, cabH, 0.1, sx * (wid / 2 - 0.12), lift + bodyH + cabH / 2, cabZ + sz * (cabLen / 2 - 0.05), paint);
    }
    cab.userData.cab = true;
  }
  box(g, wid + 0.04, 0.12, 0.22, 0, lift + 0.12, -len / 2 - 0.05, CHROME);
  box(g, wid + 0.04, 0.12, 0.22, 0, lift + 0.12, len / 2 + 0.05, CHROME);
  lights(g, wid, lift + bodyH * 0.6, -len / 2, len / 2);
  const wx = wid / 2 - 0.05;
  const wz = len / 2 - wheelR - 0.25;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(g, wheelR, 0.3, sx * wx, wheelR, sz * wz, wheels);
  return body;
}

const BUILDERS = {
  hatch(g, wheels, paint) {
    car(g, wheels, paint, { len: 3.6, wid: 1.7, bodyH: 0.72, lift: 0.3, cabLen: 2.0, cabH: 0.66, cabZ: 0.25, wheelR: 0.34 });
    // Rust patches and a mismatched door: it has been through things.
    const rust = phong(0x8a4a22, { shininess: 4 });
    box(g, 0.02, 0.3, 0.5, 0.86, 0.6, 1.2, rust);
    box(g, 0.02, 0.22, 0.4, -0.86, 0.5, -1.1, rust);
    box(g, 0.03, 0.6, 1.0, -0.86, 0.66, 0.1, phong(0x8a8f7a));
  },
  pickup(g, wheels, paint) {
    car(g, wheels, paint, { len: 5.0, wid: 1.95, bodyH: 0.8, lift: 0.45, cabLen: 1.7, cabH: 0.8, cabZ: -0.5, wheelR: 0.45 });
    // Open load bed at the back.
    box(g, 1.9, 0.5, 0.08, 0, 1.5, 0.4, paint);
    box(g, 0.08, 0.5, 2.1, 0.92, 1.5, 1.45, paint);
    box(g, 0.08, 0.5, 2.1, -0.92, 1.5, 1.45, paint);
    box(g, 1.7, 0.1, 2.0, 0, 1.3, 1.45, DARK);
    box(g, 1.9, 0.12, 0.2, 0, 1.0, -2.6, CHROME);
  },
  sedan(g, wheels, paint) {
    car(g, wheels, paint, { len: 4.6, wid: 1.85, bodyH: 0.66, lift: 0.3, cabLen: 2.3, cabH: 0.62, cabZ: 0.1, wheelR: 0.36 });
  },
  muscle(g, wheels, paint) {
    car(g, wheels, paint, { len: 4.8, wid: 1.95, bodyH: 0.68, lift: 0.28, cabLen: 1.8, cabH: 0.52, cabZ: 0.5, wheelR: 0.4 });
    box(g, 0.7, 0.2, 0.9, 0, 1.06, -1.4, DARK);   // hood scoop
    const stripe = phong(0xf5f5f5);
    for (const s of [-0.22, 0.22]) {
      box(g, 0.16, 0.02, 4.8, s, 0.97, 0, stripe);
    }
    for (const s of [-0.5, 0.5]) box(g, 0.12, 0.12, 0.6, s, 0.3, 2.5, CHROME);   // exhausts
  },
  coupe(g, wheels, paint) {
    car(g, wheels, paint, { len: 4.4, wid: 1.9, bodyH: 0.56, lift: 0.26, cabLen: 1.7, cabH: 0.48, cabZ: 0.45, wheelR: 0.36 });
    box(g, 1.8, 0.08, 0.4, 0, 1.25, 2.0, paint);   // spoiler
    for (const s of [-0.7, 0.7]) box(g, 0.08, 0.35, 0.1, s, 1.05, 2.0, DARK);
  },
  limo(g, wheels, paint) {
    car(g, wheels, paint, { len: 7.6, wid: 1.95, bodyH: 0.68, lift: 0.3, cabLen: 5.2, cabH: 0.6, cabZ: 0.4, wheelR: 0.38 });
    box(g, 1.96, 0.05, 7.4, 0, 0.62, 0, CHROME);
    // Middle axle, because nobody believes a car this long only has four wheels.
    for (const sx of [-1, 1]) wheel(g, 0.38, 0.3, sx * 0.93, 0.38, 0.2, wheels);
  },
  hyper(g, wheels, paint) {
    car(g, wheels, paint, { len: 4.5, wid: 2.0, bodyH: 0.46, lift: 0.22, cabLen: 1.6, cabH: 0.42, cabZ: 0.3, wheelR: 0.36 });
    const nose = box(g, 1.9, 0.18, 1.2, 0, 0.45, -2.5, paint);
    nose.rotation.x = 0.12;
    box(g, 2.1, 0.08, 0.5, 0, 1.3, 2.05, DARK);   // rear wing
    for (const s of [-0.85, 0.85]) box(g, 0.08, 0.5, 0.12, s, 1.05, 2.05, DARK);
    const glow = new THREE.MeshBasicMaterial({ color: 0x4df0ff });
    for (const s of [-1, 1]) box(g, 0.05, 0.05, 3.6, s * 1.0, 0.3, 0, glow);
  },
  tractor(g, wheels, paint) {
    box(g, 1.2, 0.9, 2.6, 0, 1.15, -0.7, paint);            // engine
    box(g, 1.25, 0.12, 2.65, 0, 1.62, -0.7, DARK);
    box(g, 0.12, 0.9, 0.12, 0.35, 2.05, -1.4, DARK);        // exhaust
    box(g, 1.6, 0.3, 1.4, 0, 1.05, 0.9, paint);             // seat deck
    box(g, 0.6, 0.12, 0.6, 0, 1.35, 0.9, DARK);             // seat
    // Roll cage and roof.
    for (const sx of [-0.72, 0.72]) for (const sz of [0.3, 1.5]) box(g, 0.08, 1.6, 0.08, sx, 2.0, sz, DARK);
    box(g, 1.7, 0.1, 1.5, 0, 2.8, 0.9, paint);
    wheel(g, 0.95, 0.55, 1.05, 0.95, 0.9, wheels);
    wheel(g, 0.95, 0.55, -1.05, 0.95, 0.9, wheels);
    wheel(g, 0.5, 0.35, 0.8, 0.5, -1.6, wheels);
    wheel(g, 0.5, 0.35, -0.8, 0.5, -1.6, wheels);
    box(g, 0.3, 0.14, 0.05, 0.35, 1.2, -2.02, HEAD);
    box(g, 0.3, 0.14, 0.05, -0.35, 1.2, -2.02, HEAD);
  },
  combine(g, wheels, paint) {
    box(g, 3.0, 2.6, 5.4, 0, 2.2, 0.8, paint);              // body
    box(g, 2.0, 1.4, 1.8, 0, 4.1, -1.2, GLASS);             // cab
    box(g, 2.1, 0.12, 1.9, 0, 4.85, -1.2, paint);
    box(g, 1.4, 0.8, 1.4, 0, 3.9, 2.4, DARK);               // grain tank lid
    const pipe = box(g, 0.35, 0.35, 3.2, 1.7, 3.6, 1.6, paint);   // unloading auger
    pipe.rotation.y = 0.6;
    wheel(g, 1.2, 0.8, 1.7, 1.2, -0.8, wheels);
    wheel(g, 1.2, 0.8, -1.7, 1.2, -0.8, wheels);
    wheel(g, 0.7, 0.5, 1.5, 0.7, 2.9, wheels);
    wheel(g, 0.7, 0.5, -1.5, 0.7, 2.9, wheels);
    // The header: wide cutter bar with a spinning reel.
    const header = new THREE.Group();
    header.position.set(0, 0.8, -3.6);
    box(header, 9.6, 0.5, 1.6, 0, 0, 0, phong(0xd9d9d9));
    box(header, 9.6, 0.1, 0.1, 0, -0.25, -0.85, CHROME);
    const reel = new THREE.Group();
    reel.position.set(0, 0.7, -0.2);
    for (let i = 0; i < 5; i++) {
      const bar = box(reel, 9.2, 0.08, 0.08, 0, 0, 0, phong(0xf2c14e));
      const a = (i / 5) * Math.PI * 2;
      bar.position.set(0, Math.sin(a) * 0.55, Math.cos(a) * 0.55);
    }
    header.add(reel);
    g.add(header);
    g.userData.reel = reel;
    box(g, 0.4, 0.16, 0.05, 0.6, 3.9, -2.12, HEAD);
    box(g, 0.4, 0.16, 0.05, -0.6, 3.9, -2.12, HEAD);
  },
};

// Things a tractor can pull, hung off the tow bar behind it.
const IMPLEMENT_BUILDERS = {
  plow(g) {
    const steel = phong(0x8f969c, { shininess: 70 });
    box(g, 5.6, 0.2, 0.3, 0, 0.8, 0, phong(0xb83a2c));
    for (let i = -2; i <= 2; i++) {
      const blade = box(g, 0.14, 0.7, 0.9, i * 1.2, 0.4, 0.3, steel);
      blade.rotation.y = 0.5;
    }
  },
  seeder(g) {
    box(g, 5.6, 0.2, 0.4, 0, 0.6, 0, phong(0x2f7de0));
    box(g, 4.8, 0.9, 1.0, 0, 1.3, 0.3, phong(0x2f7de0));
    box(g, 4.9, 0.1, 1.1, 0, 1.8, 0.3, phong(0xf2c14e));
    for (let i = -2; i <= 2; i++) box(g, 0.1, 0.6, 0.1, i * 1.2, 0.3, 0.1, DARK);
  },
  tank(g) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.4, 16), phong(0x4dc3ff, { shininess: 80 }));
    tank.rotation.z = Math.PI / 2;
    tank.position.set(0, 1.4, 0.6);
    g.add(tank);
    box(g, 5.6, 0.12, 0.12, 0, 0.7, 0, CHROME);
    for (let i = -2; i <= 2; i++) box(g, 0.08, 0.3, 0.08, i * 1.3, 0.5, 0, CHROME);
    const wheels = [];
    wheel(g, 0.45, 0.3, 1.0, 0.45, 0.8, wheels);
    wheel(g, 0.45, 0.3, -1.0, 0.45, 0.8, wheels);
  },
};

/**
 * Builds a vehicle. Returns handles to spin the wheels, swap the implement and
 * show who owns it.
 */
export function buildVehicle(modelId, color = '#d93a3a', { implement = null, label = null } = {}) {
  const model = VEHICLE_BY_ID[modelId] || VEHICLE_BY_ID.sedan;
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const wheels = [];
  const paint = phong(color);
  BUILDERS[model.body](body, wheels, paint);

  const spec = SPECS[model.body];

  // A soft blob shadow under the car, sized from its footprint.
  const bbox = new THREE.Box3().setFromObject(body);
  const size = bbox.getSize(new THREE.Vector3());
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(size.x * 1.25, size.z * 1.15),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set((bbox.min.x + bbox.max.x) / 2, 0.035, (bbox.min.z + bbox.max.z) / 2);
  group.add(shadow);

  const hitch = new THREE.Group();
  hitch.position.set(0, 0, spec.work || 3.4);
  body.add(hitch);
  let currentImpl = null;

  function setImplement(id) {
    if (id === currentImpl) return;
    currentImpl = id;
    hitch.clear();
    if (id && IMPLEMENT_BUILDERS[id] && model.id === 'tractor') IMPLEMENT_BUILDERS[id](hitch);
  }
  setImplement(implement);

  let tag = null;
  if (label) {
    tag = labelSprite(label, color, 0.45);
    tag.position.y = bbox.max.y + 0.9;
    tag.userData.base = { x: tag.scale.x, y: tag.scale.y };
    group.add(tag);
  }

  let spin = 0;
  return {
    group,
    model,
    spec,
    setImplement,
    get implement() { return currentImpl; },
    body,
    /** Keeps the shadow on the ground while the car flies off a ramp. */
    setAir(h) { shadow.position.y = 0.035 - h; shadow.material.opacity = Math.max(0.15, 1 - h / 6); },
    setColor(c) { paint.color.set(c); },
    showLabel(v, distance = 10) {
      if (!tag) return;
      tag.visible = v && distance > 3 && distance < 90;
      const k = Math.min(1, Math.max(0.35, distance / 10));
      tag.scale.set(tag.userData.base.x * k, tag.userData.base.y * k, 1);
    },
    /** Spin the wheels at road speed, and point the front ones into the turn. */
    update(dt, speed, steer = 0) {
      spin += dt * speed;
      for (const w of wheels) {
        w.g.rotation.x = -spin / w.r;
        w.g.rotation.y = w.front && model.id !== 'combine' ? steer * 0.45 : 0;
      }
      if (body.userData.reel) body.userData.reel.rotation.x -= dt * (1 + Math.abs(speed) * 0.4);
    },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material === paint) paint.dispose();
      });
      if (tag) { tag.material.map.dispose(); tag.material.dispose(); }
    },
  };
}
