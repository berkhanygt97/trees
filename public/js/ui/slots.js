import { div, cash } from './util.js';
import { sfx } from '../sfx.js';

const REELS = 5;
const ROWS = 4;

// Mirrors server/games/slots.js. Kept here as display data only — the server
// decides every outcome.
const GLYPH = {
  nine: '9', ten: '10', jack: 'J', queen: 'Q', king: 'K', ace: 'A',
  bell: '🔔', star: '⭐', diamond: '💎', seven: '7️⃣', wild: '🃏', scatter: '💰',
};
const TIER = {
  nine: 'low', ten: 'low', jack: 'low', queen: 'low', king: 'mid', ace: 'mid',
  bell: 'high', star: 'high', diamond: 'high', seven: 'high',
  wild: 'wild', scatter: 'scatter',
};
const NAME = {
  nine: '9', ten: '10', jack: 'Jack', queen: 'Queen', king: 'King', ace: 'Ace',
  bell: 'Bell', star: 'Star', diamond: 'Diamond', seven: 'Seven',
};
const SPIN_POOL = Object.keys(GLYPH);

export function createSlots(ctx) {
  const root = div(`
    <div class="slot-head">
      <div class="slot-title">NEON SEVENS <span class="muted">· 1024 ways</span></div>
      <div class="slot-free" data-free hidden><b data-free-n>0</b> FREE SPINS · ALL WINS x2</div>
    </div>
    <div class="slot-grid" data-grid></div>
    <div class="slot-banner" data-banner></div>
    <div class="row" style="justify-content:center;margin-top:6px">
      <button class="bet primary" style="min-width:280px" data-spin>SPIN <small>Space</small></button>
    </div>
    <div class="slot-pays" data-pays></div>
  `);

  const gridEl = root.querySelector('[data-grid]');
  const bannerEl = root.querySelector('[data-banner]');
  const spinBtn = root.querySelector('[data-spin]');
  const freeEl = root.querySelector('[data-free]');
  const freeNEl = root.querySelector('[data-free-n]');

  // Build the 5x4 grid, column-major so a whole reel can be spun together.
  const cells = [];
  for (let reel = 0; reel < REELS; reel++) {
    const col = document.createElement('div');
    col.className = 'slot-reel';
    const colCells = [];
    for (let row = 0; row < ROWS; row++) {
      const cell = document.createElement('div');
      cell.className = 'slot-cell';
      cell.textContent = GLYPH[SPIN_POOL[(reel * ROWS + row) % SPIN_POOL.length]];
      col.appendChild(cell);
      colCells.push(cell);
    }
    gridEl.appendChild(col);
    cells.push(colCells);
  }

  root.querySelector('[data-pays]').innerHTML =
    ['seven', 'diamond', 'star', 'bell', 'ace', 'king']
      .map((k) => `<span><i class="sym ${TIER[k]}">${GLYPH[k]}</i>×5 <b>${
        ({ seven: '9.7', diamond: '3.9', star: '1.9', bell: '1.2', ace: '0.7', king: '0.7' })[k]}x</b>/way</span>`)
      .join('') + '<span><i class="sym wild">🃏</i> wild</span><span><i class="sym scatter">💰</i> 3+ = 8 free spins</span>';

  let spinning = false;
  let freeLeft = 0;
  let timers = [];
  let autoTimer = null;

  const clearTimers = () => { timers.forEach(clearTimeout); timers.forEach(clearInterval); timers = []; };

  function setCell(reel, row, sym, { win = false, scatter = false } = {}) {
    const cell = cells[reel][row];
    cell.textContent = GLYPH[sym] || '?';
    cell.className = `slot-cell sym-${TIER[sym] || 'low'}${win ? ' win' : ''}${scatter ? ' scatter-hit' : ''}`;
  }

  function spin() {
    if (spinning) return;
    const free = freeLeft > 0;
    const bet = free ? 0 : ctx.hud.chipFor(ctx.hud.wallet.money);
    if (!free && bet < 25) { sfx.deny(); ctx.toast('Not enough chips for a spin'); return; }
    spinning = true;
    spinBtn.disabled = true;
    bannerEl.textContent = '';
    bannerEl.className = 'slot-banner';

    // Every reel blurs until its own stop lands.
    for (let reel = 0; reel < REELS; reel++) {
      for (let row = 0; row < ROWS; row++) cells[reel][row].className = 'slot-cell spinning';
    }
    timers.push(setInterval(() => {
      for (let reel = 0; reel < REELS; reel++) {
        for (let row = 0; row < ROWS; row++) {
          const cell = cells[reel][row];
          if (cell.classList.contains('spinning')) {
            cell.textContent = GLYPH[SPIN_POOL[(Math.random() * SPIN_POOL.length) | 0]];
          }
        }
      }
    }, 60));

    // On a free spin the server uses the stake the bonus was bought with and
    // ignores this number; it is only here to satisfy the shared bet shape.
    ctx.send('bet', { game: 'slots', station: ctx.station.id, amount: free ? 25 : bet });
  }

  spinBtn.onclick = spin;

  function land(res) {
    // Stop the reels left to right, then score.
    res.grid.forEach((col, reel) => {
      timers.push(setTimeout(() => {
        col.forEach((sym, row) => setCell(reel, row, sym));
        sfx.reel(reel);
        if (reel === REELS - 1) timers.push(setTimeout(() => score(res), 160));
      }, 320 + reel * 190));
    });
  }

  function score(res) {
    spinning = false;
    spinBtn.disabled = false;

    // Light up every cell that took part in a win.
    for (const w of res.wins) {
      for (const [reel, row] of w.cells) setCell(reel, row, res.grid[reel][row], { win: true });
    }
    for (const [reel, row] of res.scatterCells || []) {
      setCell(reel, row, res.grid[reel][row], { scatter: true });
    }

    freeLeft = res.freeLeft || 0;
    freeEl.hidden = freeLeft <= 0;
    freeNEl.textContent = freeLeft;
    spinBtn.textContent = freeLeft > 0 ? 'FREE SPIN' : 'SPIN';
    root.classList.toggle('free-mode', freeLeft > 0);

    const net = res.payout - (res.inFree ? 0 : res.stake);
    if (res.triggered) {
      bannerEl.textContent = `💰 ${res.awarded} FREE SPINS`;
      bannerEl.className = 'slot-banner bonus';
      sfx.jackpot();
    } else if (res.payout >= res.stake * 15) {
      bannerEl.textContent = `BIG WIN  ${cash(res.payout)}`;
      bannerEl.className = 'slot-banner big';
      sfx.jackpot();
    } else if (res.payout > 0) {
      const best = res.wins.slice().sort((a, b) => b.pay - a.pay)[0];
      bannerEl.textContent = best
        ? `${NAME[best.symbol]} ×${best.runLength} · ${best.ways} way${best.ways === 1 ? '' : 's'} · ${cash(res.payout)}`
        : cash(res.payout);
      bannerEl.className = 'slot-banner win';
      sfx.win(res.payout >= res.stake * 5 ? 3 : 1);
    } else {
      bannerEl.textContent = res.inFree ? 'no win' : cash(-res.stake);
      bannerEl.className = 'slot-banner lose';
      sfx.lose();
    }

    if (!res.inFree || net !== 0) {
      ctx.feed(`Slots ${net >= 0 ? '+' : ''}${cash(net)}`, net > 0 ? 'win' : net < 0 ? 'loss' : '');
    }

    // Free spins play themselves, like a bonus round should.
    if (freeLeft > 0) autoTimer = setTimeout(spin, 1100);
  }

  return {
    root,
    onKey(code) {
      if (code === 'Space' || code === 'KeyE') { spin(); return true; }
      return false;
    },
    onResult(res) {
      if (res.game !== 'slots') return;
      if (res.idle) {
        // Sent when you walk up: restores a bonus you left mid-way.
        freeLeft = res.freeLeft || 0;
        freeEl.hidden = freeLeft <= 0;
        freeNEl.textContent = freeLeft;
        root.classList.toggle('free-mode', freeLeft > 0);
        spinBtn.textContent = freeLeft > 0 ? 'FREE SPIN' : 'SPIN';
        if (freeLeft > 0) bannerEl.textContent = 'you have free spins waiting';
        return;
      }
      land(res);
    },
    tick() {},
    destroy() { clearTimers(); clearTimeout(autoTimer); },
  };
}
