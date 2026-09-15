// src/core/events.js — EventBus, the frozen EVENT name table and every payload typedef (SPEC section 3.2).
// Imports nothing.

/** The complete event name table. `emit`/`on` of any other name throws Error{code:'UnknownEvent'} (strict mode). */
export const EVENT = Object.freeze({
  // document / store (emitted by store.js)
  DOC_CHANGED: 'doc:changed',
  // pattern editor (emitted by src/pattern/editor.js and its tools)
  SELECTION_CHANGED: 'selection:changed',
  TOOL_CHANGED: 'tool:changed',
  HOVER_CHANGED: 'hover:changed',
  SEAM_PREVIEW: 'seam:preview',
  VIEW2D_CHANGED: 'view2d:changed',
  PATTERN_ISSUES: 'pattern:issues',
  // body (emitted by src/ui/panels/body.js and src/app/wiring.js)
  BODY_PARAMS_DRAG: 'body:params:drag',
  BODY_PARAMS_COMMIT: 'body:params:commit',
  BODY_BUILT: 'body:built',
  // mesh (emitted by src/app/wiring.js)
  MESH_BUILT: 'mesh:built',
  // cloth (emitted by src/app/wiring.js and src/viewer3d/loop.js)
  SIM_BUILT: 'sim:built',
  SIM_STATS: 'sim:stats',
  SIM_PHASE: 'sim:phase',
  SIM_NAN: 'sim:nan',
  // fabric (emitted by src/app/wiring.js)
  FABRIC_CHANGED: 'fabric:changed',
  // sizes (emitted by src/app/wiring.js)
  SIZE_ACTIVE: 'size:active',
  // ui (emitted by src/ui/*)
  UI_LAYOUT: 'ui:layout',
  UI_DOCK: 'ui:dock',
  UI_STATUS: 'ui:status',
  UI_ACTION: 'ui:action',
  // pop-out (emitted by the main-window side of the pop-out bridge, src/viewer3d/index.js)
  POPOUT_OPEN: 'popout:open',
  POPOUT_CLOSE: 'popout:close',
  // app lifecycle (emitted by src/app/main.js)
  APP_READY: 'app:ready',
});

/** @type {Set<string>} */
const KNOWN_NAMES = new Set(Object.values(EVENT));

const ERROR_RING_CAPACITY = 20;

/**
 * @param {string} name @returns {Error}
 */
function unknownEvent(name) {
  const err = new Error('Unknown event name: ' + String(name));
  // @ts-ignore
  err.code = 'UnknownEvent';
  return err;
}

/** @returns {number} */
function now() {
  return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
    ? performance.now() : Date.now();
}

/**
 * Minimal synchronous pub/sub. One payload object per event, listeners called in subscription order.
 * Listener errors are isolated: a throwing listener never prevents the remaining listeners from running.
 */
export class EventBus {
  /** @param {{strict?: boolean}} [opts] strict (default true) = emit()/on() of a name not in EVENT throws Error{code:'UnknownEvent'} */
  constructor(opts) {
    this.strict = !(opts && opts.strict === false);
    /** @type {Map<string, Function[]>} */
    this._listeners = new Map();
    /** @type {{name:string, error:Error, at:number}[]} ring buffer of the last 20 listener errors, newest last */
    this.errors = [];
    /** @type {number} total listener errors since construction */
    this.errorCount = 0;
  }

  /** @param {string} name */
  _check(name) {
    if (this.strict && !KNOWN_NAMES.has(name)) throw unknownEvent(name);
  }

  /**
   * @template T
   * @param {string} name        one of the EVENT values
   * @param {(payload: T, name: string) => void} fn
   * @returns {() => void}       unsubscribe function (idempotent)
   */
  on(name, fn) {
    this._check(name);
    if (typeof fn !== 'function') throw new TypeError('EventBus.on: listener must be a function');
    let list = this._listeners.get(name);
    if (!list) {
      list = [];
      this._listeners.set(name, list);
    }
    list.push(fn);
    const self = this;
    return function unsubscribe() { self.off(name, fn); };
  }

  /**
   * Same as on() but the listener is removed before its first call.
   * @template T
   * @param {string} name
   * @param {(payload: T, name: string) => void} fn
   * @returns {() => void}
   */
  once(name, fn) {
    this._check(name);
    if (typeof fn !== 'function') throw new TypeError('EventBus.once: listener must be a function');
    const self = this;
    /** @param {T} payload @param {string} n */
    function wrapper(payload, n) {
      self.off(name, wrapper);
      fn(payload, n);
    }
    return this.on(name, wrapper);
  }

  /** Remove one listener; no-op when not subscribed. @param {string} name @param {Function} fn */
  off(name, fn) {
    this._check(name);
    const list = this._listeners.get(name);
    if (!list) return;
    const idx = list.indexOf(fn);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0) this._listeners.delete(name);
  }

  /**
   * Call every listener of `name` with `payload`. Iterates over a snapshot of the listener array.
   * @param {string} name @param {*} payload
   * @returns {number} number of listeners invoked (not counting the ones that threw)
   */
  emit(name, payload) {
    this._check(name);
    const list = this._listeners.get(name);
    if (!list || list.length === 0) return 0;
    const snapshot = list.slice();
    let ok = 0;
    let lastError = null;
    for (let i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](payload, name);
        ok++;
      } catch (error) {
        lastError = error;
        this._recordError(name, error);
      }
    }
    if (lastError !== null && name !== EVENT.UI_STATUS) {
      const msg = (lastError && lastError.message) ? lastError.message : String(lastError);
      this.emit(EVENT.UI_STATUS, {
        level: 'error',
        text: 'Listener error on ' + name + ': ' + msg,
        source: 'bus',
      });
    }
    return ok;
  }

  /**
   * @param {string} name @param {*} error
   */
  _recordError(name, error) {
    const err = (error instanceof Error) ? error : new Error(String(error));
    this.errors.push({ name, error: err, at: now() });
    while (this.errors.length > ERROR_RING_CAPACITY) this.errors.shift();
    this.errorCount++;
    try {
      console.error('[bus]', name, err);
    } catch (_e) {
      // console unavailable; ignore
    }
  }

  /** @param {string} name @returns {number} */
  listenerCount(name) {
    const list = this._listeners.get(name);
    return list ? list.length : 0;
  }

  /** Remove every listener of every event (used by tests and by the pop-out on unload). */
  clear() {
    this._listeners.clear();
  }
}

/** The app-wide bus. `popout/main.js` creates its own `new EventBus()` — never import `bus` there. */
export const bus = new EventBus();

// ---------------------------------------------------------------------------------------------------------
// Payload typedefs (other modules import them with `@typedef {import('../core/events.js').DocChanged}`).
// ---------------------------------------------------------------------------------------------------------

/**
 * Change hints are computed by the store by diffing the previous and next document (section 3.3.4).
 * A hint key is ABSENT when that part did not change; array hints list the ids that were added, removed or modified.
 * @typedef {Object} DocChanged
 * @property {string} label       human label of the change ('Move vertex', 'Load sample: tshirt', 'Undo: Move vertex')
 * @property {'update'|'drag'|'commit'|'cancel'|'undo'|'redo'|'replace'} origin
 * @property {import('./types.js').ProjectDoc} doc   the NEW current document (same reference store.get() returns)
 * @property {import('./types.js').Issue[]} warnings  warn-level issues from validateShape(doc)
 * @property {string[]} [pieces]   ids of pieces added/removed/modified (order: as in doc.pieces, removed ids appended)
 * @property {string[]} [seams]    ids of seams added/removed/modified
 * @property {string[]} [fabrics]  ids of fabric instances added/removed/modified
 * @property {true} [body]         body.preset or any body.params value changed
 * @property {true} [sizes]        sizes.measurements / baseSize / rows changed
 * @property {true} [sim]          any SimSettings value changed
 * @property {true} [ui]           any UiState value changed
 * @property {true} [name]         doc.name changed
 */

/**
 * @typedef {Object} Selection
 * @property {string[]} pieces       selected piece ids (order of selection)
 * @property {string[]} seams        selected seam ids
 * @property {{pieceId:string, index:number}|null} vertex   single selected outline vertex (edit tool)
 * @property {{pieceId:string, edge:number}|null} edge      single selected outline edge
 */
/** @typedef {{selection: Selection, prev: Selection}} SelectionChanged */

/** @typedef {'select'|'draw'|'edit'|'split'|'seam'|'notch'|'grainline'|'measure'} ToolName */
/** @typedef {{tool: ToolName, prev: ToolName}} ToolChanged */

/**
 * Emitted on pointer move over the 2D canvas, throttled to one per animation frame; mm is null when the pointer leaves.
 * @typedef {Object} HoverChanged
 * @property {import('./types.js').Vec2|null} mm   cursor in pattern space
 * @property {string|null} pieceId
 * @property {number|null} edge
 * @property {number|null} vertex
 * @property {string|null} seamId
 */

/**
 * Seam tool feedback (section 3.2.2).
 * @typedef {Object} SeamPreview
 * @property {import('./types.js').SeamSide|null} a
 * @property {import('./types.js').SeamSide|null} b
 * @property {number} lenA_mm      outline length of side a (0 when a is null)
 * @property {number} lenB_mm
 * @property {number} easePct      100 * (max(lenA,lenB) / min(lenA,lenB) - 1); 0 when either side is null
 * @property {'ok'|'warn'|'error'} level   ok < 8 %, warn 8..50 %, error > 50 %
 * @property {string|null} seamId  id of the created seam (second click) or the seam being inspected
 */

/** @typedef {{pxPerMm:number, panMm: import('./types.js').Vec2, width:number, height:number}} View2dChanged */

/**
 * Slider drag preview. The store is NOT written during a drag; `params` is the candidate BodyParams.
 * @typedef {{key: keyof import('./types.js').BodyParams, params: import('./types.js').BodyParams}} BodyParamsDrag
 */
/** Emitted right AFTER the Body panel committed the drag/edit to the store. @typedef {{key: string|null, preset: string, params: import('./types.js').BodyParams}} BodyParamsCommit */

/**
 * @typedef {Object} BodyBuilt
 * @property {import('./types.js').BodyModel} model
 * @property {'coarse'|'full'} quality   coarse = 30 mm grid built during a slider drag; full = 15 mm grid
 * @property {number} ms
 */

/**
 * @typedef {Object} MeshBuilt
 * @property {import('./types.js').PieceMesh[]} meshes   one per piece with simulate === true that meshed successfully
 * @property {import('./types.js').Issue[]} issues       RemeshError per failed piece (level 'error'), quality warnings (level 'warn')
 * @property {number} ms
 */

/** @typedef {{state: import('./types.js').ClothState, meshes: import('./types.js').PieceMesh[], ms: number}} SimBuilt */

/** The SimStats object from cloth/stats.js. THE SAME OBJECT IS REUSED EVERY FRAME — copy fields, never keep the reference. @typedef {import('./types.js').SimStats} SimStatsPayload */

/**
 * arranged: state built or reset, not stepping.  sewing: stepping, time < sewTime_s + 0.5.  draping: stepping after that.
 * paused: stepping stopped by the user (prev tells which phase it was in).
 * @typedef {{phase:'arranged'|'sewing'|'draping'|'paused', prev:'arranged'|'sewing'|'draping'|'paused', time:number, frame:number}} SimPhase
 */

/** @typedef {{frame:number, nanCount:number, restored:'snapshot'|'reset'}} SimNan */

/**
 * @typedef {Object} FabricChanged
 * @property {string} fabricId
 * @property {import('./types.js').FabricResolved} resolved
 * @property {boolean} physicsChanged   preset or any override value differs from the previous resolution
 * @property {boolean} lookChanged      color or texture differs
 * @property {string[]} pieceIds        pieces referencing this fabric
 */

/** @typedef {{size:string, prev:string, row: import('./types.js').SizeRow|null}} SizeActive */

/** @typedef {{layout:'split'|'2d'|'3d', swapped:boolean, split:number, popout:boolean}} UiLayout */
/** @typedef {{tab:'pieces'|'body'|'fabric'|'sizes', prev:'pieces'|'body'|'fabric'|'sizes'}} UiDock */
/**
 * @typedef {Object} UiStatus
 * @property {'info'|'warn'|'error'} level
 * @property {string} text
 * @property {string} [source]     module name ('remesh', 'body', 'sim', 'export', 'bus', ...)
 * @property {number} [ttl_ms]     auto-clear after this many ms; default 4000 for info, 8000 for warn, sticky for error
 * @property {string} [code]       the Error.code that produced it, when any
 */

/** @typedef {{at:number}} PopoutOpen */
/** @typedef {{reason:'user'|'unload'|'timeout'|'blocked', at:number}} PopoutClose */

/** @typedef {{version:string, ms:number, sample:string}} AppReady */

/** A toolbar button, shortcut or panel intent (SPEC 11.1.2 / 11.7); consumed by app/wiring.js only. @typedef {{action:string, [k:string]:any}} UiAction */
/** Result of pattern/validate.js validateDoc after a doc change (coalesced to one animation frame). @typedef {{issues: import('./types.js').Issue[]}} PatternIssues */
