// Ambient fish that live in the lake itself. Each fish wanders the world on
// its own — cruising, turning with smooth noise, steering away from
// shallows — completely independent of the boat. The boat's position is only
// used to recycle fish that have drifted far outside the view (they respawn
// in fresh water near the edge of the visible area, never mid-screen). A
// fish recycled into water of the other kind comes back as one of that
// water's species, so the sea is full of the sea's fish.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { waterDepth } from './lake.js';
import { waterKind } from './regions.js';
import { SPECIES } from './fishdata.js';
import { buildFishMesh } from './fishmodels.js';

const VIEW_R = 46;      // fish farther than this get recycled
const SPAWN_R = 38;     // recycled fish reappear around this radius

// Ambient population skews toward common small species, with the odd big one.
function pickAmbientSpecies(water = 'fresh', rng = Math.random) {
  const pool = SPECIES.filter((s) => water === 'both' || s.water === water);
  const weights = pool.map((s) => 1 / Math.pow(s.value + 1.5, 0.55));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[0];
}

function poolAt(x, z) {
  const k = waterKind(x, z);
  return k === 'salt' ? 'salt' : k === 'brackish' ? 'both' : 'fresh';
}

export class AmbientFish {
  constructor(scene, count = 16) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.focus = new THREE.Vector3();
    this.fish = [];
    for (let i = 0; i < count; i++) {
      const f = {
        mesh: null, tail: null, species: null,
        x: 0, z: 0,
        heading: Math.random() * Math.PI * 2,
        speed: 1,
        turnBias: 0,
        depthPref: 0.5 + Math.random() * 1.8,
        phase: Math.random() * Math.PI * 2,
      };
      this.dress(f, pickAmbientSpecies('fresh'));
      // Initial spread: anywhere in view, in water.
      this.place(f, 6 + Math.random() * (SPAWN_R - 6));
      this.fish.push(f);
    }
  }

  /** Give a fish a species and the body to go with it. */
  dress(f, species) {
    if (f.mesh) this.group.remove(f.mesh);
    const { group, tail, len } = buildFishMesh(species);
    const sizeMult = 0.8 + Math.random() * 0.5;
    group.scale.setScalar(sizeMult);
    this.group.add(group);
    f.mesh = group; f.tail = tail; f.species = species;
    // Bigger fish cruise slower but cover ground with their size.
    f.speed = (0.45 + Math.random() * 0.7) * (0.7 + len * 0.35);
    f.depthPref = 0.5 + Math.random() * 1.8 + len * 0.5;
  }

  setFocus(x, z) { this.focus.set(x, 0, z); }

  /** Drop a fish at a random watery point around the focus at ~radius r. */
  place(f, r) {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2;
      const x = this.focus.x + Math.cos(a) * r;
      const z = this.focus.z + Math.sin(a) * r;
      if (waterDepth(x, z) > 1.2) {
        f.x = x; f.z = z;
        f.heading = Math.random() * Math.PI * 2;
        // The wrong kind of fish for this water: it comes back as the right one.
        const pool = poolAt(x, z);
        if (pool !== 'both' && f.species.water !== pool) this.dress(f, pickAmbientSpecies(pool));
        return true;
      }
    }
    return false;
  }

  update(t, dt = 0.016) {
    for (const f of this.fish) {
      // Wander: smooth pseudo-random turning, unique per fish.
      f.turnBias = Math.sin(t * 0.31 + f.phase * 3.7) * 0.5 +
        Math.sin(t * 0.13 + f.phase * 1.3) * 0.3;
      f.heading += f.turnBias * dt;

      // Steer away from shallows: probe ahead, turn if it's getting thin.
      const probeX = f.x + Math.sin(f.heading) * 3;
      const probeZ = f.z + Math.cos(f.heading) * 3;
      const ahead = waterDepth(probeX, probeZ);
      if (ahead < 1.0) {
        f.heading += 2.4 * dt * (Math.sin(f.phase * 7) > 0 ? 1 : -1) * (1.6 - ahead);
      }

      f.x += Math.sin(f.heading) * f.speed * dt;
      f.z += Math.cos(f.heading) * f.speed * dt;

      const d = waterDepth(f.x, f.z);
      if (d < 0.4) {
        // Beached in spite of steering — recycle quietly at the view edge.
        if (!this.place(f, SPAWN_R)) { f.mesh.visible = false; continue; }
      }
      // Recycle fish that wandered far out of view.
      const distFromFocus = Math.hypot(f.x - this.focus.x, f.z - this.focus.z);
      if (distFromFocus > VIEW_R) {
        if (!this.place(f, SPAWN_R)) { f.mesh.visible = false; continue; }
      }

      f.mesh.visible = true;
      const depth = waterDepth(f.x, f.z);
      const y = CONFIG.WATER_LEVEL - Math.min(f.depthPref, Math.max(0.35, depth - 0.3));
      f.mesh.position.set(f.x, y + Math.sin(t * 1.2 + f.phase) * 0.08, f.z);
      // Nose (-Z of the mesh) points along the heading.
      f.mesh.rotation.y = Math.atan2(-Math.sin(f.heading), -Math.cos(f.heading));
      // Swim animation: tail beat + gentle body roll.
      if (f.tail) f.tail.rotation.y = Math.sin(t * (5 + f.speed * 3) + f.phase) * 0.55;
      f.mesh.rotation.z = Math.sin(t * 1.7 + f.phase) * 0.06;
    }
  }
}
