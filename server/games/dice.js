// Roll 0.00 - 99.99, bet that it lands over or under your target.
// 4% house edge, removed entirely during the LOADED DICE event.
import { rnd } from '../rng.js';

export const MIN_TARGET = 2;
export const MAX_TARGET = 98;

export function chanceOf(mode, target) {
  return mode === 'under' ? target : 100 - target;
}

export function multiplierFor(mode, target, edgeFree = false) {
  const chance = chanceOf(mode, target);
  const edge = edgeFree ? 1.0 : 0.96;
  return Math.round((edge * 100 / chance) * 100) / 100;
}

export function roll(bet, mode, target, edgeFree = false) {
  const value = Math.floor(rnd() * 10000) / 100;
  const won = mode === 'under' ? value < target : value > target;
  const mult = multiplierFor(mode, target, edgeFree);
  return {
    value,
    won,
    mult,
    payout: won ? Math.round(bet * mult) : 0,
  };
}
