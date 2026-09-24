import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { plaidTexture, denimTexture, strawTexture, faceTexture, labelSprite } from './textures.js';
import { buildGun } from './guns.js';

// People with joints: hips, spine, chest, neck, head, shoulders, elbows,
// wrists, hips, knees and ankles (17 bones). Every body part is modelled
// rigidly on its bone and the lot is baked into ONE skinned mesh with one
// painted texture per outfit, so a whole person is a single draw call, and a
// street full of gang members stays cheap.
//
// A procedural animator poses the bones every frame: idle breathing, a walk
// that turns into a run and a sprint, rifle and pistol stances (the hands
// find the gun by two-bone IK), sitting behind a wheel, flinching when hit,
// and falling down dead.
//
// Characters face +Z, feet at y = 0, like the old avatars.

// ------------------------------------------------------------ skeleton

const B = {
  hips: 0, spine: 1, chest: 2, neck: 3, head: 4,
  shoulderL: 5, elbowL: 6, wristL: 7, shoulderR: 8, elbowR: 9, wristR: 10,
  hipL: 11, kneeL: 12, ankleL: 13, hipR: 14, kneeR: 15, ankleR: 16,
};
const BONES = [
  // name, parent, offset from the parent
  ['hips', null, [0, 0.94, 0]],
  ['spine', 'hips', [0, 0.1, 0]],
  ['chest', 'spine', [0, 0.2, 0]],
  ['neck', 'chest', [0, 0.27, 0]],
  ['head', 'neck', [0, 0.08, 0]],
  ['shoulderL', 'chest', [0.19, 0.21, 0]],
  ['elbowL', 'shoulderL', [0, -0.3, 0]],
  ['wristL', 'elbowL', [0, -0.27, 0]],
  ['shoulderR', 'chest', [-0.19, 0.21, 0]],
  ['elbowR', 'shoulderR', [0, -0.3, 0]],
  ['wristR', 'elbowR', [0, -0.27, 0]],
  ['hipL', 'hips', [0.1, -0.03, 0]],
  ['kneeL', 'hipL', [0, -0.44, 0]],
  ['ankleL', 'kneeL', [0, -0.41, 0]],
  ['hipR', 'hips', [-0.1, -0.03, 0]],
  ['kneeR', 'hipR', [0, -0.44, 0]],
  ['ankleR', 'kneeR', [0, -0.41, 0]],
];
const N = BONES.length;
const UPPER_ARM = 0.3;
const FOREARM = 0.27;
// Where each bone sits in the bind pose (standing, arms down), in body space.
const BIND = [];
for (const [, parent, off] of BONES) {
  const p = parent ? BIND[B[parent]] : [0, 0, 0];
  BIND.push([p[0] + off[0], p[1] + off[1], p[2] + off[2]]);
}

// ------------------------------------------------------------- outfits

/**
 * What someone looks like. Everything optional:
 *   outfit: 'farmer' | 'street' | 'biker' | 'track'
 *   color   main colour (shirt, tracksuit, bandana for gangs)
 *   accent  second colour (bandana, stripes)
 *   top:    'plaid' | 'tee' | 'tank' | 'hoodie' | 'jersey' | 'vest'
 *   legs:   'overalls' | 'jeans' | 'khaki' | 'track'
 *   head:   'straw' | 'flatcap' | 'cap' | 'cowboy' | 'capback' | 'beanie' | 'bandana' | 'helmet' | 'hair' | 'bald'
 *   face:   'old' | 'young'; beard: 'grey' | 'full' | 'goatee' | 'stache' | null; shades; mask
 *   skin:   a skin tone
 */
export function normalizeLook(look = {}) {
  const outfit = look.outfit || 'street';
  const base = {
    farmer: { top: 'plaid', legs: 'overalls', head: 'straw', face: 'old', beard: 'grey', shoes: 'boots' },
    street: { top: 'tee', legs: 'jeans', head: 'bandana', face: 'young', beard: null, shoes: 'sneakers' },
    biker: { top: 'vest', legs: 'jeans', head: 'bandana', face: 'young', beard: 'full', shoes: 'boots', shades: true },
    track: { top: 'jersey', legs: 'track', head: 'capback', face: 'young', beard: 'goatee', shoes: 'sneakers' },
  }[outfit] || {};
  return {
    outfit,
    color: '#b83a2c', accent: '#1d1d1d', skin: '#c98d68', hair: '#2a1d14', shades: false, mask: false,
    ...base,
    ...Object.fromEntries(Object.entries(look).filter(([, v]) => v !== undefined)),
  };
}

// The painted texture: one atlas per look, regions in pixels.
const ATLAS = 256;
const R = {
  shirt: [0, 0, 128, 128], pants: [128, 0, 128, 128], face: [0, 128, 128, 128],
  skin: [128, 128, 32, 32], shoe: [160, 128, 32, 32], hair: [192, 128, 32, 32], accent: [224, 128, 32, 32],
  hat: [128, 160, 64, 64], dark: [192, 160, 32, 32], sole: [224, 160, 32, 32], metal: [192, 192, 32, 32], leather: [224, 192, 32, 32],
  sleeve: [128, 224, 64, 32],
};

function seeded(key) {
  let s = 2166136261;
  for (let i = 0; i < key.length; i++) s = Math.imul(s ^ key.charCodeAt(i), 16777619);
  return () => {
    s = Math.imul(s ^ (s >>> 15), 2246822507);
    s = Math.imul(s ^ (s >>> 13), 3266489909);
    s ^= s >>> 16;
    return (s >>> 0) / 4294967296;
  };
}

function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}

function paintAtlas(look) {
  const rnd = seeded(JSON.stringify(look));
  const cv = document.createElement('canvas');
  cv.width = cv.height = ATLAS;
  const g = cv.getContext('2d');
  const fill = ([x, y, w, h], color, noise = 0.05, dots = 300) => {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
    for (let i = 0; i < dots * (w * h) / 16384; i++) {
      g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${rnd() * noise})` : `rgba(255,255,255,${rnd() * noise})`;
      g.fillRect(x + rnd() * w, y + rnd() * h, 2, 2);
    }
  };
  const image = ([x, y, w, h], tex) => g.drawImage(tex.image, x, y, w, h);

  // Shirt.
  const top = look.top;
  if (top === 'plaid') image(R.shirt, plaidTexture(look.color));
  else if (top === 'vest') fill(R.shirt, '#26211d', 0.06);               // a black tee under the vest
  else fill(R.shirt, look.color, 0.06, 500);
  if (top === 'jersey' || top === 'track') {
    // Tracksuit top: a zip and two stripes down the sleeves (the sleeve region).
    const [x, y, w, h] = R.shirt;
    g.fillStyle = shade(look.color, 0.6);
    g.fillRect(x + w / 2 - 1, y, 2, h);
  }
  if (top === 'jersey') {
    // A big number on the back.
    const [x, y, w, h] = R.shirt;
    g.fillStyle = look.accent;
    g.font = 'bold 40px Impact, sans-serif';
    g.textAlign = 'center';
    g.fillText(String(1 + Math.floor(rnd() * 98)), x + w * 0.02, y + h * 0.68);
    g.fillText(String(1 + Math.floor(rnd() * 98)), x + w * 1.02, y + h * 0.68);
  }
  // Sleeves: same as the shirt, with stripes for tracksuits.
  {
    const [x, y, w, h] = R.sleeve;
    if (top === 'plaid') g.drawImage(plaidTexture(look.color).image, x, y, w, h);
    else fill(R.sleeve, top === 'vest' ? '#26211d' : look.color, 0.06);
    if (top === 'jersey') {
      g.fillStyle = look.accent;
      g.fillRect(x + w * 0.2, y, 3, h);
      g.fillRect(x + w * 0.2 + 6, y, 3, h);
    }
  }

  // Trousers.
  if (look.legs === 'overalls' || look.legs === 'jeans') image(R.pants, denimTexture());
  else if (look.legs === 'khaki') fill(R.pants, '#b59b6c', 0.07, 600);
  else fill(R.pants, look.legs === 'track' ? look.color : '#2d2d33', 0.05, 400);
  if (look.legs === 'track') {
    const [x, y, w, h] = R.pants;
    g.fillStyle = look.accent;
    for (const u of [0.24, 0.74]) { g.fillRect(x + w * u, y, 3, h); g.fillRect(x + w * u + 6, y, 3, h); }
  }

  fill(R.skin, look.skin, 0.05, 200);
  fill(R.shoe, look.shoes === 'sneakers' ? '#e8e6e0' : '#3a2616', 0.08);
  fill(R.sole, look.shoes === 'sneakers' ? '#c8c2b8' : '#1b1512', 0.04);
  fill(R.hair, look.beard === 'grey' ? '#d9d6cf' : look.hair, 0.12, 900);
  fill(R.accent, look.accent, 0.08, 600);
  fill(R.dark, '#18171a', 0.04);
  fill(R.metal, '#c9a24a', 0.15);
  fill(R.leather, '#3b2b20', 0.12, 700);
  if (look.head === 'straw') image(R.hat, strawTexture());
  else if (look.head === 'cowboy') fill(R.hat, '#7a5230', 0.1, 600);
  else if (look.head === 'helmet') fill(R.hat, '#141416', 0.05);
  else if (look.head === 'flatcap') image(R.hat, plaidTexture('#6a5a48'));
  else fill(R.hat, look.head === 'bandana' || look.head === 'beanie' ? look.accent : look.color, 0.08, 500);
  if (look.head === 'bandana') {
    // Paisley-ish dots on the bandana.
    const [x, y, w, h] = R.hat;
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 26; i++) { g.beginPath(); g.arc(x + rnd() * w, y + rnd() * h, 1 + rnd() * 2, 0, 7); g.fill(); }
    const [ax, ay, aw, ah] = R.accent;
    for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(ax + rnd() * aw, ay + rnd() * ah, 1 + rnd(), 0, 7); g.fill(); }
  }

  // The face.
  if (look.face === 'old') image(R.face, faceTexture(look.skin));
  else drawYoungFace(g, R.face, look, rnd);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A younger face, painted: brows, eyes, stubble, maybe shades. */
function drawYoungFace(g, [x, y, w, h], look, rnd) {
  const k = w / 256;
  const X = (v) => x + v * k;
  const Y = (v) => y + v * k;
  g.fillStyle = look.skin;
  g.fillRect(x, y, w, h);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(0,0,0,${rnd() * 0.05})`;
    g.fillRect(x + rnd() * w, y + rnd() * h, 2, 2);
  }
  // Hairline at the top of the head.
  g.fillStyle = look.hair;
  g.fillRect(x, y, w, 60 * k);
  // Stubble or a beard round the jaw.
  if (look.beard) {
    g.fillStyle = look.beard === 'goatee' || look.beard === 'stache' ? look.hair : `${look.hair}`;
    g.globalAlpha = look.beard === 'full' ? 0.95 : 0.9;
    if (look.beard === 'full') g.fillRect(X(70), Y(160), 116 * k, 70 * k);
    if (look.beard === 'goatee') g.fillRect(X(112), Y(186), 32 * k, 30 * k);
    g.fillRect(X(100), Y(170), 56 * k, 8 * k);                            // moustache
    g.globalAlpha = 1;
  } else {
    g.fillStyle = 'rgba(40,30,25,0.18)';
    g.fillRect(X(76), Y(168), 104 * k, 50 * k);
  }
  // Eyes and brows.
  for (const ex of [96, 160]) {
    if (look.shades) {
      g.fillStyle = '#0c0c10';
      g.fillRect(X(ex - 20), Y(108), 40 * k, 20 * k);
    } else {
      g.fillStyle = '#f4efe6';
      g.beginPath(); g.ellipse(X(ex), Y(118), 12 * k, 6 * k, 0, 0, 7); g.fill();
      g.fillStyle = '#3a2a1a';
      g.beginPath(); g.arc(X(ex), Y(118), 5 * k, 0, 7); g.fill();
    }
    g.fillStyle = look.hair;
    g.fillRect(X(ex - 18), Y(98), 36 * k, 7 * k);
  }
  if (look.shades) { g.fillStyle = '#0c0c10'; g.fillRect(X(116), Y(112), 24 * k, 4 * k); }
  // Nose shadow and a mouth.
  g.fillStyle = 'rgba(110,50,40,0.3)';
  g.beginPath(); g.moveTo(X(128), Y(120)); g.lineTo(X(118), Y(158)); g.lineTo(X(138), Y(158)); g.closePath(); g.fill();
  g.fillStyle = 'rgba(90,30,30,0.7)';
  g.fillRect(X(110), Y(180), 36 * k, 4 * k);
}

// ------------------------------------------------------------ geometry

/** Builds the body for a look's shape: a list of parts, merged and skinned. */
function buildGeometry(look) {
  const parts = [];
  const add = (bone, geo, paint, o = {}) => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(o.x || 0, o.y || 0, o.z || 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0)),
      new THREE.Vector3(o.sx || 1, o.sy || 1, o.sz || 1),
    );
    geo.applyMatrix4(m);
    parts.push({ bone: B[bone], geo, paint });
  };
  const cyl = (rt, rb, h, seg = 9) => new THREE.CylinderGeometry(rt, rb, h, seg);
  const sph = (r, ws = 10, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
  const boxg = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  const bulky = look.outfit === 'farmer';
  const sleeves = { plaid: 'rolled', tee: 'short', tank: 'none', hoodie: 'long', jersey: 'long', vest: 'short' }[look.top] || 'short';

  // Hips and belly.
  add('hips', cyl(0.165, 0.16, 0.2, 10), 'pants', { y: -0.02, sz: 0.74 });
  add('spine', cyl(bulky ? 0.2 : 0.17, 0.165, 0.24, 10), look.legs === 'overalls' ? 'pants' : 'shirt', { y: 0.1, sz: bulky ? 0.82 : 0.72 });
  if (bulky) add('spine', sph(0.19, 10, 8), 'pants', { y: 0.08, z: 0.03, sy: 0.8, sz: 0.8 });   // a belly
  // Chest: broad at the shoulders.
  add('chest', cyl(0.21, bulky ? 0.2 : 0.175, 0.3, 10), 'shirt', { y: 0.1, sz: 0.66 });
  add('chest', cyl(0.12, 0.21, 0.07, 10), 'shirt', { y: 0.285, sz: 0.62 });                     // shoulders slope
  if (look.legs === 'overalls') {
    add('chest', boxg(0.24, 0.2, 0.03), 'pants', { y: 0.07, z: 0.125 });                          // bib
    for (const s of [-1, 1]) {
      add('chest', boxg(0.045, 0.3, 0.03), 'pants', { x: s * 0.1, y: 0.2, z: 0.03, rx: -0.4 });
      add('chest', cyl(0.014, 0.014, 0.012, 6), 'metal', { x: s * 0.1, y: 0.15, z: 0.14, rx: Math.PI / 2 });
    }
  }
  if (look.top === 'vest') {
    // Leather cut-off vest over the tee, open at the front.
    for (const s of [-1, 1]) add('chest', boxg(0.14, 0.34, 0.26), 'leather', { x: s * 0.11, y: 0.1, z: -0.005, sz: 1 });
    add('chest', boxg(0.36, 0.32, 0.04), 'leather', { y: 0.1, z: -0.12 });
  }
  if (look.top === 'hoodie') add('chest', sph(0.13, 10, 6), 'shirt', { y: 0.28, z: -0.1, sx: 1.3, sy: 0.6 });   // hood
  if (look.top === 'jersey') add('chest', cyl(0.085, 0.09, 0.05, 8), 'shirt', { y: 0.31 });                   // collar
  add('neck', cyl(0.058, 0.065, 0.12, 8), 'skin', { y: 0.03 });

  // Head: the painted face on a slightly long skull, nose and ears.
  const skull = sph(0.12, 14, 12);
  skull.rotateY(-Math.PI / 2);
  add('head', skull, 'face', { y: 0.12, sy: 1.14, sz: 1.06 });
  add('head', new THREE.ConeGeometry(0.022, 0.055, 5), 'skin', { y: 0.11, z: 0.125, rx: Math.PI / 2 });
  for (const s of [-1, 1]) add('head', sph(0.028, 6, 5), 'skin', { x: s * 0.12, y: 0.12, sx: 0.5, sz: 0.8 });
  // Beards.
  if (look.beard === 'grey' || look.beard === 'full') {
    add('head', new THREE.SphereGeometry(0.105, 10, 8, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.55), 'hair', { y: 0.07, z: 0.03, sx: 1.05, sy: 1.1 });
    add('head', boxg(0.1, 0.022, 0.03), 'hair', { y: 0.075, z: 0.125 });
  } else if (look.beard === 'goatee') {
    add('head', boxg(0.05, 0.05, 0.03), 'hair', { y: 0.02, z: 0.105 });
  }
  if (look.mask) {
    // A bandana over the nose and mouth, outlaw style.
    add('head', new THREE.CylinderGeometry(0.126, 0.118, 0.09, 12, 1, true), 'accent', { y: 0.08, z: 0.006, sz: 1.08 });
    add('head', new THREE.ConeGeometry(0.07, 0.1, 4), 'accent', { y: 0.02, z: 0.09, rx: Math.PI, sz: 0.4 });
  }
  if (look.shades) add('head', boxg(0.2, 0.035, 0.02), 'dark', { y: 0.135, z: 0.118 });

  // Headwear.
  const hatY = 0.21;
  switch (look.head) {
    case 'straw':
      add('head', cyl(0.3, 0.32, 0.02, 16), 'hat', { y: hatY + 0.02, rx: 0.04 });
      add('head', cyl(0.13, 0.15, 0.13, 12), 'hat', { y: hatY + 0.09 });
      add('head', cyl(0.152, 0.152, 0.035, 12), 'accent', { y: hatY + 0.05 });
      break;
    case 'cowboy':
      add('head', cyl(0.28, 0.28, 0.018, 16), 'hat', { y: hatY + 0.02, sz: 0.8 });
      add('head', cyl(0.11, 0.14, 0.14, 12), 'hat', { y: hatY + 0.09 });
      add('head', cyl(0.142, 0.142, 0.03, 12), 'accent', { y: hatY + 0.04 });
      break;
    case 'cap':
    case 'capback': {
      const back = look.head === 'capback' ? Math.PI : 0;
      add('head', new THREE.SphereGeometry(0.128, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 'hat', { y: hatY - 0.04, sy: 0.75, sz: 1.08 });
      add('head', boxg(0.18, 0.012, 0.1), 'hat', { y: hatY - 0.035, z: back ? -0.16 : 0.16, rx: back ? -0.1 : 0.1 });
      break;
    }
    case 'flatcap':
      // Flat tweed cap with a short peak.
      add('head', new THREE.SphereGeometry(0.145, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 'hat', { y: hatY + 0.0, z: 0.01, sx: 1.05, sy: 0.5, sz: 1.15 });
      add('head', boxg(0.2, 0.015, 0.09), 'hat', { y: hatY + 0.005, z: 0.16, rx: 0.15 });
      break;
    case 'beanie':
      add('head', new THREE.SphereGeometry(0.13, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.55), 'hat', { y: hatY - 0.05, sy: 1.0, sz: 1.06 });
      break;
    case 'bandana':
      // Tied round the head, the knot and tails at the back.
      add('head', new THREE.SphereGeometry(0.127, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.5), 'hat', { y: hatY - 0.045, sy: 0.85, sz: 1.07 });
      add('head', boxg(0.05, 0.1, 0.02), 'hat', { y: hatY - 0.09, z: -0.13, rx: 0.3 });
      break;
    case 'helmet':
      add('head', new THREE.SphereGeometry(0.14, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.52), 'hat', { y: hatY - 0.05, sz: 1.08 });
      break;
    case 'hair':
      add('head', new THREE.SphereGeometry(0.126, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.45), 'hair', { y: hatY - 0.05, sz: 1.07 });
      break;
    default:
      break;
  }

  // Arms: upper arm, elbow, forearm, hand.
  for (const s of ['L', 'R']) {
    const up = sleeves === 'none' ? 'skin' : 'sleeve';
    const fore = sleeves === 'long' ? 'sleeve' : 'skin';
    add(`shoulder${s}`, sph(0.075, 8, 6), look.top === 'tank' ? 'skin' : 'shirt', { y: -0.01 });
    add(`shoulder${s}`, cyl(0.066, 0.056, UPPER_ARM, 8), up, { y: -UPPER_ARM / 2 });
    if (sleeves === 'rolled') add(`shoulder${s}`, cyl(0.07, 0.07, 0.05, 8), 'sleeve', { y: -UPPER_ARM + 0.02 });
    if (sleeves === 'short') add(`shoulder${s}`, cyl(0.07, 0.066, 0.12, 8), 'sleeve', { y: -0.06 });
    add(`elbow${s}`, sph(0.052, 7, 5), fore === 'skin' && sleeves !== 'rolled' ? 'skin' : 'sleeve');
    add(`elbow${s}`, cyl(0.051, 0.042, FOREARM, 8), fore, { y: -FOREARM / 2 });
    add(`wrist${s}`, boxg(0.075, 0.1, 0.042), 'skin', { y: -0.05 });
    add(`wrist${s}`, boxg(0.022, 0.05, 0.025), 'skin', { x: (s === 'L' ? -1 : 1) * 0.035, y: -0.04, z: 0.025, rz: (s === 'L' ? -1 : 1) * 0.3 });
  }

  // Legs: thigh, knee, shin, boot.
  for (const s of ['L', 'R']) {
    add(`hip${s}`, cyl(0.09, 0.07, 0.44, 9), 'pants', { y: -0.22 });
    add(`knee${s}`, sph(0.068, 7, 5), 'pants');
    add(`knee${s}`, cyl(0.066, 0.056, 0.4, 9), 'pants', { y: -0.2 });
    add(`ankle${s}`, boxg(0.115, 0.08, 0.25), 'shoe', { y: -0.025, z: 0.05 });
    add(`ankle${s}`, boxg(0.12, 0.022, 0.26), 'sole', { y: -0.066, z: 0.05 });
    if (look.shoes === 'boots') add(`ankle${s}`, cyl(0.064, 0.06, 0.12, 8), 'shoe', { y: 0.04 });
  }

  // Into body space, painted from the atlas, weighted fully to their bone.
  const geos = parts.map(({ bone, geo, paint }) => {
    const g = geo.index ? geo : geo;
    const [bx, by, bz] = BIND[bone];
    g.translate(bx, by, bz);
    const [x, y, w, h] = R[paint];
    const pad = 1.5;
    const u0 = (x + pad) / ATLAS;
    const u1 = (x + w - pad) / ATLAS;
    const v1 = 1 - (y + pad) / ATLAS;
    const v0 = 1 - (y + h - pad) / ATLAS;
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    const n = g.attributes.position.count;
    const idx = new Uint16Array(n * 4);
    const wgt = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { idx[i * 4] = bone; wgt[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wgt, 4));
    return g;
  });
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return merged;
}

const shapeCache = new Map();
const materialCache = new Map();

function shapeKey(l) {
  return [l.outfit, l.top, l.legs, l.head, l.beard, l.shoes, l.shades ? 1 : 0, l.mask ? 1 : 0].join('/');
}

function geometryFor(look) {
  const k = shapeKey(look);
  if (!shapeCache.has(k)) shapeCache.set(k, buildGeometry(look));
  return shapeCache.get(k);
}

function materialFor(look) {
  const k = JSON.stringify(look);
  if (!materialCache.has(k)) {
    materialCache.set(k, new THREE.MeshLambertMaterial({ map: paintAtlas(look) }));
  }
  return materialCache.get(k);
}

// ------------------------------------------------------------ animation

const tq = new THREE.Quaternion();
const te = new THREE.Euler();
const tv = new THREE.Vector3();
const tv2 = new THREE.Vector3();
const tv3 = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const UPPER = [B.spine, B.chest, B.neck, B.head];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function setE(pose, i, x, y = 0, z = 0) {
  te.set(x, y, z, 'XYZ');
  pose[i].setFromEuler(te);
}

/**
 * Two-bone IK for an arm in chest space: puts the wrist on `target`, the elbow
 * bending towards `pole`. Writes shoulder and elbow rotations into `pose`.
 */
function armIK(pose, side, target, pole) {
  const s = BONES[side === 'L' ? B.shoulderL : B.shoulderR][2];
  const shoulder = tv.set(s[0], s[1], s[2]);
  const d = tv2.copy(target).sub(shoulder);
  const len = clamp(d.length(), Math.abs(UPPER_ARM - FOREARM) + 0.02, UPPER_ARM + FOREARM - 0.002);
  d.normalize();
  // Law of cosines: the angle at the shoulder between the reach and the upper arm.
  const cosA = clamp((UPPER_ARM * UPPER_ARM + len * len - FOREARM * FOREARM) / (2 * UPPER_ARM * len), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const bend = tv3.copy(pole).addScaledVector(d, -pole.dot(d));
  if (bend.lengthSq() < 1e-6) bend.set(0, -1, 0).addScaledVector(d, d.y);
  bend.normalize();
  const upperDir = d.clone().multiplyScalar(cosA).addScaledVector(bend, sinA).normalize();
  const iS = side === 'L' ? B.shoulderL : B.shoulderR;
  const iE = iS + 1;
  pose[iS].setFromUnitVectors(DOWN, upperDir);
  // The forearm, in the upper arm's frame.
  const elbow = shoulder.clone().addScaledVector(upperDir, UPPER_ARM);
  const fore = target.clone().sub(elbow);
  fore.setLength(1).applyQuaternion(tq.copy(pose[iS]).invert());
  pose[iE].setFromUnitVectors(DOWN, fore);
  pose[iE + 1].identity();
}

/** Where the chest bone is, and how it is turned, in body space, for a pose. */
function chestFrame(pose, hipsPos, outPos, outQuat) {
  outQuat.copy(pose[B.hips]);
  outPos.copy(hipsPos);
  tv.set(...BONES[B.spine][2]).applyQuaternion(outQuat);
  outPos.add(tv);
  outQuat.multiply(pose[B.spine]);
  tv.set(...BONES[B.chest][2]).applyQuaternion(outQuat);
  outPos.add(tv);
  outQuat.multiply(pose[B.chest]);
}

// ------------------------------------------------------------ character

/**
 * A person. `look` as for normalizeLook(); `name` puts a tag over their head.
 * Call update() every frame with how they are moving.
 */
export function createCharacter(lookIn = {}, { name = null, tagColor = '#ffffff', tagScale = 0.5 } = {}) {
  const look = normalizeLook(lookIn);
  const group = new THREE.Group();
  const bones = [];
  for (const [bname, parent, off] of BONES) {
    const b = new THREE.Bone();
    b.name = bname;
    b.position.set(off[0], off[1], off[2]);
    if (parent) bones[B[parent]].add(b);
    bones.push(b);
  }
  const mesh = new THREE.SkinnedMesh(geometryFor(look), materialFor(look));
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));
  // Bounds generous enough for any pose (and cheap: never recomputed).
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.5);
  group.add(mesh);

  let label = null;
  if (name) {
    label = labelSprite(name, tagColor, tagScale);
    label.position.y = 2.35;
    label.userData.base = { x: label.scale.x, y: label.scale.y };
    group.add(label);
  }

  // Cigar in the corner of the mouth; hidden until one is bought.
  const cigar = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.14, 6), new THREE.MeshLambertMaterial({ color: 0x5b3a1e }));
  stick.rotation.set(0, -0.4, Math.PI / 2);
  cigar.add(stick);
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff7a2a }));
  ember.position.set(0.065, 0, 0.03);
  cigar.add(ember);
  cigar.position.set(0.04, 0.05, 0.13);
  cigar.visible = false;
  bones[B.head].add(cigar);
  const cigarTip = new THREE.Object3D();
  cigarTip.position.set(0.075, 0, 0.035);
  cigar.add(cigarTip);

  // State.
  const pose = Array.from({ length: N }, () => new THREE.Quaternion());
  const armFK = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
  const hipsPos = new THREE.Vector3(0, BIND[B.hips][1], 0);
  const w = { move: 0, run: 0, hold: 0, aim: 0, seat: 0, dead: 0 };
  let phase = Math.random() * Math.PI * 2;
  let t = Math.random() * 10;
  let seated = false;
  let aiming = false;
  let aimPitch = 0;
  let steer = 0;
  let deadT = -1;
  let kick = 0;
  const flinch = new THREE.Vector2();
  let gun = null;
  let gunKind = null;
  let lodSkip = 0;
  let lodEvery = 1;
  const chestPos = new THREE.Vector3();
  const chestQuat = new THREE.Quaternion();
  const gunPos = new THREE.Vector3();
  const gunQuat = new THREE.Quaternion();

  function locomotion(k, run) {
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const legA = (0.42 + 0.38 * run) * k;
    const thighL = -s * legA;
    const thighR = s * legA;
    const kneeAmp = (0.55 + 0.75 * run) * k;
    const kneeL = 0.06 + Math.max(0, c) * kneeAmp + 0.12 * k;
    const kneeR = 0.06 + Math.max(0, -c) * kneeAmp + 0.12 * k;
    setE(pose, B.hipL, thighL, 0, 0.02);
    setE(pose, B.hipR, thighR, 0, -0.02);
    setE(pose, B.kneeL, kneeL);
    setE(pose, B.kneeR, kneeR);
    setE(pose, B.ankleL, -(thighL + kneeL) * 0.65 + 0.05 * k);
    setE(pose, B.ankleR, -(thighR + kneeR) * 0.65 + 0.05 * k);
    // Hips turn with the legs, the shoulders against them; lean into a run.
    const lean = 0.03 + (0.06 + 0.2 * run) * k;
    setE(pose, B.hips, 0, s * 0.1 * k, c * 0.035 * k);
    setE(pose, B.spine, lean * 0.5, -s * 0.06 * k, 0);
    setE(pose, B.chest, lean * 0.5 + Math.sin(t * 1.4) * 0.012 * (1 - k), -s * (0.1 + 0.08 * run) * k, 0);
    setE(pose, B.neck, -lean * 0.5, s * 0.08 * k, 0);
    setE(pose, B.head, -lean * 0.3 + Math.sin(t * 0.37) * 0.03 * (1 - k), Math.sin(t * 0.23) * 0.12 * (1 - k), 0);
    // Arms swing against the legs, elbows bending more as you speed up.
    const armA = (0.3 + 0.55 * run) * k;
    const out = 0.07 + 0.08 * run * k;
    setE(armFK, 0, s * armA, 0, out);
    setE(armFK, 1, -(0.15 + 0.95 * run * k) - Math.max(0, -s) * 0.35 * k);
    setE(armFK, 3, -s * armA, 0, -out);
    setE(armFK, 4, -(0.15 + 0.95 * run * k) - Math.max(0, s) * 0.35 * k);
    armFK[2].identity();
    armFK[5].identity();
    hipsPos.set(0, BIND[B.hips][1] + (Math.abs(c) - 0.6) * (0.035 + 0.05 * run) * k - 0.03 * run * k, 0);
  }

  function blendArms(weight) {
    // The hanging/swinging arms, blended over whatever the upper body did.
    const idx = [B.shoulderL, B.elbowL, B.wristL, B.shoulderR, B.elbowR, B.wristR];
    for (let i = 0; i < 6; i++) pose[idx[i]].slerp(armFK[i], weight);
  }

  function seatedPose() {
    const k = w.seat;
    const tgt = (i, x, y = 0, z = 0) => { te.set(x, y, z); tq.setFromEuler(te); pose[i].slerp(tq, k); };
    tgt(B.hipL, -1.5, 0.06, 0.05);
    tgt(B.hipR, -1.5, -0.06, -0.05);
    tgt(B.kneeL, 1.45);
    tgt(B.kneeR, 1.45);
    tgt(B.ankleL, 0.05);
    tgt(B.ankleR, 0.05);
    tgt(B.hips, 0);
    tgt(B.spine, -0.06);
    tgt(B.chest, -0.04);
    tgt(B.neck, 0.08, steer * 0.15);
    // Seated, the character stands on the seat: sat on it, the hips drop to
    // just above it (the vehicles' seat points are the cushion).
    hipsPos.y += (0.12 - hipsPos.y) * k;
  }

  function gunPose() {
    // How the upper body stands to hold the gun, in body space.
    const aim = w.aim;
    const hold = Math.max(w.hold, aim);
    if (hold <= 0.001) return;
    const pistol = gunKind === 'pistol';
    const blade = pistol ? 0.15 : 0.5;               // the left shoulder forward for a rifle
    const p = aimPitch * aim;
    const tgt = (i, x, y = 0, z = 0) => { te.set(x, y, z); tq.setFromEuler(te); pose[i].slerp(tq, hold); };
    tgt(B.spine, -p * 0.25 + 0.02, -blade * 0.4, 0);
    tgt(B.chest, -p * 0.3 + 0.02 - kick * 0.06, -blade * 0.6, 0);
    tgt(B.neck, -p * 0.2, blade * 0.5, 0);
    tgt(B.head, -p * 0.2 + 0.08 * aim, blade * 0.45, 0.1 * aim);
  }

  function placeGun() {
    if (!gun) return;
    const aim = w.aim;
    const hold = Math.max(w.hold, aim);
    gun.visible = hold > 0.3 && !seated && w.dead < 0.5;
    if (!gun.visible) return;
    const pistol = gunKind === 'pistol';
    // Body-space grip position and direction: aimed (at the shoulder, along
    // the aim), or held low across the body.
    const pitch = aimPitch * aim;
    const aimPos = pistol ? tv.set(-0.08, 1.42 + pitch * 0.25, 0.52) : tv.set(-0.1, 1.44 + pitch * 0.1, 0.34);
    const lowPos = pistol ? tv2.set(-0.26, 0.88, 0.12) : tv2.set(-0.12, 1.08, 0.3);
    gunPos.copy(lowPos).lerp(aimPos, aim);
    gunPos.z -= kick * 0.05;
    const lowPitch = pistol ? 1.1 : 0.45;
    const lowYaw = pistol ? 0 : 0.5;
    te.set(-(pitch + kick * 0.12) * aim + lowPitch * (1 - aim), Math.PI + lowYaw * (1 - aim), 0, 'YXZ');
    gunQuat.setFromEuler(te);
    // Into the chest's frame.
    chestFrame(pose, hipsPos, chestPos, chestQuat);
    const inv = tq.copy(chestQuat).invert();
    gun.position.copy(gunPos).sub(chestPos).applyQuaternion(inv);
    gun.quaternion.copy(inv).multiply(gunQuat);
    // Hands on it: right on the grip, left under the barrel (or cupping the pistol grip).
    const right = gun.position.clone();
    const left = gun.userData.left.clone().applyQuaternion(gun.quaternion).add(gun.position);
    armIK(pose, 'R', right, new THREE.Vector3(-0.6, -1, -0.4));
    armIK(pose, 'L', left, new THREE.Vector3(0.7, -1, -0.2));
  }

  function wheelHands() {
    // Hands at ten to two, turning with the steering.
    const k = w.seat;
    if (k < 0.01) return;
    const saved = pose.slice(B.shoulderL, B.wristR + 1).map((q) => q.clone());
    const a = steer * 0.6;
    const r = 0.17;
    armIK(pose, 'L', new THREE.Vector3(Math.cos(0.5 + a) * r, 0.02 + Math.sin(0.5 + a) * r, 0.42), new THREE.Vector3(0.8, -1, -0.3));
    armIK(pose, 'R', new THREE.Vector3(-Math.cos(0.5 - a) * r, 0.02 + Math.sin(0.5 - a) * r, 0.42), new THREE.Vector3(-0.8, -1, -0.3));
    for (let i = 0; i < saved.length; i++) pose[B.shoulderL + i].copy(saved[i].slerp(pose[B.shoulderL + i], k));
  }

  function deadPose() {
    // Knocked flat on the back: falls fast, like it should.
    const k = w.dead;
    if (k <= 0) return;
    const tgt = (i, x, y = 0, z = 0) => { te.set(x, y, z); tq.setFromEuler(te); pose[i].slerp(tq, k); };
    tgt(B.hips, -1.5, 0.2, 0.15);
    tgt(B.spine, -0.05);
    tgt(B.chest, -0.05, 0.1);
    tgt(B.neck, 0.1, 0.3);
    tgt(B.head, 0.1, 0.5);
    tgt(B.shoulderL, -0.3, 0, 1.3);
    tgt(B.shoulderR, 0.2, 0, -1.1);
    tgt(B.elbowL, -0.4);
    tgt(B.elbowR, -0.8);
    tgt(B.hipL, -0.15, 0, 0.25);
    tgt(B.hipR, 0.05, 0, -0.15);
    tgt(B.kneeL, 0.5);
    tgt(B.kneeR, 0.15);
    hipsPos.y += (0.16 - hipsPos.y) * k;
    hipsPos.z += (-0.2 - hipsPos.z) * k;
  }

  const api = {
    group,
    mesh,
    bones,
    look,
    head: bones[B.head],
    label,
    get seated() { return seated; },
    get dead() { return deadT >= 0; },
    setCigar(on) { cigar.visible = !!on; },
    hasCigar() { return cigar.visible; },
    tipWorld(target) { return cigarTip.getWorldPosition(target); },
    /** The gun in their hands (a catalog id), or none. */
    setGun(id) {
      if (gun && gun.userData.id === id) return;
      if (gun) { gun.parent.remove(gun); gun = null; gunKind = null; }
      if (!id) return;
      const built = buildGun(id);
      gun = built.group;
      gun.userData.id = id;
      gun.userData.left = built.left.clone().multiplyScalar(0.82);
      gun.userData.muzzle = built.muzzle;
      gun.scale.setScalar(0.82);
      gunKind = id === 'pistol' ? 'pistol' : 'rifle';
      bones[B.chest].add(gun);
    },
    /** World position of the muzzle (for tracers and flashes), if holding a gun. */
    muzzleWorld(target) { return gun ? gun.userData.muzzle.getWorldPosition(target) : null; },
    setAiming(v) { aiming = !!v; },
    setAimPitch(p) { aimPitch = clamp(p || 0, -1.2, 1.2); },
    setSteer(s) { steer = s || 0; },
    /** A shot fired: the gun kicks back. */
    fire() { kick = 1; },
    /** Hit from direction (dx, dz) in world space: a flinch. */
    hit(dx = 0, dz = 1) {
      const yaw = group.rotation.y;
      flinch.set(dx * Math.cos(yaw) - dz * Math.sin(yaw), dx * Math.sin(yaw) + dz * Math.cos(yaw)).normalize().multiplyScalar(0.35);
    },
    die() { if (deadT < 0) deadT = 0; },
    revive() { deadT = -1; w.dead = 0; },
    scaleLabel(distance) {
      if (!label) return;
      label.visible = distance > 2.0 && !seated;
      const k = Math.min(1, Math.max(0.3, distance / 7));
      label.scale.set(label.userData.base.x * k, label.userData.base.y * k, 1);
    },
    setVisible(v) { group.visible = v; },
    /** Far away people only animate every few frames. */
    setDistance(d) { lodEvery = d > 90 ? 4 : d > 45 ? 2 : 1; },
    /** Behind the wheel: a little smaller to fit the cabin, hands on the wheel. */
    setSeated(on) {
      if (on === seated) return;
      seated = on;
      group.scale.setScalar(on ? 0.85 : 1);
      w.seat = on ? 1 : 0;
      if (label) label.visible = !on;
    },
    /**
     * `moving`/`fast` for the old callers; `speed` (m/s) when known, for a
     * gait that matches how fast they really go.
     */
    update(dt, moving = false, fast = false, speed = null) {
      t += dt;
      const v = speed != null ? speed : moving ? (fast ? 12.5 : 7.2) : 0;
      // Weights ease, so every change of stance blends.
      const ease = (key, target, rate) => { w[key] += (target - w[key]) * Math.min(1, dt * rate); };
      ease('move', !seated && v > 0.4 ? Math.min(1, v / 2.5) : 0, 8);
      ease('run', clamp((v - 2.5) / 8, 0, 1), 4);
      ease('hold', gun && !seated ? 1 : 0, 8);
      ease('aim', gun && aiming && !seated ? 1 : 0, 12);
      if (deadT >= 0) { deadT += dt; w.dead = Math.min(1, (deadT / 0.55) ** 2); }
      kick = Math.max(0, kick - dt * 9);
      flinch.multiplyScalar(Math.max(0, 1 - dt * 6));
      // Strides: a full cycle (two steps) covers more ground the faster you go.
      const stride = 1.5 + 2.4 * w.run;
      phase += (v / stride) * Math.PI * 2 * dt;

      lodSkip = (lodSkip + 1) % lodEvery;
      if (lodSkip !== 0) return;

      locomotion(w.move, w.run);
      if (w.seat > 0) seatedPose();
      gunPose();
      // Arms: swinging, unless the hands are busy.
      for (const i of [B.shoulderL, B.elbowL, B.wristL, B.shoulderR, B.elbowR, B.wristR]) pose[i].identity();
      blendArms(1);
      if (gun && Math.max(w.hold, w.aim) > 0.01 && w.seat < 0.5) {
        const saved = pose.slice(B.shoulderL, B.wristR + 1).map((q) => q.clone());
        placeGun();
        const k = Math.max(w.hold, w.aim);
        for (let i = 0; i < saved.length; i++) pose[B.shoulderL + i].copy(saved[i].slerp(pose[B.shoulderL + i], k));
      } else if (gun) {
        gun.visible = false;
      }
      if (w.seat > 0) wheelHands();
      // A flinch rocks the upper body away from the hit.
      if (flinch.lengthSq() > 1e-5) {
        te.set(-flinch.y, 0, flinch.x);
        tq.setFromEuler(te);
        pose[B.chest].premultiply(tq);
      }
      deadPose();

      bones[B.hips].position.copy(hipsPos);
      for (let i = 0; i < N; i++) bones[i].quaternion.copy(pose[i]);
    },
    dispose() {
      // Geometry and materials are shared between everyone who looks alike.
      if (label) { label.material.map.dispose(); label.material.dispose(); }
      stick.geometry.dispose();
      ember.geometry.dispose();
    },
  };
  api.update(0.016);
  return api;
}

export { B as CHARACTER_BONES };
