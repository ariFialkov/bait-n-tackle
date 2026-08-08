// Bait N' Tackle — bootstrap and game loop.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Lake } from './lake.js';
import { Boat } from './boat.js';
import { AmbientFish } from './fish.js';
import { CameraRig } from './cameraRig.js';
import { RTPEngine } from './rtp.js';
import { Fishing } from './fishing.js';
import { Input } from './input.js';
import { HUD } from './hud.js';

// --- Renderer / scene ---
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfe3f2);
scene.fog = new THREE.Fog(0xbfe3f2, 90, 220);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 500);

const SUN_OFFSET = new THREE.Vector3(40, 70, 20);
const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
sun.position.copy(SUN_OFFSET);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -55;
sun.shadow.camera.right = sun.shadow.camera.top = 55;
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 200;
sun.shadow.bias = -0.0015;
scene.add(sun);
scene.add(sun.target);
scene.add(new THREE.AmbientLight(0xcfe6f0, 0.75));
scene.add(new THREE.HemisphereLight(0xd8ecf5, 0x3a5f3f, 0.75));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Game objects ---
const lake = new Lake(scene);
const boat = new Boat(scene, lake);
const ambientFish = new AmbientFish(scene, 16);
const rig = new CameraRig(camera);
const hud = new HUD();
const rtp = new RTPEngine();

const wallet = {
  balance: Number(localStorage.getItem('bnt-balance') ?? CONFIG.START_BALANCE),
};
if (!Number.isFinite(wallet.balance)) wallet.balance = CONFIG.START_BALANCE;

const fishing = new Fishing(scene, boat, lake, rtp, hud, wallet);
hud.onLureSelect = (i) => fishing.setLure(i);
hud.bindNewRound(() => {
  rtp.reset();
  if (wallet.balance < 1) {
    wallet.balance = CONFIG.START_BALANCE;
    hud.hint('Fresh bankroll — good luck out there!');
  } else {
    hud.hint('New round started');
  }
});

let state = 'menu';

const input = new Input(canvas, camera, () => boat.netHit, {
  swipe: (s) => { if (state === 'play') fishing.onSwipe(s); },
  tapNet: () => { if (state === 'play') fishing.toggleTrawl(); },
  tap: () => {},
});

hud.showMenu(() => {
  state = 'play';
  rig.startGame();
  input.enabled = true;
  hud.hint(input.isTouch
    ? 'Joystick to drive · swipe to cast & reel · tap the net to trawl'
    : 'WASD to drive · click-drag to cast & reel · click the net to trawl', 6000);
});

// --- Loop ---
const clock = new THREE.Clock();
let saveAcc = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  const move = state === 'play' ? input.moveVector() : { x: 0, z: 0 };
  boat.update(dt, move, t);
  lake.update(t, boat.pos.x, boat.pos.z);
  ambientFish.setFocus(boat.pos.x, boat.pos.z);
  ambientFish.update(t, dt);
  if (state === 'play') fishing.update(dt, t);
  rig.update(dt, t, boat.group.position);

  // Keep the sun (and its shadow frustum) centered on the boat.
  sun.position.set(boat.pos.x + SUN_OFFSET.x, SUN_OFFSET.y, boat.pos.z + SUN_OFFSET.z);
  sun.target.position.set(boat.pos.x, 0, boat.pos.z);

  hud.setWallet(wallet.balance, rtp.netRound());

  saveAcc += dt;
  if (saveAcc > 2) {
    saveAcc = 0;
    localStorage.setItem('bnt-balance', String(Math.round(wallet.balance * 100) / 100));
  }

  renderer.render(scene, camera);
}
frame();

// Debug/test handle (harmless in production).
window.BNT = { hud, rtp, fishing, boat, wallet };

// --- PWA ---
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
