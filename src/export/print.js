// src/export/print.js — tiled print pages (SPEC section 10.4). Pure: returns a complete self-contained HTML string
// (no <script>); the UI opens it on a user click. Exact strings matter for automation.

import { tileSheet } from './sheet.js';
import { fmt, escapeXml, SHEET_CALIBRATION_CLASS } from './svg.js';

/** @typedef {import('./svg.js').SheetResult} SheetResult */
/** @typedef {import('./sheet.js').TilePlan} TilePlan */

const FONT = 'Arial, Helvetica, sans-serif';

/**
 * Removes the sheet-level calibration group from the sheet markup: every tile carries its own 100 mm square, and a
 * sheet square straddling tiles would be misleading. `inner` is otherwise embedded verbatim.
 * @param {string} inner @returns {string}
 */
function stripSheetCalibration(inner) {
  const re = new RegExp(`<g class="${SHEET_CALIBRATION_CLASS}"[\\s\\S]*?</g>\\n?`);
  return inner.replace(re, '');
}

/** @param {number} w @param {number} h @returns {string} four L-shaped 5 mm crop marks, stroke 0.2 */
function cropMarks(w, h) {
  const W = fmt(w);
  const H = fmt(h);
  return `<g class="crop" fill="none" stroke="#000" stroke-width="0.2">` +
    `<path d="M 0 5 L 0 0 L 5 0"/>` +
    `<path d="M ${fmt(w - 5)} 0 L ${W} 0 L ${W} 5"/>` +
    `<path d="M ${W} ${fmt(h - 5)} L ${W} ${H} L ${fmt(w - 5)} ${H}"/>` +
    `<path d="M 5 ${H} L 0 ${H} L 0 ${fmt(h - 5)}"/>` +
    `</g>`;
}

/**
 * @param {TilePlan['tiles'][number]} tile @param {TilePlan} plan @returns {string}
 */
function glueStrips(tile, plan) {
  const ov = plan.overlap_mm;
  if (ov <= 0) return '';
  const parts = [`<g class="glue" stroke-width="0.2">`];
  if (tile.col > 0) {
    parts.push(`<rect x="0" y="0" width="${fmt(ov)}" height="${fmt(tile.h)}" fill="#000" fill-opacity="0.06" stroke="none"/>`);
    parts.push(`<path d="M ${fmt(ov)} 0 L ${fmt(ov)} ${fmt(tile.h)}" fill="none" stroke="#000" stroke-dasharray="3 2"/>`);
  }
  if (tile.row > 0) {
    parts.push(`<rect x="0" y="0" width="${fmt(tile.w)}" height="${fmt(ov)}" fill="#000" fill-opacity="0.06" stroke="none"/>`);
    parts.push(`<path d="M 0 ${fmt(ov)} L ${fmt(tile.w)} ${fmt(ov)}" fill="none" stroke="#000" stroke-dasharray="3 2"/>`);
  }
  parts.push('</g>');
  return parts.join('\n');
}

/** @param {number} h @returns {string} */
function tileCalibration(h) {
  return `<rect class="calibration" x="12" y="${fmt(h - 112)}" width="100" height="100" fill="none" stroke="#888" stroke-width="0.35"/>` +
    `\n<text x="62" y="${fmt(h - 60)}" text-anchor="middle" font-family="${FONT}" font-size="5" fill="#888">100 mm</text>`;
}

/**
 * @param {TilePlan['tiles'][number]} tile @param {TilePlan} plan @param {string} title @returns {string}
 */
function tileHeader(tile, plan, title) {
  const ov = plan.overlap_mm;
  const count = plan.tiles.length;
  const line1 = `Print at 100% — no fit-to-page — Tile ${tile.label} (${tile.index + 1}/${count}) — ${title} — ${plan.paper} ${plan.cols}×${plan.rows}`;
  const line2 = `Row ${tile.row + 1}/${plan.rows}, column ${tile.col + 1}/${plan.cols}. Align on the dashed lines; check the 100 mm square.`;
  return `<text class="tile-header" x="${fmt(ov + 2)}" y="${fmt(ov + 5)}" font-family="${FONT}" font-size="3.5" fill="#000">` +
    `<tspan x="${fmt(ov + 2)}" dy="0">${escapeXml(line1)}</tspan>` +
    `<tspan x="${fmt(ov + 2)}" dy="4.5">${escapeXml(line2)}</tspan></text>`;
}

/**
 * @param {TilePlan['tiles'][number]} tile @param {TilePlan} plan @returns {string}
 */
function neighbourHints(tile, plan) {
  const parts = [`<g class="hints" font-family="${FONT}" font-size="3" fill="#000" stroke="none">`];
  const w = tile.w;
  const h = tile.h;
  if (tile.col + 1 < plan.cols) {
    const label = plan.tiles[tile.index + 1].label;
    parts.push(`<text x="${fmt(w - 2)}" y="${fmt(h / 2)}" text-anchor="end">${escapeXml(label)} →</text>`);
  }
  if (tile.col > 0) {
    const label = plan.tiles[tile.index - 1].label;
    parts.push(`<text x="${fmt(plan.overlap_mm + 2)}" y="${fmt(h / 2)}" text-anchor="start">← ${escapeXml(label)}</text>`);
  }
  if (tile.row + 1 < plan.rows) {
    const label = plan.tiles[tile.index + plan.cols].label;
    parts.push(`<text x="${fmt(w / 2)}" y="${fmt(h - 2)}" text-anchor="middle">${escapeXml(label)} ↓</text>`);
  }
  if (tile.row > 0) {
    const label = plan.tiles[tile.index - plan.cols].label;
    parts.push(`<text x="${fmt(w / 2)}" y="${fmt(plan.overlap_mm + 12)}" text-anchor="middle">↑ ${escapeXml(label)}</text>`);
  }
  parts.push('</g>');
  return parts.join('\n');
}

/**
 * Complete self-contained HTML document with one printable page per tile.
 * opts: { paper='A4', orientation='portrait', margin_mm=10, overlap_mm=10, garmentName='', calibration=true }
 * @param {SheetResult} sheet @param {object} [opts] @returns {{html: string, plan: TilePlan}}
 */
export function buildPrintDocument(sheet, opts) {
  const o = opts || {};
  const plan = tileSheet({ width_mm: sheet.layout.width_mm, height_mm: sheet.layout.height_mm }, {
    paper: o.paper, orientation: o.orientation, margin_mm: o.margin_mm, overlap_mm: o.overlap_mm,
  });
  const calibration = o.calibration !== false;
  const title = o.garmentName ? `${o.garmentName} — size ${sheet.layout.sizeName}` : sheet.layout.title;
  const inner = stripSheetCalibration(sheet.inner);
  const pageSize = `${plan.paper === 'Letter' ? 'letter' : plan.paper} ${plan.orientation}`;
  const pw = fmt(plan.paperW_mm);
  const ph = fmt(plan.paperH_mm);
  const m = fmt(plan.margin_mm);
  const w = fmt(plan.printableW_mm);
  const h = fmt(plan.printableH_mm);

  const parts = [];
  parts.push(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${escapeXml(title)} — ${plan.paper} tiles</title>`);
  parts.push('<style>');
  parts.push(`@page { size: ${pageSize}; margin: 0; }`);
  parts.push('html, body { margin: 0; padding: 0; }');
  parts.push(`.page { position: relative; width: ${pw}mm; height: ${ph}mm; overflow: hidden; page-break-after: always; break-after: page; }`);
  parts.push('.page:last-child { page-break-after: auto; break-after: auto; }');
  parts.push(`.page > svg { position: absolute; left: ${m}mm; top: ${m}mm; width: ${w}mm; height: ${h}mm; }`);
  parts.push('@media screen { body { background: #777; } .page { background: #fff; margin: 8px auto; box-shadow: 0 0 6px rgba(0,0,0,.5); } }');
  parts.push('</style></head><body>');
  for (const tile of plan.tiles) {
    parts.push(`<div class="page" data-tile="${tile.label}" data-row="${tile.row}" data-col="${tile.col}" data-index="${tile.index}">`);
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" data-units="mm">`);
    parts.push(`<g class="sheet" transform="translate(${fmt(-tile.x0)} ${fmt(-tile.y0)})">${inner}</g>`);
    parts.push(cropMarks(tile.w, tile.h));
    const glue = glueStrips(tile, plan);
    if (glue) parts.push(glue);
    if (calibration) parts.push(tileCalibration(tile.h));
    parts.push(tileHeader(tile, plan, title));
    parts.push(neighbourHints(tile, plan));
    parts.push('</svg>');
    parts.push('</div>');
  }
  parts.push('</body></html>');
  return { html: parts.join('\n'), plan };
}

/** buildPrintDocument(...).html. @param {SheetResult} sheet @param {object} [opts] @returns {string} */
export function printHtml(sheet, opts) {
  return buildPrintDocument(sheet, opts).html;
}
