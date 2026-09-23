// Dressing a crew member.
//
// The character textures are baked with a CLASS in their alpha channel —
// skin and eyes, hair, hat, top, trousers, boots — while the colour channels
// keep the original painted shading. To give one of the three NPC bodies a
// look of its own we keep every fixed texel as painted and repaint the rest
// per garment: palette colour times how light the painted texel was against
// its garment's average. Creases, seams and the dark of a pupil survive
// because they are multiplicative; only the colour changes.
//
// The class is stored as 255 - class * CLASS_STEP so that no texel is ever
// near transparent — a browser canvas premultiplies alpha, and colour under
// a low alpha comes back rounded to mush.

import * as THREE from 'three';

export const CLASS_STEP = 12;
export const CLASSES = ['fixed', 'hair', 'hat', 'top', 'bottom', 'boots'];

// Named hair colours, all dark enough to read at gameplay distance.
export const HAIR = {
  black: '#1d1a1a', brown: '#4a3222', chestnut: '#6b3f24', ginger: '#a4552a',
  blond: '#c9a25b', grey: '#8b8a86', sandy: '#9c7a4a',
};
// Working clothes in colours that stay apart from each other on deck.
export const TOPS = ['#c9552b', '#2f6db0', '#d9b640', '#3d8f5a', '#8b3a4f', '#e8e2d2', '#6a5a8f', '#b8743a', '#2e3944'];
export const BOTTOMS = ['#3b4a5c', '#5a4636', '#2a2f38', '#6d6a5f', '#8a3f2b', '#4a5a3a'];
export const HATS = ['#c9552b', '#2f6db0', '#d9b640', '#2e3944', '#e8e2d2', '#8b3a4f'];
export const BOOTS = ['#3a2a1e', '#1f1c1a', '#5a4030', '#2c3038'];

/** A deterministic look for the n-th crew member, so the same hand has the
 *  same coat every time you see them. */
export function lookFor(seed) {
  let s = (seed * 2654435761) >>> 0;
  const pick = (arr) => { s = (s * 1664525 + 1013904223) >>> 0; return arr[s % arr.length]; };
  const hairKeys = Object.keys(HAIR);
  return {
    hair: HAIR[pick(hairKeys)],
    hat: pick(HATS),
    top: pick(TOPS),
    bottom: pick(BOTTOMS),
    boots: pick(BOOTS),
  };
}

export function lookKey(look) {
  return look ? `${look.hair}|${look.hat}|${look.top}|${look.bottom}|${look.boots}` : 'as-painted';
}

function rgbOf(hex) {
  const c = new THREE.Color(hex);
  return [c.r * 255, c.g * 255, c.b * 255];
}

/**
 * Composite a painted character atlas into a dressed one. `image` is the
 * baked atlas (RGB + class alpha), `classLum` the per-class mean luminance
 * the bake recorded, `look` the palette (or null to keep it as painted).
 * Returns a canvas.
 */
export function dressCanvas(image, classLum, look) {
  const w = image.width || image.naturalWidth;
  const h = image.height || image.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const pal = [null,
    look && rgbOf(look.hair), look && rgbOf(look.hat), look && rgbOf(look.top),
    look && rgbOf(look.bottom), look && rgbOf(look.boots)];
  for (let i = 0; i < d.length; i += 4) {
    const cls = Math.round((255 - d[i + 3]) / CLASS_STEP);
    d[i + 3] = 255;
    if (!look || cls <= 0 || cls >= pal.length || !pal[cls]) continue;
    const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const k = lum / Math.max(1, classLum[cls] || 128);
    const p = pal[cls];
    // Shade the palette colour by the painted light; let highlights push a
    // little past the flat colour so a fold still catches the sun.
    d[i] = Math.min(255, p[0] * k);
    d[i + 1] = Math.min(255, p[1] * k);
    d[i + 2] = Math.min(255, p[2] * k);
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
