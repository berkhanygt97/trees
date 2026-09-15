# 🎰 Casino Royale — LAN

A browser-based first-person casino party game you host from your own computer.
Everyone on the same Wi-Fi opens a link, picks a name, and walks into a casino as
a small idiot with a big head. Ten-minute rounds. Everybody starts with the same
stack. **Biggest profit when the bell rings wins the room.**

No installs for your guests, no accounts, no internet required once the server is
running — everything, including three.js, is served off your machine.

---

## Hosting a game

```bash
npm install          # once
npm start
```

The server prints the links:

```
  ♠ ♥  C A S I N O   R O Y A L E   —   L A N   ♦ ♣
  ------------------------------------------------
  On this machine : http://localhost:3000
  For your guests : http://192.168.1.42:3000
  ------------------------------------------------
```

Send your guests the `192.168.x.x` link. They open it in Chrome, Edge, Firefox or
Safari — phones can load it, but this is a mouse-and-keyboard game.

Needs Node 18 or newer.

### If nobody can connect

Almost always the host firewall. Allow incoming connections to Node on port 3000:

- **Windows** — the first time you run it, Windows asks "Allow Node.js to
  communicate on…". Tick **Private networks** and allow.
- **macOS** — System Settings → Network → Firewall → Options → allow incoming
  connections for `node`.
- **Linux** — `sudo ufw allow 3000/tcp` (if you use ufw).

Also make sure everyone is on the *same* network and not on a guest/isolated
Wi-Fi, which blocks device-to-device traffic.

### Tuning the night

Set environment variables before `npm start`:

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
| `M` | Mute |

Each game also has its own shortcuts, shown on the buttons — `Space` to spin,
deal, or cash out; `H`/`S`/`D` for hit, stand, double; `R`/`B` for red and black.

---

## What's on the floor

| Game | Where | How it works | House edge |
| --- | --- | --- | --- |
| **Lucky Sevens** slots | Left wall, 8 machines | Three reels. Three of a kind pays 4x–150x, any two matching pays 1.2x. | ~7% |
| **Blackjack** | Right wall, 4 tables | Six-deck shoe, dealer stands on all 17s, blackjack pays 3:2, double on your first two cards. No splits. | ~0.5% with good play |
| **Roulette** | Centre-front | European single zero. Everyone at the table rides the same spin: 22s to bet, 9s to spin. | 2.7% |
| **High / Low Dice** | Either side of the entrance | Roll 0.00–99.99, pick a target and a side. Payout scales with your odds. | 4% |
| **The Rocket** | Centre of the floor | A multiplier climbs from 1.00x until it explodes. Cash out first. The whole lounge watches the same jumbotron. | 3% |
| **The Track** | Back of the room | Six runners, live odds, a 15-second sprint down six lanes. | 10% |

Every result is rolled on the server with `crypto`-grade randomness, and the
payout maths is verified by simulation — the return rates in that table are what
actually comes out over a few hundred thousand hands.

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

And with 60 seconds left on the clock, **LAST CALL**: every winning payout on the
floor is multiplied by 1.25, which is usually when the round is actually decided.

---

## How it fits together

```
server/
  index.js        static file server + WebSocket server, prints the LAN links
  room.js         players, money, station proximity checks, message dispatch
  round.js        10-minute round lifecycle, timed events, LAST CALL
  rng.js          crypto-backed randomness
  games/          one module per game; all outcomes decided here, never on a client
shared/
  config.js       tunables, room dimensions and the station list — imported by the
                  server and fetched by the browser, so the geometry a player sees
                  and the hitboxes the server validates can never drift apart
public/
  js/world.js     the casino itself, built from boxes and procedural canvas textures
  js/avatar.js    the little guys
  js/controls.js  pointer-lock FPS movement and collision
  js/ui/          one panel per game
```

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

Handy while building: the browser console exposes `window.casino` with
`{ controls, world, scene, camera, net, hud, gameStates }`, so you can teleport
yourself with `casino.controls.pos.set(x, 0, z)` instead of walking across the
room for the hundredth time.

---

MIT licensed. Please gamble irresponsibly, it is not real money.
