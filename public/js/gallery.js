import * as THREE from 'three';
import { pbr } from './gfx/materials.js';
import { createSkyMaterial, hazeAt, installFog } from './gfx/atmosphere.js';
import { Environment } from './gfx/env.js';
import { markShadows } from './shadows.js';
import { createCharacter } from './character.js';
import { buildVehicle } from './vehicles.js';
import { LOOKS } from '/shared/looks.js';
import { VEHICLES } from '/shared/catalog.js';

// The gallery at /gallery.html: everyone in the town's cast and every car,
// side by side on a grey studio floor, for looking at the art without
// playing. #cast (full length), #faces (close-ups), #cars, and #look (a
// turntable: arrow keys change who, dragging turns them).

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

// Lit like the game at mid-morning: the same sky for reflections and fill,
// a warm sun with soft shadows, and the same tone mapping.
installFog();
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const sunDir = new THREE.Vector3(0.45, 0.7, 0.55).normalize();
const skyMat = createSkyMaterial();
skyMat.uniforms.sunDir.value.copy(sunDir);
hazeAt(sunDir.y, 0, skyMat.uniforms.haze.value, skyMat.uniforms.hazeSun.value);
skyMat.uniforms.cloudsOn.value = 0;
const env = new Environment(renderer, skyMat, 64);
scene.environment = env.update(0, new THREE.Vector3(), sunDir, 0);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x4a4238, 0.3));
const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
sun.position.copy(sunDir).multiplyScalar(10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -6;
sun.shadow.camera.right = sun.shadow.camera.top = 6;
scene.add(sun, sun.target);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 60), pbr(0x3a3a3e, { roughness: 0.6 }));
floor.rotation.x = -Math.PI / 2;
floor.position.z = -10;
scene.add(floor);

const SPACING = 8;                 // every subject stands alone; each tile's camera looks at one
const people = Object.entries(LOOKS).map(([id, entry], i) => {
  const p = createCharacter(entry.look);
  p.group.position.set(i * SPACING, 0, 0);
  scene.add(p.group);
  return { id, name: entry.name, obj: p.group, p, x: i * SPACING };
});
const paints = ['#8a9a5b', '#c0392b', '#2e86de', '#f1c40f', '#9aa6b2', '#8e44ad', '#111111', '#16a085'];
const cars = VEHICLES.filter((v) => v.kind === 'car').map((v, i) => {
  const car = buildVehicle(v.id, paints[i % paints.length]);
  const x = 1000 + i * 25;
  car.group.position.set(x, 0, 0);
  scene.add(car.group);
  return { id: v.id, name: v.name, obj: car.group, car, x };
});

const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
let mode = 'cast';
let turn = 0;
let pick = 0;
let spinning = true;
let yaw0 = null;
const tags = [];

function setTags(list) {
  for (const t of tags.splice(0)) t.remove();
  for (const text of list) {
    const d = document.createElement('div');
    d.className = 'tag';
    d.textContent = text;
    document.body.appendChild(d);
    tags.push(d);
  }
}

function readHash() {
  const h = location.hash.replace('#', '') || 'cast';
  const [m, rest = ''] = h.split('=');
  const [arg, ...opts] = rest.split('&');
  const yawOpt = opts.find((o) => o.startsWith('yaw:'));
  yaw0 = yawOpt ? Number(yawOpt.slice(4)) : null;
  turn = 0;
  mode = ['cast', 'faces', 'cars', 'look'].includes(m) ? m : 'cast';
  if (mode === 'look' && arg) {
    const all = [...people, ...cars];
    const i = all.findIndex((s) => s.id === arg);
    if (i >= 0) pick = i;
  }
  spinning = mode === 'look' && !h.includes('still');
  for (const a of document.querySelectorAll('#tabs a')) a.classList.toggle('on', a.getAttribute('href') === `#${mode}`);
  const all = [...people, ...cars];
  setTags(mode === 'cast' || mode === 'faces' ? people.map((s) => s.name) : mode === 'cars' ? cars.map((s) => s.name) : [all[pick].name]);
  for (const s of people) s.obj.rotation.y = 0.35;
  for (const s of cars) s.obj.rotation.y = -2.4;
}
window.addEventListener('hashchange', readHash);
readHash();

window.addEventListener('keydown', (e) => {
  if (mode !== 'look') return;
  const n = people.length + cars.length;
  if (e.key === 'ArrowRight') pick = (pick + 1) % n;
  else if (e.key === 'ArrowLeft') pick = (pick + n - 1) % n;
  else return;
  setTags([[...people, ...cars][pick].name]);
});
let drag = null;
window.addEventListener('pointerdown', (e) => { drag = e.clientX; spinning = false; });
window.addEventListener('pointerup', () => { drag = null; });
window.addEventListener('pointermove', (e) => {
  if (drag == null) return;
  turn += (e.clientX - drag) * 0.01;
  drag = e.clientX;
});

/** Draws one subject into a tile: `frame` = [height to look at, distance, height of the camera]. */
function tile(s, x, y, w, h, frame, tag) {
  const H = window.innerHeight;
  renderer.setViewport(x, H - y - h, w, h);
  renderer.setScissor(x, H - y - h, w, h);
  renderer.setClearColor(0x2b2b2e);
  renderer.clear();
  camera.aspect = w / h;
  const [look, dist, up] = frame;
  camera.position.set(s.x, up, dist);
  camera.lookAt(s.x, look, 0);
  camera.updateProjectionMatrix();
  // The sun's shadow follows whoever is in this tile.
  sun.target.position.set(s.x, 0, 0);
  sun.position.copy(sunDir).multiplyScalar(10).add(sun.target.position);
  renderer.render(scene, camera);
  if (tag) { tag.style.left = `${x + w / 2}px`; tag.style.top = `${y + h - 26}px`; }
}

function grid(list, cols, frame) {
  const W = window.innerWidth;
  const H = window.innerHeight - 40;
  const rows = Math.ceil(list.length / cols);
  const w = Math.floor(W / cols);
  const h = Math.floor(H / rows);
  list.forEach((s, i) => tile(s, (i % cols) * w, 40 + Math.floor(i / cols) * h, w - 2, h - 2, frame, tags[i]));
}

markShadows(scene);
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  for (const s of people) s.p.update(dt, false, false, 0);
  if (mode === 'cast') grid(people, Math.ceil(people.length / 2), [0.95, 5.2, 1.2]);
  else if (mode === 'faces') grid(people, Math.ceil(people.length / 2), [1.73, 0.95, 1.76]);
  else if (mode === 'cars') grid(cars, 3, [0.6, 9.5, 2.5]);
  else {
    const s = [...people, ...cars][pick];
    if (spinning) turn += dt * 0.6;
    s.obj.rotation.y = (yaw0 ?? (s.car ? -2.4 : 0.35)) + turn;
    tile(s, 0, 40, window.innerWidth, window.innerHeight - 40, s.car ? [0.6, 9, 2.4] : [1.0, 4.2, 1.3], tags[0]);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.gallery = { people, cars, renderer };
