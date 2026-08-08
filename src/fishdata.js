// The 60 catchable species. `value` is the inherent average dollar value of
// the species; actual catch value comes from the isolated-bet engine. `kg`
// is a plausible average weight used for flavor and size scaling.
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

function tierFor(value) {
  if (value < 1) return 0;
  if (value < 10) return 1;
  if (value < 50) return 2;
  if (value < 200) return 3;
  if (value < 600) return 4;
  return 5;
}

export const TIER_NAMES = ['Bait Fish', 'Panfish', 'Sport Fish', 'Prize Fish', 'Trophy', 'Legend'];

export const SPECIES = RAW.map(([name, value, kg, arch, back, belly, fin, pat], i) => ({
  id: i, name, value, kg, tier: tierFor(value),
  style: { arch, back, belly, fin, pat: pat || [] },
}));

export const SPECIES_BY_TIER = [[], [], [], [], [], []];
for (const s of SPECIES) SPECIES_BY_TIER[s.tier].push(s);

export function speciesInTiers(minTier, maxTier) {
  const out = [];
  for (let t = minTier; t <= maxTier; t++) out.push(...SPECIES_BY_TIER[t]);
  return out;
}
