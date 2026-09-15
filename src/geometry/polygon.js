// src/geometry/polygon.js — polygon predicates and distances (SPEC 5.2). Pure; mm, y up; outlines CCW.

/** @typedef {import('../core/types.js').Vec2} Vec2 */
/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').Edge} Edge */

/**
 * Error with a `code` of 'GeometryError' and a `kind` ('Delaunay' | 'Constraint' | 'Offset').
 * @param {string} kind @param {string} message @returns {Error & {code:string, kind:string}}
 */
export function geometryError(kind, message) {
  const err = /** @type {Error & {code:string, kind:string}} */ (new Error('GeometryError(' + kind + '): ' + message));
  err.code = 'GeometryError';
  err.kind = kind;
  return err;
}

/** Shoelace; > 0 for CCW; mm². @param {Vec2[]} pts @returns {number} */
export function signedArea(pts) {
  const n = pts.length;
  if (n < 3) return 0;
  let acc = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    acc += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return acc / 2;
}

/** signedArea(pts) > 0. @param {Vec2[]} pts @returns {boolean} */
export function isCCW(pts) {
  return signedArea(pts) > 0;
}

/** Returns pts (same array) or a reversed COPY when signedArea < 0. @param {Vec2[]} pts @returns {Vec2[]} */
export function ensureCCW(pts) {
  if (signedArea(pts) < 0) return pts.slice().reverse();
  return pts;
}

/** NEW piece with vertices/edges reversed (cubic c1/c2 swapped), notches t → 1 - t and edge remapped, foldEdge/pinnedEdges remapped. @param {Piece} piece @returns {Piece} */
export function reverseOutline(piece) {
  const out = /** @type {Piece} */ (JSON.parse(JSON.stringify(piece)));
  const n = piece.vertices.length;
  // new vertex k = old vertex (n - k) % n; new edge k = old edge (n - 1 - k) traversed backwards
  out.vertices = new Array(n);
  out.edges = new Array(n);
  for (let k = 0; k < n; k++) {
    const v = piece.vertices[(n - k) % n];
    out.vertices[k] = [v[0], v[1]];
    const old = piece.edges[n - 1 - k];
    /** @type {Edge} */
    const e = { type: old.type };
    if (old.type === 'cubic' && old.c1 && old.c2) {
      e.c1 = [old.c2[0], old.c2[1]];
      e.c2 = [old.c1[0], old.c1[1]];
    }
    if (old.allowance_mm !== undefined) e.allowance_mm = old.allowance_mm;
    if (old.label !== undefined) e.label = old.label;
    out.edges[k] = e;
  }
  const map = (e) => n - 1 - e;
  out.notches = (piece.notches || []).map((nt) => ({ edge: map(nt.edge), t: 1 - nt.t, kind: nt.kind }));
  out.foldEdge = (typeof piece.foldEdge === 'number') ? map(piece.foldEdge) : null;
  out.pinnedEdges = (piece.pinnedEdges || []).map(map);
  return out;
}

/** @param {Vec2} o @param {Vec2} a @param {Vec2} b @returns {number} cross(a - o, b - o) */
function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** @param {Vec2} p @param {Vec2} a @param {Vec2} b @returns {boolean} p within the bbox of ab (collinear case) */
function onSegmentBox(p, a, b) {
  return Math.min(a[0], b[0]) - 1e-9 <= p[0] && p[0] <= Math.max(a[0], b[0]) + 1e-9 &&
    Math.min(a[1], b[1]) - 1e-9 <= p[1] && p[1] <= Math.max(a[1], b[1]) + 1e-9;
}

const CROSS_EPS = 1e-9;

/** Proper or touching intersection of segments ab and cd; eps 1e-9 mm² on the cross products. @param {Vec2} a @param {Vec2} b @param {Vec2} c @param {Vec2} d @returns {boolean} */
export function segmentsIntersect(a, b, c, d) {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > CROSS_EPS && d2 < -CROSS_EPS) || (d1 < -CROSS_EPS && d2 > CROSS_EPS)) &&
      ((d3 > CROSS_EPS && d4 < -CROSS_EPS) || (d3 < -CROSS_EPS && d4 > CROSS_EPS))) return true;
  if (Math.abs(d1) <= CROSS_EPS && onSegmentBox(a, c, d)) return true;
  if (Math.abs(d2) <= CROSS_EPS && onSegmentBox(b, c, d)) return true;
  if (Math.abs(d3) <= CROSS_EPS && onSegmentBox(c, a, b)) return true;
  if (Math.abs(d4) <= CROSS_EPS && onSegmentBox(d, a, b)) return true;
  return false;
}

/**
 * Strict (proper) crossing of segments ab and cd: interiors cross, no touching.
 * @param {Vec2} a @param {Vec2} b @param {Vec2} c @param {Vec2} d @returns {boolean}
 */
export function segmentsCross(a, b, c, d) {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > CROSS_EPS && d2 < -CROSS_EPS) || (d1 < -CROSS_EPS && d2 > CROSS_EPS)) &&
    ((d3 > CROSS_EPS && d4 < -CROSS_EPS) || (d3 < -CROSS_EPS && d4 > CROSS_EPS));
}

/**
 * Intersection point of the lines through ab and cd (null when parallel).
 * @param {Vec2} a @param {Vec2} b @param {Vec2} c @param {Vec2} d @returns {{point: Vec2, t: number, u: number}|null}
 */
export function lineIntersection(a, b, c, d) {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0];
  const qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  return { point: [a[0] + rx * t, a[1] + ry * t], t, u };
}

/** O(n²) pairwise test skipping adjacent segments; false if any two non-adjacent segments intersect or a vertex repeats within 1e-6 mm. @param {Vec2[]} pts @returns {boolean} */
export function isSimplePolygon(pts) {
  const n = pts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (Math.abs(a[0] - b[0]) <= 1e-6 && Math.abs(a[1] - b[1]) <= 1e-6) return false;
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const minX = Math.min(a[0], b[0]);
    const maxX = Math.max(a[0], b[0]);
    const minY = Math.min(a[1], b[1]);
    const maxY = Math.max(a[1], b[1]);
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the wrap
      const c = pts[j];
      const d = pts[(j + 1) % n];
      if (Math.max(c[0], d[0]) < minX - 1e-9 || Math.min(c[0], d[0]) > maxX + 1e-9 ||
          Math.max(c[1], d[1]) < minY - 1e-9 || Math.min(c[1], d[1]) > maxY + 1e-9) continue;
      if (segmentsIntersect(a, b, c, d)) return false;
    }
  }
  return true;
}

/** Even-odd ray crossing; points ON the boundary count as inside. @param {Vec2} pt @param {Vec2[]} pts @returns {boolean} */
export function pointInPolygon(pt, pts) {
  const n = pts.length;
  if (n < 3) return false;
  const x = pt[0];
  const y = pt[1];
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    if ((yi > y) !== (yj > y)) {
      const xc = xi + (y - yi) * (xj - xi) / (yj - yi);
      if (x < xc) inside = !inside;
    }
  }
  if (inside) return true;
  return distToPolyline(pt, pts, true).dist <= 1e-6;
}

/** @param {Vec2} pt @param {Vec2} a @param {Vec2} b @returns {{dist:number, t:number, point:Vec2}} */
export function distToSegment(pt, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) {
    t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
  }
  const px = a[0] + dx * t;
  const py = a[1] + dy * t;
  return { dist: Math.hypot(pt[0] - px, pt[1] - py), t, point: [px, py] };
}

/** Nearest segment index `seg` and its parameter. @param {Vec2} pt @param {Vec2[]} pts @param {boolean} closed @returns {{dist:number, seg:number, t:number, point:Vec2}} */
export function distToPolyline(pt, pts, closed) {
  const n = pts.length;
  let best = { dist: Infinity, seg: -1, t: 0, point: /** @type {Vec2} */ ([NaN, NaN]) };
  if (n === 0) return best;
  if (n === 1) return { dist: Math.hypot(pt[0] - pts[0][0], pt[1] - pts[0][1]), seg: 0, t: 0, point: [pts[0][0], pts[0][1]] };
  const segs = closed ? n : n - 1;
  const x = pt[0];
  const y = pt[1];
  let bestD2 = Infinity;
  let bestSeg = -1;
  let bestT = 0;
  let bestX = NaN;
  let bestY = NaN;
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 0) {
      t = ((x - a[0]) * dx + (y - a[1]) * dy) / len2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
    }
    const px = a[0] + dx * t;
    const py = a[1] + dy * t;
    const d2 = (x - px) * (x - px) + (y - py) * (y - py);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestSeg = i;
      bestT = t;
      bestX = px;
      bestY = py;
    }
  }
  best = { dist: Math.sqrt(bestD2), seg: bestSeg, t: bestT, point: [bestX, bestY] };
  return best;
}

/** @param {Vec2[]} pts @returns {{minX:number, minY:number, maxX:number, maxY:number}} */
export function bbox(pts) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

/** Area-weighted centroid (vertex mean when |area| < 1e-9). @param {Vec2[]} pts @returns {{x:number, y:number}} */
export function centroid(pts) {
  const n = pts.length;
  if (n === 0) return { x: 0, y: 0 };
  const area = signedArea(pts);
  if (Math.abs(area) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      sx += pts[i][0];
      sy += pts[i][1];
    }
    return { x: sx / n, y: sy / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    cx += (pts[j][0] + pts[i][0]) * f;
    cy += (pts[j][1] + pts[i][1]) * f;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** @param {Vec2[]} pts @param {boolean} closed @returns {number} mm */
export function polylineLength(pts, closed) {
  const n = pts.length;
  if (n < 2) return 0;
  let acc = 0;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return acc;
}

/** Points every ≤ spacing_mm along the polyline, corners kept. @param {Vec2[]} pts @param {boolean} closed @param {number} spacing_mm @returns {Vec2[]} */
export function resamplePolyline(pts, closed, spacing_mm) {
  const n = pts.length;
  /** @type {Vec2[]} */
  const out = [];
  if (n === 0) return out;
  const spacing = (typeof spacing_mm === 'number' && spacing_mm > 0) ? spacing_mm : 1;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(len / spacing - 1e-9));
    for (let j = 0; j < k; j++) {
      const u = j / k;
      out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    }
  }
  if (!closed) out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}

/** New array. @param {Vec2[]} pts @param {number} dx @param {number} dy @returns {Vec2[]} */
export function translatePoints(pts, dx, dy) {
  return pts.map((p) => [p[0] + dx, p[1] + dy]);
}

/** New array, scaled about (ox, oy). @param {Vec2[]} pts @param {number} sx @param {number} sy @param {number} ox @param {number} oy @returns {Vec2[]} */
export function scalePoints(pts, sx, sy, ox, oy) {
  const cx = ox || 0;
  const cy = oy || 0;
  return pts.map((p) => [cx + (p[0] - cx) * sx, cy + (p[1] - cy) * sy]);
}
