import { div, cash } from './util.js';
import { sfx } from '../sfx.js';

const GLYPHS = ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣'];
const THREES = [4, 6, 10, 18, 40, 150];

export function createSlots(ctx) {
  const root = div(`
    <div class="reels">
      <div class="reel">🍒</div><div class="reel">🍋</div><div class="reel">🔔</div>
    </div>
    <div style="text-align:center;min-height:30px" class="outcome"></div>
    <div class="row" style="justify-content:center;margin-top:8px">
      <button class="bet primary" style="min-width:220px" data-spin>SPIN &nbsp;<kbd>Space</kbd></button>
    </div>
    <div class="row" style="justify-content:center;margin-top:14px;gap:14px">
      ${GLYPHS.map((g, i) => `<span class="muted">${g}${g}${g} <b style="color:var(--gold)">${THREES[i]}x</b></span>`).join('')}
    </div>
    <div class="muted" style="text-align:center;margin-top:6px">any two matching pays 1.2x</div>
  `);

  const reels = [...root.querySelectorAll('.reel')];
  const outcome = root.querySelector('.outcome');
  const spinBtn = root.querySelector('[data-spin]');
  let spinning = false;
  let timers = [];

  function spin() {
    if (spinning) return;
    const bet = ctx.hud.chipFor(ctx.hud.wallet.money);
    if (bet < 25) { sfx.deny(); ctx.toast('Not enough chips for a pull'); return; }
    spinning = true;
    spinBtn.disabled = true;
    outcome.textContent = '';
    reels.forEach((r) => r.classList.add('spin'));
    timers.push(setInterval(() => {
      reels.forEach((r) => { if (r.classList.contains('spin')) r.textContent = GLYPHS[(Math.random() * 6) | 0]; });
    }, 70));
    ctx.send('bet', { game: 'slots', station: ctx.station.id, amount: bet });
  }

  spinBtn.onclick = spin;

  return {
    root,
    onKey(code) {
      if (code === 'Space' || code === 'KeyE') { spin(); return true; }
      return false;
    },
    onResult(res) {
      if (res.game !== 'slots') return;
      res.reels.forEach((sym, i) => {
        timers.push(setTimeout(() => {
          reels[i].classList.remove('spin');
          reels[i].textContent = GLYPHS[sym];
          sfx.reel(i);
          if (i === 2) finish(res);
        }, 420 + i * 260));
      });
    },
    tick() {},
    destroy() { timers.forEach(clearTimeout); timers.forEach(clearInterval); timers = []; },
  };

  function finish(res) {
    spinning = false;
    spinBtn.disabled = false;
    const net = res.payout - res.stake;
    if (res.kind === 'jackpot') {
      outcome.innerHTML = `<span class="big-num" style="color:var(--gold)">JACKPOT ${cash(res.payout)}</span>`;
      sfx.jackpot();
    } else if (res.payout > 0) {
      outcome.innerHTML = `<span class="big-num" style="color:var(--green)">${cash(res.payout)}</span>
        <div class="muted">${res.boost > 1 ? 'HAPPY HOUR DOUBLE — ' : ''}${res.kind === 'triple' ? 'three of a kind' : 'pair'}</div>`;
      sfx.win(res.kind === 'triple' ? 3 : 1);
    } else {
      outcome.innerHTML = `<span class="big-num" style="color:var(--red)">${cash(-res.stake)}</span>`;
      sfx.lose();
    }
    ctx.feed(`Slots ${net >= 0 ? '+' : ''}${cash(net)}`, net > 0 ? 'win' : 'loss');
  }
}
