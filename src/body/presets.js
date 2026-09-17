// src/body/presets.js — body presets (SPEC 6.1). Pure data; imports only types.

/** @typedef {import('../core/types.js').BodyParams} BodyParams */

export const DEFAULT_PRESET_ID = 'female_m';

/** @param {number[]} v @returns {BodyParams} */
function preset(v) {
  return Object.freeze({
    height_cm: v[0], chest_cm: v[1], underbust_cm: v[2], waist_cm: v[3], hips_cm: v[4], shoulderWidth_cm: v[5], neck_cm: v[6],
    upperArm_cm: v[7], forearm_cm: v[8], wrist_cm: v[9], thigh_cm: v[10], calf_cm: v[11], ankle_cm: v[12], armLength_cm: v[13],
    inseam_cm: v[14], torsoLength_cm: v[15], headHeight_cm: v[16], bustFullness: v[17], armAbduction_deg: v[18], legSpread_deg: v[19],
    weight_kg: v[20], muscle: v[21], age_y: v[22],
  });
}

/** Frozen; insertion order = UI order (SPEC 6.1 table). @type {Readonly<Record<string, BodyParams>>} */
export const BODY_PRESETS = Object.freeze({
  female_s: preset([160, 84, 72, 66, 92, 37, 33, 25.5, 22, 15, 51, 34.5, 21.5, 54, 74, 39, 21.5, 0.35, 30, 6, 53, 0.3, 28]),
  female_m: preset([165, 88, 76, 70, 96, 38, 34, 27, 23, 15.5, 54, 36, 22, 56, 76, 40, 22, 0.4, 30, 6, 58.5, 0.35, 30]),
  female_l: preset([170, 96, 82, 78, 104, 40, 35.5, 30, 25, 16.5, 58, 38, 23, 58, 78, 41.5, 22.5, 0.5, 30, 6, 70, 0.3, 35]),
  male_s: preset([172, 92, 85, 78, 94, 44, 37.5, 28, 25.5, 17, 53, 36.5, 23, 60, 80, 43, 22.5, 0, 30, 6, 65, 0.45, 28]),
  male_m: preset([178, 98, 90, 84, 98, 46, 39, 30, 27, 17.5, 56, 38, 23.5, 62, 82, 44, 23, 0, 30, 6, 75, 0.5, 32]),
  male_l: preset([184, 108, 98, 96, 106, 48, 41, 33, 29, 18.5, 61, 40.5, 24.5, 64, 84, 46, 23.5, 0, 30, 6, 92, 0.4, 45]),
  child_10: preset([140, 68, 62, 60, 72, 31, 28, 20, 18, 13, 40, 28, 19, 47, 65, 33, 20, 0, 30, 6, 33, 0.3, 10]),
  plus_f: preset([168, 112, 98, 100, 122, 41, 38, 36, 28, 17.5, 68, 43, 25, 57, 76, 41, 22.5, 0.7, 32, 8, 92, 0.25, 40]),
  athletic_m: preset([182, 104, 94, 82, 98, 49, 40, 34, 29, 18, 60, 40, 24, 64, 84, 45, 23, 0, 30, 6, 80, 0.85, 27]),
});

/** @type {Readonly<Record<string, string>>} */
export const PRESET_LABELS = Object.freeze({
  female_s: 'Female S', female_m: 'Female M', female_l: 'Female L', male_s: 'Male S', male_m: 'Male M', male_l: 'Male L',
  child_10: 'Child (10 y)', plus_f: 'Female plus', athletic_m: 'Male athletic',
});

/** @returns {{id: string, label: string}[]} */
export function listPresets() {
  return Object.keys(BODY_PRESETS).map((id) => ({ id, label: PRESET_LABELS[id] }));
}
