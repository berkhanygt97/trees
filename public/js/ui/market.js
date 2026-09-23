import { ITEMS, SELLABLE, money } from '/shared/catalog.js';
import { listPanel, row, btn } from './shops.js';

// The market pays full price; the shipping bin on your farm takes a 20% cut
// for saving you the drive.
function createSeller(ctx, rate) {
  const station = ctx.station.id;
  const panel = listPanel(ctx, (w) => {
    const m = ctx.market || { prices: {}, trend: {} };
    const have = SELLABLE.filter((k) => (w.inv[k] || 0) > 0);
    const total = have.reduce((s, k) => s + (m.prices[k] || 0) * rate * w.inv[k], 0);
    const arrow = (k) => (m.trend[k] > 0 ? '<span class="trend up">▲</span>' : m.trend[k] < 0 ? '<span class="trend down">▼</span>' : '<span class="trend flat">•</span>');
    const rows = SELLABLE.map((k) => {
      const n = w.inv[k] || 0;
      const p = (m.prices[k] || ITEMS[k].price) * rate;
      return row({
        icon: ITEMS[k].icon, name: ITEMS[k].name, locked: !n,
        desc: `${arrow(k)} ${money(p)} each${n ? ` · you have <b>${n}</b> (${money(p * n)})` : ''}`,
        buttons: n ? btn('SELL 1', 'sell', `${k}:1`, { primary: false }) + btn('ALL', 'sell', `${k}:${n}`) : '',
      });
    });
    // Things you actually have float to the top.
    rows.sort((a, b) => a.includes('locked') - b.includes('locked'));
    return `<p class="shop-note">${rate < 1
      ? 'The shipping bin: a trucker collects it and keeps 20% for the trouble. Drive to the Market in town for full price.'
      : 'Prices move every morning, and selling a lot of one thing pushes its price down for a while. Spread your crops.'}</p>
      ${have.length ? `<div class="shop-list" style="margin-bottom:12px">${row({ icon: '💰', name: 'Sell everything', desc: `${have.length} kinds of goods`, price: money(total), buttons: btn('SELL ALL', 'sellall', '*') })}</div>` : ''}
      <div class="shop-list">${rows.join('')}</div>`;
  }, (act, arg) => {
    if (act === 'sellall') ctx.send('sell', { station, item: '*' });
    if (act === 'sell') {
      const [item, qty] = arg.split(':');
      ctx.send('sell', { station, item, qty: Number(qty) });
    }
  });
  panel.onMarket = panel.repaint;
  panel.onResult = (res) => {
    if (res.sold) ctx.feed(`Sold ${res.sold} items for ${money(res.total)}`, 'win');
    panel.repaint();
  };
  panel.onKey = (code) => {
    if (code === 'Space') { ctx.send('sell', { station, item: '*' }); return true; }
    return false;
  };
  return panel;
}

export const createMarket = (ctx) => createSeller(ctx, 1);
export const createBin = (ctx) => createSeller(ctx, 0.8);

// ------------------------------------------------------------------ orders

export function createOrders(ctx) {
  const station = ctx.station.id;
  const panel = listPanel(ctx, (w) => {
    const day = Math.floor(ctx.worldTime() / (20 * 60000)) + 1;
    const list = ctx.orders || [];
    return `<p class="shop-note">Local businesses pay well over market price. First farmer to turn up
      with the full amount gets the lot — you are racing your friends.</p>
      <div class="shop-list">${list.map((o) => {
        const it = ITEMS[o.item];
        const have = w.inv[o.item] || 0;
        const left = o.due - day;
        return row({
          icon: it.icon, name: `${o.qty} × ${it.name}`,
          desc: `Pays <b style="color:var(--gold)">${money(o.reward)}</b> + ${o.xp} xp · ${left <= 0 ? 'due today' : `due in ${left} day${left === 1 ? '' : 's'}`}<br>You have ${have} / ${o.qty}`,
          buttons: btn('DELIVER', 'deliver', String(o.id), { disabled: have < o.qty }),
        });
      }).join('') || '<div class="muted">No orders right now. New ones arrive every morning.</div>'}</div>`;
  }, (act, arg) => {
    if (act === 'deliver') ctx.send('deliver', { station, id: Number(arg) });
  });
  panel.onOrders = panel.repaint;
  return panel;
}
