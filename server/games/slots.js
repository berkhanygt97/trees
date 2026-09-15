import { weighted } from '../rng.js';

// Return-to-player lands around 93%: three-of-a-kind carries the jackpot
// fantasy, exactly-two pays a small consolation so the reels feel alive.
export const SYMBOLS = [
  { key: 'cherry',  glyph: '🍒', weight: 30, three: 4 },
  { key: 'lemon',   glyph: '🍋', weight: 25, three: 6 },
  { key: 'bell',    glyph: '🔔', weight: 18, three: 10 },
  { key: 'star',    glyph: '⭐', weight: 14, three: 18 },
  { key: 'diamond', glyph: '💎', weight: 8,  three: 40 },
  { key: 'seven',   glyph: '7️⃣', weight: 5,  three: 150 },
];

const PAIR_PAYS = 1.2;

export function spin(bet, boost = 1) {
  const reels = [0, 1, 2].map(() => SYMBOLS.indexOf(weighted(SYMBOLS)));
  const [a, b, c] = reels;

  let payout = 0;
  let kind = 'lose';
  if (a === b && b === c) {
    payout = bet * SYMBOLS[a].three * boost;
    kind = SYMBOLS[a].key === 'seven' ? 'jackpot' : 'triple';
  } else if (a === b || b === c || a === c) {
    payout = bet * PAIR_PAYS * boost;
    kind = 'pair';
  }

  return { reels, payout: Math.round(payout), kind };
}

export function paytable() {
  return SYMBOLS.map((s) => ({ glyph: s.glyph, three: s.three })).concat();
}
