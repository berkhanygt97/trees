// Graphics settings: four presets and Auto, plus dynamic resolution on top.
//
// Auto starts on High and steps down a preset when the game cannot hold about
// 45 fps even at the lowest render scale; it never steps back up in the same
// session, so it does not flip-flop. Dynamic resolution then keeps the frame
// rate near 58 by drawing the 3D world a little smaller (never below the
// preset's floor) and sharpening it back up to the screen.
//
// A preset only changes things that are cheap to change at runtime, except
// the number of lights and shadows, which make the shaders rebuild once.

export const PRESETS = {
  ultra: {
    id: 'ultra', name: 'Ultra', pixelRatio: 1.5, maxScale: 1, minScale: 0.7,
    shadows: 4096, shadowSpan: 160, ao: true, aoSamples: 16, bloom: true, aa: 'smaa', shafts: true,
    lights: 8, clouds: true, envSize: 128,
  },
  high: {
    id: 'high', name: 'High', pixelRatio: 1, maxScale: 1, minScale: 0.65,
    shadows: 2048, shadowSpan: 110, ao: true, aoSamples: 12, bloom: true, aa: 'smaa', shafts: false,
    lights: 4, clouds: true, envSize: 64,
  },
  medium: {
    id: 'medium', name: 'Medium', pixelRatio: 1, maxScale: 0.9, minScale: 0.6,
    shadows: 1024, shadowSpan: 70, ao: false, aoSamples: 0, bloom: true, aa: 'fxaa', shafts: false,
    lights: 2, clouds: true, envSize: 32,
  },
  low: {
    id: 'low', name: 'Low', pixelRatio: 1, maxScale: 0.8, minScale: 0.55,
    shadows: 0, shadowSpan: 0, ao: false, aoSamples: 0, bloom: false, aa: 'none', shafts: false,
    lights: 0, clouds: false, envSize: 16,
  },
};
const ORDER = ['ultra', 'high', 'medium', 'low'];
const CHOICES = ['auto', ...ORDER];

const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private window */ } };

export class Quality {
  constructor() {
    // Anything saved by an older version ('ps2', 'sharp', 'fast') becomes Auto.
    const saved = read('valley.gfx', 'auto');
    this.choice = CHOICES.includes(saved) ? saved : 'auto';
    this.preset = PRESETS[this.choice === 'auto' ? 'high' : this.choice];
    this.dynamic = read('valley.dynres', '1') !== '0';
    this.scale = this.preset.maxScale;
    this.onChange = null;          // (preset) => void, when the preset changes
    this._samples = [];
    this._judgeAt = 8;             // seconds of play before Auto judges
    this._t = 0;
    this._adjustIn = 1;
    this._raiseHold = 0;
  }

  get label() { return this.choice === 'auto' ? `Auto (${this.preset.name})` : this.preset.name; }

  /** P: Auto → Ultra → High → Medium → Low → Auto. */
  cycle() {
    this.choice = CHOICES[(CHOICES.indexOf(this.choice) + 1) % CHOICES.length];
    write('valley.gfx', this.choice);
    this._set(PRESETS[this.choice === 'auto' ? 'high' : this.choice]);
    this._samples = [];
    this._t = 0;
    return this.label;
  }

  _set(preset) {
    const changed = preset !== this.preset;
    this.preset = preset;
    this.scale = Math.min(Math.max(this.scale, preset.minScale), preset.maxScale);
    if (changed && this.onChange) this.onChange(preset);
    else if (this.onScale) this.onScale(this.scale);
  }

  /**
   * Called every frame with the real frame time (seconds), while playing.
   * Returns true when the render scale changed (the pipeline resizes).
   */
  frame(dt) {
    if (!(dt > 0) || dt > 0.5) return false;       // a tab switch or a load hitch, not a real frame
    this._t += dt;
    this._samples.push(dt);
    if (this._samples.length > 240) this._samples.shift();

    // Auto: once enough play has been seen, drop a preset if even the
    // smallest render scale cannot hold ~45 fps.
    if (this.choice === 'auto' && this._t > this._judgeAt && this._samples.length > 90) {
      const med = median(this._samples);
      const floor = !this.dynamic || this.scale <= this.preset.minScale + 0.001;
      if (med > 1 / 45 && floor) {
        const next = ORDER[ORDER.indexOf(this.preset.id) + 1];
        if (next) {
          this._set(PRESETS[next]);
          this.scale = this.preset.maxScale;
          this._samples = [];
          this._t = 0;
          return true;
        }
      }
    }

    // Dynamic resolution, a couple of times a second.
    if (!this.dynamic) return false;
    this._adjustIn -= dt;
    if (this._adjustIn > 0) return false;
    this._adjustIn = 0.5;
    const recent = this._samples.slice(-30);
    const ms = median(recent) * 1000;
    const before = this.scale;
    if (ms > 18.2) {
      // Too slow: shrink, harder the further off it is.
      this.scale = Math.max(this.preset.minScale, this.scale - (ms > 24 ? 0.1 : 0.05));
      this._raiseHold = 3;
    } else if (ms < 17.4) {
      // Holding the refresh rate: grow back slowly, after a pause.
      this._raiseHold -= 0.5;
      if (this._raiseHold <= 0) this.scale = Math.min(this.preset.maxScale, this.scale + 0.05);
    }
    return this.scale !== before;
  }
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1] || 0;
}
