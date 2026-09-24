import * as THREE from 'three';

// Static batching: everything in the town is built from hundreds of little
// boxes and planes, each its own draw call. Once a part of the world is built,
// batchStatic() merges every mesh that will never move into one mesh per
// material per patch of ground. A street of shops goes from a few hundred
// draw calls to a dozen.
//
// Materials that only differ in how their texture is tiled become one: the
// tiling is baked into the geometry's UVs and they share a single texture.
// Anything that moves or changes is left alone:
//   - meshes (or their parents) marked with userData.dynamic
//   - materials marked with userData.live (their colour changes at night...)
//   - additive or ordered transparent things (glows, glass), sprites, instances.

const canonicalTex = new Map();     // texture key -> texture with no tiling
const sharedMats = new Map();       // material key -> merged material

/** Mark a material whose properties change at runtime, so it is never merged away. */
export function live(mat) { mat.userData.live = true; return mat; }
/** Mark an object (and everything under it) as moving or changing. */
export function dynamic(obj) { obj.userData.dynamic = true; return obj; }

function texKey(t) {
  return [t.source.uuid, t.wrapS, t.wrapT, t.magFilter, t.minFilter, t.anisotropy, t.colorSpace, t.flipY].join('|');
}

function canonical(t) {
  const k = texKey(t);
  let c = canonicalTex.get(k);
  if (!c) {
    c = t.clone();
    c.repeat.set(1, 1);
    c.offset.set(0, 0);
    c.rotation = 0;
    c.center.set(0, 0);
    c.wrapS = THREE.RepeatWrapping;
    c.wrapT = THREE.RepeatWrapping;
    c.needsUpdate = true;
    canonicalTex.set(k, c);
  }
  return c;
}

const hex = (c) => (c ? c.getHexString() : '-');

// Every texture slot a material can have. They all share the colour map's
// tiling (gfx/materials.js makes sure of it), so all of them are baked the same.
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap'];

function matKey(m) {
  return [
    m.type, hex(m.color), hex(m.emissive), ...MAPS.map((k) => (m[k] ? texKey(m[k]) : '-')),
    m.vertexColors ? 1 : 0, m.transparent ? 1 : 0, m.opacity,
    m.alphaTest, m.side, m.flatShading ? 1 : 0, m.roughness, m.metalness, m.emissiveIntensity, m.envMapIntensity,
    m.normalScale ? m.normalScale.x : '-', m.shininess, hex(m.specular), m.depthWrite ? 1 : 0,
    m.depthTest ? 1 : 0, m.fog ? 1 : 0, m.blending, m.wireframe ? 1 : 0, m.polygonOffset ? 1 : 0,
  ].join('/');
}

function sharedMaterial(m) {
  const k = matKey(m);
  let s = sharedMats.get(k);
  if (!s) {
    s = m.clone();
    for (const slot of MAPS) if (m[slot]) s[slot] = canonical(m[slot]);
    sharedMats.set(k, s);
  }
  return { key: k, material: s };
}

function mergeable(o) {
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return false;
  if (Array.isArray(o.material) || !o.material) return false;
  const m = o.material;
  if (m.userData.live) return false;
  if (o.userData.halo) return false;
  if (o.renderOrder !== 0) return false;
  if (m.transparent && m.blending !== THREE.NormalBlending) return false;
  if (m.isShaderMaterial || m.isRawShaderMaterial) return false;
  if (m.map && (m.map.isCanvasTexture && m.map.userData.live)) return false;
  for (let p = o; p; p = p.parent) if (p.userData.dynamic) return false;
  return true;
}

const tmpBox = new THREE.Box3();
const tmpV = new THREE.Vector3();
const uvM = new THREE.Matrix3();

/**
 * Merges the static meshes under `root` into as few meshes as possible.
 * Merged meshes are added to `root` (in its local space); the originals are
 * removed. `chunk` is the patch size in metres (0 = one patch).
 * Returns { before, after } mesh counts.
 */
export function batchStatic(root, { chunk = 96 } = {}) {
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  let count = 0;
  const found = [];
  root.traverse((o) => { if (mergeable(o)) found.push(o); });
  for (const o of found) {
    const geo = o.geometry;
    if (!geo || !geo.attributes.position) continue;
    if (!geo.boundingBox) geo.computeBoundingBox();
    tmpBox.copy(geo.boundingBox).applyMatrix4(o.matrixWorld);
    tmpBox.getCenter(tmpV);
    const ck = chunk ? `${Math.floor(tmpV.x / chunk)},${Math.floor(tmpV.z / chunk)}` : '0';
    const { key, material } = sharedMaterial(o.material);
    const bk = `${key}#${ck}`;
    let b = buckets.get(bk);
    if (!b) { b = { material, parts: [], color: !!o.material.vertexColors }; buckets.set(bk, b); }
    const rel = new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
    b.parts.push({ obj: o, geo, matrix: rel, map: o.material.map || null });
    count++;
  }

  // Merged before anything was drawn, so the originals never reached the GPU:
  // dropping them is enough (their geometry may also be shared, so no dispose).
  let after = 0;
  for (const b of buckets.values()) {
    after++;
    if (b.parts.length === 1) continue;        // nothing to merge with: keep it as it is
    const mesh = new THREE.Mesh(mergeParts(b.parts, b.color), b.material);
    mesh.name = 'batched';
    root.add(mesh);
    for (const p of b.parts) p.obj.parent.remove(p.obj);
  }
  return { before: count, after };
}

function mergeParts(parts, withColor) {
  let count = 0;
  const prepared = parts.map((p) => {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    g.applyMatrix4(p.matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    count += g.attributes.position.count;
    return { g, map: p.map };
  });
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const col = withColor ? new Float32Array(count * 3) : null;
  let off = 0;
  for (const { g, map } of prepared) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    const a = g.attributes.uv;
    if (a) {
      if (map && (map.repeat.x !== 1 || map.repeat.y !== 1 || map.offset.x || map.offset.y || map.rotation)) {
        map.updateMatrix();
        uvM.copy(map.matrix);
        const e = uvM.elements;
        for (let i = 0; i < n; i++) {
          const u = a.getX(i);
          const v = a.getY(i);
          uv[(off + i) * 2] = e[0] * u + e[3] * v + e[6];
          uv[(off + i) * 2 + 1] = e[1] * u + e[4] * v + e[7];
        }
      } else {
        for (let i = 0; i < n; i++) { uv[(off + i) * 2] = a.getX(i); uv[(off + i) * 2 + 1] = a.getY(i); }
      }
    }
    if (col) {
      const c = g.attributes.color;
      if (c) for (let i = 0; i < n; i++) { col[(off + i) * 3] = c.getX(i); col[(off + i) * 3 + 1] = c.getY(i); col[(off + i) * 3 + 2] = c.getZ(i); }
      else col.fill(1, off * 3, (off + n) * 3);
    }
    off += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
