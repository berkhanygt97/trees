// Downtown's newer buildings, on the land where the six farms stood before
// they moved out to the neighbourhoods. Footprints and heights are shared:
// the client builds them, the collision boxes come from them, and bullets
// stop at them.
//
// `style` picks the look (city/downtown.js); `sign` goes on the front.

export const BUILDINGS = [
  // West of main street: the money end of town.
  { id: 'bank',     name: 'Valley Mutual',  sign: 'VALLEY MUTUAL', color: '#6fd6ff', style: 'tower',   x0: -252, x1: -222, z0: 138, z1: 168, h: 42, face: 'south' },
  { id: 'hotel',    name: 'Hotel Royale',   sign: 'HOTEL ROYALE',  color: '#f2c14e', style: 'hotel',   x0: -208, x1: -178, z0: 150, z1: 192, h: 30, face: 'south' },
  { id: 'offices',  name: 'Pruitt & Sons',  sign: 'PRUITT & SONS', color: '#c8d0da', style: 'office',  x0: -162, x1: -136, z0: 136, z1: 162, h: 22, face: 'south' },
  { id: 'liquor',   name: 'Liquor & Lotto', sign: 'LIQUOR · LOTTO', color: '#ff5d5d', style: 'store',  x0: -114, x1: -88,  z0: 146, z1: 166, h: 5,  face: 'east' },
  { id: 'laundry',  name: 'Suds City',      sign: 'SUDS CITY',     color: '#5fe0c0', style: 'store',   x0: -114, x1: -92,  z0: 178, z1: 198, h: 5,  face: 'east' },
  // East of main street: the hospital, the motel and the gas station.
  { id: 'hospital', name: 'County General', sign: 'COUNTY GENERAL', color: '#ff4a4a', style: 'hospital', x0: 62, x1: 122, z0: 142, z1: 194, h: 14, face: 'south' },
  { id: 'gaskiosk', name: 'Gas-n-Go',       sign: 'GAS-N-GO',      color: '#ffd93d', style: 'store',   x0: 162, x1: 178, z0: 180, z1: 196, h: 4.2, face: 'west' },
  { id: 'motel1',   name: 'Sunset Motel',   sign: 'SUNSET MOTEL',  color: '#ff3d9a', style: 'motel',   x0: 206, x1: 262, z0: 136, z1: 148, h: 7,  face: 'south' },
  { id: 'motel2',   name: 'Sunset Motel',   sign: '',              color: '#ff3d9a', style: 'motel',   x0: 250, x1: 262, z0: 148, z1: 200, h: 7,  face: 'west' },
];

// Open areas that are part of the town: painted parking bays and the forecourt.
export const LOTS_OPEN = [
  { id: 'parking', kind: 'parking', x0: -80, x1: -44, z0: 140, z1: 204 },
  { id: 'forecourt', kind: 'forecourt', x0: 140, x1: 196, z0: 146, z1: 200 },
  { id: 'motelyard', kind: 'parking', x0: 206, x1: 248, z0: 150, z1: 204 },
];

// The gas station canopy's pillars (the roof is overhead, not in the way).
export const CANOPY = { x0: 144, x1: 176, z0: 150, z1: 172, h: 5.5, pillars: [[146, 152], [174, 152], [146, 170], [174, 170]] };
export const PUMPS = [[153, 158], [153, 164], [167, 158], [167, 164]];

// Where you come round if you are knocked out with no neighbourhood of your own.
export const HOSPITAL_DOOR = { pos: [92, 0, 199], yaw: Math.PI };

/** Collision boxes for all of the above: { x0, x1, z0, z1, h }. */
export function downtownBoxes() {
  const out = BUILDINGS.map((b) => ({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, h: b.h }));
  for (const [x, z] of CANOPY.pillars) out.push({ x0: x - 0.4, x1: x + 0.4, z0: z - 0.4, z1: z + 0.4, h: CANOPY.h });
  for (const [x, z] of PUMPS) out.push({ x0: x - 0.6, x1: x + 0.6, z0: z - 0.4, z1: z + 0.4, h: 1.8 });
  return out;
}
