import * as THREE from 'three';

const cache = new Map();

function make(key, w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  if (cache.has(key)) return cache.get(key);
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
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
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
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
  }, { repeat: [3, 3] });
}

export function woodTexture() {
  return make('wood', 128, 128, (g, w, h) => {
    g.fillStyle = '#4b2a17';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 3) {
      g.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.12})`;
      g.fillRect(0, y, w, 1 + Math.random() * 2);
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
    g.fillStyle = colors[(Math.random() * colors.length) | 0];
    g.fillRect(Math.random() * w, Math.random() * h, size, size);
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

export function asphaltTexture() {
  return make('asphalt', 128, 128, (g, w, h) => {
    g.fillStyle = '#3a3a40';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2400, ['#44444b', '#2f2f35', '#505058'], 1.5);
  }, { repeat: [1, 1] });
}

export function pavingTexture() {
  return make('paving', 128, 128, (g, w, h) => {
    g.fillStyle = '#8d8578';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(40,34,28,0.45)';
    g.lineWidth = 2;
    for (let y = 0; y <= h; y += 32) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      const off = (y / 32) % 2 ? 16 : 0;
      for (let x = off; x <= w; x += 32) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke(); }
    }
    speckle(g, w, h, 600, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.06)'], 2);
  }, { repeat: [1, 1] });
}

export function dirtTexture() {
  return make('dirt', 128, 128, (g, w, h) => {
    g.fillStyle = '#7a5a3a';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2200, ['#86643f', '#6b4e31', '#8f6d47', '#5e432a'], 2);
  }, { repeat: [1, 1] });
}

/** Plowed soil: dark furrows running across the tile. */
export function soilTexture() {
  return make('soil', 64, 64, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) {
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(0, y + 5, w, 3);
    }
    speckle(g, w, h, 300, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.12)'], 2);
  }, { repeat: [1, 1] });
}

export function plankTexture(base = '#9b6b3d') {
  return make('plank' + base, 128, 128, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x, 0, 2, h);
      for (let y = 0; y < h; y += 3) {
        g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
        g.fillRect(x + 2, y, 14, 1);
      }
    }
  }, { repeat: [1, 1] });
}

export function brickTexture(base = '#9c4a36') {
  return make('brick' + base, 128, 128, (g, w, h) => {
    g.fillStyle = '#d8cbb8';
    g.fillRect(0, 0, w, h);
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? 16 : 0;
      for (let x = -16; x < w; x += 32) {
        g.fillStyle = base;
        g.globalAlpha = 0.85 + Math.random() * 0.15;
        g.fillRect(x + off + 1, row * 16 + 1, 30, 14);
      }
    }
    g.globalAlpha = 1;
  }, { repeat: [1, 1] });
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

// ======================================================= PS2-era detail
// Small, busy, hand-painted-looking textures: the trick that made low-poly
// games look good was always the texture work, not the triangle count.

function noiseFill(g, w, h, base, amount = 0.12, n = 2400, size = 2) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? `rgba(0,0,0,${Math.random() * amount})` : `rgba(255,255,255,${Math.random() * amount * 0.7})`;
    g.fillRect(Math.random() * w, Math.random() * h, size, size);
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
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.1})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1, 2);
    }
  }, { repeat: [2, 2] });
}

export function denimTexture() {
  return make('denim', 128, 128, (g, w, h) => {
    g.fillStyle = '#3b5578';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) {
      for (let x = (y % 4); x < w; x += 4) {
        g.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.06})`;
        g.fillRect(x, y, 1, 2);
      }
    }
    // Worn patches and a seam.
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(200,220,255,0.08)';
      g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 14, 8, Math.random(), 0, 7); g.fill();
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
      const x = Math.random() * w;
      const y = Math.random() * h;
      g.strokeStyle = Math.random() < 0.5 ? 'rgba(120,80,20,0.35)' : 'rgba(255,240,180,0.4)';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6 + Math.random() * 8, y + (Math.random() - 0.5) * 3); g.stroke();
    }
  }, { repeat: [2, 1] });
}

export function skinTexture(tone = '#d9a27a') {
  return make(`skin:${tone}`, 64, 64, (g, w, h) => {
    noiseFill(g, w, h, tone, 0.06, 500, 2);
    for (let i = 0; i < 20; i++) {
      g.fillStyle = 'rgba(150,60,40,0.06)';
      g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 3 + Math.random() * 5, 0, 7); g.fill();
    }
  }, { repeat: [1, 1] });
}

/** A weathered old face: painted on, PS2-style, rather than modelled. */
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
      g.fillStyle = '#f4efe6';
      g.beginPath(); g.ellipse(x, 118, 13, 7, 0, 0, 7); g.fill();
      g.fillStyle = '#4a6a8a';
      g.beginPath(); g.arc(x, 118, 6, 0, 7); g.fill();
      g.fillStyle = '#111';
      g.beginPath(); g.arc(x, 118, 3, 0, 7); g.fill();
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
      const x = Math.random() * w;
      const y = Math.random() * h;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 3, y + 5 + Math.random() * 5); g.stroke();
    }
  }, { repeat: [2, 1] });
}

function leafCard(g, w, h, pine) {
  g.clearRect(0, 0, w, h);
  const blobs = pine ? 90 : 160;
  for (let i = 0; i < blobs; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random());
    let x;
    let y;
    if (pine) {
      // A tall triangle of needles.
      y = Math.random() * h * 0.95 + h * 0.03;
      const half = (y / h) * w * 0.45;
      x = w / 2 + (Math.random() - 0.5) * 2 * half;
    } else {
      x = w / 2 + Math.cos(a) * r * w * 0.44;
      y = h / 2 + Math.sin(a) * r * h * 0.42;
    }
    const shade = 30 + Math.random() * 45;
    g.fillStyle = pine ? `hsl(${130 + Math.random() * 20}, 40%, ${shade * 0.6}%)` : `hsl(${85 + Math.random() * 40}, 45%, ${shade * 0.75}%)`;
    g.beginPath();
    g.ellipse(x, y, pine ? 7 : 9 + Math.random() * 6, pine ? 4 : 6 + Math.random() * 5, Math.random() * 3, 0, 7);
    g.fill();
  }
}

/** Alpha-tested foliage cards, the way every PS2 tree was drawn. */
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
      const x = 6 + Math.random() * (w - 12);
      const tall = 20 + Math.random() * 40;
      g.strokeStyle = `hsl(${80 + Math.random() * 30}, 45%, ${28 + Math.random() * 22}%)`;
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + (Math.random() - 0.5) * 8, h - tall / 2, x + (Math.random() - 0.5) * 14, h - tall); g.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function cloudTexture() {
  const t = make('clouds', 512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 20 + Math.random() * 60;
      for (let k = 0; k < 8; k++) {
        const gx = x + (Math.random() - 0.5) * r * 2;
        const gy = y + (Math.random() - 0.5) * r * 0.8;
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
  return make(`roof:${base}`, 128, 128, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let row = 0; row < 8; row++) {
      const y = row * 16;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, y + 13, w, 3);
      for (let x = (row % 2) * 8; x < w; x += 16) {
        g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.12})`;
        g.fillRect(x, y, 15, 13);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(x + 15, y, 1, 13);
      }
    }
  }, { repeat: [1, 1] });
}

export function metalTexture(base = '#8a8f96') {
  return make(`metal:${base}`, 128, 128, (g, w, h) => {
    noiseFill(g, w, h, base, 0.08, 1200, 2);
    // Corrugation.
    for (let x = 0; x < w; x += 8) {
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(x, 0, 3, h);
      g.fillStyle = 'rgba(0,0,0,0.15)';
      g.fillRect(x + 5, 0, 2, h);
    }
    // Rust streaks.
    for (let i = 0; i < 10; i++) {
      g.fillStyle = 'rgba(140,70,30,0.25)';
      g.fillRect(Math.random() * w, Math.random() * h * 0.5, 2 + Math.random() * 3, 20 + Math.random() * 60);
    }
  }, { repeat: [1, 1] });
}

export function plasterTexture(base = '#e6dcc8') {
  return make(`plaster:${base}`, 128, 128, (g, w, h) => {
    noiseFill(g, w, h, base, 0.07, 2000, 2);
    g.fillStyle = 'rgba(80,60,40,0.12)';
    g.fillRect(0, h - 18, w, 18);   // grime near the ground
  }, { repeat: [1, 1] });
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
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`;
      g.fillRect(0, y, w, 1);
    }
    for (let i = 0; i < 12; i++) {
      g.strokeStyle = 'rgba(30,15,5,0.3)';
      g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 10, 2, 0, 0, 7); g.stroke();
    }
  }, { repeat: [1, 1] });
}

export function gunMetalTexture() {
  return make('gunmetal', 64, 64, (g, w, h) => noiseFill(g, w, h, '#2c2f34', 0.1, 600, 1), { repeat: [1, 1] });
}

export function dashTexture() {
  return make('dash', 128, 128, (g, w, h) => noiseFill(g, w, h, '#26262a', 0.07, 1400, 1), { repeat: [2, 1] });
}
