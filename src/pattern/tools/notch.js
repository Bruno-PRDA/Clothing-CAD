// src/pattern/tools/notch.js — Notch tool (N), SPEC 11.10.6. States: IDLE, DRAG_NOTCH.

import { DRAG_THRESHOLD_PX } from '../editor.js';

/** @param {object} ctx @returns {object} Tool */
export function createNotchTool(ctx) {
  let state = 'IDLE';
  /** @type {{pieceId:string, edge:number, t:number}|null} */
  let marker = null;
  /** @type {any} */
  let drag = null;
  /** @type {{pieceId:string, index:number, t:number}|null} */
  let notchOverride = null;

  function reset() {
    state = 'IDLE';
    drag = null;
    notchOverride = null;
  }

  /** @param {number} t @returns {number} */
  function clampT(t) {
    return Math.min(0.98, Math.max(0.02, t));
  }

  return {
    name: 'notch',

    cursor(hit) {
      if (hit && (hit.kind === 'edge' || hit.kind === 'notch')) return 'crosshair';
      return 'default';
    },

    onDown(e) {
      if (e.button !== 0) return;
      const hit = e.hit;
      if (!hit) return;
      if (hit.kind === 'notch') {
        ctx.editor.select({ pieces: [hit.pieceId], notch: hit.index, vertex: null, edge: null });
        state = 'DRAG_NOTCH';
        drag = { pieceId: hit.pieceId, index: hit.index, x0: e.px, y0: e.py };
        return;
      }
      if (hit.kind !== 'edge' || hit.mirror === true) return;
      const pieceId = hit.pieceId;
      const edge = hit.index;
      const t = clampT(hit.t === undefined ? 0.5 : hit.t);
      const kind = e.shift ? 'double' : 'single';
      let index = -1;
      ctx.commit('notch:add', (d) => {
        const p = d.pieces.find((x) => x.id === pieceId);
        if (!p) return;
        p.notches.push({ edge, t, kind });
        index = p.notches.length - 1;
      });
      if (index >= 0) ctx.editor.select({ pieces: [pieceId], notch: index, vertex: null, edge: null });
      marker = null;
    },

    onMove(e) {
      if (state === 'DRAG_NOTCH' && drag) {
        if (Math.hypot(e.px - drag.x0, e.py - drag.y0) < DRAG_THRESHOLD_PX && !notchOverride) return;
        const hit = e.hit;
        const piece = ctx.store.get().pieces.find((p) => p.id === drag.pieceId);
        if (!piece) return;
        const nt = piece.notches[drag.index];
        if (!nt) return;
        if (hit && hit.kind === 'edge' && hit.pieceId === drag.pieceId && hit.index === nt.edge) {
          notchOverride = { pieceId: drag.pieceId, index: drag.index, t: clampT(hit.t) };
        }
        return;
      }
      const hit = e.hit;
      marker = (hit && hit.kind === 'edge' && hit.mirror !== true)
        ? { pieceId: hit.pieceId, edge: hit.index, t: hit.t === undefined ? 0.5 : hit.t }
        : null;
    },

    onUp() {
      if (state === 'DRAG_NOTCH' && drag && notchOverride) {
        const { pieceId, index } = drag;
        const t = notchOverride.t;
        ctx.commit('notch:move', (d) => {
          const p = d.pieces.find((x) => x.id === pieceId);
          if (p && p.notches[index]) p.notches[index].t = t;
        });
      }
      reset();
    },

    onDblClick(e) {
      const hit = e.hit;
      if (!hit || hit.kind !== 'notch') return;
      const pieceId = hit.pieceId;
      const index = hit.index;
      ctx.commit('notch:kind', (d) => {
        const p = d.pieces.find((x) => x.id === pieceId);
        if (p && p.notches[index]) p.notches[index].kind = p.notches[index].kind === 'double' ? 'single' : 'double';
      });
    },

    onDelete() {
      const sel = ctx.getSelection();
      if (!sel.notch) return false;
      const { pieceId, index } = sel.notch;
      ctx.commit('notch:delete', (d) => {
        const p = d.pieces.find((x) => x.id === pieceId);
        if (p && p.notches[index]) p.notches.splice(index, 1);
      });
      ctx.editor.select({ notch: null });
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
      marker = null;
    },
    deactivate() {
      reset();
      marker = null;
    },

    transient() {
      /** @type {any} */
      const t = {};
      if (marker && state === 'IDLE') t.edgeMarker = marker;
      if (notchOverride) t.notchOverride = notchOverride;
      return t;
    },
  };
}
