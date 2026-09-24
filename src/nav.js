// Where a hull may float: water enough under it (terrain.js) and nothing
// solid in the way (scatter.js: rocks, boulders, logs, mangrove trunks; the
// built features — dams, lodges, sea stacks — are raised into the ground
// itself and need no listing here).

import { CONFIG } from './config.js';
import { waterDepth } from './terrain.js';
import { coastX } from './regions.js';
import { obstacleAt } from './scatter.js';
import { cellFeatures } from './terrain.js';
import { CELL } from './regions.js';
import { currentAt } from './currents.js';

const _cur = { x: 0, z: 0 };

export function isNavigable(x, z) {
  if (waterDepth(x, z) < CONFIG.MIN_NAV_DEPTH) return false;
  if (obstacleAt(x, z)) return false;
  // The boulders through a rapid.
  const f = cellFeatures(Math.floor(x / CELL), Math.floor(z / CELL));
  const b = f.boulders;
  for (let i = 0; i < b.length; i++) {
    const dx = x - b[i].x, dz = z - b[i].z, r = b[i].s * 0.85;
    if (dx * dx + dz * dz < r * r) return false;
  }
  // ... and the rocks at a waterfall's foot.
  for (const fall of f.falls) {
    if (Math.abs(x - fall.x) > 40 || Math.abs(z - fall.z) > 40) continue;
    for (const rk of fall.rocks) {
      const dx = x - rk.x, dz = z - rk.z, r = rk.s * 0.85;
      if (dx * dx + dz * dz < r * r) return false;
    }
  }
  return true;
}

/**
 * A random freshwater spot with sea room, for starting the game somewhere
 * new each time — within a few minutes' run of the coast, so the sea is
 * there to be found. `rng` may be seeded for a test.
 */
export function findStart(rng = Math.random) {
  for (let i = 0; i < 3000; i++) {
    const x = -450 + rng() * 800, z = -1200 + rng() * 2400;
    if (x > coastX(z) - 460) continue;
    if (waterDepth(x, z) < 2.5) continue;
    // Still water: nobody should drift off while they are reading the menu.
    currentAt(x, z, _cur);
    if (Math.hypot(_cur.x, _cur.z) > 0.1) continue;
    let ok = true;
    for (let a = 0; a < 12 && ok; a++) {
      const ang = (a / 12) * Math.PI * 2;
      if (!isNavigable(x + Math.cos(ang) * 14, z + Math.sin(ang) * 14) || waterDepth(x + Math.cos(ang) * 14, z + Math.sin(ang) * 14) < 1.4) ok = false;
    }
    if (ok) return { x, z, heading: rng() * Math.PI * 2 };
  }
  return { x: 0, z: 0, heading: 0 };
}
