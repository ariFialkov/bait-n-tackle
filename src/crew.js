// Fishermen. The rigged characters that live on the boats: how one is
// loaded and dressed, and how it moves.
//
// The models arrive as bare skeletons with no animation, so everything they
// do is built here, on the bones, every frame: the hips are placed, the
// spine and head are leaned and turned, and the limbs are solved with a
// two-bone IK toward hand and foot targets. Those targets are what a state
// is — idle, walk, hold a rod, reel, take the wheel, work a console, point,
// sit — and the states cross-fade by easing the targets, so a hand that was
// on the wheel travels to the rod grip rather than jumping there.
//
// Working a rod is deliberately built ON the rod (rods.js): the hands chase
// the rod's own grip and reel, so when the rod sweeps through a cast or
// bends under a fish the fisherman follows it exactly and the two can never
// disagree.
//
// Coordinates: an actor stands at its own origin, feet on the deck, facing
// -z (the same convention as the boat, bow at -z). Targets are set in actor
// space and solved in world space.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { dressCanvas, lookKey } from './crewlook.js';

const loader = new GLTFLoader();
const modelCache = new Map();     // id -> Promise<{ scene, classLum }>
const skinCache = new Map();      // `${id}|${lookKey}` -> CanvasTexture

export function crewModelURL(id) { return `./assets/crew/${id}.glb`; }

function loadModel(id) {
  if (!modelCache.has(id)) {
    modelCache.set(id, loader.loadAsync(crewModelURL(id)).then((gltf) => ({
      scene: gltf.scene,
      classLum: gltf.scene.userData?.classLum || [128, 128, 128, 128, 128, 128],
    })));
  }
  return modelCache.get(id);
}

function dressedTexture(id, model, mesh, look) {
  const key = `${id}|${lookKey(look)}`;
  if (skinCache.has(key)) return skinCache.get(key);
  const src = mesh.material.map && mesh.material.map.image;
  if (!src || !(src.width || src.naturalWidth)) return null;
  const tex = new THREE.CanvasTexture(dressCanvas(src, model.classLum, look));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.needsUpdate = true;
  skinCache.set(key, tex);
  return tex;
}

// --- rig helpers -----------------------------------------------------------

const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();

/**
 * Turn a bone so that `localDir` (a direction in the bone's own rest frame,
 * usually toward its child) points along `worldDir`. Starts from the rest
 * orientation so nothing accumulates frame to frame.
 */
function aim(bone, rest, localDir, worldDir) {
  bone.quaternion.copy(rest);
  bone.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(_q1);
  bone.getWorldQuaternion(_q2);
  _v1.copy(localDir).applyQuaternion(_q2).normalize();
  _v2.copy(worldDir).normalize();
  _q3.setFromUnitVectors(_v1, _v2);
  _q2.premultiply(_q3);                 // new world orientation
  bone.quaternion.copy(_q1.invert()).multiply(_q2);
}

/** Add a rotation about a WORLD axis on top of whatever the bone has. */
function turnAbout(bone, axisWorld, angle) {
  if (!angle) return;
  bone.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(_q1);
  bone.getWorldQuaternion(_q2);
  _q3.setFromAxisAngle(_v1.copy(axisWorld).normalize(), angle);
  _q2.premultiply(_q3);
  bone.quaternion.copy(_q1.invert()).multiply(_q2);
}

/**
 * Two-bone limb: put the end of `lower` on `target`, bending toward `hint`.
 * `up` and `lo` are the two segment lengths. Everything in world space.
 */
function solveLimb(upper, lower, restU, restL, dirU, dirL, up, lo, target, hint) {
  upper.updateWorldMatrix(true, false);
  const root = upper.getWorldPosition(_v3);
  const toT = _v4.subVectors(target, root);
  const d = Math.max(0.02, Math.min(up + lo - 0.01, toT.length()));
  toT.normalize();
  // Where the middle joint sits: law of cosines along the root->target line,
  // pushed out toward the hint.
  const a = (up * up - lo * lo + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, up * up - a * a));
  const side = _v5.copy(hint).sub(root);
  side.addScaledVector(toT, -side.dot(toT));
  if (side.lengthSq() < 1e-6) side.set(0, 1, 0).addScaledVector(toT, -toT.y);
  side.normalize();
  const mid = _v1.copy(root).addScaledVector(toT, a).addScaledVector(side, h);
  _v2.subVectors(mid, root);
  aim(upper, restU, dirU, _v2);
  lower.updateWorldMatrix(true, false);
  const midPos = lower.getWorldPosition(_v2);
  _v5.subVectors(target, midPos);
  aim(lower, restL, dirL, _v5);
}

const smooth = (cur, want, k) => cur + (want - cur) * k;

// --- the character ---------------------------------------------------------

/**
 * One fisherman. `id` picks the body (captain, bosun, deckhand, engineer);
 * `look` recolours the clothes, or null keeps them as painted.
 */
export class Character {
  constructor(id, look = null) {
    this.id = id;
    this.look = look;
    this.actor = new THREE.Group();          // where they stand, which way they face
    this.actor.rotation.order = 'YXZ';
    this.ready = false;
    this.height = 1.7;

    // Where they are going and what they are doing.
    this.state = 'idle';
    this.speed = 0;
    this.stride = 0;                          // walk phase
    this.facing = 0;
    this.pos = new THREE.Vector2();           // deck position, actor space parent
    this.goal = null;                         // { x, z, facing }
    this.walkSpeed = 1.6;
    this.oneShot = null;                      // { name, t, dur }
    this.rod = null;                          // the rod being worked, if any
    this.lookAt = null;                       // world point the head follows

    // Smoothed targets, actor space unless `world`.
    this.tgt = {
      handL: new THREE.Vector3(-0.24, 0.95, 0.03), handR: new THREE.Vector3(0.24, 0.95, 0.03),
      footL: new THREE.Vector3(-0.13, 0, 0), footR: new THREE.Vector3(0.13, 0, 0),
      hips: new THREE.Vector3(0, 0.92, 0),
      lean: 0, twist: 0, headYaw: 0, headPitch: 0, crouch: 0,
    };
    this._w = { handL: new THREE.Vector3(), handR: new THREE.Vector3(), hintL: new THREE.Vector3(), hintR: new THREE.Vector3() };
    this._want = {
      handL: new THREE.Vector3(), handR: new THREE.Vector3(),
      footL: new THREE.Vector3(), footR: new THREE.Vector3(), hips: new THREE.Vector3(),
    };
    this._tmp = new THREE.Vector3();
    // Scratch for solve(): the module-level vectors are used inside the
    // solver itself, so targets and hints need their own.
    this._s = Array.from({ length: 8 }, () => new THREE.Vector3());
    this._sq = new THREE.Quaternion();
    this.phase = Math.random() * 6.28;

    loadModel(id).then((model) => this.build(model));
  }

  build(model) {
    const scene = cloneSkeleton(model.scene);
    let mesh = null;
    scene.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
    if (!mesh) return;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.material = mesh.material.clone();
    mesh.material.roughness = 0.8;
    const tex = dressedTexture(this.id, model, mesh, this.look);
    if (tex) { mesh.material.map = tex; mesh.material.needsUpdate = true; }

    // The model faces +z; the actor faces -z.
    scene.rotation.y = Math.PI;
    this.model = scene;
    this.actor.add(scene);

    const bones = {};
    scene.traverse((o) => { if (o.isBone) bones[o.name] = o; });
    this.bones = bones;
    this.armature = bones.Hips.parent;
    this.rest = {};
    for (const [n, b] of Object.entries(bones)) this.rest[n] = b.quaternion.clone();

    // Directions to children in each bone's own frame, and segment lengths.
    const ld = (b, c) => c.position.clone().normalize();
    this.dir = {
      LeftArm: ld(bones.LeftArm, bones.LeftForeArm), LeftForeArm: ld(bones.LeftForeArm, bones.LeftHand),
      RightArm: ld(bones.RightArm, bones.RightForeArm), RightForeArm: ld(bones.RightForeArm, bones.RightHand),
      LeftUpLeg: ld(bones.LeftUpLeg, bones.LeftLeg), LeftLeg: ld(bones.LeftLeg, bones.LeftFoot),
      RightUpLeg: ld(bones.RightUpLeg, bones.RightLeg), RightLeg: ld(bones.RightLeg, bones.RightFoot),
      LeftFoot: ld(bones.LeftFoot, bones.LeftToeBase), RightFoot: ld(bones.RightFoot, bones.RightToeBase),
      Head: bones.headfront.position.clone().normalize(),
    };
    scene.updateWorldMatrix(true, true);
    const wl = (a, b) => bones[a].getWorldPosition(_v1).distanceTo(bones[b].getWorldPosition(_v2));
    this.len = {
      upArm: wl('LeftArm', 'LeftForeArm'), foreArm: wl('LeftForeArm', 'LeftHand'),
      thigh: wl('LeftUpLeg', 'LeftLeg'), shin: wl('LeftLeg', 'LeftFoot'),
    };
    const hipsW = bones.Hips.getWorldPosition(_v1);
    this.actor.worldToLocal(hipsW);
    this.hipHeight = hipsW.y;
    this.tgt.hips.y = this.hipHeight;
    this.ready = true;
  }

  dispose() {
    this.actor.parent?.remove(this.actor);
  }

  // --- orders ---------------------------------------------------------------

  /** Walk to a spot on the deck and face `facing` there. */
  goTo(x, z, facing) {
    this.goal = { x, z, facing: facing ?? this.facing };
  }

  /** Stand here at once (used when boarding a boat). */
  placeAt(x, z, facing) {
    this.pos.set(x, z);
    this.facing = facing;
    this.goal = null;
    this.actor.position.set(x, this.actor.position.y, z);
    this.actor.rotation.y = facing;
  }

  /** Change what the body is doing once it is where it is going. */
  setState(name) { this.state = name; }

  /** Play a one-shot gesture (cast, point) over the current state. */
  play(name, dur) {
    this.oneShot = { name, t: 0, dur };
  }

  get arrived() { return !this.goal; }

  // --- per frame ------------------------------------------------------------

  /**
   * `deckY(x, z)` gives the deck height under a point in actor-parent space;
   * `steer` (-1..1) and `boatT` feed the wheel and the sway.
   */
  update(dt, t, deckY, ctx = {}) {
    // Movement toward the goal, in the parent's space.
    if (this.goal) {
      const dx = this.goal.x - this.pos.x, dz = this.goal.z - this.pos.y;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.08) {
        this.pos.set(this.goal.x, this.goal.z);
        let d = this.goal.facing - this.facing;
        while (d > Math.PI) d -= 6.283185; while (d < -Math.PI) d += 6.283185;
        this.facing += d * Math.min(1, 8 * dt);
        if (Math.abs(d) < 0.05) { this.facing = this.goal.facing; this.goal = null; }
        this.speed = smooth(this.speed, 0, Math.min(1, 10 * dt));
      } else {
        const want = Math.min(this.walkSpeed, dist * 3);
        this.speed = smooth(this.speed, want, Math.min(1, 6 * dt));
        const step = Math.min(dist, this.speed * dt);
        this.pos.x += dx / dist * step;
        this.pos.y += dz / dist * step;
        // Face the way we are walking.
        const wantF = Math.atan2(-dx, -dz);
        let d = wantF - this.facing;
        while (d > Math.PI) d -= 6.283185; while (d < -Math.PI) d += 6.283185;
        this.facing += d * Math.min(1, 9 * dt);
      }
    } else {
      this.speed = smooth(this.speed, 0, Math.min(1, 10 * dt));
    }
    this.stride += (this.speed / 0.34) * dt;
    const y = deckY ? deckY(this.pos.x, this.pos.y) : 0;
    this.actor.position.set(this.pos.x, y, this.pos.y);
    this.actor.rotation.y = this.facing;
    if (!this.ready) return;

    if (this.oneShot) {
      this.oneShot.t += dt;
      if (this.oneShot.t >= this.oneShot.dur) this.oneShot = null;
    }
    this.pose(dt, t, ctx);
    this.solve();
  }

  /** Decide this frame's targets from the state, then ease toward them. */
  pose(dt, t, ctx) {
    const w = this._want;
    const T = this.tgt;
    const ph = t * 1.4 + this.phase;
    let lean = 0.04, twist = 0, headYaw = 0, headPitch = 0.05, crouch = 0;
    let handWorldL = false, handWorldR = false;
    const walking = this.speed > 0.12;
    const hips = w.hips.set(0, this.hipHeight, 0);

    // Feet.
    if (walking) {
      const s = this.stride;
      const A = 0.30 * Math.min(1, this.speed / 1.4);
      w.footL.set(-0.12, Math.max(0, -Math.sin(s)) * 0.13, -A * Math.cos(s));
      w.footR.set(0.12, Math.max(0, -Math.sin(s + Math.PI)) * 0.13, -A * Math.cos(s + Math.PI));
      hips.y -= 0.03 + 0.025 * Math.abs(Math.cos(s));
      lean = 0.16 * Math.min(1, this.speed / 1.4);
    } else {
      w.footL.set(-0.14, 0, 0.02);
      w.footR.set(0.14, 0, -0.02);
      hips.y -= 0.01 + 0.008 * Math.sin(ph * 0.5);
    }

    // Hands, by state.
    const name = this.state;
    if (walking) {
      const s = this.stride;
      w.handL.set(-0.24, 0.98, 0.14 * Math.cos(s + Math.PI));
      w.handR.set(0.24, 0.98, 0.14 * Math.cos(s));
    } else if ((name === 'hold' || name === 'reel') && this.rod) {
      // Hands on the rod: right on the grip, left at the reel — and when
      // reeling the left hand cranks a small circle beside it.
      const r = this.rod;
      r.grip.getWorldPosition(this._w.handR);
      r.reel.getWorldPosition(this._w.handL);
      if (name === 'reel') {
        const c = t * 9;
        this._w.handL.x += Math.cos(c) * 0.05;
        this._w.handL.y += Math.sin(c) * 0.05;
      }
      handWorldL = handWorldR = true;
      lean = name === 'reel' ? 0.06 : 0.14;
      crouch = name === 'reel' ? 0.10 : 0.06;
      headPitch = 0.18;
    } else if (name === 'helm') {
      const steer = ctx.steer || 0;
      // A wheel in front at chest height; the hands ride round with it.
      const a = steer * 0.7;
      w.handL.set(-0.17 * Math.cos(a), 1.08 + 0.17 * Math.sin(a), -0.26);
      w.handR.set(0.17 * Math.cos(a), 1.08 - 0.17 * Math.sin(a), -0.26);
      lean = 0.08;
      twist = steer * 0.12;
      headPitch = 0.0;
    } else if (name === 'station') {
      // Bent over a console: hands low in front, eyes on the screen, and a
      // finger that taps now and again.
      const tap = Math.max(0, Math.sin(ph * 2.3)) * 0.04;
      w.handL.set(-0.16, 1.02 + tap, -0.24);
      w.handR.set(0.16, 1.00, -0.24);
      lean = 0.22;
      crouch = 0.04;
      headPitch = 0.42;
    } else if (name === 'sit') {
      // On a thwart with a hand on the tiller.
      hips.y = this.hipHeight - 0.40;
      hips.z = 0.06;
      w.footL.set(-0.16, 0, -0.40);
      w.footR.set(0.16, 0, -0.40);
      w.handL.set(-0.20, 0.62, -0.22);
      w.handR.set(0.26, 0.60, 0.06);
      lean = -0.04;
    } else if (name === 'lounge') {
      // Leaning on the rail, weight on one leg.
      w.handL.set(-0.26, 1.02, -0.18);
      w.handR.set(0.24, 0.95, 0.03);
      w.footR.set(0.20, 0, 0.06);
      hips.x = 0.05; hips.y -= 0.03;
      lean = 0.10; twist = -0.15;
    } else {
      // Idle: arms hanging, a little breathing.
      w.handL.set(-0.24, 0.95 + 0.01 * Math.sin(ph), 0.03);
      w.handR.set(0.24, 0.95 + 0.01 * Math.sin(ph + 0.4), 0.03);
      hips.x = 0.015 * Math.sin(ph * 0.37);
    }

    // One-shot gestures ride over the state.
    if (this.oneShot) {
      const k = this.oneShot.t / this.oneShot.dur;
      if (this.oneShot.name === 'point') {
        // Right arm out, then held, then down; the head follows it.
        const up = k < 0.25 ? k / 0.25 : k > 0.8 ? (1 - k) / 0.2 : 1;
        const e = up * up * (3 - 2 * up);
        w.handR.set(0.24 + 0.04 * e, 0.95 + 0.35 * e, 0.03 - 0.33 * e);
        w.handL.set(-0.24, 0.95 + 0.06 * e, 0.03);
        headYaw = -0.25 * e; twist = -0.2 * e;
        handWorldR = false;
      } else if (this.oneShot.name === 'wave') {
        const e = Math.sin(Math.min(1, k) * Math.PI);
        w.handR.set(0.30, 0.95 + 0.55 * e, -0.02 + 0.08 * Math.sin(t * 12) * e);
        handWorldR = false;
      } else if (this.oneShot.name === 'cast' && this.rod) {
        // The rod does the sweep (rods.js); the body steps into it.
        const e = Math.sin(Math.min(1, k) * Math.PI);
        lean = 0.22 * (k < 0.45 ? -1 : 1) * e;
        crouch = 0.05 * e;
        hips.z = 0.06 * (k < 0.45 ? 1 : -1) * e;
      }
    }

    // Head: follow a world point if there is one.
    if (this.lookAt && !this.oneShot) {
      this.actor.updateWorldMatrix(true, false);
      const local = this._tmp.copy(this.lookAt);
      this.actor.worldToLocal(local);
      local.y -= 1.5;
      headYaw = Math.max(-1.0, Math.min(1.0, Math.atan2(-local.x, -local.z)));
      headPitch = Math.max(-0.5, Math.min(0.6, -Math.atan2(local.y, Math.hypot(local.x, local.z))));
    }

    // Ease everything.
    const k = Math.min(1, (walking ? 14 : 8) * dt);
    // A world target is where the fingers close; the wrist sits a hand's
    // length short of it, and never further from the shoulder than the arm.
    const reach = this.len.upArm + this.len.foreArm - 0.01;
    const wrist = (out, worldPt, sx) => {
      this.actor.updateWorldMatrix(true, false);
      out.copy(this.actor.worldToLocal(worldPt));
      const sh = this._tmp.set(sx, 1.26 - crouch * 0.3 + hips.y - this.hipHeight, -lean * 0.3);
      out.sub(sh);
      const d = out.length();
      out.multiplyScalar(Math.min(reach, Math.max(0.05, d - 0.11)) / Math.max(1e-4, d)).add(sh);
    };
    if (handWorldL) wrist(w.handL, this._w.handL, -0.18);
    if (handWorldR) wrist(w.handR, this._w.handR, 0.18);
    const kh = Math.min(1, (handWorldL || handWorldR ? 16 : (walking ? 14 : 8)) * dt);
    T.handL.lerp(w.handL, kh);
    T.handR.lerp(w.handR, kh);
    T.footL.lerp(w.footL, Math.min(1, 18 * dt));
    T.footR.lerp(w.footR, Math.min(1, 18 * dt));
    T.hips.lerp(hips, k);
    T.lean = smooth(T.lean, lean, k);
    T.twist = smooth(T.twist, twist, k);
    T.headYaw = smooth(T.headYaw, headYaw, k);
    T.headPitch = smooth(T.headPitch, headPitch, k);
    T.crouch = smooth(T.crouch, crouch, k);
  }

  /** Put the skeleton where the targets say. */
  solve() {
    const b = this.bones, R = this.rest, D = this.dir, T = this.tgt;
    const actor = this.actor;
    const [sRight, sUp, sFwd, sTarget, sHint, sAim] = this._s;
    actor.updateWorldMatrix(true, false);

    // Everything starts from rest.
    for (const [n, q] of Object.entries(R)) b[n].quaternion.copy(q);

    // Hips: position in actor space -> armature space. A crouch takes the
    // hips down; the knees follow because the feet stay put.
    sTarget.copy(T.hips);
    sTarget.y -= T.crouch * 0.3;
    actor.localToWorld(sTarget);
    this.armature.updateWorldMatrix(true, false);
    b.Hips.position.copy(this.armature.worldToLocal(sTarget));

    // The actor's own axes, in the world.
    actor.getWorldQuaternion(this._sq);
    sRight.set(1, 0, 0).applyQuaternion(this._sq);
    sUp.set(0, 1, 0);
    sFwd.set(0, 0, -1).applyQuaternion(this._sq);

    // Spine lean and twist, head turn.
    turnAbout(b.Spine02, sRight, T.lean * 0.5);
    turnAbout(b.Spine01, sRight, T.lean * 0.5);
    turnAbout(b.Spine01, sUp, T.twist);
    turnAbout(b.Head, sUp, T.headYaw);
    turnAbout(b.Head, sRight, T.headPitch - T.lean * 0.6);

    // Legs, knees bending forward. The foot target is the ankle, a little
    // above the sole.
    for (const side of ['L', 'R']) {
      const foot = side === 'L' ? T.footL : T.footR;
      sTarget.copy(foot).setY(foot.y + 0.09);
      actor.localToWorld(sTarget);
      sHint.copy(sTarget).addScaledVector(sFwd, 0.6).addScaledVector(sUp, 0.5);
      const U = side === 'L' ? 'LeftUpLeg' : 'RightUpLeg', Lo = side === 'L' ? 'LeftLeg' : 'RightLeg';
      solveLimb(b[U], b[Lo], R[U], R[Lo], D[U], D[Lo], this.len.thigh, this.len.shin, sTarget, sHint);
      const F = side === 'L' ? 'LeftFoot' : 'RightFoot';
      sAim.copy(sFwd).addScaledVector(sUp, -0.35);
      aim(b[F], R[F], D[F], sAim);
    }

    // Arms, elbows out and back.
    for (const side of ['L', 'R']) {
      const sign = side === 'L' ? -1 : 1;
      sTarget.copy(side === 'L' ? T.handL : T.handR);
      actor.localToWorld(sTarget);
      // Elbows hang down and back, a touch out — not flared to the sides.
      sHint.copy(sTarget).addScaledVector(sRight, 0.16 * sign).addScaledVector(sFwd, -0.4).addScaledVector(sUp, -0.55);
      const U = side === 'L' ? 'LeftArm' : 'RightArm', Lo = side === 'L' ? 'LeftForeArm' : 'RightForeArm';
      solveLimb(b[U], b[Lo], R[U], R[Lo], D[U], D[Lo], this.len.upArm, this.len.foreArm, sTarget, sHint);
    }
  }
}
