import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// How a frame is put together. The world is drawn in HDR (half-float, linear
// light) at the render scale the graphics preset and dynamic resolution
// choose, together with its depth. Then:
//
//   ambient occlusion (GTAO, from depth only, half size): contact shadows in
//     corners, under cars, round feet;
//   your hands and gun, drawn on top in their own pass (so the occlusion
//     never darkens them and they never clip into walls);
//   light shafts from the sun (Ultra);
//   bloom: a five-step blur chain, so anything brighter than white glows;
//   the grade: exposure, AgX tone mapping, a light filmic colour, vignette;
//   anti-aliasing (SMAA or FXAA);
//   and a sharpening upscale to the screen, which hides the lower render
//   scale dynamic resolution may be using.

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const COMPOSITE = `
uniform sampler2D tScene;
uniform sampler2D tAO;
uniform float aoStrength;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tScene, vUv);
  float ao = texture2D(tAO, vUv).r;
  gl_FragColor = vec4(c.rgb * mix(1.0, ao, aoStrength), 1.0);
}`;

// Bloom: a soft knee keeps it to what is actually bright, then dual-filter
// down and up samples spread it wide and smooth.
const DOWN = `
uniform sampler2D tDiffuse;
uniform vec2 texel;
uniform float threshold;
uniform float prefilter;
varying vec2 vUv;
vec3 knee(vec3 c) {
  c = min(c, vec3(40.0));
  float b = max(c.r, max(c.g, c.b));
  float k = threshold * 0.5;
  float soft = clamp(b - threshold + k, 0.0, 2.0 * k);
  soft = soft * soft / (4.0 * k + 1e-4);
  return c * max(soft, b - threshold) / max(b, 1e-4);
}
void main() {
  vec2 h = texel * 0.5;
  vec3 c = texture2D(tDiffuse, vUv).rgb * 4.0;
  c += texture2D(tDiffuse, vUv - h).rgb;
  c += texture2D(tDiffuse, vUv + h).rgb;
  c += texture2D(tDiffuse, vUv + vec2(h.x, -h.y)).rgb;
  c += texture2D(tDiffuse, vUv - vec2(h.x, -h.y)).rgb;
  c *= 0.125;
  gl_FragColor = vec4(prefilter > 0.5 ? knee(c) : c, 1.0);
}`;
const UP = `
uniform sampler2D tDiffuse;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  vec2 h = texel * 0.5;
  vec3 c = texture2D(tDiffuse, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
  c += texture2D(tDiffuse, vUv + vec2(-h.x, h.y)).rgb * 2.0;
  c += texture2D(tDiffuse, vUv + vec2(0.0, h.y * 2.0)).rgb;
  c += texture2D(tDiffuse, vUv + vec2(h.x, h.y)).rgb * 2.0;
  c += texture2D(tDiffuse, vUv + vec2(h.x * 2.0, 0.0)).rgb;
  c += texture2D(tDiffuse, vUv + vec2(h.x, -h.y)).rgb * 2.0;
  c += texture2D(tDiffuse, vUv + vec2(0.0, -h.y * 2.0)).rgb;
  c += texture2D(tDiffuse, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  gl_FragColor = vec4(c / 12.0, 1.0);
}`;

// Light shafts: the bright sky round the sun, smeared out from it.
const SHAFT_MASK = `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform vec2 sun;
uniform float aspect;
varying vec2 vUv;
void main() {
  float d = texture2D(tDepth, vUv).x;
  vec3 c = texture2D(tScene, vUv).rgb;
  vec2 off = (vUv - sun) * vec2(aspect, 1.0);
  float near = pow(max(1.0 - length(off) * 1.6, 0.0), 2.0);
  float sky = step(0.99999, d);
  // Only the really bright sky round the sun streams through.
  vec3 b = max(min(c, vec3(8.0)) - 0.9, 0.0);
  gl_FragColor = vec4(b * sky * near, 1.0);
}`;
const SHAFT_BLUR = `
uniform sampler2D tDiffuse;
uniform vec2 sun;
varying vec2 vUv;
void main() {
  vec2 step = (vUv - sun) / 40.0 * 0.9;
  vec2 uv = vUv;
  vec3 sum = vec3(0.0);
  float w = 1.0;
  for (int i = 0; i < 40; i++) {
    uv -= step;
    sum += texture2D(tDiffuse, uv).rgb * w;
    w *= 0.955;
  }
  gl_FragColor = vec4(sum / 20.0, 1.0);
}`;

const GRADE = `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tShafts;
uniform float bloom;
uniform float shafts;
uniform float exposure;
uniform vec3 balance;
uniform float saturation;
uniform float contrast;
uniform float vignette;
uniform float hurt;
uniform float fade;
uniform float flash;
varying vec2 vUv;
${THREE.ShaderChunk.tonemapping_pars_fragment}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  c += texture2D(tBloom, vUv).rgb * bloom;
  c += texture2D(tShafts, vUv).rgb * shafts;
  c *= exposure * balance;
  #if TONEMAP == 1
    c = ACESFilmicToneMapping(c);
  #elif TONEMAP == 2
    c = NeutralToneMapping(c);
  #else
    c = AgXToneMapping(c);
  #endif
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, saturation), 0.0);
  c = sRGBTransferOETF(vec4(c, 1.0)).rgb;
  // A gentle S-curve for a bit of punch.
  c = mix(c, c * c * (3.0 - 2.0 * c), contrast);
  vec2 d = vUv - 0.5;
  float v = dot(d, d);
  c *= 1.0 - v * vignette;
  // Getting hit: the edges go red.
  c = mix(c, vec3(0.55, 0.02, 0.0), clamp(hurt * (v * 3.2 + 0.08), 0.0, 0.85));
  c += flash;
  c *= 1.0 - fade;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// The last step: scale up to the screen with contrast-adaptive sharpening,
// and a hair of noise so dark gradients do not band.
const FINAL = `
uniform sampler2D tDiffuse;
uniform vec2 texel;
uniform float sharp;
varying vec2 vUv;
float rand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb;
  vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
  vec3 e = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb;
  vec3 w = texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb;
  vec3 mn = min(c, min(min(n, s), min(e, w)));
  vec3 mx = max(c, max(max(n, s), max(e, w)));
  vec3 amp = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
  vec3 k = amp * (-1.0 / mix(8.0, 5.0, sharp));
  vec3 o = (c + (n + s + e + w) * k) / (1.0 + 4.0 * k);
  float r = rand(gl_FragCoord.xy) + rand(gl_FragCoord.xy + 0.37) - 1.0;
  gl_FragColor = vec4(clamp(o, 0.0, 1.0) + r / 255.0, 1.0);
}`;

const mat = (fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({
  uniforms, vertexShader: VERT, fragmentShader, depthTest: false, depthWrite: false, toneMapped: false, ...extra,
});
const hdrTarget = (extra = {}) => new THREE.WebGLRenderTarget(4, 4, {
  type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, ...extra,
});
const ldrTarget = () => new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });

const MIPS = 5;

// GTAO from the world's depth alone (normals are rebuilt from it), so there
// is no second pass over the scene. three.js r169 assumes a normal target
// exists even then; a stand-in keeps it happy.
class DepthGTAO extends GTAOPass {
  setGBuffer(depthTexture) {
    this.normalRenderTarget = { depthTexture, setSize() {}, dispose() {} };
    super.setGBuffer(depthTexture, undefined);
  }
}

export class Pipeline {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.quality = quality;
    renderer.autoClear = false;

    // The world, in HDR, with its depth (for the occlusion and the shafts).
    const depthTexture = new THREE.DepthTexture(4, 4);
    depthTexture.type = THREE.UnsignedIntType;
    this.hdr = hdrTarget({ depthBuffer: true, depthTexture });
    // The world with occlusion applied, plus the hands on top.
    this.comp = hdrTarget({ depthBuffer: true });
    this.ldrA = ldrTarget();
    this.ldrB = ldrTarget();
    this.mips = Array.from({ length: MIPS }, () => hdrTarget());
    this.shaftA = hdrTarget();
    this.shaftB = hdrTarget();
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.white.needsUpdate = true;

    // The overlay (hands, gun) gets its own camera and lights that follow the world's.
    this.overlay = new THREE.Scene();
    this.overlayCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.overlay.add(this.overlayCamera);
    this.overlayAmbient = new THREE.AmbientLight(0xffffff, 0.9);
    this.overlayKey = new THREE.DirectionalLight(0xffffff, 1.2);
    this.overlayKey.position.set(0.6, 1, 0.4);
    this.overlay.add(this.overlayAmbient, this.overlayKey);

    this.compositeMat = mat(COMPOSITE, { tScene: { value: null }, tAO: { value: null }, aoStrength: { value: 0.85 } });
    this.downMat = mat(DOWN, { tDiffuse: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 1 }, prefilter: { value: 0 } });
    this.upMat = mat(UP, { tDiffuse: { value: null }, texel: { value: new THREE.Vector2() } },
      { transparent: true, blending: THREE.AdditiveBlending });
    this.maskMat = mat(SHAFT_MASK, { tScene: { value: null }, tDepth: { value: null }, sun: { value: new THREE.Vector2() }, aspect: { value: 1 } });
    this.shaftMat = mat(SHAFT_BLUR, { tDiffuse: { value: null }, sun: { value: new THREE.Vector2() } });
    this.uniforms = {
      tScene: { value: null },
      tBloom: { value: this.black },
      tShafts: { value: this.black },
      bloom: { value: 0 },
      shafts: { value: 0 },
      exposure: { value: 1 },
      balance: { value: new THREE.Vector3(1, 1, 1) },
      saturation: { value: 1.12 },
      contrast: { value: 0.28 },
      vignette: { value: 0.35 },
      hurt: { value: 0 },
      fade: { value: 0 },
      flash: { value: 0 },
      toneMappingExposure: { value: 1 },
    };
    // AgX by default; 'aces' or 'neutral' in localStorage['valley.tonemap'] to compare.
    let tm = 'agx';
    try { tm = localStorage.getItem('valley.tonemap') || 'agx'; } catch { /* default */ }
    this.gradeMat = mat(GRADE, this.uniforms, { defines: { TONEMAP: tm === 'aces' ? 1 : tm === 'neutral' ? 2 : 0 } });
    this.fxaaMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms),
      vertexShader: FXAAShader.vertexShader, fragmentShader: FXAAShader.fragmentShader,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.finalMat = mat(FINAL, { tDiffuse: { value: null }, texel: { value: new THREE.Vector2() }, sharp: { value: 0.3 } });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.gradeMat);
    this.quad.frustumCulled = false;
    this.post = new THREE.Scene();
    this.post.add(this.quad);
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.hurt = 0;
    this.wasted = 0;
    this.exposure = 1;
    this.gtao = null;
    this.smaa = null;
    this.sunScreen = new THREE.Vector3();
    this.resize();
  }

  get preset() { return this.quality.preset; }

  /** The pixel sizes everything is drawn at, from the screen and the render scale. */
  resize() {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    this.screen = size;
    const w = Math.max(2, Math.round(size.x * this.quality.scale));
    const h = Math.max(2, Math.round(size.y * this.quality.scale));
    this.w = w;
    this.h = h;
    this.hdr.setSize(w, h);
    this.comp.setSize(w, h);
    this.ldrA.setSize(w, h);
    this.ldrB.setSize(w, h);
    let mw = w;
    let mh = h;
    for (const m of this.mips) {
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
      m.setSize(mw, mh);
    }
    this.shaftA.setSize(Math.max(2, w >> 2), Math.max(2, h >> 2));
    this.shaftB.setSize(Math.max(2, w >> 2), Math.max(2, h >> 2));
    this.fxaaMat.uniforms.resolution.value.set(1 / w, 1 / h);
    this.finalMat.uniforms.texel.value.set(1 / w, 1 / h);
    if (this.gtao) this.gtao.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
    if (this.smaa) this.smaa.setSize(w, h);
  }

  _pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.post, this.postCamera);
  }

  _ao(scene, camera) {
    const p = this.preset;
    if (!p.ao) return null;
    if (!this.gtao) {
      this.gtao = new DepthGTAO(scene, camera, Math.max(2, this.w >> 1), Math.max(2, this.h >> 1), { depthTexture: this.hdr.depthTexture });
      this.gtao.output = GTAOPass.OUTPUT.Off;
      this.gtaoSamples = 0;
    }
    if (this.gtaoSamples !== p.aoSamples) {
      this.gtaoSamples = p.aoSamples;
      this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: p.aoSamples, distanceFallOff: 1, screenSpaceRadius: false });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1, rings: 2, samples: 12 });
    }
    this.gtao.camera = camera;
    this.gtao.scene = scene;
    this.gtao.render(this.renderer, null, null);
    return this.gtao.pdRenderTarget.texture;
  }

  _bloom(src) {
    const threshold = 1.1 / Math.max(0.05, this.exposure);
    let from = src;
    let fw = this.w;
    let fh = this.h;
    this.downMat.uniforms.threshold.value = threshold;
    this.mips.forEach((m, i) => {
      this.downMat.uniforms.tDiffuse.value = from;
      this.downMat.uniforms.texel.value.set(1 / fw, 1 / fh);
      this.downMat.uniforms.prefilter.value = i === 0 ? 1 : 0;
      this._pass(this.downMat, m);
      from = m.texture;
      fw = m.width;
      fh = m.height;
    });
    for (let i = MIPS - 2; i >= 0; i--) {
      const small = this.mips[i + 1];
      this.upMat.uniforms.tDiffuse.value = small.texture;
      this.upMat.uniforms.texel.value.set(1 / small.width, 1 / small.height);
      this._pass(this.upMat, this.mips[i]);
    }
    return this.mips[0].texture;
  }

  _shafts(camera, grade) {
    if (!this.preset.shafts || !grade.sunDir || (grade.inside || 0) > 0.5 || grade.sunDir.y < -0.02) return null;
    const p = this.sunScreen.copy(grade.sunDir).multiplyScalar(500).add(camera.position).project(camera);
    if (p.z > 1 || Math.abs(p.x) > 1.6 || Math.abs(p.y) > 1.6) return null;
    const sun = new THREE.Vector2(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    this.maskMat.uniforms.tScene.value = this.hdr.texture;
    this.maskMat.uniforms.tDepth.value = this.hdr.depthTexture;
    this.maskMat.uniforms.sun.value.copy(sun);
    this.maskMat.uniforms.aspect.value = this.w / this.h;
    this._pass(this.maskMat, this.shaftA);
    this.shaftMat.uniforms.tDiffuse.value = this.shaftA.texture;
    this.shaftMat.uniforms.sun.value.copy(sun);
    this._pass(this.shaftMat, this.shaftB);
    return this.shaftB.texture;
  }

  /**
   * `grade` = { night, inside, dusk, fade, flash, wasted, dt, overlayFov,
   * ambient, exposure, sunDir } from the sky and the HUD.
   */
  render(scene, camera, grade = {}) {
    const r = this.renderer;
    const p = this.preset;
    const dt = grade.dt || 0.016;
    const night = grade.night || 0;
    const inside = grade.inside || 0;

    // Exposure follows the light: eyes open up at night and indoors. Eased,
    // so walking out of the casino into the sun is a moment of glare.
    const target = grade.exposure || 1;
    this.exposure += (target - this.exposure) * Math.min(1, dt * 1.5);
    const u = this.uniforms;
    u.exposure.value = this.exposure;
    // White balance: a touch warm by day and in the casino, cool at night.
    const dusk = (grade.dusk || 0) * (1 - inside);
    u.balance.value.set(1.03 + dusk * 0.05, 1.0, 0.97 - dusk * 0.06);
    u.balance.value.lerp(new THREE.Vector3(0.9, 0.97, 1.1), night * (1 - inside));
    this.wasted += ((grade.wasted || 0) - this.wasted) * Math.min(1, dt * 2);
    u.saturation.value = 1.12 * (1 - this.wasted * 0.92);
    this.hurt = Math.max(0, this.hurt - 1.6 * dt);
    u.hurt.value = this.hurt;
    u.fade.value = grade.fade || 0;
    u.flash.value = grade.flash || 0;

    // 1. The world.
    r.setRenderTarget(this.hdr);
    r.clear();
    r.render(scene, camera);

    // 2. Light shafts (they need the sky's depth, before anything else).
    const shafts = this._shafts(camera, grade);
    u.tShafts.value = shafts || this.black;
    u.shafts.value = shafts ? 0.22 * (1 - night) : 0;

    // 3. Occlusion, applied, then the hands and gun on top.
    const ao = this._ao(scene, camera);
    let sceneTarget = this.hdr;
    if (ao) {
      this.compositeMat.uniforms.tScene.value = this.hdr.texture;
      this.compositeMat.uniforms.tAO.value = ao;
      this.compositeMat.uniforms.aoStrength.value = 0.8 + 0.2 * Math.max(night, inside);
      this._pass(this.compositeMat, this.comp);
      sceneTarget = this.comp;
    }
    this._overlay(camera, grade, sceneTarget);

    // 4. Bloom.
    if (p.bloom) {
      u.tBloom.value = this._bloom(sceneTarget.texture);
      u.bloom.value = 0.06 + night * 0.08 + inside * 0.04;
    } else {
      u.tBloom.value = this.black;
      u.bloom.value = 0;
    }

    // 5. Grade, 6. anti-alias, 7. up to the screen.
    u.tScene.value = sceneTarget.texture;
    this._pass(this.gradeMat, this.ldrA);
    let out = this.ldrA;
    if (p.aa === 'smaa') {
      if (!this.smaa) { this.smaa = new SMAAPass(this.w, this.h); this.smaa.needsSwap = false; }
      this.smaa.render(r, this.ldrB, this.ldrA);
      out = this.ldrB;
    } else if (p.aa === 'fxaa') {
      this.fxaaMat.uniforms.tDiffuse.value = this.ldrA.texture;
      this._pass(this.fxaaMat, this.ldrB);
      out = this.ldrB;
    }
    this.finalMat.uniforms.tDiffuse.value = out.texture;
    this.finalMat.uniforms.sharp.value = Math.min(1, 0.25 + (1 - this.quality.scale) * 1.6);
    r.setRenderTarget(null);
    r.clear();
    this._pass(this.finalMat, null);
    this.quad.material = this.gradeMat;
  }

  _overlay(camera, grade, target) {
    const r = this.renderer;
    const night = grade.night || 0;
    const inside = grade.inside || 0;
    this.overlayCamera.position.copy(camera.position);
    this.overlayCamera.quaternion.copy(camera.quaternion);
    this.overlayCamera.aspect = camera.aspect;
    this.overlayCamera.fov = grade.overlayFov || 58;
    this.overlayCamera.updateProjectionMatrix();
    if (grade.ambient) {
      this.overlayAmbient.color.copy(grade.ambient.color);
      this.overlayAmbient.intensity = grade.ambient.intensity;
      this.overlayKey.intensity = 0.5 + (1 - night) * 1.6 * (1 - inside * 0.5);
    }
    this.overlay.environment = grade.environment || null;
    r.setRenderTarget(target);
    r.clearDepth();
    r.render(this.overlay, this.overlayCamera);
  }

  /** Something hit you. */
  ouch(amount = 1) { this.hurt = Math.min(1, this.hurt + amount); }
}
