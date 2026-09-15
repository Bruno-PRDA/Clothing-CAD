// src/geometry/offset.js — seam allowance offset of a closed CCW polyline (SPEC 5.7). Pure; mm.
import { flattenPiece } from './bezier.js';
import { signedArea, isSimplePolygon, segmentsIntersect, lineIntersection, geometryError } from './polygon.js';

/** @typedef {import('../core/types.js').Vec2} Vec2 */
/** @typedef {import('../core/types.js').Piece} Piece */

const RESAMPLE_MM = 2;
const ARC_STEP = 5 * Math.PI / 180;

/**
 * Build the raw offset polyline (before loop removal).
 * @param {Vec2[]} pts resampled stitch polyline @param {number[]} alw per-segment allowance (pts.length entries)
 * @param {'mitre'|'round'} join @param {number} mitreLimit
 * @returns {Vec2[]}
 */
function rawOffset(pts, alw, join, mitreLimit) {
  const n = pts.length;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = pts[k];
    const b = pts[(k + 1) % n];
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len = Math.hypot(vx, vy);
    if (len > 0) { dx[k] = vx / len; dy[k] = vy / len; } else { dx[k] = 1; dy[k] = 0; }
  }
  /** @type {Vec2[]} */
  const out = [];
  for (let k = 0; k < n; k++) {
    const prev = (k + n - 1) % n;
    const corner = pts[k];
    const aPrev = alw[prev];
    const aNext = alw[k];
    // outward normals [d.y, -d.x]
    const nPx = dy[prev];
    const nPy = -dx[prev];
    const nNx = dy[k];
    const nNy = -dx[k];
    /** @type {Vec2} */
    const A = [corner[0] + aPrev * nPx, corner[1] + aPrev * nPy];
    /** @type {Vec2} */
    const B = [corner[0] + aNext * nNx, corner[1] + aNext * nNy];
    const turn = dx[prev] * dy[k] - dy[prev] * dx[k]; // > 0 left turn (convex for CCW)
    const dot = dx[prev] * dx[k] + dy[prev] * dy[k];
    if (Math.abs(A[0] - B[0]) < 1e-9 && Math.abs(A[1] - B[1]) < 1e-9) {
      out.push(A);
      continue;
    }
    if (Math.abs(aPrev - aNext) > 1e-9) {
      // different allowances: intersection of the two offset lines (hem square-off), guarded for near-parallel lines
      const big = Math.max(aPrev, aNext);
      const hit = lineIntersection(A, [A[0] + dx[prev], A[1] + dy[prev]], B, [B[0] + dx[k], B[1] + dy[k]]);
      // A genuine square-off corner lies at most sqrt(2) * big from the stitch corner (exactly `big` at a right angle).
      // Nearly-parallel edges with different allowances intersect far away; accepting that point would emit a long
      // spike that makes the whole cut line self-intersect, so fall back to a straight step from A to B instead.
      if (hit && Math.hypot(hit.point[0] - corner[0], hit.point[1] - corner[1]) <= Math.SQRT2 * big + 1e-9) {
        out.push(hit.point);
      } else {
        out.push(A, B);
      }
      continue;
    }
    const a = aPrev;
    if (a <= 0) { out.push([corner[0], corner[1]]); continue; }
    if (turn > 1e-12) {
      // convex corner: mitre when short enough, else round
      const half = Math.acos(Math.max(-1, Math.min(1, dot))) / 2; // half the turn angle
      const mitreLen = a / Math.cos(half);
      if (join === 'mitre' && Number.isFinite(mitreLen) && mitreLen <= mitreLimit * a) {
        const hit = lineIntersection(A, [A[0] + dx[prev], A[1] + dy[prev]], B, [B[0] + dx[k], B[1] + dy[k]]);
        out.push(hit ? hit.point : A);
      } else {
        const t0 = Math.atan2(nPy, nPx);
        let t1 = Math.atan2(nNy, nNx);
        while (t1 < t0) t1 += 2 * Math.PI;
        const steps = Math.max(1, Math.ceil((t1 - t0) / ARC_STEP - 1e-9));
        for (let s = 0; s <= steps; s++) {
          const th = t0 + (t1 - t0) * (s / steps);
          out.push([corner[0] + a * Math.cos(th), corner[1] + a * Math.sin(th)]);
        }
      }
    } else if (turn < -1e-12) {
      // concave corner: trimmed intersection of the two offset lines
      const hit = lineIntersection(A, [A[0] + dx[prev], A[1] + dy[prev]], B, [B[0] + dx[k], B[1] + dy[k]]);
      out.push(hit ? hit.point : A);
    } else {
      out.push(dot > 0 ? A : A, B);
    }
  }
  return out;
}

/** Remove consecutive near-duplicates (closed polyline). @param {Vec2[]} pts @returns {Vec2[]} */
function dedupe(pts) {
  /** @type {Vec2[]} */
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6) continue;
    out.push(p);
  }
  while (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) out.pop(); else break;
  }
  return out;
}

/**
 * Loop removal: every self-intersection loop with negative orientation (an inverted pocket) is cut out.
 * @param {Vec2[]} pts @returns {Vec2[]}
 */
function removeNegativeLoops(pts) {
  let poly = pts.slice();
  let passes = 0;
  const maxPasses = Math.max(8, pts.length);
  for (;;) {
    const n = poly.length;
    if (n < 4 || passes++ > maxPasses) break;
    let cut = false;
    outer:
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const minX = Math.min(a[0], b[0]);
      const maxX = Math.max(a[0], b[0]);
      const minY = Math.min(a[1], b[1]);
      const maxY = Math.max(a[1], b[1]);
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const c = poly[j];
        const d = poly[(j + 1) % n];
        if (Math.max(c[0], d[0]) < minX || Math.min(c[0], d[0]) > maxX || Math.max(c[1], d[1]) < minY || Math.min(c[1], d[1]) > maxY) continue;
        if (!segmentsIntersect(a, b, c, d)) continue;
        const li = lineIntersection(a, b, c, d);
        // Collinear/touching overlaps have no unique line intersection; split at poly[j] instead so the
        // degenerate loop is still removed (isSimplePolygon rejects those configurations too).
        const hit = li || { point: /** @type {Vec2} */ ([c[0], c[1]]) };
        // loop = X, poly[i+1 .. j]
        /** @type {Vec2[]} */
        const loop = [hit.point];
        for (let k = i + 1; k <= j; k++) loop.push(poly[k]);
        /** @type {Vec2[]} */
        const rest = [hit.point];
        for (let k = j + 1; k < n + i + 1; k++) rest.push(poly[k % n]);
        const loopArea = signedArea(loop);
        const restArea = signedArea(rest);
        if (loopArea < 0 && restArea >= loopArea) {
          poly = rest;
        } else if (restArea < 0 && loopArea >= restArea) {
          poly = loop;
        } else if (Math.abs(loopArea) < Math.abs(restArea)) {
          poly = rest;
        } else {
          poly = loop;
        }
        cut = true;
        break outer;
      }
    }
    if (!cut) break;
  }
  return poly;
}

/**
 * Offset a closed CCW polyline outward by a per-segment allowance (allowance[k] applies to segment k → k+1).
 * Resample at ≤ 2 mm chords, offset each segment along [d.y, −d.x], join (mitre/round; different allowances → the
 * intersection of the two offset lines = hem square-off; zero allowance keeps the stitch line), remove inverted loops,
 * validate (simple, area ≥ input); on failure retry with round joins, then throw GeometryError 'Offset'.
 * @param {Vec2[]} stitch @param {number[]} allowance mm (≤ 0 → 0) @param {{join?: 'mitre'|'round', mitreLimit?: number}} [opts]
 * @returns {Vec2[]} closed CCW cut polygon (corners once). Throws GeometryError 'Offset'.
 */
export function offsetPolygon(stitch, allowance, opts) {
  const n = stitch.length;
  if (n < 3) throw geometryError('Offset', 'need at least 3 points');
  const inputArea = signedArea(stitch);
  if (!(inputArea > 0)) throw geometryError('Offset', 'stitch polyline must be CCW');
  const alwIn = new Array(n);
  for (let k = 0; k < n; k++) {
    const a = Array.isArray(allowance) ? allowance[k] : allowance;
    alwIn[k] = (typeof a === 'number' && Number.isFinite(a) && a > 0) ? a : 0;
  }
  // 1. resample at ≤ 2 mm chords carrying the segment allowance
  /** @type {Vec2[]} */
  const pts = [];
  /** @type {number[]} */
  const alw = [];
  for (let k = 0; k < n; k++) {
    const a = stitch[k];
    const b = stitch[(k + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const m = Math.max(1, Math.ceil(len / RESAMPLE_MM - 1e-9));
    for (let j = 0; j < m; j++) {
      const u = j / m;
      pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
      alw.push(alwIn[k]);
    }
  }
  if (pts.length < 3) throw geometryError('Offset', 'degenerate stitch polyline');
  const mitreLimit = (opts && typeof opts.mitreLimit === 'number' && opts.mitreLimit > 1) ? opts.mitreLimit : 4;
  const foldX = (opts && typeof opts.foldX === 'number' && Number.isFinite(opts.foldX)) ? opts.foldX : null;
  const joins = (opts && opts.join === 'round') ? ['round'] : ['mitre', 'round'];
  let lastErr = '';
  for (const join of joins) {
    const raw = rawOffset(pts, alw, /** @type {'mitre'|'round'} */ (join), mitreLimit);
    const cleaned = dedupe(removeNegativeLoops(dedupe(raw)));
    if (cleaned.length < 3) { lastErr = 'collapsed'; continue; }
    const area = signedArea(cleaned);
    if (area < inputArea - 1e-6) { lastErr = 'area shrank'; continue; }
    if (!isSimplePolygon(cleaned)) { lastErr = 'self-intersecting'; continue; }
    // A fold piece stores the half on x >= foldX and is cut ON the fold line (zero allowance there). Where an adjacent
    // allowance meets the fold at a shallow angle — a deep neckline arriving almost parallel to it — the outward offset
    // would step past the fold; squaring those points off against it is the hem square-off rule applied to a fold edge.
    if (foldX !== null) for (let k = 0; k < cleaned.length; k++) if (cleaned[k][0] < foldX) cleaned[k] = [foldX, cleaned[k][1]];
    return cleaned;
  }
  throw geometryError('Offset', 'offset polygon invalid (' + lastErr + ')');
}

/**
 * Piece convenience: flattenPiece at 0.5 mm, per-point allowance from edges[e].allowance_mm ?? seamAllowance_mm, fold edge
 * forced 0. For fold pieces the result is the HALF outline's cut line (the fold edge stays on x = foldX).
 * @param {Piece} piece @param {{join?: 'mitre'|'round', mitreLimit?: number}} [opts] @returns {Vec2[]}
 */
export function offsetOutline(piece, opts) {
  const { points, edgeStart } = flattenPiece(piece, 0.5);
  const n = piece.vertices.length;
  const alw = new Array(points.length).fill(0);
  const def = (typeof piece.seamAllowance_mm === 'number' && Number.isFinite(piece.seamAllowance_mm)) ? piece.seamAllowance_mm : 0;
  for (let e = 0; e < n; e++) {
    const edge = piece.edges[e];
    let a = (edge && typeof edge.allowance_mm === 'number' && Number.isFinite(edge.allowance_mm)) ? edge.allowance_mm : def;
    if (piece.foldEdge === e) a = 0;
    const s = edgeStart[e];
    const t = e + 1 < n ? edgeStart[e + 1] : points.length;
    for (let k = s; k < t; k++) alw[k] = a;
  }
  const hasFold = piece.foldEdge !== null && piece.foldEdge !== undefined && !!piece.edges[piece.foldEdge];
  return offsetPolygon(points, alw, hasFold ? { ...opts, foldX: piece.vertices[piece.foldEdge][0] } : opts);
}
