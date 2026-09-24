import * as THREE from 'three';
import { Builder, foliageMaterial } from './gfx/trees.js';

// Palm trees for the Strip, the plaza and the hoods: a ringed trunk that
// leans as it grows, and a crown of long feathery fronds that arch up and
// droop, each folded along its rib, swaying in the breeze. All the palms of
// one call are a single instanced draw.

// Texture regions: [u0, v0, u1, v1].
const TRUNK = [0, 0, 0.25, 1];
const FROND = [0.25, 0, 1, 1];

let atlas = null;

function paintAtlas() {
  const W = 512;
  const H = 256;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  // Trunk: grey-brown with the rings of old leaf bases, a little fibrous.
  const tw = W * 0.25;
  g.fillStyle = '#7d6a55';
  g.fillRect(0, 0, tw, H);
  for (let y = 0; y < H; y += 9) {
    g.fillStyle = 'rgba(40,30,20,0.55)';
    g.fillRect(0, y + 6, tw, 3);
    g.fillStyle = 'rgba(190,170,140,0.25)';
    g.fillRect(0, y, tw, 2);
  }
  for (let i = 0; i < 500; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(30,22,14,0.2)' : 'rgba(200,180,150,0.12)';
    g.fillRect(rnd() * tw, rnd() * H, 1 + rnd() * 2, 2 + rnd() * 5);
  }

  // Frond: a rib along the middle (u runs base to tip), leaflets angled
  // towards the tip down both sides, getting shorter at the ends.
  const x0 = tw;
  const fw = W - tw;
  const mid = H / 2;
  for (let i = 0; i < 70; i++) {
    const t = i / 70;
    const x = x0 + 6 + t * (fw - 12);
    const len = (mid - 8) * Math.sin(Math.min(1, t * 1.25) * Math.PI) ** 0.6 * (0.85 + rnd() * 0.15);
    for (const side of [-1, 1]) {
      const green = ['#3f7a2e', '#4d8a34', '#35682a', '#5b9a3c'][(rnd() * 4) | 0];
      g.strokeStyle = green;
      g.lineWidth = 3.2;
      g.beginPath();
      g.moveTo(x, mid);
      g.quadraticCurveTo(x + len * 0.3, mid + side * len * 0.5, x + len * 0.55, mid + side * len);
      g.stroke();
    }
  }
  g.strokeStyle = '#8a8a4a';
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(x0 + 2, mid); g.lineTo(W - 4, mid); g.stroke();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** One palm, about 8 m: the trunk, eleven fronds and a few young ones standing up. */
function palmGeometry(seed = 1) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const B = new Builder();
  const pts = [];
  const rad = [];
  for (let i = 0; i <= 10; i++) {
    const k = i / 10;
    pts.push(V(0.9 * k * k, k * 7.9, 0));
    rad.push(0.27 - 0.1 * k + (i === 0 ? 0.08 : 0));
  }
  B.tube(pts, rad, 8, TRUNK);
  const top = V(0.9, 7.9, 0);
  const fronds = 13;
  for (let f = 0; f < fronds; f++) {
    const young = f >= 11;
    const a = young ? f * 2.1 : (f / 11) * Math.PI * 2 + rnd() * 0.3;
    const out = V(Math.cos(a), 0, Math.sin(a));
    const side = V(-out.z, 0, out.x);
    const len = young ? 1.8 : 3.0 + rnd() * 0.6;
    const pitch0 = young ? 1.1 : 0.55 + rnd() * 0.25;
    const segs = 8;
    const base = B.count;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      // Arcs up and out, then droops under its own weight.
      const pitch = pitch0 - t * (young ? 0.6 : 1.9);
      let p = top.clone();
      for (let k = 0; k < i; k++) {
        const pk = pitch0 - (k / segs) * (young ? 0.6 : 1.9);
        p = p.addScaledVector(out, Math.cos(pk) * len / segs).add(V(0, Math.sin(pk) * len / segs, 0));
      }
      const width = (young ? 0.5 : 0.95) * Math.sin(Math.min(1, t * 1.15 + 0.05) * Math.PI) ** 0.6;
      const fold = width * 0.35;
      const up = V(-Math.sin(pitch) * out.x, Math.cos(pitch), -Math.sin(pitch) * out.z);
      const l = p.clone().addScaledVector(side, -width).addScaledVector(up, -fold);
      const r = p.clone().addScaledVector(side, width).addScaledVector(up, -fold);
      const u = FROND[0] + t * (FROND[2] - FROND[0]);
      for (const [q, v] of [[l, FROND[1]], [p, (FROND[1] + FROND[3]) / 2], [r, FROND[3]]]) {
        B.pos.push(q.x, q.y, q.z);
        // Lit as part of the round crown, tipped towards the sky.
        const n = q.clone().sub(top).normalize().add(V(0, 0.6, 0)).normalize();
        B.nor.push(n.x, n.y, n.z);
        B.uv.push(u, v);
      }
    }
    for (let i = 0; i < segs; i++) {
      const p = base + i * 3;
      B.idx.push(p, p + 3, p + 1, p + 1, p + 3, p + 4, p + 1, p + 4, p + 2, p + 2, p + 4, p + 5);
    }
  }
  // Coconuts: three dark knobs under the crown.
  for (const [dx, dz] of [[0.2, 0], [-0.1, 0.18], [-0.1, -0.18]]) {
    const c = top.clone().add(V(dx, -0.3, dz));
    B.tube([c.clone().add(V(0, 0.14, 0)), c, c.clone().add(V(0, -0.14, 0))], [0.02, 0.15, 0.02], 6, [0.02, 0.02, 0.04, 0.04]);
  }
  return B.geometry();
}

let geo = null;

/** `spots` = [[x, z], ...]. Returns { group, obstacles }. */
export function buildPalms(spots, seed = 7) {
  if (!atlas) atlas = paintAtlas();
  if (!geo) geo = palmGeometry(3);
  const group = new THREE.Group();
  const mat = foliageMaterial(atlas);
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let r = seed;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  spots.forEach(([x, z], i) => {
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    const k = 0.85 + rnd() * 0.35;
    s.set(k, k, k);
    m.compose(new THREE.Vector3(x, 0, z), q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.computeBoundingSphere();
  group.add(mesh);
  return { group, obstacles: spots.map(([x, z]) => ({ x, z, r: 0.45 })) };
}
