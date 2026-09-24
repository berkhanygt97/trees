// Pure rules for one player's farm: fields, animals and processing. Nothing
// here touches the network; the room calls these and broadcasts the result.
import {
  CROP_BY_ID, ITEMS, HOUSES, ANIMAL_HOUSES, PROCESSORS, FIELD_MAX, PROCESS_QUEUE_MAX,
  cropProgress, isWatered, wateredFor, countsAgainstStorage, levelOf,
} from '../shared/catalog.js';
import { defaultLayout, cleanLayout } from '../shared/map.js';

export const TILE_COUNT = FIELD_MAX * FIELD_MAX;

// ---------------------------------------------------------------- storage

export function storageUsed(profile) {
  let n = 0;
  for (const [item, qty] of Object.entries(profile.inv)) {
    if (countsAgainstStorage(item)) n += qty;
  }
  return n;
}

export const storageCap = (profile) => HOUSES[profile.house].storage;
export const storageFree = (profile) => Math.max(0, storageCap(profile) - storageUsed(profile));

export function addItem(profile, item, qty) {
  if (!ITEMS[item] || qty <= 0) return;
  profile.inv[item] = (profile.inv[item] || 0) + qty;
}

export function takeItem(profile, item, qty) {
  if (!(qty > 0)) return true;   // taking nothing must not turn a missing item into NaN
  if ((profile.inv[item] || 0) < qty) return false;
  profile.inv[item] -= qty;
  if (profile.inv[item] <= 0) delete profile.inv[item];
  return true;
}

// ------------------------------------------------------------------ tiles

/**
 * Performs one farming action on one tile.
 * `want` is the action the caller is allowed to do ('auto' by hand, or the
 * tractor implement's single action). Returns { changed, error, harvested }.
 */
export function workTile(profile, idx, want, { now, seed, raining }) {
  const tiles = profile.field.tiles;
  const tile = tiles[idx];

  if (tile === null || tile === undefined) {
    if (want !== 'auto' && want !== 'plow') return {};
    tiles[idx] = 0;
    return { changed: true, did: 'plow' };
  }

  if (tile === 0) {
    if (want !== 'auto' && want !== 'plant') return {};
    const crop = CROP_BY_ID[seed];
    if (!crop) return { error: 'Pick a seed first (keys 1–7)' };
    if (levelOf(profile.xp) < crop.level) return { error: `${crop.name} unlocks at farm level ${crop.level}` };
    if (!takeItem(profile, `seed:${crop.id}`, 1)) return { error: `Out of ${crop.name.toLowerCase()} seeds — the Farm Supply sells them` };
    tiles[idx] = { c: crop.id, t: now, b: 0, w: raining ? now : -1, h: crop.harvests || 1, r: 0 };
    return { changed: true, did: 'plant' };
  }

  if (cropProgress(tile, now) >= 1) {
    if (want !== 'auto' && want !== 'harvest') return {};
    const crop = CROP_BY_ID[tile.c];
    if (storageFree(profile) < crop.yield) {
      return { error: 'Storage is full — sell at the market or upgrade your house' };
    }
    addItem(profile, crop.id, crop.yield);
    profile.xp += Math.max(1, Math.round((crop.yield * crop.price) / 4));
    profile.stats.harvested = (profile.stats.harvested || 0) + crop.yield;
    // Regrowing crops go back to growing; everything else leaves soil ready to plant.
    tiles[idx] = tile.h > 1
      ? { c: tile.c, t: now, b: 0, w: raining ? now : -1, h: tile.h - 1, r: 1 }
      : 0;
    return { changed: true, did: 'harvest', harvested: { item: crop.id, qty: crop.yield } };
  }

  if (!isWatered(tile, now)) {
    if (want !== 'auto' && want !== 'water') return {};
    waterTile(tile, now);
    return { changed: true, did: 'water' };
  }

  return {};
}

export function waterTile(tile, now) {
  tile.b += wateredFor(tile, now);
  tile.w = now;
}

/** Rain waters every growing crop in the field. Returns the indices it touched. */
export function rainOn(profile, now) {
  const touched = [];
  const tiles = profile.field.tiles;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t && typeof t === 'object' && cropProgress(t, now) < 1 && !isWatered(t, now)) {
      waterTile(t, now);
      touched.push(i);
    }
  }
  return touched;
}

/** A lightning strike burns a ripe crop back to bare soil. */
export function lightningOn(profile, now, random) {
  const ripe = [];
  profile.field.tiles.forEach((t, i) => { if (t && typeof t === 'object' && cropProgress(t, now) >= 1) ripe.push(i); });
  if (!ripe.length) return [];
  const hits = [];
  const n = Math.min(ripe.length, 1 + Math.floor(random() * 3));
  for (let k = 0; k < n; k++) {
    const pickIdx = Math.floor(random() * ripe.length);
    const idx = ripe.splice(pickIdx, 1)[0];
    profile.field.tiles[idx] = 0;
    hits.push(idx);
  }
  return hits;
}

// ---------------------------------------------------------------- animals

/** Catches an animal house up to `now`: fed animals lay, hungry ones don't. */
export function settleAnimals(kind, b, now) {
  if (!b) return;
  const def = ANIMAL_HOUSES[kind];
  const cycles = Math.floor((now - b.last) / def.every);
  if (cycles <= 0) return;
  b.last += cycles * def.every;
  for (let c = 0; c < Math.min(cycles, 500); c++) {
    const n = Math.min(b.animals, Math.floor(b.feed / def.feedPer), def.stockCap - b.stock);
    if (n <= 0) break;
    b.feed -= n * def.feedPer;
    b.stock += n;
  }
}

// ------------------------------------------------------------- processing

export function settleProcessor(kind, b, now) {
  if (!b || !b.recipe || b.queue <= 0) return;
  const recipe = PROCESSORS[kind].recipes.find((r) => r.id === b.recipe);
  if (!recipe) { b.queue = 0; return; }
  while (b.queue > 0 && now >= b.started + recipe.time) {
    b.out[recipe.id] = (b.out[recipe.id] || 0) + 1;
    b.queue--;
    b.started += recipe.time;
  }
  if (b.queue === 0) b.recipe = null;
}

export function settleBuildings(profile, now) {
  for (const kind of Object.keys(ANIMAL_HOUSES)) settleAnimals(kind, profile.buildings[kind], now);
  for (const kind of Object.keys(PROCESSORS)) settleProcessor(kind, profile.buildings[kind], now);
}

// ------------------------------------------- building actions (players and workers)
//
// One set of rules for a farmer pressing a button and a hired hand doing the
// same job, so a worker can never do anything the owner could not.

/** Fills an animal trough from feed, then wheat. */
export function feedAnimals(profile, kind, now) {
  const def = ANIMAL_HOUSES[kind];
  const b = profile.buildings[kind];
  if (!def || !b) return { error: 'Nothing built here yet' };
  settleAnimals(kind, b, now);
  let room = def.feedCap - b.feed;
  if (room <= 0) return { error: 'The trough is full' };
  const fromFeed = Math.min(room, profile.inv.feed || 0);
  takeItem(profile, 'feed', fromFeed);
  room -= fromFeed;
  const fromWheat = Math.min(room, profile.inv.wheat || 0);
  takeItem(profile, 'wheat', fromWheat);
  if (!fromFeed && !fromWheat) return { error: 'You need feed or wheat' };
  b.feed += fromFeed + fromWheat;
  return { added: fromFeed + fromWheat };
}

/** Moves eggs or milk into storage. Returns { item, qty, xp }. */
export function collectAnimals(profile, kind, now) {
  const def = ANIMAL_HOUSES[kind];
  const b = profile.buildings[kind];
  if (!def || !b) return { error: 'Nothing built here yet' };
  settleAnimals(kind, b, now);
  if (!b.stock) return { error: 'Nothing to collect yet' };
  const n = Math.min(b.stock, storageFree(profile));
  if (!n) return { error: 'Storage is full' };
  b.stock -= n;
  addItem(profile, def.product, n);
  return { item: def.product, qty: n, xp: n * ITEMS[def.product].price / 6 };
}

/** Queues up to `count` batches of a recipe, as many as the storage can pay for. */
export function loadProcessor(profile, kind, recipeId, count, now) {
  const def = PROCESSORS[kind];
  const b = profile.buildings[kind];
  if (!def || !b) return { error: 'Nothing built here yet' };
  settleProcessor(kind, b, now);
  const recipe = def.recipes.find((r) => r.id === recipeId);
  if (!recipe) return { error: 'No such recipe' };
  if (b.recipe && b.recipe !== recipe.id) return { error: 'Let the current batch finish first' };
  if (b.queue >= PROCESS_QUEUE_MAX) return { error: 'The queue is full' };
  let n = Math.max(1, Math.min(Math.round(Number(count) || 1), PROCESS_QUEUE_MAX - b.queue));
  for (const [item, need] of Object.entries(recipe.in)) n = Math.min(n, Math.floor((profile.inv[item] || 0) / need));
  if (n <= 0) {
    const list = Object.entries(recipe.in).map(([k, q]) => `${q} ${ITEMS[k].name.toLowerCase()}`).join(' + ');
    return { error: `Each batch needs ${list}` };
  }
  for (const [item, need] of Object.entries(recipe.in)) takeItem(profile, item, need * n);
  if (!b.recipe) { b.recipe = recipe.id; b.started = now; }
  b.queue += n;
  return { count: n };
}

/** Moves finished goods into storage. Returns { got: [{ item, qty, xp }] }. */
export function collectProcessor(profile, kind, now) {
  const def = PROCESSORS[kind];
  const b = profile.buildings[kind];
  if (!def || !b) return { error: 'Nothing built here yet' };
  settleProcessor(kind, b, now);
  const got = [];
  for (const [item, n] of Object.entries(b.out)) {
    const take = Math.min(n, storageFree(profile));
    if (take <= 0) continue;
    addItem(profile, item, take);
    b.out[item] -= take;
    if (!b.out[item]) delete b.out[item];
    got.push({ item, qty: take, xp: take * ITEMS[item].price / 8 });
  }
  if (!got.length) return { error: Object.keys(b.out).length ? 'Storage is full' : 'Nothing ready yet' };
  return { got };
}

// ------------------------------------------------------------ new profile

export function newProfile({ name, slug, color, hat, plot, cash, pos, yaw }) {
  return {
    name, slug, color, hat,
    created: Date.now(),
    money: cash,
    xp: 0,
    pos, yaw,
    plot,
    inv: { 'seed:wheat': 20, 'seed:carrot': 10 },
    field: { size: 8, tiles: new Array(TILE_COUNT).fill(null) },
    house: 0,
    buildings: { coop: null, barn: null, pen: null, mill: null, dairy: null, bakery: null },
    vehicles: [],
    implements: [],
    guns: ['boltrifle'],
    gun: 'boltrifle',
    nextVid: 1,
    charityDay: 0,
    // Where each building and the field sit on the plot (the farm planner).
    layout: defaultLayout(),
    workers: [],
    nextWid: 1,
    restaurant: null,
    stats: {
      harvested: 0, sold: 0, wagered: 0, biggestWin: 0, orders: 0, boars: 0, playSeconds: 0,
      served: 0, deliveries: 0, wagesPaid: 0,
    },
  };
}

/** Fills in anything an older save is missing, so saves survive updates. */
export function migrateProfile(p) {
  const fresh = newProfile({ name: p.name, slug: p.slug, color: p.color, hat: p.hat, plot: p.plot, cash: 0, pos: p.pos, yaw: p.yaw });
  const out = { ...fresh, ...p };
  out.inv = {};
  for (const [k, n] of Object.entries(p.inv || {})) if (Number.isFinite(n) && n > 0) out.inv[k] = Math.floor(n);
  out.field = p.field && Array.isArray(p.field.tiles) ? p.field : fresh.field;
  while (out.field.tiles.length < TILE_COUNT) out.field.tiles.push(null);
  out.buildings = { ...fresh.buildings, ...(p.buildings || {}) };
  out.stats = { ...fresh.stats, ...(p.stats || {}) };
  out.vehicles = Array.isArray(p.vehicles) ? p.vehicles : [];
  out.implements = Array.isArray(p.implements) ? p.implements : [];
  // Everyone has Grandpa's rifle, including farmers from before guns existed.
  out.guns = Array.isArray(p.guns) ? p.guns.filter((g) => typeof g === 'string') : [];
  if (!out.guns.includes('boltrifle')) out.guns.unshift('boltrifle');
  if (!out.guns.includes(out.gun)) out.gun = 'boltrifle';
  // 2.2: farm layouts, workers and restaurants. Farms from before keep every
  // building exactly where it was.
  out.layout = cleanLayout(p.layout);
  out.workers = Array.isArray(p.workers) ? p.workers.filter((w) => w && typeof w === 'object' && w.id && w.role) : [];
  out.nextWid = Number.isFinite(p.nextWid) ? p.nextWid : out.workers.length + 1;
  out.restaurant = p.restaurant && typeof p.restaurant === 'object' && p.restaurant.lot ? p.restaurant : null;
  return out;
}

const SAVED_KEYS = Object.keys(newProfile({}));

export function toSave(profile) {
  const out = {};
  for (const k of SAVED_KEYS) out[k] = profile[k];
  // Vehicles carry runtime fields (who is driving, how fast) that must not be written out.
  out.vehicles = profile.vehicles.map(({ driver, speed, movedAt, ...v }) => v);
  return out;
}
