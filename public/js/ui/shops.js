import {
  CROPS, ITEMS, HOUSES, ANIMAL_HOUSES, PROCESSORS, FIELD_SIZES, FIELD_PRICES, FIELD_LEVELS,
  VEHICLES, IMPLEMENTS, GUNS, RESTAURANTS, RESTO_SLOT_LEVELS, boarStats, money,
} from '/shared/catalog.js';
import { LOTS, LOT_LEVEL, ROADS as STREETS } from '/shared/map.js';
import { div, esc } from './util.js';
import { sfx } from '../sfx.js';

/**
 * A panel that re-renders from the wallet whenever it changes. Buttons carry
 * data-act/data-arg; one delegated listener sends the matching message.
 */
export function listPanel(ctx, render, onAct) {
  const root = div('');
  let shown = '';
  // Only touch the DOM when something changed, so a click is never swallowed
  // by a repaint landing between mousedown and mouseup.
  const paint = () => {
    const html = render(ctx.wallet);
    if (html !== shown) { shown = html; root.innerHTML = html; }
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) { if (b) sfx.deny(); return; }
    sfx.chip();
    onAct(b.dataset.act, b.dataset.arg, b);
  });
  paint();
  return {
    root,
    repaint: paint,
    onWallet: paint,
    onResult() { paint(); },
    tick() {},
    destroy() {},
  };
}

export function row({ icon, name, desc = '', price = '', buttons = '', locked = false, owned = false }) {
  return `<div class="shop-row ${locked ? 'locked' : ''} ${owned ? 'owned' : ''}">
    <div class="ic">${icon}</div>
    <div><div class="nm">${esc(name)}</div><div class="ds">${desc}</div></div>
    <div class="btns">${price ? `<span class="pr">${price}</span>` : ''}${buttons}</div>
  </div>`;
}

export const btn = (label, act, arg = '', { disabled = false, primary = true } = {}) =>
  `<button class="bet ${primary ? 'primary' : ''}" data-act="${act}" data-arg="${esc(arg)}" ${disabled ? 'disabled' : ''}>${label}</button>`;

const lockText = (lvl) => `🔒 Farm level ${lvl}`;

// -------------------------------------------------------------- farm shop

export function createFarmShop(ctx) {
  const station = ctx.station.id;
  return listPanel(ctx, (w) => `
    <p class="shop-note">Seeds are sold by the bag. Better crops unlock as your farm levels up.
      Watered crops grow 50% faster; rain does it for free.</p>
    <div class="shop-list">
      ${CROPS.map((c) => {
        const locked = w.level < c.level;
        const have = w.inv[`seed:${c.id}`] || 0;
        const regrow = c.regrow ? ` · regrows ${c.harvests - 1}× more` : '';
        return row({
          icon: c.icon, name: `${c.name} seeds`, locked,
          desc: locked ? lockText(c.level)
            : `${c.grow} min to grow · ${c.yield} per tile · sells ~${money(c.price)} each${regrow}<br>You have <b>${have}</b>`,
          price: `${money(c.seed)} ea`,
          buttons: locked ? '' : [10, 50].map((n) => btn(`×${n}`, 'seed', `${c.id}:${n}`, { disabled: w.money < c.seed * n })).join(''),
        });
      }).join('')}
    </div>
    ${w.charity ? `<div class="shop-head">OUT OF LUCK?</div>
      ${row({ icon: '🤝', name: 'A helping hand', desc: 'Old Pete takes pity on broke farmers once a day.', buttons: btn('ASK FOR SEEDS', 'charity') })}` : ''}
  `, (act, arg) => {
    if (act === 'seed') {
      const [id, n] = arg.split(':');
      ctx.send('buy', { station, sku: `seed:${id}`, qty: Number(n) });
    }
    if (act === 'charity') ctx.send('charity', { station });
  });
}

// ------------------------------------------------------------- animal shop

export function createAnimalShop(ctx) {
  const station = ctx.station.id;
  return listPanel(ctx, (w) => {
    const b = w.buildings || {};
    const rows = [];
    for (const [kind, def] of Object.entries(ANIMAL_HOUSES)) {
      const built = b[kind];
      const locked = w.level < def.level;
      rows.push(row({
        icon: kind === 'coop' ? '🏠' : kind === 'pen' ? '🚧' : '🏚️', name: def.name, locked, owned: !!built,
        desc: locked ? lockText(def.level) : built ? 'Built on your farm.' : `Holds up to ${def.max} ${def.animalName.toLowerCase()}s. Built on your farm straight away.`,
        price: built ? '' : money(def.price),
        buttons: built || locked ? '' : btn('BUILD', 'build', kind, { disabled: w.money < def.price }),
      }));
      const n = built ? built.animals : 0;
      const product = ITEMS[def.product];
      rows.push(row({
        icon: def.animalIcon, name: def.animalName, locked: !built,
        desc: built
          ? `You have <b>${n} / ${def.max}</b>. Each makes ${product.icon} ${product.name.toLowerCase()} every ${def.every / 60000} min when fed (${def.feedPer} feed each).`
          : `Needs a ${def.name.toLowerCase()} first.`,
        price: money(def.animalPrice),
        buttons: built ? btn('BUY', 'animal', kind, { disabled: w.money < def.animalPrice || n >= def.max }) : '',
      }));
    }
    rows.push(row({
      icon: ITEMS.feed.icon, name: 'Animal feed',
      desc: `Fills troughs. Wheat works too, one for one. You have <b>${w.inv.feed || 0}</b>.`,
      price: `${money(ITEMS.feed.price)} ea`,
      buttons: [20, 100].map((n) => btn(`×${n}`, 'feed', String(n), { disabled: w.money < ITEMS.feed.price * n })).join(''),
    }));
    return `<p class="shop-note">Animals keep producing while you are off doing other things — even while you are offline, as long as the host is running. Feed them, and empty the coop now and then.</p>
      <div class="shop-list">${rows.join('')}</div>`;
  }, (act, arg) => {
    if (act === 'build') ctx.send('buy', { station, sku: arg });
    if (act === 'animal') ctx.send('buy', { station, sku: `animal:${arg}` });
    if (act === 'feed') ctx.send('buy', { station, sku: 'feed', qty: Number(arg) });
  });
}

// ---------------------------------------------------------------- builder

export function createBuilder(ctx) {
  const station = ctx.station.id;
  return listPanel(ctx, (w) => {
    const houses = HOUSES.slice(1).map((h) => {
      const owned = w.house >= h.tier;
      const next = w.house + 1 === h.tier;
      const locked = w.level < h.level;
      return row({
        icon: ['⛺', '🛖', '🏡', '🏰'][h.tier], name: h.name, owned, locked: locked && !owned,
        desc: owned ? 'Yours.' : `${h.blurb} Storage for ${h.storage.toLocaleString('en-US')} items.${locked ? `<br>${lockText(h.level)}` : ''}`,
        price: owned ? '' : money(h.price),
        buttons: owned || locked ? '' : btn(next ? 'BUILD' : 'LATER', 'house', String(h.tier), { disabled: !next || w.money < h.price }),
      });
    });
    const procs = Object.entries(PROCESSORS).map(([kind, def]) => {
      const built = w.buildings && w.buildings[kind];
      const locked = w.level < def.level;
      const recipes = def.recipes.map((r) => `${Object.entries(r.in).map(([k, n]) => `${n}${ITEMS[k].icon}`).join(' + ')} → ${ITEMS[r.id].icon} ${ITEMS[r.id].name}`).join('<br>');
      return row({
        icon: { mill: '🌬️', dairy: '🥛', bakery: '🥖' }[kind], name: def.name, owned: !!built, locked: locked && !built,
        desc: built ? `Built. ${recipes}` : `${recipes}${locked ? `<br>${lockText(def.level)}` : ''}`,
        price: built ? '' : money(def.price),
        buttons: built || locked ? '' : btn('BUILD', 'proc', kind, { disabled: w.money < def.price }),
      });
    });
    return `<p class="shop-note">You live in a ${HOUSES[w.house].name.toLowerCase()}. Bigger houses store more,
      and everybody driving past can see how well you are doing.</p>
      <div class="shop-head">HOUSES</div><div class="shop-list">${houses.join('')}</div>
      <div class="shop-head">WORKSHOPS <span>turn cheap goods into expensive ones</span></div><div class="shop-list">${procs.join('')}</div>`;
  }, (act, arg) => {
    if (act === 'house') ctx.send('buy', { station, sku: `house:${arg}` });
    if (act === 'proc') ctx.send('buy', { station, sku: arg });
  });
}

// ------------------------------------------------------------ land office

export function createLandOffice(ctx) {
  const station = ctx.station.id;
  return listPanel(ctx, (w) => `
    <p class="shop-note">Your field is <b>${w.fieldSize}×${w.fieldSize}</b> (${w.fieldSize * w.fieldSize} tiles).
      Each expansion grows it towards the back of your farm.</p>
    <div class="shop-list">
      ${FIELD_SIZES.slice(1).map((size, i) => {
        const step = i + 1;
        const owned = w.fieldSize >= size;
        const next = FIELD_SIZES[step - 1] === w.fieldSize;
        const locked = w.level < FIELD_LEVELS[step];
        return row({
          icon: '🗺️', name: `${size}×${size} field`, owned, locked: locked && !owned,
          desc: owned ? 'Yours.' : `${size * size} tiles — ${size * size - FIELD_SIZES[step - 1] ** 2} more than the last one.${locked ? `<br>${lockText(FIELD_LEVELS[step])}` : ''}`,
          price: owned ? '' : money(FIELD_PRICES[step]),
          buttons: owned || locked ? '' : btn(next ? 'BUY' : 'LATER', 'field', String(step), { disabled: !next || w.money < FIELD_PRICES[step] }),
        });
      }).join('')}
    </div>
    ${lotsSection(ctx, w)}`, (act, arg) => {
    if (act === 'field') ctx.send('buy', { station, sku: `field:${arg}` });
    if (act === 'lot') {
      const [lot, type] = arg.split(':');
      ctx.send('buy', { station, sku: `lot:${lot}`, type });
    }
  });
}

/** The lots this farmer may build on: their own neighbourhood's (or the Strip's). */
export function lotsFor(w) {
  if (w && Array.isArray(w.lotIds)) return LOTS.filter((l) => w.lotIds.includes(l.id));
  return LOTS;
}

/** Restaurant lots: a little map, then one row per lot. */
function lotsSection(ctx, w) {
  const owners = new Map((ctx.restaurants || []).map((r) => [r.lot, r]));
  const mine = new Set((w.restaurants || []).map((r) => r.lot));
  const slots = w.restoSlots || 0;
  const full = mine.size >= slots;
  const lots = lotsFor(w);
  if (!lots.length) return '';
  // An SVG sketch of the lots and the street between them, coloured by owner.
  const x0 = Math.min(...lots.map((l) => l.x0)) - 6;
  const x1 = Math.max(...lots.map((l) => l.x1)) + 6;
  const z0 = Math.min(...lots.map((l) => l.z0)) - 4;
  const z1 = Math.max(...lots.map((l) => l.z1)) + 4;
  const W = 600;
  const H = Math.round(Math.min(220, Math.max(110, (W * (z1 - z0)) / (x1 - x0))));
  const sx = (x) => ((x - x0) / (x1 - x0)) * W;
  const sz = (z) => ((z - z0) / (z1 - z0)) * H;
  const street = STREETS.find((st) => lots.every((l) => l.x0 >= st.x0 - 1 && l.x1 <= st.x1 + 1)) || null;
  const map = `<svg class="strip-map" viewBox="0 0 ${W} ${H}">
    ${street ? `<rect x="0" y="${sz(street.z0)}" width="${W}" height="${sz(street.z1) - sz(street.z0)}" fill="#2d2f36"/>
    <line x1="0" x2="${W}" y1="${(sz(street.z0) + sz(street.z1)) / 2}" y2="${(sz(street.z0) + sz(street.z1)) / 2}" stroke="#f2c14e" stroke-dasharray="10 8"/>` : ''}
    ${lots.map((l) => {
    const o = owners.get(l.id);
    const fill = mine.has(l.id) ? '#6bd66b' : o ? o.color : 'rgba(255,255,255,0.12)';
    return `<rect x="${sx(l.x0)}" y="${sz(l.z0)}" width="${sx(l.x1) - sx(l.x0)}" height="${sz(l.z1) - sz(l.z0)}" rx="4" fill="${fill}" stroke="#fff" stroke-opacity="0.5"/>
      <text x="${(sx(l.x0) + sx(l.x1)) / 2}" y="${(sz(l.z0) + sz(l.z1)) / 2 + 5}" text-anchor="middle" fill="#fff" font-size="15" font-weight="800">${o ? RESTAURANTS[o.type].icon : l.label || l.id}</text>`;
  }).join('')}</svg>`;
  const locked = w.level < LOT_LEVEL;
  const rows = lots.map((l) => {
    const o = owners.get(l.id);
    const title = `Lot ${l.label || l.id} · ${l.name}`;
    if (o) {
      return row({ icon: RESTAURANTS[o.type].icon, name: title, owned: mine.has(l.id),
        desc: `${mine.has(l.id) ? 'Your' : `${esc(o.ownerName)}'s`} ${RESTAURANTS[o.type].name.toLowerCase()}, level ${o.level}.` });
    }
    const why = locked ? `<br>🔒 Farm level ${LOT_LEVEL}` : full ? `<br>${slots ? `You run ${mine.size} of ${slots}; the next one unlocks at farm level ${RESTO_SLOT_LEVELS[mine.size] || '—'}.` : ''}` : ' Pick what it will be:';
    return row({
      icon: '🏗️', name: title, locked,
      desc: `${l.tables} tables.${why}`,
      price: money(l.price),
      buttons: locked || full ? '' : Object.entries(RESTAURANTS).map(([k, r]) => btn(`${r.icon} ${r.name.split(' ')[0].toUpperCase()}`, 'lot', `${l.id}:${k}`, { disabled: w.money < l.price })).join(''),
    });
  });
  return `<div class="shop-head">RESTAURANT LOTS <span>you run ${mine.size} of ${slots} · more unlock as your farm grows</span></div>
    ${map}<div class="shop-list">${rows.join('')}</div>`;
}

// ------------------------------------------------------ machinery dealer

export function createMachinery(ctx) {
  const station = ctx.station.id;
  return listPanel(ctx, (w) => {
    const owns = (id) => ctx.vehicles.filter((v) => v.model === id).length;
    const machines = VEHICLES.filter((v) => v.kind === 'machine').map((m) => row({
      icon: m.id === 'tractor' ? '🚜' : '🌾', name: m.name, owned: owns(m.id) > 0,
      desc: `${m.blurb}${owns(m.id) ? `<br>You own ${owns(m.id)}.` : ''}`,
      price: money(m.price),
      buttons: btn('BUY', 'vehicle', m.id, { disabled: w.money < m.price }),
    }));
    const hasTractor = owns('tractor') > 0;
    const imps = IMPLEMENTS.map((i) => {
      const owned = (w.implements || []).includes(i.id);
      return row({
        icon: { plow: '⛏️', seeder: '🌱', tank: '💧' }[i.id], name: i.name, owned,
        desc: `${i.blurb}${owned ? ' Owned — press G in the tractor to hitch it.' : hasTractor ? '' : ' Needs a tractor.'}`,
        price: owned ? '' : money(i.price),
        buttons: owned ? '' : btn('BUY', 'implement', i.id, { disabled: w.money < i.price }),
      });
    });
    return `<p class="shop-note">Delivered to the kerb outside. Drive it home, roll over your field and it
      does the work — three rows at a time for the tractor, five for the combine.</p>
      <div class="shop-head">MACHINES</div><div class="shop-list">${machines.join('')}</div>
      <div class="shop-head">IMPLEMENTS <span>for the tractor</span></div><div class="shop-list">${imps.join('')}</div>`;
  }, (act, arg) => {
    if (act === 'vehicle') ctx.send('buy', { station, sku: `vehicle:${arg}`, color: '#d93a3a' });
    if (act === 'implement') ctx.send('buy', { station, sku: `implement:${arg}` });
  });
}

// --------------------------------------------------------------- gun shop

export function createGunShop(ctx) {
  const station = ctx.station.id;
  const bar = (v, max) => `<i style="--v:${Math.round(Math.min(1, v / max) * 100)}%"></i>`;
  return listPanel(ctx, (w) => {
    const boar = boarStats(w.level);
    const rows = GUNS.map((g) => {
      const owned = (w.guns || []).includes(g.id);
      const locked = w.level < g.level;
      const dps = (g.damage * g.pellets) / g.rate;
      const shotsToKill = Math.ceil(boar.hp / (g.damage * g.pellets));
      return row({
        icon: { boltrifle: '🪵', lever: '🤠', shotgun: '💥', semiauto: '⚙️', biggame: '🦏' }[g.id],
        name: g.name, owned, locked: locked && !owned,
        desc: `${g.blurb}
          <div class="stat">DAMAGE ${bar(g.damage * g.pellets, 180)} ${g.pellets > 1 ? `${g.pellets}×${g.damage}` : g.damage}</div>
          <div class="stat">SPEED ${bar(1 / g.rate, 4)} ${g.rate}s a shot</div>
          <div class="stat">MAGAZINE ${bar(g.mag, 15)} ${g.mag} · reload ${g.reload}s</div>
          <div class="ds">${shotsToKill} body shot${shotsToKill === 1 ? '' : 's'} per boar at your level · ${Math.round(dps)} damage a second${locked ? `<br>🔒 Farm level ${g.level}` : ''}</div>`,
        price: owned ? '' : g.price ? money(g.price) : 'free',
        buttons: owned
          ? (w.gun === g.id ? '<span class="pr">IN HAND</span>' : btn('USE', 'equip', g.id, { primary: false }))
          : locked ? '' : btn('BUY', 'gun', g.id, { disabled: w.money < g.price }),
      });
    });
    return `<p class="shop-note">"Boars at your level have <b>${boar.hp} health</b> and come ${boar.count} at a time. Grandpa's rifle
      will do it, if you are patient." Ammo is on the house. <kbd>Q</kbd> gets your gun out anywhere.</p>
      <div class="shop-list">${rows.join('')}</div>`;
  }, (act, arg) => {
    if (act === 'gun') ctx.send('buy', { station, sku: `gun:${arg}` });
    if (act === 'equip') ctx.send('equip', { gun: arg });
  });
}
