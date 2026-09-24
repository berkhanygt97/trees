import * as THREE from 'three';
import { pbr } from './gfx/materials.js';
import { plantTrees, WIND } from './gfx/trees.js';
import { GrassField } from './gfx/grass.js';
import { surface } from './gfx/surfaces.js';
import { noCast } from './shadows.js';
import {
  BOUNDS, PLAZA, ROADS, SHOPS, ORDERS_BOARD, PLOTS, PLOT_SIZE, GATE, TRACK, RAMPS, CASINO, COTTAGES, STRIP,
  HOODS, LOTS, shopCounter,
} from '/shared/map.js';
import { RING } from '/shared/roads.js';
import { BUILDINGS, LOTS_OPEN } from '/shared/downtown.js';
import { VEHICLES } from '/shared/catalog.js';
import {
  asphaltTexture, pavingTexture, dirtTexture, plankTexture, brickTexture,
  boardTexture, kerbTexture, checkerTexture, glowTexture, roofTileTexture,
} from './textures.js';
import { buildPalms } from './palms.js';
import { buildVehicle } from './vehicles.js';
import { buildGun } from './guns.js';
import { createAvatar } from './avatar.js';
import { batchStatic, live, dynamic } from './batcher.js';
import { Terrain } from './city/terrain.js';
import { Roads } from './city/roads.js';
import { terrainHeight } from '/shared/terrain.js';

const phong = (color, o = {}) => pbr(color, { shininess: 8, ...o });
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
    this.roadMats = [];
    this.t = 0;

    this._ground();
    this._roads();
    this._town();
    this._ordersBoard();
    this._streetlights();
    this._plots();
    this._track();
    this._trees();
    this._props();
    // Hundreds of static boxes become a few dozen draw calls.
    this.batch = batchStatic(this.group, { chunk: 128 });
  }

  // ------------------------------------------------- palms, poles, billboards

  _props() {
    // Palms: along the Sunset Strip (between the lots), round the plaza and
    // down the west side of main street.
    const spots = [];
    for (const x of [64, 90, 118, 154, 182, 196]) spots.push([x, STRIP.z0 - 3], [x, STRIP.z1 + 3]);
    for (const [x, z] of [[-58, 44], [58, 44], [-58, 66], [58, 66], [-30, 66], [30, 66]]) spots.push([x, z]);
    for (let z = 76; z <= 204; z += 16) spots.push([-9.4, z]);
    const palms = buildPalms(spots);
    this.group.add(palms.group);
    this.obstacles.push(...palms.obstacles);

    // Telegraph poles and sagging wires along the farm road.
    const wood = phong(0x5a3f28);
    const wireMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a });
    const poleXs = [];
    for (let x = -255; x <= 255; x += 26) if (Math.abs(x) > 12) poleXs.push(x);
    const top = [];
    for (const x of poleXs) {
      const z = 226;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 8.5, 6), wood);
      pole.position.set(x, 4.25, z);
      this.group.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.2), wood);
      arm.position.set(x, 7.9, z);
      this.group.add(arm);
      top.push([x, z]);
      this.obstacles.push({ x, z, r: 0.3 });
    }
    const pts = [];
    for (let i = 0; i < top.length - 1; i++) {
      for (const side of [-0.9, 0.9]) {
        const [x0, z0] = top[i];
        const [x1] = top[i + 1];
        if (x1 - x0 > 40) continue;
        // Each span sags in the middle.
        for (let k = 0; k < 8; k++) {
          const a = k / 8;
          const b = (k + 1) / 8;
          const sag = (t) => 7.9 - Math.sin(t * Math.PI) * 0.8;
          pts.push(x0 + (x1 - x0) * a, sag(a), z0 + side, x0 + (x1 - x0) * b, sag(b), z0 + side);
        }
      }
    }
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.group.add(new THREE.LineSegments(wireGeo, wireMat));

    // Billboards facing the roads: made-up local businesses.
    const boards = [
      [-135, 231, Math.PI, 'CLUCKY\'S FRIED CORN', 'it is always corn o\'clock', '#ffcf3a'],
      [135, 231, Math.PI, 'VALLEY FM 101.4', 'farm hits · all day · all night', '#35e0ff'],
      [205, 70, -Math.PI / 2, 'SUNSET STRIP', 'eat · drink · be seen  →', '#ff3d9a'],
      [-80, -60, Math.PI / 2, 'LOSE BIG AT CASINO ROYALE', 'the house always wins (legally)', '#f2c14e'],
    ];
    for (const [x, z, yaw, title, sub, color] of boards) {
      const g = new THREE.Group();
      for (const px of [-3.4, 3.4]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 0.3), phong(0x444a52));
        leg.position.set(px, 2.5, 0);
        g.add(leg);
      }
      const face = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.4), new THREE.MeshBasicMaterial({ map: boardTexture(title, color, sub) }));
      face.position.set(0, 6.5, 0.12);
      g.add(face);
      const backing = new THREE.Mesh(new THREE.BoxGeometry(9.3, 3.7, 0.2), phong(0x2b2e33));
      backing.position.set(0, 6.5, 0);
      g.add(backing);
      g.position.set(x, 0, z);
      g.rotation.y = yaw;
      this.group.add(g);
      this.obstacles.push({ x: x + Math.cos(yaw) * 3.4, z: z - Math.sin(yaw) * 3.4, r: 0.4 }, { x: x - Math.cos(yaw) * 3.4, z: z + Math.sin(yaw) * 3.4, r: 0.4 });
    }
  }

  // ---------------------------------------------------------------- ground

  _ground() {
    // The land itself: rolling hills between the built-up areas and a ring of
    // mountains round the edge (city/terrain.js), all from the shared height grid.
    this.terrain = new Terrain(this.scene);
  }

  _roads() {
    const paving = pavingTexture();
    const pz = flat(this.group, PLAZA.x0, PLAZA.x1, PLAZA.z0, PLAZA.z1, 0.012,
      phong(0xffffff, { map: tiled(paving, PLAZA.x1 - PLAZA.x0, PLAZA.z1 - PLAZA.z0, 4) }));
    pz.userData.ground = true;

    // Tarmac, kerbs and markings for every road (city/roads.js).
    this.roads = new Roads(this.group);

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
    // Clear, dark water that mirrors the sky, rippling in the breeze.
    const ripples = surface('water', '#1a4452').normalMap.clone();
    ripples.repeat.set(3, 3);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.9, 0.1, 32), live(pbr(0x1e4a58, {
      roughness: 0.04, normalMap: ripples, transparent: true, opacity: 0.9, envMapIntensity: 1.3,
    })));
    water.position.y = 0.72;
    f.add(water);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 2.6, 12), stone);
    column.position.y = 1.7;
    f.add(column);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.7, 24, 16), pbr(0xf2c14e, { metalness: 1, roughness: 0.3 }));
    top.position.y = 3.3;
    f.add(top);
    f.position.set(0, 0, 55);
    dynamic(water);
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
    // Shopkeepers stand behind their counters: posed once, then merged into
    // the shop (their name tags stay separate).
    keeper.update(0.016, false, false);
    g.add(keeper.group);

    // Hanging light inside.
    const bulbMat = live(basic(0xfff0c0));
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
      const map = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.5), basic(0xffffff, { map: boardTexture('THE VALLEY', '#c471e8', 'six neighbourhoods · one casino') }));
      map.position.set(s.open === 'east' ? s.x0 + 0.62 : s.x1 - 0.62, 3.2, cz);
      map.rotation.y = s.open === 'east' ? Math.PI / 2 : -Math.PI / 2;
      g.add(map);
      this.obstacles.push({ x: deepX, z: cz, r: 1.3 });
    } else if (s.id === 'cardealer' || s.id === 'machinery') {
      const models = VEHICLES.filter((v) => (s.id === 'cardealer' ? v.kind === 'car' : v.kind === 'machine'));
      // Three cars on plinths out front, picked by name so a new model does not reshuffle them.
      const showroom = ['pickup', 'ttop', 'limo'];
      const shown = s.id === 'cardealer' ? showroom.map((id) => models.find((m) => m.id === id)).filter(Boolean) : models;
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
        // Show cars turn on their plinths: merged inside themselves, so a whole
        // car is a handful of draw calls, and left out of the town's batch.
        batchStatic(v.group, { chunk: 0 });
        if (m.id !== 'combine' && m.id !== 'tractor') this.displays.push(dynamic(v.group));
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
    // The ring of avenues round downtown.
    for (const r of RING) {
      const alongZ = r.z1 - r.z0 > r.x1 - r.x0;
      if (alongZ) for (let z = r.z0 + 20; z < r.z1; z += 50) spots.push([r.x0 - 1.5, z], [r.x1 + 1.5, z + 25]);
      else for (let x = r.x0 + 20; x < r.x1; x += 50) spots.push([x, r.z0 - 1.5], [x + 25, r.z1 + 1.5]);
    }

    this.lampSpots = spots;
    const poleMat = phong(0x2b2b30, { shininess: 40 });
    const pole = new THREE.CylinderGeometry(0.1, 0.14, 5.2, 8);
    const poles = new THREE.InstancedMesh(pole, poleMat, spots.length);
    const headMat = live(basic(0x6a6a6a));
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
      { x0: TRACK.cx - TRACK.half - TRACK.r - 16, x1: TRACK.cx + TRACK.half + TRACK.r + 16, z0: TRACK.cz - TRACK.r - 16, z1: TRACK.cz + TRACK.r + 24 },
      ...PLOTS.map((p) => ({ x0: p.x0 - 4, x1: p.x0 + PLOT_SIZE + 4, z0: p.z0 - 4, z1: p.z0 + PLOT_SIZE + 6 })),
      // Every road with its verges, every restaurant lot, and the cottages.
      ...ROADS.map((r) => ({ x0: r.x0 - 5, x1: r.x1 + 5, z0: r.z0 - 5, z1: r.z1 + 5 })),
      ...LOTS.map((l) => ({ x0: l.x0 - 3, x1: l.x1 + 3, z0: l.z0 - 3, z1: l.z1 + 3 })),
      ...COTTAGES.map((c) => ({ x0: c.x - 9, x1: c.x + 9, z0: c.z - 12, z1: c.z + 8 })),
      // Downtown's newer buildings and car parks.
      ...BUILDINGS.map((b) => ({ x0: b.x0 - 4, x1: b.x1 + 4, z0: b.z0 - 4, z1: b.z1 + 8 })),
      ...LOTS_OPEN.map((o) => ({ x0: o.x0 - 2, x1: o.x1 + 2, z0: o.z0 - 2, z1: o.z1 + 2 })),
      // The built-up half of every neighbourhood (the woods behind the farms stay wild).
      ...HOODS.map((h) => ({ x0: h.x0 - 2, x1: h.x1 + 2, z0: h.z0 + 44, z1: h.z1 + 2 })),
    ];
    const blocked = (x, z) => keepOut.some((k) => x > k.x0 && x < k.x1 && z > k.z0 && z < k.z1);
    const spots = [];
    let guard = 0;
    while (spots.length < 1500 && guard++ < 40000) {
      const x = BOUNDS.minX + rnd() * (BOUNDS.maxX - BOUNDS.minX);
      const z = BOUNDS.minZ + rnd() * (BOUNDS.maxZ - BOUNDS.minZ);
      if (blocked(x, z)) continue;
      // Denser towards the edge of the valley.
      const toEdge = Math.max(Math.abs(x) / BOUNDS.maxX, Math.abs(z) / BOUNDS.maxZ);
      if (rnd() > 0.25 + toEdge * 0.9) continue;
      spots.push([x, z, 0.8 + rnd() * 0.8, rnd()]);
    }
    // A thick wall of trees just outside the bounds hides the edge of the world.
    // Beyond the edge of the valley the mountains rise; a scatter of pines climbs them.
    const edge = (x, z) => spots.push([x + (rnd() - 0.5) * 24, z + (rnd() - 0.5) * 24, 1.3 + rnd() * 0.9, rnd() * 0.5]);
    for (let x = BOUNDS.minX - 40; x <= BOUNDS.maxX + 40; x += 11) { edge(x, BOUNDS.minZ - 20 - rnd() * 60); edge(x, BOUNDS.maxZ + 20 + rnd() * 60); }
    for (let z = BOUNDS.minZ - 40; z <= BOUNDS.maxZ + 40; z += 11) { edge(BOUNDS.minX - 20 - rnd() * 60, z); edge(BOUNDS.maxX + 20 + rnd() * 60, z); }

    // Pines on the valley edge and up the mountains, cypresses and broadleaf
    // trees in between (gfx/trees.js builds and instances them).
    // Shrubs on the verges of the country roads, in clumps, and scattered
    // under the trees.
    const shrubs = [];
    for (const r of ROADS) {
      const along = r.x1 - r.x0 > r.z1 - r.z0;
      const len = along ? r.x1 - r.x0 : r.z1 - r.z0;
      for (let d = 0; d < len; d += 7 + rnd() * 9) {
        if (rnd() < 0.45) continue;
        for (const side of [-1, 1]) {
          if (rnd() < 0.4) continue;
          const off = 6.5 + rnd() * 3;
          const x = along ? r.x0 + d : (side < 0 ? r.x0 - off : r.x1 + off);
          const z = along ? (side < 0 ? r.z0 - off : r.z1 + off) : r.z0 + d;
          if (Math.abs(x) > BOUNDS.maxX || Math.abs(z) > BOUNDS.maxZ || blocked(x, z)) continue;
          shrubs.push({ x, y: terrainHeight(x, z), z, species: 'bush', scale: 0.8 + rnd() * 0.7, turn: rnd() * 40, tint: 0.8 + rnd() * 0.35 });
        }
      }
    }
    for (const [x, z] of spots.slice(0, 900)) {
      if (rnd() < 0.6) continue;
      const bx = x + (rnd() - 0.5) * 8;
      const bz = z + (rnd() - 0.5) * 8;
      if (!blocked(bx, bz)) shrubs.push({ x: bx, y: terrainHeight(bx, bz), z: bz, species: 'bush', scale: 0.7 + rnd() * 0.6, turn: rnd() * 40, tint: 0.75 + rnd() * 0.3 });
    }
    const trees = spots.map(([x, z, k, v]) => {
      const species = v < 0.42 ? 'pine' : v < 0.55 ? 'cypress' : 'oak';
      if (Math.abs(x) < BOUNDS.maxX + 5 && Math.abs(z) < BOUNDS.maxZ + 5) this.obstacles.push({ x, z, r: 0.45 * k });
      return { x, y: terrainHeight(x, z), z, species, scale: k * (species === 'oak' ? 0.95 : 0.85), turn: v * 40, tint: 0.82 + (v * 7 % 1) * 0.3 };
    });
    this.trees = plantTrees([...trees, ...shrubs]);
    this.group.add(this.trees);
    this._grass(blocked);
  }

  /**
   * Grass blades round the camera (gfx/grass.js), growing wherever the
   * ground is grassy and nothing is built: not on roads, yards or fields.
   */
  _grass(blocked) {
    const c = new THREE.Color();
    const w = [0, 0, 0, 0];
    const t = this.terrain;
    const sample = (x, z) => {
      const height = terrainHeight(x, z);
      const up = 2 / Math.hypot(terrainHeight(x - 1, z) - terrainHeight(x + 1, z), 2, terrainHeight(x, z - 1) - terrainHeight(x, z + 1));
      t._colour(x, height, z, up, c, w);
      const grow = blocked(x, z) ? 0 : Math.max(0, w[0] - 0.15) / 0.85;
      return { height, r: c.r, g: c.g, b: c.b, grow };
    };
    this.grassField = new GrassField(BOUNDS, sample, { cell: 4, max: 15000 });
    noCast(this.grassField.mesh.material);
    this.group.add(this.grassField.mesh);
  }

  // ------------------------------------------------------------- animation

  update(dt, night, wet = 0) {
    this.t += dt;
    // Trees sway, harder in the rain.
    WIND.uTime.value = this.t;
    WIND.uWind.value = 1 + wet * 1.8;
    // Rain makes the tarmac dark and shiny, and the lights glint off it.
    if (Math.abs((this._wet || 0) - wet) > 0.01) {
      this._wet = wet;
      this.roads.setWet(wet);
    }
    for (const d of this.displays) d.rotation.y += dt * 0.35;
    for (const k of this.keepers) k.update(dt, false, false);
    const glow = 0.35 + night * 0.65;
    for (const mat of this.lampMats) mat.color.setRGB(glow, glow * 0.94, glow * 0.75);
    this.poolMat.opacity = night * 0.55;
    if (this.fountainWater) {
      this.fountainWater.position.y = 0.72 + Math.sin(this.t * 2) * 0.02;
      const n = this.fountainWater.material.normalMap;
      n.offset.set(this.t * 0.02, this.t * 0.013);
    }
  }
}
