// src/ui/index.js — public API of the UI module (SPEC 11.3–11.8). Owns index.html outside #canvas-2d / #view-3d.
// The UI never calls another module's API: buttons, shortcuts and panel intents emit EVENT.UI_ACTION and the
// panels write to the store; src/app/wiring.js is the only listener of ui:action.

export { createLayout, SPLIT_MIN, SPLIT_MAX, LAYOUT_MODES } from './layout.js';
export { createToolbar, TOOLBAR_ACTIONS, EXPORT_ACTIONS } from './toolbar.js';
export { createDock, DOCK_TABS } from './dock.js';
export { createStatusbar, LOG_LIMIT, TTL_MS } from './statusbar.js';
export { createShortcuts, SHORTCUTS } from './shortcuts.js';
export { createPiecesPanel } from './panels/pieces.js';
export { createBodyPanel } from './panels/body.js';
export { createFabricPanel } from './panels/fabric.js';
export { createSizesPanel } from './panels/sizes.js';
export { REQUIRED_IDS, BODY_PARAM_IDS, ALL_IDS, byId, requireEl, missingIds, checkIds } from './ids.js';

import { createLayout } from './layout.js';
import { createToolbar } from './toolbar.js';
import { createDock } from './dock.js';
import { createStatusbar } from './statusbar.js';
import { createShortcuts } from './shortcuts.js';
import { createPiecesPanel } from './panels/pieces.js';
import { createBodyPanel } from './panels/body.js';
import { createFabricPanel } from './panels/fabric.js';
import { createSizesPanel } from './panels/sizes.js';
import { ALL_IDS, byId } from './ids.js';

/** @typedef {import('../core/store.js').Store} Store */
/** @typedef {import('../core/events.js').EventBus} EventBus */

/**
 * Creates every UI piece in order layout, toolbar, dock, statusbar, panels, shortcuts (SPEC 11.8.5).
 * @param {{store: Store, bus: EventBus, root?: Document|HTMLElement}} args
 * @returns {object} the UI facade
 */
export function createUi({ store, bus, root = document }) {
  if (!store || !bus) {
    const err = /** @type {Error & {code:string}} */ (new Error('createUi: store and bus are required'));
    err.code = 'UI_BAD_ARGS';
    throw err;
  }

  const layout = createLayout(store, bus, root);
  const toolbar = createToolbar(store, bus, root);
  const dock = createDock(store, bus, root);
  const statusbar = createStatusbar(bus, root);
  const pieces = createPiecesPanel(store, bus, root);
  const body = createBodyPanel(store, bus, root);
  const fabric = createFabricPanel(store, bus, root);
  const sizes = createSizesPanel(store, bus, root);
  const shortcuts = createShortcuts(bus, typeof window !== 'undefined' ? window : undefined);

  const panels = { pieces, body, fabric, sizes };

  /** Fan a Selection out to the panels that mirror it. @param {any} selection */
  function setSelection(selection) {
    pieces.setSelection(selection);
    fabric.setSelection(selection);
  }

  /** Every bound element, keyed by id (SPEC 12.3 `__app.ui.elements`). @returns {Record<string, HTMLElement>} */
  function elements() {
    /** @type {Record<string, HTMLElement>} */
    const out = {};
    for (const id of ALL_IDS) {
      const el = byId(root, id);
      if (el) out[id] = el;
    }
    return out;
  }

  function refresh() {
    toolbar.refresh();
    pieces.refresh();
    body.refresh();
    fabric.refresh();
    sizes.refresh();
  }

  return {
    layout, toolbar, dock, statusbar, shortcuts, panels,
    setSelection, elements, refresh, root,
    destroy() {
      for (const part of [shortcuts, sizes, fabric, body, pieces, statusbar, dock, toolbar, layout]) {
        try { part.destroy(); } catch { /* ignore */ }
      }
    },
  };
}

export { runSelfTest } from './selftest.js';
