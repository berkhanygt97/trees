import { div, cash } from './util.js';
import { sfx } from '../sfx.js';

const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED = new Set(['H', 'D']);
const DEAL_MS = 230;      // gap between cards
const FLIP_MS = 320;      // hole card turn

const OUTCOME = {
  blackjack: ['BLACKJACK!', 'var(--gold)'],
  win: ['YOU WIN', 'var(--green)'],
  dealer_bust: ['DEALER BUSTS', 'var(--green)'],
  push: ['PUSH', '#cbbfae'],
  lose: ['DEALER WINS', 'var(--red)'],
  bust: ['BUST', 'var(--red)'],
  dealer_blackjack: ['DEALER BLACKJACK', 'var(--red)'],
};

const isHidden = (c) => !c || c.hidden;
const keyOf = (c) => (isHidden(c) ? '??' : `${c.r}${c.s}`);

export function createBlackjack(ctx) {
  const root = div(`
    <div class="bj-shoe" data-shoe></div>
    <div class="muted">DEALER <b data-dt style="color:#fff"></b></div>
    <div class="cards" data-dealer></div>
    <div class="muted" style="margin-top:10px">YOU <b data-pt style="color:#fff"></b></div>
    <div class="cards" data-player></div>
    <div style="text-align:center;margin:10px 0;min-height:28px" data-outcome></div>
    <div class="betgrid" style="grid-template-columns:repeat(4,1fr)">
      <button class="bet primary" data-act="deal">DEAL <small>Space</small></button>
      <button class="bet" data-act="hit">HIT <small>H</small></button>
      <button class="bet" data-act="stand">STAND <small>S</small></button>
      <button class="bet" data-act="double">DOUBLE <small>D</small></button>
    </div>
    <div class="muted" style="text-align:center;margin-top:8px" data-note>Dealer stands on all 17s · blackjack pays 3:2</div>
  `);

  const dealerEl = root.querySelector('[data-dealer]');
  const playerEl = root.querySelector('[data-player]');
  const dtEl = root.querySelector('[data-dt]');
  const ptEl = root.querySelector('[data-pt]');
  const outcomeEl = root.querySelector('[data-outcome]');
  const noteEl = root.querySelector('[data-note]');
  const btn = (a) => root.querySelector(`[data-act="${a}"]`);

  let state = { phase: 'idle' };
  let shown = { player: [], dealer: [] };   // what is physically on the table
  const queue = [];
  let dealing = false;
  let timers = [];

  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  function cardEl(card, { dealt = false } = {}) {
    const el = document.createElement('div');
    if (isHidden(card)) {
      el.className = 'card back';
    } else {
      const face = `${card.r}${SUIT[card.s]}`;
      el.className = `card ${RED.has(card.s) ? 'r' : ''}`;
      el.innerHTML = `<span>${face}</span><span class="b">${face}</span>`;
    }
    if (dealt) el.classList.add('dealing');
    return el;
  }

  function faceOf(el, card) {
    if (isHidden(card)) {
      el.className = 'card back';
      el.innerHTML = '';
      return;
    }
    const face = `${card.r}${SUIT[card.s]}`;
    el.className = `card ${RED.has(card.s) ? 'r' : ''}`;
    el.innerHTML = `<span>${face}</span><span class="b">${face}</span>`;
  }

  // ------------------------------------------------------------ the queue

  /** Compare the table against the server's hand and queue up the difference. */
  function enqueueFrom(next) {
    const sides = [['dealer', next.dealer || []], ['player', next.player || []]];

    // A brand new hand wipes the table first.
    const freshHand = (next.player || []).length === 2
      && shown.player.length > 0
      && shown.player.length >= (next.player || []).length
      && state.phase === 'done';
    if (freshHand || (next.phase === 'player' && (next.player || []).length === 2 && shown.player.length !== 2)) {
      queue.push({ type: 'clear' });
      shown = { player: [], dealer: [] };
    }

    // Deal alternating, the way a dealer actually does it.
    const maxLen = Math.max(...sides.map(([, arr]) => arr.length), 0);
    for (let i = 0; i < maxLen; i++) {
      for (const [side, arr] of [['player', next.player || []], ['dealer', next.dealer || []]]) {
        const card = arr[i];
        if (!card) continue;
        const already = shown[side][i];
        if (already === undefined) {
          queue.push({ type: 'add', side, index: i, card });
          shown[side][i] = card;
        } else if (isHidden(already) && !isHidden(card)) {
          queue.push({ type: 'flip', side, index: i, card });
          shown[side][i] = card;
        }
      }
    }
  }

  function pump() {
    if (dealing) return;
    const job = queue.shift();
    if (!job) { finish(); return; }
    dealing = true;
    lockButtons();

    if (job.type === 'clear') {
      dealerEl.replaceChildren();
      playerEl.replaceChildren();
      dtEl.textContent = '';
      ptEl.textContent = '';
      outcomeEl.innerHTML = '';
      dealing = false;
      pump();
      return;
    }

    const host = job.side === 'dealer' ? dealerEl : playerEl;

    if (job.type === 'add') {
      const el = cardEl(job.card, { dealt: true });
      host.appendChild(el);
      sfx.card();
      timers.push(setTimeout(() => { dealing = false; pump(); }, DEAL_MS));
      return;
    }

    // flip: turn the hole card face up halfway through the animation
    const el = host.children[job.index];
    if (!el) { dealing = false; pump(); return; }
    el.classList.add('flipping');
    sfx.card();
    timers.push(setTimeout(() => faceOf(el, job.card), FLIP_MS / 2));
    timers.push(setTimeout(() => {
      el.classList.remove('flipping');
      dealing = false;
      pump();
    }, FLIP_MS));
  }

  /** Queue drained: show the totals and the verdict. */
  function finish() {
    const inPlay = state.phase === 'player';
    dtEl.textContent = state.dealer ? (inPlay ? `${state.dealerTotal}+` : state.dealerTotal) : '';
    ptEl.textContent = state.player ? state.playerTotal : '';
    unlockButtons();

    if (state.phase === 'done' && state.outcome) {
      const [label, color] = OUTCOME[state.outcome] || ['—', '#fff'];
      const net = state.payout - state.bet;
      outcomeEl.innerHTML = `<span class="big-num" style="color:${color};font-size:30px">${label}</span>
        <div class="muted">${net >= 0 ? '+' : ''}${cash(net)}</div>`;
      if (state.outcome === 'blackjack') sfx.jackpot();
      else if (net > 0) sfx.win(2);
      else if (net < 0) sfx.lose();
      ctx.feed(`Blackjack ${net >= 0 ? '+' : ''}${cash(net)}`, net > 0 ? 'win' : net < 0 ? 'loss' : '');
    } else if (inPlay) {
      outcomeEl.innerHTML = `<span class="muted">bet ${cash(state.bet)} — your move</span>`;
    }
  }

  function lockButtons() {
    for (const a of ['deal', 'hit', 'stand', 'double']) btn(a).disabled = true;
  }

  function unlockButtons() {
    const inPlay = state.phase === 'player';
    btn('deal').disabled = inPlay;
    btn('hit').disabled = !inPlay;
    btn('stand').disabled = !inPlay;
    btn('double').disabled = !state.canDouble || ctx.hud.wallet.money < state.bet;
  }

  // ------------------------------------------------------------- actions

  function act(action) {
    if (dealing || queue.length) { sfx.deny(); return; }   // let the deal finish
    if (action === 'deal') {
      if (state.phase === 'player') { sfx.deny(); return; }
      const bet = ctx.hud.chipFor(ctx.hud.wallet.money);
      if (bet < 25) { sfx.deny(); ctx.toast('Not enough chips'); return; }
      sfx.chip();
      ctx.send('bet', { game: 'blackjack', station: ctx.station.id, amount: bet });
      return;
    }
    if (state.phase !== 'player') { sfx.deny(); return; }
    sfx.click();
    ctx.send('act', { game: 'blackjack', station: ctx.station.id, action });
  }

  for (const b of root.querySelectorAll('[data-act]')) b.onclick = () => act(b.dataset.act);

  return {
    root,
    onKey(code) {
      if (code === 'Space') { act('deal'); return true; }
      if (code === 'KeyH') { act('hit'); return true; }
      if (code === 'KeyS') { act('stand'); return true; }
      if (code === 'KeyD') { act('double'); return true; }
      return false;
    },
    onResult(res) {
      if (res.game !== 'blackjack') return;
      if (res.phase === 'idle') { state = res; return; }
      state = res;
      enqueueFrom(res);
      pump();
    },
    onRound(round) {
      const bonus = round && round.event && round.event.id === 'lucky_21';
      noteEl.innerHTML = bonus
        ? '<b style="color:var(--gold)">LUCKY 21 — blackjack pays 2:1</b>'
        : 'Dealer stands on all 17s · blackjack pays 3:2';
    },
    tick() {
      if (!dealing && !queue.length) {
        btn('double').disabled = !state.canDouble || ctx.hud.wallet.money < state.bet;
      }
    },
    /** True while cards are still landing — the browser test asserts on this. */
    isDealing() { return dealing || queue.length > 0; },
    destroy() { clearTimers(); },
  };
}
