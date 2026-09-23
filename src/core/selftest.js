// src/core/selftest.js — self-checks of the core contracts (SPEC sections 3.2.1, 3.3.8, 3.4.5, 3.5.3, 3.6, 3.7.3).
// export async function runSelfTest(): Promise<SelfTestResult[]>. Touches no DOM and no app state; uses its own bus.

import { EventBus, EVENT } from './events.js';
import { createStore, diffHints, HISTORY_LIMIT, makeTransient } from './store.js';
import {
  normalizeDoc, serializeDoc, parseDoc, validateShape, migrate, stableStringify, DEFAULT_BODY_PARAMS,
} from './schema.js';
import {
  mmToM, mToMm, cmToMm, mmToCm, cmToM, fmtMm, fmtCm, PAPER, printableArea, tileStep, tileCount,
} from './units.js';
import { uid, hashString, resetUidCounter, seedUidRandom } from './ids.js';
import {
  FABRIC_PRESETS, FABRIC_PRESET_IDS, TEXTURE_KINDS, PHYSICS_KEYS, getPreset, isHexColor, resolveFabric,
  diffResolved, mixHex,
} from './fabrics.js';
import {
  makeSphereGrid, makeCapsuleGrid, sampleSdf, sphereDistance, gridContains, gridIndex, SDF_OUTSIDE,
} from './sdf.js';

/** @typedef {import('./types.js').SelfTestResult} SelfTestResult */
/** @typedef {import('./types.js').ProjectDoc} ProjectDoc */

// ---------------------------------------------------------------------------------------------------------
// tiny harness
// ---------------------------------------------------------------------------------------------------------

/** @param {boolean} cond @param {string} msg */
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
/** @param {number} a @param {number} b @param {number} tol @returns {boolean} */
function near(a, b, tol) {
  return Math.abs(a - b) <= tol;
}
/** @param {*} a @param {*} b @returns {boolean} */
function deepEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}
/** @returns {number} */
function nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

/**
 * Run fn with console.error silenced (the bus logs isolated listener errors by contract).
 * @template T @param {() => T} fn @returns {T}
 */
function quietly(fn) {
  const orig = console.error;
  console.error = function noop() {};
  try {
    return fn();
  } finally {
    console.error = orig;
  }
}

/** @param {number} seed @returns {() => number} deterministic LCG in [0, 1) */
function makeLcg(seed) {
  let state = (seed >>> 0) || 1;
  return function next() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------------------------------------

/** @returns {object} a small valid partial document: one fold piece with a cubic edge, one triangle, one seam */
function fixtureDoc() {
  return {
    version: 1,
    name: 'Fixture',
    pieces: [
      {
        id: 'sq', name: 'Square',
        vertices: [[0, 0], [100, 0], [100, 100], [0, 100]],
        edges: [{ type: 'line' }, { type: 'cubic', c1: [110, 30], c2: [110, 70] }, { type: 'line' }, { type: 'line', allowance_mm: 0 }],
        foldEdge: 3,
        notches: [{ edge: 1, t: 0.5, kind: 'single' }],
      },
      {
        id: 'tri', name: 'Triangle',
        vertices: [[0, 0], [100, 0], [50, 80]],
      },
    ],
    seams: [
      { id: 's1', kind: 'plain', a: { pieceId: 'sq', edge: 0, mirror: false, reverse: false }, b: { pieceId: 'tri', edge: 0, mirror: false, reverse: false } },
    ],
  };
}

/**
 * Load the built-in samples when src/samples exists; otherwise fall back to the fixture.
 * @returns {Promise<{docs: {id:string, doc:object}[], note:string}>}
 */
async function loadSamples() {
  try {
    const mod = await import('../samples/index.js');
    /** @type {{id:string, doc:object}[]} */
    const docs = [];
    for (const id of ['tshirt', 'skirt']) {
      let doc = null;
      if (typeof mod.getSample === 'function') doc = mod.getSample(id);
      else if (Array.isArray(mod.SAMPLES)) {
        const s = mod.SAMPLES.find((x) => x && x.id === id);
        doc = s ? s.doc : null;
      } else if (id === 'tshirt' && mod.TSHIRT) doc = mod.TSHIRT;
      else if (id === 'skirt' && mod.SKIRT) doc = mod.SKIRT;
      if (doc) docs.push({ id, doc });
    }
    if (docs.length > 0) return { docs, note: 'samples: ' + docs.map((d) => d.id).join(', ') };
  } catch (_e) {
    // samples not available yet
  }
  return { docs: [{ id: 'fixture', doc: fixtureDoc() }], note: 'samples unavailable, fixture used' };
}

// ---------------------------------------------------------------------------------------------------------
// runSelfTest
// ---------------------------------------------------------------------------------------------------------

/** @returns {Promise<SelfTestResult[]>} */
export async function runSelfTest() {
  /** @type {SelfTestResult[]} */
  const results = [];
  /**
   * @param {string} name @param {() => (string|void|Promise<string|void>)} fn
   */
  async function check(name, fn) {
    const t0 = nowMs();
    try {
      const details = await fn();
      results.push({ name, pass: true, details: (details || 'ok') + ' [' + (nowMs() - t0).toFixed(1) + ' ms]' });
    } catch (e) {
      results.push({ name, pass: false, details: (e && e.message) ? e.message : String(e) });
    }
  }

  const samples = await loadSamples();

  // ---- events ----------------------------------------------------------------------------------------
  await check('events/unknown-name', () => {
    const b = new EventBus();
    let code = null;
    try { b.emit('nope', {}); } catch (e) { code = e.code; }
    assert(code === 'UnknownEvent', 'emit of unknown name must throw UnknownEvent, got ' + code);
    code = null;
    try { b.on('nope', () => {}); } catch (e) { code = e.code; }
    assert(code === 'UnknownEvent', 'on of unknown name must throw UnknownEvent');
    const lax = new EventBus({ strict: false });
    assert(lax.emit('anything', {}) === 0, 'non-strict bus accepts unknown names');
    assert(Object.isFrozen(EVENT) && Object.values(EVENT).length === 24, 'EVENT table frozen with 24 names');
  });

  await check('events/isolation', () => quietly(() => {
    const b = new EventBus();
    const order = [];
    const statuses = [];
    b.on(EVENT.UI_STATUS, (p) => statuses.push(p));
    b.on(EVENT.DOC_CHANGED, () => order.push(1));
    b.on(EVENT.DOC_CHANGED, () => { order.push(2); throw new Error('boom'); });
    b.on(EVENT.DOC_CHANGED, () => order.push(3));
    const n = b.emit(EVENT.DOC_CHANGED, { label: 'x' });
    assert(n === 2, 'emit returns listeners that did not throw, got ' + n);
    assert(order.join(',') === '1,2,3', 'listeners run in order despite a throw: ' + order.join(','));
    assert(b.errorCount === 1 && b.errors.length === 1 && b.errors[0].name === EVENT.DOC_CHANGED, 'error recorded');
    assert(statuses.length === 1 && statuses[0].level === 'error' && statuses[0].source === 'bus'
      && statuses[0].text.indexOf('boom') >= 0, 'ui:status emitted once with the error text');
    // a throwing ui:status listener is only logged (no recursion)
    b.on(EVENT.UI_STATUS, () => { throw new Error('status boom'); });
    b.emit(EVENT.UI_STATUS, { level: 'info', text: 'hi' });
    assert(b.errorCount === 2, 'ui:status listener error logged without re-emit');
    for (let i = 0; i < 30; i++) b.emit(EVENT.UI_STATUS, { level: 'info', text: String(i) });
    assert(b.errors.length === 20, 'error ring buffer capped at 20, got ' + b.errors.length);
    assert(b.errorCount === 32, 'errorCount keeps counting: ' + b.errorCount);
    return 'errorCount ' + b.errorCount;
  }));

  await check('events/once-off-snapshot', () => {
    const b = new EventBus();
    let onceCalls = 0;
    b.once(EVENT.TOOL_CHANGED, () => onceCalls++);
    b.emit(EVENT.TOOL_CHANGED, {});
    b.emit(EVENT.TOOL_CHANGED, {});
    assert(onceCalls === 1, 'once fires exactly once, got ' + onceCalls);
    assert(b.listenerCount(EVENT.TOOL_CHANGED) === 0, 'once listener removed');
    let calls = 0;
    const fn = () => calls++;
    const unsub = b.on(EVENT.TOOL_CHANGED, fn);
    b.emit(EVENT.TOOL_CHANGED, {});
    unsub();
    unsub();
    b.off(EVENT.TOOL_CHANGED, fn);
    b.emit(EVENT.TOOL_CHANGED, {});
    assert(calls === 1, 'unsubscribe idempotent, got ' + calls);
    // snapshot: a listener added during emit does not run in that emit
    let late = 0;
    b.on(EVENT.TOOL_CHANGED, () => { b.on(EVENT.TOOL_CHANGED, () => late++); });
    b.emit(EVENT.TOOL_CHANGED, {});
    assert(late === 0, 'listener added during emit must not run in the same emit');
    b.emit(EVENT.TOOL_CHANGED, {});
    assert(late === 1, 'listener added during a previous emit runs next time');
    b.clear();
    assert(b.listenerCount(EVENT.TOOL_CHANGED) === 0, 'clear removes everything');
  });

  // ---- store -----------------------------------------------------------------------------------------
  await check('store/create-and-rename', () => {
    const b = new EventBus();
    const s = createStore(normalizeDoc({}), b);
    assert(s.get().version === 1 && s.canUndo() === false, 'fresh store: version 1, nothing to undo');
    assert(deepEqual(s.transient, makeTransient()), 'transient defaults');
    const events = [];
    b.on(EVENT.DOC_CHANGED, (p) => events.push(p));
    const before = s.get();
    s.update((d) => { d.name = 'x'; }, 'rename');
    assert(events.length === 1, 'exactly one doc:changed, got ' + events.length);
    const keys = Object.keys(events[0]).filter((k) => !['label', 'origin', 'doc', 'warnings'].includes(k));
    assert(keys.join(',') === 'name', 'only the name hint, got ' + keys.join(','));
    assert(events[0].origin === 'update' && events[0].doc === s.get() && s.get() !== before, 'payload doc is the new current');
    assert(s.canUndo() === true && s.revision === 1, 'undo available');
    assert(s.undo() === true && s.get().name === 'Untitled' && events[1].origin === 'undo' && events[1].label === 'Undo: rename', 'undo restores');
    assert(s.redo() === true && s.get().name === 'x' && events[2].origin === 'redo', 'redo re-applies');
    assert(s.canRedo() === false && s.canUndo() === true, 'stacks after redo');
    return 'revision ' + s.revision;
  });

  await check('store/ui-not-undoable', () => {
    const b = new EventBus();
    const s = createStore(normalizeDoc({}), b);
    const events = [];
    b.on(EVENT.DOC_CHANGED, (p) => events.push(p));
    s.update((d) => { d.ui.split = 0.3; }, 'split');
    assert(events.length === 1 && events[0].ui === true, 'ui hint');
    const keys = Object.keys(events[0]).filter((k) => !['label', 'origin', 'doc', 'warnings'].includes(k));
    assert(keys.join(',') === 'ui', 'only ui hint, got ' + keys.join(','));
    assert(s.canUndo() === false, 'ui-only change creates no undo entry');
    assert(s.get().ui.split === 0.3, 'value applied');
    const same = s.get();
    const r = s.update((d) => { d.ui.split = 0.3; }, 'noop');
    assert(r === same && events.length === 1, 'no-op update emits nothing and returns the same reference');
  });

  await check('store/validation-error', () => {
    const b = new EventBus();
    const s = createStore(fixtureDoc(), b);
    let emits = 0;
    b.on(EVENT.DOC_CHANGED, () => emits++);
    const before = s.get();
    let err = null;
    try { s.update((d) => { d.pieces[0].vertices = []; }, 'break'); } catch (e) { err = e; }
    assert(err && err.code === 'ValidationError' && Array.isArray(err.issues), 'ValidationError with issues');
    assert(err.issues.some((i) => i.code === 'PieceVertices'), 'PieceVertices issue reported');
    assert(s.get() === before && emits === 0, 'store untouched, no emit');
    let thrown = null;
    try { s.update(() => { throw new Error('mutator'); }, 'm'); } catch (e) { thrown = e; }
    assert(thrown && thrown.message === 'mutator' && s.get() === before, 'mutator error rethrown, store untouched');
  });

  await check('store/history-limit', () => {
    const s = createStore(normalizeDoc({}), new EventBus());
    for (let i = 0; i < 150; i++) s.update((d) => { d.name = 'n' + i; }, 'r' + i);
    const h = s.history();
    assert(h.undo.length === HISTORY_LIMIT && h.undo.length === 100, 'undo length ' + h.undo.length);
    assert(h.undo[0] === 'r50' && h.undo[99] === 'r149', 'oldest first: ' + h.undo[0] + '..' + h.undo[99]);
    assert(h.redo.length === 0, 'no redo');
    const custom = createStore(normalizeDoc({}), new EventBus(), { historyLimit: 5 });
    for (let i = 0; i < 10; i++) custom.update((d) => { d.name = 'n' + i; }, 'r' + i);
    assert(custom.history().undo.length === 5, 'custom limit');
  });

  await check('store/batch-commit', () => {
    const b = new EventBus();
    const s = createStore(fixtureDoc(), b);
    const origins = [];
    b.on(EVENT.DOC_CHANGED, (p) => origins.push(p.origin));
    const pre = s.get();
    const batch = s.batch('Move vertex');
    assert(batch.active === true && batch.label === 'Move vertex', 'batch active');
    let code = null;
    try { s.batch('again'); } catch (e) { code = e.code; }
    assert(code === 'BatchActive', 'second batch throws BatchActive');
    assert(s.undo() === false && s.redo() === false, 'undo/redo blocked during batch');
    for (let i = 1; i <= 30; i++) {
      const r = (i % 2 === 0)
        ? batch.update((d) => { d.pieces[0].vertices[2] = [100 + i, 100]; })
        : s.update((d) => { d.pieces[0].vertices[2] = [100 + i, 100]; }, 'nudge');
      assert(r.pieces[0].vertices[2][0] === 100 + i, 'step applied');
    }
    assert(origins.length === 30 && origins.every((o) => o === 'drag'), '30 drag emits, got ' + origins.length);
    assert(s.canUndo() === false, 'no history entry during the batch');
    batch.update((d) => { d.pieces[0].vertices = []; });
    assert(batch.lastError && batch.lastError.code === 'ValidationError', 'invalid step stored in lastError');
    assert(s.get().pieces[0].vertices.length === 4, 'invalid step rejected');
    batch.commit();
    assert(batch.active === false, 'batch ended');
    assert(origins.length === 31 && origins[30] === 'commit', 'one commit emit');
    assert(s.history().undo.length === 1 && s.history().undo[0] === 'Move vertex', 'one undo entry');
    assert(s.undo() === true && deepEqual(s.get(), pre) && s.canUndo() === false, 'undo restores the pre-batch doc in one step');
    return 'emits ' + origins.length;
  });

  await check('store/batch-cancel', () => {
    const b = new EventBus();
    const s = createStore(fixtureDoc(), b);
    s.update((d) => { d.name = 'a'; }, 'first');
    const pre = s.get();
    const undoBefore = s.history().undo.length;
    const origins = [];
    b.on(EVENT.DOC_CHANGED, (p) => origins.push(p.origin));
    const batch = s.batch('drag');
    for (let i = 1; i <= 3; i++) batch.update((d) => { d.pieces[1].vertices[2] = [50, 80 + i]; });
    batch.cancel();
    assert(s.get() === pre && deepEqual(s.get(), pre), 'doc equals the pre-batch doc');
    assert(s.history().undo.length === undoBefore && s.canUndo() === true, 'canUndo unchanged');
    assert(origins.join(',') === 'drag,drag,drag,cancel', 'origins ' + origins.join(','));
    // cancel without steps emits nothing
    const b2 = s.batch('empty');
    b2.cancel();
    assert(origins.length === 4, 'empty batch cancel emits nothing');
    // replace during a batch cancels it first
    const b3 = s.batch('open');
    b3.update((d) => { d.name = 'tmp'; });
    s.replace(fixtureDoc(), 'Load');
    assert(b3.active === false && s.get().name === 'Fixture' && s.canUndo() === false, 'replace cancels the batch and clears history');
    assert(origins[origins.length - 1] === 'replace', 'replace emits origin replace');
  });

  await check('store/undo-keeps-ui', () => {
    const s = createStore(normalizeDoc({}), new EventBus());
    s.update((d) => { d.body.params.chest_cm = 100; d.ui.dockTab = 'body'; }, 'body+ui');
    assert(s.get().body.params.chest_cm === 100 && s.get().ui.dockTab === 'body', 'applied');
    assert(s.undo() === true, 'undo');
    assert(s.get().body.params.chest_cm === 88, 'chest restored');
    assert(s.get().ui.dockTab === 'body', 'dockTab kept');
  });

  await check('store/diffHints', () => {
    const a = normalizeDoc(fixtureDoc());
    const b = structuredClone(a);
    b.pieces[1].vertices[0] = [5, 5];
    const h = diffHints(a, b);
    assert(deepEqual(h, { pieces: ['tri'] }), 'hints ' + stableStringify(h));
    assert(deepEqual(diffHints(a, a), {}), 'identical docs -> no hints');
    const c = structuredClone(a);
    c.pieces.pop();
    c.seams = [];
    c.fabrics[0].color = '#123456';
    c.sim.substeps = 12;
    const hc = diffHints(a, c);
    assert(deepEqual(hc, { pieces: ['tri'], seams: ['s1'], fabrics: ['main'], sim: true }), 'multi hints ' + stableStringify(hc));
  });

  await check('store/reference-identity', () => {
    const s = createStore(normalizeDoc({}), new EventBus());
    const a = s.get();
    assert(s.get() === a, 'same reference between updates');
    s.update((d) => { d.name = 'z'; }, 'r');
    assert(s.get() !== a && s.get().name === 'z' && a.name === 'Untitled', 'new reference after an update, old untouched');
    let subCalls = 0;
    let busCalls = 0;
    const bus2 = new EventBus();
    const s2 = createStore(normalizeDoc({}), bus2);
    s2.subscribe((ch) => { subCalls++; assert(busCalls === 0, 'subscribers run before the bus emit'); assert(ch.doc === s2.get(), 'doc'); });
    bus2.on(EVENT.DOC_CHANGED, () => busCalls++);
    s2.update((d) => { d.name = 'q'; }, 'r');
    assert(subCalls === 1 && busCalls === 1, 'subscriber and bus both called once');
  });

  // ---- schema ----------------------------------------------------------------------------------------
  await check('schema/normalize-empty', () => {
    const d = normalizeDoc({});
    const issues = validateShape(d);
    assert(issues.length === 0, 'issues: ' + stableStringify(issues));
    assert(d.fabrics.length === 1 && d.fabrics[0].id === 'main' && d.fabrics[0].preset === 'cotton', 'default fabric');
    assert(d.pieces.length === 0 && d.ui.activeSize === 'M' && d.sizes.baseSize === 'M' && d.sizes.rows.length === 4, 'defaults');
    assert(d.body.preset === 'female_m' && deepEqual(d.body.params, DEFAULT_BODY_PARAMS), 'body defaults');
    assert(deepEqual(d.sim, { substeps: 10, gravity_ms2: 9.81, selfCollision: true, sewTime_s: 1, collisionOffset_mm: 5, bendScale: 1, stretchScale: 1 }), 'sim defaults');
    assert(deepEqual(d.ui, { split: 0.5, layout: 'split', swapped: false, activeSize: 'M', dockTab: 'pieces' }), 'ui defaults');
    // piece defaults
    const p = normalizeDoc({ pieces: [{ vertices: [[0, 0], [100, 0], [100, 200]] }] }).pieces[0];
    assert(/^piece_/.test(p.id) && p.name === p.id && p.edges.length === 3 && p.fabricId === 'main', 'piece id/edges/fabric');
    assert(deepEqual(p.grainline, { a: [50, 50], b: [50, 150] }), 'grainline default ' + stableStringify(p.grainline));
    assert(deepEqual(p.placement, { anchor: 'torso', side: 'front', offset_mm: [0, 0], wrap: 1, flip: false }), 'placement');
    assert(p.meshSpacing_mm === 15 && p.seamAllowance_mm === 10 && p.layer === 0 && p.cutQty === 1, 'scalars');
  });

  await check('schema/idempotent', () => {
    const notes = [];
    for (const s of samples.docs) {
      const once = normalizeDoc(s.doc);
      const twice = normalizeDoc(once);
      assert(deepEqual(once, twice), s.id + ': normalizeDoc not idempotent');
      if (s.id !== 'fixture') assert(deepEqual(once, s.doc), s.id + ': normalizeDoc(sample) must deep-equal the sample');
      notes.push(s.id);
    }
    return samples.note;
  });

  await check('schema/serialize-roundtrip', () => {
    for (const s of samples.docs) {
      const text = serializeDoc(s.doc);
      assert(text.endsWith('\n') && text.indexOf('"body"') < text.indexOf('"fabrics"') && text.indexOf('"fabrics"') < text.indexOf('"name"'), s.id + ': sorted keys');
      const again = serializeDoc(parseDoc(text));
      assert(again === text, s.id + ': round trip differs');
      assert(text === JSON.stringify(JSON.parse(text), null, 2) + '\n', s.id + ': pretty print must match JSON.stringify(…, null, 2)');
    }
    assert(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }], u: undefined, n: NaN }) === '{"a":[1,{"c":3,"d":2}],"b":1,"n":null}', 'compact stringify');
    let code = null;
    try { parseDoc('{nope'); } catch (e) { code = e.code; }
    assert(code === 'ParseError', 'parseDoc throws ParseError');
    return samples.note;
  });

  await check('schema/validate-samples', () => {
    for (const s of samples.docs) {
      const issues = validateShape(normalizeDoc(s.doc));
      assert(issues.length === 0, s.id + ': ' + stableStringify(issues));
    }
    return samples.note;
  });

  await check('schema/sex-inference', () => {
    // `sex` arrived with the template body. A document saved before it must not load as the female default.
    const sexOf = (body) => normalizeDoc({ version: 1, body }).body.params.sex;
    assert(sexOf({ preset: 'male_m', params: { height_cm: 178 } }) === 0, 'male_m without sex must load male');
    assert(sexOf({ preset: 'athletic_m', params: {} }) === 0, 'athletic_m without sex must load male');
    assert(sexOf({ preset: 'plus_f', params: {} }) === 1, 'plus_f without sex must load female');
    assert(sexOf({ preset: 'child_10', params: {} }) === 0.5, 'child_10 without sex must load 0.5');
    assert(sexOf({ preset: 'custom', params: { bustFullness: 0.4 } }) === 1, 'custom with a bust must load female');
    assert(sexOf({ preset: 'custom', params: { bustFullness: 0 } }) === 0, 'custom, flat chest must load male');
    assert(sexOf({ preset: 'male_m', params: { sex: 0.7 } }) === 0.7, 'an explicit sex must be kept');
    assert(normalizeDoc({}).body.params.sex === DEFAULT_BODY_PARAMS.sex, 'an empty document keeps the default body');
    // v0 layout: params directly on body, sex as a letter
    const v0 = normalizeDoc({ body: { chest: 98, sex: 'm' } }).body.params;
    assert(v0.sex === 0 && v0.chest_cm === 98, 'v0 sex "m" must migrate to 0, got ' + v0.sex);
    assert(normalizeDoc({ body: { sex: 'f' } }).body.params.sex === 1, 'v0 sex "f" must migrate to 1');
    return 'presets, bust fallback, explicit value and v0 letters';
  });

  await check('schema/validate-codes', () => {
    const base = normalizeDoc(fixtureDoc());
    /** @type {[string, (d: any) => void][]} */
    const cases = [
      ['DocVersion', (d) => { d.version = 2; }],
      ['NoFabrics', (d) => { d.fabrics = []; }],
      ['DuplicateId', (d) => { d.pieces[1].id = 'sq'; }],
      ['FabricPreset', (d) => { d.fabrics[0].preset = 'nope'; }],
      ['FabricColor', (d) => { d.fabrics[0].color = 'red'; }],
      ['FabricOverrideRange', (d) => { d.fabrics[0].overrides.friction = 3; }],
      ['PieceVertices', (d) => { d.pieces[1].vertices = [[0, 0], [1, 0]]; d.pieces[1].edges = [{ type: 'line' }, { type: 'line' }]; }],
      ['PieceEdgesCount', (d) => { d.pieces[1].edges.push({ type: 'line' }); }],
      ['EdgeCubicControls', (d) => { delete d.pieces[0].edges[1].c2; }],
      ['EdgeAllowance', (d) => { d.pieces[1].seamAllowance_mm = 500; }],
      ['PieceOrientation', (d) => { d.pieces[1].vertices.reverse(); }],
      ['FoldEdgeIndex', (d) => { d.pieces[0].foldEdge = 9; }],
      ['FoldEdgeCurved', (d) => { d.pieces[0].foldEdge = 1; }],
      ['FoldEdgeAllowance', (d) => { d.pieces[0].edges[3].allowance_mm = 5; }],
      ['NotchEdge', (d) => { d.pieces[0].notches[0].edge = 7; }],
      ['NotchT', (d) => { d.pieces[0].notches[0].t = 1; }],
      ['NotchOnFold', (d) => { d.pieces[0].notches[0].edge = 3; }],
      ['GrainlineDegenerate', (d) => { d.pieces[0].grainline.b = d.pieces[0].grainline.a.slice(); }],
      ['InternalLinePoints', (d) => { d.pieces[0].internalLines.push({ kind: 'mark', points: [[1, 1]] }); }],
      ['PieceFabric', (d) => { d.pieces[0].fabricId = 'ghost'; }],
      ['PieceLayer', (d) => { d.pieces[0].layer = 7; }],
      ['PieceCutQty', (d) => { d.pieces[0].cutQty = 0; }],
      ['PinnedEdge', (d) => { d.pieces[0].pinnedEdges = [9]; }],
      ['PlacementAnchor', (d) => { d.pieces[0].placement.anchor = 'nose'; }],
      ['MeshSpacing', (d) => { d.pieces[0].meshSpacing_mm = 3; }],
      ['GradeRef', (d) => { d.pieces[0].grade.widthRef = 'shoe_cm'; }],
      ['GradeRuleVertex', (d) => { d.pieces[0].grade.vertexRules = [{ vertex: 40, dx_mm: 0, dy_mm: 0 }]; }],
      ['SeamPiece', (d) => { d.seams[0].a.pieceId = 'ghost'; }],
      ['SeamEdge', (d) => { d.seams[0].a.edge = 9; }],
      ['SeamOnFold', (d) => { d.seams[0].a.edge = 3; }],
      ['SeamMirrorNoFold', (d) => { d.seams[0].b.mirror = true; }],
      ['SeamSelf', (d) => { d.seams[0].b = { pieceId: 'sq', edge: 0, mirror: false, reverse: false }; }],
      ['SeamDuplicateSide', (d) => { d.seams.push({ id: 's2', kind: 'plain', a: { pieceId: 'sq', edge: 0, mirror: false, reverse: false }, b: { pieceId: 'tri', edge: 1, mirror: false, reverse: false } }); }],
      ['SeamSimulateMismatch', (d) => { d.pieces[1].simulate = false; }],
      ['SizesMeasurements', (d) => { d.sizes.measurements.push('shoe_cm'); }],
      ['SizesRows', (d) => { d.sizes.baseSize = 'XXL'; }],
      ['SizeCell', (d) => { d.sizes.rows[0].chest_cm = null; }],
      ['BodyParam', (d) => { d.body.params.height_cm = 10; }],
      ['SimSetting', (d) => { d.sim.substeps = 0; }],
      ['UiState', (d) => { d.ui.split = 0.99; }],
    ];
    const failed = [];
    for (const [code, mutate] of cases) {
      const d = structuredClone(base);
      mutate(d);
      const issues = validateShape(d);
      if (!issues.some((i) => i.code === code)) failed.push(code);
    }
    assert(failed.length === 0, 'codes not fired: ' + failed.join(', '));
    assert(validateShape(base).length === 0, 'fixture must be clean');
    return cases.length + ' codes';
  });

  await check('schema/migrate-v0', () => {
    const v0 = {
      schemaVersion: 0,
      name: 'Old',
      body: { preset: 'female_m', params: { height: 1.65, chest: 0.88, hips: 0.96, waist: 0.7, masculinity: 0.2, backLength: 0.4 } },
      pieces: [{
        id: 'p', vertices: [[0, 0], [100, 0], [100, 100]], edges: [{ type: 'line' }, { type: 'line' }, { type: 'line' }],
        seamAllowanceMm: 12, meshSpacingMm: 20, quantity: 2, fabricId: 'denim', color: '#3B5A86',
        placement: { anchor: 'torso', side: 'front', offsetMm: [1, 2], wrap: 1, flip: false },
        grading: { x: 'chest_cm', y: 'height_cm', xAnchor: 'center', yAnchor: 'top', vertexRules: [{ vertex: 0, dx: 1, dy: 2 }] },
        internalLines: [{ points: [[0, 0], [10, 10]] }],
      }],
      seams: [{ id: 's', a: { piece: 'p', edges: [0] }, b: { piece: 'p', edges: [1, 2] } }],
      sizeChart: {
        base: 'M', measures: ['chest', 'waist', 'hips', 'height', 'torsoLength', 'armLength'],
        table: {
          S: { chest: 840, waist: 660, hips: 920, height: 1600, torsoLength: 390, armLength: 550 },
          M: { chest: 880, waist: 700, hips: 960, height: 1650, torsoLength: 400, armLength: 560 },
        },
      },
      sim: { sewTimeS: 2, gravity: -9.81, collisionOffsetMm: 4 },
      fabricOverrides: { denim: { friction: 0.7 } },
    };
    const m = migrate(v0);
    assert(m !== v0 && v0.schemaVersion === 0, 'migrate copies');
    assert(migrate.warnings.length === 1 && /truncated/.test(migrate.warnings[0]), 'chain truncation warning: ' + stableStringify(migrate.warnings));
    const d = normalizeDoc(m);
    const issues = validateShape(d).filter((i) => i.level === 'error');
    assert(issues.length === 0, 'errors: ' + stableStringify(issues));
    assert(d.body.params.height_cm === 165 && d.body.params.chest_cm === 88 && d.body.params.torsoLength_cm === 40, 'body cm ' + stableStringify(d.body.params));
    assert(d.sizes.rows[1].chest_cm === 88 && d.sizes.rows[1].name === 'M' && d.sizes.baseSize === 'M' && d.sizes.measurements[0] === 'chest_cm', 'size rows ' + stableStringify(d.sizes));
    const p = d.pieces[0];
    assert(p.seamAllowance_mm === 12 && p.meshSpacing_mm === 20 && p.cutQty === 2 && p.placement.offset_mm[1] === 2, 'piece renames');
    assert(p.grade.widthRef === 'chest_cm' && p.grade.lengthRef === 'height_cm' && p.grade.vertexRules[0].dx_mm === 1 && p.internalLines[0].kind === 'mark', 'grade renames');
    assert(d.sim.sewTime_s === 2 && d.sim.gravity_ms2 === 9.81 && d.sim.collisionOffset_mm === 4, 'sim renames');
    assert(d.fabrics.length === 1 && d.fabrics[0].id === 'main' && d.fabrics[0].preset === 'denim' && d.fabrics[0].color === '#3b5a86'
      && d.fabrics[0].overrides.friction === 0.7 && p.fabricId === 'main', 'fabric instance ' + stableStringify(d.fabrics));
    assert(d.seams[0].a.pieceId === 'p' && d.seams[0].a.edge === 0 && d.seams[0].b.edge === 1, 'seam sides');
    let code = null;
    try { migrate({ version: 2 }); } catch (e) { code = e.code; }
    assert(code === 'UnsupportedVersion', 'version 2 -> UnsupportedVersion');
    const same = { version: 1 };
    assert(migrate(same) === same, 'version 1 returned unchanged');
  });

  // ---- units / ids -----------------------------------------------------------------------------------
  await check('units/conversions', () => {
    assert(mmToM(1500) === 1.5 && near(mToMm(0.015), 15, 1e-12) && near(cmToMm(8.8), 88, 1e-12)
      && near(mmToCm(88), 8.8, 1e-12) && near(cmToM(165), 1.65, 1e-12), 'conversions');
    assert(fmtMm(123.456) === '123.5 mm' && fmtCm(88) === '88.0 cm' && fmtMm(NaN) === '—' && fmtMm(5, 0) === '5 mm', 'formatting');
    const pa = printableArea(PAPER.A4);
    const ts = tileStep(PAPER.A4);
    assert(near(pa.w_mm, 190, 1e-9) && near(pa.h_mm, 277, 1e-9), 'printable A4');
    assert(near(ts.w_mm, 180, 1e-9) && near(ts.h_mm, 267, 1e-9), 'tile step A4');
    const tc = tileCount(PAPER.A4, 800, 1000);
    assert(tc.cols === 5 && tc.rows === 4 && tc.pages === 20, 'tileCount 800x1000: ' + stableStringify(tc));
    assert(tileCount(PAPER.A4, 100, 100).pages === 1, 'tileCount 100x100');
    assert(near(printableArea(PAPER.Letter).w_mm, 195.9, 1e-9) && near(tileStep(PAPER.A3).h_mm, 390, 1e-9), 'Letter/A3');
  });

  await check('ids/uid-hash', () => {
    const id = uid('piece');
    assert(/^piece_[0-9a-z]+[0-9a-z]{4}$/.test(id), 'uid format ' + id);
    const set = new Set();
    for (let i = 0; i < 10000; i++) set.add(uid('p'));
    assert(set.size === 10000, 'distinct ids');
    let code = null;
    try { uid('Bad Prefix'); } catch (e) { code = e.code; }
    assert(code === 'BadPrefix', 'BadPrefix');
    seedUidRandom(1);
    resetUidCounter();
    const a = uid('p');
    seedUidRandom(1);
    resetUidCounter();
    const b2 = uid('p');
    seedUidRandom(null);
    resetUidCounter(1000000); // keep later in-page ids away from the low counters used above
    assert(a === b2 && a.startsWith('p_1'), 'seeded ids reproducible: ' + a);
    assert(hashString('') === 2166136261 && hashString('a') === 3826002220 && hashString('front') === 3782859736
      && hashString('hello') === 1335831723, 'hash values');
    const long = 'x'.repeat(10000);
    hashString(long);
    const t0 = nowMs();
    hashString(long);
    const ms = nowMs() - t0;
    assert(ms < 5, 'hash of 10k chars took ' + ms.toFixed(2) + ' ms');
    return 'hash 10k chars ' + ms.toFixed(2) + ' ms';
  });

  // ---- fabrics ---------------------------------------------------------------------------------------
  await check('fabrics/presets-resolve', () => {
    assert(FABRIC_PRESET_IDS.join(',') === 'cotton,denim,silk,jersey,wool,leather,chiffon', 'ids order');
    assert(FABRIC_PRESETS.length === 7 && Object.isFrozen(FABRIC_PRESETS) && Object.isFrozen(FABRIC_PRESETS[0].physics), 'frozen presets');
    for (const p of FABRIC_PRESETS) {
      assert(isHexColor(p.look.color) && TEXTURE_KINDS.includes(p.look.texture.kind), p.id + ' look');
      for (const k of PHYSICS_KEYS) assert(Number.isFinite(p.physics[k]), p.id + ' physics ' + k);
    }
    const r = resolveFabric({ id: 'x', name: 'x', preset: 'denim', color: '#112233', texture: { kind: 'solid', scale_mm: 20, color2: '#ffffff' }, overrides: { friction: 0.9, bogus: 1, damping: NaN } });
    const denim = getPreset('denim');
    assert(r.physics.friction === 0.9, 'override applied');
    for (const k of PHYSICS_KEYS) if (k !== 'friction') assert(r.physics[k] === denim.physics[k], 'physics ' + k + ' equals preset');
    assert(r.look.color === '#112233' && r.look.texture.kind === 'solid' && r.look.roughness === denim.look.roughness, 'look');
    assert(r.physics.bogus === undefined && !Object.prototype.hasOwnProperty.call(r.physics, 'bogus'), 'non-physics override ignored');
    assert(resolveFabric({ id: 'x', name: 'x', preset: 'denim', color: '#112233', texture: { kind: 'zebra', scale_mm: 'no', color2: 'bad' }, overrides: {} }).look.texture.kind === 'twill', 'unknown texture kind falls back to the preset');
    let code = null;
    try { getPreset('nope'); } catch (e) { code = e.code; }
    assert(code === 'UnknownFabric', 'UnknownFabric');
    assert(mixHex('#000000', '#ffffff', 0.5) === '#808080', 'mixHex ' + mixHex('#000000', '#ffffff', 0.5));
    const r2 = resolveFabric({ id: 'x', name: 'x', preset: 'denim', color: '#112233', texture: { kind: 'solid', scale_mm: 20, color2: '#ffffff' }, overrides: { friction: 0.9 } });
    assert(deepEqual(diffResolved(r, r2), { physicsChanged: false, lookChanged: false }), 'diff equal');
    const r3 = resolveFabric({ id: 'x', name: 'x', preset: 'denim', color: '#112244', texture: { kind: 'solid', scale_mm: 20, color2: '#ffffff' }, overrides: { friction: 0.8 } });
    assert(deepEqual(diffResolved(r, r3), { physicsChanged: true, lookChanged: true }), 'diff changed');
  });

  // ---- sdf -------------------------------------------------------------------------------------------
  const g = makeSphereGrid([0, 0, 0], 0.5, 0.015, 0.05);
  await check('sdf/sphere-grid-shape', () => {
    assert(g.nx === 75 && g.ny === 75 && g.nz === 75, 'n = ' + g.nx);
    assert(near(g.origin[0], -0.55, 1e-12) && near(g.origin[1], -0.55, 1e-12) && near(g.origin[2], -0.55, 1e-12), 'origin');
    assert(g.data.length === 421875 && g.data instanceof Float32Array, 'data length ' + g.data.length);
    assert(gridIndex(g, 1, 2, 3) === 1 + 75 * (2 + 75 * 3), 'gridIndex');
  });

  const rnd = makeLcg(7);
  const pts = [];
  for (let i = 0; i < 1000; i++) pts.push([-0.55 + 1.1 * rnd(), -0.55 + 1.1 * rnd(), -0.55 + 1.1 * rnd()]);
  const grad = new Float32Array(3);

  await check('sdf/accuracy', () => {
    // Trilinear error of |p| grows as cell^2 / (8 R): points within 0.1 m of the centre are excluded (their
    // error legitimately exceeds 0.6 mm; see the report). Every other point must be within 0.6 mm.
    let maxErr = 0;
    let count = 0;
    for (const p of pts) {
      const r = Math.hypot(p[0], p[1], p[2]);
      if (r < 0.1) continue;
      const d = sampleSdf(g, p[0], p[1], p[2], null);
      const e = Math.abs(d - sphereDistance([0, 0, 0], 0.5, p[0], p[1], p[2], null));
      if (e > maxErr) maxErr = e;
      count++;
    }
    assert(maxErr < 0.0006, 'max error ' + (maxErr * 1000).toFixed(3) + ' mm');
    return count + ' points, max error ' + (maxErr * 1000).toFixed(3) + ' mm';
  });

  await check('sdf/gradient-direction', () => {
    // Angular error of the trilinear gradient of |p| is ~ cell / (2R): 3 degrees at R >= 0.2 m, 2 degrees at R >= 0.3 m.
    let maxAng = 0;
    let maxAngFar = 0;
    let maxNormErr = 0;
    for (const p of pts) {
      const r = Math.hypot(p[0], p[1], p[2]);
      if (r < 0.2) continue;
      sampleSdf(g, p[0], p[1], p[2], grad);
      const norm = Math.hypot(grad[0], grad[1], grad[2]);
      maxNormErr = Math.max(maxNormErr, Math.abs(norm - 1));
      const dot = (grad[0] * p[0] + grad[1] * p[1] + grad[2] * p[2]) / r;
      const ang = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
      if (ang > maxAng) maxAng = ang;
      if (r >= 0.3 && ang > maxAngFar) maxAngFar = ang;
    }
    assert(maxNormErr < 1e-6, '|grad| - 1 = ' + maxNormErr);
    assert(maxAng < 3, 'max angle ' + maxAng.toFixed(3) + ' deg at R >= 0.2');
    assert(maxAngFar < 2, 'max angle ' + maxAngFar.toFixed(3) + ' deg at R >= 0.3');
    return 'max angle ' + maxAng.toFixed(2) + ' deg (R >= 0.2), ' + maxAngFar.toFixed(2) + ' deg (R >= 0.3)';
  });

  await check('sdf/centre-outside-contains', () => {
    // The centre is not a grid node (fractional index 36.67); the trilinear value there is off by ~1 cell.
    const dc = sampleSdf(g, 0, 0, 0, null);
    assert(near(dc, -0.5, 1.5 * g.cell), 'centre value ' + dc);
    // at an exact node the value is exact (float32)
    const nx = g.origin[0] + g.cell * 36;
    const dn = sampleSdf(g, nx, nx, nx, null);
    assert(near(dn, Math.hypot(nx, nx, nx) - 0.5, 1e-6), 'node value ' + dn);
    const far = sampleSdf(g, 5, 5, 5, grad);
    assert(far === SDF_OUTSIDE && grad[0] === 0 && grad[1] === 1 && grad[2] === 0, 'outside -> 1, (0,1,0)');
    // the sampled box is [origin, origin + cell*(n-1)] = [-0.55, 0.56] (75 nodes of 15 mm), not [-0.55, 0.55]
    assert(gridContains(g, 0.55, 0, 0) === true, 'contains 0.55');
    assert(gridContains(g, 0.5599, 0, 0) === true, 'contains 0.5599 (inside the far face)');
    assert(gridContains(g, 0.5601, 0, 0) === false, 'not contains 0.5601');
    assert(gridContains(g, -0.5501, 0, 0) === false, 'not contains -0.5501');
    assert(gridContains(g, -0.55, -0.55, -0.55) === true, 'contains the origin corner');
    const corner = sampleSdf(g, 0.5599, 0.5599, 0.5599, null);
    assert(corner !== SDF_OUTSIDE && near(corner, Math.hypot(0.5599, 0.5599, 0.5599) - 0.5, 0.002), 'far corner value ' + corner);
    return 'centre ' + dc.toFixed(4);
  });

  await check('sdf/gradient-vs-finite-difference', () => {
    const eps = 1e-4;
    const fd = new Float64Array(3);
    let tested = 0;
    let maxDiff = 0;
    for (const p of pts) {
      if (tested >= 100) break;
      let onFace = false;
      for (let a = 0; a < 3; a++) {
        const f = (p[a] - g.origin[a]) / g.cell;
        const frac = f - Math.floor(f);
        if (frac < 0.1 || frac > 0.9) onFace = true;
      }
      if (onFace) continue;
      sampleSdf(g, p[0], p[1], p[2], grad);
      for (let a = 0; a < 3; a++) {
        const q = [p[0], p[1], p[2]];
        q[a] = p[a] + eps;
        const dp = sampleSdf(g, q[0], q[1], q[2], null);
        q[a] = p[a] - eps;
        const dm = sampleSdf(g, q[0], q[1], q[2], null);
        fd[a] = (dp - dm) / (2 * eps);
      }
      const n = Math.hypot(fd[0], fd[1], fd[2]);
      for (let a = 0; a < 3; a++) maxDiff = Math.max(maxDiff, Math.abs(fd[a] / n - grad[a]));
      tested++;
    }
    assert(tested >= 50, 'not enough interior points: ' + tested);
    assert(maxDiff < 1e-4, 'max |fd - analytic| = ' + maxDiff);
    return tested + ' points, max diff ' + maxDiff.toExponential(2);
  });

  await check('sdf/capsule', () => {
    const c = makeCapsuleGrid([0, -0.2, 0], [0, 0.2, 0], 0.03, 0.01, 0.02);
    assert(c.nx === 11 && c.ny === 51 && c.nz === 11, 'capsule grid ' + c.nx + 'x' + c.ny + 'x' + c.nz);
    const d0 = sampleSdf(c, 0, 0, 0, null);
    const d1 = sampleSdf(c, 0, 0.24, 0, null); // grid ends at y = 0.25; 0.24 is 0.04 from the segment end → +0.01
    assert(near(d0, -0.03, 0.001), 'centre ' + d0);
    assert(near(d1, 0.01, 0.001), 'above ' + d1);
    return 'centre ' + d0.toFixed(4) + ', above ' + d1.toFixed(4);
  });

  await check('sdf/perf', () => {
    const n = 1000000;
    let best = Infinity;
    let sink = 0;
    for (let run = 0; run < 3; run++) {
      const t0 = nowMs();
      let x = -0.4;
      for (let i = 0; i < n; i++) {
        x += 0.0000008;
        sink += sampleSdf(g, x, 0.1, -0.2, grad) + grad[1];
      }
      best = Math.min(best, nowMs() - t0);
    }
    assert(Number.isFinite(sink), 'sink');
    assert(best < 60, '1e6 samples with gradient took ' + best.toFixed(1) + ' ms (limit 60)');
    return '1e6 samples ' + best.toFixed(1) + ' ms';
  });

  return results;
}
