// Camera rig with two modes:
//  - menu: low over the waterline, boat bobbing, underwater fish visible in
//    the lower half of the frame
//  - play: ~30 degrees off top-down, fixed rotation (never follows the
//    boat's heading), smoothly tracking the boat's position
// plus a soft ease between them when the game starts.

import * as THREE from 'three';
import { CONFIG } from './config.js';

const MENU_OFFSET = new THREE.Vector3(5.4, 2.5, 8.6);
const MENU_LOOK = new THREE.Vector3(0, 0.55, 0);

function playOffset() {
  const el = THREE.MathUtils.degToRad(CONFIG.CAM_ELEV_DEG);
  return new THREE.Vector3(0, Math.sin(el) * CONFIG.CAM_DIST, Math.cos(el) * CONFIG.CAM_DIST);
}

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'menu';
    this.playOff = playOffset();
    this.transT = 0;
    this.transFrom = new THREE.Vector3();
    this.transFromQuat = new THREE.Quaternion();
    this.followPos = new THREE.Vector3();
    this.tmpPos = new THREE.Vector3();
    this.tmpQuat = new THREE.Quaternion();
    this.tmpM = new THREE.Matrix4();
  }

  startGame() {
    this.mode = 'transition';
    this.transT = 0;
    this.transFrom.copy(this.camera.position);
    this.transFromQuat.copy(this.camera.quaternion);
  }

  backToMenu() {
    this.mode = 'toMenu';
    this.transT = 0;
    this.transFrom.copy(this.camera.position);
    this.transFromQuat.copy(this.camera.quaternion);
  }

  /** The menu-mode camera pose (with its idle drift) at time t. */
  menuPose(t, boatPos, outPos, outQuat) {
    outPos.set(
      boatPos.x + MENU_OFFSET.x + Math.sin(t * 0.12) * 0.6,
      MENU_OFFSET.y + Math.sin(t * 0.5) * 0.08,
      boatPos.z + MENU_OFFSET.z + Math.cos(t * 0.09) * 0.6);
    this.tmpM.lookAt(outPos,
      new THREE.Vector3(boatPos.x + MENU_LOOK.x, MENU_LOOK.y, boatPos.z + MENU_LOOK.z),
      new THREE.Vector3(0, 1, 0));
    outQuat.setFromRotationMatrix(this.tmpM);
  }

  update(dt, t, boatPos) {
    const cam = this.camera;
    if (this.mode === 'menu') {
      // Gentle drift around the boat.
      this.menuPose(t, boatPos, cam.position, cam.quaternion);
      this.followPos.copy(boatPos);
    } else if (this.mode === 'toMenu') {
      this.transT += dt / 1.9;
      const k = easeInOut(Math.min(1, this.transT));
      this.menuPose(t, boatPos, this.tmpPos, this.tmpQuat);
      cam.position.lerpVectors(this.transFrom, this.tmpPos, k);
      cam.quaternion.slerpQuaternions(this.transFromQuat, this.tmpQuat, k);
      if (this.transT >= 1) this.mode = 'menu';
    } else if (this.mode === 'transition') {
      this.transT += dt / 2.2;
      const k = easeInOut(Math.min(1, this.transT));
      // Destination pose
      this.tmpPos.set(boatPos.x + this.playOff.x, this.playOff.y, boatPos.z + this.playOff.z);
      this.tmpM.lookAt(this.tmpPos, boatPos, new THREE.Vector3(0, 1, 0));
      this.tmpQuat.setFromRotationMatrix(this.tmpM);
      cam.position.lerpVectors(this.transFrom, this.tmpPos, k);
      cam.quaternion.slerpQuaternions(this.transFromQuat, this.tmpQuat, k);
      if (this.transT >= 1) {
        this.mode = 'play';
        this.followPos.copy(boatPos);
      }
    } else {
      // Fixed-rotation follow.
      this.followPos.lerp(boatPos, Math.min(1, CONFIG.CAM_FOLLOW_LERP * dt));
      cam.position.set(
        this.followPos.x + this.playOff.x,
        this.playOff.y,
        this.followPos.z + this.playOff.z);
      cam.lookAt(this.followPos.x, 0, this.followPos.z);
    }
  }
}
