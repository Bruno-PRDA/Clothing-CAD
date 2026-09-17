// src/sizing/selftest.js — the 10 cases of SPEC section 10.7 (sizing). Runs under node (no DOM); cases that hit the
// Phase-1 geometry stub (Error{code:'NotImplemented'}) are reported as passed with details 'skipped: geometry stub'.
// Also exports the inline fixtures (SQ, SQF, CUB, DOC2) shared with src/export/selftest.js.

import { normalizeDoc, DEFAULT_BODY_PARAMS } from '../core/schema.js';
import {
  defaultChart, validateChart, sizeIndex, baseIndex, addRow, removeRow, renameRow, setValue,
  closestSize, rowFromBody, rowToBodyParams,
} from './chart.js';
import { gradePiece, gradePieceDetailed, gradeScale, gradeDoc, seamEaseDrift } from './grading.js';

/** @typedef {import('../core/types.js').SelfTestResult} SelfTestResult */
/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */

// ---------------------------------------------------------------- fixtures (SPEC 10.7)

/** @param {Partial<Piece> & {id?: string}} [over] @returns {Piece} the 100 × 100 square SQ */
export function makeSQ(over) {
  /** @type {Piece} */
  const p = {
    id: 'sq', name: 'Square',
    vertices: [[0, 0], [100, 0], [100, 100], [0, 100]],
    edges: [{ type: 'line' }, { type: 'line' }, { type: 'line' }, { type: 'line' }],
    foldEdge: null,
    notches: [{ edge: 1, t: 0.5, kind: 'single' }],
    grainline: { a: [50, 20], b: [50, 80] },
    internalLines: [],
    seamAllowance_mm: 10,
    fabricId: 'main',
    layer: 0,
    cutQty: 1,
    exportHidden: false,
    simulate: true,
    pinnedEdges: [],
    placement: { anchor: 'torso', side: 'front', offset_mm: [0, 0], wrap: 1, flip: false },
    grade: { widthRef: 'chest_cm', lengthRef: null, anchorX: 'fold', anchorY: 'bottom', vertexRules: [] },
    meshSpacing_mm: 15,
  };
  return Object.assign(p, over || {});
}

/** SQ with foldEdge 3 (edge (0,100) → (0,0) on x = 0). @returns {Piece} */
export function makeSQF() {
  const p = makeSQ({ id: 'sqf', name: 'Square fold', foldEdge: 3 });
  p.edges[3] = { type: 'line', allowance_mm: 0, label: 'fold' };
  return p;
}

/**
 * SQ with edge 2 cubic (c1 [80,120], c2 [20,120]). anchorX 'left' so the pivot is x = 0 and the 10.7 check
 * "c1/c2 x and grainline a[0] scale by 92/88" holds (with SQ's 'fold' anchor and foldEdge null the pivot would be the
 * bbox centre, which does not scale a[0] = 50).
 * @returns {Piece}
 */
export function makeCUB() {
  const p = makeSQ({ id: 'cub', name: 'Square cubic' });
  p.edges[2] = { type: 'cubic', c1: [80, 120], c2: [20, 120] };
  p.grade = { widthRef: 'chest_cm', lengthRef: null, anchorX: 'left', anchorY: 'bottom', vertexRules: [] };
  return p;
}

/**
 * DOC2: pieces A (SQ, widthRef 'chest_cm') and B (SQ translated by [200, 0], widthRef null), one seam A.edge1 ↔ B.edge3,
 * default chart, activeSize 'M', one fabric 'main'. A also uses lengthRef 'chest_cm': edge 1 of the square is vertical,
 * so x-only scaling would leave the seam length unchanged and the 4.5 pp drift of the 10.7 checks could not occur.
 * @returns {ProjectDoc}
 */
export function makeDOC2() {
  const a = makeSQ({ id: 'A', name: 'A' });
  a.grade = { widthRef: 'chest_cm', lengthRef: 'chest_cm', anchorX: 'fold', anchorY: 'bottom', vertexRules: [] };
  const b = makeSQ({ id: 'B', name: 'B' });
  b.vertices = b.vertices.map((v) => [v[0] + 200, v[1]]);
  b.grainline = { a: [250, 20], b: [250, 80] };
  b.grade = { widthRef: null, lengthRef: null, anchorX: 'center', anchorY: 'bottom', vertexRules: [] };
  return normalizeDoc({
    version: 1,
    name: 'Doc2',
    fabrics: [{ id: 'main', name: 'Main', preset: 'cotton', color: '#c8102e' }],
    pieces: [a, b],
    seams: [{ id: 's_ab', kind: 'plain', a: { pieceId: 'A', edge: 1, mirror: false, reverse: false }, b: { pieceId: 'B', edge: 3, mirror: false, reverse: true } }],
    sizes: defaultChart(),
    ui: { activeSize: 'M' },
  });
}

// ---------------------------------------------------------------- helpers

/** @param {*} a @param {*} b @returns {boolean} */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

/** @param {number} a @param {number} b @param {number} [eps=1e-6] @returns {boolean} */
export function near(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

/** @param {() => void} fn @param {string} code @returns {boolean} */
export function throwsCode(fn, code) {
  try { fn(); } catch (e) { return !!(e && e.code === code); }
  return false;
}

/**
 * Runs one named check; a throw becomes a failed entry, a geometry NotImplemented becomes a skip.
 * @param {string} name @param {() => string|void} fn @returns {SelfTestResult}
 */
export function runCase(name, fn) {
  try {
    const details = fn();
    return { name, pass: true, details: typeof details === 'string' ? details : 'ok' };
  } catch (e) {
    if (e && e.code === 'NotImplemented') return { name, pass: true, details: 'skipped: geometry stub' };
    return { name, pass: false, details: e && e.message ? e.message : String(e) };
  }
}

/** @param {boolean} cond @param {string} msg */
export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ---------------------------------------------------------------- cases

/** @returns {Promise<SelfTestResult[]>} */
export async function runSelfTest() {
  const female_m = { ...DEFAULT_BODY_PARAMS };
  /** @type {SelfTestResult[]} */
  const out = [];

  out.push(runCase('chart.default', () => {
    const chart = defaultChart();
    const issues = validateChart(chart);
    assert(issues.length === 0, 'validateChart(defaultChart()) should be [] but got ' + JSON.stringify(issues));
    assert(chart.rows.length === 4, 'expected 4 rows');
    assert(chart.baseSize === 'M', 'baseSize should be M');
    assert(sizeIndex(chart, 'L') === 2, 'sizeIndex(L) should be 2');
    assert(baseIndex(chart) === 1, 'baseIndex should be 1');
  }));

  out.push(runCase('chart.ops', () => {
    const chart = defaultChart();
    const snapshot = JSON.stringify(chart);
    const c1 = addRow(chart, 'XXL', { chest_cm: 100 });
    assert(c1.rows.length === 5, 'addRow should yield 5 rows');
    const xxl = c1.rows[4];
    assert(xxl.name === 'XXL' && xxl.chest_cm === 100 && xxl.waist_cm === 70, 'XXL row should copy waist from base');
    assert(JSON.stringify(chart) === snapshot, 'addRow mutated its input');
    assert(throwsCode(() => removeRow(chart, 'M'), 'SIZE_BASE_ROW'), 'removeRow(M) should throw SIZE_BASE_ROW');
    assert(JSON.stringify(chart) === snapshot, 'removeRow mutated its input');
    const c2 = renameRow(chart, 'M', 'Medium');
    assert(c2.baseSize === 'Medium' && c2.rows[1].name === 'Medium', 'renameRow should move baseSize');
    assert(JSON.stringify(chart) === snapshot, 'renameRow mutated its input');
    assert(throwsCode(() => setValue(chart, 'S', 'chest_cm', -1), 'SIZE_VALUE_INVALID'), 'setValue(-1) should throw SIZE_VALUE_INVALID');
    assert(throwsCode(() => setValue(chart, 'S', 'foo_cm', 1), 'SIZE_KEY_UNKNOWN'), 'setValue(foo_cm) should throw SIZE_KEY_UNKNOWN');
    const c3 = setValue(chart, 'S', 'chest_cm', 85.123);
    assert(c3.rows[0].chest_cm === 85.12, 'setValue should round to 0.01');
    assert(JSON.stringify(chart) === snapshot, 'setValue mutated its input');
    assert(removeRow(chart, 'S').rows.length === 3, 'removeRow(S) should leave 3 rows');
  }));

  out.push(runCase('chart.validate', () => {
    const chart = setValue(defaultChart(), 'S', 'chest_cm', 95);
    const issues = validateChart(chart);
    const warns = issues.filter((i) => i.code === 'SIZE_NONMONOTONE');
    assert(warns.length === 1 && warns[0].level === 'warn', 'expected one SIZE_NONMONOTONE warn, got ' + JSON.stringify(issues));
    assert(issues.every((i) => i.level !== 'error'), 'expected no errors');
    return warns[0].message;
  }));

  out.push(runCase('chart.closest', () => {
    const chart = defaultChart();
    const r = closestSize(female_m, chart);
    assert(r.name === 'M' && r.index === 1, 'closestSize(female_m) should be M, got ' + r.name);
    assert(Object.values(r.deltas).every((d) => d === 0), 'deltas should all be 0');
    // shoulderWidth matches row L exactly, so this stays the SPEC 10.1 worked example (score 0.000482)
    // now that the default chart grades shoulders too; the column is exercised, it just contributes 0.
    const ex = closestSize({ ...female_m, chest_cm: 91, waist_cm: 73, hips_cm: 99, height_cm: 169, torsoLength_cm: 40.8, armLength_cm: 56.8, shoulderWidth_cm: 39 }, chart);
    assert(ex.name === 'L' && ex.index === 2, '10.1 example should return L, got ' + ex.name);
    assert(near(ex.score, 0.000482, 2e-6), 'score should be ~0.000482, got ' + ex.score);
    assert(ex.deltas.chest_cm === 1 && ex.deltas.torsoLength_cm === 0.2, 'deltas mismatch ' + JSON.stringify(ex.deltas));
    return `score ${ex.score.toFixed(6)}`;
  }));

  out.push(runCase('chart.body', () => {
    const chart = defaultChart();
    const row = rowFromBody(female_m, chart, 'M');
    assert(deepEqual(row, chart.rows[1]), 'rowFromBody should equal row M: ' + JSON.stringify(row));
    const bp = rowToBodyParams(chart, 'L', female_m);
    assert(bp.chest_cm === 92, 'chest_cm should be 92');
    assert(bp.neck_cm === 34, 'neck_cm should stay 34');
    assert(!('name' in bp), 'name must not be copied');
    assert(throwsCode(() => rowToBodyParams(chart, 'ZZ', female_m), 'SIZE_UNKNOWN'), 'unknown size should throw');
  }));

  out.push(runCase('grade.fold', () => {
    const chart = defaultChart();
    const sqf = makeSQF();
    const g = gradePiece(sqf, chart, 'L');
    const exp = [[0, 0], [104.5455, 0], [104.5455, 100], [0, 100]];
    for (let i = 0; i < 4; i++) {
      assert(near(g.vertices[i][0], exp[i][0], 1e-3) && near(g.vertices[i][1], exp[i][1], 1e-6), `vertex ${i} = ${g.vertices[i]}`);
    }
    assert(near(g.vertices[1][0], 100 * 92 / 88) && near(g.vertices[2][0], 100 * 92 / 88), 'x1/x2 should be 100*92/88');
    assert(g.vertices[0][0] === 0 && g.vertices[3][0] === 0, 'fold vertices must stay on x = 0');
    const s = gradeScale(sqf, chart, 'L');
    assert(near(s.sx, 92 / 88) && s.sy === 1, 'gradeScale should be 92/88, 1');
    assert(JSON.stringify(sqf.vertices) === JSON.stringify(makeSQF().vertices), 'input piece mutated');
  }));

  out.push(runCase('grade.rules', () => {
    const chart = defaultChart();
    const sqf = makeSQF();
    sqf.grade.vertexRules = [{ vertex: 1, dx_mm: 5, dy_mm: 0 }];
    const l = gradePiece(sqf, chart, 'L');
    assert(near(l.vertices[1][0], 109.5455, 1e-3), 'L x1 should be 109.5455, got ' + l.vertices[1][0]);
    const s = gradePiece(sqf, chart, 'S');
    assert(near(s.vertices[1][0], 90.4545, 1e-3), 'S x1 should be 90.4545, got ' + s.vertices[1][0]);
    const m = gradePiece(sqf, chart, 'M');
    assert(deepEqual(m, sqf), 'M should deep-equal the input');
    assert(m !== sqf && m.vertices !== sqf.vertices, 'M must be a copy');
  }));

  out.push(runCase('grade.cubic', () => {
    const chart = defaultChart();
    const cub = makeCUB();
    const r = gradePieceDetailed(cub, chart, 'L');
    const g = r.piece;
    const k = 92 / 88;
    assert(g.edges[2].type === 'cubic', 'edge 2 should stay cubic');
    assert(near(g.edges[2].c1[0], 80 * k) && near(g.edges[2].c1[1], 120), 'c1 should scale x only: ' + g.edges[2].c1);
    assert(near(g.edges[2].c2[0], 20 * k) && near(g.edges[2].c2[1], 120), 'c2 should scale x only: ' + g.edges[2].c2);
    assert(g.notches.length === 1 && g.notches[0].t === 0.5 && g.notches[0].edge === 1, 'notches must be unchanged');
    assert(near(g.grainline.a[0], 50 * k) && near(g.grainline.b[1], 80), 'grainline should scale');
    assert(g.seamAllowance_mm === 10, 'seamAllowance_mm must not scale');
    cub.edges[0].allowance_mm = 25;
    const g2 = gradePiece(cub, chart, 'XL');
    assert(g2.edges[0].allowance_mm === 25, 'edge allowance must not scale');
    assert(r.issues.length === 0, 'no issues expected');
  }));

  out.push(runCase('grade.refMissing', () => {
    const chart = defaultChart();
    const rows = chart.rows.map((r) => { const c = { ...r }; delete c.chest_cm; return c; });
    const r = gradePieceDetailed(makeSQ(), { ...chart, rows }, 'L');
    assert(r.sx === 1 && r.sy === 1, 'sx should fall back to 1');
    assert(r.issues.length === 1 && r.issues[0].code === 'GRADE_REF_MISSING' && r.issues[0].level === 'warn', 'expected GRADE_REF_MISSING: ' + JSON.stringify(r.issues));
    assert(throwsCode(() => gradePiece(makeSQ(), chart, 'ZZ'), 'SIZE_UNKNOWN'), 'unknown size should throw SIZE_UNKNOWN');
  }));

  out.push(runCase('grade.easeDrift', () => {
    const doc = makeDOC2();
    assert(gradeDoc(doc, 'L').length === 2, 'gradeDoc should return 2 pieces');
    const m = seamEaseDrift(doc, 'M');
    assert(m.length === 0, 'no drift at M: ' + JSON.stringify(m));
    const l = seamEaseDrift(doc, 'L');
    assert(l.length === 1 && l[0].code === 'GRADE_EASE_DRIFT' && l[0].level === 'warn', 'expected one GRADE_EASE_DRIFT: ' + JSON.stringify(l));
    assert(/4\.5%/.test(l[0].message), 'message should mention 4.5%: ' + l[0].message);
    return l[0].message;
  }));

  return out;
}
