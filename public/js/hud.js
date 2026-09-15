import { CONFIG, money } from '/shared/config.js';
import { sfx } from './sfx.js';

const $ = (sel) => document.querySelector(sel);

export const hud = {
  chipValue: CONFIG.CHIPS[2],
  wallet: { money: 0, profit: 0, loans: 0, canLoan: false },
  round: null,
  meId: null,
  _panelOpen: false,
  _onChip: null,

  init({ onChip } = {}) {
    this._onChip = onChip;
    this.el = {
      hud: $('#hud'),
      money: $('#w-money'),
      profit: $('#w-profit'),
      loans: $('#w-loans'),
      rnum: $('#r-num'),
      clock: $('#r-clock'),
      event: $('#r-event'),
      mini: $('#mini-list'),
      prompt: $('#prompt'),
      toasts: $('#toasts'),
      feed: $('#feed'),
      board: $('#board'),
      boardTable: $('#board-table'),
      finals: $('#finals'),
      finalsTable: $('#finals-table'),
      podium: $('#podium'),
      finalsNext: $('#finals-next'),
      panel: $('#panel'),
      panelTitle: $('#panel-title'),
      panelBody: $('#panel-body'),
      chipbar: $('#chipbar'),
    };
    this._buildChips();
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

  // --------------------------------------------------------------- wallet

  setWallet(w) {
    this.wallet = w;
    this.el.money.textContent = money(w.money);
    const sign = w.profit > 0 ? '+' : w.profit < 0 ? '-' : '±';
    this.el.profit.textContent = `${sign}$${Math.abs(w.profit).toLocaleString('en-US')} profit`;
    this.el.profit.className = `profit ${w.profit > 0 ? 'up' : w.profit < 0 ? 'down' : ''}`;
    this.el.loans.hidden = !w.loans;
    if (w.loans) this.el.loans.textContent = `borrowed ${money(w.loans)}`;
    for (const b of this.el.chipbar.querySelectorAll('.chip')) {
      b.disabled = Number(b.dataset.v) > w.money;
    }
  },

  // ---------------------------------------------------------------- round

  setRound(r) {
    this.round = r;
    this.el.rnum.textContent = r.phase === 'lobby' ? 'WAITING' : `ROUND ${r.number}`;
    if (r.event) {
      this.el.event.hidden = false;
      this.el.event.querySelector('b').textContent = r.event.name;
      this.el.event.querySelector('i').textContent = r.event.desc;
    } else {
      this.el.event.hidden = true;
    }
  },

  tickClock(serverNow) {
    const r = this.round;
    if (!r) return;
    if (r.phase === 'lobby') { this.el.clock.textContent = '--:--'; return; }
    const left = Math.max(0, r.endsAt - serverNow) / 1000;
    const whole = Math.floor(left);
    if (whole === this._clockShown) return;   // only touch the DOM once a second
    this._clockShown = whole;
    const m = Math.floor(whole / 60);
    const s = whole % 60;
    this.el.clock.textContent = `${m}:${String(s).padStart(2, '0')}`;
    this.el.clock.classList.toggle('urgent', r.phase === 'live' && left <= 60);
  },

  // ---------------------------------------------------------- leaderboard

  setBoard(rows) {
    const top = rows.slice(0, 6);
    this.el.mini.innerHTML = top.map((r, i) => `
      <li class="${r.id === this.meId ? 'me' : ''}">
        <span class="dot" style="background:${r.color}"></span>
        <span class="nm">${i + 1}. ${esc(r.name)}</span>
        <span class="pf ${cls(r.profit)}">${fmt(r.profit)}</span>
      </li>`).join('');

    this.el.boardTable.innerHTML = `
      <tr><th>#</th><th>PLAYER</th><th class="num">PROFIT</th><th class="num">CHIPS</th>
          <th class="num">WAGERED</th><th class="num">BEST WIN</th><th class="num">BORROWED</th></tr>
      ${rows.map((r, i) => `
        <tr class="${r.id === this.meId ? 'me' : ''}">
          <td>${i + 1}</td>
          <td><span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${r.color};margin-right:7px"></span>${esc(r.name)}</td>
          <td class="num ${cls(r.profit)}">${fmt(r.profit)}</td>
          <td class="num">${money(r.money)}</td>
          <td class="num">${money(r.wagered)}</td>
          <td class="num">${money(r.biggestWin)}</td>
          <td class="num">${r.loans ? money(r.loans) : '—'}</td>
        </tr>`).join('')}`;
  },

  showBoard(v) { this.el.board.hidden = !v; },

  showFinals(rows) {
    const podium = rows.slice(0, 3);
    const order = [podium[1], podium[0], podium[2]];
    this.el.podium.innerHTML = order.map((r, i) => {
      if (!r) return '';
      const place = r === podium[0] ? 1 : r === podium[1] ? 2 : 3;
      return `<div class="plinth p${place}">
        <div class="who" style="color:${r.color}">${esc(r.name)}</div>
        <div class="bar">${place === 1 ? '👑' : place}</div>
        <div class="amt ${cls(r.profit)}">${fmt(r.profit)}</div>
      </div>`;
    }).join('');
    this.el.finalsTable.innerHTML = `
      <tr><th>#</th><th>PLAYER</th><th class="num">PROFIT</th><th class="num">WAGERED</th><th class="num">BORROWED</th></tr>
      ${rows.map((r, i) => `
        <tr class="${r.id === this.meId ? 'me' : ''}">
          <td>${i + 1}</td><td>${esc(r.name)}</td>
          <td class="num ${cls(r.profit)}">${fmt(r.profit)}</td>
          <td class="num">${money(r.wagered)}</td>
          <td class="num">${r.loans ? money(r.loans) : '—'}</td>
        </tr>`).join('')}`;
    this.el.finals.hidden = false;
  },

  updateFinalsCountdown(seconds) {
    this.el.finalsNext.textContent = `NEXT ROUND IN ${Math.max(0, Math.ceil(seconds))}`;
  },

  hideFinals() { this.el.finals.hidden = true; },

  // --------------------------------------------------------------- prompt

  setPrompt(text) {
    if (!text) { this.el.prompt.hidden = true; return; }
    this.el.prompt.hidden = false;
    this.el.prompt.querySelector('span').textContent = text;
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
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
const fmt = (v) => `${v > 0 ? '+' : v < 0 ? '-' : '±'}$${Math.abs(v).toLocaleString('en-US')}`;
