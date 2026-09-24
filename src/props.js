// What dresses the country: the prefabs strewn over a chunk by its biome
// (pines and snow pines, reeds and cattails, lily pads, logs and sticks,
// mangroves on their prop roots, palms, boulders, driftwood, sea stacks)
// and the built features that terrain.js placed — waterfalls with their
// mist and their stream up top, the white water through rapids, beaver
// dams and lodges. All of it is scenery: none of it touches a bet.

import * as THREE from 'three';
import { mulberry32, hash2, clamp } from './noise.js';
import { CONFIG } from './config.js';
import { regionBlend } from './regions.js';
import { terrainHeight, baseHeight } from './terrain.js';

const S = CONFIG.SEED;

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
    // From the trunk at y=1.4 down and out to the ground at radius 0.95.
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
    f.translate(0, -1.35, 0);   // hang from the tip
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
  stream: new THREE.MeshBasicMaterial({ color: 0x7fd0e6, transparent: true, opacity: 0.72, depthWrite: false }),
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _e = new THREE.Euler();
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
 * Strew a chunk with its biome's props. Returns the instanced meshes made,
 * for disposal. The blend between two regions is honoured by drawing each
 * point's region by the blend weight, so borders are ragged, not ruled.
 */
export function buildChunkProps(cx, cz, ox, oz, size, parent) {
  const rng = mulberry32((hash2(cx, cz, S + 5) * 1e9) | 0);
  const L = { pine: [], snowpine: [], rock: [], boulder: [], reed: [], cattail: [], lily: [], flower: [],
    log: [], driftwood: [], stick: [], mangrove: [], palm: [] };

  for (let i = 0; i < 150; i++) {
    const x = ox + (rng() - 0.5) * size;
    const z = oz + (rng() - 0.5) * size;
    const h = terrainHeight(x, z);
    const bl = regionBlend(x, z);
    const reg = rng() < bl.wa ? bl.a : bl.b;
    const p = reg.biome.props;
    const roll = rng();
    if (h > 1.4 && h < 6.5) {
      if (p.palm && h < 3.2 && roll < p.palm * 0.55) L.palm.push({ x, z, h, s: 0.75 + rng() * 0.6, r: rng() * 6.28 });
      else if (p.snowpine && h > 3.2 && roll < p.snowpine) L.snowpine.push({ x, z, h, s: 0.7 + rng() * 0.9, r: rng() * 6.28 });
      else if (p.pine && roll < p.pine) L.pine.push({ x, z, h, s: 0.7 + rng() * 0.9, r: rng() * 6.28 });
      else if (p.boulder && roll < p.pine + p.boulder * 0.25) L.boulder.push({ x, z, h, s: 0.6 + rng() * 1.0, r: rng() * 6.28 });
    } else if (h > -0.15 && h < 1.4) {
      if (p.mangrove && h < 0.6 && roll < p.mangrove * 0.5) L.mangrove.push({ x, z, h, s: 0.8 + rng() * 0.5, r: rng() * 6.28 });
      else if (p.driftwood && h > 0.1 && roll < p.driftwood * 0.45) L.driftwood.push({ x, z, h, s: 0.5 + rng() * 0.6, r: rng() * 6.28 });
      else if (p.rock && roll < p.rock * 0.35) L.rock.push({ x, z, h, s: 0.35 + rng() * 0.75, r: rng() * 6.28 });
      else if (p.boulder && roll < p.boulder * 0.4) L.boulder.push({ x, z, h, s: 0.5 + rng() * 0.9, r: rng() * 6.28 });
      else if (p.palm && h > 0.5 && roll < p.palm * 0.5) L.palm.push({ x, z, h, s: 0.7 + rng() * 0.5, r: rng() * 6.28 });
      else if ((p.reed || p.cattail) && h < 0.5 && roll < (p.reed || 0) + (p.cattail || 0)) {
        const n = 6 + Math.floor(rng() * 10);
        for (let k = 0; k < n; k++) {
          const rx = x + (rng() - 0.5) * 4, rz = z + (rng() - 0.5) * 4;
          const rh = terrainHeight(rx, rz);
          if (rh < -0.7 || rh > 0.6) continue;
          const tail = p.cattail && rng() < p.cattail / ((p.reed || 0) + p.cattail);
          (tail ? L.cattail : L.reed).push({ x: rx, z: rz, h: rh, s: 0.7 + rng() * 0.6, r: rng() * 6.28, lean: (rng() - 0.5) * 0.3 });
        }
      }
    } else if (h <= -0.15 && h > -2.2) {
      if (p.mangrove && h > -1.3 && roll < p.mangrove * 0.45) L.mangrove.push({ x, z, h, s: 0.8 + rng() * 0.5, r: rng() * 6.28 });
      else if (p.lily && h > -1.7 && roll < p.lily) {
        const n = 5 + Math.floor(rng() * 8);
        for (let k = 0; k < n; k++) {
          const lx = x + (rng() - 0.5) * 5, lz = z + (rng() - 0.5) * 5;
          const lh = terrainHeight(lx, lz);
          if (lh > -0.2 || lh < -2) continue;
          L.lily.push({ x: lx, z: lz, s: 0.6 + rng() * 0.7, r: rng() * 6.28 });
          if (rng() < 0.18) L.flower.push({ x: lx, z: lz, s: 0.8 + rng() * 0.5, r: 0 });
        }
      } else if (p.log && h > -1.6 && roll < p.lily + p.log * 0.5) L.log.push({ x, z, h, s: 0.7 + rng() * 0.6, r: rng() * 6.28 });
      else if (p.stick && roll < p.lily + p.log * 0.5 + p.stick * 0.6) {
        const n = 2 + Math.floor(rng() * 4);
        for (let k = 0; k < n; k++) L.stick.push({ x: x + (rng() - 0.5) * 3, z: z + (rng() - 0.5) * 3, s: 0.8 + rng() * 0.8, r: rng() * 6.28 });
      } else if (p.boulder && h > -1.6 && roll < 0.9 && rng() < p.boulder * 0.3) L.boulder.push({ x, z, h, s: 0.6 + rng() * 0.9, r: rng() * 6.28 });
      else if (p.reed && h > -0.6 && rng() < p.reed * 0.5) {
        const n = 4 + Math.floor(rng() * 6);
        for (let k = 0; k < n; k++) {
          const rx = x + (rng() - 0.5) * 3, rz = z + (rng() - 0.5) * 3;
          const rh = terrainHeight(rx, rz);
          if (rh < -0.7 || rh > 0.6) continue;
          L.reed.push({ x: rx, z: rz, h: rh, s: 0.7 + rng() * 0.6, r: rng() * 6.28, lean: (rng() - 0.5) * 0.3 });
        }
      }
    }
  }

  const out = [];
  const add = (im) => { if (im) out.push(im); };
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
  add(instance(GEO.reed, MATS.reed, L.reed, parent, (t, m) => lying(t.x, Math.max(t.h, WL - 0.3), t.z, t.s, t.r, t.lean, m), false));
  add(instance(GEO.cattail, MATS.cattail, L.cattail, parent, (t, m) => lying(t.x, Math.max(t.h, WL - 0.3), t.z, t.s, t.r, t.lean, m), false));
  add(instance(GEO.lily, MATS.lily, L.lily, parent, (t, m) => upright(t.x, WL + 0.03, t.z, t.s, t.r, m), false));
  add(instance(GEO.flower, MATS.flower, L.flower, parent, (t, m) => upright(t.x, WL + 0.04, t.z, t.s, 0, m), false));
  add(instance(GEO.log, MATS.log, L.log, parent, (t, m) => lying(t.x, Math.max(t.h + 0.2, WL - 0.12), t.z, t.s, t.r, 0.05, m)));
  add(instance(GEO.log, MATS.driftwood, L.driftwood, parent, (t, m) => lying(t.x, t.h + 0.2 * t.s, t.z, t.s, t.r, 0.08, m)));
  add(instance(GEO.stick, MATS.stick, L.stick, parent, (t, m) => lying(t.x, WL + 0.01, t.z, t.s, t.r, 0, m), false));
  add(instance(GEO.mangroveWood, MATS.mangroveWood, L.mangrove, parent, (t, m) => upright(t.x, t.h - 0.1, t.z, t.s, t.r, m)));
  add(instance(GEO.mangroveCanopy, MATS.mangroveCanopy, L.mangrove, parent, (t, m) => upright(t.x, t.h - 0.1, t.z, t.s, t.r, m)));
  add(instance(GEO.palmTrunk, MATS.palmTrunk, L.palm, parent, (t, m) => upright(t.x, t.h, t.z, t.s, t.r, m)));
  add(instance(GEO.palmFrond, MATS.palmFrond, L.palm, parent, (t, m) => upright(t.x, t.h, t.z, t.s, t.r, m)));
  return out;
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

const FALLS_MAT = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform float uTime; varying vec2 vUv; ${GLSL_NOISE}
    void main() {
      float fall = vUv.y;                              // 1 at the lip, 0 at the water
      float streak = vnoise(vec2(vUv.x * 9.0, vUv.y * 2.5 + uTime * 1.7));
      float streak2 = vnoise(vec2(vUv.x * 21.0 + 3.0, vUv.y * 5.0 + uTime * 2.6));
      float white = smoothstep(0.35, 0.8, streak * 0.65 + streak2 * 0.5);
      // Sheer at the lip, breaking into froth by the bottom.
      float froth = smoothstep(0.55, 0.0, fall);
      vec3 col = mix(vec3(0.72, 0.87, 0.94), vec3(1.0), white * 0.8 + froth * 0.4);
      float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
      float alpha = (0.5 + white * 0.4 + froth * 0.3) * edge;
      gl_FragColor = vec4(col, alpha);
    }`,
});

const FOAM_MAT = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec2 vUv; attribute float phase; varying float vPhase;
    void main() { vUv = uv; vPhase = phase; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform float uTime; varying vec2 vUv; varying float vPhase; ${GLSL_NOISE}
    void main() {
      float n = vnoise(vec2(vUv.x * 6.0 - uTime * 1.9 + vPhase * 7.0, vUv.y * 3.0 + vPhase));
      float n2 = vnoise(vec2(vUv.x * 14.0 - uTime * 3.1, vUv.y * 7.0 + vPhase * 3.0));
      float white = smoothstep(0.32, 0.62, n * 0.6 + n2 * 0.5);
      float shape = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.75, vUv.x) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
      gl_FragColor = vec4(vec3(1.0), (0.25 + white * 0.75) * shape * 0.95);
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

/** A waterfall: the sheet off the lip, the mist and foam at its foot, the stream above. */
export function buildFalls(f, parent) {
  const g = new THREE.Group();
  const rng = mulberry32(f.seed);
  // The lip: the floor of the gully where it meets the cliff face.
  const top = Math.max(2.5, terrainHeight(f.x + f.nx * 4.0, f.z + f.nz * 4.0) + 0.1);
  const facing = Math.atan2(-f.nx, -f.nz);   // the sheet faces out over the water

  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(f.w, top + 0.6, 1, 6), FALLS_MAT);
  sheet.position.set(f.x + f.nx * 1.9, top / 2 - 0.25, f.z + f.nz * 1.9);
  sheet.rotation.y = facing;
  sheet.renderOrder = 5;
  g.add(sheet);

  // The stream that feeds it: a ribbon laid along the gully floor, so it
  // runs down the country to the lip however the ground goes.
  const segs = 14;
  const stream = new THREE.PlaneGeometry(f.w * 1.1, 32, 1, segs);
  stream.rotateX(-Math.PI / 2);          // flat, running along -z .. +z
  const sp = stream.attributes.position;
  const px = f.nz, pz = -f.nx;           // across the stream
  for (let i = 0; i < sp.count; i++) {
    const along = 3.0 + (sp.getZ(i) + 16) ;         // 3 .. 35 m in from the lip
    const across = sp.getX(i);
    const wx = f.x + f.nx * along + px * across, wz = f.z + f.nz * along + pz * across;
    const floor = terrainHeight(f.x + f.nx * along, f.z + f.nz * along);
    sp.setXYZ(i, wx, floor + 0.14, wz);
  }
  sp.needsUpdate = true;
  const streamMesh = new THREE.Mesh(stream, MATS.stream);
  streamMesh.renderOrder = 3;
  g.add(streamMesh);

  // Mist: soft sprites drifting up from the foot.
  const mist = [];
  const mm = new THREE.SpriteMaterial({ map: mistTexture(), transparent: true, opacity: 0.4, depthWrite: false, color: 0xf0f8ff });
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.Sprite(mm.clone());
    sp.position.set(f.x - f.nx * (1.5 + rng() * 3) + f.nz * (rng() - 0.5) * f.w, 0.6 + rng(), f.z - f.nz * (1.5 + rng() * 3) - f.nx * (rng() - 0.5) * f.w);
    const s = 2.5 + rng() * 2.5;
    sp.scale.set(s, s, 1);
    sp.renderOrder = 6;
    g.add(sp);
    mist.push({ sp, base: sp.position.y, s, phase: rng() * 6.28 });
  }
  // Foam rings spreading from the foot.
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
        m.sp.position.y = m.base + k * 2.2;
        m.sp.material.opacity = 0.45 * Math.sin(k * Math.PI);
        const s = m.s * (0.8 + k * 0.7);
        m.sp.scale.set(s, s, 1);
      }
      rings.forEach((ring, i) => {
        const cycle = ((t * 0.5 + i / 3) % 1);
        ring.scale.setScalar(1.5 + cycle * 7);
        ring.material.opacity = 0.45 * (1 - cycle);
      });
    },
    dispose() {
      parent.remove(g);
      sheet.geometry.dispose(); stream.dispose();
      for (const m of mist) m.sp.material.dispose();
      for (const r of rings) r.material.dispose();
    },
  };
}

/** White water: foam streaks lying on the surface along the flow. */
export function buildFoam(list, parent) {
  const geos = [];
  const m = new THREE.Matrix4();
  for (const s of list) {
    const g = new THREE.PlaneGeometry(s.len, s.w, 1, 1);
    const n = g.attributes.position.count;
    g.setAttribute('phase', new THREE.Float32BufferAttribute(new Array(n).fill(s.phase), 1));
    g.rotateX(-Math.PI / 2);
    m.makeRotationY(-s.ang);
    m.setPosition(s.x, CONFIG.WATER_LEVEL + 0.06, s.z);
    g.applyMatrix4(m);
    geos.push(g.toNonIndexed());
  }
  if (!geos.length) return null;
  // One mesh for all of them: positions, uvs and phases concatenated.
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
  const mesh = new THREE.Mesh(geo, FOAM_MAT);
  mesh.renderOrder = 4;
  parent.add(mesh);
  return { mesh, dispose() { parent.remove(mesh); geo.dispose(); } };
}

/** The boulders in a rapid, on the bed with their tops through the surface. */
export function buildBoulders(list, parent) {
  return instance(GEO.boulder, MATS.boulder, list, parent, (t, m) => {
    _q.setFromEuler(_e.set(t.r * 0.4, t.r, 0.2)); _s.set(t.s, t.s * 0.8, t.s * 0.9); _p.set(t.x, Math.max(t.h + t.s * 0.55, 0.25 - t.s * 0.3), t.z); return m.compose(_p, _q, _s);
  });
}

/** A beaver dam: a jumble of logs thrown across the creek. */
export function buildDam(d, parent) {
  const rng = mulberry32(d.seed);
  const logs = [];
  const n = Math.round(d.len * 2.2);
  for (let i = 0; i < n; i++) {
    const along = (rng() - 0.5) * d.len;
    const layer = i % 3;
    logs.push({
      x: d.x + d.ax * along + d.az * (rng() - 0.5) * 1.6,
      z: d.z + d.az * along - d.ax * (rng() - 0.5) * 1.6,
      y: 0.05 + layer * 0.24 + rng() * 0.12,
      r: Math.atan2(d.ax, d.az) + Math.PI / 2 + (rng() - 0.5) * 0.7,
      tilt: (rng() - 0.5) * 0.35,
      s: 0.45 + rng() * 0.45,
    });
  }
  return instance(GEO.log, MATS.damlog, logs, parent, (t, m) => lying(t.x, t.y, t.z, t.s, t.r, t.tilt, m));
}

/** A beaver lodge: a dome of sticks standing in the water. */
export function buildLodge(l, parent) {
  const rng = mulberry32(l.seed);
  const sticks = [];
  for (let i = 0; i < 46; i++) {
    const az = rng() * Math.PI * 2, el = rng() * 1.35;
    const rr = l.r * (0.55 + rng() * 0.45);
    sticks.push({
      x: l.x + Math.cos(az) * Math.cos(el) * rr, y: 0.02 + Math.sin(el) * rr * 0.8, z: l.z + Math.sin(az) * Math.cos(el) * rr,
      r: az + Math.PI / 2 + (rng() - 0.5) * 1.2, tilt: (rng() - 0.5) * 1.1, s: 1.3 + rng() * 1.1,
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
  FALLS_MAT.uniforms.uTime.value = t;
  FOAM_MAT.uniforms.uTime.value = t;
}

export { clamp };
