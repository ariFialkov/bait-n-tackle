// Procedural mid-LOD fish prefabs. Each species gets a swept body (elliptical
// cross-sections along per-archetype depth/width/spine profiles), a species
// skin texture painted on a small canvas (back-to-belly gradient + bars /
// spots / stripes / marbling), and archetype fins: forked, rounded, square,
// heterocercal or whip tails, spiny/sail/ribbon/double dorsals, adipose
// fins, gar and paddle snouts, catfish barbels. Geometry, materials and
// textures are cached per species; a prefab instance is a cheap Group of
// meshes sharing them (~400-700 tris).

import * as THREE from 'three';
import { SPECIES } from './fishdata.js';
import { mulberry32, clamp, lerp } from './noise.js';

const N_ST = 16;   // stations along the body
const N_R = 12;    // ring segments

// --- Archetype presets -------------------------------------------------
// depth: max body depth as fraction of length; width: cross-section width
// as fraction of depth; maxPos: where the body is deepest; ped: caudal
// peduncle depth fraction; elong: length multiplier vs generic.
const ARCH = {
  minnow:    { depth: 0.22, width: 0.52, maxPos: 0.42, ped: 0.30, elong: 1.0, tail: 'fork', dorsal: { pos: 0.48, len: 0.16, h: 0.55, type: 'tri' }, anal: { pos: 0.70, len: 0.13, h: 0.42 } },
  panfish:   { depth: 0.46, width: 0.30, maxPos: 0.45, ped: 0.22, elong: 0.72, tail: 'round', dorsal: { pos: 0.34, len: 0.36, h: 0.62, type: 'spiny' }, anal: { pos: 0.60, len: 0.24, h: 0.52 } },
  perch:     { depth: 0.30, width: 0.42, maxPos: 0.40, ped: 0.26, elong: 0.95, tail: 'fork', dorsal: { pos: 0.32, len: 0.20, h: 0.60, type: 'double' }, anal: { pos: 0.68, len: 0.14, h: 0.42 } },
  bass:      { depth: 0.33, width: 0.45, maxPos: 0.42, ped: 0.28, elong: 0.92, tail: 'square', dorsal: { pos: 0.36, len: 0.30, h: 0.52, type: 'spiny' }, anal: { pos: 0.66, len: 0.16, h: 0.45 } },
  trout:     { depth: 0.26, width: 0.48, maxPos: 0.44, ped: 0.28, elong: 1.05, tail: 'square', adipose: true, dorsal: { pos: 0.42, len: 0.16, h: 0.52, type: 'tri' }, anal: { pos: 0.70, len: 0.12, h: 0.42 } },
  salmon:    { depth: 0.27, width: 0.48, maxPos: 0.42, ped: 0.26, elong: 1.08, tail: 'fork', adipose: true, dorsal: { pos: 0.42, len: 0.16, h: 0.52, type: 'tri' }, anal: { pos: 0.70, len: 0.13, h: 0.42 } },
  grayling:  { depth: 0.27, width: 0.44, maxPos: 0.42, ped: 0.26, elong: 1.0, tail: 'fork', adipose: true, dorsal: { pos: 0.30, len: 0.30, h: 1.05, type: 'sail' }, anal: { pos: 0.70, len: 0.12, h: 0.40 } },
  whitefish: { depth: 0.30, width: 0.42, maxPos: 0.42, ped: 0.26, elong: 0.98, tail: 'fork', adipose: true, dorsal: { pos: 0.40, len: 0.17, h: 0.55, type: 'tri' }, anal: { pos: 0.70, len: 0.13, h: 0.42 } },
  pike:      { depth: 0.20, width: 0.55, maxPos: 0.55, ped: 0.32, elong: 1.45, tail: 'round', snout: 'duck', dorsal: { pos: 0.76, len: 0.15, h: 0.55, type: 'tri' }, anal: { pos: 0.78, len: 0.13, h: 0.50 } },
  catfish:   { depth: 0.28, width: 0.62, maxPos: 0.30, ped: 0.26, elong: 1.1, tail: 'fork', headBulge: true, barbels: 4, adipose: true, dorsal: { pos: 0.32, len: 0.14, h: 0.55, type: 'tri' }, anal: { pos: 0.60, len: 0.24, h: 0.40 } },
  bullhead:  { depth: 0.28, width: 0.66, maxPos: 0.32, ped: 0.28, elong: 1.0, tail: 'round', headBulge: true, barbels: 4, adipose: true, dorsal: { pos: 0.32, len: 0.14, h: 0.50, type: 'tri' }, anal: { pos: 0.58, len: 0.26, h: 0.40 } },
  flathead:  { depth: 0.26, width: 0.75, maxPos: 0.28, ped: 0.28, elong: 1.15, tail: 'round', headBulge: true, barbels: 6, adipose: true, dorsal: { pos: 0.34, len: 0.14, h: 0.48, type: 'tri' }, anal: { pos: 0.60, len: 0.24, h: 0.38 } },
  carp:      { depth: 0.34, width: 0.50, maxPos: 0.38, ped: 0.28, elong: 0.95, tail: 'fork', hump: 0.06, dorsal: { pos: 0.36, len: 0.34, h: 0.55, type: 'tri' }, anal: { pos: 0.72, len: 0.12, h: 0.42 } },
  sturgeon:  { depth: 0.19, width: 0.62, maxPos: 0.32, ped: 0.22, elong: 1.55, tail: 'hetero', snout: 'point', barbels: 4, dorsal: { pos: 0.72, len: 0.14, h: 0.45, type: 'tri' }, anal: { pos: 0.76, len: 0.10, h: 0.36 } },
  gar:       { depth: 0.17, width: 0.60, maxPos: 0.55, ped: 0.30, elong: 1.65, tail: 'round', snout: 'gar', dorsal: { pos: 0.80, len: 0.12, h: 0.50, type: 'tri' }, anal: { pos: 0.80, len: 0.11, h: 0.45 } },
  paddle:    { depth: 0.24, width: 0.55, maxPos: 0.42, ped: 0.24, elong: 1.4, tail: 'hetero', snout: 'paddle', dorsal: { pos: 0.55, len: 0.14, h: 0.45, type: 'tri' }, anal: { pos: 0.62, len: 0.13, h: 0.40 } },
  drum:      { depth: 0.38, width: 0.40, maxPos: 0.34, ped: 0.24, elong: 0.85, tail: 'round', hump: 0.10, dorsal: { pos: 0.30, len: 0.44, h: 0.50, type: 'spiny' }, anal: { pos: 0.68, len: 0.12, h: 0.42 } },
  ribbon:    { depth: 0.24, width: 0.52, maxPos: 0.35, ped: 0.34, elong: 1.3, tail: 'round', dorsal: { pos: 0.30, len: 0.55, h: 0.42, type: 'ribbon' }, anal: { pos: 0.60, len: 0.28, h: 0.35 } },
  barra:     { depth: 0.34, width: 0.42, maxPos: 0.46, ped: 0.30, elong: 0.95, tail: 'round', hump: 0.08, dorsal: { pos: 0.36, len: 0.26, h: 0.55, type: 'double' }, anal: { pos: 0.66, len: 0.16, h: 0.48 } },
  knife:     { depth: 0.38, width: 0.30, maxPos: 0.28, ped: 0.10, elong: 1.05, tail: 'point', dorsal: { pos: 0.42, len: 0.10, h: 0.35, type: 'tri' }, anal: { pos: 0.34, len: 0.60, h: 0.40, type: 'ribbon', bottom: true } },
  ray:       { special: 'ray' },
};

const AREAS = {
  minnow: ['Coves & docks', 'Warm shallows'], panfish: ['Coves & docks', 'Weed beds'],
  perch: ['Weed beds', 'Drop-offs'], bass: ['Rocky points', 'Weed beds'],
  trout: ['Stream deltas', 'Cold open water'], salmon: ['Stream deltas', 'Cold open water'],
  grayling: ['Stream deltas', 'Gravel runs'], whitefish: ['Deep basins', 'Cold open water'],
  pike: ['Weedy bays', 'Narrow passages'], catfish: ['Deep holes', 'Muddy flats'],
  bullhead: ['Muddy flats', 'Warm shallows'], flathead: ['Deep holes', 'Log jams'],
  carp: ['Muddy flats', 'Warm shallows'], sturgeon: ['Deep basins', 'River mouths'],
  gar: ['Backwaters', 'Warm shallows'], paddle: ['Open water', 'River mouths'],
  drum: ['Open water', 'Sandy flats'], ribbon: ['Backwaters', 'Weedy bays'],
  barra: ['River mouths', 'Rocky points'], knife: ['Backwaters', 'Deep holes'],
  ray: ['Sandy flats', 'Deep holes'],
};

export function speciesAreas(species) {
  return AREAS[species.style.arch] || ['Open water'];
}

/** Approximate visual body length in meters. */
export function visualLength(species) {
  const a = ARCH[species.style.arch] || ARCH.minnow;
  const elong = a.elong || 1;
  return clamp(0.42 * Math.cbrt(species.kg) * elong, 0.22, 3.4);
}

// --- Skin textures ------------------------------------------------------
function css(hex) { return '#' + hex.toString(16).padStart(6, '0'); }

function paintPattern(ctx, W, H, [type, colorHex], rng) {
  const color = css(colorHex);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (type === 'bars') {
    ctx.globalAlpha = 0.55;
    const n = 5 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const x = W * (0.16 + 0.72 * (i / (n - 1)) + (rng() - 0.5) * 0.03);
      const w = W * (0.035 + rng() * 0.03);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x + w, H * 0.3, x, H * 0.62);
      ctx.lineTo(x - w, H * 0.62);
      ctx.quadraticCurveTo(x, H * 0.3, x - w, 0);
      ctx.fill();
    }
  } else if (type === 'spots' || type === 'lightspots') {
    ctx.globalAlpha = type === 'spots' ? 0.7 : 0.6;
    const n = 26 + Math.floor(rng() * 18);
    for (let i = 0; i < n; i++) {
      const x = W * (0.1 + rng() * 0.85);
      const y = H * (0.04 + rng() * 0.6);
      const r = 1 + rng() * 2.4;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (type === 'stripe') {
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.moveTo(W * 0.08, H * 0.46);
    ctx.quadraticCurveTo(W * 0.5, H * 0.40, W * 0.98, H * 0.5);
    ctx.lineWidth = H * 0.11;
    ctx.stroke();
  } else if (type === 'hstripes') {
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = H * 0.035;
    for (let i = 0; i < 4; i++) {
      const y = H * (0.16 + i * 0.13);
      ctx.beginPath();
      ctx.moveTo(W * 0.12, y);
      ctx.lineTo(W * 0.95, y + H * 0.04);
      ctx.stroke();
    }
  } else if (type === 'chain') {
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < 22; i++) {
      const x = W * (0.12 + rng() * 0.8);
      const y = H * (0.08 + rng() * 0.5);
      ctx.beginPath();
      ctx.ellipse(x, y, 2.6 + rng() * 2, 1.2 + rng(), rng(), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (type === 'marble') {
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 9; i++) {
      const x0 = W * rng(), y0 = H * rng() * 0.55;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(
        x0 + 14 - rng() * 28, y0 + 10 - rng() * 20,
        x0 + 20 - rng() * 40, y0 + 14 - rng() * 28,
        x0 + 30 - rng() * 60, y0 + 8 - rng() * 16);
      ctx.stroke();
    }
  } else if (type === 'blotch') {
    ctx.globalAlpha = 0.4;
    for (let i = 0; i < 8; i++) {
      const x = W * (0.1 + rng() * 0.8), y = H * (0.05 + rng() * 0.45);
      ctx.beginPath();
      ctx.ellipse(x, y, 5 + rng() * 8, 3 + rng() * 5, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (type === 'scales') {
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1;
    for (let r = 0; r < 6; r++) {
      for (let c2 = 0; c2 < 14; c2++) {
        const x = W * (0.08 + c2 * 0.065 + (r % 2) * 0.03);
        const y = H * (0.08 + r * 0.1);
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0.3, Math.PI - 0.3);
        ctx.stroke();
      }
    }
  } else if (type === 'scutes') {
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < 12; i++) {
      const x = W * (0.12 + i * 0.07);
      ctx.beginPath();
      ctx.moveTo(x, H * 0.02);
      ctx.lineTo(x + 3, H * 0.09);
      ctx.lineTo(x - 3, H * 0.09);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + 2, H * 0.42, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function makeSkinTexture(species) {
  const W = 128, H = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const { back, belly, pat } = species.style;

  // Back → flank → belly gradient (canvas top row = fish back).
  const backC = new THREE.Color(back), bellyC = new THREE.Color(belly);
  const flank = backC.clone().lerp(bellyC, 0.55);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, css(backC.clone().offsetHSL(0, 0, -0.06).getHex()));
  g.addColorStop(0.42, css(back));
  g.addColorStop(0.62, css(flank.getHex()));
  g.addColorStop(0.8, css(belly));
  g.addColorStop(1, css(bellyC.clone().offsetHSL(0, -0.05, 0.06).getHex()));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const rng = mulberry32(species.id * 7919 + 13);
  for (const p of pat) paintPattern(ctx, W, H, p, rng);

  // Subtle gill plate + eye-socket shading near the head.
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(W * 0.13, H * 0.35, W * 0.02, H * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// --- Body sweep ---------------------------------------------------------
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function profiles(a) {
  const snout = a.snout;
  const depthAt = (t) => {
    let d;
    if (t < a.maxPos) d = lerp(0.16, 1, Math.pow(smoothstep(0, a.maxPos, t), 0.75));
    else d = lerp(1, a.ped, smoothstep(a.maxPos, 0.94, t));
    if (snout === 'duck' && t < 0.2) d *= lerp(0.5, 1, t / 0.2);
    if (snout === 'gar' && t < 0.3) d *= lerp(0.16, 1, Math.pow(t / 0.3, 1.4));
    if (snout === 'paddle' && t < 0.28) d *= lerp(0.14, 1, Math.pow(t / 0.28, 1.3));
    if (snout === 'point' && t < 0.25) d *= lerp(0.3, 1, t / 0.25);
    return d;
  };
  const widthAt = (t) => {
    let w = 1;
    if (a.headBulge && t < 0.3) w *= 1 + (0.3 - t) * 1.6;
    if (snout === 'gar' && t < 0.3) w *= lerp(0.5, 1, t / 0.3);
    if (snout === 'paddle' && t < 0.28) w *= lerp(2.4, 1, Math.pow(t / 0.28, 0.8));
    return w;
  };
  const spineAt = (t) => (a.hump ? a.hump * Math.sin(Math.PI * clamp(t / 0.85, 0, 1)) : 0);
  return { depthAt, widthAt, spineAt };
}

function buildBodyGeometry(species, a, len) {
  const { depthAt, widthAt, spineAt } = profiles(a);
  const maxDepth = a.depth * len;
  const verts = [], uvs = [], idx = [];
  for (let s = 0; s <= N_ST; s++) {
    const t = s / N_ST;
    const halfH = Math.max(0.004, (maxDepth / 2) * depthAt(t));
    const halfW = Math.max(0.003, halfH * a.width * widthAt(t));
    const yOff = spineAt(t) * len;
    const z = (t - 0.5) * len;
    for (let r = 0; r <= N_R; r++) {
      const th = (r / N_R) * Math.PI * 2;
      verts.push(Math.sin(th) * halfW, Math.cos(th) * halfH + yOff, z);
      uvs.push(t, (Math.cos(th) + 1) / 2);
    }
  }
  const ring = N_R + 1;
  for (let s = 0; s < N_ST; s++) {
    for (let r = 0; r < N_R; r++) {
      const i0 = s * ring + r;
      idx.push(i0, i0 + 1, i0 + ring, i0 + 1, i0 + ring + 1, i0 + ring);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// --- Fins ---------------------------------------------------------------
// Shapes built in the XY plane (x = along body toward tail, y = up), then
// rotated so they stand in the fish's vertical plane.
function finShape(pts) {
  const sh = new THREE.Shape();
  sh.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.length === 4) sh.quadraticCurveTo(p[0], p[1], p[2], p[3]);
    else sh.lineTo(p[0], p[1]);
  }
  sh.closePath();
  const g = new THREE.ShapeGeometry(sh, 5);
  g.rotateY(-Math.PI / 2); // XY plane -> ZY plane (length along +Z)
  return g;
}

function tailGeometry(type, h) {
  const L = h * 1.15;
  switch (type) {
    case 'fork': return finShape([[0, 0], [L * 0.5, h * 0.28, L, h * 0.62], [L * 0.42, h * 0.06, L, -h * 0.55], [L * 0.5, -h * 0.24, 0, 0]]);
    case 'round': return finShape([[0, h * 0.3], [L * 0.9, h * 0.42, L * 0.85, 0], [L * 0.9, -h * 0.4, 0, -h * 0.3]]);
    case 'square': return finShape([[0, h * 0.32], [L * 0.8, h * 0.4], [L * 0.85, -h * 0.38], [0, -h * 0.32]]);
    case 'hetero': return finShape([[0, 0], [L * 0.6, h * 0.5, L * 1.25, h * 0.72], [L * 0.55, h * 0.1, L * 0.55, -h * 0.3], [L * 0.2, -h * 0.2, 0, 0]]);
    case 'point': return finShape([[0, h * 0.22], [L * 0.9, h * 0.05], [L * 0.9, -h * 0.05], [0, -h * 0.22]]);
    case 'whip': return finShape([[0, h * 0.1], [L * 2.6, 0], [0, -h * 0.1]]);
    default: return tailGeometry('fork', h);
  }
}

function dorsalGeometry(type, len, h) {
  if (type === 'spiny') {
    const pts = [[0, 0]];
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const x = len * (i / n);
      pts.push([x, h * (1 - 0.35 * (i / n)) * (i % 2 ? 0.82 : 1)]);
    }
    pts.push([len, 0]);
    return finShape(pts);
  }
  if (type === 'sail') return finShape([[0, 0], [len * 0.25, h, len * 0.75, h * 0.9], [len, h * 0.25, len, 0]]);
  if (type === 'ribbon') return finShape([[0, 0], [len * 0.2, h, len * 0.8, h * 0.85], [len, 0]]);
  if (type === 'double') {
    // Two fins merged in one geometry: spiny front, soft back.
    const front = finShape([[0, 0], [len * 0.18, h, len * 0.45, 0]]);
    const back = finShape([[len * 0.6, 0], [len * 0.7, h * 0.7, len * 1.0, 0]]);
    const merged = new THREE.BufferGeometry();
    const fa = front.getAttribute('position').array, ba = back.getAttribute('position').array;
    const fi = front.getIndex().array, bi = back.getIndex().array;
    const pos = new Float32Array(fa.length + ba.length);
    pos.set(fa); pos.set(ba, fa.length);
    const index = new Uint16Array(fi.length + bi.length);
    index.set(fi);
    for (let i = 0; i < bi.length; i++) index[fi.length + i] = bi[i] + fa.length / 3;
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setIndex(new THREE.BufferAttribute(index, 1));
    merged.computeVertexNormals();
    return merged;
  }
  // 'tri'
  return finShape([[0, 0], [len * 0.3, h, len * 0.55, h * 0.75], [len, 0, len * 0.7, 0]]);
}

// --- Prefab assembly ----------------------------------------------------
const cache = new Map(); // species.id -> { bodyGeo, tailGeo, finGeos, bodyMat, finMat, len, a }

function speciesParts(species) {
  if (cache.has(species.id)) return cache.get(species.id);
  const a = ARCH[species.style.arch] || ARCH.minnow;
  const len = visualLength(species);
  const parts = { a, len };

  if (a.special === 'ray') {
    // Stingray: broad flat disc + whip tail.
    const disc = new THREE.SphereGeometry(len * 0.33, 16, 10);
    disc.scale(1.55, 0.16, 1.25);
    parts.bodyGeo = disc;
    parts.tailGeo = tailGeometry('whip', len * 0.16);
  } else {
    parts.bodyGeo = buildBodyGeometry(species, a, len);
    parts.tailGeo = tailGeometry(a.tail, a.depth * len * (0.9 + (a.ped || 0.25)));
  }

  parts.bodyMat = new THREE.MeshStandardMaterial({
    map: makeSkinTexture(species), roughness: 0.42, metalness: 0.18,
  });
  const finC = new THREE.Color(species.style.fin);
  parts.finMat = new THREE.MeshStandardMaterial({
    color: finC, roughness: 0.55, metalness: 0.05,
    side: THREE.DoubleSide, transparent: true, opacity: 0.88,
  });
  cache.set(species.id, parts);
  return parts;
}

const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0c1014, roughness: 0.2 });
const eyeGeo = new THREE.SphereGeometry(1, 8, 6);

/**
 * Build a prefab instance. Returns { group, tail, len } — `tail` is the
 * caudal-fin mesh for swim animation; nose points toward -Z.
 */
export function buildFishMesh(species) {
  const { a, len, bodyGeo, tailGeo, bodyMat, finMat } = speciesParts(species);
  const g = new THREE.Group();

  const body = new THREE.Mesh(bodyGeo, bodyMat);
  g.add(body);

  const tail = new THREE.Mesh(tailGeo, finMat);
  tail.position.z = len * (a.special === 'ray' ? 0.38 : 0.485);
  g.add(tail);

  if (a.special !== 'ray') {
    const { depthAt, spineAt } = profiles(a);
    const maxDepth = a.depth * len;
    const topAt = (t) => spineAt(t) * len + (maxDepth / 2) * depthAt(t);
    const botAt = (t) => spineAt(t) * len - (maxDepth / 2) * depthAt(t);
    const zAt = (t) => (t - 0.5) * len;

    if (a.dorsal) {
      const d = a.dorsal;
      const fin = new THREE.Mesh(
        dorsalGeometry(d.type, d.len * len, d.h * maxDepth), finMat);
      fin.position.set(0, topAt(d.pos + d.len * 0.3) * 0.97, zAt(d.pos));
      g.add(fin);
    }
    if (a.anal) {
      const an = a.anal;
      const fin = new THREE.Mesh(
        dorsalGeometry(an.type || 'tri', an.len * len, an.h * maxDepth), finMat);
      fin.rotation.z = Math.PI; // flip under the belly
      fin.position.set(0, botAt(an.pos + an.len * 0.3) * 0.97, zAt(an.pos));
      g.add(fin);
    }
    if (a.adipose) {
      const fin = new THREE.Mesh(dorsalGeometry('tri', len * 0.05, maxDepth * 0.18), finMat);
      fin.position.set(0, topAt(0.8), zAt(0.8));
      g.add(fin);
    }
    // Pectoral fins
    for (const s of [1, -1]) {
      const fin = new THREE.Mesh(dorsalGeometry('tri', len * 0.12, maxDepth * 0.4), finMat);
      fin.position.set(s * a.width * maxDepth * 0.42, spineAt(0.25) * len - maxDepth * 0.12, zAt(0.24));
      fin.rotation.set(0, 0, s * 1.25);
      g.add(fin);
    }
    // Barbels
    if (a.barbels) {
      const bMat = finMat;
      for (let i = 0; i < a.barbels; i++) {
        const s = i % 2 ? 1 : -1;
        const row = Math.floor(i / 2);
        const b = new THREE.Mesh(
          new THREE.CylinderGeometry(0.004 * len, 0.012 * len, len * 0.16, 4), bMat);
        b.position.set(s * maxDepth * 0.2, spineAt(0.06) * len - maxDepth * 0.1 * row,
          zAt(a.snout === 'point' ? 0.18 : 0.05));
        b.rotation.set(0.9, 0, s * (0.7 + row * 0.4));
        g.add(b);
      }
    }
    // Eyes
    const eyeR = clamp(maxDepth * 0.085, 0.008, 0.05);
    for (const s of [1, -1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.scale.setScalar(eyeR);
      eye.position.set(
        s * a.width * maxDepth * 0.38,
        spineAt(0.14) * len + maxDepth * 0.16,
        zAt(a.snout === 'gar' || a.snout === 'paddle' ? 0.32 : 0.13));
      g.add(eye);
    }
  } else {
    // Ray eyes on top of the disc.
    for (const s of [1, -1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.scale.setScalar(len * 0.02);
      eye.position.set(s * len * 0.09, len * 0.055, -len * 0.16);
      g.add(eye);
    }
  }

  return { group: g, tail, len };
}
