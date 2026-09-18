// Boat skins. A "skin" is really a whole purchasable boat: it shares its
// hull's 3D model and all of its mechanics, but carries its own name, paint,
// price and a small stat spread (speed, handling, wake).
//
// IMPORTANT: none of these numbers touch a bet. A faster, better-handling
// boat lets you get between spots and place wagers sooner; it cannot change
// the odds or the payout of any wager, which are drawn from the paytable in
// rtp.js against the stake alone. Wake size is purely cosmetic.
//
// Paint is the same four-stop ramp the converter bakes against, darkest
// first: an accent that lands in recesses and rigging, the hull colour, a
// lighter deck tone, then near-white trim.

export const RARITY = ['Standard', 'Custom', 'Premium', 'Signature'];

// Price multiplier and stat spread by rarity. Dearer skins are a little
// quicker, a little sharper, and throw a grander wake.
const RARITY_PRICE = [1, 1.7, 2.9, 4.6];
// The starter hull is free, so its fancier paint needs its own floor —
// otherwise every Skiff skin prices at $0 and there is nothing to want.
const RARITY_FLOOR = [0, 140, 380, 850];

/** hull id -> its skins, cheapest first. The first is the hull's default. */
export const SKINS = {
  skiff: [
    { id: 'moss',      name: 'Moss Green',   paint: ['#5d8f8a', '#7fc79a', '#bce3c4', '#eef8ee'] },
    { id: 'duck-egg',  name: 'Duck Egg',     paint: ['#7f97b8', '#8fc9e0', '#c6e6f2', '#eff9fd'] },
    { id: 'sunbleach', name: 'Sunbleached',  paint: ['#c99a5d', '#f2d383', '#f8ecc4', '#fdf8e8'] },
    { id: 'cherry',    name: 'Cherry Bomb',  paint: ['#8a5a7a', '#ef8a92', '#f8c6c9', '#fdeceb'] },
  ],
  cuddy: [
    { id: 'harbour',   name: 'Harbour Blue', paint: ['#b8766c', '#7fb0e0', '#bdd8f0', '#eef5fc'] },
    { id: 'cherry-red', name: 'Cherry Red',  paint: ['#5d7f9a', '#ef7f7f', '#f8c2bd', '#fdeeea'] },
    { id: 'creamsicle', name: 'Creamsicle',  paint: ['#7f9ec4', '#f5b070', '#fad9b4', '#fdf3e6'] },
    { id: 'seafoam',   name: 'Seafoam',      paint: ['#b88f9a', '#8fd6c2', '#c6ece0', '#eefbf6'] },
  ],
  trawler: [
    { id: 'amber',     name: 'Amber Deck',   paint: ['#6f92c0', '#efab63', '#f7d6ab', '#fdf2e2'] },
    { id: 'blue-ridge', name: 'Blue Ridge',  paint: ['#c98f6f', '#7fa8d8', '#c2dbef', '#eff6fc'] },
    { id: 'buttercup', name: 'Buttercup',    paint: ['#7d9a6d', '#f0d878', '#f8ecbc', '#fdf9e8'] },
    { id: 'rose',      name: 'Rose Quartz',  paint: ['#6f8fa8', '#eda3b8', '#f7ceda', '#fdeef3'] },
  ],
  'mud-dredger': [
    { id: 'site',      name: 'Site Yellow',  paint: ['#7d9a6d', '#ecd069', '#f6e8b4', '#fdf9e6'] },
    { id: 'riverbed',  name: 'Riverbed Green', paint: ['#b8946f', '#8fc08a', '#c8e4c2', '#f0f9ee'] },
    { id: 'copper',    name: 'Copper Pan',   paint: ['#6f8fb8', '#e89a70', '#f6cfb6', '#fdf0e8'] },
    { id: 'lilac',     name: 'Lilac Dust',   paint: ['#8f8fb8', '#c2a8e0', '#e0d4f2', '#f6f1fc'] },
  ],
  gillnetter: [
    { id: 'blush',     name: 'Blush Net',    paint: ['#7286bd', '#eaa0b6', '#f6cdd8', '#fdeff3'] },
    { id: 'deepwater', name: 'Deep Water',   paint: ['#c98f7f', '#6fa8d8', '#b8d8ef', '#ecf5fc'] },
    { id: 'mango',     name: 'Mango',        paint: ['#7f9ec4', '#f2a462', '#f9d5ae', '#fdf2e4'] },
    { id: 'fern',      name: 'Fern',         paint: ['#b8809a', '#87c98f', '#c4e7c6', '#effaef'] },
  ],
  paddleboat: [
    { id: 'mint',      name: 'Mint Wheel',   paint: ['#bd7f99', '#7fc9c0', '#bfe6e0', '#eefaf8'] },
    { id: 'delta-rose', name: 'Delta Rose',  paint: ['#6f9aa8', '#efa0ae', '#f8cdd4', '#fdeef1'] },
    { id: 'sunday',    name: 'Sunday Gold',  paint: ['#8f8fbd', '#efc871', '#f8e5b6', '#fdf7e6'] },
    { id: 'bayou',     name: 'Bayou Blue',   paint: ['#c99a7f', '#8fa8e0', '#c8d6f2', '#f0f4fd'] },
  ],
  seiner: [
    { id: 'periwinkle', name: 'Periwinkle',  paint: ['#c9b48f', '#9fb0e8', '#cdd8f2', '#f2f5fd'] },
    { id: 'yellow-jacket', name: 'Yellow Jacket', paint: ['#5d6f8a', '#f2cf5d', '#f9e9ad', '#fdf9e2'] },
    { id: 'coral-run', name: 'Coral Run',    paint: ['#6f9a9a', '#f09080', '#f8c8bd', '#fdeeea'] },
    { id: 'jade',      name: 'Jade Hull',    paint: ['#b8907f', '#7fc2a8', '#bfe2d2', '#effaf5'] },
  ],
  steamboat: [
    { id: 'sunset',    name: 'Sunset Coral', paint: ['#5d9a95', '#f0937c', '#f7c9bb', '#fdeee8'] },
    { id: 'gilded',    name: 'Gilded Cream', paint: ['#a8845d', '#f2dc9a', '#f9eecb', '#fdfaee'] },
    { id: 'violet',    name: 'Royal Violet', paint: ['#7f6f9a', '#b89ae0', '#ddcdf2', '#f6f1fc'] },
    { id: 'emerald',   name: 'Emerald Queen', paint: ['#8a7f5d', '#7fc49a', '#bfe4cd', '#eff9f3'] },
  ],
};

// Per-rarity stat spread, plus a touch of hand-set variance so skins of the
// same hull are not a perfectly even ladder.
const SPREAD = [
  { speed: 0.00, turn: 0.00, wake: 0.85 },
  { speed: 0.22, turn: 0.10, wake: 1.00 },
  { speed: 0.44, turn: 0.20, wake: 1.20 },
  { speed: 0.70, turn: 0.32, wake: 1.45 },
];
const JITTER = [0, 0.06, -0.04, 0.05];   // small per-slot wobble on speed

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
    price: Math.max(RARITY_FLOOR[i],
      Math.round(hull.price * RARITY_PRICE[i] / 10) * 10),
    maxSpeed: +(hull.maxSpeed + SPREAD[i].speed + JITTER[i]).toFixed(2),
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
