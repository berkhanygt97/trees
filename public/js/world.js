import * as THREE from 'three';
import { ROOM, STATIONS, HORSES, ROCKETS } from '/shared/config.js';
import { WHEEL as WHEEL_ORDER, REDS } from '/shared/roulette.js';
import { carpetTexture, wallTexture, feltTexture, woodTexture, signTexture, slotFaceTexture, liveCanvas } from './textures.js';

const TRACK_START = -32;
const TRACK_END = 32;
const TRACK_Z0 = -25;
const LANE_GAP = -2.3;

// Phong, not Lambert: Lambert shades per-vertex, which leaves big flat panels
// like the floor and walls lit only at their corners.
const lam = (color, o = {}) => new THREE.MeshPhongMaterial({ color, shininess: 6, specular: 0x141018, ...o });
const basic = (color, o = {}) => new THREE.MeshBasicMaterial({ color, ...o });

export class World {
  constructor(scene) {
    this.scene = scene;
    this.obstacles = [];
    this.t = 0;

    this._lights();
    this._shell();
    this._signs();
    this._slots();
    this._blackjack();
    this._roulette();
    this._dice();
    this._crash();
    this._track();
    this._atms();
    this._cigarShop();
    this._arena();
    this._decor();

    for (const st of STATIONS) {
      if (st.solid > 0) this.obstacles.push({ x: st.pos[0], z: st.pos[2], r: st.solid });
    }
  }

  // ---------------------------------------------------------------- lights

  _lights() {
    this.scene.add(new THREE.AmbientLight(0x7a5666, 1.15));
    this.scene.add(new THREE.HemisphereLight(0xffd9a0, 0x30121f, 0.5));

    this.chandelierLights = [];
    const spots = [
      [-24, 32], [24, 32], [0, 30],
      [-26, 14], [26, 14], [0, 16],
      [-28, -2], [28, -2],
      [-20, -16], [20, -16],
    ];
    for (const [x, z] of spots) {
      // Physically-based units: a room-filling pool needs a big candela value.
      const light = new THREE.PointLight(0xffc98a, 260, 44, 2);
      light.position.set(x, 9.2, z);
      this.scene.add(light);
      this.chandelierLights.push(light);
      this._chandelier(x, z);
    }
    const key = new THREE.DirectionalLight(0xfff0d8, 0.5);
    key.position.set(20, 30, 20);
    this.scene.add(key);
    const trackLight = new THREE.DirectionalLight(0xdfe8ff, 0.5);
    trackLight.position.set(0, 20, -10);
    this.scene.add(trackLight);
  }

  _chandelier(x, z) {
    const g = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), lam(0x2b2230));
    rod.position.y = 11.8;
    g.add(rod);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.09, 8, 28), lam(0xf2c14e));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 10.5;
    g.add(ring);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), basic(0xfff0c0));
      bulb.position.set(Math.cos(a) * 1.5, 10.35, Math.sin(a) * 1.5);
      g.add(bulb);
    }
    g.position.set(x, 0, z);
    this.scene.add(g);
  }

  // ----------------------------------------------------------------- shell

  _shell() {
    const w = ROOM.MAX_X - ROOM.MIN_X;
    const d = ROOM.MAX_Z - ROOM.MIN_Z;

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lam(0xffffff, { map: carpetTexture() }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lam(0x1a1020));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = ROOM.WALL_H;
    this.scene.add(ceil);

    const wallMat = lam(0xffffff, { map: wallTexture() });
    const mk = (sx, sz, x, z, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), wallMat);
      m.position.set(x, ROOM.WALL_H / 2, z);
      m.rotation.y = ry;
      this.scene.add(m);
    };
    mk(w, ROOM.WALL_H, 0, ROOM.MIN_Z, 0);
    mk(w, ROOM.WALL_H, 0, ROOM.MAX_Z, Math.PI);
    mk(d, ROOM.WALL_H, ROOM.MIN_X, 0, Math.PI / 2);
    mk(d, ROOM.WALL_H, ROOM.MAX_X, 0, -Math.PI / 2);
  }

  _signs() {
    const put = (text, sub, color, x, y, z, ry, w = 11) => {
      const tex = signTexture(text, color, sub);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), basic(0xffffff, { map: tex, transparent: true }));
      m.position.set(x, y, z);
      m.rotation.y = ry;
      this.scene.add(m);
      return m;
    };
    this.neon = [
      put('SLOTS', 'pull until broke', '#ff5d5d', ROOM.MIN_X + 0.4, 7.6, 3, Math.PI / 2, 16),
      put('BLACKJACK', 'dealer stands on 17', '#4dc3ff', ROOM.MAX_X - 0.4, 7.6, 0, -Math.PI / 2, 16),
      put('ROULETTE', 'rien ne va plus', '#f2c14e', 0, 3.1, 17.6, 0, 8),
      put('THE TRACK', 'six idiots, one winner', '#6bd66b', 0, 7.6, -22.6, 0, 10),
      put('DICE', '', '#ff9f43', -20, 4.2, 25.6, 0, 6),
      put('DICE', '', '#ff9f43', 20, 4.2, 25.6, 0, 6),
      put('CASINO ROYALE', 'leave with more than you came with', '#f2c14e', 0, 8.6, ROOM.MAX_Z - 0.4, Math.PI, 26),
    ];
  }

  // ----------------------------------------------------------------- slots

  _slots() {
    const faceMat = lam(0xffffff, { map: slotFaceTexture() });
    const bodyMat = lam(0x6d1f1c);
    for (const st of STATIONS.filter((s) => s.game === 'slots')) {
      const g = new THREE.Group();
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.2, 1.1), bodyMat);
      cab.position.y = 1.1;
      g.add(cab);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 2.1), faceMat);
      face.position.set(0, 1.15, 0.56);
      g.add(face);
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 0.5), bodyMat);
      shelf.position.set(0, 0.95, 0.72);
      g.add(shelf);
      const topper = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.1), lam(0xf2c14e));
      topper.position.y = 2.42;
      g.add(topper);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), basic(0xff5d5d));
      bulb.position.y = 2.8;
      g.add(bulb);
      const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 8), lam(0xc9c2b4));
      lever.position.set(0.86, 1.5, 0.2);
      lever.rotation.z = -0.25;
      g.add(lever);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), lam(0xe0403a));
      knob.position.y = 0.42;
      lever.add(knob);

      g.position.set(st.pos[0], 0, st.pos[2]);
      g.rotation.y = st.yaw;
      this.scene.add(g);
    }
  }

  // ------------------------------------------------------------- blackjack

  _blackjack() {
    const felt = lam(0xffffff, { map: feltTexture('#0f5c36') });
    const rail = lam(0x4b2a17, { map: woodTexture() });
    for (const st of STATIONS.filter((s) => s.game === 'blackjack')) {
      const g = new THREE.Group();
      const top = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.16, 28, 1, false, 0, Math.PI), felt);
      top.position.y = 0.95;
      g.add(top);
      const edge = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.13, 8, 28, Math.PI), rail);
      edge.rotation.x = Math.PI / 2;
      edge.position.y = 0.98;
      g.add(edge);
      const flat = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.16, 0.5), felt);
      flat.position.set(0, 0.95, 0.25);
      g.add(flat);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 0.95, 12), lam(0x2b2230));
      base.position.y = 0.47;
      g.add(base);

      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.7), lam(0x15121c));
      shoe.position.set(-1.1, 1.18, -0.5);
      g.add(shoe);
      for (let i = 0; i < 3; i++) {
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 16), lam([0xe0403a, 0x4dc3ff, 0xf2c14e][i]));
        stack.position.set(0.5 + i * 0.4, 1.18, -0.6);
        g.add(stack);
      }
      for (let i = 0; i < 2; i++) {
        const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.24, 14), lam(0x7c1f2a));
        stool.position.set(-1 + i * 2, 0.75, 2.5);
        g.add(stool);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.75, 8), lam(0x2b2230));
        post.position.set(-1 + i * 2, 0.37, 2.5);
        g.add(post);
      }

      g.position.set(st.pos[0], 0, st.pos[2]);
      g.rotation.y = st.yaw;
      this.scene.add(g);
    }
  }

  // -------------------------------------------------------------- roulette

  _roulette() {
    const st = STATIONS.find((s) => s.game === 'roulette');
    const g = new THREE.Group();

    const top = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.2, 3.4), lam(0xffffff, { map: feltTexture('#0d4f5c') }));
    top.position.set(1.9, 0.95, 0);
    g.add(top);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.26, 3.8), lam(0x4b2a17, { map: woodTexture() }));
    rail.position.set(1.9, 0.86, 0);
    g.add(rail);
    for (const dx of [-0.6, 4.4]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.86, 2.8), lam(0x2b2230));
      leg.position.set(dx, 0.43, 0);
      g.add(leg);
    }

    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.0, 0.55, 40), lam(0x4b2a17, { map: woodTexture() }));
    bowl.position.set(-2.6, 1.05, 0);
    g.add(bowl);

    this.wheel = new THREE.Group();
    this.wheel.position.set(-2.6, 1.34, 0);
    g.add(this.wheel);

    const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 0.1, 40), lam(0x1b1220));
    this.wheel.add(disc);
    for (let i = 0; i < WHEEL_ORDER.length; i++) {
      const n = WHEEL_ORDER[i];
      const a = (i / WHEEL_ORDER.length) * Math.PI * 2;
      const color = n === 0 ? 0x2e9750 : REDS.has(n) ? 0xc2332e : 0x191520;
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.78), lam(color));
      pocket.position.set(Math.cos(a) * 1.6, 0.08, Math.sin(a) * 1.6);
      pocket.rotation.y = -a;
      this.wheel.add(pocket);
      const fret = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.8), lam(0xd8cdb4));
      const fa = a + Math.PI / WHEEL_ORDER.length;
      fret.position.set(Math.cos(fa) * 1.6, 0.1, Math.sin(fa) * 1.6);
      fret.rotation.y = -fa;
      this.wheel.add(fret);
    }
    const hub = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.8, 14), lam(0xf2c14e));
    hub.position.y = 0.4;
    this.wheel.add(hub);

    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), basic(0xfdfaf2));
    this.ball.position.set(-2.6, 1.55, 0);
    g.add(this.ball);

    this.rouletteBoard = liveCanvas(768, 384);
    const boardMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(6.0, 3.0),
      basic(0xffffff, { map: this.rouletteBoard.texture }),
    );
    boardMesh.rotation.x = -Math.PI / 2;
    boardMesh.position.set(1.9, 1.07, 0);
    g.add(boardMesh);
    this._paintRouletteBoard(null, []);

    g.position.set(st.pos[0], 0, st.pos[2]);
    this.scene.add(g);
    this.obstacles.push({ x: st.pos[0] - 2.6, z: st.pos[2], r: 2.6 });
    this.obstacles.push({ x: st.pos[0] + 1.9, z: st.pos[2], r: 2.6 });

    this.wheelAngle = 0;
    this.ballAngle = 0;
  }

  _paintRouletteBoard(result, history) {
    const { ctx: g, canvas, texture } = this.rouletteBoard;
    const w = canvas.width;
    const h = canvas.height;
    g.fillStyle = '#0d4f5c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 3;
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    // 3 x 12 number grid, plus the zero strip.
    const cw = (w - 120) / 12;
    const ch = 70;
    for (let col = 0; col < 12; col++) {
      for (let row = 0; row < 3; row++) {
        const n = col * 3 + (3 - row);
        const x = 100 + col * cw;
        const y = 30 + row * ch;
        g.fillStyle = REDS.has(n) ? '#c2332e' : '#191520';
        g.fillRect(x, y, cw - 2, ch - 2);
        g.strokeRect(x, y, cw - 2, ch - 2);
        g.fillStyle = '#fff';
        g.font = 'bold 30px "Trebuchet MS", sans-serif';
        g.fillText(String(n), x + cw / 2, y + ch / 2);
      }
    }
    g.fillStyle = '#2e9750';
    g.fillRect(30, 30, 66, ch * 3 - 2);
    g.strokeRect(30, 30, 66, ch * 3 - 2);
    g.fillStyle = '#fff';
    g.font = 'bold 40px "Trebuchet MS", sans-serif';
    g.fillText('0', 63, 30 + (ch * 3) / 2);

    g.font = 'bold 26px "Trebuchet MS", sans-serif';
    const bars = [['1-18', 100], ['EVEN', 240], ['RED', 380], ['BLACK', 520], ['ODD', 660], ['19-36', 800]];
    for (const [label, x] of bars) {
      if (x + 130 > w) continue;
      g.fillStyle = label === 'RED' ? '#c2332e' : label === 'BLACK' ? '#191520' : 'rgba(0,0,0,0.3)';
      g.fillRect(x, 255, 128, 56);
      g.strokeRect(x, 255, 128, 56);
      g.fillStyle = '#fff';
      g.fillText(label, x + 64, 283);
    }

    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(30, 325, w - 60, 44);
    g.fillStyle = '#f2c14e';
    g.font = 'bold 24px "Trebuchet MS", sans-serif';
    g.textAlign = 'left';
    const recent = history.slice(0, 10).map((n) => (n === 0 ? '0' : REDS.has(n) ? `${n}` : `${n}`)).join('   ');
    g.fillText(`LAST: ${recent || '—'}`, 44, 347);
    if (result != null) {
      g.textAlign = 'right';
      g.fillStyle = result === 0 ? '#6bd66b' : REDS.has(result) ? '#ff7a72' : '#ffffff';
      g.fillText(`${result}`, w - 44, 347);
    }
    texture.needsUpdate = true;
  }

  // ------------------------------------------------------------------ dice

  _dice() {
    for (const st of STATIONS.filter((s) => s.game === 'dice')) {
      const g = new THREE.Group();
      const top = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.2, 8), lam(0xffffff, { map: feltTexture('#5c1130') }));
      top.position.y = 0.95;
      g.add(top);
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.4, 8, 1, true), lam(0x4b2a17, { side: THREE.DoubleSide, map: woodTexture() }));
      wall.position.y = 1.15;
      g.add(wall);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.85, 0.9, 8), lam(0x2b2230));
      base.position.y = 0.45;
      g.add(base);
      for (let i = 0; i < 2; i++) {
        const die = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), lam(0xf7f3ea));
        die.position.set(-0.4 + i * 0.8, 1.22, 0.3);
        die.rotation.set(Math.random(), Math.random(), Math.random());
        g.add(die);
      }
      g.position.set(st.pos[0], 0, st.pos[2]);
      g.rotation.y = st.yaw;
      this.scene.add(g);
    }
  }

  // ----------------------------------------------------------------- crash

  _crash() {
    const g = new THREE.Group();
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.4, 0.3, 40), lam(0x2a1030));
    platform.position.y = 0.15;
    g.add(platform);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(9, 0.12, 8, 48), basic(0xc471e8));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.34;
    g.add(ring);

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      const sofa = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.55, 1.1), lam(0x7c1f2a));
      sofa.position.set(Math.cos(a) * 6.6, 0.58, Math.sin(a) * 6.6);
      sofa.rotation.y = -a + Math.PI / 2;
      g.add(sofa);
      const back = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.8, 0.25), lam(0x93283a));
      back.position.set(0, 0.62, -0.42);
      sofa.add(back);
    }

    const podium = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 0.9), lam(0x2b2230));
    podium.position.set(0, 0.7, 4.2);
    g.add(podium);
    const podTop = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 1.0), basic(0xc471e8));
    podTop.position.set(0, 1.3, 4.2);
    g.add(podTop);

    // The screen everybody in the lounge is staring at.
    this.crashScreen = liveCanvas(1024, 576);
    // Double-sided jumbotron: a second mesh facing the racetrack, so the screen
    // doesn't become a black wall down the middle of the room.
    const screenMat = basic(0xffffff, { map: this.crashScreen.texture });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(15, 8.4), screenMat);
    front.position.set(0, 8.6, -6.2);
    g.add(front);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(15, 8.4), screenMat);
    back.position.set(0, 8.6, -6.8);
    back.rotation.y = Math.PI;
    g.add(back);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(15.4, 8.8, 0.5), lam(0x15121c));
    frame.position.set(0, 8.6, -6.5);
    g.add(frame);
    for (const dx of [-7, 7]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 4.4, 10), lam(0x2b2230));
      post.position.set(dx, 2.2, -6.45);
      g.add(post);
      this.obstacles.push({ x: dx, z: -8.45, r: 0.5 });
    }

    this._rockets(g);

    const st = STATIONS.find((s) => s.game === 'crash');
    g.position.set(st.pos[0], 0, st.pos[2] - 2);
    this.scene.add(g);
    this.crashGroup = g;
    this._paintCrash({ phase: 'betting', until: 0 });
  }

  /** Three physical rockets on the lounge pad, one per entry in ROCKETS. */
  _rockets(parent) {
    this.rocketMeshes = ROCKETS.map((r, i) => {
      const group = new THREE.Group();
      const color = new THREE.Color(r.color);

      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 2.0, 12), lam(0xf2ece2));
      body.position.y = 1.0;
      group.add(body);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.9, 12), lam(color));
      nose.position.y = 2.45;
      group.add(nose);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 12), lam(color));
      band.position.y = 1.5;
      group.add(band);
      for (let f = 0; f < 3; f++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.55), lam(color));
        const a = (f / 3) * Math.PI * 2;
        fin.position.set(Math.cos(a) * 0.4, 0.35, Math.sin(a) * 0.4);
        fin.rotation.y = -a;
        group.add(fin);
      }

      // Exhaust flame, scaled by thrust each frame.
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.1, 10), basic(0xffb347, { transparent: true, opacity: 0.9 }));
      flame.position.y = -0.55;
      flame.rotation.x = Math.PI;
      group.add(flame);

      const burst = new THREE.Sprite(new THREE.SpriteMaterial({
        color: 0xffae4a, transparent: true, opacity: 0, depthWrite: false,
      }));
      burst.scale.set(4, 4, 1);
      group.add(burst);

      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.2, 14), lam(0x2b2230));
      pad.position.set(-6 + i * 6, 0.45, 3.4);
      parent.add(pad);

      group.position.set(-6 + i * 6, 0.55, 3.4);
      parent.add(group);
      return { group, flame, burst, nose, baseY: 0.55, x: -6 + i * 6 };
    });
  }

  _paintCrash(state, serverNow = Date.now()) {
    const { ctx: g, canvas, texture } = this.crashScreen;
    const w = canvas.width;
    const h = canvas.height;
    g.fillStyle = '#07040e';
    g.fillRect(0, 0, w, h);

    g.strokeStyle = 'rgba(196,113,232,0.16)';
    g.lineWidth = 1;
    for (let x = 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }

    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillStyle = '#c471e8';
    g.font = 'bold 40px "Trebuchet MS", sans-serif';
    g.fillText('THE ROCKET', 40, 28);
    g.fillStyle = '#5d4c6b';
    g.font = 'bold 24px "Trebuchet MS", sans-serif';
    g.fillText('cash out or cry', 40, 74);

    const growth = state.growth || 0.075;
    const rockets = state.rockets || [];

    const multOf = (r) => {
      if (state.phase === 'betting' || !state.startAt) return 1;
      if (r.dead) return r.crashPoint || 1;
      return Math.exp(growth * ((serverNow - state.startAt) / 1000));
    };

    if (state.phase === 'betting') {
      const left = Math.max(0, (state.until - serverNow) / 1000);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#c471e8';
      g.font = 'bold 56px "Trebuchet MS", sans-serif';
      g.fillText('NEXT LAUNCH IN', w / 2, h / 2 - 80);
      g.fillStyle = '#ffffff';
      g.font = 'bold 170px "Trebuchet MS", sans-serif';
      g.fillText(left.toFixed(1), w / 2, h / 2 + 50);
    } else {
      // All three curves on shared axes, each in its rocket's colour.
      const elapsed = (serverNow - state.startAt) / 1000;
      const peak = Math.max(...rockets.map(multOf), 1.6);
      const yMax = peak * 1.12;
      const tMax = Math.max(4, elapsed * 1.05);
      const px = (t) => 70 + (t / tMax) * (w - 140);
      const py = (m) => h - 90 - ((m - 1) / (yMax - 1)) * (h - 230);

      for (const r of rockets) {
        const endT = r.dead && r.crashAt ? (r.crashAt - state.startAt) / 1000 : elapsed;
        g.strokeStyle = r.color;
        g.globalAlpha = r.dead ? 0.4 : 1;
        g.lineWidth = r.dead ? 4 : 8;
        g.beginPath();
        for (let i = 0; i <= 80; i++) {
          const t = (i / 80) * Math.max(0, endT);
          const X = px(t);
          const Y = py(Math.exp(growth * t));
          i ? g.lineTo(X, Y) : g.moveTo(X, Y);
        }
        g.stroke();
        g.globalAlpha = 1;
      }

      // Scoreboard of live multipliers down the right.
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      rockets.forEach((r, i) => {
        const m = multOf(r);
        g.fillStyle = r.dead ? '#6a5a76' : r.color;
        g.font = 'bold 62px "Trebuchet MS", sans-serif';
        g.fillText(`${m.toFixed(2)}x`, w - 46, 150 + i * 78);
        if (r.dead) {
          g.fillStyle = '#e0403a';
          g.font = 'bold 34px "Trebuchet MS", sans-serif';
          g.fillText('DOWN', w - 250, 150 + i * 78);
        }
      });
    }

    g.fillStyle = '#7e6a8c';
    g.font = 'bold 30px "Trebuchet MS", sans-serif';
    g.textAlign = 'left';
    const hist = (state.history || []).slice(0, 5)
      .map((set) => set.map((v) => v.toFixed(2)).join('/')).join('    ');
    g.fillText(hist, 40, h - 34);
    texture.needsUpdate = true;
  }

  // ----------------------------------------------------------------- track

  _track() {
    const g = new THREE.Group();
    const length = TRACK_END - TRACK_START;
    const depth = Math.abs(LANE_GAP) * HORSES.length + 1.5;
    const dirt = new THREE.Mesh(new THREE.PlaneGeometry(length + 6, depth), lam(0x6b4326));
    dirt.rotation.x = -Math.PI / 2;
    dirt.position.set((TRACK_START + TRACK_END) / 2, 0.02, TRACK_Z0 + (LANE_GAP * (HORSES.length - 1)) / 2);
    g.add(dirt);

    for (let i = 0; i <= HORSES.length; i++) {
      const z = TRACK_Z0 + LANE_GAP * i - LANE_GAP / 2;
      const line = new THREE.Mesh(new THREE.PlaneGeometry(length + 6, 0.1), basic(0xffffff, { opacity: 0.35, transparent: true }));
      line.rotation.x = -Math.PI / 2;
      line.position.set((TRACK_START + TRACK_END) / 2, 0.04, z);
      g.add(line);
    }

    const finish = new THREE.Mesh(new THREE.PlaneGeometry(0.6, depth), basic(0xffffff));
    finish.rotation.x = -Math.PI / 2;
    finish.position.set(TRACK_END, 0.05, TRACK_Z0 + (LANE_GAP * (HORSES.length - 1)) / 2);
    g.add(finish);

    // Spectator rail: also the collision wall that keeps players off the dirt.
    const railY = 1.0;
    for (let x = TRACK_START - 3; x <= TRACK_END + 3; x += 3) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, railY, 8), lam(0xf2c14e));
      post.position.set(x, railY / 2, ROOM.RAIL_Z);
      g.add(post);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(length + 8, 0.12, 0.12), lam(0xf2c14e));
    bar.position.set((TRACK_START + TRACK_END) / 2, railY, ROOM.RAIL_Z);
    g.add(bar);

    const gates = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.8, depth), lam(0x9aa7ff));
    gates.position.set(TRACK_START - 1, 0.9, TRACK_Z0 + (LANE_GAP * (HORSES.length - 1)) / 2);
    g.add(gates);

    this.horseMeshes = HORSES.map((h, i) => {
      const horse = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.9, 5, 10), lam(new THREE.Color(h.color)));
      body.rotation.z = Math.PI / 2;
      body.position.y = 1.05;
      horse.add(body);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.8, 8), lam(new THREE.Color(h.color)));
      neck.position.set(0.72, 1.4, 0);
      neck.rotation.z = -0.5;
      horse.add(neck);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.28), lam(new THREE.Color(h.color)));
      head.position.set(1.12, 1.72, 0);
      horse.add(head);
      const jockey = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), lam(0xf2c9a0));
      jockey.position.set(-0.1, 1.85, 0);
      horse.add(jockey);
      const silk = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.25, 4, 8), lam(0xffffff));
      silk.position.set(-0.15, 1.5, 0);
      horse.add(silk);
      const legs = [];
      for (let l = 0; l < 4; l++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.75, 6), lam(0x2b2230));
        leg.position.set(l < 2 ? 0.45 : -0.45, 0.38, l % 2 ? 0.22 : -0.22);
        horse.add(leg);
        legs.push(leg);
      }
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.6, 6), lam(0x2b2230));
      tail.position.set(-0.85, 1.15, 0);
      tail.rotation.z = 1.1;
      horse.add(tail);

      horse.position.set(TRACK_START, 0, TRACK_Z0 + LANE_GAP * i);
      g.add(horse);

      const num = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), basic(0xffffff, { map: signTexture(String(i + 1), '#ffffff'), transparent: true }));
      num.position.set(-0.2, 1.42, 0.32);
      horse.add(num);
      return { group: horse, legs };
    });

    this.scene.add(g);

    // Betting windows.
    for (const st of STATIONS.filter((s) => s.game === 'horses')) {
      const b = new THREE.Group();
      const counter = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.15, 1.0), lam(0x4b2a17, { map: woodTexture() }));
      counter.position.y = 0.58;
      b.add(counter);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 0.08), basic(0x9ad7ff, { transparent: true, opacity: 0.22 }));
      glass.position.y = 1.9;
      b.add(glass);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.18, 1.2), lam(0x6bd66b));
      roof.position.y = 2.65;
      b.add(roof);
      b.position.set(st.pos[0], 0, st.pos[2]);
      b.rotation.y = st.yaw;
      this.scene.add(b);
    }

    // Leaderboard board above the track.
    this.boardScreen = liveCanvas(1024, 512);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), basic(0xffffff, { map: this.boardScreen.texture }));
    board.position.set(0, 9.2, ROOM.MIN_Z + 0.4);
    this.scene.add(board);
    this.paintBoard([], null);
  }

  paintBoard(rows, meId) {
    const { ctx: g, canvas, texture } = this.boardScreen;
    const w = canvas.width;
    const h = canvas.height;
    g.fillStyle = '#0b0714';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f2c14e';
    g.lineWidth = 6;
    g.strokeRect(10, 10, w - 20, h - 20);
    g.textAlign = 'center';
    g.fillStyle = '#f2c14e';
    g.font = 'bold 52px "Trebuchet MS", sans-serif';
    g.fillText('T O N I G H T ’ S   S T A N D I N G S', w / 2, 74);

    g.textAlign = 'left';
    g.font = 'bold 40px "Trebuchet MS", sans-serif';
    const top = rows.slice(0, 7);
    if (!top.length) {
      g.fillStyle = '#5c5268';
      g.fillText('waiting for gamblers...', 70, 180);
    }
    top.forEach((r, i) => {
      const y = 150 + i * 48;
      g.fillStyle = r.id === meId ? '#f2c14e' : '#efe6d6';
      g.fillText(`${i + 1}.`, 60, y);
      g.fillText(r.name.slice(0, 16), 120, y);
      g.textAlign = 'right';
      g.fillStyle = r.profit > 0 ? '#6bd66b' : r.profit < 0 ? '#e0403a' : '#8d8378';
      g.fillText(`${r.profit >= 0 ? '+' : '-'}$${Math.abs(r.profit).toLocaleString('en-US')}`, w - 60, y);
      g.textAlign = 'left';
    });
    texture.needsUpdate = true;
  }

  // ------------------------------------------------------------------ atms

  _atms() {
    for (const st of STATIONS.filter((s) => s.game === 'atm')) {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 0.8), lam(0x2e9750));
      box.position.y = 1.05;
      g.add(box);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), basic(0x0b2a18));
      screen.position.set(0, 1.5, 0.41);
      g.add(screen);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), basic(0xffffff, { map: signTexture('ATM', '#6bd66b'), transparent: true }));
      sign.position.set(0, 2.6, 0.2);
      g.add(sign);
      g.position.set(st.pos[0], 0, st.pos[2]);
      g.rotation.y = st.yaw;
      this.scene.add(g);
    }
  }

  /** A little counter by the door that sells you nothing useful. */
  _cigarShop() {
    const st = STATIONS.find((s) => s.game === 'cigar');
    if (!st) return;
    const g = new THREE.Group();

    const counter = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.15, 1.1), lam(0x4b2a17, { map: woodTexture() }));
    counter.position.y = 0.58;
    g.add(counter);
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.1, 1.3), lam(0x2b2230));
    top.position.y = 1.2;
    g.add(top);

    // Humidor with a few cigars in it.
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.26, 0.7), lam(0x6b4326));
    box.position.set(0, 1.38, 0);
    g.add(box);
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.6, 8), lam(0x5b3a1e));
      c.rotation.x = Math.PI / 2;
      c.position.set(-0.4 + i * 0.2, 1.54, 0);
      g.add(c);
    }

    const back = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2.6, 0.3), lam(0x3a2a44));
    back.position.set(0, 1.3, -0.9);
    g.add(back);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9),
      basic(0xffffff, { map: signTexture('CIGARS', '#e8a33a'), transparent: true }));
    sign.position.set(0, 2.9, -0.7);
    g.add(sign);

    g.position.set(st.pos[0], 0, st.pos[2]);
    g.rotation.y = st.yaw;
    this.scene.add(g);
  }

  /** The octagonal cage two robots knock lumps out of each other in. */
  _arena() {
    const st = STATIONS.find((s) => s.game === 'robots');
    if (!st) return;
    const g = new THREE.Group();
    const R = 5.0;

    const floor = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 0.3, 0.6, 8), lam(0x33303a));
    floor.position.y = 0.3;
    g.add(floor);
    const mat = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.35, R - 0.35, 0.08, 8), lam(0x6b2230));
    mat.position.y = 0.63;
    g.add(mat);

    // Cage posts and two rails between them.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.0, 8), lam(0xb9c0cc));
      post.position.set(Math.cos(a) * R, 2.1, Math.sin(a) * R);
      g.add(post);
      const b = ((i + 1) / 8) * Math.PI * 2 + Math.PI / 8;
      for (const h of [1.2, 2.2, 3.2]) {
        const p1 = new THREE.Vector3(Math.cos(a) * R, h, Math.sin(a) * R);
        const p2 = new THREE.Vector3(Math.cos(b) * R, h, Math.sin(b) * R);
        const len = p1.distanceTo(p2);
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 6), lam(0x8d95a3));
        rail.position.copy(p1).lerp(p2, 0.5);
        rail.rotation.z = Math.PI / 2;
        rail.rotation.y = -Math.atan2(p2.z - p1.z, p2.x - p1.x);
        g.add(rail);
      }
    }

    // Overhead HP screen.
    this.arenaScreen = liveCanvas(768, 256);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 2.5),
      basic(0xffffff, { map: this.arenaScreen.texture }));
    screen.position.set(0, 6.4, 0);
    screen.rotation.y = Math.PI;   // faces the lobby side
    g.add(screen);
    const screenBack = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 2.5),
      basic(0xffffff, { map: this.arenaScreen.texture }));
    screenBack.position.set(0, 6.4, 0.06);
    g.add(screenBack);
    const rig = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.4, 0.2), lam(0x2b2230));
    rig.position.set(0, 8.2, 0);
    g.add(rig);

    const spot = new THREE.PointLight(0xdfe8ff, 120, 22, 2);
    spot.position.set(0, 7.5, 0);
    g.add(spot);

    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25),
      basic(0xffffff, { map: signTexture('SCRAPYARD', '#9fd4e8'), transparent: true }));
    sign.position.set(0, 9.4, 0);
    g.add(sign);

    // Two combatants, built from boxes.
    this.robotMeshes = [0, 1].map((i) => {
      const bot = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 0.9), lam(0x9aa1ad));
      body.position.y = 1.35;
      bot.add(body);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.08), lam(0xcfd6e2));
      plate.position.set(0, 1.45, 0.48);
      bot.add(plate);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.55), lam(0x7c8593));
      head.position.y = 2.2;
      bot.add(head);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.06), basic(0xff4444));
      visor.position.set(0, 2.24, 0.29);
      bot.add(visor);
      for (const side of [-1, 1]) {
        const track = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.7, 1.15), lam(0x2f333c));
        track.position.set(side * 0.62, 0.38, 0);
        bot.add(track);
      }
      const arms = [-1, 1].map((side) => {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 1.0), lam(0x6d7684));
        arm.position.set(side * 0.72, 1.5, 0.35);
        bot.add(arm);
        return arm;
      });
      bot.visible = false;
      g.add(bot);
      return { group: bot, body, visor, arms, plate };
    });

    g.position.set(st.pos[0], 0, st.pos[2]);
    this.scene.add(g);
    this.arenaGroup = g;
    this.arenaR = R;
    this._paintArena(null);
  }

  _paintArena(state) {
    const { ctx: g, canvas, texture } = this.arenaScreen;
    const w = canvas.width;
    const h = canvas.height;
    g.fillStyle = '#0a0d14';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#9fd4e8';
    g.lineWidth = 4;
    g.strokeRect(6, 6, w - 12, h - 12);

    g.textAlign = 'center';
    g.fillStyle = '#9fd4e8';
    g.font = 'bold 30px "Trebuchet MS", sans-serif';
    g.fillText('THE SCRAPYARD', w / 2, 44);

    if (!state || !state.fighters) {
      g.fillStyle = '#4b5565';
      g.font = 'bold 26px "Trebuchet MS", sans-serif';
      g.fillText('warming up…', w / 2, 140);
      texture.needsUpdate = true;
      return;
    }

    state.fighters.forEach((f, i) => {
      const y = 86 + i * 78;
      const hp = this._arenaHp ? this._arenaHp[i] : f.maxHp;
      g.textAlign = 'left';
      g.fillStyle = f.color;
      g.font = 'bold 26px "Trebuchet MS", sans-serif';
      g.fillText(f.name, 30, y);
      g.textAlign = 'right';
      g.fillStyle = '#cfd6e2';
      g.fillText(`${f.odds.toFixed(2)}x`, w - 30, y);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(30, y + 12, w - 60, 22);
      g.fillStyle = f.color;
      g.fillRect(30, y + 12, (w - 60) * Math.max(0, Math.min(1, hp / f.maxHp)), 22);
    });
    texture.needsUpdate = true;
  }

  // ----------------------------------------------------------------- decor

  _decor() {
    const pillarPositions = [[-30, 30], [30, 30], [-30, -10], [30, -10]];
    for (const [x, z] of pillarPositions) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, ROOM.WALL_H, 14), lam(0x3a2a44));
      p.position.set(x, ROOM.WALL_H / 2, z);
      this.scene.add(p);
      const trim = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.4, 14), lam(0xf2c14e));
      trim.position.set(x, 0.3, z);
      this.scene.add(trim);
      this.obstacles.push({ x, z, r: 1.3 });
    }

    // Bar along the entrance wall.
    const bar = new THREE.Group();
    const counter = new THREE.Mesh(new THREE.BoxGeometry(14, 1.2, 1.4), lam(0x4b2a17, { map: woodTexture() }));
    counter.position.set(0, 0.6, 0);
    bar.add(counter);
    const back = new THREE.Mesh(new THREE.BoxGeometry(14, 3.4, 0.4), lam(0x2b2230));
    back.position.set(0, 1.7, 1.6);
    bar.add(back);
    for (let i = 0; i < 18; i++) {
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.55, 7),
        lam(new THREE.Color().setHSL(Math.random(), 0.6, 0.55)));
      bottle.position.set(-6.4 + i * 0.75, 2.0 + (i % 2) * 0.7, 1.45);
      bar.add(bottle);
    }
    bar.position.set(0, 0, ROOM.MAX_Z - 3);
    this.scene.add(bar);
    // Follow the counter with small circles instead of three fat ones, so the
    // collision hull matches what you can see.
    for (let x = -6; x <= 6; x += 2) {
      this.obstacles.push({ x, z: ROOM.MAX_Z - 3, r: 1.1 });
    }

    for (const [x, z] of [[-36, 34], [36, 34], [-36, -14], [36, -14], [-14, -14], [14, -14]]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.36, 0.7, 10), lam(0x8a5a30));
      pot.position.set(x, 0.35, z);
      this.scene.add(pot);
      for (let i = 0; i < 6; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.5, 5), lam(0x2f7a3d));
        leaf.position.set(x + (Math.random() - 0.5), 1.2, z + (Math.random() - 0.5));
        leaf.rotation.z = (Math.random() - 0.5) * 0.7;
        this.scene.add(leaf);
      }
      this.obstacles.push({ x, z, r: 0.7 });
    }
  }

  // ------------------------------------------------------------- animation

  update(dt, ctx) {
    this.t += dt;

    for (let i = 0; i < this.chandelierLights.length; i++) {
      this.chandelierLights[i].intensity = 260 + Math.sin(this.t * 1.7 + i) * 18;
    }
    for (const n of this.neon) {
      n.material.opacity = 0.82 + Math.sin(this.t * 6 + n.position.x) * 0.08;
      n.material.transparent = true;
    }

    this._updateRoulette(dt, ctx.roulette, ctx.serverNow);
    this._updateHorses(ctx.horses, ctx.serverNow);
    this._updateCrash(ctx.crash, ctx.serverNow);
    this._updateRobots(ctx.robots, ctx.serverNow);
  }

  _updateRobots(state, serverNow) {
    if (!this.robotMeshes) return;
    const R = this.arenaR;

    if (!state || !state.fighters) {
      this.robotMeshes.forEach((r) => { r.group.visible = false; });
      return;
    }

    // Track HP by replaying the same event list the panel uses.
    if (state.phase === 'fighting' && state.events) {
      const t = serverNow - state.startAt;
      let hp = state.fighters.map((f) => f.maxHp);
      let last = null;
      for (const ev of state.events) {
        if (ev.t > t) break;
        hp = ev.hp;
        last = ev;
      }
      this._arenaHp = hp;
      this._arenaLast = last;
    } else if (state.phase === 'betting') {
      this._arenaHp = state.fighters.map((f) => f.maxHp);
      this._arenaLast = null;
    }

    this.robotMeshes.forEach((r, i) => {
      const f = state.fighters[i];
      r.group.visible = true;
      r.body.material.color.set(f.color);
      r.plate.material.color.set(f.color);

      const side = i === 0 ? -1 : 1;
      const facing = i === 0 ? Math.PI / 2 : -Math.PI / 2;
      let x = side * 2.2;
      let lunge = 0;

      if (state.phase === 'fighting' && this._arenaLast) {
        const since = (serverNow - state.startAt - this._arenaLast.t) / 1000;
        const mine = this._arenaLast.actor === i;
        // Attacker lunges in, defender rocks back.
        if (since < 0.34) {
          const k = 1 - Math.abs(since / 0.17 - 1);
          lunge = mine ? k * 0.9 : -k * 0.45;
        }
        r.visor.material.color.setHex(mine && this._arenaLast.type === 'crit' ? 0xffee66 : 0xff4444);
      }
      x += -side * lunge;

      r.group.position.set(x, 0, Math.sin(this.t * 2 + i) * 0.1);
      r.group.rotation.y = facing;
      const dead = this._arenaHp && this._arenaHp[i] <= 0;
      r.group.rotation.z = dead ? side * 1.4 : Math.sin(this.t * 6 + i) * 0.03;
      r.group.position.y = dead ? 0.35 : 0.6;
      r.arms.forEach((arm, k) => {
        arm.rotation.x = lunge > 0 ? -1.0 * lunge : Math.sin(this.t * 5 + k) * 0.12;
      });
    });

    const key = `${state.phase}:${state.matchNo}:${(this._arenaHp || []).join('/')}`;
    if (key !== this._arenaKey) {
      this._arenaKey = key;
      this._paintArena(state);
    }
  }

  _updateRoulette(dt, state, serverNow) {
    const cx = this.wheel.position.x;
    const cz = this.wheel.position.z;
    const phase = state ? state.phase : 'idle';

    if (phase !== this._lastRoulettePhase) {
      this._lastRoulettePhase = phase;
      this._spinBase = this.wheelAngle;
    }

    let pocket = null;
    if (state && state.result != null) {
      pocket = (WHEEL_ORDER.indexOf(state.result) / WHEEL_ORDER.length) * Math.PI * 2;
    }

    if (phase === 'spinning' && pocket != null) {
      const u = Math.min(1, Math.max(0, 1 - (state.until - serverNow) / 9000));
      const ease = 1 - Math.pow(1 - u, 3);
      this.wheelAngle = this._spinBase + ease * Math.PI * 10;
      const ballAngle = this.wheelAngle + pocket + (1 - ease) * Math.PI * 18;
      const radius = 1.95 - ease * 0.35;
      this.ball.position.set(
        cx + Math.cos(ballAngle) * radius,
        1.44 + (1 - ease) * 0.24,
        cz + Math.sin(ballAngle) * radius,
      );
    } else if (phase === 'payout' && pocket != null) {
      this.wheelAngle += dt * 0.12;
      const a = this.wheelAngle + pocket;
      this.ball.position.set(cx + Math.cos(a) * 1.6, 1.44, cz + Math.sin(a) * 1.6);
    } else {
      this.wheelAngle += dt * 0.5;
      const a = this.wheelAngle * 1.8;
      this.ball.position.set(cx + Math.cos(a) * 1.92, 1.5, cz + Math.sin(a) * 1.92);
    }
    this.wheel.rotation.y = this.wheelAngle;

    const key = `${phase}:${state ? state.result : ''}:${state && state.history ? state.history[0] : ''}`;
    if (key !== this._rouletteKey) {
      this._rouletteKey = key;
      this._paintRouletteBoard(state ? state.result : null, (state && state.history) || []);
    }
  }

  _updateHorses(state, serverNow) {
    if (!state || !this.horseMeshes) return;
    let progress;
    if (state.phase === 'racing' && state.finishTimes) {
      const t = (serverNow - state.startAt) / 1000;
      progress = state.finishTimes.map((T, i) => {
        const base = Math.min(1, t / T);
        if (base >= 1) return 1;
        const wobble = 0.07 * Math.sin(t * 1.9 + state.phases[i]) * (1 - base);
        return Math.max(0, Math.min(0.999, base + wobble));
      });
    } else if (state.phase === 'results') {
      progress = this.horseMeshes.map(() => 1);
    } else {
      progress = this.horseMeshes.map(() => 0);
    }

    this.horseMeshes.forEach((h, i) => {
      const x = TRACK_START + progress[i] * (TRACK_END - TRACK_START);
      h.group.position.x = x;
      const running = state.phase === 'racing' && progress[i] < 1;
      const swing = running ? Math.sin(this.t * 14 + i) : 0;
      h.legs.forEach((leg, l) => { leg.rotation.x = swing * (l % 2 ? 0.9 : -0.9); });
      h.group.position.y = running ? Math.abs(Math.sin(this.t * 14 + i)) * 0.14 : 0;
    });
  }

  _updateCrash(state, serverNow) {
    if (!state) return;
    this._paintCrash(state, serverNow);
    if (!this.rocketMeshes) return;

    const growth = state.growth || 0.075;
    const flying = state.phase === 'running' && state.startAt;

    this.rocketMeshes.forEach((rm, i) => {
      const r = (state.rockets || [])[i];
      if (!r || !flying) {
        // On the pad, idling.
        rm.group.position.set(rm.x, rm.baseY, 3.4);
        rm.group.rotation.z = 0;
        rm.group.visible = true;
        rm.flame.scale.setScalar(state && state.phase === 'betting' ? 0.35 : 0.001);
        rm.burst.material.opacity = 0;
        return;
      }

      const mult = r.dead ? (r.crashPoint || 1) : Math.exp(growth * ((serverNow - state.startAt) / 1000));
      // Log height keeps a 50x rocket on screen next to a 2x one.
      const height = rm.baseY + Math.min(9.4, Math.log(Math.max(1, mult)) * 2.6);

      if (r.dead) {
        const since = r.crashAt ? (serverNow - r.crashAt) / 1000 : 0;
        rm.group.position.set(rm.x, Math.max(0.4, height - since * 5.5), 3.4);
        rm.group.rotation.z += 0.22;               // tumbling wreck
        rm.group.visible = since < 2.2;
        rm.flame.scale.setScalar(0.001);
        rm.burst.material.opacity = Math.max(0, 1 - since * 1.6);
        rm.burst.scale.setScalar(4 + since * 9);
      } else {
        rm.group.position.set(rm.x, height, 3.4);
        rm.group.rotation.z = Math.sin(this.t * 9 + i) * 0.04;
        rm.group.visible = true;
        rm.flame.scale.set(1, 1 + Math.sin(this.t * 22 + i) * 0.35, 1);
        rm.burst.material.opacity = 0;
      }
    });
  }
}
