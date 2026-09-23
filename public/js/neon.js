import * as THREE from 'three';
import { glowTexture } from './textures.js';

// Neon glow: a soft additive halo behind a sign that swells after dark, the
// cheapest possible stand-in for bloom, and very Vice City.

const halos = new Set();

/** A halo `w` x `h` metres (it spills a bit beyond), in `color`. */
export function makeHalo(w, h, color, { day = 0.08, night = 0.7 } = {}) {
  const mat = new THREE.MeshBasicMaterial({
    map: glowTexture(), color: new THREE.Color(color), transparent: true, opacity: day,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.6, h * 2.6), mat);
  mesh.renderOrder = 1;
  mesh.userData.halo = { day, night };
  halos.add(mesh);
  return mesh;
}

export function dropHalo(mesh) {
  halos.delete(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
}

let t = 0;
/** Brighter at night, with the occasional flicker. */
export function updateHalos(dt, night) {
  t += dt;
  for (const m of halos) {
    const { day, night: n } = m.userData.halo;
    const flick = Math.sin(t * 31 + m.id) > 0.985 ? 0.5 : 1;
    m.material.opacity = (day + (n - day) * night) * flick;
  }
}
