// src/ui/layout.js — split pane geometry, layout modes, pane swap and the pop-out placeholder (SPEC 11.3).
// Writes only doc.ui.{split,layout,swapped} (ui-only labels, never undoable); emits EVENT.UI_LAYOUT.

import { EVENT } from '../core/events.js';
import { clamp } from '../core/units.js';
import { byId, requireEl } from './ids.js';

/** @typedef {import('../core/store.js').Store} Store */
/** @typedef {import('../core/events.js').EventBus} EventBus */

export const SPLIT_MIN = 0.2;
export const SPLIT_MAX = 0.8;
/** @type {ReadonlyArray<'split'|'2d'|'3d'>} */
export const LAYOUT_MODES = Object.freeze(['split', '2d', '3d']);

/**
 * @param {Document|HTMLElement} root @param {string} name @param {number} fallback @returns {number}
 */
function cssPx(root, name, fallback) {
  try {
    const doc = /** @type {any} */ (root).documentElement ? /** @type {Document} */ (root) : (root.ownerDocument || document);
    const v = getComputedStyle(doc.documentElement).getPropertyValue(name);
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  } catch { return fallback; }
}

/**
 * @param {Store} store @param {EventBus} bus @param {Document|HTMLElement} [root=document]
 * @returns {object} LayoutController (SPEC 11.3)
 */
export function createLayout(store, bus, root = document) {
  const main = requireEl(root, 'main');
  const slotLeft = requireEl(root, 'pane-left');
  const slotRight = requireEl(root, 'pane-right');
  const pane2d = requireEl(root, 'pane-2d');
  const pane3d = requireEl(root, 'pane-3d');
  const resizer = requireEl(root, 'resizer');
  const app = byId(root, 'app');
  const msgPopout = byId(root, 'msg-3d-popout');

  const dockW = cssPx(root, '--dock-w', 300);
  const resizerW = cssPx(root, '--resizer-w', 6);

  let popout = false;
  let applied = { split: NaN, layout: '', swapped: null };
  /** @type {Array<() => void>} */
  const offs = [];
  let destroyed = false;

  // ---------------------------------------------------------------- applying

  /** @returns {{split:number, layout:'split'|'2d'|'3d', swapped:boolean}} */
  function uiOf() {
    const ui = (store.get() && store.get().ui) || {};
    const split = clamp(Number.isFinite(ui.split) ? ui.split : 0.5, SPLIT_MIN, SPLIT_MAX);
    const layout = LAYOUT_MODES.includes(ui.layout) ? ui.layout : 'split';
    return { split, layout, swapped: !!ui.swapped };
  }

  /** @param {'2d'|'3d'} pane @returns {'left'|'right'} */
  function slotOf(pane) {
    const swapped = applied.swapped === null ? uiOf().swapped : !!applied.swapped;
    if (pane === '3d') return swapped ? 'left' : 'right';
    return swapped ? 'right' : 'left';
  }

  /** Idempotent; emits EVENT.UI_LAYOUT at the end (SPEC 11.3 "Applying state"). */
  function apply() {
    if (destroyed) return;
    const { split, layout, swapped } = uiOf();

    // 1. split fraction
    main.style.setProperty('--split', String(split));
    resizer.setAttribute('aria-valuenow', String(Math.round(split * 100)));

    // 2. slots (DOM moves keep the WebGL / 2D contexts alive)
    const wantLeft = swapped ? pane3d : pane2d;
    const wantRight = swapped ? pane2d : pane3d;
    if (wantLeft.parentElement !== slotLeft) slotLeft.appendChild(wantLeft);
    if (wantRight.parentElement !== slotRight) slotRight.appendChild(wantRight);
    if (app) app.dataset.swapped = String(swapped);

    // 3. layout mode / solo
    applied = { split, layout, swapped };
    if (app) {
      app.dataset.layout = layout;
      app.dataset.popout = String(popout);
    }
    if (popout) {
      main.dataset.solo = slotOf('2d');
    } else if (layout === 'split') {
      delete main.dataset.solo;
    } else {
      main.dataset.solo = slotOf(layout === '2d' ? '2d' : '3d');
    }
    if (msgPopout) msgPopout.hidden = !popout;

    // 5. announce
    bus.emit(EVENT.UI_LAYOUT, { layout, swapped, split, popout });
  }

  // ---------------------------------------------------------------- commands

  /** @param {number} f */
  function setSplit(f) {
    const v = Math.round(clamp(Number(f), SPLIT_MIN, SPLIT_MAX) * 1000) / 1000;
    store.update((d) => { d.ui.split = v; }, 'ui:split');
    apply();
  }
  function getSplit() { return uiOf().split; }

  /** @param {'split'|'2d'|'3d'} mode */
  function setLayout(mode) {
    if (!LAYOUT_MODES.includes(/** @type {any} */ (mode))) {
      const err = /** @type {Error & {code:string}} */ (new Error('UI: unknown layout ' + mode));
      err.code = 'UI_BAD_LAYOUT';
      throw err;
    }
    store.update((d) => { d.ui.layout = mode; }, 'ui:layout');
    apply();
  }
  function getLayout() { return uiOf().layout; }

  function swap() {
    store.update((d) => { d.ui.swapped = !d.ui.swapped; }, 'ui:swap');
    apply();
  }
  function isSwapped() { return uiOf().swapped; }

  /** @param {boolean} on */
  function setPopout(on) { popout = !!on; apply(); }
  function isPopout() { return popout; }

  function getState() {
    const { split, layout, swapped } = uiOf();
    return {
      split, layout, swapped, popout,
      leftWidth: slotLeft.getBoundingClientRect().width,
      rightWidth: slotRight.getBoundingClientRect().width,
    };
  }

  // ---------------------------------------------------------------- resizer drag

  let dragging = false;
  let dragFraction = 0.5;
  /** @type {DOMRect|null} */
  let mainRect = null;
  let avail = 1;
  const body = (root.ownerDocument || (/** @type {Document} */ (root))).body || document.body;

  /** @param {number} clientX @returns {number} */
  function fractionAt(clientX) {
    if (!mainRect || avail <= 0) return dragFraction;
    return clamp((clientX - mainRect.left - resizerW / 2) / avail, SPLIT_MIN, SPLIT_MAX);
  }

  /** @param {PointerEvent} e */
  function onPointerDown(e) {
    if (e.button !== 0) return;
    mainRect = main.getBoundingClientRect();
    avail = mainRect.width - dockW - resizerW;
    dragging = true;
    dragFraction = uiOf().split;
    try { resizer.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    resizer.classList.add('dragging');
    if (body) body.classList.add('resizing');
    e.preventDefault();
  }

  /** @param {PointerEvent} e */
  function onPointerMove(e) {
    if (!dragging) return;
    dragFraction = fractionAt(e.clientX);
    main.style.setProperty('--split', String(dragFraction));
    resizer.setAttribute('aria-valuenow', String(Math.round(dragFraction * 100)));
  }

  /** @param {PointerEvent} e */
  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    try { resizer.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    resizer.classList.remove('dragging');
    if (body) body.classList.remove('resizing');
    setSplit(dragFraction);
  }

  function onDblClick() { setSplit(0.5); }

  /** @param {KeyboardEvent} e */
  function onKeyDown(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setSplit(uiOf().split + (e.key === 'ArrowLeft' ? -0.02 : 0.02));
  }

  resizer.addEventListener('pointerdown', /** @type {EventListener} */ (onPointerDown));
  resizer.addEventListener('pointermove', /** @type {EventListener} */ (onPointerMove));
  resizer.addEventListener('pointerup', /** @type {EventListener} */ (onPointerUp));
  resizer.addEventListener('pointercancel', /** @type {EventListener} */ (onPointerUp));
  resizer.addEventListener('dblclick', onDblClick);
  resizer.addEventListener('keydown', /** @type {EventListener} */ (onKeyDown));
  offs.push(() => {
    resizer.removeEventListener('pointerdown', /** @type {EventListener} */ (onPointerDown));
    resizer.removeEventListener('pointermove', /** @type {EventListener} */ (onPointerMove));
    resizer.removeEventListener('pointerup', /** @type {EventListener} */ (onPointerUp));
    resizer.removeEventListener('pointercancel', /** @type {EventListener} */ (onPointerUp));
    resizer.removeEventListener('dblclick', onDblClick);
    resizer.removeEventListener('keydown', /** @type {EventListener} */ (onKeyDown));
  });

  // ---------------------------------------------------------------- store subscription

  offs.push(store.subscribe((change) => {
    if (destroyed || !change || !change.ui) return;
    const next = uiOf();
    if (next.split !== applied.split || next.layout !== applied.layout || next.swapped !== applied.swapped) apply();
  }));

  apply();

  return {
    setSplit, getSplit, setLayout, getLayout, swap, isSwapped, slotOf, setPopout, isPopout, getState, apply,
    // aliases used by the app facade (createUi)
    set: setLayout,
    get: getLayout,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const off of offs) { try { off(); } catch { /* ignore */ } }
      offs.length = 0;
    },
  };
}
