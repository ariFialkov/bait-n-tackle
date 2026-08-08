// The 60 catchable species. `value` is the inherent average dollar value of the
// species; actual catch value varies with rolled size and is nudged by the RTP
// engine. `kg` is a plausible average weight used for flavor text and to scale
// the size roll. Tiers bucket species for lure/trawl selection:
//   0: bait fish  1: panfish  2: sport fish  3: prize fish  4: trophy  5: legend

const RAW = [
  // [name, avg $, avg kg]
  ['Fathead Minnow', 0.15, 0.01], ['Golden Shiner', 0.20, 0.05],
  ['Creek Chub', 0.25, 0.10], ['Bluegill', 0.40, 0.25],
  ['Pumpkinseed', 0.45, 0.20], ['Green Sunfish', 0.50, 0.20],
  ['Yellow Perch', 0.80, 0.35], ['White Crappie', 1.0, 0.45],
  ['Black Crappie', 1.1, 0.45], ['Rock Bass', 1.2, 0.35],
  ['Brown Bullhead', 1.5, 0.60], ['White Sucker', 1.8, 0.90],
  ['Common Carp', 2.5, 4.5], ['Rainbow Trout', 3.5, 1.5],
  ['Brook Trout', 4.0, 0.9], ['Brown Trout', 5.0, 2.2],
  ['Smallmouth Bass', 6.0, 1.6], ['Largemouth Bass', 8.0, 2.5],
  ['Channel Catfish', 9.0, 4.0], ['Walleye', 11, 2.8],
  ['Sauger', 12, 1.4], ['Northern Pike', 14, 5.5],
  ['Burbot', 16, 3.0], ['Lake Whitefish', 18, 2.5],
  ['Lake Trout', 22, 6.0], ['Kokanee Salmon', 25, 1.5],
  ['Arctic Grayling', 28, 1.1], ['Cutthroat Trout', 32, 2.0],
  ['Tiger Trout', 36, 2.5], ['Steelhead', 42, 4.5],
  ['Freshwater Drum', 48, 5.0], ['Bowfin', 55, 3.5],
  ['Longnose Gar', 65, 6.0], ['Flathead Catfish', 75, 16],
  ['Blue Catfish', 85, 18], ['Muskellunge', 100, 12],
  ['Tiger Muskie', 115, 10], ['Paddlefish', 130, 27],
  ['Alligator Gar', 150, 60], ['Taimen', 170, 30],
  ['Golden Mahseer', 190, 20], ['Murray Cod', 210, 25],
  ['Barramundi', 230, 15], ['Giant Snakehead', 255, 8],
  ['Giant Gourami', 280, 7], ['Clown Knifefish', 310, 5],
  ['Giant Freshwater Stingray', 340, 120], ['Redtail Catfish', 375, 35],
  ['Payara', 410, 8], ['Arapaima', 450, 90],
  ['Goliath Tigerfish', 500, 30], ['Nile Perch', 550, 80],
  ['Wels Catfish', 600, 90], ['Giant Barb', 660, 100],
  ['Mekong Giant Catfish', 730, 150], ['Piraíba Catfish', 800, 120],
  ['Chinese Sturgeon', 880, 200], ['Kaluga Sturgeon', 960, 250],
  ['Beluga Sturgeon', 1050, 350], ['White Sturgeon', 1150, 220],
];

function tierFor(value) {
  if (value < 1) return 0;
  if (value < 10) return 1;
  if (value < 50) return 2;
  if (value < 200) return 3;
  if (value < 600) return 4;
  return 5;
}

export const SPECIES = RAW.map(([name, value, kg], i) => ({
  id: i, name, value, kg, tier: tierFor(value),
}));

export const SPECIES_BY_TIER = [[], [], [], [], [], []];
for (const s of SPECIES) SPECIES_BY_TIER[s.tier].push(s);

export function speciesInTiers(minTier, maxTier) {
  const out = [];
  for (let t = minTier; t <= maxTier; t++) out.push(...SPECIES_BY_TIER[t]);
  return out;
}
