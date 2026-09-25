// Other fishermen on the water.
//
// Boats live round the player as encounters: real hulls from the fleet, in
// their paint, driven by the same physics as the player's boat (the same
// wake, heel and trim, rods and casts, smoke), so they read as other
// players. They cruise between spots, stop to fish — cast, wait, hook
// something, fight it in — and call in at the marinas. They are solid: a
// hull runs into them like it runs into the tender, and they steer clear
// of the player as the tender does. Two in five are just out on the water
// and never call across; the rest may offer a side bet when the player
// passes close: a race to a named water, a run through the rocks of a
// rapid, a fishing match — or, when three boats are found circling and
// waiting for a fourth, a long haul to a water three or four basins off.
//
// Every side bet is an ISOLATED bet against the game RTP (rtp.js sideBet):
// its outcome is drawn the moment the player accepts, and what happens on
// the water after that is staged to match. A boat meant to lose is held a
// margin behind the player and never let past; a boat meant to win is
// never slowed, and let out past its top speed if it falls behind. Nothing
// the player does can change what was drawn; giving up only forfeits.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Boat } from './boat.js';
import { fleetCatalog } from './boats.js';
import { isNavigable, waterDepth, waterKind } from './lake.js';
import { separateHulls, steerClear, wrapAngle } from './hullphysics.js';
import { HookedFish } from './hookedfish.js';
import { speciesInTiers, poolFor } from './fishdata.js';
import { cellRegion, regionAt, basinOf, CELL } from './regions.js';
import { cellFeatures } from './terrain.js';
import { mulberry32 } from './noise.js';

const NAMES = [
  'Big Earl', 'Marge', 'Two-Hook Tony', 'Deadeye Dana', 'Salty Pete', 'Grandma Lou', 'Skeeter',
  'Doc Halibut', 'Bobby Bass', 'Muskie Mike', 'Catfish Kate', 'Reel Ricky', 'Wanda', 'Old Gus',
  'Trout Tammy', 'Pickerel Pam', 'Sunfish Sam', 'Lefty', 'The Colonel', 'Barb', 'Hank the Tank',
  'Minnow Min', 'Captain Deb', 'Walleye Walt', 'Sturgeon Sue', 'Cousin Ray', 'Nettie', 'Slim',
  'Dutch', 'Peggy', 'Bream Bill', 'Lorraine', 'Stubby', 'Ma Kettle', 'Roy', 'Jolene',
];
// Boats come as ENCOUNTERS, not a standing crowd: every minute and a half
// or two one is put on the water where the player will come across it —
// crossing their path, moored ahead of them fishing, bound for a marina,
// or three of them circling and waiting for a fourth — and it goes on
// living after that until it is left far behind.
const MAX_ALIVE = 6;             // in all
const MAX_SINGLES = 4;           // a lone boat is only sent while there are fewer than this
const ENCOUNTER_MIN = 80, ENCOUNTER_MAX = 120;   // seconds between them
const FIRST_MIN = 30, FIRST_MAX = 60;
const LONELY_S = 120;            // nobody within 400 m for this long: send one early
const IDLE_SHARE = 0.4;          // two in five never call across
const GROUP_SHARE = 0.22;        // an encounter is the circling three, when there is room
const DESPAWN = 540;             // metres: a boat this far behind is let go
const LOD_NEAR = 140, LOD_FAR = 300;
const OFFER_RANGE = 26;          // metres: passing this close, a boat may call across
const OFFER_COOLDOWN = 75;       // seconds before the same boat offers again
const GLOBAL_COOLDOWN = 40;      // ... or any boat does
const GROUP_WAIT = 240;          // seconds the circling boats wait for the player
const CIRCLE_R = 16;             // metres, their circle

// Which hulls the water round here is likely to carry: small and common
// mostly, the big ones rare, and rarer still in narrow water. Indexed as
// the catalog is (skiff, speedboat, cuddy, trawler, dredger, gillnetter,
// paddleboat, seiner, steamboat).
const HULL_W = [30, 16, 20, 9, 5, 6, 2.5, 1.5, 1];
const HULL_W_GROUP = [3, 14, 20, 2, 0.5, 0.5, 0, 0, 0];      // fast, sturdy, no bigger than a cuddy: the long haul threads creeks
const NARROW = new Set(['river', 'beaver', 'rapids', 'falls', 'pond', 'cove']);
// What each hull's owner is likely to propose: the nimble boats run the
// rocks and race, the working boats fish.
const OFFER_W = {
  skiff: { agility: 3, race: 2, fishing: 2 }, speedboat: { agility: 2, race: 4, fishing: 1 }, cuddy: { agility: 2.5, race: 3, fishing: 2 },
  trawler: { race: 1, fishing: 3 }, 'mud-dredger': { fishing: 3 }, gillnetter: { race: 1, fishing: 3 },
  paddleboat: { fishing: 2 }, seiner: { fishing: 2 }, steamboat: { fishing: 2 },
};

// --- a fisherman's boat -------------------------------------------------------

/** A name floating over a hull, as a sprite. */
function nameSprite(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 30px system-ui, sans-serif';
  const w = Math.min(240, ctx.measureText(name).width + 28);
  ctx.fillStyle = 'rgba(8, 40, 56, 0.78)';
  ctx.beginPath(); ctx.roundRect((256 - w) / 2, 8, w, 48, 24); ctx.fill();
  ctx.fillStyle = '#eaf6fb'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name, 128, 33);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(4.2, 1.05, 1);
  sp.renderOrder = 7;
  return sp;
}

/** Straight-line water between two points: navigable and deep enough all the way. */
function clearLine(x0, z0, x1, z1, step = 3, depth = 1.2) {
  const d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(d / step));
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n;
    if (!isNavigable(x, z) || waterDepth(x, z) < depth) return false;
  }
  return true;
}

/**
 * A route over the water from A to B, as a generator so a long one can be
 * planned a slice a frame: A* over a grid of navigable cells inside a box
 * round the two, then pulled straight where the water allows. Yields
 * between slices; returns [{x, z}, …] from A to B, or null if there is no
 * way (or the box is too big for the cell size).
 */
export const planInfo = { W: 0, H: 0, found: false, expanded: 0, cell: 0 };   // the last plan's figures (debug)
export function* planRouteGen(ax, az, bx, bz, pad = 70, cell = 5, maxCells = 40000) {
  const minX = Math.min(ax, bx) - pad, maxX = Math.max(ax, bx) + pad;
  const minZ = Math.min(az, bz) - pad, maxZ = Math.max(az, bz) + pad;
  const W = Math.ceil((maxX - minX) / cell), H = Math.ceil((maxZ - minZ) / cell);
  planInfo.W = W; planInfo.H = H; planInfo.found = false; planInfo.expanded = 0; planInfo.cell = cell;
  if (W * H > maxCells) return null;
  const ok = new Int8Array(W * H);          // 0 unknown, 1 water, -1 not
  const water = (i, j) => {
    const k = j * W + i;
    if (!ok[k]) { const x = minX + (i + 0.5) * cell, z = minZ + (j + 0.5) * cell; ok[k] = isNavigable(x, z) && waterDepth(x, z) >= 1.0 ? 1 : -1; }
    return ok[k] > 0;
  };
  const si = Math.floor((ax - minX) / cell), sj = Math.floor((az - minZ) / cell);
  const gi = Math.floor((bx - minX) / cell), gj = Math.floor((bz - minZ) / cell);
  const g = new Float32Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const open = [];       // a plain binary heap of [f, k]
  const push = (f, k) => { open.push([f, k]); let i = open.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (open[p][0] <= open[i][0]) break; [open[p], open[i]] = [open[i], open[p]]; i = p; } };
  const pop = () => { const top = open[0], last = open.pop(); if (open.length) { open[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < open.length && open[l][0] < open[m][0]) m = l; if (r < open.length && open[r][0] < open[m][0]) m = r; if (m === i) break; [open[m], open[i]] = [open[i], open[m]]; i = m; } } return top; };
  const h = (i, j) => Math.hypot(i - gi, j - gj);
  const sk = sj * W + si, gk = gj * W + gi;
  // The two ends are known water; their cells' centres may not be (a
  // coarse grid puts a centre up to half a cell onto the bank).
  ok[sk] = 1; ok[gk] = 1;
  g[sk] = 0; push(h(si, sj), sk);
  let found = false, guard = 0;
  while (open.length && guard++ < 600000) {
    if ((guard & 63) === 0) yield;
    const [, k] = pop();
    if (closed[k]) continue;
    closed[k] = 1;
    if (k === gk) { found = true; break; }
    const i = k % W, j = (k - i) / W;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nk = nj * W + ni;
      if (closed[nk] || !water(ni, nj)) continue;
      // No cutting corners through land.
      if (di && dj && (!water(i + di, j) || !water(i, j + dj))) continue;
      const c = g[k] + Math.hypot(di, dj);
      if (c < g[nk]) { g[nk] = c; from[nk] = k; push(c + h(ni, nj), nk); }
    }
  }
  planInfo.W = W; planInfo.H = H; planInfo.found = found; planInfo.expanded = guard; planInfo.cell = cell;
  if (!found) return null;
  const pts = [];
  for (let k = gk; k !== -1; k = from[k]) { const i = k % W, j = (k - i) / W; pts.push({ x: minX + (i + 0.5) * cell, z: minZ + (j + 0.5) * cell }); }
  pts.reverse();
  pts[0] = { x: ax, z: az }; pts[pts.length - 1] = { x: bx, z: bz };
  // String-pull: skip every point a straight, clear line can pass. A long
  // route looks only a few dozen points ahead, or the pull would be the
  // dear part.
  const out = [pts[0]];
  const reach = Math.min(pts.length - 1, Math.max(12, Math.floor(240 / cell)));
  let i = 0;
  while (i < pts.length - 1) {
    let j = Math.min(pts.length - 1, i + reach), tries = 0;
    while (j > i + 1 && !clearLine(pts[i].x, pts[i].z, pts[j].x, pts[j].z, Math.max(2.5, cell / 2), 1.0)) { j--; if ((++tries & 3) === 0) yield; }
    out.push(pts[j]); i = j;
    yield;
  }
  return out;
}

/** planRouteGen, run to the end now. */
export function planRoute(ax, az, bx, bz, pad = 70, cell = 5, maxCells = 40000) {
  const gen = planRouteGen(ax, az, bx, bz, pad, cell, maxCells);
  for (;;) { const r = gen.next(); if (r.done) return r.value; }
}

/**
 * The water that connects to a point, as a generator: a flood fill over an
 * 8 m grid inside a box `R` metres each way, yielding between slices.
 * Returns the named waters reached, each with the farthest point of it
 * found: [{ r, x, z, d }], nearest first.
 */
function* reachGen(ax, az, R = 1800, cell = 8) {
  const W = Math.ceil(2 * R / cell);
  const ok = new Int8Array(W * W), seen = new Uint8Array(W * W);
  const water = (i, j) => {
    const k = j * W + i;
    if (!ok[k]) { const x = ax - R + (i + 0.5) * cell, z = az - R + (j + 0.5) * cell; ok[k] = isNavigable(x, z) && waterDepth(x, z) >= 1.0 ? 1 : -1; }
    return ok[k] > 0;
  };
  const si = Math.floor(R / cell), sj = si;
  const q = [sj * W + si]; seen[q[0]] = 1;
  const found = new Map();
  let n = 0;
  while (q.length && n < 300000) {
    const k = q.pop(); n++;
    if ((n & 63) === 0) yield;
    const i = k % W, j = (k - i) / W;
    const x = ax - R + (i + 0.5) * cell, z = az - R + (j + 0.5) * cell;
    if ((n & 7) === 0) {
      const r = regionAt(x, z), d = Math.hypot(x - ax, z - az);
      const e = found.get(r);
      if (!e || d > e.d) found.set(r, { r, x, z, d });
    }
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= W) continue;
      const nk = nj * W + ni;
      if (seen[nk] || !water(ni, nj)) continue;
      if (di && dj && (!water(i + di, j) || !water(i, j + dj))) continue;
      seen[nk] = 1; q.push(nk);
    }
  }
  return [...found.values()].sort((a, b) => a.d - b.d);
}

/** Open water near a point: the point itself, or the nearest spot with depth, within 70 m. */
function waterNear(x, z, depth = 2.5) {
  if (waterDepth(x, z) >= depth && isNavigable(x, z)) return { x, z };
  for (let r = 8; r <= 70; r += 8) for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (waterDepth(px, pz) >= depth && isNavigable(px, pz)) return { x: px, z: pz };
  }
  return null;
}

function routeLength(r) { let L = 0; for (let i = 1; i < r.length; i++) L += Math.hypot(r[i].x - r[i - 1].x, r[i].z - r[i - 1].z); return L; }

/** The point `s` metres along a polyline. */
function pointAlong(route, s) {
  let acc = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (acc + L >= s) { const k = L ? (s - acc) / L : 0; return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k }; }
    acc += L;
  }
  return route[route.length - 1];
}

/** How far along a polyline a point is (its nearest point on it), in metres. */
function alongRoute(route, x, z) {
  let best = Infinity, bestS = 0, acc = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
    let t = L2 ? ((x - a.x) * dx + (z - a.z) * dz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.x + dx * t, pz = a.z + dz * t;
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < best) { best = d; bestS = acc + Math.sqrt(L2) * t; }
    acc += Math.sqrt(L2);
  }
  return bestS;
}

/**
 * The rock along a route: how many boulders stand within ten metres of
 * it, and what share of it runs through rapids. A run through the rocks
 * wants both.
 */
function* rockinessGen(route) {
  const L = routeLength(route);
  const seen = new Set();
  const samples = [];
  let rapids = 0, n = 0;
  for (let s = 0; s <= L; s += 4) {
    if ((++n & 15) === 0) yield;
    const p = pointAlong(route, s);
    const r = regionAt(p.x, p.z);
    if (r.type === 'rapids') rapids++;
    const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
    let here = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      for (const b of cellFeatures(cx + dx, cz + dz).boulders) {
        if (Math.abs(b.x - p.x) > 10 || Math.abs(b.z - p.z) > 10) continue;
        if (Math.hypot(b.x - p.x, b.z - p.z) <= 10) { seen.add(b); here++; }
      }
    }
    samples.push({ s, x: p.x, z: p.z, rocks: here });
  }
  return { rocks: seen.size, rapidsFrac: samples.length ? rapids / samples.length : 0, samples, L };
}

/** The named waters a route runs through, in order, the short crossings folded away. */
function routeLegs(route) {
  const L = routeLength(route);
  const legs = [];
  for (let s = 0; s <= L; s += 15) {
    const p = pointAlong(route, s);
    const r = regionAt(p.x, p.z);
    if (!legs.length || legs[legs.length - 1].r !== r) legs.push({ r, name: r.name, s0: s, s1: s });
    else legs[legs.length - 1].s1 = s;
  }
  // A water crossed for less than fifty metres is not worth a line.
  const out = [];
  for (const l of legs) {
    if (out.length && l.s1 - l.s0 < 50) { out[out.length - 1].s1 = l.s1; continue; }
    if (out.length && out[out.length - 1].r === l.r) { out[out.length - 1].s1 = l.s1; continue; }
    out.push({ r: l.r, name: l.name, s0: l.s0, s1: l.s1 });
  }
  if (out.length) out[out.length - 1].s1 = L;
  return out.map(({ name, s0, s1 }) => ({ name, s0, s1 }));
}

class Fisherman {
  constructor(fleet, name, key, x, z, heading) {
    this.fleet = fleet;
    this.name = name;
    this.key = key;
    this.boat = new Boat(fleet.scene, fleet.lake, fleet.player);
    this.boat.placeAt(x, z, heading);
    this.ready = false;
    this.state = 'cruise';
    this.timer = 0;
    this.route = null; this.wp = 0;
    this.target = null;
    this.throttle = 1;
    this.lastOffer = -1e9;
    this.stuck = 0;
    this.age = 0;
    this.idle = false;             // just out on the water: never calls across
    this.group = null;             // the circling three, when one of them
    this.lod = 0; this.acc = 0; this.shadowed = true;
    this.helmCache = null; this.helmT = 0;
    this.label = nameSprite(name);
    this.label.visible = false;
    fleet.scene.add(this.label);
    // Fishing gear: a line and a float, and the fish when one is on.
    this.line = null; this.bobber = null; this.fish = null; this.lineOut = 0;
    this.cast = null;
    this.boat.setBoat(key, { lite: true }).then(() => { this.ready = true; this.label.visible = true; });
  }

  get pos() { return this.boat.pos; }

  /** Where to go next: a spot of open water some way off, reachable in a straight line. */
  pickWaypoint(rng = Math.random) {
    const p = this.pos;
    for (let i = 0; i < 24; i++) {
      const a = rng() * Math.PI * 2, d = 50 + rng() * 160;
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (waterDepth(x, z) < 2 || !isNavigable(x, z)) continue;
      if (!clearLine(p.x, p.z, x, z, 4, 1.2)) continue;
      return { x, z };
    }
    return null;
  }

  /** Set off along a route to (x, z), planned round the land. */
  goTo(x, z) {
    const r = planRoute(this.pos.x, this.pos.z, x, z);
    if (!r) return false;
    this.route = r; this.wp = 1; this.target = { x, z };
    return true;
  }

  /** Take up a given route from its nearest point ahead. */
  rejoin(route) {
    let best = 1, bd = Infinity;
    for (let i = 1; i < route.length; i++) { const d = Math.hypot(route[i].x - this.pos.x, route[i].z - this.pos.z); if (d < bd) { bd = d; best = i; } }
    this.route = route.map((p) => ({ ...p })); this.wp = best; this.helmCache = null; this.stuck = 0;
  }

  /** How far along the route, 0..1 by arc length. */
  routeProgress() {
    if (!this.route) return 0;
    const L = routeLength(this.route) || 1;
    let done = 0;
    for (let i = 1; i < this.wp && i < this.route.length; i++) done += Math.hypot(this.route[i].x - this.route[i - 1].x, this.route[i].z - this.route[i - 1].z);
    const n = this.route[Math.min(this.wp, this.route.length - 1)], pr = this.route[Math.max(0, Math.min(this.wp, this.route.length - 1) - 1)];
    const seg = Math.hypot(n.x - pr.x, n.z - pr.z) || 1;
    const toGo = Math.hypot(n.x - this.pos.x, n.z - this.pos.z);
    return Math.min(1, (done - Math.min(seg, toGo) + seg) / L);
  }

  /**
   * The helm: a stick vector toward the next waypoint, bent round anything
   * ahead, throttled, and steered clear of the player's hulls.
   */
  helm(dt) {
    const b = this.boat;
    if (!this.route || this.wp >= this.route.length) return { x: 0, z: 0 };
    const n = this.route[this.wp];
    let dx = n.x - b.pos.x, dz = n.z - b.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < (this.wp === this.route.length - 1 ? 4 : 7)) { this.wp++; this.helmCache = null; return this.helm(dt); }
    dx /= d; dz /= d;
    return this.steerTo(dx, dz, dt);
  }

  /** The stick for a wanted direction, bent round what is ahead and eased for it. */
  steerTo(dx, dz, dt) {
    const b = this.boat;
    // Feelers: if the way ahead is foul, swing the wanted heading off it.
    // They are cast a few times a second, not every frame — the water does
    // not change that fast, and each probe costs a terrain lookup.
    this.helmT += dt;
    let best, bestScore;
    if (this.helmCache && this.helmT < 0.25) { best = this.helmCache.best; bestScore = this.helmCache.score; }
    else {
      this.helmT = 0;
      const look = 8 + b.speed * 1.5;
      best = null; bestScore = -Infinity;
      for (const off of [0, 0.4, -0.4, 0.85, -0.85, 1.3, -1.3]) {
        const ca = Math.cos(off), sa = Math.sin(off);
        const ux = dx * ca - dz * sa, uz = dx * sa + dz * ca;
        let clear = 1;
        for (const dd of [look * 0.5, look]) if (!isNavigable(b.pos.x + ux * dd, b.pos.z + uz * dd) || waterDepth(b.pos.x + ux * dd, b.pos.z + uz * dd) < 0.9) { clear = dd / look - 0.5; break; }
        const score = clear - Math.abs(off) * 0.25;
        if (score > bestScore) { bestScore = score; best = { x: ux, z: uz, clear }; }
      }
      this.helmCache = { best, score: bestScore };
    }
    // Slow down for a turn or a tight spot; crawl when boxed in. A boat
    // that is meant to win a bet (flatOut) is never eased: it bends round
    // what is ahead at full throttle.
    let thr = this.throttle * (bestScore > 0.6 || this.flatOut ? 1 : 0.5);
    if (bestScore < 0.1 && !this.flatOut) thr = 0.25;
    // A hull that has not moved in a while backs off and tries again.
    if (b.speed < 0.3 && thr > 0.2) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (this.stuck > 3) { thr = -0.5; if (this.stuck > 5) { this.stuck = 0; this.route = null; } }
    let want = { x: best.x * thr, z: best.z * thr };
    for (const v of this.fleet.vessels) want = steerClear(b, v, want, 5);
    return want;
  }

  // --- fishing, as a show ---
  startFishing(rng = Math.random) {
    this.state = 'fish';
    this.timer = 30 + rng() * 45;
    this.boat.anchored = true;
    this.castTimer = 1 + rng() * 2;
    this.castIndex = 0;
  }

  /** Swing a rod and put a float out. */
  doCast(rng = Math.random) {
    const b = this.boat;
    const i = this.castIndex % Math.max(1, b.rods.length);
    this.castIndex++;
    const r = b.rods[i];
    if (!r) return;
    const side = r.side || 1;
    const yaw = side * (0.6 + rng() * 0.7);
    b.castRod(i, yaw);
    // The float lands out on that bearing, past the rail.
    const bear = b.heading + Math.PI + yaw;          // rod yaw 0 is aft
    const dist = 6 + rng() * 8;
    const tx = b.pos.x + Math.sin(bear) * dist, tz = b.pos.z + Math.cos(bear) * dist;
    if (!this.bobber) {
      const g = new THREE.Group();
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshStandardMaterial({ color: 0xe33d2e, roughness: 0.3 }));
      const bot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf7f3e8, roughness: 0.3 }));
      top.position.y = 0.08; bot.position.y = -0.06; g.add(top, bot);
      this.fleet.scene.add(g); this.bobber = g;
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf5f5f5, transparent: true, opacity: 0.6 }));
      this.line.frustumCulled = false; this.fleet.scene.add(this.line);
    }
    this.cast = { rod: i, t: 0, fly: 0.45, x: tx, z: tz, sx: b.pos.x, sz: b.pos.z, bite: 5 + rng() * 11, fight: 0, phase: 'fly' };
    this.bobber.visible = true; this.line.visible = true;
  }

  updateFishing(dt, t, rng = Math.random) {
    const b = this.boat;
    this.timer -= dt;
    if (!this.cast) {
      this.castTimer -= dt;
      if (this.castTimer <= 0) {
        // The rod comes up first, and the float flies off its swing.
        this.doCast(rng); this.cast.t = -0.45;
      }
      if (this.timer <= 0) { this.state = 'idle'; this.timer = 0; }
      return;
    }
    const c = this.cast;
    c.t += dt;
    const tip = this.fleet._tip; b.rodTipWorld(c.rod, tip);
    let bx, bz, by;
    if (c.phase === 'fly') {
      if (c.t < 0) { bx = tip.x; bz = tip.z; by = tip.y; }
      else {
        const k = Math.min(1, c.t / c.fly);
        bx = tip.x + (c.x - tip.x) * k; bz = tip.z + (c.z - tip.z) * k;
        by = CONFIG.WATER_LEVEL + tip.y * (1 - k) + Math.sin(k * Math.PI) * 2.5;
        if (k >= 1) { c.phase = 'out'; c.t = 0; }
      }
    } else if (c.phase === 'out') {
      bx = c.x; bz = c.z; by = CONFIG.WATER_LEVEL + Math.sin(t * 2.2) * 0.04;
      if (c.t > c.bite) {
        c.phase = 'fight'; c.t = 0; c.fight = 3 + rng() * 5;
        const pool = poolFor(waterKind(bx, bz));
        const sp = speciesInTiers(0, 3, pool);
        const species = this.matchSpecies && rng() < 0.7 ? this.matchSpecies : sp[Math.floor(rng() * sp.length)];
        this.fish = new HookedFish(this.fleet.scene, species, 0.7 + rng() * 0.8);
        this.fleet.onNpcHook && this.fleet.onNpcHook(this, species);
      }
    } else if (c.phase === 'fight') {
      // The float comes in, fighting; the rod loads up.
      const k = Math.min(1, c.t / c.fight);
      const ease = k * k;
      bx = c.x + (b.pos.x - c.x) * ease * 0.85; bz = c.z + (b.pos.z - c.z) * ease * 0.85;
      bx += Math.sin(t * 3.1) * 0.6 * (1 - k); bz += Math.cos(t * 2.7) * 0.6 * (1 - k);
      by = CONFIG.WATER_LEVEL + Math.sin(t * 6) * 0.08;
      this.lineOut = Math.hypot(tip.x - bx, tip.z - bz);
      if (this.fish) this.fish.update(dt, t, { x: bx, z: bz }, tip, this.lineOut, k > 0.86 ? (k - 0.86) / 0.14 : 0);
      if (k >= 1) { this.endCast(); return; }
    }
    this.bobber.position.set(bx, by, bz);
    const p = this.line.geometry.attributes.position;
    p.setXYZ(0, tip.x, tip.y, tip.z); p.setXYZ(1, bx, by + 0.1, bz); p.needsUpdate = true;
    b.aimRods([{ index: c.rod, x: bx, z: bz, load: c.phase === 'fight' ? 0.5 + 0.5 * Math.abs(Math.sin(t * 4)) : 0.05 }]);
  }

  endCast() {
    if (this.fish) { this.fish.dispose(); this.fish = null; }
    if (this.bobber) { this.bobber.visible = false; this.line.visible = false; }
    this.boat.aimRods([]);
    this.cast = null;
    this.castTimer = 2 + Math.random() * 4;
  }

  dispose() {
    this.endCast();
    if (this.bobber) { this.fleet.scene.remove(this.bobber, this.line); this.line.geometry.dispose(); }
    this.fleet.scene.remove(this.label);
    // The boat's own gear: wake, smoke, net, hull.
    const b = this.boat;
    this.fleet.scene.remove(b.group);
    b.wake.dispose(); b.smoke.dispose && b.smoke.dispose();
    b.net.dispose && b.net.dispose();
  }
}

// --- the fleet ----------------------------------------------------------------

export class NpcFleet {
  constructor(scene, lake, player, rtp, hud, fishing, docks, ambientFish = null) {
    this.scene = scene; this.lake = lake; this.player = player; this.rtp = rtp; this.hud = hud; this.fishing = fishing; this.docks = docks;
    this.ambientFish = ambientFish;
    this.boats = [];
    this.vessels = [];             // the player's hulls, for steering clear and collisions
    this.rng = mulberry32((Date.now() & 0xffffff) >>> 0);
    this.nextEncounter = FIRST_MIN + this.rng() * (FIRST_MAX - FIRST_MIN);
    this.lonely = 0;
    this.usedNames = new Set();
    this._tip = new THREE.Vector3();
    this.challenge = null;         // the live side bet
    this.offer = null;             // one on the table
    this.lastOfferAt = -1e9;
    this.time = 0;
    this.group = null;             // the circling three, while they wait
    this.onNpcHook = null;
    this.enabled = true;
    fishing.onCatch = (c) => this.playerCaught(c);
  }

  // --- spawning: encounters ---
  /**
   * A hull for a new boat: small and common mostly, big ones rare and
   * rarer in narrow water; `purpose` 'group' wants the long haul's sturdy
   * mid-sized boats.
   */
  pickHull(x, z, purpose = null) {
    const rng = this.rng;
    const cat = fleetCatalog();
    const narrow = NARROW.has(regionAt(x, z).type);
    const w = cat.map((_, i) => {
      let v = (purpose === 'group' ? HULL_W_GROUP : HULL_W)[i] ?? 1;
      // Narrow water: the working boats seldom, the big ones almost never —
      // and the long haul's boats, which have to thread it at speed, never.
      if (narrow && i >= 3) v *= purpose === 'group' ? 0.02 : i >= 6 ? 0.05 : 0.25;
      return v;
    });
    const total = w.reduce((a, b) => a + b, 0);
    let r = rng() * total, hi = 0;
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) { hi = i; break; } }
    const skins = cat[hi].skins;
    return skins[Math.floor(rng() * skins.length)].key;
  }

  newBoat(x, z, heading, purpose = null) {
    const rng = this.rng;
    const key = this.pickHull(x, z, purpose);
    let name = NAMES[Math.floor(rng() * NAMES.length)];
    for (let n = 0; this.usedNames.has(name) && n < 30; n++) name = NAMES[Math.floor(rng() * NAMES.length)];
    this.usedNames.add(name);
    const f = new Fisherman(this, name, key, x, z, heading);
    f.idle = purpose !== 'group' && rng() < IDLE_SHARE;
    this.boats.push(f);
    return f;
  }

  /** Open, still water at about `dist` from (px, pz) in direction `a`, give or take; `room` is the clear radius wanted. */
  spotAt(px, pz, a, dist, spread = 0.5, room = 8) {
    const rng = this.rng;
    for (let i = 0; i < 28; i++) {
      const ang = a + (rng() - 0.5) * 2 * spread, d = dist * (0.65 + rng() * 0.7);
      const x = px + Math.cos(ang) * d, z = pz + Math.sin(ang) * d;
      if (waterDepth(x, z) < 1.8 || !isNavigable(x, z)) continue;
      let ok = true;
      for (let k = 0; k < 8 && ok; k++) { const t = k / 8 * Math.PI * 2; if (!isNavigable(x + Math.cos(t) * room, z + Math.sin(t) * room) || waterDepth(x + Math.cos(t) * room, z + Math.sin(t) * room) < 1.2) ok = false; }
      if (ok) return { x, z };
    }
    return null;
  }

  /**
   * Put a boat on the water where the player will come across it. `kind`:
   *   passing — crosses the player's path from one side to the other;
   *   moored  — anchored ahead of the player, fishing;
   *   marina  — bound for a marina near the player.
   * Returns the boat, or null when the water round here has no room for it.
   */
  spawnEncounter(kind = null) { const g = this.spawnEncounterGen(kind); for (;;) { const r = g.next(); if (r.done) return r.value; } }

  *spawnEncounterGen(kind = null) {
    const me = this.vessels[0]; if (!me || this.boats.length >= MAX_ALIVE) return null;
    const rng = this.rng;
    const px = me.pos.x, pz = me.pos.z;
    const heading = Math.atan2(-Math.sin(me.heading), -Math.cos(me.heading));   // the way the player points, as an angle over x/z
    const moving = me.speed > 1;
    if (!kind) { const r = rng(); kind = r < 0.45 ? 'passing' : r < 0.75 ? 'moored' : 'marina'; }
    if (kind === 'marina') {
      const near = this.docks.nearest(px, pz);
      if (!near.dock || near.dist > 420) kind = rng() < 0.5 ? 'passing' : 'moored';
    }
    if (kind === 'passing') {
      // In from somewhere, past the player a boat-length or two off the
      // beam, and on out somewhere else — along whatever water there is,
      // so a creek gets a boat coming down it and a lake one crossing it.
      const side = rng() < 0.5 ? 1 : -1;
      const P = this.spotAt(px, pz, heading + Math.PI / 2 * side, 14, 0.3) || { x: px, z: pz };
      for (let i = 0; i < 6; i++) {
        const S = this.spotAt(px, pz, rng() * Math.PI * 2, 240, Math.PI);
        if (!S) continue;
        const r1 = yield* planRouteGen(S.x, S.z, P.x, P.z, 80);
        if (!r1) continue;
        const inA = Math.atan2(S.z - pz, S.x - px);
        for (let j = 0; j < 6; j++) {
          const G = this.spotAt(px, pz, rng() * Math.PI * 2, 240, Math.PI);
          if (!G) continue;
          const outA = Math.atan2(G.z - pz, G.x - px);
          if (Math.abs(wrapAngle(outA - inA)) < 1.2) continue;      // not straight back the way it came
          const r2 = yield* planRouteGen(P.x, P.z, G.x, G.z, 80);
          if (!r2) continue;
          const f = this.newBoat(S.x, S.z, Math.atan2(r1[1].x - S.x, r1[1].z - S.z) + Math.PI);
          f.route = r1.concat(r2.slice(1)); f.wp = 1; f.target = G; f.state = 'cruise'; f.throttle = 0.6 + rng() * 0.4;
          f.encounter = 'passing';
          return f;
        }
      }
      kind = 'moored';
    }
    if (kind === 'moored') {
      // Ahead of the player if they are under way, else anywhere round them.
      const a = moving ? heading : rng() * Math.PI * 2;
      const S = this.spotAt(px, pz, a, 170, moving ? 0.35 : Math.PI);
      if (!S) return null;
      const f = this.newBoat(S.x, S.z, rng() * Math.PI * 2);
      f.startFishing(rng); f.timer = 60 + rng() * 120; f.encounter = 'moored';
      return f;
    }
    if (kind === 'marina') {
      const d = this.docks.nearest(px, pz).dock;
      const hx = d.headX + Math.sin(d.angle) * 9, hz = d.headZ + Math.cos(d.angle) * 9;
      for (let i = 0; i < 8; i++) {
        const S = this.spotAt(px, pz, rng() * Math.PI * 2, 240, Math.PI);
        if (!S) continue;
        const r = yield* planRouteGen(S.x, S.z, hx, hz, 80);
        if (!r) continue;
        const f = this.newBoat(S.x, S.z, rng() * Math.PI * 2);
        f.route = r; f.wp = 1; f.state = 'toMarina'; f.throttle = 0.6 + rng() * 0.3; f.encounter = 'marina';
        return f;
      }
      return yield* this.spawnEncounterGen('moored');
    }
    return null;
  }

  /**
   * Three boats circling on open water ahead of the player, waiting for a
   * fourth: the long haul. The finish — a named water three or four basins
   * off, reached by water — is found while they wait, a slice a frame.
   */
  spawnGroup(cands) {
    const me = this.vessels[0]; if (!me || this.group || this.boats.length + 3 > MAX_ALIVE) return null;
    const rng = this.rng;
    const px = me.pos.x, pz = me.pos.z;
    const heading = Math.atan2(-Math.sin(me.heading), -Math.cos(me.heading));
    const moving = me.speed > 1;
    // Room for a circle: a wide one on a lake, a tighter one in a creek.
    let C = null, R = CIRCLE_R;
    for (const room of [CIRCLE_R + 8, CIRCLE_R + 2, 12]) {
      C = this.spotAt(px, pz, moving ? heading : rng() * Math.PI * 2, 180, moving ? 0.4 : Math.PI, room) || this.spotAt(px, pz, rng() * Math.PI * 2, 200, Math.PI, room);
      if (C) { R = Math.max(8, room - 4); break; }
    }
    if (!C) return null;
    const boats = [];
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2;
      const f = this.newBoat(C.x + Math.cos(a) * R, C.z + Math.sin(a) * R, Math.atan2(-Math.sin(a), -Math.cos(a)), 'group');
      f.state = 'circle'; f.phase = a; f.encounter = 'group'; f.throttle = 0.4;
      boats.push(f);
    }
    // The nimblest of the three leads on a lost bet: it has the creeks to thread.
    boats.sort((a, b) => a.boat.spec.length - b.boat.spec.length);
    // The finish is picked from the waters the scout found (the farthest
    // it can reach), and the route to it is planned while they circle, a
    // slice a frame.
    const ccx = Math.floor(C.x / CELL), ccz = Math.floor(C.z / CELL);
    const g = this.group = { boats, center: C, r: R, basin: basinOf(ccx, ccz), phase: 0, cands: cands.slice(), plan: null, finish: null, route: null, legs: null, wait: 0, ready: false };
    g.minL = cands.length && cands[0].d >= 900 ? 900 : 600;
    for (const f of boats) f.group = g;
    return g;
  }

  /**
   * Before the three are sent, the water round the player is scouted: a
   * flood fill (sliced over frames) of what connects to here. Only water
   * that runs six hundred metres and more gets a long haul; anywhere
   * smaller gets an ordinary encounter instead.
   */
  beginScout() {
    const me = this.vessels[0]; if (!me) return;
    const cx = Math.floor(me.pos.x / CELL), cz = Math.floor(me.pos.z / CELL);
    this.scout = { gen: reachGen(me.pos.x, me.pos.z), basin: basinOf(cx, cz), cands: null };
    this.scoutCands = null;
  }

  /** Advance the scout; true once it is done, with `scoutCands` set (maybe empty). */
  advanceScout(budgetMs) {
    const s = this.scout; if (!s) return true;
    const t0 = performance.now();
    for (;;) {
      const step = s.gen.next();
      if (step.done) {
        this.scoutCands = this.finishCandidates({ basin: s.basin }, step.value).filter((e) => e.d >= 600);
        this.scout = null;
        return true;
      }
      if (performance.now() - t0 > budgetMs) return false;
    }
  }

  /**
   * The finish candidates, from the waters the flood fill reached: three
   * or four basins off by preference, then two, then whatever is far;
   * never the open sea while there is anything else; a kilometre by water
   * at least, or six hundred metres where the water runs no further.
   */
  finishCandidates(g, reached) {
    const b0 = g.basin;
    const scored = reached.map((e) => {
      const b = basinOf(e.r.cx, e.r.cz);
      const bd = Math.max(Math.abs(b.bx - b0.bx), Math.abs(b.bz - b0.bz));
      return { ...e, bd, sea: e.r.type === 'ocean' };
    }).filter((e) => e.d >= 500);
    const far = scored.filter((e) => !e.sea && e.bd >= 3 && e.bd <= 4);
    const mid = scored.filter((e) => !e.sea && e.bd === 2);
    const rest = scored.filter((e) => !e.sea && e.bd < 2);
    const sea = scored.filter((e) => e.sea);
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    // Within a tier, the farther the better, with a little chance in it.
    const order = (a) => shuffle(a).sort((x, y) => (y.d - x.d) * 0.7 + (this.rng() - 0.5) * 400);
    return [...order(far), ...order(mid), ...order(rest), ...order(sea)].slice(0, 6);
  }

  /** The circling boats' plan, advanced a slice. */
  planGroup(g, budgetMs) {
    if (g.ready || g.dead) return;
    const t0 = performance.now();
    while (performance.now() - t0 < budgetMs) {
      if (!g.plan) {
        const e = g.cands.shift();
        if (!e) { this.disperseGroup(g); return; }
        const w = waterNear(e.x, e.z, 1.5);
        if (!w) continue;
        // Eight-metre cells: the creeks between basins are narrower than a
        // coarser grid sees. A wide box: the water between two points
        // winds well outside the straight line's surroundings.
        const pad = Math.min(1000, 0.6 * e.d + 150);
        g.plan = { r: e.r, w, gen: planRouteGen(g.center.x, g.center.z, w.x, w.z, pad, 8, 420000) };
      }
      const step = g.plan.gen.next();
      if (!step.done) continue;
      const route = step.value;
      const { r, w } = g.plan; g.plan = null;
      if (!route) continue;
      const L = routeLength(route);
      if (L < g.minL) continue;              // by water it must be a haul
      g.finish = { x: w.x, z: w.z, name: r.name }; g.route = route; g.legs = routeLegs(route); g.L = L;
      g.ready = true;
      return;
    }
  }

  /** The circling boats give up waiting and go their ways. */
  disperseGroup(g) {
    g.dead = true;
    for (const f of g.boats) { if (f.state === 'circle') { f.state = 'idle'; f.timer = 0; } f.group = null; }
    if (this.group === g) this.group = null;
  }

  // --- the side bets ---
  /** The player passes a boat: it may call across. */
  maybeOffer(f) {
    if (this.challenge || this.offer || this.offerJob || !this.enabled || f.idle) return;
    if (this.time - this.lastOfferAt < GLOBAL_COOLDOWN || this.time - f.lastOffer < OFFER_COOLDOWN) return;
    if (!f.ready || f.state === 'race' || f.state === 'circle') return;
    const me = this.vessels[0]; if (!me) return;
    const d = Math.hypot(f.pos.x - me.pos.x, f.pos.z - me.pos.z);
    if (d > OFFER_RANGE) return;
    // The offer (its route, its gates) is worked out over the next frames,
    // not in this one, and put on the table when it is ready.
    const kind = this.kindFor(f);
    const kinds = kind === 'agility' ? ['agility', 'race', 'fishing'] : kind === 'race' ? ['race', 'fishing'] : ['fishing'];
    f.lastOffer = this.time;
    this.offerJob = { f, kinds, gen: null, me: { pos: { x: me.pos.x, z: me.pos.z } } };
  }

  /** Advance the offer being built; put it on the table when it is done. */
  advanceOffer(budgetMs) {
    const j = this.offerJob; if (!j) return;
    const t0 = performance.now();
    for (;;) {
      if (!j.gen) { const k = j.kinds.shift(); if (!k) { this.offerJob = null; return; } j.gen = this.buildOfferGen(j.f, k, j.me); }
      const step = j.gen.next();
      if (step.done) {
        j.gen = null;
        const offer = step.value;
        if (offer) {
          this.offerJob = null;
          const me = this.vessels[0];
          // Still close, and nothing else on: call across.
          if (!this.challenge && !this.offer && me && Math.hypot(j.f.pos.x - me.pos.x, j.f.pos.z - me.pos.z) < OFFER_RANGE * 2) {
            this.lastOfferAt = this.time;
            this.offer = offer;
            this.hud.showChallenge(offer, () => this.accept(), () => this.decline());
          }
          return;
        }
      }
      if (performance.now() - t0 > budgetMs) return;
    }
  }

  /** The circling three: when the player comes alongside, the long haul is on the table. */
  maybeOfferGroup(g, me) {
    if (this.challenge || this.offer || !this.enabled || !g.ready) return;
    if (this.time - this.lastOfferAt < 8) return;
    if (Math.hypot(g.center.x - me.pos.x, g.center.z - me.pos.z) > g.r + 26) return;
    if (!g.boats.every((f) => f.ready)) return;
    const stake = this.stakeFor();
    if (stake <= 0) return;
    const km = (g.L / 1000).toFixed(1);
    const lead = g.boats[0];
    const offer = { npc: lead, boats: g.boats, group: g, kind: 'long', stake, goal: g.finish, route: g.route, legs: g.legs, title: 'The long haul',
      text: `Four boats, one finish: ${g.finish.name}, ${km} km by water. First one there takes the lot.` };
    this.offer = offer; this.lastOfferAt = this.time;
    this.hud.showChallenge(offer, () => this.accept(), () => this.decline());
  }

  /** What this boat's owner proposes: by hull — the nimble ones run the rocks and race, the working boats fish. */
  kindFor(f) {
    const w = OFFER_W[f.boat.spec.hullId] || { fishing: 1 };
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    let r = this.rng() * total;
    for (const [k, v] of Object.entries(w)) { r -= v; if (r <= 0) return k; }
    return 'fishing';
  }

  /** A stake the player can afford: a tenth of the wallet, to a tidy figure. */
  stakeFor() {
    const b = this.player.balance;
    if (b < 1) return 0;
    const raw = Math.max(1, b * 0.1);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const nice = [1, 2, 5, 10].map((m) => m * mag).filter((v) => v <= raw);
    return Math.min(b, nice.length ? nice[nice.length - 1] : 1);
  }

  buildOffer(f, kind, me) { const g = this.buildOfferGen(f, kind, me); for (;;) { const r = g.next(); if (r.done) return r.value; } }

  *buildOfferGen(f, kind, me) {
    const stake = this.stakeFor();
    if (stake <= 0) return null;
    const rng = this.rng;
    if (kind === 'fishing') {
      const pool = poolFor(waterKind(me.pos.x, me.pos.z));
      const sp = speciesInTiers(1, 3, pool);
      const species = sp[Math.floor(rng() * sp.length)];
      return { npc: f, kind, stake, species, seconds: 90, title: 'Fishing match',
        text: `Most ${species.name} by weight on the rod in 90 seconds. Nothing else counts; nothing is paid. Loser buys.` };
    }
    // A race or a run: a named water off a way, with a route to it round
    // the land. A run wants a rapid: rock along the route, and plenty of it.
    const cx = Math.floor(me.pos.x / CELL), cz = Math.floor(me.pos.z / CELL);
    const cands = [];
    const reach = kind === 'agility' ? 3 : 2;
    for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
      const r = cellRegion(cx + dx, cz + dz);
      if (r.type === 'ocean') continue;
      if (kind === 'agility' && r.type !== 'rapids') continue;
      const w = waterNear(r.x, r.z);
      if (!w) continue;
      const d = Math.hypot(w.x - me.pos.x, w.z - me.pos.z);
      if (d < (kind === 'agility' ? 100 : 150) || d > (kind === 'agility' ? 640 : 520)) continue;
      cands.push({ r, d, w });
    }
    // Nearest rapids first for a run: the route runs through it soonest.
    if (kind === 'agility') cands.sort((a, b) => a.d - b.d);
    let tries = 0;
    while (cands.length && tries++ < 5) {
      const i = kind === 'agility' ? 0 : Math.floor(rng() * cands.length);
      const { r, d, w } = cands.splice(i, 1)[0];
      const route = yield* planRouteGen(me.pos.x, me.pos.z, w.x, w.z, 90);
      if (!route) continue;
      const L = routeLength(route);
      if (L > d * 2.8) continue;
      if (kind === 'race') return { npc: f, kind, stake, goal: { x: w.x, z: w.z, name: r.name }, route, title: 'Race', text: `First boat to ${r.name} takes it.` };
      // A run: the route must thread real rock. The gates go where the
      // rocks are thickest, in order along the way.
      const rk = yield* rockinessGen(route);
      if (rk.rocks < 8 || rk.rapidsFrac < 0.2) continue;
      const gates = [];
      const minGap = Math.max(25, rk.L / 7);
      const ranked = rk.samples.filter((s) => s.rocks > 0 && s.s > 20 && s.s < rk.L - 15).sort((a, b) => b.rocks - a.rocks || a.s - b.s);
      for (const s of ranked) {
        if (gates.length >= 4) break;
        if (gates.some((g) => Math.abs(g.s - s.s) < minGap)) continue;
        gates.push(s);
      }
      if (gates.length < 3) continue;
      gates.sort((a, b) => a.s - b.s);
      const out = gates.map((s) => {
        const q = pointAlong(route, Math.max(0, s.s - 3));
        let tx = s.x - q.x, tz = s.z - q.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        return { x: s.x, z: s.z, nx: -tz, nz: tx };
      });
      return { npc: f, kind, stake, goal: { x: w.x, z: w.z, name: r.name }, route, gates: out, title: 'Run the rocks', text: `Through the ${out.length} gates in the rocks to ${r.name}, in order — first one home.` };
    }
    return null;
  }

  accept() {
    const o = this.offer; if (!o) return;
    this.offer = null;
    this.hud.hideChallenge();
    if (this.player.balance < o.stake) { this.hud.hint('Not enough in the wallet'); if (o.group) this.disperseGroup(o.group); return; }
    // The bet, placed and resolved now. What follows is staged to match.
    this.player.balance -= o.stake;
    this.rtp.wager(o.stake);
    const r = this.rtp.sideBet(o.stake);
    const me = this.vessels[0];
    const limit = o.kind === 'fishing' ? o.seconds : o.kind === 'long' ? Math.max(420, Math.round(routeLength(o.route) / 3.2) + 120) : 240;
    const c = this.challenge = { ...o, win: r.win, payout: r.payout, t: 0, limit, margin: 0.08 + this.rng() * 0.08, youKg: 0, npcKg: 0, gate: 0, npcGate: 0, legAt: 0 };
    const f = o.npc;
    if (o.kind === 'fishing') {
      f.endCast(); f.state = 'match'; f.timer = 0; f.boat.anchored = false;
      f.startFishing(this.rng); f.state = 'match'; f.timer = 1e9; f.matchSpecies = o.species; c.npcCatches = 0;
      // The rods play the match's game: free casts, the water thick with
      // the species, everything else tossed back.
      this.fishing.startMatch(o.species);
      if (this.ambientFish) this.ambientFish.setFeature(o.species);
    } else if (o.kind === 'long') {
      for (const b of o.boats) { b.endCast(); b.state = 'race'; b.timer = 0; b.boat.anchored = false; b.group = null; b.rejoin(o.route); b.throttle = 0.3; b.target = o.goal; }
      if (o.group) { o.group.dead = true; if (this.group === o.group) this.group = null; }
      c.margins = o.boats.map((_, i) => c.margin + i * 0.05);
      c.L = routeLength(o.route);
    } else {
      f.endCast(); f.state = 'race'; f.timer = 0; f.boat.anchored = false;
      f.route = o.route.map((p) => ({ ...p })); f.wp = 1; f.target = o.goal; f.throttle = 0.3;
    }
    c.d0 = Math.hypot(o.goal ? o.goal.x - me.pos.x : 0, o.goal ? o.goal.z - me.pos.z : 0) || 1;
    this.hud.setComp(c, 0, 0);
    if (c.gates) this.showGates(c.gates);
    this.hud.toast(`<div class="catch-body"><div class="catch-name">${f.name}: "You're on!"</div><div class="catch-sub">$${o.stake} down · ${o.title}</div></div>`, 'meh', 3000);
  }

  decline() {
    const o = this.offer; if (!o) return;
    this.offer = null;
    this.hud.hideChallenge();
    this.hud.hint(`${o.npc.name}: "Suit yourself."`, 2200);
    if (o.group) this.disperseGroup(o.group);
  }

  showGates(gates) {
    this.gateMeshes = [];
    const geo = new THREE.SphereGeometry(0.42, 10, 8);
    const mat = new THREE.MeshLambertMaterial({ color: 0xff7a3d, emissive: 0x552200 });
    const flag = new THREE.MeshLambertMaterial({ color: 0xffd166 });
    for (const g of gates) for (const s of [1, -1]) {
      const m = new THREE.Mesh(geo, mat); m.position.set(g.x + g.nx * 4 * s, 0.35, g.z + g.nz * 4 * s);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 5), flag); post.position.y = 1.2; m.add(post);
      this.scene.add(m); this.gateMeshes.push(m);
    }
  }
  clearGates() { for (const m of this.gateMeshes || []) this.scene.remove(m); this.gateMeshes = []; }

  playerCaught(c) {
    const ch = this.challenge;
    if (!ch || ch.kind !== 'fishing') return;
    if (c.species === ch.species) { ch.youKg += c.kg; this.hud.hint(`${c.species.name} counts — ${ch.youKg.toFixed(1)} kg`, 2000); }
  }

  /** Progress of the player's hull toward the goal, 0..1. */
  playerProgress(c, me) {
    if (c.gates) {
      const next = c.gates[c.gate];
      if (!next) return 1;
      const d = Math.hypot(next.x - me.pos.x, next.z - me.pos.z);
      const prev = c.gate ? c.gates[c.gate - 1] : { x: c.start.x, z: c.start.z };
      const span = Math.hypot(next.x - prev.x, next.z - prev.z) || 1;
      return (c.gate + Math.max(0, 1 - d / span)) / c.gates.length;
    }
    if (c.kind === 'long') return Math.max(0, Math.min(1, alongRoute(c.route, me.pos.x, me.pos.z) / (c.L || 1)));
    const d = Math.hypot(c.goal.x - me.pos.x, c.goal.z - me.pos.z);
    return Math.max(0, Math.min(1, 1 - d / c.d0));
  }

  /** Every boat in the bet back to its own life. */
  releaseRacer(f) {
    f.state = 'idle'; f.timer = 0; f.route = null; f.throttle = 1; f.flatOut = false; f.endCast(); f.boat.anchored = false; f.matchSpecies = null;
    if (f.baseMax != null) { f.boat.spec.maxSpeed = f.baseMax; f.baseMax = null; }
  }

  finish(result, why = '') {
    const c = this.challenge; if (!c) return;
    const f = c.npc;
    this.challenge = null;
    this.lastFinish = { kind: c.kind, result, why, win: c.win };
    this.clearGates();
    this.hud.clearComp();
    for (const b of c.boats || [f]) this.releaseRacer(b);
    if (c.kind === 'fishing') { this.fishing.endMatch(); if (this.ambientFish) this.ambientFish.setFeature(null); }
    const who = c.kind === 'long' ? (c.leader || f).name : f.name;
    if (result === 'win') {
      this.player.balance += c.payout; this.rtp.book(c.payout); this.player.save();
      this.hud.toast(`<div class="catch-body"><div class="catch-name">You beat ${c.kind === 'long' ? 'the lot of them' : f.name}!</div><div class="catch-sub">${c.title} · $${c.stake} staked</div></div><div class="catch-value">$${c.payout.toFixed(2)}</div>`, 'win', 5200);
    } else if (result === 'lose') {
      this.hud.toast(`<div class="catch-body"><div class="catch-name">${who} takes it</div><div class="catch-sub">${c.title} · $${c.stake} gone</div></div>`, 'meh', 4600);
    } else {
      this.hud.toast(`<div class="catch-body"><div class="catch-name">Called off — you gave it up</div><div class="catch-sub">${c.title} · $${c.stake} forfeited</div></div>`, 'meh', 4600);
    }
  }

  /**
   * The pacing of one racing boat against the player's progress `p`: held
   * a margin behind on a won bet (and never let past 90 % until the player
   * is home), never slowed on a lost one — sent a margin ahead, and let
   * out past its top speed if it falls behind that. `ahead` is false for
   * the also-rans of the long haul, who trail whatever the result.
   */
  pace(f, c, p, ahead, margin) {
    const np = f.routeProgress();
    const creep = Math.min(0.9, c.t / c.limit * 1.1);
    if (f.baseMax == null) f.baseMax = f.boat.spec.maxSpeed;
    if (ahead) {
      const want = Math.max(p + margin, creep);
      f.throttle = 1; f.flatOut = true;
      // Let out past its top speed when behind, and harder the further behind.
      f.boat.spec.maxSpeed = np < want ? f.baseMax * (want - np > 0.12 ? 2.2 : 1.7) : f.baseMax;
      // Hung up on a bank or a rock for more than a moment, or grinding
      // along one and falling well behind for a while: it is put back on
      // its route at the next mark, under way. The result was drawn when
      // the bet was placed; a boat meant to win is not left aground.
      f.lagT = np < want - 0.08 ? (f.lagT || 0) + 1 / 60 : 0;
      if ((f.stuck > 2.5 || f.lagT > 6) && f.route && f.wp < f.route.length) {
        const n = f.route[f.wp], pr = f.route[f.wp - 1] || f.pos;
        f.boat.placeAt(n.x, n.z, Math.atan2(-(n.x - pr.x), -(n.z - pr.z)));
        f.wp++; f.stuck = 0; f.lagT = 0; f.helmCache = null;
      }
    } else {
      const want = Math.min(Math.max(p - margin, creep * 0.6), 0.9);
      f.throttle = Math.max(0.15, Math.min(1, 0.5 + (want - np) * 8)); f.flatOut = false;
      f.boat.spec.maxSpeed = f.baseMax;
    }
    // Off the route (stuck and backed out, or shoved): take it up again.
    if (!f.route || f.wp >= f.route.length) { if (np < 0.999) f.rejoin(c.route); }
    return np;
  }

  updateChallenge(dt, me) {
    const c = this.challenge; if (!c) return;
    const f = c.npc;
    c.t += dt;
    if (!c.start) c.start = { x: me.pos.x, z: me.pos.z };
    if (c.kind === 'fishing') {
      // The other boat's basket tracks the player's, a margin behind or ahead.
      const want = c.win ? Math.max(0, c.youKg * (1 - c.margin * 3) - 0.05) : c.youKg * (1 + c.margin * 3) + 0.4;
      // It fills in steps, as fish come aboard, never all at once.
      if (c.npcKg < want && c.t > 8 && (c.nextFish ?? 0) <= c.t) {
        const bite = Math.min(want - c.npcKg, 0.3 + this.rng() * 1.6);
        c.npcKg += bite; c.npcCatches++;
        c.nextFish = c.t + 6 + this.rng() * 14;
        this.hud.hint(`${f.name} landed a ${bite.toFixed(1)} kg ${c.species.name}`, 2200);
      }
      // At the wire the drawn result stands: the last fish lands on the bell.
      if (c.t >= c.limit) { c.npcKg = want; this.hud.setComp(c, c.youKg, c.npcKg); this.finish(c.win ? 'win' : 'lose', 'bell'); return; }
      this.hud.setComp(c, c.youKg, c.npcKg);
      return;
    }
    // A race, a run, or the long haul.
    const p = this.playerProgress(c, me);
    if (c.gates) {
      const g = c.gates[c.gate];
      if (g && Math.hypot(g.x - me.pos.x, g.z - me.pos.z) < 5.5) { c.gate++; this.hud.hint(c.gate < c.gates.length ? `Gate ${c.gate} of ${c.gates.length}` : 'Last gate — go!', 1500); }
    }
    const homeR = c.kind === 'long' ? 16 : 12;
    const arrived = c.gates ? c.gate >= c.gates.length && Math.hypot(c.goal.x - me.pos.x, c.goal.z - me.pos.z) < homeR : Math.hypot(c.goal.x - me.pos.x, c.goal.z - me.pos.z) < homeR;
    let np, npcArrived;
    if (c.kind === 'long') {
      // Three boats: on a lost bet the first of them runs ahead, the other two trail; on a won bet all three trail.
      let lead = 0;
      c.boats.forEach((b, i) => { const v = this.pace(b, c, p, !c.win && i === 0, c.margins[i]); if (v > lead) { lead = v; c.leader = b; } });
      np = lead;
      npcArrived = !c.win && (Math.hypot(c.goal.x - c.boats[0].pos.x, c.goal.z - c.boats[0].pos.z) < 14 || c.boats[0].routeProgress() >= 0.999);
      // The waters of the way, for the panel.
      const s = p * (c.L || 1);
      c.legAt = Math.max(0, c.legs.findIndex((l) => s >= l.s0 && s < l.s1));
      if (c.legAt < 0) c.legAt = c.legs.length - 1;
    } else {
      np = this.pace(f, c, p, !c.win, c.margin);
      npcArrived = Math.hypot(c.goal.x - f.pos.x, c.goal.z - f.pos.z) < 10 || np >= 0.999;
    }
    // The chip that points the way: the next gate, or the goal.
    if (c.gates && c.gate < c.gates.length) { const g = c.gates[c.gate]; this.hud.setGoalFinder(`Gate ${c.gate + 1} of ${c.gates.length}`, g.x, g.z, me.pos); }
    else this.hud.setGoalFinder(c.kind === 'long' ? `Finish · ${c.goal.name}` : c.goal.name, c.goal.x, c.goal.z, me.pos);
    this.hud.setComp(c, p, Math.min(np, 0.99));
    if (npcArrived && !c.win) { this.finish('lose', 'npcHome'); return; }
    if (arrived) { this.finish(c.win ? 'win' : 'lose', 'playerHome'); return; }
    if (c.t >= c.limit) { this.finish('forfeit', 'time'); return; }
  }

  /** Where the other boats are, for the minimap: one reused list of {x, z}. */
  mapDots() {
    const out = this._dots || (this._dots = []);
    out.length = 0;
    for (const f of this.boats) if (f.ready) out.push(f.pos);
    return out;
  }

  // --- the frame ---
  /**
   * `vessels` are the player's hulls (boat, and the tender when it is out);
   * `active` is false in the menu or a store, when nothing is offered.
   */
  update(dt, t, vessels, active) {
    this.time += dt;
    this.vessels = vessels;
    const me = vessels[0];
    if (!me) return;
    // Boats left far behind go; boats come as encounters on a clock,
    // sooner if the player has been alone for a while.
    let nearest = Infinity;
    for (let i = this.boats.length - 1; i >= 0; i--) {
      const f = this.boats[i];
      f.age += dt;
      const d = Math.hypot(f.pos.x - me.pos.x, f.pos.z - me.pos.z);
      nearest = Math.min(nearest, d);
      const inBet = this.challenge && (this.challenge.npc === f || (this.challenge.boats || []).includes(f));
      const waiting = f.group && !f.group.dead;
      if (!inBet && (d > DESPAWN || (!waiting && f.age > 150 && d > 380))) { if (f.group) this.disperseGroup(f.group); f.dispose(); this.usedNames.delete(f.name); this.boats.splice(i, 1); }
    }
    this.lonely = nearest < 400 ? 0 : this.lonely + dt;
    if (active) {
      this.nextEncounter -= dt;
      const singles = this.boats.filter((f) => !f.group).length;
      if (this.spawnJob) {
        // A boat being placed: its routes are planned a slice a frame.
        const t0 = performance.now();
        let step;
        do { step = this.spawnJob.next(); } while (!step.done && performance.now() - t0 < 1.2);
        if (step.done) {
          this.spawnJob = null;
          // No room on the water round here: try again shortly, not in two minutes.
          this.nextEncounter = step.value ? ENCOUNTER_MIN + this.rng() * (ENCOUNTER_MAX - ENCOUNTER_MIN) : 20;
          this.lonely = 0;
        }
      } else if (this.scout) {
        // The water is being scouted for a long haul: when it is known, the
        // three are sent if it runs far enough, an ordinary boat if not.
        if (this.advanceScout(1.2)) {
          const cands = this.scoutCands || [];
          const g = cands.length ? this.spawnGroup(cands) : null;
          if (g) { this.nextEncounter = ENCOUNTER_MIN + this.rng() * (ENCOUNTER_MAX - ENCOUNTER_MIN); this.lonely = 0; }
          else { this.noGroupUntil = this.time + 150; if (singles < MAX_SINGLES) this.spawnJob = this.spawnEncounterGen(); else this.nextEncounter = 20; }
        }
      } else if (this.nextEncounter <= 0 || this.lonely > LONELY_S) {
        const groupRoom = !this.group && this.boats.length + 3 <= MAX_ALIVE && this.time > (this.noGroupUntil || 0);
        if (groupRoom && this.rng() < GROUP_SHARE) { this.beginScout(); this.nextEncounter = 30; }
        else if (singles < MAX_SINGLES) { this.spawnJob = this.spawnEncounterGen(); this.nextEncounter = 30; }
        else { this.nextEncounter = 20; this.lonely = 0; }
      }
      this.advanceOffer(1.2);
    }
    // The circling three: their finish is found while they wait, and they
    // give up if the player never comes.
    const g = this.group;
    if (g) {
      g.wait += dt; g.phase += dt * 0.28;
      if (!g.ready) this.planGroup(g, 1.2);
      else if (active) this.maybeOfferGroup(g, me);
      if (g.wait > GROUP_WAIT && !(this.offer && this.offer.group === g)) this.disperseGroup(g);
    }

    if (this.offer && (this.time - (this.offer.at ?? (this.offer.at = this.time)) > 14 || !active)) this.decline();
    if (this.challenge && active) this.updateChallenge(dt, me);

    for (const f of this.boats) {
      if (!f.ready) continue;
      const b = f.boat;
      // Level of detail by distance: a far boat is stepped a few times a
      // second, without its wake and smoke, and throws no shadow.
      const d = Math.hypot(f.pos.x - me.pos.x, f.pos.z - me.pos.z);
      const inBet = this.challenge && (this.challenge.npc === f || (this.challenge.boats || []).includes(f));
      const lod = inBet ? 0 : d < LOD_NEAR ? 0 : d < LOD_FAR ? 1 : 2;
      if (lod !== f.lod) {
        f.lod = lod;
        b.lite = lod > 0;
        b.wake.setVisible(lod === 0);
        b.smoke.points && (b.smoke.points.visible = lod === 0);
        const shadow = lod === 0;
        if (shadow !== f.shadowed) { f.shadowed = shadow; b.group.traverse((o) => { if (o.isMesh) o.castShadow = shadow; }); }
        f.label.visible = lod < 2;
      }
      f.acc += dt;
      const period = lod === 0 ? 0 : lod === 1 ? 0.05 : 0.12;
      if (f.acc < period) continue;
      const bdt = Math.min(f.acc, 0.2); f.acc = 0;
      let input = { x: 0, z: 0 };
      if (f.state === 'cruise') {
        if (!f.route || f.wp >= f.route.length) {
          // Arrived (or nowhere to go yet): fish a while, or call at a marina.
          if (f.route) { f.state = 'idle'; f.timer = 0; }
          else { const w = f.pickWaypoint(this.rng); if (w && f.goTo(w.x, w.z)) f.throttle = 0.55 + this.rng() * 0.45; }
        }
        input = f.helm(bdt);
      } else if (f.state === 'idle') {
        f.timer += bdt;
        if (f.timer > 1.5) {
          const near = this.docks.nearest(f.pos.x, f.pos.z);
          if (near.dock && near.dist < 260 && this.rng() < 0.3 && f.goTo(near.dock.headX + Math.sin(near.dock.angle) * 9, near.dock.headZ + Math.cos(near.dock.angle) * 9)) { f.state = 'toMarina'; f.throttle = 0.6; }
          else if (this.rng() < 0.5) f.startFishing(this.rng);
          else { const w = f.pickWaypoint(this.rng); if (w && f.goTo(w.x, w.z)) { f.state = 'cruise'; f.throttle = 0.5 + this.rng() * 0.5; } }
        }
      } else if (f.state === 'fish' || f.state === 'match') {
        f.updateFishing(bdt, t, this.rng);
        if (f.state === 'idle') b.anchored = false;
      } else if (f.state === 'toMarina') {
        input = f.helm(bdt);
        if (!f.route || f.wp >= f.route.length) { f.state = 'atMarina'; f.timer = 12 + this.rng() * 18; b.anchored = true; }
      } else if (f.state === 'atMarina') {
        f.timer -= bdt;
        if (f.timer <= 0) { b.anchored = false; f.state = 'idle'; f.timer = 0; }
      } else if (f.state === 'race') {
        input = f.helm(bdt);
      } else if (f.state === 'circle') {
        // Round and round the meeting spot, each a third of the way apart.
        const gr = f.group;
        if (gr) {
          const a = f.phase + gr.phase;
          const tx = gr.center.x + Math.cos(a) * gr.r, tz = gr.center.z + Math.sin(a) * gr.r;
          let dx = tx - b.pos.x, dz = tz - b.pos.z; const dd = Math.hypot(dx, dz) || 1;
          f.throttle = Math.min(0.45, 0.12 + dd * 0.04);
          input = f.steerTo(dx / dd, dz / dd, bdt);
        } else { f.state = 'idle'; }
      }
      b.update(bdt, input, t);
      // Solid against the player's hulls, and against each other.
      for (const v of vessels) separateHulls(v, b, 0.5);
      for (const o of this.boats) if (o !== f && o.ready && Math.abs(o.pos.x - b.pos.x) < 40 && Math.abs(o.pos.z - b.pos.z) < 40) separateHulls(b, o.boat, 0.5);
      // The name, over the wheelhouse.
      f.label.position.set(b.pos.x, (b.hullBounds?.maxY ?? 2) + 1.6, b.pos.z);
      if (active) this.maybeOffer(f);
    }
  }
}
