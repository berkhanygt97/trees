import * as THREE from 'three';
import { pbr } from '../gfx/materials.js';
import { BUILDINGS, LOTS_OPEN, CANOPY, PUMPS } from '/shared/downtown.js';
import {
  facadeTexture, facadeNightTexture, roofGravelTexture, shopfrontTexture, plasterTexture,
  neonSignTexture, boardTexture, metalTexture, pavingTexture,
} from '../textures.js';
import { makeHalo } from '../neon.js';
import { batchStatic, live, dynamic } from '../batcher.js';

// Downtown's newer buildings: the bank tower, the hotel, offices, a liquor
// store and a laundromat, the hospital, the gas station and the motel. Glass
// and stucco by day; after dark, windows light up one by one and the neon
// comes on.

const lambert = (color, o = {}) => pbr(color, { roughness: 0.92, ...o });
const basic = (color, o = {}) => new THREE.MeshBasicMaterial({ color, ...o });

function box(parent, w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/**
 * Four walls with UVs in metres (one texture tile = tileW x tileH metres), so
 * windows line up with floors on every face. y0..y1 is the height span.
 */
function wallsGeometry(x0, x1, z0, z1, y0, y1, tileW = 16, tileH = 14) {
  const pos = [];
  const nor = [];
  const uv = [];
  const face = (ax, az, bx, bz, nx, nz) => {
    const L = Math.hypot(bx - ax, bz - az);
    pos.push(ax, y0, az, bx, y0, bz, ax, y1, az, ax, y1, az, bx, y0, bz, bx, y1, bz);
    for (let i = 0; i < 6; i++) nor.push(nx, 0, nz);
    const u1 = L / tileW;
    const v0 = y0 / tileH;
    const v1 = y1 / tileH;
    uv.push(0, v0, u1, v0, 0, v1, 0, v1, u1, v0, u1, v1);
  };
  face(x0, z1, x1, z1, 0, 1);        // south
  face(x1, z0, x0, z0, 0, -1);       // north
  face(x0, z0, x0, z1, -1, 0);       // west
  face(x1, z1, x1, z0, 1, 0);        // east
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Where a building's front is and which way it faces. */
function front(b) {
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  switch (b.face) {
    case 'north': return { x: cx, z: b.z0, yaw: Math.PI, w: b.x1 - b.x0, out: [0, -1] };
    case 'east': return { x: b.x1, z: cz, yaw: Math.PI / 2, w: b.z1 - b.z0, out: [1, 0] };
    case 'west': return { x: b.x0, z: cz, yaw: -Math.PI / 2, w: b.z1 - b.z0, out: [-1, 0] };
    default: return { x: cx, z: b.z1, yaw: 0, w: b.x1 - b.x0, out: [0, 1] };
  }
}

export class Downtown {
  constructor(parent) {
    this.group = new THREE.Group();
    this.group.name = 'downtown';
    parent.add(this.group);
    this.nightMats = [];
    this.facadeMats = new Map();
    this.obstacles = [];
    this.roof = lambert(0xffffff, { map: roofGravelTexture() });
    for (const b of BUILDINGS) this._building(b);
    this._gasStation();
    this._openLots();
    this._pavements();
    this.batch = batchStatic(this.group, { chunk: 128 });
  }

  /** One lit-window material per facade style, shared by every building of that style. */
  _facade(style) {
    let m = this.facadeMats.get(style);
    if (!m) {
      m = live(lambert(0xffffff, {
        map: facadeTexture(style), emissiveMap: facadeNightTexture(style), emissive: 0xffffff, emissiveIntensity: 0,
      }));
      this.facadeMats.set(style, m);
      this.nightMats.push(m);
    }
    return m;
  }

  _building(b) {
    const g = new THREE.Group();
    this.group.add(g);
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const f = front(b);

    if (b.style === 'store') {
      // Low stucco box with a shop front on its face.
      g.add(new THREE.Mesh(wallsGeometry(b.x0, b.x1, b.z0, b.z1, 0, b.h, 6, 6), lambert(0xffffff, { map: plasterTexture('#d9c7a4') })));
      const shop = new THREE.Mesh(new THREE.PlaneGeometry(f.w - 1.2, 3.4), lambert(0xffffff, { map: shopfrontTexture('#d9c7a4') }));
      shop.position.set(f.x + f.out[0] * 0.03, 1.7, f.z + f.out[1] * 0.03);
      shop.rotation.y = f.yaw;
      g.add(shop);
      this._sign(g, f, b.sign, b.color, b.h - 0.9, Math.min(f.w - 2, 10), 1.6);
      // An awning over the window, sloping down towards the street.
      const awning = new THREE.Group();
      awning.position.set(f.x, 3.7, f.z);
      awning.rotation.y = f.yaw;
      const aw = box(awning, f.w - 1.2, 0.08, 1.8, 0, 0, 0.9, lambert(new THREE.Color(b.color).getHex()));
      aw.rotation.x = 0.28;
      g.add(awning);
    } else {
      g.add(new THREE.Mesh(wallsGeometry(b.x0, b.x1, b.z0, b.z1, 0, b.h), this._facade(b.style)));
    }

    // Flat roof, parapet, and the usual rooftop clutter.
    box(g, w, 0.4, d, cx, b.h + 0.2, cz, this.roof);
    const rim = lambert(b.style === 'tower' ? 0x3b4a55 : b.style === 'hotel' ? 0xb48a70 : 0x9a948a);
    box(g, w + 0.3, 0.9, 0.3, cx, b.h + 0.45, b.z0, rim);
    box(g, w + 0.3, 0.9, 0.3, cx, b.h + 0.45, b.z1, rim);
    box(g, 0.3, 0.9, d, b.x0, b.h + 0.45, cz, rim);
    box(g, 0.3, 0.9, d, b.x1, b.h + 0.45, cz, rim);
    if (b.h > 8) {
      const metal = lambert(0xffffff, { map: metalTexture('#9aa0a6') });
      for (let k = 0; k < 3; k++) box(g, 2.2, 1.4, 1.6, b.x0 + 4 + k * 4, b.h + 1.1, b.z0 + 4, metal);
      if (b.style === 'tower' || b.style === 'hotel') {
        // A water tank on legs, the skyline's favourite silhouette.
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 3, 12), lambert(0x6b4a2e));
        tank.position.set(b.x1 - 5, b.h + 4.2, b.z0 + 5);
        g.add(tank);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(2, 1.2, 12), lambert(0x4a3522));
        cone.position.set(b.x1 - 5, b.h + 6.3, b.z0 + 5);
        g.add(cone);
        for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) box(g, 0.2, 2.6, 0.2, b.x1 - 5 + dx, b.h + 1.3, b.z0 + 5 + dz, lambert(0x3a3a3a));
      }
    }

    if (b.style === 'tower') {
      // A darker lobby, an antenna, and the name up top.
      g.add(new THREE.Mesh(wallsGeometry(b.x0 - 0.05, b.x1 + 0.05, b.z0 - 0.05, b.z1 + 0.05, 0, 4.5, 8, 4.5), lambert(0x2a3a44)));
      box(g, 0.4, 14, 0.4, cx, b.h + 7, cz, lambert(0xb0b0b0));
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), live(basic(0xff2a2a)));
      beacon.position.set(cx, b.h + 14.2, cz);
      dynamic(beacon);
      g.add(beacon);
      this.beacon = beacon;
      this._sign(g, f, b.sign, b.color, b.h - 3, w * 0.8, w * 0.2, true);
      this._entrance(g, f, 8, 4.2, 0x2a3a44);
    } else if (b.style === 'hotel') {
      // Vertical neon down the corner, Vice City style.
      const vx = f.x - f.w / 2 + 1.2;
      const signMat = live(basic(0xffffff, { map: neonSignTexture('ROYALE', b.color, '') }));
      const vs = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.6), signMat);
      vs.rotation.z = Math.PI / 2;
      vs.position.set(vx, b.h - 9, f.z + 1.2);
      g.add(vs);
      box(g, 3.9, 14.4, 0.5, vx, b.h - 9, f.z + 0.9, lambert(0x2b2b30));
      const halo = makeHalo(3.6, 14, b.color);
      halo.position.set(vx, b.h - 9, f.z + 1.3);
      g.add(halo);
      this.nightMats.push(signMat);
      this._entrance(g, f, 12, 4, 0xb48a70, 'HOTEL ROYALE', b.color);
    } else if (b.style === 'office') {
      this._sign(g, f, b.sign, b.color, 4.6, 12, 1.4);
      this._entrance(g, f, 6, 3.6, 0x8e877b);
    } else if (b.style === 'hospital') {
      this._sign(g, f, b.sign, '#ff4a4a', b.h - 2, 22, 2.8, true);
      this._entrance(g, f, 16, 4.2, 0xd8e0e2, 'EMERGENCY', '#ff4a4a');
      // Red crosses on the corners and a helipad on the roof.
      for (const s of [-1, 1]) {
        const cross = new THREE.Group();
        box(cross, 3, 0.9, 0.2, 0, 0, 0, live(basic(0xff3030)));
        box(cross, 0.9, 3, 0.2, 0, 0, 0, live(basic(0xff3030)));
        cross.position.set(f.x + s * (f.w / 2 - 3), b.h - 3, f.z + 0.2);
        g.add(cross);
      }
      const pad = new THREE.Mesh(new THREE.CircleGeometry(8, 24).rotateX(-Math.PI / 2), lambert(0x4a4f55));
      pad.position.set(cx, b.h + 0.42, cz);
      g.add(pad);
      const H = new THREE.Mesh(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2), basic(0xffffff, { map: boardTexture('H', '#ffffff'), transparent: true }));
      H.position.set(cx, b.h + 0.44, cz);
      g.add(H);
    } else if (b.style === 'motel') {
      this._motel(g, b, f);
    }
  }

  /** A sign flat on the building front, neon (lit at night) or painted. */
  _sign(g, f, text, color, y, w, h, neon = true) {
    if (!text) return;
    const tex = neon ? neonSignTexture(text, color, '') : boardTexture(text, color);
    const mat = neon ? live(basic(0xffffff, { map: tex, transparent: true })) : basic(0xffffff, { map: tex });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(f.x + f.out[0] * 0.25, y, f.z + f.out[1] * 0.25);
    m.rotation.y = f.yaw;
    m.renderOrder = 1;
    g.add(m);
    if (neon) {
      this.nightMats.push(mat);
      const halo = makeHalo(w, h, color, { day: 0.03, night: 0.5 });
      halo.position.set(f.x + f.out[0] * 0.35, y, f.z + f.out[1] * 0.35);
      halo.rotation.y = f.yaw;
      g.add(halo);
    }
  }

  /** A canopy over the front door. */
  _entrance(g, f, w, y, color, text, textColor) {
    const out = 3;
    const c = box(g, 0, 0, 0, 0, 0, 0, lambert(color));
    c.geometry.dispose();
    c.geometry = new THREE.BoxGeometry(f.out[0] ? out : w, 0.4, f.out[0] ? w : out);
    c.position.set(f.x + f.out[0] * out / 2, y, f.z + f.out[1] * out / 2);
    for (const s of [-1, 1]) {
      const px = f.x + f.out[0] * (out - 0.3) + (f.out[1] ? s * (w / 2 - 0.3) : 0);
      const pz = f.z + f.out[1] * (out - 0.3) + (f.out[0] ? s * (w / 2 - 0.3) : 0);
      box(g, 0.25, y, 0.25, px, y / 2, pz, lambert(0x3a3a3a));
      this.obstacles.push({ x: px, z: pz, r: 0.3 });
    }
    // Glass doors.
    const door = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w - 2, 5), 2.6), lambert(0x2a4050));
    door.position.set(f.x + f.out[0] * 0.04, 1.3, f.z + f.out[1] * 0.04);
    door.rotation.y = f.yaw;
    g.add(door);
    if (text) {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w, 8), 1), basic(0xffffff, { map: boardTexture(text, textColor || '#ffffff') }));
      t.position.set(f.x + f.out[0] * (out + 0.02), y + 0.1, f.z + f.out[1] * (out + 0.02));
      t.rotation.y = f.yaw;
      g.add(t);
    }
  }

  _motel(g, b, f) {
    // An upstairs walkway with a railing along the front.
    const walk = lambert(0xc98a5a);
    const rail = lambert(0xf4f0e6);
    const len = f.w;
    const along = f.out[1] ? 'x' : 'z';
    const bx = f.x + f.out[0] * 1.2;
    const bz = f.z + f.out[1] * 1.2;
    if (along === 'x') {
      box(g, len, 0.3, 2.4, bx, 3.5, bz, walk);
      box(g, len, 1, 0.08, bx, 4.15, bz + f.out[1] * 1.15, rail);
      for (let x = b.x0 + 2; x < b.x1; x += 6) { box(g, 0.25, 3.5, 0.25, x, 1.75, bz + f.out[1] * 1.1, walk); this.obstacles.push({ x, z: bz + f.out[1] * 1.1, r: 0.3 }); }
    } else {
      box(g, 2.4, 0.3, len, bx, 3.5, bz, walk);
      box(g, 0.08, 1, len, bx + f.out[0] * 1.15, 4.15, bz, rail);
      for (let z = b.z0 + 2; z < b.z1; z += 6) { box(g, 0.25, 3.5, 0.25, bx + f.out[0] * 1.1, 1.75, z, walk); this.obstacles.push({ x: bx + f.out[0] * 1.1, z, r: 0.3 }); }
    }
    if (!b.sign) return;
    // The sign on its pole: SUNSET MOTEL with a VACANCY underneath.
    const px = b.x0 - 4;
    const pz = b.z1 + 6;
    box(g, 0.5, 11, 0.5, px, 5.5, pz, lambert(0x2b2b30));
    this.obstacles.push({ x: px, z: pz, r: 0.5 });
    const top = live(basic(0xffffff, { map: neonSignTexture(b.sign, b.color, 'color tv · pool') }));
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.3), top);
    s1.position.set(px, 11.5, pz + 0.3);
    g.add(s1);
    const s1b = s1.clone();
    s1b.rotation.y = Math.PI;
    s1b.position.z = pz - 0.3;
    g.add(s1b);
    const vac = live(basic(0xffffff, { map: neonSignTexture('VACANCY', '#6bff8a', '') }));
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1), vac);
    s2.position.set(px, 9.4, pz + 0.3);
    g.add(s2);
    this.nightMats.push(top, vac);
    const halo = makeHalo(9, 2.3, b.color);
    halo.position.set(px, 11.5, pz + 0.4);
    g.add(halo);
  }

  _gasStation() {
    const g = new THREE.Group();
    this.group.add(g);
    const c = CANOPY;
    const cx = (c.x0 + c.x1) / 2;
    const cz = (c.z0 + c.z1) / 2;
    const w = c.x1 - c.x0;
    const d = c.z1 - c.z0;
    box(g, w, 0.8, d, cx, c.h, cz, lambert(0xf2f2ee));
    box(g, w + 0.2, 0.5, d + 0.2, cx, c.h + 0.55, cz, lambert(0xffd93d));
    // Lights under the canopy, bright at night.
    const glow = live(basic(0xfff6d8));
    this.canopyGlow = glow;
    for (let x = c.x0 + 4; x < c.x1; x += 8) for (let z = c.z0 + 4; z < c.z1; z += 7) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(2, 1).rotateX(Math.PI / 2), glow);
      l.position.set(x, c.h - 0.42, z);
      g.add(l);
    }
    for (const [x, z] of c.pillars) box(g, 0.8, c.h, 0.8, x, c.h / 2, z, lambert(0xd8d8d0));
    for (const [x, z] of PUMPS) {
      box(g, 1.2, 1.8, 0.8, x, 0.9, z, lambert(0xd93a3a));
      box(g, 0.9, 0.5, 0.82, x, 1.35, z, basic(0x1d2a1d));
      box(g, 3, 0.2, 1.4, x, 0.1, z, lambert(0x9a948a));
    }
    // The price sign on a tall pole, facing the farm road.
    box(g, 0.5, 9, 0.5, 190, 4.5, 207, lambert(0x2b2b30));
    const price = new THREE.Mesh(new THREE.PlaneGeometry(5, 3), basic(0xffffff, { map: boardTexture('GAS-N-GO', '#ffd93d', 'regular $1.29 · diesel $1.19') }));
    price.position.set(190, 10, 207.3);
    g.add(price);
    const back = price.clone();
    back.rotation.y = Math.PI;
    back.position.z = 206.7;
    g.add(back);
    this.obstacles.push({ x: 190, z: 207, r: 0.5 });
  }

  _openLots() {
    const lines = [];
    for (const o of LOTS_OPEN) {
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(o.x1 - o.x0, o.z1 - o.z0).rotateX(-Math.PI / 2), lambert(o.kind === 'forecourt' ? 0x55555c : 0x4a4a50));
      ground.position.set((o.x0 + o.x1) / 2, 0.018, (o.z0 + o.z1) / 2);
      this.group.add(ground);
      if (o.kind !== 'parking') continue;
      // Painted bays, 3 m wide and 6 m deep, in rows facing each other.
      for (let z = o.z0 + 2; z + 12 <= o.z1; z += 16) {
        for (let x = o.x0 + 2; x <= o.x1 - 2; x += 3) {
          lines.push([x, z, z + 6], [x, z + 7, z + 13]);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    const pos = [];
    for (const [x, z0, z1] of lines) {
      pos.push(x - 0.07, 0.03, z0, x - 0.07, 0.03, z1, x + 0.07, 0.03, z0, x + 0.07, 0.03, z0, x - 0.07, 0.03, z1, x + 0.07, 0.03, z1);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    this.group.add(new THREE.Mesh(geo, basic(0xe8e4d4)));
  }

  /** Pavement along the north side of the farm road, in front of the new buildings. */
  _pavements() {
    const tex = pavingTexture().clone();
    tex.needsUpdate = true;
    for (const [x0, x1] of [[-262, -12], [12, 266]]) {
      const t = tex.clone();
      t.needsUpdate = true;
      t.repeat.set((x1 - x0) / 4, 2);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 8).rotateX(-Math.PI / 2), lambert(0xffffff, { map: t }));
      m.position.set((x0 + x1) / 2, 0.028, 208);
      this.group.add(m);
    }
    // Paths from the pavement to each front door facing it.
    for (const b of BUILDINGS) {
      if (b.face !== 'south') continue;
      const t = tex.clone();
      t.needsUpdate = true;
      t.repeat.set(3, (204 - b.z1) / 4);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(12, 204 - b.z1).rotateX(-Math.PI / 2), lambert(0xffffff, { map: t }));
      m.position.set((b.x0 + b.x1) / 2, 0.026, (b.z1 + 204) / 2);
      this.group.add(m);
    }
  }

  update(dt, night) {
    for (const m of this.nightMats) {
      if (m.emissiveMap) m.emissiveIntensity = night * 1.15;
      else m.color.setScalar(0.7 + night * 0.3);
    }
    if (this.canopyGlow) this.canopyGlow.color.setScalar(0.6 + night * 0.4);
    if (this.beacon) this.beacon.visible = night > 0.3 && (performance.now() % 1600) < 700;
  }
}
