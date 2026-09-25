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
import { driveHull, wrapAngle, aground } from './hullphysics.js';
import { buildRod, buildHolder, aimRods, updateRods, castRod, HOLDER_LAY } from './rods.js';
import { DeckMap } from './deckmap.js';
import { stationsFor, rodHolders } from './stations.js';
import { DeckCrane } from './crane.js';

// The net goes over the stern in stages (see updateNetAnim): lifted off the
// deck to the gallows, swung out over the transom, dropped in; then it pays
// out from a bundle into its full funnel. Stowing is the same in reverse.
const NET_LIFT_S = 0.8, NET_SWING_S = 0.7, NET_DROP_S = 0.5;
const NET_CARRY_S = NET_LIFT_S + NET_SWING_S + NET_DROP_S;
const NET_PAYOUT_S = 1.6, NET_GATHER_S = 1.4;
// With a hand to throw it: waits this long for one to come, is lifted into
// the hands, held through the wind-up, and flies off the whip of the throw.
const NET_WAIT_S = 2.2, NET_PICKUP_S = 0.45, NET_WHIP_S = 0.48, NET_FLY_S = 0.6, NET_HAUL_S = 0.8;
// The trawler's gallows: how far the A-frame swings down to put the cone in
// the water, and how fast; the gillnetter's drum: how fast it turns.
const BOOM_DOWN = 0.66, BOOM_RATE = 0.36, DRUM_RATE = 2.2;
// The cone's wire pays out at this rate, until the cone is this far under.
const CONE_WIRE_RATE = 1.6, CONE_UNDER = 0.4;
const CONE_SWING_K = 9, CONE_SWING_C = 1.6;          // the hanging cone as a pendulum
const WIRE_MAT = new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.6, metalness: 0.4 });
const smooth = (k) => k * k * (3 - 2 * k);

const loader = new GLTFLoader();
const modelCache = new Map();   // hullId -> Promise<THREE.Object3D>

export function loadHull(hullId) {
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
const ROD_HOLDER_H = 0.72;       // the rod holder's mouth, this far above the deck for a 1.7m body
const OUTBOARD_STEER = 0.52;     // radians the leg swings hard over
const OUTBOARD_TILT = 0.62;      // radians it lifts clear when idling

function collectParts(root) {
  const wheels = [];
  const outboards = [];
  const rigs = {};
  let tender = null;
  root.traverse((o) => {
    const p = o.userData && o.userData.part;
    if (!p) return;
    o.rotation.order = 'YXZ';
    if (p.kind === 'rig') {
      rigs[p.name] = o;
    } else if (p.kind === 'wheel') {
      wheels.push({ node: o, radius: Math.max(0.2, p.radius || 1), arm: p.arm || 0, angle: 0 });
    } else if (p.kind === 'outboard') {
      outboards.push({ node: o, steer: 0, tilt: 0 });
    } else if (p.kind === 'tender') {
      // The boat modelled in the stern well. The real tender stands there
      // instead (see Tender.stowedModel), so this comes off the hull.
      tender = { node: o, box: p.box };
    }
  });
  if (tender) tender.node.parent?.remove(tender.node);
  return { wheels, outboards, tender, rigs };
}

/**
 * Where the hull itself ends astern: the furthest-aft vertex at the
 * waterline, ignoring the moving parts. The model's box runs out to
 * whatever hangs over the stern — the trawler's cone of netting — and the
 * wake has to start where the transom meets the water, not under that.
 */
function sternAtWaterline(root, frame) {
  let z = -Infinity;
  frame.updateMatrixWorld(true);
  // In the boat's frame, not the world's: the hull may already hang under
  // a boat that has been placed somewhere and pointed somewhere, and the
  // transom is where it is on the model regardless. (Only the placement
  // comes off — the model's own scale and lift stay in, as measured.)
  const toRoot = new THREE.Matrix4().copy(frame.matrixWorld).invert();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || (o.userData && o.userData.part)) return;
    for (let a = o; a && a !== root; a = a.parent) if (a.userData && a.userData.part) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).applyMatrix4(toRoot);
      // The hull proper, up to the bulwark: nothing on the superstructure.
      if (v.y > -0.9 && v.y < 0.6 && v.z > z) z = v.z;
    }
  });
  return z;
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
    this.anchored = false;       // nobody at the helm: the ship holds station in a current
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
    this._p1 = new THREE.Vector3(); this._p2 = new THREE.Vector3(); this._p3 = new THREE.Vector3();
    this.netAnim = null;
    this.netRest = new THREE.Vector3();
    this.netDef = null;
    this.crane = null;

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

    // The moving parts, and anything that comes off the model (the seiner's
    // modelled tender), before the hull is measured.
    this.parts = collectParts(hull);

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
    this._deckCache.clear();
    this.lift = st?.lift ?? 0;
    this.hullFrame.position.y = this.lift;

    // The deck the trawl gear sits on: where the net hand stands, if the
    // hull has one, else the working deck.
    const netY = st?.posts?.find((p) => p.kind === 'net')?.y ?? deckY;
    const transom = sternAtWaterline(hull, this.group);
    this.hullBounds = {
      halfBeam: (box.max.x - box.min.x) / 2,
      // Where the transom meets the water, for the wake: the box runs out to
      // whatever hangs over the stern.
      sternZ: Number.isFinite(transom) ? transom : box.max.z,
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
      // Standing in a holder on the rail — a tube on a post down to the
      // deck — with its butt in the tube, until someone lifts it out.
      const deckAt = authored ? (m.standY ?? m.y) : this.deckHeightAt(m.x, m.z);
      m.y = deckAt + ROD_HOLDER_H * this.crewScale;
      r.rod.position.set(m.x, m.y, m.z);
      r.rod.rotation.x = HOLDER_LAY;
      r.restLay = HOLDER_LAY;
      r.rest = r.rod.position.clone();
      r.holdPos.copy(r.rest);
      this.rodHolder.add(r.rod);
      const holder = buildHolder(m.side, Math.max(0.8, this.crewScale), m.y - deckAt);
      holder.position.copy(r.rod.position);
      this.rodHolder.add(holder);
      // Where the grip rests, in the boat's frame, for whoever comes to work it.
      r.rod.updateMatrix();
      const gripRest = r.grip.position.clone().applyMatrix4(r.rod.matrix);
      this.rods.push({ ...r, group: r.rod, holder, pos: new THREE.Vector3(m.x, m.y, m.z), deckY: deckAt, gripRest });
    }

    // --- trawl gear placement ---
    const sternZ = this.hullBounds.length * 0.42;
    this.netHit.position.set(0, this.hullBounds.deckY + 0.4, sternZ);
    this.netBundle.position.copy(this.netHit.position);
    this.netBundle.rotation.set(0, 0, 0);
    this.netRest = this.netBundle.position.clone();
    this.netAnim = null;
    this.net.stow();
    this.trawling = false;
    this.netBundle.visible = !!spec.features.trawl;

    // --- the model's own machinery: the trawler's gallows, the gillnetter's
    // drum, the dredger's grab ---
    const rigs = this.parts.rigs || {};
    this.boom = null;
    if (rigs.boom && rigs.cone) {
      // The gallows swing on their hinge; the cone hangs from their apex on
      // a wire, always upright, and is lowered on that wire into the water.
      const cone = rigs.cone;
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), WIRE_MAT);
      wire.visible = false;
      cone.parent.add(wire);
      this.boom = {
        node: rigs.boom, angle: 0, cone, wire,
        apex: cone.position.clone().sub(rigs.boom.position),   // the hang point, boom-local
        drop: 0, swing: 0, swingV: 0, lastAngle: 0,
      };
      this.netBundle.visible = false;
    }
    this.drum = rigs.drum ? { node: rigs.drum, angle: 0 } : null;

    // --- the deck crane, on hulls that carry one ---
    if (this.crane) { this.hullFrame.remove(this.crane.group); this.crane = null; }
    if (st?.crane) {
      const c = st.crane;
      this.crane = new DeckCrane({ reach: c.reach, height: c.height, scale: this.crewScale });
      this.crane.setPaint(spec.paint?.[1]);
      this.crane.group.position.set(c.x, c.y, c.z);
      this.crane.side = c.side ?? 1;
      // Parked: hook raised over the well, or over the deck astern of it.
      const w = st.tenderWell || { x: 0, y: c.y, z: c.z + c.reach * 0.6 };
      this.crane.restPoint.set(w.x, w.y + 3.2, w.z);
      this.crane.rest();
      this.hullFrame.add(this.crane.group);
    }

    // Wake size and churn are a cosmetic per-hull/per-skin signature.
    // A hull with gallows over its stern reads longer than its transom: the
    // wake is laid a little further aft on it so it leaves the hull, not
    // the middle of the boat.
    this.wake.setSpec(spec, this.boom ? { ...this.hullBounds, sternZ: this.hullBounds.sternZ + 0.4 } : this.hullBounds);
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

  /**
   * Net down or up. The bet starts and stops with the call; what follows is
   * the gear actually going over the side and coming back, which picks up
   * from wherever the last movement had got to.
   */
  setTrawling(on, netDef) {
    this.trawling = on;
    if (netDef) this.netDef = netDef;
    const a = this.netAnim;
    if (this.boom) {
      // A hull with gallows: the boom goes down into the water and the net
      // pays out from the cone; stowing winds it in and the boom comes up.
      if (on) {
        if (a?.phase === 'boomUp') a.phase = 'boomDown';
        else if (a?.phase === 'coneUp') a.phase = 'coneDown';
        else if (a?.phase === 'gather') a.phase = 'payout';
        else if (!this.net.active && !a) this.netAnim = { phase: 'boomDown', t: 0 };
      } else {
        if (a?.phase === 'boomDown') a.phase = 'boomUp';
        else if (a?.phase === 'coneDown') a.phase = 'coneUp';
        else if (a?.phase === 'payout' || this.net.active) this.netAnim = { phase: 'gather', t: 0, handPos: new THREE.Vector3(), handFresh: false };
      }
      return;
    }
    if (on) {
      if (a?.phase === 'carryIn') a.phase = 'carryOut', a.t = NET_CARRY_S - a.t;
      else if (a?.phase === 'gather') a.phase = 'payout';
      else if (a?.phase === 'haulIn' || a?.phase === 'setDown') this.netAnim = this.freshNetAnim();
      else if (!this.net.active && !a) this.netAnim = this.freshNetAnim();
    } else {
      if (a?.phase === 'ready') { this.netAnim = null; this.netBundle.position.copy(this.netRest); }
      else if (a?.phase === 'pickup' || (a?.phase === 'heave' && a.t < NET_WHIP_S)) {
        this.netAnim = { phase: 'setDown', t: 0, from: this.netBundle.position.clone(), handPos: new THREE.Vector3(), handFresh: false };
      } else if (a?.phase === 'heave') a.abort = true;
      else if (a?.phase === 'carryOut') a.phase = 'carryIn', a.t = NET_CARRY_S - a.t;
      else if (a?.phase === 'payout' || this.net.active) this.netAnim = { phase: 'gather', t: 0, handPos: new THREE.Vector3(), handFresh: false };
    }
  }

  /** A net waiting on the deck for a hand to come and throw it. */
  freshNetAnim() {
    return { phase: 'ready', t: 0, handPos: new THREE.Vector3(), handFresh: false, from: new THREE.Vector3() };
  }

  /** Where the net waits, and which way the thrower faces (hull frame). */
  get netSpot() {
    const r = this.netRest;
    return { x: r.x, y: r.y - 0.4, z: r.z, f: Math.PI };
  }

  /** The bundle's place along its path over the stern: s in [0, NET_CARRY_S]. */
  netBundleAt(s, out) {
    const b = this.hullBounds, r = this.netRest;
    const P0 = r;
    const P1 = this._p1.set(0, b.deckY + 1.8, b.length * 0.4);           // up at the gallows
    const P2 = this._p2.set(0, b.deckY + 1.5, b.length * 0.5 + 0.9);     // out over the transom
    const P3 = this._p3.set(0, -0.15, b.length * 0.5 + 1.3);             // in the water
    if (s < NET_LIFT_S) return out.lerpVectors(P0, P1, smooth(s / NET_LIFT_S));
    s -= NET_LIFT_S;
    if (s < NET_SWING_S) return out.lerpVectors(P1, P2, smooth(s / NET_SWING_S));
    s -= NET_SWING_S;
    const k = Math.min(1, s / NET_DROP_S);
    return out.lerpVectors(P2, P3, k * k);
  }

  /** Drop the bundle in and let the netting take over. */
  netHitsWater() {
    this.netBundle.visible = false;
    this.towPoints();
    const beam = (this.hullBounds?.halfBeam ?? 1) * 2;
    const width = THREE.MathUtils.clamp(beam * 1.25, 3.4, 7.5);
    this.net.deploy(this._anchorL, this._anchorR, this._backDir, this.netDef?.color,
      { width, length: width * 1.7 }, 1);
  }

  updateNetAnim(dt) {
    const a = this.netAnim;
    const bundle = this.netBundle;
    // A hand on it this frame? The crew director says so each frame it is.
    const hand = a.handFresh ? a.handPos : null;
    a.handFresh = false;
    if (a.phase === 'boomDown' || a.phase === 'boomUp') {
      // The gallows swing down over the water, or back up to rest.
      const b = this.boom;
      const want = a.phase === 'boomDown' ? BOOM_DOWN : 0;
      b.angle += Math.sign(want - b.angle) * Math.min(Math.abs(want - b.angle), BOOM_RATE * dt);
      if (Math.abs(b.angle - want) < 1e-3) {
        if (a.phase === 'boomDown') this.netAnim = { phase: 'coneDown', t: 0 };
        else this.netAnim = null;
      }
    } else if (a.phase === 'coneDown' || a.phase === 'coneUp') {
      // The cone pays down its wire until it is wholly under, and is then
      // put away — the netting in the water takes over from it; or comes
      // back up out of the water once the netting is wound in.
      const b = this.boom;
      const coneTopY = b.cone.position.y + this.lift;     // world height of the hang point
      const coneH = 2.75;                                 // the cone's own height (model)
      if (a.phase === 'coneDown') {
        b.cone.visible = true;
        b.drop += CONE_WIRE_RATE * dt;
        if (coneTopY < -CONE_UNDER) {
          b.cone.visible = false; b.wire.visible = false;
          this.netHitsWater();
          this.netAnim = { phase: 'payout', t: 0 };
        }
      } else {
        b.cone.visible = true;
        b.drop = Math.max(0, b.drop - CONE_WIRE_RATE * dt);
        if (b.drop <= 0) this.netAnim = { phase: 'boomUp', t: 0 };
      }
      void coneH;
    } else if (a.phase === 'ready') {
      // On the deck, waiting for someone to pick it up. Nobody coming:
      // the gallows lifts it the old way.
      a.t += dt;
      bundle.position.copy(this.netRest);
      bundle.visible = true;
      if (hand) { a.phase = 'pickup'; a.t = 0; a.from.copy(bundle.position); }
      else if (a.t > NET_WAIT_S) { this.netAnim = { phase: 'carryOut', t: 0 }; }
    } else if (a.phase === 'pickup') {
      // Up into the hands.
      a.t += dt;
      const k = Math.min(1, a.t / NET_PICKUP_S);
      if (hand) bundle.position.lerpVectors(a.from, hand, smooth(k));
      if (k >= 1) { a.phase = 'heave'; a.t = 0; }
    } else if (a.phase === 'heave') {
      // Held while the thrower winds up; off the whip it flies over the
      // transom and into the water.
      a.t += dt;
      if (a.t < NET_WHIP_S) {
        if (hand) bundle.position.copy(hand);
        a.from.copy(bundle.position);
      } else {
        const k = Math.min(1, (a.t - NET_WHIP_S) / NET_FLY_S);
        const P3 = this._p3.set(0, -0.15, this.hullBounds.length * 0.5 + 1.6);
        bundle.position.lerpVectors(a.from, P3, k);
        bundle.position.y += Math.sin(k * Math.PI) * 1.1;
        bundle.rotation.z += dt * 5;
        if (k >= 1) {
          this.netHitsWater();
          bundle.rotation.z = 0;
          this.netAnim = a.abort
            ? { phase: 'gather', t: 0, handPos: new THREE.Vector3(), handFresh: false }
            : { phase: 'payout', t: 0 };
        }
      }
    } else if (a.phase === 'haulIn') {
      // Out of the water and up into the hands at the rail.
      a.t += dt;
      const k = Math.min(1, a.t / NET_HAUL_S);
      const to = hand || a.handPos;
      bundle.position.lerpVectors(a.from, to, smooth(k));
      bundle.position.y += Math.sin(k * Math.PI) * 0.6;
      if (k >= 1) { a.phase = 'setDown'; a.t = 0; a.from.copy(bundle.position); }
    } else if (a.phase === 'setDown') {
      // Set back on the deck where it lives.
      a.t += dt;
      const k = Math.min(1, a.t / NET_PICKUP_S);
      bundle.position.lerpVectors(a.from, this.netRest, smooth(k));
      bundle.rotation.z = 0;
      bundle.visible = true;
      if (k >= 1) this.netAnim = null;
    } else if (a.phase === 'carryOut' || a.phase === 'carryIn') {
      a.t += dt;
      const s = a.phase === 'carryOut' ? a.t : NET_CARRY_S - a.t;
      this.netBundleAt(THREE.MathUtils.clamp(s, 0, NET_CARRY_S), bundle.position);
      bundle.rotation.z = Math.sin(a.t * 4.5) * 0.12 * Math.min(1, s / 0.6);
      bundle.visible = true;
      if (a.t >= NET_CARRY_S) {
        if (a.phase === 'carryOut') {
          // Splash: the bundle is in the water and the netting takes over.
          this.netHitsWater();
          this.netAnim = { phase: 'payout', t: 0 };
        } else {
          bundle.position.copy(this.netRest);
          bundle.rotation.z = 0;
          this.netAnim = null;
        }
      }
    } else if (a.phase === 'payout') {
      this.net.gather = Math.max(0, this.net.gather - dt / NET_PAYOUT_S);
      if (this.net.gather <= 0) this.netAnim = null;
    } else if (a.phase === 'gather') {
      this.net.gather = Math.min(1, this.net.gather + dt / NET_GATHER_S);
      if (this.net.gather >= 1) {
        this.net.stow();
        if (this.boom) { this.netAnim = { phase: 'coneUp', t: 0 }; return; }
        this.netBundleAt(NET_CARRY_S, bundle.position);
        bundle.visible = true;
        // A hand at the rail hauls it in; else the gallows brings it aboard.
        this.netAnim = hand
          ? { phase: 'haulIn', t: 0, from: bundle.position.clone(), handPos: hand.clone(), handFresh: false }
          : { phase: 'carryIn', t: 0 };
      }
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
    // The gallows lie at whatever angle the net animation has them; the
    // cone hangs upright under their apex, `drop` down its wire, swinging a
    // little whenever the gallows move.
    if (this.boom) {
      const b = this.boom;
      b.node.rotation.x = b.angle;                  // +x lowers an arm that reaches aft
      const kick = (b.angle - b.lastAngle) / Math.max(dt, 1e-3);
      b.lastAngle = b.angle;
      b.swingV += (-CONE_SWING_K * b.swing - CONE_SWING_C * b.swingV - kick * 0.35) * dt;
      b.swing += b.swingV * dt;
      b.node.updateMatrixWorld(true);
      const apex = this._p1.copy(b.apex);
      b.node.localToWorld(apex);
      b.cone.parent.worldToLocal(apex);
      b.cone.position.set(apex.x, apex.y - b.drop, apex.z + Math.sin(b.swing) * 0.5);
      b.cone.rotation.set(b.swing, 0, 0);
      // The wire, from the apex down to the cone's hang point.
      b.wire.visible = b.cone.visible && b.drop > 0.02;
      b.wire.position.set(apex.x, apex.y - b.drop / 2, apex.z);
      b.wire.scale.set(0.02, Math.max(0.01, b.drop), 0.02);
    }
    // The drum turns while the net pays out (top going aft) or is wound in.
    if (this.drum) {
      const ph = this.netAnim?.phase;
      const dir = ph === 'payout' ? 1 : ph === 'gather' ? -1 : 0;
      this.drum.angle += dir * DRUM_RATE * dt;
      this.drum.node.rotation.x = this.drum.angle;
    }
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
    // Rapids carry the hull along with them (a picture of moving water — it
    // changes where you are, never what a bet pays).
    const cur = !this.anchored && this.lake.currentAt ? this.lake.currentAt(this.pos.x, this.pos.z) : null;
    if (cur && (cur.x || cur.z)) {
      // The same rule as the helm: the whole footprint, never more of it aground.
      const nx = this.pos.x + cur.x * dt, nz = this.pos.z + cur.z * dt;
      const here = aground(this, this.pos.x, this.pos.z, this.heading, isNavigable);
      if (aground(this, nx, nz, this.heading, isNavigable) <= here) { this.pos.x = nx; this.pos.z = nz; }
    }

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

    // The hull rides the water under it: the wave is read at the bow, the
    // stern and both sides, so it heaves on the average (a short ripple
    // averages out under a long hull, a long swell lifts the whole boat)
    // and pitches and rolls with the slope between them.
    const half = (this.hullBounds?.length ?? s.length) / 2;
    const beam = this.hullBounds?.halfBeam ?? s.length * 0.16;
    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);   // forward
    const rx = Math.cos(this.heading), rz = -Math.sin(this.heading);    // starboard
    const lake = this.lake;
    const hBow = lake.waveHeight(this.pos.x + fx * half, this.pos.z + fz * half, t);
    const hStern = lake.waveHeight(this.pos.x - fx * half, this.pos.z - fz * half, t);
    const hStbd = lake.waveHeight(this.pos.x + rx * beam, this.pos.z + rz * beam, t);
    const hPort = lake.waveHeight(this.pos.x - rx * beam, this.pos.z - rz * beam, t);
    const bobY = (hBow + hStern + hStbd + hPort) / 4;
    const wavePitch = Math.max(-0.12, Math.min(0.12, Math.atan2(hBow - hStern, half * 2)));
    const waveRoll = Math.max(-0.12, Math.min(0.12, Math.atan2(hStbd - hPort, beam * 2)));
    const scaleBob = Math.min(1, 6 / s.length);   // big hulls ride flatter over the chop
    // Heel into the turn and lift the bow under power — both scaled by how
    // fast the hull is actually moving, so a boat at rest just sits there.
    // Both are capped so the deck edge never goes under: the heel by beam
    // (a wide hull rolls only a few degrees), the trim by a little.
    const drive = this.speed / Math.max(1, s.maxSpeed);
    const heelCap = Math.min(0.2, 0.14 / Math.max(0.5, this.hullBounds?.halfBeam ?? 1));
    const heel = Math.max(-heelCap, Math.min(heelCap, this.yawVel * drive * 0.42));
    const trim = this.throttle * drive * 0.05 * scaleBob;
    this.group.position.set(this.pos.x, bobY + 0.02, this.pos.z);
    this.group.rotation.set(
      Math.sin(t * 0.9) * 0.02 * scaleBob + trim + wavePitch,
      this.heading,
      Math.sin(t * 1.3) * 0.025 * scaleBob + heel * Math.min(1, 9 / s.length) + waveRoll,
    );

    updateRods(this.rods, dt);
    this.updateMachinery(dt);
    if (this.crane) this.crane.update(dt);
    this.wake.update(dt, t, this);
    this.smoke.update(dt, t, this);
    if (this.netAnim) this.updateNetAnim(dt);
    if (this.net.active) {
      this.towPoints();
      this.net.update(dt, t, this._anchorL, this._anchorR, this._ropeL, this._ropeR,
        this._backDir, this.speed);
    }
  }
}
