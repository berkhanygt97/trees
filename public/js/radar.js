import { BOUNDS, CASINO, PLOTS, PLOT_SIZE, STATIC_BOXES, TRACK, DOWNTOWN } from '/shared/map.js';
import { ALL_ROADS } from '/shared/roads.js';
import { HOODS, HQS, PARKS, hoodAt } from '/shared/hoods.js';
import { BUILDINGS } from '/shared/downtown.js';

// The radar in the bottom-left corner, the way San Andreas had it: a round
// map that turns with the camera, your arrow in the middle, blips for
// everyone else, and your hood tinted in your colour (or the colour of whoever
// took it in a war).
//
// The whole valley is drawn once into a big canvas (redrawn when a hood
// changes hands); every frame just turns and crops it. The full-screen map
// (M) draws the same canvas north-up, with names on it.

const PAD = 60;                          // metres of map drawn past the edge of the world
const PX = 1.25;                         // canvas pixels per metre of the base map
const W = Math.ceil((BOUNDS.maxX - BOUNDS.minX + PAD * 2) * PX);
const H = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ + PAD * 2) * PX);
const mx = (x) => (x - BOUNDS.minX + PAD) * PX;
const mz = (z) => (z - BOUNDS.minZ + PAD) * PX;
const SA_FONT = 'Impact, Haettenschweiler, "Arial Narrow Bold", "Arial Black", sans-serif';
const TITLE_FONT = '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
const UI_FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

export class Radar {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = W;
    this.base.height = H;
    this.hoods = HOODS.map(() => null);     // { color, owner, holder } per hood
    this.blips = new Map();                 // key -> [{ x, z, color, shape, size, edge, yaw }]
    this.range = 110;
    this._draw();
  }

  /** Who owns which hood (plots from the server): tints the map. */
  setHoods(list) {
    let changed = false;
    for (const p of list || []) {
      if (!p || p.index == null || p.index < 0 || p.index >= HOODS.length) continue;
      const next = p.owner ? { owner: p.owner, color: p.color, holder: p.holderColor || null, gang: p.gang || '', holderGang: p.holder || '' } : null;
      if (JSON.stringify(next) !== JSON.stringify(this.hoods[p.index])) { this.hoods[p.index] = next; changed = true; }
    }
    if (changed) this._draw();
  }

  /** A layer of blips (players, raiders, the delivery beacon...), replaced wholesale. */
  setBlips(key, list) { this.blips.set(key, list || []); }

  _draw() {
    const g = this.base.getContext('2d');
    // Countryside.
    g.fillStyle = '#56663f';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#4b5a37';
    for (let i = 0; i < 400; i++) {
      const x = (Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) % 1;
      const z = (Math.sin(i * 78.233) * 12543.1234 % 1 + 1) % 1;
      g.beginPath(); g.arc(x * W, z * H, 6 + (i % 7) * 3, 0, 7); g.fill();
    }
    // Downtown pavement.
    g.fillStyle = '#6d6a62';
    g.fillRect(mx(DOWNTOWN.x0), mz(DOWNTOWN.z0), (DOWNTOWN.x1 - DOWNTOWN.x0) * PX, (DOWNTOWN.z1 - DOWNTOWN.z0) * PX);
    // Hoods: their ground, tinted by whoever runs them.
    HOODS.forEach((h, i) => {
      const own = this.hoods[i];
      g.fillStyle = '#617247';
      g.fillRect(mx(h.x0), mz(h.z0), (h.x1 - h.x0) * PX, (h.z1 - h.z0) * PX);
      if (own) {
        g.globalAlpha = 0.28;
        g.fillStyle = own.holder || own.color;
        g.fillRect(mx(h.x0), mz(h.z0), (h.x1 - h.x0) * PX, (h.z1 - h.z0) * PX);
        g.globalAlpha = 1;
        if (own.holder) {
          // Held by another gang after a war: hatched in their colour.
          g.strokeStyle = own.holder;
          g.lineWidth = 3;
          for (let d = 0; d < (h.x1 - h.x0) + (h.z1 - h.z0); d += 14) {
            g.beginPath();
            g.moveTo(mx(h.x0 + d), mz(h.z0));
            g.lineTo(mx(h.x0 + d - (h.z1 - h.z0)), mz(h.z1));
            g.stroke();
          }
        }
      }
    });
    // Parks and farm plots.
    g.fillStyle = '#4f8a3c';
    for (const p of PARKS) g.fillRect(mx(p.x0), mz(p.z0), (p.x1 - p.x0) * PX, (p.z1 - p.z0) * PX);
    g.fillStyle = '#8a7446';
    for (const p of PLOTS) g.fillRect(mx(p.x0), mz(p.z0), PLOT_SIZE * PX, PLOT_SIZE * PX);
    // The racetrack loop.
    g.strokeStyle = '#8f8f88';
    g.lineWidth = TRACK.width * PX;
    g.beginPath();
    g.ellipse(mx(TRACK.cx), mz(TRACK.cz), (TRACK.half + TRACK.r) * PX * 0.8, TRACK.r * PX, 0, 0, Math.PI * 2);
    g.stroke();
    // Roads, with a darker edge.
    for (const r of ALL_ROADS) {
      g.fillStyle = '#2f2f2c';
      g.fillRect(mx(r.x0) - 1.5, mz(r.z0) - 1.5, (r.x1 - r.x0) * PX + 3, (r.z1 - r.z0) * PX + 3);
    }
    for (const r of ALL_ROADS) {
      g.fillStyle = r.kind === 'avenue' ? '#c9c4b4' : '#aaa69a';
      g.fillRect(mx(r.x0), mz(r.z0), (r.x1 - r.x0) * PX, (r.z1 - r.z0) * PX);
    }
    // Buildings.
    g.fillStyle = '#2d2a30';
    for (const b of STATIC_BOXES) {
      if ((b.x1 - b.x0) < 1.2 && (b.z1 - b.z0) < 1.2) continue;       // posts and bins
      g.fillRect(mx(b.x0), mz(b.z0), Math.max(1, (b.x1 - b.x0) * PX), Math.max(1, (b.z1 - b.z0) * PX));
    }
    // The casino, in purple and gold.
    g.fillStyle = '#5a2a6a';
    g.fillRect(mx(CASINO.MIN_X), mz(CASINO.MIN_Z), (CASINO.MAX_X - CASINO.MIN_X) * PX, (CASINO.MAX_Z - CASINO.MIN_Z) * PX);
    g.strokeStyle = '#f2c14e';
    g.lineWidth = 2;
    g.strokeRect(mx(CASINO.MIN_X), mz(CASINO.MIN_Z), (CASINO.MAX_X - CASINO.MIN_X) * PX, (CASINO.MAX_Z - CASINO.MIN_Z) * PX);
    // Each gang's HQ: a coloured square with its owner's colour.
    HQS.forEach((q, i) => {
      const own = this.hoods[i];
      const b = q.building;
      g.fillStyle = own ? own.color : '#3a3530';
      g.fillRect(mx(b.x0), mz(b.z0), (b.x1 - b.x0) * PX, (b.z1 - b.z0) * PX);
      g.strokeStyle = '#111';
      g.lineWidth = 2;
      g.strokeRect(mx(b.x0), mz(b.z0), (b.x1 - b.x0) * PX, (b.z1 - b.z0) * PX);
    });
  }

  /**
   * Draws the radar. `yaw` = which way the camera looks (0 = north),
   * `pos` = you, `facing` = which way you face, `speed` zooms out as you go.
   */
  update(dt, { yaw, pos, facing, speed = 0 }) {
    const g = this.g;
    const S = this.canvas.width;
    const R = S / 2 - 6;
    const want = 110 + Math.min(150, Math.abs(speed) * 5);
    this.range += (want - this.range) * Math.min(1, dt * 1.5);
    const k = R / this.range;                 // screen pixels per metre

    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(S / 2, S / 2, R, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#1b2117';
    g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2);
    g.rotate(yaw);
    g.scale(k / PX, k / PX);
    g.translate(-mx(pos.x), -mz(pos.z));
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, 0, 0);
    g.restore();

    // Where a world point lands on the radar (turned with the camera).
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const place = (x, z) => {
      const dx = (x - pos.x) * k;
      const dz = (z - pos.z) * k;
      return [dx * cos - dz * sin, dx * sin + dz * cos];
    };
    for (const list of this.blips.values()) {
      for (const b of list) {
        let [x, y] = place(b.x, b.z);
        const d = Math.hypot(x, y);
        let edge = false;
        if (d > R - 6) {
          if (!b.edge) continue;
          x *= (R - 6) / d;
          y *= (R - 6) / d;
          edge = true;
        }
        this._blip(g, S / 2 + x, S / 2 + y, b, edge, yaw);
      }
    }

    // You: an arrow in the middle, pointing where you face.
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(yaw - facing);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -9); g.lineTo(7, 7); g.lineTo(0, 3); g.lineTo(-7, 7); g.closePath();
    g.fill(); g.stroke();
    g.restore();

    // The rim, and north.
    g.lineWidth = 5;
    g.strokeStyle = '#0c0c0c';
    g.beginPath(); g.arc(S / 2, S / 2, R + 1, 0, Math.PI * 2); g.stroke();
    const north = place(pos.x, pos.z - 1e4);
    const nd = Math.hypot(north[0], north[1]) || 1;
    const px = S / 2 + (north[0] / nd) * R;
    const py = S / 2 + (north[1] / nd) * R;
    g.fillStyle = '#111';
    g.beginPath(); g.arc(px, py, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 12px Impact, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', px, py + 0.5);
  }

  /**
   * The full-screen map (M): the whole valley north-up. `view` = { x, z, zoom }
   * is the world point in the middle of the screen and screen pixels per
   * metre. Hood and landmark names, every blip, you, and your waypoint with
   * a line to it.
   */
  drawMap(canvas, view, { pos, facing, waypoint }) {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    const g = canvas.getContext('2d');
    const k = view.zoom;
    const sx = (x) => cw / 2 + (x - view.x) * k;
    const sy = (z) => ch / 2 + (z - view.z) * k;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#10140d';
    g.fillRect(0, 0, cw, ch);
    g.save();
    g.translate(cw / 2, ch / 2);
    g.scale(k / PX, k / PX);
    g.translate(-mx(view.x), -mz(view.z));
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, 0, 0);
    g.restore();

    // A faint 100 m grid, so distances read at a glance.
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = Math.ceil(BOUNDS.minX / 100) * 100; x <= BOUNDS.maxX; x += 100) { g.moveTo(sx(x), sy(BOUNDS.minZ)); g.lineTo(sx(x), sy(BOUNDS.maxZ)); }
    for (let z = Math.ceil(BOUNDS.minZ / 100) * 100; z <= BOUNDS.maxZ; z += 100) { g.moveTo(sx(BOUNDS.minX), sy(z)); g.lineTo(sx(BOUNDS.maxX), sy(z)); }
    g.stroke();

    // Names: hoods (and whose gang runs them), then the landmarks.
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const label = (text, x, y, size, color, family = SA_FONT, style = '') => {
      g.font = `${style} ${size}px ${family}`;
      g.lineJoin = 'round';
      g.lineWidth = Math.max(2.5, size / 4.5);
      g.strokeStyle = '#000';
      g.strokeText(text, x, y);
      g.fillStyle = color;
      g.fillText(text, x, y);
    };
    const big = Math.max(15, Math.min(34, k * 24));
    const small = Math.max(12, Math.min(22, k * 15));
    HOODS.forEach((h, i) => {
      const own = this.hoods[i];
      const x = sx((h.x0 + h.x1) / 2);
      const y = sy(h.z0) + big * 0.9;              // along the woods at the top, clear of the street
      label(h.name.toUpperCase(), x, y, big, '#efe6d6');
      if (own && own.gang) label(own.gang, x, y + big * 0.95, small, own.color, TITLE_FONT, 'italic bold');
      if (own && own.holder && own.holderGang) label(`held by ${own.holderGang}`, x, y + big * 0.95 + small * 1.1, small * 0.85, own.holder, TITLE_FONT, 'italic bold');
    });
    const hospital = BUILDINGS.find((b) => b.id === 'hospital');
    const marks = [
      ['DOWNTOWN', 0, DOWNTOWN.z1 - 28, '#d7ccf0'],
      ['CASINO ROYALE', (CASINO.MIN_X + CASINO.MAX_X) / 2, (CASINO.MIN_Z + CASINO.MAX_Z) / 2, '#f2c14e'],
      ['THE SPEEDWAY', TRACK.cx, TRACK.cz, '#e8e8e0'],
    ];
    if (hospital) marks.push(['COUNTY GENERAL', (hospital.x0 + hospital.x1) / 2, (hospital.z0 + hospital.z1) / 2, '#ff8a80']);
    for (const [text, x, z, color] of marks) label(text, sx(x), sy(z), small, color);

    // Every blip on the radar, north-up (the waypoint is drawn on its own below).
    for (const [key, list] of this.blips) {
      if (key === 'waypoint') continue;
      for (const b of list) {
        const x = sx(b.x);
        const y = sy(b.z);
        if (x < -20 || y < -20 || x > cw + 20 || y > ch + 20) continue;
        this._blip(g, x, y, b, false, 0);
      }
    }

    // Your waypoint: a dotted line from you, the flag, and how far it is.
    const me = [sx(pos.x), sy(pos.z)];
    if (waypoint) {
      const w = [sx(waypoint.x), sy(waypoint.z)];
      g.save();
      g.setLineDash([8, 7]);
      g.lineDashOffset = -performance.now() / 60;
      g.strokeStyle = 'rgba(255,79,216,0.85)';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(me[0], me[1]); g.lineTo(w[0], w[1]); g.stroke();
      g.restore();
      this._blip(g, w[0], w[1], { color: '#ff4fd8', shape: 'flag', size: 7 }, false, 0);
      const d = Math.hypot(waypoint.x - pos.x, waypoint.z - pos.z);
      label(`${Math.round(d)} m`, w[0], w[1] + 16, 15, '#ffd6f4', UI_FONT, 'bold');
    }

    // You: a bigger arrow than on the radar, with a pulse round it.
    const pulse = (performance.now() / 900) % 1;
    g.strokeStyle = `rgba(255,255,255,${0.7 * (1 - pulse)})`;
    g.lineWidth = 2;
    g.beginPath(); g.arc(me[0], me[1], 10 + pulse * 22, 0, Math.PI * 2); g.stroke();
    g.save();
    g.translate(me[0], me[1]);
    g.rotate(-facing);
    g.scale(1.35, 1.35);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -9); g.lineTo(7, 7); g.lineTo(0, 3); g.lineTo(-7, 7); g.closePath();
    g.fill(); g.stroke();
    g.restore();

    // North, and a scale bar.
    g.fillStyle = '#111';
    g.beginPath(); g.arc(cw - 40, 92, 15, 0, Math.PI * 2); g.fill();
    g.lineWidth = 2;
    g.strokeStyle = '#efe6d6';
    g.stroke();
    label('N', cw - 40, 93, 18, '#fff');
    const metres = [50, 100, 200, 500].find((m) => m * k >= 70) || 500;
    const bx = 28;
    const by = ch - 64;
    g.fillStyle = '#000';
    g.fillRect(bx - 2, by - 2, metres * k + 4, 9);
    g.fillStyle = '#efe6d6';
    g.fillRect(bx, by, metres * k, 5);
    g.textAlign = 'left';
    label(`${metres} m`, bx + metres * k + 8, by + 2, 14, '#efe6d6');
  }

  _blip(g, x, y, b, edge, yaw) {
    const s = (b.size || 5) * (edge ? 0.8 : 1);
    g.fillStyle = b.color || '#fff';
    g.strokeStyle = '#000';
    g.lineWidth = 1.5;
    switch (b.shape) {
      case 'arrow':
        g.save();
        g.translate(x, y);
        g.rotate(yaw - (b.yaw || 0));
        g.beginPath(); g.moveTo(0, -s * 1.3); g.lineTo(s, s); g.lineTo(-s, s); g.closePath();
        g.fill(); g.stroke();
        g.restore();
        break;
      case 'square':
        g.fillRect(x - s, y - s, s * 2, s * 2);
        g.strokeRect(x - s, y - s, s * 2, s * 2);
        break;
      case 'icon':
        g.beginPath(); g.arc(x, y, s + 3, 0, Math.PI * 2); g.fillStyle = '#111'; g.fill();
        g.fillStyle = b.color || '#fff';
        g.font = `bold ${Math.round(s * 2)}px Impact, "Arial Black", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(b.label || '?', x, y + 0.5);
        break;
      case 'flag':
        // Your waypoint: a pennant on a pole, planted where you clicked.
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - s * 3.2); g.stroke();
        g.beginPath(); g.moveTo(x, y - s * 3.2); g.lineTo(x + s * 2.2, y - s * 2.5); g.lineTo(x, y - s * 1.8); g.closePath();
        g.fill(); g.stroke();
        g.beginPath(); g.arc(x, y, s * 0.45, 0, Math.PI * 2); g.fill(); g.stroke();
        break;
      case 'marker':
        // A checkpoint: a big red blip, pulsing.
        g.beginPath(); g.arc(x, y, s + Math.sin(performance.now() / 180) * 1.5, 0, Math.PI * 2);
        g.fill(); g.stroke();
        break;
      default:
        g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }
}

/** The name of where you are, for the zone caption: a hood, downtown, or the road you are on. */
export function zoneName(x, z) {
  const h = hoodAt(x, z);
  if (h >= 0) return HOODS[h].name;
  if (x >= CASINO.MIN_X && x <= CASINO.MAX_X && z >= CASINO.MIN_Z && z <= CASINO.MAX_Z) return 'Casino Royale';
  if (Math.hypot(x - TRACK.cx, z - TRACK.cz) < TRACK.half + TRACK.r + 20) return 'The Speedway';
  if (x >= DOWNTOWN.x0 && x <= DOWNTOWN.x1 && z >= DOWNTOWN.z0 && z <= DOWNTOWN.z1) return 'Downtown';
  for (const r of ALL_ROADS) if (x >= r.x0 - 4 && x <= r.x1 + 4 && z >= r.z0 - 4 && z <= r.z1 + 4 && r.kind === 'avenue') return r.name;
  return 'The Valley';
}
