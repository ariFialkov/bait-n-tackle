// What lies where on a chunk: the props each biome strews over it, decided
// once per chunk from the seed and cached, so the meshes (props.js) and the
// hull physics (nav.js) agree on exactly where every rock and log is. The
// solid ones — rocks, boulders, logs, driftwood, mangrove trunks — are also
// listed as obstacles a hull cannot pass through; the soft ones (reeds,
// cattails, lily pads) are not, and bend out of a hull's way instead.

import { CONFIG } from './config.js';
import { mulberry32, hash2 } from './noise.js';
import { regionBlend } from './regions.js';
import { terrainHeight } from './terrain.js';

const S = CONFIG.SEED;
const chunks = new Map();

function key(cx, cz) { return (cx + 100000) * 200003 + (cz + 100000); }

/**
 * The prop lists for a chunk, and its obstacles as [x, z, r, ax, az, half]:
 * a disc of radius r, or for a log a capsule of half-length `half` along
 * (ax, az). Deterministic per chunk; built once.
 */
export function chunkItems(cx, cz) {
  const k = key(cx, cz);
  let it = chunks.get(k);
  if (it) return it;
  const size = CONFIG.CHUNK_SIZE, ox = cx * size, oz = cz * size;
  const rng = mulberry32((hash2(cx, cz, S + 5) * 1e9) | 0);
  const L = { pine: [], snowpine: [], rock: [], boulder: [], reed: [], cattail: [], lily: [], flower: [],
    log: [], driftwood: [], stick: [], mangrove: [], palm: [] };

  for (let i = 0; i < 150; i++) {
    const x = ox + (rng() - 0.5) * size;
    const z = oz + (rng() - 0.5) * size;
    const h = terrainHeight(x, z);
    const bl = regionBlend(x, z);
    const reg = rng() < bl.wa ? bl.a : bl.b;
    const p = reg.biome.props;
    const roll = rng();
    if (h > 1.4 && h < 6.5) {
      if (p.palm && h < 3.2 && roll < p.palm * 0.55) L.palm.push({ x, z, h, s: 0.75 + rng() * 0.6, r: rng() * 6.28 });
      else if (p.snowpine && h > 3.2 && roll < p.snowpine) L.snowpine.push({ x, z, h, s: 0.7 + rng() * 0.9, r: rng() * 6.28 });
      else if (p.pine && roll < p.pine) L.pine.push({ x, z, h, s: 0.7 + rng() * 0.9, r: rng() * 6.28 });
      else if (p.boulder && roll < p.pine + p.boulder * 0.25) L.boulder.push({ x, z, h, s: 0.6 + rng() * 1.0, r: rng() * 6.28 });
    } else if (h > -0.15 && h < 1.4) {
      if (p.mangrove && h < 0.6 && roll < p.mangrove * 0.5) L.mangrove.push({ x, z, h, s: 0.8 + rng() * 0.5, r: rng() * 6.28 });
      else if (p.driftwood && h > 0.1 && roll < p.driftwood * 0.45) L.driftwood.push({ x, z, h, s: 0.5 + rng() * 0.6, r: rng() * 6.28 });
      else if (p.rock && roll < p.rock * 0.35) L.rock.push({ x, z, h, s: 0.35 + rng() * 0.75, r: rng() * 6.28 });
      else if (p.boulder && roll < p.boulder * 0.4) L.boulder.push({ x, z, h, s: 0.5 + rng() * 0.9, r: rng() * 6.28 });
      else if (p.palm && h > 0.5 && roll < p.palm * 0.5) L.palm.push({ x, z, h, s: 0.7 + rng() * 0.5, r: rng() * 6.28 });
      else if ((p.reed || p.cattail) && h < 0.5 && roll < p.reed + p.cattail) {
        const n = 6 + Math.floor(rng() * 10);
        for (let k2 = 0; k2 < n; k2++) {
          const rx = x + (rng() - 0.5) * 4, rz = z + (rng() - 0.5) * 4;
          const rh = terrainHeight(rx, rz);
          if (rh < -0.7 || rh > 0.6) continue;
          const tail = p.cattail && rng() < p.cattail / (p.reed + p.cattail);
          (tail ? L.cattail : L.reed).push({ x: rx, z: rz, h: rh, s: 0.7 + rng() * 0.6, r: rng() * 6.28, lean: (rng() - 0.5) * 0.3 });
        }
      }
    } else if (h <= -0.15 && h > -2.2) {
      if (p.mangrove && h > -1.3 && roll < p.mangrove * 0.45) L.mangrove.push({ x, z, h, s: 0.8 + rng() * 0.5, r: rng() * 6.28 });
      else if (p.lily && h > -1.7 && roll < p.lily) {
        const n = 5 + Math.floor(rng() * 8);
        for (let k2 = 0; k2 < n; k2++) {
          const lx = x + (rng() - 0.5) * 5, lz = z + (rng() - 0.5) * 5;
          const lh = terrainHeight(lx, lz);
          if (lh > -0.2 || lh < -2) continue;
          L.lily.push({ x: lx, z: lz, s: 0.6 + rng() * 0.7, r: rng() * 6.28 });
          if (rng() < 0.18) L.flower.push({ x: lx, z: lz, s: 0.8 + rng() * 0.5, r: 0 });
        }
      } else if (p.log && h > -1.6 && roll < p.lily + p.log * 0.5) L.log.push({ x, z, h, s: 0.7 + rng() * 0.6, r: rng() * 6.28 });
      else if (p.stick && roll < p.lily + p.log * 0.5 + p.stick * 0.6) {
        const n = 2 + Math.floor(rng() * 4);
        for (let k2 = 0; k2 < n; k2++) L.stick.push({ x: x + (rng() - 0.5) * 3, z: z + (rng() - 0.5) * 3, s: 0.8 + rng() * 0.8, r: rng() * 6.28 });
      } else if (p.boulder && h > -1.6 && roll < 0.9 && rng() < p.boulder * 0.3) L.boulder.push({ x, z, h, s: 0.6 + rng() * 0.9, r: rng() * 6.28 });
      else if (p.reed && h > -0.6 && rng() < p.reed * 0.5) {
        const n = 4 + Math.floor(rng() * 6);
        for (let k2 = 0; k2 < n; k2++) {
          const rx = x + (rng() - 0.5) * 3, rz = z + (rng() - 0.5) * 3;
          const rh = terrainHeight(rx, rz);
          if (rh < -0.7 || rh > 0.6) continue;
          L.reed.push({ x: rx, z: rz, h: rh, s: 0.7 + rng() * 0.6, r: rng() * 6.28, lean: (rng() - 0.5) * 0.3 });
        }
      }
    }
  }

  // The solid ones, as the hull sees them. Only what stands in or at the
  // water matters: a pine up a hill is nothing a boat can reach.
  const obs = [];
  for (const t of L.rock) if (t.h < 1.2) obs.push(t.x, t.z, 0.5 * t.s, 0, 0, 0);
  for (const t of L.boulder) if (t.h < 1.2) obs.push(t.x, t.z, 0.85 * t.s, 0, 0, 0);
  for (const t of L.mangrove) obs.push(t.x, t.z, 0.55 * t.s, 0, 0, 0);
  for (const list of [L.log, L.driftwood]) {
    for (const t of list) {
      if (t.h > 1.2) continue;
      // Lying along its yaw: the log geometry runs along local x, turned by r about y.
      obs.push(t.x, t.z, 0.3 * t.s, Math.cos(t.r), -Math.sin(t.r), 1.5 * t.s);
    }
  }
  it = { L, obs: new Float32Array(obs) };
  chunks.set(k, it);
  return it;
}

/** Is a point inside a solid prop? Checks the chunk it is in and any it is near the edge of. */
export function obstacleAt(x, z) {
  const size = CONFIG.CHUNK_SIZE, half = size / 2;
  const cx = Math.round(x / size), cz = Math.round(z / size);
  const fx = x - cx * size, fz = z - cz * size;
  const R = 5;   // no obstacle reaches further than this from its point
  const dxs = fx < -half + R ? -1 : fx > half - R ? 1 : 0;
  const dzs = fz < -half + R ? -1 : fz > half - R ? 1 : 0;
  for (let ix = 0; ix <= Math.abs(dxs); ix++) {
    for (let iz = 0; iz <= Math.abs(dzs); iz++) {
      const o = chunkItems(cx + ix * dxs, cz + iz * dzs).obs;
      for (let i = 0; i < o.length; i += 6) {
        let dx = x - o[i], dz = z - o[i + 1];
        const hl = o[i + 5];
        if (hl > 0) {
          // A capsule: clamp onto the log's axis first.
          let t = dx * o[i + 3] + dz * o[i + 4];
          t = t < -hl ? -hl : t > hl ? hl : t;
          dx -= o[i + 3] * t; dz -= o[i + 4] * t;
        }
        const r = o[i + 2];
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
  }
  return false;
}
