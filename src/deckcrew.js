// Who is on deck, and what they are doing.
//
// The captain is the player: always aboard, and at the helm — a hand on the
// skiff's outboard tiller, the seat of the speedboat, the wheel of the big
// hulls — until there is a rod to work. The crew are the other three bodies,
// rotated and dressed differently so no two look alike, each posted to a
// job the hull has: the crane's levers, a console, the net at the stern, a
// lookout on the rail. Every post is measured off the model by hand
// (stations.js), and everyone walks the deck map (deckmap.js) round what is
// in the way.
//
// Rods are worked by whoever is nearest. When a line is cast, the nearest
// free body — captain or hand — goes to that rod, and the lure leaves off
// the whip of their swing, so nothing flies before someone has thrown it.
// When more rods are cast than there are bodies, extra hands come out of
// the cabin (each hull's `door`) until every rod in the water has one, and
// go back in when there is nothing left to do.
//
// None of this touches a bet. The crew here are the picture of the crew the
// fishing code already runs (fishing.js works the rods through the very same
// cast() and pull() the player uses); these bodies only show it happening.

import * as THREE from 'three';
import { Character } from './crew.js';
import { lookFor } from './crewlook.js';

const BODIES = ['bosun', 'engineer', 'deckhand'];
const HALF_PI = Math.PI / 2;
const EXTRA_MAX = 16;            // extra hands a hull can put on deck, at most one per rod
const EXTRA_IDLE_S = 7;          // idle this long and a hired hand goes back in
const CAST_WHIP_S = 0.48;        // into the rod's sweep, when the lure leaves
const GRIP_FWD = 0.22;           // the grip sits this far in front of the chest (body units)
const GRIP_SIDE = 0.10;          // ... and this far to the right of the body's centre
// Where a held rod's butt sits, in the body's own frame: low in front of
// the right hip, so the grip comes up to the chest.
const CARRY = new THREE.Vector3(0.14, 0.80, -0.22);

const WHEEL_MAT = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.6 });
const STAND_MAT = new THREE.MeshStandardMaterial({ color: 0x5c6670, roughness: 0.5, metalness: 0.4 });

/** A ship's wheel on a pedestal, sized to the person who holds it. */
function buildWheel(scale) {
  const g = new THREE.Group();
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.9, 8), STAND_MAT);
  stand.position.y = 0.45;
  g.add(stand);
  const wheel = new THREE.Group();
  wheel.position.set(0, 1.05, 0.05);
  wheel.rotation.x = 0.25;                                  // raked back toward the helmsman
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 6, 20), WHEEL_MAT));
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 5), WHEEL_MAT);
    s.rotation.z = i * Math.PI / 6;
    wheel.add(s);
  }
  g.add(wheel);
  g.userData.wheel = wheel;
  g.scale.setScalar(scale);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class CrewDirector {
  constructor(scene, boat, tender, fishing) {
    this.scene = scene;
    this.boat = boat;
    this.tender = tender;
    this.fishing = fishing;
    this.captain = null;
    this.hands = [];               // [{ post, ch, line, seat, extra, idle }]
    this.st = null;                // stations for this hull
    this.hullId = null;
    this.scale = 1;
    this.spawnAcc = 0;
    this._capSeat = null;
    this._v = new THREE.Vector3();
  }

  /** Re-crew for a hull. Called once the boat has its model and rods. */
  setBoat(spec) {
    const b = this.boat;
    const hb = b.hullBounds || { halfBeam: 1, deckY: 0.5, length: spec.length };
    const L = hb.length;
    const deckY = hb.deckY;
    // Authored stations, or the old guesses for a hull that has none.
    this.st = b.stations || {
      crewScale: 1,
      helm: { x: 0, y: deckY, z: -L * 0.1, f: 0, pose: 'wheel' },
      posts: [{ kind: 'net', x: 0, y: deckY, z: L * 0.34, f: Math.PI, pose: 'net' }],
    };
    this.scale = this.st.crewScale ?? 1;

    // The captain, sized to this boat, boarding at the helm.
    if (!this.captain || this.captain.scale !== this.scale) {
      this.captain?.dispose();
      this.captain = new Character('captain', null, this.scale);
    }
    this.captain.walkSpeed = 3.3 * this.scale;
    this.captain.railH = (this.st.railH ?? 0.98) / this.scale;
    b.hullFrame.add(this.captain.actor);
    this._capSeat = 'boat';
    this.captain.placeAt(this.st.helm.x, this.st.helm.z, this.st.helm.f);
    this.captain.y = this.st.helm.y;

    // A wheel to hold where the model has an open helm and none of its own.
    if (this.prop) { this.prop.parent?.remove(this.prop); this.prop = null; }
    if (this.st.helm.prop === 'wheel') {
      this.prop = buildWheel(this.scale);
      const h = this.st.helm;
      this.prop.position.set(h.x - Math.sin(h.f) * 0.32 * this.scale, h.y, h.z - Math.cos(h.f) * 0.32 * this.scale);
      this.prop.rotation.y = h.f;
      b.hullFrame.add(this.prop);
    }

    // Crew: same faces for the same hull every time.
    for (const h of this.hands) h.ch.dispose();
    this.hands = [];
    const seedBase = [...spec.hullId].reduce((a, c) => a + c.charCodeAt(0), 0);
    (this.st.posts || []).forEach((post, i) => this.addHand(post, seedBase * 7 + i * 13 + 1, false));
    this.hullId = spec.hullId;

    // The tender's own mate: lives in the tender, so it is only seen when
    // the tender is in the water, and works the tender's rods whoever is
    // at its wheel.
    this.mate?.ch.dispose();
    this.mate = null;
    const tm = this.st.tenderMate;
    if (tm && this.tender) {
      const ch = new Character(BODIES[(seedBase + 2) % BODIES.length], lookFor(seedBase * 7 + 41), this.scale);
      ch.walkSpeed = 2.9 * this.scale;
      ch.railH = (tm.railH ?? 0.5) / this.scale;
      ch.placeAt(tm.x, tm.z, tm.f);
      ch.y = tm.y;
      this.mate = { post: tm, ch, line: null };
      this._mateParented = false;
    }
  }

  addHand(post, seed, extra) {
    const body = BODIES[seed % BODIES.length];
    const ch = new Character(body, lookFor(seed), this.scale);
    ch.walkSpeed = 2.9 * this.scale;
    ch.railH = (this.st.railH ?? 0.98) / this.scale;
    ch.placeAt(post.x, post.z, post.f);
    ch.y = post.y ?? this.boat.hullBounds?.deckY ?? 0;
    this.boat.hullFrame.add(ch.actor);
    const h = { post, ch, line: null, seat: 'boat', extra, idle: 0 };
    this.hands.push(h);
    return h;
  }

  /**
   * Where to stand to work rod `i`, and which way to face: outboard, with
   * the grip in front of the chest and a little to the right.
   */
  rodSpot(i, vessel = this.boat) {
    const r = vessel.rods[i];
    if (!r) return null;
    const side = r.side;
    const g = r.gripRest || r.pos;
    const s = this.scale;
    // Facing outboard (-HALF_PI to starboard, +HALF_PI to port): forward is
    // (side, 0, 0), the body's right is (0, 0, side).
    let x = g.x - side * GRIP_FWD * s, z = g.z - side * GRIP_SIDE * s;
    const deckY = r.deckY ?? vessel.hullBounds?.deckY ?? 0;
    const d = vessel.deck;
    let y = deckY;
    if (d) {
      // The spot must be on the deck the rail stands on — not up on the
      // gunwale. Step inboard until it is; the arms make up the reach.
      let ok = false;
      for (let k = 0; k <= 5 && !ok; k++) {
        const xx = x - side * 0.1 * k;
        const h = d.heightAt(xx, z, deckY);
        if (Number.isFinite(h) && Math.abs(h - deckY) < 0.2) { x = xx; y = h; ok = true; }
      }
      if (!ok) {
        const n = d.nearest(x, z, deckY);
        if (n) { x = n.x; z = n.z; y = n.y; }
      }
    }
    return { x, y, z, f: side > 0 ? -HALF_PI : HALF_PI, rod: r };
  }

  pathfinder() {
    const d = this.boat.deck;
    return d ? (ax, az, bx, bz, ay, by) => d.path(ax, az, bx, bz, ay, by) : null;
  }

  /** Deck height under a character: the map, or the station's own floor. */
  deckFn(ch) {
    return (x, z, yHint) => {
      const s = ch.station;
      if (s && s.y != null && (!ch.route || ch.route.length <= 1) && Math.hypot(x - s.x, z - s.z) < 1.4) return s.y;
      return this.boat.deckHeightAt(x, z, yHint);
    };
  }

  /** Send a character to a spot and pose them for it once there. */
  post(ch, spot, state) {
    ch.station = spot;
    if (Math.hypot(ch.pos.x - spot.x, ch.pos.y - spot.z) > 0.12 || (ch.route && ch.route.length)) {
      ch.goTo(spot.x, spot.z, spot.f, this.pathfinder(), spot.y);
    }
    ch.rod = null;
    ch.lookAt = null;
    ch.aimFacing = null;
    ch.seatH = (spot.seatH ?? 0.45) / this.scale;
    ch.setState(ch.arrived ? state : 'idle');
  }

  /** The way a body at (x, z) in a hull frame should turn to face a world point. */
  facingToward(x, z, worldPt, vessel = this.boat) {
    const p = this._v.copy(worldPt);
    vessel.hullFrame.worldToLocal(p);
    return Math.atan2(-(p.x - x), -(p.z - z));
  }

  /** Put a character on a line: walk to its rod and work it. */
  workLine(ch, line, vessel = this.boat) {
    const spot = this.rodSpot(line.rodIndex, vessel);
    if (!spot) return;
    ch.station = null;
    if (Math.hypot(ch.pos.x - spot.x, ch.pos.y - spot.z) > 0.12 || (ch.route && ch.route.length)) {
      ch.goTo(spot.x, spot.z, spot.f, vessel === this.boat ? this.pathfinder() : null, spot.y);
    }
    ch.rod = spot.rod;
    // Within reach: lift the rod out of its holder into the hands, and keep
    // it there as the body turns. The hands chase the grip on the rod, so
    // the two meet in the middle without a snap.
    const near = Math.hypot(ch.pos.x - spot.x, ch.pos.y - spot.z) < 0.9;
    if (near && ch.ready) {
      ch.actor.updateWorldMatrix(true, false);
      const p = this._v.copy(CARRY);
      ch.actor.localToWorld(p);
      vessel.hullFrame.worldToLocal(p);
      spot.rod.hold = spot.rod.hold || new THREE.Vector3();
      spot.rod.hold.copy(p);
      spot.rod.holdFresh = true;
    }
    ch.setState(line.hooked || line.state === 'landing' || line.pendingPull > 0.05 ? 'reel' : 'hold');
    ch.lookAt = line.state === 'pending' ? null : line.bobber.position;
    // Face the work: the throw's own bearing while the cast is owed, the
    // line itself once it is out. The torso turns first, the feet only
    // when it cannot turn far enough (crew.js).
    const p = line.castPending;
    if (p) {
      // A cast yaw is 0 aft, +PI/2 to starboard; a facing is the yaw of -z.
      ch.aimFacing = p.yaw + Math.PI;
    } else if (line.bobber.visible) {
      ch.aimFacing = this.facingToward(ch.pos.x, ch.pos.y, line.bobber.position, vessel);
    } else {
      ch.aimFacing = null;
    }
    // A cast still owed: swing the rod once they are there and turned to
    // throw, and let the lure go off the whip of that swing. While someone
    // is on their way the line waits (fishing.js gives a claimed cast longer).
    if (p) p.claimed = true;
    if (p && p.launchAt == null && spot.rod && ch.aimed && spot.rod.pickup > 0.9 &&
        Math.hypot(ch.pos.x - spot.x, ch.pos.y - spot.z) < 0.5) {
      vessel.castRod(line.rodIndex, p.yaw);
      ch.play('cast', 1.1);
      p.launchAt = p.t + CAST_WHIP_S;
    }
  }

  // --- the gear -------------------------------------------------------------
  //
  // The net and the pots are thrown and hauled by a deckhand, the way the
  // rods are worked: the gear waits on the deck (boat.js, fishing.js) with
  // a hand-point the director fills in each frame while someone is holding
  // it, and goes over off the whip of that person's heave. Nobody free to
  // come, it goes over on its own after a moment.

  /** The hand who does the deck work: the net hand, else whoever is loose. */
  gearHand() {
    const free = (h) => h.seat === 'boat' && !h.extra && h.post.kind !== 'lift';
    return this.hands.find((h) => h.post.kind === 'net' && free(h)) ||
      this.hands.find((h) => free(h) && h.post.kind !== 'lookout') ||
      this.hands.find(free) || null;
  }

  /** A point on the deck near (x, z) a body can stand on, facing `f`. */
  deckSpot(x, z, f, yHint) {
    const d = this.boat.deck;
    let y = yHint;
    if (d) {
      const h = d.heightAt(x, z, yHint);
      if (Number.isFinite(h) && Math.abs(h - yHint) < 0.7) y = h;
      else { const n = d.nearest(x, z, yHint); if (n) { x = n.x; z = n.z; y = n.y; } }
    }
    return { x, y, z, f };
  }

  /** Where to stand at the rail on one side, abreast z, facing outboard. */
  railSpot(side, z, yHint) {
    const b = this.boat.hullBounds || { halfBeam: 1 };
    const s = this.scale;
    let x = side * (b.halfBeam * 0.92 - 0.3 * s);
    const d = this.boat.deck;
    let y = yHint;
    if (d) {
      let ok = false;
      for (let k = 0; k <= 6 && !ok; k++) {
        const xx = x - side * 0.12 * k;
        const h = d.heightAt(xx, z, yHint);
        if (Number.isFinite(h) && Math.abs(h - yHint) < 0.35) { x = xx; y = h; ok = true; }
      }
      if (!ok) { const n = d.nearest(x, z, yHint); if (n) { x = n.x; z = n.z; y = n.y; } }
    }
    return { x, y, z, f: side > 0 ? -HALF_PI : HALF_PI };
  }

  /** Where a body's hands are holding something, into `out` (world). */
  carryPoint(ch, out) {
    ch.actor.updateWorldMatrix(true, false);
    return ch.actor.localToWorld(out.copy(CARRY));
  }

  /** Hand out the net and pot jobs, and take them back when they are done. */
  assignGear(b, f) {
    const a = b.netAnim;
    const netOut = a && (a.phase === 'ready' || a.phase === 'pickup' || a.phase === 'heave');
    const netIn = a && (a.phase === 'gather' || a.phase === 'haulIn' || a.phase === 'setDown');
    const potOut = f.boat === b ? f.pots.find((p) => p.anim && (p.anim.kind === 'ready' || p.anim.kind === 'carried')) : null;
    const potIn = f.boat === b ? f.hauls[0] : null;
    // Jobs whose gear has moved on are over.
    for (const h of this.hands) {
      const j = h.job;
      if (!j) continue;
      const live = (j.kind === 'netOut' && netOut) || (j.kind === 'netIn' && netIn) ||
        (j.kind === 'potOut' && j.pot === potOut) || (j.kind === 'potIn' && f.hauls.includes(j.pot));
      if (!live) h.job = null;
    }
    const taken = (kind, pot) => this.hands.some((h) => h.job && h.job.kind === kind && (!pot || h.job.pot === pot));
    const give = (kind, pot) => {
      if (taken(kind, pot)) return;
      const h = this.gearHand();
      if (h && !h.job) h.job = { kind, pot, played: false };
    };
    if (netOut) give('netOut');
    if (netIn) give('netIn');
    if (potOut) give('potOut', potOut);
    if (potIn) give('potIn', potIn);
    // Pots waiting their turn keep waiting while there is someone to throw them.
    if (f.boat === b && this.gearHand()) {
      for (const p of f.pots) if (p.anim && p.anim.kind === 'ready') p.anim.queued = true;
    }
  }

  /** One frame of a hand's deck job. */
  workJob(h, dt, t) {
    const ch = h.ch, b = this.boat, f = this.fishing, j = h.job;
    let spot;
    if (j.kind === 'netOut' || j.kind === 'netIn') {
      // Beside the bundle on the stern deck, facing aft over the transom.
      const s = b.netSpot;
      spot = this.deckSpot(s.x + 0.45 * this.scale, s.z - 0.2, s.f, s.y);
    } else {
      const r = f.potRail(j.pot);
      spot = this.railSpot(r.side, r.z, r.y);
    }
    ch.station = null;
    ch.rod = null;
    ch.lookAt = null;
    if (Math.hypot(ch.pos.x - spot.x, ch.pos.y - spot.z) > 0.12 || (ch.route && ch.route.length)) {
      ch.goTo(spot.x, spot.z, spot.f, this.pathfinder(), spot.y);
    }
    const near = ch.ready && Math.hypot(ch.pos.x - spot.x, ch.pos.y - spot.z) < 0.5;
    ch.aimFacing = near ? spot.f : null;
    if (!near) { ch.setState('idle'); return; }

    const p = this.carryPoint(ch, this._v);
    if (j.kind === 'netOut') {
      const a = b.netAnim;
      b.hullFrame.worldToLocal(p);
      a.handPos.copy(p); a.handFresh = true;
      // Wind up and throw once it is in the hands and the body is turned.
      if (a.phase === 'heave' && !j.played && ch.aimed) { ch.play('cast', 1.1); j.played = true; }
      else if (a.phase === 'heave' && !j.played) a.t = 0;      // not turned yet: hold the wind-up
      ch.setState('hold');
    } else if (j.kind === 'netIn') {
      const a = b.netAnim;
      b.hullFrame.worldToLocal(p);
      a.handPos = a.handPos || new THREE.Vector3();
      a.handPos.copy(p); a.handFresh = true;
      ch.setState(a.phase === 'gather' || a.phase === 'haulIn' ? 'reel' : 'hold');
    } else if (j.kind === 'potOut') {
      const pot = j.pot, a = pot.anim;
      pot.handPos.copy(p); pot.handFresh = true;
      if (a.kind === 'carried' && !a.thrown && ch.aimed) { ch.play('cast', 1.1); a.thrown = true; }
      ch.setState('hold');
    } else if (j.kind === 'potIn') {
      const pot = j.pot, a = pot.anim;
      pot.handPos.copy(p); pot.handFresh = true;
      ch.setState(a && a.kind === 'haul' ? 'reel' : 'hold');
    }
  }

  /** The helm, in whatever form this hull has. */
  helmCaptain(cap) {
    const h = this.st.helm;
    const b = this.boat;
    this.post(cap, h, h.pose);
    if (h.pose === 'tiller') {
      // The tiller: forward of the outboard's pivot, at the cowl.
      const ob = b.parts.outboards[0];
      if (ob) {
        cap.handWorld.R = cap.handWorld.R || new THREE.Vector3();
        cap.handWorld.R.set(0, -0.08, -0.95).applyMatrix4(ob.node.matrixWorld);
      } else if (cap.arrived) {
        cap.setState('sit');
      }
    }
  }

  update(dt, t, helmIsTender) {
    if (!this.st || !this.captain) return;
    const b = this.boat, f = this.fishing, S = this.st, td = this.tender;
    const cap = this.captain;
    const lift = this.hands.find((h) => h.post.kind === 'lift');
    // A rod nobody asks for this frame goes back to its holder.
    for (const r of b.rods) r.holdFresh = false;
    for (const r of td.rods) r.holdFresh = false;
    try { this.updateBodies(dt, t, helmIsTender, b, f, S, td, cap, lift); }
    finally {
      for (const r of b.rods) if (!r.holdFresh) r.hold = null;
      for (const r of td.rods) if (!r.holdFresh) r.hold = null;
    }
  }

  updateBodies(dt, t, helmIsTender, b, f, S, td, cap, lift) {

    // --- who is where: the tender ---
    const tenderOut = td.deployed && td.hullBounds;
    const seatT = S.tenderSeat || { x: 0.2, y: td.hullBounds?.deckY ?? 0.4, z: (td.hullBounds?.length || 5) * 0.12, f: 0, pose: 'seat', seatH: 0.42 };
    const capSeat = helmIsTender && tenderOut ? 'tender' : 'boat';
    if (this._capSeat !== capSeat) {
      this._capSeat = capSeat;
      (capSeat === 'tender' ? td.hullFrame : b.hullFrame).add(cap.actor);
      if (capSeat === 'tender') { cap.placeAt(seatT.x, seatT.z, seatT.f); cap.y = seatT.y; }
      else { cap.placeAt(S.helm.x, S.helm.z, S.helm.f); cap.y = S.helm.y; }
      cap.route = null;
    }
    if (lift) {
      // The tender's own driver rides out in it whenever the player is not
      // at its helm, and comes back to the lift when it is craned aboard.
      const want = tenderOut && !helmIsTender ? 'tender' : 'boat';
      if (lift.seat !== want) {
        lift.seat = want;
        (want === 'tender' ? td.hullFrame : b.hullFrame).add(lift.ch.actor);
        if (want === 'tender') { lift.ch.placeAt(seatT.x, seatT.z, seatT.f); lift.ch.y = seatT.y; }
        else { lift.ch.placeAt(lift.post.x, lift.post.z, lift.post.f); lift.ch.y = lift.post.y; }
        lift.ch.route = null;
      }
    }

    // --- the rods: whoever is nearest works them ---
    // The lines belong to whichever vessel is fishing: the big boat's crew
    // work them on the big boat, the tender's mate on the tender.
    const onBoat = capSeat === 'boat' && f.boat === b;
    const busy = onBoat ? f.lines.filter((l) => l.busy) : [];
    const workers = [];
    for (const h of this.hands) {
      if (h.seat !== 'boat' || h.post.fixed || h.job) continue;
      workers.push({ ch: h.ch, isCap: false, owner: h });
    }
    // The captain fishes too — unless the boat is under way and there is
    // a hand to do it, in which case the captain keeps the helm and the
    // hand goes to the rod, so a cast never needs the boat to stop.
    const underWay = b.throttle > 0.1 || b.speed > 1.0;
    if (onBoat && !(underWay && workers.length)) workers.push({ ch: cap, isCap: true, owner: null });
    // Sticky: a body stays on its line while the line is busy.
    for (const w of workers) {
      const cur = w.isCap ? this._capLine : w.owner.line;
      w.line = cur && cur.busy && busy.includes(cur) ? cur : null;
    }
    for (const l of busy) {
      if (workers.some((w) => w.line === l)) continue;
      const spot = this.rodSpot(l.rodIndex);
      if (!spot) continue;
      let best = null, bd = Infinity;
      for (const w of workers) {
        if (w.line) continue;
        let d = Math.hypot(w.ch.pos.x - spot.x, w.ch.pos.y - spot.z) + Math.abs(w.ch.y - spot.y) * 2;
        if (w.isCap) d *= 0.8;                 // the captain would rather fish
        if (d < bd) { bd = d; best = w; }
      }
      if (best) best.line = l;
    }
    for (const w of workers) { if (w.isCap) this._capLine = w.line; else w.owner.line = w.line; }

    // More hands out of the cabin while rods go unmanned, on any hull with
    // a cabin to come out of: never a rod worked by nobody.
    const unmanned = busy.filter((l) => !workers.some((w) => w.line === l)).length;
    if (S.door && unmanned > 0) {
      this.spawnAcc += dt;
      const extras = this.hands.filter((h) => h.extra).length;
      if (this.spawnAcc > 0.6 && extras < Math.min(EXTRA_MAX, b.spec.rods)) {
        this.spawnAcc = 0;
        const h = this.addHand({ ...S.door, f: 0, kind: 'extra', pose: 'idle' }, 1000 + extras * 17 + (this.hullId?.length || 0), true);
        h.ch.y = S.door.y;
      }
    } else {
      this.spawnAcc = 0;
    }

    // --- the captain ---
    const capCtx = { steer: b.steerSmooth };
    if (this.prop) this.prop.userData.wheel.rotation.z = -(b.steerSmooth || 0) * 0.7;
    if (capSeat === 'tender') {
      cap.station = seatT;
      cap.seatH = (seatT.seatH ?? 0.42) / this.scale;
      cap.rod = null;
      cap.lookAt = null;
      cap.setState('seat');
      cap.update(dt, t, () => seatT.y, { steer: td.steerDemand || 0 });
    } else {
      if (this._capLine) this.workLine(cap, this._capLine);
      else this.helmCaptain(cap);
      cap.update(dt, t, this.deckFn(cap), capCtx);
    }

    // --- the gear: the net and the pots want a hand each ---
    this.assignGear(b, f);

    // --- the hands ---
    for (let i = this.hands.length - 1; i >= 0; i--) {
      const h = this.hands[i];
      const ch = h.ch;
      let deck = this.deckFn(ch);
      let ctx = { steer: b.steerSmooth };
      if (h.job) {
        h.idle = 0;
        this.workJob(h, dt, t);
      } else if (h.seat === 'tender') {
        ch.station = seatT;
        ch.seatH = (seatT.seatH ?? 0.42) / this.scale;
        ch.rod = null;
        ch.setState('seat');
        ch.lookAt = td.lineFx?.bob?.visible ? td.lineFx.bob.position : null;
        if (td.lineFx && td.lineFx.timer > 2.9) ch.play('wave', 0.9);
        deck = () => seatT.y;
        ctx = { steer: td.steerDemand || 0 };
      } else if (h.line) {
        h.idle = 0;
        this.workLine(ch, h.line);
      } else if (h.extra) {
        // Nothing to do: back to the door, and inside once there.
        h.idle += dt;
        if (h.idle > EXTRA_IDLE_S) {
          this.post(ch, { ...S.door, f: 0 }, 'idle');
          if (ch.arrived) { ch.dispose(); this.hands.splice(i, 1); continue; }
        } else {
          ch.rod = null; ch.lookAt = null; ch.aimFacing = null;
          ch.setState('idle');
        }
      } else {
        const p = h.post;
        let state = p.pose;
        if (p.kind === 'net' && b.trawling) state = 'console';       // hauling the winch
        this.post(ch, p, state);
      }
      ch.update(dt, t, deck, ctx);
    }

    // --- the tender's mate ---
    const m = this.mate;
    if (m && td.hullFrame) {
      if (!this._mateParented) { td.hullFrame.add(m.ch.actor); this._mateParented = true; }
      const ch = m.ch;
      // Nobody rides a boat on the crane: the mate is out of it while it hangs.
      ch.actor.visible = !td.hoisting;
      const mp = m.post;
      const deckM = () => mp.y;
      if (tenderOut && f.boat === td) {
        // The player fishes from the tender: the mate works its rods.
        const tb = f.lines.filter((l) => l.busy);
        if (!(m.line && m.line.busy && tb.includes(m.line))) m.line = tb[0] || null;
        if (m.line) this.workLine(ch, m.line, td);
        else this.post(ch, mp, mp.pose);
      } else if (tenderOut && td.state === 'auto') {
        // Out on its own: the mate has the rod, the driver drives.
        m.line = null;
        const r = td.rods[0];
        const spot = this.rodSpot(0, td);
        if (spot) {
          ch.station = null;
          if (Math.hypot(ch.pos.x - spot.x, ch.pos.y - spot.z) > 0.12 || (ch.route && ch.route.length)) ch.goTo(spot.x, spot.z, spot.f, null, spot.y);
          ch.rod = r;
          ch.actor.updateWorldMatrix(true, false);
          const p = this._v.copy(CARRY); ch.actor.localToWorld(p); td.hullFrame.worldToLocal(p);
          r.hold = r.hold || new THREE.Vector3(); r.hold.copy(p); r.holdFresh = true;
          const fx = td.lineFx;
          ch.lookAt = fx.bob.visible ? fx.bob.position : null;
          ch.aimFacing = fx.bob.visible ? this.facingToward(ch.pos.x, ch.pos.y, fx.bob.position, td) : null;
          ch.setState(fx.bob.visible && fx.timer < 0.5 ? 'reel' : 'hold');
          if (fx.timer > 1.05) { td.castRod(0, ch.aimFacing != null ? ch.aimFacing - Math.PI : 0); ch.play('cast', 1.1); }
        }
      } else {
        m.line = null;
        this.post(ch, mp, mp.pose);
      }
      ch.update(dt, t, deckM, { steer: td.steerDemand || 0 });
    }
  }
}
