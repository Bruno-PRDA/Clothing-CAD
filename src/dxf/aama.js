// src/dxf/aama.js — pattern pieces to and from DXF-AAMA / ASTM D6673, the format apparel CAD systems exchange.
// Pure; no DOM. dxfio.js reads and writes the DXF text; this file gives it pattern meaning.
//
// The layout, per the standard: every piece is a BLOCK inserted in model space, with its data on numbered
// layers — 1 cut line (the piece boundary, seam allowance included), 2 turn points and 3 curve points (which
// vertices of the lines on 1, 8, 11 and 14 are corners and which are samples of a curve), 4 notches, 5 grade
// reference line, 6 mirror (fold) line, 7 grain line, 8 internal lines, 11 internal cutouts, 13 drill holes,
// 14 sew line (the stitching line), 15 annotation — and TEXT entries "Piece Name: …", "Size: …", "Quantity: …".
// Style text in model space ("Style Name:", "Sample Size:", "Units: METRIC|ENGLISH", …) describes the file.
//
// What the writer emits is the subset the research into real files found every reader accepts (docs/SPEC.md,
// "DXF-AAMA"): DXF R12 with only $ACADVER in the header and no TABLES (Gerber AccuMark rejects anything that is
// not a piece), one block per piece and size named "<piece>_<size>" from letters, digits, "_" and "-", INSERTs on
// layer 1 at 0,0, 7-bit ASCII text, curves as dense vertices (no bulges), notches as POINTs on a vertex of the
// cut line with depth (30), width (39) and inward angle (50). Fold pieces are written WHOLE with the fold as a
// centre line on layer 8 — a reader that ignores mirror lines would cut half a piece — unless the caller asks for
// the standard's half piece with a mirror line on layer 6.
//
// The app stores the STITCHING line and a seam allowance per edge; AAMA's boundary is the CUT line. Export
// writes both (layer 1 from the allowance offset, layer 14 from the outline; no layer 14 when there is no
// allowance, since it would repeat layer 1). Import uses the sew line when there is one and measures the
// allowance per edge against the cut line; without one, the cut line is taken as the outline with no allowance,
// and the report says so.

import { parseDxf, placeBlock, unbulge, createWriter, fnum } from './dxfio.js';
import { ringToEdges, guessTurns } from './fitcurve.js';
import { flattenPiece, sampleEdge, edgeLength } from '../geometry/bezier.js';
import { offsetPolygon } from '../geometry/offset.js';
import { mirrorPiece } from '../geometry/mirror.js';
import { signedArea, bbox, distToPolyline, distToSegment, pointInPolygon } from '../geometry/polygon.js';
import { gradeDoc } from '../sizing/index.js';

/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */
/** @typedef {[number, number]} Vec2 */

/** ASTM D6673 layer names by meaning. */
export const LAYER = Object.freeze({
  cut: '1', turn: '2', curve: '3', notch: '4', gradeRef: '5', mirror: '6', grain: '7', internal: '8',
  stripe: '9', plaid: '10', cutout: '11', drill: '13', sew: '14', text: '15',
});
/** ASTM's notch-shape layers (T, castle, check, U); read as ordinary notches. */
export const NOTCH_SHAPE_LAYERS = Object.freeze(['80', '81', '82', '83']);

/** Keys of the system text, as written; read case-insensitively. */
export const TEXT_KEY = Object.freeze({
  name: 'Piece Name', size: 'Size', quantity: 'Quantity', material: 'Material', annotation: 'Annotation',
  style: 'Style Name', date: 'Creation Date', time: 'Creation Time', author: 'Author', sample: 'Sample Size',
  ruleTable: 'Grade Rule Table', units: 'Units',
});

const MM_PER_IN = 25.4;
/** Fitting tolerance for curves rebuilt on import, mm. */
export const FIT_TOL_MM = 0.25;
/** Flattening tolerance for curves written on export, mm (0.1 mm is below what a cutter can resolve). */
export const FLATTEN_TOL_MM = 0.1;
/** Who wrote the file, "<vendor>;<application>;<release>" as the standard asks. */
export const DEFAULT_AUTHOR = 'Clothing CAD contributors;Clothing CAD;1.0.0';
/** A notch further than this from the outline belongs to something else. */
const NOTCH_MAX_MM = 40;
/** The standard has no double notch; files carry two notches this close together (10-12.5 mm in practice). */
const DOUBLE_NOTCH_MM = 13;
/** Chaining tolerance for boundaries written in pieces, file units. */
const CHAIN_TOL = 0.005;

// ------------------------------------------------------------------------------------------ export

/** Layer normalisation for reading: "L1", "1", " 1 " and "LAYER1" all mean layer 1. @param {string} l */
export function layerNo(l) {
  const m = /(\d+)\s*$/.exec(String(l || ''));
  return m ? String(parseInt(m[1], 10)) : String(l || '');
}

/** 7-bit ASCII for TEXT values, as the standard requires: accents dropped, anything else removed. @param {any} s */
function ascii(s) {
  return String(s === undefined || s === null ? '' : s).normalize('NFKD').replace(/[^\x20-\x7e]/g, '').trim();
}

/** Letters, digits, "_" and "-" only: the block names every reader accepts. @param {string} s */
function nameToken(s) {
  return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'PIECE';
}

/** Tangent direction (unit) leaving / arriving at a vertex along an edge, for corner detection. */
function edgeTangents(piece, e) {
  const n = piece.vertices.length;
  const p0 = piece.vertices[e], p1 = piece.vertices[(e + 1) % n];
  const ed = piece.edges[e];
  const out = ed && ed.type === 'cubic' ? [ed.c1[0] - p0[0], ed.c1[1] - p0[1]] : [p1[0] - p0[0], p1[1] - p0[1]];
  const inn = ed && ed.type === 'cubic' ? [p1[0] - ed.c2[0], p1[1] - ed.c2[1]] : [p1[0] - p0[0], p1[1] - p0[1]];
  const u = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  return { leave: u(out), arrive: u(inn) };
}

/** Is vertex v a corner (tangent turns by more than 3 degrees)? */
function isCorner(piece, v) {
  const n = piece.vertices.length;
  const a = edgeTangents(piece, (v - 1 + n) % n).arrive;
  const b = edgeTangents(piece, v).leave;
  return a[0] * b[0] + a[1] * b[1] < Math.cos(3 * Math.PI / 180);
}

/**
 * The flattened stitching outline, with which of its points are corners.
 * @param {Piece} piece @returns {{points: Vec2[], turn: boolean[], edgeStart: number[]}}
 */
function stitchRing(piece) {
  const { points, edgeStart } = flattenPiece(piece, FLATTEN_TOL_MM);
  const turn = new Array(points.length).fill(false);
  for (let v = 0; v < piece.vertices.length; v++) if (isCorner(piece, v)) turn[edgeStart[v]] = true;
  return { points, turn, edgeStart };
}

/**
 * Douglas-Peucker on a closed ring, anchored at its sharp corners: a straight run keeps only its ends, a curve
 * keeps what it needs to stay within `tol`. The offset works on 2 mm steps, which would otherwise put hundreds
 * of points on every straight edge — other systems then show a "curve" where the pattern has a line.
 * @param {Vec2[]} ring @param {number} tol @returns {Vec2[]}
 */
function simplifyRing(ring, tol) {
  const n = ring.length;
  if (n <= 4) return ring.map((q) => [q[0], q[1]]);
  const keep = new Array(n).fill(false);
  const sharp = guessTurns(ring, 30, Infinity);
  let anchors = [];
  for (let i = 0; i < n; i++) if (sharp[i]) anchors.push(i);
  if (anchors.length < 2) {
    let far = 0, fd = -1;
    for (let i = 1; i < n; i++) { const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (d > fd) { fd = d; far = i; } }
    anchors = [0, far];
  }
  for (const a of anchors) keep[a] = true;
  const stack = anchors.map((a, i) => [a, i + 1 < anchors.length ? anchors[i + 1] : anchors[0] + n]);
  while (stack.length) {
    const [i, j] = /** @type {[number, number]} */ (stack.pop());
    const A = ring[i % n], B = ring[j % n];
    let far = -1, fd = tol;
    for (let q = i + 1; q < j; q++) { const d = distToSegment(ring[q % n], A, B).dist; if (d > fd) { fd = d; far = q; } }
    if (far >= 0) { keep[far % n] = true; stack.push([i, far], [far, j]); }
  }
  return ring.filter((_, i) => keep[i]).map((q) => [q[0], q[1]]);
}

/**
 * The cut line: the stitching outline flattened at FLATTEN_TOL_MM (finer than the 0.5 mm the screen uses), offset by
 * each edge's allowance with mitred corners, then simplified.
 * @param {Piece} p @param {Vec2[]} sew @param {number[]} edgeStart @param {(e: number) => number} allowanceOf
 * @returns {Vec2[]}
 */
function cutLine(p, sew, edgeStart, allowanceOf) {
  const n = p.vertices.length;
  const alw = new Array(sew.length).fill(0);
  for (let e = 0; e < n; e++) {
    const s = edgeStart[e], t = e + 1 < n ? edgeStart[e + 1] : sew.length;
    for (let q = s; q < t; q++) alw[q] = allowanceOf(e);
  }
  const fold = Number.isInteger(p.foldEdge) && p.foldEdge >= 0 && p.foldEdge < n;
  let raw;
  try { raw = offsetPolygon(sew, alw, fold ? { join: 'mitre', foldX: p.vertices[/** @type {number} */ (p.foldEdge)][0] } : { join: 'mitre' }); }
  catch (_) { raw = sew; }
  return simplifyRing(raw, FLATTEN_TOL_MM / 2);
}

/**
 * Which cut-line points are corners, from where each lies against the stitching line. A point whose nearest stitch
 * point IS a stitch vertex sits in that vertex's join (a mitre, a square-off step between two allowances): a corner,
 * unless the vertex is smooth with the same allowance on both sides. A point on the offsets of two edges that do not
 * meet smoothly is where they cross (an inside corner): a corner. Anything else lies on one edge's offset: a curve
 * point. (An angle test cannot tell a tight curve from a shallow corner.)
 * @param {Vec2[]} cut @param {Piece} p @param {Vec2[]} sew @param {number[]} edgeStart @param {(e: number) => number} allowanceOf
 * @returns {boolean[]}
 */
function cutTurns(cut, p, sew, edgeStart, allowanceOf) {
  const n = p.vertices.length;
  /** @type {Vec2[][]} */
  const polys = [];
  for (let e = 0; e < n; e++) {
    const s = edgeStart[e], t = e + 1 < n ? edgeStart[e + 1] : sew.length;
    polys.push(sew.slice(s, t).concat([sew[t % sew.length]]));
  }
  const smooth = p.vertices.map((_, v) => !isCorner(p, v) && Math.abs(allowanceOf((v - 1 + n) % n) - allowanceOf(v)) < 0.01);
  return cut.map((c) => {
    let best = Infinity, atVertex = -1;
    /** @type {number[]} */
    const on = [];
    for (let e = 0; e < n; e++) {
      const r = distToPolyline(c, polys[e], false);
      if (Math.abs(r.dist - allowanceOf(e)) < 0.1) on.push(e);
      if (r.dist < best) {
        best = r.dist;
        const last = polys[e].length - 2;
        atVertex = r.seg === 0 && r.t < 1e-6 ? e : r.seg === last && r.t > 1 - 1e-6 ? (e + 1) % n : -1;
      }
    }
    if (atVertex >= 0) return !smooth[atVertex];
    // on two offsets at once, unless the two edges run smoothly into each other at their shared vertex
    for (let x = 0; x < on.length; x++) {
      for (let y = x + 1; y < on.length; y++) {
        const e1 = on[x], e2 = on[y];
        const smoothPair = (e2 === (e1 + 1) % n && smooth[e2]) || (e1 === (e2 + 1) % n && smooth[e1]);
        if (!smoothPair) return true;
      }
    }
    return false;
  });
}

/**
 * Notches as the standard's POINTs: on the cut line, pointing into the piece. The app draws a notch across the whole
 * allowance; a cutter's notch is shallower, so the depth is half the allowance, 3 to 6 mm (4 mm with no allowance).
 * A double notch is two notches 4 mm apart, as the app draws it.
 * @param {Piece} piece @param {(e: number) => number} allowanceOf
 * @returns {Array<{at: Vec2, angle: number, depth: number}>}
 */
function notchPoints(piece, allowanceOf) {
  const n = piece.vertices.length;
  const out = [];
  for (const nt of piece.notches || []) {
    if (!Number.isInteger(nt.edge) || nt.edge < 0 || nt.edge >= n) continue;
    const pts = sampleEdge(piece, nt.edge, 200);
    const t = Math.max(0, Math.min(1, nt.t));
    let total = 0;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(total); }
    const target = t * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < target) i++;
    const f = cum[i] > cum[i - 1] ? (target - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0;
    const p = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
    const d = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]];
    const dl = Math.hypot(d[0], d[1]) || 1;
    const dir = [d[0] / dl, d[1] / dl];
    const outward = [dir[1], -dir[0]];                                // outward normal of a CCW outline
    const a = allowanceOf(nt.edge);
    const depth = a > 0 ? Math.min(6, Math.max(3, a / 2)) : 4;
    const angle = Math.atan2(-outward[1], -outward[0]) * 180 / Math.PI;
    for (const s of nt.kind === 'double' ? [-2, 2] : [0]) {
      out.push({ at: /** @type {Vec2} */ ([p[0] + dir[0] * s + outward[0] * a, p[1] + dir[1] * s + outward[1] * a]), angle, depth });
    }
  }
  return out;
}

/**
 * The whole project as DXF-AAMA text.
 * @param {ProjectDoc} doc
 * @param {{sizes?: string[], sampleSize?: string, units?: 'mm'|'in', fold?: 'whole'|'mirror', date?: Date, author?: string}} [opts]
 *   sizes: which sizes to write (default: the active size); several sizes make a graded nest, one block per
 *   piece per size, all at the pieces' own coordinates. fold: 'whole' (default) writes fold pieces whole with the
 *   fold as a centre line on layer 8; 'mirror' writes the stored half with a mirror line on layer 6.
 * @returns {string}
 */
export function exportAama(doc, opts = {}) {
  const sizes = Array.isArray(opts.sizes) && opts.sizes.length ? opts.sizes : [doc.ui.activeSize];
  const sample = opts.sampleSize && sizes.includes(opts.sampleSize) ? opts.sampleSize
    : sizes.includes(doc.sizes.baseSize) ? doc.sizes.baseSize : sizes[0];
  const inch = opts.units === 'in';
  const mirrorFolds = opts.fold === 'mirror';
  const k = inch ? 1 / MM_PER_IN : 1;
  const X = (v) => v * k;
  const fabricName = (id) => { const f = (doc.fabrics || []).find((x) => x.id === id); return f ? f.name : ''; };

  /** @type {Array<{name: string, size: string, piece: Piece, foldX: number|null}>} */
  const items = [];
  const used = new Set();
  for (const size of sizes) {
    for (const graded of gradeDoc(doc, size)) {
      if (graded.exportHidden === true) continue;
      const nv = graded.vertices.length;
      const hasFold = Number.isInteger(graded.foldEdge) && graded.foldEdge >= 0 && graded.foldEdge < nv;
      const piece = hasFold && !mirrorFolds ? mirrorPiece(graded) : graded;
      const sz = nameToken(size);
      const base = nameToken(graded.name).slice(0, Math.max(1, 30 - sz.length)) + '_' + sz;
      let u = base, c = 2;
      while (used.has(u.toUpperCase())) { const suf = '-' + c++; u = base.slice(0, 31 - suf.length) + suf; }
      used.add(u.toUpperCase());
      items.push({ name: u, size, piece, foldX: hasFold ? graded.vertices[/** @type {number} */ (graded.foldEdge)][0] : null });
    }
  }

  const w = createWriter();
  const polyline = (layer, pts, closed) => {
    w.entity('POLYLINE', layer).pair(66, 1).pair(70, closed ? 1 : 0).point(0, 0);
    for (const q of pts) w.pair(0, 'VERTEX').pair(8, layer).point(X(q[0]), X(q[1]));
    w.pair(0, 'SEQEND').pair(8, layer);
  };
  const marks = (pts, turn) => pts.forEach((q, j) => w.entity('POINT', turn[j] ? LAYER.turn : LAYER.curve).point(X(q[0]), X(q[1])));
  const line = (layer, a, b) => w.entity('LINE', layer).point(X(a[0]), X(a[1])).point(X(b[0]), X(b[1]), 11);

  // ---- HEADER: R12 and nothing else (Gerber's own files have an empty header; readers need no more)
  w.pair(0, 'SECTION').pair(2, 'HEADER').pair(9, '$ACADVER').pair(1, 'AC1009').pair(0, 'ENDSEC');

  // ---- BLOCKS: one per piece per size
  w.pair(0, 'SECTION').pair(2, 'BLOCKS');
  const textH = X(4);
  for (const it of items) {
    const p = it.piece;
    const allowanceOf = (e) => {
      if (p.foldEdge === e) return 0;
      const a = p.edges[e] && Number.isFinite(p.edges[e].allowance_mm) ? p.edges[e].allowance_mm : p.seamAllowance_mm;
      return Number.isFinite(a) && a > 0 ? a : 0;
    };
    const { points: sew, turn: sewTurn, edgeStart } = stitchRing(p);
    const hasAllowance = p.edges.some((_, e) => allowanceOf(e) > 0);
    const cut = hasAllowance ? cutLine(p, sew, edgeStart, allowanceOf) : sew.map((q) => /** @type {Vec2} */ ([q[0], q[1]]));
    const cutTurn = hasAllowance ? cutTurns(cut, p, sew, edgeStart, allowanceOf) : sewTurn.slice();
    // every notch on a vertex of the cut line: insert one where it falls between two
    const notches = notchPoints(p, allowanceOf).map((nt) => {
      const r = distToPolyline(nt.at, cut, true);
      const a = cut[r.seg], b = cut[(r.seg + 1) % cut.length];
      let idx;
      if (Math.hypot(r.point[0] - a[0], r.point[1] - a[1]) < 0.01) idx = r.seg;
      else if (Math.hypot(r.point[0] - b[0], r.point[1] - b[1]) < 0.01) idx = (r.seg + 1) % cut.length;
      else { idx = r.seg + 1; cut.splice(idx, 0, [r.point[0], r.point[1]]); cutTurn.splice(idx, 0, false); }
      return { ...nt, base: cut[idx] };
    });

    w.pair(0, 'BLOCK').pair(8, '0').pair(2, it.name).pair(70, 0).point(0, 0).pair(3, it.name);
    // piece text, on the cut-line layer where the standard puts it
    const bb = bbox(cut);
    const lines = [`${TEXT_KEY.name}: ${ascii(p.name) || it.name}`, `${TEXT_KEY.size}: ${ascii(it.size)}`, `${TEXT_KEY.quantity}: ${p.cutQty || 1}`];
    const material = ascii(fabricName(p.fabricId));
    if (material) lines.push(`${TEXT_KEY.material}: ${material}`);
    lines.forEach((t, i) => {
      w.entity('TEXT', LAYER.cut).point(X(bb.minX + 10), X((bb.minY + bb.maxY) / 2) - i * textH * 1.6).pair(40, fnum(textH)).pair(1, t);
    });
    // cut line and its turn / curve points
    polyline(LAYER.cut, cut, true);
    marks(cut, cutTurn);
    // sew line and its points, when it differs from the cut line
    if (hasAllowance) { polyline(LAYER.sew, sew, true); marks(sew, sewTurn); }
    // notches: POINT with depth (30), width (39, 0 = a slit) and the angle into the piece (50)
    for (const nt of notches) {
      w.entity('POINT', LAYER.notch).pair(10, fnum(X(nt.base[0]))).pair(20, fnum(X(nt.base[1]))).pair(30, fnum(X(nt.depth)))
        .pair(39, '0').pair(50, fnum(nt.angle, 2));
    }
    // grain line, and the same line as the grade reference (the axis graded growth is measured along)
    if (p.grainline && p.grainline.a && p.grainline.b) {
      line(LAYER.grain, p.grainline.a, p.grainline.b);
      line(LAYER.gradeRef, p.grainline.a, p.grainline.b);
    }
    // the fold
    if (it.foldX !== null) {
      const fx = it.foldX;
      if (mirrorFolds) {
        // the mirror line lies on the cut line's run along the fold, vertex to vertex
        const ys = cut.filter((q) => Math.abs(q[0] - fx) < 0.01).map((q) => q[1]);
        if (ys.length >= 2) line(LAYER.mirror, [fx, Math.min(...ys)], [fx, Math.max(...ys)]);
      } else {
        // the whole piece is written; the fold becomes its centre line, from cut line to cut line
        const ys = [];
        for (let j = 0; j < cut.length; j++) {
          const a = cut[j], b = cut[(j + 1) % cut.length];
          if (a[0] === fx) ys.push(a[1]);
          else if ((a[0] - fx) * (b[0] - fx) < 0) ys.push(a[1] + (fx - a[0]) / (b[0] - a[0]) * (b[1] - a[1]));
        }
        if (ys.length >= 2) {
          const ends = [[fx, Math.min(...ys)], [fx, Math.max(...ys)]];
          polyline(LAYER.internal, ends, false);
          marks(ends, [true, true]);
        }
      }
    }
    // internal lines: straight segments, so every vertex is a turn point
    for (const il of p.internalLines || []) {
      if (!Array.isArray(il.points) || il.points.length < 2) continue;
      polyline(LAYER.internal, il.points, false);
      marks(il.points, il.points.map(() => true));
    }
    w.pair(0, 'ENDBLK').pair(8, '0');
  }
  w.pair(0, 'ENDSEC');

  // ---- ENTITIES: every block at its own coordinates, and the style text
  w.pair(0, 'SECTION').pair(2, 'ENTITIES');
  for (const it of items) w.entity('INSERT', LAYER.cut).pair(2, it.name).point(0, 0);
  const now = opts.date instanceof Date ? opts.date : new Date();
  const two = (v) => String(v).padStart(2, '0');
  const info = [
    `${TEXT_KEY.style}: ${ascii(doc.name) || 'Untitled'}`,
    `${TEXT_KEY.date}: ${two(now.getDate())}-${two(now.getMonth() + 1)}-${now.getFullYear()}`,
    `${TEXT_KEY.time}: ${two(now.getHours())}:${two(now.getMinutes())}`,
    `${TEXT_KEY.author}: ${ascii(opts.author || DEFAULT_AUTHOR)}`,
    `${TEXT_KEY.sample}: ${ascii(sample)}`,
    `${TEXT_KEY.ruleTable}:`,
    `${TEXT_KEY.units}: ${inch ? 'ENGLISH' : 'METRIC'}`,
  ];
  info.forEach((t, i) => w.entity('TEXT', LAYER.cut).point(0, -X(20) - i * textH * 1.6).pair(40, fnum(textH)).pair(1, t));
  w.pair(0, 'ENDSEC');
  w.pair(0, 'EOF');
  return w.text();
}

// ------------------------------------------------------------------------------------------ import

/**
 * @typedef {Object} ImportReport
 * @property {'mm'|'in'|'cm'} units
 * @property {string} unitsFrom          how the units were decided
 * @property {string[]} sizes            every size found
 * @property {string|null} size          the size imported
 * @property {string} [style]
 * @property {string} [author]
 * @property {Array<{name: string, vertices: number, notches: number, fold: boolean, allowance_mm: number, from: string}>} pieces
 * @property {string[]} warnings
 * @property {Record<string, number>} skipped
 */

/** "Key: value" pairs from TEXT entities, keys lower-cased without spaces. @param {any[]} ents */
function textFields(ents) {
  /** @type {Record<string, string>} */
  const f = {};
  for (const e of ents) {
    if (e.type !== 'TEXT' || typeof e.text !== 'string') continue;
    for (const line of e.text.split(/\n/)) {
      const m = /^\s*([A-Za-z][A-Za-z ._-]*?)\s*[:=]\s*(.*?)\s*$/.exec(line);
      if (m) { const key = m[1].toLowerCase().replace(/[\s._-]+/g, ''); if (!(key in f)) f[key] = m[2]; }
      if (e.tag && !(e.tag.toLowerCase() in f)) f[e.tag.toLowerCase().replace(/[\s._-]+/g, '')] = e.text;
    }
  }
  // the standard keys a graded size "Size Name:"; files say "Size:"
  if (!f.size && f.sizename) f.size = f.sizename;
  return f;
}

/**
 * Join open polylines and lines that meet end to start into rings. Gerber writes a boundary as several open
 * polylines split at turn points; drawings made in general CAD arrive as loose LINEs.
 * @param {Vec2[][]} parts @returns {Vec2[][]}
 */
function chainRings(parts) {
  const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= CHAIN_TOL;
  const left = parts.map((p) => p.slice());
  const rings = [];
  while (left.length) {
    let cur = /** @type {Vec2[]} */ (left.shift());
    for (let grew = true; grew && !(cur.length > 2 && close(cur[0], cur[cur.length - 1]));) {
      grew = false;
      const head = cur[0], tail = cur[cur.length - 1];
      for (let i = 0; i < left.length; i++) {
        const q = left[i], qf = q[0], ql = q[q.length - 1];
        if (close(qf, tail)) cur = cur.concat(q.slice(1));
        else if (close(ql, tail)) cur = cur.concat(q.slice(0, -1).reverse());
        else if (close(ql, head)) cur = q.slice(0, -1).concat(cur);
        else if (close(qf, head)) cur = q.slice(1).reverse().concat(cur);
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (cur.length < 3) continue;
    const f = cur[0], l = cur[cur.length - 1];
    if (close(f, l)) { rings.push(cur.slice(0, -1)); continue; }
    // an open outline that ends near its start is still an outline; anything else is not
    const span = Math.max(...cur.map((q) => Math.hypot(q[0] - f[0], q[1] - f[1])));
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) <= 0.02 * span) rings.push(cur);
  }
  return rings;
}

/** Closed rings on a layer, as point lists (bulges expanded, pieces chained). */
function ringsOn(ents, layers) {
  const out = [];
  /** @type {Vec2[][]} */
  const open = [];
  for (const e of ents) {
    if (!layers.includes(layerNo(e.layer))) continue;
    if (e.type === 'LINE' && e.a && e.b) { open.push([[e.a[0], e.a[1]], [e.b[0], e.b[1]]]); continue; }
    if (e.type !== 'POLYLINE' || !e.points || e.points.length < 2) continue;
    let pts = unbulge(e.points, !!e.closed);
    const f = pts[0], l = pts[pts.length - 1];
    const closedByPoint = pts.length > 3 && Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6;
    if (e.closed || closedByPoint) {
      if (closedByPoint) pts = pts.slice(0, -1);
      if (pts.length >= 3) out.push(pts);
    } else open.push(pts);
  }
  return out.concat(chainRings(open));
}

/** Remove consecutive duplicates and collinear-with-zero-length points. */
function cleanRing(pts, eps) {
  const out = [];
  for (const q of pts) {
    const l = out[out.length - 1];
    if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > eps) out.push([q[0], q[1]]);
  }
  while (out.length > 2) {
    const f = out[0], l = out[out.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) <= eps) out.pop(); else break;
  }
  return out;
}

/** Nearest point on a closed polyline: distance, segment index and parameter. */
function nearestOnRing(ring, p) {
  const r = distToPolyline(p, ring, true);
  return { d: r.dist, seg: r.seg, t: r.t, q: r.point };
}

/**
 * Where a point projects onto the piece's outline: edge index and arc fraction along it.
 * @param {{vertices: Vec2[], edges: any[]}} piece @param {Vec2} p
 */
function edgeParamOf(piece, p) {
  const n = piece.vertices.length;
  let best = { d: Infinity, edge: 0, t: 0 };
  for (let e = 0; e < n; e++) {
    const pts = sampleEdge(/** @type {any} */ (piece), e, 64);
    let total = 0;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(total); }
    for (let i = 1; i < pts.length; i++) {
      const r = distToSegment(p, pts[i - 1], pts[i]);
      if (r.dist < best.d) best = { d: r.dist, edge: e, t: total > 0 ? (cum[i - 1] + r.t * (cum[i] - cum[i - 1])) / total : 0 };
    }
  }
  return best;
}

/**
 * Decide the file's units. The "Units:" text is the only declaration the standard has; $INSUNITS appears only
 * in files from general CAD. Some writers put centimetres under "METRIC", caught by the size of the pieces.
 * @param {any} dxf @param {Record<string, string>} fields file-level text fields
 * @param {Vec2[][]} rings every piece boundary, raw units
 * @returns {{units: 'mm'|'in'|'cm', from: string}}
 */
function detectUnits(dxf, fields, rings) {
  const spans = rings.map((r) => { const b = bbox(r); return Math.max(b.maxX - b.minX, b.maxY - b.minY); }).sort((a, b) => a - b);
  const median = spans.length ? spans[Math.floor(spans.length / 2)] : 0;
  const biggest = spans.length ? spans[spans.length - 1] : 0;
  const t = (fields.units || '').toLowerCase();
  if (/english|inch|imperial/.test(t)) return { units: 'in', from: 'the file says ' + fields.units };
  if (/cm|centi/.test(t)) return { units: 'cm', from: 'the file says ' + fields.units };
  if (/metric|mm|milli/.test(t)) {
    if (median > 0 && median < 50 && biggest < 200) {
      return { units: 'cm', from: `the file says ${fields.units}, but its pieces measure ${median.toFixed(1)} units across: read as centimetres` };
    }
    return { units: 'mm', from: 'the file says ' + fields.units };
  }
  const iu = dxf.header.$INSUNITS;
  if (iu === 1) return { units: 'in', from: '$INSUNITS = 1 (inches)' };
  if (iu === 4) return { units: 'mm', from: '$INSUNITS = 4 (millimetres)' };
  if (iu === 5) return { units: 'cm', from: '$INSUNITS = 5 (centimetres)' };
  // Size of the pieces: a garment piece is roughly 100-1000 mm, i.e. 4-40 inches.
  if (median > 0 && median < 80) return { units: 'in', from: 'guessed from the piece sizes (median ' + median.toFixed(1) + ' units)' };
  if (dxf.header.$MEASUREMENT === 0) return { units: 'in', from: '$MEASUREMENT = 0 (imperial)' };
  return { units: 'mm', from: median > 0 ? 'guessed from the piece sizes (median ' + median.toFixed(0) + ' units)' : 'default' };
}

/** Group a document's entities into piece candidates: one per INSERTed block with a boundary, else per boundary. */
function pieceGroups(dxf) {
  const groups = [];
  const inserted = new Set();
  for (const e of dxf.entities) {
    if (e.type !== 'INSERT') continue;
    const blk = dxf.blocks.get(e.name);
    if (!blk) continue;
    inserted.add(e.name);
    const ents = placeBlock(blk, e);
    if (ringsOn(ents, [LAYER.cut, LAYER.sew]).length) groups.push({ name: e.name, ents });
  }
  // blocks never inserted but holding a boundary (some writers skip the INSERT)
  for (const [name, blk] of dxf.blocks) {
    if (inserted.has(name)) continue;
    if (ringsOn(blk.entities, [LAYER.cut, LAYER.sew]).length) groups.push({ name, ents: blk.entities.map((x) => ({ ...x })) });
  }
  if (groups.length) return groups;
  // flat file: each boundary in model space is a piece; everything else goes to the boundary that contains it
  const boundaries = ringsOn(dxf.entities, [LAYER.cut]);
  for (const b of boundaries) groups.push({ name: '', ents: [], ring: b });
  for (const e of dxf.entities) {
    const at = e.p || e.a || (e.points && e.points[0]);
    if (!at) continue;
    const g = groups.find((gr) => pointInPolygon([at[0], at[1]], gr.ring) || (e.type === 'POLYLINE' && e.points.length === gr.ring.length));
    if (g) g.ents.push(e);
  }
  return groups;
}

/**
 * Corner flags from the file's turn and curve points, when they mark (nearly) every vertex of the ring; null when
 * they belong to another line (a file that marks only the cut line, while the ring is the sew line).
 * @param {Vec2[]} ring @param {Vec2[]} turns @param {Vec2[]} curves @returns {boolean[]|null}
 */
function marksOn(ring, turns, curves) {
  if (!turns.length && !curves.length) return null;
  const near = (list, q) => list.some((t) => Math.abs(t[0] - q[0]) < 0.05 && Math.abs(t[1] - q[1]) < 0.05);
  const flags = ring.map((q) => (near(turns, q) ? true : near(curves, q) ? false : null));
  if (flags.filter((v) => v !== null).length < 0.8 * ring.length) return null;
  const guess = guessTurns(ring);
  return flags.map((v, i) => (v === null ? guess[i] : v));
}

/** Signed distance from the line through a and b (positive on its left) and the parameter along it. */
function sideOf(q, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  return { d: ((q[0] - a[0]) * -dy + (q[1] - a[1]) * dx) / L, t: ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (L * L) };
}

/** Is the ring its own mirror image across the line a-b (within tol), with outline on both sides? */
function symmetricAbout(ring, a, b, tol) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  if (L2 < 1e-9) return false;
  let pos = false, neg = false;
  for (const q of ring) {
    const t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2;
    const foot = [a[0] + dx * t, a[1] + dy * t];
    const m = /** @type {Vec2} */ ([2 * foot[0] - q[0], 2 * foot[1] - q[1]]);
    if (distToPolyline(m, ring, true).dist > tol) return false;
    const s = sideOf(q, a, b).d;
    if (s > tol) pos = true; else if (s < -tol) neg = true;
  }
  return pos && neg;
}

/**
 * One half of a ring cut along the line a-b: the run between the two vertices on the line, on the side with the
 * larger x (the side the app stores), closed by the fold. null when the line does not meet the ring at exactly two
 * vertices.
 * @param {Vec2[]} ring @param {boolean[]} isTurn @param {Vec2} a @param {Vec2} b
 */
function halfRing(ring, isTurn, a, b) {
  const n = ring.length;
  const on = [];
  for (let i = 0; i < n; i++) if (Math.abs(sideOf(ring[i], a, b).d) < 0.05) on.push(i);
  if (on.length !== 2) return null;
  const run = (from, to) => { const idx = []; for (let i = from; ; i = (i + 1) % n) { idx.push(i); if (i === to) break; } return idx; };
  const r1 = run(on[0], on[1]), r2 = run(on[1], on[0]);
  const meanX = (idx) => idx.reduce((s, i) => s + ring[i][0], 0) / idx.length;
  const meanY = (idx) => idx.reduce((s, i) => s + ring[i][1], 0) / idx.length;
  const x1 = meanX(r1), x2 = meanX(r2);
  const keep = Math.abs(x1 - x2) > 1e-6 ? (x1 > x2 ? r1 : r2) : (meanY(r1) > meanY(r2) ? r1 : r2);
  const side = Math.sign(sideOf(ring[keep[Math.floor(keep.length / 2)]], a, b).d) || 1;
  return { ring: keep.map((i) => ring[i]), isTurn: keep.map((i) => isTurn[i]), side };
}

/** Turn and curve points of a group, in mm. */
function markPoints(g, S) {
  const pts = (layer) => g.ents.filter((e) => e.type === 'POINT' && layerNo(e.layer) === layer).map((e) => S(e.p));
  return { turns: pts(LAYER.turn), curves: pts(LAYER.curve) };
}

/** Notch entities of a group: POINTs, or LINEs as some writers draw them. */
function notchEntities(g) {
  return g.ents.filter((e) => [LAYER.notch, ...NOTCH_SHAPE_LAYERS].includes(layerNo(e.layer)) && (e.type === 'LINE' || e.type === 'POINT'));
}

/** The boundary rings of a group, in mm: the cut line and the sew line (either may be missing). */
function groupRings(g, S) {
  const largest = (rs) => rs.sort((p, q) => Math.abs(signedArea(q)) - Math.abs(signedArea(p)))[0];
  const cutRing = largest(g.ring ? [g.ring] : ringsOn(g.ents, [LAYER.cut]));
  const sewRing = largest(ringsOn(g.ents, [LAYER.sew]));
  return {
    cut: cutRing ? cleanRing(cutRing.map(S), 0.01) : null,
    sew: sewRing ? cleanRing(sewRing.map(S), 0.01) : null,
  };
}

/**
 * Read DXF-AAMA text into piece drafts (NOT normalised: the caller normalises them into its document).
 * @param {string} text
 * @param {{units?: 'auto'|'mm'|'in'|'cm', size?: string}} [opts]
 * @returns {{pieces: any[], report: ImportReport}}
 */
export function importAama(text, opts = {}) {
  const dxf = parseDxf(text);
  /** @type {string[]} */
  const warnings = [];
  const groups = pieceGroups(dxf);
  const fileFields = textFields(dxf.entities.filter((e) => e.type === 'TEXT'));
  // files this app wrote carry fold pieces whole, with the fold as a centre line: those are folded back
  const ours = /clothing cad/i.test(fileFields.author || '');

  // units
  const rawRings = groups.map((g) => (g.ring || ringsOn(g.ents, [LAYER.cut])[0] || ringsOn(g.ents, [LAYER.sew])[0])).filter(Boolean);
  const units = opts.units === 'mm' || opts.units === 'in' || opts.units === 'cm' ? { units: opts.units, from: 'chosen on import' } : detectUnits(dxf, fileFields, rawRings);
  const k = units.units === 'in' ? MM_PER_IN : units.units === 'cm' ? 10 : 1;
  const S = (q) => /** @type {Vec2} */ ([q[0] * k, q[1] * k]);
  if (units.units === 'cm' && /but/.test(units.from)) warnings.push(`The file says ${fileFields.units} but its pieces are 10 times too small for millimetres, so it was read as centimetres.`);

  // sizes: one piece per name per size; import one size
  const described = groups.map((g) => ({ g, f: textFields(g.ents) }));
  const sizes = [...new Set(described.map((d) => d.f.size).filter(Boolean))];
  const sampleSize = fileFields.samplesize || described.map((d) => d.f.samplesize).find(Boolean) || null;
  let size = null;
  if (sizes.length > 1) {
    const want = opts.size || sampleSize;
    size = want && sizes.includes(want) ? want : sizes[Math.floor((sizes.length - 1) / 2)];
    warnings.push(`The file holds ${sizes.length} sizes (${sizes.join(', ')}); size ${size} was imported${want ? '' : ' (no sample size was marked, so the middle one)'}.`);
  } else if (sizes.length === 1) size = sizes[0];
  const pieceNameOf = (f, g, index) => {
    let nm = f.piecename || f.name || f.piece || (g.name ? g.name.replace(/_[^_]*$/, '') : '') || 'Piece ' + index;
    if (/^pattern2d_/i.test(nm) && f.annotation) nm = f.annotation;           // CLO names unnamed pieces by an id
    return nm;
  };

  const pieces = [];
  /** @type {ImportReport['pieces']} */
  const rpieces = [];
  let index = 0;
  for (const { g, f } of described) {
    index++;
    if (size && f.size && f.size !== size) continue;
    const name = pieceNameOf(f, g, index);
    const rings = groupRings(g, S);
    const base = rings.sew || rings.cut;
    if (!base || base.length < 3) { warnings.push(`${name}: no boundary, skipped.`); continue; }
    let ring = base;
    const cut = rings.cut;
    let from = rings.sew ? 'sew line' : 'cut line';

    let { turns, curves } = markPoints(g, S);
    let notchEnts = notchEntities(g).map((e) => (e.type === 'LINE' ? { cands: [S(e.a), S(e.b)] } : { cands: [S(e.p)] }));

    // A graded nest carries turn / curve points and notches in the sample size only. When this size's outline has
    // the sample's points one for one (as the standard asks), carry them over by position in the outline.
    if (!turns.length && !curves.length && !notchEnts.length && sampleSize && f.size && f.size !== sampleSize) {
      const sd = described.find((d) => d.f.size === sampleSize && pieceNameOf(d.f, d.g, 0) === name);
      if (sd) {
        const sr = groupRings(sd.g, S);
        const sBase = rings.sew ? sr.sew : sr.cut;
        const sm = markPoints(sd.g, S);
        const flags = sBase && sBase.length === ring.length ? marksOn(sBase, sm.turns, sm.curves) : null;
        if (flags) { turns = ring.filter((_, i) => flags[i]); curves = ring.filter((_, i) => !flags[i]); }
        const moved = [];
        for (const e of notchEntities(sd.g)) {
          const c = e.type === 'LINE' ? [S(e.a), S(e.b)] : [S(e.p)];
          for (const [sRing, ownRing] of [[sr.cut, cut], [sr.sew, rings.sew]]) {
            if (!sRing || !ownRing || sRing.length !== ownRing.length) continue;
            const j = sRing.findIndex((q) => c.some((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05));
            if (j >= 0) { moved.push({ cands: [ownRing[j]] }); break; }
          }
        }
        notchEnts = moved;
        if (flags || moved.length) from += ', corners and notches from the sample size';
        else warnings.push(`${name} (size ${f.size}): the file marks corners and notches in the sample size only, and this size's outline does not match it point for point, so corners were guessed and notches left out.`);
      }
    }

    // corners: the file's turn points when they mark this ring, else guessed from the angles
    let isTurn = marksOn(ring, turns, curves) || guessTurns(ring);

    // the fold: a mirror line on layer 6, or (a file from this app) a centre line the outline is symmetric about
    /** @type {[Vec2, Vec2]|null} */
    let axis = null;
    let keepSide = 0;
    const mirror = g.ents.find((e) => e.type === 'LINE' && layerNo(e.layer) === LAYER.mirror);
    if (mirror) axis = [S(mirror.a), S(mirror.b)];
    const centreLines = [];
    if (!axis && ours) {
      for (const e of g.ents) {
        if (layerNo(e.layer) !== LAYER.internal) continue;
        const pts = e.type === 'LINE' ? [e.a, e.b] : e.type === 'POLYLINE' && e.points.length === 2 && !e.closed ? e.points : null;
        if (!pts) continue;
        const a = S(pts[0]), b = S(pts[1]);
        if (!symmetricAbout(ring, a, b, 0.2)) continue;
        const half = halfRing(ring, isTurn, a, b);
        if (!half) continue;
        axis = [a, b]; ring = half.ring; isTurn = half.isTurn; keepSide = half.side;
        centreLines.push(e);
        break;
      }
    }
    if (axis) {
      // where the outline leaves the fold line: the fold edge's ends, corners
      const [a, b] = axis;
      const onAxis = ring.map((q) => Math.abs(sideOf(q, a, b).d) < 0.5);
      for (let i = 0; i < ring.length; i++) {
        if (onAxis[i] && (!onAxis[(i - 1 + ring.length) % ring.length] || !onAxis[(i + 1) % ring.length])) isTurn[i] = true;
      }
    }
    // mirrored copies of notches and marks on the half that was dropped do not belong to the piece
    const kept = (q) => !keepSide || !axis || sideOf(q, axis[0], axis[1]).d * keepSide > -0.5;

    // orientation: the app's outlines are counter-clockwise
    if (signedArea(ring) < 0) { ring = ring.slice().reverse(); isTurn = isTurn.slice().reverse(); }
    const { vertices, edges } = ringToEdges(ring, isTurn, FIT_TOL_MM);

    const qty = String(f.quantity || '1').split(/[,;]/).map((s) => parseInt(s, 10)).filter((v) => Number.isFinite(v) && v >= 0);
    /** @type {any} */
    const piece = { name, vertices, edges, notches: [], internalLines: [], cutQty: Math.max(1, qty.reduce((s, v) => s + v, 0) || 1) };

    // fold edge: a straight edge lying on the fold line
    let fold = false;
    if (axis) {
      const [a, b] = axis;
      const onLine = (p) => { const s = sideOf(p, a, b); const slack = 1 / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1); return Math.abs(s.d) < 0.5 && s.t > -slack && s.t < 1 + slack; };
      for (let e = 0; e < vertices.length; e++) {
        if (edges[e].type === 'line' && onLine(vertices[e]) && onLine(vertices[(e + 1) % vertices.length])) { piece.foldEdge = e; fold = true; break; }
      }
      if (!fold) {
        piece.internalLines.push({ kind: 'fold', points: [axis[0], axis[1]] });
        warnings.push(`${name}: its mirror line is not on the outline, so the piece was imported whole with the line marked as a fold.`);
      }
    }

    // The app keeps a fold piece's fold edge vertical on x = 0 with the piece on the +x side. The outline is
    // counter-clockwise, so turning the fold edge to point straight down puts the inside on +x by itself.
    let Tq = (q) => q;
    let cutT = cut;
    if (fold) {
      const fe = piece.foldEdge, nv = vertices.length;
      const a = vertices[fe], b = vertices[(fe + 1) % nv];
      const ang = Math.atan2(-1, 0) - Math.atan2(b[1] - a[1], b[0] - a[0]);
      const c = Math.cos(ang), sn = Math.sin(ang);
      const ax = a[0], ay = a[1];
      const R = (q) => { const x = q[0] - ax, y = q[1] - ay; return /** @type {Vec2} */ ([x * c - y * sn, x * sn + y * c + ay]); };
      if (Math.abs(ang) > 1e-12 || ax !== 0) {
        for (let i = 0; i < nv; i++) vertices[i] = R(vertices[i]);
        for (const ed of edges) if (ed.type === 'cubic') { ed.c1 = R(ed.c1); ed.c2 = R(ed.c2); }
        vertices[fe][0] = 0; vertices[(fe + 1) % nv][0] = 0;
        ring = ring.map(R);
        if (cut) cutT = cut.map(R);
        Tq = R;
      }
    }

    // seam allowance: per edge, the distance from the sew line to the cut line
    let allowance = 0;
    if (rings.sew && cutT) {
      /** @type {number[]} */
      const per = [];
      for (let e = 0; e < vertices.length; e++) {
        if (piece.foldEdge === e) { per.push(0); continue; }
        const s = sampleEdge(/** @type {any} */ ({ vertices, edges }), e, 8).slice(1, -1);
        const ds = s.map((q) => distToPolyline(q, cutT, true).dist).sort((p, q) => p - q);
        per.push(ds.length ? ds[Math.floor(ds.length / 2)] : 0);
      }
      const sorted = per.filter((v) => v > 0.05).sort((p, q) => p - q);
      allowance = sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] * 2) / 2 : 0;
      edges.forEach((ed, e) => {
        if (piece.foldEdge === e) return;
        const a = Math.round(per[e] * 2) / 2;
        if (Math.abs(a - allowance) >= 1) ed.allowance_mm = a;
      });
    } else if (!rings.sew) {
      warnings.push(`${name}: no sew line (layer 14), so the cut line was imported as the stitching line with no seam allowance.`);
    }
    piece.seamAllowance_mm = allowance;

    // notches: the candidate point nearest the cut or sew line is the notch; two close together are a double notch
    const raw = [];
    for (const ne of notchEnts) {
      let best = null;
      for (const c0 of ne.cands) {
        if (!kept(c0)) continue;
        const c = Tq(c0);
        const d = Math.min(nearestOnRing(ring, c).d, cutT ? nearestOnRing(cutT, c).d : Infinity);
        if (!best || d < best.d) best = { d, c };
      }
      if (!best || best.d > NOTCH_MAX_MM) continue;
      raw.push(edgeParamOf({ vertices, edges }, best.c));
    }
    raw.sort((p, q) => p.edge - q.edge || p.t - q.t);
    for (let i = 0; i < raw.length; i++) {
      const a = raw[i], b = raw[i + 1];
      const L = edgeLength(/** @type {any} */ ({ vertices, edges }), a.edge);
      if (b && b.edge === a.edge && Math.abs(b.t - a.t) * L < DOUBLE_NOTCH_MM) {
        piece.notches.push({ edge: a.edge, t: (a.t + b.t) / 2, kind: 'double' });
        i++;
      } else {
        piece.notches.push({ edge: a.edge, t: a.t, kind: 'single' });
      }
    }

    // grain line: the longest line on layer 7
    const grains = g.ents.filter((e) => e.type === 'LINE' && layerNo(e.layer) === LAYER.grain)
      .map((e) => [Tq(S(e.a)), Tq(S(e.b))]).sort((p, q) => Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) - Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]));
    if (grains.length) piece.grainline = { a: grains[0][0], b: grains[0][1] };

    // internal lines, cutouts, drill holes (the dropped half's mirrored copies and the centre line excepted)
    for (const e of g.ents) {
      if (centreLines.includes(e)) continue;
      const L = layerNo(e.layer);
      if (L === LAYER.internal || L === LAYER.cutout) {
        const pts = e.type === 'LINE' ? [S(e.a), S(e.b)] : e.type === 'POLYLINE' && e.points.length >= 2 ? unbulge(e.points, !!e.closed).map(S) : null;
        if (!pts || !pts.some(kept)) continue;
        piece.internalLines.push({ kind: 'mark', points: pts.map(Tq) });
      } else if (L === LAYER.drill && (e.type === 'POINT' || e.type === 'CIRCLE')) {
        if (!kept(S(e.p))) continue;
        const c = Tq(S(e.p)), r = 3;
        piece.internalLines.push({ kind: 'mark', points: [[c[0] - r, c[1] - r], [c[0] + r, c[1] + r]] });
        piece.internalLines.push({ kind: 'mark', points: [[c[0] - r, c[1] + r], [c[0] + r, c[1] - r]] });
      }
    }

    pieces.push(piece);
    rpieces.push({ name, vertices: vertices.length, notches: piece.notches.length, fold, allowance_mm: allowance, from });
  }

  if (!groups.length) warnings.push('No pattern pieces found: the file has no closed boundary on layer 1 or 14. Is it a DXF-AAMA / ASTM file?');
  const skippedTypes = Object.keys(dxf.skipped);
  if (skippedTypes.length) warnings.push('Ignored entities: ' + skippedTypes.map((t) => `${dxf.skipped[t]} ${t}`).join(', ') + '.');

  return {
    pieces,
    report: { units: units.units, unitsFrom: units.from, sizes, size, style: fileFields.stylename, author: fileFields.author, pieces: rpieces, warnings, skipped: dxf.skipped },
  };
}
