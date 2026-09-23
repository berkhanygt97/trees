# 🌾 Harvest Royale — LAN

A first-person farming game you host from your own computer, with a casino in
town. Everyone on the same Wi-Fi opens a link, types a name, and gets their own
farm in the valley. They start with a small field, a bag of seeds and $500.

Plow, plant, water and harvest by hand. Sell at the market. Save up for a
tractor, a combine, chickens and cows, a windmill and a bakery, a bigger house,
and a car that is far too fast for a farm road. Or skip all that and put the
lot on red.

Every so often **wild boars** come out of the woods and start eating your crops.
Grandpa left you a slow old bolt rifle; Rusty's Guns in town sells better ones.

Once the farm is going: **plan it** (move and turn every building and the field),
**hire hands** at the Job Centre to farm it for you, and open a **burger joint,
pizzeria or bakery café on the Sunset Strip**. Your restaurant cooks with what
your farm grows, customers walk in off the street, and from level 3 the phone
rings with delivery orders to ride out on your scooter.

It all looks like a 2004 console game on purpose: dusty San Andreas days, pink
Vice City sunsets and neon nights, low-poly and light enough for an old laptop.

**Everything is saved on the host's computer, one file per player.** Come back
tomorrow with the same name and your farm is exactly where you left it. Saves
from every earlier version load as they are: money, fields, buildings, cars and
guns all come across, and every building stays exactly where it was.

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

### If someone's Wi-Fi drops

Their game notices and quietly reconnects on its own, back where they were. If
the host has not noticed yet that the old connection died, the new one simply
takes it over (it is the same browser), so nobody sees "already playing".
The server also tolerates a few missed heartbeats before giving up on anyone.

The network load is small: player positions go out 20 times a second, boars 10
times a second, and a player whose connection is struggling simply skips a
position update rather than falling further behind. Workers and restaurant
customers are never streamed: each gets one short message when they start
walking somewhere, and every screen walks them there itself. Casino regulars
and people on the street cost nothing at all (every screen works out the same
crowd from the clock). With four players, 24 workers and three busy
restaurants, each player receives about 5 KB a second. Shots and money are
decided on the host, so nobody can cheat by editing their browser.

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
| `Q` | Get your gun out / put it away |
| Left click · right click | With the gun out: fire · aim down the sights |
| `R` · `T` | Reload · switch to your next gun |
| `F` | Get in / out of your vehicle |
| `V` | Driver's seat or chase camera |
| `G` | Swap the tractor's implement |
| `Esc` (or `Q`) | Leave a shop or table |
| `Tab` | Rich list and your storage |
| `P` | Graphics: PS2 (soft) → Sharp → Potato |
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
| **Rusty's Guns** | four better guns than Grandpa's (see below) |
| **Job Centre** | hired hands for the farm and the restaurant (see below) |

Cluck & Moo also sells a **Cattle Pen** and beef steers (for burgers), and the
Land Office sells the **restaurant lots** on the Sunset Strip.

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

### Planning your farm

Your house has a **Plan my farm** button. It opens a blueprint of your plot:
drag any building, the shipping bin or the whole field to a new spot, and `R`
turns the selected building a quarter turn. Anything the builders would refuse
goes red: outside the fence, in the lane from the gate, overlapping, or on the
dashed square the field can grow to. They charge $100 for each thing they move.
Crops move with the field. Everyone sees your new layout straight away.

### Hired hands

The **Job Centre** at the south end of main street has six people looking for
work every morning. Each has a **speed** (0.6× to 1.6×), a **trait** (early bird,
night owl, keen, easy-going, green thumb…) and a daily **wage** that goes up
with speed. Give them a name when you hire them, and rename them any time.

| Job | What they do |
| --- | --- |
| Field hand | plows, plants the crop you pick (buys seed when you run out, if you let them), waters, harvests |
| Animal keeper | keeps the troughs full and collects eggs, milk and beef |
| Workshop hand | loads the mill, dairy and bakery and empties them |
| Seller | ships your goods to market twice a day, at 90% |
| Cook · Waiter · Delivery driver | run your restaurant (see below) |

Workers keep working **whenever the host is running**, even while you are away.
Wages come out every morning; anyone you cannot pay takes the day off (they do
not quit). Your house decides how many farm hands you can have: 1 in a tent, 2
in a cabin, 4 in a farmhouse, 6 in a mansion. Manage them from the **Staff**
button at your house or restaurant: rename, reassign, or let them go.

### The Sunset Strip

A palm-lined boulevard east of the plaza with eight restaurant lots: corner
spots ($15,000, 4 tables), strip units ($35,000, 8) and boulevard lots ($80,000,
12). Buy one at the **Land Office** from farm level 4 and pick what it is:

| | Dishes | Needs |
| --- | --- | --- |
| 🍔 **Burger Joint** | burgers, fries, veggie burgers, cheeseburgers, shakes | flour, beef or boar, tomatoes, potatoes, cheese, milk |
| 🍕 **Pizzeria** | soup, wedges, harvest pizza, margherita, wild boar pizza, pumpkin special | flour, tomatoes, corn, cheese, pumpkins, meat |
| 🥐 **Bakery Café** | toast & eggs, coffee, tarts, carrot cake, cake | bread, eggs, milk, flour, strawberries, carrots, cake |

A dish sells for about 1.8× what its ingredients fetch at the market. Stock the
**pantry** from your farm storage at the counter (or leave auto-stock on). If
you run short, the wholesaler will sell you ingredients at 1.5× market price.

Customers walk in off the pavement, sit down and order **only what the pantry
can make**. Cook and serve at the counter yourself, or hire a cook and a
waiter. Wait too long and they walk out, and your reputation drops. Set prices
between 80% and 150%: dearer means fewer customers.

Restaurants level up by dishes served:

| Level | Unlocks |
| --- | --- |
| 2 | more tables, more staff, more dishes |
| 3 | **phone orders**: ride them out on your free delivery scooter |
| 4 | more dishes and tables, potted palms |
| 5 | VIP customers who pay double, and a neon outline on the front |

**Deliveries.** Take an order at the counter and a pink beacon marks the door
(a cottage on the farm road, somebody's farm gate, the casino…). Ride there
before the timer runs out: the faster you are, the bigger the tip. Crash hard
on the way and the food gets thrown about, which halves the tip. Late orders
pay half. A hired driver takes the orders you leave for 25 seconds.

You can **refit** into another kind of restaurant for a quarter of the lot price.

### City life

The casino has regulars now: they come in through the doors, play the slot
machines and the tables, drink at the bar, watch the rocket and the horses,
and cheer the odd win. More at night. People stroll down main street, round
the plaza and along the Strip.

### Wild boars

While you are online and have crops in the ground, a herd raids your field
every 7–13 minutes or so (the first one waits at least 6 minutes after you
arrive). They trot out of the woods behind your plot, eat a tile at a time, and
leave once they are full or have been at it for a couple of minutes.

- **Get close and one will charge.** It paws the ground and grunts first — that
  is your warning — then runs at you in a straight line. **Step sideways** and
  it thunders past. Only one boar goes for a given farmer at a time.
- **Shoot one** and it comes for you, even from across the field.
- **Hits hurt.** Health comes back on its own after a few seconds out of
  trouble. At zero you are knocked flat and wake up at your gate a few seconds
  later. You lose nothing.
- **A kill pays** a bounty, XP and boar meat (which sells at the market).
  Headshots do double damage. Running one over with any vehicle works too.
- **They grow with your farm.** Stats by farm level:

| Farm level | Boars per raid | Health | Hit | Bounty |
| --- | --- | --- | --- | --- |
| 1 | 2 | 100 | 14 | $55 |
| 5 | 3 | 180 | 22 | $115 |
| 10 | 4 | 280 | 32 | $190 |
| 15 | 5 | 380 | 42 | $265 |

There is no friendly fire: bullets only hit boars. Ammo is free; you just have
to reload.

| Gun | Price | Level | Damage | Rounds | Notes |
| --- | --- | --- | --- | --- | --- |
| Grandpa's Bolt Rifle | free | 1 | 55 | 5 | 1.7 s to work the bolt |
| Lever-Action .30 | $2,500 | 3 | 50 | 8 | twice as quick |
| Pump Shotgun | $4,500 | 4 | 8 × 17 | 6 | brutal up close, useless past ~30 m |
| Semi-Auto Rifle | $9,000 | 6 | 40 | 15 | as fast as you can click |
| Big Game Rifle | $18,000 | 8 | 170 | 4 | with a scope |

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

You drive from the driver's seat: a dashboard, a working speedometer and rev
counter (the tractor gets its own farm-style gauges), and your hands on a wheel
that turns. `V` swaps to a chase camera with the same dials on screen.

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
  boars.js        boar raids, charges and every gunshot, judged in one place
  workers.js      hired hands: job board, wages, and their jobs through the farm rules
  restaurants.js  the Sunset Strip: customers, orders, pantry, levels, deliveries
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
  post.js         the PS2 look: low-res render, colour grade, dither; hands drawn on top
  avatar.js       farmer avatars and your first-person hands
  guns.js         every gun, built from boxes with wood and steel textures
  weapons.js      your gun: aiming, firing, reloading, recoil, tracers
  cockpit.js      dashboards, instrument clusters and the steering wheel
  people.js       low-poly townsfolk: five draw calls a person
  workersview.js  hired hands, played back from their job events
  npcs.js         restaurant customers and crowds, walked along their paths
  crowd.js        casino regulars and passers-by, the same on every screen
  restaurantview.js the Strip: restaurants inside and out, cottages
  palms.js · neon.js palm trees; neon glow
  boarsview.js    boars on screen, between the server's snapshots
  ui/             one panel per shop, farm building and casino game
                  (planner.js: the farm blueprint; jobs.js: hiring and staff;
                   restaurant.js: the counter)
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

Gunshots are judged on the host too: it checks the shot came from where you are
standing, that the gun was ready and loaded, and then traces it against where
each boar was on your screen a moment ago (your view is always about a tenth of
a second behind) as well as where it is now.

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
