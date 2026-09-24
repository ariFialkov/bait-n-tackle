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
import { Docks, DOCK_HINT_RANGE, berthFor } from './docks.js';
import { Tender } from './tender.js';
import { separateHulls } from './hullphysics.js';
import { CrewDirector } from './deckcrew.js';
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
const tender = new Tender(scene, lake, rtp, player, hud);
const crew = new CrewDirector(scene, boat, tender, fishing);

// Which vessel the player is steering right now.
let helm = boat;
const atHelmOfTender = () => helm === tender;

// --- Boat swapping ---
async function equipBoat(key, fromMarina = false) {
  if (player.boatId !== key && player.has(key)) player.equip(key);
  // Any tender belongs to the old hull — bring it home first.
  if (tender.deployed || tender.hoisting) { tender.stow(); }
  helm = boat;
  fishing.setVessel(boat);
  await boat.setBoat(key);
  fishing.syncRods();
  hud.setBoat(boat.spec);
  rig.setBoatLength(boat.spec.length);
  if (!boat.spec.features.trawl && boat.trawling) fishing.stopTrawl();
  if (boat.spec.tender) {
    await tender.prepare(boat.spec.tender, boat.spec);
    // Aboard, it stands in the well the model had its own tender in.
    const well = boat.parts.tender?.box;
    const st = boat.stations;
    tender.stowOn(boat, st?.tenderWell || (well
      ? { x: (well[0] + well[3]) / 2, y: well[1], z: (well[2] + well[5]) / 2 }
      : { x: 0, y: boat.hullBounds.deckY, z: boat.hullBounds.length * 0.35 }));
  } else if (tender.stowedModel) {
    tender.stowedModel.visible = false;
  }
  if (fromMarina) berthAtMarina();
  crew.setBoat(boat.spec);
  refreshShipPanel();
}

/**
 * A boat handed over at a marina starts alongside the pier, not wherever the
 * last hull happened to be floating: a 26m steamboat taking the place of a
 * skiff would otherwise be born sitting across the planking or up the beach.
 * Away from a marina nothing moves.
 */
function berthAtMarina() {
  const near = docks.nearest(boat.pos.x, boat.pos.z);
  if (!near.dock || near.dist > 24) return;
  const berth = berthFor(near.dock,
    boat.hullBounds?.halfBeam ?? boat.spec.length * 0.16,
    boat.hullBounds?.length ?? boat.spec.length);
  if (berth) boat.placeAt(berth.x, berth.z, berth.heading);
}

function refreshShipPanel() {
  hud.buildShipPanel(boat.spec, {
    balance: player.balance,
    tender: {
      deployed: tender.deployed,
      auto: tender.state === 'auto',
      controlling: atHelmOfTender(),
      remaining: tender.remaining,
    },
  });
}
boat.onBoatChanged = (spec) => hud.setBoat(spec);
equipBoat(player.boatId);

const marina = new Marina(player, (key) => { equipBoat(key, true); });

hud.onLureSelect = (i) => fishing.setLure(i);
hud.onNetSelect = (i) => fishing.setNet(i);
hud.onPot = () => fishing.dropPot();
hud.onAutoReel = () => {
  const on = fishing.setAutoReel(!fishing.autoReel);
  hud.setAutoReel(on);
  hud.hint(on
    ? 'Auto reel on — rods set the hook and reel themselves'
    : 'Auto reel off — swipe to set the hook and reel in');
};
hud.setAutoReel(fishing.autoReel);

// --- ship systems ---
hud.onShipOpen = () => refreshShipPanel();
hud.onCrew = () => {
  fishing.setCrew(!fishing.crew);
  refreshShipPanel();
};

hud.onTenderLaunch = () => {
  if (!boat.spec.features.tender) {
    hud.hint(`A ${boat.spec.name} carries no tender — upgrade at a marina`);
    return;
  }
  if (tender.hoisting) { hud.hint('The crane is busy'); return; }
  if (tender.deployed) {
    if (tender.state === 'auto') { hud.hint('The tender is still out fishing'); return; }
    if (tender.distanceTo(boat) > 14) { hud.hint('Bring the tender alongside first'); return; }
    if (atHelmOfTender()) { helm = boat; fishing.setVessel(boat); }
    fishing.endAll();
    tender.beginRecover(boat);
    hud.hint('Craning the tender aboard');
  } else if (tender.beginLaunch(boat)) {
    hud.hint('Craning the tender over the side');
  } else {
    hud.hint('No room alongside to launch');
  }
  refreshShipPanel();
};

hud.onTenderSwitch = () => {
  if (!tender.deployed || tender.state === 'auto') return;
  helm = atHelmOfTender() ? boat : tender;
  fishing.setVessel(helm);
  rig.setBoatLength(helm === tender ? tender.spec.length : boat.spec.length);
  hud.setBoat(helm === tender ? tender.spec : boat.spec);
  hud.hint(atHelmOfTender() ? 'At the tender\u2019s helm' : 'Back on the seiner');
  refreshShipPanel();
};

hud.onTenderSend = (bag) => {
  if (!tender.deployed || tender.state === 'auto') return;
  const total = bag.reduce((a, n, i) => a + n * LURES[i].cost, 0);
  const count = bag.reduce((a, n) => a + n, 0);
  if (!count) { hud.hint('Pick some bait to send it out with'); return; }
  if (player.balance < total) { hud.hint('Not enough cash to cover that bag of bait'); return; }
  if (atHelmOfTender()) { helm = boat; fishing.setVessel(boat); rig.setBoatLength(boat.spec.length); hud.setBoat(boat.spec); }
  // The bag is a spending limit, not a charge: each landed fish draws its
  // bait's stake from it exactly as a player cast would.
  tender.sendOut(bag);
  hud.hint(`Tender away with ${count} bait${count > 1 ? 's' : ''} ($${total})`);
  refreshShipPanel();
};
hud.bindNewRound(() => {
  rtp.reset();
  if (player.balance < 1) {
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
    ? 'Joystick to drive · swipe to cast & reel · catches pay out instantly'
    : 'WASD to drive · click-drag to cast & reel · catches pay out instantly', 6000);
});

hud.bindMenu(() => {
  if (state !== 'play') return;
  state = 'menu';
  fishing.endAll();
  if (boat.trawling) fishing.stopTrawl();
  if (helm === tender) { helm = boat; fishing.setVessel(boat); rig.setBoatLength(boat.spec.length); hud.setBoat(boat.spec); }
  marina.close();
  input.enabled = false;
  rig.backToMenu();
  hud.returnToMenu();
});

// --- Dock interaction ---
// Pulling up to a marina opens the store once; you must leave and come back
// (or close the store) before it opens again.
let lastDock = null;
let dockCooldown = 0;

function updateDocks(dt) {
  if (dockCooldown > 0) dockCooldown -= dt;
  const at = helm === tender ? tender.pos : boat.pos;
  const here = docks.dockAt(at.x, at.z);
  if (!here) {
    if (lastDock) { lastDock = null; }
    return;
  }
  if (here === lastDock || dockCooldown > 0) return;
  lastDock = here;

  marina.show();
  dockCooldown = 1.5;
}

// --- Sonar readout ---
let sonarAcc = 0;
function updateSonar(dt) {
  if (!boat.spec.features.sonar) return;
  sonarAcc += dt;
  if (sonarAcc < 0.4) return;
  sonarAcc = 0;
  const at = helm === tender ? tender.pos : boat.pos;
  const near = lake.hotspotsNear(at.x, at.z, CONFIG.SONAR_RANGE).slice(0, 4);
  hud.setSonar(near.map((e) => ({
    dist: e.dist,
    lure: LURES.find((l) => l.id === e.hotspot.lureId) || LURES[0],
    bearing: Math.atan2(e.hotspot.x - at.x, -(e.hotspot.z - at.z)),
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
  boat.update(dt, helm === boat ? move : { x: 0, z: 0 }, t);
  tender.update(dt, t, helm === tender ? move : { x: 0, z: 0 }, boat, helm === tender);
  // Two hulls, one patch of water: neither drives through the other.
  if (tender.deployed) separateHulls(boat, tender);
  const eye = helm === tender ? tender.pos : boat.pos;
  lake.update(t, eye.x, eye.z);
  ambientFish.setFocus(eye.x, eye.z);
  ambientFish.update(t, dt);
  if (state === 'play') {
    fishing.update(dt, t);
    updateDocks(dt);
    updateSonar(dt);
  }
  crew.update(dt, t, helm === tender);
  rig.update(dt, t, (helm === tender ? tender : boat).group.position);

  // Keep the sun (and its shadow frustum) centered on the boat.
  sun.position.set(eye.x + SUN_OFFSET.x, SUN_OFFSET.y, eye.z + SUN_OFFSET.z);
  sun.target.position.set(eye.x, 0, eye.z);

  hud.setWallet(player.balance, rtp.netRound());
  hud.setTenderChip(tender);
  if (state === 'play') {
    const mar = docks.nearest(eye.x, eye.z);
    hud.setFinders(eye, mar.dist <= DOCK_HINT_RANGE ? mar : null);
  }

  saveAcc += dt;
  if (saveAcc > 3) { saveAcc = 0; player.save(); }

  renderer.render(scene, camera);
}
frame();

// Debug/test handle (harmless in production).
window.BNT = {
  hud, rtp, fishing, boat, tender, crew, player, dex, marina, docks, lake, rig, SPECIES,
  equipBoat, refreshShipPanel, separateHulls,
  get helm() { return helm; },
};

// --- PWA ---
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
