import * as THREE from 'three';
import { terrainMaterial } from '../gfx/terrainmat.js';
import { noCast } from '../shadows.js';
import { terrainGrid, inValley, distToFlat } from '/shared/terrain.js';
import { BOUNDS } from '/shared/map.js';

// The ground: one mesh per 128 m patch, built from the same height grid the
// server and the physics use, so your feet and the ground always agree.
// Inside the valley every grid point is used (4 m); out in the mountains,
// every fourth (16 m). Skirts hang under every patch edge so the two
// resolutions never show a crack.
//
// Every vertex says what the ground is (gfx/terrainmat.js blends the
// surfaces): grass where it is flat and watered, tinted dry gold on the
// hillsides, bare dirt on the slopes, sand at the feet of the mountains and
// rock up in them and on anything steep.

const CHUNK = 128;

// The grass's colour, by how green or dry it is.
const GRASS = new THREE.Color(0x6f9e44);
const LUSH = new THREE.Color(0x5b8f3a);
const DRY = new THREE.Color(0xc2ad62);

function hash(i, j) {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const i = Math.floor(x); const j = Math.floor(z);
  const fx = x - i; const fz = z - j;
  const sx = fx * fx * (3 - 2 * fx); const sz = fz * fz * (3 - 2 * fz);
  const a = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * sx;
  const b = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * sx;
  return a + (b - a) * sz;
}

export class Terrain {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    // Double-sided so the skirts under each patch edge show from either side.
    this.material = noCast(terrainMaterial());
    this.g = terrainGrid();
    const { cols, rows, cell, minX, minZ } = this.g;
    const maxX = minX + (cols - 1) * cell;
    const maxZ = minZ + (rows - 1) * cell;
    for (let x0 = minX; x0 < maxX - 1; x0 += CHUNK) {
      for (let z0 = minZ; z0 < maxZ - 1; z0 += CHUNK) {
        const x1 = Math.min(maxX, x0 + CHUNK);
        const z1 = Math.min(maxZ, z0 + CHUNK);
        const near = x1 > BOUNDS.minX - 60 && x0 < BOUNDS.maxX + 60 && z1 > BOUNDS.minZ - 60 && z0 < BOUNDS.maxZ + 60;
        this.group.add(this._chunk(x0, z0, x1, z1, near ? 1 : 4));
      }
    }
  }

  _h(i, j) {
    const { cols, rows, grid } = this.g;
    i = Math.max(0, Math.min(cols - 1, i));
    j = Math.max(0, Math.min(rows - 1, j));
    return grid[j * cols + i];
  }

  _chunk(x0, z0, x1, z1, step) {
    const { cell, minX, minZ } = this.g;
    const i0 = Math.round((x0 - minX) / cell);
    const j0 = Math.round((z0 - minZ) / cell);
    const ni = Math.round((x1 - x0) / cell / step);
    const nj = Math.round((z1 - z0) / cell / step);
    const W = ni + 1;
    const vcount = W * (nj + 1);
    const pos = new Float32Array(vcount * 3);
    const nor = new Float32Array(vcount * 3);
    const uv = new Float32Array(vcount * 2);
    const col = new Float32Array(vcount * 3);
    const spl = new Float32Array(vcount * 4);
    const c = new THREE.Color();
    const w = [0, 0, 0, 0];
    const n = new THREE.Vector3();
    for (let b = 0; b <= nj; b++) {
      for (let a = 0; a <= ni; a++) {
        const gi = i0 + a * step;
        const gj = j0 + b * step;
        const x = minX + gi * cell;
        const z = minZ + gj * cell;
        const y = this._h(gi, gj);
        const k = b * W + a;
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        // Normal from the whole grid, so neighbouring patches shade the same.
        n.set(this._h(gi - 1, gj) - this._h(gi + 1, gj), 2 * cell, this._h(gi, gj - 1) - this._h(gi, gj + 1)).normalize();
        nor[k * 3] = n.x; nor[k * 3 + 1] = n.y; nor[k * 3 + 2] = n.z;
        uv[k * 2] = x / 6; uv[k * 2 + 1] = z / 6;
        this._colour(x, y, z, n.y, c, w);
        col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
        spl.set(w, k * 4);
      }
    }
    const idx = [];
    for (let b = 0; b < nj; b++) {
      for (let a = 0; a < ni; a++) {
        const p = b * W + a;
        idx.push(p, p + W, p + 1, p + 1, p + W, p + W + 1);
      }
    }
    // Skirts: a strip hanging down from every edge hides seams between patches.
    const skirt = [];
    const edge = (list) => {
      for (let e = 0; e < list.length - 1; e++) skirt.push([list[e], list[e + 1]]);
    };
    const row = (b) => [...Array(W).keys()].map((a) => b * W + a);
    const colv = (a) => [...Array(nj + 1).keys()].map((b) => b * W + a);
    edge(row(0)); edge(row(nj).reverse()); edge(colv(0).reverse()); edge(colv(ni));
    const extra = skirt.length * 2;
    const P = new Float32Array(pos.length + extra * 3);
    const N = new Float32Array(nor.length + extra * 3);
    const U = new Float32Array(uv.length + extra * 2);
    const C = new Float32Array(col.length + extra * 3);
    const S = new Float32Array(spl.length + extra * 4);
    P.set(pos); N.set(nor); U.set(uv); C.set(col); S.set(spl);
    let v = vcount;
    for (const [p, q] of skirt) {
      for (const s of [p, q]) {
        P[v * 3] = pos[s * 3]; P[v * 3 + 1] = pos[s * 3 + 1] - 6; P[v * 3 + 2] = pos[s * 3 + 2];
        N.set(nor.subarray(s * 3, s * 3 + 3), v * 3);
        U[v * 2] = uv[s * 2]; U[v * 2 + 1] = uv[s * 2 + 1] + 1;
        C.set(col.subarray(s * 3, s * 3 + 3), v * 3);
        S.set(spl.subarray(s * 4, s * 4 + 4), v * 4);
        v++;
      }
      const a1 = v - 2;
      const b1 = v - 1;
      idx.push(p, a1, q, q, a1, b1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
    geo.setAttribute('splat', new THREE.BufferAttribute(S, 4));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.y = -0.03;           // a hair under roads and floors
    mesh.name = 'terrain-chunk';
    return mesh;
  }

  /** The grass colour (out) and how much of each surface (w: grass, dirt, rock, sand). */
  _colour(x, y, z, up, out, w) {
    const big = vnoise(x / 70, z / 70);
    const small = vnoise(x / 13 + 50, z / 13 - 20);
    const patch = vnoise(x / 9 - 30, z / 9 + 70);
    const slope = 1 - up;                            // 0 flat .. ~0.5 steep
    const flatness = Math.max(0, 1 - distToFlat(x, z) / 40);
    // Flat, built-up land: mostly green with sun-bleached patches.
    out.copy(big > 0.5 ? LUSH : GRASS);
    out.lerp(DRY, Math.max(0, big - 0.42) * 1.6 * (1 - flatness * 0.4));
    // Hillsides dry out.
    out.lerp(DRY, Math.min(1, y / 10) * 0.65);
    out.multiplyScalar((0.9 + small * 0.2) * 0.86);
    // What the ground is: dirt where it is steep (and in worn patches),
    // sand and rock in the mountains, rock on anything very steep.
    w[0] = 1; w[1] = 0; w[2] = 0; w[3] = 0;
    const mix = (i, k) => { if (k <= 0) return; for (let j = 0; j < 4; j++) w[j] *= 1 - k; w[i] += k; };
    mix(1, Math.min(1, Math.max(0, slope - 0.08) * 5));
    mix(1, Math.max(0, patch - 0.72) * 2.2 * (1 - flatness * 0.7));
    if (!inValley(x, z)) {
      mix(3, Math.min(1, y / 30) * 0.45);
      mix(2, Math.min(1, Math.max(0, (y - 35) / 60)));
    }
    mix(2, Math.min(1, Math.max(0, (slope - 0.32) * 4)));
    return out;
  }
}
