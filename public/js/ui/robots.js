import { div, esc, cash, secsLeft, setBar } from './util.js';
import { sfx } from '../sfx.js';

const VERB = {
  hit: ['hammers', 'clubs', 'rams', 'cracks', 'lands one on'],
  crit: ['CRUNCHES', 'FLATTENS', 'CAVES IN'],
  special: ['unloads on', 'goes overdrive on', 'buries the drill in'],
  miss: ['swings and misses', 'whiffs badly', 'hits nothing but air'],
};

export function createRobots(ctx) {
  const root = div(`
    <div class="row" style="justify-content:space-between;align-items:center">
      <div><span class="tag" data-phase>—</span> <b data-countdown style="font-size:20px"></b>
        <span class="muted" data-match></span></div>
      <div class="muted" data-history></div>
    </div>
    <div class="phase-bar"><i data-bar style="width:100%"></i></div>
    <div class="bots" data-bots></div>
    <div class="bot-feed" data-feed></div>
    <div class="muted" style="margin-top:8px" data-tickets></div>
  `);

  const phaseEl = root.querySelector('[data-phase]');
  const cdEl = root.querySelector('[data-countdown]');
  const barEl = root.querySelector('[data-bar]');
  const matchEl = root.querySelector('[data-match]');
  const histEl = root.querySelector('[data-history]');
  const botsEl = root.querySelector('[data-bots]');
  const feedEl = root.querySelector('[data-feed]');
  const ticketsEl = root.querySelector('[data-tickets]');

  let state = null;
  let lastPhase = null;
  let replayed = 0;

  function build() {
    botsEl.innerHTML = (state.fighters || []).map((f, i) => `
      <div class="bot" data-bot="${i}">
        <div class="bot-top">
          <span class="swatch" style="background:${f.color}"></span>
          <span class="nm">${esc(f.name)}</span>
          <span class="odds" data-odds="${i}">${f.odds.toFixed(2)}x</span>
        </div>
        <div class="hpbar"><i data-hp="${i}" style="background:${f.color}"></i></div>
        <div class="hpnum"><span data-hpn="${i}">${f.maxHp}</span> / ${f.maxHp}</div>
        <button class="bet" data-pick="${i}">BET <small>${i + 1}</small></button>
      </div>`).join('');
    for (const b of botsEl.querySelectorAll('[data-pick]')) {
      b.onclick = () => bet(Number(b.dataset.pick));
    }
  }

  function bet(robot) {
    if (!state || state.phase !== 'betting') { sfx.deny(); ctx.toast('The cage is shut — wait for the next bout'); return; }
    const amount = ctx.hud.chipFor(ctx.hud.wallet.money);
    if (amount < 25) { sfx.deny(); ctx.toast('Not enough chips'); return; }
    sfx.chip();
    ctx.send('bet', { game: 'robots', station: ctx.station.id, robot, amount });
  }

  function setHp(i, hp, maxHp) {
    const bar = root.querySelector(`[data-hp="${i}"]`);
    const num = root.querySelector(`[data-hpn="${i}"]`);
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%`;
    if (num) num.textContent = Math.max(0, hp);
  }

  function line(ev) {
    const f = state.fighters;
    const attacker = f[ev.actor].name;
    const victim = f[1 - ev.actor].name;
    if (ev.type === 'ko') return `<b style="color:var(--gold)">${attacker} WINS BY KNOCKOUT</b>`;
    if (ev.type === 'decision') return `<b style="color:var(--gold)">${attacker} takes it on damage</b>`;
    const verbs = VERB[ev.type] || VERB.hit;
    const verb = verbs[Math.floor(Math.random() * verbs.length)];
    if (ev.type === 'miss') return `<span class="miss">${attacker} ${verb}</span>`;
    const cls = ev.type === 'crit' ? 'crit' : ev.type === 'special' ? 'special' : '';
    return `<span class="${cls}">${attacker} ${verb} ${victim} · <b>${ev.dmg}</b></span>`;
  }

  function pushLine(html) {
    const el = document.createElement('div');
    el.className = 'bot-line';
    el.innerHTML = html;
    feedEl.appendChild(el);
    while (feedEl.children.length > 7) feedEl.firstChild.remove();
    feedEl.scrollTop = feedEl.scrollHeight;
  }

  function render() {
    if (!state) return;
    phaseEl.textContent = state.phase === 'betting' ? 'CAGE OPEN'
      : state.phase === 'fighting' ? 'FIGHT' : 'OFFICIAL';
    phaseEl.className = `tag ${state.phase === 'betting' ? 'open' : 'live'}`;
    matchEl.textContent = `bout ${state.matchNo}`;

    const bonus = state.bonus ? 1.5 : 1;
    (state.fighters || []).forEach((f, i) => {
      const el = root.querySelector(`[data-odds="${i}"]`);
      if (el) {
        el.textContent = `${(f.odds * bonus).toFixed(2)}x`;
        el.style.color = state.bonus ? 'var(--green)' : 'var(--gold)';
      }
    });
    for (const b of botsEl.querySelectorAll('[data-pick]')) b.disabled = state.phase !== 'betting';
    botsEl.querySelectorAll('[data-bot]').forEach((el, i) => {
      el.classList.toggle('won', state.winner === i);
      el.classList.toggle('lost', state.winner != null && state.winner !== i);
    });

    histEl.innerHTML = (state.history || []).slice(0, 4)
      .map((h) => `<span style="margin-left:9px">${esc(h.winner)}</span>`).join('');

    const mine = state.bets.find((b) => b.playerId === ctx.meId);
    ticketsEl.innerHTML = mine
      ? 'YOUR TICKETS: ' + mine.list.map((b) =>
        `<b style="color:${state.fighters[b.robot].color}">${esc(state.fighters[b.robot].name)} ${cash(b.amount)}</b>`).join(' · ')
      : 'no tickets on this bout';
  }

  return {
    root,
    onKey(code) {
      const m = /^Digit([12])$/.exec(code);
      if (m) { bet(Number(m[1]) - 1); return true; }
      return false;
    },
    onState(s) {
      if (s.game !== 'robots') return;
      const changed = !state || s.matchNo !== state.matchNo || s.phase !== lastPhase;
      state = s;
      if (!botsEl.children.length || (changed && s.phase === 'betting')) build();
      if (s.phase !== lastPhase) {
        lastPhase = s.phase;
        if (s.phase === 'betting') {
          replayed = 0;
          feedEl.replaceChildren();
          (s.fighters || []).forEach((f, i) => setHp(i, f.maxHp, f.maxHp));
        }
        if (s.phase === 'fighting') { replayed = 0; feedEl.replaceChildren(); sfx.alarm(); }
        if (s.phase === 'results') sfx.fanfare();
      }
      render();
    },
    onResult(res) {
      if (res.game !== 'robots') return;
      const net = res.net;
      if (net > 0) sfx.win(3); else if (net < 0) sfx.lose();
      ctx.feed(`Scrapyard ${res.winnerName} ${net >= 0 ? '+' : ''}${cash(net)}`, net > 0 ? 'win' : 'loss');
    },
    tick(serverNow) {
      if (!state) return;
      if (state.phase === 'betting') {
        const left = secsLeft(state.until, serverNow);
        cdEl.textContent = `${left.toFixed(1)}s`;
        setBar(barEl, left, 24);
        return;
      }
      if (state.phase === 'results') {
        cdEl.textContent = `${secsLeft(state.until, serverNow).toFixed(1)}s`;
        setBar(barEl, secsLeft(state.until, serverNow), 11);
        return;
      }

      // Replay the bout against the server clock so every screen is in step.
      const t = serverNow - state.startAt;
      cdEl.textContent = `${(t / 1000).toFixed(1)}s`;
      setBar(barEl, 1, 1);
      const events = state.events || [];
      while (replayed < events.length && events[replayed].t <= t) {
        const ev = events[replayed++];
        setHp(0, ev.hp[0], state.fighters[0].maxHp);
        setHp(1, ev.hp[1], state.fighters[1].maxHp);
        pushLine(line(ev));
        if (ev.type === 'crit' || ev.type === 'special') sfx.explode();
        else if (ev.type === 'ko') sfx.jackpot();
        else if (ev.type !== 'miss') sfx.click();
      }
    },
    destroy() {},
  };
}
