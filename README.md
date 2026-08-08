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

- **Trawling** costs **$0.06/m** with the net down and scoops up whatever you
  drive over — frequent but low-value fish (minnows, panfish). Cheap per shot,
  and it adds up over distance.
- **Casting** is the high-stakes bet. Stop the boat, pick one of 8 lures
  ($1 Garden Worm → $200 Trophy Rig) and swipe up. Pricier lures target
  proportionally bigger prize fish, all the way up to sturgeon worth
  four figures.

Watch for **rough water** — the rippling rings near coves, deltas and passage
mouths mark fish activity. Casting there gets faster bites and a small value
edge.

### The economy

All catch values are driven by a round-based RTP engine
([`src/rtp.js`](src/rtp.js)): every dollar you spend (trawl meters, lure
costs) and earn (catches) is tracked, and each new catch is value-selected to
trend your round total toward `RTP × spent` (default **94%**, see
[`src/config.js`](src/config.js)). Species choice, size roll and miss chance
all bend toward closing that gap — if the engine owes you $8 and you cast, a
salmon-sized $8 fish is exactly what tends to bite. A 40k-wager simulation of
every play style converges to 0.940.

## Project layout

```
index.html            app shell + HUD DOM
styles.css            menu / HUD styling
sw.js                 service worker (offline precache)
manifest.webmanifest  PWA manifest
vendor/three.module.js  vendored Three.js
src/
  config.js    all tuning knobs: RTP, costs, lures, boat handling, camera
  fishdata.js  the 60 species with values, weights and tiers
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
