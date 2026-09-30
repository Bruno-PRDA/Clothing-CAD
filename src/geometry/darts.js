// src/geometry/darts.js — darts that open onto an outline edge (SPEC 5.10, amendment "Darts"). Pure; mm.
//
// A dart is stored against the CLEAN outline as {id, edge, t, width_mm, apex}. Its mouth is the stretch of that edge
// between arc lengths c − w/2 (point A) and c + w/2 (point B), c = t·L, and its legs are A→apex and B→apex. The
// fabric inside is folded away, not cut, so everything that compares seam lengths uses the SEWN length of an edge: its
// arc length with the mouths taken out. `edgeToSewn` / `sewnToEdge` convert between the arc-length fraction t and the
// sewn fraction u; a whole mouth is ONE u, carried by two points.
//
// Only valid darts count (`validDartIndices`): a dart `checkDarts` rejects is ignored by the mesher, the seam sampling
// and the exports, and reported by the validators, so one bad dart never stops a drape.

import { edgeLength, pointAtArcFraction, paramAtArcFraction, splitCubic, flattenPiece } from './bezier.js';
import { isSimplePolygon, pointInPolygon, distToPolyline } from './polygon.js';

/** @typedef {import('../core/types.js').Vec2} Vec2 */
/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').Dart} Dart */
/** @typedef {import('../core/types.js').Edge} Edge */
/** @typedef {import('../core/types.js').Issue} Issue */
/**
 * @typedef {Object} Mouth
 * @property {number} k      index into piece.darts
 * @property {Dart} dart
 * @property {number} s0     arc length of A along the edge, mm
 * @property {number} s1     arc length of B, mm
 * @property {number} ta     s0 / L
 * @property {number} tb     s1 / L
 * @property {Vec2} a
 * @property {Vec2} b
 * @property {Vec2} apex
 */

/** A mouth keeps at least this far (mm) from the corners of its edge. */
export const DART_CORNER_MM = 2;
/** Two mouths on one edge keep at least this far (mm) apart. */
export const DART_GAP_MM = 2;
/** The apex keeps at least this far (mm) inside the outline. */
export const DART_APEX_CLEAR_MM = 1;
/** Narrowest dart, mm. */
export const DART_MIN_WIDTH_MM = 1;
/** The drill hole sits this far (mm) back from the point, along the centre line (at most half way to the mouth). */
export const DART_DRILL_BACK_MM = 10;
/** Flattening tolerance of the crossing test, mm. */
const FLAT_TOL_MM = 0.5;

/** @param {Piece} piece @returns {Dart[]} */
function dartsOf(piece) {
  return piece && Array.isArray(piece.darts) ? piece.darts : [];
}

/** @param {Piece} piece @param {number} e @returns {[Vec2, Edge, Vec2]} */
function segOf(piece, e) {
  const n = piece.vertices.length;
  return [piece.vertices[e], piece.edges[e], piece.vertices[(e + 1) % n]];
}

/**
 * Mouth of one dart, valid or not (the editor previews invalid darts too).
 * @param {Piece} piece @param {Dart} dart @returns {{a: Vec2, b: Vec2, ta: number, tb: number, L: number}}
 */
export function dartMouth(piece, dart) {
  const [p0, edge, p1] = segOf(piece, dart.edge);
  const L = edgeLength(piece, dart.edge);
  const c = dart.t * L;
  const ta = L > 0 ? (c - dart.width_mm / 2) / L : 0;
  const tb = L > 0 ? (c + dart.width_mm / 2) / L : 0;
  return { a: pointAtArcFraction(p0, edge, p1, ta), b: pointAtArcFraction(p0, edge, p1, tb), ta, tb, L };
}

/**
 * The drill hole: on the dart's centre line, DART_DRILL_BACK_MM back from the point, at most half way to the mouth.
 * @param {Vec2} a @param {Vec2} b @param {Vec2} apex @returns {Vec2}
 */
export function dartDrillPoint(a, b, apex) {
  const mx = (a[0] + b[0]) / 2 - apex[0];
  const my = (a[1] + b[1]) / 2 - apex[1];
  const len = Math.hypot(mx, my) || 1;
  const back = Math.min(DART_DRILL_BACK_MM, len / 2);
  return [apex[0] + mx * back / len, apex[1] + my * back / len];
}

/** Part [t0, t1] (arc-length fractions) of an edge, as an edge starting at its t0 point. @param {Vec2} p0 @param {Edge} edge @param {Vec2} p1 @param {number} t0 @param {number} t1 @returns {Edge} */
function subEdge(p0, edge, p1, t0, t1) {
  /** @type {Edge} */
  const out = { type: edge.type === 'cubic' ? 'cubic' : 'line' };
  if (edge.label !== undefined) out.label = edge.label;
  if (edge.allowance_mm !== undefined) out.allowance_mm = edge.allowance_mm;
  if (out.type === 'cubic' && edge.c1 && edge.c2) {
    const u0 = paramAtArcFraction(p0, edge, p1, t0);
    const u1 = paramAtArcFraction(p0, edge, p1, t1);
    const left = splitCubic(p0, edge.c1, edge.c2, p1, u1)[0];
    const part = u0 > 0 ? splitCubic(left[0], left[1], left[2], left[3], u0 / u1)[1] : left;
    out.c1 = part[1];
    out.c2 = part[2];
  }
  return out;
}

/** A fresh copy of a point (left alone when it is not an array). @param {Vec2} v @returns {Vec2} */
function copyVec(v) {
  return Array.isArray(v) ? [v[0], v[1]] : v;
}

/**
 * The outline with darts cut in: every mouth becomes A → apex → B. `ks` picks the darts (default: the valid ones); the
 * caller vouches for them. `map[j]` says what derived edge j is: part of original edge `edge` from arc-length fraction
 * `t0` to `t1`, or leg 'a' / 'b' of dart `dart`. The derived piece is OUTLINE-ONLY: its edges no longer line up with the
 * input's, so `foldEdge` is remapped (the fold edge carries no darts) and every other index-bearing field is emptied
 * (`darts`, `notches`, `pinnedEdges`, `internalLines`, `grade.vertexRules`); callers map edges through `map`. It shares
 * no array or object with `piece`.
 * @param {Piece} piece @param {number[]} [ks]
 * @returns {{piece: Piece, map: Array<{edge:number, t0:number, t1:number}|{dart:number, leg:'a'|'b'}>}}
 */
export function applyDarts(piece, ks) {
  const darts = dartsOf(piece);
  const use = Array.isArray(ks) ? ks : validDartIndices(piece);
  const n = piece.vertices.length;
  /** @type {Vec2[]} */
  const vertices = [];
  /** @type {Edge[]} */
  const edges = [];
  /** @type {Array<{edge:number, t0:number, t1:number}|{dart:number, leg:'a'|'b'}>} */
  const map = [];
  /** @type {number|null} */
  let foldEdge = null;
  for (let e = 0; e < n; e++) {
    const [p0, edge, p1] = segOf(piece, e);
    const here = use.filter((k) => darts[k] && darts[k].edge === e)
      .map((k) => ({ k, m: dartMouth(piece, darts[k]) }))
      .sort((x, y) => x.m.ta - y.m.ta);
    if (e === piece.foldEdge) foldEdge = edges.length;
    let t0 = 0;
    vertices.push([p0[0], p0[1]]);
    for (const { k, m } of here) {
      edges.push(subEdge(p0, edge, p1, t0, m.ta));
      map.push({ edge: e, t0, t1: m.ta });
      vertices.push([m.a[0], m.a[1]]);
      edges.push({ type: 'line', label: 'dart' });
      map.push({ dart: k, leg: 'a' });
      vertices.push([darts[k].apex[0], darts[k].apex[1]]);
      edges.push({ type: 'line', label: 'dart' });
      map.push({ dart: k, leg: 'b' });
      vertices.push([m.b[0], m.b[1]]);
      t0 = m.tb;
    }
    edges.push(subEdge(p0, edge, p1, t0, 1));
    map.push({ edge: e, t0, t1: 1 });
  }
  const out = /** @type {Piece} */ ({ ...piece, vertices, edges, foldEdge, darts: [], notches: [], pinnedEdges: [], internalLines: [] });
  if (piece.grainline) out.grainline = { a: copyVec(piece.grainline.a), b: copyVec(piece.grainline.b) };
  if (piece.placement) out.placement = { ...piece.placement, offset_mm: copyVec(piece.placement.offset_mm) };
  if (piece.grade) out.grade = { ...piece.grade, vertexRules: [] };
  return { piece: out, map };
}

/** @type {WeakMap<object, {sig: string, res: {issues: Issue[], bad: Set<number>}}>} */
const CHECK_CACHE = new WeakMap();

/** Everything the checks read. @param {Piece} piece @returns {string} */
function signature(piece) {
  return JSON.stringify([piece.vertices, piece.edges, piece.foldEdge, piece.darts, piece.notches]);
}

/**
 * Every dart problem of a piece (spec §3.3 codes) and the indices of the darts that must be ignored. Cached per piece
 * object and content, so the mesher's seam sampling and every validator can call it freely.
 * @param {Piece} piece @returns {{issues: Issue[], bad: Set<number>}}
 */
export function checkDarts(piece) {
  const darts = dartsOf(piece);
  if (darts.length === 0) return { issues: [], bad: new Set() };
  const sig = signature(piece);
  const hit = CHECK_CACHE.get(piece);
  if (hit && hit.sig === sig) return hit.res;
  /** @type {Issue[]} */
  const issues = [];
  /** @type {Set<number>} */
  const bad = new Set();
  const name = piece.name || piece.id;
  const n = piece.vertices.length;
  /** @param {string} code @param {number} k @param {string} what */
  const fail = (code, k, what) => {
    const dt = darts[k];
    issues.push({ level: 'error', code, pieceId: piece.id, edge: dt && Number.isInteger(dt.edge) ? dt.edge : undefined, message: `${name}: dart ${k + 1} ${what}` });
    bad.add(k);
  };
  const outline = flattenPiece(piece, FLAT_TOL_MM).points;
  const ids = new Set();
  /** @type {(Mouth|null)[]} */
  const mouths = darts.map(() => null);
  for (let k = 0; k < darts.length; k++) {
    const dt = darts[k];
    if (!dt || typeof dt.id !== 'string' || dt.id === '' || ids.has(dt.id)) fail('DART_ID', k, 'has an empty or repeated id');
    if (dt) ids.add(dt.id);
    if (!dt || !Number.isInteger(dt.edge) || dt.edge < 0 || dt.edge >= n || dt.edge === piece.foldEdge) {
      fail('DART_EDGE', k, 'is not on a sewable outline edge');
      continue;
    }
    if (!(Number.isFinite(dt.width_mm) && dt.width_mm >= DART_MIN_WIDTH_MM)) {
      fail('DART_WIDTH', k, `is narrower than ${DART_MIN_WIDTH_MM} mm`);
      continue;
    }
    const L = edgeLength(piece, dt.edge);
    const c = dt.t * L;
    if (!(dt.t > 0 && dt.t < 1) || c - dt.width_mm / 2 < DART_CORNER_MM || c + dt.width_mm / 2 > L - DART_CORNER_MM) {
      fail('DART_MOUTH', k, `does not fit on its edge (keep ${DART_CORNER_MM} mm from the corners)`);
      continue;
    }
    if (!Array.isArray(dt.apex) || !Number.isFinite(dt.apex[0]) || !Number.isFinite(dt.apex[1])
      || !pointInPolygon(dt.apex, outline) || distToPolyline(dt.apex, outline, true).dist < DART_APEX_CLEAR_MM) {
      fail('DART_APEX', k, 'has its point outside the piece or on its edge');
      continue;
    }
    if (bad.has(k)) continue;
    const m = dartMouth(piece, dt);
    mouths[k] = { k, dart: dt, s0: c - dt.width_mm / 2, s1: c + dt.width_mm / 2, ta: m.ta, tb: m.tb, a: m.a, b: m.b, apex: dt.apex };
  }
  for (let i = 0; i < darts.length; i++) {
    const mi = mouths[i];
    if (!mi) continue;
    for (let j = i + 1; j < darts.length; j++) {
      const mj = mouths[j];
      if (!mj || mj.dart.edge !== mi.dart.edge) continue;
      if (mi.s0 < mj.s1 + DART_GAP_MM && mj.s0 < mi.s1 + DART_GAP_MM) {
        fail('DART_OVERLAP', j, `overlaps dart ${i + 1} on the same edge`);
        mouths[j] = null;
      }
    }
  }
  /** @param {number[]} ks */
  const simpleWith = (ks) => isSimplePolygon(flattenPiece(applyDarts(piece, ks).piece, FLAT_TOL_MM).points);
  for (let k = 0; k < darts.length; k++) {
    if (mouths[k] && !simpleWith([k])) { fail('DART_CROSSES', k, 'crosses the outline'); mouths[k] = null; }
  }
  for (let i = 0; i < darts.length; i++) {
    for (let j = i + 1; j < darts.length; j++) {
      if (mouths[i] && mouths[j] && !simpleWith([i, j])) { fail('DART_CROSSES', j, `crosses dart ${i + 1}`); mouths[j] = null; }
    }
  }
  for (const nt of (piece.notches || [])) {
    for (const m of mouths) {
      if (m && nt.edge === m.dart.edge && nt.t > m.ta && nt.t < m.tb) {
        issues.push({ level: 'warn', code: 'DART_NOTCH', pieceId: piece.id, edge: nt.edge, message: `${name}: a notch lies inside dart ${m.k + 1} and is ignored` });
      }
    }
  }
  const res = { issues, bad };
  CHECK_CACHE.set(piece, { sig, res });
  return res;
}

/** Indices of the darts everything uses: the ones checkDarts accepts. @param {Piece} piece @returns {number[]} */
export function validDartIndices(piece) {
  const darts = dartsOf(piece);
  if (darts.length === 0) return [];
  const { bad } = checkDarts(piece);
  /** @type {number[]} */
  const out = [];
  for (let k = 0; k < darts.length; k++) if (!bad.has(k)) out.push(k);
  return out;
}

/** The valid darts of edge e with their mouths, sorted along the edge. @param {Piece} piece @param {number} e @returns {Mouth[]} */
export function mouthsOn(piece, e) {
  const darts = dartsOf(piece);
  if (darts.length === 0) return [];
  /** @type {Mouth[]} */
  const out = [];
  for (const k of validDartIndices(piece)) {
    const dt = darts[k];
    if (dt.edge !== e) continue;
    const m = dartMouth(piece, dt);
    out.push({ k, dart: dt, s0: m.ta * m.L, s1: m.tb * m.L, ta: m.ta, tb: m.tb, a: m.a, b: m.b, apex: [dt.apex[0], dt.apex[1]] });
  }
  out.sort((p, q) => p.s0 - q.s0);
  return out;
}

/** Arc length of edge e less the intake of its valid darts, mm. @param {Piece} piece @param {number} e @returns {number} */
export function sewnLength(piece, e) {
  let L = edgeLength(piece, e);
  for (const m of mouthsOn(piece, e)) L -= m.s1 - m.s0;
  return L;
}

/**
 * Sewn fraction u of the edge point at arc-length fraction t. A point inside a mouth maps to the mouth's u.
 * @param {Piece} piece @param {number} e @param {number} t @returns {number}
 */
export function edgeToSewn(piece, e, t) {
  const mouths = mouthsOn(piece, e);
  if (mouths.length === 0) return t;
  const L = edgeLength(piece, e);
  let Ls = L;
  for (const m of mouths) Ls -= m.s1 - m.s0;
  const s = t * L;
  let removed = 0;
  for (const m of mouths) {
    if (s <= m.s0) break;
    if (s < m.s1) return Ls > 0 ? (m.s0 - removed) / Ls : 0;
    removed += m.s1 - m.s0;
  }
  return Ls > 0 ? Math.min(1, Math.max(0, (s - removed) / Ls)) : 0;
}

/**
 * Arc-length fraction(s) of the edge point at sewn fraction u: one, or [A, B] when u is exactly a mouth of this edge.
 * @param {Piece} piece @param {number} e @param {number} u @returns {number[]}
 */
export function sewnToEdge(piece, e, u) {
  const mouths = mouthsOn(piece, e);
  if (mouths.length === 0) return [u];
  const L = edgeLength(piece, e);
  let Ls = L;
  for (const m of mouths) Ls -= m.s1 - m.s0;
  const target = u * Ls;
  const tol = 1e-9 * Math.max(1, Ls);
  let removed = 0;
  for (const m of mouths) {
    const sm = m.s0 - removed;
    if (Math.abs(target - sm) <= tol) return [m.ta, m.tb];
    if (target < sm) return [(target + removed) / L];
    removed += m.s1 - m.s0;
  }
  return [Math.min(1, (target + removed) / L)];
}

/** Sewn fractions of the valid mouths of edge e, in order. @param {Piece} piece @param {number} e @returns {number[]} */
export function mouthFractions(piece, e) {
  const mouths = mouthsOn(piece, e);
  if (mouths.length === 0) return [];
  let Ls = edgeLength(piece, e);
  for (const m of mouths) Ls -= m.s1 - m.s0;
  /** @type {number[]} */
  const out = [];
  let removed = 0;
  for (const m of mouths) {
    out.push(Ls > 0 ? (m.s0 - removed) / Ls : 0);
    removed += m.s1 - m.s0;
  }
  return out;
}

/** Is arc-length fraction t strictly inside a valid mouth of edge e? @param {Piece} piece @param {number} e @param {number} t @returns {boolean} */
export function insideMouth(piece, e, t) {
  for (const m of mouthsOn(piece, e)) if (t > m.ta && t < m.tb) return true;
  return false;
}
