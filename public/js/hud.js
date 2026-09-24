import { CONFIG, money } from '/shared/config.js';
import { CROPS, ITEMS, DAY_MS, HOUR_MS } from '/shared/catalog.js';
import { sfx } from './sfx.js';
import { drawCluster } from './cockpit.js';

const $ = (sel) => document.querySelector(sel);

const WEATHER = {
  clear: ['☀️', 'Clear'],
  cloudy: ['⛅', 'Cloudy'],
  rain: ['🌧️', 'Rain — fields watered'],
  storm: ['⛈️', 'Storm — harvest ripe crops!'],
};

export const hud = {
  chipValue: CONFIG.CHIPS[2],
  wallet: { money: 0, netWorth: 0, inv: {}, level: 1, storage: { used: 0, cap: 0 } },
  round: null,
  meId: null,
  seed: 'wheat',
  _panelOpen: false,
  _onChip: null,

  init({ onChip } = {}) {
    this._onChip = onChip;
    this.el = {
      hud: $('#hud'),
      money: $('#w-money'),
      worth: $('#w-worth'),
      level: $('#w-level'),
      xp: $('#w-xp'),
      storage: $('#w-storage'),
      rnum: $('#r-num'),
      clock: $('#r-clock'),
      weather: $('#r-weather'),
      event: $('#r-event'),
      mini: $('#mini-list'),
      prompt: $('#prompt'),
      prompt2: $('#prompt2'),
      toasts: $('#toasts'),
      feed: $('#feed'),
      pops: $('#pops'),
      board: $('#board'),
      boardTable: $('#board-table'),
      boardInv: $('#board-inv'),
      boardStorage: $('#board-storage'),
      help: $('#help'),
      seedbar: $('#seedbar'),
      speedo: $('#speedo'),
      cluster: $('#s-cluster'),
      crosshair: $('#crosshair'),
      hitmark: $('#hitmark'),
      health: $('#health'),
      hpFill: $('#hp-fill'),
      ammo: $('#ammo'),
      ammoMag: $('#ammo-mag'),
      ammoMax: $('#ammo-max'),
      ammoName: $('#ammo-name'),
      ko: $('#ko'),
      carName: $('#s-name'),
      carHint: $('#s-hint'),
      panel: $('#panel'),
      panelTitle: $('#panel-title'),
      panelBody: $('#panel-body'),
      chipbar: $('#chipbar'),
    };
    this._buildChips();
    this._buildSeeds();
    this.el.hud.hidden = false;
  },

  // ------------------------------------------------------------ chip stack

  _buildChips() {
    const bar = this.el.chipbar;
    bar.innerHTML = '<span class="lbl">CHIP</span>';
    for (const v of CONFIG.CHIPS) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.dataset.v = v;
      b.textContent = `$${v >= 1000 ? `${v / 1000}K` : v}`;
      b.onclick = () => this.setChip(v);
      bar.appendChild(b);
    }
    const hint = document.createElement('span');
    hint.className = 'lbl';
    hint.style.marginLeft = 'auto';
    hint.textContent = 'KEYS 1-6';
    bar.appendChild(hint);
    this.setChip(this.chipValue);
  },

  setChip(v) {
    this.chipValue = v;
    for (const b of this.el.chipbar.querySelectorAll('.chip')) {
      b.classList.toggle('sel', Number(b.dataset.v) === v);
    }
    sfx.click();
    if (this._onChip) this._onChip(v);
  },

  chipFor(maxAffordable = Infinity) {
    return Math.min(this.chipValue, maxAffordable);
  },

  // ----------------------------------------------------------------- seeds

  _buildSeeds() {
    this.el.seedbar.innerHTML = CROPS.map((c, i) => `
      <div class="seed" data-seed="${c.id}">
        <kbd>${i + 1}</kbd><span class="ic">${c.icon}</span><b data-n>0</b>
        <i class="lock">LVL ${c.level}</i>
      </div>`).join('');
    this.setSeed(this.seed);
  },

  setSeed(id) {
    this.seed = id;
    for (const el of this.el.seedbar.querySelectorAll('.seed')) el.classList.toggle('sel', el.dataset.seed === id);
  },

  cycleSeed(dir) {
    const i = CROPS.findIndex((c) => c.id === this.seed);
    const next = CROPS[(i + dir + CROPS.length) % CROPS.length];
    this.setSeed(next.id);
    return next;
  },

  showSeeds(v) { this.el.seedbar.hidden = !v; },

  // --------------------------------------------------------------- wallet

  setWallet(w) {
    const before = this.wallet;
    this.wallet = w;
    // San Andreas style: a green, zero-padded dollar counter.
    this.el.money.textContent = `$${String(Math.max(0, Math.round(w.money))).padStart(8, '0')}`;
    this.el.worth.textContent = `net worth ${money(w.netWorth)}${w.tills ? ` · 🏦 tills ${money(w.tills)}` : ''}`;
    this.el.level.textContent = `LVL ${w.level}`;
    this.el.xp.style.width = `${Math.round(w.levelFrac * 100)}%`;
    const full = w.storage.used >= w.storage.cap;
    this.el.storage.textContent = `📦 ${w.storage.used} / ${w.storage.cap}${full ? '  FULL' : ''}`;
    this.el.storage.classList.toggle('full', full);
    for (const b of this.el.chipbar.querySelectorAll('.chip')) {
      b.disabled = Number(b.dataset.v) > w.money;
    }
    for (const el of this.el.seedbar.querySelectorAll('.seed')) {
      const crop = CROPS.find((c) => c.id === el.dataset.seed);
      el.querySelector('[data-n]').textContent = w.inv[`seed:${crop.id}`] || 0;
      el.classList.toggle('locked', w.level < crop.level);
    }
    this._renderInventory();
    if (before && before.money != null && w.money !== before.money && Math.abs(w.money - before.money) >= 1 && !this._panelOpen) {
      const d = w.money - before.money;
      this.pop(`${d > 0 ? '+' : '-'}${money(Math.abs(d)).replace('-', '')}`, d > 0 ? 'win' : 'loss');
    }
  },

  _renderInventory() {
    const w = this.wallet;
    const entries = Object.entries(w.inv || {}).filter(([, n]) => n > 0)
      .sort((a, b) => (ITEMS[a[0]].kind === 'seed') - (ITEMS[b[0]].kind === 'seed') || a[0].localeCompare(b[0]));
    this.el.boardStorage.textContent = `${w.storage.used} / ${w.storage.cap}`;
    this.el.boardInv.innerHTML = entries.length ? entries.map(([k, n]) => `
      <div class="inv inv-${ITEMS[k].kind}"><span>${ITEMS[k].icon}</span><b>${n}</b><i>${esc(ITEMS[k].name)}</i></div>`).join('')
      : '<div class="muted">Empty. Go grow something.</div>';
  },

  // ---------------------------------------------------------------- clock

  setClock(worldTime, weather) {
    const day = Math.floor(worldTime / DAY_MS) + 1;
    const h = Math.floor((worldTime % DAY_MS) / HOUR_MS);
    const m = Math.floor(((worldTime % HOUR_MS) / HOUR_MS) * 60 / 10) * 10;
    const text = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (text !== this._clockShown) {
      this._clockShown = text;
      this.el.clock.textContent = text;
      this.el.rnum.textContent = `DAY ${day}`;
    }
    if (weather !== this._weatherShown) {
      this._weatherShown = weather;
      const [icon, label] = WEATHER[weather] || WEATHER.clear;
      this.el.weather.textContent = `${icon} ${label}`;
    }
  },

  // ---------------------------------------------------------------- casino

  setRound(r) {
    this.round = r;
    if (r.event) {
      this.el.event.hidden = false;
      this.el.event.querySelector('b').textContent = `🎰 ${r.event.name}`;
      this.el.event.querySelector('i').textContent = r.event.desc;
    } else {
      this.el.event.hidden = true;
    }
  },

  // ---------------------------------------------------------- leaderboard

  setBoard(rows) {
    const top = rows.slice(0, 6);
    this.el.mini.innerHTML = top.map((r, i) => `
      <li class="${r.id === this.meId ? 'me' : ''} ${r.online ? '' : 'off'}">
        <span class="dot" style="background:${r.color}"></span>
        <span class="nm">${i + 1}. ${esc(r.name)}</span>
        <span class="pf">${short(r.netWorth)}</span>
      </li>`).join('');

    this.el.boardTable.innerHTML = `
      <tr><th>#</th><th>FARMER</th><th class="num">NET WORTH</th><th class="num">CASH</th>
          <th class="num">LVL</th><th class="num">HARVESTED</th><th class="num">GAMBLED</th><th class="num">BEST WIN</th></tr>
      ${rows.map((r, i) => `
        <tr class="${r.id === this.meId ? 'me' : ''} ${r.online ? '' : 'off'}">
          <td>${i + 1}</td>
          <td><span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${r.color};margin-right:7px"></span>${esc(r.name)}${r.online ? '' : ' <small>(asleep)</small>'}</td>
          <td class="num up">${money(r.netWorth)}</td>
          <td class="num">${money(r.money)}</td>
          <td class="num">${r.level}</td>
          <td class="num">${(r.harvested || 0).toLocaleString('en-US')}</td>
          <td class="num">${money(r.wagered)}</td>
          <td class="num">${money(r.biggestWin)}</td>
        </tr>`).join('')}`;
  },

  showBoard(v) { this.el.board.hidden = !v; },
  toggleHelp(v) { this.el.help.hidden = v === undefined ? !this.el.help.hidden : !v; },

  // ---------------------------------------------------------------- speedo

  /** The instrument cluster: drawn on screen in chase view; in the seat it is on the dashboard. */
  setSpeedo(car) {
    if (!car) { this.el.speedo.hidden = true; return; }
    this.el.speedo.hidden = false;
    this.el.speedo.classList.toggle('cockpit', !!car.cockpit);
    if (!car.cockpit) {
      const now = performance.now();
      if (!this._clusterAt || now - this._clusterAt > 33) {
        this._clusterAt = now;
        const cv = this.el.cluster;
        drawCluster(cv.getContext('2d'), cv.width, cv.height, { speed: car.speed, top: car.top, body: car.body, night: car.night });
      }
    }
    if (car.label !== this._carLabel || car.hint !== this._carHint) {
      this._carLabel = car.label;
      this._carHint = car.hint;
      this.el.carName.textContent = car.label;
      this.el.carHint.innerHTML = car.hint;
    }
  },

  // ----------------------------------------------------------- guns, health

  setHealth(hp) {
    this.el.hpFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
    this.el.hpFill.parentElement.classList.toggle('low', hp < 25);
  },

  /** Body armour, 0..100: the white bar under health, only when you wear some. */
  setArmor(ar) {
    const bar = document.getElementById('ar-bar');
    bar.hidden = !(ar > 0);
    document.getElementById('ar-fill').style.width = `${Math.max(0, Math.min(100, ar))}%`;
  },

  /** The weapon in the round icon, and the rounds left under it. */
  setWeapon(id, text = '') {
    if (id !== this._weaponShown) {
      this._weaponShown = id;
      drawWeaponIcon(document.getElementById('sa-icon'), id);
    }
    const ammo = document.getElementById('sa-ammo');
    if (ammo.textContent !== text) ammo.textContent = text;
  },

  /** Skulls for how much trouble you are in: a raid, a war. 0 hides them. */
  setThreat(n, kind = 'raid') {
    const el = document.getElementById('threat');
    el.hidden = !n;
    if (!n) return;
    el.classList.toggle('war', kind === 'war');
    const key = `${n}${kind}`;
    if (this._threat === key) return;
    this._threat = key;
    el.innerHTML = `${'☠'.repeat(n)}<i>${'☠'.repeat(Math.max(0, 5 - n))}</i>`;
  },

  /** The name of the place you just walked into, in the corner, for a few seconds. */
  zone(name) {
    if (name === this._zone) return;
    this._zone = name;
    const el = document.getElementById('zone');
    el.textContent = name;
    el.classList.add('show');
    clearTimeout(this._zoneTimer);
    this._zoneTimer = setTimeout(() => el.classList.remove('show'), 3500);
  },

  /** A big caption in the middle of the screen (RAID REPELLED!). */
  bigText(title, sub = '', color = '#f2c14e', ms = 3800) {
    const el = document.getElementById('bigtext');
    el.hidden = false;
    const b = el.querySelector('b');
    b.textContent = title;
    b.style.color = color;
    b.style.animation = 'none';
    void b.offsetWidth;                 // restart the entrance
    b.style.animation = '';
    el.querySelector('i').textContent = sub;
    clearTimeout(this._bigTimer);
    this._bigTimer = setTimeout(() => { el.hidden = true; }, ms);
  },

  /** Wasted: you went down. `sub` says where you will come round. */
  wasted(on, sub = '') {
    const el = document.getElementById('wasted');
    el.hidden = !on;
    el.querySelector('i').textContent = sub;
  },

  /** The delivery you are carrying: where to, and how long is left. */
  setDelivery(text, urgent = false) {
    const el = document.getElementById('delivery');
    if (!el) return;
    el.hidden = !text;
    if (text && el.textContent !== text) el.textContent = text;
    el.classList.toggle('urgent', urgent);
  },

  setAmmo(state) {
    if (!state) { this.el.ammo.hidden = true; return; }
    this.el.ammo.hidden = false;
    const text = state.reloading ? '…' : String(state.mag);
    if (text !== this._magShown) { this._magShown = text; this.el.ammoMag.textContent = text; }
    this.el.ammoMax.textContent = `/ ${state.max}`;
    this.el.ammoName.textContent = state.name.toUpperCase();
    this.el.ammo.querySelector('.count').classList.toggle('low', !state.reloading && state.mag <= 1);
  },

  setCrosshair(mode) {
    if (mode === this._cross) return;
    this._cross = mode;
    this.el.crosshair.classList.toggle('gun', mode === 'gun');
    this.el.crosshair.classList.toggle('hide', mode === 'hide' || mode === 'scope');
    document.getElementById('scope').hidden = mode !== 'scope';
  },

  hitmark(kill) {
    const el = this.el.hitmark;
    el.hidden = false;
    el.classList.toggle('kill', !!kill);
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => { el.hidden = true; }, kill ? 420 : 180);
  },

  showKo(v, sub = 'You come round at your gate…') { this.wasted(v, v ? sub : ''); },

  // --------------------------------------------------------------- prompt

  setPrompt(text, key = 'E') {
    if (!text) { this.el.prompt.hidden = true; return; }
    this.el.prompt.hidden = false;
    if (this._promptText !== text || this._promptKey !== key) {
      this._promptText = text;
      this._promptKey = key;
      this.el.prompt.querySelector('kbd').textContent = key;
      this.el.prompt.querySelector('span').textContent = text;
    }
  },

  setPrompt2(text) {
    if (!text) { this.el.prompt2.hidden = true; return; }
    this.el.prompt2.hidden = false;
    if (this._prompt2 !== text) {
      this._prompt2 = text;
      this.el.prompt2.querySelector('span').textContent = text;
    }
  },

  // --------------------------------------------------------------- toasts

  toast(text, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.el.toasts.appendChild(el);
    setTimeout(() => el.classList.add('fade'), kind === 'event' ? 5200 : 3200);
    setTimeout(() => el.remove(), kind === 'event' ? 5700 : 3700);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  },

  feed(text, kind = '') {
    const el = document.createElement('div');
    el.className = `feed-line ${kind}`;
    el.textContent = text;
    this.el.feed.appendChild(el);
    while (this.el.feed.children.length > 7) this.el.feed.firstChild.remove();
    setTimeout(() => el.remove(), 9000);
  },

  /** Little floating number by the crosshair: +3 🌾, +$45. */
  pop(text, kind = '') {
    const el = document.createElement('div');
    el.className = `pop ${kind}`;
    el.textContent = text;
    el.style.left = `${50 + (Math.random() - 0.5) * 6}%`;
    this.el.pops.appendChild(el);
    setTimeout(() => el.remove(), 1400);
    while (this.el.pops.children.length > 8) this.el.pops.firstChild.remove();
  },

  // ---------------------------------------------------------------- panel

  openPanel(title, bodyEl, { chips = true } = {}) {
    this.el.panelTitle.textContent = title;
    this.el.panelBody.replaceChildren(bodyEl);
    this.el.chipbar.hidden = !chips;
    this.el.panel.hidden = false;
    this._panelOpen = true;
  },

  closePanel() {
    this.el.panel.hidden = true;
    this.el.panelBody.replaceChildren();
    this._panelOpen = false;
  },

  get panelOpen() { return this._panelOpen; },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${Math.round(v / 1000)}K` : money(v));


// ------------------------------------------------------------ weapon icons

/** A little painted picture of the gun (or a fist) for the round weapon icon. */
function drawWeaponIcon(cv, id) {
  const g = cv.getContext('2d');
  const S = cv.width;
  g.clearRect(0, 0, S, S);
  g.save();
  g.translate(S / 2, S / 2);
  const steel = '#2b2e33';
  const wood = '#7a4a22';
  const hi = 'rgba(255,255,255,0.25)';
  const rect = (x, y, w, h, c, r = 0) => { g.fillStyle = c; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };
  if (!id) {
    // A fist.
    rect(-20, -16, 40, 34, '#d59a72', 9);
    for (let i = 0; i < 4; i++) rect(-19 + i * 10, -22, 9, 16, '#e0a882', 4);
    rect(-26, -4, 12, 18, '#c98a62', 5);
    g.strokeStyle = 'rgba(80,40,20,0.5)';
    g.lineWidth = 1.5;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(-19 + i * 10, -20); g.lineTo(-19 + i * 10, -8); g.stroke(); }
  } else if (id === 'pistol') {
    g.rotate(-0.1);
    rect(-26, -14, 50, 13, steel, 3);
    rect(-26, -14, 50, 4, hi, 2);
    rect(8, -3, 13, 26, '#1d1d1f', 3);
    rect(-2, -2, 9, 9, steel, 3);
  } else if (id === 'smg') {
    g.rotate(-0.12);
    rect(-34, -10, 60, 14, steel, 3);
    rect(-46, -6, 14, 5, steel, 2);
    rect(-4, 3, 9, 26, '#1d1d1f', 2);
    rect(14, 3, 9, 16, '#1d1d1f', 3);
    rect(24, -8, 20, 8, '#1d1d1f', 2);
  } else {
    // Long guns: stock, receiver, barrel; the shotgun is stubbier with a pump.
    const shotgun = id === 'shotgun';
    const scope = id === 'biggame';
    g.rotate(-0.35);
    const L = shotgun ? 44 : 50;
    rect(-L, -4, L * 1.2, 6, steel, 2);                  // barrel
    rect(-8, -7, 26, 11, steel, 2);                     // receiver
    rect(12, -5, 30, 11, wood, 3);                      // stock
    rect(34, -6, 10, 15, wood, 3);
    if (shotgun) rect(-34, 2, 20, 7, wood, 3);          // pump
    else rect(-30, 1, 26, 6, wood, 3);                  // fore-end
    if (scope) rect(-10, -15, 24, 7, '#111', 3);
    rect(-L, -4, L * 1.2, 2, hi, 1);
  }
  g.restore();
}
