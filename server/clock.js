import { DAY_MS, HOUR_MS } from '../shared/catalog.js';
import { rnd } from './rng.js';

// World time. It only moves while the server is running, so switching the host
// off freezes every field exactly where it was.

const WEATHER_SPELL = 3 * HOUR_MS;

// Markov chain: weather drifts rather than flipping at random.
const NEXT = {
  clear:  [['clear', 0.6], ['cloudy', 0.3], ['rain', 0.1]],
  cloudy: [['clear', 0.35], ['cloudy', 0.3], ['rain', 0.28], ['storm', 0.07]],
  rain:   [['clear', 0.15], ['cloudy', 0.4], ['rain', 0.33], ['storm', 0.12]],
  storm:  [['cloudy', 0.4], ['rain', 0.6]],
};

export class Clock {
  constructor(saved, scale = 1) {
    this.time = saved && Number.isFinite(saved.time) ? saved.time : 7 * HOUR_MS;   // day 1, 7am
    this.weather = (saved && saved.weather) || 'clear';
    this.weatherUntil = saved && Number.isFinite(saved.weatherUntil) ? saved.weatherUntil : this.time + WEATHER_SPELL;
    this.scale = scale;
    this.lastReal = Date.now();
  }

  get day() { return Math.floor(this.time / DAY_MS) + 1; }
  get hour() { return (this.time % DAY_MS) / HOUR_MS; }

  /** Moves time on. Returns what changed so the room can react to it. */
  advance(nowReal = Date.now()) {
    const before = this.time;
    this.time += Math.max(0, nowReal - this.lastReal) * this.scale;
    this.lastReal = nowReal;

    const changes = { newDay: Math.floor(this.time / DAY_MS) > Math.floor(before / DAY_MS), weather: null };
    if (this.time >= this.weatherUntil) {
      const prev = this.weather;
      this.weather = this._roll(prev);
      this.weatherUntil = this.time + WEATHER_SPELL * (0.6 + rnd() * 0.8);
      if (this.weather !== prev) changes.weather = this.weather;
    }
    return changes;
  }

  _roll(from) {
    let r = rnd();
    for (const [to, p] of NEXT[from] || NEXT.clear) {
      r -= p;
      if (r <= 0) return to;
    }
    return 'clear';
  }

  get raining() { return this.weather === 'rain' || this.weather === 'storm'; }

  state() {
    return { time: this.time, rate: this.scale, serverNow: Date.now(), weather: this.weather };
  }

  toSave() {
    return { time: this.time, weather: this.weather, weatherUntil: this.weatherUntil };
  }
}
