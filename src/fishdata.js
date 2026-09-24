// The 120 catchable species: 60 of fresh water and 60 of the sea. `value`
// is the inherent average dollar value of the species; actual catch value
// comes from the isolated-bet engine. `kg` is a plausible average weight
// used for flavor and size scaling. Which pool a catch is drawn from is
// decided by the water it is caught in (fresh, salt, or both where the two
// meet) — the payout it is drawn to fit is not.
//
// Each species also carries a visual style consumed by fishmodels.js:
//   arch    — body archetype (shape, fins, snout)
//   back    — dorsal color        belly — ventral color
//   fin     — fin color
//   pat     — pattern list: [type, color] with types:
//             bars | spots | lightspots | stripe | hstripes | chain |
//             marble | blotch | scales | scutes
//
// Tiers bucket species for lure/trawl selection:
//   0: bait fish  1: panfish  2: sport fish  3: prize fish  4: trophy  5: legend

const RAW = [
  // [name, $, kg, arch, back, belly, fin, patterns]
  ['Fathead Minnow', 0.15, 0.01, 'minnow', 0x8a9b7a, 0xd8d8c8, 0x9aa88a, null],
  ['Golden Shiner', 0.20, 0.05, 'minnow', 0xc8a84b, 0xf0e0b0, 0xd8b860, [['scales', 0xa88838]]],
  ['Creek Chub', 0.25, 0.10, 'minnow', 0x7a8a6a, 0xd0d0c0, 0x8a9a7a, [['stripe', 0x3a4a3a]]],
  ['Bluegill', 0.40, 0.25, 'panfish', 0x3f5e63, 0xe8a04a, 0x4a6a70, [['bars', 0x2a4448]]],
  ['Pumpkinseed', 0.45, 0.20, 'panfish', 0x6a8a4a, 0xf0b050, 0x7a9a5a, [['spots', 0xd07030]]],
  ['Green Sunfish', 0.50, 0.20, 'panfish', 0x4a7a5a, 0xd8c060, 0x5a8a6a, [['spots', 0x7ab8c8]]],
  ['Yellow Perch', 0.80, 0.35, 'perch', 0xc8a83a, 0xf0e8c0, 0xd88a3a, [['bars', 0x4a5a30]]],
  ['White Crappie', 1.0, 0.45, 'panfish', 0xb8c4c8, 0xf0f0e8, 0xa8b4b8, [['bars', 0x5a6a72]]],
  ['Black Crappie', 1.1, 0.45, 'panfish', 0x8a9a8a, 0xe8e8e0, 0x7a8a7a, [['spots', 0x3a4a3a]]],
  ['Rock Bass', 1.2, 0.35, 'bass', 0x7a6a4a, 0xd8c8a0, 0x8a7a5a, [['spots', 0x4a3a2a]]],
  ['Brown Bullhead', 1.5, 0.60, 'bullhead', 0x5a4a3a, 0xd8c8a8, 0x6a5a4a, null],
  ['White Sucker', 1.8, 0.90, 'carp', 0x9a9a8a, 0xe8e8d8, 0xa8a898, null],
  ['Common Carp', 2.5, 4.5, 'carp', 0xa8863a, 0xe0c890, 0xb8964a, [['scales', 0x7a6428]]],
  ['Rainbow Trout', 3.5, 1.5, 'trout', 0x7a9a8a, 0xe8e8e0, 0x8aa89a, [['stripe', 0xe87a8a], ['spots', 0x3a3a32]]],
  ['Brook Trout', 4.0, 0.9, 'trout', 0x3a5a4a, 0xe89a5a, 0xc85a4a, [['marble', 0xc8d8b0], ['spots', 0xd85a4a]]],
  ['Brown Trout', 5.0, 2.2, 'trout', 0xa8894a, 0xf0e0b0, 0xb8994a, [['spots', 0x4a3a20], ['spots', 0xc05a3a]]],
  ['Smallmouth Bass', 6.0, 1.6, 'bass', 0x7a7a4a, 0xd8d0a8, 0x8a8a5a, [['bars', 0x5a5230]]],
  ['Largemouth Bass', 8.0, 2.5, 'bass', 0x4a7a4a, 0xd8e0c0, 0x5a8a5a, [['stripe', 0x2a4a2a]]],
  ['Channel Catfish', 9.0, 4.0, 'catfish', 0x6a7a8a, 0xd8d8d0, 0x7a8a9a, [['spots', 0x3a4048]]],
  ['Walleye', 11, 2.8, 'perch', 0xb89a4a, 0xe8e0c8, 0xc8aa5a, [['blotch', 0x6a5a2a]]],
  ['Sauger', 12, 1.4, 'perch', 0xa8884a, 0xe0d0b0, 0xb8985a, [['spots', 0x4a3a20]]],
  ['Northern Pike', 14, 5.5, 'pike', 0x4a6a3a, 0xc8d0a0, 0x8a6a3a, [['lightspots', 0xd8e0a8]]],
  ['Burbot', 16, 3.0, 'ribbon', 0x6a5a3a, 0xc8b890, 0x7a6a4a, [['marble', 0x3a3222]]],
  ['Lake Whitefish', 18, 2.5, 'whitefish', 0x9ab0b8, 0xf0f0e8, 0xa8c0c8, [['scales', 0x8aa0a8]]],
  ['Lake Trout', 22, 6.0, 'trout', 0x5a6a72, 0xd8d8d0, 0x6a7a82, [['lightspots', 0xc8d0d0]]],
  ['Kokanee Salmon', 25, 1.5, 'salmon', 0xc04838, 0xe8c0a0, 0x883028, null],
  ['Arctic Grayling', 28, 1.1, 'grayling', 0x6a7a9a, 0xd0d0d8, 0x8a6ab8, [['spots', 0x2a3242]]],
  ['Cutthroat Trout', 32, 2.0, 'trout', 0xb8964a, 0xe8b87a, 0xc8563a, [['spots', 0x3a3220]]],
  ['Tiger Trout', 36, 2.5, 'trout', 0x7a6a3a, 0xe0c890, 0x8a7a4a, [['marble', 0xe8d8a0]]],
  ['Steelhead', 42, 4.5, 'salmon', 0x8aa0b0, 0xf0f0f0, 0x9ab0c0, [['stripe', 0xe89aa8], ['spots', 0x3a3a3a]]],
  ['Freshwater Drum', 48, 5.0, 'drum', 0x9a9aa8, 0xe0e0d8, 0xa8a8b8, null],
  ['Bowfin', 55, 3.5, 'ribbon', 0x5a6a3a, 0xc8c890, 0x4a7a4a, [['chain', 0x3a4a26]]],
  ['Longnose Gar', 65, 6.0, 'gar', 0x7a8a5a, 0xd8d8b0, 0x8a9a6a, [['spots', 0x3a4228]]],
  ['Flathead Catfish', 75, 16, 'flathead', 0x8a7a3a, 0xe0d090, 0x9a8a4a, [['blotch', 0x5a4a20]]],
  ['Blue Catfish', 85, 18, 'catfish', 0x7a8a9a, 0xe8e8e0, 0x8a9aaa, null],
  ['Muskellunge', 100, 12, 'pike', 0x8a9a7a, 0xe0e0c8, 0xa8845a, [['bars', 0x4a5a3a]]],
  ['Tiger Muskie', 115, 10, 'pike', 0x7a8a5a, 0xd8d8b0, 0x987a4a, [['bars', 0x3a4a2a]]],
  ['Paddlefish', 130, 27, 'paddle', 0x7a8a92, 0xd8d8d8, 0x8a9aa2, null],
  ['Alligator Gar', 150, 60, 'gar', 0x6a7a52, 0xd0d0a8, 0x7a8a62, [['spots', 0x3a4630]]],
  ['Taimen', 170, 30, 'salmon', 0x7a6a52, 0xd8c0a0, 0xc85a4a, [['spots', 0x3a322a]]],
  ['Golden Mahseer', 190, 20, 'carp', 0xc8a02a, 0xf0d878, 0xd8b03a, [['scales', 0xa07818]]],
  ['Murray Cod', 210, 25, 'bass', 0x5a7a52, 0xd8e0b8, 0x6a8a62, [['marble', 0x3a5a38]]],
  ['Barramundi', 230, 15, 'barra', 0x9aa89a, 0xe8e8d8, 0xaab8aa, null],
  ['Giant Snakehead', 255, 8, 'ribbon', 0x4a5a52, 0xc8c8b0, 0x3a4a42, [['chain', 0x2a362e], ['stripe', 0x32403a]]],
  ['Giant Gourami', 280, 7, 'panfish', 0x8a8a7a, 0xd8d0c0, 0x9a9a8a, [['bars', 0x6a6a5a]]],
  ['Clown Knifefish', 310, 5, 'knife', 0x8a92a0, 0xe8e8e8, 0x9aa2b0, [['spots', 0x2a3038]]],
  ['Giant Freshwater Stingray', 340, 120, 'ray', 0x6a5a4a, 0xd8d0c0, 0x7a6a5a, null],
  ['Redtail Catfish', 375, 35, 'catfish', 0x4a4a52, 0xf0f0e8, 0xd84a3a, [['stripe', 0xe8e8e0]]],
  ['Payara', 410, 8, 'barra', 0x8a98a8, 0xe8e8e0, 0x9aa8b8, null],
  ['Arapaima', 450, 90, 'ribbon', 0x4a5a52, 0xc8b8a0, 0xc84a3a, [['spots', 0xc84a3a]]],
  ['Goliath Tigerfish', 500, 30, 'barra', 0x98a8b0, 0xe8e8e0, 0xc86a3a, [['hstripes', 0x4a5a62]]],
  ['Nile Perch', 550, 80, 'barra', 0x8a9aa0, 0xe0e8e8, 0x9aaab0, null],
  ['Wels Catfish', 600, 90, 'flathead', 0x4a5242, 0xd8d0b0, 0x5a6252, [['marble', 0x2a3226]]],
  ['Giant Barb', 660, 100, 'carp', 0x7a8a92, 0xe0e0d0, 0x8a9aa2, [['scales', 0x5a6a72]]],
  ['Mekong Giant Catfish', 730, 150, 'bullhead', 0x7a8a8a, 0xe0e0d8, 0x8a9a9a, null],
  ['Piraíba Catfish', 800, 120, 'catfish', 0x7a8a9a, 0xf0f0e8, 0x8a9aaa, null],
  ['Chinese Sturgeon', 880, 200, 'sturgeon', 0x6a7482, 0xd8d8c8, 0x7a8492, [['scutes', 0xc8c8b8]]],
  ['Kaluga Sturgeon', 960, 250, 'sturgeon', 0x7a8a7a, 0xe0e0d0, 0x8a9a8a, [['scutes', 0xd0d0c0]]],
  ['Beluga Sturgeon', 1050, 350, 'sturgeon', 0x8a929a, 0xf0f0e8, 0x9aa2aa, [['scutes', 0xd8d8d0]]],
  ['White Sturgeon', 1150, 220, 'sturgeon', 0x9aa0a8, 0xe8e8e8, 0xaab0b8, [['scutes', 0xe0e0d8]]],
];

// The sea's own: what comes up once the water turns salt.
const RAW_SALT = [
  // --- bait ---
  ['Anchovy', 0.15, 0.02, 'minnow', 0x5a7a9a, 0xe8eef0, 0x8aa0b0, [['stripe', 0xc8d8e0]]],
  ['Sardine', 0.20, 0.05, 'minnow', 0x4a6a8a, 0xe0e8ea, 0x7a90a0, [['spots', 0x2a3a4a]]],
  ['Atlantic Herring', 0.30, 0.15, 'minnow', 0x3a5a80, 0xe8ecf0, 0x6a88a0, null],
  ['Pinfish', 0.60, 0.15, 'panfish', 0x9aa878, 0xe8e0b0, 0xc8b060, [['bars', 0x4a5a48], ['hstripes', 0xd8c050]]],
  ['Shore Crab', 0.80, 0.10, 'crab', 0x5a7a4a, 0xc8b890, 0x6a8a5a, null],
  // --- panfish ---
  ['Atlantic Mackerel', 1.2, 0.5, 'mackerel', 0x2a6a88, 0xe8eef0, 0x4a8aa0, [['bars', 0x123a50]]],
  ['Whiting', 1.6, 0.6, 'cod', 0x9aa090, 0xf0f0e8, 0xa8b0a0, null],
  ['Common Squid', 2.2, 0.4, 'squid', 0xc89aa0, 0xf0e0e0, 0xd8b0b8, [['spots', 0x8a4a5a]]],
  ['Flounder', 3.0, 1.0, 'flat', 0x7a6a4a, 0xe8e0d0, 0x8a7a5a, [['blotch', 0x3a3020], ['spots', 0xd8d0b0]]],
  ['Sea Bream', 3.5, 1.2, 'panfish', 0xa8a8a8, 0xf0f0e8, 0xb8b0a0, [['hstripes', 0xd8c860]]],
  ['Spanish Mackerel', 4.0, 1.8, 'mackerel', 0x3a7a8a, 0xf0f0f0, 0x5a9aa8, [['spots', 0xe8b040]]],
  ['Black Sea Bass', 4.5, 1.5, 'bass', 0x2a3038, 0xa8a8a0, 0x3a4048, [['lightspots', 0x8a90a0]]],
  ['Sheepshead', 5.0, 2.5, 'panfish', 0x9a9a90, 0xf0f0f0, 0xa8a8a0, [['bars', 0x1a1a1a]]],
  ['Pompano', 6.0, 1.5, 'jack', 0x9ab0c0, 0xf0e8c0, 0xe8c050, null],
  ['Tautog', 7.0, 3.0, 'grouper', 0x3a3a3a, 0xb8b0a0, 0x4a4a4a, [['blotch', 0x1a1a1a]]],
  ['Spotted Seatrout', 8.0, 1.8, 'perch', 0x7a8a90, 0xe8e8e0, 0x8a9aa0, [['spots', 0x1a2a30]]],
  ['Atlantic Bonito', 9.0, 3.0, 'tuna', 0x2a5a80, 0xe8eef0, 0x4a7a98, [['hstripes', 0x123048]]],
  // --- sport ---
  ['Bluefish', 11, 3.5, 'mackerel', 0x4a7a90, 0xe0e8e8, 0x6a9aa8, null],
  ['Red Drum', 14, 5.0, 'drum', 0xb87a58, 0xe8d8c0, 0xc88a68, [['spots', 0x1a1a1a]]],
  ['Dover Sole', 15, 1.2, 'flat', 0x8a7a5a, 0xe8e0d0, 0x9a8a6a, [['blotch', 0x4a3a2a]]],
  ['Common Octopus', 16, 3.5, 'octopus', 0xa06a4a, 0xe0c0a0, 0xb07a5a, [['spots', 0x6a3a2a]]],
  ['Snook', 18, 4.0, 'barra', 0xa8a888, 0xf0f0e0, 0xb8b898, [['stripe', 0x1a1a1a]]],
  ['Atlantic Cod', 19, 6.0, 'cod', 0x8a7a5a, 0xe8e8d8, 0x9a8a6a, [['spots', 0x5a4a30], ['stripe', 0xe0e0d0]]],
  ['Striped Bass', 20, 6.0, 'bass', 0x5a6a78, 0xe8e8e8, 0x6a7a88, [['hstripes', 0x1a2a30]]],
  ['Red Snapper', 22, 5.0, 'snapper', 0xd84a3a, 0xf0d0c0, 0xe05a48, null],
  ['European Lobster', 24, 1.8, 'lobster', 0x1a2a5a, 0xc8b070, 0x2a3a6a, [['spots', 0xe8b040]]],
  ['King Mackerel', 26, 8.0, 'mackerel', 0x3a5a70, 0xe8eef0, 0x5a7a90, null],
  ['Great Barracuda', 28, 6.0, 'pike', 0x6a8a90, 0xe8e8e8, 0x7a9aa0, [['bars', 0x2a3a40]]],
  ['Mahi-Mahi', 35, 9.0, 'mahi', 0x2aa860, 0xf0d840, 0x3ab8c8, [['spots', 0x1a5a88]]],
  ['Permit', 40, 10, 'jack', 0x8aa0b8, 0xf0f0e8, 0x9ab0c8, null],
  ['Wahoo', 45, 20, 'mackerel', 0x1a4a70, 0xe8e8e8, 0x3a6a88, [['bars', 0x0a2a48]]],
  // --- prize ---
  ['Gag Grouper', 55, 10, 'grouper', 0x6a6a5a, 0xd8d0c0, 0x7a7a6a, [['marble', 0x3a3a30]]],
  ['Yellowtail Amberjack', 60, 15, 'jack', 0x4a7a9a, 0xe8e8e0, 0xe8c840, [['stripe', 0xd8b830]]],
  ['Tope Shark', 65, 20, 'shark', 0x6a7a88, 0xe0e0e0, 0x7a8a98, null],
  ['Conger Eel', 70, 25, 'eel', 0x4a5a60, 0xc8c8c0, 0x5a6a70, null],
  ['Cubera Snapper', 75, 25, 'snapper', 0x8a4a48, 0xe0c8c0, 0x9a5a58, null],
  ['Spotted Eagle Ray', 85, 40, 'ray', 0x2a2a34, 0xf0f0f0, 0x3a3a44, [['lightspots', 0xe8e8f0]]],
  ['Yellowfin Tuna', 90, 40, 'tuna', 0x1a3a68, 0xe8e8e8, 0xe8c030, [['stripe', 0xd8b820]]],
  ['Roosterfish', 95, 20, 'rooster', 0x5a6a80, 0xe8e8e8, 0x2a3a50, [['hstripes', 0x1a2a40]]],
  ['Tarpon', 110, 45, 'barra', 0x7a8a98, 0xf0f0f0, 0x8a9aa8, [['scales', 0x5a6a78]]],
  ['Sailfish', 120, 35, 'sailfish', 0x2a4a80, 0xe8e8e8, 0x2a3a88, [['bars', 0x6ab0d8]]],
  ['Giant Trevally', 130, 30, 'jack', 0x6a7a80, 0xe0e0d8, 0x2a3038, null],
  ['Blacktip Shark', 140, 40, 'shark', 0x7a8a90, 0xf0f0f0, 0x1a1a1a, null],
  ['Atlantic Halibut', 150, 60, 'flat', 0x5a5a4a, 0xf0f0e8, 0x6a6a5a, null],
  // --- trophy ---
  ['Giant Pacific Octopus', 210, 30, 'octopus', 0xb04a38, 0xe0b0a0, 0xc05a48, null],
  ['Ocean Sunfish', 260, 250, 'mola', 0x7a8088, 0xd8d8d0, 0x8a9098, [['blotch', 0x5a6068]]],
  ['Hammerhead Shark', 280, 150, 'hammer', 0x6a7078, 0xe8e8e8, 0x7a8088, null],
  ['Thresher Shark', 290, 160, 'thresher', 0x3a4a68, 0xf0f0f0, 0x4a5a78, null],
  ['Mako Shark', 300, 130, 'shark', 0x2a4a88, 0xf0f0f0, 0x3a5a98, null],
  ['Swordfish', 330, 120, 'marlin', 0x3a4a60, 0xe0e0e0, 0x4a5a70, null],
  ['Goliath Grouper', 360, 180, 'grouper', 0x7a7a5a, 0xd0c8a8, 0x8a8a6a, [['blotch', 0x4a4a30], ['bars', 0x5a5a40]]],
  ['Tiger Shark', 400, 300, 'shark', 0x6a7a80, 0xe8e8e8, 0x7a8a90, [['bars', 0x3a4a50]]],
  ['Bluefin Tuna', 440, 250, 'tuna', 0x1a2a58, 0xe8e8e8, 0x2a3a68, null],
  ['Blue Marlin', 500, 300, 'marlin', 0x1a3a78, 0xf0f0f0, 0x2a4a88, [['bars', 0x6ab0e0]]],
  // --- legend ---
  ['Black Marlin', 640, 350, 'marlin', 0x1a1a2a, 0xe8e8e8, 0x2a2a3a, null],
  ['Manta Ray', 700, 800, 'ray', 0x1a1a24, 0xf0f0f0, 0x2a2a34, [['lightspots', 0xd8d8e0]]],
  ['Oarfish', 760, 90, 'oar', 0xb8c0c8, 0xf0f0f0, 0xe03a3a, [['spots', 0x3a3a48]]],
  ['Giant Squid', 840, 250, 'squid', 0xb04a58, 0xe8c0c8, 0xc05a68, null],
  ['Greenland Shark', 950, 700, 'shark', 0x4a4a48, 0xb8b8b0, 0x5a5a58, null],
  ['Whale Shark', 1200, 9000, 'shark', 0x3a5a70, 0xe8e8e8, 0x4a6a80, [['lightspots', 0xe8f0f0]]],
];

function tierFor(value) {
  if (value < 1) return 0;
  if (value < 10) return 1;
  if (value < 50) return 2;
  if (value < 200) return 3;
  if (value < 600) return 4;
  return 5;
}

export const TIER_NAMES = ['Bait Fish', 'Panfish', 'Sport Fish', 'Prize Fish', 'Trophy', 'Legend'];

const build = (rows, water, offset) => rows.map(([name, value, kg, arch, back, belly, fin, pat], i) => ({
  id: offset + i, name, value, kg, tier: tierFor(value), water,
  style: { arch, back, belly, fin, pat: pat || [] },
}));

export const SPECIES = [...build(RAW, 'fresh', 0), ...build(RAW_SALT, 'salt', RAW.length)];

// Species by tier, per water: 'fresh', 'salt', and 'both' where they meet.
const POOLS = { fresh: [[], [], [], [], [], []], salt: [[], [], [], [], [], []], both: [[], [], [], [], [], []] };
for (const s of SPECIES) { POOLS[s.water][s.tier].push(s); POOLS.both[s.tier].push(s); }
export const SPECIES_BY_TIER = POOLS.fresh;

/** The species a catch can be, by tier band and by the water it is caught in. */
export function speciesInTiers(minTier, maxTier, water = 'fresh') {
  const pool = POOLS[water] || POOLS.fresh;
  const out = [];
  for (let t = minTier; t <= maxTier; t++) out.push(...pool[t]);
  return out;
}

/** Which pool a water kind ('fresh' | 'brackish' | 'salt') draws from. */
export function poolFor(kind) {
  return kind === 'salt' ? 'salt' : kind === 'brackish' ? 'both' : 'fresh';
}
