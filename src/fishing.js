// Fishing mechanics: trawling (distance-priced net dragging) and casting
// (lure-priced single shots). Catch values come from the RTP engine.
//
// Casting flow: swipe in any direction to cast that way (swipe length +
// speed set the distance). Once the line is out, swipe again to reel — each
// swipe winds in a chunk of line, so a long cast takes 2-3 pulls. Swiping
// during a bite sets the hook; keep pulling to bring the fish to the boat.

import * as THREE from 'three';
import { CONFIG, LURES } from './config.js';
import { waterDepth } from './lake.js';
import { clamp } from './noise.js';

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
    this.trawlCostAcc = 0;     // $ wagered since last catch roll
    this.trawlNextCatch = this.rollTrawlInterval();
    this.trawlCostRemainder = 0;
    this.lastPos = new THREE.Vector2(boat.pos.x, boat.pos.z);

    // Cast state machine: idle | flying | out
    this.castState = 'idle';
    this.castTimer = 0;        // time in current state
    this.biteTimer = 0;        // countdown to next bite while waiting
    this.biting = false;
    this.hooked = false;
    this.escapeTimer = 0;
    this.pendingPull = 0;      // meters of line queued by reel swipes
    this.castWager = 0;
    this.castDistTotal = 0;
    this.castHotness = 0;
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

    // Book the wager per meter moved.
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

  resolveTrawlCatch() {
    const n = CONFIG.TRAWL_FISH_MIN +
      Math.floor(Math.random() * (CONFIG.TRAWL_FISH_MAX - CONFIG.TRAWL_FISH_MIN + 1));
    const perFish = Math.max(0.05, this.trawlCostAcc / n);
    const catches = [];
    for (let i = 0; i < n; i++) {
      const maxTier = Math.random() < CONFIG.TRAWL_RARE_TIER_CHANCE ? 2 : CONFIG.TRAWL_MAX_TIER;
      const c = this.rtp.resolveCatch(perFish, 0, maxTier, { allowMiss: i > 0 });
      if (c) catches.push(c);
    }
    let total = 0;
    for (const c of catches) { total += c.value; this.rtp.book(c.value); }
    this.wallet.balance += total;
    if (catches.length) this.hud.showTrawlHaul(catches, total);
    else this.hud.hint('Empty net…');
  }

  // ---------- Casting / reeling ----------
  /** Every swipe routes here: cast when idle, reel when the line is out. */
  onSwipe(s) {
    if (this.castState === 'idle') this.cast(s);
    else if (this.castState === 'out') this.reelPull(s.power);
    // 'flying': ignore swipes while the lure is in the air
  }

  cast(s) {
    if (this.boat.trawling) { this.hud.hint('Stow the net to cast'); return false; }
    if (this.boat.speed >= CONFIG.CAST_MAX_SPEED) { this.hud.hint('Stop the boat to cast'); return false; }
    const cost = this.lure.cost;
    if (this.wallet.balance < cost) {
      this.hud.hint(`Need $${cost} for a ${this.lure.name}`);
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

    this.wallet.balance -= cost;
    this.rtp.wager(cost);
    this.castWager = cost;
    this.castDistTotal = dist;
    this.castTarget.copy(target);
    this.boat.rodTip.getWorldPosition(this.castStart);
    this.castState = 'flying';
    this.castTimer = 0;
    this.biting = false;
    this.hooked = false;
    this.pendingPull = 0;
    this.bobber.visible = true;
    this.line.visible = true;
    // Swing the boat's nose toward the cast a touch for feel.
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
    this.castHotness = this.lake.hotness(this.bobberPos.x, this.bobberPos.z);
    const speedup = 1 + this.castHotness * (CONFIG.HOTSPOT_BITE_BOOST - 1);
    this.biteTimer = (CONFIG.BITE_MIN_S +
      Math.random() * (CONFIG.BITE_MAX_S - CONFIG.BITE_MIN_S)) / speedup;
  }

  landCatch() {
    const boost = 1 + this.castHotness * (CONFIG.HOTSPOT_VALUE_BOOST - 1);
    const c = this.rtp.resolveCatch(
      this.castWager, this.lure.tiers[0], this.lure.tiers[1], { valueBoost: boost });
    if (c) {
      this.rtp.book(c.value);
      this.wallet.balance += c.value;
      this.hud.showCatch(c, this.castWager);
    } else {
      this.hud.hint('It shook the hook at the boat!');
    }
    this.endCast();
  }

  endCast() {
    this.castState = 'idle';
    this.biting = false;
    this.hooked = false;
    this.pendingPull = 0;
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

    // Reel queued line in, smoothly.
    if (this.pendingPull > 0 && lineOut > 0.01) {
      const step = Math.min(this.pendingPull, CONFIG.REEL_SPEED * dt, lineOut);
      this.bobberPos.addScaledVector(toRod.normalize(), step);
      this.pendingPull -= step;
      lineOut -= step;
      // Reeling drags the lure — a bite can't start mid-pull.
      this.biteTimer = Math.max(this.biteTimer, 0.8);
    }

    if (this.hooked) {
      // Fish takes line back out and will escape if you stop reeling.
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
      // Fighting fish: bobber thrashes.
      this.bobber.position.set(
        this.bobberPos.x + Math.sin(t * 17) * 0.12,
        CONFIG.WATER_LEVEL - 0.12 + Math.sin(t * 23) * 0.08,
        this.bobberPos.z + Math.cos(t * 15) * 0.12);
    } else {
      if (this.biting) {
        // Bobber dunks during the bite window.
        this.bobber.position.set(this.bobberPos.x,
          CONFIG.WATER_LEVEL - 0.18 + Math.sin(t * 22) * 0.1, this.bobberPos.z);
        this.biteTimer -= dt;
        if (this.biteTimer <= 0) {
          this.biting = false;
          this.hud.setBite(false);
          this.scheduleBite();
        }
      } else {
        this.bobber.position.set(this.bobberPos.x,
          CONFIG.WATER_LEVEL + 0.05 +
          this.lake.waveHeight(this.bobberPos.x, this.bobberPos.z, t) * 0.6,
          this.bobberPos.z);
        this.biteTimer -= dt;
        if (this.biteTimer <= 0) {
          this.biting = true;
          this.biteTimer = CONFIG.BITE_WINDOW_S;
          this.hud.setBite(true);
          if (navigator.vibrate) navigator.vibrate(80);
        }
      }
      if (this.castTimer > CONFIG.CAST_TIMEOUT_S) {
        this.hud.hint('The lure came back empty…');
        this.endCast();
        return;
      }
    }

    // Landed? (bobber wound all the way back to the boat)
    if (lineOut < 1.4) {
      if (this.hooked) this.landCatch();
      else { this.hud.hint('Reeled in — nothing on the line'); this.endCast(); }
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
