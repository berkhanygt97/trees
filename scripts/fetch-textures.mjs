#!/usr/bin/env node
// Downloads free CC0 surface photos from Poly Haven (https://polyhaven.com,
// public domain) into public/assets/cc0/, with a manifest the game reads at
// startup (public/js/gfx/photo.js). Run it once on the host:
//
//   npm run textures            1k photos (about 25 MB)
//   npm run textures -- --2k    2k photos (about 90 MB, sharper, heavier)
//   npm run textures -- --force download again even if already there
//
// Each surface lists a few Poly Haven assets in order of preference; if none
// exists any more, the first asset whose name matches the keywords is used.
// Without these files the game uses its own generated surfaces.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'assets', 'cc0');
const API = 'https://api.polyhaven.com';
const HEADERS = { 'User-Agent': 'HarvestRoyale-texture-fetch/1.0 (LAN party game)' };
const SIZE = process.argv.includes('--2k') ? '2k' : '1k';
const FORCE = process.argv.includes('--force');

const WANT = {
  asphalt: { ids: ['asphalt_02', 'asphalt_track', 'asphalt_01', 'asphalt_04'], words: ['asphalt'] },
  paving: { ids: ['patterned_paving_02', 'grey_cartago_02', 'paving_stones_02', 'concrete_pavement'], words: ['paving', 'pavement'] },
  brick: { ids: ['red_brick_03', 'red_brick', 'brick_wall_02'], words: ['brick'] },
  plank: { ids: ['wood_planks', 'weathered_planks', 'wood_planks_grey'], words: ['plank'] },
  plaster: { ids: ['plastered_wall_02', 'plastered_wall', 'white_plaster_02', 'beige_wall_001'], words: ['plaster'] },
  rooftile: { ids: ['roof_tiles_14', 'clay_roof_tiles_02', 'roof_09'], words: ['roof'] },
  metal: { ids: ['corrugated_iron', 'corrugated_iron_02', 'rusty_corrugated_metal'], words: ['corrugated'] },
  gravel: { ids: ['gravel_floor_02', 'gravel_floor', 'gravel_road'], words: ['gravel'] },
  dirt: { ids: ['dirt', 'brown_mud', 'dry_ground_01'], words: ['dirt', 'mud'] },
  soil: { ids: ['brown_mud_02', 'dirt_floor'], words: ['mud', 'soil'] },
  grass: { ids: ['aerial_grass_rock', 'grass_path_2', 'forest_ground_04', 'leafy_grass'], words: ['grass'] },
  rock: { ids: ['rock_face', 'rocky_terrain_02', 'aerial_rocks_02', 'rock_wall_08'], words: ['rock'] },
  sand: { ids: ['coast_sand_01', 'aerial_beach_01', 'sand_01'], words: ['sand'] },
};

// Poly Haven's names for the three maps the game uses (a few spellings seen).
const MAPS = {
  color: ['Diffuse', 'diffuse', 'diff'],
  normal: ['nor_gl', 'Nor_GL', 'normal_gl'],
  rough: ['Rough', 'rough', 'roughness'],
};

async function json(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function download(url, file) {
  if (!FORCE) {
    try { await fs.access(file); return false; } catch { /* not there yet */ }
  }
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return true;
}

function pickUrl(files, names) {
  for (const n of names) {
    const entry = files[n];
    const sized = entry && (entry[SIZE] || entry['1k']);
    const url = sized && (sized.jpg || sized.png);
    if (url && url.url) return url.url;
  }
  return null;
}

async function main() {
  console.log(`Poly Haven textures (CC0), ${SIZE}, into ${path.relative(ROOT, OUT)}`);
  let assets;
  try {
    assets = await json(`${API}/assets?t=textures`);
  } catch (err) {
    console.error(`Could not reach Poly Haven: ${err.message}\nThe game will keep using its generated surfaces.`);
    process.exit(1);
  }
  const all = Object.keys(assets);
  await fs.mkdir(OUT, { recursive: true });
  const manifest = { source: 'Poly Haven (polyhaven.com), CC0 public domain', size: SIZE, sets: {} };

  for (const [kind, want] of Object.entries(WANT)) {
    const id = want.ids.find((x) => assets[x]) || all.find((x) => want.words.some((w) => x.includes(w)));
    if (!id) { console.log(`  ${kind.padEnd(9)} nothing suitable found, skipped`); continue; }
    try {
      const [files, info] = await Promise.all([json(`${API}/files/${id}`), json(`${API}/info/${id}`).catch(() => ({}))]);
      const urls = Object.fromEntries(Object.entries(MAPS).map(([k, names]) => [k, pickUrl(files, names)]));
      const missing = Object.entries(urls).filter(([, u]) => !u).map(([k]) => k);
      if (missing.length) { console.log(`  ${kind.padEnd(9)} ${id}: no ${missing.join('/')} map, skipped`); continue; }
      const dir = path.join(OUT, kind);
      await fs.mkdir(dir, { recursive: true });
      const set = {};
      let fresh = 0;
      for (const [k, url] of Object.entries(urls)) {
        const name = `${id}_${k}${path.extname(new URL(url).pathname) || '.jpg'}`;
        if (await download(url, path.join(dir, name))) fresh++;
        set[k] = `${kind}/${name}`;
      }
      // How much ground one photo covers, in metres (Poly Haven lists it in mm).
      const dims = Array.isArray(info.dimensions) ? info.dimensions : null;
      set.metres = dims ? Math.max(0.2, dims[0] / 1000) : 2;
      set.id = id;
      set.name = assets[id].name || id;
      manifest.sets[kind] = set;
      console.log(`  ${kind.padEnd(9)} ${id} (${set.metres} m)${fresh ? '' : ' already here'}`);
    } catch (err) {
      console.log(`  ${kind.padEnd(9)} ${id}: ${err.message}, skipped`);
    }
  }
  await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const n = Object.keys(manifest.sets).length;
  console.log(`\n${n} surfaces ready. Restart the game (or reload the page) to see them.`);
}

main();
