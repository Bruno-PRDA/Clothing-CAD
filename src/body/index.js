// src/body/index.js — public body API (SPEC 6.8). Pure: imports only core (types, sdf) and the body files.
// Metres, y up, model faces +z, +x = the model's LEFT; parameters cm.

import { sampleSdf } from '../core/sdf.js';
import { clampParams, PARAM_KEYS } from './params.js';
import { analyticBody } from './primitives.js';
import { bakeSdf, CELL_FULL, CELL_COARSE } from './bake.js';
import { measureBody } from './measure.js';
import { buildAnchors } from './anchors.js';
import { buildRenderMesh } from './mesh.js';
import { loadTemplate as loadTemplateImpl } from './template.js';
import { calibrate as calibrateFit } from './fit.js';
import { buildTemplateBody as buildTemplateBodyImpl } from './templateModel.js';
import { RING_NAMES } from './loft.js';

export { PARAM_DEFS, PARAM_KEYS, clampParams, paramsEqual, estimateMeasurements } from './params.js';
export { BODY_PRESETS, DEFAULT_PRESET_ID, PRESET_LABELS, listPresets } from './presets.js';
export { CELL_FULL, CELL_COARSE, bakeSdf } from './bake.js';
export { buildSkeleton, SKELETON_TUNING } from './skeleton.js';
export { describeBuild, BUILD_TUNING } from './build.js';
export { analyticBody, sdSphere, sdEllipsoid, sdRoundCone, smin, SMIN_K, SMIN_K_LIMB, PRIM_TUNING } from './primitives.js';
export { buildRings, makeLoft, unitPerimeter, RING_TUNING, RING_NAMES } from './loft.js';
export { measureBody } from './measure.js';
export { buildAnchors, CLEARANCE } from './anchors.js';
export { buildRenderMesh } from './mesh.js';
export { loadTemplate, applyTargets, computeNormals, jointAt, decodeTemplate } from './template.js';
export { macroSliders, macroWeights, macroWeightsFor, ETHNICITY } from './macro.js';
export { measureTemplate } from './measureTemplate.js';
export { buildIndex, girthAt, limbGirth } from './section.js';
export { fitBody, calibrate, MEASURE_TARGETS, UNSTEERABLE, FIT_DEFAULTS } from './fit.js';
export { bakeMeshSdf, BAND_CELLS } from './sdfMesh.js';
export { buildTemplateBody } from './templateModel.js';

/** @typedef {import('../core/types.js').BodyParams} BodyParams */
/** @typedef {import('../core/types.js').BodyModel} BodyModel */
/** @typedef {import('../core/types.js').Vec3} Vec3 */

/** @returns {number} ms */
function now() {
  const p = globalThis.performance;
  return p && typeof p.now === 'function' ? p.now() : Date.now();
}

/** @param {string} message @param {string} [detail] @returns {Error & {code: string}} */
function bodyError(message, detail) {
  const err = /** @type {Error & {code: string}} */ (new Error('BodyError: ' + message + (detail ? ' (' + detail + ')' : '')));
  err.code = 'BodyError';
  return err;
}

/** @param {object} g @returns {boolean} */
function validGeometry(g) {
  return !!g && g.positions instanceof Float32Array && g.normals instanceof Float32Array && g.indices instanceof Uint32Array
    && g.positions.length > 0 && g.indices.length % 3 === 0 && g.normals.length === g.positions.length;
}

/**
 * The loaded MakeHuman template, or null. `buildBody` uses it when it is there.
 * @type {import('./template.js').Template|null}
 */
let TEMPLATE = null;

/**
 * Load the template mesh and warm its fit calibration. Called once from the boot's body stage.
 *
 * Failure is deliberately NOT fatal: if `assets/body/` is missing or unreachable, `buildBody` falls
 * back to the analytic primitive body, which is a worse-looking mannequin but a working one. That
 * matters because the assets are 17 MB and the app otherwise has no network dependency at all.
 *
 * @param {string} [baseUrl] @returns {Promise<{ok: boolean, ms: number, error?: string}>}
 */
export async function initTemplate(baseUrl) {
  const t0 = now();
  try {
    TEMPLATE = await loadTemplateImpl(baseUrl || 'assets/body/');
    calibrateFit(TEMPLATE);        // ~450 ms once, so the first body build is not the slow one
    return { ok: true, ms: now() - t0 };
  } catch (err) {
    TEMPLATE = null;
    return { ok: false, ms: now() - t0, error: String((err && err.message) || err) };
  }
}

/** @returns {boolean} is the template body in use? */
export function templateReady() {
  return TEMPLATE !== null;
}

/** Drop the template and go back to the analytic body (tests). */
export function clearTemplate() {
  TEMPLATE = null;
}

/**
 * Build the whole model synchronously. cell 0.015 = full (default), 0.030 = coarse.
 * opts.reuseGeometry: a previous BodyModel.geometry to reuse when cell > 0.02 (skips the render mesh).
 * Throws Error{code:'BodyError'} only for non-finite results (out-of-range params are clamped).
 * @param {BodyParams} params @param {{cell?: number, reuseGeometry?: object}} [opts] @returns {BodyModel}
 */
export function buildBody(params, opts) {
  if (TEMPLATE) {
    const o2 = opts || {};
    const coarse = typeof o2.cell === 'number' && o2.cell > 0.02;
    // A coarse build is what a slider DRAG asks for: it must feel immediate, and it is thrown away the
    // moment the drag commits. Fewer solve rounds and a 30 mm grid put it near the analytic body's cost.
    return buildTemplateBodyImpl(TEMPLATE, clampParams(params), {
      cell: coarse ? 0.030 : 0.015,
      rounds: coarse ? 3 : undefined,
      reuseGeometry: o2.reuseGeometry,
    });
  }
  return buildAnalyticBody(params, opts);
}

/**
 * The original analytic body: nine lofted superellipse rings and blended ellipsoids. Kept as the
 * fallback for when the template assets cannot be loaded.
 * @param {BodyParams} params @param {{cell?: number, reuseGeometry?: object}} [opts] @returns {BodyModel}
 */
export function buildAnalyticBody(params, opts) {
  const t0 = now();
  const o = opts || {};
  const p = clampParams(params);
  const cell = typeof o.cell === 'number' && Number.isFinite(o.cell) && o.cell > 0 ? o.cell : CELL_FULL;

  const analytic = analyticBody(p);
  const sdf = bakeSdf(analytic, cell);
  const data = sdf.data;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v !== v || v === Infinity || v === -Infinity) throw bodyError('non-finite SDF value', 'node ' + i);
  }
  const measured = measureBody(sdf, analytic.rings);
  if (!Number.isFinite(measured.chest_cm) || !Number.isFinite(measured.waist_cm) || !Number.isFinite(measured.hips_cm)) {
    throw bodyError('non-finite measurement');
  }
  const anchors = buildAnchors(analytic.skeleton, analytic.rings, p);
  for (const name of Object.keys(anchors)) {
    const a = anchors[name];
    if (!Number.isFinite(a.radius) || !Number.isFinite(a.length) || !finite3(a.origin) || !finite3(a.axis) || !finite3(a.front)) {
      throw bodyError('non-finite anchor', name);
    }
  }
  const geometry = cell > 0.02 && validGeometry(o.reuseGeometry)
    ? /** @type {{positions: Float32Array, normals: Float32Array, indices: Uint32Array}} */ (o.reuseGeometry)
    : buildRenderMesh(analytic);

  /** @type {Record<string, Vec3>} */
  const landmarks = {};
  const lm = analytic.skeleton.landmarks;
  for (const key of Object.keys(lm)) {
    const v = lm[key];
    if (!finite3(v)) throw bodyError('non-finite landmark', key);
    landmarks[key] = [v[0], v[1], v[2]];
  }
  /** @type {Record<string, {y:number, a:number, b:number, n:number, cz:number}>} */
  const rings = {};
  for (const name of RING_NAMES) {
    const r = analytic.rings[name];
    rings[name] = { y: r.y, a: r.a, b: r.b, n: r.n, cz: r.cz };
  }
  const buildMs = now() - t0;
  return { params: p, landmarks, anchors, rings, sdf, geometry, measured, buildMs };
}

/** @param {number[]} v @returns {boolean} */
function finite3(v) {
  return Array.isArray(v) && v.length === 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

/**
 * = sampleSdf(model.sdf, x, y, z, outGrad).
 * @param {BodyModel} model @param {number} x @param {number} y @param {number} z
 * @param {Float32Array|number[]|null} [outGrad] @returns {number} metres
 */
export function sampleBody(model, x, y, z, outGrad) {
  return sampleSdf(model.sdf, x, y, z, outGrad || null);
}

/** The 20 parameter keys (re-exported for consumers that only need the list). */
export const BODY_PARAM_COUNT = PARAM_KEYS.length;
