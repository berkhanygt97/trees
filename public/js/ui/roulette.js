import { LEGAL_BETS, BET_BY_ID, WHEEL, colorOf, colOf, rowOf } from '/shared/roulette.js';
import { div, esc, cash, secsLeft, setBar } from './util.js';
import { sfx } from '../sfx.js';

const COLS = 12;
const ROWS = 3;

/**
 * Where a bet sits on the felt, in grid units: x runs 0-12 across the number
 * columns, y runs 0-3 down the rows. Splits land on a shared edge and corners
 * on a shared intersection because both are just the average of their cells.
 */
function anchorOf(bet) {
  const inside = bet.numbers.filter((n) => n >= 1);
  if (!inside.length) return null;

  if (bet.type === 'street') return { x: colOf(inside[0]) + 0.5, y: ROWS };
  if (bet.type === 'sixline') return { x: colOf(inside[0]) + 1, y: ROWS };
  if (bet.type === 'trio' || bet.type === 'basket') return null; // drawn in the zero box

  let x = 0;
  let y = 0;
  for (const n of inside) { x += colOf(n) + 0.5; y += rowOf(n) + 0.5; }
  return { x: x / inside.length, y: y / inside.length };
}

// Bets that get a clickable hotspot floating over the number grid.
const OVERLAY_TYPES = new Set(['split', 'corner', 'street', 'sixline']);
const OUTSIDE = ['dozen', 'column', 'red', 'black', 'odd', 'even', 'low', 'high'];

export function createRoulette(ctx) {
  const root = div(`
    <div class="row" style="justify-content:space-between;align-items:center">
      <div><span class="tag" data-phase>—</span> <b data-countdown style="font-size:20px"></b></div>
      <div class="row"><span class="muted">table</span><div class="history" data-history></div></div>
    </div>
    <div class="phase-bar"><i data-bar style="width:100%"></i></div>
    <div class="roul-top">
      <canvas data-wheel class="roul-wheel" width="300" height="300"></canvas>
      <div class="roul-side">
        <div class="lastnum" data-last>—</div>
        <div class="muted" data-hint>Hover the felt — edges are splits, corners are corners.</div>
        <div class="muted" data-mybets style="margin-top:8px"></div>
        <button class="bet danger" data-clear style="margin-top:10px">PULL CHIPS <small>C</small></button>
      </div>
    </div>
    <div class="felt" data-felt></div>
    <div class="felt-outside" data-outside></div>
  `);

  const phaseEl = root.querySelector('[data-phase]');
  const cdEl = root.querySelector('[data-countdown]');
  const barEl = root.querySelector('[data-bar]');
  const histEl = root.querySelector('[data-history]');
  const lastEl = root.querySelector('[data-last]');
  const hintEl = root.querySelector('[data-hint]');
  const myBetsEl = root.querySelector('[data-mybets]');
  const clearBtn = root.querySelector('[data-clear]');
  const feltEl = root.querySelector('[data-felt]');
  const outsideEl = root.querySelector('[data-outside]');
  const wheelCanvas = root.querySelector('[data-wheel]');
  const wg = wheelCanvas.getContext('2d');

  let state = null;
  let lastPhase = null;
  let spinBase = 0;

  // ---------------------------------------------------------------- the felt

  const zero = document.createElement('button');
  zero.className = 'cell zero';
  zero.dataset.bet = 'straight:0';
  zero.textContent = '0';
  feltEl.appendChild(zero);

  const grid = document.createElement('div');
  grid.className = 'felt-grid';
  feltEl.appendChild(grid);

  for (let n = 1; n <= 36; n++) {
    const b = document.createElement('button');
    b.className = `cell ${colorOf(n)}`;
    b.dataset.bet = `straight:${n}`;
    b.style.gridColumn = colOf(n) + 1;
    b.style.gridRow = rowOf(n) + 1;
    b.textContent = n;
    grid.appendChild(b);
  }

  // Hotspots for everything that is not a straight-up number.
  const layer = document.createElement('div');
  layer.className = 'hotspots';
  grid.appendChild(layer);

  const anchors = new Map();
  for (const bet of LEGAL_BETS) {
    if (!OVERLAY_TYPES.has(bet.type)) continue;
    const a = anchorOf(bet);
    if (!a) continue;
    anchors.set(bet.id, a);
    const spot = document.createElement('button');
    spot.className = `hotspot hs-${bet.type}`;
    spot.dataset.bet = bet.id;
    spot.style.left = `${(a.x / COLS) * 100}%`;
    spot.style.top = `${(a.y / ROWS) * 100}%`;
    layer.appendChild(spot);
  }

  // The zero trios and the first four hang off the zero box.
  for (const id of ['trio:0-1-2', 'trio:0-2-3', 'basket:0-1-2-3']) {
    const bet = BET_BY_ID.get(id);
    const spot = document.createElement('button');
    spot.className = 'hotspot hs-zero';
    spot.dataset.bet = id;
    spot.textContent = bet.type === 'basket' ? '4' : '3';
    zero.appendChild(spot);
  }

  // Outside bets.
  outsideEl.innerHTML = LEGAL_BETS
    .filter((b) => OUTSIDE.includes(b.type))
    .map((b) => `<button class="outside ${b.type}" data-bet="${b.id}">${b.label}
      <small>${b.mult - 1}:1</small></button>`).join('');

  const chipLayer = document.createElement('div');
  chipLayer.className = 'chips-layer';
  grid.appendChild(chipLayer);

  // ------------------------------------------------------------ interaction

  function place(betId) {
    if (!state || state.phase !== 'betting') { sfx.deny(); ctx.toast('Betting is closed'); return; }
    const amount = ctx.hud.chipFor(ctx.hud.wallet.money);
    if (amount < 25) { sfx.deny(); ctx.toast('Not enough chips'); return; }
    sfx.chip();
    ctx.send('bet', { game: 'roulette', station: ctx.station.id, betId, amount });
  }

  function highlight(betId, on) {
    const bet = BET_BY_ID.get(betId);
    if (!bet) return;
    for (const n of bet.numbers) {
      const cell = feltEl.querySelector(`[data-bet="straight:${n}"]`);
      if (cell) cell.classList.toggle('lit', on);
    }
    if (on) {
      hintEl.innerHTML = `<b style="color:var(--gold)">${bet.label}</b> · ${bet.type} · pays <b>${bet.mult - 1}:1</b>`;
    } else {
      hintEl.textContent = 'Hover the felt — edges are splits, corners are corners.';
    }
  }

  for (const el of [feltEl, outsideEl]) {
    el.addEventListener('click', (e) => {
      const target = e.target.closest('[data-bet]');
      if (target) { e.stopPropagation(); place(target.dataset.bet); }
    });
    el.addEventListener('mouseover', (e) => {
      const target = e.target.closest('[data-bet]');
      if (target) highlight(target.dataset.bet, true);
    });
    el.addEventListener('mouseout', (e) => {
      const target = e.target.closest('[data-bet]');
      if (target) highlight(target.dataset.bet, false);
    });
  }

  clearBtn.onclick = () => ctx.send('act', { game: 'roulette', station: ctx.station.id, action: 'clear' });

  // --------------------------------------------------------------- my chips

  function renderChips() {
    chipLayer.replaceChildren();
    if (!state) return;
    const mine = state.bets.find((b) => b.playerId === ctx.meId);
    if (!mine) { myBetsEl.textContent = 'nothing on the table'; return; }

    const totals = new Map();
    for (const b of mine.list) totals.set(b.betId, (totals.get(b.betId) || 0) + b.amount);

    for (const [betId, amount] of totals) {
      const a = anchors.get(betId) || anchorOf(BET_BY_ID.get(betId) || {});
      if (!a) continue;
      const chip = document.createElement('i');
      chip.className = 'felt-chip';
      chip.style.left = `${(a.x / COLS) * 100}%`;
      chip.style.top = `${(a.y / ROWS) * 100}%`;
      chip.textContent = amount >= 1000 ? `${Math.round(amount / 1000)}K` : amount;
      chipLayer.appendChild(chip);
    }
    myBetsEl.innerHTML = `<b style="color:var(--gold)">${cash(mine.total)}</b> across ${totals.size} spot${totals.size === 1 ? '' : 's'}`;
  }

  // ------------------------------------------------------------- the wheel

  const TAU = Math.PI * 2;
  /**
   * Canvas arc() angles must stay small: Skia reduces them in float32, which
   * only holds ~7 significant digits, so feeding it epoch-derived radians
   * (~5e8) collapses every pocket onto the same angle.
   */
  const wrap = (a) => a % TAU;

  function drawWheel(serverNow) {
    const size = wheelCanvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const R = size / 2 - 6;
    wg.clearRect(0, 0, size, size);

    let wheelAngle = 0;
    let ballAngle = 0;
    let ballR = R - 16;

    if (state && state.phase === 'spinning' && state.result != null) {
      // Same easing as the 3D wheel, so both agree on where the ball lands.
      const u = Math.min(1, Math.max(0, 1 - (state.until - serverNow) / 9000));
      const ease = 1 - Math.pow(1 - u, 3);
      const pocket = (WHEEL.indexOf(state.result) / WHEEL.length) * Math.PI * 2;
      wheelAngle = wrap(spinBase + ease * Math.PI * 10);
      ballAngle = wrap(wheelAngle + pocket + (1 - ease) * Math.PI * 18);
      ballR = (R - 10) - ease * 22;
    } else if (state && state.phase === 'payout' && state.result != null) {
      const pocket = (WHEEL.indexOf(state.result) / WHEEL.length) * Math.PI * 2;
      wheelAngle = wrap(spinBase + serverNow / 8000);
      ballAngle = wrap(wheelAngle + pocket);
      ballR = R - 32;
    } else {
      wheelAngle = wrap(serverNow / 3200);
      ballAngle = wrap(-serverNow / 1400);
      ballR = R - 10;
    }

    // Pockets.
    const step = (Math.PI * 2) / WHEEL.length;
    WHEEL.forEach((n, i) => {
      const a0 = wheelAngle + i * step;
      wg.beginPath();
      wg.moveTo(cx, cy);
      wg.arc(cx, cy, R, a0, a0 + step);
      wg.closePath();
      const c = colorOf(n);
      wg.fillStyle = c === 'green' ? '#2e9750' : c === 'red' ? '#c2332e' : '#191520';
      wg.fill();
      wg.strokeStyle = 'rgba(242,193,78,0.35)';
      wg.lineWidth = 1;
      wg.stroke();

      wg.save();
      wg.translate(cx, cy);
      wg.rotate(a0 + step / 2);
      wg.fillStyle = '#fff';
      wg.font = 'bold 11px "Trebuchet MS", sans-serif';
      wg.textAlign = 'right';
      wg.textBaseline = 'middle';
      wg.fillText(String(n), R - 4, 0);
      wg.restore();
    });

    // Hub.
    wg.beginPath();
    wg.arc(cx, cy, R * 0.44, 0, Math.PI * 2);
    wg.fillStyle = '#4b2a17';
    wg.fill();
    wg.strokeStyle = '#f2c14e';
    wg.lineWidth = 3;
    wg.stroke();
    wg.beginPath();
    wg.arc(cx, cy, R * 0.2, 0, Math.PI * 2);
    wg.fillStyle = '#f2c14e';
    wg.fill();

    // The ball.
    wg.beginPath();
    wg.arc(cx + Math.cos(ballAngle) * ballR, cy + Math.sin(ballAngle) * ballR, 6, 0, Math.PI * 2);
    wg.fillStyle = '#fdfaf2';
    wg.fill();
    wg.strokeStyle = 'rgba(0,0,0,.4)';
    wg.lineWidth = 1.5;
    wg.stroke();

    if (state && state.result != null && state.phase !== 'betting') {
      wg.fillStyle = 'rgba(0,0,0,0.65)';
      wg.beginPath();
      wg.arc(cx, cy, R * 0.42, 0, Math.PI * 2);
      wg.fill();
      wg.fillStyle = colorOf(state.result) === 'red' ? '#ff8a84'
        : colorOf(state.result) === 'green' ? '#7ce89a' : '#ffffff';
      wg.font = 'bold 54px "Trebuchet MS", sans-serif';
      wg.textAlign = 'center';
      wg.textBaseline = 'middle';
      wg.fillText(String(state.result), cx, cy + 2);
    }
  }

  // ---------------------------------------------------------------- render

  function render() {
    if (!state) return;
    phaseEl.textContent = state.phase === 'betting' ? 'PLACE YOUR BETS'
      : state.phase === 'spinning' ? 'NO MORE BETS' : 'PAYING OUT';
    phaseEl.className = `tag ${state.phase === 'betting' ? 'open' : 'live'}`;
    clearBtn.disabled = state.phase !== 'betting';
    root.classList.toggle('closed', state.phase !== 'betting');

    if (state.result != null) {
      lastEl.textContent = state.result;
      lastEl.className = `lastnum ${colorOf(state.result)}`;
    } else {
      lastEl.textContent = '—';
      lastEl.className = 'lastnum';
    }

    histEl.innerHTML = (state.history || []).slice(0, 8)
      .map((n) => `<i class="${colorOf(n)}">${n}</i>`).join('');

    // Winning numbers stay lit through the payout.
    for (const el of grid.querySelectorAll('.cell')) el.classList.remove('hit');
    if (state.result != null && state.phase !== 'betting') {
      const cell = feltEl.querySelector(`[data-bet="straight:${state.result}"]`);
      if (cell) cell.classList.add('hit');
    }

    renderChips();
  }

  return {
    root,
    onKey(code) {
      if (code === 'KeyR') { place('red:1-3-5-7-9-12-14-16-18-19-21-23-25-27-30-32-34-36'); return true; }
      if (code === 'KeyB') { place('black:2-4-6-8-10-11-13-15-17-20-22-24-26-28-29-31-33-35'); return true; }
      if (code === 'KeyC') { clearBtn.click(); return true; }
      return false;
    },
    onState(s) {
      if (s.game !== 'roulette') return;
      state = s;
      if (s.phase !== lastPhase) {
        if (s.phase === 'spinning') { sfx.spinWheel(); spinBase = Math.random() * Math.PI * 2; }
        lastPhase = s.phase;
      }
      render();
    },
    onResult(res) {
      if (res.game !== 'roulette') return;
      const net = res.net;
      if (net > 0) sfx.win(2); else if (net < 0) sfx.lose();
      ctx.feed(`Roulette ${res.number} ${net >= 0 ? '+' : ''}${cash(net)}`, net > 0 ? 'win' : 'loss');
    },
    tick(serverNow) {
      drawWheel(serverNow);
      if (!state) return;
      const total = state.phase === 'betting' ? 24 : state.phase === 'spinning' ? 9 : 7;
      const left = secsLeft(state.until, serverNow);
      setBar(barEl, left, total);
      cdEl.textContent = `${left.toFixed(1)}s`;
    },
    destroy() {},
  };
}
