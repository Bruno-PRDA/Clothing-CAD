// src/app/main.js — boot sequence (SPEC 12.1). Composition root: parses the URL parameters, creates the store,
// installs window.__app BEFORE any stage runs, then runs the twelve stages in order. Every stage is wrapped: a
// failure is recorded, shown in the status bar and the boot continues with the remaining stages (12.1.5 — never a
// blank screen). This module must NOT import three, viewer3d or any module that imports them: `src/viewer3d/` and
// `src/body/` are loaded with `await import()` inside their own stage so a CDN failure is a stage error only.

import { bus, EVENT } from '../core/events.js';
import { createStore } from '../core/store.js';
import { normalizeDoc, serializeDoc } from '../core/schema.js';
import { createAutosave } from './autosave.js';
import * as samplesMod from '../samples/index.js';
import * as uiMod from '../ui/index.js';
import * as patternMod from '../pattern/index.js';
import { createWiring } from './wiring.js';
import { installDebugApi } from './debugApi.js';

/** @typedef {import('./wiring.js').AppContext} AppContext */
/** @typedef {import('./wiring.js').Wiring} Wiring */
/** @typedef {{ok:boolean, ms:number, errors:{stage:string, code:string, message:string}[], stages:Record<string, number>}} BootResult */

export const APP_VERSION = '1.0.0';

/** Build metadata; `built` is maintained by hand (there is no build step). @type {{version:string, built:string, three:string, url:string}} */
export const BUILD_INFO = {
  version: APP_VERSION,
  built: '2026-09-14',
  three: '0.180.0',
  url: '',
};

const BOOT_TIMEOUT_MS = 20000;
const DEFAULT_SAMPLE = 'tshirt';

/** @type {Promise<BootResult>|null} */
let bootPromise = null;

/** @returns {number} */
function nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

// ---------------------------------------------------------------- context

/**
 * @param {{root?: HTMLElement, search?: string}} [opts]
 * @returns {AppContext & any}
 */
function createContext(opts) {
  const root = (opts && opts.root) || (typeof document !== 'undefined' ? document.body : null);
  /** @type {any} */
  const ctx = {
    version: APP_VERSION,
    store: null,
    bus,
    params: { sample: null, nosim: false, size: null, acceptance: false },
    root,
    mods: { ui: null, editor: null, viewer: null },
    modules: { body: null, viewer3d: null },
    body: { model: null, quality: null, key: 0 },
    mesh: { byPiece: new Map(), failed: new Map(), keys: new Map(), spacingFactor: 1 },
    cloth: {
      state: null, stale: false, lastStats: null, running: false, userPaused: false,
      phase: 'empty', stepping: false, nanEvents: [], dirty: false, errorPaused: false,
    },
    keys: { build: new Map(), arrange: new Map(), seams: 0, body: 0, fabrics: new Map(), sim: 0, sizes: 0 },
    pending: {
      remeshTimer: 0, remeshSet: new Set(), remeshAll: false,
      bodyTimer: 0, bodyQuality: null, dragTimer: 0, dragParams: null,
    },
    fabricResolved: new Map(),
    bootErrors: [],
    log: [],
    lastStatsPush: 0,
    bootStartMs: nowMs(),
    lastActiveSize: null,
    stagesMs: /** @type {Record<string, number>} */ ({}),
    ready: null,
    resolveReady: null,
    wiring: null,
    showStatus: null,
  };
  ctx.showStatus = (/** @type {string} */ level, /** @type {string} */ text, /** @type {string|null} */ code) => {
    showStatus(ctx, /** @type {any} */ (level), text, code || null);
  };
  return ctx;
}

/**
 * Status message that a human and the automation can both see (12.1.5).
 * @param {any} ctx @param {'info'|'warn'|'error'} level @param {string} text @param {string|null} [code]
 */
function showStatus(ctx, level, text, code) {
  try {
    ctx.log.push({ t: Date.now(), level, message: text, code: code || null });
    while (ctx.log.length > 200) ctx.log.shift();
  } catch (_) { /* ignore */ }
  let delivered = false;
  try {
    if (ctx.bus) {
      ctx.bus.emit(EVENT.UI_STATUS, { level, text, source: 'app', code: code || null });
      delivered = !!(ctx.mods && ctx.mods.ui);
    }
  } catch (_) { /* ignore */ }
  if (delivered || typeof document === 'undefined') return;
  try {
    const el = document.getElementById('status-msg');
    if (el) {
      el.textContent = text;
      el.setAttribute('data-level', level);
      return;
    }
    let box = document.getElementById('boot-error');
    if (!box) {
      box = document.createElement('div');
      box.id = 'boot-error';
      box.setAttribute('style',
        'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#7a1616;color:#fff;'
        + 'font:12px/1.4 ui-monospace,Consolas,monospace;padding:6px 10px;white-space:pre-wrap;');
      document.body.appendChild(box);
    }
    box.textContent = text;
  } catch (_) { /* nothing else we can do */ }
}

// ---------------------------------------------------------------- URL parameters (12.1.2)

/**
 * @param {any} ctx @param {string} search
 * @returns {{sample:string|null, nosim:boolean, size:string|null, acceptance:boolean, bodyAssets:string|null, autosave:boolean}}
 */
function parseParams(ctx, search) {
  const q = new URLSearchParams(search || '');
  const raw = q.get('sample');
  let sample = DEFAULT_SAMPLE;
  if (raw) {
    if (raw === 'none') sample = 'none';
    else if (samplesMod.SAMPLE_IDS && samplesMod.SAMPLE_IDS.indexOf(raw) >= 0) sample = raw;
    else {
      sample = DEFAULT_SAMPLE;
      showStatus(ctx, 'warn', 'Unknown ?sample=' + raw + ' — loading ' + DEFAULT_SAMPLE, 'E_NO_SAMPLE');
    }
  }
  return {
    sample,
    nosim: q.get('nosim') === '1',
    size: q.get('size'),
    acceptance: q.get('acceptance') === '1',
    bodyAssets: q.get('bodyassets'),
    autosave: q.get('autosave') !== '0',
  };
}

// ---------------------------------------------------------------- stage runner (12.1.3)

/**
 * @param {any} ctx @param {string} name @param {() => any} fn
 * @returns {Promise<any>} the stage's value, or null when it failed
 */
async function stage(ctx, name, fn) {
  const t0 = nowMs();
  try {
    const r = await fn();
    ctx.stagesMs[name] = nowMs() - t0;
    return typeof r === 'undefined' ? true : r;
  } catch (err) {
    const e = /** @type {any} */ (err);
    const code = e && e.code ? String(e.code) : 'E_BOOT_STAGE';
    const message = String((e && e.message) || err);
    ctx.stagesMs[name] = nowMs() - t0;
    ctx.bootErrors.push({ stage: name, code, message });
    try { console.error('[boot] stage "' + name + '" failed:', err); } catch (_) { /* ignore */ }
    showStatus(ctx, 'error', name + ' failed: ' + message, code);
    return null;
  }
}

/**
 * A stage that could not run. It is only recorded as an error when an earlier stage failed (the skip is then a
 * consequence of that failure). A skip with a clean boot means there was legitimately nothing to do — an empty
 * document (`?sample=none`) has no cloth to build — and must keep `BootResult.ok === true` (gate 12.5.1).
 * @param {any} ctx @param {string} name @param {string} because
 */
function skipStage(ctx, name, because) {
  ctx.stagesMs[name] = 0;
  if (ctx.bootErrors.length > 0) {
    ctx.bootErrors.push({ stage: name, code: 'E_SKIPPED', message: 'skipped: ' + because });
  } else {
    try { console.info('[boot] stage "' + name + '" skipped: ' + because); } catch (_) { /* ignore */ }
  }
}

// ---------------------------------------------------------------- boot

/**
 * Boots the application. Idempotent: a second call returns the first promise. Never rejects.
 * @param {{root?: HTMLElement, search?: string}} [opts]
 * @returns {Promise<BootResult>}
 */
export function boot(opts) {
  if (bootPromise) return bootPromise;
  bootPromise = runBoot(opts || {}).catch((err) => {
    try { console.error('[boot] fatal', err); } catch (_) { /* ignore */ }
    return {
      ok: false, ms: 0,
      errors: [{ stage: 'boot', code: 'E_BOOT_FATAL', message: String((err && err.message) || err) }],
      stages: {},
    };
  });
  return bootPromise;
}

/**
 * @param {{root?: HTMLElement, search?: string}} opts
 * @returns {Promise<BootResult>}
 */
async function runBoot(opts) {
  const ctx = createContext(opts);
  const search = typeof opts.search === 'string'
    ? opts.search
    : (typeof location !== 'undefined' ? location.search : '');
  BUILD_INFO.url = typeof location !== 'undefined' ? location.href : '';

  let readyResolved = false;
  /** @type {(r: BootResult) => void} */
  let resolveReady = () => {};
  const ready = new Promise((resolve) => { resolveReady = /** @type {any} */ (resolve); });
  ctx.ready = ready;
  ctx.resolveReady = resolveReady;

  /** @param {BootResult} result */
  function finishReady(result) {
    if (readyResolved) return;
    readyResolved = true;
    ctx.bootResult = result;
    resolveReady(result);
    // debugApi may have replaced ctx.resolveReady with its own resolver (12.1.4): resolve that one too.
    try {
      if (typeof ctx.resolveReady === 'function' && ctx.resolveReady !== resolveReady) ctx.resolveReady(result);
    } catch (_) { /* ignore */ }
  }

  installGlobalErrorHandlers(ctx);

  // --- the wiring and window.__app exist before any stage (12.1.4)
  /** @type {Wiring|null} */
  let wiring = null;
  try {
    wiring = createWiring(ctx);
    ctx.wiring = wiring;
  } catch (err) {
    const e = /** @type {any} */ (err);
    ctx.bootErrors.push({ stage: 'wiring', code: e && e.code ? String(e.code) : 'E_BOOT_STAGE', message: String((e && e.message) || err) });
    try { console.error('[boot] createWiring failed:', err); } catch (_) { /* ignore */ }
  }

  const apiT0 = nowMs();
  try {
    installDebugApi(ctx, /** @type {any} */ (wiring));
    ctx.stagesMs.api = nowMs() - apiT0;
  } catch (err) {
    const e = /** @type {any} */ (err);
    ctx.stagesMs.api = nowMs() - apiT0;
    ctx.bootErrors.push({
      stage: 'api',
      code: e && e.code ? String(e.code) : 'E_BOOT_STAGE',
      message: String((e && e.message) || err),
    });
    try { console.error('[boot] stage "api" failed:', err); } catch (_) { /* ignore */ }
  }
  // Whatever happened above, __app.ready must exist immediately.
  installMinimalApi(ctx, ready);

  ctx.params = parseParams(ctx, search);
  ctx.stagesMs.params = 0;

  try {
    console.info('%cClothing App %s', 'font-weight:bold', APP_VERSION, {
      built: BUILD_INFO.built,
      three: BUILD_INFO.three,
      params: ctx.params,
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    });
  } catch (_) { /* ignore */ }

  const watchdog = setTimeout(() => {
    ctx.bootErrors.push({ stage: 'watchdog', code: 'E_BOOT_TIMEOUT', message: 'boot did not finish within 20 s' });
    showStatus(ctx, 'error', 'Boot timed out after 20 s', 'E_BOOT_TIMEOUT');
    finishReady(makeResult(ctx));
  }, BOOT_TIMEOUT_MS);

  // ------------------------------------------------------------ 2. store
  await stage(ctx, 'store', () => {
    let doc;
    try {
      doc = ctx.params.sample === 'none' ? normalizeDoc({}) : samplesMod.getSample(ctx.params.sample || DEFAULT_SAMPLE);
    } catch (err) {
      showStatus(ctx, 'warn', 'Sample could not be loaded — starting empty', 'E_NO_SAMPLE');
      doc = normalizeDoc({});
    }
    if (ctx.params.size) {
      const rows = (doc.sizes && Array.isArray(doc.sizes.rows)) ? doc.sizes.rows : [];
      if (rows.some((/** @type {any} */ r) => r.name === ctx.params.size)) doc.ui.activeSize = ctx.params.size;
      else showStatus(ctx, 'warn', 'Unknown ?size=' + ctx.params.size + ' — ignored', 'E_NO_SIZE');
    }
    try {
      ctx.store = createStore(doc, bus);
    } catch (err) {
      const e = /** @type {any} */ (err);
      showStatus(ctx, 'error', 'Document rejected (' + String((e && e.message) || err) + ') — starting empty', 'E_BAD_DOC');
      ctx.store = createStore(normalizeDoc({}), bus);
    }
    ctx.cloth.userPaused = !!ctx.params.nosim;
    return ctx.store;
  });

  const haveStore = !!ctx.store;

  // ------------------------------------------------------------ 4. ui
  if (!haveStore) skipStage(ctx, 'ui', 'store failed');
  else {
    await stage(ctx, 'ui', () => {
      if (typeof uiMod.createUi !== 'function') throw new Error('ui.createUi is not available');
      const uiRoot = (opts && opts.root) ? opts.root : document;
      ctx.mods.ui = uiMod.createUi({ store: ctx.store, bus, root: uiRoot });
      return ctx.mods.ui;
    });
  }

  // ------------------------------------------------------------ 5. editor
  if (!haveStore) skipStage(ctx, 'editor', 'store failed');
  else {
    await stage(ctx, 'editor', () => {
      const canvas = document.getElementById('canvas-2d');
      if (!canvas) throw new Error('#canvas-2d is missing from index.html');
      if (typeof patternMod.createEditor !== 'function') throw new Error('pattern.createEditor is not available');
      const editor = patternMod.createEditor(canvas, ctx.store, bus, { autoFit: true });
      ctx.mods.editor = editor;
      try { if (editor && editor.view && editor.view.fitToPieces) editor.view.fitToPieces(); } catch (_) { /* not fatal */ }
      return editor;
    });
  }

  // ------------------------------------------------------------ 6. viewer (dynamic import: three lives here)
  if (!haveStore) skipStage(ctx, 'viewer', 'store failed');
  else {
    await stage(ctx, 'viewer', async () => {
      const container = document.getElementById('view-3d');
      if (!container) throw new Error('#view-3d is missing from index.html');
      let viewer3d;
      try {
        viewer3d = await import('../viewer3d/index.js');
      } catch (err) {
        try { console.error('[boot] viewer3d import failed:', err); } catch (_) { /* ignore */ }
        const e = /** @type {any} */ (new Error(
          'three.js failed to load from cdn.jsdelivr.net — check the network (or run `python vendor.py` and open index.local.html)'));
        e.code = 'E_THREE_CDN';
        throw e;
      }
      ctx.modules.viewer3d = viewer3d;
      ctx.mods.viewer = viewer3d.createViewer3D(container, {
        tick: wiring ? wiring.tick : undefined,
      });
      return ctx.mods.viewer;
    });
  }

  // ------------------------------------------------------------ 7. body (dynamic import: mesh.js side)
  if (!haveStore || !wiring) skipStage(ctx, 'body', haveStore ? 'wiring failed' : 'store failed');
  else {
    await stage(ctx, 'body', async () => {
      ctx.modules.body = await import('../body/index.js');
      // The template mesh is fetched, so it has to be awaited here rather than inside buildBody, which
      // is synchronous and called from everywhere. A failure is reported and then ignored: buildBody
      // falls back to the analytic body, so a missing assets/body/ costs fidelity, not a working app.
      // `?bodyassets=<url>` points the loader elsewhere (a bad value exercises the fallback below).
      const tpl = await ctx.modules.body.initTemplate(ctx.params.bodyAssets || undefined);
      if (!tpl.ok) {
        // showStatus, not `status`: an undefined `status` resolves to the browser's legacy window.status
        // STRING, so this line threw a TypeError and a missing assets/body/ failed the whole body stage —
        // the fallback mannequin it announces was never built.
        showStatus(ctx, 'warn', 'Scanned body unavailable (' + tpl.error + ') — using the simpler mannequin', 'E_BODY_TEMPLATE');
      }
      const model = wiring.buildBody('full');
      if (!model) throw new Error('body build returned no model');
      return { template: tpl.ok, templateMs: Math.round(tpl.ms), buildMs: Math.round(model.buildMs || 0) };
    });
  }

  // ------------------------------------------------------------ 8. remesh
  if (!haveStore || !wiring) skipStage(ctx, 'remesh', haveStore ? 'wiring failed' : 'store failed');
  else {
    await stage(ctx, 'remesh', () => {
      const meshes = wiring.remesh(null, { force: true });
      const wanted = ctx.store.get().pieces.filter((/** @type {any} */ p) => p.simulate).length;
      if (wanted > 0 && meshes.length === 0) throw new Error('every piece failed to mesh');
      return meshes;
    });
  }

  // ------------------------------------------------------------ 9. cloth
  const haveMesh = ctx.mesh.byPiece.size > 0;
  if (!haveMesh || !wiring) skipStage(ctx, 'cloth', haveMesh ? 'wiring failed' : 'no meshes');
  else {
    await stage(ctx, 'cloth', () => {
      const state = wiring.rebuildCloth();
      if (!state) throw new Error('buildCloth produced no state');
      if (ctx.mods.viewer) /** @type {any} */ (wiring).installClothInViewer(state);
      return state;
    });
  }

  // ------------------------------------------------------------ 10. arrange
  if (!ctx.cloth.state || !ctx.body.model || !wiring) {
    skipStage(ctx, 'arrange', !ctx.cloth.state ? 'no cloth state' : 'no body model');
  } else {
    await stage(ctx, 'arrange', () => { wiring.arrange(); });
  }

  // ------------------------------------------------------------ 11. drape
  if (!ctx.cloth.state || !wiring) skipStage(ctx, 'drape', 'no cloth state');
  else {
    await stage(ctx, 'drape', () => {
      if (ctx.cloth.userPaused) {
        ctx.cloth.running = false;
        /** @type {any} */ (wiring).setPhase('arranged');
      } else {
        wiring.drape();
      }
    });
  }

  // ------------------------------------------------------------ 12. wire
  // Autosave before `start` subscribes to document changes. Suspended for the acceptance run and ?autosave=0,
  // so a test (or a user who opted out) can never overwrite unsaved work kept from an earlier session.
  try {
    ctx.autosave = createAutosave({ serialize: serializeDoc, onError: (e) => showStatus(ctx, 'warn', 'Autosave failed: ' + String((e && /** @type {any} */ (e).message) || e), 'E_AUTOSAVE') });
    if (ctx.params.acceptance || !ctx.params.autosave) ctx.autosave.suspend();
  } catch (err) {
    ctx.autosave = null;
    try { console.warn('[boot] autosave unavailable', err); } catch (_) { /* ignore */ }
  }
  if (!wiring) skipStage(ctx, 'wire', 'wiring failed');
  else await stage(ctx, 'wire', () => { wiring.start(); });

  // layout / size events once, now that everyone listens
  if (wiring && ctx.store) {
    try {
      const d = ctx.store.get();
      wiring.setActiveSize(d.ui.activeSize);
      bus.emit(EVENT.UI_LAYOUT, {
        layout: d.ui.layout, swapped: d.ui.swapped, split: d.ui.split, popout: false,
      });
    } catch (err) { try { console.error('[boot] post-wire', err); } catch (_) { /* ignore */ } }
  }

  await firstFrame(ctx);

  clearTimeout(watchdog);
  const result = makeResult(ctx);
  announce(ctx, result);
  finishReady(result);
  // After ready, never before: reading IndexedDB must not delay the boot, and the offer needs the UI.
  if (wiring && typeof /** @type {any} */ (wiring).offerRecovery === 'function') {
    /** @type {any} */ (wiring).offerRecovery().catch((err) => { try { console.warn('[boot] recovery offer failed', err); } catch (_) { /* ignore */ } });
  }

  if (ctx.params.acceptance) runAcceptanceLater(ctx);
  return result;
}

/** @param {any} ctx @returns {BootResult} */
function makeResult(ctx) {
  return {
    ok: ctx.bootErrors.length === 0,
    ms: nowMs() - ctx.bootStartMs,
    errors: ctx.bootErrors.slice(),
    stages: Object.assign({}, ctx.stagesMs),
  };
}

/** Wait for the first rendered frame after the drape started (12.1.3). @param {any} ctx @returns {Promise<void>} */
function firstFrame(ctx) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    if (ctx.mods.viewer && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(finish));
      setTimeout(finish, 1000);
    } else {
      setTimeout(finish, 0);
    }
  });
}

/** Console banner line 2, status bar, `data-app-ready`, app:ready. @param {any} ctx @param {BootResult} result */
function announce(ctx, result) {
  const verts = ctx.cloth.state ? ctx.cloth.state.V : 0;
  const bodyMs = ctx.body.model ? Math.round(ctx.body.model.buildMs || 0) : 0;
  const sample = ctx.params.sample || 'none';
  try {
    if (result.ok) {
      console.info('Clothing App ready in ' + Math.round(result.ms) + ' ms — verts ' + verts
        + ', body ' + (ctx.body.quality || 'none') + ' ' + bodyMs + ' ms, errors 0');
    } else {
      console.warn('Clothing App ready in ' + Math.round(result.ms) + ' ms — verts ' + verts
        + ', errors ' + result.errors.length + ':');
      for (const e of result.errors) console.warn('  ' + e.stage + ': ' + e.message + ' (' + e.code + ')');
    }
  } catch (_) { /* ignore */ }
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.dataset.appReady = result.ok ? 'true' : 'error';
    }
  } catch (_) { /* ignore */ }
  // A warning raised while booting (the scanned body failed to load, an unknown ?sample=) must survive the
  // boot: the "Ready" line used to replace it a moment later, so the user never learned the body was the
  // fallback mannequin.
  const warnings = (ctx.log || []).filter((e) => e && e.level === 'warn');
  if (result.ok && warnings.length === 0) {
    showStatus(ctx, 'info',
      'Ready — ' + sample + ' · ' + verts + ' verts · ' + Math.round(result.ms) + ' ms', null);
  } else if (result.ok) {
    showStatus(ctx, 'warn', warnings[0].message
      + (warnings.length > 1 ? ' (+' + (warnings.length - 1) + ' more warning' + (warnings.length > 2 ? 's' : '') + ')' : ''), warnings[0].code);
  } else {
    const first = result.errors[0];
    showStatus(ctx, 'error', first.stage + ': ' + first.message, first.code);
  }
  try {
    ctx.bus.emit(EVENT.APP_READY, { version: APP_VERSION, ms: result.ms, sample, errors: result.errors.length, warnings: warnings.length });
  } catch (_) { /* ignore */ }
}

/** `?acceptance=1`: run the suite once the app is idle; never blocks or breaks the boot. @param {any} ctx */
function runAcceptanceLater(ctx) {
  setTimeout(() => {
    try {
      const api = /** @type {any} */ (window).__app;
      if (!api || !api.acceptance || typeof api.acceptance.run !== 'function') return;
      showStatus(ctx, 'info', 'Running the acceptance suite…', null);
      Promise.resolve(api.acceptance.run()).then((summary) => {
        if (!summary) return;
        try { console.table(summary.results); } catch (_) { /* ignore */ }
        showStatus(ctx, summary.pass ? 'info' : 'error',
          'Acceptance: ' + summary.passed + '/' + summary.total + ' passed in ' + Math.round(summary.ms) + ' ms',
          summary.pass ? null : 'E_ACCEPTANCE');
      }).catch((err) => {
        showStatus(ctx, 'error', 'Acceptance suite failed: ' + String((err && err.message) || err), 'E_ACCEPTANCE');
      });
    } catch (err) {
      showStatus(ctx, 'error', 'Acceptance suite failed to start', 'E_ACCEPTANCE');
    }
  }, 0);
}

/**
 * Guarantee that `window.__app` exists with `version`, `ready`, `bus`, `ctx` and `log()` even when
 * installDebugApi threw (Phase-0 stub, or a bug in it). Never overwrites a real API.
 * @param {any} ctx @param {Promise<BootResult>} ready
 */
function installMinimalApi(ctx, ready) {
  if (typeof window === 'undefined') return;
  const w = /** @type {any} */ (window);
  const existing = w.__app;
  if (existing && typeof existing === 'object' && existing.ready && !existing.stubs) {
    if (!existing.ctx) { try { existing.ctx = ctx; } catch (_) { /* frozen */ } }
    return;
  }
  try {
    w.__app = {
      version: APP_VERSION,
      ready,
      bus: ctx.bus,
      ctx,
      minimal: true,
      log: () => ctx.log.slice(),
      doc: () => (ctx.store ? ctx.store.get() : null),
      store: ctx.store,
      wiring: ctx.wiring,
    };
  } catch (_) { /* ignore */ }
}

/** Uncaught errors become status messages; the app keeps running (12.1.5). @param {any} ctx */
function installGlobalErrorHandlers(ctx) {
  if (typeof window === 'undefined' || !window.addEventListener) return;
  window.addEventListener('error', (ev) => {
    const msg = ev && ev.message ? String(ev.message) : 'uncaught error';
    showStatus(ctx, 'error', msg, 'E_UNCAUGHT');
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = /** @type {any} */ (ev) && /** @type {any} */ (ev).reason;
    const msg = reason && reason.message ? String(reason.message) : String(reason);
    showStatus(ctx, 'error', 'Unhandled rejection: ' + msg, 'E_UNCAUGHT');
  });
}

// ---------------------------------------------------------------- auto-boot at import time (12.1)

try {
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { boot(); }, { once: true });
    } else {
      boot();
    }
  }
} catch (err) {
  try { console.error('[boot] could not start', err); } catch (_) { /* ignore */ }
}
