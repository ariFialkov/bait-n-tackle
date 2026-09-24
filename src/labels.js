// Place labels pinned to their points in the world, the way a maps app
// marks a summit or a beach: an HTML pill on a pin, the same size as the
// rest of the HUD, held over the landmark by projecting its position each
// frame — so it stays on the hill as the camera moves, not on the screen.
// A label fades in as its landmark comes into view and fades out again as
// it leaves, and only the ones within a couple of hundred metres exist.

import * as THREE from 'three';

const KIND_ICON = { peak: '▲', hill: '▲', beach: '≈', rock: '●', dam: '▬', falls: '⫽', point: '◆' };
const KIND_CLASS = { peak: 'peak', hill: 'hill', beach: 'beach', rock: 'rock', dam: 'dam', falls: 'falls', point: 'point' };
const SHOW_DIST = 150;      // metres: nearer than this a label is on
const KEEP_DIST = 175;      // ... and it is not dropped until this far

export class Labels {
  constructor(container, camera) {
    this.container = container;
    this.camera = camera;
    this.active = new Map();   // landmark -> { el, on }
    this.count = 0;
    this._v = new THREE.Vector3();
  }

  sync(landmarks) {
    for (const lm of landmarks) {
      if (this.active.has(lm)) continue;
      const el = document.createElement('div');
      el.className = `lm ${KIND_CLASS[lm.kind] || ''}`;
      el.innerHTML = `<span class="lm-pill"><span class="lm-icon">${KIND_ICON[lm.kind] || '●'}</span>${lm.name}</span><span class="lm-pin"></span>`;
      this.container.appendChild(el);
      this.active.set(lm, { el, on: false });
    }
    for (const [lm, a] of this.active) {
      if (!landmarks.includes(lm)) { a.el.remove(); this.active.delete(lm); }
    }
    this.count = this.active.size;
  }

  /** Hold every label over its point; on when it is in view and near. */
  update(x, z, playing = true) {
    const w = window.innerWidth, h = window.innerHeight;
    const v = this._v;
    for (const [lm, a] of this.active) {
      const d = Math.hypot(lm.x - x, lm.z - z);
      let on = playing && d < (a.on ? KEEP_DIST : SHOW_DIST);
      if (on) {
        v.set(lm.x, 1.2, lm.z).project(this.camera);
        on = v.z < 1 && v.x > -1.05 && v.x < 1.05 && v.y > -1.05 && v.y < 1.05;
        if (on) {
          const sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h;
          a.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
        }
      }
      if (on !== a.on) { a.on = on; a.el.classList.toggle('show', on); }
    }
  }
}
