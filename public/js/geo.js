import * as THREE from 'three';

// Many little boxes and cylinders baked into one mesh with per-vertex colour:
// one draw call for a whole crop, a whole person's torso, a whole prop.

/**
 * `parts` = [{ geo, color, x, y, z, rx, ry, rz, s: [sx, sy, sz] }]. The
 * geometries are copied, so shared ones can be reused.
 */
export function mergeParts(parts) {
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
