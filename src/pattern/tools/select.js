// src/pattern/tools/select.js — Select tool (V), SPEC 11.10.1. States: IDLE, PRESSED, DRAG_PIECE, BOX.

import { opTranslate, snapPoint, DRAG_THRESHOLD_PX } from '../editor.js';
import { seamOfEdge } from '../seams.js';
import { flattenCache } from '../hit.js';
import { bbox as bboxOf } from '../../geometry/index.js';

/** @typedef {import('../../core/types.js').Vec2} Vec2 */

/** @param {object} ctx @returns {object} Tool */
export function createSelectTool(ctx) {
  let state = 'IDLE';
  /** @type {any} */
  let press = null;
  /** @type {{pieceIds:string[], dx:number, dy:number}|null} */
  let dragOffset = null;
  /** @type {{x0:number,y0:number,x1:number,y1:number}|null} */
  let box = null;
  let boxShift = false;

  function reset() {
    state = 'IDLE';
    press = null;
    dragOffset = null;
    box = null;
  }

  /** @param {object} e @returns {Vec2} */
  function snapped(e) {
    return snapPoint([e.x_mm, e.y_mm], { ctrl: e.ctrl });
  }

  return {
    name: 'select',

    /** @param {object|null} hit @returns {string} */
    cursor(hit) {
      const sel = ctx.getSelection();
      if (hit && sel.pieces.indexOf(hit.pieceId) >= 0) return 'move';
      return 'default';
    },

    onDown(e) {
      if (e.button !== 0) return;
      const hit = e.hit;
      const doc = ctx.store.get();
      if (hit && (hit.kind === 'piece' || hit.kind === 'edge' || hit.kind === 'vertex' || hit.kind === 'notch')) {
        const P = hit.pieceId;
        const sel = ctx.getSelection();
        const seam = hit.kind === 'edge' ? seamOfEdge(doc, P, hit.index, hit.mirror === true) : null;
        const detail = {
          edge: hit.kind === 'edge' ? hit.index : null,
          edgeMirror: hit.mirror === true,
          vertex: hit.kind === 'vertex' ? hit.index : null,
          notch: hit.kind === 'notch' ? hit.index : null,
          seamId: seam ? seam.id : null,
        };
        if (e.shift) {
          const pieces = sel.pieces.slice();
          const at = pieces.indexOf(P);
          if (at >= 0) pieces.splice(at, 1);
          else pieces.push(P);
          ctx.editor.select({ pieces, ...detail });
        } else if (sel.pieces.indexOf(P) < 0) {
          ctx.editor.select({ pieces: [P], ...detail });
        } else {
          ctx.editor.select(detail);
        }
        state = 'PRESSED';
        press = { hit, x0: e.px, y0: e.py, w0: snapped(e) };
        return;
      }
      state = 'BOX';
      boxShift = !!e.shift;
      box = { x0: e.px, y0: e.py, x1: e.px, y1: e.py };
      press = { x0: e.px, y0: e.py };
    },

    onMove(e) {
      if (state === 'PRESSED') {
        if (Math.hypot(e.px - press.x0, e.py - press.y0) < DRAG_THRESHOLD_PX) return;
        const sel = ctx.getSelection();
        const ids = sel.pieces.length ? sel.pieces.slice() : [press.hit.pieceId];
        state = 'DRAG_PIECE';
        press.pieceIds = ids;
        dragOffset = { pieceIds: ids, dx: 0, dy: 0 };
      }
      if (state === 'DRAG_PIECE') {
        const w = snapped(e);
        let dx = w[0] - press.w0[0];
        let dy = w[1] - press.w0[1];
        if (e.shift) {
          if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        dragOffset = { pieceIds: press.pieceIds, dx, dy };
        return;
      }
      if (state === 'BOX' && box) {
        box.x1 = e.px;
        box.y1 = e.py;
      }
    },

    onUp(e) {
      if (state === 'DRAG_PIECE' && dragOffset && (dragOffset.dx || dragOffset.dy)) {
        const ids = dragOffset.pieceIds.slice();
        const dx = dragOffset.dx;
        const dy = dragOffset.dy;
        ctx.commit('piece:move', (d) => {
          for (let i = 0; i < d.pieces.length; i++) {
            if (ids.indexOf(d.pieces[i].id) >= 0) d.pieces[i] = opTranslate(d.pieces[i], dx, dy);
          }
        });
      } else if (state === 'BOX' && box) {
        const a = ctx.view.screenToWorld(box.x0, box.y0);
        const b = ctx.view.screenToWorld(box.x1, box.y1);
        const minX = Math.min(a[0], b[0]);
        const maxX = Math.max(a[0], b[0]);
        const minY = Math.min(a[1], b[1]);
        const maxY = Math.max(a[1], b[1]);
        const moved = Math.hypot(box.x1 - box.x0, box.y1 - box.y0) >= DRAG_THRESHOLD_PX;
        /** @type {string[]} */
        const inside = [];
        if (moved) {
          for (const piece of ctx.store.get().pieces) {
            const pb = bboxOf(flattenCache(piece).points);
            if (pb.maxX >= minX && pb.minX <= maxX && pb.maxY >= minY && pb.minY <= maxY) inside.push(piece.id);
          }
        }
        if (moved || !boxShift) {
          ctx.editor.select({ pieces: inside, vertex: null, edge: null, notch: null, seamId: null }, { additive: boxShift });
        }
      }
      void e;
      reset();
    },

    onDblClick(e) {
      if (e.hit && e.hit.pieceId) ctx.editor.setTool('edit');
    },

    onDelete() {
      const sel = ctx.getSelection();
      if (sel.seams.length && sel.edge) {
        const id = sel.seams[0];
        ctx.commit('seam:delete', (d) => {
          d.seams = d.seams.filter((s) => s.id !== id);
        });
        ctx.editor.select({ seams: [] });
        return true;
      }
      if (!sel.pieces.length) return true;
      const ids = sel.pieces.slice();
      ctx.commit('piece:delete', (d) => {
        d.pieces = d.pieces.filter((p) => ids.indexOf(p.id) < 0);
        d.seams = d.seams.filter((s) => ids.indexOf(s.a.pieceId) < 0 && ids.indexOf(s.b.pieceId) < 0);
      });
      ctx.editor.clearSelection();
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
      if (dragOffset && (dragOffset.dx || dragOffset.dy)) t.dragOffset = dragOffset;
      if (box && state === 'BOX') t.box = box;
      return t;
    },
  };
}
