# 🌾 Harvest Royale — LAN

A first-person farming game you host from your own computer, with a casino in
town. Everyone on the same Wi-Fi opens a link, types a name, and gets their own
farm in the valley. They start with a small field, a bag of seeds and $500.

Plow, plant, water and harvest by hand. Sell at the market. Save up for a
tractor, a combine, chickens and cows, a windmill and a bakery, a bigger house,
and a car that is far too fast for a farm road. Or skip all that and put the
lot on red.

**Everything is saved on the host's computer, one file per player.** Come back
tomorrow with the same name and your farm is exactly where you left it.

No installs for your guests, no accounts, no internet required once it is
running — everything, including three.js, is served off your machine.

---

## Running it

**The desktop app** is the one to use. Double-click it and it shows you the
link to hand around. Nothing to install for guests; they only need a browser.

```bash
npm install
npm run desktop          # run from source
npm run build:win        # portable Windows app in dist/
```

The build lands in `dist/` as a zip: unzip it anywhere and run
`Harvest Royale.exe`. (The first build downloads electron-builder, so it needs
internet; the app itself never does.)

**The plain server** is the same game from a terminal, if you have Node 18+:

```bash
npm install
npm start
```

### What the host app gives you

- **The link to hand out**, with a Copy button — one per network if your machine
  is on several.
- **Play in a new window**, so the host can play too.
- **The valley**: day, time and weather, the casino event, and every farmer's
  net worth and level (offline farmers included, greyed out).
- **Save files**: where they are, when they were last written, and buttons to
  **open the folder**, **save now**, or **move saves** somewhere else.
- **Settings**: how much money brand-new farmers start with, and the port.
- **Firewall help** for your operating system.

Quitting always saves first. If people are still playing it asks before
kicking them out.

---

## Save files

```
Documents\Harvest Royale\saves\       (desktop app; `saves/` next to the server otherwise)
  world.json                          the clock, weather, market prices, orders
  players\alice.json                  one file per farmer: money, field, house,
  players\bob.json                    animals, vehicles and where they are parked
```

- Written every **30 seconds**, whenever somebody **leaves**, and on **shutdown**.
- Each write goes to a temporary file first and the previous version is kept
  as `.bak`, so pulling the plug mid-save costs at most the last 30 seconds. A
  damaged file is recovered from its `.bak` automatically.
- **Back up** by copying the folder. **Restore** by copying it back with the
  host closed. **Delete a player** by deleting their file with the host closed.
- **Time only passes while the host is running.** Close it overnight and every
  crop is exactly as ripe in the morning as when you left. While the host is
  running, farms of players who are not online still grow, and their animals
  keep laying.
- Your save is your **name**. Typing the same name (any capitals) loads it; the
  same name cannot be in the game twice at once.

---

## Hosting over your local network

1. **Put everyone on the same network** — same Wi-Fi, or Wi-Fi and Ethernet on
   the same router. No internet needed.
2. **Start the host** (desktop app, or `npm start`).
3. **Hand out the link.** It looks like `http://192.168.1.42:3000`.
4. **Guests open it** in Chrome, Edge, Firefox or Safari.

Built for 3–4 players; there are six farms, so a couple of new names can still
turn up and get land.

### If nobody can connect

- **Firewall on the host.** On Windows, the first time you host it asks whether
  to let the app communicate — tick **Private networks**. If you dismissed it:
  Windows Security → Firewall & network protection → Allow an app through
  firewall → tick Private for it.
- **Guest Wi-Fi.** "Client isolation" blocks devices from seeing each other. Use
  the main network or a phone hotspot.
- **Wrong address.** `localhost` only ever means "this machine".
- **VPN on the host.** Turn it off while hosting.
- **Port taken.** Change it in the app, or `PORT=3001 npm start`.

---

## Controls

| | |
| --- | --- |
| `W` `A` `S` `D` | Walk / drive |
| `Shift` · `Space` | Sprint · jump (handbrake when driving) |
| Mouse | Look (click to capture the pointer) |
| `E` or left click | Use what you are standing at, or **farm the tile you are looking at** — hold it and walk along a row |
| `1`–`7`, mouse wheel | Pick a seed |
| `F` | Get in / out of your vehicle |
| `V` | Driver's seat or chase camera |
| `G` | Swap the tractor's implement |
| `Q` / `Esc` | Leave a shop or table |
| `Tab` | Rich list and your storage |
| `H` | Help |
| `C` | Smoke your cigar |
| `M` | Mute |

---

## The valley

```
                 VALLEY SPEEDWAY  (race track with ramps, always open)
                         |
          +--------- CASINO ROYALE ---------+
          |                                 |
          +------------ plaza --------------+    orders board, fountain
                     |  main street  |
       Farm Supply   |               |   Motors (cars)
       Market        |               |   Tractor Barn
       Cluck & Moo   |               |   Land Office
       Builders      |               |
   ---- farm road ------------------------------------------ farm road ----
   farm  farm  farm                             farm  farm  farm
```

### Farming

Look at a tile on your field and press `E`. It does the next job:
**plow → plant → water → harvest**. Watered crops grow 50% faster; **rain waters
everything for free**. A **thunderstorm** can scorch a few ripe crops, so harvest
when the sky turns dark.

| Crop | Unlocks | Grows | Notes |
| --- | --- | --- | --- |
| 🌾 Wheat | level 1 | 3 min | cheap; also animal feed and flour |
| 🥕 Carrot | level 1 | 4 min | |
| 🥔 Potato | level 2 | 6 min | |
| 🌽 Corn | level 3 | 8 min | |
| 🍅 Tomato | level 4 | 7 min | regrows three more times |
| 🎃 Pumpkin | level 5 | 12 min | few per tile, big money |
| 🍓 Strawberry | level 6 | 8 min | regrows four more times |

Harvests land in your house's storage. Sell at the **Market** in town for full
price, or drop them in the **shipping bin** by your gate for 80%.

**Prices move every morning**, and they are shared: dumping a mountain of one
crop on the market pushes its price down for everybody for a while. Spread out.

The **Orders board** in the plaza always has three delivery contracts that pay
well above market price. The first farmer to turn up with the goods gets paid,
so it is a race.

### Getting bigger

Every purchase has a shop in town, run by someone with a name tag:

| Shop | Sells |
| --- | --- |
| **Farm Supply** | seeds; a free bag if you are truly broke |
| **Market** | buys everything you make |
| **Cluck & Moo** | chicken coop, cow barn, chickens, cows, feed |
| **Builders** | house upgrades, windmill, dairy, bakery |
| **Land Office** | field expansions: 8×8 → 12×12 → 16×16 → 20×20 |
| **Tractor Barn** | tractor, plow, seeder, water tank, combine harvester |
| **Motors** | seven cars from a $1,500 Rust Bucket to a $220,000 Hypercar |

- **Machines** — drive a tractor over your field with a plow, seeder or water
  tank hitched and it works three rows at once. The combine harvests five.
- **Animals** — chickens lay eggs and cows give milk as long as their trough has
  feed (or wheat) in it. They keep going while you do other things.
- **Workshops** — the windmill turns wheat into flour, the dairy turns milk into
  cheese, and the bakery turns flour, eggs and milk into bread and cake. Slow,
  but worth far more than the raw goods.
- **Houses** — tent → log cabin → farmhouse → mansion. Each holds more, and
  everyone driving past can see how you are doing.
- **Farm level** — harvesting, selling and filling orders all earn XP. Levels
  unlock better crops, animals, workshops and land.

Rough pacing from the simulation in development: first car after about ten
minutes, a tractor after about forty, a farmhouse after a few hours, a mansion
after several evenings.

### The casino

Walk (or drive) through the doors north of the plaza. Same money as everything
else.

| Game | How it works | Return |
| --- | --- | --- |
| **Neon Sevens** slots | 5×4 grid, 1024 ways, wilds, free spins at double pay | 93.4% |
| **Blackjack** | Six decks, dealer stands on 17, 3:2 blackjack, animated deal | ~99.5% |
| **Roulette** | European, full felt — splits, streets, corners, six lines, dozens | 97.3% |
| **High / Low Dice** | Pick a target and a side; payout scales with your odds | 96% |
| **The Rocket** | Three rockets, independently rolled; back one, cash out in time | 97% |
| **The Track** | Six horses, live odds, a 15-second race | 90% |
| **The Scrapyard** | Two robots, one cage; odds measured from the fight engine | 94% |

A **casino event** starts every few minutes: HAPPY HOUR (slots pay double),
SEEING RED, LOADED DICE, ROCKET FUEL, PHOTO FINISH, LUCKY 21, ROBOT RAGE.

There is also a **cigar counter**. $150, does nothing, everyone can see it.

### The race track

Out past the back of the casino. A loop with kerbs, a grandstand and three
ramps. No timing, no rules — it is just somewhere to find out what the Hypercar
does off a ramp.

### The rich list

Net worth = cash + half the price of everything you own (vehicles, buildings,
animals, land, house) + your stored goods at market value. Shown top right, on
`Tab`, and on the big screen inside the casino. It includes offline farmers.

---

## How it fits together

```
server/
  app.js          the server as a library: startCasino() -> { urls, room, save, close }
  index.js        terminal entry point; reads the environment and prints the links
  room.js         sessions, money, shops, farming and driving messages, the casino
  farm.js         pure farm rules: tiles, storage, animals, workshops, new saves
  economy.js      the shared market (daily drift, saturation) and the orders board
  clock.js        world time and weather; only moves while the server runs
  save.js         atomic JSON saves with .bak recovery
  casino-events.js the rotating casino events
  games/          one module per casino game; outcomes decided here, never on a client
shared/
  catalog.js      every crop, item, building, vehicle and price, plus crop growth
  map.js          the valley: roads, shops, plots, track, ramps, stations, colliders
  config.js       casino tunables and the casino's station list
  roulette.js     the wheel and every legal bet on the felt
public/js/
  world.js        puts the scene together; spatial hash for collisions
  casino.js       the casino building, inside and out
  outdoor.js      ground, roads, town, shopkeepers, trees, streetlights, race track
  farmview.js     every farm: soil, instanced crops, buildings, animals
  vehicles.js     cars, tractor, implements and combine, built from boxes
  fleet.js        every vehicle in the world, parked or moving
  sky.js          sun, moon, stars, rain, lightning, indoor/outdoor lighting
  controls.js     walking, driving, ramps and collision
  ui/             one panel per shop, farm building and casino game
desktop/          Electron host app: runs the server in-process, shows the panel
```

The server is authoritative for everything that touches money: it checks you
are standing at the shop, that the tile is yours and within reach, that you
can afford it, and it rolls every casino outcome. Clients only decide where
their own feet (or wheels) are.

Crops cost nothing to simulate: each tile stores when it was planted and
watered, and growth is worked out from the world clock whenever someone looks.
That is also why offline farms keep growing and why stopping the clock is
enough to freeze the whole valley.

There are still no image, audio or font files in the project. Every texture is
drawn into a `<canvas>` at startup and every sound is synthesised.

## Development

```bash
npm run dev                       # restarts on file changes
TIME_SCALE=20 SAVE_DIR=./test-saves npm start   # 20x world clock, throwaway saves
```

The browser console exposes `window.casino` (`controls`, `world`, `fleet`,
`hud`, `worldTime()`…), so `casino.controls.pos.set(x, 0, z)` teleports you.

---

MIT licensed. Please gamble irresponsibly, it is not real money.
