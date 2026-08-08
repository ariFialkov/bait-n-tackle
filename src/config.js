// Central tuning knobs for Bait N' Tackle.

export const CONFIG = {
  // --- Economy / RTP ---
  RTP: 0.94,                 // long-run target return-to-player
  START_BALANCE: 100,
  RTP_PULL: 0.35,            // how hard each catch corrects toward the round target
  MISS_CHANCE_BASE: 0.08,    // baseline chance a cast bite gets away empty
  MISS_CHANCE_AHEAD: 0.35,   // miss chance when the player is well ahead of target

  // --- Trawling ---
  TRAWL_COST_PER_M: 0.06,    // $ per meter travelled with the net down
  TRAWL_CATCH_MIN_M: 9,      // distance window between trawl catch events
  TRAWL_CATCH_MAX_M: 22,
  TRAWL_FISH_MIN: 1,         // fish per catch event
  TRAWL_FISH_MAX: 3,
  TRAWL_MAX_TIER: 1,         // trawl nets mostly scoop tier 0-1 fish
  TRAWL_RARE_TIER_CHANCE: 0.06, // small chance a tier-2 fish ends up in the net

  // --- Casting ---
  CAST_MIN_DIST: 7,
  CAST_MAX_DIST: 26,
  CAST_MAX_SPEED: 0.9,       // boat must be (nearly) stationary to cast
  BITE_MIN_S: 2.2,
  BITE_MAX_S: 9.5,
  BITE_WINDOW_S: 1.6,        // reaction window to reel once a bite starts
  CAST_TIMEOUT_S: 30,        // auto-retrieve after this long

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

  // --- Hotspots ---
  HOTSPOT_RADIUS: 7,         // within this radius casting is "hot"
  HOTSPOT_BITE_BOOST: 2.4,   // bite delay divisor when on a hotspot
  HOTSPOT_VALUE_BOOST: 1.18, // slight value edge on hotspots

  // --- Camera ---
  CAM_ELEV_DEG: 60,          // elevation above horizontal => 30 deg off top-down
  CAM_DIST: 30,
  CAM_FOLLOW_LERP: 4.0,
};

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
