// Unified input:
//  Desktop: WASD/arrows to move, click+swipe up to cast, click the net to
//           trawl, click to reel.
//  Mobile:  static joystick (bottom-left) to move, swipe up to cast, tap the
//           net to trawl, tap to reel.

import * as THREE from 'three';

const SWIPE_MIN_PX = 60;
const SWIPE_MAX_MS = 1500;
const TAP_MAX_PX = 12;
const TAP_MAX_MS = 400;

export class Input {
  /**
   * handlers: { cast(power), tapNet(), tap() }
   */
  constructor(canvas, camera, getNetObject, handlers) {
    this.canvas = canvas;
    this.camera = camera;
    this.getNetObject = getNetObject;
    this.handlers = handlers;
    this.enabled = false;

    this.keys = new Set();
    this.joy = { active: false, id: null, x: 0, y: 0 };
    this.raycaster = new THREE.Raycaster();
    this.pointer = null; // active gesture pointer

    this.isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e, true));

    this.setupJoystick();
  }

  setupJoystick() {
    const base = document.getElementById('joystick');
    const thumb = document.getElementById('joystick-thumb');
    if (!base) return;
    this.joyBase = base;
    this.joyThumb = thumb;
    if (!this.isTouch) base.classList.add('hidden');

    const RADIUS = 44;
    const center = () => {
      const r = base.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.joy.active = true;
      this.joy.id = e.pointerId;
      base.setPointerCapture(e.pointerId);
      this.moveJoy(e, center(), RADIUS);
    });
    base.addEventListener('pointermove', (e) => {
      if (this.joy.active && e.pointerId === this.joy.id) this.moveJoy(e, center(), RADIUS);
    });
    const end = (e) => {
      if (e.pointerId !== this.joy.id) return;
      this.joy.active = false;
      this.joy.x = this.joy.y = 0;
      thumb.style.transform = 'translate(0px, 0px)';
    };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
  }

  moveJoy(e, c, radius) {
    let dx = e.clientX - c.x, dy = e.clientY - c.y;
    const len = Math.hypot(dx, dy);
    if (len > radius) { dx *= radius / len; dy *= radius / len; }
    this.joy.x = dx / radius;
    this.joy.y = dy / radius;
    this.joyThumb.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  /** World-space XZ movement intent; screen-up maps to world -Z. */
  moveVector() {
    let x = 0, z = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) z -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) z += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    x += this.joy.x;
    z += this.joy.y;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z };
  }

  onDown(e) {
    if (!this.enabled || this.pointer) return;
    this.pointer = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY,
      x: e.clientX, y: e.clientY, t0: performance.now(),
    };
  }

  onMove(e) {
    if (this.pointer && e.pointerId === this.pointer.id) {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
    }
  }

  onUp(e, cancelled = false) {
    const p = this.pointer;
    if (!p || e.pointerId !== p.id) return;
    this.pointer = null;
    if (cancelled || !this.enabled) return;

    const dx = e.clientX - p.x0, dy = e.clientY - p.y0;
    const dist = Math.hypot(dx, dy);
    const dur = performance.now() - p.t0;

    if (dy < -SWIPE_MIN_PX && dur < SWIPE_MAX_MS && Math.abs(dy) > Math.abs(dx) * 1.2) {
      const power = Math.min(1, (-dy - SWIPE_MIN_PX) / 220);
      this.handlers.cast(power);
      return;
    }

    if (dist < TAP_MAX_PX && dur < TAP_MAX_MS) {
      if (this.hitNet(e.clientX, e.clientY)) this.handlers.tapNet();
      else this.handlers.tap();
    }
  }

  hitNet(cx, cy) {
    const net = this.getNetObject();
    if (!net) return false;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((cx - rect.left) / rect.width) * 2 - 1,
      -((cy - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObject(net, false).length > 0;
  }
}
