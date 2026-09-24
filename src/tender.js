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
import { boatModelURL, rodMounts, hullDrag } from './boats.js';
import { buildRod, aimRods, updateRods, castRod } from './rods.js';
import { driveHull, wrapAngle, hullYawRate, steerClear } from './hullphysics.js';
import { WakeTrail } from './wake.js';
import { applySkin } from './skinner.js';
import { clamp } from './noise.js';

const loader = new GLTFLoader();
let hullPromise = null;

// The tender floats shallower than any mother ship.
const TENDER_MIN_DEPTH = 0.15;
// ... but its own helmsman keeps it off the banks: this much water under it
// is the least they will steer for, and shallower is a shore to shy from.
const SAFE_DEPTH = 0.45;
const FEELERS = [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6];   // radians off the wanted course
const STUCK_S = 1.4;             // wanting to go, going nowhere, for this long
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
    // The hull, rods and driver, lifted so the cockpit sole is above water.
    this.hullFrame = new THREE.Group();
    this.group.add(this.hullFrame);
    this.lift = 0;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.yawVel = 0;
    this.trawling = false;        // tenders never trawl
    this.group.rotation.order = 'YXZ';
    this.rods = [];
    this.hullBounds = null;
    this.spec = null;
    this.loaded = false;

    // autonomous run: a bag of baits, one count per lure in LURES
    this.bag = LURES.map(() => 0);
    this.spent = 0;
    this.catches = [];
    this.castTimer = 0;
    this.wander = Math.random() * Math.PI * 2;
    this.lureIndex = 0;

    this.stuckT = 0;              // how long the helmsman has been trying to move and failing
    this.backT = 0;               // time left backing out of a corner
    this.hoist = null;            // on the crane: { kind, step, t, hooked }
    this.eye = new THREE.Vector3(0, 1.2, 0);
    this._v = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._g = new THREE.Vector3();
    this._e = new THREE.Vector3();
    this.lineFx = this.buildLineFx();
    this.wake = new WakeTrail(scene);
    this.wake.setVisible(false);
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
      maxSpeed: 12.2,
      accel: 9.2,
      drag: hullDrag(9.2, 12.2),
      turn: 4.2,
      yawRate: hullYawRate(4.2, def.length),
      features: {},           // no trawl, no pots — it is a runabout
    };
    // Already built: just repaint if the mother ship changed skin.
    if (this.loaded) {
      if (motherSpec && motherSpec.paint && this.paintedFor !== motherSpec.skinId) {
        this.paintedFor = motherSpec.skinId;
        for (const child of this.group.children) {
          if (child.isMesh || child.isGroup) {
            await applySkin(child, {
              hullId: def.model, skinId: `tender-${motherSpec.skinId}`,
              paint: motherSpec.paint, style: motherSpec.style,
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
      // Keyed on the tender's own hull so a camo skin finds its sidecar.
      await applySkin(hull, {
        hullId: def.model, skinId: `tender-${motherSpec.skinId}`,
        paint: motherSpec.paint, style: motherSpec.style,
      });
    }
    const box = new THREE.Box3().setFromObject(hull);
    const scale = def.length / Math.max(0.001, box.max.z - box.min.z);
    hull.scale.setScalar(scale);
    hull.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    // Measured detached, in the hull's own space — see the note in boat.js.
    const b2 = new THREE.Box3().setFromObject(hull);
    this.hullFrame.add(hull);
    this.lift = def.lift ?? 0;
    this.hullFrame.position.y = this.lift;
    // The same hull again, standing in the mother ship's stern well while
    // the tender is aboard (the well is where the model had its own
    // tender, which comes off — boat.js). Parented by the crew director's
    // caller, main.js, onto the mother ship.
    this.stowedModel = hull.clone(true);
    this.stowedModel.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    this.hullBounds = {
      halfBeam: (b2.max.x - b2.min.x) / 2,
      sternZ: b2.max.z,
      minY: b2.min.y,
      maxY: b2.max.y,
      deckY: Math.max(0.2, b2.max.y * 0.25),
      length: b2.max.z - b2.min.z,
    };
    // Where the crane's hook takes it: a lifting eye over the cabin top,
    // in the tender's own frame (the hull sits `lift` up inside the group).
    this.eye = new THREE.Vector3(0, this.lift + b2.max.y * 0.92, 0.1);
    // A runabout creases the surface; it does not throw a seiner's wall of
    // white. Borrow the mother ship's wake stat so the pair look related.
    this.wake.setSpec({ ...this.spec, wake: (motherSpec?.wake ?? 1) * 0.7 },
      this.hullBounds);
    this.wake.setVisible(this.deployed);

    // A short rod at each mount so the tender reads as a fishing boat — the
    // same rod the mother ship carries, raked out over the water.
    // The cockpit sole, where a body stands, in the hull frame.
    const sole = def.sole ?? -0.235;
    for (const m of rodMounts(this.spec, this.hullBounds)) {
      const r = buildRod(m.side, 0.8);
      r.rod.position.set(m.x, m.y, m.z);
      r.rest = r.rod.position.clone();
      r.holdPos.copy(r.rest);
      this.hullFrame.add(r.rod);
      r.rod.updateMatrix();
      const gripRest = r.grip.position.clone().applyMatrix4(r.rod.matrix);
      this.rods.push({ ...r, group: r.rod, pos: r.rod.position.clone(), deckY: sole, gripRest });
    }
    this.loaded = true;
  }

  /** In the water under its own power (or being sent), not aboard or on the hook. */
  get deployed() { return this.state === 'manual' || this.state === 'auto'; }

  /** On the crane, going out or coming in. */
  get hoisting() { return !!this.hoist; }

  // --- the crane -----------------------------------------------------------
  //
  // Launch: the hook comes down onto the tender in the well, takes the
  // weight, lifts it clear of the bulwark, swings it out over the side and
  // lowers it to the water; released, it is a boat. Recovery is the same
  // film backwards, after the tender has come alongside under the hook.
  // The crane itself (crane.js) moves like a machine — one slew, one luff,
  // one wire, each at its own pace — and each step waits for it to settle.

  /** The mother ship's crane and where the well, the hook-up and the drop are. */
  craneFrame(mother) {
    const c = mother.crane, st = mother.stations;
    if (!c || !st?.tenderWell || !this.hullBounds) return null;
    const well = st.tenderWell;
    const keel = -this.hullBounds.minY;
    // The tender's group, in the mother's hull frame, when it stands on
    // the chocks, and when it floats alongside (world y ≈ 0.02).
    const wellGroupY = well.y + keel - this.lift;
    const floatGroupY = mother.hullFrame.worldToLocal(this._v.set(0, 0.02, 0)).y;
    const side = c.side ?? 1;
    const dropX = side * ((mother.hullBounds?.halfBeam ?? 3) + this.hullBounds.halfBeam + 0.8);
    return { well, side, wellGroupY, floatGroupY, dropX, dropZ: well.z, clear: 1.7 };
  }

  /** Start the launch; false if there is no water to put it in on the crane's side. */
  beginLaunch(mother) {
    if (this.state !== 'stowed' || this.hoist) return false;
    const f = this.craneFrame(mother);
    if (!f) return this.launch(mother);          // no crane: the old instant launch
    const drop = mother.hullFrame.localToWorld(this._v.set(f.dropX, 0, f.dropZ));
    if (!navigable(drop.x, drop.z)) return false;
    this.hoist = { kind: 'launch', step: 'hook', t: 0, hooked: false };
    this.state = 'launching';
    if (this.stowedModel) this.stowedModel.visible = false;
    this.group.visible = true;
    this.wake.setVisible(false);
    return true;
  }

  /** Start bringing it back aboard; it comes alongside under the hook first. */
  beginRecover(mother) {
    if (!this.deployed || this.hoist) return false;
    const f = this.craneFrame(mother);
    if (!f) { this.stow(); return true; }
    this.hoist = { kind: 'recover', step: 'approach', t: 0, hooked: false };
    this.state = 'recovering';
    this.wake.setVisible(false);
    this.lineFx.line.visible = false;
    this.lineFx.bob.visible = false;
    this.bag.fill(0);
    this.spent = 0;
    this.catches = [];
    return true;
  }

  updateHoist(dt, t, mother) {
    const h = this.hoist;
    const f = this.craneFrame(mother);
    const crane = mother.crane;
    if (!f || !crane) { this.hoist = null; this.stow(); return; }
    h.t += dt;
    const eye = this.eye;
    const tgt = this._t;
    const grp = this.group;

    // Where the tender's GROUP is wanted this step, in the mother's frame,
    // or null once it hangs from the hook.
    let groupLocal = null;
    let sway = 0;
    const eyeAbove = (gx, gy, gz) => tgt.set(gx + eye.x, gy + eye.y, gz + eye.z);
    if (h.kind === 'launch') {
      if (h.step === 'hook') {
        groupLocal = this._g.set(f.well.x, f.wellGroupY, f.well.z);
        crane.setTarget(eyeAbove(groupLocal.x, groupLocal.y, groupLocal.z));
        if (crane.settled && h.t > 0.4) { h.step = 'lift'; h.hooked = true; }
      } else if (h.step === 'lift') {
        crane.setTarget(eyeAbove(f.well.x, f.wellGroupY + f.clear, f.well.z));
        if (crane.settled) h.step = 'swing';
      } else if (h.step === 'swing') {
        crane.setTarget(eyeAbove(f.dropX, f.wellGroupY + f.clear, f.dropZ));
        if (crane.settled) h.step = 'lower';
      } else if (h.step === 'lower') {
        crane.setTarget(eyeAbove(f.dropX, f.floatGroupY, f.dropZ));
        if (crane.settled) {
          // Let go: a boat again, with the mother's way on it.
          const w = mother.hullFrame.localToWorld(this._v.set(f.dropX, 0, f.dropZ));
          this.pos.set(w.x, 0, w.z);
          this.vel.copy(mother.vel);
          this.heading = mother.heading;
          this.state = 'manual';
          this.hoist = null;
          this.wake.reset();
          this.wake.setVisible(true);
          crane.rest();
          return;
        }
      }
    } else {
      if (h.step === 'approach') {
        // Come alongside under the hook, easing in; the hook comes over to meet it.
        const w = mother.hullFrame.localToWorld(this._v.set(f.dropX, 0, f.dropZ));
        const dx = w.x - this.pos.x, dz = w.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        const step = Math.min(d, (1.2 + d * 1.6) * dt);
        if (d > 1e-4) { this.pos.x += dx / d * step; this.pos.z += dz / d * step; }
        this.heading = wrapAngle(this.heading + wrapAngle(mother.heading - this.heading) * Math.min(1, 2.5 * dt));
        this.vel.copy(mother.vel);
        this.speed = 0;
        const bob = this.lake.waveHeight(this.pos.x, this.pos.z, t);
        grp.position.set(this.pos.x, bob + 0.02, this.pos.z);
        grp.rotation.set(Math.sin(t * 1.1) * 0.03, this.heading, Math.sin(t * 1.4) * 0.035);
        crane.setTarget(eyeAbove(f.dropX, f.floatGroupY, f.dropZ));
        if (d < 0.15 && Math.abs(wrapAngle(mother.heading - this.heading)) < 0.05 && crane.settled) {
          h.step = 'lift'; h.hooked = true;
        }
        this.updateRodsOnly(dt);
        return;
      } else if (h.step === 'lift') {
        crane.setTarget(eyeAbove(f.dropX, f.wellGroupY + f.clear, f.dropZ));
        if (crane.settled) h.step = 'swing';
      } else if (h.step === 'swing') {
        crane.setTarget(eyeAbove(f.well.x, f.wellGroupY + f.clear, f.well.z));
        if (crane.settled) h.step = 'lower';
      } else if (h.step === 'lower') {
        crane.setTarget(eyeAbove(f.well.x, f.wellGroupY, f.well.z));
        if (crane.settled) {
          this.hoist = null;
          this.stow();
          crane.rest();
          return;
        }
      }
    }

    if (h.hooked) {
      // Hanging from the hook: the eye is at the hook, swinging a little.
      sway = Math.sin(t * 1.7) * 0.02 + Math.sin(t * 2.3) * 0.015;
      const hook = crane.hookAt(this._v);
      mother.hullFrame.localToWorld(hook);
      grp.rotation.set(sway, mother.heading, sway * 0.7);
      grp.position.copy(hook).sub(this._e.copy(eye).applyEuler(grp.rotation));
      this.pos.set(grp.position.x, 0, grp.position.z);
      this.heading = mother.heading;
    } else if (groupLocal) {
      // Standing on the chocks while the hook comes down.
      mother.hullFrame.localToWorld(this._v.copy(groupLocal));
      grp.position.copy(this._v);
      grp.rotation.set(mother.group.rotation.x, mother.heading, mother.group.rotation.z);
      this.pos.set(grp.position.x, 0, grp.position.z);
    }
    this.updateRodsOnly(dt);
  }

  updateRodsOnly(dt) { updateRods(this.rods, dt); }

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
        if (this.stowedModel) this.stowedModel.visible = false;
        this.wake.reset();
        this.wake.setVisible(true);
        return true;
      }
    }
    return false;
  }

  /**
   * Put the stowed copy of the hull in the mother ship's well: `at` is
   * {x, y, z} in the mother's hull frame, keel-bottom on the chocks.
   */
  stowOn(mother, at) {
    if (!this.stowedModel) return;
    if (this.stowedModel.parent !== mother.hullFrame) mother.hullFrame.add(this.stowedModel);
    const keel = -(this.hullBounds?.minY ?? 1);
    this.stowedModel.position.set(at.x, at.y + keel, at.z);
    this.stowedModel.visible = !this.deployed;
  }

  stow() {
    this.state = 'stowed';
    this.hoist = null;
    this.group.visible = false;
    if (this.stowedModel) this.stowedModel.visible = true;
    this.wake.setVisible(false);
    this.wake.reset();
    this.lineFx.line.visible = false;
    this.lineFx.bob.visible = false;
    this.bag.fill(0);
    this.spent = 0;
    this.catches = [];
  }

  /**
   * Send the tender off on its own with a bag of baits: `bag[i]` is how
   * many of LURES[i] it carries. A bait is used up only when a fish takes
   * it, and its cost staked then — the same terms as a player's cast.
   */
  sendOut(bag) {
    this.bag = LURES.map((_, i) => Math.max(0, Math.floor(bag[i] || 0)));
    this.spent = 0;
    this.catches = [];
    this.castTimer = AUTO_CAST_EVERY;
    this.state = 'auto';
  }

  /** Stake still in the bag, in cash. */
  get remaining() { return this.bag.reduce((a, n, i) => a + n * LURES[i].cost, 0); }

  /** Baits still in the bag. */
  get baitsLeft() { return this.bag.reduce((a, n) => a + n, 0); }

  /** The next bait to tie on: drawn from the bag, the common ones more often. */
  pickBait() {
    const usable = [];
    for (let i = 0; i < this.bag.length; i++) {
      if (this.bag[i] > 0 && this.player.balance >= LURES[i].cost) usable.push(i);
    }
    if (!usable.length) return -1;
    let total = 0;
    for (const i of usable) total += this.bag[i];
    let r = Math.random() * total;
    for (const i of usable) { r -= this.bag[i]; if (r <= 0) return i; }
    return usable[usable.length - 1];
  }

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
    this.heading = wrapAngle(this.heading + wrapAngle(target - this.heading) * amount);
  }

  /** Point the tender's rods at their lines, exactly as the mother ship does. */
  aimRods(aims) {
    aimRods(this.rods, this.pos, this.heading, aims);
  }

  /** Swing rod `i` through a cast toward a bearing in the tender's frame. */
  castRod(i, yaw) {
    const r = this.rods[Math.min(i, this.rods.length - 1)];
    if (r) castRod(r, yaw);
  }

  // --- the helmsman's eye for the shore -----------------------------------

  /** The least water along a line from here, out to `reach` metres. */
  depthAlong(dx, dz, reach) {
    let least = Infinity;
    for (let d = 2; d <= reach; d += 2) least = Math.min(least, waterDepth(this.pos.x + dx * d, this.pos.z + dz * d));
    return least;
  }

  /**
   * Bend a wanted course away from the shore. Feelers fan out either side
   * of it; the course is turned to the nearest feeler with safe water all
   * the way out, and if none has any, the tender backs off toward the
   * deepest water it can see. A corner it has been pushing into for a
   * while is backed out of the same way.
   */
  shyFromShore(want, dt) {
    const mag = Math.hypot(want.x, want.z);
    if (this.backT > 0) {
      this.backT -= dt;
      return this.backOff();
    }
    // Stuck: trying to go somewhere and not getting there.
    if (mag > 0.25 && this.speed < 0.5) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > STUCK_S) { this.stuckT = 0; this.backT = 1.6; return this.backOff(); }
    if (mag < 0.05) return want;
    const base = Math.atan2(want.z, want.x);
    const reach = 6 + this.speed * 2.5;
    let bestA = null, bestD = -Infinity;
    for (const off of FEELERS) {
      const a = base + off;
      const d = this.depthAlong(Math.cos(a), Math.sin(a), reach);
      if (d >= SAFE_DEPTH) { bestA = a; break; }         // feelers are ordered nearest-first
      if (d > bestD) { bestD = d; bestA = a; }
    }
    if (bestA == null) return want;
    // Hold off the bank as well: a push away from the shallowest side.
    let px = 0, pz = 0;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      const d = waterDepth(this.pos.x + Math.cos(a) * 5, this.pos.z + Math.sin(a) * 5);
      if (d < SAFE_DEPTH) { const w = (SAFE_DEPTH - Math.max(0, d)) / SAFE_DEPTH; px -= Math.cos(a) * w; pz -= Math.sin(a) * w; }
    }
    let x = Math.cos(bestA) * mag + px * 0.6, z = Math.sin(bestA) * mag + pz * 0.6;
    const m = Math.hypot(x, z);
    if (m > 1) { x /= m; z /= m; }
    return { x, z };
  }

  /** Straight for the deepest water in sight, whichever way that is. */
  backOff() {
    let bestA = 0, bestD = -Infinity;
    for (let k = 0; k < 12; k++) {
      const a = k * Math.PI / 6;
      const d = this.depthAlong(Math.cos(a), Math.sin(a), 10);
      if (d > bestD) { bestD = d; bestA = a; }
    }
    return { x: Math.cos(bestA) * 0.8, z: Math.sin(bestA) * 0.8 };
  }

  /** Is there room for the tender at a spot, with water to spare round it? */
  roomAt(x, z) {
    if (waterDepth(x, z) < SAFE_DEPTH) return false;
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3;
      if (waterDepth(x + Math.cos(a) * 4, z + Math.sin(a) * 4) < TENDER_MIN_DEPTH) return false;
    }
    return true;
  }

  // --- autonomous behaviour ------------------------------------------------

  /** One autonomous fishing attempt — identical economics to a player cast. */
  autoFish() {
    const li = this.pickBait();
    if (li < 0) return;                            // nothing left it can afford
    this.lureIndex = li;
    const lure = LURES[li];

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
    // charged against real cash, and that bait is gone from the bag.
    this.bag[li]--;
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

  /** The run is over when the bag is empty, or the cash cannot cover what is left. */
  get runDone() {
    return this.pickBait() < 0;
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
    const l = Math.hypot(wantX, wantZ) || 1;
    const clear = steerClear(this, mother, { x: wantX / l, z: wantZ / l }, 4);
    const shy = this.shyFromShore(clear, dt);
    // Keep the wander pointing the way the shore let it go.
    if (Math.hypot(shy.x, shy.z) > 0.2) this.wander = Math.atan2(shy.z, shy.x);
    return shy;
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
    this.bag.fill(0);
    this.spent = 0;
    this.state = 'manual';
    this.hud.showTenderReport({ n, value, spent, best });
    if (best && best.value >= CONFIG.BIGCATCH_MIN_VALUE) this.hud.showBigCatch(best);
  }

  // --- per-frame -----------------------------------------------------------

  /**
   * Keep station on the mother ship: a hand at the tender's helm holds it
   * off the seiner's quarter while the player drives the big boat, close
   * enough to be craned back aboard without a chase, far enough not to be
   * run down. It only ever follows; the seiner never follows it.
   */
  steerFollow(mother, dt) {
    // A spot a couple of lengths off the port quarter — or the starboard
    // one, or dead astern, whichever has water round it when the seiner
    // is running close along a bank.
    const bx = Math.sin(mother.heading), bz = Math.cos(mother.heading);    // astern
    const px = -bz, pz = bx;                                                // to port
    const L = mother.hullBounds?.length || 19;
    const off = L * 0.35 + 5;
    const spots = [[L * 0.55, off], [L * 0.55, -off], [L * 0.5 + off, 0]];
    let tx = null, tz = null;
    for (const [back, side] of spots) {
      const x = mother.pos.x + bx * back + px * side, z = mother.pos.z + bz * back + pz * side;
      if (this.roomAt(x, z)) { tx = x; tz = z; break; }
    }
    if (tx == null) { tx = mother.pos.x + bx * (L * 0.5 + off); tz = mother.pos.z + bz * (L * 0.5 + off); }
    let wantX = tx - this.pos.x, wantZ = tz - this.pos.z;
    const d = Math.hypot(wantX, wantZ);
    if (d < 4) { this.stuckT = 0; return { x: 0, z: 0 }; }
    // Ease off close in, so it settles rather than overshoots — never
    // straight through the mother ship to get there, and never into the
    // bank.
    const k = Math.min(1, (d - 4) / 10) / (Math.hypot(wantX, wantZ) || 1);
    const clear = steerClear(this, mother, { x: wantX * k, z: wantZ * k }, 4);
    return this.shyFromShore(clear, dt);
  }

  update(dt, t, moveVec, mother, helmed = false) {
    if (this.hoist) { this.updateHoist(dt, t, mother); return; }
    if (!this.deployed) return;

    const s = this.spec;
    let move = moveVec;
    this.helmed = helmed;
    if (this.state === 'auto') {
      move = this.steerAuto(dt, mother);

      this.castTimer -= dt;
      if (this.castTimer <= 0) {
        this.castTimer = AUTO_CAST_EVERY;
        this.autoFish();
      }
      // Run finished and back alongside: report in.
      if (this.runDone && this.distanceTo(mother) <= HOME_RADIUS) this.deliver();
    } else if (!helmed) {
      move = this.steerFollow(mother, dt);
    }

    const was = this.heading;
    driveHull(this, s, dt, move, navigable);
    const rate = dt > 0 ? wrapAngle(this.heading - was) / dt : 0;
    this.yawVel += (rate - this.yawVel) * Math.min(1, 5 * dt);

    updateRods(this.rods, dt);
    this.wake.update(dt, t, this);

    const bob = this.lake.waveHeight(this.pos.x, this.pos.z, t);
    // Capped by beam, as the big boat's is, so the gunwale stays dry.
    const heelCap = Math.min(0.2, 0.14 / Math.max(0.5, this.hullBounds?.halfBeam ?? 1));
    const heel = Math.max(-heelCap, Math.min(heelCap,
      this.yawVel * (this.speed / s.maxSpeed) * 0.42));
    this.group.position.set(this.pos.x, bob + 0.02, this.pos.z);
    this.group.rotation.set(
      Math.sin(t * 1.1) * 0.03, this.heading, Math.sin(t * 1.4) * 0.035 + heel);

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
