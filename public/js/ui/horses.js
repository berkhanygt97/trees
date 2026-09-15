import { HORSES } from '/shared/config.js';
import { div, esc, cash, secsLeft, setBar } from './util.js';
import { sfx } from '../sfx.js';

export function createHorses(ctx) {
  const root = div(`
    <div class="row" style="justify-content:space-between;align-items:center">
      <div><span class="tag" data-phase>—</span> <b data-countdown style="font-size:20px"></b>
        <span class="muted" data-race></span></div>
      <div class="row"><span class="muted">recent</span><span class="muted" data-history></span></div>
    </div>
    <div class="phase-bar"><i data-bar style="width:100%"></i></div>
    <div data-runners></div>
    <div class="muted" style="margin-top:8px" data-tickets></div>
  `);

  const phaseEl = root.querySelector('[data-phase]');
  const cdEl = root.querySelector('[data-countdown]');
  const barEl = root.querySelector('[data-bar]');
  const raceEl = root.querySelector('[data-race]');
  const histEl = root.querySelector('[data-history]');
  const runnersEl = root.querySelector('[data-runners]');
  const ticketsEl = root.querySelector('[data-tickets]');
  let state = null;
  let lastPhase = null;
  let lastGallop = 0;

  runnersEl.innerHTML = HORSES.map((h, i) => `
    <div class="runner" data-runner="${i}">
      <span class="swatch" style="background:${h.color}"></span>
      <span class="nm">${i + 1}. ${esc(h.name)}</span>
      <span style="flex:1.4;height:8px;border-radius:4px;background:rgba(255,255,255,.08);position:relative">
        <i data-prog style="position:absolute;left:0;top:0;bottom:0;width:0;border-radius:4px;background:${h.color}"></i>
      </span>
      <span class="odds" data-odds>—</span>
      <button class="bet" data-pick="${i}">BET <small>${i + 1}</small></button>
    </div>`).join('');

  const progEls = [...root.querySelectorAll('[data-prog]')];
  const oddsEls = [...root.querySelectorAll('[data-odds]')];
  const rowEls = [...root.querySelectorAll('[data-runner]')];

  function bet(horse) {
    if (!state || state.phase !== 'betting') { sfx.deny(); ctx.toast('The window is shut — wait for the next race'); return; }
    const amount = ctx.hud.chipFor(ctx.hud.wallet.money);
    if (amount < 25) { sfx.deny(); ctx.toast('Not enough chips'); return; }
    sfx.chip();
    ctx.send('bet', { game: 'horses', station: ctx.station.id, horse, amount });
  }

  for (const b of root.querySelectorAll('[data-pick]')) b.onclick = () => bet(Number(b.dataset.pick));

  function render() {
    if (!state) return;
    phaseEl.textContent = state.phase === 'betting' ? 'WINDOW OPEN'
      : state.phase === 'racing' ? 'AND THEY’RE OFF' : 'OFFICIAL';
    phaseEl.className = `tag ${state.phase === 'betting' ? 'open' : 'live'}`;
    raceEl.textContent = `race ${state.raceNo}`;
    const bonus = state.bonus ? 1.5 : 1;
    oddsEls.forEach((el, i) => {
      el.textContent = `${(state.odds[i] * bonus).toFixed(2)}x`;
      el.style.color = state.bonus ? 'var(--green)' : 'var(--gold)';
    });
    for (const b of root.querySelectorAll('[data-pick]')) b.disabled = state.phase !== 'betting';
    rowEls.forEach((r, i) => r.classList.toggle('won', state.winner === i));

    histEl.innerHTML = (state.history || []).slice(0, 5)
      .map((h) => `<span style="margin-left:8px;color:${HORSES[h.winner].color}">#${h.winner + 1}</span>`).join('');

    const mine = state.bets.find((b) => b.playerId === ctx.meId);
    ticketsEl.innerHTML = mine
      ? 'YOUR TICKETS: ' + mine.list.map((b) => `<b style="color:${HORSES[b.horse].color}">#${b.horse + 1} ${cash(b.amount)}</b>`).join(' · ')
      : 'no tickets this race';
  }

  return {
    root,
    onKey(code) {
      const m = /^Digit([1-6])$/.exec(code);
      if (m && state && state.phase === 'betting') { bet(Number(m[1]) - 1); return true; }
      return false;
    },
    onState(s) {
      if (s.game !== 'horses') return;
      state = s;
      if (s.phase !== lastPhase) {
        lastPhase = s.phase;
        if (s.phase === 'racing') sfx.alarm();
        if (s.phase === 'results') sfx.fanfare();
      }
      render();
    },
    onResult(res) {
      if (res.game !== 'horses') return;
      const net = res.net;
      if (net > 0) sfx.win(3); else if (net < 0) sfx.lose();
      ctx.feed(`Track ${res.winnerName} ${net >= 0 ? '+' : ''}${cash(net)}`, net > 0 ? 'win' : 'loss');
    },
    tick(serverNow) {
      if (!state) return;
      if (state.phase === 'betting') {
        const left = secsLeft(state.until, serverNow);
        cdEl.textContent = `${left.toFixed(1)}s`;
        setBar(barEl, left, 26);
        progEls.forEach((e) => { e.style.width = '0%'; });
      } else if (state.phase === 'racing' && state.finishTimes) {
        const t = (serverNow - state.startAt) / 1000;
        cdEl.textContent = `${t.toFixed(1)}s`;
        setBar(barEl, 1, 1);
        state.finishTimes.forEach((T, i) => {
          const base = Math.min(1, t / T);
          const wobble = base >= 1 ? 0 : 0.07 * Math.sin(t * 1.9 + state.phases[i]) * (1 - base);
          progEls[i].style.width = `${Math.max(0, Math.min(100, (base + wobble) * 100))}%`;
        });
        if (serverNow - lastGallop > 170) { lastGallop = serverNow; sfx.gallop(); }
      } else {
        cdEl.textContent = `${secsLeft(state.until, serverNow).toFixed(1)}s`;
        setBar(barEl, secsLeft(state.until, serverNow), 11);
        progEls.forEach((e) => { e.style.width = '100%'; });
      }
    },
    destroy() {},
  };
}
