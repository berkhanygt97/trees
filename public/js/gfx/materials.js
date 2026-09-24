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

let flakes = null;

/** Tiny random bumps: the metal flakes under a car's lacquer. */
function flakeMap() {
  if (flakes) return flakes;
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  let s = 99;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n * n; i++) {
    const x = (rnd() - 0.5) * 0.5;
    const y = (rnd() - 0.5) * 0.5;
    data[i * 4] = (x * 0.5 + 0.5) * 255;
    data[i * 4 + 1] = (y * 0.5 + 0.5) * 255;
    data[i * 4 + 2] = Math.sqrt(1 - x * x - y * y) * 127 + 128;
    data[i * 4 + 3] = 255;
  }
  flakes = new THREE.DataTexture(data, n, n);
  flakes.wrapS = flakes.wrapT = THREE.RepeatWrapping;
  flakes.repeat.set(24, 24);
  flakes.generateMipmaps = true;
  flakes.minFilter = THREE.LinearMipmapLinearFilter;
  flakes.needsUpdate = true;
  return flakes;
}

/**
 * Car paint: a coloured base with metal flakes (`metallic` 0..1) under a
 * clear lacquer that mirrors the sky. `worn` takes the shine off an old banger.
 */
export function carPaint(color, { metallic = 0.35, worn = false } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: metallic * 0.6,
    roughness: worn ? 0.6 : 0.38,
    normalMap: metallic > 0 ? flakeMap() : null,
    normalScale: new THREE.Vector2(0.18, 0.18),
    clearcoat: worn ? 0.25 : 1,
    clearcoatRoughness: worn ? 0.3 : 0.08,
    envMapIntensity: 1.1,
  });
}

/** Car windows: tinted and see-through, with the sky sliding across them. */
export const carGlass = (color = 0x18222c, o = {}) => pbr(color, {
  roughness: 0.03, metalness: 0, envMapIntensity: 2.2, transparent: true, opacity: 0.45, depthWrite: false, ...o,
});

/** Window glass: dark, very smooth, mirrors the sky. */
export const glass = (color = 0x10161e, o = {}) => pbr(color, { roughness: 0.04, metalness: 0, envMapIntensity: 1.4, ...o });
