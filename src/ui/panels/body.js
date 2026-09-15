// src/ui/panels/body.js — the Body dock panel (SPEC 11.8.2).
// The 20 parameter rows are STATIC in index.html (ids `body-<key>` and `body-<key>-num`): this panel BINDS them,
// it never rebuilds them (duplicate ids would break automation).
// Drag coalescing: `input` emits EVENT.BODY_PARAMS_DRAG (no store write, at most one per animation frame);
// `change` performs ONE store.update then emits EVENT.BODY_PARAMS_COMMIT.

import { EVENT } from '../../core/events.js';
import { clamp } from '../../core/units.js';
import { PARAM_DEFS, BODY_PRESETS, PRESET_LABELS, clampParams } from '../../body/index.js';
import { rowByName } from '../../sizing/index.js';
import { byId } from '../ids.js';

/** @typedef {import('../../core/store.js').Store} Store */
/** @typedef {import('../../core/events.js').EventBus} EventBus */

/** Measured keys shown in #body-measured (SPEC 11.1.2). */
export const MEASURED_KEYS = Object.freeze(['chest_cm', 'waist_cm', 'hips_cm']);
/** |target − measured| above this is flagged. */
export const MEASURED_WARN_CM = 1.5;

/**
 * @param {Store} store @param {EventBus} bus @param {Document|HTMLElement} [root=document]
 * @returns {object} {refresh, setModel, setClosest, destroy}
 */
export function createBodyPanel(store, bus, root = document) {
  /** @type {Array<() => void>} */
  const offs = [];
  let destroyed = false;

  const doc0 = root.ownerDocument || /** @type {Document} */ (root);
  const selPreset = /** @type {HTMLSelectElement|null} */ (byId(root, 'sel-body-preset'));
  const elMeasured = byId(root, 'body-measured');
  const elClosest = byId(root, 'body-closest-size');
  const elBuildMs = byId(root, 'body-build-ms');
  const btnFit = byId(root, 'btn-body-fit-size');

  /** @type {Map<string, {def:any, range:HTMLInputElement|null, num:HTMLInputElement|null}>} */
  const rows = new Map();
  for (const def of PARAM_DEFS) {
    rows.set(def.key, {
      def,
      range: /** @type {HTMLInputElement|null} */ (byId(root, 'body-' + def.key)),
      num: /** @type {HTMLInputElement|null} */ (byId(root, 'body-' + def.key + '-num')),
    });
  }

  /** @param {HTMLElement|null} t @param {string} type @param {(e:any)=>void} fn */
  function on(t, type, fn) {
    if (!t) return;
    t.addEventListener(type, /** @type {EventListener} */ (fn));
    offs.push(() => t.removeEventListener(type, /** @type {EventListener} */ (fn)));
  }

  // ------------------------------------------------------------------ preset select

  if (selPreset) {
    selPreset.textContent = '';
    for (const id of Object.keys(BODY_PRESETS)) {
      const o = doc0.createElement('option');
      o.value = id;
      o.textContent = (PRESET_LABELS && PRESET_LABELS[id]) || id;
      selPreset.appendChild(o);
    }
    const custom = doc0.createElement('option');
    custom.value = 'custom';
    custom.textContent = 'Custom';
    selPreset.appendChild(custom);
  }

  on(selPreset, 'change', () => {
    const id = selPreset ? selPreset.value : 'custom';
    if (id === 'custom' || !BODY_PRESETS[id]) return;
    store.update((d) => {
      d.body.preset = id;
      d.body.params = structuredClone(BODY_PRESETS[id]);
    }, 'body:preset');
    bus.emit(EVENT.BODY_PARAMS_COMMIT, { key: null, preset: id, params: structuredClone(store.get().body.params) });
  });

  // ------------------------------------------------------------------ sliders

  /** @type {Record<string, number>|null} */
  let draft = null;
  /** @type {string|null} */
  let draftKey = null;
  let dragRaf = 0;
  /** @type {any} */
  let dragTimer = null;
  let dragPending = false;

  /** Emits at most one BODY_PARAMS_DRAG per animation frame (a hidden tab falls back to the timer). */
  function flushDrag() {
    if (!dragPending) return;
    dragPending = false;
    if (dragRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(dragRaf);
    dragRaf = 0;
    if (dragTimer) { clearTimeout(dragTimer); dragTimer = null; }
    if (destroyed || !draft || !draftKey) return;
    bus.emit(EVENT.BODY_PARAMS_DRAG, { key: draftKey, params: clampParams(draft) });
  }

  function scheduleDrag() {
    if (dragPending) return;
    dragPending = true;
    if (typeof requestAnimationFrame === 'function') dragRaf = requestAnimationFrame(flushDrag);
    dragTimer = setTimeout(flushDrag, 32);
  }

  /** @param {any} def @param {string} raw @returns {number} */
  function parseValue(def, raw) {
    const v = Number(raw);
    if (!Number.isFinite(v)) return NaN;
    return Math.round(clamp(v, def.min, def.max) * 1e6) / 1e6;
  }

  /** @param {string} key @param {number} v @param {HTMLInputElement|null} except */
  function writeRow(key, v, except) {
    const row = rows.get(key);
    if (!row) return;
    const s = String(v);
    if (row.range && row.range !== except && row.range.value !== s) row.range.value = s;
    if (row.num && row.num !== except && row.num.value !== s) row.num.value = s;
  }

  /** @param {string} key @param {number} v */
  function commit(key, v) {
    store.update((d) => {
      d.body.params[key] = v;
      d.body.preset = 'custom';
    }, 'body:param');
    draft = null;
    draftKey = null;
    bus.emit(EVENT.BODY_PARAMS_COMMIT, { key, preset: 'custom', params: structuredClone(store.get().body.params) });
  }

  for (const [key, row] of rows) {
    const def = row.def;
    // range: live drag preview, NO store write (SPEC 3.3.6 rule 5).
    on(row.range, 'input', () => {
      const v = parseValue(def, row.range.value);
      if (!Number.isFinite(v)) return;
      writeRow(key, v, row.range);
      const base = draft || store.get().body.params;
      draft = { ...base, [key]: v };
      draftKey = key;
      scheduleDrag();
    });
    on(row.range, 'change', () => {
      const v = parseValue(def, row.range.value);
      if (!Number.isFinite(v)) { refresh(); return; }
      writeRow(key, v, null);
      commit(key, v);
    });
    // number: typing must not rebake; only `change` commits.
    on(row.num, 'change', () => {
      const v = parseValue(def, row.num.value);
      if (!Number.isFinite(v)) { refresh(); return; }
      writeRow(key, v, null);
      commit(key, v);
    });
  }

  // ------------------------------------------------------------------ fit body to the active size

  on(btnFit, 'click', () => {
    if (btnFit && typeof (/** @type {any} */ (btnFit).blur) === 'function') /** @type {any} */ (btnFit).blur();
    store.update((d) => {
      const rowActive = rowByName(d.sizes, d.ui.activeSize);
      if (!rowActive) return;
      for (const k of d.sizes.measurements) {
        if (typeof rowActive[k] === 'number' && k in d.body.params) d.body.params[k] = rowActive[k];
      }
      d.body.preset = 'custom';
    }, 'body:fitSize');
    bus.emit(EVENT.BODY_PARAMS_COMMIT, { key: null, preset: 'custom', params: structuredClone(store.get().body.params) });
  });

  // ------------------------------------------------------------------ readouts

  /** @param {import('../../core/types.js').BodyModel|null} model */
  function setModel(model) {
    if (!model) {
      if (elMeasured) elMeasured.textContent = '';
      if (elBuildMs) elBuildMs.textContent = '';
      return;
    }
    if (elMeasured) {
      elMeasured.textContent = '';
      for (const k of MEASURED_KEYS) {
        const target = model.params ? Number(model.params[k]) : NaN;
        const got = model.measured ? Number(model.measured[k]) : NaN;
        const span = doc0.createElement('span');
        span.dataset.testid = 'body-measured-' + k;
        span.textContent = k.replace('_cm', '') + ' ' + (Number.isFinite(target) ? target.toFixed(1) : '–')
          + ' → ' + (Number.isFinite(got) ? got.toFixed(1) : '–') + ' cm';
        const bad = Number.isFinite(target) && Number.isFinite(got) && Math.abs(got - target) > MEASURED_WARN_CM;
        span.dataset.warn = String(bad);
        elMeasured.appendChild(span);
        elMeasured.appendChild(doc0.createTextNode(' '));
      }
    }
    if (elBuildMs) elBuildMs.textContent = 'build ' + Number(model.buildMs || 0).toFixed(0) + ' ms';
    setClosest(closestOf(store.get(), model.params || store.get().body.params));
  }

  /**
   * Δ = Σ_k |row[k] − params[k]| in cm over the chart measurements present in params (SPEC 11.8.2).
   * @param {any} doc @param {Record<string, number>} params
   * @returns {{name:string, delta:number}|null}
   */
  function closestOf(doc, params) {
    const sizes = doc && doc.sizes;
    if (!sizes || !Array.isArray(sizes.rows) || sizes.rows.length === 0) return null;
    const keys = (sizes.measurements || []).filter((/** @type {string} */ k) => typeof params[k] === 'number');
    if (keys.length === 0) return null;
    let best = null;
    for (const r of sizes.rows) {
      let delta = 0;
      for (const k of keys) {
        const rv = Number(r[k]);
        if (!Number.isFinite(rv)) continue;
        delta += Math.abs(rv - params[k]);
      }
      if (!best || delta < best.delta) best = { name: r.name, delta };
    }
    return best;
  }

  /** @param {{name:string, delta?:number, score?:number}|string|null} closest */
  function setClosest(closest) {
    if (!elClosest) return;
    if (!closest) { elClosest.textContent = ''; return; }
    if (typeof closest === 'string') { elClosest.textContent = 'closest size: ' + closest; return; }
    const d = Number.isFinite(closest.delta) ? Number(closest.delta) : Number(closest.score);
    elClosest.textContent = 'closest size: ' + closest.name + (Number.isFinite(d) ? ' (Δ ' + d.toFixed(1) + ' cm)' : '');
  }

  // ------------------------------------------------------------------ refresh

  function refresh() {
    if (destroyed) return;
    const doc = store.get();
    const params = (doc && doc.body && doc.body.params) || {};
    const focused = doc0.activeElement;
    for (const [key, row] of rows) {
      const v = params[key];
      if (typeof v !== 'number') continue;
      const s = String(v);
      if (row.range && row.range !== focused && row.range.value !== s) row.range.value = s;
      if (row.num && row.num !== focused && row.num.value !== s) row.num.value = s;
    }
    if (selPreset && selPreset !== focused) {
      const p = (doc && doc.body && doc.body.preset) || 'custom';
      selPreset.value = Array.from(selPreset.options).some((o) => o.value === p) ? p : 'custom';
    }
    setClosest(closestOf(doc, params));
  }

  offs.push(store.subscribe((change) => {
    if (destroyed) return;
    if (change && (change.body || change.sizes || change.ui)) refresh();
  }));
  offs.push(bus.on(EVENT.BODY_BUILT, (p) => { if (p && p.model) setModel(p.model); }));

  refresh();

  return {
    refresh,
    setModel,
    setClosest,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      dragPending = false;
      if (dragRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(dragRaf);
      if (dragTimer) clearTimeout(dragTimer);
      for (const off of offs) { try { off(); } catch { /* ignore */ } }
      offs.length = 0;
    },
  };
}
