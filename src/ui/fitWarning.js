// src/ui/fitWarning.js — the banner at the top-left of #main that says the active size cannot fit the
// body (SPEC 11.9).
//
// Without it the only symptom of a too-small size is the drape itself tearing, which looks like a
// simulation bug rather than a pattern that is 6 cm too narrow. The banner appears BEFORE the garment
// is simulated, because the check is geometric: graded panel widths against the body's largest torso
// girth (see sizing/fit.js).
//
// Reads the store, writes only `ui.activeSize` when the user takes the offered size — the same single
// write the toolbar's size select makes.

import { EVENT } from '../core/events.js';
import { checkFit } from '../sizing/index.js';
import { byId } from './ids.js';

/** @typedef {import('../core/store.js').Store} Store */
/** @typedef {import('../core/events.js').EventBus} EventBus */
/** @typedef {import('../sizing/fit.js').FitReport} FitReport */

/** Debounce for recomputing after a document change. */
export const COALESCE_MS = 50;

/**
 * @param {Store} store @param {EventBus} bus @param {Document|HTMLElement} [root=document]
 * @returns {object} controller
 */
export function createFitWarning(store, bus, root = document) {
  const el = byId(root, 'fit-warning');
  const elText = byId(root, 'fit-warning-text');
  const btnUse = /** @type {HTMLButtonElement|null} */ (byId(root, 'btn-fit-use'));
  const btnDismiss = byId(root, 'btn-fit-dismiss');

  /** @type {Array<() => void>} */
  const offs = [];
  /** @type {FitReport|null} */
  let report = null;
  /** The message the user dismissed; a different message shows again. */
  let dismissed = '';
  let raf = 0;
  let destroyed = false;

  /** @returns {FitReport|null} */
  function compute() {
    const doc = store.get();
    if (!doc || !Array.isArray(doc.pieces) || doc.pieces.length === 0) return null;
    const size = doc.ui && doc.ui.activeSize;
    const body = doc.body && doc.body.params;
    if (!size || !body) return null;
    try {
      return checkFit(doc, size, body);
    } catch {
      // an invalid chart is the Sizes panel's problem to report, not ours
      return null;
    }
  }

  function paint() {
    raf = 0;
    if (destroyed || !el) return;
    report = compute();
    const show = !!report && report.level !== 'ok' && report.message !== dismissed;
    if (!show) {
      el.hidden = true;
      el.dataset.level = '';
      return;
    }
    const r = /** @type {FitReport} */ (report);
    el.hidden = false;
    el.dataset.level = r.level;
    if (elText) elText.textContent = r.message;
    if (btnUse) {
      if (r.better) {
        btnUse.hidden = false;
        btnUse.textContent = 'Use ' + r.better.name;
        btnUse.dataset.size = r.better.name;
      } else {
        btnUse.hidden = true;
        btnUse.removeAttribute('data-size');
      }
    }
  }

  /**
   * Coalesce bursts of doc changes. A timer rather than requestAnimationFrame on purpose: rAF is
   * paused while the window is hidden or backgrounded, and a warning that only appears once you look
   * at the tab is no use to an automated check — or to a user who switched away mid-drape.
   */
  function schedule() {
    if (destroyed || raf) return;
    raf = setTimeout(paint, COALESCE_MS);
  }

  if (btnUse) {
    const onUse = () => {
      const name = btnUse.dataset.size;
      if (!name) return;
      dismissed = '';
      store.update((d) => { d.ui.activeSize = name; }, 'ui:activeSize');
    };
    btnUse.addEventListener('click', onUse);
    offs.push(() => btnUse.removeEventListener('click', onUse));
  }
  if (btnDismiss) {
    const onDismiss = () => {
      dismissed = report ? report.message : '';
      if (el) el.hidden = true;
    };
    btnDismiss.addEventListener('click', onDismiss);
    offs.push(() => btnDismiss.removeEventListener('click', onDismiss));
  }

  for (const evt of [EVENT.DOC_CHANGED, EVENT.SIZE_ACTIVE, EVENT.BODY_BUILT]) {
    if (!evt) continue;
    const off = bus.on(evt, schedule);
    if (typeof off === 'function') offs.push(off);
  }

  schedule();

  return {
    /** @returns {FitReport|null} the last computed report (SPEC 12.3) */
    report: () => report,
    refresh: paint,
    /** Forget a dismissal, so the current warning shows again (tests; a new message shows anyway). */
    clearDismissed() { dismissed = ''; paint(); },
    destroy() {
      destroyed = true;
      if (raf) { clearTimeout(raf); raf = 0; }
      for (const off of offs) { try { off(); } catch { /* ignore */ } }
      offs.length = 0;
    },
  };
}
