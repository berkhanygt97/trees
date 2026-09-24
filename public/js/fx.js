import * as THREE from 'three';

/** A soft round blob, drawn once and reused as the sprite for every particle. */
function puffTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(235,232,228,0.85)');
  grad.addColorStop(0.45, 'rgba(210,205,200,0.35)');
  grad.addColorStop(1, 'rgba(200,195,190,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * One shared pool of drifting smoke particles. The local viewmodel and every
 * remote avatar emit into the same pool, so there is a single buffer to update
 * no matter how many people are smoking.
 */
export class Smoke {
  constructor(scene, max = 220, tint = 0xffffff) {
    this.max = max;
    this.next = 0;
    this.positions = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    this.alphas = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1));

    // A tiny shader so each puff can fade and swell on its own.
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: puffTexture() }, tint: { value: new THREE.Color(tint) } },
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float size;
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Clamped: without a ceiling a puff a metre from the camera becomes a
          // 600px disc and whites out the whole screen.
          gl_PointSize = clamp(size * (34.0 / -mv.z), 2.0, 64.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        uniform vec3 tint;
        varying float vAlpha;
        void main() {
          vec4 c = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(c.rgb * tint, c.a * vAlpha);
        }`,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = geo;
  }

  /** Release a lungful at a world position. */
  puff(pos, count = 10, spread = 0.1) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      this.positions[i * 3] = pos.x + (Math.random() - 0.5) * spread;
      this.positions[i * 3 + 1] = pos.y + (Math.random() - 0.5) * spread;
      this.positions[i * 3 + 2] = pos.z + (Math.random() - 0.5) * spread;
      this.vel[i * 3] = (Math.random() - 0.5) * 0.35;
      this.vel[i * 3 + 1] = 0.35 + Math.random() * 0.45;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.35;
      this.maxLife[i] = 1.4 + Math.random() * 1.2;
      this.life[i] = this.maxLife[i];
      this.sizes[i] = 4 + Math.random() * 4;
      this.alphas[i] = 0.34;
    }
  }

  /** Thick smoke pouring off something that is burning or smashed up. */
  billow(pos, count = 2, strength = 1) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      this.positions[i * 3] = pos.x + (Math.random() - 0.5) * 2;
      this.positions[i * 3 + 1] = pos.y + Math.random() * 0.5;
      this.positions[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 2;
      this.vel[i * 3] = (Math.random() - 0.5) * 0.6 + 0.4;
      this.vel[i * 3 + 1] = 1.4 + Math.random() * 1.2;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
      this.maxLife[i] = 3 + Math.random() * 2.5;
      this.life[i] = this.maxLife[i];
      this.sizes[i] = 16 + Math.random() * 10 * strength;
      this.alphas[i] = 0.34;
    }
  }

  update(dt) {
    let live = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alphas[i] = 0; continue; }
      live = true;
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.positions[i * 3] += this.vel[i * 3] * dt;
      this.positions[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3 + 1] *= 0.985;          // slows as it rises
      this.sizes[i] += dt * 3.5;             // and spreads out
      this.alphas[i] = t * t * 0.34;
    }
    if (live) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.size.needsUpdate = true;
      this.geo.attributes.alpha.needsUpdate = true;
    }
  }
}
