import * as THREE from 'three';
import {
  labelSprite, plaidTexture, denimTexture, strawTexture, skinTexture, faceTexture,
} from './textures.js';
import { buildGun } from './guns.js';

// Old farmers: flannel shirt in the player's colour, denim overalls, boots,
// a grey beard and a hat that has seen things. Low-poly, texture-painted —
// the way people looked in a 2004 open-world game.

const SKIN_TONE = '#d59a72';
const phong = (color, o = {}) => new THREE.MeshPhongMaterial({ color, shininess: 10, specular: 0x1a1a1a, ...o });
const skinMat = () => phong(0xffffff, { map: skinTexture(SKIN_TONE), shininess: 18, specular: 0x2a1a14 });

function mesh(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// Map the old silly hats onto three farmer hats.
const HAT_STYLE = { tophat: 'cap', crown: 'cowboy', party: 'straw', visor: 'cap', cowboy: 'cowboy', traffic: 'straw', none: 'straw' };

function buildHat(kind, color) {
  const g = new THREE.Group();
  const style = HAT_STYLE[kind] || 'straw';
  if (style === 'straw') {
    const straw = phong(0xffffff, { map: strawTexture() });
    const brim = mesh(g, new THREE.CylinderGeometry(0.3, 0.32, 0.02, 18), straw);
    brim.rotation.x = 0.04;
    mesh(g, new THREE.CylinderGeometry(0.13, 0.15, 0.13, 14), straw, 0, 0.07, 0);
    mesh(g, new THREE.CylinderGeometry(0.152, 0.152, 0.035, 14), phong(color), 0, 0.03, 0);
  } else if (style === 'cap') {
    // Flat tweed cap with a short peak.
    const tweed = phong(0xffffff, { map: plaidTexture('#6a5a48') });
    const top = mesh(g, new THREE.SphereGeometry(0.145, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), tweed, 0, -0.01, 0.01);
    top.scale.set(1.05, 0.5, 1.15);
    const peak = mesh(g, new THREE.BoxGeometry(0.2, 0.015, 0.09), tweed, 0, -0.005, 0.16);
    peak.rotation.x = 0.15;
  } else {
    const felt = phong(0x7a5230, { shininess: 4 });
    const brim = mesh(g, new THREE.CylinderGeometry(0.28, 0.28, 0.018, 18), felt);
    brim.scale.z = 0.8;
    mesh(g, new THREE.CylinderGeometry(0.11, 0.14, 0.14, 12), felt, 0, 0.075, 0);
    mesh(g, new THREE.CylinderGeometry(0.142, 0.142, 0.03, 12), phong(color), 0, 0.02, 0);
  }
  g.position.y = 0.12;
  return g;
}

/**
 * A farmer for other players to look at. Same interface as the old avatar:
 * update() drives the walk cycle; setSeated() for driving.
 */
export function createAvatar({ name, color, hat, showLabel = true }) {
  const group = new THREE.Group();
  const shirt = phong(0xffffff, { map: plaidTexture(color) });
  const denim = phong(0xffffff, { map: denimTexture() });
  const skin = skinMat();
  const boot = phong(0x3a2616, { shininess: 25 });

  // Legs pivot at the hip.
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, 0.88, 0);
    group.add(hip);
    mesh(hip, new THREE.CylinderGeometry(0.085, 0.075, 0.8, 8), denim, 0, -0.4, 0);
    mesh(hip, new THREE.BoxGeometry(0.13, 0.11, 0.26), boot, 0, -0.83, 0.04);
    legs.push(hip);
  }

  // Torso: flannel, with the overall bib and straps over it and a bit of a belly.
  const torso = new THREE.Group();
  torso.position.y = 0.88;
  group.add(torso);
  const chest = mesh(torso, new THREE.CylinderGeometry(0.2, 0.19, 0.58, 10), shirt, 0, 0.3, 0);
  chest.scale.z = 0.72;
  const belly = mesh(torso, new THREE.SphereGeometry(0.2, 10, 8), denim, 0, 0.1, 0.02);
  belly.scale.set(1, 0.8, 0.85);
  mesh(torso, new THREE.CylinderGeometry(0.19, 0.2, 0.14, 10), denim, 0, 0.02, 0).scale.z = 0.8;
  mesh(torso, new THREE.BoxGeometry(0.24, 0.22, 0.03), denim, 0, 0.32, 0.135);           // bib
  for (const side of [-1, 1]) {
    const strap = mesh(torso, new THREE.BoxGeometry(0.045, 0.34, 0.03), denim, side * 0.1, 0.44, 0.03);
    strap.rotation.x = -0.35;
    mesh(torso, new THREE.CylinderGeometry(0.014, 0.014, 0.012, 8), phong(0xc9a24a, { shininess: 80 }), side * 0.1, 0.38, 0.152).rotation.x = Math.PI / 2;
  }
  mesh(torso, new THREE.CylinderGeometry(0.075, 0.08, 0.08, 8), skin, 0, 0.62, 0);        // neck

  // Arms pivot at the shoulder; rolled-up sleeves show the forearm.
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.25, 0.55, 0);
    torso.add(shoulder);
    mesh(shoulder, new THREE.CylinderGeometry(0.07, 0.065, 0.32, 8), shirt, 0, -0.15, 0);
    mesh(shoulder, new THREE.CylinderGeometry(0.075, 0.075, 0.05, 8), shirt, 0, -0.3, 0);   // cuff roll
    mesh(shoulder, new THREE.CylinderGeometry(0.052, 0.045, 0.22, 8), skin, 0, -0.42, 0);
    mesh(shoulder, new THREE.BoxGeometry(0.07, 0.1, 0.044), skin, 0, -0.57, 0.01);
    arms.push(shoulder);
  }

  // Head: a painted face on a slightly long skull, grey beard and moustache.
  const head = new THREE.Group();
  head.position.y = 1.62;
  group.add(head);
  const skull = mesh(head, new THREE.SphereGeometry(0.13, 14, 12), phong(0xffffff, { map: faceTexture(SKIN_TONE) }));
  skull.scale.set(1, 1.15, 1.05);
  skull.rotation.y = -Math.PI / 2;   // put the painted face on the front
  const nose = mesh(head, new THREE.ConeGeometry(0.025, 0.06, 6), skin, 0, -0.005, 0.135);
  nose.rotation.x = Math.PI / 2;
  for (const side of [-1, 1]) mesh(head, new THREE.SphereGeometry(0.03, 8, 6), skin, side * 0.13, 0, 0).scale.set(0.5, 1, 0.8);   // ears
  const grey = phong(0xd9d6cf, { shininess: 2 });
  const beard = mesh(head, new THREE.SphereGeometry(0.11, 10, 8, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.55), grey, 0, -0.05, 0.035);
  beard.scale.set(1.05, 1.1, 1);
  mesh(head, new THREE.BoxGeometry(0.1, 0.022, 0.03), grey, 0, -0.045, 0.13);              // moustache
  head.add(buildHat(hat, color));

  // Cigar in the corner of the mouth; hidden until one is bought.
  const cigar = new THREE.Group();
  const stick = mesh(cigar, new THREE.CylinderGeometry(0.012, 0.014, 0.14, 8), phong(0x5b3a1e));
  stick.rotation.z = Math.PI / 2;
  stick.rotation.y = -0.4;
  mesh(cigar, new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff7a2a }), 0.065, 0, 0.03);
  cigar.position.set(0.04, -0.07, 0.13);
  cigar.visible = false;
  head.add(cigar);
  const cigarTip = new THREE.Object3D();
  cigarTip.position.set(0.075, 0, 0.035);
  cigar.add(cigarTip);

  // A rifle slung on the back, so everyone can see you came armed.
  let slung = null;

  let label = null;
  if (showLabel) {
    label = labelSprite(name, color, 0.5);
    label.position.y = 2.35;
    label.userData.base = { x: label.scale.x, y: label.scale.y };
    group.add(label);
  }

  let t = Math.random() * 10;
  let seated = false;
  let aiming = false;

  return {
    group,
    head,
    label,
    setCigar(on) { cigar.visible = !!on; },
    hasCigar() { return cigar.visible; },
    tipWorld(target) { return cigarTip.getWorldPosition(target); },
    /** Shows the gun this player is holding, or nothing. */
    setGun(id) {
      if (slung && slung.userData.id === id) return;
      if (slung) { torso.remove(slung); slung = null; }
      if (!id) return;
      slung = buildGun(id).group;
      slung.userData.id = id;
      slung.scale.setScalar(1.25);
      torso.add(slung);
    },
    setAiming(v) { aiming = v; },
    scaleLabel(distance) {
      if (!label) return;
      label.visible = distance > 2.0;
      const k = Math.min(1, Math.max(0.3, distance / 7));
      label.scale.set(label.userData.base.x * k, label.userData.base.y * k, 1);
    },
    setVisible(v) { group.visible = v; },
    /** Behind the wheel: a little smaller to fit the cabin, legs out, hands on the wheel. */
    setSeated(on) {
      if (on === seated) return;
      seated = on;
      group.scale.setScalar(on ? 0.85 : 1);
      if (label) label.visible = !on;
    },
    get seated() { return seated; },
    update(dt, moving, fast) {
      t += dt;
      if (slung) {
        // Held in both hands in front, pointing where the player looks.
        slung.visible = !seated;
        slung.position.set(0.1, 0.42, 0.28);
        slung.rotation.set(0, Math.PI, 0);
      }
      if (seated) {
        legs[0].rotation.x = legs[1].rotation.x = -1.4;
        arms[0].rotation.x = arms[1].rotation.x = -1.2;
        arms[0].rotation.z = 0.25;
        arms[1].rotation.z = -0.25;
        torso.rotation.x = 0;
        return;
      }
      const speed = moving ? (fast ? 11 : 7.5) : 1.5;
      const swing = moving ? Math.sin(t * speed) : 0;
      legs[0].rotation.x = swing * 0.6;
      legs[1].rotation.x = -swing * 0.6;
      if (slung) {
        // Both arms forward to hold the gun.
        arms[0].rotation.set(-1.25, 0, -0.35);
        arms[1].rotation.set(aiming ? -1.45 : -1.05, 0, 0.45);
      } else {
        arms[0].rotation.set(-swing * 0.5, 0, 0.08);
        arms[1].rotation.set(swing * 0.5, 0, -0.08);
      }
      // A slight old-man stoop, and a breathing bob when standing.
      torso.rotation.x = moving ? 0.08 : 0.04 + Math.sin(t * 1.4) * 0.01;
      const bob = moving ? Math.abs(Math.sin(t * speed)) * 0.03 : 0;
      torso.position.y = 0.88 + bob;
      head.position.y = 1.62 + bob;
    },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      if (label) label.material.map.dispose();
    },
  };
}

// ================================================================== hands

const FINGERS = [
  // [knuckle x (towards the little finger), segment lengths]
  [-0.028, [0.043, 0.026, 0.02]],   // index
  [-0.009, [0.047, 0.03, 0.022]],   // middle
  [0.01, [0.044, 0.028, 0.02]],     // ring
  [0.027, [0.035, 0.021, 0.017]],   // little
];

/**
 * A properly jointed hand with forearm and rolled-up flannel sleeve. Fingers
 * point down -Z with the palm facing -Y. `side` is 1 for the right hand.
 */
export function makeHand(side, sleeveColor) {
  const g = new THREE.Group();
  const skin = skinMat();
  const nail = phong(0xe8c4b4, { shininess: 60 });
  const knuckleMat = phong(0xffffff, { map: skinTexture('#c98c66') });

  mesh(g, new THREE.BoxGeometry(0.078, 0.028, 0.092), skin, 0, 0, -0.05);
  // Soft edges on the palm so it does not read as a brick.
  const heel = mesh(g, new THREE.SphereGeometry(0.04, 10, 8), skin, 0, -0.004, -0.015);
  heel.scale.set(1.0, 0.45, 0.9);

  const joints = [];
  for (const [kx, lens] of FINGERS) {
    let parent = new THREE.Group();
    parent.position.set(kx * side, 0, -0.094);
    g.add(parent);
    mesh(parent, new THREE.SphereGeometry(0.0115, 8, 6), knuckleMat, 0, 0.002, 0);
    const chain = [];
    let r = 0.0102;
    lens.forEach((len, k) => {
      const seg = new THREE.Group();
      if (k > 0) seg.position.z = -lens[k - 1];
      parent.add(seg);
      const bone = mesh(seg, new THREE.CylinderGeometry(r * 0.92, r, len, 7), skin, 0, 0, -len / 2);
      bone.rotation.x = Math.PI / 2;
      mesh(seg, new THREE.SphereGeometry(r * 0.95, 7, 5), skin, 0, 0, -len);
      if (k === lens.length - 1) {
        const n = mesh(seg, new THREE.BoxGeometry(r * 1.5, 0.003, len * 0.55), nail, 0, r * 0.75, -len * 0.62);
        n.rotation.x = 0.05;
      }
      chain.push(seg);
      parent = seg;
      r *= 0.9;
    });
    joints.push(chain);
  }

  // Thumb: sits lower on the side, points forward and inward.
  const thumbBase = new THREE.Group();
  thumbBase.position.set(-0.042 * side, -0.008, -0.03);
  thumbBase.rotation.set(0.2, 0.75 * side, -0.4 * side);
  g.add(thumbBase);
  const thumb = [];
  let tp = thumbBase;
  [0.038, 0.028].forEach((len, k) => {
    const seg = new THREE.Group();
    if (k > 0) seg.position.z = -0.038;
    tp.add(seg);
    const bone = mesh(seg, new THREE.CylinderGeometry(0.0115, 0.0125, len, 7), skin, 0, 0, -len / 2);
    bone.rotation.x = Math.PI / 2;
    mesh(seg, new THREE.SphereGeometry(0.0118, 7, 5), skin, 0, 0, -len);
    if (k === 1) mesh(seg, new THREE.BoxGeometry(0.015, 0.003, 0.014), nail, 0, 0.009, -len * 0.7);
    thumb.push(seg);
    tp = seg;
  });

  // Wrist, forearm and a rolled flannel sleeve.
  const forearm = mesh(g, new THREE.CylinderGeometry(0.03, 0.036, 0.24, 9), skin, 0, -0.002, 0.11);
  forearm.rotation.x = Math.PI / 2;
  forearm.scale.set(1.15, 1, 0.85);
  const sleeveMat = phong(0xffffff, { map: plaidTexture(sleeveColor) });
  const roll = mesh(g, new THREE.CylinderGeometry(0.05, 0.05, 0.06, 10), sleeveMat, 0, 0, 0.25);
  roll.rotation.x = Math.PI / 2;
  const sleeve = mesh(g, new THREE.CylinderGeometry(0.046, 0.05, 0.3, 10), sleeveMat, 0, 0, 0.42);
  sleeve.rotation.x = Math.PI / 2;

  /** 0 = flat, 1 = a fist. The thumb curls separately. */
  function setCurl(finger = 0, thumbCurl = finger) {
    joints.forEach((chain, i) => {
      const c = finger * (1 + i * 0.04);
      chain[0].rotation.x = -c * 1.25;
      chain[1].rotation.x = -c * 1.45;
      chain[2].rotation.x = -c * 1.1;
    });
    thumb[0].rotation.x = -thumbCurl * 0.5;
    thumb[1].rotation.x = -thumbCurl * 0.9;
  }
  setCurl(0.25, 0.1);
  return { group: g, setCurl };
}

// =============================================================== view model

/**
 * What you see of yourself in first person: two hands, the gun when it is
 * out, and the cigar. Lives in its own overlay scene so a gun never pokes
 * through a wall you are standing against.
 */
export function createViewModel(color) {
  const g = new THREE.Group();
  const right = makeHand(1, color);
  const left = makeHand(-1, color);
  g.add(right.group, left.group);

  // Idle: hands low at the bottom corners, relaxed.
  const IDLE_R = { p: new THREE.Vector3(0.2, -0.265, -0.38), r: new THREE.Euler(0.45, -0.15, 0.25) };
  const IDLE_L = { p: new THREE.Vector3(-0.21, -0.275, -0.39), r: new THREE.Euler(0.45, 0.15, -0.25) };
  right.group.position.copy(IDLE_R.p);
  right.group.rotation.copy(IDLE_R.r);
  left.group.position.copy(IDLE_L.p);
  left.group.rotation.copy(IDLE_L.r);

  // The gun rig: the gun sits in the right hand; the left supports the fore-end.
  const rig = new THREE.Group();
  g.add(rig);
  let gun = null;
  let gunId = null;
  const HIP = new THREE.Vector3(0.12, -0.15, -0.3);
  // Aimed: the gun's sight line on the crosshair (set per gun in setGun).
  const AIM = new THREE.Vector3(0, -0.074, -0.3);
  const HOLSTERED = new THREE.Vector3(0.12, -0.55, -0.3);
  rig.position.copy(HOLSTERED);
  let out = false;
  let aimK = 0;
  let drawK = 0;
  let recoil = 0;
  let cycleT = 0;
  let cycleLen = 1;
  let reloadT = 0;
  let reloadLen = 1;
  let gestureT = 0;
  let t = 0;

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, map: flashTexture() }),
  );
  flash.visible = false;

  // Cigar, held in the right hand when no gun is out.
  const cigar = new THREE.Group();
  const stick = mesh(cigar, new THREE.CylinderGeometry(0.009, 0.011, 0.13, 8), phong(0x5b3a1e));
  stick.rotation.z = Math.PI / 2;
  mesh(cigar, new THREE.CylinderGeometry(0.012, 0.012, 0.022, 8), phong(0xc9a227), -0.035, 0, 0).rotation.z = Math.PI / 2;
  const ember = mesh(cigar, new THREE.SphereGeometry(0.011, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff7a2a }), 0.068, 0, 0);
  const tip = new THREE.Object3D();
  tip.position.x = 0.08;
  cigar.add(tip);
  cigar.position.set(-0.01, -0.03, -0.1);
  cigar.rotation.set(0, 0.6, 0.2);
  cigar.visible = false;
  right.group.add(cigar);
  const PUFF_SECONDS = 1.6;
  let puffT = 0;

  function setGun(id) {
    if (id === gunId) return;
    if (gun) rig.remove(gun.group);
    gunId = id;
    gun = id ? buildGun(id) : null;
    if (gun) {
      rig.add(gun.group);
      gun.muzzle.add(flash);
      AIM.y = -gun.sight;
    }
  }

  const tmpV = new THREE.Vector3();
  const GRIP_R = new THREE.Vector3(0.012, -0.055, 0.035);
  const MOUTH = new THREE.Vector3(0.05, -0.1, -0.18);

  function poseHands(dt) {
    const armed = drawK > 0.01 && gun;
    rig.updateMatrix();
    if (!armed) {
      left.group.position.lerp(IDLE_L.p, Math.min(1, dt * 10));
      left.group.rotation.copy(IDLE_L.r);
      left.setCurl(0.3, 0.1);
      right.group.rotation.copy(IDLE_R.r);
      right.setCurl(cigar.visible ? 0.55 : 0.3, 0.1);
      return;
    }
    // Right hand on the grip, unless it is working the bolt.
    const rp = GRIP_R.clone();
    let workingBolt = false;
    if (cycleT > 0) {
      const u = 1 - cycleT / cycleLen;
      const swing = Math.sin(Math.min(1, u) * Math.PI);
      if (gun.parts.bolt && gunId !== 'semiauto') {
        rp.set(0.075, 0.035 + swing * 0.02, 0.04 + swing * 0.07);
        gun.parts.bolt.position.z = swing * 0.07;
        gun.parts.bolt.rotation.z = -swing * 0.9;
        workingBolt = true;
      } else if (gun.parts.lever) {
        gun.parts.lever.rotation.x = swing * 0.9;
        rp.y -= swing * 0.03;
      } else if (gun.parts.pump) {
        gun.parts.pump.position.z = swing * 0.07;
      } else if (gun.parts.bolt) {
        gun.parts.bolt.position.z = swing * 0.04;
      }
    }
    tmpV.copy(rp).applyMatrix4(rig.matrix);
    right.group.position.copy(tmpV);
    // Aiming, the elbows come out: forearms run off down and to the sides
    // instead of straight back under your eye.
    right.group.rotation.set(rig.rotation.x + 0.2 + aimK * 0.5, rig.rotation.y + aimK * 0.65, rig.rotation.z + (workingBolt ? 0.9 : 0.35));
    right.setCurl(workingBolt ? 0.5 : 0.85, 0.7);

    // Left hand under the fore-end (riding the pump), dipping to the magazine on reload.
    const lp = gun.left.clone();
    if (gun.parts.pump) lp.z += gun.parts.pump.position.z;
    lp.y -= 0.03;
    if (reloadT > 0) {
      const dip = Math.sin((1 - reloadT / reloadLen) * Math.PI);
      lp.x += (0 - lp.x) * dip;
      lp.y += (-0.12 - lp.y) * dip;
      lp.z += (-0.06 - lp.z) * dip;
    }
    tmpV.copy(lp).applyMatrix4(rig.matrix);
    left.group.position.copy(tmpV);
    left.group.rotation.set(rig.rotation.x - 0.1 + aimK * 0.35, rig.rotation.y - aimK * 0.45, Math.PI * 0.55 + rig.rotation.z);
    left.setCurl(0.6, 0.5);
  }

  g.renderOrder = 10;
  return {
    group: g,
    right,
    left,
    setGun,
    get gunId() { return gunId; },
    get drawn() { return out; },
    /** Looking through a scope: the gun and hands get out of the way. */
    get scoped() { return !!(gun && gun.scope && aimK > 0.85); },
    setDrawn(v) { out = !!v && !!gun; },
    setCigar(on) {
      cigar.visible = !!on;
      if (!on) puffT = 0;
    },
    hasCigar() { return cigar.visible; },
    puff() {
      if (!cigar.visible || puffT > 0 || out) return false;
      puffT = PUFF_SECONDS;
      return true;
    },
    isPuffing() { return puffT > 0; },
    tipWorld(target) { return tip.getWorldPosition(target); },
    muzzleWorld(target) { return gun ? gun.muzzle.getWorldPosition(target) : target; },
    /** Visual kick and, for manual actions, the bolt/lever/pump cycle. */
    fire(cycleSeconds) {
      recoil = 1;
      flash.visible = true;
      flash.material.opacity = 1;
      flash.rotation.z = Math.random() * Math.PI;
      cycleLen = Math.max(0.2, Math.min(cycleSeconds * 0.8, 1.2));
      cycleT = cycleLen;
    },
    reload(seconds) { reloadLen = Math.max(0.1, seconds); reloadT = reloadLen; },
    get reloading() { return reloadT > 0; },
    /** A quick reach down, when you work a tile by hand. */
    gesture() { gestureT = 0.35; },
    update(dt, { moving = false, sprinting = false, aiming = false } = {}) {
      t += dt;
      drawK += ((out ? 1 : 0) - drawK) * Math.min(1, dt * 9);
      aimK += ((out && aiming && reloadT <= 0 ? 1 : 0) - aimK) * Math.min(1, dt * 12);
      recoil = Math.max(0, recoil - dt * 6);
      cycleT = Math.max(0, cycleT - dt);
      reloadT = Math.max(0, reloadT - dt);
      gestureT = Math.max(0, gestureT - dt);
      flash.material.opacity = Math.max(0, flash.material.opacity - dt * 18);
      flash.visible = flash.material.opacity > 0.02;

      // Sway and bob, less when aiming down the sights.
      const freq = sprinting ? 11 : 7.5;
      const bobAmt = (moving ? (sprinting ? 0.022 : 0.012) : 0.003) * (1 - aimK * 0.85);
      const bx = Math.sin(t * freq) * bobAmt;
      const by = -Math.abs(Math.cos(t * freq)) * bobAmt;

      // Rig: holstered -> hip -> aim, plus recoil and the reload tilt.
      const pos = HOLSTERED.clone().lerp(HIP, drawK).lerp(AIM, aimK);
      pos.x += bx;
      pos.y += by;
      pos.z += recoil * 0.05;
      rig.position.copy(pos);
      const tilt = reloadT > 0 ? Math.sin((1 - reloadT / reloadLen) * Math.PI) : 0;
      const lowered = sprinting && !aiming ? 1 : 0;
      rig.rotation.set(recoil * 0.1 - tilt * 0.35 - lowered * 0.3, 0, tilt * 0.5 + lowered * 0.3);
      const scoped = !!(gun && gun.scope && aimK > 0.85);
      rig.visible = drawK > 0.02 && !scoped;
      right.group.visible = !scoped;
      left.group.visible = !scoped;
      poseHands(dt);

      // Hands at rest breathe a little; a farming gesture dips the right hand.
      if (drawK <= 0.01) {
        const dip = gestureT > 0 ? Math.sin((1 - gestureT / 0.35) * Math.PI) : 0;
        right.group.position.set(IDLE_R.p.x + bx, IDLE_R.p.y + by - dip * 0.08, IDLE_R.p.z - dip * 0.05);
        left.group.position.set(IDLE_L.p.x + bx, IDLE_L.p.y + by, IDLE_L.p.z);
      }

      // The cigar goes up to the mouth and back.
      if (puffT > 0) {
        puffT = Math.max(0, puffT - dt);
        const p = 1 - puffT / PUFF_SECONDS;
        const k = Math.max(0, Math.min(1, p < 0.35 ? p / 0.35 : p < 0.65 ? 1 : 1 - (p - 0.65) / 0.35));
        right.group.position.lerp(MOUTH, k);
        right.group.rotation.x = IDLE_R.r.x + k * 0.8;
        ember.material.color.setHex(k > 0.5 ? 0xffd24a : 0xff7a2a);
        ember.scale.setScalar(1 + k * 0.6);
      }
    },
  };
}

let flashTex = null;
function flashTexture() {
  if (flashTex) return flashTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,230,1)');
  gr.addColorStop(0.3, 'rgba(255,200,90,0.9)');
  gr.addColorStop(1, 'rgba(255,120,20,0)');
  c.fillStyle = gr;
  for (let i = 0; i < 6; i++) {
    c.save();
    c.translate(32, 32);
    c.rotate((i / 6) * Math.PI * 2);
    c.beginPath();
    c.moveTo(0, -4); c.lineTo(30, 0); c.lineTo(0, 4);
    c.fill();
    c.restore();
  }
  c.beginPath(); c.arc(32, 32, 14, 0, 7); c.fill();
  flashTex = new THREE.CanvasTexture(cv);
  return flashTex;
}
