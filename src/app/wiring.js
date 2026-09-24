// src/app/wiring.js — the reaction table (SPEC 12.2). The ONLY file that calls one module's API in reaction to
// another module's event, and the only listener of `ui:action`. Owns the per-frame tick, the debounced rebuild
// pipeline and the fingerprint diffing of 12.2.3. Never imports three (the viewer is reached through ctx.mods.viewer).

import { EVENT } from '../core/events.js';
import { hashString } from '../core/ids.js';
import { normalizeDoc, serializeDoc, parseDoc, normalizePiece } from '../core/schema.js';
import { shouldOffer } from './autosave.js';
import { resolveFabric, resolveAll, diffResolved } from '../core/fabrics.js';

// Namespace imports: a module that is still a stub (or lost an export) shows up as `undefined` at the call site,
// caught by guard(), instead of an uncatchable module-link error that would blank the page.
import * as geometryMod from '../geometry/index.js';
import * as clothMod from '../cloth/index.js';
import * as patternMod from '../pattern/index.js';
import * as sizingMod from '../sizing/index.js';
import * as exportMod from '../export/index.js';
import * as samplesMod from '../samples/index.js';
import * as dxfMod from '../dxf/index.js';

/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */
/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').PieceMesh} PieceMesh */
/** @typedef {import('../core/types.js').ClothState} ClothState */
/** @typedef {import('../core/types.js').BodyModel} BodyModel */
/** @typedef {import('../core/types.js').BodyParams} BodyParams */
/** @typedef {import('../core/types.js').SimStats} SimStats */
/** @typedef {import('../core/types.js').Issue} Issue */

/**
 * App-internal composition state (src/app only). Not part of the frozen core contracts. See SPEC 12.0.
 * @typedef {Object} AppContext
 * @property {import('../core/store.js').Store} store
 * @property {import('../core/events.js').EventBus} bus
 * @property {{sample: string|null, nosim: boolean, size: string|null, acceptance: boolean}} params
 * @property {HTMLElement} root
 * @property {{ui: object|null, editor: object|null, viewer: object|null}} mods
 * @property {{body: object|null, viewer3d: object|null}} modules   module namespaces loaded with await import()
 * @property {{model: BodyModel|null, quality: 'full'|'coarse'|null, key: number}} body
 * @property {{byPiece: Map<string, PieceMesh>, failed: Map<string, string>, keys: Map<string, number>, spacingFactor: number}} mesh
 * @property {{state: ClothState|null, stale: boolean, lastStats: SimStats|null, running: boolean, userPaused: boolean,
 *   phase: string, stepping: boolean, nanEvents: number[], dirty: boolean, errorPaused: boolean}} cloth
 * @property {{build: Map<string, number>, arrange: Map<string, number>, seams: number, body: number,
 *   fabrics: Map<string, number>, sim: number, sizes: number}} keys
 * @property {{remeshTimer: number, remeshSet: Set<string>, remeshAll: boolean, bodyTimer: number,
 *   bodyQuality: 'full'|'coarse'|null, dragTimer: number, dragParams: BodyParams|null}} pending
 * @property {{stage: string, code: string, message: string}[]} bootErrors
 * @property {{t: number, level: 'info'|'warn'|'error', message: string, code: string|null}[]} log
 * @property {number} lastStatsPush
 * @property {number} bootStartMs
 * @property {string|null} lastActiveSize
 * @property {((level: string, text: string, code?: string|null) => void)|null} showStatus
 */

/**
 * @typedef {Object} Keys
 * @property {Map<string, number>} mesh
 * @property {Map<string, number>} build
 * @property {Map<string, number>} arrange
 * @property {number} seams
 * @property {number} body
 * @property {Map<string, number>} fabrics
 * @property {number} sim
 * @property {number} sizes
 */

/**
 * @typedef {Object} Wiring
 * @property {() => void} start
 * @property {() => void} stop
 * @property {() => void} flush
 * @property {() => {remesh: boolean, body: 'full'|'coarse'|null}} pending
 * @property {(opts?: {drape?: boolean}) => void} rebuildAll
 * @property {(pieceIds: string[]|null, opts?: {force?: boolean}) => PieceMesh[]} remesh
 * @property {() => ClothState|null} rebuildCloth
 * @property {() => void} arrange
 * @property {() => void} drape
 * @property {() => void} play
 * @property {() => void} pause
 * @property {() => void} reset
 * @property {(quality: 'full'|'coarse', params?: BodyParams) => BodyModel|null} buildBody
 * @property {(fabricId: string) => void} applyFabric
 * @property {() => void} applySimSettings
 * @property {(name: string) => void} setActiveSize
 * @property {(n: number) => SimStats|null} stepFrames
 * @property {(dtMs: number, frame: number) => void} tick
 * @property {(doc: ProjectDoc) => Keys} computeKeys
 */

const REMESH_DEBOUNCE_MS = 120;
const BODY_DEBOUNCE_MS = 150;
const DRAG_THROTTLE_MS = 100;
const STATUS_STATS_MS = 150;   // ~6.7 Hz status-bar pushes (spec: 4–10 Hz)
const VERTEX_CAP = 8000;
const HEX_DENSITY = 0.433;     // vertices per h^2 of a hex lattice (12.2.5)

/** @returns {number} */
function nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

/** How often the tear overlay is recomputed while the sim runs (ms). */
export const TEAR_INTERVAL_MS = 400;

/** @param {number} n @returns {string} */
function fmtInt(n) {
  return String(Math.round(n));
}

/**
 * Fill in any AppContext slot the caller left out, so wiring never crashes on a partial ctx.
 * @param {any} ctx @returns {AppContext}
 */
function ensureCtx(ctx) {
  const c = ctx || /** @type {any} */ ({});
  if (!c.params) c.params = { sample: null, nosim: false, size: null, acceptance: false };
  if (!c.mods) c.mods = { ui: null, editor: null, viewer: null };
  if (!c.modules) c.modules = { body: null, viewer3d: null };
  if (!c.body) c.body = { model: null, quality: null, key: 0 };
  if (!c.mesh) c.mesh = { byPiece: new Map(), failed: new Map(), keys: new Map(), spacingFactor: 1 };
  if (!c.cloth) {
    c.cloth = {
      state: null, stale: false, lastStats: null, running: false, userPaused: false,
      phase: 'empty', stepping: false, nanEvents: [], dirty: false, errorPaused: false,
      tears: null, lastTearMs: 0,
    };
  }
  if (!c.keys) {
    c.keys = { build: new Map(), arrange: new Map(), seams: 0, body: 0, fabrics: new Map(), sim: 0, sizes: 0 };
  }
  if (!c.pending) {
    c.pending = {
      remeshTimer: 0, remeshSet: new Set(), remeshAll: false,
      bodyTimer: 0, bodyQuality: null, dragTimer: 0, dragParams: null,
    };
  }
  if (!Array.isArray(c.bootErrors)) c.bootErrors = [];
  if (!Array.isArray(c.log)) c.log = [];
  if (typeof c.lastStatsPush !== 'number') c.lastStatsPush = 0;
  if (typeof c.lastActiveSize === 'undefined') c.lastActiveSize = null;
  if (!c.fabricResolved) c.fabricResolved = new Map();
  return /** @type {AppContext} */ (c);
}

/**
 * The reaction table. Creating it subscribes to nothing: call `start()` (the boot does it last, SPEC 12.1.3).
 * @param {AppContext} ctx
 * @returns {Wiring}
 */
export function createWiring(ctx) {
  ctx = ensureCtx(ctx);

  /** @type {(() => void)[]} */
  const unsubs = [];
  let started = false;
  let capBusy = false;
  let lastNanCount = 0;
  let slowFrames = 0;
  let lastSlowWarn = 0;
  let lastDragBuild = 0;

  // ---------------------------------------------------------------- small accessors

  /** @returns {ProjectDoc|null} */
  function doc() {
    return ctx.store ? ctx.store.get() : null;
  }
  /** @returns {any} */
  function ui() { return (ctx.mods && ctx.mods.ui) || null; }
  /** @returns {any} */
  function editor() { return (ctx.mods && ctx.mods.editor) || null; }
  /** @returns {any} */
  function viewer() { return (ctx.mods && ctx.mods.viewer) || null; }
  /** @returns {any} */
  function bodyMod() { return (ctx.modules && ctx.modules.body) || null; }

  /** @param {'info'|'warn'|'error'} level @param {string} text @param {string} [code] */
  function showStatus(level, text, code) {
    if (typeof ctx.showStatus === 'function') {
      try { ctx.showStatus(level, text, code || null); return; } catch (_) { /* fall through */ }
    }
    try {
      ctx.log.push({ t: Date.now(), level, message: text, code: code || null });
      while (ctx.log.length > 200) ctx.log.shift();
    } catch (_) { /* ignore */ }
    try { ctx.bus.emit(EVENT.UI_STATUS, { level, text, source: 'wiring', code: code || null }); } catch (_) { /* ignore */ }
  }

  /** @param {string} name @param {unknown} err */
  function handleError(name, err) {
    const e = /** @type {any} */ (err);
    const code = e && e.code ? String(e.code) : 'E_REACTION';
    const message = String((e && e.message) || err);
    try { console.error('[wiring] ' + name + ':', err); } catch (_) { /* ignore */ }
    showStatus('error', name + ': ' + message, code);
  }

  /**
   * Wrap an event handler so a throwing module can never stop the app.
   * @param {string} name @param {(payload:any) => void} fn @returns {(payload:any) => void}
   */
  function guard(name, fn) {
    return function guarded(payload) {
      try { fn(payload); } catch (err) { handleError(name, err); }
    };
  }

  /** @param {string} name @param {() => any} fn @param {any} [fallback] @returns {any} */
  function tryCall(name, fn, fallback) {
    try { return fn(); } catch (err) { handleError(name, err); return fallback; }
  }

  /** @param {string} name @param {any} payload */
  function emit(name, payload) {
    try { ctx.bus.emit(name, payload); } catch (err) { handleError('emit ' + name, err); }
  }

  // ---------------------------------------------------------------- 12.2.3 fingerprints

  /** @param {any} value @returns {number} */
  function keyOf(value) {
    return hashString(JSON.stringify(value));
  }

  /**
   * Length of an outline edge in mm; 0 when the piece/edge is unusable.
   * @param {Piece} piece @param {number} edge @returns {number}
   */
  function edgeLengthMm(piece, edge) {
    try {
      if (!piece || !Array.isArray(piece.vertices) || !(edge >= 0) || edge >= piece.vertices.length) return 0;
      return geometryMod.edgeLength(piece, edge) || 0;
    } catch (_) { return 0; }
  }

  /**
   * The seam-partner part of a mesh fingerprint (12.2.3).
   * @param {ProjectDoc} d @param {string} pieceId @returns {any[]}
   */
  function seamsTouching(d, pieceId) {
    /** @type {any[]} */
    const out = [];
    const seams = Array.isArray(d.seams) ? d.seams.slice() : [];
    seams.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    for (const seam of seams) {
      for (const sideName of ['a', 'b']) {
        const side = seam[sideName];
        if (!side || side.pieceId !== pieceId) continue;
        const other = seam[sideName === 'a' ? 'b' : 'a'];
        const otherPiece = d.pieces.find((p) => p.id === other.pieceId) || null;
        out.push([
          seam.id, side.edge, !!side.mirror, !!side.reverse,
          other.pieceId, other.edge, !!other.mirror,
          Math.round(edgeLengthMm(/** @type {any} */ (otherPiece), other.edge) * 100),
        ]);
      }
    }
    return out;
  }


  /**
   * The document as it should be SIMULATED: the pieces graded to the active size (SPEC 10.2).
   *
   * The size chart exists so a pattern can be cut for a range of bodies, and until now it only reached the 2D ghost
   * and the exports — the 3D view always draped the base size, so choosing L or XL changed the printed pattern but
   * not the garment on the model. Grading here makes the viewport show the size the user actually selected, and it is
   * what lets a bigger body wear the garment at all: on `male_l` the base-size T-shirt reaches 19.3% strain at p99,
   * because it is simply the wrong size for that body, not because the solver is wrong.
   *
   * `gradeDoc(doc, baseSize)` returns deep copies equal to `doc.pieces`, so at the base size this is a no-op beyond
   * the clone. Grading preserves piece ids and edge counts, so `doc.seams` still resolves and seam parity is kept.
   * @param {ProjectDoc} d @returns {ProjectDoc}
   */
  function simDoc(d) {
    const size = d.ui && d.ui.activeSize;
    if (!size || !d.sizes || size === d.sizes.baseSize) return d;
    try {
      const graded = sizingMod.gradeDoc(d, size);
      if (Array.isArray(graded) && graded.length === d.pieces.length) return { ...d, pieces: graded };
    } catch (err) {
      const e = /** @type {any} */ (err);
      showStatus('warn', 'Size ' + size + ' could not be graded: ' + String((e && e.message) || err)
        + ' — draping the base size', e && e.code ? String(e.code) : 'GradeError');
    }
    return d;
  }

  /** @param {ProjectDoc} d @param {Piece} p @returns {number} */
  function meshKeyOf(d, p) {
    return keyOf({
      v: p.vertices, e: p.edges, f: p.foldEdge, n: p.notches,
      h: p.meshSpacing_mm, sf: ctx.mesh.spacingFactor, s: seamsTouching(d, p.id),
      z: (d.ui && d.ui.activeSize) || '', g: p.grade,
    });
  }

  /**
   * Fingerprints of the whole document (12.2.3).
   * @param {ProjectDoc} d @returns {Keys}
   */
  function computeKeys(d) {
    /** @type {Keys} */
    const keys = {
      mesh: new Map(), build: new Map(), arrange: new Map(),
      seams: 0, body: 0, fabrics: new Map(), sim: 0, sizes: 0,
    };
    if (!d) return keys;
    const pieces = Array.isArray(d.pieces) ? d.pieces : [];
    for (const p of pieces) {
      keys.mesh.set(p.id, meshKeyOf(d, p));
      keys.build.set(p.id, keyOf({
        fabricId: p.fabricId, layer: p.layer, pinnedEdges: p.pinnedEdges, simulate: p.simulate,
      }));
      keys.arrange.set(p.id, keyOf(p.placement));
    }
    const seams = (Array.isArray(d.seams) ? d.seams.slice() : [])
      .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    keys.seams = keyOf(seams);
    const params = (d.body && d.body.params) || {};
    /** @type {any} */
    const sortedParams = {};
    for (const k of Object.keys(params).sort()) sortedParams[k] = /** @type {any} */ (params)[k];
    keys.body = keyOf(sortedParams);
    for (const f of (Array.isArray(d.fabrics) ? d.fabrics : [])) keys.fabrics.set(f.id, keyOf(f));
    keys.sim = keyOf(d.sim);
    keys.sizes = keyOf(d.sizes);
    return keys;
  }

  // ---------------------------------------------------------------- meshes

  /** @returns {PieceMesh[]} meshes in doc.pieces order */
  function meshList() {
    const d = doc();
    /** @type {PieceMesh[]} */
    const out = [];
    if (!d) return out;
    for (const p of d.pieces) {
      const m = ctx.mesh.byPiece.get(p.id);
      if (m) out.push(m);
    }
    return out;
  }

  /** @returns {number} */
  function totalVerts() {
    let n = 0;
    for (const m of ctx.mesh.byPiece.values()) n += m.vertexCount | 0;
    return n;
  }

  /** Drop cached meshes of pieces that vanished or stopped simulating. @param {ProjectDoc} d @returns {boolean} */
  function pruneMeshes(d) {
    let dropped = false;
    for (const id of Array.from(ctx.mesh.byPiece.keys())) {
      const p = d.pieces.find((x) => x.id === id);
      if (!p || !p.simulate) {
        ctx.mesh.byPiece.delete(id);
        ctx.mesh.keys.delete(id);
        dropped = true;
      }
    }
    return dropped;
  }

  /**
   * Remesh pieces (SPEC 12.2.2). `null` = every simulate piece. A RemeshError excludes that piece only.
   * @param {string[]|null} pieceIds @param {{force?: boolean}} [opts] @returns {PieceMesh[]}
   */
  function remesh(pieceIds, opts) {
    const d0 = doc();
    if (!d0) return [];
    const d = simDoc(d0);
    const force = !!(opts && opts.force);
    pruneMeshes(d);
    const ids = pieceIds && pieceIds.length
      ? pieceIds.slice()
      : d.pieces.filter((p) => p.simulate).map((p) => p.id);
    /** @type {PieceMesh[]} */
    const built = [];
    for (const id of ids) {
      const piece = d.pieces.find((p) => p.id === id);
      if (!piece || !piece.simulate) {
        ctx.mesh.byPiece.delete(id);
        ctx.mesh.keys.delete(id);
        continue;
      }
      const key = meshKeyOf(d, piece);
      const cached = ctx.mesh.byPiece.get(id);
      if (!force && cached && ctx.mesh.keys.get(id) === key) { built.push(cached); continue; }
      try {
        const mesh = geometryMod.remeshPiece(piece, d, { spacingFactor: ctx.mesh.spacingFactor });
        ctx.mesh.byPiece.set(id, mesh);
        ctx.mesh.keys.set(id, key);
        ctx.mesh.failed.delete(id);
        built.push(mesh);
      } catch (err) {
        const e = /** @type {any} */ (err);
        const message = String((e && e.message) || err);
        ctx.mesh.byPiece.delete(id);
        ctx.mesh.keys.delete(id);
        ctx.mesh.failed.set(id, message);
        showStatus('warn', id + ': ' + message + ' — piece excluded from simulation', e && e.code ? String(e.code) : 'RemeshError');
      }
    }
    return built;
  }

  /** Remesh every simulate piece ignoring fingerprints, without re-entering the vertex cap. */
  function remeshAllForced() {
    const d0 = doc();
    if (!d0) return;
    const d = simDoc(d0);
    for (const p of d.pieces) {
      if (!p.simulate) continue;
      try {
        const mesh = geometryMod.remeshPiece(p, d, { spacingFactor: ctx.mesh.spacingFactor });
        ctx.mesh.byPiece.set(p.id, mesh);
        ctx.mesh.keys.set(p.id, meshKeyOf(d, p));
        ctx.mesh.failed.delete(p.id);
      } catch (err) {
        const e = /** @type {any} */ (err);
        ctx.mesh.byPiece.delete(p.id);
        ctx.mesh.keys.delete(p.id);
        ctx.mesh.failed.set(p.id, String((e && e.message) || err));
      }
    }
  }

  /** SPEC 12.2.5 — keep the simulation under VERTEX_CAP vertices by raising the spacing factor. */
  function applyVertexCap() {
    if (capBusy) return;
    const d = doc();
    if (!d) return;
    capBusy = true;
    try {
      const total = totalVerts();
      if (total > VERTEX_CAP) {
        const prev = ctx.mesh.spacingFactor;
        const next = Math.min(4, prev * Math.sqrt(total / VERTEX_CAP) * 1.05);
        if (next > prev * 1.001) {
          ctx.mesh.spacingFactor = next;
          remeshAllForced();
          showStatus('warn', 'Mesh spacing raised ×' + next.toFixed(2) + ' to stay under ' + VERTEX_CAP + ' vertices', 'E_VERTEX_CAP');
        }
      } else if (ctx.mesh.spacingFactor > 1) {
        // Would the stored spacing fit again? Hex-lattice estimate, section 12.2.5.
        let estimate = 0;
        for (const m of ctx.mesh.byPiece.values()) {
          const piece = d.pieces.find((p) => p.id === m.pieceId);
          let h = 15;
          try { h = geometryMod.effectiveSpacing(piece, 1); } catch (_) { h = 15; }
          if (!(h > 0)) h = 15;
          estimate += (m.area_mm2 || 0) / (HEX_DENSITY * h * h);
        }
        if (estimate <= VERTEX_CAP) {
          ctx.mesh.spacingFactor = 1;
          remeshAllForced();
          showStatus('info', 'Mesh spacing back to normal (' + fmtInt(totalVerts()) + ' v)', null);
        }
      }
    } finally {
      capBusy = false;
    }
  }

  // ---------------------------------------------------------------- cloth build / arrange / phases

  /** @param {ProjectDoc} d @returns {Record<string, any>} */
  function fabricsByPiece(d) {
    /** @type {Record<string, any>} */
    const out = {};
    const resolved = resolveAll(d);
    for (const p of d.pieces) {
      const r = resolved.get(p.fabricId);
      if (r) out[p.id] = r;
    }
    return out;
  }

  /** Build a NEW ClothState without touching ctx (used for the atomic swap). @returns {ClothState|null} */
  function buildClothState() {
    const d0 = doc();
    if (!d0) return null;
    const meshes = meshList();
    if (meshes.length === 0) return null;
    // The graded document, so the piece the solver reads is the piece the mesh came from.
    return clothMod.buildCloth({ meshes, doc: simDoc(d0), fabrics: resolveAll(d0) });
  }

  /** Apply doc.sim to a state (in place). @param {ClothState} state */
  function applySettingsTo(state) {
    const d = doc();
    if (!d || !state) return;
    clothMod.setSettings(state, d.sim);
    clothMod.setScale(state, d.sim.bendScale, d.sim.stretchScale);
  }

  /**
   * SPEC 12.2 `rebuildCloth`: build + install + emit sim:built. Returns null when nothing can be simulated.
   * @returns {ClothState|null}
   */
  function rebuildCloth() {
    const t0 = nowMs();
    const meshes = meshList();
    let state = null;
    try {
      state = buildClothState();
    } catch (err) {
      ctx.cloth.stale = true;
      handleError('rebuildCloth', err);
      return ctx.cloth.state;
    }
    if (!state) {
      ctx.cloth.state = null;
      ctx.cloth.lastStats = null;
      ctx.cloth.running = false;
      setPhase('empty');
      return null;
    }
    applySettingsTo(state);
    ctx.cloth.state = state;
    ctx.cloth.stale = false;
    ctx.cloth.lastStats = null;
    ctx.cloth.dirty = true;
    lastNanCount = state.nanCount | 0;
    rememberFabrics();
    emit(EVENT.SIM_BUILT, { state, meshes, ms: nowMs() - t0 });
    return state;
  }

  /** Cache the resolved fabrics so applyFabric can diff against them. */
  function rememberFabrics() {
    const d = doc();
    if (!d) return;
    for (const f of d.fabrics) {
      try { ctx.fabricResolved.set(f.id, resolveFabric(f)); } catch (_) { /* ignore */ }
    }
  }

  /** @param {ClothState} state */
  function arrangeState(state) {
    const d0 = doc();
    if (!d0 || !state) return;
    const d = simDoc(d0);
    const model = ctx.body.model;
    if (!model) {
      showStatus('warn', 'No body model — the garment cannot be arranged', 'E_NO_BODY');
      return;
    }
    clothMod.arrange(state, model, d);
    if (model.sdf) clothMod.pushOut(state, model.sdf);
    ctx.cloth.dirty = true;
    lastNanCount = state.nanCount | 0;
  }

  /** SPEC 12.2: arrange the live state. */
  function arrange() {
    const state = ctx.cloth.state;
    if (!state) return;
    arrangeState(state);
    syncViewer(true);
    setPhase(computePhase());
  }

  /** @param {boolean} [force] */
  function syncViewer(force) {
    const v = viewer();
    const state = ctx.cloth.state;
    if (!v || !state) return;
    try { v.sync(state, !!force); } catch (err) { handleError('viewer.sync', err); }
    if (force) ctx.cloth.dirty = false;
    syncTears(state, !!force);
  }

  /**
   * Refresh the "this is where it is failing" overlay. Scanning every edge costs about the same as one
   * solver substep, so it runs on a timer rather than per frame — the markers only need to track the
   * garment's slow settling, not its per-frame jitter. Nothing is shown while the seams are still
   * closing: mid-sewing the panels are legitimately far apart and everything would light up.
   * @param {ClothState} state @param {boolean} force
   */
  function syncTears(state, force) {
    const v = viewer();
    if (!v || typeof v.setTears !== 'function') return;
    const now = nowMs();
    if (!force && now - ctx.cloth.lastTearMs < TEAR_INTERVAL_MS) return;
    ctx.cloth.lastTearMs = now;
    const d = doc();
    const sew = d && d.sim && Number.isFinite(d.sim.sewTime_s) ? d.sim.sewTime_s : 1;
    if (state.time < sew + 0.5) { v.setTears(null); ctx.cloth.tears = null; return; }
    try {
      const report = clothMod.findTears(state);
      ctx.cloth.tears = report;
      v.setTears(report.marks);
    } catch (err) { handleError('viewer.setTears', err); }
  }

  /** Push a freshly built state into the viewer (geometry rebuild). @param {ClothState} state */
  function installClothInViewer(state) {
    const v = viewer();
    const d = doc();
    if (!v || !state || !d) return;
    try {
      v.setCloth(state, fabricsByPiece(d));
      v.sync(state, true);
      ctx.cloth.dirty = false;
    } catch (err) { handleError('viewer.setCloth', err); }
  }

  /** @returns {number} sew time + 0.5 s (12.2.6) */
  function sewSwitchTime() {
    const d = doc();
    const sew = d && d.sim && Number.isFinite(d.sim.sewTime_s) ? d.sim.sewTime_s : 1;
    return sew + 0.5;
  }

  /** @returns {string} */
  function computePhase() {
    const state = ctx.cloth.state;
    if (!state) return 'empty';
    if (ctx.cloth.errorPaused) return 'error';
    if (ctx.cloth.running) return state.time < sewSwitchTime() ? 'sewing' : 'draping';
    if ((state.frame | 0) === 0) return 'arranged';
    return 'paused';
  }

  /** @param {string} next */
  function setPhase(next) {
    const prev = ctx.cloth.phase;
    if (prev === next) return;
    ctx.cloth.phase = next;
    const state = ctx.cloth.state;
    emit(EVENT.SIM_PHASE, {
      phase: next, prev,
      time: state ? state.time : 0,
      frame: state ? state.frame | 0 : 0,
    });
  }

  function updatePhase() {
    setPhase(computePhase());
  }

  // ---------------------------------------------------------------- play / pause / drape / reset

  function drape() {
    const state = ctx.cloth.state;
    if (!state) return;
    if (ctx.body.model) arrangeState(state);
    clothMod.drape(state);
    ctx.cloth.running = true;
    ctx.cloth.userPaused = false;
    ctx.cloth.errorPaused = false;
    ctx.cloth.dirty = true;
    syncViewer(true);
    setPhase(computePhase());
  }

  function play() {
    const state = ctx.cloth.state;
    if (!state) return;
    if (ctx.cloth.phase === 'arranged' || ctx.cloth.phase === 'error') { drape(); return; }
    ctx.cloth.running = true;
    ctx.cloth.userPaused = false;
    ctx.cloth.errorPaused = false;
    setPhase(computePhase());
  }

  function pause() {
    ctx.cloth.running = false;
    ctx.cloth.userPaused = true;
    setPhase(computePhase());
  }

  function reset() {
    const state = ctx.cloth.state;
    if (!state) return;
    clothMod.reset(state);
    ctx.cloth.dirty = true;
    ctx.cloth.errorPaused = false;
    lastNanCount = state.nanCount | 0;
    syncViewer(true);
    setPhase(computePhase());
  }

  // ---------------------------------------------------------------- body (12.2.7)

  /**
   * @param {'full'|'coarse'} quality @param {BodyParams} [params]
   * @returns {BodyModel|null}
   */
  function buildBody(quality, params) {
    const bm = bodyMod();
    const d = doc();
    if (!bm || typeof bm.buildBody !== 'function') {
      showStatus('error', 'Body module is not loaded — no body model', 'E_BODY');
      return null;
    }
    const source = params || (d && d.body ? d.body.params : null);
    if (!source) return null;
    let model = null;
    try {
      const clamped = typeof bm.clampParams === 'function' ? bm.clampParams(source) : source;
      model = bm.buildBody(clamped, { cell: quality === 'full' ? 0.015 : 0.030 });
      ctx.body.model = model;
      ctx.body.quality = quality;
      ctx.body.key = keyOf(sortedBodyParams(clamped));
      // Only a FULL build records the document's body fingerprint: a coarse drag build uses params that were
      // never written to the doc, and must not suppress the full rebuild that the commit's doc:changed requests.
      if (quality === 'full') ctx.keys.body = keyOf(sortedBodyParams((doc() && doc().body.params) || clamped));
    } catch (err) {
      const e = /** @type {any} */ (err);
      showStatus('error', 'Body build failed: ' + String((e && e.message) || err), 'E_BODY');
      return null;
    }
    const v = viewer();
    if (v) { try { v.setBody(model); } catch (err) { handleError('viewer.setBody', err); } }
    ctx.cloth.dirty = true;
    emit(EVENT.BODY_BUILT, { model, quality, ms: model.buildMs });
    return model;
  }

  /** @param {any} params @returns {any} */
  function sortedBodyParams(params) {
    /** @type {any} */
    const out = {};
    for (const k of Object.keys(params || {}).sort()) out[k] = params[k];
    return out;
  }

  // ---------------------------------------------------------------- fabric / sim settings / size

  /**
   * In-place fabric update (never a rebuild) + viewer material + fabric:changed (12.2.1).
   * @param {string} fabricId
   */
  function applyFabric(fabricId) {
    const d = doc();
    if (!d) return;
    const inst = d.fabrics.find((f) => f.id === fabricId);
    if (!inst) return;
    const resolved = resolveFabric(inst);
    const prev = ctx.fabricResolved.get(fabricId);
    const diff = prev ? diffResolved(prev, resolved) : { physicsChanged: true, lookChanged: true };
    ctx.fabricResolved.set(fabricId, resolved);

    /** @type {string[]} */
    const pieceIds = d.pieces.filter((p) => p.fabricId === fabricId).map((p) => p.id);
    const state = ctx.cloth.state;
    if (state && diff.physicsChanged) {
      for (let k = 0; k < state.pieces.length; k++) {
        if (pieceIds.indexOf(state.pieces[k].pieceId) < 0) continue;
        try { clothMod.setFabricParams(state, k, resolved); } catch (err) { handleError('cloth.setFabricParams', err); }
      }
    }
    const v = viewer();
    if (v && diff.lookChanged) {
      for (const pieceId of pieceIds) {
        try { v.setPieceFabric(pieceId, resolved); } catch (err) { handleError('viewer.setPieceFabric', err); }
      }
    }
    ctx.keys.fabrics.set(fabricId, keyOf(inst));
    emit(EVENT.FABRIC_CHANGED, {
      fabricId, resolved,
      physicsChanged: !!diff.physicsChanged, lookChanged: !!diff.lookChanged,
      pieceIds,
    });
  }

  /** In-place solver settings (12.2.2 step 7). */
  function applySimSettings() {
    const d = doc();
    if (!d) return;
    const state = ctx.cloth.state;
    if (state) applySettingsTo(state);
    ctx.keys.sim = keyOf(d.sim);
  }

  /**
   * Emit size:active and rebuild the garment at that size.
   *
   * The simulation used to be left alone here, so picking L or XL changed the 2D ghost and the exported pattern but
   * not the garment on the model. It now re-meshes from the graded pieces (see simDoc) and rebuilds the cloth, which
   * is both what the size selector should obviously do and the only way a larger body can wear the garment.
   * @param {string} name
   */
  function setActiveSize(name) {
    const d = doc();
    if (!d || !name) return;
    const prev = ctx.lastActiveSize;
    const prevChart = ctx.keys.sizes;
    let row = null;
    try { row = sizingMod.rowByName(d.sizes, name) || null; } catch (_) { row = null; }
    ctx.lastActiveSize = name;
    ctx.keys.sizes = keyOf(d.sizes);
    emit(EVENT.SIZE_ACTIVE, { size: name, prev, row });
    updateGhost();
    // Re-grade the simulated pieces when the size changed OR the chart itself was edited. Keying only
    // on the NAME meant that editing a cell re-graded the 2D ghost and the exports while the 3D
    // garment kept its old mesh — the model quietly went on wearing a size that no longer existed.
    if (prev !== undefined && (prev !== name || prevChart !== ctx.keys.sizes)) {
      scheduleRemesh(d.pieces.filter((p) => p.simulate).map((p) => p.id));
    }
  }

  // ---------------------------------------------------------------- the debounced pipeline

  /** @param {Iterable<string>} ids */
  function scheduleRemesh(ids) {
    for (const id of ids) ctx.pending.remeshSet.add(id);
    if (ctx.pending.remeshTimer) clearTimeout(ctx.pending.remeshTimer);
    ctx.pending.remeshTimer = /** @type {any} */ (setTimeout(() => {
      ctx.pending.remeshTimer = 0;
      try { runPendingRemesh(); } catch (err) { handleError('remesh job', err); }
    }, REMESH_DEBOUNCE_MS));
  }

  /** @param {'full'|'coarse'} quality */
  function requestBodyBuild(quality) {
    ctx.pending.bodyQuality = quality;
    if (ctx.pending.dragTimer) { clearTimeout(ctx.pending.dragTimer); ctx.pending.dragTimer = 0; }
    if (ctx.pending.bodyTimer) clearTimeout(ctx.pending.bodyTimer);
    ctx.pending.bodyTimer = /** @type {any} */ (setTimeout(() => {
      ctx.pending.bodyTimer = 0;
      try { runPendingBody(); } catch (err) { handleError('body build', err); }
    }, BODY_DEBOUNCE_MS));
  }

  function runPendingBody() {
    const quality = ctx.pending.bodyQuality || 'full';
    ctx.pending.bodyQuality = null;
    ctx.pending.dragParams = null;
    buildBody(quality);
  }

  /** Document issues, pattern module first, schema shape as the fallback. @returns {Issue[]} */
  function docIssues() {
    const d = doc();
    if (!d) return [];
    try {
      if (typeof patternMod.validateDoc === 'function') return patternMod.validateDoc(d) || [];
    } catch (_) { /* the pattern module is allowed to be unavailable */ }
    return [];
  }

  /** The debounced remesh + rebuild job (12.2.2). Keeps the OLD cloth running until the swap line. */
  function runPendingRemesh() {
    const d = doc();
    if (!d) { ctx.pending.remeshSet.clear(); ctx.pending.remeshAll = false; return; }
    const t0 = nowMs();
    const all = ctx.pending.remeshAll;
    const requested = all ? null : Array.from(ctx.pending.remeshSet);
    ctx.pending.remeshSet.clear();
    ctx.pending.remeshAll = false;

    const issues = docIssues();
    /** @type {Set<string>} */
    const excluded = new Set();
    for (const issue of issues) {
      if (issue && issue.level === 'error' && issue.pieceId) excluded.add(issue.pieceId);
    }
    const ids = (requested || d.pieces.filter((p) => p.simulate).map((p) => p.id))
      .filter((id) => !excluded.has(id));
    const meshed = remesh(ids, { force: all });
    applyVertexCap();

    // --- build the new state; the old one keeps stepping until the swap succeeds
    let next = null;
    try {
      next = buildClothState();
    } catch (err) {
      ctx.cloth.stale = true;
      handleError('buildCloth', err);
      emit(EVENT.MESH_BUILT, { meshes: meshList(), issues, ms: nowMs() - t0 });
      return;
    }
    if (!next) {
      ctx.cloth.state = null;
      ctx.cloth.lastStats = null;
      ctx.cloth.running = false;
      const v0 = viewer();
      if (v0) { try { v0.setCloth(null); } catch (_) { /* ignore */ } }
      setPhase('empty');
      emit(EVENT.MESH_BUILT, { meshes: meshList(), issues, ms: nowMs() - t0 });
      return;
    }
    applySettingsTo(next);
    if (ctx.body.model) {
      try {
        clothMod.arrange(next, ctx.body.model, d);
        if (ctx.body.model.sdf) clothMod.pushOut(next, ctx.body.model.sdf);
      } catch (err) {
        ctx.cloth.stale = true;
        handleError('arrange', err);
        return;                      // the OLD state stays in use
      }
    }

    // --- atomic swap
    ctx.cloth.state = next;
    ctx.cloth.stale = false;
    ctx.cloth.lastStats = null;
    ctx.cloth.dirty = true;
    lastNanCount = next.nanCount | 0;
    rememberFabrics();
    installClothInViewer(next);

    if (!ctx.cloth.userPaused) {
      clothMod.drape(next);
      ctx.cloth.running = true;
      ctx.cloth.errorPaused = false;
      setPhase(computePhase());
    } else {
      ctx.cloth.running = false;
      setPhase('arranged');
    }

    const ms = nowMs() - t0;
    emit(EVENT.MESH_BUILT, { meshes: meshList(), issues, ms });
    emit(EVENT.SIM_BUILT, { state: next, meshes: meshList(), ms });
    const names = meshed.map((m) => m.pieceId).join(', ');
    showStatus('info',
      'Remeshed ' + (names || '—') + ' · rebuilt ' + fmtInt(next.V) + ' v / '
      + fmtInt(next.tris.length / 3) + ' tris in ' + fmtInt(ms) + ' ms', null);
  }

  /**
   * validate + remesh all + rebuild + arrange (+ drape). Used by the load path and by `__app`.
   * @param {{drape?: boolean}} [opts]
   */
  function rebuildAll(opts) {
    const d = doc();
    if (!d) return;
    const t0 = nowMs();
    const issues = docIssues();
    /** @type {Set<string>} */
    const excluded = new Set();
    for (const issue of issues) {
      if (issue && issue.level === 'error' && issue.pieceId) excluded.add(issue.pieceId);
    }
    const ids = d.pieces.filter((p) => p.simulate && !excluded.has(p.id)).map((p) => p.id);
    remesh(ids, { force: true });
    applyVertexCap();
    const state = rebuildCloth();
    emit(EVENT.MESH_BUILT, { meshes: meshList(), issues, ms: nowMs() - t0 });
    if (!state) return;
    if (ctx.body.model) arrangeState(state);
    installClothInViewer(state);
    const wantDrape = !(opts && opts.drape === false) && !ctx.cloth.userPaused;
    if (wantDrape) {
      clothMod.drape(state);
      ctx.cloth.running = true;
      ctx.cloth.errorPaused = false;
    } else {
      ctx.cloth.running = false;
    }
    setPhase(computePhase());
  }

  /** SPEC 12.2.4 — run every pending debounced job now. */
  function flush() {
    if (ctx.pending.dragTimer && !ctx.pending.bodyTimer) {
      clearTimeout(ctx.pending.dragTimer);
      ctx.pending.dragTimer = 0;
      const params = ctx.pending.dragParams;
      ctx.pending.dragParams = null;
      lastDragBuild = nowMs();
      buildBody('coarse', /** @type {any} */ (params) || undefined);
    } else if (ctx.pending.dragTimer) {
      clearTimeout(ctx.pending.dragTimer);
      ctx.pending.dragTimer = 0;
      ctx.pending.dragParams = null;
    }
    if (ctx.pending.bodyTimer) {
      clearTimeout(ctx.pending.bodyTimer);
      ctx.pending.bodyTimer = 0;
      runPendingBody();
    }
    if (ctx.pending.remeshTimer) {
      clearTimeout(ctx.pending.remeshTimer);
      ctx.pending.remeshTimer = 0;
      runPendingRemesh();
    }
  }

  /** @returns {{remesh: boolean, body: 'full'|'coarse'|null}} */
  function pending() {
    return {
      remesh: !!ctx.pending.remeshTimer || ctx.pending.remeshSet.size > 0 || ctx.pending.remeshAll,
      body: ctx.pending.bodyTimer ? (ctx.pending.bodyQuality || 'full') : (ctx.pending.dragTimer ? 'coarse' : null),
    };
  }

  // ---------------------------------------------------------------- doc:changed (12.2.2)

  /** @param {any} change */
  function onDocChanged(change) {
    const d = (change && change.doc) || doc();
    if (!d) return;
    const origin = (change && change.origin) || 'update';
    if (origin === 'replace') { onDocReplaced(d); return; }

    /** @type {Set<string>} */
    const groups = new Set();
    for (const g of ['pieces', 'seams', 'fabrics', 'body', 'sizes', 'sim', 'ui', 'name']) {
      if (change && typeof change[g] !== 'undefined' && change[g] !== false) groups.add(g);
    }
    const drag = origin === 'drag';
    const keys = computeKeys(d);
    autosaveNote(d, !(groups.size === 1 && groups.has('ui')));

    if (!drag && (groups.has('pieces') || groups.has('seams'))) {
      /** @type {string[]} */
      const remeshSet = [];
      let rebuild = false;
      let rearrange = false;
      for (const p of d.pieces) {
        if (!p.simulate) continue;
        const mk = keys.mesh.get(p.id);
        if (mk !== ctx.mesh.keys.get(p.id)) { remeshSet.push(p.id); rebuild = true; continue; }
        if (keys.build.get(p.id) !== ctx.keys.build.get(p.id)) { rebuild = true; continue; }
        if (keys.arrange.get(p.id) !== ctx.keys.arrange.get(p.id)) { rearrange = true; }
      }
      for (const id of Array.from(ctx.mesh.byPiece.keys())) {
        const p = d.pieces.find((x) => x.id === id);
        if (!p || !p.simulate) rebuild = true;
      }
      if (keys.seams !== ctx.keys.seams) rebuild = true;

      if (rebuild || remeshSet.length > 0) {
        scheduleRemesh(remeshSet);
      } else if (rearrange) {
        arrange();
        if (!ctx.cloth.userPaused) drape();
      }
      ctx.keys.build = keys.build;
      ctx.keys.arrange = keys.arrange;
      ctx.keys.seams = keys.seams;
    }

    if (!drag && groups.has('body') && keys.body !== ctx.keys.body) requestBodyBuild('full');

    if (groups.has('fabrics')) {
      for (const f of d.fabrics) {
        if (keys.fabrics.get(f.id) !== ctx.keys.fabrics.get(f.id)) applyFabric(f.id);
      }
      ctx.keys.fabrics = keys.fabrics;
    }

    if (groups.has('sim') && keys.sim !== ctx.keys.sim) applySimSettings();

    if (groups.has('ui')) applyScene();

    if ((groups.has('sizes') && keys.sizes !== ctx.keys.sizes) || d.ui.activeSize !== ctx.lastActiveSize) {
      setActiveSize(d.ui.activeSize);
    } else if (!drag && groups.has('pieces')) {
      updateGhost();
    }
  }

  // ---------------------------------------------------------------- DXF import (src/dxf)

  /**
   * Add the pieces of a DXF-AAMA file to the project, as ONE undo step, beside the existing pattern: pieces cut
   * on the fold keep their fold on x = 0 (the app requires it) and stack below, the others line up to the right.
   * They arrive with Simulate off: a DXF carries no seams and no placement, and an unsewn piece would just fall.
   * A piece the validator rejects is skipped and named, rather than failing the whole import.
   * @param {string} text @param {string} [filename] @param {{units?: 'mm'|'in'|'cm', size?: string}} [opts]
   * @returns {any} the import report, or null
   */
  function importDxf(text, filename, opts) {
    const store = ctx.store;
    const d = doc();
    if (!store || !d) return null;
    const fname = filename || 'the DXF file';
    let res;
    try { res = dxfMod.importAama(String(text), opts || {}); }
    catch (err) { showStatus('error', 'Could not read ' + fname + ': ' + String((err && err.message) || err), 'E_DXF'); return null; }
    const report = res.report;
    if (!res.pieces.length) {
      showStatus('warn', 'No pattern pieces found in ' + fname + '. ' + (report.warnings[0] || ''), 'E_DXF_EMPTY');
      return report;
    }
    // layout
    const old = d.pieces.flatMap((p) => p.vertices);
    const maxX = old.length ? Math.max(...old.map((v) => v[0])) : 0;
    const minY = old.length ? Math.min(...old.map((v) => v[1])) : 0;
    let cursorX = old.length ? maxX + 80 : 0;
    let cursorY = old.length ? minY - 80 : 0;
    const GAP = 80;
    const moved = res.pieces.map((dr) => {
      const xs = dr.vertices.map((v) => v[0]), ys = dr.vertices.map((v) => v[1]);
      const bb = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
      let dx, dy;
      if (dr.foldEdge !== undefined && dr.foldEdge !== null) {
        dx = 0; dy = cursorY - bb.maxY; cursorY -= (bb.maxY - bb.minY) + GAP;
      } else {
        dx = cursorX - bb.minX; dy = (old.length ? minY : 0) - bb.minY; cursorX += (bb.maxX - bb.minX) + GAP;
      }
      const T = (q) => [q[0] + dx, q[1] + dy];
      return {
        ...dr,
        vertices: dr.vertices.map(T),
        edges: dr.edges.map((e) => (e.type === 'cubic' ? { ...e, c1: T(e.c1), c2: T(e.c2) } : { ...e })),
        grainline: dr.grainline ? { a: T(dr.grainline.a), b: T(dr.grainline.b) } : undefined,
        internalLines: (dr.internalLines || []).map((il) => ({ ...il, points: il.points.map(T) })),
      };
    });
    const warnings = report.warnings.slice();
    /** @type {string[]} */
    const added = [];
    const addAll = (list) => store.update((dd) => {
      const fabricIds = dd.fabrics.map((f) => f.id);
      for (const dr of list) {
        const p = normalizePiece({ ...dr, simulate: false }, { fabricIds, defaultFabricId: fabricIds[0] });
        dd.pieces.push(p);
      }
    }, 'piece:import');
    try {
      addAll(moved);
      added.push(...moved.map((p) => p.name));
    } catch (_) {
      // one bad piece must not sink the rest: add them one at a time and name the ones that fail
      for (const dr of moved) {
        try { addAll([dr]); added.push(dr.name); }
        catch (err) {
          const issue = err && err.issues && err.issues.find((i) => i.level === 'error');
          warnings.push(dr.name + ' was not imported: ' + (issue ? issue.message : String((err && err.message) || err)));
        }
      }
    }
    flush();
    for (const w of warnings) { try { ctx.log.push({ t: Date.now(), level: 'warn', message: 'DXF import: ' + w, code: 'W_DXF' }); } catch (_) { /* ignore */ } }
    const e = editor();
    if (e && e.view && typeof e.view.fitToPieces === 'function') { try { e.view.fitToPieces(); } catch (_) { /* ignore */ } }
    const head = 'Imported ' + added.length + ' piece' + (added.length === 1 ? '' : 's') + ' from ' + fname
      + ' (' + ({ in: 'inches', cm: 'cm' }[report.units] || 'mm') + (report.size ? ', size ' + report.size : '') + ').';
    const tail = warnings.length ? ' ' + warnings[0] + (warnings.length > 1 ? ' (+' + (warnings.length - 1) + ' more in the log)' : '')
      : ' Add seams and placement, then tick Simulate.';
    showStatus(warnings.length ? 'warn' : 'info', head + tail, warnings.length ? 'W_DXF' : null);
    return { ...report, added, warnings };
  }

  // ---------------------------------------------------------------- autosave (autosave.js)

  /**
   * Hand a changed document to the autosaver. While a recovery offer is open nothing is written — the record
   * being offered must survive until the user chooses — but a real edit is remembered, so it is saved after.
   * @param {ProjectDoc} d @param {boolean} dirtying
   */
  function autosaveNote(d, dirtying) {
    if (!ctx.autosave) return;
    if (ctx.recovery) { if (dirtying) ctx.editedDuringRecovery = true; return; }
    ctx.autosave.note(d, { dirtying });
  }

  /** At start-up: offer unsaved work from an earlier session, if there is any. @returns {Promise<boolean>} */
  async function offerRecovery() {
    const as = ctx.autosave;
    if (!as || as.isSuspended() || !ctx.store) return false;
    const rec = await as.read();
    const current = serializeDoc(ctx.store.get());
    if (!shouldOffer(rec, current)) {
      as.markClean(ctx.store.get());
      return false;
    }
    showRecovery(/** @type {any} */ (rec));
    return true;
  }

  /** @param {{name: string, savedAt: string, text: string}} rec */
  function showRecovery(rec) {
    ctx.recovery = rec;
    ctx.editedDuringRecovery = false;
    const u = ui();
    if (u && u.recovery) u.recovery.show(rec);
  }

  function endRecovery() {
    ctx.recovery = null;
    const u = ui();
    if (u && u.recovery) u.recovery.hide();
  }

  function recoverRestore() {
    const rec = ctx.recovery;
    if (!rec || !ctx.store) return;
    let doc;
    try { doc = parseDoc(rec.text); } catch (err) {
      showStatus('error', 'The unsaved work could not be read: ' + String((err && err.message) || err), 'E_AUTOSAVE');
      endRecovery();
      return;
    }
    endRecovery();
    ctx.restoringAutosave = true;
    try { ctx.store.replace(doc, 'Restore unsaved work'); flush(); } finally { ctx.restoringAutosave = false; }
    showStatus('info', 'Restored “' + (rec.name || 'Untitled') + '”. Save it to keep it as a file.', null);
  }

  function recoverDiscard() {
    if (!ctx.recovery) return;
    const edited = !!ctx.editedDuringRecovery;
    endRecovery();
    const as = ctx.autosave;
    if (!as || !ctx.store) return;
    const d = ctx.store.get();
    as.discard();
    // whatever the user did while the offer was open is theirs now, and unsaved if they edited
    if (edited) as.note(d, { dirtying: true }); else as.markClean(d);
  }

  /**
   * The 3D backdrop and floor (doc.ui.scene) to the viewer, which forwards it to the pop-out. Keyed so a ui
   * change that is not the scene (a split drag, a dock tab) does not rebuild the stage.
   */
  function applyScene() {
    const v = viewer();
    const d = doc();
    if (!v || typeof v.setStage !== 'function' || !d || !d.ui) return;
    const key = JSON.stringify(d.ui.scene || null);
    if (key === ctx.sceneKey) return;
    ctx.sceneKey = key;
    try {
      v.setStage(d.ui.scene || null);
      // Let the colour swatch open on the colour actually on screen.
      const u = ui();
      const bg = v.viewer && v.viewer.scene ? v.viewer.scene.background : null;
      if (u && u.scene && typeof u.scene.setPresetBackground === 'function' && bg && bg.isColor) {
        u.scene.setPresetBackground('#' + bg.getHexString());
      }
    } catch (err) { handleError('viewer.setStage', err); }
  }

  /**
   * The 2D editor's dashed outline of the ACTIVE size, over the pattern as drawn (the base size). The
   * renderer and `editor.setGhost` existed from the start and the Size selector's tooltip promised the
   * outline, but nothing ever called setGhost, so picking a size changed nothing in 2D. At the base size
   * there is nothing to show.
   */
  function updateGhost() {
    const e = editor();
    if (!e || typeof e.setGhost !== 'function') return;
    const d = doc();
    const size = d && d.ui ? d.ui.activeSize : null;
    if (!d || !size || !d.sizes || size === d.sizes.baseSize) { e.setGhost(null); return; }
    try { e.setGhost(sizingMod.gradeDoc(d, size)); } catch (_) { e.setGhost(null); }
  }

  /** The load path: `doc:changed` with origin 'replace' (12.2.1). @param {ProjectDoc} d */
  function onDocReplaced(d) {
    if (ctx.restoringAutosave) {
      // restored work is unsaved work: keep it dirty and write it straight back
      if (ctx.autosave) { ctx.autosave.markDirty(); ctx.autosave.note(d); }
    } else if (!ctx.recovery && ctx.autosave) {
      ctx.autosave.markClean(d);                    // New, Open, Load sample: nothing to recover
    }
    if (ctx.pending.remeshTimer) { clearTimeout(ctx.pending.remeshTimer); ctx.pending.remeshTimer = 0; }
    if (ctx.pending.bodyTimer) { clearTimeout(ctx.pending.bodyTimer); ctx.pending.bodyTimer = 0; }
    if (ctx.pending.dragTimer) { clearTimeout(ctx.pending.dragTimer); ctx.pending.dragTimer = 0; }
    ctx.pending.remeshSet.clear();
    ctx.pending.remeshAll = false;
    ctx.pending.dragParams = null;
    ctx.pending.bodyQuality = null;

    ctx.mesh.byPiece.clear();
    ctx.mesh.failed.clear();
    ctx.mesh.keys.clear();
    ctx.mesh.spacingFactor = 1;
    ctx.cloth.errorPaused = false;
    ctx.cloth.nanEvents.length = 0;
    ctx.cloth.userPaused = !!ctx.params.nosim;

    const keys = computeKeys(d);
    const bodyChanged = keys.body !== ctx.keys.body || !ctx.body.model;
    ctx.keys = keys;
    ctx.keys.fabrics = keys.fabrics;
    if (bodyChanged) buildBody('full');

    rebuildAll();
    const v = viewer();
    if (v) { try { v.fit(); } catch (err) { handleError('viewer.fit', err); } }
    ctx.lastActiveSize = null;
    setActiveSize(d.ui.activeSize);
    applyScene();
    showStatus('info',
      'Loaded ' + (d.name || 'project') + ' · ' + d.pieces.length + ' pieces · '
      + fmtInt(ctx.cloth.state ? ctx.cloth.state.V : 0) + ' verts', null);
  }

  // ---------------------------------------------------------------- body panel drag / commit

  /** @param {any} payload */
  function onBodyDrag(payload) {
    const bm = bodyMod();
    const params = payload && payload.params;
    if (!params) return;
    ctx.pending.dragParams = bm && typeof bm.clampParams === 'function' ? bm.clampParams(params) : params;
    if (ctx.pending.bodyTimer) return;       // a full build is already queued; it wins
    const since = nowMs() - lastDragBuild;
    if (since >= DRAG_THROTTLE_MS) {
      lastDragBuild = nowMs();
      const p = ctx.pending.dragParams;
      ctx.pending.dragParams = null;
      buildBody('coarse', /** @type {any} */ (p));
      return;
    }
    if (ctx.pending.dragTimer) return;
    ctx.pending.dragTimer = /** @type {any} */ (setTimeout(() => {
      ctx.pending.dragTimer = 0;
      const p = ctx.pending.dragParams;
      ctx.pending.dragParams = null;
      if (!p) return;
      lastDragBuild = nowMs();
      try { buildBody('coarse', /** @type {any} */ (p)); } catch (err) { handleError('body coarse build', err); }
    }, Math.max(0, DRAG_THROTTLE_MS - since)));
  }

  /** The commit's full build is driven by the doc:changed body hint; here we only cancel the drag timer. */
  function onBodyCommit() {
    if (ctx.pending.dragTimer) { clearTimeout(ctx.pending.dragTimer); ctx.pending.dragTimer = 0; }
    ctx.pending.dragParams = null;
  }

  // ---------------------------------------------------------------- selection / layout / popout

  /** @param {any} payload */
  function onSelectionChanged(payload) {
    const v = viewer();
    if (!v) return;
    const d = doc();
    const sel = (payload && payload.selection) || null;
    const pieces = (sel && Array.isArray(sel.pieces)) ? sel.pieces : [];
    if (d && ctx.body.model && pieces.length === 1) {
      const piece = d.pieces.find((p) => p.id === pieces[0]);
      const anchor = piece && piece.placement ? piece.placement.anchor : null;
      if (v.gizmo && typeof v.gizmo.highlight === 'function') v.gizmo.highlight(anchor);
      if (typeof v.setGizmo === 'function') v.setGizmo(true);
    } else if (typeof v.setGizmo === 'function') {
      v.setGizmo(false);
    }
  }

  /** @param {any} payload */
  function onLayout(payload) {
    const e = editor();
    if (e && e.view && typeof e.view.resize === 'function') {
      try { e.view.resize(); } catch (err) { handleError('editor.view.resize', err); }
    }
    const v = viewer();
    if (!v) return;
    try {
      if (v.viewer && typeof v.viewer.resize === 'function') v.viewer.resize();
      // The loop is the simulation, not just the in-pane render. While the 3D view is popped out the main
      // window stays the only simulation owner (SPEC 8, pop-out design) and streams positions to it from
      // this loop, so it keeps running then; it stops only when no 3D view is visible anywhere. Stopping it
      // on pop-out, as before, froze the garment in the pop-out window.
      const hidden = !!payload && payload.layout === '2d' && payload.popout !== true;
      if (v.loop) {
        if (hidden) v.loop.stop(); else v.loop.start();
      }
    } catch (err) { handleError('viewer.resize', err); }
  }

  function onWindowResize() {
    const e = editor();
    if (e && e.view && typeof e.view.resize === 'function') {
      try { e.view.resize(); } catch (err) { handleError('editor.view.resize', err); }
    }
    const v = viewer();
    if (v && v.viewer && typeof v.viewer.resize === 'function') {
      try { v.viewer.resize(); } catch (err) { handleError('viewer.resize', err); }
    }
  }

  /** Hook the pop-out bridge callbacks (8.8) so wiring can emit popout:open / popout:close. */
  function bindPopout() {
    const v = viewer();
    if (!v || !v.popout) return;
    try {
      if (typeof v.popout.onOpened === 'function') {
        v.popout.onOpened(() => {
          emit(EVENT.POPOUT_OPEN, { at: Date.now() });
          const u = ui();
          // setPopout emits ui:layout, and onLayout decides whether the loop runs.
          if (u && u.layout && typeof u.layout.setPopout === 'function') u.layout.setPopout(true);
        });
      }
      if (typeof v.popout.onClosed === 'function') {
        v.popout.onClosed((reason) => {
          emit(EVENT.POPOUT_CLOSE, { reason: reason || 'user', at: Date.now() });
          const u = ui();
          // Not loop.start(): in the 2D-only layout that restarted a drape nobody could see. onLayout decides.
          if (u && u.layout && typeof u.layout.setPopout === 'function') u.layout.setPopout(false);
        });
      }
    } catch (err) { handleError('popout bind', err); }
  }

  // ---------------------------------------------------------------- ui:action dispatcher (12.2.1)

  /** @param {any} a */
  function onUiAction(a) {
    const action = a && a.action;
    if (!action) return;
    const store = ctx.store;
    const e = editor();
    const v = viewer();
    const u = ui();
    const d = doc();

    switch (action) {
      case 'tool':
        if (e) e.setTool(a.tool);
        break;
      case 'mirror':
        if (e) e.mirror();
        break;
      case 'fit2d':
        if (e && e.view) e.view.fitToPieces();
        break;
      case 'zoom':
        if (e && e.view) {
          if (a.factor === 'fit') e.view.fitToPieces();
          else e.view.zoomBy(Number(a.factor) || 1);
        }
        break;
      case 'delete':
        if (e) e.deleteSelection();
        break;
      case 'cancel':
        if (e) e.cancel();
        break;
      case 'confirm':
        if (e) e.confirm();
        break;
      case 'nudge':
        if (e) e.nudge(Number(a.dx) || 0, Number(a.dy) || 0);
        break;
      case 'selectPiece':
        if (e) e.select({ pieces: a.pieceId ? [a.pieceId] : [] }, { additive: !!a.additive });
        break;
      case 'selectSeam':
        if (e) e.select({ seams: a.seamId ? [a.seamId] : [] }, { additive: !!a.additive });
        break;
      case 'undo':
        if (store) { store.undo(); flush(); }
        break;
      case 'redo':
        if (store) { store.redo(); flush(); }
        break;
      case 'new':
        if (store) { store.replace(normalizeDoc({}), 'New project'); flush(); }
        break;
      case 'loadSample':
        if (store) {
          const id = a.name || a.id || 'tshirt';
          store.replace(samplesMod.getSample(id), 'Load sample ' + id);
          flush();
        }
        break;
      case 'open':
        // Ctrl+O arrives without file text: open the picker, whose change event comes back with the text.
        if (typeof a.text !== 'string') { if (u && u.toolbar && typeof u.toolbar.openFile === 'function') u.toolbar.openFile(); break; }
        if (store && typeof a.text === 'string') {
          store.replace(exportMod.parseProjectText(a.text), 'Open ' + (a.filename || 'project'));
          flush();
          showStatus('info', 'Opened ' + (a.filename || 'project'), null);
        }
        break;
      case 'save':
        if (d) {
          flush();
          exportMod.saveProject(d);
          if (ctx.autosave && !ctx.recovery) ctx.autosave.markClean(d);
          showStatus('info', 'Saved ' + exportMod.projectFilename(d), null);
        }
        break;
      case 'arrange':
        arrange();
        break;
      case 'drape':
        drape();
        break;
      case 'play':
        play();
        break;
      case 'pause':
        pause();
        break;
      case 'togglePlay':
        if (ctx.cloth.running) pause(); else play();
        break;
      case 'reset':
        reset();
        break;
      case 'frame3d':
        if (v) v.fit();
        break;
      case 'layout':
        if (u && u.layout) u.layout.setLayout(a.mode);
        break;
      case 'swap':
        if (u && u.layout) u.layout.swap();
        break;
      case 'dockTab':
        if (u && u.dock) u.dock.setTab(a.tab);
        break;
      case 'popout':
        if (v && v.popout) {
          const opened = v.popout.open();
          if (!opened) {
            emit(EVENT.POPOUT_CLOSE, { reason: 'blocked', at: Date.now() });
            showStatus('warn', 'The pop-out window was blocked by the browser — allow pop-ups for this site', 'E_POPOUT');
          }
        }
        break;
      case 'popin':
        if (v && v.popout) v.popout.close();
        break;
      case 'export':
        runExport(a);
        break;
      case 'guide':
        if (u && u.guide) u.guide.toggle(typeof a.section === 'string' ? a.section : undefined);
        break;
      case 'importDxf':
        if (typeof a.text === 'string') importDxf(a.text, a.filename);
        break;
      case 'recoverRestore':
        recoverRestore();
        break;
      case 'recoverDiscard':
        recoverDiscard();
        break;
      default:
        // Unknown intents are ignored on purpose (forward compatibility with the UI).
        break;
    }
  }

  /** @param {any} a */
  function runExport(a) {
    const d = doc();
    if (!d) return;
    flush();
    const kind = a.kind || 'svg';
    const size = a.size || d.ui.activeSize;
    const name = d.name || 'project';
    if (kind === 'svg') {
      const svg = exportMod.exportDocSvg(d, size);
      exportMod.downloadSvg(exportMod.FILENAMES.sheetSvg(name, size), svg);
      showStatus('info', 'Exported sheet SVG (' + size + ')', null);
    } else if (kind === 'print') {
      const paper = a.paper || 'A4';
      const result = exportMod.exportDocPrintHtml(d, size, { paper });
      const pages = result && result.plan && result.plan.tiles ? result.plan.tiles.length : 0;
      let win = null;
      try { win = window.open('', '_blank'); } catch (_) { win = null; }
      if (win && win.document) {
        win.document.open();
        win.document.write(result.html);
        win.document.close();
        showStatus('info', 'Print sheet: ' + pages + ' ' + paper + ' pages', null);
      } else {
        exportMod.downloadText(exportMod.FILENAMES.printHtml(name, size, paper), 'text/html', result.html);
        showStatus('warn', 'Pop-up blocked — the print sheet was downloaded instead', 'E_POPUP');
      }
    } else if (kind === 'csv') {
      exportMod.downloadText(exportMod.FILENAMES.sizesCsv(name), 'text/csv', exportMod.exportDocSizesCsv(d));
      showStatus('info', 'Exported size chart CSV', null);
    } else if (kind === 'json') {
      exportMod.downloadText(exportMod.FILENAMES.sizesJson(name), 'application/json', exportMod.exportDocSizesJson(d));
      showStatus('info', 'Exported size chart JSON', null);
    } else if (kind === 'dxf') {
      // One size (the toolbar) or every size as a graded nest (the Sizes tab).
      const all = a.size === '*';
      const sizes = all ? sizingMod.sizeNames(d.sizes) : [size];
      const text = dxfMod.exportAama(d, {
        sizes, sampleSize: all ? d.sizes.baseSize : size, units: a.units === 'in' ? 'in' : 'mm',
        fold: a.fold === 'mirror' ? 'mirror' : 'whole', author: 'Clothing CAD contributors;Clothing CAD;' + (ctx.version || '1.0.0'),
      });
      exportMod.downloadText(exportMod.slug(name) + (all ? '-all-sizes' : '-' + exportMod.slug(size)) + '.dxf', 'application/dxf', text);
      showStatus('info', 'Exported DXF-AAMA: ' + (all ? sizes.length + ' sizes (' + sizes.join(', ') + ')' : 'size ' + size), null);
    } else if (kind === 'obj') {
      const state = ctx.cloth.state;
      if (!state) { showStatus('warn', 'Nothing to export: no simulated cloth', 'E_NO_CLOTH'); return; }
      exportMod.downloadClothObj(state, exportMod.FILENAMES.clothObj(name));
      showStatus('info', 'Exported cloth OBJ', null);
    }
  }

  // ---------------------------------------------------------------- NaN watchdog (12.2.1)

  /** @param {ClothState} state */
  function onNanDetected(state) {
    const t = nowMs();
    const events = ctx.cloth.nanEvents;
    events.push(t);
    while (events.length > 10) events.shift();
    emit(EVENT.SIM_NAN, { frame: state.frame | 0, nanCount: state.nanCount | 0, restored: 'snapshot' });
    showStatus('warn',
      'Solver recovered from NaN (frame ' + (state.frame | 0) + ', restored snapshot)', 'E_NAN');
    let recent = 0;
    for (let i = 0; i < events.length; i++) if (t - events[i] <= 10000) recent++;
    if (recent >= 3) {
      pause();
      ctx.cloth.errorPaused = true;
      setPhase('error');
      showStatus('error', 'Simulation paused: repeated instability — press Reset or Drape', 'E_NAN_REPEATED');
    }
  }

  // ---------------------------------------------------------------- the frame tick (12.2.6)

  /**
   * Per-frame tick, installed at viewer creation (section 8.6 signature). Allocation-free on the hot path.
   * @param {number} dtMs @param {number} frame
   */
  function tick(dtMs, frame) {
    try {
      const state = ctx.cloth.state;
      if (!state) return;
      let dirty = false;
      if (ctx.cloth.running && !ctx.cloth.stepping) {
        const sdf = ctx.body.model ? ctx.body.model.sdf : null;
        const stats = clothMod.step(state, sdf);
        ctx.cloth.lastStats = stats;
        if ((state.nanCount | 0) > lastNanCount) {
          lastNanCount = state.nanCount | 0;
          onNanDetected(state);
        }
        updatePhase();
        dirty = true;
      }
      const v = viewer();
      if (v && (dirty || ctx.cloth.dirty)) {
        v.sync(state, ctx.cloth.dirty);
        ctx.cloth.dirty = false;
        syncTears(state, false);
      }
      if (dirty && ctx.cloth.lastStats) {
        ctx.bus.emit(EVENT.SIM_STATS, ctx.cloth.lastStats);
        const t = nowMs();
        if (t - ctx.lastStatsPush >= STATUS_STATS_MS) {
          ctx.lastStatsPush = t;
          const u = ui();
          if (u && u.statusbar && typeof u.statusbar.setSim === 'function') u.statusbar.setSim(ctx.cloth.lastStats);
        }
        const msAvg = ctx.cloth.lastStats.msAvg;
        if (msAvg > 20) {
          slowFrames++;
          if (slowFrames >= 60 && t - lastSlowWarn > 60000) {
            lastSlowWarn = t;
            slowFrames = 0;
            showStatus('warn', 'Simulation slow (' + msAvg.toFixed(0) + ' ms/frame) — raise mesh spacing', 'E_SLOW');
          }
        } else {
          slowFrames = 0;
        }
      }
    } catch (err) {
      handleError('tick', err);
      ctx.cloth.running = false;
      ctx.cloth.userPaused = true;
    }
  }

  /**
   * Run n frames synchronously with rendering suppressed (12.3 `sim.step`). `running` is not changed.
   * @param {number} n @returns {SimStats|null}
   */
  function stepFrames(n) {
    flush();
    const state = ctx.cloth.state;
    if (!state) return null;
    const count = Math.max(1, Math.trunc(n || 1));
    const v = viewer();
    const loop = v && v.loop ? v.loop : null;
    const wasSuppressed = loop ? loop.renderSuppressed : false;
    if (loop) loop.renderSuppressed = true;
    ctx.cloth.stepping = true;
    /** @type {SimStats|null} */
    let stats = null;
    try {
      const sdf = ctx.body.model ? ctx.body.model.sdf : null;
      for (let i = 0; i < count; i++) {
        stats = clothMod.step(state, sdf);
        if ((state.nanCount | 0) > lastNanCount) {
          lastNanCount = state.nanCount | 0;
          onNanDetected(state);
        }
      }
      ctx.cloth.lastStats = stats;
      updatePhase();
    } finally {
      ctx.cloth.stepping = false;
      if (loop) loop.renderSuppressed = wasSuppressed;
    }
    if (v) {
      try {
        v.sync(state, true);
        syncTears(state, true);
        if (loop && typeof loop.renderNow === 'function') loop.renderNow();
      } catch (err) { handleError('viewer.sync', err); }
    }
    ctx.cloth.dirty = false;
    return stats;
  }

  // ---------------------------------------------------------------- start / stop

  function start() {
    if (started) return;
    started = true;
    const bus = ctx.bus;
    unsubs.push(bus.on(EVENT.DOC_CHANGED, guard('doc:changed', onDocChanged)));
    unsubs.push(bus.on(EVENT.BODY_PARAMS_DRAG, guard('body:params:drag', onBodyDrag)));
    unsubs.push(bus.on(EVENT.BODY_PARAMS_COMMIT, guard('body:params:commit', onBodyCommit)));
    unsubs.push(bus.on(EVENT.SELECTION_CHANGED, guard('selection:changed', onSelectionChanged)));
    unsubs.push(bus.on(EVENT.UI_LAYOUT, guard('ui:layout', onLayout)));
    unsubs.push(bus.on(EVENT.UI_ACTION, guard('ui:action', onUiAction)));
    if (typeof window !== 'undefined' && window.addEventListener) {
      const onResize = guard('window:resize', onWindowResize);
      const onUnload = guard('beforeunload', () => { flush(); if (ctx.autosave) ctx.autosave.flush(); });
      const onHide = guard('pagehide', () => { if (ctx.autosave) ctx.autosave.flush(); });
      const onVis = guard('visibilitychange', () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && ctx.autosave) ctx.autosave.flush();
      });
      window.addEventListener('pagehide', onHide);
      unsubs.push(() => window.removeEventListener('pagehide', onHide));
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVis);
        unsubs.push(() => document.removeEventListener('visibilitychange', onVis));
      }
      window.addEventListener('resize', onResize);
      window.addEventListener('beforeunload', onUnload);
      unsubs.push(() => window.removeEventListener('resize', onResize));
      unsubs.push(() => window.removeEventListener('beforeunload', onUnload));
    }
    bindPopout();
    ctx.sceneKey = null;
    applyScene();
  }

  function stop() {
    started = false;
    while (unsubs.length) {
      const fn = unsubs.pop();
      try { if (fn) fn(); } catch (_) { /* ignore */ }
    }
    if (ctx.pending.remeshTimer) { clearTimeout(ctx.pending.remeshTimer); ctx.pending.remeshTimer = 0; }
    if (ctx.pending.bodyTimer) { clearTimeout(ctx.pending.bodyTimer); ctx.pending.bodyTimer = 0; }
    if (ctx.pending.dragTimer) { clearTimeout(ctx.pending.dragTimer); ctx.pending.dragTimer = 0; }
  }

  /** @type {Wiring} */
  const wiring = {
    start, stop, flush, pending,
    rebuildAll, remesh, rebuildCloth, arrange, drape, play, pause, reset,
    buildBody, applyFabric, applySimSettings, setActiveSize,
    stepFrames, tick, computeKeys,
  };
  // Internals the boot and the debug API may need; not part of the Wiring contract.
  /** @type {any} */ (wiring).installClothInViewer = installClothInViewer;
  /** @type {any} */ (wiring).setPhase = setPhase;
  /** @type {any} */ (wiring).computePhase = computePhase;
  /** @type {any} */ (wiring).docIssues = docIssues;
  /** @type {any} */ (wiring).showStatus = showStatus;
  /** @type {any} */ (wiring).meshList = meshList;
  /** @type {any} */ (wiring).tryCall = tryCall;
  /** @type {any} */ (wiring).offerRecovery = offerRecovery;
  /** @type {any} */ (wiring).importDxf = importDxf;
  /** @type {any} */ (wiring).showRecovery = showRecovery;
  return wiring;
}
