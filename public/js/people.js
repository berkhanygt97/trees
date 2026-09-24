import * as THREE from 'three';
import { mergeParts } from './geo.js';
import { labelSprite } from './textures.js';

// Everybody who is not a player: hired hands, restaurant customers, casino
// regulars, people on the pavement. PS2 crowd style: flat vertex colours,
// low poly, five draw calls a person (torso, two arms, two legs), so forty of
// them cost about as much as two players.

const MAT = new THREE.MeshLambertMaterial({ vertexColors: true });

// Shared primitive shapes (copied into each person's merged mesh).
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  ball: new THREE.SphereGeometry(0.5, 8, 6),
  cone: new THREE.ConeGeometry(0.5, 1, 8),
};

export const OUTFITS = ['work', 'tee', 'hawaii', 'suit', 'dress', 'chef', 'waiter', 'tourist', 'vest'];

const shade = (hex, k) => {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return c.getHex();
};

/** A random look, for crowds; `rnd` is a 0..1 generator so crowds can be seeded. */
export function randomLook(rnd = Math.random, outfit) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  return {
    outfit: outfit || pick(['tee', 'tee', 'hawaii', 'suit', 'dress', 'tourist', 'work', 'vest']),
    shirt: pick(['#c0392b', '#2e86de', '#27ae60', '#f39c12', '#8e44ad', '#16a085', '#e84393', '#00b894', '#fdcb6e', '#e17055', '#ffffff', '#2d3436']),
    pants: pick(['#2d3436', '#34495e', '#636e72', '#b2bec3', '#6c5ce7', '#3d2b1f', '#dfe6e9']),
    skin: pick(['#f1c7a3', '#e0ac80', '#c68a5e', '#9c6644', '#6f4a33', '#f5d6c0']),
    hair: pick(['#2b1d14', '#6b4a2e', '#b58b4c', '#d9d6cf', '#1a1a1a', '#8a3b1e', '#e8c35a']),
    hat: pick(['none', 'none', 'none', 'cap', 'visor', 'straw', 'tophat']),
    beard: rnd() < 0.25,
    long: rnd() < 0.4,
    build: 0.9 + rnd() * 0.22,
  };
}

function torsoParts(look) {
  const shirt = look.shirt || '#2e86de';
  const pants = look.pants || '#34495e';
  const skin = look.skin || '#e0ac80';
  const hair = look.hair || '#2b1d14';
  const o = look.outfit || 'work';
  const parts = [
    { geo: G.box, color: pants, y: 0.93, s: [0.36, 0.2, 0.22] },                        // hips
    { geo: G.cyl, color: shirt, y: 1.22, s: [0.4, 0.5, 0.27] },                         // chest
    { geo: G.cyl, color: skin, y: 1.51, s: [0.12, 0.1, 0.12] },                         // neck
    { geo: G.ball, color: skin, y: 1.68, s: [0.25, 0.29, 0.26] },                       // head
    { geo: G.box, color: '#1b1410', x: -0.05, y: 1.7, z: 0.125, s: [0.035, 0.03, 0.01] },   // eyes
    { geo: G.box, color: '#1b1410', x: 0.05, y: 1.7, z: 0.125, s: [0.035, 0.03, 0.01] },
    { geo: G.box, color: shade(skin, 0.85), y: 1.66, z: 0.13, s: [0.04, 0.06, 0.04] },    // nose
    { geo: G.ball, color: hair, y: 1.77, z: -0.02, s: [0.27, 0.16, 0.27] },               // hair cap
  ];
  if (look.long) parts.push({ geo: G.box, color: hair, y: 1.6, z: -0.1, s: [0.26, 0.3, 0.1] });
  if (look.beard) parts.push({ geo: G.ball, color: hair, y: 1.6, z: 0.05, s: [0.22, 0.14, 0.2] });
  // Outfits: a few extra boxes over the basic shape.
  if (o === 'work' || o === 'vest') {
    parts.push({ geo: G.box, color: o === 'vest' ? '#f39c12' : '#3d6aa8', y: 1.22, z: 0.02, s: [0.41, 0.46, 0.26] });   // overalls / hi-vis
    if (o === 'vest') parts.push({ geo: G.box, color: '#dfe6e9', y: 1.15, z: 0.02, s: [0.42, 0.04, 0.27] });           // reflective band
  }
  if (o === 'hawaii') {
    for (const [x, y] of [[-0.1, 1.3], [0.08, 1.16], [0.12, 1.36], [-0.12, 1.08]]) parts.push({ geo: G.box, color: '#fff27a', x, y, z: 0.13, s: [0.07, 0.07, 0.02] });
  }
  if (o === 'suit' || o === 'waiter') {
    parts.push({ geo: G.box, color: '#f5f6fa', y: 1.3, z: 0.12, s: [0.12, 0.3, 0.04] });                                // shirt front
    parts.push({ geo: G.box, color: o === 'waiter' ? '#111' : '#c0392b', y: 1.4, z: 0.14, s: [0.1, 0.05, 0.02] });      // bow tie / tie knot
    if (o === 'suit') parts.push({ geo: G.box, color: '#c0392b', y: 1.28, z: 0.14, s: [0.04, 0.2, 0.02] });
  }
  if (o === 'dress') parts.push({ geo: G.cone, color: shirt, y: 0.9, s: [0.5, 0.55, 0.42] });
  if (o === 'chef' || o === 'waiter') parts.push({ geo: G.box, color: '#f5f6fa', y: 1.02, z: 0.1, s: [0.36, 0.42, 0.08] });   // apron
  if (o === 'tourist') parts.push({ geo: G.box, color: '#2d3436', x: 0.1, y: 1.25, z: 0.14, s: [0.1, 0.08, 0.05] });          // camera
  // Hats.
  const hat = o === 'chef' ? 'chef' : look.hat;
  if (hat === 'cap') {
    parts.push({ geo: G.ball, color: look.hatColor || shirt, y: 1.8, s: [0.28, 0.14, 0.28] });
    parts.push({ geo: G.box, color: look.hatColor || shirt, y: 1.79, z: 0.15, s: [0.2, 0.02, 0.14] });
  } else if (hat === 'straw') {
    parts.push({ geo: G.cyl, color: '#e3c27a', y: 1.8, s: [0.5, 0.02, 0.5] });
    parts.push({ geo: G.cyl, color: '#d4ae62', y: 1.87, s: [0.26, 0.13, 0.26] });
  } else if (hat === 'visor') {
    parts.push({ geo: G.box, color: '#ff6b81', y: 1.8, z: 0.14, s: [0.26, 0.03, 0.16] });
  } else if (hat === 'tophat') {
    parts.push({ geo: G.cyl, color: '#111', y: 1.83, s: [0.38, 0.02, 0.38] });
    parts.push({ geo: G.cyl, color: '#111', y: 1.97, s: [0.24, 0.28, 0.24] });
  } else if (hat === 'bandana') {
    parts.push({ geo: G.ball, color: look.hatColor || '#c0392b', y: 1.79, s: [0.28, 0.14, 0.28] });
  } else if (hat === 'chef') {
    parts.push({ geo: G.cyl, color: '#ffffff', y: 1.92, s: [0.26, 0.26, 0.26] });
    parts.push({ geo: G.ball, color: '#ffffff', y: 2.06, s: [0.32, 0.16, 0.32] });
  }
  return parts;
}

function limb(parts) {
  const mesh = new THREE.Mesh(mergeParts(parts), MAT);
  const pivot = new THREE.Group();
  pivot.add(mesh);
  return pivot;
}

// Props held for different jobs.
function prop(kind) {
  const P = {
    hoe: [{ geo: G.cyl, color: '#8a5a2b', y: -0.15, rx: 0.3, s: [0.03, 1.1, 0.03] }, { geo: G.box, color: '#888', y: -0.68, z: 0.2, s: [0.18, 0.03, 0.1] }],
    can: [{ geo: G.cyl, color: '#3fbf6a', y: -0.2, s: [0.16, 0.2, 0.16] }, { geo: G.cyl, color: '#3fbf6a', y: -0.18, z: 0.14, rx: 1.1, s: [0.03, 0.25, 0.03] }],
    basket: [{ geo: G.cyl, color: '#b08850', y: -0.2, s: [0.3, 0.16, 0.24] }, { geo: G.ball, color: '#e8412c', y: -0.1, s: [0.2, 0.08, 0.16] }],
    sack: [{ geo: G.ball, color: '#d9c49a', y: -0.18, s: [0.24, 0.3, 0.2] }],
    tray: [{ geo: G.cyl, color: '#c0c6cc', y: 0.02, s: [0.36, 0.02, 0.36] }, { geo: G.cyl, color: '#e17055', y: 0.07, s: [0.16, 0.08, 0.16] }],
    pan: [{ geo: G.cyl, color: '#2d3436', y: 0.02, z: 0.15, s: [0.26, 0.04, 0.26] }, { geo: G.box, color: '#2d3436', y: 0.02, z: -0.05, s: [0.04, 0.03, 0.2] }],
    bag: [{ geo: G.box, color: '#e84393', y: -0.2, s: [0.26, 0.24, 0.18] }],
    drink: [{ geo: G.cyl, color: '#fdcb6e', y: -0.02, s: [0.06, 0.14, 0.06] }],
    chips: [{ geo: G.cyl, color: '#e84393', y: -0.02, s: [0.1, 0.03, 0.1] }, { geo: G.cyl, color: '#0984e3', y: 0.02, s: [0.1, 0.03, 0.1] }],
  };
  const parts = P[kind];
  if (!parts) return null;
  return new THREE.Mesh(mergeParts(parts), MAT);
}

/**
 * Builds a person. `look` from randomLook() (or a worker's saved look).
 * Returns { group, update(dt, moving), setPose(pose), setProp(kind), dispose }.
 * Poses: 'stand', 'walk', 'work', 'sit', 'eat', 'cheer', 'play', 'cook', 'carry'.
 */
export function createPerson(look = {}, { name = null, tagColor = '#ffffff', tagScale = 0.36 } = {}) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const k = look.build || 1;
  body.scale.set(k, 1, k);

  const torso = new THREE.Mesh(mergeParts(torsoParts(look)), MAT);
  body.add(torso);

  const sleeve = look.outfit === 'tee' || look.outfit === 'hawaii' || look.outfit === 'vest' ? 'skin' : 'shirt';
  const skin = look.skin || '#e0ac80';
  const armColor = sleeve === 'skin' ? skin : (look.outfit === 'suit' ? '#2d3436' : look.shirt || '#2e86de');
  const arms = [-1, 1].map((side) => {
    const a = limb([
      { geo: G.cyl, color: look.outfit === 'suit' ? '#2d3436' : look.shirt || '#2e86de', y: -0.1, s: [0.11, 0.22, 0.11] },
      { geo: G.cyl, color: armColor, y: -0.33, s: [0.09, 0.26, 0.09] },
      { geo: G.ball, color: skin, y: -0.5, s: [0.1, 0.12, 0.1] },
    ]);
    a.position.set(side * 0.25, 1.43, 0);
    body.add(a);
    return a;
  });
  const legColor = look.outfit === 'suit' ? '#2d3436' : look.pants || '#34495e';
  const legs = [-1, 1].map((side) => {
    const l = limb([
      { geo: G.cyl, color: look.outfit === 'dress' ? skin : legColor, y: -0.4, s: [0.14, 0.8, 0.14] },
      { geo: G.box, color: look.outfit === 'dress' ? '#c0392b' : '#2b1d14', y: -0.82, z: 0.04, s: [0.13, 0.08, 0.24] },
    ]);
    l.position.set(side * 0.1, 0.87, 0);
    body.add(l);
    return l;
  });

  const hand = new THREE.Group();
  hand.position.set(0, -0.5, 0.05);
  arms[1].add(hand);
  let held = null;
  let heldKind = null;

  let tag = null;
  if (name) {
    tag = labelSprite(name, tagColor, tagScale);
    tag.position.y = 2.25;
    tag.material.depthTest = true;
    group.add(tag);
  }

  // A soft round shadow, like the players have.
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 12).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.position.y = 0.02;
  group.add(shadow);

  let pose = 'stand';
  let t = Math.random() * 10;

  function setProp(kind) {
    if (kind === heldKind) return;
    if (held) { hand.remove(held); held.geometry.dispose(); held = null; }
    heldKind = kind || null;
    if (kind) { held = prop(kind); if (held) hand.add(held); }
  }

  return {
    group,
    get pose() { return pose; },
    setPose(p) { pose = p; },
    setProp,
    setName(n) {
      if (!tag) return;
      group.remove(tag);
      tag.material.map.dispose();
      tag.material.dispose();
      tag = labelSprite(n, tagColor, tagScale);
      tag.position.y = 2.25;
      tag.material.depthTest = true;
      group.add(tag);
    },
    update(dt, moving) {
      t += dt;
      const p = moving ? 'walk' : pose;
      // Reset, then pose.
      body.position.y = 0;
      body.rotation.x = 0;
      arms[0].rotation.set(0, 0, 0.06);
      arms[1].rotation.set(0, 0, -0.06);
      legs[0].rotation.set(0, 0, 0);
      legs[1].rotation.set(0, 0, 0);
      if (p === 'walk') {
        const s = Math.sin(t * 8);
        legs[0].rotation.x = s * 0.55;
        legs[1].rotation.x = -s * 0.55;
        arms[0].rotation.x = -s * 0.45;
        arms[1].rotation.x = held ? -0.6 : s * 0.45;
        body.position.y = Math.abs(Math.sin(t * 8)) * 0.03;
      } else if (p === 'work') {
        // Bent over the soil, working a tool.
        body.rotation.x = 0.35 + Math.sin(t * 4) * 0.08;
        arms[0].rotation.x = -0.9 + Math.sin(t * 4) * 0.35;
        arms[1].rotation.x = -0.9 + Math.sin(t * 4 + 0.6) * 0.35;
      } else if (p === 'cook') {
        arms[0].rotation.x = -1.1 + Math.sin(t * 6) * 0.15;
        arms[1].rotation.x = -1.2 + Math.sin(t * 9) * 0.3;
      } else if (p === 'carry') {
        arms[1].rotation.x = -1.35;
        arms[0].rotation.x = Math.sin(t * 2) * 0.05;
      } else if (p === 'sit' || p === 'eat' || p === 'play') {
        legs[0].rotation.x = legs[1].rotation.x = -1.45;
        body.position.y = -0.42;
        if (p === 'eat') arms[1].rotation.x = -1.3 - Math.max(0, Math.sin(t * 2.4)) * 0.8;
        if (p === 'play') {
          arms[0].rotation.x = -1.2;
          arms[1].rotation.x = -1.2 - Math.max(0, Math.sin(t * 1.7)) * 0.9;
        }
      } else if (p === 'cheer') {
        arms[0].rotation.x = arms[1].rotation.x = -2.9 + Math.sin(t * 10) * 0.2;
        body.position.y = Math.abs(Math.sin(t * 10)) * 0.08;
      } else {
        body.rotation.x = Math.sin(t * 1.3) * 0.01;
      }
    },
    scaleTag(distance) {
      if (!tag) return;
      tag.visible = distance < 45;
    },
    dispose() {
      group.traverse((o) => {
        if (o.geometry && o.geometry !== G.box) o.geometry.dispose();
      });
      if (tag) { tag.material.map.dispose(); tag.material.dispose(); }
    },
  };
}
