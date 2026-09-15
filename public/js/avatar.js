import * as THREE from 'three';
import { labelSprite } from './textures.js';

const SKIN = 0xf2c9a0;

function mat(color, opts = {}) {
  return new THREE.MeshPhongMaterial({ color, shininess: 14, specular: 0x222222, ...opts });
}

function buildHat(kind, color) {
  const g = new THREE.Group();
  switch (kind) {
    case 'tophat': {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.05, 20), mat(0x15121c));
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.58, 20), mat(0x15121c));
      top.position.y = 0.3;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 20), mat(0xc2332e));
      band.position.y = 0.08;
      g.add(brim, top, band);
      break;
    }
    case 'cowboy': {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 20), mat(0x8a5a30));
      brim.scale.z = 0.72;
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.32, 0.36, 12), mat(0x8a5a30));
      crown.position.y = 0.2;
      g.add(brim, crown);
      break;
    }
    case 'party': {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.72, 14), mat(color));
      cone.position.y = 0.36;
      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat(0xffffff));
      pom.position.y = 0.76;
      g.add(cone, pom);
      break;
    }
    case 'visor': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.055, 8, 20), mat(0x39c46a));
      band.rotation.x = Math.PI / 2;
      const peak = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.05, 0.42), mat(0x39c46a));
      peak.position.set(0, -0.02, 0.38);
      peak.rotation.x = -0.18;
      g.add(band, peak);
      g.position.y = 0.22;   // worn on the brow, dealer-style
      return g;
    }
    case 'crown': {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.2, 16), mat(0xf2c14e));
      g.add(ring);
      for (let i = 0; i < 5; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 8), mat(0xf2c14e));
        const a = (i / 5) * Math.PI * 2;
        spike.position.set(Math.cos(a) * 0.26, 0.2, Math.sin(a) * 0.26);
        g.add(spike);
      }
      break;
    }
    case 'traffic': {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.7, 12), mat(0xf27430));
      cone.position.y = 0.35;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.12, 12), mat(0xf7f3ea));
      stripe.position.y = 0.32;
      g.add(cone, stripe);
      break;
    }
    default:
      return g;
  }
  g.position.y = 0.44;
  return g;
}

/**
 * A deliberately silly little guy: giant head, googly eyes, stubby limbs.
 * `update()` drives the walk cycle and the eye wobble.
 */
export function createAvatar({ name, color, hat, showLabel = true }) {
  const group = new THREE.Group();
  const c = new THREE.Color(color);

  const legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.55, 10), mat(0x2a2233));
    leg.position.set(side * 0.19, 0.28, 0);
    leg.castShadow = true;
    group.add(leg);
    legs.push(leg);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.13, 0.4), mat(0x15121c));
    shoe.position.set(0, -0.3, 0.06);
    leg.add(shoe);
  }

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.42, 6, 14), mat(c));
  body.position.y = 0.95;
  body.castShadow = true;
  group.add(body);

  // Bow tie, because everybody dressed up.
  const tie = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.1), mat(0x15121c));
  tie.position.set(0, 0.3, 0.34);
  body.add(tie);

  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.34, 4, 8), mat(c));
    arm.position.set(side * 0.44, 1.02, 0);
    arm.castShadow = true;
    group.add(arm);
    arms.push(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), mat(SKIN));
    hand.position.y = -0.24;
    arm.add(hand);
  }

  const head = new THREE.Group();
  head.position.y = 1.62;
  group.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), mat(SKIN));
  skull.scale.set(1, 0.94, 0.95);
  skull.castShadow = true;
  head.add(skull);

  const pupils = [];
  for (const side of [-1, 1]) {
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 10), mat(0xffffff));
    white.position.set(side * 0.16, 0.06, 0.33);
    head.add(white);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), mat(0x100c14));
    pupil.position.set(0, 0, 0.09);
    white.add(pupil);
    pupils.push(pupil);
  }

  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 8, 16, Math.PI), mat(0x7a2b2b));
  mouth.position.set(0, -0.15, 0.375);
  mouth.rotation.z = Math.PI;
  head.add(mouth);

  head.add(buildHat(hat, color));

  let label = null;
  if (showLabel) {
    // Clear of the tallest hat: the sprite ignores depth, so anything it
    // overlaps gets painted over.
    label = labelSprite(name, color, 0.55);
    label.position.y = 3.05;
    label.userData.base = { x: label.scale.x, y: label.scale.y };
    group.add(label);
  }

  let t = Math.random() * 10;
  return {
    group,
    head,
    label,
    /**
     * Sprites are sized in world units, so a name tag two metres from your face
     * covers half the screen. Shrink it as it gets close, and drop it entirely
     * when you are near enough to recognise the hat.
     */
    scaleLabel(distance) {
      if (!label) return;
      label.visible = distance > 2.0;
      const k = Math.min(1, Math.max(0.3, distance / 7));
      label.scale.set(label.userData.base.x * k, label.userData.base.y * k, 1);
    },
    setVisible(v) { group.visible = v; },
    update(dt, moving, fast) {
      t += dt;
      const speed = moving ? (fast ? 15 : 10) : 2.4;
      const swing = moving ? Math.sin(t * speed) : 0;
      legs[0].rotation.x = swing * 0.8;
      legs[1].rotation.x = -swing * 0.8;
      arms[0].rotation.x = -swing * 0.65;
      arms[1].rotation.x = swing * 0.65;
      arms[0].rotation.z = 0.12;
      arms[1].rotation.z = -0.12;
      const bob = moving ? Math.abs(Math.sin(t * speed)) * 0.07 : Math.sin(t * 2) * 0.025;
      body.position.y = 0.95 + bob;
      head.position.y = 1.62 + bob;
      // Googly eyes lag behind the head — pure nonsense, worth every line.
      const wob = Math.sin(t * 6.3) * 0.03;
      pupils[0].position.x = wob;
      pupils[1].position.x = wob * 1.3;
    },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.map) o.material.map.dispose();
        if (o.material) o.material.dispose();
      });
    },
  };
}

/** The pair of hands the local player sees, clipped to the camera. */
export function createViewModel(color) {
  const g = new THREE.Group();
  const c = new THREE.Color(color);
  for (const side of [-1, 1]) {
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.2, 4, 10), mat(c));
    sleeve.position.set(side * 0.52, -0.56, -1.05);
    sleeve.rotation.set(-1.0, 0, side * 0.55);
    g.add(sleeve);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 10), mat(SKIN));
    hand.position.set(0, -0.19, 0);
    hand.scale.set(1, 0.85, 1.15);
    sleeve.add(hand);
  }
  // A little stack of chips in the right hand, so the hands have a reason to be there.
  for (let i = 0; i < 3; i++) {
    const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 18),
      mat([0xf2c14e, 0xe0403a, 0xf7f3ea][i]));
    chip.position.set(0.44, -0.66 + i * 0.022, -1.14);
    chip.rotation.set(0.25, 0, 0.35);
    g.add(chip);
  }
  g.renderOrder = 10;
  return { group: g };
}
