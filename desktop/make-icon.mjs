// Draws the app icon as a 512x512 PNG with nothing but zlib — same rule as the
// rest of the project: no binary assets checked in that we can't regenerate.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 512;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG_TOP = hex('#3a1024');
const BG_BOT = hex('#0d0714');
const CHIP = hex('#c2332e');
const CHIP_DARK = hex('#8e1f1c');
const GOLD = hex('#f2c14e');
const CREAM = hex('#fdf6e4');

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

const S_R = 0.4;
const S_T = 0.125;

/** Is (px,py) on the arc of a circle, between two bearings in degrees? */
function onArc(px, py, cx, cy, from, to) {
  const dx = px - cx;
  const dy = py - cy;
  if (Math.abs(Math.hypot(dx, dy) - S_R) > S_T) return false;
  const t = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  return from <= to ? t >= from && t <= to : t >= from || t <= to;
}

/** Colour of one sample point; the caller supersamples for antialiasing. */
function shade(x, y) {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);

  // Rounded-square background with a vertical gradient.
  let color = mix(BG_TOP, BG_BOT, y / SIZE);

  const CHIP_R = 205;
  const RING_R = 158;

  if (r <= CHIP_R) {
    // Six cream edge spots, the classic poker chip.
    const spoke = Math.abs(((angle / (Math.PI / 3)) % 1 + 1) % 1 - 0.5);
    const inSpot = r > RING_R + 6 && spoke < 0.17;
    color = inSpot ? CREAM : (r > RING_R ? CHIP : CHIP_DARK);

    if (r > RING_R - 9 && r <= RING_R) color = GOLD;

    // Inner face: a gold ring around a big "$".
    if (r <= RING_R - 9) {
      color = mix(CHIP_DARK, [26, 18, 34], 0.55);
      if (r > 128) color = GOLD;

      // A dollar sign built from two arcs and a bar, in units of 74px.
      const sx = (x - cx) / 74;
      const sy = (y - cy) / 74;
      const bar = Math.abs(sx) < 0.115 && Math.abs(sy) < 1.05;
      const top = onArc(sx, sy, 0, -0.4, 90, 345);
      const bot = onArc(sx, sy, 0, 0.4, 265, 165);
      if (bar || top || bot) color = GOLD;
    }
  }

  return color;
}

function render() {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  const corner = 96;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // 2x2 supersample so the curves don't look chewed.
      let r = 0; let g = 0; let b = 0;
      for (const oy of [0.25, 0.75]) {
        for (const ox of [0.25, 0.75]) {
          const c = shade(x + ox, y + oy);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      // Rounded corners on the tile itself.
      const qx = Math.max(corner - x, x - (SIZE - corner), 0);
      const qy = Math.max(corner - y, y - (SIZE - corner), 0);
      const outside = Math.hypot(qx, qy) - corner;
      const alpha = Math.round(255 * Math.min(1, Math.max(0, 1 - outside)));

      const i = (y * SIZE + x) * 4;
      px[i] = r / 4; px[i + 1] = g / 4; px[i + 2] = b / 4; px[i + 3] = alpha;
    }
  }
  return px;
}

function png(pixels) {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;   // filter: none
    pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (const byte of buf) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png(render()));
console.log(`wrote ${OUT} (${SIZE}x${SIZE})`);
