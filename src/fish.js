// Ambient fish: simple low-poly fish that swim lazily under the water around
// a focus point. Purely cosmetic — they sell the menu's underwater half and
// add life near the boat during play.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { waterDepth } from './lake.js';

const FISH_COLORS = [0x7fa8b8, 0x9c8f6a, 0x6f8f5e, 0xb87f5e, 0x8a7fb8, 0x5e88b8];

function makeFishMesh(scale, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), mat);
  body.scale.set(0.35, 0.45, 1);
  g.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 4), mat);
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = 0.62;
  g.add(tail);
  g.scale.setScalar(scale);
  return g;
}

export class AmbientFish {
  constructor(scene, count = 14) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.fish = [];
    for (let i = 0; i < count; i++) {
      const scale = 0.5 + Math.random() * 1.3;
      const mesh = makeFishMesh(scale, FISH_COLORS[i % FISH_COLORS.length]);
      this.group.add(mesh);
      this.fish.push({
        mesh,
        // Each fish orbits a wandering local center.
        cx: (Math.random() - 0.5) * 26,
        cz: (Math.random() - 0.5) * 26,
        r: 1.5 + Math.random() * 5,
        speed: (0.25 + Math.random() * 0.5) * (Math.random() < 0.5 ? 1 : -1),
        phase: Math.random() * Math.PI * 2,
        depth: 0.6 + Math.random() * 2.2,
      });
    }
    this.focus = new THREE.Vector3();
  }

  setFocus(x, z) { this.focus.set(x, 0, z); }

  update(t) {
    for (const f of this.fish) {
      const a = f.phase + t * f.speed;
      const x = this.focus.x + f.cx + Math.cos(a) * f.r;
      const z = this.focus.z + f.cz + Math.sin(a) * f.r;
      const d = waterDepth(x, z);
      // Hide fish that would swim into land.
      f.mesh.visible = d > 0.5;
      if (!f.mesh.visible) continue;
      const y = CONFIG.WATER_LEVEL - Math.min(f.depth, Math.max(0.3, d - 0.3));
      f.mesh.position.set(x, y + Math.sin(t * 1.4 + f.phase) * 0.1, z);
      // Face along the direction of travel (tangent of the orbit).
      const dir = f.speed > 0 ? 1 : -1;
      f.mesh.rotation.y = -a - dir * Math.PI / 2;
      // Tail wiggle
      f.mesh.rotation.z = Math.sin(t * 6 + f.phase) * 0.15;
    }
  }
}
