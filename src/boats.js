// The boat catalog. Boats are cosmetic + logistical only: they change how
// many rods you can run, how much fish you can hold, how the hull handles,
// and which mechanics are unlocked. They NEVER touch the odds or the payout
// of a bet — every wager still resolves against the same paytable (see
// rtp.js), so no boat can be bought for better returns.
//
// Note on "efficiency": a bigger boat lets you place more bets per minute
// (more rods, fewer trips to the dock). With an RTP below 1.0 that means
// faster churn in both directions, not a better expected return.
//
// Each hull is sold as several skins (see skins.js) — same model and same
// mechanics, but their own name, paint, price and small speed/handling/wake
// spread. A skin is what the player actually buys and sails.

import { SKINS, hullSkins, skinKey } from './skins.js';

export const BOATS = [
  {
    id: 'skiff',
    name: 'Skiff',
    tagline: 'Fast, nimble, and tiny.',
    blurb: 'A dented aluminium utility boat with an outboard strapped to the ' +
      'transom. Quick and turns on a dime, but the hold barely fits a milk ' +
      'crate — you will be running back to market constantly.',
    price: 0,
    rods: 1,
    hold: 28,           // kg of fish the hull can carry
    maxSpeed: 10.4,
    accel: 11.25,
    drag: 1.55,
    turn: 4.4,          // heading chase rate — higher is more nimble
    length: 4.6,
    features: {},
  },
  {
    id: 'cuddy',
    name: 'Cuddy',
    tagline: 'A cabin, and room to work.',
    blurb: 'A coastal patrol hull with a little sleeping cuddy up front. ' +
      'Two rod holders, a proper fish box, and enough power to push through ' +
      'chop — at the cost of the skiff’s darting turns.',
    price: 260,
    rods: 2,
    hold: 85,
    maxSpeed: 9.9,
    accel: 9.5,
    drag: 1.45,
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
    price: 1400,
    rods: 3,
    hold: 220,
    maxSpeed: 9.3,
    accel: 8.0,
    drag: 1.4,
    turn: 2.9,
    length: 8.4,
    features: { trawl: true },
  },
  {
    id: 'mud-dredger',
    name: 'Mud-Dredger',
    tagline: 'Unlocks the sonar fish-finder.',
    blurb: 'A broad-beamed working barge built to churn the shallows. Slow ' +
      'and stubborn in a turn, but the sonar dome reads the water ahead and ' +
      'calls out which bait the locals are taking.',
    price: 6000,
    rods: 4,
    hold: 520,
    maxSpeed: 8.6,
    accel: 7.0,
    drag: 1.35,
    turn: 2.3,
    length: 10.0,
    features: { trawl: true, sonar: true },
  },
  {
    id: 'gillnetter',
    name: 'Gillnetter',
    tagline: 'Unlocks pots and set nets.',
    blurb: 'Big net drums, a powerful screw, and a hull that somehow moves ' +
      'better than the dredger despite the size. Carries pots you can drop ' +
      'anywhere on the river and collect later, loaded or empty.',
    price: 24000,
    rods: 6,
    hold: 1100,
    maxSpeed: 9.6,
    accel: 7.5,
    drag: 1.38,
    turn: 2.9,
    length: 12.0,
    features: { trawl: true, sonar: true, pots: true },
  },
  {
    id: 'paddleboat',
    name: 'Paddleboat',
    tagline: 'Unlocks onboard processing.',
    blurb: 'A river paddlewheeler with a processing line below decks. Flip ' +
      'processing on and catches are gutted, packed and paid out the moment ' +
      'they hit the deck — no dock run — at the cost of hold space.',
    price: 90000,
    rods: 8,
    hold: 2400,
    maxSpeed: 8.8,
    accel: 6.5,
    drag: 1.32,
    turn: 2.2,
    length: 15.0,
    features: { trawl: true, sonar: true, pots: true, onboard: true },
  },
  {
    id: 'seiner',
    name: 'Seiner',
    tagline: 'Carries a launchable tender.',
    blurb: 'An ocean seiner with a cuddy sitting on the aft deck under a ' +
      'crane. Drop the tender to slip into narrow channels yourself, or ' +
      'stake it with bait and send it out fishing on its own.',
    price: 380000,
    rods: 10,
    hold: 5200,
    maxSpeed: 10.0,
    accel: 7.25,
    drag: 1.36,
    turn: 2.7,
    length: 19.0,
    features: { trawl: true, sonar: true, pots: true, onboard: true, tender: true },
    tender: { model: 'cuddy', length: 5.4, rods: 2 },
  },
  {
    id: 'steamboat',
    name: 'Steamboat',
    tagline: 'The ultimate floating town.',
    blurb: 'A mobile town on the water. Hire a crew to work sixteen rods, ' +
      'run a floating restaurant that buys your catch at the rail, and strip ' +
      'whole stretches of river without ever going ashore.',
    price: 1500000,
    rods: 16,
    hold: 12000,
    maxSpeed: 8.2,
    accel: 5.75,
    drag: 1.28,
    turn: 1.8,
    length: 26.0,
    features: { trawl: true, sonar: true, pots: true, onboard: true, crew: true },
  },
];

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
    price: skin.price,
    rarity: skin.rarity,
    rarityName: skin.rarityName,
    maxSpeed: skin.maxSpeed,
    turn: skin.turn,
    wake: skin.wake,
  };
}

/** Every purchasable skin, grouped by hull, for the marina. */
export function fleetCatalog() {
  return BOATS.map((hull) => ({ hull, skins: hullSkins(hull) }));
}

export function boatModelURL(hullId) { return `./assets/boats/${hullId}.glb`; }
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
  if (f.onboard) out.push('Onboard processing');
  if (f.tender) out.push('Launchable tender');
  if (f.crew) out.push('NPC crew & restaurant');
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
