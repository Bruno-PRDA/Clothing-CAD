// src/body/loft.js — torso rings (superellipse cross-sections) and the lofted torso SDF (SPEC 6.3). Pure; metres.
//
// A ring is {y, a, b, n, cz}: half-width a along x, half-depth b along z, superellipse exponent n, z-centre cz.
// R(th) = (|cos th / a|^n + |sin th / b|^n)^(-1/n). Between rings (a, b, cz) are interpolated with a cubic Hermite
// in y (Catmull-Rom style finite-difference tangents on the non-uniform ring heights), clamped beyond the ends.

import { describeBuild } from './build.js';

/** @typedef {import('./skeleton.js').Skeleton} Skeleton */
/** @typedef {import('../core/types.js').BodyParams} BodyParams */
/**
 * `aRef` / `bRef` are the semi-axes the ring would have had WITHOUT the build modulation. They are internal to the
 * body module (index.js copies only y/a/b/n/cz into BodyModel.rings): primitives.js uses them to keep the blended
 * fills — breasts, buttocks, pelvis — in the same place ON the section when adiposity rounds it, so that the volume
 * they add to a measured circumference stays what the reduction terms below were tuned for.
 * @typedef {{y:number, a:number, b:number, n:number, cz:number, aRef?:number, bRef?:number}} Ring
 */

/** The rings solved directly from a circumference / a width, bottom to top. */
export const BASE_RING_NAMES = Object.freeze(['crotch', 'hip', 'waist', 'underbust', 'chest', 'armpit', 'shoulder', 'neckBase']);
/** All rings of the loft, bottom to top. `abdomen` is derived from the others (see `buildRings`). */
export const RING_NAMES = Object.freeze(['crotch', 'hip', 'abdomen', 'waist', 'underbust', 'chest', 'armpit', 'shoulder', 'neckBase']);
export const SUPERELLIPSE_N = 2.4;
const PERIMETER_SAMPLES = 256;

/**
 * `unitPerimeter` is memoised, and with the build modulation every k is a continuous function of the parameters, so
 * a slider drag now produces a fresh key per build instead of reusing the six tuned ones. Dropping the whole cache
 * past a generous cap keeps it bounded; a miss costs ~256 pow pairs (tens of microseconds), a build needs nine.
 */
const PERIMETER_CACHE_MAX = 4096;

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
  if (perimeterCache.size >= PERIMETER_CACHE_MAX) perimeterCache.clear();
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

  // --- build modulation (weight_kg / muscle / age_y via build.js) ---------------------------------------------
  adipKGain: 0.18,        // dk per unit adiposity at ring weight 1 (waist 0.74 -> 0.92 at adiposity +1)
  adipLeanKGain: 0.14,    // dk per unit leanness  at ring weight 1 (waist 0.74 -> 0.60 at adiposity -1)
  adipBackShare: 0.25,    // of the depth the rounding adds, this fraction goes behind the spine; the rest in front
  kMin: 0.45, kMax: 0.96, // a torso section is never deeper than it is wide, and never a blade
  shoulderInsetMuscle: 0.15,  // the shoulder ring reaches this much further out (x inset) per unit tone
  abdomenT: 0.50,         // abdomen ring height, as a fraction of the way from the hip ring to the waist ring
  // Extra half-depth as a fraction of the interpolated b, per unit adiposity. 0.15 rather than the 0.18 that looked
  // right by eye: at 0.18 the plus_f skirt's residual penetration jumped from 4.2 mm to 5.5 mm, while 0.12-0.15 all
  // sat at 4.2-4.3 mm. The cliff is the loft's perpendicular slope correction — a steeper db/dy divides the reported
  // distance by a larger sqrt(1 + slope^2), so the contact solver under-corrects exactly where the belly is steepest.
  // 0.15 still carries plus_f's abdomen 57 mm further forward than the unmodulated body, with margin under the cliff.
  abdomenBulge: 0.15,
  abdomenAge: 0.35,       // the same bulge grows this much at 70 y (fat migrates centrally with age)
  abdomenLean: 0.06,      // the profile between hip and waist runs slightly hollow when lean
  abdomenWiden: 0.04,     // extra half-width per unit adiposity
  abdomenBack: 0.15,      // of the abdominal bulge, this fraction goes into the lumbar region; the rest forward
});

/**
 * How strongly adiposity rounds each ring (a multiplier on `adipKGain` / `adipLeanKGain`).
 *
 * The waist and the abdomen carry the whole effect: that is where fat is deposited first and where the section goes
 * from an ellipse to a circle. The ribcage follows much less (bone sets its aspect) and the shoulder almost not at
 * all — the clavicles fix its width and depth however heavy the body is.
 *
 * The hip and crotch weights are HALF what the anatomy alone would suggest, for a measurement reason worth recording:
 * rounding a ring at constant perimeter narrows it, and the hip ring is the only one whose width is in a race with
 * fixed-girth neighbours. The thigh round cones (r = thigh_cm/2pi, an input) have their proximal sphere centred
 * 30 mm above the crotch, so they cut the hip measuring plane; when `a_hip` shrinks they emerge from the side of the
 * torso and measure.js picks them up. At weight 0.85 that cost +2.2 cm of measured hip on plus_f — a girth the user
 * typed in. At 0.45 the residual is a few millimetres, and the belly is carried by the waist and abdomen rings
 * anyway, which have no such neighbour.
 */
const ADIPOSITY_W = Object.freeze({
  crotch: 0.20, hip: 0.45, abdomen: 1.00, waist: 1.00, underbust: 0.70,
  chest: 0.45, armpit: 0.30, shoulder: 0.08, neckBase: 0.25,
});

/**
 * dk per unit muscle tone, signed. NEGATIVE = flatter and therefore WIDER at the same circumference, which is what a
 * developed chest and lat spread look like from the front; the V-taper comes out of the upper rings widening while
 * the waist, whose circumference is an input, stays exactly where it is. The shoulder ring is the exception: its `a`
 * is set by shoulderWidth (and widened further by `shoulderInsetMuscle`), so a POSITIVE dk there is the front-to-back
 * thickness that trapezius and deltoid add.
 */
const MUSCLE_DK = Object.freeze({
  crotch: 0, hip: 0, abdomen: 0, waist: 0, underbust: -0.025,
  chest: -0.050, armpit: -0.045, shoulder: 0.040, neckBase: -0.015,
});

/**
 * Build the torso ring table from the skeleton and the parameters.
 *
 * The circumference of every ring stays exactly what the parameters ask for: `a` is re-solved from C after the build
 * modulation picks k, so the measurement in measure.js is preserved by construction and only the SHAPE changes.
 * @param {Skeleton} sk @param {BodyParams} params @param {Partial<typeof RING_TUNING>} [tuning] overrides (tuning scripts only)
 * @returns {Record<string, Ring>}
 */
export function buildRings(sk, params, tuning) {
  const t = tuning ? { ...RING_TUNING, ...tuning } : RING_TUNING;
  const bd = describeBuild(params, tuning);
  const m = sk.m;
  const y = sk.y;
  const n = SUPERELLIPSE_N;

  /** Aspect ratio after the build modulation. @param {string} name @param {number} k0 @returns {number} */
  const kFor = (name, k0) => {
    const w = ADIPOSITY_W[name] || 0;
    const k = k0 + w * (bd.adipPos * t.adipKGain - bd.adipNeg * t.adipLeanKGain) + (MUSCLE_DK[name] || 0) * bd.tone;
    return k < t.kMin ? t.kMin : k > t.kMax ? t.kMax : k;
  };
  /**
   * The depth that rounding the section just added is spent mostly IN FRONT of the spine — that is the difference
   * between a belly and a barrel. Flattening (b < b0) moves the front back by the same rule, giving the hollow
   * abdomen of a lean body. Derived from the actual b, so it is identically zero at adiposity 0.
   * @param {number} cz0 @param {number} b @param {number} b0 @returns {number}
   */
  const czFor = (cz0, b, b0) => cz0 + (b - b0) * (1 - t.adipBackShare);

  /** @param {string} name @param {number} yy @param {number} C @param {number} k0 @param {number} cz0 @returns {Ring} */
  const ring = (name, yy, C, k0, cz0) => {
    const Cm = Math.max(C, 0.05);
    const k = kFor(name, k0);
    const a = Cm / unitPerimeter(k, n);
    const b = k * a;
    const aRef = Cm / unitPerimeter(k0, n);
    const bRef = k0 * aRef;
    return { y: yy, a, b, n, cz: czFor(cz0, b, bRef), aRef, bRef };
  };

  const inset0 = t.shoulderInset;
  const inset = inset0 * (1 - t.shoulderInsetMuscle * bd.tone);
  const shoulderA = Math.max(m.shoulderW / 2 - inset * sk.s, 0.06);
  const shoulderA0 = Math.max(m.shoulderW / 2 - inset0 * sk.s, 0.06);
  const shoulderKv = kFor('shoulder', t.shoulderK);
  const shoulderB = shoulderKv * shoulderA;
  /** @type {Record<string, Ring>} */
  const rings = {
    crotch: ring('crotch', y.crotch, t.crotchFactor * m.hips, t.crotchK, t.crotchCz),
    hip: ring('hip', y.hip, m.hips - t.hipReduce, t.hipK, t.hipCz),
    waist: ring('waist', y.waist, m.waist - t.waistReduce, t.waistK, t.waistCz),
    underbust: ring('underbust', y.underbust, m.underbust, t.underbustK, t.underbustCz),
    chest: ring('chest', y.chest, m.chest - t.chestBustReduce * m.bust - t.chestReduce, t.chestK, t.chestCz),
    armpit: ring('armpit', y.armpit, t.armpitFactor * m.chest - t.armpitBustReduce * m.bust, t.armpitK, t.armpitCz),
    shoulder: {
      y: y.shoulder, a: shoulderA, b: shoulderB, n,
      cz: czFor(t.shoulderCz, shoulderB, t.shoulderK * shoulderA0), aRef: shoulderA0, bRef: t.shoulderK * shoulderA0,
    },
    neckBase: ring('neckBase', y.neckBase, t.neckFactor * m.neck, t.neckK, t.neckCz),
  };
  // Robustness for extreme parameter mixes: ring heights must increase strictly from crotch to neckBase.
  bumpHeights(rings, BASE_RING_NAMES);

  // --- abdomen ring ------------------------------------------------------------------------------------------
  // Rounding the waist and hip sections is not enough: between them the Hermite still runs almost straight, so a
  // heavy body gets a thick cylinder instead of a belly. The abdomen ring is placed ON the eight-ring curve (so at
  // adiposity 0 it is a redundant control point and the tuned silhouette is unchanged to within the re-estimated
  // tangents) and then pushed forward. Its own circumference is free — it is not one of the measured girths, and
  // waist / hip / chest are control points, so their measurements cannot move at all.
  const yA = rings.hip.y + t.abdomenT * (rings.waist.y - rings.hip.y);
  const o = makeLoft(rings).ringAt(yA, new Float64Array(6));
  const bulge = bd.adipPos * t.abdomenBulge * (1 + t.abdomenAge * bd.ageF) - bd.adipNeg * t.abdomenLean;
  const bA = o[1] * (1 + bulge);
  rings.abdomen = {
    y: yA,
    a: o[0] * (1 + bd.adipPos * t.abdomenWiden - bd.adipNeg * t.abdomenWiden * 0.5),
    b: bA,
    n,
    cz: o[2] + (bA - o[1]) * (1 - t.abdomenBack),
    aRef: o[0], bRef: o[1],
  };
  bumpHeights(rings, RING_NAMES);
  return rings;
}

/**
 * Force strictly increasing ring heights (5 mm apart) in list order.
 * @param {Record<string, Ring>} rings @param {ReadonlyArray<string>} names
 */
function bumpHeights(rings, names) {
  let prevY = -Infinity;
  for (let i = 0; i < names.length; i++) {
    const r = rings[names[i]];
    if (!r) continue;
    if (r.y < prevY + 0.005) r.y = prevY + 0.005;
    prevY = r.y;
  }
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
  // `abdomen` is absent on the first of the two passes in buildRings, which is how that ring is placed on the curve.
  /** @type {Ring[]} */
  const list = [];
  for (let i = 0; i < RING_NAMES.length; i++) {
    const r = rings[RING_NAMES[i]];
    if (r) list.push(r);
  }
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
