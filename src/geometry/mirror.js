// src/geometry/mirror.js — fold pieces: full outline across x = foldX (SPEC 5.3). Pure; mm.

/** @typedef {import('../core/types.js').Vec2} Vec2 */
/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').Edge} Edge */

/** M(p) = [2·foldX − p[0], p[1]]. @param {Vec2} p @param {number} foldX @returns {Vec2} */
export function mirrorPoint(p, foldX) {
  return [2 * foldX - p[0], p[1]];
}

/** @param {Edge} edge @returns {Edge} */
function copyEdge(edge) {
  /** @type {Edge} */
  const out = { type: edge.type };
  if (edge.c1) out.c1 = [edge.c1[0], edge.c1[1]];
  if (edge.c2) out.c2 = [edge.c2[0], edge.c2[1]];
  if (edge.allowance_mm !== undefined) out.allowance_mm = edge.allowance_mm;
  if (edge.label !== undefined) out.label = edge.label;
  return out;
}

/** Mirrored edge traversed backwards: control points M(c2), M(c1). @param {Edge} edge @param {number} foldX @returns {Edge} */
function mirrorEdgeReversed(edge, foldX) {
  /** @type {Edge} */
  const out = { type: edge.type };
  if (edge.type === 'cubic' && edge.c1 && edge.c2) {
    out.c1 = mirrorPoint(edge.c2, foldX);
    out.c2 = mirrorPoint(edge.c1, foldX);
  }
  if (edge.allowance_mm !== undefined) out.allowance_mm = edge.allowance_mm;
  if (edge.label !== undefined) out.label = edge.label;
  return out;
}

/**
 * Full outline of a piece (fold pieces mirrored across x = foldX; the fold edge disappears). CCW when the stored half is.
 * Non-fold pieces: copies of vertices/edges, fullEdgeOf = [[0..n-1], []], fullEdgeReversed all false, foldX null.
 * Fold pieces: loop = vertices[f+1], original edges f+1 .. f-1 (mod n), vertices[f], then the MIRRORED edges f-1 .. f+1
 * traversed backwards. fullEdgeOf[mirror][e] = index of the copy of edge e in the full loop (-1 for the fold edge);
 * fullEdgeReversed[k] (indexed by FULL-loop edge k) = true for mirrored edges.
 * @param {Piece} piece
 * @returns {{vertices: Vec2[], edges: Edge[], fullEdgeOf: number[][], fullEdgeReversed: boolean[], foldX: number|null}}
 */
export function fullOutline(piece) {
  const n = piece.vertices.length;
  const f = piece.foldEdge;
  if (typeof f !== 'number' || f < 0 || f >= n) {
    const vertices = piece.vertices.map((v) => /** @type {Vec2} */ ([v[0], v[1]]));
    const edges = piece.edges.map(copyEdge);
    const own = new Array(n);
    for (let i = 0; i < n; i++) own[i] = i;
    return { vertices, edges, fullEdgeOf: [own, []], fullEdgeReversed: new Array(n).fill(false), foldX: null };
  }
  const foldX = piece.vertices[f][0];
  /** @type {Vec2[]} */
  const vertices = [];
  /** @type {Edge[]} */
  const edges = [];
  const of0 = new Array(n).fill(-1);
  const of1 = new Array(n).fill(-1);
  /** @type {boolean[]} */
  const reversed = [];
  // originals: edges f+1 .. f-1
  for (let k = 0; k < n - 1; k++) {
    const e = (f + 1 + k) % n;
    const v = piece.vertices[e];
    vertices.push([v[0], v[1]]);
    of0[e] = edges.length;
    edges.push(copyEdge(piece.edges[e]));
    reversed.push(false);
  }
  // vertices[f] (on the fold), then mirrored edges f-1 .. f+1 traversed backwards
  const vf = piece.vertices[f];
  vertices.push([vf[0], vf[1]]);
  for (let k = 0; k < n - 1; k++) {
    const e = (f - 1 - k + n) % n;
    if (k > 0) {
      const v = piece.vertices[(e + 1) % n];
      vertices.push(mirrorPoint(v, foldX));
    }
    of1[e] = edges.length;
    edges.push(mirrorEdgeReversed(piece.edges[e], foldX));
    reversed.push(true);
  }
  return { vertices, edges, fullEdgeOf: [of0, of1], fullEdgeReversed: reversed, foldX };
}

/** NEW non-fold piece whose vertices/edges are the full outline (notches/pinned edges duplicated onto the mirrored copies). @param {Piece} piece @returns {Piece} */
export function mirrorPiece(piece) {
  const full = fullOutline(piece);
  const out = /** @type {Piece} */ (JSON.parse(JSON.stringify(piece)));
  out.vertices = full.vertices;
  out.edges = full.edges;
  out.foldEdge = null;
  const of0 = full.fullEdgeOf[0];
  const of1 = full.fullEdgeOf[1];
  /** @type {import('../core/types.js').Notch[]} */
  const notches = [];
  for (const nt of (piece.notches || [])) {
    if (of0[nt.edge] !== undefined && of0[nt.edge] >= 0) notches.push({ edge: of0[nt.edge], t: nt.t, kind: nt.kind });
    if (of1[nt.edge] !== undefined && of1[nt.edge] >= 0) notches.push({ edge: of1[nt.edge], t: 1 - nt.t, kind: nt.kind });
  }
  out.notches = notches;
  /** @type {number[]} */
  const pinned = [];
  for (const e of (piece.pinnedEdges || [])) {
    if (of0[e] !== undefined && of0[e] >= 0) pinned.push(of0[e]);
    if (of1[e] !== undefined && of1[e] >= 0) pinned.push(of1[e]);
  }
  out.pinnedEdges = pinned;
  if (full.foldX !== null) {
    const fx = full.foldX;
    const lines = (piece.internalLines || []).slice();
    for (const line of (piece.internalLines || [])) {
      lines.push({ kind: line.kind, points: line.points.map((p) => mirrorPoint(p, fx)) });
    }
    out.internalLines = lines;
    if (out.grade && out.grade.anchorX === 'fold') out.grade.anchorX = 'center';
  }
  return out;
}
