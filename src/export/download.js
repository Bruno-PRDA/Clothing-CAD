// src/export/download.js — the ONLY DOM toucher of src/export (SPEC section 10.6): downloads, project files, OBJ.
// Every download function throws Error{code:'NO_DOM'} when `document` is undefined; everything else is pure.

import { serializeDoc, normalizeDoc, validateShape } from '../core/schema.js';
import { validationError } from '../sizing/index.js';

/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */
/** @typedef {import('../core/types.js').ClothState} ClothState */

/** @returns {Error & {code: string}} */
function noDom() {
  return /** @type {Error & {code: string}} */ (Object.assign(new Error('No DOM available for downloads'), { code: 'NO_DOM' }));
}

/** @param {string} filename @param {Blob} blob */
export function downloadBlob(filename, blob) {
  if (typeof document === 'undefined') throw noDom();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** @param {string} filename @param {string} mime @param {string} text */
export function downloadText(filename, mime, text) {
  if (typeof document === 'undefined') throw noDom();
  downloadBlob(filename, new Blob([text], { type: mime + ';charset=utf-8' }));
}

/** @param {string} filename @param {string} svg */
export function downloadSvg(filename, svg) {
  downloadText(filename, 'image/svg+xml', svg);
}

/** lower-case, [a-z0-9]+ runs joined by '-'; '' → 'project'. @param {string} s @returns {string} */
export function slug(s) {
  const runs = String(s === undefined || s === null ? '' : s).toLowerCase().match(/[a-z0-9]+/g);
  const out = runs ? runs.join('-') : '';
  return out === '' ? 'project' : out;
}

/** `${slug(doc.name)}.clothing.json`. @param {ProjectDoc} doc @returns {string} */
export function projectFilename(doc) {
  return `${slug(doc && doc.name)}.clothing.json`;
}

/** json = serializeDoc(doc); downloads it; returns json. @param {ProjectDoc} doc @returns {string} */
export function saveProject(doc) {
  const json = serializeDoc(doc);
  downloadText(projectFilename(doc), 'application/json', json);
  return json;
}

/** JSON.parse → normalizeDoc → validateShape. Throws PROJECT_JSON, PROJECT_SHAPE, PROJECT_INVALID. @param {string} text @returns {ProjectDoc} */
export function parseProjectText(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw validationError('PROJECT_JSON', `Not a JSON file: ${e && e.message ? e.message : String(e)}`);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw validationError('PROJECT_SHAPE', 'Not a project file: expected a JSON object');
  }
  let doc;
  try {
    doc = normalizeDoc(raw);
    const issues = validateShape(doc);
    const err = issues.find((i) => i.level === 'error');
    if (err) throw validationError('PROJECT_INVALID', err.message);
  } catch (e) {
    if (e && e.code === 'PROJECT_INVALID') throw e;
    throw validationError('PROJECT_INVALID', e && e.message ? e.message : String(e));
  }
  return doc;
}

/** file.text().then(parseProjectText). @param {File} file @returns {Promise<ProjectDoc>} */
export function readProjectFile(file) {
  return file.text().then(parseProjectText);
}

/** @param {number} v @returns {string} 5 decimals, -0 → 0 */
function obj5(v) {
  const s = (Number.isFinite(v) ? v : 0).toFixed(5);
  return s === '-0.00000' ? '0.00000' : s;
}

/**
 * OBJ text in metres, y up: one `o` block per piece with count > 0, 1-based GLOBAL vertex ids, no normals/UVs.
 * @param {ClothState} state @param {{name?: string}} [opts] @returns {string}
 */
export function clothObj(state, opts) {
  const o = opts || {};
  const lines = ['# Clothing App cloth export (metres, y up)'];
  if (o.name) lines.push(`# ${String(o.name).replace(/[\r\n]+/g, ' ')}`);
  const pos = state.pos;
  const tris = state.tris;
  const pieces = state.pieces || [];
  for (const piece of pieces) {
    if (!(piece.count > 0)) continue;
    const start = piece.start;
    const end = start + piece.count;
    lines.push(`o ${piece.pieceId}`);
    for (let i = start; i < end; i++) {
      lines.push(`v ${obj5(pos[3 * i])} ${obj5(pos[3 * i + 1])} ${obj5(pos[3 * i + 2])}`);
    }
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const a = tris[t];
      if (a >= start && a < end) lines.push(`f ${a + 1} ${tris[t + 1] + 1} ${tris[t + 2] + 1}`);
    }
  }
  return lines.join('\n') + '\n';
}

/** Filename builders (SPEC 10.6). */
export const FILENAMES = Object.freeze({
  /** @param {string} garment @param {string} size */
  sheetSvg: (garment, size) => `${slug(garment)}_${size}_sheet.svg`,
  /** @param {string} garment @param {string} pieceId @param {string} size */
  pieceSvg: (garment, pieceId, size) => `${slug(garment)}_${pieceId}_${size}.svg`,
  /** @param {string} garment @param {string} pieceId */
  nestSvg: (garment, pieceId) => `${slug(garment)}_${pieceId}_nest.svg`,
  /** @param {string} garment @param {string} size @param {string} paper */
  printHtml: (garment, size, paper) => `${slug(garment)}_${size}_${paper}_tiles.html`,
  /** @param {string} garment */
  sizesCsv: (garment) => `${slug(garment)}_sizes.csv`,
  /** @param {string} garment */
  sizesJson: (garment) => `${slug(garment)}_sizes.json`,
  /** @param {string} garment */
  measurementsCsv: (garment) => `${slug(garment)}_measurements.csv`,
  /** @param {string} garment */
  clothObj: (garment) => `${slug(garment)}_cloth.obj`,
});

/** Downloads clothObj(state); returns the OBJ text. @param {ClothState} state @param {string} [filename] @returns {string} */
export function downloadClothObj(state, filename) {
  const text = clothObj(state);
  downloadText(filename || FILENAMES.clothObj('cloth'), 'model/obj', text);
  return text;
}
