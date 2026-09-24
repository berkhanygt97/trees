import { HOOD_UPGRADES, hoodMax, soldierCap, money } from '/shared/catalog.js';
import { div } from './util.js';
import { listPanel, row, btn } from './shops.js';
import { sfx } from '../sfx.js';

// The clubhouse: your gang's name, what you have built up in the hood, and
// the repair bill after a raid. The name box keeps its own DOM, so typing is
// never interrupted by a wallet update repainting the lists below it.

const hpBar = (hp) => `<span class="speed"><i style="width:${hp}%;background:${hp > 60 ? '#5fbf4a' : hp > 25 ? '#e0a83a' : '#d8433a'}"></i></span><b>${hp}%</b>`;

export function createHq(ctx) {
  const root = div(`
    <div class="hq-name">
      <label>GANG NAME</label>
      <input class="gname" maxlength="22" spellcheck="false" />
      <button class="bet primary rename">RENAME</button>
    </div>
    <div class="hq-lists"></div>`);
  const input = root.querySelector('.gname');
  input.value = (ctx.wallet.gang && ctx.wallet.gang.name) || '';
  root.querySelector('.rename').addEventListener('click', () => {
    sfx.chip();
    ctx.send('hood', { act: 'rename', name: input.value });
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') ctx.send('hood', { act: 'rename', name: input.value });
  });

  const lists = listPanel(ctx, (w) => {
    const h = w.hood;
    if (!h) return '<p class="shop-note">You need a hood of your own first.</p>';
    const soldiers = (w.staff || []).filter((s) => s.role === 'soldier');
    const cap = soldierCap(h.up.hq);
    const ups = Object.entries(HOOD_UPGRADES).map(([k, def]) => {
      const lvl = h.up[k];
      const max = hoodMax(k);
      const next = h.next[k];
      const maxed = lvl >= max;
      const locked = !!next.locked;
      return row({
        icon: def.icon,
        name: `${def.name} ${'★'.repeat(lvl)}${'☆'.repeat(max - lvl)}`,
        owned: maxed,
        locked,
        desc: `${def.blurb}${locked ? `<br>🔒 Farm level ${next.locked}` : ''}`,
        price: maxed ? '' : money(next.price),
        buttons: maxed ? '<span class="pr">MAXED</span>' : locked ? '' : btn(lvl ? 'UPGRADE' : 'BUY', 'upgrade', k, { disabled: w.money < next.price }),
      });
    });
    const hurt = h.buildings.filter((b) => b.hp < 100);
    const total = hurt.reduce((a, b) => a + b.cost, 0);
    const blds = h.buildings.map((b) => row({
      icon: b.kind === 'restaurant' ? '🍔' : b.kind === 'hq' ? '🏚️' : '🏠',
      name: b.label,
      desc: `<div class="stat">HEALTH ${hpBar(b.hp)}</div>${b.hp <= 0 ? '<b style="color:#ff6a5a">WRECKED — shut until it is fixed</b>' : b.hp < 50 && b.kind === 'restaurant' ? 'Customers are staying away.' : ''}`,
      price: b.hp < 100 ? money(b.cost) : '',
      buttons: b.hp < 100 ? btn('REPAIR', 'repair', b.key, { disabled: w.money < b.cost }) : '<span class="pr">FINE</span>',
    }));
    return `
      <p class="shop-note">Your soldiers: <b>${soldiers.length} of ${cap}</b> (hire them at the Job Centre, south end of Main Street).
        Everyone you hire wears your colours. Raids only come while you are in the valley.</p>
      <div class="shop-head">UPGRADES</div>
      <div class="shop-list">${ups.join('')}</div>
      <div class="shop-head">BUILDINGS ${hurt.length ? `<span>${btn(`REPAIR ALL ${money(Math.ceil(total * 0.9 / 10) * 10)}`, 'repair', 'all', { disabled: w.money < total * 0.9 })}</span>` : ''}</div>
      <div class="shop-list">${blds.join('')}</div>`;
  }, (act, arg) => {
    if (act === 'upgrade') ctx.send('hood', { act: 'upgrade', key: arg });
    if (act === 'repair') ctx.send('hood', { act: 'repair', key: arg });
  });
  root.querySelector('.hq-lists').appendChild(lists.root);

  return {
    root,
    onWallet(w) {
      lists.onWallet(w);
      if (document.activeElement !== input && w.gang) input.value = w.gang.name;
    },
    onResult() {},
    tick() {},
    destroy() {},
  };
}
