// Skin painting at runtime.
//
// The converter bakes NEUTRAL maps for each hull: instead of a colour, every
// pixel stores where it sits along the four-stop paint ramp (0 = first stop,
// 255 = last). One model can therefore wear any palette — a hull's skins cost
// one download between them rather than one each.
//
// There are two neutral maps per hull, one per paint style:
//   clean — embedded in the GLB. Labels come from the geometry (hull, deck,
//           superstructure, fittings), so every component is one flat colour.
//   camo  — a sidecar <hull>-camo.png. Four soft bands following the model's
//           own shading; busy and patchy, for the themed high tiers.
// Here we turn a ramp coordinate back into colour with a 256-entry lookup
// built from the skin's paint, and cache the result per skin.

import * as THREE from 'three';
import { boatCamoURL } from './boats.js';

const cache = new Map();          // `${hullId}:${skinId}` -> CanvasTexture
const camoSources = new Map();    // hullId -> Promise<HTMLImageElement|null>

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

/** The hull's camo neutral map, fetched once. Resolves null if it is missing. */
function camoSource(hullId) {
  if (!camoSources.has(hullId)) {
    camoSources.set(hullId, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = boatCamoURL(hullId);
    }));
  }
  return camoSources.get(hullId);
}

/**
 * Apply a skin to a freshly cloned hull. Async because a camo skin may need
 * its sidecar map fetched; clean skins resolve immediately.
 *
 * Modelled hulls carry a neutral map and get recoloured through the LUT.
 * Procedural hulls (hullshapes.js) have no texture at all — each of their
 * meshes is tagged with the paint stop it wears, so they take the same
 * palette by flat colour. Anything that is neither is left alone rather
 * than risking a blank boat.
 */
export async function applySkin(root, spec) {
  const paint = spec.paint || [];
  // A camo skin swaps the GLB's clean map for the sidecar. If the sidecar is
  // missing it falls back to the clean map — a flat boat beats a blank one.
  const camo = spec.style === 'camo' ? await camoSource(spec.hullId) : null;

  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;

    const ramp = o.userData?.ramp ?? o.material.userData?.ramp;
    if (ramp != null && paint[ramp]) {
      const mat = o.material.clone();
      mat.color = new THREE.Color(paint[ramp]);
      mat.userData = { ...o.material.userData, ramp };
      mat.needsUpdate = true;
      o.material = mat;
      return;
    }

    const src = camo || (o.material.map && o.material.map.image);
    if (!src || !(src.width || src.naturalWidth)) return;
    const mat = o.material.clone();
    mat.map = skinTexture(src, spec);
    mat.needsUpdate = true;
    o.material = mat;
  });
}
