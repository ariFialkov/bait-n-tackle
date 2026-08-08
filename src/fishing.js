// Fishing mechanics: trawling (distance-priced net dragging) and casting.
//
// Betting model (see rtp.js): every resolved bet draws an isolated payout
// multiplier with E = RTP. For casting, the bet is only PLACED when a fish
// is actually landed — an empty cast costs nothing, so hotspots (which only
// raise the catch chance) never change the expected value of a bet. For
// trawling, each stretch of paid distance between catch events is its own
// microbet, resolved against that stretch's cost alone.
//
// Casting flow: swipe in any direction to cast that way. Swipe again to
// reel — pulls wind in smoothly and a long cast takes 2-3 of them. Swiping
// during a bite sets the hook; bring the fish to the boat to land the bet.

import * as THREE from 'three';
import { CONFIG, LURES } from './config.js';
import { waterDepth } from './lake.js';
import { clamp, lerp } from './noise.js';

export class Fishing {
  constructor(scene, boat, lake, rtp, hud, wallet) {
    this.scene = scene;
    this.boat = boat;
    this.lake = lake;
    this.rtp = rtp;
    this.hud = hud;
    this.wallet = wallet;      // { balance }

    this.lureIndex = 0;

    // Trawl state
    this.trawlDistAcc = 0;     // meters since last catch roll
    this.trawlCostAcc = 0;     // $ wagered since last catch roll (= the microbet stake)
    this.trawlNextCatch = this.rollTrawlInterval();
    this.trawlCostRemainder = 0;
    this.lastPos = new THREE.Vector2(boat.pos.x, boat.pos.z);

    // Cast state machine: idle | flying | out
    this.castState = 'idle';
    this.castTimer = 0;
    this.willCatch = false;    // rolled when the lure lands
    this.biteTimer = 0;
    this.biting = false;
    this.nibbling = 0;         // >0 while a teaser nibble dunks the bobber
    this.nibbles = 0;
    this.hooked = false;
    this.escapeTimer = 0;
    this.pendingPull = 0;      // meters of line queued by reel swipes
    this.reelVel = 0;          // current smoothed reel speed
    this.castWager = 0;
    this.castDistTotal = 0;
    this.castHotness = 0;
    this.driftAngle = 0;
    this.bobberPos = new THREE.Vector3();
    this.castStart = new THREE.Vector3();
    this.castTarget = new THREE.Vector3();

    this.bobber = this.makeBobber();
    this.line = this.makeLine();
    this.rodTipWorld = new THREE.Vector3();
  }

  get lure() { return LURES[this.lureIndex]; }
  setLure(i) { this.lureIndex = clamp(i, 0, LURES.length - 1); }

  rollTrawlInterval() {
    return CONFIG.TRAWL_CATCH_MIN_M +
      Math.random() * (CONFIG.TRAWL_CATCH_MAX_M - CONFIG.TRAWL_CATCH_MIN_M);
  }

  makeBobber() {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0xe33d2e, roughness: 0.3 }));
    top.position.y = 0.08;
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0xf7f3e8, roughness: 0.3 }));
    bottom.position.y = -0.06;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 6),
      new THREE.MeshStandardMaterial({ color: 0xf7f3e8, roughness: 0.4 }));
    stem.position.y = 0.26;
    g.add(top, bottom, stem);
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  makeLine() {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xf5f5f5, transparent: true, opacity: 0.65 }));
    line.visible = false;
    line.frustumCulled = false;
    this.scene.add(line);
    return line;
  }

  // ---------- Trawling ----------
  toggleTrawl() {
    if (this.castState !== 'idle') {
      this.hud.hint('Reel in before trawling');
      return;
    }
    if (!this.boat.trawling && this.wallet.balance <= 0) {
      this.hud.hint('No funds to trawl');
      return;
    }
    this.boat.setTrawling(!this.boat.trawling);
    this.hud.setTrawling(this.boat.trawling);
    if (this.boat.trawling) {
      this.trawlDistAcc = 0;
      this.trawlCostAcc = 0;
      this.trawlNextCatch = this.rollTrawlInterval();
      this.hud.hint(`Trawling — $${CONFIG.TRAWL_COST_PER_M.toFixed(2)}/m`);
    } else {
      this.hud.hint('Net stowed');
    }
  }

  updateTrawl(dt) {
    const p = this.boat.pos;
    const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.y);
    this.lastPos.set(p.x, p.z);
    if (!this.boat.trawling || moved <= 0.001) return;

    // Pay per meter; this accumulates the current microbet's stake.
    const cost = moved * CONFIG.TRAWL_COST_PER_M + this.trawlCostRemainder;
    const spend = Math.min(cost, this.wallet.balance);
    this.trawlCostRemainder = 0;
    if (spend > 0) {
      this.wallet.balance -= spend;
      this.rtp.wager(spend);
      this.trawlCostAcc += spend;
    }
    if (this.wallet.balance <= 0) {
      this.boat.setTrawling(false);
      this.hud.setTrawling(false);
      this.hud.hint('Out of funds — net stowed');
      return;
    }

    this.trawlDistAcc += moved;
    if (this.trawlDistAcc >= this.trawlNextCatch) {
      this.resolveTrawlCatch();
      this.trawlDistAcc = 0;
      this.trawlCostAcc = 0;
      this.trawlNextCatch = this.rollTrawlInterval();
    }
  }

  // One trawl microbet: payout drawn against the stake accrued since the
  // last event, split across 1-3 fish. Position never matters.
  resolveTrawlCatch() {
    const stake = this.trawlCostAcc;
    if (stake <= 0) return;
    const payout = this.rtp.samplePayout(stake);

    const n = CONFIG.TRAWL_FISH_MIN +
      Math.floor(Math.random() * (CONFIG.TRAWL_FISH_MAX - CONFIG.TRAWL_FISH_MIN + 1));
    // Random split of the payout across the haul.
    const cuts = Array.from({ length: n }, () => 0.25 + Math.random());
    const cutSum = cuts.reduce((a, b) => a + b, 0);

    const catches = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const part = payout * (cuts[i] / cutSum);
      const maxTier = Math.random() < CONFIG.TRAWL_RARE_TIER_CHANCE ? 2 : CONFIG.TRAWL_MAX_TIER;
      const c = this.rtp.describeCatch(part, 0, maxTier);
      catches.push(c);
      total += c.value;
    }
    this.rtp.book(total);
    this.wallet.balance += total;
    this.hud.showTrawlHaul(catches, total);
    const best = catches.reduce((a, b) => (b.value > a.value ? b : a));
    if (best.value >= CONFIG.BIGCATCH_MIN_VALUE) this.hud.showBigCatch(best);
  }

  // ---------- Casting / reeling ----------
  /** Every swipe routes here: cast when idle, reel when the line is out. */
  onSwipe(s) {
    if (this.castState === 'idle') this.cast(s);
    else if (this.castState === 'out') this.reelPull(s.power);
  }

  cast(s) {
    if (this.boat.trawling) { this.hud.hint('Stow the net to cast'); return false; }
    if (this.boat.speed >= CONFIG.CAST_MAX_SPEED) { this.hud.hint('Stop the boat to cast'); return false; }
    const cost = this.lure.cost;
    if (this.wallet.balance < cost) {
      this.hud.hint(`Need $${cost} to land a fish on the ${this.lure.name}`);
      return false;
    }

    const dirLen = Math.hypot(s.x, s.z) || 1;
    const dir = new THREE.Vector3(s.x / dirLen, 0, s.z / dirLen);
    const dist = CONFIG.CAST_MIN_DIST + s.power * (CONFIG.CAST_MAX_DIST - CONFIG.CAST_MIN_DIST);
    const target = new THREE.Vector3().copy(this.boat.pos).addScaledVector(dir, dist);
    target.y = CONFIG.WATER_LEVEL;
    if (waterDepth(target.x, target.z) < 0.3) {
      this.hud.hint('That would land on shore!');
      return false;
    }

    // No money moves yet — the bet is placed only if a fish is landed.
    this.castWager = cost;
    this.castDistTotal = dist;
    this.castTarget.copy(target);
    this.boat.rodTip.getWorldPosition(this.castStart);
    this.castState = 'flying';
    this.castTimer = 0;
    this.biting = false;
    this.nibbling = 0;
    this.nibbles = 0;
    this.hooked = false;
    this.pendingPull = 0;
    this.reelVel = 0;
    this.driftAngle = Math.random() * Math.PI * 2;
    this.bobber.visible = true;
    this.bobber.rotation.set(0, 0, 0);
    this.line.visible = true;
    this.boat.nudgeHeading(Math.atan2(-dir.x, -dir.z), 0.35);
    return true;
  }

  reelPull(power) {
    const pull = (this.castDistTotal / CONFIG.REEL_SWIPES) * (0.7 + 0.6 * power);
    this.pendingPull += pull;
    if (this.biting && !this.hooked) {
      this.hooked = true;
      this.biting = false;
      this.escapeTimer = CONFIG.HOOK_ESCAPE_S;
      this.hud.setBite(false);
      this.hud.hint('Fish on! Keep swiping to reel it in!', 3000);
      if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    } else if (this.hooked) {
      this.escapeTimer = CONFIG.HOOK_ESCAPE_S;
    }
  }

  scheduleBite() {
    const speedup = 1 + this.castHotness * (CONFIG.HOTSPOT_BITE_BOOST - 1);
    this.biteTimer = (CONFIG.BITE_MIN_S +
      Math.random() * (CONFIG.BITE_MAX_S - CONFIG.BITE_MIN_S)) / speedup;
  }

  /** The fish reached the boat: place the bet and pay out. */
  landCatch() {
    const cost = this.castWager;
    this.wallet.balance -= cost;
    this.rtp.wager(cost);
    const c = this.rtp.resolveBet(cost, 0, this.lure.tiers[1]);
    this.rtp.book(c.value);
    this.wallet.balance += c.value;
    this.hud.showCatch(c, cost);
    if (c.value >= CONFIG.BIGCATCH_MIN_VALUE || c.species.tier >= 4) {
      this.hud.showBigCatch(c);
    }
    this.endCast();
  }

  endCast() {
    this.castState = 'idle';
    this.biting = false;
    this.nibbling = 0;
    this.hooked = false;
    this.pendingPull = 0;
    this.reelVel = 0;
    this.bobber.visible = false;
    this.line.visible = false;
    this.hud.setBite(false);
  }

  updateCast(dt, t) {
    if (this.castState === 'idle') return;
    this.castTimer += dt;
    this.boat.rodTip.getWorldPosition(this.rodTipWorld);

    if (this.castState === 'flying') {
      const T = 0.65;
      const k = Math.min(1, this.castTimer / T);
      this.bobberPos.lerpVectors(this.castStart, this.castTarget, k);
      this.bobber.position.copy(this.bobberPos);
      this.bobber.position.y = CONFIG.WATER_LEVEL +
        this.castStart.y * (1 - k) + Math.sin(k * Math.PI) * 3.0;
      if (k >= 1) {
        this.castState = 'out';
        this.castTimer = 0;
        this.bobberPos.y = CONFIG.WATER_LEVEL;
        // The catch roll happens NOW, before any bites: hotspots raise the
        // odds a fish shows up, but never what it pays.
        this.castHotness = this.lake.hotness(this.bobberPos.x, this.bobberPos.z);
        const chance = lerp(CONFIG.CAST_CATCH_CHANCE, CONFIG.HOTSPOT_CATCH_CHANCE,
          clamp(this.castHotness, 0, 1));
        this.willCatch = Math.random() < chance;
        this.scheduleBite();
        if (this.castHotness > 0.3) this.hud.hint('Fish activity here — good spot!');
        else this.hud.hint('Line out — swipe to reel', 3000);
      }
      this.updateLine();
      return;
    }

    // --- state: 'out' ---
    const toRod = new THREE.Vector3(
      this.rodTipWorld.x - this.bobberPos.x, 0, this.rodTipWorld.z - this.bobberPos.z);
    let lineOut = toRod.length();
    toRod.normalize();

    // Smooth reeling: speed eases up when a pull lands and eases out as the
    // queued pull runs dry, so each swipe reads as one fluid crank.
    const targetVel = this.pendingPull > 0.02
      ? Math.min(CONFIG.REEL_SPEED, 1.5 + this.pendingPull * 2.2)
      : 0;
    this.reelVel += (targetVel - this.reelVel) * Math.min(1, 5.5 * dt);
    if (this.reelVel > 0.02 && lineOut > 0.01) {
      const step = Math.min(this.reelVel * dt, lineOut);
      this.bobberPos.addScaledVector(toRod, step);
      this.pendingPull = Math.max(0, this.pendingPull - step);
      lineOut -= step;
      // Dragging the lure resets any imminent bite.
      if (!this.hooked) this.biteTimer = Math.max(this.biteTimer, 0.8);
    } else if (!this.hooked && this.reelVel < 0.3) {
      // Idle drift: the bobber wanders gently with the water.
      this.driftAngle += Math.sin(t * 0.4 + this.driftAngle) * 0.25 * dt;
      const nx = this.bobberPos.x + Math.cos(this.driftAngle) * 0.14 * dt;
      const nz = this.bobberPos.z + Math.sin(this.driftAngle) * 0.14 * dt;
      if (waterDepth(nx, nz) > 0.3) { this.bobberPos.x = nx; this.bobberPos.z = nz; }
      else this.driftAngle += Math.PI / 2;
    }

    if (this.hooked) {
      if (this.pendingPull <= 0 && lineOut > 2) {
        const away = new THREE.Vector3(
          this.bobberPos.x - this.rodTipWorld.x, 0, this.bobberPos.z - this.rodTipWorld.z).normalize();
        this.bobberPos.addScaledVector(away, CONFIG.HOOK_PULL_SPEED * dt);
      }
      this.escapeTimer -= dt;
      if (this.escapeTimer <= 0) {
        this.hud.hint('It got away…');
        this.endCast();
        return;
      }
      this.bobber.position.set(
        this.bobberPos.x + Math.sin(t * 17) * 0.12,
        CONFIG.WATER_LEVEL - 0.12 + Math.sin(t * 23) * 0.08,
        this.bobberPos.z + Math.cos(t * 15) * 0.12);
    } else {
      const wave = this.lake.waveHeight(this.bobberPos.x, this.bobberPos.z, t);
      if (this.biting) {
        this.bobber.position.set(this.bobberPos.x,
          CONFIG.WATER_LEVEL - 0.18 + Math.sin(t * 22) * 0.1, this.bobberPos.z);
        this.biteTimer -= dt;
        if (this.biteTimer <= 0) {
          this.biting = false;
          this.hud.setBite(false);
          this.scheduleBite();
        }
      } else if (this.nibbling > 0) {
        // Teaser dunk — no hook behind it.
        this.nibbling -= dt;
        this.bobber.position.set(this.bobberPos.x,
          CONFIG.WATER_LEVEL - 0.08 + Math.sin(t * 18) * 0.05, this.bobberPos.z);
      } else {
        // Calm water: ride the waves with a lazy roll.
        this.bobber.position.set(this.bobberPos.x,
          CONFIG.WATER_LEVEL + 0.05 + wave * 0.8, this.bobberPos.z);
        this.bobber.rotation.set(
          Math.sin(t * 1.1 + this.driftAngle) * 0.12, 0,
          Math.sin(t * 0.9 + this.driftAngle * 2) * 0.14);
        this.biteTimer -= dt;
        if (this.biteTimer <= 0) {
          if (this.willCatch) {
            this.biting = true;
            this.biteTimer = CONFIG.BITE_WINDOW_S;
            this.hud.setBite(true);
            if (navigator.vibrate) navigator.vibrate(80);
          } else {
            this.nibbling = 0.45;
            this.nibbles++;
            this.scheduleBite();
            if (this.nibbles === 1) this.hud.hint('Just a nibble…');
            else if (this.nibbles >= 2) this.hud.hint('Nothing committing here — swipe to reel in');
          }
        }
      }
      if (this.castTimer > CONFIG.CAST_TIMEOUT_S) {
        this.hud.hint('The lure came back untouched — no charge');
        this.endCast();
        return;
      }
    }

    // Landed? (bobber wound all the way back to the boat)
    if (lineOut < 1.4) {
      if (this.hooked) this.landCatch();
      else { this.hud.hint('Reeled in — no bet, no charge'); this.endCast(); }
      return;
    }
    // Drove off with the line out.
    if (lineOut > CONFIG.LINE_SNAP_DIST) {
      this.hud.hint('The line snapped!');
      this.endCast();
      return;
    }

    this.updateLine();
  }

  updateLine() {
    const pts = this.line.geometry.attributes.position;
    pts.setXYZ(0, this.rodTipWorld.x, this.rodTipWorld.y, this.rodTipWorld.z);
    pts.setXYZ(1, this.bobber.position.x, this.bobber.position.y + 0.1, this.bobber.position.z);
    pts.needsUpdate = true;
  }

  update(dt, t) {
    this.updateTrawl(dt);
    this.updateCast(dt, t);
  }
}
