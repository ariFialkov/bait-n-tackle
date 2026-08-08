// 2D species icons rendered from the actual 3D prefabs by a small offscreen
// renderer — every icon automatically matches its in-game model, with one
// consistent camera angle and studio lighting across all 60 species.

import * as THREE from 'three';
import { buildFishMesh } from './fishmodels.js';

const SIZE = 256;
let ctx = null;
const cache = new Map(); // species.id -> dataURL

function ensureContext() {
  if (ctx) return ctx;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(SIZE, SIZE);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xfff2dd, 2.6);
  key.position.set(2.5, 3, -1.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xcfe6ff, 1.4);
  rim.position.set(-2.5, 1, 2.5);
  scene.add(rim);
  scene.add(new THREE.AmbientLight(0xf0f4f8, 1.1));

  const camera = new THREE.PerspectiveCamera(26, 1, 0.01, 50);
  ctx = { renderer, scene, camera };
  return ctx;
}

/** Synchronously render (and cache) the icon for a species. */
export function fishIconURL(species) {
  if (cache.has(species.id)) return cache.get(species.id);
  const { renderer, scene, camera } = ensureContext();

  const { group, len } = buildFishMesh(species);
  // Consistent pose: profile facing left, angled slightly toward camera.
  group.rotation.y = Math.PI / 2 + 0.38;
  group.rotation.x = 0.06;
  scene.add(group);

  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const dist = (sphere.radius / Math.tan(THREE.MathUtils.degToRad(26 / 2))) * 1.12;
  camera.position.set(center.x, center.y + sphere.radius * 0.18, center.z + dist);
  camera.lookAt(center);

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(group);

  cache.set(species.id, url);
  return url;
}
