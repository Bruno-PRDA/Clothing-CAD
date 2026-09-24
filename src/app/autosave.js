// src/app/autosave.js — keep the project in the browser between saves, and offer it back after a crash.
//
// The project lives in one browser tab until the user clicks Save, so a crash, a closed tab or a reload used
// to lose everything since the last file. This module writes the serialized document to IndexedDB about a
// second and a half after every change (and at once when the tab is hidden or closed), and remembers whether
// that work has been saved to a file since. At the next start, unsaved work is offered back — never restored
// silently, because the user may have meant to leave it.
//
// "Dirty" means changed since the last explicit Save, Open, New or Load sample. View settings (layout, split,
// dock tab, active size, scene) are stored with the document but do not make it dirty on their own: nobody
// wants a recovery prompt for having dragged the pane divider.
//
// Test runs must never touch the user's record: `suspend()` turns every write (including "mark clean") into
// a no-op, and the debug API suspends autosave around the self-tests and the acceptance suite.

/** Storage key of the single autosave record. Bump the version when the record shape changes. */
export const AUTOSAVE_KEY = 'clothing-cad.autosave.v1';
/** Quiet time after the last change before the record is written. */
export const AUTOSAVE_DEBOUNCE_MS = 1500;

/**
 * @typedef {Object} AutosaveRecord
 * @property {number} v              record format, 1
 * @property {string} savedAt        ISO time of the write
 * @property {string} name           project name, for the recovery prompt
 * @property {boolean} dirty         changed since the last Save / Open / New / sample
 * @property {string} text           the serialized document
 */

/**
 * @typedef {Object} AutosaveStorage
 * @property {string} kind
 * @property {(key: string) => Promise<any>} get
 * @property {(key: string, value: any) => Promise<void>} set
 * @property {(key: string) => Promise<void>} del
 */

// ------------------------------------------------------------------------------------ storage adapters

/** In-memory storage: tests, and the last resort when the browser offers nothing. @returns {AutosaveStorage} */
export function memoryStorage() {
  const m = new Map();
  return {
    kind: 'memory',
    get: async (k) => (m.has(k) ? structuredClone(m.get(k)) : null),
    set: async (k, v) => { m.set(k, structuredClone(v)); },
    del: async (k) => { m.delete(k); },
  };
}

/** localStorage, for browsers where IndexedDB is unavailable (some private modes). @returns {AutosaveStorage|null} */
export function localStorageAdapter() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = '__clothing_cad_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return {
      kind: 'localStorage',
      get: async (k) => { const s = ls.getItem(k); return s ? JSON.parse(s) : null; },
      set: async (k, v) => { ls.setItem(k, JSON.stringify(v)); },
      del: async (k) => { ls.removeItem(k); },
    };
  } catch (_) {
    return null;
  }
}

/**
 * IndexedDB, the default: asynchronous (a large project never stalls typing) and not limited to ~5 MB.
 * @param {string} [dbName] @returns {AutosaveStorage|null}
 */
export function indexedDbStorage(dbName = 'clothing-cad') {
  const idb = globalThis.indexedDB;
  if (!idb) return null;
  const STORE = 'autosave';
  /** @type {Promise<IDBDatabase>|null} */
  let dbp = null;
  const db = () => {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = idb.open(dbName, 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
        req.onblocked = () => reject(new Error('indexedDB open blocked'));
      });
    }
    return dbp;
  };
  /** @param {'readonly'|'readwrite'} mode @param {(s: IDBObjectStore) => IDBRequest} fn */
  const run = async (mode, fn) => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error || req.error || new Error('indexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('indexedDB transaction aborted'));
    });
  };
  return {
    kind: 'indexedDB',
    get: async (k) => { const v = await run('readonly', (s) => s.get(k)); return v === undefined ? null : v; },
    set: async (k, v) => { await run('readwrite', (s) => s.put(v, k)); },
    del: async (k) => { await run('readwrite', (s) => s.delete(k)); },
  };
}

/** The best storage this browser offers. @returns {AutosaveStorage} */
export function defaultStorage() {
  return indexedDbStorage() || localStorageAdapter() || memoryStorage();
}

// ------------------------------------------------------------------------------------ the autosaver

/**
 * @param {{storage?: AutosaveStorage, key?: string, debounceMs?: number, serialize: (doc: any) => string,
 *   now?: () => Date, onError?: (err: unknown) => void}} opts
 */
export function createAutosave(opts) {
  const storage = opts.storage || defaultStorage();
  const key = opts.key || AUTOSAVE_KEY;
  const debounceMs = Number.isFinite(opts.debounceMs) ? Number(opts.debounceMs) : AUTOSAVE_DEBOUNCE_MS;
  const serialize = opts.serialize;
  const now = opts.now || (() => new Date());
  const onError = opts.onError || ((err) => { try { console.warn('autosave:', err); } catch (_) { /* ignore */ } });

  let suspended = 0;
  let dirty = false;
  /** @type {any} */
  let pendingDoc = null;
  let timer = 0;
  /** @type {Promise<void>} */
  let chain = Promise.resolve();
  let lastSavedAt = /** @type {string|null} */ (null);
  let writes = 0;

  /** Serialize writes so a slow one can never land after a newer one. @param {() => Promise<void>} job */
  const enqueue = (job) => {
    chain = chain.then(job).catch((err) => { onError(err); });
    return chain;
  };

  /** @param {any} doc @returns {AutosaveRecord} */
  const recordOf = (doc) => ({
    v: 1,
    savedAt: now().toISOString(),
    name: (doc && typeof doc.name === 'string' && doc.name) || 'Untitled',
    dirty,
    text: serialize(doc),
  });

  function clearTimer() { if (timer) { clearTimeout(timer); timer = 0; } }

  /**
   * A document changed. `dirtying` false for changes to view settings only.
   * @param {any} doc @param {{dirtying?: boolean}} [o]
   */
  function note(doc, o = {}) {
    if (suspended || !doc) return;
    if (o.dirtying !== false) dirty = true;
    pendingDoc = doc;
    clearTimer();
    timer = /** @type {any} */ (setTimeout(() => { timer = 0; flush(); }, debounceMs));
  }

  /** Write the pending document now (tab hidden, tab closing, tests). @returns {Promise<void>} */
  function flush() {
    clearTimer();
    if (suspended || !pendingDoc) return chain;
    const doc = pendingDoc;
    pendingDoc = null;
    const rec = recordOf(doc);
    return enqueue(async () => { await storage.set(key, rec); lastSavedAt = rec.savedAt; writes++; });
  }

  /**
   * The document is now safely elsewhere (saved to a file, just opened, a fresh sample or New): keep it as
   * the record but with nothing to recover.
   * @param {any} doc
   */
  function markClean(doc) {
    if (suspended) return chain;
    clearTimer();
    pendingDoc = null;
    dirty = false;
    if (!doc) return chain;
    const rec = recordOf(doc);
    return enqueue(async () => { await storage.set(key, rec); lastSavedAt = rec.savedAt; writes++; });
  }

  /** Restored work is unsaved work: stay dirty until the user saves it. */
  function markDirty() { if (!suspended) dirty = true; }

  /** @returns {Promise<AutosaveRecord|null>} */
  async function read() {
    await chain;
    const r = await storage.get(key);
    return r && typeof r === 'object' && typeof r.text === 'string' ? /** @type {AutosaveRecord} */ (r) : null;
  }

  /** Forget the record (the user chose Discard). */
  function discard() {
    if (suspended) return chain;
    clearTimer();
    pendingDoc = null;
    dirty = false;
    return enqueue(async () => { await storage.del(key); });
  }

  return {
    note, flush, markClean, markDirty, read, discard,
    /** Nest-able: every suspend() needs a resume(). Pending changes are dropped, not written. */
    suspend() { suspended++; clearTimer(); pendingDoc = null; },
    resume() { if (suspended > 0) suspended--; },
    isSuspended: () => suspended > 0,
    isDirty: () => dirty,
    status: () => ({ storage: storage.kind, dirty, suspended: suspended > 0, lastSavedAt, writes, pending: !!pendingDoc }),
    dispose() { clearTimer(); pendingDoc = null; },
  };
}

/**
 * Should a record found at start-up be offered back? Only unsaved work, and only if it is not simply the
 * document the app just opened with.
 * @param {AutosaveRecord|null} rec @param {string} currentText the serialized document now loaded
 * @returns {boolean}
 */
export function shouldOffer(rec, currentText) {
  return !!rec && rec.dirty === true && typeof rec.text === 'string' && rec.text.length > 0 && rec.text !== currentText;
}
