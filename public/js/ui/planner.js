import { money } from '/shared/catalog.js';
import {
  PLOT_SIZE, PADS, PAD_KEYS, GATE, GATE_LANE, FIELD_MAX_M, TILE,
  defaultLayout, validateLayout, padWorld,
} from '/shared/map.js';
import { div, esc } from './util.js';
import { sfx } from '../sfx.js';

// The farm planner: a blueprint of your plot, seen from above. Drag a
// building (or the field) to move it, R or the button to turn it. Everything
// snaps to a 1 m grid and turns red where the server would refuse it.

const LABEL = {
  house: ['🏠', 'House'], coop: ['🐔', 'Coop'], barn: ['🐄', 'Barn'], mill: ['🌬️', 'Mill'],
  dairy: ['🧀', 'Dairy'], bakery: ['🥖', 'Bakery'], bin: ['📦', 'Bin'], pen: ['🐂', 'Cattle pen'], field: ['🌾', 'Field'],
};
const FEE = 100;
const SCALE = 7;             // canvas pixels per metre
const PAD = 14;              // canvas margin in pixels

const clone = (l) => JSON.parse(JSON.stringify(l));

export function createPlanner(ctx) {
  const plot = ctx.myPlot;
  const saved = clone((plot && plot.layout) || defaultLayout());
  let layout = clone(saved);
  let selected = 'house';
  let drag = null;

  const root = div(`
    <p class="shop-note">Drag a building to move it; <kbd>R</kbd> turns the selected one. The dashed
      square is as big as your field can ever grow, so keep it clear. The builders charge
      <b>${money(FEE)}</b> for each thing they move.</p>
    <div class="planner">
      <canvas width="${PLOT_SIZE * SCALE + PAD * 2}" height="${PLOT_SIZE * SCALE + PAD * 2}"></canvas>
      <div class="planner-side">
        <div class="planner-sel"></div>
        <div class="planner-msg"></div>
        <div class="planner-btns">
          <button class="bet" data-act="rotate">TURN ↻ (R)</button>
          <button class="bet" data-act="reset">DEFAULT LAYOUT</button>
          <button class="bet" data-act="undo">UNDO CHANGES</button>
          <button class="bet primary" data-act="save">SAVE LAYOUT</button>
        </div>
      </div>
    </div>`);
  const canvas = root.querySelector('canvas');
  const g = canvas.getContext('2d');
  const selEl = root.querySelector('.planner-sel');
  const msgEl = root.querySelector('.planner-msg');
  const saveBtn = root.querySelector('[data-act="save"]');

  const px = (m) => PAD + m * SCALE;
  const toM = (p) => (p - PAD) / SCALE;
  const built = () => {
    const b = ctx.wallet.buildings || {};
    return { house: true, bin: true, coop: !!b.coop, barn: !!b.barn, pen: !!b.pen, mill: !!b.mill, dairy: !!b.dairy, bakery: !!b.bakery };
  };

  function rectOf(id) {
    if (id === 'field') {
      const f = layout.field;
      return { x0: f.x, x1: f.x + FIELD_MAX_M, z0: f.z - FIELD_MAX_M, z1: f.z };
    }
    const w = padWorld({ x0: 0, z0: 0 }, id, layout);
    return { x0: w.x - w.w / 2, x1: w.x + w.w / 2, z0: w.z - w.d / 2, z1: w.z + w.d / 2, w };
  }

  function moved() {
    let n = 0;
    for (const k of PAD_KEYS) if (JSON.stringify(saved.pads[k]) !== JSON.stringify(layout.pads[k])) n++;
    if (saved.field.x !== layout.field.x || saved.field.z !== layout.field.z) n++;
    return n;
  }

  function draw() {
    const check = validateLayout(layout);
    const bad = new Set(check.bad);
    const has = built();
    g.fillStyle = '#16304a';
    g.fillRect(0, 0, canvas.width, canvas.height);
    // Blueprint grid: every metre, stronger every 10.
    for (let m = 0; m <= PLOT_SIZE; m++) {
      g.strokeStyle = m % 10 === 0 ? 'rgba(160,200,255,0.28)' : 'rgba(160,200,255,0.08)';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(px(m), px(0)); g.lineTo(px(m), px(PLOT_SIZE)); g.stroke();
      g.beginPath(); g.moveTo(px(0), px(m)); g.lineTo(px(PLOT_SIZE), px(m)); g.stroke();
    }
    // Fence, with the gate gap at the bottom (south).
    g.strokeStyle = '#e8d6a8';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(px(GATE[0]), px(PLOT_SIZE)); g.lineTo(px(0), px(PLOT_SIZE)); g.lineTo(px(0), px(0));
    g.lineTo(px(PLOT_SIZE), px(0)); g.lineTo(px(PLOT_SIZE), px(PLOT_SIZE)); g.lineTo(px(GATE[1]), px(PLOT_SIZE));
    g.stroke();
    // The gate lane stays clear.
    g.fillStyle = 'rgba(255,220,120,0.12)';
    g.fillRect(px(GATE_LANE.x0), px(GATE_LANE.z0), (GATE_LANE.x1 - GATE_LANE.x0) * SCALE, (GATE_LANE.z1 - GATE_LANE.z0) * SCALE);
    g.fillStyle = 'rgba(255,220,120,0.7)';
    g.font = 'bold 11px sans-serif';
    g.textAlign = 'center';
    g.fillText('GATE', px((GATE[0] + GATE[1]) / 2), px(PLOT_SIZE) - 6);

    // The field: its biggest possible size dashed, its current size filled.
    const fr = rectOf('field');
    const size = (ctx.wallet.fieldSize || 8) * TILE;
    g.fillStyle = bad.has('field') ? 'rgba(255,80,60,0.35)' : 'rgba(150,100,50,0.55)';
    g.fillRect(px(fr.x0), px(fr.z1 - size), size * SCALE, size * SCALE);
    g.setLineDash([6, 5]);
    g.strokeStyle = bad.has('field') ? '#ff6a5a' : selected === 'field' ? '#fff' : 'rgba(230,200,140,0.8)';
    g.lineWidth = selected === 'field' ? 2.5 : 1.5;
    g.strokeRect(px(fr.x0), px(fr.z0), FIELD_MAX_M * SCALE, FIELD_MAX_M * SCALE);
    g.setLineDash([]);
    g.fillStyle = '#f2e3c0';
    g.font = 'bold 13px sans-serif';
    g.fillText(`🌾 FIELD ${ctx.wallet.fieldSize}×${ctx.wallet.fieldSize}`, px(fr.x0) + size * SCALE / 2, px(fr.z1 - size / 2) + 4);

    // Buildings: solid if built, outlined if the spot is waiting for one.
    for (const k of PAD_KEYS) {
      const r = rectOf(k);
      const x = px(r.x0);
      const y = px(r.z0);
      const w = (r.x1 - r.x0) * SCALE;
      const h = (r.z1 - r.z0) * SCALE;
      const isBad = bad.has(k);
      g.fillStyle = isBad ? 'rgba(255,80,60,0.55)' : has[k] ? 'rgba(90,160,230,0.75)' : 'rgba(90,160,230,0.18)';
      g.fillRect(x, y, w, h);
      g.strokeStyle = selected === k ? '#ffffff' : isBad ? '#ff6a5a' : 'rgba(200,230,255,0.9)';
      g.lineWidth = selected === k ? 3 : 1.5;
      if (!has[k]) g.setLineDash([4, 3]);
      g.strokeRect(x, y, w, h);
      g.setLineDash([]);
      // Door: a notch on the side the building faces.
      const d = r.w.door;
      const cx = x + w / 2;
      const cy = y + h / 2;
      g.fillStyle = '#ffd24a';
      g.fillRect(cx + d[0] * (w / 2) - 5 + (d[0] ? -d[0] * 2 : 0), cy + d[1] * (h / 2) - 5 + (d[1] ? -d[1] * 2 : 0), 10, 10);
      g.fillStyle = '#fff';
      g.font = `${w > 40 ? 16 : 12}px sans-serif`;
      g.fillText(LABEL[k][0], cx, cy + 5);
    }

    // Side panel: what is selected and whether the layout will be accepted.
    const [icon, name] = LABEL[selected];
    selEl.innerHTML = `<div class="nm">${icon} ${esc(name)}${selected !== 'field' && !has[selected] ? ' <span class="muted">(not built yet)</span>' : ''}</div>
      <div class="ds">${selected === 'field' ? 'Moves the whole field, crops and all.' : `Facing ${['south', 'east', 'north', 'west'][layout.pads[selected].rot]}.`}</div>`;
    const n = moved();
    msgEl.className = `planner-msg ${check.ok ? '' : 'bad'}`;
    msgEl.textContent = !check.ok ? check.error : n ? `${n} change${n > 1 ? 's' : ''} · ${money(n * FEE)}` : 'No changes yet.';
    saveBtn.disabled = !check.ok || !n || ctx.wallet.money < n * FEE;
  }

  function hit(mx, mz) {
    // Buildings above the field, smallest first, so the bin is always grabbable.
    const order = [...PAD_KEYS].sort((a, b) => PADS[a].w * PADS[a].d - PADS[b].w * PADS[b].d);
    for (const k of order) {
      const r = rectOf(k);
      if (mx >= r.x0 && mx <= r.x1 && mz >= r.z0 && mz <= r.z1) return k;
    }
    const f = rectOf('field');
    if (mx >= f.x0 && mx <= f.x1 && mz >= f.z0 && mz <= f.z1) return 'field';
    return null;
  }

  const mouse = (e) => {
    const r = canvas.getBoundingClientRect();
    return [toM((e.clientX - r.left) * (canvas.width / r.width)), toM((e.clientY - r.top) * (canvas.height / r.height))];
  };

  canvas.addEventListener('mousedown', (e) => {
    const [mx, mz] = mouse(e);
    const k = hit(mx, mz);
    if (!k) return;
    selected = k;
    const base = k === 'field' ? layout.field : layout.pads[k];
    drag = { k, dx: base.x - mx, dz: base.z - mz };
    sfx.click();
    draw();
  });
  const onMove = (e) => {
    if (!drag) return;
    const [mx, mz] = mouse(e);
    const target = drag.k === 'field' ? layout.field : layout.pads[drag.k];
    // Buildings snap to half metres so odd-sized ones line up with the grid; the field to whole metres.
    const step = drag.k === 'field' ? 1 : 0.5;
    const nx = Math.round((mx + drag.dx) / step) * step;
    const nz = Math.round((mz + drag.dz) / step) * step;
    if (nx !== target.x || nz !== target.z) { target.x = nx; target.z = nz; draw(); }
  };
  const onUp = () => { drag = null; };
  addEventListener('mousemove', onMove);
  addEventListener('mouseup', onUp);

  function rotate() {
    if (selected === 'field') { ctx.toast('The field only moves; it does not turn.', 'info'); return; }
    const l = layout.pads[selected];
    l.rot = (l.rot + 1) % 4;
    sfx.click();
    draw();
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.disabled) { sfx.deny(); return; }
    const act = b.dataset.act;
    if (act === 'rotate') rotate();
    else if (act === 'reset') { layout = defaultLayout(); draw(); }
    else if (act === 'undo') { layout = clone(saved); draw(); }
    else if (act === 'save') { sfx.chip(); ctx.send('layout', { station: ctx.station.id, layout }); }
  });

  draw();
  return {
    root,
    repaint: draw,
    onWallet: draw,
    onResult(res) {
      if (res.game === 'planner' && res.saved) {
        const p = ctx.myPlot;
        if (p && p.layout) Object.assign(saved, clone(p.layout));
        layout = clone(saved);
        draw();
      }
    },
    onPlot() {
      const p = ctx.myPlot;
      if (p && p.layout) { Object.assign(saved, clone(p.layout)); draw(); }
    },
    onKey(code) {
      if (code !== 'KeyR') return false;
      rotate();
      return true;
    },
    tick() {},
    destroy() {
      removeEventListener('mousemove', onMove);
      removeEventListener('mouseup', onUp);
    },
  };
}
