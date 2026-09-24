// F3: frames per second, draw calls and triangles, for keeping an eye on old
// laptops. Counts every pass of a frame (world, hands overlay, post), so the
// numbers are the real cost, not just the last pass.
export class PerfMeter {
  constructor(renderer) {
    this.renderer = renderer;
    renderer.info.autoReset = false;
    this.el = null;
    this.frames = 0;
    this.acc = 0;
    this.fps = 0;
    this.calls = 0;
    this.tris = 0;
    this.worst = 0;
  }

  begin() { this.renderer.info.reset(); }

  end(dt) {
    const r = this.renderer.info.render;
    this.calls = r.calls;
    this.tris = r.triangles;
    this.frames++;
    this.acc += dt;
    this.worst = Math.max(this.worst, dt);
    if (this.acc >= 0.5) {
      this.fps = Math.round(this.frames / this.acc);
      if (this.el) {
        const m = this.renderer.info.memory;
        this.el.textContent = `${this.fps} fps · worst ${Math.round(this.worst * 1000)} ms\n`
          + `${this.calls} draw calls · ${(this.tris / 1000).toFixed(0)}k tris\n`
          + `${m.geometries} geometries · ${m.textures} textures`;
      }
      this.frames = 0;
      this.acc = 0;
      this.worst = 0;
    }
  }

  toggle() {
    if (this.el) { this.el.remove(); this.el = null; return false; }
    this.el = document.createElement('pre');
    this.el.id = 'perf';
    this.el.style.cssText = 'position:fixed;left:8px;top:50%;margin:0;padding:6px 8px;background:rgba(0,0,0,.6);'
      + 'color:#9f9;font:12px/1.35 monospace;z-index:50;pointer-events:none;white-space:pre';
    document.body.appendChild(this.el);
    return true;
  }

  stats() { return { fps: this.fps, calls: this.calls, tris: this.tris }; }
}
