// src/ui/selftest.js — SPEC 11.8.5. Runs IN THE LIVE PAGE (it needs index.html): it snapshots the document with
// serializeDoc and restores it with store.replace(parseDoc(snapshot), 'selftest restore') at the end.
// It reuses the UI instance the app already created (window.__app.ctx.ui) when there is one, so it never
// double-binds the DOM; otherwise it creates its own and destroys it again.

import { EVENT, bus as globalBus } from '../core/events.js';
import { createStore } from '../core/store.js';
import { normalizeDoc, serializeDoc, parseDoc, SCENE_PRESETS } from '../core/schema.js';
import { createUi } from './index.js';
import { ALL_IDS, byId } from './ids.js';
import { GUIDE_SECTIONS } from './guideContent.js';
import { sanitizeGuideHtml, shortcutRows } from './guide.js';
import { SHORTCUTS } from './shortcuts.js';
import { SIZE_NAMES } from './panels/sizes.js';

/** @typedef {import('../core/types.js').SelfTestResult} SelfTestResult */

/** @param {number} [n=2] */
function nextFrame(n = 2) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(undefined); } };
    // A hidden tab never fires requestAnimationFrame, so always race a timer.
    setTimeout(finish, 60 * n);
    if (typeof requestAnimationFrame !== 'function') return;
    let left = n;
    const tick = () => { left -= 1; if (left <= 0) finish(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}

/** @returns {{store:any, bus:any, ui:any, owned:boolean}} */
function resolveContext() {
  const app = (typeof window !== 'undefined') ? /** @type {any} */ (window).__app : null;
  const ctx = (app && app.ctx) || null;
  const bus = (app && app.bus) || (ctx && ctx.bus) || globalBus;
  let store = (app && app.store) || (ctx && ctx.store) || null;
  if (!store) store = createStore(normalizeDoc({}), bus);
  // The app (src/app/main.js, stage 'ui') keeps its instance in ctx.mods.ui — reuse it, never double-bind.
  let ui = (ctx && ctx.mods && ctx.mods.ui) || (ctx && ctx.ui) || null;
  let owned = false;
  if (!ui || !ui.layout || typeof ui.layout.setSplit !== 'function') {
    ui = createUi({ store, bus, root: document });
    owned = true;
  }
  return { store, bus, ui, owned };
}

/**
 * Collect every `ui:action` payload emitted while `fn` runs (synchronously).
 * @param {any} bus @param {() => void} fn @returns {any[]}
 */
function captureActions(bus, fn) {
  /** @type {any[]} */
  const seen = [];
  const off = bus.on(EVENT.UI_ACTION, (/** @type {any} */ p) => seen.push(p));
  try { fn(); } finally { off(); }
  return seen;
}

/**
 * The UI self-test (SPEC 11.8.5). 16 named cases, plus the guide.
 * @returns {Promise<SelfTestResult[]>}
 */
export async function runSelfTest() {
  /** @type {SelfTestResult[]} */
  const results = [];
  /** @param {string} name @param {boolean} pass @param {string} details */
  const add = (name, pass, details) => { results.push({ name, pass: !!pass, details: String(details) }); };

  if (typeof document === 'undefined' || !document.getElementById('app')) {
    add('dom-required', false, 'src/ui/selftest.js must run in the live page (index.html); no #app found');
    return results;
  }

  const { store, bus, ui, owned } = resolveContext();
  const snapshot = serializeDoc(store.get());

  /**
   * @param {string} name @param {() => any} fn
   */
  async function run(name, fn) {
    try {
      const detail = await fn();
      add(name, true, typeof detail === 'string' ? detail : 'ok');
    } catch (err) {
      add(name, false, (err && err.message) ? err.message : String(err));
    }
  }
  /** @param {boolean} cond @param {string} msg */
  function assert(cond, msg) { if (!cond) throw new Error(msg); }

  // 1 ------------------------------------------------------------------ every id resolves
  await run('ids-present', () => {
    const missing = ALL_IDS.filter((id) => !byId(document, id));
    assert(missing.length === 0, 'missing ids: ' + missing.join(', '));
    return ALL_IDS.length + ' ids resolve';
  });

  // 2 ------------------------------------------------------------------ split
  await run('split', () => {
    ui.layout.setSplit(0.3);
    assert(store.get().ui.split === 0.3, 'doc.ui.split is ' + store.get().ui.split);
    const main = byId(document, 'main');
    const left = byId(document, 'pane-left');
    const mw = main.getBoundingClientRect().width;
    if (mw > 0) {
      const expected = 0.3 * (mw - 306);
      const got = left.getBoundingClientRect().width;
      assert(Math.abs(got - expected) <= 2.5, 'pane-left ' + got.toFixed(1) + ' px, expected ' + expected.toFixed(1));
    }
    ui.layout.setSplit(0.05);
    assert(store.get().ui.split === 0.2, 'clamp to 0.2 failed: ' + store.get().ui.split);
    ui.layout.setSplit(0.5);
    return 'split applied and clamped';
  });

  // 3 ------------------------------------------------------------------ swap
  await run('swap', () => {
    const app = byId(document, 'app');
    const left = byId(document, 'pane-left');
    const before = !!store.get().ui.swapped;
    ui.layout.swap();
    assert(left.firstElementChild && left.firstElementChild.id === (before ? 'pane-2d' : 'pane-3d'),
      'pane-left holds ' + (left.firstElementChild && left.firstElementChild.id));
    assert(app.dataset.swapped === String(!before), 'data-swapped is ' + app.dataset.swapped);
    ui.layout.swap();
    assert(left.firstElementChild && left.firstElementChild.id === (before ? 'pane-3d' : 'pane-2d'), 'swap back failed');
    return 'panes swap and restore';
  });

  // 4 ------------------------------------------------------------------ layout modes
  await run('layout-modes', () => {
    const main = byId(document, 'main');
    ui.layout.setLayout('2d');
    assert(main.dataset.solo === ui.layout.slotOf('2d'), 'data-solo is ' + main.dataset.solo);
    const hiddenSlot = byId(document, ui.layout.slotOf('3d') === 'left' ? 'pane-left' : 'pane-right');
    assert(getComputedStyle(hiddenSlot).display === 'none', '3D slot is still displayed');
    ui.layout.setLayout('split');
    assert(main.dataset.solo === undefined || main.dataset.solo === '', 'data-solo not cleared');
    // Measure, don't just read flags: hiding a pane with display:none once slid the later grid items a column
    // left, so the 3D-only layout showed a 0 px 3D pane and both solo layouts a 1 px dock — with every flag
    // above correct. (Skipped when the page has no layout box, e.g. a hidden pane that never laid out.)
    const mainW = main.getBoundingClientRect().width;
    if (mainW > 400) {
      const w = (/** @type {string} */ id) => byId(document, id).getBoundingClientRect().width;
      const dockW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-w')) || 300;
      const bad = [];
      for (const swapped of [false, true]) {
        if (ui.layout.isSwapped() !== swapped) ui.layout.swap();
        for (const mode of ['split', '2d', '3d']) {
          ui.layout.setLayout(/** @type {any} */ (mode));
          const d = w('dock');
          if (Math.abs(d - dockW) > 2) bad.push(mode + (swapped ? '/swapped' : '') + ': dock ' + d.toFixed(0) + ' px');
          for (const pane of ['2d', '3d']) {
            const shown = mode === 'split' || mode === pane;
            const pw = w(ui.layout.slotOf(pane) === 'left' ? 'pane-left' : 'pane-right');
            if (shown && pw < 100) bad.push(mode + (swapped ? '/swapped' : '') + ': ' + pane + ' pane ' + pw.toFixed(0) + ' px');
          }
        }
      }
      if (ui.layout.isSwapped()) ui.layout.swap();
      ui.layout.setLayout('split');
      assert(bad.length === 0, 'layout geometry: ' + bad.join('; '));
      return '2d solos the 2D pane; split clears data-solo; every mode and swap measured';
    }
    return '2d solos the 2D pane; split clears data-solo (geometry not measured: no layout box)';
  });

  // 5 ------------------------------------------------------------------ dock
  await run('dock', () => {
    ui.dock.setTab('body');
    const panels = ['pieces', 'body', 'fabric', 'sizes'];
    for (const p of panels) {
      const el = byId(document, 'panel-' + p);
      assert(el.hidden === (p !== 'body'), 'panel-' + p + '.hidden is ' + el.hidden);
    }
    assert(byId(document, 'tab-body').getAttribute('aria-selected') === 'true', 'tab-body not selected');
    assert(store.get().ui.dockTab === 'body', 'doc.ui.dockTab is ' + store.get().ui.dockTab);
    ui.dock.setTab('pieces');
    return 'tabs switch panels and write doc.ui.dockTab';
  });

  // 6 ------------------------------------------------------------------ statusbar
  await run('statusbar', () => {
    ui.statusbar.setMessage('hello', 'warn');
    const el = byId(document, 'status-msg');
    assert(el.textContent === 'hello', 'status-msg is ' + JSON.stringify(el.textContent));
    assert(el.dataset.level === 'warn', 'data-level is ' + el.dataset.level);
    const log = ui.statusbar.getLog();
    assert(log.length > 0 && log[log.length - 1].text === 'hello', 'log tail is not the message');
    return 'message, level and ring buffer';
  });

  // 7 ------------------------------------------------------------------ shortcut emits the tool action
  await run('shortcut-tool', () => {
    const seen = captureActions(bus, () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }));
    });
    assert(seen.length === 1, 'expected 1 ui:action, got ' + seen.length);
    assert(seen[0].action === 'tool' && seen[0].tool === 'seam', 'payload is ' + JSON.stringify(seen[0]));
    return "'s' → {action:'tool', tool:'seam'}";
  });

  // 8 ------------------------------------------------------------------ Tab is never handled
  await run('shortcut-tab-untouched', () => {
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    const seen = captureActions(bus, () => { window.dispatchEvent(ev); });
    assert(ev.defaultPrevented === false, 'Tab was preventDefault()ed');
    assert(seen.length === 0, 'Tab emitted ' + seen.length + ' ui:action(s)');
    return 'Tab passes through untouched';
  });

  // 9 ------------------------------------------------------------------ keys inside a field are left alone
  await run('shortcut-in-input', () => {
    const input = /** @type {HTMLInputElement} */ (byId(document, 'inp-piece-name'));
    const seen = captureActions(bus, () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true, cancelable: true }));
    });
    assert(seen.length === 0, "'v' in a text field emitted " + seen.length + ' ui:action(s)');
    return 'form fields keep their keys';
  });

  // 10 ----------------------------------------------------------------- body slider: drag then commit
  await run('body-drag', async () => {
    const range = /** @type {HTMLInputElement} */ (byId(document, 'body-chest_cm'));
    const before = store.get().body.params.chest_cm;
    /** @type {any[]} */
    const drags = [];
    const off = bus.on(EVENT.BODY_PARAMS_DRAG, (/** @type {any} */ p) => drags.push(p));
    /** @type {any[]} */
    const commits = [];
    const off2 = bus.on(EVENT.BODY_PARAMS_COMMIT, (/** @type {any} */ p) => commits.push(p));
    try {
      range.value = '90';
      range.dispatchEvent(new Event('input', { bubbles: true }));
      await nextFrame(2);
      assert(drags.length === 1, 'expected 1 body:params:drag, got ' + drags.length);
      assert(drags[0].params.chest_cm === 90, 'drag params.chest_cm is ' + drags[0].params.chest_cm);
      assert(store.get().body.params.chest_cm === before, 'the store was written during the drag');
      range.dispatchEvent(new Event('change', { bubbles: true }));
      assert(store.get().body.params.chest_cm === 90, 'commit wrote ' + store.get().body.params.chest_cm);
      assert(store.get().body.preset === 'custom', 'preset is ' + store.get().body.preset);
      assert(store.canUndo() === true, 'the commit created no undo entry');
      assert(commits.length === 1, 'expected 1 body:params:commit, got ' + commits.length);
      const num = /** @type {HTMLInputElement} */ (byId(document, 'body-chest_cm-num'));
      assert(num.value === '90', 'twin number input shows ' + num.value);
    } finally { off(); off2(); }
    return 'drag emits without writing; change writes once';
  });

  // 11 ----------------------------------------------------------------- sizes: add a row
  await run('sizes-add', () => {
    const before = store.get().sizes.rows.map((/** @type {any} */ r) => r.name);
    const lastChest = store.get().sizes.rows[before.length - 1].chest_cm;
    /** @type {HTMLButtonElement} */ (byId(document, 'btn-size-add')).click();
    const rows = store.get().sizes.rows;
    assert(rows.length === before.length + 1, 'rows.length is ' + rows.length);
    const expected = SIZE_NAMES.find((n) => !before.includes(n)) || ('size' + (before.length + 1));
    const created = rows[rows.length - 1];
    assert(created.name === expected, 'new row is ' + created.name + ', expected ' + expected);
    assert(created.chest_cm === lastChest + 4, 'chest_cm is ' + created.chest_cm + ', expected ' + (lastChest + 4));
    return 'appended ' + created.name;
  });

  // 12 ----------------------------------------------------------------- the sizes table markup
  await run('sizes-table', () => {
    ui.dock.setTab('sizes');
    ui.panels.sizes.refresh();
    const table = byId(document, 'table-sizes');
    const trs = table.querySelectorAll('tbody tr[data-size]');
    const rows = store.get().sizes.rows;
    assert(trs.length === rows.length, 'table has ' + trs.length + ' rows, doc has ' + rows.length);
    const cells = table.querySelectorAll('tbody input[data-size][data-key][data-testid="size-cell"]');
    const keys = store.get().sizes.measurements.length;
    assert(cells.length === rows.length * keys, 'expected ' + rows.length * keys + ' cells, got ' + cells.length);
    const base = table.querySelector('tr[data-base="true"]');
    assert(!!base, 'no base row is marked');
    ui.dock.setTab('pieces');
    return trs.length + ' rows × ' + keys + ' measurement columns';
  });

  // 13 ----------------------------------------------------------------- #sel-size mirrors the chart
  await run('sel-size', () => {
    ui.toolbar.refresh();
    const sel = /** @type {HTMLSelectElement} */ (byId(document, 'sel-size'));
    const names = store.get().sizes.rows.map((/** @type {any} */ r) => r.name);
    const options = Array.from(sel.options).map((o) => o.value);
    assert(options.length === names.length && options.every((v, i) => v === names[i]),
      'options ' + options.join(',') + ' vs rows ' + names.join(','));
    const want = names[names.length - 1];
    sel.value = want;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    assert(store.get().ui.activeSize === want, 'doc.ui.activeSize is ' + store.get().ui.activeSize);
    return 'options track doc.sizes.rows; change writes ui.activeSize';
  });

  // 14 ----------------------------------------------------------------- the two toolbar clicks of SPEC 11.8.5
  await run('toolbar-action', () => {
    let seen = captureActions(bus, () => /** @type {HTMLButtonElement} */ (byId(document, 'btn-drape')).click());
    assert(seen.length === 1 && seen[0].action === 'drape', 'btn-drape emitted ' + JSON.stringify(seen));
    seen = captureActions(bus, () => /** @type {HTMLButtonElement} */ (byId(document, 'btn-export-print')).click());
    assert(seen.length === 1 && seen[0].action === 'export' && seen[0].kind === 'print', 'btn-export-print emitted ' + JSON.stringify(seen));
    assert(seen[0].paper === /** @type {HTMLSelectElement} */ (byId(document, 'sel-paper')).value, 'paper is ' + seen[0].paper);
    return 'drape and export/print carry the documented payload';
  });

  // 15 ----------------------------------------------------------------- every non-destructive toolbar button
  await run('toolbar-actions-all', () => {
    /** @type {Array<[string, object]>} */
    const cases = [
      ['tool-select', { action: 'tool', tool: 'select' }],
      ['tool-draw', { action: 'tool', tool: 'draw' }],
      ['tool-edit', { action: 'tool', tool: 'edit' }],
      ['tool-split', { action: 'tool', tool: 'split' }],
      ['tool-seam', { action: 'tool', tool: 'seam' }],
      ['tool-notch', { action: 'tool', tool: 'notch' }],
      ['tool-grainline', { action: 'tool', tool: 'grainline' }],
      ['tool-measure', { action: 'tool', tool: 'measure' }],
      ['btn-mirror', { action: 'mirror' }],
      ['btn-fit-2d', { action: 'fit2d' }],
      ['btn-frame-3d', { action: 'frame3d' }],
      ['btn-layout-split', { action: 'layout', mode: 'split' }],
      ['btn-layout-2d', { action: 'layout', mode: '2d' }],
      ['btn-layout-3d', { action: 'layout', mode: '3d' }],
      ['btn-popin', { action: 'popin' }],
    ];
    /** @type {string[]} */
    const bad = [];
    for (const [id, want] of cases) {
      const btn = /** @type {HTMLButtonElement} */ (byId(document, id));
      const wasDisabled = btn.disabled;
      btn.disabled = false;
      const seen = captureActions(bus, () => btn.click());
      btn.disabled = wasDisabled;
      if (seen.length !== 1) { bad.push(id + ' emitted ' + seen.length); continue; }
      for (const k of Object.keys(want)) {
        if (seen[0][k] !== /** @type {any} */ (want)[k]) bad.push(id + '.' + k + '=' + seen[0][k]);
      }
    }
    assert(bad.length === 0, bad.join('; '));
    // Every tool button must be reachable by its shortcut too.
    const shortcutSeen = captureActions(bus, () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true, cancelable: true }));
    });
    assert(shortcutSeen.length === 1 && shortcutSeen[0].tool === 'select', 'V did not emit the select tool');
    return cases.length + ' buttons emit exactly one documented ui:action';
  });

  // 16 ----------------------------------------------------------------- the rest of the 11.7 table
  await run('shortcut-table', () => {
    /** @param {string} key @param {object} [init] */
    const press = (key, init) => captureActions(bus, () => {
      window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, init || {})));
    });
    /** @type {string[]} */
    const bad = [];
    /** @param {string} label @param {any[]} seen @param {object} want */
    const want = (label, seen, expected) => {
      if (seen.length !== 1) { bad.push(label + ' emitted ' + seen.length); return; }
      for (const k of Object.keys(expected)) {
        if (seen[0][k] !== /** @type {any} */ (expected)[k]) bad.push(label + '.' + k + '=' + JSON.stringify(seen[0][k]));
      }
    };
    want('Space', captureActions(bus, () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
    }), { action: 'togglePlay' });
    want('D', press('d'), { action: 'drape' });
    want('R', press('r'), { action: 'reset' });
    want('Ctrl+Z', press('z', { ctrlKey: true }), { action: 'undo' });
    want('Ctrl+Y', press('y', { ctrlKey: true }), { action: 'redo' });
    want('Ctrl+Shift+Z', press('z', { ctrlKey: true, shiftKey: true }), { action: 'redo' });
    want('Delete', press('Delete'), { action: 'delete' });
    want('Escape', press('Escape'), { action: 'cancel' });
    want('Shift+M', press('M', { shiftKey: true }), { action: 'mirror' });
    want('ArrowUp', press('ArrowUp'), { action: 'nudge', dx: 0, dy: 1 });
    want('Shift+ArrowUp', press('ArrowUp', { shiftKey: true }), { action: 'nudge', dx: 0, dy: 10 });
    want('F2', press('F2'), { action: 'dockTab', tab: 'body' });
    // Alt and a wrong modifier set never match.
    if (press('v', { altKey: true }).length !== 0) bad.push('Alt+V emitted');
    if (press('v', { ctrlKey: true }).length !== 0) bad.push('Ctrl+V emitted');
    assert(bad.length === 0, bad.join('; '));
    return '13 bindings plus the two modifier guards';
  });

  // 18 ----------------------------------------------------------------- the fit banner
  await run('fit-banner', () => {
    // Needs a garment with torso panels; the app's own document has one unless a test replaced it.
    const d0 = store.get();
    const hasTorso = d0.pieces.some((/** @type {any} */ p) => p.simulate !== false && p.placement && p.placement.anchor === 'torso');
    if (!hasTorso) return 'skipped: the document has no torso panels';
    const fw = ui.fitWarning;
    // A dismissal lives as long as the page; a previous run of this test (or the user) may have left one.
    fw.clearDismissed();
    const el = byId(document, 'fit-warning');
    const btnUse = /** @type {HTMLButtonElement} */ (byId(document, 'btn-fit-use'));
    const smallest = d0.sizes.rows[0].name;
    // a body 1 cm bigger than the smallest size's garment: tight there, and some larger size must clear it
    store.update((d) => { d.ui.activeSize = smallest; }, 'ui:activeSize');
    fw.refresh();
    const g = fw.report() ? fw.report().garmentGirth_cm : 0;
    assert(g > 0, 'no fit report for the active size');
    store.update((d) => { d.body.params.chest_cm = g + 1; d.body.params.waist_cm = 60; d.body.params.hips_cm = 70; }, 'body:params');
    fw.refresh();
    const r = fw.report();
    assert(r && r.level === 'tight' && !el.hidden && el.dataset.level === 'tight', 'banner must show tight: ' + JSON.stringify(r && { level: r.level, hidden: el.hidden }));
    assert(/tear/.test(byId(document, 'fit-warning-text').textContent || ''), 'the message must say the seams will tear');
    assert(r.better && !btnUse.hidden && btnUse.dataset.size === r.better.name, 'a size that fits must be offered: ' + JSON.stringify(r.better));
    btnUse.click();
    assert(store.get().ui.activeSize === r.better.name, 'Use must switch the active size to ' + r.better.name + ', got ' + store.get().ui.activeSize);
    fw.refresh();
    assert(el.hidden || el.dataset.level !== 'tight', 'after switching to a size that fits, the tight banner must go');
    // dismiss hides this message but a different one shows again
    store.update((d) => { d.ui.activeSize = smallest; }, 'ui:activeSize');
    fw.refresh();
    assert(!el.hidden, 'banner should be back at the small size');
    /** @type {HTMLButtonElement} */ (byId(document, 'btn-fit-dismiss')).click();
    assert(el.hidden, 'dismiss must hide the banner');
    fw.refresh();
    assert(el.hidden, 'the same message must stay dismissed');
    fw.clearDismissed();
    return 'tight at ' + smallest + ' (' + g + ' cm garment), offered ' + r.better.name + ', dismiss sticks';
  });

  // 19 ----------------------------------------------------------------- the scene control over the 3D pane
  await run('scene-controls', () => {
    const sel = /** @type {HTMLSelectElement} */ (byId(document, 'sel-scene'));
    const color = /** @type {HTMLInputElement} */ (byId(document, 'input-scene-bg'));
    const reset = /** @type {HTMLButtonElement} */ (byId(document, 'btn-scene-bg-reset'));
    assert(sel.options.length === SCENE_PRESETS.length, 'the list has ' + sel.options.length + ' scenes, expected ' + SCENE_PRESETS.length);
    const target = SCENE_PRESETS[SCENE_PRESETS.length - 1].id;
    sel.value = target;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    assert(store.get().ui.scene.preset === target, 'choosing a scene must write ui.scene.preset, got ' + JSON.stringify(store.get().ui.scene));
    color.value = '#112233';
    color.dispatchEvent(new Event('input', { bubbles: true }));
    assert(store.get().ui.scene.background === '#112233' && store.get().ui.scene.preset === target, 'the colour must write ui.scene.background and keep the preset');
    assert(!reset.disabled, 'reset must be enabled with a custom colour');
    reset.click();
    assert(store.get().ui.scene.background === null && reset.disabled, 'reset must clear the colour and disable itself');
    // a scene change is a view setting, like the layout: never an undo step
    const h = store.history();
    assert(!h.undo.some((l) => /scene/.test(l)), 'scene changes must not be undo steps: ' + JSON.stringify(h.undo.slice(-3)));
    store.update((d) => { d.ui.scene = { preset: 'workshop', background: null }; }, 'ui:scene');
    assert(sel.value === 'workshop', 'the list must follow the document');
    return SCENE_PRESETS.length + ' scenes; preset, colour and reset write ui.scene; not undoable';
  });

  // 17 ----------------------------------------------------------------- the user guide
  await run('guide', () => {
    const g = ui.guide;
    assert(g && typeof g.open === 'function', 'createUi must expose the guide');
    const overlay = /** @type {HTMLElement} */ (byId(document, 'guide'));
    // every section renders once, ids are unique, and every cross-link and help button lands on a section
    const ids = GUIDE_SECTIONS.map((x) => x.id);
    assert(new Set(ids).size === ids.length, 'duplicate guide section ids');
    assert(document.querySelectorAll('#guide-body .guide-section').length === ids.length, 'not every section rendered');
    const dangling = [...document.querySelectorAll('[data-guide]')].map((el) => el.getAttribute('data-guide'))
      .filter((id) => !ids.includes(/** @type {string} */ (id)));
    assert(dangling.length === 0, 'help links to missing sections: ' + [...new Set(dangling)].join(', '));
    assert(document.querySelectorAll('.guide-link[data-guide]').length >= 5, 'the dock panels and the fit banner should carry help buttons');
    // the sanitizer keeps the contract and nothing else
    const frag = sanitizeGuideHtml(document, '<p onclick="x()" style="color:red">a<script>bad()</script><img src=x onerror=y()>'
      + '<a href="https://example.com" data-guide="body">b</a><iframe></iframe><u>d</u></p><div class="guide-tip evil">c</div>');
    const box = document.createElement('div');
    box.appendChild(frag);
    const html = box.innerHTML;
    assert(!/script|onclick|onerror|style=|iframe|img|example\.com|evil|<u>/.test(html), 'sanitizer let through: ' + html);
    assert(/^<p>a<a data-guide="body"[^>]*>b<\/a>d<\/p><div class="guide-tip">c<\/div>$/.test(html), 'sanitizer dropped allowed content: ' + html);
    // the shortcut table is the live table: every binding appears
    const keys = shortcutRows().reduce((n, r) => n + r.keys.length, 0);
    assert(keys === SHORTCUTS.length, 'shortcut rows cover ' + keys + ' of ' + SHORTCUTS.length + ' bindings');
    // open / search / close, via the toolbar button and via the ? key
    g.close();
    let seen = captureActions(bus, () => /** @type {HTMLButtonElement} */ (byId(document, 'btn-guide')).click());
    assert(seen.length === 1 && seen[0].action === 'guide', 'btn-guide emitted ' + JSON.stringify(seen));
    seen = captureActions(bus, () => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true })));
    assert(seen.length === 1 && seen[0].action === 'guide', '? emitted ' + JSON.stringify(seen));
    g.open('shortcuts');
    assert(g.isOpen() && !overlay.hidden && g.current() === 'shortcuts', 'open(shortcuts) did not show that section');
    const n = g.search('zzqxj-not-a-word');
    assert(n === 0, 'a nonsense search matched ' + n + ' sections');
    const m = g.search('undo');
    assert(m >= 1 && document.querySelector('#guide-body mark'), 'searching "undo" should match and highlight');
    g.search('');
    assert(document.querySelectorAll('#guide-body .guide-section:not([hidden])').length === ids.length, 'clearing the search must show every section');
    // while open, the app's shortcuts are muted (a D typed here must not drape)
    const search = /** @type {HTMLInputElement} */ (byId(document, 'inp-guide-search'));
    search.focus();
    seen = captureActions(bus, () => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true })));
    assert(seen.length === 0, 'a key typed in the guide reached the app: ' + JSON.stringify(seen));
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert(!g.isOpen() && overlay.hidden, 'Escape must close the guide');
    assert(!overlay.contains(document.activeElement), 'focus left inside the closed guide');
    return ids.length + ' sections, ' + keys + ' shortcut bindings, sanitizer, search, open/close';
  });

  // ------------------------------------------------------------------ restore
  try {
    ui.layout.setLayout('split');
    store.replace(parseDoc(snapshot), 'selftest restore');
    if (owned) ui.destroy();
  } catch (err) {
    add('restore', false, 'could not restore the document: ' + ((err && err.message) || err));
  }

  return results;
}
