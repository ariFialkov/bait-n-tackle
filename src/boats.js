// The boat catalog. Boats are cosmetic + logistical only: they change how
// many rods you can run, how the hull handles, and which mechanics are
// unlocked. They NEVER touch the odds or the payout of a bet — every wager
// still resolves against the same paytable (see rtp.js), so no boat can be
// bought for better returns.
//
// Note on "efficiency": a bigger boat lets you place more bets per minute
// (more rods, more speed between spots). With an RTP below 1.0 that means
// faster churn in both directions, not a better expected return.
//
// SPEED: `maxSpeed` is the hull's true top speed in m/s, and drag is derived
// from it (see hullDrag). Do not hand-author drag — the two have to agree or
// `maxSpeed` becomes a label that nothing enforces.
//
// Each hull is sold as several skins (see skins.js) — same model and same
// mechanics, but their own name, paint, price and small speed/handling/wake
// spread. A skin is what the player actually buys and sails.

import { SKINS, hullSkins, skinKey } from './skins.js';
import { hullYawRate } from './hullphysics.js';

export const BOATS = [
  {
    id: 'skiff',
    name: 'Skiff',
    tagline: 'Fast, nimble, and tiny.',
    blurb: 'A dented aluminium utility boat with an outboard strapped to the ' +
      'transom. One rod, no gear and nowhere to put anything — but it turns ' +
      'on a dime and it is yours from the first cast.',
    price: 0,
    rods: 1,
    maxSpeed: 14.0,
    accel: 11.25,
    turn: 4.4,          // agility rating — hullYawRate turns it into rad/s,
                        // and a long hull gets far less out of it than this
    length: 4.6,
    features: {},
  },
  {
    id: 'speedboat',
    name: 'Speedboat',
    tagline: 'The quickest thing on the water.',
    blurb: 'A stripped-out planing runabout: one rod, two seats and far more ' +
      'engine than either. Nothing in the fleet gets to a spot faster or ' +
      'turns harder — and nothing carries less while it does it.',
    price: 1.5,
    rods: 1,
    maxSpeed: 17.5,
    accel: 14.0,
    turn: 5.2,
    length: 5.4,
    features: {},
  },
  {
    id: 'cuddy',
    name: 'Cuddy',
    tagline: 'A cabin, and room to work.',
    blurb: 'A coastal patrol hull with a little sleeping cuddy up front. ' +
      'Two rod holders and enough power to push through chop — at the cost ' +
      'of the skiff’s darting turns.',
    price: 3,
    rods: 2,
    maxSpeed: 12.6,
    accel: 9.5,
    turn: 3.5,
    length: 6.2,
    features: {},
  },
  {
    id: 'trawler',
    name: 'Trawler',
    tagline: 'Unlocks the trawl net.',
    blurb: 'Rigged with booms, winches and a working net. Heavier and slower ' +
      'to turn than the cuddy, but the stern gear means you can finally drag ' +
      'a net instead of only casting.',
    price: 6,
    rods: 3,
    maxSpeed: 11.0,
    accel: 8.0,
    turn: 2.9,
    length: 10.5,
    features: { trawl: true },
  },
  {
    id: 'mud-dredger',
    name: 'Mud-Dredger',
    tagline: 'Unlocks the sonar fish-finder and pots.',
    blurb: 'A broad-beamed working barge built to churn the shallows. Slow ' +
      'and stubborn in a turn, but the sonar dome reads the water ahead and ' +
      'calls out which bait the locals are taking, and carries pots the ' +
      'deckhand sets over the side and scoops back aboard.',
    price: 10,
    rods: 4,
    maxSpeed: 10.0,
    accel: 7.0,
    turn: 2.3,
    length: 10.0,
    features: { trawl: true, sonar: true, pots: true },
  },
  {
    id: 'gillnetter',
    name: 'Gillnetter',
    tagline: 'The big net drum.',
    blurb: 'Big net drums, a powerful screw, and a hull that somehow moves ' +
      'better than the dredger despite the size. Carries pots you can drop ' +
      'anywhere on the river and collect later, loaded or empty, and the ' +
      'drum on the after deck pays the net out and winds it in.',
    price: 15,
    rods: 6,
    maxSpeed: 10.5,
    accel: 7.5,
    turn: 2.9,
    length: 12.0,
    features: { trawl: true, sonar: true, pots: true },
  },
  {
    id: 'paddleboat',
    name: 'Paddleboat',
    tagline: 'Eight rods across the stern.',
    blurb: 'A river paddlewheeler with a working deck wide enough to fan ' +
      'eight rods across it. No new gear over the gillnetter — just the ' +
      'biggest jump in lines in the water anywhere in the fleet.',
    price: 21,
    rods: 8,
    maxSpeed: 9.5,
    accel: 6.5,
    turn: 2.2,
    // 17m rather than the 15 it was modelled at: the pilothouse was too
    // small for a person to stand in.
    length: 17.0,
    features: { trawl: true, sonar: true, pots: true },
    // Funnel mouths, in the model's own space (bow at -z, waterline at y=0),
    // read off the hull's geometry and checked by eye. Re-measure these if the
    // model is ever replaced — nothing detects them at runtime.
    stacks: [
      { x: 1.46, y: 6.62, z: -5.38, r: 0.44 },
      { x: -0.05, y: 6.83, z: -7.19, r: 0.40 },
    ],
  },
  {
    id: 'seiner',
    name: 'Seiner',
    tagline: 'Carries a launchable tender.',
    blurb: 'An ocean seiner with a cuddy sitting on the aft deck under a ' +
      'crane. Drop the tender to slip into narrow channels yourself, or ' +
      'stake it with bait and send it out fishing on its own.',
    price: 27,
    rods: 10,
    maxSpeed: 10.3,
    accel: 7.25,
    turn: 2.7,
    length: 19.0,
    features: { trawl: true, sonar: true, pots: true, tender: true },
    tender: { model: 'cuddy', length: 5.4, rods: 2, lift: 0.7 },
  },
  {
    id: 'steamboat',
    name: 'Steamboat',
    tagline: 'The ultimate floating town.',
    blurb: 'A mobile town on the water. Hire a crew to work all sixteen rods ' +
      'on exactly the terms you do, and strip whole stretches of river ' +
      'without ever touching the wheel.',
    price: 36,
    rods: 16,
    maxSpeed: 8.7,
    accel: 5.75,
    turn: 1.8,
    length: 26.0,
    features: { trawl: true, sonar: true, pots: true, crew: true },
    stacks: [
      { x: 0.00, y: 7.65, z: -8.73, r: 0.64 },
      { x: 0.02, y: 8.05, z: -4.06, r: 0.55 },
    ],
  },
];

/**
 * Water drag that makes `maxSpeed` true. The hull integrator adds accel*dt
 * then multiplies by exp(-drag*dt), which settles at accel/drag — so drag has
 * to be accel/maxSpeed or the stated top speed is never reached and the cap
 * never binds. (It used to be hand-authored and every hull topped out ~30%
 * below its catalog figure, which also made the skins' speed stat inert.)
 */
export function hullDrag(accel, maxSpeed) {
  return Math.max(0.05, accel / Math.max(0.1, maxSpeed));
}

export const BOAT_BY_ID = Object.fromEntries(BOATS.map((b) => [b.id, b]));
export const DEFAULT_BOAT = skinKey('skiff', SKINS.skiff[0].id);

/**
 * Resolve a skin key ("cuddy:cherry-red") into the full spec the game runs
 * on: the hull's mechanics with the skin's identity and stat spread applied.
 * Falls back to the starter skiff for unknown keys so a stale save can never
 * strand the player without a boat.
 */
export function resolveBoat(key) {
  const [hullId, skinId] = String(key || '').split(':');
  const hull = BOAT_BY_ID[hullId] || BOAT_BY_ID.skiff;
  const skins = hullSkins(hull);
  const skin = skins.find((s) => s.id === skinId) || skins[0];
  return {
    ...hull,
    key: skin.key,
    skinId: skin.id,
    hullId: hull.id,
    hullName: hull.name,
    name: `${skin.name} ${hull.name}`,
    shortName: skin.name,
    paint: skin.paint,
    style: skin.style,
    price: skin.price,
    rarity: skin.rarity,
    rarityName: skin.rarityName,
    maxSpeed: skin.maxSpeed,
    // Derived per skin, so a Signature's extra knots are actually reachable.
    drag: hullDrag(hull.accel, skin.maxSpeed),
    turn: skin.turn,
    // The ceiling on how fast this hull may swing (hullphysics.js). It falls
    // off with length, so the steamboat's 26 metres show in a long sweeping
    // turn where the skiff flicks round on a coin.
    yawRate: hullYawRate(skin.turn, hull.length),
    wake: skin.wake,
  };
}

/** Every purchasable skin, grouped by hull, for the marina. */
export function fleetCatalog() {
  return BOATS.map((hull) => ({ hull, skins: hullSkins(hull) }));
}

export function boatModelURL(hullId) { return `./assets/boats/${hullId}.glb`; }
export function boatCamoURL(hullId) { return `./assets/boats/${hullId}-camo.png`; }
export function boatPortraitURL(hullId, skinId) {
  return `./assets/boats/${hullId}-${skinId}.png`;
}

/** Human-readable list of what a boat unlocks over the previous tier. */
export function featureList(boat) {
  const f = boat.features || {};
  const out = [];
  if (f.trawl) out.push('Trawl net');
  if (f.sonar) out.push('Sonar fish-finder');
  if (f.pots) out.push('Pots & set nets');
  if (f.tender) out.push('Launchable tender');
  if (f.crew) out.push('NPC crew');
  return out;
}

/**
 * Rod mounting points for a hull, derived from its bounding box so any model
 * works without hand-authored anchors. Rods alternate starboard/port from the
 * cockpit aft, which is also what the "nearest available rod" pick reads.
 * Returns [{ x, y, z, side }] in boat-local space (bow at -z).
 */
export function rodMounts(boat, bounds) {
  const n = boat.rods;
  const halfBeam = (bounds?.halfBeam ?? boat.length * 0.16);
  const deckY = (bounds?.deckY ?? boat.length * 0.11);
  const len = boat.length;
  const mounts = [];
  for (let i = 0; i < n; i++) {
    // Pairs walk forward from the stern quarter toward midships.
    const pair = Math.floor(i / 2);
    const pairs = Math.max(1, Math.ceil(n / 2));
    const t = pairs === 1 ? 0.5 : pair / (pairs - 1);   // 0 = aft, 1 = forward
    const z = len * (0.30 - 0.46 * t);                  // +z aft, -z forward
    const side = n === 1 ? 1 : (i % 2 === 0 ? 1 : -1);  // starboard first
    mounts.push({
      x: side * halfBeam * 0.92,
      y: deckY,
      z,
      side,
    });
  }
  return mounts;
}
