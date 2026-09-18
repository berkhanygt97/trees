import { createSlots } from './slots.js';
import { createDice } from './dice.js';
import { createBlackjack } from './blackjack.js';
import { createRoulette } from './roulette.js';
import { createCrash } from './crash.js';
import { createHorses } from './horses.js';
import { createAtm } from './atm.js';
import { createCigar } from './cigar.js';
import { createRobots } from './robots.js';

export const GAME_UIS = {
  slots: { title: 'NEON SEVENS', chips: true, create: createSlots },
  dice: { title: 'HIGH / LOW DICE', chips: true, create: createDice },
  blackjack: { title: 'BLACKJACK', chips: true, create: createBlackjack },
  roulette: { title: 'ROULETTE', chips: true, create: createRoulette },
  crash: { title: 'THE ROCKET', chips: true, create: createCrash },
  horses: { title: 'THE TRACK', chips: true, create: createHorses },
  atm: { title: 'BANKRUPTCY ATM', chips: false, create: createAtm },
  cigar: { title: 'THE CIGAR COUNTER', chips: false, create: createCigar },
  robots: { title: 'THE SCRAPYARD', chips: true, create: createRobots },
};
