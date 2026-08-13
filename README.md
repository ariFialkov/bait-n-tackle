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
| Trawl      | click the net on the boat’s stern      | tap the net                  |
| Pick lure  | 🎣 button, right edge                  | 🎣 button, right edge        |

Casts fly in the direction you swipe; swipe length and speed set the
distance. Once hooked, keep pulling — stop too long and the fish escapes.

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
mouths mark fish activity. Casting there gets faster bites and a small value
edge.

### The economy

Every bet is **isolated** ([`src/rtp.js`](src/rtp.js)): when it resolves, a
payout multiplier is drawn from a paytable whose expected value is the game
RTP (default **94%**, see [`src/config.js`](src/config.js)), applied to that
bet's stake alone. No outcome depends on your history, your position, or
your skill:

- **Casting** — the bet is only placed when a fish is actually landed; an
  empty cast costs nothing. Hotspots raise the *catch chance* (80% → 95%)
  and bite speed, but never what a catch pays.
- **Trawling** — each stretch of paid distance between catch events is its
  own microbet, resolved against that stretch's cost alone. Location never
  affects trawl results.

The fish is chosen to fit the drawn payout (species weighted by how close
their inherent value is, size roll makes the catch worth exactly the
payout), not the other way around. A million-draw simulation of the
paytable converges to 0.940.

## Project layout

```
index.html            app shell + HUD DOM
styles.css            menu / HUD styling
sw.js                 service worker (offline precache)
manifest.webmanifest  PWA manifest
vendor/three.module.js  vendored Three.js
src/
  config.js    all tuning knobs: RTP paytable, costs, lures, boat, camera
  fishdata.js  the 60 species: values, weights, tiers + visual style data
  fishmodels.js procedural per-species fish prefabs (bodies, fins, skins)
  fishicons.js 2D species icons rendered from the 3D prefabs
  dex.js       the Fishopedia overlay
  rtp.js       RTP engine: wager/earn ledger + catch resolution
  noise.js     seeded value noise / fbm
  lake.js      infinite chunked lake, water shader, hotspots + ripple FX
  boat.js      boat mesh, trawl net, drifty movement, wake particles
  fishing.js   trawl + cast/bite/reel state machines
  fish.js      ambient fish swimming under the surface
  cameraRig.js menu cam ↔ 30°-off-top-down gameplay cam
  input.js     WASD, joystick, swipe-to-cast, net tap raycast
  hud.js       balance, lure panel, toasts, hints, menu overlay
  main.js      bootstrap + game loop
```

*This is a just-for-fun fake-currency game — no real money is involved.*
