// src/body/build.js — body composition: the build description (BMI, adiposity, muscle tone, age) that `weight_kg`,
// `muscle` and `age_y` feed into the torso rings and the limb primitives. Pure; no imports.
//
// WHY THIS FILE EXISTS
// -------------------
// Every girth in BodyParams (chest_cm, underbust_cm, waist_cm, hips_cm, neck_cm, upperArm_cm, thigh_cm, calf_cm, ...)
// is an EXPLICIT input, and loft.js solves each ring's semi-axes so that the measured circumference matches it
// (measure.js ray-casts the baked field and selftest.js asserts the match for every preset). Weight and build must
// therefore never move a measured girth. What they change is the SHAPE AT CONSTANT GIRTH — which is precisely how a
// heavy person and a lean person with the same 80 cm waist differ:
//
//   * the lean section is FLAT front-to-back and wide side-to-side (small depth/width ratio k = b/a);
//   * the heavy section is nearly ROUND (k -> 1) at the same perimeter, so it is narrower and much deeper;
//   * and the extra depth sits IN FRONT of the spine, not behind it — a belly, not a symmetric barrel. In ring terms
//     that is a positive shift of cz, tied to the depth the rounding just added (see loft.js `czForBuild`).
//
// This file only produces the scalars. loft.js and primitives.js decide what to do with them.
//
// FORMULAS
// --------
//   BMI       = weight_kg / (height_cm / 100)^2
//   tone      = clamp(-1, +1, (muscle - MUSCLE_NEUTRAL) / MUSCLE_SPAN)          MUSCLE_NEUTRAL 0.35, MUSCLE_SPAN 0.65
//   BMI_lean  = BMI - MUSCLE_BMI * (muscle - MUSCLE_NEUTRAL)                    MUSCLE_BMI 5.0
//   adiposity = tanh((BMI_lean - BMI_NEUTRAL) / BMI_SPAN)                       BMI_NEUTRAL 22.0, BMI_SPAN 10.0
//   ageF      = clamp(0, 1, (age_y - 30) / 40)                                  0 up to 30 y, 1 at 70 y
//   youth     = clamp(0, 1, (18 - age_y) / 10)                                  1 at <= 8 y, 0 at >= 18 y
//
// REASONING
// ---------
// * BMI is the one composition number the Max Planck body visualiser takes, and it is what the reference anchors are
//   quoted in: 18.5 lean, 25 the overweight threshold, 30+ obese. The sample presets run 16.8 (child_10) to 21.5
//   (female_m) to 32.6 (plus_f).
// * `adiposity` is SIGNED and centred on BMI 22 rather than running 0..1 from 18.5. Centring matters: the ring table
//   in loft.js and the primitive placements in primitives.js were hand-tuned against measure.js on presets whose
//   mean BMI is about 22, so adiposity ~ 0 has to reproduce that tuning exactly. A 0..1 factor anchored at 18.5 would
//   have silently re-shaped (and de-tuned) every existing preset. With this mapping, female_m lands at -0.05 —
//   the default body is the tuned body — and the sliders move away from it in both directions.
// * The span of 10 BMI points puts 18.5 at -0.34, 25 at +0.29 and 30 at +0.66, which tracks the quoted anchors.
// * `tanh` rather than a clamp, for one measured reason: with a hard clamp at +1 the shape stopped moving at BMI 32,
//   so on a 1.65 m frame 95 kg and 120 kg baked to a bit-identical body. tanh has the same slope through 0 (the
//   tuning above is unaffected), never saturates, and still compresses: BMI 35 -> 0.86, 40 -> 0.96, 45 -> 0.99.
// * `BMI_lean` is the standard correction to BMI's standard failure: muscle is denser than fat, so at equal mass and
//   height a trained body carries less fat. 5.0 BMI points across the full 0..1 build slider is about the gap between
//   a sedentary and a well-trained body at the same weight (roughly 8-10 kg of lean mass on a 1.8 m frame). Without
//   it, athletic_m (BMI 24.2) would model as chubbier than female_m (BMI 21.5), which is backwards; with it,
//   athletic_m lands at -0.03 with tone +0.77 and female_m at -0.05 with tone 0.0 — same adiposity, different build,
//   which is exactly the distinction the parameter exists to draw.
// * `tone` is centred on 0.35 (the default preset's value = an average untrained adult). The span is 0.65 so that
//   `muscle = 1` reaches exactly +1 without the clamp biting: a clamped span would have made every build above 0.85
//   look identical, the same failure `tanh` fixes on the other axis.
// * Age does two small, well-attested things and nothing else: fat migrates centrally with age at constant BMI
//   (`ageF` biases the abdominal bulge), and a child's torso is rounder and less waisted than an adult's at the same
//   BMI (`youth` damps the lean flattening, so child_10 at BMI 16.8 does not come out flat as a board).
//
// The scalars are deliberately dimensionless; every metric gain lives in the module that applies it.

/** @typedef {import('../core/types.js').BodyParams} BodyParams */

/**
 * @typedef {Object} BuildDescription
 * @property {number} bmi        weight_kg / (height_m)^2
 * @property {number} bmiLean    BMI corrected for the build slider (muscle displaces fat at equal mass)
 * @property {number} adiposity  -1 (very lean) .. 0 (BMI 22 neutral) .. +1 (obese)
 * @property {number} adipPos    max(adiposity, 0)
 * @property {number} adipNeg    max(-adiposity, 0), damped for children
 * @property {number} tone       -1 .. 0 (untrained, muscle 0.35) .. +1 (athletic)
 * @property {number} tonePos    max(tone, 0)
 * @property {number} ageF       0 up to 30 y, rising to 1 at 70 y
 * @property {number} youth      1 at <= 8 y, falling to 0 at >= 18 y
 */

export const BUILD_TUNING = Object.freeze({
  bmiNeutral: 22.0,     // adiposity = 0 here: mid-healthy, and the mean of the tuned presets
  bmiSpan: 10.0,        // BMI points per unit adiposity before the tanh (18.5 -> -0.34, 25 -> +0.29, 30 -> +0.66)
  muscleBmi: 5.0,       // BMI points of lean mass across the whole build slider
  muscleNeutral: 0.35,  // the default preset's build = an average untrained adult
  muscleSpan: 0.65,     // build units per unit tone; 0.35 + 0.65 = 1.0, so the slider ends exactly at tone +1
  ageNeutral: 30,       // no age effect at or below this
  ageSpan: 40,          // ageF reaches 1 at ageNeutral + ageSpan
  youthEnd: 18,         // youth reaches 0 here
  youthSpan: 10,        // youth reaches 1 at youthEnd - youthSpan
  youthLeanDamp: 0.55,  // fraction of the lean flattening a small child does NOT get
});

/** Neutral description, used when the composition parameters are missing or non-finite. */
const NEUTRAL = Object.freeze({
  bmi: 22, bmiLean: 22, adiposity: 0, adipPos: 0, adipNeg: 0, tone: 0, tonePos: 0, ageF: 0, youth: 0,
});

/** @param {number} v @param {number} lo @param {number} hi @returns {number} */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** @param {*} v @returns {boolean} */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Describe the build implied by height / weight / muscle / age. Cheap (a dozen flops); callers recompute it rather
 * than thread it through, so that every entry point stays a pure function of BodyParams.
 * @param {BodyParams} params @param {Partial<typeof BUILD_TUNING>} [tuning] overrides (tuning scripts only)
 * @returns {BuildDescription}
 */
export function describeBuild(params, tuning) {
  if (!params || !num(params.height_cm) || !num(params.weight_kg)) return { ...NEUTRAL };
  const t = tuning ? { ...BUILD_TUNING, ...tuning } : BUILD_TUNING;
  const h = params.height_cm / 100;
  if (!(h > 0.5)) return { ...NEUTRAL };
  const muscle = num(params.muscle) ? clamp(params.muscle, 0, 1) : t.muscleNeutral;
  const age = num(params.age_y) ? clamp(params.age_y, 2, 110) : t.ageNeutral;

  const bmi = params.weight_kg / (h * h);
  const tone = clamp((muscle - t.muscleNeutral) / t.muscleSpan, -1, 1);
  const bmiLean = bmi - t.muscleBmi * (muscle - t.muscleNeutral);
  const adiposity = Math.tanh((bmiLean - t.bmiNeutral) / t.bmiSpan);
  const ageF = clamp((age - t.ageNeutral) / t.ageSpan, 0, 1);
  const youth = clamp((t.youthEnd - age) / t.youthSpan, 0, 1);

  return {
    bmi,
    bmiLean,
    adiposity,
    adipPos: adiposity > 0 ? adiposity : 0,
    // A child's torso keeps some of its roundness however low the BMI runs.
    adipNeg: adiposity < 0 ? -adiposity * (1 - t.youthLeanDamp * youth) : 0,
    tone,
    tonePos: tone > 0 ? tone : 0,
    ageF,
    youth,
  };
}
