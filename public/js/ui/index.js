import { createSlots } from './slots.js';
import { createDice } from './dice.js';
import { createBlackjack } from './blackjack.js';
import { createRoulette } from './roulette.js';
import { createCrash } from './crash.js';
import { createHorses } from './horses.js';
import { createCigar } from './cigar.js';
import { createRobots } from './robots.js';
import { createFarmShop, createAnimalShop, createBuilder, createLandOffice, createMachinery, createGunShop } from './shops.js';
import { createMarket, createBin, createOrders } from './market.js';
import { createCarDealer } from './dealer.js';
import { createHouse, createCoop, createBarn, createPen, createMill, createDairy, createBakery } from './farm.js';
import { createPlanner } from './planner.js';
import { createJobCentre, createStaff } from './jobs.js';
import { createRestaurant } from './restaurant.js';
import { createHq } from './hq.js';

export const GAME_UIS = {
  // The casino.
  slots: { title: 'NEON SEVENS', chips: true, create: createSlots },
  dice: { title: 'HIGH / LOW DICE', chips: true, create: createDice },
  blackjack: { title: 'BLACKJACK', chips: true, create: createBlackjack },
  roulette: { title: 'ROULETTE', chips: true, create: createRoulette },
  crash: { title: 'THE ROCKET', chips: true, create: createCrash },
  horses: { title: 'THE TRACK', chips: true, create: createHorses },
  cigar: { title: 'THE CIGAR COUNTER', chips: false, create: createCigar },
  robots: { title: 'THE SCRAPYARD', chips: true, create: createRobots },

  // Town.
  farmshop: { title: 'FARM SUPPLY — OLD PETE', chips: false, create: createFarmShop },
  market: { title: 'THE MARKET — MARGE', chips: false, create: createMarket },
  animalshop: { title: 'CLUCK & MOO — DOLLY', chips: false, create: createAnimalShop },
  builder: { title: "BUILDER'S YARD — BIG BOB", chips: false, create: createBuilder },
  landoffice: { title: 'LAND OFFICE — MS. DEEDS', chips: false, create: createLandOffice },
  cardealer: { title: 'MOTORS — SLICK VINNY', chips: false, create: createCarDealer },
  machinery: { title: 'TRACTOR BARN — HANK', chips: false, create: createMachinery },
  orders: { title: 'ORDERS BOARD', chips: false, create: createOrders },
  gunshop: { title: "RUSTY'S GUNS", chips: false, create: createGunShop },
  jobcentre: { title: 'JOB CENTRE — MRS. PRUITT', chips: false, create: createJobCentre },

  // Your farm.
  house: { title: 'HOME', chips: false, create: createHouse },
  planner: { title: 'FARM PLANNER', chips: false, create: createPlanner },
  staff: { title: 'YOUR STAFF', chips: false, create: createStaff },
  restaurant: { title: 'YOUR RESTAURANT', chips: false, create: createRestaurant },
  hq: { title: 'THE CLUBHOUSE', chips: false, create: createHq },
  bin: { title: 'SHIPPING BIN', chips: false, create: createBin },
  coop: { title: 'CHICKEN COOP', chips: false, create: createCoop },
  barn: { title: 'COW BARN', chips: false, create: createBarn },
  pen: { title: 'CATTLE PEN', chips: false, create: createPen },
  mill: { title: 'WINDMILL', chips: false, create: createMill },
  dairy: { title: 'DAIRY', chips: false, create: createDairy },
  bakery: { title: 'BAKERY', chips: false, create: createBakery },
};
