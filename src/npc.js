// Other fishermen on the water.
//
// A handful of NPC boats live round the player: real hulls from the fleet,
// in their paint, driven by the same physics as the player's boat (the
// same wake, the same heel and trim, the same rods and casts, the same
// smoke), so they read as other players. They cruise between spots, stop
// to fish — cast, wait, hook something, fight it in — and call in at the
// marinas. They are solid: a hull runs into them like it runs into the
// tender, and they steer clear of the player as the tender does.
//
// Passing one, it may call across and offer a side bet: a race to a named
// water, a run through the rocks, or a fishing match. Every one of these
// is an ISOLATED bet against the game RTP (rtp.js sideBet): its outcome is
// drawn the moment the player accepts, and what happens on the water after
// that is staged to match — the other boat is held back or sent ahead of
// the player's own progress. Nothing the player does can change what was
// drawn; giving up only forfeits.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Boat } from './boat.js';
import { fleetCatalog } from './boats.js';
import { isNavigable, waterDepth, waterKind, isStill } from './lake.js';
import { separateHulls, steerClear, wrapAngle } from './hullphysics.js';
import { HookedFish } from './hookedfish.js';
import { speciesInTiers, poolFor } from './fishdata.js';
import { cellRegion, CELL } from './regions.js';
import { mulberry32 } from './noise.js';

const NAMES = [
  'Big Earl', 'Marge', 'Two-Hook Tony', 'Deadeye Dana', 'Salty Pete', 'Grandma Lou', 'Skeeter',
  'Doc Halibut', 'Bobby Bass', 'Muskie Mike', 'Catfish Kate', 'Reel Ricky', 'Wanda', 'Old Gus',
  'Trout Tammy', 'Pickerel Pam', 'Sunfish Sam', 'Lefty', 'The Colonel', 'Barb', 'Hank the Tank',
  'Minnow Min', 'Captain Deb', 'Walleye Walt', 'Sturgeon Sue', 'Cousin Ray', 'Nettie', 'Slim',
];
const FLEET_N = 5;               // boats about the player at a time
const SPAWN_MIN = 140, SPAWN_MAX = 380, DESPAWN = 720;
const OFFER_RANGE = 26;          // metres: passing this close, a boat may call across
const OFFER_COOLDOWN = 75;       // seconds before the same boat offers again
const GLOBAL_COOLDOWN = 40;      // ... or any boat does

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
 * A route over the water from A to B: A* over a 5 m grid of navigable
 * cells inside a box round the two, then pulled straight where the water
 * allows. Returns [{x, z}, …] from A to B, or null if there is no way.
 */
export function planRoute(ax, az, bx, bz, pad = 70, cell = 5) {
  const minX = Math.min(ax, bx) - pad, maxX = Math.max(ax, bx) + pad;
  const minZ = Math.min(az, bz) - pad, maxZ = Math.max(az, bz) + pad;
  const W = Math.ceil((maxX - minX) / cell), H = Math.ceil((maxZ - minZ) / cell);
  if (W * H > 40000) return null;
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
  g[sk] = 0; push(h(si, sj), sk);
  let found = false, guard = 0;
  while (open.length && guard++ < 60000) {
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
  if (!found) return null;
  const pts = [];
  for (let k = gk; k !== -1; k = from[k]) { const i = k % W, j = (k - i) / W; pts.push({ x: minX + (i + 0.5) * cell, z: minZ + (j + 0.5) * cell }); }
  pts.reverse();
  pts[0] = { x: ax, z: az }; pts[pts.length - 1] = { x: bx, z: bz };
  // String-pull: skip every point a straight, clear line can pass.
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clearLine(pts[i].x, pts[i].z, pts[j].x, pts[j].z, 2.5, 1.0)) j--;
    out.push(pts[j]); i = j;
  }
  return out;
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
    this.label = nameSprite(name);
    this.label.visible = false;
    fleet.scene.add(this.label);
    // Fishing gear: a line and a float, and the fish when one is on.
    this.line = null; this.bobber = null; this.fish = null; this.lineOut = 0;
    this.cast = null;
    this.boat.setBoat(key).then(() => { this.ready = true; this.label.visible = true; });
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
    if (d < (this.wp === this.route.length - 1 ? 4 : 7)) { this.wp++; return this.helm(dt); }
    dx /= d; dz /= d;
    // Feelers: if the way ahead is foul, swing the wanted heading off it.
    const look = 8 + b.speed * 1.5;
    let best = null, bestScore = -Infinity;
    for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1]) {
      const ca = Math.cos(off), sa = Math.sin(off);
      const ux = dx * ca - dz * sa, uz = dx * sa + dz * ca;
      let clear = 1;
      for (const dd of [look * 0.4, look * 0.75, look]) if (!isNavigable(b.pos.x + ux * dd, b.pos.z + uz * dd) || waterDepth(b.pos.x + ux * dd, b.pos.z + uz * dd) < 0.9) { clear = dd / look - 0.34; break; }
      const score = clear - Math.abs(off) * 0.25;
      if (score > bestScore) { bestScore = score; best = { x: ux, z: uz, clear }; }
    }
    // Slow down for a turn or a tight spot; crawl when boxed in.
    let thr = this.throttle * (bestScore > 0.6 ? 1 : 0.5);
    if (bestScore < 0.1) thr = 0.25;
    // A hull that has not moved in a while backs off and tries again.
    if (b.speed < 0.3 && thr > 0.2) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (this.stuck > 3) { thr = -0.5; if (this.stuck > 5) { this.stuck = 0; this.route = null; } }
    let want = { x: best.x * thr, z: best.z * thr };
    for (const v of this.fleet.vessels) want = steerClear(b, v, want, 5);
    return want;
  }

  // --- fishing, as a show ---
  startFishing(rng = Math.random) {
    const b = this.boat;
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
        const species = sp[Math.floor(rng() * sp.length)];
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
  constructor(scene, lake, player, rtp, hud, fishing, docks) {
    this.scene = scene; this.lake = lake; this.player = player; this.rtp = rtp; this.hud = hud; this.fishing = fishing; this.docks = docks;
    this.boats = [];
    this.vessels = [];             // the player's hulls, for steering clear and collisions
    this.rng = mulberry32((Date.now() & 0xffffff) >>> 0);
    this.spawnAcc = 0;
    this.usedNames = new Set();
    this._tip = new THREE.Vector3();
    this.challenge = null;         // the live side bet
    this.offer = null;             // one on the table
    this.lastOfferAt = -1e9;
    this.time = 0;
    this.onNpcHook = null;
    this.enabled = true;
    fishing.onCatch = (c) => this.playerCaught(c);
  }

  // --- spawning ---
  spawnOne(px, pz) {
    const rng = this.rng;
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2, d = SPAWN_MIN + rng() * (SPAWN_MAX - SPAWN_MIN);
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      if (waterDepth(x, z) < 2.5 || !isNavigable(x, z) || !isStill(x, z)) continue;
      let ok = true;
      for (let k = 0; k < 8 && ok; k++) { const ang = k / 8 * Math.PI * 2; if (!isNavigable(x + Math.cos(ang) * 9, z + Math.sin(ang) * 9)) ok = false; }
      if (!ok) continue;
      // Cheap hulls mostly, the odd big one.
      const cat = fleetCatalog();
      const hi = Math.min(cat.length - 1, Math.floor(Math.pow(rng(), 2.2) * cat.length));
      const skins = cat[hi].skins;
      const key = skins[Math.floor(rng() * skins.length)].key;
      let name = NAMES[Math.floor(rng() * NAMES.length)];
      for (let n = 0; this.usedNames.has(name) && n < 30; n++) name = NAMES[Math.floor(rng() * NAMES.length)];
      this.usedNames.add(name);
      const f = new Fisherman(this, name, key, x, z, rng() * Math.PI * 2);
      this.boats.push(f);
      return f;
    }
    return null;
  }

  // --- the side bets ---
  /** The player passes a boat: it may call across. */
  maybeOffer(f) {
    if (this.challenge || this.offer || !this.enabled) return;
    if (this.time - this.lastOfferAt < GLOBAL_COOLDOWN || this.time - f.lastOffer < OFFER_COOLDOWN) return;
    if (!f.ready || f.state === 'race') return;
    const me = this.vessels[0]; if (!me) return;
    const d = Math.hypot(f.pos.x - me.pos.x, f.pos.z - me.pos.z);
    if (d > OFFER_RANGE) return;
    const kinds = ['race', 'agility', 'fishing'];
    const kind = kinds[Math.floor(this.rng() * kinds.length)];
    const offer = this.buildOffer(f, kind, me) || this.buildOffer(f, 'fishing', me);
    if (!offer) { f.lastOffer = this.time; return; }
    f.lastOffer = this.time; this.lastOfferAt = this.time;
    this.offer = offer;
    this.hud.showChallenge(offer, () => this.accept(), () => this.decline());
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

  buildOffer(f, kind, me) {
    const stake = this.stakeFor();
    if (stake <= 0) return null;
    const rng = this.rng;
    if (kind === 'fishing') {
      const pool = poolFor(waterKind(me.pos.x, me.pos.z));
      const sp = speciesInTiers(1, 3, pool);
      const species = sp[Math.floor(rng() * sp.length)];
      return { npc: f, kind, stake, species, seconds: 90, title: 'Fishing match',
        text: `Most ${species.name} by weight on the rod in 90 seconds. Loser buys.` };
    }
    // A race or a run: a named water two to five hundred metres off, with a
    // route to it round the land. A run wants rock in the way.
    const cx = Math.floor(me.pos.x / CELL), cz = Math.floor(me.pos.z / CELL);
    const cands = [];
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const r = cellRegion(cx + dx, cz + dz);
      if (r.type === 'ocean') continue;
      const w = waterNear(r.x, r.z);
      if (!w) continue;
      const d = Math.hypot(w.x - me.pos.x, w.z - me.pos.z);
      if (d < 150 || d > 520) continue;
      const rocky = r.type === 'rapids' || r.type === 'cove' || r.type === 'river' || r.type === 'beaver' || r.type === 'falls';
      if (kind === 'agility' && !rocky) continue;
      cands.push({ r, d, w });
    }
    let tries = 0;
    while (cands.length && tries++ < 4) {
      const i = Math.floor(rng() * cands.length);
      const { r, d, w } = cands.splice(i, 1)[0];
      const route = planRoute(me.pos.x, me.pos.z, w.x, w.z, 90);
      if (!route) continue;
      const L = routeLength(route);
      if (L > d * 2.8) continue;
      if (kind === 'race') return { npc: f, kind, stake, goal: { x: w.x, z: w.z, name: r.name }, route, title: 'Race', text: `First boat to ${r.name} takes it.` };
      // Gates along the route, through the tight water.
      const gates = [];
      for (let k = 1; k <= 4; k++) {
        const s = L * k / 4, p = pointAlong(route, s), q = pointAlong(route, Math.max(0, s - 3));
        let tx = p.x - q.x, tz = p.z - q.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        gates.push({ x: p.x, z: p.z, nx: -tz, nz: tx });
      }
      return { npc: f, kind, stake, goal: { x: w.x, z: w.z, name: r.name }, route, gates, title: 'Run the rocks', text: `Through the gates to ${r.name}, in order — first one home.` };
    }
    return null;
  }

  accept() {
    const o = this.offer; if (!o) return;
    this.offer = null;
    this.hud.hideChallenge();
    if (this.player.balance < o.stake) { this.hud.hint('Not enough in the wallet'); return; }
    // The bet, placed and resolved now. What follows is staged to match.
    this.player.balance -= o.stake;
    this.rtp.wager(o.stake);
    const r = this.rtp.sideBet(o.stake);
    const c = this.challenge = { ...o, win: r.win, payout: r.payout, t: 0, limit: o.kind === 'fishing' ? o.seconds : 240, margin: 0.08 + this.rng() * 0.08, youKg: 0, npcKg: 0, gate: 0, npcGate: 0 };
    const f = o.npc;
    f.endCast(); f.state = 'race'; f.timer = 0; f.boat.anchored = false;
    if (o.kind === 'fishing') { f.state = 'match'; f.startFishing(this.rng); f.state = 'match'; f.timer = 1e9; c.npcCatches = 0; }
    else { f.route = o.route.map((p) => ({ ...p })); f.wp = 1; f.target = o.goal; f.throttle = 0.3; }
    c.d0 = Math.hypot(o.goal ? o.goal.x - this.vessels[0].pos.x : 0, o.goal ? o.goal.z - this.vessels[0].pos.z : 0) || 1;
    this.hud.setComp(c, 0, 0);
    if (c.gates) this.showGates(c.gates);
    this.hud.toast(`<div class="catch-body"><div class="catch-name">${f.name}: "You're on!"</div><div class="catch-sub">$${o.stake} down · ${o.title}</div></div>`, 'meh', 3000);
  }

  decline() {
    const o = this.offer; if (!o) return;
    this.offer = null;
    this.hud.hideChallenge();
    this.hud.hint(`${o.npc.name}: "Suit yourself."`, 2200);
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
    const d = Math.hypot(c.goal.x - me.pos.x, c.goal.z - me.pos.z);
    return Math.max(0, Math.min(1, 1 - d / c.d0));
  }

  finish(result) {
    const c = this.challenge; if (!c) return;
    const f = c.npc;
    this.challenge = null;
    this.clearGates();
    this.hud.clearComp();
    f.state = 'idle'; f.timer = 0; f.route = null; f.throttle = 1; f.endCast(); f.boat.anchored = false;
    f.boat.spec.maxSpeed = f.baseMax ?? f.boat.spec.maxSpeed;
    if (result === 'win') {
      this.player.balance += c.payout; this.rtp.book(c.payout); this.player.save();
      this.hud.toast(`<div class="catch-body"><div class="catch-name">You beat ${f.name}!</div><div class="catch-sub">${c.title} · $${c.stake} staked</div></div><div class="catch-value">$${c.payout.toFixed(2)}</div>`, 'win', 5200);
    } else if (result === 'lose') {
      this.hud.toast(`<div class="catch-body"><div class="catch-name">${f.name} takes it</div><div class="catch-sub">${c.title} · $${c.stake} gone</div></div>`, 'meh', 4600);
    } else {
      this.hud.toast(`<div class="catch-body"><div class="catch-name">Called off — you gave it up</div><div class="catch-sub">${c.title} · $${c.stake} forfeited</div></div>`, 'meh', 4600);
    }
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
      if (c.t >= c.limit) { c.npcKg = want; this.hud.setComp(c, c.youKg, c.npcKg); this.finish(c.win ? 'win' : 'lose'); return; }
      this.hud.setComp(c, c.youKg, c.npcKg);
      return;
    }
    // A race or a run.
    const p = this.playerProgress(c, me);
    if (c.gates) {
      const g = c.gates[c.gate];
      if (g && Math.hypot(g.x - me.pos.x, g.z - me.pos.z) < 5.5) { c.gate++; this.hud.hint(c.gate < c.gates.length ? `Gate ${c.gate} of ${c.gates.length}` : 'Last gate — go!', 1500); }
    }
    const arrived = c.gates ? c.gate >= c.gates.length && Math.hypot(c.goal.x - me.pos.x, c.goal.z - me.pos.z) < 12 : Math.hypot(c.goal.x - me.pos.x, c.goal.z - me.pos.z) < 12;
    // Where the other boat should be: behind the player by the margin when
    // the bet is won, ahead of it when lost; and always creeping on, so a
    // player who stops is not waited for forever.
    const np = f.routeProgress();
    const creep = Math.min(0.9, c.t / c.limit * 1.1);
    let want = c.win ? Math.min(Math.max(p - c.margin, creep * 0.6), 0.9) : Math.max(p + c.margin, creep);
    f.throttle = Math.max(0.15, Math.min(1, 0.5 + (want - np) * 8));
    if (f.baseMax == null) f.baseMax = f.boat.spec.maxSpeed;
    // Losing bets: the other hull may be slower than the player's; let it out.
    f.boat.spec.maxSpeed = !c.win && want - np > 0.03 ? f.baseMax * 1.7 : f.baseMax;
    if (!f.route || f.wp >= f.route.length) { if (np < 1) f.goTo(c.goal.x, c.goal.z); }
    const npcArrived = Math.hypot(c.goal.x - f.pos.x, c.goal.z - f.pos.z) < 10 || np >= 0.999;
    this.hud.setComp(c, p, Math.min(np, 0.99));
    if (npcArrived && !c.win) { this.finish('lose'); return; }
    if (arrived) { this.finish(c.win ? 'win' : 'lose'); return; }
    if (c.t >= c.limit) { this.finish('forfeit'); return; }
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
    // Keep the fleet up round the player, dropping any that have fallen far behind.
    this.spawnAcc += dt;
    for (let i = this.boats.length - 1; i >= 0; i--) {
      const f = this.boats[i];
      if (Math.hypot(f.pos.x - me.pos.x, f.pos.z - me.pos.z) > DESPAWN && (!this.challenge || this.challenge.npc !== f)) { f.dispose(); this.usedNames.delete(f.name); this.boats.splice(i, 1); }
    }
    if (this.boats.length < FLEET_N && this.spawnAcc > 1.5) { this.spawnAcc = 0; this.spawnOne(me.pos.x, me.pos.z); }

    if (this.offer && (this.time - (this.offer.at ?? (this.offer.at = this.time)) > 14 || !active)) this.decline();
    if (this.challenge && active) this.updateChallenge(dt, me);

    for (const f of this.boats) {
      if (!f.ready) continue;
      const b = f.boat;
      let input = { x: 0, z: 0 };
      if (f.state === 'cruise') {
        if (!f.route || f.wp >= f.route.length) {
          // Arrived (or nowhere to go yet): fish a while, or call at a marina.
          if (f.route) { f.state = 'idle'; f.timer = 0; }
          else { const w = f.pickWaypoint(this.rng); if (w && f.goTo(w.x, w.z)) f.throttle = 0.55 + this.rng() * 0.45; }
        }
        input = f.helm(dt);
      } else if (f.state === 'idle') {
        f.timer += dt;
        if (f.timer > 1.5) {
          const near = this.docks.nearest(f.pos.x, f.pos.z);
          if (near.dock && near.dist < 260 && this.rng() < 0.3 && f.goTo(near.dock.headX + Math.sin(near.dock.angle) * 9, near.dock.headZ + Math.cos(near.dock.angle) * 9)) { f.state = 'toMarina'; f.throttle = 0.6; }
          else if (this.rng() < 0.5) f.startFishing(this.rng);
          else { const w = f.pickWaypoint(this.rng); if (w && f.goTo(w.x, w.z)) { f.state = 'cruise'; f.throttle = 0.5 + this.rng() * 0.5; } }
        }
      } else if (f.state === 'fish' || f.state === 'match') {
        f.updateFishing(dt, t, this.rng);
        if (f.state === 'idle') b.anchored = false;
      } else if (f.state === 'toMarina') {
        input = f.helm(dt);
        if (!f.route || f.wp >= f.route.length) { f.state = 'atMarina'; f.timer = 12 + this.rng() * 18; b.anchored = true; }
      } else if (f.state === 'atMarina') {
        f.timer -= dt;
        if (f.timer <= 0) { b.anchored = false; f.state = 'idle'; f.timer = 0; }
      } else if (f.state === 'race') {
        input = f.helm(dt);
      }
      b.update(dt, input, t);
      // Solid against the player's hulls, and against each other.
      for (const v of vessels) separateHulls(v, b, 0.5);
      for (const o of this.boats) if (o !== f && o.ready && Math.abs(o.pos.x - b.pos.x) < 40 && Math.abs(o.pos.z - b.pos.z) < 40) separateHulls(b, o.boat, 0.5);
      // The name, over the wheelhouse.
      f.label.position.set(b.pos.x, (b.hullBounds?.maxY ?? 2) + 1.6, b.pos.z);
      if (active) this.maybeOffer(f);
    }
  }
}

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
