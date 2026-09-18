# 🎰 Casino Royale — LAN

A browser-based first-person casino party game you host from your own computer.
Everyone on the same Wi-Fi opens a link, picks a name, and walks into a casino as
a small idiot with a big head. Ten-minute rounds. Everybody starts with the same
stack. **Biggest profit when the bell rings wins the room.**

No installs for your guests, no accounts, no internet required once the server is
running — everything, including three.js, is served off your machine.

---

## Two ways to run it

**The desktop app** is the one to use at a party. It is a normal application —
double-click it, and it shows you the link to hand around the room. No terminal,
no `npm`, and your guests still need nothing but a browser.

**The plain server** is the same game started from a terminal. Use it if you
already have Node installed and would rather not build an app.

Either way, only the *host* installs anything. Guests open a link.

---

## The desktop app

### Running it from source

```bash
npm install
npm run desktop
```

### Building an installer to double-click

```bash
npm run build:win      # portable Windows app in dist/
```

The finished app lands in `dist/` as a zip: unzip it anywhere and run
`Casino Royale.exe`. The first build downloads electron-builder, so it needs an
internet connection; after that the app itself never does.

(`build:mac` and `build:linux` still exist and still work, but Windows is the
only build that gets shipped.)

### What the host app gives you

When it opens you get a control panel:

- **The link to hand out**, in big gold text with a Copy button. If your machine
  is on more than one network you get one link per network, so you can pick the
  one your guests are actually on.
- **Play in a new window** — the host plays in the app itself, in a second
  window, so the panel stays visible.
- **The floor**: round number, time left, the current event, and a live
  leaderboard of everyone in the casino including what they have borrowed.
- **Table rules** you can change between games — round length, starting stack,
  loan size, port — with one button to apply them and restart.
- **Firewall instructions for your operating system**, because that is what is
  wrong the one time nobody can connect.

If port 3000 is busy, it quietly tries 3001, 3002 and so on, and tells you which
one it settled on. Quitting while people are still playing asks you to confirm.

---

## Hosting over your local network

1. **Put everyone on the same network.** Same Wi-Fi, or a mix of Wi-Fi and
   Ethernet on the same router. It does not need internet access — a router with
   no uplink works fine.
2. **Start the host** (the desktop app, or `npm start`).
3. **Read off the link.** It looks like `http://192.168.1.42:3000`. That number
   is your machine's address on the network; only devices on that network can
   reach it.
4. **Guests open it in a browser.** Chrome, Edge, Firefox or Safari. Nothing to
   install, no account, no internet needed.
5. **Leave the host running.** Close it and the casino closes with it.

### If nobody can connect

Work down this list — it is almost always the first item.

- **The host firewall is blocking it.** The desktop app prints the right steps
  for your OS on its front page. From a terminal:
  - *Windows* — the first time you host, Windows asks whether to let Node.js
    communicate on the network. Tick **Private networks** and allow. If you
    dismissed it: Windows Security → Firewall & network protection → Allow an app
    through firewall → **Node.js** → tick Private.
  - *macOS* — System Settings → Network → Firewall → Options → allow incoming
    connections for the app (or `node`).
  - *Linux* — `sudo ufw allow 3000/tcp`, or
    `sudo firewall-cmd --add-port=3000/tcp`.
- **It is a guest network.** Guest and public Wi-Fi usually turn on "client
  isolation", which blocks devices from talking to each other. Use the main
  network, or a phone hotspot.
- **You handed out the wrong address.** `localhost` and `127.0.0.1` only ever
  mean "this machine" — they will never work from another device. If the host
  shows several addresses, try each; the right one usually starts `192.168.`
  or `10.`.
- **VPN on the host.** A VPN can capture the connection before it reaches your
  LAN. Turn it off while hosting.
- **The port is taken.** Change it in the app, or `PORT=3001 npm start`.

### How many people?

The server is comfortable with a dozen or so players — it sends about 15 small
position updates a second per person, which is nothing for a home network. The
limit in practice is how many people you can fit around one screen each.

---

## The plain server

```bash
npm install          # once
npm start
```

It prints the links:

```
  ♠ ♥  C A S I N O   R O Y A L E   —   L A N   ♦ ♣
  ------------------------------------------------
  On this machine : http://localhost:3000
  For your guests : http://192.168.1.42:3000
  ------------------------------------------------
```

Needs Node 18 or newer.

### Tuning the night

Set environment variables before `npm start` (the desktop app has these as
fields instead):

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Port to serve on |
| `ROUND_MINUTES` | `10` | Length of a round |
| `INTERMISSION_SECONDS` | `25` | Podium time between rounds |
| `START_CASH` | `2000` | Everyone's starting stack |
| `LOAN_AMOUNT` | `400` | Size of one bankruptcy loan |

```bash
ROUND_MINUTES=5 START_CASH=1000 npm start     # short, tense rounds
PORT=8080 npm start
```

Rounds run back to back forever. Players can join and leave at any time; anyone
who joins mid-round gets a full starting stack and a profit of zero, so they are
never behind — just short on time.

---

## Controls

| | |
| --- | --- |
| `W` `A` `S` `D` | Walk |
| `Shift` | Sprint |
| `Space` | Jump |
| Mouse | Look (click the floor to capture the pointer) |
| `E` | Play whatever you are standing at |
| `Q` / `Esc` | Leave the table |
| `1`–`6` | Pick your chip size while at a table |
| `Tab` | Full standings |
| `C` | Take a draw on your cigar |
| `M` | Mute |

Each game also has its own shortcuts, shown on the buttons — `Space` to spin,
deal, or cash out; `H`/`S`/`D` for hit, stand, double; `R`/`B` for red and black.

---

## What's on the floor

| Game | Where | How it works | Return |
| --- | --- | --- | --- |
| **Neon Sevens** slots | Left wall, 8 machines | 5×4 grid, **1024 ways to win**. Wilds on reels 2–5 substitute for anything; three or more scatters buys **8 free spins at double pay**, and they retrigger. | 93.4% |
| **Blackjack** | Right wall, 4 tables | Six-deck shoe, dealer stands on all 17s, blackjack pays 3:2, double on your first two. Cards are **dealt one at a time from the shoe**, hole card turned at the end. | ~99.5% with good play |
| **Roulette** | Centre-front | European single zero with the **full felt** — straights, splits, streets, corners, six lines, columns, dozens and the zero trios. A live wheel in the panel shows the ball land. | 97.3% |
| **High / Low Dice** | Either side of the entrance | Roll 0.00–99.99, pick a target and a side. Payout scales with your odds. | 96% |
| **The Rocket** | Centre of the floor | **Three rockets launch together**, each with its own independently rolled crash point. You back one and watch all three climb — on the jumbotron, on a live chart in the panel, and as actual rockets flying up out of the lounge. | 97% |
| **The Track** | Back of the room | Six runners, live odds, a 15-second sprint down six lanes. | 90% |
| **The Scrapyard** | Left of the floor | **Two robots, one cage.** Fresh stats every bout, live HP bars and blow-by-blow commentary. Odds are Monte-Carloed from the same engine that runs the fight, so they are measured rather than guessed. | 94% |

There is also a **cigar counter** by the door. A cigar costs $150, does nothing
whatsoever, lasts 12 puffs, and is visible to everyone in the room. Press `C`
anywhere on the floor to take a draw. The money comes straight off your profit,
which is the joke.

Every result is rolled on the server with `crypto`-grade randomness, and the
payout maths is verified by simulation — the return rates in that table are
measured over hundreds of thousands to millions of rounds, not estimated. The
slot paytable and the robot odds in particular were *fitted* against those
simulations rather than guessed at.

## Scoring

```
profit = money in hand − starting stack − everything you borrowed
```

That is the only number the leaderboard cares about. Sitting on your stack
finishes at exactly zero, which will lose to anyone who got lucky once.

**The bankruptcy ATM.** Two of them by the entrance. Drop below $150 and you can
borrow $400, once every 30 seconds. It keeps you gambling, but every borrowed
dollar is subtracted from your final profit, so you cannot borrow your way onto
the podium — only back into the game.

If the bell rings while you have chips on a table, a hand in play, or a rocket in
the air, the stake is handed back before scores are frozen. You can never lose
money to a spin that never happened.

## Round events

Roughly every 100 seconds the floor lights up with an event that runs for 55
seconds:

- **HAPPY HOUR** — slot machines pay double
- **SEEING RED** — roulette red pays 3:1
- **LOADED DICE** — the dice pit drops its house edge entirely
- **ROCKET FUEL** — the rocket cannot crash below 1.50x
- **PHOTO FINISH** — winning race tickets pay +50%
- **LUCKY 21** — blackjack pays 2:1
- **ROBOT RAGE** — winning robot tickets pay +50%

And with 60 seconds left on the clock, **LAST CALL**: every winning payout on the
floor is multiplied by 1.25, which is usually when the round is actually decided.

---

## How it fits together

```
server/
  app.js          the casino as a library: startCasino() -> { urls, room, close }
  index.js        terminal entry point; reads the environment and prints the links
  room.js         players, money, station proximity checks, message dispatch
  round.js        10-minute round lifecycle, timed events, LAST CALL
  rng.js          crypto-backed randomness
  games/          one module per game; all outcomes decided here, never on a client
desktop/
  main.js         Electron main process — runs the casino in-app, owns the windows
  preload.cjs     the only bridge the panel gets: five calls, no Node access
  panel.*         the host control panel
  make-icon.mjs   draws the app icon into a PNG with nothing but zlib
shared/
  config.js       tunables, room dimensions and the station list — imported by the
                  server and fetched by the browser, so the geometry a player sees
                  and the hitboxes the server validates can never drift apart
  roulette.js     the wheel and every legal bet on the felt, generated once and
                  used by both sides: the server validates against this table, so
                  a bet the client can draw is always a bet the server recognises
public/
  js/world.js     the casino itself, built from boxes and procedural canvas textures
  js/avatar.js    the little guys, their hats and their cigars
  js/fx.js        one shared smoke particle pool for every lit cigar
  js/controls.js  pointer-lock FPS movement and collision
  js/ui/          one panel per game
```

The desktop app is a thin shell: it imports the same `startCasino()` the CLI
does and puts a window around it. There is no second copy of the game, and a
guest joining a desktop-hosted casino is talking to exactly the same server as
one joining `npm start`.

The server is authoritative about everything that touches money: it rolls every
outcome, checks you are actually standing at the table you are betting on, and
owns the clock that all clients count down from. Clients are authoritative only
over where their own avatar is standing, which is the worst thing a guest at your
party could cheat at.

There are no image, audio or font files anywhere in the project. The carpet, the
wall panelling, the neon, the slot cabinets and the jumbotron are all drawn into
`<canvas>` elements at startup, and every sound is synthesised with an oscillator
when it plays. That is why the whole thing works with the internet unplugged.

## Development

```bash
npm run dev        # restarts on file changes
```

`npm run icon` redraws `build/icon.png` if you change the design.

Handy while building: the browser console exposes `window.casino` with
`{ controls, world, scene, camera, net, hud, gameStates }`, so you can teleport
yourself with `casino.controls.pos.set(x, 0, z)` instead of walking across the
room for the hundredth time.

---

MIT licensed. Please gamble irresponsibly, it is not real money.
