// How a hull answers the helm. Shared by the player's boat and the seiner's
// tender so both handle by the same rules.
//
// The boat goes where you point, at once: the stick drives the velocity, the
// same arcade feel the game has always had. What the hull's size changes is
// how fast the HEADING can follow that velocity. The chase is an exponential
// ease — smooth, no corner when it arrives — with a hard ceiling on how many
// radians a second the hull may actually swing:
//
//     rate = min(error * turn, yawRate)
//
// Small corrections are the old soft ease; a big one runs into the ceiling,
// and the ceiling is what a 26m steamboat cannot argue with. So the skiff
// still flicks round inside its own length and the steamboat sweeps through a
// long turn, while both answer the stick the instant you move it.
//
// An earlier pass tried steering the hull and pushing only along the bow.
// That made the size read correctly but the boat stopped answering the stick
// — you had to wait for the bow before anything happened — so it is gone,
// along with the keel-grip term that went with it.

const TWO_PI = Math.PI * 2;

/** Shortest signed angle to `a`, in (-PI, PI]. */
export function wrapAngle(a) {
  while (a > Math.PI) a -= TWO_PI;
  while (a < -Math.PI) a += TWO_PI;
  return a;
}

// Below this the hull is drifting, not running, and holds the heading it has
// rather than snapping about to follow a dying velocity vector.
const WAY_ON = 0.25;
// The heading error at which the helm counts as hard over, for the gear that
// answers the wheel rather than the rate of turn.
const HARD_OVER = 0.85;

/**
 * A hull as a capsule for keeping boats apart: a segment down the
 * centreline, from bow to stern less the beam, with the half-beam as its
 * radius. `o` needs { pos, heading, hullBounds }.
 */
function capsule(o) {
  const b = o.hullBounds || { halfBeam: 1, length: 5 };
  const r = b.halfBeam;
  const half = Math.max(0, b.length / 2 - r);
  const ax = -Math.sin(o.heading), az = -Math.cos(o.heading);      // toward the bow
  return { x: o.pos.x, z: o.pos.z, ax, az, half, r };
}

/** Closest points of two segments in the plane: returns [t1, t2] in [-half, half]. */
function closest(c1, c2) {
  const dx = c2.x - c1.x, dz = c2.z - c1.z;
  const d1 = c1.ax * c2.ax + c1.az * c2.az;
  const s1 = c1.ax * dx + c1.az * dz, s2 = c2.ax * dx + c2.az * dz;
  const den = 1 - d1 * d1;
  let t1 = den > 1e-4 ? (s1 - d1 * s2) / den : 0;
  t1 = Math.max(-c1.half, Math.min(c1.half, t1));
  let t2 = d1 * t1 - s2;
  t2 = Math.max(-c2.half, Math.min(c2.half, t2));
  t1 = Math.max(-c1.half, Math.min(c1.half, d1 * t2 + s1));
  return [t1, t2];
}

/**
 * Keep two hulls out of each other. Whoever is lighter gives way more (a
 * 5m tender against a 19m seiner mostly moves itself), the closing
 * component of their velocities is killed so they do not grind, and a
 * little of each other's way is passed on so a nudge reads as a nudge.
 * Returns the overlap resolved, 0 when they were clear.
 */
export function separateHulls(a, b, margin = 0.6) {
  const ca = capsule(a), cb = capsule(b);
  const [ta, tb] = closest(ca, cb);
  const px = ca.x + ca.ax * ta, pz = ca.z + ca.az * ta;
  const qx = cb.x + cb.ax * tb, qz = cb.z + cb.az * tb;
  let nx = qx - px, nz = qz - pz;
  const d = Math.hypot(nx, nz);
  const want = ca.r + cb.r + margin;
  if (d >= want) return 0;
  if (d < 1e-4) { nx = -Math.cos(a.heading); nz = Math.sin(a.heading); } else { nx /= d; nz /= d; }
  const overlap = want - d;
  const ma = (a.hullBounds?.length ?? 5) ** 2, mb = (b.hullBounds?.length ?? 5) ** 2;
  const wa = mb / (ma + mb), wb = ma / (ma + mb);
  a.pos.x -= nx * overlap * wa; a.pos.z -= nz * overlap * wa;
  b.pos.x += nx * overlap * wb; b.pos.z += nz * overlap * wb;
  // Relative velocity along the normal: if closing, stop it (with a touch
  // of restitution) and share it out by mass.
  const rv = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
  if (rv < 0) {
    const j = -rv * 1.15;
    a.vel.x -= nx * j * wa; a.vel.z -= nz * j * wa;
    b.vel.x += nx * j * wb; b.vel.z += nz * j * wb;
  }
  return overlap;
}

/**
 * A steering correction to keep `o` clear of `other` while it drives toward
 * `want` (a unit-ish stick vector): when the course ahead would pass within
 * `clear` of the other hull, the stick is bent away from it, harder the
 * closer it gets. Returns the corrected {x, z}.
 */
export function steerClear(o, other, want, clear) {
  const co = capsule(o), ct = capsule(other);
  // Where the hull will be a few seconds on, and the nearest point on the
  // other hull to that spot.
  const look = 3.0;
  const fx = co.x + o.vel.x * look, fz = co.z + o.vel.z * look;
  const rel = (fx - ct.x) * ct.ax + (fz - ct.z) * ct.az;
  const t = Math.max(-ct.half, Math.min(ct.half, rel));
  const px = ct.x + ct.ax * t, pz = ct.z + ct.az * t;
  let nx = fx - px, nz = fz - pz;
  const d = Math.hypot(nx, nz) || 1e-4;
  nx /= d; nz /= d;
  const gap = d - ct.r - co.r;
  if (gap > clear) return want;
  // Bend the stick away, and when very close push straight out.
  const k = Math.min(1, 1 - gap / clear);
  const mag = Math.hypot(want.x, want.z);
  let x = want.x + nx * k * Math.max(0.6, mag) * 1.4;
  let z = want.z + nz * k * Math.max(0.6, mag) * 1.4;
  const m = Math.hypot(x, z);
  if (m > 1) { x /= m; z /= m; }
  return { x, z };
}

/**
 * Where a hull meets the water, as points in the plane: down the centreline
 * from stem to transom and along both sides, the sides drawn in a little and
 * the bow tapered, so the shore stops the whole hull and not just the point
 * it is steered from. Every point must float for the hull to count as clear.
 * Written into `out` (reused); returns how many points were written.
 */
const STATIONS = [-1, -0.65, -0.3, 0.05, 0.4, 0.7, 0.9, 1];
function footprint(o, x, z, heading, out) {
  const b = o.hullBounds || { halfBeam: 1, length: 5 };
  const half = b.length / 2, beam = b.halfBeam * 0.85;
  const fx = -Math.sin(heading), fz = -Math.cos(heading);      // toward the bow
  const rx = Math.cos(heading), rz = -Math.sin(heading);       // to starboard
  let n = 0;
  for (const s of STATIONS) {
    const cx = x + fx * half * s, cz = z + fz * half * s;
    out[n++] = cx; out[n++] = cz;
    // The waterline narrows over the forward third to a stem.
    const w = beam * (s > 0.4 ? Math.max(0.12, 1 - (s - 0.4) / 0.6 * 0.95) : 1);
    if (w < 0.2) continue;
    out[n++] = cx + rx * w; out[n++] = cz + rz * w;
    out[n++] = cx - rx * w; out[n++] = cz - rz * w;
  }
  return n / 2;
}

const _fp = new Float64Array(STATIONS.length * 6);

/** How many of the hull's footprint points would NOT float at this pose. */
export function aground(o, x, z, heading, navigable) {
  const n = footprint(o, x, z, heading, _fp);
  let bad = 0;
  for (let i = 0; i < n; i++) if (!navigable(_fp[i * 2], _fp[i * 2 + 1])) bad++;
  return bad;
}

const _n = [0, 0];
/**
 * Which way the water lies from the part of the hull that would ground at
 * this pose: a unit vector, into `out`. Taken from the mean of the grounded
 * footprint points, by which of a ring of probes round it still float; if
 * none do, back toward the hull's own centre.
 */
function shoreNormal(o, x, z, heading, navigable, out) {
  const n = footprint(o, x, z, heading, _fp);
  let gx = 0, gz = 0, k = 0;
  for (let i = 0; i < n; i++) {
    if (navigable(_fp[i * 2], _fp[i * 2 + 1])) continue;
    gx += _fp[i * 2]; gz += _fp[i * 2 + 1]; k++;
  }
  if (!k) { gx = x; gz = z; } else { gx /= k; gz /= k; }
  const R = Math.max(1.5, (o.hullBounds?.halfBeam ?? 1) * 1.2);
  let sx = 0, sz = 0;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TWO_PI, dx = Math.cos(a), dz = Math.sin(a);
    if (navigable(gx + dx * R, gz + dz * R)) { sx += dx; sz += dz; }
  }
  let d = Math.hypot(sx, sz);
  if (d < 1e-3) { sx = x - gx; sz = z - gz; d = Math.hypot(sx, sz); }
  if (d < 1e-3) { sx = Math.sin(heading); sz = Math.cos(heading); d = 1; }
  out[0] = sx / d; out[1] = sz / d;
  return out;
}

/**
 * A hull with part of its footprint on the bank is eased back toward the
 * water: it drifts away from the mean of its grounded points, a little a
 * frame, as long as each step leaves fewer points aground.
 */
function nudgeOff(o, navigable, dt, here) {
  const n = footprint(o, o.pos.x, o.pos.z, o.heading, _fp);
  let gx = 0, gz = 0, k = 0;
  for (let i = 0; i < n; i++) {
    if (navigable(_fp[i * 2], _fp[i * 2 + 1])) continue;
    gx += _fp[i * 2]; gz += _fp[i * 2 + 1]; k++;
  }
  if (!k) return;
  let dx = o.pos.x - gx / k, dz = o.pos.z - gz / k;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) { dx = Math.sin(o.heading); dz = Math.cos(o.heading); } else { dx /= d; dz /= d; }
  const step = 0.6 * dt;
  const nx = o.pos.x + dx * step, nz = o.pos.z + dz * step;
  if (aground(o, nx, nz, o.heading, navigable) <= here) { o.pos.x = nx; o.pos.z = nz; }
}

/**
 * Ceiling on how fast a hull may swing, in radians per second. `turn` is the
 * agility rating from the catalog; length is what drags it down, so the same
 * rating buys far less on a long hull than on a short one.
 */
export function hullYawRate(turn, length) {
  return turn / (1 + length / 12);
}

/**
 * Drive one hull for a frame. `o` needs { pos, vel, heading, speed } and is
 * mutated in place; `input` is the stick in world space (x, z).
 * `navigable(x, z)` decides what the hull may float over.
 */
export function driveHull(o, spec, dt, input, navigable) {
  const mag = Math.min(1, Math.hypot(input.x, input.z));
  const maxSpeed = spec.maxSpeed * (o.trawling ? 0.55 : 1);

  if (mag > 0.05) {
    o.vel.x += (input.x / mag) * mag * spec.accel * dt;
    o.vel.z += (input.z / mag) * mag * spec.accel * dt;
  }
  const drag = Math.exp(-spec.drag * dt);
  o.vel.x *= drag; o.vel.z *= drag;
  const sp = Math.hypot(o.vel.x, o.vel.z);
  if (sp > maxSpeed) { o.vel.x *= maxSpeed / sp; o.vel.z *= maxSpeed / sp; }
  o.speed = Math.min(sp, maxSpeed);

  // The shore stops the whole hull, not just the point it is steered from:
  // a move or a swing is allowed only if it leaves no more of the footprint
  // aground than there is now. (Never fewer than now, so a hull that has
  // somehow been put on the bank — a shove from another hull, say — can
  // always work its way off again, and only off.)
  const here = aground(o, o.pos.x, o.pos.z, o.heading, navigable);
  let mx = o.vel.x * dt, mz = o.vel.z * dt;
  if (aground(o, o.pos.x + mx, o.pos.z + mz, o.heading, navigable) <= here) {
    o.pos.x += mx; o.pos.z += mz;
  } else {
    // Into the bank. Find which way the water lies from the points that
    // would ground, strip that part of the move, and slide along the shore
    // with the rest — the hull scrapes along, it does not stick.
    const n = shoreNormal(o, o.pos.x + mx, o.pos.z + mz, o.heading, navigable, _n);
    const into = -(mx * n[0] + mz * n[1]);
    if (into > 0) { mx += n[0] * into; mz += n[1] * into; }
    if ((mx !== 0 || mz !== 0) && aground(o, o.pos.x + mx, o.pos.z + mz, o.heading, navigable) <= here) {
      o.pos.x += mx; o.pos.z += mz;
      const vin = -(o.vel.x * n[0] + o.vel.z * n[1]);
      if (vin > 0) { o.vel.x += n[0] * vin * 1.15; o.vel.z += n[1] * vin * 1.15; }
    } else {
      // No slide either: try each axis on its own, and bounce off the rest.
      const nx = o.pos.x + o.vel.x * dt, nz = o.pos.z + o.vel.z * dt;
      if (aground(o, nx, o.pos.z, o.heading, navigable) <= here) o.pos.x = nx; else o.vel.x *= -0.15;
      if (aground(o, o.pos.x, nz, o.heading, navigable) <= here) o.pos.z = nz; else o.vel.z *= -0.15;
    }
  }
  if (here > 0) nudgeOff(o, navigable, dt, here);

  // The hull swings to line up with where it is actually going — eased, and
  // capped at what a boat that size could manage.
  if (o.speed > WAY_ON || mag > 0.05) {
    const want = o.speed > WAY_ON
      ? Math.atan2(-o.vel.x, -o.vel.z)
      : Math.atan2(-input.x, -input.z);
    const d = wrapAngle(want - o.heading);
    const rate = Math.min(Math.abs(d) * spec.turn, spec.yawRate);
    const step = Math.min(Math.abs(d), rate * dt);
    // The bow (or the stern) may not swing up onto the bank either: try
    // the full swing, then half of it, else hold the heading this frame.
    const now = aground(o, o.pos.x, o.pos.z, o.heading, navigable);
    for (const k of [1, 0.5]) {
      const h = wrapAngle(o.heading + Math.sign(d) * step * k);
      if (aground(o, o.pos.x, o.pos.z, h, navigable) <= now) { o.heading = h; break; }
    }
    // How far off the bow the boat is actually trying to go: the helm demand,
    // which is what a rudder or an outboard leg answers. It is not the same
    // as the rate of turn — a big hull can be hard over and barely swinging.
    o.steerDemand = Math.max(-1, Math.min(1, d / HARD_OVER));
  } else {
    o.steerDemand = 0;
  }
}
