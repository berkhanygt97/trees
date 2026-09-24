import * as THREE from 'three';
import { pbr } from './gfx/materials.js';
import { dashTexture, plaidTexture } from './textures.js';
import { makeHand } from './avatar.js';

// The inside of whatever you are driving: dashboard, a real instrument
// cluster with needles, a steering wheel that turns, and your own hands on
// it. Only the local driver's vehicle ever gets one.

const phong = (color, o = {}) => pbr(color, { shininess: 20, ...o });

// How each body is laid out inside. `wid` is the cabin width.
const INTERIOR = {
  hatch:   { wid: 1.5, style: 'classic', gears: 5, redline: 6000 },
  pickup:  { wid: 1.75, style: 'classic', gears: 5, redline: 5500 },
  sedan:   { wid: 1.65, style: 'modern', gears: 5, redline: 6500 },
  muscle:  { wid: 1.75, style: 'sport', gears: 4, redline: 7000 },
  ttop:    { wid: 1.7, style: 'sport', gears: 5, redline: 6800 },
  coupe:   { wid: 1.7, style: 'sport', gears: 6, redline: 8000 },
  limo:    { wid: 1.75, style: 'modern', gears: 4, redline: 6000 },
  hyper:   { wid: 1.8, style: 'sport', gears: 7, redline: 9000 },
  tractor: { wid: 1.4, style: 'farm', gears: 3, redline: 2600, open: true },
  combine: { wid: 1.8, style: 'farm', gears: 3, redline: 2400 },
  scooter: { wid: 0.7, style: 'modern', gears: 1, redline: 8500, open: true },
};

export const interiorOf = (body) => INTERIOR[body] || INTERIOR.sedan;

/** Fake gearbox: turns road speed into a believable gear and rev count. */
export function engineState(speed, top, body) {
  const s = interiorOf(body);
  const f = Math.min(1.05, Math.abs(speed) / top);
  const idle = s.style === 'farm' ? 750 : 850;
  if (f < 0.01) return { rpm: idle, gear: 'N' };
  const g = Math.min(s.gears, Math.floor(f * s.gears) + 1);
  const within = f * s.gears - (g - 1);
  const rpm = idle + 900 + within * (s.redline - idle - 900);
  return { rpm: Math.min(s.redline * 1.02, rpm), gear: speed < 0 ? 'R' : String(g) };
}

// ------------------------------------------------------------ the cluster

const STYLES = {
  classic: { face: '#efe6cf', ink: '#1b1a17', needle: '#c8281e', ring: '#8a7b5a', glow: '#ffd98a' },
  modern:  { face: '#121418', ink: '#e8edf3', needle: '#ff6a2a', ring: '#3a3f47', glow: '#9fd4ff' },
  sport:   { face: '#0b0b0c', ink: '#f5f5f5', needle: '#ff2a2a', ring: '#c8281e', glow: '#ff5d5d' },
  farm:    { face: '#20231f', ink: '#e8e2c8', needle: '#f2c14e', ring: '#58624e', glow: '#b6ff9a' },
};

function dial(g, cx, cy, r, st, { max, step, label, value, red, unit, fmt = (v) => v }) {
  g.fillStyle = st.ring;
  g.beginPath(); g.arc(cx, cy, r + 8, 0, Math.PI * 2); g.fill();
  const grad = g.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
  grad.addColorStop(0, st.face);
  grad.addColorStop(1, shade(st.face, -25));
  g.fillStyle = grad;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();

  // 240° sweep, from bottom-left to bottom-right.
  const a0 = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;
  const angle = (v) => a0 + (v / max) * sweep;
  if (red) {
    g.strokeStyle = '#d42a1e';
    g.lineWidth = 7;
    g.beginPath(); g.arc(cx, cy, r - 8, angle(red), angle(max)); g.stroke();
  }
  g.strokeStyle = st.ink;
  g.fillStyle = st.ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(r * 0.16)}px "Trebuchet MS", sans-serif`;
  for (let v = 0; v <= max + 1e-6; v += step / 2) {
    const a = angle(v);
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    g.lineWidth = major ? 3 : 1.5;
    const r1 = r - (major ? 16 : 10);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
    g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    g.stroke();
    if (major) g.fillText(fmt(v), cx + Math.cos(a) * (r - 30), cy + Math.sin(a) * (r - 30));
  }
  g.font = `bold ${Math.round(r * 0.11)}px "Trebuchet MS", sans-serif`;
  g.fillText(label, cx, cy + r * 0.38);
  if (unit) g.fillText(unit, cx, cy - r * 0.32);

  // The needle, with a little shadow.
  const a = angle(Math.max(0, Math.min(max * 1.03, value)));
  g.save();
  g.translate(cx, cy);
  g.rotate(a);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(-10, -1, r - 12, 5);
  g.fillStyle = st.needle;
  g.beginPath(); g.moveTo(-14, -3); g.lineTo(r - 14, -1); g.lineTo(r - 14, 1); g.lineTo(-14, 3); g.fill();
  g.restore();
  g.fillStyle = '#333';
  g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.fill();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/**
 * Draws the whole cluster: speedometer, tachometer, gear and a fuel gauge.
 * Shared by the 3D dashboard and the on-screen cluster in chase view.
 */
export function drawCluster(g, w, h, { speed, top, body, night = 0 }) {
  const s = interiorOf(body);
  const st = STYLES[s.style];
  const { rpm, gear } = engineState(speed, top, body);
  const kmh = Math.abs(speed) * 3.6;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#0c0c0e';
  roundRect(g, 4, 4, w - 8, h - 8, h * 0.22);
  g.fill();
  const r = h * 0.42;
  const maxKmh = Math.max(40, Math.ceil((top * 3.6 * 1.15) / 20) * 20);
  const kStep = maxKmh > 200 ? 40 : 20;
  dial(g, w * 0.28, h * 0.52, r, st, { max: maxKmh, step: kStep, label: 'km/h', value: kmh });
  const maxRpm = Math.ceil((s.redline * 1.15) / 1000) * 1000;
  dial(g, w * 0.72, h * 0.52, r, st, { max: maxRpm / 1000, step: 1, label: 'x1000 rpm', value: rpm / 1000, red: s.redline / 1000 });
  // Gear and fuel in the middle.
  g.fillStyle = st.glow;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(h * 0.2)}px "Trebuchet MS", sans-serif`;
  g.fillText(gear, w * 0.5, h * 0.38);
  g.font = `bold ${Math.round(h * 0.075)}px "Trebuchet MS", sans-serif`;
  g.fillText(`${Math.round(kmh)}`, w * 0.5, h * 0.6);
  g.fillStyle = '#333';
  g.fillRect(w * 0.44, h * 0.74, w * 0.12, h * 0.05);
  g.fillStyle = '#6bd66b';
  g.fillRect(w * 0.44, h * 0.74, w * 0.12 * 0.8, h * 0.05);
  // Backlight at night.
  if (night > 0.3) {
    g.fillStyle = `rgba(255,200,120,${0.08 * night})`;
    g.fillRect(0, 0, w, h);
  }
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

// ------------------------------------------------------------ the cockpit

/**
 * Builds the interior for `body`, placed in the vehicle's local frame around
 * the driver's seat. Returns { group, update(speed, top, steer, night) }.
 */
export function buildCockpit(body, spec, color) {
  if (body === 'scooter') return buildScooterCockpit(spec, color);
  const s = interiorOf(body);
  const group = new THREE.Group();
  const [sx, sy, sz] = spec.seat;
  const eyeY = sy + spec.eye * 0.9;
  const dash = phong(0xffffff, { map: dashTexture(), shininess: 8 });
  const trim = phong(0x3a3a40, { shininess: 40 });
  const farm = s.style === 'farm';

  // Dashboard across the cabin.
  const dz = sz - (farm ? 0.6 : 0.72);
  const dashY = eyeY - (farm ? 0.5 : 0.42);
  const board = new THREE.Mesh(new THREE.BoxGeometry(s.wid, 0.22, 0.42), dash);
  board.position.set(0, dashY, dz - 0.1);
  board.rotation.x = -0.12;
  group.add(board);
  if (!farm) {
    const top = new THREE.Mesh(new THREE.BoxGeometry(s.wid, 0.04, 0.36), phong(0x1a1a1d));
    top.position.set(0, dashY + 0.12, dz - 0.18);
    group.add(top);
    // Door panels and a headliner, so the car has an inside.
    for (const side of [-1, 1]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 1.6), phong(0x2a2a2e));
      door.position.set(side * (s.wid / 2 + 0.02), eyeY - 0.55, sz - 0.2);
      group.add(door);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.4), trim);
      rail.position.set(side * (s.wid / 2), eyeY - 0.28, sz - 0.2);
      group.add(rail);
    }
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.02), trim);
    mirror.position.set(0, eyeY + 0.2, dz - 0.05);
    group.add(mirror);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.045), phong(0x8fa4bf, { shininess: 100, specular: 0xffffff }));
    glass.position.set(0, eyeY + 0.2, dz - 0.039);
    glass.rotation.y = Math.PI;
    group.add(glass);
  }

  // Binnacle with the live cluster facing the driver.
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 256;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.2, 0.14), phong(0x151517));
  hood.position.set(sx, dashY + 0.13, dz - 0.02);
  hood.rotation.x = -0.35;
  group.add(hood);
  // The dial face rides on the hood's driver-side surface (a hair proud of
  // it), so it tilts with the hood and can never end up inside it.
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.19), new THREE.MeshBasicMaterial({ map: tex }));
  face.position.set(0, 0, 0.074);
  hood.add(face);

  // Steering wheel with your hands on it.
  const wheel = new THREE.Group();
  const wr = farm ? 0.22 : 0.18;
  // Low enough that the dials show over the top of the rim.
  wheel.position.set(sx, eyeY - (farm ? 0.42 : 0.41), sz - (farm ? 0.42 : 0.46));
  wheel.rotation.x = farm ? -1.05 : -0.42;   // tilt towards the driver
  group.add(wheel);
  const spin = new THREE.Group();
  wheel.add(spin);
  // Brown leather, so the rim reads against the dark dash.
  const rim = new THREE.Mesh(new THREE.TorusGeometry(wr, 0.021, 8, 28), phong(0x4a3426, { shininess: 45, specular: 0x554433 }));
  spin.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.05, 12), trim);
  hub.rotation.x = Math.PI / 2;
  spin.add(hub);
  for (const a of [0, Math.PI, Math.PI * 1.5]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(wr, 0.02, 0.018), trim);
    spoke.position.set(Math.cos(a) * wr / 2, Math.sin(a) * wr / 2, 0);
    spoke.rotation.z = a;
    spin.add(spoke);
  }
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.4, 8), trim);
  column.rotation.x = Math.PI / 2;
  column.position.z = -0.22;
  wheel.add(column);

  const hands = [];
  for (const side of [-1, 1]) {
    const h = makeHand(side, color);
    h.setCurl(0.8, 0.6);
    // A little above quarter-to-three, so the dials stay in view. The hand's
    // forearm runs along +z (back towards the driver) and the fingers go
    // forward through the rim, curled round it, rolled so the palm faces the
    // middle of the wheel.
    const a = side > 0 ? Math.PI * 0.14 : Math.PI * 0.86;
    h.group.position.set(Math.cos(a) * wr, Math.sin(a) * wr, 0.1);
    h.group.rotation.set(0.25, 0, -side * 1.12);
    spin.add(h.group);
    hands.push(h);
  }

  // Tractor: a simple seat back and fenders you can see beside you.
  if (s.open) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.08), phong(0xffffff, { map: plaidTexture('#2a2a2a') }));
    seat.position.set(sx, sy + 0.45, sz + 0.3);
    group.add(seat);
  }

  let acc = 0;
  return {
    group,
    wheel: spin,
    update(dt, speed, top, steer, night) {
      spin.rotation.z = steer * 1.6;
      acc += dt;
      if (acc > 1 / 30) {
        acc = 0;
        drawCluster(ctx, cv.width, cv.height, { speed, top, body, night });
        tex.needsUpdate = true;
      }
    },
    dispose() {
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      tex.dispose();
    },
  };
}

/** On a scooter you see the handlebars, your hands on the grips and a little round dial. */
function buildScooterCockpit(spec, color) {
  const group = new THREE.Group();
  const [, sy, sz] = spec.seat;
  const eyeY = sy + spec.eye * 0.9;
  const bars = new THREE.Group();
  bars.position.set(0, eyeY - 0.46, sz - 0.62);
  group.add(bars);
  const chrome = phong(0xdadada, { shininess: 90, specular: 0xffffff });
  const grip = phong(0x1b1b1d);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.66, 8), chrome);
  bar.rotation.z = Math.PI / 2;
  bars.add(bar);
  for (const side of [-1, 1]) {
    const g = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 8), grip);
    g.rotation.z = Math.PI / 2;
    g.position.x = side * 0.3;
    bars.add(g);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.01, 0.02), chrome);
    lever.position.set(side * 0.26, -0.02, -0.05);
    bars.add(lever);
  }
  // A round speedo in the headset.
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 256;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.1), phong(0x2b2b2b));
  head.position.set(0, 0.04, -0.04);
  head.rotation.x = -0.5;
  bars.add(head);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.12), new THREE.MeshBasicMaterial({ map: tex }));
  face.position.set(0, 0, 0.051);
  head.add(face);
  const hands = [];
  for (const side of [-1, 1]) {
    const h = makeHand(side, color);
    h.setCurl(0.85, 0.7);
    h.group.position.set(side * 0.3, 0.02, 0.06);
    h.group.rotation.set(0.35, 0, -side * 1.35);
    bars.add(h.group);
    hands.push(h);
  }
  let acc = 0;
  return {
    group,
    wheel: bars,
    update(dt, speed, top, steer, night) {
      bars.rotation.y = -steer * 0.5;
      acc += dt;
      if (acc > 1 / 30) {
        acc = 0;
        drawCluster(ctx, cv.width, cv.height, { speed, top, body: 'scooter', night });
        tex.needsUpdate = true;
      }
    },
    dispose() {
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      tex.dispose();
    },
  };
}
