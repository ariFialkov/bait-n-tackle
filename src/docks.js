// Marinas: small coastal outposts that generate deterministically along the
// shoreline as the lake streams in. Pull up to one and the boat store opens.
//
// Catches are paid at the rail, so there is nothing to haul ashore and a
// marina is a shop, never a chore — the only reason to look for one is to
// spend money on a boat.
//
// Placement is seeded per chunk so the same stretch of river always has the
// same outposts, and a marina only exists where there is genuine shoreline
// with navigable water in front of it.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { terrainHeight, waterDepth } from './lake.js';
import { hash2, mulberry32 } from './noise.js';

const S = CONFIG.SEED;
export const DOCK_RADIUS = 8;        // how close you must be to trigger
export const DOCK_HINT_RANGE = 170;  // how far away the HUD points one out

// --- placement -----------------------------------------------------------

/** Deterministic docks for a chunk: [] or a single { x, z, angle }. */
export function chunkDocks(cx, cz) {
  // The outpost gate and the placement rolls are unchanged from when fish
  // markets shared the shoreline, so every marina that exists today stands
  // exactly where it always did. Chunks that used to roll a market get
  // nothing at all, and one in five of the surviving marinas is culled on
  // top of that.
  if (hash2(cx, cz, S + 401) > 0.36) return [];
  const rng = mulberry32((hash2(cx, cz, S + 409) * 1e9) | 0);
  const size = CONFIG.CHUNK_SIZE;
  const ox = cx * size, oz = cz * size;

  for (let attempt = 0; attempt < 24; attempt++) {
    const x = ox + (rng() - 0.5) * (size - 10);
    const z = oz + (rng() - 0.5) * (size - 10);
    const h = terrainHeight(x, z);
    if (h < 0.15 || h > 1.6) continue;              // must be right at the shore

    // Downhill direction = toward open water.
    const e = 2.5;
    const gx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
    const gz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
    const gl = Math.hypot(gx, gz);
    if (gl < 0.25) continue;                        // too flat to read a shoreline
    const dx = -gx / gl, dz = -gz / gl;

    // The pier runs out over the water; its head needs room for a boat.
    const pierLen = 7 + rng() * 3;
    const hx = x + dx * pierLen, hz = z + dz * pierLen;
    if (waterDepth(hx, hz) < 1.4) continue;
    // Keep the approach clear a bit further out, too.
    if (waterDepth(x + dx * (pierLen + 6), z + dz * (pierLen + 6)) < 1.0) continue;
    // And make sure there is real land behind the shack.
    if (terrainHeight(x - dx * 5, z - dz * 5) < 1.0) continue;

    // Same draw, same position in the sequence, as the old market/marina
    // split — so the marinas that survive are the ones that were already
    // marinas. The old markets are simply gone.
    if (rng() < 0.62) return [];
    if (rng() < 0.20) return [];      // and thin the rest by a fifth

    return [{
      x, z,
      headX: hx, headZ: hz,
      angle: Math.atan2(dx, dz),
      pierLen,
      key: `${cx}|${cz}`,
    }];
  }
  return [];
}

// --- meshes --------------------------------------------------------------

const MAT = {
  plank: new THREE.MeshLambertMaterial({ color: 0xa97f4e }),
  plankDark: new THREE.MeshLambertMaterial({ color: 0x7d5b36 }),
  piling: new THREE.MeshLambertMaterial({ color: 0x5f4629 }),
  marinaWall: new THREE.MeshLambertMaterial({ color: 0xdfeaf2 }),
  marinaRoof: new THREE.MeshLambertMaterial({ color: 0x3f8fd0 }),
  trim: new THREE.MeshLambertMaterial({ color: 0xf6f1e4 }),
  buoy: new THREE.MeshLambertMaterial({ color: 0xe8b23a }),
};

const GEO = {
  plank: new THREE.BoxGeometry(1, 1, 1),
  piling: new THREE.CylinderGeometry(0.16, 0.19, 1, 6),
  roof: new THREE.ConeGeometry(1, 1, 4),
  buoy: new THREE.SphereGeometry(0.22, 8, 6),
  post: new THREE.CylinderGeometry(0.08, 0.08, 1, 5),
  sign: new THREE.BoxGeometry(1.5, 0.75, 0.08),
};

function box(geo, mat, w, h, d, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function buildDock(dock) {
  const g = new THREE.Group();
  const L = dock.pierLen;

  // Pier deck, running from shore (z=0) out over the water (+z local).
  const deck = box(GEO.plank, MAT.plank, 2.6, 0.18, L, 0, 0.42, L / 2);
  deck.receiveShadow = true;
  g.add(deck);
  // Plank seams
  for (let i = 1; i < Math.floor(L / 1.2); i++) {
    g.add(box(GEO.plank, MAT.plankDark, 2.62, 0.04, 0.09, 0, 0.52, i * 1.2));
  }
  // Pilings down each side
  for (let i = 0; i <= Math.floor(L / 2.2); i++) {
    for (const sx of [-1.18, 1.18]) {
      const p = new THREE.Mesh(GEO.piling, MAT.piling);
      p.scale.set(1, 2.6, 1);
      p.position.set(sx, -0.9, 0.6 + i * 2.2);
      p.castShadow = true;
      g.add(p);
    }
  }
  // Bumper buoys at the head, where a boat ties up
  for (const sx of [-1.35, 1.35]) {
    for (const dz of [-1.2, 0.3]) {
      const b = new THREE.Mesh(GEO.buoy, MAT.buoy);
      b.position.set(sx, 0.16, L + dz);
      g.add(b);
    }
  }

  // Shack on the shore end
  const shack = new THREE.Group();
  shack.add(box(GEO.plank, MAT.marinaWall, 4.2, 2.5, 3.4, 0, 1.75, 0));
  const r = new THREE.Mesh(GEO.roof, MAT.marinaRoof);
  r.scale.set(3.5, 1.5, 2.9);
  r.rotation.y = Math.PI / 4;
  r.position.y = 3.75;
  r.castShadow = true;
  shack.add(r);
  shack.add(box(GEO.plank, MAT.trim, 4.4, 0.16, 3.6, 0, 3.0, 0));
  shack.position.set(0, 0.1, -2.1);
  g.add(shack);

  // Empty berths alongside, marked out with posts
  for (const sx of [-2.5, 2.5]) {
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(GEO.post, MAT.piling);
      p.scale.set(1, 2.4, 1);
      p.position.set(sx, 0.2, 1.6 + i * 2.4);
      g.add(p);
    }
  }

  // Sign on two posts at the shore end of the pier
  const sign = new THREE.Group();
  for (const sx of [-0.62, 0.62]) {
    const p = new THREE.Mesh(GEO.post, MAT.piling);
    p.scale.set(1, 2.2, 1);
    p.position.set(sx, 1.1, 0);
    sign.add(p);
  }
  const board = new THREE.Mesh(GEO.sign, MAT.marinaRoof);
  board.position.y = 2.25;
  board.castShadow = true;
  sign.add(board);
  sign.add(box(GEO.plank, MAT.trim, 1.3, 0.12, 0.1, 0, 2.45, 0.06));
  sign.position.set(0, 0.42, 0.9);
  g.add(sign);

  g.position.set(dock.x, 0, dock.z);
  g.rotation.y = dock.angle;
  return g;
}

// --- manager -------------------------------------------------------------

export class Docks {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.active = new Map();   // dock -> mesh
    this.list = [];
  }

  /** Rebuild the visible set from the currently loaded chunk docks. */
  sync(docks) {
    for (const d of docks) {
      if (!this.active.has(d)) {
        const mesh = buildDock(d);
        this.group.add(mesh);
        this.active.set(d, mesh);
      }
    }
    for (const [d, mesh] of this.active) {
      if (!docks.includes(d)) {
        this.group.remove(mesh);
        mesh.traverse((o) => { if (o.isMesh && o.geometry.dispose && !GEO[o.name]) { /* shared geo */ } });
        this.active.delete(d);
      }
    }
    this.list = docks;
  }

  /** Nearest marina to a point. */
  nearest(x, z) {
    let best = null, bestD = Infinity;
    for (const d of this.list) {
      const dist = Math.hypot(d.headX - x, d.headZ - z);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return { dock: best, dist: bestD };
  }

  /** The dock whose head the boat is currently sitting at, if any. */
  dockAt(x, z) {
    for (const d of this.list) {
      if (Math.hypot(d.headX - x, d.headZ - z) <= DOCK_RADIUS) return d;
    }
    return null;
  }
}
