import * as THREE from 'three';
import {
  BOUNDS, PLAZA, ROADS, SHOPS, ORDERS_BOARD, PLOTS, PLOT_SIZE, GATE, TRACK, RAMPS, CASINO,
  shopCounter,
} from '/shared/map.js';
import { VEHICLES } from '/shared/catalog.js';
import {
  grassTexture, asphaltTexture, pavingTexture, dirtTexture, plankTexture, brickTexture,
  boardTexture, kerbTexture, checkerTexture, glowTexture,
  leafTexture, pineTexture, grassTuftTexture, roofTileTexture,
} from './textures.js';
import { buildVehicle } from './vehicles.js';
import { buildGun } from './guns.js';
import { createAvatar } from './avatar.js';

const phong = (color, o = {}) => new THREE.MeshPhongMaterial({ color, shininess: 8, specular: 0x111111, ...o });
const basic = (color, o = {}) => new THREE.MeshBasicMaterial({ color, ...o });

/** Tiles a texture so one repeat covers `size` metres, cloned per use. */
function tiled(tex, w, h, size) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(w / size, h / size);
  return t;
}

function flat(parent, x0, x1, z0, z1, y, mat) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  parent.add(m);
  return m;
}

function box(parent, w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// A tiny seeded RNG so every client grows the same forest.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHOPKEEPERS = {
  farmshop: ['Old Pete', '#6bd66b', 'cowboy'],
  market: ['Marge', '#f2c14e', 'visor'],
  animalshop: ['Dolly', '#ff9f43', 'party'],
  builder: ['Big Bob', '#4dc3ff', 'traffic'],
  cardealer: ['Slick Vinny', '#ff5d5d', 'tophat'],
  machinery: ['Hank', '#e3c25a', 'cowboy'],
  landoffice: ['Ms. Deeds', '#c471e8', 'crown'],
  gunshop: ['Rusty', '#9aa7ff', 'cowboy'],
  jobcentre: ['Mrs. Pruitt', '#5fe0c0', 'visor'],
};

// Cheap smooth value noise, for painting variation into the ground.
function valueNoise(seed) {
  const rnd = seeded(seed);
  const N = 64;
  const grid = new Float32Array(N * N).map(() => rnd());
  const at = (i, j) => grid[((j % N + N) % N) * N + ((i % N + N) % N)];
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/** Three crossed quads: the classic cheap tree crown. */
function crossCards(w, h, cards = 3) {
  const geos = [];
  for (let k = 0; k < cards; k++) {
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateY((k / cards) * Math.PI);
    geos.push(g);
  }
  const pos = [];
  const uv = [];
  const nor = [];
  const idx = [];
  let base = 0;
  for (const g of geos) {
    pos.push(...g.attributes.position.array);
    uv.push(...g.attributes.uv.array);
    // Normals point up-ish so the cards light like a round canopy, not flat sheets.
    for (let i = 0; i < g.attributes.position.count; i++) nor.push(0, 1, 0);
    idx.push(...g.index.array.map((i) => i + base));
    base += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

export class Outdoor {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.obstacles = [];
    this.lampMats = [];
    this.lampPools = [];
    this.displays = [];     // spinning show cars
    this.keepers = [];
    this.t = 0;

    this._ground();
    this._roads();
    this._town();
    this._ordersBoard();
    this._streetlights();
    this._plots();
    this._track();
    this._trees();
  }

  // ---------------------------------------------------------------- ground

  _ground() {
    const w = BOUNDS.maxX - BOUNDS.minX + 400;
    const d = BOUNDS.maxZ - BOUNDS.minZ + 400;
    // A subdivided plane with colour painted into its vertices: lighter and
    // darker patches, dry grass and bare earth, so the texture does not tile
    // into an obvious grid. Sits a hair below the casino carpet.
    const geo = new THREE.PlaneGeometry(w, d, 180, 180);
    geo.rotateX(-Math.PI / 2);
    const n1 = valueNoise(11);
    const n2 = valueNoise(23);
    const colors = [];
    const pos = geo.attributes.position;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const big = n1(x / 60, z / 60);
      const small = n2(x / 14, z / 14);
      const dry = Math.max(0, big - 0.55) * 1.6;
      c.setRGB(0.92 + small * 0.16 + dry * 0.35, 0.95 + small * 0.12 + dry * 0.12, 0.85 + small * 0.1 - dry * 0.1);
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const g = new THREE.Mesh(geo, phong(0xffffff, { map: grassTexture(), vertexColors: true }));
    g.position.y = -0.03;
    g.material.map.repeat.set(w / 4, d / 4);
    this.group.add(g);
    // Hills on the horizon so the world does not end at a cliff of fog.
    const hillMat = phong(0x3d6b35, { flatShading: true });
    const rnd = seeded(7);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const r = 420 + rnd() * 60;
      const h = 40 + rnd() * 70;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(90 + rnd() * 60, h, 7), hillMat);
      hill.position.set(Math.cos(a) * r, h / 2 - 4, Math.sin(a) * r);
      this.group.add(hill);
    }
  }

  _roads() {
    const asphalt = asphaltTexture();
    const paving = pavingTexture();
    const pz = flat(this.group, PLAZA.x0, PLAZA.x1, PLAZA.z0, PLAZA.z1, 0.012,
      phong(0xffffff, { map: tiled(paving, PLAZA.x1 - PLAZA.x0, PLAZA.z1 - PLAZA.z0, 4) }));
    pz.userData.ground = true;

    const line = basic(0xf2e6b0);
    ROADS.forEach((r, i) => {
      const w = r.x1 - r.x0;
      const d = r.z1 - r.z0;
      flat(this.group, r.x0, r.x1, r.z0, r.z1, 0.02 + i * 0.001, phong(0xffffff, { map: tiled(asphalt, w, d, 6) }));
      // Dashed centre line along the long axis.
      const along = d > w;
      const len = along ? d : w;
      for (let s = 2; s < len - 2; s += 6) {
        if (along) flat(this.group, (r.x0 + r.x1) / 2 - 0.12, (r.x0 + r.x1) / 2 + 0.12, r.z0 + s, r.z0 + s + 3, 0.03, line);
        else flat(this.group, r.x0 + s, r.x0 + s + 3, (r.z0 + r.z1) / 2 - 0.12, (r.z0 + r.z1) / 2 + 0.12, 0.03, line);
      }
    });

    // Pavements either side of the main street, in front of the shops.
    for (const [a, b] of [[-12, -6], [6, 12]]) {
      flat(this.group, a, b, 68, 212, 0.015, phong(0xffffff, { map: tiled(paving, b - a, 144, 4) }));
    }

    // A fountain in the middle of the plaza, because every town square needs one.
    const f = new THREE.Group();
    const stone = phong(0xbdb4a4);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 0.8, 24), stone);
    basin.position.y = 0.4;
    f.add(basin);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.9, 0.1, 24), phong(0x3f8fd0, { shininess: 90, specular: 0xffffff }));
    water.position.y = 0.72;
    f.add(water);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 2.6, 12), stone);
    column.position.y = 1.7;
    f.add(column);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.7, 14, 10), phong(0xf2c14e, { shininess: 80 }));
    top.position.y = 3.3;
    f.add(top);
    f.position.set(0, 0, 55);
    this.group.add(f);
    this.obstacles.push({ x: 0, z: 55, r: 4.4 });
    this.fountainWater = water;
  }

  // ------------------------------------------------------------------ town

  _town() {
    for (const s of SHOPS) this._shop(s);
  }

  _shop(s) {
    const g = new THREE.Group();
    this.group.add(g);
    const w = s.x1 - s.x0;
    const d = s.z1 - s.z0;
    const H = s.id === 'cardealer' ? 7 : 6;
    const cx = (s.x0 + s.x1) / 2;
    const cz = (s.z0 + s.z1) / 2;
    const T = 0.6;
    const wall = phong(0xffffff, { map: tiled(s.id === 'builder' || s.id === 'animalshop' ? plankTexture('#a0703f') : brickTexture(), w, H, 4) });
    const wallD = phong(0xffffff, { map: tiled(s.id === 'builder' || s.id === 'animalshop' ? plankTexture('#a0703f') : brickTexture(), d, H, 4) });

    box(g, w, H, T, cx, H / 2, s.z0 + T / 2, wall);
    box(g, w, H, T, cx, H / 2, s.z1 - T / 2, wall);
    const backX = s.open === 'east' ? s.x0 + T / 2 : s.x1 - T / 2;
    box(g, T, H, d, backX, H / 2, cz, wallD);

    // Roof overhangs the open front like an awning.
    const roof = box(g, w + 1.4, 0.4, d + 1.2, cx + (s.open === 'east' ? 0.7 : -0.7), H + 0.2, cz,
      phong(0xffffff, { map: tiled(roofTileTexture(s.id === 'gunshop' ? '#4a4f5a' : '#7a3a2a'), w + 1.4, d + 1.2, 3) }));
    roof.userData.roof = true;
    const stripe = phong(new THREE.Color(s.color).multiplyScalar(0.9));
    box(g, 0.3, 0.8, d + 1.2, s.open === 'east' ? s.x1 + 1.3 : s.x0 - 1.3, H - 0.2, cz, stripe);

    // Floor.
    flat(g, s.x0, s.x1, s.z0, s.z1, 0.02, phong(0xffffff, { map: tiled(plankTexture('#6e4e33'), w, d, 3) }));

    // Sign above the open front, facing the street.
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(16, d - 2), 3.4),
      basic(0xffffff, { map: boardTexture(s.sign, s.color, s.sub) }));
    const fx = s.open === 'east' ? s.x1 + 1.5 : s.x0 - 1.5;
    sign.position.set(fx, H + 2.1, cz);
    sign.rotation.y = s.open === 'east' ? Math.PI / 2 : -Math.PI / 2;
    g.add(sign);
    // The sign's back, so it is not see-through from inside.
    const back = sign.clone();
    back.material = phong(0x1d1622);
    back.rotation.y += Math.PI;
    back.position.x += s.open === 'east' ? -0.02 : 0.02;
    g.add(back);

    // Counter and shopkeeper.
    const [sx, , sz] = shopCounter(s);
    const inward = s.open === 'east' ? -1 : 1;
    const counterX = sx + inward * 2.2;
    box(g, 1.1, 1.1, 4.2, counterX, 0.55, sz, phong(0xffffff, { map: plankTexture('#7a4e2c') }));
    box(g, 1.3, 0.1, 4.4, counterX, 1.15, sz, phong(0x2b2230));
    this.obstacles.push({ x: counterX, z: sz - 1.2, r: 0.9 }, { x: counterX, z: sz + 1.2, r: 0.9 });

    const [name, color, hat] = SHOPKEEPERS[s.id];
    const keeper = createAvatar({ name, color, hat });
    // Unlike players' tags, a shopkeeper's should not show through the walls.
    keeper.label.material.depthTest = true;
    keeper.label.scale.multiplyScalar(0.8);
    keeper.group.position.set(counterX + inward * 1.3, 0, sz);
    keeper.group.rotation.y = s.open === 'east' ? Math.PI / 2 : -Math.PI / 2;
    g.add(keeper.group);
    this.keepers.push(keeper);

    // Hanging light inside.
    const bulbMat = basic(0xfff0c0);
    this.lampMats.push(bulbMat);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), bulbMat);
    bulb.position.set(cx, H - 0.8, cz);
    g.add(bulb);

    this._shopDecor(g, s, inward);
  }

  _shopDecor(g, s, inward) {
    const cz = (s.z0 + s.z1) / 2;
    const deepX = s.open === 'east' ? s.x0 + 3 : s.x1 - 3;
    const rnd = seeded(s.x0 * 13 + s.z0);
    const crates = (colors, n, h = 0.8) => {
      for (let i = 0; i < n; i++) {
        const z = s.z0 + 2 + (i / (n - 1)) * (s.z1 - s.z0 - 4);
        const c = box(g, 1.1, h, 1.1, deepX, h / 2, z, phong(0xffffff, { map: plankTexture('#9b6b3d') }));
        c.rotation.y = (rnd() - 0.5) * 0.4;
        this.obstacles.push({ x: deepX, z, r: 0.8 });
        const top = colors[i % colors.length];
        for (let k = 0; k < 5; k++) {
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), phong(top));
          b.position.set(deepX + (rnd() - 0.5) * 0.7, h + 0.15, z + (rnd() - 0.5) * 0.7);
          g.add(b);
        }
      }
    };

    if (s.id === 'farmshop') {
      for (let i = 0; i < 6; i++) {
        const sack = box(g, 0.9, 1.1, 0.6, deepX + (i % 2) * 0.9 * -inward, 0.55, s.z0 + 3 + i * 2.2, phong(0xd8c39a));
        sack.rotation.y = rnd() * 0.5;
      }
      this.obstacles.push({ x: deepX, z: cz, r: 1.2 });
    } else if (s.id === 'market') {
      crates(['#e3c25a', '#f08a2c', '#c9a36b', '#f5d63d', '#e8412c', '#f07a1a', '#e8283c'], 7);
    } else if (s.id === 'animalshop') {
      for (let i = 0; i < 4; i++) {
        box(g, 1.4, 0.9, 1.0, deepX, 0.45, s.z0 + 3 + i * 3.6, phong(0xe0c26a));
        this.obstacles.push({ x: deepX, z: s.z0 + 3 + i * 3.6, r: 0.8 });
      }
    } else if (s.id === 'builder') {
      for (let i = 0; i < 5; i++) box(g, 3.6, 0.16, 0.5, deepX, 0.1 + i * 0.17, cz - 3, phong(0xc49a64));
      for (let i = 0; i < 3; i++) box(g, 1, 0.5, 2, deepX, 0.25 + i * 0.5, cz + 3, phong(0xa04a36));
      this.obstacles.push({ x: deepX, z: cz - 3, r: 1.8 }, { x: deepX, z: cz + 3, r: 1.2 });
    } else if (s.id === 'gunshop') {
      // A rack of rifles on the back wall.
      const wallX = s.open === 'east' ? s.x0 + 0.7 : s.x1 - 0.7;
      box(g, 0.15, 2.2, 7, wallX, 2.2, cz, phong(0xffffff, { map: plankTexture('#5a3a22') }));
      ['boltrifle', 'lever', 'shotgun', 'semiauto', 'biggame'].forEach((id, i) => {
        const gun = buildGun(id).group;
        gun.scale.setScalar(1.6);
        gun.rotation.set(0, s.open === 'east' ? Math.PI / 2 : -Math.PI / 2, Math.PI / 2);
        gun.position.set(wallX + (s.open === 'east' ? 0.12 : -0.12), 2.2, cz - 2.8 + i * 1.4);
        g.add(gun);
      });
      box(g, 1.4, 1.0, 3, deepX + inward * -1, 0.5, cz, phong(0x2a1d15));
      this.obstacles.push({ x: deepX + inward * -1, z: cz, r: 1.4 });
    } else if (s.id === 'landoffice') {
      box(g, 2.4, 0.9, 1.2, deepX, 0.45, cz, phong(0x5b3a1e));
      const map = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.5), basic(0xffffff, { map: boardTexture('THE VALLEY', '#c471e8', 'six farms · one casino') }));
      map.position.set(s.open === 'east' ? s.x0 + 0.62 : s.x1 - 0.62, 3.2, cz);
      map.rotation.y = s.open === 'east' ? Math.PI / 2 : -Math.PI / 2;
      g.add(map);
      this.obstacles.push({ x: deepX, z: cz, r: 1.3 });
    } else if (s.id === 'cardealer' || s.id === 'machinery') {
      const models = VEHICLES.filter((v) => (s.id === 'cardealer' ? v.kind === 'car' : v.kind === 'machine'));
      const shown = s.id === 'cardealer' ? models.filter((_, i) => i % 2 === 1 || i === models.length - 1).slice(0, 3) : models;
      shown.forEach((m, i) => {
        const z = s.z0 + 5 + i * ((s.z1 - s.z0 - 10) / Math.max(1, shown.length - 1));
        const x = deepX + (m.id === 'combine' ? 3 * -inward : 0) + (s.id === 'cardealer' ? 4 * -inward : 0);
        const plinth = new THREE.Mesh(new THREE.CylinderGeometry(m.id === 'combine' ? 0 : 3, 3, 0.25, 24), phong(0x2b2230, { shininess: 60 }));
        plinth.position.set(x, 0.12, z);
        if (m.id !== 'combine') g.add(plinth);
        const v = buildVehicle(m.id, ['#d93a3a', '#f2c14e', '#2f7de0'][i % 3], { implement: m.id === 'tractor' ? 'seeder' : null });
        v.group.position.set(x, m.id === 'combine' ? 0 : 0.25, z);
        v.group.rotation.y = i * 1.3;
        g.add(v.group);
        if (m.id !== 'combine' && m.id !== 'tractor') this.displays.push(v.group);
        else v.group.rotation.y = inward > 0 ? -Math.PI / 2 : Math.PI / 2;
        this.obstacles.push({ x, z, r: m.id === 'combine' ? 3 : 2.6 });
      });
    }
  }

  _ordersBoard() {
    const [x, , z] = ORDERS_BOARD.pos;
    const g = new THREE.Group();
    const wood = phong(0xffffff, { map: plankTexture('#8a5a30') });
    box(g, 0.25, 3.4, 0.25, 0, 1.7, -2.0, wood);
    box(g, 0.25, 3.4, 0.25, 0, 1.7, 2.0, wood);
    box(g, 0.2, 2.2, 4.6, 0, 2.3, 0, wood);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 1.9), basic(0xffffff, { map: boardTexture('ORDERS', '#f2c14e', 'deliver here · first come first paid') }));
    face.position.set(0.12, 2.3, 0);
    face.rotation.y = Math.PI / 2;
    g.add(face);
    // A few paper notes pinned on the other side.
    for (let i = 0; i < 3; i++) {
      const note = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1), basic(0xf5eed8));
      note.position.set(-0.12, 2.3 + (i % 2) * 0.2, -1.4 + i * 1.4);
      note.rotation.y = -Math.PI / 2;
      note.rotation.z = (i - 1) * 0.1;
      g.add(note);
    }
    g.position.set(x, 0, z);
    this.group.add(g);
  }

  // ----------------------------------------------------------- streetlights

  _streetlights() {
    const spots = [];
    for (let z = 74; z <= 206; z += 22) spots.push([-7.2, z], [7.2, z]);
    for (const [x, z] of [[-40, 44], [40, 44], [-40, 66], [40, 66], [-20, 66], [20, 66]]) spots.push([x, z]);
    for (let x = -250; x <= 250; x += 40) if (Math.abs(x) > 10) spots.push([x, 223.5]);
    for (let z = -90; z <= 60; z += 30) spots.push([-61.5, z], [61.5, z]);

    const poleMat = phong(0x2b2b30, { shininess: 40 });
    const pole = new THREE.CylinderGeometry(0.1, 0.14, 5.2, 8);
    const poles = new THREE.InstancedMesh(pole, poleMat, spots.length);
    const headMat = basic(0x6a6a6a);
    this.lampMats.push(headMat);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 10, 8), headMat, spots.length);
    const poolMat = basic(0xffffff, { map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(9, 9), poolMat, spots.length);
    this.poolMat = poolMat;
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    spots.forEach(([x, z], i) => {
      m.makeTranslation(x, 2.6, z);
      poles.setMatrixAt(i, m);
      m.makeTranslation(x, 5.3, z);
      heads.setMatrixAt(i, m);
      m.makeTranslation(x, 0.05, z).multiply(rot);
      pools.setMatrixAt(i, m);
      this.obstacles.push({ x, z, r: 0.3 });
    });
    this.group.add(poles, heads, pools);
  }

  // ------------------------------------------------------------------ plots

  /** The parts of every farm that exist before anyone buys anything. */
  _plots() {
    const dirt = dirtTexture();
    const postGeo = new THREE.BoxGeometry(0.22, 1.3, 0.22);
    const railGeo = new THREE.BoxGeometry(1, 0.12, 0.08);
    const posts = [];
    const rails = [];
    for (const plot of PLOTS) {
      const { x0, z0 } = plot;
      const S = PLOT_SIZE;
      // Yard and the dirt track from the gate to the house.
      flat(this.group, x0 + 46, x0 + 58, z0 + 24, z0 + S, 0.01, phong(0xffffff, { map: tiled(dirt, 12, S - 24, 6) }));
      flat(this.group, x0 + 46, x0 + 68, z0 + 22, z0 + 26, 0.011, phong(0xffffff, { map: tiled(dirt, 22, 4, 6) }));
      // Driveway joining the farm road.
      flat(this.group, x0 + GATE[0], x0 + GATE[1], z0 + S, z0 + S + 2.2, 0.012, phong(0xffffff, { map: tiled(dirt, 12, 2, 6) }));

      const edges = [
        [x0, z0, x0 + S, z0], [x0, z0, x0, z0 + S], [x0 + S, z0, x0 + S, z0 + S],
        [x0, z0 + S, x0 + GATE[0], z0 + S], [x0 + GATE[1], z0 + S, x0 + S, z0 + S],
      ];
      for (const [ax, az, bx, bz] of edges) {
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.round(len / 3));
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          posts.push([ax + (bx - ax) * t, az + (bz - az) * t]);
        }
        for (const y of [0.55, 1.0]) rails.push({ ax, az, bx, bz, len, y });
      }
    }
    const wood = phong(0xffffff, { map: plankTexture('#b58a57') });
    const postMesh = new THREE.InstancedMesh(postGeo, wood, posts.length);
    const railMesh = new THREE.InstancedMesh(railGeo, wood, rails.length);
    const m = new THREE.Matrix4();
    posts.forEach(([x, z], i) => { m.makeTranslation(x, 0.65, z); postMesh.setMatrixAt(i, m); });
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    rails.forEach((r, i) => {
      q.setFromAxisAngle(up, -Math.atan2(r.bz - r.az, r.bx - r.ax));
      m.compose(new THREE.Vector3((r.ax + r.bx) / 2, r.y, (r.az + r.bz) / 2), q, new THREE.Vector3(r.len, 1, 1));
      railMesh.setMatrixAt(i, m);
    });
    this.group.add(postMesh, railMesh);
  }

  // ------------------------------------------------------------------ track

  _track() {
    const { cx, cz, half, r, width } = TRACK;
    const stadium = (rad) => {
      const s = new THREE.Shape();
      s.moveTo(-half, -rad);
      s.lineTo(half, -rad);
      s.absarc(half, 0, rad, -Math.PI / 2, Math.PI / 2, false);
      s.lineTo(-half, rad);
      s.absarc(-half, 0, rad, Math.PI / 2, Math.PI * 1.5, false);
      return s;
    };
    const outer = stadium(r + width / 2);
    outer.holes.push(stadium(r - width / 2));
    const geo = new THREE.ShapeGeometry(outer, 24);
    // Shape UVs are in metres; scale them to the asphalt tile.
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 6, uv.getY(i) / 6);
    const asphalt = asphaltTexture().clone();
    asphalt.needsUpdate = true;
    const trackMesh = new THREE.Mesh(geo, phong(0xffffff, { map: asphalt }));
    trackMesh.rotation.x = -Math.PI / 2;
    trackMesh.position.set(cx, 0.02, cz);
    this.group.add(trackMesh);

    // Kerbs: red and white blocks all the way round both edges.
    const kerbMat = phong(0xffffff, { map: kerbTexture() });
    // Each block is [x, z, rotation about y]; the box's long side follows the edge.
    const blocks = [];
    const addEdge = (rad) => {
      const len = 2;
      for (let x = -half; x < half; x += len) {
        blocks.push([cx + x + len / 2, cz - rad, 0]);
        blocks.push([cx + x + len / 2, cz + rad, 0]);
      }
      const steps = Math.ceil((Math.PI * rad) / len);
      for (let k = 0; k < steps; k++) {
        const a = -Math.PI / 2 + (k + 0.5) * (Math.PI / steps);
        blocks.push([cx + half + Math.cos(a) * rad, cz + Math.sin(a) * rad, -a - Math.PI / 2]);
        blocks.push([cx - half - Math.cos(a) * rad, cz + Math.sin(a) * rad, a - Math.PI / 2]);
      }
    };
    addEdge(r + width / 2);
    addEdge(r - width / 2);
    const kerbs = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 0.12, 0.7), kerbMat, blocks.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    blocks.forEach(([x, z, a], i) => {
      q.setFromAxisAngle(up, a);
      m.compose(new THREE.Vector3(x, 0.06, z), q, one);
      kerbs.setMatrixAt(i, m);
    });
    this.group.add(kerbs);

    // Start line.
    const start = new THREE.Mesh(new THREE.PlaneGeometry(3, width), phong(0xffffff, { map: checkerTexture() }));
    start.rotation.x = -Math.PI / 2;
    start.position.set(cx - 30, 0.03, cz + r);
    this.group.add(start);

    // Grandstand along the south straight.
    const stand = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      box(stand, 60, 0.8, 2.2, 0, 0.4 + i * 0.8, i * 2.2, phong(i % 2 ? 0x4a4f5c : 0x3b404c));
    }
    box(stand, 62, 0.4, 13, 0, 7.6, 4.4, phong(0xd93a3a));
    for (const x of [-30, 0, 30]) box(stand, 0.4, 7.4, 0.4, x, 3.7, 10, phong(0x2b2b30));
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(26, 4), basic(0xffffff, { map: boardTexture('VALLEY SPEEDWAY', '#ff5d5d', 'open all day · no rules') }));
    banner.position.set(0, 10, 10);
    banner.rotation.y = Math.PI;
    stand.add(banner);
    const bannerBack = new THREE.Mesh(new THREE.PlaneGeometry(26, 4), basic(0xffffff, { map: boardTexture('VALLEY SPEEDWAY', '#ff5d5d', 'open all day · no rules') }));
    bannerBack.position.set(0, 10, 10.05);
    stand.add(bannerBack);
    stand.position.set(cx, 0, cz + r + width / 2 + 3);
    this.group.add(stand);
    for (let x = -30; x <= 30; x += 4) this.obstacles.push({ x: cx + x, z: cz + r + width / 2 + 7, r: 3 });

    // Tyre walls on the outside of the bends.
    const tyreGeo = new THREE.TorusGeometry(0.45, 0.2, 6, 12);
    const tyrePos = [];
    for (const side of [-1, 1]) {
      for (let k = 0; k <= 30; k++) {
        const a = -Math.PI / 2 + (k / 30) * Math.PI;
        const R = r + width / 2 + 2.2;
        tyrePos.push([cx + side * (half + Math.cos(a) * R), cz + Math.sin(a) * R]);
      }
    }
    const tyres = new THREE.InstancedMesh(tyreGeo, phong(0x18181a), tyrePos.length * 2);
    tyrePos.forEach(([x, z], i) => {
      for (let h = 0; h < 2; h++) {
        m.makeRotationX(Math.PI / 2).setPosition(x, 0.2 + h * 0.4, z);
        tyres.setMatrixAt(i * 2 + h, m);
      }
      this.obstacles.push({ x, z, r: 0.6 });
    });
    this.group.add(tyres);

    for (const ramp of RAMPS) this._ramp(ramp);
  }

  _ramp(r) {
    const L = r.len;
    const W = r.width;
    const H = r.h;
    // A wedge: low end at -L/2, high end at +L/2 along local +x.
    const shape = new THREE.Shape();
    shape.moveTo(-L / 2, 0);
    shape.lineTo(L / 2, 0);
    shape.lineTo(L / 2, H);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false });
    geo.translate(0, 0, -W / 2);
    const mesh = new THREE.Mesh(geo, [
      phong(0xf2c14e, { flatShading: true }),
      phong(0xd9d9d9, { map: kerbTexture(), flatShading: true }),
    ]);
    mesh.rotation.y = -r.dir;
    mesh.position.set(r.x, 0, r.z);
    this.group.add(mesh);
  }

  // ------------------------------------------------------------------ trees

  _trees() {
    const rnd = seeded(20240923);
    const keepOut = [
      { x0: CASINO.MIN_X - 8, x1: CASINO.MAX_X + 8, z0: CASINO.MIN_Z - 8, z1: CASINO.MAX_Z + 30 },
      { x0: -66, x1: 66, z0: 38, z1: 228 },
      { x0: -66, x1: -44, z0: -110, z1: 70 },
      { x0: 44, x1: 66, z0: -110, z1: 70 },
      { x0: -270, x1: 270, z0: 206, z1: 228 },
      { x0: TRACK.cx - TRACK.half - TRACK.r - 16, x1: TRACK.cx + TRACK.half + TRACK.r + 16, z0: TRACK.cz - TRACK.r - 16, z1: TRACK.cz + TRACK.r + 24 },
      ...PLOTS.map((p) => ({ x0: p.x0 - 4, x1: p.x0 + PLOT_SIZE + 4, z0: p.z0 - 4, z1: p.z0 + PLOT_SIZE + 6 })),
    ];
    const blocked = (x, z) => keepOut.some((k) => x > k.x0 && x < k.x1 && z > k.z0 && z < k.z1);
    const spots = [];
    let guard = 0;
    while (spots.length < 520 && guard++ < 20000) {
      const x = BOUNDS.minX + rnd() * (BOUNDS.maxX - BOUNDS.minX);
      const z = BOUNDS.minZ + rnd() * (BOUNDS.maxZ - BOUNDS.minZ);
      if (blocked(x, z)) continue;
      // Denser towards the edge of the valley.
      const edge = Math.max(Math.abs(x) / BOUNDS.maxX, Math.abs(z) / BOUNDS.maxZ);
      if (rnd() > 0.25 + edge * 0.9) continue;
      spots.push([x, z, 0.8 + rnd() * 0.8, rnd()]);
    }
    // A thick wall of trees just outside the bounds hides the edge of the world.
    for (let a = 0; a < Math.PI * 2; a += 0.012) {
      const x = Math.cos(a) * 330;
      const z = Math.sin(a) * 320;
      spots.push([x, z, 1.4 + rnd() * 0.8, rnd()]);
    }

    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.32, 2.6, 6);
    const leafMat = phong(0xffffff, { map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide });
    const pineMat = phong(0xffffff, { map: pineTexture(), alphaTest: 0.45, side: THREE.DoubleSide });
    const trunks = new THREE.InstancedMesh(trunkGeo, phong(0xffffff, { map: plankTexture('#5a4030') }), spots.length);
    const pines = new THREE.InstancedMesh(crossCards(3.6, 7.2), pineMat, spots.length);
    const rounds = new THREE.InstancedMesh(crossCards(5.2, 4.6), leafMat, spots.length * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    let np = 0;
    let nr = 0;
    spots.forEach(([x, z, k, v], i) => {
      s.set(k, k, k);
      q.setFromAxisAngle(up, v * 6.28);
      m.compose(new THREE.Vector3(x, 1.3 * k, z), q, s);
      trunks.setMatrixAt(i, m);
      if (v < 0.5) {
        m.compose(new THREE.Vector3(x, 5.0 * k, z), q, s);
        pines.setMatrixAt(np, m);
        pines.setColorAt(np++, c.setHSL(0.3, 0.2, 0.75 + v * 0.3));
      } else {
        // Two crowns stacked, so broadleaf trees have some depth.
        m.compose(new THREE.Vector3(x, 4.2 * k, z), q, s);
        rounds.setMatrixAt(nr, m);
        rounds.setColorAt(nr++, c.setHSL(0.2 + (v - 0.5) * 0.1, 0.25, 0.75 + (v - 0.5) * 0.3));
        q.setFromAxisAngle(up, v * 6.28 + 0.8);
        m.compose(new THREE.Vector3(x + 0.4, 5.6 * k, z - 0.3), q, s.clone().multiplyScalar(0.75));
        rounds.setMatrixAt(nr, m);
        rounds.setColorAt(nr++, c.setHSL(0.22, 0.25, 0.85));
      }
      if (Math.abs(x) < BOUNDS.maxX + 5 && Math.abs(z) < BOUNDS.maxZ + 5) this.obstacles.push({ x, z, r: 0.45 * k });
    });
    pines.count = np;
    rounds.count = nr;
    this.group.add(trunks, pines, rounds);
    this._grass(blocked, rnd);
  }

  /** Tufts of long grass across the open ground: one draw call for thousands. */
  _grass(blocked, rnd) {
    const geo = crossCards(1.1, 0.7, 2);
    geo.translate(0, 0.33, 0);
    const mat = phong(0xffffff, { map: grassTuftTexture(), alphaTest: 0.4, side: THREE.DoubleSide });
    const N = 6000;
    const tufts = new THREE.InstancedMesh(geo, mat, N);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    let n = 0;
    let guard = 0;
    while (n < N && guard++ < 60000) {
      const x = BOUNDS.minX + rnd() * (BOUNDS.maxX - BOUNDS.minX);
      const z = BOUNDS.minZ + rnd() * (BOUNDS.maxZ - BOUNDS.minZ);
      if (blocked(x, z)) continue;
      const k = 0.7 + rnd() * 0.8;
      q.setFromAxisAngle(up, rnd() * 6.28);
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(k, k * (0.8 + rnd() * 0.5), k));
      tufts.setMatrixAt(n, m);
      tufts.setColorAt(n, c.setHSL(0.2 + rnd() * 0.06, 0.2, 0.7 + rnd() * 0.25));
      n++;
    }
    tufts.count = n;
    this.group.add(tufts);
  }

  // ------------------------------------------------------------- animation

  update(dt, night) {
    this.t += dt;
    for (const d of this.displays) d.rotation.y += dt * 0.35;
    for (const k of this.keepers) k.update(dt, false, false);
    const glow = 0.35 + night * 0.65;
    for (const mat of this.lampMats) mat.color.setRGB(glow, glow * 0.94, glow * 0.75);
    this.poolMat.opacity = night * 0.55;
    if (this.fountainWater) this.fountainWater.position.y = 0.72 + Math.sin(this.t * 2) * 0.02;
  }
}
