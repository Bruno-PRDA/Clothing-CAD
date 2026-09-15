// src/pattern/hit.js — hit testing in screen px (SPEC 11.9.3). Pure apart from the WeakMap flatten cache.

import { flattenPiece, pointAtArcFraction, distToPolyline, pointInPolygon, mirrorPoint } from '../geometry/index.js';

/** @typedef {import('../core/types.js').Vec2} Vec2 */
/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */
/** @typedef {import('./view.js').View} View */

/** Pixel tolerances of the hit test (CSS px). */
export const HIT_TOL_PX = Object.freeze({ vertex: 8, handle: 8, notch: 8, grainline: 8, edge: 6 });

/** Flatten tolerance used for hit testing and validation, mm. */
export const FLATTEN_TOL_MM = 0.25;

/**
 * @typedef {Object} Hit
 * @property {'vertex'|'handle'|'notch'|'grainline'|'edge'|'piece'} kind
 * @property {string} pieceId
 * @property {number} index
 * @property {'c1'|'c2'|'a'|'b'} [which]
 * @property {number} [t]
 * @property {boolean} mirror
 * @property {number} dist_px
 */

/** @type {WeakMap<object, {points:Vec2[], edgeStart:number[], mirrored:{points:Vec2[], edgeStart:number[]}|null}>} */
const FLAT_CACHE = new WeakMap();

/**
 * `flattenPiece(piece, 0.25)` cached per piece object identity, plus the mirrored ghost of fold pieces.
 * @param {Piece} piece
 * @returns {{points:Vec2[], edgeStart:number[], mirrored:{points:Vec2[], edgeStart:number[]}|null}}
 */
export function flattenCache(piece) {
  let entry = FLAT_CACHE.get(piece);
  if (entry) return entry;
  const flat = flattenPiece(piece, FLATTEN_TOL_MM);
  /** @type {{points:Vec2[], edgeStart:number[]}|null} */
  let mirrored = null;
  const fe = piece.foldEdge;
  if (fe !== null && fe !== undefined && piece.vertices[fe]) {
    const foldX = piece.vertices[fe][0];
    mirrored = {
      points: flat.points.map((p) => mirrorPoint(p, foldX)),
      edgeStart: flat.edgeStart,
    };
  }
  entry = { points: flat.points, edgeStart: flat.edgeStart, mirrored };
  FLAT_CACHE.set(piece, entry);
  return entry;
}

/** @param {Piece} piece @returns {number|null} */
export function foldXOf(piece) {
  const fe = piece.foldEdge;
  if (fe === null || fe === undefined) return null;
  const v = piece.vertices[fe];
  return v ? v[0] : null;
}

/** @param {Piece} piece @param {number} e @returns {Vec2} world position of the edge's start vertex */
function edgeP0(piece, e) {
  return piece.vertices[e];
}

/** @param {Piece} piece @param {number} e @returns {Vec2} */
function edgeP1(piece, e) {
  return piece.vertices[(e + 1) % piece.vertices.length];
}

/**
 * Position of notch k of a piece, pattern mm.
 * @param {Piece} piece @param {number} k @returns {Vec2|null}
 */
export function notchPoint(piece, k) {
  const nt = piece.notches && piece.notches[k];
  if (!nt) return null;
  const n = piece.vertices.length;
  if (!(nt.edge >= 0 && nt.edge < n)) return null;
  return pointAtArcFraction(edgeP0(piece, nt.edge), piece.edges[nt.edge], edgeP1(piece, nt.edge), nt.t);
}

/**
 * Arc-length fraction of point `seg`/`t` of a flattened outline within its outline edge.
 * @param {Vec2[]} points @param {number[]} edgeStart @param {number} seg @param {number} t
 * @returns {{edge:number, t:number}}
 */
export function edgeOfSegment(points, edgeStart, seg, t) {
  const n = points.length;
  const ne = edgeStart.length;
  let edge = ne - 1;
  for (let e = 0; e < ne; e++) {
    const start = edgeStart[e];
    const end = (e + 1 < ne) ? edgeStart[e + 1] : n;
    if (seg >= start && seg < end) {
      edge = e;
      break;
    }
  }
  const start = edgeStart[edge];
  const end = (edge + 1 < ne) ? edgeStart[edge + 1] : n;
  let before = 0;
  let total = 0;
  for (let k = start; k < end; k++) {
    const a = points[k];
    const b = points[(k + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (k < seg) before += len;
    else if (k === seg) before += len * t;
    total += len;
  }
  const frac = total > 0 ? before / total : 0;
  return { edge, t: Math.min(1, Math.max(0, frac)) };
}

/** @param {View} view @param {Vec2[]} pts @returns {Vec2[]} */
function toScreen(view, pts) {
  const out = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const s = view.worldToScreen(pts[i][0], pts[i][1]);
    out[i] = [s[0], s[1]];
  }
  return out;
}

/** @param {Vec2[]} pts @returns {{minX:number, minY:number, maxX:number, maxY:number}} */
function bboxOfScreen(pts) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

/**
 * @param {ProjectDoc} doc @param {View} view @param {number} px @param {number} py
 * @param {{selection?:object, tool?:string, handlesVisible?:boolean}} [opts]
 * @returns {Hit|null}
 */
export function hitTest(doc, view, px, py, opts) {
  if (!doc || !Array.isArray(doc.pieces) || doc.pieces.length === 0) return null;
  const o = opts || {};
  const sel = o.selection || { pieces: [], seams: [], vertex: null, edge: null };
  const tool = o.tool || 'select';
  const selPieces = Array.isArray(sel.pieces) ? sel.pieces : [];
  const primary = selPieces.length ? selPieces[selPieces.length - 1] : null;
  const pieces = doc.pieces;
  const last = pieces.length - 1;

  const allVerticesVisible = (tool === 'edit' || tool === 'draw');
  const handlesVisible = (o.handlesVisible !== undefined)
    ? !!o.handlesVisible
    : (tool === 'edit' || (sel.vertex !== null && sel.vertex !== undefined));

  // ---- 1. vertices ---------------------------------------------------------------------------------
  /** @type {Hit|null} */
  let best = null;
  for (let i = last; i >= 0; i--) {
    const piece = pieces[i];
    if (!piece || !Array.isArray(piece.vertices)) continue;
    if (!allVerticesVisible && selPieces.indexOf(piece.id) < 0) continue;
    for (let v = 0; v < piece.vertices.length; v++) {
      const s = view.worldToScreen(piece.vertices[v][0], piece.vertices[v][1]);
      const d = Math.hypot(s[0] - px, s[1] - py);
      if (d <= HIT_TOL_PX.vertex && (!best || d < best.dist_px)) {
        best = { kind: 'vertex', pieceId: piece.id, index: v, mirror: false, dist_px: d };
      }
    }
  }
  if (best) return best;

  // ---- 2. bezier handles ---------------------------------------------------------------------------
  if (handlesVisible && primary) {
    const piece = pieces.find((p) => p && p.id === primary);
    if (piece && Array.isArray(piece.edges)) {
      /** @type {number[]} */
      const edgeIdx = [];
      if (tool === 'edit') {
        for (let e = 0; e < piece.edges.length; e++) edgeIdx.push(e);
      } else if (sel.vertex && sel.vertex.pieceId === piece.id) {
        const n = piece.edges.length;
        const i = sel.vertex.index;
        edgeIdx.push(((i % n) + n) % n, ((i - 1) % n + n) % n);
      }
      for (const e of edgeIdx) {
        const edge = piece.edges[e];
        if (!edge || edge.type !== 'cubic') continue;
        for (const which of ['c1', 'c2']) {
          const c = edge[which];
          if (!c) continue;
          const s = view.worldToScreen(c[0], c[1]);
          const d = Math.hypot(s[0] - px, s[1] - py);
          if (d <= HIT_TOL_PX.handle && (!best || d < best.dist_px)) {
            best = { kind: 'handle', pieceId: piece.id, index: e, which: /** @type {'c1'|'c2'} */ (which), mirror: false, dist_px: d };
          }
        }
      }
    }
  }
  if (best) return best;

  // ---- 3. notches ----------------------------------------------------------------------------------
  for (let i = last; i >= 0; i--) {
    const piece = pieces[i];
    if (!piece || !Array.isArray(piece.notches)) continue;
    for (let k = 0; k < piece.notches.length; k++) {
      const p = notchPoint(piece, k);
      if (!p) continue;
      const s = view.worldToScreen(p[0], p[1]);
      const d = Math.hypot(s[0] - px, s[1] - py);
      if (d <= HIT_TOL_PX.notch && (!best || d < best.dist_px)) {
        best = { kind: 'notch', pieceId: piece.id, index: k, mirror: false, dist_px: d };
      }
    }
  }
  if (best) return best;

  // ---- 4. grainline endpoints ----------------------------------------------------------------------
  if (tool === 'grainline' && primary) {
    const piece = pieces.find((p) => p && p.id === primary);
    if (piece && piece.grainline) {
      for (const which of ['a', 'b']) {
        const p = piece.grainline[which];
        if (!p) continue;
        const s = view.worldToScreen(p[0], p[1]);
        const d = Math.hypot(s[0] - px, s[1] - py);
        if (d <= HIT_TOL_PX.grainline && (!best || d < best.dist_px)) {
          best = { kind: 'grainline', pieceId: piece.id, index: which === 'a' ? 0 : 1, which: /** @type {'a'|'b'} */ (which), mirror: false, dist_px: d };
        }
      }
    }
  }
  if (best) return best;

  // ---- 5. edges ------------------------------------------------------------------------------------
  for (let i = last; i >= 0; i--) {
    const piece = pieces[i];
    if (!piece || !Array.isArray(piece.vertices) || piece.vertices.length < 2) continue;
    const flat = flattenCache(piece);
    /** @type {Array<{pts:Vec2[], mirror:boolean}>} */
    const loops = [{ pts: flat.points, mirror: false }];
    if (flat.mirrored) loops.push({ pts: flat.mirrored.points, mirror: true });
    for (const loop of loops) {
      const scr = toScreen(view, loop.pts);
      const box = bboxOfScreen(scr);
      if (px < box.minX - HIT_TOL_PX.edge || px > box.maxX + HIT_TOL_PX.edge
        || py < box.minY - HIT_TOL_PX.edge || py > box.maxY + HIT_TOL_PX.edge) continue;
      const r = distToPolyline([px, py], scr, true);
      if (r.dist <= HIT_TOL_PX.edge && (!best || r.dist < best.dist_px)) {
        const at = edgeOfSegment(loop.pts, flat.edgeStart, r.seg, r.t);
        best = { kind: 'edge', pieceId: piece.id, index: at.edge, t: at.t, mirror: loop.mirror, dist_px: r.dist };
      }
    }
  }
  if (best) return best;

  // ---- 6. piece interior ---------------------------------------------------------------------------
  const world = view.screenToWorld(px, py);
  for (let i = last; i >= 0; i--) {
    const piece = pieces[i];
    if (!piece || !Array.isArray(piece.vertices) || piece.vertices.length < 3) continue;
    const flat = flattenCache(piece);
    if (pointInPolygon([world[0], world[1]], flat.points)) {
      return { kind: 'piece', pieceId: piece.id, index: -1, mirror: false, dist_px: 0 };
    }
    if (flat.mirrored && pointInPolygon([world[0], world[1]], flat.mirrored.points)) {
      return { kind: 'piece', pieceId: piece.id, index: -1, mirror: true, dist_px: 0 };
    }
  }
  return null;
}
