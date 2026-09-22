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

  const nx = o.pos.x + o.vel.x * dt;
  const nz = o.pos.z + o.vel.z * dt;
  if (navigable(nx, o.pos.z)) o.pos.x = nx; else o.vel.x *= -0.15;
  if (navigable(o.pos.x, nz)) o.pos.z = nz; else o.vel.z *= -0.15;

  // The hull swings to line up with where it is actually going — eased, and
  // capped at what a boat that size could manage.
  if (o.speed > WAY_ON || mag > 0.05) {
    const want = o.speed > WAY_ON
      ? Math.atan2(-o.vel.x, -o.vel.z)
      : Math.atan2(-input.x, -input.z);
    const d = wrapAngle(want - o.heading);
    const rate = Math.min(Math.abs(d) * spec.turn, spec.yawRate);
    const step = Math.min(Math.abs(d), rate * dt);
    o.heading = wrapAngle(o.heading + Math.sign(d) * step);
    // How far off the bow the boat is actually trying to go: the helm demand,
    // which is what a rudder or an outboard leg answers. It is not the same
    // as the rate of turn — a big hull can be hard over and barely swinging.
    o.steerDemand = Math.max(-1, Math.min(1, d / HARD_OVER));
  } else {
    o.steerDemand = 0;
  }
}
