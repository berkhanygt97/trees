import {
  WORKER_ROLES, WORKER_TRAITS, CROPS, PROCESSORS, ITEMS, workerWage, money,
} from '/shared/catalog.js';
import { div, esc } from './util.js';
import { sfx } from '../sfx.js';

// The Job Centre (hire people) and the staff room (manage the ones you have).
// Unlike the shop lists, this panel keeps its DOM and only updates text in
// place, so typing a name is never interrupted by a status update.

const speedBar = (s) => `<span class="speed"><i style="width:${Math.round(((s - 0.5) / 1.2) * 100)}%"></i></span><b>${s.toFixed(2)}×</b>`;

function hours(trait) {
  const [a, b] = WORKER_TRAITS[trait].hours;
  const f = (h) => { const x = h % 24; return `${x % 12 || 12}${x < 12 ? 'am' : 'pm'}`; };
  return `${f(a)}–${f(b)}`;
}

function placeLabel(place) { return place === 'farm' ? 'FARM' : 'RESTAURANT'; }

export function createJobCentre(ctx) { return staffPanel(ctx, { hiring: true }); }
export function createStaff(ctx) { return staffPanel(ctx, { hiring: false }); }

function staffPanel(ctx, { hiring }) {
  const station = ctx.station.id;
  const root = div(`
    <p class="shop-note">${hiring
    ? 'Hired hands keep working whenever the host is running, even while you are away. Wages come out every morning; if you cannot pay, they take the day off. Faster workers cost more.'
    : 'Your staff. Rename them, give them jobs and settings, or let them go.'}</p>
    <div class="staff-caps"></div>
    ${hiring ? '<div class="shop-head">TODAY\'S CANDIDATES <span>new faces every morning</span></div><div class="cands shop-list"></div>' : ''}
    <div class="shop-head">YOUR STAFF</div>
    <div class="staff shop-list"></div>`);
  const capsEl = root.querySelector('.staff-caps');
  const candsEl = root.querySelector('.cands');
  const staffEl = root.querySelector('.staff');
  let candKey = '';
  const rows = new Map();

  // ------------------------------------------------------------ candidates

  function roleOptions(w) {
    return Object.entries(WORKER_ROLES).map(([id, r]) => {
      const blocked = r.place === 'restaurant' && !w.restaurant;
      return `<option value="${id}" ${blocked ? 'disabled' : ''}>${r.icon} ${r.name}${blocked ? ' (needs a restaurant)' : ''}</option>`;
    }).join('');
  }

  function renderCandidates() {
    if (!candsEl) return;
    const list = ctx.jobs || [];
    const key = list.map((c) => c.cid).join(',');
    if (key === candKey) { refreshWages(); return; }
    candKey = key;
    candsEl.innerHTML = list.length ? list.map((c) => `
      <div class="shop-row cand" data-cid="${c.cid}">
        <div class="ic">🧑</div>
        <div>
          <div class="nm"><input class="name-in" maxlength="16" value="${esc(c.name)}" title="Their name — change it if you like"></div>
          <div class="ds">${speedBar(c.speed)} · <b>${esc(WORKER_TRAITS[c.trait].name)}</b> — ${esc(WORKER_TRAITS[c.trait].blurb)}</div>
          <div class="ds">Job: <select class="role-in">${roleOptions(ctx.wallet)}</select> <span class="wage"></span></div>
        </div>
        <div class="btns"><button class="bet primary" data-act="hire">HIRE</button></div>
      </div>`).join('') : '<div class="muted">Everybody looking for work today has been hired. Come back tomorrow.</div>';
    refreshWages();
  }

  function refreshWages() {
    if (!candsEl) return;
    for (const row of candsEl.querySelectorAll('.cand')) {
      const c = (ctx.jobs || []).find((q) => q.cid === Number(row.dataset.cid));
      if (!c) continue;
      const role = row.querySelector('.role-in').value;
      const wage = workerWage(role, c.speed, c.trait);
      row.querySelector('.wage').textContent = `· ${money(wage)} a day (first day up front)`;
      const b = row.querySelector('[data-act="hire"]');
      const place = WORKER_ROLES[role].place;
      const full = (ctx.wallet.staff || []).filter((w) => WORKER_ROLES[w.role].place === place).length >= ((ctx.wallet.staffCap || {})[place] || 0);
      b.disabled = ctx.wallet.money < wage || full;
      b.title = full ? `No room for more ${place} staff` : '';
    }
  }

  // ------------------------------------------------------------------ staff

  function configHtml(w) {
    if (w.role === 'field') {
      const opts = CROPS.map((c) => `<option value="${c.id}" ${w.cfg.crop === c.id ? 'selected' : ''} ${ctx.wallet.level < c.level ? 'disabled' : ''}>${c.icon} ${c.name}</option>`).join('');
      return `Plants <select data-cfg="crop">${opts}</select>
        <label class="chk"><input type="checkbox" data-cfg="autobuy" ${w.cfg.autobuy ? 'checked' : ''}> buys seeds when out</label>`;
    }
    if (w.role === 'workshop') {
      const bakery = PROCESSORS.bakery.recipes.map((r) => `<option value="${r.id}" ${(w.cfg.recipe || {}).bakery === r.id ? 'selected' : ''}>${ITEMS[r.id].icon} ${ITEMS[r.id].name}</option>`).join('');
      return `Bakery makes <select data-cfg="bakery">${bakery}</select>`;
    }
    if (w.role === 'seller') {
      const o = [['crops', 'crops'], ['animal', 'eggs and milk'], ['goods', 'flour, cheese, bread, cake'], ['all', 'everything']];
      return `Sells <select data-cfg="sell">${o.map(([v, l]) => `<option value="${v}" ${w.cfg.sell === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    }
    return '';
  }

  function renderStaff() {
    const w = ctx.wallet;
    const caps = w.staffCap || { farm: 0, restaurant: 0 };
    const staff = w.staff || [];
    const n = (place) => staff.filter((s) => WORKER_ROLES[s.role].place === place).length;
    capsEl.innerHTML = `<div class="caps"><span>🏠 Farm staff <b>${n('farm')} / ${caps.farm}</b></span>
      <span>🍔 Restaurant staff <b>${n('restaurant')} / ${caps.restaurant}</b></span>
      <span>💵 Wages <b>${money(staff.reduce((a, s) => a + s.wage, 0))}</b> a day</span></div>`;
    const seen = new Set();
    for (const s of staff) {
      seen.add(s.id);
      let row = rows.get(s.id);
      if (!row) {
        row = div('', 'shop-row staff-row');
        row.dataset.id = s.id;
        row.innerHTML = `
          <div class="ic">${WORKER_ROLES[s.role].icon}</div>
          <div>
            <div class="nm"><input class="name-in" maxlength="16" value="${esc(s.name)}"> <span class="role"></span></div>
            <div class="ds meta"></div>
            <div class="ds cfg">${configHtml(s)}</div>
            <div class="ds status"></div>
          </div>
          <div class="btns"><button class="bet" data-act="fire">LET GO</button></div>`;
        staffEl.appendChild(row);
        rows.set(s.id, row);
      }
      row.querySelector('.role').textContent = `${placeLabel(WORKER_ROLES[s.role].place)} · ${WORKER_ROLES[s.role].name}`;
      row.querySelector('.meta').innerHTML = `${speedBar(s.speed)} · ${esc(WORKER_TRAITS[s.trait].name)} (${hours(s.trait)}) · ${money(s.wage)} a day · ${s.done || 0} jobs today`;
      const st = row.querySelector('.status');
      st.textContent = `▶ ${s.status}`;
      st.className = `ds status ${/day off|full|out of|no /i.test(s.status) ? 'warn' : ''}`;
      const input = row.querySelector('.name-in');
      if (document.activeElement !== input && input.value !== s.name) input.value = s.name;
    }
    for (const [id, row] of rows) {
      if (!seen.has(id)) { row.remove(); rows.delete(id); }
    }
    if (!staff.length && !staffEl.querySelector('.muted')) staffEl.innerHTML = `<div class="muted">Nobody yet.${hiring ? '' : ' The Job Centre in town has people looking for work.'}</div>`;
    else if (staff.length) { const m = staffEl.querySelector('.muted'); if (m) m.remove(); }
    refreshWages();
  }

  // ----------------------------------------------------------------- events

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.classList.contains('role-in')) { refreshWages(); return; }
    const row = t.closest('.staff-row');
    if (!row) return;
    if (t.classList.contains('name-in')) { rename(row, t); return; }
    const key = t.dataset.cfg;
    if (!key) return;
    const cfg = key === 'autobuy' ? { autobuy: t.checked } : key === 'bakery' ? { recipe: { bakery: t.value } } : { [key]: t.value };
    ctx.send('staff', { action: 'config', id: row.dataset.id, cfg });
    sfx.click();
  });

  function rename(row, input) {
    const name = input.value.trim();
    if (!name) return;
    ctx.send('staff', { action: 'rename', id: row.dataset.id, name });
    sfx.chip();
  }

  root.addEventListener('keydown', (e) => {
    // Typing a name must not walk you around or fire your gun.
    e.stopPropagation();
    if (e.key === 'Enter' && e.target.classList.contains('name-in')) e.target.blur();
  });

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.disabled) { sfx.deny(); return; }
    if (b.dataset.act === 'hire') {
      const row = b.closest('.cand');
      ctx.send('hire', { station, cid: Number(row.dataset.cid), role: row.querySelector('.role-in').value, name: row.querySelector('.name-in').value });
      sfx.chip();
    } else if (b.dataset.act === 'fire') {
      // Two clicks, so nobody is let go by accident.
      if (b.dataset.sure !== '1') {
        b.dataset.sure = '1';
        b.textContent = 'SURE?';
        setTimeout(() => { b.dataset.sure = ''; b.textContent = 'LET GO'; }, 2500);
        return;
      }
      ctx.send('staff', { action: 'fire', id: b.closest('.staff-row').dataset.id });
      sfx.click();
    }
  });

  renderCandidates();
  renderStaff();
  return {
    root,
    repaint() { renderCandidates(); renderStaff(); },
    onWallet() { renderStaff(); },
    onJobs() { renderCandidates(); },
    onResult() {},
    tick() {},
    destroy() {},
  };
}
