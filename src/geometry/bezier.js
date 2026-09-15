// src/geometry/bezier.js — outline edges: cubic evaluation, arc length, sampling, splitting, flattening (SPEC 5.1).
// Pure; mm, y up. Segment form (p0, edge, p1, ...) and piece form (piece, edgeIndex, ...) share one implementation.

/** @typedef {import('../core/types.js').Vec2} Vec2 */
/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').Edge} Edge */

const TABLE_N = 64;

/** Module-level fallback cache (used when the edge object cannot carry the non-enumerable __lenTable). */
const tableCache = new Map();
const TABLE_CACHE_MAX = 2048;

/** @param {Vec2} p0 @param {Vec2} c1 @param {Vec2} c2 @param {Vec2} p1 @returns {string} */
function pointsKey(p0, c1, c2, p1) {
  return p0[0] + ',' + p0[1] + ',' + c1[0] + ',' + c1[1] + ',' + c2[0] + ',' + c2[1] + ',' + p1[0] + ',' + p1[1];
}

/** Point on a cubic at parameter u ∈ [0,1]. @param {Vec2} p0 @param {Vec2} c1 @param {Vec2} c2 @param {Vec2} p1 @param {number} u @returns {Vec2} */
export function cubicPoint(p0, c1, c2, p1, u) {
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const c = 3 * v * u * u;
  const d = u * u * u;
  return [
    a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0],
    a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1],
  ];
}

/** Unnormalised derivative dP/du at u. @param {Vec2} p0 @param {Vec2} c1 @param {Vec2} c2 @param {Vec2} p1 @param {number} u @returns {Vec2} */
export function cubicTangent(p0, c1, c2, p1, u) {
  const v = 1 - u;
  const a = 3 * v * v;
  const b = 6 * v * u;
  const c = 3 * u * u;
  return [
    a * (c1[0] - p0[0]) + b * (c2[0] - c1[0]) + c * (p1[0] - c2[0]),
    a * (c1[1] - p0[1]) + b * (c2[1] - c1[1]) + c * (p1[1] - c2[1]),
  ];
}

/** @param {Vec2} p0 @param {Vec2} c1 @param {Vec2} c2 @param {Vec2} p1 @returns {Float64Array} */
function computeLengthTable(p0, c1, c2, p1) {
  const table = new Float64Array(TABLE_N + 1);
  let px = p0[0];
  let py = p0[1];
  let acc = 0;
  for (let i = 1; i <= TABLE_N; i++) {
    const q = cubicPoint(p0, c1, c2, p1, i / TABLE_N);
    acc += Math.hypot(q[0] - px, q[1] - py);
    table[i] = acc;
    px = q[0];
    py = q[1];
  }
  return table;
}

/**
 * Arc-length table: 64 chords, cumulative lengths (65 entries, [0] = 0). Cached by the 4 points.
 * @param {Vec2} p0 @param {Vec2} c1 @param {Vec2} c2 @param {Vec2} p1 @returns {Float64Array}
 */
export function cubicLengthTable(p0, c1, c2, p1) {
  const key = pointsKey(p0, c1, c2, p1);
  const hit = tableCache.get(key);
  if (hit) return hit;
  const table = computeLengthTable(p0, c1, c2, p1);
  if (tableCache.size >= TABLE_CACHE_MAX) tableCache.clear();
  tableCache.set(key, table);
  return table;
}

/**
 * Length table of a cubic edge, cached on the edge object under the non-enumerable key __lenTable
 * (keyed by a hash of the 4 points so a moved control point invalidates it).
 * @param {Vec2} p0 @param {Edge} edge @param {Vec2} p1 @returns {Float64Array}
 */
function edgeLengthTable(p0, edge, p1) {
  const c1 = /** @type {Vec2} */ (edge.c1);
  const c2 = /** @type {Vec2} */ (edge.c2);
  const key = pointsKey(p0, c1, c2, p1);
  const cached = /** @type {any} */ (edge).__lenTable;
  if (cached && cached.key === key) return cached.table;
  const table = cubicLengthTable(p0, c1, c2, p1);
  try {
    Object.defineProperty(edge, '__lenTable', { value: { key, table }, enumerable: false, configurable: true, writable: true });
  } catch (e) {
    // frozen edge: the module-level cache still serves it
  }
  return table;
}

/** @param {Edge} edge @returns {boolean} */
function isCubic(edge) {
  return !!edge && edge.type === 'cubic' && Array.isArray(edge.c1) && Array.isArray(edge.c2);
}

/** Total length of a segment: |p1 - p0| for 'line', last entry of cubicLengthTable for 'cubic'. @param {Vec2} p0 @param {Edge} edge @param {Vec2} p1 @returns {number} mm */
export function segmentLength(p0, edge, p1) {
  if (!isCubic(edge)) return Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const table = edgeLengthTable(p0, edge, p1);
  return table[TABLE_N];
}

/** Piece form of segmentLength. @param {Piece} piece @param {number} edgeIndex @returns {number} mm */
export function edgeLength(piece, edgeIndex) {
  const n = piece.vertices.length;
  return segmentLength(piece.vertices[edgeIndex], piece.edges[edgeIndex], piece.vertices[(edgeIndex + 1) % n]);
}

/** @param {number} t @returns {number} */
function clamp01(t) {
  return t <= 0 ? 0 : (t >= 1 ? 1 : t);
}

/** Bezier parameter u at arc-length fraction t ∈ [0,1] (u === t for lines). @param {Vec2} p0 @param {Edge} edge @param {Vec2} p1 @param {number} t @returns {number} */
export function paramAtArcFraction(p0, edge, p1, t) {
  const tt = clamp01(t);
  if (!isCubic(edge)) return tt;
  const table = edgeLengthTable(p0, edge, p1);
  const L = table[TABLE_N];
  if (!(L > 0)) return tt;
  const s = tt * L;
  let lo = 0;
  let hi = TABLE_N;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid] <= s) lo = mid; else hi = mid;
  }
  const span = table[lo + 1] - table[lo];
  const frac = span > 0 ? (s - table[lo]) / span : 0;
  return (lo + frac) / TABLE_N;
}

/** Point at arc-length fraction t. @param {Vec2} p0 @param {Edge} edge @param {Vec2} p1 @param {number} t @returns {Vec2} */
export function pointAtArcFraction(p0, edge, p1, t) {
  const tt = clamp01(t);
  if (tt === 0) return [p0[0], p0[1]];
  if (tt === 1) return [p1[0], p1[1]];
  if (!isCubic(edge)) return [p0[0] + (p1[0] - p0[0]) * tt, p0[1] + (p1[1] - p0[1]) * tt];
  const u = paramAtArcFraction(p0, edge, p1, tt);
  return cubicPoint(p0, /** @type {Vec2} */ (edge.c1), /** @type {Vec2} */ (edge.c2), p1, u);
}

/** Unit tangent (direction of travel p0 → p1) at arc-length fraction t. @param {Vec2} p0 @param {Edge} edge @param {Vec2} p1 @param {number} t @returns {Vec2} */
export function tangentAtArcFraction(p0, edge, p1, t) {
  /** @type {Vec2} */
  let d;
  if (!isCubic(edge)) {
    d = [p1[0] - p0[0], p1[1] - p0[1]];
  } else {
    const c1 = /** @type {Vec2} */ (edge.c1);
    const c2 = /** @type {Vec2} */ (edge.c2);
    const u = paramAtArcFraction(p0, edge, p1, t);
    d = cubicTangent(p0, c1, c2, p1, u);
    let len = Math.hypot(d[0], d[1]);
    if (len < 1e-9) {
      // degenerate tangent (coincident control point): nudge the parameter
      const u2 = u < 0.5 ? u + 1e-3 : u - 1e-3;
      d = cubicTangent(p0, c1, c2, p1, u2);
      len = Math.hypot(d[0], d[1]);
      if (len < 1e-9) d = [p1[0] - p0[0], p1[1] - p0[1]];
    }
  }
  const len = Math.hypot(d[0], d[1]);
  if (len < 1e-12) return [1, 0];
  return [d[0] / len, d[1] / len];
}

/** n + 1 points at arc-length fractions 0, 1/n, ..., 1 (endpoints exact). n ≥ 1. @param {Vec2} p0 @param {Edge} edge @param {Vec2} p1 @param {number} n @returns {Vec2[]} */
export function sampleSegment(p0, edge, p1, n) {
  const m = Math.max(1, Math.floor(n));
  const fractions = new Array(m + 1);
  for (let i = 0; i <= m; i++) fractions[i] = i / m;
  return sampleSegmentAt(p0, edge, p1, fractions);
}

/** Piece form: sampleSegment(vertices[i], edges[i], vertices[(i+1)%n], n). @param {Piece} piece @param {number} edgeIndex @param {number} n @returns {Vec2[]} */
export function sampleEdge(piece, edgeIndex, n) {
  const m = piece.vertices.length;
  return sampleSegment(piece.vertices[edgeIndex], piece.edges[edgeIndex], piece.vertices[(edgeIndex + 1) % m], n);
}

/** Points at the given sorted arc-length fractions (each in [0,1]); 0 and 1 give exact endpoints. @param {Vec2} p0 @param {Edge} edge @param {Vec2} p1 @param {number[]} fractions @returns {Vec2[]} */
export function sampleSegmentAt(p0, edge, p1, fractions) {
  const out = new Array(fractions.length);
  for (let i = 0; i < fractions.length; i++) out[i] = pointAtArcFraction(p0, edge, p1, fractions[i]);
  return out;
}

/** @param {Vec2} a @param {Vec2} b @param {number} u @returns {Vec2} */
function lerp(a, b, u) {
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

/** de Casteljau split at parameter u. @param {Vec2} p0 @param {Vec2} c1 @param {Vec2} c2 @param {Vec2} p1 @param {number} u @returns {[[Vec2,Vec2,Vec2,Vec2],[Vec2,Vec2,Vec2,Vec2]]} */
export function splitCubic(p0, c1, c2, p1, u) {
  const q0 = lerp(p0, c1, u);
  const q1 = lerp(c1, c2, u);
  const q2 = lerp(c2, p1, u);
  const r0 = lerp(q0, q1, u);
  const r1 = lerp(q1, q2, u);
  const m = lerp(r0, r1, u);
  return [[[p0[0], p0[1]], q0, r0, m], [[m[0], m[1]], r1, q2, [p1[0], p1[1]]]];
}

/** @param {Edge} edge @returns {Edge} */
function cloneEdge(edge) {
  /** @type {Edge} */
  const out = { type: edge.type };
  if (edge.c1) out.c1 = [edge.c1[0], edge.c1[1]];
  if (edge.c2) out.c2 = [edge.c2[0], edge.c2[1]];
  if (edge.allowance_mm !== undefined) out.allowance_mm = edge.allowance_mm;
  if (edge.label !== undefined) out.label = edge.label;
  return out;
}

/**
 * Deep copy of a piece (plain data only).
 * @param {Piece} piece @returns {Piece}
 */
export function clonePiece(piece) {
  const out = /** @type {Piece} */ (JSON.parse(JSON.stringify(piece)));
  return out;
}

/**
 * Split outline edge `edgeIndex` at arc-length fraction t (0 < t < 1). NEW piece with one more vertex/edge; edgeMap old → new
 * index (edges ≥ edgeIndex + 1 shift by +1); notches re-parametrised. foldEdge, pinnedEdges and seams referencing later edges
 * are shifted by the CALLER using edgeMap (SPEC 5.1) — this function copies them unchanged.
 * @param {Piece} piece @param {number} edgeIndex @param {number} t
 * @returns {{piece: Piece, edgeMap: number[], newVertex: number}}
 */
export function splitEdge(piece, edgeIndex, t) {
  const n = piece.vertices.length;
  const e = edgeIndex;
  const tt = Math.min(1 - 1e-6, Math.max(1e-6, t));
  const p0 = piece.vertices[e];
  const p1 = piece.vertices[(e + 1) % n];
  const edge = piece.edges[e];
  const out = clonePiece(piece);
  /** @type {Vec2} */
  let mid;
  /** @type {Edge} */
  let first;
  /** @type {Edge} */
  let second;
  if (isCubic(edge)) {
    const u = paramAtArcFraction(p0, edge, p1, tt);
    const halves = splitCubic(p0, /** @type {Vec2} */ (edge.c1), /** @type {Vec2} */ (edge.c2), p1, u);
    mid = halves[0][3];
    first = cloneEdge(edge);
    first.c1 = halves[0][1];
    first.c2 = halves[0][2];
    second = cloneEdge(edge);
    second.c1 = halves[1][1];
    second.c2 = halves[1][2];
  } else {
    mid = lerp(p0, p1, tt);
    first = cloneEdge(edge);
    second = cloneEdge(edge);
  }
  out.vertices.splice(e + 1, 0, mid);
  out.edges.splice(e, 1, first, second);
  const edgeMap = new Array(n);
  for (let i = 0; i < n; i++) edgeMap[i] = i <= e ? i : i + 1;
  out.notches = (piece.notches || []).map((nt) => {
    const copy = { edge: nt.edge, t: nt.t, kind: nt.kind };
    if (nt.edge === e) {
      if (nt.t <= tt) {
        copy.t = tt > 0 ? nt.t / tt : 0;
      } else {
        copy.edge = e + 1;
        copy.t = (nt.t - tt) / (1 - tt);
      }
      copy.t = Math.min(1 - 1e-6, Math.max(1e-6, copy.t));
    } else if (nt.edge > e) {
      copy.edge = nt.edge + 1;
    }
    return copy;
  });
  return { piece: out, edgeMap, newVertex: e + 1 };
}

/** Polyline of an edge for drawing: 1 chord for 'line'; smallest n ≤ 64 with chord error ≤ tol_mm for 'cubic'. @param {Vec2} p0 @param {Edge} edge @param {Vec2} p1 @param {number} tol_mm @returns {Vec2[]} n+1 points */
export function flattenSegment(p0, edge, p1, tol_mm) {
  if (!isCubic(edge)) return [[p0[0], p0[1]], [p1[0], p1[1]]];
  const c1 = /** @type {Vec2} */ (edge.c1);
  const c2 = /** @type {Vec2} */ (edge.c2);
  const tol = (typeof tol_mm === 'number' && tol_mm > 0) ? tol_mm : 0.5;
  // chord error of n uniform pieces ≤ M / (8 n²) with M = max |P''| ≤ 6 · max(|p0 − 2c1 + c2|, |c1 − 2c2 + p1|)
  const dd1 = Math.hypot(p0[0] - 2 * c1[0] + c2[0], p0[1] - 2 * c1[1] + c2[1]);
  const dd2 = Math.hypot(c1[0] - 2 * c2[0] + p1[0], c1[1] - 2 * c2[1] + p1[1]);
  const M = 6 * Math.max(dd1, dd2);
  let n = Math.ceil(Math.sqrt(M / (8 * tol)));
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (n > TABLE_N) n = TABLE_N;
  const out = new Array(n + 1);
  out[0] = [p0[0], p0[1]];
  for (let i = 1; i < n; i++) out[i] = cubicPoint(p0, c1, c2, p1, i / n);
  out[n] = [p1[0], p1[1]];
  return out;
}

/**
 * Whole outline as a closed polyline (corners exactly once, CCW as stored); edgeStart[e] = index of the first point of edge e.
 * @param {{vertices: Vec2[], edges: Edge[]}} piece @param {number} [tol_mm=0.5] @returns {{points: Vec2[], edgeStart: number[]}}
 */
export function flattenPiece(piece, tol_mm = 0.5) {
  const n = piece.vertices.length;
  /** @type {Vec2[]} */
  const points = [];
  const edgeStart = new Array(n);
  for (let e = 0; e < n; e++) {
    const pts = flattenSegment(piece.vertices[e], piece.edges[e], piece.vertices[(e + 1) % n], tol_mm);
    edgeStart[e] = points.length;
    for (let i = 0; i < pts.length - 1; i++) points.push(pts[i]);
  }
  return { points, edgeStart };
}
