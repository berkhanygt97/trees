import { randomBytes } from 'node:crypto';

// Crypto-backed RNG so nobody can argue the house rigged it.
export function rnd() {
  // 48 bits of entropy -> [0,1)
  const b = randomBytes(6);
  return ((b[0] * 2 ** 40) + (b[1] * 2 ** 32) + (b[2] * 2 ** 24) +
          (b[3] * 2 ** 16) + (b[4] * 2 ** 8) + b[5]) / 2 ** 48;
}

export function rndInt(maxExclusive) {
  return Math.floor(rnd() * maxExclusive);
}

export function rndRange(min, max) {
  return min + rnd() * (max - min);
}

export function pick(arr) {
  return arr[rndInt(arr.length)];
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rndInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** items: [{ weight, ... }] -> one item, chosen proportionally. */
export function weighted(items) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = rnd() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}
