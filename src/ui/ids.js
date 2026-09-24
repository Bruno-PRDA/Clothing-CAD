// src/ui/ids.js — the stable element-id table of SPEC 11.1.1/11.1.2 plus the DOM lookup helpers every
// other file of src/ui/ uses. Data + tiny helpers only; no listeners, no store, no bus.
// Imports: src/body/index.js (PARAM_KEYS, SPEC 6.1) — the 24 body rows are static in index.html.

import { PARAM_KEYS } from '../body/index.js';

/**
 * Every STATIC id of SPEC 11.1.1: the 135 of 11.1.1, the fit banner's 4, the guide's 8, the scene control's 4 and
 * the recovery banner's 4.
 * The 48 generated body-parameter ids live in
 * `BODY_PARAM_IDS`; `ALL_IDS` is the concatenation and is what `checkIds()` verifies.
 * @type {ReadonlyArray<string>}
 */
export const REQUIRED_IDS = Object.freeze([
  'app', 'toolbar', 'tb-file', 'btn-new', 'btn-open', 'input-file', 'btn-save', 'sel-sample', 'btn-load-sample', 'tb-edit',
  'btn-undo', 'btn-redo', 'tb-tools', 'tool-select', 'tool-draw', 'tool-edit', 'tool-split', 'tool-seam', 'tool-notch',
  'tool-grainline', 'tool-measure', 'btn-mirror', 'btn-fit-2d', 'tb-sim', 'btn-arrange', 'btn-drape', 'btn-play', 'btn-pause',
  'btn-reset', 'chk-selfcollision', 'btn-frame-3d', 'tb-size', 'sel-size', 'tb-view', 'btn-layout-split', 'btn-layout-2d',
  'btn-layout-3d', 'btn-swap', 'btn-popout', 'tb-export', 'sel-paper', 'btn-export-svg', 'btn-export-print', 'btn-export-csv',
  'btn-export-json', 'btn-export-obj', 'main', 'pane-left', 'pane-2d', 'canvas-2d', 'resizer', 'pane-right', 'pane-3d',
  'view-3d', 'msg-3d-popout', 'btn-popin', 'dock', 'dock-tabs', 'tab-pieces', 'tab-body', 'tab-fabric', 'tab-sizes',
  'panel-pieces', 'list-pieces', 'btn-piece-duplicate', 'btn-piece-delete', 'piece-props', 'piece-fold', 'inp-piece-name',
  'num-piece-qty', 'num-piece-layer', 'num-piece-mesh', 'num-piece-allowance', 'sel-piece-fabric', 'chk-piece-simulate',
  'chk-piece-exporthidden', 'piece-placement', 'sel-placement-anchor', 'sel-placement-side', 'num-placement-dx',
  'num-placement-dy', 'range-placement-wrap', 'range-placement-wrap-val', 'chk-placement-flip', 'piece-grade',
  'sel-grade-width', 'sel-grade-length', 'sel-grade-anchorx', 'sel-grade-anchory', 'edge-props', 'edge-index',
  'inp-edge-label', 'edge-labels', 'num-edge-allowance', 'chk-edge-pinned', 'list-seams', 'seam-ease', 'btn-seam-flip',
  'btn-seam-delete', 'list-issues', 'panel-body', 'sel-body-preset', 'body-params', 'body-measured', 'body-closest-size',
  'btn-body-estimate', 'btn-body-fit-size', 'body-build-ms', 'panel-fabric', 'sel-fabric-piece', 'fabric-id', 'sel-fabric-preset', 'input-color',
  'sel-texture', 'input-color2', 'range-texture-scale', 'range-texture-scale-val', 'range-bend-scale', 'range-bend-scale-val',
  'range-stretch-scale', 'range-stretch-scale-val', 'fabric-physics', 'panel-sizes', 'table-sizes', 'btn-size-add',
  'btn-size-remove', 'sel-base-size', 'btn-size-from-body', 'list-size-issues', 'statusbar', 'status-tool', 'status-msg',
  'status-cursor', 'status-seam-ease', 'status-quality', 'status-sim',
  'fit-warning', 'fit-warning-text', 'btn-fit-use', 'btn-fit-dismiss',
  'tb-help', 'btn-guide', 'guide', 'guide-title', 'inp-guide-search', 'btn-guide-close', 'guide-toc', 'guide-body',
  'scene-controls', 'sel-scene', 'input-scene-bg', 'btn-scene-bg-reset',
  'recovery-banner', 'recovery-text', 'btn-recover-restore', 'btn-recover-discard',
]);

/** `body-<key>` + `body-<key>-num` for the 24 keys of SPEC 6.1 (static in index.html; the panel BINDS them). */
export const BODY_PARAM_IDS = Object.freeze(
  PARAM_KEYS.reduce((acc, k) => { acc.push('body-' + k, 'body-' + k + '-num'); return acc; }, /** @type {string[]} */ ([])),
);

/** Every id the UI binds: the static ids + the body-parameter ids. @type {ReadonlyArray<string>} */
export const ALL_IDS = Object.freeze(REQUIRED_IDS.concat(BODY_PARAM_IDS));

/**
 * Element lookup that works for a Document root and for an element subtree root.
 * @param {Document|HTMLElement|DocumentFragment} [root=document] @param {string} id
 * @returns {HTMLElement|null}
 */
export function byId(root, id) {
  const r = root || (typeof document !== 'undefined' ? document : null);
  if (!r) return null;
  if (typeof (/** @type {any} */ (r).getElementById) === 'function') {
    return /** @type {HTMLElement|null} */ (/** @type {any} */ (r).getElementById(id));
  }
  if (typeof (/** @type {any} */ (r).querySelector) === 'function') {
    if (/** @type {any} */ (r).id === id) return /** @type {HTMLElement} */ (r);
    return /** @type {HTMLElement|null} */ (/** @type {any} */ (r).querySelector('#' + cssEscape(id)));
  }
  return null;
}

/** @param {string} s @returns {string} */
function cssEscape(s) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
}

/**
 * Like `byId` but throws the Phase-0 skeleton bug error when the element is missing.
 * @param {Document|HTMLElement} root @param {string} id @returns {HTMLElement}
 */
export function requireEl(root, id) {
  const el = byId(root, id);
  if (!el) throw missingElement(id);
  return el;
}

/** @param {string} id @returns {Error & {code:string, id:string}} */
export function missingElement(id) {
  const err = /** @type {Error & {code:string, id:string}} */ (new Error('UI: missing element #' + id));
  err.code = 'UI_MISSING_ELEMENT';
  err.id = id;
  return err;
}

/**
 * Ids of `ALL_IDS` that do not resolve in `root`.
 * @param {Document|HTMLElement} [root=document] @returns {string[]}
 */
export function missingIds(root = document) {
  const out = [];
  for (const id of ALL_IDS) if (!byId(root, id)) out.push(id);
  return out;
}

/**
 * @param {Document|HTMLElement} [root=document]
 * @returns {{ok: boolean, total: number, missing: string[]}}
 */
export function checkIds(root = document) {
  const missing = missingIds(root);
  return { ok: missing.length === 0, total: ALL_IDS.length, missing };
}
