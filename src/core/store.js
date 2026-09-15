// src/core/store.js — document holder, undo/redo, batches (SPEC section 3.3).
// Imports schema.js, events.js and types.js. No I/O.

import { normalizeDoc, validateShape, stableStringify, migrate } from './schema.js';
import { EVENT } from './events.js';

/** @typedef {import('./types.js').ProjectDoc} ProjectDoc */
/** @typedef {import('./types.js').Issue} Issue */
/** @typedef {import('./events.js').DocChanged} DocChanged */
/** @typedef {import('./events.js').EventBus} EventBus */

/** @typedef {(draft: ProjectDoc) => (void | ProjectDoc)} Mutator */

/**
 * Owned by src/pattern/editor.js (tool, selection, hover, seamPick) and src/viewer3d/loop.js (running).
 * Other modules READ it; only the owner writes it and emits the matching event right after writing.
 * @typedef {Object} TransientState
 * @property {import('./events.js').ToolName} tool                default 'select'
 * @property {import('./events.js').Selection} selection           default {pieces:[], seams:[], vertex:null, edge:null}
 * @property {import('./events.js').HoverChanged|null} hover       default null
 * @property {import('./types.js').SeamSide|null} seamPick         first side picked by the seam tool, default null
 * @property {boolean} running                                     sim stepping, default false
 * @property {'arranged'|'sewing'|'draping'|'paused'} phase        default 'arranged'
 * @property {string|null} popoutId                                window name of the open pop-out, default null
 */

/**
 * @typedef {Object} Batch
 * @property {(mutator: Mutator) => ProjectDoc} update   apply a step (origin 'drag'); a ValidationError is stored in lastError
 * @property {() => ProjectDoc} commit                    one undo entry for the whole batch, emit origin 'commit'
 * @property {() => ProjectDoc} cancel                    restore the doc at begin, emit origin 'cancel'
 * @property {boolean} active
 * @property {Error|null} lastError
 * @property {string} label
 */

/**
 * @typedef {Object} Store
 * @property {() => ProjectDoc} get
 * @property {() => ProjectDoc} getDoc                                   alias of get
 * @property {(mutator: Mutator, label: string) => ProjectDoc} update
 * @property {(label: string) => Batch} batch
 * @property {() => boolean} undo
 * @property {() => boolean} redo
 * @property {() => boolean} canUndo
 * @property {() => boolean} canRedo
 * @property {() => {undo: string[], redo: string[]}} history
 * @property {(doc: object, label: string, opts?: {keepHistory?: boolean}) => ProjectDoc} replace
 * @property {(doc: object, label: string, opts?: {keepHistory?: boolean}) => ProjectDoc} load   alias of replace
 * @property {(fn: (change: DocChanged) => void) => () => void} subscribe
 * @property {TransientState} transient
 * @property {number} revision
 */

export const HISTORY_LIMIT = 100;
export const TOOL_NAMES = Object.freeze(['select', 'draw', 'edit', 'split', 'seam', 'notch', 'grainline', 'measure']);

/** @returns {TransientState} a fresh default TransientState */
export function makeTransient() {
  return {
    tool: 'select',
    selection: { pieces: [], seams: [], vertex: null, edge: null },
    hover: null,
    seamPick: null,
    running: false,
    phase: 'arranged',
    popoutId: null,
  };
}

/**
 * @param {Issue[]} issues @returns {Error & {code:string, issues:Issue[]}}
 */
function validationError(issues) {
  const errors = issues.filter((i) => i.level === 'error');
  const first = errors.length > 0 ? errors[0] : null;
  const msg = first ? (first.code + ': ' + first.message) : 'Validation failed';
  const err = /** @type {Error & {code:string, issues:Issue[]}} */ (new Error(msg));
  err.code = 'ValidationError';
  err.issues = issues;
  return err;
}

/** @param {string} code @param {string} message @returns {Error} */
function codedError(code, message) {
  const err = new Error(message);
  // @ts-ignore
  err.code = code;
  return err;
}

/** @param {Issue[]} issues @returns {boolean} */
function hasErrors(issues) {
  for (const i of issues) if (i.level === 'error') return true;
  return false;
}

/**
 * @param {any[]} list @returns {Map<string, string>} id -> stable string
 */
function byId(list) {
  /** @type {Map<string, string>} */
  const m = new Map();
  for (const item of (Array.isArray(list) ? list : [])) {
    if (item && typeof item.id === 'string') m.set(item.id, stableStringify(item));
  }
  return m;
}

/**
 * @param {any[]} prevList @param {any[]} nextList @returns {string[]} changed ids (next order, then removed in prev order)
 */
function diffById(prevList, nextList) {
  const prev = byId(prevList);
  const next = byId(nextList);
  /** @type {string[]} */
  const ids = [];
  for (const [id, s] of next) {
    if (!prev.has(id) || prev.get(id) !== s) ids.push(id);
  }
  for (const id of prev.keys()) {
    if (!next.has(id)) ids.push(id);
  }
  return ids;
}

/**
 * Change hints between two documents (section 3.3.4).
 * @param {ProjectDoc} prev @param {ProjectDoc} next
 * @returns {Partial<Pick<DocChanged, 'pieces'|'seams'|'fabrics'|'body'|'sizes'|'sim'|'ui'|'name'>>}
 */
export function diffHints(prev, next) {
  /** @type {any} */
  const hints = {};
  const pieces = diffById(prev.pieces, next.pieces);
  if (pieces.length > 0) hints.pieces = pieces;
  const seams = diffById(prev.seams, next.seams);
  if (seams.length > 0) hints.seams = seams;
  const fabrics = diffById(prev.fabrics, next.fabrics);
  if (fabrics.length > 0) hints.fabrics = fabrics;
  if (stableStringify(prev.body) !== stableStringify(next.body)) hints.body = true;
  if (stableStringify(prev.sizes) !== stableStringify(next.sizes)) hints.sizes = true;
  if (stableStringify(prev.sim) !== stableStringify(next.sim)) hints.sim = true;
  if (stableStringify(prev.ui) !== stableStringify(next.ui)) hints.ui = true;
  if (prev.name !== next.name) hints.name = true;
  return hints;
}

/** @param {object} hints @returns {boolean} */
function isEmpty(hints) {
  return Object.keys(hints).length === 0;
}

/** @param {object} hints @returns {boolean} true when the only hint key is 'ui' */
function isUiOnly(hints) {
  const keys = Object.keys(hints);
  return keys.length === 1 && keys[0] === 'ui';
}

/**
 * @param {object} doc      partial or full ProjectDoc; passed through migrate + normalizeDoc + validateShape
 * @param {EventBus} bus
 * @param {{historyLimit?: number}} [opts]   default 100
 * @returns {Store}
 */
export function createStore(doc, bus, opts) {
  const historyLimit = (opts && typeof opts.historyLimit === 'number' && opts.historyLimit >= 0)
    ? Math.trunc(opts.historyLimit) : HISTORY_LIMIT;

  /** @type {ProjectDoc} */
  let current;
  /** @type {{doc: ProjectDoc, label: string}[]} */
  let past = [];
  /** @type {{doc: ProjectDoc, label: string}[]} */
  let future = [];
  /** @type {((change: DocChanged) => void)[]} */
  const subscribers = [];
  /** @type {Batch|null} */
  let activeBatch = null;

  /** @type {Store} */
  const store = /** @type {any} */ ({});
  store.transient = makeTransient();
  store.revision = 0;

  /**
   * Prepare a document for loading: migrate, normalize, validate (errors throw).
   * @param {object} input @returns {{next: ProjectDoc, issues: Issue[], migrateWarnings: string[]}}
   */
  function prepare(input) {
    const migrated = migrate(input);
    const migrateWarnings = migrate.warnings.slice();
    const next = normalizeDoc(migrated);
    const issues = validateShape(next);
    if (hasErrors(issues)) throw validationError(issues);
    return { next, issues, migrateWarnings };
  }

  /**
   * The shared update pipeline: clone, mutate, normalize, validate (errors throw ValidationError), diff.
   * @param {ProjectDoc} prev @param {Mutator} mutator
   * @returns {{next: ProjectDoc, issues: Issue[], hints: object}}
   */
  function applyMutator(prev, mutator) {
    const draft = structuredClone(prev);
    const r = mutator(draft);
    let next = (r && typeof r === 'object') ? /** @type {ProjectDoc} */ (r) : draft;
    next = normalizeDoc(next);
    const issues = validateShape(next);
    if (hasErrors(issues)) throw validationError(issues);
    const hints = diffHints(prev, next);
    return { next, issues, hints };
  }

  /** @param {number} limit */
  function trimPast(limit) {
    while (past.length > limit) past.shift();
  }

  /**
   * @param {string} label @param {DocChanged['origin']} origin @param {ProjectDoc} next
   * @param {Issue[]} issues @param {object} hints
   */
  function notify(label, origin, next, issues, hints) {
    /** @type {DocChanged} */
    const change = Object.assign({ label, origin, doc: next, warnings: issues.filter((i) => i.level === 'warn') }, hints);
    const snapshot = subscribers.slice();
    for (const fn of snapshot) {
      try {
        fn(change);
      } catch (error) {
        const err = (error instanceof Error) ? error : new Error(String(error));
        try {
          console.error('[store] subscriber error', err);
        } catch (_e) {
          // ignore
        }
        bus.emit(EVENT.UI_STATUS, { level: 'error', text: 'Store subscriber error: ' + err.message, source: 'store' });
      }
    }
    bus.emit(EVENT.DOC_CHANGED, change);
  }

  // ---- initial load ------------------------------------------------------------------------------------
  current = prepare(doc).next;

  store.get = function get() { return current; };
  store.getDoc = store.get;

  store.update = function update(mutator, label) {
    if (activeBatch && activeBatch.active) return activeBatch.update(mutator);
    const prev = current;
    const { next, issues, hints } = applyMutator(prev, mutator);
    if (isEmpty(hints)) return prev;
    if (!isUiOnly(hints)) {
      past.push({ doc: prev, label: String(label) });
      trimPast(historyLimit);
      future = [];
    }
    current = next;
    store.revision++;
    notify(String(label), 'update', next, issues, hints);
    return next;
  };

  store.batch = function batch(label) {
    if (activeBatch && activeBatch.active) throw codedError('BatchActive', 'A batch is already active: ' + activeBatch.label);
    const docAtBegin = current;
    const batchLabel = String(label);
    let stepped = false;

    /** @type {Batch} */
    const b = {
      active: true,
      lastError: null,
      label: batchLabel,
      update(mutator) {
        if (!b.active) throw codedError('BatchEnded', 'Batch ' + batchLabel + ' has ended');
        const prev = current;
        let result;
        try {
          result = applyMutator(prev, mutator);
        } catch (error) {
          // @ts-ignore
          if (error && error.code === 'ValidationError') {
            b.lastError = /** @type {Error} */ (error);
            return prev;
          }
          throw error;
        }
        if (isEmpty(result.hints)) return prev;
        current = result.next;
        stepped = true;
        store.revision++;
        notify(batchLabel, 'drag', result.next, result.issues, result.hints);
        return result.next;
      },
      commit() {
        if (!b.active) return current;
        b.active = false;
        activeBatch = null;
        const hints = diffHints(docAtBegin, current);
        if (isEmpty(hints)) return current;
        if (!isUiOnly(hints)) {
          past.push({ doc: docAtBegin, label: batchLabel });
          trimPast(historyLimit);
          future = [];
        }
        notify(batchLabel, 'commit', current, validateShape(current), hints);
        return current;
      },
      cancel() {
        if (!b.active) return current;
        b.active = false;
        activeBatch = null;
        if (!stepped || current === docAtBegin) return current;
        const lastStep = current;
        current = docAtBegin;
        store.revision++;
        const hints = diffHints(lastStep, docAtBegin);
        notify(batchLabel, 'cancel', docAtBegin, validateShape(docAtBegin), hints);
        return current;
      },
    };
    activeBatch = b;
    return b;
  };

  store.undo = function undo() {
    if (activeBatch && activeBatch.active) return false;
    if (past.length === 0) return false;
    const entry = /** @type {{doc: ProjectDoc, label: string}} */ (past.pop());
    const previousCurrent = current;
    future.push({ doc: previousCurrent, label: entry.label });
    const restored = Object.assign({}, entry.doc, { ui: previousCurrent.ui });
    current = restored;
    store.revision++;
    notify('Undo: ' + entry.label, 'undo', restored, validateShape(restored), diffHints(previousCurrent, restored));
    return true;
  };

  store.redo = function redo() {
    if (activeBatch && activeBatch.active) return false;
    if (future.length === 0) return false;
    const entry = /** @type {{doc: ProjectDoc, label: string}} */ (future.pop());
    const previousCurrent = current;
    past.push({ doc: previousCurrent, label: entry.label });
    trimPast(historyLimit);
    const restored = Object.assign({}, entry.doc, { ui: previousCurrent.ui });
    current = restored;
    store.revision++;
    notify('Redo: ' + entry.label, 'redo', restored, validateShape(restored), diffHints(previousCurrent, restored));
    return true;
  };

  store.canUndo = function canUndo() { return past.length > 0; };
  store.canRedo = function canRedo() { return future.length > 0; };

  store.history = function history() {
    return {
      undo: past.map((e) => e.label),
      redo: future.slice().reverse().map((e) => e.label),
    };
  };

  store.replace = function replace(newDoc, label, replaceOpts) {
    if (activeBatch && activeBatch.active) activeBatch.cancel();
    const { next, issues, migrateWarnings } = prepare(newDoc);
    const prev = current;
    const keepHistory = !!(replaceOpts && replaceOpts.keepHistory);
    if (keepHistory) {
      past.push({ doc: prev, label: String(label) });
      trimPast(historyLimit);
      future = [];
    } else {
      past = [];
      future = [];
    }
    current = next;
    store.revision++;
    const t = store.transient;
    t.selection = { pieces: [], seams: [], vertex: null, edge: null };
    t.hover = null;
    t.seamPick = null;
    for (const w of migrateWarnings) {
      bus.emit(EVENT.UI_STATUS, { level: 'warn', text: w, source: 'migrate' });
    }
    notify(String(label), 'replace', next, issues, diffHints(prev, next));
    return next;
  };
  store.load = store.replace;

  store.subscribe = function subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError('store.subscribe: fn must be a function');
    subscribers.push(fn);
    return function unsubscribe() {
      const idx = subscribers.indexOf(fn);
      if (idx >= 0) subscribers.splice(idx, 1);
    };
  };

  return store;
}
