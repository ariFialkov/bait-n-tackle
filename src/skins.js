// Boat skins. A "skin" is really a whole purchasable boat: it shares its
// hull's 3D model and all of its mechanics, but carries its own name, paint,
// price and a small stat spread (speed, handling, wake).
//
// IMPORTANT: none of these numbers touch a bet. A faster, better-handling
// boat lets you get between spots and place wagers sooner; it cannot change
// the odds or the payout of any wager, which are drawn from the paytable in
// rtp.js against the stake alone. Wake size is purely cosmetic.
//
// Two paint STYLES, one palette format:
//   clean — every component of the boat is one flat colour with a hard
//           edge. The stops mean: fittings, hull, deck, superstructure.
//           This is the cartoon look and the majority of the lower tiers.
//   camo  — the brightness bake: four soft bands following the model's
//           own shading, busy and patchy. The stops mean: accent, hull
//           colour, lighter tone, trim. Reserved for the themed high tiers.
// Either way the stops must climb in brightness.

export const RARITY = ['Standard', 'Custom', 'Premium', 'Signature'];

// Skins are a small side-spend, not a progression grind — the game is the
// betting. The whole fleet spans roughly $0.50 to $100.
const RARITY_PRICE = [1, 1.45, 2.05, 2.75];
// The starter skiff is free, so its fancier paint needs its own floor —
// otherwise every skiff skin prices at $0 and there is nothing to want.
const RARITY_FLOOR = [0, 0.5, 1.5, 3];

// Every hull's default skin wears the same livery, so the fleet reads as one
// family before you start customising: charcoal fittings, a deep blue hull,
// an orange deck and off-white superstructure.
const CLASSIC = ['#2e3944', '#3f79b0', '#f0913f', '#f4f1e8'];

// Simple clean colourways: a coloured hull under a cream deck and white
// cabin, with dark fittings. One colour per component, nothing busy.
const CLEAN = {
  seafoam:   { name: 'Seafoam',      paint: ['#2b3d3a', '#5fb8a6', '#f6efdc', '#ffffff'] },
  signal:    { name: 'Signal Red',   paint: ['#3a1f1f', '#d8453a', '#f4e6d0', '#fbf7f0'] },
  sunflower: { name: 'Sunflower',    paint: ['#3a3218', '#f2c531', '#f7f1e2', '#ffffff'] },
  forest:    { name: 'Forest',       paint: ['#1f2e22', '#3f7a4f', '#efe8d2', '#fbf9f2'] },
  navy:      { name: 'Navy & Cream', paint: ['#1b2536', '#2c4a7a', '#f2ead6', '#faf6ee'] },
  lilac:     { name: 'Lilac',        paint: ['#332a3d', '#9a86c9', '#f3eef8', '#ffffff'] },
  mint:      { name: 'Mint',         paint: ['#243a33', '#8fd6bd', '#f4f9f2', '#ffffff'] },
  tangerine: { name: 'Tangerine',    paint: ['#3d2612', '#f28c28', '#f8f0e2', '#ffffff'] },
  sky:       { name: 'Sky',          paint: ['#233647', '#7fc2e8', '#f5f9fc', '#ffffff'] },
  slate:     { name: 'Slate',        paint: ['#1e2429', '#5c6b78', '#e9edf0', '#ffffff'] },
  cherry:    { name: 'Cherry',       paint: ['#3b1a22', '#c9264a', '#f6e8ec', '#ffffff'] },
  sand:      { name: 'Sand',         paint: ['#3c3222', '#d9bf8a', '#f6f0e4', '#ffffff'] },
  lime:      { name: 'Lime',         paint: ['#2a3a14', '#a9d43c', '#f5f8ea', '#ffffff'] },
  plum:      { name: 'Plum',         paint: ['#2a1a2e', '#7b3f7e', '#f2e8f2', '#ffffff'] },
  coral:     { name: 'Coral',        paint: ['#3a2420', '#f0806a', '#faeee8', '#ffffff'] },
  teal:      { name: 'Teal',         paint: ['#1c3338', '#2f8a96', '#eaf3f4', '#ffffff'] },
  cobalt:    { name: 'Cobalt',       paint: ['#141e3a', '#2f55c4', '#eef1fa', '#ffffff'] },
  rust:      { name: 'Rust',         paint: ['#2e1c14', '#b8542c', '#f4ebe2', '#ffffff'] },
};

const classic = () => ({ id: 'classic', name: 'Classic', paint: CLASSIC, rarity: 0, style: 'clean' });
const clean = (id, rarity = 1) => ({ id, ...CLEAN[id], rarity, style: 'clean' });
const camo = (id, name, paint, rarity) => ({ id, name, paint, rarity, style: 'camo' });

/** hull id -> its skins, in shop order. The first is the hull's default. */
export const SKINS = {
  skiff: [
    classic(), clean('seafoam'), clean('signal'),
    camo('clownfish', 'Clownfish',     ['#1d232b', '#e8641e', '#f5a05a', '#f7f3ea'], 2),
    camo('camo',      'Woodland Camo', ['#20261c', '#4a5a38', '#8a9464', '#d8d8bc'], 2),
    camo('rescue',    'Rescue Orange', ['#1c232b', '#2e3d4a', '#f2622e', '#f4f4f0'], 3),
  ],
  speedboat: [
    classic(), clean('cherry'), clean('sky'),
    camo('neon',    'Neon Night', ['#12101f', '#3b2a8f', '#d93ba8', '#7ff0e0'], 2),
    camo('patriot', 'Patriot',    ['#16233f', '#1f3f8f', '#c8353c', '#f5f3ee'], 2),
    camo('stealth', 'Stealth',    ['#101317', '#2d343d', '#5a636f', '#aab4bf'], 3),
  ],
  cuddy: [
    classic(), clean('navy'), clean('sunflower'),
    camo('koi',    'Koi',           ['#2a1f22', '#c14a2e', '#f2a893', '#faf6f2'], 2),
    camo('sunset', 'Sunset Cruise', ['#2b1d33', '#a8467a', '#f08a5d', '#f9e6c8'], 2),
    camo('arctic', 'Arctic',        ['#233240', '#4f7d99', '#a9cede', '#f4fafd'], 3),
  ],
  trawler: [
    classic(), clean('forest'), clean('rust'),
    camo('copper', 'Copper Bottom', ['#241c18', '#7a4326', '#c9834a', '#f0e2cf'], 2),
    camo('hazard', 'Hazard Stripe', ['#1a1a18', '#3a3a35', '#e8c02a', '#f6f2df'], 2),
    camo('trout',  'Rainbow Trout', ['#243038', '#5e7f8f', '#d98aa0', '#f2f0ea'], 3),
  ],
  'mud-dredger': [
    classic(), clean('sand'), clean('lime'),
    camo('desert',  'Desert Runner', ['#2b2119', '#8a5a2e', '#d8a85e', '#f4ead2'], 2),
    camo('piranha', 'Piranha',       ['#1b1f1c', '#4a5347', '#c0562f', '#e8e2cf'], 2),
    camo('tiger',   'Tiger Shark',   ['#1f2429', '#4a5560', '#93a1ac', '#e9edef'], 3),
  ],
  gillnetter: [
    classic(), clean('teal'), clean('tangerine'),
    camo('gulf',   'Gulf Stream',  ['#0f2a30', '#1f6b70', '#57b8ad', '#e6f7f2'], 2),
    camo('tang',   'Blue Tang',    ['#101c2e', '#2a5fd0', '#e8c53d', '#f4f2ec'], 2),
    camo('carbon', 'Carbon Fibre', ['#22262b', '#525c67', '#8e99a4', '#d8e0e6'], 3),
  ],
  paddleboat: [
    classic(), clean('mint'), clean('plum'),
    camo('angel',    'Angelfish', ['#241a2e', '#6a4a9e', '#e0b84a', '#f6f0e2'], 2),
    camo('marlin',   'Marlin',    ['#101e2e', '#1f5a8f', '#6fa8c9', '#eef4f7'], 2),
    camo('mandarin', 'Mandarin',  ['#16243a', '#1f6fa8', '#e07a30', '#f3efe4'], 3),
  ],
  seiner: [
    classic(), clean('cobalt'), clean('coral'),
    camo('whale',    'Whale Shark', ['#1b2a38', '#33566e', '#7d98ad', '#e8eef2'], 2),
    camo('deepsea',  'Deep Sea',    ['#0b1522', '#1d4665', '#3f88a8', '#b3ddea'], 2),
    camo('lionfish', 'Lionfish',    ['#231a1f', '#a8372f', '#e0a06a', '#f6efe6'], 3),
  ],
  steamboat: [
    classic(), clean('slate'), clean('lilac'),
    camo('sturgeon',   'Sturgeon Steel', ['#1c2024', '#455059', '#8d9aa4', '#e4e9ec'], 2),
    camo('nightwatch', 'Nightwatch',     ['#111a2b', '#2b4370', '#a68743', '#e9e0c9'], 2),
    camo('puffer',     'Pufferfish',     ['#23201a', '#8a7a3a', '#d8c266', '#f4efd8'], 3),
  ],
};

// Per-rarity stat spread. Speed is a FRACTION of the hull's top speed rather
// than an absolute, so the ladder stays meaningful whatever the speed range
// is set to.
const SPREAD = [
  { speed: 0.000, turn: 0.00, wake: 0.85 },
  { speed: 0.022, turn: 0.10, wake: 1.00 },
  { speed: 0.045, turn: 0.20, wake: 1.20 },
  { speed: 0.075, turn: 0.32, wake: 1.45 },
];
// A touch of hand-set variance by shop slot, so two skins of the same rarity
// are not an identical pair of numbers.
const JITTER = [0, 0.004, -0.006, 0.005, -0.003, 0.006];

/** Round to a tidy shelf price: cents under $10, whole dollars above. */
function shelfPrice(v) {
  if (v <= 0) return 0;
  if (v < 10) return Math.round(v * 20) / 20;      // nearest 5c
  return Math.round(v);
}

export function skinKey(hullId, skinId) { return `${hullId}:${skinId}`; }

/** Every skin of a hull, resolved with price, rarity and stat deltas. */
export function hullSkins(hull) {
  const list = SKINS[hull.id] || [];
  return list.map((s, i) => {
    const r = s.rarity ?? 0;
    return {
      ...s,
      key: skinKey(hull.id, s.id),
      hullId: hull.id,
      rarity: r,
      rarityName: RARITY[r],
      style: s.style || 'clean',
      price: Math.max(RARITY_FLOOR[r], shelfPrice(hull.price * RARITY_PRICE[r])),
      maxSpeed: +(hull.maxSpeed * (1 + SPREAD[r].speed + (JITTER[i] || 0))).toFixed(2),
      turn: +(hull.turn + SPREAD[r].turn).toFixed(2),
      wake: SPREAD[r].wake,
    };
  });
}

/** Flat list of every purchasable skin across a fleet. */
export function allSkins(boats) {
  const out = [];
  for (const hull of boats) out.push(...hullSkins(hull));
  return out;
}
