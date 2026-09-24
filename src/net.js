// Cloth-physics trawl net: a funnel of Verlet particles towed behind the
// boat on two warps from the stern. Water drag, buoyancy toward just below
// the surface and distance constraints make it billow, swing wide in turns
// and settle like a real net; a spreading push on the mouth stands in for
// the otter boards that hold a real trawl open. Drawn as a square rope mesh
// (every rope a line, twice as fine as the particle grid) over a faint skin,
// with cork floats along the headline.
//
// Fish the trawl catches are shown flopping in the cod end. They are the
// fish the bet already produced (fishing.js resolves the haul first, then
// hands them here): a picture of the result, never a preview of it.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildFishMesh, visualLength } from './fishmodels.js';

const NX = 9;              // particles across the mouth
const NZ = 7;              // particles down the length
const SUB = 2;             // rope lines per particle gap
const ITERATIONS = 3;
const DAMP = 0.955;        // water drag on particle velocity
const BUOY_Y = -0.16;      // depth the headline wants to ride at
const BUOY_PULL = 2.2;     // how firmly a row seeks its depth, per second
const COD_END = 0.42;      // width of the last row as a share of the mouth
const SPREAD_REST = 0.75;  // how far open the mouth stays with no way on
// A faint pull toward the streamed funnel: just enough that the body does
// not wander under the boat when the tow slows, far too weak to stiffen it.
// The netting is otherwise free cloth — it lags, sways and swings wide.
const STREAM = 0.35;
const WARP_BACK = 0.22;    // how far astern of the transom the wings tow, in net lengths
const MAX_FISH = 10;       // most fish shown in the bag at once
const ROPE = 0xe6dcc6;     // off-white manila
const ROPE_R = 0.006;      // rope radius as a share of the net's width

/** A little twisted-strand texture for the ropes: diagonal shading that wraps. */
function ropeTexture() {
  const S = 32;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(70, 55, 35, 0.45)';
  ctx.lineWidth = 5;
  for (let k = -S; k <= S * 2; k += S / 2) {
    ctx.beginPath(); ctx.moveTo(k, -4); ctx.lineTo(k + S + 8, S + 4); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 2;
  for (let k = -S; k <= S * 2; k += S / 2) {
    ctx.beginPath(); ctx.moveTo(k + 8, -4); ctx.lineTo(k + S + 16, S + 4); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const UP = new THREE.Vector3(0, 1, 0);
const RING_GEO = new THREE.RingGeometry(0.35, 0.52, 20);
RING_GEO.rotateX(-Math.PI / 2);

const protos = new Map();
function prototypeFor(species) {
  let p = protos.get(species.id);
  if (!p) {
    const { group, tail } = buildFishMesh(species);
    p = { group, tailIndex: group.children.indexOf(tail) };
    protos.set(species.id, p);
  }
  return p;
}

export class TrawlNet {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.width = 3.4;
    this.length = 5.4;

    const count = NX * NZ;
    this.pos = [];
    this.prev = [];
    for (let i = 0; i < count; i++) {
      this.pos.push(new THREE.Vector3());
      this.prev.push(new THREE.Vector3());
    }
    this.links = [];
    this.setSize(this.width, this.length);

    // Render: a translucent skin on the particle grid...
    this.geometry = new THREE.PlaneGeometry(1, 1, NX - 1, NZ - 1);
    this.skin = new THREE.Mesh(this.geometry, new THREE.MeshLambertMaterial({
      color: 0x6e7b45, transparent: true, opacity: 0.16,
      side: THREE.DoubleSide, depthWrite: false,
    }));
    this.skin.renderOrder = 3;
    this.skin.frustumCulled = false;

    // ...and the netting itself: a square rope mesh, interpolated between
    // the particles so the squares read as rope squares, not cloth
    // triangles. Every rope between two knots is a thin lit cylinder with a
    // twisted-strand texture, so it reads as off-white manila rather than a
    // pixel line; the two warps and the headline are the same rope, thicker.
    this.cols = (NX - 1) * SUB + 1;
    this.rows = (NZ - 1) * SUB + 1;
    this.segs = this.rows * (this.cols - 1) + this.cols * (this.rows - 1);
    this.ropeMat = new THREE.MeshStandardMaterial({
      color: ROPE, roughness: 0.95, metalness: 0, map: ropeTexture(),
    });
    this.mesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), this.ropeMat, this.segs + 2);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this._q = new THREE.Quaternion();
    this._sc = new THREE.Vector3();

    // Cork floats along the headline.
    this.floatCount = NX;
    this.floats = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.1, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xe8b23a, roughness: 0.5 }),
      this.floatCount);
    // Instance positions live in world space far from the geometry's own
    // bounding sphere — without this the whole batch gets frustum-culled
    // as soon as the world origin leaves the view.
    this.floats.frustumCulled = false;

    this.group = new THREE.Group();
    this.group.add(this.skin, this.mesh, this.floats);
    this.group.visible = false;
    scene.add(this.group);

    this.fish = [];            // { mesh, tail, u, v, len, phase, energy, tail }
    this._m = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  /**
   * Size the net for a hull: the rest lengths of every rope, tapering from
   * the mouth to the cod end. The particle count never changes.
   */
  setSize(width, length) {
    this.width = width;
    this.length = length;
    this.links.length = 0;
    const dz = length / (NZ - 1);
    for (let r = 0; r < NZ; r++) {
      const dx = (width * this.rowScale(r)) / (NX - 1);
      for (let c = 0; c < NX; c++) {
        const i = r * NX + c;
        if (c + 1 < NX) this.links.push([i, i + 1, dx]);
        if (r + 1 < NZ) this.links.push([i, i + NX, dz]);
      }
    }
  }

  /** Width of row r as a share of the mouth: a funnel closing to the bag. */
  rowScale(r) {
    const k = r / (NZ - 1);
    return 1 - (1 - COD_END) * Math.pow(k, 1.4);
  }

  /** Lay the net out behind the boat when trawling starts. */
  deploy(anchorL, anchorR, backDir, color, size) {
    if (size && (size.width !== this.width || size.length !== this.length)) {
      this.setSize(size.width, size.length);
    }
    if (color !== undefined) this.skin.material.color.set(color);
    this.wingPoints(anchorL, anchorR, backDir, 0);
    const mid = this._v.lerpVectors(this._a, this._b, 0.5);
    const span = this._b.distanceTo(this._v) * 2;
    const side = this._s.subVectors(this._b, this._a).normalize();
    for (let r = 0; r < NZ; r++) {
      const w = span * this.rowScale(r);
      for (let c = 0; c < NX; c++) {
        const i = r * NX + c;
        const u = c / (NX - 1) - 0.5;
        this.pos[i].copy(mid)
          .addScaledVector(side, u * w)
          .addScaledVector(backDir, (r / (NZ - 1)) * this.length);
        this.pos[i].y = BUOY_Y * (0.5 + 0.8 * (r / (NZ - 1)));
        this.prev[i].copy(this.pos[i]);
      }
    }
    this.group.visible = true;
    this.active = true;
  }

  stow() {
    this.group.visible = false;
    this.active = false;
    this.clearFish();
  }

  /**
   * Show a fish the haul produced, thrashing in and out of the water over
   * the cod end at the same larger-than-life scale a hooked fish has on the
   * line. It stays for `showS` seconds — as long as the haul notice is up —
   * then fades out over `fadeS`, with the notice.
   */
  addCatch(species, sizeMult, showS = 3.2, fadeS = 0.4) {
    if (!this.active) return;
    const proto = prototypeFor(species);
    const mesh = proto.group.clone(true);
    const base = Math.max(0.05, visualLength(species));
    const len = Math.min(base * sizeMult * CONFIG.HOOKED_FISH_SCALE, CONFIG.HOOKED_FISH_MAX_M);
    mesh.scale.setScalar(len / base);
    // Its own materials, so it can fade on its own.
    const mats = [];
    mesh.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.transparent = true;
      mats.push(o.material);
    });
    this.scene.add(mesh);
    const splash = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    }));
    splash.renderOrder = 4;
    splash.visible = false;
    this.scene.add(splash);
    this.fish.push({
      mesh, mats, splash, splashT: 0, wasUp: false,
      tail: mesh.children[proto.tailIndex] || null, len,
      // Somewhere over the back half of the bag.
      u: 0.2 + Math.random() * 0.6,
      v: 0.55 + Math.random() * 0.4,
      phase: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 1.2,
      age: 0, showS, fadeS,
    });
    while (this.fish.length > MAX_FISH) this.dropFish(this.fish.shift());
  }

  dropFish(f) {
    this.scene.remove(f.mesh, f.splash);
    for (const m of f.mats) m.dispose();
    f.splash.material.dispose();
  }

  clearFish() {
    for (const f of this.fish) this.dropFish(f);
    this.fish.length = 0;
  }

  /**
   * Where the two wing tips are held, into this._a (port) and this._b
   * (starboard): out from the stern tow points to the net's own width, and
   * back down the warps.
   */
  wingPoints(anchorL, anchorR, backDir, speed) {
    const mid = this._v.lerpVectors(anchorL, anchorR, 0.5);
    const side = this._s.subVectors(anchorR, anchorL);
    const span = side.length() || 1;
    side.divideScalar(span);
    const open = SPREAD_REST + (1 - SPREAD_REST) * Math.min(1, speed / 1.5);
    const half = span / 2 + (this.width / 2 - span / 2) * open;
    const back = this.length * WARP_BACK;
    this._b.copy(mid).addScaledVector(side, half).addScaledVector(backDir, back);
    this._a.copy(mid).addScaledVector(side, -half).addScaledVector(backDir, back);
    this._a.y = this._b.y = BUOY_Y * 0.5;
  }

  /** Bilinear point on the particle grid at (u across, v down), into `out`. */
  at(u, v, out) {
    const fx = u * (NX - 1), fz = v * (NZ - 1);
    const c0 = Math.min(NX - 2, Math.floor(fx)), r0 = Math.min(NZ - 2, Math.floor(fz));
    const tx = fx - c0, tz = fz - r0;
    const p00 = this.pos[r0 * NX + c0], p10 = this.pos[r0 * NX + c0 + 1];
    const p01 = this.pos[(r0 + 1) * NX + c0], p11 = this.pos[(r0 + 1) * NX + c0 + 1];
    out.set(
      (p00.x * (1 - tx) + p10.x * tx) * (1 - tz) + (p01.x * (1 - tx) + p11.x * tx) * tz,
      (p00.y * (1 - tx) + p10.y * tx) * (1 - tz) + (p01.y * (1 - tx) + p11.y * tx) * tz,
      (p00.z * (1 - tx) + p10.z * tx) * (1 - tz) + (p01.z * (1 - tx) + p11.z * tx) * tz);
    return out;
  }

  /**
   * anchorL/anchorR: world tow points at the stern. ropeL/ropeR: where the
   * warps leave the A-frame (for drawing only). backDir: unit vector astern;
   * speed: the boat's way, which is what spreads the mouth.
   */
  update(dt, t, anchorL, anchorR, ropeL, ropeR, backDir, speed = 0) {
    if (!this.active) return;
    const step = Math.min(dt, 0.033);

    // The wing tips are where the otter boards hold them: astern of the
    // transom on the warps, standing the mouth open — wider the faster the
    // tow, most of the way open even when the boat has stopped.
    this.wingPoints(anchorL, anchorR, backDir, speed);
    const pinA = this._a, pinB = this._b;
    const mid = this._v.lerpVectors(pinA, pinB, 0.5);
    const span = pinA.distanceTo(pinB);
    const sx = backDir.z, sz = -backDir.x;            // across the boat, to starboard

    // Verlet integration with water drag, buoyancy and a little swirl —
    // plus a soft pull toward where the water's own drag would stream the
    // netting, straight out astern in its funnel: that is what keeps the
    // body trailing behind the boat instead of wandering under it when the
    // tow slows, while leaving it free to lag and swing wide in a turn.
    for (let i = 0; i < this.pos.length; i++) {
      const p = this.pos[i], q = this.prev[i];
      const r = Math.floor(i / NX), c = i % NX;
      const vx = (p.x - q.x) * DAMP;
      const vy = (p.y - q.y) * DAMP;
      const vz = (p.z - q.z) * DAMP;
      q.copy(p);
      const k = r / (NZ - 1);
      const u = (c / (NX - 1) - 0.5) * span * this.rowScale(r);
      const tx = mid.x + backDir.x * k * this.length + sx * u;
      const tz = mid.z + backDir.z * k * this.length + sz * u;
      p.x += vx + Math.sin(t * 1.3 + i * 1.7) * 0.05 * step + (tx - p.x) * STREAM * step;
      p.y += vy + (BUOY_Y * (1 + 0.8 * k) - p.y) * BUOY_PULL * step;
      p.z += vz + Math.cos(t * 1.1 + i * 2.3) * 0.05 * step + (tz - p.z) * STREAM * step;
    }

    // Satisfy distance constraints, the wings held fast.
    for (let it = 0; it < ITERATIONS; it++) {
      for (const [a, b, rest] of this.links) {
        const pa = this.pos[a], pb = this.pos[b];
        const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (d - rest) / d * 0.5;
        const fa = a === 0 || a === NX - 1, fb = b === 0 || b === NX - 1;
        if (!fa) { const k = fb ? 2 : 1; pa.x += dx * diff * k; pa.y += dy * diff * k; pa.z += dz * diff * k; }
        if (!fb) { const k = fa ? 2 : 1; pb.x -= dx * diff * k; pb.y -= dy * diff * k; pb.z -= dz * diff * k; }
      }
      this.pos[0].copy(pinA);
      this.pos[NX - 1].copy(pinB);
    }

    // Keep the netting from breaching the surface (floats ride on top).
    for (let i = 0; i < this.pos.length; i++) {
      if (this.pos[i].y > -0.02) this.pos[i].y = -0.02;
      if (this.pos[i].y < -1.6) this.pos[i].y = -1.6;
    }

    // Skin: particle positions straight into the plane geometry.
    const attr = this.geometry.attributes.position;
    for (let i = 0; i < this.pos.length; i++) {
      attr.setXYZ(i, this.pos[i].x, this.pos[i].y, this.pos[i].z);
    }
    attr.needsUpdate = true;
    this.geometry.computeVertexNormals();

    // Ropes: the interpolated grid, one cylinder per rope between knots.
    const rr = this.width * ROPE_R;
    let k = 0;
    const cols = this.cols, rows = this.rows;
    for (let r = 0; r < rows; r++) {
      const thick = r === 0 ? rr * 2 : rr;          // the headline is heavier
      for (let c = 0; c + 1 < cols; c++) {
        this.at(c / (cols - 1), r / (rows - 1), this._a);
        this.at((c + 1) / (cols - 1), r / (rows - 1), this._b);
        this.rope(k++, this._a, this._b, thick);
      }
    }
    for (let c = 0; c < cols; c++) {
      const thick = c === 0 || c === cols - 1 ? rr * 1.6 : rr;   // and the selvedges
      for (let r = 0; r + 1 < rows; r++) {
        this.at(c / (cols - 1), r / (rows - 1), this._a);
        this.at(c / (cols - 1), (r + 1) / (rows - 1), this._b);
        this.rope(k++, this._a, this._b, thick);
      }
    }
    // Warps from the A-frame to the wing tips.
    this._a.copy(this.pos[0]); this._a.y += 0.05;
    this.rope(k++, ropeL, this._a, rr * 2.2);
    this._b.copy(this.pos[NX - 1]); this._b.y += 0.05;
    this.rope(k++, ropeR, this._b, rr * 2.2);
    this.mesh.instanceMatrix.needsUpdate = true;

    // Floats bob along the headline.
    for (let c = 0; c < NX; c++) {
      const p = this.pos[c];
      this._v.set(p.x, Math.max(p.y, -0.05) + 0.08 + Math.sin(t * 3 + c) * 0.02, p.z);
      this._m.makeTranslation(this._v.x, this._v.y, this._v.z);
      this.floats.setMatrixAt(c, this._m);
    }
    this.floats.instanceMatrix.needsUpdate = true;

    this.updateFish(dt, t, backDir);
  }

  /** Lay rope instance `i` from `a` to `b`, `r` thick. */
  rope(i, a, b, r) {
    const d = this._s.subVectors(b, a);
    const len = d.length() || 1e-4;
    d.divideScalar(len);
    this._q.setFromUnitVectors(UP, d);
    this._v.lerpVectors(a, b, 0.5);
    this._sc.set(r, len, r);
    this._m.compose(this._v, this._q, this._sc);
    this.mesh.setMatrixAt(i, this._m);
  }

  /**
   * The catch in the bag: each fish leaps and falls back through the
   * surface over the netting, nose following its arc, rolling and flapping
   * as a hooked fish does when it is swung up — then fades with the notice.
   */
  updateFish(dt, t, backDir) {
    if (!this.fish.length) return;
    const along = Math.atan2(-backDir.x, -backDir.z);   // nose toward the boat
    const surface = CONFIG.WATER_LEVEL;
    for (let i = this.fish.length - 1; i >= 0; i--) {
      const f = this.fish[i];
      f.age += dt;
      if (f.age >= f.showS + f.fadeS) { this.dropFish(f); this.fish.splice(i, 1); continue; }
      const alpha = f.age > f.showS ? 1 - (f.age - f.showS) / f.fadeS : 1;
      for (const m of f.mats) m.opacity = alpha;

      this.at(f.u, f.v, this._v);
      const m = f.mesh;
      // A leap every ~2s: up clear of the water and back under the netting.
      const w = 3.1, ph = t * w + f.phase;
      const hop = 0.3 + f.len * 0.28;
      const y = surface - 0.1 + Math.sin(ph) * hop;
      m.position.set(
        this._v.x + Math.sin(t * 1.7 + f.phase) * 0.15,
        y,
        this._v.z + Math.cos(t * 1.4 + f.phase) * 0.15);
      m.rotation.set(
        -Math.cos(ph) * 0.8,                                     // nose up going up, down coming down
        along + f.spin + Math.sin(t * 2.1 + f.phase) * 0.5,
        Math.sin(t * 9 + f.phase * 1.3) * 0.7);
      if (f.tail) f.tail.rotation.y = Math.sin(t * 20 + f.phase) * 0.8;

      // Splash where it goes back in.
      const up = y > surface;
      if (f.wasUp && !up) {
        f.splashT = 1;
        f.splash.position.set(m.position.x, surface + 0.05, m.position.z);
        f.splash.visible = true;
      }
      f.wasUp = up;
      if (f.splashT > 0) {
        f.splashT = Math.max(0, f.splashT - dt * 1.6);
        const k = 1 - f.splashT;
        f.splash.scale.setScalar((0.6 + f.len * 0.7) * (0.4 + k * 1.6));
        f.splash.material.opacity = f.splashT * 0.75 * alpha;
        if (f.splashT <= 0) f.splash.visible = false;
      }
    }
  }
}
