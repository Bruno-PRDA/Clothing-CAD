// src/pattern/validate.js — document issues shown by the 2D editor (SPEC 11.11.2). Pure.

import { signedArea, isSimplePolygon, offsetOutline } from '../geometry/index.js';
import { flattenCache } from './hit.js';
import { seamEase, seamOfEdge, EASE_WARN_PCT, EASE_ERROR_PCT } from './seams.js';

/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').Seam} Seam */
/** @typedef {import('../core/types.js').Issue} Issue */
/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */

/** code -> {level, message template}. `${...}` placeholders are filled by `formatIssue`. */
export const ISSUE_CODES = Object.freeze({
  PIECE_TOO_FEW_VERTICES: { level: 'error', message: '${name}: outline needs at least 3 vertices' },
  PIECE_NOT_CCW: { level: 'error', message: '${name}: outline is not counter-clockwise' },
  PIECE_SELF_INTERSECTING: { level: 'error', message: '${name}: outline crosses itself' },
  PIECE_TINY: { level: 'warn', message: '${name}: piece is smaller than 1 cm²' },
  FOLD_EDGE_INVALID: { level: 'error', message: '${name}: fold edge must be a straight edge' },
  FOLD_EDGE_NOT_VERTICAL: { level: 'error', message: '${name}: fold edge must lie on x = 0' },
  FOLD_PIECE_CROSSES_AXIS: { level: 'warn', message: '${name}: the half piece crosses the fold line' },
  FOLD_EDGE_ALLOWANCE: { level: 'error', message: '${name}: the fold edge must have 0 allowance' },
  EDGE_CUBIC_MISSING_HANDLES: { level: 'error', message: '${name}: edge ${e} is cubic without handles' },
  NOTCH_RANGE: { level: 'error', message: '${name}: notch ${k} is outside its edge' },
  GRAINLINE_DEGENERATE: { level: 'warn', message: '${name}: grainline is degenerate' },
  MESH_SPACING_RANGE: { level: 'error', message: '${name}: mesh spacing must be 8..40 mm' },
  ALLOWANCE_OVERLAP: { level: 'warn', message: '${name}: seam allowance overlaps itself (reduce the allowance)' },
  FABRIC_MISSING: { level: 'error', message: "${name}: fabric '${fabricId}' does not exist" },
  EDGES_UNSEWN: { level: 'warn', message: '${name}: no seams and no pinned edges — it will fall' },
  SEAM_DANGLING: { level: 'error', message: 'Seam ${id}: references a missing piece or edge' },
  SEAM_ON_FOLD_EDGE: { level: 'error', message: 'Seam ${id}: cannot sew the fold edge' },
  SEAM_MIRROR_WITHOUT_FOLD: { level: 'error', message: 'Seam ${id}: mirror side on a piece without a fold' },
  SEAM_EDGE_REUSED: { level: 'error', message: 'Seam ${id}: edge already used by seam ${other}' },
  SEAM_EASE_HIGH: { level: 'warn', message: 'Seam ${id}: A ${lenA} mm / B ${lenB} mm - ease ${e}% (> 8%)' },
  SEAM_EASE_EXTREME: { level: 'error', message: 'Seam ${id}: seam lengths differ by ${e}%' },
});

/**
 * Fills the `${key}` placeholders of an ISSUE_CODES message.
 * @param {string} code @param {Record<string, string|number>} vars @returns {string}
 */
export function formatIssue(code, vars) {
  const entry = ISSUE_CODES[code];
  const tpl = entry ? entry.message : code;
  return tpl.replace(/\$\{(\w+)\}/g, (_m, key) => {
    const v = vars ? vars[key] : undefined;
    return v === undefined || v === null ? '' : String(v);
  });
}

/**
 * @param {Issue[]} out @param {string} code @param {Record<string, string|number>} vars
 * @param {{pieceId?:string, seamId?:string, edge?:number}} [extra]
 */
function push(out, code, vars, extra) {
  const entry = ISSUE_CODES[code];
  /** @type {Issue} */
  const issue = {
    level: entry ? /** @type {'error'|'warn'} */ (entry.level) : 'warn',
    code,
    message: formatIssue(code, vars),
  };
  if (extra) {
    if (extra.pieceId !== undefined) issue.pieceId = extra.pieceId;
    if (extra.seamId !== undefined) issue.seamId = extra.seamId;
    if (extra.edge !== undefined) issue.edge = extra.edge;
  }
  out.push(issue);
}

/** @param {ProjectDoc} doc @param {Piece} piece @returns {Issue[]} */
export function validatePiece(doc, piece) {
  /** @type {Issue[]} */
  const out = [];
  if (!piece) return out;
  const name = piece.name || piece.id;
  const id = piece.id;
  const verts = Array.isArray(piece.vertices) ? piece.vertices : [];
  const edges = Array.isArray(piece.edges) ? piece.edges : [];
  const n = verts.length;

  if (n < 3 || edges.length !== n) {
    push(out, 'PIECE_TOO_FEW_VERTICES', { name }, { pieceId: id });
    return out;
  }

  for (let e = 0; e < edges.length; e++) {
    if (edges[e] && edges[e].type === 'cubic' && (!edges[e].c1 || !edges[e].c2)) {
      push(out, 'EDGE_CUBIC_MISSING_HANDLES', { name, e }, { pieceId: id, edge: e });
    }
  }

  /** @type {import('../core/types.js').Vec2[]} */
  let points = verts;
  try {
    points = flattenCache(piece).points;
  } catch (_e) {
    points = verts;
  }
  const area = signedArea(points);
  if (area <= 0) push(out, 'PIECE_NOT_CCW', { name }, { pieceId: id });
  if (!isSimplePolygon(points)) push(out, 'PIECE_SELF_INTERSECTING', { name }, { pieceId: id });
  if (Math.abs(area) < 100) push(out, 'PIECE_TINY', { name }, { pieceId: id });

  const fe = piece.foldEdge;
  if (fe !== null && fe !== undefined) {
    if (!Number.isInteger(fe) || fe < 0 || fe >= edges.length || edges[fe].type !== 'line') {
      push(out, 'FOLD_EDGE_INVALID', { name }, { pieceId: id, edge: Number.isInteger(fe) ? fe : undefined });
    } else {
      const p0 = verts[fe];
      const p1 = verts[(fe + 1) % n];
      if (Math.abs(p0[0]) > 0.01 || Math.abs(p1[0]) > 0.01) {
        push(out, 'FOLD_EDGE_NOT_VERTICAL', { name }, { pieceId: id, edge: fe });
      }
      const allow = edges[fe].allowance_mm;
      if (allow !== undefined && allow !== 0) push(out, 'FOLD_EDGE_ALLOWANCE', { name }, { pieceId: id, edge: fe });
      let crosses = false;
      for (const v of verts) if (v[0] < -0.01) crosses = true;
      for (const e of edges) {
        if (e && e.type === 'cubic') {
          if ((e.c1 && e.c1[0] < -0.01) || (e.c2 && e.c2[0] < -0.01)) crosses = true;
        }
      }
      if (crosses) push(out, 'FOLD_PIECE_CROSSES_AXIS', { name }, { pieceId: id });
    }
  }

  const notches = Array.isArray(piece.notches) ? piece.notches : [];
  for (let k = 0; k < notches.length; k++) {
    const nt = notches[k];
    if (!nt || !Number.isInteger(nt.edge) || nt.edge < 0 || nt.edge >= edges.length || !(nt.t > 0 && nt.t < 1)) {
      push(out, 'NOTCH_RANGE', { name, k }, { pieceId: id, edge: nt ? nt.edge : undefined });
    }
  }

  const g = piece.grainline;
  if (!g || !g.a || !g.b || Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) < 1) {
    push(out, 'GRAINLINE_DEGENERATE', { name }, { pieceId: id });
  }

  const ms = piece.meshSpacing_mm;
  if (!(typeof ms === 'number' && ms >= 8 && ms <= 40)) push(out, 'MESH_SPACING_RANGE', { name }, { pieceId: id });

  try {
    const off = offsetOutline(piece);
    if (!isSimplePolygon(off) || signedArea(off) <= area) {
      push(out, 'ALLOWANCE_OVERLAP', { name }, { pieceId: id });
    }
  } catch (_e) {
    push(out, 'ALLOWANCE_OVERLAP', { name }, { pieceId: id });
  }

  const fabrics = (doc && Array.isArray(doc.fabrics)) ? doc.fabrics : [];
  if (!fabrics.some((f) => f && f.id === piece.fabricId)) {
    push(out, 'FABRIC_MISSING', { name, fabricId: piece.fabricId }, { pieceId: id });
  }

  if (piece.simulate !== false && (!Array.isArray(piece.pinnedEdges) || piece.pinnedEdges.length === 0)) {
    let sewn = false;
    for (let e = 0; e < edges.length && !sewn; e++) {
      if (seamOfEdge(doc, id, e, false) || seamOfEdge(doc, id, e, true)) sewn = true;
    }
    if (!sewn) push(out, 'EDGES_UNSEWN', { name }, { pieceId: id });
  }

  return out;
}

/** @param {ProjectDoc} doc @param {Seam} seam @returns {Issue[]} */
export function validateSeam(doc, seam) {
  /** @type {Issue[]} */
  const out = [];
  if (!seam) return out;
  const id = seam.id;
  const pieces = (doc && Array.isArray(doc.pieces)) ? doc.pieces : [];
  let dangling = false;
  for (const side of [seam.a, seam.b]) {
    const piece = side ? pieces.find((p) => p && p.id === side.pieceId) : null;
    if (!piece || !Number.isInteger(side.edge) || side.edge < 0 || side.edge >= piece.edges.length) {
      dangling = true;
      continue;
    }
    if (piece.foldEdge !== null && piece.foldEdge !== undefined && side.edge === piece.foldEdge) {
      push(out, 'SEAM_ON_FOLD_EDGE', { id }, { seamId: id, pieceId: piece.id, edge: side.edge });
    }
    if (side.mirror === true && (piece.foldEdge === null || piece.foldEdge === undefined)) {
      push(out, 'SEAM_MIRROR_WITHOUT_FOLD', { id }, { seamId: id, pieceId: piece.id });
    }
  }
  if (dangling) {
    push(out, 'SEAM_DANGLING', { id }, { seamId: id });
    return out;
  }

  const seams = (doc && Array.isArray(doc.seams)) ? doc.seams : [];
  for (const side of [seam.a, seam.b]) {
    for (const other of seams) {
      if (!other || other.id === seam.id) continue;
      for (const os of [other.a, other.b]) {
        if (os && os.pieceId === side.pieceId && os.edge === side.edge && (os.mirror === true) === (side.mirror === true)) {
          push(out, 'SEAM_EDGE_REUSED', { id, other: other.id }, { seamId: id, pieceId: side.pieceId, edge: side.edge });
        }
      }
    }
  }

  const ease = seamEase(doc, seam);
  const e = ease.easePct;
  if (e > EASE_ERROR_PCT) {
    push(out, 'SEAM_EASE_EXTREME', { id, e: e.toFixed(1) }, { seamId: id });
  } else if (e > EASE_WARN_PCT) {
    push(out, 'SEAM_EASE_HIGH', {
      id, lenA: Math.round(ease.lenA_mm), lenB: Math.round(ease.lenB_mm), e: e.toFixed(1),
    }, { seamId: id });
  }
  return out;
}

/**
 * All issues of the document: pieces first (document order), then seams.
 * @param {ProjectDoc} doc @returns {Issue[]}
 */
export function validateDoc(doc) {
  /** @type {Issue[]} */
  const out = [];
  if (!doc) return out;
  for (const piece of (Array.isArray(doc.pieces) ? doc.pieces : [])) {
    for (const issue of validatePiece(doc, piece)) out.push(issue);
  }
  for (const seam of (Array.isArray(doc.seams) ? doc.seams : [])) {
    for (const issue of validateSeam(doc, seam)) out.push(issue);
  }
  return out;
}
