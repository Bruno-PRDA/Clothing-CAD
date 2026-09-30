// src/pattern/tools/dart.js — Dart tool (T), SPEC 11.10.10 (amendment "Darts"). States: IDLE, DRAG_APEX, DRAG_END, DRAG_MOUTH.
// Click an outline edge to add a dart there; drag its point, a mouth corner (width) or the mouth centre (slide). A drag
// that would make the dart invalid previews in the error colour and is not committed.

import { uid } from '../../core/ids.js';
import { checkDarts, edgeLength, pointAtArcFraction, tangentAtArcFraction, sampleEdge } from '../../geometry/index.js';
import { DRAG_THRESHOLD_PX } from '../editor.js';

/** @typedef {import('../../core/types.js').Vec2} Vec2 */
/** @typedef {import('../../core/types.js').Piece} Piece */
/** @typedef {import('../../core/types.js').Dart} Dart */

export const DART_DEFAULT_WIDTH_MM = 20;
export const DART_DEFAULT_LENGTH_MM = 80;
export const DART_MIN_LENGTH_MM = 20;

/** @param {Piece} piece @param {number} k @param {Dart} dart @returns {Piece} a copy with dart k replaced (or appended) */
function withDart(piece, k, dart) {
  const darts = (piece.darts || []).slice();
  darts[k] = dart;
  return /** @type {Piece} */ ({ ...piece, darts });
}

/**
 * The one rule for changing a dart (dragging, adding, and the Pieces panel's numeric edits): dart k of `before` becomes
 * `dart` (k = `before.darts.length` appends). Refused when the result leaves dart k invalid OR makes any other dart
 * invalid that was valid before (checkDarts blames the LATER dart of an overlapping or crossing pair, so testing dart k
 * alone would let a slide onto an earlier dart through). Darts that were already invalid elsewhere do not block it.
 * @param {Piece} before @param {number} k @param {Dart} dart @returns {boolean}
 */
export function acceptsDartEdit(before, k, dart) {
  const was = checkDarts(before).bad;
  const now = checkDarts(withDart(before, k, dart)).bad;
  if (now.has(k)) return false;
  for (const j of now) if (!was.has(j)) return false;
  return true;
}

/** Edge point at t and the inward normal there. @param {Piece} piece @param {number} e @param {number} t @returns {{p: Vec2, d: Vec2, nIn: Vec2}} */
function frameAt(piece, e, t) {
  const n = piece.vertices.length;
  const p0 = piece.vertices[e];
  const edge = piece.edges[e];
  const p1 = piece.vertices[(e + 1) % n];
  const p = pointAtArcFraction(p0, edge, p1, t);
  const d = tangentAtArcFraction(p0, edge, p1, t);
  return { p, d, nIn: [-d[1], d[0]] };
}

/** Arc-length fraction of the point of edge e nearest to q (1/400 of the edge resolution). @param {Piece} piece @param {number} e @param {Vec2} q @returns {number} */
export function nearestT(piece, e, q) {
  const pts = sampleEdge(piece, e, 400);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - q[0], pts[i][1] - q[1]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best / (pts.length - 1);
}

/**
 * The first valid dart centred at t on edge e: 20 mm wide and 80 mm long, shortened in 10 mm steps to 20 mm, then half
 * as wide once; null when nothing fits.
 * @param {Piece} piece @param {number} e @param {number} t @returns {Dart|null}
 */
export function proposeDart(piece, e, t) {
  const k = (piece.darts || []).length;
  const id = uid('dart');
  const { p, nIn } = frameAt(piece, e, t);
  for (const width of [DART_DEFAULT_WIDTH_MM, DART_DEFAULT_WIDTH_MM / 2]) {
    for (let len = DART_DEFAULT_LENGTH_MM; len >= DART_MIN_LENGTH_MM; len -= 10) {
      /** @type {Dart} */
      const dart = { id, edge: e, t, width_mm: width, apex: [p[0] + nIn[0] * len, p[1] + nIn[1] * len] };
      if (acceptsDartEdit(piece, k, dart)) return dart;
    }
  }
  return null;
}

/**
 * The dart after a drag to pattern point q: the point follows q; a corner sets the width symmetrically; the mouth
 * centre slides the dart along its edge, its point moving with it.
 * @param {Piece} piece @param {Dart} dt @param {string} state @param {Vec2} q @returns {Dart}
 */
function movedDart(piece, dt, state, q) {
  if (state === 'DRAG_APEX') return { ...dt, apex: [q[0], q[1]] };
  const t = nearestT(piece, dt.edge, q);
  if (state === 'DRAG_END') {
    const w = 2 * Math.abs(t - dt.t) * edgeLength(piece, dt.edge);
    return { ...dt, width_mm: Math.max(1, Math.round(w * 10) / 10) };
  }
  const from = frameAt(piece, dt.edge, dt.t).p;
  const to = frameAt(piece, dt.edge, t).p;
  return { ...dt, t, apex: [dt.apex[0] + to[0] - from[0], dt.apex[1] + to[1] - from[1]] };
}

/** @param {object} ctx @returns {object} Tool */
export function createDartTool(ctx) {
  let state = 'IDLE';
  /** @type {{pieceId:string, index:number, x0:number, y0:number}|null} */
  let drag = null;
  /** @type {{pieceId:string, index:number, dart:Dart, ok:boolean}|null} */
  let preview = null;
  /** @type {{pieceId:string, edge:number, t:number}|null} */
  let marker = null;

  function reset() {
    state = 'IDLE';
    drag = null;
    preview = null;
  }

  /** @param {string} id @returns {Piece|null} */
  function pieceOf(id) {
    return ctx.store.get().pieces.find((/** @type {Piece} */ p) => p.id === id) || null;
  }

  /** @param {any} hit @returns {boolean} */
  const isHandle = (hit) => !!hit && (hit.kind === 'dartApex' || hit.kind === 'dartEnd' || hit.kind === 'dartMouth');

  return {
    name: 'dart',

    cursor(hit) {
      if (isHandle(hit)) return 'move';
      if (hit && hit.kind === 'edge' && hit.mirror !== true) return 'crosshair';
      return 'default';
    },

    onDown(e) {
      if (e.button !== 0) return;
      const hit = e.hit;
      if (!hit) return;
      if (isHandle(hit)) {
        ctx.editor.select({ pieces: [hit.pieceId], dart: { pieceId: hit.pieceId, index: hit.index }, notch: null, vertex: null, edge: null });
        state = hit.kind === 'dartApex' ? 'DRAG_APEX' : (hit.kind === 'dartEnd' ? 'DRAG_END' : 'DRAG_MOUTH');
        drag = { pieceId: hit.pieceId, index: hit.index, x0: e.px, y0: e.py };
        return;
      }
      if (hit.kind !== 'edge' || hit.mirror === true) return;
      const piece = pieceOf(hit.pieceId);
      if (!piece) return;
      if (piece.foldEdge === hit.index) { ctx.status('No darts on the fold edge', 'warn'); return; }
      const dart = proposeDart(piece, hit.index, hit.t === undefined ? 0.5 : hit.t);
      if (!dart) { ctx.status('No room for a dart here', 'warn'); return; }
      let index = -1;
      ctx.commit('dart:add', (/** @type {any} */ d) => {
        const p = d.pieces.find((/** @type {Piece} */ x) => x.id === piece.id);
        if (!p) return;
        if (!Array.isArray(p.darts)) p.darts = [];
        p.darts.push(dart);
        index = p.darts.length - 1;
      });
      if (index >= 0) ctx.editor.select({ pieces: [piece.id], dart: { pieceId: piece.id, index }, notch: null, vertex: null, edge: null });
      marker = null;
    },

    onMove(e) {
      if (state !== 'IDLE' && drag) {
        if (!preview && Math.hypot(e.px - drag.x0, e.py - drag.y0) < DRAG_THRESHOLD_PX) return;
        const piece = pieceOf(drag.pieceId);
        const dt = piece && piece.darts ? piece.darts[drag.index] : null;
        if (!piece || !dt) return;
        const moved = movedDart(piece, dt, state, [e.x_mm, e.y_mm]);
        preview = { pieceId: drag.pieceId, index: drag.index, dart: moved, ok: acceptsDartEdit(piece, drag.index, moved) };
        return;
      }
      const hit = e.hit;
      marker = (hit && hit.kind === 'edge' && hit.mirror !== true)
        ? { pieceId: hit.pieceId, edge: hit.index, t: hit.t === undefined ? 0.5 : hit.t }
        : null;
    },

    onUp() {
      if (preview) {
        const { pieceId, index, dart, ok } = preview;
        if (ok) {
          ctx.commit('dart:move', (/** @type {any} */ d) => {
            const p = d.pieces.find((/** @type {Piece} */ x) => x.id === pieceId);
            if (p && p.darts && p.darts[index]) p.darts[index] = dart;
          });
        } else {
          ctx.status('That would make the dart invalid — it stays where it was', 'warn');
        }
      }
      reset();
    },

    onDblClick() { /* no double-click behaviour */ },

    onDelete() {
      const sel = ctx.getSelection();
      if (!sel.dart) return false;
      const { pieceId, index } = sel.dart;
      ctx.commit('dart:delete', (/** @type {any} */ d) => {
        const p = d.pieces.find((/** @type {Piece} */ x) => x.id === pieceId);
        if (p && p.darts && p.darts[index]) p.darts.splice(index, 1);
      });
      ctx.editor.select({ dart: null });
      return true;
    },

    cancel() {
      if (state === 'IDLE' && !marker) return false;
      reset();
      marker = null;
      return true;
    },

    confirm() { /* nothing to confirm */ },
    activate() { reset(); marker = null; },
    deactivate() { reset(); marker = null; },

    transient() {
      /** @type {any} */
      const t = {};
      if (marker && state === 'IDLE') t.edgeMarker = marker;
      if (preview) t.dartOverride = preview;
      return t;
    },
  };
}
