import * as THREE from 'three';
import { castLook } from '/shared/looks.js';
import { pbr } from './gfx/materials.js';
import { mergeParts } from './geo.js';
import { createCharacter, CHARACTER_BONES as B } from './character.js';

// Everybody who is not a player: hired hands, restaurant customers, casino
// regulars, people on the pavement. They are the same jointed characters as
// the players and the town's cast (character.js), dressed from a crowd look:
// the looks the server sends and saves (randomLook) are turned into
// character looks here, so old saves and old servers still work.

export const OUTFITS = ['work', 'tee', 'hawaii', 'suit', 'dress', 'chef', 'waiter', 'tourist', 'vest'];

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

function hashOf(obj) {
  const str = JSON.stringify(obj);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const BEARDS = ['full', 'goatee', 'stache', 'chin'];
const HAIRDOS = ['hair', 'hair', 'hair', 'slick', 'slick', 'bald'];
const EYES = ['#3a2a1a', '#4a6a8a', '#5a4030', '#35502f', '#2a1d14'];

/** A crowd look (randomLook, a worker's saved look) as a character look (character.js normalizeLook). */
export function characterLook(look = {}) {
  const o = look.outfit || 'work';
  const h = hashOf(look);
  const female = look.female ?? (o === 'dress' || (!!look.long && !look.beard && o !== 'chef'));
  const c = {
    outfit: 'street',
    skin: look.skin || '#e0ac80',
    hair: look.hair || '#2b1d14',
    color: look.shirt || '#2e86de',
    accent: '#1d1d1d',
    pants: look.pants,
    eyes: EYES[(h >>> 4) % EYES.length],
    face: 'young',
    beard: look.beard && !female ? BEARDS[h % BEARDS.length] : null,
    build: female ? 'female' : (look.build || 1) > 1.07 ? 'heavy' : undefined,
    long: female || !!look.long,
    shades: false,
  };
  const dress = {
    tee: { top: 'tee', legs: 'jeans', shoes: 'sneakers', pants: look.pants },
    hawaii: { top: 'hawaii', legs: 'shorts', shoes: 'sneakers', accent: '#fff27a' },
    suit: { top: 'suit', legs: 'slacks', shoes: 'dress', color: '#2d3436', pants: '#2d3436', accent: '#c0392b' },
    dress: { top: 'dress', legs: 'dress', shoes: 'dress', build: 'female', long: true, beard: null },
    tourist: { top: 'polo', legs: 'shorts', shoes: 'sneakers', camera: true, accent: '#f5f6fa' },
    work: { top: 'tee', legs: 'overalls', shoes: 'boots', pants: undefined },
    vest: { top: 'hivis', legs: 'jeans', shoes: 'boots', pants: undefined },
    chef: { top: 'chef', legs: 'slacks', shoes: 'dress', color: '#f4f2ee', pants: '#2d3436', apron: true },
    waiter: { top: 'waiter', legs: 'slacks', shoes: 'dress', color: '#f4f2ee', pants: '#1c1c21', apron: true },
  }[o] || { top: 'tee', legs: 'jeans', shoes: 'sneakers' };
  Object.assign(c, dress);
  const hat = o === 'chef' ? 'chef' : look.hat;
  const heads = { cap: 'cap', straw: 'straw', visor: 'visor', tophat: 'tophat', bandana: 'bandana', chef: 'chefhat' };
  if (heads[hat]) {
    c.head = heads[hat];
    if (look.hatColor) c.hatColor = look.hatColor;
  } else {
    c.head = c.long ? 'long' : HAIRDOS[(h >>> 8) % HAIRDOS.length];
    if (c.head === 'bald' && c.hair !== '#d9d6cf') c.head = 'hair';
  }
  if (c.build === 'female') c.beard = null;
  return c;
}

// Props held for different jobs, in the right hand (or level in front, for trays and pans).
const MAT = pbr(0xffffff, { vertexColors: true, roughness: 0.7 });
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
  ball: new THREE.SphereGeometry(0.5, 14, 10),
};
const LEVEL = { tray: [-0.16, -0.03, 0.42], pan: [0.14, -0.12, 0.42] };
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

// A soft round shadow under their feet, where they touch the ground.
const SHADOW_GEO = new THREE.CircleGeometry(0.34, 16).rotateX(-Math.PI / 2);
const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });

/**
 * Builds a person. `look` from randomLook() (or a worker's saved look), or
 * { cast: id } for one of the town's cast (shared/looks.js).
 * Returns { group, update(dt, moving, speed?), setPose(pose), setProp(kind),
 * setName, scaleTag, setDistance, dispose }.
 * Poses: 'stand', 'walk', 'work', 'sit', 'eat', 'cheer', 'play', 'cook', 'carry'.
 */
export function createPerson(look = {}, { name = null, tagColor = '#ffffff', tagScale = 0.36 } = {}) {
  const c = createCharacter(look.cast ? castLook(look.cast) : characterLook(look), { name, tagColor, tagScale });
  const group = c.group;
  // Some taller, some shorter.
  group.scale.setScalar((0.95 + ((look.build || 1) - 0.9) * 0.35) * (c.look.build === 'female' ? 0.95 : 1));
  if (c.label) { c.label.material.depthTest = true; c.label.visible = true; }
  const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
  shadow.position.y = 0.02;
  shadow.renderOrder = -1;
  group.add(shadow);

  let held = null;
  let heldKind = null;
  let pose = 'stand';

  function setProp(kind) {
    if ((kind || null) === heldKind) return;
    if (held) { held.parent.remove(held); held.geometry.dispose(); held = null; }
    heldKind = kind || null;
    if (!kind) return;
    held = prop(kind);
    if (!held) return;
    if (LEVEL[kind]) {
      held.position.set(...LEVEL[kind]);
      c.bones[B.chest].add(held);
    } else {
      held.position.set(0, -0.07, 0.02);
      c.bones[B.wristR].add(held);
    }
  }

  return {
    group,
    character: c,
    get pose() { return pose; },
    setPose(p) { pose = p; c.setPose(p); },
    setProp,
    setName(n) { c.setName(n); c.label.material.depthTest = true; },
    setDistance(d) { c.setDistance(d); },
    update(dt, moving, speed = 1.3) { c.update(dt, moving, false, moving ? speed : 0); },
    scaleTag(distance) {
      if (!c.label) return;
      c.scaleLabel(distance);
      c.label.visible = c.label.visible && distance < 45;
    },
    dispose() {
      if (held) { held.geometry.dispose(); held = null; }
      c.dispose();
    },
  };
}
