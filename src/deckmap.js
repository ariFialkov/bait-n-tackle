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

/** A binary min-heap of (priority, node) for the path search. */
class OpenHeap {
  constructor() { this.p = []; this.n = []; }
  get size() { return this.p.length; }
  push(pri, node) {
    const p = this.p, n = this.n;
    let i = p.length; p.push(pri); n.push(node);
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (p[j] <= p[i]) break;
      [p[i], p[j]] = [p[j], p[i]]; [n[i], n[j]] = [n[j], n[i]]; i = j;
    }
  }
  pop() {
    const p = this.p, n = this.n;
    const top = n[0];
    const lp = p.pop(), ln = n.pop();
    if (p.length) {
      p[0] = lp; n[0] = ln;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < p.length && p[l] < p[m]) m = l;
        if (r < p.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [p[i], p[m]] = [p[m], p[i]]; [n[i], n[m]] = [n[m], n[i]]; i = m;
      }
    }
    return top;
  }
}

/**
 * A hull's triangles in the hull's frame, binned by the deck-map cells
 * their footprint covers. Answers the two questions the deck map asks: the
 * heights of every surface over a point, and whether a short horizontal
 * segment meets anything. Both faces of every triangle count.
 */
class TriGrid {
  constructor(hull, minX, minZ, cell, nx, nz) {
    this.minX = minX; this.minZ = minZ; this.cell = cell; this.nx = nx; this.nz = nz;
    const v = new THREE.Vector3();
    const tri = [];
    hull.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry, p = g.attributes.position, idx = g.index, m = o.matrixWorld;
      if (!p) return;
      const n = idx ? idx.count : p.count;
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(m);
        tri.push(v.x, v.y, v.z);
      }
    });
    this.t = Float32Array.from(tri);
    const T = this.t, count = T.length / 9;
    this.bins = new Array(nx * nz);
    for (let i = 0; i < this.bins.length; i++) this.bins[i] = [];
    for (let k = 0; k < count; k++) {
      const o = k * 9;
      const x0 = Math.min(T[o], T[o + 3], T[o + 6]), x1 = Math.max(T[o], T[o + 3], T[o + 6]);
      const z0 = Math.min(T[o + 2], T[o + 5], T[o + 8]), z1 = Math.max(T[o + 2], T[o + 5], T[o + 8]);
      const i0 = Math.max(0, Math.floor((x0 - minX) / cell)), i1 = Math.min(nx - 1, Math.ceil((x1 - minX) / cell));
      const j0 = Math.max(0, Math.floor((z0 - minZ) / cell)), j1 = Math.min(nz - 1, Math.ceil((z1 - minZ) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.bins[j * nx + i].push(k);
    }
  }

  /** The heights of every triangle over (x, z), highest first, into `out`. */
  heightsAt(x, z, ix, iz, out) {
    out.length = 0;
    const T = this.t;
    for (const k of this.bins[iz * this.nx + ix]) {
      const o = k * 9;
      const ax = T[o], ay = T[o + 1], az = T[o + 2], bx = T[o + 3], by = T[o + 4], bz = T[o + 5], cx = T[o + 6], cy = T[o + 7], cz = T[o + 8];
      // Barycentric, in the x/z plane.
      const d = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((x - ax) * (cz - az) - (cx - ax) * (z - az)) / d;
      const w = ((bx - ax) * (z - az) - (x - ax) * (bz - az)) / d;
      if (u < -1e-6 || w < -1e-6 || u + w > 1 + 1e-6) continue;
      out.push(ay + (by - ay) * u + (cy - ay) * w);
    }
    out.sort((a, b) => b - a);
  }

  /** Does the segment from (x, y, z) along (dx, 0, dz) for `len` meet a triangle? (Moller-Trumbore) */
  blocked(x, y, z, dx, dz, len, ix, iz) {
    const T = this.t;
    const jx = Math.min(this.nx - 1, Math.max(0, ix + dx)), jz = Math.min(this.nz - 1, Math.max(0, iz + dz));
    for (const bin of [this.bins[iz * this.nx + ix], this.bins[jz * this.nx + jx]]) {
      for (const k of bin) {
        const o = k * 9;
        const ax = T[o], ay = T[o + 1], az = T[o + 2];
        const e1x = T[o + 3] - ax, e1y = T[o + 4] - ay, e1z = T[o + 5] - az;
        const e2x = T[o + 6] - ax, e2y = T[o + 7] - ay, e2z = T[o + 8] - az;
        // p = dir x e2, with dir = (dx, 0, dz)
        const px = -dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-9) continue;
        const inv = 1 / det;
        const tx = x - ax, ty = y - ay, tz = z - az;
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        // q = t x e1
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t >= 0 && t <= len) return true;
      }
    }
    return false;
  }
}

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

    // The hull's triangles, binned by the cells they stand over, so a cell
    // asks only the few dozen over it and not all fourteen thousand. (Cast
    // as rays against the whole model, the scan of a big hull ran to ten
    // seconds; it is a few tens of milliseconds this way.) Both faces of
    // every triangle count: some decks are modelled with their faces down.
    hull.updateWorldMatrix(true, true);
    const grid = new TriGrid(hull, this.minX, this.minZ, CELL, this.nx, this.nz);
    const ys = [];
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        // A hair off the cell's centre: low-poly decks have edges that line
        // up with a round-number grid, and a ray down an edge finds nothing.
        grid.heightsAt(this.minX + ix * CELL + CELL * 0.037, this.minZ + iz * CELL + CELL * 0.043, ix, iz, ys);   // highest first
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

    // A cell at the very edge with open water beside it is the gunwale,
    // not somewhere to put a foot: keep the walkable area one cell in.
    const over = (ix, iz) => !this.inside(ix, iz) || !this.solid[iz * this.nx + ix];
    for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) {
      if (over(ix - 1, iz) || over(ix + 1, iz)) for (const L of this.layers[iz * this.nx + ix]) L.walk = false;
    }

    // Walls: a ray at body height from each floor to each of its four
    // neighbours. Anything in the way closes that edge.
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) {
      for (const L of this.layers[iz * this.nx + ix]) {
        if (!L.walk) continue;
        for (let d = 0; d < 4; d++) {
          const [dx, dz] = dirs[d];
          const M = this.layerNear(ix + dx, iz + dz, L.y, join);
          if (!M || !M.walk) continue;
          // Two rays, at the knee and the chest: a wall with a window in it
          // is still a wall, and a low bulwark still stops a foot.
          const px = this.minX + ix * CELL + CELL * 0.037, pz = this.minZ + iz * CELL + CELL * 0.043;
          for (const k of [0.22, 0.6]) {
            if (grid.blocked(px, L.y + headroom * k, pz, dx, dz, CELL, ix, iz)) { L.wall |= (1 << d); break; }
          }
        }
      }
    }

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
    // Numeric keys and a binary heap: this runs whenever a hand is sent
    // somewhere, and sorting the open list every step cost a frame 9 ms on
    // a big deck.
    const key = (n) => (n.ix * 4096 + n.iz) * 4096 + (Math.round(n.L.y * 50) + 2048);
    const sk = key(sN), gk = key(gN);
    if (sk === gk) return [];
    const heap = new OpenHeap();
    heap.push(0, sN);
    const came = new Map();          // key -> { from: node, via: link|null }
    const g = new Map([[sk, 0]]);
    const h = (n) => Math.hypot(n.ix - gN.ix, n.iz - gN.iz);
    const closed = new Set();
    const nb = [];
    let found = false;
    let guard = 0;
    while (heap.size && guard++ < 20000) {
      const n = heap.pop();
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
          heap.push(ng + h(m), m);
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
