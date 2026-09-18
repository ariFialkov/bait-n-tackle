// Boat wake: a real surface disturbance rather than a puff of sprites.
//
// The trail is a ribbon built from a history of where the hull has been. Each
// sample remembers the speed it was laid down at, and its half-width grows
// with age at speed * tan(19.47deg) — the Kelvin angle — so the ribbon opens
// into the correct V behind the boat all by itself, narrowing as the boat
// slows and fanning out as it accelerates.
//
// Everything else is in the shader: the two bright diverging arms along the
// edges, the transverse arcs strung between them, the prop wash boiling off
// the transom, and a trough just inside each arm so the wake reads as water
// being shoved aside rather than paint on the surface.
//
// Hull-dependent, as a wake should be:
//   * size    — beam and the skin's `wake` stat set the width and how long
//               the trail survives behind you.
//   * power   — a heavier, harder-driven hull churns whiter and noisier;
//               a little outboard just creases the surface.
// None of it touches a bet. This is paint.

import * as THREE from 'three';
import { CONFIG } from './config.js';

// 140 samples 0.8m apart caps the trail at ~112m, which is long enough that
// `life` is what ends a wake rather than the buffer running out.
const MAX_SAMPLES = 140;
const KELVIN_TAN = 0.3543;      // tan(19.47 deg) — the Kelvin half-angle
const STEP = 0.8;               // metres between trail samples
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
  uniform float uTime;
  varying float vSide;
  varying float vAge;
  varying float vFoam;
  varying float vDist;
  varying float vWaveK;
  void main() {
    vSide = aSide; vAge = aAge; vFoam = aFoam; vDist = aDist; vWaveK = aWaveK;
    vec3 p = position;
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
  uniform vec3  uTrough;   // the darker shoved-aside water
  varying float vSide;
  varying float vAge;
  varying float vFoam;
  varying float vDist;
  varying float vWaveK;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    float a = abs(vSide);
    float fade = pow(max(0.0, 1.0 - vAge), 1.3);
    if (fade <= 0.001) discard;

    // --- the two diverging arms riding the edge of the V ---
    float arm = smoothstep(0.40, 0.90, a);
    arm *= 1.0 - smoothstep(0.93, 1.0, a) * 0.65;  // soften the outer lip

    // --- transverse arcs strung between the arms, cusped toward the stern ---
    float d = vDist + a * a * 1.6;
    float tw = sin(d * vWaveK - vAge * 1.8);
    tw = smoothstep(0.25, 1.0, tw) * (1.0 - a * 0.55) * (1.0 - vAge * 0.35);

    // --- prop wash boiling off the transom (a fixed distance, not a fixed
    // fraction of the trail, so it does not stretch as the wake lengthens) ---
    float wash = smoothstep(uWashLen, 0.0, vDist) * (1.0 - smoothstep(0.3, 1.0, a));

    // --- broken-up surface, coarser and busier the harder the hull drives ---
    float n1 = noise(vec2(vDist * 1.5, vSide * 3.2) + uTime * vec2(0.5, 0.12));
    float n2 = noise(vec2(vDist * 4.6, vSide * 8.5) - uTime * vec2(1.1, 0.35));
    float grain = mix(0.7, 1.3, n1 * 0.6 + n2 * 0.4);

    float foam = (arm * 1.15 + tw * 0.65 + wash * 1.5) * vFoam * fade;
    foam *= mix(1.0, grain, 0.28 + uPower * 0.6);
    // The hull-power gate, and the whole point of the effect: a little
    // outboard creases the surface, a steamboat throws a wall of white.
    foam *= 0.30 + uPower * 1.05;
    foam = clamp(foam, 0.0, 1.8);

    // The water just inside each arm is pushed down, not whitened.
    float trough = smoothstep(0.22, 0.62, a) * (1.0 - smoothstep(0.62, 0.86, a));
    trough *= vFoam * fade;

    vec3 col = mix(uTrough, uFoam, clamp(foam * 1.15, 0.0, 1.0));
    float alpha = clamp(foam * 0.95 + trough * (0.16 + uPower * 0.22), 0.0, 0.92);
    if (alpha <= 0.004) discard;
    gl_FragColor = vec4(col, alpha);
  }`;

export class WakeTrail {
  constructor(scene) {
    this.samples = [];          // oldest first
    this.life = 3.2;
    this.beam = 1;
    this.widthScale = 1;
    this.power = 0.3;
    this.maxSpread = 7;
    this.lastX = null;
    this.lastZ = null;

    const n = MAX_SAMPLES * 2;
    const geo = new THREE.BufferGeometry();
    this.attr = {
      position: new THREE.BufferAttribute(new Float32Array(n * 3), 3),
      aSide: new THREE.BufferAttribute(new Float32Array(n), 1),
      aAge: new THREE.BufferAttribute(new Float32Array(n), 1),
      aFoam: new THREE.BufferAttribute(new Float32Array(n), 1),
      aDist: new THREE.BufferAttribute(new Float32Array(n), 1),
      aWaveK: new THREE.BufferAttribute(new Float32Array(n), 1),
    };
    for (const [name, a] of Object.entries(this.attr)) {
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
    }
    // Two vertices per sample stitched into a strip of quads.
    const idx = new Uint16Array((MAX_SAMPLES - 1) * 6);
    for (let i = 0; i < MAX_SAMPLES - 1; i++) {
      const o = i * 6, v = i * 2;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v + 1; idx[o + 4] = v + 3; idx[o + 5] = v + 2;
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
        uFoam: { value: new THREE.Color(0xffffff) },
        uTrough: { value: new THREE.Color(0x9fd3e6) },
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
  }

  /**
   * Re-tune for a hull. Displacement is what makes a wake big, so hull length
   * and beam drive both how wide the V opens and how far back it survives;
   * the skin's wake stat trims that either side of its hull's baseline. A
   * fast little skiff still cuts a long thin trail, but it cannot out-spread
   * a steamboat the way a raw Kelvin angle alone would let it.
   */
  setSpec(spec, bounds) {
    this.beam = Math.max(0.6, (bounds?.halfBeam ?? spec.length * 0.16) * 1.15);
    const wakeStat = spec.wake ?? 1;
    const size = Math.max(0.5, Math.min(2.2, (spec.length ?? 6) / 10));
    this.widthScale = (0.75 + wakeStat * 0.5);
    this.life = (5.0 + wakeStat * 2.5) * (0.75 + size * 0.45);
    this.maxSpread = (1.0 + this.beam * 1.4) * wakeStat * (0.7 + size * 0.35);
    this.power = hullPower(spec);
    this.mat.uniforms.uPower.value = this.power;
    this.mat.uniforms.uWashLen.value = 1.8 + this.beam * 1.6;
    this.reset();
  }

  reset() {
    this.samples.length = 0;
    this.lastX = this.lastZ = null;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  setVisible(on) { this.mesh.visible = on; }

  /**
   * `vessel` supplies pos/heading/speed/spec; trawling drags a wider, dirtier
   * wake because the net is tearing at the surface behind you.
   */
  update(dt, t, vessel) {
    this.mat.uniforms.uTime.value = t;

    // Age everything and retire what has dissipated.
    for (const s of this.samples) s.age += dt;
    while (this.samples.length && this.samples[0].age > this.life) this.samples.shift();

    const { pos, heading, speed } = vessel;
    const maxSpeed = vessel.spec?.maxSpeed || 8;
    const moving = speed > MIN_SPEED;

    if (moving) {
      const moved = this.lastX === null
        ? Infinity : Math.hypot(pos.x - this.lastX, pos.z - this.lastZ);
      if (moved >= STEP) {
        // The trail is laid from the transom, not the middle of the boat.
        const back = this.beam * 1.9;
        const dx = Math.sin(heading), dz = Math.cos(heading);
        const frac = Math.min(1, speed / maxSpeed);
        // Even a boat barely under way creases the surface, so the trail
        // never vanishes entirely while moving.
        let foam = Math.max(0, (frac - 0.05) / 0.95);
        foam = (0.38 + Math.pow(foam, 0.65) * 0.72) * (vessel.trawling ? 1.25 : 1);
        // Shorter waves off a slower hull; tuned for readability, not physics.
        const lambda = 2.2 + speed * 0.9;
        this.samples.push({
          x: pos.x + dx * back,
          z: pos.z + dz * back,
          dx, dz,
          speed,
          foam: Math.min(1.2, foam),
          waveK: (Math.PI * 2) / lambda,
          age: 0,
          width: this.beam * (vessel.trawling ? 1.5 : 1) * this.widthScale,
        });
        if (this.samples.length > MAX_SAMPLES) this.samples.shift();
        this.lastX = pos.x;
        this.lastZ = pos.z;
      }
    } else {
      this.lastX = this.lastZ = null;   // restart the trail when under way again
    }

    this.build();
  }

  build() {
    const n = this.samples.length;
    if (n < 2) { this.mesh.geometry.setDrawRange(0, 0); return; }

    const { position, aSide, aAge, aFoam, aDist, aWaveK } = this.attr;
    const pos = position.array;
    let dist = 0;

    // Samples run oldest -> newest; walk newest -> oldest so `dist` measures
    // metres behind the boat, which is what the wave phase wants.
    for (let k = 0; k < n; k++) {
      const s = this.samples[n - 1 - k];
      if (k > 0) {
        const p = this.samples[n - k];
        dist += Math.hypot(s.x - p.x, s.z - p.z);
      }
      // Kelvin spread: the disturbance walks outward at v*tan(19.47deg).
      const half = Math.min(
        s.width * 0.55 + s.speed * KELVIN_TAN * s.age,
        s.width * 0.55 + this.maxSpread);
      // Perpendicular to the heading it was laid down on.
      const nx = -s.dz, nz = s.dx;
      const o = k * 2;
      pos[o * 3] = s.x - nx * half;
      pos[o * 3 + 1] = 0;
      pos[o * 3 + 2] = s.z - nz * half;
      pos[o * 3 + 3] = s.x + nx * half;
      pos[o * 3 + 4] = 0;
      pos[o * 3 + 5] = s.z + nz * half;

      const age = Math.min(1, s.age / this.life);
      aSide.array[o] = -1; aSide.array[o + 1] = 1;
      aAge.array[o] = aAge.array[o + 1] = age;
      aFoam.array[o] = aFoam.array[o + 1] = s.foam;
      aDist.array[o] = aDist.array[o + 1] = dist;
      aWaveK.array[o] = aWaveK.array[o + 1] = s.waveK;
    }

    position.needsUpdate = true;
    aSide.needsUpdate = true;
    aAge.needsUpdate = true;
    aFoam.needsUpdate = true;
    aDist.needsUpdate = true;
    aWaveK.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, (n - 1) * 6);
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
