import { div, cash } from './util.js';
import { sfx } from '../sfx.js';

const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED = new Set(['H', 'D']);

function cardHtml(c) {
  if (!c || c.hidden) return '<div class="card back"></div>';
  const face = `${c.r}${SUIT[c.s]}`;
  return `<div class="card ${RED.has(c.s) ? 'r' : ''}"><span>${face}</span><span class="b">${face}</span></div>`;
}

const OUTCOME = {
  blackjack: ['BLACKJACK!', 'var(--gold)'],
  win: ['YOU WIN', 'var(--green)'],
  dealer_bust: ['DEALER BUSTS', 'var(--green)'],
  push: ['PUSH', '#cbbfae'],
  lose: ['DEALER WINS', 'var(--red)'],
  bust: ['BUST', 'var(--red)'],
  dealer_blackjack: ['DEALER BLACKJACK', 'var(--red)'],
};

export function createBlackjack(ctx) {
  const root = div(`
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

  function act(action) {
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

  function render() {
    const inPlay = state.phase === 'player';
    dealerEl.innerHTML = (state.dealer || []).map(cardHtml).join('') || '<span class="muted">—</span>';
    playerEl.innerHTML = (state.player || []).map(cardHtml).join('') || '<span class="muted">—</span>';
    dtEl.textContent = state.dealer ? (inPlay ? `${state.dealerTotal}+` : state.dealerTotal) : '';
    ptEl.textContent = state.player ? state.playerTotal : '';
    btn('deal').disabled = inPlay;
    btn('hit').disabled = !inPlay;
    btn('stand').disabled = !inPlay;
    btn('double').disabled = !state.canDouble || ctx.hud.wallet.money < state.bet;
    if (state.phase === 'done' && state.outcome) {
      const [label, color] = OUTCOME[state.outcome] || ['—', '#fff'];
      const net = state.payout - state.bet;
      outcomeEl.innerHTML = `<span class="big-num" style="color:${color};font-size:30px">${label}</span>
        <div class="muted">${net >= 0 ? '+' : ''}${cash(net)}</div>`;
    } else if (inPlay) {
      outcomeEl.innerHTML = `<span class="muted">bet ${cash(state.bet)} — your move</span>`;
    } else {
      outcomeEl.innerHTML = '';
    }
  }

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
      const wasPlaying = state.phase === 'player';
      const prevCards = (state.player || []).length;
      state = res;
      render();
      if (res.phase === 'player' && (res.player || []).length > prevCards) sfx.click();
      if (res.phase === 'done') {
        const net = res.payout - res.bet;
        if (res.outcome === 'blackjack') sfx.jackpot();
        else if (net > 0) sfx.win(2);
        else if (net < 0) sfx.lose();
        if (wasPlaying || true) ctx.feed(`Blackjack ${net >= 0 ? '+' : ''}${cash(net)}`, net > 0 ? 'win' : net < 0 ? 'loss' : '');
      }
    },
    onRound(round) {
      const bonus = round && round.event && round.event.id === 'lucky_21';
      noteEl.innerHTML = bonus
        ? '<b style="color:var(--gold)">LUCKY 21 — blackjack pays 2:1</b>'
        : 'Dealer stands on all 17s · blackjack pays 3:2';
    },
    tick() {
      // Cheap per-frame refresh: only the affordability of DOUBLE can drift.
      btn('double').disabled = !state.canDouble || ctx.hud.wallet.money < state.bet;
    },
    destroy() {},
  };
}
