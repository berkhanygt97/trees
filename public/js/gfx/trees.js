import * as THREE from 'three';
import { injectGlobals } from './atmosphere.js';

// Trees with real shape: a trunk that tapers and leans, branches, and a
// crown built from dozens of leaf-cluster cards gathered round the branch
// ends. Crown normals point out from the middle of the crown, so a tree is
// lit like a soft ball (bright on the sunny side, dark underneath) instead of
// like flat cards. Everything sways a little in the wind, more in a storm.
//
// One texture (bark, broad leaves, needles) and one material for all
// species, so a species in a patch of ground is a single instanced draw.

export const WIND = { uTime: { value: 0 }, uWind: { value: 1 } };

// ------------------------------------------------------------ texture

let atlas = null;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Atlas regions in UV space: [u0, v0, u1, v1].
const BARK = [0, 0, 0.5, 1];
const LEAF = [0.5, 0.5, 1, 1];
const NEEDLE = [0.5, 0, 1, 0.5];

function paintAtlas() {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const rnd = mulberry(77);
  g.clearRect(0, 0, S, S);

  // Bark: furrowed, grey-brown, on the left half (full height).
  g.fillStyle = '#5b4a3c';
  g.fillRect(0, 0, S / 2, S);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * S / 2;
    const y = rnd() * S;
    const len = 20 + rnd() * 70;
    g.strokeStyle = rnd() < 0.55 ? `rgba(28,20,14,${0.25 + rnd() * 0.4})` : `rgba(150,130,110,${0.12 + rnd() * 0.2})`;
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + (rnd() - 0.5) * 6, y + len * 0.3, x + (rnd() - 0.5) * 6, y + len * 0.6, x + (rnd() - 0.5) * 4, y + len);
    g.stroke();
  }

  // Broad leaves: a dense cluster on a twig (top right; canvas y is flipped).
  const leaf = (x, y, a, l, c) => {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(l * 0.45, -l * 0.28, l, 0);
    g.quadraticCurveTo(l * 0.45, l * 0.28, 0, 0);
    g.fill();
    g.strokeStyle = 'rgba(20,40,10,0.35)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(l * 0.9, 0); g.stroke();
    g.restore();
  };
  const greens = ['#3d6a2a', '#4f7d31', '#5e8c38', '#34592a', '#6f9a42', '#476f2c'];
  const lx = S / 2;
  const ly = 0;
  g.save();
  g.beginPath(); g.rect(lx, ly, S / 2, S / 2); g.clip();
  const cx = lx + S / 4;
  const cy = ly + S / 4;
  for (let i = 0; i < 520; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * S * 0.22;
    leaf(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rnd() * Math.PI * 2, 14 + rnd() * 16, greens[(rnd() * greens.length) | 0]);
  }
  g.restore();

  // Needles: a conifer spray, a branch with needles down both sides (bottom right).
  g.save();
  g.beginPath(); g.rect(S / 2, S / 2, S / 2, S / 2); g.clip();
  const nx = S / 2;
  const ny = S / 2;
  // A solid core of foliage first, so the spray stays full at a distance
  // (when the texture is shrunk, thin needles alone would fade to nothing).
  for (let b = 0; b < 9; b++) {
    const y0 = ny + 22 + b * 26 + (rnd() - 0.5) * 6;
    g.fillStyle = '#233a25';
    g.beginPath();
    g.moveTo(nx + 10, y0);
    g.quadraticCurveTo(nx + S / 4, y0 - 12, nx + S / 2 - 10, y0 + 2);
    g.quadraticCurveTo(nx + S / 4, y0 + 12, nx + 10, y0);
    g.fill();
  }
  for (let b = 0; b < 9; b++) {
    const y0 = ny + 22 + b * 26 + (rnd() - 0.5) * 6;
    g.strokeStyle = '#4a3a26';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(nx + 8, y0); g.lineTo(nx + S / 2 - 8, y0 + (rnd() - 0.5) * 6); g.stroke();
    for (let i = 0; i < 150; i++) {
      const t = rnd();
      const x = nx + 8 + t * (S / 2 - 16);
      const side = rnd() < 0.5 ? -1 : 1;
      const len = (8 + rnd() * 10) * (1 - t * 0.4);
      g.strokeStyle = ['#29462a', '#35573a', '#223d24', '#3f6341', '#4a7048'][(rnd() * 5) | 0];
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x + len * 0.4, y0 + side * len); g.stroke();
    }
  }
  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function treeMaterial() {
  if (!atlas) atlas = paintAtlas();
  const m = new THREE.MeshStandardMaterial({
    map: atlas, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.82, metalness: 0,
  });
  m.onBeforeCompile = (shader) => {
    injectGlobals(shader);
    Object.assign(shader.uniforms, WIND);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[ 3 ].x * 0.21 + instanceMatrix[ 3 ].z * 0.17;
      #else
        float ph = 0.0;
      #endif
      float sway = max( position.y - 1.2, 0.0 );
      transformed.xz += vec2( sin( uTime * 1.1 + ph ), cos( uTime * 0.83 + ph * 1.3 ) ) * 0.004 * sway * sway * uWind;
      transformed.xz += vec2( sin( uTime * 4.3 + ph * 7.0 + position.y ), cos( uTime * 3.7 + position.x * 2.0 ) ) * 0.012 * step( 1.5, position.y ) * uWind;`);
  };
  m.customProgramCacheKey = () => 'tree-wind';
  return m;
}

// ------------------------------------------------------------ geometry

class Builder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; }

  get count() { return this.pos.length / 3; }

  /** A tapering tube along `pts` (Vector3s) with radii `rad`, in the bark region. */
  tube(pts, rad, sides = 6) {
    const base = this.count;
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const total = len[len.length - 1] || 1;
    const up = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const dir = (i < pts.length - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
      up.set(0, 0, 1);
      if (Math.abs(dir.dot(up)) > 0.9) up.set(1, 0, 0);
      a.crossVectors(dir, up).normalize();
      b.crossVectors(dir, a).normalize();
      for (let s = 0; s <= sides; s++) {
        const t = (s / sides) * Math.PI * 2;
        const nx = a.x * Math.cos(t) + b.x * Math.sin(t);
        const ny = a.y * Math.cos(t) + b.y * Math.sin(t);
        const nz = a.z * Math.cos(t) + b.z * Math.sin(t);
        this.pos.push(pts[i].x + nx * rad[i], pts[i].y + ny * rad[i], pts[i].z + nz * rad[i]);
        this.nor.push(nx, ny, nz);
        this.uv.push(BARK[0] + (s / sides) * (BARK[2] - BARK[0]), BARK[1] + (len[i] / total) * (BARK[3] - BARK[1]));
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      for (let s = 0; s < sides; s++) {
        const p = base + i * (sides + 1) + s;
        const q = p + sides + 1;
        this.idx.push(p, q, p + 1, p + 1, q, q + 1);
      }
    }
  }

  /**
   * A card of foliage centred at `c`, facing `n`, `w` x `h`, turned by `roll`;
   * lit as if its surface faced out from `centre` (a round crown).
   */
  card(c, n, w, h, roll, region, centre, droop = 0) {
    const base = this.count;
    const up = Math.abs(n.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const a = new THREE.Vector3().crossVectors(up, n).normalize();
    const b = new THREE.Vector3().crossVectors(n, a).normalize();
    a.applyAxisAngle(n, roll);
    b.applyAxisAngle(n, roll);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sy] of corners) {
      const p = c.clone().addScaledVector(a, sx * w / 2).addScaledVector(b, sy * h / 2);
      if (droop) p.y -= droop * (sx + 1) * 0.5;
      this.pos.push(p.x, p.y, p.z);
      const out = p.clone().sub(centre).normalize().lerp(n, 0.25).normalize();
      this.nor.push(out.x, out.y, out.z);
      this.uv.push(sx < 0 ? region[0] : region[2], sy < 0 ? region[1] : region[3]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const randDir = (rnd) => {
  const u = rnd() * 2 - 1;
  const t = rnd() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return V(Math.cos(t) * s, u, Math.sin(t) * s);
};

/** A broadleaf tree about 7 m tall: a trunk, five boughs and a round crown. */
function oak(rnd, far) {
  const B = new Builder();
  const lean = V((rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3);
  B.tube([V(0, -0.3, 0), V(0, 1.2, 0), V(lean.x * 0.6, 2.2, lean.z * 0.6), V(lean.x, 3.1, lean.z)], [0.34, 0.27, 0.23, 0.18], far ? 5 : 7);
  const ends = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd() * 0.6;
    const y0 = 2.3 + rnd() * 0.7;
    const len = 1.8 + rnd() * 0.9;
    const p0 = V(lean.x * 0.7, y0, lean.z * 0.7);
    const p1 = p0.clone().add(V(Math.cos(a) * len * 0.5, len * 0.45, Math.sin(a) * len * 0.5));
    const p2 = p0.clone().add(V(Math.cos(a) * len, len * 0.75, Math.sin(a) * len));
    if (!far) B.tube([p0, p1, p2], [0.12, 0.08, 0.035], 5);
    ends.push(p2);
  }
  const centre = V(lean.x, 4.4, lean.z);
  const cards = far ? 16 : 40;
  for (let i = 0; i < cards; i++) {
    const near = ends[i % ends.length];
    const p = i < cards * 0.68
      ? near.clone().add(randDir(rnd).multiplyScalar(0.4 + rnd() * 1.1))
      : centre.clone().add(randDir(rnd).multiply(V(2.3, 1.6, 2.3)).multiplyScalar(0.6 + rnd() * 0.4));
    const s = (1.4 + rnd() * 0.8) * (far ? 1.45 : 1);
    B.card(p, randDir(rnd), s, s, rnd() * 6.28, LEAF, centre);
  }
  return B.geometry();
}

/**
 * A pine about 10 m tall: a straight trunk and tiers of boughs. Each bough is
 * a card standing on edge along the branch (so the tree has a silhouette
 * from the side) plus one lying over it (so it is full from above).
 */
function pine(rnd, far) {
  const B = new Builder();
  B.tube([V(0, -0.3, 0), V(0, 3, 0), V(0, 6.5, 0), V(0, 9.8, 0)], [0.3, 0.24, 0.14, 0.03], far ? 4 : 6);
  const centre = V(0, 5.8, 0);
  const step = far ? 1.3 : 0.7;
  for (let h = 2.2; h < 9.7; h += step) {
    const r = 0.6 + (9.8 - h) / 7.6 * 2.3;
    const n = Math.max(far ? 3 : 4, Math.round(r * (far ? 1.8 : 2.6)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + h * 1.7 + rnd() * 0.4;
      const dir = V(Math.cos(a), 0, Math.sin(a));
      const c = V(dir.x * r * 0.5, h + (rnd() - 0.5) * 0.2, dir.z * r * 0.5);
      const tall = (1.2 + rnd() * 0.4) * (far ? 1.4 : 1);
      // On edge: its plane holds the branch and the vertical, tip drooping.
      B.card(c, V(-dir.z, 0, dir.x), r * 1.05, tall, 0, NEEDLE, centre, 0.5);
      if (!far) {
        // Lying over it, facing up and out.
        const up = V(dir.x * 0.45, 0.9, dir.z * 0.45).normalize();
        B.card(c.clone().add(V(0, 0.1, 0)), up, r, tall * 0.8, rnd() * 6.28, NEEDLE, centre, 0.3);
      }
    }
  }
  return B.geometry();
}

/** A cypress: a tall dark column. */
function cypress(rnd, far) {
  const B = new Builder();
  B.tube([V(0, -0.3, 0), V(0, 1.4, 0), V(0, 5, 0)], [0.2, 0.16, 0.06], far ? 4 : 5);
  const centre = V(0, 4.2, 0);
  const n = far ? 14 : 36;
  for (let i = 0; i < n; i++) {
    const d = randDir(rnd);
    const p = centre.clone().add(V(d.x * 1.05, d.y * 3.4, d.z * 1.05).multiplyScalar(0.55 + rnd() * 0.45));
    const k = far ? 1.4 : 1;
    B.card(p, V(d.x, d.y * 0.3, d.z).normalize(), (1.2 + rnd() * 0.5) * k, (1.5 + rnd() * 0.6) * k, Math.PI / 2 + (rnd() - 0.5) * 0.4, NEEDLE, centre);
  }
  return B.geometry();
}

const SPECIES = { oak, pine, cypress };
const cache = new Map();

/** The shared geometry for a species (a few variants each), near or far detail. */
export function treeGeometry(species, variant = 0, far = false) {
  const key = `${species}:${variant}:${far ? 1 : 0}`;
  if (!cache.has(key)) cache.set(key, SPECIES[species](mulberry(1000 + variant * 97 + species.length * 13), far));
  return cache.get(key);
}

// Patches further than this (from the camera to the patch's middle) use the
// low-detail trees.
const FAR = 260;

/**
 * Plants trees: `list` = [{ x, y, z, species, scale, turn, tint }]. Returns a
 * group of instanced meshes, one per species per patch of ground (so patches
 * out of view are skipped) and per variant, each in a near and a far version;
 * call group.userData.update(camera position) to switch between them.
 */
export function plantTrees(list, { cell = 256, variants = 2 } = {}) {
  const group = new THREE.Group();
  group.name = 'trees';
  const mat = treeMaterial();
  const buckets = new Map();
  list.forEach((t, i) => {
    const v = i % variants;
    const k = `${t.species}:${v}:${Math.floor(t.x / cell)},${Math.floor(t.z / cell)}`;
    if (!buckets.has(k)) buckets.set(k, { species: t.species, v, trees: [] });
    buckets.get(k).trees.push(t);
  });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  const patches = [];
  for (const b of buckets.values()) {
    const pair = [false, true].map((far) => {
      const mesh = new THREE.InstancedMesh(treeGeometry(b.species, b.v, far), mat, b.trees.length);
      b.trees.forEach((t, i) => {
        q.setFromAxisAngle(up, t.turn);
        s.setScalar(t.scale);
        m.compose(p.set(t.x, t.y, t.z), q, s);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c.setScalar(1).multiplyScalar(t.tint));
      });
      mesh.computeBoundingSphere();
      group.add(mesh);
      return mesh;
    });
    const mid = pair[0].boundingSphere.center.clone();
    patches.push({ near: pair[0], far: pair[1], mid });
  }
  group.userData.update = (cam) => {
    for (const pt of patches) {
      const far = Math.hypot(pt.mid.x - cam.x, pt.mid.z - cam.z) > FAR;
      pt.near.visible = !far;
      pt.far.visible = far;
    }
  };
  group.userData.update(new THREE.Vector3(0, 0, 0));
  return group;
}
