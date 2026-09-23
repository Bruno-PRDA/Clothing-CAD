// src/body/fitLS.js — fit the template to the user's measurements by regularised least squares over
// EVERY control that moves a measurement, not one slider per measurement.
//
// fit.js drives one MakeHuman `measure/` slider per measurement with a diagonal Newton step. That is
// the right first cut and it converges in a few rounds, but it has a hard ceiling: when a slider
// reaches the end of its morph range the measurement simply stops moving. Calibrated on the neutral
// template, `measure/waist-circ` spans about ±9 cm, `thigh-circ` +2.6 / −1.7 cm, and the leg-height
// pairs cannot shorten an inseam without also shortening the body. A 180 cm / 95 kg frame wants a
// 103 cm waist and stops at 90.9; a child's thigh sits 11 cm over; the male preset's inseam is 9 cm
// long. All three are range, not accuracy.
//
// The extra range is in MakeHuman's detail families (torso, stomach, hip, buttocks, neck, arm and leg
// fat/muscle/scale), and it is COUPLED: `torso-scale-depth-incr` adds 7.2 cm of waist and 8.9 cm of
// chest at once; `hip-scale-horiz-incr` 13.3 cm of hips and 6.1 cm of thigh. A diagonal step cannot
// spend those without breaking the measurements it is not looking at. A joint step can: solve the
// whole Jacobian at once and the chest slider absorbs what the torso slider did to the chest.
//
// So: controls = the 16 `measure/` pairs plus 31 detail pairs, left/right limb targets applied as ONE
// symmetric control (every limb is measured on the left, so a right-only slider would read as free).
// Each round: measure, linearise with the direction-dependent gains calibrated once on the neutral
// body, minimise |J·ds − err|² + Σ λ_c (s_c + ds_c)² + μ|ds|², project to [−1, 1]. λ is a preference,
// not a penalty on accuracy: `measure/` controls carry λ = 1 and detail controls λ = 100, so the
// solver spends the designed sliders first and only reaches for `stomach-pregnant` once `waist-circ`
// is pinned — which keeps a body that fits inside the designed range looking as it did. Between
// rounds a Broyden rank-one update corrects the neutral-body Jacobian from the step actually taken.
//
// Same FitResult shape as fit.js so templateModel can take either.

import { applyTargets } from './template.js';
import { macroWeightsFor } from './macro.js';
import { measureTemplate } from './measureTemplate.js';
import { buildIndex } from './section.js';

/** @typedef {import('./template.js').Template} Template */
/** @typedef {import('../core/types.js').BodyParams} BodyParams */

/** Measurements the solver steers. headHeight_cm has no target in any family and stays unsteerable. */
export const MEASURES = Object.freeze([
  'chest_cm', 'underbust_cm', 'waist_cm', 'hips_cm', 'neck_cm', 'shoulderWidth_cm', 'upperArm_cm',
  'forearm_cm', 'wrist_cm', 'thigh_cm', 'calf_cm', 'ankle_cm', 'armLength_cm', 'inseam_cm', 'torsoLength_cm',
]);
export const UNSTEERABLE = Object.freeze(['headHeight_cm']);

/**
 * @typedef {Object} Control
 * @property {string} key
 * @property {Array<[string, string]>} pairs   [incrTarget, decrTarget]; several pairs move together
 * @property {'measure'|'detail'} tier
 */

/** @param {string} base @param {'measure'|'detail'} tier @returns {Control} */
const pair = (base, tier = 'detail') => ({ key: base, pairs: [[`${base}-incr`, `${base}-decr`]], tier });
/** left and right limb targets as one control @param {string} n @returns {Control} */
const sym = (n) => ({
  key: `armslegs/${n}`, tier: 'detail',
  pairs: [[`armslegs/l-${n}-incr`, `armslegs/l-${n}-decr`], [`armslegs/r-${n}-incr`, `armslegs/r-${n}-decr`]],
});

/** @type {ReadonlyArray<Control>} */
export const CONTROLS = Object.freeze([
  // the designed measurement sliders — first tier, spent first
  ...['bust-circ', 'underbust-circ', 'waist-circ', 'hips-circ', 'neck-circ', 'shoulder-dist', 'upperarm-circ',
    'wrist-circ', 'thigh-circ', 'calf-circ', 'ankle-circ', 'upperarm-length', 'lowerarm-length',
    'upperleg-height', 'lowerleg-height', 'napetowaist-dist'].map((n) => pair(`measure/${n}`, 'measure')),
  // torso and waist
  pair('torso/torso-scale-horiz'), pair('torso/torso-scale-depth'), pair('torso/torso-vshape'),
  pair('torso/torso-scale-vert'), pair('torso/torso-muscle-dorsi'), pair('torso/torso-muscle-pectoral'),
  pair('stomach/stomach-pregnant'),
  // hips, seat, crotch height
  pair('hip/hip-scale-horiz'), pair('hip/hip-scale-depth'), pair('hip/hip-scale-vert'),
  { key: 'hip/hip-trans-vert', pairs: [['hip/hip-trans-up', 'hip/hip-trans-down']], tier: 'detail' },
  pair('buttocks/buttocks-volume'), pair('pelvis/pelvis-tone'),
  // neck
  pair('neck/neck-scale-horiz'), pair('neck/neck-scale-depth'), pair('neck/neck-back-scale-depth'), pair('neck/neck-double'),
  // limbs, left and right together
  sym('upperleg-fat'), sym('upperleg-muscle'), sym('upperleg-scale-horiz'),
  sym('lowerleg-muscle'), sym('lowerleg-fat'), sym('lowerleg-scale-depth'), sym('lowerleg-scale-horiz'),
  sym('upperarm-fat'), sym('upperarm-muscle'), sym('upperarm-shoulder-muscle'),
  sym('lowerarm-fat'), sym('lowerarm-muscle'), sym('lowerarm-scale-depth'), sym('lowerarm-scale-vert'),
]);

export const FITLS_DEFAULTS = Object.freeze({
  rounds: 12,
  damping: 0.7,
  tolerance_cm: 0.25,
  stallSlider: 0.004,
  heightTolerance_cm: 0.1,
  /**
   * Tikhonov weight toward slider 0, per tier (cm² per slider²; J entries are ~5-17 cm per slider).
   * `detail` is deliberately large: at 20 the solver still spent `torso-scale-horiz` at 0.33 on the
   * default body, which needed none of it, because a lever with 10 cm/slider of chest gain is worth
   * using a little of even when the designed slider is nowhere near its bound. At 100 the detail
   * controls only come in once a `measure/` slider is pinned, so a body inside the designed range
   * solves to the same sliders fit.js found.
   */
  lambda: Object.freeze({ measure: 1, detail: 100 }),
  /** Step damping, added to the normal-equation diagonal. */
  mu: 5,
  /** Collect a per-round trace on the result (debugging; costs nothing but memory). */
  trace: false,
  /**
   * Row weights of the least-squares problem (1 when absent). Chest, waist and hips are the numbers the
   * size chart, the fit warning and the Body panel all read, and the Body panel flags them past 1.5 cm.
   * Equal weights let the solver buy a 2 cm waist miss with small gains on forearm and back length:
   * measured on female_m at 75 y / 78 kg, waist 72.0 against 70.
   */
  weights: Object.freeze({ chest_cm: 2, waist_cm: 2, hips_cm: 2 }),
  /** Fraction of the Broyden correction applied each round (0 = pure calibrated Jacobian). */
  broyden: 1,
  /** Forget the accumulated Broyden correction whenever a round comes out worse than the one before. */
  broydenReset: false,
});

/**
 * Expand sliders into morph weights: positive picks incr, negative decr, every pair of the control.
 * @param {Float64Array|number[]} s @param {ReadonlyArray<Control>} [controls] @returns {Array<[string, number]>}
 */
export function controlWeights(s, controls = CONTROLS) {
  /** @type {Array<[string, number]>} */
  const out = [];
  for (let c = 0; c < controls.length; c++) {
    const v = s[c];
    if (!(Math.abs(v) > 1e-4)) continue;
    for (const [inc, dec] of controls[c].pairs) out.push([v > 0 ? inc : dec, Math.abs(v)]);
  }
  return out;
}

function heightOf(tpl, pos) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < tpl.nBodyVerts; i++) {
    const y = pos[i * 3 + 1];
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  return hi - lo;
}

/**
 * Direction-dependent gains of every control on every measurement, on the neutral template.
 * dPlus[c][k] = d m_k / d s_c for s_c >= 0 (the incr target); dMinus[c][k] = the same derivative for
 * s_c <= 0, i.e. base − measure(decr at 1). MakeHuman's incr and decr targets are NOT mirror images
 * (hips-circ reads +17.6 / −7.2), so both are kept. One full measurement per control per direction,
 * cached on the template — the price is paid once per page load.
 * @param {Template} tpl @returns {{dPlus: Float64Array[], dMinus: Float64Array[], base: any, present: boolean[]}}
 */
export function calibrateLS(tpl) {
  if (tpl.__fitLS) return tpl.__fitLS;
  const base = measureTemplate(tpl, tpl.rest);
  const buf = new Float32Array(tpl.rest.length);
  const K = MEASURES.length;
  const dPlus = [], dMinus = [], present = [];
  for (const ctl of CONTROLS) {
    const has = ctl.pairs.every(([inc, dec]) => tpl.targets.has(inc) && tpl.targets.has(dec));
    present.push(has);
    const p = new Float64Array(K), m = new Float64Array(K);
    if (has) {
      const mp = measureTemplate(tpl, applyTargets(tpl, ctl.pairs.map(([inc]) => [inc, 1]), buf));
      const mm = measureTemplate(tpl, applyTargets(tpl, ctl.pairs.map(([, dec]) => [dec, 1]), buf));
      for (let k = 0; k < K; k++) {
        p[k] = mp[MEASURES[k]] - base[MEASURES[k]];
        m[k] = base[MEASURES[k]] - mm[MEASURES[k]];
      }
    }
    dPlus.push(p);
    dMinus.push(m);
  }
  const cal = Object.freeze({ dPlus, dMinus, base, present });
  Object.defineProperty(tpl, '__fitLS', { value: cal, enumerable: false });
  return cal;
}

/**
 * Solve A x = b for a small dense symmetric positive-definite A (normal equations), Gaussian
 * elimination with partial pivoting. n <= ~50; nothing here is worth a library.
 * @param {Float64Array} A n*n row-major, destroyed @param {Float64Array} b length n, destroyed
 * @returns {Float64Array} x
 */
function solveDense(A, b, n) {
  for (let col = 0; col < n; col++) {
    let piv = col, best = Math.abs(A[col * n + col]);
    for (let r = col + 1; r < n; r++) { const v = Math.abs(A[r * n + col]); if (v > best) { best = v; piv = r; } }
    if (best < 1e-12) { b[col] = 0; continue; }
    if (piv !== col) {
      for (let j = 0; j < n; j++) { const t = A[col * n + j]; A[col * n + j] = A[piv * n + j]; A[piv * n + j] = t; }
      const t = b[col]; b[col] = b[piv]; b[piv] = t;
    }
    const inv = 1 / A[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r * n + col] * inv;
      if (f === 0) continue;
      for (let j = col; j < n; j++) A[r * n + j] -= f * A[col * n + j];
      b[r] -= f * b[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let acc = b[r];
    for (let j = r + 1; j < n; j++) acc -= A[r * n + j] * x[j];
    const d = A[r * n + r];
    x[r] = Math.abs(d) < 1e-12 ? 0 : acc / d;
  }
  return x;
}

/**
 * @typedef {Object} FitLSResult
 * @property {Float32Array} pos
 * @property {Array<[string, number]>} weights
 * @property {Record<string, number>} sliders   by control key
 * @property {number} heightSlider
 * @property {import('./measureTemplate.js').TemplateMeasurements} measured
 * @property {Record<string, number>} residual
 * @property {string[]} clamped                controls pinned at ±1 at the end
 * @property {number} rounds
 * @property {number} ms
 * @property {any[]} trace                    per-round diagnostics when opts.trace
 * @property {number} cost                     weighted sum of squared residuals of the returned body, cm²
 */

/**
 * @param {Template} tpl @param {BodyParams} params
 * @param {{rounds?: number, damping?: number, tolerance_cm?: number, out?: Float32Array, broyden?: number, broydenReset?: boolean, trace?: boolean}} [opts]
 * @returns {FitLSResult}
 */
export function fitBodyLS(tpl, params, opts = {}) {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now();
  const cfg = { ...FITLS_DEFAULTS, ...opts };
  const cal = calibrateLS(tpl);
  const C = CONTROLS.length;
  const K = MEASURES.length;

  const s = new Float64Array(C);
  const buf = opts.out && opts.out.length === tpl.rest.length ? opts.out : new Float32Array(tpl.rest.length);
  let heightSlider = 0.5;
  /** @type {Array<[string, number]>} */
  let weights = [];
  /** height slider of the mesh currently in `buf` (NaN once the controls change after it was built) */
  let lastBuilt = NaN;
  const build = (hs) => {
    weights = [...macroWeightsFor(params, hs), ...controlWeights(s)];
    lastBuilt = hs;
    return applyTargets(tpl, weights, buf);
  };

  const wantH = params.height_cm / 100;
  const tolH = cfg.heightTolerance_cm / 100;
  /** @param {number} h @returns {number} stature error at height slider h, metres */
  const f = (h) => heightOf(tpl, build(h)) - wantH;
  // Stature per unit of the height slider, learned from the first bracketed solve and refined by every
  // Newton step. Each round changes stature by millimetres, so after the first round one Newton step from
  // the previous answer lands inside tolerance: 2 morph builds per round instead of 6-7, which was most of
  // the solver's time (measured: a full build's fit 590 -> ~300 ms).
  let slope = NaN;
  const solveHeight = () => {
    if (Number.isFinite(slope) && slope > 1e-4) {
      let h0 = heightSlider, f0 = f(h0);
      for (let i = 0; i < 4 && Math.abs(f0) >= tolH; i++) {
        const h1 = Math.min(1, Math.max(0, h0 - f0 / slope));
        if (Math.abs(h1 - h0) < 1e-9) break;               // pinned at an end of the slider
        const f1 = f(h1);
        const sl = (f1 - f0) / (h1 - h0);
        if (sl > 1e-4) slope = sl;
        h0 = h1; f0 = f1;
      }
      if (Math.abs(f0) < tolH) return (heightSlider = h0);
    }
    // cold start (first round) or the Newton step failed: bracketed secant over the whole slider
    let a = 0.0, b = 1.0;
    let fa = f(a);
    let fb = f(b);
    if (fb - fa > 1e-4) slope = fb - fa;
    if (fa > 0) return (heightSlider = 0);
    if (fb < 0) return (heightSlider = 1);
    for (let i = 0; i < 24 && b - a > 1e-4; i++) {
      const mid = fb !== fa ? Math.min(b, Math.max(a, a + (b - a) * (-fa / (fb - fa)))) : (a + b) / 2;
      const fm = f(mid);
      if (Math.abs(fm) < tolH) { a = b = mid; fa = fb = fm; break; }
      if (fm < 0) { a = mid; fa = fm; } else { b = mid; fb = fm; }
    }
    return (heightSlider = (a + b) / 2);
  };
  /** The mesh at the solved height: `buf` already holds it when the solve ended on that exact value. */
  const atHeight = () => (lastBuilt === heightSlider ? buf : build(heightSlider));

  // which measurements are asked for
  const want = new Float64Array(K);
  const asked = new Uint8Array(K);
  for (let k = 0; k < K; k++) {
    const v = /** @type {any} */ (params)[MEASURES[k]];
    if (typeof v === 'number' && Number.isFinite(v)) { want[k] = v; asked[k] = 1; }
  }

  const J = new Float64Array(K * C);
  const err = new Float64Array(K);
  const A = new Float64Array(C * C);
  const rhs = new Float64Array(C);
  const active = new Uint8Array(C);
  let measured = null;
  let round = 0;

  // Broyden correction to the calibrated Jacobian. The neutral-body gains are only row-rescaled to
  // this body, and on a heavy or small frame the COUPLED derivatives can be far enough off that a
  // damped step walks into a bad basin (measured: hip-trans-vert driven to -1.00 on a 180 cm / 95 kg
  // body while the inseam it shortens was already 3 cm short). Each round we know the step we took
  // and the change we saw, and the rank-one update J += (dm - J ds) ds^T / (ds . ds) corrects the
  // Jacobian along that direction for free. It also absorbs the height secant, which re-solves
  // stature every round and so makes the effective derivative of every leg-length control differ
  // from its raw morph gain.
  const Jd = new Float64Array(K * C);
  const prevS = new Float64Array(C);
  const prevM = new Float64Array(K);
  let havePrev = false;
  /** @type {any[]} */
  const trace = [];

  // Keep the best round. A Gauss-Newton step on a coupled, slightly non-smooth problem is not monotone:
  // measured on 180 cm / 95 kg, the worst error went 2.26 -> 2.46 -> 2.63 -> 3.06 over the last four
  // rounds while the solver chased back length against inseam. The sum of squared errors of every round
  // is known for free, so the answer is simply the best body the solver actually built.
  const bestS = new Float64Array(C);
  let bestCost = Infinity;
  let lastCost = Infinity;
  /** squared row weights, same as the normal equations use */
  const w2 = new Float64Array(K);
  for (let k = 0; k < K; k++) { const w = Number((cfg.weights || {})[MEASURES[k]]); w2[k] = Number.isFinite(w) && w > 0 ? w * w : 1; }
  /** @param {any} m @returns {number} */
  const costOf = (m) => {
    let c = 0;
    for (let k = 0; k < K; k++) if (asked[k]) { const e = want[k] - m[MEASURES[k]]; c += w2[k] * e * e; }
    return c;
  };

  for (; round < cfg.rounds; round++) {
    solveHeight();
    const pos = atHeight();
    measured = measureTemplate(tpl, pos, { index: buildIndex(tpl, pos) });

    const cost = costOf(measured);
    if (cfg.broydenReset && cost > lastCost) Jd.fill(0);
    lastCost = cost;
    if (cost < bestCost) { bestCost = cost; bestS.set(s); }

    // residual and per-row scale (the neutral gains rescaled to this body's size, as fit.js does)
    let worst = 0;
    const scale = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      if (!asked[k]) { err[k] = 0; scale[k] = 0; continue; }
      err[k] = want[k] - measured[MEASURES[k]];
      worst = Math.max(worst, Math.abs(err[k]));
      const b0 = cal.base[MEASURES[k]];
      scale[k] = b0 > 1e-6 ? Math.max(0.4, Math.min(2.5, measured[MEASURES[k]] / b0)) : 1;
    }
    // Calibrated Jacobian at the current point: the incr gain on the positive side of a slider, the
    // decr gain on the negative side, their mean at exactly zero.
    for (let c = 0; c < C; c++) {
      for (let k = 0; k < K; k++) {
        const g = s[c] > 1e-9 ? cal.dPlus[c][k] : s[c] < -1e-9 ? cal.dMinus[c][k] : 0.5 * (cal.dPlus[c][k] + cal.dMinus[c][k]);
        J[k * C + c] = cal.present[c] && asked[k] ? g * scale[k] : 0;
      }
    }
    // Broyden: what did the last step actually do, against what the Jacobian we used predicted?
    if (havePrev) {
      let dsq = 0;
      for (let c = 0; c < C; c++) { const d = s[c] - prevS[c]; dsq += d * d; }
      if (dsq > 1e-6) {
        for (let k = 0; k < K; k++) {
          if (!asked[k]) continue;
          let pred = 0;
          for (let c = 0; c < C; c++) pred += (J[k * C + c] + Jd[k * C + c]) * (s[c] - prevS[c]);
          const miss = (measured[MEASURES[k]] - prevM[k]) - pred;
          for (let c = 0; c < C; c++) Jd[k * C + c] += cfg.broyden * miss * (s[c] - prevS[c]) / dsq;
        }
      }
    }
    for (let i = 0; i < K * C; i++) J[i] += Jd[i];
    prevS.set(s);
    for (let k = 0; k < K; k++) prevM[k] = measured[MEASURES[k]];
    havePrev = true;

    if (cfg.trace) {
      const e = [];
      for (let k = 0; k < K; k++) if (asked[k]) e.push([MEASURES[k].replace('_cm', ''), +err[k].toFixed(2)]);
      e.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      trace.push({ round, worst: +worst.toFixed(2), heightSlider: +heightSlider.toFixed(3), err: e.slice(0, 5), s: null });
    }
    if (worst < cfg.tolerance_cm) { round++; break; }

    // Active set: a control pinned at a bound with the gradient still pushing outward is frozen for
    // this round; up to three re-solves clear the ones the first solve pushed over.
    active.fill(1);
    for (let c = 0; c < C; c++) if (!cal.present[c]) active[c] = 0;
    let ds = new Float64Array(C);
    for (let pass = 0; pass < 3; pass++) {
      A.fill(0); rhs.fill(0);
      for (let c = 0; c < C; c++) {
        if (!active[c]) { A[c * C + c] = 1; rhs[c] = 0; continue; }
        const lam = cfg.lambda[CONTROLS[c].tier];
        for (let d = c; d < C; d++) {
          if (!active[d]) continue;
          let acc = 0;
          for (let k = 0; k < K; k++) acc += w2[k] * J[k * C + c] * J[k * C + d];
          A[c * C + d] = acc; A[d * C + c] = acc;
        }
        A[c * C + c] += lam + cfg.mu;
        let g = 0;
        for (let k = 0; k < K; k++) g += w2[k] * J[k * C + c] * err[k];
        rhs[c] = g - lam * s[c];
      }
      ds = solveDense(A.slice(), rhs.slice(), C);
      let changed = false;
      for (let c = 0; c < C; c++) {
        if (!active[c]) continue;
        const next = s[c] + cfg.damping * ds[c];
        if ((next > 1 && s[c] >= 1 - 1e-9) || (next < -1 && s[c] <= -1 + 1e-9)) { active[c] = 0; changed = true; }
      }
      if (!changed) break;
    }

    let moved = 0;
    const steps = [];
    for (let c = 0; c < C; c++) {
      if (!active[c]) continue;
      const before = s[c];
      s[c] = Math.max(-1, Math.min(1, s[c] + cfg.damping * ds[c]));
      lastBuilt = NaN;
      moved = Math.max(moved, Math.abs(s[c] - before));
      if (cfg.trace && Math.abs(s[c] - before) > 0.02) steps.push([CONTROLS[c].key.replace(/^[a-z]+\//, ''), +before.toFixed(2), +s[c].toFixed(2)]);
    }
    if (cfg.trace && trace.length) {
      steps.sort((a, b) => Math.abs(b[2] - b[1]) - Math.abs(a[2] - a[1]));
      trace[trace.length - 1].s = steps.slice(0, 6);
    }
    if (moved < cfg.stallSlider) { round++; break; }
  }

  solveHeight();
  let pos = atHeight();
  measured = measureTemplate(tpl, pos, { index: buildIndex(tpl, pos) });
  if (bestCost < costOf(measured)) {
    s.set(bestS);
    lastBuilt = NaN;
    solveHeight();
    pos = atHeight();
    measured = measureTemplate(tpl, pos, { index: buildIndex(tpl, pos) });
  }
  /** @type {Record<string, number>} */
  const residual = {};
  for (let k = 0; k < K; k++) if (asked[k]) residual[MEASURES[k]] = want[k] - measured[MEASURES[k]];
  residual.height_cm = params.height_cm - measured.height_cm;
  /** @type {Record<string, number>} */
  const sliders = {};
  const clamped = [];
  for (let c = 0; c < C; c++) {
    sliders[CONTROLS[c].key] = s[c];
    if (Math.abs(s[c]) >= 1 - 1e-9) clamped.push(CONTROLS[c].key);
  }
  return { pos, weights, sliders, heightSlider, measured, residual, clamped, rounds: round, ms: now() - t0, trace, cost: costOf(measured) };
}

/**
 * rms of the residual over the steered measurements, cm. @param {{residual: Record<string, number>}} r
 * @returns {number}
 */
export function residualRms(r) {
  let ss = 0, n = 0;
  for (const k of MEASURES) if (typeof r.residual[k] === 'number') { ss += r.residual[k] * r.residual[k]; n++; }
  return n ? Math.sqrt(ss / n) : 0;
}

/** A first solve at or under this rms (cm) is kept without trying the second variant. */
export const RETRY_RMS_CM = 0.8;

/**
 * The fit a full body build uses: a Broyden solve, and only when that leaves more than RETRY_RMS_CM of rms
 * error, a second solve without the Broyden correction; the lower weighted cost wins. Neither variant
 * dominates. Broyden learns the coupling the neutral-body gains miss and wins on athletic and large male
 * frames (rms 1.04 vs 1.74, 0.50 vs 1.04 cm); on a heavy frame the same memory leads it astray (180 cm /
 * 95 kg: 1.68 vs 0.83; 170 cm / 120 kg: 3.95 vs 2.88). Measured over eight bodies: 1.29 cm mean rms for
 * Broyden alone, 1.17 without, 1.02 for this. The retry threshold keeps the default body's build to one solve:
 * a live body change must rebuild in well under half a second (acceptance check 15).
 * A coarse (drag) build passes `rounds` and always gets the single solve.
 * @param {Template} tpl @param {BodyParams} params @param {object} [opts]
 * @returns {FitLSResult & {variant: string}}
 */
export function fitBodyLSBest(tpl, params, opts = {}) {
  const a = fitBodyLS(tpl, params, { ...opts, broyden: 1 });
  if (Number.isFinite(/** @type {any} */ (opts).rounds) || residualRms(a) <= RETRY_RMS_CM) return { ...a, variant: 'broyden' };
  const b = fitBodyLS(tpl, params, { ...opts, broyden: 0 });
  return a.cost <= b.cost ? { ...a, variant: 'broyden', ms: a.ms + b.ms } : { ...b, variant: 'calibrated', ms: a.ms + b.ms };
}
