import { CIGAR, money } from '/shared/config.js';
import { div } from './util.js';
import { sfx } from '../sfx.js';

export function createCigar(ctx) {
  const root = div(`
    <div style="text-align:center">
      <div style="font-size:52px;line-height:1">🚬</div>
      <div class="big-num" style="color:var(--gold);font-size:34px">${money(CIGAR.PRICE)}</div>
      <div class="muted" data-status>Hand-rolled. Does absolutely nothing.</div>
      <button class="bet primary" style="max-width:320px;margin:14px auto 0" data-buy>
        BUY A CIGAR <small>Space</small>
      </button>
      <p class="muted" style="max-width:480px;margin:16px auto 0;line-height:1.7">
        It will not improve your odds by a single percent. It comes straight off your
        profit, it lasts ${CIGAR.PUFFS} puffs, and everyone on the floor can see it.
        Press <kbd>C</kbd> anywhere in the casino to take a draw.
      </p>
    </div>
  `);

  const statusEl = root.querySelector('[data-status]');
  const buyBtn = root.querySelector('[data-buy]');
  let puffs = 0;

  function refresh() {
    if (puffs > 0) {
      statusEl.innerHTML = `<b style="color:var(--gold)">${puffs} puff${puffs === 1 ? '' : 's'} left.</b> Press C to enjoy it.`;
      buyBtn.disabled = true;
      buyBtn.textContent = 'ALREADY SMOKING';
    } else {
      statusEl.textContent = 'Hand-rolled. Does absolutely nothing.';
      buyBtn.disabled = ctx.hud.wallet.money < CIGAR.PRICE;
      buyBtn.textContent = ctx.hud.wallet.money < CIGAR.PRICE ? 'CANNOT AFFORD IT' : 'BUY A CIGAR';
    }
  }

  function buy() {
    if (buyBtn.disabled) { sfx.deny(); return; }
    sfx.chip();
    ctx.send('bet', { game: 'cigar', station: ctx.station.id });
  }
  buyBtn.onclick = buy;
  refresh();

  return {
    root,
    onKey(code) {
      if (code === 'Space' || code === 'KeyE') { buy(); return true; }
      return false;
    },
    onResult(res) {
      if (res.game !== 'cigar') return;
      puffs = res.puffs || 0;
      if (res.bought) ctx.feed(`Cigar ${money(-CIGAR.PRICE)}`, 'loss');
      refresh();
    },
    tick() { if (puffs <= 0) refresh(); },
    destroy() {},
  };
}
