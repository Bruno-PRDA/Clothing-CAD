// src/pattern/tools/grainline.js — Grainline tool (G), SPEC 11.10.7. States: IDLE, DRAG_NEW, DRAG_END.

/** @typedef {import('../../core/types.js').Vec2} Vec2 */

/** Minimum grainline length created by a drag, mm. */
export const MIN_GRAINLINE_MM = 5;

/** @param {object} ctx @returns {object} Tool */
export function createGrainlineTool(ctx) {
  let state = 'IDLE';
  /** @type {any} */
  let drag = null;
  /** @type {{pieceId:string, a:Vec2, b:Vec2}|null} */
  let preview = null;

  function reset() {
    state = 'IDLE';
    drag = null;
    preview = null;
  }

  return {
    name: 'grainline',

    cursor(hit) {
      if (hit && hit.kind === 'grainline') return 'grab';
      if (hit) return 'crosshair';
      return 'default';
    },

    onDown(e) {
      if (e.button !== 0) return;
      const hit = e.hit;
      if (!hit) return;
      const piece = ctx.store.get().pieces.find((p) => p.id === hit.pieceId);
      if (!piece) return;
      if (hit.kind === 'grainline') {
        state = 'DRAG_END';
        drag = { pieceId: hit.pieceId, which: hit.which, other: hit.which === 'a' ? piece.grainline.b : piece.grainline.a };
        preview = { pieceId: hit.pieceId, a: piece.grainline.a, b: piece.grainline.b };
        return;
      }
      ctx.editor.select({ pieces: [hit.pieceId], vertex: null, edge: null, notch: null });
      const a = ctx.snap([e.x_mm, e.y_mm], { ctrl: e.ctrl });
      state = 'DRAG_NEW';
      drag = { pieceId: hit.pieceId, a };
      preview = { pieceId: hit.pieceId, a, b: a };
    },

    onMove(e) {
      if (state === 'DRAG_NEW' && drag) {
        const b = ctx.snap([e.x_mm, e.y_mm], { ctrl: e.ctrl, shift: e.shift, anchor: drag.a });
        preview = { pieceId: drag.pieceId, a: drag.a, b };
        return;
      }
      if (state === 'DRAG_END' && drag) {
        const p = ctx.snap([e.x_mm, e.y_mm], { ctrl: e.ctrl, shift: e.shift, anchor: drag.other });
        preview = drag.which === 'a'
          ? { pieceId: drag.pieceId, a: p, b: drag.other }
          : { pieceId: drag.pieceId, a: drag.other, b: p };
      }
    },

    onUp() {
      if (!drag || !preview) {
        reset();
        return;
      }
      const { pieceId } = drag;
      const a = [preview.a[0], preview.a[1]];
      const b = [preview.b[0], preview.b[1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (state === 'DRAG_NEW' && len < MIN_GRAINLINE_MM) {
        reset();
        return;
      }
      if (len >= 1e-6) {
        ctx.commit('grainline:set', (d) => {
          const p = d.pieces.find((x) => x.id === pieceId);
          if (p) p.grainline = { a: [a[0], a[1]], b: [b[0], b[1]] };
        });
      }
      reset();
    },

    onDblClick() { /* no double-click behaviour */ },

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
      return preview ? { grainPreview: preview } : {};
    },
  };
}
