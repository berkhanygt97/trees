import * as THREE from 'three';

// Who casts sun shadows and who catches them. Everything solid casts and
// catches; the ground, the roads and the grass only catch (they are flat, and
// thousands of grass tufts in the shadow map would cost more than they show).

/** Mark a material as never casting a shadow (the ground, road paint, grass). */
export function noCast(mat) { mat.userData.noCast = true; return mat; }

/** Sets the shadow flags on everything under `root` that has not been seen yet. */
export function markShadows(root) {
  root.traverse((o) => {
    if (!o.isMesh || o.userData.shadowSet) return;
    o.userData.shadowSet = true;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.isMeshBasicMaterial || m.isShaderMaterial || m.isRawShaderMaterial) return;
    if (m.transparent && m.blending !== THREE.NormalBlending) return;
    o.receiveShadow = true;
    o.castShadow = !m.userData.noCast && !o.userData.noCast && !(m.transparent && !m.alphaTest);
  });
}
