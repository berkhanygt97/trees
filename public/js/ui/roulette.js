import { div, esc, cash, secsLeft, setBar } from './util.js';
import { sfx } from '../sfx.js';

const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');

const OUTSIDE = [
  ['red', 'RED', '2x', 'red'], ['black', 'BLACK', '2x', 'black'],
  ['odd', 'ODD', '2x', ''], ['even', 'EVEN', '2x', ''],
  ['low', '1–18', '2x', ''], ['high', '19–36', '2x', ''],
  ['dozen1', '1ST 12', '3x', ''], ['dozen2', '2ND 12', '3x', ''], ['dozen3', '3RD 12', '3x', ''],
];

export function createRoulette(ctx) {
  const root = div(`
    <div class="row" style="justify-content:space-between;align-items:center">
      <div><span class="tag" data-phase>—</span> <b data-countdown style="font-size:20px"></b></div>
      <div class="row"><span class="muted">table</span><div class="history" data-history></div></div>
    </div>
    <div class="phase-bar"><i data-bar style="width:100%"></i></div>
    <div class="row" style="align-items:center;gap:16px">
      <div class="lastnum" data-last>—</div>
      <div style="flex:1">
        <div class="betgrid" style="grid-template-columns:repeat(6,1fr)" data-outside></div>
        <div class="numgrid" data-numbers></div>
      </div>
    </div>
    <div class="row" style="margin-top:10px;justify-content:space-between;align-items:flex-start">
      <div style="flex:1"><div class="muted">ON THE TABLE</div><div data-bets class="muted"></div></div>
      <button class="bet danger" style="width:150px" data-clear>PULL CHIPS <small>C</small></button>
    </div>
  `);

  const phaseEl = root.querySelector('[data-phase]');
  const cdEl = root.querySelector('[data-countdown]');
  const barEl = root.querySelector('[data-bar]');
  const lastEl = root.querySelector('[data-last]');
  const histEl = root.querySelector('[data-history]');
  const betsEl = root.querySelector('[data-bets]');
  const clearBtn = root.querySelector('[data-clear]');
  let state = null;
  let hotRed = false;
  let lastPhase = null;

  root.querySelector('[data-outside]').innerHTML = OUTSIDE.map(([type, label, pay, cls]) =>
    `<button class="bet ${cls}" data-type="${type}">${label}<small data-pay>${pay}</small></button>`).join('');

  const nums = [];
  for (let n = 1; n <= 36; n++) nums.push(n);
  root.querySelector('[data-numbers]').innerHTML =
    `<button class="n green" data-num="0">0 &nbsp;·&nbsp; 36x</button>` +
    nums.map((n) => `<button class="n ${colorOf(n)}" data-num="${n}">${n}</button>`).join('');

  function place(type, value) {
    if (!state || state.phase !== 'betting') { sfx.deny(); ctx.toast('Betting is closed'); return; }
    const amount = ctx.hud.chipFor(ctx.hud.wallet.money);
    if (amount < 25) { sfx.deny(); ctx.toast('Not enough chips'); return; }
    sfx.chip();
    ctx.send('bet', { game: 'roulette', station: ctx.station.id, type, value, amount });
  }

  for (const b of root.querySelectorAll('[data-type]')) b.onclick = () => place(b.dataset.type, null);
  for (const b of root.querySelectorAll('[data-num]')) b.onclick = () => place('number', Number(b.dataset.num));
  clearBtn.onclick = () => ctx.send('act', { game: 'roulette', station: ctx.station.id, action: 'clear' });

  // The clock ticks every frame; everything else only when the table changes.
  function renderClock(serverNow) {
    if (!state) return;
    const total = state.phase === 'betting' ? 22 : state.phase === 'spinning' ? 9 : 7;
    const left = secsLeft(state.until, serverNow);
    setBar(barEl, left, total);
    cdEl.textContent = `${left.toFixed(1)}s`;
  }

  function render() {
    if (!state) return;
    phaseEl.textContent = state.phase === 'betting' ? 'PLACE YOUR BETS'
      : state.phase === 'spinning' ? 'NO MORE BETS' : 'PAYING OUT';
    phaseEl.className = `tag ${state.phase === 'betting' ? 'open' : 'live'}`;
    clearBtn.disabled = state.phase !== 'betting';

    if (state.result != null) {
      lastEl.textContent = state.result;
      lastEl.className = `lastnum ${colorOf(state.result)}`;
    } else if (state.phase === 'betting') {
      lastEl.textContent = '—';
      lastEl.className = 'lastnum';
    }

    histEl.innerHTML = (state.history || []).slice(0, 8)
      .map((n) => `<i class="${colorOf(n)}">${n}</i>`).join('');

    const mine = state.bets.find((b) => b.playerId === ctx.meId);
    const others = state.bets.filter((b) => b.playerId !== ctx.meId);
    betsEl.innerHTML =
      (mine ? `<b style="color:var(--gold)">you ${cash(mine.total)}</b> &nbsp; ` : '<span>nothing yet</span> ') +
      others.map((b) => `${esc(b.name)} ${cash(b.total)}`).join(' · ');

    const redBtn = root.querySelector('[data-type="red"]');
    redBtn.classList.toggle('hot', hotRed);
    redBtn.querySelector('[data-pay]').textContent = hotRed ? '3x HOT' : '2x';
  }

  return {
    root,
    onKey(code) {
      if (code === 'KeyR') { place('red', null); return true; }
      if (code === 'KeyB') { place('black', null); return true; }
      if (code === 'KeyC') { clearBtn.click(); return true; }
      return false;
    },
    onState(s) {
      if (s.game !== 'roulette') return;
      state = s;
      hotRed = !!s.hotRed;
      if (s.phase !== lastPhase) {
        if (s.phase === 'spinning') sfx.spinWheel();
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
    tick(serverNow) { renderClock(serverNow); },
    destroy() {},
  };
}
