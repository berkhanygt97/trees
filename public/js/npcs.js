import { labelSprite } from './textures.js';
import { createPerson } from './people.js';

// Townsfolk: restaurant customers (sent by the server as path events) and the
// casino regulars and passers-by (made up on each client from a shared seed).
// Either way a person is "walk this path from t0 at this speed, then strike
// this pose", which costs nothing to send and nothing to simulate.

const HIDE_BEYOND = 160;
const ANIMATE_WITHIN = 70;

export class NpcView {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();
    this.cap = 80;
  }

  /**
   * ev = { id, look?, path: [[x, z], ...], t0, speed, pose, face, prop, say, bye }
   * The first event for an id must carry `look`.
   */
  onEvent(ev) {
    let e = this.items.get(ev.id);
    if (!e) {
      if (!ev.look || this.items.size >= this.cap) return;
      const person = createPerson(ev.look);
      this.scene.add(person.group);
      e = { id: ev.id, person, bubble: null, sayText: '' };
      this.items.set(ev.id, e);
      const p = ev.path[0];
      person.group.position.set(p[0], 0, p[1]);
    }
    const lens = [0];
    for (let i = 1; i < ev.path.length; i++) {
      lens.push(lens[i - 1] + Math.hypot(ev.path[i][0] - ev.path[i - 1][0], ev.path[i][1] - ev.path[i - 1][1]));
    }
    e.ev = ev;
    e.lens = lens;
    e.person.setProp(ev.prop || null);
    this._say(e, ev.say || '');
  }

  _say(e, text) {
    if (text === e.sayText) return;
    e.sayText = text;
    if (e.bubble) {
      e.person.group.remove(e.bubble);
      e.bubble.material.map.dispose();
      e.bubble.material.dispose();
      e.bubble = null;
    }
    if (!text) return;
    e.bubble = labelSprite(text, '#ffffff', 0.34);
    e.bubble.position.y = 2.35;
    e.bubble.material.depthTest = true;
    e.person.group.add(e.bubble);
  }

  remove(id) {
    const e = this.items.get(id);
    if (!e) return;
    this.scene.remove(e.person.group);
    e.person.dispose();
    if (e.bubble) { e.bubble.material.map.dispose(); e.bubble.material.dispose(); }
    this.items.delete(id);
  }

  /** Drops every NPC whose id starts with `prefix` (a crowd being regenerated). */
  clear(prefix = '') {
    for (const id of [...this.items.keys()]) if (id.startsWith(prefix)) this.remove(id);
  }

  update(dt, serverNow, camPos) {
    for (const e of [...this.items.values()]) {
      const ev = e.ev;
      if (!ev) continue;
      const total = e.lens[e.lens.length - 1];
      const s = Math.max(0, ((serverNow - ev.t0) / 1000) * (ev.speed || 1.3));
      let x;
      let z;
      let moving = false;
      let yaw = e.person.group.rotation.y;
      if (s < total && ev.path.length > 1) {
        let i = 1;
        while (i < e.lens.length - 1 && e.lens[i] < s) i++;
        const a = ev.path[i - 1];
        const b = ev.path[i];
        const seg = e.lens[i] - e.lens[i - 1] || 1;
        const k = (s - e.lens[i - 1]) / seg;
        x = a[0] + (b[0] - a[0]) * k;
        z = a[1] + (b[1] - a[1]) * k;
        yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
        moving = true;
      } else {
        const end = ev.path[ev.path.length - 1];
        x = end[0];
        z = end[1];
        if (ev.bye) { this.remove(e.id); continue; }
        if (ev.face != null) yaw = ev.face;
      }
      const g = e.person.group;
      g.position.set(x, 0, z);
      let d = yaw - g.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      g.rotation.y += d * Math.min(1, dt * 9);
      e.person.setPose(moving ? 'walk' : ev.pose || 'stand');
      const far = camPos ? Math.hypot(x - camPos.x, z - camPos.z) : 0;
      g.visible = far < HIDE_BEYOND;
      e.person.setDistance(far);
      if (far < ANIMATE_WITHIN) e.person.update(dt, moving, ev.speed || 1.3);
      if (e.bubble) e.bubble.visible = far < 30;
    }
  }
}

