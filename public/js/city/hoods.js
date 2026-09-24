import * as THREE from 'three';
import {
  HOODS, HOOD_T, HOOD_HOUSES, HQS, TAG_POINTS, PARKS, HOOD_STREETS, hx, hz, hoodRect,
} from '/shared/hoods.js';
import {
  pavingTexture, plasterTexture, roofTileTexture, boardTexture, neonSignTexture, brickTexture,
  decoWallTexture, glowTexture, plankTexture,
} from '../textures.js';
import { makeHalo } from '../neon.js';
import { buildPalms } from '../palms.js';
import { batchStatic, live, dynamic } from '../batcher.js';

// The six neighbourhoods: pavements along each street, the gang's clubhouse at
// the end nearest downtown, a row of houses, a park, the walls the gangs tag,
// and an arch over the street with the owner's name on it once somebody moves
// in. Colours and signs follow whoever owns the hood.

const phong = (color, o = {}) => new THREE.MeshPhongMaterial({ color, shininess: 8, specular: 0x111111, ...o });
const basic = (color, o = {}) => new THREE.MeshBasicMaterial({ color, ...o });

function box(parent, w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function flat(parent, r, y, mat) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0).rotateX(-Math.PI / 2), mat);
  m.position.set((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2);
  parent.add(m);
  return m;
}

function tiled(tex, w, h, size) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(w / size, h / size);
  return t;
}

const HOUSE_COLOURS = ['#f7c6e0', '#bde6f7', '#fff1b8', '#c8f2d0', '#ffd6b0', '#e2d4ff'];

export class HoodView {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.obstacles = [];
    this.lampMats = [];
    this.signs = new Map();       // hood -> { arch, hq, key }
    this.neon = [];
    for (const h of HOODS) this._hood(h);
    this._lights();
    this.batch = batchStatic(this.group, { chunk: 128 });
  }

  _hood(h) {
    const g = new THREE.Group();
    this.group.add(g);
    const street = HOOD_STREETS[h.index];
    const paving = pavingTexture();
    // Pavements both sides of the street.
    for (const [a, b] of [HOOD_T.walk.n, HOOD_T.walk.s]) {
      const r = { x0: h.x0, x1: h.x1, z0: hz(h, a), z1: hz(h, b) };
      flat(g, r, 0.03, phong(0xffffff, { map: tiled(paving, r.x1 - r.x0, r.z1 - r.z0, 4) }));
    }

    // The clubhouse.
    const q = HQS[h.index];
    const b = q.building;
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const hq = new THREE.Group();
    g.add(hq);
    box(hq, w, 8, d, cx, 4, cz, phong(0xffffff, { map: tiled(brickTexture('#8a5a48'), w, 8, 4) }));
    box(hq, w + 0.6, 0.5, d + 0.6, cx, 8.25, cz, phong(0x3b3f45));
    // Roller door and a steel side door on the front, facing the street.
    box(hq, 7, 4, 0.2, q.door[0] + (h.mirror ? 7 : -7), 2, b.z1 + 0.1, phong(0x7d858f));
    box(hq, 1.4, 2.4, 0.2, q.door[0], 1.2, b.z1 + 0.1, phong(0x4a2f22));
    // Barred windows up top.
    for (let k = -2; k <= 2; k++) box(hq, 2.2, 1.2, 0.15, cx + k * 7, 6, b.z1 + 0.1, basic(0x1d2530));
    // The sign over the door: the owner's gang, once someone lives here.
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.2), basic(0xffffff, { map: boardTexture('CLUBHOUSE', '#8d8378', 'for rent') }));
    sign.position.set(cx, 7.3, b.z1 + 0.25);
    hq.add(dynamic(sign));
    // A yard: cracked concrete in front.
    const yard = { ...q.yard, z0: b.z1, z1: q.yard.z1 };
    flat(g, yard, 0.02, phong(0xffffff, { map: tiled(plasterTexture('#a9a39a'), yard.x1 - yard.x0, yard.z1 - yard.z0, 6) }));

    // The arch over the street, at the end towards downtown.
    const archX = hx(h, HOOD_T.arch.x);
    const arch = new THREE.Group();
    const post = phong(0x2b2e33);
    box(arch, 0.7, 9, 0.7, 0, 4.5, street.z0 - 3, post);
    box(arch, 0.7, 9, 0.7, 0, 4.5, street.z1 + 3, post);
    const faceMat = basic(0xffffff, { map: neonSignTexture(h.name.toUpperCase(), '#ffffff', '') });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(street.z1 - street.z0 + 7, 2.4), faceMat);
    face.rotation.y = Math.PI / 2;
    face.position.set(0.4, 9.4, (street.z0 + street.z1) / 2);
    arch.add(dynamic(face));
    const back = dynamic(face.clone());
    back.rotation.y = -Math.PI / 2;
    back.position.x = -0.4;
    arch.add(back);
    arch.position.set(archX, 0, 0);
    g.add(arch);
    this.obstacles.push({ x: archX, z: street.z0 - 3, r: 0.5 }, { x: archX, z: street.z1 + 3, r: 0.5 });
    this.signs.set(h.index, { sign, face, back, key: '' });

    // Houses.
    for (const house of HOOD_HOUSES.filter((q2) => q2.hood === h.index)) this._house(g, house);

    // The park: a patch of lawn, a court, benches and palms.
    const park = PARKS[h.index];
    flat(g, park, 0.015, phong(0x6fae4c));
    const court = { x0: park.x0 + 6, x1: park.x0 + 30, z0: park.z0 + 8, z1: park.z0 + 26 };
    flat(g, court, 0.025, phong(0x8a4f3a));
    for (const [ax, az] of [[court.x0 + 1, (court.z0 + court.z1) / 2], [court.x1 - 1, (court.z0 + court.z1) / 2]]) {
      box(g, 0.15, 3, 0.15, ax, 1.5, az, phong(0x777777));
      box(g, 0.1, 1, 1.4, ax, 3.1, az, basic(0xffffff));
    }
    const palms = buildPalms([[park.x0 + 40, park.z0 + 6], [park.x1 - 6, park.z0 + 20], [park.x0 + 46, park.z1 - 8]]);
    g.add(palms.group);
    this.obstacles.push(...palms.obstacles);

    // Walls the gangs spray their tags on.
    for (const t of TAG_POINTS.filter((q2) => q2.hood === h.index)) {
      const along = t.along === 'x';
      box(g, along ? 6 : 0.4, 2.6, along ? 0.4 : 6, t.x, 1.3, t.z, phong(0xffffff, { map: tiled(plasterTexture('#cfc6b4'), 6, 2.6, 3) }));
      this.obstacles.push({ x: t.x + (along ? -2 : 0), z: t.z + (along ? 0 : -2), r: 0.6 }, { x: t.x, z: t.z, r: 0.6 }, { x: t.x + (along ? 2 : 0), z: t.z + (along ? 0 : 2), r: 0.6 });
    }
  }

  _house(g, house) {
    const b = house.box;
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    const hg = new THREE.Group();
    hg.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
    g.add(hg);
    const colour = HOUSE_COLOURS[(house.hood * 3 + house.k) % HOUSE_COLOURS.length];
    box(hg, w, 3.2, d, 0, 1.6, 0, phong(0xffffff, { map: decoWallTexture(colour, '#ffffff') }));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) / 2 + 0.6, 2.2, 4), phong(0xffffff, { map: roofTileTexture('#7a3a2a') }));
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(w / Math.hypot(w, d) * 1.4, 1, d / Math.hypot(w, d) * 1.4);
    roof.position.y = 4.3;
    hg.add(roof);
    // Front door, facing the street (north).
    box(hg, 1.2, 2.1, 0.1, 0, 1.05, -d / 2 - 0.05, phong(0x6b3f22));
    for (const s of [-1, 1]) box(hg, 1.3, 1, 0.08, s * 2.4, 1.8, -d / 2 - 0.05, basic(0x2a3448));
    // Picket fence along the front of the yard.
    const y = house.yard;
    const picket = phong(0xf2efe6);
    box(g, y.x1 - y.x0 - 3, 0.8, 0.1, (y.x0 + y.x1) / 2 + 1.5, 0.4, y.z0 + 0.4, picket);
    // Street number.
    const num = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.4), basic(0xffffff, { map: boardTexture(`No. ${house.k + 1}`, '#ffffff') }));
    num.position.set(0, 2.75, -d / 2 - 0.12);
    num.rotation.y = Math.PI;
    hg.add(num);
  }

  _lights() {
    const spots = [];
    for (const s of HOOD_STREETS) {
      for (let x = s.x0 + 10; x < s.x1; x += 32) spots.push([x, s.z0 - 1.5], [x + 16, s.z1 + 1.5]);
    }
    this.lampSpots = spots;
    const poleMat = phong(0x2b2b30, { shininess: 40 });
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 5.2, 8), poleMat, spots.length);
    const headMat = live(basic(0x6a6a6a));
    this.lampMats.push(headMat);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 10, 8), headMat, spots.length);
    const poolMat = basic(0xffffff, { map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(9, 9), poolMat, spots.length);
    this.poolMat = poolMat;
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    spots.forEach(([x, z], i) => {
      m.makeTranslation(x, 2.6, z); poles.setMatrixAt(i, m);
      m.makeTranslation(x, 5.3, z); heads.setMatrixAt(i, m);
      m.makeTranslation(x, 0.06, z).multiply(rot); pools.setMatrixAt(i, m);
      this.obstacles.push({ x, z, r: 0.3 });
    });
    this.group.add(poles, heads, pools);
  }

  /** Owners from the server's plot list: signs and colours follow them. */
  setOwners(plots) {
    for (const p of plots || []) {
      if (!p) continue;
      const s = this.signs.get(p.index);
      if (!s) continue;
      const key = p.owner ? `${p.owner}|${p.color}|${p.gang || ''}` : 'none';
      if (s.key === key) continue;
      s.key = key;
      const h = HOODS[p.index];
      const title = p.owner ? (p.gang || `${p.owner.toUpperCase()}'S CREW`) : 'CLUBHOUSE';
      s.sign.material.map = boardTexture(title.toUpperCase(), p.owner ? p.color : '#8d8378', p.owner ? `${h.name} · members only` : 'for rent');
      s.sign.material.needsUpdate = true;
      const arch = neonSignTexture(h.name.toUpperCase(), p.owner ? p.color : '#ffffff', p.owner ? `${p.owner}'s turf` : '');
      s.face.material.map = arch;
      s.face.material.needsUpdate = true;
    }
  }

  update(dt, night) {
    const glow = 0.35 + night * 0.65;
    for (const mat of this.lampMats) mat.color.setRGB(glow, glow * 0.94, glow * 0.75);
    this.poolMat.opacity = night * 0.55;
  }
}
