// Funnel smoke for the steam hulls.
//
// Built the way the wake is: the puffs live in WORLD space, not on the boat,
// so the plume is laid down behind the ship as it moves and hangs there while
// it dissolves — drive a circle and the smoke reads the circle back to you.
// Each puff leaves the stack with the ship's own way on it, rises on its own
// buoyancy, is pushed about by a light breeze and a little curl of
// turbulence, and swells as it entrains air until there is nothing left of
// it. The shape is eaten away by noise rather than faded out as a clean disc,
// which is what stops a plume looking like a row of grey dots.
//
// Colour follows the fire: soot-dark and dense when the engine is working,
// thin and pale when it is only ticking over.

import * as THREE from 'three';

const MAX_PUFFS = 340;
const WIND = { x: 0.85, z: -0.55 };     // the lake's light prevailing breeze

const VERT = /* glsl */`
  attribute float aLife;
  attribute float aSize;
  attribute float aSeed;
  attribute float aSoot;
  uniform float uScreen;
  varying float vLife;
  varying float vSeed;
  varying float vSoot;
  void main() {
    vLife = aLife; vSeed = aSeed; vSoot = aSoot;
    float age = 1.0 - aLife;
    // A puff swells as it entrains air — most of the growth early on.
    float size = aSize * (0.75 + 2.7 * sqrt(max(age, 0.0)));
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * projectionMatrix[1][1] * uScreen * 0.5 / max(0.5, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = /* glsl */`
  precision mediump float;
  uniform vec3 uSoot;
  uniform vec3 uSteam;
  varying float vLife;
  varying float vSeed;
  varying float vSoot;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 3; i++) { s += a * noise(p); p *= 2.07; a *= 0.5; }
    return s;
  }

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float age = 1.0 - vLife;

    // Every puff turns its own way and boils slowly, so no two share a
    // silhouette and none of them look like a sprite.
    float a = vSeed * 6.2831;
    mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
    float n = fbm(rot * c * 3.6 + vec2(vSeed * 41.0, -age * 1.1));

    float core = 1.0 - smoothstep(0.10, 0.50, d);
    // The edge is chewed away, and the older and thinner the puff the more
    // of it goes — it comes apart into wisps instead of dimming.
    float erode = (n - 0.34) * (0.55 + age * 1.5) * smoothstep(0.0, 0.42, d);
    float alpha = clamp(core - max(erode, 0.0), 0.0, 1.0);
    alpha *= smoothstep(0.0, 0.22, vLife);
    alpha *= mix(0.62, 0.10, age) * (0.55 + vSoot * 0.6);
    if (alpha < 0.012) discard;

    vec3 col = mix(uSoot, uSteam, clamp(age * 1.25 + (1.0 - vSoot) * 0.55, 0.0, 1.0));
    gl_FragColor = vec4(col, alpha);
  }`;

export class Stacks {
  constructor(scene) {
    this.pos = new Float32Array(MAX_PUFFS * 3).fill(9999);
    this.vel = new Float32Array(MAX_PUFFS * 3);
    this.life = new Float32Array(MAX_PUFFS);
    this.decay = new Float32Array(MAX_PUFFS);
    this.spin = new Float32Array(MAX_PUFFS);
    this.next = 0;
    this.emitAcc = 0;
    this.stacks = [];
    this.scale = 1;

    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aLife = new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(MAX_PUFFS), 1).setUsage(THREE.DynamicDrawUsage);
    this.aSeed = new THREE.BufferAttribute(new Float32Array(MAX_PUFFS), 1).setUsage(THREE.DynamicDrawUsage);
    this.aSoot = new THREE.BufferAttribute(new Float32Array(MAX_PUFFS), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aLife', this.aLife);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aSeed', this.aSeed);
    geo.setAttribute('aSoot', this.aSoot);

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uSoot: { value: new THREE.Color(0x4c4a52) },
        uSteam: { value: new THREE.Color(0xdfe7ec) },
        uScreen: { value: 900 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.visible = false;
    scene.add(this.points);

    this._v = new THREE.Vector3();
  }

  /**
   * Which funnels this hull has. `stacks` are [{ x, y, z, r }] in the hull's
   * own space — the mouth of each chimney and how wide it is.
   */
  setStacks(stacks, scale = 1) {
    this.stacks = stacks || [];
    this.scale = scale;
    this.reset();
    this.points.visible = this.stacks.length > 0;
  }

  reset() {
    this.life.fill(0);
    this.pos.fill(9999);
    this.emitAcc = 0;
    this.aPos.needsUpdate = true;
    this.aLife.needsUpdate = true;
  }

  spawn(boat, stack, draw) {
    const i = this.next = (this.next + 1) % MAX_PUFFS;
    const o = i * 3;
    const r = stack.r * this.scale;

    // Mouth of the funnel, in the world.
    this._v.set(stack.x, stack.y, stack.z).multiplyScalar(this.scale);
    (boat.hullFrame || boat.group).localToWorld(this._v);
    this.pos[o] = this._v.x + (Math.random() - 0.5) * r;
    this.pos[o + 1] = this._v.y + r * 0.3;
    this.pos[o + 2] = this._v.z + (Math.random() - 0.5) * r;

    // It leaves with most of the ship's way still on it, then the air takes
    // it: that lag is what curls the plume off the stack instead of pinning
    // it there.
    const lift = (1.9 + Math.random() * 1.7) * (0.55 + draw * 0.85);
    this.vel[o] = boat.vel.x * 0.82 + (Math.random() - 0.5) * 0.7;
    this.vel[o + 1] = lift;
    this.vel[o + 2] = boat.vel.z * 0.82 + (Math.random() - 0.5) * 0.7;

    this.life[i] = 1;
    this.decay[i] = 1 / (2.5 + Math.random() * 2.1);
    this.spin[i] = (Math.random() - 0.5) * 1.6;
    this.aSize.array[i] = r * (1.15 + Math.random() * 0.8);
    this.aSeed.array[i] = Math.random();
    this.aSoot.array[i] = Math.min(1, 0.25 + draw * 0.85);
  }

  /** `boat` needs { group, vel, speed, throttle, spec }. */
  update(dt, t, boat) {
    if (!this.stacks.length) return;
    const h = window.innerHeight || 900;
    if (this.mat.uniforms.uScreen.value !== h) this.mat.uniforms.uScreen.value = h;

    // How hard the engine is working: throttle first, with the way the hull
    // already has on it counting for some of it, and never quite nothing —
    // a banked fire still breathes.
    const draw = Math.min(1, Math.max(boat.throttle || 0,
      (boat.speed || 0) / Math.max(1, boat.spec.maxSpeed) * 0.75));
    this.emitAcc += (6 + draw * 17) * this.stacks.length * dt;
    let guard = 24;
    while (this.emitAcc >= 1 && guard-- > 0) {
      this.emitAcc -= 1;
      this.spawn(boat, this.stacks[(Math.random() * this.stacks.length) | 0], draw);
    }
    this.emitAcc = Math.min(this.emitAcc, 3);

    let any = false;
    for (let i = 0; i < MAX_PUFFS; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      const o = i * 3;
      const age = 1 - this.life[i];
      this.life[i] -= this.decay[i] * dt;

      // Buoyancy fades as the gas cools and mixes; drag pulls whatever is
      // left toward the breeze; a slow curl keeps the column from being a
      // straight line.
      this.vel[o + 1] += (2.4 * (1 - age) - this.vel[o + 1] * 0.55) * dt;
      const swirl = this.spin[i];
      const px = this.pos[o], pz = this.pos[o + 2];
      const curl = Math.sin(px * 0.19 + t * 0.6) * Math.cos(pz * 0.17 - t * 0.5);
      this.vel[o] += ((WIND.x + curl * swirl) - this.vel[o]) * 1.1 * dt;
      this.vel[o + 2] += ((WIND.z - curl * swirl) - this.vel[o + 2]) * 1.1 * dt;

      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.life[i] <= 0) {
        this.life[i] = 0;
        this.pos[o] = this.pos[o + 1] = this.pos[o + 2] = 9999;
      }
    }
    this.points.visible = any;
    this.aPos.needsUpdate = true;
    this.aLife.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aSeed.needsUpdate = true;
    this.aSoot.needsUpdate = true;
  }

  dispose() {
    this.points.parent?.remove(this.points);
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}
