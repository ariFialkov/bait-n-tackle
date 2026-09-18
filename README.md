# Bait N’ Tackle 🎣

A casual 3D betting game for desktop and mobile, built as an installable PWA.
Pilot a little fishing boat across an infinite, procedurally generated lake —
trawl the shallows for steady low-stakes hauls, or park in a glowing cove and
cast an expensive lure for a trophy fish.

No build step: plain ES modules + a vendored Three.js.

## Run it

Any static file server works:

```bash
npm start            # serves on http://localhost:8080
# or: python3 -m http.server 8080
```

Open it on a phone and “Add to Home Screen” to install; the service worker
caches everything for offline play.

## Build it

There is no bundler or compile step — the game is plain ES modules with
Three.js vendored in. `./build.sh` just assembles a clean, uploadable
`dist/` folder (runtime files only, no `node_modules`, no git, no docs):

```bash
./build.sh                 # dist/ with the manifest as manifest.json
./build.sh --no-manifest   # dist/ with no manifest at all
./build.sh --zip           # also writes bait-n-tackle.zip
```

The manifest is emitted as `manifest.json` rather than
`manifest.webmanifest` because many static hosts reject the `.webmanifest`
extension; both filenames are equally valid to browsers. Upload the
*contents* of `dist/` so that `index.html` lands at your site root.

Hosting requirements: static files over HTTPS, `.js` served as
`text/javascript` (ES modules are rejected under the wrong MIME type), and
no path rewriting — every reference in the build is relative, so it works
from a subdirectory as-is.

## How to play

|            | Desktop                                | Mobile                       |
| ---------- | -------------------------------------- | ---------------------------- |
| Drive      | `WASD` / arrow keys                    | static joystick, bottom-left |
| Cast       | click + drag in any direction          | swipe in any direction       |
| Reel       | drag again (2-3 pulls for a long cast) | swipe again                  |
| Hook       | drag while the bobber dunks (❗)        | swipe while the bobber dunks |
| Autoreel   | 🔄 button, right edge                  | 🔄 button, right edge        |
| Trawl      | click the net on the boat’s stern      | tap the net                  |
| Drop a pot | 🦀 button, right edge                  | 🦀 button, right edge        |
| Pick gear  | 🎣 / 🕸️ buttons, right edge            | same                         |

With more than one rod, a swipe resolves by urgency: set the hook on a
biting line, else keep cranking a hooked one, else cast from whichever
**free rod is nearest where the cast will land**, else reel the line you
swiped toward.

Casts fly in the direction you swipe; swipe length and speed set the
distance. **Once the hook sets the fish is yours** — you can watch it fighting
under the surface as you crank it in, and it breaks the water alongside before
you swing it aboard. Stop reeling and it just tires and works its own way in,
slowly; it can never be lost.

Don't fancy working the rods? **Autoreel** (🔄) sets the hook and cranks for
you the moment a rod goes down, and brings back a lure nothing is interested
in. It changes how many bets you place, never what one pays.

### The two bets

- **Trawling** costs per meter with the net down and scoops up whatever you
  drive over. Four nets set the stakes — $0.06/m Skiff Net up to the $6/m
  Deep Trawl — and each net's rating caps the biggest tier it can land.
  Legend-tier fish never end up in a net.
- **Casting** is the high-stakes bet. Stop the boat, pick one of 8 lures
  ($1 Garden Worm → $200 Trophy Rig) and swipe. Pricier lures target
  proportionally bigger prize fish, and casting is the only way to land
  the four-figure Legend-tier sturgeon.

Watch for **rough water** — the rippling rings near coves, deltas and passage
mouths mark fish activity. Casting there gets faster bites and a better
chance of a fish showing up at all, but never a bigger payout.

### The economy

Every bet is **isolated** ([`src/rtp.js`](src/rtp.js)): when it resolves, a
payout multiplier is drawn from a paytable whose expected value is the game
RTP (default **94%**, see [`src/config.js`](src/config.js)), applied to that
bet's stake alone. No outcome depends on your history, your position, or
your skill:

- **Casting** — the bet is placed the instant the hook sets, and settles right
  there: stake charged, payout drawn, winnings banked. An empty cast still
  costs nothing. Hotspots raise the *catch chance* (80% → 95%) and bite
  speed, but never what a catch pays.

  Settling at the hook is what makes it safe to *show* you the fish while you
  reel. If a hooked fish could still be lost, seeing a small one would be an
  invitation to drop it for free and keep only the winners — cherry-picking
  your way past the paytable. So the hook is the point of no return, and the
  reel is presentation.
- **Trawling** — each stretch of paid distance between catch events is its
  own microbet, resolved against that stretch's cost alone. Location never
  affects trawl results.
- **Pots** — the stake is paid when a pot is dropped and the bet resolves
  when it is collected, against that stake alone.

Every win is **paid straight into your balance** the moment the fish comes
over the rail. There is no hold to fill, nothing to haul ashore and no step
between winning a bet and being paid for it, so realised RTP is exactly the
paytable's.

The fish is chosen to fit the drawn payout (species weighted by how close
their inherent value is, size roll makes the catch worth exactly the
payout), not the other way around. A million-draw simulation of the
paytable converges to 0.940.

### Boats and the shore

**Marinas** generate deterministically along the shoreline as the river
streams in. Pull up to one and the boat store opens; the HUD keeps a
non-intrusive compass chip pointing at the nearest. A marina is somewhere you
choose to go, never a chore — catches pay themselves out at the rail.

Eight hulls, increasingly grand, each unlocking mechanics rather than odds.
Every hull is sold as **four skins** — same model and same mechanics, but
their own name, paint, price and a small speed/handling/wake spread, from
Standard up to Signature. A skin is what you actually buy and sail, so the
shop is a ladder of 32 boats rather than 8:

| Boat | Rods | Unlocks |
| --- | --- | --- |
| Skiff | 1 | — (casting only) |
| Cuddy | 2 | — |
| Trawler | 3 | Trawl net |
| Mud-Dredger | 4 | Sonar fish-finder |
| Gillnetter | 6 | Pots & set nets |
| Paddleboat | 8 | — (the biggest jump in rods) |
| Seiner | 10 | Launchable tender |
| Steamboat | 16 | NPC crew |

A hull's four skins share one downloaded model: the converter bakes a
*neutral* texture that stores where each pixel sits along a four-stop paint
ramp, and the game turns that back into colour at load time
([`src/skinner.js`](src/skinner.js)). Wake size is purely cosmetic.

**Boats never change the odds.** More rods, more speed and sharper handling
mean more bets per minute; with an RTP below 1.0 that is faster churn, not a
better return. A Signature skin gets you between spots sooner — it cannot win
you more per wager. Wake size is pure decoration
([`src/wake.js`](src/wake.js)): the trail is a ribbon laid from the transom
whose half-width grows at the Kelvin angle, so it opens into the correct V on
its own, and hull displacement and engine power set how wide it spreads and
how white it churns.

The top two hulls automate rather than improve. The **tender** (Seiner) can be
taken into channels the seiner cannot enter, or staked with bait and sent out
fishing on its own; its autonomous casts run through the same catch roll and
the same paytable, and its stake is charged from your cash exactly as yours
is. The **crew** (Steamboat) work the rods through the very same `cast()` and
`pull()` calls your swipes use — extra hands, identical bets.

The **sonar** on the Mud-Dredger reads nearby hotspots and names the bait
each one favours. That only changes how *often* a fish shows up for that
bait — the payout is still drawn from the same paytable against the same
stake — so it cannot be played for an edge.

## Project layout

```
index.html            app shell + HUD DOM
styles.css            menu / HUD styling
sw.js                 service worker (offline precache)
manifest.webmanifest  PWA manifest
vendor/three.module.js  vendored Three.js
vendor/addons/          vendored GLTFLoader
assets/boats/           boat models (.glb) + store portraits (.png)
src/
  config.js    all tuning knobs: RTP paytable, costs, lures, nets, camera
  boats.js     the eight-hull catalog: stats, unlocks, rod mounts
  player.js    cash and the owned/equipped boat (persisted)
  docks.js     shoreline marinas, generated per chunk
  marina.js    the boat store UI
  skins.js     the 32 purchasable skins: names, paint, prices, stat spread
  skinner.js   repaints a hull's neutral texture for the skin it is wearing
  tender.js    the Seiner's launchable / autonomous tender
  fishdata.js  the 60 species: values, weights, tiers + visual style data
  fishmodels.js procedural per-species fish prefabs (bodies, fins, skins)
  fishicons.js 2D species icons rendered from the 3D prefabs
  dex.js       the Fishopedia overlay
  rtp.js       RTP engine: wager/earn ledger + catch resolution
  noise.js     seeded value noise / fbm
  lake.js      infinite chunked lake, water shader, hotspots + ripple FX
  boat.js      boat mesh, trawl net, drifty movement
  wake.js      the Kelvin-angle wake ribbon and its foam shader
  hookedfish.js the fish on your line: fighting, breaching, swung aboard
  fishing.js   trawl + cast/bite/reel state machines
  fish.js      ambient fish swimming under the surface
  cameraRig.js menu cam ↔ 30°-off-top-down gameplay cam
  input.js     WASD, joystick, swipe-to-cast, net tap raycast
  hud.js       balance, lure panel, toasts, hints, menu overlay
  main.js      bootstrap + game loop
```

*This is a just-for-fun fake-currency game — no real money is involved.*
