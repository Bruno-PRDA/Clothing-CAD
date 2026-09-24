// src/ui/sceneControls.js — the Scene control over the 3D pane: backdrop/floor preset and a custom background
// colour. Writes `doc.ui.scene` (a view setting like the layout: saved with the project, not an undo step);
// src/app/wiring.js applies it to the viewer and the pop-out. Never touches three.js.

import { SCENE_PRESETS, DEFAULT_SCENE } from '../core/schema.js';
import { byId } from './ids.js';

/** @typedef {import('../core/store.js').Store} Store */
/** @typedef {import('../core/events.js').EventBus} EventBus */

/**
 * @param {Store} store @param {EventBus} bus @param {Document|HTMLElement} [root=document]
 * @returns {{refresh(): void, destroy(): void}}
 */
export function createSceneControls(store, bus, root = document) {
  const doc0 = /** @type {Document} */ (root.ownerDocument || root);
  const sel = /** @type {HTMLSelectElement|null} */ (byId(root, 'sel-scene'));
  const color = /** @type {HTMLInputElement|null} */ (byId(root, 'input-scene-bg'));
  const reset = /** @type {HTMLButtonElement|null} */ (byId(root, 'btn-scene-bg-reset'));
  /** @type {Array<() => void>} */
  const offs = [];
  let destroyed = false;

  if (sel) {
    sel.textContent = '';
    for (const p of SCENE_PRESETS) {
      const o = doc0.createElement('option');
      o.value = p.id;
      o.textContent = p.label;
      sel.appendChild(o);
    }
  }

  /** @param {EventTarget|null} t @param {string} type @param {(e: any) => void} fn */
  function on(t, type, fn) {
    if (!t) return;
    t.addEventListener(type, /** @type {EventListener} */ (fn));
    offs.push(() => t.removeEventListener(type, /** @type {EventListener} */ (fn)));
  }

  /** @returns {{preset: string, background: string|null}} */
  function current() {
    const d = store.get();
    const s = d && d.ui && d.ui.scene;
    return { preset: (s && s.preset) || DEFAULT_SCENE, background: (s && s.background) || null };
  }

  /** @param {Partial<{preset: string, background: string|null}>} patch */
  function write(patch) {
    const next = { ...current(), ...patch };
    store.update((d) => { d.ui.scene = next; }, 'ui:scene');
  }

  // No blur after a change, like every other list in the app: blurring made the NEXT arrow key miss the list
  // and reach the global nudge shortcut, which moved the selected pattern piece. Escape leaves the list.
  on(sel, 'change', () => { if (sel) write({ preset: sel.value }); });
  // `input` fires while the picker is dragged (live preview); `change` when it closes. Both write: a scene
  // change is a view setting, not an undo step, so a burst of writes costs nothing but a re-render.
  on(color, 'input', () => { if (color) write({ background: color.value }); });
  on(reset, 'click', () => { if (reset) reset.blur(); write({ background: null }); });

  function refresh() {
    if (destroyed) return;
    const s = current();
    const focused = doc0.activeElement;
    if (sel && sel !== focused && sel.value !== s.preset) sel.value = s.preset;
    if (color && color !== focused) {
      // With no custom colour the swatch shows the preset's own backdrop (read back from the viewer if it
      // told us, else a neutral grey), so the picker opens near what is on screen.
      const shown = s.background || (color.dataset.presetBg || '#808080');
      if (color.value !== shown) color.value = shown;
    }
    if (reset) reset.disabled = !s.background;
  }

  offs.push(store.subscribe((change) => { if (!destroyed && change && change.ui) refresh(); }));
  refresh();

  return {
    refresh,
    /** Tell the swatch what the preset's own backdrop colour is (wiring calls this after applying a scene). */
    setPresetBackground(hex) { if (color && typeof hex === 'string') { color.dataset.presetBg = hex; refresh(); } },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const off of offs) { try { off(); } catch { /* ignore */ } }
      offs.length = 0;
    },
  };
}
