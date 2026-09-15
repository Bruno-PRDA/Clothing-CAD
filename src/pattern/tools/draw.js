// src/pattern/tools/draw.js — Draw tool (P), SPEC 11.10.2. States: IDLE, PLACING.

import { makeCcw } from '../editor.js';
import { signedArea, isSimplePolygon } from '../../geometry/index.js';

/** @typedef {import('../../core/types.js').Vec2} Vec2 */

/** Minimum area of a drawn piece, mm². */
export const MIN_AREA_MM2 = 100;
/** Click radius for closing on the first point, CSS px. */
export const CLOSE_TOL_PX = 8;

/** @param {object} ctx @returns {object} Tool */
export function createDrawTool(ctx) {
  let state = 'IDLE';
  /** @type {Vec2[]} */
  let points = [];
  /** @type {Vec2|null} */
  let rubber = null;

  function reset() {
    state = 'IDLE';
    points = [];
    rubber = null;
  }

  /** @param {object} e @returns {Vec2} */
  function snapped(e) {
    const anchor = points.length ? points[points.length - 1] : null;
    return ctx.snap([e.x_mm, e.y_mm], { ctrl: e.ctrl, shift: e.shift, anchor });
  }

  /** @returns {boolean} true when the piece was created */
  function close() {
    if (points.length < 3) {
      ctx.status('Need at least 3 points', 'warn');
      return false;
    }
    const made = makeCcw(points.map((p) => /** @type {Vec2} */ ([p[0], p[1]])), points.map(() => ({ type: 'line' })));
    if (Math.abs(signedArea(made.vertices)) < MIN_AREA_MM2) {
      ctx.status('The outline is too small (min 1 cm²)', 'warn');
      return false;
    }
    if (!isSimplePolygon(made.vertices)) {
      ctx.status('The outline crosses itself', 'warn');
      return false;
    }
    let id;
    try {
      id = ctx.editor.addPiece(made.vertices);
    } catch (err) {
      ctx.status(err && err.message ? err.message : 'Could not create the piece', 'warn');
      return false;
    }
    reset();
    ctx.editor.select({ pieces: [id], vertex: null, edge: null, notch: null, seamId: null });
    ctx.status('Piece created');
    return true;
  }

  return {
    name: 'draw',

    cursor() {
      return 'crosshair';
    },

    onDown(e) {
      if (e.button !== 0) return;
      const p = snapped(e);
      if (state === 'IDLE') {
        points = [p];
        state = 'PLACING';
        rubber = p;
        return;
      }
      if (points.length >= 3) {
        const s0 = ctx.view.worldToScreen(points[0][0], points[0][1]);
        if (Math.hypot(s0[0] - e.px, s0[1] - e.py) <= CLOSE_TOL_PX) {
          close();
          return;
        }
      }
      const last = points[points.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.5) return;
      points.push(p);
    },

    onMove(e) {
      if (state !== 'PLACING') return;
      rubber = snapped(e);
    },

    onUp() { /* the draw tool works on clicks only */ },

    onDblClick() {
      if (state === 'PLACING') close();
    },

    confirm() {
      if (state === 'PLACING') close();
    },

    onDelete() {
      if (state !== 'PLACING') return false;
      points.pop();
      if (points.length === 0) reset();
      return true;
    },

    cancel() {
      if (state !== 'PLACING') return false;
      reset();
      return true;
    },

    activate() {
      reset();
    },
    deactivate() {
      reset();
    },

    transient() {
      if (state !== 'PLACING') return {};
      /** @type {any} */
      const t = { drawPoints: points };
      if (rubber) t.rubber = rubber;
      return t;
    },
  };
}
