// A small map in the corner: the water and land round the boat, north up,
// the boat an arrow in the middle, the marinas dotted. It reads the same
// terrain the world is built from, painted into tiles on demand — one tile
// a frame, so a new stretch of country fills in over a second or two — and
// the tiles are kept, so ground you have covered stays drawn.
// Navigation only: nothing here touches a bet.

import { terrainHeight } from './terrain.js';
import { salinity, cellRegion, CELL } from './regions.js';

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
    this.painting = null;     // the tile under way: { tx, tz, c, g, img, row }
    this.frame = 0;
  }

  /** Paint one tile of country from the terrain, whole. */
  paintTile(tx, tz) {
    const p = this.startTile(tx, tz);
    while (!this.paintRows(p, TILE)) { /* to the end */ }
    return p.c;
  }

  startTile(tx, tz) {
    const c = document.createElement('canvas');
    c.width = c.height = TILE;
    const g = c.getContext('2d');
    return { tx, tz, c, g, img: g.createImageData(TILE, TILE), row: 0 };
  }

  /**
   * Paint the next `rows` rows of a tile. A whole tile is 2300 terrain
   * reads, 3 ms; a few rows a frame is nothing. True when it is done.
   */
  paintRows(p, rows) {
    const d = p.img.data;
    const ox = p.tx * TILE * MPP, oz = p.tz * TILE * MPP;
    const end = Math.min(TILE, p.row + rows);
    for (let py = p.row; py < end; py++) {
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
    p.row = end;
    if (end < TILE) return false;
    p.g.putImageData(p.img, 0, 0);
    return true;
  }

  /**
   * Draw the map round (x, z). `heading` is the hull's; `docks` a list of
   * {x, z}; `hotspot` is drawn when a sonar has found one.
   */
  update(x, z, heading, docks, others = null) {
    this.frame++;
    const { ctx, size } = this;
    const half = size / 2, reach = half * MPP;
    const t0x = Math.floor((x - reach) / (TILE * MPP)), t1x = Math.floor((x + reach) / (TILE * MPP));
    const t0z = Math.floor((z - reach) / (TILE * MPP)), t1z = Math.floor((z + reach) / (TILE * MPP));
    // The tile under way gets a few rows a frame; a new one starts when it
    // is done, nearest first.
    if (!this.painting) {
      let want = null, wd = Infinity;
      for (let tz = t0z; tz <= t1z; tz++) for (let tx = t0x; tx <= t1x; tx++) {
        if (this.tiles.has(tileKey(tx, tz))) continue;
        const dd = ((tx + 0.5) * TILE * MPP - x) ** 2 + ((tz + 0.5) * TILE * MPP - z) ** 2;
        if (dd < wd) { wd = dd; want = [tx, tz]; }
      }
      if (want) this.painting = this.startTile(want[0], want[1]);
    }
    if (this.painting && this.paintRows(this.painting, 6)) {
      const p = this.painting; this.painting = null;
      this.tiles.set(tileKey(p.tx, p.tz), { tx: p.tx, tz: p.tz, img: p.c });
      if (this.tiles.size > KEEP) {
        // Drop the tile furthest from here.
        let far = null, fd = -1;
        for (const [k, t] of this.tiles) { const dd = ((t.tx + 0.5) * TILE * MPP - x) ** 2 + ((t.tz + 0.5) * TILE * MPP - z) ** 2; if (dd > fd) { fd = dd; far = k; } }
        this.tiles.delete(far);
      }
    }
    if (this.frame % 4) return;             // fifteen redraws a second is plenty for a map

    // The country, the marinas and the names are painted on a layer that is
    // only redone when the boat has moved a pixel or a tile has come in (the
    // names' outlined text is the dear part); each redraw just shifts it.
    const layer = this.layer || (this.layer = { c: document.createElement('canvas'), x: NaN, z: NaN, tiles: -1 });
    if (layer.c.width !== size) { layer.c.width = layer.c.height = size; }
    if (Math.abs(x - layer.x) >= MPP || Math.abs(z - layer.z) >= MPP || layer.tiles !== this.tiles.size) {
      this.paintLayer(layer, x, z, docks, t0x, t1x, t0z, t1z);
    }
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath(); ctx.arc(half, half, half - 1, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(layer.c, (layer.x - x) / MPP, (layer.z - z) / MPP);
    // The other boats on the water: teal dots, where they are this instant.
    if (others) for (const o of others) {
      const sx = half + (o.x - x) / MPP, sz = half + (o.z - z) / MPP;
      if (Math.hypot(sx - half, sz - half) > half - 3) continue;
      ctx.fillStyle = '#3ee8d6';
      ctx.beginPath(); ctx.arc(sx, sz, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0, 40, 40, 0.6)'; ctx.lineWidth = 1; ctx.stroke();
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

  /** The map's still parts round (x, z): the tiles, the marinas, the names. */
  paintLayer(layer, x, z, docks, t0x, t1x, t0z, t1z) {
    const size = this.size, half = size / 2, reach = half * MPP;
    const ctx = layer.c.getContext('2d');
    layer.x = x; layer.z = z; layer.tiles = this.tiles.size;
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
    // The names of the waters in view, at their sites.
    ctx.font = 'bold 8px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(8, 30, 44, 0.85)'; ctx.fillStyle = '#ffffff';
    const c0x = Math.floor((x - reach) / CELL), c1x = Math.floor((x + reach) / CELL);
    const c0z = Math.floor((z - reach) / CELL), c1z = Math.floor((z + reach) / CELL);
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const r = cellRegion(cx, cz);
      const sx = half + (r.x - x) / MPP, sz = half + (r.z - z) / MPP;
      if (Math.hypot(sx - half, sz - half) > half - 10) continue;
      const words = r.name.split(' ');
      // Two lines when the name is long, so it fits the disc.
      const lines = words.length > 2 ? [words.slice(0, -1).join(' '), words[words.length - 1]] : [r.name];
      lines.forEach((ln, i) => { const ly = sz + (i - (lines.length - 1) / 2) * 9; ctx.strokeText(ln, sx, ly); ctx.fillText(ln, sx, ly); });
    }
  }
}
