// Terminal entry point. The desktop app calls startCasino() directly instead.
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../shared/config.js';
import { startCasino, ROOT } from './app.js';

const casino = await startCasino({
  port: process.env.PORT,
  startCash: process.env.START_CASH,
  saveDir: process.env.SAVE_DIR,
  timeScale: process.env.TIME_SCALE,
}).catch((err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${Number(process.env.PORT) || 3000} is already in use.`);
    console.error('  Close whatever is using it, or pick another:  PORT=3001 npm start\n');
  } else {
    console.error('\n  Could not start the server:', err.message, '\n');
  }
  process.exit(1);
});

const hasThree = fs.existsSync(path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.js'));

console.log('');
console.log('  🌾 ♠  H A R V E S T   R O Y A L E   —   L A N   ♦ 🚜');
console.log('  ' + '-'.repeat(48));
console.log(`  On this machine : ${casino.localUrl}`);
for (const url of casino.lanUrls) {
  console.log(`  For your guests : ${url}`);
}
if (!casino.lanUrls.length) {
  console.log('  No network address found — are you connected to Wi-Fi?');
}
console.log('  ' + '-'.repeat(48));
console.log(`  Save files      : ${casino.saveDir}  (SAVE_DIR=…)`);
console.log(`  New farmers get : $${CONFIG.STARTING_BANKROLL.toLocaleString('en-US')}  (START_CASH=…)`);
if (!hasThree) console.log('  !! three.js not found — run `npm install` first.');
console.log('');

const bye = async () => { await casino.close(); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
