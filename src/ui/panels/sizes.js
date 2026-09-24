// src/ui/panels/sizes.js — the Sizes dock panel (SPEC 11.8.4): the editable size chart table, the base-size
// select and the graded-ease drift list. Every cell carries data-size / data-key so automation can address it.

import { EVENT } from '../../core/events.js';
import { rowByName, seamEaseDrift } from '../../sizing/index.js';
import { byId } from '../ids.js';

/** @typedef {import('../../core/store.js').Store} Store */
/** @typedef {import('../../core/events.js').EventBus} EventBus */

/** Name candidates for `btn-size-add`, in order (SPEC 11.8.4). */
export const SIZE_NAMES = Object.freeze(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']);
/** Per-key step applied to the last row when a size is appended. */
export const SIZE_STEP_CM = Object.freeze({
  chest_cm: 4, waist_cm: 4, hips_cm: 4, height_cm: 5, torsoLength_cm: 1, armLength_cm: 1,
});

/**
 * @param {Store} store @param {EventBus} bus @param {Document|HTMLElement} [root=document]
 * @returns {object} {refresh, setClosest, setSelected, getSelected, destroy}
 */
export function createSizesPanel(store, bus, root = document) {
  /** @type {Array<() => void>} */
  const offs = [];
  let destroyed = false;
  const doc0 = root.ownerDocument || /** @type {Document} */ (root);

  const table = byId(root, 'table-sizes');
  const btnAdd = /** @type {HTMLButtonElement|null} */ (byId(root, 'btn-size-add'));
  const btnRemove = /** @type {HTMLButtonElement|null} */ (byId(root, 'btn-size-remove'));
  const selBase = /** @type {HTMLSelectElement|null} */ (byId(root, 'sel-base-size'));
  const btnFromBody = /** @type {HTMLButtonElement|null} */ (byId(root, 'btn-size-from-body'));
  const btnDxfAll = /** @type {HTMLButtonElement|null} */ (byId(root, 'btn-size-export-dxf'));
  const listIssues = byId(root, 'list-size-issues');
  const panel = byId(root, 'panel-sizes');

  /** @type {string|null} */
  let selected = null;
  /** @type {string|null} */
  let closest = null;

  /** @param {HTMLElement|null} t @param {string} type @param {(e:any)=>void} fn */
  function on(t, type, fn) {
    if (!t) return;
    t.addEventListener(type, /** @type {EventListener} */ (fn));
    offs.push(() => t.removeEventListener(type, /** @type {EventListener} */ (fn)));
  }

  // Every size of every piece as one graded DXF-AAMA file (the toolbar's DXF button exports the active size).
  on(btnDxfAll, 'click', () => {
    if (btnDxfAll) btnDxfAll.blur();
    bus.emit(EVENT.UI_ACTION, { action: 'export', kind: 'dxf', size: '*' });
  });

  /** @param {string} text @param {'info'|'warn'|'error'} level */
  function status(text, level) { bus.emit(EVENT.UI_STATUS, { level, text, source: 'ui/panels/sizes' }); }

  // ------------------------------------------------------------------ table

  function renderTable() {
    if (!table) return;
    const doc = store.get();
    const sizes = (doc && doc.sizes) || { measurements: [], rows: [], baseSize: '' };
    const keys = sizes.measurements || [];
    const rows = sizes.rows || [];
    if (!selected || !rows.some((/** @type {any} */ r) => r.name === selected)) selected = sizes.baseSize;

    const act = /** @type {HTMLElement|null} */ (doc0.activeElement);
    const focusedId = (act && act.dataset && act.dataset.size && act.dataset.key)
      ? [act.dataset.size, act.dataset.key] : null;

    table.textContent = '';
    const thead = doc0.createElement('thead');
    const htr = doc0.createElement('tr');
    htr.appendChild(doc0.createElement('th'));
    for (const k of keys) {
      const th = doc0.createElement('th');
      th.dataset.key = k;
      th.textContent = k.replace('_cm', '');
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = doc0.createElement('tbody');
    for (const r of rows) {
      const tr = doc0.createElement('tr');
      tr.dataset.size = r.name;
      tr.dataset.testid = 'size-row';
      if (r.name === sizes.baseSize) tr.dataset.base = 'true';
      if (r.name === closest) tr.dataset.closest = 'true';
      if (r.name === selected) tr.classList.add('selected');
      tr.addEventListener('click', () => { selected = r.name; markSelected(); });

      const tdName = doc0.createElement('td');
      const inName = doc0.createElement('input');
      inName.type = 'text';
      inName.dataset.size = r.name;
      inName.dataset.key = 'name';
      inName.value = r.name;
      inName.addEventListener('change', () => renameRowTo(r.name, inName.value, inName));
      tdName.appendChild(inName);
      tr.appendChild(tdName);

      for (const k of keys) {
        const td = doc0.createElement('td');
        const inp = doc0.createElement('input');
        inp.type = 'number';
        inp.step = '0.5';
        inp.dataset.size = r.name;
        inp.dataset.key = k;
        inp.dataset.testid = 'size-cell';
        inp.value = typeof r[k] === 'number' ? String(r[k]) : '';
        inp.addEventListener('change', () => {
          const v = Number(inp.value);
          if (!Number.isFinite(v)) { inp.value = typeof r[k] === 'number' ? String(r[k]) : ''; return; }
          store.update((d) => {
            const target = rowByName(d.sizes, r.name);
            if (target) target[k] = v;
          }, 'sizes:cell');
        });
        td.appendChild(inp);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    if (focusedId) {
      const again = table.querySelector('[data-size="' + focusedId[0] + '"][data-key="' + focusedId[1] + '"]');
      if (again && typeof (/** @type {any} */ (again).focus) === 'function') /** @type {any} */ (again).focus();
    }
  }

  /** Update only the `selected` / `data-closest` marks — never rebuilds the inputs. */
  function markSelected() {
    if (!table) return;
    for (const tr of Array.from(table.querySelectorAll('tr[data-size]'))) {
      const el2 = /** @type {HTMLElement} */ (tr);
      el2.classList.toggle('selected', el2.dataset.size === selected);
      if (el2.dataset.size === closest) el2.dataset.closest = 'true';
      else delete el2.dataset.closest;
    }
  }

  /** @param {string} oldName @param {string} raw @param {HTMLInputElement} field */
  function renameRowTo(oldName, raw, field) {
    const newName = String(raw || '').trim();
    const doc = store.get();
    const names = (doc.sizes.rows || []).map((/** @type {any} */ r) => r.name);
    if (!newName || (newName !== oldName && names.includes(newName))) {
      status(!newName ? 'A size name cannot be empty' : 'Size "' + newName + '" already exists', 'warn');
      field.value = oldName;
      return;
    }
    if (newName === oldName) return;
    store.update((d) => {
      const row = rowByName(d.sizes, oldName);
      if (!row) return;
      row.name = newName;
      if (d.sizes.baseSize === oldName) d.sizes.baseSize = newName;
      if (d.ui.activeSize === oldName) d.ui.activeSize = newName;
    }, 'sizes:rename');
    if (selected === oldName) selected = newName;
  }

  // ------------------------------------------------------------------ buttons

  on(btnAdd, 'click', () => {
    btnAdd.blur();
    /** @type {string} */
    let created = '';
    store.update((d) => {
      const rows = d.sizes.rows;
      const used = new Set(rows.map((/** @type {any} */ r) => r.name));
      const name = SIZE_NAMES.find((n) => !used.has(n)) || ('size' + (rows.length + 1));
      const last = rows[rows.length - 1] || {};
      /** @type {any} */
      const row = { name };
      for (const k of d.sizes.measurements) {
        const base = typeof last[k] === 'number' ? last[k] : 0;
        row[k] = base + (SIZE_STEP_CM[k] || 0);
      }
      rows.push(row);
      created = name;
    }, 'sizes:add');
    if (created) selected = created;
    refresh();
  });

  on(btnRemove, 'click', () => {
    btnRemove.blur();
    const doc = store.get();
    const rows = doc.sizes.rows || [];
    const name = selected;
    if (!name) return;
    if (name === doc.sizes.baseSize) { status('Cannot remove the base size', 'warn'); return; }
    if (rows.length <= 1) { status('Cannot remove the last size', 'warn'); return; }
    store.update((d) => {
      d.sizes.rows = d.sizes.rows.filter((/** @type {any} */ r) => r.name !== name);
      if (d.ui.activeSize === name) d.ui.activeSize = d.sizes.baseSize;
    }, 'sizes:remove');
    selected = null;
    refresh();
  });

  on(selBase, 'change', () => {
    const name = selBase ? selBase.value : '';
    if (!name) return;
    store.update((d) => { d.sizes.baseSize = name; }, 'sizes:baseSize');
  });

  on(btnFromBody, 'click', () => {
    btnFromBody.blur();
    store.update((d) => {
      let row = rowByName(d.sizes, 'Body');
      if (!row) { row = { name: 'Body' }; d.sizes.rows.push(row); }
      for (const k of d.sizes.measurements) row[k] = d.body.params[k] ?? row[k] ?? 0;
    }, 'sizes:fromBody');
    selected = 'Body';
    refresh();
  });

  // ------------------------------------------------------------------ base select + drift issues

  function renderBaseSelect() {
    if (!selBase) return;
    const doc = store.get();
    const names = (doc.sizes.rows || []).map((/** @type {any} */ r) => r.name);
    const current = Array.from(selBase.options).map((o) => o.value);
    if (current.length !== names.length || current.some((v, i) => v !== names[i])) {
      selBase.textContent = '';
      for (const n of names) {
        const o = doc0.createElement('option');
        o.value = n; o.textContent = n;
        selBase.appendChild(o);
      }
    }
    if (names.includes(doc.sizes.baseSize)) selBase.value = doc.sizes.baseSize;
  }

  /** Only computed while the Sizes tab is visible (SPEC 11.8.4). */
  function renderIssues() {
    if (!listIssues) return;
    listIssues.textContent = '';
    if (panel && panel.hidden) return;
    const doc = store.get();
    const base = doc.sizes.baseSize;
    for (const r of doc.sizes.rows || []) {
      if (r.name === base) continue;
      /** @type {any[]} */
      let drift = [];
      try { drift = seamEaseDrift(doc, r.name); } catch { drift = []; }
      for (const i of drift) {
        if (i.level !== 'warn') continue;
        const li = doc0.createElement('li');
        li.dataset.testid = 'size-issue';
        li.dataset.size = r.name;
        if (i.seamId) li.dataset.seamId = i.seamId;
        li.textContent = r.name + ': ' + i.message;
        listIssues.appendChild(li);
      }
    }
  }

  function refresh() {
    if (destroyed) return;
    renderTable();
    renderBaseSelect();
    renderIssues();
  }

  /** @param {{name:string}|string|null} c */
  function setClosest(c) {
    closest = c == null ? null : (typeof c === 'string' ? c : c.name);
    markSelected();
  }
  /** @param {string|null} name */
  function setSelected(name) { selected = name; markSelected(); }
  function getSelected() { return selected; }

  offs.push(store.subscribe((change) => {
    if (destroyed) return;
    if (!change || change.sizes || change.pieces || change.seams || change.ui) refresh();
  }));
  offs.push(bus.on(EVENT.UI_DOCK, (p) => { if (p && p.tab === 'sizes') refresh(); }));
  offs.push(bus.on(EVENT.SIZE_ACTIVE, () => markSelected()));

  refresh();

  return {
    refresh,
    setClosest,
    setSelected,
    getSelected,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const off of offs) { try { off(); } catch { /* ignore */ } }
      offs.length = 0;
    },
  };
}
