import * as THREE from 'three';
import { pbr } from './gfx/materials.js';
import { plaidTexture, denimTexture, strawTexture, faceTexture, hawaiiTexture, leatherTexture, labelSprite } from './textures.js';
import { buildGun } from './guns.js';
import { mergeGeometries } from './merge.js';

// People with joints: hips, spine, chest, neck, head, shoulders, elbows,
// wrists, hips, knees and ankles (17 bones). Limbs are shaped tubes whose
// skin weights blend across the joints, so elbows and knees bend smoothly;
// the head is a sculpted skull (brow, sockets, nose, cheekbones, lips, jaw)
// with modelled eyes, ears, and hair and beards grown over it. The lot is
// baked into ONE skinned mesh with one painted texture per outfit (plus
// roughness and bump maps shared by kind of clothes), so a whole person is a
// single draw call; further off they wear a lighter body.
//
// A procedural animator poses the bones every frame: idle breathing, a walk
// that turns into a run and a sprint, rifle and pistol stances (the hands
// find the gun by two-bone IK), sitting behind a wheel, flinching when hit,
// falling down dead, and the crowd's jobs (working the soil, cooking,
// carrying a tray, sitting at a table, cheering a win).
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
 *   outfit: 'farmer' | 'street' | 'biker' | 'track', or one of the town's
 *           cast: 'flannel' | 'heavy' | 'pizza' | 'oldtimer' | 'tourist' |
 *           'agent' | 'cop' | 'leather' | 'bouncer'
 *   color   main colour (shirt, tracksuit, bandana for gangs)
 *   accent  second colour (bandana, stripes, tie)
 *   top:    'plaid' | 'tee' | 'tank' | 'hoodie' | 'jersey' | 'vest' | 'flannel' |
 *           'sweater' | 'polo' | 'shirt' | 'hawaii' | 'suit' | 'uniform' | 'leather' |
 *           'dress' | 'chef' | 'waiter' | 'hivis'
 *   legs:   'overalls' | 'jeans' | 'khaki' | 'track' | 'slacks' | 'baggy' | 'shorts' | 'dress'; pants: their colour
 *   head:   'straw' | 'flatcap' | 'cap' | 'cowboy' | 'capback' | 'beanie' | 'bandana' | 'helmet' | 'hair' |
 *           'bald' | 'thin' | 'slick' | 'braids' | 'skullcap' | 'peaked' | 'visor' | 'tophat' | 'chefhat' | 'long'
 *   long:   long hair (under any hat); apron; camera round the neck
 *   face:   'old' | 'young' | 'lined'; eyes: iris colour
 *   beard:  'grey' | 'full' | 'goatee' | 'stache' | 'chin' | null; shades; mask
 *   shoes:  'boots' | 'sneakers' | 'dress'
 *   build:  'heavy' for a big man, 'female'; chain: a chain round the neck
 *   logo:   what the print on the cap or chest shows: 'pizza' | 'badge' | 'id'
 *   skin:   a skin tone
 */
export function normalizeLook(look = {}) {
  const outfit = look.outfit || 'street';
  const base = {
    farmer: { top: 'plaid', legs: 'overalls', head: 'straw', face: 'old', beard: 'grey', shoes: 'boots' },
    street: { top: 'tee', legs: 'jeans', head: 'bandana', face: 'young', beard: null, shoes: 'sneakers' },
    biker: { top: 'vest', legs: 'jeans', head: 'bandana', face: 'young', beard: 'full', shoes: 'boots', shades: true },
    track: { top: 'jersey', legs: 'track', head: 'capback', face: 'young', beard: 'goatee', shoes: 'sneakers' },
    // The town's cast (see shared/looks.js).
    flannel: { top: 'flannel', legs: 'baggy', pants: '#c8b48a', head: 'braids', face: 'young', beard: null, shoes: 'sneakers' },
    heavy: { top: 'sweater', legs: 'slacks', pants: '#3a3d42', head: 'bandana', face: 'young', beard: 'goatee', shoes: 'sneakers', build: 'heavy' },
    pizza: { top: 'polo', legs: 'slacks', pants: '#2b2b30', head: 'cap', face: 'young', beard: null, shoes: 'sneakers', logo: 'pizza', color: '#f2c14e', accent: '#c0392b' },
    oldtimer: { top: 'shirt', legs: 'slacks', pants: '#4a4038', head: 'thin', face: 'lined', beard: null, shoes: 'dress', color: '#7a2a22', accent: '#e8c35a', hair: '#8a8078', eyes: '#5a4030' },
    tourist: { top: 'hawaii', legs: 'shorts', pants: '#c9b99a', head: 'bald', face: 'lined', beard: 'chin', shoes: 'sneakers', color: '#f5efe0', accent: '#e84393', hair: '#8f8a82' },
    agent: { top: 'suit', legs: 'slacks', pants: '#1f2638', head: 'slick', face: 'young', beard: null, shoes: 'dress', logo: 'id', color: '#1f2638', accent: '#2c3e66', eyes: '#4a6a8a' },
    cop: { top: 'uniform', legs: 'slacks', pants: '#1d2436', head: 'peaked', face: 'young', beard: 'stache', shoes: 'dress', logo: 'badge', color: '#2a3654', accent: '#1d2436' },
    leather: { top: 'leather', legs: 'jeans', head: 'skullcap', face: 'young', beard: 'full', shoes: 'boots', color: '#1b1a1c', accent: '#b8322a' },
    bouncer: { top: 'shirt', legs: 'slacks', pants: '#1c1c20', head: 'bald', face: 'lined', beard: 'chin', shoes: 'dress', shades: true, chain: true, color: '#18181b', accent: '#18181b', hair: '#a39d94', eyes: '#4a6a8a' },
  }[outfit] || {};
  return {
    outfit,
    color: '#b83a2c', accent: '#1d1d1d', skin: '#c98d68', hair: '#2a1d14', shades: false, mask: false,
    ...base,
    ...Object.fromEntries(Object.entries(look).filter(([, v]) => v !== undefined)),
  };
}

// The painted texture: one atlas per look, regions in pixels. The last row
// is for the town's cast: a white undershirt (and socks), a second trim
// colour, a tie, and a print (a logo, a badge or an ID card) for the cap or
// the chest.
const ATLAS_W = 256;
const ATLAS_H = 320;
const ATLAS_SCALE = 2;       // painted at twice the size the regions are given in
const R = {
  shirt: [0, 0, 128, 128], pants: [128, 0, 128, 128], face: [0, 128, 128, 128],
  skin: [128, 128, 32, 32], shoe: [160, 128, 32, 32], hair: [192, 128, 32, 32], accent: [224, 128, 32, 32],
  hat: [128, 160, 64, 64], dark: [192, 160, 32, 32], sole: [224, 160, 32, 32], metal: [192, 192, 32, 32], leather: [224, 192, 32, 32],
  sleeve: [128, 224, 64, 32],
  print: [0, 256, 64, 64], tee: [64, 256, 32, 32], trim: [96, 256, 32, 32], tie: [64, 288, 32, 32],
  eye: [96, 288, 32, 32],
};

// Tops whose shirt region is painted as one wrap round the torso: the chest,
// the belly and the shoulders each sample their own band of it, and the
// middle of the region is the front. Collars, ties and pockets land where
// they should, instead of repeating on every part.
const WRAP_TOPS = new Set(['flannel', 'sweater', 'polo', 'shirt', 'hawaii', 'suit', 'uniform', 'leather', 'dress', 'chef', 'waiter', 'hivis']);
// Tops that hang open over a white tee, and tops with a tail below the belt.
const OPEN_TOPS = new Set(['flannel', 'leather', 'hawaii']);
const HEM_TOPS = new Set(['flannel', 'suit', 'hawaii', 'shirt']);
const COLLAR_TOPS = new Set(['polo', 'shirt', 'hawaii', 'uniform']);
const HAIRLESS = new Set(['bald', 'thin', 'skullcap']);

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

/** Trouser colour: the look's own, or what that kind of trousers usually is. */
function pantsColor(look) {
  if (look.legs === 'dress') return look.color;
  if (look.pants) return look.pants;
  if (look.legs === 'khaki') return '#b59b6c';
  if (look.legs === 'track') return look.color;
  return '#2d2d33';
}

function paintAtlas(look) {
  const rnd = seeded(JSON.stringify(look));
  const cv = document.createElement('canvas');
  cv.width = ATLAS_W * ATLAS_SCALE;
  cv.height = ATLAS_H * ATLAS_SCALE;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.scale(ATLAS_SCALE, ATLAS_SCALE);
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
  if (WRAP_TOPS.has(top)) paintWrapTop(g, look, rnd, fill);
  else if (top === 'plaid') image(R.shirt, plaidTexture(look.color));
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
    if (top === 'plaid' || top === 'flannel') g.drawImage(plaidTexture(look.color).image, x, y, w, h);
    else if (top === 'hawaii') g.drawImage(hawaiiTexture(look.color, look.accent).image, x, y, w, h);
    else if (top === 'leather') g.drawImage(leatherTexture(look.color).image, 0, 0, 64, 32, x, y, w, h);
    else if (top === 'sweater') fill(R.sleeve, look.color, 0.1, 900);
    else fill(R.sleeve, top === 'vest' ? '#26211d' : look.color, 0.06);
    if (top === 'jersey') {
      g.fillStyle = look.accent;
      g.fillRect(x + w * 0.2, y, 3, h);
      g.fillRect(x + w * 0.2 + 6, y, 3, h);
    }
    if (top === 'polo') { g.fillStyle = look.accent; g.fillRect(x, y + h - 5, w, 5); }
    if (top === 'uniform') {
      // A shoulder patch on the outside of each arm.
      for (const u of [0.25, 0.75]) {
        g.fillStyle = '#c9a24a';
        g.beginPath(); g.ellipse(x + w * u, y + 9, 6, 7, 0, 0, 7); g.fill();
        g.fillStyle = shade(look.color, 0.7);
        g.beginPath(); g.ellipse(x + w * u, y + 9, 4, 5, 0, 0, 7); g.fill();
      }
    }
  }

  // Trousers.
  const pants = pantsColor(look);
  if ((look.legs === 'overalls' || look.legs === 'jeans') && !look.pants) image(R.pants, denimTexture());
  else if (look.legs === 'khaki' && !look.pants) fill(R.pants, '#b59b6c', 0.07, 600);
  else if (look.legs === 'slacks' || look.legs === 'baggy' || look.legs === 'shorts') {
    fill(R.pants, pants, 0.06, 700);
    // A crease down the front and a seam down the side.
    const [x, y, w, h] = R.pants;
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(x, y, 2, h); g.fillRect(x + w - 2, y, 2, h);
    g.fillStyle = 'rgba(0,0,0,0.14)';
    g.fillRect(x + w * 0.25 - 1, y, 2, h); g.fillRect(x + w * 0.75 - 1, y, 2, h);
  } else fill(R.pants, pants, 0.05, 400);
  if (look.legs === 'track') {
    const [x, y, w, h] = R.pants;
    g.fillStyle = look.accent;
    for (const u of [0.24, 0.74]) { g.fillRect(x + w * u, y, 3, h); g.fillRect(x + w * u + 6, y, 3, h); }
  }

  fill(R.skin, look.skin, 0.05, 200);
  const shoe = { sneakers: '#e8e6e0', dress: '#141215' }[look.shoes] || '#3a2616';
  fill(R.shoe, shoe, look.shoes === 'dress' ? 0.04 : 0.08);
  if (look.shoes === 'dress') {
    // Polished: a highlight across the toe.
    const [x, y, w, h] = R.shoe;
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(x, y + h * 0.3, w, h * 0.15);
  }
  fill(R.sole, look.shoes === 'sneakers' ? '#c8c2b8' : '#1b1512', 0.04);
  fill(R.hair, look.beard === 'grey' ? '#d9d6cf' : look.hair, 0.12, 900);
  fill(R.accent, look.accent, 0.08, 600);
  fill(R.dark, '#18171a', 0.04);
  fill(R.metal, '#c9a24a', 0.15);
  fill(R.leather, '#3b2b20', 0.12, 700);
  fill(R.tee, '#f1eee8', 0.05);
  fill(R.trim, top === 'polo' ? look.accent : top === 'hawaii' ? look.color : shade(look.color, 0.85), 0.06);
  fill(R.tie, look.accent, 0.06);
  if (top === 'suit') {
    // Diagonal stripes on the tie.
    const [x, y, w, h] = R.tie;
    g.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = -h; i < w; i += 8) { g.beginPath(); g.moveTo(x + i, y + h); g.lineTo(x + i + h, y); g.lineTo(x + i + h + 3, y); g.lineTo(x + i + 3, y + h); g.fill(); }
  }
  paintPrint(g, look);
  paintEye(g, look);

  if (look.head === 'straw') image(R.hat, strawTexture());
  else if (look.head === 'cowboy') fill(R.hat, '#7a5230', 0.1, 600);
  else if (look.head === 'helmet' || look.head === 'skullcap') fill(R.hat, '#141416', 0.05);
  else if (look.head === 'flatcap') image(R.hat, plaidTexture('#6a5a48'));
  else if (look.head === 'peaked') fill(R.hat, shade(look.color, 0.8), 0.05);
  else if (look.head === 'tophat') fill(R.hat, '#151518', 0.04);
  else if (look.head === 'chefhat') fill(R.hat, '#f6f4ef', 0.03);
  else if (look.head === 'visor') fill(R.hat, look.hatColor || '#ff6b81', 0.05);
  else fill(R.hat, look.hatColor || (look.head === 'bandana' || look.head === 'beanie' ? look.accent : look.color), 0.08, 500);
  if (look.head === 'cap' && look.logo === 'pizza') {
    // Two-tone: the front panels in the accent colour (a sphere's front is a quarter of the way round).
    const [x, y, w, h] = R.hat;
    g.fillStyle = look.accent;
    g.fillRect(x + w * 0.12, y, w * 0.26, h);
  }
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
  paintFaceHair(g, look);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * An eyeball, as wrapped round a sphere: the front (the iris) is a quarter of
 * the way across, halfway down. Squashed sideways, as the sphere stretches
 * the region twice as far round as it does top to bottom.
 */
function paintEye(g, look) {
  const [x, y, w, h] = R.eye;
  const grd = g.createRadialGradient(x + w * 0.25, y + h / 2, 1, x + w * 0.25, y + h / 2, w * 0.6);
  grd.addColorStop(0, '#f4f1ea');
  grd.addColorStop(0.6, '#e6ddd2');
  grd.addColorStop(1, '#c9a9a0');
  g.fillStyle = grd;
  g.fillRect(x, y, w, h);
  const cx = x + w * 0.25;
  const cy = y + h / 2;
  const iris = look.eyes || '#4a321f';
  g.fillStyle = shade(iris, 0.6);
  g.beginPath(); g.ellipse(cx, cy, w * 0.085, h * 0.17, 0, 0, 7); g.fill();
  g.fillStyle = iris;
  g.beginPath(); g.ellipse(cx, cy, w * 0.07, h * 0.14, 0, 0, 7); g.fill();
  g.fillStyle = '#0b0908';
  g.beginPath(); g.ellipse(cx, cy, w * 0.03, h * 0.06, 0, 0, 7); g.fill();
}

/**
 * A wrap-round top (see WRAP_TOPS). In the shirt region, u = 0.5 is the
 * middle of the chest, 0 and 1 the middle of the back; v = 0 is the top of
 * the shoulders and 1 the belt.
 */
function paintWrapTop(g, look, rnd, fill) {
  const [x, y, w, h] = R.shirt;
  const U = (u) => x + u * w;
  const V = (v) => y + v * h;
  const top = look.top;
  const rect = (u0, v0, u1, v1, color) => { g.fillStyle = color; g.fillRect(U(u0), V(v0), (u1 - u0) * w, (v1 - v0) * h); };
  // Both halves of something centred on the back seam.
  const back = (draw) => { g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); draw(x); draw(x + w); g.restore(); };

  if (top === 'flannel') g.drawImage(plaidTexture(look.color).image, x, y, w, h);
  else if (top === 'hawaii') g.drawImage(hawaiiTexture(look.color, look.accent).image, x, y, w, h);
  else if (top === 'leather') g.drawImage(leatherTexture(look.color).image, x, y, w, h);
  else fill(R.shirt, look.color, top === 'sweater' ? 0.1 : 0.06, top === 'sweater' ? 1400 : 500);

  // Soft folds, darker towards the sides: cheap volume.
  const sides = g.createLinearGradient(x, 0, x + w, 0);
  sides.addColorStop(0, 'rgba(0,0,0,0.10)');
  sides.addColorStop(0.3, 'rgba(0,0,0,0.0)');
  sides.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  sides.addColorStop(0.7, 'rgba(0,0,0,0.0)');
  sides.addColorStop(1, 'rgba(0,0,0,0.10)');
  g.fillStyle = sides;
  g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(0,0,0,0.08)';
  for (let i = 0; i < 5; i++) {
    const u = 0.28 + rnd() * 0.44;
    g.fillRect(U(u), V(0.55 + rnd() * 0.3), 6 + rnd() * 8, 2);
  }

  if (OPEN_TOPS.has(top)) {
    // Hanging open over a white tee, the edges a shade darker.
    const tee = '#f1eee8';
    rect(0.44, top === 'hawaii' ? 0.12 : 0.06, 0.56, 1, tee);
    g.fillStyle = 'rgba(0,0,0,0.06)';
    for (let i = 0; i < 40; i++) g.fillRect(U(0.44 + rnd() * 0.12), V(rnd()), 2, 2);
    rect(0.425, 0.06, 0.44, 1, 'rgba(0,0,0,0.35)');
    rect(0.56, 0.06, 0.575, 1, 'rgba(0,0,0,0.35)');
    if (top === 'leather') {
      // Zips down both edges, and a round neck on the tee.
      rect(0.43, 0.1, 0.438, 1, '#9a9ea4');
      rect(0.562, 0.1, 0.57, 1, '#9a9ea4');
      rect(0.44, 0.06, 0.56, 0.1, '#d8d4cc');
      // Lapels folded back either side of the opening.
      g.fillStyle = 'rgba(0,0,0,0.45)';
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(U(0.5 + s * 0.075), V(0.02)); g.lineTo(U(0.5 + s * 0.16), V(0.08)); g.lineTo(U(0.5 + s * 0.08), V(0.36)); g.closePath(); g.fill();
      }
      g.strokeStyle = 'rgba(255,255,255,0.15)';
      g.lineWidth = 1;
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(U(0.5 + s * 0.16), V(0.08)); g.lineTo(U(0.5 + s * 0.08), V(0.36)); g.stroke(); }
    }
  }
  if (top === 'sweater') {
    // Ribbed collar and hem.
    rect(0.4, 0, 0.6, 0.05, shade(look.color, 0.75));
    g.fillStyle = shade(look.color, 0.8);
    g.fillRect(x, V(0.9), w, h * 0.1);
    g.fillStyle = 'rgba(0,0,0,0.15)';
    for (let i = 0; i < w; i += 3) g.fillRect(x + i, V(0.9), 1, h * 0.1);
  }
  if (top === 'polo' || top === 'shirt' || top === 'uniform') {
    // Open neck and a button placket.
    g.fillStyle = top === 'uniform' ? '#15161a' : look.skin;
    g.beginPath(); g.moveTo(U(0.45), V(0.02)); g.lineTo(U(0.55), V(0.02)); g.lineTo(U(0.5), V(top === 'uniform' ? 0.1 : 0.2)); g.closePath(); g.fill();
    if (top === 'shirt' && look.outfit === 'oldtimer') {
      // A yellow vest under the shirt.
      g.fillStyle = look.accent;
      g.beginPath(); g.moveTo(U(0.47), V(0.1)); g.lineTo(U(0.53), V(0.1)); g.lineTo(U(0.5), V(0.2)); g.closePath(); g.fill();
    }
    rect(0.497, 0.2, 0.503, top === 'polo' ? 0.4 : 1, 'rgba(0,0,0,0.3)');
    g.fillStyle = 'rgba(255,255,255,0.6)';
    const buttons = top === 'polo' ? [0.28, 0.36] : [0.3, 0.45, 0.6, 0.75, 0.9];
    for (const v of buttons) { g.beginPath(); g.arc(U(0.51), V(v), 1.2, 0, 7); g.fill(); }
    if (top === 'shirt' && look.outfit !== 'bouncer') {
      // A faint check.
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let i = 0; i < w; i += 10) g.fillRect(x + i, y, 2, h);
      for (let i = 0; i < h; i += 10) g.fillRect(x, y + i, w, 2);
    }
  }
  if (top === 'polo') {
    // Contrast yoke over the shoulders.
    rect(0, 0, 1, 0.1, look.accent);
    rect(0.44, 0, 0.56, 0.02, look.accent);
  }
  if (top === 'uniform') {
    // Two pockets with flaps, a name bar, a belt line.
    for (const u of [0.38, 0.62]) {
      rect(u - 0.055, 0.3, u + 0.055, 0.5, shade(look.color, 0.85));
      rect(u - 0.06, 0.28, u + 0.06, 0.34, shade(look.color, 0.7));
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.beginPath(); g.arc(U(u), V(0.325), 1, 0, 7); g.fill();
    }
    rect(0.33, 0.24, 0.43, 0.27, '#d8d4cc');
  }
  if (top === 'dress') {
    // A scoop neck, and a print on some.
    g.fillStyle = look.skin;
    g.beginPath(); g.ellipse(U(0.5), V(0), w * 0.075, h * 0.13, 0, 0, 7); g.fill();
    back((bx) => { g.beginPath(); g.ellipse(bx, V(0), w * 0.06, h * 0.06, 0, 0, 7); g.fill(); });
    if (rnd() < 0.5) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.7)' : shade(look.color, 0.6);
      for (let i = 0; i < 70; i++) { g.beginPath(); g.arc(x + rnd() * w, y + rnd() * h, 1.6, 0, 7); g.fill(); }
    }
    rect(0, 0.62, 1, 0.66, shade(look.color, 0.7));                      // a waist seam
  }
  if (top === 'chef') {
    // Double-breasted whites: the flap across, two rows of buttons, a band collar.
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(U(0.42), V(0.05)); g.lineTo(U(0.58), V(0.3)); g.lineTo(U(0.58), V(1)); g.stroke();
    g.fillStyle = '#9a968e';
    for (const u of [0.44, 0.56]) for (const v of [0.22, 0.38, 0.54, 0.7]) { g.beginPath(); g.arc(U(u), V(v), 1.4, 0, 7); g.fill(); }
    rect(0.4, 0, 0.6, 0.045, '#e4e0d8');
  }
  if (top === 'waiter') {
    // A black waistcoat over the white shirt, open in a V, buttoned below.
    const vest = '#1c1c21';
    g.fillStyle = vest;
    g.beginPath();
    g.moveTo(x, y); g.lineTo(U(0.42), y); g.lineTo(U(0.5), V(0.45)); g.lineTo(U(0.58), y); g.lineTo(x + w, y);
    g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.closePath(); g.fill();
    back((bx) => g.fillRect(bx - w * 0.12, y, w * 0.24, h * 0.9));   // shiny back panel
    g.fillStyle = '#6b6b70';
    for (const v of [0.55, 0.68, 0.81]) { g.beginPath(); g.arc(U(0.5), V(v), 1.3, 0, 7); g.fill(); }
  }
  if (top === 'hivis') {
    // A high-visibility vest over a tee: orange, two silver bands, the tee at the neck.
    rect(0, 0, 1, 1, '#f0851e');
    for (const v of [0.5, 0.74]) rect(0, v, 1, v + 0.07, '#cfd4d8');
    rect(0.44, 0, 0.56, 0.08, look.color);
    rect(0.497, 0.08, 0.503, 1, 'rgba(0,0,0,0.25)');
  }
  if (top === 'suit') {
    // White shirt in the V of the jacket, the tie down the middle, lapels, buttons.
    g.fillStyle = '#f2efe8';
    g.beginPath(); g.moveTo(U(0.41), V(0)); g.lineTo(U(0.59), V(0)); g.lineTo(U(0.5), V(0.5)); g.closePath(); g.fill();
    g.fillStyle = look.accent;
    g.beginPath(); g.moveTo(U(0.488), V(0.05)); g.lineTo(U(0.512), V(0.05)); g.lineTo(U(0.518), V(0.44)); g.lineTo(U(0.5), V(0.5)); g.lineTo(U(0.482), V(0.44)); g.closePath(); g.fill();
    g.strokeStyle = shade(look.color, 0.55);
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(U(0.41), V(0)); g.lineTo(U(0.5), V(0.5)); g.lineTo(U(0.59), V(0)); g.stroke();
    g.strokeStyle = shade(look.color, 1.4);
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(U(0.4), V(0.05)); g.lineTo(U(0.44), V(0.28)); g.moveTo(U(0.6), V(0.05)); g.lineTo(U(0.56), V(0.28)); g.stroke();
    rect(0.5, 0.5, 0.503, 1, 'rgba(0,0,0,0.35)');
    g.fillStyle = shade(look.color, 0.5);
    for (const v of [0.62, 0.8]) { g.beginPath(); g.arc(U(0.51), V(v), 1.5, 0, 7); g.fill(); }
    // A pocket square.
    rect(0.6, 0.3, 0.64, 0.33, '#e8e4dc');
  }
  if (top === 'leather' && look.outfit === 'leather') {
    // The club patch on the back: a horned wheel and two rockers, in the accent colour.
    back((cx) => {
      g.fillStyle = look.accent;
      g.fillRect(cx - 18, V(0.2), 36, 6);
      g.fillRect(cx - 16, V(0.74), 32, 5);
      g.strokeStyle = look.accent;
      g.lineWidth = 3;
      g.beginPath(); g.arc(cx, V(0.47), 11, 0, 7); g.stroke();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.beginPath(); g.moveTo(cx, V(0.47)); g.lineTo(cx + Math.cos(a) * 11, V(0.47) + Math.sin(a) * 11); g.stroke();
      }
      g.fillStyle = '#e8e4dc';
      g.beginPath(); g.moveTo(cx - 10, V(0.35)); g.lineTo(cx - 16, V(0.24)); g.lineTo(cx - 5, V(0.33)); g.fill();
      g.beginPath(); g.moveTo(cx + 10, V(0.35)); g.lineTo(cx + 16, V(0.24)); g.lineTo(cx + 5, V(0.33)); g.fill();
    });
  }
}

/** The print: one small picture per look, shown on the chest or the cap. */
function paintPrint(g, look) {
  const [x, y, w, h] = R.print;
  g.save();
  g.translate(x, y);
  if (look.logo === 'pizza') {
    // Pizza Pronto: a slice on a red disc, with a crust and pepperoni.
    g.fillStyle = look.color;
    g.fillRect(0, 0, w, h);
    g.fillStyle = look.accent;
    g.beginPath(); g.arc(32, 30, 27, 0, 7); g.fill();
    g.fillStyle = '#f7d774';
    g.beginPath(); g.moveTo(32, 50); g.lineTo(14, 16); g.quadraticCurveTo(32, 8, 50, 16); g.closePath(); g.fill();
    g.fillStyle = '#b9772d';
    g.beginPath(); g.moveTo(14, 16); g.quadraticCurveTo(32, 8, 50, 16); g.lineTo(48, 21); g.quadraticCurveTo(32, 13, 16, 21); g.closePath(); g.fill();
    g.fillStyle = '#b3261e';
    for (const [px, py] of [[28, 24], [38, 26], [32, 36], [24, 32]]) { g.beginPath(); g.arc(px, py, 3.2, 0, 7); g.fill(); }
    g.fillStyle = '#fff';
    g.font = 'bold 10px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('PRONTO', 32, 62);
  } else if (look.logo === 'badge') {
    // A seven-point star on the shirt colour.
    g.fillStyle = look.top === 'uniform' ? look.color : shade(look.color, 0.8);
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d9b14a';
    g.beginPath();
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI / 2 + (i / 14) * Math.PI * 2;
      const r = i % 2 ? 13 : 29;
      g.lineTo(32 + Math.cos(a) * r, 33 + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
    g.fillStyle = '#8a6a1e';
    g.beginPath(); g.arc(32, 33, 9, 0, 7); g.fill();
    g.fillStyle = '#f2d98a';
    g.beginPath(); g.arc(32, 33, 5, 0, 7); g.fill();
  } else if (look.logo === 'id') {
    // A clip-on ID card: blue header, photo, lines of text.
    g.fillStyle = '#f4f1ea';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#23407a';
    g.fillRect(0, 0, w, 16);
    g.fillStyle = '#fff';
    g.font = 'bold 11px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('AGENT', 32, 12);
    g.fillStyle = '#8a9aa8';
    g.fillRect(6, 22, 20, 26);
    g.fillStyle = look.skin;
    g.beginPath(); g.arc(16, 32, 6, 0, 7); g.fill();
    g.fillStyle = '#555';
    for (const ly of [24, 32, 40]) g.fillRect(31, ly, 26, 3);
    g.fillStyle = '#23407a';
    g.fillRect(0, 54, w, 10);
  } else {
    g.fillStyle = look.color;
    g.fillRect(0, 0, w, h);
  }
  g.restore();
}

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * Hair, beard and stubble on the face texture, pixel by pixel, shaped by the
 * same masks as the modelled hair (SHELLS) and reaching a little past them,
 * so the hair and beard fade into the skin instead of ending on a line.
 */
function paintFaceHair(g, look) {
  const [x, y, w, h] = R.face;
  const S = ATLAS_SCALE;
  const W = w * S;
  const H = h * S;
  const img = g.getImageData(x * S, y * S, W, H);
  const px = img.data;
  const hair = rgbOf(look.hair);
  const beardCol = rgbOf(look.beard === 'grey' ? '#d9d6cf' : look.hair);
  const longHair = look.long || look.head === 'long';
  const scalpHair = !HAIRLESS.has(look.head) || longHair;
  const beard = SHELLS[look.beard] ? SHELLS[look.beard][0] : null;
  const shaven = look.build === 'female' ? 0 : look.beard ? 0.08 : 0.13;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // The texture's edges are 1.5 px in from the region's (see buildGeometry).
  const cols = [];
  for (let i = 0; i < W; i++) cols.push(skullD(Math.max(-0.5, Math.min(0.5, ((i + 0.5) / S - 1.5) / (w - 3) - 0.5))));
  const blend = (k, c, a) => {
    px[k] += (c[0] - px[k]) * a;
    px[k + 1] += (c[1] - px[k + 1]) * a;
    px[k + 2] += (c[2] - px[k + 2]) * a;
  };
  for (let j = 0; j < H; j++) {
    const t = ((j + 0.5) / S - 1.5) / (h - 3);
    for (let i = 0; i < W; i++) {
      const d = cols[i];
      const k = (j * W + i) * 4;
      const grain = 0.7 + rnd() * 0.6;
      const line = table(longHair ? LONG_LINE : HAIRLINE, Math.abs(d));
      let a = 1 - ramp(line - 0.035, line + 0.008, t);
      // Thinning: a horseshoe round the back, a few strands on top; shaved: a shadow of it.
      if (look.head === 'thin') a = Math.max(0.3 * a, 0.9 * ramp(0.2, 0.6, SHELLS.thin[0](d, t)));
      else if (look.head === 'bald') a = 0.22 * ramp(0.2, 0.6, SHELLS.thin[0](d, t));
      else if (!scalpHair) a = 0;
      if (a > 0.003) blend(k, hair, Math.min(1, a * grain));
      const b = Math.max(beard ? 0.92 * ramp(0.25, 0.6, beard(d, t)) : 0, shaven * ramp(0.2, 0.7, SHELLS.full[0](d, t)));
      if (b > 0.003) blend(k, beardCol, Math.min(1, b * grain));
    }
  }
  g.putImageData(img, x * S, y * S);
}

/** A painted face: brows, eyes, nose, mouth, stubble or a beard, lines with age. */
function drawYoungFace(g, [x, y, w, h], look, rnd) {
  const k = w / 256;
  const X = (v) => x + v * k;
  const Y = (v) => y + v * k;
  const lined = look.face === 'lined';
  const glow = (cx, cy, r, color, a, sy = 1) => {
    g.save();
    g.translate(X(cx), Y(cy));
    g.scale(1, sy);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r * k);
    gr.addColorStop(0, `rgba(${color},${a})`);
    gr.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = gr;
    g.fillRect(-r * k, -r * k, r * 2 * k, r * 2 * k);
    g.restore();
  };
  g.fillStyle = look.skin;
  g.fillRect(x, y, w, h);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(0,0,0,${rnd() * 0.05})`;
    g.fillRect(x + rnd() * w, y + rnd() * h, 2, 2);
  }
  // Light and shade, the way a photo texture has it: a lit forehead and nose,
  // sunken eyes, warm cheeks, a shadow under the jaw.
  glow(128, 80, 50, '255,245,230', 0.16, 0.7);
  glow(128, 142, 16, '255,240,225', 0.14, 1.6);
  for (const ex of [96, 160]) glow(ex, 116, 24, '60,30,20', lined ? 0.34 : 0.24, 0.7);
  for (const cx of [84, 172]) glow(cx, 150, 26, '180,70,55', 0.12, 1);
  glow(128, 226, 70, '40,20,15', 0.3, 0.45);
  for (const sx of [58, 198]) glow(sx, 140, 30, '40,20,15', 0.16, 1.6);

  // Hair and beards: paintFaceHair, after the face. A shine on a bald head.
  if (look.head === 'bald') glow(128, 20, 60, '255,250,240', 0.18, 0.6);

  if (lined) {
    // Forehead lines, bags under the eyes, lines from the nose to the mouth.
    g.strokeStyle = 'rgba(80,40,28,0.45)';
    g.lineWidth = 2 * k;
    for (const fy of [72, 82, 92]) { g.beginPath(); g.moveTo(X(98), Y(fy)); g.quadraticCurveTo(X(128), Y(fy - 5), X(158), Y(fy)); g.stroke(); }
    for (const ex of [96, 160]) {
      g.beginPath(); g.ellipse(X(ex), Y(130), 12 * k, 5 * k, 0, 0.1, Math.PI - 0.1); g.stroke();
      const out = ex < 128 ? -1 : 1;
      for (let j = -1; j <= 1; j++) { g.beginPath(); g.moveTo(X(ex + out * 16), Y(118 + j * 4)); g.lineTo(X(ex + out * 25), Y(116 + j * 7)); g.stroke(); }
    }
    g.strokeStyle = 'rgba(80,40,28,0.5)';
    g.lineWidth = 3 * k;
    g.beginPath(); g.moveTo(X(114), Y(150)); g.quadraticCurveTo(X(100), Y(170), X(104), Y(192)); g.stroke();
    g.beginPath(); g.moveTo(X(142), Y(150)); g.quadraticCurveTo(X(156), Y(170), X(152), Y(192)); g.stroke();
  }

  // Eyes and brows.
  const brows = lined && HAIRLESS.has(look.head) ? shade(look.hair, 0.8) : look.hair;
  for (const ex of [96, 160]) {
    if (look.shades) {
      g.fillStyle = '#0c0c10';
      g.fillRect(X(ex - 20), Y(108), 40 * k, 20 * k);
    } else {
      // The eyeball is real (see buildGeometry); round it, the shadowed
      // opening between the lids.
      g.fillStyle = 'rgba(45,22,16,0.8)';
      g.beginPath(); g.ellipse(X(ex), Y(118), 12 * k, 6 * k, 0, 0, 7); g.fill();
      // Upper lid.
      g.strokeStyle = 'rgba(40,20,15,0.85)';
      g.lineWidth = 2.5 * k;
      g.beginPath(); g.ellipse(X(ex), Y(119), 13 * k, 7.5 * k, 0, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
    }
    // Brows: short hairs along an arch, thick at the inner end.
    const inner = ex < 128 ? ex + 18 : ex - 18;
    const outer = ex < 128 ? ex - 19 : ex + 19;
    const dir = outer > inner ? 1 : -1;
    g.strokeStyle = brows;
    g.lineCap = 'round';
    for (let i = 0; i < 60; i++) {
      const f = i / 60 + rnd() * 0.02;
      const bx = inner + (outer - inner) * f;
      const by = 106 - 6 * Math.sin(f * 2.4) + f * 2 + (rnd() - 0.5) * (4.5 - f * 3);
      g.globalAlpha = 0.5 + rnd() * 0.4;
      g.lineWidth = (1.7 - f * 0.7) * k;
      g.beginPath(); g.moveTo(X(bx), Y(by)); g.lineTo(X(bx + dir * 5), Y(by - 1.5 + f * 2)); g.stroke();
    }
    g.globalAlpha = 1;
  }
  if (look.shades) { g.fillStyle = '#0c0c10'; g.fillRect(X(116), Y(112), 24 * k, 4 * k); }
  // Nose: a lit bridge, a shadow down one side, nostrils.
  g.fillStyle = 'rgba(110,50,40,0.3)';
  g.beginPath(); g.moveTo(X(128), Y(120)); g.lineTo(X(118), Y(158)); g.lineTo(X(138), Y(158)); g.closePath(); g.fill();
  g.fillStyle = 'rgba(40,15,10,0.55)';
  for (const nx of [121, 135]) { g.beginPath(); g.ellipse(X(nx), Y(156), 3.5 * k, 2 * k, 0, 0, 7); g.fill(); }
  // Mouth: a dark line between the lips, a fuller, lighter lower lip.
  const female = look.build === 'female';
  g.fillStyle = female ? 'rgba(170,45,55,0.75)' : 'rgba(150,70,60,0.45)';
  g.beginPath(); g.ellipse(X(128), Y(186), (female ? 15 : 17) * k, (female ? 6.5 : 5) * k, 0, 0, 7); g.fill();
  if (female) {
    // Lashes along the upper lids, a little blush.
    g.strokeStyle = 'rgba(20,10,8,0.9)';
    g.lineWidth = 3 * k;
    for (const ex of [96, 160]) { g.beginPath(); g.ellipse(X(ex), Y(119), 13 * k, 7 * k, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke(); }
    for (const cx of [84, 172]) glow(cx, 150, 20, '220,90,90', 0.16, 1);
  }
  g.fillStyle = 'rgba(70,25,22,0.8)';
  g.fillRect(X(110), Y(180), 36 * k, 3.5 * k);
  g.fillStyle = 'rgba(255,220,200,0.18)';
  g.fillRect(X(118), Y(186), 20 * k, 2 * k);
}

// ------------------------------------------------------------ geometry

const smooth01 = (v) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };
const ramp = (a, b, v) => smooth01((v - a) / (b - a));

/**
 * Skin weights that blend across the joints, so elbows, knees, shoulders,
 * the waist and the neck bend smoothly instead of hinging: for a vertex of a
 * part on `bone` at bind-pose (x, y), returns [bone A, bone B, weight of B].
 */
function jointBlend(bone, x, y) {
  const arm = bone >= B.shoulderL && bone <= B.wristR;
  if (arm) {
    const L = bone <= B.wristL;
    const sh = L ? B.shoulderL : B.shoulderR;
    const el = sh + 1;
    const wr = sh + 2;
    if (y > 1.36) return [sh, B.chest, 0.45 * ramp(1.36, 1.5, y)];         // the top of the shoulder
    if (y > 1.02) return [sh, el, ramp(1.21, 1.09, y)];                    // the elbow
    return [el, wr, ramp(0.935, 0.865, y)];                                // the wrist
  }
  const leg = bone >= B.hipL && bone <= B.ankleR;
  if (leg) {
    const L = bone <= B.ankleL;
    const hp = L ? B.hipL : B.hipR;
    const kn = hp + 1;
    const an = hp + 2;
    if (y > 0.8) return [hp, B.hips, 0.55 * ramp(0.8, 0.97, y)];            // the top of the thigh
    if (y > 0.26) return [hp, kn, ramp(0.54, 0.4, y)];                      // the knee
    return [kn, an, ramp(0.13, 0.04, y)];                                  // the ankle
  }
  if (bone === B.head) return [B.head, B.head, 0];
  // Torso and neck: hips, spine, chest, neck and head in turn.
  void x;
  if (y < 1.1) return [B.hips, B.spine, ramp(0.95, 1.1, y)];
  if (y < 1.32) return [B.spine, B.chest, ramp(1.12, 1.3, y)];
  if (y < 1.555) return [B.chest, B.neck, ramp(1.47, 1.55, y)];
  return [B.neck, B.head, ramp(1.56, 1.62, y)];
}

// Where the eyes sit on the unit skull: 30 degrees either side of the nose,
// a little above the middle, sunk into their sockets.
const EYE_SOCKET = { a: Math.PI / 6, th: Math.PI * 0.46, r: 0.12 * 0.93 - 0.006 };

/** How far the skull's surface is pushed out at (d, t): d is around from the front (-0.5..0.5), t down from the crown (0..1). */
function skullBump(d, t) {
  const G = (a, b) => Math.exp(-(a * a + b * b));
  const ad = Math.abs(d);
  let s = 0;
  s -= 0.075 * G((ad - 0.083) / 0.042, (t - 0.46) / 0.034);             // eye sockets
  s += 0.045 * G(d / 0.13, (t - 0.405) / 0.03);                          // brow ridge
  s += 0.07 * G(d / 0.02, (t - 0.5) / 0.05);                             // bridge of the nose
  s += 0.15 * G(d / 0.027, (t - 0.575) / 0.034);                         // tip of the nose
  s += 0.05 * G((ad - 0.03) / 0.015, (t - 0.6) / 0.02);                   // nostrils
  s += 0.035 * G((ad - 0.11) / 0.05, (t - 0.53) / 0.04);                  // cheekbones
  s += 0.02 * G(d / 0.06, (t - 0.66) / 0.04);                             // the muzzle round the mouth
  s += 0.04 * G(d / 0.05, (t - 0.705) / 0.016);                           // upper lip
  s += 0.045 * G(d / 0.045, (t - 0.745) / 0.017);                         // lower lip
  s -= 0.02 * G(d / 0.055, (t - 0.726) / 0.006);                          // between the lips
  s += 0.06 * G(d / 0.05, (t - 0.84) / 0.04);                             // chin
  s -= 0.06 * ramp(0.55, 0.85, t) * ramp(0.12, 0.27, ad);                 // jaw, narrowing
  s += 0.03 * ramp(0.3, 0.45, ad) * G(0, (t - 0.35) / 0.2);               // the back of the head
  // Nothing at the poles, so the top and bottom close up.
  return s * Math.min(1, Math.sin(Math.PI * t) * 4);
}

/** Undoes the face texture's squeeze (see skullGeometry): where on the skull a column of the face texture lands. */
function skullD(u) {
  let d = u / 1.5;
  for (let i = 0; i < 6; i++) d -= (d + (0.5 * Math.sin(2 * Math.PI * d)) / (2 * Math.PI) - u) / (1 + 0.5 * Math.cos(2 * Math.PI * d));
  return d;
}

const table = (tab, x) => {
  for (let i = 1; i < tab.length; i++) {
    if (x <= tab[i][0]) {
      const [x0, y0] = tab[i - 1];
      const [x1, y1] = tab[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return tab[tab.length - 1][1];
};
// Where the hair stops, by how far round from the front: the forehead, the
// temples, over the ears, down behind them to the nape.
const HAIRLINE = [[0, 0.25], [0.1, 0.26], [0.17, 0.35], [0.21, 0.4], [0.27, 0.42], [0.33, 0.58], [0.5, 0.64]];
const scalp = (d, t, lift = 0) => 1 - ramp(table(HAIRLINE, Math.abs(d)) + lift - 0.05, table(HAIRLINE, Math.abs(d)) + lift + 0.03, t);
const Gs = (a, b) => Math.exp(-(a * a + b * b));
const mouthClear = (d, t) => 1 - Gs(d / 0.05, (t - 0.726) / 0.022);
const stache = (d, t) => Gs(d / 0.06, (t - 0.675) / 0.014);

// Hair and beards as a skin over the skull: [mask(d, t) 0..1, thickness in metres].
const SHELLS = {
  hair: [(d, t) => scalp(d, t), (d, t) => 0.006 + 0.007 * (1 - t)],
  short: [(d, t) => scalp(d, t) * ramp(0.3, 0.34, t), () => 0.005],             // what shows under a hat
  slick: [(d, t) => scalp(d, t, 0.02 * (1 - ramp(0.1, 0.2, Math.abs(d)))), (d, t) => 0.005 + 0.005 * (1 - t)],
  thin: [(d, t) => scalp(d, t) * ramp(0.34, 0.4, t) * ramp(0.12, 0.2, Math.abs(d)), () => 0.004],
  full: [(d, t) => {
    const ad = Math.abs(d);
    const lo = 0.615 - 1.2 * Math.max(0, ad - 0.07);                     // the cheek line, rising to the sideburns
    return ramp(lo - 0.04, lo + 0.04, t) * (1 - ramp(0.2, 0.26, ad)) * mouthClear(d, t) * (1 - ramp(0.9, 0.98, t));
  }, (d, t) => 0.011 + 0.012 * Gs(d / 0.1, (t - 0.86) / 0.08)],
  goatee: [(d, t) => Math.max(stache(d, t), Gs(d / 0.045, (t - 0.8) / 0.05), Gs((Math.abs(d) - 0.05) / 0.012, (t - 0.72) / 0.04)) * mouthClear(d, t), () => 0.007],
  stache: [(d, t) => stache(d, t), () => 0.006],
  chin: [(d, t) => Math.max(stache(d, t), ramp(0.74, 0.765, t) * (1 - ramp(0.07, 0.1, Math.abs(d))) * (1 - ramp(0.9, 0.95, t)),
    Gs((Math.abs(d) - 0.055) / 0.012, (t - 0.72) / 0.04)) * mouthClear(d, t), () => 0.006],
};
SHELLS.grey = SHELLS.full;
// Long hair: over the ears and down to the nape, the ends hanging from it (buildGeometry).
const LONG_LINE = [[0, 0.25], [0.1, 0.27], [0.17, 0.4], [0.24, 0.62], [0.35, 0.85], [0.5, 0.9]];
SHELLS.long = [(d, t) => 1 - ramp(table(LONG_LINE, Math.abs(d)) - 0.05, table(LONG_LINE, Math.abs(d)) + 0.03, t), (d, t) => 0.008 + 0.008 * (1 - t)];

/**
 * A head: a sphere shaped by skullBump, the texture stretched round so the
 * painted eyes, nose and mouth land on the sculpted ones. With a shell (one
 * of SHELLS), only the part of it the mask covers, pushed out by the
 * thickness: hair and beards that hug the head exactly.
 */
function skullGeometry(shell = null, lo = false) {
  const geo = lo ? new THREE.SphereGeometry(0.12, 16, 12) : new THREE.SphereGeometry(0.12, 40, 30);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const dt = [];
  for (let i = 0; i < pos.count; i++) {
    const d = uv.getX(i) - 0.5;
    const t = 1 - uv.getY(i);
    dt.push([d, t]);
    const k = 1 + skullBump(d, t);
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
    // The face was painted spread wider round the head than the features
    // are: squeeze the texture's middle onto them.
    uv.setX(i, 0.5 + d + (0.5 * Math.sin(2 * Math.PI * d)) / (2 * Math.PI));
  }
  geo.computeVertexNormals();
  if (!shell) return geo;
  const [mask, thick] = SHELLS[shell];
  const nor = geo.attributes.normal;
  const m = dt.map(([d, t]) => mask(d, t));
  // Pushed out along the skull's normals, thinning to nothing at the edge.
  const P = [];
  for (let i = 0; i < pos.count; i++) {
    const out = 0.001 + thick(dt[i][0], dt[i][1]) * ramp(0.5, 0.9, m[i]);
    P.push(pos.getX(i) + nor.getX(i) * out, pos.getY(i) + nor.getY(i) * out, pos.getZ(i) + nor.getZ(i) * out);
  }
  // Each triangle is cut along the mask's halfway line, so the edge of the
  // hair follows it smoothly instead of stepping from triangle to triangle.
  const oP = [];
  const oN = [];
  const oU = [];
  const emit = ([i, j, f]) => {
    for (let k = 0; k < 3; k++) oP.push(P[i * 3 + k] + (P[j * 3 + k] - P[i * 3 + k]) * f);
    const nx = nor.getX(i) + (nor.getX(j) - nor.getX(i)) * f;
    const ny = nor.getY(i) + (nor.getY(j) - nor.getY(i)) * f;
    const nz = nor.getZ(i) + (nor.getZ(j) - nor.getZ(i)) * f;
    const l = Math.hypot(nx, ny, nz) || 1;
    oN.push(nx / l, ny / l, nz / l);
    oU.push(uv.getX(i) + (uv.getX(j) - uv.getX(i)) * f, uv.getY(i) + (uv.getY(j) - uv.getY(i)) * f);
  };
  const src = geo.index.array;
  for (let a = 0; a < src.length; a += 3) {
    const tri = [src[a], src[a + 1], src[a + 2]];
    const f = tri.map((i) => m[i] - 0.5);
    if (f[0] < 0 && f[1] < 0 && f[2] < 0) continue;
    const poly = [];
    for (let k = 0; k < 3; k++) {
      const k2 = (k + 1) % 3;
      if (f[k] >= 0) poly.push([tri[k], tri[k], 0]);
      if ((f[k] >= 0) !== (f[k2] >= 0)) poly.push([tri[k], tri[k2], f[k] / (f[k] - f[k2])]);
    }
    for (let k = 1; k + 1 < poly.length; k++) { emit(poly[0]); emit(poly[k]); emit(poly[k + 1]); }
  }
  geo.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(oP, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(oN, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(oU, 2));
  out.setIndex([...Array(oP.length / 3).keys()]);
  return out;
}

/** A shoe (or its sole): a box with a rounded toe and heel. */
function shoeGeometry(w, h, d, sole = false) {
  const g = new THREE.BoxGeometry(w, h, d, 4, 2, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i) / (d / 2);                 // -1 heel .. 1 toe
    const y = p.getY(i) / (h / 2);                 // -1 bottom .. 1 top
    const toe = Math.max(0, z - 0.25) / 0.75;
    const heel = Math.max(0, -z - 0.7) / 0.3;
    p.setX(i, p.getX(i) * (1 - toe * toe * 0.4 - heel * heel * 0.25));
    if (!sole && y > 0) p.setY(i, p.getY(i) * (1 - toe * toe * 0.55));
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Builds the body for a look's shape: a list of parts, merged and skinned.
 * `lo`: the version for people further off, about a quarter of the
 * triangles: rounder parts get fewer sides, and the modelled hair, eyes and
 * fingers go (the painted ones are enough from there).
 */
function buildGeometry(look, lo = false) {
  const parts = [];
  // o.vr: [top, bottom] as fractions of the paint region, when a part should
  // only sample a band of it (the torso wrap); otherwise it takes the lot.
  const add = (bone, geo, paint, o = {}) => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(o.x || 0, o.y || 0, o.z || 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0)),
      new THREE.Vector3(o.sx || 1, o.sy || 1, o.sz || 1),
    );
    geo.applyMatrix4(m);
    parts.push({ bone: B[bone], geo, paint, vr: o.vr });
  };
  // Finer than they look in the calls: everything is rounder than it was.
  const fine = lo ? 0.75 : 1.6;
  const cyl = (rt, rb, h, seg = 9, open = false) => new THREE.CylinderGeometry(rt, rb, h, Math.max(5, Math.round(seg * fine)), 1, open);
  const sph = (r, ws = 10, hs = 8) => new THREE.SphereGeometry(r, Math.max(5, Math.round(ws * fine)), Math.max(4, Math.round(hs * fine)));
  const boxg = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  /** A limb: rings all the way down (so it bends smoothly), shaped by `profile(t)` (t: 0 bottom, 1 top). */
  const limbTube = (rt, rb, h, seg, profile) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, Math.max(5, Math.round(seg * (lo ? 0.8 : 1.7))), lo ? 3 : 8, false);
    if (profile) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = profile(p.getY(i) / h + 0.5);
        p.setX(i, p.getX(i) * k);
        p.setZ(i, p.getZ(i) * k);
      }
      g.computeVertexNormals();
    }
    return g;
  };
  const bulge = (at, amount, width = 0.35) => (t) => 1 + amount * Math.exp(-(((t - at) / width) ** 2));

  const heavy = look.build === 'heavy';
  const female = look.build === 'female';
  const bulky = look.outfit === 'farmer' || heavy;
  const wrap = WRAP_TOPS.has(look.top);
  const sleeves = {
    plaid: 'rolled', tee: 'short', tank: 'none', hoodie: 'long', jersey: 'long', vest: 'short',
    flannel: 'long', sweater: 'long', polo: 'short', shirt: 'long', hawaii: 'short', suit: 'long', uniform: 'short', leather: 'long',
    dress: 'none', chef: 'long', waiter: 'long', hivis: 'short',
  }[look.top] || 'short';
  // Wrap tops turn the torso round so the middle of the region is the front,
  // and give each part its band: shoulders, chest, belly.
  const band = (vr) => (wrap ? { ry: Math.PI, vr } : {});
  const limb = heavy ? 1.18 : female ? 0.88 : 1;

  // Hips and belly (a narrow waist and wider hips for women).
  add('hips', cyl(female ? 0.17 : 0.165, female ? 0.18 : 0.16, 0.2, 10), 'pants', { y: -0.02, sz: 0.74 });
  add('spine', cyl(bulky ? 0.2 : female ? 0.15 : 0.17, female ? 0.17 : 0.165, 0.24, 10), look.legs === 'overalls' ? 'pants' : 'shirt', { y: 0.1, sz: bulky ? 0.82 : 0.72, ...band([0.56, 1]) });
  if (bulky) add('spine', sph(0.19, 10, 8), look.legs === 'overalls' ? 'pants' : wrap ? 'sleeve' : 'shirt', { y: 0.08, z: 0.03, sy: 0.8, sz: 0.8 });   // a belly
  // Chest: broad at the shoulders.
  const shoulders = heavy ? 0.235 : female ? 0.19 : 0.21;
  add('chest', cyl(shoulders, bulky ? 0.2 : female ? 0.155 : 0.175, 0.3, 10), 'shirt', { y: 0.1, sz: heavy ? 0.72 : 0.66, ...band([0.13, 0.69]) });
  add('chest', cyl(0.12, shoulders, 0.07, 10), 'shirt', { y: 0.285, sz: 0.62, ...band([0, 0.13]) });   // shoulders slope
  if (female) {
    for (const s of [-1, 1]) add('chest', sph(0.07, 9, 7), 'shirt', { x: s * 0.068, y: 0.1, z: 0.078, sz: 0.75, ...band([0.3, 0.5]), ry: 0 });
  }
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
  if (HEM_TOPS.has(look.top)) {
    // The tail of the shirt or jacket, hanging over the belt.
    add('hips', cyl(0.178, 0.19, 0.15, 10, true), 'shirt', { y: 0.005, sz: 0.8, ry: Math.PI, vr: [0.82, 1] });
  }
  if (look.top === 'sweater') add('hips', cyl(0.172, 0.178, 0.08, 10, true), 'tee', { y: -0.03, sz: 0.8 });   // tee below it
  if (COLLAR_TOPS.has(look.top)) {
    // A collar standing round the neck, points down at the front.
    add('chest', cyl(0.078, 0.086, 0.045, 10, true), 'trim', { y: 0.3, sz: 0.95 });
    for (const s of [-1, 1]) add('chest', boxg(0.05, 0.05, 0.012), 'trim', { x: s * 0.038, y: 0.27, z: 0.08, rx: -0.35, rz: s * 0.5 });
  }
  if (look.top === 'suit') {
    add('chest', cyl(0.076, 0.082, 0.04, 10, true), 'tee', { y: 0.3, sz: 0.95 });                  // shirt collar
    add('chest', boxg(0.032, 0.03, 0.02), 'tie', { y: 0.275, z: 0.075, rx: -0.3 });                  // tie knot
  }
  if (look.top === 'leather') {
    // A stand-up collar (the lapels are painted on).
    add('chest', cyl(0.092, 0.1, 0.055, 10, true), 'sleeve', { y: 0.305, z: -0.01, sz: 0.95 });
  }
  if (look.top === 'uniform') {
    // Epaulettes, a duty belt with a holster and a radio.
    for (const s of ['L', 'R']) add(`shoulder${s}`, boxg(0.07, 0.014, 0.13), 'trim', { y: 0.058 });
    add('hips', cyl(0.174, 0.174, 0.055, 10), 'dark', { y: 0.06, sz: 0.78 });
    add('hips', boxg(0.06, 0.16, 0.09), 'dark', { x: -0.19, y: -0.02, z: 0.01 });
    add('hips', boxg(0.05, 0.08, 0.035), 'dark', { x: 0.12, y: 0.03, z: 0.12 });
  }
  if (look.logo === 'badge' || look.logo === 'id' || (look.logo === 'pizza' && look.top === 'polo')) {
    // The print on the left of the chest.
    const id = look.logo === 'id';
    add('chest', boxg(id ? 0.06 : 0.07, id ? 0.08 : 0.07, 0.006), 'print', { x: 0.085, y: id ? 0.11 : 0.16, z: 0.132, ry: 0.35, rx: -0.12 });
  }
  if (look.chain) {
    // A heavy chain hanging round the neck (the front half of a ring, laid on the chest) with a pendant.
    add('chest', new THREE.TorusGeometry(0.12, 0.009, 4, 14, Math.PI), 'metal', { y: 0.32, z: 0.05, rx: -0.85, rz: Math.PI });
    add('chest', boxg(0.045, 0.06, 0.012), 'metal', { y: 0.2, z: 0.146, rx: -0.3 });
  }
  add('neck', cyl(heavy ? 0.068 : female ? 0.05 : 0.058, heavy ? 0.078 : female ? 0.058 : 0.065, 0.12, 8), 'skin', { y: 0.03 });
  if (look.camera) {
    // A camera on a strap round the neck.
    add('chest', boxg(0.11, 0.07, 0.05), 'dark', { x: 0.03, y: 0.08, z: 0.16 });
    add('chest', cyl(0.022, 0.024, 0.04, 8), 'dark', { x: 0.03, y: 0.08, z: 0.2, rx: Math.PI / 2 });
    add('chest', new THREE.TorusGeometry(0.12, 0.005, 3, 12, Math.PI), 'dark', { y: 0.3, z: 0.03, rx: -1.1, rz: Math.PI });
  }
  if (look.apron) {
    // A long white apron, tied at the waist.
    add('hips', boxg(0.3, 0.5, 0.012), 'tee', { y: -0.2, z: 0.14, rx: 0.06 });
    add('hips', cyl(0.176, 0.176, 0.03, 10, true), 'tee', { y: 0.06, sz: 0.78 });
  }
  if (look.top === 'waiter') add('chest', boxg(0.07, 0.022, 0.02), 'dark', { y: 0.27, z: 0.085, rx: -0.3 });   // bow tie

  // Head: a sculpted skull (brow, sockets, nose, cheekbones, lips, chin,
  // jaw) wearing the painted face, real eyeballs under a lid, and ears.
  const onSkull = (geo, paint) => add('head', geo.rotateY(-Math.PI / 2), paint, { y: 0.12, sy: 1.14, sz: 1.06 });
  onSkull(skullGeometry(null, lo), 'face');
  for (const s of [-1, 1]) {
    if (lo) {
      add('head', sph(0.022, 6, 5), 'skin', { x: s * 0.113, y: 0.116, sx: 0.4, sy: 1.35 });
      continue;
    }
    const e = EYE_SOCKET;
    const x = s * Math.sin(e.a) * Math.sin(e.th) * e.r;
    const y = Math.cos(e.th) * e.r * 1.14 + 0.12;
    const z = Math.cos(e.a) * Math.sin(e.th) * e.r * 1.06;
    add('head', new THREE.SphereGeometry(0.0128, 16, 12), 'eye', { x, y, z });
    // The upper lid, over the top of the eye.
    add('head', new THREE.SphereGeometry(0.0141, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.4), 'skin', { x, y, z: z - 0.0005, rx: 0.2 });
    // An ear: the rim, and the bowl inside it, leaning back and standing out a little.
    add('head', new THREE.TorusGeometry(0.0165, 0.0055, 6, 18), 'skin', { x: s * 0.119, y: 0.116, z: -0.006, sy: 1.5, ry: Math.PI / 2 - s * 0.3, rx: 0.18 });
    add('head', sph(0.018, 8, 7), 'skin', { x: s * 0.113, y: 0.116, z: -0.004, sx: 0.4, sy: 1.35, sz: 0.9, ry: -s * 0.3, rx: 0.18 });
  }
  // Beards and hair, grown on the skull.
  const longHair = look.long || look.head === 'long';
  if (!lo && SHELLS[look.beard]) onSkull(skullGeometry(look.beard), 'hair');
  const hair = longHair ? 'long' : { hair: 'hair', slick: 'slick', braids: 'hair', thin: 'thin', bald: null, skullcap: null }[look.head];
  if (!lo && hair !== null) onSkull(skullGeometry(hair || 'short'), 'hair');
  if (longHair) {
    // The ends, hanging down the back to the shoulders: a curved sheet,
    // both faces, following the head round.
    const sheet = new THREE.CylinderGeometry(0.128, 0.15, 0.27, lo ? 8 : 18, lo ? 1 : 4, true, Math.PI * 0.32, Math.PI * 1.36);
    const back = sheet.clone().scale(0.96, 1, 0.96);
    const idx = back.index.array;
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    const bn = back.attributes.normal;
    for (let i = 0; i < bn.count; i++) bn.setXYZ(i, -bn.getX(i), -bn.getY(i), -bn.getZ(i));
    for (const g of [sheet, back]) add('neck', g, 'hair', { y: 0.12, z: -0.005, sz: 1.02 });
  }
  if (look.mask) {
    // A bandana over the nose and mouth, outlaw style.
    add('head', new THREE.CylinderGeometry(0.126, 0.118, 0.09, 12, 1, true), 'accent', { y: 0.08, z: 0.006, sz: 1.08 });
    add('head', new THREE.ConeGeometry(0.07, 0.1, 4), 'accent', { y: 0.02, z: 0.09, rx: Math.PI, sz: 0.4 });
  }
  if (look.shades) {
    // Two dark lenses on a bridge, wrapping round to the temples.
    for (const s of [-1, 1]) {
      add('head', boxg(0.078, 0.038, 0.012), 'dark', { x: s * 0.05, y: 0.136, z: 0.124, ry: s * 0.28 });
      add('head', boxg(0.008, 0.012, 0.09), 'dark', { x: s * 0.106, y: 0.142, z: 0.07, ry: s * 0.1 });
    }
    add('head', boxg(0.03, 0.01, 0.01), 'dark', { y: 0.146, z: 0.132 });
  }

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
      add('head', boxg(0.18, 0.012, 0.1), look.logo === 'pizza' ? 'accent' : 'hat', { y: hatY - 0.035, z: back ? -0.16 : 0.16, rx: back ? -0.1 : 0.1 });
      if (look.logo === 'pizza' && !back) add('head', boxg(0.07, 0.055, 0.005), 'print', { y: hatY + 0.005, z: 0.122, rx: -0.55 });
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
    case 'skullcap':
      // A tight black cap pulled down to the brows, tied at the back.
      add('head', new THREE.SphereGeometry(0.128, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.52), 'hat', { y: 0.13, rx: -0.25, sy: 1.12, sz: 1.08 });
      add('head', boxg(0.03, 0.06, 0.02), 'hat', { y: 0.12, z: -0.14, rx: 0.4 });
      break;
    case 'bandana':
      // Tied round the head, the knot and tails at the back.
      add('head', new THREE.SphereGeometry(0.127, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.5), 'hat', { y: hatY - 0.045, sy: 0.85, sz: 1.07 });
      add('head', boxg(0.05, 0.1, 0.02), 'hat', { y: hatY - 0.09, z: -0.13, rx: 0.3 });
      break;
    case 'peaked':
      // A patrol cap: crown, black band, a shiny peak and the badge.
      add('head', cyl(0.148, 0.128, 0.085, 12), 'hat', { y: hatY + 0.035, sz: 1.06 });
      add('head', cyl(0.131, 0.131, 0.035, 12), 'dark', { y: hatY + 0.005, sz: 1.06 });
      add('head', boxg(0.19, 0.012, 0.085), 'dark', { y: hatY - 0.01, z: 0.155, rx: 0.3 });
      add('head', boxg(0.04, 0.045, 0.006), 'print', { y: hatY + 0.035, z: 0.14, rx: -0.12 });
      break;
    case 'helmet':
      add('head', new THREE.SphereGeometry(0.14, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.52), 'hat', { y: hatY - 0.05, sz: 1.08 });
      break;
    case 'visor':
      // A sun visor: a band round the head and a long peak.
      add('head', cyl(0.13, 0.13, 0.035, 14, true), 'hat', { y: hatY - 0.02, sz: 1.08 });
      add('head', new THREE.CylinderGeometry(0.2, 0.2, 0.008, 16, 1, false, -Math.PI * 0.35, Math.PI * 0.7), 'hat', { y: hatY - 0.03, z: 0.02, sz: 1.1, rx: 0.12 });
      break;
    case 'tophat':
      add('head', cyl(0.2, 0.2, 0.012, 16), 'hat', { y: hatY + 0.005, sz: 0.9 });
      add('head', cyl(0.118, 0.11, 0.2, 14), 'hat', { y: hatY + 0.1, sz: 1.05 });
      add('head', cyl(0.113, 0.113, 0.03, 14), 'dark', { y: hatY + 0.025, sz: 1.05 });
      break;
    case 'chefhat':
      // The tall pleated toque.
      add('head', cyl(0.13, 0.125, 0.12, 16), 'hat', { y: hatY + 0.03, sz: 1.06 });
      add('head', sph(0.155, 12, 8), 'hat', { y: hatY + 0.13, sy: 0.55 });
      break;
    case 'braids': {
      // Short twists all round from the crown, shorter over the face.
      const q = new THREE.Quaternion();
      const dir = new THREE.Vector3();
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2 + 0.17;
        const front = Math.cos(a);
        if (front > 0.8) continue;                                   // leave the face clear
        const len = front > 0.3 ? 0.07 : 0.13;
        dir.set(Math.sin(a) * 0.5, -1, front * 0.5).normalize();
        q.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
        const twist = cyl(0.017, 0.012, len, 5).applyQuaternion(q);
        add('head', twist, 'hair', {
          x: Math.sin(a) * 0.115 + dir.x * len * 0.5, y: 0.2 + dir.y * len * 0.5, z: front * 0.12 + dir.z * len * 0.5,
        });
      }
      break;
    }
    default:
      break;
  }

  // Arms: upper arm, elbow, forearm, hand.
  for (const s of ['L', 'R']) {
    const up = sleeves === 'none' ? 'skin' : 'sleeve';
    const fore = sleeves === 'long' ? 'sleeve' : 'skin';
    const shoulderPaint = look.top === 'tank' ? 'skin' : wrap ? 'sleeve' : 'shirt';
    add(`shoulder${s}`, sph(0.075 * limb, 8, 6), shoulderPaint, { y: -0.01 });
    // Upper arm with a biceps, forearm thick below the elbow, narrow at the wrist.
    add(`shoulder${s}`, limbTube(0.066 * limb, 0.052 * limb, UPPER_ARM, 8, bulge(0.45, 0.14)), up, { y: -UPPER_ARM / 2 });
    if (sleeves === 'rolled') add(`shoulder${s}`, cyl(0.07, 0.07, 0.05, 8), 'sleeve', { y: -UPPER_ARM + 0.02 });
    if (sleeves === 'short') add(`shoulder${s}`, limbTube(0.071 * limb, 0.066 * limb, 0.12, 8, bulge(0.3, 0.08)), 'sleeve', { y: -0.06 });
    add(`elbow${s}`, sph(0.05 * limb, 7, 5), fore === 'skin' && sleeves !== 'rolled' ? 'skin' : 'sleeve');
    add(`elbow${s}`, limbTube(0.052 * limb, 0.036 * limb, FOREARM, 8, bulge(0.75, 0.16, 0.25)), fore, { y: -FOREARM / 2 });
    // A hand: palm, four fingers a little curled, and a thumb.
    const side = s === 'L' ? -1 : 1;
    if (lo) {
      add(`wrist${s}`, boxg(0.068 * limb, 0.13, 0.032), 'skin', { y: -0.07 });
      continue;
    }
    add(`wrist${s}`, boxg(0.068 * limb, 0.075, 0.03), 'skin', { y: -0.042 });
    [[-0.024, 0.052], [-0.008, 0.062], [0.008, 0.058], [0.024, 0.046]].forEach(([fx, len]) => {
      add(`wrist${s}`, cyl(0.0085, 0.0075, len, 5), 'skin', { x: fx * side, y: -0.078 - len / 2 + 0.004, z: 0.004, rx: 0.22 });
    });
    add(`wrist${s}`, cyl(0.0095, 0.008, 0.048, 5), 'skin', { x: side * 0.037, y: -0.05, z: 0.014, rz: side * 0.55, rx: 0.3 });
  }

  // Legs: thigh, knee, shin, boot.
  for (const s of ['L', 'R']) {
    if (look.legs === 'baggy') {
      // Loose, low, bunched over the shoes.
      add(`hip${s}`, limbTube(0.108, 0.094, 0.44, 9), 'pants', { y: -0.22 });
      add(`knee${s}`, sph(0.09, 7, 5), 'pants');
      add(`knee${s}`, limbTube(0.09, 0.098, 0.4, 9), 'pants', { y: -0.2 });
      add(`ankle${s}`, cyl(0.104, 0.1, 0.07, 9), 'pants', { y: 0.03 });
    } else if (look.legs === 'dress') {
      // Bare legs under the skirt (which hangs from the hips, below).
      add(`hip${s}`, limbTube(0.078, 0.058, 0.44, 8, bulge(0.7, 0.1, 0.4)), 'skin', { y: -0.22 });
      add(`knee${s}`, sph(0.056, 7, 5), 'skin');
      add(`knee${s}`, limbTube(0.056, 0.04, 0.4, 8, bulge(0.72, 0.14, 0.25)), 'skin', { y: -0.2 });
    } else if (look.legs === 'shorts') {
      add(`hip${s}`, limbTube(0.1, 0.094, 0.34, 9), 'pants', { y: -0.17 });
      add(`hip${s}`, limbTube(0.075, 0.066, 0.12, 8), 'skin', { y: -0.38 });
      add(`knee${s}`, sph(0.064, 7, 5), 'skin');
      add(`knee${s}`, limbTube(0.062, 0.046, 0.4, 8, bulge(0.72, 0.14, 0.25)), 'skin', { y: -0.2 });
      add(`ankle${s}`, cyl(0.052, 0.052, 0.06, 8), 'tee', { y: 0.02 });                       // socks
    } else {
      add(`hip${s}`, limbTube(0.092 * (heavy ? 1.15 : 1), 0.066, 0.44, 9, bulge(0.7, 0.08, 0.4)), 'pants', { y: -0.22 });
      add(`knee${s}`, sph(0.066, 7, 5), 'pants');
      add(`knee${s}`, limbTube(0.064, 0.048, 0.4, 9, bulge(0.72, 0.12, 0.25)), 'pants', { y: -0.2 });
    }
    const foot = female ? 0.86 : 1;
    add(`ankle${s}`, shoeGeometry(0.115 * foot, 0.08 * foot, 0.25 * foot), 'shoe', { y: -0.025, z: 0.05 });
    add(`ankle${s}`, shoeGeometry(0.12 * foot, 0.022, 0.26 * foot, true), 'sole', { y: -0.066, z: 0.05 });
    if (look.shoes === 'boots') add(`ankle${s}`, cyl(0.064, 0.06, 0.12, 8), 'shoe', { y: 0.04 });
  }
  if (look.legs === 'dress') {
    // The skirt: flared from the waist to below the knee, a hem band.
    add('hips', cyl(0.178, 0.3, 0.56, 12, true), 'pants', { y: -0.3, sz: 0.86 });
    add('hips', cyl(0.305, 0.3, 0.03, 12, true), 'trim', { y: -0.575, sz: 0.86 });
  }

  // Into body space, painted from the atlas, weighted fully to their bone.
  const geos = parts.map(({ bone, geo, paint, vr }) => {
    const g = geo;
    const [bx, by, bz] = BIND[bone];
    if (bone === B.head) g.scale(0.92, 1, 1);          // heads are narrower than they are deep
    g.translate(bx, by, bz);
    let [x, y, w, h] = R[paint];
    if (vr) { y += h * vr[0]; h *= vr[1] - vr[0]; }
    const pad = 1.5;
    const u0 = (x + pad) / ATLAS_W;
    const u1 = (x + w - pad) / ATLAS_W;
    const v1 = 1 - (y + (vr ? 0 : pad)) / ATLAS_H;
    const v0 = 1 - (y + h - (vr ? 0 : pad)) / ATLAS_H;
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    const n = g.attributes.position.count;
    const idx = new Uint16Array(n * 4);
    const wgt = new Float32Array(n * 4);
    const pos = g.attributes.position;
    for (let i = 0; i < n; i++) {
      const [b0, b1, k] = jointBlend(bone, pos.getX(i), pos.getY(i));
      idx[i * 4] = b0; wgt[i * 4] = 1 - k;
      idx[i * 4 + 1] = b1; wgt[i * 4 + 1] = k;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wgt, 4));
    return g;
  });
  const merged = mergeGeometries(geos);
  for (const g of geos) g.dispose();
  return merged;
}

const shapeCache = new Map();
const materialCache = new Map();

function shapeKey(l) {
  return [l.outfit, l.top, l.legs, l.head, l.beard, l.shoes, l.shades ? 1 : 0, l.mask ? 1 : 0, l.build || '', l.chain ? 1 : 0, l.logo || '',
    l.long ? 1 : 0, l.camera ? 1 : 0, l.apron ? 1 : 0].join('/');
}

function geometryFor(look, lo = false) {
  const k = shapeKey(look) + (lo ? '/lo' : '');
  if (!shapeCache.has(k)) shapeCache.set(k, buildGeometry(look, lo));
  return shapeCache.get(k);
}

// Looks come and go with the crowd, so each look's painted atlas is counted
// and let go when the last person wearing it is.
const materialUsers = new Map();

function releaseMaterial(look) {
  const k = JSON.stringify(look);
  const n = (materialUsers.get(k) || 0) - 1;
  if (n > 0) { materialUsers.set(k, n); return; }
  materialUsers.delete(k);
  const m = materialCache.get(k);
  if (!m) return;
  materialCache.delete(k);
  m.map.dispose();
  m.dispose();
}

function materialFor(look) {
  const k = JSON.stringify(look);
  materialUsers.set(k, (materialUsers.get(k) || 0) + 1);
  if (!materialCache.has(k)) {
    const d = detailMaps(look);
    materialCache.set(k, pbr(0xffffff, {
      map: paintAtlas(look),
      normalMap: d.normal,
      normalScale: new THREE.Vector2(1, 1),
      roughnessMap: d.rough,
      metalnessMap: d.rough,
      roughness: 1,
      metalness: 1,
    }));
  }
  return materialCache.get(k);
}

// ------------------------------------------------------------ surface detail

// The roughness and normal maps that go with a look's painted atlas: what
// each region is made of (skin, cotton, denim, knit, leather, hair, straw,
// polished), as bumps and sheen. They depend only on the kinds of clothes,
// not their colours, so looks share them.

/** [grain, roughness, metalness] per region. */
function regionStuff(look) {
  const top = look.top;
  const shirt = top === 'leather' ? ['leather', 0.42] : top === 'suit' ? ['cloth', 0.7] : top === 'sweater' ? ['knit', 0.95]
    : top === 'jersey' ? ['knit', 0.5] : ['cloth', 0.86];
  const legs = look.legs;
  const pants = legs === 'jeans' || legs === 'overalls' || legs === 'baggy' ? ['denim', 0.85] : legs === 'track' ? ['knit', 0.5]
    : legs === 'slacks' ? ['cloth', 0.7] : ['cloth', 0.86];
  const shoe = look.shoes === 'dress' ? ['leather', 0.24] : look.shoes === 'boots' ? ['leather', 0.5] : ['cloth', 0.7];
  const hat = look.head === 'straw' ? ['straw', 0.85] : look.head === 'helmet' ? ['smooth', 0.2] : look.head === 'peaked' ? ['cloth', 0.72]
    : ['cloth', 0.88];
  return {
    shirt, sleeve: shirt, pants, shoe, hat,
    face: ['skin', 0.55], skin: ['skin', 0.55], hair: ['hair', 0.62], accent: ['cloth', 0.86], dark: ['smooth', 0.3],
    sole: ['cloth', 0.9], metal: ['smooth', 0.3, 1], leather: ['leather', 0.45], print: ['smooth', 0.5], tee: ['cloth', 0.9],
    trim: ['cloth', 0.8], tie: ['cloth', 0.4], eye: ['smooth', 0.05],
  };
}

const TILE = 64;
const grainTiles = {};

/** A tiling 64 px patch of normals for a kind of surface. */
function grainTile(kind) {
  if (grainTiles[kind]) return grainTiles[kind];
  const hash = (x, y, p) => {
    let h = Math.imul(((x % p) + p) % p, 374761393) + Math.imul(((y % p) + p) % p, 668265263) + kind.length * 977;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  // Value noise repeating every `p` cells across the tile.
  const noise = (x, y, p) => {
    const fx = (x / TILE) * p;
    const fy = (y / TILE) * p;
    const xi = Math.floor(fx);
    const yi = Math.floor(fy);
    const u = fx - xi;
    const v = fy - yi;
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    const a = hash(xi, yi, p);
    const b = hash(xi + 1, yi, p);
    const c = hash(xi, yi + 1, p);
    const d = hash(xi + 1, yi + 1, p);
    return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
  };
  const px = (x, y) => hash(x, y, TILE);
  const H = {
    cloth: (x, y) => 0.6 * noise(x, y, 4) + 0.25 * noise(x, y, 16) + 0.15 * px(x, y),
    denim: (x, y) => 0.55 * noise(x, y, 4) + 0.15 * Math.abs(Math.sin(((x + y) * Math.PI) / 4)) + 0.3 * px(x, y),
    knit: (x, y) => 0.45 * Math.abs(Math.sin((x * Math.PI) / 4)) + 0.35 * noise(x, y, 4) + 0.2 * px(x, y),
    skin: (x, y) => 0.12 * noise(x, y, 32) - 0.4 * px(x, y) ** 8,
    leather: (x, y) => 0.7 * (1 - Math.abs(2 * noise(x, y, 8) - 1)) + 0.3 * px(x, y),
    hair: (x, y) => 0.7 * noise(x * 16, y, 16) + 0.3 * noise(x, y, 4),
    straw: (x, y) => Math.abs(Math.sin((((Math.floor(y / 8) & 1) ? x : y) * Math.PI) / 4)) * 0.8 + 0.2 * px(x, y),
    smooth: () => 0,
  }[kind];
  const strength = { cloth: 0.9, denim: 0.9, knit: 1.3, skin: 0.35, leather: 0.8, hair: 1.4, straw: 2, smooth: 0 }[kind];
  const h = new Float32Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) h[y * TILE + x] = H(x, y);
  const at = (x, y) => h[((y + TILE) % TILE) * TILE + ((x + TILE) % TILE)];
  const cv = document.createElement('canvas');
  cv.width = cv.height = TILE;
  const g = cv.getContext('2d');
  const img = g.createImageData(TILE, TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      // Canvas rows run down, the texture's v up: the y slope flips.
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const k = (y * TILE + x) * 4;
      img.data[k] = (-dx / l * 0.5 + 0.5) * 255;
      img.data[k + 1] = (dy / l * 0.5 + 0.5) * 255;
      img.data[k + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  grainTiles[kind] = cv;
  return cv;
}

let roughGrain = null;

const detailCache = new Map();

function detailMaps(look) {
  const stuff = regionStuff(look);
  const key = JSON.stringify(stuff);
  if (detailCache.has(key)) return detailCache.get(key);
  const S = ATLAS_SCALE;
  const make = () => {
    const cv = document.createElement('canvas');
    cv.width = ATLAS_W * S;
    cv.height = ATLAS_H * S;
    return cv;
  };
  const ncv = make();
  const n = ncv.getContext('2d');
  n.fillStyle = 'rgb(128,128,255)';
  n.fillRect(0, 0, ncv.width, ncv.height);
  const rcv = make();
  const r = rcv.getContext('2d');
  r.fillStyle = 'rgb(255,230,0)';
  r.fillRect(0, 0, rcv.width, rcv.height);
  if (!roughGrain) {
    // Roughness that wanders a little: green only, so metalness (blue) stays put.
    roughGrain = document.createElement('canvas');
    roughGrain.width = roughGrain.height = TILE;
    const g = roughGrain.getContext('2d');
    for (let y = 0; y < TILE; y += 2) {
      for (let x = 0; x < TILE; x += 2) {
        g.fillStyle = `rgb(255,${(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453 % 1 + 1) % 1 * 255 | 0},0)`;
        g.fillRect(x, y, 2, 2);
      }
    }
  }
  for (const [region, [grain, rough, metal = 0]] of Object.entries(stuff)) {
    const [x, y, w, h] = R[region].map((v) => v * S);
    if (grain !== 'smooth') {
      n.fillStyle = n.createPattern(grainTile(grain), 'repeat');
      n.fillRect(x, y, w, h);
    }
    r.globalAlpha = 1;
    r.fillStyle = `rgb(255,${Math.round(rough * 255)},${Math.round(metal * 255)})`;
    r.fillRect(x, y, w, h);
    if (grain !== 'smooth') {
      r.globalAlpha = 0.12;
      r.fillStyle = r.createPattern(roughGrain, 'repeat');
      r.fillRect(x, y, w, h);
    }
  }
  // The face: an oilier forehead, nose and lips.
  {
    const [x, y, w, h] = R.face.map((v) => v * S);
    r.globalAlpha = 1;
    const grd = r.createRadialGradient(x + w / 2, y + h * 0.42, 0, x + w / 2, y + h * 0.42, w * 0.14);
    grd.addColorStop(0, 'rgba(255,100,0,0.8)');
    grd.addColorStop(1, 'rgba(255,100,0,0)');
    r.fillStyle = grd;
    r.fillRect(x, y, w, h);
  }
  const tex = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.anisotropy = 4;
    return t;
  };
  const maps = { normal: tex(ncv), rough: tex(rcv) };
  detailCache.set(key, maps);
  return maps;
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
  const material = materialFor(look);
  const mesh = new THREE.SkinnedMesh(geometryFor(look), material);
  mesh.add(bones[0]);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  // Bounds generous enough for any pose (and cheap: never recomputed).
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.5);
  group.add(mesh);
  // Further off, the same skeleton wears the lighter body (setDistance).
  const meshLo = new THREE.SkinnedMesh(geometryFor(look, true), material);
  meshLo.bind(skeleton, mesh.bindMatrix);
  meshLo.boundingSphere = mesh.boundingSphere;
  meshLo.visible = false;
  group.add(meshLo);

  let label = null;
  if (name) {
    label = labelSprite(name, tagColor, tagScale);
    label.position.y = 2.35;
    label.userData.base = { x: label.scale.x, y: label.scale.y };
    group.add(label);
  }

  // Cigar in the corner of the mouth; hidden until one is bought.
  const cigar = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.14, 6), pbr(0x5b3a1e, { roughness: 0.8 }));
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
  const w = { move: 0, run: 0, hold: 0, aim: 0, seat: 0, dead: 0, act: 0, pose: 0 };
  let action = null;             // 'crack' | 'spray' | 'smash' | null
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
  let bag = null;
  let lodSkip = 0;
  let lodEvery = 1;
  let disposed = false;
  let crowdPose = 'stand';       // what a crowd person is doing when not walking (setPose)
  let lastPose = 'stand';
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

  /** Busy hands: working a till open, spraying a wall, smashing things up. */
  function actionPose() {
    const k = w.act;
    if (k < 0.01 || !action) return;
    const saved = pose.slice(0, N).map((q) => q.clone());
    const tgt = (i, x, y = 0, z = 0) => { te.set(x, y, z); tq.setFromEuler(te); pose[i].copy(tq); };
    if (action === 'crack') {
      // Down on one knee at the register, both hands on it.
      tgt(B.hipL, -1.4, 0, 0.05); tgt(B.kneeL, 1.5); tgt(B.ankleL, -0.1);
      tgt(B.hipR, -0.2, 0, -0.1); tgt(B.kneeR, 2.1); tgt(B.ankleR, 0.4);
      tgt(B.spine, 0.25); tgt(B.chest, 0.15); tgt(B.neck, 0.1);
      hipsPos.y += (0.58 - hipsPos.y) * k;
      const jig = Math.sin(t * 9) * 0.03;
      armIK(pose, 'L', new THREE.Vector3(0.1, -0.05 + jig, 0.42), new THREE.Vector3(0.8, -1, -0.2));
      armIK(pose, 'R', new THREE.Vector3(-0.08, -0.02 - jig, 0.44), new THREE.Vector3(-0.8, -1, -0.2));
    } else if (action === 'spray') {
      // Arm up, can at the wall, going round and round.
      armIK(pose, 'R', new THREE.Vector3(-0.1 + Math.cos(t * 5) * 0.14, 0.25 + Math.sin(t * 5) * 0.14, 0.55), new THREE.Vector3(-0.8, -1, -0.3));
      tgt(B.chest, -0.05, 0.2); tgt(B.head, -0.1, 0.1);
    } else if (action === 'smash') {
      // Swinging at it, over and over.
      const s = Math.sin(t * 7);
      tgt(B.chest, 0.15 + s * 0.2, -0.3 + s * 0.2);
      armIK(pose, 'R', new THREE.Vector3(-0.1, 0.2 + s * 0.35, 0.3 + (1 - s) * 0.15), new THREE.Vector3(-0.8, -1, -0.3));
      armIK(pose, 'L', new THREE.Vector3(0.05, 0.15 + s * 0.35, 0.32 + (1 - s) * 0.15), new THREE.Vector3(0.8, -1, -0.3));
    }
    if (k < 0.999) for (let i = 0; i < N; i++) pose[i].copy(saved[i].slerp(pose[i], k));
  }

  /** The crowd's poses: at work, sat down (eating, playing), cooking, carrying, cheering. */
  function crowdPoseApply() {
    const k = w.pose;
    if (k < 0.01 || lastPose === 'stand') return;
    const p = lastPose;
    const saved = pose.slice(0, N).map((q) => q.clone());
    const tgt = (i, x, y = 0, z = 0) => { te.set(x, y, z); tq.setFromEuler(te); pose[i].copy(tq); };
    const V = (x, y, z) => tv3.set(x, y, z).clone();
    const poleL = V(0.8, -1, -0.3);
    const poleR = V(-0.8, -1, -0.3);
    let hipY = null;
    if (p === 'sit' || p === 'eat' || p === 'play') {
      tgt(B.hipL, -1.5, 0.06, 0.05); tgt(B.hipR, -1.5, -0.06, -0.05);
      tgt(B.kneeL, 1.5); tgt(B.kneeR, 1.5); tgt(B.ankleL, 0); tgt(B.ankleR, 0);
      tgt(B.hips, 0); tgt(B.spine, 0.04); tgt(B.chest, 0.04); tgt(B.neck, 0.02);
      hipY = 0.5;
      if (p === 'eat') {
        // A fork to the mouth every so often, the other hand on the table.
        const lift = Math.max(0, Math.sin(t * 2.4)) ** 2;
        armIK(pose, 'R', V(-0.12 + lift * 0.09, -0.08 + lift * 0.4, 0.34 - lift * 0.16), poleR);
        armIK(pose, 'L', V(0.14, -0.1, 0.32), poleL);
      } else if (p === 'play') {
        armIK(pose, 'L', V(0.12, -0.04, 0.4), poleL);
        armIK(pose, 'R', V(-0.12, -0.04 + Math.max(0, Math.sin(t * 1.7)) * 0.12, 0.4), poleR);
      } else {
        armIK(pose, 'L', V(0.1, -0.28, 0.28), poleL);
        armIK(pose, 'R', V(-0.1, -0.28, 0.28), poleR);
      }
    } else if (p === 'work') {
      // Bent over the ground, working at it.
      const s = Math.sin(t * 4);
      tgt(B.spine, 0.3 + s * 0.05); tgt(B.chest, 0.2 + s * 0.04); tgt(B.neck, -0.15); tgt(B.head, -0.1);
      tgt(B.hipL, -0.25, 0, 0.04); tgt(B.hipR, -0.25, 0, -0.04); tgt(B.kneeL, 0.4); tgt(B.kneeR, 0.4);
      tgt(B.ankleL, -0.15); tgt(B.ankleR, -0.15);
      hipY = 0.88;
      armIK(pose, 'L', V(0.06, -0.3 + s * 0.1, 0.42), poleL);
      armIK(pose, 'R', V(-0.04, -0.44 + s * 0.1, 0.38), poleR);
    } else if (p === 'cook') {
      armIK(pose, 'L', V(0.14, -0.12, 0.4), poleL);
      armIK(pose, 'R', V(-0.12 + Math.cos(t * 6) * 0.04, -0.1, 0.4 + Math.sin(t * 6) * 0.04), poleR);
      tgt(B.neck, 0.15);
    } else if (p === 'carry') {
      armIK(pose, 'R', V(-0.16, -0.06, 0.42), poleR);
    } else if (p === 'cheer') {
      const b = Math.abs(Math.sin(t * 10));
      armIK(pose, 'L', V(0.3, 0.62 + b * 0.05, 0.08), V(1, 0, -0.5));
      armIK(pose, 'R', V(-0.3, 0.62 + b * 0.05, 0.08), V(-1, 0, -0.5));
      hipsPos.y += b * 0.06 * k;
    }
    if (hipY != null) hipsPos.y += (hipY - hipsPos.y) * k;
    if (k < 0.999) for (let i = 0; i < N; i++) pose[i].copy(saved[i].slerp(pose[i], k));
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
    /** Busy with something: 'crack', 'spray', 'smash' (null to stop). */
    setAction(a) { action = a || null; },
    /** A sack of stolen money in the left hand. */
    setBag(on) {
      if (!!on === !!bag) return;
      if (on) {
        bag = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), pbr(0x5d7a2e, { roughness: 0.95 }));
        bag.scale.set(1, 1.15, 0.9);
        bag.position.set(0, -0.28, 0);
        bones[B.wristL].add(bag);
      } else {
        bones[B.wristL].remove(bag);
        bag.geometry.dispose();
        bag.material.dispose();
        bag = null;
      }
    },
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
    /** Far away people only animate every few frames, and wear the lighter body. */
    setDistance(d) {
      lodEvery = d > 90 ? 4 : d > 45 ? 2 : 1;
      const far = d > (mesh.visible ? 26 : 22);
      mesh.visible = !far;
      meshLo.visible = far;
    },
    /** What they are doing when stood still: 'stand', 'work', 'sit', 'eat', 'play', 'cook', 'carry', 'cheer'. */
    setPose(p) {
      crowdPose = p === 'walk' ? 'stand' : p || 'stand';
      if (crowdPose !== 'stand') lastPose = crowdPose;
    },
    get pose() { return crowdPose; },
    setName(n) {
      if (label) { group.remove(label); label.material.map.dispose(); label.material.dispose(); }
      label = labelSprite(n, tagColor, tagScale);
      label.position.y = 2.35;
      label.userData.base = { x: label.scale.x, y: label.scale.y };
      group.add(label);
      api.label = label;
    },
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
      ease('hold', gun && !seated && !action ? 1 : 0, 8);
      ease('aim', gun && aiming && !seated && !action ? 1 : 0, 12);
      ease('act', action ? 1 : 0, 8);
      ease('pose', crowdPose !== 'stand' && v <= 0.4 && !seated ? 1 : 0, 6);
      if (w.pose < 0.01 && crowdPose === 'stand') lastPose = 'stand';
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
      actionPose();
      crowdPoseApply();
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
      if (disposed) return;
      disposed = true;
      if (label) { label.material.map.dispose(); label.material.dispose(); }
      releaseMaterial(look);
      stick.geometry.dispose();
      ember.geometry.dispose();
    },
  };
  api.update(0.016);
  return api;
}

export { B as CHARACTER_BONES };
