// A small map in the corner: the water and land round the boat, north up,
// the boat an arrow in the middle, the marinas dotted. It reads the same
// terrain the world is built from, painted into tiles on demand — one tile
// a frame, so a new stretch of country fills in over a second or two — and
// the tiles are kept, so ground you have covered stays drawn.
// Navigation only: nothing here touches a bet.

import { terrainHeight } from './terrain.js';
import { salinity } from './regions.js';

const MPP = 5;            // metres per map pixel
const TILE = 48;          // pixels a side (240 m)
const KEEP = 400;         // tiles kept before the far ones are dropped

function tileKey(tx, tz) { return tx + '|' + tz; }

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = canvas.width;
    this.tiles = new Map();
    this.pending = [];
    this.frame = 0;
  }

  /** Paint one tile of country from the terrain. */
  paintTile(tx, tz) {
    const c = document.createElement('canvas');
    c.width = c.height = TILE;
    const g = c.getContext('2d');
    const img = g.createImageData(TILE, TILE);
    const d = img.data;
    const ox = tx * TILE * MPP, oz = tz * TILE * MPP;
    for (let py = 0; py < TILE; py++) {
      for (let px = 0; px < TILE; px++) {
        const x = ox + (px + 0.5) * MPP, z = oz + (py + 0.5) * MPP;
        const h = terrainHeight(x, z);
        let r, gg, b;
        if (h < 0) {
          // Water: paler in the shallows, deeper blue with depth, the sea darker and greener.
          const depth = Math.min(1, -h / 12), salt = salinity(x, z);
          r = 96 - depth * 60; gg = 178 - depth * 80; b = 205 - depth * 60;
          r -= salt * 40; gg -= salt * 30; b -= salt * 20;
        } else if (h < 0.9) {
          r = 214; gg = 200; b = 160;            // the shore
        } else {
          const hi = Math.min(1, h / 30);
          r = 104 + hi * 90; gg = 150 + hi * 50; b = 88 + hi * 90;   // green rising to grey
          if (h > 24) { r = 226; gg = 230; b = 236; }               // snow
        }
        const o = (py * TILE + px) * 4;
        d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  /**
   * Draw the map round (x, z). `heading` is the hull's; `docks` a list of
   * {x, z}; `hotspot` is drawn when a sonar has found one.
   */
  update(x, z, heading, docks) {
    this.frame++;
    if (this.frame % 2) return;             // every other frame is plenty for a map
    const { ctx, size } = this;
    const half = size / 2, reach = half * MPP;
    const t0x = Math.floor((x - reach) / (TILE * MPP)), t1x = Math.floor((x + reach) / (TILE * MPP));
    const t0z = Math.floor((z - reach) / (TILE * MPP)), t1z = Math.floor((z + reach) / (TILE * MPP));
    // One new tile a frame, nearest first.
    let want = null, wd = Infinity;
    for (let tz = t0z; tz <= t1z; tz++) for (let tx = t0x; tx <= t1x; tx++) {
      if (this.tiles.has(tileKey(tx, tz))) continue;
      const dd = ((tx + 0.5) * TILE * MPP - x) ** 2 + ((tz + 0.5) * TILE * MPP - z) ** 2;
      if (dd < wd) { wd = dd; want = [tx, tz]; }
    }
    if (want) {
      this.tiles.set(tileKey(want[0], want[1]), { tx: want[0], tz: want[1], img: this.paintTile(want[0], want[1]) });
      if (this.tiles.size > KEEP) {
        // Drop the tile furthest from here.
        let far = null, fd = -1;
        for (const [k, t] of this.tiles) { const dd = ((t.tx + 0.5) * TILE * MPP - x) ** 2 + ((t.tz + 0.5) * TILE * MPP - z) ** 2; if (dd > fd) { fd = dd; far = k; } }
        this.tiles.delete(far);
      }
    }

    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath(); ctx.arc(half, half, half - 1, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#1b3a4a';
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;
    for (let tz = t0z; tz <= t1z; tz++) for (let tx = t0x; tx <= t1x; tx++) {
      const t = this.tiles.get(tileKey(tx, tz));
      if (!t) continue;
      const sx = half + (tx * TILE * MPP - x) / MPP, sz = half + (tz * TILE * MPP - z) / MPP;
      ctx.drawImage(t.img, Math.round(sx), Math.round(sz));
    }
    // Marinas.
    if (docks) for (const dk of docks) {
      const sx = half + (dk.x - x) / MPP, sz = half + (dk.z - z) / MPP;
      if (Math.hypot(sx - half, sz - half) > half - 4) continue;
      ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.arc(sx, sz, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // The boat: an arrow the way the bow points. Forward is (-sin h, -cos h).
    const ang = Math.atan2(-Math.cos(heading), -Math.sin(heading));
    ctx.translate(half, half); ctx.rotate(ang);
    ctx.fillStyle = '#ff7a3d';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, 4.5); ctx.lineTo(-2.5, 0); ctx.lineTo(-5, -4.5); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    // North.
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', half, 10);
  }
}
