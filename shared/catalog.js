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
  beef:   { name: 'Beef',   icon: '🍖', price: 70,  kind: 'animal' },
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
  pen: {
    name: 'Cattle Pen', price: 7000, level: 5, animal: 'steer', animalName: 'Beef Steer', animalIcon: '🐂',
    animalPrice: 1200, max: 6, product: 'beef', every: 10 * MINUTE, feedPer: 3, stockCap: 15, feedCap: 150,
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
  // Comes free with a restaurant, for the delivery runs. Not sold at Motors.
  { id: 'scooter', kind: 'car', name: 'Delivery Scooter', price: 0, top: 21, accel: 10, turn: 2.6, body: 'scooter', hidden: true, blurb: 'Hot food, cold wind.' },
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
  // 3.0: city guns, for when the trouble walks on two legs.
  { id: 'pistol',    name: '9mm Pistol',           price: 900,   level: 2, damage: 26,  pellets: 1, rate: 0.28, mag: 12, reload: 1.5, spread: 0.018, range: 60,  zoom: 1.25, action: 'semi', blurb: 'Light, quick, twelve in the clip. A gang staple.' },
  { id: 'smg',       name: 'Machine Pistol',       price: 7500,  level: 5, damage: 15,  pellets: 1, rate: 0.085, mag: 30, reload: 2.2, spread: 0.035, range: 55, zoom: 1.3, action: 'auto', auto: true, blurb: 'Hold the trigger. Empties a clip in under three seconds.' },
];

/** Body armour from Rusty's: soaks up most of a hit until it is used up. */
export const ARMOR = { price: 600, level: 2, max: 100, absorb: 0.6 };
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

// ------------------------------------------------------------ restaurants
//
// A restaurant on the Sunset Strip turns farm produce into dishes worth about
// 1.8x their ingredients. Customers walk in, order what is in the pantry, wait
// for the kitchen, eat, pay and leave. Levels come from dishes served.

// A recipe can ask for "patty": beef from your cattle pen, or boar you shot.
export const INGREDIENT_GROUPS = { patty: ['beef', 'boar'] };
export const ingredientPrice = (k) => (INGREDIENT_GROUPS[k] ? ITEMS[INGREDIENT_GROUPS[k][0]].price : ITEMS[k].price);

export const RESTAURANTS = {
  burger: {
    name: 'Burger Joint', sign: 'BURGERS', icon: '🍔', wall: '#7fe7d9', trim: '#ff5fa8', neon: '#ff3d9a', floor: ['#ffffff', '#ff5fa8'],
    dishes: [
      { id: 'burger',      name: 'Classic Burger', icon: '🍔', in: { flour: 1, patty: 1, tomato: 1 }, level: 1, prep: 7 },
      { id: 'fries',       name: 'Fries',          icon: '🍟', in: { potato: 2 },                     level: 1, prep: 4 },
      { id: 'veggie',      name: 'Veggie Burger',  icon: '🥬', in: { flour: 1, carrot: 2, tomato: 1 }, level: 2, prep: 6 },
      { id: 'cheeseburger', name: 'Cheeseburger',  icon: '🧀', in: { flour: 1, patty: 1, tomato: 1, cheese: 1 }, level: 3, prep: 8 },
      { id: 'shake',       name: 'Strawberry Shake', icon: '🥤', in: { milk: 1, strawberry: 2 },       level: 4, prep: 3 },
    ],
  },
  pizza: {
    name: 'Pizzeria', sign: 'PIZZA', icon: '🍕', wall: '#ffd9a0', trim: '#2fbf71', neon: '#ff5a36', floor: ['#ffffff', '#2fbf71'],
    dishes: [
      { id: 'soup',       name: 'Tomato Soup',      icon: '🍲', in: { tomato: 3 },                         level: 1, prep: 4 },
      { id: 'wedges',     name: 'Potato Wedges',    icon: '🥔', in: { potato: 2 },                         level: 1, prep: 4 },
      { id: 'harvest',    name: 'Harvest Pizza',    icon: '🍕', in: { flour: 2, tomato: 1, corn: 2 },      level: 2, prep: 9 },
      { id: 'margherita', name: 'Margherita',       icon: '🍕', in: { flour: 2, tomato: 2, cheese: 1 },    level: 3, prep: 9 },
      { id: 'boarpizza',  name: 'Wild Boar Pizza',  icon: '🐗', in: { flour: 2, tomato: 2, patty: 1, cheese: 1 }, level: 4, prep: 10 },
      { id: 'pumpkin',    name: 'Pumpkin Special',  icon: '🎃', in: { flour: 2, pumpkin: 1, cheese: 1 },   level: 5, prep: 10 },
    ],
  },
  bakery: {
    name: 'Bakery Café', sign: 'CAFÉ', icon: '🥐', wall: '#f7c6e0', trim: '#6c5ce7', neon: '#b388ff', floor: ['#ffffff', '#6c5ce7'],
    dishes: [
      { id: 'toast',    name: 'Toast & Eggs',     icon: '🍳', in: { bread: 1, egg: 2 },                 level: 1, prep: 4 },
      { id: 'coffee',   name: 'Milky Coffee',     icon: '☕', in: { milk: 1 },                          level: 1, prep: 2 },
      { id: 'tart',     name: 'Strawberry Tart',  icon: '🥧', in: { flour: 1, strawberry: 2, egg: 1 },  level: 2, prep: 6 },
      { id: 'carrotcake', name: 'Carrot Cake',    icon: '🥕', in: { flour: 1, carrot: 3, egg: 2 },      level: 3, prep: 7 },
      { id: 'cake',     name: 'Slice of Cake',    icon: '🎂', in: { cake: 1 },                          level: 4, prep: 3 },
    ],
  },
};
export const DISH_BY_ID = Object.fromEntries(Object.values(RESTAURANTS).flatMap((r) => r.dishes.map((d) => [d.id, d])));

/** Menu price at 100%: about 1.8x what the ingredients fetch at the market. */
export function dishPrice(dish) {
  let v = 0;
  for (const [k, n] of Object.entries(dish.in)) v += ingredientPrice(k) * n;
  return Math.round((v * 1.8 + 20) / 5) * 5;
}

export const RESTO_LEVELS = [0, 40, 150, 400, 900];     // dishes served to reach levels 1..5
export const restoLevel = (served) => { let l = 1; for (let i = 1; i < RESTO_LEVELS.length; i++) if (served >= RESTO_LEVELS[i]) l = i + 1; return l; };
export const RESTO_DELIVERY_LEVEL = 3;
export const RESTO_VIP_LEVEL = 5;
export const openTables = (level, lotTables) => Math.min(lotTables, 2 + 2 * level);
export const restoStaffCap = (level) => level + 1;
// More restaurants as your farm grows: the farm level each extra one needs.
export const RESTO_SLOT_LEVELS = [4, 6, 8, 10, 12];
export const restoSlots = (farmLevel) => RESTO_SLOT_LEVELS.filter((l) => farmLevel >= l).length;
// Takings wait in each restaurant's till and are banked every few in-game
// hours (or by hand at the counter). Money in a till can be robbed.
export const TILL_BANK_HOURS = 4;
export const REMODEL_SHARE = 0.25;                      // changing type costs a quarter of the lot price
export const WHOLESALE = 1.5;                           // buying a missing ingredient in: 1.5x market price

// ----------------------------------------------------------------- workers
//
// Hired hands, from the Job Centre in town. Each has a speed (0.6x to 1.6x)
// and a trait; the wage is per in-game day and scales with speed. Workers keep
// working while the host is running, whether or not their boss is online.

export const WORKER_ROLES = {
  field:    { name: 'Field Hand',      icon: '🧑‍🌾', place: 'farm', wage: 150, blurb: 'Plows, plants the crop you pick, waters and harvests.' },
  animals:  { name: 'Animal Keeper',   icon: '🐓', place: 'farm', wage: 90,  blurb: 'Keeps the troughs full and collects eggs and milk.' },
  workshop: { name: 'Workshop Hand',   icon: '⚙️', place: 'farm', wage: 130, blurb: 'Loads the mill, dairy and bakery and collects what comes out.' },
  seller:   { name: 'Seller',          icon: '🚚', place: 'farm', wage: 70,  blurb: 'Ships your goods from the bin at 90% of market price, twice a day.' },
  cook:     { name: 'Cook',            icon: '👨‍🍳', place: 'restaurant', wage: 160, blurb: 'Cooks every order. Faster cooks, shorter waits.' },
  waiter:   { name: 'Waiter',          icon: '🤵', place: 'restaurant', wage: 100, blurb: 'Seats customers and carries the food out.' },
  driver:   { name: 'Delivery Driver', icon: '🛵', place: 'restaurant', wage: 110, blurb: 'Takes the phone orders you do not ride out yourself.' },
  soldier:  { name: 'Soldier',         icon: '🔫', place: 'hood', wage: 180, blurb: 'Patrols your hood with a gun and fights off raiders and rival gangs. Your clubhouse decides how many.' },
};

export const WORKER_TRAITS = {
  steady: { name: 'Steady',      hours: [6, 20],  pace: 1,    wage: 1,    blurb: 'Works 6am to 8pm, no fuss.' },
  early:  { name: 'Early Bird',  hours: [4, 18],  pace: 1,    wage: 1,    blurb: 'Up at 4am, gone by 6pm.' },
  night:  { name: 'Night Owl',   hours: [12, 26], pace: 1,    wage: 1.05, blurb: 'Noon until 2am. Handy for the dinner rush.' },
  keen:   { name: 'Keen',        hours: [6, 20],  pace: 1.12, wage: 1.15, blurb: '12% quicker at everything, and knows it.' },
  lazy:   { name: 'Easy-going',  hours: [7, 19],  pace: 0.8,  wage: 0.8,  blurb: 'Takes it slow. Cheap, though.' },
  green:  { name: 'Green Thumb', hours: [6, 20],  pace: 1,    wage: 1.1,  blurb: 'Waters as they plant. In a kitchen: nothing gets burnt.' },
};

export const WORKER_NAMES = [
  'Earl', 'Dolores', 'Hank', 'Maybelle', 'Otis', 'Tammy', 'Cletus', 'Rosa', 'Buck', 'Lorraine', 'Vern', 'Darlene',
  'Jimbo', 'Consuela', 'Wade', 'Peggy', 'Rusty', 'Juanita', 'Skeeter', 'Bev', 'Marv', 'Yolanda', 'Dwayne', 'Trixie',
  'Lenny', 'Carmen', 'Gus', 'Wanda', 'Tito', 'Shirl', 'Ray', 'Mercedes', 'Dale', 'Candy', 'Sal', 'Ines',
];

/** How many hands a farm can house, by house tier (tent, cabin, farmhouse, mansion). */
export const FARM_WORKER_CAP = [1, 2, 4, 6];

export const workerWage = (role, speed, trait) => {
  const r = WORKER_ROLES[role];
  const t = WORKER_TRAITS[trait] || WORKER_TRAITS.steady;
  return Math.round((r ? r.wage : 100) * (0.55 + 0.45 * speed) * t.wage / 5) * 5;
};

/** Seconds a worker spends on a job that takes `base` seconds at normal speed. */
export const workerSeconds = (base, speed, trait) => base / (speed * (WORKER_TRAITS[trait] || WORKER_TRAITS.steady).pace);

/** Is this worker on shift at in-game hour `hour` (0..24)? */
export function onShift(trait, hour) {
  const [a, b] = (WORKER_TRAITS[trait] || WORKER_TRAITS.steady).hours;
  return b > 24 ? (hour >= a || hour < b - 24) : (hour >= a && hour < b);
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

// ------------------------------------------------------------- the hood
//
// Each farmer runs a neighbourhood: their farm, their restaurants, their
// gang's clubhouse. Everyone they hire is in the gang. Upgrades are bought at
// the clubhouse; `levels` are the prices of each level in turn.

export const HOOD_UPGRADES = {
  hq:        { name: 'Clubhouse',       icon: '🏚️', start: 1, levels: [15000, 45000, 120000], level: 1, blurb: 'Room for more soldiers (2, 4, 6, 8). At level 3 you come round wearing armour.' },
  armory:    { name: 'Armoury',         icon: '🔫', start: 0, levels: [8000, 25000, 60000], level: 3, blurb: 'Better guns for your gang (pistols, then machine pistols, then rifles), and every worker fights back.' },
  walls:     { name: 'Walls & Gates',   icon: '🧱', start: 0, levels: [6000, 18000, 40000], level: 3, blurb: 'Your buildings take 20% less damage for each level.' },
  cctv:      { name: 'Lookouts & CCTV', icon: '📹', start: 0, levels: [5000, 20000], level: 4, blurb: 'Earlier warning of a raid, and raiders show on your radar.' },
  safes:     { name: 'Safes',           icon: '🔒', start: 0, levels: [4000, 12000, 30000], level: 4, blurb: 'Tills take longer to crack, and a cracked till gives up less.' },
  street:    { name: 'Streetscape',     icon: '🌴', start: 0, levels: [7000, 22000, 55000], level: 4, blurb: 'Palm trees, then strings of lights, then planters: 15% more customers a level.' },
  billboard: { name: 'Billboard',       icon: '📣', start: 0, levels: [10000], level: 6, blurb: 'A big sign on the avenue: 10% more customers.' },
  houses:    { name: 'Do Up the Houses', icon: '🏠', start: 0, levels: [12000, 35000], level: 5, blurb: 'Fences and awnings, and rent from the six houses every morning.' },
};

/** A hood's upgrade level (start level when it has never been bought). */
export const hoodLevel = (hood, key) => {
  const v = hood && hood.up && hood.up[key];
  return Number.isFinite(v) ? v : HOOD_UPGRADES[key].start;
};
export const hoodMax = (key) => HOOD_UPGRADES[key].start + HOOD_UPGRADES[key].levels.length;

export const soldierCap = (hq) => [0, 2, 4, 6, 8][Math.max(0, Math.min(4, hq))];
export const gangGun = (armory) => ['pistol', 'pistol', 'smg', 'semiauto'][Math.max(0, Math.min(3, armory))];
export const wallsFactor = (walls) => 1 - 0.2 * walls;
export const crackSeconds = (safes) => 6 * (1 + 0.5 * safes);
export const lootShare = (safes) => [0.6, 0.5, 0.4, 0.3][Math.max(0, Math.min(3, safes))];
export const streetFootfall = (street, billboard) => 1 + 0.15 * street + 0.1 * billboard;
export const houseRent = (houses) => [0, 900, 2400][Math.max(0, Math.min(2, houses))];
export const raidWarning = (cctv) => [20, 45, 75][Math.max(0, Math.min(2, cctv))];

// Building health (hood.hp, 0..100; missing = 100). Below half, a restaurant
// loses customers; at 0 it is wrecked and shut until repaired.
export const BUILDING_VALUE = { restaurant: 20000, hq: 15000, house: 5000 };
export const REPAIR_RATE = 0.15;
export const repairCost = (kind, hp, level = 1) => Math.ceil(((100 - hp) / 100) * BUILDING_VALUE[kind] * level * REPAIR_RATE / 10) * 10;

// Gang names: a farmer's gang starts as something that fits the name.
const GANG_A = ['Cornfield', 'Tractor', 'Haybale', 'Barnyard', 'Pitchfork', 'Dustbowl', 'Silo', 'Scarecrow', 'Harvest', 'Hog Lane', 'Rooster', 'Prairie'];
const GANG_B = ['Kings', 'Boys', 'Mafia', 'Crew', 'Posse', 'Syndicate', 'Family', 'Riders', 'Ballers', 'Outlaws', 'Saints', 'Kartel'];
export function defaultGangName(slug) {
  let h = 0;
  for (const c of String(slug)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${GANG_A[h % GANG_A.length]} ${GANG_B[(h >>> 8) % GANG_B.length]}`;
}
export const GANG_NAME_MAX = 22;

// The rival gangs that come raiding. Original names, original colours.
export const RIVALS = {
  coyotes: { name: 'Los Coyotes', color: '#e67e22', accent: '#e67e22', outfit: 'street', top: 'tank', legs: 'khaki', head: 'bandana', mask: true, car: 'muscle' },
  devils:  { name: 'Dust Devils MC', color: '#2d2d33', accent: '#8e1b1b', outfit: 'biker', head: 'bandana', car: 'pickup' },
  serpents: { name: 'Neon Serpents', color: '#16a085', accent: '#ffffff', outfit: 'track', head: 'capback', car: 'coupe' },
};
