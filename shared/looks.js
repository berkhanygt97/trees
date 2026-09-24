// The cast: named people for the town, built from character.js outfits.
// Shared by the server (gang soldiers, raiders) and the client (pedestrians,
// the gallery). Every look is ours: San Andreas-era in spirit, original in
// every name, logo and colour.
//
// A look here is only data; character.js normalizeLook() fills in the rest.

export const LOOKS = {
  // ------------------------------------------------------------ gangs
  // Gang looks are recoloured with the boss's colour (castLook(id, { color })).
  'gang-flannel': { name: 'Flannel', group: 'gang', look: { outfit: 'flannel', color: '#2e8b57', skin: '#6f4a33', hair: '#151312' } },
  'gang-heavy':   { name: 'Big Man', group: 'gang', look: { outfit: 'heavy', color: '#2e8b57', accent: '#2e8b57', skin: '#8d5a3b', hair: '#1c1714' } },
  'gang-hoodie':  { name: 'Hoodie', group: 'gang', look: { outfit: 'street', top: 'hoodie', legs: 'baggy', head: 'capback', pants: '#2f3136', color: '#2e8b57', accent: '#2e8b57', skin: '#9c6644' } },
  'gang-twists':  { name: 'Twists', group: 'gang', look: { outfit: 'street', top: 'tank', legs: 'baggy', head: 'braids', chain: true, pants: '#c8b48a', color: '#2e8b57', accent: '#2e8b57', skin: '#5e3d2a', hair: '#141110' } },
  'gang-tank':    { name: 'Tank Top', group: 'gang', look: { outfit: 'street', top: 'tank', legs: 'khaki', head: 'bandana', color: '#2e8b57', accent: '#2e8b57', skin: '#c68a5e' } },
  'gang-tee':     { name: 'Tee', group: 'gang', look: { outfit: 'street', top: 'tee', legs: 'jeans', head: 'capback', beard: 'goatee', color: '#2e8b57', accent: '#2e8b57', skin: '#e0ac80' } },

  // --------------------------------------------------------- civilians
  'pizza-guy': { name: 'Pizza Guy', group: 'civilian', look: { outfit: 'pizza', skin: '#e0ac80', hair: '#3a2a1c' } },
  'old-timer': { name: 'Old Timer', group: 'civilian', look: { outfit: 'oldtimer', skin: '#c9946c' } },
  'tourist':   { name: 'Tourist', group: 'civilian', look: { outfit: 'tourist', color: '#f5efe0', accent: '#e84393', skin: '#6f4a33', hair: '#8f8a82' } },

  // ------------------------------------------------------------- law
  'agent':      { name: 'Federal Agent', group: 'law', look: { outfit: 'agent', skin: '#e8b897', hair: '#2b2622' } },
  'patrol-cop': { name: 'Patrol Cop', group: 'law', look: { outfit: 'cop', skin: '#c68a5e', hair: '#1f1a16' } },

  // ------------------------------------------------------------ tough
  'biker':    { name: 'Biker', group: 'tough', look: { outfit: 'leather', skin: '#efc0a0', hair: '#8a4a22', eyes: '#4a6a8a' } },
  'bouncer':  { name: 'Bouncer', group: 'tough', look: { outfit: 'bouncer', skin: '#d9a27a' } },
  'enforcer': { name: 'Enforcer', group: 'tough', look: { outfit: 'leather', head: 'slick', beard: 'stache', shades: true, legs: 'slacks', shoes: 'dress', pants: '#1c1c20', skin: '#c68a5e', hair: '#1a1512' } },
};

export const CAST = { gang: [], civilian: [], law: [], tough: [] };
for (const [id, { group }] of Object.entries(LOOKS)) CAST[group].push(id);

/** A named look, ready for createCharacter(), with anything in `over` on top. */
export function castLook(id, over = {}) {
  const entry = LOOKS[id] || LOOKS['gang-tee'];
  const out = { ...entry.look };
  for (const [k, v] of Object.entries(over)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

/** A cast id from one group (or several), picked with a 0..1 generator so crowds can be seeded. */
export function pickCast(groups, rnd = Math.random) {
  const ids = [].concat(groups).flatMap((g) => CAST[g] || []);
  return ids[Math.floor(rnd() * ids.length) % ids.length];
}
