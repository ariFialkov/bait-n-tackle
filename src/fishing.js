// Fishing mechanics: trawling (distance-priced net dragging) and casting
// (lure-priced single shots). Catch values come from the RTP engine.

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
    this.wallet = wallet;      // { balance, add(v), trySpend(v) }

    this.lureIndex = 0;

    // Trawl state
    this.trawlDistAcc = 0;     // meters since last catch roll
    this.trawlCostAcc = 0;     // $ wagered since last catch roll
    this.trawlNextCatch = this.rollTrawlInterval();
    this.trawlCostRemainder = 0;
    this.lastPos = new THREE.Vector2(boat.pos.x, boat.pos.z);

    // Cast state machine: idle | flying | waiting | biting
    this.castState = 'idle';
    this.castTimer = 0;
    this.biteTimer = 0;
    this.castTarget = new THREE.Vector3();
    this.castStart = new THREE.Vector3();
    this.castWager = 0;
    this.castHotness = 0;

    this.bobber = this.makeBobber();
    this.line = this.makeLine();
  }

  get lure() { return LURES[this.lureIndex]; }
  setLure(i) { this.lureIndex = clamp(i, 0, LURES.length - 1); }

  rollTrawlInterval() {
    return CONFIG.TRAWL_CATCH_MIN_M +
      Math.random() * (CONFIG.TRAWL_CATCH_MAX_M - CONFIG.TRAWL_CATCH_MIN_M);
  }

  makeBobber() {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0xe33d2e }));
    top.position.y = 0.08;
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0xf4f0e6 }));
    bottom.position.y = -0.06;
    g.add(top, bottom);
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  makeLine() {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xf5f5f5, transparent: true, opacity: 0.7 }));
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

  // ---------- Casting ----------
  canCast() {
    return this.castState === 'idle' && !this.boat.trawling &&
      this.boat.speed < CONFIG.CAST_MAX_SPEED;
  }

  /** power: 0..1 from the swipe */
  cast(power) {
    if (!this.canCast()) {
      if (this.boat.trawling) this.hud.hint('Stow the net to cast');
      else if (this.boat.speed >= CONFIG.CAST_MAX_SPEED) this.hud.hint('Stop the boat to cast');
      return false;
    }
    const cost = this.lure.cost;
    if (this.wallet.balance < cost) {
      this.hud.hint(`Need $${cost} for a ${this.lure.name}`);
      return false;
    }

    const dist = CONFIG.CAST_MIN_DIST + power * (CONFIG.CAST_MAX_DIST - CONFIG.CAST_MIN_DIST);
    const dir = new THREE.Vector3(-Math.sin(this.boat.heading), 0, -Math.cos(this.boat.heading));
    const target = new THREE.Vector3().copy(this.boat.pos).addScaledVector(dir, dist);
    target.y = CONFIG.WATER_LEVEL;
    if (waterDepth(target.x, target.z) < 0.3) {
      this.hud.hint('That would land on shore!');
      return false;
    }

    this.wallet.balance -= cost;
    this.rtp.wager(cost);
    this.castWager = cost;
    this.castTarget.copy(target);
    this.castStart.copy(this.boat.pos).setY(1.4);
    this.castState = 'flying';
    this.castTimer = 0;
    this.bobber.visible = true;
    this.line.visible = true;
    this.hud.setCasting(true);
    return true;
  }

  scheduleBite() {
    this.castHotness = this.lake.hotness(this.castTarget.x, this.castTarget.z);
    const speedup = 1 + this.castHotness * (CONFIG.HOTSPOT_BITE_BOOST - 1);
    const delay = (CONFIG.BITE_MIN_S +
      Math.random() * (CONFIG.BITE_MAX_S - CONFIG.BITE_MIN_S)) / speedup;
    this.biteTimer = delay;
    if (this.castHotness > 0.3) this.hud.hint('Fish activity here — good spot!');
  }

  /** Player tapped/clicked to reel. */
  reel() {
    if (this.castState === 'biting') {
      const boost = 1 + this.castHotness * (CONFIG.HOTSPOT_VALUE_BOOST - 1);
      const c = this.rtp.resolveCatch(
        this.castWager, this.lure.tiers[0], this.lure.tiers[1], { valueBoost: boost });
      if (c) {
        this.rtp.book(c.value);
        this.wallet.balance += c.value;
        this.hud.showCatch(c, this.castWager);
      } else {
        this.hud.hint('It got away!');
      }
      this.endCast();
    } else if (this.castState === 'waiting' || this.castState === 'flying') {
      this.hud.hint('Reeled in — nothing yet');
      this.endCast();
    }
  }

  endCast() {
    this.castState = 'idle';
    this.bobber.visible = false;
    this.line.visible = false;
    this.hud.setCasting(false);
    this.hud.setBite(false);
  }

  updateCast(dt, t) {
    if (this.castState === 'idle') return;
    this.castTimer += dt;

    if (this.castState === 'flying') {
      const T = 0.7;
      const k = Math.min(1, this.castTimer / T);
      this.bobber.position.lerpVectors(this.castStart, this.castTarget, k);
      this.bobber.position.y = CONFIG.WATER_LEVEL + 1.4 * (1 - k) + Math.sin(k * Math.PI) * 3.2;
      if (k >= 1) {
        this.castState = 'waiting';
        this.castTimer = 0;
        this.scheduleBite();
      }
    } else if (this.castState === 'waiting') {
      this.bobber.position.y = CONFIG.WATER_LEVEL + 0.05 +
        this.lake.waveHeight(this.castTarget.x, this.castTarget.z, t) * 0.6;
      if (this.castTimer >= this.biteTimer) {
        this.castState = 'biting';
        this.castTimer = 0;
        this.hud.setBite(true);
        if (navigator.vibrate) navigator.vibrate(80);
      } else if (this.castTimer > CONFIG.CAST_TIMEOUT_S) {
        this.hud.hint('The lure came back empty…');
        this.endCast();
      }
    } else if (this.castState === 'biting') {
      // Bobber dunks rapidly during the bite window.
      this.bobber.position.y = CONFIG.WATER_LEVEL - 0.18 + Math.sin(t * 22) * 0.1;
      if (this.castTimer > CONFIG.BITE_WINDOW_S) {
        // Missed the window — fish keeps nibbling later.
        this.castState = 'waiting';
        this.castTimer = 0;
        this.hud.setBite(false);
        this.scheduleBite();
      }
    }

    // Line from boat bow to bobber.
    const bow = new THREE.Vector3(
      this.boat.pos.x - Math.sin(this.boat.heading) * 1.8,
      1.2,
      this.boat.pos.z - Math.cos(this.boat.heading) * 1.8);
    const pts = this.line.geometry.attributes.position;
    pts.setXYZ(0, bow.x, bow.y, bow.z);
    pts.setXYZ(1, this.bobber.position.x, this.bobber.position.y + 0.1, this.bobber.position.z);
    pts.needsUpdate = true;
  }

  update(dt, t) {
    this.updateTrawl(dt);
    this.updateCast(dt, t);
  }
}
