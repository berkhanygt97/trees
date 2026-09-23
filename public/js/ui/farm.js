import { ITEMS, HOUSES, ANIMAL_HOUSES, PROCESSORS, PROCESS_QUEUE_MAX, money } from '/shared/catalog.js';
import { listPanel, row, btn } from './shops.js';
import { esc } from './util.js';

const mins = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
};

const meter = (frac) => `<div class="meter"><i style="width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%"></i></div>`;

/** Live panels (timers) repaint twice a second. */
function live(panel) {
  let acc = 0;
  let last = performance.now();
  panel.tick = () => {
    const now = performance.now();
    acc += now - last;
    last = now;
    if (acc > 500) { acc = 0; panel.repaint(); }
  };
  return panel;
}

// ------------------------------------------------------------------ house

export function createHouse(ctx) {
  return listPanel(ctx, (w) => {
    const h = HOUSES[w.house];
    const next = HOUSES[w.house + 1];
    const inv = Object.entries(w.inv).filter(([, n]) => n > 0);
    return `
      <p class="shop-note">Home sweet ${h.name.toLowerCase()}. ${esc(h.blurb)}</p>
      <div class="shop-head">STORAGE <span>${w.storage.used} / ${w.storage.cap}</span></div>
      ${meter(w.storage.used / w.storage.cap)}
      <div class="invgrid">${inv.map(([k, n]) => `<div class="inv inv-${ITEMS[k].kind}"><span>${ITEMS[k].icon}</span><b>${n}</b><i>${esc(ITEMS[k].name)}</i></div>`).join('') || '<div class="muted">Nothing stored.</div>'}</div>
      <div class="shop-head">YOUR FARM</div>
      <div class="shop-list">
        ${row({ icon: '🌾', name: `Field ${w.fieldSize}×${w.fieldSize}`, desc: 'The Land Office in town sells bigger fields.' })}
        ${row({ icon: '📈', name: `Farm level ${w.level}`, desc: `${w.levelInto} / ${w.levelNeed || '—'} xp to the next level. Harvesting, selling and filling orders all count.` })}
        ${next ? row({ icon: '🏗️', name: `Next: ${next.name}`, desc: `${money(next.price)} at the Builder's Yard${w.level < next.level ? ` (level ${next.level})` : ''}. Stores ${next.storage.toLocaleString('en-US')}.` }) : ''}
        ${row({ icon: '📐', name: 'Plan my farm', desc: 'Move and turn your buildings and the field on a blueprint of your plot.', buttons: btn('PLANNER', 'plan') })}
        ${row({ icon: '🧮', name: 'Lifetime', desc: `Harvested ${w.stats.harvested.toLocaleString('en-US')} · sold ${money(w.stats.sold)} · orders ${w.stats.orders} · gambled ${money(w.stats.wagered)}` })}
      </div>`;
  }, (act) => {
    if (act === 'plan') ctx.open('planner');
  });
}

// ---------------------------------------------------------------- animals

function createAnimalHouse(ctx, kind) {
  const def = ANIMAL_HOUSES[kind];
  const station = ctx.station.id;
  const product = ITEMS[def.product];
  return live(listPanel(ctx, (w) => {
    const b = w.buildings[kind];
    if (!b) return '<p class="shop-note">Nothing built here yet.</p>';
    const now = ctx.worldTime();
    const hungry = b.feed < def.feedPer;
    const full = b.stock >= def.stockCap;
    const next = b.last + def.every - now;
    const status = !b.animals ? `No ${def.animalName.toLowerCase()}s yet — buy some at Cluck & Moo in town.`
      : hungry ? `They are hungry. Fill the trough or nothing gets made.`
        : full ? `Full up — collect before they can make more.`
          : `Next batch in about ${mins(next)}.`;
    return `
      <p class="shop-note">${def.animalIcon.repeat(Math.max(1, b.animals))} <b>${b.animals} / ${def.max}</b> ${def.animalName.toLowerCase()}s. ${status}</p>
      <div class="shop-head">TROUGH <span>${b.feed} / ${def.feedCap} feed</span></div>
      ${meter(b.feed / def.feedCap)}
      <div class="shop-head">READY <span>${b.stock} / ${def.stockCap}</span></div>
      ${meter(b.stock / def.stockCap)}
      <div class="shop-list">
        ${row({ icon: '🌰', name: 'Fill the trough', desc: `Uses feed first (${w.inv.feed || 0}), then wheat (${w.inv.wheat || 0}). Each ${def.animalName.toLowerCase()} eats ${def.feedPer} per batch.`, buttons: btn('FEED', 'feed', '', { disabled: !(w.inv.feed || w.inv.wheat) || b.feed >= def.feedCap }) })}
        ${row({ icon: product.icon, name: `Collect ${product.name.toLowerCase()}`, desc: `Worth about ${money(product.price)} each at the market.`, buttons: btn(`COLLECT ${b.stock}`, 'collect', '', { disabled: !b.stock }) })}
      </div>`;
  }, (act) => {
    ctx.send('farm', { station, action: act });
  }));
}

export const createCoop = (ctx) => createAnimalHouse(ctx, 'coop');
export const createBarn = (ctx) => createAnimalHouse(ctx, 'barn');

// ------------------------------------------------------------- processors

function createProcessor(ctx, kind) {
  const def = PROCESSORS[kind];
  const station = ctx.station.id;
  return live(listPanel(ctx, (w) => {
    const b = w.buildings[kind];
    if (!b) return '<p class="shop-note">Nothing built here yet.</p>';
    const now = ctx.worldTime();
    const running = b.recipe && def.recipes.find((r) => r.id === b.recipe);
    const out = Object.entries(b.out || {}).filter(([, n]) => n > 0);
    const outCount = out.reduce((s, [, n]) => s + n, 0);
    const current = running
      ? `<div class="shop-head">WORKING <span>${ITEMS[running.id].icon} ${ITEMS[running.id].name} · ${b.queue} in the queue</span></div>
         ${meter((now - b.started) / running.time)}
         <p class="shop-note">This batch is done in ${mins(b.started + running.time - now)}; the whole queue in ${mins(b.started + running.time * b.queue - now)}.</p>`
      : '<p class="shop-note">Idle. Load a recipe below.</p>';
    const recipes = def.recipes.map((r) => {
      const need = Object.entries(r.in);
      const can = Math.min(PROCESS_QUEUE_MAX - b.queue, ...need.map(([k, n]) => Math.floor((w.inv[k] || 0) / n)));
      const blocked = b.recipe && b.recipe !== r.id;
      const inText = need.map(([k, n]) => `${n} ${ITEMS[k].icon} (have ${w.inv[k] || 0})`).join(' + ');
      return row({
        icon: ITEMS[r.id].icon, name: ITEMS[r.id].name, locked: blocked,
        desc: `${inText} → 1 ${ITEMS[r.id].name.toLowerCase()} (~${money(ITEMS[r.id].price)}) · ${mins(r.time)} each${blocked ? '<br>Wait for the current batch to finish.' : ''}`,
        buttons: blocked ? '' : [1, 5].map((n) => btn(`×${n}`, 'load', `${r.id}:${n}`, { disabled: can < n, primary: false })).join('')
          + btn(`MAX ${Math.max(0, can)}`, 'load', `${r.id}:${Math.max(1, can)}`, { disabled: can < 1 }),
      });
    });
    return `${current}
      <div class="shop-list" style="margin-bottom:12px">${row({
        icon: '📦', name: 'Finished goods',
        desc: out.length ? out.map(([k, n]) => `${n} ${ITEMS[k].icon} ${ITEMS[k].name}`).join(', ') : 'Nothing ready yet.',
        buttons: btn(`COLLECT ${outCount}`, 'collect', '', { disabled: !outCount }),
      })}</div>
      <div class="shop-head">RECIPES</div><div class="shop-list">${recipes.join('')}</div>`;
  }, (act, arg) => {
    if (act === 'collect') ctx.send('farm', { station, action: 'collect' });
    if (act === 'load') {
      const [recipe, count] = arg.split(':');
      ctx.send('farm', { station, action: 'load', recipe, count: Number(count) });
    }
  }));
}

export const createMill = (ctx) => createProcessor(ctx, 'mill');
export const createDairy = (ctx) => createProcessor(ctx, 'dairy');
export const createBakery = (ctx) => createProcessor(ctx, 'bakery');
