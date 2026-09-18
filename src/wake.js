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
  uniform float uTime;
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

  void main() {
    vSide = aSide; vAge = aAge; vFoam = aFoam;
    vDist = aDist; vWaveK = aWaveK; vSeed = aSeed;

    float a = abs(aSide);
    // Cross-section: a crest riding each edge, a hollow lane between them.
    float crest  = exp(-pow((a - 0.80) / 0.19, 2.0));
    float hollow = exp(-pow((a - 0.36) / 0.32, 2.0));
    vCrest = crest;
    vHollow = hollow;

    // The shape builds just behind the transom and dies out with the trail.
    float env = pow(max(0.0, 1.0 - aAge), 1.15) * aFoam;
    env *= smoothstep(0.0, uWashLen * 0.28, aDist);

    float ripple = sin(aDist * aWaveK - aAge * 1.8 + aSeed) * (1.0 - a * 0.65);
    float h = (crest - hollow * 0.45 + ripple * 0.22) * uCrestH * env;
    vH = h / max(0.0001, uCrestH);

    vec3 p = position;
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

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    float a = abs(vSide);
    float fade = pow(max(0.0, 1.0 - vAge), 1.25);
    if (fade <= 0.002) discard;

    // No wake is tidy: break the crest up along its length so it curls and
    // spills instead of running as one clean ridge.
    float curl  = noise(vec2(vDist * 0.75 + vSeed, vSide * 1.6) + uTime * vec2(0.18, 0.04));
    float curl2 = noise(vec2(vDist * 2.6 + vSeed, vSide * 5.0) - uTime * vec2(0.7, 0.2));
    float curl3 = noise(vec2(vDist * 6.5 + vSeed, vSide * 11.0) + uTime * vec2(0.3, 0.6));
    float breakup = 0.30 + curl * 1.05 + curl2 * 0.45 + curl3 * 0.25;

    // Wander the ridge a little along its length: a curling wave is never a
    // ruled line, and the wobble is what makes it read as breaking.
    float wobble = (curl - 0.5) * 0.10;
    float crestFoam = exp(-pow((a - (0.80 + wobble)) / 0.19, 2.0)) * breakup;
    // Foam spilling down the outer face of each crest.
    float lip = exp(-pow((a - 0.95) / 0.07, 2.0)) * (0.5 + curl * 0.9);

    // Transverse arcs strung across the V, cusped toward the stern.
    float d = vDist + a * a * 2.2;
    float tw = sin(d * vWaveK - vAge * 1.8 + vSeed);
    tw = smoothstep(0.45, 1.0, tw) * (1.0 - smoothstep(0.62, 0.86, a));

    // The split: the hull's own track down the centreline stays open water,
    // so the wake reads as two curling arms with a lane between them rather
    // than one filled-in triangle. Only the prop wash crosses it.
    float lane = smoothstep(0.06, 0.46, a);

    // Prop wash boiling off the transom, over a fixed distance so it does not
    // stretch as the wake lengthens.
    float wash = smoothstep(uWashLen, 0.0, vDist) * (1.0 - smoothstep(0.25, 0.95, a));
    wash *= 0.65 + curl2 * 0.7;

    float foam = ((crestFoam * 1.15 + lip * 0.8 + tw * 0.3) * lane + wash * 1.3)
      * vFoam * fade;
    // The hull-power gate: a little outboard creases the surface, a steamboat
    // throws a wall of white.
    foam *= 0.26 + uPower * 0.85;
    foam = clamp(foam, 0.0, 1.6);

    // Height shading: the crest catches the light, the hollow inboard of it
    // sits in its shadow. That contrast is what sells the relief.
    float lit = clamp(vH, 0.0, 1.0);
    float shade = vHollow * (1.0 - vCrest) * vFoam * fade;

    vec3 col = mix(uTrough, uFoam, clamp(foam * 1.25 + lit * 0.4, 0.0, 1.0));
    col = mix(col, uShadow, clamp(shade * 0.95, 0.0, 0.65));

    float alpha = clamp(foam * 0.95 + shade * (0.26 + uPower * 0.24), 0.0, 0.94);
    if (alpha <= 0.004) discard;
    gl_FragColor = vec4(col, alpha);
  }`;

// --- stern spray -----------------------------------------------------------

const SPRAY_MAX = 140;

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

  setSpec(power, beam) { this.power = power; this.beam = beam; }

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
    const lateral = (Math.random() - 0.5) * this.beam * 2.4;
    const o = i * 3;
    this.pos[o] = pos.x + bx * this.beam * 1.9 + nx * lateral;
    this.pos[o + 1] = CONFIG.WATER_LEVEL + 0.08;
    this.pos[o + 2] = pos.z + bz * this.beam * 1.9 + nz * lateral;

    const kick = (0.8 + Math.random() * 2.4) * (0.6 + frac * 0.9);
    // Some droplets are flung well outboard, where they read against open
    // water instead of disappearing into the white behind the transom.
    const out = (Math.random() - 0.5) * (3.0 + this.beam * 1.6);
    this.vel[o] = bx * kick + nx * out;
    this.vel[o + 1] = (1.8 + Math.random() * 2.8) * (0.62 + this.power * 0.8);
    this.vel[o + 2] = bz * kick + nz * out;

    this.life[i] = 1;
    this.decay[i] = 1 / (0.42 + Math.random() * 0.5);
    this.aSize.array[i] = (1.2 + Math.random() * 2.6) * (0.65 + this.power * 0.75);
  }

  update(dt, vessel, moving, frac) {
    if (moving) {
      // Faster and heavier hulls tear more water off the transom.
      this.emitAcc += (10 + this.power * 52) * frac * dt;
      let guard = 24;
      while (this.emitAcc >= 1 && guard-- > 0) {
        this.emitAcc -= 1;
        this.spawn(vessel, frac);
      }
      this.emitAcc = Math.min(this.emitAcc, 2);
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
    this.spray.setSpec(this.power, this.beam);
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
      x: pos.x + dx * this.beam * 1.9,
      z: pos.z + dz * this.beam * 1.9,
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

    const { position, aSide, aAge, aFoam, aDist, aWaveK, aSeed } = this.attr;
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
      }
    }

    position.needsUpdate = true;
    aSide.needsUpdate = true;
    aAge.needsUpdate = true;
    aFoam.needsUpdate = true;
    aDist.needsUpdate = true;
    aWaveK.needsUpdate = true;
    aSeed.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, (n - 1) * (COLS - 1) * 6);
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.spray.dispose();
  }
}
