// Bait N' Tackle — bootstrap and game loop.

import * as THREE from 'three';
import { CONFIG, LURES } from './config.js';
import { Lake } from './lake.js';
import { Boat } from './boat.js';
import { AmbientFish } from './fish.js';
import { CameraRig } from './cameraRig.js';
import { RTPEngine } from './rtp.js';
import { Fishing } from './fishing.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Dex } from './dex.js';
import { Marina } from './marina.js';
import { Player } from './player.js';
import { Docks, DOCK_HINT_RANGE } from './docks.js';
import { SPECIES } from './fishdata.js';

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
const player = new Player();
const lake = new Lake(scene);
const boat = new Boat(scene, lake, player);
const docks = new Docks(scene);
lake.onDocksChanged = (list) => docks.sync(list);
docks.sync(lake.docks);

const ambientFish = new AmbientFish(scene, 16);
const rig = new CameraRig(camera);
const hud = new HUD();
const dex = new Dex();
const rtp = new RTPEngine();
const fishing = new Fishing(scene, boat, lake, rtp, hud, player);

// --- Boat swapping ---
async function equipBoat(id) {
  if (player.boatId !== id && player.has(id)) player.equip(id);
  await boat.setBoat(id);
  fishing.syncRods();
  hud.setBoat(boat.spec);
  rig.setBoatLength(boat.spec.length);
  if (!boat.spec.features.trawl && boat.trawling) fishing.stopTrawl();
}
boat.onBoatChanged = (spec) => hud.setBoat(spec);
equipBoat(player.boatId);

const marina = new Marina(player, (id) => { equipBoat(id); });

hud.onLureSelect = (i) => fishing.setLure(i);
hud.onNetSelect = (i) => fishing.setNet(i);
hud.onPot = () => fishing.dropPot();
hud.bindNewRound(() => {
  rtp.reset();
  if (player.balance < 1 && !player.hold.length) {
    player.balance = CONFIG.START_BALANCE;
    player.save();
    hud.hint('Fresh bankroll — good luck out there!');
  } else {
    hud.hint('New round started');
  }
});

let state = 'menu';

const input = new Input(canvas, camera, () => boat.netHit, {
  swipe: (s) => { if (state === 'play' && !marina.open) fishing.onSwipe(s); },
  tapNet: () => { if (state === 'play' && !marina.open) fishing.toggleTrawl(); },
  tap: () => {},
});

hud.showMenu(() => {
  state = 'play';
  rig.startGame();
  input.enabled = true;
  hud.hint(input.isTouch
    ? 'Joystick to drive · swipe to cast & reel · pull up to a dock to sell'
    : 'WASD to drive · click-drag to cast & reel · pull up to a dock to sell', 6000);
});

hud.bindMenu(() => {
  if (state !== 'play') return;
  state = 'menu';
  fishing.endAll();
  if (boat.trawling) fishing.stopTrawl();
  marina.close();
  input.enabled = false;
  rig.backToMenu();
  hud.returnToMenu();
});

// --- Dock interaction ---
// Pulling up to an outpost triggers it once; you must leave and come back
// (or close the store) before it fires again.
let lastDock = null;
let dockCooldown = 0;

function updateDocks(dt) {
  if (dockCooldown > 0) dockCooldown -= dt;
  const here = docks.dockAt(boat.pos.x, boat.pos.z);
  if (!here) {
    if (lastDock) { lastDock = null; }
    return;
  }
  if (here === lastDock || dockCooldown > 0) return;
  lastDock = here;

  if (here.kind === 'market') {
    if (player.hold.length) {
      const result = player.sellAll();
      hud.showReceipt(result);
      hud.hint(`Sold ${result.count} fish for $${result.value.toFixed(2)}`);
    } else if (player.processing) {
      hud.hint('Onboard processing is on — nothing to unload');
    } else {
      hud.hint('Fish market — your hold is empty');
    }
  } else {
    marina.show();
    dockCooldown = 1.5;
  }
}

// --- Sonar readout ---
let sonarAcc = 0;
function updateSonar(dt) {
  if (!boat.spec.features.sonar) return;
  sonarAcc += dt;
  if (sonarAcc < 0.4) return;
  sonarAcc = 0;
  const near = lake.hotspotsNear(boat.pos.x, boat.pos.z, CONFIG.SONAR_RANGE).slice(0, 4);
  hud.setSonar(near.map((e) => ({
    dist: e.dist,
    lure: LURES.find((l) => l.id === e.hotspot.lureId) || LURES[0],
    bearing: Math.atan2(e.hotspot.x - boat.pos.x, -(e.hotspot.z - boat.pos.z)),
  })));
}

// --- Loop ---
const clock = new THREE.Clock();
let saveAcc = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  const driving = state === 'play' && !marina.open;
  const move = driving ? input.moveVector() : { x: 0, z: 0 };
  boat.update(dt, move, t);
  lake.update(t, boat.pos.x, boat.pos.z);
  ambientFish.setFocus(boat.pos.x, boat.pos.z);
  ambientFish.update(t, dt);
  if (state === 'play') {
    fishing.update(dt, t);
    updateDocks(dt);
    updateSonar(dt);
  }
  rig.update(dt, t, boat.group.position);

  // Keep the sun (and its shadow frustum) centered on the boat.
  sun.position.set(boat.pos.x + SUN_OFFSET.x, SUN_OFFSET.y, boat.pos.z + SUN_OFFSET.z);
  sun.target.position.set(boat.pos.x, 0, boat.pos.z);

  hud.setWallet(player.balance, rtp.netRound());
  hud.setHold(player);
  if (state === 'play') {
    const market = docks.nearest(boat.pos.x, boat.pos.z, 'market');
    const mar = docks.nearest(boat.pos.x, boat.pos.z, 'marina');
    hud.setFinders(boat.pos,
      market.dist <= DOCK_HINT_RANGE ? market : null,
      mar.dist <= DOCK_HINT_RANGE ? mar : null);
  }

  saveAcc += dt;
  if (saveAcc > 3) { saveAcc = 0; player.save(); }

  renderer.render(scene, camera);
}
frame();

// Debug/test handle (harmless in production).
window.BNT = { hud, rtp, fishing, boat, player, dex, marina, docks, lake, SPECIES, equipBoat };

// --- PWA ---
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
