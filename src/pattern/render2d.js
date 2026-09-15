// src/pattern/render2d.js — Canvas 2D drawing of the pattern (SPEC 11.9.4). No WebGL; the context is already dpr-scaled.

import { hashString } from '../core/ids.js';
import { resolveFabric } from '../core/fabrics.js';
import {
  pointAtArcFraction, tangentAtArcFraction, offsetOutline, mirrorPoint, bbox as bboxOf,
} from '../geometry/index.js';
import { flattenCache, notchPoint } from './hit.js';
import { seamEase, EASE_WARN_PCT } from './seams.js';

/** @typedef {import('../core/types.js').Vec2} Vec2 */
/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */
/** @typedef {import('../core/types.js').Issue} Issue */
/** @typedef {import('./view.js').View} View */
/** @typedef {import('./hit.js').Hit} Hit */

/** Colours, widths and fonts of the 2D renderer. */
export const STYLE = Object.freeze({
  bg: '#141518', gridMinor: '#1f2227', gridMajor: '#2b2f36', axis: '#3d4450',
  outline: '#e6e6e6', outlineWidth: 1.5, fillAlpha: 0.18,
  selection: '#4da3ff', selectionWidth: 2.5, hover: 'rgba(77,163,255,0.45)',
  handleFill: '#ffffff', handleLine: 'rgba(255,255,255,0.5)',
  fold: '#ffcc3d', foldDash: Object.freeze([8, 3, 2, 3]), ghostAlpha: 0.35,
  notch: '#ffffff', grainline: '#ff9f43', internalDart: '#ff9f43', internalMark: '#9aa0a6',
  allowance: 'rgba(230,230,230,0.35)', allowanceDash: Object.freeze([4, 3]),
  graded: '#3ddc84', gradedDash: Object.freeze([6, 4]),
  seamWidth: 4, seamAlpha: 0.85, seamWarn: '#ff5c5c',
  label: '#e6e6e6', labelFont: '12px system-ui', edgeLabelFont: '10px system-ui',
  measure: '#ffcc3d', box: 'rgba(77,163,255,0.15)', boxStroke: '#4da3ff',
});

/** @param {string} seamId @returns {number} hue 0..359 */
export function hueOf(seamId) {
  return hashString(String(seamId)) % 360;
}

/** @param {string} seamId @param {boolean} [warn] @returns {string} */
export function seamColor(seamId, warn = false) {
  return warn ? STYLE.seamWarn : 'hsl(' + hueOf(seamId) + ' 70% 55%)';
}

/** @type {WeakMap<object, Vec2[]>} */
const OFFSET_CACHE = new WeakMap();

/** @param {Piece} piece @returns {Vec2[]|null} */
function allowanceOutline(piece) {
  const cached = OFFSET_CACHE.get(piece);
  if (cached !== undefined) return cached;
  let pts = null;
  try {
    pts = offsetOutline(piece);
  } catch (_e) {
    pts = null;
  }
  OFFSET_CACHE.set(piece, /** @type {Vec2[]} */ (pts));
  return pts;
}

/** @param {Piece} piece @returns {number|null} */
function foldXOf(piece) {
  const fe = piece.foldEdge;
  if (fe === null || fe === undefined) return null;
  const v = piece.vertices[fe];
  return v ? v[0] : null;
}

/** @param {Vec2} p @param {number|null} foldX @returns {Vec2} */
function maybeMirror(p, foldX) {
  return foldX === null ? p : mirrorPoint(p, foldX);
}

/**
 * Working copy of a piece with the frame's transient overrides applied.
 * @param {Piece} piece @param {object} t @returns {Piece}
 */
function applyOverrides(piece, t) {
  if (!t) return piece;
  const moved = t.dragOffset && Array.isArray(t.dragOffset.pieceIds) && t.dragOffset.pieceIds.indexOf(piece.id) >= 0;
  const vo = t.vertexOverride && t.vertexOverride.pieceId === piece.id ? t.vertexOverride : null;
  const ho = t.handleOverride && t.handleOverride.pieceId === piece.id ? t.handleOverride : null;
  const no = t.notchOverride && t.notchOverride.pieceId === piece.id ? t.notchOverride : null;
  const go = t.grainPreview && t.grainPreview.pieceId === piece.id ? t.grainPreview : null;
  if (!moved && !vo && !ho && !no && !go) return piece;

  const copy = /** @type {Piece} */ ({
    ...piece,
    vertices: piece.vertices.map((v) => /** @type {Vec2} */ ([v[0], v[1]])),
    edges: piece.edges.map((e) => ({ ...e, c1: e.c1 ? [e.c1[0], e.c1[1]] : undefined, c2: e.c2 ? [e.c2[0], e.c2[1]] : undefined })),
    notches: (piece.notches || []).map((nt) => ({ ...nt })),
    grainline: { a: [piece.grainline.a[0], piece.grainline.a[1]], b: [piece.grainline.b[0], piece.grainline.b[1]] },
  });
  for (const e of copy.edges) {
    if (e.type !== 'cubic') {
      delete e.c1;
      delete e.c2;
    }
  }
  if (moved) {
    const dx = t.dragOffset.dx;
    const dy = t.dragOffset.dy;
    for (const v of copy.vertices) {
      v[0] += dx;
      v[1] += dy;
    }
    for (const e of copy.edges) {
      if (e.c1) {
        e.c1[0] += dx;
        e.c1[1] += dy;
      }
      if (e.c2) {
        e.c2[0] += dx;
        e.c2[1] += dy;
      }
    }
    copy.grainline.a[0] += dx;
    copy.grainline.a[1] += dy;
    copy.grainline.b[0] += dx;
    copy.grainline.b[1] += dy;
    copy.internalLines = (piece.internalLines || []).map((l) => ({ kind: l.kind, points: l.points.map((p) => [p[0] + dx, p[1] + dy]) }));
  }
  if (vo) {
    const i = vo.index;
    const n = copy.vertices.length;
    if (i >= 0 && i < n) {
      const old = copy.vertices[i];
      const dx = vo.pos[0] - old[0];
      const dy = vo.pos[1] - old[1];
      copy.vertices[i] = [vo.pos[0], vo.pos[1]];
      const eNext = copy.edges[i];
      if (eNext && eNext.type === 'cubic' && eNext.c1) eNext.c1 = [eNext.c1[0] + dx, eNext.c1[1] + dy];
      const ePrev = copy.edges[(i - 1 + n) % n];
      if (ePrev && ePrev.type === 'cubic' && ePrev.c2) ePrev.c2 = [ePrev.c2[0] + dx, ePrev.c2[1] + dy];
    }
  }
  if (ho) {
    const e = copy.edges[ho.edge];
    if (e && e.type === 'cubic') e[ho.which] = [ho.pos[0], ho.pos[1]];
  }
  if (no) {
    const nt = copy.notches[no.index];
    if (nt) nt.t = no.t;
  }
  if (go) {
    copy.grainline = { a: [go.a[0], go.a[1]], b: [go.b[0], go.b[1]] };
  }
  return copy;
}

/** @param {CanvasRenderingContext2D} ctx @param {View} view @param {Piece} piece @param {number|null} foldX */
function tracePiece(ctx, view, piece, foldX) {
  const n = piece.vertices.length;
  if (n < 2) return;
  const v0 = maybeMirror(piece.vertices[0], foldX);
  let s = view.worldToScreen(v0[0], v0[1]);
  ctx.beginPath();
  ctx.moveTo(s[0], s[1]);
  for (let e = 0; e < n; e++) {
    const edge = piece.edges[e];
    const p1 = maybeMirror(piece.vertices[(e + 1) % n], foldX);
    const t1 = view.worldToScreen(p1[0], p1[1]);
    if (edge && edge.type === 'cubic' && edge.c1 && edge.c2) {
      const c1 = maybeMirror(edge.c1, foldX);
      const c2 = maybeMirror(edge.c2, foldX);
      const sc1 = view.worldToScreen(c1[0], c1[1]);
      const sc2 = view.worldToScreen(c2[0], c2[1]);
      ctx.bezierCurveTo(sc1[0], sc1[1], sc2[0], sc2[1], t1[0], t1[1]);
    } else {
      ctx.lineTo(t1[0], t1[1]);
    }
    s = t1;
  }
  ctx.closePath();
}

/** @param {CanvasRenderingContext2D} ctx @param {View} view @param {Piece} piece @param {number} e @param {number|null} foldX */
function traceEdge(ctx, view, piece, e, foldX) {
  const n = piece.vertices.length;
  const p0 = maybeMirror(piece.vertices[e], foldX);
  const p1 = maybeMirror(piece.vertices[(e + 1) % n], foldX);
  const s0 = view.worldToScreen(p0[0], p0[1]);
  const s1 = view.worldToScreen(p1[0], p1[1]);
  const edge = piece.edges[e];
  ctx.beginPath();
  ctx.moveTo(s0[0], s0[1]);
  if (edge && edge.type === 'cubic' && edge.c1 && edge.c2) {
    const c1 = maybeMirror(edge.c1, foldX);
    const c2 = maybeMirror(edge.c2, foldX);
    const sc1 = view.worldToScreen(c1[0], c1[1]);
    const sc2 = view.worldToScreen(c2[0], c2[1]);
    ctx.bezierCurveTo(sc1[0], sc1[1], sc2[0], sc2[1], s1[0], s1[1]);
  } else {
    ctx.lineTo(s1[0], s1[1]);
  }
}

/** @param {CanvasRenderingContext2D} ctx @param {View} view @param {Vec2[]} pts @param {boolean} close */
function tracePolyline(ctx, view, pts, close) {
  if (!pts || pts.length === 0) return;
  const s0 = view.worldToScreen(pts[0][0], pts[0][1]);
  ctx.beginPath();
  ctx.moveTo(s0[0], s0[1]);
  for (let i = 1; i < pts.length; i++) {
    const s = view.worldToScreen(pts[i][0], pts[i][1]);
    ctx.lineTo(s[0], s[1]);
  }
  if (close) ctx.closePath();
}

/** @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y @param {number} r */
function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y @param {number} r */
function ring(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** @param {string} hex @param {number} alpha @returns {string} */
function withAlpha(hex, alpha) {
  const h = typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#888888';
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

/** @param {ProjectDoc} doc @param {Piece} piece @param {Record<string,string>} preview @returns {string} */
function pieceColor(doc, piece, preview) {
  if (preview && preview[piece.fabricId]) return preview[piece.fabricId];
  const inst = (doc.fabrics || []).find((f) => f && f.id === piece.fabricId);
  if (!inst) return '#888888';
  try {
    return resolveFabric(inst).look.color;
  } catch (_e) {
    return '#888888';
  }
}

/** @param {CanvasRenderingContext2D} ctx @param {View} view */
function drawGrid(ctx, view) {
  const v = view.get();
  const W = v.width;
  const H = v.height;
  ctx.fillStyle = STYLE.bg;
  ctx.fillRect(0, 0, W, H);

  const tl = view.screenToWorld(0, 0);
  const br = view.screenToWorld(W, H);
  const minX = Math.min(tl[0], br[0]);
  const maxX = Math.max(tl[0], br[0]);
  const minY = Math.min(tl[1], br[1]);
  const maxY = Math.max(tl[1], br[1]);

  /** @param {number} step @param {string} color */
  const lines = (step, color) => {
    if (step * v.pxPerMm < 4) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x0 = Math.ceil(minX / step) * step;
    for (let x = x0; x <= maxX; x += step) {
      const s = view.worldToScreen(x, 0);
      ctx.moveTo(s[0], 0);
      ctx.lineTo(s[0], H);
    }
    const y0 = Math.ceil(minY / step) * step;
    for (let y = y0; y <= maxY; y += step) {
      const s = view.worldToScreen(0, y);
      ctx.moveTo(0, s[1]);
      ctx.lineTo(W, s[1]);
    }
    ctx.stroke();
  };

  if (v.pxPerMm >= 0.4) lines(10, STYLE.gridMinor);
  lines(50, STYLE.gridMajor);

  ctx.strokeStyle = STYLE.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const ox = view.worldToScreen(0, 0);
  ctx.moveTo(ox[0], 0);
  ctx.lineTo(ox[0], H);
  ctx.moveTo(0, ox[1]);
  ctx.lineTo(W, ox[1]);
  ctx.stroke();
}

/**
 * Points of one flattened outline edge (mirror applied when foldX is not null).
 * @param {Piece} piece @param {number} e @param {number|null} foldX @returns {Vec2[]}
 */
function edgePolyline(piece, e, foldX) {
  const flat = flattenCache(piece);
  const pts = flat.points;
  const n = pts.length;
  const ne = flat.edgeStart.length;
  if (!(e >= 0 && e < ne)) return [];
  const start = flat.edgeStart[e];
  const end = (e + 1 < ne) ? flat.edgeStart[e + 1] : n;
  /** @type {Vec2[]} */
  const out = [];
  for (let k = start; k <= end; k++) out.push(maybeMirror(pts[k % n], foldX));
  return out;
}

/**
 * Full redraw of the pattern.
 * @param {CanvasRenderingContext2D} ctx @param {View} view @param {ProjectDoc} doc
 * @param {{selection?:object, hover?:Hit|null, transient?:object, issues?:Issue[], fabricPreview?:Record<string,string>,
 *          activeSize?:string, ghost?:Piece[]|null}} [ui]
 */
export function render(ctx, view, doc, ui) {
  const u = ui || {};
  const sel = u.selection || { pieces: [], seams: [], vertex: null, edge: null };
  const selPieces = Array.isArray(sel.pieces) ? sel.pieces : [];
  const primary = selPieces.length ? selPieces[selPieces.length - 1] : null;
  const t = u.transient || {};
  const hover = u.hover || null;
  const issues = Array.isArray(u.issues) ? u.issues : [];
  const preview = u.fabricPreview || {};
  const v = view.get();

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  drawGrid(ctx, view);

  const pieces = (doc && Array.isArray(doc.pieces)) ? doc.pieces : [];
  /** @type {Set<string>} */
  const errorPieces = new Set();
  for (const issue of issues) if (issue.level === 'error' && issue.pieceId) errorPieces.add(issue.pieceId);

  /** @type {Piece[]} */
  const working = pieces.map((p) => applyOverrides(p, t));

  // ---- 2. per piece --------------------------------------------------------------------------------
  for (let i = 0; i < working.length; i++) {
    const piece = working[i];
    if (!piece || !Array.isArray(piece.vertices) || piece.vertices.length < 3) continue;
    const foldX = foldXOf(piece);
    const selected = selPieces.indexOf(piece.id) >= 0;

    // 2.1 seam-allowance ghost
    const allow = allowanceOutline(piece);
    if (allow && allow.length > 2) {
      ctx.save();
      ctx.strokeStyle = STYLE.allowance;
      ctx.lineWidth = 1;
      ctx.setLineDash(/** @type {number[]} */ (STYLE.allowanceDash.slice()));
      tracePolyline(ctx, view, allow, true);
      ctx.stroke();
      ctx.restore();
    }

    // 2.2 fill
    const color = pieceColor(doc, piece, preview);
    ctx.fillStyle = withAlpha(color, STYLE.fillAlpha);
    tracePiece(ctx, view, piece, null);
    ctx.fill();
    if (foldX !== null) {
      ctx.fillStyle = withAlpha(color, STYLE.fillAlpha * 0.5);
      tracePiece(ctx, view, piece, foldX);
      ctx.fill();
    }

    // 2.3 outline (error underlay first)
    if (errorPieces.has(piece.id)) {
      ctx.strokeStyle = STYLE.seamWarn;
      ctx.lineWidth = 2 + STYLE.outlineWidth;
      tracePiece(ctx, view, piece, null);
      ctx.stroke();
    }
    ctx.strokeStyle = selected ? STYLE.selection : STYLE.outline;
    ctx.lineWidth = selected ? STYLE.selectionWidth : STYLE.outlineWidth;
    tracePiece(ctx, view, piece, null);
    ctx.stroke();

    if (foldX !== null) {
      ctx.save();
      ctx.globalAlpha = STYLE.ghostAlpha;
      ctx.strokeStyle = STYLE.outline;
      ctx.lineWidth = STYLE.outlineWidth;
      ctx.setLineDash([5, 4]);
      tracePiece(ctx, view, piece, foldX);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = STYLE.fold;
      ctx.lineWidth = 2;
      ctx.setLineDash(/** @type {number[]} */ (STYLE.foldDash.slice()));
      traceEdge(ctx, view, piece, /** @type {number} */ (piece.foldEdge), null);
      ctx.stroke();
      ctx.restore();
      const fe = /** @type {number} */ (piece.foldEdge);
      const fa = piece.vertices[fe];
      const fb = piece.vertices[(fe + 1) % piece.vertices.length];
      const fm = view.worldToScreen((fa[0] + fb[0]) / 2, (fa[1] + fb[1]) / 2);
      ctx.fillStyle = STYLE.fold;
      ctx.font = STYLE.edgeLabelFont;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FOLD', fm[0], fm[1] - 8);
    }

    // 2.4 edge labels of the selected piece
    if (selected) {
      ctx.fillStyle = STYLE.label;
      ctx.font = STYLE.edgeLabelFont;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const n = piece.vertices.length;
      for (let e = 0; e < n; e++) {
        const label = piece.edges[e] && piece.edges[e].label;
        if (!label) continue;
        const mid = pointAtArcFraction(piece.vertices[e], piece.edges[e], piece.vertices[(e + 1) % n], 0.5);
        const tan = tangentAtArcFraction(piece.vertices[e], piece.edges[e], piece.vertices[(e + 1) % n], 0.5);
        const s = view.worldToScreen(mid[0], mid[1]);
        ctx.fillText(label, s[0] + tan[1] * 6, s[1] + tan[0] * 6);
      }
    }
  }

  // ---- 3. seams ------------------------------------------------------------------------------------
  const seams = (doc && Array.isArray(doc.seams)) ? doc.seams : [];
  const byId = new Map();
  for (const p of working) byId.set(p.id, p);
  const selSeams = Array.isArray(sel.seams) ? sel.seams : [];
  for (const seam of seams) {
    if (!seam) continue;
    let ease;
    try {
      ease = seamEase(doc, seam);
    } catch (_e) {
      ease = { lenA_mm: 0, lenB_mm: 0, easePct: 0, longer: null };
    }
    const color = seamColor(seam.id, ease.easePct > EASE_WARN_PCT);
    for (const side of [seam.a, seam.b]) {
      const piece = byId.get(side.pieceId);
      if (!piece) continue;
      const foldX = side.mirror === true ? foldXOf(piece) : null;
      if (side.mirror === true && foldX === null) continue;
      const pts = edgePolyline(piece, side.edge, foldX);
      if (pts.length < 2) continue;
      ctx.save();
      ctx.globalAlpha = STYLE.seamAlpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = STYLE.seamWidth;
      tracePolyline(ctx, view, pts, false);
      ctx.stroke();
      if (selSeams.indexOf(seam.id) >= 0) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        tracePolyline(ctx, view, pts, false);
        ctx.stroke();
      }
      const startPt = (side === seam.b && side.reverse === true) ? pts[pts.length - 1] : pts[0];
      const s = view.worldToScreen(startPt[0], startPt[1]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      dot(ctx, s[0], s[1], 5);
      ctx.restore();
    }
  }

  // ---- 4..6 notches, grainline, internal lines -----------------------------------------------------
  for (const piece of working) {
    if (!piece || piece.vertices.length < 3) continue;
    const n = piece.vertices.length;
    const foldX = foldXOf(piece);
    ctx.strokeStyle = STYLE.notch;
    ctx.lineWidth = 1.5;
    for (let k = 0; k < (piece.notches || []).length; k++) {
      const nt = piece.notches[k];
      if (!(nt.edge >= 0 && nt.edge < n)) continue;
      const p0 = piece.vertices[nt.edge];
      const p1 = piece.vertices[(nt.edge + 1) % n];
      const edge = piece.edges[nt.edge];
      const shifts = nt.kind === 'double' ? [-2, 2] : [0];
      const len = Math.max(1e-6, (function () {
        try {
          return Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        } catch (_e) {
          return 1;
        }
      }()));
      for (const shiftMm of shifts) {
        const tt = Math.min(0.999, Math.max(0.001, nt.t + shiftMm / Math.max(len, 1)));
        const base = pointAtArcFraction(p0, edge, p1, tt);
        const tan = tangentAtArcFraction(p0, edge, p1, tt);
        const nx = tan[1];
        const ny = -tan[0];
        for (const fx of (foldX !== null ? [null, foldX] : [null])) {
          const b = maybeMirror(base, fx);
          const tipWorld = maybeMirror([base[0] + nx * 5, base[1] + ny * 5], fx);
          const s0 = view.worldToScreen(b[0], b[1]);
          const s1 = view.worldToScreen(tipWorld[0], tipWorld[1]);
          ctx.beginPath();
          ctx.moveTo(s0[0], s0[1]);
          ctx.lineTo(s1[0], s1[1]);
          ctx.stroke();
        }
      }
    }

    const g = piece.grainline;
    if (g && g.a && g.b) {
      const a = view.worldToScreen(g.a[0], g.a[1]);
      const b = view.worldToScreen(g.b[0], g.b[1]);
      ctx.strokeStyle = STYLE.grainline;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const head = 8;
      const spread = Math.PI / 6;
      ctx.beginPath();
      ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] - head * Math.cos(ang - spread), b[1] - head * Math.sin(ang - spread));
      ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] - head * Math.cos(ang + spread), b[1] - head * Math.sin(ang + spread));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(a[0] - 6 * Math.cos(ang + Math.PI / 2), a[1] - 6 * Math.sin(ang + Math.PI / 2));
      ctx.lineTo(a[0] + 6 * Math.cos(ang + Math.PI / 2), a[1] + 6 * Math.sin(ang + Math.PI / 2));
      ctx.stroke();
    }

    for (const line of (piece.internalLines || [])) {
      if (!line || !Array.isArray(line.points) || line.points.length < 2) continue;
      ctx.save();
      if (line.kind === 'fold') {
        ctx.strokeStyle = STYLE.fold;
        ctx.setLineDash(/** @type {number[]} */ (STYLE.foldDash.slice()));
      } else if (line.kind === 'dart') {
        ctx.strokeStyle = STYLE.internalDart;
      } else {
        ctx.strokeStyle = STYLE.internalMark;
        ctx.setLineDash([4, 3]);
      }
      ctx.lineWidth = 1;
      tracePolyline(ctx, view, line.points, false);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---- 7. graded ghost -----------------------------------------------------------------------------
  const ghost = Array.isArray(u.ghost) ? u.ghost : null;
  if (ghost && ghost.length) {
    ctx.save();
    ctx.strokeStyle = STYLE.graded;
    ctx.lineWidth = 1;
    ctx.setLineDash(/** @type {number[]} */ (STYLE.gradedDash.slice()));
    for (const gp of ghost) {
      if (!gp || !Array.isArray(gp.vertices) || gp.vertices.length < 3) continue;
      tracePiece(ctx, view, gp, null);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- 8. hover ------------------------------------------------------------------------------------
  if (hover) {
    const piece = byId.get(hover.pieceId);
    if (piece) {
      const foldX = hover.mirror ? foldXOf(piece) : null;
      ctx.save();
      ctx.strokeStyle = STYLE.hover;
      if (hover.kind === 'vertex' && piece.vertices[hover.index]) {
        const s = view.worldToScreen(piece.vertices[hover.index][0], piece.vertices[hover.index][1]);
        ctx.lineWidth = 2;
        ring(ctx, s[0], s[1], 10);
      } else if (hover.kind === 'edge') {
        ctx.lineWidth = 4;
        traceEdge(ctx, view, piece, hover.index, foldX);
        ctx.stroke();
      } else if (hover.kind === 'piece') {
        ctx.lineWidth = 3;
        tracePiece(ctx, view, piece, foldX);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ---- 9. selection handles ------------------------------------------------------------------------
  for (const piece of working) {
    if (selPieces.indexOf(piece.id) < 0) continue;
    ctx.fillStyle = STYLE.handleFill;
    ctx.strokeStyle = STYLE.selection;
    ctx.lineWidth = 1;
    for (let i = 0; i < piece.vertices.length; i++) {
      const s = view.worldToScreen(piece.vertices[i][0], piece.vertices[i][1]);
      const isSel = sel.vertex && sel.vertex.pieceId === piece.id && sel.vertex.index === i;
      ctx.fillStyle = isSel ? STYLE.selection : STYLE.handleFill;
      ctx.fillRect(s[0] - 3.5, s[1] - 3.5, 7, 7);
      ctx.strokeRect(s[0] - 3.5, s[1] - 3.5, 7, 7);
    }
    if (sel.edge && sel.edge.pieceId === piece.id) {
      ctx.strokeStyle = STYLE.selection;
      ctx.lineWidth = 3;
      traceEdge(ctx, view, piece, sel.edge.edge, sel.edgeMirror ? foldXOf(piece) : null);
      ctx.stroke();
    }
    if (sel.notch && sel.notch.pieceId === piece.id) {
      const p = notchPoint(piece, sel.notch.index);
      if (p) {
        const s = view.worldToScreen(p[0], p[1]);
        ctx.strokeStyle = STYLE.selection;
        ctx.lineWidth = 2;
        ring(ctx, s[0], s[1], 7);
      }
    }
    // bezier handles
    const n = piece.vertices.length;
    /** @type {number[]} */
    const handleEdges = [];
    if (t.toolName === 'edit' && piece.id === primary) {
      for (let e = 0; e < n; e++) handleEdges.push(e);
    } else if (sel.vertex && sel.vertex.pieceId === piece.id) {
      handleEdges.push(sel.vertex.index % n, ((sel.vertex.index - 1) % n + n) % n);
    }
    for (const e of handleEdges) {
      const edge = piece.edges[e];
      if (!edge || edge.type !== 'cubic' || !edge.c1 || !edge.c2) continue;
      const v0 = view.worldToScreen(piece.vertices[e][0], piece.vertices[e][1]);
      const v1 = view.worldToScreen(piece.vertices[(e + 1) % n][0], piece.vertices[(e + 1) % n][1]);
      const c1 = view.worldToScreen(edge.c1[0], edge.c1[1]);
      const c2 = view.worldToScreen(edge.c2[0], edge.c2[1]);
      ctx.strokeStyle = STYLE.handleLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(v0[0], v0[1]);
      ctx.lineTo(c1[0], c1[1]);
      ctx.moveTo(v1[0], v1[1]);
      ctx.lineTo(c2[0], c2[1]);
      ctx.stroke();
      ctx.fillStyle = STYLE.handleFill;
      dot(ctx, c1[0], c1[1], 3);
      dot(ctx, c2[0], c2[1], 3);
    }
  }

  // ---- 10. tool overlay ----------------------------------------------------------------------------
  if (Array.isArray(t.drawPoints) && t.drawPoints.length) {
    ctx.save();
    ctx.strokeStyle = STYLE.selection;
    ctx.lineWidth = 1.5;
    tracePolyline(ctx, view, t.drawPoints, false);
    if (t.rubber) {
      const last = t.drawPoints[t.drawPoints.length - 1];
      const a = view.worldToScreen(last[0], last[1]);
      const b = view.worldToScreen(t.rubber[0], t.rubber[1]);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
    ctx.fillStyle = STYLE.handleFill;
    for (const p of t.drawPoints) {
      const s = view.worldToScreen(p[0], p[1]);
      ctx.fillRect(s[0] - 2.5, s[1] - 2.5, 5, 5);
    }
    if (t.drawPoints.length >= 3) {
      const s = view.worldToScreen(t.drawPoints[0][0], t.drawPoints[0][1]);
      ctx.strokeStyle = STYLE.selection;
      ctx.lineWidth = 2;
      ring(ctx, s[0], s[1], 10);
    }
    ctx.restore();
  }
  if (t.box) {
    ctx.save();
    ctx.fillStyle = STYLE.box;
    ctx.strokeStyle = STYLE.boxStroke;
    ctx.lineWidth = 1;
    const x = Math.min(t.box.x0, t.box.x1);
    const y = Math.min(t.box.y0, t.box.y1);
    const w = Math.abs(t.box.x1 - t.box.x0);
    const h = Math.abs(t.box.y1 - t.box.y0);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
  if (t.seamFirst) {
    const piece = byId.get(t.seamFirst.pieceId);
    if (piece) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 5;
      traceEdge(ctx, view, piece, t.seamFirst.edge, t.seamFirst.mirror ? foldXOf(piece) : null);
      ctx.stroke();
      ctx.restore();
    }
  }
  if (t.edgeMarker) {
    const piece = byId.get(t.edgeMarker.pieceId);
    if (piece && piece.vertices[t.edgeMarker.edge]) {
      const n = piece.vertices.length;
      const e = t.edgeMarker.edge;
      const p = pointAtArcFraction(piece.vertices[e], piece.edges[e], piece.vertices[(e + 1) % n], t.edgeMarker.t);
      const s = view.worldToScreen(p[0], p[1]);
      ctx.save();
      ctx.strokeStyle = STYLE.measure;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s[0] - 6, s[1]);
      ctx.lineTo(s[0] + 6, s[1]);
      ctx.moveTo(s[0], s[1] - 6);
      ctx.lineTo(s[0], s[1] + 6);
      ctx.stroke();
      ctx.restore();
    }
  }
  if (t.grainPreview && t.grainPreview.a && t.grainPreview.b) {
    const a = view.worldToScreen(t.grainPreview.a[0], t.grainPreview.a[1]);
    const b = view.worldToScreen(t.grainPreview.b[0], t.grainPreview.b[1]);
    ctx.save();
    ctx.strokeStyle = STYLE.grainline;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.restore();
  }
  if (t.measure && t.measure.a && t.measure.b) {
    const a = view.worldToScreen(t.measure.a[0], t.measure.a[1]);
    const b = view.worldToScreen(t.measure.b[0], t.measure.b[1]);
    ctx.save();
    ctx.strokeStyle = STYLE.measure;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    const text = t.measure.text || '';
    ctx.font = STYLE.labelFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(mx - w / 2, my - 10, w, 20);
    ctx.fillStyle = STYLE.measure;
    ctx.fillText(text, mx, my);
    ctx.restore();
  }

  // ---- 11. piece names -----------------------------------------------------------------------------
  ctx.font = STYLE.labelFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = STYLE.label;
  for (const piece of working) {
    if (!piece || piece.vertices.length < 3) continue;
    const box = bboxOf(piece.vertices);
    if ((box.maxX - box.minX) * v.pxPerMm <= 40) continue;
    const s = view.worldToScreen((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
    ctx.fillText(piece.name || piece.id, s[0], s[1]);
  }

  ctx.restore();
}
