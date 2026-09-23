// The deck as ground: where on a hull a person can stand and walk.
//
// Built by raying the hull model on a grid. Every surface within the hull's
// working-height band that has standing room above it is a floor, so a
// cell can hold more than one: the promenade of a riverboat AND the sun
// deck over it. A bin or a cabin on the deck blocks, a boom three metres up
// does not. Neighbouring floors join where the step between them is small
// (a hatch coaming, the slope of a seiner's deck); bigger drops join only
// where a hull's stations say there is a ladder (`links`). Walls are found
// with a second pass of rays between neighbouring cells at body height, so
// a path goes round a wheelhouse and through its doorway rather than
// through the wall. The cells reachable from the helm are marked, and paths
// prefer them.
//
// Everything is in the hull's own frame: bow at -z, waterline at y = 0.

import * as THREE from 'three';

const STEP = 0.3;            // anything lower than this on a floor is walked over
const JOIN = 0.45;           // floors this close in height join across a cell edge

export class DeckMap {
  /**
   * `hull` is the hull object (unrotated, hull frame); `range` is [lo, hi],
   * the band of heights a floor may lie in; `bounds` the hull's box. Options:
   * `cell` the grid pitch, `headroom` the clear height a person needs,
   * `links` ladders as [{a:{x,y,z}, b:{x,y,z}}], `from` the spot reachability
   * is measured from, `join` overrides the step cells may join across.
   */
  constructor(hull, range, bounds, { cell = 0.5, headroom = 1.75, links = [], from = null, join = JOIN } = {}) {
    const CELL = this.cell = cell;
    this.lo = range[0]; this.hi = range[1];
    this.deckY = (range[0] + range[1]) / 2;
    this.join = join;
    this.minX = Math.floor(bounds.min.x / CELL) * CELL;
    this.minZ = Math.floor(bounds.min.z / CELL) * CELL;
    this.nx = Math.ceil((bounds.max.x - this.minX) / CELL) + 1;
    this.nz = Math.ceil((bounds.max.z - this.minZ) / CELL) + 1;
    const N = this.nx * this.nz;
    this.layers = new Array(N);          // per cell: [{ y, walk, reach, wall: bitmask }]
    for (let i = 0; i < N; i++) this.layers[i] = [];
    this.solid = new Uint8Array(N);      // 1 where the ray met the hull at all (not over the side)

    const ray = new THREE.Raycaster();
    const from_ = new THREE.Vector3();
    const dir = new THREE.Vector3(0, -1, 0);
    hull.updateWorldMatrix(true, true);
    const top = bounds.max.y + 1;
    // Some decks are modelled with their faces downward, which a one-sided
    // ray would sail straight through: look at both sides while mapping.
    const sides = [];
    hull.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        sides.push([m, m.side]);
        m.side = THREE.DoubleSide;
      }
    });
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        // A hair off the cell's centre: low-poly decks have edges that line
        // up with a round-number grid, and a ray down an edge finds nothing.
        from_.set(this.minX + ix * CELL + CELL * 0.037, top, this.minZ + iz * CELL + CELL * 0.043);
        ray.set(from_, dir);
        ray.far = top - bounds.min.y + 1;
        const ys = ray.intersectObject(hull, true).map((h) => h.point.y);   // nearest (highest) first
        const out = this.layers[iz * this.nx + ix];
        this.solid[iz * this.nx + ix] = ys.length ? 1 : 0;
        for (let k = 0; k < ys.length; k++) {
          const y = ys[k];
          if (y < this.lo || y > this.hi) continue;
          // Clearance: the first thing above this surface that is more than
          // a step up. Thin slabs read as two hits a hand apart; a step is
          // walked over.
          let above = Infinity;
          for (let j = k - 1; j >= 0; j--) { if (ys[j] > y + STEP) { above = ys[j]; break; } }
          if (above - y < headroom) continue;
          // Merge with a floor a step above it already found (its top).
          if (out.length && out[out.length - 1].y - y <= STEP) continue;
          out.push({ y, walk: true, reach: false, wall: 0 });
        }
      }
    }
    for (const [m, side] of sides) m.side = side;

    // A cell at the very edge with open water beside it is the gunwale,
    // not somewhere to put a foot: keep the walkable area one cell in.
    const over = (ix, iz) => !this.inside(ix, iz) || !this.solid[iz * this.nx + ix];
    for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) {
      if (over(ix - 1, iz) || over(ix + 1, iz)) for (const L of this.layers[iz * this.nx + ix]) L.walk = false;
    }

    // Walls: a ray at body height from each floor to each of its four
    // neighbours. Anything in the way closes that edge.
    const hit = new THREE.Vector3();
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [m] of sides) m.side = THREE.DoubleSide;
    for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) {
      for (const L of this.layers[iz * this.nx + ix]) {
        if (!L.walk) continue;
        for (let d = 0; d < 4; d++) {
          const [dx, dz] = dirs[d];
          const M = this.layerNear(ix + dx, iz + dz, L.y, join);
          if (!M || !M.walk) continue;
          // Two rays, at the knee and the chest: a wall with a window in it
          // is still a wall, and a low bulwark still stops a foot.
          hit.set(dx, 0, dz);
          for (const k of [0.22, 0.6]) {
            from_.set(this.minX + ix * CELL + CELL * 0.037, L.y + headroom * k, this.minZ + iz * CELL + CELL * 0.043);
            ray.set(from_, hit);
            ray.far = CELL;
            if (ray.intersectObject(hull, true).length) { L.wall |= (1 << d); break; }
          }
        }
      }
    }
    for (const [m, side] of sides) m.side = side;

    // Ladders between levels.
    this.links = [];
    for (const l of links) {
      const a = this.nodeAt(l.a.x, l.a.z, l.a.y), b = this.nodeAt(l.b.x, l.b.z, l.b.y);
      if (a && b) this.links.push({ a, b, ya: l.a.y, yb: l.b.y });
    }

    // What the crew can get to from the helm.
    this.walkableCount = 0;
    for (const cell of this.layers) for (const L of cell) if (L.walk) this.walkableCount++;
    const start = from ? this.nodeAt(from.x, from.z, from.y) : null;
    this.reachCount = 0;
    if (start) {
      let n = this.flood(start, true);
      // A helm walled in on every side is a cabin with no door modelled:
      // count what could be reached through the wall instead.
      if (n < this.walkableCount * 0.3) { for (const c of this.layers) for (const L of c) L.reach = false; n = this.flood(start, false); }
      this.reachCount = n;
    } else {
      for (const cell of this.layers) for (const L of cell) L.reach = L.walk;
      this.reachCount = this.walkableCount;
    }
    this.cells = this.reachCount;
  }

  // --- lookups ---------------------------------------------------------------

  cellOf(x, z) {
    return [Math.round((x - this.minX) / this.cell), Math.round((z - this.minZ) / this.cell)];
  }

  inside(ix, iz) { return ix >= 0 && iz >= 0 && ix < this.nx && iz < this.nz; }

  /** The floor in cell (ix, iz) nearest height y, if within `tol` of it. */
  layerNear(ix, iz, y, tol = this.join) {
    if (!this.inside(ix, iz)) return null;
    let best = null, bd = tol;
    for (const L of this.layers[iz * this.nx + ix]) {
      const d = Math.abs(L.y - y);
      if (d <= bd) { bd = d; best = L; }
    }
    return best;
  }

  /** A node {ix, iz, L} for a point, taking the floor nearest `y` (any floor if y is not given). */
  nodeAt(x, z, y) {
    const [ix, iz] = this.cellOf(x, z);
    if (!this.inside(ix, iz)) return null;
    const cell = this.layers[iz * this.nx + ix];
    if (!cell.length) return null;
    let L = cell[0];
    if (y != null) { let bd = Infinity; for (const c of cell) { const d = Math.abs(c.y - y); if (d < bd) { bd = d; L = c; } } }
    return { ix, iz, L };
  }

  /** Whether there is floor at a point (near `y`), walkable or not. */
  standable(x, z, y) {
    const n = this.nodeAt(x, z, y);
    return !!n && (y == null || Math.abs(n.L.y - y) < 1.0);
  }

  walkable(x, z, y) {
    const n = this.nodeAt(x, z, y);
    return !!n && n.L.walk && (y == null || Math.abs(n.L.y - y) < 1.0);
  }

  /** Floor height under a point, the floor nearest `y` (NaN over the side). */
  heightAt(x, z, y) {
    const n = this.nodeAt(x, z, y);
    return n ? n.L.y : NaN;
  }

  /** The nearest walkable point to (x, z), preferring reachable floors near `y`. */
  nearest(x, z, y) {
    const [cx, cz] = this.cellOf(x, z);
    let best = null, bd = Infinity;
    for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) {
      for (const L of this.layers[iz * this.nx + ix]) {
        if (!L.walk) continue;
        let d = (ix - cx) * (ix - cx) + (iz - cz) * (iz - cz);
        if (y != null) d += Math.abs(L.y - y) * 2 / this.cell;
        if (!L.reach) d += 400;
        if (d < bd) { bd = d; best = { x: this.minX + ix * this.cell, z: this.minZ + iz * this.cell, y: L.y }; }
      }
    }
    return best;
  }

  /** The deck's edge on one side at a given z: the outermost floor's x near `y`. */
  railAt(z, side, y = this.deckY) {
    const iz = Math.round((z - this.minZ) / this.cell);
    if (iz < 0 || iz >= this.nz) return null;
    const ok = (ix) => { const L = this.layerNear(ix, iz, y, 0.6); return L && L.walk; };
    if (side > 0) { for (let ix = this.nx - 1; ix >= 0; ix--) if (ok(ix)) return this.minX + ix * this.cell; }
    else { for (let ix = 0; ix < this.nx; ix++) if (ok(ix)) return this.minX + ix * this.cell; }
    return null;
  }

  /** The range of z over which one side of the deck exists: [z0, z1] or null. */
  deckSpan(side) {
    let z0 = Infinity, z1 = -Infinity;
    for (let iz = 0; iz < this.nz; iz++) {
      const z = this.minZ + iz * this.cell;
      if (this.railAt(z, side) === null) continue;
      z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    return z0 <= z1 ? [z0, z1] : null;
  }

  // --- graph -----------------------------------------------------------------

  /** Neighbouring nodes of a node, with the cost to reach them. */
  neighbours(n, walls, out) {
    out.length = 0;
    const dirs = [[1, 0, 0], [-1, 0, 1], [0, 1, 2], [0, -1, 3]];
    const ortho = [];
    for (const [dx, dz, d] of dirs) {
      if (walls && (n.L.wall & (1 << d))) { ortho.push(null); continue; }
      const M = this.layerNear(n.ix + dx, n.iz + dz, n.L.y);
      if (!M || !M.walk) { ortho.push(null); continue; }
      const m = { ix: n.ix + dx, iz: n.iz + dz, L: M };
      ortho.push(m);
      out.push([m, 1 + Math.abs(M.y - n.L.y)]);
    }
    // Diagonals, no corner cutting: both orthogonal steps must be open.
    const diag = [[1, 1, 0, 2], [1, -1, 0, 3], [-1, 1, 1, 2], [-1, -1, 1, 3]];
    for (const [dx, dz, a, b] of diag) {
      if (!ortho[a] || !ortho[b]) continue;
      const M = this.layerNear(n.ix + dx, n.iz + dz, n.L.y);
      if (!M || !M.walk) continue;
      out.push([{ ix: n.ix + dx, iz: n.iz + dz, L: M }, 1.4142 + Math.abs(M.y - n.L.y)]);
    }
    for (const l of this.links) {
      if (l.a.L === n.L) out.push([l.b, 1.5, l]);
      else if (l.b.L === n.L) out.push([l.a, 1.5, l]);
    }
    return out;
  }

  flood(start, walls) {
    const stack = [start];
    start.L.reach = true;
    let n = 1;
    const nb = [];
    while (stack.length) {
      const c = stack.pop();
      for (const [m] of this.neighbours(c, walls, nb)) {
        if (m.L.reach) continue;
        m.L.reach = true; n++;
        stack.push(m);
      }
    }
    return n;
  }

  /**
   * A path of {x, z[, y]} waypoints from a to b over walkable floors (A*,
   * eight ways, ladders where the hull has them). Ends off the deck are
   * joined to the nearest floor, so a post inside a cabin is still reached.
   * Waypoints carry `y` only at the two ends of a ladder; elsewhere the
   * floor is under the feet. Returns [] when there is no deck at all.
   */
  path(ax, az, bx, bz, ay, by) {
    const sN = this.walkable(ax, az, ay) ? this.nodeAt(ax, az, ay) : this.nodeOf(this.nearest(ax, az, ay));
    const gN = this.walkable(bx, bz, by) ? this.nodeAt(bx, bz, by) : this.nodeOf(this.nearest(bx, bz, by));
    if (!sN || !gN) return [];
    let pts = this.astar(sN, gN, true);
    if (!pts) pts = this.astar(sN, gN, false);
    const out = pts || [];
    out.push({ x: bx, z: bz });
    return out;
  }

  nodeOf(p) { return p ? this.nodeAt(p.x, p.z, p.y) : null; }

  astar(sN, gN, walls) {
    const key = (n) => `${n.ix},${n.iz},${n.L.y.toFixed(2)}`;
    const sk = key(sN), gk = key(gN);
    if (sk === gk) return [];
    const open = [[0, sN]];
    const came = new Map();          // key -> { from: node, via: link|null }
    const g = new Map([[sk, 0]]);
    const h = (n) => Math.hypot(n.ix - gN.ix, n.iz - gN.iz);
    const closed = new Set();
    const nb = [];
    let found = false;
    let guard = 0;
    while (open.length && guard++ < 20000) {
      open.sort((p, q) => p[0] - q[0]);
      const [, n] = open.shift();
      const k = key(n);
      if (closed.has(k)) continue;
      closed.add(k);
      if (k === gk) { found = true; break; }
      for (const [m, cost, via] of this.neighbours(n, walls, nb)) {
        const mk = key(m);
        if (closed.has(mk)) continue;
        const ng = g.get(k) + cost;
        if (ng < (g.get(mk) ?? Infinity)) {
          g.set(mk, ng);
          came.set(mk, { from: n, via: via || null });
          open.push([ng + h(m), m]);
        }
      }
    }
    if (!found) return null;
    const chain = [];
    let k = gk, n = gN;
    while (k !== sk) {
      const c = came.get(k);
      chain.push({ node: n, via: c.via });
      n = c.from; k = key(n);
    }
    chain.reverse();
    const pts = [];
    for (let i = 0; i < chain.length; i++) {
      const { node, via } = chain[i];
      const p = { x: this.minX + node.ix * this.cell, z: this.minZ + node.iz * this.cell };
      if (via) {
        // A ladder: both ends carry their heights so the climb is walked.
        const foot = i > 0 ? chain[i - 1].node : sN;
        const footY = via.a.L === node.L ? via.yb : via.ya;
        const prev = pts[pts.length - 1];
        if (prev) prev.y = footY;
        else pts.push({ x: this.minX + foot.ix * this.cell, z: this.minZ + foot.iz * this.cell, y: footY });
        p.y = via.a.L === node.L ? via.ya : via.yb;
        p.ladder = true;
      }
      pts.push(p);
    }
    // Straighten: drop waypoints on the line between their neighbours,
    // never across a ladder.
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], a = out[out.length - 1], nx = pts[i + 1];
      if (a && nx && p.y == null && a.y == null && nx.y == null &&
          Math.abs((nx.x - a.x) * (p.z - a.z) - (nx.z - a.z) * (p.x - a.x)) < 1e-6) continue;
      out.push(p);
    }
    return out;
  }
}
