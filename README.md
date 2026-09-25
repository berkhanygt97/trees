# 🌾 Harvest Royale: Turf — LAN

An open-world farming, restaurant and gang game you host from your own computer,
for 4–5 friends on the same Wi-Fi. Everyone opens a link, types a name, and gets
their own **neighbourhood**: a farm, a street of restaurant lots, a clubhouse,
a few houses and a park. They start with a small field, a bag of seeds and $500.

Farm it, cook what it grows in your own restaurants, and bank the takings.
Build the hood up: a bigger clubhouse, an armoury, walls, lookouts, palm trees
and a billboard. Everyone you hire joins your **gang**, and soldiers patrol your
streets with guns.

Because **rival gangs** come raiding. Los Coyotes, the Dust Devils MC and the
Neon Serpents roll up in a car, crack your tills, spray their name on your
walls, smash the place up and trample the crops — and if their car gets away,
so does your money. Stop them, get the bags back, scrub the tags off.

And when a neighbour gets too comfortable, **declare war**: six minutes to tag
their walls, crack their tills and get the money home, and down their gang.
The winner takes the pot and runs the loser's hood for a day.

It plays in the third person with a spring chase camera, real car physics
(suspension, drifts, jumps and crashes), jointed people who walk, run, aim
and fall, a rotating radar and a clock, money and health in the corner. It
is drawn the modern way: physically based materials, a real sky with a moving
sun, drifting clouds, stars and a moon, soft shadows, ambient occlusion,
bloom and light shafts, fog that thickens in the rain, trees and grass that
sway in the wind, lacquered cars with glass you can see through, and people
with sculpted faces, real eyes, hair and fingers. It picks its own settings
for your machine (see [Graphics](#graphics)). The town has its regulars too: the
pizza guy, an old timer, tourists in loud shirts, patrol cops, a federal agent,
bikers and a bouncer walk the pavements, and gang members come in flannels,
big sweaters, hoodies and twists. The casino, the race track, the boars
and everything from earlier versions are all still there.

**Everything is saved on the host's computer, one file per player.** Saves from
every earlier version load: your money, level, field, crops, buildings, animals,
workers, cars and restaurants all come across into your new hood (see
[Save files](#save-files)).

No installs for your guests, no accounts, no internet required once it is
running — everything, including three.js and the physics engine, is served off
your machine.

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
- **Settings**: how much money brand-new farmers start with, the port, and how
  rough the **rival gang raids** are: *relaxed* (rarer and weaker), *normal*
  (the richer a hood, the bigger the crew) or *hardcore*.
- **Firewall help** for your operating system.

Quitting always saves first. If people are still playing it asks before
kicking them out.

---

## Save files

```
Documents\Harvest Royale\saves\       (desktop app; `saves/` next to the server otherwise)
  world.json                          the clock, weather, market prices, orders,
                                      graffiti on the walls, who holds whose turf
  players\alice.json                  one file per farmer: money, field, house,
  players\bob.json                    animals, vehicles, restaurants, workers,
                                      gang name, hood upgrades and damage, armour
  backup-pre-v3\                      a copy of your saves as they were before 3.0
```

**Coming from 2.x?** The first time 3.0 loads older saves it copies them to
`backup-pre-v3\` (once; it never overwrites that copy), then moves every farm
into its own neighbourhood. Plot 1's farmer gets Palomino Row, plot 2's Dustbowl
Heights, and so on. The farm itself comes across exactly as it was — the same
field and crops, every building where you put it, the same animals, workers and
cars (cars parked on your old farm are on your new one). A restaurant on the
Sunset Strip moves to a lot of the same size on your own hood street, with its
menu, pantry, reputation and takings. Players without a farm keep their Strip
lot. Your gang gets a name from your own (rename it at the clubhouse).

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

Built for 4–5 players; there are six hoods, so a new name can still turn up and
get one. A seventh farmer can still play: no hood, but the casino, the track, a
restaurant on the Sunset Strip and the hospital are all theirs.

### If someone's Wi-Fi drops

Their game notices and quietly reconnects on its own, back where they were. If
the host has not noticed yet that the old connection died, the new one simply
takes it over (it is the same browser), so nobody sees "already playing".
The server also tolerates a few missed heartbeats before giving up on anyone.

The network load is small: player positions go out 15 times a second, boars and
gang members 10 times a second, and a player whose connection is struggling
simply skips a position update rather than falling further behind. Workers and restaurant
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
| `W` `A` `S` `D` | Walk / drive (you walk where the camera looks) |
| `Shift` · `Space` | Sprint · jump (handbrake when driving) |
| Mouse | Look (click to capture the pointer) |
| `E` or left click | Use what you are standing at, or **farm the tile you are looking at** — hold it and walk along a row |
| hold `E` | Scrub a rival's tag off your wall · at war: tag their wall, crack their till, smash a building |
| `1`–`7`, mouse wheel | Pick a seed |
| `Q` | Get your gun out / put it away |
| Left click · right click | With the gun out: fire (hold for the machine pistol) · aim over the shoulder |
| `R` · `T` | Reload · switch to your next gun |
| `F` | Get in / out of your vehicle |
| `V` | Third person (the default) or first person — on foot and in the car |
| `G` | Swap the tractor's implement |
| `Esc` (or `Q`) | Leave a shop or table |
| `Tab` | Rich list and your storage |
| `P` | Graphics: Auto → Ultra → High → Medium → Low |
| `F3` | Frame rate, draw calls, the graphics setting and render scale |
| `H` | Help |
| `C` | Smoke your cigar |
| `M` | The map: wheel to zoom, drag to move, click to set a waypoint |
| `N` | Mute |

---

## The valley

```
                        North Boulevard
   +-------------------------------------------------------+
   |  Dustbowl        |    VALLEY SPEEDWAY    |  Magnolia    |
   |  Heights  ====== W                       E ===== Gardens |
   |                  e    CASINO ROYALE      a              |
   |  Palomino ====== s  plaza · Sunset Strip s ===== Orchard |
   |  Row             t    main street        t       Park   |
   |                  |  shops · Job Centre   |              |
   |  Cactus   ====== A  hospital · motels    A ===== Sunnyside|
   |  Flats           v    farm road          v              |
   +-------------------------------------------------------+
                        South Boulevard          (hills and mountains all round)
```

Downtown is where it always was: the casino, the plaza, the shops on main
street, the Sunset Strip and the speedway, now with office towers, a hotel, a
bank, the County General hospital, motels and a gas station. A ring of avenues
runs round it, and off the ring six neighbourhood streets run out into the
hills, three to the west and three to the east.

### Your hood

Each farmer runs one neighbourhood (the one their old plot became, for older
saves). Its street runs from the arch with your gang's name on it past:

- **your farm**: the same 70 m plot, gate onto the street;
- **five restaurant lots** either side of the street (two small, two medium, one
  large), bought at the Land Office;
- **your clubhouse** at the end nearest downtown: upgrades, your gang's name,
  repairs, and where you declare war (walk up to the door and press `E`);
- **six houses**, a **park**, and **four walls** your gang's name is sprayed on.

**The clubhouse** sells the upgrades:

| Upgrade | Levels | What it does |
| --- | --- | --- |
| Clubhouse | 1–4 | room for 2, 4, 6, 8 soldiers; at 3 you come round wearing a vest |
| Armoury | 0–3 | your gang carries pistols, then machine pistols, then rifles; every worker fights back in a raid |
| Walls & Gates | 0–3 | your buildings take 20% less damage per level |
| Lookouts & CCTV | 0–2 | earlier warning of a raid (20 s, 45 s, 75 s), raiders shown on your radar wherever they are |
| Safes | 0–3 | tills take longer to crack and give up less (60% → 30%) |
| Streetscape | 0–3 | palm trees, then strings of lights, then planters: 15% more customers per level |
| Billboard | 0–1 | your gang's billboard out on the avenue: 10% more customers |
| Do Up the Houses | 0–2 | picket fences and awnings, and rent every morning ($900, then $2,400; smashed-up houses do not pay) |

**Buildings get knocked about** by raiders and rival gangs. A restaurant under
half health loses customers; at zero it is **wrecked** and shut until you pay to
fix it. Repairs cost a share of what the building is worth, and "repair all" at
the clubhouse is 10% cheaper.

**Your gang** is everyone you hire: they all wear your colours. Hire
**soldiers** at the Job Centre (the clubhouse decides how many); while you are
in the valley they patrol your street and the park with guns, and fight anyone
who comes looking for trouble. A gang member who goes down is back from the
hospital a couple of in-game hours later.

### Rival gangs

Once your hood is worth robbing (farm level 4, with a restaurant or $30,000 to
your name), the rival gangs start paying visits — **only while you are in the
valley**. The first comes about 12 minutes after you arrive, then one every
16–26 minutes or so. The richer you are, the bigger the crew (two to seven, with
better guns); the host can make them rarer or rougher in the desktop app.

| Gang | Colours | Drives |
| --- | --- | --- |
| **Los Coyotes** | orange, bandanas over their faces | a muscle car |
| **Dust Devils MC** | leather vests, beards | a pickup |
| **Neon Serpents** | teal tracksuits | a coupe |

You get a warning (and the skulls in the corner) while their car comes down the
avenue and into your street. Then they pile out and go to work:

- **crack the fullest tills** — the money goes into a bag and they head back to
  the car with it;
- **spray their name** on the nearest wall — every rival tag costs you 5% of
  your customers until you scrub it off (hold `E` at the wall);
- **smash up** your restaurants, clubhouse and houses;
- **trample your crops**.

Your soldiers fight. With an armoury, so does everyone on the payroll; without
one, workers shelter in the clubhouse. Customers run for it. **Drop a raider
carrying a bag and it lands where they fell** — walk over it and the money goes
back in the till. If the car drives off with a bag, that money is gone. Every
raider you drop pays a bounty, and seeing the whole raid off pays a big one.

Money is never made or lost any other way: bags that are still in the street
when the raid ends, or when the host shuts down, go back in their tills.

### Gang wars

At your clubhouse you can **declare war** on another boss who is online. It
costs a fee (2% of your net worth, at least $1,000) that goes into the pot. You
cannot pick on someone three or more levels below you, you have to wait 20
minutes between declarations, and a gang that just lost (or won) is left alone
for a while.

A minute's warning, then **six minutes fighting over the defender's hood**. The
attacker's soldiers roll up at the end of the street. Only the two sides can
hurt each other: nobody else is ever caught in it.

| The attacker scores for | Points |
| --- | --- |
| tagging a wall (hold `E` at it; not with a defender right there) | +3, then +1 every 30 s it stays up |
| cracking a till (hold `E` at the counter) and getting the bag home to your clubhouse | +1 per $500 |
| wrecking a building (hold `E` at its door) | +2 |

Both sides score **+2 for wasting the other boss** and **+1 for downing one of
their gang**. The defender scrubs tags, picks up dropped bags, and fights. A
tie goes to the defender; either side can give up.

**The winner takes the pot and holds the loser's hood for a day**: 20% of what
its restaurants take goes to them, and the hood shows their colours on the
radar. If a boss leaves mid-war, they have a minute to come back; after that
the war ends — a win for the other side if the one who left was behind.

### Getting hurt

Boars, raiders and rivals at war can all hurt you. Health comes back on its own
after a few seconds out of trouble. A **vest** from Rusty's soaks up 60% of
every hit until it is shot to pieces (the white bar under your health). At zero
you are **wasted**: a few seconds later you come round at your clubhouse (or
the farm gate, if the clubhouse is being fought over; the hospital if you have
no hood), safe for a moment. You lose nothing — except any bag of money you
were carrying, which drops where you fell.

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
| **Land Office** | field expansions: 8×8 → 12×12 → 16×16 → 20×20, and the restaurant lots on your street |
| **Tractor Barn** | tractor, plow, seeder, water tank, combine harvester |
| **Motors** | eight cars from a $1,500 Rust Bucket to a $220,000 Hypercar, including the Midlife Crisis T-Top (quad lamps, bonnet scoop, lift-out roof) |
| **Rusty's Guns** | better guns than Grandpa's, a 9mm, a machine pistol and bulletproof vests (see below) |
| **Job Centre** | hired hands for the farm, the restaurants and your gang (see below) |

Cluck & Moo also sells a **Cattle Pen** and beef steers (for burgers).

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
| Cook · Waiter · Delivery driver | run a restaurant (see below); pick which one |
| Soldier | patrols your hood with a gun while you are online, and fights |

Workers keep working **whenever the host is running**, even while you are away.
Wages come out every morning; anyone you cannot pay takes the day off (they do
not quit). Your house decides how many farm hands you can have: 1 in a tent, 2
in a cabin, 4 in a farmhouse, 6 in a mansion; your clubhouse decides how many
soldiers (2, 4, 6, 8). Manage them from the **Staff** button at your house or
restaurant: rename, reassign, or let them go. Everyone on the payroll wears
your colours. In a raid they fight (with an armoury) or shelter in the
clubhouse, and go back to work when it is over.

### Restaurants

Your hood street has five restaurant lots: small corner spots ($15,000, 4
tables), medium units ($35,000, 8) and one large lot ($80,000, 12). Buy one at
the **Land Office** from farm level 4 and pick what it is; you can run a second
from level 6, and more at 8, 10 and 12. (Farmers without a hood use the eight
lots on the **Sunset Strip**, east of the plaza.)

| | Dishes | Needs |
| --- | --- | --- |
| 🍔 **Burger Joint** | burgers, fries, veggie burgers, cheeseburgers, shakes | flour, beef or boar, tomatoes, potatoes, cheese, milk |
| 🍕 **Pizzeria** | soup, wedges, harvest pizza, margherita, wild boar pizza, pumpkin special | flour, tomatoes, corn, cheese, pumpkins, meat |
| 🥐 **Bakery Café** | toast & eggs, coffee, tarts, carrot cake, cake | bread, eggs, milk, flour, strawberries, carrots, cake |

A dish sells for about 1.8× what its ingredients fetch at the market. Stock the
**pantry** from your farm storage at the counter (or leave auto-stock on). If
you run short, the wholesaler will sell you ingredients at 1.5× market price.

**Takings go into the till**, not your pocket. Tills are banked automatically
every four in-game hours, or hit **BANK IT** at the counter. A full till is what
raiders come for (see [Rival gangs](#rival-gangs)); safes make it harder. Money
paid for a delivery you ride out yourself goes straight into your pocket.

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
(a house on your street or someone else's, a clubhouse, a farm gate, the
casino…). Ride there
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

Bullets hit boars and rival gangs, and other players only when you are at war
with them. Walls stop bullets. Ammo is free; you just have to reload.

| Gun | Price | Level | Damage | Rounds | Notes |
| --- | --- | --- | --- | --- | --- |
| Grandpa's Bolt Rifle | free | 1 | 55 | 5 | 1.7 s to work the bolt |
| Lever-Action .30 | $2,500 | 3 | 50 | 8 | twice as quick |
| Pump Shotgun | $4,500 | 4 | 8 × 17 | 6 | brutal up close, useless past ~30 m |
| Semi-Auto Rifle | $9,000 | 6 | 40 | 15 | as fast as you can click |
| Big Game Rifle | $18,000 | 8 | 170 | 4 | with a scope |
| 9mm Pistol | $900 | 2 | 26 | 12 | quick and light |
| Machine Pistol | $7,500 | 5 | 15 | 30 | hold the trigger |
| Bulletproof vest | $600 | 2 | — | — | soaks up 60% of every hit until it is gone |

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

Every car has real physics: springs, grip, weight transfer, handbrake drifts
(`Space`), air off the ramps, and crashes that crunch and spill deliveries.
Parked and passing cars are solid; bins and hydrants go flying. The chase
camera swings wider as you speed up; `V` puts you in the driver's seat with a
dashboard, working dials and your hands on the wheel. (If a laptop cannot run
the physics engine, the game falls back to the old simpler driving by itself.)

### The rich list

Net worth = cash + half the price of everything you own (vehicles, buildings,
animals, land, house) + your stored goods at market value. Shown on `Tab` and
on the big screen inside the casino. It includes offline farmers.

### On screen

Top right, the way you remember it: your weapon (or your fist) with rounds
left, the clock, health and armour, and your money. Skulls under it while your
hood is raided, or you are at war. Bottom left, the **radar** turns with you:
hoods tinted in their owners' colours, other players, your clubhouse (**H**),
your restaurants (**R**), delivery doors, raiders, dropped bags of money (**$**).
The name of the place you walk into appears in the corner.

**`M` opens the map**: the whole valley, north up, with every hood's name and
the gang that runs it, the landmarks, and everything the radar shows. Wheel to
zoom in on the cursor, drag to move around. **Click to set a waypoint**: a pink
flag with a dotted line from you and how far it is. It stays on your radar,
pinned to the rim while it is out of range, until you get within 10 m of it.
Click the flag again (or right-click) to take it away. The game keeps going
while the map is up, and `M` or `Esc` takes you back.

### Graphics

`P` cycles the graphics setting; the choice is remembered per browser.

| Setting | For | What changes |
|---|---|---|
| **Auto** (default) | everyone | Starts on High and steps down while the game can't hold about 45 fps |
| Ultra | a dedicated graphics card | 1.5× resolution, 4096 shadows over 160 m, ambient occlusion, light shafts, 60k grass blades, 8 lamps |
| High | recent laptops | 2048 shadows, ambient occlusion, SMAA, 30k grass blades, 4 lamps |
| Medium | older laptops | 1024 shadows, FXAA, 12k grass blades, 2 lamps, a shorter view |
| Low | anything | No shadows, grass or ambient occlusion; the textures and sky stay |

On every setting, **dynamic resolution** draws the world a little smaller
when a frame runs late and sharpens it back up to the screen, to hold about
58 fps. `localStorage['valley.dynres'] = '0'` turns it off. Each guest's own
computer draws their game, so a slow laptop at the party only changes
things for that guest.

**Photo textures (optional).** The game makes all its own textures when it
starts. For real photos of asphalt, paving, brick, plaster, roof tiles,
corrugated iron, planks, gravel, dirt, grass, rock and sand (free CC0 scans
from [Poly Haven](https://polyhaven.com)), run this once on the host, with
internet:

```bash
npm run textures          # about 25 MB, into public/assets/cc0/
npm run textures -- --2k  # sharper, about 90 MB
```

Restart the game and every guest gets them from the host. Delete the folder
to go back to the generated ones.

---

## How it fits together

```
server/
  app.js          the server as a library: startCasino() -> { urls, room, save, close }
  index.js        terminal entry point; reads the environment and prints the links
  room.js         sessions, money, shops, farming and driving messages, the casino
  farm.js         pure farm rules: tiles, storage, animals, workshops, new saves
  migrate.js      brings saves from every older version up to date (3.0: into the hoods)
  legacy/         the 2.x map, frozen, so old positions can be moved exactly
  economy.js      the shared market (daily drift, saturation) and the orders board
  clock.js        world time and weather; only moves while the server runs
  save.js         atomic JSON saves with .bak recovery, and the pre-3.0 backup
  casino-events.js the rotating casino events
  boars.js        boar raids and charges
  combat.js       gang members and raiders: AI, and every gunshot, judged in one place
  ballistics.js   rays, spheres, spread and lag compensation
  colliders.js    walls for bullets and line of sight
  hoods.js        clubhouse upgrades, gang names, building damage and repairs, rent
  raids.js        rival gang raids: the car, the crew, tills, bags, tags
  wars.js         gang wars: declaring, scoring, turf, cooldowns
  workers.js      hired hands: job board, wages, and their jobs through the farm rules
  restaurants.js  restaurants: customers, orders, pantry, tills, levels, deliveries
  games/          one module per casino game; outcomes decided here, never on a client
shared/
  catalog.js      every crop, item, building, vehicle, gun, upgrade and price
  map.js          the valley: downtown, shops, plots, lots, track, ramps, stations, colliders
  hoods.js        the six neighbourhoods, built from one template
  roads.js        every road, and the way raiders drive in
  terrain.js      the hills: one height function the server, client and physics share
  downtown.js     downtown's newer buildings (hospital, towers, motels, gas station)
  config.js       tunables, raid difficulty, and the casino's station list
  looks.js        the town's cast: named gang, civilian, law and tough-guy looks
public/js/
  world.js        puts the scene together; spatial hash for collisions
  camera.js       the third-person camera (over the shoulder, chase cam, first person)
  character.js    jointed people: one skinned mesh and one painted atlas each, procedurally animated
  physics/        Rapier: the world, every vehicle's tuning and its raycast suspension
  city/           terrain, roads, hoods, downtown, street props, the light pool
  casino.js       the casino building, inside and out
  outdoor.js      the wider valley: shops, shopkeepers, trees, streetlights, track
  farmview.js     every farm: soil, instanced crops, buildings, animals
  vehicles.js     cars, tractor, implements and combine
  fleet.js        every vehicle in the world, parked or moving
  sky.js          sun (with shadows), moon, stars, rain, lightning, fog and draw distance
  controls.js     walking, driving (physics or the simple fallback) and collision
  post.js         the renderer: HDR, ambient occlusion, bloom, light shafts, tone mapping, anti-aliasing, sharpening
  gfx/            graphics settings (quality.js), sky and fog (atmosphere.js), reflections (env.js),
                  materials and generated surfaces, photo textures, terrain blending, trees, grass
  batcher.js      merges everything that never moves, per material per patch of ground
  radar.js        the rotating radar, and the full-screen map drawn from the same picture
  mapview.js      the map screen (M): zoom, drag and your waypoint
  unitsview.js    gang members and raiders, between the server's snapshots
  raidview.js     raid cars and dropped bags of money
  avatar.js       your farmer and your first-person hands
  guns.js · weapons.js  every gun; aiming, firing, recoil, tracers
  cockpit.js      dashboards, instrument clusters and the steering wheel
  people.js       townsfolk: crowd looks dressed as characters, their poses and what they carry
  gallery.js      /gallery.html: the cast and every car side by side
  workersview.js · npcs.js · crowd.js  hired hands, customers, passers-by
  restaurantview.js restaurants inside and out, cottages
  boarsview.js    boars on screen, between the server's snapshots
  ui/             one panel per shop, farm building, casino game and the clubhouse
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
everything was on your screen a moment ago (your view is always about a tenth
of a second behind) as well as where it is now: boars, gang members, and at
war the other side. The first wall in the way stops it. Gang members and
raiders are simulated on the host; they shoot by an honest roll that gets
worse with range, with you running, and with you in a car.

Your car is simulated on your own screen with the Rapier physics engine
(springs, grip, crashes) and its position is sent to everyone else, where it is
a solid moving body in their physics. The ground is the same terrain function
everywhere, so nobody's car floats or sinks.

There are no image, audio or font files in the project. Every texture is
drawn into a `<canvas>` at startup (unless you fetch the optional photo
textures, see [Graphics](#graphics)) and every sound is synthesised.

## Development

```bash
npm run dev                       # restarts on file changes
TIME_SCALE=20 SAVE_DIR=./test-saves npm start   # 20x world clock, throwaway saves
RAID_MODE=hardcore npm start      # relaxed | normal | hardcore
npm test                          # every rule, save migration, physics, raids and wars
npm run test:smoke                # loads the real game in headless Chromium and screenshots it
```

Open `http://localhost:3000/gallery.html` to see the whole cast and every car
without playing: `#cast`, `#faces`, `#cars`, or `#look=biker` for a turntable
(arrow keys change who, dragging turns them; add `&close` for a close-up).
`SMOKE_GFX=ultra npm run test:smoke` takes the screenshots on another graphics
setting (Medium by default).

The browser console exposes `window.casino` (`controls`, `world`, `fleet`,
`hud`, `units`, `physics`, `worldTime()`…), so `casino.controls.pos.set(x, 0, z)`
teleports you. `localStorage['valley.physics'] = 'simple'` turns the physics
off for a slow machine.

---

MIT licensed. Please gamble irresponsibly, it is not real money.
