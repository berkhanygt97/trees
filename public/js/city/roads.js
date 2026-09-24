import * as THREE from 'three';
import { pbr } from '../gfx/materials.js';
import { noCast } from '../shadows.js';
import { ROADS, PLAZA } from '/shared/map.js';
import { asphaltTexture } from '../textures.js';
import { live } from '../batcher.js';

// Every road in the valley: tarmac, kerbs, and San Andreas lane markings (a
// double yellow down the middle of the big roads, white edge lines, dashes on
// the small ones) that stop at junctions, where streets get zebra crossings.
// All of it is a handful of merged meshes.

const Y_ROAD = 0.02;
const Y_PAINT = 0.05;

const along = (r) => (r.z1 - r.z0 > r.x1 - r.x0 ? 'z' : 'x');
const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

/** Stretches of a road's long axis that another road (or the plaza) crosses. */
function junctions(r, others) {
  const ax = along(r);
  const out = [];
  for (const o of others) {
    if (o === r || !overlap(r, o)) continue;
    if (ax === 'z') out.push([Math.max(r.z0, o.z0), Math.min(r.z1, o.z1)]);
    else out.push([Math.max(r.x0, o.x0), Math.min(r.x1, o.x1)]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** [a, b] minus the junctions (each grown by `pad`). */
function openSpans(a, b, cuts, pad) {
  let spans = [[a, b]];
  for (const [c0, c1] of cuts) {
    const next = [];
    for (const [s0, s1] of spans) {
      if (c1 + pad <= s0 || c0 - pad >= s1) { next.push([s0, s1]); continue; }
      if (c0 - pad > s0) next.push([s0, c0 - pad]);
      if (c1 + pad < s1) next.push([c1 + pad, s1]);
    }
    spans = next;
  }
  return spans.filter(([s0, s1]) => s1 - s0 > 0.5);
}

/** Collects flat quads (and boxes) into one geometry per colour. */
class QuadBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; }

  /** A horizontal rectangle at height y. */
  flat(x0, x1, z0, z1, y, u = 1, v = 1) {
    const p = this.pos;
    p.push(x0, y, z0, x0, y, z1, x1, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
    for (let i = 0; i < 6; i++) this.nor.push(0, 1, 0);
    this.uv.push(x0 / u, z0 / v, x0 / u, z1 / v, x1 / u, z0 / v, x1 / u, z0 / v, x0 / u, z1 / v, x1 / u, z1 / v);
  }

  /** An axis-aligned box (top and four sides). */
  box(x0, x1, z0, z1, y0, y1) {
    this.flat(x0, x1, z0, z1, y1);
    const side = (ax, az, bx, bz, nx, nz) => {
      this.pos.push(ax, y0, az, ax, y1, az, bx, y0, bz, bx, y0, bz, ax, y1, az, bx, y1, bz);
      for (let i = 0; i < 6; i++) this.nor.push(nx, 0, nz);
      const L = Math.hypot(bx - ax, bz - az);
      this.uv.push(0, 0, 0, 1, L, 0, L, 0, 0, 1, L, 1);
    };
    side(x0, z1, x1, z1, 0, 1);
    side(x1, z0, x0, z0, 0, -1);
    side(x0, z0, x0, z1, -1, 0);
    side(x1, z1, x1, z0, 1, 0);
  }

  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return new THREE.Mesh(g, material);
  }
}

export class Roads {
  constructor(parent) {
    this.group = new THREE.Group();
    this.group.name = 'roads';
    parent.add(this.group);
    const tar = new QuadBuilder();
    const white = new QuadBuilder();
    const yellow = new QuadBuilder();
    const kerb = new QuadBuilder();
    const everything = [...ROADS, { ...PLAZA, kind: 'plaza' }];

    for (const r of ROADS) {
      tar.flat(r.x0, r.x1, r.z0, r.z1, Y_ROAD, 6, 6);
      const ax = along(r);
      const [a, b] = ax === 'z' ? [r.z0, r.z1] : [r.x0, r.x1];
      const [c0, c1] = ax === 'z' ? [r.x0, r.x1] : [r.z0, r.z1];
      const mid = (c0 + c1) / 2;
      const width = c1 - c0;
      const cuts = junctions(r, everything);
      const spans = openSpans(a, b, cuts, 1.5);
      // A stripe along the road: `off` across from the middle, `w` wide.
      const stripe = (q, s0, s1, off, w) => {
        if (ax === 'z') q.flat(mid + off - w / 2, mid + off + w / 2, s0, s1, Y_PAINT);
        else q.flat(s0, s1, mid + off - w / 2, mid + off + w / 2, Y_PAINT);
      };
      const dashes = (q, s0, s1, off, w, on = 3, gap = 5) => {
        for (let s = s0 + 1; s + on < s1; s += on + gap) stripe(q, s, s + on, off, w);
      };
      for (const [s0, s1] of spans) {
        if (r.kind === 'avenue') {
          // Double yellow in the middle, lane dashes, white edges.
          stripe(yellow, s0, s1, -0.18, 0.14);
          stripe(yellow, s0, s1, 0.18, 0.14);
          dashes(white, s0, s1, -width / 4, 0.14);
          dashes(white, s0, s1, width / 4, 0.14);
          stripe(white, s0, s1, -width / 2 + 0.45, 0.18);
          stripe(white, s0, s1, width / 2 - 0.45, 0.18);
        } else if (r.kind === 'road') {
          dashes(yellow, s0, s1, 0, 0.16, 4, 5);
          stripe(white, s0, s1, -width / 2 + 0.4, 0.15);
          stripe(white, s0, s1, width / 2 - 0.4, 0.15);
        } else {
          dashes(white, s0, s1, 0, 0.14, 2.5, 4);
        }
      }
      // Zebra crossings where a street meets a junction.
      if (r.kind === 'street') {
        for (const [j0, j1] of cuts) {
          for (const at of [j0 - 3, j1 + 1]) {
            if (at < a + 1 || at + 2 > b - 1) continue;
            for (let k = c0 + 0.6; k < c1 - 0.6; k += 1.2) {
              if (ax === 'z') white.flat(k, k + 0.6, at, at + 2, Y_PAINT);
              else white.flat(at, at + 2, k, k + 0.6, Y_PAINT);
            }
          }
        }
      }
      // Kerbs along both long edges, broken where other roads join.
      const kspans = openSpans(a, b, cuts, 0);
      for (const [s0, s1] of kspans) {
        for (const edge of [c0, c1]) {
          const out = edge === c0 ? -1 : 1;
          const k0 = edge + (out < 0 ? -0.3 : 0);
          const k1 = edge + (out < 0 ? 0 : 0.3);
          if (ax === 'z') kerb.box(k0, k1, s0, s1, 0, 0.15);
          else kerb.box(s0, s1, k0, k1, 0, 0.15);
        }
      }
    }

    const asphalt = asphaltTexture().clone();
    asphalt.needsUpdate = true;
    this.tarMat = noCast(live(pbr(0xffffff, { map: asphalt })));
    const paint = (color) => noCast(pbr(color, { roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.group.add(
      tar.mesh(this.tarMat),
      white.mesh(paint(0xe8e4d4)),
      yellow.mesh(paint(0xe2b634)),
      kerb.mesh(noCast(pbr(0xb8b2a4, { roughness: 0.85 }))),
    );
  }

  /** Rain makes the tarmac dark and shiny. */
  setWet(wet) {
    const m = this.tarMat;
    // Rain: darker, and smooth enough to mirror the sky and the lamps.
    m.color.setScalar(1 - wet * 0.35);
    m.roughness = 1 - wet * 0.72;
  }
}
