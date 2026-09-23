import * as THREE from 'three';
import { CROPS, CROP_BY_ID, cropProgress, isWatered } from '/shared/catalog.js';
import { PLOTS, PLOT_SIZE, GATE, TILE, tileCenter, tileIndex, padWorld } from '/shared/map.js';
import { soilTexture, plankTexture, brickTexture, boardTexture, roofTileTexture, metalTexture, plasterTexture } from './textures.js';

// Draws every farm in the valley: soil, crops, buildings and animals.
// Crops are one InstancedMesh per crop (plus one for its fruit), so a whole
// valley of fields is a couple of dozen draw calls.

const phong = (color, o = {}) => new THREE.MeshPhongMaterial({ color, shininess: 8, specular: 0x111111, ...o });
const basic = (color, o = {}) => new THREE.MeshBasicMaterial({ color, ...o });
const CAP = PLOTS.length * 400;

// ------------------------------------------------------------ geometry kit

/** Merges primitives into one geometry with baked vertex colours. */
function merge(parts) {
  const pos = [];
  const nor = [];
  const col = [];
  const c = new THREE.Color();
  for (const { geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = [1, 1, 1] } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(...s),
    );
    g.applyMatrix4(m);
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    c.set(color);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

// Deterministic jitter so every client draws the same plants.
const jit = (i, k) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v) - 0.5;
};

const W = '#ffffff';   // tinted per instance: green while growing, crop colour when ripe
const LEAF = '#4f9a3a';

/** [foliage parts, fruit parts] for each crop, sized for a 2 m tile. */
function cropParts(id) {
  const stalk = new THREE.CylinderGeometry(0.03, 0.04, 1, 5);
  const leaf = new THREE.ConeGeometry(0.12, 0.6, 4);
  const blob = new THREE.IcosahedronGeometry(0.3, 0);
  const ball = new THREE.SphereGeometry(0.12, 7, 5);
  const grid = (n, fn) => {
    const out = [];
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const x = (a + 0.5) / n * 1.6 - 0.8 + jit(a, b) * 0.15;
      const z = (b + 0.5) / n * 1.6 - 0.8 + jit(b, a) * 0.15;
      out.push(...fn(x, z, a * n + b));
    }
    return out;
  };
  switch (id) {
    case 'wheat': return [
      grid(4, (x, z, i) => [
        { geo: stalk, color: W, x, y: 0.5, z, rz: jit(i, 1) * 0.2, s: [1, 1.05, 1] },
        { geo: new THREE.CylinderGeometry(0.06, 0.04, 0.26, 5), color: W, x, y: 1.1, z },
      ]),
      [],
    ];
    case 'carrot': return [
      grid(3, (x, z, i) => [0, 1, 2].map((k) => ({ geo: leaf, color: LEAF, x: x + jit(i, k) * 0.1, y: 0.3, z, rz: (k - 1) * 0.5, s: [0.8, 1, 0.8] }))),
      grid(3, (x, z) => [{ geo: new THREE.ConeGeometry(0.1, 0.35, 6), color: '#f08a2c', x, y: 0.05, z, rx: Math.PI }]),
    ];
    case 'potato': return [
      grid(2, (x, z, i) => [{ geo: blob, color: LEAF, x, y: 0.28, z, s: [1.3, 0.9, 1.3], ry: jit(i, 3) }]),
      grid(2, (x, z) => [0, 1].map((k) => ({ geo: ball, color: '#b08850', x: x + (k - 0.5) * 0.4, y: 0.06, z: z + 0.35, s: [1.3, 1, 1] }))),
    ];
    case 'corn': return [
      grid(3, (x, z, i) => [
        { geo: new THREE.CylinderGeometry(0.05, 0.07, 1, 6), color: W, x, y: 1.0, z, s: [1, 2, 1] },
        { geo: leaf, color: W, x: x + 0.15, y: 1.0, z, rz: -0.9, s: [0.7, 1.2, 0.3] },
        { geo: leaf, color: W, x: x - 0.15, y: 1.4, z, rz: 0.9, ry: jit(i, 2), s: [0.7, 1.2, 0.3] },
      ]),
      grid(3, (x, z) => [{ geo: new THREE.CylinderGeometry(0.08, 0.06, 0.4, 7), color: '#f5d63d', x: x + 0.12, y: 1.2, z, rz: -0.35 }]),
    ];
    case 'tomato': return [
      grid(2, (x, z) => [
        { geo: new THREE.CylinderGeometry(0.03, 0.03, 1.3, 5), color: '#8a6a3a', x, y: 0.65, z },
        { geo: blob, color: LEAF, x, y: 0.7, z, s: [1, 1.5, 1] },
      ]),
      grid(2, (x, z, i) => [0, 1, 2, 3].map((k) => ({ geo: ball, color: '#e8412c', x: x + Math.cos(k * 1.7) * 0.28, y: 0.45 + k * 0.15, z: z + Math.sin(k * 1.7) * 0.28 + jit(i, k) * 0.05, s: [1.1, 1.1, 1.1] }))),
    ];
    case 'pumpkin': return [
      [0, 1, 2, 3, 4].map((k) => ({ geo: blob, color: LEAF, x: Math.cos(k * 1.3) * 0.6, y: 0.15, z: Math.sin(k * 1.3) * 0.6, s: [0.8, 0.4, 0.8] })),
      [
        { geo: new THREE.SphereGeometry(0.5, 12, 8), color: '#f07a1a', x: 0, y: 0.35, z: 0, s: [1.2, 0.8, 1.2] },
        { geo: new THREE.CylinderGeometry(0.05, 0.06, 0.2, 5), color: '#5a7a2a', x: 0, y: 0.78, z: 0 },
      ],
    ];
    case 'strawberry': return [
      grid(3, (x, z, i) => [{ geo: blob, color: LEAF, x, y: 0.14, z, s: [0.7, 0.45, 0.7], ry: jit(i, 5) }]),
      grid(3, (x, z) => [0, 1].map((k) => ({ geo: new THREE.ConeGeometry(0.08, 0.16, 6), color: '#e8283c', x: x + (k - 0.5) * 0.25, y: 0.08, z: z + 0.2, rx: Math.PI }))),
    ];
    default: return [[], []];
  }
}

// --------------------------------------------------------------- buildings

function box(parent, w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** Four-sided roof over a w×d footprint. */
function roof(parent, w, d, h, y, mat) {
  const r = new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4), mat);
  r.rotation.y = Math.PI / 4;
  r.scale.set(w * 1.08, h, d * 1.08);
  r.position.y = y + h / 2;
  parent.add(r);
  return r;
}

/** Gable roof: a triangular prism running along x. */
function gable(parent, w, d, h, y, mat) {
  const s = new THREE.Shape();
  s.moveTo(-d / 2 - 0.4, 0);
  s.lineTo(d / 2 + 0.4, 0);
  s.lineTo(0, h);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: w + 0.6, bevelEnabled: false });
  geo.translate(0, 0, -(w + 0.6) / 2);
  const m = new THREE.Mesh(geo, mat);
  m.rotation.y = Math.PI / 2;
  m.position.y = y;
  parent.add(m);
  return m;
}

function door(parent, x, z, w = 1.2, h = 2.2, color = 0x4a2a17) {
  box(parent, w, h, 0.1, x, h / 2, z, phong(color));
}

function windows(parent, xs, y, z, lit) {
  for (const x of xs) {
    const mat = basic(0x2a3448);
    lit.push(mat);
    box(parent, 1.1, 1.0, 0.08, x, y, z, mat);
  }
}

// Extruded roofs have UVs in metres; scale the texture to suit.
function roofMat(tex, per = 2.5) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(1 / per, 1 / per);
  return phong(0xffffff, { map: t });
}

// Houses face south (+z). Their front sits on the edge of the house pad so the
// doorstep, and the station, is in the same place for every tier.
const HOUSE_SIZE = [[4.5, 4], [8, 7], [11, 9], [15, 13]];

function buildHouse(tier, color, lit) {
  const g = new THREE.Group();
  const [w, d] = HOUSE_SIZE[tier];
  const front = d / 2;
  if (tier === 0) {
    const tent = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 2.6, 3, 4, 1, false, Math.PI / 4), phong(color, { flatShading: true }));
    tent.scale.set(1.1, 1, 1);
    tent.position.y = 1.5;
    g.add(tent);
    box(g, 1.1, 1.6, 0.05, 0, 0.8, front - 0.2, phong(0x1d1622));
    // Campfire, the tent's one luxury.
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 6), basic(0xff8a2a));
    fire.position.set(2.6, 0.4, front + 1.5);
    g.add(fire);
    g.userData.fire = fire;
  } else if (tier === 1) {
    const logs = phong(0xffffff, { map: plankTexture('#8a5a30') });
    box(g, w, 3.2, d, 0, 1.6, 0, logs);
    gable(g, w, d, 2.2, 3.2, roofMat(roofTileTexture('#5a3a2a')));
    door(g, 0, front + 0.06);
    windows(g, [-2.4, 2.4], 1.7, front + 0.06, lit);
    box(g, 0.7, 2, 0.7, w / 2 - 1, 4.6, 0, phong(0x7a6a5a));
  } else if (tier === 2) {
    const walls = phong(0xffffff, { map: plasterTexture('#efe4cc') });
    box(g, w, 6, d, 0, 3, 0, walls);
    gable(g, w, d, 3, 6, roofMat(roofTileTexture('#8a2a2a')));
    door(g, 0, front + 0.06, 1.4, 2.4, 0x2a4a7a);
    windows(g, [-3.5, 3.5], 1.8, front + 0.06, lit);
    windows(g, [-3.5, 0, 3.5], 4.4, front + 0.06, lit);
    // Porch.
    box(g, w, 0.25, 2.4, 0, 0.12, front + 1.2, phong(0xffffff, { map: plankTexture('#9b6b3d') }));
    box(g, w, 0.18, 2.6, 0, 3.1, front + 1.2, phong(0x8a2a2a));
    for (const x of [-w / 2 + 0.3, -1.5, 1.5, w / 2 - 0.3]) box(g, 0.2, 3, 0.2, x, 1.6, front + 2.3, walls);
  } else {
    const marble = phong(0xf5f1ea, { shininess: 40 });
    box(g, w, 8, d, 0, 4, 0, marble);
    box(g, w * 0.5, 3, d * 0.7, 0, 9.5, -1, marble);
    roof(g, w + 0.6, d + 0.6, 2.5, 8, phong(0x3a4a6a));
    roof(g, w * 0.52, d * 0.72, 1.8, 11, phong(0x3a4a6a));
    door(g, 0, front + 0.06, 2, 3.2, 0x3a2a17);
    windows(g, [-5.5, -3, 3, 5.5], 2.2, front + 0.06, lit);
    windows(g, [-5.5, -3, 0, 3, 5.5], 5.8, front + 0.06, lit);
    // Columns and steps, because a mansion needs columns.
    for (const x of [-3.2, -1.2, 1.2, 3.2]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 7.6, 12), marble);
      c.position.set(x, 3.8, front + 2);
      g.add(c);
    }
    box(g, 8.4, 0.5, 3.2, 0, 7.7, front + 1.6, marble);
    for (let i = 0; i < 3; i++) box(g, 8 - i, 0.25, 1, 0, 0.12 + i * 0.25, front + 3.9 - i * 0.5, marble);
    box(g, 1.4, 0.8, 0.1, 0, 8.5, front + 3.25, phong(0xf2c14e, { shininess: 80 }));
  }
  g.position.z = -front;   // origin at the front edge
  const wrap = new THREE.Group();
  wrap.add(g);
  return { group: wrap, fire: g.userData.fire, w, d };
}

function buildCoop(lit) {
  const g = new THREE.Group();
  box(g, 5, 2.4, 4, -2, 1.2, 0, phong(0xb83a2c));
  gable(g, 5, 4, 1.4, 2.4, phong(0x6a3a2a));
  door(g, -2, 2.06, 0.8, 1.2, 0xf0e6d2);
  windows(g, [-3.5], 1.5, 2.06, lit);
  // Chicken run.
  const wire = phong(0xdadada, { transparent: true, opacity: 0.45 });
  box(g, 5, 1.2, 0.05, 2.5, 0.6, -2, wire);
  box(g, 5, 1.2, 0.05, 2.5, 0.6, 2, wire);
  box(g, 0.05, 1.2, 4, 5, 0.6, 0, wire);
  return g;
}

function buildBarn() {
  const g = new THREE.Group();
  const red = phong(0xa8322a);
  const white = phong(0xf0e6d2);
  box(g, 12, 5, 9, 0, 2.5, 0, red);
  gable(g, 12, 9, 3.6, 5, roofMat(metalTexture('#5a5f66'), 3));
  box(g, 3.4, 3.8, 0.1, 0, 1.9, 4.56, white);
  box(g, 3.0, 3.4, 0.12, 0, 1.8, 4.6, red);
  // The white X on the doors.
  for (const r of [0.85, -0.85]) {
    const bar = box(g, 0.2, 4.2, 0.14, 0, 1.8, 4.66, white);
    bar.rotation.z = r;
  }
  box(g, 1.4, 1.4, 0.1, 0, 5.8, 4.56, white);
  return g;
}

function buildMill() {
  const g = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.4, 10, 8), phong(0xe8dcc4, { flatShading: true }));
  tower.position.y = 5;
  g.add(tower);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2.6, 8), phong(0x5a3a2a, { flatShading: true }));
  cap.position.y = 11.3;
  g.add(cap);
  door(g, 0, 3.2, 1.2, 2.2);
  const hub = new THREE.Group();
  hub.position.set(0, 9.6, 2.6);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i / 4) * Math.PI * 2;
    box(arm, 0.3, 7, 0.15, 0, 3.5, 0, phong(0x6b4a2e));
    box(arm, 1.4, 5, 0.06, 0.75, 4, 0, phong(0xf5f1ea));
    hub.add(arm);
  }
  g.add(hub);
  g.userData.hub = hub;
  return g;
}

function buildDairy(lit) {
  const g = new THREE.Group();
  box(g, 9, 4, 7, 0, 2, 0, phong(0xf5f5f5));
  gable(g, 9, 7, 2, 4, phong(0x2f6fb0));
  door(g, 0, 3.56, 1.6, 2.6, 0x2f6fb0);
  windows(g, [-3, 3], 2, 3.56, lit);
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.2, 10), phong(0xdadada, { shininess: 80 }));
  can.position.set(3.6, 0.6, 4.4);
  g.add(can);
  return g;
}

function buildBakery(lit) {
  const g = new THREE.Group();
  box(g, 9, 4.2, 7, 0, 2.1, 0, phong(0xffffff, { map: brickTexture('#b8663a') }));
  gable(g, 9, 7, 2, 4.2, roofMat(roofTileTexture('#6a3a2a')));
  box(g, 1, 3, 1, 3, 6, -1, phong(0x7a6a5a));
  door(g, 0, 3.56, 1.4, 2.4, 0xf2c14e);
  windows(g, [-2.8, 2.8], 2, 3.56, lit);
  // A striped awning.
  const aw = box(g, 8, 0.12, 1.4, 0, 3.2, 4.2, phong(0xe8412c));
  aw.rotation.x = 0.25;
  return g;
}

function buildBin() {
  const g = new THREE.Group();
  const wood = phong(0xffffff, { map: plankTexture('#9b6b3d') });
  box(g, 2.4, 1.1, 1.6, 0, 0.55, 0, wood);
  const lid = box(g, 2.5, 0.12, 1.7, 0, 1.16, 0, phong(0x6b4a2e));
  lid.rotation.x = -0.15;
  return g;
}

function chicken() {
  const g = new THREE.Group();
  box(g, 0.34, 0.3, 0.44, 0, 0.3, 0, phong(0xf5f5f5));
  box(g, 0.22, 0.24, 0.2, 0, 0.52, -0.24, phong(0xf5f5f5));
  box(g, 0.08, 0.06, 0.1, 0, 0.5, -0.38, phong(0xf2a13a));
  box(g, 0.06, 0.1, 0.12, 0, 0.68, -0.24, phong(0xd9302a));
  return g;
}

function cow() {
  const g = new THREE.Group();
  const white = phong(0xf5f5f5);
  const black = phong(0x1d1d1d);
  box(g, 1.1, 0.9, 2.0, 0, 1.2, 0, white);
  box(g, 1.12, 0.5, 0.6, 0, 1.3, 0.3, black);
  box(g, 0.6, 0.6, 0.7, 0, 1.5, -1.2, white);
  box(g, 0.5, 0.3, 0.2, 0, 1.3, -1.6, phong(0xf2a0a0));
  for (const x of [-0.35, 0.35]) for (const z of [-0.7, 0.7]) box(g, 0.2, 0.8, 0.2, x, 0.4, z, black);
  return g;
}

// ------------------------------------------------------------------ view

export class FarmView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.plots = new Map();       // index -> public plot state
    this.views = new Map();       // index -> { group, parts }
    this.boxes = [];              // colliders for built buildings
    this.windowMats = [];
    this.animals = [];
    this.t = 0;
    this.dirty = true;
    this.lastCrops = 0;

    // Soil: one instance per worked tile.
    this.soil = new THREE.InstancedMesh(new THREE.PlaneGeometry(TILE * 0.96, TILE * 0.96).rotateX(-Math.PI / 2),
      phong(0xffffff, { map: soilTexture() }), CAP);
    this.soil.count = 0;
    this.soil.frustumCulled = false;
    this.group.add(this.soil);

    this.crops = {};
    for (const crop of CROPS) {
      const [fol, fruit] = cropParts(crop.id);
      const mk = (parts) => {
        if (!parts.length) return null;
        const mesh = new THREE.InstancedMesh(merge(parts), phong(0xffffff, { vertexColors: true, flatShading: true }), CAP);
        mesh.count = 0;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        return mesh;
      };
      this.crops[crop.id] = { foliage: mk(fol), fruit: mk(fruit) };
    }

    // Aim marker for the tile you are about to work.
    const ring = new THREE.Group();
    const barMat = basic(0xffffff, { transparent: true, opacity: 0.9, depthTest: false });
    for (const [x, z, w, d] of [[0, -1, 2, 0.08], [0, 1, 2, 0.08], [-1, 0, 0.08, 2], [1, 0, 0.08, 2]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), barMat);
      b.position.set(x, 0.06, z);
      ring.add(b);
    }
    ring.renderOrder = 5;
    ring.visible = false;
    this.marker = ring;
    this.markerMat = barMat;
    this.group.add(ring);
  }

  // ------------------------------------------------------------------ data

  setPlots(list) {
    for (const p of list) if (p) this.setPlot(p);
  }

  setPlot(p) {
    if (!p) return;
    this.plots.set(p.index, p);
    this._rebuild(p.index);
    this.dirty = true;
  }

  applyTiles({ plot, t }) {
    const p = this.plots.get(plot);
    if (!p || !p.tiles) return;
    for (const [idx, tile] of t) p.tiles[idx] = tile;
    this.dirty = true;
  }

  tile(plotIndex, i, j) {
    const p = this.plots.get(plotIndex);
    if (!p || !p.tiles) return undefined;
    return p.tiles[tileIndex(i, j)];
  }

  // ------------------------------------------------------------- buildings

  _rebuild(index) {
    const old = this.views.get(index);
    if (old) {
      this.group.remove(old.group);
      old.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      this.animals = this.animals.filter((a) => a.plot !== index);
    }
    const plot = PLOTS[index];
    const p = this.plots.get(index);
    const g = new THREE.Group();
    const view = { group: g, hub: null, fire: null, boxes: [] };
    this.group.add(g);
    this.views.set(index, view);

    // Gate sign: whose farm this is, or that it is up for grabs.
    const owner = p && p.owner;
    // An arch over the gate, high enough to drive a combine under.
    const sign = new THREE.Group();
    const post = phong(0x6b4a2e);
    const half = (GATE[1] - GATE[0]) / 2;
    box(sign, 0.35, 6.2, 0.35, -half - 0.3, 3.1, 0, post);
    box(sign, 0.35, 6.2, 0.35, half + 0.3, 3.1, 0, post);
    box(sign, half * 2 + 1.2, 0.3, 0.3, 0, 6.1, 0, post);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2),
      basic(0xffffff, { map: boardTexture(owner ? `${owner.toUpperCase()}'S FARM` : 'FARM FOR SALE', owner ? p.color : '#8d8378', owner ? '' : 'join with a new name to claim it') }));
    face.position.set(0, 7.3, 0.12);
    sign.add(face);
    const back = face.clone();
    back.rotation.y = Math.PI;
    back.position.z = -0.12;
    sign.add(back);
    sign.position.set(plot.x0 + (GATE[0] + GATE[1]) / 2, 0, plot.z0 + PLOT_SIZE);
    g.add(sign);

    if (!owner) { this._rebuildBoxes(); return; }

    // Field boundary stakes, so you can see how big your field is.
    const size = p.size;
    const [ax] = tileCenter(plot, 0, 0);
    const [, az] = tileCenter(plot, 0, size - 1);
    const minX = ax - TILE / 2;
    const maxX = minX + size * TILE;
    const maxZ = plot.z0 + 66;
    const minZ = az - TILE / 2;
    const rope = phong(0xd8c39a);
    const stake = phong(0x6b4a2e);
    for (const [x, z, w, d] of [
      [(minX + maxX) / 2, minZ, maxX - minX, 0.06], [(minX + maxX) / 2, maxZ, maxX - minX, 0.06],
      [minX, (minZ + maxZ) / 2, 0.06, maxZ - minZ], [maxX, (minZ + maxZ) / 2, 0.06, maxZ - minZ],
    ]) box(g, w, 0.06, d, x, 0.45, z, rope);
    for (const [x, z] of [[minX, minZ], [maxX, minZ], [minX, maxZ], [maxX, maxZ]]) box(g, 0.14, 0.9, 0.14, x, 0.45, z, stake);

    const place = (obj, pad, faceFront = true) => {
      const w = padWorld(plot, pad);
      obj.position.set(w.x, 0, faceFront ? w.z + w.d / 2 : w.z);
      g.add(obj);
      return w;
    };

    const house = buildHouse(p.house, p.color, this.windowMats);
    place(house.group, 'house');
    view.fire = house.fire;
    const hp = padWorld(plot, 'house');
    view.boxes.push({ x0: hp.x - house.w / 2, x1: hp.x + house.w / 2, z0: hp.z + hp.d / 2 - house.d, z1: hp.z + hp.d / 2 });

    const b = p.buildings || {};
    const addBox = (pad, shrink = 0.3) => {
      const w = padWorld(plot, pad);
      view.boxes.push({ x0: w.x - w.w / 2 + shrink, x1: w.x + w.w / 2 - shrink, z0: w.z - w.d / 2 + shrink, z1: w.z + w.d / 2 - shrink });
    };
    if (b.coop != null) {
      const coop = buildCoop(this.windowMats);
      const w = place(coop, 'coop', false);
      addBox('coop');
      for (let i = 0; i < b.coop; i++) this._addAnimal(index, chicken(), w.x + 2.5, w.z, 2, 1.6);
    }
    if (b.barn != null) {
      place(buildBarn(), 'barn', false);
      addBox('barn');
      const w = padWorld(plot, 'barn');
      for (let i = 0; i < b.barn; i++) this._addAnimal(index, cow(), w.x, w.z + w.d / 2 + 2.5, 5, 1.2);
    }
    if (b.mill) { const m = buildMill(); place(m, 'mill', false); view.hub = m.userData.hub; addBox('mill', 1); }
    if (b.dairy) { place(buildDairy(this.windowMats), 'dairy', false); addBox('dairy'); }
    if (b.bakery) { place(buildBakery(this.windowMats), 'bakery', false); addBox('bakery'); }
    const bin = buildBin();
    place(bin, 'bin', false);
    addBox('bin', 0);

    this._rebuildBoxes();
  }

  _addAnimal(plot, mesh, cx, cz, rx, rz) {
    mesh.position.set(cx + (Math.random() - 0.5) * rx, 0, cz + (Math.random() - 0.5) * rz);
    this.views.get(plot).group.add(mesh);
    this.animals.push({ plot, mesh, cx, cz, rx, rz, tx: mesh.position.x, tz: mesh.position.z, wait: Math.random() * 3 });
  }

  _rebuildBoxes() {
    this.boxes.length = 0;
    for (const v of this.views.values()) this.boxes.push(...v.boxes);
  }

  // ------------------------------------------------------------------ aim

  showMarker(x, z, ok) {
    this.marker.visible = true;
    this.marker.position.set(x, 0, z);
    this.markerMat.color.set(ok ? 0xffffff : 0xff7a6a);
  }

  hideMarker() { this.marker.visible = false; }

  // --------------------------------------------------------------- update

  update(dt, worldTime, night) {
    this.t += dt;
    for (const v of this.views.values()) {
      if (v.hub) v.hub.rotation.z -= dt * 0.8;
      if (v.fire) v.fire.scale.y = 0.8 + Math.sin(this.t * 13) * 0.15 + Math.sin(this.t * 7.3) * 0.1;
    }
    for (const a of this.animals) {
      a.wait -= dt;
      const dx = a.tx - a.mesh.position.x;
      const dz = a.tz - a.mesh.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const sp = Math.min(d, dt * 0.9);
        a.mesh.position.x += (dx / d) * sp;
        a.mesh.position.z += (dz / d) * sp;
        a.mesh.rotation.y = Math.atan2(-dx, -dz);
      } else if (a.wait <= 0) {
        a.tx = a.cx + (Math.random() - 0.5) * a.rx;
        a.tz = a.cz + (Math.random() - 0.5) * a.rz;
        a.wait = 1 + Math.random() * 4;
      }
    }
    const glow = night > 0.3;
    for (const m of this.windowMats) m.color.set(glow ? 0xffd88a : 0x2a3448);

    // Crops only need redrawing when something changed, or a few times a
    // second while they grow.
    if (this.dirty || this.t - this.lastCrops > 0.5) {
      this.lastCrops = this.t;
      this.dirty = false;
      this._drawCrops(worldTime);
    }
  }

  _drawCrops(now) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const v = new THREE.Vector3();
    const green = new THREE.Color(0x5aa844);
    const col = new THREE.Color();
    const soilPlowed = new THREE.Color(0x8a6440);
    const soilWet = new THREE.Color(0x4f3622);
    const counts = {};
    for (const c of CROPS) counts[c.id] = { f: 0, r: 0 };
    let ns = 0;

    for (const [index, p] of this.plots) {
      if (!p.tiles || !p.owner) continue;
      const plot = PLOTS[index];
      for (let j = 0; j < p.size; j++) {
        for (let i = 0; i < p.size; i++) {
          const t = p.tiles[tileIndex(i, j)];
          if (t === null || t === undefined) continue;
          const [x, z] = tileCenter(plot, i, j);
          m.makeTranslation(x, 0.015, z);
          this.soil.setMatrixAt(ns, m);
          this.soil.setColorAt(ns, t !== 0 && isWatered(t, now) ? soilWet : soilPlowed);
          ns++;
          if (t === 0) continue;
          const crop = CROP_BY_ID[t.c];
          if (!crop) continue;
          const prog = cropProgress(t, now);
          const k = 0.18 + 0.82 * Math.min(1, prog / 0.9);
          const meshes = this.crops[crop.id];
          const idx = i * 31 + j * 17 + index * 7;
          q.setFromAxisAngle(v.set(0, 1, 0), (idx % 4) * (Math.PI / 2));
          if (meshes.foliage) {
            s.set(k, k, k);
            m.compose(v.set(x, 0, z), q, s);
            const c = counts[crop.id].f++;
            meshes.foliage.setMatrixAt(c, m);
            // Grain crops turn from green to their harvest colour as they ripen.
            col.copy(green).lerp(col.set(crop.color), crop.id === 'wheat' || crop.id === 'corn' ? Math.pow(prog, 3) : 0);
            if (prog >= 1) col.multiplyScalar(1.12);
            meshes.foliage.setColorAt(c, col);
          }
          if (meshes.fruit && prog > 0.55) {
            const f = Math.min(1, (prog - 0.55) / 0.45);
            s.set(f, f, f);
            m.compose(v.set(x, 0, z), q, s);
            const c = counts[crop.id].r++;
            meshes.fruit.setMatrixAt(c, m);
            meshes.fruit.setColorAt(c, col.setRGB(1, 1, 1).lerp(green, 1 - f));
          }
        }
      }
    }

    this.soil.count = ns;
    this.soil.instanceMatrix.needsUpdate = true;
    if (this.soil.instanceColor) this.soil.instanceColor.needsUpdate = true;
    for (const crop of CROPS) {
      const { foliage, fruit } = this.crops[crop.id];
      for (const [mesh, n] of [[foliage, counts[crop.id].f], [fruit, counts[crop.id].r]]) {
        if (!mesh) continue;
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}
