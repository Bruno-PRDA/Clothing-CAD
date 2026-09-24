// src/ui/recoveryBanner.js — "unsaved work was found" at start-up, with Restore and Discard.
// The UI only shows the offer and reports the choice as ui:action {action:'recoverRestore'|'recoverDiscard'};
// src/app/wiring.js owns the autosave record and does the restoring.

import { EVENT } from '../core/events.js';
import { byId } from './ids.js';

/** @typedef {import('../core/store.js').Store} Store */
/** @typedef {import('../core/events.js').EventBus} EventBus */

/**
 * A short, human time: "14:32" today, "yesterday 14:32", else the date and time.
 * @param {string} iso @param {Date} [now] @returns {string}
 */
export function formatSavedAt(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'an earlier session';
  const hm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return 'today at ' + hm;
  if (diff === 1) return 'yesterday at ' + hm;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ' at ' + hm;
}

/**
 * @param {Store} store @param {EventBus} bus @param {Document|HTMLElement} [root=document]
 * @returns {{show(rec: {name: string, savedAt: string}): void, hide(): void, isShown(): boolean, destroy(): void}}
 */
export function createRecoveryBanner(store, bus, root = document) {
  const el = byId(root, 'recovery-banner');
  const text = byId(root, 'recovery-text');
  const btnRestore = byId(root, 'btn-recover-restore');
  const btnDiscard = byId(root, 'btn-recover-discard');
  /** @type {Array<() => void>} */
  const offs = [];

  /** @param {HTMLElement|null} b @param {string} action */
  function bind(b, action) {
    if (!b) return;
    const fn = () => { if (typeof b.blur === 'function') b.blur(); bus.emit(EVENT.UI_ACTION, { action }); };
    b.addEventListener('click', fn);
    offs.push(() => b.removeEventListener('click', fn));
  }
  bind(btnRestore, 'recoverRestore');
  bind(btnDiscard, 'recoverDiscard');

  return {
    show(rec) {
      if (!el) return;
      if (text) {
        text.textContent = 'Unsaved work found: “' + (rec.name || 'Untitled') + '”, last changed ' + formatSavedAt(rec.savedAt)
          + '. Autosave is paused until you choose.';
      }
      el.hidden = false;
    },
    hide() { if (el) el.hidden = true; },
    isShown: () => !!el && !el.hidden,
    destroy() { for (const off of offs) { try { off(); } catch { /* ignore */ } } offs.length = 0; },
  };
}
