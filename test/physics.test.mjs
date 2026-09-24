// Vehicle physics, run in Node with the same code the browser uses: every car
// reaches its catalog top speed, accelerates and brakes sensibly, takes a
// corner without rolling over, lands a ramp on its wheels, and the ground
// the physics drives on is the same shape as the terrain everyone sees.
//   node test/physics.test.mjs
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../public/js/physics/world.js';
import { VEHICLES } from '../shared/catalog.js';
import { RAMPS, groundHeight } from '../shared/map.js';
import { terrainGrid, terrainHeight } from '../shared/terrain.js';
import { makeChecker } from './helpers.mjs';

const { check, done } = makeChecker();
await RAPIER.init();

/** A flat test pad: a big box floor. */
function flatWorld() {
  const w = new PhysicsWorld(RAPIER);
  w.setBoxes('floor', [{ x0: -5000, x1: 5000, z0: -5000, z1: 5000, h: 1 }], { base: -1 });
  return w;
}
const run = (w, secs, input, each) => {
  let pose = null;
  for (let t = 0; t < secs; t += 1 / 60) {
    pose = w.step(1 / 60, typeof input === 'function' ? input(t, pose) : input);
    if (each) each(t, pose);
  }
  return pose;
};
const speedOf = (w) => { const v = w.vehicle.velocity(); return Math.hypot(v.x, v.z); };

for (const v of VEHICLES) {
  const w = flatWorld();
  w.startDriving(v.id, [0, 0, 0], 0);
  run(w, 1, {});                                  // settle on the springs
  const rest = w.vehicle.pose();
  check(`${v.id}: sits level on its wheels`, Math.abs(rest.pitch) < 0.06 && Math.abs(rest.roll) < 0.05 && rest.pos[1] > -0.3 && rest.pos[1] < 0.5,
    `y ${rest.pos[1].toFixed(2)} pitch ${rest.pitch.toFixed(3)}`);

  // Flat out: 0 -> 20 m/s (or 80% of top for slow machines) and the top speed.
  let t20 = null;
  const target = Math.min(20, v.top * 0.8);
  const top = run(w, 30, { throttle: 1 }, (t) => { if (t20 == null && speedOf(w) >= target) t20 = t; });
  const vmax = speedOf(w);
  check(`${v.id}: top speed within 12% of the catalog's ${v.top} m/s`, Math.abs(vmax - v.top) / v.top < 0.12, `${vmax.toFixed(1)} m/s`);
  check(`${v.id}: drives forwards (nose first)`, top.pos[2] < -50, `z ${top.pos[2].toFixed(0)}`);
  check(`${v.id}: gets to ${target.toFixed(0)} m/s in a sensible time`, t20 != null && t20 < (v.kind === 'machine' ? 12 : 9), `${t20 && t20.toFixed(1)} s`);

  // Brake from there to a stop.
  const from = w.vehicle.pose().pos;
  const s0 = speedOf(w);
  run(w, 8, { throttle: -1 }, (t, p) => { if (speedOf(w) < 0.5 && !w._stopped) w._stopped = p.pos; });
  const stop = w._stopped || w.vehicle.pose().pos;
  const dist = Math.hypot(stop[0] - from[0], stop[2] - from[2]);
  check(`${v.id}: brakes to a stop from ${s0.toFixed(0)} m/s in a sane distance`, dist < (s0 * s0) / (2 * 4) + 5, `${dist.toFixed(0)} m`);

  // A corner at 15 m/s (or what the machine can do), full lock: no rollover.
  const w2 = flatWorld();
  w2.startDriving(v.id, [0, 0, 0], 0);
  const cs = Math.min(15, v.top * 0.8);
  run(w2, 12, (t) => ({ throttle: speedOf(w2) < cs ? 1 : 0, steer: t > 4 ? 1 : 0 }));
  const p2 = w2.vehicle.pose();
  check(`${v.id}: full lock at ${cs.toFixed(0)} m/s stays on its wheels`, Math.abs(p2.roll) < 0.6 && Math.abs(p2.pitch) < 0.6, `roll ${p2.roll.toFixed(2)} pitch ${p2.pitch.toFixed(2)} speed ${speedOf(w2).toFixed(1)}`);
}

// --- a handbrake turn swings the back out
{
  const w = flatWorld();
  w.startDriving('muscle', [0, 0, 0], 0);
  run(w, 5, { throttle: 1 });
  const y0 = w.vehicle.pose().yaw;
  run(w, 1.2, { throttle: 0.3, steer: 1, handbrake: true });
  const y1 = w.vehicle.pose().yaw;
  const v = w.vehicle.velocity();
  const heading = Math.atan2(-v.x, -v.z);
  const slip = Math.abs(((y1 - heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  check('handbrake: the car rotates hard and slides', Math.abs(y1 - y0) > 0.6 && slip > 0.15, `turned ${Math.abs(y1 - y0).toFixed(2)} rad, slip ${slip.toFixed(2)}`);
}

// --- walls stop you, and it hurts
{
  const w = flatWorld();
  w.setBoxes('wall', [{ x0: -10, x1: 10, z0: -61, z1: -60, h: 4 }]);
  let hits = 0;
  w.onCrash = (f) => { if (f > 10) hits++; };
  w.startDriving('sedan', [0, 0, 0], 0);
  run(w, 6, { throttle: 1 });
  const p = w.vehicle.pose();
  check('a wall stops the car', p.pos[2] > -62, `z ${p.pos[2].toFixed(1)}`);
  check('a crash is reported (for the sound, and spilled deliveries)', hits > 0);
}

// --- the ground is the terrain
{
  const w = new PhysicsWorld(RAPIER);
  w.addTerrain(terrainGrid());
  w.step(1 / 60);                              // scene queries see colliders after a step
  const probes = [[-200.37, -350.61], [250.2, 300.9], [500.5, -440.3], [690.1, 0.7], [-450.6, -150.2], [0.3, 0.3], [-800.4, 0.9]];
  const ok = probes.every(([x, z]) => {
    const hit = w.world.castRay(new RAPIER.Ray({ x, y: 400, z }, { x: 0, y: -1, z: 0 }), 1000, true);
    const y = hit ? 400 - hit.timeOfImpact : NaN;
    return Math.abs(y - terrainHeight(x, z) + 0.03) < 0.35;
  });
  check('the physics ground matches the terrain everyone sees', ok,
    probes.map(([x, z]) => { const h = w.world.castRay(new RAPIER.Ray({ x, y: 400, z }, { x: 0, y: -1, z: 0 }), 1000, true); return `${h ? (400 - h.timeOfImpact).toFixed(1) : 'miss'}/${terrainHeight(x, z).toFixed(1)}`; }).join(' '));

  // Drive up a hill: the car climbs it rather than going through.
  w.startDriving('pickup', [-220, groundHeight(-220, -330) + 0.5, -330], Math.PI / 2);
  run(w, 1, {});
  const before = w.vehicle.pose();
  run(w, 6, { throttle: 1 });
  const after = w.vehicle.pose();
  const g = groundHeight(after.pos[0], after.pos[2]);
  check('driving over the hills follows the ground', Math.abs(after.pos[1] - g) < 1.2 && Math.hypot(after.pos[0] - before.pos[0], after.pos[2] - before.pos[2]) > 20,
    `y ${after.pos[1].toFixed(1)} ground ${g.toFixed(1)}`);
}

// --- ramps
{
  const w = flatWorld();
  w.setRamps(RAMPS);
  const r = RAMPS[0];
  // Line up behind the ramp's low end and floor it.
  const ux = Math.cos(r.dir);
  const uz = Math.sin(r.dir);
  const start = [r.x - ux * 60, 0, r.z - uz * 60];
  const yaw = Math.atan2(-ux, -uz);
  w.startDriving('hyper', start, yaw);
  let maxY = 0;
  let landed = null;
  run(w, 9, { throttle: 1 }, (t, p) => {
    maxY = Math.max(maxY, p.pos[1]);
    if (maxY > 2 && p.pos[1] < 0.6 && !landed) landed = p;
  });
  const end = w.vehicle.pose();
  check('a ramp launches the car', maxY > 2.5, `peak ${maxY.toFixed(1)} m`);
  check('and it lands on its wheels', Math.abs(end.roll) < 0.5 && Math.abs(end.pitch) < 0.5, `pitch ${end.pitch.toFixed(2)} roll ${end.roll.toFixed(2)}`);
}

// --- other people's cars are solid
{
  const w = flatWorld();
  w.setRemote('other', 'limo', [0, 0, -40], { x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) });
  w.startDriving('coupe', [0, 0, 0], 0);
  run(w, 6, { throttle: 1 });
  check('you cannot drive through a parked limo', w.vehicle.pose().pos[2] > -44, `z ${w.vehicle.pose().pos[2].toFixed(1)}`);
}

// --- a knocked-over bin flies, lands and stays in the world until removed
{
  const w = flatWorld();
  const bin = w.addDebris({ r: 0.3, h: 1 }, [0, 0.6, 0], [8, 3, 0]);
  run(w, 4, {});
  const p = bin.translation();
  check('a knocked bin flies off and comes to rest on the ground', p.x > 2 && p.y > 0 && p.y < 0.8, `x ${p.x.toFixed(1)} y ${p.y.toFixed(2)}`);
  const n = w.world.bodies.len();
  w.removeBody(bin);
  check('and is gone when it is put back', w.world.bodies.len() === n - 1);
}

done();
