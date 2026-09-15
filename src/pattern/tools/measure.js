// src/pattern/tools/measure.js — Measure tool (M), SPEC 11.10.8. No store writes.

import { edgeLengthOf } from '../seams.js';
import { flattenCache } from '../hit.js';
import { signedArea, bbox as bboxOf } from '../../geometry/index.js';

/** @typedef {import('../../core/types.js').Vec2} Vec2 */

/** @param {object} ctx @returns {object} Tool */
export function createMeasureTool(ctx) {
  /** @type {{a:Vec2, b:Vec2, text:string}|null} */
  let measure = null;
  /** @type {Vec2|null} */
  let anchor = null;
  let dragging = false;

  /** @param {Vec2} a @param {Vec2} b @returns {string} */
  function describe(a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    return len.toFixed(1) + ' mm  dx ' + dx.toFixed(1) + '  dy ' + dy.toFixed(1) + '  ' + ang.toFixed(1) + '°';
  }

  return {
    name: 'measure',

    cursor() {
      return 'crosshair';
    },

    onDown(e) {
      if (e.button !== 0) return;
      anchor = ctx.snap([e.x_mm, e.y_mm], { ctrl: e.ctrl });
      dragging = true;
      measure = { a: anchor, b: anchor, text: describe(anchor, anchor) };
    },

    onMove(e) {
      if (!dragging || !anchor) return;
      const b = ctx.snap([e.x_mm, e.y_mm], { ctrl: e.ctrl, shift: e.shift, anchor });
      const text = describe(anchor, b);
      measure = { a: anchor, b, text };
      ctx.status(text);
    },

    onUp(e) {
      dragging = false;
      if (!anchor) return;
      const moved = measure && Math.hypot(measure.b[0] - measure.a[0], measure.b[1] - measure.a[1]) > 0.5;
      if (moved) {
        ctx.status(measure.text);
        return;
      }
      const hit = e.hit;
      if (!hit) return;
      const piece = ctx.store.get().pieces.find((p) => p.id === hit.pieceId);
      if (!piece) return;
      if (hit.kind === 'edge') {
        const len = edgeLengthOf(piece, hit.index);
        ctx.status('edge ' + hit.index + ' of ' + piece.name + ': ' + len.toFixed(1) + ' mm'
          + (hit.mirror === true ? ' (mirrored)' : ''));
        return;
      }
      if (hit.kind === 'piece') {
        const pts = flattenCache(piece).points;
        const area = Math.abs(signedArea(pts)) / 100;
        const box = bboxOf(pts);
        ctx.status(piece.name + ': area ' + area.toFixed(1) + ' cm² · bbox '
          + (box.maxX - box.minX).toFixed(0) + ' × ' + (box.maxY - box.minY).toFixed(0) + ' mm');
      }
    },

    onDblClick() { /* no double-click behaviour */ },

    cancel() {
      if (!measure) return false;
      measure = null;
      anchor = null;
      dragging = false;
      return true;
    },

    confirm() { /* nothing to confirm */ },
    activate() {
      measure = null;
      anchor = null;
      dragging = false;
    },
    deactivate() {
      measure = null;
      anchor = null;
      dragging = false;
    },

    transient() {
      return measure ? { measure } : {};
    },
  };
}
