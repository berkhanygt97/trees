// Shared between the Node server and the browser client.
// The server imports it directly; the client fetches it from /shared/config.js.

export const CONFIG = {
  // What a brand-new farmer walks in with. Money is permanent after that:
  // it is saved, and it is the same money at the market and the casino.
  STARTING_BANKROLL: 500,
  // World clock speed. 1 is normal; tests crank it up to watch crops grow.
  TIME_SCALE: 1,

  CHIPS: [25, 50, 100, 250, 500, 1000],
  MIN_BET: 25,
  MAX_BET: 5000,

  TICK_HZ: 20,
  SNAPSHOT_HZ: 15,

  // How rough the rival gangs are, set by the host: 'relaxed' (fewer, weaker,
  // rarer raids), 'normal' (scaled to how rich a hood is) or 'hardcore'.
  RAID_MODE: 'normal',

  // Movement (client-side, mirrored here so the server can sanity-check).
  WALK_SPEED: 7.2,
  SPRINT_SPEED: 12.5,
  EYE_HEIGHT: 1.72,
  GRAVITY: 24,
  JUMP_SPEED: 8.0,
};

export const ROOM = {
  MIN_X: -45, MAX_X: 45,
  MIN_Z: -40, MAX_Z: 40,
  WALL_H: 13,
  // Players cannot walk onto the racetrack.
  RAIL_Z: -21,
};

// Every interactable inside the casino. The server uses `pos`/`radius` to validate
// that a player is actually standing at the thing they are betting on; the
// client uses the same numbers to build the geometry, so they can never drift.
export const STATIONS = [
  // --- Slot wall (left) ---
  ...[-18, -12, -6, 0, 6, 12, 18, 24].map((z, i) => ({
    id: `slots-${i + 1}`, game: 'slots', name: `Slot Machine ${i + 1}`,
    pos: [-40.2, 0, z], yaw: Math.PI / 2, radius: 2.6, solid: 1.1,
  })),

  // --- Blackjack pit (right) ---
  ...[-18, -6, 6, 18].map((z, i) => ({
    id: `blackjack-${i + 1}`, game: 'blackjack', name: `Blackjack Table ${i + 1}`,
    pos: [36, 0, z], yaw: -Math.PI / 2, radius: 4.2, solid: 2.6,
  })),

  // --- Roulette (front centre) ---
  { id: 'roulette-1', game: 'roulette', name: 'Roulette', pos: [0, 0, 20], yaw: 0, radius: 7.5, solid: 3.4 },

  // --- Dice pit (either side of the entrance) ---
  { id: 'dice-1', game: 'dice', name: 'High / Low Dice', pos: [-20, 0, 28], yaw: 0.6, radius: 3.4, solid: 2.0 },
  { id: 'dice-2', game: 'dice', name: 'High / Low Dice', pos: [20, 0, 28], yaw: -0.6, radius: 3.4, solid: 2.0 },

  // --- Crash lounge (centre of the floor) ---
  { id: 'crash-1', game: 'crash', name: 'The Rocket', pos: [0, 0, 2], yaw: Math.PI, radius: 8.0, solid: 0 },

  // --- Trackside betting windows ---
  { id: 'horses-1', game: 'horses', name: 'Race Betting Window', pos: [-10, 0, -16], yaw: Math.PI, radius: 4.0, solid: 2.2 },
  { id: 'horses-2', game: 'horses', name: 'Race Betting Window', pos: [10, 0, -16], yaw: Math.PI, radius: 4.0, solid: 2.2 },

  // --- Cigar shop (right of the bar) ---
  { id: 'cigar-1', game: 'cigar', name: 'Cigar Counter', pos: [26, 0, 36], yaw: Math.PI, radius: 3.2, solid: 1.6 },

  // --- Robot cage (left of the floor, clear of the pillar at -30,-10) ---
  { id: 'robots-1', game: 'robots', name: 'The Scrapyard', pos: [-25, 0, -2], yaw: 0, radius: 8.0, solid: 5.2 },
];

export const HORSES = [
  { name: 'Lucky Lasagna',  color: '#e8503a' },
  { name: 'Sir Loses-a-Lot', color: '#3aa0e8' },
  { name: 'Tax Evasion',    color: '#f2c14e' },
  { name: 'Glue Factory',   color: '#7bd66b' },
  { name: 'Mortgage',       color: '#c471e8' },
  { name: 'Beans',          color: '#f28cb1' },
];

// Three rockets leave together. Identical odds, independently rolled — the one
// you backed dying at 1.02x while another sails past 20x is the entire game.
export const ROCKETS = [
  { name: 'RED EYE',   color: '#ff5d5d' },
  { name: 'BLUE STAR', color: '#4dc3ff' },
  { name: 'OLD GOLD',  color: '#f2c14e' },
];

// Two of these are drawn per match and given randomised stats.
export const ROBOTS = [
  { name: 'RUSTBUCKET',  color: '#e8703a' },
  { name: 'CHROME DOME', color: '#9fd4e8' },
  { name: 'THE ACCOUNTANT', color: '#6bd66b' },
  { name: 'MEGAHURTZ',   color: '#c471e8' },
  { name: 'TOASTER',     color: '#f2c14e' },
  { name: 'LAST WARNING', color: '#ff4f7a' },
];

// A cigar does nothing at all. That is the point: it costs real profit and
// everyone in the room can see you smoking it.
export const CIGAR = { PRICE: 150, PUFFS: 12 };

export const AVATAR_COLORS = [
  '#ff5d5d', '#4dc3ff', '#ffd93d', '#6bd66b', '#c471e8',
  '#ff9f43', '#2ee6c5', '#ff7ab8', '#9aa7ff', '#d4ff4d',
];

export const HATS = ['tophat', 'cowboy', 'party', 'visor', 'crown', 'traffic', 'none'];

export function money(n) {
  const v = Math.round(n);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US');
}
