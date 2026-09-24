import * as THREE from 'three';
import { pbr, metal, glass, carPaint, carGlass } from './gfx/materials.js';
import { VEHICLE_BY_ID } from '/shared/catalog.js';
import { labelSprite, shadowTexture } from './textures.js';
import { mergeGeometries } from './merge.js';

// Cars have shaped bodies: a side profile (sloping bonnet, raked windscreen,
// boot, wheel arches) extruded to the car's width with rounded edges, a glass
// cabin on top with pillars and a roof, chrome bumpers, a grille and mirrors.
// Lacquered paint (metal flakes under a clear coat), chrome and see-through
// glass reflect the live sky (scene.environment); through the glass, seats,
// a dashboard and a steering wheel. Head and tail lamps glow (brighter at
// night, the brake lights when slowing). Machines (tractor, combine,
// scooter) are built from parts.
// Local frame: forward is -Z (the same as a player's yaw), up is +Y.


const phong = (color, o = {}) => pbr(color, { shininess: 40, ...o });
const GLASS = carGlass();
const MACHINE_GLASS = glass(0x141c26);
const TYRE = phong(0x151515, { roughness: 0.85, normalMap: treadMap(), normalScale: new THREE.Vector2(1.2, 1.2) });
const UNDER = phong(0x0e0e0f, { roughness: 0.95 });
const RIM = metal(0xc8c8c8, 0.22);
const CHROME = metal(0xffffff, 0.06);
const GRILLE = phong(0x1a1a1c, { roughness: 0.6 });
// Lamp lenses: plain colours (no shading), turned up past white so they glow.
const HEAD = new THREE.MeshBasicMaterial({ color: 0xfff6d0 });
const TAIL = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
const DARK = phong(0x222226, { shininess: 10 });
const TINT = carGlass(0x121820, { opacity: 0.6 });
const SEAT = pbr(0x2a2826, { roughness: 0.9 });
const LINING = pbr(0x57544e, { roughness: 0.95 });
/** Box faces: +x, -x, +y, -y, +z, -z. A roof is lacquered on top and lined with cloth underneath. */
const lined = (paint) => [paint, paint, paint, LINING, paint, paint];
const DASH = pbr(0x1b1b1e, { roughness: 0.55 });

/** A tyre's tread: blocks across it and two grooves round it (u round, v across). */
function treadMap() {
  const W = 256;
  const H = 32;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgb(128,128,255)';
  g.fillRect(0, 0, W, H);
  // Groove walls as slopes: a dark edge and a light edge each side of a cut.
  for (let x = 0; x < W; x += 8) {
    g.fillStyle = 'rgb(70,128,230)'; g.fillRect(x, 0, 1, H);
    g.fillStyle = 'rgb(186,128,230)'; g.fillRect(x + 2, 0, 1, H);
  }
  for (const y of [9, 22]) {
    g.fillStyle = 'rgb(128,70,230)'; g.fillRect(0, y, W, 1);
    g.fillStyle = 'rgb(128,186,230)'; g.fillRect(0, y + 2, W, 1);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  t.anisotropy = 4;
  return t;
}

/** Physical dimensions the controls and the farm need. */
export const SPECS = {
  hatch:   { radius: 1.3, seat: [-0.35, 0.45, 0.1],  cam: [0, 3.2, 7.5],  eye: 1.05 },
  pickup:  { radius: 1.45, seat: [-0.4, 0.6, -0.4],  cam: [0, 3.6, 8.5],  eye: 1.2 },
  sedan:   { radius: 1.4, seat: [-0.4, 0.45, 0],     cam: [0, 3.3, 8],    eye: 1.05 },
  muscle:  { radius: 1.45, seat: [-0.4, 0.4, 0.3],   cam: [0, 3.1, 8.2],  eye: 0.95 },
  coupe:   { radius: 1.4, seat: [-0.4, 0.35, 0.4],   cam: [0, 3.0, 8],    eye: 0.9 },
  limo:    { radius: 1.6, seat: [-0.4, 0.45, -2.4],  cam: [0, 4.0, 11.5], eye: 1.05 },
  hyper:   { radius: 1.4, seat: [-0.35, 0.28, 0.3],  cam: [0, 2.8, 7.8],  eye: 0.8 },
  tractor: { radius: 1.6, seat: [0, 1.3, 0.75],      cam: [0, 4.6, 9],    eye: 0.95, work: 3.4 },
  combine: { radius: 2.8, seat: [0, 3.4, -1.0],      cam: [0, 7.5, 14],   eye: 1.0, work: -4.6 },
  scooter: { radius: 0.9, seat: [0, 0.72, 0.3],      cam: [0, 2.4, 5.2],  eye: 0.92 },
  ttop:    { radius: 1.45, seat: [-0.4, 0.36, 0.35], cam: [0, 3.0, 8.1],  eye: 0.9 },
};

export const specOf = (modelId) => SPECS[(VEHICLE_BY_ID[modelId] || {}).body] || SPECS.sedan;

function box(parent, w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function wheel(parent, r, w, x, y, z, wheels, spokes = 0) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 30), TYRE);
  tyre.rotation.z = Math.PI / 2;
  g.add(tyre);
  if (spokes) {
    // An alloy: a dark dish behind a silver lip, `spokes` spokes and a hub
    // (the silver merged into one mesh, so it costs what the plain rim did).
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.64, r * 0.64, w + 0.01, 24), DARK);
    dish.rotation.z = Math.PI / 2;
    g.add(dish);
    const silver = [
      new THREE.CylinderGeometry(r * 0.7, r * 0.7, w + 0.005, 24, 1, true).rotateZ(Math.PI / 2),
      new THREE.CylinderGeometry(r * 0.16, r * 0.16, w + 0.05, 12).rotateZ(Math.PI / 2),
    ];
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      silver.push(new THREE.BoxGeometry(w + 0.03, r * 0.5, r * 0.2).rotateX(a).translate(0, Math.cos(a) * r * 0.34, Math.sin(a) * r * 0.34));
    }
    g.add(new THREE.Mesh(mergeGeometries(silver), RIM));
    for (const geo of silver) geo.dispose();
  } else {
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 20), RIM);
    rim.rotation.z = Math.PI / 2;
    g.add(rim);
    // A spoke so you can see it turn.
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, r * 0.9, 0.12), DARK);
    g.add(spoke);
  }
  g.position.set(x, y, z);
  parent.add(g);
  wheels.push({ g, r, front: z < 0 });
  return g;
}

/** Extrudes a side profile (u forward, v up) to `width`, centred, facing -Z. */
function profileMesh(shape, width, mat, bevel = 0.06) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, width - bevel * 2), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 12,
  });
  // Extruded along +Z with u along +X: turn it so u runs to -Z (forward) and the width runs along X.
  geo.rotateY(Math.PI / 2);
  geo.translate(-width / 2 + bevel, 0, 0);
  return new THREE.Mesh(geo, mat);
}

/**
 * A car: a shaped body with wheel arches, a cabin on top, four wheels.
 * o: len, wid, bodyH (sill to beltline), lift (ground clearance), cabLen
 * (roof length), cabH, cabZ (cabin centre, +Z is the back), wheelR, and the
 * shape: nose (how far the bonnet drops), tail (how far the boot drops),
 * rake / rakeBack (how far the screens lean, per metre of cabin height).
 * Trim, all optional: ttop (lift-out glass roof panels either side of a
 * centre bar), lights: 'quad' (four round lamps in a black bezel),
 * bumpers: 'body' (painted, not chrome), spokes (alloy wheels).
 */
function car(g, wheels, paint, o) {
  const { len, wid, bodyH, lift, cabLen, cabH, cabZ, wheelR, roof = true } = o;
  const nose = o.nose ?? 0.12;
  const tail = o.tail ?? 0.06;
  const rake = o.rake ?? 0.9;
  const rakeBack = o.rakeBack ?? 0.7;
  const L = len / 2;
  const belt = lift + bodyH;
  const wz = len / 2 - wheelR - 0.25;
  const ar = wheelR + 0.1;
  const du = Math.sqrt(Math.max(0, ar * ar - (lift - wheelR) ** 2));
  const a = Math.asin(Math.max(-1, Math.min(1, (lift - wheelR) / ar)));
  // Cabin, in forward coordinates (u = -z).
  const cu = -cabZ;
  const roofF = cu + cabLen / 2;
  const roofB = cu - cabLen / 2;
  const baseF = Math.min(L - 0.5, roofF + rake * cabH);
  const baseB = Math.max(-L + 0.4, roofB - rakeBack * cabH);

  // The lower body: bumpers, bonnet, beltline, boot, and arches over the wheels.
  const s = new THREE.Shape();
  s.moveTo(-L + 0.18, lift);
  s.lineTo(-wz - du, lift);
  s.absarc(-wz, wheelR, ar, Math.PI - a, a, true);
  s.lineTo(wz - du, lift);
  s.absarc(wz, wheelR, ar, Math.PI - a, a, true);
  s.lineTo(L - 0.18, lift);
  s.quadraticCurveTo(L, lift, L, lift + 0.18);
  s.lineTo(L, belt - nose - 0.12);
  s.quadraticCurveTo(L, belt - nose, L - 0.2, belt - nose + 0.02);
  s.lineTo(baseF, belt);
  s.lineTo(baseB, belt);
  s.lineTo(-L + 0.2, belt - tail);
  s.quadraticCurveTo(-L, belt - tail, -L, belt - tail - 0.14);
  s.lineTo(-L, lift + 0.18);
  s.quadraticCurveTo(-L, lift, -L + 0.18, lift);
  const body = profileMesh(s, wid, paint, 0.07);
  g.add(body);

  if (roof) {
    // The glasshouse: tinted glass all round, leaning in a touch at the top.
    const c = new THREE.Shape();
    c.moveTo(baseB, belt - 0.02);
    c.lineTo(baseF, belt - 0.02);
    c.lineTo(roofF, belt + cabH);
    c.lineTo(roofB, belt + cabH);
    c.closePath();
    const cab = profileMesh(c, wid - 0.22, GLASS, 0.05);
    cab.userData.cab = true;
    g.add(cab);
    // Roof panel and pillars in the body colour.
    const roofLen = roofF - roofB;
    const roofY = belt + cabH + 0.02;
    if (o.ttop) {
      // T-top: a centre bar and rails front and back, the glass showing between.
      box(g, 0.26, 0.07, roofLen + 0.08, 0, roofY, -(roofF + roofB) / 2, lined(paint));
      box(g, wid - 0.18, 0.07, 0.14, 0, roofY, -roofF + 0.03, lined(paint));
      box(g, wid - 0.18, 0.07, 0.14, 0, roofY, -roofB - 0.03, lined(paint));
      for (const sx of [-1, 1]) {
        box(g, 0.06, 0.07, roofLen + 0.08, sx * (wid / 2 - 0.12), roofY, -(roofF + roofB) / 2, paint);
        box(g, wid / 2 - 0.3, 0.03, roofLen - 0.2, sx * (wid / 4 + 0.02), roofY + 0.02, -(roofF + roofB) / 2, TINT);   // the glass panel
      }
    } else {
      box(g, wid - 0.18, 0.07, roofLen + 0.08, 0, roofY, -(roofF + roofB) / 2, lined(paint));
    }
    const pillar = (u0, u1, x) => {
      const dz = -(u1 - u0);
      const len2 = Math.hypot(dz, cabH);
      const m = box(g, 0.09, len2, 0.12, x, belt + cabH / 2, -(u0 + u1) / 2, paint);
      m.rotation.x = Math.atan2(dz, cabH);
    };
    for (const x of [-(wid / 2 - 0.12), wid / 2 - 0.12]) {
      pillar(baseF, roofF, x);                 // A pillars, along the windscreen
      pillar(baseB, roofB, x);                 // C pillars, along the rear screen
      if (cabLen > 1.4) box(g, 0.09, cabH, 0.12, x, belt + cabH / 2, -cu, paint);   // B pillar
    }
    // Wing mirrors: a stalk, a rounded housing, the glass facing back.
    for (const sx of [-1, 1]) {
      const mz = -(baseF - 0.2);
      box(g, 0.1, 0.03, 0.05, sx * (wid / 2 + 0.01), belt + 0.06, mz, DARK);
      const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), paint);
      shell.scale.set(0.1, 0.065, 0.07);
      shell.position.set(sx * (wid / 2 + 0.1), belt + 0.09, mz);
      g.add(shell);
      const face = new THREE.Mesh(new THREE.CircleGeometry(1, 16), CHROME);
      face.scale.set(0.085, 0.052, 1);
      face.position.set(sx * (wid / 2 + 0.1), belt + 0.09, mz + 0.05);
      g.add(face);
    }
    // Door handles.
    const doors = cabLen > 1.4 ? [-cu - 0.35, -cu + cabLen * 0.35] : [-cu - 0.1];
    for (const sx of [-1, 1]) for (const z of doors) box(g, 0.02, 0.035, 0.16, sx * (wid / 2 + 0.07), belt - 0.1, z, CHROME);

    // Inside, seen through the glass (hidden from the driver's own seat,
    // where the cockpit has its own): dashboard, steering wheel, seats.
    const inside = [];
    inside.push(box(g, wid - 0.3, 0.16, 0.38, 0, belt + 0.02, -(baseF - 0.32), DASH));
    const wheelX = -(wid / 2 - 0.55);
    const steering = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 24), DASH);
    steering.position.set(wheelX, belt + 0.14, -(baseF - 0.62));
    steering.rotation.x = -0.45;
    g.add(steering);
    inside.push(steering);
    const seatZ = -cu + Math.min(0.35, cabLen * 0.2);
    for (const sx of [-1, 1]) {
      const x = sx * (wid / 2 - 0.55);
      const back = box(g, 0.46, 0.5, 0.12, x, belt + 0.14, seatZ, SEAT);
      back.rotation.x = 0.18;
      inside.push(back, box(g, 0.24, 0.14, 0.1, x, belt + 0.46, seatZ + 0.06, SEAT));
    }
    if (cabLen > 1.4) inside.push(box(g, wid - 0.4, 0.42, 0.12, 0, belt + 0.1, -cu + cabLen * 0.42, SEAT));
    g.userData.riderHides = [...(g.userData.riderHides || []), ...inside];
  }

  // Chrome bumpers, a grille, lights, a number plate, exhaust. The body's
  // rounded edge stands 7 cm proud of its profile, so the trim on the nose
  // and the tail sits out past that (FACE), or it would be buried in the paint.
  const FACE = 0.085;
  const bodyBumpers = o.bumpers === 'body';
  for (const sz of [-1, 1]) {
    if (bodyBumpers) box(g, wid + 0.04, 0.17, 0.2, 0, lift + 0.13, sz * (L + 0.04), paint);
    else box(g, wid + 0.04, 0.14, 0.2, 0, lift + 0.16, sz * (L + 0.03), CHROME);
  }
  box(g, wid * 0.46, (bodyH - nose) * 0.36, 0.05, 0, lift + (bodyH - nose) * 0.55, -L - FACE, GRILLE);
  box(g, 0.44, 0.12, 0.02, 0, lift + 0.36, L + (bodyBumpers ? 0.16 : 0.12), phong(0xf2efe6));
  for (const sx of [-1, 1]) {
    const hy = lift + (bodyH - nose) * 0.62;
    if (o.lights === 'quad') {
      // Two round sealed beams a side, set in a black bezel.
      box(g, 0.5, 0.2, 0.05, sx * (wid / 2 - 0.36), hy, -L - FACE, DARK);
      for (const dx of [-0.11, 0.11]) {
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 12), HEAD);
        lamp.rotation.x = Math.PI / 2;
        lamp.position.set(sx * (wid / 2 - 0.36) + dx, hy, -L - FACE - 0.012);
        g.add(lamp);
      }
    } else {
      box(g, 0.32, 0.14, 0.05, sx * (wid / 2 - 0.28), hy, -L - FACE, HEAD);
    }
    box(g, 0.34, 0.13, 0.05, sx * (wid / 2 - 0.28), lift + (bodyH - tail) * 0.7, L + FACE, TAIL);
  }
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), CHROME);
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(wid / 2 - 0.35, lift + 0.08, L + 0.08);
  g.add(pipe);
  // Under the car, dark, so the arches read as holes.
  box(g, wid - 0.2, 0.08, len - 0.6, 0, lift + 0.04, 0, UNDER);
  const wx = wid / 2 - 0.05;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(g, wheelR, 0.3, sx * wx, wheelR, sz * wz, wheels, o.spokes || 0);
  return body;
}

const BUILDERS = {
  /** A little Italian-style delivery scooter with a box on the back. */
  scooter(g, wheels, paint) {
    const cream = phong(0xf3ead8);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), paint);
    shell.scale.set(0.9, 0.75, 1.3);
    shell.position.set(0, 0.55, 0.35);
    g.add(shell);
    box(g, 0.36, 0.08, 1.0, 0, 0.32, -0.15, cream);                       // footboard
    const apron = box(g, 0.44, 0.7, 0.12, 0, 0.62, -0.62, paint);         // leg shield
    apron.rotation.x = -0.25;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8), CHROME);
    stem.position.set(0, 0.95, -0.72);
    stem.rotation.x = -0.25;
    g.add(stem);
    // The rider sees their own handlebars (cockpit.js), so these hide then.
    g.userData.riderHides = [
      stem,
      box(g, 0.62, 0.05, 0.05, 0, 1.28, -0.78, CHROME),                   // handlebar
      box(g, 0.22, 0.14, 0.1, 0, 1.24, -0.84, paint),                     // headset
    ];
    box(g, 0.12, 0.1, 0.03, 0, 1.2, -0.9, HEAD);                          // headlight
    box(g, 0.34, 0.12, 0.6, 0, 0.88, 0.3, phong(0x2b2b2b, { shininess: 20 }));   // seat
    box(g, 0.56, 0.5, 0.52, 0, 1.2, 0.72, paint);                         // delivery box
    box(g, 0.58, 0.08, 0.54, 0, 1.47, 0.72, cream);
    box(g, 0.16, 0.08, 0.04, 0, 0.62, 0.9, TAIL);
    wheel(g, 0.24, 0.12, 0, 0.24, -0.72, wheels);
    wheel(g, 0.24, 0.12, 0, 0.24, 0.6, wheels);
  },
  hatch(g, wheels, paint) {
    car(g, wheels, paint, { len: 3.6, wid: 1.7, bodyH: 0.72, lift: 0.3, cabLen: 1.6, cabH: 0.66, cabZ: 0.35, wheelR: 0.34, nose: 0.14, tail: 0.02, rake: 0.8, rakeBack: 0.25 });
    // Rust patches and a mismatched door: it has been through things.
    const rust = phong(0x8a4a22, { shininess: 4 });
    box(g, 0.02, 0.3, 0.5, 0.86, 0.6, 1.2, rust);
    box(g, 0.02, 0.22, 0.4, -0.86, 0.5, -1.1, rust);
    box(g, 0.03, 0.6, 1.0, -0.86, 0.66, 0.1, phong(0x8a8f7a));
  },
  pickup(g, wheels, paint) {
    car(g, wheels, paint, { len: 5.0, wid: 1.95, bodyH: 0.8, lift: 0.45, cabLen: 1.4, cabH: 0.8, cabZ: -0.45, wheelR: 0.45, nose: 0.08, tail: 0, rake: 0.55, rakeBack: 0.08 });
    // Open load bed at the back.
    box(g, 1.9, 0.5, 0.08, 0, 1.5, 0.4, paint);
    box(g, 0.08, 0.5, 2.1, 0.92, 1.5, 1.45, paint);
    box(g, 0.08, 0.5, 2.1, -0.92, 1.5, 1.45, paint);
    box(g, 1.7, 0.1, 2.0, 0, 1.3, 1.45, DARK);
    box(g, 1.9, 0.12, 0.2, 0, 1.0, -2.6, CHROME);
  },
  sedan(g, wheels, paint) {
    car(g, wheels, paint, { len: 4.6, wid: 1.85, bodyH: 0.66, lift: 0.3, cabLen: 1.8, cabH: 0.62, cabZ: 0.1, wheelR: 0.36, nose: 0.12, tail: 0.05, rake: 0.95, rakeBack: 0.8 });
  },
  muscle(g, wheels, paint) {
    car(g, wheels, paint, { len: 4.8, wid: 1.95, bodyH: 0.68, lift: 0.28, cabLen: 1.3, cabH: 0.52, cabZ: 0.5, wheelR: 0.4, nose: 0.04, tail: 0.02, rake: 1.2, rakeBack: 1.5 });
    box(g, 0.7, 0.2, 0.9, 0, 1.06, -1.4, DARK);   // hood scoop
    const stripe = phong(0xf5f5f5);
    // Racing stripes over the bonnet, roof and boot (the body's rounded top is 7 cm up).
    for (const s of [-0.22, 0.22]) {
      box(g, 0.16, 0.02, 1.7, s, 1.035, -1.5, stripe);
      box(g, 0.16, 0.02, 1.15, s, 1.035, 1.75, stripe);
    }
    for (const s of [-0.5, 0.5]) box(g, 0.12, 0.12, 0.6, s, 0.3, 2.5, CHROME);   // exhausts
  },
  /**
   * An eighties wedge: long bonnet with a bulge and a scoop, quad lamps in a
   * black bezel, body-colour bumpers and skirts, a fastback, lift-out T-tops,
   * five-spoke alloys.
   */
  ttop(g, wheels, paint) {
    const len = 4.7;
    const wid = 1.9;
    const lift = 0.26;
    const bodyH = 0.6;
    const nose = 0.16;
    const wheelR = 0.37;
    car(g, wheels, paint, {
      len, wid, bodyH, lift, cabLen: 1.25, cabH: 0.5, cabZ: 0.45, wheelR, nose, tail: 0.02, rake: 1.6, rakeBack: 2.4,
      ttop: true, lights: 'quad', bumpers: 'body', spokes: 5,
    });
    // The bonnet rises from the nose to the screen: the bulge follows it.
    const L = len / 2;
    const belt = lift + bodyH;
    const baseF = 0.175 + 1.6 * 0.5;
    const slope = (belt - (belt - nose + 0.02)) / (L - 0.2 - baseF);
    const onBonnet = (z) => belt - (-z - baseF) * slope + 0.07;
    const bulge = box(g, 0.8, 0.07, 1.25, 0, onBonnet(-1.6) + 0.02, -1.6, paint);
    bulge.rotation.x = -Math.atan(slope);
    // A scoop at the back of the bulge, open to the front.
    const scoop = box(g, 0.5, 0.12, 0.42, 0, onBonnet(-1.15) + 0.1, -1.15, paint);
    scoop.rotation.x = -Math.atan(slope);
    box(g, 0.42, 0.07, 0.02, 0, onBonnet(-1.36) + 0.11, -1.36, DARK);
    // Front lip, side skirts, ducktail, a black panel between the tail lights.
    box(g, wid - 0.1, 0.07, 0.24, 0, lift - 0.015, -L + 0.02, DARK);
    const wz = L - wheelR - 0.25;
    for (const sx of [-1, 1]) box(g, 0.07, 0.13, 2 * wz - 2 * (wheelR + 0.1) - 0.1, sx * (wid / 2 + 0.005), lift + 0.07, 0, paint);
    const duck = box(g, wid - 0.24, 0.05, 0.28, 0, belt + 0.06, L - 0.22, paint);
    duck.rotation.x = 0.18;
    box(g, wid - 0.95, 0.12, 0.03, 0, lift + (bodyH - 0.02) * 0.7, L + 0.08, DARK);
    // Louvres over the rear glass (it drops from the roof at z = 1.075 to the boot at 1.95).
    const glassDrop = 0.5 / (1.95 - 1.075);
    for (let i = 0; i < 5; i++) {
      const z = 1.22 + i * 0.13;
      const louvre = box(g, wid - 0.55, 0.02, 0.1, 0, belt + 0.5 - (z - 1.075) * glassDrop + 0.05, z, DARK);
      louvre.rotation.x = 0.2;
    }
  },
  coupe(g, wheels, paint) {
    car(g, wheels, paint, { len: 4.4, wid: 1.9, bodyH: 0.56, lift: 0.26, cabLen: 1.1, cabH: 0.48, cabZ: 0.35, wheelR: 0.36, nose: 0.16, tail: 0.04, rake: 1.5, rakeBack: 1.6 });
    box(g, 1.8, 0.08, 0.4, 0, 1.25, 2.0, paint);   // spoiler
    for (const s of [-0.7, 0.7]) box(g, 0.08, 0.35, 0.1, s, 1.05, 2.0, DARK);
  },
  limo(g, wheels, paint) {
    car(g, wheels, paint, { len: 7.6, wid: 1.95, bodyH: 0.68, lift: 0.3, cabLen: 4.6, cabH: 0.6, cabZ: 0.35, wheelR: 0.38, nose: 0.1, tail: 0.04, rake: 0.95, rakeBack: 0.8 });
    box(g, 1.96, 0.05, 7.4, 0, 0.62, 0, CHROME);
    // Middle axle, because nobody believes a car this long only has four wheels.
    for (const sx of [-1, 1]) wheel(g, 0.38, 0.3, sx * 0.93, 0.38, 0.2, wheels);
  },
  hyper(g, wheels, paint) {
    car(g, wheels, paint, { len: 4.5, wid: 2.0, bodyH: 0.46, lift: 0.22, cabLen: 0.9, cabH: 0.42, cabZ: 0.25, wheelR: 0.36, nose: 0.2, tail: 0, rake: 2.2, rakeBack: 2.0 });
    box(g, 2.1, 0.08, 0.5, 0, 1.3, 2.05, DARK);   // rear wing
    for (const s of [-0.85, 0.85]) box(g, 0.08, 0.5, 0.12, s, 1.05, 2.05, DARK);
    const glow = new THREE.MeshBasicMaterial({ color: 0x4df0ff });
    for (const s of [-1, 1]) box(g, 0.05, 0.05, 3.6, s * 1.0, 0.3, 0, glow);
  },
  tractor(g, wheels, paint) {
    box(g, 1.2, 0.9, 2.6, 0, 1.15, -0.7, paint);            // engine
    box(g, 1.25, 0.12, 2.65, 0, 1.62, -0.7, DARK);
    box(g, 0.12, 0.9, 0.12, 0.35, 2.05, -1.4, DARK);        // exhaust
    box(g, 1.6, 0.3, 1.4, 0, 1.05, 0.9, paint);             // seat deck
    box(g, 0.6, 0.12, 0.6, 0, 1.35, 0.9, DARK);             // seat
    // Roll cage and roof.
    for (const sx of [-0.72, 0.72]) for (const sz of [0.3, 1.5]) box(g, 0.08, 1.6, 0.08, sx, 2.0, sz, DARK);
    box(g, 1.7, 0.1, 1.5, 0, 2.8, 0.9, paint);
    wheel(g, 0.95, 0.55, 1.05, 0.95, 0.9, wheels);
    wheel(g, 0.95, 0.55, -1.05, 0.95, 0.9, wheels);
    wheel(g, 0.5, 0.35, 0.8, 0.5, -1.6, wheels);
    wheel(g, 0.5, 0.35, -0.8, 0.5, -1.6, wheels);
    box(g, 0.3, 0.14, 0.05, 0.35, 1.2, -2.02, HEAD);
    box(g, 0.3, 0.14, 0.05, -0.35, 1.2, -2.02, HEAD);
  },
  combine(g, wheels, paint) {
    box(g, 3.0, 2.6, 5.4, 0, 2.2, 0.8, paint);              // body
    box(g, 2.0, 1.4, 1.8, 0, 4.1, -1.2, MACHINE_GLASS);     // cab
    box(g, 2.1, 0.12, 1.9, 0, 4.85, -1.2, paint);
    box(g, 1.4, 0.8, 1.4, 0, 3.9, 2.4, DARK);               // grain tank lid
    const pipe = box(g, 0.35, 0.35, 3.2, 1.7, 3.6, 1.6, paint);   // unloading auger
    pipe.rotation.y = 0.6;
    wheel(g, 1.2, 0.8, 1.7, 1.2, -0.8, wheels);
    wheel(g, 1.2, 0.8, -1.7, 1.2, -0.8, wheels);
    wheel(g, 0.7, 0.5, 1.5, 0.7, 2.9, wheels);
    wheel(g, 0.7, 0.5, -1.5, 0.7, 2.9, wheels);
    // The header: wide cutter bar with a spinning reel.
    const header = new THREE.Group();
    header.position.set(0, 0.8, -3.6);
    box(header, 9.6, 0.5, 1.6, 0, 0, 0, phong(0xd9d9d9));
    box(header, 9.6, 0.1, 0.1, 0, -0.25, -0.85, CHROME);
    const reel = new THREE.Group();
    reel.position.set(0, 0.7, -0.2);
    for (let i = 0; i < 5; i++) {
      const bar = box(reel, 9.2, 0.08, 0.08, 0, 0, 0, phong(0xf2c14e));
      const a = (i / 5) * Math.PI * 2;
      bar.position.set(0, Math.sin(a) * 0.55, Math.cos(a) * 0.55);
    }
    header.add(reel);
    g.add(header);
    g.userData.reel = reel;
    box(g, 0.4, 0.16, 0.05, 0.6, 3.9, -2.12, HEAD);
    box(g, 0.4, 0.16, 0.05, -0.6, 3.9, -2.12, HEAD);
  },
};

// Things a tractor can pull, hung off the tow bar behind it.
const IMPLEMENT_BUILDERS = {
  plow(g) {
    const steel = phong(0x8f969c, { shininess: 70 });
    box(g, 5.6, 0.2, 0.3, 0, 0.8, 0, phong(0xb83a2c));
    for (let i = -2; i <= 2; i++) {
      const blade = box(g, 0.14, 0.7, 0.9, i * 1.2, 0.4, 0.3, steel);
      blade.rotation.y = 0.5;
    }
  },
  seeder(g) {
    box(g, 5.6, 0.2, 0.4, 0, 0.6, 0, phong(0x2f7de0));
    box(g, 4.8, 0.9, 1.0, 0, 1.3, 0.3, phong(0x2f7de0));
    box(g, 4.9, 0.1, 1.1, 0, 1.8, 0.3, phong(0xf2c14e));
    for (let i = -2; i <= 2; i++) box(g, 0.1, 0.6, 0.1, i * 1.2, 0.3, 0.1, DARK);
  },
  tank(g) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.4, 16), phong(0x4dc3ff, { shininess: 80 }));
    tank.rotation.z = Math.PI / 2;
    tank.position.set(0, 1.4, 0.6);
    g.add(tank);
    box(g, 5.6, 0.12, 0.12, 0, 0.7, 0, CHROME);
    for (let i = -2; i <= 2; i++) box(g, 0.08, 0.3, 0.08, i * 1.3, 0.5, 0, CHROME);
    const wheels = [];
    wheel(g, 0.45, 0.3, 1.0, 0.45, 0.8, wheels);
    wheel(g, 0.45, 0.3, -1.0, 0.45, 0.8, wheels);
  },
};

/**
 * Builds a vehicle. Returns handles to spin the wheels, swap the implement and
 * show who owns it.
 */
export function buildVehicle(modelId, color = '#d93a3a', { implement = null, label = null } = {}) {
  const model = VEHICLE_BY_ID[modelId] || VEHICLE_BY_ID.sedan;
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const wheels = [];
  const paint = carPaint(color, { metallic: model.body === 'hatch' || model.kind === 'machine' ? 0 : 0.35, worn: model.body === 'hatch' });
  BUILDERS[model.body](body, wheels, paint);
  // Its own lamps, so each car can switch them on and brake on its own.
  const head = HEAD.clone();
  const tail = TAIL.clone();
  const lamps = [];
  body.traverse((o) => {
    if (o.material === HEAD) { o.material = head; lamps.push(o); }
    else if (o.material === TAIL) o.material = tail;
  });
  // From the driver's seat the headlamps are out of sight: never let a
  // sliver of one glow over the bonnet.
  if (body.userData.riderHides && model.kind !== 'machine') body.userData.riderHides.push(...lamps);
  const HEAD_RGB = new THREE.Color(0xfff6d0);
  const TAIL_RGB = new THREE.Color(0xff2a2a);
  let lastSpeed = 0;
  let brake = 0;

  const spec = SPECS[model.body];

  // A soft blob shadow under the car, sized from its footprint.
  const bbox = new THREE.Box3().setFromObject(body);
  const size = bbox.getSize(new THREE.Vector3());
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(size.x * 1.25, size.z * 1.15),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set((bbox.min.x + bbox.max.x) / 2, 0.035, (bbox.min.z + bbox.max.z) / 2);
  group.add(shadow);

  const hitch = new THREE.Group();
  hitch.position.set(0, 0, spec.work || 3.4);
  body.add(hitch);
  let currentImpl = null;

  function setImplement(id) {
    if (id === currentImpl) return;
    currentImpl = id;
    hitch.clear();
    if (id && IMPLEMENT_BUILDERS[id] && model.id === 'tractor') IMPLEMENT_BUILDERS[id](hitch);
  }
  setImplement(implement);

  let tag = null;
  if (label) {
    tag = labelSprite(label, color, 0.45);
    tag.position.y = bbox.max.y + 0.9;
    tag.userData.base = { x: tag.scale.x, y: tag.scale.y };
    group.add(tag);
  }

  let spin = 0;
  return {
    group,
    model,
    spec,
    setImplement,
    get implement() { return currentImpl; },
    body,
    /** Keeps the shadow on the ground while the car flies off a ramp. */
    setAir(h) { shadow.position.y = 0.035 - h; shadow.material.opacity = Math.max(0.15, 1 - h / 6); },
    setColor(c) { paint.color.set(c); },
    showLabel(v, distance = 10) {
      if (!tag) return;
      tag.visible = v && distance > 3 && distance < 90;
      const k = Math.min(1, Math.max(0.35, distance / 10));
      tag.scale.set(tag.userData.base.x * k, tag.userData.base.y * k, 1);
    },
    /**
     * Spin the wheels at road speed, and point the front ones into the turn.
     * `night` (0..1) and `driven` light the lamps; slowing down lights the brakes.
     */
    update(dt, speed, steer = 0, night = 0, driven = false) {
      spin += dt * speed;
      const slowing = dt > 0 && driven && (Math.abs(lastSpeed) - Math.abs(speed)) / dt > 3;
      lastSpeed = speed;
      brake = slowing || (driven && Math.abs(speed) < 0.3) ? 1 : Math.max(0, brake - dt * 4);
      const on = driven ? Math.min(1, night * 2) : 0;
      // Linear colours past 1 glow through the bloom.
      head.color.copy(HEAD_RGB).multiplyScalar(0.8 + on * 6);
      tail.color.copy(TAIL_RGB).multiplyScalar(0.45 + on * 1.6 + brake * (driven ? 5 : 0));
      for (const w of wheels) {
        w.g.rotation.x = -spin / w.r;
        w.g.rotation.y = w.front && model.id !== 'combine' ? steer * 0.45 : 0;
      }
      if (body.userData.reel) body.userData.reel.rotation.x -= dt * (1 + Math.abs(speed) * 0.4);
    },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
      paint.dispose();
      head.dispose();
      tail.dispose();
      if (tag) { tag.material.map.dispose(); tag.material.dispose(); }
    },
  };
}
