// How every vehicle drives: size, weight, wheels, suspension and grip.
// Engine and drag come from the catalog (top speed and acceleration), so a
// car's physics always matches what the dealer promises.
//
// Frames: `mesh` is the vehicle's model frame (forward -Z, up +Y, ground at
// y = 0). The physics chassis uses the controller's frame (forward +Z), which
// is the mesh frame turned half a turn about Y; vehicle.js does the turning.
// Wheel positions below are in the MESH frame: [x, z, radius].
import { VEHICLE_BY_ID } from '../../../shared/catalog.js';

const car = (o) => ({
  rest: 0.3, stiffness: 32, travel: 0.25, grip: 2.4, side: 1.0, steer: 0.55, comY: 0.35, drive: 'rear',
  ...o,
});

export const VEHICLE_PHYSICS = {
  hatch:   car({ mass: 950,  len: 3.6, wid: 1.7,  lift: 0.3,  height: 1.38, wheels: [[0.8, -1.21, 0.34], [-0.8, -1.21, 0.34], [0.8, 1.21, 0.34], [-0.8, 1.21, 0.34]], drive: 'front', grip: 2.0, stiffness: 24 }),
  pickup:  car({ mass: 1700, len: 5.0, wid: 1.95, lift: 0.45, height: 1.6,  wheels: [[0.93, -1.8, 0.45], [-0.93, -1.8, 0.45], [0.93, 1.8, 0.45], [-0.93, 1.8, 0.45]], rest: 0.38, stiffness: 22, comY: 0.5 }),
  sedan:   car({ mass: 1350, len: 4.6, wid: 1.85, lift: 0.3,  height: 1.28, wheels: [[0.88, -1.69, 0.36], [-0.88, -1.69, 0.36], [0.88, 1.69, 0.36], [-0.88, 1.69, 0.36]], stiffness: 26 }),
  muscle:  car({ mass: 1550, len: 4.8, wid: 1.95, lift: 0.28, height: 1.2,  wheels: [[0.93, -1.75, 0.4], [-0.93, -1.75, 0.4], [0.93, 1.75, 0.4], [-0.93, 1.75, 0.4]], grip: 2.3, stiffness: 30 }),
  coupe:   car({ mass: 1250, len: 4.4, wid: 1.9,  lift: 0.26, height: 1.04, wheels: [[0.9, -1.59, 0.36], [-0.9, -1.59, 0.36], [0.9, 1.59, 0.36], [-0.9, 1.59, 0.36]], grip: 2.9, stiffness: 38, rest: 0.24, comY: 0.28 }),
  limo:    car({ mass: 2400, len: 7.6, wid: 1.95, lift: 0.3,  height: 1.28, wheels: [[0.93, -3.17, 0.38], [-0.93, -3.17, 0.38], [0.93, 3.17, 0.38], [-0.93, 3.17, 0.38]], steer: 0.5, stiffness: 24 }),
  hyper:   car({ mass: 1300, len: 4.5, wid: 2.0,  lift: 0.22, height: 0.88, wheels: [[0.95, -1.64, 0.36], [-0.95, -1.64, 0.36], [0.95, 1.64, 0.36], [-0.95, 1.64, 0.36]], grip: 3.4, stiffness: 46, rest: 0.2, comY: 0.24, drive: 'all' }),
  // Two wheels on screen; four narrow ones underneath so it does not fall over.
  scooter: car({ mass: 170,  len: 1.9, wid: 0.7,  lift: 0.3,  height: 1.1,  wheels: [[0.28, -0.72, 0.24], [-0.28, -0.72, 0.24], [0.28, 0.6, 0.24], [-0.28, 0.6, 0.24]], grip: 2.2, stiffness: 30, rest: 0.2, comY: 0.3, steer: 0.6 }),
  tractor: car({ mass: 3200, len: 3.9, wid: 2.3,  lift: 0.6,  height: 2.2,  wheels: [[0.8, -1.6, 0.5], [-0.8, -1.6, 0.5], [1.05, 0.9, 0.95], [-1.05, 0.9, 0.95]], rest: 0.25, stiffness: 20, comY: 0.9, grip: 2.6, steer: 0.6 }),
  combine: car({ mass: 9000, len: 8.0, wid: 3.6,  lift: 1.0,  height: 3.8,  wheels: [[1.7, -0.8, 1.2], [-1.7, -0.8, 1.2], [1.5, 2.9, 0.7], [-1.5, 2.9, 0.7]], rest: 0.3, stiffness: 18, comY: 1.4, grip: 2.4, steer: 0.5, drive: 'front' }),
};

/** Physics for one catalog vehicle, with engine and drag worked out from its top speed. */
export function tuningFor(modelId) {
  const model = VEHICLE_BY_ID[modelId] || VEHICLE_BY_ID.sedan;
  const t = VEHICLE_PHYSICS[model.body] || VEHICLE_PHYSICS.sedan;
  // Force to reach the catalog acceleration, with some left over for drag and hills.
  const engine = t.mass * model.accel * 1.25;
  return {
    ...t,
    model,
    top: model.top,
    engine,
    // Quadratic drag: a quarter of the engine's pull at top speed (the
    // engine itself fades out just past it), so cars coast down naturally.
    drag: (engine * 0.25) / (model.top * model.top),
    // Mass sits between the axles, so machines with big back wheels sit level.
    comZ: t.wheels.reduce((a, w) => a + w[1], 0) / t.wheels.length,
    brake: t.mass * 9,
    reverseTop: model.top * 0.35,
    turn: model.turn,
  };
}
