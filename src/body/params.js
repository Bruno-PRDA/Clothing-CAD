// src/body/params.js — slider definitions, clamping and equality (SPEC 6.1). Pure.

import { BODY_PRESETS, DEFAULT_PRESET_ID } from './presets.js';

/** @typedef {import('../core/types.js').BodyParams} BodyParams */

/**
 * Slider definitions in panel order (SPEC 6.1). unit: 'cm' | 'deg' | ''.
 * @type {ReadonlyArray<{key: keyof BodyParams, label: string, min: number, max: number, step: number, unit: 'cm'|'deg'|''}>}
 */
export const PARAM_DEFS = Object.freeze([
  Object.freeze({ key: 'height_cm', label: 'Height', min: 120, max: 210, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'chest_cm', label: 'Chest / bust', min: 60, max: 150, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'underbust_cm', label: 'Underbust', min: 55, max: 130, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'waist_cm', label: 'Waist', min: 50, max: 140, step: 0.5, unit: 'cm' }),
  Object.freeze({ key: 'hips_cm', label: 'Hips', min: 65, max: 160, step: 0.5, unit: 'cm' }),
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

/** The 20 keys in table order. @type {ReadonlyArray<keyof BodyParams>} */
export const PARAM_KEYS = Object.freeze(PARAM_DEFS.map((d) => d.key));

/**
 * NEW BodyParams: each key clamped to [min,max] and rounded to step; missing / non-finite keys → female_m default;
 * extra keys dropped.
 * @param {Partial<BodyParams>|null|undefined} p @returns {BodyParams}
 */
export function clampParams(p) {
  const defaults = BODY_PRESETS[DEFAULT_PRESET_ID];
  const src = p && typeof p === 'object' ? p : {};
  /** @type {any} */
  const out = {};
  for (let i = 0; i < PARAM_DEFS.length; i++) {
    const def = PARAM_DEFS[i];
    let v = /** @type {any} */ (src)[def.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) v = defaults[def.key];
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
 * Strict equality on all 20 keys.
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
