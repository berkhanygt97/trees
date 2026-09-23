import { STATIC_BOXES, insideCasino } from '/shared/map.js';
import { Casino } from './casino.js';
import { Outdoor } from './outdoor.js';
import { FarmView } from './farmview.js';
import { Sky } from './sky.js';

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
    this.sky = new Sky(scene, this.casino);

    // Circles: casino furniture, trees, lamp posts. Boxes: walls and fences.
    this.staticObstacles = [...this.casino.obstacles, ...this.outdoor.obstacles];
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
    // Restaurants and cottages on the Sunset Strip (set up by main).
    if (this.extraBoxes && this.extraBoxes.length) out = out.concat(this.extraBoxes);
    return out;
  }

  paintBoard(rows, meId) { this.casino.paintBoard(rows, meId); }

  update(dt, ctx) {
    const inside = insideCasino(ctx.camera.position.x, ctx.camera.position.z);
    this.sky.update(dt, ctx.worldTime, ctx.camera, inside);
    this.outdoor.update(dt, this.sky.night);
    this.farms.update(dt, ctx.worldTime, this.sky.night);
    // The casino's animated games only need updating when you might see them.
    const cx = ctx.camera.position.x;
    const cz = ctx.camera.position.z;
    if (Math.abs(cx) < 140 && cz < 140 && cz > -120) this.casino.update(dt, ctx);
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

