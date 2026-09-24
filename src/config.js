// Central tuning knobs for Bait N' Tackle.

export const CONFIG = {
  // --- Economy / RTP ---
  // Every bet is ISOLATED: when it resolves, a payout multiplier is drawn
  // from PAYTABLE below (expected value = RTP) against that bet's stake
  // alone. Nothing about the player's history, position, or skill changes
  // the odds. A cast's bet is only placed when a fish is actually landed;
  // each trawl stretch between catch events is its own microbet.
  RTP: 0.94,                 // documented target; PAYTABLE must average to this
  START_BALANCE: 100,
  PAYTABLE: [                // { probability, multiplier range (uniform) }
    { p: 0.60, lo: 0.20, hi: 0.55 },
    { p: 0.25, lo: 0.70, hi: 1.30 },
    { p: 0.10, lo: 1.50, hi: 2.60 },
    { p: 0.04, lo: 3.00, hi: 5.50 },
    { p: 0.01, lo: 6.00, hi: 12.0 },
  ], // E[mult] = 0.60*0.375 + 0.25*1.0 + 0.10*2.05 + 0.04*4.25 + 0.01*9 = 0.94
  CAST_CATCH_CHANCE: 0.80,   // odds a cast produces a catchable fish
  HOTSPOT_CATCH_CHANCE: 0.95, // same odds on a hotspot (pacing only — EV per bet is identical)
  BIGCATCH_MIN_VALUE: 50,    // $ value that triggers the big-catch reveal

  // --- Trawling ---
  TRAWL_CATCH_MIN_M: 9,      // distance window between trawl catch events
  TRAWL_CATCH_MAX_M: 22,
  TRAWL_FISH_MIN: 1,         // fish per catch event
  TRAWL_FISH_MAX: 3,
  TRAWL_RARE_TIER_CHANCE: 0.06, // small chance of one tier above the net's rating
  TRAWL_TIER_CAP: 4,         // nets never land Legend-tier fish — casting only

  // --- Casting / reeling ---
  CAST_MIN_DIST: 7,
  CAST_MAX_DIST: 27,
  // You may cast at any speed. Standing the boat still first was a rule with
  // nothing behind it — it never changed a bet, only made you wait.
  BITE_MIN_S: 2.2,
  BITE_MAX_S: 9.5,
  BITE_WINDOW_S: 2.2,        // reaction window to hook once a bite starts
  CAST_TIMEOUT_S: 45,        // auto-retrieve after this long
  // The reel is a flywheel: a swipe spins it up fast and it runs down slowly,
  // so cranking feels like a gyroscope rather than a series of tugs.
  REEL_SWIPES: 1.7,          // full-power swipes needed to reel a max cast
  REEL_ASSIST_SWIPES: 2.6,   // the same for a crew/auto-reel crank
  REEL_SPEED: 13.0,          // m/s the bobber travels while being reeled
  REEL_BASE_SPEED: 3.0,      // m/s the drum is already turning at on contact
  REEL_GAIN: 3.0,            // m/s of drum speed per metre still owed
  REEL_SPINUP: 16,           // how sharply the drum takes up a swipe, per s
  REEL_COAST: 1.7,           // how slowly it runs down again, per s
  // A hooked fish is a settled bet and can never be lost (see fishing.js).
  // Ignore it and it surges, tires and works its own way in — slowly.
  HOOK_TIRE_SPEED: 0.5,      // m/s a hooked fish gives up on its own
  HOOK_PULL_SPEED: 0.55,     // m/s of surge on top, so it still fights
  LAND_LIFT_S: 0.62,         // swinging it up out of the water onto the deck
  LINE_SNAP_DIST: 42,        // drive off with an EMPTY line out and it snaps

  // A true-to-life fish is a 1m speck from a camera 30m up. Hooked fish are
  // drawn larger than life so the catch reads at gameplay distance; relative
  // sizes are preserved, so a trophy still dwarfs a perch.
  HOOKED_FISH_SCALE: 2.6,
  HOOKED_FISH_MAX_M: 6,

  // --- Auto reel (optional assist; changes bet frequency, never payouts) ---
  AUTOREEL_EVERY: 0.34,      // seconds between automatic cranks
  AUTOREEL_POWER: 0.7,

  // --- Boat handling ---
  // Speed, acceleration, drag and turn rate are per hull and per skin — see
  // boats.js and skins.js. Nothing generic lives here any more; the values
  // that used to did not match any boat and were read by nothing.
  MIN_NAV_DEPTH: 0.15,       // shallower than this blocks the hull: anything under water floats it

  // --- World ---
  SEED: 1337,
  CHUNK_SIZE: 64,
  CHUNK_RES: 32,             // quads per side
  VIEW_CHUNKS: 3,            // chunk radius kept alive around the boat
  WATER_LEVEL: 0,

  // --- Hotspots (affect catch frequency & bite speed only, never payout) ---
  HOTSPOT_RADIUS: 7,         // within this radius casting is "hot"
  HOTSPOT_BITE_BOOST: 2.4,   // bite delay divisor when on a hotspot
  SONAR_RANGE: 95,           // how far the fish-finder reads hotspots

  // --- Steamboat crew (auto-fishes the rods; same odds as the player) ---
  CREW_CAST_EVERY: 2.6,      // seconds between a crew member starting a cast
  CREW_REEL_EVERY: 0.42,     // seconds between crew reel pulls
  CREW_PULL_POWER: 0.55,

  // --- Seiner tender ---

  // --- Pots & set nets (gillnetter and up) ---
  MAX_POTS: 6,
  POT_STAKE_MULT: 55,        // stake = net's $/m * this
  POT_SOAK_S: 45,            // how long a pot must sit before it is worth pulling
  POT_COLLECT_RADIUS: 6,

  // --- Camera ---
  CAM_ELEV_DEG: 60,          // elevation above horizontal => 30 deg off top-down
  CAM_DIST: 30,
  CAM_FOLLOW_LERP: 4.0,
};

// Trawl nets: costPerM is the trawl bet size; maxTier caps the species a
// net can land (never above TRAWL_TIER_CAP — legends are casting-only).
export const NETS = [
  { id: 'skiff', name: 'Skiff Net',  costPerM: 0.06, maxTier: 1, emoji: '🕸️', color: 0x6e7b45 },
  { id: 'gill',  name: 'Gill Net',   costPerM: 0.30, maxTier: 2, emoji: '🥅', color: 0x4c7b6e },
  { id: 'seine', name: 'Seine Net',  costPerM: 1.50, maxTier: 3, emoji: '🪢', color: 0x54689a },
  { id: 'deep',  name: 'Deep Trawl', costPerM: 6.00, maxTier: 4, emoji: '⚓', color: 0x7a5a92 },
];

export const LURES = [
  { id: 'worm',      name: 'Garden Worm',   cost: 1,   tiers: [0, 1], emoji: '🪱' },
  { id: 'spinner',   name: 'Spinner',       cost: 3,   tiers: [1, 1], emoji: '✨' },
  { id: 'spoon',     name: 'Spoon',         cost: 6,   tiers: [1, 2], emoji: '🥄' },
  { id: 'jig',       name: 'Bucktail Jig',  cost: 12,  tiers: [2, 2], emoji: '🎏' },
  { id: 'crank',     name: 'Crankbait',     cost: 25,  tiers: [2, 3], emoji: '🐡' },
  { id: 'shad',      name: 'Live Shad',     cost: 50,  tiers: [3, 3], emoji: '🐟' },
  { id: 'swimbait',  name: 'Big Swimbait',  cost: 100, tiers: [3, 4], emoji: '🦈' },
  { id: 'trophy',    name: 'Trophy Rig',    cost: 200, tiers: [4, 5], emoji: '🏆' },
];
