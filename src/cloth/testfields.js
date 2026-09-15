// src/cloth/testfields.js — analytic SDF grids for tests and fixtures (SPEC section 7.11).

import { makeSphereGrid, makeCapsuleGrid, makeGridFromFn } from '../core/sdf.js';

/** @typedef {import('../core/types.js').SdfGrid} SdfGrid */
/** @typedef {import('../core/types.js').Vec3} Vec3 */

/** Sphere SDF grid (pad = 2 cells + 0.1 m so a draped sheet can hang beside the sphere). @param {Vec3} centre @param {number} radius @param {number} cell @returns {SdfGrid} */
export function sphereField(centre, radius, cell) {
  return makeSphereGrid(centre, radius, cell, 0.1 + 2 * cell);
}

/** Capsule SDF grid. @param {Vec3} a @param {Vec3} b @param {number} r @param {number} cell @returns {SdfGrid} */
export function capsuleField(a, b, r, cell) {
  return makeCapsuleGrid(a, b, r, cell, 0.05 + 2 * cell);
}

/**
 * Half-space d = y − y0 on a box centred on (0, y0, 0): x, z ∈ [−extent/2, extent/2], y ∈ [y0 − extent/4, y0 + extent/4].
 * @param {number} y0 @param {number} cell @param {number} extent @returns {SdfGrid}
 */
export function floorField(y0, cell, extent) {
  const nxz = Math.ceil(extent / cell - 1e-9) + 1;
  const ny = Math.ceil(extent / (2 * cell) - 1e-9) + 1;
  const origin = [-extent / 2, y0 - extent / 4, -extent / 2];
  return makeGridFromFn(origin, cell, nxz, ny, nxz, function floorFn(x, y, z) { return y - y0; });
}
