import * as THREE from 'three';
import { surfaceFor } from './surfaces.js';

// Physically based materials for the whole game. Every file used to build
// its own Phong or Lambert materials; they now come through here and become
// MeshStandardMaterial: lit by the sun and the lamps as before, plus the
// sky's own light and reflections (scene.environment), with proper
// roughness. A colour map that has a normal and roughness map (the ground,
// walls and roofs from gfx/surfaces.js) brings them along automatically.
//
// The old options still work: `shininess` becomes roughness, `specular`,
// `reflectivity` and `combine` are dropped.

/** Phong shininess to a roughness that looks about as glossy. */
export function roughFromShininess(n = 30) {
  if (n <= 10) return 0.9;
  if (n <= 25) return 0.75;
  if (n <= 50) return 0.55;
  if (n <= 80) return 0.4;
  return 0.28;
}

const DROP = ['shininess', 'specular', 'reflectivity', 'combine', 'refractionRatio', 'specularMap'];

/** A copy of `t` sharing its image, tiled the same as `like`. */
function tiledLike(t, like) {
  if (!t) return null;
  if (t.repeat.equals(like.repeat) && t.offset.equals(like.offset) && t.rotation === like.rotation) return t;
  const c = t.clone();
  c.repeat.copy(like.repeat);
  c.offset.copy(like.offset);
  c.rotation = like.rotation;
  c.center.copy(like.center);
  c.wrapS = like.wrapS;
  c.wrapT = like.wrapT;
  c.needsUpdate = true;
  return c;
}

/** Adds the normal and roughness maps that belong with the material's colour map. */
export function withSurface(m) {
  const s = m.map ? surfaceFor(m.map) : null;
  if (!s) return m;
  if (!m.normalMap) {
    m.normalMap = tiledLike(s.normalMap, m.map);
    m.normalScale.setScalar(s.normalScale || 1);
  }
  if (!m.roughnessMap) {
    m.roughnessMap = tiledLike(s.roughnessMap, m.map);
    // The map holds the roughness; the material's value scales it.
    m.userData.roughBase = 1;
    m.roughness = 1;
  }
  if (s.metal && !m.metalnessMap) {
    m.metalnessMap = m.roughnessMap;
    m.metalness = 1;
  }
  return m;
}

/** A PBR material. `o` takes MeshStandardMaterial options (and old Phong ones). */
export function pbr(color, o = {}) {
  const opts = { ...o };
  const shin = opts.shininess;
  for (const k of DROP) delete opts[k];
  if (opts.roughness === undefined) opts.roughness = roughFromShininess(shin ?? 30);
  if (opts.metalness === undefined) opts.metalness = 0;
  if (color !== undefined && color !== null) opts.color = color;
  return withSurface(new THREE.MeshStandardMaterial(opts));
}

/** Drop-in for the old `phong(color, o)` helpers. */
export const phong = (color, o = {}) => pbr(color, { shininess: 8, ...o });
/** Drop-in for the old `lambert(color, o)` helpers: fully matt. */
export const lambert = (color, o = {}) => pbr(color, { roughness: 0.95, ...o });

/** Bare metal: chrome, steel, brass. */
export const metal = (color, roughness = 0.2, o = {}) => pbr(color, { metalness: 1, roughness, ...o });

/** Window glass: dark, very smooth, mirrors the sky. */
export const glass = (color = 0x10161e, o = {}) => pbr(color, { roughness: 0.04, metalness: 0, envMapIntensity: 1.4, ...o });
