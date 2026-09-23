// Save files on the host's disk: one for the world, one per player.
//
//   <dir>/world.json            clock, weather, market, orders, who owns which plot
//   <dir>/players/<name>.json   everything a player owns
//
// Writes are atomic (temp file + rename) and the previous copy is kept as
// .bak, so pulling the plug mid-save costs at most the last 30 seconds.
import fs from 'node:fs';
import path from 'node:path';

// 2: farm layouts, workers, restaurants (2.2). Older saves are migrated on load.
export const SAVE_VERSION = 2;

export function slugOf(name) {
  const base = String(name).toLowerCase().normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base) return base.slice(0, 40);
  // Names in scripts with no latin letters still need a filesystem-safe key.
  return `p-${[...String(name)].map((c) => c.codePointAt(0).toString(16)).join('')}`.slice(0, 40);
}

export class SaveStore {
  constructor(dir) {
    this.dir = path.resolve(dir);
    this.playersDir = path.join(this.dir, 'players');
    fs.mkdirSync(this.playersDir, { recursive: true });
    this.written = new Map();   // file -> last JSON written, to skip no-op writes
    this.lastSaveAt = 0;
  }

  _read(file) {
    for (const f of [file, `${file}.bak`]) {
      try {
        const data = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (f !== file) console.warn(`[save] ${path.basename(file)} was unreadable — recovered from .bak`);
        return data;
      } catch (err) {
        if (err.code !== 'ENOENT') console.warn(`[save] could not read ${f}: ${err.message}`);
      }
    }
    return null;
  }

  _write(file, data) {
    const json = JSON.stringify(data, null, 1);
    if (this.written.get(file) === json) return false;
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, json);
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    fs.renameSync(tmp, file);
    this.written.set(file, json);
    return true;
  }

  loadWorld() {
    return this._read(path.join(this.dir, 'world.json'));
  }

  saveWorld(data) {
    return this._write(path.join(this.dir, 'world.json'), { version: SAVE_VERSION, ...data });
  }

  /** Every saved player, so offline farms keep growing while friends play. */
  loadPlayers() {
    const out = [];
    let files = [];
    try { files = fs.readdirSync(this.playersDir); } catch { return out; }
    const names = new Set(files.filter((f) => f.endsWith('.json') || f.endsWith('.json.bak'))
      .map((f) => f.replace(/\.bak$/, '')));
    for (const f of names) {
      const data = this._read(path.join(this.playersDir, f));
      if (data && data.name) out.push(data);
    }
    return out;
  }

  savePlayer(data) {
    return this._write(path.join(this.playersDir, `${data.slug}.json`), { version: SAVE_VERSION, ...data });
  }

  list() {
    try {
      return fs.readdirSync(this.playersDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const st = fs.statSync(path.join(this.playersDir, f));
          return { file: f, size: st.size, modified: st.mtimeMs };
        });
    } catch {
      return [];
    }
  }
}
