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
import { DeckMap } from './deckmap.js';
import { stationsFor, rodHolders } from './stations.js';

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
const ROD_HOLDER_H = 0.72;       // rail-height rod holders on a hull with no stations
const ROD_GRIP_H = 1.02;         // the grip sits here above the deck, for a 1.7m body
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

    // Everything measured in the hull's own frame — the model, the rods, the
    // people, the net gear — hangs under this, which is lifted by the hull's
    // freeboard so its lowest deck sits clear of the water.
    this.hullFrame = new THREE.Group();
    this.group.add(this.hullFrame);
    this.lift = 0;
    this.hullHolder = new THREE.Group();
    this.hullFrame.add(this.hullHolder);
    this.rodHolder = new THREE.Group();
    this.hullFrame.add(this.rodHolder);

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
    this.hullFrame.add(this.netHit);
    this.netBundle = this.buildNetBundle();
    this.hullFrame.add(this.netBundle);

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

    // The working deck, and where a person can stand on it. Built while the
    // hull is still detached, in its own frame. Stations are measured off
    // each model by hand (stations.js); a hull with none gets the old
    // guess and a deck map at it.
    this.stations = stationsFor(spec.hullId);
    const st = this.stations;
    const range = st?.deck || [Math.max(0.2, box.max.y * 0.22) - 0.45, Math.max(0.2, box.max.y * 0.22) + 0.45];
    const deckY = st?.helm?.y ?? (range[0] + range[1]) / 2;
    this.crewScale = st?.crewScale ?? 1;
    this.deck = new DeckMap(hull, range, box, {
      cell: st?.cell || 0.5,
      headroom: 1.7 * this.crewScale + 0.02,
      links: st?.links || [],
      join: st?.join,
      from: st?.helm || null,
    });

    this.hullHolder.clear();
    this.hullHolder.add(hull);
    this.parts = collectParts(hull);
    this._deckCache.clear();
    this.lift = st?.lift ?? 0;
    this.hullFrame.position.y = this.lift;

    // The deck the trawl gear sits on: where the net hand stands, if the
    // hull has one, else the working deck.
    const netY = st?.posts?.find((p) => p.kind === 'net')?.y ?? deckY;
    this.hullBounds = {
      halfBeam: (box.max.x - box.min.x) / 2,
      deckY: netY,
      minY: box.min.y,
      maxY: box.max.y,
      length: box.max.z - box.min.z,
    };

    // --- rods ---
    this.rodHolder.clear();
    this.rods = [];
    // Rods are sized to the people who work them, a little longer on the
    // big boats so they still read from the game's camera.
    const rodScale = st
      ? this.crewScale * (0.85 + 0.55 * Math.min(1, Math.max(0, (spec.length - 4.6) / 22)))
      : Math.min(1.9, Math.max(0.85, spec.length / 6));
    const authored = rodHolders(spec.hullId, spec.rods);
    const mounts = authored || this.rodPositions(spec);
    for (const m of mounts) {
      const r = buildRod(m.side, rodScale);
      // In a holder on the rail, set so the grip comes to the chest of the
      // fisherman standing beside it — the hands go to the grip, so its
      // height decides whether the arms look right.
      r.rod.updateMatrix();
      const gripOff = r.grip.position.clone().applyMatrix4(r.rod.matrix);   // grip, rod at the origin
      const deckAt = authored ? (m.standY ?? m.y) : this.deckHeightAt(m.x, m.z);
      m.y = authored ? deckAt + ROD_GRIP_H * this.crewScale - gripOff.y : deckAt + ROD_HOLDER_H * this.crewScale;
      r.rod.position.set(m.x, m.y, m.z);
      this.rodHolder.add(r.rod);
      // Where the grip rests, in the boat's frame, for whoever comes to work it.
      const gripRest = gripOff.clone().add(r.rod.position);
      this.rods.push({ ...r, group: r.rod, pos: new THREE.Vector3(m.x, m.y, m.z), deckY: deckAt, gripRest });
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
    this.hullFrame.localToWorld(this._anchorL);
    this.hullFrame.localToWorld(this._anchorR);
    this.hullFrame.localToWorld(this._ropeL);
    this.hullFrame.localToWorld(this._ropeR);
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

  /**
   * Rod holders along the real edge of the working deck — the deck map's
   * rail, not the bounding box's widest point (on the paddlers that is the
   * wheel housing, hanging out over the water). Pairs are spread along
   * whatever length of deck each side has.
   */
  rodPositions(spec) {
    const n = spec.rods;
    const d = this.deck;
    const fallback = rodMounts(spec, this.hullBounds);
    if (!d) return fallback;
    // Every station along the hull where this side has deck, then holders
    // spread over those — a paddler's side walkways are under an overhang
    // and the holders skip them for the open decks fore and aft.
    const railZ = { 1: [], '-1': [] };
    for (const side of [1, -1]) {
      for (let iz = 0; iz < d.nz; iz++) {
        const z = d.minZ + iz * d.cell;
        if (d.railAt(z, side) !== null) railZ[side].push(z);
      }
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const side = n === 1 ? 1 : (i % 2 === 0 ? 1 : -1);
      const zs = railZ[side];
      if (zs.length < 2) { out.push(fallback[i]); continue; }
      const pairs = Math.max(1, Math.ceil(n / 2));
      const pair = Math.floor(i / 2);
      // Aft to forward, keeping the very ends clear.
      const t = pairs === 1 ? 0.5 : pair / (pairs - 1);
      const lo = Math.floor(zs.length * 0.12), hi = Math.ceil(zs.length * 0.88) - 1;
      const z = zs[Math.round(hi - (hi - lo) * t)];
      const rail = d.railAt(z, side);
      out.push({ x: rail + side * 0.1, y: 0, z, side });
    }
    return out;
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
  deckHeightAt(x, z, yHint) {
    const b = this.hullBounds;
    if (!b) return 0.5;
    if (this.deck) {
      const h = this.deck.heightAt(x, z, yHint);
      if (Number.isFinite(h) && (yHint == null || Math.abs(h - yHint) < 1.0)) return h;
    }
    const key = `${(x * 4) | 0},${(z * 4) | 0}`;
    const hit = this._deckCache.get(key);
    if (hit !== undefined) return hit;
    // The raycaster works in the world; the hull is under a group that
    // carries the boat's position and heading.
    this.hullFrame.updateWorldMatrix(true, false);
    this._rayFrom.set(x, b.maxY + 1, z);
    this.hullFrame.localToWorld(this._rayFrom);
    this._ray.set(this._rayFrom, this._rayDown);
    this._ray.far = b.maxY - b.minY + 2;
    const hits = this._ray.intersectObjects(this.hullHolder.children, true);
    let best = b.deckY, bestD = Infinity;
    for (const h of hits) {
      const y = this.hullFrame.worldToLocal(this._rayFrom.copy(h.point)).y;
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
