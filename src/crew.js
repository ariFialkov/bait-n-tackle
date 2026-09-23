// Fishermen. The rigged characters that live on the boats: how one is
// loaded and dressed, and how it moves.
//
// The models arrive as bare skeletons with no animation, so everything they
// do is built here, on the bones, every frame: the hips are placed, the
// spine and head are leaned and turned, and the limbs are solved with a
// two-bone IK toward hand and foot targets, then the wrists are set so the
// hands follow the forearm (or lie along a rod) instead of taking whatever
// twist the solve left. Those targets are what a state is — idle, walk,
// hold a rod, reel, take a wheel standing or seated, a hand on an outboard's
// tiller, a console, a crane's levers, a net at the stern, the rail — and
// states cross-fade by easing the targets, so a hand that was on the wheel
// travels to the rod grip rather than jumping there.
//
// Working a rod is deliberately built ON the rod (rods.js): the hands chase
// the rod's own grip and reel, so when the rod sweeps through a cast or
// bends under a fish the fisherman follows it exactly and the two can never
// disagree.
//
// Coordinates: an actor stands at its own origin, feet on the deck, facing
// -z (the same convention as the boat, bow at -z). Targets are set in actor
// space — a 1.7m body, scaled as a whole to suit the boat — and solved in
// world space.

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
const wrapA = (a) => { while (a > Math.PI) a -= 6.283185307; while (a < -Math.PI) a += 6.283185307; return a; };

// Where the shoulders are in actor space (a 1.7m body).
const SHOULDER_Y = 1.26, SHOULDER_X = 0.18;

// --- the character ---------------------------------------------------------

/**
 * One fisherman. `id` picks the body (captain, bosun, deckhand, engineer);
 * `look` recolours the clothes, or null keeps them as painted; `scale`
 * sizes the whole figure to the boat it is on.
 */
export class Character {
  constructor(id, look = null, scale = 1) {
    this.id = id;
    this.look = look;
    this.scale = scale;
    this.actor = new THREE.Group();          // where they stand, which way they face
    this.actor.rotation.order = 'YXZ';
    this.actor.scale.setScalar(scale);
    this.ready = false;

    this.state = 'idle';
    this.speed = 0;
    this.stride = 0;                          // walk phase
    this.facing = 0;
    this.pos = new THREE.Vector2();           // deck position (x, z) in the parent's frame
    this.route = null;                        // waypoints still to walk
    this.goalFacing = null;
    this.walkSpeed = 2.4 * scale;
    this.oneShot = null;                      // { name, t, dur }
    this.rod = null;                          // the rod being worked, if any
    this.lookAt = null;                       // world point the head follows
    this.handWorld = { L: null, R: null };    // world points a hand should be on
    this.seatH = 0.5;                         // hips above the origin when seated (body units)
    this.railH = 0.98;                        // the rail a lookout leans on (body units)
    this.aimFacing = null;                    // a direction to work toward (parent frame yaw)
    this._aimTwist = 0;                       // how far the torso turns to it, feet planted
    this.y = 0;
    this._leg = null;                         // start of the current route leg
    this.palm = { L: null, R: null };         // which way each palm faces (actor space)
    this.palmWorld = { L: false, R: false };  // ... or world space, when holding something

    this.tgt = {
      handL: new THREE.Vector3(-0.24, 0.95, 0.03), handR: new THREE.Vector3(0.24, 0.95, 0.03),
      footL: new THREE.Vector3(-0.13, 0, 0), footR: new THREE.Vector3(0.13, 0, 0),
      hips: new THREE.Vector3(0, 0.92, 0),
      lean: 0, twist: 0, headYaw: 0, headPitch: 0, crouch: 0,
    };
    this._want = {
      handL: new THREE.Vector3(), handR: new THREE.Vector3(),
      footL: new THREE.Vector3(), footR: new THREE.Vector3(), hips: new THREE.Vector3(),
    };
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._s = Array.from({ length: 8 }, () => new THREE.Vector3());
    this._sq = new THREE.Quaternion();
    this.phase = Math.random() * 6.28;
    this.graspDir = { L: null, R: null };     // world direction a hand lies along

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

    scene.rotation.y = Math.PI;              // the model faces +z; the actor faces -z
    this.model = scene;
    this.actor.add(scene);

    const bones = {};
    scene.traverse((o) => { if (o.isBone) bones[o.name] = o; });
    this.bones = bones;
    this.armature = bones.Hips.parent;
    this.rest = {};
    for (const [n, b] of Object.entries(bones)) this.rest[n] = b.quaternion.clone();

    const ld = (c) => c.position.clone().normalize();
    this.dir = {
      LeftArm: ld(bones.LeftForeArm), LeftForeArm: ld(bones.LeftHand), LeftHand: ld(bones.LeftHand_End),
      RightArm: ld(bones.RightForeArm), RightForeArm: ld(bones.RightHand), RightHand: ld(bones.RightHand_End),
      LeftUpLeg: ld(bones.LeftLeg), LeftLeg: ld(bones.LeftFoot), LeftFoot: ld(bones.LeftToeBase),
      RightUpLeg: ld(bones.RightLeg), RightLeg: ld(bones.RightFoot), RightFoot: ld(bones.RightToeBase),
    };
    // Segment lengths in the unscaled body; scaled at solve time.
    scene.updateWorldMatrix(true, true);
    const wl = (a, b) => bones[a].getWorldPosition(_v1).distanceTo(bones[b].getWorldPosition(_v2));
    const inv = 1 / (this.actor.scale.x || 1);
    this.len = {
      upArm: wl('LeftArm', 'LeftForeArm') * inv, foreArm: wl('LeftForeArm', 'LeftHand') * inv,
      thigh: wl('LeftUpLeg', 'LeftLeg') * inv, shin: wl('LeftLeg', 'LeftFoot') * inv,
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

  /**
   * Walk to a spot on the deck and face `facing` there. `pathfinder(ax, az,
   * bx, bz)` returns waypoints round whatever is in the way; without one the
   * route is a straight line.
   */
  goTo(x, z, facing, pathfinder, y) {
    if (this.route && this.route.length) {
      const end = this.route[this.route.length - 1];
      if (Math.abs(end.x - x) < 1e-3 && Math.abs(end.z - z) < 1e-3) { this.goalFacing = facing ?? this.goalFacing; return; }
    }
    const pts = pathfinder ? pathfinder(this.pos.x, this.pos.y, x, z, this.y, y) : null;
    this.route = pts && pts.length ? pts : [{ x, z }];
    this.goalFacing = facing ?? this.facing;
    this._leg = { x: this.pos.x, z: this.pos.y, y: this.y };
  }

  /** Stand here at once (used when boarding a boat). */
  placeAt(x, z, facing) {
    this.pos.set(x, z);
    this.facing = facing;
    this.route = null;
    this.goalFacing = null;
    this.actor.position.set(x, this.actor.position.y, z);
    this.actor.rotation.y = facing;
  }

  /** Change what the body is doing once it is where it is going. */
  setState(name) { this.state = name; }

  /** Play a one-shot gesture (cast, point, wave) over the current state. */
  play(name, dur) { this.oneShot = { name, t: 0, dur }; }

  get arrived() { return !this.route; }

  /** There, and turned toward whatever they are aiming at. */
  get aimed() { return !this.route && this.goalFacing == null; }

  /** How far along the deck to where they are going. */
  get remaining() {
    if (!this.route) return 0;
    let d = 0, px = this.pos.x, pz = this.pos.y;
    for (const p of this.route) { d += Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z; }
    return d;
  }

  // --- per frame ------------------------------------------------------------

  /**
   * `deckY(x, z)` gives the deck height under a point in the parent's frame
   * (NaN keeps the last height); `ctx` carries `steer` for the wheel.
   */
  update(dt, t, deckY, ctx = {}) {
    // Movement along the route.
    let climbY = null;              // height while on a ladder leg
    if (this.route) {
      const wp = this.route[0];
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.y;
      const dist = Math.hypot(dx, dz);
      const last = this.route.length === 1;
      // A leg with a height at its end is a ladder: climb it as it is walked.
      const leg = this._leg;
      if (wp.y != null && leg && leg.y != null) {
        const len = Math.hypot(wp.x - leg.x, wp.z - leg.z) || 1e-3;
        climbY = leg.y + (wp.y - leg.y) * Math.min(1, Math.max(0, 1 - dist / len));
      }
      if (dist < (last ? 0.08 : 0.2)) {
        if (last) {
          this.pos.set(wp.x, wp.z);
          this.route = null;
        } else {
          this.route.shift();
        }
        this._leg = { x: wp.x, z: wp.z, y: wp.y ?? this.y };
      } else {
        const slow = climbY != null ? 0.55 : 1;
        const want = Math.min(this.walkSpeed * slow, last ? dist * 3 + 0.3 : this.walkSpeed * slow);
        this.speed = smooth(this.speed, want, Math.min(1, 6 * dt));
        const step = Math.min(dist, this.speed * dt);
        this.pos.x += dx / dist * step;
        this.pos.y += dz / dist * step;
        const wantF = Math.atan2(-dx, -dz);
        this.facing += wrapA(wantF - this.facing) * Math.min(1, 10 * dt);
      }
    }
    if (!this.route) {
      this.speed = smooth(this.speed, 0, Math.min(1, 10 * dt));
      // Aiming: the torso turns as far as it comfortably can with the feet
      // planted; further than that and the feet come round too.
      let aimTwist = 0;
      if (this.aimFacing != null) {
        const d = wrapA(this.aimFacing - this.facing);
        if (Math.abs(d) > 1.0 && this.goalFacing == null) this.goalFacing = this.aimFacing;
        aimTwist = Math.max(-1.0, Math.min(1.0, d));
      }
      this._aimTwist = smooth(this._aimTwist, aimTwist, Math.min(1, 6 * dt));
      if (this.goalFacing != null) {
        const d = wrapA(this.goalFacing - this.facing);
        this.facing += d * Math.min(1, 8 * dt);
        if (Math.abs(d) < 0.03) { this.facing = this.goalFacing; this.goalFacing = null; }
      }
    }
    this.stride += (this.speed / (0.34 * this.scale)) * dt;
    // Feet on the floor under them — eased, so a hatch coaming is stepped
    // up rather than popped up.
    const y = climbY != null ? climbY : (deckY ? deckY(this.pos.x, this.pos.y, this.y) : 0);
    if (Number.isFinite(y)) this.y = Math.abs(y - this.y) < 0.02 ? y : smooth(this.y, y, Math.min(1, 12 * dt));
    this.actor.position.set(this.pos.x, this.y, this.pos.y);
    this.actor.rotation.y = this.facing;
    if (!this.ready) return;

    if (this.oneShot) {
      this.oneShot.t += dt;
      if (this.oneShot.t >= this.oneShot.dur) this.oneShot = null;
    }
    this.pose(dt, t, ctx);
    this.solve();
  }

  /** A world hand target as a wrist target in actor space, kept in reach. */
  wristFor(out, worldPt, sx, crouch, hipsY, lean, twist = 0) {
    this.actor.updateWorldMatrix(true, false);
    out.copy(this.actor.worldToLocal(this._tmp2.copy(worldPt)));
    // The shoulder, carried round by however far the torso is turned.
    const sz = -lean * 0.3;
    const sh = this._tmp.set(sx * Math.cos(twist) + sz * Math.sin(twist),
      SHOULDER_Y - crouch * 0.3 + hipsY - this.hipHeight,
      -sx * Math.sin(twist) + sz * Math.cos(twist));
    out.sub(sh);
    const reach = this.len.upArm + this.len.foreArm - 0.01;
    const d = out.length();
    out.multiplyScalar(Math.min(reach, Math.max(0.05, d - 0.10)) / Math.max(1e-4, d)).add(sh);
  }

  /** Decide this frame's targets from the state, then ease toward them. */
  pose(dt, t, ctx) {
    const w = this._want;
    const T = this.tgt;
    const ph = t * 1.4 + this.phase;
    let lean = 0.04, twist = 0, headYaw = 0, headPitch = 0.05, crouch = 0;
    const walking = this.speed > 0.12 * this.scale;
    const hips = w.hips.set(0, this.hipHeight, 0);
    const handW = { L: null, R: null };
    this.graspDir.L = this.graspDir.R = null;
    // Palms: inward to the thigh unless a state says otherwise.
    const palm = this.palm;
    palm.L = this._pL || (this._pL = new THREE.Vector3());
    palm.R = this._pR || (this._pR = new THREE.Vector3());
    palm.L.set(1, 0, 0); palm.R.set(-1, 0, 0);
    this.palmWorld.L = this.palmWorld.R = false;
    const name = this.state;
    const seated = !walking && (name === 'seat' || name === 'tiller' || name === 'sit');

    // Feet and hips.
    if (walking) {
      const s = this.stride;
      const A = 0.30 * Math.min(1, this.speed / (1.4 * this.scale));
      w.footL.set(-0.12, Math.max(0, -Math.sin(s)) * 0.13, -A * Math.cos(s));
      w.footR.set(0.12, Math.max(0, -Math.sin(s + Math.PI)) * 0.13, -A * Math.cos(s + Math.PI));
      hips.y -= 0.03 + 0.025 * Math.abs(Math.cos(s));
      lean = 0.16 * Math.min(1, this.speed / (1.4 * this.scale));
    } else if (seated) {
      hips.y = this.seatH;
      hips.z = 0.05;
      const fwd = 0.30 + (this.hipHeight - this.seatH) * 0.35;
      w.footL.set(-0.15, 0, -fwd);
      w.footR.set(0.15, 0, -fwd);
    } else {
      w.footL.set(-0.14, 0, 0.02);
      w.footR.set(0.14, 0, -0.02);
      hips.y -= 0.01 + 0.008 * Math.sin(ph * 0.5);
    }

    // Hands, by state.
    if (walking) {
      const s = this.stride;
      w.handL.set(-0.24, 0.98, 0.14 * Math.cos(s + Math.PI));
      w.handR.set(0.24, 0.98, 0.14 * Math.cos(s));
    } else if ((name === 'hold' || name === 'reel') && this.rod) {
      // Hands on the rod: right on the grip, left at the reel — and when
      // reeling the left hand cranks a small circle beside it.
      const r = this.rod;
      handW.R = r.grip.getWorldPosition(this._s[6]);
      handW.L = r.reel.getWorldPosition(this._s[7]);
      if (name === 'reel') {
        const c = t * 9;
        handW.L.x += Math.cos(c) * 0.05 * this.scale;
        handW.L.y += Math.sin(c) * 0.05 * this.scale;
      }
      // The hands lie along the blank, palms wrapped onto it.
      const up = this._tmp.subVectors(r.tip.getWorldPosition(this._tmp), handW.R).normalize();
      this.graspDir.R = up.clone(); this.graspDir.L = up.clone();
      const axis = r.rod.getWorldPosition(this._tmp2);       // a point on the blank, below the grip
      palm.R.subVectors(axis, handW.R); palm.R.addScaledVector(up, -up.dot(palm.R)).normalize();
      palm.L.subVectors(axis, handW.L); palm.L.addScaledVector(up, -up.dot(palm.L)).normalize();
      this.palmWorld.L = this.palmWorld.R = true;
      lean = name === 'reel' ? 0.06 : 0.14;
      crouch = name === 'reel' ? 0.10 : 0.06;
      headPitch = 0.18;
    } else if (name === 'wheel' || name === 'seat') {
      // A wheel in front at chest height; the hands ride round with it.
      const a = (ctx.steer || 0) * 0.7;
      const y0 = seated ? this.seatH + 0.42 : 1.08, z0 = seated ? -0.30 : -0.26;
      w.handL.set(-0.17 * Math.cos(a), y0 + 0.17 * Math.sin(a), z0);
      w.handR.set(0.17 * Math.cos(a), y0 - 0.17 * Math.sin(a), z0);
      palm.L.set(0, 0, -1); palm.R.set(0, 0, -1);                 // onto the rim
      lean = seated ? 0.04 : 0.08;
      twist = (ctx.steer || 0) * 0.12;
    } else if (name === 'tiller') {
      // Seated at the stern, right arm back on the outboard's tiller, the
      // body turned toward it, eyes ahead.
      handW.R = this.handWorld.R;
      w.handL.set(-0.22, this.seatH + 0.28, -0.10);
      palm.R.set(0, -1, 0); palm.L.set(0, -1, 0);
      twist = -0.45;
      lean = -0.05;
      headYaw = 0.25;
    } else if (name === 'sit') {
      w.handL.set(-0.20, this.seatH + 0.20, -0.16);
      w.handR.set(0.20, this.seatH + 0.20, -0.16);
      palm.L.set(0, -1, 0); palm.R.set(0, -1, 0);
      lean = -0.04;
    } else if (name === 'console') {
      // Bent over a console: hands low in front, eyes on it, and a finger
      // that taps now and again.
      const tap = Math.max(0, Math.sin(ph * 2.3)) * 0.04;
      w.handL.set(-0.16, 1.02 + tap, -0.24);
      w.handR.set(0.16, 1.00, -0.24);
      palm.L.set(0, -1, -0.3); palm.R.set(0, -1, -0.3);
      lean = 0.22; crouch = 0.04; headPitch = 0.42;
    } else if (name === 'crane') {
      // On the levers: hands forward at the hip, one easing back and forth.
      const pull = Math.sin(ph * 0.9) * 0.06;
      w.handL.set(-0.14, 0.98, -0.24 + pull);
      w.handR.set(0.16, 1.00, -0.26 - pull * 0.5);
      lean = 0.10; headPitch = 0.1; headYaw = 0.35;
    } else if (name === 'net') {
      // Ready at the stern: crouched a little, hands low holding the net,
      // watching the water.
      const heave = Math.max(0, Math.sin(ph * 0.6)) * 0.04;
      w.handL.set(-0.20, 0.80 + heave, -0.22);
      w.handR.set(0.22, 0.78 + heave, -0.20);
      palm.L.set(0.4, -1, 0); palm.R.set(-0.4, -1, 0);
      lean = 0.18; crouch = 0.12; headPitch = 0.30;
    } else if (name === 'rail') {
      // Leaning on the rail, weight on the hands, looking out. A low rail
      // has them bent further over it.
      const rh = Math.min(1.02, Math.max(0.5, this.railH));
      w.handL.set(-0.20, rh + 0.02, -0.28);
      w.handR.set(0.20, rh + 0.02, -0.28);
      palm.L.set(0, -1, 0); palm.R.set(0, -1, 0);
      lean = 0.16 + (1.0 - rh) * 0.5; crouch = 0.03 + (1.0 - rh) * 0.15;
      headYaw = 0.25 * Math.sin(ph * 0.35);
      headPitch = 0.08;
    } else if (name === 'lounge') {
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

    // The torso turned toward what the hands are working, feet planted.
    if (!walking && this._aimTwist) twist += this._aimTwist;

    // One-shot gestures ride over the state.
    if (this.oneShot) {
      const k = this.oneShot.t / this.oneShot.dur;
      if (this.oneShot.name === 'point') {
        const up = k < 0.25 ? k / 0.25 : k > 0.8 ? (1 - k) / 0.2 : 1;
        const e = up * up * (3 - 2 * up);
        w.handR.set(0.24 + 0.04 * e, 0.95 + 0.35 * e, 0.03 - 0.33 * e);
        w.handL.set(-0.24, 0.95 + 0.06 * e, 0.03);
        headYaw = -0.25 * e; twist = -0.2 * e;
        handW.R = null;
      } else if (this.oneShot.name === 'wave') {
        const e = Math.sin(Math.min(1, k) * Math.PI);
        w.handR.set(0.30, 0.95 + 0.55 * e, -0.02 + 0.08 * Math.sin(t * 12) * e);
        handW.R = null;
      } else if (this.oneShot.name === 'cast' && this.rod) {
        // The rod does the sweep (rods.js); the body steps into it.
        const e = Math.sin(Math.min(1, k) * Math.PI);
        lean = 0.22 * (k < 0.45 ? -1 : 1) * e;
        crouch = 0.05 * e;
        hips.z = 0.06 * (k < 0.45 ? 1 : -1) * e;
      }
    }

    // World hand points become wrist targets within reach.
    if (handW.L) this.wristFor(w.handL, handW.L, -SHOULDER_X, crouch, hips.y, lean, twist);
    if (handW.R) this.wristFor(w.handR, handW.R, SHOULDER_X, crouch, hips.y, lean, twist);

    // Head: follow a world point if there is one (less what the torso
    // already turned).
    if (this.lookAt && !this.oneShot) {
      this.actor.updateWorldMatrix(true, false);
      const local = this._tmp.copy(this.lookAt);
      this.actor.worldToLocal(local);
      local.y -= 1.5;
      headYaw = Math.max(-1.0, Math.min(1.0, Math.atan2(-local.x, -local.z) - twist));
      headPitch = Math.max(-0.5, Math.min(0.6, -Math.atan2(local.y, Math.hypot(local.x, local.z))));
    }

    // Ease everything.
    const k = Math.min(1, (walking ? 14 : 8) * dt);
    const kh = Math.min(1, (handW.L || handW.R ? 16 : (walking ? 14 : 8)) * dt);
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
    const sc = actor.scale.x || 1;
    const [sRight, sUp, sFwd, sTarget, sHint, sAim] = this._s;
    actor.updateWorldMatrix(true, false);

    for (const [n, q] of Object.entries(R)) b[n].quaternion.copy(q);

    // Hips: position in actor space -> armature space. A crouch takes the
    // hips down; the knees follow because the feet stay put.
    sTarget.copy(T.hips);
    sTarget.y -= T.crouch * 0.3;
    actor.localToWorld(sTarget);
    this.armature.updateWorldMatrix(true, false);
    b.Hips.position.copy(this.armature.worldToLocal(sTarget));

    actor.getWorldQuaternion(this._sq);
    sRight.set(1, 0, 0).applyQuaternion(this._sq);
    sUp.set(0, 1, 0);
    sFwd.set(0, 0, -1).applyQuaternion(this._sq);

    turnAbout(b.Spine02, sRight, T.lean * 0.5);
    turnAbout(b.Spine01, sRight, T.lean * 0.5);
    turnAbout(b.Spine01, sUp, T.twist);
    turnAbout(b.Head, sUp, T.headYaw);
    turnAbout(b.Head, sRight, T.headPitch - T.lean * 0.6);

    // Legs, knees bending forward. The foot target is the ankle.
    for (const side of ['L', 'R']) {
      const foot = side === 'L' ? T.footL : T.footR;
      sTarget.copy(foot).setY(foot.y + 0.09);
      actor.localToWorld(sTarget);
      sHint.copy(sTarget).addScaledVector(sFwd, 0.6 * sc).addScaledVector(sUp, 0.5 * sc);
      const U = side === 'L' ? 'LeftUpLeg' : 'RightUpLeg', Lo = side === 'L' ? 'LeftLeg' : 'RightLeg';
      solveLimb(b[U], b[Lo], R[U], R[Lo], D[U], D[Lo], this.len.thigh * sc, this.len.shin * sc, sTarget, sHint);
      const F = side === 'L' ? 'LeftFoot' : 'RightFoot';
      sAim.copy(sFwd).addScaledVector(sUp, -0.35);
      aim(b[F], R[F], D[F], sAim);
    }

    // Arms: elbows down and back, a touch out. Then the wrist, which follows
    // the forearm unless the hand is holding something with a direction.
    for (const side of ['L', 'R']) {
      const sign = side === 'L' ? -1 : 1;
      sTarget.copy(side === 'L' ? T.handL : T.handR);
      actor.localToWorld(sTarget);
      sHint.copy(sTarget).addScaledVector(sRight, 0.16 * sign * sc).addScaledVector(sFwd, -0.4 * sc).addScaledVector(sUp, -0.55 * sc);
      const U = side === 'L' ? 'LeftArm' : 'RightArm', Lo = side === 'L' ? 'LeftForeArm' : 'RightForeArm';
      const H = side === 'L' ? 'LeftHand' : 'RightHand';
      solveLimb(b[U], b[Lo], R[U], R[Lo], D[U], D[Lo], this.len.upArm * sc, this.len.foreArm * sc, sTarget, sHint);
      const grasp = this.graspDir[side];
      if (grasp) {
        sAim.copy(grasp);
      } else {
        b[Lo].updateWorldMatrix(true, false);
        b[H].updateWorldMatrix(true, false);
        sAim.subVectors(b[H].getWorldPosition(_v1), b[Lo].getWorldPosition(_v2));
      }
      aim(b[H], R[H], D[H], sAim);
      // Then the roll of the wrist: turn the hand about the fingers so the
      // palm faces where the state wants it (the rod, the wheel, the thigh).
      // On this rig the palm is the hand bone's -x (right) / +x (left).
      const want = this.palm[side];
      if (want) {
        sTarget.copy(want);
        if (!this.palmWorld[side]) sTarget.applyQuaternion(this._sq);
        b[H].updateWorldMatrix(true, false);
        b[H].getWorldQuaternion(_q2);
        const fingers = _v1.copy(D[H]).applyQuaternion(_q2).normalize();
        const palmNow = _v2.set(side === 'L' ? 1 : -1, 0, 0).applyQuaternion(_q2);
        palmNow.addScaledVector(fingers, -palmNow.dot(fingers)).normalize();
        sTarget.addScaledVector(fingers, -sTarget.dot(fingers));
        if (sTarget.lengthSq() > 1e-6) {
          sTarget.normalize();
          const ang = Math.atan2(_v3.crossVectors(palmNow, sTarget).dot(fingers), palmNow.dot(sTarget));
          turnAbout(b[H], fingers, ang);
        }
      }
    }
  }
}
