import * as THREE from 'three';
import { pbr } from '../gfx/materials.js';
import {
  HOODS, HOOD_T, HOOD_HOUSES, HQS, TAG_POINTS, PARKS, HOOD_STREETS, hx, hz, hoodRect,
} from '/shared/hoods.js';
import {
  pavingTexture, plasterTexture, roofTileTexture, boardTexture, neonSignTexture, brickTexture,
  decoWallTexture, glowTexture, plankTexture, graffitiTexture,
} from '../textures.js';
import { LOT_BY_ID } from '/shared/map.js';
import { makeHalo } from '../neon.js';
import { buildPalms } from '../palms.js';
import { batchStatic, live, dynamic } from '../batcher.js';
import { mergeByMaterial } from '../merge.js';

// The six neighbourhoods: pavements along each street, the gang's clubhouse at
// the end nearest downtown, a row of houses, a park, the walls the gangs tag,
// and an arch over the street with the owner's name on it once somebody moves
// in. Colours and signs follow whoever owns the hood.

const phong = (color, o = {}) => pbr(color, { shininess: 8, ...o });
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
const HOUSE_AWNINGS = [0xc0392b, 0x2e86de, 0x27ae60, 0xe67e22, 0x8e44ad, 0x16a085];

export class HoodView {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.obstacles = [];
    this.lampMats = [];
    this.signs = new Map();       // hood -> { arch, hq, key }
    this.tagPlanes = new Map();   // tag id -> { mesh, key }
    this.upgrades = new Map();    // hood -> { street: [groups by level], ... }
    this.damage = new Map();      // hood -> { key: hp } (buildings knocked about)
    this.boxes = [];              // compound walls, once built: they block like any wall
    this.owners = new Map();      // hood -> { gang, color } of whoever runs it
    this.tags = {};
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

    this._upgradeProps(g, h);

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
      // The paint on it: whoever tagged it last (the hood's own gang by default).
      const paint = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.3),
        pbr(0xffffff, { roughness: 0.85, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      const n = { south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0] }[t.face];
      paint.position.set(t.x + n[0] * 0.22, 1.35, t.z + n[1] * 0.22);
      paint.rotation.y = Math.atan2(n[0], n[1]);
      paint.visible = false;
      g.add(dynamic(paint));
      this.tagPlanes.set(t.id, { mesh: paint, key: null, hood: h.index, k: t.k });
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

  // ---------------------------------------------------------- upgrades

  /**
   * What the clubhouse upgrades look like, built once and hidden: palm trees,
   * string lights and planters (streetscape), a billboard on the avenue,
   * fences and awnings on the houses, compound walls, cameras, the armoury's
   * crates. setOwners shows what has been bought.
   */
  _upgradeProps(g, h) {
    const hide = (grp) => { grp.visible = false; g.add(dynamic(grp)); return grp; };
    const zN = hz(h, HOOD_T.walk.n[0] + 1.2);
    const zS = hz(h, HOOD_T.walk.s[1] - 1.2);
    const along = [];
    for (let lx = 30; lx <= 240; lx += 26) along.push(lx);

    // Streetscape 1: palms down both pavements.
    const palms = buildPalms(along.flatMap((lx, i) => [[hx(h, lx), zN], [hx(h, lx + 13), zS]]), 31 + h.index);
    const s1 = hide(new THREE.Group());
    s1.add(palms.group);
    // 2: strings of lights across the street.
    const s2 = hide(new THREE.Group());
    const wire = phong(0x222222);
    const bulb = live(basic(0xffe6a0));
    this.lampMats.push(bulb);
    for (let lx = 40; lx <= 230; lx += 38) {
      const x = hx(h, lx);
      box(s2, 0.06, 0.06, zS - zN, x, 5.4, (zN + zS) / 2, wire);
      for (const z of [zN, zS]) box(s2, 0.12, 5.4, 0.12, x, 2.7, z, wire);
      for (let k = 1; k < 9; k++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), bulb);
        b.position.set(x, 5.25 - Math.sin((k / 9) * Math.PI) * 0.5, zN + (zS - zN) * (k / 9));
        s2.add(b);
      }
    }
    // 3: planters full of flowers.
    const s3 = hide(new THREE.Group());
    const planter = phong(0x8a7a66);
    const flowers = [0xe84393, 0xf1c40f, 0xff7f50, 0x9b59b6].map((c) => phong(c));
    const bloom = new THREE.SphereGeometry(0.2, 6, 4);
    along.forEach((lx, i) => {
      for (const [z, off] of [[zN, 6], [zS, 19]]) {
        const x = hx(h, lx + off);
        box(s3, 1.4, 0.6, 1.0, x, 0.3, z, planter);
        for (let k = 0; k < 5; k++) {
          const f = new THREE.Mesh(bloom, flowers[(i + k) % flowers.length]);
          f.position.set(x - 0.5 + k * 0.25, 0.7 + (k % 2) * 0.08, z + (k % 2 ? 0.2 : -0.2));
          s3.add(f);
        }
      }
    });

    // Billboard, out on the avenue by the arch.
    const bb = hide(new THREE.Group());
    const bx = hx(h, HOOD_T.arch.x + 3);
    const bz = hz(h, HOOD_T.walk.n[0] - 8);
    for (const dz of [-4, 4]) box(bb, 0.4, 8, 0.4, bx, 4, bz + dz, phong(0x3b3f45));
    const board = new THREE.Mesh(new THREE.PlaneGeometry(11, 4.6), basic(0xffffff));
    board.rotation.y = h.mirror ? -Math.PI / 2 : Math.PI / 2;
    board.position.set(bx + (h.mirror ? -0.25 : 0.25), 9.4, bz);
    bb.add(board);
    const boardBack = new THREE.Mesh(new THREE.PlaneGeometry(11, 4.6), phong(0x2b2e33));
    boardBack.rotation.y = -board.rotation.y;
    boardBack.position.set(bx + (h.mirror ? 0.25 : -0.25), 9.4, bz);
    bb.add(boardBack);

    // Houses 1: picket fences; 2: striped awnings.
    const hs1 = hide(new THREE.Group());
    const hs2 = hide(new THREE.Group());
    const white = phong(0xf4f1ea);
    const awnings = HOUSE_AWNINGS.map((c) => phong(c));
    for (const house of HOOD_HOUSES.filter((q2) => q2.hood === h.index)) {
      const y = house.yard;
      box(hs1, (y.x1 - y.x0) - 5, 0.12, 0.08, (y.x0 + y.x1) / 2 - 2.5, 0.75, y.z0 + 0.4, white);
      box(hs1, (y.x1 - y.x0) - 5, 0.12, 0.08, (y.x0 + y.x1) / 2 - 2.5, 0.35, y.z0 + 0.4, white);
      for (let x = y.x0 + 0.3; x < y.x1 - 5; x += 0.55) box(hs1, 0.1, 0.95, 0.06, x, 0.48, y.z0 + 0.42, white);
      const aw = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 1.6), awnings[house.k % awnings.length]);
      aw.position.set(house.door[0], 2.7, house.box.z0 - 0.7);
      aw.rotation.x = -0.35;
      hs2.add(aw);
    }

    // Walls round the clubhouse yard (the street side stays open).
    const yard = HQS[h.index].yard;
    const walls = [1.2, 2.2, 2.2].map((ht, i) => {
      const grp = hide(new THREE.Group());
      const mat = phong(0xffffff, { map: tiled(brickTexture(i ? '#6a4a3e' : '#9a8a7a'), 6, ht, 3) });
      const t = 0.35;
      const rects = [
        { x0: yard.x0, x1: yard.x1, z0: yard.z0, z1: yard.z0 + t },
        { x0: yard.x0, x1: yard.x0 + t, z0: yard.z0, z1: yard.z1 - 6 },
        { x0: yard.x1 - t, x1: yard.x1, z0: yard.z0, z1: yard.z1 - 6 },
      ];
      for (const r of rects) box(grp, r.x1 - r.x0, ht, r.z1 - r.z0, (r.x0 + r.x1) / 2, ht / 2, (r.z0 + r.z1) / 2, mat);
      if (i === 2) {
        // Razor wire along the top.
        for (const r of rects) {
          const len = Math.max(r.x1 - r.x0, r.z1 - r.z0);
          const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, len, 8, 1, true), phong(0x9aa1ad, { wireframe: true }));
          coil.rotation.set(r.x1 - r.x0 > r.z1 - r.z0 ? 0 : Math.PI / 2, 0, r.x1 - r.x0 > r.z1 - r.z0 ? Math.PI / 2 : 0);
          coil.position.set((r.x0 + r.x1) / 2, ht + 0.2, (r.z0 + r.z1) / 2);
          grp.add(coil);
        }
      }
      grp.userData.rects = rects.map((r) => ({ ...r, h: ht }));
      return grp;
    });

    // CCTV: cameras on the arch and the clubhouse corners, red lights blinking.
    const cam = hide(new THREE.Group());
    const led = live(basic(0xff2a2a));
    this.leds = this.leds || [];
    this.leds.push(led);
    const b = HQS[h.index].building;
    const housing = phong(0xdddddd);
    for (const [x, z] of [[b.x0, b.z1], [b.x1, b.z1], [hx(h, HOOD_T.arch.x), hz(h, HOOD_T.street.z0 - 3)]]) {
      box(cam, 0.3, 0.25, 0.5, x, 7.2, z + 0.3, housing);
      box(cam, 0.08, 0.08, 0.08, x, 7.25, z + 0.58, led);
    }
    // Armoury: crates of kit stacked by the door.
    const arm = hide(new THREE.Group());
    const crate = phong(0x5a6b3a);
    const d = HQS[h.index].door;
    for (let k = 0; k < 4; k++) box(arm, 1.1, 0.7, 0.7, d[0] + (h.mirror ? -3 : 3) + (k % 2) * 1.2, 0.35 + Math.floor(k / 2) * 0.7, d[2] - 1.5, crate);

    // Hundreds of little parts: one draw call per material per group. (The
    // billboard face keeps its own mesh: its picture changes.)
    for (const grp of [s2, s3, hs1, hs2, ...walls, cam, arm]) mergeByMaterial(grp);
    this.upgrades.set(h.index, { street: [s1, s2, s3], billboard: [bb], houses: [hs1, hs2], walls, cctv: [cam], armory: [arm], board });
  }

  _showUpgrades(index, up, gang, color) {
    const u = this.upgrades.get(index);
    if (!u) return;
    const lvl = (k) => (up && Number.isFinite(up[k]) ? up[k] : 0);
    for (const k of ['street', 'billboard', 'houses', 'cctv', 'armory']) u[k].forEach((grp, i) => { grp.visible = lvl(k) > i; });
    // Only the highest wall shows.
    u.walls.forEach((grp, i) => { grp.visible = lvl('walls') === i + 1; });
    if (lvl('billboard') > 0 && gang) {
      u.board.material.map = boardTexture(gang.toUpperCase(), color || '#f2c14e', 'eat local · pay cash · no trouble');
      u.board.material.needsUpdate = true;
    }
    this.boxes = [];
    for (const [, v] of this.upgrades) {
      const w = v.walls.find((grp) => grp.visible);
      if (w) this.boxes.push(...w.userData.rects);
    }
  }

  /** Buildings in any hood that are badly knocked about: where their smoke comes from. */
  smokeSpots() {
    const out = [];
    for (const [hood, hp] of this.damage) {
      for (const [key, v] of Object.entries(hp || {})) {
        if (v >= 60) continue;
        let x; let y; let z;
        if (key === 'hq') { const b = HQS[hood].building; x = (b.x0 + b.x1) / 2; z = (b.z0 + b.z1) / 2; y = 8.5; }
        else if (key[0] === 'h') {
          const house = HOOD_HOUSES.find((q) => q.hood === hood && q.k === Number(key.slice(1)));
          if (!house) continue;
          x = (house.box.x0 + house.box.x1) / 2; z = (house.box.z0 + house.box.z1) / 2; y = 3.6;
        } else if (key[0] === 'r') {
          const c = this.lotCentre(Number(key.slice(1)));
          if (!c) continue;
          [x, z] = c; y = 5;
        } else continue;
        out.push({ x, y, z, k: 1 - v / 60 });
      }
    }
    return out;
  }

  /** Graffiti on every tag wall, from the server's map of tags. */
  setTags(tags) {
    this.tags = tags || {};
    this._paintTags();
  }

  _paintTags() {
    for (const [id, e] of this.tagPlanes) {
      const t = this.tags[id];
      const own = this.owners.get(e.hood);
      // Nobody's tag there: the hood's own gang's name, if it has one.
      const show = t ? { name: t.name, color: t.color } : own && own.gang ? { name: own.gang, color: own.color } : null;
      const key = show ? `${show.name}|${show.color}` : '';
      if (key === e.key) continue;
      e.key = key;
      e.mesh.visible = !!show;
      if (!show) continue;
      e.mesh.material.map = graffitiTexture(show.name, show.color, e.k + e.hood * 7);
      e.mesh.material.needsUpdate = true;
    }
  }

  /** Owners from the server's plot list: signs and colours follow them. */
  setOwners(plots) {
    let tagsChanged = false;
    for (const p of plots || []) {
      if (!p) continue;
      const next = p.owner ? { gang: p.gang || `${p.owner}'s crew`, color: p.color } : null;
      this._showUpgrades(p.index, p.owner ? p.up : null, next && next.gang, p.color);
      this.damage.set(p.index, p.owner ? p.hp || {} : {});
      if (JSON.stringify(next) !== JSON.stringify(this.owners.get(p.index) || null)) { this.owners.set(p.index, next); tagsChanged = true; }
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
    if (tagsChanged) this._paintTags();
  }

  update(dt, night) {
    const glow = 0.35 + night * 0.65;
    for (const mat of this.lampMats) mat.color.setRGB(glow, glow * 0.94, glow * 0.75);
    this.poolMat.opacity = night * 0.55;
    // Camera lights blink.
    const on = Math.floor(performance.now() / 700) % 2 === 0;
    for (const led of this.leds || []) led.color.setHex(on ? 0xff2a2a : 0x3a0808);
  }

  /** Where a restaurant lot's middle is (for its smoke). */
  lotCentre(id) {
    const l = LOT_BY_ID.get(id);
    return l ? [(l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2] : null;
  }
}
