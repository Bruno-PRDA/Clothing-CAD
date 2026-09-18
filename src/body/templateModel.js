// src/body/templateModel.js — build a BodyModel from the MakeHuman template mesh.
//
// The point of this file is that NOTHING downstream has to change. `buildBody` used to loft superellipse
// rings and blend ellipsoids; now it fits a scanned template and slices it. Either way the rest of the
// app receives the same object: {params, landmarks, anchors, rings, sdf, geometry, measured, buildMs}.
//
// Two of those fields are the reason this works at all:
//
//   rings     `anchors.js` reads `rings.chest.a` and `rings.hip.a` — the half-width of the torso at two
//             heights. That is a *measurement* of a body, not a fact about how the body was built, so
//             the same numbers come off a mesh cross-section (section.js) as came off the loft.
//   skeleton  `buildAnchors` wants heights, joint positions and limb directions. MakeHuman ships a cube
//             of 8 vertices at every joint, carried along by the morphs, so the joints are read rather
//             than estimated — and they are the real ones, not a proportional guess.
//
// So the analytic body's whole contract survives as a thin adapter, and `arrange`, the anchors gizmo,
// the exports and the acceptance suite never learn that the body changed.

import { fitBody } from './fit.js';
import { measureTemplate } from './measureTemplate.js';
import { buildIndex, girthAt } from './section.js';
import { computeNormals, jointAt } from './template.js';
import { bakeMeshSdf } from './sdfMesh.js';
import { buildAnchors } from './anchors.js';
import { RING_NAMES, SUPERELLIPSE_N } from './loft.js';

/** @typedef {import('./template.js').Template} Template */
/** @typedef {import('../core/types.js').BodyParams} BodyParams */
/** @typedef {import('../core/types.js').BodyModel} BodyModel */
/** @typedef {import('../core/types.js').Vec3} Vec3 */

export const CELL_FULL = 0.015;
export const CELL_COARSE = 0.030;

/** @param {string} message @param {string} [detail] @returns {Error & {code: string}} */
function bodyError(message, detail) {
  const err = /** @type {Error & {code: string}} */ (new Error('BodyError: ' + message + (detail ? ' (' + detail + ')' : '')));
  err.code = 'BodyError';
  return err;
}

/**
 * Put the feet back on y = 0.
 *
 * The template is normalised at load so the REST body stands on the floor, but every morph moves
 * vertices in y — the height targets most of all — so a fitted body ends up floating or sunk. Measured
 * before this existed: female -6.5 cm, child -3.5 cm, and the male macro body a full +13.1 cm in the
 * air. Nothing complains, because height and every girth are measured relative to the body's own
 * extremes; what breaks is everything SPATIAL. SPEC 6.1 puts the feet on y = 0, and the anchors, the
 * arrange cylinders, the floor plane and the shadow all take that literally, so a floating body hangs
 * its garment 13 cm too high.
 *
 * The joint cubes move with the surface, so the landmarks stay attached.
 * @param {Template} tpl @param {Float32Array} pos
 */
function ground(tpl, pos) {
  let minY = Infinity;
  for (let i = 0; i < tpl.nBodyVerts; i++) {
    const y = pos[i * 3 + 1];
    if (y < minY) minY = y;
  }
  if (!Number.isFinite(minY) || Math.abs(minY) < 1e-7) return;
  for (let i = 0, n = pos.length; i < n; i += 3) pos[i + 1] -= minY;
}

/** @param {number[]|null} v @param {Vec3} fallback @returns {Vec3} */
function v3(v, fallback) {
  return (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) ? /** @type {Vec3} */ ([v[0], v[1], v[2]]) : fallback;
}

/** unit vector from a to b @param {Vec3} a @param {Vec3} b @returns {Vec3} */
function dir(a, b) {
  const x = b[0] - a[0], y = b[1] - a[1], z = b[2] - a[2];
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/**
 * The heights of the nine loft rings, derived from what `measureTemplate` already located on this body.
 * The three it does not search for (abdomen, armpit, shoulder) are placed between the ones it did, at
 * the same proportions the analytic loft used, so a garment anchored to them lands where it used to.
 * @param {import('./measureTemplate.js').TemplateMeasurements} m @param {number} height
 * @returns {Record<string, number>}
 */
function ringHeights(m, height) {
  const L = m.levels;
  return {
    crotch: L.crotch,
    hip: L.hips,
    abdomen: (L.hips + L.waist) / 2,
    waist: L.waist,
    underbust: L.underbust,
    chest: L.bust,
    armpit: L.armpit,
    shoulder: L.shoulder,
    neckBase: L.neck - height * 0.012,
  };
}

/**
 * Slice the mesh at each ring height and record the cross-section the way the loft used to describe it:
 * half-width `a`, half-depth `b`, centre offset `cz`. `n` is carried for shape compatibility only —
 * nothing downstream reads it now that the surface is a mesh.
 * @param {import('./section.js').SectionIndex} ix @param {Record<string, number>} ys
 * @returns {Record<string, {y: number, a: number, b: number, n: number, cz: number}>}
 */
function ringsFromMesh(ix, ys) {
  /** @type {Record<string, any>} */
  const rings = {};
  for (const name of RING_NAMES) {
    const y = ys[name];
    const g = Number.isFinite(y) ? girthAt(ix, y, {}) : null;
    rings[name] = g
      ? { y, a: g.width / 2, b: g.depth / 2, n: SUPERELLIPSE_N, cz: g.cz }
      : { y: Number.isFinite(y) ? y : 0, a: 0.15, b: 0.10, n: SUPERELLIPSE_N, cz: 0 };
  }
  return rings;
}

/**
 * Adapt the template's joint cubes into the shape `buildAnchors` expects of a Skeleton.
 * @param {Template} tpl @param {Float32Array} pos
 * @param {import('./measureTemplate.js').TemplateMeasurements} m @param {BodyParams} params
 * @returns {any}
 */
function skeletonFromTemplate(tpl, pos, m, params) {
  const J = (n, fb) => v3(jointAt(tpl, pos, n), fb);
  const H = m.height_cm / 100;
  const L = m.levels;

  const shoulderL = J('l-shoulder', [0.19, H * 0.80, 0]);
  const shoulderR = J('r-shoulder', [-shoulderL[0], shoulderL[1], shoulderL[2]]);
  const elbowL = J('l-elbow', [0.32, H * 0.68, 0]);
  const elbowR = J('r-elbow', [-elbowL[0], elbowL[1], elbowL[2]]);
  const wristL = J('l-hand', [0.42, H * 0.56, 0]);
  const wristR = J('r-hand', [-wristL[0], wristL[1], wristL[2]]);
  const hipJointL = J('l-upper-leg', [0.09, L.crotch + 0.04, 0]);
  const hipJointR = J('r-upper-leg', [-hipJointL[0], hipJointL[1], hipJointL[2]]);
  const kneeL = J('l-knee', [0.10, H * 0.28, 0]);
  const kneeR = J('r-knee', [-kneeL[0], kneeL[1], kneeL[2]]);
  const ankleL = J('l-ankle', [0.10, H * 0.04, 0]);
  const ankleR = J('r-ankle', [-ankleL[0], ankleL[1], ankleL[2]]);
  const headJ = J('head', [0, H * 0.90, 0]);

  const y = {
    headTop: H,
    chin: H - m.headHeight_cm / 100,
    neckBase: L.neck - H * 0.012,
    shoulder: L.shoulder,
    armpit: L.armpit,
    waist: L.waist,
    chest: L.bust,
    underbust: L.underbust,
    crotch: L.crotch,
    hip: L.hips,
    knee: kneeL[1],
    ankle: ankleL[1],
  };

  const dUAL = dir(shoulderL, elbowL);
  const dUAR = dir(shoulderR, elbowR);
  const dFAL = dir(elbowL, wristL);
  const dFAR = dir(elbowR, wristR);
  const dLegL = dir(hipJointL, kneeL);
  const dLegR = dir(hipJointR, kneeR);

  const cm = (v) => v / 100;
  const mm = {
    headH: cm(m.headHeight_cm), T: cm(m.torsoLength_cm), inseam: cm(m.inseam_cm), armLen: cm(m.armLength_cm),
    shoulderW: cm(m.shoulderWidth_cm), abd: (params.armAbduction_deg || 30) * Math.PI / 180,
    spread: (params.legSpread_deg || 6) * Math.PI / 180,
    neck: cm(m.neck_cm), upperArm: cm(m.upperArm_cm), forearm: cm(m.forearm_cm), wrist: cm(m.wrist_cm),
    thigh: cm(m.thigh_cm), calf: cm(m.calf_cm), ankle: cm(m.ankle_cm),
    chest: cm(m.chest_cm), underbust: cm(m.underbust_cm), waist: cm(m.waist_cm), hips: cm(m.hips_cm),
    bust: params.bustFullness,
  };

  const landmarks = {
    headTop: /** @type {Vec3} */ ([0, H, 0.01]),
    chin: /** @type {Vec3} */ ([0, y.chin, 0.03]),
    neckBase: /** @type {Vec3} */ ([0, y.neckBase, -0.01]),
    shoulderL, shoulderR, elbowL, elbowR, wristL, wristR,
    chestCenter: /** @type {Vec3} */ ([0, y.chest, 0]),
    waistCenter: /** @type {Vec3} */ ([0, y.waist, 0]),
    hipCenter: /** @type {Vec3} */ ([0, y.hip, 0]),
    crotch: /** @type {Vec3} */ ([0, y.crotch, 0]),
    hipJointL, hipJointR, kneeL, kneeR, ankleL, ankleR,
    head: headJ,
  };

  return {
    H, s: H / 1.65, y, landmarks,
    joints: { shoulderL, shoulderR, elbowL, elbowR, wristL, wristR, hipJointL, hipJointR, kneeL, kneeR, ankleL, ankleR },
    dirs: { dUAL, dUAR, dFAL, dFAR, dLegL, dLegR },
    m: mm,
  };
}

/**
 * Build the whole model from the template.
 *
 * @param {Template} tpl
 * @param {BodyParams} params
 * @param {{cell?: number, rounds?: number, reuseGeometry?: any}} [opts]
 * @returns {BodyModel}
 */
export function buildTemplateBody(tpl, params, opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (!tpl || !tpl.rest) throw bodyError('template not loaded');
  const cell = Number.isFinite(opts.cell) && opts.cell > 0 ? Number(opts.cell) : CELL_FULL;

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const timing = {};
  let tk = now();
  const lap = (k) => { timing[k] = now() - tk; tk = now(); };

  const fit = fitBody(tpl, params, Number.isFinite(opts.rounds) ? { rounds: opts.rounds } : undefined);
  const pos = fit.pos;
  ground(tpl, pos);
  lap('fit');

  // Measured AFTER grounding, never reusing `fit.measured`. The girths and the height are relative to
  // the body's own extremes and so survive the translation, but `levels` are absolute heights — reusing
  // them left every ring sliced one ground-offset too high, which on the male body meant the "hip" ring
  // was cut across the waist and the skirt anchor came out half the radius it should be.
  const ix = buildIndex(tpl, pos);
  const measured = measureTemplate(tpl, pos, { index: ix });
  lap('measure');
  const sk = skeletonFromTemplate(tpl, pos, measured, params);
  const rings = ringsFromMesh(ix, ringHeights(measured, sk.H));
  const anchors = buildAnchors(sk, rings, params);
  lap('anchors');

  const sdf = bakeMeshSdf(pos, tpl.indices, { cell, nVerts: tpl.nBodyVerts });
  lap('sdf');
  for (let i = 0; i < sdf.data.length; i++) {
    if (!Number.isFinite(sdf.data[i])) throw bodyError('non-finite SDF value', 'node ' + i);
  }

  // Only the body surface is rendered; the joint cubes live past it in the same buffer.
  const nB = tpl.nBodyVerts;
  const positions = pos.slice(0, nB * 3);
  const normals = computeNormals(tpl, pos).slice(0, nB * 3);
  lap('geometry');

  for (const name of Object.keys(anchors)) {
    const a = anchors[name];
    if (!Number.isFinite(a.radius) || !Number.isFinite(a.length)) throw bodyError('non-finite anchor', name);
  }

  return {
    params,
    landmarks: sk.landmarks,
    anchors,
    rings,
    sdf,
    geometry: { positions, normals, indices: tpl.indices },
    measured: {
      chest_cm: measured.chest_cm, waist_cm: measured.waist_cm, hips_cm: measured.hips_cm,
    },
    buildMs: now() - t0,
    timing,
    // extras the analytic model never had; harmless to carry and useful to the panels
    fit,
    measuredFull: measured,
    skeleton: sk,
  };
}
