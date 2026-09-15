// src/body/anchors.js — arrangement cylinders (SPEC 6.6). Pure; metres.

/** @typedef {import('../core/types.js').Anchor} Anchor */
/** @typedef {import('../core/types.js').BodyParams} BodyParams */
/** @typedef {import('../core/types.js').Vec3} Vec3 */
/** @typedef {import('./skeleton.js').Skeleton} Skeleton */
/** @typedef {import('./loft.js').Ring} Ring */

export const CLEARANCE = 0.02;
const BREAST_RADIUS_X = 0.070;

/** @param {Vec3} d @returns {Vec3} unit vector = normalize([0,0,1] - (d.z) d), i.e. +z projected off the axis */
function frontOf(d) {
  const dz = d[2];
  let x = -dz * d[0];
  let y = -dz * d[1];
  let z = 1 - dz * d[2];
  const l = Math.sqrt(x * x + y * y + z * z);
  if (l < 1e-9) return [0, 0, 1];
  return [x / l, y / l, z / l];
}

/** @param {Vec3} v @returns {Vec3} */
function unit(v) {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * @param {Skeleton} sk @param {Record<string, Ring>} rings @param {BodyParams} params
 * @returns {Record<'torso'|'armL'|'armR'|'legL'|'legR'|'skirt'|'head', Anchor>}
 */
export function buildAnchors(sk, rings, params) {
  const y = sk.y;
  const m = sk.m;
  const J = sk.joints;
  const D = sk.dirs;
  const TWO_PI = 2 * Math.PI;
  const bust = params.bustFullness;
  const torsoRadius = Math.max(rings.chest.a + 0.5 * BREAST_RADIUS_X * (0.5 + bust), rings.hip.a) + CLEARANCE;
  const armRadius = m.upperArm / TWO_PI + CLEARANCE;
  const legRadius = m.thigh / TWO_PI + CLEARANCE;

  /** @param {Vec3} shoulder @param {Vec3} dUA @returns {Anchor} */
  const arm = (shoulder, dUA) => ({
    origin: [shoulder[0] - 0.04 * dUA[0], shoulder[1] - 0.04 * dUA[1], shoulder[2] - 0.04 * dUA[2]],
    axis: unit(dUA),
    front: frontOf(dUA),
    radius: armRadius,
    length: m.armLen + 0.06,
  });
  /** @param {Vec3} hipJoint @param {Vec3} dLeg @returns {Anchor} */
  const leg = (hipJoint, dLeg) => ({
    origin: [hipJoint[0], hipJoint[1], hipJoint[2]],
    axis: unit(dLeg),
    front: frontOf(dLeg),
    radius: legRadius,
    length: hipJoint[1] - y.ankle,
  });

  return {
    torso: {
      origin: [0, y.neckBase, 0], axis: [0, -1, 0], front: [0, 0, 1],
      radius: torsoRadius, length: y.neckBase - y.crotch + 0.15,
    },
    armL: arm(J.shoulderL, D.dUAL),
    armR: arm(J.shoulderR, D.dUAR),
    legL: leg(J.hipJointL, D.dLegL),
    legR: leg(J.hipJointR, D.dLegR),
    skirt: {
      origin: [0, y.waist + 0.02, 0], axis: [0, -1, 0], front: [0, 0, 1],
      radius: rings.hip.a + CLEARANCE, length: y.waist - y.ankle,
    },
    head: {
      origin: [0, sk.H, 0.01], axis: [0, -1, 0], front: [0, 0, 1],
      radius: 0.41 * m.headH + CLEARANCE, length: m.headH + 0.05,
    },
  };
}
