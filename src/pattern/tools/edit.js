// src/pattern/tools/edit.js — Edit points tool (E), SPEC 11.10.3. States: IDLE, DRAG_VERTEX, DRAG_HANDLE.

import { opInsertVertex, opDeleteVertex, DRAG_THRESHOLD_PX } from '../editor.js';
import { remapAfterEdgeChange } from '../seams.js';

/** @typedef {import('../../core/types.js').Vec2} Vec2 */
/** @typedef {import('../../core/types.js').Piece} Piece */

/**
 * Move vertex `i` of `piece` to `pos`, dragging the attached cubic control points along.
 * @param {Piece} piece @param {number} i @param {Vec2} pos
 */
function moveVertex(piece, i, pos) {
  const n = piece.vertices.length;
  const old = piece.vertices[i];
  const dx = pos[0] - old[0];
  const dy = pos[1] - old[1];
  piece.vertices[i] = [pos[0], pos[1]];
  const next = piece.edges[i];
  if (next && next.type === 'cubic' && next.c1) next.c1 = [next.c1[0] + dx, next.c1[1] + dy];
  const prev = piece.edges[(i - 1 + n) % n];
  if (prev && prev.type === 'cubic' && prev.c2) prev.c2 = [prev.c2[0] + dx, prev.c2[1] + dy];
}

/** @param {object} ctx @returns {object} Tool */
export function createEditTool(ctx) {
  let state = 'IDLE';
  /** @type {any} */
  let drag = null;
  /** @type {any} */
  let vertexOverride = null;
  /** @type {any} */
  let handleOverride = null;

  function reset() {
    state = 'IDLE';
    drag = null;
    vertexOverride = null;
    handleOverride = null;
  }

  /** @param {string} id @returns {Piece|null} */
  function pieceOf(id) {
    return ctx.store.get().pieces.find((p) => p.id === id) || null;
  }

  return {
    name: 'edit',

    cursor(hit) {
      if (!hit) return 'default';
      if (hit.kind === 'vertex' || hit.kind === 'handle') return 'grab';
      if (hit.kind === 'edge') return 'copy';
      return 'default';
    },

    onDown(e) {
      if (e.button !== 0) return;
      const hit = e.hit;
      if (!hit) return;
      if (hit.kind === 'vertex') {
        ctx.editor.select({ pieces: [hit.pieceId], vertex: hit.index, edge: null, notch: null });
        const piece = pieceOf(hit.pieceId);
        state = 'DRAG_VERTEX';
        drag = { pieceId: hit.pieceId, index: hit.index, start: piece ? piece.vertices[hit.index].slice() : [0, 0], x0: e.px, y0: e.py };
        return;
      }
      if (hit.kind === 'handle') {
        state = 'DRAG_HANDLE';
        drag = { pieceId: hit.pieceId, edge: hit.index, which: hit.which, x0: e.px, y0: e.py };
        return;
      }
      if (hit.kind === 'edge') {
        if (e.alt) {
          const pieceId = hit.pieceId;
          const edge = hit.index;
          const t = hit.t === undefined ? 0.5 : hit.t;
          try {
            ctx.commit('vertex:insert', (d) => {
              const i = d.pieces.findIndex((p) => p.id === pieceId);
              if (i < 0) return;
              const res = opInsertVertex(d.pieces[i], edge, t);
              remapAfterEdgeChange(d, pieceId, res.map);
              d.pieces[i] = res.piece;
            });
            ctx.editor.select({ pieces: [pieceId], vertex: edge + 1, edge: null, notch: null });
          } catch (err) {
            ctx.status(err && err.message ? err.message : 'Could not insert a vertex', 'warn');
          }
          return;
        }
        ctx.editor.select({ pieces: [hit.pieceId], edge: hit.index, edgeMirror: hit.mirror === true, vertex: null, notch: null });
        return;
      }
      if (hit.kind === 'piece') {
        ctx.editor.select({ pieces: [hit.pieceId], vertex: null, edge: null, notch: null });
      }
    },

    onMove(e) {
      if (state === 'DRAG_VERTEX' && drag) {
        if (Math.hypot(e.px - drag.x0, e.py - drag.y0) < DRAG_THRESHOLD_PX && !vertexOverride) return;
        const pos = ctx.snap([e.x_mm, e.y_mm], { ctrl: e.ctrl });
        vertexOverride = { pieceId: drag.pieceId, index: drag.index, pos };
        return;
      }
      if (state === 'DRAG_HANDLE' && drag) {
        handleOverride = { pieceId: drag.pieceId, edge: drag.edge, which: drag.which, pos: [e.x_mm, e.y_mm], shift: !!e.shift };
      }
    },

    onUp() {
      if (state === 'DRAG_VERTEX' && drag && vertexOverride) {
        const { pieceId, index } = drag;
        const pos = vertexOverride.pos;
        if (Math.hypot(pos[0] - drag.start[0], pos[1] - drag.start[1]) > 1e-9) {
          ctx.commit('vertex:move', (d) => {
            const piece = d.pieces.find((p) => p.id === pieceId);
            if (piece) moveVertex(piece, index, pos);
          });
        }
      } else if (state === 'DRAG_HANDLE' && drag && handleOverride) {
        const { pieceId, edge, which } = drag;
        const pos = handleOverride.pos;
        const withShift = handleOverride.shift;
        ctx.commit('handle:move', (d) => {
          const piece = d.pieces.find((p) => p.id === pieceId);
          if (!piece) return;
          const ed = piece.edges[edge];
          if (!ed || ed.type !== 'cubic') return;
          ed[which] = [pos[0], pos[1]];
          if (withShift) {
            const n = piece.vertices.length;
            // the shared vertex of this handle and the opposite one
            const vIndex = which === 'c1' ? edge : (edge + 1) % n;
            const oppEdge = which === 'c1' ? (edge - 1 + n) % n : (edge + 1) % n;
            const oppWhich = which === 'c1' ? 'c2' : 'c1';
            const opp = piece.edges[oppEdge];
            if (opp && opp.type === 'cubic' && opp[oppWhich]) {
              const v = piece.vertices[vIndex];
              const dx = pos[0] - v[0];
              const dy = pos[1] - v[1];
              const len = Math.hypot(dx, dy);
              const oldLen = Math.hypot(opp[oppWhich][0] - v[0], opp[oppWhich][1] - v[1]);
              if (len > 1e-9) opp[oppWhich] = [v[0] - (dx / len) * oldLen, v[1] - (dy / len) * oldLen];
            }
          }
        });
      }
      reset();
    },

    onDblClick(e) {
      const hit = e.hit;
      if (!hit || hit.kind !== 'edge') return;
      const pieceId = hit.pieceId;
      const edge = hit.index;
      const piece = pieceOf(pieceId);
      if (!piece) return;
      if (piece.foldEdge === edge) {
        ctx.status('The fold edge must stay straight', 'warn');
        return;
      }
      ctx.commit('edge:type', (d) => {
        const p = d.pieces.find((x) => x.id === pieceId);
        if (!p) return;
        const n = p.vertices.length;
        const ed = p.edges[edge];
        const p0 = p.vertices[edge];
        const p1 = p.vertices[(edge + 1) % n];
        if (ed.type === 'line') {
          ed.type = 'cubic';
          ed.c1 = [p0[0] + (p1[0] - p0[0]) / 3, p0[1] + (p1[1] - p0[1]) / 3];
          ed.c2 = [p0[0] + (2 * (p1[0] - p0[0])) / 3, p0[1] + (2 * (p1[1] - p0[1])) / 3];
        } else {
          ed.type = 'line';
          delete ed.c1;
          delete ed.c2;
        }
      });
    },

    onDelete() {
      const sel = ctx.getSelection();
      if (sel.vertex) {
        const { pieceId, index } = sel.vertex;
        try {
          ctx.commit('vertex:delete', (d) => {
            const i = d.pieces.findIndex((p) => p.id === pieceId);
            if (i < 0) return;
            const res = opDeleteVertex(d.pieces[i], index);
            remapAfterEdgeChange(d, pieceId, res.map);
            d.pieces[i] = res.piece;
          });
          ctx.editor.select({ vertex: null });
        } catch (err) {
          ctx.status(err && err.code === 'PATTERN_MIN_VERTICES' ? 'A piece needs at least 3 vertices'
            : (err && err.message ? err.message : 'Could not delete the vertex'), 'warn');
        }
        return true;
      }
      if (sel.notch) {
        const { pieceId, index } = sel.notch;
        ctx.commit('notch:delete', (d) => {
          const p = d.pieces.find((x) => x.id === pieceId);
          if (p) p.notches.splice(index, 1);
        });
        ctx.editor.select({ notch: null });
        return true;
      }
      return false;
    },

    /** @param {number} dx @param {number} dy @returns {boolean} */
    nudge(dx, dy) {
      const sel = ctx.getSelection();
      if (!sel.vertex) return false;
      const { pieceId, index } = sel.vertex;
      const piece = pieceOf(pieceId);
      if (!piece) return false;
      const pos = [piece.vertices[index][0] + dx, piece.vertices[index][1] + dy];
      ctx.commit('vertex:move', (d) => {
        const p = d.pieces.find((x) => x.id === pieceId);
        if (p) moveVertex(p, index, /** @type {Vec2} */ (pos));
      });
      return true;
    },

    cancel() {
      if (state === 'IDLE') return false;
      reset();
      return true;
    },

    confirm() { /* nothing to confirm */ },
    activate() {
      reset();
    },
    deactivate() {
      reset();
    },

    transient() {
      /** @type {any} */
      const t = {};
      if (vertexOverride) t.vertexOverride = vertexOverride;
      if (handleOverride) t.handleOverride = handleOverride;
      return t;
    },
  };
}
