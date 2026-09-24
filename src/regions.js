// The map's regions: what kind of water you are on, what it is called, and
// what it looks like. The world is tiled into big cells (jittered, so their
// borders wander), each one a named body of water of one biome — a lake, a
// river, a cove, a lagoon, a marsh, mangroves, falls, rapids, a beaver creek,
// a pond — chosen by a slow temperature field, so the cold country runs to
// pines, coves and falls and the warm to lagoons and mangroves. To the east
// the whole freshwater system runs out into the sea: the water turns
// brackish across a band of deltas and bays, and beyond a single jagged
// coastline the ocean goes on for ever.
//
// Nothing here changes a bet. A region changes the terrain, the water, the
// light, the props and which species can turn up on the line; the payout is
// still the paytable's draw against the stake alone (rtp.js).

import { CONFIG } from './config.js';
import { hash2, mulberry32, fbm, clamp, lerp } from './noise.js';

const S = CONFIG.SEED;
export const CELL = 240;          // metres per region cell
const JITTER = 0.34;              // how far a cell's site wanders from its centre
const BLEND = 70;                 // metres over which two regions cross-fade
export const COAST_X = 760;       // where, on average, the land ends

// --- the biomes ------------------------------------------------------------
//
// terrain: bias (more water / more land), amp (broad relief), detail (shore
//   detail), channel + channelW (how strongly and how narrowly channels are
//   carved), ridge (how high land climbs), flat (compress heights near the
//   waterline into flats), shelf (soft floor: depth stops here), bars
//   (sinuous sandbars).
// water: colours, chop (wave energy), murk (opacity).
// land: shore, grass, forest colours, snowline height (0 = never).
// climate: sky/fog colours, fog range, sun colour + strength, ambient,
//   precip (0..1) and snow (precip is snow when 1), mist.
// props: density weights for props.js.
export const BIOMES = {
  lake: {
    label: 'Lake', names: ['Lake', 'Lake', 'Lake', 'Loch'], fr: 0.2,
    terrain: { bias: -0.9, amp: 1.15, detail: 0.7, channel: 0.5, channelW: 0.86, ridge: 1.0, flat: 1, shelf: 0, bars: 0 },
    water: { shallow: 0x3fa9c9, deep: 0x14607f, chop: 0.08, murk: 0 },
    land: { shore: 0xdcc98d, grass: 0x5f9e4e, forest: 0x3c7442, rock: 0x8a8f87, snow: 12 },
    climate: { sky: 0xbfe3f2, fog: 0xbfe3f2, near: 90, far: 220, sun: 0xfff4e0, sunI: 2.4, amb: 0.75, precip: 0, snow: 0 },
    props: { pine: 0.6, rock: 0.3, reed: 0.15, log: 0.05 },
  },
  river: {
    label: 'River', names: ['River', 'River', 'Waterway', 'Run'], fr: 0.1,
    terrain: { bias: 0.9, amp: 0.9, detail: 0.9, channel: 2.2, channelW: 0.84, ridge: 1.0, flat: 1, shelf: 0, bars: 0 },
    water: { shallow: 0x4faeb8, deep: 0x1d6a76, chop: 0.06, murk: 0.1 },
    land: { shore: 0xd6c48c, grass: 0x649f4c, forest: 0x3c7442, rock: 0x8a8f87, snow: 12 },
    climate: { sky: 0xbfe3f2, fog: 0xbfe3f2, near: 90, far: 220, sun: 0xfff4e0, sunI: 2.4, amb: 0.75, precip: 0, snow: 0 },
    props: { pine: 0.6, rock: 0.35, reed: 0.3, log: 0.12 },
  },
  cove: {
    label: 'Cove', names: ['Cove', 'Cove', 'Inlet', 'Sound'], fr: 0,
    terrain: { bias: 0.2, amp: 1.3, detail: 1.7, channel: 0.9, channelW: 0.86, ridge: 1.35, flat: 1, shelf: 0, bars: 0 },
    water: { shallow: 0x3d97b5, deep: 0x123f5c, chop: 0.15, murk: 0 },
    land: { shore: 0xb8b3a4, grass: 0x5d9550, forest: 0x35683d, rock: 0x848a86, snow: 9 },
    climate: { sky: 0xb7d2df, fog: 0xb7d2df, near: 80, far: 200, sun: 0xfff0dc, sunI: 2.3, amb: 0.7, precip: 0, snow: 0 },
    props: { pine: 0.7, rock: 0.9, boulder: 0.4, driftwood: 0.2 },
  },
  lagoon: {
    label: 'Lagoon', names: ['Lagoon', 'Lagoon', 'Shallows'], fr: 0,
    terrain: { bias: -0.5, amp: 0.8, detail: 0.5, channel: 0.3, channelW: 0.86, ridge: 0.8, flat: 1, shelf: 2.6, bars: 1.2 },
    water: { shallow: 0x66e0d6, deep: 0x2aa8b0, chop: 0.04, murk: 0 },
    land: { shore: 0xf0e6c0, grass: 0x7fb85a, forest: 0x4d8a48, rock: 0x9a968c, snow: 0 },
    climate: { sky: 0xcbeefa, fog: 0xcbeefa, near: 100, far: 240, sun: 0xfff8e8, sunI: 2.7, amb: 0.8, precip: 0, snow: 0 },
    props: { palm: 0.5, reed: 0.25, rock: 0.1, driftwood: 0.25 },
  },
  marsh: {
    label: 'Marsh', names: ['Marsh', 'Marsh', 'Fen', 'Bog'], fr: 0,
    terrain: { bias: -0.25, amp: 0.6, detail: 0.4, channel: 0.8, channelW: 0.86, ridge: 0.7, flat: 0.32, shelf: 2.2, bars: 0 },
    water: { shallow: 0x7a8f52, deep: 0x3f5a38, chop: 0.02, murk: 0.5 },
    land: { shore: 0x8f8a5a, grass: 0x8faa4e, forest: 0x5d7a3a, rock: 0x7f7c70, snow: 0 },
    climate: { sky: 0xc9d8cf, fog: 0xcdd9cc, near: 55, far: 160, sun: 0xf6ecd4, sunI: 2.0, amb: 0.85, precip: 0.55, snow: 0 },
    props: { reed: 1.0, cattail: 0.8, lily: 0.8, log: 0.35, stick: 0.3, pine: 0.15 },
  },
  mangrove: {
    label: 'Mangroves', names: ['Mangroves', 'Mangroves', 'Swamp', 'Bayou'], fr: 0,
    terrain: { bias: -0.3, amp: 0.6, detail: 0.5, channel: 0.9, channelW: 0.86, ridge: 0.6, flat: 0.4, shelf: 2.4, bars: 0 },
    water: { shallow: 0x5f9f7a, deep: 0x25604c, chop: 0.02, murk: 0.45 },
    land: { shore: 0x9a8c60, grass: 0x6fa64f, forest: 0x3f7a45, rock: 0x86826f, snow: 0 },
    climate: { sky: 0xd6e6d0, fog: 0xd8e4cf, near: 45, far: 150, sun: 0xffeccf, sunI: 2.2, amb: 0.9, precip: 0.25, snow: 0 },
    props: { mangrove: 1.0, reed: 0.4, log: 0.3, lily: 0.2 },
  },
  falls: {
    label: 'Falls', names: ['Falls', 'Falls', 'Cascades'], fr: 0.1,
    terrain: { bias: 1.0, amp: 1.4, detail: 1.2, channel: 1.4, channelW: 0.85, ridge: 2.0, flat: 1, shelf: 0, bars: 0 },
    water: { shallow: 0x4fb3c4, deep: 0x145a72, chop: 0.12, murk: 0 },
    land: { shore: 0xb9b4a6, grass: 0x5a9450, forest: 0x33663b, rock: 0x8a8f8c, snow: 10 },
    climate: { sky: 0xb9d4e6, fog: 0xbcd3e2, near: 85, far: 210, sun: 0xfff2e2, sunI: 2.5, amb: 0.75, precip: 0.35, snow: 1 },
    props: { pine: 0.7, snowpine: 0.4, rock: 0.7, boulder: 0.6 },
  },
  rapids: {
    label: 'Rapids', names: ['Rapids', 'Rapids', 'Run', 'Narrows'], fr: 0,
    terrain: { bias: 1.0, amp: 1.0, detail: 1.1, channel: 2.8, channelW: 0.9, ridge: 1.2, flat: 1, shelf: 0, bars: 0 },
    water: { shallow: 0x66c2d4, deep: 0x1f6f86, chop: 0.2, murk: 0.05 },
    land: { shore: 0xc9bfa0, grass: 0x5f9e4e, forest: 0x3c7442, rock: 0x8a8f87, snow: 11 },
    climate: { sky: 0xbfe3f2, fog: 0xbfe3f2, near: 90, far: 220, sun: 0xfff4e0, sunI: 2.4, amb: 0.75, precip: 0, snow: 0 },
    props: { pine: 0.6, rock: 0.5, boulder: 1.0, log: 0.15 },
  },
  beaver: {
    label: 'Beaver creek', names: ['Creek', 'Creek', 'Brook', 'Ponds'], fr: 0.1,
    terrain: { bias: 0.6, amp: 0.75, detail: 0.7, channel: 1.9, channelW: 0.86, ridge: 0.9, flat: 0.6, shelf: 3, bars: 0 },
    water: { shallow: 0x6aa88a, deep: 0x2e5f4f, chop: 0.02, murk: 0.3 },
    land: { shore: 0xc4b48a, grass: 0x6aa04e, forest: 0x3c7442, rock: 0x8a8f87, snow: 0 },
    climate: { sky: 0xc4e3ee, fog: 0xc4e3ee, near: 85, far: 210, sun: 0xfff2dc, sunI: 2.3, amb: 0.8, precip: 0, snow: 0 },
    props: { pine: 0.5, reed: 0.6, cattail: 0.4, lily: 0.5, log: 0.4, stick: 0.7 },
  },
  pond: {
    label: 'Pond', names: ['Pond', 'Pond', 'Tarn', 'Mere'], fr: 0.15,
    terrain: { bias: 0.6, amp: 0.55, detail: 0.5, channel: 1.2, channelW: 0.86, ridge: 0.9, flat: 0.7, shelf: 3.5, bars: 0 },
    water: { shallow: 0x58a89a, deep: 0x246556, chop: 0.01, murk: 0.25 },
    land: { shore: 0xcdbd8e, grass: 0x6ca350, forest: 0x3c7442, rock: 0x8a8f87, snow: 0 },
    climate: { sky: 0xc4e3ee, fog: 0xc4e3ee, near: 85, far: 210, sun: 0xfff2dc, sunI: 2.3, amb: 0.8, precip: 0, snow: 0 },
    props: { pine: 0.5, reed: 0.6, lily: 0.9, cattail: 0.5, log: 0.2 },
  },
  delta: {
    label: 'Delta', names: ['Delta', 'Delta', 'Flats', 'Estuary'], fr: 0,
    terrain: { bias: -0.5, amp: 0.7, detail: 0.5, channel: 2.0, channelW: 0.82, ridge: 0.6, flat: 0.45, shelf: 3.2, bars: 0.7 },
    water: { shallow: 0x8fb7a3, deep: 0x3f7a78, chop: 0.08, murk: 0.35 },
    land: { shore: 0xd9cfa0, grass: 0x9fb45e, forest: 0x5e8a48, rock: 0x8f8c80, snow: 0 },
    climate: { sky: 0xc6e1ec, fog: 0xc6e1ec, near: 80, far: 210, sun: 0xfff4e2, sunI: 2.4, amb: 0.8, precip: 0, snow: 0 },
    props: { reed: 0.7, driftwood: 0.4, stick: 0.3, log: 0.15, palm: 0.1 },
  },
  bay: {
    label: 'Bay', names: ['Bay', 'Bay', 'Sound', 'Harbour'], fr: 0,
    terrain: { bias: -1.4, amp: 1.2, detail: 1.0, channel: 0.7, channelW: 0.86, ridge: 1.3, flat: 1, shelf: 0, bars: 0 },
    water: { shallow: 0x4aa9c4, deep: 0x14506e, chop: 0.35, murk: 0 },
    land: { shore: 0xd8cca0, grass: 0x679a52, forest: 0x3c7442, rock: 0x878c88, snow: 0 },
    climate: { sky: 0xb9dcef, fog: 0xb9dcef, near: 95, far: 230, sun: 0xfff6e6, sunI: 2.5, amb: 0.75, precip: 0, snow: 0 },
    props: { pine: 0.4, rock: 0.6, boulder: 0.3, driftwood: 0.4, stack: 0.3 },
  },
  ocean: {
    label: 'Open sea', names: ['Sea', 'Sea', 'Ocean', 'Reach'], fr: 0,
    terrain: { bias: -1.4, amp: 1.2, detail: 1.0, channel: 0.7, channelW: 0.86, ridge: 1.3, flat: 1, shelf: 0, bars: 0 },
    water: { shallow: 0x2f8fb9, deep: 0x0b3a63, chop: 1.0, murk: 0 },
    land: { shore: 0xd8cca0, grass: 0x679a52, forest: 0x3c7442, rock: 0x878c88, snow: 0 },
    climate: { sky: 0xa9d3ee, fog: 0xb3d6ec, near: 110, far: 260, sun: 0xfff6e8, sunI: 2.6, amb: 0.7, precip: 0, snow: 0 },
    props: { stack: 0.5, rock: 0.2 },
  },
};
export const BIOME_IDS = Object.keys(BIOMES);
// Every prop weight present on every biome, so a missing one reads as none.
const PROP_KEYS = ['pine', 'snowpine', 'rock', 'boulder', 'reed', 'cattail', 'lily', 'log', 'stick', 'mangrove', 'palm', 'driftwood', 'stack'];
for (const b of Object.values(BIOMES)) for (const k of PROP_KEYS) b.props[k] = b.props[k] || 0;

// Which biomes the country runs to, by how warm it is there.
const WARM = ['lake', 'river', 'lagoon', 'lagoon', 'marsh', 'mangrove', 'mangrove', 'rapids', 'pond', 'river'];
const COLD = ['lake', 'lake', 'river', 'cove', 'cove', 'falls', 'falls', 'rapids', 'beaver', 'pond'];
const MILD = ['lake', 'lake', 'river', 'river', 'cove', 'lagoon', 'marsh', 'falls', 'rapids', 'beaver', 'pond', 'mangrove'];

// --- names -----------------------------------------------------------------
const FIRST = [
  'Heron', 'Pike', 'Loon', 'Otter', 'Beaver', 'Kingfisher', 'Osprey', 'Willow', 'Alder',
  'Birch', 'Cedar', 'Hemlock', 'Tamarack', 'Aspen', 'Fox', 'Bear', 'Elk', 'Moose', 'Wolf',
  'Lynx', 'Raven', 'Crane', 'Grebe', 'Teal', 'Mallard', 'Sturgeon', 'Trout', 'Perch',
  'Walleye', 'Char', 'Grayling', 'Silver', 'Copper', 'Iron', 'Slate', 'Granite', 'Amber',
  'Mist', 'Thunder', 'Whisper', 'Echo', 'Hollow', 'Lost', 'Hidden', 'Quiet', 'Broken',
  'Crooked', 'Long', 'Little', 'Cold', 'Black', 'Blue', 'Green', 'Golden', 'Grey',
  "Hunter's", "Miller's", "Fisher's", "Widow's", "Parson's", 'Ashby', 'Cardwell', 'Dunmore',
  'Ellery', 'Farrow', 'Halden', 'Kestrel', 'Lorne', 'Marlow', 'Norrish', 'Penrose', 'Rowan',
  'Selkirk', 'Thorne', 'Verity', 'Wexford', 'Yarrow', 'Bracken', 'Juniper', 'Tallow',
];
const ADJ = ['Old', 'Upper', 'Lower', 'Far', 'North', 'South', 'East', 'West', 'Great', 'Little'];
const FR = ['du Loup', 'du Héron', 'des Brumes', 'du Cerf', 'du Castor', 'de la Lune', 'des Sapins',
  'du Renard', "de l'Ours", 'du Saumon', 'Perdu', 'Caché', 'des Îles', 'Tranquille'];

function pick(rng, list) { return list[Math.floor(rng() * list.length) % list.length]; }

/** A name for a region of this biome. Deterministic per seed. */
export function regionName(type, seed) {
  const rng = mulberry32(seed);
  const b = BIOMES[type];
  if (b.fr && rng() < b.fr) return `Lac ${pick(rng, FR)}`;
  const first = pick(rng, FIRST);
  const kind = pick(rng, b.names);
  const adj = rng() < 0.22 ? pick(rng, ADJ) + ' ' : '';
  if (type === 'ocean') return `${first} ${kind}`;
  return `${adj}${first} ${kind}`;
}

/** A name for a landmark of a kind: 'peak' | 'hill' | 'beach' | 'rock' | 'dam' | 'falls' | 'point'. */
export function landmarkName(kind, seed) {
  const rng = mulberry32(seed);
  const first = pick(rng, FIRST);
  switch (kind) {
    case 'peak': return `Mount ${first.replace(/'s$/, '')}`;
    case 'hill': return `${first} Hill`;
    case 'beach': return `${first} Beach`;
    case 'rock': return rng() < 0.5 ? `${first} Rock` : `${first} Island`;
    case 'dam': return `${first} Dam`;
    case 'falls': return `${first} Falls`;
    case 'point': return rng() < 0.5 ? `${first} Point` : `${first} Head`;
    default: return first;
  }
}

// --- the fields -------------------------------------------------------------

/** Where the land ends at this z: the coastline, jagged at two scales. */
export function coastX(z) {
  return COAST_X + 150 * fbm(z * 0.0025 + 3.3, 7.7, 3, S + 601) + 30 * fbm(z * 0.02, 1.1, 2, S + 613);
}

/** How salt the water is: 0 fresh, 1 the open sea. */
export function salinity(x, z) {
  const c = coastX(z);
  const t = clamp((x - (c - 420)) / 420, 0, 1);
  return t * t * (3 - 2 * t);
}

/** 'fresh' | 'brackish' | 'salt' for the fishing that happens here. */
export function waterKind(x, z) {
  const s = salinity(x, z);
  return s < 0.3 ? 'fresh' : s < 0.7 ? 'brackish' : 'salt';
}

/** −1 cold .. 1 warm, slow across the map. */
export function temperature(x, z) {
  return fbm(x * 0.0011 + 5.5, z * 0.0011 - 2.2, 2, S + 707) * 1.6;
}

// --- cells -------------------------------------------------------------------
const cells = new Map();

function cellKey(cx, cz) { return (cx + 100000) * 200003 + (cz + 100000); }

/** The region whose site sits in cell (cx, cz), built once. */
export function cellRegion(cx, cz) {
  const k = cellKey(cx, cz);
  let r = cells.get(k);
  if (r) return r;
  const seed = (hash2(cx, cz, S + 811) * 4294967295) >>> 0;
  const rng = mulberry32(seed);
  const x = (cx + 0.5 + (rng() - 0.5) * 2 * JITTER) * CELL;
  const z = (cz + 0.5 + (rng() - 0.5) * 2 * JITTER) * CELL;
  const coast = coastX(z);
  let type;
  if (x > coast + 30) type = 'ocean';
  else if (x > coast - 360) type = rng() < 0.5 ? 'bay' : 'delta';
  else {
    const temp = temperature(x, z);
    const list = temp > 0.18 ? WARM : temp < -0.18 ? COLD : MILD;
    type = pick(rng, list);
  }
  r = {
    cx, cz, x, z, type, seed,
    biome: BIOMES[type],
    name: regionName(type, seed ^ 0x5bd1e995),
    temp: temperature(x, z),
    flow: null,       // filled in by terrain.js for the running water
  };
  cells.set(k, r);
  return r;
}

/**
 * The two regions nearest a point and how much of each it is: `a` is the
 * nearest, `t` runs 0 on the border with `b` to 1 well inside `a`. One
 * reused result object, so copy what you keep.
 */
const blendOut = { a: null, b: null, t: 1, wa: 1, wb: 0 };
const nearCache = new Map();   // cell -> the nine regions whose sites might be nearest in it
function nearSites(cx, cz) {
  const k = cellKey(cx, cz);
  let list = nearCache.get(k);
  if (list) return list;
  list = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) list.push(cellRegion(cx + dx, cz + dz));
  nearCache.set(k, list);
  return list;
}
export function regionBlend(x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  const near = nearSites(cx, cz);
  let a = null, b = null, da = Infinity, db = Infinity;
  for (let i = 0; i < 9; i++) {
    const r = near[i];
    const ex = r.x - x, ez = r.z - z;
    const d = ex * ex + ez * ez;
    if (d < da) { b = a; db = da; a = r; da = d; }
    else if (d < db) { b = r; db = d; }
  }
  da = Math.sqrt(da); db = Math.sqrt(db);
  const t = clamp((db - da) / BLEND, 0, 1);
  blendOut.a = a; blendOut.b = b || a; blendOut.t = t;
  blendOut.wa = 0.5 + 0.5 * t; blendOut.wb = 0.5 - 0.5 * t;
  return blendOut;
}

/** The region a point is in (the nearest site). */
export function regionAt(x, z) {
  return regionBlend(x, z).a;
}

/** A blended terrain/water/climate parameter at a point. */
export function paramAt(x, z, group, name) {
  const bl = regionBlend(x, z);
  return bl.a.biome[group][name] * bl.wa + bl.b.biome[group][name] * bl.wb;
}

/** Blend two packed colours by weight of the first. */
export function mixHex(h1, h2, w) {
  const r = ((h1 >> 16) & 255) * w + ((h2 >> 16) & 255) * (1 - w);
  const g = ((h1 >> 8) & 255) * w + ((h2 >> 8) & 255) * (1 - w);
  const b = (h1 & 255) * w + (h2 & 255) * (1 - w);
  return { r: r / 255, g: g / 255, b: b / 255 };
}

export { lerp };
