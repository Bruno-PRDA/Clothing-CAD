// src/ui/toolbar.js — every control of #toolbar (SPEC 11.4 + the action table of 11.1.2).
// The toolbar NEVER calls another module's API: every button emits exactly one EVENT.UI_ACTION.
// The only store writes are #chk-selfcollision (sim:selfCollision) and #sel-size (ui:activeSize).

import { EVENT } from '../core/events.js';
import { listSamples } from '../samples/index.js';
import { byId } from './ids.js';

/** @typedef {import('../core/store.js').Store} Store */
/** @typedef {import('../core/events.js').EventBus} EventBus */

/** Buttons that emit a constant `{action}` payload. @type {ReadonlyArray<[string, string]>} */
export const TOOLBAR_ACTIONS = Object.freeze([
  ['btn-new', 'new'],
  ['btn-save', 'save'],
  ['btn-undo', 'undo'],
  ['btn-redo', 'redo'],
  ['btn-mirror', 'mirror'],
  ['btn-fit-2d', 'fit2d'],
  ['btn-arrange', 'arrange'],
  ['btn-drape', 'drape'],
  ['btn-play', 'play'],
  ['btn-pause', 'pause'],
  ['btn-reset', 'reset'],
  ['btn-frame-3d', 'frame3d'],
  ['btn-swap', 'swap'],
  ['btn-popout', 'popout'],
  ['btn-popin', 'popin'],
  ['btn-guide', 'guide'],
]);

/** Export buttons: id → export kind. @type {ReadonlyArray<[string, string]>} */
export const EXPORT_ACTIONS = Object.freeze([
  ['btn-export-svg', 'svg'],
  ['btn-export-print', 'print'],
  ['btn-export-csv', 'csv'],
  ['btn-export-json', 'json'],
  ['btn-export-obj', 'obj'],
  ['btn-export-dxf', 'dxf'],
]);

/**
 * @param {Store} store @param {EventBus} bus @param {Document|HTMLElement} [root=document]
 * @returns {object} {setTool, setRunning, setSimPhase, refresh, destroy}
 */
export function createToolbar(store, bus, root = document) {
  /** @type {Array<() => void>} */
  const offs = [];
  let destroyed = false;

  const app = byId(root, 'app');
  const el = /** @param {string} id */ (id) => byId(root, id);

  /**
   * @param {HTMLElement|null} target @param {string} type @param {(e:any) => void} fn
   */
  function on(target, type, fn) {
    if (!target) return;
    target.addEventListener(type, /** @type {EventListener} */ (fn));
    offs.push(() => target.removeEventListener(type, /** @type {EventListener} */ (fn)));
  }

  /** @param {object} payload */
  function emit(payload) { bus.emit(EVENT.UI_ACTION, payload); }

  /**
   * Rule 1 of 11.4: blur the button first so Space/Enter afterwards reach the shortcut layer.
   * @param {string} id @param {(e:MouseEvent) => object|null} make
   */
  function bindButton(id, make) {
    const b = el(id);
    on(b, 'click', (e) => {
      if (b && typeof (/** @type {any} */ (b).blur) === 'function') b.blur();
      const payload = make(e);
      if (payload) emit(payload);
    });
  }

  for (const [id, action] of TOOLBAR_ACTIONS) bindButton(id, () => ({ action }));

  const selPaper = /** @type {HTMLSelectElement|null} */ (el('sel-paper'));
  for (const [id, kind] of EXPORT_ACTIONS) {
    bindButton(id, () => (kind === 'print'
      ? { action: 'export', kind, paper: selPaper ? selPaper.value : 'A4' }
      : { action: 'export', kind }));
  }

  const selSample = /** @type {HTMLSelectElement|null} */ (el('sel-sample'));
  bindButton('btn-load-sample', () => ({ action: 'loadSample', name: selSample ? selSample.value : 'tshirt' }));

  // #btn-open only opens the hidden file input (11.1.2); the file itself becomes {action:'open', text, filename}.
  const inputFile = /** @type {HTMLInputElement|null} */ (el('input-file'));
  bindButton('btn-open', () => { if (inputFile) inputFile.click(); return null; });
  on(inputFile, 'change', () => {
    const f = inputFile && inputFile.files && inputFile.files[0];
    if (!f) return;
    const filename = f.name;
    Promise.resolve(f.text()).then((text) => { emit({ action: 'open', text, filename }); })
      .catch((err) => bus.emit(EVENT.UI_STATUS, { level: 'error', text: 'Could not read ' + filename + ': ' + err.message, source: 'ui/toolbar' }));
    inputFile.value = '';
  });

  // Import DXF: like Open, the button only opens a hidden picker; the file becomes {action:'importDxf', text, filename}.
  const inputDxf = /** @type {HTMLInputElement|null} */ (el('input-import-dxf'));
  bindButton('btn-import-dxf', () => { if (inputDxf) inputDxf.click(); return null; });
  on(inputDxf, 'change', () => {
    const f = inputDxf && inputDxf.files && inputDxf.files[0];
    if (!f) return;
    const filename = f.name;
    Promise.resolve(f.text()).then((text) => { emit({ action: 'importDxf', text, filename }); })
      .catch((err) => bus.emit(EVENT.UI_STATUS, { level: 'error', text: 'Could not read ' + filename + ': ' + err.message, source: 'ui/toolbar' }));
    inputDxf.value = '';
  });

  // Tool buttons (rule 6): the click only asks; the active state follows EVENT.TOOL_CHANGED.
  /** @type {HTMLElement[]} */
  const toolButtons = [];
  for (const id of ['tool-select', 'tool-draw', 'tool-edit', 'tool-split', 'tool-seam', 'tool-notch', 'tool-grainline', 'tool-measure']) {
    const b = el(id);
    if (b) toolButtons.push(b);
    bindButton(id, () => ({ action: 'tool', tool: b ? (b.dataset.tool || id.slice(5)) : id.slice(5) }));
  }

  /** @type {HTMLElement[]} */
  const layoutButtons = [];
  for (const id of ['btn-layout-split', 'btn-layout-2d', 'btn-layout-3d']) {
    const b = el(id);
    if (b) layoutButtons.push(b);
    bindButton(id, () => ({ action: 'layout', mode: b ? (b.dataset.layout || 'split') : 'split' }));
  }

  const chkSelf = /** @type {HTMLInputElement|null} */ (el('chk-selfcollision'));
  on(chkSelf, 'change', () => {
    const v = !!(chkSelf && chkSelf.checked);
    store.update((d) => { d.sim.selfCollision = v; }, 'sim:selfCollision');
  });

  const selSize = /** @type {HTMLSelectElement|null} */ (el('sel-size'));
  on(selSize, 'change', () => {
    const v = selSize ? selSize.value : '';
    if (!v) return;
    store.update((d) => { d.ui.activeSize = v; }, 'ui:activeSize');
  });

  // ------------------------------------------------------------------ state mirrors

  /** @param {string} name */
  function setTool(name) {
    for (const b of toolButtons) {
      const active = b.dataset.tool === name;
      b.setAttribute('aria-pressed', String(active));
      b.classList.toggle('active', active);
    }
    if (app) app.dataset.tool = name;
  }
  function getTool() { return app ? (app.dataset.tool || 'select') : 'select'; }

  const btnPlay = el('btn-play');
  const btnPause = el('btn-pause');
  /** @param {boolean} b */
  function setRunning(b) {
    if (btnPlay) /** @type {any} */ (btnPlay).hidden = !!b;
    if (btnPause) /** @type {any} */ (btnPause).hidden = !b;
  }
  /** @param {string} phase */
  function setSimPhase(phase) { setRunning(phase === 'sewing' || phase === 'draping'); }

  /** @param {{layout:string, swapped:boolean, popout?:boolean}} p */
  function setLayoutState(p) {
    for (const b of layoutButtons) b.setAttribute('aria-pressed', String(b.dataset.layout === p.layout));
    const swapBtn = el('btn-swap');
    if (swapBtn) swapBtn.setAttribute('aria-pressed', String(!!p.swapped));
    const popoutBtn = /** @type {HTMLButtonElement|null} */ (el('btn-popout'));
    if (popoutBtn) popoutBtn.disabled = !!p.popout;
  }

  /** Rebuild `#sel-size` from doc.sizes.rows, preserving the selected value. @param {any} doc */
  function syncSizes(doc) {
    if (!selSize) return;
    const rows = (doc && doc.sizes && doc.sizes.rows) || [];
    const names = rows.map((/** @type {any} */ r) => r.name);
    const current = Array.from(selSize.options).map((o) => o.value);
    if (current.length !== names.length || current.some((v, i) => v !== names[i])) {
      selSize.textContent = '';
      for (const n of names) {
        const o = selSize.ownerDocument.createElement('option');
        o.value = n; o.textContent = n;
        selSize.appendChild(o);
      }
    }
    const want = (doc && doc.ui && doc.ui.activeSize) || '';
    if (names.includes(want)) selSize.value = want;
    else if (names.length) selSize.value = names[0];
  }

  /** Re-sync the static `#sel-sample` options from listSamples() (rule 3). */
  function syncSamples() {
    if (!selSample) return;
    let list;
    try { list = listSamples(); } catch { return; }
    if (!Array.isArray(list) || list.length === 0) return;
    const current = Array.from(selSample.options).map((o) => o.value);
    if (current.length === list.length && current.every((v, i) => v === list[i].id)) return;
    const keep = selSample.value;
    selSample.textContent = '';
    for (const s of list) {
      const o = selSample.ownerDocument.createElement('option');
      o.value = s.id; o.textContent = s.name;
      selSample.appendChild(o);
    }
    if (list.some((s) => s.id === keep)) selSample.value = keep;
  }

  function refresh() {
    if (destroyed) return;
    const doc = store.get();
    syncSamples();
    syncSizes(doc);
    const undo = /** @type {HTMLButtonElement|null} */ (el('btn-undo'));
    const redo = /** @type {HTMLButtonElement|null} */ (el('btn-redo'));
    if (undo) undo.disabled = !store.canUndo();
    if (redo) redo.disabled = !store.canRedo();
    if (chkSelf) chkSelf.checked = !!(doc && doc.sim && doc.sim.selfCollision);
    if (doc && doc.ui) setLayoutState({ layout: doc.ui.layout, swapped: !!doc.ui.swapped });
    setTool((store.transient && store.transient.tool) || getTool());
  }

  offs.push(bus.on(EVENT.TOOL_CHANGED, (p) => setTool(p && p.tool)));
  offs.push(bus.on(EVENT.SIM_PHASE, (p) => setSimPhase(p && p.phase)));
  offs.push(bus.on(EVENT.SIM_BUILT, () => { const b = /** @type {HTMLButtonElement|null} */ (el('btn-play')); if (b) b.disabled = false; }));
  offs.push(bus.on(EVENT.UI_LAYOUT, (p) => setLayoutState(p || { layout: 'split', swapped: false })));
  offs.push(bus.on(EVENT.SIZE_ACTIVE, (p) => { if (selSize && p && p.size) selSize.value = p.size; }));
  offs.push(bus.on(EVENT.POPOUT_OPEN, () => { const b = /** @type {HTMLButtonElement|null} */ (el('btn-popout')); if (b) b.disabled = true; }));
  offs.push(bus.on(EVENT.POPOUT_CLOSE, () => { const b = /** @type {HTMLButtonElement|null} */ (el('btn-popout')); if (b) b.disabled = false; }));
  offs.push(store.subscribe(() => refresh()));

  refresh();

  /** Open the project file picker (Ctrl+O; the Open button does the same). */
  function openFile() { if (inputFile) inputFile.click(); }

  return {
    openFile,
    setTool,
    getTool,
    setRunning,
    setSimPhase,
    setLayoutState,
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const off of offs) { try { off(); } catch { /* ignore */ } }
      offs.length = 0;
    },
  };
}
