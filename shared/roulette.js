// The European wheel and every legal bet on its felt.
//
// Imported by the server (to validate and pay) and fetched by the browser (to
// draw the table and the wheel), so a bet the client can place is always a bet
// the server recognises, and the pocket order can never drift between the 3D
// wheel and the one in the panel.

export const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];

export const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const colorOf = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');

/** Column on the felt, 0-11 (numbers 1-3 are column 0). */
export const colOf = (n) => Math.floor((n - 1) / 3);
/** Row as displayed, 0 = top (3, 6, 9 …), 2 = bottom (1, 4, 7 …). */
export const rowOf = (n) => 2 - ((n - 1) % 3);

const bets = [];
const add = (type, numbers, mult, label) => {
  const nums = [...numbers].sort((a, b) => a - b);
  bets.push({ id: `${type}:${nums.join('-')}`, type, numbers: nums, mult, label });
};

// --- straight up, 35:1 ---
for (let n = 0; n <= 36; n++) add('straight', [n], 36, `${n}`);

// --- splits, 17:1 ---
for (let n = 1; n <= 36; n++) {
  if (colOf(n) < 11) add('split', [n, n + 3], 18, `${n}/${n + 3}`);   // side by side
  if ((n - 1) % 3 < 2) add('split', [n, n + 1], 18, `${n}/${n + 1}`); // stacked
}
for (const n of [1, 2, 3]) add('split', [0, n], 18, `0/${n}`);

// --- streets and the two zero trios, 11:1 ---
for (let c = 0; c < 12; c++) {
  const base = c * 3 + 1;
  add('street', [base, base + 1, base + 2], 12, `${base}-${base + 2}`);
}
add('trio', [0, 1, 2], 12, '0/1/2');
add('trio', [0, 2, 3], 12, '0/2/3');

// --- corners and the first four, 8:1 ---
for (let n = 1; n <= 36; n++) {
  if (colOf(n) < 11 && (n - 1) % 3 < 2) add('corner', [n, n + 1, n + 3, n + 4], 9, `${n} corner`);
}
add('basket', [0, 1, 2, 3], 9, 'first four');

// --- six lines, 5:1 ---
for (let c = 0; c < 11; c++) {
  const base = c * 3 + 1;
  add('sixline', [base, base + 1, base + 2, base + 3, base + 4, base + 5], 6, `${base}-${base + 5}`);
}

// --- columns and dozens, 2:1 ---
for (let r = 0; r < 3; r++) {
  const nums = [];
  for (let n = 1; n <= 36; n++) if ((n - 1) % 3 === 2 - r) nums.push(n);
  add('column', nums, 3, `col ${r + 1}`);
}
for (let d = 0; d < 3; d++) {
  const nums = [];
  for (let n = d * 12 + 1; n <= d * 12 + 12; n++) nums.push(n);
  add('dozen', nums, 3, `${['1ST', '2ND', '3RD'][d]} 12`);
}

// --- even money, 1:1 ---
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const all = range(1, 36);
add('red', all.filter((n) => colorOf(n) === 'red'), 2, 'RED');
add('black', all.filter((n) => colorOf(n) === 'black'), 2, 'BLACK');
add('odd', all.filter((n) => n % 2 === 1), 2, 'ODD');
add('even', all.filter((n) => n % 2 === 0), 2, 'EVEN');
add('low', range(1, 18), 2, '1-18');
add('high', range(19, 36), 2, '19-36');

export const LEGAL_BETS = bets;
export const BET_BY_ID = new Map(bets.map((b) => [b.id, b]));

/** Every one of these carries the same 2.70% edge; this proves it. */
export function houseEdgeOf(bet) {
  return 1 - (bet.mult * bet.numbers.length) / 37;
}
