// src/geometry/delaunay.js — Bowyer–Watson Delaunay with constrained-edge recovery by flips (SPEC 5.5). Pure.
import { geometryError } from './polygon.js';

/** @typedef {import('../core/types.js').Vec2} Vec2 */

const KEY_SHIFT = 2097152; // 2^21
// Relative (scale-free) tolerance of the incircle test: d² < r²·(1 − INCIRCLE_EPS). An ABSOLUTE tolerance would behave
// completely differently for a mesh that fills the normalised unit square and for one that occupies a corner of it.
const INCIRCLE_EPS = 1e-12;

/** Undirected edge key, i < j. @param {number} i @param {number} j @returns {number} */
export function edgeKey(i, j) {
  return i < j ? i * KEY_SHIFT + j : j * KEY_SHIFT + i;
}

/**
 * @param {Float64Array|number[]|Vec2[]} points
 * @returns {{xs: Float64Array, ys: Float64Array, n: number}}
 */
function toArrays(points) {
  if (points instanceof Float64Array || (Array.isArray(points) && points.length > 0 && typeof points[0] === 'number')) {
    const flat = /** @type {ArrayLike<number>} */ (points);
    const n = flat.length >> 1;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = flat[2 * i];
      ys[i] = flat[2 * i + 1];
    }
    return { xs, ys, n };
  }
  const list = /** @type {Vec2[]} */ (points);
  const n = list.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = list[i][0];
    ys[i] = list[i][1];
  }
  return { xs, ys, n };
}

/**
 * Bowyer–Watson Delaunay of 2D points (Float64Array 2N or Vec2[]). Super-triangle 1000× the bbox, points inserted in
 * x-sorted order, incircle test on coordinates normalised to the unit square (eps 1e-12); triangles whose circumcircle lies
 * entirely left of the sweep are retired early. CCW triangles. GeometryError 'Delaunay' on degenerate input.
 * @param {Float64Array|number[]|Vec2[]} points @returns {Uint32Array} 3T
 */
export function delaunay(points) {
  const { xs, ys, n } = toArrays(points);
  if (n < 3) throw geometryError('Delaunay', 'need at least 3 points, got ' + n);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) throw geometryError('Delaunay', 'non-finite coordinate at ' + i);
    if (xs[i] < minX) minX = xs[i];
    if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i];
    if (ys[i] > maxY) maxY = ys[i];
  }
  const scale = Math.max(maxX - minX, maxY - minY);
  if (!(scale > 0)) throw geometryError('Delaunay', 'all points coincide');
  const px = new Float64Array(n + 3);
  const py = new Float64Array(n + 3);
  for (let i = 0; i < n; i++) {
    px[i] = (xs[i] - minX) / scale;
    py[i] = (ys[i] - minY) / scale;
  }
  const order = new Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => (px[a] - px[b]) || (py[a] - py[b]));
  const dupTol = 1e-9 / scale;
  for (let k = 1; k < n; k++) {
    const a = order[k - 1];
    const b = order[k];
    if (Math.abs(px[a] - px[b]) <= dupTol && Math.abs(py[a] - py[b]) <= dupTol) {
      throw geometryError('Delaunay', 'duplicate points ' + a + ' and ' + b);
    }
  }
  // super triangle (CCW), 1000× the (unit) bbox
  const cx = 0.5;
  const cy = ((maxY - minY) / scale) / 2;
  const M = 1000;
  const s0 = n;
  const s1 = n + 1;
  const s2 = n + 2;
  px[s0] = cx - 2 * M; py[s0] = cy - M;
  px[s1] = cx + 2 * M; py[s1] = cy - M;
  px[s2] = cx; py[s2] = cy + 2 * M;

  /** @type {number[]} */
  const ta = [];
  /** @type {number[]} */
  const tb = [];
  /** @type {number[]} */
  const tc = [];
  /** @type {number[]} */
  const tcx = [];
  /** @type {number[]} */
  const tcy = [];
  /** @type {number[]} */
  const tr2 = [];

  /** @param {number} a @param {number} b @param {number} c @returns {number} triangle id */
  function addTri(a, b, c) {
    // ensure CCW
    const o = (px[b] - px[a]) * (py[c] - py[a]) - (py[b] - py[a]) * (px[c] - px[a]);
    if (o < 0) { const t = b; b = c; c = t; }
    const ax = px[a];
    const ay = py[a];
    const bx = px[b] - ax;
    const by = py[b] - ay;
    const cxr = px[c] - ax;
    const cyr = py[c] - ay;
    const d = 2 * (bx * cyr - by * cxr);
    let ux;
    let uy;
    let r2;
    if (Math.abs(d) < 1e-300) {
      ux = ax + (bx + cxr) / 3;
      uy = ay + (by + cyr) / 3;
      r2 = Infinity;
    } else {
      const b2 = bx * bx + by * by;
      const c2 = cxr * cxr + cyr * cyr;
      const rx = (cyr * b2 - by * c2) / d;
      const ry = (bx * c2 - cxr * b2) / d;
      ux = ax + rx;
      uy = ay + ry;
      r2 = rx * rx + ry * ry;
    }
    const id = ta.length;
    ta.push(a); tb.push(b); tc.push(c);
    tcx.push(ux); tcy.push(uy); tr2.push(r2);
    return id;
  }

  let active = [addTri(s0, s1, s2)];
  /** @type {number[]} */
  const finished = [];
  /** @type {number[]} */
  const bad = [];
  /** @type {number[]} */
  const eu = [];
  /** @type {number[]} */
  const ev = [];

  /** Twice the signed area of (a, b, c) in normalised coordinates. @param {number} a @param {number} b @param {number} c */
  function orient2(a, b, c) {
    return (px[b] - px[a]) * (py[c] - py[a]) - (py[b] - py[a]) * (px[c] - px[a]);
  }
  /**
   * Cavity boundary of the current `bad` set: directed edges whose reverse belongs to no other bad triangle.
   * Writes into eu/ev and returns the owning triangle of each boundary edge.
   * @returns {number[]} owner triangle per boundary edge (parallel to the compacted eu/ev)
   */
  function cavityBoundary() {
    /** @type {number[]} */
    const du = [];
    /** @type {number[]} */
    const dv = [];
    /** @type {number[]} */
    const owner = [];
    for (let i = 0; i < bad.length; i++) {
      const t = bad[i];
      du.push(ta[t], tb[t], tc[t]);
      dv.push(tb[t], tc[t], ta[t]);
      owner.push(t, t, t);
    }
    const m = du.length;
    eu.length = 0;
    ev.length = 0;
    /** @type {number[]} */
    const own = [];
    for (let i = 0; i < m; i++) {
      const u = du[i];
      const v = dv[i];
      let shared = false;
      for (let j = 0; j < m; j++) {
        if (du[j] === v && dv[j] === u) { shared = true; break; }
      }
      if (shared) continue;
      eu.push(u);
      ev.push(v);
      own.push(owner[i]);
    }
    return own;
  }
  /** True when the current eu/ev boundary is one simple directed cycle. @returns {boolean} */
  function isSingleCycle() {
    const m = eu.length;
    if (m < 3) return false;
    /** @type {Map<number, number>} */
    const next = new Map();
    /** @type {Set<number>} */
    const targets = new Set();
    for (let i = 0; i < m; i++) {
      if (next.has(eu[i]) || targets.has(ev[i]) || eu[i] === ev[i]) return false;
      next.set(eu[i], ev[i]);
      targets.add(ev[i]);
    }
    let at = eu[0];
    for (let steps = 0; steps < m; steps++) {
      const to = next.get(at);
      if (to === undefined) return false;
      at = to;
      if (at === eu[0]) return steps === m - 1;
    }
    return false;
  }

  for (let k = 0; k < n; k++) {
    const p = order[k];
    const x = px[p];
    const y = py[p];
    bad.length = 0;
    let w = 0;
    for (let i = 0; i < active.length; i++) {
      const t = active[i];
      const dx = x - tcx[t];
      const r2 = tr2[t];
      if (dx > 0 && dx * dx > r2) { finished.push(t); continue; }
      const dy = y - tcy[t];
      if (dx * dx + dy * dy < r2 * (1 - INCIRCLE_EPS)) bad.push(t); else active[w++] = t;
    }
    active.length = w;
    if (bad.length === 0) {
      // numerically no containing triangle (should not happen); fall back to a full scan without eps
      for (let i = 0; i < active.length; i++) {
        const t = active[i];
        const dx = x - tcx[t];
        const dy = y - tcy[t];
        if (dx * dx + dy * dy <= tr2[t]) { bad.push(t); active.splice(i, 1); i--; }
      }
      if (bad.length === 0) throw geometryError('Delaunay', 'point ' + p + ' outside every circumcircle');
    }
    // Cavity repair. In exact arithmetic the conflict region is star-shaped seen from p, so every cavity boundary edge
    // (u, v) satisfies orient(u, v, p) > 0 and the fan of triangles (u, v, p) tiles the cavity exactly. Round-off on a
    // near-degenerate configuration (collinear boundary samples, near-cocircular lattice points) can break that and
    // produce overlapping triangles. Returning the offending triangle to `active` shrinks the cavity monotonically —
    // the result stays a valid triangulation, at worst locally non-Delaunay.
    for (let pass = 0; pass < 16; pass++) {
      const own = cavityBoundary();
      /** @type {number[]} */
      const restore = [];
      for (let i = 0; i < eu.length; i++) {
        if (orient2(eu[i], ev[i], p) <= 0 && restore.indexOf(own[i]) < 0) restore.push(own[i]);
      }
      if (restore.length === 0) break;
      if (restore.length >= bad.length) break; // would empty the cavity: accept this pass as-is
      for (let i = 0; i < restore.length; i++) {
        const t = restore[i];
        const at = bad.indexOf(t);
        if (at >= 0) bad.splice(at, 1);
        active.push(t);
      }
    }
    if (bad.length === 0) throw geometryError('Delaunay', 'degenerate cavity at point ' + p);
    cavityBoundary();
    // The fan (u, v, p) only tiles the cavity when its boundary is ONE simple directed cycle. Anything else means the
    // repair above could not save this configuration; fail loudly (remesh.js retries and then falls back to ear
    // clipping) rather than emitting overlapping triangles.
    if (!isSingleCycle()) throw geometryError('Delaunay', 'cavity of point ' + p + ' is not a simple loop');
    for (let i = 0; i < eu.length; i++) active.push(addTri(eu[i], ev[i], p));
  }
  const all = finished.concat(active);
  let count = 0;
  for (let i = 0; i < all.length; i++) {
    const t = all[i];
    if (ta[t] < n && tb[t] < n && tc[t] < n) count++;
  }
  if (count === 0) throw geometryError('Delaunay', 'degenerate (collinear) input');
  const out = new Uint32Array(3 * count);
  let o = 0;
  for (let i = 0; i < all.length; i++) {
    const t = all[i];
    if (ta[t] < n && tb[t] < n && tc[t] < n) {
      out[o++] = ta[t]; out[o++] = tb[t]; out[o++] = tc[t];
    }
  }
  return out;
}

/**
 * Half-edge adjacency: for each undirected edge (i<j, sorted by (i, j)) the two triangle ids (or -1).
 * @param {number} vertexCount @param {Uint32Array} tris
 * @returns {{edges: Uint32Array, triA: Int32Array, triB: Int32Array, edgeIndex: Map<number, number>}} key = i * 2^21 + j
 */
export function buildAdjacency(vertexCount, tris) {
  const T = tris.length / 3;
  /** @type {Map<number, number[]>} */
  const map = new Map();
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < 3; k++) {
      const i = tris[3 * t + k];
      const j = tris[3 * t + ((k + 1) % 3)];
      const key = edgeKey(i, j);
      const entry = map.get(key);
      if (entry) entry.push(t); else map.set(key, [t]);
    }
  }
  const keys = Array.from(map.keys()).sort((a, b) => a - b);
  const E = keys.length;
  const edges = new Uint32Array(2 * E);
  const triA = new Int32Array(E).fill(-1);
  const triB = new Int32Array(E).fill(-1);
  /** @type {Map<number, number>} */
  const edgeIndex = new Map();
  for (let e = 0; e < E; e++) {
    const key = keys[e];
    const i = Math.floor(key / KEY_SHIFT);
    const j = key - i * KEY_SHIFT;
    edges[2 * e] = i;
    edges[2 * e + 1] = j;
    const list = /** @type {number[]} */ (map.get(key));
    triA[e] = list[0];
    if (list.length > 1) triB[e] = list[1];
    edgeIndex.set(key, e);
  }
  void vertexCount;
  return { edges, triA, triB, edgeIndex };
}

/**
 * Constrained recovery by edge flips (Sloan 1993): for every constraint (a, b) missing from `tris`, the triangulation edges
 * crossing segment ab are flipped (when their quadrilateral is convex) until (a, b) exists. Never inserts vertices; the
 * triangle count is preserved. Then a Delaunay pass (max 2 sweeps) restores the empty-circle property of non-constraint
 * edges. Throws GeometryError 'Constraint' (with `constraint: [a, b]`) when a constraint cannot be recovered.
 * @param {Float64Array|number[]|Vec2[]} points @param {Uint32Array} tris @param {Uint32Array|number[]} constraints 2C pairs
 * @returns {Uint32Array} new array
 */
export function recoverEdges(points, tris, constraints) {
  const { xs, ys, n } = toArrays(points);
  const out = Uint32Array.from(tris);
  const T = out.length / 3;
  /** @type {Map<number, number[]>} */
  const emap = new Map();
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(out[3 * t + k], out[3 * t + ((k + 1) % 3)]);
      const entry = emap.get(key);
      if (entry) entry.push(t); else emap.set(key, [t]);
    }
  }
  const C = constraints.length >> 1;
  const constrained = new Set();
  for (let c = 0; c < C; c++) constrained.add(edgeKey(constraints[2 * c], constraints[2 * c + 1]));

  /** @param {number} a @param {number} b @param {number} c @returns {number} */
  function orient(a, b, c) {
    return (xs[b] - xs[a]) * (ys[c] - ys[a]) - (ys[b] - ys[a]) * (xs[c] - xs[a]);
  }
  /** @param {number} t @param {number} u @param {number} v @returns {number} third vertex of t */
  function third(t, u, v) {
    const a = out[3 * t];
    const b = out[3 * t + 1];
    const c = out[3 * t + 2];
    if (a !== u && a !== v) return a;
    if (b !== u && b !== v) return b;
    return c;
  }
  /** @param {number} t @param {number} a @param {number} b @param {number} c */
  function setTri(t, a, b, c) {
    if (orient(a, b, c) < 0) { const tmp = b; b = c; c = tmp; }
    out[3 * t] = a; out[3 * t + 1] = b; out[3 * t + 2] = c;
  }
  /** @param {number} key @param {number} oldT @param {number} newT */
  function replaceTri(key, oldT, newT) {
    const list = emap.get(key);
    if (!list) return;
    for (let i = 0; i < list.length; i++) if (list[i] === oldT) { list[i] = newT; return; }
  }
  /** Proper crossing of segments (p,q) and (a,b). */
  function crosses(p, q, a, b) {
    if (p === a || p === b || q === a || q === b) return false;
    const d1 = orient(a, b, p);
    const d2 = orient(a, b, q);
    const d3 = orient(p, q, a);
    const d4 = orient(p, q, b);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  /**
   * Flip edge (u, v) if its quadrilateral is strictly convex. Returns the new edge [p, q] or null.
   * @param {number} u @param {number} v @returns {[number, number]|null}
   */
  function tryFlip(u, v) {
    const key = edgeKey(u, v);
    const list = emap.get(key);
    if (!list || list.length !== 2) return null;
    const tA = list[0];
    const tB = list[1];
    const p = third(tA, u, v);
    const q = third(tB, u, v);
    const o1 = orient(p, q, u);
    const o2 = orient(p, q, v);
    const o3 = orient(u, v, p);
    const o4 = orient(u, v, q);
    if (!(((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0)))) return null;
    emap.delete(key);
    setTri(tA, p, q, u);
    setTri(tB, p, q, v);
    emap.set(edgeKey(p, q), [tA, tB]);
    replaceTri(edgeKey(u, q), tB, tA);
    replaceTri(edgeKey(v, p), tA, tB);
    return [p, q];
  }

  let flips = 0;
  const maxFlips = Math.max(64, 4 * n + 4 * T);
  for (let c = 0; c < C; c++) {
    const a = constraints[2 * c];
    const b = constraints[2 * c + 1];
    if (a === b) continue;
    if (emap.has(edgeKey(a, b))) continue;
    // find the first crossing edge: a triangle incident to `a` whose opposite edge straddles ab
    let u = -1;
    let v = -1;
    let cur = -1;
    for (let t = 0; t < T && cur < 0; t++) {
      const i0 = out[3 * t];
      const i1 = out[3 * t + 1];
      const i2 = out[3 * t + 2];
      let x = -1;
      let y = -1;
      if (i0 === a) { x = i1; y = i2; } else if (i1 === a) { x = i2; y = i0; } else if (i2 === a) { x = i0; y = i1; } else continue;
      if (crosses(x, y, a, b)) { u = x; v = y; cur = t; }
    }
    if (cur < 0) {
      const err = geometryError('Constraint', 'no crossing edge found for constraint ' + a + '-' + b);
      /** @type {any} */ (err).constraint = [a, b];
      throw err;
    }
    /** @type {number[]} */
    const queue = [];
    // walk from a to b collecting crossing edges
    let guard = 0;
    for (;;) {
      queue.push(u, v);
      const list = emap.get(edgeKey(u, v));
      if (!list || list.length !== 2) {
        const err = geometryError('Constraint', 'constraint ' + a + '-' + b + ' leaves the triangulation');
        /** @type {any} */ (err).constraint = [a, b];
        throw err;
      }
      const next = list[0] === cur ? list[1] : list[0];
      const w = third(next, u, v);
      if (w === b) break;
      const ow = orient(a, b, w);
      if (ow === 0) {
        const err = geometryError('Constraint', 'vertex ' + w + ' lies on constraint ' + a + '-' + b);
        /** @type {any} */ (err).constraint = [a, b];
        throw err;
      }
      const ou = orient(a, b, u);
      if ((ow > 0) === (ou > 0)) u = w; else v = w;
      cur = next;
      if (++guard > T + 3) {
        const err = geometryError('Constraint', 'walk did not terminate for ' + a + '-' + b);
        /** @type {any} */ (err).constraint = [a, b];
        throw err;
      }
    }
    let stalls = 0;
    while (queue.length > 0) {
      const eu = queue.shift();
      const ev = queue.shift();
      if (!emap.has(edgeKey(eu, ev))) { stalls = 0; continue; }
      const res = tryFlip(eu, ev);
      if (res === null) {
        queue.push(eu, ev);
        if (++stalls > queue.length + 2) {
          const err = geometryError('Constraint', 'no convex flip available for ' + a + '-' + b);
          /** @type {any} */ (err).constraint = [a, b];
          throw err;
        }
        continue;
      }
      stalls = 0;
      if (++flips > maxFlips) {
        const err = geometryError('Constraint', 'flip limit exceeded for ' + a + '-' + b);
        /** @type {any} */ (err).constraint = [a, b];
        throw err;
      }
      if (crosses(res[0], res[1], a, b)) queue.push(res[0], res[1]);
    }
    if (!emap.has(edgeKey(a, b))) {
      const err = geometryError('Constraint', 'constraint ' + a + '-' + b + ' not recovered');
      /** @type {any} */ (err).constraint = [a, b];
      throw err;
    }
  }

  // Delaunay restoration of non-constraint edges (max 2 sweeps)
  /** @param {number} u @param {number} v @returns {boolean} */
  function violates(u, v) {
    const list = emap.get(edgeKey(u, v));
    if (!list || list.length !== 2) return false;
    const p = third(list[0], u, v);
    const q = third(list[1], u, v);
    // circumcircle of (u, v, p) strictly containing q
    const ax = xs[u];
    const ay = ys[u];
    const bx = xs[v] - ax;
    const by = ys[v] - ay;
    const cx = xs[p] - ax;
    const cy = ys[p] - ay;
    const d = 2 * (bx * cy - by * cx);
    if (Math.abs(d) < 1e-300) return false;
    const b2 = bx * bx + by * by;
    const c2 = cx * cx + cy * cy;
    const rx = (cy * b2 - by * c2) / d;
    const ry = (bx * c2 - cx * b2) / d;
    const r2 = rx * rx + ry * ry;
    const qx = xs[q] - ax - rx;
    const qy = ys[q] - ay - ry;
    return qx * qx + qy * qy < r2 * (1 - 1e-9);
  }
  for (let sweep = 0; sweep < 2; sweep++) {
    let changed = 0;
    const keys = Array.from(emap.keys());
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (constrained.has(key) || !emap.has(key)) continue;
      const u = Math.floor(key / KEY_SHIFT);
      const v = key - u * KEY_SHIFT;
      if (violates(u, v) && tryFlip(u, v) !== null) changed++;
    }
    if (changed === 0) break;
  }
  return out;
}
