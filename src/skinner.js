// Skin painting at runtime.
//
// The converter bakes a *neutral* texture into each hull's GLB: instead of a
// colour, every pixel stores where it sits along the four-stop paint ramp
// (0 = accent, 255 = trim), soft band blending already applied. That means
// one model can wear any palette — a hull's four skins cost one download
// between them rather than four.
//
// Here we turn that ramp coordinate back into colour with a 256-entry lookup
// built from the skin's paint, and cache the result per skin.

import * as THREE from 'three';

const cache = new Map();          // `${hullId}:${skinId}` -> CanvasTexture

function hexToRGB(hex) {
  const c = new THREE.Color(hex);
  return [c.r * 255, c.g * 255, c.b * 255];
}

/** 256-entry colour table sampled along a paint ramp. */
function buildLUT(paint) {
  const stops = paint.map(hexToRGB);
  const last = stops.length - 1;
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const u = (i / 255) * last;
    const a = Math.min(last, Math.floor(u));
    const b = Math.min(last, a + 1);
    const f = u - a;
    lut[i * 3] = stops[a][0] + (stops[b][0] - stops[a][0]) * f;
    lut[i * 3 + 1] = stops[a][1] + (stops[b][1] - stops[a][1]) * f;
    lut[i * 3 + 2] = stops[a][2] + (stops[b][2] - stops[a][2]) * f;
  }
  return lut;
}

/**
 * Recolour a neutral source image with a paint ramp.
 * `source` may be an ImageBitmap, HTMLImageElement or canvas.
 * Returns a canvas (so callers can use it as a texture or draw it into UI).
 */
export function paintCanvas(source, paint) {
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const lut = buildLUT(paint);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;             // leave transparent pixels alone
    const u = d[i] * 3;                        // red channel carries the ramp
    d[i] = lut[u];
    d[i + 1] = lut[u + 1];
    d[i + 2] = lut[u + 2];
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Cached CanvasTexture for a hull model wearing a given skin. */
export function skinTexture(source, spec) {
  const key = `${spec.hullId}:${spec.skinId}`;
  if (cache.has(key)) return cache.get(key);
  const tex = new THREE.CanvasTexture(paintCanvas(source, spec.paint));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;                           // matches the GLB convention
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/**
 * Apply a skin to a freshly cloned hull. The GLB's own neutral map is the
 * source; if anything about it is not readable yet we leave the hull as-is
 * rather than risk a blank boat.
 */
export function applySkin(root, spec) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const src = o.material.map && o.material.map.image;
    if (!src || !(src.width || src.naturalWidth)) return;
    const mat = o.material.clone();
    mat.map = skinTexture(src, spec);
    mat.needsUpdate = true;
    o.material = mat;
  });
}
