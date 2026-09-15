// src/ui/dock.js — the right dock tab strip (SPEC 11.5). Writes doc.ui.dockTab (label 'ui:dockTab', ui-only)
// and emits EVENT.UI_DOCK {tab, prev}.

import { EVENT } from '../core/events.js';
import { byId } from './ids.js';

/** @typedef {import('../core/store.js').Store} Store */
/** @typedef {import('../core/events.js').EventBus} EventBus */

/** @type {ReadonlyArray<'pieces'|'body'|'fabric'|'sizes'>} */
export const DOCK_TABS = Object.freeze(['pieces', 'body', 'fabric', 'sizes']);

/**
 * @param {Store} store @param {EventBus} bus @param {Document|HTMLElement} [root=document]
 * @returns {object} {setTab, getTab, show, get, destroy}
 */
export function createDock(store, bus, root = document) {
  const dock = byId(root, 'dock');
  const strip = byId(root, 'dock-tabs');
  const scope = dock || root;
  /** @type {HTMLElement[]} */
  const tabs = strip ? Array.from(strip.querySelectorAll('[role="tab"][data-tab]')) : [];
  /** @type {HTMLElement[]} */
  const panels = Array.from((/** @type {any} */ (scope)).querySelectorAll('.dock-panel[data-panel]'));

  /** @type {Array<() => void>} */
  const offs = [];
  let destroyed = false;
  /** @type {string} */
  let current = '';

  /** @param {string} name @returns {name is 'pieces'|'body'|'fabric'|'sizes'} */
  function isTab(name) { return DOCK_TABS.includes(/** @type {any} */ (name)); }

  /** @param {string} name */
  function applyDom(name) {
    for (const t of tabs) {
      const active = t.dataset.tab === name;
      t.setAttribute('aria-selected', String(active));
      t.classList.toggle('active', active);
      t.tabIndex = active ? 0 : -1;
    }
    for (const p of panels) p.hidden = p.dataset.panel !== name;
  }

  /** @param {'pieces'|'body'|'fabric'|'sizes'} name */
  function setTab(name) {
    if (!isTab(name)) {
      const err = /** @type {Error & {code:string}} */ (new Error('UI: unknown dock tab ' + name));
      err.code = 'UI_BAD_TAB';
      throw err;
    }
    const prev = current || name;
    applyDom(name);
    current = name;
    const doc = store.get();
    if (doc && doc.ui && doc.ui.dockTab !== name) {
      store.update((d) => { d.ui.dockTab = name; }, 'ui:dockTab');
    }
    bus.emit(EVENT.UI_DOCK, { tab: name, prev });
  }

  function getTab() { return current; }

  for (const t of tabs) {
    const click = () => setTab(/** @type {any} */ (t.dataset.tab));
    t.addEventListener('click', click);
    offs.push(() => t.removeEventListener('click', click));
    /** @param {KeyboardEvent} e */
    const key = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const i = tabs.indexOf(t);
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      if (!next) return;
      setTab(/** @type {any} */ (next.dataset.tab));
      next.focus();
    };
    t.addEventListener('keydown', /** @type {EventListener} */ (key));
    offs.push(() => t.removeEventListener('keydown', /** @type {EventListener} */ (key)));
  }

  offs.push(store.subscribe((change) => {
    if (destroyed || !change || !change.ui) return;
    const want = change.doc && change.doc.ui && change.doc.ui.dockTab;
    if (isTab(want) && want !== current) setTab(want);
  }));

  const initial = (store.get() && store.get().ui && store.get().ui.dockTab) || 'pieces';
  applyDom(isTab(initial) ? initial : 'pieces');
  current = isTab(initial) ? initial : 'pieces';
  bus.emit(EVENT.UI_DOCK, { tab: current, prev: current });

  return {
    setTab,
    getTab,
    show: setTab,
    get: getTab,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const off of offs) { try { off(); } catch { /* ignore */ } }
      offs.length = 0;
    },
  };
}
