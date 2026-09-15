// src/core/units.js — unit constants and conversions (SPEC section 3.5.1). Imports nothing.

export const MM_PER_M = 1000;
export const MM_PER_CM = 10;
export const CM_PER_M = 100;
export const DEG_PER_RAD = 180 / Math.PI;

/** @param {number} mm @returns {number} metres */
export function mmToM(mm) { return mm / 1000; }
/** @param {number} m @returns {number} mm */
export function mToMm(m) { return m * 1000; }
/** @param {number} cm @returns {number} metres */
export function cmToM(cm) { return cm / 100; }
/** @param {number} m @returns {number} cm */
export function mToCm(m) { return m * 100; }
/** @param {number} cm @returns {number} mm */
export function cmToMm(cm) { return cm * 10; }
/** @param {number} mm @returns {number} cm */
export function mmToCm(mm) { return mm / 10; }
/** @param {number} deg @returns {number} rad */
export function degToRad(deg) { return deg * Math.PI / 180; }
/** @param {number} rad @returns {number} deg */
export function radToDeg(rad) { return rad * DEG_PER_RAD; }

/** @param {number} v @param {number} lo @param {number} hi @returns {number} */
export function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * Round to `digits` decimals using Math.round(v * 10^d) / 10^d.
 * @param {number} v @param {number} digits @returns {number}
 */
export function roundTo(v, digits) {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/**
 * @param {number} v @param {number} digits @param {string} unit
 * @returns {string}
 */
function fmtUnit(v, digits, unit) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return v.toFixed(digits) + ' ' + unit;
}

/**
 * fmtMm(123.456) === '123.5 mm'; fmtMm(5, 0) === '5 mm'; non-finite -> '—'.
 * @param {number} mm @param {number} [digits=1] @returns {string}
 */
export function fmtMm(mm, digits = 1) { return fmtUnit(mm, digits, 'mm'); }
/**
 * fmtCm(88) === '88.0 cm'; non-finite -> '—'.
 * @param {number} cm @param {number} [digits=1] @returns {string}
 */
export function fmtCm(cm, digits = 1) { return fmtUnit(cm, digits, 'cm'); }
/** fmtM(1.6543, 3) === '1.654 m'. @param {number} m @param {number} [digits=3] @returns {string} */
export function fmtM(m, digits = 3) { return fmtUnit(m, digits, 'm'); }
/** fmtPct(5.123) === '5.1 %'. @param {number} pct @param {number} [digits=1] @returns {string} */
export function fmtPct(pct, digits = 1) { return fmtUnit(pct, digits, '%'); }

/**
 * Paper sizes in mm (portrait), printable window = size - 2*margin, tile step = printable - TILE_OVERLAP_MM.
 * @typedef {{id:'A4'|'Letter'|'A3', w_mm:number, h_mm:number, margin_mm:number}} Paper
 */
export const PAPER = Object.freeze({
  A4: Object.freeze({ id: 'A4', w_mm: 210, h_mm: 297, margin_mm: 10 }),
  Letter: Object.freeze({ id: 'Letter', w_mm: 215.9, h_mm: 279.4, margin_mm: 10 }),
  A3: Object.freeze({ id: 'A3', w_mm: 297, h_mm: 420, margin_mm: 10 }),
});
export const PAPER_IDS = Object.freeze(['A4', 'Letter', 'A3']);
export const TILE_OVERLAP_MM = 10;

/** @param {Paper} paper @returns {{w_mm:number, h_mm:number}} */
export function printableArea(paper) {
  return { w_mm: paper.w_mm - 2 * paper.margin_mm, h_mm: paper.h_mm - 2 * paper.margin_mm };
}

/** @param {Paper} paper @returns {{w_mm:number, h_mm:number}} */
export function tileStep(paper) {
  const p = printableArea(paper);
  return { w_mm: p.w_mm - TILE_OVERLAP_MM, h_mm: p.h_mm - TILE_OVERLAP_MM };
}

/**
 * Tiles needed for a W x H mm layout: ceil((W - overlap) / step.w) x ceil((H - overlap) / step.h), min 1 x 1.
 * @param {Paper} paper @param {number} W_mm @param {number} H_mm
 * @returns {{cols:number, rows:number, pages:number}}
 */
export function tileCount(paper, W_mm, H_mm) {
  const step = tileStep(paper);
  const cols = Math.max(1, Math.ceil((W_mm - TILE_OVERLAP_MM) / step.w_mm));
  const rows = Math.max(1, Math.ceil((H_mm - TILE_OVERLAP_MM) / step.h_mm));
  return { cols, rows, pages: cols * rows };
}
