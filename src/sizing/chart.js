// src/sizing/chart.js — size chart model (SPEC section 10.1). Pure, non-mutating: every operation returns a NEW chart.
// Units: cm, keys suffixed `_cm`. Errors: ValidationError {name:'ValidationError', code:'SIZE_*'}.

import { defaultSizeChart } from '../core/schema.js';

/** @typedef {import('../core/types.js').SizeChart} SizeChart */
/** @typedef {import('../core/types.js').SizeRow} SizeRow */
/** @typedef {import('../core/types.js').BodyParams} BodyParams */
/** @typedef {import('../core/types.js').Issue} Issue */

/** @type {ReadonlyArray<string>} */
export const DEFAULT_MEASUREMENTS = Object.freeze(['chest_cm', 'waist_cm', 'hips_cm', 'height_cm', 'torsoLength_cm', 'armLength_cm']);

const NAME_MAX = 16;
const KEY_RE = /^[a-z][A-Za-z]*_cm$/;

/**
 * Shared error constructor of sizing/ and export/ (SPEC 10: `Object.assign(new Error(message), {name, code})`).
 * @param {string} code @param {string} message @returns {Error & {code: string}}
 */
export function validationError(code, message) {
  return /** @type {Error & {code: string}} */ (Object.assign(new Error(message), { name: 'ValidationError', code }));
}

/** @param {*} v @returns {boolean} */
function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** @param {SizeRow} row @returns {SizeRow} */
function cloneRow(row) {
  return /** @type {SizeRow} */ ({ ...row });
}

/** The app default chart (rows S/M/L/XL, base M; row M = body preset female_m). @returns {SizeChart} */
export function defaultChart() {
  const c = defaultSizeChart();
  return { measurements: c.measurements.slice(), baseSize: c.baseSize, rows: c.rows.map(cloneRow) };
}

/** @param {SizeChart} chart @returns {SizeChart} */
export function cloneChart(chart) {
  return {
    measurements: Array.isArray(chart.measurements) ? chart.measurements.slice() : [],
    baseSize: chart.baseSize,
    rows: Array.isArray(chart.rows) ? chart.rows.map(cloneRow) : [],
  };
}

/** @param {SizeChart} chart @param {string} name @returns {SizeRow|null} */
export function rowByName(chart, name) {
  const i = sizeIndex(chart, name);
  return i < 0 ? null : chart.rows[i];
}

/** Index into chart.rows, -1 when absent. @param {SizeChart} chart @param {string} name @returns {number} */
export function sizeIndex(chart, name) {
  const rows = chart && Array.isArray(chart.rows) ? chart.rows : [];
  for (let i = 0; i < rows.length; i++) if (rows[i] && rows[i].name === name) return i;
  return -1;
}

/** sizeIndex(chart, chart.baseSize). @param {SizeChart} chart @returns {number} */
export function baseIndex(chart) {
  return sizeIndex(chart, chart.baseSize);
}

/** @param {SizeChart} chart @returns {string[]} */
export function sizeNames(chart) {
  return chart.rows.map((r) => r.name);
}

/** @param {*} name @returns {string} trimmed valid name; throws SIZE_NAME_INVALID */
function checkName(name) {
  const s = typeof name === 'string' ? name.trim() : '';
  if (s === '' || s.length > NAME_MAX) {
    throw validationError('SIZE_NAME_INVALID', `Size name "${String(name)}" must be 1..${NAME_MAX} characters`);
  }
  return s;
}

/** @param {SizeChart} chart @param {string} name @returns {number} index; throws SIZE_UNKNOWN */
function requireIndex(chart, name) {
  const i = sizeIndex(chart, name);
  if (i < 0) throw validationError('SIZE_UNKNOWN', `Unknown size "${name}"`);
  return i;
}

/**
 * Append (or insert at `at`) a row; missing keys copied from the base row (or the first row when there is no base).
 * Keys not in chart.measurements are ignored. Throws SIZE_NAME_INVALID, SIZE_DUP_NAME.
 * @param {SizeChart} chart @param {string} name @param {Record<string, number>} [values] @param {number} [at] @returns {SizeChart}
 */
export function addRow(chart, name, values, at) {
  const out = cloneChart(chart);
  const trimmed = checkName(name);
  if (out.rows.some((r) => r.name === trimmed)) throw validationError('SIZE_DUP_NAME', `Size "${trimmed}" already exists`);
  const base = rowByName(out, out.baseSize) || out.rows[0] || null;
  /** @type {SizeRow} */
  const row = { name: trimmed };
  const src = values && typeof values === 'object' ? values : {};
  for (const key of out.measurements) {
    const v = src[key];
    if (isFiniteNum(v)) row[key] = v;
    else if (base && isFiniteNum(base[key])) row[key] = /** @type {number} */ (base[key]);
    else row[key] = 0;
  }
  let index = out.rows.length;
  if (typeof at === 'number' && Number.isFinite(at)) index = Math.max(0, Math.min(out.rows.length, Math.trunc(at)));
  out.rows.splice(index, 0, row);
  return out;
}

/** Throws SIZE_UNKNOWN, SIZE_BASE_ROW, SIZE_LAST_ROW. @param {SizeChart} chart @param {string} name @returns {SizeChart} */
export function removeRow(chart, name) {
  const i = requireIndex(chart, name);
  if (name === chart.baseSize) throw validationError('SIZE_BASE_ROW', `Cannot remove the base size "${name}"`);
  if (chart.rows.length <= 1) throw validationError('SIZE_LAST_ROW', 'Cannot remove the only size');
  const out = cloneChart(chart);
  out.rows.splice(i, 1);
  return out;
}

/** Renames a row (baseSize follows). Throws SIZE_UNKNOWN, SIZE_NAME_INVALID, SIZE_DUP_NAME. @param {SizeChart} chart @param {string} oldName @param {string} newName @returns {SizeChart} */
export function renameRow(chart, oldName, newName) {
  const i = requireIndex(chart, oldName);
  const trimmed = checkName(newName);
  if (trimmed !== oldName && chart.rows.some((r) => r.name === trimmed)) {
    throw validationError('SIZE_DUP_NAME', `Size "${trimmed}" already exists`);
  }
  const out = cloneChart(chart);
  out.rows[i].name = trimmed;
  if (out.baseSize === oldName) out.baseSize = trimmed;
  return out;
}

/** Sets one cell in cm (rounded to 0.01). Throws SIZE_UNKNOWN, SIZE_KEY_UNKNOWN, SIZE_VALUE_INVALID. @param {SizeChart} chart @param {string} name @param {string} key @param {number} value_cm @returns {SizeChart} */
export function setValue(chart, name, key, value_cm) {
  const i = requireIndex(chart, name);
  if (!chart.measurements.includes(key)) throw validationError('SIZE_KEY_UNKNOWN', `Unknown measurement "${key}"`);
  if (!isFiniteNum(value_cm) || value_cm <= 0) {
    throw validationError('SIZE_VALUE_INVALID', `Size ${name}: ${key} must be a positive number`);
  }
  const out = cloneChart(chart);
  out.rows[i][key] = Math.round(value_cm * 100) / 100;
  return out;
}

/** Throws SIZE_UNKNOWN. @param {SizeChart} chart @param {string} name @returns {SizeChart} */
export function setBaseSize(chart, name) {
  requireIndex(chart, name);
  const out = cloneChart(chart);
  out.baseSize = name;
  return out;
}

/** Adds a measurement column; every row receives fill_cm. Throws SIZE_KEY_INVALID, SIZE_DUP_KEY. @param {SizeChart} chart @param {string} key @param {number} fill_cm @returns {SizeChart} */
export function addMeasurement(chart, key, fill_cm) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    throw validationError('SIZE_KEY_INVALID', `Measurement key "${String(key)}" must match /^[a-z][A-Za-z]*_cm$/`);
  }
  if (chart.measurements.includes(key)) throw validationError('SIZE_DUP_KEY', `Measurement "${key}" already exists`);
  const out = cloneChart(chart);
  const fill = isFiniteNum(fill_cm) ? fill_cm : 0;
  out.measurements.push(key);
  for (const row of out.rows) row[key] = fill;
  return out;
}

/** Throws SIZE_KEY_UNKNOWN, SIZE_LAST_KEY. @param {SizeChart} chart @param {string} key @returns {SizeChart} */
export function removeMeasurement(chart, key) {
  const k = chart.measurements.indexOf(key);
  if (k < 0) throw validationError('SIZE_KEY_UNKNOWN', `Unknown measurement "${key}"`);
  if (chart.measurements.length <= 1) throw validationError('SIZE_LAST_KEY', 'At least one measurement must remain');
  const out = cloneChart(chart);
  out.measurements.splice(k, 1);
  for (const row of out.rows) delete row[key];
  return out;
}

/** Moves a row to a new index (clamped). Throws SIZE_UNKNOWN. @param {SizeChart} chart @param {string} name @param {number} toIndex @returns {SizeChart} */
export function moveRow(chart, name, toIndex) {
  const i = requireIndex(chart, name);
  const out = cloneChart(chart);
  const n = out.rows.length;
  let to = Number.isFinite(toIndex) ? Math.trunc(toIndex) : i;
  to = Math.max(0, Math.min(n - 1, to));
  const [row] = out.rows.splice(i, 1);
  out.rows.splice(to, 0, row);
  return out;
}

/**
 * Issue[] with codes SIZE_EMPTY, SIZE_BASE_MISSING, SIZE_DUP_NAME, SIZE_KEY_MISSING, SIZE_VALUE_INVALID (errors),
 * SIZE_NONMONOTONE (warn). Never throws.
 * @param {SizeChart} chart @returns {Issue[]}
 */
export function validateChart(chart) {
  /** @type {Issue[]} */
  const issues = [];
  const rows = chart && Array.isArray(chart.rows) ? chart.rows : [];
  const keys = chart && Array.isArray(chart.measurements) ? chart.measurements : [];
  if (rows.length === 0 || keys.length === 0) {
    issues.push({ level: 'error', code: 'SIZE_EMPTY', message: 'Size chart needs at least one row and one measurement' });
  }
  if (rows.length > 0 && rowByName(chart, chart.baseSize) === null) {
    issues.push({ level: 'error', code: 'SIZE_BASE_MISSING', message: `Base size "${String(chart.baseSize)}" is not a row` });
  }
  const seen = new Set();
  for (const r of rows) {
    const nm = typeof r.name === 'string' ? r.name.trim() : String(r.name);
    if (seen.has(nm)) issues.push({ level: 'error', code: 'SIZE_DUP_NAME', message: `Duplicate size name "${nm}"` });
    seen.add(nm);
  }
  for (const r of rows) {
    for (const key of keys) {
      if (!(key in r)) {
        issues.push({ level: 'error', code: 'SIZE_KEY_MISSING', message: `Size ${r.name}: missing ${key}` });
      } else if (!isFiniteNum(r[key]) || /** @type {number} */ (r[key]) <= 0) {
        issues.push({ level: 'error', code: 'SIZE_VALUE_INVALID', message: `Size ${r.name}: ${key} must be a positive number` });
      }
    }
  }
  for (const key of keys) {
    for (let i = 0; i + 1 < rows.length; i++) {
      const a = rows[i][key];
      const b = rows[i + 1][key];
      if (isFiniteNum(a) && isFiniteNum(b) && a > b) {
        issues.push({ level: 'warn', code: 'SIZE_NONMONOTONE', message: `${key} decreases from ${rows[i].name} to ${rows[i + 1].name}` });
        break;
      }
    }
  }
  return issues;
}

/**
 * 'Closest size' readout — BODY FIRST. score(row) = sum_k ((row[k] - body[k]) / body[k])^2 over the shared keys.
 * Throws SIZE_NO_COMMON_KEYS, SIZE_EMPTY.
 * @param {BodyParams} body @param {SizeChart} chart @returns {{name: string, index: number, score: number, deltas: Record<string, number>}}
 */
export function closestSize(body, chart) {
  const rows = chart && Array.isArray(chart.rows) ? chart.rows : [];
  if (rows.length === 0) throw validationError('SIZE_EMPTY', 'Size chart has no rows');
  const keys = (chart.measurements || []).filter((k) => body && isFiniteNum(body[k]));
  if (keys.length === 0) throw validationError('SIZE_NO_COMMON_KEYS', 'No measurement of the chart exists in the body');
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < rows.length; i++) {
    let score = 0;
    for (const k of keys) {
      const rv = rows[i][k];
      const bv = /** @type {number} */ (body[k]);
      if (!isFiniteNum(rv)) continue;
      const rel = bv !== 0 ? (/** @type {number} */ (rv) - bv) / bv : (/** @type {number} */ (rv) - bv);
      score += rel * rel;
    }
    if (score < bestScore) { bestScore = score; best = i; }
  }
  /** @type {Record<string, number>} */
  const deltas = {};
  for (const k of keys) {
    const rv = rows[best][k];
    deltas[k] = isFiniteNum(rv) ? Math.round((/** @type {number} */ (rv) - /** @type {number} */ (body[k])) * 10) / 10 : NaN;
  }
  return { name: rows[best].name, index: best, score: bestScore, deltas };
}

/** A SizeRow named `name` copied from body (0.1 cm). Throws SIZE_KEY_UNKNOWN. Does NOT add it to the chart. @param {BodyParams} body @param {SizeChart} chart @param {string} name @returns {SizeRow} */
export function rowFromBody(body, chart, name) {
  /** @type {SizeRow} */
  const row = { name };
  for (const key of chart.measurements) {
    const v = body ? body[key] : undefined;
    if (!isFiniteNum(v)) throw validationError('SIZE_KEY_UNKNOWN', `Body has no measurement "${key}"`);
    row[key] = Math.round(/** @type {number} */ (v) * 10) / 10;
  }
  return row;
}

/** 'Fit body to size': {...body, ...row measurement keys}. Throws SIZE_UNKNOWN. @param {SizeChart} chart @param {string} name @param {BodyParams} body @returns {BodyParams} */
export function rowToBodyParams(chart, name, body) {
  const row = rowByName(chart, name);
  if (!row) throw validationError('SIZE_UNKNOWN', `Unknown size "${name}"`);
  /** @type {any} */
  const out = { ...body };
  for (const key of chart.measurements) {
    if (isFiniteNum(row[key])) out[key] = row[key];
  }
  return out;
}
