// The six neighbourhoods. Each farmer owns one: their farm, a street of
// restaurant lots, a gang HQ, a few houses and a park. They sit either side of
// downtown, three to the west and three to the east, on the ring of avenues.
//
// Every hood is built from one template (HOOD_T) in hood-local metres: x runs
// across the hood (0..HOOD_W), z runs north to south (0..HOOD_D), with the
// hood street running east-west through the middle. West hoods use the
// template as it is, so their HQ sits at the east end, towards downtown. East
// hoods mirror where things go (never the things themselves) so their HQ also
// faces downtown. Nothing is ever rotated: a farm's gate always opens south
// onto its street, and restaurant lots face the street from either side.
//
// Axes as everywhere else: +x is east, +z is south.

// The ring of avenues around downtown that every hood street runs into.
export const AVENUE_X = 336;              // centre line of West/East Avenue (x = ±336)
export const BLVD_Z = 416;                // centre line of North/South Boulevard (z = ±416)

export const HOOD_W = 260;
export const HOOD_D = 220;

// Index = the plot index saves have always used, so plot 0's farmer gets hood 0.
export const HOODS = [
  { index: 0, name: 'Palomino Row',     short: 'Palomino',  x0: -630, z0: -110, mirror: false },
  { index: 1, name: 'Dustbowl Heights', short: 'Dustbowl',  x0: -630, z0: -390, mirror: false },
  { index: 2, name: 'Cactus Flats',     short: 'Cactus',    x0: -630, z0: 170,  mirror: false },
  { index: 3, name: 'Orchard Park',     short: 'Orchard',   x0: 370,  z0: -110, mirror: true },
  { index: 4, name: 'Magnolia Gardens', short: 'Magnolia',  x0: 370,  z0: -390, mirror: true },
  { index: 5, name: 'Sunnyside',        short: 'Sunnyside', x0: 370,  z0: 170,  mirror: true },
].map((h) => ({ ...h, x1: h.x0 + HOOD_W, z1: h.z0 + HOOD_D }));

export const HOOD_PLOT_SIZE = 70;       // the farm plot; the same 70 m square as ever

// The template, in hood-local metres (unmirrored).
export const HOOD_T = {
  woods: { x0: 0, x1: 100, z0: 0, z1: 42 },
  plot: { x0: 12, z0: 46 },                            // 70 x 70: gate on its south fence at z 116
  street: { z0: 120, z1: 130 },                        // the road
  walk: { n: [116, 120], s: [130, 134] },              // pavements either side
  lots: [
    { k: 1, side: 'north', size: 'small',  x0: 90,  x1: 108, z0: 93,  z1: 116 },
    { k: 2, side: 'north', size: 'medium', x0: 112, x1: 136, z0: 93,  z1: 116 },
    { k: 3, side: 'north', size: 'large',  x0: 140, x1: 172, z0: 93,  z1: 116 },
    { k: 4, side: 'south', size: 'medium', x0: 8,   x1: 32,  z0: 134, z1: 157 },
    { k: 5, side: 'south', size: 'small',  x0: 36,  x1: 54,  z0: 134, z1: 157 },
  ],
  hq: {
    yard: { x0: 180, x1: 252, z0: 64, z1: 116 },       // the compound
    building: { x0: 196, x1: 236, z0: 72, z1: 100 },
    door: [216, 102.5],                                // the station, on the front step
    spawn: [216, 108],                                 // where the gang's boss comes round
  },
  houses: [0, 1, 2, 3, 4, 5].map((k) => ({
    k,
    yard: { x0: 62 + 20 * k, x1: 82 + 20 * k, z0: 134, z1: 162 },
    box: { x0: 68 + 20 * k, x1: 76 + 20 * k, z0: 142, z1: 149 },
    door: [72 + 20 * k, 138.5],                        // deliveries come to the front path
  })),
  park: { x0: 190, x1: 252, z0: 136, z1: 180 },
  // Walls a gang tags: [x, z, facing] where facing is the side the paint is on.
  tags: [
    { k: 1, x: 86, z: 106, along: 'x', face: 'south' },     // side wall by the farm gate
    { k: 2, x: 204, z: 102, along: 'x', face: 'south' },    // the HQ front wall
    { k: 3, x: 232, z: 158, along: 'x', face: 'north' },    // the park's handball wall
    { k: 4, x: 3, z: 139, along: 'z', face: 'east' },       // the end wall by the south lots
  ],
  arch: { x: 256 },                                    // the gang's sign over the street, at the inner end
};

/** Hood-local x (unmirrored) to world x. */
export const hx = (h, lx) => (h.mirror ? h.x0 + HOOD_W - lx : h.x0 + lx);
export const hz = (h, lz) => h.z0 + lz;

/** A hood-local rectangle in world coordinates. */
export function hoodRect(h, r) {
  const a = hx(h, r.x0);
  const b = hx(h, r.x1);
  return { x0: Math.min(a, b), x1: Math.max(a, b), z0: hz(h, r.z0), z1: hz(h, r.z1) };
}

/** Where a hood's farm plot is (its north-west corner). Plots are never mirrored inside. */
export function hoodPlotOrigin(h) {
  const r = hoodRect(h, { x0: HOOD_T.plot.x0, x1: HOOD_T.plot.x0 + HOOD_PLOT_SIZE, z0: 0, z1: 0 });
  return { x0: r.x0, z0: hz(h, HOOD_T.plot.z0) };
}

/** Which way is downtown from this hood's street: +1 east, -1 west. */
export const inward = (h) => (h.mirror ? -1 : 1);

export const hoodLotId = (hood, k) => 100 + hood * 10 + k;

export const HOOD_LOTS = HOODS.flatMap((h) => HOOD_T.lots.map((l) => ({
  id: hoodLotId(h.index, l.k), hood: h.index, side: l.side, size: l.size, label: `${h.short} ${l.k}`,
  ...hoodRect(h, l),
})));

export const HOOD_STREETS = HOODS.map((h) => ({
  hood: h.index, x0: h.x0, x1: h.x1, z0: hz(h, HOOD_T.street.z0), z1: hz(h, HOOD_T.street.z1), kind: 'street',
}));

export const HOOD_HOUSES = HOODS.flatMap((h) => HOOD_T.houses.map((house) => {
  const [x, z] = [hx(h, house.door[0]), hz(h, house.door[1])];
  return {
    id: `h${h.index}-house${house.k + 1}`, hood: h.index, k: house.k,
    label: `No. ${house.k + 1} ${h.name}`,
    yard: hoodRect(h, house.yard), box: hoodRect(h, house.box), door: [x, 0, z],
  };
}));

export const HQS = HOODS.map((h) => ({
  hood: h.index,
  yard: hoodRect(h, HOOD_T.hq.yard),
  building: hoodRect(h, HOOD_T.hq.building),
  door: [hx(h, HOOD_T.hq.door[0]), 0, hz(h, HOOD_T.hq.door[1])],
  spawn: [hx(h, HOOD_T.hq.spawn[0]), 0, hz(h, HOOD_T.hq.spawn[1])],
}));

export const TAG_POINTS = HOODS.flatMap((h) => HOOD_T.tags.map((t) => {
  // Mirroring flips which way an east-west-facing wall looks.
  const face = h.mirror && (t.face === 'east' || t.face === 'west') ? (t.face === 'east' ? 'west' : 'east') : t.face;
  const x = hx(h, t.x);
  const z = hz(h, t.z);
  const out = { east: [1.6, 0], west: [-1.6, 0], north: [0, -1.6], south: [0, 1.6] }[face];
  return { id: `h${h.index}-tag${t.k}`, hood: h.index, k: t.k, x, z, along: t.along, face, pos: [x + out[0], 0, z + out[1]] };
}));

export const PARKS = HOODS.map((h) => ({ hood: h.index, ...hoodRect(h, HOOD_T.park) }));

/** A hood where the gang can run cars in: the street to the avenue. */
export const HOOD_CONNECTORS = HOODS.map((h) => {
  const s = HOOD_STREETS[h.index];
  return h.mirror
    ? { hood: h.index, x0: AVENUE_X - 6, x1: h.x0, z0: s.z0, z1: s.z1, kind: 'road' }
    : { hood: h.index, x0: h.x1, x1: -AVENUE_X + 6, z0: s.z0, z1: s.z1, kind: 'road' };
});

/** Which hood a point is in, or -1. */
export function hoodAt(x, z) {
  for (const h of HOODS) if (x >= h.x0 && x <= h.x1 && z >= h.z0 && z <= h.z1) return h.index;
  return -1;
}

/** Where a gang boss comes round after being knocked out, or first arrives. */
export const hoodSpawn = (i) => ({ pos: [...HQS[i].spawn], yaw: HOODS[i].mirror ? Math.PI / 2 : -Math.PI / 2 });
