// Fishing rods, as working gear rather than scenery.
//
// A rod is built standing straight up and then aimed: `rotation.y` is the
// bearing it points along (0 = straight aft, +/-PI/2 = square out to
// starboard/port) and `rotation.x` is how far it is laid over toward that
// bearing. The top third hangs off a hinge, so the tip loads up when there is
// something on the end of the line.
//
// At rest a rod rakes well outboard, so the lines hang over open water rather
// than back across the deck — which is where they used to end up, because the
// roll that was meant to splay them out leaned them inboard instead.

import * as THREE from 'three';
import { wrapAngle } from './hullphysics.js';

const ROD_GEO = {
  butt: new THREE.CylinderGeometry(0.019, 0.03, 1.5, 5),
  tip: new THREE.CylinderGeometry(0.009, 0.019, 0.9, 5),
  grip: new THREE.CylinderGeometry(0.035, 0.035, 0.4, 6),
  reel: new THREE.CylinderGeometry(0.07, 0.07, 0.05, 9),
};
const ROD_MAT = {
  dark: new THREE.MeshStandardMaterial({ color: 0x40342c, roughness: 0.6 }),
  grip: new THREE.MeshStandardMaterial({ color: 0xc94f30, roughness: 0.6 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xb8c0c4, roughness: 0.3, metalness: 0.7 }),
};

const REST_YAW = 1.12;     // radians off the stern line, toward the rail
const REST_LAY = 0.62;     // how far it is laid down from vertical
const YAW_RANGE = 0.85;    // how far it may swing to follow its line

/** One rod at a mount. `scale` sizes it to the boat it is bolted to. */
export function buildRod(side, scale) {
  const rod = new THREE.Group();
  rod.rotation.order = 'YXZ';
  const butt = new THREE.Mesh(ROD_GEO.butt, ROD_MAT.dark);
  butt.position.y = 0.75;
  butt.castShadow = true;
  rod.add(butt);
  const grip = new THREE.Mesh(ROD_GEO.grip, ROD_MAT.grip);
  grip.position.y = 0.2;
  rod.add(grip);
  const reel = new THREE.Mesh(ROD_GEO.reel, ROD_MAT.chrome);
  reel.rotation.z = Math.PI / 2;
  reel.position.set(0, 0.5, 0.07);
  rod.add(reel);

  // Hinge at the ferrule: everything above it bends under load.
  const flex = new THREE.Object3D();
  flex.position.y = 1.5;
  rod.add(flex);
  const tipMesh = new THREE.Mesh(ROD_GEO.tip, ROD_MAT.dark);
  tipMesh.position.y = 0.45;
  tipMesh.castShadow = true;
  flex.add(tipMesh);
  const tip = new THREE.Object3D();
  tip.position.y = 0.9;
  flex.add(tip);

  rod.rotation.set(REST_LAY, side * REST_YAW, 0);
  rod.scale.setScalar(scale);
  return { rod, tip, flex, side, want: null };
}

/**
 * Point the working rods at their own lines. `aims` is
 * [{ index, x, z, load }] in world space; every other rod goes back to rest.
 */
export function aimRods(rods, origin, heading, aims) {
  for (const r of rods) r.want = null;
  for (const a of aims) {
    const r = rods[Math.min(a.index, rods.length - 1)];
    if (!r) continue;
    // Bearing of the line in the boat's frame, measured the way a rod's own
    // yaw is: 0 straight aft, +PI/2 out to starboard.
    const bear = Math.atan2(a.x - origin.x, a.z - origin.z) - heading;
    r.want = { yaw: wrapAngle(bear), load: a.load };
  }
}

/** Ease every rod toward whatever it was last aimed at. */
export function updateRods(rods, dt) {
  const k = Math.min(1, 6 * dt);
  for (const r of rods) {
    const restYaw = r.side * REST_YAW;
    let yaw = restYaw, lay = REST_LAY, bend = 0;
    if (r.want) {
      // Follow the line, but never far enough to swing back over the deck.
      yaw = restYaw + Math.max(-YAW_RANGE, Math.min(YAW_RANGE,
        wrapAngle(r.want.yaw - restYaw)));
      lay = REST_LAY + 0.22 * r.want.load;
      bend = 0.66 * r.want.load;
    }
    r.group.rotation.y += wrapAngle(yaw - r.group.rotation.y) * k;
    r.group.rotation.x += (lay - r.group.rotation.x) * k;
    r.flex.rotation.x += (bend - r.flex.rotation.x) * k;
  }
}
