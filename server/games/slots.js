// NEON SEVENS — a 5x4 ways-pays slot.
//
// 1024 ways: a symbol pays when it lands on consecutive reels starting at reel 1,
// and the win is multiplied by how many of it sit on each of those reels. Wilds
// stand in for anything but the scatter and only appear on reels 2-5, so they
// extend a run without ever starting one. Three or more scatters anywhere buys
// eight free spins at double pay, and they retrigger.
//
// Measured RTP: see the simulation in the verification notes — tuned to ~94%.
import { rnd } from '../rng.js';

export const WILD = 'wild';
export const SCATTER = 'scatter';

// Ten paying symbols, so no single one crowds a reel. Values are per way, in
// units of the stake, and were fitted by simulation (see TUNE below).
export const SYMBOLS = {
  nine:    { glyph: '9',  tier: 'low',  pays: [0, 0, 0.05, 0.15, 0.40] },
  ten:     { glyph: '10', tier: 'low',  pays: [0, 0, 0.05, 0.15, 0.40] },
  jack:    { glyph: 'J',  tier: 'low',  pays: [0, 0, 0.06, 0.20, 0.50] },
  queen:   { glyph: 'Q',  tier: 'low',  pays: [0, 0, 0.06, 0.20, 0.50] },
  king:    { glyph: 'K',  tier: 'mid',  pays: [0, 0, 0.08, 0.25, 0.75] },
  ace:     { glyph: 'A',  tier: 'mid',  pays: [0, 0, 0.08, 0.25, 0.75] },
  bell:    { glyph: '🔔', tier: 'high', pays: [0, 0, 0.12, 0.40, 1.20] },
  star:    { glyph: '⭐', tier: 'high', pays: [0, 0, 0.20, 0.60, 2.00] },
  diamond: { glyph: '💎', tier: 'high', pays: [0, 0, 0.35, 1.20, 4.00] },
  seven:   { glyph: '7️⃣', tier: 'high', pays: [0, 0, 0.60, 2.50, 10.00] },
  wild:    { glyph: '🃏', tier: 'wild', pays: [0, 0, 0, 0, 0] },
  scatter: { glyph: '💰', tier: 'scatter', pays: [0, 0, 0, 0, 0] },
};

/**
 * Multiplies the whole paytable. The table above sets the *shape* of the game
 * (how the tiers relate); this single scalar was fitted by simulation to land
 * the return at 94%. Change the shape, re-fit this.
 */
export const TUNE = 0.967;

export const ROWS = 4;
export const REELS = 5;
export const FREE_SPINS = 8;
export const FREE_MULTIPLIER = 2;

// One weight table per reel. Reel 1 carries no wild, and the high symbols thin
// out towards the right so long runs stay rare.
const STRIPS = [
  { nine: 12, ten: 12, jack: 11, queen: 11, king: 10, ace: 10, bell: 8, star: 6, diamond: 4, seven: 3, scatter: 3 },
  { nine: 12, ten: 12, jack: 11, queen: 11, king: 10, ace: 10, bell: 7, star: 6, diamond: 4, seven: 3, wild: 5, scatter: 3 },
  { nine: 12, ten: 12, jack: 11, queen: 11, king: 10, ace: 10, bell: 7, star: 5, diamond: 4, seven: 2, wild: 6, scatter: 3 },
  { nine: 13, ten: 13, jack: 12, queen: 11, king: 10, ace: 10, bell: 7, star: 5, diamond: 3, seven: 2, wild: 5, scatter: 3 },
  { nine: 14, ten: 13, jack: 12, queen: 12, king: 10, ace: 10, bell: 6, star: 5, diamond: 3, seven: 2, wild: 4, scatter: 3 },
];

const STRIP_KEYS = STRIPS.map((w) => Object.keys(w));
const STRIP_TOTALS = STRIPS.map((w) => Object.values(w).reduce((a, b) => a + b, 0));

function drawSymbol(reel) {
  let r = rnd() * STRIP_TOTALS[reel];
  const keys = STRIP_KEYS[reel];
  const weights = STRIPS[reel];
  for (const k of keys) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return keys[keys.length - 1];
}

/** grid[reel][row] */
function drawGrid() {
  const grid = [];
  for (let reel = 0; reel < REELS; reel++) {
    const col = [];
    for (let row = 0; row < ROWS; row++) col.push(drawSymbol(reel));
    grid.push(col);
  }
  return grid;
}

const PAYING = ['nine', 'ten', 'jack', 'queen', 'king', 'ace', 'bell', 'star', 'diamond', 'seven'];

/**
 * Evaluate one grid. Returns the win in units of the stake, the winning lines,
 * and how many scatters landed.
 */
export function evaluate(grid) {
  const wins = [];
  let total = 0;

  for (const key of PAYING) {
    const counts = [];
    const cells = [];
    for (let reel = 0; reel < REELS; reel++) {
      const hits = [];
      for (let row = 0; row < ROWS; row++) {
        const sym = grid[reel][row];
        if (sym === key || sym === WILD) hits.push(row);
      }
      if (!hits.length) break;
      counts.push(hits.length);
      cells.push(hits.map((row) => [reel, row]));
    }
    const runLength = counts.length;
    if (runLength < 3) continue;
    const pay = SYMBOLS[key].pays[runLength - 1] * TUNE;
    if (!pay) continue;
    const ways = counts.reduce((a, b) => a * b, 1);
    total += pay * ways;
    wins.push({ symbol: key, runLength, ways, pay: pay * ways, cells: cells.flat() });
  }

  let scatters = 0;
  const scatterCells = [];
  for (let reel = 0; reel < REELS; reel++) {
    for (let row = 0; row < ROWS; row++) {
      if (grid[reel][row] === SCATTER) { scatters++; scatterCells.push([reel, row]); }
    }
  }

  return { wins, total, scatters, scatterCells };
}

/**
 * One spin. `free` is the player's free-spin state (or null); the caller owns it
 * so a player can wander off mid-bonus and come back to it.
 */
export function spin(stake, boost = 1, free = null) {
  const grid = drawGrid();
  const { wins, total, scatters, scatterCells } = evaluate(grid);

  const inFree = !!free && free.left > 0;
  const multiplier = (inFree ? FREE_MULTIPLIER : 1) * boost;
  const payout = Math.round(stake * total * multiplier);

  const triggered = scatters >= 3;
  return {
    grid, wins, scatters, scatterCells,
    payout, multiplier,
    triggered,
    awarded: triggered ? FREE_SPINS : 0,
    inFree,
  };
}
