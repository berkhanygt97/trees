import * as THREE from 'three';
import { surface, surfaceFor, registerSurface, mapsFromFields } from './gfx/surfaces.js';

const cache = new Map();

// Seeded randomness: every texture comes out exactly the same on every
// machine (and every load), so all players see the same bricks and grass.
let seed = 1;
function rand() {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function seedFrom(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  seed = h >>> 0;
}

function make(key, w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  if (cache.has(key)) return cache.get(key);
  seedFrom(key);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** Loud, unmistakably-a-casino carpet. */
export function carpetTexture() {
  return make('carpet', 256, 256, (g, w, h) => {
    g.fillStyle = '#4a0f22';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(255,255,255,${rand() * 0.05})`;
      g.fillRect(rand() * w, rand() * h, 2, 2);
    }
    const suits = ['♠', '♥', '♦', '♣'];
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const s = suits[(x + y) % 4];
        g.font = '44px serif';
        g.fillStyle = (x + y) % 2 ? 'rgba(242,193,78,0.33)' : 'rgba(224,64,58,0.30)';
        g.fillText(s, x * 64 + 32, y * 64 + 32);
      }
    }
    g.strokeStyle = 'rgba(242,193,78,0.14)';
    g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke();
    }
  }, { repeat: [14, 12] });
}

/** Dark panelled wall with a gold dado rail. */
export function wallTexture() {
  return make('wall', 256, 512, (g, w, h) => {
    g.fillStyle = '#1b1220';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) {
      const x = i * 42 + 6;
      g.fillStyle = i % 2 ? '#241730' : '#1f1429';
      g.fillRect(x, 0, 36, h);
      g.strokeStyle = 'rgba(242,193,78,0.10)';
      g.lineWidth = 1;
      g.strokeRect(x + 4, 40, 28, h - 120);
    }
    g.fillStyle = 'rgba(242,193,78,0.38)';
    g.fillRect(0, h - 70, w, 5);
    g.fillRect(0, 26, w, 3);
  }, { repeat: [10, 1] });
}

export function feltTexture(color = '#0f5c36') {
  return make('felt' + color, 128, 128, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = `rgba(0,0,0,${rand() * 0.12})`;
      g.fillRect(rand() * w, rand() * h, 1.5, 1.5);
    }
  }, { repeat: [3, 3] });
}

export function woodTexture() {
  return make('wood', 128, 128, (g, w, h) => {
    g.fillStyle = '#4b2a17';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 3) {
      g.fillStyle = `rgba(0,0,0,${0.05 + rand() * 0.12})`;
      g.fillRect(0, y, w, 1 + rand() * 2);
    }
  }, { repeat: [2, 2] });
}

/** Big glowing sign text, used for neon over each game area. */
export function signTexture(text, color = '#f2c14e', sub = '') {
  return make(`sign:${text}:${sub}:${color}`, 1024, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 40;
    g.fillStyle = color;
    g.font = 'bold 120px "Trebuchet MS", sans-serif';
    g.fillText(text, w / 2, sub ? h / 2 - 28 : h / 2);
    if (sub) {
      g.font = 'bold 46px "Trebuchet MS", sans-serif';
      g.shadowBlur = 20;
      g.fillStyle = '#ffffff';
      g.fillText(sub, w / 2, h / 2 + 62);
    }
  }, { repeat: [1, 1] });
}

/** Slot machine cabinet face. */
export function slotFaceTexture() {
  return make('slotface', 256, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#c2332e');
    grad.addColorStop(0.5, '#8e1f1c');
    grad.addColorStop(1, '#5c1210');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#14101c';
    g.fillRect(28, 150, w - 56, 150);
    g.strokeStyle = '#f2c14e';
    g.lineWidth = 5;
    g.strokeRect(28, 150, w - 56, 150);
    g.textAlign = 'center';
    g.font = 'bold 46px "Trebuchet MS", sans-serif';
    g.fillStyle = '#f2c14e';
    g.fillText('LUCKY', w / 2, 80);
    g.fillText('SEVENS', w / 2, 126);
    g.font = '58px serif';
    g.fillText('🍒', 70, 250);
    g.fillText('💎', 128, 250);
    g.fillText('7', 190, 252);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(20, 330, w - 40, 120);
    g.fillStyle = '#f7e6b0';
    g.font = 'bold 21px "Trebuchet MS", sans-serif';
    g.fillText('INSERT EVERYTHING', w / 2, 400);
  });
}

/** A label sprite that always faces the camera (player name tags). */
export function labelSprite(text, color = '#ffffff', scale = 1) {
  const cv = document.createElement('canvas');
  const pad = 24;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 64px "Trebuchet MS", sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  cv.width = w; cv.height = 128;
  const g = cv.getContext('2d');
  g.font = 'bold 64px "Trebuchet MS", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(8,6,12,0.72)';
  roundRect(g, 0, 22, w, 84, 18);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 4;
  roundRect(g, 2, 24, w - 4, 80, 16);
  g.stroke();
  g.fillStyle = '#ffffff';
  g.fillText(text, w / 2, 66);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set((w / 128) * 1.5 * scale, 1.5 * scale, 1);
  sprite.renderOrder = 999;
  return sprite;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** A live canvas you can repaint every frame (crash screen, leaderboard board). */
export function liveCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { canvas: cv, ctx: cv.getContext('2d'), texture: tex };
}

// ------------------------------------------------------------- outdoors

function speckle(g, w, h, n, colors, size = 2) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(rand() * colors.length) | 0];
    g.fillRect(rand() * w, rand() * h, size, size);
  }
}

export function grassTexture() {
  return make('grass', 256, 256, (g, w, h) => {
    g.fillStyle = '#4f8a3a';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 5000, ['#5c9a43', '#467d33', '#63a34a', '#3f7330', '#6fae52'], 2);
    speckle(g, w, h, 180, ['#e8e06a', '#f5f5f5', '#c9a0e0'], 2);
  }, { repeat: [140, 140] });
}

/**
 * Neutral ground for the terrain: light speckle and blades of grass, with no
 * colour of its own. The terrain's vertex colours paint it green, dry, dusty
 * or rocky, so one texture covers the whole valley.
 */
export function terrainTexture() {
  return surface('terrain', '#c8c8c8').map;
}

export function asphaltTexture() {
  return surface('asphalt', '#56565c').map;
}

export function pavingTexture() {
  return surface('paving', '#8d8578').map;
}

export function dirtTexture() {
  return surface('dirt', '#7a5a3a').map;
}

/** Plowed soil: dark furrows running across the tile. */
export function soilTexture() {
  return surface('soil', '#ffffff').map;
}

export function plankTexture(base = '#9b6b3d') {
  return surface('plank', base).map;
}

export function brickTexture(base = '#9c4a36') {
  return surface('brick', base).map;
}

/** A flat sign with a dark board, for shop fronts and farm gates. */
export function boardTexture(text, color = '#f2c14e', sub = '') {
  return make(`board:${text}:${sub}:${color}`, 1024, 256, (g, w, h) => {
    g.fillStyle = '#1d1622';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = color;
    g.lineWidth = 12;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.font = 'bold 110px "Trebuchet MS", sans-serif';
    g.fillText(text, w / 2, sub ? h / 2 - 26 : h / 2, w - 60);
    if (sub) {
      g.fillStyle = '#efe6d6';
      g.font = 'bold 44px "Trebuchet MS", sans-serif';
      g.fillText(sub, w / 2, h / 2 + 64, w - 60);
    }
  }, { repeat: [1, 1] });
}

/** Red and white kerb stripes for the race track. */
export function kerbTexture() {
  return make('kerb', 64, 16, (g, w, h) => {
    g.fillStyle = '#e8e8e8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d33a2c';
    g.fillRect(0, 0, w / 2, h);
  }, { repeat: [1, 1] });
}

export function checkerTexture() {
  return make('checker', 64, 64, (g, w, h) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  }, { repeat: [1, 1] });
}

/** Soft round glow, used for lamp light pools on the ground at night. */
export function glowTexture() {
  return make('glow', 128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,220,150,0.9)');
    grad.addColorStop(0.4, 'rgba(255,200,120,0.35)');
    grad.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, { repeat: [1, 1] });
}

// ======================================================= painted detail
// Small, busy, hand-painted-looking textures for clothes, faces, signs and
// props (the ground and the walls come from gfx/surfaces.js).

function noiseFill(g, w, h, base, amount = 0.12, n = 2400, size = 2) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = rand();
    g.fillStyle = v < 0.5 ? `rgba(0,0,0,${rand() * amount})` : `rgba(255,255,255,${rand() * amount * 0.7})`;
    g.fillRect(rand() * w, rand() * h, size, size);
  }
}

/** Flannel shirt check in the player's colour. */
export function plaidTexture(color = '#b83a2c') {
  return make(`plaid:${color}`, 128, 128, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.45;
    g.fillStyle = '#1a1414';
    for (let x = 0; x < w; x += 32) { g.fillRect(x, 0, 12, h); g.fillRect(0, x, w, 12); }
    g.globalAlpha = 0.25;
    g.fillStyle = '#ffffff';
    for (let x = 20; x < w; x += 32) { g.fillRect(x, 0, 2, h); g.fillRect(0, x, w, 2); }
    g.globalAlpha = 1;
    for (let i = 0; i < 1500; i++) {
      g.fillStyle = `rgba(0,0,0,${rand() * 0.1})`;
      g.fillRect(rand() * w, rand() * h, 1, 2);
    }
  }, { repeat: [2, 2] });
}

/** A loud holiday shirt: hibiscus, palm leaves and little palm trees on a base colour. */
export function hawaiiTexture(color = '#f5efe0', accent = '#e84393') {
  return make(`hawaii:${color}:${accent}`, 128, 128, (g, w, h) => {
    noiseFill(g, w, h, color, 0.05, 600, 2);
    const leaf = (x, y, a, len) => {
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.fillStyle = '#2f7a4a';
      g.beginPath(); g.ellipse(0, 0, len, len * 0.32, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(-len, 0); g.lineTo(len, 0); g.stroke();
      g.restore();
    };
    const flower = (x, y, r) => {
      g.fillStyle = accent;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.beginPath(); g.ellipse(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, r * 0.62, r * 0.42, a, 0, 7); g.fill();
      }
      g.fillStyle = '#f7d774';
      g.beginPath(); g.arc(x, y, r * 0.25, 0, 7); g.fill();
    };
    const palm = (x, y) => {
      g.strokeStyle = '#7a5230';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 3, y - 8, x + 1, y - 16); g.stroke();
      for (let i = 0; i < 5; i++) leaf(x + 1, y - 16, -Math.PI / 2 + (i - 2) * 0.7, 6);
    };
    // Tiled so the print wraps round the body without a seam.
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        const ox = tx * 64;
        const oy = ty * 64;
        leaf(ox + 14 + rand() * 6, oy + 42, rand() * 3, 11);
        leaf(ox + 44, oy + 12 + rand() * 6, rand() * 3, 10);
        flower(ox + 20, oy + 18, 8);
        flower(ox + 50, oy + 46, 7);
        palm(ox + 38, oy + 60);
        g.fillStyle = '#f2c14e';
        g.beginPath(); g.arc(ox + 6, oy + 58, 3, 0, 7); g.fill();
      }
    }
  });
}

/** Black leather: creases and a sheen. */
export function leatherTexture(color = '#1b1a1c') {
  return make(`leather:${color}`, 128, 128, (g, w, h) => {
    noiseFill(g, w, h, color, 0.08, 1400, 2);
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      const x = rand() * w;
      const y = rand() * h;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 6, y + (rand() - 0.5) * 6, x + 10 + rand() * 12, y + (rand() - 0.5) * 4); g.stroke();
    }
    const sheen = g.createLinearGradient(0, 0, w, 0);
    for (const [at, a] of [[0, 0], [0.3, 0.1], [0.4, 0], [0.6, 0], [0.7, 0.1], [1, 0]]) sheen.addColorStop(at, `rgba(255,255,255,${a})`);
    g.fillStyle = sheen;
    g.fillRect(0, 0, w, h);
  });
}

export function denimTexture() {
  return make('denim', 128, 128, (g, w, h) => {
    g.fillStyle = '#3b5578';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) {
      for (let x = (y % 4); x < w; x += 4) {
        g.fillStyle = `rgba(255,255,255,${0.04 + rand() * 0.06})`;
        g.fillRect(x, y, 1, 2);
      }
    }
    // Worn patches and a seam.
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(200,220,255,0.08)';
      g.beginPath(); g.ellipse(rand() * w, rand() * h, 14, 8, rand(), 0, 7); g.fill();
    }
    g.fillStyle = 'rgba(230,180,90,0.5)';
    g.fillRect(w - 6, 0, 2, h);
  }, { repeat: [1, 1] });
}

export function strawTexture() {
  return make('straw', 128, 128, (g, w, h) => {
    g.fillStyle = '#d8b560';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const x = rand() * w;
      const y = rand() * h;
      g.strokeStyle = rand() < 0.5 ? 'rgba(120,80,20,0.35)' : 'rgba(255,240,180,0.4)';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6 + rand() * 8, y + (rand() - 0.5) * 3); g.stroke();
    }
  }, { repeat: [2, 1] });
}

export function skinTexture(tone = '#d9a27a') {
  return make(`skin:${tone}`, 64, 64, (g, w, h) => {
    noiseFill(g, w, h, tone, 0.06, 500, 2);
    for (let i = 0; i < 20; i++) {
      g.fillStyle = 'rgba(150,60,40,0.06)';
      g.beginPath(); g.arc(rand() * w, rand() * h, 3 + rand() * 5, 0, 7); g.fill();
    }
  }, { repeat: [1, 1] });
}

/** A weathered old face, painted over a character's sculpted head. */
export function faceTexture(tone = '#d9a27a') {
  return make(`face:${tone}`, 256, 256, (g, w, h) => {
    noiseFill(g, w, h, tone, 0.05, 900, 2);
    // Cheeks and nose shading.
    const blush = (x, y, r, a) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(190,70,60,${a})`);
      gr.addColorStop(1, 'rgba(190,70,60,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    blush(80, 150, 30, 0.25); blush(176, 150, 30, 0.25); blush(128, 150, 18, 0.3);
    // The face occupies the middle of the texture (the front of the head).
    const eye = (x) => {
      // The opening between the lids (the eyeball itself is modelled).
      g.fillStyle = 'rgba(55,28,20,0.8)';
      g.beginPath(); g.ellipse(x, 118, 13, 7, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(80,40,30,0.8)';
      g.lineWidth = 2.5;
      g.beginPath(); g.ellipse(x, 118, 14, 8, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
      // Crow's feet: this farmer has been squinting at the sun for fifty years.
      g.strokeStyle = 'rgba(90,50,35,0.4)';
      g.lineWidth = 1.5;
      for (let k = -1; k <= 1; k++) {
        g.beginPath(); g.moveTo(x + (x < 128 ? -16 : 16), 118 + k * 4); g.lineTo(x + (x < 128 ? -26 : 26), 116 + k * 7); g.stroke();
      }
    };
    eye(96); eye(160);
    // Big bushy grey brows.
    g.fillStyle = '#d8d4cc';
    g.fillRect(78, 96, 36, 9);
    g.fillRect(142, 96, 36, 9);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(78, 104, 36, 2);
    g.fillRect(142, 104, 36, 2);
    // Nose.
    g.fillStyle = 'rgba(120,50,40,0.35)';
    g.beginPath(); g.moveTo(128, 118); g.lineTo(118, 160); g.lineTo(138, 160); g.closePath(); g.fill();
    // Forehead wrinkles.
    g.strokeStyle = 'rgba(100,50,35,0.35)';
    g.lineWidth = 2;
    for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(92, 70 + k * 9); g.quadraticCurveTo(128, 64 + k * 9, 164, 70 + k * 9); g.stroke(); }
  });
}

export function hideTexture() {
  return make('hide', 128, 128, (g, w, h) => {
    noiseFill(g, w, h, '#4a3326', 0.18, 2600, 2);
    g.strokeStyle = 'rgba(20,12,8,0.5)';
    for (let i = 0; i < 260; i++) {
      const x = rand() * w;
      const y = rand() * h;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 3, y + 5 + rand() * 5); g.stroke();
    }
  }, { repeat: [2, 1] });
}

function leafCard(g, w, h, pine) {
  g.clearRect(0, 0, w, h);
  const blobs = pine ? 90 : 160;
  for (let i = 0; i < blobs; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand());
    let x;
    let y;
    if (pine) {
      // A tall triangle of needles.
      y = rand() * h * 0.95 + h * 0.03;
      const half = (y / h) * w * 0.45;
      x = w / 2 + (rand() - 0.5) * 2 * half;
    } else {
      x = w / 2 + Math.cos(a) * r * w * 0.44;
      y = h / 2 + Math.sin(a) * r * h * 0.42;
    }
    const shade = 30 + rand() * 45;
    g.fillStyle = pine ? `hsl(${130 + rand() * 20}, 40%, ${shade * 0.6}%)` : `hsl(${85 + rand() * 40}, 45%, ${shade * 0.75}%)`;
    g.beginPath();
    g.ellipse(x, y, pine ? 7 : 9 + rand() * 6, pine ? 4 : 6 + rand() * 5, rand() * 3, 0, 7);
    g.fill();
  }
}

/** Alpha-tested leaf cards. */
export function leafTexture() {
  const t = make('leaves', 256, 256, (g, w, h) => leafCard(g, w, h, false));
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function pineTexture() {
  const t = make('pine', 128, 256, (g, w, h) => leafCard(g, w, h, true));
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function grassTuftTexture() {
  const t = make('tuft', 64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = 6 + rand() * (w - 12);
      const tall = 20 + rand() * 40;
      g.strokeStyle = `hsl(${80 + rand() * 30}, 45%, ${28 + rand() * 22}%)`;
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + (rand() - 0.5) * 8, h - tall / 2, x + (rand() - 0.5) * 14, h - tall); g.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function cloudTexture() {
  const t = make('clouds', 512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const r = 20 + rand() * 60;
      for (let k = 0; k < 8; k++) {
        const gx = x + (rand() - 0.5) * r * 2;
        const gy = y + (rand() - 0.5) * r * 0.8;
        const gr = g.createRadialGradient(gx, gy, 0, gx, gy, r * 0.7);
        gr.addColorStop(0, 'rgba(255,255,255,0.32)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(gx - r, gy - r, r * 2, r * 2);
      }
    }
  }, { repeat: [3, 3] });
  return t;
}

export function roofTileTexture(base = '#8a3a2a') {
  return surface('rooftile', base).map;
}

export function metalTexture(base = '#8a8f96') {
  return surface('metal', base).map;
}

export function plasterTexture(base = '#e6dcc8') {
  return surface('plaster', base).map;
}

/** Soft dark disc for blob shadows under cars, people and boars. */
export function shadowTexture() {
  return make('shadow', 64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)');
    gr.addColorStop(0.6, 'rgba(0,0,0,0.3)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }, { repeat: [1, 1] });
}

export function woodGrainTexture(base = '#6b3f22') {
  return make(`grain:${base}`, 128, 32, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 1) {
      g.fillStyle = `rgba(0,0,0,${rand() * 0.18})`;
      g.fillRect(0, y, w, 1);
    }
    for (let i = 0; i < 12; i++) {
      g.strokeStyle = 'rgba(30,15,5,0.3)';
      g.beginPath(); g.ellipse(rand() * w, rand() * h, 10, 2, 0, 0, 7); g.stroke();
    }
  }, { repeat: [1, 1] });
}

export function gunMetalTexture() {
  return make('gunmetal', 64, 64, (g, w, h) => noiseFill(g, w, h, '#2c2f34', 0.1, 600, 1), { repeat: [1, 1] });
}

export function dashTexture() {
  return make('dash', 128, 128, (g, w, h) => noiseFill(g, w, h, '#26262a', 0.07, 1400, 1), { repeat: [2, 1] });
}

// ================================================== sunset strip (2.2)

/** Neon tube lettering on a dark backing: the Vice City night look. */
export function neonSignTexture(text, color = '#ff3d9a', sub = '') {
  return make(`neon:${text}:${sub}:${color}`, 1024, 256, (g, w, h) => {
    g.fillStyle = '#120c18';
    g.fillRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const draw = (t, y, size) => {
      g.font = `italic 900 ${size}px "Trebuchet MS", "Arial Black", sans-serif`;
      // Glow in layers, then the white-hot tube core.
      for (const [blur, alpha] of [[40, 0.5], [22, 0.7], [10, 0.9]]) {
        g.shadowColor = color;
        g.shadowBlur = blur;
        g.fillStyle = color;
        g.globalAlpha = alpha;
        g.fillText(t, w / 2, y, w - 70);
      }
      g.globalAlpha = 1;
      g.shadowBlur = 6;
      g.fillStyle = '#fff4fb';
      g.fillText(t, w / 2, y, w - 70);
      g.shadowBlur = 0;
    };
    draw(text, sub ? h * 0.42 : h / 2, sub ? 104 : 120);
    if (sub) draw(sub, h * 0.8, 40);
    g.strokeStyle = color;
    g.lineWidth = 6;
    g.globalAlpha = 0.8;
    g.strokeRect(14, 14, w - 28, h - 28);
    g.globalAlpha = 1;
  });
}

/** Diner floor tiles with grout lines. */
export function tileFloorTexture(a = '#ffffff', b = '#ff5fa8') {
  return make(`tiles:${a}:${b}`, 128, 128, (g, w, h) => {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        g.fillStyle = (x + y) % 2 ? b : a;
        g.fillRect(x * 32, y * 32, 32, 32);
      }
    }
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * 32); g.lineTo(w, i * 32); g.stroke();
    }
  }, { repeat: [4, 4] });
}

/** Pastel stucco with art-deco speed lines near the top. */
export function decoWallTexture(base = '#7fe7d9', trim = '#ff5fa8') {
  return make(`deco:${base}:${trim}`, 256, 256, (g, w, h) => {
    noiseFill(g, w, h, base, 0.06, 1800, 2);
    g.fillStyle = trim;
    for (const [y, t] of [[18, 10], [36, 5], [48, 3]]) g.fillRect(0, y, w, t);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(0, h - 26, w, 6);
  }, { repeat: [1, 1] });
}

/** Striped canvas awning. */
export function awningTexture(a = '#ffffff', b = '#ff5fa8') {
  return make(`awning:${a}:${b}`, 128, 32, (g, w, h) => {
    for (let x = 0; x < 8; x++) {
      g.fillStyle = x % 2 ? b : a;
      g.fillRect(x * 16, 0, 16, h);
    }
    g.fillStyle = 'rgba(0,0,0,0.15)';
    g.fillRect(0, h - 5, w, 5);
  }, { repeat: [4, 1] });
}

/** A chalk menu board: dishes and prices. Not cached; menus change. */
export function menuBoardTexture(title, lines, color = '#ffd24a') {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 384;
  const g = cv.getContext('2d');
  g.fillStyle = '#1f2a24';
  g.fillRect(0, 0, 512, 384);
  g.strokeStyle = '#8a5a2b';
  g.lineWidth = 14;
  g.strokeRect(7, 7, 498, 370);
  g.fillStyle = color;
  g.font = 'bold 44px "Trebuchet MS", sans-serif';
  g.textAlign = 'center';
  g.fillText(title, 256, 58);
  g.font = 'bold 30px "Trebuchet MS", sans-serif';
  lines.slice(0, 6).forEach(([name, price], i) => {
    const y = 110 + i * 46;
    g.textAlign = 'left';
    g.fillStyle = '#f2efe6';
    g.fillText(name, 34, y, 330);
    g.textAlign = 'right';
    g.fillStyle = color;
    g.fillText(price, 478, y);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// -------------------------------------------------------------- facades
//
// Building fronts: one texture tile covers 4 x 4 window bays (each bay 4 m
// wide, 3.5 m tall). Every style also has a night texture: the same tile with
// some windows lit warm yellow, used as the emissive map after dark.

const FACADES = {
  tower:    { wall: '#5d7686', frame: '#3b4a55', glass: ['#2f5670', '#3d6d8a', '#274a60'], win: [0.08, 0.1, 0.84, 0.82], band: null },
  office:   { wall: '#c9c2b4', frame: '#8e877b', glass: ['#34495a', '#3e5668', '#2c3e4d'], win: [0.1, 0.28, 0.8, 0.5], band: '#a39c90' },
  hotel:    { wall: '#e8c3a8', frame: '#b48a70', glass: ['#3a4f6a', '#476080', '#2f425a'], win: [0.28, 0.2, 0.44, 0.6], band: '#d4a88c' },
  hospital: { wall: '#eef0ee', frame: '#b9c3c8', glass: ['#6f9fbd', '#5f8fad', '#7aaac6'], win: [0.14, 0.24, 0.72, 0.5], band: '#d8e0e2' },
  motel:    { wall: '#f4d9a8', frame: '#c98a5a', glass: ['#35506a', '#40607e', '#2f4660'], win: [0.52, 0.3, 0.34, 0.36], door: '#2f7a8a' },
  store:    { wall: '#d9c7a4', frame: '#8a6a45', glass: ['#3a5570', '#446280', '#324a60'], win: [0.08, 0.3, 0.84, 0.5], band: '#b89a6a' },
  brick:    { wall: '#9c5a44', frame: '#6d3a2a', glass: ['#34485c', '#3d556c', '#2c3c4e'], win: [0.22, 0.22, 0.56, 0.56], band: null },
};

export function facadeTexture(style) {
  const f = FACADES[style] || FACADES.office;
  const tex = make(`facade:${style}`, 256, 256, (g, w, h) => {
    const bw = w / 4;
    const bh = h / 4;
    g.fillStyle = f.wall;
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2500, ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.06)'], 2);
    for (let j = 0; j < 4; j++) {
      if (f.band) { g.fillStyle = f.band; g.fillRect(0, j * bh + bh * 0.9, w, bh * 0.1); }
      for (let i = 0; i < 4; i++) {
        const [wx, wy, ww, wh] = f.win;
        const x = i * bw + wx * bw;
        const y = j * bh + wy * bh;
        g.fillStyle = f.frame;
        g.fillRect(x - 2, y - 2, ww * bw + 4, wh * bh + 4);
        // Dark glass: the sky it reflects comes from the lighting, not the paint.
        const c = f.glass[(rand() * f.glass.length) | 0];
        g.fillStyle = c;
        g.fillRect(x, y, ww * bw, wh * bh);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(x, y, ww * bw, wh * bh * 0.5);
        // Mullion.
        g.fillStyle = f.frame;
        g.fillRect(x + (ww * bw) / 2 - 1, y, 2, wh * bh);
        if (f.door) {
          g.fillStyle = f.door;
          g.fillRect(i * bw + bw * 0.12, j * bh + bh * 0.25, bw * 0.28, bh * 0.75);
          g.fillStyle = '#e8d8b0';
          g.fillRect(i * bw + bw * 0.22, j * bh + bh * 0.12, bw * 0.08, bh * 0.08);
        }
      }
    }
  });
  if (!surfaceFor(tex)) registerSurface(tex, facadeMaps(f, 256));
  return tex;
}

/**
 * Relief and shine for a facade tile, from the same layout the painter uses:
 * glass recessed behind its frame and smooth enough to mirror the sky, walls
 * rough, bands and sills standing proud.
 */
function facadeMaps(f, n) {
  const height = new Float32Array(n * n).fill(0.8);
  const rough = new Float32Array(n * n).fill(0.86);
  const rect = (x0, y0, w, h, ht, r) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(n, Math.ceil(y0 + h)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(n, Math.ceil(x0 + w)); x++) { height[y * n + x] = ht; rough[y * n + x] = r; }
    }
  };
  for (let i = 0; i < n * n; i++) height[i] += (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.02;
  const bw = n / 4;
  const bh = n / 4;
  for (let j = 0; j < 4; j++) {
    if (f.band) rect(0, j * bh + bh * 0.9, n, bh * 0.1, 0.95, 0.8);
    for (let i = 0; i < 4; i++) {
      const [wx, wy, ww, wh] = f.win;
      const x = i * bw + wx * bw;
      const y = j * bh + wy * bh;
      rect(x - 3, y - 3, ww * bw + 6, wh * bh + 6, 0.9, 0.45);       // frame
      rect(x - 4, y + wh * bh + 2, ww * bw + 8, 3, 1, 0.7);           // sill
      rect(x, y, ww * bw, wh * bh, 0.35, 0.04);                        // glass
      rect(x + (ww * bw) / 2 - 1, y, 2, wh * bh, 0.8, 0.45);           // mullion
      if (f.door) rect(i * bw + bw * 0.12, j * bh + bh * 0.25, bw * 0.28, bh * 0.75, 0.55, 0.55);
    }
  }
  return mapsFromFields(n, n, height, rough, 5);
}

/** The same tile at night: some windows lit, the rest dark. */
export function facadeNightTexture(style) {
  const f = FACADES[style] || FACADES.office;
  return make(`facade-night:${style}`, 256, 256, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    const bw = w / 4;
    const bh = h / 4;
    const lit = style === 'hospital' ? 0.7 : style === 'motel' ? 0.45 : 0.38;
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        if (rand() > lit) continue;
        const [wx, wy, ww, wh] = f.win;
        const warm = ['#ffd98a', '#fff1c4', '#ffc870', '#cfe8ff'][(rand() * 4) | 0];
        g.fillStyle = warm;
        g.fillRect(i * bw + wx * bw, j * bh + wy * bh, ww * bw, wh * bh);
      }
    }
  }, { srgb: true });
}

/** Tar-and-gravel flat roof. */
export function roofGravelTexture() {
  return surface('gravel', '#6c6862').map;
}

/** A shop front: big glass, a door, and a sign band left blank for the sign. */
export function shopfrontTexture(color = '#d9c7a4') {
  const tex = make(`shopfront:${color}`, 256, 128, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 800, ['rgba(0,0,0,0.07)', 'rgba(255,255,255,0.07)'], 2);
    g.fillStyle = '#2a2a2e';
    g.fillRect(8, 40, w - 16, h - 44);
    const gr = g.createLinearGradient(0, 40, 0, h);
    gr.addColorStop(0, '#5a7a90');
    gr.addColorStop(0.5, '#a8c4d4');
    gr.addColorStop(1, '#3c5566');
    g.fillStyle = gr;
    g.fillRect(12, 44, w - 24, h - 52);
    g.fillStyle = '#2a2a2e';
    for (let x = 12 + (w - 24) / 3; x < w - 12; x += (w - 24) / 3) g.fillRect(x - 2, 44, 4, h - 52);
  });
  if (!surfaceFor(tex)) {
    // The big window is glass: set back and glossy.
    const w = 256;
    const h = 128;
    const height = new Float32Array(w * h).fill(0.8);
    const rough = new Float32Array(w * h).fill(0.85);
    for (let y = 40; y < h - 4; y++) {
      for (let x = 8; x < w - 8; x++) {
        const glass = y >= 44 && y < h - 8 && x >= 12 && x < w - 12;
        height[y * w + x] = glass ? 0.3 : 0.6;
        rough[y * w + x] = glass ? 0.04 : 0.4;
      }
    }
    registerSurface(tex, mapsFromFields(w, h, height, rough, 4));
  }
  return tex;
}

/**
 * A gang's tag, spray-painted: fat outlined letters in their colour, a
 * highlight, drips and overspray. Transparent round it, for a wall decal.
 */
export function graffitiTexture(text, color = '#e84393', seed = 1) {
  const key = `graffiti:${text}:${color}:${seed}`;
  if (cache.has(key)) return cache.get(key);
  seedFrom(key);
  const W = 512;
  const H = 208;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const words = String(text).toUpperCase().slice(0, 22);
  let size = 96;
  g.font = `italic 900 ${size}px Impact, "Arial Black", sans-serif`;
  while (g.measureText(words).width > W * 0.9 && size > 30) { size -= 4; g.font = `italic 900 ${size}px Impact, "Arial Black", sans-serif`; }
  g.translate(W / 2, H / 2 + size * 0.3);
  g.rotate((rand() - 0.5) * 0.12);
  g.textAlign = 'center';
  // Overspray haze behind the letters.
  g.shadowColor = color;
  g.shadowBlur = 24;
  g.lineJoin = 'round';
  g.lineWidth = size * 0.22;
  g.strokeStyle = '#111';
  g.strokeText(words, 0, 0);
  g.shadowBlur = 0;
  g.fillStyle = color;
  g.fillText(words, 0, 0);
  // A white highlight across the top of the letters.
  g.save();
  g.beginPath();
  g.rect(-W, -size * 0.95, W * 2, size * 0.28);
  g.clip();
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillText(words, 0, 0);
  g.restore();
  // Drips.
  g.fillStyle = color;
  const w = g.measureText(words).width;
  for (let i = 0; i < 9; i++) {
    const x = -w / 2 + rand() * w;
    const len = 8 + rand() * 38;
    g.fillRect(x, -size * 0.05, 3, len);
    g.beginPath(); g.arc(x + 1.5, -size * 0.05 + len, 2.6, 0, 7); g.fill();
  }
  // Stars and a crown, the way crews sign off.
  g.fillStyle = '#fff';
  g.font = `900 ${Math.round(size * 0.4)}px Impact, sans-serif`;
  g.fillText('★', w / 2 + size * 0.25, -size * 0.7);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}
