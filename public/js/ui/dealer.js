import * as THREE from 'three';
import { pbr } from '../gfx/materials.js';
import { studioEnvironment } from '../gfx/env.js';
import { VEHICLES, PAINTS, money } from '/shared/catalog.js';
import { div, esc } from './util.js';
import { buildVehicle } from '../vehicles.js';
import { sfx } from '../sfx.js';

// Car dealer: a turntable preview, paint swatches and the stats that matter.

export function createCarDealer(ctx) {
  const station = ctx.station.id;
  const cars = VEHICLES.filter((v) => v.kind === 'car' && !v.hidden);
  let pick = 0;
  let paint = PAINTS[0];

  const root = div(`
    <canvas class="preview" width="640" height="250"></canvas>
    <div class="swatches" data-swatches>${PAINTS.map((c) => `<button class="swatch-btn" data-paint="${c}" style="background:${c}"></button>`).join('')}</div>
    <div class="shop-list" data-list></div>
  `);
  const canvas = root.querySelector('canvas');
  const listEl = root.querySelector('[data-list]');

  // A tiny scene of its own for the turntable.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.2;
  const scene = new THREE.Scene();
  // A studio for the paint and chrome to reflect.
  scene.environment = studioEnvironment(renderer);
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(5, 8, 6);
  scene.add(key);
  const cam = new THREE.PerspectiveCamera(32, 640 / 250, 0.1, 100);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.2, 40), pbr(0x2b2230, { roughness: 0.25 }));
  floor.position.y = -0.1;
  scene.add(floor);
  let model = null;

  function show() {
    if (model) { scene.remove(model.group); model.dispose(); }
    const car = cars[pick];
    model = buildVehicle(car.id, paint);
    scene.add(model.group);
    const far = car.id === 'limo' ? 13 : 9.5;
    cam.position.set(far * 0.75, far * 0.36, far * 0.75);
    cam.lookAt(0, 0.7, 0);
  }

  let shown = '';
  function paintList() {
    const w = ctx.wallet;
    const owned = (id) => ctx.vehicles.filter((v) => v.model === id).length;
    const html = cars.map((c, i) => `
      <div class="shop-row ${i === pick ? 'owned' : ''}" data-pick="${i}" style="cursor:pointer;pointer-events:auto">
        <div class="ic">🚗</div>
        <div>
          <div class="nm">${esc(c.name)}${owned(c.id) ? ` <small style="color:var(--green)">· you own ${owned(c.id)}</small>` : ''}</div>
          <div class="ds">${esc(c.blurb)}</div>
          <div class="stat">SPEED <i style="--v:${Math.round((c.top / 58) * 100)}%"></i> ${Math.round(c.top * 3.6)} km/h</div>
          <div class="stat">GRUNT <i style="--v:${Math.round((c.accel / 20) * 100)}%"></i></div>
        </div>
        <div class="btns"><span class="pr">${money(c.price)}</span>
          <button class="bet primary" data-buy="${i}" ${w.money < c.price ? 'disabled' : ''}>BUY</button></div>
      </div>`).join('');
    // Only rebuild when something changed, so a click is never lost mid-press.
    if (html !== shown) { shown = html; listEl.innerHTML = html; }
    for (const b of root.querySelectorAll('[data-paint]')) b.classList.toggle('sel', b.dataset.paint === paint);
  }

  root.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-paint]');
    if (sw) { paint = sw.dataset.paint; model.setColor(paint); paintList(); sfx.click(); return; }
    const buy = e.target.closest('[data-buy]');
    if (buy) {
      if (buy.disabled) { sfx.deny(); return; }
      const c = cars[Number(buy.dataset.buy)];
      sfx.chip();
      ctx.send('buy', { station, sku: `vehicle:${c.id}`, color: paint });
      return;
    }
    const row = e.target.closest('[data-pick]');
    if (row) { pick = Number(row.dataset.pick); show(); paintList(); sfx.click(); }
  });

  show();
  paintList();

  let spin = 0;
  let last = performance.now();
  let raf = 0;
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    spin += (now - last) / 1000 * 0.6;
    last = now;
    if (model) {
      model.group.rotation.y = spin;
      model.update(0, 0, 0);
    }
    renderer.render(scene, cam);
  };
  raf = requestAnimationFrame(frame);

  return {
    root,
    onWallet: paintList,
    onResult(res) {
      if (res.bought) ctx.feed(`Bought a ${res.bought}! It is parked on the street outside.`, 'win');
      paintList();
    },
    onKey(code) {
      if (code === 'ArrowDown' || code === 'KeyS') { pick = (pick + 1) % cars.length; show(); paintList(); return true; }
      if (code === 'ArrowUp' || code === 'KeyW') { pick = (pick + cars.length - 1) % cars.length; show(); paintList(); return true; }
      return false;
    },
    tick() {},
    destroy() {
      cancelAnimationFrame(raf);
      if (model) model.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
