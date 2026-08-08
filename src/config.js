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
  CAST_MAX_SPEED: 0.9,       // boat must be (nearly) stationary to cast
  BITE_MIN_S: 2.2,
  BITE_MAX_S: 9.5,
  BITE_WINDOW_S: 2.2,        // reaction window to hook once a bite starts
  CAST_TIMEOUT_S: 45,        // auto-retrieve after this long
  REEL_SWIPES: 2.6,          // full-power swipes needed to reel a max cast
  REEL_SPEED: 8.5,           // m/s the bobber travels while being reeled
  HOOK_ESCAPE_S: 6,          // hooked fish escapes if you stop reeling
  HOOK_PULL_SPEED: 0.55,     // m/s a hooked fish takes line back out
  LINE_SNAP_DIST: 42,        // drive off with line out and it snaps

  // --- Boat handling ---
  BOAT_ACCEL: 7.5,
  BOAT_MAX_SPEED: 6.5,
  BOAT_DRAG: 1.4,
  BOAT_TURN_LERP: 3.2,       // heading chase rate (gives the drifty feel)
  MIN_NAV_DEPTH: 0.45,       // shallower than this blocks the hull

  // --- World ---
  SEED: 1337,
  CHUNK_SIZE: 64,
  CHUNK_RES: 32,             // quads per side
  VIEW_CHUNKS: 3,            // chunk radius kept alive around the boat
  WATER_LEVEL: 0,

  // --- Hotspots (affect catch frequency & bite speed only, never payout) ---
  HOTSPOT_RADIUS: 7,         // within this radius casting is "hot"
  HOTSPOT_BITE_BOOST: 2.4,   // bite delay divisor when on a hotspot

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
