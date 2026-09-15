// src/cloth/index.js — public cloth API (SPEC section 7.13). Pure module: imports only src/core; never three or the DOM.

/** @typedef {import('../core/types.js').ClothState} ClothState */
/** @typedef {import('../core/types.js').SdfGrid} SdfGrid */
/** @typedef {import('../core/types.js').SimStats} SimStats */

import { getAux } from './state.js';
import { snapshot as snapshotImpl, restore as restoreImpl } from './safety.js';

export { buildCloth, setFabricParams, setSettings, setScale, setPin, clearPin, setGravityDir, commitPositions, SEAM_ALPHA } from './state.js';
export { arrange, pushOut } from './arrange.js';
export { step, drape, reset, phase } from './solver.js';
export { bendingCoefficients, bendingC, solveDistance, solveBending, solveSeams, applyPins } from './constraints.js';
export { FRICTION_FLOOR } from './collide.js';
export { LRA_ANCHORS, LRA_RINGS, LRA_SLACK, solveLra } from './lra.js';
export { sphereField, capsuleField, floorField } from './testfields.js';
export { makeHangingSheet, makeSphereDrape, makeSeamFixture, makeSlopeFixture, makeLatticeMesh } from './fixtures.js';

/** Last computed SimStats (or a zeroed one before the first step). @param {ClothState} state @returns {SimStats} */
export function stats(state) {
  return getAux(state).stats;
}

/** Copy of {frame, time, pos, vel}. @param {ClothState} state */
export function snapshot(state) {
  getAux(state);
  return snapshotImpl(state);
}

/**
 * Copies a snapshot back (E_BAD_ARG if snap.pos.length !== 3V).
 * @param {ClothState} state @param {{frame:number, time:number, pos:Float32Array, vel:Float32Array}} snap
 */
export function restore(state, snap) {
  restoreImpl(state, getAux(state), snap);
}

/**
 * Instrumentation for the self-test (7.13 case 12): number of self-collision pairs processed so far between two
 * vertices that are both within 2 rings of a seam. Extra export.
 * @param {ClothState} state @returns {number}
 */
export function selfMaskedPairCount(state) {
  return getAux(state).selfMaskedPairs;
}
