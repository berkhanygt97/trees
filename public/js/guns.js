import * as THREE from 'three';
import { woodGrainTexture, gunMetalTexture } from './textures.js';

// Every gun, built from boxes and cylinders with wood and steel textures.
// Local frame: the barrel points down -Z, the butt is at +Z, the origin is
// the pistol grip where the right hand goes.

const phong = (color, o = {}) => new THREE.MeshPhongMaterial({ color, shininess: 30, specular: 0x444444, ...o });
const STEEL = () => phong(0xffffff, { map: gunMetalTexture(), shininess: 70, specular: 0x777777 });
const BLUED = () => phong(0x3a3f47, { shininess: 90, specular: 0x9aa3ad });
const WOOD = (c) => phong(0xffffff, { map: woodGrainTexture(c), shininess: 25 });
const BRASS = () => phong(0xc9a24a, { shininess: 90, specular: 0xffe7a0 });
const BLACK = () => phong(0x1c1d20, { shininess: 20 });

function box(parent, w, h, d, x, y, z, mat, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  parent.add(m);
  return m;
}

function tube(parent, r, len, x, y, z, mat, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** A shaped stock: butt, wrist and comb, like a real rifle rather than a plank. */
function stock(g, wood, { dropY = -0.05, length = 0.36 } = {}) {
  box(g, 0.042, 0.06, 0.12, 0, -0.005, 0.03, wood, 0.12);                 // wrist
  const butt = box(g, 0.045, 0.12, length, 0, dropY, 0.06 + length / 2, wood, -0.08);
  butt.scale.set(1, 1, 1);
  box(g, 0.05, 0.13, 0.025, 0, dropY - 0.005, 0.07 + length, phong(0x161616));   // recoil pad
  box(g, 0.03, 0.08, 0.03, 0, -0.06, 0.01, wood, 0.35);                   // pistol grip
}

const BUILDERS = {
  boltrifle(g, parts) {
    const wood = WOOD('#7a4424');
    stock(g, wood);
    box(g, 0.05, 0.05, 0.42, 0, 0.0, -0.25, wood);                          // fore-end
    box(g, 0.036, 0.042, 0.2, 0, 0.035, -0.04, STEEL());                    // receiver
    tube(g, 0.011, 0.62, 0, 0.045, -0.5, BLUED());                          // barrel
    box(g, 0.006, 0.022, 0.012, 0, 0.066, -0.79, BLUED());                  // front post
    box(g, 0.02, 0.016, 0.02, 0, 0.062, -0.02, BLUED());                    // rear sight
    box(g, 0.012, 0.03, 0.05, 0, -0.035, -0.05, STEEL());                   // trigger guard
    // The bolt: slides back and forth, handle sticking out to the right.
    const bolt = new THREE.Group();
    tube(bolt, 0.012, 0.09, 0, 0.05, 0.02, STEEL());
    const handle = box(bolt, 0.06, 0.008, 0.008, 0.035, 0.05, 0.04, STEEL());
    handle.rotation.z = -0.5;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), STEEL());
    knob.position.set(0.064, 0.033, 0.04);
    bolt.add(knob);
    g.add(bolt);
    parts.bolt = bolt;
    return { muzzle: [0, 0.045, -0.82], left: [0, -0.02, -0.33], sight: 0.074 };
  },
  lever(g, parts) {
    const wood = WOOD('#9a5a2c');
    stock(g, wood, { length: 0.33 });
    box(g, 0.046, 0.045, 0.3, 0, -0.005, -0.25, wood);
    box(g, 0.038, 0.05, 0.18, 0, 0.03, -0.04, BRASS());                     // brass receiver
    tube(g, 0.011, 0.55, 0, 0.045, -0.45, BLUED());
    tube(g, 0.009, 0.42, 0, 0.018, -0.4, BLUED());                          // tube magazine
    box(g, 0.006, 0.02, 0.012, 0, 0.064, -0.71, BLUED());
    const lever = new THREE.Group();
    lever.position.set(0, -0.03, 0.02);
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.006, 6, 14, Math.PI * 1.3), BLUED());
    loop.rotation.set(0, Math.PI / 2, Math.PI * 0.35);
    loop.position.set(0, -0.03, 0.02);
    lever.add(loop);
    g.add(lever);
    parts.lever = lever;
    return { muzzle: [0, 0.045, -0.73], left: [0, -0.02, -0.3], sight: 0.072 };
  },
  shotgun(g, parts) {
    const wood = WOOD('#5a3218');
    stock(g, wood, { length: 0.34 });
    box(g, 0.042, 0.05, 0.2, 0, 0.03, -0.06, BLACK());                      // receiver
    tube(g, 0.015, 0.6, 0, 0.05, -0.45, BLUED(), 12);
    tube(g, 0.011, 0.44, 0, 0.022, -0.38, BLUED());
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 6), BRASS());
    bead.position.set(0, 0.067, -0.74);
    g.add(bead);
    const pump = new THREE.Group();
    const fore = tube(pump, 0.026, 0.17, 0, 0.024, -0.3, wood, 10);
    for (let i = 0; i < 5; i++) tube(pump, 0.027, 0.006, 0, 0.024, -0.24 - i * 0.03, phong(0x2a1a0c), 10);
    fore.scale.set(1, 1, 1);
    g.add(pump);
    parts.pump = pump;
    return { muzzle: [0, 0.05, -0.76], left: [0, -0.01, -0.3], sight: 0.068 };
  },
  semiauto(g, parts) {
    const poly = BLACK();
    box(g, 0.04, 0.07, 0.3, 0, -0.02, 0.2, poly, -0.06);
    box(g, 0.03, 0.09, 0.035, 0, -0.07, 0.01, poly, 0.3);
    box(g, 0.042, 0.06, 0.24, 0, 0.02, -0.08, poly);
    box(g, 0.05, 0.05, 0.26, 0, 0.01, -0.33, poly);                         // handguard
    tube(g, 0.011, 0.34, 0, 0.03, -0.6, BLUED());
    box(g, 0.012, 0.012, 0.3, 0, 0.056, -0.1, STEEL());                     // rail
    const mag = box(g, 0.024, 0.12, 0.055, 0, -0.08, -0.08, poly, 0.15);
    parts.mag = mag;
    box(g, 0.02, 0.03, 0.02, 0, 0.075, -0.45, poly);
    parts.bolt = new THREE.Group();
    box(parts.bolt, 0.03, 0.012, 0.012, 0.03, 0.035, 0.0, STEEL());
    g.add(parts.bolt);
    return { muzzle: [0, 0.03, -0.77], left: [0, -0.01, -0.34], sight: 0.086 };
  },
  biggame(g, parts) {
    const wood = WOOD('#4a2410');
    stock(g, wood, { length: 0.38 });
    box(g, 0.052, 0.055, 0.46, 0, 0.0, -0.27, wood);
    box(g, 0.038, 0.044, 0.22, 0, 0.035, -0.04, STEEL());
    tube(g, 0.014, 0.72, 0, 0.047, -0.58, BLUED(), 12);
    // Scope.
    tube(g, 0.02, 0.3, 0, 0.1, -0.08, BLACK(), 12);
    tube(g, 0.027, 0.06, 0, 0.1, -0.24, BLACK(), 12);
    tube(g, 0.025, 0.05, 0, 0.1, 0.06, BLACK(), 12);
    box(g, 0.01, 0.04, 0.012, 0, 0.074, -0.14, BLACK());
    box(g, 0.01, 0.04, 0.012, 0, 0.074, 0.0, BLACK());
    const bolt = new THREE.Group();
    const handle = box(bolt, 0.06, 0.008, 0.008, 0.035, 0.05, 0.04, STEEL());
    handle.rotation.z = -0.5;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), STEEL());
    knob.position.set(0.064, 0.033, 0.04);
    bolt.add(knob);
    g.add(bolt);
    parts.bolt = bolt;
    return { muzzle: [0, 0.047, -0.94], left: [0, -0.02, -0.36], sight: 0.1, scope: true };
  },
};

/**
 * Returns { group, muzzle (Object3D at the barrel tip), left (Vector3 where
 * the left hand holds it), sight (height of the sight line above the grip),
 * scope (true if you look through a scope), parts: { bolt | lever | pump | mag } }.
 */
export function buildGun(id) {
  const group = new THREE.Group();
  const parts = {};
  const make = BUILDERS[id] || BUILDERS.boltrifle;
  const spec = make(group, parts);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(...spec.muzzle);
  group.add(muzzle);
  return { group, muzzle, left: new THREE.Vector3(...spec.left), sight: spec.sight, scope: !!spec.scope, parts };
}
