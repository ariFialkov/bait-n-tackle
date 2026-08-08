// The player's fishing boat: low-poly hull built from primitives, a visible
// trawl net on the stern (tap/click it to toggle trawling), and drifty
// arcade movement where the nose lerps toward the direction of travel.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { isNavigable } from './lake.js';

function buildBoatMesh() {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshLambertMaterial({ color: 0xc8532e });
  const deckMat = new THREE.MeshLambertMaterial({ color: 0xe8d9b0 });
  const cabinMat = new THREE.MeshLambertMaterial({ color: 0xf2ece0 });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x51413a });

  // Hull: tapered box (bow at -Z)
  const hullGeo = new THREE.BoxGeometry(1.7, 0.8, 4.4, 1, 1, 3);
  const pos = hullGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z < -1.4) { // taper the bow
      pos.setX(i, pos.getX(i) * 0.25);
      if (pos.getY(i) < 0) pos.setY(i, pos.getY(i) * 0.4);
    }
  }
  hullGeo.computeVertexNormals();
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.position.y = 0.25;
  g.add(hull);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 3.6), deckMat);
  deck.position.set(0, 0.68, 0.2);
  g.add(deck);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.85, 1.2), cabinMat);
  cabin.position.set(0, 1.15, -0.35);
  g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 1.4), hullMat);
  roof.position.set(0, 1.62, -0.35);
  g.add(roof);

  // Trawl boom arm
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.9, 6), darkMat);
  boom.rotation.x = Math.PI / 3.1;
  boom.position.set(0, 1.35, 1.15);
  g.add(boom);

  // Trawl net: visible bundle on the stern (the tap target).
  const netGroup = new THREE.Group();
  const netMat = new THREE.MeshLambertMaterial({ color: 0x7d8a4c });
  const bundle = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), netMat);
  bundle.scale.set(1.25, 0.7, 1);
  bundle.position.set(0, 0.85, 1.55);
  netGroup.add(bundle);
  const float1 = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xe8b23a }));
  float1.position.set(0.3, 1.05, 1.45);
  netGroup.add(float1);
  const float2 = float1.clone();
  float2.position.set(-0.28, 1.0, 1.65);
  netGroup.add(float2);
  g.add(netGroup);

  // Generous invisible tap target around the net.
  const netHit = new THREE.Mesh(
    new THREE.SphereGeometry(1.15, 8, 8),
    new THREE.MeshBasicMaterial({ visible: false }));
  netHit.position.copy(bundle.position);
  g.add(netHit);

  // Deployed net (shown behind the boat while trawling)
  const deployed = new THREE.Group();
  const mouth = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 3.2, 8, 1, true),
    new THREE.MeshLambertMaterial({ color: 0x66743e, transparent: true, opacity: 0.75, side: THREE.DoubleSide, wireframe: true }));
  mouth.rotation.x = -Math.PI / 2;
  mouth.position.set(0, -0.35, 4.6);
  deployed.add(mouth);
  const ropeMat = new THREE.LineBasicMaterial({ color: 0x3d3428 });
  for (const sx of [-0.7, 0.7]) {
    const ropeGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(sx, 0.8, 1.7), new THREE.Vector3(sx * 1.1, -0.3, 3.4),
    ]);
    deployed.add(new THREE.Line(ropeGeo, ropeMat));
  }
  deployed.visible = false;
  g.add(deployed);

  return { group: g, netHit, netBundle: netGroup, deployedNet: deployed };
}

export class Boat {
  constructor(scene, lake) {
    this.lake = lake;
    const parts = buildBoatMesh();
    this.group = parts.group;
    this.netHit = parts.netHit;
    this.netBundle = parts.netBundle;
    this.deployedNet = parts.deployedNet;
    scene.add(this.group);

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.heading = 0;           // radians, 0 = facing -Z
    this.speed = 0;
    this.trawling = false;

    // Wake foam particles
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

  setTrawling(on) {
    this.trawling = on;
    this.deployedNet.visible = on;
    this.netBundle.visible = !on;
  }

  /** inputVec: normalized desired direction in world XZ ({x, z}), len 0..1 */
  update(dt, inputVec, t) {
    const mag = Math.hypot(inputVec.x, inputVec.z);
    const maxSpeed = CONFIG.BOAT_MAX_SPEED * (this.trawling ? 0.55 : 1);

    if (mag > 0.05) {
      this.vel.x += inputVec.x * CONFIG.BOAT_ACCEL * dt;
      this.vel.z += inputVec.z * CONFIG.BOAT_ACCEL * dt;
    }
    // Drag
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
    this.group.position.set(this.pos.x, bobY + 0.05, this.pos.z);
    this.group.rotation.set(
      Math.sin(t * 0.9) * 0.02 + this.speed * 0.008,
      this.heading,
      Math.sin(t * 1.3) * 0.025,
    );

    this.updateWake(dt);
  }

  updateWake(dt) {
    const w = this.wake;
    const posAttr = w.points.geometry.attributes.position;
    // Emit while moving (more while trawling)
    const rate = this.speed > 0.6 ? (this.trawling ? 34 : 18) : 0;
    w.emitAcc += rate * dt;
    while (w.emitAcc >= 1) {
      w.emitAcc -= 1;
      const i = w.idx = (w.idx + 1) % w.life.length;
      const back = this.trawling ? 4.5 : 2.2;
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
