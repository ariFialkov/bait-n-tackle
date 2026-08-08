// Infinite procedurally generated lake. Terrain height is a seeded,
// domain-warped fbm with ridged channels carved through the land, giving
// uneven shorelines, coves and narrow passageways. Chunks stream in around
// the boat and are disposed when far away. Hotspots (good fishing spots) are
// placed deterministically per chunk near interesting shore geometry and get
// rough-water ripple FX.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { fbm, hash2, mulberry32, clamp } from './noise.js';

const S = CONFIG.SEED;

// Terrain height in meters relative to water level (negative = under water).
export function terrainHeight(x, z) {
  // Domain warp for organic, uneven shorelines.
  const wx = x + 34 * fbm(x * 0.009 + 13.7, z * 0.009 + 7.1, 3, S + 11);
  const wz = z + 34 * fbm(x * 0.009 - 8.2, z * 0.009 + 21.4, 3, S + 23);

  let h = fbm(wx * 0.016, wz * 0.016, 4, S) * 8;   // broad land/water masses
  h += fbm(x * 0.06, z * 0.06, 3, S + 37) * 1.1;   // shoreline detail
  h += 1.4;                                        // bias: ~55% water

  // Carve winding narrow channels between basins.
  const c = 1 - Math.abs(fbm(x * 0.006 + 3.1, z * 0.006 - 4.7, 2, S + 51));
  if (c > 0.86) h -= (c - 0.86) * 55;

  // Guarantee open water at the spawn point.
  const d2 = x * x + z * z;
  h -= 7 * Math.exp(-d2 / (2 * 42 * 42));

  return h;
}

export function waterDepth(x, z) {
  const h = terrainHeight(x, z);
  return h < 0 ? -h : 0;
}

export function isNavigable(x, z) {
  return waterDepth(x, z) >= CONFIG.MIN_NAV_DEPTH;
}

// --- Terrain coloring ---
const COL = {
  deep: new THREE.Color(0x14424e),
  bed: new THREE.Color(0x4e6a52),
  sand: new THREE.Color(0xdcc98d),
  grass: new THREE.Color(0x5f9e4e),
  forest: new THREE.Color(0x3c7442),
  rock: new THREE.Color(0x8a8f87),
};
const tmpC = new THREE.Color();

function colorAt(h, x, z, out) {
  if (h < -4) out.copy(COL.deep);
  else if (h < -0.6) out.copy(COL.bed).lerp(COL.sand, (h + 4) / 3.4 * 0.55);
  else if (h < 0.7) out.copy(COL.sand);
  else if (h < 3.2) out.copy(COL.grass).lerp(COL.forest, (h - 0.7) / 2.5);
  else if (h < 6.5) out.copy(COL.forest);
  else out.copy(COL.rock);
  // Subtle deterministic variation so it doesn't look flat-shaded dull
  // (gentler under water so the lakebed reads calm through the surface).
  const amp = h < 0 ? 0.05 : 0.12;
  const v = hash2(Math.floor(x * 2), Math.floor(z * 2), S + 77) * amp - amp / 2;
  out.offsetHSL(0, 0, v);
  return out;
}

// --- Chunk ---
class Chunk {
  constructor(cx, cz, parentGroup, treeMaterials) {
    this.cx = cx; this.cz = cz;
    const size = CONFIG.CHUNK_SIZE, res = CONFIG.CHUNK_RES;
    const ox = cx * size, oz = cz * size;

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
    parentGroup.add(this.mesh);

    this.trees = this.buildTrees(ox, oz, size, treeMaterials, parentGroup);
    this.hotspots = this.buildHotspots(ox, oz, size);
  }

  buildTrees(ox, oz, size, mats, parentGroup) {
    const rng = mulberry32((hash2(this.cx, this.cz, S + 5) * 1e9) | 0);
    const spots = [];
    for (let i = 0; i < 60; i++) {
      const x = ox + (rng() - 0.5) * size;
      const z = oz + (rng() - 0.5) * size;
      const h = terrainHeight(x, z);
      if (h > 1.4 && h < 6.0 && rng() < 0.65) spots.push({ x, z, h, s: 0.7 + rng() * 0.9 });
    }
    if (!spots.length) return null;

    const canopy = new THREE.InstancedMesh(Chunk.canopyGeo, mats.canopy, spots.length);
    const trunk = new THREE.InstancedMesh(Chunk.trunkGeo, mats.trunk, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    spots.forEach((t, i) => {
      sc.setScalar(t.s);
      p.set(t.x, t.h + 1.6 * t.s, t.z);
      m.compose(p, q, sc); canopy.setMatrixAt(i, m);
      p.set(t.x, t.h + 0.5 * t.s, t.z);
      m.compose(p, q, sc); trunk.setMatrixAt(i, m);
    });
    canopy.instanceMatrix.needsUpdate = trunk.instanceMatrix.needsUpdate = true;
    parentGroup.add(canopy, trunk);
    return { canopy, trunk };
  }

  buildHotspots(ox, oz, size) {
    const rng = mulberry32((hash2(this.cx, this.cz, S + 9) * 1e9) | 0);
    const found = [];
    for (let i = 0; i < 6 && found.length < 2; i++) {
      const x = ox + (rng() - 0.5) * (size - 8);
      const z = oz + (rng() - 0.5) * (size - 8);
      const d = waterDepth(x, z);
      if (d < 1.2 || d > 5.5) continue;
      // Require nearby shore: coves, deltas and passage mouths qualify.
      let shore = 0;
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        if (terrainHeight(x + Math.cos(ang) * 13, z + Math.sin(ang) * 13) > 0.3) shore++;
      }
      if (shore >= 2 && shore <= 6) {
        found.push({ x, z, strength: 0.8 + rng() * 0.6, phase: rng() * Math.PI * 2 });
      }
    }
    return found;
  }

  dispose(parentGroup) {
    parentGroup.remove(this.mesh);
    this.mesh.geometry.dispose();
    if (this.trees) {
      parentGroup.remove(this.trees.canopy, this.trees.trunk);
      this.trees.canopy.dispose();
      this.trees.trunk.dispose();
    }
  }
}

Chunk.material = new THREE.MeshLambertMaterial({ vertexColors: true });
Chunk.canopyGeo = new THREE.ConeGeometry(1.1, 2.6, 6);
Chunk.trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.2, 5);

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
function makeWater() {
  const geo = new THREE.PlaneGeometry(CONFIG.CHUNK_SIZE * 9, CONFIG.CHUNK_SIZE * 9, 96, 96);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(0x3fa9c9) },
      uDeep: { value: new THREE.Color(0x14607f) },
      uSky: { value: new THREE.Color(0xcfe9f4) },
    },
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec3 vWorld;
      varying float vWave;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float w = sin(wp.x * 0.35 + uTime * 1.1) * 0.05
                + sin(wp.z * 0.28 - uTime * 0.9) * 0.05
                + sin((wp.x + wp.z) * 0.12 + uTime * 0.6) * 0.07;
        wp.y += w;
        vWave = w;
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uShallow, uDeep, uSky;
      varying vec3 vWorld;
      varying float vWave;
      void main() {
        float sp1 = sin(vWorld.x * 1.4 + uTime * 1.5 + sin(vWorld.z * 0.7) * 2.0);
        float sp2 = sin(vWorld.z * 1.1 - uTime * 1.2 + sin(vWorld.x * 0.9) * 2.0);
        float sparkle = smoothstep(0.94, 1.0, sp1 * sp2);
        vec3 col = mix(uDeep, uShallow, 0.5 + vWave * 2.2);
        col = mix(col, uSky, sparkle * 0.2);
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - abs(viewDir.y), 2.0);
        col = mix(col, uSky, fres * 0.45);
        gl_FragColor = vec4(col, 0.55 + fres * 0.2);
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
    this.treeMaterials = {
      canopy: new THREE.MeshLambertMaterial({ color: 0x2f6b38 }),
      trunk: new THREE.MeshLambertMaterial({ color: 0x6b4a2f }),
    };
    this.water = makeWater();
    scene.add(this.water);
    this.fx = new HotspotFX(scene);
    this.hotspots = [];
    this.ensureChunks(0, 0);
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
          this.chunks.set(k, new Chunk(ccx + dx, ccz + dz, this.group, this.treeMaterials));
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
      for (const chunk of this.chunks.values()) this.hotspots.push(...chunk.hotspots);
      this.fx.sync(this.hotspots);
    }
    // Water follows the boat in whole-tile steps to appear infinite.
    this.water.position.x = ccx * size;
    this.water.position.z = ccz * size;
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
    const { hotspot, dist } = this.nearestHotspot(x, z);
    if (!hotspot) return 0;
    return clamp(1 - dist / (CONFIG.HOTSPOT_RADIUS * hotspot.strength), 0, 1);
  }

  update(t, boatX, boatZ) {
    this.ensureChunks(boatX, boatZ);
    this.water.material.uniforms.uTime.value = t;
    this.fx.update(t);
  }

  // Small wave height used to bob the boat with the shader waves.
  waveHeight(x, z, t) {
    return Math.sin(x * 0.35 + t * 1.1) * 0.05
      + Math.sin(z * 0.28 - t * 0.9) * 0.05
      + Math.sin((x + z) * 0.12 + t * 0.6) * 0.07;
  }
}
