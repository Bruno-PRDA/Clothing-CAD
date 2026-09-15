// src/pattern/tools/split.js — Split edge tool (X), SPEC 11.10.4.

import { opSplitEdge } from '../editor.js';
import { remapAfterEdgeChange } from '../seams.js';

/** @param {object} ctx @returns {object} Tool */
export function createSplitTool(ctx) {
  /** @type {{pieceId:string, edge:number, t:number}|null} */
  let marker = null;

  /** @param {object|null} hit @returns {boolean} */
  function splittable(hit) {
    if (!hit || hit.kind !== 'edge') return false;
    const piece = ctx.store.get().pieces.find((p) => p.id === hit.pieceId);
    if (!piece) return false;
    return piece.foldEdge !== hit.index;
  }

  return {
    name: 'split',

    cursor(hit) {
      if (!hit || hit.kind !== 'edge') return 'default';
      return splittable(hit) ? 'crosshair' : 'not-allowed';
    },

    onDown(e) {
      if (e.button !== 0) return;
      const hit = e.hit;
      if (!hit || hit.kind !== 'edge') return;
      if (!splittable(hit)) {
        ctx.status('The fold edge cannot be split', 'warn');
        return;
      }
      const pieceId = hit.pieceId;
      const edge = hit.index;
      const t = Math.min(0.98, Math.max(0.02, hit.t === undefined ? 0.5 : hit.t));
      let removed = 0;
      try {
        ctx.commit('piece:splitEdge', (d) => {
          const i = d.pieces.findIndex((p) => p.id === pieceId);
          if (i < 0) return;
          const res = opSplitEdge(d.pieces[i], edge, t);
          const before = d.seams.length;
          d.seams = d.seams.filter((s) => !((s.a.pieceId === pieceId && s.a.edge === edge)
            || (s.b.pieceId === pieceId && s.b.edge === edge)));
          removed = before - d.seams.length;
          remapAfterEdgeChange(d, pieceId, res.map);
          d.pieces[i] = res.piece;
        });
      } catch (err) {
        ctx.status(err && err.message ? err.message : 'Could not split the edge', 'warn');
        return;
      }
      if (removed > 0) ctx.status('Seam removed by split (re-create it on the half you need)', 'warn');
      ctx.editor.select({ pieces: [pieceId], vertex: edge + 1, edge: null, notch: null });
      marker = null;
    },

    onMove(e) {
      const hit = e.hit;
      marker = splittable(hit) ? { pieceId: hit.pieceId, edge: hit.index, t: hit.t === undefined ? 0.5 : hit.t } : null;
    },

    onUp() { /* the split happens on pointer-down */ },
    onDblClick() { /* no double-click behaviour */ },

    cancel() {
      if (!marker) return false;
      marker = null;
      return true;
    },

    confirm() { /* nothing to confirm */ },
    activate() {
      marker = null;
    },
    deactivate() {
      marker = null;
    },

    transient() {
      return marker ? { edgeMarker: marker } : {};
    },
  };
}
