// What dresses the country: the prefabs a chunk's biomes strew over it
// (scatter.js decides where; this draws them) — pines and snow pines, reeds
// and cattails, lily pads, logs and sticks, mangroves on their prop roots,
// palms, boulders, driftwood — and the built features that terrain.js
// placed: waterfalls with their splash, their rocks and the river that
// feeds them; the boulders of a rapid and the white water tearing off
// them; beaver dams and lodges; sea stacks. The soft props bend out of a
// hull's way and spring back. All of it is scenery: none of it touches a
// bet.

import * as THREE from 'three';
import { mulberry32, clamp } from './noise.js';
import { CONFIG } from './config.js';
import { terrainHeight, baseHeight } from './terrain.js';
import { chunkItems } from './scatter.js';
import { currentAt } from './currents.js';

// --- geometry -------------------------------------------------------------------

function mergeGeoms(geoms) {
  const parts = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const norm = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    norm.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  return out;
}

function makeCanopyGeo() {
  const c1 = new THREE.ConeGeometry(1.35, 1.7, 7); c1.translate(0, 0.85, 0);
  const c2 = new THREE.ConeGeometry(1.05, 1.5, 7); c2.translate(0, 1.75, 0);
  const c3 = new THREE.ConeGeometry(0.68, 1.25, 7); c3.translate(0, 2.6, 0);
  return mergeGeoms([c1, c2, c3]);
}

function makeCattailGeo() {
  const stem = new THREE.ConeGeometry(0.035, 1.7, 5); stem.translate(0, 0.85, 0);
  const head = new THREE.CylinderGeometry(0.06, 0.06, 0.38, 6); head.translate(0, 1.45, 0);
  return mergeGeoms([stem, head]);
}

function makeLilyGeo() {
  const g = new THREE.CircleGeometry(0.42, 11, 0.35, Math.PI * 2 - 0.7);
  g.rotateX(-Math.PI / 2);
  return g;
}

function makeMangroveWoodGeo() {
  const trunk = new THREE.CylinderGeometry(0.13, 0.18, 1.9, 6); trunk.translate(0, 2.05, 0);
  const parts = [trunk];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + 0.3;
    const root = new THREE.CylinderGeometry(0.045, 0.07, 1.9, 5);
    const dir = new THREE.Vector3(Math.cos(ang) * 0.95, -1.4, Math.sin(ang) * 0.95).normalize();
    q.setFromUnitVectors(up, dir);
    m.compose(new THREE.Vector3(Math.cos(ang) * 0.47, 0.72, Math.sin(ang) * 0.47), q, new THREE.Vector3(1, 1, 1));
    root.applyMatrix4(m);
    parts.push(root);
  }
  return mergeGeoms(parts);
}

function makeMangroveCanopyGeo() {
  const g = new THREE.IcosahedronGeometry(1.15, 1);
  g.scale(1.35, 0.72, 1.35);
  g.translate(0, 3.3, 0);
  return g;
}

function makePalmTrunkGeo() {
  const g = new THREE.CylinderGeometry(0.11, 0.2, 5.2, 6);
  g.translate(0, 2.6, 0);
  g.rotateZ(0.16);
  return g;
}

function makePalmFrondGeo() {
  const parts = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * Math.PI * 2;
    const f = new THREE.ConeGeometry(0.38, 2.7, 4);
    f.scale(1, 1, 0.22);
    f.translate(0, -1.35, 0);
    const dir = new THREE.Vector3(Math.cos(ang) * 0.85, -0.55, Math.sin(ang) * 0.85).normalize();
    q.setFromUnitVectors(up, dir.negate());
    m.compose(new THREE.Vector3(Math.cos(ang) * 0.2, 5.1, Math.sin(ang) * 0.2), q, new THREE.Vector3(1, 1, 1));
    f.applyMatrix4(m);
    parts.push(f);
  }
  const crown = new THREE.SphereGeometry(0.3, 6, 5); crown.translate(0, 5.1, 0);
  parts.push(crown);
  const out = mergeGeoms(parts);
  out.rotateZ(0.16);
  return out;
}

const GEO = {
  canopy: makeCanopyGeo(),
  trunk: new THREE.CylinderGeometry(0.14, 0.22, 1.3, 6),
  rock: new THREE.IcosahedronGeometry(0.55, 0),
  boulder: new THREE.IcosahedronGeometry(1, 1),
  reed: (() => { const g = new THREE.ConeGeometry(0.035, 1.5, 5); g.translate(0, 0.75, 0); return g; })(),
  cattail: makeCattailGeo(),
  lily: makeLilyGeo(),
  flower: (() => { const g = new THREE.ConeGeometry(0.12, 0.22, 6); g.translate(0, 0.12, 0); return g; })(),
  log: (() => { const g = new THREE.CylinderGeometry(0.22, 0.28, 3.2, 7); g.rotateZ(Math.PI / 2); return g; })(),
  stick: (() => { const g = new THREE.CylinderGeometry(0.03, 0.045, 1.2, 4); g.rotateZ(Math.PI / 2); return g; })(),
  mangroveWood: makeMangroveWoodGeo(),
  mangroveCanopy: makeMangroveCanopyGeo(),
  palmTrunk: makePalmTrunkGeo(),
  palmFrond: makePalmFrondGeo(),
};

export const MATS = {
  canopy: new THREE.MeshLambertMaterial({ color: 0x2f6b38 }),
  snowCanopy: new THREE.MeshLambertMaterial({ color: 0x9fb8a8 }),
  trunk: new THREE.MeshLambertMaterial({ color: 0x6b4a2f }),
  rock: new THREE.MeshLambertMaterial({ color: 0x8b8f88, flatShading: true }),
  boulder: new THREE.MeshLambertMaterial({ color: 0x7d8280, flatShading: true }),
  reed: new THREE.MeshLambertMaterial({ color: 0x9aa860 }),
  cattail: new THREE.MeshLambertMaterial({ color: 0x8a7a48 }),
  lily: new THREE.MeshLambertMaterial({ color: 0x4d8a3c, side: THREE.DoubleSide }),
  flower: new THREE.MeshLambertMaterial({ color: 0xf2b6c8 }),
  log: new THREE.MeshLambertMaterial({ color: 0x5e4630 }),
  driftwood: new THREE.MeshLambertMaterial({ color: 0xb9ae97 }),
  damlog: new THREE.MeshLambertMaterial({ color: 0x74563a }),
  stick: new THREE.MeshLambertMaterial({ color: 0x8a6a48 }),
  mangroveWood: new THREE.MeshLambertMaterial({ color: 0x5a4632 }),
  mangroveCanopy: new THREE.MeshLambertMaterial({ color: 0x3f7f45 }),
  palmTrunk: new THREE.MeshLambertMaterial({ color: 0x8a6d47 }),
  palmFrond: new THREE.MeshLambertMaterial({ color: 0x4f9a3f, side: THREE.DoubleSide }),
  stack: new THREE.MeshLambertMaterial({ color: 0x6f7674, flatShading: true }),
  splash: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _e = new THREE.Euler(), _ax = new THREE.Vector3();
const AXIS_Y = new THREE.Vector3(0, 1, 0);

function instance(geo, mat, items, parent, place, shadow = true) {
  if (!items.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  im.castShadow = shadow;
  items.forEach((it, i) => { place(it, _m); im.setMatrixAt(i, _m); });
  im.instanceMatrix.needsUpdate = true;
  parent.add(im);
  return im;
}

const upright = (x, y, z, s, r, m) => {
  _q.setFromAxisAngle(AXIS_Y, r); _s.setScalar(s); _p.set(x, y, z);
  return m.compose(_p, _q, _s);
};
const lying = (x, y, z, s, r, tilt, m) => {
  _q.setFromEuler(_e.set(tilt, r, 0)); _s.setScalar(s); _p.set(x, y, z);
  return m.compose(_p, _q, _s);
};

// --- the chunk's props ------------------------------------------------------------

/**
 * Draw a chunk's props. Returns { meshes, brush }: the instanced meshes for
 * disposal, and the soft ones with what they need to bend.
 */
export function buildChunkProps(cx, cz, parent) {
  const { L } = chunkItems(cx, cz);
  const out = [];
  const brush = [];
  const add = (im) => { if (im) out.push(im); return im; };
  const WL = CONFIG.WATER_LEVEL;
  for (const [key, mat] of [['pine', MATS.canopy], ['snowpine', MATS.snowCanopy]]) {
    const list = L[key];
    add(instance(GEO.canopy, mat, list, parent, (t, m) => upright(t.x, t.h + 0.75 * t.s, t.z, t.s, t.r, m)));
    add(instance(GEO.trunk, MATS.trunk, list, parent, (t, m) => upright(t.x, t.h + 0.5 * t.s, t.z, t.s, t.r, m)));
  }
  add(instance(GEO.rock, MATS.rock, L.rock, parent, (t, m) => {
    _q.setFromAxisAngle(AXIS_Y, t.r); _s.set(t.s, t.s * 0.8, t.s); _p.set(t.x, t.h + 0.1, t.z); return m.compose(_p, _q, _s);
  }));
  add(instance(GEO.boulder, MATS.boulder, L.boulder, parent, (t, m) => {
    _q.setFromEuler(_e.set(t.r * 0.3, t.r, 0)); _s.set(t.s, t.s * 0.75, t.s * 0.9); _p.set(t.x, t.h + t.s * 0.35, t.z); return m.compose(_p, _q, _s);
  }));
  const reedPlace = (t, m) => lying(t.x, Math.max(t.h, WL - 0.3), t.z, t.s, t.r, t.lean, m);
  const reeds = add(instance(GEO.reed, MATS.reed, L.reed, parent, reedPlace, false));
  if (reeds) brush.push({ im: reeds, items: L.reed, kind: 'stem', state: new Float32Array(L.reed.length * 4), place: reedPlace });
  const tails = add(instance(GEO.cattail, MATS.cattail, L.cattail, parent, reedPlace, false));
  if (tails) brush.push({ im: tails, items: L.cattail, kind: 'stem', state: new Float32Array(L.cattail.length * 4), place: reedPlace });
  const lilyPlace = (t, m) => upright(t.x, WL + 0.03, t.z, t.s, t.r, m);
  const lilies = add(instance(GEO.lily, MATS.lily, L.lily, parent, lilyPlace, false));
  if (lilies) brush.push({ im: lilies, items: L.lily, kind: 'pad', state: new Float32Array(L.lily.length * 4), place: lilyPlace });
  add(instance(GEO.flower, MATS.flower, L.flower, parent, (t, m) => upright(t.x, WL + 0.04, t.z, t.s, 0, m), false));
  add(instance(GEO.log, MATS.log, L.log, parent, (t, m) => lying(t.x, Math.max(t.h + 0.2, WL - 0.12), t.z, t.s, t.r, 0.05, m)));
  add(instance(GEO.log, MATS.driftwood, L.driftwood, parent, (t, m) => lying(t.x, t.h + 0.2 * t.s, t.z, t.s, t.r, 0.08, m)));
  add(instance(GEO.stick, MATS.stick, L.stick, parent, (t, m) => lying(t.x, WL + 0.01, t.z, t.s, t.r, 0, m), false));
  add(instance(GEO.mangroveWood, MATS.mangroveWood, L.mangrove, parent, (t, m) => upright(t.x, t.h - 0.1, t.z, t.s, t.r, m)));
  add(instance(GEO.mangroveCanopy, MATS.mangroveCanopy, L.mangrove, parent, (t, m) => upright(t.x, t.h - 0.1, t.z, t.s, t.r, m)));
  add(instance(GEO.palmTrunk, MATS.palmTrunk, L.palm, parent, (t, m) => upright(t.x, t.h, t.z, t.s, t.r, m)));
  add(instance(GEO.palmFrond, MATS.palmFrond, L.palm, parent, (t, m) => upright(t.x, t.h, t.z, t.s, t.r, m)));
  return { meshes: out, brush };
}

// --- brushing through the soft props ----------------------------------------------------

const BRUSH_K = 26, BRUSH_D = 6.5;

/**
 * Bend the reeds, cattails and lily pads a hull is passing through away
 * from it, on a spring that brings them back. `vessels` are hulls with
 * pos, heading and hullBounds; `brush` is a chunk's list from
 * buildChunkProps. Cheap: only the items within reach of a hull, and the
 * ones still swinging back, are touched.
 */
export function updateBrush(brush, vessels, dt) {
  let any = false;
  for (const b of brush) {
    const { items, state, im, kind, place } = b;
    let dirty = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      // The push: from the nearest point of any hull's centreline, out.
      let tx = 0, tz = 0;
      for (const v of vessels) {
        const half = (v.hullBounds?.length ?? 5) / 2, beam = v.hullBounds?.halfBeam ?? 1;
        const fx = -Math.sin(v.heading), fz = -Math.cos(v.heading);
        let dx = it.x - v.pos.x, dz = it.z - v.pos.z;
        if (Math.abs(dx) > half + 4 || Math.abs(dz) > half + 4) continue;
        let a = dx * fx + dz * fz;
        a = a < -half ? -half : a > half ? half : a;
        dx -= fx * a; dz -= fz * a;
        const d = Math.hypot(dx, dz), reach = beam + 1.6;
        if (d >= reach) continue;
        const k = 1 - d / reach;
        if (d > 1e-3) { tx += dx / d * k; tz += dz / d * k; }
        else { tx += -fz * k; tz += fx * k; }
      }
      const o = i * 4;
      let lx = state[o], lz = state[o + 1], vx = state[o + 2], vz = state[o + 3];
      if (!tx && !tz && !lx && !lz && !vx && !vz) continue;
      const tl = Math.hypot(tx, tz);
      if (tl > 1) { tx /= tl; tz /= tl; }
      vx += ((tx - lx) * BRUSH_K - vx * BRUSH_D) * dt;
      vz += ((tz - lz) * BRUSH_K - vz * BRUSH_D) * dt;
      lx += vx * dt; lz += vz * dt;
      if (!tx && !tz && Math.abs(lx) + Math.abs(lz) + Math.abs(vx) + Math.abs(vz) < 0.004) { lx = lz = vx = vz = 0; }
      state[o] = lx; state[o + 1] = lz; state[o + 2] = vx; state[o + 3] = vz;
      // Rebuild this instance: the resting matrix, then the bend.
      place(it, _m);
      const amt = Math.hypot(lx, lz);
      if (amt > 1e-4) {
        if (kind === 'stem') {
          // Tilt the stem over, away from the hull, about a horizontal axis.
          _m.decompose(_p, _q, _s);
          _ax.set(lz / amt, 0, -lx / amt);
          _q2.setFromAxisAngle(_ax, Math.min(1.25, amt * 1.2));
          _q.premultiply(_q2);
          _m.compose(_p, _q, _s);
        } else {
          // A pad slides aside a little and turns.
          _m.decompose(_p, _q, _s);
          _p.x += lx * 0.9; _p.z += lz * 0.9;
          _q2.setFromAxisAngle(AXIS_Y, amt * 0.9);
          _q.premultiply(_q2);
          _m.compose(_p, _q, _s);
        }
      }
      im.setMatrixAt(i, _m);
      dirty = true;
    }
    if (dirty) { im.instanceMatrix.needsUpdate = true; any = true; }
  }
  return any;   // something is still swinging: keep coming back
}

// --- built features ------------------------------------------------------------------

// A cheap value noise for the water effects.
const GLSL_NOISE = /* glsl */`
  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i), b = hash21(i + vec2(1, 0)), c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }`;

function fallsMaterial(speed, alpha) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uSpeed: { value: speed }, uAlpha: { value: alpha } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uSpeed, uAlpha; varying vec2 vUv; ${GLSL_NOISE}
      void main() {
        float fall = vUv.y;                              // 1 at the lip, 0 at the water
        float t = uTime * uSpeed;
        // Ropes of water: narrow vertical streaks racing down, breaking up as they go.
        float rope = vnoise(vec2(vUv.x * 11.0, vUv.y * 3.0 + t * 1.9));
        float rope2 = vnoise(vec2(vUv.x * 27.0 + 5.0, vUv.y * 7.0 + t * 3.1));
        float fine = vnoise(vec2(vUv.x * 60.0, vUv.y * 18.0 + t * 5.0));
        float white = smoothstep(0.3, 0.75, rope * 0.55 + rope2 * 0.45 + fine * 0.15);
        // Glassy and green-blue over the lip, all froth by the foot.
        float froth = smoothstep(0.6, 0.0, fall);
        vec3 glass = vec3(0.55, 0.8, 0.86);
        vec3 col = mix(glass, vec3(1.0), clamp(white * 0.85 + froth * 0.55, 0.0, 1.0));
        float edge = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
        float alpha = uAlpha * (0.55 + white * 0.4 + froth * 0.35) * edge;
        gl_FragColor = vec4(col, min(alpha, 0.97));
      }`,
  });
}
const FALLS_BACK = fallsMaterial(1.0, 0.85);
const FALLS_FRONT = fallsMaterial(1.45, 0.6);

// The river above the falls and the white water off a rapid's boulders:
// streaks that flow along the surface (uv.x runs downstream).
const FLOW_MAT = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec2 vUv; attribute float phase; varying float vPhase;
    void main() { vUv = uv; vPhase = phase; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform float uTime; varying vec2 vUv; varying float vPhase; ${GLSL_NOISE}
    void main() {
      float n = vnoise(vec2(vUv.x * 6.0 - uTime * 2.1 + vPhase * 7.0, vUv.y * 3.5 + vPhase));
      float n2 = vnoise(vec2(vUv.x * 15.0 - uTime * 3.4, vUv.y * 8.0 + vPhase * 3.0));
      float white = smoothstep(0.3, 0.62, n * 0.6 + n2 * 0.5);
      float shape = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.72, vUv.x) * smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.78, vUv.y);
      vec3 col = mix(vec3(0.62, 0.85, 0.92), vec3(1.0), white);
      gl_FragColor = vec4(col, (0.3 + white * 0.7) * shape * 0.95);
    }`,
});

let mistTex = null;
function mistTexture() {
  if (mistTex) return mistTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  mistTex = new THREE.CanvasTexture(c);
  return mistTex;
}

const RING_GEO = new THREE.RingGeometry(0.9, 1.0, 28);
RING_GEO.rotateX(-Math.PI / 2);

/** Concatenate flat quads (with phases) into one mesh of FLOW_MAT. */
function flowMesh(geos, parent) {
  if (!geos.length) return null;
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), uv = new Float32Array(total * 2), ph = new Float32Array(total);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); uv.set(g.attributes.uv.array, o * 2); ph.set(g.attributes.phase.array, o);
    o += g.attributes.position.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
  const mesh = new THREE.Mesh(geo, FLOW_MAT);
  mesh.renderOrder = 4;
  mesh.frustumCulled = false;
  parent.add(mesh);
  return { mesh, dispose() { parent.remove(mesh); geo.dispose(); } };
}

/**
 * A waterfall: two curved sheets of water pouring off the lip, a boil of
 * spray and foam where they land, boulders framing the lip and the foot,
 * and the river that feeds it running down the gully above.
 */
export function buildFalls(f, parent) {
  const g = new THREE.Group();
  const rng = mulberry32(f.seed);
  const top = Math.max(2.5, terrainHeight(f.x + f.nx * 4.0, f.z + f.nz * 4.0) + 0.1);
  const facing = Math.atan2(-f.nx, -f.nz);   // out over the water
  const px = f.nz, pz = -f.nx;               // across the falls
  const H = top + 0.6;

  // The sheets: a plane bent so the water is thrown out as it falls and
  // curls over the lip, the back one thicker and slower than the front.
  const sheet = (offset, mat) => {
    const geo = new THREE.PlaneGeometry(f.w, H, 6, 18);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = clamp(0.5 - p.getY(i) / H, 0, 1);    // 0 at the lip .. 1 at the water
      const out = -0.3 * Math.pow(1 - t, 5) + 1.1 * Math.pow(Math.sin(t * Math.PI / 2), 0.85);
      const belly = 0.12 * Math.sin((p.getX(i) / f.w + 0.5) * Math.PI);
      p.setZ(i, out + belly + offset);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.position.set(f.x + f.nx * 1.9, H / 2 - 0.25, f.z + f.nz * 1.9);
    m.rotation.y = facing;
    m.renderOrder = 5;
    g.add(m);
    return m;
  };
  const back = sheet(0, FALLS_BACK);
  const front = sheet(0.32, FALLS_FRONT);

  // The river above: a ribbon of flowing water laid along the gully floor.
  const segs = 16;
  const stream = new THREE.PlaneGeometry(f.w * 1.3, 40, 1, segs);
  stream.rotateX(-Math.PI / 2);
  const sp = stream.attributes.position;
  const suv = stream.attributes.uv;
  for (let i = 0; i < sp.count; i++) {
    const along = 2.4 + (sp.getZ(i) + 20);         // 2.4 .. 42 m in from the lip
    const across = sp.getX(i);
    const floor = terrainHeight(f.x + f.nx * along, f.z + f.nz * along);
    sp.setXYZ(i, f.x + f.nx * along + px * across, floor + 0.16, f.z + f.nz * along + pz * across);
    // Flow toward the lip: uv.x runs downstream.
    suv.setXY(i, 1 - (along - 2.4) / 40, suv.getX(i) + 0.5);
  }
  stream.setAttribute('phase', new THREE.Float32BufferAttribute(new Array(sp.count).fill(rng()), 1));
  const river = flowMesh([stream.toNonIndexed()], g);

  // Rocks: boulders along both edges of the lip, at the foot, and in the river.
  const rocks = [];
  for (const s of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const along = 1.2 + i * 1.6 + rng() * 0.6, across = s * (f.w / 2 + 0.5 + i * 0.7);
      const x = f.x + f.nx * along + px * across, z = f.z + f.nz * along + pz * across;
      rocks.push({ x, z, y: terrainHeight(x, z) - 0.55, s: 1.0 + rng() * 0.8, r: rng() * 6.28 });
    }
    for (let i = 0; i < 2; i++) {
      const along = -0.5 - i * 2.2, across = s * (f.w / 2 + 0.6 + rng() * 1.2);
      const x = f.x + f.nx * along + px * across, z = f.z + f.nz * along + pz * across;
      rocks.push({ x, z, y: -0.45 + rng() * 0.2, s: 0.9 + rng() * 0.9, r: rng() * 6.28 });
    }
  }
  for (const along of [11, 22, 33]) {
    const across = (rng() - 0.5) * f.w * 0.8;
    const x = f.x + f.nx * along + px * across, z = f.z + f.nz * along + pz * across;
    rocks.push({ x, z, y: terrainHeight(x, z) - 0.15, s: 0.5 + rng() * 0.6, r: rng() * 6.28 });
  }
  const rockMesh = instance(GEO.boulder, MATS.boulder, rocks, g, (t, m) => {
    _q.setFromEuler(_e.set(t.r * 0.4, t.r, 0.15)); _s.set(t.s, t.s * 0.8, t.s * 0.9); _p.set(t.x, t.y + t.s * 0.4, t.z); return m.compose(_p, _q, _s);
  });

  // The foot: a boil of foam the water lands in, and spray drifting up off it.
  const boil = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 9), MATS.splash);
  boil.position.set(f.x - f.nx * 1.4, 0.05, f.z - f.nz * 1.4);
  boil.rotation.y = facing;
  boil.renderOrder = 5;
  g.add(boil);
  const mist = [];
  const mm = new THREE.SpriteMaterial({ map: mistTexture(), transparent: true, opacity: 0.4, depthWrite: false, color: 0xf0f8ff });
  for (let i = 0; i < 7; i++) {
    const s2 = new THREE.Sprite(mm.clone());
    s2.position.set(f.x - f.nx * (1.0 + rng() * 3) + px * (rng() - 0.5) * f.w, 0.4 + rng(), f.z - f.nz * (1.0 + rng() * 3) + pz * (rng() - 0.5) * f.w);
    const s = 2.2 + rng() * 2.8;
    s2.scale.set(s, s, 1);
    s2.renderOrder = 6;
    g.add(s2);
    mist.push({ sp: s2, base: s2.position.y, s, phase: rng() * 6.28 });
  }
  const rings = [];
  const rm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(RING_GEO, rm.clone());
    ring.position.set(f.x - f.nx * 3, CONFIG.WATER_LEVEL + 0.07, f.z - f.nz * 3);
    ring.renderOrder = 4;
    g.add(ring);
    rings.push(ring);
  }
  parent.add(g);
  return {
    group: g,
    update(t) {
      for (const m of mist) {
        const k = (t * 0.35 + m.phase) % 1;
        m.sp.position.y = m.base + k * 2.4;
        m.sp.material.opacity = 0.45 * Math.sin(k * Math.PI);
        const s = m.s * (0.8 + k * 0.7);
        m.sp.scale.set(s, s, 1);
      }
      rings.forEach((ring, i) => {
        const cycle = ((t * 0.5 + i / 3) % 1);
        ring.scale.setScalar(1.5 + cycle * 8);
        ring.material.opacity = 0.45 * (1 - cycle);
      });
      boil.scale.set(f.w * 0.62 + Math.sin(t * 7.3) * 0.25, 0.55 + Math.sin(t * 9.1) * 0.12, 2.4 + Math.sin(t * 6.2) * 0.3);
    },
    dispose() {
      parent.remove(g);
      back.geometry.dispose(); front.geometry.dispose(); boil.geometry.dispose();
      if (river) river.dispose();
      if (rockMesh) rockMesh.dispose();
      for (const m of mist) m.sp.material.dispose();
      for (const r of rings) r.material.dispose();
    },
  };
}

/** The boulders in a rapid, on the bed with their tops through the surface. */
export function buildBoulders(list, parent) {
  return instance(GEO.boulder, MATS.boulder, list, parent, (t, m) => {
    _q.setFromEuler(_e.set(t.r * 0.4, t.r, 0.2)); _s.set(t.s, t.s * 0.8, t.s * 0.9); _p.set(t.x, Math.max(t.h + t.s * 0.55, 0.3 - t.s * 0.25), t.z); return m.compose(_p, _q, _s);
  });
}

/**
 * White water tearing off a rapid's boulders: a wake of foam trailing
 * downstream from each, opening as it goes, flowing with the current.
 */
export function buildBoulderWakes(list, parent) {
  const geos = [];
  const v = { x: 0, z: 0 };
  for (const b of list) {
    currentAt(b.x, b.z, v);
    let sp = Math.hypot(v.x, v.z);
    let ux, uz;
    if (sp < 0.15) {
      // Still water round it: read the flow a little downstream instead.
      currentAt(b.x + 4, b.z, v); sp = Math.hypot(v.x, v.z);
      if (sp < 0.15) continue;
    }
    ux = v.x / sp; uz = v.z / sp;
    const r = b.s * 0.85, len = 6 + b.s * 3 + sp * 1.5;
    const px = -uz, pz = ux;
    const geo = new THREE.PlaneGeometry(1, 1, 5, 1);
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) + 0.5;                 // 0 at the boulder .. 1 downstream
      const w = r * 0.9 + u * (r + 2.2);
      const side = p.getY(i) * 2;                // -1 .. 1 across
      const x = b.x + ux * (r * 0.6 + u * len) + px * side * w;
      const z = b.z + uz * (r * 0.6 + u * len) + pz * side * w;
      p.setXYZ(i, x, CONFIG.WATER_LEVEL + 0.07, z);
      uv.setXY(i, u, p.getY(i) + 0.5);
    }
    geo.setAttribute('phase', new THREE.Float32BufferAttribute(new Array(p.count).fill(b.r / 6.28), 1));
    geos.push(geo.toNonIndexed());
  }
  return flowMesh(geos, parent);
}

/** A beaver dam: a jumble of logs thrown across the creek. */
export function buildDam(d, parent) {
  const rng = mulberry32(d.seed);
  const logs = [];
  const n = Math.round(d.len * 2.6);
  for (let i = 0; i < n; i++) {
    const along = (rng() - 0.5) * d.len;
    const layer = i % 3;
    logs.push({
      x: d.x + d.ax * along + d.az * (rng() - 0.5) * 1.8,
      z: d.z + d.az * along - d.ax * (rng() - 0.5) * 1.8,
      y: 0.05 + layer * 0.28 + rng() * 0.14,
      r: Math.atan2(d.ax, d.az) + Math.PI / 2 + (rng() - 0.5) * 0.7,
      tilt: (rng() - 0.5) * 0.35,
      s: 0.6 + rng() * 0.5,
    });
  }
  return instance(GEO.log, MATS.damlog, logs, parent, (t, m) => lying(t.x, t.y, t.z, t.s, t.r, t.tilt, m));
}

/** A beaver lodge: a dome of sticks standing in the water. */
export function buildLodge(l, parent) {
  const rng = mulberry32(l.seed);
  const sticks = [];
  for (let i = 0; i < 54; i++) {
    const az = rng() * Math.PI * 2, el = rng() * 1.35;
    const rr = l.r * (0.55 + rng() * 0.45);
    sticks.push({
      x: l.x + Math.cos(az) * Math.cos(el) * rr, y: 0.02 + Math.sin(el) * rr * 0.8, z: l.z + Math.sin(az) * Math.cos(el) * rr,
      r: az + Math.PI / 2 + (rng() - 0.5) * 1.2, tilt: (rng() - 0.5) * 1.1, s: 1.5 + rng() * 1.2,
    });
  }
  return instance(GEO.stick, MATS.stick, sticks, parent, (t, m) => lying(t.x, t.y, t.z, t.s, t.r, t.tilt, m));
}

/** A sea stack: a column of rock standing out of the swell off the coast. */
export function buildStack(st, parent) {
  const rng = mulberry32(st.seed);
  const floor = baseHeight(st.x, st.z);
  const h = Math.max(0, -floor) + 2.5 + st.h * 0.6;
  const g = new THREE.Group();
  const col = new THREE.Mesh(new THREE.CylinderGeometry(st.r * 0.7, st.r * 1.35, h, 7), MATS.stack);
  col.position.y = floor + h / 2;
  col.rotation.y = rng() * 6.28;
  col.castShadow = true;
  g.add(col);
  const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(st.r * 0.85, 0), MATS.stack);
  cap.position.y = floor + h;
  cap.rotation.set(rng(), rng() * 6, 0);
  cap.castShadow = true;
  g.add(cap);
  g.position.set(st.x, 0, st.z);
  parent.add(g);
  return { group: g, dispose() { parent.remove(g); col.geometry.dispose(); cap.geometry.dispose(); } };
}

/** Advance the shared water-effect shaders. */
export function tickEffects(t) {
  FALLS_BACK.uniforms.uTime.value = t;
  FALLS_FRONT.uniforms.uTime.value = t;
  FLOW_MAT.uniforms.uTime.value = t;
}

export { clamp };
