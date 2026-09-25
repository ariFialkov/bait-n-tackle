// Moving water. Every carved channel — a river, a creek, the braids of a
// delta, the trench through a lake — carries a current along it, seaward
// (more or less: a slow potential wanders the way), and where warm water
// meets cold an eddy runs along the boundary through deep water. Through a
// rapid the strait narrows and the same current runs hard. A hull in it is
// carried: it can turn out, and it can fight the stream, but it is work.
// The flow is drawn as streaks on the surface that ride it, so you can see
// where it runs before you are in it.
//
// It moves the boat; it never touches a bet.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { fbm, clamp } from './noise.js';
import { channelField, waterDepth } from './terrain.js';
import { regionAt, temperature } from './regions.js';

const S = CONFIG.SEED;

function ss(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Which way is "downstream": toward the sea, wandering with the country. */
function potential(x, z) {
  return x + 320 * fbm(x * 0.0012 + 4.4, z * 0.0012 - 1.7, 2, S + 909);
}

/**
 * The current at a point, m/s, into `out` {x, z}. The channel flow runs
 * along the channel ridge (the tangent of its field), oriented down the
 * potential; the eddy runs along the temperature contour.
 */
export function currentAt(x, z, out) {
  out.x = 0; out.z = 0;
  const d = waterDepth(x, z);
  if (d < 0.25) return out;
  const r = regionAt(x, z);
  const th = r.biome.terrain.channelW;

  // --- the channel flow ---
  const c = channelField(x, z);
  let vx = 0, vz = 0;
  // The stream runs down the channel's core: a rapid's whole strait, the
  // middle of a river, and only the deepest line of a lake's trench.
  const running = r.type === 'river' || r.type === 'beaver' || r.type === 'delta';
  const inChannel = r.type === 'rapids' ? ss(th - 0.03, th + 0.05, c)
    : running ? ss(0.945, 0.975, c) : ss(0.975, 0.99, c);
  if (inChannel > 0) {
    const e = 3;
    const gx = channelField(x + e, z) - channelField(x - e, z);
    const gz = channelField(x, z + e) - channelField(x, z - e);
    const g = Math.hypot(gx, gz);
    if (g > 1e-5) {
      let tx = -gz / g, tz = gx / g;           // along the ridge
      const px = potential(x + e, z) - potential(x - e, z);
      const pz = potential(x, z + e) - potential(x, z - e);
      const pl = Math.hypot(px, pz) || 1;
      const down = (tx * px + tz * pz) / pl;    // how much of the channel runs down the potential
      if (down > 0) { tx = -tx; tz = -tz; }   // downhill of the potential
      // Where a channel turns across the potential the stream would flip
      // sign: it slackens through the turn instead of snapping round.
      const turn = ss(0.05, 0.35, Math.abs(down));
      const speed = r.type === 'rapids' ? 6.0 : running ? 1.5 : 0.8;
      // Shallows drag it, and a rapid runs hardest where the strait is thin.
      const depthK = ss(0.25, 1.2, d) * (r.type === 'rapids' ? (0.6 + 0.4 * ss(9, 2.5, d)) : 1);
      const k = speed * inChannel * depthK * (r.type === 'rapids' ? Math.max(0.5, turn) : turn);
      vx += tx * k; vz += tz * k;
    }
  }

  // --- the eddy: where warm turns to cold, through deep water ---
  const t = temperature(x, z);
  const band = ss(0.055, 0.015, Math.abs(t)) * ss(3.5, 6, d);
  if (band > 0) {
    const e = 6;
    const gx = temperature(x + e, z) - temperature(x - e, z);
    const gz = temperature(x, z + e) - temperature(x, z - e);
    const g = Math.hypot(gx, gz);
    if (g > 1e-6) {
      vx += (-gz / g) * 1.3 * band; vz += (gx / g) * 1.3 * band;
    }
  }
  out.x = vx; out.z = vz;
  return out;
}

// --- drawing it -------------------------------------------------------------

const N = 520;          // streaks on the surface
const RANGE = 130;      // metres round the boat they live in

// The streaks read the current off a 4 m lattice, each point worked out
// once and kept (some forty noise reads a point), and blend between the
// four round them. Five hundred streaks asking the field itself every
// frame were a fifth of the whole update. The hulls still ask the field.
const LAT = 4;
const latCache = new Map();
let latPool = new Float32Array(2 * 8192), latN = 0;
let latMisses = 0;             // fresh lattice points worked out this frame (capped: see update)
const LAT_MISS_MAX = 40;
const _lv = { x: 0, z: 0 };
function latIndex(ix, iz) {
  const k = (ix + 100000) * 400003 + (iz + 100000);
  let i = latCache.get(k);
  if (i === undefined) {
    if (++latMisses > LAT_MISS_MAX) return -1;
    if (latCache.size > 60000) { latCache.clear(); latN = 0; }
    if (latN * 2 + 2 > latPool.length) { const p = new Float32Array(latPool.length * 2); p.set(latPool); latPool = p; }
    currentAt(ix * LAT, iz * LAT, _lv);
    i = latN++;
    latPool[i * 2] = _lv.x; latPool[i * 2 + 1] = _lv.z;
    latCache.set(k, i);
  }
  return i;
}
function currentLattice(x, z, out) {
  const fx = x / LAT, fz = z / LAT;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const a = latIndex(ix, iz) * 2, b = latIndex(ix + 1, iz) * 2, c = latIndex(ix, iz + 1) * 2, d = latIndex(ix + 1, iz + 1) * 2;
  // Over this frame's allowance of fresh points: no current here for now.
  if (a < 0 || b < 0 || c < 0 || d < 0) { out.x = out.z = 0; return out; }
  const P = latPool;
  out.x = (P[a] * (1 - tx) + P[b] * tx) * (1 - tz) + (P[c] * (1 - tx) + P[d] * tx) * tz;
  out.z = (P[a + 1] * (1 - tx) + P[b + 1] * tx) * (1 - tz) + (P[c + 1] * (1 - tx) + P[d + 1] * tx) * tz;
  return out;
}

/** Streaks that ride the current, so the flow can be seen. */
export class FlowField {
  constructor(scene) {
    this.pos = new Float32Array(N * 2 * 3);
    this.col = new Float32Array(N * 2 * 3);
    this.px = new Float32Array(N);
    this.pz = new Float32Array(N);
    this.life = new Float32Array(N);
    this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3);
    this.aCol = new THREE.BufferAttribute(this.col, 3);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('color', this.aCol);
    this.mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false });
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
    scene.add(this.lines);
    this.focus = { x: 0, z: 0 };
    this.v = { x: 0, z: 0 };
    this.tick = 0;
    for (let i = 0; i < N; i++) this.life[i] = -1;
  }

  /** Drop a streak somewhere in range where the water is moving. */
  respawn(i) {
    for (let k = 0; k < 6; k++) {
      const x = this.focus.x + (Math.random() - 0.5) * 2 * RANGE;
      const z = this.focus.z + (Math.random() - 0.5) * 2 * RANGE;
      currentLattice(x, z, this.v);
      if (Math.hypot(this.v.x, this.v.z) > 0.15) {
        this.px[i] = x; this.pz[i] = z; this.life[i] = 4 + Math.random() * 6;
        return true;
      }
    }
    this.life[i] = -0.5 - Math.random();   // nothing here: try again in a moment
    return false;
  }

  update(dt, focusX, focusZ, t) {
    this.focus.x = focusX; this.focus.z = focusZ;
    this.tick++;
    latMisses = 0;   // a frame works out only so many fresh lattice points; the rest wait
    const y = CONFIG.WATER_LEVEL + 0.09;
    for (let i = 0; i < N; i++) {
      // Half the streaks step each frame: the field costs a few noise reads.
      if ((i + this.tick) % 2) continue;
      const dt2 = dt * 2;
      let alive = this.life[i] > 0;
      if (!alive) {
        this.life[i] += dt2;
        if (this.life[i] < 0 || !this.respawn(i)) { this.hide(i); continue; }
      }
      const v = currentLattice(this.px[i], this.pz[i], this.v);
      const sp = Math.hypot(v.x, v.z);
      this.life[i] -= dt2;
      if (sp < 0.08 || this.life[i] <= 0 || Math.abs(this.px[i] - focusX) > RANGE || Math.abs(this.pz[i] - focusZ) > RANGE) {
        this.life[i] = -0.2; this.hide(i); continue;
      }
      this.px[i] += v.x * dt2; this.pz[i] += v.z * dt2;
      const len = 0.6 + sp * 0.7;
      const ux = v.x / sp, uz = v.z / sp;
      const o = i * 6;
      const wob = Math.sin(t * 2.1 + i) * 0.03;
      this.pos[o] = this.px[i]; this.pos[o + 1] = y + wob; this.pos[o + 2] = this.pz[i];
      this.pos[o + 3] = this.px[i] - ux * len; this.pos[o + 4] = y + wob; this.pos[o + 5] = this.pz[i] - uz * len;
      // Brighter the faster, and fading in and out over its life.
      const fade = Math.min(1, this.life[i] / 1.2, (10 - this.life[i]) / 1.2);
      const b = clamp((0.35 + sp * 0.25) * fade, 0, 1);
      this.col[o] = b; this.col[o + 1] = b; this.col[o + 2] = b;
      this.col[o + 3] = b * 0.25; this.col[o + 4] = b * 0.25; this.col[o + 5] = b * 0.25;
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
  }

  hide(i) {
    const o = i * 6;
    for (let k = 0; k < 6; k++) { this.pos[o + k] = 0; this.col[o + k] = 0; }
    this.pos[o + 1] = this.pos[o + 4] = -50;
  }
}
