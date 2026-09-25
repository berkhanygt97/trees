import { BOUNDS } from '/shared/map.js';
import { zoneName } from './radar.js';

// The full-screen map (M): the radar's picture of the whole valley, north up.
// The wheel zooms towards the cursor, dragging moves it, and a click plants a
// waypoint that also shows on the radar (click it again, or right-click, to
// take it away).

const MAX_ZOOM = 6;                 // screen pixels per metre, fully zoomed in
const DRAG_PX = 5;                  // further than this and a click is a drag

export class MapScreen {
  constructor(el, radar) {
    this.el = el;
    this.canvas = el.querySelector('canvas');
    this.here = el.querySelector('.map-here');
    this.radar = radar;
    this.view = { x: 0, z: 0, zoom: 1 };
    this.waypoint = null;           // { x, z } in world metres
    this.onChange = null;           // (waypoint | null) => void
    this._press = null;             // the button press in progress
    this._cursor = null;            // world point under the mouse
    this._text = '';
    this._pos = { x: 0, z: 0 };
    this._bind();
  }

  get open() { return !this.el.hidden; }

  /** Opens on the whole valley, zoomed out to fit the screen. */
  show(on) {
    this.el.hidden = !on;
    this._press = null;
    if (!on) return;
    this.view.zoom = this._fit();
    this.view.x = (BOUNDS.minX + BOUNDS.maxX) / 2;
    this.view.z = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
  }

  setWaypoint(w) {
    this.waypoint = w ? { x: w.x, z: w.z } : null;
    if (this.onChange) this.onChange(this.waypoint);
  }

  draw({ pos, facing }) {
    this._pos = pos;
    this.radar.drawMap(this.canvas, this.view, { pos, facing, waypoint: this.waypoint });
    const parts = [`You: ${zoneName(pos.x, pos.z)}`];
    if (this.waypoint) parts.push(`Waypoint: ${zoneName(this.waypoint.x, this.waypoint.z)}, ${Math.round(Math.hypot(this.waypoint.x - pos.x, this.waypoint.z - pos.z))} m`);
    if (this._cursor) parts.push(`Cursor: ${zoneName(this._cursor.x, this._cursor.z)}`);
    const text = parts.join('   ·   ');
    if (text !== this._text) { this._text = text; this.here.textContent = text; }
  }

  /** Screen pixel (relative to the canvas) -> world metres. */
  toWorld(px, py) {
    return {
      x: this.view.x + (px - this.canvas.clientWidth / 2) / this.view.zoom,
      z: this.view.z + (py - this.canvas.clientHeight / 2) / this.view.zoom,
    };
  }

  toScreen(x, z) {
    return [
      this.canvas.clientWidth / 2 + (x - this.view.x) * this.view.zoom,
      this.canvas.clientHeight / 2 + (z - this.view.z) * this.view.zoom,
    ];
  }

  /** A click on the map: plant the waypoint there, or pick it back up. */
  click(px, py) {
    if (this.waypoint) {
      const [wx, wy] = this.toScreen(this.waypoint.x, this.waypoint.z);
      // The flag stands up from the spot, so its whole height counts.
      if (Math.abs(px - wx) < 14 && py > wy - 30 && py < wy + 12) { this.setWaypoint(null); return; }
    }
    const w = this.toWorld(px, py);
    w.x = Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, w.x));
    w.z = Math.max(BOUNDS.minZ, Math.min(BOUNDS.maxZ, w.z));
    this.setWaypoint(w);
  }

  _fit() {
    const cw = this.canvas.clientWidth || innerWidth;
    const ch = this.canvas.clientHeight || innerHeight;
    return Math.min(cw / (BOUNDS.maxX - BOUNDS.minX + 80), (ch - 120) / (BOUNDS.maxZ - BOUNDS.minZ + 80));
  }

  /** The middle of the screen stays over the valley, so it never gets lost off screen. */
  _clamp() {
    const v = this.view;
    v.zoom = Math.max(this._fit(), Math.min(MAX_ZOOM, v.zoom));
    v.x = Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, v.x));
    v.z = Math.max(BOUNDS.minZ, Math.min(BOUNDS.maxZ, v.z));
  }

  _local(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      // Zoom towards the cursor: the point under it stays put.
      const [px, py] = this._local(e);
      const before = this.toWorld(px, py);
      this.view.zoom *= Math.exp(-e.deltaY * 0.0015);
      this.view.zoom = Math.max(this._fit(), Math.min(MAX_ZOOM, this.view.zoom));
      const after = this.toWorld(px, py);
      this.view.x += before.x - after.x;
      this.view.z += before.z - after.z;
      this._clamp();
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      if (e.button === 2) { this.setWaypoint(null); return; }
      if (e.button !== 0) return;
      const [px, py] = this._local(e);
      this._press = { id: e.pointerId, px, py, x: this.view.x, z: this.view.z, moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      const [px, py] = this._local(e);
      this._cursor = this.toWorld(px, py);
      const p = this._press;
      if (!p || p.id !== e.pointerId) return;
      if (!p.moved && Math.hypot(px - p.px, py - p.py) < DRAG_PX) return;
      p.moved = true;
      c.classList.add('dragging');
      this.view.x = p.x - (px - p.px) / this.view.zoom;
      this.view.z = p.z - (py - p.py) / this.view.zoom;
      this._clamp();
    });
    const end = (e) => {
      const p = this._press;
      if (!p || p.id !== e.pointerId) return;
      this._press = null;
      c.classList.remove('dragging');
      if (e.type === 'pointerup' && !p.moved) this.click(p.px, p.py);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { this._cursor = null; });
  }
}
