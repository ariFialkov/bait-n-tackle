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
| Reel       | drag again (1-2 pulls for a long cast) | swipe again                  |
| Hook       | drag while the bobber dunks (❗)        | swipe while the bobber dunks |
| Auto reel  | reel button, right edge                | reel button, right edge      |
| Trawl      | click the net on the boat’s stern      | tap the net                  |
| Drop a pot | 🦀 button, right edge                  | 🦀 button, right edge        |
| Pick gear  | 🎣 / 🕸️ buttons, right edge            | same                         |

With more than one rod, a swipe resolves by urgency: set the hook on a
biting line, else keep cranking a hooked one, else cast from whichever
**free rod is nearest where the cast will land**, else reel the line you
swiped toward.

Casts fly in the direction you swipe; swipe length and speed set the
distance, and you can cast at any speed — there is nothing to be gained by
stopping first. The reel is a flywheel: a swipe spins it up hard and it runs
down slowly, so a full-length cast comes back in a couple of cranks. **Once the hook sets the fish is yours** — you can watch it fighting
under the surface as you crank it in, and it breaks the water alongside before
you swing it aboard. Stop reeling and it just tires and works its own way in,
slowly; it can never be lost.

Don't fancy working the rods? **Auto reel** sets the hook and cranks for you
the moment a rod goes down, and brings back a lure nothing is interested in.
It changes how many bets you place, never what one pays.

### The two bets

- **Trawling** costs per meter with the net down and scoops up whatever you
  drive over. Four nets set the stakes — $0.06/m Skiff Net up to the $6/m
  Deep Trawl — and each net's rating caps the biggest tier it can land.
  Legend-tier fish never end up in a net.
- **Casting** is the high-stakes bet. Pick one of 8 lures
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

Nine hulls, increasingly grand, each unlocking mechanics rather than odds.
Every hull is sold as **four skins** — same model and same mechanics, but
their own name, paint, price and a small speed/handling/wake spread, from
Standard up to Signature. A skin is what you actually buy and sail, so the
shop is a ladder of 36 boats rather than 9:

| Boat | Rods | Top speed | Unlocks |
| --- | --- | --- | --- |
| Skiff | 1 | 14.0 m/s | — (casting only, and free) |
| Speedboat | 1 | 17.5 m/s | — (the fastest, sharpest hull in the game) |
| Cuddy | 2 | 12.6 m/s | — |
| Trawler | 3 | 11.0 m/s | Trawl net |
| Mud-Dredger | 4 | 10.0 m/s | Sonar fish-finder |
| Gillnetter | 6 | 10.5 m/s | Pots & set nets |
| Paddleboat | 8 | 9.5 m/s | — (the biggest jump in rods) |
| Seiner | 10 | 10.3 m/s | Launchable tender |
| Steamboat | 16 | 8.7 m/s | NPC crew |

`maxSpeed` is the hull's **true** top speed: drag is derived from it
(`hullDrag`), so the figure in the catalog is the figure you reach and a
Signature skin's extra knots are actually there.

The boat goes where you point, at once — the stick drives the velocity, as it
always has. What the hull's size changes is how fast the **heading** can
follow (`hullphysics.js`): the chase is a smooth ease with a hard ceiling on
how many radians a second the hull may swing, so small corrections stay soft
and a big one runs into a ceiling a 26m steamboat cannot argue with. The
skiff flicks its head round inside its own length; the steamboat sweeps
through one long turn. The shop's Handling pips show that real yaw rate, not
the raw agility rating, because the same rating buys far less on a long
hull.

The moving parts move. The converter carves them out of each model and the
game drives them from the hull's own motion: the **outboards** (Skiff,
Speedboat) swing with the helm and tilt clear of the water at idle, and the
**paddlewheels** (Paddleboat, Steamboat) roll with the boat's way through the
water, the inner wheel backing off in a turn while the outer drives on. Hulls
heel into their turns and lift the bow under power, and the rods swing to
follow their own lines and load up when a fish is on. The steam hulls make
smoke (`smoke.js`): puffs leave the funnels with the ship's way still on
them, rise, are taken by the breeze and come apart into wisps, laid down in
world space like the wake — drive a circle and the plume reads the circle
back to you.

Skins are a side-spend, not a grind — the whole fleet runs from **$0.50 to
about $100**, because the game is the betting. Six per hull, in two paint
styles:

- **Clean** (Standard and Custom tiers) — every component of the boat is one
  flat colour with a hard edge: a coloured hull, a deck, a cabin, dark
  fittings. Every hull's default *Classic* wears the same livery (charcoal,
  deep blue, orange, off-white) so the fleet reads as one family, and two
  simple colourways sit beside it.
- **Camo** (Premium and Signature tiers) — four soft bands following the
  model's own shading, busy and patchy: Clownfish, Whale Shark, Blue Tang,
  Koi and Lionfish through to Patriot, Stealth, Carbon Fibre and Hazard
  Stripe. The ramp is a brightness ramp rather than a stencil, so a theme is
  a palette — a clownfish skiff is black/orange/white, not actual stripes.

A hull's six skins share one downloaded model. The converter bakes two
*neutral* maps per hull, each storing where a pixel sits along a four-stop
paint ramp rather than a colour, and the game turns that back into paint at
load time ([`src/skinner.js`](src/skinner.js)). The clean map is embedded in
the GLB and its labels come from the **geometry** — each triangle is classed
as hull, deck, superstructure or fitting from its height and the way it
faces, then painted straight into its UV footprint — because the source
atlases are mosaics of thousands of shaded islands and nothing derived from
their brightness could ever come out solid. The camo map is that brightness
bake, shipped as a `<hull>-camo.png` sidecar and fetched only when a camo
skin is worn. A hull with no model falls back to a procedural shape
([`src/hullshapes.js`](src/hullshapes.js)). Wake size is purely cosmetic.

**Boats never change the odds.** More rods, more speed and sharper handling
mean more bets per minute; with an RTP below 1.0 that is faster churn, not a
better return. A Signature skin gets you between spots sooner — it cannot win
you more per wager.

Wake size is pure decoration ([`src/wake.js`](src/wake.js)). The trail is a
ribbon laid from the transom whose half-width grows at the Kelvin angle, so it
opens into the correct V on its own. It is nine vertices wide rather than two,
which gives it a cross-section: a hollow lane down the centreline with a
raised, curling crest riding each edge, lifted above the water in the vertex
shader and lit in the fragment shader so the arms read as waves with height.

The water texture is sampled in **world metres**, not across the ribbon, so it
keeps a fixed physical scale however wide the wake has opened and stays put on
the lake as you drive away from it — that is what stops it reading as a
stretched stripe. Foam then *dissolves* rather than fading: a noise threshold
climbs with age, so the sheet breaks into shrinking islands of chop the way
real foam does, with smooth laminar ripples curling around them. Hull
displacement sets how wide the V opens and how tall the crests stand; engine
power sets how white and noisy it churns and how hard the transom throws
spray.

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
  boats.js     the nine-hull catalog: stats, unlocks, rod mounts
  hullshapes.js procedural hulls for boats with no modelled GLB
  player.js    cash and the owned/equipped boat (persisted)
  docks.js     shoreline marinas, generated per chunk
  marina.js    the boat store UI
  skins.js     the 54 purchasable skins: names, paint, style, prices, spread
  skinner.js   repaints a hull's neutral texture for the skin it is wearing
  tender.js    the Seiner's launchable / autonomous tender
  fishdata.js  the 60 species: values, weights, tiers + visual style data
  fishmodels.js procedural per-species fish prefabs (bodies, fins, skins)
  fishicons.js 2D species icons rendered from the 3D prefabs
  dex.js       the Fishopedia overlay
  rtp.js       RTP engine: wager/earn ledger + catch resolution
  noise.js     seeded value noise / fbm
  lake.js      infinite chunked lake, water shader, hotspots + ripple FX
  boat.js      boat mesh, trawl net, and the working machinery on it
  hullphysics.js how a hull answers the helm: yaw rate, thrust, keel grip
  rods.js      the rods as gear: raked outboard, aimed at their lines
  smoke.js     funnel plumes for the steam hulls
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
