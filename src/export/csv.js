// src/export/csv.js — size chart CSV/JSON and piece measurements (SPEC section 10.5). Pure. No trailing newline.

import { edgeLength, packRects } from '../geometry/index.js';
import { gradePiece, seamEasePct, validationError } from '../sizing/index.js';
import { buildPieceGeometry } from './svg.js';

/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */
/** @typedef {import('../core/types.js').SizeChart} SizeChart */
/** @typedef {import('../core/types.js').SizeRow} SizeRow */

export const MEASUREMENTS_HEADER = 'size,piece,cut_qty,on_fold,edge,label,length_mm,allowance_mm,seam,partner,partner_length_mm,ease_pct,area_cm2,fabric_length_m';

/** @param {number} v @returns {string} */
export function fmtCsv(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
}

/** @param {string|number} f @returns {string} */
function csvField(f) {
  const s = typeof f === 'number' ? fmtCsv(f) : String(f === undefined || f === null ? '' : f);
  return /[,"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** @param {(string|number)[]} fields @returns {string} */
export function csvLine(fields) {
  return fields.map(csvField).join(',');
}

/** @param {number} v @param {number} digits @returns {number} */
function round(v, digits) {
  const k = Math.pow(10, digits);
  return Math.round(v * k) / k;
}

/** Header 'size,' + measurements; one line per row; values cm; no trailing newline. @param {SizeChart} chart @returns {string} */
export function sizeChartCsv(chart) {
  const lines = [csvLine(['size', ...chart.measurements])];
  for (const row of chart.rows) {
    lines.push(csvLine([row.name, ...chart.measurements.map((k) => /** @type {number} */ (row[k]))]));
  }
  return lines.join('\n');
}

/**
 * Splits one CSV line into fields (quotes, doubled quotes). Throws CSV_PARSE on an unterminated quote.
 * @param {string} line @returns {string[]}
 */
function splitCsvLine(line) {
  /** @type {string[]} */
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (inQ) throw validationError('CSV_PARSE', 'Unterminated quoted field');
  out.push(cur);
  return out;
}

/** Inverse of sizeChartCsv: baseSize = 'M' when present else the first row. Throws CSV_PARSE. @param {string} text @returns {SizeChart} */
export function parseSizeChartCsv(text) {
  if (typeof text !== 'string') throw validationError('CSV_PARSE', 'CSV text expected');
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length < 2) throw validationError('CSV_PARSE', 'CSV needs a header and at least one size row');
  const header = splitCsvLine(lines[0]).map((s) => s.trim());
  if (header.length < 2 || header[0].toLowerCase() !== 'size') {
    throw validationError('CSV_PARSE', `Header must start with "size,", got "${lines[0]}"`);
  }
  const measurements = header.slice(1);
  if (measurements.some((k) => k === '')) throw validationError('CSV_PARSE', 'Empty measurement name in header');
  /** @type {SizeRow[]} */
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const fields = splitCsvLine(lines[i]);
    if (fields.length !== header.length) {
      throw validationError('CSV_PARSE', `Line ${i + 1}: expected ${header.length} fields, got ${fields.length}`);
    }
    /** @type {SizeRow} */
    const row = { name: fields[0].trim() };
    if (row.name === '') throw validationError('CSV_PARSE', `Line ${i + 1}: empty size name`);
    for (let k = 0; k < measurements.length; k++) {
      const s = fields[k + 1].trim();
      const v = s === '' ? NaN : Number(s);
      if (!Number.isFinite(v)) throw validationError('CSV_PARSE', `Line ${i + 1}: ${measurements[k]} is not a number ("${s}")`);
      row[measurements[k]] = v;
    }
    rows.push(row);
  }
  if (rows.length === 0) throw validationError('CSV_PARSE', 'CSV has no size rows');
  const baseSize = rows.some((r) => r.name === 'M') ? 'M' : rows[0].name;
  return { measurements, baseSize, rows };
}

/** JSON.stringify({measurements, baseSize, rows}, null, 2) with row keys ordered name, then measurements. @param {SizeChart} chart @returns {string} */
export function sizeChartJson(chart) {
  const rows = chart.rows.map((r) => {
    /** @type {SizeRow} */
    const o = { name: r.name };
    for (const k of chart.measurements) o[k] = r[k];
    return o;
  });
  return JSON.stringify({ measurements: chart.measurements.slice(), baseSize: chart.baseSize, rows }, null, 2);
}

/**
 * Fabric estimate: cut bboxes (width doubled for fold pieces), repeated cutQty times, shelf-packed on the fabric width.
 * opts: { fabricWidth_mm = 1400, gap_mm = 10, spacing_mm = 2 }
 * @param {Piece[]} pieces @param {string} sizeName @param {object} [opts]
 * @returns {{length_m: number, width_mm: number, area_cm2: number, items: number}}
 */
export function fabricEstimate(pieces, sizeName, opts) {
  const o = opts || {};
  const width = Number.isFinite(o.fabricWidth_mm) && o.fabricWidth_mm > 0 ? o.fabricWidth_mm : 1400;
  const gap = Number.isFinite(o.gap_mm) ? o.gap_mm : 10;
  /** @type {{id: string, w: number, h: number}[]} */
  const items = [];
  let area_mm2 = 0;
  for (const piece of pieces || []) {
    const g = buildPieceGeometry(piece, sizeName, { spacing_mm: o.spacing_mm });
    const fold = piece.foldEdge !== null && piece.foldEdge !== undefined;
    const w = (g.bbox.maxX - g.bbox.minX) * (fold ? 2 : 1);
    const h = g.bbox.maxY - g.bbox.minY;
    const qty = Number.isInteger(piece.cutQty) && piece.cutQty > 0 ? piece.cutQty : 1;
    for (let k = 0; k < qty; k++) items.push({ id: `${piece.id}#${k}`, w, h });
    area_mm2 += g.area_mm2 * (fold ? 2 : 1) * qty;
  }
  if (items.length === 0) return { length_m: 0, width_mm: width, area_cm2: 0, items: 0 };
  const pack = packRects(items, width, { gap, allowRotate: false });
  return { length_m: pack.height / 1000, width_mm: width, area_cm2: area_mm2 / 100, items: items.length };
}

/**
 * Piece measurements CSV (SPEC 10.5): one line per edge, one summary line per piece, one fabric line per size.
 * opts: { fabricWidth_mm = 1400, gap_mm = 10, spacing_mm = 2 }
 * @param {ProjectDoc} doc @param {SizeChart} chart @param {object} [opts] @returns {string}
 */
export function pieceMeasurementsCsv(doc, chart, opts) {
  const o = opts || {};
  const lines = [MEASUREMENTS_HEADER];
  const seams = doc.seams || [];
  for (const row of chart.rows) {
    const size = row.name;
    const all = doc.pieces.map((p) => gradePiece(p, chart, size));
    const visible = all.filter((p) => p.exportHidden !== true);
    let sizeArea_cm2 = 0;
    for (const piece of visible) {
      const geom = buildPieceGeometry(piece, size, { spacing_mm: o.spacing_mm });
      const fold = piece.foldEdge !== null && piece.foldEdge !== undefined;
      const n = piece.edges.length;
      let perimeter = 0;
      let foldLen = 0;
      for (let i = 0; i < n; i++) {
        const len = edgeLength(piece, i);
        perimeter += len;
        if (fold && i === piece.foldEdge) foldLen = len;
        const seam = seams.find((s) => (s.a.pieceId === piece.id && s.a.edge === i) || (s.b.pieceId === piece.id && s.b.edge === i)) || null;
        let seamId = '';
        let partner = '';
        let partnerLen = '';
        let ease = '';
        if (seam) {
          seamId = seam.id;
          const other = (seam.a.pieceId === piece.id && seam.a.edge === i) ? seam.b : seam.a;
          partner = `${other.pieceId}:${other.edge}`;
          const otherPiece = all.find((p) => p.id === other.pieceId);
          if (otherPiece && other.edge >= 0 && other.edge < otherPiece.edges.length) {
            partnerLen = fmtCsv(round(edgeLength(otherPiece, other.edge), 1));
            try {
              ease = fmtCsv(round(seamEasePct(all, seam).easePct, 1));
            } catch (e) {
              if (e && e.code === 'NotImplemented') throw e;
              ease = '';
            }
          }
        }
        lines.push(csvLine([
          size, piece.name, piece.cutQty, fold ? 1 : 0, i, (piece.edges[i] && piece.edges[i].label) || '',
          fmtCsv(round(len, 1)), geom.allowances[i], seamId, partner, partnerLen, ease, '', '',
        ]));
      }
      const totalLen = fold ? perimeter * 2 - 2 * foldLen : perimeter;
      const area_cm2 = (geom.area_mm2 * (fold ? 2 : 1)) / 100;
      lines.push(csvLine([size, piece.name, piece.cutQty, fold ? 1 : 0, 'total', '', fmtCsv(round(totalLen, 1)), '', '', '', '', '', fmtCsv(round(area_cm2, 2)), '']));
      sizeArea_cm2 += area_cm2 * (Number.isInteger(piece.cutQty) && piece.cutQty > 0 ? piece.cutQty : 1);
    }
    const est = fabricEstimate(visible, size, o);
    lines.push(csvLine([size, '*', '', '', 'fabric', '', '', '', '', '', '', '', fmtCsv(round(sizeArea_cm2, 2)), fmtCsv(round(est.length_m, 2))]));
  }
  return lines.join('\n');
}
