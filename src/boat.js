// The player's boat: hull model, rod rack, trawl gear, and drifty arcade
// physics. The hull is a glTF model loaded on demand from assets/boats; if
// it is missing or fails to load we fall back to a simple procedural skiff
// so the game always runs.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './config.js';
import { isNavigable } from './lake.js';
import { TrawlNet } from './net.js';
import { BOAT_BY_ID, boatModelURL, resolveBoat, rodMounts } from './boats.js';
import { applySkin } from './skinner.js';
import { buildProceduralHull } from './hullshapes.js';
import { WakeTrail } from './wake.js';

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

// --- A single fishing rod (shared geometry across mounts) ---
const ROD_GEO = {
  blank: new THREE.CylinderGeometry(0.012, 0.03, 2.3, 5),
  grip: new THREE.CylinderGeometry(0.035, 0.035, 0.4, 6),
  reel: new THREE.CylinderGeometry(0.07, 0.07, 0.05, 9),
};
const ROD_MAT = {
  dark: new THREE.MeshStandardMaterial({ color: 0x40342c, roughness: 0.6 }),
  grip: new THREE.MeshStandardMaterial({ color: 0xc94f30, roughness: 0.6 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xb8c0c4, roughness: 0.3, metalness: 0.7 }),
};

function buildRod(side, scale) {
  const rod = new THREE.Group();
  const blank = new THREE.Mesh(ROD_GEO.blank, ROD_MAT.dark);
  blank.position.y = 1.15;
  blank.castShadow = true;
  rod.add(blank);
  const grip = new THREE.Mesh(ROD_GEO.grip, ROD_MAT.grip);
  grip.position.y = 0.2;
  rod.add(grip);
  const reel = new THREE.Mesh(ROD_GEO.reel, ROD_MAT.chrome);
  reel.rotation.z = Math.PI / 2;
  reel.position.set(0, 0.5, 0.07);
  rod.add(reel);
  const tip = new THREE.Object3D();
  tip.position.y = 2.3;
  rod.add(tip);
  // Rake outboard and slightly aft so the lines fan out.
  rod.rotation.set(-0.7, 0, side * 0.42);
  rod.scale.setScalar(scale);
  return { rod, tip };
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
    this.trawling = false;

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
      const { rod, tip } = buildRod(m.side, rodScale);
      rod.position.set(m.x, m.y, m.z);
      this.rodHolder.add(rod);
      this.rods.push({ group: rod, tip, side: m.side, pos: new THREE.Vector3(m.x, m.y, m.z) });
    }

    // --- trawl gear placement ---
    const sternZ = this.hullBounds.length * 0.42;
    this.netHit.position.set(0, this.hullBounds.deckY + 0.4, sternZ);
    this.netBundle.position.copy(this.netHit.position);
    this.netBundle.visible = !!spec.features.trawl;
    if (this.trawling) this.setTrawling(false);

    // Wake size and churn are a cosmetic per-hull/per-skin signature.
    this.wake.setSpec(spec, this.hullBounds);

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
    let d = target - this.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.heading += d * amount;
  }

  /** World position of a rod tip, written into `out`. */
  rodTipWorld(i, out) {
    const rod = this.rods[Math.min(i, this.rods.length - 1)];
    if (!rod) return out.set(this.pos.x, 1.5, this.pos.z);
    return rod.tip.getWorldPosition(out);
  }

  update(dt, inputVec, t) {
    const s = this.spec;
    const mag = Math.hypot(inputVec.x, inputVec.z);
    const maxSpeed = s.maxSpeed * (this.trawling ? 0.55 : 1);

    if (mag > 0.05) {
      this.vel.x += inputVec.x * s.accel * dt;
      this.vel.z += inputVec.z * s.accel * dt;
    }
    const drag = Math.exp(-s.drag * dt);
    this.vel.x *= drag; this.vel.z *= drag;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > maxSpeed) { this.vel.x *= maxSpeed / sp; this.vel.z *= maxSpeed / sp; }
    this.speed = Math.min(sp, maxSpeed);

    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    if (isNavigable(nx, this.pos.z)) this.pos.x = nx; else this.vel.x *= -0.15;
    if (isNavigable(this.pos.x, nz)) this.pos.z = nz; else this.vel.z *= -0.15;

    if (this.speed > 0.25) {
      const target = Math.atan2(-this.vel.x, -this.vel.z);
      let d = target - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.heading += d * Math.min(1, s.turn * dt);
    }

    const bobY = this.lake.waveHeight(this.pos.x, this.pos.z, t);
    const scaleBob = Math.min(1, 6 / s.length);   // big hulls ride flatter
    this.group.position.set(this.pos.x, bobY * scaleBob + 0.02, this.pos.z);
    this.group.rotation.set(
      (Math.sin(t * 0.9) * 0.02 + this.speed * 0.006) * scaleBob,
      this.heading,
      Math.sin(t * 1.3) * 0.025 * scaleBob,
    );

    this.wake.update(dt, t, this);
    if (this.trawling) {
      this.towPoints();
      this.net.update(dt, t, this._anchorL, this._anchorR, this._ropeL, this._ropeR);
    }
  }
}
