// Everything that can be grown, made, bought or sold, with its price.
// Shared by the server (which enforces it) and the client (which shows it), so
// a price can never disagree between the shop window and the till.

// ------------------------------------------------------------------- time

// World time only runs while the server is up. One in-game day is 20 real
// minutes; every duration below is in world milliseconds.
export const MINUTE = 60_000;
export const DAY_MS = 20 * MINUTE;
export const HOUR_MS = DAY_MS / 24;
export const WATER_MS = 6 * MINUTE;     // how long one watering keeps working
export const WATER_BONUS = 0.5;         // watered crops grow 1.5x as fast

// ------------------------------------------------------------------ crops

export const CROPS = [
  { id: 'wheat',      name: 'Wheat',      icon: '🌾', seed: 2,  grow: 3,  yield: 3, price: 5,  level: 1, color: '#e3c25a' },
  { id: 'carrot',     name: 'Carrot',     icon: '🥕', seed: 4,  grow: 4,  yield: 3, price: 8,  level: 1, color: '#f08a2c' },
  { id: 'potato',     name: 'Potato',     icon: '🥔', seed: 6,  grow: 6,  yield: 4, price: 9,  level: 2, color: '#c9a36b' },
  { id: 'corn',       name: 'Corn',       icon: '🌽', seed: 8,  grow: 8,  yield: 4, price: 13, level: 3, color: '#f5d63d' },
  { id: 'tomato',     name: 'Tomato',     icon: '🍅', seed: 12, grow: 7,  yield: 3, price: 12, level: 4, color: '#e8412c', regrow: 4, harvests: 4 },
  { id: 'pumpkin',    name: 'Pumpkin',    icon: '🎃', seed: 20, grow: 12, yield: 2, price: 55, level: 5, color: '#f07a1a' },
  { id: 'strawberry', name: 'Strawberry', icon: '🍓', seed: 25, grow: 8,  yield: 4, price: 14, level: 6, color: '#e8283c', regrow: 5, harvests: 5 },
];
export const CROP_BY_ID = Object.fromEntries(CROPS.map((c) => [c.id, c]));

// ------------------------------------------------------- goods and prices

// Every item a player can hold. `price` is the market's base price; `sell:false`
// items (seeds, feed) cannot be sold back.
export const ITEMS = {
  ...Object.fromEntries(CROPS.map((c) => [c.id, { name: c.name, icon: c.icon, price: c.price, kind: 'crop' }])),
  egg:    { name: 'Eggs',   icon: '🥚', price: 30,  kind: 'animal' },
  milk:   { name: 'Milk',   icon: '🥛', price: 90,  kind: 'animal' },
  flour:  { name: 'Flour',  icon: '🌾', price: 40,  kind: 'goods' },
  cheese: { name: 'Cheese', icon: '🧀', price: 260, kind: 'goods' },
  bread:  { name: 'Bread',  icon: '🍞', price: 110, kind: 'goods' },
  cake:   { name: 'Cake',   icon: '🎂', price: 340, kind: 'goods' },
  boar:   { name: 'Boar Meat', icon: '🥩', price: 45, kind: 'game' },
  feed:   { name: 'Animal Feed', icon: '🌰', price: 4, kind: 'feed', sell: false },
  ...Object.fromEntries(CROPS.map((c) => [`seed:${c.id}`, {
    name: `${c.name} Seeds`, icon: c.icon, price: c.seed, kind: 'seed', sell: false,
  }])),
};

export const SELLABLE = Object.keys(ITEMS).filter((k) => ITEMS[k].sell !== false);

/** Seeds and feed live in the shed, not the storehouse: they never fill it up. */
export const countsAgainstStorage = (item) => ITEMS[item] && ITEMS[item].sell !== false;

// ------------------------------------------------------------------ farm

export const FIELD_SIZES = [8, 12, 16, 20];
export const FIELD_PRICES = [0, 2000, 6000, 15000];
export const FIELD_LEVELS = [1, 2, 3, 5];
export const FIELD_MAX = 20;

export const HOUSES = [
  { tier: 0, name: 'Tent',      price: 0,      storage: 500,   level: 1, blurb: 'Canvas, a sleeping bag and big dreams.' },
  { tier: 1, name: 'Log Cabin', price: 8000,   storage: 1500,  level: 2, blurb: 'A roof that does not flap in the wind.' },
  { tier: 2, name: 'Farmhouse', price: 40000,  storage: 4000,  level: 4, blurb: 'Two floors, a porch and a proper barn door.' },
  { tier: 3, name: 'Mansion',   price: 250000, storage: 12000, level: 6, blurb: 'Columns. A fountain. Absolutely unnecessary.' },
];

// Animals live in a building you have to build first.
export const ANIMAL_HOUSES = {
  coop: {
    name: 'Chicken Coop', price: 3000, level: 3, animal: 'chicken', animalName: 'Chicken', animalIcon: '🐔',
    animalPrice: 300, max: 10, product: 'egg', every: 5 * MINUTE, feedPer: 1, stockCap: 30, feedCap: 120,
  },
  barn: {
    name: 'Cow Barn', price: 9000, level: 5, animal: 'cow', animalName: 'Cow', animalIcon: '🐄',
    animalPrice: 1500, max: 6, product: 'milk', every: 8 * MINUTE, feedPer: 2, stockCap: 20, feedCap: 120,
  },
};

// Processing buildings turn cheap goods into expensive ones, slowly.
export const PROCESSORS = {
  mill: {
    name: 'Windmill', price: 5000, level: 3,
    recipes: [{ id: 'flour', in: { wheat: 5 }, time: 1 * MINUTE }],
  },
  dairy: {
    name: 'Dairy', price: 12000, level: 6,
    recipes: [{ id: 'cheese', in: { milk: 2 }, time: 3 * MINUTE }],
  },
  bakery: {
    name: 'Bakery', price: 20000, level: 7,
    recipes: [
      { id: 'bread', in: { flour: 2 }, time: 2 * MINUTE },
      { id: 'cake', in: { flour: 1, egg: 2, milk: 1 }, time: 4 * MINUTE },
    ],
  },
};
export const PROCESS_QUEUE_MAX = 20;

// --------------------------------------------------------------- vehicles

export const PAINTS = ['#d93a3a', '#2f7de0', '#f2c14e', '#3fbf6a', '#f5f5f5', '#222428', '#b04fe0', '#ff8a2a'];

export const VEHICLES = [
  // Cars: from "it runs" to "it is a personality".
  { id: 'rustbucket', kind: 'car', name: 'Rust Bucket',     price: 1500,   top: 20, accel: 7,  turn: 2.1, body: 'hatch',  blurb: 'Three doors, two working.' },
  { id: 'pickup',     kind: 'car', name: 'Farmhand Pickup', price: 6000,   top: 26, accel: 8,  turn: 1.9, body: 'pickup', blurb: 'The official truck of people who own land.' },
  { id: 'sedan',      kind: 'car', name: 'Family Sedan',    price: 12000,  top: 31, accel: 9,  turn: 2.0, body: 'sedan',  blurb: 'Beige in spirit whatever colour you paint it.' },
  { id: 'muscle',     kind: 'car', name: 'Bad Decision GT', price: 38000,  top: 39, accel: 12, turn: 1.8, body: 'muscle', blurb: 'V8, loud, drinks fuel like the casino drinks wages.' },
  { id: 'coupe',      kind: 'car', name: 'Veloce Coupe',    price: 65000,  top: 45, accel: 14, turn: 2.2, body: 'coupe',  blurb: 'Italian, allegedly.' },
  { id: 'limo',       kind: 'car', name: 'Stretch Limo',    price: 120000, top: 33, accel: 8,  turn: 1.4, body: 'limo',   blurb: 'Pull up to the casino like you mean it.' },
  { id: 'hyper',      kind: 'car', name: 'Hypercar X',      price: 220000, top: 58, accel: 20, turn: 2.3, body: 'hyper',  blurb: 'Faster than your money leaves the roulette table.' },
  // Farm machinery.
  { id: 'tractor', kind: 'machine', name: 'Tractor', price: 4000,  top: 11, accel: 5, turn: 1.7, body: 'tractor', swath: 3, blurb: 'Pulls a plow, a seeder or a water tank. Works three rows at once.' },
  { id: 'combine', kind: 'machine', name: 'Combine Harvester', price: 14000, top: 8, accel: 4, turn: 1.3, body: 'combine', swath: 5, blurb: 'Eats five rows of ripe crops at a time.' },
];
export const VEHICLE_BY_ID = Object.fromEntries(VEHICLES.map((v) => [v.id, v]));
export const MAX_VEHICLES = 8;

export const IMPLEMENTS = [
  { id: 'plow',   name: 'Plow',       price: 800,  action: 'plow',  blurb: 'Turns grass into soil.' },
  { id: 'seeder', name: 'Seeder',     price: 1200, action: 'plant', blurb: 'Plants your selected seed.' },
  { id: 'tank',   name: 'Water Tank', price: 1500, action: 'water', blurb: 'Waters growing crops.' },
];
export const IMPLEMENT_BY_ID = Object.fromEntries(IMPLEMENTS.map((i) => [i.id, i]));

// -------------------------------------------------------------------- guns
//
// Everyone owns Grandpa's old bolt rifle: accurate, hard-hitting, painfully
// slow to cycle and slower to reload. The gun shop sells the upgrades. Ammo is
// free; the magazine and the reload are what you pay for with time.
// `rate` and `reload` are seconds; `spread` is radians; damage is per pellet.

export const GUNS = [
  { id: 'boltrifle', name: "Grandpa's Bolt Rifle", price: 0,     level: 1, damage: 55,  pellets: 1, rate: 1.7,  mag: 5,  reload: 3.6, spread: 0.004, range: 130, zoom: 1.7, action: 'bolt',  blurb: 'Older than the farm. Hits hard, if you are patient.' },
  { id: 'lever',     name: 'Lever-Action .30',     price: 2500,  level: 3, damage: 50,  pellets: 1, rate: 0.75, mag: 8,  reload: 2.8, spread: 0.008, range: 110, zoom: 1.5, action: 'lever', blurb: 'Cowboy classic. Twice as quick as Grandpa.' },
  { id: 'shotgun',   name: 'Pump Shotgun',         price: 4500,  level: 4, damage: 17,  pellets: 8, rate: 1.0,  mag: 6,  reload: 3.4, spread: 0.075, range: 32,  zoom: 1.2, action: 'pump',  blurb: 'For when the boar is already in the carrots.' },
  { id: 'semiauto',  name: 'Semi-Auto Rifle',      price: 9000,  level: 6, damage: 40,  pellets: 1, rate: 0.28, mag: 15, reload: 2.4, spread: 0.012, range: 120, zoom: 1.6, action: 'semi',  blurb: 'Squeeze as fast as you like.' },
  { id: 'biggame',   name: 'Big Game Rifle',       price: 18000, level: 8, damage: 170, pellets: 1, rate: 1.3,  mag: 4,  reload: 3.0, spread: 0.002, range: 170, zoom: 2.4, action: 'bolt',  blurb: 'Drops anything with tusks in one or two.' },
];
export const GUN_BY_ID = Object.fromEntries(GUNS.map((g) => [g.id, g]));

// ------------------------------------------------------------------- boars
//
// Wild boars raid planted fields. They grow tougher with the farm's level:
// more of them, more health, faster charges and harder hits.

export const PLAYER_HP = 100;

export function boarStats(level) {
  const l = Math.max(1, level);
  return {
    hp: Math.round(100 * (1 + 0.2 * (l - 1))),
    count: Math.min(6, 2 + Math.floor(l / 4)),
    walk: 1.8,
    charge: 9 + 0.3 * l,                        // m/s; you sprint at 12.5
    windup: Math.max(0.55, 1.1 - 0.035 * l),    // seconds of warning before it goes
    steer: 0.5 + 0.08 * l,                      // rad/s it can bend a charge
    damage: Math.round(14 + 2 * (l - 1)),
    bounty: 40 + 15 * l,
    xp: 30 + 10 * l,
    meat: 1 + Math.floor(l / 4),
  };
}

// What you get back if you ever tally it up. Used for the net-worth board.
export const RESALE = 0.5;

// ---------------------------------------------------------------- levels

export const LEVEL_XP = [0, 300, 900, 2000, 4000, 8000, 14000, 24000, 40000, 65000, 100000, 150000, 220000, 320000, 450000];

export function levelOf(xp) {
  let lvl = 1;
  for (let i = 1; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) lvl = i + 1;
  return lvl;
}

export function levelProgress(xp) {
  const lvl = levelOf(xp);
  const lo = LEVEL_XP[lvl - 1];
  const hi = LEVEL_XP[lvl];
  if (hi == null) return { level: lvl, into: xp - lo, need: 0, frac: 1 };
  return { level: lvl, into: xp - lo, need: hi - lo, frac: (xp - lo) / (hi - lo) };
}

// ------------------------------------------------------------ crop growth
//
// A planted tile is { c, t, b, w, h, r }:
//   c  crop id           t  when this growth cycle started (world ms)
//   b  watered ms banked from earlier waterings
//   w  when the current watering started, or -1
//   h  harvests left (regrowing crops)   r  1 while regrowing after a harvest
// A plowed tile is 0 and grass is null. Growth is computed from world time
// whenever it is needed, so fields cost nothing to simulate.

export const growMs = (crop, regrowing) => (regrowing && crop.regrow ? crop.regrow : crop.grow) * MINUTE;

export function wateredFor(tile, now) {
  if (!tile || typeof tile !== 'object' || tile.w < 0) return 0;
  return Math.max(0, Math.min(now - tile.w, WATER_MS));
}

export function isWatered(tile, now) {
  return !!tile && typeof tile === 'object' && tile.w >= 0 && now - tile.w < WATER_MS;
}

export function cropProgress(tile, now) {
  if (!tile || typeof tile !== 'object') return 0;
  const crop = CROP_BY_ID[tile.c];
  if (!crop) return 0;
  const effective = (now - tile.t) + WATER_BONUS * (tile.b + wateredFor(tile, now));
  return Math.max(0, Math.min(1, effective / growMs(crop, tile.r)));
}

export const isRipe = (tile, now) => cropProgress(tile, now) >= 1;

/** What pressing E on this tile would do. */
export function nextAction(tile, now) {
  if (tile === null || tile === undefined) return 'plow';
  if (tile === 0) return 'plant';
  if (isRipe(tile, now)) return 'harvest';
  if (!isWatered(tile, now)) return 'water';
  return 'wait';
}

export const money = (n) => {
  const v = Math.round(n);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US');
};
