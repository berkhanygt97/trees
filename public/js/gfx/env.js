import * as THREE from 'three';

// Reflections and sky light for PBR materials: the live sky (with the ground
// below it) is drawn into a small cube map every couple of seconds and
// pre-filtered (PMREM), and that becomes scene.environment. So chrome shows
// the sunset, windows show the clouds, and the shade side of a building is
// lit by the blue sky. Indoors (the casino) has its own warm environment.
//
// The same render target is reused every time, so materials never see a new
// texture and nothing recompiles.

export class Environment {
  constructor(renderer, skyMaterial, size = 64) {
    this.renderer = renderer;
    this.skyMaterial = skyMaterial;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene = new THREE.Scene();
    this.box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), skyMaterial);
    this.box.frustumCulled = false;
    this.box.scale.setScalar(100);
    this.scene.add(this.box);
    this.texture = null;
    this.indoor = this._indoor();
    this._size(size);
    this.last = -Infinity;
    this.lastSun = new THREE.Vector3();
    this.lastCover = -1;
  }

  _size(size) {
    this.size = Math.max(16, size);
    if (this.cube) this.cube.dispose();
    if (this.target) this.target.dispose();
    this.cube = new THREE.WebGLCubeRenderTarget(this.size, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.camera = new THREE.CubeCamera(0.1, 1000, this.cube);
    this.scene.add(this.camera);
    this.target = null;
    this.texture = null;
    this.last = -Infinity;
  }

  /** A new cube size (from the graphics preset). */
  setSize(size) { if (size !== this.size) this._size(size); }

  /**
   * Redraws the sky environment if the sun or the clouds have moved enough,
   * or every few seconds anyway. `at` = where the camera is (for the clouds).
   */
  update(now, at, sunDir, cover) {
    const due = now - this.last > 4000
      || sunDir.distanceTo(this.lastSun) > 0.01
      || Math.abs(cover - this.lastCover) > 0.03;
    if (!due && this.texture) return this.texture;
    if (now - this.last < 700 && this.texture) return this.texture;     // never more than ~1.5 times a second
    this.last = now;
    this.lastSun.copy(sunDir);
    this.lastCover = cover;
    const r = this.renderer;
    const autoClear = r.autoClear;
    const target = r.getRenderTarget();
    r.autoClear = true;
    this.box.position.copy(at);
    this.camera.position.copy(at);
    this.skyMaterial.uniforms.envMode.value = 1;
    this.camera.update(r, this.scene);
    this.skyMaterial.uniforms.envMode.value = 0;
    this.target = this.pmrem.fromCubemap(this.cube.texture, this.target);
    this.texture = this.target.texture;
    r.autoClear = autoClear;
    r.setRenderTarget(target);
    return this.texture;
  }

  /** The casino: warm, dim, with bright chandeliers overhead. Made once. */
  _indoor() {
    const scene = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 c = mix(vec3(0.07, 0.03, 0.04), vec3(0.16, 0.1, 0.07), smoothstep(-0.4, 0.5, d.y));
          vec2 g = fract(d.xz / max(d.y, 0.2) * 1.6) - 0.5;
          if (d.y > 0.2) c += vec3(3.0, 2.2, 1.3) * smoothstep(0.16, 0.05, length(g));
          c += vec3(0.25, 0.05, 0.1) * smoothstep(0.1, -0.1, abs(d.y + 0.05) - 0.08);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
    room.scale.setScalar(50);
    scene.add(room);
    const rt = this.pmrem.fromScene(scene, 0.02);
    room.geometry.dispose();
    room.material.dispose();
    return rt.texture;
  }
}

/**
 * A photo studio as an environment, for previews with no sky of their own
 * (the dealer's turntable): a grey room, a bright softbox overhead and two
 * strip lights at the sides, so paint and chrome have something to show.
 */
export function studioEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = mix(vec3(0.05), vec3(0.32), smoothstep(-0.3, 0.6, d.y));
        c += vec3(4.0) * smoothstep(0.93, 0.97, d.y);
        c += vec3(2.2) * smoothstep(0.08, 0.02, abs(d.y - 0.25)) * smoothstep(0.7, 0.9, abs(d.x));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  room.scale.setScalar(50);
  scene.add(room);
  const rt = pmrem.fromScene(scene, 0.03);
  room.geometry.dispose();
  room.material.dispose();
  pmrem.dispose();
  return rt.texture;
}
