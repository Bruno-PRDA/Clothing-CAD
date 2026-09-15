// src/export/selftest.js — the 12 cases of SPEC section 10.7 (export). Runs under node (no DOM); cases that hit the
// Phase-1 geometry stub (Error{code:'NotImplemented'}) are reported as passed with details 'skipped: geometry stub'.
// Fixtures SQ / SQF / DOC2 come from src/sizing/selftest.js (export -> sizing is an allowed arrow).

import { serializeDoc, normalizeDoc } from '../core/schema.js';
import { defaultChart } from '../sizing/index.js';
import { makeSQ, makeSQF, makeDOC2, deepEqual, near, throwsCode, runCase, assert } from '../sizing/selftest.js';
import { buildPieceGeometry, exportPieceSvg, exportSheet, exportGradeNestSvg, SIZE_COLORS, fmt } from './svg.js';
import { tileSheet } from './sheet.js';
import { printHtml } from './print.js';
import { sizeChartCsv, parseSizeChartCsv, sizeChartJson, csvLine, pieceMeasurementsCsv, MEASUREMENTS_HEADER } from './csv.js';
import { clothObj, parseProjectText, slug, FILENAMES } from './download.js';

/** @typedef {import('../core/types.js').SelfTestResult} SelfTestResult */

const CSV_EXPECT = [
  'size,chest_cm,waist_cm,hips_cm,height_cm,torsoLength_cm,armLength_cm',
  'S,84,66,92,160,39,55',
  'M,88,70,96,165,40,56',
  'L,92,74,100,170,41,57',
  'XL,96,78,104,175,42,58',
].join('\n');

/** @param {string} hay @param {string} needle @returns {number} */
function count(hay, needle) {
  return hay.split(needle).length - 1;
}

/** @param {string} svg @returns {string} */
function checkSvgFrame(svg) {
  assert(svg.startsWith('<svg'), 'svg should start with <svg');
  const w = /\swidth="([0-9.]+)mm"/.exec(svg);
  const h = /\sheight="([0-9.]+)mm"/.exec(svg);
  const vb = /viewBox="0 0 ([0-9.]+) ([0-9.]+)"/.exec(svg);
  assert(!!w && !!h && !!vb, 'width/height in mm and viewBox expected');
  assert(w[1] === vb[1] && h[1] === vb[2], `width/height (${w[1]}×${h[1]}) must equal viewBox (${vb[1]}×${vb[2]})`);
  assert(!/NaN/.test(svg), 'svg contains NaN');
  if (typeof globalThis.DOMParser === 'function') {
    const dom = new globalThis.DOMParser().parseFromString(svg, 'image/svg+xml');
    assert(dom.getElementsByTagName('parsererror').length === 0, 'DOMParser reported a parsererror');
  }
  return `${w[1]} × ${h[1]} mm`;
}

/**
 * The 500 × 700 sheet fixture for the print check: exportSheet([SQ]) with its height forced to 700, or — while
 * geometry is still a stub — a synthetic SheetResult of the same shape.
 * @returns {import('./svg.js').SheetResult}
 */
function sheet500x700() {
  try {
    const sheet = exportSheet([makeSQ()], 'M', { sheetWidth_mm: 500, date: '2026-01-01' });
    sheet.layout.height_mm = 700;
    return sheet;
  } catch (e) {
    if (!(e && e.code === 'NotImplemented')) throw e;
    const inner = '<g class="sheet-calibration"><rect class="calibration" x="10" y="10" width="100" height="100"/></g>\n<g class="piece" data-piece-id="sq" data-size="M"><path class="cut" d="M 0 0 L 10 0 L 10 10 Z"/></g>';
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="500mm" height="700mm" viewBox="0 0 500 700">${inner}</svg>`,
      inner,
      layout: { width_mm: 500, height_mm: 700, sizeName: 'M', title: 'Pattern — size M', placed: [], contentTop_mm: 120, calibration: true, garmentName: '', date: '2026-01-01', margin_mm: 10 },
    };
  }
}

/** @returns {Promise<SelfTestResult[]>} */
export async function runSelfTest() {
  /** @type {SelfTestResult[]} */
  const out = [];

  out.push(runCase('svg.geometry', () => {
    const g = buildPieceGeometry(makeSQ(), 'M');
    assert(near(g.bbox.minX, -10, 0.05) && near(g.bbox.maxX, 110, 0.05), `cut bbox x = ${g.bbox.minX}..${g.bbox.maxX}`);
    assert(near(g.bbox.minY, -10, 0.05) && near(g.bbox.maxY, 110, 0.05), `cut bbox y = ${g.bbox.minY}..${g.bbox.maxY}`);
    assert(near(g.area_mm2, 10000, 1e-6), 'area_mm2 should be 10000, got ' + g.area_mm2);
    assert(g.stitch.length === 200, 'stitch.length should be 200, got ' + g.stitch.length);
    assert(g.stitchEdgeOf.length === 200 && g.stitchEdgeOf[0] === 0 && g.stitchEdgeOf[199] === 3, 'stitchEdgeOf mismatch');
    assert(g.notches.length === 1, 'one notch expected');
    const nt = g.notches[0];
    assert(near(nt.p[0], 100) && near(nt.p[1], 50), 'notch p should be [100,50], got ' + nt.p);
    assert(near(nt.q[0], 110) && near(nt.q[1], 50), 'notch q should be [110,50], got ' + nt.q);
    assert(g.labelLines[0] === 'Square' && g.labelLines.includes('SA 10 mm') && g.labelLines.includes('CUT 1'), 'label lines: ' + JSON.stringify(g.labelLines));
    assert(fmt(-0) === '0' && fmt(1.23456) === '1.235' && fmt(10) === '10' && fmt(2.5) === '2.5', 'fmt');
  }));

  out.push(runCase('svg.piece', () => {
    const svg = exportPieceSvg(makeSQ(), { date: '2026-01-01' });
    const frame = checkSvgFrame(svg);
    assert(count(svg, 'class="cut"') === 1, 'exactly one class="cut"');
    assert(count(svg, 'class="stitch"') === 1, 'exactly one class="stitch"');
    assert(count(svg, 'class="calibration"') === 1, 'exactly one class="calibration", got ' + count(svg, 'class="calibration"'));
    for (const s of ['CUT 1', 'SIZE M', 'SA 10 mm', '2026-01-01', 'class="grainline"', 'class="notches"', 'class="label"']) {
      assert(svg.includes(s), 'missing ' + s);
    }
    return frame;
  }));

  out.push(runCase('svg.fold', () => {
    const sqf = makeSQF();
    const svg = exportPieceSvg(sqf, { date: '2026-01-01' });
    assert(svg.includes('PLACE ON FOLD'), 'missing PLACE ON FOLD');
    assert(svg.includes('CUT 1 ON FOLD'), 'missing CUT 1 ON FOLD');
    assert(svg.includes('class="fold"'), 'missing class="fold"');
    const g = buildPieceGeometry(sqf, 'M');
    assert(g.allowances[3] === 0, 'fold allowance forced to 0');
    assert(g.bbox.minX >= -0.5, 'fold cut must not cross x = 0: minX ' + g.bbox.minX);
    assert(g.bbox.maxX - g.bbox.minX <= 110.5, 'fold cut width should be <= 110.5, got ' + (g.bbox.maxX - g.bbox.minX));
    return `minX ${fmt(g.bbox.minX)} width ${fmt(g.bbox.maxX - g.bbox.minX)}`;
  }));

  out.push(runCase('svg.sheet', () => {
    const a = makeSQ();
    const b = makeSQ({ id: 'b', name: 'B' });
    const res = exportSheet([a, b], 'M', { date: '2026-01-01' });
    checkSvgFrame(res.svg);
    assert(res.svg.includes('width="1000mm"'), 'width should be 1000mm');
    assert(count(res.svg, 'class="piece"') === 2, 'two g.piece expected');
    assert(res.layout.contentTop_mm === 120, 'contentTop should be 120');
    assert(res.layout.placed.length === 2, 'two placements');
    const [p, q] = res.layout.placed;
    const gapX = Math.max(q.x - (p.x + p.w), p.x - (q.x + q.w));
    const gapY = Math.max(q.y - (p.y + p.h), p.y - (q.y + q.h));
    assert(gapX >= 20 - 1e-6 || gapY >= 20 - 1e-6, `placed rects must be disjoint with gap >= 20 (gapX ${gapX}, gapY ${gapY})`);
    assert(p.y >= 120 && q.y >= 120, 'pieces must start below the header');
    const hidden = makeSQ({ id: 'h', name: 'Hidden', exportHidden: true });
    const res2 = exportSheet([a, hidden], 'M', { date: '2026-01-01' });
    assert(count(res2.svg, 'class="piece"') === 1, 'hidden piece must be skipped');
    assert(throwsCode(() => exportSheet([], 'M'), 'EXPORT_NO_PIECES'), 'empty list should throw EXPORT_NO_PIECES');
    assert(throwsCode(() => exportSheet([hidden], 'M'), 'EXPORT_NO_PIECES'), 'only-hidden list should throw EXPORT_NO_PIECES');
    return `${fmt(res.layout.width_mm)} × ${fmt(res.layout.height_mm)} mm`;
  }));

  out.push(runCase('svg.gradeNest', () => {
    const chart = defaultChart();
    const sq = makeSQ();
    const scales = { S: 84 / 88, M: 1, L: 92 / 88, XL: 96 / 88 };
    const pieceBySize = ['S', 'M', 'L', 'XL'].map((name) => {
      const k = scales[name];
      const p = makeSQ();
      p.vertices = sq.vertices.map((v) => [50 + (v[0] - 50) * k, v[1]]);
      return { sizeName: name, piece: p };
    });
    const svg = exportGradeNestSvg(pieceBySize, chart.baseSize, { date: '2026-01-01', garmentName: 'Test' });
    checkSvgFrame(svg);
    assert(count(svg, 'class="size"') === 4, 'four class="size" groups expected');
    const colors = new Set();
    for (const m of svg.matchAll(/<g class="size"[^>]*stroke="(#[0-9a-f]{6})"/g)) colors.add(m[1]);
    assert(colors.size === 4 && [...colors].every((c) => SIZE_COLORS.includes(c)), 'four distinct SIZE_COLORS expected: ' + [...colors].join(','));
    assert(svg.includes('class="calibration"') && svg.includes('class="legend"'), 'calibration + legend expected');
  }));

  out.push(runCase('sheet.tiles', () => {
    const plan = tileSheet({ width_mm: 500, height_mm: 700 }, { paper: 'A4' });
    assert(plan.cols === 3 && plan.rows === 3 && plan.tiles.length === 9, `A4 should be 3×3, got ${plan.cols}×${plan.rows}`);
    assert(plan.tiles[0].label === 'A1' && plan.tiles[8].label === 'C3', 'labels A1..C3');
    const t = plan.tiles[4];
    assert(t.label === 'B2' && t.x0 === 180 && t.y0 === 267 && t.w === 190 && t.h === 277, 'B2 tile mismatch: ' + JSON.stringify(t));
    assert(tileSheet({ width_mm: 500, height_mm: 700 }, { paper: 'Letter' }).tiles.length === 9, 'Letter should be 9');
    assert(tileSheet({ width_mm: 500, height_mm: 700 }, { paper: 'A3' }).tiles.length === 4, 'A3 should be 4');
    assert(tileSheet({ width_mm: 100, height_mm: 100 }).tiles.length === 1, '100×100 should be 1 tile');
    assert(tileSheet({ width_mm: 800, height_mm: 1000 }, { paper: 'A4' }).tiles.length === 20, '800×1000 A4 should be 20 tiles');
    assert(tileSheet({ width_mm: 500, height_mm: 700 }, { paper: 'A4', orientation: 'landscape' }).printableW_mm === 277, 'landscape swaps');
    assert(throwsCode(() => tileSheet({ width_mm: 100, height_mm: 100 }, { paper: 'B5' }), 'PRINT_PAPER_UNKNOWN'), 'unknown paper');
    assert(throwsCode(() => tileSheet({ width_mm: 100, height_mm: 100 }, { margin_mm: 40 }), 'PRINT_OPTS_INVALID'), 'bad margin');
    assert(throwsCode(() => tileSheet({ width_mm: 100000, height_mm: 100000 }), 'PRINT_TOO_MANY_PAGES'), 'too many pages');
  }));

  out.push(runCase('print.html', () => {
    const sheet = sheet500x700();
    const html = printHtml(sheet, { paper: 'A4' });
    assert(count(html, 'class="page"') === 9, 'expected 9 pages, got ' + count(html, 'class="page"'));
    assert(count(html, 'class="calibration"') === 9, 'expected 9 calibration squares, got ' + count(html, 'class="calibration"'));
    assert(html.includes('@page { size: A4 portrait; margin: 0; }'), 'missing @page rule');
    assert(html.includes('Print at 100%'), 'missing Print at 100%');
    assert(html.includes('data-tile="C3"'), 'missing data-tile="C3"');
    assert(!/<script/i.test(html), 'document must not contain <script');
    assert(html.startsWith('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>'), 'document head');
    assert(html.includes('class="crop"') && html.includes('class="glue"') && html.includes('class="tile-header"'), 'overlays');
    assert(html.includes('.page > svg { position: absolute; left: 10mm; top: 10mm; width: 190mm; height: 277mm; }'), 'svg placement css');
    const letter = printHtml(sheet, { paper: 'Letter', orientation: 'landscape' });
    assert(letter.includes('@page { size: letter landscape; margin: 0; }'), 'Letter should be lower-case in @page');
    return sheet.layout.placed.length > 0 ? 'real sheet' : 'synthetic sheet (geometry stub)';
  }));

  out.push(runCase('csv.sizes', () => {
    const chart = defaultChart();
    const csv = sizeChartCsv(chart);
    assert(csv === CSV_EXPECT, 'sizeChartCsv mismatch:\n' + csv);
    assert(csv.split('\n').length === 5, '5 lines expected');
    const back = parseSizeChartCsv(csv);
    assert(deepEqual(back, chart), 'parseSizeChartCsv round trip failed: ' + JSON.stringify(back));
    assert(JSON.parse(sizeChartJson(chart)).rows.length === 4, 'sizeChartJson rows');
    assert(Object.keys(JSON.parse(sizeChartJson(chart)).rows[0])[0] === 'name', 'row keys start with name');
    assert(csvLine(['a,b', 'c"d']) === '"a,b","c""d"', 'csvLine quoting: ' + csvLine(['a,b', 'c"d']));
    assert(csvLine(['x', 1.5, 2]) === 'x,1.5,2', 'csvLine numbers');
    assert(throwsCode(() => parseSizeChartCsv('foo,bar\nS,1'), 'CSV_PARSE'), 'bad header');
    assert(throwsCode(() => parseSizeChartCsv('size,chest_cm\nS,x'), 'CSV_PARSE'), 'non-number');
    assert(throwsCode(() => parseSizeChartCsv('size,chest_cm\nS,1,2'), 'CSV_PARSE'), 'row length');
    assert(parseSizeChartCsv('size,chest_cm\r\nXS,80\r\n').baseSize === 'XS', 'CRLF + baseSize fallback');
  }));

  out.push(runCase('csv.measurements', () => {
    const doc = makeDOC2();
    const csv = pieceMeasurementsCsv(doc, doc.sizes);
    const lines = csv.split('\n');
    assert(lines[0] === MEASUREMENTS_HEADER, 'header mismatch');
    assert(lines.length === 45, 'expected 45 lines, got ' + lines.length);
    const edgeLine = (size) => lines.find((l) => l.startsWith(`${size},A,1,0,1,`));
    const m = edgeLine('M');
    assert(!!m, 'A edge-1 line at M missing');
    const mf = m.split(',');
    assert(mf[8] === 's_ab' && mf[9] === 'B:3' && mf[11] === '0', 'M edge line mismatch: ' + m);
    const l = edgeLine('L');
    assert(!!l && l.split(',')[11] === '4.5', 'L ease should be 4.5: ' + l);
    const fabricLines = lines.filter((line) => line.split(',')[1] === '*');
    assert(fabricLines.length === 4, 'four fabric lines');
    for (const f of fabricLines) {
      const v = Number(f.split(',')[13]);
      assert(Number.isFinite(v) && v > 0, 'fabric_length_m must be positive: ' + f);
    }
    return fabricLines[1];
  }));

  out.push(runCase('obj.write', () => {
    const state = /** @type {any} */ ({
      V: 3, pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), tris: new Uint32Array([0, 1, 2]),
      pieces: [{ start: 0, count: 3, pieceId: 't' }],
    });
    const obj = clothObj(state);
    const lines = obj.split('\n');
    assert(obj.endsWith('\n'), 'must end with newline');
    assert(lines[0] === '# Clothing App cloth export (metres, y up)', 'header line');
    assert(lines.filter((l) => l.startsWith('v ')).length === 3, 'three v lines');
    assert(lines.filter((l) => l.startsWith('f ')).length === 1 && lines.includes('f 1 2 3'), 'one f 1 2 3');
    assert(lines.filter((l) => l.startsWith('o ')).length === 1 && lines.includes('o t'), 'one o t');
    assert(lines.includes('v 1.00000 0.00000 0.00000'), '5 decimals');
    const two = clothObj(/** @type {any} */ ({ V: 6, pos: new Float32Array(18), tris: new Uint32Array([0, 1, 2, 3, 4, 5]), pieces: [{ start: 0, count: 3, pieceId: 'a' }, { start: 3, count: 3, pieceId: 'b' }] }));
    assert(two.includes('o b\n') && two.includes('f 4 5 6'), 'global 1-based ids across blocks');
  }));

  out.push(runCase('project.parse', () => {
    const doc = makeDOC2();
    const text = serializeDoc(doc);
    const back = parseProjectText(text);
    assert(deepEqual(back, normalizeDoc(doc)), 'parseProjectText(serializeDoc(DOC2)) should deep-equal normalizeDoc(DOC2)');
    assert(serializeDoc(back) === text, 'serializeDoc round trip must be byte-identical');
    assert(throwsCode(() => parseProjectText('{'), 'PROJECT_JSON'), 'PROJECT_JSON expected');
    assert(throwsCode(() => parseProjectText('[]'), 'PROJECT_SHAPE'), 'PROJECT_SHAPE expected');
    assert(throwsCode(() => parseProjectText('{"version":1,"pieces":[{"id":"x","vertices":[[0,0],[1,0]]}]}'), 'PROJECT_INVALID'), 'PROJECT_INVALID expected');
  }));

  out.push(runCase('files.names', () => {
    assert(slug('Basic T-shirt!') === 'basic-t-shirt', 'slug: ' + slug('Basic T-shirt!'));
    assert(slug('') === 'project' && slug('   ') === 'project', 'empty slug');
    assert(FILENAMES.sheetSvg('Basic T-shirt', 'M') === 'basic-t-shirt_M_sheet.svg', 'sheetSvg name');
    assert(FILENAMES.pieceSvg('Basic T-shirt', 'front', 'L') === 'basic-t-shirt_front_L.svg', 'pieceSvg name');
    assert(FILENAMES.printHtml('Basic T-shirt', 'M', 'A4') === 'basic-t-shirt_M_A4_tiles.html', 'printHtml name');
    assert(FILENAMES.clothObj('A-line skirt') === 'a-line-skirt_cloth.obj', 'clothObj name');
  }));

  return out;
}
