// src/samples/index.js — registry of built-in sample garments (SPEC section 4.4). Imports nothing outside src/samples/.
import { TSHIRT } from './tshirt.js';
import { SKIRT } from './skirt.js';

/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */
/** @typedef {{id:string, name:string, doc:ProjectDoc}} SampleEntry */

/**
 * Recursively Object.freeze a plain data tree (objects and arrays). Returns its argument.
 * @template T
 * @param {T} o
 * @returns {T}
 */
export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(/** @type {any} */ (o)[k]);
  }
  return o;
}

/** Id of the sample the app loads at start-up when no project is restored. */
export const DEFAULT_SAMPLE_ID = 'tshirt';

/** Ids of all built-in samples, in menu order. */
export const SAMPLE_IDS = Object.freeze(['tshirt', 'skirt']);

/**
 * Ordered list of built-in samples; order = order in the toolbar "Samples" menu (section 11).
 * `doc` is the frozen master copy — never hand it to the store; use getSample().
 * @type {readonly SampleEntry[]}
 */
export const SAMPLES = Object.freeze([
  Object.freeze({ id: 'tshirt', name: 'Basic T-shirt', doc: deepFreeze(TSHIRT) }),
  Object.freeze({ id: 'skirt', name: 'A-line skirt', doc: deepFreeze(SKIRT) }),
]);

/**
 * Ids and display names of all samples, in menu order.
 * @returns {{id:string, name:string}[]}
 */
export function listSamples() {
  return SAMPLES.map((s) => ({ id: s.id, name: s.name }));
}

/**
 * Deep clone of a sample ProjectDoc, safe to hand to store.load(). Every call returns a new, unfrozen object
 * graph (structuredClone drops the freeze). The literals are authored fully normalised, so
 * normalizeDoc(getSample(id)) (section 3.3) is deep-equal to getSample(id).
 * @param {string} id  'tshirt' | 'skirt'
 * @returns {ProjectDoc}
 * @throws {Error & {code:'UNKNOWN_SAMPLE'}} when id is not a registered sample
 */
export function getSample(id) {
  const entry = SAMPLES.find((s) => s.id === id);
  if (!entry) {
    const err = /** @type {Error & {code:string}} */ (new Error(`Unknown sample '${id}'; known: ${SAMPLES.map((s) => s.id).join(', ')}`));
    err.code = 'UNKNOWN_SAMPLE';
    throw err;
  }
  return structuredClone(entry.doc);
}
