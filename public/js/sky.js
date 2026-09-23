import * as THREE from 'three';
import { DAY_MS } from '/shared/catalog.js';
import { cloudTexture, glowTexture } from './textures.js';

// Sun, moon, stars, rain and lightning. Also decides how the scene is lit:
// outdoors follows the time of day, and stepping into the casino fades over to
// the casino's own warm lighting (there is no night inside a casino).

const lerp = (a, b, t) => a + (b - a) * t;
const C = (hex) => new THREE.Color(hex);

// [hour, zenith, horizon] keyframes for a clear day.
const SKY_KEYS = [
  [0, C(0x04060f), C(0x0c1224)],
  [5, C(0x070b1c), C(0x1a2040)],
  [6.2, C(0x2d3a78), C(0xf2995a)],
  [8, C(0x3f7fd0), C(0xaed4f2)],
  [17, C(0x3a78cc), C(0xb8d8f0)],
  [19.3, C(0x35407a), C(0xf0864e)],
  [20.6, C(0x0c1230), C(0x2a2446)],
  [24, C(0x04060f), C(0x0c1224)],
];

function skyAt(hour, outTop, outHorizon) {
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    const [h0, t0, z0] = SKY_KEYS[i];
    const [h1, t1, z1] = SKY_KEYS[i + 1];
    if (hour >= h0 && hour <= h1) {
      const k = (hour - h0) / (h1 - h0);
      outTop.copy(t0).lerp(t1, k);
      outHorizon.copy(z0).lerp(z1, k);
      return;
    }
  }
}

const OVERCAST = C(0x7d8591);
const STORM = C(0x3a4150);

export class Sky {
  constructor(scene, casino) {
    this.scene = scene;
    this.casino = casino;
    this.inside = 1;
    this.weather = 'clear';
    this.wetness = 0;        // eases rain in and out
    this.flash = 0;
    this.nextFlash = 4;
    this.night = 0;

    this.top = new THREE.Color();
    this.horizon = new THREE.Color();

    // Gradient dome that follows the camera.
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vDir; void main(){ float h = clamp(vDir.y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.7)), 1.0); }',
      }),
    );
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(28, 24), new THREE.MeshBasicMaterial({ color: 0xfff1c4, fog: false }));
    this.moonDisc = new THREE.Mesh(new THREE.CircleGeometry(18, 24), new THREE.MeshBasicMaterial({ color: 0xdfe6ff, fog: false }));
    scene.add(this.sunDisc, this.moonDisc);

    // Stars.
    const starGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 900; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * 0.9 + 0.08;
      pts.push(Math.cos(u) * Math.cos(v) * 850, Math.sin(v) * 850, Math.sin(u) * Math.cos(v) * 850);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, fog: false }));
    scene.add(this.stars);

    // Outdoor lights; the casino's own lights are blended against these.
    this.sun = new THREE.DirectionalLight(0xfff2dc, 1.8);
    this.moon = new THREE.DirectionalLight(0x8fa4ff, 0.25);
    scene.add(this.sun, this.moon, this.sun.target, this.moon.target);

    // A drifting cloud layer, tinted by the sky, and a glare round the sun.
    const clouds = cloudTexture();
    // Fades to nothing towards its rim, so the layer has no visible edge and
    // never reaches the camera's far plane.
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, '#fff');
    gr.addColorStop(0.55, '#fff');
    gr.addColorStop(1, '#000');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(1800, 1800),
      new THREE.MeshBasicMaterial({ map: clouds, alphaMap: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, fog: false, opacity: 0.8 }),
    );
    this.clouds.rotation.x = Math.PI / 2;
    this.clouds.renderOrder = -9;
    scene.add(this.clouds);
    this.glare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xfff0c0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    this.glare.scale.set(320, 320, 1);
    scene.add(this.glare);

    this._rain(scene);
  }

  _rain(scene) {
    const N = 2400;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 6);
    this.drops = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * 80;
      this.drops[i * 3 + 1] = Math.random() * 40;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaec4dd, transparent: true, opacity: 0 }));
    this.rain.frustumCulled = false;
    scene.add(this.rain);
  }

  setWeather(w) { this.weather = w; }

  /** worldTime in ms; camera for positioning the dome and the rain. */
  update(dt, worldTime, camera, insideCasino) {
    const hour = ((worldTime % DAY_MS) + DAY_MS) % DAY_MS / DAY_MS * 24;
    this.inside += ((insideCasino ? 1 : 0) - this.inside) * Math.min(1, dt * 4);
    const k = this.inside;

    const raining = this.weather === 'rain' || this.weather === 'storm';
    this.wetness += ((raining ? 1 : 0) - this.wetness) * Math.min(1, dt * 0.5);
    const grey = this.weather === 'storm' ? 0.85 : this.weather === 'rain' ? 0.65 : this.weather === 'cloudy' ? 0.4 : 0;
    this.grey = (this.grey || 0) + (grey - (this.grey || 0)) * Math.min(1, dt * 0.4);

    // Sky colours.
    skyAt(hour, this.top, this.horizon);
    const dayness = Math.max(0, Math.min(1, (this.top.r + this.top.g + this.top.b) / 1.4));
    const cloud = (this.weather === 'storm' ? STORM : OVERCAST).clone().multiplyScalar(0.25 + dayness * 0.75);
    this.top.lerp(cloud, this.grey);
    this.horizon.lerp(cloud, this.grey * 0.9);
    this.dome.material.uniforms.top.value.copy(this.top);
    this.dome.material.uniforms.horizon.value.copy(this.horizon);
    this.dome.position.copy(camera.position);
    this.stars.position.copy(camera.position);

    // Sun rises in the east (+x) at 6 and sets in the west at 20.
    const sunA = ((hour - 6) / 14) * Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(sunA), Math.sin(sunA), 0.35).normalize();
    const moonA = ((hour + 24 - 19) % 24) / 12 * Math.PI;
    const moonDir = new THREE.Vector3(Math.cos(moonA), Math.sin(moonA), -0.3).normalize();
    this.sunDisc.position.copy(camera.position).addScaledVector(sunDir, 800);
    this.sunDisc.lookAt(camera.position);
    this.sunDisc.visible = sunDir.y > -0.05 && this.grey < 0.6;
    this.moonDisc.position.copy(camera.position).addScaledVector(moonDir, 800);
    this.moonDisc.lookAt(camera.position);
    this.moonDisc.visible = moonDir.y > -0.05 && this.grey < 0.6;

    const sunUp = Math.max(0, Math.min(1, sunDir.y * 3));

    // Clouds drift with the camera, lit by the sky: white by day, orange at dusk.
    this.clouds.position.set(camera.position.x, camera.position.y + 260, camera.position.z);
    const cm = this.clouds.material;
    cm.map.offset.set((camera.position.x / 1800) * 3 + worldTime * 1e-6, (camera.position.z / 1800) * -3);
    cm.color.copy(this.horizon).lerp(C(0xffffff), 0.55 * (1 - this.night));
    cm.opacity = 0.35 + this.grey * 0.6;
    this.glare.position.copy(camera.position).addScaledVector(sunDir, 780);
    this.glare.material.opacity = sunDir.y > -0.05 ? (0.55 - this.grey * 0.5) * Math.min(1, (sunDir.y + 0.05) * 6) : 0;
    this.glare.material.color.setHSL(0.1, 0.7, 0.6 + sunUp * 0.25);
    this.night = 1 - Math.max(0, Math.min(1, (sunDir.y + 0.08) * 5));
    this.stars.material.opacity = this.night * (1 - this.grey);

    // Directional lights. Neither shines into the casino.
    this.sun.position.copy(camera.position).addScaledVector(sunDir, 100);
    this.sun.target.position.copy(camera.position);
    this.sun.intensity = sunUp * (1.9 - this.grey * 1.2) * (1 - k);
    this.sun.color.setHSL(0.1, 0.6, 0.55 + sunUp * 0.4);
    this.moon.position.copy(camera.position).addScaledVector(moonDir, 100);
    this.moon.target.position.copy(camera.position);
    this.moon.intensity = Math.max(0, moonDir.y) * 0.35 * (1 - k) * (1 - this.grey * 0.6);

    // Ambient: outdoors follows the sky; indoors is the casino's own mood.
    const outAmb = lerp(0.28, 0.95, 1 - this.night) * (1 - this.grey * 0.3);
    const flash = this.flash;
    const amb = this.casino.ambient;
    amb.intensity = lerp(outAmb, 1.15, k) + flash * 2.5 * (1 - k);
    amb.color.copy(this.horizon).lerp(C(0xffffff), 0.45).lerp(C(0x7a5666), k);
    const hemi = this.casino.hemi;
    hemi.intensity = lerp(0.6, 0.5, k);
    hemi.color.copy(this.top).lerp(C(0xffffff), 0.3).lerp(C(0xffd9a0), k);
    hemi.groundColor.set(0x3a4a2a).lerp(C(0x30121f), k);
    for (const l of this.casino.indoorLights) l.intensity = 0.5 * k;

    // Background and fog.
    const fogNear = lerp(raining ? 50 : 140, 45, k);
    const fogFar = lerp(raining ? 260 : 620, 120, k);
    this.scene.fog.near = fogNear;
    this.scene.fog.far = fogFar;
    this.scene.fog.color.copy(this.horizon).lerp(C(0x140b1c), k);
    this.scene.background.copy(this.horizon);

    this._updateRain(dt, camera, k);
    this._updateLightning(dt, k);
  }

  _updateRain(dt, camera, k) {
    const wet = this.wetness * (1 - k);
    this.rain.material.opacity = wet * 0.55;
    this.rain.visible = wet > 0.02;
    if (!this.rain.visible) return;
    const pos = this.rain.geometry.attributes.position.array;
    const d = this.drops;
    const cx = camera.position.x;
    const cz = camera.position.z;
    const fall = (this.weather === 'storm' ? 34 : 26) * dt;
    for (let i = 0; i < d.length / 3; i++) {
      d[i * 3 + 1] -= fall;
      if (d[i * 3 + 1] < 0) {
        d[i * 3 + 1] += 40;
        d[i * 3] = (Math.random() - 0.5) * 80;
        d[i * 3 + 2] = (Math.random() - 0.5) * 80;
      }
      const x = cx + d[i * 3];
      const y = d[i * 3 + 1];
      const z = cz + d[i * 3 + 2];
      pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z;
      pos[i * 6 + 3] = x + 0.08; pos[i * 6 + 4] = y + 0.9; pos[i * 6 + 5] = z;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  _updateLightning(dt, k) {
    this.flash = Math.max(0, this.flash - dt * 4);
    if (this.weather !== 'storm') return;
    this.nextFlash -= dt;
    if (this.nextFlash <= 0) {
      this.nextFlash = 5 + Math.random() * 12;
      this.flash = 1;
      if (this.onThunder && k < 0.5) this.onThunder();
    }
  }
}
