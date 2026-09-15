// src/pattern/selftest.js — in-browser self-test of the 2D editor (SPEC 11.12.3).
// Runs headless in the page: a detached 800x600 canvas inside an off-screen div, its own store and EventBus.

import { EventBus, EVENT } from '../core/events.js';
import { createStore } from '../core/store.js';
import { normalizeDoc } from '../core/schema.js';
import { createEditor, opSplitEdge, makeCcw } from './editor.js';
import { validateDoc } from './validate.js';
import { seamEase, seamEaseOf, formatEase, edgeLengthOf } from './seams.js';
import { hitTest } from './hit.js';
import { STYLE } from './render2d.js';

/** @typedef {import('../core/types.js').SelfTestResult} SelfTestResult */
/** @typedef {import('../core/types.js').Vec2} Vec2 */

/** @param {boolean} cond @param {string} msg */
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** @param {number} a @param {number} b @param {number} eps @param {string} msg */
function near(a, b, eps, msg) {
  if (!(Math.abs(a - b) <= eps)) throw new Error(msg + ' (got ' + a + ', want ' + b + ' ±' + eps + ')');
}

/** @returns {object} a fresh editor harness */
function makeHarness() {
  const host = document.createElement('div');
  host.setAttribute('data-pattern-selftest', '1');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:800px;height:600px;overflow:hidden;';
  document.body.appendChild(host);
  const canvas = document.createElement('canvas');
  canvas.style.width = '800px';
  canvas.style.height = '600px';
  canvas.width = 800;
  canvas.height = 600;
  host.appendChild(canvas);

  const bus = new EventBus();
  const store = createStore(normalizeDoc({ name: 'selftest' }), bus);
  const editor = createEditor(canvas, store, bus, { autoFit: false });
  editor.view.resize();
  editor.view.set({ cx: 0, cy: 0, pxPerMm: 1 });

  /** @type {string[]} */
  const labels = [];
  bus.on(EVENT.DOC_CHANGED, (c) => labels.push(c.label));

  return {
    host,
    canvas,
    bus,
    store,
    editor,
    labels,
    doc: () => store.get(),
    destroy() {
      try {
        editor.destroy();
      } catch (_e) { /* ignore */ }
      if (host.parentNode) host.parentNode.removeChild(host);
    },
  };
}

/** @param {object} h @param {number} x @param {number} y @param {object} [mods] */
function clickWorld(h, x, y, mods) {
  const s = h.editor.view.worldToScreen(x, y);
  const base = { x: s[0], y: s[1], button: 0, ...(mods || {}) };
  h.editor.injectPointer({ type: 'down', ...base });
  h.editor.injectPointer({ type: 'up', ...base });
}

/** @param {object} h @param {number} x @param {number} y @param {object} [mods] */
function moveWorld(h, x, y, mods) {
  const s = h.editor.view.worldToScreen(x, y);
  h.editor.injectPointer({ type: 'move', x: s[0], y: s[1], ...(mods || {}) });
}

/**
 * Resolves after one animation frame, or after 50 ms when frames do not run (hidden tab, headless harness),
 * so the suite always terminates.
 * @returns {Promise<void>}
 */
function frame() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
    setTimeout(finish, 50);
  });
}

/** @param {object} h @param {Vec2} from @param {Vec2} to @param {object} [mods] */
function dragWorld(h, from, to, mods) {
  const a = h.editor.view.worldToScreen(from[0], from[1]);
  const b = h.editor.view.worldToScreen(to[0], to[1]);
  const m = mods || {};
  h.editor.injectPointer({ type: 'down', x: a[0], y: a[1], button: 0, ...m });
  h.editor.injectPointer({ type: 'move', x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, ...m });
  h.editor.injectPointer({ type: 'move', x: b[0], y: b[1], ...m });
  h.editor.injectPointer({ type: 'up', x: b[0], y: b[1], button: 0, ...m });
}

/** @param {object} h @param {number} x0 @param {number} y0 @param {number} w @param {number} hh @returns {string} */
function addRect(h, x0, y0, w, hh) {
  return h.editor.addPiece([[x0, y0], [x0 + w, y0], [x0 + w, y0 + hh], [x0, y0 + hh]]);
}

/** @param {object} doc @param {string} id @returns {object} */
function pieceOf(doc, id) {
  const p = doc.pieces.find((x) => x.id === id);
  if (!p) throw new Error('piece ' + id + ' is gone');
  return p;
}

/**
 * Runs every case; never throws.
 * @returns {Promise<SelfTestResult[]>}
 */
export async function runSelfTest() {
  /** @type {SelfTestResult[]} */
  const results = [];
  if (typeof document === 'undefined' || !document.body) {
    return [{ name: 'environment', pass: false, details: 'src/pattern/selftest.js needs a DOM (run it in the page)' }];
  }

  /** @param {string} name @param {(h:object) => (string|void|Promise<string|void>)} fn */
  const run = async (name, fn) => {
    let h = null;
    try {
      h = makeHarness();
      const details = await fn(h);
      results.push({ name, pass: true, details: details ? String(details) : 'ok' });
    } catch (err) {
      results.push({ name, pass: false, details: (err && err.message) ? err.message : String(err) });
    } finally {
      if (h) h.destroy();
    }
  };

  // 1 -------------------------------------------------------------------------------------------
  await run('view-roundtrip', (h) => {
    const view = h.editor.view;
    assert(view.get().width === 800, 'canvas CSS width is ' + view.get().width + ', expected 800');
    view.set({ cx: 50, cy: 50, pxPerMm: 2 });
    for (const p of [[0, 0], [100, 100], [-37.5, 12.25]]) {
      const s = view.worldToScreen(p[0], p[1]);
      const w = view.screenToWorld(s[0], s[1]);
      near(w[0], p[0], 1e-9, 'roundtrip x');
      near(w[1], p[1], 1e-9, 'roundtrip y');
    }
    const c = view.worldToScreen(50, 50);
    near(c[0], 400, 1e-9, 'centre px');
    near(c[1], 300, 1e-9, 'centre py');
    const q = view.worldToScreen(100, 100);
    near(q[0], 500, 1e-9, 'px at (100,100)');
    near(q[1], 200, 1e-9, 'py at (100,100) — y must be flipped');
    return 'transform exact';
  });

  // 2 -------------------------------------------------------------------------------------------
  await run('view-zoom-anchor', (h) => {
    const view = h.editor.view;
    view.set({ cx: 10, cy: -20, pxPerMm: 1.5 });
    const before = view.screenToWorld(100, 100);
    view.zoomBy(2, 100, 100);
    const after = view.screenToWorld(100, 100);
    near(after[0], before[0], 1e-9, 'zoom anchor x');
    near(after[1], before[1], 1e-9, 'zoom anchor y');
    view.set({ pxPerMm: 100 });
    near(view.get().pxPerMm, 20, 1e-12, 'pxPerMm clamp');
    view.set({ pxPerMm: 0.0001 });
    near(view.get().pxPerMm, 0.05, 1e-12, 'pxPerMm lower clamp');
    return 'anchored zoom + clamps';
  });

  // 3 -------------------------------------------------------------------------------------------
  await run('draw-square-ccw', (h) => {
    h.editor.setTool('draw');
    clickWorld(h, 0, 0);
    clickWorld(h, 100, 0);
    clickWorld(h, 100, 100);
    clickWorld(h, 0, 100);
    clickWorld(h, 0, 0);
    const doc = h.doc();
    assert(doc.pieces.length === 1, 'expected 1 piece, got ' + doc.pieces.length);
    const p = doc.pieces[0];
    const want = [[0, 0], [100, 0], [100, 100], [0, 100]];
    assert(p.vertices.length === 4, 'expected 4 vertices, got ' + p.vertices.length);
    for (let i = 0; i < 4; i++) {
      near(p.vertices[i][0], want[i][0], 1e-9, 'vertex ' + i + ' x');
      near(p.vertices[i][1], want[i][1], 1e-9, 'vertex ' + i + ' y');
    }
    assert(p.edges.every((e) => e.type === 'line'), 'all edges must be lines');
    assert(p.foldEdge === null, 'foldEdge must be null');
    near(p.grainline.a[0], 50, 1e-9, 'grainline x');
    assert(p.fabricId === doc.fabrics[0].id, 'fabricId must default to the first fabric');
    assert(h.editor.getTool() === 'draw', 'the draw tool stays active');
    assert(h.editor.getSelection().pieces[0] === p.id, 'the new piece is selected');
    assert(h.store.canUndo() === true, 'piece:add must be undoable');
    return 'CCW square, area 10000 mm²';
  });

  // 4 -------------------------------------------------------------------------------------------
  await run('draw-clockwise-fixed', (h) => {
    h.editor.setTool('draw');
    clickWorld(h, 0, 0);
    clickWorld(h, 0, 100);
    clickWorld(h, 100, 100);
    clickWorld(h, 100, 0);
    h.editor.confirm();
    const p = h.doc().pieces[0];
    assert(p, 'the piece was not created');
    const want = [[0, 0], [100, 0], [100, 100], [0, 100]];
    for (let i = 0; i < 4; i++) {
      near(p.vertices[i][0], want[i][0], 1e-9, 'vertex ' + i + ' x after CCW fix');
      near(p.vertices[i][1], want[i][1], 1e-9, 'vertex ' + i + ' y after CCW fix');
    }
    return 'clockwise input reversed to CCW';
  });

  // 5 -------------------------------------------------------------------------------------------
  await run('draw-reject-bowtie', (h) => {
    h.editor.setTool('draw');
    clickWorld(h, 0, 0);
    clickWorld(h, 100, 100);
    clickWorld(h, 100, 0);
    clickWorld(h, 0, 100);
    h.editor.confirm();
    assert(h.doc().pieces.length === 0, 'a self-intersecting outline must be refused');
    assert(h.editor.getTransient().drawPoints.length === 4, 'the tool stays in PLACING');
    assert(h.editor.getTransient().toolName === 'draw', 'tool unchanged');
    return 'bowtie refused, tool still placing';
  });

  // 6 -------------------------------------------------------------------------------------------
  await run('seam-api-reverse', (h) => {
    const a = addRect(h, 0, 0, 100, 100);
    const b = addRect(h, 120, 0, 100, 100);
    const id = h.editor.addSeam({ pieceId: a, edge: 1, mirror: false }, { pieceId: b, edge: 3, mirror: false });
    const doc = h.doc();
    const seam = doc.seams.find((s) => s.id === id);
    assert(seam, 'the seam was not written to the store');
    assert(seam.b.reverse === true, 'b.reverse must be true (nearest-endpoint heuristic)');
    assert(seam.a.reverse === false, 'a.reverse is always false');
    assert(seam.kind === 'plain', "kind must be 'plain'");
    near(seamEase(doc, seam).easePct, 0, 1e-9, 'ease of two 100 mm edges');
    return 'autoReverse picked reverse = true';
  });

  // 7 -------------------------------------------------------------------------------------------
  await run('seam-pointer', (h) => {
    const a = addRect(h, 0, 0, 100, 100);
    const b = addRect(h, 120, 0, 100, 100);
    /** @type {any[]} */
    const previews = [];
    h.bus.on(EVENT.SEAM_PREVIEW, (p) => previews.push(p));
    h.editor.setTool('seam');
    clickWorld(h, 100, 50);
    const t = h.editor.getTransient();
    assert(t.seamFirst && t.seamFirst.pieceId === a && t.seamFirst.edge === 1,
      'seamFirst should be {A, edge 1}, got ' + JSON.stringify(t.seamFirst));
    moveWorld(h, 120, 50);
    const last = previews[previews.length - 1];
    assert(last && last.b, 'no SEAM_PREVIEW with side b');
    near(last.lenA_mm, 100, 1e-6, 'lenA_mm');
    near(last.lenB_mm, 100, 1e-6, 'lenB_mm');
    near(last.easePct, 0, 1e-9, 'easePct');
    assert(formatEase(last) === 'A 100 mm / B 100 mm - ease 0.0%', 'formatEase: ' + formatEase(last));
    clickWorld(h, 120, 50);
    const doc = h.doc();
    assert(doc.seams.length === 1, 'expected 1 seam, got ' + doc.seams.length);
    assert(doc.seams[0].b.reverse === true, 'b.reverse must be true');
    assert(h.editor.getSelection().seams[0] === doc.seams[0].id, 'the new seam is selected');
    assert(doc.seams[0].b.pieceId === b, 'side b must be piece B');
    return '2 clicks + live preview';
  });

  // 8 -------------------------------------------------------------------------------------------
  await run('seam-refusals', (h) => {
    const a = addRect(h, 0, 0, 100, 100);
    const b = addRect(h, 120, 0, 100, 100);
    /** @param {() => void} fn @returns {string} */
    const codeOf = (fn) => {
      try {
        fn();
      } catch (err) {
        return err && err.code ? err.code : 'NO_CODE';
      }
      return 'NO_THROW';
    };
    const same = codeOf(() => h.editor.addSeam({ pieceId: a, edge: 1, mirror: false }, { pieceId: a, edge: 1, mirror: false }));
    assert(same === 'SEAM_SAME_EDGE', 'identical sides → ' + same);
    h.editor.addSeam({ pieceId: a, edge: 1, mirror: false }, { pieceId: b, edge: 3, mirror: false });
    const taken = codeOf(() => h.editor.addSeam({ pieceId: a, edge: 1, mirror: false }, { pieceId: b, edge: 1, mirror: false }));
    assert(taken === 'SEAM_EDGE_TAKEN', 'reused edge → ' + taken);
    const mir = codeOf(() => h.editor.addSeam({ pieceId: a, edge: 0, mirror: true }, { pieceId: b, edge: 0, mirror: false }));
    assert(mir === 'SEAM_MIRROR_WITHOUT_FOLD', 'mirror without fold → ' + mir);
    return 'SEAM_SAME_EDGE / SEAM_EDGE_TAKEN / SEAM_MIRROR_WITHOUT_FOLD';
  });

  // 9 -------------------------------------------------------------------------------------------
  await run('ease-format', (h) => {
    const a = addRect(h, 0, 0, 100, 312);
    const b = addRect(h, 200, 0, 100, 328);
    const ease = seamEaseOf(h.doc(), { pieceId: a, edge: 1, mirror: false }, { pieceId: b, edge: 3, mirror: false });
    assert(formatEase(ease) === 'A 312 mm / B 328 mm - ease 5.1%', 'formatEase: ' + formatEase(ease));
    near(ease.easePct, (16 / 312) * 100, 1e-9, 'easePct');
    assert(ease.longer === 'b', "longer must be 'b'");
    h.editor.addSeam({ pieceId: a, edge: 1, mirror: false }, { pieceId: b, edge: 3, mirror: false });
    const issues = validateDoc(h.doc());
    assert(!issues.some((i) => i.code === 'SEAM_EASE_HIGH'), '5.1 % must not warn');
    const c = addRect(h, 400, 0, 100, 340);
    h.editor.addSeam({ pieceId: a, edge: 3, mirror: false }, { pieceId: c, edge: 3, mirror: false });
    const issues2 = validateDoc(h.doc()).filter((i) => i.code === 'SEAM_EASE_HIGH');
    assert(issues2.length === 1, 'expected 1 SEAM_EASE_HIGH, got ' + issues2.length);
    return 'ease text + 8 % threshold';
  });

  // 10 ------------------------------------------------------------------------------------------
  await run('split-remap', (h) => {
    const a = addRect(h, 0, 0, 100, 100);
    const b = addRect(h, -150, 0, 100, 100);
    h.store.update((d) => {
      d.pieces.find((p) => p.id === a).notches.push({ edge: 2, t: 0.75, kind: 'single' });
    }, 'notch:add');
    const seamId = h.editor.addSeam({ pieceId: a, edge: 3, mirror: false }, { pieceId: b, edge: 1, mirror: false });
    h.editor.setTool('split');
    clickWorld(h, 100, 50);
    let doc = h.doc();
    let pa = pieceOf(doc, a);
    assert(pa.vertices.length === 5, 'expected 5 vertices, got ' + pa.vertices.length);
    near(pa.vertices[2][0], 100, 1e-6, 'new vertex x');
    near(pa.vertices[2][1], 50, 1e-6, 'new vertex y');
    assert(pa.notches[0].edge === 3, 'notch edge must shift 2 → 3, got ' + pa.notches[0].edge);
    near(pa.notches[0].t, 0.75, 1e-9, 'notch t unchanged');
    const seam = doc.seams.find((s) => s.id === seamId);
    assert(seam && seam.a.edge === 4, 'seam side a must shift 3 → 4, got ' + (seam && seam.a.edge));
    assert(h.store.canUndo(), 'the split must be undoable');
    h.store.undo();
    doc = h.doc();
    pa = pieceOf(doc, a);
    assert(pa.vertices.length === 4, 'undo must restore 4 vertices');
    assert(doc.seams.find((s) => s.id === seamId).a.edge === 3, 'undo must restore the seam edge');
    return 'split shifts notches, seams and vertex indices';
  });

  // 11 ------------------------------------------------------------------------------------------
  await run('split-notch-t', (h) => {
    const id = addRect(h, 0, 0, 100, 100);
    const piece = pieceOf(h.doc(), id);
    const p1 = JSON.parse(JSON.stringify(piece));
    p1.notches = [{ edge: 1, t: 0.25, kind: 'single' }];
    const r1 = opSplitEdge(p1, 1, 0.5);
    assert(r1.piece.notches[0].edge === 1, 'notch stays on edge 1, got ' + r1.piece.notches[0].edge);
    near(r1.piece.notches[0].t, 0.5, 1e-9, 'notch t = 0.25/0.5');
    const p2 = JSON.parse(JSON.stringify(piece));
    p2.notches = [{ edge: 1, t: 0.75, kind: 'single' }];
    const r2 = opSplitEdge(p2, 1, 0.5);
    assert(r2.piece.notches[0].edge === 2, 'notch moves to edge 2, got ' + r2.piece.notches[0].edge);
    near(r2.piece.notches[0].t, 0.5, 1e-9, 'notch t = (0.75-0.5)/0.5');
    return 'notch re-parametrisation';
  });

  // 12 ------------------------------------------------------------------------------------------
  await run('edit-vertex-drag', (h) => {
    const id = addRect(h, 0, 0, 100, 100);
    h.editor.setTool('edit');
    dragWorld(h, [100, 100], [130, 120]);
    const p = pieceOf(h.doc(), id);
    near(p.vertices[2][0], 130, 1e-9, 'vertex x after drag');
    near(p.vertices[2][1], 120, 1e-9, 'vertex y after drag');
    assert(h.labels[h.labels.length - 1] === 'vertex:move', 'last label: ' + h.labels[h.labels.length - 1]);
    h.editor.nudge(1, 0);
    const p2 = pieceOf(h.doc(), id);
    near(p2.vertices[2][0], 131, 1e-9, 'vertex x after nudge');
    near(p2.vertices[2][1], 120, 1e-9, 'vertex y after nudge');
    return 'one undoable vertex:move per drag';
  });

  // 13 ------------------------------------------------------------------------------------------
  await run('edit-toggle-cubic', (h) => {
    const id = addRect(h, 0, 0, 100, 100);
    const len0 = edgeLengthOf(pieceOf(h.doc(), id), 0);
    h.editor.setTool('edit');
    const s = h.editor.view.worldToScreen(50, 0);
    h.editor.injectPointer({ type: 'dblclick', x: s[0], y: s[1], button: 0 });
    let p = pieceOf(h.doc(), id);
    assert(p.edges[0].type === 'cubic', 'edge 0 must become cubic, got ' + p.edges[0].type);
    near(p.edges[0].c1[0], 100 / 3, 1e-6, 'c1 x');
    near(p.edges[0].c1[1], 0, 1e-6, 'c1 y');
    near(p.edges[0].c2[0], 200 / 3, 1e-6, 'c2 x');
    near(edgeLengthOf(p, 0), len0, 1e-6, 'the shape must not change');
    h.editor.injectPointer({ type: 'dblclick', x: s[0], y: s[1], button: 0 });
    p = pieceOf(h.doc(), id);
    assert(p.edges[0].type === 'line', 'edge 0 must become a line again');
    assert(p.edges[0].c1 === undefined && p.edges[0].c2 === undefined, 'c1/c2 must be deleted');
    return 'line ↔ cubic keeps the shape';
  });

  // 14 ------------------------------------------------------------------------------------------
  await run('edit-insert-delete', (h) => {
    const id = addRect(h, 0, 0, 100, 100);
    h.editor.setTool('edit');
    const s = h.editor.view.worldToScreen(50, 0);
    h.editor.injectPointer({ type: 'down', x: s[0], y: s[1], button: 0, alt: true });
    h.editor.injectPointer({ type: 'up', x: s[0], y: s[1], button: 0, alt: true });
    assert(pieceOf(h.doc(), id).vertices.length === 5, 'alt-click must insert a vertex');
    assert(h.editor.getSelection().vertex.index === 1, 'the inserted vertex is selected');
    h.editor.deleteSelection();
    assert(pieceOf(h.doc(), id).vertices.length === 4, 'delete must remove the vertex again');
    const tri = h.editor.addPiece([[200, 0], [300, 0], [250, 100]]);
    h.editor.select({ pieces: [tri], vertex: 0 });
    h.editor.deleteSelection();
    assert(pieceOf(h.doc(), tri).vertices.length === 3, 'a triangle keeps its 3 vertices');
    return 'insert / delete with the 3-vertex floor';
  });

  // 15 ------------------------------------------------------------------------------------------
  await run('fold-set', (h) => {
    const id = addRect(h, 50, 0, 100, 100);
    h.editor.select({ pieces: [id], edge: 3 });
    h.editor.mirror();
    let p = pieceOf(h.doc(), id);
    assert(p.vertices.every((v) => v[0] >= -1e-9 && v[0] <= 100 + 1e-9), 'the piece must land in x ∈ [0,100]');
    assert(p.foldEdge === 3, 'foldEdge must be 3, got ' + p.foldEdge);
    assert(p.edges[3].allowance_mm === 0, 'the fold edge allowance must be 0');
    assert(p.grade.anchorX === 'fold', "grade.anchorX must be 'fold'");
    h.editor.mirror();
    p = pieceOf(h.doc(), id);
    assert(p.foldEdge === null, 'the second call clears the fold');

    const id2 = h.editor.addPiece([[-150, 0], [-50, 0], [-50, 100], [-150, 100]]);
    h.editor.select({ pieces: [id2], edge: 1 });
    h.editor.mirror();
    const q = pieceOf(h.doc(), id2);
    assert(q.foldEdge === 2, 'reflected fold edge must be 2, got ' + q.foldEdge);
    near(q.vertices[2][0], 0, 1e-9, 'vertices[2].x on the fold');
    near(q.vertices[3][0], 0, 1e-9, 'vertices[3].x on the fold');
    assert(q.vertices.every((v) => v[0] >= -1e-9 && v[0] <= 100 + 1e-9), 'the reflected piece must land in x ∈ [0,100]');
    return 'fold set, reflected and cleared';
  });

  // 16 ------------------------------------------------------------------------------------------
  await run('hit-test', (h) => {
    const id = addRect(h, 0, 0, 100, 100);
    h.editor.view.set({ cx: 50, cy: 50, pxPerMm: 2 });
    h.editor.select({ pieces: [id] });
    const doc = h.doc();
    const view = h.editor.view;
    const sel = h.editor.getSelection();
    const v1 = view.worldToScreen(100, 0);
    const hv = hitTest(doc, view, v1[0] + 5, v1[1], { selection: sel, tool: 'select' });
    assert(hv && hv.kind === 'vertex' && hv.index === 1, 'expected vertex 1, got ' + JSON.stringify(hv));
    const mid = view.worldToScreen(100, 50);
    const he = hitTest(doc, view, mid[0] + 4, mid[1], { selection: { pieces: [], seams: [], vertex: null, edge: null }, tool: 'select' });
    assert(he && he.kind === 'edge' && he.index === 1, 'expected edge 1, got ' + JSON.stringify(he));
    near(he.t, 0.5, 0.02, 'edge fraction');
    const inside = view.worldToScreen(50, 50);
    const hp = hitTest(doc, view, inside[0], inside[1], { selection: { pieces: [], seams: [], vertex: null, edge: null }, tool: 'select' });
    assert(hp && hp.kind === 'piece', 'expected a piece hit, got ' + JSON.stringify(hp));
    const out = view.worldToScreen(100, 50);
    const hn = hitTest(doc, view, out[0] + 30, out[1], { selection: sel, tool: 'select' });
    assert(hn === null, 'expected null 30 px outside, got ' + JSON.stringify(hn));
    return 'vertex / edge / piece / miss';
  });

  // 17 ------------------------------------------------------------------------------------------
  await run('hit-test-mirror', (h) => {
    const id = addRect(h, 0, 0, 100, 100);
    h.editor.select({ pieces: [id], edge: 3 });
    h.editor.mirror();
    const doc = h.doc();
    assert(pieceOf(doc, id).foldEdge === 3, 'the fold was not set');
    const view = h.editor.view;
    const mid = view.worldToScreen(-100, 50);
    const hit = hitTest(doc, view, mid[0], mid[1], { selection: { pieces: [], seams: [], vertex: null, edge: null }, tool: 'select' });
    assert(hit && hit.kind === 'edge' && hit.mirror === true, 'the ghost edge must report mirror:true, got ' + JSON.stringify(hit));
    assert(hit.index === 1, 'the ghost of edge 1, got ' + hit.index);
    return 'mirrored ghost is hit-testable';
  });

  // 18 ------------------------------------------------------------------------------------------
  await run('validate', (h) => {
    const fabricId = h.doc().fabrics[0].id;
    h.store.update((d) => {
      d.pieces.push({ id: 'bowtie', name: 'Bowtie', vertices: [[0, 0], [100, 100], [100, 0], [0, 100]], fabricId });
      d.pieces.push({
        id: 'foldbad', name: 'FoldBad', fabricId, foldEdge: 3,
        vertices: [[5, 0], [105, 0], [105, 100], [5, 100]],
      });
      d.pieces.push({ id: 'lonely', name: 'Lonely', fabricId, vertices: [[300, 0], [400, 0], [400, 100], [300, 100]] });
      d.pieces.push({
        id: 'coarse', name: 'Coarse', fabricId, meshSpacing_mm: 50,
        vertices: [[500, 0], [600, 0], [600, 100], [500, 100]],
      });
    }, 'piece:add');
    const issues = validateDoc(h.doc());
    /** @param {string} code @param {string} pieceId @returns {boolean} */
    const has = (code, pieceId) => issues.some((i) => i.code === code && i.pieceId === pieceId);
    assert(has('PIECE_SELF_INTERSECTING', 'bowtie'), 'PIECE_SELF_INTERSECTING missing');
    assert(issues.some((i) => i.code === 'PIECE_SELF_INTERSECTING' && i.level === 'error'), 'it must be an error');
    assert(has('FOLD_EDGE_NOT_VERTICAL', 'foldbad'), 'FOLD_EDGE_NOT_VERTICAL missing');
    assert(has('EDGES_UNSEWN', 'lonely'), 'EDGES_UNSEWN missing');
    assert(has('MESH_SPACING_RANGE', 'coarse'), 'MESH_SPACING_RANGE missing');
    const fromEditor = h.editor.getIssues();
    assert(fromEditor.length === issues.length, 'editor.getIssues() must agree with validateDoc');
    return issues.length + ' issues found';
  });

  // 19 ------------------------------------------------------------------------------------------
  await run('notch-tool', (h) => {
    const id = addRect(h, 0, 0, 100, 100);
    h.editor.setTool('notch');
    clickWorld(h, 50, 0, { shift: true });
    let p = pieceOf(h.doc(), id);
    assert(p.notches.length === 1, 'expected 1 notch, got ' + p.notches.length);
    assert(p.notches[0].edge === 0, 'notch edge must be 0, got ' + p.notches[0].edge);
    near(p.notches[0].t, 0.5, 0.02, 'notch t');
    assert(p.notches[0].kind === 'double', 'Shift makes a double notch');
    h.editor.deleteSelection();
    p = pieceOf(h.doc(), id);
    assert(p.notches.length === 0, 'delete must remove the notch');
    return 'add / delete a double notch';
  });

  // 20 ------------------------------------------------------------------------------------------
  await run('grainline-tool', (h) => {
    const id = addRect(h, 0, 0, 100, 100);
    h.editor.setTool('grainline');
    dragWorld(h, [30, 20], [30, 80]);
    const p = pieceOf(h.doc(), id);
    near(p.grainline.a[0], 30, 1e-9, 'a.x');
    near(p.grainline.a[1], 20, 1e-9, 'a.y');
    near(p.grainline.b[0], 30, 1e-9, 'b.x');
    near(p.grainline.b[1], 80, 1e-9, 'b.y');
    assert(h.labels[h.labels.length - 1] === 'grainline:set', 'last label: ' + h.labels[h.labels.length - 1]);
    return 'grainline drag';
  });

  // 21 ------------------------------------------------------------------------------------------
  await run('select-move-undo', (h) => {
    const id = addRect(h, 0, 0, 100, 100);
    const before = JSON.parse(JSON.stringify(pieceOf(h.doc(), id).vertices));
    const undoBefore = h.store.history().undo.length;
    h.editor.setTool('select');
    dragWorld(h, [50, 50], [80, 70]);
    let p = pieceOf(h.doc(), id);
    for (let i = 0; i < 4; i++) {
      near(p.vertices[i][0], before[i][0] + 30, 1e-9, 'vertex ' + i + ' x');
      near(p.vertices[i][1], before[i][1] + 20, 1e-9, 'vertex ' + i + ' y');
    }
    assert(h.store.history().undo.length === undoBefore + 1, 'a drag must create exactly ONE undo entry');
    assert(h.labels[h.labels.length - 1] === 'piece:move', 'last label: ' + h.labels[h.labels.length - 1]);
    h.store.undo();
    p = pieceOf(h.doc(), id);
    near(p.vertices[0][0], before[0][0], 1e-9, 'undo restores x');
    h.store.redo();
    p = pieceOf(h.doc(), id);
    near(p.vertices[0][0], before[0][0] + 30, 1e-9, 'redo re-applies');
    return 'one undoable piece:move per drag';
  });

  // 22 ------------------------------------------------------------------------------------------
  await run('render-smoke', async (h) => {
    /** @type {any[]} */
    const warnings = [];
    h.bus.on(EVENT.UI_STATUS, (m) => {
      if (m.level !== 'info') warnings.push(m);
    });
    let doc = null;
    try {
      const samples = await import('../samples/index.js');
      doc = samples.getSample('tshirt');
    } catch (_e) {
      doc = null;
    }
    if (doc) h.store.replace(doc, 'Load sample: tshirt');
    else addRect(h, 0, 0, 200, 300);
    h.editor.view.fitToPieces();
    h.editor.renderNow();
    assert(!warnings.some((m) => /render failed/.test(m.text)), 'render error: ' + JSON.stringify(warnings[0]));

    const ctx = h.canvas.getContext('2d');
    const dpr = h.editor.view.get().dpr;
    // Probe whether this canvas really rasterises (a stubbed 2D context does not).
    let raster = false;
    try {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(0, 0, 2, 2);
      const probe = ctx.getImageData(0, 0, 1, 1).data;
      raster = probe[0] === 255 && probe[1] === 0 && probe[2] === 255;
      ctx.restore();
    } catch (_e) {
      raster = false;
    }
    if (!raster) return (doc ? 'tshirt' : 'fallback rect') + ' rendered without errors (canvas raster not readable here)';
    h.editor.renderNow();
    let painted = 0;
    for (let gx = 1; gx <= 7; gx++) {
      for (let gy = 1; gy <= 5; gy++) {
        const px = Math.round((gx / 8) * 800 * dpr);
        const py = Math.round((gy / 6) * 600 * dpr);
        const d = ctx.getImageData(px, py, 1, 1).data;
        const hex = '#' + [d[0], d[1], d[2]].map((c) => c.toString(16).padStart(2, '0')).join('');
        if (hex !== STYLE.bg) painted++;
      }
    }
    assert(painted > 0, 'the canvas shows only the background colour');
    return (doc ? 'tshirt' : 'fallback rect') + ': ' + painted + '/35 sampled pixels painted';
  });

  // 23 ------------------------------------------------------------------------------------------
  await run('events', (h) => {
    /** @type {any[]} */
    const toolEvents = [];
    /** @type {any[]} */
    const selEvents = [];
    /** @type {any[]} */
    const viewEvents = [];
    h.bus.on(EVENT.TOOL_CHANGED, (p) => toolEvents.push(p));
    h.bus.on(EVENT.SELECTION_CHANGED, (p) => selEvents.push(p));
    h.bus.on(EVENT.VIEW2D_CHANGED, (p) => viewEvents.push(p));

    const id = addRect(h, 0, 0, 100, 100);
    h.editor.setTool('edit');
    h.editor.setTool('edit');
    h.editor.setTool('seam');
    h.editor.setTool('select');
    assert(toolEvents.length === 3, 'expected 3 tool:changed, got ' + toolEvents.length);
    assert(toolEvents[0].tool === 'edit' && toolEvents[0].prev === 'select', 'first tool:changed payload');
    assert(h.store.transient.tool === 'select', 'store.transient.tool must mirror the editor');

    h.editor.select({ pieces: [id] });
    h.editor.select({ pieces: ['does-not-exist'] });
    const known = new Set(h.doc().pieces.map((p) => p.id));
    for (const ev of selEvents) {
      for (const pid of ev.selection.pieces) assert(known.has(pid), 'selection:changed carried an unknown id ' + pid);
    }
    assert(h.editor.getSelection().pieces.length === 0, 'unknown ids are dropped');

    h.editor.view.zoomBy(2, 100, 100);
    assert(viewEvents.length > 0, 'view2d:changed was not emitted');
    const v = viewEvents[viewEvents.length - 1];
    assert(Array.isArray(v.panMm) && v.width === 800, 'view2d:changed payload: ' + JSON.stringify(v));

    let badTool = 'NO_THROW';
    try {
      h.editor.setTool('nope');
    } catch (err) {
      badTool = err.code;
    }
    assert(badTool === 'PATTERN_BAD_TOOL', 'unknown tool → ' + badTool);
    return 'tool / selection / view events';
  });

  // 24 ------------------------------------------------------------------------------------------
  await run('makeCcw-and-ops', (h) => {
    const cw = makeCcw([[0, 0], [0, 100], [100, 100], [100, 0]], [{ type: 'line' }, { type: 'line' }, { type: 'line' }, { type: 'line' }]);
    const want = [[0, 0], [100, 0], [100, 100], [0, 100]];
    for (let i = 0; i < 4; i++) {
      near(cw.vertices[i][0], want[i][0], 1e-9, 'makeCcw vertex ' + i + ' x');
      near(cw.vertices[i][1], want[i][1], 1e-9, 'makeCcw vertex ' + i + ' y');
    }
    const id = addRect(h, 0, 0, 100, 100);
    h.editor.setTool('select');
    h.editor.select({ pieces: [id] });
    h.editor.nudge(-5, 7);
    const p = pieceOf(h.doc(), id);
    near(p.vertices[0][0], -5, 1e-9, 'nudge x');
    near(p.vertices[0][1], 7, 1e-9, 'nudge y');
    near(p.grainline.a[0], 50 - 5, 1e-9, 'the grainline moves with the piece');
    h.editor.deleteSelection();
    assert(h.doc().pieces.length === 0, 'deleteSelection must remove the piece');
    return 'makeCcw, nudge, delete';
  });

  // 25 ------------------------------------------------------------------------------------------
  await run('hover-and-destroy', async (h) => {
    const id = addRect(h, 0, 0, 100, 100);
    /** @type {any[]} */
    const hovers = [];
    /** @type {any[]} */
    const events = [];
    const unsub = h.editor.onHover((hit) => hovers.push(hit));
    h.bus.on(EVENT.HOVER_CHANGED, (p) => events.push(p));
    moveWorld(h, 50, 50);
    await frame();
    assert(hovers.length > 0 && hovers[hovers.length - 1] && hovers[hovers.length - 1].pieceId === id,
      'onHover did not report the piece');
    assert(events.length > 0, 'hover:changed was not emitted');
    const last = events[events.length - 1];
    near(last.mm[0], 50, 1e-6, 'hover mm x');
    near(last.mm[1], 50, 1e-6, 'hover mm y');
    assert(last.pieceId === id, 'hover payload pieceId');
    unsub();
    h.editor.injectPointer({ type: 'leave', x: 0, y: 0 });
    const afterLeave = events[events.length - 1];
    assert(afterLeave.mm === null, 'leaving the canvas must send mm: null');
    const before = hovers.length;
    moveWorld(h, 20, 20);
    assert(hovers.length === before, 'unsubscribe must stop the callbacks');
    h.editor.destroy();
    moveWorld(h, 60, 60);
    assert(h.doc().pieces.length === 1, 'a destroyed editor must be inert');
    return 'hover payload, unsubscribe, destroy';
  });

  return results;
}
