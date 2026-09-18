import { ROCKETS } from '/shared/config.js';
import { div, esc, cash, secsLeft, setBar } from './util.js';
import { sfx } from '../sfx.js';

const TRAIL_SECONDS = 26;   // how much flight the curve strip keeps on screen

export function createCrash(ctx) {
  const root = div(`
    <div class="row" style="justify-content:space-between;align-items:center">
      <div><span class="tag" data-phase>—</span> <b data-countdown style="font-size:20px"></b></div>
      <div class="row"><span class="muted">last</span><div data-history class="muted" style="font:700 11px var(--font)"></div></div>
    </div>
    <div class="phase-bar"><i data-bar style="width:100%"></i></div>
    <canvas data-chart class="rocket-chart" width="840" height="230"></canvas>
    <div data-rockets class="rocket-list"></div>
    <div class="row" style="justify-content:center;margin-top:10px">
      <button class="bet danger" style="min-width:300px" data-out>CASH OUT <small>Space</small></button>
    </div>
    <div class="muted" style="text-align:center;margin-top:8px" data-sub></div>
    <div class="muted" style="margin-top:10px">ON BOARD</div>
    <div data-riders class="muted" style="min-height:22px"></div>
  `);

  const phaseEl = root.querySelector('[data-phase]');
  const cdEl = root.querySelector('[data-countdown]');
  const barEl = root.querySelector('[data-bar]');
  const histEl = root.querySelector('[data-history]');
  const ridersEl = root.querySelector('[data-riders]');
  const subEl = root.querySelector('[data-sub]');
  const outBtn = root.querySelector('[data-out]');
  const canvas = root.querySelector('[data-chart]');
  const g = canvas.getContext('2d');

  let state = null;
  let lastPhase = null;
  let lastTickSecond = -1;
  const deadSeen = new Set();

  root.querySelector('[data-rockets]').innerHTML = ROCKETS.map((r, i) => `
    <div class="rocket" data-rocket="${i}">
      <span class="swatch" style="background:${r.color}"></span>
      <span class="nm">${esc(r.name)}</span>
      <span class="mult" data-mult style="color:${r.color}">1.00x</span>
      <button class="bet" data-board="${i}">BOARD <small>${i + 1}</small></button>
    </div>`).join('');

  const rows = [...root.querySelectorAll('[data-rocket]')];
  const multEls = [...root.querySelectorAll('[data-mult]')];
  const boardBtns = [...root.querySelectorAll('[data-board]')];

  const myBet = () => (state ? state.bets.find((b) => b.playerId === ctx.meId) : null);

  function board(index) {
    if (!state || state.phase !== 'betting') { sfx.deny(); ctx.toast('Wait for the next launch'); return; }
    if (myBet()) { sfx.deny(); ctx.toast('You are already on one'); return; }
    const amount = ctx.hud.chipFor(ctx.hud.wallet.money);
    if (amount < 25) { sfx.deny(); ctx.toast('Not enough chips'); return; }
    sfx.chip();
    ctx.send('bet', { game: 'crash', station: ctx.station.id, rocket: index, amount });
  }

  function cashOut() {
    const mine = myBet();
    if (!state || state.phase !== 'running' || !mine || mine.cashedAt) { sfx.deny(); return; }
    if (state.rockets[mine.rocket].dead) { sfx.deny(); ctx.toast('That one is already scrap'); return; }
    ctx.send('act', { game: 'crash', station: ctx.station.id, action: 'cashout' });
  }

  boardBtns.forEach((b, i) => { b.onclick = () => board(i); });
  outBtn.onclick = cashOut;

  /** Live multiplier for one rocket, frozen once it has blown. */
  function multOf(index, serverNow) {
    if (!state || !state.startAt || state.phase === 'betting') return 1;
    const r = state.rockets[index];
    if (r.dead) return r.crashPoint || 1;
    return Math.exp((state.growth || 0.075) * ((serverNow - state.startAt) / 1000));
  }

  function drawChart(serverNow) {
    const w = canvas.width;
    const h = canvas.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#0a0713';
    g.fillRect(0, 0, w, h);

    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 1;
    for (let x = 0; x <= w; x += 70) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 46) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }

    if (!state || state.phase === 'betting' || !state.startAt) {
      g.fillStyle = '#4c4358';
      g.font = 'bold 20px "Trebuchet MS", sans-serif';
      g.textAlign = 'center';
      g.fillText('THREE ROCKETS. PICK ONE.', w / 2, h / 2);
      return;
    }

    const elapsed = (serverNow - state.startAt) / 1000;
    const growth = state.growth || 0.075;
    // Scale both axes to whatever is still flying, so the view keeps up.
    const peak = Math.max(...state.rockets.map((r, i) => multOf(i, serverNow)), 1.6);
    const tMax = Math.max(4, Math.min(TRAIL_SECONDS, elapsed * 1.08));
    const yMax = peak * 1.12;

    const px = (t) => 34 + (t / tMax) * (w - 52);
    const py = (m) => h - 26 - ((m - 1) / (yMax - 1)) * (h - 50);

    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.beginPath(); g.moveTo(34, h - 26); g.lineTo(w - 12, h - 26); g.stroke();

    state.rockets.forEach((r, i) => {
      const endT = r.dead && r.crashAt ? (r.crashAt - state.startAt) / 1000 : elapsed;
      g.strokeStyle = r.color;
      g.globalAlpha = r.dead ? 0.42 : 1;
      g.lineWidth = r.dead ? 2.5 : 4;
      g.beginPath();
      for (let k = 0; k <= 60; k++) {
        const t = (k / 60) * Math.max(0, endT);
        const m = Math.exp(growth * t);
        const X = px(t);
        const Y = py(m);
        k ? g.lineTo(X, Y) : g.moveTo(X, Y);
      }
      g.stroke();

      // The rocket itself, riding the head of its own curve.
      const m = multOf(i, serverNow);
      const hx = px(Math.max(0, endT));
      const hy = py(m);
      g.globalAlpha = 1;
      if (r.dead) {
        // All three climb at the same rate, so the curves coincide — the burst
        // marker is what tells you which rocket died where.
        g.beginPath();
        g.arc(hx, hy, 9, 0, Math.PI * 2);
        g.fillStyle = r.color;
        g.fill();
        g.strokeStyle = '#0a0713';
        g.lineWidth = 2.5;
        g.stroke();
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          g.strokeStyle = r.color;
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(hx + Math.cos(a) * 11, hy + Math.sin(a) * 11);
          g.lineTo(hx + Math.cos(a) * 16, hy + Math.sin(a) * 16);
          g.stroke();
        }
        g.fillStyle = r.color;
        g.font = 'bold 12px "Trebuchet MS", sans-serif';
        g.textAlign = 'center';
        g.fillText(`${m.toFixed(2)}x`, hx, hy - 22);
      } else {
        g.save();
        g.translate(hx, hy);
        g.rotate(-0.5);
        g.fillStyle = r.color;
        g.beginPath();
        g.moveTo(0, -11); g.lineTo(6, 8); g.lineTo(0, 4); g.lineTo(-6, 8);
        g.closePath();
        g.fill();
        g.restore();
        g.fillStyle = r.color;
        g.font = 'bold 13px "Trebuchet MS", sans-serif';
        g.textAlign = 'left';
        g.fillText(`${m.toFixed(2)}x`, hx + 10, hy + 4);
      }
      g.globalAlpha = 1;
    });
  }

  function render() {
    if (!state) return;
    const mine = myBet();
    phaseEl.textContent = state.phase === 'betting' ? 'BOARDING'
      : state.phase === 'running' ? 'IN FLIGHT' : 'ALL DOWN';
    phaseEl.className = `tag ${state.phase === 'betting' ? 'open' : 'live'}`;

    rows.forEach((row, i) => {
      const r = state.rockets[i];
      row.classList.toggle('dead', !!r.dead);
      row.classList.toggle('mine', !!mine && mine.rocket === i);
      boardBtns[i].disabled = state.phase !== 'betting' || !!mine;
      boardBtns[i].textContent = mine && mine.rocket === i ? 'ABOARD' : 'BOARD';
    });

    outBtn.disabled = state.phase !== 'running' || !mine || !!mine.cashedAt
      || !!state.rockets[mine.rocket].dead;

    histEl.innerHTML = (state.history || []).slice(0, 4).map((set) =>
      `<span style="margin-left:9px">${set.map((v, i) =>
        `<i style="font-style:normal;color:${ROCKETS[i].color}">${v.toFixed(2)}</i>`).join('/')}</span>`).join('');

    ridersEl.innerHTML = state.bets.length
      ? state.bets.map((b) => {
        const me = b.playerId === ctx.meId;
        const tag = b.cashedAt ? `<b style="color:var(--green)">${b.cashedAt.toFixed(2)}x ${cash(b.payout)}</b>`
          : state.rockets[b.rocket].dead ? '<b style="color:var(--red)">lost</b>'
            : cash(b.amount);
        return `<span style="margin-right:12px;${me ? 'color:var(--gold)' : ''}">${esc(b.name)}
          <i style="font-style:normal;color:${ROCKETS[b.rocket].color}">▲</i> ${tag}</span>`;
      }).join('')
      : 'nobody aboard yet';
  }

  return {
    root,
    onKey(code) {
      const m = /^Digit([1-3])$/.exec(code);
      if (m) { board(Number(m[1]) - 1); return true; }
      if (code === 'Space') { cashOut(); return true; }
      return false;
    },
    onState(s) {
      if (s.game !== 'crash') return;
      const prev = lastPhase;
      state = s;
      if (s.phase !== prev) {
        lastPhase = s.phase;
        deadSeen.clear();
        if (s.phase === 'running') sfx.launch();
      }
      // One bang per rocket, the moment the server says it died.
      if (s.phase !== 'betting') {
        for (const r of s.rockets) {
          if (r.dead && !deadSeen.has(r.index)) {
            deadSeen.add(r.index);
            sfx.explode();
            const mine = myBet();
            if (mine && mine.rocket === r.index && !mine.cashedAt) {
              ctx.feed(`${r.name} ${cash(-mine.amount)} — blew at ${r.crashPoint.toFixed(2)}x`, 'loss');
            } else if (mine && mine.rocket === r.index && mine.cashedAt) {
              sfx.nearMiss();
            }
          }
        }
      }
      render();
    },
    onResult(res) {
      if (res.game !== 'crash' || !res.cashedAt) return;
      sfx.win(res.cashedAt >= 3 ? 3 : 1);
      ctx.feed(`${ROCKETS[res.rocket].name} +${cash(res.payout - res.staked)} at ${res.cashedAt.toFixed(2)}x`, 'win');
    },
    tick(serverNow) {
      if (!state) return;
      drawChart(serverNow);

      if (state.phase === 'betting') {
        const left = secsLeft(state.until, serverNow);
        cdEl.textContent = `${left.toFixed(1)}s`;
        setBar(barEl, left, 10);
        multEls.forEach((el) => { el.textContent = '1.00x'; });
        subEl.innerHTML = state.fuelled
          ? '<b style="color:var(--gold)">ROCKET FUEL — none of them can crash below 1.50x</b>'
          : 'Pick a rocket. They all fly, only one is yours.';
        const whole = Math.ceil(left);
        if (whole !== lastTickSecond && whole <= 3) { lastTickSecond = whole; sfx.tick(); }
      } else {
        cdEl.textContent = state.phase === 'running' ? '' : `${secsLeft(state.until, serverNow).toFixed(1)}s`;
        setBar(barEl, 1, 1);
        state.rockets.forEach((r, i) => {
          const m = multOf(i, serverNow);
          multEls[i].textContent = r.dead ? `💥 ${m.toFixed(2)}x` : `${m.toFixed(2)}x`;
          multEls[i].style.opacity = r.dead ? 0.45 : 1;
        });
        const mine = myBet();
        if (!mine) {
          subEl.textContent = 'watching from the sofa';
        } else if (mine.cashedAt) {
          subEl.innerHTML = `<b style="color:var(--green)">out at ${mine.cashedAt.toFixed(2)}x</b>`;
        } else if (state.rockets[mine.rocket].dead) {
          subEl.innerHTML = '<b style="color:var(--red)">yours went down</b>';
        } else {
          const riding = Math.round(mine.amount * multOf(mine.rocket, serverNow));
          subEl.innerHTML = `<b>${cash(riding)}</b> riding on ${ROCKETS[mine.rocket].name} — hit SPACE`;
        }
      }
    },
    destroy() {},
  };
}
