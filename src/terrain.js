// The ground under the water, and the things built into it.
//
// Height is a seeded, domain-warped fbm shaped by whichever regions a point
// lies between (regions.js): a lake sits lower and deeper, a river is land
// cut by winding channels, a marsh is flats compressed toward the waterline,
// a lagoon has a soft floor and sandbars, falls country climbs steeply.
// East of the coastline the ground drops away to the ocean floor and keeps
// going. On top of that each region builds its own features — waterfalls
// with cliffs and plunge pools, beaver dams thrown across creeks, boulders
// and white water through rapids, sea stacks off the coast — and picks out
// the landmarks worth a name. Everything is deterministic in the seed and
// cached per cell, so the same stretch of country is always the same.

import { CONFIG } from './config.js';
import { fbm, mulberry32, hash2, clamp, lerp } from './noise.js';
import { CELL, COAST_X, cellRegion, regionBlend, regionAt, coastX, landmarkName, setLandmarkLister } from './regions.js';

/**
 * A landmark, named lazily: the name looks at the other landmarks of its
 * basin (to rank the like-named apart), and those cells must be built first.
 */
function landmark(kind, x, z, seed, cx, cz) {
  return {
    kind, x, z, seed, cx, cz, _name: null,
    get name() { if (this._name === null) this._name = landmarkName(this.kind, this.seed, this.cx, this.cz); return this._name; },
  };
}
setLandmarkLister((cells) => { const out = []; for (const [cx, cz] of cells) out.push(...cellFeatures(cx, cz).landmarks); return out; });

const S = CONFIG.SEED;

function ss(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** The channel ridge field, 0..1: above ~0.86 the ground is cut into a channel. */
export function channelField(x, z) {
  return 1 - Math.abs(fbm(x * 0.006 + 3.1, z * 0.006 - 4.7, 2, S + 51));
}

/** Terrain height without any built feature: the country as the noise made it. */
export function baseHeight(x, z) {
  const bl = regionBlend(x, z);
  const A = bl.a.biome.terrain, B = bl.b.biome.terrain, wa = bl.wa, wb = bl.wb;

  // Domain warp for organic, uneven shorelines.
  const wx = x + 34 * fbm(x * 0.009 + 13.7, z * 0.009 + 7.1, 3, S + 11);
  const wz = z + 34 * fbm(x * 0.009 - 8.2, z * 0.009 + 21.4, 3, S + 23);

  const flat = A.flat * wa + B.flat * wb;
  let h = fbm(wx * 0.016, wz * 0.016, 4, S) * 8 * (A.amp * wa + B.amp * wb);   // broad land/water masses
  // Shoreline detail — damped on the flats, where a hand's breadth of noise
  // over a shallow would otherwise speckle it with invisible dry patches.
  h += fbm(x * 0.06, z * 0.06, 3, S + 37) * 1.1 * (A.detail * wa + B.detail * wb) * flat;
  h += 1.4 + (A.bias * wa + B.bias * wb);

  // Carve winding channels between basins: a river is mostly this.
  const c = channelField(x, z);
  const th = A.channelW * wa + B.channelW * wb;
  if (c > th) h -= (c - th) * 55 * (A.channel * wa + B.channel * wb);

  // Falls country climbs; the shoreline itself stays where it is.
  const ridge = A.ridge * wa + B.ridge * wb;
  if (h > 0.7) h = 0.7 + (h - 0.7) * ridge;

  // Marshes and deltas: everything near the waterline pressed into flats.
  if (flat < 0.999) h *= lerp(1, flat, ss(3, 0, Math.abs(h)));

  // A lagoon has a floor not far down.
  const shelf = A.shelf * wa + B.shelf * wb;
  if (shelf > 0.01 && h < -shelf) h = -shelf + (h + shelf) * 0.25;

  // ... and sinuous bars that break the surface as sand.
  const bars = A.bars * wa + B.bars * wb;
  if (bars > 0.01 && h < 0.5 && h > -3) {
    const r = 1 - Math.abs(fbm(x * 0.03 + 9, z * 0.03 - 5, 2, S + 91));
    if (r > 0.8) h += (r - 0.8) * bars * 9;
  }

  // The coast: the land ends, and the floor falls away under the sea.
  if (x > COAST_X - 300) {
    const cx = coastX(z);
    if (x > cx - 70) {
      const k = ss(cx - 70, cx + 30, x);
      const ocean = -6 - 14 * ss(0, 320, x - cx) + 1.6 * fbm(x * 0.01 + 2, z * 0.01, 2, S + 77);
      h = lerp(h, ocean, k);
    }
  }
  return h;
}

// --- features ------------------------------------------------------------------

const feats = new Map();
const BUMP_R = 44;   // no feature reaches further than this from its point

function fkey(cx, cz) { return (cx + 100000) * 200003 + (cz + 100000); }

/** Height added by a feature at a point (its cliff, its dam, its stack). */
function bumpOf(f, x, z) {
  const dx = x - f.x, dz = z - f.z;
  if (Math.abs(dx) > f.reach || Math.abs(dz) > f.reach) return 0;
  if (f.kind === 'falls') {
    const along = dx * f.nx + dz * f.nz;            // inland from the lip
    const across = dx * f.nz - dz * f.nx;
    const halfW = f.w / 2;
    // The cliff the water comes off: a block with a sheer face behind the lip ...
    let b = 5.5 * ss(1.6, 3.0, along) * ss(halfW + 12, halfW + 3, Math.abs(across)) * ss(44, 30, along);
    // ... with the stream's gully cut into the top of it ...
    b -= 1.2 * ss(1.5, 0.3, Math.abs(across) / Math.max(1, halfW)) * ss(2.2, 3.6, along) * ss(44, 34, along);
    // ... and the plunge pool it has dug below.
    b -= 4.0 * ss(12, 0, Math.hypot(along, across * 0.75)) * ss(3, -2, along);
    return b;
  }
  if (f.kind === 'dam') {
    const along = dx * f.ax + dz * f.az;
    const across = dx * f.az - dz * f.ax;
    // The wings reach in from each bank; the gap between them (if it is
    // open) is left as the creek bed it always was.
    const gapK = f.gap > 0 ? ss(f.gap / 2 - 0.4, f.gap / 2 + 1.2, Math.abs(along)) : 1;
    const k = ss(2.0, 0.7, Math.abs(across)) * ss(f.len / 2 + 1.5, f.len / 2 - 1, Math.abs(along)) * gapK;
    if (k <= 0) return 0;
    return k * Math.max(0, 0.55 - baseHeight(x, z));
  }
  if (f.kind === 'lodge') {
    const d = Math.hypot(dx, dz);
    const k = ss(f.r + 0.8, f.r * 0.3, d);
    return k > 0 ? k * Math.max(0, 0.9 - baseHeight(x, z)) : 0;
  }
  if (f.kind === 'stack') {
    const d = Math.hypot(dx, dz);
    const k = ss(f.r * 1.7, f.r * 0.5, d);
    return k > 0 ? k * Math.max(0, 2.2 - baseHeight(x, z)) : 0;
  }
  return 0;
}

function bumpSum(list, x, z) {
  let b = 0;
  for (let i = 0; i < list.length; i++) b += bumpOf(list[i], x, z);
  return b;
}

function bumpAt(x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  let b = bumpSum(cellFeatures(cx, cz).bumps, x, z);
  const fx = x - cx * CELL, fz = z - cz * CELL;
  if (fx < BUMP_R) b += bumpSum(cellFeatures(cx - 1, cz).bumps, x, z);
  else if (fx > CELL - BUMP_R) b += bumpSum(cellFeatures(cx + 1, cz).bumps, x, z);
  if (fz < BUMP_R) b += bumpSum(cellFeatures(cx, cz - 1).bumps, x, z);
  else if (fz > CELL - BUMP_R) b += bumpSum(cellFeatures(cx, cz + 1).bumps, x, z);
  return b;
}

// Terrain height in meters relative to water level (negative = under water).
export function terrainHeight(x, z) {
  return baseHeight(x, z) + bumpAt(x, z);
}

export function waterDepth(x, z) {
  const h = terrainHeight(x, z);
  return h < 0 ? -h : 0;
}

/** Is this dam open right now: a session-wide roll on a twenty-minute clock. */
const DAM_CLOCK = Math.floor(Date.now() / 1200000);
export function damOpen(seed) {
  return hash2(seed & 0xffff, (seed >>> 16) + DAM_CLOCK, S + 55) < 0.75;
}

/**
 * The boulders framing a waterfall: along both edges of the lip, at the
 * foot, and in the river above. Data here (nav.js makes them solid); props.js
 * draws them.
 */
function fallsRocks(f) {
  const rng = mulberry32(f.seed);
  const px = f.nz, pz = -f.nx;
  const rocks = [];
  for (const s of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const along = 1.2 + i * 1.6 + rng() * 0.6, across = s * (f.w / 2 + 0.5 + i * 0.7);
      rocks.push({ x: f.x + f.nx * along + px * across, z: f.z + f.nz * along + pz * across, s: 1.0 + rng() * 0.8, r: rng() * 6.28, at: 'lip' });
    }
    for (let i = 0; i < 2; i++) {
      const along = -0.5 - i * 2.2, across = s * (f.w / 2 + 0.6 + rng() * 1.2);
      rocks.push({ x: f.x + f.nx * along + px * across, z: f.z + f.nz * along + pz * across, s: 0.9 + rng() * 0.9, r: rng() * 6.28, at: 'foot', y: -0.45 + rng() * 0.2 });
    }
  }
  for (const along of [11, 22, 33]) {
    const across = (rng() - 0.5) * f.w * 0.8;
    rocks.push({ x: f.x + f.nx * along + px * across, z: f.z + f.nz * along + pz * across, s: 0.5 + rng() * 0.6, r: rng() * 6.28, at: 'river' });
  }
  return rocks;
}

/** Uphill direction and slope at a point (base terrain). */
function gradient(x, z, e = 4) {
  const gx = (baseHeight(x + e, z) - baseHeight(x - e, z)) / (2 * e);
  const gz = (baseHeight(x, z + e) - baseHeight(x, z - e)) / (2 * e);
  const g = Math.hypot(gx, gz);
  return { gx, gz, g, nx: g > 1e-6 ? gx / g : 1, nz: g > 1e-6 ? gz / g : 0 };
}

/** Distance along a direction to the first land (base h > 0.3), or Infinity within `max`. */
function landAlong(x, z, dx, dz, max) {
  for (let d = 1; d <= max; d += 1) {
    if (baseHeight(x + dx * d, z + dz * d) > 0.3) return d;
  }
  return Infinity;
}

/**
 * Everything a region cell builds, generated once: the features that shape
 * the ground (bumps), the props that dress them, the landmarks that name
 * the place, and the hotspots they make.
 */
export function cellFeatures(cx, cz) {
  const k = fkey(cx, cz);
  let f = feats.get(k);
  if (f) return f;
  f = { bumps: [], falls: [], dams: [], lodges: [], boulders: [], foam: [], stacks: [], landmarks: [], hotspots: [] };
  feats.set(k, f);            // registered first: nothing below may recurse into it

  const r = cellRegion(cx, cz);
  const rng = mulberry32((hash2(cx, cz, S + 917) * 4294967295) >>> 0);
  const ox = cx * CELL, oz = cz * CELL;
  const inCell = (x, z) => regionAt(x, z) === r;
  const pt = () => ({ x: ox + 12 + rng() * (CELL - 24), z: oz + 12 + rng() * (CELL - 24) });
  const type = r.type;

  // Running water has a direction: downhill to the sea, more or less.
  r.flow = (rng() - 0.5) * 1.8;

  if (type === 'falls' || type === 'cove') {
    const want = type === 'falls' ? 6 : 2;
    for (let i = 0; i < 240 && f.falls.length < want; i++) {
      const p = pt();
      const h = baseHeight(p.x, p.z);
      if (h > -1.2 || h < -4.5 || !inCell(p.x, p.z)) continue;
      const g = gradient(p.x, p.z, 5);
      if (g.g < 0.25) continue;
      const ds = landAlong(p.x, p.z, g.nx, g.nz, 14);
      if (!Number.isFinite(ds)) continue;
      if (baseHeight(p.x + g.nx * (ds + 10), p.z + g.nz * (ds + 10)) < 4.5) continue;   // no cliff to come off
      const lx = p.x + g.nx * (ds + 2.5), lz = p.z + g.nz * (ds + 2.5);
      if (f.falls.some((o) => Math.hypot(o.x - lx, o.z - lz) < 42)) continue;
      const fall = {
        kind: 'falls', x: lx, z: lz, nx: g.nx, nz: g.nz, w: 5 + rng() * 4, reach: BUMP_R,
        // The plunge pool: just off the foot of the falls, where it digs deepest.
        pool: { x: lx - g.nx * 5.5, z: lz - g.nz * 5.5 }, seed: (rng() * 1e9) | 0,
      };
      fall.rocks = fallsRocks(fall);
      f.falls.push(fall); f.bumps.push(fall);
      f.landmarks.push(landmark('falls', lx + g.nx * 4, lz + g.nz * 4, fall.seed, cx, cz));
      f.hotspots.push({ x: fall.pool.x, z: fall.pool.z, strength: 1.3, phase: rng() * Math.PI * 2, lureIdx: Math.floor(rng() * 8) });
    }
  }

  if (type === 'beaver' || ((type === 'river' || type === 'pond') && rng() < 0.6)) {
    const want = type === 'beaver' ? 5 : 1;
    for (let i = 0; i < 420 && f.dams.length < want; i++) {
      const p = pt();
      const h = baseHeight(p.x, p.z);
      if (h > -0.4 || h < -3.5 || !inCell(p.x, p.z)) continue;
      let best = null;
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI;
        const dx = Math.cos(ang), dz = Math.sin(ang);
        const d1 = landAlong(p.x, p.z, dx, dz, 24), d2 = landAlong(p.x, p.z, -dx, -dz, 24);
        const sum = d1 + d2;
        if (Number.isFinite(sum) && sum >= 8 && sum <= 46 && (!best || sum < best.sum)) best = { dx, dz, d1, d2, sum };
      }
      if (!best) continue;
      // Centre the dam in the channel.
      const mid = (best.d1 - best.d2) / 2;
      const x = p.x + best.dx * mid, z = p.z + best.dz * mid;
      if (f.dams.some((o) => Math.hypot(o.x - x, o.z - z) < 45)) continue;
      const dam = { kind: 'dam', x, z, ax: best.dx, az: best.dz, len: best.sum + 1, reach: 28, seed: (rng() * 1e9) | 0 };
      // Three dams in four are still being built: two wings and a gap a
      // boat can take. Which ones re-rolls every twenty minutes, each on
      // its own clock, so a closed creek is open another day.
      dam.open = damOpen(dam.seed);
      dam.gap = dam.open ? Math.max(8, Math.min(13, dam.len * 0.38)) : 0;
      f.dams.push(dam); f.bumps.push(dam);
      f.landmarks.push(landmark('dam', x, z, dam.seed, cx, cz));
      // The lodge: a dome of sticks in the water off one end of the dam.
      for (let j = 0; j < 16; j++) {
        const side = rng() < 0.5 ? 1 : -1;
        const lx = x + (-best.dz) * side * (5 + rng() * 8) + best.dx * (rng() - 0.5) * 8;
        const lz = z + best.dx * side * (5 + rng() * 8) + best.dz * (rng() - 0.5) * 8;
        const lh = baseHeight(lx, lz);
        if (lh < -1.9 || lh > -0.5) continue;
        const lodge = { kind: 'lodge', x: lx, z: lz, r: 1.9 + rng() * 0.8, reach: 6, seed: (rng() * 1e9) | 0 };
        f.lodges.push(lodge); f.bumps.push(lodge);
        break;
      }
    }
  }

  if (type === 'rapids') {
    // Boulders along the strait's edges funnel the water, and plenty stand
    // mid-stream for it to break round — enough to make the run rough, but
    // never two mid-stream rocks so close that a hull cannot get between
    // them, so there is always a line through.
    for (let i = 0; i < 900 && f.boulders.length < 64; i++) {
      const p = pt();
      const h = baseHeight(p.x, p.z);
      if (!inCell(p.x, p.z)) continue;
      const edge = h < -0.3 && h > -2.2;
      const mid = h <= -2.2 && h > -12 && rng() < 0.45;
      if (!edge && !mid) continue;
      if (f.boulders.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 3.4)) continue;
      if (mid && f.boulders.some((o) => o.mid && Math.hypot(o.x - p.x, o.z - p.z) < 7)) continue;
      f.boulders.push({ x: p.x, z: p.z, h, mid, s: (mid ? 1.0 : 0.75) + rng() * 1.1, r: rng() * Math.PI * 2 });
    }
  }

  if (type === 'ocean' || type === 'bay') {
    for (let i = 0; i < 60 && f.stacks.length < 4; i++) {
      const p = pt();
      const h = baseHeight(p.x, p.z);
      if (h > -1.5 || h < -9) continue;
      if (type === 'ocean' && p.x > coastX(p.z) + 150) continue;
      if (f.stacks.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 25)) continue;
      const st = { kind: 'stack', x: p.x, z: p.z, r: 1.1 + rng() * 1.2, h: 4 + rng() * 5, reach: 8, seed: (rng() * 1e9) | 0 };
      f.stacks.push(st); f.bumps.push(st);
    }
  }

  // --- landmarks: the high ground, the beaches, the rocks, the headlands ---
  const N = 12, step = CELL / N;
  const grid = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = ox + (i + 0.5) * step, z = oz + (j + 0.5) * step;
      grid.push({ x, z, h: baseHeight(x, z) });
    }
  }
  const ring = (x, z, rad, test) => {
    let n = 0;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      if (test(baseHeight(x + Math.cos(ang) * rad, z + Math.sin(ang) * rad))) n++;
    }
    return n;
  };
  let top = null;
  for (const g of grid) if ((!top || g.h > top.h) && inCell(g.x, g.z)) top = g;
  if (top && top.h >= 5 && rng() < 0.8) {
    const kind = top.h >= 9 ? 'peak' : 'hill';
    f.landmarks.push(landmark(kind, top.x, top.z, (rng() * 1e9) | 0, cx, cz));
  }
  if (rng() < 0.65) {
    let beach = null, bestN = 0;
    for (const g of grid) {
      if (g.h < 0.05 || g.h > 0.9 || !inCell(g.x, g.z)) continue;
      const gr = gradient(g.x, g.z, 6);
      if (gr.g > 0.11) continue;
      let n = 0;
      for (const o of grid) if (o !== g && Math.abs(o.x - g.x) <= step * 1.5 && Math.abs(o.z - g.z) <= step * 1.5 && o.h > 0.05 && o.h < 0.9) n++;
      if (n > bestN) { bestN = n; beach = g; }
    }
    if (beach && bestN >= 3) f.landmarks.push(landmark('beach', beach.x, beach.z, (rng() * 1e9) | 0, cx, cz));
  }
  if (rng() < 0.6) {
    for (const g of grid) {
      if (g.h < 0.4 || g.h > 4 || !inCell(g.x, g.z)) continue;
      if (ring(g.x, g.z, 14, (h) => h < -0.3) === 8) {
        f.landmarks.push(landmark('rock', g.x, g.z, (rng() * 1e9) | 0, cx, cz));
        break;
      }
    }
  }
  if ((type === 'ocean' || type === 'bay' || type === 'delta') && rng() < 0.7) {
    for (const g of grid) {
      if (g.h < 0.5 || g.h > 6 || !inCell(g.x, g.z)) continue;
      const wet = ring(g.x, g.z, 18, (h) => h < -0.3);
      if (wet >= 5 && wet <= 7) {
        f.landmarks.push(landmark('point', g.x, g.z, (rng() * 1e9) | 0, cx, cz));
        break;
      }
    }
  }
  return f;
}

