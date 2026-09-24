// Place labels pinned in the world, the way a maps app marks a summit or a
// beach: a small pill of text on a pin, always facing the camera, drawn
// over everything and always the same size on screen. They come and go
// with the chunks their landmarks are in and fade out with distance so the
// water never fills with names.

import * as THREE from 'three';

const KIND_ICON = { peak: '▲', hill: '▲', beach: '≈', rock: '●', dam: '▬', falls: '⫽', point: '◆' };
const KIND_COLOR = { peak: '#e8eef2', hill: '#d9e6cf', beach: '#f3e2b0', rock: '#d7d7d0', dam: '#d9b98a', falls: '#cfe9f7', point: '#dfe8f0' };
const FADE_NEAR = 95, FADE_FAR = 140;

function labelTexture(text, kind) {
  const c = document.createElement('canvas');
  const scale = 2;
  const font = `700 ${15 * scale}px 'Avenir Next', 'Segoe UI', system-ui, sans-serif`;
  const ctx = c.getContext('2d');
  ctx.font = font;
  const icon = KIND_ICON[kind] || '●';
  const w = Math.ceil(ctx.measureText(text).width) + 46 * scale;
  const h = 26 * scale, pin = 12 * scale;
  c.width = w; c.height = h + pin;
  ctx.font = font;
  // Pill
  ctx.fillStyle = 'rgba(8, 40, 56, 0.82)';
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(r, h); ctx.arc(r, r, r, Math.PI / 2, Math.PI * 1.5); ctx.closePath();
  ctx.fill();
  // Pin
  ctx.beginPath();
  ctx.moveTo(w / 2 - 6 * scale, h - 1); ctx.lineTo(w / 2 + 6 * scale, h - 1); ctx.lineTo(w / 2, h + pin); ctx.closePath();
  ctx.fill();
  // Icon + text
  ctx.textBaseline = 'middle';
  ctx.fillStyle = KIND_COLOR[kind] || '#fff';
  ctx.font = `700 ${13 * scale}px system-ui, sans-serif`;
  ctx.fillText(icon, 12 * scale, r + 1);
  ctx.font = font;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 30 * scale, r + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  return { tex, w: c.width, h: c.height };
}

export class Labels {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.active = new Map();   // landmark -> sprite
    this.aspect = window.innerWidth / window.innerHeight;
    this.focus = new THREE.Vector3();
    this.count = 0;
  }

  setAspect(a) { this.aspect = a; for (const sp of this.active.values()) this.size(sp); }

  size(sp) {
    // Constant on screen: a label is ~4% of the viewport height.
    const hFrac = 0.084;
    sp.scale.set(hFrac * (sp.userData.w / sp.userData.h) / this.aspect, hFrac, 1);
  }

  sync(landmarks) {
    for (const lm of landmarks) {
      if (this.active.has(lm)) continue;
      const { tex, w, h } = labelTexture(lm.name, lm.kind);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
      const sp = new THREE.Sprite(mat);
      sp.center.set(0.5, 0);
      sp.position.set(lm.x, 0.8, lm.z);
      sp.renderOrder = 50;
      sp.userData = { w, h, lm };
      this.size(sp);
      this.group.add(sp);
      this.active.set(lm, sp);
    }
    for (const [lm, sp] of this.active) {
      if (!landmarks.includes(lm)) {
        this.group.remove(sp);
        sp.material.map.dispose();
        sp.material.dispose();
        this.active.delete(lm);
      }
    }
    this.count = this.active.size;
  }

  update(x, z) {
    for (const [lm, sp] of this.active) {
      const d = Math.hypot(lm.x - x, lm.z - z);
      const o = d >= FADE_FAR ? 0 : d <= FADE_NEAR ? 1 : (FADE_FAR - d) / (FADE_FAR - FADE_NEAR);
      sp.material.opacity = o;
      sp.visible = o > 0.01;
    }
  }
}
