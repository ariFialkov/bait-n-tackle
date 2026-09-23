// Where people stand on each hull, measured off the models by hand.
//
// Everything is in the hull's own frame: bow at -z, waterline at y = 0,
// metres. `deck` is the band of heights the crew may stand at — every
// surface in it with standing room above is a floor (deckmap.js): the
// working deck, a hatch cover, a wheelhouse sole, the sun deck over a
// promenade. Posts carry their own `y` because several sit where a ray
// from above would find a roof, not a floor.
//
// `crewScale` is how big a person is on this boat. The models were built at
// different human scales: the trawler's wheelhouse is under a metre tall
// inside, the steamboat's galleries a metre and a quarter, while the
// seiner's wheelhouse takes a full-height figure. A 1.7m body would stand
// through the roof of the small ones, and scaling the hulls to fit would
// wreck their sizes, so instead the people are sized to their boat, and
// where a wheelhouse is still short the captain sits at the wheel.
//
// `rails` are the runs of rail the rod holders are spaced along, at the
// deck height there (`y`, or `y0`..`y1` along a sloping deck); a boat's
// rods are dealt out over its runs in order. `links` are ladders between
// decks the map cannot join by itself. `railH` is how high the rail a
// lookout leans on stands above the deck, and `seatH` how high a seat's
// hips sit above the floor — both in metres, like everything else here.
//
// Poses: tiller (seated, a hand back on the outboard), seat (seated at a
// wheel), wheel (standing at a wheel), console, crane (hands on levers),
// net (at the stern, ready to throw), rail (hands on the rail, looking
// out). Any hand can leave a post to work a rod when it is the nearest
// body to it, except where `fixed` says the post cannot be left.
//
// Re-measure these if a model is ever replaced; nothing here is derived.

const PI = Math.PI, HALF = Math.PI / 2;

export const STATIONS = {
  skiff: {
    // Floorboards at -0.05, thwarts at 0.2. The captain sits on the aft
    // thwart with a hand back on the tiller.
    deck: [-0.15, 0.35], cell: 0.3, crewScale: 1.0,
    helm: { x: 0.12, y: -0.05, z: 1.0, f: 0, pose: 'tiller', seatH: 0.31 },
    posts: [],
    rails: [{ side: 1, x: 0.85, y: -0.05, z0: -0.1, z1: 0.6 }],
  },
  speedboat: {
    // Cockpit sole at 0.07; the driver's seat to starboard, cushion at 0.46.
    deck: [-0.05, 0.4], cell: 0.3, crewScale: 1.0,
    helm: { x: 0.34, y: 0.07, z: 0.6, f: 0, pose: 'seat', seatH: 0.48 },
    posts: [],
    rails: [{ side: 1, x: 0.66, y: 0.07, z0: 0.95, z1: 1.25 }],
  },
  cuddy: {
    // Cockpit sole at -0.27, hardtop at 1.19: a small person. The bench
    // behind the console seats the driver.
    deck: [-0.4, 0.1], cell: 0.3, crewScale: 0.75,
    helm: { x: 0.35, y: -0.27, z: 1.5, f: 0, pose: 'seat', seatH: 0.31 },
    posts: [],
    rails: [
      { side: 1, x: 0.9, y: -0.27, z0: 2.2, z1: 2.8 },
      { side: -1, x: -0.9, y: -0.27, z0: 2.2, z1: 2.8 },
    ],
  },
  trawler: {
    // At 10.5m. Wheelhouse sole at 0.58 under a 1.35 roof: a small person,
    // seated. The deck sheers from -0.36 abaft the wheelhouse to -0.5 at
    // the stern, with hatch covers proud of it that are climbed over on the
    // way aft, and a ledge along each side at -0.26 inside the bulwark
    // where the rods are.
    deck: [-0.65, 0.95], join: 0.95, cell: 0.35, crewScale: 0.6,
    helm: { x: 0, y: 0.58, z: -1.5, f: 0, pose: 'seat', seatH: 0.22 },
    posts: [
      { kind: 'net', x: 0.3, y: -0.5, z: 3.0, f: PI, pose: 'net' },
    ],
    links: [{ a: { x: 0, y: 0.58, z: -0.8 }, b: { x: 0, y: -0.36, z: -0.1 } }],
    rails: [
      { side: 1, x: 1.3, y: -0.26, z0: 1.6, z1: 3.2 },
      { side: -1, x: -1.3, y: -0.26, z0: 1.9, z1: 2.9 },
    ],
  },
  'mud-dredger': {
    // A hopper barge: the working floor is the well inside the bulwarks,
    // 0.6m below the waterline, and the cabin stands on that floor.
    deck: [-0.75, -0.3], cell: 0.4, crewScale: 0.85,
    helm: { x: 0, y: -0.6, z: 1.55, f: 0, pose: 'wheel' },
    posts: [
      { kind: 'crane', x: 1.0, y: -0.6, z: 0.05, f: HALF, pose: 'crane' },
      { kind: 'net', x: 0.3, y: -0.6, z: 4.5, f: PI, pose: 'net' },
    ],
    rails: [
      { side: 1, x: 2.0, y: -0.6, z0: -3.8, z1: -2.4 },
      { side: -1, x: -2.0, y: -0.6, z0: -3.8, z1: -2.4 },
      { side: 1, x: 2.0, y: -0.6, z0: 2.7, z1: 4.3 },
      { side: -1, x: -2.0, y: -0.6, z0: 2.7, z1: 4.3 },
    ],
  },
  gillnetter: {
    // Main deck at -0.45 inside a 0.6m bulwark; the wheelhouse rides on a
    // raised base forward with a console at its aft face, which is where
    // the captain drives from, at deck level.
    deck: [-0.6, 0.0], cell: 0.4, crewScale: 1.0, railH: 0.6,
    helm: { x: 0, y: -0.45, z: -0.25, f: 0, pose: 'wheel', prop: 'wheel' },
    posts: [
      { kind: 'net', x: 0.9, y: -0.48, z: 4.6, f: PI, pose: 'net' },
      { kind: 'lookout', x: 1.5, y: -0.45, z: 1.0, f: -HALF, pose: 'rail' },
    ],
    rails: [
      { side: 1, x: 1.85, y: -0.46, z0: 0.7, z1: 4.8 },
      { side: -1, x: -1.85, y: -0.46, z0: 0.7, z1: 4.8 },
    ],
  },
  paddleboat: {
    // At 17m. The promenade is at 2.07 but the deck over it leaves only a
    // metre of headroom, so the crew live on the open top deck (3.41) and
    // come down a ladder at its aft end to the open stern promenade, where
    // the net is worked.
    deck: [2.0, 3.5], cell: 0.4, crewScale: 0.75, railH: 0.5,
    helm: { x: 0, y: 3.41, z: -2.4, f: 0, pose: 'wheel', prop: 'wheel' },
    posts: [
      { kind: 'console', x: 0.95, y: 3.41, z: 1.75, f: HALF, pose: 'console' },
      { kind: 'net', x: 0.5, y: 2.07, z: 5.9, f: PI, pose: 'net' },
    ],
    links: [{ a: { x: 1.6, y: 3.41, z: 2.6 }, b: { x: 1.6, y: 2.07, z: 4.3 } }],
    rails: [
      { side: 1, x: 1.95, y: 3.41, z0: -3.8, z1: 3.0 },
      { side: -1, x: -1.95, y: 3.41, z0: -3.8, z1: 3.0 },
      { side: 1, x: 2.4, y: 2.07, z0: 4.6, z1: 6.0 },
      { side: -1, x: -2.4, y: 2.07, z0: 4.6, z1: 6.0 },
    ],
  },
  seiner: {
    // The deck runs downhill from the bow (1.9) past the wheelhouse (1.1)
    // to the working deck aft (0.5) and the low stern where the tender
    // sits (0.0), all one slope. The wheelhouse is full height inside.
    deck: [-0.1, 2.1], cell: 0.4, crewScale: 0.8, railH: 0.5,
    helm: { x: 0, y: 1.13, z: -4.0, f: 0, pose: 'wheel' },
    posts: [
      { kind: 'console', x: 1.0, y: 1.05, z: -3.0, f: -HALF, pose: 'console' },
      { kind: 'lift', x: 0.9, y: 0.0, z: 3.8, f: PI, pose: 'crane' },
      { kind: 'lookout', x: -2.0, y: 1.75, z: -7.0, f: HALF, pose: 'rail' },
    ],
    rails: [
      { side: 1, x: 2.3, y0: 1.5, y1: 1.3, z0: -6.5, z1: -5.0 },
      { side: -1, x: -2.3, y0: 1.5, y1: 1.3, z0: -6.5, z1: -5.0 },
      { side: 1, x: 2.6, y0: 0.8, y1: 0.35, z0: -2.0, z1: 1.0 },
      { side: -1, x: -2.6, y0: 0.8, y1: 0.35, z0: -2.0, z1: 1.0 },
      { side: 1, x: 2.4, y: 0.0, z0: 3.5, z1: 6.0 },
      { side: -1, x: -2.4, y: 0.0, z0: 3.5, z1: 6.0 },
    ],
    // The tender's driver: on the bench in the open cockpit, feet on the
    // sole. The cuddy hull is scaled to 5.4/6.2 as a tender.
    tenderSeat: { x: 0.3, y: -0.235, z: 1.31, f: 0, pose: 'seat', seatH: 0.27 },
  },
  steamboat: {
    // Promenade at 2.99 (3.15 under the sun deck), sun deck at 4.49 with
    // the wheelhouse on it, and a low engine deck aft at 1.63. Ladders join
    // the sun deck to the promenade at both ends; hired hands come out of
    // the deckhouse onto the aft promenade.
    deck: [2.9, 4.6], cell: 0.4, crewScale: 0.75, railH: 0.55,
    helm: { x: 0, y: 4.49, z: -1.7, f: 0, pose: 'wheel' },
    door: { x: 1.7, y: 2.99, z: 1.0 },
    posts: [
      { kind: 'engine', x: -1.0, y: 1.63, z: 8.3, f: -HALF, pose: 'console', fixed: true },
      { kind: 'net', x: -0.6, y: 1.65, z: 10.6, f: PI, pose: 'net', fixed: true },
      { kind: 'lookout', x: 2.9, y: 2.99, z: 3.2, f: -HALF, pose: 'rail' },
      { kind: 'lookout', x: -2.9, y: 3.0, z: -7.3, f: HALF, pose: 'rail' },
      { kind: 'console', x: 2.0, y: 4.49, z: -1.7, f: HALF, pose: 'console' },
    ],
    links: [
      { a: { x: 2.5, y: 4.49, z: 0.3 }, b: { x: 2.5, y: 2.99, z: 1.2 } },
      { a: { x: -2.5, y: 4.49, z: -5.3 }, b: { x: -2.5, y: 3.0, z: -6.2 } },
    ],
    rails: [
      { side: 1, x: 2.85, y: 4.49, z0: -5.0, z1: 0.2 },
      { side: -1, x: -2.85, y: 4.49, z0: -5.0, z1: 0.2 },
      { side: 1, x: 3.0, y: 2.99, z0: 1.4, z1: 6.0 },
      { side: -1, x: -3.0, y: 2.99, z0: 1.4, z1: 6.0 },
      { side: 1, x: 3.0, y: 3.0, z0: -8.8, z1: -6.2 },
      { side: -1, x: -3.0, y: 3.0, z0: -8.8, z1: -6.2 },
    ],
  },
};

export function stationsFor(hullId) {
  return STATIONS[hullId] || null;
}

/**
 * Rod holder positions for a hull: `n` rods dealt out over its rail runs,
 * longer runs taking more, alternating sides where it can. Each is
 * { x, y, z, side }. Null when the hull has no authored rails.
 */
export function rodHolders(hullId, n) {
  const st = STATIONS[hullId];
  if (!st || !st.rails || !st.rails.length) return null;
  const runs = st.rails.map((r) => ({ ...r, len: Math.abs(r.z1 - r.z0), count: 0 }));
  const total = runs.reduce((a, r) => a + r.len, 0) || 1;
  // Whole rods per run by share of rail, the remainder to the longest runs.
  let dealt = 0;
  for (const r of runs) { r.count = Math.floor(n * r.len / total); dealt += r.count; }
  const order = [...runs].sort((a, b) => (b.len / (b.count + 1)) - (a.len / (a.count + 1)));
  for (let i = 0; dealt < n; i = (i + 1) % order.length) { order[i].count++; dealt++; }
  const out = [];
  for (const r of runs) {
    for (let i = 0; i < r.count; i++) {
      const t = r.count === 1 ? 0.5 : (i + 0.5) / r.count;
      const z = r.z0 + (r.z1 - r.z0) * t;
      const y = r.y != null ? r.y : r.y0 + (r.y1 - r.y0) * t;
      out.push({ x: r.x, y, z, side: r.side, run: r });
    }
  }
  // Interleave sides so rod i alternates starboard/port where possible,
  // aft to forward, as the old mounts did.
  out.sort((a, b) => b.z - a.z);
  const s = out.filter((m) => m.side > 0), p = out.filter((m) => m.side < 0);
  const mixed = [];
  while (s.length || p.length) {
    if (s.length) mixed.push(s.shift());
    if (p.length) mixed.push(p.shift());
  }
  return mixed.slice(0, n);
}
