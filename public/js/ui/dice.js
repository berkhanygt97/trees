import { div, cash } from './util.js';
import { sfx } from '../sfx.js';

const PRESETS = [
  { mode: 'under', target: 25 }, { mode: 'under', target: 50 }, { mode: 'under', target: 75 },
  { mode: 'over', target: 25 }, { mode: 'over', target: 50 }, { mode: 'over', target: 75 },
];

export function createDice(ctx) {
  let mode = 'under';
  let target = 50;
  let rolling = false;

  const root = div(`
    <div style="text-align:center">
      <div class="big-num" data-value>—</div>
      <div class="muted" data-sub>roll 0.00 – 99.99</div>
      <div style="position:relative;height:14px;margin:14px 0;border-radius:7px;background:linear-gradient(90deg,var(--green) 0%,var(--green) 50%,var(--red) 50%,var(--red) 100%)" data-track>
        <i data-marker style="position:absolute;top:-5px;width:4px;height:24px;background:#fff;border-radius:2px;box-shadow:0 0 6px #000"></i>
      </div>
    </div>
    <div class="row" style="justify-content:center;margin-bottom:10px">
      <button class="bet" data-mode="under" style="width:120px">ROLL UNDER</button>
      <button class="bet" data-mode="over" style="width:120px">ROLL OVER</button>
      <span class="muted">target</span>
      <input class="slider" type="range" min="2" max="98" value="50" style="width:180px" data-slider>
      <b data-target style="color:var(--gold);width:34px;text-align:right">50</b>
    </div>
    <div class="betgrid" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px" data-presets></div>
    <div class="row" style="justify-content:center">
      <button class="bet primary" style="min-width:260px" data-roll>ROLL &nbsp;<kbd>Space</kbd></button>
    </div>
    <div class="muted" style="text-align:center;margin-top:8px" data-odds></div>
  `);

  const valueEl = root.querySelector('[data-value]');
  const subEl = root.querySelector('[data-sub]');
  const marker = root.querySelector('[data-marker]');
  const track = root.querySelector('[data-track]');
  const slider = root.querySelector('[data-slider]');
  const targetEl = root.querySelector('[data-target]');
  const oddsEl = root.querySelector('[data-odds]');
  const rollBtn = root.querySelector('[data-roll]');
  let edgeFree = false;

  root.querySelector('[data-presets]').innerHTML = PRESETS.map((p, i) =>
    `<button class="bet" data-preset="${i}">${p.mode === 'under' ? 'UNDER' : 'OVER'} ${p.target}<small></small></button>`).join('');

  const chance = () => (mode === 'under' ? target : 100 - target);
  const mult = () => Math.round(((edgeFree ? 100 : 96) / chance()) * 100) / 100;

  function refresh() {
    targetEl.textContent = target;
    slider.value = target;
    for (const b of root.querySelectorAll('[data-mode]')) b.classList.toggle('hot', b.dataset.mode === mode);
    const win = mode === 'under'
      ? `linear-gradient(90deg,var(--green) 0%,var(--green) ${target}%,var(--red) ${target}%,var(--red) 100%)`
      : `linear-gradient(90deg,var(--red) 0%,var(--red) ${target}%,var(--green) ${target}%,var(--green) 100%)`;
    track.style.background = win;
    oddsEl.innerHTML = `win chance <b style="color:#fff">${chance()}%</b> &nbsp;·&nbsp; pays <b style="color:var(--gold)">${mult().toFixed(2)}x</b>${edgeFree ? ' &nbsp;·&nbsp; <b style="color:var(--green)">LOADED DICE: no house edge</b>' : ''}`;
    root.querySelectorAll('[data-preset]').forEach((b, i) => {
      const p = PRESETS[i];
      const c = p.mode === 'under' ? p.target : 100 - p.target;
      b.querySelector('small').textContent = `${((edgeFree ? 100 : 96) / c).toFixed(2)}x`;
      b.classList.toggle('hot', p.mode === mode && p.target === target);
    });
  }

  for (const b of root.querySelectorAll('[data-mode]')) {
    b.onclick = () => { mode = b.dataset.mode; sfx.click(); refresh(); };
  }
  slider.oninput = () => { target = Number(slider.value); refresh(); };
  root.querySelectorAll('[data-preset]').forEach((b, i) => {
    b.onclick = () => { mode = PRESETS[i].mode; target = PRESETS[i].target; sfx.click(); refresh(); };
  });

  function roll() {
    if (rolling) return;
    const bet = ctx.hud.chipFor(ctx.hud.wallet.money);
    if (bet < 25) { sfx.deny(); ctx.toast('Not enough chips'); return; }
    rolling = true;
    rollBtn.disabled = true;
    subEl.textContent = 'rolling…';
    let spins = 0;
    const iv = setInterval(() => {
      valueEl.textContent = (Math.random() * 100).toFixed(2);
      valueEl.style.color = '#fff';
      if (++spins > 8) clearInterval(iv);
    }, 55);
    ctx.send('bet', { game: 'dice', station: ctx.station.id, amount: bet, mode, target });
  }
  rollBtn.onclick = roll;
  refresh();

  return {
    root,
    onKey(code) {
      if (code === 'Space' || code === 'KeyE') { roll(); return true; }
      if (code === 'ArrowLeft') { target = Math.max(2, target - 1); refresh(); return true; }
      if (code === 'ArrowRight') { target = Math.min(98, target + 1); refresh(); return true; }
      return false;
    },
    onResult(res) {
      if (res.game !== 'dice') return;
      setTimeout(() => {
        rolling = false;
        rollBtn.disabled = false;
        valueEl.textContent = res.value.toFixed(2);
        valueEl.style.color = res.won ? 'var(--green)' : 'var(--red)';
        marker.style.left = `calc(${res.value}% - 2px)`;
        const net = res.payout - res.stake;
        subEl.innerHTML = res.won
          ? `<b style="color:var(--green)">${res.mult.toFixed(2)}x · ${cash(res.payout)}</b>`
          : `<b style="color:var(--red)">${cash(-res.stake)}</b>`;
        res.won ? sfx.win(1) : sfx.lose();
        ctx.feed(`Dice ${net >= 0 ? '+' : ''}${cash(net)}`, net > 0 ? 'win' : 'loss');
      }, 480);
    },
    onRound(round) {
      edgeFree = !!(round && round.event && round.event.id === 'loaded_dice');
      refresh();
    },
    tick() {},
    destroy() {},
  };
}
