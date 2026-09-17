// src/body/macro.js — BodyParams -> MakeHuman macro morph weights.
//
// MakeHuman's shape space is a product of a few "macro" sliders, and the shipped targets are the
// CORNERS of that product: one target per (ethnicity, gender, age), one per (gender, age, muscle,
// weight), and one per (gender, age, muscle, weight, height-extreme). A body is the weighted sum of
// the corners, each corner's weight being the product of its factors' weights. That is the whole
// trick behind body-visualizer: a handful of sliders, a few hundred scanned corner shapes.
//
// This module is pure arithmetic — it turns our BodyParams into that weight dictionary and nothing
// else. Hitting exact measurements on top of the macro shape is `fit.js`.

/** @typedef {import('../core/types.js').BodyParams} BodyParams */

/**
 * The three ethnicity targets are blended equally. MakeHuman ships african/asian/caucasian as a
 * partition of unity; we do not ask the user for an ethnicity — a pattern-drafting tool has no
 * business inferring one — so the neutral third-each blend is what we use. The measurement solve
 * then moves the body to the person's actual numbers, which is what a garment is cut from.
 */
export const ETHNICITY = Object.freeze({ african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3 });

/** Age stops we ship. MakeHuman also has 'baby'; a clothing CAD never needs it (see assets build). */
const AGE_STOPS = Object.freeze(['child', 'young', 'old']);
/** MakeHuman's slider positions for those stops. */
const AGE_CHILD = 0.1875, AGE_YOUNG = 0.5, AGE_OLD = 1.0;

const MUSCLE_STOPS = Object.freeze(['minmuscle', 'averagemuscle', 'maxmuscle']);
const WEIGHT_STOPS = Object.freeze(['minweight', 'averageweight', 'maxweight']);

/**
 * MakeHuman's age slider: 1 y at 0, 25 y at 0.5, 90 y at 1. We clamp the bottom to the 'child' stop
 * (~10 y) because we dropped the baby corner; our youngest allowed age is 8, so at most a 2-year
 * body-shape error at the very bottom of the range and none at all from 10 y up.
 * @param {number} years @returns {number} 0..1
 */
export function ageSlider(years) {
  const y = Math.min(90, Math.max(1, years));
  const s = y < 25 ? (y - 1) / 24 * 0.5 : 0.5 + (y - 25) / 65 * 0.5;
  return Math.min(1, Math.max(AGE_CHILD, s));
}

/**
 * Body mass index -> MakeHuman's weight slider. The slider's midpoint is an average build, its ends
 * are the extremes MakeHuman was scanned across; BMI 16 / 22 / 40 is a fair reading of those in real
 * units and keeps the mapping monotone. The girths the user typed are honoured later by `fit.js`, so
 * this only has to put the body in the right neighbourhood.
 * @param {number} bmi @returns {number} 0..1
 */
export function weightSlider(bmi) {
  const b = Math.min(45, Math.max(13, bmi));
  return b < 22 ? Math.max(0, (b - 16) / 12) : Math.min(1, 0.5 + (b - 22) / 36);
}

/**
 * Split a 0..1 slider across three stops so the weights sum to 1 and only two are ever non-zero.
 * @param {number} t @param {ReadonlyArray<string>} stops @returns {Array<[string, number]>}
 */
function triStop(t, stops) {
  const v = Math.min(1, Math.max(0, t));
  if (v <= 0.5) {
    const u = v * 2;
    return [[stops[0], 1 - u], [stops[1], u], [stops[2], 0]];
  }
  const u = (v - 0.5) * 2;
  return [[stops[1], 1 - u], [stops[2], u], [stops[0], 0]];
}

/**
 * Age weights over (child, young, old), summing to 1.
 * @param {number} slider @returns {Array<[string, number]>}
 */
function ageStops(slider) {
  if (slider < AGE_YOUNG) {
    const u = (slider - AGE_CHILD) / (AGE_YOUNG - AGE_CHILD);
    return [['child', 1 - u], ['young', u], ['old', 0]];
  }
  const u = (slider - AGE_YOUNG) / (AGE_OLD - AGE_YOUNG);
  return [['child', 0], ['young', 1 - u], ['old', u]];
}

/**
 * @typedef {Object} MacroSliders
 * @property {number} female   1 = fully female, 0 = fully male (our `sex` param, not MakeHuman's
 *                             inverted `gender` slider — keeping our own sense avoids an off-by-one-
 *                             concept bug that silently swaps every body)
 * @property {number} age      MakeHuman age slider
 * @property {number} muscle   0..1
 * @property {number} weight   0..1 (from BMI)
 * @property {number} height   0..1, 0.5 = the corner bodies' own height
 */

/**
 * @param {BodyParams} p @returns {MacroSliders}
 */
export function macroSliders(p) {
  const h = p.height_cm / 100;
  const bmi = p.weight_kg / (h * h);
  return {
    female: typeof p.sex === 'number' ? Math.min(1, Math.max(0, p.sex)) : (p.bustFullness > 0 ? 1 : 0),
    age: ageSlider(p.age_y),
    muscle: Math.min(1, Math.max(0, p.muscle)),
    weight: weightSlider(bmi),
    height: 0.5,
  };
}

/**
 * Expand macro sliders into target weights. `height` is a separate layer on top of the muscle/weight
 * corners: MakeHuman ships only the two extremes, so we scale whichever extreme the slider points at.
 *
 * @param {MacroSliders} s
 * @returns {Map<string, number>} target name -> weight, ready for `applyTargets`
 */
export function macroWeights(s) {
  /** @type {Map<string, number>} */
  const out = new Map();
  const add = (name, w) => { if (w > 1e-6) out.set(name, (out.get(name) || 0) + w); };

  const genders = [['female', s.female], ['male', 1 - s.female]];
  const ages = ageStops(s.age);
  const muscles = triStop(s.muscle, MUSCLE_STOPS);
  const weights = triStop(s.weight, WEIGHT_STOPS);

  // height layer: 0.5 is the corner bodies as scanned; either side pulls toward one shipped extreme
  const hx = Math.min(1, Math.max(0, s.height));
  const heightEnd = hx < 0.5 ? 'minheight' : 'maxheight';
  const heightAmt = Math.abs(hx - 0.5) * 2;

  for (const [g, wg] of genders) {
    if (wg <= 1e-6) continue;
    for (const [a, wa] of ages) {
      if (wa <= 1e-6) continue;
      const ga = wg * wa;

      // 1. ethnicity x gender x age — the base human
      for (const e of Object.keys(ETHNICITY)) add(`macro/${e}-${g}-${a}`, ETHNICITY[e] * ga);

      // 2. gender x age x muscle x weight — build. The average/average corner is identity (MakeHuman
      //    ships it as an all-zero file, so our asset build drops it); `add` simply never finds it.
      for (const [m, wm] of muscles) {
        if (wm <= 1e-6) continue;
        for (const [w, ww] of weights) {
          if (ww <= 1e-6) continue;
          const corner = `${g}-${a}-${m}-${w}`;
          add(`macro/universal-${corner}`, ga * wm * ww);
          if (heightAmt > 1e-6) add(`height/${corner}-${heightEnd}`, ga * wm * ww * heightAmt);
        }
      }
    }
  }
  return out;
}

/**
 * Convenience: BodyParams -> target weights, with an explicit height slider override (used by the
 * height solve in `fit.js`, which bisects this slider to hit height_cm).
 * @param {BodyParams} p @param {number} [heightSlider]
 * @returns {Map<string, number>}
 */
export function macroWeightsFor(p, heightSlider) {
  const s = macroSliders(p);
  if (typeof heightSlider === 'number') s.height = heightSlider;
  return macroWeights(s);
}
