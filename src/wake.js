// Boat wake: a real surface disturbance rather than a puff of sprites.
//
// The trail is a ribbon built from a history of where the hull has been. Each
// sample remembers the speed it was laid down at, and its half-width grows
// with age at speed * tan(19.47deg) — the Kelvin angle — so the ribbon opens
// into the correct V behind the boat all by itself.
//
// The ribbon is several columns wide rather than a flat two-vertex strip,
// which is what lets it have a SHAPE across its width: a hollow lane down
// the middle with a raised, curling crest riding each edge — the whale-tail
// split you see behind a real boat. The vertex shader lifts those crests
// above the water and the fragment shader lights them, so they read as waves
// with height instead of paint on a flat surface.
//
// The head of the trail is recomputed every frame from the boat's current
// transom rather than only when a new sample is committed, so the wake grows
// continuously instead of popping into being a segment at a time.
//
// Hull-dependent, as a wake should be:
//   * size    — beam and hull length set how wide the V opens, how tall the
//               crests stand and how far back the trail survives.
//   * power   — a heavier, harder-driven hull churns whiter, noisier and
//               throws more spray; a little outboard just creases the surface.
// None of it touches a bet. This is paint.

import * as THREE from 'three';
import { CONFIG } from './config.js';

// 200 samples 0.55m apart caps the trail at ~110m, which is long enough that
// `life` is what ends a wake rather than the buffer running out.
const MAX_SAMPLES = 200;
const COLS = 9;                 // vertices across the ribbon
const KELVIN_TAN = 0.3543;      // tan(19.47 deg) — the Kelvin half-angle
const STEP = 0.55;              // metres between committed trail samples
const MIN_SPEED = 0.35;         // below this the hull leaves nothing

/**
 * How hard a hull drives the water: big displacement pushed by a big engine.
 * Ranges from ~0.06 for the skiff to ~0.95 for the steamboat.
 */
export function hullPower(spec) {
  const raw = (spec.accel ?? 8) * (spec.length ?? 6);
  return Math.max(0, Math.min(1, (raw - 45) / 110));
}

const VERT = /* glsl */`
  attribute float aSide;
  attribute float aAge;
  attribute float aFoam;
  attribute float aDist;
  attribute float aWaveK;
  attribute float aSeed;
  attribute float aLat;
  attribute vec2  aDrift;
  uniform float uTime;
  uniform float uFlowT;
  uniform float uCrestH;
  uniform float uWashLen;
  varying float vSide;
  varying float vAge;
  varying float vFoam;
  varying float vDist;
  varying float vWaveK;
  varying float vSeed;
  varying float vCrest;
  varying float vHollow;
  varying float vH;
  varying vec2  vWorld;
  varying float vLat;
  varying vec2  vDrift;

  void main() {
    vSide = aSide; vAge = aAge; vFoam = aFoam;
    vDist = aDist; vWaveK = aWaveK; vSeed = aSeed; vLat = aLat; vDrift = aDrift;

    float a = abs(aSide);
    // Cross-section: a crest riding each edge, a hollow lane between them.
    float crest  = exp(-pow((a - 0.80) / 0.19, 2.0));
    float hollow = exp(-pow((a - 0.36) / 0.32, 2.0));
    vCrest = crest;
    vHollow = hollow;

    // The shape builds just behind the transom and dies out with the trail.
    float env = pow(max(0.0, 1.0 - aAge), 1.15) * aFoam;
    env *= smoothstep(0.0, uWashLen * 0.28, aDist);

    float ripple = sin(aDist * aWaveK - aAge * 1.8 - uFlowT + aSeed) * (1.0 - a * 0.65);
    float h = (crest - hollow * 0.45 + ripple * 0.22) * uCrestH * env;
    vH = h / max(0.0001, uCrestH);

    vec3 p = position;
    // Sampled in world metres by the fragment shader, so the water texture
    // has a fixed physical scale instead of stretching as the ribbon widens.
    vWorld = p.xz;
    p.y += h;
    // Ride the same swell the water surface uses, so the ribbon sits on it.
    p.y += sin(p.x * 0.35 + uTime * 1.1) * 0.05
         + sin(p.z * 0.28 - uTime * 0.9) * 0.05
         + sin((p.x + p.z) * 0.12 + uTime * 0.6) * 0.07;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

const FRAG = /* glsl */`
  precision highp float;
  uniform float uTime;
  uniform float uFlowT;    // rock wakes: the crests run downstream with the water
  uniform float uPower;    // 0..1 — how hard this hull drives the water
  uniform float uWashLen;  // metres of boiling water behind the transom
  uniform vec3  uFoam;     // white water
  uniform vec3  uTrough;   // the shoved-aside water
  uniform vec3  uShadow;   // the shaded inner face of each crest
  varying float vSide;
  varying float vAge;
  varying float vFoam;
  varying float vDist;
  varying float vWaveK;
  varying float vSeed;
  varying float vCrest;
  varying float vHollow;
  varying float vH;
  varying vec2  vWorld;
  varying float vLat;
  varying vec2  vDrift;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, amp = 0.5;
    for (int i = 0; i < 3; i++) { v += amp * noise(p); p *= 2.03; amp *= 0.5; }
    return v / 0.875;
  }

  void main() {
    float a = abs(vSide);
    float fade = pow(max(0.0, 1.0 - vAge), 1.15);
    if (fade <= 0.002) discard;

    // Water texture sampled in WORLD metres, so it stays a fixed physical
    // size however wide the wake has opened, and stays put on the water as
    // the boat drives away from it.
    // A wake laid behind a rock in a current is carried off downstream:
    // its texture drifts with the water instead of staying put.
    vec2 w = vWorld - vDrift * uTime;
    float nA = fbm(w * 0.55 + uTime * vec2(0.05, -0.03));   // broad patches
    float nB = fbm(w * 1.75 - uTime * vec2(0.13, 0.09));    // chop
    float nC = noise(w * 5.5 + uTime * vec2(0.45, 0.28));   // fizz

    // --- the curling arms: a ridge that wanders and breaks into clumps
    // rather than running as one clean band ---
    float ridge = 0.74 + (nA - 0.5) * 0.18;
    float crest = exp(-pow((a - ridge) / 0.26, 2.0));
    float clump = smoothstep(0.22, 0.68, nB * 0.65 + nA * 0.55);
    float arm = crest * (0.55 + clump * 1.10);

    // --- laminar ripples: smooth streamwise lines running from mid-lane out
    // through the arm, bent around the chop by the broad noise, so the
    // choppy clumps sit inside curling flow rather than floating on nothing ---
    float lam = sin(vLat * 1.9 + (nA - 0.5) * 8.0 + vSeed);
    lam = smoothstep(0.35, 1.0, lam)
        * smoothstep(0.25, 0.55, a) * (1.0 - smoothstep(0.92, 1.06, a));

    // --- transverse arcs across the V, cusped toward the stern ---
    float d = vDist + a * a * 2.2;
    float tw = sin(d * vWaveK - vAge * 1.8 - uFlowT + vSeed);
    tw = smoothstep(0.45, 1.0, tw) * (1.0 - smoothstep(0.62, 0.86, a));
    tw *= 0.5 + nB * 0.9;

    // The split: the hull's own track stays open water, so the wake reads as
    // two arms with a lane between them. Only the prop wash crosses it.
    float lane = smoothstep(0.06, 0.46, a);

    // --- prop wash boiling off the transom, over a fixed distance ---
    float wash = smoothstep(uWashLen, 0.0, vDist) * (1.0 - smoothstep(0.25, 0.95, a));
    wash *= 0.45 + nB * 1.1 + nC * 0.4;

    // Granular chop over everything, so no part of it is a smooth gradient.
    float chop = 0.55 + nB * 0.7 + nC * 0.5;

    // Die out before the ribbon's own edge, otherwise the geometry boundary
    // shows up as a straight cut through live foam.
    float edge = 1.0 - smoothstep(0.86, 1.0, a);

    float foam = ((arm + lam * 0.45 + tw * 0.32) * lane * edge + wash * 1.35)
      * vFoam * fade * chop;
    // The hull-power gate: a little outboard creases the surface, a steamboat
    // throws a wall of white.
    foam *= 0.26 + uPower * 0.85;

    // Foam DISSOLVES: the threshold climbs with age, so the sheet breaks into
    // shrinking islands the way real foam does instead of dimming uniformly.
    float dis = nB * 0.55 + nC * 0.45;
    // Nothing starts breaking up until the wake has had a moment to settle,
    // so the water right behind the hull stays solid white.
    float alive = 1.0 - smoothstep(dis * 0.8 + 0.30, dis * 0.8 + 0.72, vAge * 1.15);
    foam *= alive;
    foam = clamp(foam, 0.0, 1.6);

    // Height shading: the crest catches the light, the hollow inboard of it
    // sits in its shadow. That contrast is what sells the relief.
    float lit = clamp(vH, 0.0, 1.0);
    float shade = vHollow * (1.0 - vCrest) * vFoam * fade;

    vec3 col = mix(uTrough, uFoam, clamp(foam * 1.3 + lit * 0.4, 0.0, 1.0));
    col = mix(col, uShadow, clamp(shade * 0.9 * (0.6 + nA * 0.8), 0.0, 0.65));

    float alpha = clamp(foam * 0.95 + shade * (0.24 + uPower * 0.24) * alive, 0.0, 0.94);
    if (alpha <= 0.004) discard;
    gl_FragColor = vec4(col, alpha);
  }`;

// --- stern spray -----------------------------------------------------------

const SPRAY_MAX = 280;

const SPRAY_VERT = /* glsl */`
  attribute float aLife;
  attribute float aSize;
  varying float vLife;
  void main() {
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (120.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }`;

const SPRAY_FRAG = /* glsl */`
  precision mediump float;
  uniform vec3 uColor;
  varying float vLife;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25) discard;
    float soft = 1.0 - smoothstep(0.05, 0.25, d);
    float a = soft * pow(max(vLife, 0.0), 0.6) * 0.92;
    if (a < 0.012) discard;
    gl_FragColor = vec4(uColor, a);
  }`;

/**
 * Droplets kicked off the transom. A wake is never a clean shape at its root:
 * this is the mess where the hull is actually tearing at the water.
 */
class SternSpray {
  constructor(scene) {
    this.pos = new Float32Array(SPRAY_MAX * 3).fill(9999);
    this.vel = new Float32Array(SPRAY_MAX * 3);
    this.life = new Float32Array(SPRAY_MAX);
    this.decay = new Float32Array(SPRAY_MAX);
    this.emitAcc = 0;
    this.next = 0;
    this.power = 0.3;
    this.beam = 1;

    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aLife = new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(SPRAY_MAX), 1)
      .setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aLife', this.aLife);
    geo.setAttribute('aSize', this.aSize);

    this.mat = new THREE.ShaderMaterial({
      vertexShader: SPRAY_VERT,
      fragmentShader: SPRAY_FRAG,
      uniforms: { uColor: { value: new THREE.Color(0xf4fbff) } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
  }

  setSpec(power, beam, stern) { this.power = power; this.beam = beam; this.stern = stern; }

  setVisible(on) { this.points.visible = on; }

  reset() {
    this.life.fill(0);
    this.pos.fill(9999);
    this.aPos.needsUpdate = true;
    this.aLife.needsUpdate = true;
  }

  spawn(vessel, frac) {
    const i = this.next = (this.next + 1) % SPRAY_MAX;
    const { pos, heading } = vessel;
    // (sin h, cos h) points astern, matching the hull's own convention.
    const bx = Math.sin(heading), bz = Math.cos(heading);
    const nx = -bz, nz = bx;
    // Two uniforms averaged give a centre-weighted spread, so the spray
    // boils out of the middle of the transom rather than along its full beam.
    // A rock in a current supplies its own stern (its upstream face, so the
    // water piles onto it and flies over) and beam; a hull uses the spec's.
    const stern = vessel.sprayStern ?? this.stern, beam = vessel.sprayBeam ?? this.beam;
    const power = vessel.sprayPower ?? this.power;
    const lateral = (Math.random() + Math.random() - 1) * beam * 0.75;
    const o = i * 3;
    this.pos[o] = pos.x + bx * stern + nx * lateral;
    this.pos[o + 1] = CONFIG.WATER_LEVEL + 0.08;
    this.pos[o + 2] = pos.z + bz * stern + nz * lateral;

    const kick = (0.8 + Math.random() * 2.4) * (0.6 + frac * 0.9) + (vessel.sprayCarry ?? 0);
    const out = (Math.random() - 0.5) * (1.7 + beam * 0.55);
    this.vel[o] = bx * kick + nx * out;
    this.vel[o + 1] = (1.8 + Math.random() * 2.8) * (0.62 + power * 0.8);
    this.vel[o + 2] = bz * kick + nz * out;

    this.life[i] = 1;
    this.decay[i] = 1 / (0.42 + Math.random() * 0.5);
    this.aSize.array[i] = (1.2 + Math.random() * 2.6) * (0.65 + power * 0.75);
  }

  update(dt, vessel, moving, frac) {
    if (moving) {
      // Faster and heavier hulls tear more water off the transom.
      this.emitAcc += (26 + this.power * 110) * frac * dt;
      let guard = 40;
      while (this.emitAcc >= 1 && guard-- > 0) {
        this.emitAcc -= 1;
        this.spawn(vessel, frac);
      }
      this.emitAcc = Math.min(this.emitAcc, 3);
    }
    let any = false;
    for (let i = 0; i < SPRAY_MAX; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= this.decay[i] * dt;
      const o = i * 3;
      this.vel[o + 1] -= 9.8 * dt;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.life[i] <= 0 || this.pos[o + 1] < CONFIG.WATER_LEVEL - 0.05) {
        this.life[i] = 0;
        this.pos[o] = this.pos[o + 1] = this.pos[o + 2] = 9999;
      }
    }
    this.points.visible = any;
    this.aPos.needsUpdate = true;
    this.aLife.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }

  dispose() {
    this.points.parent?.remove(this.points);
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

// --- the trail -------------------------------------------------------------

export class WakeTrail {
  constructor(scene) {
    this.samples = [];          // oldest first
    this.head = null;           // live, recomputed every frame
    this.life = 3.2;
    this.beam = 1;
    this.widthScale = 1;
    this.power = 0.3;
    this.maxSpread = 7;
    this.crestH = 0.3;
    this.lastX = null;
    this.lastZ = null;

    const n = MAX_SAMPLES * COLS;
    const geo = new THREE.BufferGeometry();
    this.attr = {
      position: new THREE.BufferAttribute(new Float32Array(n * 3), 3),
      aSide: new THREE.BufferAttribute(new Float32Array(n), 1),
      aAge: new THREE.BufferAttribute(new Float32Array(n), 1),
      aFoam: new THREE.BufferAttribute(new Float32Array(n), 1),
      aDist: new THREE.BufferAttribute(new Float32Array(n), 1),
      aWaveK: new THREE.BufferAttribute(new Float32Array(n), 1),
      aSeed: new THREE.BufferAttribute(new Float32Array(n), 1),
      aLat: new THREE.BufferAttribute(new Float32Array(n), 1),
      aDrift: new THREE.BufferAttribute(new Float32Array(n * 2), 2),   // a hull's wake stays put
    };
    for (const [name, a] of Object.entries(this.attr)) {
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
    }
    const idx = new Uint16Array((MAX_SAMPLES - 1) * (COLS - 1) * 6);
    let w = 0;
    for (let k = 0; k < MAX_SAMPLES - 1; k++) {
      for (let j = 0; j < COLS - 1; j++) {
        const v00 = k * COLS + j, v01 = v00 + 1;
        const v10 = v00 + COLS, v11 = v10 + 1;
        idx[w++] = v00; idx[w++] = v01; idx[w++] = v10;
        idx[w++] = v01; idx[w++] = v11; idx[w++] = v10;
      }
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uFlowT: { value: 0 },
        uPower: { value: 0.3 },
        uWashLen: { value: 8 },
        uCrestH: { value: 0.3 },
        uFoam: { value: new THREE.Color(0xffffff) },
        uTrough: { value: new THREE.Color(0x9fd3e6) },
        uShadow: { value: new THREE.Color(0x2f7fa6) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;     // the ribbon lives far behind its origin
    this.mesh.renderOrder = 3;           // over the water plane (2)
    this.mesh.position.y = CONFIG.WATER_LEVEL + 0.04;
    scene.add(this.mesh);

    this.spray = new SternSpray(scene);
  }

  /**
   * Re-tune for a hull. Displacement is what makes a wake big, so hull length
   * and beam drive how wide the V opens, how tall its crests stand and how far
   * back it survives; the skin's wake stat trims that either side of its
   * hull's baseline. A fast little skiff still cuts a long thin trail, but it
   * cannot out-spread a steamboat the way a raw Kelvin angle alone would.
   */
  setSpec(spec, bounds) {
    this.beam = Math.max(0.6, (bounds?.halfBeam ?? spec.length * 0.16) * 1.15);
    // The wake is laid down at the transom — the hull's real stern, not a
    // guess from its beam (a paddler is wider than it is long-to-beam, a
    // seiner far longer), a hand inside it so the trail meets the hull.
    this.stern = Math.max(0.5, (bounds?.sternZ ?? (spec.length ?? 6) * 0.5) - 0.25);
    const wakeStat = spec.wake ?? 1;
    const size = Math.max(0.5, Math.min(2.2, (spec.length ?? 6) / 10));
    this.widthScale = (0.75 + wakeStat * 0.5);
    this.life = (5.0 + wakeStat * 2.5) * (0.75 + size * 0.45);
    // Never outlive the sample buffer: a trail longer than MAX_SAMPLES*STEP
    // would drop its oldest samples while they were still visible, popping the
    // tail. Expiry has to be what ends a wake, not the buffer running out.
    const reach = (MAX_SAMPLES - 2) * STEP / Math.max(1, spec.maxSpeed ?? 8);
    this.life = Math.min(this.life, reach);
    this.maxSpread = (1.0 + this.beam * 1.4) * wakeStat * (0.7 + size * 0.35);
    this.power = hullPower(spec);
    this.crestH = Math.min(0.75, (0.10 + this.power * 0.38) * (0.7 + size * 0.45));
    this.mat.uniforms.uPower.value = this.power;
    this.mat.uniforms.uCrestH.value = this.crestH;
    this.mat.uniforms.uWashLen.value = 1.8 + this.beam * 1.6;
    this.spray.setSpec(this.power, this.beam, this.stern);
    this.reset();
  }

  reset() {
    this.samples.length = 0;
    this.head = null;
    this.lastX = this.lastZ = null;
    this.mesh.geometry.setDrawRange(0, 0);
    this.spray.reset();
  }

  setVisible(on) {
    this.mesh.visible = on;
    this.spray.setVisible(on);
  }

  /** Build the sample the boat is laying down right now. */
  makeSample(vessel, frac) {
    const { pos, heading, speed } = vessel;
    const dx = Math.sin(heading), dz = Math.cos(heading);
    let foam = Math.max(0, (frac - 0.05) / 0.95);
    // Even a boat barely under way creases the surface.
    foam = (0.38 + Math.pow(foam, 0.65) * 0.72) * (vessel.trawling ? 1.25 : 1);
    const lambda = 2.2 + speed * 0.9;
    return {
      x: pos.x + dx * this.stern,
      z: pos.z + dz * this.stern,
      dx, dz,
      speed,
      foam: Math.min(1.2, foam),
      waveK: (Math.PI * 2) / lambda,
      age: 0,
      seed: Math.random() * 6.283,
      // A touch of asymmetry so the trail is never mechanically even.
      width: this.beam * (vessel.trawling ? 1.5 : 1) * this.widthScale
        * (0.94 + Math.random() * 0.12),
    };
  }

  /**
   * `vessel` supplies pos/heading/speed/spec; trawling drags a wider, dirtier
   * wake because the net is tearing at the surface behind you.
   */
  update(dt, t, vessel) {
    this.mat.uniforms.uTime.value = t;

    for (const s of this.samples) s.age += dt;
    while (this.samples.length && this.samples[0].age > this.life) this.samples.shift();

    const { pos, speed } = vessel;
    const maxSpeed = vessel.spec?.maxSpeed || 8;
    const moving = speed > MIN_SPEED;
    const frac = Math.min(1, speed / maxSpeed);

    if (moving) {
      // The head tracks the transom every frame, so the ribbon grows smoothly
      // instead of jumping forward one committed segment at a time.
      this.head = this.makeSample(vessel, frac);
      const moved = this.lastX === null
        ? Infinity : Math.hypot(pos.x - this.lastX, pos.z - this.lastZ);
      if (moved >= STEP) {
        this.samples.push(this.makeSample(vessel, frac));
        if (this.samples.length > MAX_SAMPLES - 1) this.samples.shift();
        this.lastX = pos.x;
        this.lastZ = pos.z;
      }
    } else {
      this.head = null;
      this.lastX = this.lastZ = null;   // restart spacing when under way again
    }

    this.build();
    this.spray.update(dt, vessel, moving, frac);
  }

  build() {
    const n = this.samples.length + (this.head ? 1 : 0);
    if (n < 2) { this.mesh.geometry.setDrawRange(0, 0); return; }

    const { position, aSide, aAge, aFoam, aDist, aWaveK, aSeed, aLat } = this.attr;
    const pos = position.array;
    const m = this.samples.length;
    // k = 0 is the newest (the live head if there is one), walking backwards.
    const at = (k) => (this.head
      ? (k === 0 ? this.head : this.samples[m - k])
      : this.samples[m - 1 - k]);

    let dist = 0;
    let prev = null;
    for (let k = 0; k < n; k++) {
      const s = at(k);
      if (prev) dist += Math.hypot(s.x - prev.x, s.z - prev.z);
      prev = s;

      // Kelvin spread: the disturbance walks outward at v*tan(19.47deg).
      const half = Math.min(
        s.width * 0.55 + s.speed * KELVIN_TAN * s.age,
        s.width * 0.55 + this.maxSpread);
      const nx = -s.dz, nz = s.dx;
      const age = Math.min(1, s.age / this.life);
      const base = k * COLS;

      for (let j = 0; j < COLS; j++) {
        const side = -1 + (2 * j) / (COLS - 1);
        const v = base + j;
        pos[v * 3] = s.x + nx * side * half;
        pos[v * 3 + 1] = 0;
        pos[v * 3 + 2] = s.z + nz * side * half;
        aSide.array[v] = side;
        aAge.array[v] = age;
        aFoam.array[v] = s.foam;
        aDist.array[v] = dist;
        aWaveK.array[v] = s.waveK;
        aSeed.array[v] = s.seed;
        aLat.array[v] = side * half;     // metres off the centreline

      }
    }

    position.needsUpdate = true;
    aSide.needsUpdate = true;
    aAge.needsUpdate = true;
    aFoam.needsUpdate = true;
    aDist.needsUpdate = true;
    aWaveK.needsUpdate = true;
    aSeed.needsUpdate = true;
    aLat.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, (n - 1) * (COLS - 1) * 6);
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.spray.dispose();
  }
}

// --- rock wakes ---------------------------------------------------------------
//
// A boulder standing in a rapid is a hull the water is driving past, so it
// gets the same wake as a boat: the same ribbon, the same crests and split
// and dissolving foam, the same spray tearing off it. The difference is that
// the hull stands still and the water moves, so the trail is laid once along
// the streamline running off downstream, and everything on it — texture,
// crests, dissolving islands — is carried off with the current.

const ROCK_STEP = 0.6;
const ROCK_COLS = COLS;

/** A tiny seeded generator, so a rock's wake is the same shape every visit. */
function lcg(seed) {
  let x = (seed >>> 0) || 1;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
}

/** One material for every rock wake in the world; time is set once a frame. */
const ROCK_MAT = new THREE.ShaderMaterial({
  vertexShader: VERT,
  fragmentShader: FRAG,
  uniforms: {
    uTime: { value: 0 },
    uFlowT: { value: 0 },
    uPower: { value: 0.78 },
    uWashLen: { value: 4.2 },
    uCrestH: { value: 0.34 },
    uFoam: { value: new THREE.Color(0xffffff) },
    uTrough: { value: new THREE.Color(0xa9dcea) },
    uShadow: { value: new THREE.Color(0x2c7ca4) },
  },
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/** Advance every rock wake's clock. Call once a frame. */
/** The boulder wakes' material, for compiling ahead of the first rapid. */
export function rockWakeMaterial() { return ROCK_MAT; }

export function tickRockWakes(t) {
  ROCK_MAT.uniforms.uTime.value = t;
  ROCK_MAT.uniforms.uFlowT.value = t * 5.5;
}

/**
 * The wakes of a chunk's boulders, as one static ribbon mesh plus a shared
 * spray system. `flow(x, z, out)` gives the current at a point; `fallback`
 * the direction to lay a wake when the rock stands in slack water at the
 * channel's edge (the region's flow).
 */
export class RockWakes {
  constructor(rocks, parent, flow, fallback) {
    this.parent = parent;
    this.rocks = [];
    const pos = [], side = [], age = [], foam = [], dist = [], waveK = [], seed = [], lat = [], drift = [], idx = [];
    const v = { x: 0, z: 0 };
    for (const b of rocks) {
      const r = b.s * 0.85;
      flow(b.x, b.z, v);
      let sp = Math.hypot(v.x, v.z);
      if (sp < 0.3) { const a = fallback(b); v.x = Math.cos(a) * 1.2; v.z = Math.sin(a) * 1.2; sp = 1.2; }
      const ux = v.x / sp, uz = v.z / sp;
      // The rock as a hull for the spray: it faces upstream, and the spray
      // spawns on that face and is carried over and round it.
      const speedK = Math.min(1, sp / 6);
      this.rocks.push({
        x: b.x, z: b.z, r, sp,
        vessel: { pos: { x: b.x, z: b.z }, heading: Math.atan2(ux, uz), sprayStern: -r * 0.55, sprayBeam: r * 1.1, sprayPower: 0.5 + speedK * 0.5, sprayCarry: sp * 0.45, spec: null },
        rate: (6 + sp * 5) * (0.6 + r * 0.5),
        acc: Math.random(),
      });
      // Lay the trail down the streamline. Nothing about its shape is a
      // straight line: each rock rolls its own spread, how the ribbon
      // flares toward the end, a meander of the centreline and a wobble
      // of the foam lines, so the wakes read as water finding its own way
      // down the bed rather than a V ruled off the rock.
      const rr = lcg((b.x * 73856093) ^ (b.z * 19349663) ^ Math.floor(b.r * 1000));
      const len = 9 + r * 5 + sp * 2.6 + rr() * 6;
      const width = r * 2.3;
      const spread = 1.2 + r * 1.4 + rr() * 2.4;          // extra half-width by the end
      const flareK = 1.1 + rr() * 1.3;                     // how late the widening comes
      const endFlare = rr() * 2.6;                         // the fan at the tail
      const meanderA = 0.4 + rr() * 1.3, meanderF = 0.22 + rr() * 0.3, meanderP = rr() * 6.283;
      const wobF = 0.45 + rr() * 0.4, wobP = rr() * 6.283, wobA = 0.12 + rr() * 0.14;
      const foamK = Math.min(1.15, 0.45 + speedK * 0.7);
      const waveKv = (Math.PI * 2) / (2.2 + sp * 0.9);
      const rockSeed = rr() * 6.283;
      let x = b.x + ux * r * 0.8, z = b.z + uz * r * 0.8, dx = ux, dz = uz, s = sp;
      let d = 0;
      const samples = [];
      for (let k = 0; k < 90; k++) {
        samples.push({ x, z, dx, dz, s, d });
        if (d >= len) break;
        x += dx * ROCK_STEP; z += dz * ROCK_STEP; d += ROCK_STEP;
        flow(x, z, v);
        const ns = Math.hypot(v.x, v.z);
        if (ns < 0.5) {
          // Run out into slack water: the last few samples carry straight on
          // and the ribbon fades to nothing.
          if (d > 3) { samples.push({ x, z, dx, dz, s, d, end: true }); }
          break;
        }
        // Follow the current, bending gently so the ribbon never kinks.
        const tx = v.x / ns, tz = v.z / ns;
        dx = dx * 0.55 + tx * 0.45; dz = dz * 0.55 + tz * 0.45;
        const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        s = ns;
      }
      if (samples.length < 3) continue;
      const total = samples[samples.length - 1].d;
      const base = pos.length / 3;
      const L = Math.max(total, len);
      for (let k = 0; k < samples.length; k++) {
        const sm = samples[k];
        const u = Math.min(1, sm.d / L);
        // Smooth, late widening, then a fan at the tail as the foam dies.
        const tail = u < 0.6 ? 0 : (u - 0.6) / 0.4;
        const half = width * 0.55 + spread * Math.pow(u, flareK) + endFlare * tail * tail;
        const nx = -sm.dz, nz = sm.dx;
        // The centreline wanders, more the further down it runs.
        const off = Math.sin(sm.d * meanderF + meanderP) * meanderA * u;
        const cxp = sm.x + nx * off, czp = sm.z + nz * off;
        const a = sm.end ? 1 : u;
        for (let j = 0; j < ROCK_COLS; j++) {
          const sd = -1 + (2 * j) / (ROCK_COLS - 1);
          // The foam lines inside the ribbon wobble along its length.
          const w = half * (1 + wobA * Math.sin(sm.d * wobF + wobP + j * 1.7));
          pos.push(cxp + nx * sd * w, 0, czp + nz * sd * w);
          side.push(sd); age.push(a); foam.push(foamK); dist.push(sm.d);
          waveK.push(waveKv); seed.push(rockSeed); lat.push(sd * w);
          drift.push(sm.dx * sm.s, sm.dz * sm.s);
        }
      }
      for (let k = 0; k < samples.length - 1; k++) {
        for (let j = 0; j < ROCK_COLS - 1; j++) {
          const v00 = base + k * ROCK_COLS + j, v01 = v00 + 1, v10 = v00 + ROCK_COLS, v11 = v10 + 1;
          idx.push(v00, v01, v10, v01, v11, v10);
        }
      }
    }
    this.mesh = null;
    if (pos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
      geo.setAttribute('aAge', new THREE.Float32BufferAttribute(age, 1));
      geo.setAttribute('aFoam', new THREE.Float32BufferAttribute(foam, 1));
      geo.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
      geo.setAttribute('aWaveK', new THREE.Float32BufferAttribute(waveK, 1));
      geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
      geo.setAttribute('aLat', new THREE.Float32BufferAttribute(lat, 1));
      geo.setAttribute('aDrift', new THREE.Float32BufferAttribute(drift, 2));
      geo.setIndex(idx);
      this.mesh = new THREE.Mesh(geo, ROCK_MAT);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 3;
      this.mesh.position.y = CONFIG.WATER_LEVEL + 0.04;
      this.mesh.userData.rockWake = true;
      parent.add(this.mesh);
    }
    this.spray = this.rocks.length ? new SternSpray(parent) : null;
    if (this.spray) this.spray.points.userData.rockWake = true;
  }

  /** Spray off the rocks near (x, z): the ones the player can see. */
  update(t, dt, x, z) {
    if (!this.spray) return;
    let emitted = false;
    for (const rk of this.rocks) {
      if (Math.abs(rk.x - x) > 90 || Math.abs(rk.z - z) > 90) continue;
      rk.acc += rk.rate * dt;
      let guard = 6;
      while (rk.acc >= 1 && guard-- > 0) { rk.acc -= 1; this.spray.spawn(rk.vessel, Math.min(1, rk.sp / 6)); emitted = true; }
      rk.acc = Math.min(rk.acc, 2);
    }
    // Move what is flying; spawn nothing more (the loop above did that).
    this.spray.update(dt, null, false, 0);
    if (emitted) this.spray.points.visible = true;
  }

  dispose() {
    if (this.mesh) { this.parent.remove(this.mesh); this.mesh.geometry.dispose(); }
    if (this.spray) this.spray.dispose();
  }
}
