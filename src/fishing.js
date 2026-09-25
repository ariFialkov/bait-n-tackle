// Fishing mechanics: casting (one line per rod), trawling, and pots.
//
// Betting model (see rtp.js): every resolved bet draws an isolated payout
// multiplier with E = RTP.
//   * Casting — the bet is PLACED the moment the hook sets, and a hooked fish
//     can never be lost. An empty cast is still free, and hotspots (which only
//     change how OFTEN a fish shows up) can never change what a bet pays.
//     Resolving at the hook is what lets the fish be shown while you reel it
//     in: if it could still be lost, seeing a small one would be an invitation
//     to drop it for free and keep only the winners, which would hand a
//     skilled player an edge the paytable does not allow.
//   * Trawling — each stretch of paid distance between catch events is its
//     own microbet, resolved against that stretch's cost alone. Location
//     never affects a trawl result.
//   * Pots — the stake is paid when the pot is dropped and the bet resolves
//     when it is collected, against that stake alone.
// Landed value is paid straight into the balance (player.js) the moment the
// fish comes over the rail, so realised RTP is exactly the paytable's.

import * as THREE from 'three';
import { CONFIG, LURES, NETS, POTS } from './config.js';
import { waterDepth } from './lake.js';
import { clamp, lerp } from './noise.js';
import { HookedFish } from './hookedfish.js';
import { poolFor } from './fishdata.js';
import { HAUL_TOAST_MS, TOAST_FADE_MS } from './hud.js';

const SNAP_S = 1.0;            // a parted line whipping back and settling
const POT_WAIT_S = 2.5;        // how long a pot waits on deck for a hand to take it
const POT_WHIP_S = 0.48;       // into the heave, when it leaves the hands
const POT_DROP_S = 0.7;        // a pot's arc from the rail to the water
const POT_SINK_S = 1.2;        // ... and the cage going down out of sight
const POT_HAUL_S = 1.0;        // the cage coming up to the surface
const POT_LIFT_S = 0.8;        // ... and swung up over the rail
const POT_RING = new THREE.RingGeometry(0.35, 0.52, 20);
POT_RING.rotateX(-Math.PI / 2);
const smooth = (k) => k * k * (3 - 2 * k);

const BOBBER_GEO = {
  top: new THREE.SphereGeometry(0.16, 12, 9),
  stem: new THREE.CylinderGeometry(0.02, 0.02, 0.18, 5),
};
const BOBBER_MAT = {
  red: new THREE.MeshStandardMaterial({ color: 0xe33d2e, roughness: 0.3 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf7f3e8, roughness: 0.3 }),
};

/** One rod's line: its own little cast/bite/reel state machine. */
class Line {
  constructor(scene) {
    this.scene = scene;
    this.state = 'idle';            // idle | pending | flying | out | landing
    this.rodIndex = 0;
    this.fish = null;               // the visible fish, once one is hooked
    this.reset();

    const g = new THREE.Group();
    const top = new THREE.Mesh(BOBBER_GEO.top, BOBBER_MAT.red);
    top.position.y = 0.08;
    const bottom = new THREE.Mesh(BOBBER_GEO.top, BOBBER_MAT.white);
    bottom.position.y = -0.06;
    const stem = new THREE.Mesh(BOBBER_GEO.stem, BOBBER_MAT.white);
    stem.position.y = 0.26;
    g.add(top, bottom, stem);
    g.visible = false;
    scene.add(g);
    this.bobber = g;

    const geo = new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xf5f5f5, transparent: true, opacity: 0.65 }));
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    this.line = line;

    this.pos = new THREE.Vector3();
    this.start = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.rodTip = new THREE.Vector3();
    this.snapFrom = new THREE.Vector3();   // where the float was when the line parted
    this.snapT = 0;
  }

  reset() {
    this.timer = 0;
    this.biteTimer = 0;
    this.biting = false;
    this.nibbling = 0;
    this.nibbles = 0;
    this.hooked = false;
    this.pendingPull = 0;
    this.reelVel = 0;
    this.willCatch = false;
    this.wager = 0;
    this.lureIndex = 0;
    this.distTotal = 0;
    this.hotness = 0;
    this.driftAngle = 0;
    this.catch = null;              // resolved at the hook, never re-rolled
    this.catchWager = 0;
    this.landT = 0;
    this.castPending = null;        // { yaw, t }: a swing the rod still owes
  }

  get busy() { return this.state !== 'idle'; }

  show(on) {
    this.bobber.visible = on;
    this.line.visible = on;
  }

  end() {
    this.state = 'idle';
    if (this.fish) { this.fish.dispose(); this.fish = null; }
    this.reset();
    this.show(false);
  }

  /** Straight-line distance from this line's bobber back to its rod tip. */
  lineOut() {
    return Math.hypot(this.rodTip.x - this.pos.x, this.rodTip.z - this.pos.z);
  }

  drawLine() {
    const p = this.line.geometry.attributes.position;
    p.setXYZ(0, this.rodTip.x, this.rodTip.y, this.rodTip.z);
    p.setXYZ(1, this.bobber.position.x, this.bobber.position.y + 0.1, this.bobber.position.z);
    p.needsUpdate = true;
  }

  dispose() {
    if (this.fish) { this.fish.dispose(); this.fish = null; }
    this.scene.remove(this.bobber, this.line);
    this.line.geometry.dispose();
  }
}

export class Fishing {
  constructor(scene, boat, lake, rtp, hud, player) {
    this.scene = scene;
    this.boat = boat;
    this.lake = lake;
    this.rtp = rtp;
    this.hud = hud;
    this.player = player;

    this.lureIndex = 0;
    this.netIndex = 0;
    this.lines = [];

    // Trawl state
    this.trawlDistAcc = 0;
    this.trawlCostAcc = 0;
    this.trawlNextCatch = this.rollTrawlInterval();
    this.trawlCostRemainder = 0;
    this.lastPos = new THREE.Vector2(boat.pos.x, boat.pos.z);

    this.crew = false;
    this.crewCastTimer = 0;
    this.crewReelTimer = 0;

    this.autoReel = !!player.autoReel;
    this.autoTimer = 0;

    this.potIndex = 0;
    this.pots = [];
    this.hauls = [];               // pots on their way up and over the rail
    this.potGroup = new THREE.Group();
    scene.add(this.potGroup);

    this._v = new THREE.Vector3();
    this._aims = [];
    this.work = null;
    this.syncRods();
  }

  // ---------- gear ----------
  get lure() { return LURES[this.lureIndex]; }
  get trawlNet() { return NETS[this.netIndex]; }
  get potGear() { return POTS[this.potIndex]; }
  get spec() { return this.boat.spec; }

  /**
   * Which species pool a catch here is shown from: the river's, the sea's,
   * or both where the water is brackish. Only ever the picture of a payout
   * already drawn — the water changes the fish, never the money.
   */
  poolAt(x, z) { return poolFor(this.lake.waterKind(x, z)); }

  setLure(i) {
    this.lureIndex = clamp(i, 0, LURES.length - 1);
    this.hud.hint(`${this.lure.name} — $${this.lure.cost} per catch`);
    return true;
  }

  setNet(i) {
    if (this.boat.trawling) {
      this.hud.hint('Stow the net before switching');
      return false;
    }
    this.netIndex = clamp(i, 0, NETS.length - 1);
    this.hud.hint(`${this.trawlNet.name} — $${this.trawlNet.costPerM.toFixed(2)}/m`);
    return true;
  }

  /** Pick the pot for the next drop; pots already out keep the bet they went in with. */
  setPot(i) {
    this.potIndex = clamp(i, 0, POTS.length - 1);
    const g = this.potGear;
    this.hud.hint(`${g.name} — $${g.stake.toFixed(2)} a pot, baited with ${g.bait}`);
    return true;
  }

  /** Point the rod pool at a different vessel (mother ship or tender). */
  setVessel(vessel) {
    if (this.boat === vessel) return;
    this.endAll();
    if (this.boat.trawling) this.stopTrawl();
    this.boat = vessel;
    this.crew = false;
    this.syncRods();
  }

  /** Rebuild the line pool to match the current boat's rod count. */
  syncRods() {
    const want = this.spec.rods;
    while (this.lines.length > want) this.lines.pop().dispose() ;
    while (this.lines.length < want) this.lines.push(new Line(this.scene));
    for (const l of this.lines) if (l.busy) l.end();
    this.hud.setRodCount?.(want);
  }

  get activeLines() { return this.lines.filter((l) => l.busy).length; }

  rollTrawlInterval() {
    return CONFIG.TRAWL_CATCH_MIN_M +
      Math.random() * (CONFIG.TRAWL_CATCH_MAX_M - CONFIG.TRAWL_CATCH_MIN_M);
  }

  // ---------- swipes ----------
  /**
   * One gesture drives everything, by urgency:
   *   1. a line is biting      -> set the hook on it
   *   2. a line is hooked      -> keep cranking the one nearest the boat
   *   3. a rod is free         -> cast a new line where you swiped
   *   4. otherwise             -> reel whichever line you swiped toward
   */
  onSwipe(s) {
    const biting = this.lines.find((l) => l.biting);
    if (biting) return this.pull(biting, s.power);

    // A line already being swung aboard is past taking orders.
    const hooked = this.lines.filter((l) => l.hooked && l.state === 'out');
    if (hooked.length) {
      hooked.sort((a, b) => a.lineOut() - b.lineOut());
      return this.pull(hooked[0], s.power);
    }

    const free = this.lines.find((l) => !l.busy);
    if (free) return this.cast(s);

    // All rods out and nothing doing: reel the line best matching the swipe.
    const out = this.lines.filter((l) => l.state === 'out');
    if (!out.length) return;
    let best = out[0], bestDot = -Infinity;
    for (const l of out) {
      const dx = l.pos.x - this.boat.pos.x, dz = l.pos.z - this.boat.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      const dot = (dx / len) * s.x + (dz / len) * s.z;
      if (dot > bestDot) { bestDot = dot; best = l; }
    }
    this.pull(best, s.power);
  }

  /** Pick the free rod whose tip is closest to where the cast will land. */
  pickRod(target) {
    let best = -1, bestD = Infinity;
    const busy = new Set(this.lines.filter((l) => l.busy).map((l) => l.rodIndex));
    for (let i = 0; i < this.boat.rods.length; i++) {
      if (busy.has(i)) continue;
      this.boat.rodTipWorld(i, this._v);
      const d = Math.hypot(this._v.x - target.x, this._v.z - target.z);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  cast(s, quiet = false) {
    const say = (msg) => { if (!quiet) this.hud.hint(msg); };
    if (this.boat.trawling) { say('Stow the net to cast'); return false; }
    const line = this.lines.find((l) => !l.busy);
    if (!line) { say('Every rod is already out'); return false; }
    if (this.player.balance < this.lure.cost) {
      say(`Need $${this.lure.cost} to land a fish on the ${this.lure.name}`);
      return false;
    }

    const dirLen = Math.hypot(s.x, s.z) || 1;
    const dir = new THREE.Vector3(s.x / dirLen, 0, s.z / dirLen);
    const dist = CONFIG.CAST_MIN_DIST + s.power * (CONFIG.CAST_MAX_DIST - CONFIG.CAST_MIN_DIST);
    const target = new THREE.Vector3().copy(this.boat.pos).addScaledVector(dir, dist);
    target.y = CONFIG.WATER_LEVEL;
    if (waterDepth(target.x, target.z) < 0.3) {
      say('That would land on shore!');
      return false;
    }

    const rodIndex = this.pickRod(target);
    if (rodIndex < 0) return false;

    // No money moves yet — the bet is placed only if a fish is landed.
    line.reset();
    line.rodIndex = rodIndex;
    line.wager = this.lure.cost;
    line.lureIndex = this.lureIndex;
    line.distTotal = dist;
    line.target.copy(target);
    this.boat.rodTipWorld(rodIndex, line.start);
    line.pos.copy(line.start);
    // The line does not leave yet. The rod is claimed, and the cast waits
    // for whoever is going to make it to reach the rod and swing it (see
    // deckcrew.js) — the lure flies off the whip of that swing. If nobody
    // comes it goes anyway after a few seconds.
    line.state = 'pending';
    line.castPending = { yaw: Math.atan2(dir.x, dir.z) - this.boat.heading, t: 0, launchAt: null };
    this.noteWork(line, 'cast');
    // The boat itself never moves for a cast: the body turns to throw, the
    // hull keeps whatever way and heading it had.
    return true;
  }

  /** Let a pending cast go: the lure leaves the rod tip now. */
  launch(line) {
    if (line.state !== 'pending') return;
    this.boat.rodTipWorld(line.rodIndex, line.start);
    line.pos.copy(line.start);
    line.timer = 0;
    line.state = 'flying';
    line.castPending = null;
    line.driftAngle = Math.random() * Math.PI * 2;
    line.show(true);
    line.bobber.rotation.set(0, 0, 0);
  }

  pull(line, power, quiet = false) {
    if (line.biting && !line.hooked) {
      // The hook sets: settle the bet here and now. Everything after this is
      // presentation — the fish is already bought and paid for.
      if (!this.setHook(line, quiet)) return;
    }
    // A hand on the crank moves far more line than a deckhand's steady
    // cranking does — `quiet` is exactly the crew and the auto-reel, and
    // holding them to their own figure keeps the pace of an assisted rod
    // where it was while a swipe gets its weight back.
    const swipes = quiet ? CONFIG.REEL_ASSIST_SWIPES : CONFIG.REEL_SWIPES;
    line.pendingPull += (line.distTotal / swipes) * (0.85 + 0.5 * power);
    this.noteWork(line, 'reel');
  }

  /**
   * Remember which line is being worked and how, for the fishermen on deck:
   * the captain runs to whichever rod the player last cast or cranked.
   */
  noteWork(line, kind) {
    this.work = { line, kind, at: performance.now() / 1000 };
  }

  /**
   * Resolve the cast's isolated bet and put the fish it produced on the line.
   * Money moves exactly once, here. Returns false if the stake cannot be
   * covered, in which case the fish is never hooked and nothing is charged.
   */
  setHook(line, quiet = false) {
    const cost = line.wager;
    if (this.player.balance < cost) {
      this.hud.hint('No cash for the tackle — it slipped the hook');
      line.end();
      return false;
    }
    line.hooked = true;
    line.biting = false;
    this.hud.setBite(this.lines.some((l) => l.biting));

    this.player.balance -= cost;
    this.rtp.wager(cost);
    const c = this.rtp.resolveBet(cost, 0, LURES[line.lureIndex].tiers[1], Math.random, this.poolAt(line.pos.x, line.pos.z));
    this.rtp.book(c.value);
    // Banked on the hook rather than at the rail, so quitting, a snapped rod
    // or a closed tab can never destroy a bet the player has already won.
    this.player.bank(c);
    line.catch = c;
    line.catchWager = cost;
    line.fish = new HookedFish(this.scene, c.species, c.sizeMult);
    // A fishing match counts the rod's catches as they are hooked.
    if (this.onCatch) this.onCatch(c);

    if (!quiet) {
      this.hud.hint(this.autoReel ? 'Fish on!' : 'Fish on! Keep swiping to bring it in', 2600);
    }
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    return true;
  }

  scheduleBite(line) {
    const spot = this.lake.hotspotAt(line.pos.x, line.pos.z);
    line.hotness = spot ? spot.hotness : 0;
    // A hotspot bites faster, and faster still on the bait it favours.
    const match = spot && spot.hotspot.lureId === LURES[line.lureIndex].id ? 1 : 0.45;
    const speedup = 1 + line.hotness * match * (CONFIG.HOTSPOT_BITE_BOOST - 1);
    line.biteTimer = (CONFIG.BITE_MIN_S +
      Math.random() * (CONFIG.BITE_MAX_S - CONFIG.BITE_MIN_S)) / speedup;
  }

  /** The fish is over the rail: show what the hook already paid for. */
  completeCatch(line) {
    const c = line.catch;
    const cost = line.catchWager;
    line.end();
    if (!c) return;
    this.hud.showCatch(c, cost);
    if (c.value >= CONFIG.BIGCATCH_MIN_VALUE || c.species.tier >= 4) {
      this.hud.showBigCatch(c);
    }
  }

  endAll() {
    for (const l of this.lines) if (l.busy) l.end();
    this.hud.setBite(false);
  }

  // ---------- trawling ----------
  toggleTrawl() {
    if (!this.spec.features.trawl) {
      this.hud.hint(`A ${this.spec.name} has no trawl gear — upgrade at a marina`);
      return;
    }
    if (this.activeLines) { this.hud.hint('Reel your lines in before trawling'); return; }
    if (!this.boat.trawling) {
      if (this.player.balance <= 0) { this.hud.hint('No funds to trawl'); return; }
    }
    this.boat.setTrawling(!this.boat.trawling, this.trawlNet);
    this.hud.setTrawling(this.boat.trawling, this.trawlNet);
    if (this.boat.trawling) {
      this.trawlDistAcc = 0;
      this.trawlCostAcc = 0;
      this.trawlNextCatch = this.rollTrawlInterval();
      this.hud.hint(`${this.trawlNet.name} out — $${this.trawlNet.costPerM.toFixed(2)}/m`);
    } else {
      this.hud.hint('Net stowed');
    }
  }

  stopTrawl(msg) {
    this.boat.setTrawling(false);
    this.hud.setTrawling(false);
    if (msg) this.hud.hint(msg);
  }

  updateTrawl(dt) {
    const p = this.boat.pos;
    const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.y);
    this.lastPos.set(p.x, p.z);
    if (!this.boat.trawling || moved <= 0.001) return;

    const cost = moved * this.trawlNet.costPerM + this.trawlCostRemainder;
    const spend = Math.min(cost, this.player.balance);
    this.trawlCostRemainder = 0;
    if (spend > 0) {
      this.player.balance -= spend;
      this.rtp.wager(spend);
      this.trawlCostAcc += spend;
    }
    if (this.player.balance <= 0) return this.stopTrawl('Out of funds — net stowed');

    this.trawlDistAcc += moved;
    if (this.trawlDistAcc >= this.trawlNextCatch) {
      this.resolveTrawlCatch();
      this.trawlDistAcc = 0;
      this.trawlCostAcc = 0;
      this.trawlNextCatch = this.rollTrawlInterval();
    }
  }

  resolveTrawlCatch() {
    const stake = this.trawlCostAcc;
    if (stake <= 0) return;
    const payout = this.rtp.samplePayout(stake);

    const n = CONFIG.TRAWL_FISH_MIN +
      Math.floor(Math.random() * (CONFIG.TRAWL_FISH_MAX - CONFIG.TRAWL_FISH_MIN + 1));
    const cuts = Array.from({ length: n }, () => 0.25 + Math.random());
    const cutSum = cuts.reduce((a, b) => a + b, 0);

    const catches = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const bump = Math.random() < CONFIG.TRAWL_RARE_TIER_CHANCE ? 1 : 0;
      const maxTier = Math.min(this.trawlNet.maxTier + bump, CONFIG.TRAWL_TIER_CAP);
      const c = this.rtp.describeCatch(payout * (cuts[i] / cutSum), 0, maxTier, Math.random, this.poolAt(this.boat.pos.x, this.boat.pos.z));
      catches.push(c);
      total += c.value;
      this.player.bank(c);
      // Already paid for: show it in the bag for as long as the notice is up.
      this.boat.net?.addCatch(c.species, c.sizeMult, HAUL_TOAST_MS / 1000, TOAST_FADE_MS / 1000);
    }
    this.rtp.book(total);
    this.hud.showTrawlHaul(catches, total);
    const best = catches.reduce((a, b) => (b.value > a.value ? b : a));
    if (best.value >= CONFIG.BIGCATCH_MIN_VALUE) this.hud.showBigCatch(best);
  }

  // ---------- pots ----------
  dropPot() {
    if (!this.spec.features.pots) {
      this.hud.hint(`A ${this.spec.name} carries no pots — upgrade at a marina`);
      return;
    }
    if (this.pots.length >= CONFIG.MAX_POTS) {
      this.hud.hint(`All ${CONFIG.MAX_POTS} pots are already out`);
      return;
    }
    const gear = this.potGear;
    const stake = gear.stake;
    if (this.player.balance < stake) {
      this.hud.hint(`Need $${stake.toFixed(2)} to bait a ${gear.name.toLowerCase()}`);
      return;
    }
    // It goes over the side beside the boat, whichever side has the water.
    // This only picks the rail: where it lands is worked out when it is
    // actually thrown (landPot), since the boat may well have moved on by then.
    const side = this.potSide();
    if (!side) {
      this.hud.hint('Too shallow to set a pot here');
      return;
    }
    // The stake is paid now; the bet resolves when the pot is collected.
    this.player.balance -= stake;
    this.rtp.wager(stake);

    const pot = this.buildPot(gear);
    pot.gear = gear;
    pot.stake = stake;
    pot.side = side;
    pot.ready = CONFIG.POT_SOAK_S;
    pot.phase = Math.random() * Math.PI * 2;
    // Waits on the deck for a hand to carry it to the rail and throw it;
    // nobody coming, it goes over from the rail on its own.
    pot.anim = { kind: 'ready', t: 0 };
    pot.mesh.visible = false;
    pot.mesh.position.copy(this.railPoint(side, this._v));
    pot.x = pot.mesh.position.x; pot.z = pot.mesh.position.z;   // provisional, until it is thrown
    this.potGroup.add(pot.mesh, pot.splash);
    this.pots.push(pot);
    this.hud.hint(`${gear.name} set — $${stake.toFixed(2)} staked, soak ${CONFIG.POT_SOAK_S}s`);
    this.hud.setPots(this.pots.length);
  }

  /** The side with water enough for a pot beside the boat right now, else 0. */
  potSide(prefer = 1) {
    const spot = this._v;
    for (const s of [prefer, -prefer]) {
      this.potSpot(s, spot);
      if (waterDepth(spot.x, spot.z) >= CONFIG.POT_MIN_DEPTH) return s;
    }
    return 0;
  }

  /**
   * Fix where a pot lands, at the moment it leaves the hands: beside the boat
   * where it is *now*, carried a little forward by the boat's way, so a pot
   * thrown from a moving boat never flies back to where the boat was when
   * the button was pressed. The rail it goes from is settled — the hand is
   * standing there — so if that side has gone shallow since, the pot still
   * lands off it, as far in as the water allows.
   */
  landPot(pot) {
    const out = this._v;
    const carry = Math.min(POT_DROP_S * 0.6, 4 / (this.boat.vel.length() + 1e-6));
    this.potSpot(pot.side, out);
    out.x += this.boat.vel.x * carry; out.z += this.boat.vel.z * carry;
    if (waterDepth(out.x, out.z) < CONFIG.POT_MIN_DEPTH) this.potSpot(pot.side, out);
    if (waterDepth(out.x, out.z) < CONFIG.POT_MIN_DEPTH) {
      // Bring it in toward the hull until the water is there.
      const b = this.boat.hullBounds || { halfBeam: 1, length: 5 };
      for (let k = 1; k <= 4; k++) {
        out.set(pot.side * (b.halfBeam + 1.3 - 0.3 * k), 0, b.length * 0.12);
        this.boat.hullFrame.localToWorld(out); out.y = 0;
        if (waterDepth(out.x, out.z) >= CONFIG.POT_MIN_DEPTH) break;
      }
    }
    pot.x = out.x; pot.z = out.z;
  }

  /** A pot: a baited cage under a float on a rope, plus its own splash ring. */
  buildPot(gear = POTS[0]) {
    const mesh = new THREE.Group();
    const cage = new THREE.Group();
    const s = gear.size || 1;
    cage.add(new THREE.Mesh(
      new THREE.CylinderGeometry(0.42 * s, 0.5 * s, 0.5 * s, 8),
      new THREE.MeshStandardMaterial({ color: gear.color, roughness: 0.85 })));
    cage.add(new THREE.Mesh(
      new THREE.CylinderGeometry(0.43 * s, 0.51 * s, 0.5 * s, 8),
      new THREE.MeshBasicMaterial({ color: 0x4c4028, wireframe: true, transparent: true, opacity: 0.6 })));
    cage.position.y = -0.35;
    const float = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 10, 7),
      new THREE.MeshStandardMaterial({ color: 0xe8b23a, roughness: 0.5 }));
    float.position.y = 0.95;
    const rope = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        [new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(0, 0.85, 0)]),
      new THREE.LineBasicMaterial({ color: 0x3d3428 }));
    rope.frustumCulled = false;
    mesh.add(cage, float, rope);
    const splash = new THREE.Mesh(POT_RING, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    }));
    splash.renderOrder = 4;
    splash.visible = false;
    return {
      mesh, cage, float, rope, splash, splashT: 0, anim: null, result: null,
      // Where a hand is holding it this frame (world), if one is.
      handPos: new THREE.Vector3(), handFresh: false,
    };
  }

  /** The rail a pot is thrown from or hauled over: where a hand stands for it. */
  potRail(pot) {
    const b = this.boat.hullBounds || { halfBeam: 1, length: 5, deckY: 0.5 };
    return { side: pot.side, x: pot.side * b.halfBeam * 0.92, z: b.length * 0.12, y: b.deckY };
  }

  /** Where a pot goes in: a little off the boat's side, abreast the working deck. */
  potSpot(side, out) {
    const b = this.boat.hullBounds || { halfBeam: 1, length: 5, deckY: 0.5 };
    out.set(side * (b.halfBeam + 1.3), 0, b.length * 0.12);
    this.boat.hullFrame.localToWorld(out);
    out.y = 0;
    return out;
  }

  /** The rail a pot leaves from or comes back over, in world space. */
  railPoint(side, out) {
    const b = this.boat.hullBounds || { halfBeam: 1, length: 5, deckY: 0.5 };
    out.set(side * b.halfBeam * 0.92, b.deckY + 0.45, b.length * 0.12);
    return this.boat.hullFrame.localToWorld(out);
  }

  /** Keep a pot's rope drawn from the cage up to the float. */
  potRope(pot) {
    const p = pot.rope.geometry.attributes.position;
    p.setXYZ(0, 0, pot.cage.position.y + 0.25, 0);
    p.setXYZ(1, 0, pot.float.position.y - 0.12, 0);
    p.needsUpdate = true;
  }

  potSplash(pot, dt) {
    if (pot.splashT <= 0) return;
    pot.splashT = Math.max(0, pot.splashT - dt * 1.6);
    const k = 1 - pot.splashT;
    pot.splash.scale.setScalar(1.1 * (0.4 + k * 1.6));
    pot.splash.material.opacity = pot.splashT * 0.75;
    if (pot.splashT <= 0) pot.splash.visible = false;
  }

  updatePots(dt, t) {
    for (let i = this.pots.length - 1; i >= 0; i--) {
      const pot = this.pots[i];
      if (pot.ready > 0) pot.ready = Math.max(0, pot.ready - dt);
      // Float bobs; it lifts and brightens once the pot is worth pulling.
      const soaked = pot.ready <= 0;
      pot.float.position.y = 0.95 + Math.sin(t * 2 + pot.phase) * 0.06 + (soaked ? 0.1 : 0);
      pot.float.material.color.setHex(soaked ? 0x7dedae : 0xe8b23a);

      const a = pot.anim;
      const hand = pot.handFresh ? pot.handPos : null;
      pot.handFresh = false;
      if (a && a.kind === 'ready') {
        // On the deck until a hand has it; nobody after a while, it is
        // thrown from the rail by itself.
        if (!a.queued) a.t += dt;
        a.queued = false;
        // It appears where it is picked up — the rail it was put by at the
        // press may be well astern by now if the boat is under way.
        if (hand) { pot.anim = { kind: 'carried', t: 0, thrown: false, byHand: true }; pot.mesh.position.copy(hand); pot.mesh.visible = true; }
        else if (a.t > POT_WAIT_S) { pot.anim = { kind: 'carried', t: 0, thrown: true, byHand: false }; pot.mesh.position.copy(this.railPoint(pot.side, this._v)); pot.mesh.visible = true; }
      } else if (a && a.kind === 'carried') {
        // In the hands at the rail (or on the rail): thrown off the whip
        // of the heave, which the crew director starts.
        pot.mesh.position.copy(hand || (a.byHand ? pot.handPos : this.railPoint(pot.side, this._v)));
        if (a.thrown) a.t += dt;
        if (a.t >= (a.byHand ? POT_WHIP_S : 0)) {
          // Leaving the hands: only now is it decided where it comes down.
          this.landPot(pot);
          pot.anim = { kind: 'drop', t: 0, from: pot.mesh.position.clone() };
        }
      } else if (a && a.kind === 'drop') {
        // A lob off the rail: out and over in an arc, tumbling, then the splash.
        a.t += dt;
        const k = Math.min(1, a.t / POT_DROP_S);
        pot.mesh.position.lerpVectors(a.from, this._v.set(pot.x, 0, pot.z), k);
        pot.mesh.position.y = a.from.y * (1 - k) + Math.sin(k * Math.PI) * 0.8 - 0.05 * k;
        pot.mesh.rotation.set(0, 0, pot.side * (0.35 * k - 0.45 * Math.sin(k * Math.PI)));
        if (k >= 1) {
          pot.mesh.position.set(pot.x, 0, pot.z);
          pot.mesh.rotation.set(0, 0, 0);
          pot.splash.position.set(pot.x, 0.05, pot.z);
          pot.splash.visible = true;
          pot.splashT = 1;
          pot.anim = { kind: 'sink', t: 0 };
        }
      } else if (a && a.kind === 'sink') {
        // The cage goes down under the float until the rope is straight.
        a.t += dt;
        const k = Math.min(1, a.t / POT_SINK_S);
        pot.cage.position.y = -0.35 - 2.3 * smooth(k);
        pot.cage.rotation.y += dt * 0.8;
        if (k >= 1) pot.anim = null;
      }
      this.potRope(pot);
      this.potSplash(pot, dt);

      const d = Math.hypot(pot.x - this.boat.pos.x, pot.z - this.boat.pos.z);
      if (!pot.anim && d <= CONFIG.POT_COLLECT_RADIUS && soaked) {
        this.collectPot(i);
      }
    }

    // Pots coming up: the cage hauled to the surface, then swung over the rail.
    for (let i = this.hauls.length - 1; i >= 0; i--) {
      const pot = this.hauls[i], a = pot.anim;
      a.t += dt;
      if (a.kind === 'haul') {
        const k = Math.min(1, a.t / POT_HAUL_S);
        pot.cage.position.y = -2.65 + 2.3 * smooth(k);
        pot.cage.rotation.y += dt * 1.4;
        pot.float.position.y = 0.95 + Math.sin(t * 6) * 0.05;
        if (k >= 1) {
          pot.anim = { kind: 'lift', t: 0, from: pot.mesh.position.clone() };
          pot.splash.position.set(pot.x, 0.05, pot.z);
          pot.splash.visible = true;
          pot.splashT = 1;
        }
      } else {
        // Up out of the water and in over the rail, on the side it lies —
        // into the hands of whoever is there to take it.
        const k = Math.min(1, a.t / POT_LIFT_S);
        const hand = pot.handFresh ? pot.handPos : null;
        pot.handFresh = false;
        const rail = hand || this.railPoint(pot.side, this._v);
        pot.mesh.position.lerpVectors(a.from, rail, smooth(k));
        pot.mesh.position.y = rail.y * k + Math.sin(k * Math.PI) * 0.9;
        pot.cage.position.y = -0.35 + 0.2 * k;
        pot.mesh.rotation.z = -pot.side * 0.3 * Math.sin(k * Math.PI);
        if (k >= 1) {
          this.hauls.splice(i, 1);
          this.potGroup.remove(pot.mesh, pot.splash);
          const r = pot.result;
          this.hud.showPotHaul(r.catches, r.total);
          if (r.best.value >= CONFIG.BIGCATCH_MIN_VALUE) this.hud.showBigCatch(r.best);
          continue;
        }
      }
      this.potRope(pot);
      this.potSplash(pot, dt);
    }
  }

  /**
   * The pot is reached: its bet resolves now, and the haul is shown once
   * the cage is up and over the rail (the animation is only a picture of
   * a result already settled and banked).
   */
  collectPot(i) {
    const pot = this.pots[i];
    this.pots.splice(i, 1);
    // Whichever side of the boat it lies, that is the rail it comes over.
    const local = this.boat.hullFrame.worldToLocal(this._v.set(pot.x, 0, pot.z));
    pot.side = local.x >= 0 ? 1 : -1;
    this.resolvePot(pot);
    pot.anim = { kind: 'haul', t: 0 };
    this.hauls.push(pot);
  }

  /** Settle a pot's bet: money moves once, here; the haul is shown later. */
  resolvePot(pot) {
    const payout = this.rtp.samplePayout(pot.stake);
    const n = 1 + Math.floor(Math.random() * 2);
    const cuts = Array.from({ length: n }, () => 0.4 + Math.random());
    const cutSum = cuts.reduce((a, b) => a + b, 0);
    const catches = [];
    let total = 0;
    for (let k = 0; k < n; k++) {
      // The bait picks the species that can be in the cage — the value each
      // one is worth was drawn above from the stake and nothing else.
      const maxTier = Math.min((pot.gear || POTS[0]).maxTier, CONFIG.TRAWL_TIER_CAP);
      const c = this.rtp.describeCatch(payout * (cuts[k] / cutSum), 0, maxTier, Math.random, this.poolAt(pot.x, pot.z));
      catches.push(c);
      total += c.value;
      this.player.bank(c);
    }
    this.rtp.book(total);
    this.hud.setPots(this.pots.length);
    const best = catches.reduce((a, b) => (b.value > a.value ? b : a));
    pot.result = { catches, total, best };
  }

  // ---------- steamboat crew ----------
  /**
   * The hired crew works the rods for you. It deliberately goes through the
   * very same cast() and pull() the player's swipes use, so a crewed rod and
   * a hand-worked rod are the identical bet — the crew is extra hands, not
   * better odds.
   */
  setCrew(on) {
    if (on && !this.spec.features.crew) {
      this.hud.hint(`A ${this.spec.name} has no crew quarters — upgrade at a marina`);
      return false;
    }
    this.crew = on;
    this.hud.setCrew(on);
    this.hud.hint(on ? 'Crew on deck — they will work the rods'
      : 'Crew stood down');
    return true;
  }

  updateCrew(dt) {
    if (!this.crew || !this.spec.features.crew) return;

    this.crewReelTimer -= dt;
    if (this.crewReelTimer <= 0) {
      this.crewReelTimer = CONFIG.CREW_REEL_EVERY;
      for (const l of this.lines) {
        if (l.biting || l.hooked) this.pull(l, CONFIG.CREW_PULL_POWER, true);
        else if (l.state === 'out' && l.nibbles >= 2) this.pull(l, 0.9, true);
      }
    }

    this.crewCastTimer -= dt;
    if (this.crewCastTimer <= 0) {
      // More hands work more rods: the gap shrinks with the rod count so a
      // sixteen-rod steamboat actually fills its rails.
      this.crewCastTimer = CONFIG.CREW_CAST_EVERY * 4 / Math.max(4, this.spec.rods);
      if (this.lines.some((l) => !l.busy)) {
        const a = Math.random() * Math.PI * 2;
        this.cast({ x: Math.cos(a), z: Math.sin(a), power: 0.35 + Math.random() * 0.5 }, true);
      }
    }
  }

  // ---------- per-frame ----------
  updateLine(line, dt, t) {
    if (!line.busy) return;
    line.timer += dt;
    this.boat.rodTipWorld(line.rodIndex, line.rodTip);

    if (line.state === 'pending') {
      const p = line.castPending;
      if (!p) { line.state = 'idle'; line.reset(); return; }
      p.t += dt;
      // The swing has started: the lure leaves at its whip. A cast nobody
      // has claimed goes on its own after a moment; one somebody is walking
      // to waits for them, within reason.
      if (p.launchAt != null && p.t >= p.launchAt) this.launch(line);
      else if (p.t > (p.claimed ? 12 : 4.5)) this.launch(line);
      return;
    }

    if (line.state === 'snapped') { this.updateSnapped(line, dt); return; }

    if (line.state === 'flying') {
      const T = 0.65;
      const k = Math.min(1, line.timer / T);
      line.pos.lerpVectors(line.start, line.target, k);
      line.bobber.position.copy(line.pos);
      line.bobber.position.y = CONFIG.WATER_LEVEL +
        line.start.y * (1 - k) + Math.sin(k * Math.PI) * 3.0;
      if (k >= 1) {
        line.state = 'out';
        line.timer = 0;
        line.pos.y = CONFIG.WATER_LEVEL;
        // The catch roll happens now, before any bite: a hotspot raises the
        // odds a fish turns up, never what it pays.
        const spot = this.lake.hotspotAt(line.pos.x, line.pos.z);
        line.hotness = spot ? spot.hotness : 0;
        const match = spot && spot.hotspot.lureId === LURES[line.lureIndex].id ? 1 : 0.45;
        const chance = lerp(CONFIG.CAST_CATCH_CHANCE, CONFIG.HOTSPOT_CATCH_CHANCE,
          clamp(line.hotness * match, 0, 1));
        line.willCatch = Math.random() < chance;
        this.scheduleBite(line);
      }
      line.drawLine();
      return;
    }

    if (line.state === 'landing') {
      // Swing it up out of the water and onto the deck.
      line.landT += dt;
      const k = Math.min(1, line.landT / CONFIG.LAND_LIFT_S);
      line.bobber.position.lerp(line.rodTip, Math.min(1, k * 1.3));
      if (line.fish) line.fish.update(dt, t, line.pos, line.rodTip, 0, k);
      line.drawLine();
      if (k >= 1) this.completeCatch(line);
      return;
    }

    // --- state: 'out' ---
    const toRod = this._v.set(
      line.rodTip.x - line.pos.x, 0, line.rodTip.z - line.pos.z);
    let lineOut = toRod.length();
    toRod.normalize();

    // The drum takes up a swipe almost at once and runs down slowly, so line
    // keeps coming after the crank stops instead of stalling with it.
    const targetVel = line.pendingPull > 0.02
      ? Math.min(CONFIG.REEL_SPEED, CONFIG.REEL_BASE_SPEED + line.pendingPull * CONFIG.REEL_GAIN)
      : 0;
    const spin = targetVel > line.reelVel ? CONFIG.REEL_SPINUP : CONFIG.REEL_COAST;
    line.reelVel += (targetVel - line.reelVel) * Math.min(1, spin * dt);
    if (line.reelVel > 0.02 && lineOut > 0.01) {
      const step = Math.min(line.reelVel * dt, lineOut);
      line.pos.addScaledVector(toRod, step);
      line.pendingPull = Math.max(0, line.pendingPull - step);
      lineOut -= step;
      if (!line.hooked) line.biteTimer = Math.max(line.biteTimer, 0.8);
    } else if (!line.hooked && line.reelVel < 0.3) {
      line.driftAngle += Math.sin(t * 0.4 + line.driftAngle) * 0.25 * dt;
      const nx = line.pos.x + Math.cos(line.driftAngle) * 0.14 * dt;
      const nz = line.pos.z + Math.sin(line.driftAngle) * 0.14 * dt;
      if (waterDepth(nx, nz) > 0.3) { line.pos.x = nx; line.pos.z = nz; }
      else line.driftAngle += Math.PI / 2;
    }

    if (line.hooked) {
      // The bet is already settled, so the fish can never be lost — left
      // alone it surges, tires, and works its own way in, just slowly.
      if (line.pendingPull <= 0 && lineOut > 1.4) {
        const surge = Math.sin(t * 1.7 + line.driftAngle * 3) * CONFIG.HOOK_PULL_SPEED;
        line.pos.addScaledVector(toRod, (CONFIG.HOOK_TIRE_SPEED + surge) * dt);
      }
      // Drive off and it is dragged along behind you rather than breaking off.
      if (lineOut > CONFIG.LINE_SNAP_DIST * 0.8) {
        const over = lineOut - CONFIG.LINE_SNAP_DIST * 0.8;
        line.pos.addScaledVector(toRod, over);
        lineOut -= over;
      }
      line.bobber.position.set(
        line.pos.x + Math.sin(t * 17) * 0.12,
        CONFIG.WATER_LEVEL - 0.12 + Math.sin(t * 23) * 0.08,
        line.pos.z + Math.cos(t * 15) * 0.12);
      if (line.fish) line.fish.update(dt, t, line.bobber.position, line.rodTip, lineOut);
    } else {
      const wave = this.lake.waveHeight(line.pos.x, line.pos.z, t);
      if (line.biting) {
        line.bobber.position.set(line.pos.x,
          CONFIG.WATER_LEVEL - 0.18 + Math.sin(t * 22) * 0.1, line.pos.z);
        line.biteTimer -= dt;
        if (line.biteTimer <= 0) {
          line.biting = false;
          this.hud.setBite(this.lines.some((l) => l.biting));
          this.scheduleBite(line);
        }
      } else if (line.nibbling > 0) {
        line.nibbling -= dt;
        line.bobber.position.set(line.pos.x,
          CONFIG.WATER_LEVEL - 0.08 + Math.sin(t * 18) * 0.05, line.pos.z);
      } else {
        line.bobber.position.set(line.pos.x,
          CONFIG.WATER_LEVEL + 0.05 + wave * 0.8, line.pos.z);
        line.bobber.rotation.set(
          Math.sin(t * 1.1 + line.driftAngle) * 0.12, 0,
          Math.sin(t * 0.9 + line.driftAngle * 2) * 0.14);
        line.biteTimer -= dt;
        if (line.biteTimer <= 0) {
          if (line.willCatch) {
            line.biting = true;
            line.biteTimer = CONFIG.BITE_WINDOW_S;
            this.hud.setBite(true);
            if (navigator.vibrate) navigator.vibrate(80);
          } else {
            line.nibbling = 0.45;
            line.nibbles++;
            this.scheduleBite(line);
            if (line.nibbles === 1) this.hud.hint('Just a nibble…');
            else if (line.nibbles === 2) this.hud.hint('Nothing committing here — swipe to reel in');
          }
        }
      }
      if (line.timer > CONFIG.CAST_TIMEOUT_S) {
        this.hud.hint('The lure came back untouched — no charge');
        line.end();
        return;
      }
    }

    if (lineOut < 1.4) {
      if (line.hooked) { line.state = 'landing'; line.landT = 0; }
      else { this.hud.hint('Reeled in — no bet, no charge'); line.end(); }
      return;
    }
    // Only an empty line parts; a hooked one is dragged, not snapped.
    if (!line.hooked && lineOut > CONFIG.LINE_SNAP_DIST) {
      this.hud.hint('The line snapped!');
      this.snap(line);
      return;
    }
    line.drawLine();
  }

  /**
   * The line parts. Nothing is owed on it (no hook was ever set), so this
   * is pure picture: the rod springs back, the loose end whips up toward
   * the tip and falls slack in the water, and the cut-off float rolls over
   * and goes under. The rod is free again once it has settled.
   */
  snap(line) {
    line.state = 'snapped';
    line.snapT = 0;
    line.snapFrom.copy(line.bobber.position);
    line.biting = false;
    line.nibbling = 0;
    if (line.fish) { line.fish.dispose(); line.fish = null; }
  }

  updateSnapped(line, dt) {
    line.snapT += dt;
    const k = Math.min(1, line.snapT / SNAP_S);
    // The parted line: its free end flies back toward the tip, up in an arc
    // with the rod's spring, and settles on the water alongside.
    const e = 1 - Math.pow(1 - k, 3);
    const end = this._v.lerpVectors(line.snapFrom, line.rodTip, e * 0.85);
    const arc = Math.sin(Math.min(1, k * 1.6) * Math.PI);
    end.y = CONFIG.WATER_LEVEL + (line.rodTip.y - CONFIG.WATER_LEVEL) * arc * 0.6 - 0.1 * k;
    const p = line.line.geometry.attributes.position;
    p.setXYZ(0, line.rodTip.x, line.rodTip.y, line.rodTip.z);
    p.setXYZ(1, end.x, end.y, end.z);
    p.needsUpdate = true;
    line.line.material.opacity = 0.65 * (1 - Math.max(0, k - 0.7) / 0.3);
    // The float, cut loose, rolls over and goes under.
    line.bobber.position.y = CONFIG.WATER_LEVEL + 0.05 - Math.max(0, k - 0.3) * 1.1;
    line.bobber.rotation.x += dt * 2.4;
    if (k >= 1) { line.line.material.opacity = 0.65; line.bobber.rotation.set(0, 0, 0); line.end(); }
  }

  /**
   * Auto reel: set the hook and crank the moment a rod goes down, so the reel
   * never has to be played well. It changes how many bets get placed, never
   * what one pays — the same reason the crew are allowed to work the rods.
   */
  setAutoReel(on) {
    this.autoReel = !!on;
    this.autoTimer = 0;
    this.player.autoReel = this.autoReel;
    this.player.save();
    return this.autoReel;
  }

  updateAutoReel(dt) {
    if (!this.autoReel || this.crew) return;   // the crew already work the rods
    this.autoTimer -= dt;
    if (this.autoTimer > 0) return;
    this.autoTimer = CONFIG.AUTOREEL_EVERY;
    for (const l of this.lines) {
      if (l.biting || l.hooked) this.pull(l, CONFIG.AUTOREEL_POWER, true);
      // Bring back a lure nothing is committing to, rather than leaving the
      // rod pegged until the 45s timeout. Retrieving costs nothing.
      else if (l.state === 'out' && l.nibbles >= 2) this.pull(l, 0.9, true);
    }
  }

  /** Point each working rod at its own line, loaded up by what is on it. */
  aimRods() {
    if (!this.boat.aimRods) return;
    this._aims.length = 0;
    for (const l of this.lines) {
      if (!l.busy) continue;
      this._aims.push({
        index: l.rodIndex, x: l.pos.x, z: l.pos.z,
        // A parted line: the rod springs back the other way, then settles.
        load: l.state === 'snapped' ? -0.7 * (1 - Math.min(1, l.snapT / SNAP_S))
          : l.hooked ? 1 : (l.biting ? 0.6 : 0.2),
      });
    }
    this.boat.aimRods(this._aims);
  }

  update(dt, t) {
    this.updateTrawl(dt);
    this.updateAutoReel(dt);
    this.updateCrew(dt);
    this.updatePots(dt, t);
    for (const l of this.lines) this.updateLine(l, dt, t);
    this.aimRods();
    // The bite marker follows the lines every frame, so a biting line that
    // snaps, times out or is reeled in can never leave it flashing.
    this.hud.setBite(this.lines.some((l) => l.biting));
  }
}
