// One drivable vehicle in the physics world: a rigid chassis riding on four
// ray-cast wheels with springs, grip and a bit of slip. Throttle, brakes,
// steering and the handbrake go in; a pose comes out.
//
// No DOM and no three.js here, so the same code runs in the tests.
import { tuningFor } from './tuning.js';

const G = 9.81;

// The controller drives along its +Z; our models face -Z. The chassis is the
// model turned half a turn about Y, so these convert between the two.
const HALF_TURN = { x: 0, y: 1, z: 0, w: 0 };

export function quatMul(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}
export const yawQuat = (yaw) => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });

/** Rotates vector v by quaternion q. */
export function rotate(q, v) {
  const { x, y, z, w } = q;
  const ix = w * v.x + y * v.z - z * v.y;
  const iy = w * v.y + z * v.x - x * v.z;
  const iz = w * v.z + x * v.y - y * v.x;
  const iw = -x * v.x - y * v.y - z * v.z;
  return {
    x: ix * w + iw * -x + iy * -z - iz * -y,
    y: iy * w + iw * -y + iz * -x - ix * -z,
    z: iz * w + iw * -z + ix * -y - iy * -x,
  };
}

/** Yaw, pitch and roll (three.js 'YXZ' order) of a model-frame quaternion. */
export function eulerYXZ(q) {
  const f = rotate(q, { x: 0, y: 0, z: -1 });      // forward
  const r = rotate(q, { x: 1, y: 0, z: 0 });       // right
  const yaw = Math.atan2(-f.x, -f.z);
  const pitch = Math.asin(Math.max(-1, Math.min(1, f.y)));
  const upr = rotate(q, { x: 0, y: 1, z: 0 });
  const roll = Math.atan2(-r.y, upr.y);
  return { yaw, pitch, roll };
}

export class VehicleBody {
  /**
   * `R` is the RAPIER module, `world` a RAPIER.World. `pose` = { pos: [x,y,z], yaw }
   * in the model frame (where the car stands, which way its nose points).
   */
  constructor(R, world, modelId, pose) {
    this.R = R;
    this.world = world;
    this.t = tuningFor(modelId);
    const t = this.t;
    const [x, y, z] = pose.pos;
    const rot = quatMul(yawQuat(pose.yaw || 0), HALF_TURN);
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(x, y + 0.15, z)
      .setRotation(rot)
      .setCanSleep(false)
      .setLinearDamping(0.02)
      .setAngularDamping(0.6)
      .setCcdEnabled(true));
    this.body = body;
    // The shell: a box from just above the axles to the roof, in the chassis frame.
    const hx = t.wid / 2;
    const hy = t.height / 2;
    const hz = t.len / 2;
    const iy = (t.mass / 12) * (4 * hx * hx + 4 * hz * hz);
    const ix = (t.mass / 12) * (4 * hy * hy + 4 * hz * hz);
    const iz = (t.mass / 12) * (4 * hx * hx + 4 * hy * hy);
    const col = R.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(0, t.lift + hy, 0)
      .setFriction(0.3)
      .setRestitution(0.15)
      // Heavy and low: a low centre of mass keeps it on its wheels in a turn.
      // (Given in the collider's own frame, which sits lift + hy above the chassis origin.)
      .setMassProperties(t.mass, { x: 0, y: t.comY - (t.lift + hy), z: -t.comZ }, { x: ix, y: iy, z: iz }, { x: 0, y: 0, z: 0, w: 1 })
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(t.mass * 6);
    this.collider = world.createCollider(col, body);

    const ctrl = world.createVehicleController(body);
    ctrl.indexUpAxis = 1;
    ctrl.setIndexForwardAxis = 2;
    this.ctrl = ctrl;
    this.wheels = [];
    const k = t.stiffness;
    for (const [mx, mz, r] of t.wheels) {
      // Mesh frame to chassis frame: half a turn, so x and z flip.
      const cx = -mx;
      const cz = -mz;
      const front = mz < 0;
      ctrl.addWheel({ x: cx, y: r + t.rest, z: cz }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, t.rest, r);
      const i = this.wheels.length;
      ctrl.setWheelSuspensionStiffness(i, k);
      ctrl.setWheelSuspensionCompression(i, 0.35 * 2 * Math.sqrt(k));
      ctrl.setWheelSuspensionRelaxation(i, 0.55 * 2 * Math.sqrt(k));
      ctrl.setWheelMaxSuspensionTravel(i, t.travel);
      ctrl.setWheelMaxSuspensionForce(i, t.mass * G * 3);
      ctrl.setWheelFrictionSlip(i, t.grip);
      ctrl.setWheelSideFrictionStiffness(i, t.side);
      const driven = t.drive === 'all' || (t.drive === 'front' ? front : !front);
      this.wheels.push({ front, driven, r, mesh: [mx, mz] });
    }
    this.steer = 0;
    this.upsideDown = 0;
    this.airTime = 0;
    this.speed = 0;
  }

  /**
   * One physics step's worth of driving. input = { throttle (-1..1), steer
   * (-1 left .. 1 right), handbrake (bool) }. Call before world.step().
   */
  drive(input, dt) {
    const t = this.t;
    const ctrl = this.ctrl;
    const body = this.body;
    const v = body.linvel();
    const q = body.rotation();
    const fwd = rotate(q, { x: 0, y: 0, z: 1 });
    const speed = v.x * fwd.x + v.y * fwd.y + v.z * fwd.z;   // + forward
    this.speed = speed;
    const abs = Math.abs(speed);

    // Steering eases in and tightens up at speed, like every arcade racer.
    const maxSteer = t.steer * (1 - 0.62 * Math.min(1, abs / (t.top * 0.85)));
    const want = -(input.steer || 0) * maxSteer;
    this.steer += (want - this.steer) * Math.min(1, dt * 8);

    // Throttle forward, brake, then reverse once stopped.
    let engine = 0;
    let brake = 0;
    const th = input.throttle || 0;
    if (th > 0) {
      if (speed < -0.8) brake = t.brake;
      // Full power up to 85% of top speed, then fading out just past it.
      else engine = t.engine * th * Math.max(0, Math.min(1, (t.top * 1.03 - speed) / (t.top * 0.18)));
    } else if (th < 0) {
      if (speed > 0.8) brake = t.brake;
      else engine = t.engine * th * 0.6 * Math.max(0, 1 - Math.max(0, -speed) / t.reverseTop);
    } else {
      brake = t.mass * 0.6;          // engine braking and rolling resistance
    }
    const driven = this.wheels.filter((w) => w.driven).length;
    const contact = this.wheels.map((w, i) => ctrl.wheelIsInContact(i));
    this.wheels.forEach((w, i) => {
      ctrl.setWheelSteering(i, w.front ? this.steer : 0);
      ctrl.setWheelEngineForce(i, w.driven ? engine / driven : 0);
      const hand = input.handbrake && !w.front;
      ctrl.setWheelBrake(i, (hand ? t.brake * 1.2 : brake) / this.wheels.length / 60);
      // The handbrake lets the back end go: that is the drift.
      ctrl.setWheelSideFrictionStiffness(i, hand ? t.side * 0.28 : t.side);
      ctrl.setWheelFrictionSlip(i, hand ? t.grip * 0.7 : t.grip);
    });

    // Air drag, so the engine and the wind agree on a top speed.
    const vv = Math.hypot(v.x, v.y, v.z);
    if (vv > 0.5) {
      const f = t.drag * vv * dt;
      body.applyImpulse({ x: -v.x * f, y: -v.y * f * 0.2, z: -v.z * f }, true);
    }

    // A little air control, and turning the car back over if it lands on its roof.
    const grounded = contact.some(Boolean);
    this.airTime = grounded ? 0 : this.airTime + dt;
    const up = rotate(q, { x: 0, y: 1, z: 0 });
    if (!grounded && this.airTime > 0.15) {
      const right = rotate(q, { x: 1, y: 0, z: 0 });
      const k = t.mass * 0.9 * dt;
      body.applyTorqueImpulse({ x: right.x * th * k, y: -(input.steer || 0) * k * 0.6, z: right.z * th * k }, true);
    }
    this.upsideDown = up.y < 0.3 && abs < 3 ? this.upsideDown + dt : 0;
    if (this.upsideDown > 1.8) this.rightItself();

    ctrl.updateVehicle(dt);
  }

  /** Back on its wheels, same place, same heading. */
  rightItself() {
    const p = this.body.translation();
    const { yaw } = this.pose();
    this.body.setTranslation({ x: p.x, y: p.y + 1.2, z: p.z }, true);
    this.body.setRotation(quatMul(yawQuat(yaw), HALF_TURN), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.upsideDown = 0;
  }

  /** Where the car is, in the model frame: pos, quaternion, yaw, pitch, roll. */
  pose() {
    const p = this.body.translation();
    const q = quatMul(this.body.rotation(), HALF_TURN);
    const e = eulerYXZ(q);
    return { pos: [p.x, p.y, p.z], quat: q, ...e };
  }

  /** Put it somewhere (a teleport, or the start of a drive). */
  place(pos, yaw) {
    this.body.setTranslation({ x: pos[0], y: pos[1] + 0.15, z: pos[2] }, true);
    this.body.setRotation(quatMul(yawQuat(yaw), HALF_TURN), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  velocity() { return this.body.linvel(); }

  /** Per wheel: how far the suspension is squashed, steering, spin, and whether it touches. */
  wheelState() {
    return this.wheels.map((w, i) => ({
      mesh: w.mesh,
      front: w.front,
      steer: this.ctrl.wheelSteering(i) || 0,
      spin: this.ctrl.wheelRotation(i) || 0,
      suspension: this.ctrl.wheelSuspensionLength(i) ?? this.t.rest,
      contact: this.ctrl.wheelIsInContact(i),
    }));
  }

  remove() {
    this.world.removeVehicleController(this.ctrl);
    this.world.removeRigidBody(this.body);
  }
}
