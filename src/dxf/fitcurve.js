// src/dxf/fitcurve.js — cubic Bézier edges from the dense point runs other CAD systems write.
// Pure. After Schneider, "An Algorithm for Automatically Fitting Digitized Curves" (Graphics Gems, 1990):
// fixed end points and end tangents, chord-length parameters refined by Newton steps, least-squares control
// point distances, and a split at the worst point when one cubic cannot stay within tolerance.
//
// The app stores an outline as corners joined by line or cubic edges. A DXF boundary is a polyline whose
// vertices are either turn points (corners) or curve points (samples of a curve). A run of curve points
// between two turn points becomes one or more cubics; a run with no curve points is a straight edge.

/** @typedef {[number, number]} Vec2 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => { const l = len(a); return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0]; };

/** @param {Vec2} p0 @param {Vec2} c1 @param {Vec2} c2 @param {Vec2} p1 @param {number} t */
function bez(p0, c1, c2, p1, t) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
    u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
  ];
}
function bezD1(p0, c1, c2, p1, t) {
  const u = 1 - t;
  return [
    3 * u * u * (c1[0] - p0[0]) + 6 * u * t * (c2[0] - c1[0]) + 3 * t * t * (p1[0] - c2[0]),
    3 * u * u * (c1[1] - p0[1]) + 6 * u * t * (c2[1] - c1[1]) + 3 * t * t * (p1[1] - c2[1]),
  ];
}
function bezD2(p0, c1, c2, p1, t) {
  const u = 1 - t;
  return [
    6 * u * (c2[0] - 2 * c1[0] + p0[0]) + 6 * t * (p1[0] - 2 * c2[0] + c1[0]),
    6 * u * (c2[1] - 2 * c1[1] + p0[1]) + 6 * t * (p1[1] - 2 * c2[1] + c1[1]),
  ];
}

/**
 * Unit tangent at an end of a point run, second-order: through the end point and the next two, weighted by
 * their chord lengths (a parabola's slope at its end). The first chord alone is off by half the turn over it,
 * which on a coarsely sampled curve is enough to force a needless split.
 * @param {Vec2[]} pts @param {boolean} atEnd false: leaving pts[0]; true: pointing back from the last point
 */
function endTangent(pts, atEnd) {
  const n = pts.length;
  const p0 = atEnd ? pts[n - 1] : pts[0];
  const p1 = atEnd ? pts[n - 2] : pts[1];
  if (n < 3) return unit(sub(p1, p0));
  const p2 = atEnd ? pts[n - 3] : pts[2];
  const h1 = len(sub(p1, p0)), h2 = len(sub(p2, p1));
  if (h1 < 1e-12 || h2 < 1e-12) return unit(sub(p1, p0));
  // derivative at p0 of the parabola through p0, p1, p2 with chord-length parameters 0, h1, h1 + h2
  const a = -(2 * h1 + h2) / (h1 * (h1 + h2)), b = (h1 + h2) / (h1 * h2), c = -h1 / (h2 * (h1 + h2));
  const d = [a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]];
  const t = unit(d);
  return len(t) > 0 ? t : unit(sub(p1, p0));
}

/** Chord-length parameters in [0, 1]. @param {Vec2[]} pts */
function chordParams(pts) {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + len(sub(pts[i], pts[i - 1])));
  const L = u[u.length - 1] || 1;
  return u.map((v) => v / L);
}

/** Least-squares cubic with given end tangents (Schneider's generateBezier). */
function generate(pts, u, t0, t1) {
  const p0 = pts[0], p3 = pts[pts.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i], s = 1 - t;
    const b1 = 3 * t * s * s, b2 = 3 * t * t * s;
    const a1 = mul(t0, b1), a2 = mul(t1, b2);
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2);
    const tmp = sub(pts[i], add(mul(p0, s * s * s + b1), mul(p3, b2 + t * t * t)));
    x0 += dot(a1, tmp); x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al = 0, ar = 0;
  if (Math.abs(det) > 1e-12) { al = (x0 * c11 - x1 * c01) / det; ar = (c00 * x1 - c01 * x0) / det; }
  const segLen = len(sub(p3, p0));
  const eps = 1e-6 * segLen;
  if (al < eps || ar < eps) { al = ar = segLen / 3; }            // Wu/Barsky heuristic fallback
  return [p0, add(p0, mul(t0, al)), add(p3, mul(t1, ar)), p3];
}

/**
 * Least-squares cubic with only the end POINTS fixed: both handles free. For a run between two corners, where
 * nothing makes the ends smooth, this recovers a flattened cubic exactly; estimated end tangents cannot, because a
 * few coarse samples near an end give its direction only roughly.
 */
function generateFree(pts, u) {
  const p0 = pts[0], p3 = pts[pts.length - 1];
  let a11 = 0, a12 = 0, a22 = 0, r1x = 0, r1y = 0, r2x = 0, r2y = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i], s = 1 - t;
    const b0 = s * s * s, b1 = 3 * t * s * s, b2 = 3 * t * t * s, b3 = t * t * t;
    const rx = pts[i][0] - b0 * p0[0] - b3 * p3[0], ry = pts[i][1] - b0 * p0[1] - b3 * p3[1];
    a11 += b1 * b1; a12 += b1 * b2; a22 += b2 * b2;
    r1x += b1 * rx; r1y += b1 * ry; r2x += b2 * rx; r2y += b2 * ry;
  }
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-12) return null;
  const c1 = [(r1x * a22 - r2x * a12) / det, (r1y * a22 - r2y * a12) / det];
  const c2 = [(a11 * r2x - a12 * r1x) / det, (a11 * r2y - a12 * r1y) / det];
  return [p0, c1, c2, p3];
}

/** Each point's parameter moved to its foot on the curve (a few Newton steps). */
function project(bz, pts, u) {
  return u.map((t0, i) => {
    let t = t0;
    for (let k = 0; k < 4; k++) {
      const d = sub(bez(...bz, t), pts[i]);
      const d1 = bezD1(...bz, t), d2 = bezD2(...bz, t);
      const den = dot(d1, d1) + dot(d, d2);
      if (Math.abs(den) < 1e-12) break;
      t = Math.min(1, Math.max(0, t - dot(d, d1) / den));
    }
    return t;
  });
}

/** Gaussian elimination with partial pivoting for a small dense system; null when singular. */
function solveSmall(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (Math.abs(M[c][c]) < 1e-14) return null;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let v = M[r][n];
    for (let k = r + 1; k < n; k++) v -= M[r][k] * x[k];
    x[r] = v / M[r][r];
  }
  return x;
}

/**
 * Both handles refined together by damped Gauss-Newton on each point's distance along the curve normal at its foot
 * (Levenberg-Marquardt on "tangent distance"). Alternating a least-squares fit with a re-parameterisation converges
 * slowly, and on a long neckline stalls half a millimetre off; this lands on a flattened cubic's own handles in a
 * few steps.
 * @returns {{bz: any[], u: number[], worst: number}}
 */
function refineHandles(bz, pts, u, iters = 30) {
  let worst = maxError(bz, pts, u).worst;
  let lam = 1e-3;
  for (let it = 0; it < iters && worst > 1e-4; it++) {
    const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], g = [0, 0, 0, 0];
    for (let i = 1; i < pts.length - 1; i++) {
      const t = u[i], s = 1 - t;
      const b1 = 3 * t * s * s, b2 = 3 * t * t * s;
      const T = bezD1(...bz, t), L = len(T) || 1;
      const nrm = [-T[1] / L, T[0] / L];
      const r = dot(nrm, sub(bez(...bz, t), pts[i]));
      const J = [b1 * nrm[0], b1 * nrm[1], b2 * nrm[0], b2 * nrm[1]];
      for (let a = 0; a < 4; a++) { g[a] -= J[a] * r; for (let b = 0; b < 4; b++) A[a][b] += J[a] * J[b]; }
    }
    let improved = false;
    for (let tries = 0; tries < 8 && !improved; tries++) {
      const x = solveSmall(A.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lam) + 1e-9 : v))), g);
      if (!x) { lam *= 10; continue; }
      const nb = [bz[0], [bz[1][0] + x[0], bz[1][1] + x[1]], [bz[2][0] + x[2], bz[2][1] + x[3]], bz[3]];
      const nu = project(nb, pts, u);
      const nw = maxError(nb, pts, nu).worst;
      if (nw < worst) { bz = nb; u = nu; worst = nw; lam = Math.max(1e-7, lam / 10); improved = true; }
      else lam *= 10;
    }
    if (!improved) break;
  }
  return { bz, u, worst };
}

/** One Newton-Raphson step on every parameter. */
function reparam(bz, pts, u) {
  return u.map((t, i) => {
    const d = sub(bez(...bz, t), pts[i]);
    const d1 = bezD1(...bz, t), d2 = bezD2(...bz, t);
    const num = dot(d, d1), den = dot(d1, d1) + dot(d, d2);
    const nt = Math.abs(den) > 1e-12 ? t - num / den : t;
    return Math.min(1, Math.max(0, nt));
  });
}

/** Max distance from each point to the curve at its parameter; also the index of the worst. */
function maxError(bz, pts, u) {
  let worst = 0, at = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len(sub(bez(...bz, u[i]), pts[i]));
    if (d > worst) { worst = d; at = i; }
  }
  return { worst, at };
}

/**
 * Fit cubics to an open run of points (first and last are the fixed ends).
 * @param {Vec2[]} pts @param {number} tol   max deviation, same units as the points
 * @param {Vec2} [t0] unit tangent leaving the first point (estimated when omitted)
 * @param {Vec2} [t1] unit tangent ARRIVING at the last point, pointing backwards (estimated when omitted)
 * @param {number} [depth]
 * @returns {Array<[Vec2, Vec2, Vec2, Vec2]>} consecutive cubics [p0, c1, c2, p1]
 */
export function fitCubics(pts, tol, t0, t1, depth = 0) {
  const n = pts.length;
  if (n < 2) return [];
  const T0 = t0 || endTangent(pts, false);
  const T1 = t1 || endTangent(pts, true);
  if (n === 2) {
    const d = len(sub(pts[1], pts[0])) / 3;
    return [[pts[0], add(pts[0], mul(T0, d)), add(pts[1], mul(T1, d)), pts[1]]];
  }
  let u = chordParams(pts);
  // A whole run between corners (no tangent imposed from outside): try one cubic with free handles first
  let seedT0 = T0, seedT1 = T1;
  if (!t0 && !t1 && n >= 4) {
    let runLen = 0;
    for (let i = 1; i < n; i++) runLen += len(sub(pts[i], pts[i - 1]));
    // handles longer than the run itself mean a loop or a cusp, not a garment curve
    const sane = (b) => b && len(sub(b[1], b[0])) > 1e-9 && len(sub(b[2], b[3])) > 1e-9
      && len(sub(b[1], b[0])) <= runLen && len(sub(b[2], b[3])) <= runLen;
    let bf = generateFree(pts, u);
    if (sane(bf)) {
      const r = refineHandles(bf, pts, project(bf, pts, u));
      if (sane(r.bz)) {
        if (r.worst <= tol) return [r.bz];
        bf = r.bz;
      }
      // even when one cubic is not enough, its end directions beat the three-point estimate
      seedT0 = unit(sub(bf[1], bf[0])); seedT1 = unit(sub(bf[2], bf[3]));
    }
  }
  let bz = generate(pts, u, seedT0, seedT1);
  let { worst, at } = maxError(bz, pts, u);
  if (worst <= tol) return [bz];
  // refine the parameters before giving up on one cubic: a curve that WAS one cubic (another CAD's flattened
  // Bezier) fits exactly once the chord-length guess is corrected, and splitting it would add a vertex for nothing
  for (let k = 0; k < 10; k++) {
    u = reparam(bz, pts, u);
    bz = generate(pts, u, seedT0, seedT1);
    ({ worst, at } = maxError(bz, pts, u));
    if (worst <= tol) return [bz];
  }
  if (depth > 12 || n < 4) return [bz];                           // give up gracefully: best effort
  // split at the worst point with a shared tangent, so the join is smooth
  const tc = unit(sub(pts[Math.max(0, at - 1)], pts[Math.min(n - 1, at + 1)]));
  const left = fitCubics(pts.slice(0, at + 1), tol, seedT0, tc, depth + 1);
  const right = fitCubics(pts.slice(at), tol, mul(tc, -1), seedT1, depth + 1);
  return left.concat(right);
}

/**
 * Split a closed outline into turn-point-delimited runs and fit each: returns the app's {vertices, edges}.
 * A run with no interior points is a line edge. Curve runs become one or more cubic edges; each extra
 * cubic adds a vertex (a smooth join, not a corner).
 * @param {Vec2[]} ring closed outline, no repeated closing point
 * @param {boolean[]} isTurn same length: true where the vertex is a corner
 * @param {number} tol
 * @returns {{vertices: Vec2[], edges: Array<{type: 'line'} | {type: 'cubic', c1: Vec2, c2: Vec2}>}}
 */
export function ringToEdges(ring, isTurn, tol) {
  const n = ring.length;
  let first = isTurn.indexOf(true);
  if (first < 0) {
    // a fully smooth outline (a circle, a collar): start at the sharpest point and treat it as a corner
    first = 0;
  }
  /** @type {Vec2[]} */
  const vertices = [];
  /** @type {any[]} */
  const edges = [];
  let k = first;
  do {
    // collect the run from this turn point to the next one
    const run = [ring[k]];
    let j = (k + 1) % n;
    while (j !== first && !isTurn[j]) { run.push(ring[j]); j = (j + 1) % n; }
    run.push(ring[j]);
    vertices.push([ring[k][0], ring[k][1]]);
    if (run.length === 2) {
      edges.push({ type: 'line' });
    } else {
      const cubics = fitCubics(run, tol);
      for (let c = 0; c < cubics.length; c++) {
        const [p0, c1, c2] = cubics[c];
        if (c > 0) vertices.push([p0[0], p0[1]]);
        edges.push({ type: 'cubic', c1: [c1[0], c1[1]], c2: [c2[0], c2[1]] });
      }
    }
    k = j;
  } while (k !== first);
  return { vertices, edges };
}

/**
 * When a file does not mark turn and curve points, decide from the geometry: a vertex is a corner when the
 * outline turns there by more than `cornerDeg`, or when both of its segments are long (straight edges drawn
 * with few points). Everything else is a curve sample.
 * @param {Vec2[]} ring @param {number} [cornerDeg] @param {number} [longSeg] same units as the points
 * @returns {boolean[]}
 */
export function guessTurns(ring, cornerDeg = 25, longSeg = 30) {
  const n = ring.length;
  const out = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
    const d0 = sub(b, a), d1 = sub(c, b);
    const l0 = len(d0), l1 = len(d1);
    if (l0 < 1e-9 || l1 < 1e-9) continue;
    const cos = dot(d0, d1) / (l0 * l1);
    const turn = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    if (turn > cornerDeg || (l0 > longSeg && l1 > longSeg)) out[i] = true;
  }
  return out;
}
