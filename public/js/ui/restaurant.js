import {
  ITEMS, RESTAURANTS, DISH_BY_ID, INGREDIENT_GROUPS, RESTO_LEVELS, RESTO_DELIVERY_LEVEL,
  REMODEL_SHARE, WHOLESALE, dishPrice, money,
} from '/shared/catalog.js';
import { LOT_BY_ID } from '/shared/map.js';
import { div, esc } from './util.js';
import { sfx } from '../sfx.js';

// Your restaurant's counter: the orders board, cooking and serving by hand,
// deliveries, the menu and prices, the pantry, staff and a refit. Each
// section is only redrawn when its own content changes, so buttons stay
// clickable while orders tick along.

const meter = (frac, cls = '') => `<div class="meter ${cls}"><i style="width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%"></i></div>`;
const ingIcon = (k) => (INGREDIENT_GROUPS[k] ? '🍖/🥩' : (ITEMS[k] || {}).icon || '?');
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.max(0, sec % 60)).padStart(2, '0')}`;
const STATE = { queued: 'waiting for the kitchen', cooking: 'on the stove', ready: 'READY', serving: 'on its way' };

export function createRestaurant(ctx) {
  const station = ctx.station.id;
  const root = div(`
    <div class="resto-head"></div>
    <div class="shop-head">ORDERS <span class="orders-sub"></span></div>
    <div class="resto-orders shop-list"></div>
    <div class="resto-deliv-wrap">
      <div class="shop-head">PHONE ORDERS <span>ride them out on your scooter</span></div>
      <div class="resto-deliv shop-list"></div>
    </div>
    <div class="shop-head">MENU <span class="price-lbl"></span></div>
    <div class="resto-price">Prices <input type="range" min="0.8" max="1.5" step="0.05" class="price-in"> <b class="price-val"></b>
      <span class="muted">Dearer means fewer customers.</span></div>
    <div class="resto-menu shop-list"></div>
    <div class="shop-head">PANTRY <span>ingredients come from your farm storage</span></div>
    <div class="resto-pantry shop-list"></div>
    <div class="shop-head">RUNNING THE PLACE</div>
    <div class="resto-run shop-list"></div>`);
  const $ = (sel) => root.querySelector(sel);
  const shown = {};
  const paint = (sel, html) => { if (shown[sel] !== html) { shown[sel] = html; $(sel).innerHTML = html; } };
  const priceIn = $('.price-in');
  const orderRows = new Map();
  const delivRows = new Map();

  /** Keeps one row per item; rebuilds a row's buttons only when its `key` changes. */
  function keyed(rows, box, items, idOf, view, empty) {
    const seen = new Set();
    for (const it of items) {
      const id = idOf(it);
      seen.add(id);
      const v = view(it);
      let row = rows.get(id);
      if (!row) {
        row = div(`<div class="ic"></div><div><div class="nm"></div><div class="ds"></div><div class="meter"><i></i></div></div><div class="btns"></div>`, 'shop-row');
        rows.set(id, row);
        box.appendChild(row);
      }
      row.querySelector('.ic').textContent = v.icon;
      const nm = row.querySelector('.nm');
      if (nm.innerHTML !== v.name) nm.innerHTML = v.name;
      row.querySelector('.ds').textContent = v.desc;
      const m = row.querySelector('.meter');
      m.hidden = !v.meter;
      if (v.meter) {
        m.className = `meter ${v.meter[1]}`;
        m.firstChild.style.width = `${Math.round(Math.max(0, Math.min(1, v.meter[0])) * 100)}%`;
      }
      if (row.dataset.key !== v.key) { row.dataset.key = v.key; row.querySelector('.btns').innerHTML = v.buttons; }
    }
    for (const [id, row] of rows) if (!seen.has(id)) { row.remove(); rows.delete(id); }
    let note = box.querySelector(':scope > .muted');
    if (!items.length && !note) { note = div(empty, 'muted'); box.appendChild(note); }
    if (items.length && note) note.remove();
  }

  function render() {
    const s = ctx.resto;
    if (!s) { paint('.resto-head', '<p class="shop-note">Loading…</p>'); return; }
    const def = RESTAURANTS[s.type];
    const lot = LOT_BY_ID.get(s.lot);
    const next = RESTO_LEVELS[s.level];
    const prev = RESTO_LEVELS[s.level - 1];
    paint('.resto-head', `
      <div class="resto-title">${def.icon} <b>${esc(def.name)}</b> · Lot ${s.lot} (${esc(lot.name)}) · <span class="lvl">LEVEL ${s.level}</span>
        <button class="bet ${s.open ? '' : 'primary'}" data-act="open">${s.open ? 'CLOSE UP' : 'OPEN UP'}</button></div>
      <div class="resto-till">
        <span>🏦 Till <b>${money(s.till || 0)}</b></span>
        <button class="bet ${s.till ? 'primary' : ''}" data-act="bank" ${s.till ? '' : 'disabled'}>BANK IT</button>
        <span class="muted">Takings wait here until they are banked — automatically in ${mmss(s.bankIn || 0)}. Money in the till can be stolen.</span>
      </div>
      <div class="resto-stats">
        <span>⭐ Reputation <b>${s.rep}</b></span>
        <span>🍽️ Served <b>${s.served}</b>${next ? ` / ${next} for level ${s.level + 1}` : ''}</span>
        <span>🪑 Tables <b>${s.seated} / ${s.tables}</b></span>
        <span>📅 Today <b>${s.day.served || 0}</b> served · <b>${money(s.day.revenue || 0)}</b> · ${s.day.walkouts || 0} walked out</span>
      </div>
      ${next ? meter((s.served - prev) / (next - prev), 'gold') : ''}
      ${s.open ? '' : '<p class="shop-note warn">Closed: nobody comes in until you open up.</p>'}
      ${s.status ? `<p class="shop-note warn">${esc(s.status)}</p>` : ''}`);

    // Orders: cook and serve them yourself, or let your staff. Rows are
    // kept and only their text changes, so a COOK button never moves under
    // your mouse while the timers tick.
    paint('.orders-sub', s.orders.length ? `${s.orders.length} on the go` : 'quiet right now');
    keyed(orderRows, $('.resto-orders'), s.orders, (o) => o.oid, (o) => {
      const d = DISH_BY_ID[o.dish];
      const total = o.waited + Math.max(0, o.patience);
      return {
        key: o.state,
        icon: d.icon,
        name: `Table ${o.table}: ${esc(d.name)}${o.vip ? ' <span class="vip">VIP</span>' : ''}`,
        desc: `${STATE[o.state]} · waiting ${o.waited}s`,
        meter: [total ? o.patience / total : 0, o.patience < 25 ? 'red' : ''],
        buttons: o.state === 'queued' ? `<button class="bet primary" data-act="cook" data-arg="${o.oid}">COOK</button>`
          : o.state === 'ready' ? `<button class="bet primary" data-act="serve" data-arg="${o.oid}">SERVE</button>` : '',
      };
    }, 'No orders. Customers come in when the pantry can make something on the menu.');

    // Deliveries.
    $('.resto-deliv-wrap').hidden = s.level < RESTO_DELIVERY_LEVEL;
    keyed(delivRows, $('.resto-deliv'), s.deliveries, (d) => d.id, (d) => {
      const dish = DISH_BY_ID[d.dish];
      const mine = s.carrying && s.carrying.id === d.id;
      return {
        key: `${d.state}|${!!s.carrying}`,
        icon: '🛵',
        name: `${dish.icon} ${esc(dish.name)} → ${esc(d.dest)}`,
        desc: `${mine ? 'You have it — ride!' : d.state === 'driver' ? 'Your driver is on it' : d.state === 'player' ? 'On its way' : `${Math.max(0, d.left)}s to deliver it hot`} · pays ${money(dishPrice(dish) * s.price)} + tip`,
        buttons: d.state === 'waiting' ? `<button class="bet primary" data-act="take" data-arg="${d.id}" ${s.carrying ? 'disabled' : ''}>TAKE IT</button>` : '',
      };
    }, 'No phone orders right now.');

    // Menu and prices.
    if (document.activeElement !== priceIn) priceIn.value = String(s.price);
    $('.price-val').textContent = `${Math.round(s.price * 100)}%`;
    paint('.resto-menu', def.dishes.map((d) => {
      const locked = d.level > s.level;
      const on = s.menu[d.id];
      const ing = Object.entries(d.in).map(([k, n]) => `${n}× ${ingIcon(k)}`).join(' + ');
      return `<div class="shop-row ${locked ? 'locked' : ''}"><div class="ic">${d.icon}</div>
        <div><div class="nm">${esc(d.name)}</div><div class="ds">${ing}${locked ? ` · 🔒 restaurant level ${d.level}` : ''}</div></div>
        <div class="btns"><span class="pr">${money(dishPrice(d) * s.price)}</span>${locked ? '' : `<button class="bet ${on ? 'primary' : ''}" data-act="menu" data-arg="${d.id}">${on ? 'ON' : 'OFF'}</button>`}</div></div>`;
    }).join(''));

    // Pantry: everything the enabled dishes need.
    const need = new Set();
    for (const d of def.dishes) if (s.menu[d.id] && d.level <= s.level) for (const k of Object.keys(d.in)) for (const i of INGREDIENT_GROUPS[k] || [k]) need.add(i);
    const w = ctx.wallet;
    paint('.resto-pantry', `
      <div class="shop-row"><div class="ic">🚚</div><div><div class="nm">Keep it stocked</div>
        <div class="ds">Every few seconds, tops the pantry up from your farm storage.</div></div>
        <div class="btns"><button class="bet ${s.autostock ? 'primary' : ''}" data-act="autostock">${s.autostock ? 'ON' : 'OFF'}</button>
        <button class="bet" data-act="stockall">BRING ALL NOW</button></div></div>
      ${[...need].map((k) => {
    const it = ITEMS[k];
    const have = s.pantry[k] || 0;
    const farm = w.inv[k] || 0;
    const ws = Math.round(it.price * WHOLESALE * 10);
    return `<div class="shop-row"><div class="ic">${it.icon}</div>
          <div><div class="nm">${esc(it.name)} <b>${have}</b> in the pantry</div><div class="ds">${farm} at the farm</div></div>
          <div class="btns"><button class="bet" data-act="stock" data-arg="${k}" ${farm ? '' : 'disabled'}>BRING 10</button>
          <button class="bet" data-act="wholesale" data-arg="${k}" ${w.money >= ws ? '' : 'disabled'} title="From the wholesaler at ${WHOLESALE}× market price">BUY 10 · ${money(ws)}</button></div></div>`;
  }).join('')}`);

    // Staff and refit.
    const cost = Math.round(lot.price * REMODEL_SHARE);
    const others = Object.entries(RESTAURANTS).filter(([k]) => k !== s.type);
    paint('.resto-run', `
      <div class="shop-row"><div class="ic">🧑‍🍳</div><div><div class="nm">Staff</div>
        <div class="ds">Cooks cook, waiters serve, drivers take the phone orders you do not. Hire them at the Job Centre.</div></div>
        <div class="btns"><button class="bet" data-act="staff">STAFF</button></div></div>
      <div class="shop-row"><div class="ic">🛠️</div><div><div class="nm">Refit</div>
        <div class="ds">Turn it into something else for ${money(cost)}. Customers have to leave first.</div></div>
        <div class="btns">${others.map(([k, r]) => `<button class="bet" data-act="remodel" data-arg="${k}" ${w.money >= cost ? '' : 'disabled'}>${r.icon} ${esc(r.name.toUpperCase())}</button>`).join('')}</div></div>`);
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.disabled) { sfx.deny(); return; }
    const s = ctx.resto;
    const act = b.dataset.act;
    const arg = b.dataset.arg;
    const send = (d) => ctx.send('resto', { station, ...d });
    sfx.chip();
    if (act === 'open') send({ action: 'open', on: !s.open });
    else if (act === 'bank') send({ action: 'bank' });
    else if (act === 'cook') send({ action: 'cook', oid: Number(arg) });
    else if (act === 'serve') send({ action: 'serve', oid: Number(arg) });
    else if (act === 'take') send({ action: 'take', id: Number(arg) });
    else if (act === 'menu') send({ action: 'menu', dish: arg, on: !s.menu[arg] });
    else if (act === 'autostock') send({ action: 'autostock', on: !s.autostock });
    else if (act === 'stockall') send({ action: 'stock', item: '*' });
    else if (act === 'stock') send({ action: 'stock', item: arg, qty: 10 });
    else if (act === 'wholesale') send({ action: 'wholesale', item: arg, qty: 10 });
    else if (act === 'remodel') send({ action: 'remodel', type: arg });
    else if (act === 'staff') ctx.open('staff');
  });
  priceIn.addEventListener('change', () => ctx.send('resto', { station, action: 'price', value: Number(priceIn.value) }));
  priceIn.addEventListener('input', () => { root.querySelector('.price-val').textContent = `${Math.round(Number(priceIn.value) * 100)}%`; });

  render();
  // Countdowns tick even when nothing new arrives.
  let acc = 0;
  let last = performance.now();
  return {
    root,
    repaint: render,
    onWallet: render,
    onResto: render,
    onResult() {},
    tick() {
      const now = performance.now();
      acc += now - last;
      last = now;
      if (acc > 1000) {
        acc = 0;
        const s = ctx.resto;
        if (s) {
          for (const o of s.orders) { o.waited++; o.patience--; }
          for (const d of s.deliveries) d.left--;
          if (s.bankIn > 0) s.bankIn--;
          render();
        }
      }
    },
    destroy() {},
  };
}
