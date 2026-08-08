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

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfe3f2);
scene.fog = new THREE.Fog(0xbfe3f2, 90, 220);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 500);

const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
sun.position.set(40, 70, 20);
scene.add(sun);
scene.add(new THREE.AmbientLight(0xcfe6f0, 0.9));
scene.add(new THREE.HemisphereLight(0xd8ecf5, 0x3a5f3f, 0.7));

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
  cast: (power) => { if (state === 'play') fishing.cast(power); },
  tapNet: () => { if (state === 'play') fishing.toggleTrawl(); },
  tap: () => { if (state === 'play') fishing.reel(); },
});

hud.showMenu(() => {
  state = 'play';
  rig.startGame();
  input.enabled = true;
  hud.hint(input.isTouch
    ? 'Joystick to drive · swipe up to cast · tap the net to trawl'
    : 'WASD to drive · click-swipe up to cast · click the net to trawl', 6000);
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
  ambientFish.update(t);
  if (state === 'play') fishing.update(dt, t);
  rig.update(dt, t, boat.group.position);

  hud.setWallet(wallet.balance, rtp.netRound());

  saveAcc += dt;
  if (saveAcc > 2) {
    saveAcc = 0;
    localStorage.setItem('bnt-balance', String(Math.round(wallet.balance * 100) / 100));
  }

  renderer.render(scene, camera);
}
frame();

// --- PWA ---
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
