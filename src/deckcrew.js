// Who is on deck, and what they are doing.
//
// The captain is the player: always aboard, and running to whichever rod
// the player is working — cast, and the captain goes to that rod and makes
// the cast; crank, and the captain is there cranking. Nothing to fish, and
// the captain takes the wheel, or stands forward directing if there is a
// helmsman to take it.
//
// The crew are the other three bodies, rotated and dressed differently so
// no two look alike, and posted by what the hull carries: a helmsman on the
// bigger boats, a hand at the sonar console, a hand at the stern for the
// net, a tender captain on the seiner who goes out in the tender, and a
// fishing crew on the steamboat who work the rods when the crew is hired.
//
// None of this touches a bet. The crew here are the picture of the crew the
// fishing code already runs (fishing.js works the rods through the very same
// cast() and pull() the player uses); these bodies only show it happening.

import * as THREE from 'three';
import { Character } from './crew.js';
import { lookFor } from './crewlook.js';

// Posts per hull. `fisher` hands only work rods while the crew is hired.
const ROLES = {
  skiff: [], speedboat: [], cuddy: [],
  trawler: ['deck'],
  'mud-dredger': ['sonar', 'deck'],
  gillnetter: ['sonar', 'deck'],
  paddleboat: ['helm', 'sonar', 'deck'],
  seiner: ['helm', 'sonar', 'tender'],
  steamboat: ['helm', 'sonar', 'fisher', 'fisher', 'fisher'],
};
const BODIES = ['bosun', 'engineer', 'deckhand'];

const HALF_PI = Math.PI / 2;

export class CrewDirector {
  constructor(scene, boat, tender, fishing) {
    this.scene = scene;
    this.boat = boat;
    this.tender = tender;
    this.fishing = fishing;
    this.captain = new Character('captain', null);
    this.captain.walkSpeed = 2.2;
    this.hands = [];               // [{ role, ch, line, spot }]
    this.stations = null;
    this.directTimer = 3;
    this.hullId = null;
    this._v = new THREE.Vector3();
    boat.group.add(this.captain.actor);
  }

  /** Re-crew for a hull. Called once the boat has its model and rods. */
  setBoat(spec) {
    const b = this.boat;
    const hb = b.hullBounds || { halfBeam: 1, deckY: 0.5, length: spec.length };
    const L = hb.length, W = hb.halfBeam;
    const small = spec.rods <= 1;
    // Where things are on this deck, in the boat's frame.
    this.stations = {
      helm: small ? { x: 0.22, z: L * 0.22, f: 0 } : { x: 0, z: -L * 0.10, f: 0 },
      command: { x: -W * 0.35, z: -L * 0.02, f: 0 },
      sonar: { x: W * 0.42, z: -L * 0.04, f: HALF_PI },
      stern: { x: 0, z: L * 0.34, f: Math.PI },
      crane: { x: -W * 0.3, z: L * 0.22, f: Math.PI },
      rail: [],
    };
    // Spare places along the rails for hands with nothing to do.
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? -1 : 1;
      this.stations.rail.push({ x: side * (W * 0.92 - 0.5), z: -L * 0.3 + (i >> 1) * L * 0.22, f: side > 0 ? -HALF_PI : HALF_PI });
    }

    // The captain boards at the helm.
    if (this.hullId !== spec.hullId) {
      const h = this.stations.helm;
      this.captain.placeAt(h.x, h.z, h.f);
    }

    // Crew: same faces for the same hull every time.
    for (const h of this.hands) h.ch.dispose();
    this.hands = [];
    const roles = ROLES[spec.hullId] || [];
    const seedBase = [...spec.hullId].reduce((a, c) => a + c.charCodeAt(0), 0);
    roles.forEach((role, i) => {
      const body = BODIES[(seedBase + i) % BODIES.length];
      const ch = new Character(body, lookFor(seedBase * 7 + i * 13 + 1));
      const spot = this.postFor(role, i);
      ch.placeAt(spot.x, spot.z, spot.f);
      b.group.add(ch.actor);
      this.hands.push({ role, ch, line: null, spot, seat: 'boat' });
    });
    this.hullId = spec.hullId;
  }

  /** The default post for a role. */
  postFor(role, i) {
    const S = this.stations;
    switch (role) {
      case 'helm': return S.helm;
      case 'sonar': return S.sonar;
      case 'deck': return S.stern;
      case 'tender': return S.crane;
      default: return S.rail[i % S.rail.length];
    }
  }

  /** Where to stand to work rod `i`, and which way to face. */
  rodSpot(i) {
    const r = this.boat.rods[i];
    if (!r) return this.stations.helm;
    const side = r.side;
    return { x: r.pos.x - side * 0.26, z: r.pos.z + 0.04, f: side > 0 ? -HALF_PI : HALF_PI, rod: r };
  }

  /** Move a character between the mother ship and the tender. */
  seat(h, where) {
    if (h.seat === where) return;
    h.seat = where;
    const group = where === 'tender' ? this.tender.group : this.boat.group;
    group.add(h.ch.actor);
    if (where === 'tender') {
      const L = this.tender.hullBounds?.length || 5;
      h.ch.placeAt(0.18, L * 0.12, 0);
      h.ch.setState('sit');
    } else {
      const s = this.postFor(h.role, 0);
      h.ch.placeAt(s.x, s.z, s.f);
    }
  }

  /** The line most worth a body: what is being worked, else the busiest. */
  lineToWork() {
    const f = this.fishing;
    const w = f.work;
    if (w && w.line.busy && f.lines.includes(w.line)) return w.line;
    const score = (l) => (l.state === 'landing' ? 4 : l.hooked ? 3 : l.biting ? 2 : l.busy ? 1 : 0);
    let best = null, bs = 0;
    for (const l of f.lines) { const s = score(l); if (s > bs) { bs = s; best = l; } }
    return best;
  }

  /** Put a character on a line: walk to its rod and work it. */
  workLine(ch, line) {
    const spot = this.rodSpot(line.rodIndex);
    if (!ch.goal && Math.hypot(ch.pos.x - spot.x, ch.pos.y - spot.z) > 0.15) ch.goTo(spot.x, spot.z, spot.f);
    else if (ch.goal && (ch.goal.x !== spot.x || ch.goal.z !== spot.z)) ch.goTo(spot.x, spot.z, spot.f);
    ch.rod = spot.rod;
    ch.setState(line.hooked || line.state === 'landing' || line.pendingPull > 0.05 ? 'reel' : 'hold');
    ch.lookAt = line.bobber.position;
    // A cast the rod still owes: swing it the moment the fisherman gets
    // there, or let it go if they were too far away to have made it.
    if (line.castPending && spot.rod) {
      const near = Math.hypot(ch.pos.x - spot.x, ch.pos.y - spot.z) < 0.5;
      if (near) {
        this.boat.castRod(line.rodIndex, line.castPending.yaw);
        ch.play('cast', 1.1);
        line.castPending = null;
      } else if ((line.castPending.t += 1 / 60) > 2.5) {
        line.castPending = null;
      }
    }
  }

  /** Send a character to a post and pose them for it. */
  post(ch, spot, state) {
    if (ch.goal ? (ch.goal.x !== spot.x || ch.goal.z !== spot.z) : Math.hypot(ch.pos.x - spot.x, ch.pos.y - spot.z) > 0.15) {
      ch.goTo(spot.x, spot.z, spot.f);
    }
    ch.rod = null;
    ch.lookAt = null;
    ch.setState(ch.arrived ? state : 'idle');
  }

  update(dt, t, helmIsTender) {
    if (!this.stations) return;
    const b = this.boat, f = this.fishing, S = this.stations;
    const helmsman = this.hands.find((h) => h.role === 'helm');
    const fishers = this.hands.filter((h) => h.role === 'fisher');
    const crewFishing = f.crew && fishers.length > 0;
    const moving = b.throttle > 0.05 || b.speed > 1.0;
    const tenderHand = this.hands.find((h) => h.role === 'tender');

    // --- the captain ---
    const cap = this.captain;
    const capSeat = helmIsTender ? 'tender' : 'boat';
    if (this._capSeat !== capSeat) {
      this._capSeat = capSeat;
      (capSeat === 'tender' ? this.tender.group : b.group).add(cap.actor);
      if (capSeat === 'tender') {
        cap.placeAt(0.18, (this.tender.hullBounds?.length || 5) * 0.12, 0);
      } else {
        cap.placeAt(S.helm.x, S.helm.z, S.helm.f);
      }
    }
    if (capSeat === 'tender') {
      // At the tender's helm, and fishing from the seat.
      const line = this.lineToWork();
      cap.rod = null; cap.lookAt = line ? line.bobber.position : null;
      cap.setState('sit');
      cap.update(dt, t, () => this.tender.hullBounds?.deckY ?? 0.4, { steer: this.tender.steerDemand || 0 });
    } else {
      const line = crewFishing ? null : this.lineToWork();
      if (line) {
        this.workLine(cap, line);
      } else if (helmsman || crewFishing) {
        this.post(cap, S.command, 'idle');
        // Directing: point at whatever is going on, now and again.
        this.directTimer -= dt;
        if (this.directTimer <= 0 && cap.arrived) {
          this.directTimer = 3.5 + Math.random() * 4;
          cap.play('point', 1.7);
        }
      } else if (moving) {
        this.post(cap, S.helm, 'helm');
      } else {
        this.post(cap, S.helm, 'idle');
      }
      cap.update(dt, t, (x, z) => b.deckHeightAt(x, z), { steer: b.steerSmooth });
    }

    // --- the hands ---
    // Fishing crew: hand out the busy lines, stickily, nearest first.
    if (crewFishing) {
      const busy = f.lines.filter((l) => l.busy);
      for (const h of fishers) if (h.line && !h.line.busy) h.line = null;
      for (const l of busy) {
        if (fishers.some((h) => h.line === l)) continue;
        const spot = this.rodSpot(l.rodIndex);
        let best = null, bd = Infinity;
        for (const h of fishers) {
          if (h.line) continue;
          const d = Math.hypot(h.ch.pos.x - spot.x, h.ch.pos.y - spot.z);
          if (d < bd) { bd = d; best = h; }
        }
        if (best) best.line = l;
      }
    } else {
      for (const h of fishers) h.line = null;
    }

    let railN = 0;
    for (const h of this.hands) {
      const ch = h.ch;
      let deckY = (x, z) => b.deckHeightAt(x, z);
      let ctx = { steer: b.steerSmooth };
      switch (h.role) {
        case 'helm':
          this.post(ch, S.helm, 'helm');
          break;
        case 'sonar':
          this.post(ch, S.sonar, b.spec.features.sonar ? 'station' : 'lounge');
          break;
        case 'deck':
          this.post(ch, S.stern, b.trawling ? 'station' : 'lounge');
          break;
        case 'tender': {
          const td = this.tender;
          const aboardTender = td.deployed && !helmIsTender;
          this.seat(h, aboardTender ? 'tender' : 'boat');
          if (aboardTender) {
            ch.setState('sit');
            ch.lookAt = td.lineFx?.bob?.visible ? td.lineFx.bob.position : null;
            if (td.lineFx && td.lineFx.timer > 0 && td.lineFx.timer > 2.9) ch.play('wave', 0.9);
            deckY = () => td.hullBounds?.deckY ?? 0.4;
            ctx = { steer: td.steerDemand || 0 };
          } else {
            this.post(ch, S.crane, 'lounge');
          }
          break;
        }
        case 'fisher':
          if (h.line) this.workLine(ch, h.line);
          else this.post(ch, S.rail[(railN++) % S.rail.length], 'lounge');
          break;
        default:
          this.post(ch, h.spot, 'idle');
      }
      ch.update(dt, t, deckY, ctx);
    }
  }
}
