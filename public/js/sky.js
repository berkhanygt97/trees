import * as THREE from 'three';
import { DAY_MS } from '/shared/catalog.js';
import { createSkyMaterial, hazeAt, sunColorAt, FOG } from './gfx/atmosphere.js';

// Sun, moon, stars, clouds, rain and lightning. Also decides how the scene is
// lit: outdoors follows the time of day, and stepping into the casino fades
// over to the casino's own warm lighting (there is no night inside a casino).
// The sky itself is one shader (gfx/atmosphere.js); this file drives it.

const lerp = (a, b, t) => a + (b - a) * t;
const C = (hex) => new THREE.Color(hex);

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpCol = new THREE.Color();

// How cloudy each kind of weather is, and how thick the air gets.
const COVER = { clear: 0.3, cloudy: 0.62, rain: 0.86, storm: 0.95 };
const DENSITY = { clear: 0.0009, cloudy: 0.0013, rain: 0.0045, storm: 0.0065 };

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
    this.dusk = 0;
    this.grey = 0;
    this.cover = COVER.clear;
    this.density = DENSITY.clear;
    this.viewFar = 900;      // set by the graphics preset
    this.drawFar = 900;
    this.shadowR = 55;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.sunColor = new THREE.Color(1, 1, 1);
    this.haze = new THREE.Color();
    this.hazeSun = new THREE.Color();

    // One sky shader on a box round the camera, drawn behind everything.
    this.material = createSkyMaterial();
    this.dome = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    scene.fog = new THREE.FogExp2(0x9aa8b8, this.density);

    // Outdoor lights; the casino's own lights are blended against these.
    this.sun = new THREE.DirectionalLight(0xfff2dc, 2.5);
    this.moon = new THREE.DirectionalLight(0x8fa4ff, 0.25);
    // The sun's shadows cover the ground round you (`focus`, set by main),
    // not the whole valley: sharp where you are looking, free further out.
    this.focus = null;
    this._shadowSpan(this.shadowR);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.moon, this.sun.target, this.moon.target);

    this._rain(scene);
  }

  _shadowSpan(r) {
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -r;
    sc.right = sc.top = r;
    sc.near = 1;
    sc.far = 500;
    sc.updateProjectionMatrix();
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

  /** From the graphics preset: how far you can see, and whether there are clouds. */
  setView({ far, clouds }) {
    this.viewFar = far;
    this.material.uniforms.cloudsOn.value = clouds ? 1 : 0;
  }

  /** worldTime in ms; camera for positioning the sky and the rain. */
  update(dt, worldTime, camera, insideCasino) {
    const hour = ((worldTime % DAY_MS) + DAY_MS) % DAY_MS / DAY_MS * 24;
    this.inside += ((insideCasino ? 1 : 0) - this.inside) * Math.min(1, dt * 4);
    const k = this.inside;
    const ease = Math.min(1, dt * 0.4);

    const raining = this.weather === 'rain' || this.weather === 'storm';
    this.wetness += ((raining ? 1 : 0) - this.wetness) * Math.min(1, dt * 0.5);
    const grey = this.weather === 'storm' ? 0.85 : this.weather === 'rain' ? 0.62 : this.weather === 'cloudy' ? 0.3 : 0;
    this.grey += (grey - this.grey) * ease;
    this.cover += ((COVER[this.weather] ?? COVER.clear) - this.cover) * ease;
    this.density += ((DENSITY[this.weather] ?? DENSITY.clear) - this.density) * ease;

    // Sun rises in the east (+x) at 6 and sets in the west at 20.
    const sunA = ((hour - 6) / 14) * Math.PI;
    const sunDir = this.sunDir.set(Math.cos(sunA), Math.sin(sunA), 0.35).normalize();
    const moonA = ((hour + 24 - 19) % 24) / 12 * Math.PI;
    const moonDir = this.moonDir.set(Math.cos(moonA), Math.sin(moonA), -0.3).normalize();
    const sunUp = Math.max(0, Math.min(1, sunDir.y * 3));
    this.night = 1 - Math.max(0, Math.min(1, (sunDir.y + 0.08) * 5));
    // Golden hour, for the colour grade: strongest around 7pm (and 6am).
    this.dusk = Math.max(0, 1 - Math.abs(hour - 19.2) / 1.6, 1 - Math.abs(hour - 6.3) / 1.2) * (1 - this.grey);
    const dayL = Math.max(0, Math.min(1, sunDir.y * 4 + 0.3));

    // The air, the sun and the clouds.
    hazeAt(sunDir.y, this.grey, this.haze, this.hazeSun);
    sunColorAt(sunDir.y, this.sunColor);
    const u = this.material.uniforms;
    u.sunDir.value.copy(sunDir);
    u.moonDir.value.copy(moonDir);
    u.night.value = this.night;
    u.dusk.value = this.dusk;
    u.grey.value = this.grey;
    u.cloudCover.value = this.cover;
    u.cloudTime.value = (worldTime / 1000) % 100000;
    u.haze.value.copy(this.haze);
    u.hazeSun.value.copy(this.hazeSun);
    const storm = this.weather === 'storm' ? 1 : 0;
    u.overcast.value.setRGB(0.4, 0.42, 0.46).multiplyScalar(dayL * (1 - 0.4 * storm) + 0.02);
    u.cloudSun.value.copy(this.sunColor).multiplyScalar(sunUp * 1.1 * (1 - this.grey * 0.5)).add(tmpCol.setRGB(0.02, 0.025, 0.04).multiplyScalar(this.night));
    u.cloudShade.value.setRGB(0.36, 0.4, 0.48).multiplyScalar(dayL * (1 - 0.35 * this.grey)).add(tmpCol.setRGB(0.008, 0.01, 0.018));
    u.ground.value.setRGB(0.2, 0.19, 0.15).multiply(tmpCol.copy(this.sunColor).multiplyScalar(sunUp * 0.9).add(this.haze));

    // The sky box sits round the camera; it is drawn at the far plane whatever its size.
    this.dome.position.copy(camera.position);
    this.dome.scale.setScalar(100);

    // Directional lights. Neither shines into the casino.
    this._placeSun(sunDir, this.focus || camera.position);
    this.sun.intensity = sunUp * (3.2 - this.grey * 2.4) * (1 - k);
    this.sun.color.copy(this.sunColor);
    this.moon.position.copy(camera.position).addScaledVector(moonDir, 100);
    this.moon.target.position.copy(camera.position);
    this.moon.intensity = Math.max(0, moonDir.y) * 0.3 * (1 - k) * (1 - this.grey * 0.6);

    // Ambient: outdoors, the sky's own light (bluish by day, deep blue at
    // night); indoors, the casino's mood. Overcast days fill in: no sun, soft light.
    // By day most of the fill now comes from the sky itself (the environment
    // map every material sees), so the flat ambient only tops it up; at night
    // the sky is nearly black and the ambient carries the moonlight.
    const envShare = lerp(0.28, 1, this.night);
    const outAmb = lerp(0.3, lerp(0.55, 1.0, this.grey), 1 - this.night) * (1 - this.grey * 0.25) * envShare;
    const amb = this.casino.ambient;
    amb.intensity = lerp(outAmb, 0.7, k) + this.flash * 2.5 * (1 - k);
    amb.color.copy(this.haze).lerp(C(0xffffff), 0.35).lerp(C(0x7a5666), k);
    if (this.night > 0.5) amb.color.lerp(C(0x4a5a8a), (this.night - 0.5) * 2 * (1 - k));
    const hemi = this.casino.hemi;
    hemi.intensity = lerp(0.7 * envShare, 0.35, k);
    hemi.color.copy(this.haze).lerp(C(0x9ab8e8), 0.4 * (1 - this.grey)).lerp(C(0xffd9a0), k);
    hemi.groundColor.set(0x4a4432).multiplyScalar(0.4 + 0.6 * dayL).lerp(C(0x30121f), k);
    for (const l of this.casino.indoorLights) l.intensity = 0.5 * k;

    // Fog: thick in the rain, thin up in the hills, glowing towards the sun.
    const fog = this.scene.fog;
    fog.density = lerp(this.density, 0.0008, k);
    fog.color.copy(this.haze).lerp(C(0x140b1c), k);
    FOG.fogSunDir.value.copy(sunDir);
    FOG.fogSunColor.value.copy(this.hazeSun).lerp(C(0x140b1c), k);
    FOG.fogFalloff.value = raining ? 0.0015 : 0.0028;
    FOG.fogBase.value = 0;
    this.scene.background.copy(this.haze);
    // The camera draws no further than you can see through the air (read by main).
    this.drawFar = lerp(Math.min(this.viewFar, raining ? 520 : this.viewFar), 160, k);
    FOG.fogEnd.value = this.drawFar;

    this._updateRain(dt, camera, k);
    this._updateLightning(dt, k);
  }

  /** Sun shadows: map size in texels (0 = off) and the width of ground they cover. */
  setShadows(size, span = 110) {
    const on = size > 0;
    this.sun.castShadow = on;
    this.shadowR = Math.max(10, span / 2);
    this._shadowSpan(this.shadowR);
    if (on && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  }

  _placeSun(sunDir, focus) {
    // Snap the shadow camera to whole shadow-map texels, so the shadows
    // do not crawl as you walk.
    const texel = (this.shadowR * 2) / this.sun.shadow.mapSize.x;
    const fwd = tmpA.copy(sunDir).negate();
    const right = tmpB.crossVectors(fwd, UP);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = tmpC.crossVectors(right, fwd);
    const a = Math.round(focus.dot(right) / texel) * texel;
    const b = Math.round(focus.dot(up) / texel) * texel;
    const c = focus.dot(fwd);
    const centre = tmpD.copy(right).multiplyScalar(a).addScaledVector(up, b).addScaledVector(fwd, c);
    this.sun.target.position.copy(centre);
    this.sun.position.copy(centre).addScaledVector(sunDir, 250);
    // Below the horizon, or indoors, there is nothing to cast: skip drawing the map.
    this.sun.shadow.autoUpdate = sunDir.y > 0.02 && this.inside < 0.5;
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
