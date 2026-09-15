// src/pattern/seams.js — seam helpers, ease and edge-index remapping (SPEC 11.11.1). Pure: no DOM, no store, no bus.

import { uid } from '../core/ids.js';
import { edgeLength, mirrorPoint } from '../geometry/index.js';

/** @typedef {import('../core/types.js').Vec2} Vec2 */
/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').Seam} Seam */
/** @typedef {import('../core/types.js').SeamSide} SeamSide */
/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */
/** @typedef {{lenA_mm:number, lenB_mm:number, easePct:number, longer:'a'|'b'|null}} Ease */

/** Ease thresholds, percent (SPEC 11.11.2 / 3.2.2). */
export const EASE_WARN_PCT = 8;
export const EASE_ERROR_PCT = 50;

/** @param {string} code @param {string} message @returns {Error & {code:string}} */
function seamError(code, message) {
  const err = /** @type {Error & {code:string}} */ (new Error(message));
  err.code = code;
  return err;
}

/** @type {WeakMap<object, Map<number, number>>} */
const LEN_CACHE = new WeakMap();

/**
 * mm length of outline edge e of piece (mirroring does not change a length). Cached per piece object identity.
 * @param {Piece} piece @param {number} e @returns {number}
 */
export function edgeLengthOf(piece, e) {
  if (!piece || !Array.isArray(piece.vertices)) return 0;
  const n = piece.vertices.length;
  if (!(e >= 0 && e < n)) return 0;
  let map = LEN_CACHE.get(piece);
  if (!map) {
    map = new Map();
    LEN_CACHE.set(piece, map);
  }
  const cached = map.get(e);
  if (cached !== undefined) return cached;
  const len = edgeLength(piece, e);
  map.set(e, len);
  return len;
}

/** @param {ProjectDoc} doc @param {string} pieceId @returns {Piece|null} */
export function pieceById(doc, pieceId) {
  if (!doc || !Array.isArray(doc.pieces)) return null;
  for (const p of doc.pieces) if (p && p.id === pieceId) return p;
  return null;
}

/**
 * Endpoints of a seam side in pattern mm, mirror applied; [start, end] in the side's traversal order.
 * @param {ProjectDoc} doc @param {SeamSide} side @returns {[Vec2, Vec2]}
 */
export function sideEndpoints(doc, side) {
  const piece = side ? pieceById(doc, side.pieceId) : null;
  if (!piece || !Array.isArray(piece.vertices) || piece.vertices.length < 2) return [[0, 0], [0, 0]];
  const n = piece.vertices.length;
  const e = side.edge;
  if (!(e >= 0 && e < n)) return [[0, 0], [0, 0]];
  let p0 = piece.vertices[e];
  let p1 = piece.vertices[(e + 1) % n];
  if (side.mirror === true && piece.foldEdge !== null && piece.foldEdge !== undefined && piece.vertices[piece.foldEdge]) {
    const foldX = piece.vertices[piece.foldEdge][0];
    p0 = mirrorPoint(p0, foldX);
    p1 = mirrorPoint(p1, foldX);
  }
  return [[p0[0], p0[1]], [p1[0], p1[1]]];
}

/** @param {Vec2} a @param {Vec2} b @returns {number} */
function dist(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * Nearest-endpoint heuristic: two CCW pieces traverse a shared seam in opposite directions.
 * @param {ProjectDoc} doc @param {SeamSide} a @param {SeamSide} b @returns {boolean}
 */
export function chooseReverse(doc, a, b) {
  const [a0, a1] = sideEndpoints(doc, a);
  const [b0, b1] = sideEndpoints(doc, b);
  const crossed = dist(a0, b1) + dist(a1, b0);
  const straight = dist(a0, b0) + dist(a1, b1);
  return crossed < straight;
}

/** Alias required by the A2 assignment brief; identical to `chooseReverse`. */
export const autoReverse = chooseReverse;

/**
 * @param {number} lenA @param {number} lenB @returns {Ease}
 */
function easeFrom(lenA, lenB) {
  const min = Math.min(lenA, lenB);
  const max = Math.max(lenA, lenB);
  const easePct = min > 0 ? ((max - min) / min) * 100 : 0;
  /** @type {'a'|'b'|null} */
  let longer = null;
  if (lenA > lenB) longer = 'a';
  else if (lenB > lenA) longer = 'b';
  return { lenA_mm: lenA, lenB_mm: lenB, easePct, longer };
}

/** @param {ProjectDoc} doc @param {SeamSide} side @returns {number} */
function sideLength(doc, side) {
  const piece = side ? pieceById(doc, side.pieceId) : null;
  if (!piece) return 0;
  return edgeLengthOf(piece, side.edge);
}

/** @param {ProjectDoc} doc @param {Seam} seam @returns {Ease} */
export function seamEase(doc, seam) {
  if (!seam) return easeFrom(0, 0);
  return easeFrom(sideLength(doc, seam.a), sideLength(doc, seam.b));
}

/** @param {ProjectDoc} doc @param {SeamSide} a @param {SeamSide} b @returns {Ease} */
export function seamEaseOf(doc, a, b) {
  return easeFrom(sideLength(doc, a), sideLength(doc, b));
}

/** Alias required by the A2 assignment brief. @param {ProjectDoc} doc @param {Seam} seam @returns {Ease} */
export function seamLengths(doc, seam) {
  return seamEase(doc, seam);
}

/** @param {number} pct @returns {'ok'|'warn'|'error'} */
export function easeLevel(pct) {
  if (pct > EASE_ERROR_PCT) return 'error';
  if (pct > EASE_WARN_PCT) return 'warn';
  return 'ok';
}

/**
 * 'A 312 mm / B 328 mm - ease 5.1%'
 * @param {{lenA_mm:number, lenB_mm:number, easePct:number}} ease @returns {string}
 */
export function formatEase(ease) {
  if (!ease) return '';
  return 'A ' + Math.round(ease.lenA_mm) + ' mm / B ' + Math.round(ease.lenB_mm) + ' mm - ease '
    + ease.easePct.toFixed(1) + '%';
}

/** @param {ProjectDoc} doc @param {SeamSide} side @returns {string} */
function sideLabel(doc, side) {
  const piece = pieceById(doc, side.pieceId);
  const name = piece ? piece.name : side.pieceId;
  return name + ' e' + side.edge + (side.mirror === true ? "'" : '');
}

/**
 * 'Front e1 ↔ Back e3 · 312 / 328 mm · ease 5.1%'
 * @param {ProjectDoc} doc @param {Seam} seam @returns {string}
 */
export function formatSeamRow(doc, seam) {
  const ease = seamEase(doc, seam);
  return sideLabel(doc, seam.a) + ' ↔ ' + sideLabel(doc, seam.b) + ' · '
    + Math.round(ease.lenA_mm) + ' / ' + Math.round(ease.lenB_mm) + ' mm · ease ' + ease.easePct.toFixed(1) + '%';
}

/**
 * @param {ProjectDoc} doc @param {string} pieceId @param {number} edge @param {boolean} [mirror]
 * @returns {Seam|null}
 */
export function seamOfEdge(doc, pieceId, edge, mirror = false) {
  if (!doc || !Array.isArray(doc.seams)) return null;
  for (const s of doc.seams) {
    if (!s) continue;
    for (const side of [s.a, s.b]) {
      if (side && side.pieceId === pieceId && side.edge === edge && (side.mirror === true) === (mirror === true)) return s;
    }
  }
  return null;
}

/** @param {ProjectDoc} doc @param {string} pieceId @returns {Seam[]} */
export function seamsOfPiece(doc, pieceId) {
  if (!doc || !Array.isArray(doc.seams)) return [];
  return doc.seams.filter((s) => s && ((s.a && s.a.pieceId === pieceId) || (s.b && s.b.pieceId === pieceId)));
}

/** @param {ProjectDoc} doc @param {SeamSide} side @param {string} which @returns {Piece} */
function requireSide(doc, side, which) {
  if (!side || typeof side.pieceId !== 'string') {
    throw seamError('SEAM_DANGLING', 'Seam side ' + which + ' has no piece');
  }
  const piece = pieceById(doc, side.pieceId);
  if (!piece) throw seamError('SEAM_DANGLING', 'Seam side ' + which + ': piece ' + side.pieceId + ' does not exist');
  const n = piece.vertices.length;
  if (!Number.isInteger(side.edge) || side.edge < 0 || side.edge >= n) {
    throw seamError('SEAM_DANGLING', 'Seam side ' + which + ': edge ' + side.edge + ' is outside 0..' + (n - 1));
  }
  return piece;
}

/**
 * Builds a Seam. Throws Error with code SEAM_SAME_EDGE | SEAM_DANGLING | SEAM_ON_FOLD_EDGE |
 * SEAM_MIRROR_WITHOUT_FOLD | SEAM_EDGE_TAKEN.
 * @param {ProjectDoc} doc @param {SeamSide} a @param {SeamSide} b @param {boolean} [reverse]
 * @returns {Seam}
 */
export function makeSeam(doc, a, b, reverse) {
  if (a && b && a.pieceId === b.pieceId && a.edge === b.edge && (a.mirror === true) === (b.mirror === true)) {
    throw seamError('SEAM_SAME_EDGE', 'A seam cannot join an edge to itself');
  }
  const pieceA = requireSide(doc, a, 'a');
  const pieceB = requireSide(doc, b, 'b');
  /** @type {Array<[SeamSide, Piece, string]>} */
  const sides = [[a, pieceA, 'a'], [b, pieceB, 'b']];
  for (const [side, piece, which] of sides) {
    if (piece.foldEdge !== null && piece.foldEdge !== undefined && side.edge === piece.foldEdge) {
      throw seamError('SEAM_ON_FOLD_EDGE', 'Seam side ' + which + ': the fold edge cannot be sewn');
    }
    if (side.mirror === true && (piece.foldEdge === null || piece.foldEdge === undefined)) {
      throw seamError('SEAM_MIRROR_WITHOUT_FOLD', 'Seam side ' + which + ': piece ' + piece.id + ' has no fold edge');
    }
    const taken = seamOfEdge(doc, side.pieceId, side.edge, side.mirror === true);
    if (taken) {
      throw seamError('SEAM_EDGE_TAKEN', 'Seam side ' + which + ': edge already used by seam ' + taken.id);
    }
  }
  const rev = (reverse === undefined || reverse === null) ? chooseReverse(doc, a, b) : !!reverse;
  return {
    id: uid('seam'),
    a: { pieceId: a.pieceId, edge: a.edge, mirror: a.mirror === true, reverse: false },
    b: { pieceId: b.pieceId, edge: b.edge, mirror: b.mirror === true, reverse: rev },
    kind: 'plain',
  };
}

/**
 * Rewrites every seam side, notch edge, pinnedEdges entry and foldEdge of `pieceId` through `map`
 * (oldEdge -> newEdge, -1 = removed). Seams whose side maps to -1 are deleted. MUTATES doc in place.
 * @param {ProjectDoc} doc @param {string} pieceId @param {number[]} map @returns {string[]} removed seam ids
 */
export function remapAfterEdgeChange(doc, pieceId, map) {
  /** @type {string[]} */
  const removed = [];
  if (!doc || !map) return removed;
  /** @param {number} e @returns {number} */
  const at = (e) => {
    const v = map[e];
    return (typeof v === 'number' && Number.isFinite(v)) ? v : -1;
  };

  if (Array.isArray(doc.seams)) {
    const keep = [];
    for (const s of doc.seams) {
      if (!s) continue;
      let drop = false;
      for (const side of [s.a, s.b]) {
        if (!side || side.pieceId !== pieceId) continue;
        const ne = at(side.edge);
        if (ne < 0) drop = true;
        else side.edge = ne;
      }
      if (drop) removed.push(s.id);
      else keep.push(s);
    }
    doc.seams = keep;
  }

  const piece = pieceById(doc, pieceId);
  if (piece) {
    if (Array.isArray(piece.notches)) {
      piece.notches = piece.notches.filter((nt) => {
        const ne = at(nt.edge);
        if (ne < 0) return false;
        nt.edge = ne;
        return true;
      });
    }
    if (Array.isArray(piece.pinnedEdges)) {
      const set = new Set();
      for (const e of piece.pinnedEdges) {
        const ne = at(e);
        if (ne >= 0) set.add(ne);
      }
      piece.pinnedEdges = Array.from(set).sort((x, y) => x - y);
    }
    if (piece.foldEdge !== null && piece.foldEdge !== undefined) {
      const nf = at(piece.foldEdge);
      piece.foldEdge = nf < 0 ? null : nf;
    }
  }
  return removed;
}

/**
 * Ease of a seam in a graded document (pieces replaced by graded copies).
 * @param {ProjectDoc} doc @param {Seam} seam @param {Piece[]} gradedPieces @returns {Ease}
 */
export function seamEaseGraded(doc, seam, gradedPieces) {
  const pieces = Array.isArray(gradedPieces) && gradedPieces.length ? gradedPieces : (doc ? doc.pieces : []);
  const shadow = /** @type {ProjectDoc} */ ({ ...(doc || {}), pieces });
  return seamEase(shadow, seam);
}
