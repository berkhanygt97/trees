import * as THREE from 'three';

// A handful of real point lights, handed out every frame to whichever light
// sources are nearest the camera: the casino chandeliers, the street lamps
// after dark, your headlights. Every material in the game is shaded for
// exactly this many lights, always, so walking into the casino or night
// falling never makes the shaders recompile (and never stutters), and the
// cost of lighting stays the same everywhere.
//
// A source: { x, y, z, color, intensity (candela), range, night (only after
// dark), inside (only near the casino), priority }.

const POOL = 6;

export class LightPool {
  constructor(scene, size = POOL) {
    this.scene = scene;
    this.lights = [];
    this.resize(size);
    this.sources = [];
    this.picked = [];
    this.cutoff = Infinity;
    this.frame = 0;
  }

  /**
   * How many real lights there are (the graphics preset decides). Changing it
   * makes every lit shader rebuild once, so it only happens with the preset.
   */
  resize(size) {
    while (this.lights.length > size) {
      const l = this.lights.pop();
      this.scene.remove(l);
      l.dispose();
    }
    while (this.lights.length < size) {
      const l = new THREE.PointLight(0xffffff, 0, 20, 2);
      l.position.set(0, -100, 0);
      this.scene.add(l);
      this.lights.push(l);
    }
    this.frame = 0;
  }

  /** Adds light sources; returns them (their intensity can be changed later). */
  add(list) {
    for (const s of list) {
      s.color = s.color instanceof THREE.Color ? s.color : new THREE.Color(s.color ?? 0xffffff);
      s.base = s.intensity;
      this.sources.push(s);
    }
    return list;
  }

  remove(list) {
    const gone = new Set(list);
    this.sources = this.sources.filter((s) => !gone.has(s));
    this.picked = this.picked.filter((s) => !gone.has(s));
  }

  /** `at` = the camera; `night` 0..1; `inside` 0..1 (in the casino). */
  update(at, night, inside) {
    const active = (s) => (s.night ? night > 0.2 : true) && (s.inside ? true : inside < 0.9) && s.intensity > 0;
    // Re-pick a few times a second: the nearest (priority first).
    if (this.frame++ % 8 === 0) {
      const scored = [];
      for (const s of this.sources) {
        if (!active(s)) continue;
        const d = Math.hypot(s.x - at.x, s.y - at.y, s.z - at.z) - (s.priority || 0);
        if (d - s.range > 60) continue;
        scored.push([d, s]);
      }
      scored.sort((a, b) => a[0] - b[0]);
      this.picked = scored.slice(0, this.lights.length).map((e) => e[1]);
      // Lights near the edge of the chosen set fade out before they are swapped.
      this.cutoff = scored.length > this.lights.length ? scored[this.lights.length][0] : Infinity;
    }
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const s = this.picked[i];
      if (!s || !active(s)) { l.intensity = 0; continue; }
      const d = Math.hypot(s.x - at.x, s.y - at.y, s.z - at.z) - (s.priority || 0);
      const edge = Math.min(1, Math.max(0, (this.cutoff - d) / 12));
      const dark = s.night ? Math.min(1, (night - 0.2) / 0.3) : 1;
      l.position.set(s.x, s.y, s.z);
      l.color.copy(s.color);
      l.distance = s.range;
      l.intensity = s.intensity * edge * dark;
    }
  }
}
