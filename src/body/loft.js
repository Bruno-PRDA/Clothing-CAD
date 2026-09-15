// src/body/loft.js — torso rings (superellipse cross-sections) and the lofted torso SDF (SPEC 6.3). Pure; metres.
//
// A ring is {y, a, b, n, cz}: half-width a along x, half-depth b along z, superellipse exponent n, z-centre cz.
// R(th) = (|cos th / a|^n + |sin th / b|^n)^(-1/n). Between rings (a, b, cz) are interpolated with a cubic Hermite
// in y (Catmull-Rom style finite-difference tangents on the non-uniform ring heights), clamped beyond the ends.

/** @typedef {import('./skeleton.js').Skeleton} Skeleton */
/** @typedef {import('../core/types.js').BodyParams} BodyParams */
/** @typedef {{y:number, a:number, b:number, n:number, cz:number}} Ring */

export const RING_NAMES = Object.freeze(['crotch', 'hip', 'waist', 'underbust', 'chest', 'armpit', 'shoulder', 'neckBase']);
export const SUPERELLIPSE_N = 2.4;
const PERIMETER_SAMPLES = 256;

/** @type {Map<string, number>} */
const perimeterCache = new Map();

/**
 * Polar radius of the superellipse (a, b, n) at angle th (measured from +x toward +z).
 * @param {number} th @param {number} a @param {number} b @param {number} n @returns {number}
 */
export function superRadius(th, a, b, n) {
  const c = Math.abs(Math.cos(th) / a);
  const s = Math.abs(Math.sin(th) / b);
  return Math.pow(Math.pow(c, n) + Math.pow(s, n), -1 / n);
}

/**
 * Perimeter of the unit superellipse (a = 1, b = k, exponent n), summed over 256 chord samples (cached per (k, n)).
 * The perimeter is homogeneous of degree 1, so a ring of circumference C has a = C / P1(k, n).
 * @param {number} k @param {number} [n] @returns {number}
 */
export function unitPerimeter(k, n = SUPERELLIPSE_N) {
  const key = k.toFixed(6) + '|' + n.toFixed(4);
  const hit = perimeterCache.get(key);
  if (hit !== undefined) return hit;
  let sum = 0;
  let px = 0;
  let pz = 0;
  for (let i = 0; i <= PERIMETER_SAMPLES; i++) {
    const th = (2 * Math.PI * i) / PERIMETER_SAMPLES;
    const r = superRadius(th, 1, k, n);
    const x = r * Math.cos(th);
    const z = r * Math.sin(th);
    if (i > 0) sum += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  perimeterCache.set(key, sum);
  return sum;
}

/**
 * Ring circumference constants (SPEC 6.3 table; tuned by A3 against measure.js — see the Implementation notes).
 * C in metres; the reduction terms compensate the volume added by the blended breasts / buttocks.
 *
 * The upper-torso aspect ratios k = b/a are the ones SPEC 6.3 flags as "starting points, not law". The originals
 * (chest 0.66, armpit 0.62) modelled the ribcage as much flatter than it is: at an 88 cm bust they give a 29.6 cm
 * wide by 19.5 cm deep section, and the extra half-width pushes the torso sideways into the arms, leaving only a
 * 60 mm armpit slot in the A-pose (6.9 case 4 wants a sleeve to fit through it). A real female bust section is
 * about 28 x 21 cm, i.e. k = 0.75. Raising chest/armpit to 0.78 and underbust to 0.74 keeps the circumference —
 * a is solved from C either way — makes the section rounder and anatomically closer, and buys 14 mm of armpit
 * clearance per side. `chestReduce` / `chestBustReduce` are then re-solved so every preset still measures within
 * tolerance (a rounder ring carries the breast ellipsoids further forward, so the bust term grows 0.14 -> 0.20).
 * `hipReduce` likewise re-solved after the ellipsoid distance became exact (see primitives.js).
 */
export const RING_TUNING = Object.freeze({
  crotchFactor: 0.90, crotchK: 0.72, crotchCz: -0.010,
  hipReduce: 0.06, hipK: 0.72, hipCz: -0.015,
  waistReduce: 0.0, waistK: 0.74, waistCz: 0.0,
  underbustK: 0.74, underbustCz: 0.010,
  chestBustReduce: 0.20, chestReduce: 0.03, chestK: 0.78, chestCz: 0.010,
  armpitFactor: 0.96, armpitBustReduce: 0.10, armpitK: 0.78, armpitCz: 0.005,
  shoulderInset: 0.045, shoulderK: 0.55, shoulderCz: 0.0,
  neckFactor: 1.35, neckK: 0.85, neckCz: -0.005,
});

/**
 * Build the torso ring table from the skeleton and the parameters.
 * @param {Skeleton} sk @param {BodyParams} params @param {Partial<typeof RING_TUNING>} [tuning] overrides (tuning scripts only)
 * @returns {Record<string, Ring>}
 */
export function buildRings(sk, params, tuning) {
  const t = tuning ? { ...RING_TUNING, ...tuning } : RING_TUNING;
  const m = sk.m;
  const y = sk.y;
  const n = SUPERELLIPSE_N;
  /** @param {number} yy @param {number} C @param {number} k @param {number} cz @returns {Ring} */
  const ring = (yy, C, k, cz) => {
    const a = Math.max(C, 0.05) / unitPerimeter(k, n);
    return { y: yy, a, b: k * a, n, cz };
  };
  const shoulderA = Math.max(m.shoulderW / 2 - t.shoulderInset * sk.s, 0.06);
  /** @type {Record<string, Ring>} */
  const rings = {
    crotch: ring(y.crotch, t.crotchFactor * m.hips, t.crotchK, t.crotchCz),
    hip: ring(y.hip, m.hips - t.hipReduce, t.hipK, t.hipCz),
    waist: ring(y.waist, m.waist - t.waistReduce, t.waistK, t.waistCz),
    underbust: ring(y.underbust, m.underbust, t.underbustK, t.underbustCz),
    chest: ring(y.chest, m.chest - t.chestBustReduce * m.bust - t.chestReduce, t.chestK, t.chestCz),
    armpit: ring(y.armpit, t.armpitFactor * m.chest - t.armpitBustReduce * m.bust, t.armpitK, t.armpitCz),
    shoulder: { y: y.shoulder, a: shoulderA, b: t.shoulderK * shoulderA, n, cz: t.shoulderCz },
    neckBase: ring(y.neckBase, t.neckFactor * m.neck, t.neckK, t.neckCz),
  };
  // Robustness for extreme parameter mixes: ring heights must increase strictly from crotch to neckBase.
  let prevY = -Infinity;
  for (let i = 0; i < RING_NAMES.length; i++) {
    const r = rings[RING_NAMES[i]];
    if (r.y < prevY + 0.005) r.y = prevY + 0.005;
    prevY = r.y;
  }
  return rings;
}

/**
 * @typedef {Object} Loft
 * @property {(x:number, y:number, z:number) => number} sd   signed distance (metres)
 * @property {(y:number, out:Float64Array) => Float64Array} ringAt   interpolated (a, b, cz) at height y into out[0..2],
 *   and their derivatives with respect to y into out[3..5] (out must hold 6 numbers)
 * @property {number} yMin
 * @property {number} yMax
 * @property {number} yMid
 * @property {number} maxA
 * @property {number} maxB   max over rings of b + |cz|
 * @property {Ring[]} list   rings bottom to top
 */

/**
 * Build the loft closure from the ring table.
 * @param {Record<string, Ring>} rings @returns {Loft}
 */
export function makeLoft(rings) {
  const list = RING_NAMES.map((name) => rings[name]);
  const N = list.length;
  const ys = new Float64Array(N);
  const va = new Float64Array(N);
  const vb = new Float64Array(N);
  const vc = new Float64Array(N);
  let maxA = 0;
  let maxB = 0;
  for (let i = 0; i < N; i++) {
    ys[i] = list[i].y; va[i] = list[i].a; vb[i] = list[i].b; vc[i] = list[i].cz;
    if (va[i] > maxA) maxA = va[i];
    if (vb[i] + Math.abs(vc[i]) > maxB) maxB = vb[i] + Math.abs(vc[i]);
  }
  // Finite-difference tangents (per unit y) for the Hermite interpolation.
  const ta = new Float64Array(N);
  const tb = new Float64Array(N);
  const tc = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const i0 = i > 0 ? i - 1 : i;
    const i1 = i < N - 1 ? i + 1 : i;
    const dy = ys[i1] - ys[i0] || 1;
    ta[i] = (va[i1] - va[i0]) / dy;
    tb[i] = (vb[i1] - vb[i0]) / dy;
    tc[i] = (vc[i1] - vc[i0]) / dy;
  }
  const n = list[0].n;
  const yMin = ys[0];
  const yMax = ys[N - 1];
  const yMid = (yMin + yMax) / 2;
  const halfLen = (yMax - yMin) / 2;
  const invN = -1 / n;

  /** @param {number} y @param {Float64Array} out @returns {Float64Array} */
  function ringAt(y, out) {
    if (y <= yMin) { out[0] = va[0]; out[1] = vb[0]; out[2] = vc[0]; out[3] = 0; out[4] = 0; out[5] = 0; return out; }
    if (y >= yMax) {
      out[0] = va[N - 1]; out[1] = vb[N - 1]; out[2] = vc[N - 1]; out[3] = 0; out[4] = 0; out[5] = 0; return out;
    }
    let i = 0;
    while (i < N - 2 && y > ys[i + 1]) i++;
    const h = ys[i + 1] - ys[i];
    const t = (y - ys[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = (t3 - 2 * t2 + t) * h;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = (t3 - t2) * h;
    // d/dy of the same basis (d/dy = (1/h) d/dt).
    const g00 = (6 * t2 - 6 * t) / h;
    const g10 = 3 * t2 - 4 * t + 1;
    const g01 = (-6 * t2 + 6 * t) / h;
    const g11 = 3 * t2 - 2 * t;
    out[0] = h00 * va[i] + h10 * ta[i] + h01 * va[i + 1] + h11 * ta[i + 1];
    out[1] = h00 * vb[i] + h10 * tb[i] + h01 * vb[i + 1] + h11 * tb[i + 1];
    out[2] = h00 * vc[i] + h10 * tc[i] + h01 * vc[i + 1] + h11 * tc[i + 1];
    out[3] = g00 * va[i] + g10 * ta[i] + g01 * va[i + 1] + g11 * ta[i + 1];
    out[4] = g00 * vb[i] + g10 * tb[i] + g01 * vb[i + 1] + g11 * tb[i + 1];
    out[5] = g00 * vc[i] + g10 * tc[i] + g01 * vc[i + 1] + g11 * tc[i + 1];
    if (out[0] < 0.01) { out[0] = 0.01; out[3] = 0; }
    if (out[1] < 0.01) { out[1] = 0.01; out[4] = 0; }
    return out;
  }

  const scratch = new Float64Array(6);
  let lastY = NaN;
  let ca = 0;
  let cb = 0;
  let cc = 0;
  let da = 0;
  let db = 0;
  let dc = 0;

  /**
   * `r - R(th)` is a RADIAL distance, not a perpendicular one: where the rings taper it over-states the distance by
   * 1 / cos(slope). On the shoulder slope a drops from 148 mm to 76 mm over 58 mm of height, so the raw field
   * reported |grad d| up to 1.75 — cloth would settle 75 % too far off the shoulders, which is exactly where a
   * garment hangs from. Dividing by sqrt(1 + (d d2/dy)^2) is the first-order perpendicular correction; it leaves the
   * zero level set (and therefore every measurement) untouched and brings |grad d| back to ~1 on the tapers.
   *
   * @param {number} x @param {number} y @param {number} z @returns {number}
   */
  function sd(x, y, z) {
    if (y !== lastY) {
      ringAt(y, scratch);
      ca = scratch[0]; cb = scratch[1]; cc = scratch[2];
      da = scratch[3]; db = scratch[4]; dc = scratch[5];
      lastY = y;
    }
    const dz = z - cc;
    const r = Math.sqrt(x * x + dz * dz);
    let d2;
    if (r < 1e-9) {
      d2 = -(ca < cb ? ca : cb);
    } else {
      const cosT = x / r;
      const sinT = dz / r;
      const A = Math.pow(Math.abs(cosT / ca), n);
      const Bv = Math.pow(Math.abs(sinT / cb), n);
      const S = A + Bv;
      const R = Math.pow(S, invN);
      d2 = r - R;
      // d(d2)/dy = dr/dy - dR/dy, with dR/dy = R ((A/S) a'/a + (B/S) b'/b) and dr/dy = -sin(th) cz'.
      const slope = -sinT * dc - R * ((A / S) * (da / ca) + (Bv / S) * (db / cb));
      d2 /= Math.sqrt(1 + slope * slope);
    }
    const dy = Math.abs(y - yMid) - halfLen;
    const mx = d2 > dy ? d2 : dy;
    const inside = mx < 0 ? mx : 0;
    const ox = d2 > 0 ? d2 : 0;
    const oy = dy > 0 ? dy : 0;
    return inside + Math.sqrt(ox * ox + oy * oy);
  }

  return { sd, ringAt, yMin, yMax, yMid, maxA, maxB, list };
}
