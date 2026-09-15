// src/pattern/tools/seam.js — Seam tool (S), SPEC 11.10.5. States: IDLE, FIRST.

import { seamOfEdge, seamEase, seamEaseOf, formatEase, easeLevel, EASE_WARN_PCT } from '../seams.js';

/** @typedef {import('../../core/types.js').SeamSide} SeamSide */

/** @param {object} ctx @returns {object} Tool */
export function createSeamTool(ctx) {
  let state = 'IDLE';
  /** @type {{pieceId:string, edge:number, mirror:boolean}|null} */
  let first = null;

  /**
   * Candidate rule of SPEC 11.10.5.
   * @param {object|null} hit @returns {boolean}
   */
  function candidate(hit) {
    if (!hit || hit.kind !== 'edge') return false;
    const doc = ctx.store.get();
    const piece = doc.pieces.find((p) => p.id === hit.pieceId);
    if (!piece) return false;
    if (piece.foldEdge === hit.index) return false;
    if (hit.mirror === true && (piece.foldEdge === null || piece.foldEdge === undefined)) return false;
    return seamOfEdge(doc, hit.pieceId, hit.index, hit.mirror === true) === null;
  }

  /** @param {object} hit @returns {SeamSide} */
  function sideOf(hit) {
    return /** @type {SeamSide} */ ({ pieceId: hit.pieceId, edge: hit.index, mirror: hit.mirror === true, reverse: false });
  }

  function clearPreview() {
    ctx.setSeamEase(null);
  }

  return {
    name: 'seam',

    cursor(hit) {
      if (!hit || hit.kind !== 'edge') return 'default';
      return candidate(hit) ? 'crosshair' : 'not-allowed';
    },

    onDown(e) {
      if (e.button !== 0) return;
      const hit = e.hit;
      const doc = ctx.store.get();

      if (state === 'IDLE') {
        if (!hit || hit.kind !== 'edge') return;
        const existing = seamOfEdge(doc, hit.pieceId, hit.index, hit.mirror === true);
        if (existing) {
          const ease = seamEase(doc, existing);
          ctx.editor.select({ seams: [existing.id], pieces: [hit.pieceId], edge: hit.index, edgeMirror: hit.mirror === true });
          ctx.setSeamEase({
            a: existing.a,
            b: existing.b,
            lenA_mm: ease.lenA_mm,
            lenB_mm: ease.lenB_mm,
            easePct: ease.easePct,
            level: easeLevel(ease.easePct),
            seamId: existing.id,
          });
          ctx.status(formatEase(ease), ease.easePct > EASE_WARN_PCT ? 'warn' : 'info');
          return;
        }
        if (!candidate(hit)) {
          if (hit.kind === 'edge') ctx.status('That edge cannot be sewn', 'warn');
          return;
        }
        first = { pieceId: hit.pieceId, edge: hit.index, mirror: hit.mirror === true };
        state = 'FIRST';
        ctx.setSeamEase({
          a: /** @type {any} */ ({ ...first, reverse: false }),
          b: null,
          lenA_mm: 0,
          lenB_mm: 0,
          easePct: 0,
          level: 'ok',
          seamId: null,
        });
        ctx.status('Seam: click edge B');
        return;
      }

      // state === 'FIRST'
      if (!hit || hit.kind !== 'edge') return;
      if (first && hit.pieceId === first.pieceId && hit.index === first.edge && (hit.mirror === true) === first.mirror) return;
      if (!candidate(hit)) {
        ctx.status('That edge is already sewn or is the fold edge', 'warn');
        return;
      }
      const a = /** @type {SeamSide} */ ({ ...first, reverse: false });
      const b = sideOf(hit);
      let id;
      try {
        id = ctx.editor.addSeam(a, b);
      } catch (err) {
        ctx.status(err && err.message ? err.message : 'Could not create the seam', 'warn');
        return;
      }
      const doc2 = ctx.store.get();
      const seam = doc2.seams.find((s) => s.id === id);
      const ease = seamEase(doc2, seam);
      state = 'IDLE';
      first = null;
      ctx.editor.select({ seams: [id] });
      ctx.setSeamEase({
        a: seam.a,
        b: seam.b,
        lenA_mm: ease.lenA_mm,
        lenB_mm: ease.lenB_mm,
        easePct: ease.easePct,
        level: easeLevel(ease.easePct),
        seamId: id,
      });
      ctx.status('Seam created: ' + formatEase(ease), ease.easePct > EASE_WARN_PCT ? 'warn' : 'info');
    },

    onMove(e) {
      if (state !== 'FIRST' || !first) return;
      const hit = e.hit;
      const same = hit && hit.kind === 'edge' && hit.pieceId === first.pieceId && hit.index === first.edge
        && (hit.mirror === true) === first.mirror;
      const a = /** @type {SeamSide} */ ({ ...first, reverse: false });
      if (!same && candidate(hit)) {
        const b = sideOf(hit);
        const ease = seamEaseOf(ctx.store.get(), a, b);
        ctx.setSeamEase({
          a,
          b,
          lenA_mm: ease.lenA_mm,
          lenB_mm: ease.lenB_mm,
          easePct: ease.easePct,
          level: easeLevel(ease.easePct),
          seamId: null,
        });
        return;
      }
      ctx.setSeamEase({ a, b: null, lenA_mm: 0, lenB_mm: 0, easePct: 0, level: 'ok', seamId: null });
    },

    onUp() { /* seams are made with clicks */ },
    onDblClick() { /* no double-click behaviour */ },

    onDelete() {
      const sel = ctx.getSelection();
      if (!sel.seams.length) return false;
      const id = sel.seams[0];
      ctx.commit('seam:delete', (d) => {
        d.seams = d.seams.filter((s) => s.id !== id);
      });
      ctx.editor.select({ seams: [] });
      clearPreview();
      return true;
    },

    cancel() {
      if (state !== 'FIRST') return false;
      state = 'IDLE';
      first = null;
      clearPreview();
      return true;
    },

    confirm() { /* nothing to confirm */ },

    activate() {
      state = 'IDLE';
      first = null;
    },

    deactivate() {
      state = 'IDLE';
      first = null;
      clearPreview();
    },

    transient() {
      return first ? { seamFirst: { pieceId: first.pieceId, edge: first.edge, mirror: first.mirror } } : {};
    },
  };
}
