// The valley as it was up to 2.2, frozen. Save migration reads old
// coordinates against this and never against the live map, which moves on.
// Do not edit: every number here is what 2.2 wrote into save files.

export const BOUNDS = { minX: -265, maxX: 265, minZ: -250, maxZ: 250 };
export const PLOT_SIZE = 70;
export const PLOTS = [-110, -185, -260, 40, 115, 190].map((x0, index) => ({ index, x0, z0: 140 }));
export const FARM_ROAD = { x0: -265, x1: 265, z0: 212, z1: 222 };

export const LOT_SIZES = { small: 4, medium: 8, large: 12 };
export const LOTS = [
  { id: 1, side: 'north', size: 'small',  x0: 70,  x1: 88,  z0: 22, z1: 45 },
  { id: 2, side: 'north', size: 'medium', x0: 92,  x1: 116, z0: 22, z1: 45 },
  { id: 3, side: 'north', size: 'large',  x0: 120, x1: 152, z0: 22, z1: 45 },
  { id: 4, side: 'north', size: 'medium', x0: 156, x1: 180, z0: 22, z1: 45 },
  { id: 5, side: 'south', size: 'medium', x0: 70,  x1: 94,  z0: 63, z1: 86 },
  { id: 6, side: 'south', size: 'small',  x0: 98,  x1: 116, z0: 63, z1: 86 },
  { id: 7, side: 'south', size: 'large',  x0: 120, x1: 152, z0: 63, z1: 86 },
  { id: 8, side: 'south', size: 'small',  x0: 156, x1: 174, z0: 63, z1: 86 },
];
export const LOT_BY_ID = new Map(LOTS.map((l) => [l.id, l]));

/**
 * The stretch of the old valley that belonged to farm k: its field, the woods
 * behind it (boars came from there) and the farm road out front. The farms
 * stood 5 m apart; these rectangles meet in the middle of each gap.
 */
export function plotRegion(plot) {
  return { x0: plot.x0 - 2.5, x1: plot.x0 + PLOT_SIZE + 2.5, z0: 115, z1: 224 };
}

/** A lot's frame, as in 2.2: `lx` across (0 in the middle), `lz` in from the pavement. */
export function lotPoint(lot, lx, lz) {
  const cx = (lot.x0 + lot.x1) / 2;
  return lot.side === 'north' ? [cx + lx, lot.z1 - lz] : [cx - lx, lot.z0 + lz];
}

/** The inverse: a world point in a lot's own frame. */
export function lotLocal(lot, x, z) {
  const cx = (lot.x0 + lot.x1) / 2;
  return lot.side === 'north' ? [x - cx, lot.z1 - z] : [cx - x, z - lot.z0];
}

export const lotYaw = (lot) => (lot.side === 'north' ? 0 : Math.PI);
