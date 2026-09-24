import * as THREE from 'three';

// Joining meshes: three.js has this in its add-ons, but the desktop build
// leaves add-on folders out, so the game carries its own.

/** Joins indexed geometries with the same attributes into one. */
export function mergeGeometries(geos) {
  const names = Object.keys(geos[0].attributes);
  let verts = 0;
  let idx = 0;
  for (const g of geos) { verts += g.attributes.position.count; idx += g.index.count; }
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const a0 = geos[0].attributes[name];
    const arr = new a0.array.constructor(verts * a0.itemSize);
    let o = 0;
    for (const g of geos) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a0.itemSize, a0.normalized));
  }
  const index = new (verts > 65535 ? Uint32Array : Uint16Array)(idx);
  let io = 0;
  let base = 0;
  for (const g of geos) {
    const src = g.index.array;
    for (let i = 0; i < src.length; i++) index[io + i] = src[i] + base;
    io += src.length;
    base += g.attributes.position.count;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

/**
 * Replaces every plain mesh under `group` with one mesh per material (in the
 * group's own frame), so a fence of two hundred pickets is one draw call.
 * Instanced meshes and anything else are left where they are.
 */
export function mergeByMaterial(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const byMat = new Map();
  const drop = [];
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || !o.geometry.index) return;
    const geo = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv || !geo.attributes.normal) return;
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(geo);
    drop.push(o);
  });
  for (const o of drop) o.parent.remove(o);
  for (const [mat, geos] of byMat) {
    group.add(new THREE.Mesh(mergeGeometries(geos), mat));
    for (const g of geos) g.dispose();
  }
  return group;
}
