// src/pattern/editor.js — the 2D pattern editor controller (SPEC 11.9.1): pointer routing, selection, tools,
// pure piece ops and the store writes. Imports only src/core and src/geometry (+ the sibling pattern files).

import { EVENT } from '../core/events.js';
import { uid } from '../core/ids.js';
import { clamp } from '../core/units.js';
import {
  signedArea, isSimplePolygon, bbox as bboxOf, splitEdge as geoSplitEdge, mirrorPoint,
} from '../geometry/index.js';
import { createView } from './view.js';
import { hitTest } from './hit.js';
import { render } from './render2d.js';
import { validateDoc } from './validate.js';
import { makeSeam, remapAfterEdgeChange, seamOfEdge } from './seams.js';
import { createSelectTool } from './tools/select.js';
import { createDrawTool } from './tools/draw.js';
import { createEditTool } from './tools/edit.js';
import { createSplitTool } from './tools/split.js';
import { createSeamTool } from './tools/seam.js';
import { createNotchTool } from './tools/notch.js';
import { createGrainlineTool } from './tools/grainline.js';
import { createMeasureTool } from './tools/measure.js';

/** @typedef {import('../core/types.js').Vec2} Vec2 */
/** @typedef {import('../core/types.js').Edge} Edge */
/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').Seam} Seam */
/** @typedef {import('../core/types.js').SeamSide} SeamSide */
/** @typedef {import('../core/types.js').Issue} Issue */
/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */
/** @typedef {import('./hit.js').Hit} Hit */
/** @typedef {'select'|'draw'|'edit'|'split'|'seam'|'notch'|'grainline'|'measure'} ToolName */

/** Tool names in toolbar order. */
export const EDITOR_TOOLS = Object.freeze(['select', 'draw', 'edit', 'split', 'seam', 'notch', 'grainline', 'measure']);

/** Movement in CSS px below which a down/up pair is a click, not a drag. */
export const DRAG_THRESHOLD_PX = 3;
/** Vertex snap radius, CSS px. */
export const SNAP_VERTEX_PX = 6;

/** @param {string} code @param {string} message @returns {Error & {code:string}} */
function patternError(code, message) {
  const err = /** @type {Error & {code:string}} */ (new Error(message));
  err.code = code;
  return err;
}

// =====================================================================================================
// Pure piece ops (SPEC 11.9.1). None of them touches the store; each returns fresh objects.
// =====================================================================================================

/** @param {Vec2} p @returns {Vec2} */
function cp(p) {
  return [p[0], p[1]];
}

/** @param {Edge} e @returns {Edge} */
function cloneEdge(e) {
  /** @type {Edge} */
  const out = { type: e.type === 'cubic' ? 'cubic' : 'line' };
  if (e.type === 'cubic') {
    if (e.c1) out.c1 = cp(e.c1);
    if (e.c2) out.c2 = cp(e.c2);
  }
  if (e.allowance_mm !== undefined) out.allowance_mm = e.allowance_mm;
  if (e.label !== undefined) out.label = e.label;
  return out;
}

/** Deep copy of a piece (JSON-shaped). @param {Piece} piece @returns {Piece} */
export function clonePieceLocal(piece) {
  return /** @type {Piece} */ ({
    ...piece,
    vertices: piece.vertices.map(cp),
    edges: piece.edges.map(cloneEdge),
    notches: (piece.notches || []).map((n) => ({ edge: n.edge, t: n.t, kind: n.kind })),
    grainline: { a: cp(piece.grainline.a), b: cp(piece.grainline.b) },
    internalLines: (piece.internalLines || []).map((l) => ({ kind: l.kind, points: l.points.map(cp) })),
    pinnedEdges: Array.isArray(piece.pinnedEdges) ? piece.pinnedEdges.slice() : [],
    placement: { ...piece.placement, offset_mm: cp(piece.placement.offset_mm) },
    grade: { ...piece.grade, vertexRules: (piece.grade.vertexRules || []).map((r) => ({ ...r })) },
  });
}

/** Identity edge map of a piece. @param {Piece} piece @returns {number[]} */
function identityMap(piece) {
  return piece.edges.map((_e, i) => i);
}

/**
 * Translate vertices, control points, grainline and internal lines.
 * @param {Piece} piece @param {number} dx @param {number} dy @returns {Piece}
 */
export function opTranslate(piece, dx, dy) {
  const out = clonePieceLocal(piece);
  for (const v of out.vertices) {
    v[0] += dx;
    v[1] += dy;
  }
  for (const e of out.edges) {
    if (e.c1) {
      e.c1[0] += dx;
      e.c1[1] += dy;
    }
    if (e.c2) {
      e.c2[0] += dx;
      e.c2[1] += dy;
    }
  }
  out.grainline.a[0] += dx;
  out.grainline.a[1] += dy;
  out.grainline.b[0] += dx;
  out.grainline.b[1] += dy;
  for (const l of out.internalLines) {
    for (const p of l.points) {
      p[0] += dx;
      p[1] += dy;
    }
  }
  return out;
}

/**
 * Split outline edge `e` at arc-length fraction `t`. Refuses the fold edge (`PATTERN_FOLD_SPLIT`).
 * @param {Piece} piece @param {number} e @param {number} t @returns {{piece: Piece, map: number[]}}
 */
export function opSplitEdge(piece, e, t) {
  const n = piece.vertices.length;
  if (!(e >= 0 && e < n)) throw patternError('PATTERN_BAD_OUTLINE', 'Edge ' + e + ' does not exist');
  if (piece.foldEdge !== null && piece.foldEdge !== undefined && e === piece.foldEdge) {
    throw patternError('PATTERN_FOLD_SPLIT', 'The fold edge cannot be split');
  }
  const tt = clamp(t, 0.02, 0.98);
  const res = geoSplitEdge(piece, e, tt);
  const out = /** @type {Piece} */ (res.piece);
  const map = res.edgeMap;
  /** @type {number[]} */
  const pinned = [];
  for (const k of (piece.pinnedEdges || [])) {
    if (k === e) {
      pinned.push(e, e + 1);
    } else if (map[k] !== undefined && map[k] >= 0) {
      pinned.push(map[k]);
    }
  }
  out.pinnedEdges = Array.from(new Set(pinned)).sort((a, b) => a - b);
  if (piece.foldEdge !== null && piece.foldEdge !== undefined) {
    out.foldEdge = piece.foldEdge > e ? piece.foldEdge + 1 : piece.foldEdge;
  }
  return { piece: out, map };
}

/** Alias of `opSplitEdge` used by the edit tool. @returns {{piece: Piece, map: number[]}} */
export function opInsertVertex(piece, e, t) {
  return opSplitEdge(piece, e, t);
}

/**
 * Delete vertex `i`; edges i−1 and i merge into one line edge. Refuses below 4 vertices (`PATTERN_MIN_VERTICES`).
 * @param {Piece} piece @param {number} i @returns {{piece: Piece, map: number[]}}
 */
export function opDeleteVertex(piece, i) {
  const n = piece.vertices.length;
  if (n <= 3) throw patternError('PATTERN_MIN_VERTICES', 'A piece needs at least 3 vertices');
  if (!(i >= 0 && i < n)) throw patternError('PATTERN_BAD_OUTLINE', 'Vertex ' + i + ' does not exist');
  const prev = (i - 1 + n) % n;
  const out = clonePieceLocal(piece);

  /** @type {number[]} */
  const map = new Array(n);
  for (let k = 0; k < n; k++) map[k] = (k === i) ? -1 : (k < i ? k : k - 1);

  /** @type {Vec2[]} */
  const vertices = [];
  for (let k = 0; k < n; k++) if (k !== i) vertices.push(cp(piece.vertices[k]));
  /** @type {Edge[]} */
  const edges = [];
  for (let k = 0; k < n; k++) {
    if (k === i) continue;
    if (k === prev) {
      /** @type {Edge} */
      const merged = { type: 'line' };
      if (piece.edges[k].label !== undefined) merged.label = piece.edges[k].label;
      if (piece.edges[k].allowance_mm !== undefined) merged.allowance_mm = piece.edges[k].allowance_mm;
      edges.push(merged);
    } else {
      edges.push(cloneEdge(piece.edges[k]));
    }
  }
  out.vertices = vertices;
  out.edges = edges;
  out.notches = (piece.notches || [])
    .filter((nt) => nt.edge !== i && nt.edge !== prev)
    .map((nt) => ({ edge: map[nt.edge], t: nt.t, kind: nt.kind }));
  const pinned = new Set();
  for (const k of (piece.pinnedEdges || [])) if (map[k] >= 0) pinned.add(map[k]);
  out.pinnedEdges = Array.from(pinned).sort((a, b) => a - b);
  if (piece.foldEdge !== null && piece.foldEdge !== undefined) {
    out.foldEdge = (piece.foldEdge === i || piece.foldEdge === prev) ? null : map[piece.foldEdge];
  }
  out.grade = {
    ...out.grade,
    vertexRules: (piece.grade.vertexRules || [])
      .filter((r) => r.vertex !== i)
      .map((r) => ({ ...r, vertex: r.vertex < i ? r.vertex : r.vertex - 1 })),
  };
  return { piece: out, map };
}

/**
 * Mirror the piece across x = 0 keeping the loop CCW. New edge j = old edge n−1−j with c1/c2 swapped.
 * @param {Piece} piece @returns {{piece: Piece, map: number[]}}
 */
export function opReflectX(piece) {
  const n = piece.vertices.length;
  const out = clonePieceLocal(piece);
  /** @type {number[]} */
  const map = new Array(n);
  for (let k = 0; k < n; k++) map[k] = n - 1 - k;

  /** @type {Vec2[]} */
  const vertices = new Array(n);
  for (let j = 0; j < n; j++) {
    const src = piece.vertices[(n - j) % n];
    vertices[j] = [-src[0], src[1]];
  }
  /** @type {Edge[]} */
  const edges = new Array(n);
  for (let j = 0; j < n; j++) {
    const old = piece.edges[n - 1 - j];
    const e = cloneEdge(old);
    if (old.type === 'cubic' && old.c1 && old.c2) {
      e.c1 = [-old.c2[0], old.c2[1]];
      e.c2 = [-old.c1[0], old.c1[1]];
    }
    edges[j] = e;
  }
  out.vertices = vertices;
  out.edges = edges;
  out.notches = (piece.notches || []).map((nt) => ({ edge: map[nt.edge], t: 1 - nt.t, kind: nt.kind }));
  const pinned = new Set();
  for (const k of (piece.pinnedEdges || [])) if (map[k] !== undefined) pinned.add(map[k]);
  out.pinnedEdges = Array.from(pinned).sort((a, b) => a - b);
  out.foldEdge = (piece.foldEdge === null || piece.foldEdge === undefined) ? null : map[piece.foldEdge];
  out.grainline = { a: [-piece.grainline.a[0], piece.grainline.a[1]], b: [-piece.grainline.b[0], piece.grainline.b[1]] };
  out.internalLines = (piece.internalLines || []).map((l) => ({ kind: l.kind, points: l.points.map((p) => /** @type {Vec2} */ ([-p[0], p[1]])) }));
  out.grade = {
    ...out.grade,
    vertexRules: (piece.grade.vertexRules || []).map((r) => ({
      ...r,
      vertex: (n - r.vertex) % n,
      dx_mm: -r.dx_mm,
    })),
  };
  return { piece: out, map };
}

/**
 * Set the fold edge (`PATTERN_FOLD_NOT_ON_AXIS` when the edge is curved or off the y axis).
 * @param {Piece} piece @param {number} e @returns {{piece: Piece, map: number[]}}
 */
export function opSetFold(piece, e) {
  const n = piece.vertices.length;
  if (!(e >= 0 && e < n)) throw patternError('PATTERN_BAD_OUTLINE', 'Edge ' + e + ' does not exist');
  if (piece.edges[e].type !== 'line') throw patternError('PATTERN_FOLD_NOT_ON_AXIS', 'The fold edge must be straight');
  const p0 = piece.vertices[e];
  const p1 = piece.vertices[(e + 1) % n];
  if (Math.abs(p0[0]) > 0.01 || Math.abs(p1[0]) > 0.01) {
    throw patternError('PATTERN_FOLD_NOT_ON_AXIS', 'The fold edge must lie on x = 0');
  }
  const out = clonePieceLocal(piece);
  out.foldEdge = e;
  out.edges[e].allowance_mm = 0;
  out.grade = { ...out.grade, anchorX: 'fold' };
  return { piece: out, map: identityMap(piece) };
}

/** Clear the fold edge. @param {Piece} piece @returns {{piece: Piece, map: number[]}} */
export function opClearFold(piece) {
  const out = clonePieceLocal(piece);
  const old = piece.foldEdge;
  out.foldEdge = null;
  if (old !== null && old !== undefined && out.edges[old] && out.edges[old].allowance_mm === 0) {
    delete out.edges[old].allowance_mm;
  }
  if (out.grade.anchorX === 'fold') out.grade = { ...out.grade, anchorX: 'center' };
  return { piece: out, map: identityMap(piece) };
}

/**
 * Reverse both arrays when the loop is clockwise (new edge j = old edge n−1−j, c1/c2 swapped).
 * @param {Vec2[]} vertices @param {Edge[]} edges @returns {{vertices: Vec2[], edges: Edge[]}}
 */
export function makeCcw(vertices, edges) {
  const n = vertices.length;
  const verts = vertices.map(cp);
  const es = edges.map(cloneEdge);
  if (signedArea(verts) >= 0) return { vertices: verts, edges: es };
  /** @type {Vec2[]} */
  const outV = new Array(n);
  for (let j = 0; j < n; j++) outV[j] = cp(verts[(n - j) % n]);
  /** @type {Edge[]} */
  const outE = new Array(n);
  for (let j = 0; j < n; j++) {
    const old = es[n - 1 - j];
    const e = cloneEdge(old);
    if (old.type === 'cubic' && old.c1 && old.c2) {
      e.c1 = cp(old.c2);
      e.c2 = cp(old.c1);
    }
    outE[j] = e;
  }
  return { vertices: outV, edges: outE };
}

/**
 * Snapping used by the tools: 1 mm grid (unless ctrl), vertex snap within 6 px, 45° constraint from an anchor.
 * `doc`/`view` are optional; without them only grid and 45° snapping apply.
 * @param {Vec2} p
 * @param {{ctrl?:boolean, shift?:boolean, anchor?:Vec2|null, doc?:ProjectDoc|null, view?:object|null}} [opts]
 * @returns {Vec2}
 */
export function snapPoint(p, opts) {
  const o = opts || {};
  /** @type {Vec2} */
  let q = o.ctrl ? [p[0], p[1]] : [Math.round(p[0]), Math.round(p[1])];

  if (o.doc && o.view) {
    const view = /** @type {any} */ (o.view);
    const pxPerMm = view.get().pxPerMm;
    const tolMm = SNAP_VERTEX_PX / (pxPerMm > 0 ? pxPerMm : 1);
    let best = null;
    let bestD = tolMm;
    for (const piece of (o.doc.pieces || [])) {
      if (!piece || !Array.isArray(piece.vertices)) continue;
      const fe = piece.foldEdge;
      const foldX = (fe !== null && fe !== undefined && piece.vertices[fe]) ? piece.vertices[fe][0] : null;
      for (const v of piece.vertices) {
        const cands = foldX === null ? [v] : [v, mirrorPoint(v, foldX)];
        for (const c of cands) {
          const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
          if (d <= bestD) {
            bestD = d;
            best = c;
          }
        }
      }
    }
    if (best) return [best[0], best[1]];
  }

  if (o.shift && o.anchor) {
    const ax = o.anchor[0];
    const ay = o.anchor[1];
    const dx = q[0] - ax;
    const dy = q[1] - ay;
    const len = Math.hypot(dx, dy);
    if (len > 1e-9) {
      const step = Math.PI / 4;
      const ang = Math.round(Math.atan2(dy, dx) / step) * step;
      q = [ax + Math.cos(ang) * len, ay + Math.sin(ang) * len];
      if (!o.ctrl) q = [Math.round(q[0]), Math.round(q[1])];
    }
  }
  return q;
}

// =====================================================================================================
// createEditor
// =====================================================================================================

/** @returns {object} the default (empty) selection */
function emptySelection() {
  return { pieces: [], seams: [], vertex: null, edge: null, edgeMirror: false, handle: null, notch: null };
}

/**
 * @param {HTMLCanvasElement} canvas @param {object} store @param {object} bus @param {{autoFit?:boolean}} [opts]
 * @returns {object} Editor (SPEC 11.9.1)
 */
export function createEditor(canvas, store, bus, opts = {}) {
  const autoFit = opts.autoFit !== false;
  let destroyed = false;

  /** @type {object} */
  let selection = emptySelection();
  /** @type {Hit|null} */
  let hover = null;
  /** @type {Issue[]} */
  let issues = [];
  /** @type {Record<string,string>} */
  const fabricPreview = {};
  /** @type {Piece[]|null} */
  let ghost = null;
  let activeSize = '';
  /** @type {ToolName} */
  let toolName = 'select';
  /** @type {Array<(hit:Hit|null)=>void>} */
  const hoverSubscribers = [];

  let renderQueued = false;
  let validateQueued = false;
  let validateDirty = true;
  let hoverQueued = false;
  /** @type {object|null} */
  let pendingHover = null;
  let lastIssueKey = '';

  const view = createView(canvas, onViewChange, () => store.get());

  /** @param {string} name @param {*} payload */
  function emit(name, payload) {
    try {
      bus.emit(name, payload);
    } catch (_e) {
      /* an unknown-name or listener error must never break the editor */
    }
  }

  function onViewChange() {
    if (destroyed) return;
    const v = view.get();
    emit(EVENT.VIEW2D_CHANGED, { pxPerMm: v.pxPerMm, panMm: [v.cx, v.cy], width: v.width, height: v.height });
    requestRender();
  }

  // ---- rendering ---------------------------------------------------------------------------------
  /**
   * Schedules `fn` for the next animation frame, with a timer fallback so scheduled work (validation,
   * hover events) still runs when frames are not delivered (hidden tab, headless harness).
   * @param {() => void} fn
   */
  function nextFrame(fn) {
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      fn();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(once);
    setTimeout(once, 32);
  }

  function requestRender() {
    if (destroyed || renderQueued) return;
    renderQueued = true;
    nextFrame(() => {
      renderQueued = false;
      if (!destroyed) renderNow();
    });
  }

  function renderNow() {
    if (!canvas || typeof canvas.getContext !== 'function') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const v = view.get();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    try {
      render(ctx, view, store.get(), {
        selection, hover, transient: getTransient(), issues, fabricPreview, activeSize, ghost,
      });
    } catch (err) {
      emit(EVENT.UI_STATUS, { level: 'warn', text: '2D render failed: ' + (err && err.message), source: 'pattern' });
    }
  }

  // ---- validation --------------------------------------------------------------------------------
  function runValidation() {
    validateDirty = false;
    try {
      issues = validateDoc(store.get());
    } catch (_e) {
      issues = [];
    }
    const key = issues.length + '|' + issues.map((i) => i.code + (i.pieceId || i.seamId || '')).join(',');
    if (key !== lastIssueKey) {
      lastIssueKey = key;
      emit(EVENT.PATTERN_ISSUES, { issues: issues.slice() });
    }
  }

  function scheduleValidation() {
    validateDirty = true;
    if (validateQueued) return;
    validateQueued = true;
    nextFrame(() => {
      validateQueued = false;
      if (!destroyed && validateDirty) runValidation();
    });
  }

  // ---- selection ---------------------------------------------------------------------------------
  /** @param {object} sel @returns {object} frozen copy */
  function freezeSelection(sel) {
    return Object.freeze({
      pieces: Object.freeze(sel.pieces.slice()),
      seams: Object.freeze(sel.seams.slice()),
      vertex: sel.vertex ? Object.freeze({ ...sel.vertex }) : null,
      edge: sel.edge ? Object.freeze({ ...sel.edge }) : null,
      edgeMirror: !!sel.edgeMirror,
      handle: sel.handle ? Object.freeze({ ...sel.handle }) : null,
      notch: sel.notch ? Object.freeze({ ...sel.notch }) : null,
    });
  }

  /** @param {object} a @param {object} b @returns {boolean} */
  function sameSelection(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /**
   * Normalise a partial selection (both the 3.2 spelling and the older pieceIds/seamId/vertex-index spelling).
   * @param {object} partial @param {{additive?:boolean}} [o]
   */
  function select(partial, o) {
    if (destroyed) return;
    const doc = store.get();
    const known = new Set((doc.pieces || []).map((p) => p.id));
    const knownSeams = new Set((doc.seams || []).map((s) => s.id));
    const p = partial || {};
    const prev = selection;

    /** @type {string[]} */
    let pieces;
    if (Array.isArray(p.pieces)) pieces = p.pieces.slice();
    else if (Array.isArray(p.pieceIds)) pieces = p.pieceIds.slice();
    else if (typeof p.pieceId === 'string') pieces = [p.pieceId];
    else if (p.pieceId === null || p.pieces === null || p.pieceIds === null) pieces = [];
    else pieces = prev.pieces.slice();
    pieces = pieces.filter((id) => known.has(id));
    if (o && o.additive) {
      const merged = prev.pieces.filter((id) => known.has(id));
      for (const id of pieces) if (merged.indexOf(id) < 0) merged.push(id);
      pieces = merged;
    }
    const primary = pieces.length ? pieces[pieces.length - 1] : null;

    /** @type {string[]} */
    let seams;
    if (Array.isArray(p.seams)) seams = p.seams.slice();
    else if ('seamId' in p) seams = (typeof p.seamId === 'string') ? [p.seamId] : [];
    else seams = prev.seams.slice();
    seams = seams.filter((id) => knownSeams.has(id));

    /** @param {*} v @param {string} key @returns {object|null} */
    const point = (v, key) => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'number') return primary ? { pieceId: primary, [key]: v } : null;
      if (typeof v === 'object' && typeof v.pieceId === 'string') {
        const value = v[key] !== undefined ? v[key] : v.index;
        return { pieceId: v.pieceId, [key]: value };
      }
      return null;
    };

    const vertex = ('vertex' in p) ? point(p.vertex, 'index') : prev.vertex;
    const edge = ('edge' in p) ? point(p.edge, 'edge') : prev.edge;
    const notch = ('notch' in p) ? point(p.notch, 'index') : prev.notch;
    let handle = ('handle' in p) ? p.handle : prev.handle;
    if (handle && (typeof handle !== 'object' || typeof handle.pieceId !== 'string')) handle = null;

    const next = {
      pieces,
      seams,
      vertex: (vertex && known.has(vertex.pieceId)) ? vertex : null,
      edge: (edge && known.has(edge.pieceId)) ? edge : null,
      edgeMirror: ('edgeMirror' in p) ? !!p.edgeMirror : !!prev.edgeMirror,
      handle: (handle && known.has(handle.pieceId)) ? handle : null,
      notch: (notch && known.has(notch.pieceId)) ? notch : null,
    };
    applySelection(next);
  }

  /** @param {object} next */
  function applySelection(next) {
    if (sameSelection(next, selection)) return;
    const prev = freezeSelection(selection);
    selection = next;
    const frozen = freezeSelection(selection);
    store.transient.selection = frozen;
    emit(EVENT.SELECTION_CHANGED, { selection: frozen, prev });
    requestRender();
  }

  function clearSelection() {
    applySelection(emptySelection());
  }

  /** Drop selection entries whose ids or indices disappeared from the document. */
  function pruneSelection() {
    const doc = store.get();
    const byId = new Map((doc.pieces || []).map((p) => [p.id, p]));
    const seamIds = new Set((doc.seams || []).map((s) => s.id));
    const next = {
      pieces: selection.pieces.filter((id) => byId.has(id)),
      seams: selection.seams.filter((id) => seamIds.has(id)),
      vertex: selection.vertex,
      edge: selection.edge,
      edgeMirror: selection.edgeMirror,
      handle: selection.handle,
      notch: selection.notch,
    };
    const v = next.vertex;
    if (v && (!byId.has(v.pieceId) || v.index >= byId.get(v.pieceId).vertices.length)) next.vertex = null;
    const e = next.edge;
    if (e && (!byId.has(e.pieceId) || e.edge >= byId.get(e.pieceId).edges.length)) next.edge = null;
    const h = next.handle;
    if (h && (!byId.has(h.pieceId) || h.edge >= byId.get(h.pieceId).edges.length)) next.handle = null;
    const nt = next.notch;
    if (nt && (!byId.has(nt.pieceId) || nt.index >= (byId.get(nt.pieceId).notches || []).length)) next.notch = null;
    applySelection(next);
  }

  // ---- tool context ------------------------------------------------------------------------------
  /** @param {string} label @param {(d:ProjectDoc)=>any} mutator @returns {ProjectDoc} */
  function commit(label, mutator) {
    return store.update(mutator, label);
  }

  /** @param {string} text @param {'info'|'warn'|'error'} [level] */
  function status(text, level) {
    emit(EVENT.UI_STATUS, { level: level || 'info', text, source: 'pattern' });
  }

  /**
   * @param {{a:SeamSide|null, b:SeamSide|null, lenA_mm:number, lenB_mm:number, easePct:number,
   *          level:'ok'|'warn'|'error', seamId:string|null}|null} preview
   */
  function setSeamEase(preview) {
    if (preview === null) {
      store.transient.seamPick = null;
      emit(EVENT.SEAM_PREVIEW, { a: null, b: null, lenA_mm: 0, lenB_mm: 0, easePct: 0, level: 'ok', seamId: null });
      return;
    }
    store.transient.seamPick = preview.a || null;
    emit(EVENT.SEAM_PREVIEW, preview);
  }

  /** @param {Vec2} p @param {{ctrl?:boolean, shift?:boolean, anchor?:Vec2|null}} [o] @returns {Vec2} */
  function snap(p, o) {
    return snapPoint(p, { ...(o || {}), doc: store.get(), view });
  }

  /** @type {object} */
  const editorApi = {};

  const ctx = {
    store,
    bus,
    view,
    editor: editorApi,
    commit,
    status,
    setSeamEase,
    snap,
    getSelection: () => selection,
    requestRender: () => requestRender(),
  };

  /** @type {Record<string, any>} */
  const tools = {
    select: createSelectTool(ctx),
    draw: createDrawTool(ctx),
    edit: createEditTool(ctx),
    split: createSplitTool(ctx),
    seam: createSeamTool(ctx),
    notch: createNotchTool(ctx),
    grainline: createGrainlineTool(ctx),
    measure: createMeasureTool(ctx),
  };
  let tool = tools.select;

  /** @returns {object} */
  function getTransient() {
    let t = {};
    try {
      t = tool.transient() || {};
    } catch (_e) {
      t = {};
    }
    return { ...t, toolName };
  }

  /** @param {ToolName} name */
  function setTool(name) {
    if (EDITOR_TOOLS.indexOf(name) < 0) throw patternError('PATTERN_BAD_TOOL', 'Unknown tool: ' + name);
    if (name === toolName) return;
    const prev = toolName;
    try {
      tool.cancel();
    } catch (_e) { /* ignore */ }
    try {
      tool.deactivate();
    } catch (_e) { /* ignore */ }
    toolName = name;
    tool = tools[name];
    try {
      tool.activate();
    } catch (_e) { /* ignore */ }
    store.transient.tool = name;
    emit(EVENT.TOOL_CHANGED, { tool: name, prev });
    requestRender();
  }

  // ---- pointer routing ---------------------------------------------------------------------------
  let panning = false;
  let spaceDown = false;
  let pressed = false;
  let lastPx = 0;
  let lastPy = 0;

  /** @param {object} ev @returns {Hit|null} */
  function hitOf(ev) {
    try {
      return hitTest(store.get(), view, ev.x, ev.y, { selection, tool: toolName });
    } catch (_e) {
      return null;
    }
  }

  /** @param {Hit|null} h @param {Vec2|null} mm */
  function queueHover(h, mm) {
    const doc = store.get();
    let seamId = null;
    if (h && h.kind === 'edge') {
      const s = seamOfEdge(doc, h.pieceId, h.index, h.mirror === true);
      seamId = s ? s.id : null;
    }
    pendingHover = {
      mm: mm ? [mm[0], mm[1]] : null,
      pieceId: h ? h.pieceId : null,
      edge: h && h.kind === 'edge' ? h.index : null,
      vertex: h && h.kind === 'vertex' ? h.index : null,
      seamId,
    };
    if (hoverQueued) return;
    hoverQueued = true;
    nextFrame(() => {
      hoverQueued = false;
      if (destroyed || !pendingHover) return;
      emit(EVENT.HOVER_CHANGED, pendingHover);
      store.transient.hover = pendingHover;
      pendingHover = null;
    });
  }

  /** @param {Hit|null} h */
  function setHover(h) {
    const same = (!h && !hover)
      || (h && hover && h.kind === hover.kind && h.pieceId === hover.pieceId && h.index === hover.index
        && h.which === hover.which && h.mirror === hover.mirror);
    if (same) return;
    hover = h;
    for (const cb of hoverSubscribers.slice()) {
      try {
        cb(h);
      } catch (_e) { /* isolated */ }
    }
    requestRender();
  }

  /** @param {object} ev PointerLike */
  function handlePointer(ev) {
    if (destroyed || !ev) return;
    const px = ev.x;
    const py = ev.y;

    if (ev.type === 'wheel') {
      const dy = Number.isFinite(ev.deltaY) ? ev.deltaY : 0;
      view.zoomBy(Math.pow(1.1, -dy / 100), px, py);
      return;
    }
    if (ev.type === 'leave') {
      setHover(null);
      pendingHover = { mm: null, pieceId: null, edge: null, vertex: null, seamId: null };
      emit(EVENT.HOVER_CHANGED, pendingHover);
      store.transient.hover = pendingHover;
      pendingHover = null;
      return;
    }

    // 1. middle button / space = pan
    if (ev.type === 'down' && (ev.button === 1 || (spaceDown && ev.button === 0))) {
      panning = true;
      lastPx = px;
      lastPy = py;
      return;
    }
    if (panning) {
      if (ev.type === 'move') {
        view.panBy(px - lastPx, py - lastPy);
        lastPx = px;
        lastPy = py;
        return;
      }
      if (ev.type === 'up' || ev.type === 'cancel') {
        panning = false;
        return;
      }
      return;
    }

    const w = view.screenToWorld(px, py);
    const hit = hitOf(ev);

    if (ev.type === 'move') queueHover(hit, /** @type {Vec2} */ ([w[0], w[1]]));
    if (ev.type === 'move' && !pressed) setHover(hit);

    /** @type {object} */
    const te = {
      type: ev.type,
      x_mm: w[0],
      y_mm: w[1],
      px,
      py,
      shift: !!ev.shift,
      alt: !!ev.alt,
      ctrl: !!ev.ctrl,
      button: ev.button === undefined ? 0 : ev.button,
      hit,
    };

    try {
      if (ev.type === 'down') {
        pressed = true;
        tool.onDown(te);
      } else if (ev.type === 'move') {
        tool.onMove(te);
      } else if (ev.type === 'up') {
        pressed = false;
        tool.onUp(te);
      } else if (ev.type === 'cancel') {
        pressed = false;
        tool.cancel();
      } else if (ev.type === 'dblclick') {
        tool.onDblClick(te);
      }
    } catch (err) {
      status('Tool error: ' + (err && err.message ? err.message : String(err)), 'warn');
    }

    if (canvas && canvas.style) {
      try {
        canvas.style.cursor = tool.cursor(hover);
      } catch (_e) { /* ignore */ }
    }
    requestRender();
  }

  // ---- DOM wiring --------------------------------------------------------------------------------
  /** @param {PointerEvent|MouseEvent} e @param {string} type @returns {object} */
  function toPointerLike(e, type) {
    const rect = (canvas && typeof canvas.getBoundingClientRect === 'function')
      ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    return {
      type,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      button: /** @type {any} */ (e).button,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
      deltaY: /** @type {any} */ (e).deltaY,
    };
  }

  const onPointerDown = (e) => {
    if (canvas.setPointerCapture && e.pointerId !== undefined) {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_err) { /* ignore */ }
    }
    if (typeof canvas.focus === 'function') {
      try {
        canvas.focus({ preventScroll: true });
      } catch (_err) { /* ignore */ }
    }
    handlePointer(toPointerLike(e, 'down'));
  };
  const onPointerMove = (e) => handlePointer(toPointerLike(e, 'move'));
  const onPointerUp = (e) => {
    if (canvas.releasePointerCapture && e.pointerId !== undefined) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_err) { /* ignore */ }
    }
    handlePointer(toPointerLike(e, 'up'));
  };
  const onPointerCancel = (e) => handlePointer(toPointerLike(e, 'cancel'));
  const onDblClick = (e) => handlePointer(toPointerLike(e, 'dblclick'));
  const onWheel = (e) => {
    e.preventDefault();
    handlePointer(toPointerLike(e, 'wheel'));
  };
  const onContextMenu = (e) => e.preventDefault();
  const onPointerLeave = () => handlePointer({ type: 'leave', x: 0, y: 0 });
  const onKeyDown = (e) => {
    if (e.code === 'Space') spaceDown = true;
  };
  const onKeyUp = (e) => {
    if (e.code === 'Space') spaceDown = false;
  };

  if (canvas && typeof canvas.addEventListener === 'function') {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('pointerleave', onPointerLeave);
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
  }

  // ---- store subscription ------------------------------------------------------------------------
  const unsubscribe = store.subscribe((change) => {
    if (destroyed) return;
    pruneSelection();
    if (change.origin === 'replace') {
      selection = emptySelection();
      store.transient.selection = freezeSelection(selection);
      emit(EVENT.SELECTION_CHANGED, { selection: freezeSelection(selection), prev: freezeSelection(selection) });
      if (autoFit) view.fitToPieces();
    }
    if (change.origin !== 'drag') scheduleValidation();
    requestRender();
  });

  // ---- bus subscriptions -------------------------------------------------------------------------
  let lastLayout = null;
  const onSizeActive = (p) => {
    activeSize = p && p.size ? p.size : '';
    requestRender();
  };
  const onFabricChanged = (p) => {
    if (p && p.fabricId && p.resolved && p.resolved.look) fabricPreview[p.fabricId] = p.resolved.look.color;
    requestRender();
  };
  const onUiLayout = (p) => {
    view.resize();
    if (p && p.layout && p.layout !== lastLayout) {
      lastLayout = p.layout;
      view.fitToPieces();
    }
    requestRender();
  };
  try {
    bus.on(EVENT.SIZE_ACTIVE, onSizeActive);
    bus.on(EVENT.FABRIC_CHANGED, onFabricChanged);
    bus.on(EVENT.UI_LAYOUT, onUiLayout);
  } catch (_e) { /* a bus without these names is still usable */ }

  // ---- document-level operations -----------------------------------------------------------------
  /**
   * @param {Vec2[]} vertices @param {Partial<Piece>} [partial] @returns {string} new piece id
   */
  function addPiece(vertices, partial) {
    if (!Array.isArray(vertices) || vertices.length < 3) {
      throw patternError('PATTERN_BAD_OUTLINE', 'A piece needs at least 3 vertices');
    }
    const doc = store.get();
    const made = makeCcw(vertices.map((v) => /** @type {Vec2} */ ([v[0], v[1]])), vertices.map(() => ({ type: 'line' })));
    if (!isSimplePolygon(made.vertices)) throw patternError('PATTERN_BAD_OUTLINE', 'The outline crosses itself');
    const box = bboxOf(made.vertices);
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    const h = Math.max(box.maxY - box.minY, 0);
    const half = Math.max(0.3 * h, 10);
    const id = uid('piece');
    /** @type {Piece} */
    const piece = {
      id,
      name: 'Piece ' + (doc.pieces.length + 1),
      vertices: made.vertices,
      edges: made.edges,
      foldEdge: null,
      notches: [],
      grainline: { a: [cx, cy - half], b: [cx, cy + half] },
      internalLines: [],
      seamAllowance_mm: 10,
      fabricId: (doc.fabrics && doc.fabrics[0]) ? doc.fabrics[0].id : 'main',
      layer: 0,
      cutQty: 1,
      exportHidden: false,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'torso', side: 'front', offset_mm: [0, 0], wrap: 0.8, flip: false },
      grade: { widthRef: 'chest_cm', lengthRef: 'torsoLength_cm', anchorX: 'center', anchorY: 'top', vertexRules: [] },
      meshSpacing_mm: 15,
      ...(partial || {}),
    };
    if (partial && Array.isArray(partial.vertices)) {
      const remade = makeCcw(partial.vertices.map((v) => [v[0], v[1]]),
        Array.isArray(partial.edges) ? partial.edges : partial.vertices.map(() => ({ type: 'line' })));
      piece.vertices = remade.vertices;
      piece.edges = remade.edges;
    }
    if (piece.vertices.length < 3 || piece.edges.length !== piece.vertices.length) {
      throw patternError('PATTERN_BAD_OUTLINE', 'edges.length must equal vertices.length');
    }
    commit('piece:add', (d) => {
      d.pieces.push(piece);
    });
    return id;
  }

  /** @param {SeamSide} a @param {SeamSide} b @param {boolean} [reverse] @returns {string} */
  function addSeam(a, b, reverse) {
    const seam = makeSeam(store.get(), a, b, reverse);
    commit('seam:add', (d) => {
      d.seams.push({ id: seam.id, a: { ...seam.a }, b: { ...seam.b }, kind: seam.kind });
    });
    return seam.id;
  }

  /** @param {string} seamId */
  function removeSeam(seamId) {
    commit('seam:delete', (d) => {
      d.seams = d.seams.filter((s) => s.id !== seamId);
    });
  }

  /** Delete the selected pieces (and their seams), or the selected seam. */
  function deleteSelectionFallback() {
    if (selection.seams.length && selection.edge) {
      const id = selection.seams[0];
      removeSeam(id);
      select({ seams: [] });
      return;
    }
    if (!selection.pieces.length) return;
    const ids = selection.pieces.slice();
    commit('piece:delete', (d) => {
      d.pieces = d.pieces.filter((p) => ids.indexOf(p.id) < 0);
      d.seams = d.seams.filter((s) => ids.indexOf(s.a.pieceId) < 0 && ids.indexOf(s.b.pieceId) < 0);
    });
    clearSelection();
  }

  function deleteSelection() {
    if (tool.onDelete) {
      let handled = false;
      try {
        handled = !!tool.onDelete();
      } catch (err) {
        status(err && err.message ? err.message : String(err), 'warn');
        handled = true;
      }
      if (handled) return;
    }
    deleteSelectionFallback();
  }

  /** @param {number} dx @param {number} dy */
  function nudge(dx, dy) {
    if (tool.nudge) {
      let handled = false;
      try {
        handled = !!tool.nudge(dx, dy);
      } catch (err) {
        status(err && err.message ? err.message : String(err), 'warn');
        handled = true;
      }
      if (handled) return;
    }
    if (!selection.pieces.length) return;
    const ids = selection.pieces.slice();
    commit('piece:move', (d) => {
      for (let i = 0; i < d.pieces.length; i++) {
        if (ids.indexOf(d.pieces[i].id) >= 0) d.pieces[i] = opTranslate(d.pieces[i], dx, dy);
      }
    });
  }

  function cancel() {
    let had = false;
    try {
      had = !!tool.cancel();
    } catch (_e) { /* ignore */ }
    if (!had) clearSelection();
    requestRender();
  }

  function confirm() {
    try {
      tool.confirm();
    } catch (err) {
      status(err && err.message ? err.message : String(err), 'warn');
    }
    requestRender();
  }

  /** The Fold button (SPEC 11.10.9). */
  function mirror() {
    if (selection.pieces.length !== 1) {
      status('Select one piece', 'warn');
      return;
    }
    const pieceId = selection.pieces[0];
    const doc = store.get();
    const piece = (doc.pieces || []).find((p) => p.id === pieceId);
    if (!piece) return;

    if (piece.foldEdge !== null && piece.foldEdge !== undefined) {
      commit('piece:foldClear', (d) => {
        const i = d.pieces.findIndex((p) => p.id === pieceId);
        if (i >= 0) d.pieces[i] = opClearFold(d.pieces[i]).piece;
      });
      status('Fold cleared');
      return;
    }

    const selEdge = (selection.edge && selection.edge.pieceId === pieceId) ? selection.edge.edge : null;
    if (selEdge === null || !piece.edges[selEdge] || piece.edges[selEdge].type !== 'line') {
      status('Select a straight edge to place on the fold', 'warn');
      return;
    }
    const n = piece.vertices.length;
    const x0 = piece.vertices[selEdge][0];
    const y0 = piece.vertices[selEdge][1];
    const x1 = piece.vertices[(selEdge + 1) % n][0];
    if (Math.abs(x1 - x0) > 0.5) {
      status('The fold edge must be vertical', 'warn');
      return;
    }
    void y0;

    /** @type {number} */
    let finalEdge = selEdge;
    /** @type {string[]} */
    let removedSeams = [];
    commit('piece:foldSet', (d) => {
      const i = d.pieces.findIndex((p) => p.id === pieceId);
      if (i < 0) return;
      let p = opTranslate(d.pieces[i], -x0, 0);
      let e = selEdge;
      /** @type {number[]|null} */
      let map = null;
      let crosses = false;
      for (const v of p.vertices) if (v[0] < -0.01) crosses = true;
      if (crosses) {
        const r = opReflectX(p);
        p = r.piece;
        map = r.map;
        e = map[e];
      }
      const m = p.vertices.length;
      p.vertices[e][0] = 0;
      p.vertices[(e + 1) % m][0] = 0;
      p = opSetFold(p, e).piece;
      if (map) removedSeams = removeSeamIds(remapAfterEdgeChange(d, pieceId, map));
      d.pieces[i] = p;
      finalEdge = e;
      const dropped = d.seams.filter((s) => (s.a.pieceId === pieceId && s.a.edge === e) || (s.b.pieceId === pieceId && s.b.edge === e));
      if (dropped.length) {
        removedSeams = removedSeams.concat(dropped.map((s) => s.id));
        d.seams = d.seams.filter((s) => dropped.indexOf(s) < 0);
      }
    });
    if (removedSeams.length) status('Seam removed by the fold (re-create it on the half you need)', 'warn');
    status('Fold set on edge ' + finalEdge + ' — the piece is mirrored across x = 0 at mesh time');
  }

  /** @param {string[]} ids @returns {string[]} */
  function removeSeamIds(ids) {
    return Array.isArray(ids) ? ids.slice() : [];
  }

  // ---- public facade -----------------------------------------------------------------------------
  Object.assign(editorApi, {
    setTool,
    getTool: () => toolName,
    getSelection: () => freezeSelection(selection),
    select,
    clearSelection,
    view,
    injectPointer: handlePointer,
    cancel,
    confirm,
    deleteSelection,
    nudge,
    mirror,
    addPiece,
    addSeam,
    removeSeam,
    getIssues: () => {
      if (validateDirty) runValidation();
      return issues.slice();
    },
    requestRender,
    renderNow,
    getTransient,
    /** @param {(hit:Hit|null)=>void} cb @returns {() => void} */
    onHover: (cb) => {
      hoverSubscribers.push(cb);
      return () => {
        const i = hoverSubscribers.indexOf(cb);
        if (i >= 0) hoverSubscribers.splice(i, 1);
      };
    },
    // --- convenience aliases used by the app shell -------------------------------------------------
    resize: () => {
      view.resize();
      requestRender();
    },
    fit: () => view.fitToPieces(),
    worldToScreen: (x, y) => view.worldToScreen(x, y),
    screenToWorld: (px, py) => view.screenToWorld(px, py),
    /** @param {Piece[]|null} pieces graded ghost outlines, computed by the app (src/sizing) */
    setGhost: (pieces) => {
      ghost = Array.isArray(pieces) && pieces.length ? pieces : null;
      requestRender();
    },
    /** @param {Issue[]} list */
    setIssues: (list) => {
      issues = Array.isArray(list) ? list.slice() : [];
      validateDirty = false;
      emit(EVENT.PATTERN_ISSUES, { issues: issues.slice() });
      requestRender();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      try {
        unsubscribe();
      } catch (_e) { /* ignore */ }
      try {
        bus.off(EVENT.SIZE_ACTIVE, onSizeActive);
        bus.off(EVENT.FABRIC_CHANGED, onFabricChanged);
        bus.off(EVENT.UI_LAYOUT, onUiLayout);
      } catch (_e) { /* ignore */ }
      if (canvas && typeof canvas.removeEventListener === 'function') {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerCancel);
        canvas.removeEventListener('dblclick', onDblClick);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('contextmenu', onContextMenu);
        canvas.removeEventListener('pointerleave', onPointerLeave);
      }
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
      }
      view.destroy();
      hoverSubscribers.length = 0;
    },
  });

  store.transient.tool = toolName;
  store.transient.selection = freezeSelection(selection);
  activeSize = (store.get().ui && store.get().ui.activeSize) || '';
  if (autoFit) view.fitToPieces();
  scheduleValidation();
  requestRender();
  return editorApi;
}
