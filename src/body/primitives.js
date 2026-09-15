// src/body/primitives.js — distance primitives (Quilez), smin, and the analytic body closure (SPEC 6.3). Pure; metres.

import { buildSkeleton } from './skeleton.js';
import { buildRings, makeLoft } from './loft.js';

/** @typedef {import('../core/types.js').BodyParams} BodyParams */
/** @typedef {import('../core/types.js').Vec3} Vec3 */
/** @typedef {import('./skeleton.js').Skeleton} Skeleton */
/** @typedef {import('./loft.js').Ring} Ring */
/** @typedef {import('./loft.js').Loft} Loft */

/**
 * One body primitive. Geometry fields depend on kind:
 *  - 'sphere':    c, r
 *  - 'ellipsoid': c, radii [rx, ry, rz], frame (row-major 3x3 world->local rotation, identity when null)
 *  - 'roundCone': a, r1, b, r2   (a capsule is r1 === r2)
 * c/R is the bounding sphere; blend is 'smin' or 'min' (SPEC 6.3 evaluation order).
 * @typedef {Object} Primitive
 * @property {string} name
 * @property {'sphere'|'ellipsoid'|'roundCone'} kind
 * @property {'smin'|'min'} blend
 * @property {number} k          smooth-min radius used when blend === 'smin'
 * @property {Vec3} c
 * @property {number} R
 * @property {number} [r]
 * @property {Vec3} [radii]
 * @property {Float64Array|null} [frame]
 * @property {Vec3} [a]
 * @property {Vec3} [b]
 * @property {number} [r1]
 * @property {number} [r2]
 * @property {(x:number, y:number, z:number) => number} sd
 */

export const SMIN_K = 0.04;
/**
 * Blend radius for the primitives that stick OUT of the torso and therefore bound a narrow slot against it
 * (shoulder spheres, upper arms, thighs). SPEC 6.3 gives one k = 0.04 for every blend, but 40 mm of smooth-min
 * fills the armpit: at the A-pose the arm-to-torso gap is only ~65 mm, so a 40 mm blend eats half the clearance a
 * sleeve needs (6.9 case 4) and smears the field's medial ridge over three cells (6.9 case 5). 12 mm still rounds
 * the deltoid/hip junctions but leaves the slot open. Interior fills (pelvis, breasts, buttocks, neck, head) keep
 * the full 40 mm: their blends are inside the body, where nothing is sampled by cloth or by the gradient test.
 */
export const SMIN_K_LIMB = 0.012;
/**
 * Primitive placement constants tuned by A3 (SPEC 6.3 table values are the starting points): the buttock ellipsoids
 * are scaled and inset so that the measured hip circumference lands within tolerance (see Implementation notes);
 * the shoulder sphere is shrunk so that it does not reach down into the armpit slot.
 *
 * `kLimb` / `kPelvis` / `kSoft` are the per-primitive smooth-min radii (SPEC 6.3 uses one k = 0.04 everywhere).
 * Anything that helps form the OUTER surface of a narrow slot — shoulder spheres, upper arms, thighs, and the
 * pelvis fill, which is what the crotch is made of — takes a small radius; the purely interior fills keep 0.04.
 */
export const PRIM_TUNING = Object.freeze({
  buttockScale: 0.85,     // multiplies the [0.090, 0.080, 0.060] radii
  buttockInset: 0.045,    // centre z = cz_hip - b_hip + inset
  buttockX: 0.080,        // centre x = buttockX * (hips_cm / 96)
  buttockDrop: 0.02,      // centre y = hip - buttockDrop
  shoulderRadius: 0.055,  // sphere radius = shoulderRadius * s * sqrt(shoulderWidth_cm / 38)   (SPEC 6.3)
  kLimb: SMIN_K_LIMB,     // shoulders, upper arms, thighs
  kPelvis: 0.016,         // pelvis fill (forms the crotch)
  kSoft: SMIN_K,          // breasts, buttocks, neck, head — all interior blends
});
/** Nodes farther than this (metres) from every bounding sphere take the cheapest lower bound (SPEC 6.4). */
export const FAR_DISTANCE = 0.10;

/** @param {Vec3} p @param {Vec3} c @param {number} r @returns {number} */
export function sdSphere(p, c, r) {
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  const dz = p[2] - c[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

/**
 * EXACT signed distance to an axis-aligned ellipsoid (negative inside).
 *
 * SPEC 6.3 quotes Quilez's cheap bound `k0 (k0 - 1) / k1`. That bound is fine for near-spherical blobs but it is a
 * large under-estimate for flat ones (the hands are 0.045 x 0.09 x 0.02): its gradient magnitude drops to ~0.7, so
 * the baked field fails the `|grad|` step test of 6.9 case 5 around the hands. `ellipsoidLocal` therefore solves for
 * the true foot point instead, which costs a handful of Newton steps and keeps |grad d| = 1 everywhere.
 *
 * The foot point of p on the ellipsoid is `q_i = r_i^2 p_i / (t + r_i^2)` for the unique root of
 * `F(t) = sum (r_i p_i / (t + r_i^2))^2 = 1`; F is convex and strictly decreasing on `t > -min(r_i^2)`, so a
 * Newton iteration with a bisection safeguard on a bracketing interval converges unconditionally.
 * `p_i - q_i = p_i t / (t + r_i^2)`, hence the distance without ever forming q.
 *
 * @param {Vec3} p @param {Vec3} c @param {Vec3} r @returns {number}
 */
export function sdEllipsoid(p, c, r) {
  return ellipsoidLocal(p[0] - c[0], p[1] - c[1], p[2] - c[2], r[0], r[1], r[2]);
}

/** Newton + bisection steps for the foot-point solve; 4-6 are typical, the cap is only a guard. */
const ELLIPSOID_ITERS = 24;
/** Coordinates are lifted off the symmetry planes by this fraction of the radius so F(t) keeps its pole. */
const ELLIPSOID_TINY = 1e-7;

/** @param {number} x @param {number} y @param {number} z @param {number} rx @param {number} ry @param {number} rz @returns {number} */
function ellipsoidLocal(x, y, z, rx, ry, rz) {
  // Mirror into the positive octant (the ellipsoid is symmetric in all three planes).
  let px = x < 0 ? -x : x;
  let py = y < 0 ? -y : y;
  let pz = z < 0 ? -z : z;
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const rz2 = rz * rz;
  const qx = px / rx;
  const qy = py / ry;
  const qz = pz / rz;
  const k0sq = qx * qx + qy * qy + qz * qz;
  if (k0sq < 1e-24) return -Math.min(rx, ry, rz);  // dead centre
  const outside = k0sq > 1;
  // Keep every coordinate strictly positive: F(t) then has a pole at -min(r^2) and exactly one root in the bracket.
  const mx = ELLIPSOID_TINY * rx;
  const my = ELLIPSOID_TINY * ry;
  const mz = ELLIPSOID_TINY * rz;
  if (px < mx) px = mx;
  if (py < my) py = my;
  if (pz < mz) pz = mz;
  const ex = rx * px;
  const ey = ry * py;
  const ez = rz * pz;
  let lo;
  let hi;
  if (outside) {
    lo = 0;
    hi = Math.max(rx, ry, rz) * Math.sqrt(px * px + py * py + pz * pz);  // F(hi) <= 1
  } else {
    lo = -Math.min(rx2, ry2, rz2) * (1 - 1e-9);                          // F(lo) >> 1
    hi = 0;
  }
  let t = outside ? 0 : 0.5 * (lo + hi);
  for (let i = 0; i < ELLIPSOID_ITERS; i++) {
    const ax = t + rx2;
    const ay = t + ry2;
    const az = t + rz2;
    const fx = ex / ax;
    const fy = ey / ay;
    const fz = ez / az;
    const f = fx * fx + fy * fy + fz * fz - 1;
    if (f > 0) lo = t; else hi = t;
    const df = -2 * (fx * fx / ax + fy * fy / ay + fz * fz / az);
    let tn = df < 0 ? t - f / df : 0.5 * (lo + hi);
    if (!(tn > lo && tn < hi)) tn = 0.5 * (lo + hi);
    if (Math.abs(tn - t) <= 1e-15) { t = tn; break; }
    t = tn;
  }
  const dx = px * t / (t + rx2);
  const dy = py * t / (t + ry2);
  const dz = pz * t / (t + rz2);
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return outside ? dist : -dist;
}

/**
 * Exact round cone between centre a (radius r1) and centre b (radius r2) (Quilez sdRoundCone).
 * @param {Vec3} p @param {Vec3} a @param {Vec3} b @param {number} r1 @param {number} r2 @returns {number}
 */
export function sdRoundCone(p, a, b, r1, r2) {
  return roundConeLocal(p[0], p[1], p[2], a, b, r1, r2);
}

/**
 * @param {number} px @param {number} py @param {number} pz @param {Vec3} a @param {Vec3} b @param {number} r1 @param {number} r2
 * @returns {number}
 */
function roundConeLocal(px, py, pz, a, b, r1, r2) {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const pax = px - a[0];
  const pay = py - a[1];
  const paz = pz - a[2];
  if (a2 <= 1e-12 || l2 < 1e-12) {
    // One sphere contains the other: the union is the bigger sphere (guard, not reached with sane parameters).
    const da = Math.sqrt(pax * pax + pay * pay + paz * paz) - r1;
    const dbx = px - b[0];
    const dby = py - b[1];
    const dbz = pz - b[2];
    const db = Math.sqrt(dbx * dbx + dby * dby + dbz * dbz) - r2;
    return da < db ? da : db;
  }
  const il2 = 1 / l2;
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const wx = pax * l2 - bax * y;
  const wy = pay * l2 - bay * y;
  const wz = paz * l2 - baz * y;
  const x2 = wx * wx + wy * wy + wz * wz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = (rr < 0 ? -1 : rr > 0 ? 1 : 0) * rr * rr * x2;
  if ((z < 0 ? -1 : z > 0 ? 1 : 0) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if ((y < 0 ? -1 : y > 0 ? 1 : 0) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

/**
 * Polynomial smooth minimum: min(a, b) - h^2 k / 4, h = max(k - |a - b|, 0) / k.
 * @param {number} a @param {number} b @param {number} k @returns {number}
 */
export function smin(a, b, k) {
  const diff = a - b;
  let h = k - (diff < 0 ? -diff : diff);
  if (h <= 0) return a < b ? a : b;
  h /= k;
  return (a < b ? a : b) - h * h * k * 0.25;
}

/** @param {number} x @param {number} y @param {number} z @returns {Vec3} */
function norm3(x, y, z) {
  const l = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / l, y / l, z / l];
}

/** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Row-major world->local rotation whose local y axis is `axis` and whose local z axis is as close as possible to world +z.
 * @param {Vec3} axis @returns {Float64Array}
 */
export function frameAlong(axis) {
  const ey = norm3(axis[0], axis[1], axis[2]);
  let zx = 0 - ey[2] * ey[0];
  let zy = 0 - ey[2] * ey[1];
  let zz = 1 - ey[2] * ey[2];
  let ez = norm3(zx, zy, zz);
  if (Math.abs(zx) + Math.abs(zy) + Math.abs(zz) < 1e-9) ez = norm3(1 - ey[0] * ey[0], -ey[0] * ey[1], -ey[0] * ey[2]);
  const ex = cross(ey, ez);
  // rows = local axes: local = M * (p - c)
  return new Float64Array([ex[0], ex[1], ex[2], ey[0], ey[1], ey[2], ez[0], ez[1], ez[2]]);
}

/**
 * @param {string} name @param {'smin'|'min'} blend @param {Vec3} c @param {number} r @param {number} [k] @returns {Primitive}
 */
function sphere(name, blend, c, r, k = SMIN_K) {
  const cx = c[0];
  const cy = c[1];
  const cz = c[2];
  return {
    name, kind: 'sphere', blend, k, c: [cx, cy, cz], R: r, r,
    sd(x, y, z) {
      const dx = x - cx;
      const dy = y - cy;
      const dz = z - cz;
      return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
    },
  };
}

/**
 * @param {string} name @param {'smin'|'min'} blend @param {Vec3} c @param {Vec3} radii @param {Float64Array|null} frame
 * @param {number} [k]
 * @returns {Primitive}
 */
function ellipsoid(name, blend, c, radii, frame, k = SMIN_K) {
  const cx = c[0];
  const cy = c[1];
  const cz = c[2];
  const rx = Math.max(radii[0], 1e-4);
  const ry = Math.max(radii[1], 1e-4);
  const rz = Math.max(radii[2], 1e-4);
  const R = Math.max(rx, ry, rz);
  const m = frame;
  return {
    name, kind: 'ellipsoid', blend, k, c: [cx, cy, cz], R, radii: [rx, ry, rz], frame: m,
    sd: m
      ? function sdRot(x, y, z) {
        const px = x - cx;
        const py = y - cy;
        const pz = z - cz;
        const lx = m[0] * px + m[1] * py + m[2] * pz;
        const ly = m[3] * px + m[4] * py + m[5] * pz;
        const lz = m[6] * px + m[7] * py + m[8] * pz;
        return ellipsoidLocal(lx, ly, lz, rx, ry, rz);
      }
      : function sdAxis(x, y, z) {
        return ellipsoidLocal(x - cx, y - cy, z - cz, rx, ry, rz);
      },
  };
}

/**
 * @param {string} name @param {'smin'|'min'} blend @param {Vec3} a @param {number} r1 @param {Vec3} b @param {number} r2
 * @param {number} [k]
 * @returns {Primitive}
 */
function roundCone(name, blend, a, r1, b, r2, k = SMIN_K) {
  const A = [a[0], a[1], a[2]];
  const B = [b[0], b[1], b[2]];
  const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const half = Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2) / 2;
  const R = half + Math.max(r1, r2);
  return {
    name, kind: 'roundCone', blend, k, c, R, a: A, b: B, r1, r2,
    sd(x, y, z) { return roundConeLocal(x, y, z, A, B, r1, r2); },
  };
}

/**
 * @typedef {Object} AnalyticBody
 * @property {(x:number, y:number, z:number) => number} sd      full body field (with the bounding-sphere cull and the far lower bound)
 * @property {(x:number, y:number, z:number) => number} sdExact same, without the far lower bound
 * @property {Primitive[]} prims
 * @property {Skeleton} skeleton
 * @property {Record<string, Ring>} rings
 * @property {Loft} loft
 * @property {{min: Vec3, max: Vec3}} aabb   union of the bounding spheres (unpadded)
 * @property {BodyParams} params
 */

/**
 * Build the analytic body once per buildBody: skeleton, rings, primitives and the sd closure.
 * @param {BodyParams} params  clamped
 * @param {object} [tuning]  RING_TUNING overrides (tuning scripts only)
 * @returns {AnalyticBody}
 */
export function analyticBody(params, tuning) {
  const sk = buildSkeleton(params, tuning);
  const rings = buildRings(sk, params, tuning);
  const loft = makeLoft(rings);
  const { y, s, m, joints: J, dirs } = sk;
  const TWO_PI = 2 * Math.PI;

  const pt = tuning ? { ...PRIM_TUNING, ...tuning } : PRIM_TUNING;
  /** @type {Primitive[]} */
  const prims = [];
  // 1 head
  prims.push(ellipsoid('head', 'smin', [0, y.chin + m.headH / 2, 0.01], [0.34 * m.headH, 0.5 * m.headH, 0.41 * m.headH], null, pt.kSoft));
  // 2 neck
  prims.push(roundCone('neck', 'smin', [0, y.shoulder + 0.01, 0], m.neck / TWO_PI * 1.05, [0, y.chin - 0.005, 0.015], m.neck / TWO_PI, pt.kSoft));
  // 3-4 shoulders (small blend radius: these bound the armpit slot)
  const rSh = pt.shoulderRadius * s * Math.sqrt(params.shoulderWidth_cm / 38);
  prims.push(sphere('shoulderL', 'smin', J.shoulderL, rSh, pt.kLimb));
  prims.push(sphere('shoulderR', 'smin', J.shoulderR, rSh, pt.kLimb));
  // 5-6 breasts
  const rc = rings.chest;
  const bf = 0.5 + m.bust;
  const bx = 0.085 * (params.chest_cm / 88);
  const bz = rc.cz + rc.b - 0.025;
  prims.push(ellipsoid('breastL', 'smin', [bx, y.chest + 0.01, bz], [0.070 * bf, 0.060 * bf, 0.045 * bf], null, pt.kSoft));
  prims.push(ellipsoid('breastR', 'smin', [-bx, y.chest + 0.01, bz], [0.070 * bf, 0.060 * bf, 0.045 * bf], null, pt.kSoft));
  // 7-8 buttocks
  const rh = rings.hip;
  const hf = params.hips_cm / 96;
  const gx = pt.buttockX * hf;
  const gz = rh.cz - rh.b + pt.buttockInset;
  const gs = pt.buttockScale * hf;
  prims.push(ellipsoid('buttockL', 'smin', [gx, y.hip - pt.buttockDrop, gz], [0.090 * gs, 0.080 * gs, 0.060 * gs], null, pt.kSoft));
  prims.push(ellipsoid('buttockR', 'smin', [-gx, y.hip - pt.buttockDrop, gz], [0.090 * gs, 0.080 * gs, 0.060 * gs], null, pt.kSoft));
  // 9 pelvis fill
  prims.push(ellipsoid('pelvis', 'smin', [0, y.crotch + 0.06, 0], [J.hipJointL[0] + 0.03, 0.09, 0.85 * rh.b], null, pt.kPelvis));
  // 10-11 upper arms, 12-13 forearms
  const rUA = m.upperArm / TWO_PI;
  const rEl = (m.upperArm + m.forearm) / 2 / TWO_PI;
  const rFA = m.forearm / TWO_PI;
  const rWr = m.wrist / TWO_PI;
  prims.push(roundCone('upperArmL', 'smin', J.shoulderL, rUA, J.elbowL, rEl, pt.kLimb));
  prims.push(roundCone('upperArmR', 'smin', J.shoulderR, rUA, J.elbowR, rEl, pt.kLimb));
  prims.push(roundCone('forearmL', 'min', J.elbowL, rFA, J.wristL, rWr));
  prims.push(roundCone('forearmR', 'min', J.elbowR, rFA, J.wristR, rWr));
  // 14-15 hands
  prims.push(ellipsoid('handL', 'min', J.handL, [0.045 * s, 0.09 * s, 0.02 * s], frameAlong(dirs.dFAL)));
  prims.push(ellipsoid('handR', 'min', J.handR, [0.045 * s, 0.09 * s, 0.02 * s], frameAlong(dirs.dFAR)));
  // 16-17 thighs, 18-19 shanks
  const rTh = m.thigh / TWO_PI;
  const rKn = (m.thigh + m.calf) / 2 / TWO_PI;
  const rCa = m.calf / TWO_PI;
  const rAn = m.ankle / TWO_PI;
  prims.push(roundCone('thighL', 'smin', J.hipJointL, rTh, J.kneeL, rKn, pt.kLimb));
  prims.push(roundCone('thighR', 'smin', J.hipJointR, rTh, J.kneeR, rKn, pt.kLimb));
  prims.push(roundCone('shankL', 'min', J.kneeL, rCa, J.ankleL, rAn));
  prims.push(roundCone('shankR', 'min', J.kneeR, rCa, J.ankleR, rAn));
  // 20-21 feet (capsules)
  const rFt = 0.035 * s;
  prims.push(roundCone('footL', 'min', [J.ankleL[0], J.ankleL[1] - 0.03, J.ankleL[2] - 0.03], rFt, J.footEndL, rFt));
  prims.push(roundCone('footR', 'min', [J.ankleR[0], J.ankleR[1] - 0.03, J.ankleR[2] - 0.03], rFt, J.footEndR, rFt));

  // Evaluation order (SPEC 6.3): loft, then smin with pelvis, breasts, buttocks, shoulders, neck, head, upper arms,
  // thighs; then plain min with forearms, hands, shanks, feet.
  const order = ['pelvis', 'breastL', 'breastR', 'buttockL', 'buttockR', 'shoulderL', 'shoulderR', 'neck', 'head',
    'upperArmL', 'upperArmR', 'thighL', 'thighR', 'forearmL', 'forearmR', 'handL', 'handR', 'shankL', 'shankR',
    'footL', 'footR'];
  const byName = new Map(prims.map((p) => [p.name, p]));
  const ordered = order.map((n) => /** @type {Primitive} */ (byName.get(n)));
  const NP = ordered.length;
  const sminCount = 13;

  // Loft bounding sphere.
  const loftC = [0, (loft.yMin + loft.yMax) / 2, 0];
  const loftR = Math.sqrt(((loft.yMax - loft.yMin) / 2) ** 2 + Math.max(loft.maxA, loft.maxB) ** 2);

  // Flat arrays for the per-node cull.
  const cx = new Float64Array(NP);
  const cy = new Float64Array(NP);
  const cz = new Float64Array(NP);
  const cR = new Float64Array(NP);
  const fns = ordered.map((p) => p.sd);
  for (let i = 0; i < NP; i++) {
    cx[i] = ordered[i].c[0]; cy[i] = ordered[i].c[1]; cz[i] = ordered[i].c[2]; cR[i] = ordered[i].R;
  }
  const lb = new Float64Array(NP);
  const kArr = new Float64Array(NP);
  for (let i = 0; i < NP; i++) kArr[i] = ordered[i].k;
  const loftSd = loft.sd;

  /**
   * @param {number} x @param {number} y @param {number} z @param {boolean} allowFar @returns {number}
   */
  function evaluate(x, y, z, allowFar) {
    let minLb = Math.sqrt(x * x + (y - loftC[1]) ** 2 + z * z) - loftR;
    for (let i = 0; i < NP; i++) {
      const dx = x - cx[i];
      const dy = y - cy[i];
      const dz = z - cz[i];
      const v = Math.sqrt(dx * dx + dy * dy + dz * dz) - cR[i];
      lb[i] = v;
      if (v < minLb) minLb = v;
    }
    if (allowFar && minLb > FAR_DISTANCE) return minLb;
    let d = loftSd(x, y, z);
    for (let i = 0; i < sminCount; i++) {
      const k = kArr[i];
      if (lb[i] > d + k) continue;
      const v = fns[i](x, y, z);
      const diff = d - v;
      let h = k - (diff < 0 ? -diff : diff);
      if (h <= 0) { if (v < d) d = v; continue; }
      h /= k;
      d = (v < d ? v : d) - h * h * k * 0.25;
    }
    for (let i = sminCount; i < NP; i++) {
      if (lb[i] > d) continue;
      const v = fns[i](x, y, z);
      if (v < d) d = v;
    }
    return d;
  }

  const sd = (x, y, z) => evaluate(x, y, z, true);
  const sdExact = (x, y, z) => evaluate(x, y, z, false);

  const aabb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  /** @param {Vec3} c @param {number} R */
  const grow = (c, R) => {
    for (let i = 0; i < 3; i++) {
      if (c[i] - R < aabb.min[i]) aabb.min[i] = c[i] - R;
      if (c[i] + R > aabb.max[i]) aabb.max[i] = c[i] + R;
    }
  };
  // Tight boxes: the loft as a box, round cones as the union of their end spheres.
  grow([0, loft.yMin, 0], 0);
  grow([0, loft.yMax, 0], 0);
  grow([loft.maxA, loft.yMid, 0], 0);
  grow([-loft.maxA, loft.yMid, 0], 0);
  grow([0, loft.yMid, loft.maxB], 0);
  grow([0, loft.yMid, -loft.maxB], 0);
  for (let i = 0; i < NP; i++) {
    const p = ordered[i];
    if (p.kind === 'roundCone') {
      grow(/** @type {Vec3} */ (p.a), /** @type {number} */ (p.r1));
      grow(/** @type {Vec3} */ (p.b), /** @type {number} */ (p.r2));
    } else {
      grow(p.c, p.R);
    }
  }

  return { sd, sdExact, prims: ordered, skeleton: sk, rings, loft, aabb, params };
}
