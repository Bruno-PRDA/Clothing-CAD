// src/ui/shortcuts.js — one keydown listener on window (SPEC 11.7). Every match emits EVENT.UI_ACTION and
// preventDefault()s; wiring dispatches. Tab is NEVER handled (browser focus navigation and automation must work).

import { EVENT } from '../core/events.js';

/** @typedef {import('../core/events.js').EventBus} EventBus */

/**
 * The binding table of SPEC 11.7. `key` is compared case-insensitively against `e.key` (or `e.code` when
 * `code` is set); `ctrl` means `ctrlKey || metaKey`; a binding matches only with EXACTLY its modifier set.
 * `payload` is the full `ui:action` payload (a function for the arrow keys, which depend on Shift).
 * `shiftAny` marks the bindings that accept either Shift state (the arrows: Shift means x10).
 * @type {ReadonlyArray<{key:string, code?:string, ctrl:boolean, shift:boolean, shiftAny?:boolean, action:string, payload:object|((e:KeyboardEvent)=>object)}>}
 */
export const SHORTCUTS = Object.freeze([
  { key: 'v', ctrl: false, shift: false, action: 'tool', payload: { action: 'tool', tool: 'select' } },
  { key: 'p', ctrl: false, shift: false, action: 'tool', payload: { action: 'tool', tool: 'draw' } },
  { key: 'e', ctrl: false, shift: false, action: 'tool', payload: { action: 'tool', tool: 'edit' } },
  { key: 'x', ctrl: false, shift: false, action: 'tool', payload: { action: 'tool', tool: 'split' } },
  { key: 's', ctrl: false, shift: false, action: 'tool', payload: { action: 'tool', tool: 'seam' } },
  { key: 'n', ctrl: false, shift: false, action: 'tool', payload: { action: 'tool', tool: 'notch' } },
  { key: 'g', ctrl: false, shift: false, action: 'tool', payload: { action: 'tool', tool: 'grainline' } },
  { key: 'm', ctrl: false, shift: false, action: 'tool', payload: { action: 'tool', tool: 'measure' } },
  { key: 'm', ctrl: false, shift: true, action: 'mirror', payload: { action: 'mirror' } },
  { key: ' ', code: 'Space', ctrl: false, shift: false, action: 'togglePlay', payload: { action: 'togglePlay' } },
  { key: 'r', ctrl: false, shift: false, action: 'reset', payload: { action: 'reset' } },
  { key: 'd', ctrl: false, shift: false, action: 'drape', payload: { action: 'drape' } },
  { key: 'f', ctrl: false, shift: false, action: 'fit2d', payload: { action: 'fit2d' } },
  { key: 'f', ctrl: false, shift: true, action: 'frame3d', payload: { action: 'frame3d' } },
  { key: 'z', ctrl: true, shift: false, action: 'undo', payload: { action: 'undo' } },
  { key: 'z', ctrl: true, shift: true, action: 'redo', payload: { action: 'redo' } },
  { key: 'y', ctrl: true, shift: false, action: 'redo', payload: { action: 'redo' } },
  { key: 's', ctrl: true, shift: false, action: 'save', payload: { action: 'save' } },
  { key: 'o', ctrl: true, shift: false, action: 'open', payload: { action: 'open' } },
  { key: 'delete', ctrl: false, shift: false, action: 'delete', payload: { action: 'delete' } },
  { key: 'backspace', ctrl: false, shift: false, action: 'delete', payload: { action: 'delete' } },
  { key: 'escape', ctrl: false, shift: false, action: 'cancel', payload: { action: 'cancel' } },
  { key: 'enter', ctrl: false, shift: false, action: 'confirm', payload: { action: 'confirm' } },
  { key: 'arrowleft', ctrl: false, shift: false, shiftAny: true, action: 'nudge', payload: (e) => ({ action: 'nudge', dx: e.shiftKey ? -10 : -1, dy: 0 }) },
  { key: 'arrowright', ctrl: false, shift: false, shiftAny: true, action: 'nudge', payload: (e) => ({ action: 'nudge', dx: e.shiftKey ? 10 : 1, dy: 0 }) },
  { key: 'arrowup', ctrl: false, shift: false, shiftAny: true, action: 'nudge', payload: (e) => ({ action: 'nudge', dx: 0, dy: e.shiftKey ? 10 : 1 }) },
  { key: 'arrowdown', ctrl: false, shift: false, shiftAny: true, action: 'nudge', payload: (e) => ({ action: 'nudge', dx: 0, dy: e.shiftKey ? -10 : -1 }) },
  { key: '1', ctrl: false, shift: false, action: 'layout', payload: { action: 'layout', mode: '2d' } },
  { key: '2', ctrl: false, shift: false, action: 'layout', payload: { action: 'layout', mode: '3d' } },
  { key: '3', ctrl: false, shift: false, action: 'layout', payload: { action: 'layout', mode: 'split' } },
  { key: '+', ctrl: false, shift: false, action: 'zoom', payload: { action: 'zoom', factor: 1.25 } },
  { key: '+', ctrl: false, shift: true, action: 'zoom', payload: { action: 'zoom', factor: 1.25 } },
  { key: '=', ctrl: false, shift: false, action: 'zoom', payload: { action: 'zoom', factor: 1.25 } },
  { key: '-', ctrl: false, shift: false, action: 'zoom', payload: { action: 'zoom', factor: 0.8 } },
  { key: '0', ctrl: false, shift: false, action: 'zoom', payload: { action: 'zoom', factor: 'fit' } },
  { key: 'f1', ctrl: false, shift: false, action: 'dockTab', payload: { action: 'dockTab', tab: 'pieces' } },
  { key: 'f2', ctrl: false, shift: false, action: 'dockTab', payload: { action: 'dockTab', tab: 'body' } },
  { key: 'f3', ctrl: false, shift: false, action: 'dockTab', payload: { action: 'dockTab', tab: 'fabric' } },
  { key: 'f4', ctrl: false, shift: false, action: 'dockTab', payload: { action: 'dockTab', tab: 'sizes' } },
  // `?` is Shift+/ on a US keyboard and Shift+, on a French one; matching the produced character with any
  // Shift state finds it on both.
  { key: '?', ctrl: false, shift: false, shiftAny: true, action: 'guide', payload: { action: 'guide' } },
]);

const ARROWS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown']);
const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * @param {EventBus} bus @param {Window|HTMLElement} [root=window]
 * @returns {{enable():void, disable():void, isEnabled():boolean, destroy():void}}
 */
export function createShortcuts(bus, root = (typeof window !== 'undefined' ? window : /** @type {any} */ (null))) {
  let enabled = true;
  let destroyed = false;
  const target = root || (typeof window !== 'undefined' ? window : null);

  /** @param {KeyboardEvent} e */
  function onKeyDown(e) {
    if (!enabled || destroyed) return;
    // Guard 1: Tab is never handled — no binding, no preventDefault, no stopPropagation.
    if (e.key === 'Tab') return;
    // Guard 2
    if (e.isComposing || e.keyCode === 229) return;
    const key = String(e.key || '').toLowerCase();
    if (e.repeat && !ARROWS.has(key)) return;
    // Guard 5 (early): Alt is never part of a binding.
    if (e.altKey) return;

    const el = /** @type {HTMLElement|null} */ (e.target);
    const tag = el && el.tagName ? el.tagName.toUpperCase() : '';
    const inField = !!el && (FIELD_TAGS.has(tag) || el.isContentEditable === true);

    // Guard 3: inside a form field only Escape is handled.
    if (inField) {
      if (key !== 'escape') return;
      if (typeof el.blur === 'function') el.blur();
      e.preventDefault();
      bus.emit(EVENT.UI_ACTION, { action: 'cancel' });
      return;
    }

    // Guard 4: on a button, Space/Enter belong to the browser.
    if (tag === 'BUTTON' && (e.code === 'Space' || key === ' ' || key === 'enter')) return;

    const ctrl = e.ctrlKey || e.metaKey;
    for (const b of SHORTCUTS) {
      const hit = b.code ? (e.code === b.code) : (key === b.key);
      if (!hit) continue;
      if (b.ctrl !== ctrl) continue;
      if (!b.shiftAny && b.shift !== e.shiftKey) continue;
      const payload = typeof b.payload === 'function' ? b.payload(e) : { ...b.payload };
      e.preventDefault();
      bus.emit(EVENT.UI_ACTION, payload);
      return;
    }
  }

  if (target && typeof target.addEventListener === 'function') {
    target.addEventListener('keydown', /** @type {EventListener} */ (onKeyDown));
  }

  return {
    enable() { enabled = true; },
    disable() { enabled = false; },
    isEnabled() { return enabled && !destroyed; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      enabled = false;
      if (target && typeof target.removeEventListener === 'function') {
        target.removeEventListener('keydown', /** @type {EventListener} */ (onKeyDown));
      }
    },
  };
}
