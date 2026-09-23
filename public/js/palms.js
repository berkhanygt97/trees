import * as THREE from 'three';
import { mergeParts } from './geo.js';

// Palm trees for the Strip and the plaza: a curved, ringed trunk and a crown
// of drooping fronds. Every palm is one instance of two meshes, so fifty of
// them cost two draw calls.

const G = {
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 7),
  box: new THREE.BoxGeometry(1, 1, 1),
  ball: new THREE.SphereGeometry(0.5, 6, 5),
};

function trunkGeometry() {
  const parts = [];
  const segs = 11;
  const h = 0.72;
  for (let i = 0; i < segs; i++) {
    const k = i / segs;
    // Leans over as it grows, like it has been in the sea breeze for years.
    const x = 0.9 * k * k;
    const r = 0.26 - 0.1 * k;
    parts.push({ geo: G.cyl, color: i % 2 ? '#8a6a44' : '#7a5a38', x, y: i * h + h / 2, rz: -0.12 - k * 0.25, s: [r * 2, h * 1.02, r * 2] });
  }
  return mergeParts(parts);
}

function crownGeometry() {
  const parts = [];
  const top = [0.9, 11 * 0.72];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // Each frond: three flat boxes, drooping more towards the tip.
    for (let j = 0; j < 3; j++) {
      const reach = 0.9 + j * 1.05;
      const droop = 0.1 + j * 0.45;
      parts.push({
        geo: G.box, color: j === 2 ? '#4f9a3a' : '#3f8a30',
        x: top[0] + Math.cos(a) * reach, y: top[1] - droop, z: Math.sin(a) * reach,
        ry: -a, rz: -(0.2 + j * 0.35), s: [1.15, 0.05, 0.42 - j * 0.1],
      });
    }
  }
  for (const [dx, dz] of [[0.18, 0], [-0.1, 0.16], [-0.1, -0.16]]) {
    parts.push({ geo: G.ball, color: '#5a3a1a', x: top[0] + dx, y: top[1] - 0.25, z: dz, s: [0.28, 0.28, 0.28] });
  }
  return mergeParts(parts);
}

/** `spots` = [[x, z], ...]. Returns { group, obstacles }. */
export function buildPalms(spots, seed = 7) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const trunk = new THREE.InstancedMesh(trunkGeometry(), mat, spots.length);
  const crown = new THREE.InstancedMesh(crownGeometry(), mat, spots.length);
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
    trunk.setMatrixAt(i, m);
    crown.setMatrixAt(i, m);
  });
  group.add(trunk, crown);
  return { group, obstacles: spots.map(([x, z]) => ({ x, z, r: 0.45 })) };
}
