# Bait N’ Tackle 🎣

A casual 3D betting game for desktop and mobile, built as an installable PWA.
Pilot a little fishing boat across an infinite, procedurally generated
country of named lakes, rivers, coves, lagoons, marshes, mangroves, falls and
rapids that runs out, to the east, into the open sea — trawl the shallows for
steady low-stakes hauls, park in a glowing cove and cast an expensive lure
for a trophy fish, or cross the coast for the sea's own sixty species.

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
| Drop a pot | 🦀 button, right edge → Drop pot       | same                         |
| Pick gear  | 🎣 / 🕸️ / 🦀 buttons, right edge        | same                         |

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
  Legend-tier fish never end up in a net. The net itself (`net.js`) is a
  cloth-physics funnel sized to the hull, towed on two warps and held open
  at the mouth as otter boards would — free cloth otherwise, so it lags,
  sways and swings wide through a turn. It is drawn as a square rope mesh,
  every rope between two knots a thin lit cylinder in off-white manila with
  a twisted-strand texture (the headline, selvedges and warps heavier), with
  cork floats along the headline. Each
  haul's fish leap and fall back through the surface over the cod end, at
  the same larger-than-life scale as a hooked fish on the line, for exactly
  as long as the haul notice is up, then fade out with it — the fish the
  bet already produced, shown after the fact.
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
  when it is collected, against that stake alone. Three pots set the stake
  ($3 Crab Pot on fish scraps, $15 Lobster Trap on a whole herring, $75
  Deep Cage on a mackerel); the bait, like a net's rating, only widens which
  species can be in the cage when it comes up — the bigger bait brings up
  bigger fish because the bigger stake is paying for them, never the other
  way round. A pot already out keeps the bet it went in with.

Every win is **paid straight into your balance** the moment the fish comes
over the rail. There is no hold to fill, nothing to haul ashore and no step
between winning a bet and being paid for it, so realised RTP is exactly the
paytable's.

The fish is chosen to fit the drawn payout (species weighted by how close
their inherent value is, size roll makes the catch worth exactly the
payout), not the other way around. A million-draw simulation of the
paytable converges to 0.940.

### The country

The map is the same every time (it is all seeded), but you start
**somewhere new every time** you open it: a random reach of fresh water with
sea room (`terrain.js findStart`). Everything in it is deterministic, so a
place is where you left it and a name is what it was.

The world is tiled into big cells with wandering borders, each one a named
body of water of one **biome** (`regions.js`), chosen by a slow temperature
field — the cold country runs to pines, coves and falls, the warm to lagoons
and mangroves:

| Biome | The water | The country | What grows and lies there |
| --- | --- | --- | --- |
| Lake | deep, clear blue, sometimes a *Lac du …* | broad basins | pines, rocks |
| River / Waterway | winding carved channels | land between them | pines, reeds, logs |
| Cove | rocky, jagged, dark | steep shingle shores | boulders, driftwood, pines |
| Lagoon | shallow, turquoise, a soft floor | white sand, sinuous sandbars | palms, reeds |
| Marsh | murky green-brown flats | mud, low and wide, grey drizzle | reeds, cattails, lily pads, logs, sticks |
| Mangroves | warm green shallows, hazy | mud | mangroves on prop roots |
| Falls | cold, clear | mountains, snow above the line | waterfalls, snow pines, boulders |
| Rapids | a strait, running hard | narrow rock channels | boulders funnelling the stream, white water tearing off them |
| Beaver creek | still, brown-green | low country | beaver dams and lodges, lily pads, sticks |
| Pond | flat calm | small and sheltered | lily pads, cattails |
| Delta | silty, braided, brackish | sand flats | reeds, driftwood |
| Bay | rough, salt | headlands opening to the sea | sea stacks, driftwood |
| Open sea | deep blue swell, whitecaps | none: a jagged coastline and then nothing | sea stacks off the coast |

The height of the ground is one seeded noise shaped by whichever regions a
point lies between (`terrain.js`) — a lake sits lower and deeper, a river is
land cut by channels, a marsh is pressed into flats, falls country climbs —
blended over seventy metres at every border so nothing has a seam. Each
region then **builds its features** into the ground and caches them per
cell: a waterfall raises a cliff with a sheer face behind its lip, cuts the
stream's gully across the top of it and digs a plunge pool at its foot (a
hotspot, as it happens) — the water pours off in two curved sheets, one
behind the other, ropes of white racing down glassy blue, into a boil of
foam and spray, framed by boulders along the lip and at the foot, fed by a
river of flowing water laid down the gully above; a falls region has
several, and a cove the odd one. A beaver dam is a jumble of logs on a
ridge thrown across a creek that really does block it, with a stick lodge
in the water off one end — creeks carry several, rivers and ponds the odd
one. Rapids are a strait, the channel narrowed, boulders along both edges
funnelling the stream and a few standing in it, each with a wake of white
water tearing off downstream. The coast gets sea stacks standing out of the
swell. The props (`props.js`) are instanced per chunk from lists decided
once per chunk (`scatter.js`), and the **solid** ones — rocks, boulders,
logs, driftwood, mangrove trunks — are obstacles the hull physics respects
(`nav.js`): a boat stops at a log as it stops at a bank. The **soft** ones
— reeds, cattails, lily pads — bend out of a passing hull's way on a spring
and swing back once it has gone.

**Moving water** (`currents.js`). Down the core of every carved channel —
the middle of a river or a creek, the braids of a delta, the deepest line
of the trench through a lake — a current runs, seaward more or less (a slow
potential wanders the way), and where warm water meets cold an **eddy** runs
along the contour through deep water: long winding flows that follow the
country and can carry a hull for kilometres, with still water either side
of them. Through a rapid the whole strait runs, at three metres a second.
A hull in a current is carried — the helm can turn out of it, and can
fight it, but it is work — and the flow is drawn as streaks riding the
surface, so it can be seen before it is felt. A mother ship with nobody at
her helm holds station, so she is where you left her when the tender comes
back. It moves the boat; it never touches a bet.

The one water plane is re-coloured **per vertex** from the regions under it
whenever it steps, with its own chop, murk and depth: a lagoon is turquoise,
a marsh is brown and half opaque, and where the water is rough the swell
rolls in and **breaks white on its crests** and on every shore, hardest on
the coast. Sky, fog, the colour and strength of the sun, and what is falling
(rain over the marshes, snow in falls country) are the regions' too
(`climate.js`), eased toward as you cross from one to the next.

**The sea.** To the east the whole freshwater system runs out into the
ocean: across a band of deltas and bays the water turns brackish, and beyond
a single jagged coastline it is salt, deep, and goes on for ever. Fresh water
gives the river's 60 species; salt gives the **sea's own 60** — anchovy to
whale shark, with octopus, squid, lobster, crab, flatfish, sunfish, sharks,
tuna and billfish among them (`fishdata.js`, and their bodies in
`fishmodels.js`); brackish water gives both. Which pool a catch is shown from
is decided by the water it is caught in; the payout it is drawn to fit is
not — the water changes the fish, never the money. The Fishopedia lists all
120 and filters by water.

**Names.** Every region is named (Heron Lake, Lac du Cerf, Widow's Creek,
Farrow Delta, Broken Reach …) and the name fades in, centred and out of the
way, as you come well onto it, with the kind of water under it. Landmarks
worth a name get one on a pin, the way a maps app marks them — Mount X,
X Hill, X Beach, X Rock or Island, X Point, X Dam, X Falls — an HTML pill
like the rest of the HUD, held over its point in the world by projecting
it every frame, fading in as the landmark comes into view and out again as
it leaves (`labels.js`).

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
| Mud-Dredger | 4 | 10.0 m/s | Sonar fish-finder, pots |
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

There are people aboard. The **captain** is you: at the helm — a hand back
on the skiff's outboard tiller, the driver's seat of the speedboat and the
cuddy, the wheel inside the trawler's and dredger's cabins, the open wheel on
the top deck of the paddlers — and off it the moment there is a rod to work.
Rods stand in holders on the rail — a tube on a post down to the deck, the
butt in the tube — until someone lifts one out. A cast is not thrown until
someone is there to throw it: the line waits, the nearest free body walks
to the rod, lifts it out of its holder into their hands over half a second
(the hands chase the grip on the rod, so the two meet without a snap),
turns to face the throw (the torso first, the feet only if it has to), the
rod swings that way and the lure leaves off the whip of that swing. When
the line is done the rod settles back into its holder the same way. The hull itself never moves for a cast.
While a line is out the body stays turned toward it. The bigger hulls carry **crew**, posted by what the
boat has: a hand at the net on the stern, the dredger's crane operator, the
gillnetter's lookout on the rail, the seiner's tender driver (who also takes
the tender out to keep station on the seiner's quarter while you drive the
big boat, and gives the seat back when you take the tender's helm), the
steamboat's engineer and spotters. Any of them will leave a post to work a
rod when they are the nearest body to it, and when more rods are cast than
there are bodies, more hands come out of the cabin until every rod in the
water has one — on every hull with a cabin, not only the steamboat — and go
back in when there is nothing left to do.
Three bodies are rotated through the posts and dressed differently — hair,
hat, top, trousers and boots each recoloured per hand, skin and eyes kept as
painted — so no two look alike. All of it is animated procedurally on the
rigged skeletons (`crew.js`): the models arrive with no animation at all.

Where people can stand is read off each model (`deckmap.js`): every surface
in the hull's working band with standing room over it is a floor, walls are
found by raying between neighbouring cells at body height, and paths go
round a wheelhouse and up the ladders the hull has rather than through
anything. The posts themselves, the rod rails and the size of a person on
each boat are measured by hand (`stations.js`) — the models were built at
different human scales, so the people are sized to their boat rather than
the boats to a person. Each hull also carries a `lift`: the models put
their cockpit soles and working decks below the waterline, so the whole
hull frame (model, rods, people, gear) rides high enough that the lowest
deck stays clear of the water even heeled hard over in a turn, trimmed by
the throttle and down in a wave trough. The heel itself is capped by beam
(`boat.js`), so a wide hull rolls only a few degrees. The hull rides the
water under it: the wave is read at the bow, the stern and both sides, so it
heaves on the average — a short ripple averages out under a long hull, the
sea's long swell lifts the whole boat — and pitches and rolls with the slope
between them.

Anything under water floats a hull: the navigable depth is a hand's
breadth, so the submerged banks across a channel mouth are a place to
drive, not a wall, and the tender can follow the seiner through the
narrows. The shore stops the whole hull (`hullphysics.js`). A hull is a footprint of
points down its centreline and along both sides, tapered to a stem, and a
move or a swing of the heading is allowed only if it leaves no more of those
points aground than before — so a seiner's bow can no longer ride up the
beach while its middle floats. Into a bank the hull scrapes along it rather
than sticking: the part of the move heading into the shore is stripped and
the rest slides, and where the shore's normal is only a guess (a shelving
flat, whose navigable line wanders at the metre scale) the hull feels round
it, swinging its move a little either way until something gives, and a hull that has somehow been put on the bank (a shove
from another hull) always has a way off, and only off.

The moving parts move. The converter carves them out of each model and the
game drives them from the hull's own motion: the **outboards** (Skiff,
Speedboat) swing with the helm and tilt clear of the water at idle, and the
**paddlewheels** (Paddleboat, Steamboat) roll with the boat's way through the
water, the inner wheel backing off in a turn while the outer drives on. Hulls
heel into their turns and lift the bow under power, and the rods swing to
follow their own lines and load up when a fish is on. The wake is laid down
at the hull's real transom (`wake.js` reads the model's stern), so it meets
the boat on a paddler as wide as it is long and a seiner twice as long as it
is wide alike. The steam hulls make
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
skin is worn. The atlases are not clean partitions either: where a triangle
shares UV space with an unrelated part and would read the wrong label, the
converter re-points it at a solid swatch of its own label in an unused
corner of the atlas. It also drops the clutter a model is better without —
the seiner's roofs were strewn with pea-sized blobs that read as black warts
on most skins — and lets a hull set its own threshold for what counts as a
"small fitting", which is what stopped the mud-dredger's second roof plate
being painted dark and z-fighting with the white roof around it. A hull with
no model falls back to a procedural shape
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
taken into channels the seiner cannot enter, or sent out fishing on its own
with a **bag of bait** you make up yourself — so many worms, so many spoons,
one trophy rig, the total stake shown as you build it. A bait is used up only
when a fish takes it, and its cost is staked at that moment; the autonomous
casts run through the same catch roll and the same paytable, and the stake
is charged from your cash exactly as yours is. The run ends when the bag is
empty or your cash cannot cover what is left in it. Aboard, the tender
stands on chocks in the seiner's stern well (the model's own painted-on
tender is carved off so the real hull can take its place); in the water it
is a second hull on the same lake — it keeps station off the seiner's
quarter (or the other quarter, or astern, whichever has water round it),
steers round her rather than through her, and neither boat can be driven
through the other (`hullphysics.js separateHulls`). Its helmsman has an eye
for the shore: feelers fan out either side of the wanted course and the
tender turns to the nearest one with a metre of water all the way out,
holds off any bank within a boat's length, and backs out toward the
deepest water in sight when it has been pushing into a corner. The tender
carries a **mate** who works its rods whoever is driving, and the cuddy
has one too, so on the small boats a cast never needs the boat to stop:
under way the captain keeps the helm and the mate throws; stopped, either
takes the nearest rod. The **crew** (Steamboat) work the rods through the very same `cast()` and
`pull()` calls your swipes use — extra hands, identical bets.

The gear moves the way gear does, and none of it changes a bet — every
animation below is the picture of something already decided. The tender
goes over the side on a **deck crane** (`crane.js`): a hydraulic pedestal
crane at the well's forward corner, beside the hand at its levers, that is
driven only by where its hook should be and works out its own slew, luff
and wire, each at a machine's pace. To launch, the hook comes down onto the
tender on its chocks, takes the weight, lifts it clear of the bulwark,
swings it out over the starboard side and lowers it to the water; let go,
it is a boat with the ship's way on it. Called back, the tender comes
alongside under the hook and the same film runs backwards into the well.
Where a model has the machinery, the machinery does the work. The
converter carves it out as driven parts (`rig` rules in the converter,
driven from `boat.js`): the **trawler's** aft gallows swing down over the
water while the cone of netting hangs upright from their apex on a wire,
swinging a little as they move; the wire then pays out until the cone is
wholly under, where it is put away and the netting in the water takes over
from it; stowing winds the netting in, brings the cone back up out of the
water on its wire, and raises the gallows. The **gillnetter's** net drum
turns one way as the net pays out and the other as it is wound in. (The
dredger's grab was tried for its pots and dropped: it made setting a pot
a production; a deckhand scoops them at the rail like everywhere else.)
The net also has its own button at the top of the net
panel (Deploy net / Pull net), the same as tapping the net on the stern,
and the seiner's crane is painted the skin's hull colour. A hull's wake
starts where the transom meets the water — the trawler's model runs out to
the cone hanging over its stern, and the wake used to start under that.

On the other hulls the **trawl net** and the **pots** are worked by a
deckhand, the way the
rods are: the net hand (or whoever is loose) walks to the bundle on the
stern deck, lifts it into their hands, winds up and heaves it over the
transom off the whip of the throw, and it pays out from a bundle into its
full funnel as the winch lets the ropes run; stowing winds it back to a
bundle and the same hand hauls it in over the transom and sets it down.
A pot is carried to the rail and thrown in a tumbling arc, splashes, and
its cage sinks away under the float until the rope is straight — where it
comes down is decided only as it leaves the hands, beside the boat where
it is by then and carried a little forward by its way, so a pot set from a
moving boat does not fly back to where the button was pressed; reached,
the hand goes to the rail, the cage is hauled up to the surface and lifted
into their arms, and only then is the haul shown. With nobody free to
come (a skiff has no deckhand), the gear goes over on its own after a
moment, from the gallows or the rail.
A **line that parts** whips back: the rod springs the other way, the loose
end flies up toward the tip and settles slack on the water, and the
cut-off float rolls over and goes under.

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
assets/crew/            the four rigged fishermen (.glb), atlas classed for recolouring
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
  crane.js     the deck crane that puts it over the side and back
  fishdata.js  the 120 species (60 fresh, 60 salt): values, weights, tiers + style
  fishmodels.js procedural per-species fish prefabs (bodies, fins, skins)
  fishicons.js 2D species icons rendered from the 3D prefabs
  dex.js       the Fishopedia overlay
  rtp.js       RTP engine: wager/earn ledger + catch resolution
  noise.js     seeded value noise / fbm
  regions.js   the named biome cells, the coast and salinity, the climates
  terrain.js   the ground: per-biome heights, the ocean floor, built features, landmarks
  scatter.js   what lies where on a chunk, decided once: the prop lists and the obstacles
  nav.js       where a hull may float: depth plus nothing solid in the way; the random start
  currents.js  the moving water: channel flow, rapids, eddies, and the streaks that show it
  props.js     the props drawn by biome, the brush spring, waterfalls, white water, dams, stacks
  climate.js   sky, fog, sun and precipitation eased toward the regions round the boat
  labels.js    the landmark pins in the world
  lake.js      infinite chunked water and country, the per-region water shader, hotspots
  boat.js      boat mesh, trawl net, and the working machinery on it
  hullphysics.js how a hull answers the helm: yaw rate, thrust, keel grip
  rods.js      the rods as gear: raked outboard, aimed at their lines
  smoke.js     funnel plumes for the steam hulls
  crew.js      a fisherman: rig, dressing, procedural animation and IK
  crewlook.js  recolouring a crew member's clothes from the classed atlas
  deckcrew.js  who is on deck and what they are doing
  deckmap.js   where on a hull a person can stand and walk
  stations.js  the posts, rails and ladders of each hull, measured by hand
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
