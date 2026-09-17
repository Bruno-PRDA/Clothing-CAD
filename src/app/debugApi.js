// src/app/debugApi.js — window.__app, the automation/debug surface (SPEC section 12.3).
// Installed by src/app/main.js BEFORE any boot stage, so `await __app.ready` works even when a stage fails.
//
// Rules obeyed here (12.3 "General semantics"):
//  * synchronous unless marked async; every synchronous mutator calls wiring.flush() before returning;
//  * arguments are validated BEFORE any mutation — a throw leaves the document byte-identical;
//  * every mutator commits at most ONE undoable store.update / store.replace, so __app.undo() always works;
//  * returned documents/pieces/params are deep copies; "live" objects are marked in the JSDoc;
//  * nothing here alerts, opens a window or downloads; export functions return strings;
//  * never imports three (directly or transitively): viewer3d is reached only through ctx.mods.viewer.

import { EVENT } from '../core/events.js';
import { normalizeDoc, serializeDoc, validateShape } from '../core/schema.js';
import { uid } from '../core/ids.js';
import {
  FABRIC_PRESETS, TEXTURE_KINDS, PHYSICS_KEYS, getPreset, hasPreset, isHexColor, resolveFabric,
} from '../core/fabrics.js';
import { getSample } from '../samples/index.js';
import * as patternMod from '../pattern/index.js';
import * as bodyMod from '../body/index.js';
import * as clothMod from '../cloth/index.js';
import * as sizingMod from '../sizing/index.js';
import * as exportMod from '../export/index.js';
import { ALL_IDS } from '../ui/ids.js';

/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */
/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').Seam} Seam */
/** @typedef {import('../core/types.js').Vec2} Vec2 */
/** @typedef {import('../core/types.js').Vec3} Vec3 */
/** @typedef {import('../core/types.js').PieceMesh} PieceMesh */
/** @typedef {import('../core/types.js').ClothState} ClothState */
/** @typedef {import('../core/types.js').SimStats} SimStats */
/** @typedef {import('../core/types.js').BodyModel} BodyModel */
/** @typedef {import('../core/types.js').BodyParams} BodyParams */
/** @typedef {import('../core/types.js').Issue} Issue */

// ------------------------------------------------------------------ errors

/** Error thrown by every __app function on bad input or unavailable state. */
export class ApiError extends Error {
  /**
   * @param {string} code  one of ERROR_CODES
   * @param {string} message
   * @param {any} [detail]
   */
  constructor(code, message, detail) {
    super(message);
    this.name = 'ApiError';
    /** @type {string} */
    this.code = code;
    /** @type {any} */
    this.detail = detail;
  }
}

/** @type {ReadonlyArray<string>} */
/** How long idle() waits for an animation frame before giving up (a hidden tab never fires one). */
const IDLE_FRAME_TIMEOUT_MS = 50;

export const ERROR_CODES = Object.freeze([
  'E_NOT_READY', 'E_BAD_ARG', 'E_BAD_DOC', 'E_BAD_POLY', 'E_BAD_EDGE', 'E_SEAM_DUP',
  'E_NO_PIECE', 'E_NO_SEAM', 'E_NO_FABRIC', 'E_NO_PRESET', 'E_NO_SAMPLE', 'E_NO_SIZE', 'E_NO_ELEMENT',
  'E_NO_CLOTH', 'E_NO_BODY', 'E_EXPORT', 'E_SELFTEST',
]);

/** @param {string} code @param {string} message @param {any} [detail] @returns {ApiError} */
function fail(code, message, detail) {
  return new ApiError(code, message, detail);
}

// ------------------------------------------------------------------ small utilities

/** @template T @param {T} v @returns {T} */
function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  try {
    return /** @type {T} */ (structuredClone(v));
  } catch (_) {
    return /** @type {T} */ (JSON.parse(JSON.stringify(v)));
  }
}

/** @param {any} n @returns {boolean} */
function isFiniteNum(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/** @param {any} v @returns {boolean} */
function isVec2(v) {
  return Array.isArray(v) && v.length >= 2 && isFiniteNum(v[0]) && isFiniteNum(v[1]);
}

/** @param {Vec2[]} pts @returns {number} shoelace, mm² */
function signedArea2(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** proper intersection between two segments (shared endpoints do not count) @returns {boolean} */
function segsProperlyIntersect(a, b, c, d) {
  const o = (p, q, r) => {
    const v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return v > 1e-9 ? 1 : (v < -1e-9 ? -1 : 0);
  };
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

/** @param {Vec2[]} pts @returns {boolean} */
function isSimpleLoop(pts) {
  const n = pts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segsProperlyIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}

/** @returns {number} */
function nowMs() {
  return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
    ? performance.now() : Date.now();
}

/** @param {number} x @param {number} lo @param {number} hi @returns {number} */
function clampNum(x, lo, hi) {
  return x < lo ? lo : (x > hi ? hi : x);
}

// ------------------------------------------------------------------ installation

/**
 * Installs window.__app (SPEC 12.3). Called once by main.js before any boot stage.
 * @param {any} ctx      AppContext (12.0)
 * @param {any} wiring   Wiring (12.2)
 * @returns {any} AppApi (also assigned to window.__app)
 */
export function installDebugApi(ctx, wiring) {
  if (!ctx || typeof ctx !== 'object') throw fail('E_BAD_ARG', 'installDebugApi: ctx must be an object');
  if (!Array.isArray(ctx.log)) ctx.log = [];
  if (!ctx.mods || typeof ctx.mods !== 'object') ctx.mods = { ui: null, editor: null, viewer: null };
  if (!ctx.body || typeof ctx.body !== 'object') ctx.body = { model: null, quality: null, key: 0 };
  if (!ctx.mesh || typeof ctx.mesh !== 'object') {
    ctx.mesh = { byPiece: new Map(), failed: new Map(), keys: new Map(), spacingFactor: 1 };
  }
  if (!ctx.cloth || typeof ctx.cloth !== 'object') {
    ctx.cloth = {
      state: null, stale: false, lastStats: null, running: false, userPaused: false,
      phase: 'arranged', stepping: false, nanEvents: [], dirty: false,
    };
  }

  installErrorHooks(ctx);

  // ---------------------------------------------------------------- context accessors

  /** @returns {any} */
  function store() {
    if (!ctx.store) throw fail('E_NOT_READY', 'the store is not created yet');
    return ctx.store;
  }

  /** @returns {ProjectDoc} LIVE document (read-only by convention) */
  function liveDoc() {
    const d = store().get();
    if (!d) throw fail('E_NOT_READY', 'no document');
    return d;
  }

  /** run every pending debounced pipeline job now (12.2.4) */
  function flush() {
    if (wiring && typeof wiring.flush === 'function') {
      try { wiring.flush(); } catch (e) { logLine(ctx, 'error', 'flush: ' + msgOf(e), codeOf(e) || 'E_REACTION'); }
    }
  }

  /** @param {(d: ProjectDoc) => any} fn @param {string} label @returns {ProjectDoc} the new live doc */
  function commit(fn, label) {
    const s = store();
    let next;
    try {
      next = s.update(fn, label);
    } catch (e) {
      if (codeOf(e) === 'ValidationError') throw fail('E_BAD_DOC', 'update rejected: ' + msgOf(e), /** @type {any} */ (e).issues);
      if (e instanceof ApiError) throw e;
      throw fail('E_BAD_ARG', 'update failed: ' + msgOf(e), e);
    }
    flush();
    return next;
  }

  /** @param {string} id @returns {Piece} */
  function requirePiece(id) {
    const p = (liveDoc().pieces || []).find((x) => x.id === id);
    if (!p) throw fail('E_NO_PIECE', 'no such piece: ' + String(id));
    return p;
  }

  /** @param {string} id @returns {Seam} */
  function requireSeam(id) {
    const s = (liveDoc().seams || []).find((x) => x.id === id);
    if (!s) throw fail('E_NO_SEAM', 'no such seam: ' + String(id));
    return s;
  }

  /** @param {string} id @returns {any} FabricInstance */
  function requireFabric(id) {
    const f = (liveDoc().fabrics || []).find((x) => x.id === id);
    if (!f) throw fail('E_NO_FABRIC', 'no such fabric: ' + String(id));
    return f;
  }

  /** @param {string|undefined} name @returns {string} */
  function requireSize(name) {
    const doc = liveDoc();
    const n = (name === undefined || name === null || name === '') ? doc.ui.activeSize : String(name);
    const rows = (doc.sizes && doc.sizes.rows) || [];
    if (!rows.some((r) => r.name === n)) throw fail('E_NO_SIZE', 'no such size: ' + n);
    return n;
  }

  /** @returns {ClothState} */
  function requireCloth() {
    const st = ctx.cloth && ctx.cloth.state;
    if (!st) throw fail('E_NO_CLOTH', 'no cloth state (no simulated piece meshed)');
    return st;
  }

  /** @returns {BodyModel} */
  function requireBody() {
    const m = ctx.body && ctx.body.model;
    if (!m) throw fail('E_NO_BODY', 'no body model (the body stage failed)');
    return m;
  }

  /** @returns {any} editor */
  function requireEditor() {
    const ed = ctx.mods && ctx.mods.editor;
    if (!ed) throw fail('E_NOT_READY', 'the 2D editor is not available');
    return ed;
  }

  /** @returns {any} viewer3d facade */
  function requireViewer() {
    const v = ctx.mods && ctx.mods.viewer;
    if (!v) throw fail('E_NOT_READY', 'the 3D viewer is not available');
    return v;
  }

  /** @returns {any} ui facade */
  function requireUi() {
    const u = ctx.mods && ctx.mods.ui;
    if (!u) throw fail('E_NOT_READY', 'the UI is not available');
    return u;
  }

  /** @param {string} id @returns {HTMLElement} */
  function requireEl(id) {
    if (typeof id !== 'string' || !id) throw fail('E_BAD_ARG', 'id must be a non-empty string');
    const el = (typeof document !== 'undefined') ? document.getElementById(id) : null;
    if (!el) throw fail('E_NO_ELEMENT', 'no element #' + id);
    return /** @type {HTMLElement} */ (el);
  }

  /** @template T @param {() => T} fn @returns {T} maps src/export errors to E_EXPORT / E_NO_SIZE / E_NO_PIECE */
  function runExport(fn) {
    try {
      return fn();
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const c = codeOf(e);
      if (c === 'SIZE_UNKNOWN') throw fail('E_NO_SIZE', msgOf(e), e);
      if (c === 'EXPORT_PIECE_UNKNOWN') throw fail('E_NO_PIECE', msgOf(e), e);
      throw fail('E_EXPORT', msgOf(e), e);
    }
  }

  // ---------------------------------------------------------------- ready

  /** @type {Promise<any>|null} */
  let ownReady = null;
  function readyPromise() {
    if (ctx.ready && typeof ctx.ready.then === 'function') return ctx.ready;
    if (!ownReady) {
      ownReady = new Promise((resolve) => { ctx.resolveReady = resolve; });
      ctx.ready = ownReady;
    }
    return ownReady;
  }
  readyPromise();

  // ---------------------------------------------------------------- document

  /** @returns {ProjectDoc} */
  function docCopy() {
    return clone(liveDoc());
  }

  /**
   * @param {ProjectDoc|string} input
   * @param {string} label
   * @returns {ProjectDoc}
   */
  function loadDoc(input, label) {
    let raw = input;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch (e) {
        throw fail('E_BAD_DOC', 'load: not valid JSON — ' + msgOf(e), e);
      }
    }
    if (!raw || typeof raw !== 'object') throw fail('E_BAD_DOC', 'load: a ProjectDoc object or JSON string is required');
    let next;
    try {
      next = normalizeDoc(/** @type {any} */ (raw));
    } catch (e) {
      throw fail('E_BAD_DOC', 'load: ' + msgOf(e), e);
    }
    let issues = [];
    try { issues = validateShape(next) || []; } catch (e) { issues = []; }
    const errors = issues.filter((i) => i && i.level === 'error');
    if (errors.length) throw fail('E_BAD_DOC', 'load: ' + errors.length + ' validation error(s)', errors);
    try {
      store().replace(next, label);
    } catch (e) {
      throw fail('E_BAD_DOC', 'load: ' + msgOf(e), /** @type {any} */ (e).issues || e);
    }
    flush();
    return clone(liveDoc());
  }

  // ---------------------------------------------------------------- pattern helpers

  /**
   * @param {any} verts
   * @param {any} [edges]
   * @returns {Vec2[]} validated copy
   */
  function checkOutline(verts, edges) {
    if (!Array.isArray(verts)) throw fail('E_BAD_ARG', 'vertices must be an array of [x, y]');
    if (verts.length < 3) throw fail('E_BAD_POLY', 'a piece needs at least 3 vertices, got ' + verts.length);
    /** @type {Vec2[]} */
    const out = [];
    for (let i = 0; i < verts.length; i++) {
      if (!isVec2(verts[i])) throw fail('E_BAD_POLY', 'vertex ' + i + ' is not a finite [x, y]');
      out.push([Number(verts[i][0]), Number(verts[i][1])]);
    }
    if (signedArea2(out) <= 0) throw fail('E_BAD_POLY', 'outline must be CCW (signedArea > 0)');
    if (!isSimpleLoop(out)) throw fail('E_BAD_POLY', 'outline is self-intersecting');
    if (edges !== undefined && edges !== null) {
      if (!Array.isArray(edges)) throw fail('E_BAD_ARG', 'edges must be an array');
      if (edges.length !== out.length) {
        throw fail('E_BAD_ARG', 'edges.length (' + edges.length + ') !== vertices.length (' + out.length + ')');
      }
    }
    return out;
  }

  /** @param {Piece} piece @param {number} e @param {boolean} mirror @param {string} which */
  function checkSide(piece, e, mirror, which) {
    if (!Number.isInteger(e) || e < 0 || e >= piece.vertices.length) {
      throw fail('E_BAD_EDGE', which + ': edge index ' + e + ' out of range for piece ' + piece.id);
    }
    if (piece.foldEdge !== null && piece.foldEdge === e) {
      throw fail('E_BAD_EDGE', which + ': edge ' + e + ' is the fold edge of ' + piece.id);
    }
    if (mirror && (piece.foldEdge === null || piece.foldEdge === undefined)) {
      throw fail('E_BAD_EDGE', which + ': mirror:true on piece ' + piece.id + ' which has no foldEdge');
    }
  }

  /** @param {ProjectDoc} doc @param {{pieceId:string, edge:number, mirror:boolean}} side @returns {boolean} */
  function sideTaken(doc, side) {
    for (const s of doc.seams || []) {
      for (const sd of [s.a, s.b]) {
        if (sd && sd.pieceId === side.pieceId && sd.edge === side.edge && !!sd.mirror === !!side.mirror) return true;
      }
    }
    return false;
  }

  /** @param {Piece} p @param {number} dx @param {number} dy @returns {Piece} translated copy */
  function translatePiece(p, dx, dy) {
    if (patternMod && typeof patternMod.opTranslate === 'function') {
      try {
        const r = patternMod.opTranslate(p, dx, dy);
        if (r && Array.isArray(r.vertices)) return r;
      } catch (_) { /* fall through to the local implementation */ }
    }
    const q = clone(p);
    q.vertices = q.vertices.map((v) => /** @type {Vec2} */ ([v[0] + dx, v[1] + dy]));
    q.edges = (q.edges || []).map((e) => {
      const c = { ...e };
      if (c.c1) c.c1 = [c.c1[0] + dx, c.c1[1] + dy];
      if (c.c2) c.c2 = [c.c2[0] + dx, c.c2[1] + dy];
      return c;
    });
    if (q.grainline) {
      q.grainline = { a: [q.grainline.a[0] + dx, q.grainline.a[1] + dy], b: [q.grainline.b[0] + dx, q.grainline.b[1] + dy] };
    }
    q.internalLines = (q.internalLines || []).map((l) => ({ ...l, points: l.points.map((pt) => [pt[0] + dx, pt[1] + dy]) }));
    return q;
  }

  // ---------------------------------------------------------------- pointer / keyboard synthesis

  /** @returns {HTMLCanvasElement} */
  function canvas2d() {
    return /** @type {HTMLCanvasElement} */ (requireEl('canvas-2d'));
  }

  /**
   * @param {HTMLElement} el
   * @param {string} type
   * @param {number} px @param {number} py
   * @param {{button?:number, shift?:boolean, ctrl?:boolean, alt?:boolean, buttons?:number}} o
   */
  function dispatchPointer(el, type, px, py, o) {
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0 };
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: rect.left + px,
      clientY: rect.top + py,
      button: o.button || 0,
      buttons: o.buttons === undefined ? 1 : o.buttons,
      shiftKey: !!o.shift,
      ctrlKey: !!o.ctrl,
      altKey: !!o.alt,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      detail: 1,
    };
    let ev;
    const isPointer = type.indexOf('pointer') === 0;
    if (isPointer && typeof PointerEvent === 'function') ev = new PointerEvent(type, init);
    else if (typeof MouseEvent === 'function') ev = new MouseEvent(isPointer ? type : type, init);
    else ev = new Event(type, { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
  }

  // ---------------------------------------------------------------- body summary

  /** @param {BodyModel} m @returns {any} BodyModelSummary (no large arrays) */
  function bodySummary(m) {
    const g = m.geometry || { positions: new Float32Array(0), indices: new Uint32Array(0) };
    return {
      params: clone(m.params),
      quality: ctx.body.quality || 'full',
      buildMs: m.buildMs,
      measured: clone(m.measured),
      landmarks: clone(m.landmarks),
      anchors: clone(m.anchors),
      rings: clone(m.rings),
      sdf: m.sdf
        ? { origin: clone(m.sdf.origin), cell: m.sdf.cell, nx: m.sdf.nx, ny: m.sdf.ny, nz: m.sdf.nz }
        : null,
      geometry: {
        verts: g.positions ? (g.positions.length / 3) | 0 : 0,
        tris: g.indices ? (g.indices.length / 3) | 0 : 0,
      },
    };
  }

  /**
   * @param {Partial<BodyParams>} patch
   * @param {boolean} doCommit
   * @returns {any} BodyModelSummary
   */
  function applyBodyParams(patch, doCommit) {
    const keys = bodyMod.PARAM_KEYS || [];
    const entries = Object.entries(patch);
    if (!entries.length) throw fail('E_BAD_ARG', 'setParams: empty patch');
    for (const [k, v] of entries) {
      if (keys.indexOf(k) < 0) throw fail('E_BAD_ARG', 'unknown body parameter: ' + k);
      if (!isFiniteNum(v)) throw fail('E_BAD_ARG', 'body parameter ' + k + ': value must be a finite number');
    }
    const doc = liveDoc();
    const merged = { ...clone(doc.body.params) };
    for (const [k, v] of entries) merged[k] = /** @type {number} */ (v);
    const clamped = bodyMod.clampParams(merged);
    if (doCommit) {
      commit((d) => {
        for (const k of Object.keys(clamped)) d.body.params[k] = clamped[k];
        d.body.preset = 'custom';
      }, 'body:params');
      try {
        ctx.bus && ctx.bus.emit(EVENT.BODY_PARAMS_COMMIT, {
          key: entries.length === 1 ? entries[0][0] : null,
          preset: 'custom',
          params: clone(clamped),
        });
      } catch (_) { /* the bus isolates listener errors itself */ }
      flush();
    } else {
      try {
        ctx.bus && ctx.bus.emit(EVENT.BODY_PARAMS_DRAG, {
          key: entries.length === 1 ? entries[0][0] : null,
          params: clone(clamped),
        });
      } catch (_) { /* ignore */ }
      if (wiring && typeof wiring.buildBody === 'function') wiring.buildBody('coarse', clamped);
    }
    return bodySummary(requireBody());
  }

  // ---------------------------------------------------------------- namespaces

  const pattern = Object.freeze({
    /** @returns {Piece[]} copies */
    pieces() { return clone(liveDoc().pieces || []); },

    /** @param {Partial<Piece> & {vertices: Vec2[]}} piece @returns {string} new piece id */
    addPiece(piece) {
      if (!piece || typeof piece !== 'object') throw fail('E_BAD_ARG', 'addPiece: an object with `vertices` is required');
      const verts = checkOutline(piece.vertices, piece.edges);
      const doc = liveDoc();
      const wanted = piece.id ? String(piece.id) : uid('piece');
      if ((doc.pieces || []).some((p) => p.id === wanted)) throw fail('E_BAD_ARG', 'addPiece: id already used: ' + wanted);
      const partial = { ...clone(piece), id: wanted, vertices: verts };
      if (!partial.name) partial.name = wanted;
      if (!partial.fabricId && doc.fabrics && doc.fabrics.length) partial.fabricId = doc.fabrics[0].id;
      commit((d) => { d.pieces.push(/** @type {any} */ (partial)); }, 'piece:add');
      return wanted;
    },

    /** @param {string} id @param {Vec2[]} verts @param {any[]} [edges] */
    setVertices(id, verts, edges) {
      const piece = requirePiece(id);
      const next = checkOutline(verts, edges);
      const sameCount = next.length === piece.vertices.length;
      const keepEdges = sameCount && (edges === undefined || edges === null);
      const n = next.length;
      /** @type {string[]} */
      const droppedSeams = [];
      commit((d) => {
        const p = d.pieces.find((x) => x.id === id);
        if (!p) return;
        p.vertices = next.map((v) => /** @type {Vec2} */ ([v[0], v[1]]));
        if (keepEdges) {
          // edges / notches / foldEdge / seams are kept as they are
        } else {
          p.edges = edges ? clone(edges) : next.map(() => ({ type: 'line' }));
          p.notches = [];
          if (p.foldEdge !== null && p.foldEdge !== undefined) {
            const fe = p.foldEdge;
            const ok = fe < n && (!p.edges[fe] || p.edges[fe].type === 'line');
            if (!ok) p.foldEdge = null;
          }
          p.pinnedEdges = (p.pinnedEdges || []).filter((e) => e < n);
          d.seams = (d.seams || []).filter((s) => {
            const bad = (s.a.pieceId === id && s.a.edge >= n) || (s.b.pieceId === id && s.b.edge >= n);
            if (bad) droppedSeams.push(s.id);
            return !bad;
          });
        }
      }, 'piece:vertices');
      if (droppedSeams.length) {
        status(ctx, 'warn', 'Removed ' + droppedSeams.length + ' seam(s) referencing a deleted edge: ' + droppedSeams.join(', '));
      }
    },

    /**
     * @param {{pieceId:string, edge:number, mirror?:boolean}} a
     * @param {{pieceId:string, edge:number, mirror?:boolean, reverse?:boolean}} b
     * @returns {string} new seam id
     */
    addSeam(a, b) {
      if (!a || !b || typeof a !== 'object' || typeof b !== 'object') throw fail('E_BAD_ARG', 'addSeam: two sides are required');
      const pa = requirePiece(a.pieceId);
      const pb = requirePiece(b.pieceId);
      const am = !!a.mirror;
      const bm = !!b.mirror;
      checkSide(pa, a.edge, am, 'side a');
      checkSide(pb, b.edge, bm, 'side b');
      if (a.pieceId === b.pieceId && a.edge === b.edge && am === bm) {
        throw fail('E_BAD_EDGE', 'addSeam: both sides are the same edge');
      }
      const doc = liveDoc();
      if (sideTaken(doc, { pieceId: a.pieceId, edge: a.edge, mirror: am })) {
        throw fail('E_SEAM_DUP', 'addSeam: side a already belongs to a seam');
      }
      if (sideTaken(doc, { pieceId: b.pieceId, edge: b.edge, mirror: bm })) {
        throw fail('E_SEAM_DUP', 'addSeam: side b already belongs to a seam');
      }
      let reverse = b.reverse;
      if (reverse === undefined || reverse === null) {
        reverse = false;
        if (typeof patternMod.chooseReverse === 'function') {
          try {
            reverse = !!patternMod.chooseReverse(doc, { pieceId: a.pieceId, edge: a.edge, mirror: am, reverse: false },
              { pieceId: b.pieceId, edge: b.edge, mirror: bm, reverse: false });
          } catch (_) { reverse = false; }
        }
      }
      const sid = uid('seam');
      const seam = {
        id: sid,
        a: { pieceId: a.pieceId, edge: a.edge, mirror: am, reverse: false },
        b: { pieceId: b.pieceId, edge: b.edge, mirror: bm, reverse: !!reverse },
        kind: 'plain',
      };
      commit((d) => { d.seams.push(/** @type {any} */ (seam)); }, 'seam:add');
      return sid;
    },

    /** @param {string} id @returns {boolean} */
    removeSeam(id) {
      const doc = liveDoc();
      if (!(doc.seams || []).some((s) => s.id === id)) return false;
      commit((d) => { d.seams = d.seams.filter((s) => s.id !== id); }, 'seam:delete');
      return true;
    },

    /** @param {string} id */
    deletePiece(id) {
      requirePiece(id);
      commit((d) => {
        d.pieces = d.pieces.filter((p) => p.id !== id);
        d.seams = (d.seams || []).filter((s) => s.a.pieceId !== id && s.b.pieceId !== id);
      }, 'piece:delete');
    },

    /** @param {string} id @param {number} dx_mm @param {number} dy_mm */
    movePiece(id, dx_mm, dy_mm) {
      requirePiece(id);
      if (!isFiniteNum(dx_mm) || !isFiniteNum(dy_mm)) throw fail('E_BAD_ARG', 'movePiece: dx_mm and dy_mm must be finite numbers');
      commit((d) => {
        const i = d.pieces.findIndex((p) => p.id === id);
        if (i < 0) return;
        d.pieces[i] = /** @type {any} */ (translatePiece(d.pieces[i], dx_mm, dy_mm));
      }, 'piece:move');
    },

    /**
     * @param {string} id @param {string} [sizeName]
     * @returns {{lenA_mm:number, lenB_mm:number, easePct:number, longer:'a'|'b'|'equal'}}
     */
    seamEase(id, sizeName) {
      const seam = requireSeam(id);
      const doc = liveDoc();
      let r;
      if (sizeName === undefined || sizeName === null || sizeName === '') {
        r = patternMod.seamEase(doc, seam);
      } else {
        const size = requireSize(sizeName);
        let graded;
        try {
          graded = sizingMod.gradeDoc(doc, size);
        } catch (e) {
          throw fail('E_NO_SIZE', 'seamEase: ' + msgOf(e), e);
        }
        if (typeof patternMod.seamEaseGraded === 'function') {
          r = patternMod.seamEaseGraded(doc, seam, graded);
        } else {
          r = patternMod.seamEase({ ...doc, pieces: graded }, seam);
        }
      }
      const lenA = Number(r.lenA_mm);
      const lenB = Number(r.lenB_mm);
      const lo = Math.min(lenA, lenB);
      const ease = lo > 0 ? Math.round(Math.abs(lenA - lenB) / lo * 10000) / 100 : 0;
      return {
        lenA_mm: lenA,
        lenB_mm: lenB,
        easePct: ease,
        longer: lenA > lenB ? 'a' : (lenB > lenA ? 'b' : 'equal'),
      };
    },

    /** @returns {Issue[]} errors first */
    validate() {
      const doc = liveDoc();
      /** @type {Issue[]} */
      let out = [];
      try { out = out.concat(patternMod.validateDoc(doc) || []); } catch (_) { /* pattern module unavailable */ }
      try { out = out.concat(validateShape(doc) || []); } catch (_) { /* ignore */ }
      return clone(out.slice().sort((x, y) => (x.level === 'error' ? 0 : 1) - (y.level === 'error' ? 0 : 1)));
    },

    fit() {
      const ed = requireEditor();
      if (ed.view && typeof ed.view.fitToPieces === 'function') ed.view.fitToPieces();
    },

    /** @param {number} x_mm @param {number} y_mm @returns {[number, number]} */
    worldToScreen(x_mm, y_mm) {
      if (!isFiniteNum(x_mm) || !isFiniteNum(y_mm)) throw fail('E_BAD_ARG', 'worldToScreen: finite numbers required');
      const ed = requireEditor();
      const p = ed.view.worldToScreen(x_mm, y_mm);
      return [Number(p[0]), Number(p[1])];
    },

    /** @param {number} px @param {number} py @returns {[number, number]} */
    screenToWorld(px, py) {
      if (!isFiniteNum(px) || !isFiniteNum(py)) throw fail('E_BAD_ARG', 'screenToWorld: finite numbers required');
      const ed = requireEditor();
      const p = ed.view.screenToWorld(px, py);
      return [Number(p[0]), Number(p[1])];
    },

    /** @param {string} name */
    setTool(name) {
      const names = patternMod.TOOL_NAMES || ['select', 'draw', 'edit', 'split', 'seam', 'notch', 'grainline', 'measure'];
      if (typeof name !== 'string' || names.indexOf(name) < 0) {
        throw fail('E_BAD_ARG', 'setTool: unknown tool "' + String(name) + '"');
      }
      requireEditor().setTool(name);
    },

    /**
     * @param {number} x_mm @param {number} y_mm
     * @param {{button?:0|2, shift?:boolean, ctrl?:boolean, alt?:boolean, double?:boolean}} [opts]
     * @returns {[number, number]} the CSS-pixel point used
     */
    click(x_mm, y_mm, opts) {
      const o = opts || {};
      const [px, py] = pattern.worldToScreen(x_mm, y_mm);
      const el = canvas2d();
      const button = o.button === 2 ? 2 : 0;
      const buttons = button === 2 ? 2 : 1;
      dispatchPointer(el, 'pointerdown', px, py, { button, buttons, shift: o.shift, ctrl: o.ctrl, alt: o.alt });
      dispatchPointer(el, 'pointerup', px, py, { button, buttons: 0, shift: o.shift, ctrl: o.ctrl, alt: o.alt });
      dispatchPointer(el, 'click', px, py, { button, buttons: 0, shift: o.shift, ctrl: o.ctrl, alt: o.alt });
      if (o.double) dispatchPointer(el, 'dblclick', px, py, { button, buttons: 0, shift: o.shift, ctrl: o.ctrl, alt: o.alt });
      flush();
      return [px, py];
    },

    /**
     * @param {number} x0_mm @param {number} y0_mm @param {number} x1_mm @param {number} y1_mm
     * @param {{steps?:number, shift?:boolean}} [opts]
     */
    drag(x0_mm, y0_mm, x1_mm, y1_mm, opts) {
      const o = opts || {};
      const steps = Number.isInteger(o.steps) ? /** @type {number} */ (o.steps) : 8;
      if (!(steps >= 1 && steps <= 1000)) throw fail('E_BAD_ARG', 'drag: steps must be 1..1000');
      const p0 = pattern.worldToScreen(x0_mm, y0_mm);
      const p1 = pattern.worldToScreen(x1_mm, y1_mm);
      const el = canvas2d();
      dispatchPointer(el, 'pointerdown', p0[0], p0[1], { button: 0, buttons: 1, shift: o.shift });
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        dispatchPointer(el, 'pointermove', p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t,
          { button: 0, buttons: 1, shift: o.shift });
      }
      dispatchPointer(el, 'pointerup', p1[0], p1[1], { button: 0, buttons: 0, shift: o.shift });
      flush();
    },

    /** @param {string|string[]|null} id */
    select(id) {
      const ed = requireEditor();
      if (id === null || id === undefined) {
        if (typeof ed.clearSelection === 'function') ed.clearSelection();
        return;
      }
      const list = Array.isArray(id) ? id : [id];
      const doc = liveDoc();
      /** @type {string[]} */
      const pieces = [];
      /** @type {string[]} */
      const seams = [];
      for (const one of list) {
        if (typeof one !== 'string') throw fail('E_BAD_ARG', 'select: ids must be strings');
        if ((doc.pieces || []).some((p) => p.id === one)) pieces.push(one);
        else if ((doc.seams || []).some((s) => s.id === one)) seams.push(one);
        else throw fail('E_NO_PIECE', 'select: no piece or seam with id ' + one);
      }
      ed.select({ pieces, seams, vertex: null, edge: null });
    },

    /** @returns {{pieceIds: string[], seamIds: string[]}} */
    selection() {
      let sel = null;
      const ed = ctx.mods && ctx.mods.editor;
      if (ed && typeof ed.getSelection === 'function') {
        try { sel = ed.getSelection(); } catch (_) { sel = null; }
      }
      if (!sel && ctx.store && ctx.store.transient) sel = ctx.store.transient.selection;
      return {
        pieceIds: sel && Array.isArray(sel.pieces) ? sel.pieces.slice() : [],
        seamIds: sel && Array.isArray(sel.seams) ? sel.seams.slice() : [],
      };
    },
  });

  const mesh = Object.freeze({
    /** @returns {any} aggregate mesh statistics */
    stats() {
      const doc = ctx.store ? ctx.store.get() : null;
      const byPiece = ctx.mesh.byPiece || new Map();
      /** @type {any[]} */
      const perPiece = [];
      let verts = 0;
      let tris = 0;
      let minAngleDeg = Infinity;
      let pctSum = 0;
      let medSum = 0;
      let triWeight = 0;
      const order = doc ? (doc.pieces || []).map((p) => p.id) : [...byPiece.keys()];
      for (const id of order) {
        const m = byPiece.get(id);
        if (!m) continue;
        const q = m.quality || { minAngleDeg: 0, pctAbove20: 0, medianEdge_mm: 0, triangles: 0 };
        const t = (m.triangles ? m.triangles.length / 3 : q.triangles) | 0;
        verts += m.vertexCount | 0;
        tris += t;
        if (q.minAngleDeg < minAngleDeg) minAngleDeg = q.minAngleDeg;
        pctSum += q.pctAbove20 * t;
        medSum += q.medianEdge_mm * t;
        triWeight += t;
        perPiece.push({
          pieceId: m.pieceId,
          verts: m.vertexCount | 0,
          tris: t,
          minAngleDeg: q.minAngleDeg,
          pctAbove20: q.pctAbove20,
          medianEdge_mm: q.medianEdge_mm,
          area_mm2: m.area_mm2,
          warnings: (m.warnings || []).slice(),
        });
      }
      /** @type {{pieceId:string, message:string}[]} */
      const failed = [];
      const fm = ctx.mesh.failed;
      if (fm && typeof fm.forEach === 'function') fm.forEach((v, k) => failed.push({ pieceId: k, message: String(v) }));

      let seamPairsEqual = true;
      if (doc) {
        for (const s of doc.seams || []) {
          const ma = byPiece.get(s.a.pieceId);
          const mb = byPiece.get(s.b.pieceId);
          if (!ma || !mb) continue;
          const va = ma.edgeVerts && ma.edgeVerts[s.a.mirror ? 1 : 0] && ma.edgeVerts[s.a.mirror ? 1 : 0][s.a.edge];
          const vb = mb.edgeVerts && mb.edgeVerts[s.b.mirror ? 1 : 0] && mb.edgeVerts[s.b.mirror ? 1 : 0][s.b.edge];
          if (!va || !vb || va.length !== vb.length) { seamPairsEqual = false; break; }
        }
      }
      return {
        pieces: perPiece.length,
        verts,
        tris,
        minAngleDeg: Number.isFinite(minAngleDeg) ? minAngleDeg : 0,
        pctAbove20: triWeight ? pctSum / triWeight : 0,
        medianEdge_mm: triWeight ? medSum / triWeight : 0,
        spacingFactor: ctx.mesh.spacingFactor || 1,
        perPiece,
        failed,
        seamPairsEqual,
      };
    },

    /** @param {string} [pieceId] @returns {PieceMesh[]} LIVE meshes */
    remesh(pieceId) {
      if (pieceId !== undefined && pieceId !== null) requirePiece(String(pieceId));
      if (!wiring || typeof wiring.remesh !== 'function') throw fail('E_NOT_READY', 'wiring is not available');
      const out = wiring.remesh(pieceId ? [String(pieceId)] : null, { force: true });
      // 12.3: a forced remesh is followed by rebuild + arrange (+ drape unless paused). wiring.remesh() is the
      // low-level step (12.2), so the pipeline tail is driven from here, under guard — a failure leaves the
      // previous cloth in use with a status message instead of throwing out of __app.
      try {
        if (typeof wiring.rebuildCloth === 'function') wiring.rebuildCloth();
        if (typeof wiring.arrange === 'function') wiring.arrange();
        if (!ctx.cloth.userPaused && typeof wiring.drape === 'function') wiring.drape();
      } catch (e) {
        status(ctx, 'error', 'remesh pipeline: ' + msgOf(e), codeOf(e) || 'E_REACTION');
      }
      flush();
      return Array.isArray(out) ? out : [];
    },

    /** @param {string} pieceId @returns {PieceMesh|null} LIVE mesh */
    get(pieceId) {
      const m = ctx.mesh.byPiece ? ctx.mesh.byPiece.get(String(pieceId)) : null;
      return m || null;
    },

    /** @returns {PieceMesh[]} LIVE meshes, doc.pieces order */
    all() {
      const doc = ctx.store ? ctx.store.get() : null;
      const byPiece = ctx.mesh.byPiece || new Map();
      if (!doc) return [...byPiece.values()];
      /** @type {PieceMesh[]} */
      const out = [];
      for (const p of doc.pieces || []) {
        const m = byPiece.get(p.id);
        if (m) out.push(m);
      }
      return out;
    },
  });

  const body = Object.freeze({
    /** @returns {BodyParams} copy */
    params() { return clone(liveDoc().body.params); },

    /** @param {string} key @param {number} value @param {{commit?:boolean}} [opts] @returns {any} */
    setParam(key, value, opts) {
      const doCommit = !(opts && opts.commit === false);
      return applyBodyParams({ [key]: value }, doCommit);
    },

    /** @param {Partial<BodyParams>} patch @param {{commit?:boolean}} [opts] @returns {any} */
    setParams(patch, opts) {
      if (!patch || typeof patch !== 'object') throw fail('E_BAD_ARG', 'setParams: a patch object is required');
      const doCommit = !(opts && opts.commit === false);
      return applyBodyParams(patch, doCommit);
    },

    /**
     * Fill in every measurement from height, weight, build and age (body/params.js estimateMeasurements) — the
     * body-visualizer.com flow. Without `overwrite` it only fills what is missing; the UI button passes overwrite.
     * @param {{overwrite?: boolean}} [opts] @returns {any} the new body params
     */
    estimate(opts) {
      const overwrite = !!(opts && opts.overwrite !== false);
      if (typeof bodyMod.estimateMeasurements !== 'function') throw fail('E_NO_BODY', 'estimateMeasurements unavailable');
      commit((d) => {
        d.body.params = bodyMod.estimateMeasurements(d.body.params, { overwrite });
        d.body.preset = 'custom';
      }, 'body:estimate');
      return clone(liveDoc().body.params);
    },

    /** @param {string} id @returns {any} */
    setPreset(id) {
      const presets = bodyMod.BODY_PRESETS || {};
      if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(presets, id)) {
        throw fail('E_NO_PRESET', 'no such body preset: ' + String(id));
      }
      const params = clone(presets[id]);
      commit((d) => {
        d.body.preset = id;
        for (const k of Object.keys(params)) d.body.params[k] = params[k];
      }, 'body:preset');
      try {
        ctx.bus && ctx.bus.emit(EVENT.BODY_PARAMS_COMMIT, { key: null, preset: id, params: clone(params) });
      } catch (_) { /* ignore */ }
      flush();
      return bodySummary(requireBody());
    },

    /** @returns {string[]} */
    presets() { return Object.keys(bodyMod.BODY_PRESETS || {}); },

    /** @returns {any} BodyModelSummary */
    model() { return bodySummary(requireBody()); },

    /** @returns {BodyModel} LIVE model (typed arrays) */
    modelLive() { return requireBody(); },

    /** @returns {{chest_cm:number, waist_cm:number, hips_cm:number}} */
    measured() { return clone(requireBody().measured); },

    /** @param {number} x @param {number} y @param {number} z @returns {{d:number, n:Vec3}} */
    sdf(x, y, z) {
      if (!isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(z)) throw fail('E_BAD_ARG', 'sdf: x, y, z must be finite numbers');
      const m = requireBody();
      const grad = [0, 0, 0];
      const d = bodyMod.sampleBody(m, x, y, z, grad);
      return { d, n: /** @type {Vec3} */ ([grad[0], grad[1], grad[2]]) };
    },

    /** @param {string} name @returns {Vec3} copy */
    landmark(name) {
      const m = requireBody();
      const v = m.landmarks ? m.landmarks[name] : undefined;
      if (!v) throw fail('E_BAD_ARG', 'unknown landmark: ' + String(name));
      return /** @type {Vec3} */ ([v[0], v[1], v[2]]);
    },
  });

  /** @returns {SimStats} */
  function simStatsNow() {
    const st = requireCloth();
    if (ctx.cloth.lastStats) return ctx.cloth.lastStats;
    return clothMod.stats(st);
  }

  const sim = Object.freeze({
    /** @returns {ClothState|null} LIVE state */
    state() { return (ctx.cloth && ctx.cloth.state) || null; },

    /** @param {number} [n] @returns {SimStats} */
    step(n) {
      const count = n === undefined || n === null ? 1 : n;
      if (!Number.isInteger(count) || count < 1 || count > 100000) {
        throw fail('E_BAD_ARG', 'step: n must be an integer 1..100000');
      }
      requireCloth();
      if (!wiring || typeof wiring.stepFrames !== 'function') throw fail('E_NOT_READY', 'wiring is not available');
      if (count > 3000) console.warn('[__app] sim.step(' + count + ') — this takes seconds');
      return wiring.stepFrames(count);
    },

    play() {
      if (wiring && typeof wiring.play === 'function') wiring.play();
    },

    pause() {
      if (wiring && typeof wiring.pause === 'function') wiring.pause();
    },

    /** @returns {SimStats} */
    reset() {
      requireCloth();
      if (wiring && typeof wiring.reset === 'function') wiring.reset();
      return clothMod.stats(requireCloth());
    },

    /** @returns {SimStats} */
    arrange() {
      requireCloth();
      if (wiring && typeof wiring.arrange === 'function') wiring.arrange();
      return clothMod.stats(requireCloth());
    },

    /** @returns {SimStats} */
    drape() {
      requireCloth();
      if (wiring && typeof wiring.drape === 'function') wiring.drape();
      return clothMod.stats(requireCloth());
    },

    /** @returns {SimStats} */
    stats() { return simStatsNow(); },

    /** @returns {'empty'|'arranged'|'sewing'|'draping'|'paused'|'error'} */
    phase() {
      const st = ctx.cloth && ctx.cloth.state;
      if (!st) return 'empty';
      if (ctx.cloth.phase === 'error') return 'error';
      const doc = ctx.store ? ctx.store.get() : null;
      const sewTime = doc && doc.sim ? doc.sim.sewTime_s : 1;
      const running = !!ctx.cloth.running;
      const time = st.time || 0;
      if (!running) return time > 0 ? 'paused' : 'arranged';
      return time < sewTime + 0.5 ? 'sewing' : 'draping';
    },

    /** @returns {boolean} */
    running() { return !!(ctx.cloth && ctx.cloth.running); },

    /** @param {string} key @param {number|boolean} value @returns {any} doc.sim copy */
    setSetting(key, value) {
      /** @type {Record<string, [number, number, boolean]>} */
      const RANGES = {
        substeps: [1, 30, true],
        gravity_ms2: [0, 30, false],
        sewTime_s: [0.1, 10, false],
        collisionOffset_mm: [0, 20, false],
        bendScale: [1e-3, 1e3, false],
        stretchScale: [1e-3, 1e3, false],
      };
      if (key === 'selfCollision') {
        if (typeof value !== 'boolean') throw fail('E_BAD_ARG', 'setSetting: selfCollision must be a boolean');
      } else if (Object.prototype.hasOwnProperty.call(RANGES, key)) {
        const [lo, hi, isInt] = RANGES[key];
        if (!isFiniteNum(value)) throw fail('E_BAD_ARG', 'setSetting: ' + key + ' must be a finite number');
        if (isInt && !Number.isInteger(value)) throw fail('E_BAD_ARG', 'setSetting: ' + key + ' must be an integer');
        if (value < lo || value > hi) throw fail('E_BAD_ARG', 'setSetting: ' + key + ' must be ' + lo + '..' + hi);
      } else {
        throw fail('E_BAD_ARG', 'setSetting: unknown key ' + String(key));
      }
      commit((d) => { d.sim[key] = value; }, 'sim:setting');
      return clone(liveDoc().sim);
    },

    /** @returns {{frame:number, time:number, V:number, pos:Float32Array, vel:Float32Array}} copies */
    snapshot() {
      const st = requireCloth();
      const s = clothMod.snapshot(st);
      return { frame: s.frame, time: s.time, V: st.V, pos: s.pos, vel: s.vel };
    },

    /** @param {{V?:number, frame:number, time:number, pos:Float32Array, vel:Float32Array}} snap */
    restore(snap) {
      const st = requireCloth();
      if (!snap || typeof snap !== 'object' || !snap.pos || !snap.vel) throw fail('E_BAD_ARG', 'restore: a snapshot object is required');
      const V = snap.V === undefined ? (snap.pos.length / 3) | 0 : snap.V;
      if (V !== st.V) throw fail('E_BAD_ARG', 'restore: snapshot V ' + V + ' !== state V ' + st.V);
      clothMod.restore(st, /** @type {any} */ (snap));
      ctx.cloth.dirty = true;
    },

    /** @returns {Vec3} metres */
    centerOfMass() {
      const st = requireCloth();
      let mx = 0;
      let my = 0;
      let mz = 0;
      let mtot = 0;
      for (let v = 0; v < st.V; v++) {
        const im = st.invMass[v];
        if (!(im > 0)) continue;
        const m = 1 / im;
        mx += m * st.pos[3 * v];
        my += m * st.pos[3 * v + 1];
        mz += m * st.pos[3 * v + 2];
        mtot += m;
      }
      if (!(mtot > 0)) return [0, 0, 0];
      return [mx / mtot, my / mtot, mz / mtot];
    },

    /** @param {number} vertex @param {Vec3} [target] */
    pin(vertex, target) {
      const st = requireCloth();
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= st.V) throw fail('E_BAD_ARG', 'pin: vertex out of range');
      let t = target;
      if (t === undefined || t === null) {
        t = /** @type {Vec3} */ ([st.pos[3 * vertex], st.pos[3 * vertex + 1], st.pos[3 * vertex + 2]]);
      }
      if (!Array.isArray(t) || t.length < 3 || !isFiniteNum(t[0]) || !isFiniteNum(t[1]) || !isFiniteNum(t[2])) {
        throw fail('E_BAD_ARG', 'pin: target must be [x, y, z] in metres');
      }
      clothMod.setPin(st, vertex, /** @type {any} */ (t));
      ctx.cloth.dirty = true;
    },

    /** @param {number} vertex */
    unpin(vertex) {
      const st = requireCloth();
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= st.V) throw fail('E_BAD_ARG', 'unpin: vertex out of range');
      if (typeof clothMod.clearPin !== 'function') throw fail('E_NOT_READY', 'cloth.clearPin is unavailable');
      clothMod.clearPin(st, vertex);
      ctx.cloth.dirty = true;
    },
  });

  const fabric = Object.freeze({
    /** @returns {any[]} copies */
    presets() {
      const p = FABRIC_PRESETS;
      return clone(Array.isArray(p) ? p : Object.values(p || {}));
    },

    /** @returns {any[]} copies */
    list() { return clone(liveDoc().fabrics || []); },

    /** @param {string} fabricId @returns {any} FabricResolved */
    resolved(fabricId) { return clone(resolveFabric(requireFabric(fabricId))); },

    /** @param {string} fabricId @param {string} presetId @returns {any} */
    setPreset(fabricId, presetId) {
      requireFabric(fabricId);
      if (typeof presetId !== 'string' || !hasPreset(presetId)) throw fail('E_NO_PRESET', 'no such fabric preset: ' + String(presetId));
      commit((d) => {
        const f = d.fabrics.find((x) => x.id === fabricId);
        if (f) f.preset = presetId;
      }, 'fabric:preset');
      return clone(resolveFabric(requireFabric(fabricId)));
    },

    /** @param {string} fabricId @param {string} hex */
    setColor(fabricId, hex) {
      requireFabric(fabricId);
      if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) throw fail('E_BAD_ARG', 'setColor: hex must match #rrggbb');
      const lower = hex.toLowerCase();
      commit((d) => {
        const f = d.fabrics.find((x) => x.id === fabricId);
        if (f) f.color = lower;
      }, 'fabric:color');
    },

    /** @param {string} fabricId @param {string} kind @param {{scale_mm?:number, color2?:string}} [opts] */
    setTexture(fabricId, kind, opts) {
      requireFabric(fabricId);
      const kinds = TEXTURE_KINDS || ['solid', 'stripes', 'gingham', 'dots', 'twill', 'knit'];
      if (typeof kind !== 'string' || kinds.indexOf(kind) < 0) throw fail('E_BAD_ARG', 'setTexture: unknown kind ' + String(kind));
      const o = opts || {};
      if (o.scale_mm !== undefined && o.scale_mm !== null) {
        if (!isFiniteNum(o.scale_mm) || o.scale_mm < 1 || o.scale_mm > 500) throw fail('E_BAD_ARG', 'setTexture: scale_mm must be 1..500');
      }
      if (o.color2 !== undefined && o.color2 !== null) {
        if (typeof o.color2 !== 'string' || !isHexColor(o.color2)) throw fail('E_BAD_ARG', 'setTexture: color2 must match #rrggbb');
      }
      commit((d) => {
        const f = d.fabrics.find((x) => x.id === fabricId);
        if (!f) return;
        f.texture = { ...f.texture, kind };
        if (o.scale_mm !== undefined && o.scale_mm !== null) f.texture.scale_mm = o.scale_mm;
        if (o.color2 !== undefined && o.color2 !== null) f.texture.color2 = String(o.color2).toLowerCase();
      }, 'fabric:texture');
    },

    /** @param {string} fabricId @param {string} key @param {number|null} value */
    setOverride(fabricId, key, value) {
      requireFabric(fabricId);
      const keys = PHYSICS_KEYS || [];
      if (typeof key !== 'string' || keys.indexOf(key) < 0) throw fail('E_BAD_ARG', 'setOverride: unknown physics key ' + String(key));
      if (value !== null && !isFiniteNum(value)) throw fail('E_BAD_ARG', 'setOverride: value must be a finite number or null');
      commit((d) => {
        const f = d.fabrics.find((x) => x.id === fabricId);
        if (!f) return;
        if (!f.overrides) f.overrides = {};
        if (value === null) delete f.overrides[key];
        else f.overrides[key] = value;
      }, 'fabric:override');
    },

    /** @param {number} bend @param {number} stretch */
    setScale(bend, stretch) {
      if (!isFiniteNum(bend) || bend < 1e-3 || bend > 1e3) throw fail('E_BAD_ARG', 'setScale: bend must be 1e-3..1e3');
      if (!isFiniteNum(stretch) || stretch < 1e-3 || stretch > 1e3) throw fail('E_BAD_ARG', 'setScale: stretch must be 1e-3..1e3');
      commit((d) => { d.sim.bendScale = bend; d.sim.stretchScale = stretch; }, 'sim:scale');
    },

    /** @param {any} instance @returns {string} new fabric id */
    addFabric(instance) {
      if (!instance || typeof instance !== 'object') throw fail('E_BAD_ARG', 'addFabric: an object with `preset` is required');
      if (typeof instance.preset !== 'string' || !hasPreset(instance.preset)) {
        throw fail('E_NO_PRESET', 'addFabric: no such fabric preset: ' + String(instance.preset));
      }
      const doc = liveDoc();
      const id = instance.id ? String(instance.id) : uid('fab');
      if ((doc.fabrics || []).some((f) => f.id === id)) throw fail('E_BAD_ARG', 'addFabric: id already used: ' + id);
      const preset = getPreset(instance.preset);
      const inst = {
        id,
        name: instance.name || (preset && preset.name) || id,
        preset: instance.preset,
        color: instance.color || (preset && preset.look && preset.look.color) || '#888888',
        texture: instance.texture ? clone(instance.texture) : undefined,
        overrides: instance.overrides ? clone(instance.overrides) : {},
      };
      if (!inst.texture) delete inst.texture;
      commit((d) => { d.fabrics.push(/** @type {any} */ (inst)); }, 'fabric:add');
      return id;
    },
  });

  const sizes = Object.freeze({
    /** @returns {any} SizeChart copy */
    chart() { return clone(liveDoc().sizes); },

    /** @param {string} name */
    setActive(name) {
      const n = requireSize(name);
      commit((d) => { d.ui.activeSize = n; }, 'sizes:active');
    },

    /** @returns {string} */
    active() { return liveDoc().ui.activeSize; },

    /** @param {string} name @returns {Piece[]} copies */
    grade(name) {
      const n = requireSize(name);
      try {
        return clone(sizingMod.gradeDoc(liveDoc(), n));
      } catch (e) {
        if (codeOf(e) === 'SIZE_UNKNOWN') throw fail('E_NO_SIZE', msgOf(e), e);
        throw fail('E_BAD_ARG', 'grade: ' + msgOf(e), e);
      }
    },

    /** @returns {{name:string, score:number}} */
    closest() {
      const doc = liveDoc();
      const r = sizingMod.closestSize(doc.body.params, doc.sizes);
      return { name: r.name, score: r.score };
    },

    /** @param {string} name @param {string} key @param {number} value_cm */
    setCell(name, key, value_cm) {
      const n = requireSize(name);
      const doc = liveDoc();
      if (typeof key !== 'string' || (doc.sizes.measurements || []).indexOf(key) < 0) {
        throw fail('E_BAD_ARG', 'setCell: no measurement "' + String(key) + '" in the chart');
      }
      if (!isFiniteNum(value_cm) || value_cm <= 0) throw fail('E_BAD_ARG', 'setCell: value_cm must be a finite number > 0');
      commit((d) => {
        const row = d.sizes.rows.find((r) => r.name === n);
        if (row) row[key] = value_cm;
      }, 'sizes:cell');
    },

    /** @param {any} row @param {number} [index] */
    addRow(row, index) {
      if (!row || typeof row !== 'object' || typeof row.name !== 'string' || !row.name) {
        throw fail('E_BAD_ARG', 'addRow: a row with a name is required');
      }
      const doc = liveDoc();
      if ((doc.sizes.rows || []).some((r) => r.name === row.name)) throw fail('E_BAD_ARG', 'addRow: duplicate size name ' + row.name);
      for (const k of doc.sizes.measurements || []) {
        if (!isFiniteNum(row[k])) throw fail('E_BAD_ARG', 'addRow: missing or non-numeric measurement "' + k + '"');
      }
      const at = Number.isInteger(index) ? clampNum(/** @type {number} */ (index), 0, (doc.sizes.rows || []).length) : (doc.sizes.rows || []).length;
      const copy = clone(row);
      commit((d) => { d.sizes.rows.splice(at, 0, /** @type {any} */ (copy)); }, 'sizes:addRow');
    },

    /** @param {string} name */
    removeRow(name) {
      const n = requireSize(name);
      const doc = liveDoc();
      if (doc.sizes.baseSize === n) throw fail('E_BAD_ARG', 'removeRow: cannot remove the base size ' + n);
      commit((d) => {
        d.sizes.rows = d.sizes.rows.filter((r) => r.name !== n);
        if (d.ui.activeSize === n) d.ui.activeSize = d.sizes.baseSize;
      }, 'sizes:removeRow');
    },

    /** @param {string} name @returns {any} BodyModelSummary */
    fitBody(name) {
      const n = requireSize(name);
      const doc = liveDoc();
      const row = (doc.sizes.rows || []).find((r) => r.name === n);
      const keys = bodyMod.PARAM_KEYS || [];
      /** @type {Record<string, number>} */
      const patch = {};
      for (const k of Object.keys(row || {})) {
        if (k === 'name') continue;
        if (keys.indexOf(k) >= 0 && isFiniteNum(row[k])) patch[k] = /** @type {number} */ (row[k]);
      }
      if (!Object.keys(patch).length) throw fail('E_BAD_ARG', 'fitBody: row "' + n + '" has no body parameter keys');
      return applyBodyParams(patch, true);
    },
  });

  const exportNs = Object.freeze({
    /** @param {string} [size] @param {string} [pieceId] @returns {string} */
    svg(size, pieceId) {
      const n = requireSize(size);
      if (pieceId !== undefined && pieceId !== null && pieceId !== '') {
        requirePiece(String(pieceId));
        return runExport(() => exportMod.exportDocPieceSvg(liveDoc(), String(pieceId), n));
      }
      return runExport(() => exportMod.exportDocSvg(liveDoc(), n));
    },

    /** @param {string} [size] @returns {string} */
    sheetSvg(size) {
      const n = requireSize(size);
      return runExport(() => exportMod.exportDocSvg(liveDoc(), n));
    },

    /** @param {string} [size] @param {string} [paper] @returns {string} */
    printHtml(size, paper) {
      const n = requireSize(size);
      const p = paper === undefined || paper === null ? 'A4' : String(paper);
      if (['A4', 'Letter', 'A3'].indexOf(p) < 0) throw fail('E_BAD_ARG', 'printHtml: paper must be A4, Letter or A3');
      return runExport(() => exportMod.exportDocPrintHtml(liveDoc(), n, { paper: p }).html);
    },

    /** @param {string} [size] @param {string} [paper] @returns {number} */
    pageCount(size, paper) {
      const n = requireSize(size);
      const p = paper === undefined || paper === null ? 'A4' : String(paper);
      if (['A4', 'Letter', 'A3'].indexOf(p) < 0) throw fail('E_BAD_ARG', 'pageCount: paper must be A4, Letter or A3');
      return runExport(() => exportMod.exportDocPrintHtml(liveDoc(), n, { paper: p }).plan.tiles.length);
    },

    /** @returns {string} */
    csv() { return runExport(() => exportMod.exportDocSizesCsv(liveDoc())); },

    /** @returns {string} */
    pieceCsv() { return runExport(() => exportMod.exportDocMeasurementsCsv(liveDoc())); },

    /** @param {string} pieceId @param {string} [size] @returns {Vec2[]} */
    cutLine(pieceId, size) {
      requirePiece(String(pieceId));
      const n = requireSize(size);
      return runExport(() => {
        const graded = sizingMod.gradeDoc(liveDoc(), n);
        const piece = graded.find((p) => p.id === String(pieceId));
        if (!piece) throw fail('E_NO_PIECE', 'cutLine: no such piece ' + String(pieceId));
        const geom = exportMod.buildPieceGeometry(piece, n);
        return clone(geom.cut);
      });
    },

    /** @returns {string} */
    json() { return runExport(() => exportMod.exportDocSizesJson(liveDoc())); },

    /** @param {{body?:boolean}} [opts] @returns {string} — `body:true` is accepted but ignored (src/export clothObj takes {name} only) */
    obj(opts) {
      const st = requireCloth();
      return runExport(() => exportMod.clothObj(st, { name: liveDoc().name }));
    },
  });

  const uiNs = Object.freeze({
    /** @param {string} id */
    click(id) {
      const el = requireEl(id);
      if (typeof (/** @type {any} */ (el).click) === 'function') el.click();
      else el.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
      flush();
    },

    /** @param {string} id @param {string|number|boolean} value */
    setValue(id, value) {
      const el = /** @type {any} */ (requireEl(id));
      const tag = String(el.tagName || '').toLowerCase();
      const type = String(el.type || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        el.checked = !!value;
      } else if (tag === 'select') {
        const want = String(value);
        const ok = Array.prototype.some.call(el.options || [], (o) => o.value === want);
        if (!ok) throw fail('E_BAD_ARG', 'setValue: <select id="' + id + '"> has no option "' + want + '"');
        el.value = want;
      } else if (tag === 'input' || tag === 'textarea') {
        el.value = String(value);
      } else {
        throw fail('E_BAD_ARG', 'setValue: #' + id + ' is a <' + tag + '>, not a form control');
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      flush();
    },

    /** @param {'split'|'2d'|'3d'} mode */
    layout(mode) {
      if (['split', '2d', '3d'].indexOf(mode) < 0) throw fail('E_BAD_ARG', 'layout: mode must be split, 2d or 3d');
      const u = requireUi();
      const l = u.layout;
      if (l && typeof l.setLayout === 'function') l.setLayout(mode);
      else if (l && typeof l.set === 'function') l.set(mode);
      else throw fail('E_NOT_READY', 'layout: ui.layout is unavailable');
      flush();
    },

    /** @param {'pieces'|'body'|'fabric'|'sizes'} tab */
    dock(tab) {
      if (['pieces', 'body', 'fabric', 'sizes'].indexOf(tab) < 0) throw fail('E_BAD_ARG', 'dock: unknown tab ' + String(tab));
      const u = requireUi();
      if (!u.dock || typeof u.dock.setTab !== 'function') throw fail('E_NOT_READY', 'dock: ui.dock is unavailable');
      u.dock.setTab(tab);
      flush();
    },

    swap() {
      const u = requireUi();
      if (!u.layout || typeof u.layout.swap !== 'function') throw fail('E_NOT_READY', 'swap: ui.layout is unavailable');
      u.layout.swap();
      flush();
    },

    /** @param {number} f */
    setSplit(f) {
      if (!isFiniteNum(f) || f < 0.15 || f > 0.85) throw fail('E_BAD_ARG', 'setSplit: f must be 0.15..0.85');
      const u = requireUi();
      if (!u.layout || typeof u.layout.setSplit !== 'function') throw fail('E_NOT_READY', 'setSplit: ui.layout is unavailable');
      u.layout.setSplit(f);
      flush();
    },

    /** @returns {any} */
    state() {
      const doc = liveDoc();
      const paneSize = (id) => {
        const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
        if (!el) return { w: 0, h: 0 };
        return { w: el.clientWidth || 0, h: el.clientHeight || 0 };
      };
      const t = ctx.store && ctx.store.transient ? ctx.store.transient : null;
      return {
        ...clone(doc.ui),
        tool: (t && t.tool) || 'select',
        selection: pattern.selection(),
        panes: { left: paneSize('pane-left'), right: paneSize('pane-right') },
        popout: !!(t && t.popoutId),
      };
    },

    /** @returns {string[]} every element id the UI promises (SPEC 11.1) */
    elements() {
      const u = ctx.mods && ctx.mods.ui;
      if (u && Array.isArray(u.REQUIRED_IDS) && u.REQUIRED_IDS.length >= ALL_IDS.length) return u.REQUIRED_IDS.slice();
      return ALL_IDS.slice();
    },

    /** @param {string} key @param {{ctrl?:boolean, shift?:boolean, alt?:boolean, target?:string}} [opts] */
    key(key, opts) {
      if (typeof key !== 'string' || !key) throw fail('E_BAD_ARG', 'key: a key string is required');
      const o = opts || {};
      let target = (typeof document !== 'undefined' ? document.body : null);
      if (o.target) target = requireEl(o.target);
      if (!target) throw fail('E_NO_ELEMENT', 'key: no target element');
      const code = key.length === 1
        ? (/[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : (/[0-9]/.test(key) ? 'Digit' + key : key))
        : key;
      const init = { key, code, bubbles: true, cancelable: true, ctrlKey: !!o.ctrl, shiftKey: !!o.shift, altKey: !!o.alt };
      target.dispatchEvent(new KeyboardEvent('keydown', init));
      target.dispatchEvent(new KeyboardEvent('keyup', init));
      flush();
    },
  });

  const SELFTEST_MODULES = Object.freeze(['core', 'geometry', 'pattern', 'body', 'cloth', 'viewer3d', 'sizing', 'export', 'ui']);

  const selftest = Object.freeze({
    /** @returns {string[]} */
    list() { return SELFTEST_MODULES.slice(); },

    /**
     * @param {string} [module] omitted or 'all' → every module; names are prefixed 'module/'
     * @returns {Promise<{name:string, pass:boolean, details:string}[]>}
     */
    async run(module) {
      const wanted = (module === undefined || module === null || module === '' || module === 'all')
        ? SELFTEST_MODULES.slice()
        : [String(module)];
      for (const m of wanted) {
        if (SELFTEST_MODULES.indexOf(m) < 0) throw fail('E_BAD_ARG', 'selftest.run: unknown module "' + m + '"');
      }
      /** @type {{name:string, pass:boolean, details:string}[]} */
      const out = [];
      for (const m of wanted) {
        let mod = null;
        try {
          mod = await import(`../${m}/selftest.js`);
        } catch (e) {
          out.push({ name: m + '/import', pass: false, details: 'import failed: ' + msgOf(e) });
          continue;
        }
        if (!mod || typeof mod.runSelfTest !== 'function') {
          out.push({ name: m + '/import', pass: false, details: 'selftest.js has no runSelfTest export' });
          continue;
        }
        try {
          const res = await mod.runSelfTest();
          const list = Array.isArray(res) ? res : [];
          for (const r of list) {
            out.push({ name: m + '/' + String(r && r.name), pass: !!(r && r.pass), details: String((r && r.details) || '') });
          }
          if (!list.length) out.push({ name: m + '/empty', pass: false, details: 'runSelfTest returned no results' });
        } catch (e) {
          out.push({ name: m + '/run', pass: false, details: 'threw: ' + msgOf(e) });
        }
      }
      return out;
    },
  });

  /** @type {any} */
  let lastAcceptance = null;

  const acceptance = Object.freeze({
    /** @param {string|RegExp} [filter] @param {{log?:boolean}} [opts] @returns {Promise<any>} */
    async run(filter, opts) {
      let mod;
      try {
        mod = await import('../../tests/acceptance.js');
      } catch (e) {
        throw fail('E_SELFTEST', 'acceptance: tests/acceptance.js failed to import — ' + msgOf(e), e);
      }
      if (!mod || typeof mod.runAcceptance !== 'function') throw fail('E_SELFTEST', 'acceptance: no runAcceptance export');
      const summary = await mod.runAcceptance(filter, opts);
      lastAcceptance = summary;
      return summary;
    },

    /** @returns {Promise<{id:string, name:string}[]>} */
    async list() {
      let mod;
      try {
        mod = await import('../../tests/acceptance.js');
      } catch (e) {
        throw fail('E_SELFTEST', 'acceptance: tests/acceptance.js failed to import — ' + msgOf(e), e);
      }
      return (mod.CHECKS || []).map((c) => ({ id: c.id, name: c.name }));
    },

    // accessor so `Object.freeze` still allows the suite to store its summary (13.1 rule 4)
    get last() { return lastAcceptance; },
    set last(v) { lastAcceptance = v; },
  });

  const viewerNs = Object.freeze({
    /** @returns {string} data URL */
    screenshotDataUrl() {
      const v = requireViewer();
      if (typeof v.screenshot !== 'function') throw fail('E_NOT_READY', 'viewer.screenshot is unavailable');
      return v.screenshot();
    },

    frame() {
      const v = requireViewer();
      if (typeof v.fit === 'function') v.fit();
    },

    /** @returns {number} */
    fps() {
      const v = ctx.mods && ctx.mods.viewer;
      if (!v || !v.loop) return 0;
      const f = v.loop.fps;
      if (typeof f === 'function') { try { return Number(f.call(v.loop)) || 0; } catch (_) { return 0; } }
      return Number(f) || 0;
    },

    resize() {
      const v = requireViewer();
      if (v.viewer && typeof v.viewer.resize === 'function') v.viewer.resize();
    },

    /** @param {string} pieceId @returns {object} LIVE three.js material */
    materialOf(pieceId) {
      const v = requireViewer();
      requirePiece(String(pieceId));
      const st = ctx.cloth && ctx.cloth.state;
      let k = -1;
      const topo = v.cloth && (typeof v.cloth.topology === 'function' ? safeCall(() => v.cloth.topology()) : v.cloth.topology);
      if (topo && Array.isArray(topo.pieces)) k = topo.pieces.findIndex((p) => (p.pieceId || p.id) === String(pieceId));
      if (k < 0 && st && Array.isArray(st.pieces)) k = st.pieces.findIndex((p) => p.pieceId === String(pieceId));
      if (k < 0) throw fail('E_NO_PIECE', 'materialOf: piece ' + pieceId + ' is not in the cloth mesh');
      const obj = v.cloth && v.cloth.object;
      const mat = obj && obj.material;
      if (!mat) throw fail('E_NOT_READY', 'materialOf: the cloth mesh has no material yet');
      const m = Array.isArray(mat) ? mat[k] : mat;
      if (!m) throw fail('E_NOT_READY', 'materialOf: no material at index ' + k);
      return m;
    },
  });

  // ---------------------------------------------------------------- the api object

  const api = {
    get version() { return String(ctx.version || '1.0.0'); },
    get ready() { return readyPromise(); },
    bus: ctx.bus,
    ctx,

    /** @returns {{t:number, level:string, message:string, code:string|null}[]} copy, oldest first */
    log() { return (ctx.log || []).slice().map((e) => ({ t: e.t, level: e.level, message: e.message, code: e.code || null })); },

    // ---- document ----
    /** @returns {ProjectDoc} deep copy */
    doc() { return docCopy(); },

    /** @param {(d: ProjectDoc) => void} fn @param {string} [label] @returns {ProjectDoc} */
    update(fn, label) {
      if (typeof fn !== 'function') throw fail('E_BAD_ARG', 'update: fn must be a function');
      commit(fn, label === undefined || label === null ? 'API update' : String(label));
      return docCopy();
    },

    /** @returns {boolean} */
    undo() {
      const ok = !!store().undo();
      if (ok) flush();
      return ok;
    },

    /** @returns {boolean} */
    redo() {
      const ok = !!store().redo();
      if (ok) flush();
      return ok;
    },

    /** @param {ProjectDoc|string} d @returns {ProjectDoc} */
    load(d) { return loadDoc(d, 'Load project'); },

    /** @param {string} id @returns {ProjectDoc} */
    loadSample(id) {
      let sample;
      try {
        sample = getSample(String(id));
      } catch (e) {
        throw fail('E_NO_SAMPLE', 'no such sample: ' + String(id), e);
      }
      return loadDoc(sample, 'Load sample: ' + String(id));
    },

    /**
     * Resolves after wiring.flush(), one animation frame and one macrotask.
     * The animation frame is raced against a timer: a hidden or background tab never fires
     * requestAnimationFrame, and automation (the acceptance suite awaits idle() constantly) must not hang there.
     * @returns {Promise<void>}
     */
    async idle() {
      flush();
      if (typeof requestAnimationFrame === 'function') {
        await new Promise((res) => {
          let done = false;
          const finish = () => { if (!done) { done = true; res(undefined); } };
          requestAnimationFrame(finish);
          setTimeout(finish, IDLE_FRAME_TIMEOUT_MS);
        });
      }
      await new Promise((res) => { setTimeout(res, 0); });
      flush();
    },

    /** @returns {string} */
    save() { return serializeDoc(liveDoc()); },

    pattern,
    mesh,
    body,
    sim,
    fabric,
    sizes,
    export: exportNs,
    ui: uiNs,
    selftest,
    acceptance,
    viewer: viewerNs,
  };

  Object.freeze(api);
  if (typeof window !== 'undefined') window.__app = api;
  return api;
}

// ------------------------------------------------------------------ log plumbing

/** @param {any} e @returns {string} */
function msgOf(e) {
  return String((e && e.message) || e);
}

/** @param {any} e @returns {string|null} */
function codeOf(e) {
  return (e && e.code) ? String(e.code) : null;
}

/** @param {() => any} fn @returns {any} */
function safeCall(fn) {
  try { return fn(); } catch (_) { return null; }
}

/**
 * Append to ctx.log (ring buffer, last 200), dropping an immediate duplicate of the previous line
 * (main.js's own error handler and ours can both see the same failure).
 * @param {any} ctx @param {'info'|'warn'|'error'} level @param {string} message @param {string|null} [code]
 */
function logLine(ctx, level, message, code) {
  if (!ctx || !Array.isArray(ctx.log)) return;
  const t = nowMs();
  const last = ctx.log[ctx.log.length - 1];
  if (last && last.level === level && last.message === message && t - last.t < 20) return;
  ctx.log.push({ t, level, message: String(message), code: code || null });
  while (ctx.log.length > 200) ctx.log.shift();
}

/**
 * Emit a status message (the status bar listens) and record it in ctx.log.
 * @param {any} ctx @param {'info'|'warn'|'error'} level @param {string} text @param {string} [code]
 */
function status(ctx, level, text, code) {
  logLine(ctx, level, text, code || null);
  try {
    if (ctx.bus) ctx.bus.emit(EVENT.UI_STATUS, { level, text, source: 'debugApi', code: code || undefined });
  } catch (_) { /* the bus isolates listener errors */ }
}

/**
 * Route uncaught errors, rejections and console.error into ctx.log as level 'error' (SPEC 13.2).
 * Idempotent: a second install (or main.js's own handlers) does not duplicate entries — logLine dedupes.
 * @param {any} ctx
 */
function installErrorHooks(ctx) {
  if (ctx.__debugApiHooks) return;
  ctx.__debugApiHooks = true;
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('error', (ev) => {
      const e = /** @type {any} */ (ev);
      logLine(ctx, 'error', 'uncaught: ' + String((e && e.message) || e), 'E_UNCAUGHT');
    });
    window.addEventListener('unhandledrejection', (ev) => {
      const e = /** @type {any} */ (ev);
      logLine(ctx, 'error', 'unhandled rejection: ' + msgOf(e && e.reason), 'E_UNCAUGHT');
    });
  }
  if (typeof console !== 'undefined' && typeof console.error === 'function' && !(/** @type {any} */ (console.error).__appPatched)) {
    const original = console.error;
    const patched = function patchedConsoleError(...args) {
      try {
        logLine(ctx, 'error', args.map((a) => (a && a.message) ? String(a.message) : String(a)).join(' '), 'E_CONSOLE');
      } catch (_) { /* never let logging break console.error */ }
      return original.apply(console, args);
    };
    /** @type {any} */ (patched).__appPatched = true;
    /** @type {any} */ (patched).__original = original;
    console.error = patched;
  }
}
