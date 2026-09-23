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
  // Where a hand goes: on the grip, and beside the reel handle.
  const gripPoint = new THREE.Object3D();
  gripPoint.position.set(0.02, 0.28, 0.06);
  rod.add(gripPoint);
  const reelPoint = new THREE.Object3D();
  reelPoint.position.set(-0.05, 0.52, 0.16);
  rod.add(reelPoint);

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
  return {
    rod, tip, flex, side, want: null, cast: null, grip: gripPoint, reel: reelPoint,
    // Where it rests and how it is picked up (see updateRods): `rest` is
    // the holder, `hold` where a pair of hands wants it this frame, and
    // `pickup` how far it is out of the holder, 0 to 1.
    rest: null, restLay: REST_LAY, hold: null, holdPos: new THREE.Vector3(), pickup: 0,
  };
}

// In its holder a rod stands nearly upright, raked a little outboard and
// aft; in the hands it is laid over at REST_LAY.
export const HOLDER_LAY = 0.32;
const HOLDER_MAT = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.5 });
const HOLDER_GEO = {
  tube: new THREE.CylinderGeometry(0.052, 0.052, 0.3, 10, 1, true),
  collar: new THREE.TorusGeometry(0.052, 0.012, 6, 12),
  post: new THREE.CylinderGeometry(0.018, 0.018, 1, 6),
  foot: new THREE.CylinderGeometry(0.06, 0.06, 0.02, 8),
};
HOLDER_MAT.side = THREE.DoubleSide;

/**
 * A rod holder at a mount: an open tube the butt drops into, angled the
 * way the rod rests, on a post down to the deck `postH` below the mount.
 */
export function buildHolder(side, scale, postH) {
  const g = new THREE.Group();
  const tube = new THREE.Group();
  tube.rotation.order = 'YXZ';
  tube.rotation.set(HOLDER_LAY, side * REST_YAW, 0);
  const t = new THREE.Mesh(HOLDER_GEO.tube, HOLDER_MAT);
  t.position.y = 0.15 * scale;
  t.scale.set(scale, scale, scale);
  tube.add(t);
  const c = new THREE.Mesh(HOLDER_GEO.collar, HOLDER_MAT);
  c.rotation.x = Math.PI / 2;
  c.position.y = 0.3 * scale;
  c.scale.setScalar(scale);
  tube.add(c);
  g.add(tube);
  if (postH > 0.05) {
    const p = new THREE.Mesh(HOLDER_GEO.post, HOLDER_MAT);
    p.scale.set(scale, postH, scale);
    p.position.y = -postH / 2;
    g.add(p);
    const f = new THREE.Mesh(HOLDER_GEO.foot, HOLDER_MAT);
    f.scale.setScalar(scale);
    f.position.y = -postH;
    g.add(f);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// A cast, on the rod itself: back over the shoulder, then whipped forward
// and settled. The fisherman's hands ride on the grip, so the body follows
// this rather than the other way about.
const CAST_S = 1.1;

/** Start a cast on a rod, toward a bearing in the boat's frame. */
export function castRod(r, yaw) {
  r.cast = { t: 0, yaw };
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

/**
 * Where a rod on one side may point: anywhere from nearly straight aft
 * round to straight ahead on its own side of the boat — never back across
 * the deck, never over the far rail. The result is a yaw in the rod's own
 * convention (0 aft, +PI/2 to starboard).
 */
export function clampRodYaw(side, yaw) {
  const a = wrapAngle(side * yaw);          // angle out on the rod's own side
  return side * Math.max(0.15, Math.min(Math.PI - 0.05, a));
}

/**
 * Ease every rod toward whatever it was last aimed at, and in or out of its
 * holder: a rod with `hold` set (a point in the boat's frame where hands
 * want its butt) lifts out over about half a second and follows that point;
 * with `hold` cleared it settles back into the holder the same way.
 */
export function updateRods(rods, dt) {
  const k = Math.min(1, 6 * dt);
  for (const r of rods) {
    if (!r.rest) { r.rest = r.rod.position.clone(); r.holdPos.copy(r.rest); }
    // Out of the holder and into the hands, smoothly, and back.
    r.pickup += ((r.hold ? 1 : 0) - r.pickup) * Math.min(1, 4 * dt);
    if (r.hold) r.holdPos.lerp(r.hold, Math.min(1, 14 * dt));
    const u = r.pickup * r.pickup * (3 - 2 * r.pickup);
    r.rod.position.lerpVectors(r.rest, r.holdPos, u);

    const restYaw = r.side * REST_YAW;
    let yaw = restYaw, lay = r.restLay + (REST_LAY - r.restLay) * u, bend = 0;
    if (r.cast) {
      r.cast.t += dt;
      const u = r.cast.t / CAST_S;
      if (u >= 1) { r.cast = null; }
      else {
        // Wind up (0-0.4): the tip goes back past vertical. Whip (0.4-0.65):
        // it comes over hard. Settle (0.65-1): back to where it is held.
        let l;
        if (u < 0.4) { const e = u / 0.4; l = REST_LAY - (REST_LAY + 0.55) * e * e; }
        else if (u < 0.65) { const e = (u - 0.4) / 0.25; l = -0.55 + (1.25 + 0.55) * e * e; }
        else { const e = (u - 0.65) / 0.35; l = 1.25 + (REST_LAY + 0.22 - 1.25) * (1 - Math.pow(1 - e, 2)); }
        const wantYaw = clampRodYaw(r.side, r.cast.yaw);
        r.group.rotation.y += wrapAngle(wantYaw - r.group.rotation.y) * Math.min(1, 12 * dt);
        r.group.rotation.x += (l - r.group.rotation.x) * Math.min(1, 22 * dt);
        r.flex.rotation.x += ((u > 0.4 && u < 0.7 ? -0.5 : 0.15) - r.flex.rotation.x) * Math.min(1, 14 * dt);
        continue;
      }
    }
    if (r.want) {
      // Follow the line, but never far enough to swing back over the deck.
      yaw = clampRodYaw(r.side, r.want.yaw);
      lay = r.restLay + (REST_LAY + 0.22 * r.want.load - r.restLay) * Math.max(u, 0.35);
      bend = 0.66 * r.want.load;
    }
    r.group.rotation.y += wrapAngle(yaw - r.group.rotation.y) * k;
    r.group.rotation.x += (lay - r.group.rotation.x) * k;
    r.flex.rotation.x += (bend - r.flex.rotation.x) * k;
  }
}
