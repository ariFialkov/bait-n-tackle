// The Seiner's tender: a small cuddy that rides on the aft deck under the
// crane. Launch it and you can either take the helm yourself — it draws
// less water, so it slips into channels the seiner cannot enter — or stake
// it with bait and send it out fishing on its own.
//
// RTP: the tender's autonomous fishing uses exactly the same isolated-bet
// resolution as the player (same catch chance, same paytable, stake charged
// only when a fish is actually landed). It is a second pair of hands, never
// better odds.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG, LURES } from './config.js';
import { waterDepth } from './lake.js';
import { boatModelURL, rodMounts } from './boats.js';
import { applySkin } from './skinner.js';
import { clamp } from './noise.js';

const loader = new GLTFLoader();
let hullPromise = null;

// The tender floats shallower than any mother ship.
const TENDER_MIN_DEPTH = 0.3;
const AUTO_CAST_EVERY = 3.2;     // seconds between autonomous attempts
const HOME_RADIUS = 9;           // close enough to the seiner to hand over

function navigable(x, z) { return waterDepth(x, z) >= TENDER_MIN_DEPTH; }

export class Tender {
  constructor(scene, lake, rtp, player, hud) {
    this.scene = scene;
    this.lake = lake;
    this.rtp = rtp;
    this.player = player;
    this.hud = hud;

    this.state = 'stowed';        // stowed | manual | auto
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.trawling = false;        // tenders never trawl
    this.rods = [];
    this.hullBounds = null;
    this.spec = null;
    this.loaded = false;

    // autonomous run
    this.budget = 0;
    this.spent = 0;
    this.catches = [];
    this.castTimer = 0;
    this.wander = Math.random() * Math.PI * 2;
    this.lureIndex = 0;

    this._v = new THREE.Vector3();
    this.lineFx = this.buildLineFx();
  }

  buildLineFx() {
    const geo = new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xf5f5f5, transparent: true, opacity: 0.6 }));
    line.visible = false;
    line.frustumCulled = false;
    this.scene.add(line);
    const bob = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xe33d2e, roughness: 0.35 }));
    bob.visible = false;
    this.scene.add(bob);
    return { line, bob, timer: 0 };
  }

  /** Build the hull + rods for a mother ship's tender definition. */
  async prepare(def, motherSpec) {
    this.spec = {
      id: 'tender',
      name: 'Tender',
      rods: def.rods,
      length: def.length,
      maxSpeed: 7.6,
      accel: 9.2,
      drag: 1.5,
      turn: 4.2,
      features: {},           // no trawl, no pots — it is a runabout
    };
    // Already built: just repaint if the mother ship changed skin.
    if (this.loaded) {
      if (motherSpec && motherSpec.paint && this.paintedFor !== motherSpec.skinId) {
        this.paintedFor = motherSpec.skinId;
        for (const child of this.group.children) {
          if (child.isMesh || child.isGroup) {
            applySkin(child, {
              hullId: `tender-${def.model}`, skinId: motherSpec.skinId, paint: motherSpec.paint,
            });
          }
        }
      }
      return;
    }
    this.paintedFor = motherSpec && motherSpec.skinId;

    if (!hullPromise) hullPromise = loader.loadAsync(boatModelURL(def.model));
    let hull;
    try {
      hull = (await hullPromise).scene.clone(true);
    } catch {
      hull = new THREE.Mesh(
        new THREE.BoxGeometry(def.length * 0.34, def.length * 0.16, def.length),
        new THREE.MeshStandardMaterial({ color: 0xdfeaf2, roughness: 0.6 }));
    }
    // Paint the tender to match its mother ship, so they read as a set.
    if (motherSpec && motherSpec.paint) {
      applySkin(hull, {
        hullId: `tender-${def.model}`, skinId: motherSpec.skinId, paint: motherSpec.paint,
      });
    }
    const box = new THREE.Box3().setFromObject(hull);
    const scale = def.length / Math.max(0.001, box.max.z - box.min.z);
    hull.scale.setScalar(scale);
    hull.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.group.add(hull);

    const b2 = new THREE.Box3().setFromObject(hull);
    this.hullBounds = {
      halfBeam: (b2.max.x - b2.min.x) / 2,
      deckY: Math.max(0.2, b2.max.y * 0.25),
      length: b2.max.z - b2.min.z,
    };

    // A short rod at each mount so the tender reads as a fishing boat.
    for (const m of rodMounts(this.spec, this.hullBounds)) {
      const rod = new THREE.Group();
      const blank = new THREE.Mesh(
        new THREE.CylinderGeometry(0.01, 0.025, 1.9, 5),
        new THREE.MeshStandardMaterial({ color: 0x40342c, roughness: 0.6 }));
      blank.position.y = 0.95;
      rod.add(blank);
      const tip = new THREE.Object3D();
      tip.position.y = 1.9;
      rod.add(tip);
      rod.position.set(m.x, m.y, m.z);
      rod.rotation.set(-0.7, 0, m.side * 0.42);
      this.group.add(rod);
      this.rods.push({ group: rod, tip, side: m.side });
    }
    this.loaded = true;
  }

  get deployed() { return this.state !== 'stowed'; }

  /** The tender carries no trawl gear; this exists so vessel swaps are safe. */
  setTrawling() { this.trawling = false; }

  /** Drop the tender in the water beside the mother ship. */
  launch(mother) {
    const side = new THREE.Vector3(
      Math.cos(mother.heading), 0, -Math.sin(mother.heading));
    const beam = (mother.hullBounds?.halfBeam ?? 3) + 3.5;
    for (const dir of [1, -1]) {
      const x = mother.pos.x + side.x * beam * dir;
      const z = mother.pos.z + side.z * beam * dir;
      if (navigable(x, z)) {
        this.pos.set(x, 0, z);
        this.vel.set(0, 0, 0);
        this.heading = mother.heading;
        this.state = 'manual';
        this.group.visible = true;
        return true;
      }
    }
    return false;
  }

  stow() {
    this.state = 'stowed';
    this.group.visible = false;
    this.lineFx.line.visible = false;
    this.lineFx.bob.visible = false;
    this.budget = 0;
    this.spent = 0;
    this.catches = [];
  }

  /** Send the tender off on its own with a bait budget. */
  sendOut(budget, lureIndex) {
    this.budget = budget;
    this.spent = 0;
    this.catches = [];
    this.lureIndex = lureIndex;
    this.castTimer = AUTO_CAST_EVERY;
    this.state = 'auto';
  }

  get remaining() { return Math.max(0, this.budget - this.spent); }

  /** Distance home, for the HUD and the return leg. */
  distanceTo(mother) {
    return Math.hypot(mother.pos.x - this.pos.x, mother.pos.z - this.pos.z);
  }

  rodTipWorld(i, out) {
    const rod = this.rods[Math.min(i, this.rods.length - 1)];
    if (!rod) return out.set(this.pos.x, 1.2, this.pos.z);
    return rod.tip.getWorldPosition(out);
  }

  nudgeHeading(target, amount) {
    let d = target - this.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.heading += d * amount;
  }

  // --- autonomous behaviour ------------------------------------------------

  /** One autonomous fishing attempt — identical economics to a player cast. */
  autoFish() {
    const lure = LURES[this.lureIndex];
    if (this.remaining < lure.cost) return;
    if (this.player.balance < lure.cost) return; // cannot cover the stake

    // Same roll the player gets: hotspots change frequency, never value.
    const spot = this.lake.hotspotAt(this.pos.x, this.pos.z);
    const hotness = spot ? spot.hotness : 0;
    const match = spot && spot.hotspot.lureId === lure.id ? 1 : 0.45;
    const chance = CONFIG.CAST_CATCH_CHANCE +
      (CONFIG.HOTSPOT_CATCH_CHANCE - CONFIG.CAST_CATCH_CHANCE) * clamp(hotness * match, 0, 1);

    // Show a line going out either way.
    this.lineFx.timer = 1.1;
    const ang = Math.random() * Math.PI * 2;
    const d = 6 + Math.random() * 9;
    this.lineFx.bob.position.set(
      this.pos.x + Math.cos(ang) * d, 0.05, this.pos.z + Math.sin(ang) * d);

    if (Math.random() >= chance) return;          // nothing took — free

    // A fish is landed: the stake is placed now, exactly as for the player —
    // charged against real cash, drawn from the run's budget.
    this.spent += lure.cost;
    this.player.balance -= lure.cost;
    this.rtp.wager(lure.cost);
    const c = this.rtp.resolveBet(lure.cost, 0, lure.tiers[1]);
    this.rtp.book(c.value);
    // Paid the instant it is landed rather than carried home, so a run that
    // is interrupted (quitting, recalling, a dead battery) can never destroy
    // value the player has already staked for.
    this.player.bank(c);
    this.catches.push(c);
  }

  /** The run is over when either the bait budget or the cash runs out. */
  get runDone() {
    const cost = LURES[this.lureIndex].cost;
    return this.remaining < cost || this.player.balance < cost;
  }

  steerAuto(dt, mother) {
    const goingHome = this.runDone;
    let wantX, wantZ;
    if (goingHome) {
      wantX = mother.pos.x - this.pos.x;
      wantZ = mother.pos.z - this.pos.z;
    } else {
      // Wander, biased toward the nearest hotspot if there is one in range.
      const near = this.lake.hotspotsNear(this.pos.x, this.pos.z, 70)[0];
      this.wander += (Math.random() - 0.5) * 1.4 * dt;
      wantX = Math.cos(this.wander);
      wantZ = Math.sin(this.wander);
      if (near && near.dist > 6) {
        const hx = near.hotspot.x - this.pos.x, hz = near.hotspot.z - this.pos.z;
        const hl = Math.hypot(hx, hz) || 1;
        wantX = wantX * 0.35 + (hx / hl) * 0.65;
        wantZ = wantZ * 0.35 + (hz / hl) * 0.65;
      }
      // Never stray so far that it cannot get back.
      const away = this.distanceTo(mother);
      if (away > 120) {
        wantX = mother.pos.x - this.pos.x;
        wantZ = mother.pos.z - this.pos.z;
      }
    }
    // Steer off shallows.
    const probeX = this.pos.x + Math.sin(this.heading) * 5;
    const probeZ = this.pos.z + Math.cos(this.heading) * 5;
    if (!navigable(probeX, probeZ)) {
      this.wander += 2.2 * dt;
      wantX = Math.cos(this.wander);
      wantZ = Math.sin(this.wander);
    }
    const l = Math.hypot(wantX, wantZ) || 1;
    return { x: wantX / l, z: wantZ / l };
  }

  /** Report on the run. The catch itself was banked as it was landed. */
  deliver() {
    const n = this.catches.length;
    const value = this.catches.reduce((a, c) => a + c.value, 0);
    let best = null;
    for (const c of this.catches) {
      if (!best || c.value > best.value) best = c;
    }
    const spent = this.spent;
    this.catches = [];
    this.budget = 0;
    this.spent = 0;
    this.state = 'manual';
    this.hud.showTenderReport({ n, value, spent, best });
    if (best && best.value >= CONFIG.BIGCATCH_MIN_VALUE) this.hud.showBigCatch(best);
  }

  // --- per-frame -----------------------------------------------------------

  update(dt, t, moveVec, mother) {
    if (!this.deployed) return;

    const s = this.spec;
    let move = moveVec;
    if (this.state === 'auto') {
      move = this.steerAuto(dt, mother);

      this.castTimer -= dt;
      if (this.castTimer <= 0) {
        this.castTimer = AUTO_CAST_EVERY;
        if (this.remaining >= LURES[this.lureIndex].cost) this.autoFish();
      }
      // Run finished and back alongside: report in.
      if (this.runDone && this.distanceTo(mother) <= HOME_RADIUS) this.deliver();
    }

    if (Math.hypot(move.x, move.z) > 0.05) {
      this.vel.x += move.x * s.accel * dt;
      this.vel.z += move.z * s.accel * dt;
    }
    const drag = Math.exp(-s.drag * dt);
    this.vel.x *= drag; this.vel.z *= drag;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > s.maxSpeed) { this.vel.x *= s.maxSpeed / sp; this.vel.z *= s.maxSpeed / sp; }
    this.speed = Math.min(sp, s.maxSpeed);

    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    if (navigable(nx, this.pos.z)) this.pos.x = nx; else this.vel.x *= -0.2;
    if (navigable(this.pos.x, nz)) this.pos.z = nz; else this.vel.z *= -0.2;

    if (this.speed > 0.25) {
      const target = Math.atan2(-this.vel.x, -this.vel.z);
      let d = target - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.heading += d * Math.min(1, s.turn * dt);
    }

    const bob = this.lake.waveHeight(this.pos.x, this.pos.z, t);
    this.group.position.set(this.pos.x, bob + 0.02, this.pos.z);
    this.group.rotation.set(
      Math.sin(t * 1.1) * 0.03, this.heading, Math.sin(t * 1.4) * 0.035);

    // Autonomous line FX
    const fx = this.lineFx;
    if (fx.timer > 0) {
      fx.timer -= dt;
      this.rodTipWorld(0, this._v);
      fx.bob.position.y = 0.05 + Math.sin(t * 9) * 0.06;
      const p = fx.line.geometry.attributes.position;
      p.setXYZ(0, this._v.x, this._v.y, this._v.z);
      p.setXYZ(1, fx.bob.position.x, fx.bob.position.y, fx.bob.position.z);
      p.needsUpdate = true;
      fx.line.visible = fx.bob.visible = true;
    } else if (fx.line.visible) {
      fx.line.visible = fx.bob.visible = false;
    }
  }
}
