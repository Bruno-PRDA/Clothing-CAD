// src/body/fit.js — solve MakeHuman's measurement sliders so the body actually measures what the
// user typed.
//
// The macro layer (macro.js) puts the body in the right neighbourhood: right sex, right age, roughly
// the right build for the BMI. It does NOT hit a chest of 88.0 cm. This module closes that gap, which
// is the difference between a body viewer and a pattern-drafting tool: a garment is cut from the
// numbers, so the mesh the cloth drapes on has to BE those numbers.
//
// Method. Each measurement owns one slider in [-1, 1] that selects between a `-decr` and an `-incr`
// morph target. The map from sliders to measurements is mildly non-linear and weakly coupled (taking
// the waist in pulls the hips in slightly), so a damped Newton iteration on the diagonal converges in
// a handful of rounds: measure, step each slider by error/sensitivity, remeasure. Sensitivities are
// calibrated once per template and rescaled by body size, because probing 14 of them per solve would
// cost more than the whole solve.
//
// Height is handled separately and first, by secant on MakeHuman's height slider. It is re-solved
// every round because several measurement targets (leg heights, neck height) move stature too.

import { applyTargets } from './template.js';
import { macroWeightsFor } from './macro.js';
import { measureTemplate } from './measureTemplate.js';
import { buildIndex } from './section.js';

/** @typedef {import('./template.js').Template} Template */
/** @typedef {import('../core/types.js').BodyParams} BodyParams */

/**
 * measurement key -> the MakeHuman measure target family (or families) that moves it.
 * `forearm_cm` and `headHeight_cm` are absent on purpose: MakeHuman ships no forearm-circumference or
 * head-height target, so those two follow from the macro shape and cannot be dialled independently.
 * @type {Readonly<Record<string, string[]>>}
 */
export const MEASURE_TARGETS = Object.freeze({
  chest_cm: ['measure/bust-circ'],
  underbust_cm: ['measure/underbust-circ'],
  waist_cm: ['measure/waist-circ'],
  hips_cm: ['measure/hips-circ'],
  neck_cm: ['measure/neck-circ'],
  shoulderWidth_cm: ['measure/shoulder-dist'],
  upperArm_cm: ['measure/upperarm-circ'],
  wrist_cm: ['measure/wrist-circ'],
  thigh_cm: ['measure/thigh-circ'],
  calf_cm: ['measure/calf-circ'],
  ankle_cm: ['measure/ankle-circ'],
  armLength_cm: ['measure/upperarm-length', 'measure/lowerarm-length'],
  inseam_cm: ['measure/upperleg-height', 'measure/lowerleg-height'],
  torsoLength_cm: ['measure/napetowaist-dist'],
});

/** Measurements the template cannot be steered to; reported so the UI can say so rather than lie. */
export const UNSTEERABLE = Object.freeze(['forearm_cm', 'headHeight_cm']);

export const FIT_DEFAULTS = Object.freeze({
  rounds: 10,
  // Well under 1. The lengths (inseam, back length, arm) are strongly coupled to stature through the
  // height secant that runs every round: shortening the legs shortens the body, the secant makes it
  // taller again, and the legs grow back. At 0.85 that pair oscillates and leaves the inseam 9 cm out;
  // at 0.55 it settles.
  damping: 0.55,
  tolerance_cm: 0.25,
  /** Give up when no slider moved more than this in a round (slider units, range -1..1). */
  stallSlider: 0.004,
  heightTolerance_cm: 0.1,
});

/**
 * Expand a slider dictionary into target weights: positive picks `-incr`, negative `-decr`.
 * @param {Record<string, number>} sliders @returns {Array<[string, number]>}
 */
export function sliderTargets(sliders) {
  /** @type {Array<[string, number]>} */
  const out = [];
  for (const key of Object.keys(sliders)) {
    const s = sliders[key];
    if (!(Math.abs(s) > 1e-4)) continue;
    for (const base of MEASURE_TARGETS[key] || []) {
      out.push([`${base}-${s > 0 ? 'incr' : 'decr'}`, Math.abs(s)]);
    }
  }
  return out;
}

/** Body height in metres straight from the vertex buffer — cheap enough to call inside a secant loop. */
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
 * Calibrate cm-per-unit-slider for each steerable measurement, on the neutral template. Costs about
 * one full measurement per dimension, so it is done once and cached on the template object.
 * @param {Template} tpl @returns {Record<string, number>}
 */
export function calibrate(tpl) {
  if (tpl.__fitGains) return tpl.__fitGains;
  /** @type {Record<string, number>} */
  const gains = {};
  const base = measureTemplate(tpl, tpl.rest);
  const buf = new Float32Array(tpl.rest.length);
  for (const key of Object.keys(MEASURE_TARGETS)) {
    const pos = applyTargets(tpl, sliderTargets({ [key]: 1 }), buf);
    const m = measureTemplate(tpl, pos);
    const d = m[key] - base[key];
    // a target that moves its own measurement by less than a millimetre is not usable as a control
    gains[key] = Math.abs(d) > 0.1 ? d : NaN;
  }
  Object.defineProperty(tpl, '__fitGains', { value: Object.freeze(gains), enumerable: false });
  Object.defineProperty(tpl, '__fitBase', { value: Object.freeze(base), enumerable: false });
  return gains;
}

/**
 * @typedef {Object} FitResult
 * @property {Float32Array} pos              the fitted vertex positions
 * @property {Array<[string, number]>} weights  every morph weight used (macro + measurement)
 * @property {Record<string, number>} sliders   the solved measurement sliders, -1..1
 * @property {number} heightSlider
 * @property {import('./measureTemplate.js').TemplateMeasurements} measured
 * @property {Record<string, number>} residual  wanted - got, in cm, per measurement
 * @property {string[]} clamped              measurements that ran out of morph range
 * @property {number} rounds
 * @property {number} ms
 */

/**
 * Fit the template to `params`.
 * @param {Template} tpl @param {BodyParams} params
 * @param {{rounds?: number, damping?: number, tolerance_cm?: number, out?: Float32Array}} [opts]
 * @returns {FitResult}
 */
export function fitBody(tpl, params, opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const cfg = { ...FIT_DEFAULTS, ...opts };
  const gains = calibrate(tpl);
  const base = /** @type {any} */ (tpl).__fitBase;

  /** @type {Record<string, number>} */
  const sliders = {};
  for (const k of Object.keys(MEASURE_TARGETS)) sliders[k] = 0;

  const buf = opts.out && opts.out.length === tpl.rest.length ? opts.out : new Float32Array(tpl.rest.length);
  let heightSlider = 0.5;
  /** @type {Array<[string, number]>} */
  let weights = [];

  const build = (hs) => {
    weights = [...macroWeightsFor(params, hs), ...sliderTargets(sliders)];
    return applyTargets(tpl, weights, buf);
  };

  // --- height, by secant on the macro height slider ------------------------------------------------
  const wantH = params.height_cm / 100;
  const solveHeight = () => {
    let a = 0.0, b = 1.0;
    let fa = heightOf(tpl, build(a)) - wantH;
    let fb = heightOf(tpl, build(b)) - wantH;
    if (fa > 0) return (heightSlider = 0);          // wanted shorter than the shortest corner body
    if (fb < 0) return (heightSlider = 1);          // taller than the tallest
    for (let i = 0; i < 24 && b - a > 1e-4; i++) {
      const mid = fb !== fa ? Math.min(b, Math.max(a, a + (b - a) * (-fa / (fb - fa)))) : (a + b) / 2;
      const fm = heightOf(tpl, build(mid)) - wantH;
      if (Math.abs(fm) < cfg.heightTolerance_cm / 100) { a = b = mid; fa = fb = fm; break; }
      if (fm < 0) { a = mid; fa = fm; } else { b = mid; fb = fm; }
    }
    return (heightSlider = (a + b) / 2);
  };

  let measured = null;
  /** @type {Record<string, number>} */
  let residual = {};
  let round = 0;

  for (; round < cfg.rounds; round++) {
    solveHeight();
    const pos = build(heightSlider);
    measured = measureTemplate(tpl, pos, { index: buildIndex(tpl, pos) });

    let worst = 0;
    let moved = 0;
    residual = {};
    for (const key of Object.keys(MEASURE_TARGETS)) {
      const want = /** @type {any} */ (params)[key];
      if (typeof want !== 'number' || !Number.isFinite(want)) continue;
      const err = want - measured[key];
      residual[key] = err;
      worst = Math.max(worst, Math.abs(err));
      const g = gains[key];
      if (!Number.isFinite(g) || Math.abs(g) < 1e-6) continue;
      // Rescale the neutral-body gain to this body: a target that adds 4 cm to a 90 cm chest adds
      // roughly 4 * (110/90) cm to a 110 cm one, because the morphs are displacements of a surface
      // that has itself been scaled up by the macro layer.
      const scale = base[key] > 1e-6 ? Math.max(0.4, Math.min(2.5, measured[key] / base[key])) : 1;
      const next = sliders[key] + cfg.damping * err / (g * scale);
      const before = sliders[key];
      sliders[key] = Math.max(-1, Math.min(1, next));
      moved = Math.max(moved, Math.abs(sliders[key] - before));
    }
    // Stop when the fit is good enough, or when the SLIDERS have stopped moving.
    //
    // Residual is the wrong stall signal. Waiting for every residual to reach tolerance never happens,
    // because whichever measurements ran out of morph range hold a fixed error for ever and the loop
    // burns all ten rounds — most of the build's cost. But excluding those clamped dimensions is wrong
    // too: clamping is not permanent. A slider can overshoot to -1 in round three and come back to -0.7
    // by round six as the height solve settles, and quitting on round three left the male chest 3.7 cm
    // out. How far the sliders actually moved this round says "the solver has stopped changing the
    // body" directly, and is indifferent to which dimensions happen to be pinned right now.
    if (worst < cfg.tolerance_cm) { round++; break; }
    if (moved < cfg.stallSlider) { round++; break; }
  }

  solveHeight();
  const pos = build(heightSlider);
  measured = measureTemplate(tpl, pos, { index: buildIndex(tpl, pos) });
  residual = {};
  for (const key of Object.keys(MEASURE_TARGETS)) {
    const want = /** @type {any} */ (params)[key];
    if (typeof want === 'number' && Number.isFinite(want)) residual[key] = want - measured[key];
  }
  residual.height_cm = params.height_cm - measured.height_cm;

  // Pinned at the END. A slider that overshot in round three and came back by round six (see above) is
  // not out of range, and listing it as such was the contract bug the review found.
  const clamped = Object.keys(sliders).filter((k) => Math.abs(sliders[k]) >= 1 - 1e-9);

  return {
    pos, weights, sliders, heightSlider, measured, residual,
    clamped, rounds: round,
    ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  };
}
