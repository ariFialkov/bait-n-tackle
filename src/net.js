// Cloth-physics trawl net: a square mesh of Verlet particles towed behind
// the boat from two stern anchor points. Water drag, buoyancy toward just
// below the surface, and distance constraints make it billow, swing wide in
// turns and settle like a real net. ~40 particles — negligible compute.

import * as THREE from 'three';

const NX = 8;              // particles across the mouth
const NZ = 5;              // particles down the length
const WIDTH = 2.7;
const LENGTH = 3.4;
const ITERATIONS = 3;
const DAMP = 0.955;        // water drag on particle velocity
const BUOY_Y = -0.16;      // depth the netting wants to ride at
const FLOAT_EVERY = 2;     // a cork float on every 2nd mouth particle

export class TrawlNet {
  constructor(scene) {
    this.scene = scene;
    this.active = false;

    const count = NX * NZ;
    this.pos = [];
    this.prev = [];
    for (let i = 0; i < count; i++) {
      this.pos.push(new THREE.Vector3());
      this.prev.push(new THREE.Vector3());
    }

    // Constraints: structural links along rows and columns.
    this.links = [];
    const dx = WIDTH / (NX - 1), dz = LENGTH / (NZ - 1);
    for (let r = 0; r < NZ; r++) {
      for (let c = 0; c < NX; c++) {
        const i = r * NX + c;
        if (c + 1 < NX) this.links.push([i, i + 1, dx]);
        if (r + 1 < NZ) this.links.push([i, i + NX, dz]);
      }
    }

    // Render: shared geometry for a translucent skin + netting wireframe.
    this.geometry = new THREE.PlaneGeometry(WIDTH, LENGTH, NX - 1, NZ - 1);
    this.skin = new THREE.Mesh(this.geometry, new THREE.MeshLambertMaterial({
      color: 0x6e7b45, transparent: true, opacity: 0.28,
      side: THREE.DoubleSide, depthWrite: false,
    }));
    this.mesh = new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({
      color: 0x3f4a26, wireframe: true, transparent: true, opacity: 0.75,
    }));
    this.skin.renderOrder = this.mesh.renderOrder = 3;
    this.skin.frustumCulled = this.mesh.frustumCulled = false;

    // Cork floats along the mouth (top row).
    this.floatCount = Math.ceil(NX / FLOAT_EVERY);
    this.floats = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xe8b23a, roughness: 0.5 }),
      this.floatCount);
    // Instance positions live in world space far from the geometry's own
    // bounding sphere — without this the whole batch gets frustum-culled
    // as soon as the world origin leaves the view.
    this.floats.frustumCulled = false;

    // Tow ropes from the boat's A-frame to the net mouth corners.
    this.ropeGeo = new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
    this.ropes = new THREE.LineSegments(this.ropeGeo,
      new THREE.LineBasicMaterial({ color: 0x3d3428 }));
    this.ropes.frustumCulled = false;

    this.group = new THREE.Group();
    this.group.add(this.skin, this.mesh, this.floats, this.ropes);
    this.group.visible = false;
    scene.add(this.group);

    this._m = new THREE.Matrix4();
    this._v = new THREE.Vector3();
  }

  /** Lay the net out flat behind the boat when trawling starts. */
  deploy(anchorL, anchorR, backDir, color) {
    if (color !== undefined) {
      this.skin.material.color.set(color);
      this.mesh.material.color.set(color).offsetHSL(0, 0.02, -0.16);
    }
    for (let r = 0; r < NZ; r++) {
      for (let c = 0; c < NX; c++) {
        const i = r * NX + c;
        const u = c / (NX - 1);
        this.pos[i].lerpVectors(anchorL, anchorR, u)
          .addScaledVector(backDir, 0.6 + (r / (NZ - 1)) * LENGTH);
        this.pos[i].y = BUOY_Y * (0.4 + 0.6 * (r / (NZ - 1)));
        this.prev[i].copy(this.pos[i]);
      }
    }
    this.group.visible = true;
    this.active = true;
  }

  stow() {
    this.group.visible = false;
    this.active = false;
  }

  /**
   * anchorL/anchorR: world tow points at the stern. ropeL/ropeR: where the
   * tow ropes leave the A-frame (for drawing only).
   */
  update(dt, t, anchorL, anchorR, ropeL, ropeR) {
    if (!this.active) return;
    const step = Math.min(dt, 0.033);

    // Verlet integration with water drag, buoyancy and a little swirl.
    for (let i = 0; i < this.pos.length; i++) {
      const p = this.pos[i], q = this.prev[i];
      const vx = (p.x - q.x) * DAMP;
      const vy = (p.y - q.y) * DAMP;
      const vz = (p.z - q.z) * DAMP;
      q.copy(p);
      p.x += vx + Math.sin(t * 1.3 + i * 1.7) * 0.05 * step;
      p.y += vy + (BUOY_Y - p.y) * 2.2 * step;
      p.z += vz + Math.cos(t * 1.1 + i * 2.3) * 0.05 * step;
    }

    // Pin the mouth corners to the tow points.
    this.pos[0].copy(anchorL);
    this.pos[NX - 1].copy(anchorR);

    // Satisfy distance constraints.
    for (let it = 0; it < ITERATIONS; it++) {
      for (const [a, b, rest] of this.links) {
        const pa = this.pos[a], pb = this.pos[b];
        const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (d - rest) / d * 0.5;
        const pinA = a === 0 || a === NX - 1;
        const pinB = b === 0 || b === NX - 1;
        if (!pinA) { pa.x += dx * diff * (pinB ? 2 : 1); pa.y += dy * diff * (pinB ? 2 : 1); pa.z += dz * diff * (pinB ? 2 : 1); }
        if (!pinB) { pb.x -= dx * diff * (pinA ? 2 : 1); pb.y -= dy * diff * (pinA ? 2 : 1); pb.z -= dz * diff * (pinA ? 2 : 1); }
      }
      this.pos[0].copy(anchorL);
      this.pos[NX - 1].copy(anchorR);
    }

    // Keep the netting from breaching the surface (floats ride on top).
    for (let i = NX; i < this.pos.length; i++) {
      if (this.pos[i].y > -0.02) this.pos[i].y = -0.02;
      if (this.pos[i].y < -1.4) this.pos[i].y = -1.4;
    }

    // Push particle positions into the render geometry.
    const attr = this.geometry.attributes.position;
    for (let i = 0; i < this.pos.length; i++) {
      attr.setXYZ(i, this.pos[i].x, this.pos[i].y, this.pos[i].z);
    }
    attr.needsUpdate = true;
    this.geometry.computeVertexNormals();

    // Floats bob along the mouth row.
    let fi = 0;
    for (let c = 0; c < NX; c += FLOAT_EVERY) {
      const p = this.pos[c];
      this._v.set(p.x, Math.max(p.y, -0.05) + 0.07 + Math.sin(t * 3 + c) * 0.02, p.z);
      this._m.makeTranslation(this._v.x, this._v.y, this._v.z);
      this.floats.setMatrixAt(fi++, this._m);
    }
    this.floats.instanceMatrix.needsUpdate = true;

    // Tow ropes.
    const rp = this.ropeGeo.attributes.position;
    rp.setXYZ(0, ropeL.x, ropeL.y, ropeL.z);
    rp.setXYZ(1, anchorL.x, anchorL.y + 0.05, anchorL.z);
    rp.setXYZ(2, ropeR.x, ropeR.y, ropeR.z);
    rp.setXYZ(3, anchorR.x, anchorR.y + 0.05, anchorR.z);
    rp.needsUpdate = true;
  }
}
