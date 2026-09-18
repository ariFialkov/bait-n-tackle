// The fish on the end of your line, made visible.
//
// Once a hook sets, the catch is already resolved (see fishing.js) — this is
// the fish that bet produced, at the size that bet produced, swimming under
// the surface as you crank it in and breaking the water when it arrives. It
// shows you what you already have; it is never a preview of a decision you
// could still change.
//
// One prototype mesh is built per species and cloned per hook, so sixteen
// crewed rods hooking at once cost sixteen cheap clones, not sixteen rebuilds.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildFishMesh, visualLength } from './fishmodels.js';

const protos = new Map();   // species.id -> { group, tailIndex }

function prototypeFor(species) {
  let p = protos.get(species.id);
  if (!p) {
    const { group, tail } = buildFishMesh(species);
    p = { group, tailIndex: group.children.indexOf(tail) };
    protos.set(species.id, p);
  }
  return p;
}

const RING_GEO = new THREE.RingGeometry(0.35, 0.52, 20);
RING_GEO.rotateX(-Math.PI / 2);

export class HookedFish {
  constructor(scene, species, sizeMult) {
    const proto = prototypeFor(species);
    this.scene = scene;
    this.mesh = proto.group.clone(true);
    this.tail = this.mesh.children[proto.tailIndex] || null;
    const base = Math.max(0.05, visualLength(species));
    const raw = base * sizeMult;
    // Drawn larger than life so the fish reads from the gameplay camera.
    this.len = Math.min(raw * CONFIG.HOOKED_FISH_SCALE, CONFIG.HOOKED_FISH_MAX_M);
    this.mesh.scale.setScalar(this.len / base);
    this.mesh.visible = false;
    scene.add(this.mesh);

    // Big fish fight deeper and slower; little ones skitter near the surface.
    // Kept shallow enough to stay legible through the water.
    this.depth = THREE.MathUtils.clamp(0.55 + this.len * 0.22, 0.55, 1.7);
    this.beat = 9 - Math.min(4.5, this.len * 1.3);   // tail beats per second
    this.phase = Math.random() * Math.PI * 2;
    this.thrash = 0;
    this.breached = false;

    this.splash = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
      side: THREE.DoubleSide,
    }));
    this.splash.renderOrder = 4;
    this.splash.visible = false;
    scene.add(this.splash);
    this.splashT = 0;

    this._v = new THREE.Vector3();
  }

  /**
   * Follow the line in.
   *   bobber   — where the float currently is
   *   rodTip   — where it is being dragged to
   *   lineOut  — metres of line still out
   *   lift     — 0 while swimming, 0..1 while being swung up to the rod
   */
  update(dt, t, bobber, rodTip, lineOut, lift = 0) {
    const m = this.mesh;
    m.visible = true;

    // Direction the fish is being pulled: bobber -> rod tip.
    const dx = rodTip.x - bobber.x, dz = rodTip.z - bobber.z;
    const dl = Math.hypot(dx, dz) || 1;
    const ux = dx / dl, uz = dz / dl;

    // It rises as it comes in — deep while it still has line, near the
    // surface by the time it is alongside.
    const near = THREE.MathUtils.clamp(1 - lineOut / 10, 0, 1);
    const depth = this.depth * (1 - near * 0.78);

    // Fighting: it yaws hard side to side and rolls over, harder when fresh.
    this.thrash += dt * (2.6 + near * 2.2);
    const fight = (1 - near * 0.45);
    const swing = Math.sin(this.thrash * 2.1 + this.phase) * 0.55 * fight;
    const lateral = Math.sin(this.thrash * 1.7 + this.phase) * 0.45 * fight;

    // Trailing a little behind the float, offset to whichever way it is
    // currently bolting.
    const back = this.len * 0.45 + 0.25;
    const wx = bobber.x - ux * back - uz * lateral;
    const wz = bobber.z - uz * back + ux * lateral;

    if (lift > 0) {
      // Swung up out of the water onto the deck: a parabola to the rod tip.
      const k = THREE.MathUtils.clamp(lift, 0, 1);
      const ease = k * k * (3 - 2 * k);
      m.position.set(
        THREE.MathUtils.lerp(wx, rodTip.x, ease),
        THREE.MathUtils.lerp(CONFIG.WATER_LEVEL - depth * 0.35, rodTip.y, ease)
          + Math.sin(k * Math.PI) * (1.2 + this.len * 0.5),
        THREE.MathUtils.lerp(wz, rodTip.z, ease));
      // Hanging nose-up off the line, twisting as it comes clear.
      m.rotation.set(-1.1 * ease, Math.atan2(-ux, -uz) + swing * 2.0,
        Math.sin(t * 16 + this.phase) * 0.5 * (1 - ease * 0.4));
      m.scale.setScalar(this.mesh.scale.x);
      if (this.tail) this.tail.rotation.y = Math.sin(t * 22 + this.phase) * 0.7;
      this.updateSplash(dt);
      return;
    }

    m.position.set(wx, CONFIG.WATER_LEVEL - depth, wz);
    m.rotation.set(
      // Nose tips up as it is hauled toward the surface.
      -near * 0.45 + Math.sin(this.thrash * 1.3) * 0.12,
      Math.atan2(-ux, -uz) + swing,
      Math.sin(this.thrash * 2.7 + this.phase) * 0.6 * fight);
    if (this.tail) {
      this.tail.rotation.y = Math.sin(t * this.beat + this.phase) * 0.8;
    }

    // It breaks the water once, alongside the boat.
    if (!this.breached && near > 0.82) {
      this.breached = true;
      this.splashT = 1;
      this.splash.position.set(wx, CONFIG.WATER_LEVEL + 0.05, wz);
      this.splash.visible = true;
    }
    this.updateSplash(dt);
  }

  updateSplash(dt) {
    if (this.splashT <= 0) return;
    this.splashT = Math.max(0, this.splashT - dt * 1.6);
    const k = 1 - this.splashT;
    const r = (0.6 + this.len * 0.7) * (0.4 + k * 1.6);
    this.splash.scale.setScalar(r);
    this.splash.material.opacity = this.splashT * 0.75;
    if (this.splashT <= 0) this.splash.visible = false;
  }

  dispose() {
    this.scene.remove(this.mesh, this.splash);
    this.splash.material.dispose();
  }
}
