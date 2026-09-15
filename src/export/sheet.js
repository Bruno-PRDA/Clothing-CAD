// src/export/sheet.js — pure tiling math (SPEC section 10.4). Paper sizes come from core/units.js PAPER; page counts
// come from core/units.js tileCount (nothing re-derives them for the default overlap).

import { PAPER, TILE_OVERLAP_MM, tileCount } from '../core/units.js';
import { validationError } from '../sizing/index.js';

/**
 * @typedef {Object} TilePlan
 * @property {'A4'|'Letter'|'A3'} paper
 * @property {'portrait'|'landscape'} orientation
 * @property {number} paperW_mm
 * @property {number} paperH_mm
 * @property {number} margin_mm
 * @property {number} overlap_mm
 * @property {number} printableW_mm
 * @property {number} printableH_mm
 * @property {number} stepX_mm
 * @property {number} stepY_mm
 * @property {number} cols
 * @property {number} rows
 * @property {{row:number, col:number, label:string, x0:number, y0:number, w:number, h:number, index:number}[]} tiles  row-major
 */

/** @type {ReadonlyArray<'A4'|'Letter'|'A3'>} */
export const PAPER_SIZES = Object.freeze(['A4', 'Letter', 'A3']);

const MAX_PAGES = 400;

/** 'A1' = row 0 col 0; rows A..Z, AA..; cols 1... @param {number} row @param {number} col @returns {string} */
export function tileLabel(row, col) {
  let r = Math.max(0, Math.trunc(row));
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (r % 26)) + letters;
    r = Math.floor(r / 26) - 1;
  } while (r >= 0);
  return letters + String(Math.max(0, Math.trunc(col)) + 1);
}

/**
 * Tiling math. Throws PRINT_PAPER_UNKNOWN, PRINT_TOO_MANY_PAGES, PRINT_OPTS_INVALID.
 * @param {{width_mm: number, height_mm: number}} sheet
 * @param {{paper?: string, orientation?: 'portrait'|'landscape', margin_mm?: number, overlap_mm?: number}} [opts]
 * @returns {TilePlan}
 */
export function tileSheet(sheet, opts) {
  const o = opts || {};
  const paperId = o.paper === undefined || o.paper === null ? 'A4' : o.paper;
  const paper = PAPER[/** @type {'A4'|'Letter'|'A3'} */ (paperId)];
  if (!paper || !PAPER_SIZES.includes(/** @type {any} */ (paperId))) {
    throw validationError('PRINT_PAPER_UNKNOWN', `Unknown paper "${String(paperId)}"`);
  }
  const orientation = o.orientation === undefined || o.orientation === null ? 'portrait' : o.orientation;
  if (orientation !== 'portrait' && orientation !== 'landscape') {
    throw validationError('PRINT_OPTS_INVALID', `Unknown orientation "${String(orientation)}"`);
  }
  const margin = o.margin_mm === undefined || o.margin_mm === null ? paper.margin_mm : o.margin_mm;
  const overlap = o.overlap_mm === undefined || o.overlap_mm === null ? TILE_OVERLAP_MM : o.overlap_mm;
  if (!(typeof margin === 'number' && Number.isFinite(margin) && margin >= 0 && margin <= 25)) {
    throw validationError('PRINT_OPTS_INVALID', `margin_mm must be in [0, 25], got ${String(margin)}`);
  }
  if (!(typeof overlap === 'number' && Number.isFinite(overlap) && overlap >= 0 && overlap <= 30)) {
    throw validationError('PRINT_OPTS_INVALID', `overlap_mm must be in [0, 30], got ${String(overlap)}`);
  }
  const W = sheet ? sheet.width_mm : NaN;
  const H = sheet ? sheet.height_mm : NaN;
  if (!(Number.isFinite(W) && Number.isFinite(H) && W > 0 && H > 0)) {
    throw validationError('PRINT_OPTS_INVALID', `sheet size must be positive, got ${String(W)} × ${String(H)}`);
  }
  const paperW = orientation === 'landscape' ? paper.h_mm : paper.w_mm;
  const paperH = orientation === 'landscape' ? paper.w_mm : paper.h_mm;
  const printableW = paperW - 2 * margin;
  const printableH = paperH - 2 * margin;
  const stepX = printableW - overlap;
  const stepY = printableH - overlap;
  if (!(stepX > 0 && stepY > 0)) throw validationError('PRINT_OPTS_INVALID', 'overlap exceeds the printable area');

  let cols;
  let rows;
  if (overlap === TILE_OVERLAP_MM) {
    // the core formula, verbatim (a Paper-shaped object with the requested margin/orientation)
    const tc = tileCount({ id: paper.id, w_mm: paperW, h_mm: paperH, margin_mm: margin }, W, H);
    cols = tc.cols;
    rows = tc.rows;
  } else {
    cols = Math.max(1, Math.ceil((W - overlap) / stepX));
    rows = Math.max(1, Math.ceil((H - overlap) / stepY));
  }
  if (cols * rows > MAX_PAGES) {
    throw validationError('PRINT_TOO_MANY_PAGES', `${cols} × ${rows} = ${cols * rows} pages exceeds ${MAX_PAGES}`);
  }
  /** @type {TilePlan['tiles']} */
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push({ row: r, col: c, label: tileLabel(r, c), x0: c * stepX, y0: r * stepY, w: printableW, h: printableH, index: tiles.length });
    }
  }
  return {
    paper: paper.id, orientation, paperW_mm: paperW, paperH_mm: paperH, margin_mm: margin, overlap_mm: overlap,
    printableW_mm: printableW, printableH_mm: printableH, stepX_mm: stepX, stepY_mm: stepY, cols, rows, tiles,
  };
}
