// Every road in the valley, as flat rectangles { x0, x1, z0, z1, kind }.
// Downtown's roads are where they have always been; around them runs a ring of
// avenues, and every neighbourhood's street joins the ring.
//
// kind: 'avenue' (the ring), 'road', 'street' (with pavements), 'plaza'.
import { HOOD_STREETS, HOOD_CONNECTORS, AVENUE_X, BLVD_Z, HOODS, HOOD_T, hz } from './hoods.js';

const AVE = 6;          // half-width of the ring avenues

export const DOWNTOWN_ROADS = [
  { x0: -6, x1: 6, z0: 41, z1: 222, kind: 'street', name: 'Main Street' },
  { x0: -AVENUE_X, x1: AVENUE_X, z0: 212, z1: 222, kind: 'road', name: 'Farm Road' },
  { x0: -60, x1: -50, z0: -104, z1: 68, kind: 'road', name: 'Speedway Loop West' },
  { x0: 50, x1: 60, z0: -104, z1: 68, kind: 'road', name: 'Speedway Loop East' },
  { x0: 62, x1: AVENUE_X, z0: 49, z1: 59, kind: 'road', name: 'Sunset Strip' },
  { x0: -AVENUE_X, x1: -62, z0: 49, z1: 59, kind: 'road', name: 'Palomino Boulevard' },
  { x0: -AVENUE_X, x1: -60, z0: -12, z1: -2, kind: 'road', name: 'Casino Way West' },
  { x0: 60, x1: AVENUE_X, z0: -12, z1: -2, kind: 'road', name: 'Casino Way East' },
];

export const RING = [
  { x0: -AVENUE_X - AVE, x1: -AVENUE_X + AVE, z0: -BLVD_Z - AVE, z1: BLVD_Z + AVE, kind: 'avenue', name: 'West Avenue' },
  { x0: AVENUE_X - AVE, x1: AVENUE_X + AVE, z0: -BLVD_Z - AVE, z1: BLVD_Z + AVE, kind: 'avenue', name: 'East Avenue' },
  { x0: -AVENUE_X + AVE, x1: AVENUE_X - AVE, z0: -BLVD_Z - AVE, z1: -BLVD_Z + AVE, kind: 'avenue', name: 'North Boulevard' },
  { x0: -AVENUE_X + AVE, x1: AVENUE_X - AVE, z0: BLVD_Z - AVE, z1: BLVD_Z + AVE, kind: 'avenue', name: 'South Boulevard' },
];

export const ALL_ROADS = [
  ...DOWNTOWN_ROADS,
  ...RING,
  ...HOOD_CONNECTORS.map((c) => ({ ...c, name: `${HOODS[c.hood].name} turn-off` })),
  ...HOOD_STREETS.map((s) => ({ ...s, name: HOODS[s.hood].name })),
];

/** Is (x, z) on a road (with `pad` metres of verge)? */
export function onRoad(x, z, pad = 0) {
  for (const r of ALL_ROADS) if (x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad) return r;
  return null;
}

/**
 * How a car full of raiders gets from the edge of the map to a hood's street:
 * a list of [x, z] points, driving on the right-hand lane.
 * `from` is 'north' or 'south': which end of the avenue they come in from.
 */
export function raidRoute(hoodIndex, from = 'north') {
  const h = HOODS[hoodIndex];
  const sign = h.mirror ? 1 : -1;                 // which avenue: west (-1) or east (+1)
  const aveX = sign * AVENUE_X;
  const streetZ = hz(h, (HOOD_T.street.z0 + HOOD_T.street.z1) / 2);
  const lane = from === 'north' ? -2.5 : 2.5;     // keep right
  const startZ = from === 'north' ? -BLVD_Z : BLVD_Z;
  const innerX = h.mirror ? h.x0 : h.x1;          // where the hood street meets its turn-off
  return [
    [aveX + lane * sign, startZ],
    [aveX + lane * sign, streetZ],
    [innerX, streetZ + 2.5 * (h.mirror ? 1 : -1)],
  ];
}
