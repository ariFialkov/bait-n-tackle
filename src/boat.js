// The player's fishing boat: a smooth-shaded center-console skiff built
// procedurally (no external assets) — shaped hull, gunwale rail, console
// with windshield, seats, outboard motor, fishing rod, and a trawl net rig
// on the stern (tap/click the net to toggle trawling). Movement is drifty
// arcade physics where the nose lerps toward the direction of travel.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { isNavigable } from './lake.js';
import { TrawlNet } from './net.js';

const LEN = 4.6, BEAM = 1.9, HULL_H = 0.95;

// Half-width of the hull as a fraction of BEAM/2, along u (0 = bow, 1 = stern).
function hullWidth(u) {
  const flare = Math.pow(Math.sin(Math.min(u * 1.45, 1) * Math.PI / 2), 0.75);
  return 0.1 + 0.9 * flare * (1 - 0.08 * Math.max(0, u - 0.75) / 0.25);
}

function buildHullGeometry() {
  const geo = new THREE.BoxGeometry(1, 1, 1, 8, 4, 18);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const u = z + 0.5; // 0 bow .. 1 stern
    let nx = x * hullWidth(u);
    let ny = y;
    if (y < 0) {
      // V-hull bottom: shallower toward the bow, deadrise toward keel.
      const depth = 0.45 + 0.55 * Math.sin(Math.min(u * 1.6, 1) * Math.PI / 2);
      ny = y * depth - Math.abs(nx) * 0.22 * -y * 2;
      // Rocker: the bow sweeps up.
      ny += Math.pow(1 - u, 2.2) * 0.55 * -y * 2;
    }
    pos.setXYZ(i, nx, ny, z);
  }
  geo.scale(BEAM, HULL_H, LEN);
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  return geo;
}

function gunwaleCurve(deckY) {
  const pts = [];
  const N = 24;
  for (let i = 0; i <= N; i++) { // starboard, bow -> stern
    const u = i / N;
    pts.push(new THREE.Vector3(hullWidth(u) * BEAM / 2, deckY, (u - 0.5) * LEN));
  }
  for (let i = N; i >= 0; i--) { // port, stern -> bow
    const u = i / N;
    pts.push(new THREE.Vector3(-hullWidth(u) * BEAM / 2, deckY, (u - 0.5) * LEN));
  }
  return new THREE.CatmullRomCurve3(pts, true);
}

function buildBoat() {
  const g = new THREE.Group();
  const cast = [];

  const hullMat = new THREE.MeshStandardMaterial({ color: 0xc94f30, roughness: 0.35, metalness: 0.05 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0xe6d7ae, roughness: 0.8 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xf4efe2, roughness: 0.4 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x40342c, roughness: 0.6 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xb8c0c4, roughness: 0.25, metalness: 0.8 });

  const hull = new THREE.Mesh(buildHullGeometry(), hullMat);
  hull.position.y = 0.3;
  g.add(hull); cast.push(hull);

  // Deck floor
  const deck = new THREE.Mesh(new THREE.BoxGeometry(BEAM * 0.78, 0.06, LEN * 0.8), deckMat);
  deck.position.set(0, 0.62, 0.15);
  g.add(deck);

  // Gunwale rail
  const rail = new THREE.Mesh(
    new THREE.TubeGeometry(gunwaleCurve(0.48), 96, 0.05, 7, true), railMat);
  rail.position.y = 0.3;
  g.add(rail); cast.push(rail);

  // Bow deck cap
  const bowCap = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.1, 10, 1), deckMat);
  bowCap.scale.set(1, 1, 1.7);
  bowCap.position.set(0, 0.72, -1.62);
  g.add(bowCap);

  // Center console with windshield + wheel
  const console_ = new THREE.Group();
  const consoleBody = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.62, 0.55), railMat);
  consoleBody.position.y = 0.31;
  console_.add(consoleBody);
  const dash = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.16, 0.34), darkMat);
  dash.rotation.x = -0.5;
  dash.position.set(0, 0.66, -0.1);
  console_.add(dash);
  const shield = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.46, 0.4, 12, 1, true, -Math.PI * 0.32, Math.PI * 0.64),
    new THREE.MeshStandardMaterial({
      color: 0xbfe2ee, roughness: 0.1, metalness: 0.1,
      transparent: true, opacity: 0.4, side: THREE.DoubleSide,
    }));
  shield.position.set(0, 0.9, -0.08);
  console_.add(shield);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.02, 6, 14), darkMat);
  wheel.rotation.x = -0.9;
  wheel.position.set(0, 0.72, 0.22);
  console_.add(wheel);
  console_.position.set(0, 0.62, -0.35);
  g.add(console_);
  cast.push(consoleBody);

  // Helm seat + bow seat
  for (const [z, w] of [[0.45, 0.56], [-1.05, 0.7]]) {
    const seat = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.3, 8), chromeMat);
    base.position.y = 0.15;
    const cushion = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.16, 12), hullMat);
    cushion.position.y = 0.36;
    seat.add(base, cushion);
    seat.position.set(0, 0.62, z);
    g.add(seat);
  }

  // Outboard motor
  const motor = new THREE.Group();
  const cowl = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.24, 4, 10), darkMat);
  cowl.rotation.z = Math.PI / 2;
  cowl.rotation.y = Math.PI / 2;
  cowl.position.y = 0.12;
  motor.add(cowl);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.6, 0.16), darkMat);
  shaft.position.y = -0.3;
  motor.add(shaft);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.3), chromeMat);
  fin.position.set(0, -0.62, 0.05);
  motor.add(fin);
  motor.position.set(0, 0.72, 2.28);
  motor.rotation.x = 0.12;
  g.add(motor); cast.push(cowl);

  // Fishing rod (line attaches at rodTip)
  const rod = new THREE.Group();
  const blank = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, 2.3, 6), darkMat);
  blank.position.y = 1.15;
  rod.add(blank);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 6), hullMat);
  grip.position.y = 0.2;
  rod.add(grip);
  const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10), chromeMat);
  reel.rotation.z = Math.PI / 2;
  reel.position.set(0, 0.5, 0.07);
  rod.add(reel);
  const rodTip = new THREE.Object3D();
  rodTip.position.y = 2.3;
  rod.add(rodTip);
  rod.position.set(0.55, 0.65, -0.75);
  rod.rotation.set(-0.85, 0, -0.18); // raked up over the bow
  g.add(rod);

  // Trawl net: stowed bundle on the stern (the tap target)
  const netGroup = new THREE.Group();
  const netMat = new THREE.MeshStandardMaterial({ color: 0x7d8a4c, roughness: 0.9 });
  const bundle = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 9), netMat);
  bundle.scale.set(1.3, 0.65, 1);
  bundle.position.set(0, 0.78, 1.62);
  netGroup.add(bundle);
  const netWire = new THREE.Mesh(new THREE.SphereGeometry(0.41, 9, 6),
    new THREE.MeshBasicMaterial({ color: 0x4c5530, wireframe: true, transparent: true, opacity: 0.5 }));
  netWire.scale.copy(bundle.scale);
  netWire.position.copy(bundle.position);
  netGroup.add(netWire);
  for (const [sx, sz] of [[0.3, 1.5], [-0.26, 1.72], [0.05, 1.78]]) {
    const float = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xe8b23a, roughness: 0.5 }));
    float.position.set(sx, 0.95, sz);
    netGroup.add(float);
  }
  g.add(netGroup);

  // A-frame boom over the stern
  for (const sx of [-0.5, 0.5]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 6), chromeMat);
    leg.rotation.x = Math.PI / 3.4;
    leg.position.set(sx, 1.15, 1.35);
    g.add(leg);
  }

  // Generous invisible tap target around the net
  const netHit = new THREE.Mesh(
    new THREE.SphereGeometry(1.15, 8, 8),
    new THREE.MeshBasicMaterial({ visible: false }));
  netHit.position.copy(bundle.position);
  g.add(netHit);

  for (const m of cast) m.castShadow = true;

  return { group: g, netHit, netBundle: netGroup, rodTip };
}

export class Boat {
  constructor(scene, lake) {
    this.lake = lake;
    const parts = buildBoat();
    this.group = parts.group;
    this.netHit = parts.netHit;
    this.netBundle = parts.netBundle;
    this.rodTip = parts.rodTip;
    scene.add(this.group);

    this.net = new TrawlNet(scene);
    // Local-space tow points (stern waterline) and A-frame rope tops.
    this._anchorL = new THREE.Vector3();
    this._anchorR = new THREE.Vector3();
    this._ropeL = new THREE.Vector3();
    this._ropeR = new THREE.Vector3();
    this._backDir = new THREE.Vector3();

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.heading = 0;           // radians, 0 = facing -Z
    this.speed = 0;
    this.trawling = false;

    this.wake = this.buildWake(scene);
  }

  buildWake(scene) {
    const N = 90;
    const geo = new THREE.BufferGeometry();
    const posArr = new Float32Array(N * 3).fill(9999);
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.5, transparent: true, opacity: 0.55,
      depthWrite: false, sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    points.renderOrder = 3;
    scene.add(points);
    return { points, life: new Float32Array(N).fill(0), idx: 0, emitAcc: 0 };
  }

  towPoints() {
    this.group.updateMatrixWorld();
    this._anchorL.set(-0.62, 0.05, 2.5);
    this._anchorR.set(0.62, 0.05, 2.5);
    this._ropeL.set(-0.5, 1.63, 1.95);
    this._ropeR.set(0.5, 1.63, 1.95);
    this.group.localToWorld(this._anchorL);
    this.group.localToWorld(this._anchorR);
    this.group.localToWorld(this._ropeL);
    this.group.localToWorld(this._ropeR);
    this._backDir.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  setTrawling(on, netDef) {
    this.trawling = on;
    this.netBundle.visible = !on;
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

  /** inputVec: normalized desired direction in world XZ ({x, z}), len 0..1 */
  update(dt, inputVec, t) {
    const mag = Math.hypot(inputVec.x, inputVec.z);
    const maxSpeed = CONFIG.BOAT_MAX_SPEED * (this.trawling ? 0.55 : 1);

    if (mag > 0.05) {
      this.vel.x += inputVec.x * CONFIG.BOAT_ACCEL * dt;
      this.vel.z += inputVec.z * CONFIG.BOAT_ACCEL * dt;
    }
    const drag = Math.exp(-CONFIG.BOAT_DRAG * dt);
    this.vel.x *= drag; this.vel.z *= drag;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > maxSpeed) {
      this.vel.x *= maxSpeed / sp; this.vel.z *= maxSpeed / sp;
    }
    this.speed = Math.min(sp, maxSpeed);

    // Move with shallow-water collision (test axes separately to slide along shores)
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    if (isNavigable(nx, this.pos.z)) this.pos.x = nx; else this.vel.x *= -0.15;
    if (isNavigable(this.pos.x, nz)) this.pos.z = nz; else this.vel.z *= -0.15;

    // Nose points along velocity with a lazy lerp -> natural drift feel.
    if (this.speed > 0.25) {
      const targetHeading = Math.atan2(-this.vel.x, -this.vel.z);
      let d = targetHeading - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.heading += d * Math.min(1, CONFIG.BOAT_TURN_LERP * dt);
    }

    // Bob on the waves.
    const bobY = this.lake.waveHeight(this.pos.x, this.pos.z, t);
    this.group.position.set(this.pos.x, bobY + 0.02, this.pos.z);
    this.group.rotation.set(
      Math.sin(t * 0.9) * 0.02 + this.speed * 0.008,
      this.heading,
      Math.sin(t * 1.3) * 0.025,
    );

    this.updateWake(dt);

    if (this.trawling) {
      this.towPoints();
      this.net.update(dt, t, this._anchorL, this._anchorR, this._ropeL, this._ropeR);
    }
  }

  updateWake(dt) {
    const w = this.wake;
    const posAttr = w.points.geometry.attributes.position;
    const rate = this.speed > 0.6 ? (this.trawling ? 34 : 18) : 0;
    w.emitAcc += rate * dt;
    while (w.emitAcc >= 1) {
      w.emitAcc -= 1;
      const i = w.idx = (w.idx + 1) % w.life.length;
      const back = this.trawling ? 4.5 : 2.4;
      const spread = this.trawling ? 1.2 : 0.5;
      posAttr.setXYZ(i,
        this.pos.x + Math.sin(this.heading) * back + (Math.random() - 0.5) * spread,
        0.06,
        this.pos.z + Math.cos(this.heading) * back + (Math.random() - 0.5) * spread);
      w.life[i] = 1;
    }
    for (let i = 0; i < w.life.length; i++) {
      if (w.life[i] > 0) {
        w.life[i] -= dt * 0.7;
        if (w.life[i] <= 0) posAttr.setXYZ(i, 9999, 9999, 9999);
      }
    }
    posAttr.needsUpdate = true;
  }
}
