// The infinite, procedurally generated water and the country around it.
// Chunks stream in around the boat and are disposed when far away; each
// carries its ground (terrain.js), the props its regions strew over it
// (props.js), the features built into it, its hotspots and its landmarks.
// The one big water plane follows the boat and is re-coloured per vertex
// from the regions under it, so a lagoon is turquoise, a marsh is brown
// and the sea beyond the coast is a deep blue with white on its crests.

import * as THREE from 'three';
import { CONFIG, LURES } from './config.js';
import { fbm, hash2, mulberry32, clamp, lerp } from './noise.js';
import { chunkDocks } from './docks.js';
import { terrainHeight, waterDepth, cellFeatures } from './terrain.js';
import { isNavigable } from './nav.js';
import { currentAt, FlowField } from './currents.js';
import { CELL, regionBlend, regionAt, salinity, waterKind, mixHex } from './regions.js';
import { buildChunkProps, buildFalls, buildBoulders, buildDam, buildLodge, buildStack, tickEffects, updateBrush } from './props.js'
import { RockWakes, tickRockWakes } from './wake.js';

export { terrainHeight, waterDepth, isNavigable, salinity, waterKind, regionAt, currentAt };
const _still = { x: 0, z: 0 };
/** Water that is not going anywhere: no current worth the name. */
export function isStill(x, z) { currentAt(x, z, _still); return Math.hypot(_still.x, _still.z) < 0.1; }

const S = CONFIG.SEED;

// --- Terrain coloring ---
const COL = {
  deep: new THREE.Color(0x14424e),
  bed: new THREE.Color(0x4e6a52),
  mud: new THREE.Color(0x5a5a3a),
  snow: new THREE.Color(0xf2f5f7),
};
const tmpC = new THREE.Color();
const tmpC2 = new THREE.Color();

function setMix(out, h1, h2, w) {
  const c = mixHex(h1, h2, w);
  return out.setRGB(c.r, c.g, c.b);
}

function colorAt(h, x, z, out) {
  const bl = regionBlend(x, z);
  const A = bl.a.biome, B = bl.b.biome, wa = bl.wa;
  const murk = A.water.murk * wa + B.water.murk * bl.wb;
  if (h < -4) out.copy(COL.deep);
  else if (h < -0.6) {
    out.copy(COL.bed).lerp(COL.mud, murk).lerp(setMix(tmpC2, A.land.shore, B.land.shore, wa), (h + 4) / 3.4 * 0.55);
  } else if (h < 0.7) setMix(out, A.land.shore, B.land.shore, wa);
  else if (h < 3.2) {
    setMix(out, A.land.grass, B.land.grass, wa).lerp(setMix(tmpC2, A.land.forest, B.land.forest, wa), (h - 0.7) / 2.5);
  } else if (h < 6.5) setMix(out, A.land.forest, B.land.forest, wa);
  else setMix(out, A.land.rock, B.land.rock, wa);
  // Snow above the region's snowline, where it has one.
  const snowline = A.land.snow * wa + B.land.snow * bl.wb;
  const snowy = (A.land.snow ? wa : 0) + (B.land.snow ? bl.wb : 0);
  if (snowy > 0.01 && h > 5) {
    const line = snowline / Math.max(0.01, snowy);
    const k = clamp((h - line) / 2.5, 0, 1) * snowy;
    if (k > 0) out.lerp(COL.snow, k);
  }
  // Subtle deterministic variation so it doesn't look flat-shaded dull
  // (gentler under water so the lakebed reads calm through the surface).
  const amp = h < 0 ? 0.05 : 0.12;
  const v = hash2(Math.floor(x * 2), Math.floor(z * 2), S + 77) * amp - amp / 2;
  out.offsetHSL(0, 0, v);
  return out;
}

// --- Chunk ---
class Chunk {
  constructor(cx, cz, parentGroup) {
    this.cx = cx; this.cz = cz;
    const size = CONFIG.CHUNK_SIZE, res = CONFIG.CHUNK_RES;
    const ox = cx * size, oz = cz * size;
    this.ox = ox; this.oz = oz;

    const geo = new THREE.PlaneGeometry(size, size, res, res);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + ox, z = pos.getZ(i) + oz;
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      colorAt(h, x, z, tmpC);
      colors[i * 3] = tmpC.r; colors[i * 3 + 1] = tmpC.g; colors[i * 3 + 2] = tmpC.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    this.mesh = new THREE.Mesh(geo, Chunk.material);
    this.mesh.position.set(ox, 0, oz);
    this.mesh.receiveShadow = true;
    parentGroup.add(this.mesh);

    const props = buildChunkProps(cx, cz, parentGroup);
    this.props = props.meshes;
    this.brush = props.brush;
    this.features = [];          // { dispose(), update?(t) }
    this.landmarks = [];
    this.hotspots = this.buildHotspots(ox, oz, size);
    this.buildFeatures(parentGroup);
    this.docks = chunkDocks(cx, cz);
  }

  /** The built features and landmarks of every region cell this chunk overlaps. */
  buildFeatures(parent) {
    const half = CONFIG.CHUNK_SIZE / 2;
    const x0 = this.ox - half, x1 = this.ox + half, z0 = this.oz - half, z1 = this.oz + half;
    const inside = (p) => p.x >= x0 && p.x < x1 && p.z >= z0 && p.z < z1;
    const c0x = Math.floor(x0 / CELL), c1x = Math.floor((x1 - 0.01) / CELL);
    const c0z = Math.floor(z0 / CELL), c1z = Math.floor((z1 - 0.01) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const f = cellFeatures(cx, cz);
        for (const fall of f.falls) if (inside(fall)) this.features.push(buildFalls(fall, parent));
        for (const d of f.dams) if (inside(d)) this.features.push(buildDam(d, parent));
        for (const l of f.lodges) if (inside(l)) { const im = buildLodge(l, parent); if (im) this.features.push({ dispose: () => { parent.remove(im); im.dispose(); } }); }
        for (const st of f.stacks) if (inside(st)) this.features.push(buildStack(st, parent));
        const boulders = f.boulders.filter(inside);
        if (boulders.length) {
          const im = buildBoulders(boulders, parent);
          this.features.push({ dispose: () => { parent.remove(im); im.dispose(); } });
          // Every boulder in a current gets a boat's wake: the water is the hull here.
          this.features.push(new RockWakes(boulders, parent, currentAt, (b) => regionAt(b.x, b.z).flow || 0));
        }
        for (const lm of f.landmarks) if (inside(lm)) this.landmarks.push(lm);
        for (const hs of f.hotspots) {
          if (!inside(hs)) continue;
          this.hotspots.push({ x: hs.x, z: hs.z, strength: hs.strength, phase: hs.phase, lureId: LURES[hs.lureIdx % LURES.length].id });
        }
      }
    }
  }

  buildHotspots(ox, oz, size) {
    const rng = mulberry32((hash2(this.cx, this.cz, S + 9) * 1e9) | 0);
    const found = [];
    for (let i = 0; i < 6 && found.length < 2; i++) {
      const x = ox + (rng() - 0.5) * (size - 8);
      const z = oz + (rng() - 0.5) * (size - 8);
      const d = waterDepth(x, z);
      const sea = regionAt(x, z).type === 'ocean';
      let ok;
      if (sea) {
        // Out at sea a hotspot is a reef or a bait ball: anywhere with depth, fewer of them.
        ok = d >= 3 && d <= 16 && rng() < 0.45;
      } else {
        if (d < 1.2 || d > 5.5) continue;
        // Require nearby shore: coves, deltas and passage mouths qualify.
        let shore = 0;
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2;
          if (terrainHeight(x + Math.cos(ang) * 13, z + Math.sin(ang) * 13) > 0.3) shore++;
        }
        ok = shore >= 2 && shore <= 6;
      }
      if (ok) {
        // Each spot favours one bait. This only changes how OFTEN fish show
        // up for that bait, never what a catch is worth, so the sonar that
        // reveals it cannot shift the expected value of a bet.
        found.push({
          x, z,
          strength: 0.8 + rng() * 0.6,
          phase: rng() * Math.PI * 2,
          lureId: LURES[Math.floor(rng() * LURES.length)].id,
        });
      }
    }
    return found;
  }

  update(t, dt, x, z) {
    for (const f of this.features) if (f.update) f.update(t, dt, x, z);
  }

  dispose(parentGroup) {
    parentGroup.remove(this.mesh);
    this.mesh.geometry.dispose();
    for (const im of this.props) { parentGroup.remove(im); im.dispose(); }
    for (const f of this.features) f.dispose();
  }
}

Chunk.material = new THREE.MeshLambertMaterial({ vertexColors: true });

// --- Hotspot FX: concentric expanding ripple rings + choppy foam sprites ---
class HotspotFX {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.ringGeo = new THREE.RingGeometry(0.9, 1.0, 28);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xdff4ff, transparent: true, opacity: 0.5, depthWrite: false,
    });
    this.active = new Map(); // hotspot -> {rings:[], foam}
  }

  sync(hotspots) {
    for (const hs of hotspots) {
      if (!this.active.has(hs)) {
        const rings = [];
        for (let i = 0; i < 3; i++) {
          const ring = new THREE.Mesh(this.ringGeo, this.ringMat.clone());
          ring.position.set(hs.x, CONFIG.WATER_LEVEL + 0.06, hs.z);
          this.group.add(ring);
          rings.push(ring);
        }
        this.active.set(hs, { rings });
      }
    }
    for (const [hs, fx] of this.active) {
      if (!hotspots.includes(hs)) {
        for (const r of fx.rings) { this.group.remove(r); r.material.dispose(); }
        this.active.delete(hs);
      }
    }
  }

  update(t) {
    for (const [hs, fx] of this.active) {
      fx.rings.forEach((ring, i) => {
        const cycle = ((t * 0.45 + hs.phase + i / 3) % 1);
        const r = 1 + cycle * CONFIG.HOTSPOT_RADIUS * 0.85 * hs.strength;
        ring.scale.setScalar(r);
        ring.material.opacity = 0.42 * (1 - cycle);
        // choppy water: rings jitter vertically
        ring.position.y = CONFIG.WATER_LEVEL + 0.06 + Math.sin(t * 6 + i * 2 + hs.phase) * 0.05;
      });
    }
  }
}

// --- Water surface: big transparent plane with animated shader waves ---
const WATER_SEG = 104;

function makeWater() {
  const geo = new THREE.PlaneGeometry(CONFIG.CHUNK_SIZE * 9, CONFIG.CHUNK_SIZE * 9, WATER_SEG, WATER_SEG);
  geo.rotateX(-Math.PI / 2);
  const n = geo.attributes.position.count;
  geo.setAttribute('aShallow', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aDeep', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aChop', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute('aMurk', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute('aSalt', new THREE.BufferAttribute(new Float32Array(n), 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uSky: { value: new THREE.Color(0xcfe9f4) },
      uSun: { value: new THREE.Color(0xfff4e0) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3).normalize() },
      uSunset: { value: 0 },
    },
    vertexShader: /* glsl */`
      uniform float uTime;
      attribute vec3 aShallow, aDeep;
      attribute float aChop, aMurk, aDepth, aSalt;
      varying vec3 vWorld, vShallow, vDeep;
      varying float vWave, vChop, vMurk, vDepth, vCrest, vSalt;
      varying vec2 vGrad;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float w = sin(wp.x * 0.35 + uTime * 1.1) * 0.05
                + sin(wp.z * 0.28 - uTime * 0.9) * 0.05
                + sin((wp.x + wp.z) * 0.12 + uTime * 0.6) * 0.07;
        // Open water carries a swell: two trains of waves crossing, with
        // peaked crests and long troughs (a sine raised to a power), the
        // surface pulled toward each crest so the faces steepen (Gerstner),
        // and a slope handed to the fragment shader to light the faces.
        vec2 d1 = normalize(vec2(0.86, 0.5)), d2 = normalize(vec2(-0.35, 0.94));
        float k1 = 0.075, k2 = 0.115;
        float ph1 = dot(wp.xz, d1) * k1 - uTime * 0.42 + sin(wp.z * 0.02) * 1.2;
        float ph2 = dot(wp.xz, d2) * k2 - uTime * 0.55 + sin(wp.x * 0.03) * 0.9;
        float s1 = pow(0.5 + 0.5 * sin(ph1), 1.8) * 2.0 - 1.0;
        float s2 = pow(0.5 + 0.5 * sin(ph2), 1.8) * 2.0 - 1.0;
        float swell = s1 * 0.6 + s2 * 0.36;
        wp.xz -= (d1 * cos(ph1) * 0.32 + d2 * cos(ph2) * 0.2) * aChop;
        vGrad = (d1 * cos(ph1) * 0.6 * k1 * 1.8 + d2 * cos(ph2) * 0.36 * k2 * 1.8) * aChop;
        w = w * (1.0 + aChop * 2.0) + swell * aChop;
        wp.y += w;
        vWave = w; vCrest = swell;
        vWorld = wp.xyz;
        vShallow = aShallow; vDeep = aDeep; vChop = aChop; vMurk = aMurk; vDepth = aDepth; vSalt = aSalt;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uSky, uSun, uSunDir;
      uniform float uSunset;
      varying vec3 vWorld, vShallow, vDeep;
      varying float vWave, vChop, vMurk, vDepth, vCrest, vSalt;
      varying vec2 vGrad;
      float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        float a = hash21(i), b = hash21(i + vec2(1, 0)), c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      void main() {
        float sp1 = sin(vWorld.x * 1.4 + uTime * 1.5 + sin(vWorld.z * 0.7) * 2.0);
        float sp2 = sin(vWorld.z * 1.1 - uTime * 1.2 + sin(vWorld.x * 0.9) * 2.0);
        float sparkle = smoothstep(0.94, 1.0, sp1 * sp2);
        vec3 col = mix(vDeep, vShallow, 0.5 + vWave * 2.2 / (1.0 + vChop * 2.0));
        col = mix(col, uSky, sparkle * 0.2);
        vec3 viewDir = normalize(cameraPosition - vWorld);
        // The swell's faces: lit toward the sun, shaded away from it, with
        // the sun's glitter down the faces that catch it. Rough water only.
        vec3 N = normalize(vec3(-vGrad.x, 1.0, -vGrad.y));
        float ndl = dot(N, uSunDir);
        col *= 1.0 + (ndl - 0.7) * 0.9 * vChop;
        // Chop: small water heaped between the swells, so the surface is
        // never a smooth face.
        float bump = vnoise(vWorld.xz * 0.9 + vec2(uTime * 0.35, -uTime * 0.2)) + vnoise(vWorld.xz * 2.6 - vec2(uTime * 0.5, uTime * 0.4)) * 0.5;
        // The sea alone: fresh water keeps its calm face so the eddies show.
        float sea = smoothstep(0.45, 0.95, vSalt);
        col *= 1.0 + (bump - 0.75) * 0.32 * vChop * sea;
        float fres = pow(1.0 - abs(viewDir.y), 2.0);
        col = mix(col, uSky, fres * 0.45);
        // At sunset the whole surface takes the sky's warmth: the water
        // holds the pink of the sky, more of it the flatter the view.
        vec3 warm = mix(col * vec3(0.82, 0.74, 0.98), uSky * 0.92, fres * 0.75);
        col = mix(col, warm, uSunset * 0.7);
        // Whitecaps: the crests of the swell break where the water is rough,
        // into streaks of foam torn along the wind, and the glitter runs in
        // long thin lines along the wave trains, thickest in the trough
        // between two crests of chop.
        float n = vnoise(vWorld.xz * 0.45 + vec2(uTime * 0.25, -uTime * 0.15));
        float n2 = vnoise(vWorld.xz * 1.8 - vec2(uTime * 0.6, uTime * 0.3));
        vec2 d1 = normalize(vec2(0.86, 0.5));
        vec2 p1 = vec2(dot(vWorld.xz, d1), dot(vWorld.xz, vec2(-d1.y, d1.x)));
        float streak = vnoise(vec2(p1.x * 0.32 - uTime * 0.25, p1.y * 2.4 + n * 2.0));
        float cap = smoothstep(0.55, 0.9, vCrest) * smoothstep(0.62, 0.86, n2 * 0.55 + streak * 0.6) * vChop * 0.7;
        float ph = p1.x * 0.075 - uTime * 0.42 + sin(vWorld.z * 0.02) * 1.2;
        float lines = smoothstep(0.955, 0.996, sin(ph * 13.0 + n * 1.4)) * smoothstep(0.28, 0.5, n) * (0.6 + 0.4 * n2) * vChop * sea;
        cap = min(1.0, cap + lines * 0.95);
        // Surf: waves breaking on the shore, more of it the rougher the water.
        float pulse = 0.5 + 0.5 * sin(uTime * 1.6 + vWorld.x * 0.12 + vWorld.z * 0.08 + n * 4.0);
        float surf = smoothstep(1.5, 0.0, vDepth) * smoothstep(0.35, 0.8, n2 * 0.6 + pulse * 0.55) * (0.25 + vChop * 0.75);
        col = mix(col, mix(vec3(1.0), uSky, uSunset * 0.35), clamp(cap * 0.95 + surf * 0.8, 0.0, 1.0));
        float alpha = 0.55 + fres * 0.2 + vMurk * 0.3 + cap * 0.35 + surf * 0.3;
        gl_FragColor = vec4(col, min(alpha, 0.98));
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = CONFIG.WATER_LEVEL;
  mesh.renderOrder = 2;
  return mesh;
}

export class Lake {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.chunks = new Map();
    this.water = makeWater();
    scene.add(this.water);
    this.fx = new HotspotFX(scene);
    this.flow = new FlowField(scene);
    this.hotspots = [];
    this.docks = [];
    this.landmarks = [];
    this.onDocksChanged = null;
    this.onLandmarksChanged = null;
    this.waterTile = null;
    this._cur = { x: 0, z: 0 };
    this._white = new THREE.Color(0xffffff);
    this._climate = { sky: new THREE.Color(), fog: new THREE.Color(), sun: new THREE.Color(), near: 90, far: 220, sunI: 2.4, amb: 0.75, precip: 0, snow: 0 };
  }

  key(cx, cz) { return cx + '|' + cz; }

  ensureChunks(x, z) {
    const size = CONFIG.CHUNK_SIZE, r = CONFIG.VIEW_CHUNKS;
    const ccx = Math.round(x / size), ccz = Math.round(z / size);
    let changed = false;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const k = this.key(ccx + dx, ccz + dz);
        if (!this.chunks.has(k)) {
          this.chunks.set(k, new Chunk(ccx + dx, ccz + dz, this.group));
          changed = true;
        }
      }
    }
    for (const [k, chunk] of this.chunks) {
      if (Math.abs(chunk.cx - ccx) > r + 1 || Math.abs(chunk.cz - ccz) > r + 1) {
        chunk.dispose(this.group);
        this.chunks.delete(k);
        changed = true;
      }
    }
    if (changed) {
      this.hotspots = [];
      this.docks = [];
      this.landmarks = [];
      for (const chunk of this.chunks.values()) {
        this.hotspots.push(...chunk.hotspots);
        this.docks.push(...chunk.docks);
        this.landmarks.push(...chunk.landmarks);
      }
      this.fx.sync(this.hotspots);
      if (this.onDocksChanged) this.onDocksChanged(this.docks);
      if (this.onLandmarksChanged) this.onLandmarksChanged(this.landmarks);
    }
    // Water follows the boat in whole-tile steps to appear infinite, and is
    // re-coloured from the regions under it whenever it steps.
    const tile = ccx + '|' + ccz;
    if (tile !== this.waterTile) {
      this.waterTile = tile;
      this.water.position.x = ccx * size;
      this.water.position.z = ccz * size;
      this.refreshWater(ccx * size, ccz * size);
    }
  }

  /** The light on the water: the sun's colour and direction and how far into sunset. */
  setLight(sunColor, sunDir, sunset, sky) {
    const u = this.water.material.uniforms;
    if (sky) u.uSky.value.copy(sky).lerp(this._white, 0.25);
    u.uSun.value.copy(sunColor);
    u.uSunDir.value.copy(sunDir).normalize();
    u.uSunset.value = sunset;
  }

  /** Colour, chop, murk and depth per water vertex from what lies under it. */
  refreshWater(ox, oz) {
    const geo = this.water.geometry;
    const pos = geo.attributes.position;
    const sh = geo.attributes.aShallow, dp = geo.attributes.aDeep;
    const chop = geo.attributes.aChop, murk = geo.attributes.aMurk, depth = geo.attributes.aDepth, salt = geo.attributes.aSalt;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + ox, z = pos.getZ(i) + oz;
      const bl = regionBlend(x, z);
      const A = bl.a.biome.water, B = bl.b.biome.water, wa = bl.wa, wb = bl.wb;
      // Salt water is the sea's colour whatever region it lies in, so the
      // brackish band shades from river to ocean on its own.
      const s = salinity(x, z);
      let c = mixHex(A.shallow, B.shallow, wa);
      let d = mixHex(A.deep, B.deep, wa);
      if (s > 0) {
        const oc = mixHex(0x2f8fb9, 0x2f8fb9, 1), od = mixHex(0x0b3a63, 0x0b3a63, 1);
        c = { r: lerp(c.r, oc.r, s), g: lerp(c.g, oc.g, s), b: lerp(c.b, oc.b, s) };
        d = { r: lerp(d.r, od.r, s), g: lerp(d.g, od.g, s), b: lerp(d.b, od.b, s) };
      }
      sh.setXYZ(i, c.r, c.g, c.b);
      dp.setXYZ(i, d.r, d.g, d.b);
      chop.setX(i, Math.max(A.chop * wa + B.chop * wb, s));
      murk.setX(i, (A.murk * wa + B.murk * wb) * (1 - s));
      salt.setX(i, s);
      const h = terrainHeight(x, z);
      depth.setX(i, h < 0 ? -h : 0);
    }
    sh.needsUpdate = dp.needsUpdate = chop.needsUpdate = murk.needsUpdate = depth.needsUpdate = salt.needsUpdate = true;
  }

  nearestHotspot(x, z) {
    let best = null, bestD = Infinity;
    for (const hs of this.hotspots) {
      const d = Math.hypot(hs.x - x, hs.z - z);
      if (d < bestD) { bestD = d; best = hs; }
    }
    return best ? { hotspot: best, dist: bestD } : { hotspot: null, dist: Infinity };
  }

  // 0..1 hotness at a position (1 = dead center of a strong hotspot)
  hotness(x, z) {
    const spot = this.hotspotAt(x, z);
    return spot ? spot.hotness : 0;
  }

  /** The hotspot covering a point, with its 0..1 hotness, or null. */
  hotspotAt(x, z) {
    const { hotspot, dist } = this.nearestHotspot(x, z);
    if (!hotspot) return null;
    const hotness = clamp(1 - dist / (CONFIG.HOTSPOT_RADIUS * hotspot.strength), 0, 1);
    return hotness > 0 ? { hotspot, dist, hotness } : null;
  }

  /** Hotspots within `range` of a point, nearest first (sonar readout). */
  hotspotsNear(x, z, range) {
    return this.hotspots
      .map((hs) => ({ hotspot: hs, dist: Math.hypot(hs.x - x, hs.z - z) }))
      .filter((e) => e.dist <= range)
      .sort((a, b) => a.dist - b.dist);
  }

  update(t, boatX, boatZ, dt = 0.016, vessels = null) {
    this.ensureChunks(boatX, boatZ);
    this.water.material.uniforms.uTime.value = t;
    this.fx.update(t);
    tickEffects(t);
    tickRockWakes(t);
    this.flow.update(dt, boatX, boatZ, t);
    for (const chunk of this.chunks.values()) chunk.update(t, dt, boatX, boatZ);
    // The soft props bend out of the hulls' way, in the chunks near them.
    if (vessels && vessels.length) {
      const size = CONFIG.CHUNK_SIZE;
      for (const chunk of this.chunks.values()) {
        if (!chunk.brush.length) continue;
        let near = chunk.brushing || false;
        for (const v of vessels) if (Math.abs(v.pos.x - chunk.ox) < size && Math.abs(v.pos.z - chunk.oz) < size) near = true;
        if (near) chunk.brushing = updateBrush(chunk.brush, vessels, dt);
      }
    }
  }

  // --- what is where ---
  /** The region a point is in: { name, type, biome, ... }. */
  regionAt(x, z) { return regionAt(x, z); }
  /** 'fresh' | 'brackish' | 'salt'. */
  waterKind(x, z) { return waterKind(x, z); }
  salinity(x, z) { return salinity(x, z); }
  /** Rapids carry a hull along: {x, z} m/s. */
  currentAt(x, z, out = this._cur) { return currentAt(x, z, out); }

  /** How rough the water is here, 0 flat calm .. 1 open sea. */
  chopAt(x, z) {
    const bl = regionBlend(x, z);
    return Math.max(bl.a.biome.water.chop * bl.wa + bl.b.biome.water.chop * bl.wb, salinity(x, z));
  }

  /** The climate of the regions at a point, blended. One reused object. */
  climateAt(x, z) {
    const bl = regionBlend(x, z);
    const A = bl.a.biome.climate, B = bl.b.biome.climate, wa = bl.wa, wb = bl.wb;
    const c = this._climate;
    let m = mixHex(A.sky, B.sky, wa); c.sky.setRGB(m.r, m.g, m.b);
    m = mixHex(A.fog, B.fog, wa); c.fog.setRGB(m.r, m.g, m.b);
    m = mixHex(A.sun, B.sun, wa); c.sun.setRGB(m.r, m.g, m.b);
    c.near = A.near * wa + B.near * wb;
    c.far = A.far * wa + B.far * wb;
    c.sunI = A.sunI * wa + B.sunI * wb;
    c.amb = A.amb * wa + B.amb * wb;
    c.precip = A.precip * wa + B.precip * wb;
    c.snow = A.snow * wa + B.snow * wb;
    return c;
  }

  // Small wave height used to bob the boat with the shader waves.
  waveHeight(x, z, t) {
    const chop = this.chopAt(x, z);
    const w = Math.sin(x * 0.35 + t * 1.1) * 0.05
      + Math.sin(z * 0.28 - t * 0.9) * 0.05
      + Math.sin((x + z) * 0.12 + t * 0.6) * 0.07;
    // The same two crossing wave trains the surface shader raises.
    const ph1 = (x * 0.8646 + z * 0.5027) * 0.075 - t * 0.42 + Math.sin(z * 0.02) * 1.2;
    const ph2 = (x * -0.3491 + z * 0.9371) * 0.115 - t * 0.55 + Math.sin(x * 0.03) * 0.9;
    const s1 = Math.pow(0.5 + 0.5 * Math.sin(ph1), 1.8) * 2 - 1;
    const s2 = Math.pow(0.5 + 0.5 * Math.sin(ph2), 1.8) * 2 - 1;
    const swell = s1 * 0.6 + s2 * 0.36;
    return w * (1 + chop * 2) + swell * chop;
  }
}

export { fbm };
