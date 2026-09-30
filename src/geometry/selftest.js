// src/geometry/selftest.js — the 15 cases of SPEC 5.9 plus two regression cases (remesh.allSamples, remesh.sleeve), the
// four darts cases of SPEC 5.10 and the three darted-mesh cases (remesh.dartNarrow, remesh.dartSeam, remesh.twoMouths),
// and remesh.dress (the fitted dress sample).
// Pure and DOM-free; this is the only file of src/geometry/ allowed to import ../samples/index.js (as a fixture source).
import {
  segmentLength, sampleSegment, splitEdge,
  signedArea, isSimplePolygon, pointInPolygon, bbox,
  fullOutline,
  mulberry32,
  delaunay, recoverEdges, buildAdjacency, edgeKey,
  remeshPiece, seamSampleFractions,
  offsetPolygon, offsetOutline,
  packRects,
  dartMouth, checkDarts, validDartIndices, sewnLength, edgeToSewn, sewnToEdge, mouthFractions, applyDarts, mirrorPiece, edgeLength,
} from './index.js';
import { getSample } from '../samples/index.js';

/** @typedef {import('../core/types.js').SelfTestResult} SelfTestResult */
/** @typedef {import('../core/types.js').Vec2} Vec2 */
/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').PieceMesh} PieceMesh */

/** @param {number} v @param {number} [d=3] @returns {string} */
function f(v, d = 3) {
  return Number.isFinite(v) ? v.toFixed(d) : String(v);
}

/**
 * Minimal Piece with only the fields the geometry module reads.
 * @param {Partial<Piece> & {id: string, vertices: Vec2[]}} partial @returns {Piece}
 */
function makePiece(partial) {
  return /** @type {Piece} */ ({
    name: partial.id,
    edges: partial.vertices.map(() => ({ type: 'line' })),
    foldEdge: null,
    notches: [],
    seamAllowance_mm: 10,
    meshSpacing_mm: 15,
    ...partial,
  });
}

/** 100 x 100 mm CCW square with the given extras. @param {Partial<Piece>} [extra] @returns {Piece} */
function squarePiece(extra) {
  return makePiece({
    id: 'sq',
    vertices: [[0, 0], [100, 0], [100, 100], [0, 100]],
    ...extra,
  });
}

/** @param {PieceMesh} mesh @returns {{V:number, E:number, T:number, euler:number}} */
function eulerOf(mesh) {
  const V = mesh.vertexCount;
  const E = mesh.edges.length / 2;
  const T = mesh.triangles.length / 3;
  return { V, E, T, euler: V - E + T };
}

// ---------------------------------------------------------------------------------------------------------------- cases

/** @returns {SelfTestResult} */
function caseBezierLength() {
  const p0 = /** @type {Vec2} */ ([0, 0]);
  const p1 = /** @type {Vec2} */ ([100, 0]);
  const edge = /** @type {import('../core/types.js').Edge} */ ({ type: 'cubic', c1: [0, 100], c2: [100, 100] });
  const L = segmentLength(p0, edge, p1);
  const pts = sampleSegment(p0, edge, p1, 4);
  const exactStart = pts.length === 5 && pts[0][0] === p0[0] && pts[0][1] === p0[1];
  const exactEnd = pts.length === 5 && pts[4][0] === p1[0] && pts[4][1] === p1[1];
  const pass = Math.abs(L - 200) <= 0.5 && pts.length === 5 && exactStart && exactEnd;
  return { name: 'bezier.length', pass, details: 'L = ' + f(L) + ' mm (want 200 +- 0.5); ' + pts.length + ' samples, endpoints exact: ' + exactStart + '/' + exactEnd };
}

/** @returns {SelfTestResult} */
function caseBezierSplit() {
  const piece = squarePiece({ notches: [{ edge: 3, t: 0.25, kind: 'single' }] });
  const { piece: out, edgeMap, newVertex } = splitEdge(piece, 1, 0.5);
  const notch = out.notches[0];
  const pass = out.vertices.length === 5 && out.edges.length === 5 && edgeMap[3] === 4 && notch.edge === 4
    && Math.abs(notch.t - 0.25) < 1e-9 && newVertex === 2
    && Math.abs(out.vertices[2][0] - 100) < 1e-9 && Math.abs(out.vertices[2][1] - 50) < 1e-9;
  return {
    name: 'bezier.split',
    pass,
    details: 'V ' + out.vertices.length + ' (want 5), edgeMap[3] = ' + edgeMap[3] + ' (want 4), notch edge ' + notch.edge
      + ' t ' + f(notch.t) + ', newVertex ' + newVertex + ' at [' + f(out.vertices[2][0], 1) + ',' + f(out.vertices[2][1], 1) + ']',
  };
}

/** @returns {SelfTestResult} */
function casePolygonPredicates() {
  const unit = /** @type {Vec2[]} */ ([[0, 0], [1, 0], [1, 1], [0, 1]]);
  const area = signedArea(unit);
  const bow = /** @type {Vec2[]} */ ([[0, 0], [1, 1], [1, 0], [0, 1]]);
  const simpleUnit = isSimplePolygon(unit);
  const simpleBow = isSimplePolygon(bow);
  const inCentre = pointInPolygon([0.5, 0.5], unit);
  const outside = pointInPolygon([2, 2], unit);
  const onEdge = pointInPolygon([0.5, 0], unit);
  const pass = Math.abs(area - 1) < 1e-12 && simpleUnit && !simpleBow && inCentre && !outside && onEdge;
  return {
    name: 'polygon.predicates',
    pass,
    details: 'signedArea ' + f(area, 6) + ' (want 1); simple(unit) ' + simpleUnit + ', simple(bowtie) ' + simpleBow
      + '; inside centre ' + inCentre + ', outside ' + outside + ', on edge ' + onEdge,
  };
}

/** @returns {SelfTestResult} */
function caseMirrorFullOutline() {
  const piece = makePiece({
    id: 'fold',
    vertices: [[0, 0], [100, 0], [100, 200], [0, 200]],
    foldEdge: 3,
  });
  const full = fullOutline(piece);
  const ccw = signedArea(full.vertices) > 0;
  const pass = full.edges.length === 6 && full.vertices.length === 6 && ccw
    && full.fullEdgeOf[1][3] === -1 && full.fullEdgeOf[0][3] === -1 && full.foldX === 0;
  return {
    name: 'mirror.fullOutline',
    pass,
    details: 'full loop ' + full.vertices.length + ' vertices / ' + full.edges.length + ' edges (want 6), CCW ' + ccw
      + ', fullEdgeOf[1][foldEdge] = ' + full.fullEdgeOf[1][3] + ' (want -1), foldX ' + full.foldX,
  };
}

/** @returns {SelfTestResult} */
function caseDelaunayBasic() {
  const rnd = mulberry32(0x5eed1234);
  const N = 200;
  const pts = new Float64Array(2 * N);
  for (let i = 0; i < N; i++) { pts[2 * i] = rnd() * 500; pts[2 * i + 1] = rnd() * 400; }
  const tris = delaunay(pts);
  const T = tris.length / 3;
  const adj = buildAdjacency(N, tris);
  const E = adj.edges.length / 2;
  const euler = N - E + T;
  let notCcw = 0;
  for (let t = 0; t < T; t++) {
    const a = tris[3 * t];
    const b = tris[3 * t + 1];
    const c = tris[3 * t + 2];
    const o = (pts[2 * b] - pts[2 * a]) * (pts[2 * c + 1] - pts[2 * a + 1]) - (pts[2 * b + 1] - pts[2 * a + 1]) * (pts[2 * c] - pts[2 * a]);
    if (!(o > 0)) notCcw++;
  }
  // empty-circumcircle check on 50 sampled triangles
  let violations = 0;
  const step = Math.max(1, Math.floor(T / 50));
  for (let t = 0; t < T; t += step) {
    const a = tris[3 * t];
    const b = tris[3 * t + 1];
    const c = tris[3 * t + 2];
    const ax = pts[2 * a];
    const ay = pts[2 * a + 1];
    const bx = pts[2 * b] - ax;
    const by = pts[2 * b + 1] - ay;
    const cx = pts[2 * c] - ax;
    const cy = pts[2 * c + 1] - ay;
    const d = 2 * (bx * cy - by * cx);
    if (Math.abs(d) < 1e-12) continue;
    const b2 = bx * bx + by * by;
    const c2 = cx * cx + cy * cy;
    const rx = (cy * b2 - by * c2) / d;
    const ry = (bx * c2 - cx * b2) / d;
    const r2 = rx * rx + ry * ry;
    for (let i = 0; i < N; i++) {
      if (i === a || i === b || i === c) continue;
      const qx = pts[2 * i] - ax - rx;
      const qy = pts[2 * i + 1] - ay - ry;
      if (qx * qx + qy * qy < r2 * (1 - 1e-9)) { violations++; break; }
    }
  }
  const pass = euler === 1 && notCcw === 0 && violations === 0;
  return {
    name: 'delaunay.basic',
    pass,
    details: 'V ' + N + ' E ' + E + ' T ' + T + ' Euler ' + euler + ' (want 1); non-CCW triangles ' + notCcw
      + '; circumcircle violations ' + violations + ' of ' + Math.ceil(T / step) + ' sampled',
  };
}

/** @returns {SelfTestResult} */
function caseDelaunayRecover() {
  const rnd = mulberry32(0xc0ffee);
  const N = 60;
  const pts = new Float64Array(2 * N);
  for (let i = 0; i < N; i++) { pts[2 * i] = rnd() * 200; pts[2 * i + 1] = rnd() * 200; }
  const tris = delaunay(pts);
  const adj = buildAdjacency(N, tris);
  const have = new Set();
  for (let e = 0; e < adj.edges.length / 2; e++) have.add(edgeKey(adj.edges[2 * e], adj.edges[2 * e + 1]));
  /** @param {number} a @param {number} b @param {number} c @param {number} d @returns {boolean} */
  const crosses = (a, b, c, d) => {
    if (a === c || a === d || b === c || b === d) return false;
    /** @param {number} i @param {number} j @param {number} k */
    const o = (i, j, k) => (pts[2 * j] - pts[2 * i]) * (pts[2 * k + 1] - pts[2 * i + 1]) - (pts[2 * j + 1] - pts[2 * i + 1]) * (pts[2 * k] - pts[2 * i]);
    const d1 = o(a, b, c);
    const d2 = o(a, b, d);
    const d3 = o(c, d, a);
    const d4 = o(c, d, b);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  // find a missing pair (a, b) crossing exactly 3 existing triangulation edges
  let found = null;
  let crossCount = 0;
  for (let a = 0; a < N && !found; a++) {
    for (let b = a + 1; b < N; b++) {
      if (have.has(edgeKey(a, b))) continue;
      let cnt = 0;
      for (let e = 0; e < adj.edges.length / 2 && cnt <= 3; e++) {
        if (crosses(a, b, adj.edges[2 * e], adj.edges[2 * e + 1])) cnt++;
      }
      if (cnt === 3) { found = [a, b]; crossCount = cnt; break; }
    }
  }
  if (!found) return { name: 'delaunay.recover', pass: false, details: 'no constraint crossing exactly 3 edges found in the fixture' };
  const out = recoverEdges(pts, tris, Uint32Array.from(found));
  const adj2 = buildAdjacency(N, out);
  const have2 = new Set();
  for (let e = 0; e < adj2.edges.length / 2; e++) have2.add(edgeKey(adj2.edges[2 * e], adj2.edges[2 * e + 1]));
  let maxIndex = 0;
  for (let i = 0; i < out.length; i++) if (out[i] > maxIndex) maxIndex = out[i];
  const recovered = have2.has(edgeKey(found[0], found[1]));
  const sameTriCount = out.length === tris.length;
  const noNewVertex = maxIndex < N;
  const euler = N - adj2.edges.length / 2 + out.length / 3;
  const pass = recovered && sameTriCount && noNewVertex && euler === 1;
  return {
    name: 'delaunay.recover',
    pass,
    details: 'constraint ' + found[0] + '-' + found[1] + ' crossed ' + crossCount + ' edges; recovered ' + recovered
      + ', triangles ' + (out.length / 3) + ' (was ' + (tris.length / 3) + '), max vertex index ' + maxIndex + ' of ' + N + ', Euler ' + euler,
  };
}

/** @returns {SelfTestResult} */
function caseRemeshSquare() {
  const piece = squarePiece({});
  const mesh = remeshPiece(piece, { pieces: [piece], seams: [] }, {});
  const { V, E, T, euler } = eulerOf(mesh);
  const pass = mesh.quality.pctAbove20 >= 98 && V >= 40 && V <= 70 && mesh.boundary.length === 28 && euler === 1;
  return {
    name: 'remesh.square',
    pass,
    details: 'V ' + V + ' (want 40..70), boundary ' + mesh.boundary.length + ' (want 28), E ' + E + ' T ' + T
      + ' Euler ' + euler + ', pctAbove20 ' + f(mesh.quality.pctAbove20, 1),
  };
}

/** @returns {SelfTestResult} */
function caseRemeshSeamParity() {
  const a = makePiece({ id: 'A', vertices: [[0, 0], [200, 0], [200, 300], [0, 300]] });
  const b = makePiece({ id: 'B', vertices: [[0, 0], [200, 0], [200, 315], [0, 315]] });
  const doc = {
    pieces: [a, b],
    seams: [{ id: 's1', kind: 'plain', a: { pieceId: 'A', edge: 1, mirror: false, reverse: false }, b: { pieceId: 'B', edge: 1, mirror: false, reverse: false } }],
  };
  const ma = remeshPiece(a, doc, {});
  const mb = remeshPiece(b, doc, {});
  const na = ma.edgeVerts[0][1].length;
  const nb = mb.edgeVerts[0][1].length;
  const want = Math.max(2, Math.ceil(315 / 15)) + 1;
  const pass = na === want && nb === want;
  return {
    name: 'remesh.seamParity',
    pass,
    details: 'side A ' + na + ' vertices, side B ' + nb + ' vertices (want ' + want + ' on both; edges 300 / 315 mm at h 15)',
  };
}

/** @returns {SelfTestResult} */
function caseRemeshFold() {
  const doc = getSample('tshirt');
  const piece = /** @type {Piece} */ (doc.pieces.find((p) => p.id === 'front'));
  const mesh = remeshPiece(piece, doc, {});
  const foldEdge = /** @type {number} */ (piece.foldEdge);
  const hasMirror = Array.isArray(mesh.edgeVerts[1]) && mesh.edgeVerts[1].length === piece.vertices.length;
  const foldEmpty = hasMirror && mesh.edgeVerts[1][foldEdge].length === 0 && mesh.edgeVerts[0][foldEdge].length === 0;
  const { V, euler } = eulerOf(mesh);
  const pass = hasMirror && foldEmpty && V >= 1100 && V <= 2000 && mesh.quality.pctAbove20 >= 98 && euler === 1;
  return {
    name: 'remesh.fold',
    pass,
    details: 'edgeVerts[1] present ' + hasMirror + ', fold edge ' + foldEdge + ' empty ' + foldEmpty + ', V ' + V
      + ' (want 1100..2000), pctAbove20 ' + f(mesh.quality.pctAbove20, 1) + ', Euler ' + euler,
  };
}

/** @returns {SelfTestResult} */
function caseRemeshNotch() {
  const piece = squarePiece({ notches: [{ edge: 0, t: 0.5, kind: 'single' }] });
  const mesh = remeshPiece(piece, { pieces: [piece], seams: [] }, {});
  const id = mesh.notchVerts[0][0];
  const x = mesh.positions2d[2 * id];
  const y = mesh.positions2d[2 * id + 1];
  const onBoundary = id < mesh.boundary.length;
  const pass = onBoundary && Math.abs(x - 50) < 1e-4 && Math.abs(y) < 1e-4;
  return {
    name: 'remesh.notch',
    pass,
    details: 'notchVerts[0][0] = ' + id + ' at [' + f(x, 4) + ',' + f(y, 4) + '] (want [50,0]), boundary vertex ' + onBoundary,
  };
}

/** @returns {SelfTestResult} */
function caseOffsetSquare() {
  const stitch = /** @type {Vec2[]} */ ([[0, 0], [100, 0], [100, 100], [0, 100]]);
  const cut = offsetPolygon(stitch, [10, 10, 10, 10], {});
  const box = bbox(cut);
  const w = box.maxX - box.minX;
  const hgt = box.maxY - box.minY;
  const area = signedArea(cut);
  const simple = isSimplePolygon(cut);
  const pass = Math.abs(w - 120) <= 0.01 && Math.abs(hgt - 120) <= 0.01 && simple && Math.abs(area - 14400) <= 1;
  return {
    name: 'offset.square',
    pass,
    details: 'cut bbox ' + f(w, 4) + ' x ' + f(hgt, 4) + ' (want 120 x 120 +- 0.01), area ' + f(area, 2)
      + ' (want 14400 +- 1), simple ' + simple,
  };
}

/** @returns {SelfTestResult} */
function caseOffsetDiscontinuity() {
  const stitch = /** @type {Vec2[]} */ ([[0, 0], [100, 0], [100, 100], [0, 100]]);
  const cut = offsetPolygon(stitch, [25, 10, 10, 10], {});
  const box = bbox(cut);
  const w = box.maxX - box.minX;
  const hgt = box.maxY - box.minY;
  const simple = isSimplePolygon(cut);
  const pass = Math.abs(w - 120) <= 0.05 && Math.abs(hgt - 135) <= 0.05 && simple;
  return {
    name: 'offset.discontinuity',
    pass,
    details: 'cut bbox ' + f(w, 4) + ' x ' + f(hgt, 4) + ' (want 120 x 135 +- 0.05), simple ' + simple
      + ', minY ' + f(box.minY, 3),
  };
}

/** @returns {SelfTestResult} */
function caseOffsetFold() {
  const doc = getSample('tshirt');
  const piece = /** @type {Piece} */ (doc.pieces.find((p) => p.id === 'front'));
  const cut = offsetOutline(piece, {});
  const box = bbox(cut);
  const pass = box.minX >= -0.05;
  return {
    name: 'offset.fold',
    pass,
    details: 'cut minX ' + f(box.minX, 4) + ' (want >= -0.05), maxX ' + f(box.maxX, 2) + ', points ' + cut.length,
  };
}

/** @returns {SelfTestResult} */
function casePackShelf() {
  const items = [
    { id: 'a', w: 400, h: 600 },
    { id: 'b', w: 380, h: 590 },
    { id: 'c', w: 300, h: 280 },
    { id: 'd', w: 290, h: 275 },
    { id: 'e', w: 260, h: 260 },
  ];
  const res = packRects(items, 1000, { gap: 10 });
  let overlaps = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const pi = res.placements[i];
      const pj = res.placements[j];
      const wi = pi.rotated ? items[i].h : items[i].w;
      const hi = pi.rotated ? items[i].w : items[i].h;
      const wj = pj.rotated ? items[j].h : items[j].w;
      const hj = pj.rotated ? items[j].w : items[j].h;
      const sep = pi.x + wi <= pj.x + 1e-9 || pj.x + wj <= pi.x + 1e-9 || pi.y + hi <= pj.y + 1e-9 || pj.y + hj <= pi.y + 1e-9;
      if (!sep) overlaps++;
    }
  }
  const heights = items.map((it) => it.h).sort((p, q) => q - p);
  const cap = heights[0] + heights[1];
  const inSheet = res.placements.every((p, i) => p.x >= -1e-9 && p.x + (p.rotated ? items[i].h : items[i].w) <= 1000 + 1e-9);
  const pass = overlaps === 0 && res.height <= cap + 1e-9 && inSheet;
  return {
    name: 'pack.shelf',
    pass,
    details: 'overlaps ' + overlaps + ', height ' + f(res.height, 1) + ' (<= ' + f(cap, 1) + ' = two tallest), width '
      + f(res.width, 1) + ', all inside sheet ' + inSheet,
  };
}

/** @returns {SelfTestResult} */
function caseRemeshPerformance() {
  const doc = getSample('tshirt');
  const piece = /** @type {Piece} */ (doc.pieces.find((p) => p.id === 'front'));
  remeshPiece(piece, doc, {}); // warm the arc-length caches
  const t0 = Date.now();
  const mesh = remeshPiece(piece, doc, {});
  const ms = Date.now() - t0;
  const pass = ms < 200;
  return { name: 'remesh.performance', pass, details: 'ms ' + ms + ' (want < 200) for ' + mesh.vertexCount + ' vertices' };
}

/** @param {ArrayLike<number>} fr sewn fractions along an edge @returns {number} how many of them differ from their predecessor */
function distinctFractions(fr) {
  let n = 0;
  for (let i = 0; i < fr.length; i++) if (i === 0 || Math.abs(fr[i] - fr[i - 1]) > 1e-12) n++;
  return n;
}

/** @returns {SelfTestResult} */
function caseRemeshAllSamples() {
  const spacings = [8, 15, 40];
  /** @type {string[]} */
  const failures = [];
  let worstPct = 100;
  let checked = 0;
  for (const sampleId of ['tshirt', 'skirt', 'dress']) {
    const base = getSample(sampleId);
    for (const spacing of spacings) {
      const doc = { ...base, pieces: base.pieces.map((p) => ({ ...p, meshSpacing_mm: spacing })) };
      /** @type {Map<string, PieceMesh>} */
      const meshes = new Map();
      for (const piece of doc.pieces) {
        checked++;
        let mesh;
        try {
          mesh = remeshPiece(piece, doc, {});
        } catch (err) {
          failures.push(sampleId + '/' + piece.id + '@' + spacing + ': ' + /** @type {Error} */ (err).message);
          continue;
        }
        meshes.set(piece.id, mesh);
        const { euler } = eulerOf(mesh);
        if (euler !== 1) failures.push(sampleId + '/' + piece.id + '@' + spacing + ': Euler ' + euler);
        if (mesh.quality.pctAbove20 < 98) failures.push(sampleId + '/' + piece.id + '@' + spacing + ': pctAbove20 ' + f(mesh.quality.pctAbove20, 1));
        if (mesh.quality.pctAbove20 < worstPct) worstPct = mesh.quality.pctAbove20;
      }
      for (const seam of doc.seams) {
        const ma = meshes.get(seam.a.pieceId);
        const mb = meshes.get(seam.b.pieceId);
        if (!ma || !mb) continue;
        // a dart's mouth lists two vertices at one sewn fraction: count distinct fractions, the seam's real sample count
        const na = distinctFractions(ma.edgeFrac[seam.a.mirror ? 1 : 0][seam.a.edge]);
        const nb = distinctFractions(mb.edgeFrac[seam.b.mirror ? 1 : 0][seam.b.edge]);
        if (na !== nb) failures.push(sampleId + '/' + seam.id + '@' + spacing + ': ' + na + ' vs ' + nb + ' seam vertices');
      }
    }
  }
  return {
    name: 'remesh.allSamples',
    pass: failures.length === 0,
    details: checked + ' piece meshes at spacings ' + spacings.join('/') + ' mm, worst pctAbove20 ' + f(worstPct, 2)
      + (failures.length ? '; FAILURES: ' + failures.join(' | ') : '; all Euler 1, seam parity holds'),
  };
}

/** @returns {SelfTestResult} */
function caseRemeshSleeve() {
  // Regression: the sleeve cap is a shallow, wide, strongly curved outline whose boundary sampling is far denser than the
  // interior lattice. It used to leave overlapping triangles (Euler 57 / 36) at the default spacing.
  const base = getSample('tshirt');
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const notes = [];
  for (const spacing of [null, 8, 12, 20, 30, 40]) {
    const doc = spacing === null ? base : { ...base, pieces: base.pieces.map((p) => ({ ...p, meshSpacing_mm: spacing })) };
    for (const id of ['sleeve_l', 'sleeve_r']) {
      const piece = /** @type {Piece} */ (doc.pieces.find((p) => p.id === id));
      let mesh;
      try {
        mesh = remeshPiece(piece, doc, {});
      } catch (err) {
        failures.push(id + '@' + (spacing === null ? 'default' : spacing) + ': ' + /** @type {Error} */ (err).message);
        continue;
      }
      const { V, E, T, euler } = eulerOf(mesh);
      if (euler !== 1) failures.push(id + '@' + spacing + ': V ' + V + ' E ' + E + ' T ' + T + ' Euler ' + euler);
      if (mesh.quality.pctAbove20 < 98) failures.push(id + '@' + spacing + ': pctAbove20 ' + f(mesh.quality.pctAbove20, 1));
      // the underarm seam pairs edge 1 with edge 4 of the same sleeve: equal sample counts
      const n1 = mesh.edgeVerts[0][1].length;
      const n4 = mesh.edgeVerts[0][4].length;
      if (n1 !== n4) failures.push(id + '@' + spacing + ': underarm parity ' + n1 + ' vs ' + n4);
      if (id === 'sleeve_l') notes.push((spacing === null ? 'default' : spacing) + ':V' + V);
    }
  }
  return {
    name: 'remesh.sleeve',
    pass: failures.length === 0,
    details: 'sleeve_l/sleeve_r at default + 8/12/20/30/40 mm — ' + notes.join(' ')
      + (failures.length ? '; FAILURES: ' + failures.join(' | ') : '; all Euler 1'),
  };
}

/** 100 x 100 square with one dart on its bottom edge: mouth 40..60, point (50, 60). @param {Partial<Piece>} [extra] @returns {Piece} */
function dartedSquare(extra) {
  return squarePiece({ darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 20, apex: [50, 60] }], ...extra });
}

/** @returns {SelfTestResult} */
function caseDartsMouth() {
  const p = dartedSquare();
  const m = dartMouth(p, p.darts[0]);
  const okMouth = Math.abs(m.a[0] - 40) < 1e-9 && Math.abs(m.b[0] - 60) < 1e-9 && m.a[1] === 0 && m.b[1] === 0;
  const Ls = sewnLength(p, 0);
  const u03 = edgeToSewn(p, 0, 0.3);
  const uIn = edgeToSewn(p, 0, 0.5);
  const back = sewnToEdge(p, 0, 0.5);
  const low = sewnToEdge(p, 0, 0.25);
  const high = sewnToEdge(p, 0, 0.75);
  const fr = mouthFractions(p, 0);
  // a cubic edge: the mouth sits on the curve, symmetric about x = 50, and the pieces either side sum to L - 20
  const c = makePiece({ id: 'cu', vertices: [[0, 0], [100, 0], [100, 100], [0, 100]],
    edges: [{ type: 'cubic', c1: [30, -20], c2: [70, -20] }, { type: 'line' }, { type: 'line' }, { type: 'line' }],
    darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 20, apex: [50, 60] }] });
  const mc = dartMouth(c, c.darts[0]);
  const derived = applyDarts(c).piece;
  const parts = edgeLength(derived, 0) + edgeLength(derived, 3);
  const pass = okMouth && Math.abs(Ls - 80) < 1e-9 && Math.abs(u03 - 0.375) < 1e-12 && Math.abs(uIn - 0.5) < 1e-12
    && back.length === 2 && Math.abs(back[0] - 0.4) < 1e-12 && Math.abs(back[1] - 0.6) < 1e-12
    && low.length === 1 && Math.abs(low[0] - 0.2) < 1e-12 && high.length === 1 && Math.abs(high[0] - 0.8) < 1e-12
    && fr.length === 1 && Math.abs(fr[0] - 0.5) < 1e-12
    && Math.abs(mc.a[0] + mc.b[0] - 100) < 0.01 && Math.abs(mc.a[1] - mc.b[1]) < 0.01
    && Math.abs(parts - (edgeLength(c, 0) - 20)) < 0.05;
  return { name: 'darts.mouth', pass, details: `L_sewn ${f(Ls)}, u(0.3) ${f(u03)}, mouth -> [${back.map((x) => f(x)).join(', ')}], cubic parts ${f(parts)} vs ${f(edgeLength(c, 0) - 20)}` };
}

/** @returns {SelfTestResult} */
function caseDartsApply() {
  const p = dartedSquare();
  const { piece: d, map } = applyDarts(p);
  const legs = map.filter((x) => 'dart' in x).length;
  const area = signedArea(d.vertices);
  // the derived piece is outline-only: no edge-indexed field survives, and it shares no array with its input
  const full = dartedSquare({ pinnedEdges: [2], internalLines: [{ kind: 'mark', points: [[10, 10], [20, 20]] }], grainline: { a: [50, 20], b: [50, 80] } });
  const o = applyDarts(full).piece;
  const outlineOnly = o.pinnedEdges.length === 0 && o.internalLines.length === 0 && o.darts.length === 0 && o.notches.length === 0
    && o.pinnedEdges !== full.pinnedEdges && o.internalLines !== full.internalLines && o.grainline.a !== full.grainline.a
    && full.pinnedEdges.length === 1 && full.internalLines.length === 1;
  const pass = d.vertices.length === 7 && legs === 2 && area > 0 && isSimplePolygon(d.vertices) && Math.abs(area - (10000 - 600)) < 1e-6
    && outlineOnly;
  return { name: 'darts.apply', pass, details: `${d.vertices.length} vertices, ${legs} legs, area ${f(area)} (want 9400); outline-only ${outlineOnly}` };
}

/** @returns {SelfTestResult} */
function caseDartsCheck() {
  /** @type {[string, Piece][]} */
  const cases = [
    ['DART_EDGE', dartedSquare({ darts: [{ id: 'd', edge: 9, t: 0.5, width_mm: 20, apex: [50, 60] }] })],
    ['DART_EDGE', dartedSquare({ foldEdge: 3, vertices: [[0, 0], [100, 0], [100, 100], [0, 100]], darts: [{ id: 'd', edge: 3, t: 0.5, width_mm: 20, apex: [50, 50] }] })],
    ['DART_WIDTH', dartedSquare({ darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 0.5, apex: [50, 60] }] })],
    ['DART_MOUTH', dartedSquare({ darts: [{ id: 'd', edge: 0, t: 0.05, width_mm: 20, apex: [50, 60] }] })],
    ['DART_APEX', dartedSquare({ darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 20, apex: [50, 150] }] })],
    ['DART_APEX', dartedSquare({ darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 20, apex: [50, 99.5] }] })],
    ['DART_OVERLAP', dartedSquare({ darts: [{ id: 'd', edge: 0, t: 0.3, width_mm: 20, apex: [30, 60] }, { id: 'e', edge: 0, t: 0.4, width_mm: 20, apex: [40, 60] }] })],
    ['DART_CROSSES', makePiece({ id: 'L', vertices: [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]],
      darts: [{ id: 'd', edge: 0, t: 0.8, width_mm: 10, apex: [20, 80] }] })],
    ['DART_CROSSES', dartedSquare({ darts: [{ id: 'd', edge: 0, t: 0.25, width_mm: 10, apex: [75, 60] }, { id: 'e', edge: 0, t: 0.75, width_mm: 10, apex: [25, 60] }] })],
    ['DART_ID', dartedSquare({ darts: [{ id: 'd', edge: 0, t: 0.25, width_mm: 10, apex: [25, 40] }, { id: 'd', edge: 2, t: 0.5, width_mm: 10, apex: [50, 50] }] })],
    ['DART_NOTCH', dartedSquare({ notches: [{ edge: 0, t: 0.5, kind: 'single' }] })],
  ];
  const missed = [];
  for (const [code, piece] of cases) if (!checkDarts(piece).issues.some((i) => i.code === code)) missed.push(code);
  const clean = checkDarts(dartedSquare()).issues.length === 0;
  const mixed = dartedSquare({ darts: [{ id: 'ok', edge: 0, t: 0.5, width_mm: 20, apex: [50, 60] }, { id: 'bad', edge: 2, t: 0.5, width_mm: 20, apex: [50, 150] }] });
  const valid = validDartIndices(mixed);
  const pass = missed.length === 0 && clean && valid.length === 1 && valid[0] === 0;
  return { name: 'darts.check', pass, details: (missed.length ? 'codes not fired: ' + missed.join(', ') : cases.length + ' codes fired') + '; clean ' + clean + '; valid ' + JSON.stringify(valid) };
}

/** @returns {SelfTestResult} */
function caseDartsCarry() {
  const p = squarePiece({ darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 20, apex: [50, 60] }, { id: 'e', edge: 2, t: 0.5, width_mm: 10, apex: [50, 40] }] });
  const { piece: s } = splitEdge(p, 0, 0.25);
  const moved = s.darts[0];
  const later = s.darts[1];
  const splitOk = moved.edge === 1 && Math.abs(moved.t - 0.25 / 0.75) < 1e-9 && moved.width_mm === 20 && later.edge === 3;
  const fold = makePiece({ id: 'fh', vertices: [[0, 0], [100, 0], [100, 100], [0, 100]], foldEdge: 3,
    darts: [{ id: 'd', edge: 0, t: 0.6, width_mm: 10, apex: [60, 40] }] });
  const m = mirrorPiece(fold);
  const twin = m.darts.find((dd) => dd.id === 'd_m');
  const mirrorOk = m.darts.length === 2 && !!twin && Math.abs(twin.apex[0] + 60) < 1e-9 && Math.abs(twin.t - 0.4) < 1e-9
    && checkDarts(m).issues.length === 0;
  return { name: 'darts.carry', pass: splitOk && mirrorOk, details: `split: edge ${moved.edge} t ${f(moved.t)}; mirror: ${m.darts.length} darts, twin apex ${twin ? twin.apex.join(',') : 'none'}` };
}

/** @returns {SelfTestResult} */
function caseRemeshDartNarrow() {
  const p = makePiece({ id: 'nd', vertices: [[0, 0], [200, 0], [200, 300], [0, 300]],
    darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 20, apex: [100, 100] }] });
  const m = remeshPiece(p, { pieces: [p], seams: [] });
  const { euler } = eulerOf(m);
  const legs = m.dartVerts[0][0];
  const F = seamSampleFractions(p, 0, { pieces: [p], seams: [] });
  const apexShared = legs.a.length === legs.b.length && legs.a.length >= 3 && legs.a[legs.a.length - 1] === legs.b[legs.b.length - 1] && legs.a[0] !== legs.b[0];
  const counts = m.edgeVerts[0][0].length === F.length + 1 && m.edgeFrac[0][0].length === F.length + 1;
  const area = Math.abs(m.area_mm2 - (60000 - 1000)) < 50;
  const pass = euler === 1 && m.quality.pctAbove20 >= 98 && apexShared && counts && area;
  return { name: 'remesh.dartNarrow', pass, details: `Euler ${euler}, pctAbove20 ${f(m.quality.pctAbove20, 1)}, legs ${legs.a.length}/${legs.b.length}, edge samples ${m.edgeVerts[0][0].length} (F ${F.length}), area ${f(m.area_mm2, 0)}` };
}

/** @returns {SelfTestResult} */
function caseRemeshDartSeam() {
  // A's top edge (e2, right -> left) carries a dart; B's bottom edge (e0, left -> right) is 180 mm = A's sewn length
  const A = makePiece({ id: 'A', vertices: [[0, 0], [200, 0], [200, 100], [0, 100]],
    darts: [{ id: 'd', edge: 2, t: 0.4, width_mm: 20, apex: [120, 40] }] });
  const B = makePiece({ id: 'B', vertices: [[0, 150], [180, 150], [180, 250], [0, 250]] });
  const seams = [{ id: 's', kind: 'plain', a: { pieceId: 'A', edge: 2, mirror: false, reverse: false }, b: { pieceId: 'B', edge: 0, mirror: false, reverse: true } }];
  const doc = { pieces: [A, B], seams };
  const FA = seamSampleFractions(A, 2, doc);
  const FB = seamSampleFractions(B, 0, doc);
  const mirrored = FA.length === FB.length && FA.every((u, i) => Math.abs(u - (1 - FB[FB.length - 1 - i])) < 1e-9);
  const mA = remeshPiece(A, doc);
  const mB = remeshPiece(B, doc);
  const fr = Array.from(mA.edgeFrac[0][2]);
  const doubled = fr.filter((u, i) => i > 0 && Math.abs(u - fr[i - 1]) < 1e-12).length;
  // a dart on B too, somewhere else: both sides get one extra vertex, and the u sets still agree
  const B2 = { ...B, darts: [{ id: 'e', edge: 0, t: 0.25, width_mm: 10, apex: [45, 200] }] };
  const A2 = { ...A, vertices: [[0, 0], [210, 0], [210, 100], [0, 100]], darts: [{ id: 'd', edge: 2, t: 0.4, width_mm: 20, apex: [126, 40] }] };
  const doc2 = { pieces: [A2, B2], seams };
  const mA2 = remeshPiece(A2, doc2);
  const mB2 = remeshPiece(B2, doc2);
  /** @param {ArrayLike<number>} fa @returns {number[]} the distinct fractions (a mouth's two corners share one) */
  const distinct = (fa) => Array.from(fa).filter((u, i, all) => i === 0 || Math.abs(u - all[i - 1]) > 1e-12);
  const uA = distinct(mA2.edgeFrac[0][2]);
  const uB = distinct(mB2.edgeFrac[0][0]).map((u) => 1 - u).reverse();
  const both = mA2.edgeVerts[0][2].length === uA.length + 1 && mB2.edgeVerts[0][0].length === uB.length + 1
    && uA.length === uB.length && uA.every((u, i) => Math.abs(u - uB[i]) < 1e-9);
  const pass = mirrored && mA.edgeVerts[0][2].length === mB.edgeVerts[0][0].length + 1 && doubled === 1 && both;
  return { name: 'remesh.dartSeam', pass, details: `fractions mirror ${mirrored}; A ${mA.edgeVerts[0][2].length} vs B ${mB.edgeVerts[0][0].length}; doubled u ${doubled}; darts on both sides agree ${both}` };
}

/** @returns {SelfTestResult} */
function caseRemeshTwoMouths() {
  // A's bottom edge (e0, left -> right) carries two darts; B's top edge (e2, right -> left) is 260 mm = A's sewn length
  const A = makePiece({ id: 'A', vertices: [[0, 0], [300, 0], [300, 120], [0, 120]],
    darts: [{ id: 'd1', edge: 0, t: 0.3, width_mm: 20, apex: [90, 70] }, { id: 'd2', edge: 0, t: 0.7, width_mm: 20, apex: [210, 70] }] });
  const B = makePiece({ id: 'B', vertices: [[0, 200], [260, 200], [260, 300], [0, 300]] });
  const doc = { pieces: [A, B], seams: [{ id: 's', kind: 'plain', a: { pieceId: 'A', edge: 0, mirror: false, reverse: false }, b: { pieceId: 'B', edge: 2, mirror: false, reverse: true } }] };
  const valid = checkDarts(A).issues.length === 0;
  const FA = seamSampleFractions(A, 0, doc);
  const FB = seamSampleFractions(B, 2, doc);
  const mirrored = FA.length === FB.length && FA.every((u, i) => Math.abs(u - (1 - FB[FB.length - 1 - i])) < 1e-9);
  const mouthU = mouthFractions(A, 0);
  const forced = mouthU.length === 2 && Math.abs(mouthU[0] - 80 / 260) < 1e-12 && Math.abs(mouthU[1] - 180 / 260) < 1e-12
    && mouthU.every((u) => FA.some((x) => Math.abs(x - u) < 1e-12));
  const mA = remeshPiece(A, doc);
  const mB = remeshPiece(B, doc);
  const ev = mA.edgeVerts[0][0];
  const fr = mA.edgeFrac[0][0];
  // each mouth is two consecutive edge vertices at one u, A then B, and they start that dart's legs
  const corners = [];
  for (let j = 1; j < fr.length; j++) if (Math.abs(fr[j] - fr[j - 1]) < 1e-12) corners.push(j - 1);
  const legsOk = [0, 1].every((k) => {
    const legs = mA.dartVerts[0][k];
    const j = corners[k];
    return legs.a.length === legs.b.length && legs.a.length >= 3 && legs.a[legs.a.length - 1] === legs.b[legs.b.length - 1]
      && j !== undefined && legs.a[0] === ev[j] && legs.b[0] === ev[j + 1] && Math.abs(fr[j] - mouthU[k]) < 1e-12;
  }) && mA.dartVerts[0][0].a[mA.dartVerts[0][0].a.length - 1] !== mA.dartVerts[0][1].a[mA.dartVerts[0][1].a.length - 1];
  const counts = ev.length === FA.length + 2 && mB.edgeVerts[0][2].length === FB.length && corners.length === 2;
  // the sides pair by sewn fraction: A's distinct fractions are B's read backwards, u -> 1 - u (cloth pairByFraction)
  const uA = Array.from(fr).filter((u, i, all) => i === 0 || Math.abs(u - all[i - 1]) > 1e-12);
  const uB = Array.from(mB.edgeFrac[0][2]).map((u) => 1 - u).reverse();
  const pairs = uA.length === uB.length && uA.every((u, i) => Math.abs(u - uB[i]) < 1e-9);
  const clean = eulerOf(mA).euler === 1 && eulerOf(mB).euler === 1 && mA.warnings.length === 0 && mA.quality.pctAbove20 >= 95;
  const pass = valid && mirrored && forced && legsOk && counts && pairs && clean;
  return { name: 'remesh.twoMouths', pass, details: `valid ${valid}; fractions mirror ${mirrored}; mouths at u ${mouthU.map((u) => f(u, 4)).join(', ')} forced ${forced}; `
    + `A ${ev.length} edge vertices (F ${FA.length} + 2), B ${mB.edgeVerts[0][2].length}; legs ${legsOk}; pair by fraction ${pairs}; `
    + `Euler ${eulerOf(mA).euler}, pctAbove20 ${f(mA.quality.pctAbove20, 1)}, warnings ${mA.warnings.length}` };
}

/** @returns {SelfTestResult} */
function caseRemeshDress() {
  const doc = getSample('dress');
  let V = 0;
  const notes = [];
  let ok = true;
  for (const p of doc.pieces) {
    const m = remeshPiece(p, doc);
    V += m.vertexCount;
    const { euler } = eulerOf(m);
    const legsOk = (p.darts || []).every((_, k) => m.dartVerts[0][k].a.length >= 3);
    if (euler !== 1 || m.quality.pctAbove20 < 98 || !legsOk || m.warnings.some((w) => w.startsWith('dart-ignored'))) ok = false;
    notes.push(`${p.id} ${m.vertexCount}v ${f(m.quality.pctAbove20, 1)}%`);
  }
  const pass = ok && V >= 4500 && V <= 7000;
  return { name: 'remesh.dress', pass, details: `total ${V} vertices (want 4500..7000); ` + notes.join(', ') };
}

// ----------------------------------------------------------------------------------------------------------------- run

/** @type {(() => SelfTestResult)[]} */
const CASES = [
  caseBezierLength,
  caseBezierSplit,
  casePolygonPredicates,
  caseMirrorFullOutline,
  caseDelaunayBasic,
  caseDelaunayRecover,
  caseRemeshSquare,
  caseRemeshSeamParity,
  caseRemeshFold,
  caseRemeshNotch,
  caseOffsetSquare,
  caseOffsetDiscontinuity,
  caseOffsetFold,
  casePackShelf,
  caseRemeshPerformance,
  caseRemeshAllSamples,
  caseRemeshSleeve,
  caseDartsMouth,
  caseDartsApply,
  caseDartsCheck,
  caseDartsCarry,
  caseRemeshDartNarrow,
  caseRemeshDartSeam,
  caseRemeshTwoMouths,
  caseRemeshDress,
];

/** Names in declaration order (the 15 of SPEC 5.9, remesh.allSamples, remesh.sleeve, the four darts cases, then the three darted-mesh cases, then the dress). @returns {string[]} */
export function listSelfTests() {
  return ['bezier.length', 'bezier.split', 'polygon.predicates', 'mirror.fullOutline', 'delaunay.basic',
    'delaunay.recover', 'remesh.square', 'remesh.seamParity', 'remesh.fold', 'remesh.notch', 'offset.square',
    'offset.discontinuity', 'offset.fold', 'pack.shelf', 'remesh.performance', 'remesh.allSamples', 'remesh.sleeve',
    'darts.mouth', 'darts.apply', 'darts.check', 'darts.carry', 'remesh.dartNarrow', 'remesh.dartSeam', 'remesh.twoMouths',
    'remesh.dress'];
}

/** @returns {Promise<SelfTestResult[]>} */
export async function runSelfTest() {
  const names = listSelfTests();
  /** @type {SelfTestResult[]} */
  const out = [];
  for (let i = 0; i < CASES.length; i++) {
    try {
      out.push(CASES[i]());
    } catch (err) {
      const e = /** @type {Error & {code?: string}} */ (err);
      out.push({ name: names[i], pass: false, details: 'threw ' + (e.code ? e.code + ' ' : '') + e.message });
    }
  }
  return out;
}
