import { usePhotos } from './surfaces.js';

// Photo textures, if the host has them: `npm run textures` downloads free
// CC0 surface photos (Poly Haven) into public/assets/cc0/ with a manifest.
// Each set that loads replaces the generated surface of that kind (asphalt,
// brick, grass...), with its own normal and roughness maps. Without them the
// generated surfaces are used, so the game looks fine either way.

const BASE = '/assets/cc0/';

function image(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = BASE + src;
  });
}

/** Loads whatever photo sets the manifest lists. Resolves with how many loaded. */
export async function loadPhotoTextures() {
  let manifest;
  try {
    const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return 0;
    manifest = await res.json();
  } catch {
    return 0;
  }
  let loaded = 0;
  await Promise.all(Object.entries(manifest.sets || {}).map(async ([kind, set]) => {
    try {
      const [color, normal, rough] = await Promise.all([image(set.color), image(set.normal), image(set.rough)]);
      usePhotos(kind, { color, normal, rough, metres: set.metres });
      loaded++;
    } catch {
      // That set is missing or broken: its generated surface stays.
    }
  }));
  return loaded;
}
