// How a hull answers the helm. Shared by the player's boat and the seiner's
// tender so both handle by the same rules.
//
// A boat is STEERED, not shoved. The stick points the wheel; the bow comes
// round at the hull's own yaw rate; thrust always pushes along the bow. That
// is the whole reason a 26m steamboat feels like one — it has to come round
// before it goes anywhere, while a skiff pivots inside its own length.
//
// It used to work the other way about: the stick drove the velocity vector
// directly and the hull merely chased it. Every boat could therefore change
// direction instantly no matter how big it was, and the size only showed in
// how fast the model span round afterwards — which is exactly the thing that
// looked wrong on the paddleboat and the steamboat.

const TWO_PI = Math.PI * 2;

/** Shortest signed angle to `a`, in (-PI, PI]. */
export function wrapAngle(a) {
  while (a > Math.PI) a -= TWO_PI;
  while (a < -Math.PI) a += TWO_PI;
  return a;
}

// A rudder only bites water that is moving past it. Dead in the water a hull
// still swings on prop wash alone, but slowly; it steers fully once it is up
// to about a third of its top speed.
const STEER_STILL = 0.55;
const STEER_FULL = 0.35;
// Pushing across the bow gives the screw almost nothing to work with, so the
// boat coasts and turns rather than crabbing sideways.
const THRUST_ACROSS = 0.2;

/**
 * Yaw rate, in radians per second. `turn` is the hull's agility from the
 * catalog; length is what drags it down, so the same agility rating buys far
 * less on a long hull than on a short one.
 */
export function hullYawRate(turn, length) {
  return turn / (1 + length / 12);
}

/**
 * How hard a hull resists sliding sideways, per second. A long keel tracks
 * like a train; a flat little skiff skates. This is what makes a big boat's
 * turn a long carve instead of a drift.
 */
export function hullKeelGrip(length) {
  return 1.2 + length * 0.18;
}

/**
 * Drive one hull for a frame. `o` needs { pos, vel, heading, speed } and is
 * mutated in place; `input` is the stick in world space (x, z).
 * `navigable(x, z)` decides what the hull may float over.
 */
export function driveHull(o, spec, dt, input, navigable) {
  const mag = Math.min(1, Math.hypot(input.x, input.z));
  const maxSpeed = spec.maxSpeed * (o.trawling ? 0.55 : 1);

  // --- steering ---
  if (mag > 0.05) {
    const want = Math.atan2(-input.x, -input.z);
    const bite = Math.min(1, STEER_STILL +
      (1 - STEER_STILL) * (o.speed / (maxSpeed * STEER_FULL)));
    const step = spec.yawRate * bite * dt;
    const d = wrapAngle(want - o.heading);
    o.heading = wrapAngle(o.heading + Math.max(-step, Math.min(step, d)));
  }

  // Bow direction. Heading 0 points down -z, which is the convention the rod
  // mounts, the trawl gear and the wake all read.
  const fx = -Math.sin(o.heading), fz = -Math.cos(o.heading);

  // --- thrust, always along the bow ---
  if (mag > 0.05) {
    const align = (input.x / mag) * fx + (input.z / mag) * fz;   // 1 = dead ahead
    const throttle = mag * Math.max(0, THRUST_ACROSS + (1 - THRUST_ACROSS) * align);
    o.vel.x += fx * spec.accel * throttle * dt;
    o.vel.z += fz * spec.accel * throttle * dt;
  }

  const drag = Math.exp(-spec.drag * dt);
  o.vel.x *= drag; o.vel.z *= drag;

  // --- keel grip: bleed off whatever is sliding across the bow ---
  const slip = o.vel.x * -fz + o.vel.z * fx;
  const bleed = 1 - Math.exp(-spec.keelGrip * dt);
  o.vel.x += slip * bleed * fz;
  o.vel.z -= slip * bleed * fx;

  const sp = Math.hypot(o.vel.x, o.vel.z);
  if (sp > maxSpeed) { o.vel.x *= maxSpeed / sp; o.vel.z *= maxSpeed / sp; }
  o.speed = Math.min(sp, maxSpeed);

  const nx = o.pos.x + o.vel.x * dt;
  const nz = o.pos.z + o.vel.z * dt;
  if (navigable(nx, o.pos.z)) o.pos.x = nx; else o.vel.x *= -0.15;
  if (navigable(o.pos.x, nz)) o.pos.z = nz; else o.vel.z *= -0.15;
}
