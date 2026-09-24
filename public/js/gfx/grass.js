import * as THREE from 'three';
import { injectGlobals } from './atmosphere.js';
import { WIND } from './trees.js';

// A field of real grass blades round the camera, drawn in one call. The
// blades live in a square that wraps as you move, so there are always blades
// near you and none wasted far away; each one looks up how high the ground
// is, how green, and whether grass grows there at all (not on roads, yards,
// fields or floors) from two small maps of the valley baked at startup.
// Beyond the field the ground's own grass texture carries on, and the blades
// shrink into it at the edge so there is no line.

const BLADES_PER_CLUMP = 5;

/** One clump: a few curved, tapering blades round a point. */
function clumpGeometry() {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let b = 0; b < BLADES_PER_CLUMP; b++) {
    const a = (b / BLADES_PER_CLUMP) * Math.PI * 2 + b * 0.7;
    const ox = Math.cos(a) * 0.08;
    const oz = Math.sin(a) * 0.08;
    const face = a + Math.PI / 2 + (b % 2) * 0.6;
    const wx = Math.cos(face);
    const wz = Math.sin(face);
    const h = 0.24 + (b % 3) * 0.06;
    const w = 0.022;
    const lean = 0.07 * (b % 2 ? 1 : -1);
    const base = pos.length / 3;
    // Two segments and a tip; leaning outwards, curving over.
    const rows = [[0, w], [0.55, w * 0.75], [1, 0]];
    for (const [t, half] of rows) {
      const bend = lean * t * t;
      const y = h * t;
      if (half > 0) {
        pos.push(ox - wx * half + Math.cos(a) * bend, y, oz - wz * half + Math.sin(a) * bend);
        pos.push(ox + wx * half + Math.cos(a) * bend, y, oz + wz * half + Math.sin(a) * bend);
        uv.push(0, t, 1, t);
      } else {
        pos.push(ox + Math.cos(a) * bend, y, oz + Math.sin(a) * bend);
        uv.push(0.5, 1);
      }
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class GrassField {
  /**
   * `bounds` = { minX, maxX, minZ, maxZ } of the maps; `sample(x, z)` returns
   * { height, r, g, b, grow (0..1) } for a point. `cell` = map resolution (m).
   */
  constructor(bounds, sample, { cell = 4, max = 16000 } = {}) {
    const W = Math.ceil((bounds.maxX - bounds.minX) / cell) + 1;
    const H = Math.ceil((bounds.maxZ - bounds.minZ) / cell) + 1;
    // Height, packed into two bytes (texelFetch'd and blended by hand, so no
    // float-texture support is needed); colour and where grass grows.
    let lo = Infinity;
    let hi = -Infinity;
    const heights = new Float32Array(W * H);
    const tint = new Uint8Array(W * H * 4);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const s = sample(bounds.minX + i * cell, bounds.minZ + j * cell);
        const k = j * W + i;
        heights[k] = s.height;
        lo = Math.min(lo, s.height);
        hi = Math.max(hi, s.height);
        tint[k * 4] = Math.min(255, s.r * 255);
        tint[k * 4 + 1] = Math.min(255, s.g * 255);
        tint[k * 4 + 2] = Math.min(255, s.b * 255);
        tint[k * 4 + 3] = Math.max(0, Math.min(1, s.grow)) * 255;
      }
    }
    const range = Math.max(1, hi - lo);
    const hdata = new Uint8Array(W * H * 4);
    for (let k = 0; k < W * H; k++) {
      const v = Math.round(((heights[k] - lo) / range) * 65535);
      hdata[k * 4] = v >> 8;
      hdata[k * 4 + 1] = v & 255;
      hdata[k * 4 + 3] = 255;
    }
    const heightTex = new THREE.DataTexture(hdata, W, H);
    heightTex.needsUpdate = true;
    const tintTex = new THREE.DataTexture(tint, W, H);
    tintTex.magFilter = THREE.LinearFilter;
    tintTex.minFilter = THREE.LinearFilter;
    tintTex.needsUpdate = true;

    const geo = clumpGeometry();
    const off = new Float32Array(max * 3);
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < max; i++) { off[i * 3] = rnd() * 2 - 1; off[i * 3 + 1] = rnd() * 2 - 1; off[i * 3 + 2] = rnd(); }
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
    geo.instanceCount = 0;
    this.max = max;

    this.uniforms = {
      uCam: { value: new THREE.Vector3() },
      uR: { value: 30 },
      uBounds: { value: new THREE.Vector4(bounds.minX, bounds.minZ, (W - 1) * cell, (H - 1) * cell) },
      uHeight: { value: heightTex },
      uTint: { value: tintTex },
      uHRange: { value: new THREE.Vector2(lo, range) },
      uGrid: { value: new THREE.Vector2(W, H) },
    };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      injectGlobals(shader);
      Object.assign(shader.uniforms, this.uniforms, WIND);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform vec3 uCam; uniform float uR; uniform vec4 uBounds; uniform sampler2D uHeight; uniform sampler2D uTint;
uniform vec2 uHRange; uniform vec2 uGrid; uniform float uTime; uniform float uWind;
attribute vec3 aOff;
varying vec3 vGrassTint;
varying float vGrassY;
float grassH(ivec2 c) {
  c = clamp(c, ivec2(0), ivec2(uGrid) - 1);
  vec4 t = texelFetch(uHeight, c, 0);
  return uHRange.x + (t.r * 255.0 * 256.0 + t.g * 255.0) / 65535.0 * uHRange.y;
}`)
        .replace('#include <begin_vertex>', `
vec2 rel = mod(aOff.xy * uR - uCam.xz + uR, 2.0 * uR) - uR;
vec2 wp = uCam.xz + rel;
vec2 g = (wp - uBounds.xy) / uBounds.zw * (uGrid - 1.0);
ivec2 c0 = ivec2(floor(g));
vec2 f = fract(g);
float h = mix(mix(grassH(c0), grassH(c0 + ivec2(1, 0)), f.x), mix(grassH(c0 + ivec2(0, 1)), grassH(c0 + ivec2(1, 1)), f.x), f.y);
vec4 tm = texture2D(uTint, (g + 0.5) / uGrid);
float inside = step(0.0, g.x) * step(g.x, uGrid.x - 1.0) * step(0.0, g.y) * step(g.y, uGrid.y - 1.0);
float edge = 1.0 - smoothstep(0.65, 1.0, max(abs(rel.x), abs(rel.y)) / uR);
float grow = step(aOff.z, tm.a * 0.95) * inside;
float s = grow * edge * (0.75 + fract(aOff.z * 13.7) * 0.5);
float ang = aOff.z * 40.0;
vec3 lp = position * vec3(1.0, s, 1.0) * mix(0.6, 1.0, s);
lp.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * lp.xz;
float bend = lp.y * lp.y;
lp.xz += vec2(sin(uTime * 1.7 + wp.x * 0.35 + wp.y * 0.2), cos(uTime * 1.3 + wp.y * 0.3)) * 0.5 * bend * uWind;
vec3 transformed = vec3(wp.x, h - 0.04, wp.y) + lp * step(0.001, s);
vGrassTint = tm.rgb;
vGrassY = uv.y;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGrassTint;\nvarying float vGrassY;')
        .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= vGrassTint * vec3(0.9, 1.0, 0.82) * mix(0.5, 1.05, vGrassY);`);
    };
    mat.customProgramCacheKey = () => 'grass-field';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.userData.noShadowCast = true;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'grass-field';
  }

  /** How many blades, and how far out they reach (from the graphics preset). */
  setDensity(blades, radius) {
    this.mesh.geometry.instanceCount = Math.min(this.max, Math.round(blades / BLADES_PER_CLUMP));
    this.uniforms.uR.value = radius;
    this.mesh.visible = blades > 0;
  }

  update(camPos) { this.uniforms.uCam.value.copy(camPos); }
}
