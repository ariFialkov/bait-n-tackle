// Marinas: small coastal outposts that generate deterministically along the
// shoreline as the lake streams in. Pull up to one and the boat store opens.
//
// Catches are paid at the rail, so there is nothing to haul ashore and a
// marina is a shop, never a chore — the only reason to look for one is to
// spend money on a boat.
//
// Placement is seeded per chunk so the same stretch of river always has the
// same outposts, and a marina only exists where there is genuine shoreline
// with navigable water in front of it.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { terrainHeight, waterDepth, isNavigable } from './lake.js';
import { registerObstacle } from './nav.js';
import { separateHulls } from './hullphysics.js';
import { hash2, mulberry32 } from './noise.js';
import { basinOf, basinWord } from './regions.js';
import { BOATS, fleetCatalog, resolveBoat } from './boats.js';
import { loadHull } from './boat.js';
import { applySkin } from './skinner.js';
import { stationsFor } from './stations.js';

const S = CONFIG.SEED;
export const DOCK_RADIUS = 8;        // how close you must be to trigger
export const DOCK_HINT_RANGE = 170;  // how far away the HUD points one out
const PIER_HALF_WIDTH = 1.6;         // planking, plus the bumper buoys

// --- placement -----------------------------------------------------------

const dockCache = new Map();

/** Deterministic docks for a chunk: [] or a single { x, z, angle }. Cached: one object per marina. */
export function chunkDocks(cx, cz) {
  const k = cx + '|' + cz;
  let d = dockCache.get(k);
  if (!d) { d = placeDock(cx, cz); dockCache.set(k, d); }
  return d;
}

function placeDock(cx, cz) {
  // The outpost gate and the placement rolls are unchanged from when fish
  // markets shared the shoreline, so every marina that exists today stands
  // exactly where it always did. Chunks that used to roll a market get
  // nothing at all, and one in five of the surviving marinas is culled on
  // top of that.
  if (hash2(cx, cz, S + 401) > 0.36) return [];
  const rng = mulberry32((hash2(cx, cz, S + 409) * 1e9) | 0);
  const size = CONFIG.CHUNK_SIZE;
  const ox = cx * size, oz = cz * size;

  for (let attempt = 0; attempt < 24; attempt++) {
    const x = ox + (rng() - 0.5) * (size - 10);
    const z = oz + (rng() - 0.5) * (size - 10);
    const h = terrainHeight(x, z);
    if (h < 0.15 || h > 1.6) continue;              // must be right at the shore

    // Downhill direction = toward open water.
    const e = 2.5;
    const gx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
    const gz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
    const gl = Math.hypot(gx, gz);
    if (gl < 0.25) continue;                        // too flat to read a shoreline
    const dx = -gx / gl, dz = -gz / gl;

    // The pier runs out over the water; its head needs room for a boat.
    const pierLen = 7 + rng() * 3;
    const hx = x + dx * pierLen, hz = z + dz * pierLen;
    if (waterDepth(hx, hz) < 1.4) continue;
    // Keep the approach clear a bit further out, too.
    if (waterDepth(x + dx * (pierLen + 6), z + dz * (pierLen + 6)) < 1.0) continue;
    // And make sure there is real land behind the shack.
    if (terrainHeight(x - dx * 5, z - dz * 5) < 1.0) continue;

    // How wide the water is here: a pier thrust across a narrow stream would
    // bar it, so in a narrow waterway the marina lies along the bank instead,
    // its pier parallel to the shore a few metres out.
    // (Measured from where the water gets real, past the shelving shore.)
    let across = 60, started = false;
    for (let t = 2; t <= 60; t += 2) {
      const dep = waterDepth(x + dx * t, z + dz * t);
      if (!started) { if (dep >= 1.0) started = true; continue; }
      if (dep < 0.8) { across = t; break; }
    }
    let along = null;
    if (across < 34) {
      const ox2 = x + dx * 4, oz2 = z + dz * 4;
      if (waterDepth(ox2, oz2) < 1.3) continue;
      let best = null, bestRun = 0;
      for (const [tx, tz] of [[dz, -dx], [-dz, dx]]) {
        let run = 0;
        for (let t = 2; t <= 40; t += 2) { if (waterDepth(ox2 + tx * t, oz2 + tz * t) < 1.0) break; run = t; }
        if (run > bestRun) { bestRun = run; best = [tx, tz]; }
      }
      if (!best || bestRun < 12) continue;
      along = { x: ox2, z: oz2, tx: best[0], tz: best[1], run: bestRun };
    }

    // Same draw, same position in the sequence, as the old market/marina
    // split — so the marinas that survive are the ones that were already
    // marinas. The old markets are simply gone.
    if (rng() < 0.62) return [];
    if (rng() < 0.20) return [];      // and thin the rest by a fifth

    const dock = along ? {
      x: along.x, z: along.z, cx, cz,
      headX: along.x + along.tx * pierLen, headZ: along.z + along.tz * pierLen,
      angle: Math.atan2(along.tx, along.tz),
      pierLen: Math.min(Math.max(pierLen, 18), along.run),
      key: `${cx}|${cz}`,
      big: rng() < 0.4,
      alongBank: true,
    } : {
      x, z, cx, cz,
      headX: hx, headZ: hz,
      angle: Math.atan2(dx, dz),
      pierLen,
      key: `${cx}|${cz}`,
      // Two in five are big harbours: more rows of slips, more boats.
      big: rng() < 0.4,
      alongBank: false,
    };
    layoutHarbour(dock);
    dock.name = marinaName(dock);
    dock.stockEpoch = stockEpoch();
    dock.stock = marinaStock(dock, dock.stockEpoch);
    return [dock];
  }
  return [];
}

// --- the harbour's lot -----------------------------------------------------
//
// A marina is laid out like a car park: a main pier runs out from the shore
// and rows of fingers stand off it on both sides, a slip beside each finger.
// The rows nearest the shore take the small boats, the rows further out
// the middling ones; anything bigger lies at a mooring in a line beyond
// the head, on a rope to a buoy. The lot is only as long as the water
// allows: each row is added while there is depth for the main pier, the
// finger tips and the slips, so a creek marina gets a short lot and a lake
// marina the whole thing.
const SMALL_PITCH = 4.4, SMALL_FINGER = 6.8, SMALL_MAX = 7.2;      // skiff, speedboat, cuddy
const MED_PITCH = 6.8, MED_FINGER = 12.6, MED_MAX = 12.8;          // trawler, dredger, gillnetter
const PIER_W = 2.8;

function layoutHarbour(dock) {
  const dx = Math.sin(dock.angle), dz = Math.cos(dock.angle), rx = dz, rz = -dx;
  const at = (ax, az) => waterDepth(dock.x + dx * az + rx * ax, dock.z + dz * az + rz * ax);
  // Which sides of the pier a row at z0 has water for: the finger's tip and
  // the slip beside it both need depth, and so does the pier itself there.
  const sidesAt = (z0, pitch, finger) => {
    if (at(0, z0 + pitch) < 1.3) return [];
    const sides = [];
    for (const s of [1, -1]) {
      if (at(s * (PIER_W / 2 + finger), z0) < 0.9) continue;
      if (at(s * (PIER_W / 2 + finger * 0.55), z0 + pitch * 0.5) < 1.0) continue;
      sides.push(s);
    }
    return sides;
  };
  // Each wanted row goes at the first z out from the last where at least one
  // side has water; the pier runs on out through the shallows to reach it.
  const place = (z, pitch, finger, small) => {
    for (let zz = z; zz <= z + 14; zz += 2) {
      const sides = sidesAt(zz, pitch, finger);
      if (sides.length) return { z: zz, small, sides };
    }
    return null;
  };
  const wantSmall = dock.big ? 3 : 2, wantMed = dock.big ? 2 : 1;
  const rows = [];
  let z = 4.5;
  // Along a bank the lot cannot run past the water the pier was laid on.
  const zMax = dock.alongBank ? dock.pierLen - 2 : 60;
  for (let i = 0; i < wantSmall; i++) { const r = place(z, SMALL_PITCH, SMALL_FINGER, true); if (!r || r.z + SMALL_PITCH > zMax) break; rows.push(r); z = r.z + SMALL_PITCH; }
  for (let i = 0; i < wantMed; i++) { const r = place(z, MED_PITCH, MED_FINGER, false); if (!r || r.z + MED_PITCH > zMax) break; rows.push(r); z = r.z + MED_PITCH; }
  // The main pier runs a little past the last row to the fuel dock at its
  // head; every row was placed where the pier had water, so it always can.
  if (rows.length && !dock.alongBank) {
    const L = Math.max(dock.pierLen, z + 1.5);
    dock.pierLen = L;
    dock.headX = dock.x + dx * L; dock.headZ = dock.z + dz * L;
  }
  dock.rows = rows;

  // The buildings: which build, and whether each stands on the ground or
  // goes out over the water on a platform. Decided here so the solid
  // planking is known before anything is drawn.
  const rng = mulberry32((hash2(dock.cx, dock.cz, S + 443) * 1e9) | 0);
  dock.wallColor = WALLS[Math.floor(rng() * WALLS.length)];
  dock.roofColor = ROOFS[Math.floor(rng() * ROOFS.length)];
  const kind = dock.kind = Math.floor(rng() * 3);
  const hx = kind === 2 ? -5.4 : -4.4, hz = kind === 2 ? -3.2 : -4.2, hry = kind === 2 ? 0.25 : 0.12;
  const hw = kind === 2 ? 10.6 : 8.2, hd = kind === 2 ? 7.0 : 8.0;
  const ground = groundUnder(dock, hx, hz, hw, hd, hry);
  // Which side of the pier has the water, for anything that must go afloat.
  const waterSide = at(-8, 3) >= at(8, 3) ? -1 : 1;
  if (ground.ok) dock.house = { onLand: true, x: hx, z: hz, ry: hry, w: hw, d: hd, y0: Math.max(0.6, ground.hi + 0.25), lo: ground.lo };
  else {
    const px = waterSide * (PIER_W / 2 + hw / 2 + 0.6), pz = 1.0 + hd / 2;
    dock.house = { onLand: false, x: px, z: pz, ry: 0, w: hw, d: hd, y0: 0.6, side: waterSide };
    for (const row of rows) if (row.z < pz + hd / 2 + 1) row.blocked = waterSide;
  }
  const icy = groundUnder(dock, 4.4, -1.6, 4.6, 3.6, -0.4);
  if (icy.ok) dock.stand = { onLand: true, x: 4.4, z: -1.6, ry: -0.4, y: Math.max(0.5, icy.hi + 0.1), down: icy.hi - icy.lo + 1.4 };
  else {
    const sx = dock.house.onLand ? waterSide : -waterSide;
    dock.stand = { onLand: false, x: sx * (PIER_W / 2 + 2.8), z: 2.4, ry: sx * Math.PI / 2, y: 0.5, down: 2.6 };
    for (const row of rows) if (row.z < 4.6) row.blocked = row.blocked ?? sx;
  }

  // The solid planking, as rectangles in the marina's frame: {x, z, w, d}
  // (w across the pier, d along it). Hulls cannot pass through these.
  const solids = [{ x: 0, z: dock.pierLen / 2, w: PIER_W + 0.4, d: dock.pierLen + 1.2 }];
  for (const row of rows) {
    const finger = row.small ? SMALL_FINGER : MED_FINGER;
    for (const s of row.sides) if (row.blocked !== s) solids.push({ x: s * (PIER_W / 2 + finger / 2), z: row.z, w: finger, d: 1.5 });
  }
  if (!dock.house.onLand) solids.push({ x: dock.house.x, z: dock.house.z, w: hw + 1.6, d: hd + 1.6 });
  if (!dock.stand.onLand) solids.push({ x: dock.stand.x, z: dock.stand.z, w: 3.4, d: 4.4 });
  dock.solids = solids;
}

/** Is a point inside a marina's planking? Registered with nav.js as an obstacle. */
export function dockSolidAt(x, z) {
  const size = CONFIG.CHUNK_SIZE;
  const cx = Math.round(x / size), cz = Math.round(z / size);
  for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
    for (const d of chunkDocks(cx + ix, cz + iz)) {
      const wx = x - d.x, wz = z - d.z;
      if (Math.abs(wx) > 50 || Math.abs(wz) > 50) continue;
      const dx = Math.sin(d.angle), dz = Math.cos(d.angle);
      const az = wx * dx + wz * dz, ax = wx * dz - wz * dx;
      for (const r of d.solids) if (Math.abs(ax - r.x) <= r.w / 2 && Math.abs(az - r.z) <= r.d / 2) return true;
    }
  }
  return false;
}
registerObstacle(dockSolidAt);

// --- berthing ------------------------------------------------------------

/** How much water a hull of this size wants under it to look afloat. */
function hullDraft(length) { return 0.5 + length * 0.045; }

/**
 * Is a hull lying at (cx,cz) along (dx,dz) properly afloat? Every point of
 * the footprint needs its draft, and a margin all round it — scaled to the
 * boat — needs to be navigable too, so a big hull is never left kissing the
 * beach with one quarter.
 */
function hullClearance(cx, cz, dx, dz, length, halfBeam) {
  const rx = dz, rz = -dx;                       // across the hull
  const need = CONFIG.MIN_NAV_DEPTH + hullDraft(length);
  const margin = 1.2 + length * 0.05;
  const ringL = (length / 2 + margin) / (length / 2);
  const ringB = (halfBeam + margin) / halfBeam;
  let worst = Infinity;
  for (const along of [-0.5, -0.34, -0.17, 0, 0.17, 0.34, 0.5]) {
    for (const across of [-1, 0, 1]) {
      const x = cx + dx * length * along + rx * halfBeam * across;
      const z = cz + dz * length * along + rz * halfBeam * across;
      worst = Math.min(worst, waterDepth(x, z) - need);
      // The same point pushed out to the margin ring, which only has to be
      // navigable — the hull should not be left kissing the beach either.
      const mx = cx + dx * length * along * ringL + rx * halfBeam * across * ringB;
      const mz = cz + dz * length * along * ringL + rz * halfBeam * across * ringB;
      worst = Math.min(worst, isNavigable(mx, mz) ? waterDepth(mx, mz) - CONFIG.MIN_NAV_DEPTH : -9);
      if (!isNavigable(x, z)) worst = Math.min(worst, -9);
    }
  }
  return worst;
}

/**
 * Where a boat should be lying when it is handed over at a marina: alongside
 * the pier rather than through it, bow to open water, and far enough out that
 * its whole length floats with room around it.
 *
 * The far end matters most. A hull lying beside the pier runs half its length
 * back toward the shore, and on a 26m steamboat that is further than the pier
 * itself is long — so the stern ends up over the beach unless the berth is
 * pushed seaward by the difference. That, plus a draft and a margin that both
 * scale with the boat, is what keeps a big hull out of the marina it just
 * bought its way out of.
 * Returns { x, z, heading }, or null if nothing fits (then leave it be).
 */
export function berthFor(dock, halfBeam, length) {
  const dx = Math.sin(dock.angle), dz = Math.cos(dock.angle);   // toward water
  const rx = dz, rz = -dx;
  const heading = dock.angle + Math.PI;          // bow pointing out
  const beside = PIER_HALF_WIDTH + halfBeam + 0.8;
  // The stern may lie as far back as the shore end of the planking, no
  // further: anything more overhangs the beach.
  const minOut = Math.max(0, length / 2 - (dock.pierLen - 2));

  // Candidates nearest the pier first: alongside on either hand, then
  // standing off the head as if it had just let go and drifted clear. The
  // first that floats properly wins; failing that, the least bad one, because
  // leaving a new boat wherever the old one was is the worst answer of all.
  let best = null, bestScore = -Infinity;
  const consider = (x, z, ax, az, head) => {
    const score = hullClearance(x, z, ax, az, length, halfBeam);
    if (score > bestScore) { bestScore = score; best = { x, z, heading: head }; }
    return score >= 0;
  };
  for (let out = minOut; out <= minOut + length + 6; out += 1) {
    for (const s of [1, -1]) {
      if (consider(dock.headX + dx * out + rx * beside * s,
        dock.headZ + dz * out + rz * beside * s, dx, dz, heading)) return best;
    }
  }
  for (let out = length * 0.5; out <= length * 2.5; out += 1) {
    if (consider(dock.headX + dx * out, dock.headZ + dz * out, dx, dz, heading)) return best;
  }
  // Still nothing: the channel off this marina does not run the way the pier
  // points. Swing the hull to lie along the water instead of along the
  // planking, which is what a ship that size would actually have to do.
  for (let turn = 15; turn <= 75; turn += 15) {
    for (const sign of [1, -1]) {
      const a = dock.angle + (turn * Math.PI / 180) * sign;
      const ax = Math.sin(a), az = Math.cos(a);
      for (let out = length * 0.4; out <= length * 2; out += 1.5) {
        if (consider(dock.headX + ax * out, dock.headZ + az * out, ax, az, a + Math.PI)) return best;
      }
    }
  }
  return best;
}


// --- names ---------------------------------------------------------------
//
// Every marina has a name, and none of them are respectable. Most come off
// a lattice of the chunk's coordinates so neighbours never share one; the
// rest take the word of the basin they stand in, so the joke is local.
const PUNS = [
  'Master Baiters', 'The Wet Spot', 'Rod & Reel Job', "Hooker's Landing", 'Big Bass Hole',
  'Salty Crack Marina', "Dick's Halibut Hut", 'Cod Piece Harbour', 'The Chum Bucket', 'Reel Estate',
  'Fish & Ships', 'The Rusty Anchor', 'Bass Ackwards', 'Sofa King Fishy', 'Pier Pressure',
  'Dock Holiday', 'Wharf Rats Boat Yard', "Seamen's Rest", "Barnacle Bill's", 'Moby Dock',
  'Dock Ness Marina', 'Bait Me', 'Crappie Corner', 'The Knot Inn', "Wet Willy's",
  'Bottoms Up Boats', 'Two Rods Deep', 'The Sloppy Slip', 'Pole Position', 'Hard Aground',
  'Blow Hole Harbour', 'Muff Diver Marina', "Fanny's Wharf", 'Long Dong Landing', 'Poop Deck Pier',
  'Half Aft Marina', "Jerkbait Jack's", "Skinny Dipper's", "Pike's Peek", 'Wet Dreams Marina',
  'The Salty Seaman', 'Gone Fishin', 'Slippery Slip', "Old Dick's", "Crabby Patty's",
  'Bait & Switch', 'Rock Bottom Boats', 'Shallow Hal\'s', 'The Stern Talking-To', 'Bass to Mouth',
  'Wide Berth Marina', 'Knot Guilty', 'Nauti Buoys', 'Pier Reviewed', 'Ship Faced',
  "Hooker's Cove Marina", 'Whale Oil Beef Hooked', 'The Dirty Dinghy', 'Loose Moorings', 'Moist Marina',
];
const LOCAL = [
  '{W} Bottoms Marina', '{W} Hole Boat Yard', 'The {W} Wet Spot', "{W} Boys' Bait Shack", '{W} Crack Yacht Club',
  '{W} Nether Regions', 'Deep {W} Landing', '{W} Backwater Boats', "{W} Seamen's Club", 'The {W} Slip',
];
export function marinaName(dock) {
  const rng = mulberry32((hash2(dock.cx, dock.cz, S + 421) * 1e9) | 0);
  const lat = ((dock.cx % 1000) + 1000) * 1 + ((dock.cz % 1000) + 1000) * 7;
  if (rng() < 0.35) {
    const cell = Math.floor(dock.x / 240), cellz = Math.floor(dock.z / 240);
    const b = basinOf(cell, cellz);
    const w = basinWord(b.bx, b.bz).replace(/'s$/, '');
    return LOCAL[lat % LOCAL.length].replace('{W}', w);
  }
  return PUNS[lat % PUNS.length];
}

// --- stock ---------------------------------------------------------------
//
// Each marina sells a few boats of its own — two to four skins, no two of
// the same hull — rolled once from its seed, so a marina always has the
// same boats on its docks. The roll leans hard toward cheap hulls and
// Standard paint: a Signature steamboat is out there, but you have to
// find the marina that carries it. What you buy changes how you get about,
// never a bet.
const RARITY_W = [1, 0.42, 0.15, 0.045];
// The stock turns over every six hours by the wall clock: a new roll for
// every marina at once, the same for everyone. Between rolls it is fixed.
export const STOCK_PERIOD_MS = 6 * 3600 * 1000;
let epochOverride = null;                 // tests pin the clock
export function stockEpoch(now = Date.now()) { return epochOverride ?? Math.floor(now / STOCK_PERIOD_MS); }
export function setStockEpoch(e) { epochOverride = e; }
/** Milliseconds until the next roll. */
export function stockTurnsIn(now = Date.now()) { return STOCK_PERIOD_MS - (now % STOCK_PERIOD_MS); }
export function marinaStock(dock, epoch = stockEpoch()) {
  const rng = mulberry32((hash2(dock.cx + epoch * 7919, dock.cz - epoch * 104729, S + 431) * 1e9) | 0);
  // A big harbour carries five to nine boats, a small one three to five.
  const n = dock.big ? 5 + Math.floor(rng() * 5) : 3 + Math.floor(rng() * 3);
  const pool = [];
  fleetCatalog().forEach(({ hull, skins }, hi) => {
    for (const sk of skins) if (sk.price > 0) pool.push({ key: sk.key, hull: hull.id, w: RARITY_W[sk.rarity] / Math.pow(1 + hi, 1.35) });
  });
  const out = [];
  for (let k = 0; k < n && pool.length; k++) {
    let total = 0;
    for (const c of pool) total += c.w;
    let r = rng() * total, pick = pool[pool.length - 1];
    for (const c of pool) { r -= c.w; if (r <= 0) { pick = c; break; } }
    out.push(pick.key);
    pool.splice(pool.indexOf(pick), 1);
    // Another skin of the same hull is unlikely, not impossible.
    for (const c of pool) if (c.hull === pick.hull) c.w *= 0.12;
  }
  return out;
}

// --- meshes --------------------------------------------------------------

const MAT = {
  plank: new THREE.MeshLambertMaterial({ color: 0xa97f4e }),
  plankDark: new THREE.MeshLambertMaterial({ color: 0x7d5b36 }),
  piling: new THREE.MeshLambertMaterial({ color: 0x5f4629 }),
  trim: new THREE.MeshLambertMaterial({ color: 0xf6f1e4 }),
  buoy: new THREE.MeshLambertMaterial({ color: 0xe8b23a }),
  glass: new THREE.MeshLambertMaterial({ color: 0x2b4a63 }),
  dark: new THREE.MeshLambertMaterial({ color: 0x2a2a2e }),
  steel: new THREE.MeshLambertMaterial({ color: 0x9aa4ad }),
  red: new THREE.MeshLambertMaterial({ color: 0xd6413a }),
  white: new THREE.MeshLambertMaterial({ color: 0xf4f4f0 }),
  tyre: new THREE.MeshLambertMaterial({ color: 0x1e1e20 }),
  lamp: new THREE.MeshLambertMaterial({ color: 0xfff1b0, emissive: 0xffe08a, emissiveIntensity: 0.6 }),
  pump: new THREE.MeshLambertMaterial({ color: 0xe0362f }),
  pumpTop: new THREE.MeshLambertMaterial({ color: 0xf5f0e6 }),
  cream: new THREE.MeshLambertMaterial({ color: 0xfff3d6 }),
  pink: new THREE.MeshLambertMaterial({ color: 0xf28bb3 }),
  mint: new THREE.MeshLambertMaterial({ color: 0x9fe3c5 }),
  cone: new THREE.MeshLambertMaterial({ color: 0xd9a05b }),
  barrel: new THREE.MeshLambertMaterial({ color: 0x4d6b8f }),
  crate: new THREE.MeshLambertMaterial({ color: 0xb08a55 }),
  flag: new THREE.MeshLambertMaterial({ color: 0xe8483f, side: THREE.DoubleSide }),
  brick: new THREE.MeshLambertMaterial({ color: 0x8a4a3a }),
  ring: new THREE.MeshLambertMaterial({ color: 0xf0f0f0 }),
};
// Each marina wears its own paint.
const WALLS = [0xdfeaf2, 0xb8433a, 0x3f8f8a, 0x6f8fa8, 0xe6c85a, 0x7a5c48, 0xf1e6cf];
const ROOFS = [0x3f8fd0, 0x7b2d2a, 0x2f6b46, 0x3a3f46, 0x9c5a2c, 0x27587a];

const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  piling: new THREE.CylinderGeometry(0.16, 0.19, 1, 6),
  buoy: new THREE.SphereGeometry(0.22, 8, 6),
  post: new THREE.CylinderGeometry(0.08, 0.08, 1, 5),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  cone: new THREE.ConeGeometry(0.5, 1, 10),
  ball: new THREE.SphereGeometry(0.5, 10, 8),
  torus: new THREE.TorusGeometry(0.42, 0.13, 6, 12),
  scoop: new THREE.SphereGeometry(0.5, 10, 8),
};

function mesh(geo, mat, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}
const box = (mat, w, h, d, x, y, z, ry = 0) => mesh(GEO.box, mat, w, h, d, x, y, z, 0, ry, 0);

/** A gable roof over a footprint (w across, d deep), pitched along x. */
function gableRoof(mat, w, d, x, y, z, rise = 1.4, over = 0.5) {
  const g = new THREE.Group();
  const half = w / 2 + over;
  const slope = Math.hypot(half, rise);
  const ang = Math.atan2(rise, half);
  for (const s of [1, -1]) {
    const m = mesh(GEO.box, mat, slope, 0.16, d + over * 2, s * half / 2, rise / 2, 0, 0, 0, -s * ang);
    m.receiveShadow = true;
    g.add(m);
  }
  g.add(mesh(GEO.box, MAT.dark, 0.3, 0.2, d + over * 2 + 0.1, 0, rise, 0));          // ridge cap
  g.position.set(x, y, z);
  return g;
}

/** A window: dark glass in a pale frame, on the face of a wall. */
function windowOn(g, x, y, z, w = 0.9, h = 0.8, ry = 0) {
  const f = box(MAT.trim, w + 0.14, h + 0.14, 0.08, x, y, z, ry); g.add(f);
  const p = box(MAT.glass, w, h, 0.1, x, y, z, ry); g.add(p);
  g.add(box(MAT.trim, 0.06, h, 0.12, x, y, z, ry));                // mullion
}

/** A lamp on a post, lit. */
function lampPost(g, x, y, z, h = 2.4) {
  g.add(mesh(GEO.post, MAT.dark, 1, h, 1, x, y + h / 2, z));
  g.add(box(MAT.dark, 0.34, 0.06, 0.34, x, y + h, z));
  g.add(mesh(GEO.box, MAT.lamp, 0.24, 0.3, 0.24, x, y + h - 0.2, z));
  g.add(mesh(GEO.cone, MAT.dark, 0.7, 0.28, 0.7, x, y + h + 0.1, z));
}

function railing(g, x0, z0, x1, z1, y, step = 1.1) {
  const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / step));
  const ang = Math.atan2(x1 - x0, z1 - z0);
  for (let i = 0; i <= n; i++) { const t = i / n; g.add(mesh(GEO.post, MAT.trim, 0.9, 1.0, 0.9, x0 + (x1 - x0) * t, y + 0.5, z0 + (z1 - z0) * t)); }
  g.add(box(MAT.trim, 0.1, 0.08, len, (x0 + x1) / 2, y + 1.0, (z0 + z1) / 2, ang));
  g.add(box(MAT.trim, 0.06, 0.05, len, (x0 + x1) / 2, y + 0.55, (z0 + z1) / 2, ang));
}

// --- boathouses: three kinds, so the coast is not one shack repeated ---

/** A working boathouse: gable roof, big bay open to the water, dormer, life ring. */
function boathouseA(wall, roof, rng, y0 = 1.1, down = 3.2) {
  const g = new THREE.Group();
  const W = 7.2, D = 7.0, H = 3.2;
  // Stands on pilings, the floor a hand above the highest ground.
  for (const sx of [-3.2, 0, 3.2]) for (const sz of [-3.0, 0, 3.0]) g.add(mesh(GEO.piling, MAT.piling, 1.3, down, 1.3, sx, y0 - down / 2, sz));
  g.add(box(MAT.plank, W + 0.6, 0.2, D + 0.6, 0, y0, 0));
  // Walls: back, two sides, and the front split round the bay.
  g.add(box(wall, W, H, 0.24, 0, y0 + H / 2, -D / 2));
  for (const sx of [-1, 1]) g.add(box(wall, 0.24, H, D, sx * W / 2, y0 + H / 2, 0));
  const bay = 3.4;
  for (const sx of [-1, 1]) g.add(box(wall, (W - bay) / 2, H, 0.24, sx * (bay / 2 + (W - bay) / 4), y0 + H / 2, D / 2));
  g.add(box(wall, bay + 0.3, 0.7, 0.26, 0, y0 + H - 0.35, D / 2));         // lintel over the bay
  g.add(box(MAT.trim, bay + 0.4, 0.14, 0.3, 0, y0 + H - 0.7, D / 2));
  for (const sx of [-1, 1]) g.add(box(MAT.trim, 0.16, H - 0.7, 0.3, sx * bay / 2, y0 + (H - 0.7) / 2, D / 2));
  // Doors folded back either side of the bay.
  for (const sx of [-1, 1]) g.add(box(MAT.plankDark, 0.1, H - 0.9, 1.5, sx * (bay / 2 + 0.1), y0 + (H - 0.9) / 2, D / 2 + 0.8));
  // Windows down each side and a round one over the bay.
  for (const sx of [-1, 1]) for (const z of [-1.8, 0.4]) windowOn(g, sx * (W / 2 + 0.02), y0 + 1.9, z, 0.9, 0.8, Math.PI / 2);
  g.add(mesh(GEO.cyl, MAT.trim, 0.9, 0.12, 0.9, 0, y0 + H + 0.45, D / 2 + 0.02, Math.PI / 2, 0, 0));
  g.add(mesh(GEO.cyl, MAT.glass, 0.7, 0.16, 0.7, 0, y0 + H + 0.45, D / 2 + 0.02, Math.PI / 2, 0, 0));
  // Gable ends and the roof.
  const rise = 1.9;
  for (const sz of [-1, 1]) {
    const gable = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4, 1, false, Math.PI / 4), wall);
    gable.scale.set(W / 2 * 1.414, rise, 0.24 * 1.414); gable.position.set(0, y0 + H + rise / 2, sz * D / 2);
    gable.castShadow = true; g.add(gable);
  }
  const r = gableRoof(roof, W, D, 0, y0 + H, 0, rise, 0.55); g.add(r);
  // A dormer on one slope, a stovepipe on the other.
  g.add(box(wall, 1.4, 1.0, 1.2, -1.6, y0 + H + 1.2, -1.2));
  g.add(gableRoof(roof, 1.4, 1.2, -1.6, y0 + H + 1.7, -1.2, 0.5, 0.2));
  windowOn(g, -1.6, y0 + H + 1.2, -0.58, 0.6, 0.5);
  g.add(mesh(GEO.cyl, MAT.dark, 0.36, 1.4, 0.36, 2.2, y0 + H + 1.6, 1.4));
  // Life ring by the door, a ladder to the water, a rope coil.
  g.add(mesh(GEO.torus, MAT.ring, 1, 1, 1, W / 2 + 0.05, y0 + 1.5, 2.6, 0, Math.PI / 2, 0));
  g.add(mesh(GEO.torus, MAT.red, 0.5, 1, 0.5, W / 2 + 0.08, y0 + 1.5, 2.6, 0, Math.PI / 2, 0));
  for (const sx of [-0.35, 0.35]) g.add(mesh(GEO.post, MAT.steel, 0.7, 2.6, 0.7, W / 2 + 0.5 + sx * 0, y0 - 0.9, 1.0 + sx));
  for (let i = 0; i < 5; i++) g.add(box(MAT.steel, 0.06, 0.06, 0.8, W / 2 + 0.5, y0 - 2.0 + i * 0.5, 1.0));
  for (let i = 0; i < 3; i++) g.add(mesh(GEO.torus, MAT.plankDark, 0.9, 0.5, 0.9, 2.6, y0 + 0.12 + i * 0.1, 2.5, Math.PI / 2, 0, 0));
  return g;
}

/** An A-frame lodge: two great roof planes to the deck, a glass front, chimney, veranda. */
function boathouseB(wall, roof, rng, y0 = 1.0, down = 3.0) {
  const g = new THREE.Group();
  const W = 7.6, D = 7.4, rise = 4.6;
  for (const sx of [-3.4, 0, 3.4]) for (const sz of [-3.2, 0, 3.2]) g.add(mesh(GEO.piling, MAT.piling, 1.3, down, 1.3, sx, y0 - down / 2, sz));
  g.add(box(MAT.plank, W + 2.4, 0.2, D + 2.6, 0, y0, 0.6));       // deck all round
  // The two roof slopes run to the deck.
  const half = W / 2, slope = Math.hypot(half, rise), ang = Math.atan2(rise, half);
  for (const s of [1, -1]) {
    const m = mesh(GEO.box, roof, slope, 0.22, D + 0.8, s * half / 2, y0 + rise / 2, 0, 0, 0, -s * ang);
    m.receiveShadow = true; g.add(m);
    // Shingle courses: thin bands down the slope.
    for (let i = 1; i < 6; i++) g.add(mesh(GEO.box, MAT.dark, 0.05, 0.05, D + 0.9, s * half * (i / 6) / 1, y0 + rise * (1 - i / 6) + 0.12, 0, 0, 0, -s * ang));
  }
  g.add(mesh(GEO.box, MAT.dark, 0.34, 0.24, D + 1.0, 0, y0 + rise + 0.05, 0));
  // Front and back gables: the front is glass in a timber grid, the back is wall.
  for (const sz of [1, -1]) {
    const gable = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4, 1, false, Math.PI / 4), sz > 0 ? MAT.glass : wall);
    gable.scale.set(half * 0.94 * 1.414, rise * 0.96, 0.2 * 1.414); gable.position.set(0, y0 + rise * 0.48, sz * (D / 2 - 0.1));
    gable.castShadow = true; g.add(gable);
  }
  for (let i = 1; i < 4; i++) g.add(box(MAT.trim, W * (1 - i / 4.2), 0.08, 0.3, 0, y0 + rise * i / 4, D / 2));
  for (const sx of [-1.2, 0, 1.2]) g.add(box(MAT.trim, 0.08, rise * (1 - Math.abs(sx) / half) * 0.9, 0.3, sx, y0 + rise * (1 - Math.abs(sx) / half) * 0.45, D / 2));
  // Door in the glass, a chimney of brick, a veranda rail.
  g.add(box(MAT.plankDark, 1.0, 2.1, 0.16, 0.8, y0 + 1.05, D / 2 + 0.1));
  g.add(box(MAT.brick, 0.9, rise + 1.2, 0.9, half - 1.4, y0 + (rise + 1.2) / 2, -1.2));
  g.add(box(MAT.dark, 1.1, 0.16, 1.1, half - 1.4, y0 + rise + 1.25, -1.2));
  railing(g, -half - 1.2, D / 2 + 1.9, half + 1.2, D / 2 + 1.9, y0);
  railing(g, half + 1.2, D / 2 + 1.9, half + 1.2, -D / 2 - 1.0, y0);
  // Deck furniture: two chairs and a table, a flower box, firewood.
  for (const sx of [-2.4, -1.4]) { g.add(box(MAT.plankDark, 0.5, 0.06, 0.5, sx, y0 + 0.45, D / 2 + 1.1)); g.add(box(MAT.plankDark, 0.5, 0.5, 0.06, sx, y0 + 0.7, D / 2 + 0.85)); }
  g.add(mesh(GEO.cyl, MAT.plankDark, 0.7, 0.06, 0.7, -1.9, y0 + 0.6, D / 2 + 1.1)); g.add(mesh(GEO.post, MAT.plankDark, 1, 0.6, 1, -1.9, y0 + 0.3, D / 2 + 1.1));
  g.add(box(MAT.plankDark, 1.6, 0.4, 0.5, 2.6, y0 + 0.3, D / 2 + 1.5)); for (let i = 0; i < 5; i++) g.add(mesh(GEO.ball, MAT.pink, 0.26, 0.26, 0.26, 2.0 + i * 0.3, y0 + 0.6, D / 2 + 1.5));
  for (let i = 0; i < 6; i++) g.add(mesh(GEO.cyl, MAT.plankDark, 0.22, 0.8, 0.22, -half - 0.6, y0 + 0.2 + (i % 3) * 0.2, -1.5 + Math.floor(i / 3) * 0.3 + (i % 3) * 0.05, Math.PI / 2, 0, 0));
  return g;
}

/** A long shed of a boat yard: corrugated roof, sliding door, hoist arm, barrels, a water tank. */
function boathouseC(wall, roof, rng, y0 = 0.9, down = 3.0) {
  const g = new THREE.Group();
  const W = 9.6, D = 6.2, H = 3.4;
  for (const sx of [-4.4, -1.5, 1.5, 4.4]) for (const sz of [-2.8, 0, 2.8]) g.add(mesh(GEO.piling, MAT.piling, 1.2, down, 1.2, sx, y0 - down / 2, sz));
  g.add(box(MAT.plank, W + 1.0, 0.2, D + 0.8, 0, y0, 0));
  g.add(box(wall, W, H, D, 0, y0 + H / 2, 0));
  // Board seams and a band of trim.
  for (let i = 1; i < 8; i++) g.add(box(MAT.dark, 0.04, H, D + 0.06, -W / 2 + i * W / 8, y0 + H / 2, 0));
  g.add(box(MAT.trim, W + 0.1, 0.18, D + 0.1, 0, y0 + H - 0.3, 0));
  // A shallow roof of corrugated ridges, sloping back.
  const rr = new THREE.Group();
  const pitch = 0.09;
  rr.add(box(roof, W + 1.2, 0.14, D + 1.2, 0, 0, 0));
  for (let i = 0; i < 22; i++) rr.add(box(roof, 0.12, 0.1, D + 1.2, -W / 2 - 0.5 + i * (W + 1.0) / 21, 0.09, 0));
  rr.rotation.x = pitch; rr.position.set(0, y0 + H + 0.25, 0); g.add(rr);
  // Sliding door on the water side, slid half open, and a wicket door.
  g.add(box(MAT.plankDark, 3.6, H - 0.5, 0.14, -1.2, y0 + (H - 0.5) / 2, D / 2 + 0.16));
  g.add(box(MAT.steel, W * 0.8, 0.12, 0.3, -0.4, y0 + H - 0.4, D / 2 + 0.2));
  g.add(box(MAT.glass, 3.2, H - 0.7, 0.12, 1.9, y0 + (H - 0.7) / 2, D / 2 + 0.01));   // the open bay: dark inside
  g.add(box(MAT.plankDark, 0.9, 2.0, 0.12, -W / 2 + 1.0, y0 + 1.0, D / 2 + 0.08));
  for (const x of [-3.2, 3.2]) windowOn(g, x, y0 + 2.3, -D / 2 - 0.02, 1.4, 0.7);
  for (const sx of [-1, 1]) windowOn(g, sx * (W / 2 + 0.02), y0 + 2.3, 0, 1.6, 0.7, Math.PI / 2);
  // A hoist arm off the corner with a hook, a water tank on legs, barrels and crates.
  g.add(mesh(GEO.post, MAT.steel, 1.6, 5.0, 1.6, W / 2 + 0.8, y0 + 2.5, D / 2 - 0.4));
  g.add(box(MAT.steel, 0.16, 0.16, 4.2, W / 2 + 0.8, y0 + 4.9, D / 2 + 1.5));
  g.add(box(MAT.steel, 0.1, 0.1, 2.6, W / 2 + 0.8, y0 + 4.2, D / 2 + 0.6, 0, 0, 0)); 
  g.add(mesh(GEO.post, MAT.dark, 0.4, 2.0, 0.4, W / 2 + 0.8, y0 + 3.9, D / 2 + 3.4));
  g.add(mesh(GEO.torus, MAT.steel, 0.5, 0.5, 0.5, W / 2 + 0.8, y0 + 2.8, D / 2 + 3.4));
  for (const [x, z] of [[-3.6, -2.2], [-3.0, -2.4], [-3.3, -1.7]]) g.add(mesh(GEO.cyl, MAT.barrel, 0.7, 1.0, 0.7, x - W / 2 - 0.4 + 3.6, y0 + 0.5, z + D / 2 + 3.0));
  for (const [x, z, s] of [[2.6, 2.4, 0.8], [3.4, 2.5, 0.6], [2.9, 3.2, 0.7]]) g.add(box(MAT.crate, s, s, s, x - W / 2, y0 + s / 2, z + D / 2 - 0.5, 0.4));
  g.add(mesh(GEO.cyl, MAT.steel, 1.8, 1.6, 1.8, -W / 2 + 1.2, y0 + H + 1.4, -1.2));
  for (const sx of [-0.6, 0.6]) for (const sz of [-0.6, 0.6]) g.add(mesh(GEO.post, MAT.steel, 0.7, 1.4, 0.7, -W / 2 + 1.2 + sx, y0 + H + 0.6, -1.2 + sz));
  return g;
}

/** Two pumps under a little canopy at the head of the pier. */
function gasPumps(g, x, y, z) {
  const s = new THREE.Group();
  for (const sx of [-0.7, 0.7]) {
    s.add(box(MAT.pump, 0.6, 1.5, 0.42, sx, 0.75, 0));
    s.add(box(MAT.pumpTop, 0.62, 0.34, 0.44, sx, 1.35, 0));
    s.add(box(MAT.dark, 0.36, 0.2, 0.05, sx, 1.35, 0.23));            // the dial
    s.add(box(MAT.dark, 0.16, 0.5, 0.12, sx + 0.24, 0.95, 0.26));     // nozzle in its cradle
    s.add(mesh(GEO.post, MAT.dark, 0.5, 0.9, 0.5, sx + 0.33, 0.9, 0.12, 0, 0, 0.35));   // the hose
  }
  s.add(box(MAT.steel, 2.6, 0.1, 1.6, 0, 0.05, 0));                     // the island
  for (const sx of [-1.1, 1.1]) s.add(mesh(GEO.post, MAT.steel, 1.2, 2.9, 1.2, sx, 1.45, -0.6));
  s.add(box(MAT.white, 3.2, 0.14, 2.2, 0, 2.95, -0.2));                 // canopy
  s.add(box(MAT.red, 3.2, 0.3, 0.08, 0, 2.8, 0.9));
  s.add(box(MAT.white, 1.2, 0.5, 0.06, 0, 3.4, -0.2));                  // "GAS" board
  s.add(box(MAT.red, 0.9, 0.16, 0.08, 0, 3.4, -0.16));
  s.position.set(x, y, z);
  g.add(s);
}

/** An ice cream stand with a striped awning and a great cone on the roof. */
function iceCreamStand(g, x, y, z, ry, down = 2.5) {
  const s = new THREE.Group();
  s.add(box(MAT.cream, 2.4, 2.3, 1.9, 0, 1.15, 0));
  s.add(box(MAT.pink, 2.5, 0.16, 2.0, 0, 2.3, 0));
  s.add(box(MAT.dark, 1.8, 0.9, 0.06, 0, 1.6, 0.97));                   // the hatch
  s.add(box(MAT.plankDark, 2.2, 0.1, 0.5, 0, 1.1, 1.15));               // counter
  // Striped awning over the hatch.
  for (let i = 0; i < 6; i++) s.add(mesh(GEO.box, i % 2 ? MAT.pink : MAT.white, 0.42, 0.06, 1.1, -1.05 + i * 0.42, 2.25, 1.35, -0.35, 0, 0));
  for (const sx of [-1.1, 1.1]) s.add(mesh(GEO.post, MAT.steel, 0.6, 1.2, 0.6, sx, 1.7, 1.85));
  // The sign: a cone with three scoops.
  s.add(mesh(GEO.cone, MAT.cone, 0.7, 1.0, 0.7, 0, 2.85, 0, Math.PI, 0, 0));
  s.add(mesh(GEO.scoop, MAT.pink, 0.72, 0.72, 0.72, 0, 3.5, 0));
  s.add(mesh(GEO.scoop, MAT.mint, 0.62, 0.62, 0.62, 0.2, 3.95, 0.1));
  s.add(mesh(GEO.scoop, MAT.cream, 0.54, 0.54, 0.54, -0.15, 4.3, -0.05));
  s.add(mesh(GEO.ball, MAT.red, 0.16, 0.16, 0.16, -0.15, 4.6, -0.05));
  // A bin and a chalkboard.
  s.add(mesh(GEO.cyl, MAT.steel, 0.5, 0.7, 0.5, 1.6, 0.35, 0.9));
  s.add(box(MAT.dark, 0.7, 0.9, 0.06, -1.7, 0.6, 0.9, 0.3));
  // Its own little deck, on posts down to whatever is under it.
  s.add(box(MAT.plank, 4.4, 0.16, 3.4, 0, -0.08, 0.4));
  for (const sx of [-1.9, 1.9]) for (const sz of [-1.0, 1.9]) s.add(mesh(GEO.post, MAT.piling, 1.4, down, 1.4, sx, -down / 2, sz));
  s.position.set(x, y, z); s.rotation.y = ry;
  g.add(s);
}

/** The marina's name on a board, painted once per name. */
const signTex = new Map();
function nameTexture(name) {
  let t = signTex.get(name);
  if (t) return t;
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f6f1e4'; ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#1f4f73'; ctx.fillRect(8, 8, 496, 112);
  ctx.fillStyle = '#f6f1e4';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let size = 54;
  ctx.font = `bold ${size}px Georgia, serif`;
  while (ctx.measureText(name).width > 470 && size > 22) { size -= 3; ctx.font = `bold ${size}px Georgia, serif`; }
  ctx.fillText(name, 256, 60);
  ctx.fillStyle = '#ffd166'; ctx.fillRect(40, 100, 432, 4);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  signTex.set(name, t);
  return t;
}

function nameSign(g, name, x, y, z, ry, w = 3.2) {
  const s = new THREE.Group();
  for (const sx of [-w / 2 + 0.2, w / 2 - 0.2]) s.add(mesh(GEO.post, MAT.piling, 1.2, 2.6, 1.2, sx, 1.3, 0));
  const board = new THREE.Mesh(GEO.box, [MAT.dark, MAT.dark, MAT.dark, MAT.dark, new THREE.MeshLambertMaterial({ map: nameTexture(name) }), MAT.dark]);
  board.scale.set(w, w / 4, 0.1); board.position.set(0, 2.55, 0); board.castShadow = true;
  s.add(board);
  s.add(box(MAT.trim, w + 0.1, 0.1, 0.14, 0, 2.55 + w / 8 + 0.02, 0));
  s.add(box(MAT.trim, w + 0.1, 0.1, 0.14, 0, 2.55 - w / 8 - 0.02, 0));
  s.position.set(x, y, z); s.rotation.y = ry;
  g.add(s);
}

// --- parked stock ---------------------------------------------------------

/** Draft a parked hull wants under it, by length. */
function parkDraft(length) { return 0.4 + length * 0.05; }

/**
 * Deal the stock out over the lot, deterministically: small hulls to the
 * small slips, middling ones to the medium slips, anything left or too big
 * to the moorings in a line beyond the head. Each slot is checked for water
 * under the hull; a slip with no water is passed over. Returns a list of
 * { key, spec, ax, az, heading, mooring } in the marina's frame (x across
 * the main pier, z out along it; a hull's forward is its local -z).
 */
function dealSlots(dock) {
  const dx = Math.sin(dock.angle), dz = Math.cos(dock.angle), rx = dz, rz = -dx;
  const depthAt = (ax, az) => waterDepth(dock.x + dx * az + rx * ax, dock.z + dz * az + rz * ax);
  const floats = (ax, az, along, len, beam) => {
    // `along` is the hull's axis in the marina frame.
    const need = CONFIG.MIN_NAV_DEPTH + parkDraft(len);
    const px = -along[1], pz = along[0];
    for (const t of [-0.5, -0.25, 0, 0.25, 0.5]) for (const b of [-1, 0, 1]) {
      if (depthAt(ax + along[0] * len * t + px * beam * b, az + along[1] * len * t + pz * beam * b) < need) return false;
    }
    return true;
  };
  const specs = (dock.stock || []).map((key) => ({ key, spec: resolveBoat(key) }));
  specs.sort((a, b) => b.spec.length - a.spec.length);      // the big ones first, they are choosy
  const slips = [];
  for (const row of dock.rows || []) {
    const finger = row.small ? SMALL_FINGER : MED_FINGER, pitch = row.small ? SMALL_PITCH : MED_PITCH;
    for (const side of row.sides) if (row.blocked !== side) slips.push({ side, z: row.z, finger, pitch, max: row.small ? SMALL_MAX : MED_MAX, taken: false });
  }
  const out = [];
  const moored = [];
  for (const { key, spec } of specs) {
    const len = spec.length, beam = len * 0.17;
    let placed = false;
    for (const sl of slips) {
      if (sl.taken || len > sl.max) continue;
      // Lying along the finger, bow to the main pier, half a slip off it.
      const ax = sl.side * (PIER_W / 2 + 0.7 + len / 2), az = sl.z + sl.pitch * 0.5 + 0.1;
      if (!floats(ax, az, [sl.side, 0], len, beam)) continue;
      sl.taken = true;
      out.push({ key, spec, ax, az, heading: sl.side * Math.PI / 2, mooring: null });
      placed = true;
      break;
    }
    if (!placed) moored.push({ key, spec });
  }
  // Moorings: a line across, beyond the head, the centre lane left clear for
  // whoever is coming in. Each boat lies along the pier, bow out, on a rope
  // to a buoy ahead of it.
  const L = dock.pierLen;
  const lane = [9, -9, 18, -18, 27, -27, 36, -36];
  let li = 0;
  for (const { key, spec } of moored) {
    const len = spec.length, beam = len * 0.17;
    let done = false;
    while (li < lane.length && !done) {
      const ax = lane[li++];
      for (const extra of [0, 6, 12]) {
        const az = L + 6 + extra + len / 2;
        if (!floats(ax, az, [0, 1], len, beam)) continue;
        out.push({ key, spec, ax, az, heading: Math.PI, mooring: { ax, az: az + len / 2 + 3.5, bowZ: az + len / 2 } });
        done = true;
        break;
      }
    }
  }
  return out;
}

/** Load and park the marina's stock boats over the lot (asynchronous). */
function parkStock(dock, g, alive, docks) {
  for (const slot of dealSlots(dock)) {
    if (docks.player && docks.player.has(slot.key)) continue;    // bought: gone from the docks
    (async () => {
      let hull;
      try { hull = (await loadHull(slot.spec.hullId)).clone(true); } catch { return; }
      if (!alive.on) return;
      await applySkin(hull, slot.spec);
      if (!alive.on) return;
      const holder = new THREE.Group();
      holder.add(hull);
      hull.position.y = stationsFor(slot.spec.hullId)?.lift ?? 0;
      holder.position.set(slot.ax, CONFIG.WATER_LEVEL, slot.az);
      holder.rotation.y = slot.heading;
      holder.userData.stock = slot.key;
      g.add(holder);
      // Soft: a hull can shove it, and it swings back to its berth.
      const dx = Math.sin(dock.angle), dz = Math.cos(dock.angle), rx = dz, rz = -dx;
      const wx = dock.x + dx * slot.az + rx * slot.ax, wz = dock.z + dz * slot.az + rz * slot.ax;
      const box3 = new THREE.Box3().setFromObject(hull);
      docks.parked.push({
        key: slot.key, dock, holder, group: g, alive,
        rest: { x: wx, z: wz }, pos: { x: wx, z: wz }, vel: { x: 0, z: 0 },
        heading: dock.angle + slot.heading, restHeading: dock.angle + slot.heading,
        hullBounds: { length: box3.max.z - box3.min.z, halfBeam: (box3.max.x - box3.min.x) / 2 },
        local: { ax: slot.ax, az: slot.az, ry: slot.heading },
      });
      if (slot.mooring) {
        const m = slot.mooring;
        const b = new THREE.Mesh(GEO.buoy, MAT.buoy); b.scale.setScalar(1.7); b.position.set(m.ax, 0.2, m.az); g.add(b);
        g.add(mesh(GEO.post, MAT.dark, 0.5, 1.0, 0.5, m.ax, 0.6, m.az));           // the buoy's staff
        // The rope, from the bow down to the buoy.
        const x0 = m.ax, y0 = 0.7, z0 = m.bowZ - 0.3, x1 = m.ax, y1 = 0.25, z1 = m.az;
        const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
        const rope = mesh(GEO.post, MAT.crate, 0.45, len, 0.45, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        rope.rotation.set(Math.atan2(z1 - z0, y1 - y0), 0, 0);
        rope.castShadow = false;
        g.add(rope);
      }
    })();
  }
}

/**
 * Where a building can stand: the ground under its footprint, in the
 * marina's frame. `ok` when it can sit on the land on posts (its floor a
 * hand above the highest point, its posts down to the lowest); otherwise
 * it goes out over the water on a platform instead.
 */
function groundUnder(dock, cx, cz, w, d, ry) {
  const dx = Math.sin(dock.angle), dz = Math.cos(dock.angle), rx = dz, rz = -dx;
  let hi = -Infinity, lo = Infinity;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const lx = i * w / 2, lz = j * d / 2;
    const ax = cx + lx * Math.cos(ry) + lz * Math.sin(ry), az = cz - lx * Math.sin(ry) + lz * Math.cos(ry);
    const h = terrainHeight(dock.x + dx * az + rx * ax, dock.z + dz * az + rz * ax);
    hi = Math.max(hi, h); lo = Math.min(lo, h);
  }
  return { hi, lo, ok: hi <= 3.4 && hi - lo <= 2.8 };
}

function buildDock(dock, docks) {
  const g = new THREE.Group();
  const rng = mulberry32((hash2(dock.cx, dock.cz, S + 449) * 1e9) | 0);
  const L = dock.pierLen;
  const wall = new THREE.MeshLambertMaterial({ color: dock.wallColor });
  const roof = new THREE.MeshLambertMaterial({ color: dock.roofColor });
  const kind = dock.kind;

  // The main pier, from the shore (z=0) out over the water (+z local).
  const deck = box(MAT.plank, PIER_W, 0.18, L, 0, 0.42, L / 2);
  deck.receiveShadow = true; g.add(deck);
  for (let i = 1; i < Math.floor(L / 0.9); i++) g.add(box(MAT.plankDark, PIER_W + 0.02, 0.04, 0.07, 0, 0.52, i * 0.9));
  for (let i = 0; i <= Math.floor(L / 2.2); i++) for (const sx of [-1.3, 1.3]) g.add(mesh(GEO.piling, MAT.piling, 1, 2.8, 1, sx, -0.9, 0.6 + i * 2.2));
  // The lot: a finger off each side of every row, with pilings, cleats and a
  // fender, the slip beside it marked with a post at its outer end.
  for (const row of dock.rows || []) {
    const finger = row.small ? SMALL_FINGER : MED_FINGER, pitch = row.small ? SMALL_PITCH : MED_PITCH;
    for (const s of row.sides) {
      if (row.blocked === s) continue;
      const x0 = s * (PIER_W / 2 + finger / 2);
      g.add(box(MAT.plank, finger, 0.16, 1.1, x0, 0.4, row.z));
      for (let i = 1; i < Math.floor(finger / 0.9); i++) g.add(box(MAT.plankDark, 0.07, 0.04, 1.12, s * (PIER_W / 2 + i * 0.9), 0.5, row.z));
      for (const t of [0.35, 0.95]) g.add(mesh(GEO.piling, MAT.piling, 0.8, 2.6, 0.8, s * (PIER_W / 2 + finger * t), -0.9, row.z + 0.5));
      for (const t of [0.3, 0.7]) g.add(box(MAT.steel, 0.3, 0.08, 0.12, s * (PIER_W / 2 + finger * t), 0.52, row.z + 0.45));
      g.add(mesh(GEO.torus, MAT.tyre, 0.8, 0.8, 0.8, s * (PIER_W / 2 + finger * 0.5), 0.25, row.z + 0.62, Math.PI / 2, 0, 0));
      g.add(mesh(GEO.post, MAT.piling, 1, 2.4, 1, s * (PIER_W / 2 + finger + 0.4), 0.2, row.z + pitch - 0.3));
    }
    for (const s of row.sides) g.add(mesh(GEO.torus, MAT.tyre, 0.9, 0.9, 0.9, s * 1.45, 0.25, row.z + pitch * 0.5, 0, Math.PI / 2, 0));
  }
  for (const sx of [-1.45, 1.45]) for (const dz of [-1.2, 0.3]) { const b = new THREE.Mesh(GEO.buoy, MAT.buoy); b.position.set(sx, 0.16, L + dz); g.add(b); }
  lampPost(g, -1.2, 0.5, L - 0.6); lampPost(g, 1.2, 0.5, 1.2);
  if (L > 16) lampPost(g, -1.2, 0.5, L * 0.5);
  railing(g, -1.4, 0.2, -1.4, 3.6, 0.5); railing(g, 1.4, 0.2, 1.4, 3.6, 0.5);

  // The fuel dock at the head, the ice cream stand and the boathouse where
  // the layout put them: on the shore on posts, or out over the water on
  // their own platforms off the pier, so nothing is ever buried in a bank.
  gasPumps(g, 0, 0.5, L - 2.6);
  const H = dock.house, hw = H.w, hd = H.d;
  const build = kind === 0 ? boathouseA : kind === 1 ? boathouseB : boathouseC;
  let house;
  if (H.onLand) {
    house = build(wall, roof, rng, H.y0, H.y0 - H.lo + 1.0);
    g.add(box(MAT.plank, 1.6, 0.14, 4.4, -2.4, Math.max(0.5, H.y0 - 0.4), -0.8, 0.55));   // the walkway
  } else {
    house = build(wall, roof, rng, 0.6, 3.2);
    g.add(box(MAT.plank, hw + 1.6, 0.16, hd + 1.6, H.x, 0.42, H.z));
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) g.add(mesh(GEO.piling, MAT.piling, 1.1, 3.0, 1.1, H.x + i * hw / 2, -1.1, H.z + j * hd / 2));
  }
  house.position.set(H.x, 0, H.z); house.rotation.y = H.ry;
  g.add(house);
  const I = dock.stand;
  if (!I.onLand) { g.add(box(MAT.plank, 3.4, 0.16, 4.4, I.x, 0.42, I.z)); for (const sx of [-1.4, 1.4]) for (const sz of [-1.9, 1.9]) g.add(mesh(GEO.piling, MAT.piling, 1.0, 3.0, 1.0, I.x + sx, -1.1, I.z + sz)); }
  iceCreamStand(g, I.x, I.y, I.z, I.ry, I.down);
  // Flag over the yard, the name at the gate: at the ground's own height.
  const fh = Math.max(0.3, terrainHeight(dock.x + Math.cos(dock.angle) * 3.6 - Math.sin(dock.angle) * 4.2, dock.z - Math.sin(dock.angle) * 3.6 - Math.cos(dock.angle) * 4.2));
  g.add(mesh(GEO.post, MAT.trim, 1, 6.5, 1, 3.6, fh + 3.25, -4.2));
  g.add(mesh(GEO.box, MAT.flag, 1.4, 0.8, 0.02, 4.35, fh + 6.1, -4.2));
  nameSign(g, dock.name, 1.9, 0.42, 0.7, 0.15);

  g.position.set(dock.x, 0, dock.z);
  g.rotation.y = dock.angle;

  // The boats for sale, dealt over the lot.
  const alive = { on: true };
  g.userData.alive = alive;
  parkStock(dock, g, alive, docks);
  return g;
}

// --- manager -------------------------------------------------------------

const PARK_K = 2.2, PARK_D = 1.6;      // the spring back to the berth, and its damping

export class Docks {
  constructor(scene, player = null) {
    this.scene = scene;
    this.player = player;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.active = new Map();   // dock -> mesh
    this.list = [];
    this.parked = [];          // the stock afloat, with their soft physics
  }

  /**
   * The parked boats give way to a hull that runs into them — the bigger
   * they are the less — and swing back to their berths on a spring.
   */
  update(dt, vessels) {
    // The six-hour roll: once the clock turns, every marina in view gets
    // its new stock, the old boats gone from the docks and the new ones in.
    this.clockAcc = (this.clockAcc || 0) + dt;
    if (this.clockAcc > 1) {
      this.clockAcc = 0;
      const e = stockEpoch();
      for (const [d, mesh] of this.active) if (d.stockEpoch !== e) this.restock(d, mesh, e);
    }
    if (!this.parked.length || !vessels) return;
    for (let i = this.parked.length - 1; i >= 0; i--) {
      const p = this.parked[i];
      if (!p.alive.on) { this.parked.splice(i, 1); continue; }
      let touched = false;
      for (const v of vessels) {
        if (Math.abs(v.pos.x - p.pos.x) > 40 || Math.abs(v.pos.z - p.pos.z) > 40) continue;
        if (separateHulls(v, p, 0.4) > 0) touched = true;
      }
      const ox = p.pos.x - p.rest.x, oz = p.pos.z - p.rest.z;
      if (!touched && Math.abs(ox) + Math.abs(oz) + Math.abs(p.vel.x) + Math.abs(p.vel.z) < 0.003) {
        if (ox || oz) { p.pos.x = p.rest.x; p.pos.z = p.rest.z; p.vel.x = p.vel.z = 0; this.place(p); }
        continue;
      }
      p.vel.x += (-ox * PARK_K - p.vel.x * PARK_D) * dt;
      p.vel.z += (-oz * PARK_K - p.vel.z * PARK_D) * dt;
      p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt;
      // A shove off the beam swings the bow a little, too.
      const fx = -Math.sin(p.restHeading), fz = -Math.cos(p.restHeading);
      const side = (p.pos.x - p.rest.x) * -fz + (p.pos.z - p.rest.z) * fx;
      p.heading = p.restHeading + side * 0.06;
      this.place(p);
    }
  }

  /** Put a parked boat's holder where its physics says, in the marina's frame. */
  place(p) {
    const d = p.dock, dx = Math.sin(d.angle), dz = Math.cos(d.angle);
    const wx = p.pos.x - d.x, wz = p.pos.z - d.z;
    p.holder.position.x = wx * dz - wz * dx;
    p.holder.position.z = wx * dx + wz * dz;
    p.holder.rotation.y = p.heading - d.angle;
  }

  /** A marina's stock has turned over: new boats on the docks. */
  restock(dock, mesh, epoch) {
    dock.stockEpoch = epoch;
    dock.stock = marinaStock(dock, epoch);
    for (let i = this.parked.length - 1; i >= 0; i--) {
      const p = this.parked[i];
      if (p.dock !== dock) continue;
      p.group.remove(p.holder);
      this.parked.splice(i, 1);
    }
    parkStock(dock, mesh, mesh.userData.alive, this);
    if (this.onRestock) this.onRestock(dock);
  }

  /** A boat was bought: it leaves the docks it was lying at. */
  sold(key) {
    for (let i = this.parked.length - 1; i >= 0; i--) {
      const p = this.parked[i];
      if (p.key !== key) continue;
      p.group.remove(p.holder);
      this.parked.splice(i, 1);
    }
  }

  /** Rebuild the visible set from the currently loaded chunk docks. */
  sync(docks) {
    for (const d of docks) {
      if (!this.active.has(d)) {
        const mesh = buildDock(d, this);
        this.group.add(mesh);
        this.active.set(d, mesh);
      }
    }
    for (const [d, mesh] of this.active) {
      if (!docks.includes(d)) {
        this.group.remove(mesh);
        if (mesh.userData.alive) mesh.userData.alive.on = false;
        this.active.delete(d);
      }
    }
    this.list = docks;
  }

  /** Nearest marina to a point. */
  nearest(x, z) {
    let best = null, bestD = Infinity;
    for (const d of this.list) {
      const dist = Math.hypot(d.headX - x, d.headZ - z);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return { dock: best, dist: bestD };
  }

  /** The dock whose head the boat is currently sitting at, if any. */
  dockAt(x, z) {
    for (const d of this.list) {
      if (Math.hypot(d.headX - x, d.headZ - z) <= DOCK_RADIUS) return d;
    }
    return null;
  }
}
