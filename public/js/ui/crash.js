import { div, esc, cash, secsLeft, setBar } from './util.js';
import { sfx } from '../sfx.js';

export function createCrash(ctx) {
  const root = div(`
    <div class="row" style="justify-content:space-between;align-items:center">
      <div><span class="tag" data-phase>—</span> <b data-countdown style="font-size:20px"></b></div>
      <div class="row"><span class="muted">last</span><div class="history" data-history style="gap:8px"></div></div>
    </div>
    <div class="phase-bar"><i data-bar style="width:100%"></i></div>
    <div style="text-align:center;margin:6px 0 12px">
      <div class="big-num" data-mult style="font-size:64px">1.00x</div>
      <div class="muted" data-sub></div>
    </div>
    <div class="betgrid" style="grid-template-columns:1fr 1fr">
      <button class="bet primary" data-join>JOIN LAUNCH <small>Space</small></button>
      <button class="bet danger" data-out>CASH OUT <small>Space</small></button>
    </div>
    <div class="muted" style="margin-top:12px">IN THE ROCKET</div>
    <div data-riders class="muted" style="min-height:22px"></div>
  `);

  const phaseEl = root.querySelector('[data-phase]');
  const cdEl = root.querySelector('[data-countdown]');
  const barEl = root.querySelector('[data-bar]');
  const multEl = root.querySelector('[data-mult]');
  const subEl = root.querySelector('[data-sub]');
  const histEl = root.querySelector('[data-history]');
  const ridersEl = root.querySelector('[data-riders]');
  const joinBtn = root.querySelector('[data-join]');
  const outBtn = root.querySelector('[data-out]');
  let state = null;
  let lastPhase = null;
  let lastTickSecond = -1;

  const myBet = () => (state ? state.bets.find((b) => b.playerId === ctx.meId) : null);

  function join() {
    if (!state || state.phase !== 'betting') { sfx.deny(); ctx.toast('Wait for the next launch'); return; }
    if (myBet()) { sfx.deny(); ctx.toast('Already aboard'); return; }
    const amount = ctx.hud.chipFor(ctx.hud.wallet.money);
    if (amount < 25) { sfx.deny(); ctx.toast('Not enough chips'); return; }
    sfx.chip();
    ctx.send('bet', { game: 'crash', station: ctx.station.id, amount });
  }

  function cashOut() {
    const mine = myBet();
    if (!state || state.phase !== 'running' || !mine || mine.cashedAt) { sfx.deny(); return; }
    ctx.send('act', { game: 'crash', station: ctx.station.id, action: 'cashout' });
  }

  joinBtn.onclick = join;
  outBtn.onclick = cashOut;

  function render() {
    if (!state) return;
    const mine = myBet();
    phaseEl.textContent = state.phase === 'betting' ? 'BOARDING'
      : state.phase === 'running' ? 'IN FLIGHT' : 'WRECKED';
    phaseEl.className = `tag ${state.phase === 'betting' ? 'open' : 'live'}`;
    joinBtn.disabled = state.phase !== 'betting' || !!mine;
    outBtn.disabled = state.phase !== 'running' || !mine || !!(mine && mine.cashedAt);

    histEl.innerHTML = (state.history || []).slice(0, 6)
      .map((v) => `<span style="color:${v >= 2 ? 'var(--green)' : 'var(--red)'};font:700 12px var(--font)">${v.toFixed(2)}x</span>`).join('');

    ridersEl.innerHTML = state.bets.length
      ? state.bets.map((b) => {
        const me = b.playerId === ctx.meId;
        const tag = b.cashedAt ? `<b style="color:var(--green)">${b.cashedAt.toFixed(2)}x ${cash(b.payout)}</b>`
          : state.phase === 'crashed' ? '<b style="color:var(--red)">lost</b>' : `${cash(b.amount)}`;
        return `<span style="margin-right:12px;${me ? 'color:var(--gold)' : ''}">${esc(b.name)} ${tag}</span>`;
      }).join('')
      : 'nobody yet';

    if (state.fuelled) subEl.innerHTML = '<b style="color:var(--gold)">ROCKET FUEL — cannot crash below 1.50x</b>';
  }

  return {
    root,
    onKey(code) {
      if (code === 'Space') {
        if (state && state.phase === 'running') cashOut(); else join();
        return true;
      }
      return false;
    },
    onState(s) {
      if (s.game !== 'crash') return;
      const prev = lastPhase;
      state = s;
      if (s.phase !== prev) {
        lastPhase = s.phase;
        if (s.phase === 'running') sfx.launch();
        if (s.phase === 'crashed') {
          sfx.explode();
          const mine = myBet();
          if (mine && !mine.cashedAt) ctx.feed(`Rocket ${cash(-mine.amount)} — blew up at ${s.crashPoint.toFixed(2)}x`, 'loss');
        }
      }
      render();
    },
    onResult(res) {
      if (res.game !== 'crash' || !res.cashedAt) return;
      sfx.win(res.cashedAt >= 3 ? 3 : 1);
      ctx.feed(`Rocket +${cash(res.payout - res.staked)} at ${res.cashedAt.toFixed(2)}x`, 'win');
    },
    tick(serverNow) {
      if (!state) return;
      if (state.phase === 'betting') {
        const left = secsLeft(state.until, serverNow);
        cdEl.textContent = `${left.toFixed(1)}s`;
        setBar(barEl, left, 9);
        multEl.textContent = '1.00x';
        multEl.style.color = '#fff';
        if (!state.fuelled) subEl.textContent = 'board now — the rocket leaves without you';
        const whole = Math.ceil(left);
        if (whole !== lastTickSecond && whole <= 3) { lastTickSecond = whole; sfx.tick(); }
      } else if (state.phase === 'running') {
        const m = Math.exp((state.growth || 0.075) * ((serverNow - state.startAt) / 1000));
        multEl.textContent = `${m.toFixed(2)}x`;
        multEl.style.color = 'var(--green)';
        cdEl.textContent = '';
        setBar(barEl, 1, 1);
        const mine = myBet();
        if (!state.fuelled) {
          subEl.textContent = mine
            ? (mine.cashedAt ? `cashed at ${mine.cashedAt.toFixed(2)}x` : `${cash(Math.round(mine.amount * m))} riding — hit SPACE`)
            : 'watching from the sofa';
        }
      } else {
        multEl.textContent = `${(state.crashPoint || 1).toFixed(2)}x`;
        multEl.style.color = 'var(--red)';
        cdEl.textContent = `${secsLeft(state.until, serverNow).toFixed(1)}s`;
        setBar(barEl, secsLeft(state.until, serverNow), 6);
        if (!state.fuelled) subEl.textContent = 'busted';
      }
    },
    destroy() {},
  };
}
