import * as THREE from 'three';
import { RESTAURANTS, dishPrice, money } from '/shared/catalog.js';
import {
  LOTS, LOT_BY_ID, STRIP, RESTO, COTTAGES, lotYaw, lotTables, lotSpots, restaurantBoxes,
} from '/shared/map.js';
import {
  neonSignTexture, tileFloorTexture, decoWallTexture, awningTexture, menuBoardTexture, boardTexture,
  pavingTexture, glowTexture,
} from './textures.js';
import { makeHalo, dropHalo } from './neon.js';

// The Sunset Strip: pastel art-deco restaurants with neon signs, a glass front
// and a proper inside (tables, the counter, a kitchen), and "for sale" signs
// on the empty lots. Built from boxes like everything else.

const phong = (color, o = {}) => new THREE.MeshPhongMaterial({ color, shininess: 12, specular: 0x222222, ...o });
const basic = (color, o = {}) => new THREE.MeshBasicMaterial({ color, ...o });
const H = 4.6;           // wall height

function box(parent, w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// Model coordinates: x across the lot, y up, z = -(metres in from the pavement).
const L = (lz) => -lz;

export class RestaurantView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.lots = new Map();          // lot id -> { group, key, neon: [] }
    this.boxes = [];
    this.list = [];
    this.t = 0;
    this.neonMats = [];
    this.fixedBoxes = [];
    this._buildStreet();
    this._buildCottages();
    for (const lot of LOTS) this._build(lot, null);
    this.boxes = [...this.fixedBoxes];
  }

  /** Little houses along the farm road: somewhere to deliver dinner to. */
  _buildCottages() {
    const walls = ['#f7c6e0', '#bde6f7', '#fff1b8', '#c8f2d0', '#ffd6b0', '#e2d4ff'];
    const roofMat = phong(0x8a3a2a);
    COTTAGES.forEach((c, i) => {
      const g = new THREE.Group();
      g.position.set(c.x, 0, c.z);
      g.rotation.y = Math.PI;   // front door faces the road, to the north
      const wall = phong(0xffffff, { map: decoWallTexture(walls[i % walls.length], '#ffffff') });
      box(g, 7, 3, 6, 0, 1.5, 0, wall);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(5.4, 2.2, 4), roofMat);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(1, 1, 0.85);
      roof.position.y = 4.1;
      g.add(roof);
      box(g, 1.2, 2.1, 0.1, 0, 1.05, 3.02, phong(0x6b3f22));                         // door
      for (const s of [-1, 1]) box(g, 1.2, 1.0, 0.08, s * 2.2, 1.7, 3.02, basic(0x2a3448)); // windows
      box(g, 3, 0.15, 1.6, 0, 0.08, 3.8, phong(0xbdb6a8));                            // porch step
      // A mailbox with the number on it.
      box(g, 0.1, 1.1, 0.1, 2.8, 0.55, 5.3, phong(0x444444));
      box(g, 0.5, 0.35, 0.3, 2.8, 1.2, 5.3, phong(0x2f7de0));
      const num = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), basic(0xffffff, { map: boardTexture(`No. ${i + 1}`, '#ffffff') }));
      num.position.set(0, 2.75, 3.03);
      g.add(num);
      this.group.add(g);
      this.fixedBoxes.push({ x0: c.x - 3.5, x1: c.x + 3.5, z0: c.z - 3, z1: c.z + 3 });
    });
  }

  // -------------------------------------------------------------- the street

  _buildStreet() {
    const g = new THREE.Group();
    this.group.add(g);
    // Pavements both sides of the boulevard.
    const pave = pavingTexture().clone();
    pave.needsUpdate = true;
    pave.repeat.set((STRIP.x1 - STRIP.x0) / 4, 1);
    for (const [z0, z1] of [[STRIP.z0 - 4, STRIP.z0], [STRIP.z1, STRIP.z1 + 4]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(STRIP.x1 - STRIP.x0, z1 - z0).rotateX(-Math.PI / 2), phong(0xffffff, { map: pave }));
      m.position.set((STRIP.x0 + STRIP.x1) / 2, 0.025, (z0 + z1) / 2);
      g.add(m);
    }
    // A welcome arch at the plaza end.
    const arch = new THREE.Group();
    const post = phong(0xf2f2f2);
    box(arch, 0.6, 8, 0.6, 0, 4, STRIP.z0 - 4.5, post);
    box(arch, 0.6, 8, 0.6, 0, 4, STRIP.z1 + 4.5, post);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(STRIP.z1 - STRIP.z0 + 10, 2.6),
      basic(0xffffff, { map: neonSignTexture('SUNSET STRIP', '#35e0ff', 'eat · drink · be seen') }));
    face.rotation.y = -Math.PI / 2;
    face.position.set(-0.35, 8.4, (STRIP.z0 + STRIP.z1) / 2);
    arch.add(face);
    const back = face.clone();
    back.rotation.y = Math.PI / 2;
    back.position.x = 0.35;
    arch.add(back);
    for (const [x, ry] of [[-0.45, -Math.PI / 2], [0.45, Math.PI / 2]]) {
      const halo = makeHalo(STRIP.z1 - STRIP.z0 + 10, 2.6, '#35e0ff');
      halo.rotation.y = ry;
      halo.position.set(x, 8.4, (STRIP.z0 + STRIP.z1) / 2);
      arch.add(halo);
    }
    arch.position.set(STRIP.x0 + 3, 0, 0);
    g.add(arch);
    this.neonMats.push(face.material, back.material);
  }

  // ---------------------------------------------------------------- the lots

  setList(list) {
    this.list = list || [];
    const byLot = new Map(this.list.map((r) => [r.lot, r]));
    for (const lot of LOTS) {
      const r = byLot.get(lot.id) || null;
      const key = r ? `${r.type}|${r.level}|${r.ownerName}|${r.open}` : 'sale';
      const cur = this.lots.get(lot.id);
      if (!cur || cur.key !== key) this._build(lot, r);
    }
    this.boxes = [...this.fixedBoxes];
    for (const lot of LOTS) if (byLot.has(lot.id)) this.boxes.push(...restaurantBoxes(lot));
  }

  ownerOf(lotId) { return this.list.find((r) => r.lot === lotId) || null; }

  _build(lot, r) {
    const old = this.lots.get(lot.id);
    if (old) {
      this.group.remove(old.group);
      old.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      this.neonMats = this.neonMats.filter((m) => !old.neon.includes(m));
      for (const h of old.halos || []) dropHalo(h);
    }
    const g = new THREE.Group();
    const [cx, fz] = [(lot.x0 + lot.x1) / 2, lot.side === 'north' ? lot.z1 : lot.z0];
    g.position.set(cx, 0, fz);
    g.rotation.y = lotYaw(lot);
    this.group.add(g);
    const entry = { group: g, key: r ? `${r.type}|${r.level}|${r.ownerName}|${r.open}` : 'sale', neon: [], halos: [] };
    this.lots.set(lot.id, entry);
    if (r) this._restaurant(g, lot, r, entry);
    else this._forSale(g, lot);
  }

  _forSale(g, lot) {
    // Rough ground and a sign by the pavement.
    const dirt = new THREE.Mesh(new THREE.PlaneGeometry(lot.w - 1, lot.d - 1).rotateX(-Math.PI / 2), phong(0x8d7a5a));
    dirt.position.set(0, 0.02, L(lot.d / 2));
    g.add(dirt);
    const post = phong(0x6b4a2e);
    box(g, 0.2, 2.6, 0.2, -1.6, 1.3, L(1.5), post);
    box(g, 0.2, 2.6, 0.2, 1.6, 1.3, L(1.5), post);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.6),
      basic(0xffffff, { map: boardTexture('FOR SALE', '#ffd24a', `${lot.name} · ${lot.tables} tables · ${money(lot.price)}`) }));
    sign.position.set(0, 2.2, L(1.5) + 0.12);
    g.add(sign);
    const back = sign.clone();
    back.rotation.y = Math.PI;
    back.position.z = L(1.5) - 0.12;
    g.add(back);
  }

  _restaurant(g, lot, r, entry) {
    const def = RESTAURANTS[r.type];
    const W = lot.w - 2;
    const back = lot.d - RESTO.back;
    const front = RESTO.front;
    const depth = back - front;
    const sp = lotSpots(lot);
    const wall = phong(0xffffff, { map: decoWallTexture(def.wall, def.trim) });
    const trim = phong(new THREE.Color(def.trim).getHex());
    const white = phong(0xf7f3ea);
    const dark = phong(0x2b2b30);
    const steel = phong(0xb9c0c8, { shininess: 80, specular: 0x999999 });

    // Floor, walls and roof.
    const floorTex = tileFloorTexture(def.floor[0], def.floor[1]).clone();
    floorTex.needsUpdate = true;
    floorTex.repeat.set(W / 4, depth / 4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, depth).rotateX(-Math.PI / 2), phong(0xffffff, { map: floorTex }));
    floor.position.set(0, 0.03, L(front + depth / 2));
    g.add(floor);
    box(g, W, H, 0.3, 0, H / 2, L(back), wall);
    box(g, 0.3, H, depth, -W / 2, H / 2, L(front + depth / 2), wall);
    box(g, 0.3, H, depth, W / 2, H / 2, L(front + depth / 2), wall);
    box(g, W + 0.6, 0.3, depth + 0.6, 0, H + 0.15, L(front + depth / 2), white);
    // Ceiling light panels (the inside glows a little, day and night).
    for (let z = front + 3; z < back - 1; z += 5) box(g, W * 0.6, 0.05, 0.6, 0, H - 0.05, L(z), basic(0xfff3d6));

    // The front: glass either side of the door, with deco pillars.
    const glass = new THREE.MeshPhongMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.28, shininess: 100, specular: 0xffffff, depthWrite: false });
    const doorHalf = RESTO.doorHalf;
    for (const s of [-1, 1]) {
      const w = W / 2 - doorHalf;
      const pane = box(g, w, H - 0.9, 0.08, s * (doorHalf + w / 2), (H - 0.9) / 2 + 0.3, L(front), glass);
      pane.renderOrder = 2;
      box(g, w, 0.3, 0.2, s * (doorHalf + w / 2), 0.15, L(front), trim);                  // kick plate
      box(g, 0.45, H + 0.6, 0.45, s * (W / 2), (H + 0.6) / 2, L(front), trim);            // corner pillar
      box(g, 0.3, H, 0.3, s * doorHalf, H / 2, L(front), white);                          // door frame
    }
    box(g, W + 0.4, 0.6, 0.35, 0, H - 0.3, L(front), white);                              // lintel
    // Art-deco parapet: taller in the middle, with the sign.
    box(g, W + 0.6, 1.4, 0.4, 0, H + 1, L(front), wall);
    box(g, W * 0.55, 2.8, 0.45, 0, H + 1.7, L(front), wall);
    box(g, W * 0.55 + 0.2, 0.25, 0.5, 0, H + 3.1, L(front), trim);
    const name = `${r.ownerName.toUpperCase()}'S ${def.sign}`;
    const signMat = basic(0xffffff, { map: neonSignTexture(name, def.neon, r.open ? `${def.name.toLowerCase()} · open` : 'closed') });
    this.neonMats.push(signMat);
    entry.neon.push(signMat);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.52, W * 0.52 / 4), signMat);
    sign.position.set(0, H + 1.7, L(front) + 0.24);
    g.add(sign);
    if (r.open) {
      const halo = makeHalo(W * 0.52, W * 0.52 / 4, def.neon, { night: r.level >= 5 ? 0.95 : 0.7 });
      halo.position.set(0, H + 1.7, L(front) + 0.3);
      g.add(halo);
      entry.halos.push(halo);
    }
    // Level 5: neon tubes outline the whole front.
    if (r.level >= 5) {
      const tube = basic(new THREE.Color(def.neon).getHex());
      box(g, W + 0.8, 0.08, 0.08, 0, H + 1.75, L(front) + 0.25, tube);
      for (const s of [-1, 1]) box(g, 0.08, H + 1.7, 0.08, s * (W / 2 + 0.35), (H + 1.7) / 2, L(front) + 0.25, tube);
    }
    // Striped awnings over the windows.
    const aw = phong(0xffffff, { map: awningTexture('#ffffff', def.trim) });
    for (const s of [-1, 1]) {
      const w = W / 2 - doorHalf - 0.4;
      const a = box(g, w, 0.08, 1.6, s * (doorHalf + 0.2 + w / 2), H - 0.95, L(front) + 0.8, aw);
      a.rotation.x = -0.3;
    }
    // Neon glow pool on the pavement at night.
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(W, 6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: new THREE.Color(def.neon), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    pool.position.set(0, 0.04, L(-1.5));
    g.add(pool);
    entry.pool = pool;

    // The counter (the pass), with a gap at the kitchen end for staff.
    const passZ = sp.pass[1];
    const len = sp.kitchenGap - 1.1 + W / 2;
    box(g, len, 1.05, 0.8, -W / 2 + len / 2, 0.525, L(passZ), trim);
    box(g, len + 0.1, 0.08, 0.95, -W / 2 + len / 2, 1.09, L(passZ), white);
    // Kitchen: stove, oven, fridge and a shelf, on the back wall.
    const stoveX = sp.stove[0];
    box(g, 1.8, 0.95, 0.9, stoveX, 0.475, L(back - 0.6), steel);
    for (const bx of [-0.45, 0.45]) {
      const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.03, 12), dark);
      burner.position.set(stoveX + bx, 0.97, L(back - 0.6));
      g.add(burner);
    }
    box(g, 1.6, 0.9, 0.8, stoveX, 2.6, L(back - 0.45), steel);                     // hood
    if (r.type === 'pizza') {
      // A proper wood-fired dome.
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), phong(0xb5532e));
      dome.position.set(sp.oven[0], 1.0, L(back - 1.1));
      g.add(dome);
      box(g, 2.3, 1.0, 2.2, sp.oven[0], 0.5, L(back - 1.1), phong(0x8a3a24));
      box(g, 0.8, 0.5, 0.1, sp.oven[0], 1.25, L(back - 2.2), basic(0xff8a2a));
    } else {
      box(g, 1.4, 1.8, 0.8, sp.oven[0], 0.9, L(back - 0.5), steel);
      box(g, 1.0, 0.6, 0.05, sp.oven[0], 1.0, L(back - 0.92), basic(0x2a1a10));
    }
    box(g, 1.1, 2.1, 0.8, W / 2 - 1, 1.05, L(back - 0.5), white);                  // fridge
    box(g, W - 1, 0.08, 0.4, 0, 2.2, L(back - 0.25), phong(0x8a5a2b));             // shelf
    // Menu board over the counter.
    const lines = def.dishes.filter((d) => d.level <= r.level).map((d) => [`${d.name}`, money(dishPrice(d))]);
    const menu = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.4), basic(0xffffff, { map: menuBoardTexture(def.name.toUpperCase(), lines) }));
    menu.position.set(0, 3.3, L(back) + 0.18);
    g.add(menu);

    // Tables and chairs.
    const top = phong(0xf7f3ea, { shininess: 40 });
    const chrome = phong(0xd5d9de, { shininess: 90 });
    const seatMat = phong(new THREE.Color(def.trim).getHex(), { shininess: 30 });
    for (const [tx, tz] of lotTables(lot)) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 16), top);
      t.position.set(tx, 0.78, L(tz));
      g.add(t);
      box(g, 0.1, 0.76, 0.1, tx, 0.38, L(tz), chrome);
      for (const s of [-1, 1]) {
        box(g, 0.48, 0.08, 0.48, tx + s * 0.85, 0.47, L(tz), seatMat);
        box(g, 0.08, 0.45, 0.08, tx + s * 0.85, 0.23, L(tz), chrome);
        box(g, 0.08, 0.55, 0.48, tx + s * 1.08, 0.75, L(tz), seatMat);          // backrest
      }
    }
    // Potted palms inside from level 4.
    if (r.level >= 4) {
      for (const s of [-1, 1]) {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.28, 0.6, 10), trim);
        pot.position.set(s * (W / 2 - 0.8), 0.3, L(front + 1));
        g.add(pot);
        const leaf = phong(0x3aa655);
        for (let i = 0; i < 6; i++) {
          const f = box(g, 0.14, 0.04, 1.1, s * (W / 2 - 0.8), 1.2, L(front + 1), leaf);
          f.rotation.set(0.6, (i / 6) * Math.PI * 2, 0);
        }
      }
    }
    // Closed: a sign on the door.
    if (!r.open) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.5), basic(0xffffff, { map: boardTexture('CLOSED', '#ff5a5a') }));
      c.position.set(0, 1.6, L(front) + 0.1);
      g.add(c);
    }
  }

  update(dt, night) {
    this.t += dt;
    // Neon hums a little brighter at night, and the cheap tubes flicker.
    const k = 0.75 + night * 0.25 + (Math.sin(this.t * 37) > 0.97 ? -0.3 : 0);
    for (const m of this.neonMats) m.color.setScalar(k);
    for (const e of this.lots.values()) if (e.pool) e.pool.material.opacity = night * 0.55;
  }

  /** The counter station's lot, for the owner check. */
  lotOf(id) { return LOT_BY_ID.get(id); }
}
