// src/sizing/grading.js — graded pieces (SPEC section 10.2). Pure: measurement-driven scaling about a pivot followed by
// per-vertex grade rules. Coordinates mm, y up. Graded pieces are ordinary Piece objects (deep copies).

import { edgeLength } from '../geometry/index.js';
import { rowByName, sizeIndex, baseIndex, validationError } from './chart.js';

/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').Seam} Seam */
/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */
/** @typedef {import('../core/types.js').SizeChart} SizeChart */
/** @typedef {import('../core/types.js').Issue} Issue */
/** @typedef {import('../core/types.js').Vec2} Vec2 */
/** @typedef {{piece: Piece, sx: number, sy: number, pivot: Vec2, step: number, issues: Issue[]}} GradeResult */

const EASE_DRIFT_PP = 3;

/**
 * Deep copy of plain data (pieces are JSON-shaped; cached non-enumerable helpers such as geometry's __lenTable are dropped).
 * @template T @param {T} v @returns {T}
 */
function deepClone(v) {
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}

/**
 * Shoelace signed area (mm², > 0 for CCW). Local copy of geometry's signedArea so the pivot/sanity maths of grading is
 * total and testable before geometry lands (same formula; SPEC 5.2).
 * @param {Vec2[]} pts @returns {number}
 */
function polyArea(pts) {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** @param {Vec2[]} pts @returns {{minX: number, minY: number, maxX: number, maxY: number}} */
function polyBbox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

/** @param {*} v @returns {boolean} */
function positiveFinite(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * Scale factor for one axis (steps 2–3): row[ref] / base[ref] when both are finite and > 0, else 1 (+ warn issue).
 * @param {Piece} piece @param {string|null} ref @param {import('../core/types.js').SizeRow} base
 * @param {import('../core/types.js').SizeRow} row @param {Issue[]} issues @returns {number}
 */
function axisScale(piece, ref, base, row, issues) {
  if (ref === null || ref === undefined) return 1;
  const b = base[ref];
  const r = row[ref];
  if (positiveFinite(b) && positiveFinite(r)) return /** @type {number} */ (r) / /** @type {number} */ (b);
  issues.push({ level: 'warn', code: 'GRADE_REF_MISSING', pieceId: piece.id, message: `widthRef ${ref} not in size chart` });
  return 1;
}

/**
 * @param {Piece} piece @param {SizeChart} chart @param {string} sizeName
 * @returns {{row: import('../core/types.js').SizeRow, base: import('../core/types.js').SizeRow, step: number}}
 */
function resolveRows(piece, chart, sizeName) {
  const row = rowByName(chart, sizeName);
  if (!row) throw validationError('SIZE_UNKNOWN', `Unknown size "${sizeName}"`);
  const base = rowByName(chart, chart.baseSize);
  if (!base) throw validationError('SIZE_BASE_MISSING', `Base size "${String(chart.baseSize)}" is not a row`);
  return { row, base, step: sizeIndex(chart, sizeName) - baseIndex(chart) };
}

/** Steps 2–3 only. @param {Piece} piece @param {SizeChart} chart @param {string} sizeName @returns {{sx: number, sy: number}} */
export function gradeScale(piece, chart, sizeName) {
  const { row, base } = resolveRows(piece, chart, sizeName);
  /** @type {Issue[]} */
  const issues = [];
  const grade = piece.grade || { widthRef: null, lengthRef: null };
  return {
    sx: axisScale(piece, grade.widthRef, base, row, issues),
    sy: axisScale(piece, grade.lengthRef, base, row, issues),
  };
}

/**
 * Full grading algorithm (SPEC 10.2 steps 1–8). Throws SIZE_UNKNOWN / SIZE_BASE_MISSING.
 * @param {Piece} piece @param {SizeChart} chart @param {string} sizeName @returns {GradeResult}
 */
export function gradePieceDetailed(piece, chart, sizeName) {
  const { row, base, step } = resolveRows(piece, chart, sizeName);
  /** @type {Issue[]} */
  const issues = [];
  const grade = piece.grade || { widthRef: null, lengthRef: null, anchorX: 'center', anchorY: 'center', vertexRules: [] };
  const sx = axisScale(piece, grade.widthRef, base, row, issues);
  const sy = axisScale(piece, grade.lengthRef, base, row, issues);

  // 4. pivot from the base vertices only
  const bb = polyBbox(piece.vertices);
  let px;
  switch (grade.anchorX) {
    case 'left': px = bb.minX; break;
    case 'right': px = bb.maxX; break;
    case 'fold':
      px = (piece.foldEdge !== null && piece.foldEdge !== undefined && piece.vertices[piece.foldEdge])
        ? piece.vertices[piece.foldEdge][0]
        : (bb.minX + bb.maxX) / 2;
      break;
    default: px = (bb.minX + bb.maxX) / 2;
  }
  let py;
  switch (grade.anchorY) {
    case 'top': py = bb.maxY; break;
    case 'bottom': py = bb.minY; break;
    default: py = (bb.minY + bb.maxY) / 2;
  }
  /** @type {Vec2} */
  const pivot = [px, py];

  const out = deepClone(piece);
  const n = out.vertices.length;
  const identity = sx === 1 && sy === 1;

  if (!identity) {
    /** @param {Vec2} p @returns {Vec2} */
    const T = (p) => [px + (p[0] - px) * sx, py + (p[1] - py) * sy];
    for (let i = 0; i < n; i++) out.vertices[i] = T(out.vertices[i]);
    for (const e of out.edges) {
      if (e.type === 'cubic') {
        if (e.c1) e.c1 = T(e.c1);
        if (e.c2) e.c2 = T(e.c2);
      }
    }
    if (out.grainline) {
      if (out.grainline.a) out.grainline.a = T(out.grainline.a);
      if (out.grainline.b) out.grainline.b = T(out.grainline.b);
    }
    if (Array.isArray(out.internalLines)) {
      for (const line of out.internalLines) {
        if (Array.isArray(line.points)) line.points = line.points.map(T);
      }
    }
  }

  // 6. vertex rules (after scaling, array order, accumulating). The loop runs at every size including
  // the base: at step 0 the per-step term is zero and every `ref` scale is 1, so the base outline is
  // untouched, and the index validation happens once rather than in two places.
  const rules = Array.isArray(grade.vertexRules) ? grade.vertexRules : [];
  for (const rule of rules) {
    const v = rule.vertex;
    if (!Number.isInteger(v) || v < 0 || v >= n) {
      issues.push({ level: 'warn', code: 'GRADE_RULE_INDEX', pieceId: piece.id, message: `Piece ${piece.name}: grade rule vertex ${String(v)} out of range` });
      continue;
    }
    let dx = step * (Number.isFinite(rule.dx_mm) ? rule.dx_mm : 0);
    let dy = step * (Number.isFinite(rule.dy_mm) ? rule.dy_mm : 0);

    // A vertex that tracks its own measurement REPLACES the piece's axis scale for that vertex: its
    // offset from the pivot is re-derived from the base outline, so the correction is exact rather
    // than an increment on top of a scale that already moved it.
    if (rule.ref) {
      const rs = axisScale(piece, rule.ref, base, row, issues);
      const axis = rule.refAxis === 'y' || rule.refAxis === 'both' ? rule.refAxis : 'x';
      const src = piece.vertices[v];
      if (axis === 'x' || axis === 'both') dx += (px + (src[0] - px) * rs) - out.vertices[v][0];
      if (axis === 'y' || axis === 'both') dy += (py + (src[1] - py) * rs) - out.vertices[v][1];
    }
    if (dx === 0 && dy === 0) continue;

    out.vertices[v] = [out.vertices[v][0] + dx, out.vertices[v][1] + dy];
    const leaving = out.edges[v];
    if (leaving && leaving.type === 'cubic' && leaving.c1) leaving.c1 = [leaving.c1[0] + dx, leaving.c1[1] + dy];
    const arriving = out.edges[(v - 1 + n) % n];
    if (arriving && arriving.type === 'cubic' && arriving.c2) arriving.c2 = [arriving.c2[0] + dx, arriving.c2[1] + dy];
  }

  // 7. sanity
  if (polyArea(out.vertices) <= 0) {
    issues.push({ level: 'error', code: 'GRADE_DEGENERATE', pieceId: piece.id, message: `Piece ${piece.name} size ${sizeName}: outline collapsed` });
  }

  return { piece: out, sx, sy, pivot, step, issues };
}

/** = gradePieceDetailed(...).piece. @param {Piece} piece @param {SizeChart} chart @param {string} sizeName @returns {Piece} */
export function gradePiece(piece, chart, sizeName) {
  return gradePieceDetailed(piece, chart, sizeName).piece;
}

/** Every doc.pieces entry, same order (exportHidden included). @param {ProjectDoc} doc @param {string} sizeName @returns {Piece[]} */
export function gradeDoc(doc, sizeName) {
  return doc.pieces.map((p) => gradePiece(p, doc.sizes, sizeName));
}

/** issues = per-piece issues + seamEaseDrift(doc, sizeName). @param {ProjectDoc} doc @param {string} sizeName @returns {{pieces: Piece[], issues: Issue[]}} */
export function gradeDocDetailed(doc, sizeName) {
  /** @type {Piece[]} */
  const pieces = [];
  /** @type {Issue[]} */
  const issues = [];
  for (const p of doc.pieces) {
    const r = gradePieceDetailed(p, doc.sizes, sizeName);
    pieces.push(r.piece);
    for (const i of r.issues) issues.push(i);
  }
  for (const i of seamEaseDrift(doc, sizeName)) issues.push(i);
  return { pieces, issues };
}

/**
 * Length of a seam side on the given pieces; null when the piece or edge is missing.
 * @param {Piece[]} pieces @param {import('../core/types.js').SeamSide} side @returns {number|null}
 */
function sideLength(pieces, side) {
  if (!side) return null;
  const piece = pieces.find((p) => p && p.id === side.pieceId);
  if (!piece) return null;
  if (!Number.isInteger(side.edge) || side.edge < 0 || side.edge >= piece.edges.length) return null;
  return edgeLength(piece, side.edge);
}

/**
 * Ease of a seam in percent: (longer / shorter - 1) * 100, using edgeLength on the given pieces (base or graded).
 * Throws GRADE_SEAM_REF when a side references a missing piece/edge.
 * @param {Piece[]} pieces @param {Seam} seam @returns {{lenA: number, lenB: number, easePct: number}}
 */
export function seamEasePct(pieces, seam) {
  const lenA = sideLength(pieces, seam.a);
  const lenB = sideLength(pieces, seam.b);
  if (lenA === null || lenB === null) {
    throw validationError('GRADE_SEAM_REF', `Seam ${seam.id}: side references a missing piece or edge`);
  }
  const longer = Math.max(lenA, lenB);
  const shorter = Math.min(lenA, lenB);
  const easePct = shorter > 0 ? (longer / shorter - 1) * 100 : (longer > 0 ? Infinity : 0);
  return { lenA, lenB, easePct };
}

/**
 * |drift| > 3 pp → warn GRADE_EASE_DRIFT; missing piece/edge → error GRADE_SEAM_REF. Never throws.
 * @param {ProjectDoc} doc @param {string} sizeName @returns {Issue[]}
 */
export function seamEaseDrift(doc, sizeName) {
  /** @type {Issue[]} */
  const issues = [];
  let basePieces;
  let graded;
  try {
    basePieces = gradeDoc(doc, doc.sizes.baseSize);
    graded = gradeDoc(doc, sizeName);
  } catch (e) {
    // SIZE_UNKNOWN / SIZE_BASE_MISSING: report instead of throwing
    issues.push({ level: 'error', code: (e && e.code) || 'GRADE_SEAM_REF', message: e && e.message ? e.message : String(e) });
    return issues;
  }
  const baseName = doc.sizes.baseSize;
  for (const seam of doc.seams || []) {
    try {
      const lenA0 = sideLength(basePieces, seam.a);
      const lenB0 = sideLength(basePieces, seam.b);
      if (lenA0 === null || lenB0 === null) {
        issues.push({ level: 'error', code: 'GRADE_SEAM_REF', seamId: seam.id, pieceId: seam.a ? seam.a.pieceId : undefined, message: `Seam ${seam.id}: side references a missing piece or edge` });
        continue;
      }
      const e0 = seamEasePct(basePieces, seam).easePct;
      const e1 = seamEasePct(graded, seam).easePct;
      const drift = e1 - e0;
      if (Math.abs(drift) > EASE_DRIFT_PP) {
        issues.push({
          level: 'warn', code: 'GRADE_EASE_DRIFT', seamId: seam.id, pieceId: seam.a.pieceId,
          message: `Seam ${seam.id}: ease ${e0.toFixed(1)}% (${baseName}) -> ${e1.toFixed(1)}% (${sizeName})`,
        });
      }
    } catch (e) {
      if (e && e.code === 'NotImplemented') throw e; // Phase-1 geometry stub: let self-tests skip
      issues.push({ level: 'error', code: 'GRADE_SEAM_REF', seamId: seam.id, pieceId: seam.a ? seam.a.pieceId : undefined, message: `Seam ${seam.id}: ${e && e.message ? e.message : String(e)}` });
    }
  }
  return issues;
}
