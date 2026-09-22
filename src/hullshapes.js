// Procedural hulls, for boats that have no modelled GLB.
//
// Every other hull in the fleet is a converted model whose texture stores a
// paint-ramp coordinate per pixel (see skinner.js). A procedural hull has no
// texture, so instead each of its meshes is tagged with `userData.ramp` — the
// index of the paint stop it wears — and skinner.js colours it from the same
// four-stop palette. That way a procedural boat takes every skin exactly like
// a modelled one.
//
// boat.js prefers `assets/boats/<id>.glb` and only falls back here, so
// dropping in a real model later replaces this with no code change.

import * as THREE from 'three';

const RAMP = { accent: 0, hull: 1, deck: 2, trim: 3 };

function mat(ramp) {
  const m = new THREE.MeshStandardMaterial({
    color: 0xbfc6cc, roughness: 0.55, metalness: 0.05, flatShading: true,
  });
  m.userData.ramp = ramp;
  return m;
}

function meshOf(geo, ramp) {
  const m = new THREE.Mesh(geo, mat(ramp));
  m.userData.ramp = ramp;
  m.castShadow = true;
  return m;
}

function tri(out, a, b, c) {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}
function quad(out, a, b, c, d) { tri(out, a, b, c); tri(out, a, c, d); }

function fromPositions(pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A planing runabout: pointed bow, hard chines, wide transom, wraparound
 * screen and an outboard on the back. Bow at -z, to match rodMounts().
 */
function buildSpeedboat(length) {
  const g = new THREE.Group();
  const L = length;
  const B = L * 0.195;          // max half-beam
  const D = L * 0.078;          // draft below the waterline
  const S = L * 0.063;          // gunwale height above it
  const N = 10;                 // stations bow -> stern

  // Cross-section of a hard-chine V hull at station t.
  const section = (t) => {
    const z = -L / 2 + t * L;
    const hb = B * (1 - Math.pow(1 - t, 1.8)) * (1 - 0.1 * Math.max(0, t - 0.78) / 0.22);
    const d = -D * (1 - 0.42 * t);
    const sy = S * (1 + 0.5 * Math.pow(1 - t, 2));
    return {
      z,
      gL: [-hb * 0.99, sy, z], cL: [-hb, d * 0.32, z],
      keel: [0, d, z],
      cR: [hb, d * 0.32, z], gR: [hb * 0.99, sy, z],
    };
  };

  const st = [];
  for (let i = 0; i < N; i++) st.push(section(i / (N - 1)));

  // --- hull shell ---
  const shell = [];
  for (let i = 0; i < N - 1; i++) {
    const a = st[i], b = st[i + 1];
    quad(shell, a.gL, a.cL, b.cL, b.gL);       // topsides, port
    quad(shell, a.cL, a.keel, b.keel, b.cL);   // bottom, port
    quad(shell, a.keel, a.cR, b.cR, b.keel);   // bottom, starboard
    quad(shell, a.cR, a.gR, b.gR, b.cR);       // topsides, starboard
  }
  // Transom cap.
  const e = st[N - 1];
  quad(shell, e.gL, e.gR, e.cR, e.cL);
  tri(shell, e.cL, e.cR, e.keel);
  g.add(meshOf(fromPositions(shell), RAMP.hull));

  // --- deck, from the bow back to the cockpit ---
  const deck = [];
  for (let i = 0; i < N - 1; i++) {
    const a = st[i], b = st[i + 1];
    quad(deck, a.gL, b.gL, b.gR, a.gR);
  }
  const deckMesh = meshOf(fromPositions(deck), RAMP.deck);
  deckMesh.position.y = 0.002;
  deckMesh.receiveShadow = true;
  g.add(deckMesh);

  // --- open cockpit sole, laid over the deck so it reads from above ---
  const sole = meshOf(
    new THREE.BoxGeometry(B * 1.34, S * 0.1, L * 0.34), RAMP.accent);
  sole.position.set(0, S * 1.05, L * 0.12);
  g.add(sole);

  // --- two seats sitting in it ---
  for (const sx of [-1, 1]) {
    const seat = meshOf(
      new THREE.BoxGeometry(B * 0.5, S * 0.42, L * 0.09), RAMP.accent);
    seat.position.set(sx * B * 0.38, S * 1.3, L * 0.17);
    g.add(seat);
    const back = meshOf(
      new THREE.BoxGeometry(B * 0.5, S * 0.7, L * 0.025), RAMP.accent);
    back.position.set(sx * B * 0.38, S * 1.62, L * 0.218);
    g.add(back);
  }

  // --- wraparound screen, raked aft ---
  const screen = meshOf(new THREE.BoxGeometry(B * 1.42, S * 0.9, L * 0.016), RAMP.trim);
  screen.position.set(0, S * 1.6, -L * 0.03);
  screen.rotation.x = -0.34;
  g.add(screen);

  // --- foredeck flash and a rubbing strake down each side ---
  const flash = meshOf(new THREE.BoxGeometry(B * 0.42, S * 0.12, L * 0.40), RAMP.trim);
  flash.position.set(0, S * 1.34, -L * 0.25);
  g.add(flash);
  for (const sx of [-1, 1]) {
    const strake = meshOf(new THREE.BoxGeometry(L * 0.014, S * 0.24, L * 0.74), RAMP.trim);
    strake.position.set(sx * B * 0.97, S * 0.26, L * 0.04);
    g.add(strake);
  }

  // --- outboard, tucked against the transom ---
  // Hung off its own pivot at the transom clamp and tagged as a moving part,
  // so boat.js steers and tilts it exactly as it does a carved-out one.
  const motor = new THREE.Group();
  motor.position.set(0, S * 1.6, L * 0.525);
  motor.userData.part = { kind: 'outboard' };
  g.add(motor);
  const cowl = meshOf(new THREE.BoxGeometry(B * 0.5, S * 1.1, L * 0.07), RAMP.accent);
  cowl.position.set(0, -S * 0.55, 0);
  motor.add(cowl);
  const leg = meshOf(new THREE.BoxGeometry(B * 0.16, S * 1.5, L * 0.035), RAMP.accent);
  leg.position.set(0, -S * 1.65, L * 0.003);
  motor.add(leg);
  const skeg = meshOf(new THREE.BoxGeometry(B * 0.08, S * 0.45, L * 0.1), RAMP.accent);
  skeg.position.set(0, -S * 2.38, -L * 0.003);
  motor.add(skeg);

  return g;
}

const BUILDERS = { speedboat: buildSpeedboat };

/** Does this hull id have a procedural shape of its own? */
export function hasProceduralHull(id) { return !!BUILDERS[id]; }

/** Build a hull procedurally, or null if there is no shape for this id. */
export function buildProceduralHull(id, length) {
  const fn = BUILDERS[id];
  return fn ? fn(length) : null;
}
