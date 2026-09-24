// Runs every test/*.test.mjs in its own node process, one after another.
//   node test/run.mjs            all of them
//   node test/run.mjs saves      only files whose name contains "saves"
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';
const files = fs.readdirSync(here).filter((f) => f.endsWith('.test.mjs') && f.includes(filter)).sort();
const failed = [];
for (const f of files) {
  const t0 = Date.now();
  const res = spawnSync(process.execPath, [path.join(here, f)], { encoding: 'utf8' });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  const ok = res.status === 0;
  const lines = out.trim().split('\n');
  const fails = lines.filter((l) => l.startsWith('FAIL'));
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f.padEnd(28)} ${lines.filter((l) => l.startsWith('PASS')).length} passed${fails.length ? `, ${fails.length} failed` : ''}  (${Date.now() - t0} ms)`);
  if (!ok) {
    failed.push(f);
    console.log(out.split('\n').filter((l) => !l.startsWith('PASS')).map((l) => `     ${l}`).join('\n'));
  }
}
console.log(failed.length ? `\n${failed.length} test file(s) failed: ${failed.join(', ')}` : `\nall ${files.length} test files passed`);
process.exit(failed.length ? 1 : 0);
