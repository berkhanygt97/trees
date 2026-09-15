import { CONFIG, money } from '/shared/config.js';
import { div } from './util.js';
import { sfx } from '../sfx.js';

export function createAtm(ctx) {
  const root = div(`
    <div style="text-align:center">
      <div class="big-num" style="color:var(--green)" data-amount>${money(CONFIG.LOAN_AMOUNT)}</div>
      <div class="muted" data-status></div>
      <button class="bet primary" style="max-width:320px;margin:14px auto 0" data-take>
        TAKE THE MONEY <small>Space</small>
      </button>
      <p class="muted" style="max-width:460px;margin:14px auto 0;line-height:1.6">
        Every dollar you borrow is subtracted from your final profit. The ATM keeps you
        in the game; it will never put you on the podium.
      </p>
    </div>
  `);

  const statusEl = root.querySelector('[data-status]');
  const takeBtn = root.querySelector('[data-take]');

  function take() {
    if (takeBtn.disabled) { sfx.deny(); return; }
    sfx.chip();
    ctx.send('loan', {});
  }
  takeBtn.onclick = take;

  return {
    root,
    onKey(code) {
      if (code === 'Space' || code === 'KeyE') { take(); return true; }
      return false;
    },
    tick() {
      const w = ctx.hud.wallet;
      if (w.money > CONFIG.LOAN_MAX_BALANCE) {
        statusEl.textContent = `You still have ${money(w.money)}. Come back under ${money(CONFIG.LOAN_MAX_BALANCE)}.`;
        takeBtn.disabled = true;
      } else if (w.loanIn > 0) {
        statusEl.textContent = `Recharging — ${Math.ceil(w.loanIn / 1000)}s`;
        takeBtn.disabled = true;
      } else if (w.canLoan) {
        statusEl.textContent = 'Approved. No questions asked.';
        takeBtn.disabled = false;
      } else {
        statusEl.textContent = 'Closed between rounds.';
        takeBtn.disabled = true;
      }
    },
    destroy() {},
  };
}
