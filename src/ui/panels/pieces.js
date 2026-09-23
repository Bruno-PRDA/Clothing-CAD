// src/ui/panels/pieces.js — the Pieces dock panel (SPEC 11.8.1): piece list, piece / placement / grading /
// edge fieldsets, the seam list with its ease readout, and the issue list.
// Selection intent goes out as EVENT.UI_ACTION {action:'selectPiece'|'selectSeam'}; the panel never calls the editor.

import { EVENT } from '../../core/events.js';
import { uid } from '../../core/ids.js';
import { clamp } from '../../core/units.js';
import { bbox } from '../../geometry/index.js';
import { formatSeamRow, hueOf, edgeLengthOf, seamEase, formatEase } from '../../pattern/index.js';
import { byId } from '../ids.js';

/** @typedef {import('../../core/store.js').Store} Store */
/** @typedef {import('../../core/events.js').EventBus} EventBus */

/** Ease above this percentage marks a seam row `data-warn="true"` (SPEC 11.1.2). */
export const EASE_WARN_PCT = 8;
/** x offset applied to a duplicated piece, on top of its bbox width. */
export const DUPLICATE_GAP_MM = 30;

/**
 * @param {Store} store @param {EventBus} bus @param {Document|HTMLElement} [root=document]
 * @returns {object} {refresh, setSelection, setIssues, destroy}
 */
export function createPiecesPanel(store, bus, root = document) {
  /** @type {Array<() => void>} */
  const offs = [];
  let destroyed = false;
  const doc0 = root.ownerDocument || /** @type {Document} */ (root);

  const listPieces = byId(root, 'list-pieces');
  const listSeams = byId(root, 'list-seams');
  const listIssues = byId(root, 'list-issues');
  const fsProps = /** @type {HTMLFieldSetElement|null} */ (byId(root, 'piece-props'));
  const fsPlacement = /** @type {HTMLFieldSetElement|null} */ (byId(root, 'piece-placement'));
  const fsGrade = /** @type {HTMLFieldSetElement|null} */ (byId(root, 'piece-grade'));
  const fsEdge = /** @type {HTMLFieldSetElement|null} */ (byId(root, 'edge-props'));

  const el = /** @param {string} id */ (id) => byId(root, id);
  const inpName = /** @type {HTMLInputElement|null} */ (el('inp-piece-name'));
  const numQty = /** @type {HTMLInputElement|null} */ (el('num-piece-qty'));
  const numLayer = /** @type {HTMLInputElement|null} */ (el('num-piece-layer'));
  const numMesh = /** @type {HTMLInputElement|null} */ (el('num-piece-mesh'));
  const numAllow = /** @type {HTMLInputElement|null} */ (el('num-piece-allowance'));
  const selFabric = /** @type {HTMLSelectElement|null} */ (el('sel-piece-fabric'));
  const chkSim = /** @type {HTMLInputElement|null} */ (el('chk-piece-simulate'));
  const chkHidden = /** @type {HTMLInputElement|null} */ (el('chk-piece-exporthidden'));
  const spanFold = el('piece-fold');

  const selAnchor = /** @type {HTMLSelectElement|null} */ (el('sel-placement-anchor'));
  const selSide = /** @type {HTMLSelectElement|null} */ (el('sel-placement-side'));
  const numDx = /** @type {HTMLInputElement|null} */ (el('num-placement-dx'));
  const numDy = /** @type {HTMLInputElement|null} */ (el('num-placement-dy'));
  const rngWrap = /** @type {HTMLInputElement|null} */ (el('range-placement-wrap'));
  const outWrap = el('range-placement-wrap-val');
  const chkFlip = /** @type {HTMLInputElement|null} */ (el('chk-placement-flip'));

  const selGradeW = /** @type {HTMLSelectElement|null} */ (el('sel-grade-width'));
  const selGradeL = /** @type {HTMLSelectElement|null} */ (el('sel-grade-length'));
  const selGradeAX = /** @type {HTMLSelectElement|null} */ (el('sel-grade-anchorx'));
  const selGradeAY = /** @type {HTMLSelectElement|null} */ (el('sel-grade-anchory'));

  const spanEdgeIndex = el('edge-index');
  const inpEdgeLabel = /** @type {HTMLInputElement|null} */ (el('inp-edge-label'));
  const numEdgeAllow = /** @type {HTMLInputElement|null} */ (el('num-edge-allowance'));
  const chkEdgePin = /** @type {HTMLInputElement|null} */ (el('chk-edge-pinned'));

  const spanSeamEase = el('seam-ease');
  const btnSeamFlip = /** @type {HTMLButtonElement|null} */ (el('btn-seam-flip'));
  const btnSeamDelete = /** @type {HTMLButtonElement|null} */ (el('btn-seam-delete'));
  const btnDup = /** @type {HTMLButtonElement|null} */ (el('btn-piece-duplicate'));
  const btnDel = /** @type {HTMLButtonElement|null} */ (el('btn-piece-delete'));

  /** @type {{pieces:string[], seams:string[], vertex:any, edge:any}} */
  let selection = cloneSelection(store.transient && store.transient.selection);
  /** @type {any[]} */
  let issues = [];

  /** @param {any} s */
  function cloneSelection(s) {
    return {
      pieces: (s && Array.isArray(s.pieces)) ? s.pieces.slice() : [],
      seams: (s && Array.isArray(s.seams)) ? s.seams.slice() : [],
      vertex: (s && s.vertex) || null,
      edge: (s && s.edge) || null,
    };
  }

  /** @param {HTMLElement|null} t @param {string} type @param {(e:any)=>void} fn */
  function on(t, type, fn) {
    if (!t) return;
    t.addEventListener(type, /** @type {EventListener} */ (fn));
    offs.push(() => t.removeEventListener(type, /** @type {EventListener} */ (fn)));
  }

  /** @param {object} payload */
  function act(payload) { bus.emit(EVENT.UI_ACTION, payload); }

  /** @returns {any|null} */
  function primaryPiece() {
    const doc = store.get();
    const id = selection.pieces[0] || (selection.edge && selection.edge.pieceId) || null;
    if (!id) return null;
    return (doc.pieces || []).find((/** @type {any} */ p) => p.id === id) || null;
  }
  /** @returns {any|null} */
  function primarySeam() {
    const doc = store.get();
    const id = selection.seams[0];
    if (!id) return null;
    return (doc.seams || []).find((/** @type {any} */ s) => s.id === id) || null;
  }

  /** @param {(piece:any, d:any) => void} fn @param {string} label */
  function updatePiece(fn, label) {
    const p = primaryPiece();
    if (!p) return;
    const id = p.id;
    store.update((d) => {
      const target = d.pieces.find((/** @type {any} */ x) => x.id === id);
      if (target) fn(target, d);
    }, label);
  }

  /**
   * @param {HTMLInputElement|null} input @param {number} fallback @returns {number|null}
   */
  function numberOf(input, fallback) {
    if (!input) return null;
    const v = Number(input.value);
    if (!Number.isFinite(v)) { input.value = String(fallback); return null; }
    const lo = input.min === '' ? -Infinity : Number(input.min);
    const hi = input.max === '' ? Infinity : Number(input.max);
    return clamp(v, lo, hi);
  }

  // ------------------------------------------------------------------ piece fieldset

  on(inpName, 'change', () => updatePiece((p) => { p.name = String(inpName.value || '').trim() || p.name; }, 'piece:name'));
  on(numQty, 'change', () => { const v = numberOf(numQty, 1); if (v !== null) updatePiece((p) => { p.cutQty = Math.round(v); }, 'piece:cutQty'); });
  on(numLayer, 'change', () => { const v = numberOf(numLayer, 0); if (v !== null) updatePiece((p) => { p.layer = Math.round(v); }, 'piece:layer'); });
  on(numMesh, 'change', () => { const v = numberOf(numMesh, 15); if (v !== null) updatePiece((p) => { p.meshSpacing_mm = clamp(v, 8, 40); }, 'piece:meshSpacing'); });
  on(numAllow, 'change', () => { const v = numberOf(numAllow, 10); if (v !== null) updatePiece((p) => { p.seamAllowance_mm = v; }, 'piece:allowance'); });
  on(selFabric, 'change', () => updatePiece((p) => { p.fabricId = selFabric.value; }, 'piece:fabric'));
  on(chkSim, 'change', () => updatePiece((p) => { p.simulate = !!chkSim.checked; }, 'piece:simulate'));
  on(chkHidden, 'change', () => updatePiece((p) => { p.exportHidden = !!chkHidden.checked; }, 'piece:exportHidden'));

  // ------------------------------------------------------------------ placement (one label for all six controls)

  function placementFromControls() {
    const p = primaryPiece();
    const base = (p && p.placement) || {};
    return {
      anchor: selAnchor ? selAnchor.value : base.anchor,
      side: selSide ? selSide.value : base.side,
      offset_mm: [
        numDx ? (Number(numDx.value) || 0) : (base.offset_mm ? base.offset_mm[0] : 0),
        numDy ? (Number(numDy.value) || 0) : (base.offset_mm ? base.offset_mm[1] : 0),
      ],
      wrap: rngWrap ? clamp(Number(rngWrap.value) || 0, 0, 1) : base.wrap,
      flip: chkFlip ? !!chkFlip.checked : !!base.flip,
    };
  }
  function commitPlacement() {
    const pl = placementFromControls();
    updatePiece((p) => { p.placement = pl; }, 'piece:placement');
  }
  for (const c of [selAnchor, selSide, numDx, numDy, chkFlip]) on(c, 'change', commitPlacement);
  on(rngWrap, 'input', () => { if (outWrap) outWrap.textContent = Number(rngWrap.value).toFixed(2); });
  on(rngWrap, 'change', () => { if (outWrap) outWrap.textContent = Number(rngWrap.value).toFixed(2); commitPlacement(); });

  // ------------------------------------------------------------------ grading

  function commitGrade() {
    const p = primaryPiece();
    if (!p) return;
    const g = {
      widthRef: selGradeW && selGradeW.value ? selGradeW.value : null,
      lengthRef: selGradeL && selGradeL.value ? selGradeL.value : null,
      anchorX: selGradeAX ? selGradeAX.value : (p.grade && p.grade.anchorX),
      anchorY: selGradeAY ? selGradeAY.value : (p.grade && p.grade.anchorY),
    };
    updatePiece((piece) => {
      piece.grade = Object.assign({}, piece.grade, g, { vertexRules: (piece.grade && piece.grade.vertexRules) || [] });
    }, 'piece:grade');
  }
  for (const c of [selGradeW, selGradeL, selGradeAX, selGradeAY]) on(c, 'change', commitGrade);

  // ------------------------------------------------------------------ edge fieldset

  on(inpEdgeLabel, 'change', () => {
    const e = selection.edge;
    if (!e) return;
    const text = String(inpEdgeLabel.value || '').trim();
    updatePiece((p) => {
      const edge = p.edges[e.edge];
      if (!edge) return;
      if (text) edge.label = text; else delete edge.label;
    }, 'edge:label');
  });
  on(numEdgeAllow, 'change', () => {
    const e = selection.edge;
    if (!e) return;
    const raw = String(numEdgeAllow.value || '').trim();
    updatePiece((p) => {
      const edge = p.edges[e.edge];
      if (!edge) return;
      if (raw === '') { delete edge.allowance_mm; return; }
      const v = Number(raw);
      if (Number.isFinite(v)) edge.allowance_mm = clamp(v, 0, 60);
    }, 'edge:allowance');
  });
  on(chkEdgePin, 'change', () => {
    const e = selection.edge;
    if (!e) return;
    const want = !!chkEdgePin.checked;
    updatePiece((p) => {
      const set = new Set(p.pinnedEdges || []);
      if (want) set.add(e.edge); else set.delete(e.edge);
      p.pinnedEdges = Array.from(set).sort((a, b) => a - b);
    }, 'piece:pinnedEdges');
  });

  // ------------------------------------------------------------------ buttons

  on(btnDup, 'click', () => {
    btnDup.blur();
    const ids = selection.pieces.slice();
    if (ids.length === 0) return;
    store.update((d) => {
      for (const id of ids) {
        const src = d.pieces.find((/** @type {any} */ p) => p.id === id);
        if (!src) continue;
        const copy = structuredClone(src);
        copy.id = uid('piece');
        copy.name = src.name + ' copy';
        let dx = DUPLICATE_GAP_MM;
        try { const b = bbox(src.vertices); dx = (b.maxX - b.minX) + DUPLICATE_GAP_MM; } catch { /* keep gap */ }
        for (const v of copy.vertices) v[0] += dx;
        for (const e of copy.edges) {
          if (e.c1) e.c1[0] += dx;
          if (e.c2) e.c2[0] += dx;
        }
        // Everything drawn ON the piece moves with it; the grainline and internal lines used to stay over
        // the original, so the copy was exported and cut with the original's grain. Notches are stored as
        // edge + t and follow on their own.
        if (copy.grainline) {
          if (Array.isArray(copy.grainline.a)) copy.grainline.a[0] += dx;
          if (Array.isArray(copy.grainline.b)) copy.grainline.b[0] += dx;
        }
        for (const line of copy.internalLines || []) {
          for (const pt of line.points || []) pt[0] += dx;
        }
        d.pieces.push(copy);
      }
    }, 'piece:duplicate');
  });

  on(btnDel, 'click', () => {
    btnDel.blur();
    const ids = new Set(selection.pieces);
    if (ids.size === 0) return;
    store.update((d) => {
      d.pieces = d.pieces.filter((/** @type {any} */ p) => !ids.has(p.id));
      d.seams = d.seams.filter((/** @type {any} */ s) => !ids.has(s.a.pieceId) && !ids.has(s.b.pieceId));
    }, 'piece:delete');
  });

  on(btnSeamFlip, 'click', () => { btnSeamFlip.blur(); flipSeam(selection.seams[0]); });
  on(btnSeamDelete, 'click', () => { btnSeamDelete.blur(); deleteSeam(selection.seams[0]); });

  /** @param {string|undefined} seamId */
  function flipSeam(seamId) {
    if (!seamId) return;
    store.update((d) => {
      const s = d.seams.find((/** @type {any} */ x) => x.id === seamId);
      if (s) s.b.reverse = !s.b.reverse;
    }, 'seam:flip');
  }
  /** @param {string|undefined} seamId */
  function deleteSeam(seamId) {
    if (!seamId) return;
    store.update((d) => { d.seams = d.seams.filter((/** @type {any} */ x) => x.id !== seamId); }, 'seam:delete');
  }

  // ------------------------------------------------------------------ rendering

  /** @param {any} doc */
  function issueCount(doc, pieceId) {
    let n = 0;
    for (const i of issues) if (i && i.pieceId === pieceId) n++;
    return n;
  }

  /** @param {any} doc */
  function renderPieces(doc) {
    if (!listPieces) return;
    listPieces.textContent = '';
    for (const p of doc.pieces || []) {
      const li = doc0.createElement('li');
      li.dataset.pieceId = p.id;
      li.dataset.testid = 'piece-row';
      if (selection.pieces.includes(p.id)) li.classList.add('selected');
      const n = issueCount(doc, p.id);
      li.textContent = p.name + ' ×' + p.cutQty
        + (p.foldEdge !== null && p.foldEdge !== undefined ? ' FOLD' : '')
        + (n ? ' ⚠' + n : '');
      li.addEventListener('click', (/** @type {MouseEvent} */ e) => act({ action: 'selectPiece', pieceId: p.id, additive: !!e.shiftKey }));
      li.addEventListener('dblclick', () => { if (inpName) inpName.focus(); });
      listPieces.appendChild(li);
    }
  }

  /** @param {any} doc @param {any} seam @returns {{text:string, warn:boolean}} */
  function seamRowText(doc, seam) {
    let text = '';
    let warn = false;
    try { text = formatSeamRow(doc, seam); } catch { text = ''; }
    try {
      const e = seamEase(doc, seam);
      warn = Math.abs(e.easePct) > EASE_WARN_PCT;
      if (!text) {
        text = seam.a.pieceId + ' e' + seam.a.edge + ' ↔ ' + seam.b.pieceId + ' e' + seam.b.edge
          + ' · ' + e.lenA_mm.toFixed(0) + ' / ' + e.lenB_mm.toFixed(0) + ' mm · ease ' + e.easePct.toFixed(1) + '%';
      }
    } catch {
      if (!text) text = seam.a.pieceId + ' e' + seam.a.edge + ' ↔ ' + seam.b.pieceId + ' e' + seam.b.edge;
    }
    return { text, warn };
  }

  /** @param {any} doc */
  function renderSeams(doc) {
    if (!listSeams) return;
    listSeams.textContent = '';
    for (const s of doc.seams || []) {
      const li = doc0.createElement('li');
      li.dataset.seamId = s.id;
      li.dataset.testid = 'seam-row';
      const { text, warn } = seamRowText(doc, s);
      li.dataset.warn = String(warn);
      if (selection.seams.includes(s.id)) li.classList.add('selected');

      const sw = doc0.createElement('span');
      sw.className = 'swatch';
      let hue = 0;
      try { hue = hueOf(s.id); } catch { hue = 0; }
      sw.style.background = 'hsl(' + hue + ' 70% 55%)';
      li.appendChild(sw);

      const label = doc0.createElement('span');
      label.className = 'seam-text';
      label.textContent = ' ' + text + ' ';
      li.appendChild(label);

      const bFlip = doc0.createElement('button');
      bFlip.type = 'button';
      bFlip.dataset.action = 'flip';
      bFlip.textContent = 'Flip';
      bFlip.addEventListener('click', (e) => { e.stopPropagation(); flipSeam(s.id); });
      li.appendChild(bFlip);

      const bDel = doc0.createElement('button');
      bDel.type = 'button';
      bDel.dataset.action = 'delete';
      bDel.textContent = 'Delete';
      bDel.addEventListener('click', (e) => { e.stopPropagation(); deleteSeam(s.id); });
      li.appendChild(bDel);

      li.addEventListener('click', () => act({ action: 'selectSeam', seamId: s.id }));
      listSeams.appendChild(li);
    }
  }

  function renderIssues() {
    if (!listIssues) return;
    listIssues.textContent = '';
    for (const i of issues) {
      const li = doc0.createElement('li');
      li.dataset.testid = 'issue';
      li.dataset.level = i.level || 'warn';
      if (i.code) li.dataset.code = i.code;
      if (i.pieceId) li.dataset.pieceId = i.pieceId;
      li.textContent = (i.level === 'error' ? '⛔ ' : '⚠ ') + (i.message || i.code || '');
      if (i.pieceId) li.addEventListener('click', () => act({ action: 'selectPiece', pieceId: i.pieceId }));
      listIssues.appendChild(li);
    }
  }

  /** @param {HTMLSelectElement|null} sel @param {Array<{value:string,label:string}>} items */
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

  /** @param {any} doc */
  function renderFields(doc) {
    const focused = doc0.activeElement;
    const p = primaryPiece();
    if (fsProps) fsProps.disabled = !p;
    if (fsPlacement) fsPlacement.disabled = !p;
    if (fsGrade) fsGrade.disabled = !p;
    if (btnDup) btnDup.disabled = selection.pieces.length === 0;
    if (btnDel) btnDel.disabled = selection.pieces.length === 0;

    fillSelect(selFabric, (doc.fabrics || []).map((/** @type {any} */ f) => ({ value: f.id, label: f.name || f.id })));
    const measures = (doc.sizes && doc.sizes.measurements) || [];
    const gradeItems = [{ value: '', label: '(none)' }].concat(measures.map((/** @type {string} */ k) => ({ value: k, label: k })));
    fillSelect(selGradeW, gradeItems);
    fillSelect(selGradeL, gradeItems);

    if (p) {
      if (spanFold) spanFold.textContent = (p.foldEdge === null || p.foldEdge === undefined) ? '' : 'on fold (edge ' + p.foldEdge + ')';
      if (inpName && inpName !== focused) inpName.value = p.name;
      if (numQty && numQty !== focused) numQty.value = String(p.cutQty);
      if (numLayer && numLayer !== focused) numLayer.value = String(p.layer);
      if (numMesh && numMesh !== focused) numMesh.value = String(p.meshSpacing_mm);
      if (numAllow && numAllow !== focused) numAllow.value = String(p.seamAllowance_mm);
      if (selFabric && selFabric !== focused) selFabric.value = p.fabricId;
      if (chkSim && chkSim !== focused) chkSim.checked = !!p.simulate;
      if (chkHidden && chkHidden !== focused) chkHidden.checked = !!p.exportHidden;

      const pl = p.placement || {};
      if (selAnchor && selAnchor !== focused) selAnchor.value = pl.anchor;
      if (selSide && selSide !== focused) selSide.value = pl.side;
      if (numDx && numDx !== focused) numDx.value = String((pl.offset_mm && pl.offset_mm[0]) || 0);
      if (numDy && numDy !== focused) numDy.value = String((pl.offset_mm && pl.offset_mm[1]) || 0);
      if (rngWrap && rngWrap !== focused) rngWrap.value = String(pl.wrap ?? 1);
      if (outWrap) outWrap.textContent = Number(pl.wrap ?? 1).toFixed(2);
      if (chkFlip && chkFlip !== focused) chkFlip.checked = !!pl.flip;

      const g = p.grade || {};
      if (selGradeW && selGradeW !== focused) selGradeW.value = g.widthRef || '';
      if (selGradeL && selGradeL !== focused) selGradeL.value = g.lengthRef || '';
      if (selGradeAX && selGradeAX !== focused) selGradeAX.value = g.anchorX || 'center';
      if (selGradeAY && selGradeAY !== focused) selGradeAY.value = g.anchorY || 'top';
    } else if (spanFold) {
      spanFold.textContent = '';
    }

    // edge fieldset
    const e = selection.edge;
    const edgePiece = e ? (doc.pieces || []).find((/** @type {any} */ x) => x.id === e.pieceId) : null;
    const edge = edgePiece && edgePiece.edges ? edgePiece.edges[e.edge] : null;
    if (fsEdge) fsEdge.disabled = !edge;
    if (edge && edgePiece) {
      let len = NaN;
      try { len = edgeLengthOf(edgePiece, e.edge); } catch { len = NaN; }
      if (spanEdgeIndex) {
        spanEdgeIndex.textContent = e.edge + ' of ' + edgePiece.name + (Number.isFinite(len) ? '  (' + len.toFixed(1) + ' mm)' : '');
      }
      if (inpEdgeLabel && inpEdgeLabel !== focused) inpEdgeLabel.value = edge.label || '';
      const onFold = edgePiece.foldEdge === e.edge;
      if (numEdgeAllow && numEdgeAllow !== focused) {
        numEdgeAllow.value = onFold ? '0' : (typeof edge.allowance_mm === 'number' ? String(edge.allowance_mm) : '');
        numEdgeAllow.placeholder = String(edgePiece.seamAllowance_mm);
        numEdgeAllow.disabled = onFold;
      }
      if (chkEdgePin && chkEdgePin !== focused) chkEdgePin.checked = (edgePiece.pinnedEdges || []).includes(e.edge);
    } else if (spanEdgeIndex) {
      spanEdgeIndex.textContent = '';
    }

    // selected seam readout
    const seam = primarySeam();
    if (btnSeamFlip) btnSeamFlip.disabled = !seam;
    if (btnSeamDelete) btnSeamDelete.disabled = !seam;
    if (spanSeamEase) {
      if (!seam) { spanSeamEase.textContent = ''; spanSeamEase.dataset.warn = 'false'; }
      else {
        let text = '';
        let warn = false;
        try {
          const ease = seamEase(doc, seam);
          warn = Math.abs(ease.easePct) > EASE_WARN_PCT;
          try { text = formatEase(ease); }
          catch { text = ease.lenA_mm.toFixed(0) + ' / ' + ease.lenB_mm.toFixed(0) + ' mm · ease ' + ease.easePct.toFixed(1) + '%'; }
        } catch { text = ''; }
        spanSeamEase.textContent = text;
        spanSeamEase.dataset.warn = String(warn);
      }
    }
  }

  function refresh() {
    if (destroyed) return;
    const doc = store.get();
    renderPieces(doc);
    renderSeams(doc);
    renderIssues();
    renderFields(doc);
  }

  /** @param {any} sel */
  function setSelection(sel) {
    selection = cloneSelection(sel);
    refresh();
  }

  /** @param {any[]} list */
  function setIssues(list) {
    issues = Array.isArray(list) ? list.slice() : [];
    refresh();
  }

  offs.push(store.subscribe(() => refresh()));
  offs.push(bus.on(EVENT.SELECTION_CHANGED, (p) => setSelection(p && p.selection)));
  offs.push(bus.on(EVENT.PATTERN_ISSUES, (p) => setIssues(p && p.issues)));

  refresh();

  return {
    refresh,
    setSelection,
    setIssues,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const off of offs) { try { off(); } catch { /* ignore */ } }
      offs.length = 0;
    },
  };
}
