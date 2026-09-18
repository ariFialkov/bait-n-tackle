// Fishing mechanics: casting (one line per rod), trawling, and pots.
//
// Betting model (see rtp.js): every resolved bet draws an isolated payout
// multiplier with E = RTP.
//   * Casting — the bet is PLACED only when a fish is actually landed, so an
//     empty cast is free and hotspots (which only change how OFTEN a fish
//     shows up) can never change the expected value of a bet.
//   * Trawling — each stretch of paid distance between catch events is its
//     own microbet, resolved against that stretch's cost alone. Location
//     never affects a trawl result.
//   * Pots — the stake is paid when the pot is dropped and the bet resolves
//     when it is collected, against that stake alone.
// Landed value is paid straight into the balance (player.js) the moment the
// fish comes over the rail, so realised RTP is exactly the paytable's.

import * as THREE from 'three';
import { CONFIG, LURES, NETS } from './config.js';
import { waterDepth } from './lake.js';
import { clamp, lerp } from './noise.js';

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
    this.state = 'idle';            // idle | flying | out
    this.rodIndex = 0;
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
  }

  reset() {
    this.timer = 0;
    this.biteTimer = 0;
    this.biting = false;
    this.nibbling = 0;
    this.nibbles = 0;
    this.hooked = false;
    this.escapeTimer = 0;
    this.pendingPull = 0;
    this.reelVel = 0;
    this.willCatch = false;
    this.wager = 0;
    this.lureIndex = 0;
    this.distTotal = 0;
    this.hotness = 0;
    this.driftAngle = 0;
  }

  get busy() { return this.state !== 'idle'; }

  show(on) {
    this.bobber.visible = on;
    this.line.visible = on;
  }

  end() {
    this.state = 'idle';
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

    this.pots = [];
    this.potGroup = new THREE.Group();
    scene.add(this.potGroup);

    this._v = new THREE.Vector3();
    this.syncRods();
  }

  // ---------- gear ----------
  get lure() { return LURES[this.lureIndex]; }
  get trawlNet() { return NETS[this.netIndex]; }
  get spec() { return this.boat.spec; }

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

    const hooked = this.lines.filter((l) => l.hooked);
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
    if (this.boat.speed >= CONFIG.CAST_MAX_SPEED) { say('Stop the boat to cast'); return false; }
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
    line.state = 'flying';
    line.driftAngle = Math.random() * Math.PI * 2;
    line.show(true);
    line.bobber.rotation.set(0, 0, 0);

    // Only swing the bow for boats nimble enough to bother.
    if (this.spec.rods <= 2) {
      this.boat.nudgeHeading(Math.atan2(-dir.x, -dir.z), 0.3);
    }
    return true;
  }

  pull(line, power) {
    const add = (line.distTotal / CONFIG.REEL_SWIPES) * (0.7 + 0.6 * power);
    line.pendingPull += add;
    if (line.biting && !line.hooked) {
      line.hooked = true;
      line.biting = false;
      line.escapeTimer = CONFIG.HOOK_ESCAPE_S;
      this.hud.setBite(this.lines.some((l) => l.biting));
      this.hud.hint('Fish on! Keep swiping to reel it in!', 3000);
      if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    } else if (line.hooked) {
      line.escapeTimer = CONFIG.HOOK_ESCAPE_S;
    }
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

  /** The fish reached the boat: place the bet, pay the win into the balance. */
  landCatch(line) {
    const cost = line.wager;
    if (this.player.balance < cost) {
      this.hud.hint('No cash for the tackle — it slipped the hook');
      line.end();
      this.hud.setBite(this.lines.some((l) => l.biting));
      return;
    }
    this.player.balance -= cost;
    this.rtp.wager(cost);
    const c = this.rtp.resolveBet(cost, 0, LURES[line.lureIndex].tiers[1]);
    this.rtp.book(c.value);
    this.player.bank(c);
    this.hud.showCatch(c, cost);
    if (c.value >= CONFIG.BIGCATCH_MIN_VALUE || c.species.tier >= 4) {
      this.hud.showBigCatch(c);
    }
    line.end();
    this.hud.setBite(this.lines.some((l) => l.biting));
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
      const c = this.rtp.describeCatch(payout * (cuts[i] / cutSum), 0, maxTier);
      catches.push(c);
      total += c.value;
      this.player.bank(c);
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
    const stake = this.trawlNet.costPerM * CONFIG.POT_STAKE_MULT;
    if (this.player.balance < stake) {
      this.hud.hint(`Need $${stake.toFixed(2)} to bait a pot`);
      return;
    }
    if (waterDepth(this.boat.pos.x, this.boat.pos.z) < 1.2) {
      this.hud.hint('Too shallow to set a pot here');
      return;
    }
    // The stake is paid now; the bet resolves when the pot is collected.
    this.player.balance -= stake;
    this.rtp.wager(stake);

    const mesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.5, 0.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.85 }));
    const cage = new THREE.Mesh(
      new THREE.CylinderGeometry(0.43, 0.51, 0.5, 8),
      new THREE.MeshBasicMaterial({ color: 0x4c4028, wireframe: true, transparent: true, opacity: 0.6 }));
    const float = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 10, 7),
      new THREE.MeshStandardMaterial({ color: 0xe8b23a, roughness: 0.5 }));
    float.position.y = 0.95;
    const rope = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        [new THREE.Vector3(0, 0.25, 0), new THREE.Vector3(0, 0.85, 0)]),
      new THREE.LineBasicMaterial({ color: 0x3d3428 }));
    mesh.add(body, cage, float, rope);
    mesh.position.set(this.boat.pos.x, -0.35, this.boat.pos.z);
    this.potGroup.add(mesh);

    this.pots.push({
      x: this.boat.pos.x, z: this.boat.pos.z,
      stake, mesh, float,
      ready: CONFIG.POT_SOAK_S,
      phase: Math.random() * Math.PI * 2,
    });
    this.hud.hint(`Pot set — $${stake.toFixed(2)} staked, soak ${CONFIG.POT_SOAK_S}s`);
    this.hud.setPots(this.pots.length);
  }

  updatePots(dt, t) {
    for (let i = this.pots.length - 1; i >= 0; i--) {
      const pot = this.pots[i];
      if (pot.ready > 0) pot.ready = Math.max(0, pot.ready - dt);
      // Float bobs; it lifts and brightens once the pot is worth pulling.
      const soaked = pot.ready <= 0;
      pot.float.position.y = 0.95 + Math.sin(t * 2 + pot.phase) * 0.06 + (soaked ? 0.1 : 0);
      pot.float.material.color.setHex(soaked ? 0x7dedae : 0xe8b23a);

      const d = Math.hypot(pot.x - this.boat.pos.x, pot.z - this.boat.pos.z);
      if (d <= CONFIG.POT_COLLECT_RADIUS && soaked) {
        this.collectPot(i);
      }
    }
  }

  collectPot(i) {
    const pot = this.pots[i];
    this.pots.splice(i, 1);
    this.potGroup.remove(pot.mesh);

    const payout = this.rtp.samplePayout(pot.stake);
    const n = 1 + Math.floor(Math.random() * 2);
    const cuts = Array.from({ length: n }, () => 0.4 + Math.random());
    const cutSum = cuts.reduce((a, b) => a + b, 0);
    const catches = [];
    let total = 0;
    for (let k = 0; k < n; k++) {
      const c = this.rtp.describeCatch(
        payout * (cuts[k] / cutSum), 0, Math.min(this.trawlNet.maxTier + 1, CONFIG.TRAWL_TIER_CAP));
      catches.push(c);
      total += c.value;
      this.player.bank(c);
    }
    this.rtp.book(total);
    this.hud.showPotHaul(catches, total);
    this.hud.setPots(this.pots.length);
    const best = catches.reduce((a, b) => (b.value > a.value ? b : a));
    if (best.value >= CONFIG.BIGCATCH_MIN_VALUE) this.hud.showBigCatch(best);
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
        if (l.biting || l.hooked) this.pull(l, CONFIG.CREW_PULL_POWER);
        else if (l.state === 'out' && l.nibbles >= 2) this.pull(l, 0.9);
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

    // --- state: 'out' ---
    const toRod = this._v.set(
      line.rodTip.x - line.pos.x, 0, line.rodTip.z - line.pos.z);
    let lineOut = toRod.length();
    toRod.normalize();

    const targetVel = line.pendingPull > 0.02
      ? Math.min(CONFIG.REEL_SPEED, 1.5 + line.pendingPull * 2.2)
      : 0;
    line.reelVel += (targetVel - line.reelVel) * Math.min(1, 5.5 * dt);
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
      if (line.pendingPull <= 0 && lineOut > 2) {
        const ax = line.pos.x - line.rodTip.x, az = line.pos.z - line.rodTip.z;
        const al = Math.hypot(ax, az) || 1;
        line.pos.x += (ax / al) * CONFIG.HOOK_PULL_SPEED * dt;
        line.pos.z += (az / al) * CONFIG.HOOK_PULL_SPEED * dt;
      }
      line.escapeTimer -= dt;
      if (line.escapeTimer <= 0) {
        this.hud.hint('It got away…');
        line.end();
        return;
      }
      line.bobber.position.set(
        line.pos.x + Math.sin(t * 17) * 0.12,
        CONFIG.WATER_LEVEL - 0.12 + Math.sin(t * 23) * 0.08,
        line.pos.z + Math.cos(t * 15) * 0.12);
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
      if (line.hooked) this.landCatch(line);
      else { this.hud.hint('Reeled in — no bet, no charge'); line.end(); }
      return;
    }
    if (lineOut > CONFIG.LINE_SNAP_DIST) {
      this.hud.hint('The line snapped!');
      line.end();
      return;
    }
    line.drawLine();
  }

  update(dt, t) {
    this.updateTrawl(dt);
    this.updateCrew(dt);
    this.updatePots(dt, t);
    for (const l of this.lines) this.updateLine(l, dt, t);
  }
}
