// Ambient fish that live in the lake itself. Each fish wanders the world on
// its own — cruising, turning with smooth noise, steering away from
// shallows — completely independent of the boat. The boat's position is only
// used to recycle fish that have drifted far outside the view (they respawn
// in fresh water near the edge of the visible area, never mid-screen).

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { waterDepth } from './lake.js';

const VIEW_R = 46;      // fish farther than this get recycled
const SPAWN_R = 38;     // recycled fish reappear around this radius

const PALETTE = [0x7fa8b8, 0x9c8f6a, 0x6f8f5e, 0xb87f5e, 0x8a7fb8, 0x5e88b8];

// --- Shared geometry: a proper fish body via lathe profile + fins ---
let shared = null;
function sharedGeoms() {
  if (shared) return shared;

  // Body: radius profile from nose to tail, lathed then flattened laterally.
  const profile = [];
  const P = [
    [0.00, 0.015], [0.06, 0.07], [0.16, 0.115], [0.30, 0.145], [0.45, 0.14],
    [0.60, 0.115], [0.74, 0.075], [0.85, 0.04], [0.94, 0.028], [1.00, 0.02],
  ];
  for (const [t, r] of P) profile.push(new THREE.Vector2(r, t - 0.5));
  const body = new THREE.LatheGeometry(profile, 14);
  body.rotateX(Math.PI / 2);   // length along +Z (nose at -Z)
  body.scale(0.55, 1, 1);      // flatten side-to-side
  body.computeVertexNormals();

  // Tail fin: forked crescent
  const tailShape = new THREE.Shape();
  tailShape.moveTo(0, 0);
  tailShape.quadraticCurveTo(0.16, 0.1, 0.3, 0.24);
  tailShape.quadraticCurveTo(0.16, 0.02, 0.3, -0.2);
  tailShape.quadraticCurveTo(0.16, -0.09, 0, 0);
  const tail = new THREE.ShapeGeometry(tailShape, 6);
  tail.rotateY(-Math.PI / 2);  // fan out along +Z, in the vertical plane

  // Dorsal fin
  const dorsalShape = new THREE.Shape();
  dorsalShape.moveTo(-0.12, 0);
  dorsalShape.quadraticCurveTo(0.02, 0.16, 0.14, 0.02);
  dorsalShape.lineTo(-0.12, 0);
  const dorsal = new THREE.ShapeGeometry(dorsalShape, 4);
  dorsal.rotateY(-Math.PI / 2);

  // Pectoral fin
  const pecShape = new THREE.Shape();
  pecShape.moveTo(0, 0);
  pecShape.quadraticCurveTo(0.1, -0.03, 0.14, -0.1);
  pecShape.quadraticCurveTo(0.05, -0.06, 0, 0);
  const pec = new THREE.ShapeGeometry(pecShape, 4);

  const eye = new THREE.SphereGeometry(0.022, 8, 6);

  shared = { body, tail, dorsal, pec, eye };
  return shared;
}

const matCache = new Map();
function bodyMat(color) {
  if (!matCache.has(color)) {
    matCache.set(color, new THREE.MeshStandardMaterial({
      color, roughness: 0.45, metalness: 0.25,
    }));
  }
  return matCache.get(color);
}
const finMatCache = new Map();
function finMat(color) {
  if (!finMatCache.has(color)) {
    const c = new THREE.Color(color).offsetHSL(0, 0.05, -0.12);
    finMatCache.set(color, new THREE.MeshStandardMaterial({
      color: c, roughness: 0.6, metalness: 0.1,
      side: THREE.DoubleSide, transparent: true, opacity: 0.9,
    }));
  }
  return finMatCache.get(color);
}
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.25 });

function makeFishMesh(scale, color) {
  const G = sharedGeoms();
  const g = new THREE.Group();
  const mb = bodyMat(color), mf = finMat(color);

  const body = new THREE.Mesh(G.body, mb);
  g.add(body);

  const tail = new THREE.Mesh(G.tail, mf);
  tail.position.z = 0.5;
  g.add(tail);

  const dorsal = new THREE.Mesh(G.dorsal, mf);
  dorsal.position.set(0, 0.13, 0.02);
  g.add(dorsal);

  for (const s of [1, -1]) {
    const pec = new THREE.Mesh(G.pec, mf);
    pec.position.set(s * 0.07, -0.03, -0.18);
    pec.rotation.set(0.3 * s, s * Math.PI / 2.6, 0);
    g.add(pec);
  }
  for (const s of [1, -1]) {
    const eye = new THREE.Mesh(G.eye, eyeMat);
    eye.position.set(s * 0.055, 0.035, -0.36);
    g.add(eye);
  }

  g.scale.setScalar(scale);
  return { group: g, tail };
}

export class AmbientFish {
  constructor(scene, count = 16) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.focus = new THREE.Vector3();
    this.fish = [];
    for (let i = 0; i < count; i++) {
      const scale = 0.9 + Math.random() * 2.1;
      const { group, tail } = makeFishMesh(scale, PALETTE[i % PALETTE.length]);
      this.group.add(group);
      const f = {
        mesh: group,
        tail,
        x: 0, z: 0,
        heading: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 0.9,
        turnBias: 0,
        depthPref: 0.6 + Math.random() * 2.4,
        phase: Math.random() * Math.PI * 2,
        scale,
      };
      // Initial spread: anywhere in view, in water.
      this.place(f, 6 + Math.random() * (SPAWN_R - 6));
      this.fish.push(f);
    }
  }

  setFocus(x, z) { this.focus.set(x, 0, z); }

  /** Drop a fish at a random watery point around the focus at ~radius r. */
  place(f, r) {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2;
      const x = this.focus.x + Math.cos(a) * r;
      const z = this.focus.z + Math.sin(a) * r;
      if (waterDepth(x, z) > 1.2) {
        f.x = x; f.z = z;
        f.heading = Math.random() * Math.PI * 2;
        return true;
      }
    }
    return false;
  }

  update(t, dt = 0.016) {
    for (const f of this.fish) {
      // Wander: smooth pseudo-random turning, unique per fish.
      f.turnBias = Math.sin(t * 0.31 + f.phase * 3.7) * 0.5 +
        Math.sin(t * 0.13 + f.phase * 1.3) * 0.3;
      f.heading += f.turnBias * dt;

      // Steer away from shallows: probe ahead, turn if it's getting thin.
      const probeX = f.x + Math.sin(f.heading) * 3;
      const probeZ = f.z + Math.cos(f.heading) * 3;
      const ahead = waterDepth(probeX, probeZ);
      if (ahead < 1.0) {
        f.heading += 2.4 * dt * (Math.sin(f.phase * 7) > 0 ? 1 : -1) * (1.6 - ahead);
      }

      f.x += Math.sin(f.heading) * f.speed * dt;
      f.z += Math.cos(f.heading) * f.speed * dt;

      const d = waterDepth(f.x, f.z);
      if (d < 0.4) {
        // Beached in spite of steering — recycle quietly at the view edge.
        if (!this.place(f, SPAWN_R)) { f.mesh.visible = false; continue; }
      }
      // Recycle fish that wandered far out of view.
      const distFromFocus = Math.hypot(f.x - this.focus.x, f.z - this.focus.z);
      if (distFromFocus > VIEW_R) {
        if (!this.place(f, SPAWN_R)) { f.mesh.visible = false; continue; }
      }

      f.mesh.visible = true;
      const depth = waterDepth(f.x, f.z);
      const y = CONFIG.WATER_LEVEL - Math.min(f.depthPref, Math.max(0.35, depth - 0.3));
      f.mesh.position.set(f.x, y + Math.sin(t * 1.2 + f.phase) * 0.08, f.z);
      // Nose (-Z of the mesh) points along the heading.
      f.mesh.rotation.y = Math.atan2(-Math.sin(f.heading), -Math.cos(f.heading));
      // Swim animation: tail beat + gentle body roll.
      f.tail.rotation.y = Math.sin(t * (5 + f.speed * 3) + f.phase) * 0.55;
      f.mesh.rotation.z = Math.sin(t * 1.7 + f.phase) * 0.06;
    }
  }
}
