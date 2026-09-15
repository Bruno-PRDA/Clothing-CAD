// src/body/bake.js — bake the analytic body into an SdfGrid (SPEC 6.4). Pure; metres.

import { makeGridFromFn } from '../core/sdf.js';

/** @typedef {import('../core/types.js').SdfGrid} SdfGrid */
/** @typedef {import('./primitives.js').AnalyticBody} AnalyticBody */

export const BAKE_PAD = 0.10;
export const CELL_FULL = 0.015;
export const CELL_COARSE = 0.030;

/**
 * Grid extent = union of the primitive bounds padded by 0.10 m; origin = min; n = ceil(extent / cell) + 1 per axis.
 * Nodes farther than FAR_DISTANCE from every bounding sphere take the cheapest lower bound (analytic.sd does that).
 * Result is a NEW grid every call.
 *
 * The x origin is snapped DOWN to a multiple of `cell` so that the mid-sagittal plane x = 0 falls exactly on a node
 * plane. The body is bilaterally symmetric, so x = 0 carries the field's medial ridge everywhere the two legs (or
 * the two feet) face each other: the true distance has a crease there, and a cell straddling a crease interpolates
 * a gradient of nearly zero, which is what 6.9 case 5 measures. With the ridge ON a node plane no cell contains it
 * and the trilinear gradient stays exact on both sides. Snapping only ever grows the grid (by < 1 cell).
 *
 * @param {AnalyticBody} analytic @param {number} cell @returns {SdfGrid}
 */
export function bakeSdf(analytic, cell) {
  const c = Number.isFinite(cell) && cell > 0 ? cell : CELL_FULL;
  const min = analytic.aabb.min;
  const max = analytic.aabb.max;
  const ox = -Math.ceil((BAKE_PAD - min[0]) / c) * c;
  const oy = min[1] - BAKE_PAD;
  const oz = min[2] - BAKE_PAD;
  const nx = Math.ceil((max[0] + BAKE_PAD - ox) / c) + 1;
  const ny = Math.ceil((max[1] + BAKE_PAD - oy) / c) + 1;
  const nz = Math.ceil((max[2] + BAKE_PAD - oz) / c) + 1;
  return makeGridFromFn([ox, oy, oz], c, nx, ny, nz, analytic.sd);
}
