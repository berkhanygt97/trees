import * as THREE from 'three';

// The PS2 look, and a performance win at the same time: the world is drawn at
// a reduced resolution and scaled up soft, then graded warm like a 2004
// open-world game (golden days, blue nights), with a vignette and a touch of
// dithering. Your hands and gun are drawn in a second pass on top, so they
// never clip into the wall you are standing against.

export const QUALITY = [
  { id: 'ps2', name: 'PS2 (soft)', scale: 0.62, shadows: 1024, bloom: true },
  { id: 'sharp', name: 'Sharp', scale: 1, shadows: 2048, bloom: true },
  { id: 'fast', name: 'Potato', scale: 0.45, shadows: 0, bloom: false },
];

// Bloom: the bright parts of the picture, at a quarter of the size, blurred
// and added back, so neon, street lamps and the low sun glow the way they did
// on a CRT in 2004.
const BRIGHT = `
uniform sampler2D tDiffuse;
uniform vec2 texel;
uniform float threshold;
varying vec2 vUv;
void main() {
  vec3 c = (texture2D(tDiffuse, vUv + texel * vec2(-1.0, -1.0)).rgb + texture2D(tDiffuse, vUv + texel * vec2(1.0, -1.0)).rgb
          + texture2D(tDiffuse, vUv + texel * vec2(-1.0, 1.0)).rgb + texture2D(tDiffuse, vUv + texel * vec2(1.0, 1.0)).rgb) * 0.25;
  float l = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c * smoothstep(threshold, threshold + 0.35, l), 1.0);
}`;
const BLUR = `
uniform sampler2D tDiffuse;
uniform vec2 dir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227;
  c += (texture2D(tDiffuse, vUv + dir * 1.385).rgb + texture2D(tDiffuse, vUv - dir * 1.385).rgb) * 0.316;
  c += (texture2D(tDiffuse, vUv + dir * 3.231).rgb + texture2D(tDiffuse, vUv - dir * 3.231).rgb) * 0.07;
  gl_FragColor = vec4(c, 1.0);
}`;

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const FRAG = `
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform float bloom;
uniform vec2 res;
uniform vec3 tint;
uniform float saturation;
uniform float contrast;
uniform float vignette;
uniform float hurt;
uniform float fade;
uniform float flash;
uniform vec3 shadowTint;
uniform vec3 highTint;
uniform float lift;
varying vec2 vUv;

float bayer(vec2 p) {
  // 4x4 ordered dither, the PS2's favourite way of hiding banding.
  vec2 q = mod(floor(p), 4.0);
  float i = q.x + q.y * 4.0;
  float b = mod(i * 7.0 + floor(i / 4.0) * 5.0, 16.0);
  return b / 16.0 - 0.5;
}

vec3 toDisplay(vec3 lin) {
  // The scene is rendered linear; grade in display (gamma) space, like the
  // PS2 did, so darks are not crushed.
  return pow(max(lin, 0.0), vec3(1.0 / 2.2));
}

void main() {
  vec3 c = toDisplay(texture2D(tDiffuse, vUv).rgb + texture2D(tBloom, vUv).rgb * bloom);

  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, saturation);
  c = (c - 0.5) * contrast + 0.5;
  c *= tint;
  // Split toning: shadows and highlights get their own colour (warm haze by
  // day, purple and pink at dusk, teal and magenta at night), and the blacks
  // are lifted a touch, like smog.
  c *= mix(shadowTint, highTint, smoothstep(0.08, 0.85, l));
  c = c * (1.0 - lift) + lift * shadowTint;

  vec2 d = vUv - 0.5;
  float v = dot(d, d);
  c *= 1.0 - v * vignette;
  // Getting hit: the edges go red.
  c = mix(c, vec3(0.55, 0.02, 0.0), clamp(hurt * (v * 3.2 + 0.08), 0.0, 0.85));
  c += flash;
  c *= 1.0 - fade;

  // Already in display space: written straight out.
  gl_FragColor = vec4(clamp(c + bayer(gl_FragCoord.xy) / 255.0 * 1.5, 0.0, 1.0), 1.0);
}
`;

export class Pipeline {
  constructor(renderer) {
    this.renderer = renderer;
    renderer.autoClear = false;
    let q = 'ps2';
    try { q = localStorage.getItem('valley.gfx') || 'ps2'; } catch { /* default */ }
    this.quality = QUALITY.find((x) => x.id === q) || QUALITY[0];

    this.target = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    // The overlay (hands, gun) gets its own camera and lights that follow the world's.
    this.overlay = new THREE.Scene();
    this.overlayCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.overlay.add(this.overlayCamera);
    this.overlayAmbient = new THREE.AmbientLight(0xffffff, 0.9);
    this.overlayKey = new THREE.DirectionalLight(0xffffff, 1.2);
    this.overlayKey.position.set(0.6, 1, 0.4);
    this.overlay.add(this.overlayAmbient, this.overlayKey);

    const rt = () => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.bloomA = rt();
    this.bloomB = rt();
    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: this.target.texture }, texel: { value: new THREE.Vector2() }, threshold: { value: 0.9 } },
      vertexShader: VERT, fragmentShader: BRIGHT, depthTest: false, depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } },
      vertexShader: VERT, fragmentShader: BLUR, depthTest: false, depthWrite: false,
    });

    this.uniforms = {
      tDiffuse: { value: this.target.texture },
      tBloom: { value: this.bloomA.texture },
      bloom: { value: 0 },
      res: { value: new THREE.Vector2(4, 4) },
      tint: { value: new THREE.Vector3(1, 1, 1) },
      saturation: { value: 0.88 },
      contrast: { value: 1.1 },
      vignette: { value: 0.9 },
      hurt: { value: 0 },
      fade: { value: 0 },
      flash: { value: 0 },
      shadowTint: { value: new THREE.Vector3(1, 1, 1) },
      highTint: { value: new THREE.Vector3(1, 1, 1) },
      lift: { value: 0 },
    };
    this.gradeMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.gradeMat);
    this.quad.frustumCulled = false;
    this.post = new THREE.Scene();
    this.post.add(this.quad);
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.hurt = 0;
    this.resize();
  }

  cycleQuality() {
    const i = QUALITY.indexOf(this.quality);
    this.quality = QUALITY[(i + 1) % QUALITY.length];
    try { localStorage.setItem('valley.gfx', this.quality.id); } catch { /* ignore */ }
    this.resize();
    if (this.onQuality) this.onQuality(this.quality);
    return this.quality;
  }

  resize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(2, Math.round(size.x * this.quality.scale));
    const h = Math.max(2, Math.round(size.y * this.quality.scale));
    this.target.setSize(w, h);
    this.uniforms.res.value.set(w, h);
    const bw = Math.max(2, Math.round(w / 4));
    const bh = Math.max(2, Math.round(h / 4));
    this.bloomA.setSize(bw, bh);
    this.bloomB.setSize(bw, bh);
    this.brightMat.uniforms.texel.value.set(1 / w, 1 / h);
    this.bloomTexel = new THREE.Vector2(1 / bw, 1 / bh);
  }

  /** Draws `mat` over the whole of `target`. */
  _pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.post, this.postCamera);
  }

  _bloom(grade) {
    const night = grade.night || 0;
    const inside = grade.inside || 0;
    // By day only the sun and the glare bloom; at night every lamp and sign does.
    const threshold = 0.95 - night * 0.4 - inside * 0.2;
    const strength = this.quality.bloom ? 0.35 + night * 0.55 + inside * 0.2 : 0;
    this.uniforms.bloom.value = strength;
    if (!strength) return;
    this.brightMat.uniforms.threshold.value = threshold;
    this._pass(this.brightMat, this.bloomA);
    for (let i = 0; i < 2; i++) {
      this.blurMat.uniforms.tDiffuse.value = this.bloomA.texture;
      this.blurMat.uniforms.dir.value.set(this.bloomTexel.x, 0);
      this._pass(this.blurMat, this.bloomB);
      this.blurMat.uniforms.tDiffuse.value = this.bloomB.texture;
      this.blurMat.uniforms.dir.value.set(0, this.bloomTexel.y);
      this._pass(this.blurMat, this.bloomA);
    }
    this.quad.material = this.gradeMat;
  }

  /** `grade` = { night, inside, fade, flash } from the sky and the HUD. */
  render(scene, camera, grade = {}) {
    const r = this.renderer;
    const night = grade.night || 0;
    const inside = grade.inside || 0;
    // Golden afternoon outdoors, blue at night, neutral-warm in the casino.
    const day = [1.07, 1.0, 0.88];
    const nite = [0.86, 0.94, 1.12];
    const room = [1.04, 0.98, 0.95];
    const t = this.uniforms.tint.value;
    t.set(day[0] + (nite[0] - day[0]) * night, day[1] + (nite[1] - day[1]) * night, day[2] + (nite[2] - day[2]) * night);
    t.lerp(new THREE.Vector3(...room), inside);
    // Wasted: the colour drains out of the world.
    this.wasted = (this.wasted || 0) + ((grade.wasted || 0) - (this.wasted || 0)) * Math.min(1, (grade.dt || 0.016) * 2);
    this.uniforms.saturation.value = (0.86 + inside * 0.14) * (1 - this.wasted * 0.92);
    // Split tones: [shadows, highlights, lift] for day, dusk and night.
    const dusk = (grade.dusk || 0) * (1 - inside);
    const outside = 1 - inside;
    const mix3 = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
    let sh = [1.04, 1.0, 0.9];
    let hi = [1.04, 1.0, 0.92];
    let lift = 0.035;
    sh = mix3(sh, [1.0, 0.86, 1.12], dusk);
    hi = mix3(hi, [1.1, 0.94, 0.92], dusk);
    sh = mix3(sh, [0.82, 1.0, 1.14], night * outside);
    hi = mix3(hi, [1.12, 0.9, 1.08], night * outside);
    lift = lift + (0.02 - lift) * night;
    sh = mix3(sh, [1, 1, 1], inside);
    hi = mix3(hi, [1, 1, 1], inside);
    this.uniforms.shadowTint.value.set(...sh);
    this.uniforms.highTint.value.set(...hi);
    this.uniforms.lift.value = lift * outside;
    this.hurt = Math.max(0, this.hurt - 1.6 * (grade.dt || 0.016));
    this.uniforms.hurt.value = this.hurt;
    this.uniforms.fade.value = grade.fade || 0;
    this.uniforms.flash.value = grade.flash || 0;

    r.setRenderTarget(this.target);
    r.clear();
    r.render(scene, camera);

    // First-person overlay on top of the world, with its depth cleared.
    this.overlayCamera.position.copy(camera.position);
    this.overlayCamera.quaternion.copy(camera.quaternion);
    this.overlayCamera.aspect = camera.aspect;
    if (this.overlayCamera.fov !== grade.overlayFov) {
      this.overlayCamera.fov = grade.overlayFov || 58;
    }
    this.overlayCamera.updateProjectionMatrix();
    if (grade.ambient) {
      this.overlayAmbient.color.copy(grade.ambient.color);
      this.overlayAmbient.intensity = grade.ambient.intensity;
      this.overlayKey.intensity = 0.4 + (1 - night) * 1.0 * (1 - inside * 0.5);
    }
    r.clearDepth();
    r.render(this.overlay, this.overlayCamera);

    this._bloom(grade);
    r.setRenderTarget(null);
    r.clear();
    this.quad.material = this.gradeMat;
    r.render(this.post, this.postCamera);
  }

  /** Something hit you. */
  ouch(amount = 1) { this.hurt = Math.min(1, this.hurt + amount); }
}
