import * as THREE from 'three';
import { WORKER_ROLES } from '/shared/catalog.js';
import { createPerson } from './people.js';

// Hired hands on screen. The server never streams their positions: it sends
// one event per job ("walk from A to B starting at t0 for `walk` ms, then do
// `act` for `dur` ms"), and each client plays that back against the shared
// server clock. Everybody sees the same worker in the same place.

const OUTFIT = { field: 'work', animals: 'vest', workshop: 'vest', seller: 'work', cook: 'chef', waiter: 'waiter', driver: 'tee' };
const POSE = {
  plow: ['work', 'hoe'], plant: ['work', 'sack'], water: ['work', 'can'], harvest: ['work', 'basket'],
  feed: ['carry', 'sack'], collect: ['carry', 'basket'], load: ['carry', 'sack'], sell: ['carry', 'basket'],
  cook: ['cook', 'pan'], serve: ['carry', 'tray'], take: ['stand', null], clean: ['work', null],
  deliver: ['carry', 'bag'], home: ['stand', null], idle: ['stand', null],
};

export class WorkerView {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();
    this.tmp = new THREE.Vector3();
  }

  /** The full list: on joining, and when someone is hired, fired or renamed. */
  setList(list) {
    const seen = new Set();
    for (const w of list) {
      seen.add(w.id);
      let e = this.items.get(w.id);
      if (e && (e.name !== w.name || e.role !== w.role)) {
        if (e.name !== w.name) { e.person.setName(this._tag(w)); e.name = w.name; }
        e.role = w.role;
      }
      if (!e) {
        const look = { ...(w.look || {}), outfit: OUTFIT[w.role] || 'work' };
        if (w.role === 'driver') look.hat = 'cap';
        // Everyone on the payroll is in the gang: a bandana in the boss's colour.
        if (w.color && OUTFIT[w.role] !== 'chef') { look.hat = 'bandana'; look.hatColor = w.color; }
        const person = createPerson(look, { name: this._tag(w), tagColor: '#ffe9a8', tagScale: 0.32 });
        this.scene.add(person.group);
        e = { id: w.id, name: w.name, role: w.role, person, ev: null, yaw: 0 };
        this.items.set(w.id, e);
      }
      if (w.ev) e.ev = w.ev;
    }
    for (const [id, e] of this.items) {
      if (seen.has(id)) continue;
      this.scene.remove(e.person.group);
      e.person.dispose();
      this.items.delete(id);
    }
  }

  _tag(w) { return `${(WORKER_ROLES[w.role] || {}).icon || ''} ${w.name}`; }

  /** One job starting. */
  onEvent(ev) {
    const e = this.items.get(ev.id);
    if (e) e.ev = ev;
  }

  update(dt, serverNow, camPos) {
    for (const e of this.items.values()) {
      const ev = e.ev;
      if (!ev) { e.person.group.visible = false; continue; }
      e.person.group.visible = true;
      const into = serverNow - ev.t0;
      let x = ev.to[0];
      let z = ev.to[1];
      let moving = false;
      if (ev.walk > 0 && into < ev.walk) {
        const k = Math.max(0, into / ev.walk);
        x = ev.from[0] + (ev.to[0] - ev.from[0]) * k;
        z = ev.from[1] + (ev.to[1] - ev.from[1]) * k;
        moving = true;
        const dx = ev.to[0] - ev.from[0];
        const dz = ev.to[1] - ev.from[1];
        if (dx * dx + dz * dz > 0.01) e.yaw = Math.atan2(dx, dz);
      }
      const doing = !moving && into < ev.walk + ev.dur;
      const [pose, prop] = doing ? (POSE[ev.act] || ['stand', null]) : ['stand', ev.act === 'home' || ev.act === 'idle' ? null : (POSE[ev.act] || [])[1] || null];
      e.person.setPose(pose);
      e.person.setProp(moving ? (POSE[ev.act] || [])[1] || null : prop);
      e.person.group.position.set(x, 0, z);
      let d = e.yaw - e.person.group.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      e.person.group.rotation.y += d * Math.min(1, dt * 8);
      // Far-away workers skip their animation to save a little time.
      const far = camPos ? Math.hypot(x - camPos.x, z - camPos.z) : 0;
      e.person.group.visible = far < 220;
      e.person.setDistance(far);
      if (far < 90) e.person.update(dt, moving, moving ? Math.hypot(ev.to[0] - ev.from[0], ev.to[1] - ev.from[1]) / Math.max(0.1, ev.walk / 1000) : 0);
      e.person.scaleTag(far);
    }
  }

  /** Where a worker is right now, for the staff panel's "show me". */
  positionOf(id) {
    const e = this.items.get(id);
    return e ? e.person.group.position : null;
  }
}
