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

    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.26 * scale, 0.34 * scale, height, 12), MAT.steel);
    pedestal.position.y = height / 2;
    this.group.add(pedestal);

    this.slew = new THREE.Group();
    this.slew.position.y = height;
    this.group.add(this.slew);
    const house = new THREE.Mesh(new THREE.BoxGeometry(0.68 * scale, 0.56 * scale, 0.9 * scale), MAT.paint);
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
    const jib = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * scale, 0.13 * scale, reach, 6), MAT.paint);
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
