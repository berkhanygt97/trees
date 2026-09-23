// Every sound is synthesised on the fly — no asset files to download over the LAN.
let ctx = null;
let master = null;
let muted = false;

function ensure() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.32;
  master.connect(ctx.destination);
  return ctx;
}

function tone({ freq = 440, type = 'sine', dur = 0.14, gain = 0.5, slide = 0, delay = 0 }) {
  if (muted) return;
  const c = ensure();
  if (c.state === 'suspended') c.resume();
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise({ dur = 0.2, gain = 0.3, delay = 0, bandpass = 1200 }) {
  if (muted) return;
  const c = ensure();
  if (c.state === 'suspended') c.resume();
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = bandpass;
  const env = c.createGain();
  env.gain.value = gain;
  src.connect(filt).connect(env).connect(master);
  src.start(c.currentTime + delay);
}

// A running engine: two detuned oscillators through a low-pass, pitched by speed.
let engine = null;

export const sfx = {
  engineStart(heavy = false) {
    if (muted || engine) return;
    const c = ensure();
    if (c.state === 'suspended') c.resume();
    const a = c.createOscillator();
    const b = c.createOscillator();
    a.type = 'sawtooth';
    b.type = 'square';
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = heavy ? 420 : 700;
    const env = c.createGain();
    env.gain.value = 0.0001;
    env.gain.exponentialRampToValueAtTime(heavy ? 0.13 : 0.1, c.currentTime + 0.3);
    a.connect(filt);
    b.connect(filt);
    filt.connect(env).connect(master);
    a.start();
    b.start();
    engine = { a, b, env, filt, base: heavy ? 32 : 48 };
    this.engineSpeed(0);
  },
  engineSpeed(frac) {
    if (!engine) return;
    const f = engine.base * (1 + Math.min(1.4, Math.abs(frac)) * 2.2);
    const t = ctx.currentTime;
    engine.a.frequency.setTargetAtTime(f, t, 0.08);
    engine.b.frequency.setTargetAtTime(f * 1.01 * 0.5, t, 0.08);
  },
  engineStop() {
    if (!engine) return;
    const { a, b, env } = engine;
    const t = ctx.currentTime;
    env.gain.setTargetAtTime(0.0001, t, 0.08);
    a.stop(t + 0.4);
    b.stop(t + 0.4);
    engine = null;
  },

  unlock() { ensure(); if (ctx.state === 'suspended') ctx.resume(); },
  toggleMute() { muted = !muted; if (muted) this.engineStop(); return muted; },
  isMuted() { return muted; },

  click() { tone({ freq: 520, type: 'square', dur: 0.05, gain: 0.18 }); },
  chip() { noise({ dur: 0.09, gain: 0.25, bandpass: 2600 }); tone({ freq: 880, type: 'triangle', dur: 0.06, gain: 0.12 }); },
  deny() { tone({ freq: 180, type: 'sawtooth', dur: 0.18, gain: 0.22, slide: -80 }); },

  reel(i) { tone({ freq: 300 + i * 60, type: 'square', dur: 0.06, gain: 0.16, delay: i * 0.05 }); },
  win(size = 1) {
    const notes = [523, 659, 784, 1046];
    notes.slice(0, Math.min(4, 1 + size)).forEach((f, i) =>
      tone({ freq: f, type: 'triangle', dur: 0.22, gain: 0.3, delay: i * 0.07 }));
  },
  jackpot() {
    [523, 659, 784, 1046, 1318, 1568].forEach((f, i) =>
      tone({ freq: f, type: 'square', dur: 0.3, gain: 0.26, delay: i * 0.08 }));
    noise({ dur: 0.9, gain: 0.18, bandpass: 4200, delay: 0.1 });
  },
  lose() { tone({ freq: 260, type: 'sine', dur: 0.26, gain: 0.2, slide: -120 }); },

  spinWheel() { noise({ dur: 1.2, gain: 0.1, bandpass: 900 }); },
  tick() { tone({ freq: 1400, type: 'square', dur: 0.02, gain: 0.07 }); },
  launch() { tone({ freq: 120, type: 'sawtooth', dur: 0.8, gain: 0.16, slide: 700 }); },
  explode() { noise({ dur: 0.7, gain: 0.4, bandpass: 380 }); tone({ freq: 90, type: 'sawtooth', dur: 0.5, gain: 0.25, slide: -60 }); },
  /** Your rocket dying just after you got out. */
  nearMiss() {
    tone({ freq: 660, type: 'triangle', dur: 0.1, gain: 0.2 });
    tone({ freq: 990, type: 'triangle', dur: 0.14, gain: 0.18, delay: 0.1 });
  },
  card() { noise({ dur: 0.06, gain: 0.16, bandpass: 3200 }); },
  gallop() { noise({ dur: 0.05, gain: 0.07, bandpass: 300 }); },
  fanfare() {
    [392, 523, 659, 784, 1046].forEach((f, i) =>
      tone({ freq: f, type: 'triangle', dur: 0.45, gain: 0.3, delay: i * 0.12 }));
  },
  alarm() {
    for (let i = 0; i < 3; i++) tone({ freq: 740, type: 'square', dur: 0.14, gain: 0.2, delay: i * 0.2 });
  },
  step() { noise({ dur: 0.04, gain: 0.04, bandpass: 420 }); },
};
