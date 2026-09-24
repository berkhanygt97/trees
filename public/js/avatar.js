import * as THREE from 'three';
import {
  plaidTexture, skinTexture,
} from './textures.js';
import { buildGun } from './guns.js';
import { createCharacter } from './character.js';

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
const HAT_STYLE = { tophat: 'flatcap', crown: 'cowboy', party: 'straw', visor: 'flatcap', cowboy: 'cowboy', traffic: 'straw', none: 'straw' };

/** What a player's farmer looks like: their colour on the flannel, their hat. */
export function farmerLook(color, hat) {
  return { outfit: 'farmer', color, head: HAT_STYLE[hat] || 'straw', skin: SKIN_TONE };
}

/**
 * A farmer for other players to look at: a jointed, animated character
 * (character.js). update(dt, moving, fast, speed) drives the gait;
 * setSeated() for driving; setGun()/setAiming() for the stance.
 */
export function createAvatar({ name, color, hat, showLabel = true }) {
  return createCharacter(farmerLook(color, hat), { name: showLabel ? name : null, tagColor: color, tagScale: 0.5 });
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
