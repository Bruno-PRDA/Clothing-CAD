// src/body/params.js — slider definitions, clamping and equality (SPEC 6.1). Pure.

import { BODY_PRESETS, DEFAULT_PRESET_ID } from './presets.js';

/** @typedef {import('../core/types.js').BodyParams} BodyParams */

/**
 * Slider definitions in panel order (SPEC 6.1). unit: 'cm' | 'deg' | ''.
 * @type {ReadonlyArray<{key: keyof BodyParams, label: string, min: number, max: number, step: number, unit: 'cm'|'kg'|'deg'|'y'|''}>}
 */
export const PARAM_DEFS = Object.freeze([
  Object.freeze({ key: 'height_cm', label: 'Height', min: 120, max: 210, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'chest_cm', label: 'Chest / bust', min: 60, max: 150, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'underbust_cm', label: 'Underbust', min: 55, max: 130, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'waist_cm', label: 'Waist', min: 50, max: 140, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'hips_cm', label: 'Hips', min: 65, max: 160, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'weight_kg', label: 'Weight', min: 25, max: 200, step: 0.5, unit: 'kg' }),
  Object.freeze({ key: 'muscle', label: 'Build / exercise', min: 0, max: 1, step: 0.01, unit: '' }),
  Object.freeze({ key: 'age_y', label: 'Age', min: 8, max: 90, step: 1, unit: 'y' }),
  Object.freeze({ key: 'sex', label: 'Sex (male → female)', min: 0, max: 1, step: 0.01, unit: '' }),
  Object.freeze({ key: 'shoulderWidth_cm', label: 'Shoulder width', min: 28, max: 56, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'neck_cm', label: 'Neck', min: 26, max: 50, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'upperArm_cm', label: 'Upper arm', min: 18, max: 50, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'forearm_cm', label: 'Forearm', min: 16, max: 40, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'wrist_cm', label: 'Wrist', min: 12, max: 24, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'thigh_cm', label: 'Thigh', min: 35, max: 85, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'calf_cm', label: 'Calf', min: 25, max: 55, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'ankle_cm', label: 'Ankle', min: 16, max: 32, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'armLength_cm', label: 'Arm length', min: 40, max: 80, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'inseam_cm', label: 'Inseam', min: 50, max: 100, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'torsoLength_cm', label: 'Back length', min: 30, max: 55, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'headHeight_cm', label: 'Head height', min: 17, max: 27, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'bustFullness', label: 'Bust fullness', min: 0, max: 1, step: 0.01, unit: '' }),
  Object.freeze({ key: 'armAbduction_deg', label: 'Arm angle (A-pose)', min: 15, max: 60, step: 1, unit: 'deg' }),
  Object.freeze({ key: 'legSpread_deg', label: 'Leg spread', min: 0, max: 20, step: 1, unit: 'deg' }),
]);

/** The 24 keys in table order. @type {ReadonlyArray<keyof BodyParams>} */
export const PARAM_KEYS = Object.freeze(PARAM_DEFS.map((d) => d.key));

/**
 * Girth model: each circumference as a multiple of a reference circumference, as a linear function of
 * [1, BMI - 22, muscle - 0.4, bustFullness]. See `estimateMeasurements` for the reference and the fit.
 * @type {Readonly<Record<string, [number, number, number, number]>>}
 */
const GIRTH_MODEL = Object.freeze({
  chest_cm: [1.31958, 0.00628, 0.16126, 0.00650],
  underbust_cm: [1.20366, 0.00909, 0.10785, -0.14968],
  waist_cm: [1.14183, 0.01689, -0.17648, -0.22792],
  hips_cm: [1.34291, -0.00089, -0.02580, 0.20504],
  neck_cm: [0.52764, -0.00169, 0.04699, -0.05432],
  upperArm_cm: [0.39810, 0.00299, 0.11860, 0.03670],
  forearm_cm: [0.35763, 0.00149, 0.07520, -0.02549],
  wrist_cm: [0.23979, -0.00103, 0.01480, -0.01934],
  thigh_cm: [0.75990, 0.00048, 0.11000, 0.11223],
  calf_cm: [0.51945, -0.00182, 0.05685, 0.04227],
  ankle_cm: [0.32962, -0.00315, -0.00136, 0.00099],
  shoulderWidth_cm: [0.60981, -0.00102, 0.14060, -0.09695],
});

/** Lengths as a fraction of height; the head is relatively larger on a child, hence the age term. */
const LENGTH_MODEL = Object.freeze({
  armLength_cm: 0.343, inseam_cm: 0.462, torsoLength_cm: 0.243, headHeight_cm: 0.133,
});

/**
 * Estimate a whole body from a few real-world numbers — the flow body-visualizer.com uses, where height, weight,
 * build and age are enough to produce a plausible person and the individual girths are a refinement rather than a
 * requirement.
 *
 * The reference is the circumference a uniform cylinder would have if it had the person's height and their mass at
 * the density of water: `C = 2 * sqrt(pi * 1000 * weight_kg / height_cm)` cm. That single number already carries
 * most of the size information — across the nine presets the waist is 1.02 to 1.21 times it, the chest 1.25 to 1.40
 * and the hips 1.32 to 1.47 — and what is left is explained by how the mass is distributed. Each girth is therefore
 * `C * (c0 + c1*(BMI - 22) + c2*(muscle - 0.4) + c3*bustFullness)`, with the coefficients fitted by least squares to
 * the nine presets (GIRTH_MODEL). They come out anatomically sensible: the waist grows with BMI (+0.017 per unit)
 * and shrinks with build (-0.176) and with bust fullness (-0.228), the chest is driven mostly by build (+0.161), the
 * hips mostly by bust fullness (+0.205). Worst residual over the nine presets is 2.3 cm at the waist and under 1 cm
 * for most girths. Lengths are simple fractions of height (LENGTH_MODEL).
 *
 * Anything already present in `partial` is KEPT, so this fills in what the user has not set rather than overwriting
 * their measurements; pass `{ overwrite: true }` to re-estimate every derived measurement instead.
 *
 * @param {Partial<BodyParams>|null|undefined} partial at minimum height_cm and weight_kg; the rest is filled in
 * @param {{overwrite?: boolean}} [opts]
 * @returns {BodyParams}
 */
export function estimateMeasurements(partial, opts) {
  const base = clampParams(partial);
  const overwrite = !!(opts && opts.overwrite);
  const given = /** @type {Record<string, unknown>} */ (partial || {});
  const H = base.height_cm;
  const W = base.weight_kg;
  const bmi = W / ((H / 100) * (H / 100));
  const C = 2 * Math.sqrt(Math.PI * 1000 * W / H);
  const x1 = bmi - 22;
  const x2 = base.muscle - 0.4;
  const x3 = base.bustFullness;
  /** @type {Record<string, number>} */
  const out = { ...base };
  for (const key of Object.keys(GIRTH_MODEL)) {
    if (!overwrite && typeof given[key] === 'number') continue;
    const k = GIRTH_MODEL[key];
    out[key] = C * (k[0] + k[1] * x1 + k[2] * x2 + k[3] * x3);
  }
  for (const key of Object.keys(LENGTH_MODEL)) {
    if (!overwrite && typeof given[key] === 'number') continue;
    // A child's head is a larger fraction of its height; taper that back to the adult ratio by about 16 years.
    const childish = key === 'headHeight_cm' ? Math.max(0, (16 - base.age_y) / 16) * 0.08 : 0;
    out[key] = H * (LENGTH_MODEL[key] + childish);
  }
  return clampParams(out);
}

/**
 * NEW BodyParams: each key clamped to [min,max] and rounded to step; missing / non-finite keys → female_m default;
 * extra keys dropped.
 * @param {Partial<BodyParams>|null|undefined} p @returns {BodyParams}
 */
export function clampParams(p) {
  const defaults = BODY_PRESETS[DEFAULT_PRESET_ID];
  const src = p && typeof p === 'object' ? p : {};
  // A partial without `sex` takes it from bust fullness, not from the female_m default: the default
  // turned estimateMeasurements({height 180, weight 95, bustFullness 0}) into a 95 kg woman.
  const bust = /** @type {any} */ (src).bustFullness;
  const sexFallback = typeof bust === 'number' && Number.isFinite(bust) && bust > 0.05 ? 1 : 0;
  /** @type {any} */
  const out = {};
  for (let i = 0; i < PARAM_DEFS.length; i++) {
    const def = PARAM_DEFS[i];
    let v = /** @type {any} */ (src)[def.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) v = def.key === 'sex' ? sexFallback : defaults[def.key];
    if (v < def.min) v = def.min;
    if (v > def.max) v = def.max;
    const n = Math.round((v - def.min) / def.step);
    v = def.min + n * def.step;
    v = Math.round(v * 1e6) / 1e6;
    if (v < def.min) v = def.min;
    if (v > def.max) v = def.max;
    out[def.key] = v;
  }
  return out;
}

/**
 * Strict equality on every key of PARAM_KEYS (24).
 * @param {BodyParams} a @param {BodyParams} b @returns {boolean}
 */
export function paramsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  for (let i = 0; i < PARAM_KEYS.length; i++) {
    const k = PARAM_KEYS[i];
    if (a[k] !== b[k]) return false;
  }
  return true;
}
