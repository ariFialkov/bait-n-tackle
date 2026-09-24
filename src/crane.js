// A hydraulic deck crane: pedestal, slewing house, luffing jib, a wire
// down to a hook. It is driven by where the HOOK should be — a point in the
// crane's parent frame — and works out the slew, the luff and the wire for
// itself, then eases each toward it at a machine's pace, so a target that
// jumps still moves the hook along a smooth crane-like path: swing, raise,
// lower. Nothing here bets or pays; it is how the seiner's tender gets
// in and out of the water.

import * as THREE from 'three';
import { wrapAngle } from './hullphysics.js';

const SLEW_RATE = 0.55;    // rad/s the house turns
const LUFF_RATE = 0.32;    // rad/s the jib raises or lowers
const HOIST_RATE = 1.5;    // m/s the wire pays in or out
const EASE = 3.2;          // how sharply each axis settles onto its target

const MAT = {
  steel: new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.55, metalness: 0.5 }),
  paint: new THREE.MeshStandardMaterial({ color: 0xd9a531, roughness: 0.5, metalness: 0.15 }),
  wire: new THREE.LineBasicMaterial({ color: 0x2a2a2e }),
};

export class DeckCrane {
  /**
   * `reach` is the jib length; `height` the pedestal's. The whole thing is
   * sized by `scale` so a crane sits right on a 19 m seiner and would on a
   * 26 m steamer.
   */
  constructor({ reach = 5.6, height = 1.1, scale = 1 } = {}) {
    this.reach = reach;
    this.height = height;
    this.group = new THREE.Group();
    // The painted parts take the ship's own hull colour (setPaint).
    this.paintMat = MAT.paint.clone();

    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.26 * scale, 0.34 * scale, height, 12), MAT.steel);
    pedestal.position.y = height / 2;
    this.group.add(pedestal);

    this.slew = new THREE.Group();
    this.slew.position.y = height;
    this.group.add(this.slew);
    const house = new THREE.Mesh(new THREE.BoxGeometry(0.68 * scale, 0.56 * scale, 0.9 * scale), this.paintMat);
    house.position.set(0, 0.28 * scale, -0.12 * scale);
    this.slew.add(house);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.5 * scale, 0.3 * scale, 0.36 * scale), MAT.steel);
    cab.position.set(0, 0.7 * scale, -0.3 * scale);
    this.slew.add(cab);

    // The jib pivots at the front of the house; it lies along +z when level.
    this.pivot = new THREE.Vector3(0, 0.5 * scale, 0.32 * scale);
    this.luff = new THREE.Group();
    this.luff.position.copy(this.pivot);
    this.slew.add(this.luff);
    const jib = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * scale, 0.13 * scale, reach, 6), this.paintMat);
    jib.rotation.x = Math.PI / 2;
    jib.position.z = reach / 2;
    this.luff.add(jib);
    const sheave = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * scale, 0.12 * scale, 0.1 * scale, 10), MAT.steel);
    sheave.rotation.z = Math.PI / 2;
    sheave.position.z = reach;
    this.luff.add(sheave);
    // A ram from the house to a third of the way up the jib.
    this.ram = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * scale, 0.05 * scale, 1, 8), MAT.steel);
    this.slew.add(this.ram);
    this.ramFoot = new THREE.Vector3(0, 0.05 * scale, -0.25 * scale);

    // The wire and the hook live in the crane's own frame. The wire is a
    // thin cylinder rather than a line so it has a thickness on screen.
    this.wire = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), MAT.steel);
    this.wire.frustumCulled = false;
    this.wireR = 0.04 * scale;
    this.group.add(this.wire);
    this.hook = new THREE.Group();
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.16 * scale, 0.24 * scale, 0.1 * scale), MAT.steel);
    this.hook.add(block);
    const claw = new THREE.Mesh(new THREE.TorusGeometry(0.11 * scale, 0.025 * scale, 6, 12, Math.PI * 1.5), MAT.steel);
    claw.position.y = -0.22 * scale;
    claw.rotation.z = Math.PI * 0.75;
    this.hook.add(claw);
    this.group.add(this.hook);
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    // Where the hook is wanted (parent frame) and the machine's own state.
    this.target = new THREE.Vector3(0, height + 3, reach * 0.6);
    this.restPoint = this.target.clone();
    this.slewA = 0; this.luffA = 0.9; this.wireL = 1.0;
    this.slewT = 0; this.luffT = 0.9; this.wireT = 1.0;
    this._hook = new THREE.Vector3();
    this._tip = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this.update(0);
  }

  /** Paint the house and jib: the skin's hull colour, so the crane belongs to the ship. */
  setPaint(hex) { if (hex) this.paintMat.color.set(hex); }

  /** Where the hook should go, in the crane's parent frame. */
  setTarget(p) { this.target.copy(p); }

  /** Back to its parked pose over the deck. */
  rest() { this.target.copy(this.restPoint); }

  /** Solve slew, luff and wire for the current target. */
  solve() {
    const g = this.group.position;
    const dx = this.target.x - g.x, dz = this.target.z - g.z;
    const r = THREE.MathUtils.clamp(Math.hypot(dx, dz) - this.pivot.z, 0.8, this.reach * 0.985);
    this.slewT = Math.atan2(dx, dz);
    this.luffT = Math.acos(r / this.reach);
    const tipY = this.height + this.pivot.y + this.reach * Math.sin(this.luffT);
    this.wireT = Math.max(0.35, tipY - (this.target.y - g.y));
  }

  update(dt) {
    this.solve();
    const step = (cur, want, rate, wrap) => {
      let d = want - cur;
      if (wrap) d = wrapAngle(d);
      const m = Math.min(Math.abs(d), rate * dt, Math.abs(d) * Math.min(1, EASE * dt) + rate * dt * 0.15);
      return cur + Math.sign(d) * m;
    };
    this.slewA = step(this.slewA, this.slewT, SLEW_RATE, true);
    this.luffA = step(this.luffA, this.luffT, LUFF_RATE, false);
    this.wireL = step(this.wireL, this.wireT, HOIST_RATE, false);

    this.slew.rotation.y = this.slewA;
    this.luff.rotation.x = -this.luffA;

    // Jib tip and hook, in the crane's frame.
    const s = Math.sin(this.slewA), c = Math.cos(this.slewA);
    const px = this.pivot.z * s, pz = this.pivot.z * c, py = this.height + this.pivot.y;
    const rc = this.reach * Math.cos(this.luffA), ry = this.reach * Math.sin(this.luffA);
    this._tip.set(px + rc * s, py + ry, pz + rc * c);
    this._hook.set(this._tip.x, this._tip.y - this.wireL, this._tip.z);
    this.wire.position.set(this._tip.x, (this._tip.y + this._hook.y + 0.12) / 2, this._tip.z);
    this.wire.scale.set(this.wireR, Math.max(0.05, this._tip.y - this._hook.y - 0.12), this.wireR);
    this.hook.position.copy(this._hook);
    this.hook.rotation.y = this.slewA;

    // The ram, from its foot on the house to a point up the jib.
    const j = this._v.set(0, 0, this.reach * 0.32).applyAxisAngle(new THREE.Vector3(1, 0, 0), -this.luffA).add(this.pivot);
    const f = this.ramFoot;
    this.ram.position.lerpVectors(f, j, 0.5);
    this.ram.scale.y = f.distanceTo(j);
    this.ram.lookAt(this.slew.localToWorld(this._v.copy(j)));
    this.ram.rotateX(Math.PI / 2);
  }

  /** The hook, in the crane's parent frame. */
  hookAt(out) { return out.copy(this._hook).add(this.group.position); }

  /** True once every axis is on its (current) target. */
  get settled() {
    this.solve();
    return Math.abs(wrapAngle(this.slewT - this.slewA)) < 0.02 &&
      Math.abs(this.luffT - this.luffA) < 0.015 && Math.abs(this.wireT - this.wireL) < 0.06;
  }
}

/**
 * The dredger's grab, driven from the model's own parts: a pedestal that
 * slews, a boom that luffs off it, and the claw hanging from the boom's tip
 * (kept hanging as the boom moves). No wire: where the claw's jaws reach is
 * set by how far out the boom is laid, so the grab is aimed by giving it a
 * point and letting it choose the reach that puts the jaws at the water.
 */
export class ClawRig {
  /** `slew`, `boom`, `claw`: the carved nodes, each standing at its pivot in the hull frame. */
  constructor(slew, boom, claw) {
    this.slew = slew; this.boom = boom; this.claw = claw;
    this.base = slew.position.clone();
    const pb = boom.position.clone(), pc = claw.position.clone();
    // Nest them: boom off the pedestal, claw off the boom tip. All three
    // stand at their pivots in the model's frame, which is the hull frame.
    boom.parent.remove(boom); slew.add(boom); boom.position.copy(pb).sub(this.base);
    claw.parent.remove(claw); boom.add(claw); claw.position.copy(pc).sub(pb);
    this.pivot = pb;                                     // boom pivot, hull frame
    this.reach = pb.distanceTo(pc);                      // boom length
    this.elev0 = Math.atan2(pc.y - pb.y, -(pc.z - pb.z)); // rest elevation, boom toward -z
    this.hang = 3.65;                                    // claw top to jaws, model units
    this.slewA = 0; this.luffA = 0;                      // current, as offsets from rest
    this.slewT = 0; this.luffT = 0;
    this._v = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this.grip = null;                                    // an Object3D carried in the jaws
    this.busy = null;                                    // whatever job has the grab
  }

  /** Aim the jaws at a point in the hull frame: bearing from it, reach for its height. */
  setTarget(p) {
    const dx = p.x - this.base.x, dz = p.z - this.base.z;
    this.slewT = Math.atan2(-dx, -dz);
    // The boom elevation that puts the jaws at p.y, clamped to what it can do.
    const tipY = p.y + this.hang;
    const s = THREE.MathUtils.clamp((tipY - this.pivot.y) / this.reach, -0.15, 0.95);
    const wantElev = Math.asin(s);
    // ... but never further out than the point itself (it would overshoot).
    const r = Math.hypot(dx, dz);
    const minElev = Math.acos(THREE.MathUtils.clamp(r / this.reach, 0.05, 1));
    this.luffT = Math.max(wantElev, minElev) - this.elev0;
  }

  rest() { this.slewT = 0; this.luffT = 0; }

  /** How far out (from the base) the jaws land when reaching for water at hull-frame `y`. */
  reachAtY(y) {
    const s = THREE.MathUtils.clamp((y + this.hang - this.pivot.y) / this.reach, -0.15, 0.95);
    return this.reach * Math.cos(Math.asin(s));
  }

  update(dt) {
    const step = (cur, want, rate, wrap) => {
      let d = want - cur;
      if (wrap) d = wrapAngle(d);
      const m = Math.min(Math.abs(d), rate * dt, Math.abs(d) * Math.min(1, 3 * dt) + rate * dt * 0.15);
      return cur + Math.sign(d) * m;
    };
    this.slewA = step(this.slewA, this.slewT, 0.7, true);
    this.luffA = step(this.luffA, this.luffT, 0.4, false);
    this.slew.rotation.y = this.slewA;
    this.boom.rotation.x = this.luffA;                  // +x raises a boom that points to -z
    this.claw.rotation.x = -this.luffA;                 // ... and the claw keeps hanging
    if (this.grip) {
      // Carried in the jaws: a world-space object hanging under them.
      this.jawsWorld(this._v);
      this.grip.position.copy(this._v);
      this.grip.position.y -= this.gripDrop || 0;
    }
  }

  /** The jaws, in the hull frame (the slew node's parent). */
  jawsAt(out) {
    this.jawsWorld(out);
    return this.slew.parent.worldToLocal(out);
  }

  /** The jaws, in world space. */
  jawsWorld(out) {
    out.set(0, -this.hang, 0);
    this.claw.updateWorldMatrix(true, false);
    return this.claw.localToWorld(out);
  }

  /** Aim at a world point. */
  setTargetWorld(p) {
    this.setTarget(this.slew.parent.worldToLocal(this._t.copy(p)));
  }

  get settled() {
    return Math.abs(wrapAngle(this.slewT - this.slewA)) < 0.02 && Math.abs(this.luffT - this.luffA) < 0.015;
  }
}
