// Boat skins. A "skin" is really a whole purchasable boat: it shares its
// hull's 3D model and all of its mechanics, but carries its own name, paint,
// price and a small stat spread (speed, handling, wake).
//
// IMPORTANT: none of these numbers touch a bet. A faster, better-handling
// boat lets you get between spots and place wagers sooner; it cannot change
// the odds or the payout of any wager, which are drawn from the paytable in
// rtp.js against the stake alone. Wake size is purely cosmetic.
//
// Paint is the four-stop ramp the converter bakes against, and the stops must
// climb in brightness: an accent that lands in recesses and rigging, the hull
// colour (the biggest share of the surface), a lighter deck tone, then trim.
// The ramp is a brightness ramp, not a stencil, so a theme is expressed as a
// palette — a clownfish skin is black/orange/white, not actual stripes.

export const RARITY = ['Standard', 'Custom', 'Premium', 'Signature'];

// Skins are a small side-spend, not a progression grind — the game is the
// betting. The whole fleet spans roughly $0.50 to $100.
const RARITY_PRICE = [1, 1.45, 2.05, 2.75];
// The starter skiff is free, so its fancier paint needs its own floor —
// otherwise every skiff skin prices at $0 and there is nothing to want.
const RARITY_FLOOR = [0, 0.5, 1.5, 3];

// Every hull's default skin wears the same livery, so the fleet reads as one
// family before you start customising: charcoal in the recesses, a deep blue
// hull, orange upperworks and off-white trim.
const CLASSIC = ['#2e3944', '#3f79b0', '#f0913f', '#f4f1e8'];

/** hull id -> its skins, cheapest first. The first is the hull's default. */
export const SKINS = {
  skiff: [
    { id: 'classic',   name: 'Classic',        paint: CLASSIC },
    { id: 'clownfish', name: 'Clownfish',      paint: ['#1d232b', '#e8641e', '#f5a05a', '#f7f3ea'] },
    { id: 'camo',      name: 'Woodland Camo',  paint: ['#20261c', '#4a5a38', '#8a9464', '#d8d8bc'] },
    { id: 'rescue',    name: 'Rescue Orange',  paint: ['#1c232b', '#2e3d4a', '#f2622e', '#f4f4f0'] },
  ],
  speedboat: [
    { id: 'classic',   name: 'Classic',        paint: CLASSIC },
    { id: 'neon',      name: 'Neon Night',     paint: ['#12101f', '#3b2a8f', '#d93ba8', '#7ff0e0'] },
    { id: 'patriot',   name: 'Patriot',        paint: ['#16233f', '#1f3f8f', '#c8353c', '#f5f3ee'] },
    { id: 'stealth',   name: 'Stealth',        paint: ['#101317', '#2d343d', '#5a636f', '#aab4bf'] },
  ],
  cuddy: [
    { id: 'classic',   name: 'Classic',        paint: CLASSIC },
    { id: 'koi',       name: 'Koi',            paint: ['#2a1f22', '#c14a2e', '#f2a893', '#faf6f2'] },
    { id: 'sunset',    name: 'Sunset Cruise',  paint: ['#2b1d33', '#a8467a', '#f08a5d', '#f9e6c8'] },
    { id: 'arctic',    name: 'Arctic',         paint: ['#233240', '#4f7d99', '#a9cede', '#f4fafd'] },
  ],
  trawler: [
    { id: 'classic',   name: 'Classic',        paint: CLASSIC },
    { id: 'copper',    name: 'Copper Bottom',  paint: ['#241c18', '#7a4326', '#c9834a', '#f0e2cf'] },
    { id: 'hazard',    name: 'Hazard Stripe',  paint: ['#1a1a18', '#3a3a35', '#e8c02a', '#f6f2df'] },
    { id: 'trout',     name: 'Rainbow Trout',  paint: ['#243038', '#5e7f8f', '#d98aa0', '#f2f0ea'] },
  ],
  'mud-dredger': [
    { id: 'classic',   name: 'Classic',        paint: CLASSIC },
    { id: 'desert',    name: 'Desert Runner',  paint: ['#2b2119', '#8a5a2e', '#d8a85e', '#f4ead2'] },
    { id: 'piranha',   name: 'Piranha',        paint: ['#1b1f1c', '#4a5347', '#c0562f', '#e8e2cf'] },
    { id: 'tiger',     name: 'Tiger Shark',    paint: ['#1f2429', '#4a5560', '#93a1ac', '#e9edef'] },
  ],
  gillnetter: [
    { id: 'classic',   name: 'Classic',        paint: CLASSIC },
    { id: 'gulf',      name: 'Gulf Stream',    paint: ['#0f2a30', '#1f6b70', '#57b8ad', '#e6f7f2'] },
    { id: 'tang',      name: 'Blue Tang',      paint: ['#101c2e', '#2a5fd0', '#e8c53d', '#f4f2ec'] },
    { id: 'carbon',    name: 'Carbon Fibre',   paint: ['#22262b', '#525c67', '#8e99a4', '#d8e0e6'] },
  ],
  paddleboat: [
    { id: 'classic',   name: 'Classic',        paint: CLASSIC },
    { id: 'angel',     name: 'Angelfish',      paint: ['#241a2e', '#6a4a9e', '#e0b84a', '#f6f0e2'] },
    { id: 'marlin',    name: 'Marlin',         paint: ['#101e2e', '#1f5a8f', '#6fa8c9', '#eef4f7'] },
    { id: 'mandarin',  name: 'Mandarin',       paint: ['#16243a', '#1f6fa8', '#e07a30', '#f3efe4'] },
  ],
  seiner: [
    { id: 'classic',   name: 'Classic',        paint: CLASSIC },
    { id: 'whale',     name: 'Whale Shark',    paint: ['#1b2a38', '#33566e', '#7d98ad', '#e8eef2'] },
    { id: 'deepsea',   name: 'Deep Sea',       paint: ['#0b1522', '#1d4665', '#3f88a8', '#b3ddea'] },
    { id: 'lionfish',  name: 'Lionfish',       paint: ['#231a1f', '#a8372f', '#e0a06a', '#f6efe6'] },
  ],
  steamboat: [
    { id: 'classic',   name: 'Classic',        paint: CLASSIC },
    { id: 'sturgeon',  name: 'Sturgeon Steel', paint: ['#1c2024', '#455059', '#8d9aa4', '#e4e9ec'] },
    { id: 'nightwatch', name: 'Nightwatch',    paint: ['#111a2b', '#2b4370', '#a68743', '#e9e0c9'] },
    { id: 'puffer',    name: 'Pufferfish',     paint: ['#23201a', '#8a7a3a', '#d8c266', '#f4efd8'] },
  ],
};

// Per-rarity stat spread. Speed is a FRACTION of the hull's top speed rather
// than an absolute, so the ladder stays meaningful whatever the speed range
// is set to. Plus a touch of hand-set variance so skins of the same hull are
// not a perfectly even ladder.
const SPREAD = [
  { speed: 0.000, turn: 0.00, wake: 0.85 },
  { speed: 0.022, turn: 0.10, wake: 1.00 },
  { speed: 0.045, turn: 0.20, wake: 1.20 },
  { speed: 0.075, turn: 0.32, wake: 1.45 },
];
const JITTER = [0, 0.006, -0.004, 0.005];   // small per-slot wobble on speed

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
  return list.map((s, i) => ({
    ...s,
    key: skinKey(hull.id, s.id),
    hullId: hull.id,
    rarity: i,
    rarityName: RARITY[i],
    price: Math.max(RARITY_FLOOR[i], shelfPrice(hull.price * RARITY_PRICE[i])),
    maxSpeed: +(hull.maxSpeed * (1 + SPREAD[i].speed + JITTER[i])).toFixed(2),
    turn: +(hull.turn + SPREAD[i].turn).toFixed(2),
    wake: SPREAD[i].wake,
  }));
}

/** Flat list of every purchasable skin across a fleet. */
export function allSkins(boats) {
  const out = [];
  for (const hull of boats) out.push(...hullSkins(hull));
  return out;
}
