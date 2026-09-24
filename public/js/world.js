import { STATIC_BOXES, CASINO, insideCasino } from '/shared/map.js';
import { Casino } from './casino.js';
import { Outdoor } from './outdoor.js';
import { FarmView } from './farmview.js';
import { Sky } from './sky.js';
import { makeHalo, updateHalos } from './neon.js';
import { HoodView } from './city/hoods.js';
import { Downtown } from './city/downtown.js';
import { Props } from './city/props.js';
import { LightPool } from './city/lights.js';

/**
 * Everything you can see: the casino building, the valley around it, the farms
 * and the sky. Collision data is gathered here for the controls.
 */
export class World {
  constructor(scene) {
    this.scene = scene;
    this.casino = new Casino(scene);
    this.outdoor = new Outdoor(scene);
    this.farms = new FarmView(scene);
    this.hoods = new HoodView(scene);
    this.downtown = new Downtown(scene);
    this.props = new Props(scene);
    this.sky = new Sky(scene, this.casino);
    // The big CASINO ROYALE sign glows gold after dark.
    const sign = this.casino.outsideSign;
    if (sign) {
      const halo = makeHalo(40, 10, '#ffb84a', { day: 0.05, night: 0.55 });
      halo.position.copy(sign.position);
      halo.position.z += 0.1;
      scene.add(halo);
    }

    // Real light, shared out to the nearest sources: chandeliers, street lamps.
    this.lights = new LightPool(scene);
    this.lights.add(this.casino.lightSources);
    const lamp = ([x, z]) => ({ x, y: 4.9, z, color: 0xffd9a0, intensity: 45, range: 17, night: true });
    this.lights.add([...this.outdoor.lampSpots, ...this.hoods.lampSpots].map(lamp));

    // Circles: casino furniture, trees, lamp posts. Boxes: walls and fences.
    this.staticObstacles = [...this.casino.obstacles, ...this.outdoor.obstacles, ...this.hoods.obstacles, ...this.downtown.obstacles, ...this.props.obstacles];
    this.dynamicObstacles = [];   // parked vehicles, refreshed by the vehicle layer
    this.boxes = STATIC_BOXES;
    this._grid = buildGrid(this.staticObstacles);
  }

  /** Circle colliders near (x, z): static ones from a grid, plus parked cars. */
  obstaclesNear(x, z) {
    const out = this._grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) || EMPTY;
    return this.dynamicObstacles.length ? out.concat(this.dynamicObstacles) : out;
  }

  boxesNear() {
    let out = this.farms.boxes.length ? this.boxes.concat(this.farms.boxes) : this.boxes;
    // Compound walls round the clubhouses, once they are built.
    if (this.hoods.boxes.length) out = out.concat(this.hoods.boxes);
    // Restaurants and cottages on the Sunset Strip (set up by main).
    if (this.extraBoxes && this.extraBoxes.length) out = out.concat(this.extraBoxes);
    return out;
  }

  paintBoard(rows, meId) { this.casino.paintBoard(rows, meId); }

  update(dt, ctx) {
    const inside = insideCasino(ctx.camera.position.x, ctx.camera.position.z);
    this.sky.update(dt, ctx.worldTime, ctx.camera, inside);
    this.outdoor.update(dt, this.sky.night, this.sky.wetness || 0);
    if (this.outdoor.grassField) this.outdoor.grassField.update(ctx.camera.position);
    if (this.outdoor.trees) this.outdoor.trees.userData.update(ctx.camera.position);
    this.farms.update(dt, ctx.worldTime, this.sky.night);
    this.hoods.update(dt, this.sky.night);
    this.downtown.update(dt, this.sky.night);
    this.props.update();
    updateHalos(dt, this.sky.inside > 0.5 ? 0 : this.sky.night);
    this.lights.update(ctx.camera.position, this.sky.night, this.sky.inside);
    // The casino's animated games only need updating when you might see them.
    const cx = ctx.camera.position.x;
    const cz = ctx.camera.position.z;
    const near = Math.abs(cx) < 140 && cz < 140 && cz > -120;
    // Inside, or right at the doors looking in: draw the room.
    const atDoor = Math.abs(cx) < 36 && cz > CASINO.MAX_Z - 3 && cz < CASINO.MAX_Z + 18;
    this.casino.setInteriorShown(inside || atDoor);
    if (near) this.casino.update(dt, ctx);
  }
}

// Spatial hash for the hundreds of trees, so collision stays cheap.
const CELL = 16;
const EMPTY = [];
const cellKey = (i, j) => `${i},${j}`;

function buildGrid(obstacles) {
  const grid = new Map();
  for (const o of obstacles) {
    const r = o.r + 3;   // pad by the biggest thing that collides with it
    for (let i = Math.floor((o.x - r) / CELL); i <= Math.floor((o.x + r) / CELL); i++) {
      for (let j = Math.floor((o.z - r) / CELL); j <= Math.floor((o.z + r) / CELL); j++) {
        const k = cellKey(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(o);
      }
    }
  }
  return grid;
}

