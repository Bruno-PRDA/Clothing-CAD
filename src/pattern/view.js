// src/pattern/view.js — 2D view transform (SPEC 11.9.2). mm (y up) <-> CSS px (y down), pan/zoom, devicePixelRatio.
// Imports only src/core and src/geometry.

import { clamp } from '../core/units.js';
import { flattenPiece, mirrorPoint } from '../geometry/index.js';

/** @typedef {import('../core/types.js').Vec2} Vec2 */
/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */

/** Minimum / maximum zoom, CSS px per millimetre. */
export const MIN_PX_PER_MM = 0.05;
export const MAX_PX_PER_MM = 20;
/** Default margin of `fit`, CSS px. */
export const FIT_MARGIN_PX = 40;

/**
 * Bounding box of every piece in the document; fold pieces include their mirrored half.
 * @param {ProjectDoc|null} doc
 * @returns {{minX:number, minY:number, maxX:number, maxY:number}|null}
 */
export function docBbox(doc) {
  if (!doc || !Array.isArray(doc.pieces) || doc.pieces.length === 0) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  let any = false;
  for (const piece of doc.pieces) {
    if (!piece || !Array.isArray(piece.vertices) || piece.vertices.length < 2) continue;
    let pts;
    try {
      pts = flattenPiece(piece, 1).points;
    } catch (_e) {
      pts = piece.vertices;
    }
    const fold = (piece.foldEdge !== null && piece.foldEdge !== undefined && piece.vertices[piece.foldEdge])
      ? piece.vertices[piece.foldEdge][0] : null;
    for (const p of pts) {
      any = true;
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
      if (fold !== null) {
        const m = mirrorPoint(p, fold);
        if (m[0] < minX) minX = m[0];
        if (m[0] > maxX) maxX = m[0];
      }
    }
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {(() => void)|null} [onChange]   called after every state change (the editor emits view2d:changed there)
 * @param {(() => ProjectDoc)|null} [getDoc]   optional document accessor used by fitToPieces()
 * @returns {View}
 */
export function createView(canvas, onChange, getDoc) {
  const notify = typeof onChange === 'function' ? onChange : () => {};
  const doc = typeof getDoc === 'function' ? getDoc : () => null;

  const state = {
    cx: 0,
    cy: 0,
    pxPerMm: 1,
    width: (canvas && canvas.width) || 800,
    height: (canvas && canvas.height) || 600,
    dpr: 1,
  };
  let destroyed = false;
  /** @type {any} */
  let observer = null;

  /** @returns {number} */
  function currentDpr() {
    const d = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    return (Number.isFinite(d) && d > 0) ? d : 1;
  }

  /** Re-read the CSS size and devicePixelRatio; resize the backing store. */
  function resize() {
    if (destroyed || !canvas) return;
    const dpr = currentDpr();
    let w = canvas.clientWidth;
    let h = canvas.clientHeight;
    if (!(w > 0)) w = state.width;
    if (!(h > 0)) h = state.height;
    state.width = w;
    state.height = h;
    state.dpr = dpr;
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
  }

  /** @returns {{cx:number, cy:number, pxPerMm:number, width:number, height:number, dpr:number}} */
  function get() {
    return { cx: state.cx, cy: state.cy, pxPerMm: state.pxPerMm, width: state.width, height: state.height, dpr: state.dpr };
  }

  /** @param {{cx?:number, cy?:number, pxPerMm?:number}} v */
  function set(v) {
    if (!v) return;
    if (Number.isFinite(v.cx)) state.cx = /** @type {number} */ (v.cx);
    if (Number.isFinite(v.cy)) state.cy = /** @type {number} */ (v.cy);
    if (Number.isFinite(v.pxPerMm)) state.pxPerMm = clamp(/** @type {number} */ (v.pxPerMm), MIN_PX_PER_MM, MAX_PX_PER_MM);
    notify();
  }

  /** @param {number} x_mm @param {number} y_mm @returns {[number, number]} */
  function worldToScreen(x_mm, y_mm) {
    const s = state.pxPerMm;
    return [(x_mm - state.cx) * s + state.width / 2, state.height / 2 - (y_mm - state.cy) * s];
  }

  /** @param {number} px @param {number} py @returns {[number, number]} */
  function screenToWorld(px, py) {
    const s = state.pxPerMm;
    return [(px - state.width / 2) / s + state.cx, state.cy - (py - state.height / 2) / s];
  }

  /** @param {number} factor @param {number} [px] @param {number} [py] */
  function zoomBy(factor, px, py) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const ax = Number.isFinite(px) ? /** @type {number} */ (px) : state.width / 2;
    const ay = Number.isFinite(py) ? /** @type {number} */ (py) : state.height / 2;
    const w = screenToWorld(ax, ay);
    const s2 = clamp(state.pxPerMm * factor, MIN_PX_PER_MM, MAX_PX_PER_MM);
    state.pxPerMm = s2;
    state.cx = w[0] - (ax - state.width / 2) / s2;
    state.cy = w[1] + (ay - state.height / 2) / s2;
    notify();
  }

  /** @param {number} dx_px @param {number} dy_px */
  function panBy(dx_px, dy_px) {
    if (!Number.isFinite(dx_px) || !Number.isFinite(dy_px)) return;
    state.cx -= dx_px / state.pxPerMm;
    state.cy += dy_px / state.pxPerMm;
    notify();
  }

  /** @param {{minX:number, minY:number, maxX:number, maxY:number}} box @param {number} [margin_px] */
  function fit(box, margin_px) {
    if (!box || !Number.isFinite(box.minX)) return;
    const m = Number.isFinite(margin_px) ? /** @type {number} */ (margin_px) : FIT_MARGIN_PX;
    const bw = Math.max(1, box.maxX - box.minX);
    const bh = Math.max(1, box.maxY - box.minY);
    const availW = Math.max(1, state.width - 2 * m);
    const availH = Math.max(1, state.height - 2 * m);
    state.pxPerMm = clamp(Math.min(availW / bw, availH / bh), MIN_PX_PER_MM, MAX_PX_PER_MM);
    state.cx = (box.minX + box.maxX) / 2;
    state.cy = (box.minY + box.maxY) / 2;
    notify();
  }

  /** Frame every piece (fold pieces include the mirrored half); empty document → origin at 1 px/mm. */
  function fitToPieces() {
    const box = docBbox(doc());
    if (!box) {
      state.cx = 0;
      state.cy = 0;
      state.pxPerMm = 1;
      notify();
      return;
    }
    fit(box, FIT_MARGIN_PX);
  }

  function destroy() {
    destroyed = true;
    if (observer && typeof observer.disconnect === 'function') observer.disconnect();
    observer = null;
  }

  resize();
  if (canvas && canvas.parentElement && typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => {
      if (destroyed) return;
      resize();
      notify();
    });
    try {
      observer.observe(canvas.parentElement);
    } catch (_e) {
      observer = null;
    }
  }

  /**
   * @typedef {Object} View
   * @property {() => {cx:number, cy:number, pxPerMm:number, width:number, height:number, dpr:number}} get
   * @property {(v:{cx?:number, cy?:number, pxPerMm?:number}) => void} set
   * @property {(x_mm:number, y_mm:number) => [number, number]} worldToScreen
   * @property {(px:number, py:number) => [number, number]} screenToWorld
   * @property {(factor:number, px?:number, py?:number) => void} zoomBy
   * @property {(dx_px:number, dy_px:number) => void} panBy
   * @property {(box:{minX:number,minY:number,maxX:number,maxY:number}, margin_px?:number) => void} fit
   * @property {() => void} fitToPieces
   * @property {() => void} resize
   * @property {() => void} destroy
   */
  return { get, set, worldToScreen, screenToWorld, zoomBy, panBy, fit, fitToPieces, resize, destroy };
}
