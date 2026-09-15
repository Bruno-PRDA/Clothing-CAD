// src/export/index.js — public API of the export module (SPEC sections 10.3–10.7). Pure except download.js.
// Imports src/core, src/geometry, src/sizing. Errors are ValidationError {name:'ValidationError', code}.

import { gradeDoc, gradePiece, rowByName, sizeNames, validationError } from '../sizing/index.js';
import { exportSheet, exportPieceSvg, exportGradeNestSvg } from './svg.js';
import { buildPrintDocument } from './print.js';
import { sizeChartCsv, sizeChartJson, pieceMeasurementsCsv } from './csv.js';

/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */
/** @typedef {import('./svg.js').PieceGeometry} PieceGeometry */
/** @typedef {import('./svg.js').SheetLayout} SheetLayout */
/** @typedef {import('./svg.js').SheetResult} SheetResult */
/** @typedef {import('./sheet.js').TilePlan} TilePlan */

export {
  buildPieceGeometry, layoutSheet, renderSheet, exportSheet, exportSheetSvg, exportPieceSvg, exportGradeNestSvg,
  SIZE_COLORS, fmt, escapeXml, SHEET_CALIBRATION_CLASS,
} from './svg.js';
export { tileSheet, tileLabel, PAPER_SIZES } from './sheet.js';
export { buildPrintDocument, printHtml } from './print.js';
export {
  sizeChartCsv, parseSizeChartCsv, sizeChartJson, csvLine, fmtCsv, pieceMeasurementsCsv, fabricEstimate, MEASUREMENTS_HEADER,
} from './csv.js';
export {
  downloadBlob, downloadText, downloadSvg, slug, projectFilename, saveProject, parseProjectText, readProjectFile,
  clothObj, downloadClothObj, FILENAMES,
} from './download.js';

// ---------------------------------------------------------------- 10.7 document-level conveniences (1:1 onto __app.export)

/** @param {ProjectDoc} doc @param {string|undefined} sizeName @returns {string} resolved size; throws SIZE_UNKNOWN */
function resolveSize(doc, sizeName) {
  const name = sizeName === undefined || sizeName === null || sizeName === '' ? doc.ui.activeSize : sizeName;
  if (!rowByName(doc.sizes, name)) throw validationError('SIZE_UNKNOWN', `Unknown size "${String(name)}"`);
  return name;
}

/** @param {ProjectDoc} doc @returns {Record<string, string>} fabric id → name */
function fabricNamesOf(doc) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const f of doc.fabrics || []) out[f.id] = f.name || f.id;
  return out;
}

/** @param {ProjectDoc} doc @param {object} [opts] @returns {object} */
function docOpts(doc, opts) {
  return { ...(opts || {}), garmentName: doc.name, fabricNames: fabricNamesOf(doc) };
}

/** @param {ProjectDoc} doc @param {string} pieceId @returns {Piece} throws EXPORT_PIECE_UNKNOWN */
function requirePiece(doc, pieceId) {
  const piece = (doc.pieces || []).find((p) => p.id === pieceId);
  if (!piece) throw validationError('EXPORT_PIECE_UNKNOWN', `Unknown piece "${String(pieceId)}"`);
  return piece;
}

/** fabricNames from doc.fabrics; garmentName = doc.name; pieces = gradeDoc(doc, sizeName) minus exportHidden. sizeName defaults to doc.ui.activeSize. @param {ProjectDoc} doc @param {string} [sizeName] @param {object} [opts] @returns {SheetResult} */
export function exportDocSheet(doc, sizeName, opts) {
  const size = resolveSize(doc, sizeName);
  const pieces = gradeDoc(doc, size).filter((p) => p.exportHidden !== true);
  return exportSheet(pieces, size, docOpts(doc, opts));
}

/** exportDocSheet(...).svg. @param {ProjectDoc} doc @param {string} [sizeName] @param {object} [opts] @returns {string} */
export function exportDocSvg(doc, sizeName, opts) {
  return exportDocSheet(doc, sizeName, opts).svg;
}

/** Throws EXPORT_PIECE_UNKNOWN. @param {ProjectDoc} doc @param {string} pieceId @param {string} [sizeName] @param {object} [opts] @returns {string} */
export function exportDocPieceSvg(doc, pieceId, sizeName, opts) {
  const size = resolveSize(doc, sizeName);
  const piece = requirePiece(doc, pieceId);
  return exportPieceSvg(gradePiece(piece, doc.sizes, size), { ...docOpts(doc, opts), sizeName: size });
}

/** All sizes of doc.sizes. @param {ProjectDoc} doc @param {string} pieceId @param {object} [opts] @returns {string} */
export function exportDocGradeNestSvg(doc, pieceId, opts) {
  const piece = requirePiece(doc, pieceId);
  const pieceBySize = sizeNames(doc.sizes).map((name) => ({ sizeName: name, piece: gradePiece(piece, doc.sizes, name) }));
  return exportGradeNestSvg(pieceBySize, doc.sizes.baseSize, docOpts(doc, opts));
}

/** exportDocSheet + buildPrintDocument. @param {ProjectDoc} doc @param {string} [sizeName] @param {{paper?: string, orientation?: string, margin_mm?: number, overlap_mm?: number}} [opts] @returns {{html: string, plan: TilePlan}} */
export function exportDocPrintHtml(doc, sizeName, opts) {
  const o = opts || {};
  const sheet = exportDocSheet(doc, sizeName, { sheetWidth_mm: o.sheetWidth_mm, calibration: o.calibration, date: o.date });
  return buildPrintDocument(sheet, {
    paper: o.paper, orientation: o.orientation, margin_mm: o.margin_mm, overlap_mm: o.overlap_mm, garmentName: doc.name,
  });
}

/** sizeChartCsv(doc.sizes). @param {ProjectDoc} doc @returns {string} */
export function exportDocSizesCsv(doc) {
  return sizeChartCsv(doc.sizes);
}

/** sizeChartJson(doc.sizes). @param {ProjectDoc} doc @returns {string} */
export function exportDocSizesJson(doc) {
  return sizeChartJson(doc.sizes);
}

/** pieceMeasurementsCsv(doc, doc.sizes, opts). @param {ProjectDoc} doc @param {object} [opts] @returns {string} */
export function exportDocMeasurementsCsv(doc, opts) {
  return pieceMeasurementsCsv(doc, doc.sizes, opts);
}

export { runSelfTest } from './selftest.js';
