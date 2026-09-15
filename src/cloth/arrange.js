// src/cloth/arrange.js — initial placement on the body's anchor cylinders (SPEC section 7.4) and pushOut.
//
// The wrapped end of the blend (`wrap = 1`) does NOT use the raw anchor cylinder. A cylinder of the anchor's radius is
// the body's *circumscribed* radius, so its circumference is much longer than the garment: for the sample T-shirt the
// torso anchor is 1.156 m around while front + back carry only 0.960 m of fabric, which left the two side seams
// 211–285 mm apart and the shoulder seams 347 mm apart at frame 0 — a distance the sewing ramp then had to drag the
// panels across the body, which is what kept the state from ever settling.
//
// Instead the wrapped position is arc-length-mapped onto the body's own cross-section at the vertex's height, scaled
// radially so that the scaled section's circumference equals the fabric available around that anchor at that height
// (never smaller than the body itself). Radial scaling multiplies every length by the same factor, so the fabric then
// tiles the section exactly: pattern arc length u lands at arc length u on the shell, and every seam pair whose two
// sides carry the same arc length meets. The section is measured from the SDF (the same field `pushOut` uses), so the
// shell follows the real silhouette — chest, shoulders, hips — rather than a circle.
//
// `wrap` keeps its 7.4 meaning (0 = flat in the tangent plane, 1 = fully wrapped), but the two ends are blended in the
// anchor's polar coordinates (angle, radius about the axis) rather than in Cartesian x/y/z. Cartesian blending drags
// the wrapped point back toward the tangent plane along a chord, which re-opens exactly the seams the wrap closed
// (at wrap = 0.8 it gave the sample T-shirt back ~50 mm of side-seam gap); polar blending keeps the angular position
// of the wrap and only relaxes how tightly the piece hugs the body. At wrap = 0 the result is exactly `P_p` and at
// wrap = 1 exactly the wrapped point, so the endpoints of 7.4 are unchanged.

import { sampleSdf } from '../core/sdf.js';
import { getAux, commitPositions, clothError } from './state.js';

/** @typedef {import('../core/types.js').ClothState} ClothState */
/** @typedef {import('../core/types.js').BodyModel} BodyModel */
/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */
/** @typedef {import('../core/types.js').SdfGrid} SdfGrid */
/** @typedef {import('../core/types.js').Placement} Placement */

/** θ_side: front 0, left +π/2, back π, right −π/2. */
const SIDE_THETA = { front: 0, left: Math.PI / 2, back: Math.PI, right: -Math.PI / 2 };

/** Angular samples of a body cross-section (2.8° apart). */
const PROFILE_ANGLES = 128;
/** Height samples along an anchor axis over the pieces' own extent. */
const PROFILE_ROWS = 48;
/** Coarse step (m) of the outward ray march that finds a cross-section's surface. */
const PROFILE_MARCH = 0.004;
/** Bisection steps that refine the bracket the march found (4 mm / 2^8 ≈ 16 µm). */
const PROFILE_BISECT = 8;
/** Ray march ceiling as a multiple of the anchor radius. */
const PROFILE_RMAX = 2.2;
/** Half-width of the box filter that smooths the per-row ease factor. */
const EASE_SMOOTH = 2;
/** Ease factor ceiling: a row may not be blown up by more than this (a very flared hem stays near the body). */
const EASE_MAX = 2.0;

/** @returns {Placement} */
function defaultPlacement() {
  return { anchor: 'torso', side: 'front', offset_mm: [0, 0], wrap: 0.8, flip: false };
}

/**
 * @typedef {Object} PiecePlan
 * @property {number} k              index into state.pieces
 * @property {string} anchorName
 * @property {*} A                   the resolved Anchor
 * @property {number} theta          θ_side
 * @property {number} wrap
 * @property {number} R              tangent-plane radius = A.radius + 0.02·layer
 * @property {number} layerOff       0.02·layer
 * @property {Float64Array} u        m along the circumference, per local vertex (7.4)
 * @property {Float64Array} t        m down the axis, per local vertex (7.4)
 */

/**
 * A body cross-section stack around one anchor axis: radius and cumulative arc length per (row, angle).
 * @typedef {Object} WrapProfile
 * @property {number} rows @property {number} tMin @property {number} tStep
 * @property {Float64Array} r        rows × PROFILE_ANGLES, metres from the axis
 * @property {Float64Array} s        rows × (PROFILE_ANGLES + 1), cumulative arc from θ = 0
 * @property {Float64Array} ease     rows, radial scale ≥ 1 that makes the section as long as the fabric
 */

/**
 * Radius from the axis to the FIRST surface crossing along `dir(θ_a)` at one height: a coarse outward march from the
 * axis, then bisection inside the bracket it found. A march (not a plain bisection of [0, rMax]) is what makes this
 * correct where the field is not monotonic along the ray — at waist height the ray toward the model's side leaves the
 * torso and then re-enters the hanging arm, and a bisection happily returns the arm's OUTER surface, which inflated
 * the sample skirt's waist section from 0.72 m to 1.83 m around.
 * Returns −1 when the axis itself is already outside the body (no section to wrap around at this height).
 * @param {SdfGrid} sdf @returns {number}
 */
function surfaceRadius(sdf, ox, oy, oz, dx, dy, dz, rMax, c) {
  if (sampleSdf(sdf, ox, oy, oz, null) >= c) return -1;
  let lo = 0;
  let hi = -1;
  for (let r = PROFILE_MARCH; r <= rMax; r += PROFILE_MARCH) {
    if (sampleSdf(sdf, ox + r * dx, oy + r * dy, oz + r * dz, null) >= c) { hi = r; break; }
    lo = r;
  }
  if (hi < 0) return rMax;
  for (let it = 0; it < PROFILE_BISECT; it++) {
    const m = 0.5 * (lo + hi);
    if (sampleSdf(sdf, ox + m * dx, oy + m * dy, oz + m * dz, null) < c) lo = m; else hi = m;
  }
  return 0.5 * (lo + hi);
}

/**
 * Sample the body's cross-sections around one anchor over [tMin, tMax] and accumulate their arc length.
 * Rows whose axis point lies outside the body (above the shoulders, below the crotch) copy the nearest valid row;
 * with no valid row anywhere — or with no SDF — the profile degenerates to the anchor cylinder, i.e. exactly 7.4.
 * @param {*} A @param {SdfGrid|null} sdf @param {number} tMin @param {number} tMax @param {number} c
 * @param {number[]} f @param {number[]} sVec
 * @returns {WrapProfile}
 */
function buildProfile(A, sdf, tMin, tMax, c, f, sVec) {
  const rows = PROFILE_ROWS;
  const ang = PROFILE_ANGLES;
  const tStep = rows > 1 ? (tMax - tMin) / (rows - 1) : 1;
  const r = new Float64Array(rows * ang);
  const s = new Float64Array(rows * (ang + 1));
  const ease = new Float64Array(rows).fill(1);
  const valid = new Uint8Array(rows);
  const rMax = PROFILE_RMAX * A.radius;
  const dTheta = (2 * Math.PI) / ang;
  for (let row = 0; row < rows; row++) {
    const t = tMin + tStep * row;
    const ox = A.origin[0] + t * A.axis[0];
    const oy = A.origin[1] + t * A.axis[1];
    const oz = A.origin[2] + t * A.axis[2];
    let ok = sdf !== null;
    for (let a = 0; a < ang; a++) {
      let rad = A.radius;
      if (sdf) {
        const th = dTheta * a;
        const ct = Math.cos(th);
        const st = Math.sin(th);
        rad = surfaceRadius(sdf, ox, oy, oz,
          ct * f[0] + st * sVec[0], ct * f[1] + st * sVec[1], ct * f[2] + st * sVec[2], rMax, c);
        if (rad < 0) { ok = false; rad = A.radius; }
      }
      r[row * ang + a] = rad < 0.01 ? 0.01 : rad;
    }
    valid[row] = ok ? 1 : 0;
  }
  // Fill invalid rows from the nearest valid one (keeps the shell continuous past the end of the torso).
  let anyValid = 0;
  for (let row = 0; row < rows; row++) anyValid += valid[row];
  if (anyValid === 0) {
    for (let i = 0; i < r.length; i++) r[i] = A.radius;
  } else {
    let last = -1;
    for (let row = 0; row < rows; row++) {
      if (valid[row]) { last = row; } else if (last >= 0) { r.copyWithin(row * ang, last * ang, last * ang + ang); valid[row] = 2; }
    }
    let nextV = -1;
    for (let row = rows - 1; row >= 0; row--) {
      if (valid[row]) { nextV = row; } else if (nextV >= 0) { r.copyWithin(row * ang, nextV * ang, nextV * ang + ang); valid[row] = 2; }
    }
  }
  // Cumulative arc length per row (chord lengths between successive samples).
  for (let row = 0; row < rows; row++) {
    const ro = row * ang;
    const so = row * (ang + 1);
    let acc = 0;
    s[so] = 0;
    for (let a = 0; a < ang; a++) {
      const r0 = r[ro + a];
      const r1 = r[ro + ((a + 1) % ang)];
      acc += Math.sqrt(r0 * r0 + r1 * r1 - 2 * r0 * r1 * Math.cos(dTheta));
      s[so + a + 1] = acc;
    }
  }
  return { rows, tMin, tStep, r, s, ease };
}

/**
 * Invert the arc-length table of one row: arc `q` (any real, measured from θ = 0) → angle and radius.
 * Writes [angle, radius] into `out`.
 * @param {WrapProfile} P @param {number} row @param {number} q @param {Float64Array} out
 */
function angleAtArc(P, row, q, out) {
  const ang = PROFILE_ANGLES;
  const so = row * (ang + 1);
  const per = P.s[so + ang];
  const turns = Math.floor(q / per);
  let q0 = q - turns * per;
  if (q0 < 0) q0 = 0;
  let lo = 0;
  let hi = ang;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (P.s[so + m] <= q0) lo = m; else hi = m;
  }
  const seg = P.s[so + lo + 1] - P.s[so + lo];
  const fr = seg > 1e-12 ? (q0 - P.s[so + lo]) / seg : 0;
  const dTheta = (2 * Math.PI) / ang;
  out[0] = dTheta * (lo + fr) + turns * 2 * Math.PI;
  const r0 = P.r[row * ang + lo];
  const r1 = P.r[row * ang + ((lo + 1) % ang)];
  out[1] = r0 + (r1 - r0) * fr;
}

/**
 * Writes pos/prev/restPos/pTarget, zeroes vel, time = frame = 0, sRest0/sStart (7.4 mapping with the body-fitting
 * wrapped end described at the top of this file), then pushOut.
 * @param {ClothState} state @param {BodyModel} body @param {ProjectDoc} doc
 */
export function arrange(state, body, doc) {
  getAux(state);
  if (!body || !body.anchors) throw clothError('body', 'arrange: body has no anchors');
  const pos = state.pos;
  const sdf = body.sdf || null;
  const docPieces = (doc && Array.isArray(doc.pieces)) ? doc.pieces : [];

  // ---- pass 1: resolve every placement and the (u, t) pattern coordinates of every vertex.
  /** @type {PiecePlan[]} */
  const plans = [];
  for (let k = 0; k < state.pieces.length; k++) {
    const pc = state.pieces[k];
    const piece = docPieces.find((p) => p.id === pc.pieceId);
    const pl = Object.assign(defaultPlacement(), (piece && piece.placement) || {});
    const A = body.anchors[pl.anchor] || body.anchors.torso;
    if (!A) throw clothError('anchor', 'arrange: no anchor ' + pl.anchor + ' (and no torso fallback)', { pieceId: pc.pieceId });
    const off = Array.isArray(pl.offset_mm) ? pl.offset_mm : [0, 0];
    const offX = Number.isFinite(off[0]) ? off[0] : 0;
    const offY = Number.isFinite(off[1]) ? off[1] : 0;
    const flip = pl.flip ? -1 : 1;
    const p2 = pc.mesh.positions2d;
    let minX = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (let v = 0; v < pc.count; v++) {
      const x = p2[2 * v];
      const y = p2[2 * v + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const cx = (minX + maxX) / 2;
    const u = new Float64Array(pc.count);
    const t = new Float64Array(pc.count);
    for (let v = 0; v < pc.count; v++) {
      u[v] = (flip * (p2[2 * v] - cx) + offX) / 1000;
      t[v] = (maxY - p2[2 * v + 1] - offY) / 1000;
    }
    plans.push({
      k, anchorName: (body.anchors[pl.anchor] ? pl.anchor : 'torso'), A,
      theta: SIDE_THETA[pl.side] !== undefined ? SIDE_THETA[pl.side] : 0,
      wrap: Math.max(0, Math.min(1, Number.isFinite(pl.wrap) ? pl.wrap : 0.8)),
      R: A.radius + 0.02 * pc.layer, layerOff: 0.02 * pc.layer, u, t,
    });
  }

  // ---- pass 2: one cross-section profile per anchor, over the combined height range of its pieces.
  /** @type {Map<string, WrapProfile>} */
  const profiles = new Map();
  const scratch = new Float64Array(2);
  for (const plan of plans) {
    if (profiles.has(plan.anchorName)) continue;
    const group = plans.filter((q) => q.anchorName === plan.anchorName);
    let tMin = Infinity;
    let tMax = -Infinity;
    let c = 0;
    for (const q of group) {
      for (let v = 0; v < q.t.length; v++) {
        if (q.t[v] < tMin) tMin = q.t[v];
        if (q.t[v] > tMax) tMax = q.t[v];
      }
      const pc = state.pieces[q.k];
      for (let v = 0; v < pc.count; v++) if (state.clearance[pc.start + v] > c) c = state.clearance[pc.start + v];
    }
    if (!(tMax > tMin)) tMax = tMin + 1e-3;
    const A = plan.A;
    const f = [A.front[0], A.front[1], A.front[2]];
    const sv = [
      A.front[1] * A.axis[2] - A.front[2] * A.axis[1],
      A.front[2] * A.axis[0] - A.front[0] * A.axis[2],
      A.front[0] * A.axis[1] - A.front[1] * A.axis[0],
    ];
    const P = buildProfile(A, sdf, tMin, tMax, c, f, sv);

    // ---- pass 3: fabric available around this anchor per row → radial ease factor.
    const rows = P.rows;
    const fab = new Float64Array(rows);
    for (const q of group) {
      const lo = new Float64Array(rows).fill(Infinity);
      const hi = new Float64Array(rows).fill(-Infinity);
      for (let v = 0; v < q.t.length; v++) {
        let row = P.tStep > 0 ? Math.round((q.t[v] - P.tMin) / P.tStep) : 0;
        if (row < 0) row = 0;
        if (row > rows - 1) row = rows - 1;
        if (q.u[v] < lo[row]) lo[row] = q.u[v];
        if (q.u[v] > hi[row]) hi[row] = q.u[v];
      }
      for (let row = 0; row < rows; row++) if (hi[row] > lo[row]) fab[row] += hi[row] - lo[row];
    }
    for (let row = 0; row < rows; row++) {
      let sum = 0;
      let n = 0;
      for (let d = -EASE_SMOOTH; d <= EASE_SMOOTH; d++) {
        const rr = row + d;
        if (rr < 0 || rr > rows - 1 || fab[rr] <= 0) continue;
        const per = P.s[rr * (PROFILE_ANGLES + 1) + PROFILE_ANGLES];
        if (per > 1e-9) { sum += fab[rr] / per; n++; }
      }
      let e = n > 0 ? sum / n : 1;
      if (!(e > 1)) e = 1;
      if (e > EASE_MAX) e = EASE_MAX;
      P.ease[row] = e;
    }
    profiles.set(plan.anchorName, P);
  }

  // ---- pass 4: place every vertex.
  for (const plan of plans) {
    const pc = state.pieces[plan.k];
    const A = plan.A;
    const P = /** @type {WrapProfile} */ (profiles.get(plan.anchorName));
    const fx = A.front[0]; const fy = A.front[1]; const fz = A.front[2];
    const ax = A.axis[0]; const ay = A.axis[1]; const az = A.axis[2];
    const sx = fy * az - fz * ay;
    const sy = fz * ax - fx * az;
    const sz = fx * ay - fy * ax;
    const theta = plan.theta;
    const wrap = plan.wrap;
    const R = plan.R;
    const rows = P.rows;
    for (let v = 0; v < pc.count; v++) {
      const u = plan.u[v];
      const t = plan.t[v];
      // wrapped end: arc-length mapping on the two neighbouring cross-sections, then lerp.
      let rf = P.tStep > 0 ? (t - P.tMin) / P.tStep : 0;
      if (rf < 0) rf = 0;
      if (rf > rows - 1) rf = rows - 1;
      let r0 = Math.floor(rf);
      if (r0 > rows - 2) r0 = Math.max(0, rows - 2);
      const r1 = Math.min(rows - 1, r0 + 1);
      const fr = rf - r0;
      let phiW = 0;
      let radW = 0;
      let radBody = 0;
      for (let pass = 0; pass < 2; pass++) {
        const row = pass === 0 ? r0 : r1;
        const wgt = pass === 0 ? 1 - fr : fr;
        if (wgt === 0) continue;
        const e = P.ease[row];
        // θ_side's own arc coordinate on this section, plus the vertex's arc offset u (the ease scale multiplies
        // every arc length on the section, so u is divided by it before the lookup and the radius scaled after).
        const qSide = arcOfAngle(P, row, theta);
        angleAtArc(P, row, qSide + u / e, scratch);
        phiW += wgt * (scratch[0] - theta);
        radW += wgt * (e * scratch[1] + plan.layerOff);
        radBody += wgt * (scratch[1] + plan.layerOff);
      }
      // A pinned vertex is placed on the body surface itself, at the SAME angle the wrap gives it and with the ease
      // scale removed, whatever `wrap` says: its arranged position becomes a pin target (7.4), and a target that is
      // not already on the surface is moved there by `commitPositions`' three Newton steps along the SDF gradient —
      // which, applied to each vertex separately, destroys the spacing of the ring. On the sample skirt that turned a
      // waist ring arranged at −1 % strain into 90 % on two of its edges, permanently, because an edge between two
      // pinned vertices has Σw = 0 and no constraint can ever repair it. Dropping the ease at the same angle keeps
      // the ring uniform: every arc on it shrinks by the same factor, so the row simply gathers.
      const pinned = state.invMass[pc.start + v] === 0;
      // flat end: exactly P_p of 7.4 in polar form.
      const phiP = Math.atan2(u, R);
      const radP = Math.sqrt(R * R + u * u);
      const phi = theta + (pinned ? phiW : wrap * phiW + (1 - wrap) * phiP);
      const rad = pinned ? radBody : wrap * radW + (1 - wrap) * radP;
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      const g = 3 * (pc.start + v);
      pos[g] = A.origin[0] + t * ax + rad * (c * fx + s * sx);
      pos[g + 1] = A.origin[1] + t * ay + rad * (c * fy + s * sy);
      pos[g + 2] = A.origin[2] + t * az + rad * (c * fz + s * sz);
    }
  }

  if (sdf) pushOut(state, sdf);
  commitPositions(state, sdf);
}

/**
 * Arc length from θ = 0 to angle `th` (any real) on row `row`.
 * @param {WrapProfile} P @param {number} row @param {number} th @returns {number}
 */
function arcOfAngle(P, row, th) {
  const ang = PROFILE_ANGLES;
  const so = row * (ang + 1);
  const per = P.s[so + ang];
  const turns = Math.floor(th / (2 * Math.PI));
  const th0 = th - turns * 2 * Math.PI;
  const x = (th0 * ang) / (2 * Math.PI);
  let i = Math.floor(x);
  if (i > ang - 1) i = ang - 1;
  const fr = x - i;
  return P.s[so + i] + (P.s[so + i + 1] - P.s[so + i]) * fr + turns * per;
}

/**
 * Every vertex with d < clearance is moved to d = clearance along the gradient (≤ 3 passes).
 * @param {ClothState} state @param {SdfGrid} sdf
 */
export function pushOut(state, sdf) {
  const aux = getAux(state);
  const grad = aux.grad;
  const { V, pos, clearance, dCache } = state;
  for (let pass = 0; pass < 3; pass++) {
    let moved = 0;
    for (let v = 0; v < V; v++) {
      const v3 = 3 * v;
      const d = sampleSdf(sdf, pos[v3], pos[v3 + 1], pos[v3 + 2], grad);
      const c = clearance[v];
      if (d < c) {
        const corr = c - d;
        pos[v3] += corr * grad[0];
        pos[v3 + 1] += corr * grad[1];
        pos[v3 + 2] += corr * grad[2];
        moved++;
      }
      dCache[v] = d < c ? c : d;
    }
    if (moved === 0) break;
  }
}
