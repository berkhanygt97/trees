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
