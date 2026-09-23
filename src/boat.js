// The player's boat: hull model, rod rack, trawl gear, and drifty arcade
// physics. The hull is a glTF model loaded on demand from assets/boats; if
// it is missing or fails to load we fall back to a simple procedural skiff
// so the game always runs.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './config.js';
import { isNavigable } from './lake.js';
import { TrawlNet } from './net.js';
import { boatModelURL, resolveBoat, rodMounts } from './boats.js';
import { applySkin } from './skinner.js';
import { buildProceduralHull } from './hullshapes.js';
import { WakeTrail } from './wake.js';
import { Stacks } from './smoke.js';
import { driveHull, wrapAngle } from './hullphysics.js';
import { buildRod, aimRods, updateRods, castRod } from './rods.js';

const loader = new GLTFLoader();
const modelCache = new Map();   // hullId -> Promise<THREE.Object3D>

function loadHull(hullId) {
  if (!modelCache.has(hullId)) {
    modelCache.set(hullId, loader.loadAsync(boatModelURL(hullId)).then((gltf) => {
      const root = gltf.scene;
      root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = false;
          if (o.material) o.material.side = THREE.FrontSide;
        }
      });
      return root;
    }));
  }
  return modelCache.get(hullId);
}

// --- Procedural fallback hull (also used for not-yet-modelled boats) ---
function fallbackHull(length) {
  const g = new THREE.Group();
  const beam = length * 0.38;
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xc94f30, roughness: 0.45 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0xe6d7ae, roughness: 0.8 });
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0xf4efe2, roughness: 0.5 });

  const hullGeo = new THREE.BoxGeometry(beam, length * 0.18, length, 1, 1, 6);
  const pos = hullGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i) / length;
    if (z < -0.28) pos.setX(i, pos.getX(i) * (1 + z * 2.2));
    if (pos.getY(i) < 0) pos.setY(i, pos.getY(i) * (z < -0.28 ? 0.45 : 1));
  }
  hullGeo.computeVertexNormals();
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.position.y = length * 0.045;
  hull.castShadow = true;
  g.add(hull);

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(beam * 0.84, length * 0.015, length * 0.8), deckMat);
  deck.position.y = length * 0.132;
  g.add(deck);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(beam * 0.6, length * 0.14, length * 0.22), cabinMat);
  cabin.position.set(0, length * 0.2, -length * 0.06);
  cabin.castShadow = true;
  g.add(cabin);

  return g;
}

// --- Working machinery -----------------------------------------------------
//
// The converter carves the moving parts out of the hull model and exports
// each one as its own node, with the geometry shifted so the node sits on the
// part's pivot (an outboard's transom clamp, a paddlewheel's shaft). Anything
// tagged this way is collected here and driven from the hull's own motion.
// A hull with no tagged parts simply has none of this.
const ROD_HOLDER_H = 0.72;       // rail-height rod holders on the deck
const OUTBOARD_STEER = 0.52;     // radians the leg swings hard over
const OUTBOARD_TILT = 0.62;      // radians it lifts clear when idling

function collectParts(root) {
  const wheels = [];
  const outboards = [];
  root.traverse((o) => {
    const p = o.userData && o.userData.part;
    if (!p) return;
    o.rotation.order = 'YXZ';
    if (p.kind === 'wheel') {
      wheels.push({ node: o, radius: Math.max(0.2, p.radius || 1), arm: p.arm || 0, angle: 0 });
    } else if (p.kind === 'outboard') {
      outboards.push({ node: o, steer: 0, tilt: 0 });
    }
  });
  return { wheels, outboards };
}

export class Boat {
  constructor(scene, lake, player) {
    this.scene = scene;
    this.lake = lake;
    this.player = player;

    this.group = new THREE.Group();
    scene.add(this.group);

    this.hullHolder = new THREE.Group();
    this.group.add(this.hullHolder);
    this.rodHolder = new THREE.Group();
    this.group.add(this.rodHolder);

    this.rods = [];              // [{ group, tip, side, pos }]
    this.spec = resolveBoat(null);
    this.hullBounds = null;

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.yawVel = 0;             // smoothed rate of turn: heel, paddlewheels
    this.steerDemand = 0;        // raw helm demand, written by driveHull
    this.steerSmooth = 0;        // ... smoothed, for the outboard leg
    this.throttle = 0;           // smoothed, for trim and for the outboard
    this.trawling = false;
    this.parts = { wheels: [], outboards: [] };
    this.group.rotation.order = 'YXZ';   // yaw, then pitch, then roll
    this._ray = new THREE.Raycaster();
    this._rayFrom = new THREE.Vector3();
    this._rayDown = new THREE.Vector3(0, -1, 0);
    this._deckCache = new Map();

    this.net = new TrawlNet(scene);
    this._anchorL = new THREE.Vector3();
    this._anchorR = new THREE.Vector3();
    this._ropeL = new THREE.Vector3();
    this._ropeR = new THREE.Vector3();
    this._backDir = new THREE.Vector3();

    this.netHit = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 8, 8),
      new THREE.MeshBasicMaterial({ visible: false }));
    this.group.add(this.netHit);
    this.netBundle = this.buildNetBundle();
    this.group.add(this.netBundle);

    this.wake = new WakeTrail(scene);
    this.smoke = new Stacks(scene);
    this.onBoatChanged = null;
  }

  buildNetBundle() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x7d8a4c, roughness: 0.9 });
    const bundle = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 9), mat);
    bundle.scale.set(1.3, 0.65, 1);
    bundle.castShadow = true;
    g.add(bundle);
    const wire = new THREE.Mesh(new THREE.SphereGeometry(0.41, 9, 6),
      new THREE.MeshBasicMaterial({ color: 0x4c5530, wireframe: true, transparent: true, opacity: 0.5 }));
    wire.scale.copy(bundle.scale);
    g.add(wire);
    return g;
  }

  /**
   * Swap to a different boat. `key` is a skin key ("cuddy:cherry-red"): the
   * hull model is shared between a hull's skins and repainted on the way in.
   */
  async setBoat(key) {
    const spec = resolveBoat(key);
    this.spec = spec;

    // --- hull ---
    let hull = null;
    try {
      hull = (await loadHull(spec.hullId)).clone(true);
    } catch {
      hull = null;   // no model for this hull — build one
    }
    // A hull can carry its own procedural shape as a stand-in for a missing
    // model (hullshapes.js); a real GLB always takes precedence.
    if (!hull) hull = buildProceduralHull(spec.hullId, spec.length);
    if (!hull) hull = fallbackHull(spec.length);
    await applySkin(hull, spec);

    // Measure while the hull is still detached, so the box is in the hull's
    // own space. Box3.setFromObject works in WORLD space: measuring after
    // parenting it under a group that carries the boat's heading would report
    // a different beam depending on which way the boat happened to be
    // pointing, and drag the rod mounts and tow points around with it.
    const box = new THREE.Box3().setFromObject(hull);

    this.hullHolder.clear();
    this.hullHolder.add(hull);
    this.parts = collectParts(hull);
    this._deckCache.clear();

    this.hullBounds = {
      halfBeam: (box.max.x - box.min.x) / 2,
      deckY: Math.max(0.2, box.max.y * 0.22),
      minY: box.min.y,
      maxY: box.max.y,
      length: box.max.z - box.min.z,
    };

    // --- rods ---
    this.rodHolder.clear();
    this.rods = [];
    const rodScale = Math.min(1.9, Math.max(0.85, spec.length / 6));
    for (const m of rodMounts(spec, this.hullBounds)) {
      const r = buildRod(m.side, rodScale);
      // In a holder at rail height on the deck that is actually there, so a
      // fisherman standing beside it has the grip at the hip, not the knee.
      m.y = this.deckHeightAt(m.x, m.z) + ROD_HOLDER_H;
      r.rod.position.set(m.x, m.y, m.z);
      this.rodHolder.add(r.rod);
      this.rods.push({ ...r, group: r.rod, pos: new THREE.Vector3(m.x, m.y, m.z) });
    }

    // --- trawl gear placement ---
    const sternZ = this.hullBounds.length * 0.42;
    this.netHit.position.set(0, this.hullBounds.deckY + 0.4, sternZ);
    this.netBundle.position.copy(this.netHit.position);
    this.netBundle.visible = !!spec.features.trawl;
    if (this.trawling) this.setTrawling(false);

    // Wake size and churn are a cosmetic per-hull/per-skin signature.
    this.wake.setSpec(spec, this.hullBounds);
    // Only the steam hulls carry funnels; everything else gets an empty set.
    this.smoke.setStacks(spec.stacks);

    if (this.onBoatChanged) this.onBoatChanged(spec);
  }

  towPoints() {
    this.group.updateMatrixWorld();
    const b = this.hullBounds || { halfBeam: 1, deckY: 0.6, length: 4.6 };
    const sternZ = b.length * 0.5;
    this._anchorL.set(-b.halfBeam * 0.55, 0.05, sternZ);
    this._anchorR.set(b.halfBeam * 0.55, 0.05, sternZ);
    this._ropeL.set(-b.halfBeam * 0.5, b.deckY + 1.0, sternZ * 0.8);
    this._ropeR.set(b.halfBeam * 0.5, b.deckY + 1.0, sternZ * 0.8);
    this.group.localToWorld(this._anchorL);
    this.group.localToWorld(this._anchorR);
    this.group.localToWorld(this._ropeL);
    this.group.localToWorld(this._ropeR);
    this._backDir.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  setTrawling(on, netDef) {
    this.trawling = on;
    this.netBundle.visible = !on && !!this.spec.features.trawl;
    if (on) {
      this.towPoints();
      this.net.deploy(this._anchorL, this._anchorR, this._backDir, netDef?.color);
    } else {
      this.net.stow();
    }
  }

  /** Ease the nose toward a heading (used when casting). */
  nudgeHeading(target, amount) {
    this.heading = wrapAngle(this.heading + wrapAngle(target - this.heading) * amount);
  }

  /** Put the boat somewhere, dead in the water — used when berthing it. */
  placeAt(x, z, heading) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.yawVel = 0;
    this.steerDemand = 0;
    this.steerSmooth = 0;
    this.throttle = 0;
    this.heading = heading;
    this.group.position.set(x, 0.02, z);
    this.group.rotation.set(0, heading, 0);
    this.wake.reset();
    this.smoke.reset();
  }

  /** World position of a rod tip, written into `out`. */
  rodTipWorld(i, out) {
    const rod = this.rods[Math.min(i, this.rods.length - 1)];
    if (!rod) return out.set(this.pos.x, 1.5, this.pos.z);
    return rod.tip.getWorldPosition(out);
  }

  /** Point the working rods at their own lines (see rods.js). */
  aimRods(aims) {
    aimRods(this.rods, this.pos, this.heading, aims);
  }

  /** Swing rod `i` through a cast toward a bearing in the boat's frame. */
  castRod(i, yaw) {
    const r = this.rods[Math.min(i, this.rods.length - 1)];
    if (r) castRod(r, yaw);
  }

  /**
   * Height of the deck under a point in the boat's frame, for feet to stand
   * on. Rays down through the hull model and takes the surface nearest the
   * rod-mount deck level, so a hand on the rail of a two-storey riverboat
   * stands on the deck the rods are at rather than on the roof.
   */
  deckHeightAt(x, z) {
    const b = this.hullBounds;
    if (!b) return 0.5;
    const key = `${(x * 4) | 0},${(z * 4) | 0}`;
    const hit = this._deckCache.get(key);
    if (hit !== undefined) return hit;
    // The raycaster works in the world; the hull is under a group that
    // carries the boat's position and heading.
    this.group.updateWorldMatrix(true, false);
    this._rayFrom.set(x, b.maxY + 1, z);
    this.group.localToWorld(this._rayFrom);
    this._ray.set(this._rayFrom, this._rayDown);
    this._ray.far = b.maxY - b.minY + 2;
    const hits = this._ray.intersectObjects(this.hullHolder.children, true);
    let best = b.deckY, bestD = Infinity;
    for (const h of hits) {
      const y = h.point.y - this.group.position.y;
      // Prefer the surface nearest the rod deck, weighted toward being on
      // or above it rather than under it.
      const d = y >= b.deckY - 0.35 ? y - b.deckY : (b.deckY - y) * 3;
      if (d < bestD) { bestD = d; best = y; }
    }
    this._deckCache.set(key, best);
    return best;
  }

  /** Drive the carved-out machinery from the hull's own motion. */
  updateMachinery(dt) {
    for (const w of this.parts.wheels) {
      // Surface speed at this wheel: the hull's way through the water plus
      // whatever the turn adds on its side of the centreline. Put the helm
      // over far enough and the inner wheel backs down while the outer
      // drives on, which is how a paddler turns in the first place.
      w.angle = (w.angle + ((this.speed + this.yawVel * w.arm) / w.radius) * dt) % (Math.PI * 2);
      w.node.rotation.x = -w.angle;
    }
    if (!this.parts.outboards.length) return;
    // The leg answers the HELM, not the rate of turn: a boat can be hard
    // over and barely swinging, and the motor is still cocked right across.
    const steer = this.steerSmooth;
    const idle = this.speed < 0.7 && this.throttle < 0.05 ? 1 : 0;
    for (const o of this.parts.outboards) {
      o.steer += (steer * OUTBOARD_STEER - o.steer) * Math.min(1, 6 * dt);
      o.tilt += (idle * OUTBOARD_TILT - o.tilt) * Math.min(1, 1.8 * dt);
      // The leg hangs AFT of its pivot, and it is the prop that has to point
      // into the turn for the stern to be pushed the other way — so the node
      // swings against the yaw, not with it.
      o.node.rotation.y = -o.steer;
      o.node.rotation.x = -o.tilt;
    }
  }

  update(dt, inputVec, t) {
    const s = this.spec;
    const was = this.heading;
    driveHull(this, s, dt, inputVec, isNavigable);

    // Smoothed rate of turn and throttle: the machinery, the heel and the
    // trim all read these, and raw per-frame values are far too twitchy.
    const rate = dt > 0 ? wrapAngle(this.heading - was) / dt : 0;
    this.yawVel += (rate - this.yawVel) * Math.min(1, 5 * dt);
    const want = Math.min(1, Math.hypot(inputVec.x, inputVec.z));
    this.throttle += (want - this.throttle) * Math.min(1, 4 * dt);
    // What the leg answers: the helm demand plus however hard the hull is
    // actually coming round, so a nimble boat whose bow keeps up with the
    // stick still visibly cocks its motor over.
    const helm = Math.max(-1, Math.min(1, (this.steerDemand || 0) +
      this.yawVel / Math.max(0.2, s.yawRate)));
    this.steerSmooth += (helm - this.steerSmooth) * Math.min(1, 5 * dt);

    const bobY = this.lake.waveHeight(this.pos.x, this.pos.z, t);
    const scaleBob = Math.min(1, 6 / s.length);   // big hulls ride flatter
    // Heel into the turn and lift the bow under power — both scaled by how
    // fast the hull is actually moving, so a boat at rest just sits there.
    const drive = this.speed / Math.max(1, s.maxSpeed);
    const heel = Math.max(-0.3, Math.min(0.3, this.yawVel * drive * 0.42));
    const trim = this.throttle * drive * 0.09 * scaleBob;
    this.group.position.set(this.pos.x, bobY * scaleBob + 0.02, this.pos.z);
    this.group.rotation.set(
      Math.sin(t * 0.9) * 0.02 * scaleBob + trim,
      this.heading,
      Math.sin(t * 1.3) * 0.025 * scaleBob + heel * Math.min(1, 9 / s.length),
    );

    updateRods(this.rods, dt);
    this.updateMachinery(dt);
    this.wake.update(dt, t, this);
    this.smoke.update(dt, t, this);
    if (this.trawling) {
      this.towPoints();
      this.net.update(dt, t, this._anchorL, this._anchorR, this._ropeL, this._ropeR);
    }
  }
}
