// src/body/skeleton.js — landmark heights, joints and limb directions (SPEC 6.2). Pure; metres, y up, +x = model's LEFT.

/** @typedef {import('../core/types.js').BodyParams} BodyParams */
/** @typedef {import('../core/types.js').Vec3} Vec3 */

/**
 * @typedef {Object} Skeleton
 * @property {number} H            height, m
 * @property {number} s            scale factor H / 1.75
 * @property {Record<string, number>} y   landmark heights: headTop, chin, neckBase, shoulder, armpit, waist, chest, underbust, crotch, hip, knee, ankle
 * @property {Record<string, Vec3>} landmarks   BodyModel.landmarks (SPEC 6.2)
 * @property {Record<string, Vec3>} joints      shoulderL/R, elbowL/R, wristL/R, handL/R, hipJointL/R, kneeL/R, ankleL/R, footEndL/R
 * @property {{dUAL: Vec3, dUAR: Vec3, dFAL: Vec3, dFAR: Vec3, dLegL: Vec3, dLegR: Vec3}} dirs   unit directions (shoulder→elbow, elbow→wrist, hip→ankle)
 * @property {Record<string, number>} m   the parameters converted to metres / radians: headH, T, inseam, armLen, shoulderW, neck, upperArm, forearm, wrist, thigh, calf, ankle, bust, abd, spread
 */

/** @param {number} x @param {number} y @param {number} z @returns {Vec3} */
function norm3(x, y, z) {
  const l = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / l, y / l, z / l];
}

/** @param {Vec3} p @param {Vec3} d @param {number} t @returns {Vec3} */
function along(p, d, t) {
  return [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
}

/**
 * A-pose constants.
 *
 * SPEC 6.2 builds the forearm along `abd - 5 deg`, i.e. it folds BACK IN under the elbow, so the forearm and the
 * hand hang in the narrow slot between the upper arm and the waist. That slot is exactly where the baked field's
 * medial ridge lives, and with three surfaces crossing there (waist, elbow, forearm) every 15 mm cell in it
 * interpolates a near-zero gradient — the failures of 6.9 case 5 sat in that slot. A fitting A-pose carries the
 * forearm OUTWARD instead (the arm is straight, not bent in at the elbow), which both widens the slot and reduces
 * it to a single two-surface ridge, and it is what a dress form actually looks like. `forearmSplay` is therefore
 * +10 deg rather than -5.
 *
 * `shoulderOutset` (metres at H = 1.75, scaled by s) moves the arm root laterally off the acromion. It is kept at
 * SPEC 6.2's 0: raising it buys armpit clearance but makes the model visibly broad-shouldered, and the clearance
 * of 6.9 case 4 is met without it once the torso rings are correct (see loft.js).
 */
export const SKELETON_TUNING = Object.freeze({
  shoulderOutset: 0,       // metres at H = 1.75, scaled by s; SPEC 6.2: 0
  forearmSplay: 10,        // degrees added to armAbduction for the forearm; SPEC 6.2: -5
});

/**
 * @param {BodyParams} params  already clamped
 * @param {Partial<typeof SKELETON_TUNING>} [tuning]  overrides (tuning scripts only)
 * @returns {Skeleton}
 */
export function buildSkeleton(params, tuning) {
  const t = tuning ? { ...SKELETON_TUNING, ...tuning } : SKELETON_TUNING;
  const H = params.height_cm / 100;
  const s = H / 1.75;
  const headH = params.headHeight_cm / 100;
  const T = params.torsoLength_cm / 100;
  const inseam = params.inseam_cm / 100;
  const armLen = params.armLength_cm / 100;
  const shoulderW = params.shoulderWidth_cm / 100;
  const abd = params.armAbduction_deg * Math.PI / 180;
  const spread = params.legSpread_deg * Math.PI / 180;

  const headTop = H;
  const chin = H - headH;
  const neckBase = chin - 0.012 * H;
  const shoulder = neckBase - 0.035 * H;
  const armpit = shoulder - 0.060 * H;
  const waist = neckBase - T;
  const chest = waist + 0.45 * T;
  const underbust = waist + 0.28 * T;
  const crotch = inseam;
  const hip = crotch + 0.40 * (waist - crotch);
  const knee = 0.285 * H;
  const ankle = 0.040 * H;
  const y = { headTop, chin, neckBase, shoulder, armpit, waist, chest, underbust, crotch, hip, knee, ankle };

  // Arms (left = +x).
  const shoulderY = shoulder - 0.02 * H;
  const shoulderX = shoulderW / 2 + t.shoulderOutset * s;
  const shoulderL = [shoulderX, shoulderY, 0];
  const shoulderR = [-shoulderX, shoulderY, 0];
  const dUAL = norm3(Math.sin(abd), -Math.cos(abd), 0.087);
  const dUAR = norm3(-Math.sin(abd), -Math.cos(abd), 0.087);
  const abdF = abd + t.forearmSplay * Math.PI / 180;
  const dFAL = norm3(Math.sin(abdF), -Math.cos(abdF), 0.12);
  const dFAR = norm3(-Math.sin(abdF), -Math.cos(abdF), 0.12);
  const elbowL = along(shoulderL, dUAL, 0.53 * armLen);
  const elbowR = along(shoulderR, dUAR, 0.53 * armLen);
  const wristL = along(elbowL, dFAL, 0.47 * armLen);
  const wristR = along(elbowR, dFAR, 0.47 * armLen);
  const handL = along(wristL, dFAL, 0.09 * s);
  const handR = along(wristR, dFAR, 0.09 * s);

  // Legs.
  const hipX = 0.095 * s * Math.sqrt(params.hips_cm / 96);
  const hipJointY = crotch + 0.03 * H;
  const hipJointL = [hipX, hipJointY, 0];
  const hipJointR = [-hipX, hipJointY, 0];
  const half = spread / 2;
  const dLegL = norm3(Math.sin(half), -Math.cos(half), 0);
  const dLegR = norm3(-Math.sin(half), -Math.cos(half), 0);
  const cosHalf = Math.cos(half);
  const tKnee = Math.max(hipJointY - knee, 0.01) / cosHalf;
  const tAnkle = Math.max(hipJointY - ankle, 0.02) / cosHalf;
  const kneeL = along(hipJointL, dLegL, tKnee);
  const kneeR = along(hipJointR, dLegR, tKnee);
  const ankleL = along(hipJointL, dLegL, tAnkle);
  const ankleR = along(hipJointR, dLegR, tAnkle);
  const footEndL = [ankleL[0], ankleL[1] - 0.03, ankleL[2] + 0.20 * s];
  const footEndR = [ankleR[0], ankleR[1] - 0.03, ankleR[2] + 0.20 * s];

  const landmarks = {
    headTop: [0, H, 0.01],
    chin: [0, chin, 0.03],
    neckBase: [0, neckBase, -0.01],
    shoulderL, shoulderR, elbowL, elbowR, wristL, wristR,
    chestCenter: [0, chest, 0],
    waistCenter: [0, waist, 0],
    hipCenter: [0, hip, 0],
    crotch: [0, crotch, 0],
    hipJointL, hipJointR, kneeL, kneeR, ankleL, ankleR,
  };
  const joints = {
    shoulderL, shoulderR, elbowL, elbowR, wristL, wristR, handL, handR,
    hipJointL, hipJointR, kneeL, kneeR, ankleL, ankleR, footEndL, footEndR,
  };
  const m = {
    headH, T, inseam, armLen, shoulderW, abd, spread,
    neck: params.neck_cm / 100, upperArm: params.upperArm_cm / 100, forearm: params.forearm_cm / 100,
    wrist: params.wrist_cm / 100, thigh: params.thigh_cm / 100, calf: params.calf_cm / 100, ankle: params.ankle_cm / 100,
    chest: params.chest_cm / 100, underbust: params.underbust_cm / 100, waist: params.waist_cm / 100, hips: params.hips_cm / 100,
    bust: params.bustFullness,
  };
  return { H, s, y, landmarks, joints, dirs: { dUAL, dUAR, dFAL, dFAR, dLegL, dLegR }, m };
}
