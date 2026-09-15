// src/core/ids.js — unique ids and string hashing (SPEC section 3.5.2). Imports nothing.

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const PREFIX_RE = /^[a-z][a-z0-9]*$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const encoder = new TextEncoder();

let counter = 0;
/** @type {(() => number)} returns a float in [0, 1) */
let random = Math.random;

/** @returns {string} 4 random base36 chars */
function randomChars() {
  let s = '';
  for (let i = 0; i < 4; i++) {
    const r = random();
    const idx = Math.min(35, Math.floor(r * 36));
    s += ALPHABET.charAt(idx);
  }
  return s;
}

/**
 * Unique id: prefix + '_' + counter.toString(36) + 4 random base36 chars.
 * @param {string} prefix  non-empty, matches /^[a-z][a-z0-9]*$/ (throws Error{code:'BadPrefix'} otherwise)
 * @returns {string}
 */
export function uid(prefix) {
  if (typeof prefix !== 'string' || !PREFIX_RE.test(prefix)) {
    const err = new Error('uid: bad prefix ' + JSON.stringify(prefix));
    // @ts-ignore
    err.code = 'BadPrefix';
    throw err;
  }
  counter += 1;
  return prefix + '_' + counter.toString(36) + randomChars();
}

/** Reset the counter (tests only). @param {number} [n=0] */
export function resetUidCounter(n = 0) {
  counter = (typeof n === 'number' && Number.isFinite(n)) ? Math.trunc(n) : 0;
}

/**
 * Seed the random chars from a deterministic 32-bit LCG (tests only); pass null to restore Math.random.
 * @param {number|null} seed
 */
export function seedUidRandom(seed) {
  if (seed === null || seed === undefined) {
    random = Math.random;
    return;
  }
  let state = (Math.trunc(seed) >>> 0) || 1;
  random = function lcg() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** True for any non-empty string of [A-Za-z0-9_-] up to 64 chars. @param {*} s @returns {boolean} */
export function isValidId(s) {
  return typeof s === 'string' && ID_RE.test(s);
}

/**
 * FNV-1a 32-bit over the UTF-8 bytes of `s`; unsigned integer 0 .. 2^32-1.
 * @param {string} s @returns {number}
 */
export function hashString(s) {
  const bytes = encoder.encode(String(s));
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
