// src/geometry/pack.js — shelf packer for the print sheet (SPEC 5.8). Pure; mm.

/**
 * Shelf packer: items sorted by height desc (stable), placed left-to-right on shelves of the sheet width with `gap`
 * between items; a new shelf starts when the next item does not fit. Rotation by 90° is tried for an item that does not
 * fit the remaining shelf width but fits rotated (only when allowRotate). Placements are returned in ITEM order.
 * @param {{id:string, w:number, h:number}[]} items mm @param {number} sheetWidth mm @param {{gap?: number, allowRotate?: boolean}} [opts] gap default 10
 * @returns {{placements: {id:string, x:number, y:number, rotated:boolean}[], width:number, height:number}}
 */
export function packRects(items, sheetWidth, opts) {
  const gap = (opts && typeof opts.gap === 'number' && opts.gap >= 0) ? opts.gap : 10;
  const allowRotate = !!(opts && opts.allowRotate);
  const W = (typeof sheetWidth === 'number' && sheetWidth > 0) ? sheetWidth : Infinity;
  const order = items.map((it, i) => i).sort((a, b) => (items[b].h - items[a].h) || (a - b));
  const placements = new Array(items.length);
  let shelfY = 0;
  let shelfH = 0;
  let cursorX = 0;
  let width = 0;
  let first = true;
  for (const idx of order) {
    const it = items[idx];
    let w = Math.max(0, it.w);
    let h = Math.max(0, it.h);
    let rotated = false;
    const need = (cursorX > 0 ? gap : 0) + w;
    let fits = first || cursorX + need <= W + 1e-9;
    if (!fits && allowRotate && cursorX + (cursorX > 0 ? gap : 0) + h <= W + 1e-9) {
      rotated = true;
      const tmp = w;
      w = h;
      h = tmp;
      fits = true;
    }
    if (!fits) {
      // new shelf
      shelfY += shelfH + gap;
      shelfH = 0;
      cursorX = 0;
      if (allowRotate && w > W && h <= W) {
        rotated = true;
        const tmp = w;
        w = h;
        h = tmp;
      }
    }
    const x = cursorX > 0 ? cursorX + gap : 0;
    placements[idx] = { id: it.id, x, y: shelfY, rotated };
    cursorX = x + w;
    if (h > shelfH) shelfH = h;
    if (cursorX > width) width = cursorX;
    first = false;
  }
  const height = items.length ? shelfY + shelfH : 0;
  return { placements, width, height };
}
