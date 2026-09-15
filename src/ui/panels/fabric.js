// src/ui/panels/fabric.js — the Fabric dock panel (SPEC 11.8.3).
// Colour / colour2 / texture-scale and the two global sim scales use store batches: `input` = step (origin 'drag'),
// `change` = commit (one undo entry). The physics table is read-only from resolveFabric(instance).

import { EVENT } from '../../core/events.js';
import { FABRIC_PRESETS, TEXTURE_KINDS, DEFAULT_TEXTURE, PHYSICS_KEYS, resolveFabric, isHexColor } from '../../core/fabrics.js';
import { clamp } from '../../core/units.js';
import { byId } from '../ids.js';

/** @typedef {import('../../core/store.js').Store} Store */
/** @typedef {import('../../core/events.js').EventBus} EventBus */

/** slider value v ∈ [−1,1] ↔ scale 10^v (0.1 .. 10). */
export function scaleFromSlider(v) { return Math.pow(10, clamp(Number(v) || 0, -1, 1)); }
/** @param {number} s @returns {number} */
export function sliderFromScale(s) {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(clamp(Math.log10(n), -1, 1) * 100) / 100;
}
/** Round to 3 significant digits. @param {number} n @returns {number} */
export function sig3(n) {
  if (!Number.isFinite(n) || n === 0) return 0;
  const m = Math.pow(10, 2 - Math.floor(Math.log10(Math.abs(n))));
  return Math.round(n * m) / m;
}

/**
 * @param {Store} store @param {EventBus} bus @param {Document|HTMLElement} [root=document]
 * @returns {object} {refresh, setPiece, destroy}
 */
export function createFabricPanel(store, bus, root = document) {
  /** @type {Array<() => void>} */
  const offs = [];
  let destroyed = false;
  const doc0 = root.ownerDocument || /** @type {Document} */ (root);

  const selPiece = /** @type {HTMLSelectElement|null} */ (byId(root, 'sel-fabric-piece'));
  const elFabricId = byId(root, 'fabric-id');
  const selPreset = /** @type {HTMLSelectElement|null} */ (byId(root, 'sel-fabric-preset'));
  const inColor = /** @type {HTMLInputElement|null} */ (byId(root, 'input-color'));
  const selTexture = /** @type {HTMLSelectElement|null} */ (byId(root, 'sel-texture'));
  const inColor2 = /** @type {HTMLInputElement|null} */ (byId(root, 'input-color2'));
  const rngScale = /** @type {HTMLInputElement|null} */ (byId(root, 'range-texture-scale'));
  const outScale = byId(root, 'range-texture-scale-val');
  const rngBend = /** @type {HTMLInputElement|null} */ (byId(root, 'range-bend-scale'));
  const outBend = byId(root, 'range-bend-scale-val');
  const rngStretch = /** @type {HTMLInputElement|null} */ (byId(root, 'range-stretch-scale'));
  const outStretch = byId(root, 'range-stretch-scale-val');
  const tblPhysics = byId(root, 'fabric-physics');

  /** @type {string|null} */
  let pieceId = null;

  /** @param {HTMLElement|null} t @param {string} type @param {(e:any)=>void} fn */
  function on(t, type, fn) {
    if (!t) return;
    t.addEventListener(type, /** @type {EventListener} */ (fn));
    offs.push(() => t.removeEventListener(type, /** @type {EventListener} */ (fn)));
  }

  /** @param {HTMLSelectElement|null} sel @param {Array<{value:string, label:string}>} items */
  function fillSelect(sel, items) {
    if (!sel) return;
    const current = Array.from(sel.options).map((o) => o.value);
    if (current.length === items.length && current.every((v, i) => v === items[i].value)) return;
    const keep = sel.value;
    sel.textContent = '';
    for (const it of items) {
      const o = doc0.createElement('option');
      o.value = it.value; o.textContent = it.label;
      sel.appendChild(o);
    }
    if (items.some((it) => it.value === keep)) sel.value = keep;
  }

  fillSelect(selPreset, FABRIC_PRESETS.map((p) => ({ value: p.id, label: p.name || p.id })));
  fillSelect(selTexture, TEXTURE_KINDS.map((k) => ({ value: k, label: k })));

  // ------------------------------------------------------------------ current instance

  /** @returns {{piece:any, inst:any}|{piece:null, inst:null}} */
  function current() {
    const doc = store.get();
    const pieces = (doc && doc.pieces) || [];
    const piece = pieces.find((/** @type {any} */ p) => p.id === pieceId) || pieces[0] || null;
    if (!piece) return { piece: null, inst: null };
    const inst = ((doc && doc.fabrics) || []).find((/** @type {any} */ f) => f.id === piece.fabricId) || null;
    return { piece, inst };
  }

  /** @param {(inst:any, d:any) => void} fn @param {string} label */
  function updateInstance(fn, label) {
    const { piece } = current();
    if (!piece) return;
    const fid = piece.fabricId;
    store.update((d) => {
      const inst = d.fabrics.find((/** @type {any} */ f) => f.id === fid);
      if (inst) fn(inst, d);
    }, label);
  }

  // ------------------------------------------------------------------ batch helper (input = step, change = commit)

  /** @type {{b:any, label:string}|null} */
  let batch = null;
  /** @param {string} label @returns {any|null} */
  function openBatch(label) {
    if (batch && batch.label === label && batch.b.active) return batch.b;
    closeBatch();
    try { batch = { b: store.batch(label), label }; } catch { batch = null; return null; }
    return batch.b;
  }
  function closeBatch() {
    if (!batch) return;
    try { if (batch.b.active) batch.b.commit(); } catch { /* ignore */ }
    batch = null;
  }

  /** @param {string} label @param {(d:any, inst:any) => void} fn */
  function batchStep(label, fn) {
    const { piece } = current();
    if (!piece) return;
    const fid = piece.fabricId;
    const b = openBatch(label);
    const apply = (/** @type {any} */ d) => {
      const inst = d.fabrics.find((/** @type {any} */ f) => f.id === fid);
      fn(d, inst);
    };
    if (b) b.update(apply); else store.update(apply, label);
  }

  // ------------------------------------------------------------------ controls

  on(selPiece, 'change', () => { pieceId = selPiece ? selPiece.value : null; refresh(); });

  on(selPreset, 'change', () => {
    const id = selPreset ? selPreset.value : '';
    if (!id) return;
    updateInstance((inst) => { inst.preset = id; }, 'fabric:preset');
  });

  on(inColor, 'input', () => {
    const hex = inColor ? inColor.value : '';
    if (!isHexColor(hex)) return;
    batchStep('fabric:color', (d, inst) => { if (inst) inst.color = hex; });
  });
  on(inColor, 'change', () => {
    const hex = inColor ? inColor.value : '';
    if (isHexColor(hex)) batchStep('fabric:color', (d, inst) => { if (inst) inst.color = hex; });
    closeBatch();
  });

  /** @returns {{kind:string, scale_mm:number, color2:string}} */
  function textureFromControls() {
    const { inst } = current();
    const base = (inst && inst.texture) || DEFAULT_TEXTURE;
    return {
      kind: selTexture && TEXTURE_KINDS.includes(/** @type {any} */ (selTexture.value)) ? selTexture.value : base.kind,
      scale_mm: rngScale ? clamp(Number(rngScale.value) || base.scale_mm, 2, 100) : base.scale_mm,
      color2: inColor2 && isHexColor(inColor2.value) ? inColor2.value : base.color2,
    };
  }

  on(selTexture, 'change', () => {
    const tex = textureFromControls();
    updateInstance((inst) => { inst.texture = tex; }, 'fabric:texture');
  });

  on(inColor2, 'input', () => {
    const tex = textureFromControls();
    batchStep('fabric:texture', (d, inst) => { if (inst) inst.texture = tex; });
  });
  on(inColor2, 'change', () => {
    const tex = textureFromControls();
    batchStep('fabric:texture', (d, inst) => { if (inst) inst.texture = tex; });
    closeBatch();
  });

  on(rngScale, 'input', () => {
    if (outScale) outScale.textContent = (rngScale ? rngScale.value : '') + ' mm';
    const tex = textureFromControls();
    batchStep('fabric:texture', (d, inst) => { if (inst) inst.texture = tex; });
  });
  on(rngScale, 'change', () => {
    const tex = textureFromControls();
    batchStep('fabric:texture', (d, inst) => { if (inst) inst.texture = tex; });
    closeBatch();
  });

  /**
   * @param {HTMLInputElement|null} rng @param {HTMLElement|null} out @param {'bendScale'|'stretchScale'} key @param {string} label
   */
  function bindSimScale(rng, out, key, label) {
    on(rng, 'input', () => {
      const v = rng ? Number(rng.value) : 0;
      const scale = sig3(scaleFromSlider(v));
      if (out) out.textContent = '×' + scale.toFixed(2);
      const b = openBatch(label);
      const apply = (/** @type {any} */ d) => { d.sim[key] = scale; };
      if (b) b.update(apply); else store.update(apply, label);
    });
    on(rng, 'change', () => {
      const v = rng ? Number(rng.value) : 0;
      const scale = sig3(scaleFromSlider(v));
      const b = openBatch(label);
      const apply = (/** @type {any} */ d) => { d.sim[key] = scale; };
      if (b) b.update(apply); else store.update(apply, label);
      closeBatch();
    });
  }
  bindSimScale(rngBend, outBend, 'bendScale', 'sim:bendScale');
  bindSimScale(rngStretch, outStretch, 'stretchScale', 'sim:stretchScale');

  // ------------------------------------------------------------------ render

  /** @param {any} doc */
  function syncPieceOptions(doc) {
    if (!selPiece) return;
    const pieces = (doc && doc.pieces) || [];
    fillSelect(selPiece, pieces.map((/** @type {any} */ p) => ({ value: p.id, label: p.name || p.id })));
    if (pieceId && pieces.some((/** @type {any} */ p) => p.id === pieceId)) selPiece.value = pieceId;
    else if (pieces.length) { pieceId = pieces[0].id; selPiece.value = pieceId; }
  }

  /** @param {any} inst */
  function renderPhysics(inst) {
    if (!tblPhysics) return;
    tblPhysics.textContent = '';
    if (!inst) return;
    let resolved;
    try { resolved = resolveFabric(inst); } catch { return; }
    const phys = resolved.physics || resolved;
    for (const k of PHYSICS_KEYS) {
      const tr = doc0.createElement('tr');
      const th = doc0.createElement('th');
      th.textContent = k;
      const td = doc0.createElement('td');
      td.dataset.testid = 'fabric-physics-' + k;
      const v = phys[k];
      td.textContent = typeof v === 'number' ? String(Math.round(v * 1e4) / 1e4) : String(v == null ? '' : v);
      tr.appendChild(th); tr.appendChild(td);
      tblPhysics.appendChild(tr);
    }
  }

  function refresh() {
    if (destroyed) return;
    const doc = store.get();
    const focused = doc0.activeElement;
    syncPieceOptions(doc);
    const { inst } = current();

    if (elFabricId) elFabricId.textContent = inst ? (inst.id + ' — ' + (inst.name || inst.id)) : '';
    if (selPreset && selPreset !== focused && inst) selPreset.value = inst.preset;
    if (inColor && inColor !== focused && inst) inColor.value = inst.color;
    const tex = (inst && inst.texture) || DEFAULT_TEXTURE;
    if (selTexture && selTexture !== focused) selTexture.value = tex.kind;
    if (inColor2 && inColor2 !== focused) inColor2.value = tex.color2;
    if (rngScale && rngScale !== focused) rngScale.value = String(tex.scale_mm);
    if (outScale) outScale.textContent = tex.scale_mm + ' mm';

    const sim = (doc && doc.sim) || {};
    if (rngBend && rngBend !== focused) rngBend.value = String(sliderFromScale(sim.bendScale));
    if (outBend) outBend.textContent = '×' + Number(sim.bendScale || 1).toFixed(2);
    if (rngStretch && rngStretch !== focused) rngStretch.value = String(sliderFromScale(sim.stretchScale));
    if (outStretch) outStretch.textContent = '×' + Number(sim.stretchScale || 1).toFixed(2);

    renderPhysics(inst);
  }

  /** @param {string|null} id */
  function setPiece(id) { pieceId = id || null; refresh(); }

  /** @param {{pieces?:string[]}|null} selection */
  function setSelection(selection) {
    const primary = selection && selection.pieces && selection.pieces[0];
    if (!primary) return;
    if (selPiece && doc0.activeElement === selPiece) return;
    pieceId = primary;
    refresh();
  }

  offs.push(store.subscribe(() => refresh()));
  offs.push(bus.on(EVENT.SELECTION_CHANGED, (p) => setSelection(p && p.selection)));
  offs.push(bus.on(EVENT.FABRIC_CHANGED, () => refresh()));

  refresh();

  return {
    refresh,
    setPiece,
    setSelection,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      closeBatch();
      for (const off of offs) { try { off(); } catch { /* ignore */ } }
      offs.length = 0;
    },
  };
}
