### 3.2 `src/core/events.js` — EventBus and the event table

`events.js` imports nothing. It exports the `EventBus` class, one shared instance `bus`, the frozen `EVENT` name table and the JSDoc typedefs of every payload. Every runtime event in the app is one of the names below; `emit` with any other name throws, so a typo is caught at the first emit rather than by silence.

#### 3.2.1 `EventBus`

```js
/**
 * Minimal synchronous pub/sub. One payload object per event, listeners called in subscription order.
 * Listener errors are isolated: a throwing listener never prevents the remaining listeners from running.
 */
export class EventBus {
  /** @param {{strict?: boolean}} [opts] strict (default true) = emit()/on() of a name not in EVENT throws Error{code:'UnknownEvent'} */
  constructor(opts)
  /**
   * @template T
   * @param {string} name        one of the EVENT values
   * @param {(payload: T, name: string) => void} fn
   * @returns {() => void}       unsubscribe function (idempotent)
   */
  on(name, fn)
  /** Same as on() but the listener is removed before its first call. @returns {() => void} */
  once(name, fn)
  /** Remove one listener; no-op when not subscribed. */
  off(name, fn)
  /**
   * Call every listener of `name` with `payload`. Iterates over a snapshot of the listener array taken at emit
   * time, so on()/off() inside a listener take effect from the next emit.
   * @returns {number} number of listeners invoked (not counting the ones that threw)
   */
  emit(name, payload)
  /** @returns {number} */
  listenerCount(name)
  /** Remove every listener of every event (used by tests and by the pop-out on unload). */
  clear()
  /** @type {{name:string, error:Error, at:number}[]} ring buffer of the last 20 listener errors, newest last */
  errors
  /** @type {number} total listener errors since construction */
  errorCount
}

/** The app-wide bus. `popout/main.js` creates its own `new EventBus()` — never import `bus` there. */
export const bus = new EventBus();
```

Rules:

1. **Error isolation.** `emit` wraps every listener call in `try/catch`. On a throw it appends `{name, error, at: performance.now()}` to `errors` (capacity 20, oldest dropped), increments `errorCount`, calls `console.error('[bus]', name, error)` and continues with the next listener. The error is never rethrown. If `name !== EVENT.UI_STATUS`, the bus additionally emits `EVENT.UI_STATUS` with `{level:'error', text: 'Listener error on ' + name + ': ' + error.message, source:'bus'}` **after** the loop (once per emit, even if several listeners threw). Errors thrown by `ui:status` listeners are only logged (no re-emit) — this is what prevents recursion.
2. **Synchronous, re-entrant.** `emit` returns after the last listener returns. A listener may emit; nesting depth is unbounded but the listener snapshot rule above makes it safe. A listener that needs to react "later" uses `queueMicrotask`/`requestAnimationFrame` itself.
3. **One payload object.** Payloads are plain objects (never arrays or primitives) so fields can be added later. `sim:stats` reuses one object per frame (see the table); every other payload is freshly created by the emitter. Listeners must not mutate payloads.
4. **Unknown names.** In strict mode (the default), `on`, `once`, `off` and `emit` throw `Error` with `code = 'UnknownEvent'` when `name` is not one of `Object.values(EVENT)`. `new EventBus({strict:false})` is allowed only in unit tests.
5. **No allocation in the hot path** beyond the listener-array snapshot: `emit` slices the array (one small allocation) — acceptable because `sim:stats` is the only per-frame event and there is exactly one emit of it per frame.

#### 3.2.2 `EVENT` — the complete name table

```js
export const EVENT = Object.freeze({
  // document / store (emitted by store.js)
  DOC_CHANGED:        'doc:changed',
  // pattern editor (emitted by src/pattern/editor.js and its tools)
  SELECTION_CHANGED:  'selection:changed',
  TOOL_CHANGED:       'tool:changed',
  HOVER_CHANGED:      'hover:changed',
  SEAM_PREVIEW:       'seam:preview',
  VIEW2D_CHANGED:     'view2d:changed',
  // body (emitted by src/ui/panels/body.js and src/app/wiring.js)
  BODY_PARAMS_DRAG:   'body:params:drag',
  BODY_PARAMS_COMMIT: 'body:params:commit',
  BODY_BUILT:         'body:built',
  // mesh (emitted by src/app/wiring.js)
  MESH_BUILT:         'mesh:built',
  // cloth (emitted by src/app/wiring.js and src/viewer3d/loop.js)
  SIM_BUILT:          'sim:built',
  SIM_STATS:          'sim:stats',
  SIM_PHASE:          'sim:phase',
  SIM_NAN:            'sim:nan',
  // fabric (emitted by src/app/wiring.js)
  FABRIC_CHANGED:     'fabric:changed',
  // sizes (emitted by src/app/wiring.js)
  SIZE_ACTIVE:        'size:active',
  // ui (emitted by src/ui/*)
  UI_LAYOUT:          'ui:layout',
  UI_DOCK:            'ui:dock',
  UI_STATUS:          'ui:status',
  // pop-out (emitted by the main-window side of the pop-out bridge, src/viewer3d/index.js)
  POPOUT_OPEN:        'popout:open',
  POPOUT_CLOSE:       'popout:close',
  // app lifecycle (emitted by src/app/main.js)
  APP_READY:          'app:ready',
});
```

Payload typedefs (all live in `events.js`; other modules import them with `@typedef {import('../core/events.js').DocChanged}` etc.):

```js
/**
 * Change hints are computed by the store by diffing the previous and next document (section 3.3.4).
 * A hint key is ABSENT when that part did not change; array hints list the ids that were added, removed or modified.
 * @typedef {Object} DocChanged
 * @property {string} label       human label of the change ('Move vertex', 'Load sample: tshirt', 'Undo: Move vertex')
 * @property {'update'|'drag'|'commit'|'cancel'|'undo'|'redo'|'replace'} origin
 * @property {import('./types.js').ProjectDoc} doc   the NEW current document (same reference store.get() returns)
 * @property {import('./types.js').Issue[]} warnings  warn-level issues from validateShape(doc) (never errors — those reject the update)
 * @property {string[]} [pieces]   ids of pieces added/removed/modified (order: as in doc.pieces, removed ids appended)
 * @property {string[]} [seams]    ids of seams added/removed/modified
 * @property {string[]} [fabrics]  ids of fabric instances added/removed/modified
 * @property {true} [body]         body.preset or any body.params value changed
 * @property {true} [sizes]        sizes.measurements / baseSize / rows changed
 * @property {true} [sim]          any SimSettings value changed
 * @property {true} [ui]           any UiState value changed
 * @property {true} [name]         doc.name changed
 */

/**
 * @typedef {Object} Selection
 * @property {string[]} pieces       selected piece ids (order of selection)
 * @property {string[]} seams        selected seam ids
 * @property {{pieceId:string, index:number}|null} vertex   single selected outline vertex (edit tool)
 * @property {{pieceId:string, edge:number}|null} edge      single selected outline edge (edit/split/notch/seam tools)
 */
/** @typedef {{selection: Selection, prev: Selection}} SelectionChanged */

/** @typedef {'select'|'draw'|'edit'|'split'|'seam'|'notch'|'grainline'|'measure'} ToolName */
/** @typedef {{tool: ToolName, prev: ToolName}} ToolChanged */

/**
 * Emitted on pointer move over the 2D canvas, throttled to one per animation frame; mm is null when the pointer leaves the canvas.
 * @typedef {Object} HoverChanged
 * @property {import('./types.js').Vec2|null} mm   cursor in pattern space
 * @property {string|null} pieceId
 * @property {number|null} edge
 * @property {number|null} vertex
 * @property {string|null} seamId
 */

/**
 * Seam tool feedback: after the first click `b` is null and the ease fields are 0; after the second click both sides
 * are set and the seam has been written to the store. Emitted with a === null when the tool is cancelled or changed.
 * @typedef {Object} SeamPreview
 * @property {import('./types.js').SeamSide|null} a
 * @property {import('./types.js').SeamSide|null} b
 * @property {number} lenA_mm      outline length of side a (0 when a is null)
 * @property {number} lenB_mm
 * @property {number} easePct      100 * (max(lenA,lenB) / min(lenA,lenB) - 1); 0 when either side is null
 * @property {'ok'|'warn'|'error'} level   ok < 8 %, warn 8..50 %, error > 50 % (seam still created, flagged; section 5)
 * @property {string|null} seamId  id of the created seam (second click) or the seam being inspected
 */

/** @typedef {{pxPerMm:number, panMm: import('./types.js').Vec2, width:number, height:number}} View2dChanged  CSS px canvas size */

/**
 * Slider drag preview. The store is NOT written during a drag (section 3.3.6); `params` is the candidate BodyParams.
 * @typedef {{key: keyof import('./types.js').BodyParams, params: import('./types.js').BodyParams}} BodyParamsDrag
 */
/** Emitted right AFTER the Body panel committed the drag/edit to the store. @typedef {{key: string|null, preset: string, params: import('./types.js').BodyParams}} BodyParamsCommit */

/**
 * @typedef {Object} BodyBuilt
 * @property {import('./types.js').BodyModel} model
 * @property {'coarse'|'full'} quality   coarse = 30 mm grid built during a slider drag; full = 15 mm grid (section 6)
 * @property {number} ms
 */

/**
 * @typedef {Object} MeshBuilt
 * @property {import('./types.js').PieceMesh[]} meshes   one per piece with simulate === true that meshed successfully
 * @property {import('./types.js').Issue[]} issues       RemeshError per failed piece (level 'error'), quality warnings (level 'warn')
 * @property {number} ms
 */

/** @typedef {{state: import('./types.js').ClothState, meshes: import('./types.js').PieceMesh[], ms: number}} SimBuilt */

/** The SimStats object from cloth/stats.js. THE SAME OBJECT IS REUSED EVERY FRAME — copy fields, never keep the reference. @typedef {import('./types.js').SimStats} SimStatsPayload */

/**
 * arranged: state built or reset, not stepping.  sewing: stepping, time < sewTime_s + 0.5.  draping: stepping after that.
 * paused: stepping stopped by the user (prev tells which phase it was in).
 * @typedef {{phase:'arranged'|'sewing'|'draping'|'paused', prev:'arranged'|'sewing'|'draping'|'paused', time:number, frame:number}} SimPhase
 */

/** @typedef {{frame:number, nanCount:number, restored:'snapshot'|'reset'}} SimNan  snapshot = restored the last sane snapshot (section 7), reset = fell back to restPos */

/**
 * @typedef {Object} FabricChanged
 * @property {string} fabricId
 * @property {import('./types.js').FabricResolved} resolved
 * @property {boolean} physicsChanged   preset or any override value differs from the previous resolution
 * @property {boolean} lookChanged      color or texture differs
 * @property {string[]} pieceIds        pieces referencing this fabric
 */

/** @typedef {{size:string, prev:string, row: import('./types.js').SizeRow|null}} SizeActive  row = the chart row named `size`, null if the name is not in the chart */

/** @typedef {{layout:'split'|'2d'|'3d', swapped:boolean, split:number, popout:boolean}} UiLayout */
/** @typedef {{tab:'pieces'|'body'|'fabric'|'sizes', prev:'pieces'|'body'|'fabric'|'sizes'}} UiDock */
/**
 * @typedef {Object} UiStatus
 * @property {'info'|'warn'|'error'} level
 * @property {string} text
 * @property {string} [source]     module name ('remesh', 'body', 'sim', 'export', 'bus', ...)
 * @property {number} [ttl_ms]     auto-clear after this many ms; default 4000 for info, 8000 for warn, sticky for error
 * @property {string} [code]       the Error.code that produced it, when any
 */

/** @typedef {{at:number}} PopoutOpen */
/** @typedef {{reason:'user'|'unload'|'timeout'|'blocked', at:number}} PopoutClose  blocked = window.open returned null (popup blocker) */

/** @typedef {{version:string, ms:number, sample:string}} AppReady  ms since module evaluation started; sample = id of the sample drawn ('tshirt') */
```

#### 3.2.3 Emitters, listeners and the wiring rule

`src/app/wiring.js` is the **only** file that calls one module's API in reaction to another module's event. Every other listener is confined to updating the listener's own module (a panel re-rendering itself, the status bar showing text, the 2D canvas repainting). The table is normative; an emitter or listener not listed here is a contract bug.

| Event | Emitted by | When | Frequency | Listeners allowed |
|---|---|---|---|---|
| `doc:changed` | `core/store.js` | after every accepted update, batch step/commit/cancel, undo, redo, replace | per edit; up to 60 Hz during drags (origin `'drag'`) | wiring.js (remesh / rebuild body / rebuild sim / fabric resolve / size derive, all gated on hints and origin), `pattern/editor.js` (repaint), every `ui/panels/*.js` and `ui/toolbar.js` (re-render, undo/redo button state), `app/debugApi.js` (log) |
| `selection:changed` | `pattern/editor.js` | selection set/cleared by any tool, by `pieces` panel clicks (which call `editor.select`), by debugApi | per interaction | `ui/panels/pieces.js`, `ui/statusbar.js`, `viewer3d/anchorsGizmo.js` via wiring.js (show anchor cylinder of the selected piece) |
| `tool:changed` | `pattern/editor.js` | `setTool` (toolbar, shortcut, debugApi, Esc) | per interaction | `ui/toolbar.js`, `ui/statusbar.js` (tool hint) |
| `hover:changed` | `pattern/editor.js` | pointer move over the 2D canvas, throttled to rAF | ≤ 60 Hz | `ui/statusbar.js` (cursor mm) |
| `seam:preview` | `pattern/tools/seam.js` | first click, second click (after store write), cancel | per interaction | `ui/statusbar.js` (ease readout), `ui/panels/pieces.js` (seam list highlight) |
| `view2d:changed` | `pattern/view.js` | pan/zoom/resize of the 2D canvas | ≤ 60 Hz | `ui/statusbar.js` (zoom %), debugApi `pattern.mmToPx` cache |
| `body:params:drag` | `ui/panels/body.js` | each `input` event of a param slider while the pointer is down; the store is not written | ≤ 60 Hz | wiring.js only (debounce 150 ms → coarse `buildBody` → `body:built` quality `'coarse'`) |
| `body:params:commit` | `ui/panels/body.js` | pointer-up / `change` of a slider or numeric field, preset selection — emitted after `store.update` | per interaction | `ui/statusbar.js` ("Body rebuilt"), `ui/panels/body.js` (measured readout refresh); wiring.js does NOT rebuild on it — the full rebuild is driven by `doc:changed` with `body` hint |
| `body:built` | `app/wiring.js` | after `buildBody()` returned (coarse or full) | per rebuild | `viewer3d/index.js` via wiring.js (`setBody`), cloth grid swap via wiring.js, `ui/panels/body.js` (measured vs target readout), `ui/statusbar.js` |
| `mesh:built` | `app/wiring.js` | after remeshing the pieces affected by a `doc:changed` (or all on replace) | per non-drag doc change touching pieces/seams | wiring.js (→ build sim), `ui/panels/pieces.js` (vertex counts, warnings), `ui/statusbar.js` |
| `sim:built` | `app/wiring.js` | after `cloth.buildState()` and arrangement | per mesh/body rebuild | `viewer3d/index.js` via wiring.js (`setCloth`), `ui/statusbar.js`, `ui/toolbar.js` (enable play) |
| `sim:stats` | `viewer3d/loop.js` | once per rendered frame after `step()`; once at the end of `debugApi.sim.step(n)` | 60 Hz | `ui/statusbar.js` (DOM update throttled to 4 Hz), `app/debugApi.js` (last stats), pop-out bridge (forward at ≤ 10 Hz) |
| `sim:phase` | `viewer3d/loop.js` | play/pause/reset and the automatic sewing→draping transition | per transition | `ui/toolbar.js` (play button state), `ui/statusbar.js` |
| `sim:nan` | `viewer3d/loop.js` | the NaN guard fired during a frame | rare | `ui/statusbar.js` (error text), `app/debugApi.js` (counter) |
| `fabric:changed` | `app/wiring.js` | after a `doc:changed` with a `fabrics` hint, once per affected fabric id, or after a piece's `fabricId` changed | per edit | wiring.js (viewer `setMaterial`, cloth `setFabric` in place), `ui/panels/fabric.js`, `pattern/editor.js` (piece fill colour) |
| `size:active` | `app/wiring.js` | after a `doc:changed` where `doc.ui.activeSize` differs from the last value wiring saw (covers undo/replace) | per change | `pattern/editor.js` (graded preview outline), `ui/panels/sizes.js`, `ui/toolbar.js` (size dropdown), `ui/statusbar.js` |
| `ui:layout` | `ui/layout.js` | after the DOM was updated for a layout/swap/split change, and when the pop-out opens/closes | per interaction | `pattern/view.js` and `viewer3d/scene.js` (both also use ResizeObserver; this event is for "frame all" on layout switches), `ui/toolbar.js` |
| `ui:dock` | `ui/dock.js` | dock tab switched (click, shortcut 1–4, debugApi) — after `store.update` of `ui.dockTab` | per interaction | `ui/panels/*.js` (lazy first render) |
| `ui:status` | any DOM-touching module, wiring.js (for caught module errors), the bus itself | as needed | as needed | `ui/statusbar.js`, `app/debugApi.js` (`__app.log`, last 200 entries) |
| `popout:open` | `viewer3d/index.js` (bridge) | the pop-out window answered `hello` | rare | wiring.js (switch layout to `'2d'`, pause the in-page loop), `ui/toolbar.js` |
| `popout:close` | `viewer3d/index.js` (bridge) | `closed` message, `beforeunload`, 3 s heartbeat timeout, or `window.open` returned null | rare | wiring.js (restore layout, resume loop), `ui/toolbar.js`, `ui/statusbar.js` |
| `app:ready` | `app/main.js` | once, after first mesh + body + sim build + first rendered frame | once | `app/debugApi.js` (resolves `__app.ready`), `ui/statusbar.js` |

Pure modules (`cloth/`, `geometry/`, `body/` except `mesh.js`, `sizing/`, `export/`) never import `events.js`; they return values and throw coded errors, and wiring.js turns those into events. `samples/` imports nothing.

---

### 3.3 `src/core/store.js` — document holder, undo/redo, batches

`store.js` imports `schema.js` (normalize, validate, stableStringify), `events.js` (EVENT, bus type) and `types.js`. It performs no I/O (no localStorage, no fetch); persistence is an app-level concern.

#### 3.3.1 API

```js
/**
 * @typedef {Object} Store
 * @property {() => import('./types.js').ProjectDoc} get
 *   The current document. It is a LIVE reference that becomes stale after the next update; treat it as read-only.
 *   Mutating it directly is a contract bug (undo snapshots share this object).
 * @property {(mutator: Mutator, label: string) => import('./types.js').ProjectDoc} update
 *   Apply `mutator` to a structuredClone of the current document (section 3.3.2). Returns the new current doc.
 *   Throws ValidationError (code 'ValidationError', .issues: Issue[]) and leaves the store untouched when
 *   validateShape reports any error-level issue. Throws whatever the mutator throws (store untouched).
 * @property {(label: string) => Batch} batch          start a coalesced sequence of updates (section 3.3.6)
 * @property {() => boolean} undo                       false when nothing to undo
 * @property {() => boolean} redo
 * @property {() => boolean} canUndo
 * @property {() => boolean} canRedo
 * @property {() => {undo: string[], redo: string[]}} history   labels, oldest first / next-redo first
 * @property {(doc: object, label: string, opts?: {keepHistory?: boolean}) => import('./types.js').ProjectDoc} replace
 *   Load a whole document: migrate → normalizeDoc → validateShape (errors throw ValidationError). Clears the
 *   undo/redo stacks unless keepHistory (default false); with keepHistory the previous doc becomes an undo entry.
 * @property {(fn: (change: import('./events.js').DocChanged) => void) => () => void} subscribe
 *   Called with the same payload as doc:changed, BEFORE the bus emit (so panels that subscribe see the doc
 *   before wiring reacts). Returns an unsubscribe function. Errors thrown by subscribers are isolated exactly like bus listeners.
 * @property {TransientState} transient                 section 3.3.5
 * @property {number} revision                          increments on every accepted change (update, batch step, undo, redo, replace)
 */

/** @typedef {(draft: import('./types.js').ProjectDoc) => (void | import('./types.js').ProjectDoc)} Mutator */

/**
 * @param {object} doc      partial or full ProjectDoc; passed through migrate + normalizeDoc + validateShape (errors throw)
 * @param {import('./events.js').EventBus} bus
 * @param {{historyLimit?: number}} [opts]   default 100
 * @returns {Store}
 */
export function createStore(doc, bus, opts)

export const HISTORY_LIMIT = 100;
export const TOOL_NAMES = Object.freeze(['select','draw','edit','split','seam','notch','grainline','measure']);
export function makeTransient()   // returns a fresh default TransientState (section 3.3.5)
```

#### 3.3.2 `update(mutator, label)` — exact sequence

1. `prev = current`.
2. `draft = structuredClone(prev)`.
3. `r = mutator(draft)`; `next = (r && typeof r === 'object') ? r : draft`. Returning a new object replaces the document wholesale (used by `replace`-like actions such as "apply graded pieces"); returning nothing keeps the mutated draft.
4. `next = normalizeDoc(next)` — fills any fields the mutator left undefined (e.g. a piece pushed without `placement`). normalizeDoc is idempotent and cheap (< 1 ms on the samples).
5. `issues = validateShape(next)`. If any issue has `level === 'error'` → throw `ValidationError` (`error.code = 'ValidationError'`, `error.issues = issues`); nothing else changes.
6. `hints = diffHints(prev, next)` (section 3.3.4). If `hints` is empty (nothing changed) → return `prev` without emitting, without touching history.
7. **History.** If the only hint key is `ui` → no undo entry (UI state is not undoable, section 3.3.3). Otherwise push `{doc: prev, label}` onto `past` (drop the oldest when `past.length > historyLimit`) and clear `future`.
8. `current = next; revision++`.
9. Build `change = {label, origin:'update', doc: next, warnings: issues (all are warn-level here), ...hints}`.
10. Call subscribers in order (isolated), then `bus.emit(EVENT.DOC_CHANGED, change)`.
11. Return `next`.

`structuredClone` is the only cloning primitive; documents contain only JSON-compatible values (normalizeDoc guarantees it), so the clone is exact. Typical cost on the T-shirt sample (≈ 25 KB of JSON): 0.2–0.5 ms per update.

#### 3.3.3 Undo / redo

* `past` and `future` are arrays of `{doc, label}`. `doc` is the previous *current* object itself — no extra clone, because an accepted document is never mutated again (update always clones before mutating).
* `undo()`: if `past` is empty return false. Pop `{doc: snap, label}`; push `{doc: current, label}` onto `future`; `restored = {...snap, ui: current.ui}` (**`ui` is carried over, never undone**); `current = restored; revision++`; emit `doc:changed` with `origin:'undo'`, `label: 'Undo: ' + label`, hints from `diffHints(previousCurrent, restored)`; return true. The restored object is a fresh shallow copy, so the identity rule ("a current doc is never mutated") holds.
* `redo()`: symmetric with `future`/`past`, `origin:'redo'`, label `'Redo: ' + label`.
* `canUndo() === past.length > 0`; `canRedo() === future.length > 0`.
* Capacity: `historyLimit` (default `HISTORY_LIMIT = 100`) applies to `past`; `future` is bounded by construction.
* An active batch (3.3.6) blocks undo/redo: they return false while `batch.active` is true.

#### 3.3.4 Change hints — `diffHints(prev, next)`

Exported from `store.js` for tests. Uses `stableStringify` from `schema.js` (sorted keys, no indent) to compare sub-trees; the whole T-shirt doc stringifies in < 1 ms, so this runs on every update including drag steps.

1. `pieces`: build `Map(id → stableStringify(piece))` for both docs; collect ids whose string differs or that exist on only one side. Order: ids in `next.pieces` order, then removed ids in `prev.pieces` order. Emit the key only when non-empty.
2. `seams`, `fabrics`: same by id.
3. `body`: `true` when `stableStringify(prev.body) !== stableStringify(next.body)`.
4. `sizes`, `sim`, `ui`: same rule on the sub-object.
5. `name`: `true` when `prev.name !== next.name`.
6. `version` differences are impossible after migrate (both are 1).

A piece whose `fabricId` changed appears in `pieces` (not in `fabrics`); wiring.js emits `fabric:changed` for the newly referenced fabric in that case as well (3.2.3).

#### 3.3.5 Transient UI state (outside the document, outside undo)

```js
/**
 * Owned by src/pattern/editor.js (tool, selection, hover, seamPick) and src/viewer3d/loop.js (running).
 * Other modules READ it (debugApi, panels); only the owner writes it, and the owner emits the matching event
 * (tool:changed, selection:changed, hover:changed, seam:preview, sim:phase) right after writing.
 * @typedef {Object} TransientState
 * @property {import('./events.js').ToolName} tool                default 'select'
 * @property {import('./events.js').Selection} selection           default {pieces:[], seams:[], vertex:null, edge:null}
 * @property {import('./events.js').HoverChanged|null} hover       default null
 * @property {import('./types.js').SeamSide|null} seamPick         first side picked by the seam tool, default null
 * @property {boolean} running                                     sim stepping, default false
 * @property {'arranged'|'sewing'|'draping'|'paused'} phase        default 'arranged'
 * @property {string|null} popoutId                                window name of the open pop-out, default null
 */
```

`store.transient` is created by `makeTransient()` in `createStore`, is never cloned, never serialized, never part of `doc:changed`, and survives `replace()` except that `replace` resets `selection`, `hover` and `seamPick` to their defaults (the ids they reference are gone) — the editor then emits `selection:changed` itself when it handles `doc:changed` with `origin:'replace'`.

#### 3.3.6 Batches — coalescing drags into one undo entry

```js
/**
 * @typedef {Object} Batch
 * @property {(mutator: Mutator) => import('./types.js').ProjectDoc} update
 *   Apply a step. Same pipeline as store.update (clone, normalize, validate, diff) except: no history entry,
 *   origin 'drag', label = the batch label. On ValidationError the step is rejected (store unchanged) and the
 *   error is RETURNED as `batch.lastError` instead of thrown, so a drag handler can simply keep the last valid state.
 * @property {() => import('./types.js').ProjectDoc} commit
 *   Push ONE undo entry {doc: docAtBegin, label} if anything changed since begin (hints of begin→now non-empty
 *   and not ui-only), emit doc:changed {origin:'commit', hints: diffHints(docAtBegin, current)}, end the batch.
 *   If nothing changed, no emit. Returns the current doc.
 * @property {() => import('./types.js').ProjectDoc} cancel
 *   Restore docAtBegin as current (no history entry), emit doc:changed {origin:'cancel', hints: diffHints(lastStep, docAtBegin)}
 *   if any step had been applied, end the batch.
 * @property {boolean} active
 * @property {Error|null} lastError
 * @property {string} label
 */
```

Rules:

1. At most one batch is active at a time. `store.batch()` while one is active throws `Error{code:'BatchActive'}`.
2. `store.update()` while a batch is active is applied **as a step of that batch** (no own history entry; origin `'drag'`). This makes keyboard nudges during a pointer drag safe.
3. `undo()`/`redo()`/`replace()` while a batch is active: undo/redo return false; `replace` first cancels the batch.
4. Consumers that do expensive work (remesh, body rebuild, sim rebuild) **ignore `origin === 'drag'`** and act on `'commit'`, `'update'`, `'undo'`, `'redo'`, `'replace'`, `'cancel'`. Cheap consumers (2D repaint, panel field mirroring) act on every origin. This is the whole contract that makes 60 Hz drags cheap.
5. Who uses batches: `pattern/tools/select.js` (piece move), `edit.js` (vertex/handle drag), `grainline.js`, `notch.js` (drag along edge); `ui/panels/pieces.js` sliders (wrap, offset, layer, meshSpacing, seamAllowance); `ui/panels/fabric.js` override sliders and the colour picker (`input` = step, `change` = commit); `ui/layout.js` divider drag (`ui.split`, ui-only so it never creates history anyway). The Body panel is the exception: it does **not** write the store during a drag (a body rebuild is hundreds of ms and must not be requested 60 times per second even coarsely); it emits `body:params:drag` while dragging and performs one `store.update` on release, followed by `body:params:commit` (3.2.3).
6. Batch steps emit `doc:changed` synchronously; a drag handler that receives more than one pointer event per frame should coalesce them itself (apply only the last position per `requestAnimationFrame`).

#### 3.3.7 Error behaviour summary

| Situation | Behaviour |
|---|---|
| mutator throws | rethrown; store unchanged; no emit |
| validateShape error | `ValidationError` thrown (update/replace) or stored in `batch.lastError` (batch step); store unchanged |
| `replace(doc)` with unsupported version | `Error{code:'UnsupportedVersion'}` from migrate; store unchanged |
| subscriber / listener throws | isolated (3.2.1), store already updated |
| `update` during batch | folded into the batch |
| `batch()` during batch | `Error{code:'BatchActive'}` |

#### 3.3.8 Self-checks (acceptance group `core.store`, section 13)

1. `createStore(normalizeDoc({}), bus)` → `get().version === 1`, `canUndo() === false`.
2. `update(d => { d.name = 'x' }, 'rename')` emits exactly one `doc:changed` with `name: true` and no other hint keys; `canUndo() === true`; `undo()` restores `name`, emits with `origin:'undo'`; `redo()` re-applies.
3. `update(d => { d.ui.split = 0.3 }, 'split')` emits with only `ui: true` and creates **no** undo entry.
4. A mutator that sets `d.pieces[0].vertices = []` → throws `ValidationError`, `get()` unchanged, no emit.
5. 150 updates → `history().undo.length === 100`.
6. A batch of 30 steps then `commit()` → one undo entry; 30 emits with `origin:'drag'` + 1 with `origin:'commit'`; `undo()` restores the pre-batch doc in one step.
7. A batch of 3 steps then `cancel()` → doc equals the pre-batch doc, `canUndo()` unchanged.
8. Undo after `update(d => { d.body.params.chest_cm = 100; d.ui.dockTab = 'body' }, ...)` restores `chest_cm` but keeps `dockTab === 'body'`.
9. `diffHints` on a doc where one piece moved lists exactly that piece id and nothing else.
10. `get()` returns the same reference between updates and a different reference after one.

---

### 3.4 `src/core/schema.js` — normalize, serialize, validate, migrate

`schema.js` imports `types.js`, `ids.js` (uid), `fabrics.js` (getPreset, DEFAULT_TEXTURE, TEXTURE_KINDS, PHYSICS_KEYS, isHexColor). It never imports `geometry/` (dependency rule) — the little geometry it needs (bbox, control-polygon area) is inlined.

```js
export const DOC_VERSION = 1;
export const DEFAULT_BODY_PRESET = 'female_m';
/** @type {Readonly<import('./types.js').BodyParams>} MUST equal body/presets.js female_m (section 6.1); body/selftest.js asserts this. */
export const DEFAULT_BODY_PARAMS = Object.freeze({
  height_cm: 165, chest_cm: 88, underbust_cm: 76, waist_cm: 70, hips_cm: 96, shoulderWidth_cm: 38, neck_cm: 34,
  upperArm_cm: 27, forearm_cm: 23, wrist_cm: 15.5, thigh_cm: 54, calf_cm: 36, ankle_cm: 22, armLength_cm: 56,
  inseam_cm: 76, torsoLength_cm: 40, headHeight_cm: 22, bustFullness: 0.4, armAbduction_deg: 30, legSpread_deg: 6,
});
export const BODY_PARAM_KEYS = Object.freeze(Object.keys(DEFAULT_BODY_PARAMS));   // 20 keys, in the order above
export const DEFAULT_SIZE_MEASUREMENTS = Object.freeze(['chest_cm','waist_cm','hips_cm','height_cm','torsoLength_cm','armLength_cm']);
export function defaultSizeChart()      // fresh SizeChart (section 3.4.1, rows S/M/L/XL)
export function defaultSimSettings()    // fresh SimSettings
export function defaultUiState(baseSize) // fresh UiState
export function defaultPlacement()      // fresh Placement
export function defaultGrading()        // fresh Grading
export function normalizeDoc(partial)   // → ProjectDoc (new object; input not mutated)
export function normalizePiece(partial, ctx)   // ctx = {fabricIds:string[], defaultFabricId:string}; → Piece
export function normalizeSeam(partial)  // → Seam
export function normalizeFabricInstance(partial) // → FabricInstance
export function serializeDoc(doc)       // → string, sorted keys, 2-space indent, trailing '\n'
export function stableStringify(value, indent = 0) // → string, sorted keys; used by serializeDoc and store.diffHints
export function parseDoc(text)          // JSON.parse → migrate → normalizeDoc; throws Error{code:'ParseError'} on invalid JSON
export function validateShape(doc)      // → Issue[]
export function migrate(doc)            // → doc at DOC_VERSION (new object)
export function controlPolygonArea(piece) // signed area (mm²) of the control polygon (vertices + cubic control points in travel order)
```

#### 3.4.1 `normalizeDoc(partial)` — every default

Helpers used throughout (all local): `num(v, def)` → `v` if `typeof v === 'number' && Number.isFinite(v)`, else `Number(v)` if `v` is a string that parses to a finite number, else `def`; `int(v, def)` = `Math.trunc(num(v, def))`; `bool(v, def)`; `str(v, def)` → `v` if non-empty string else `def`; `vec2(v, def)` → `[num(v[0]), num(v[1])]` if `v` is an array of length 2 with finite entries, else `def`; `oneOf(v, list, def)`; `hex(v, def)` → `v` lower-cased if `isHexColor(v)`, else `def`. Unknown keys are **dropped** at every level (the output is rebuilt from known keys only), which is what makes `serializeDoc` output stable and byte-comparable.

| Path | Default | Notes |
|---|---|---|
| `version` | `1` | `migrate` runs first when `< 1` (3.4.4) |
| `name` | `'Untitled'` | |
| `body.preset` | `'female_m'` | any non-empty string kept (presets validated by the body module, not here; unknown → treated as `'custom'` by section 6.1) |
| `body.params.<key>` | `DEFAULT_BODY_PARAMS[key]` for each of the 20 keys | extra keys dropped; ranges are NOT clamped here (validateShape warns; body module clamps at build, section 6.1) |
| `fabrics` | `[]` → `[{id:'main', name:'Main', preset:'cotton', color: getPreset('cotton').look.color, texture: {...getPreset('cotton').look.texture}, overrides: {}}]` | at least one instance always exists |
| `fabrics[i].id` | `uid('fab')` | |
| `fabrics[i].name` | `= id` | |
| `fabrics[i].preset` | `'cotton'` when missing or not a known preset id | |
| `fabrics[i].color` | `getPreset(preset).look.color` | `hex()` |
| `fabrics[i].texture` | `{...getPreset(preset).look.texture}` | `kind` via `oneOf(TEXTURE_KINDS, preset kind)`, `scale_mm` via `num(…, preset scale_mm)`, `color2` via `hex(…, preset color2)` |
| `fabrics[i].overrides` | `{}` | only `PHYSICS_KEYS` with finite numeric values are kept |
| `pieces` | `[]` | each through `normalizePiece` |
| `pieces[i].id` | `uid('piece')` | |
| `pieces[i].name` | `= id` | |
| `pieces[i].vertices` | `[]` (validateShape flags `< 3`) | each entry via `vec2(v, [0,0])`; non-array → `[]` |
| `pieces[i].edges` | filled/truncated to `vertices.length` with `{type:'line'}` | `type` via `oneOf(['line','cubic'], 'line')`; for cubic, `c1`/`c2` kept only if valid vec2 (missing ones flagged by validateShape); `allowance_mm` kept only if finite number; `label` kept only if non-empty string |
| `pieces[i].foldEdge` | `null` | `int` or null |
| `pieces[i].notches` | `[]` | each `{edge:int(…,0), t:num(…,0.5), kind: oneOf(['single','double'],'single')}` |
| `pieces[i].grainline` | vertical arrow through the bbox centre: with bbox `[minx,miny,maxx,maxy]` of the vertices, `cx=(minx+maxx)/2`, `h=maxy-miny`; `a=[cx, cy-0.25h]`, `b=[cx, cy+0.25h]`; if `h < 1` (degenerate/empty): `a=[0,0]`, `b=[0,100]` | |
| `pieces[i].internalLines` | `[]` | each `{kind: oneOf(['fold','dart','mark'],'mark'), points: vec2[] (invalid entries dropped)}` |
| `pieces[i].seamAllowance_mm` | `10` | |
| `pieces[i].fabricId` | first fabric id | when missing or not in `fabrics` |
| `pieces[i].layer` | `0` | `int`, clamped `0..4` |
| `pieces[i].cutQty` | `1` | `int`, min 1 |
| `pieces[i].exportHidden` | `false` | |
| `pieces[i].simulate` | `true` | |
| `pieces[i].pinnedEdges` | `[]` | ints, deduplicated, sorted |
| `pieces[i].placement` | `{anchor:'torso', side:'front', offset_mm:[0,0], wrap:1, flip:false}` | `anchor` via `oneOf(['torso','armL','armR','legL','legR','skirt','head'])`, `side` via `oneOf(['front','back','left','right'])`, `wrap` clamped `0..1` |
| `pieces[i].grade` | `{widthRef:'chest_cm', lengthRef:'torsoLength_cm', anchorX:'center', anchorY:'top', vertexRules:[]}` | `widthRef`/`lengthRef`: string or null (membership in `sizes.measurements` is a validateShape warning); rules `{vertex:int, dx_mm:num(…,0), dy_mm:num(…,0)}` |
| `pieces[i].meshSpacing_mm` | `15` | not clamped (validateShape warns outside 8..40; remesh clamps) |
| `seams` | `[]` | each through `normalizeSeam` |
| `seams[i].id` | `uid('seam')` | |
| `seams[i].a`, `.b` | `{pieceId: str(…,''), edge: int(…,0), mirror: bool(…,false), reverse: bool(…,false)}` | |
| `seams[i].kind` | `'plain'` | only value in v1 |
| `sizes` | `defaultSizeChart()` when missing or when `rows` is not a non-empty array | |
| `sizes.measurements` | `DEFAULT_SIZE_MEASUREMENTS` | strings only, deduplicated, order kept |
| `sizes.baseSize` | `'M'` if a row named `'M'` exists, else the first row's name | |
| `sizes.rows[i]` | `{name: str(…, 'Size ' + (i+1))}` + for each key in `measurements`: `num(row[key], NaN)` | NaN entries are kept as `null` (JSON has no NaN) and flagged by validateShape; keys not in `measurements` are dropped |
| `sim` | `{substeps:10, gravity_ms2:9.81, selfCollision:true, sewTime_s:1.0, collisionOffset_mm:5, bendScale:1, stretchScale:1}` | |
| `ui` | `{split:0.5, layout:'split', swapped:false, activeSize: sizes.baseSize, dockTab:'pieces'}` | `split` clamped `0.15..0.85`; `layout` via `oneOf(['split','2d','3d'])`; `activeSize` falls back to `baseSize` when not a row name; `dockTab` via `oneOf(['pieces','body','fabric','sizes'])` |

`defaultSizeChart()`:

```js
{ measurements: ['chest_cm','waist_cm','hips_cm','height_cm','torsoLength_cm','armLength_cm'],
  baseSize: 'M',
  rows: [
    { name:'S',  chest_cm:84, waist_cm:66, hips_cm:92,  height_cm:160, torsoLength_cm:39, armLength_cm:55 },
    { name:'M',  chest_cm:88, waist_cm:70, hips_cm:96,  height_cm:165, torsoLength_cm:40, armLength_cm:56 },
    { name:'L',  chest_cm:92, waist_cm:74, hips_cm:100, height_cm:170, torsoLength_cm:41, armLength_cm:57 },
    { name:'XL', chest_cm:96, waist_cm:78, hips_cm:104, height_cm:175, torsoLength_cm:42, armLength_cm:58 } ] }
```

(M equals `DEFAULT_BODY_PARAMS`; S = M − (4,4,4,5,1,1); L = M + (4,4,4,5,1,1); XL = M + (8,8,8,10,2,2).)

Idempotence: `normalizeDoc(normalizeDoc(x))` deep-equals `normalizeDoc(x)`; `uid` is only called for missing ids, so a normalized doc never changes ids on re-normalization.

#### 3.4.2 `serializeDoc(doc)` and `stableStringify`

* `stableStringify(value, indent)`: recursive; objects are emitted with keys sorted by `<` on UTF-16 code units (plain `Array.prototype.sort()` with no comparator); arrays keep order; numbers use `JSON.stringify(n)` (so `-0` → `0`, non-finite → `null`); strings via `JSON.stringify`; `undefined` values and functions are omitted from objects and become `null` in arrays (same as JSON.stringify). `indent = 0` → single line without spaces (used for diffing); `indent = 2` → pretty-printed exactly like `JSON.stringify(v, null, 2)` would print the key-sorted tree.
* `serializeDoc(doc)` = `stableStringify(normalizeDoc(doc), 2) + '\n'`.
* Round-trip guarantee: `serializeDoc(parseDoc(serializeDoc(d))) === serializeDoc(d)` for every valid `d` (acceptance 13; numbers survive because they are never rounded).
* `parseDoc(text)`: `JSON.parse` (a `SyntaxError` is rethrown as `Error{code:'ParseError', message}`), then `migrate`, then `normalizeDoc`. It does **not** validate; callers (`store.replace`) do.

#### 3.4.3 `validateShape(doc)` → `Issue[]`

Structural and referential checks only. Geometric validity of outlines (self-intersection, curvature, seam length ease) belongs to `pattern/validate.js` (section 5), mesh quality to `geometry/remesh.js`. `validateShape` runs on every store update and must stay under 1 ms on the samples; it assumes the doc is already normalized (call `normalizeDoc` first — the store does). Issue `code` values are exact strings; `message` is human-readable and includes the offending value.

| code | level | Check |
|---|---|---|
| `DocVersion` | error | `doc.version !== 1` |
| `NoFabrics` | error | `doc.fabrics.length === 0` |
| `DuplicateId` | error | duplicate id among pieces, among seams, or among fabrics (`message` names the collection); ids must be non-empty strings |
| `FabricPreset` | error | `fabrics[i].preset` is not a `FABRIC_PRESETS` id |
| `FabricColor` | error | `color` or `texture.color2` fails `isHexColor` |
| `FabricOverrideRange` | warn | an override outside: `density_kgm2` 0.005..5, `bend_Nm` 1e-8..1e-1, `membrane_Nm` 1..1e6, `friction` 0..1, `damping` 0..20, `thickness_mm` 0.02..10, `meshSpacing_mm` 8..40 |
| `PieceVertices` | error | `vertices.length < 3` |
| `PieceEdgesCount` | error | `edges.length !== vertices.length` (cannot happen after normalize; kept for docs built by hand) |
| `EdgeCubicControls` | error | a `'cubic'` edge lacks a valid `c1` or `c2` |
| `EdgeAllowance` | warn | `allowance_mm < 0` or `> 100`; `seamAllowance_mm` outside 0..100 |
| `PieceOrientation` | warn | `controlPolygonArea(piece) <= 0` (CW or degenerate). The store accepts the doc; `geometry/remesh.js` throws `RemeshError{code:'Orientation'}` and `export/` skips the piece with the same Issue. The draw tool always commits CCW loops, so this only fires for hand-written or programmatic docs. |
| `FoldEdgeIndex` | error | `foldEdge !== null` and (`foldEdge` not an integer in `0..edges.length-1`) |
| `FoldEdgeCurved` | error | `edges[foldEdge].type !== 'line'` |
| `FoldEdgeAllowance` | warn | `edges[foldEdge].allowance_mm` present and non-zero (export forces 0) |
| `NotchEdge` | error | `notch.edge` outside `0..edges.length-1` |
| `NotchT` | error | `!(t > 0 && t < 1)` |
| `NotchOnFold` | warn | `notch.edge === foldEdge` |
| `GrainlineDegenerate` | warn | `|b − a| < 1 mm` |
| `InternalLinePoints` | warn | an internal line with fewer than 2 points |
| `PieceFabric` | error | `fabricId` not in `fabrics` |
| `PieceLayer` | error | `layer` not an integer in 0..4 |
| `PieceCutQty` | error | `cutQty` not an integer ≥ 1 |
| `PinnedEdge` | error | a `pinnedEdges` entry outside `0..edges.length-1` |
| `PlacementAnchor` | error | `placement.anchor` / `side` not in their enums; `wrap` not in 0..1 |
| `MeshSpacing` | warn | `meshSpacing_mm` outside 8..40 (remesh clamps) |
| `GradeRef` | warn | `grade.widthRef` / `lengthRef` non-null and not in `sizes.measurements` (grading treats it as null) |
| `GradeRuleVertex` | error | a `vertexRules[k].vertex` outside `0..vertices.length-1` |
| `SeamPiece` | error | `a.pieceId` or `b.pieceId` not a piece id |
| `SeamEdge` | error | `a.edge`/`b.edge` outside that piece's edge range |
| `SeamOnFold` | error | a side's `edge === piece.foldEdge` |
| `SeamMirrorNoFold` | error | `mirror === true` on a side whose piece has `foldEdge === null` |
| `SeamSelf` | error | `a` and `b` identical (`pieceId`, `edge`, `mirror` all equal) |
| `SeamDuplicateSide` | warn | the same `(pieceId, edge, mirror)` triple used by two different seams (an edge sewn twice) |
| `SeamSimulateMismatch` | warn | one side's piece has `simulate === false` (seam ignored by the sim) |
| `SizesMeasurements` | error | `measurements` empty, or a key that is not a `BODY_PARAM_KEYS` entry |
| `SizesRows` | error | `rows` empty, duplicate row names, or `baseSize` not a row name |
| `SizeCell` | error | a row value for a listed measurement is `null`/non-finite/≤ 0 |
| `BodyParam` | warn | a body param outside its section 6.1 range: `height_cm` 80..230, `*_cm` girths 5..250, `shoulderWidth_cm` 20..70, `armLength_cm` 30..100, `inseam_cm` 30..120, `torsoLength_cm` 20..70, `headHeight_cm` 12..35, `bustFullness` 0..1, `armAbduction_deg` 10..60, `legSpread_deg` 0..20 (body module clamps) |
| `SimSetting` | error | `substeps` not an integer 1..40; `gravity_ms2` < 0 or > 30; `sewTime_s` < 0.1 or > 20; `collisionOffset_mm` < 0 or > 30; `bendScale`/`stretchScale` ≤ 0 or > 1000 |
| `UiState` | error | `split` outside 0.15..0.85; `activeSize` not a row name; enum fields invalid |

Issue objects carry `pieceId`, `seamId` and `edge` whenever they apply. Issues are ordered by piece/seam order, then by check order above — deterministic for tests.

#### 3.4.4 `migrate(doc)`

* `version` missing, non-numeric or `< 1` → treated as **v0**, the pre-freeze layout of the design documents. Applied in order, on a deep copy:
  1. Top-level: `schemaVersion` → `version`; `sizeChart` → `sizes`; `sizes.sizes` (array) → `sizes.rows`; `sizes.table` (object) → `rows` in key order with `name` = key; `sizes.base` → `baseSize`; `sizes.measures` → `measurements`.
  2. Key renames anywhere in pieces/sim/placement: `seamAllowanceMm`→`seamAllowance_mm`, `meshSpacingMm`→`meshSpacing_mm`, `offsetMm`→`offset_mm`, `quantity`→`cutQty`, `sewTimeS`/`sewDurationS`→`sewTime_s`, `collisionOffsetMm`→`collisionOffset_mm`, `gravity`→`gravity_ms2` (absolute value), `grade.x`→`grade.widthRef`, `grade.y`→`grade.lengthRef`, `grade.xAnchor`→`anchorX`, `grade.yAnchor`→`anchorY`, rule `dx`/`dy`→`dx_mm`/`dy_mm`, `grading`→`grade`, `internalLines[].kind` missing → `'mark'`.
  3. Body params: unsuffixed keys get `_cm` (`chest`→`chest_cm`, `hips`/`hip`→`hips_cm`, `neckCirc`→`neck_cm`, `upperArmCirc`→`upperArm_cm`, `wristCirc`→`wrist_cm`, `thighCirc`→`thigh_cm`, `calfCirc`→`calf_cm`, `ankleCirc`→`ankle_cm`, `backLength`→`torsoLength_cm`, `bust`→`bustFullness`, `armAbductionDeg`→`armAbduction_deg`, `legSpreadDeg`→`legSpread_deg`); any value `< 3` on a `_cm` key is assumed to be metres and multiplied by 100; `masculinity`, `sex`, `chestDepthRatio`, `headCirc`, `kneeCirc` are dropped.
  4. Size rows: if every numeric value of the base row is `> 300`, the chart is assumed to be in mm and every value is divided by 10; measurement keys renamed as in step 3.
  5. Seam sides: `piece`→`pieceId`; `edges:[e]` (single-element chain) → `edge: e`; a chain with more than one edge → keep `edges[0]` and add an `Issue`-style entry to `migrate.warnings` (module-level array cleared at each call) — the user is told the seam was truncated via `ui:status`.
  6. Fabrics: `piece.color` + `piece.fabricId` naming a preset (v0 had no fabric instances) → one `FabricInstance` per distinct `(preset, color)` pair with id `fab_<preset>_<n>`, pieces re-pointed. `fabricOverrides` (object keyed by preset) → `overrides` of the matching instances.
  7. Set `version = 1`.
* `version === 1` → returned unchanged (same object).
* `version > 1` → throw `Error{code:'UnsupportedVersion', message:'Document version X is newer than this app (1)'}`.
* `migrate.warnings: string[]` — populated during the last call, read by `store.replace` which forwards each as `ui:status` warn.

#### 3.4.5 Self-checks (acceptance group `core.schema`)

1. `normalizeDoc({})` validates with zero issues and its `fabrics[0].id === 'main'`, `pieces.length === 0`, `ui.activeSize === 'M'`.
2. `normalizeDoc` is idempotent on both samples (deep-equal).
3. `serializeDoc` of both samples is byte-identical after a `parseDoc` round trip, keys sorted (`"body"` precedes `"fabrics"` precedes `"name"` …).
4. `validateShape(sample)` returns `[]` for `tshirt` and `skirt` (section 4.4 guarantees this).
5. Every code in the table fires on a purpose-built broken doc (one fixture per code; at least the error-level ones).
6. `migrate` of a v0 fixture (design-document layout with `seamAllowanceMm`, `height: 1.65`, mm size rows) yields a doc with `height_cm === 165`, `rows[1].chest_cm === 88`, zero validation errors.
7. `migrate({version: 2})` throws `UnsupportedVersion`.

---

### 3.5 `src/core/units.js` and `src/core/ids.js`

#### 3.5.1 `units.js`

```js
export const MM_PER_M = 1000;
export const MM_PER_CM = 10;
export const CM_PER_M = 100;
export const DEG_PER_RAD = 180 / Math.PI;

/** @param {number} mm @returns {number} metres */   export function mmToM(mm)      // mm / 1000
/** @param {number} m  @returns {number} mm */       export function mToMm(m)       // m * 1000
/** @param {number} cm @returns {number} metres */   export function cmToM(cm)      // cm / 100
/** @param {number} m  @returns {number} cm */       export function mToCm(m)       // m * 100
/** @param {number} cm @returns {number} mm */       export function cmToMm(cm)     // cm * 10
/** @param {number} mm @returns {number} cm */       export function mmToCm(mm)     // mm / 10
/** @param {number} deg @returns {number} rad */     export function degToRad(deg)  // deg * Math.PI / 180
/** @param {number} rad @returns {number} deg */     export function radToDeg(rad)  // rad * DEG_PER_RAD
/** @param {number} v @param {number} lo @param {number} hi */ export function clamp(v, lo, hi)
/** Round to `digits` decimals using Math.round(v * 10^d) / 10^d (so 0.5 rounds away from zero for positives). */
export function roundTo(v, digits)

/**
 * Format a length in mm for the UI: fmtMm(123.456) === '123.5 mm'; fmtMm(5, 0) === '5 mm'; non-finite → '—'.
 * @param {number} mm @param {number} [digits=1]
 */
export function fmtMm(mm, digits)
/** fmtCm(88) === '88.0 cm'; fmtCm(1234.5, 1) → '1234.5 cm'; non-finite → '—'. @param {number} cm @param {number} [digits=1] */
export function fmtCm(cm, digits)
/** fmtM(1.6543, 3) === '1.654 m'. */
export function fmtM(m, digits = 3)
/** fmtPct(5.123) === '5.1 %'. */
export function fmtPct(pct, digits = 1)

/**
 * Paper sizes in mm (portrait), printable window = size − 2·margin, tile step = printable − TILE_OVERLAP_MM (section 10).
 * @typedef {{id:'A4'|'Letter'|'A3', w_mm:number, h_mm:number, margin_mm:number}} Paper
 */
export const PAPER = Object.freeze({
  A4:     Object.freeze({ id:'A4',     w_mm: 210,   h_mm: 297,   margin_mm: 10 }),
  Letter: Object.freeze({ id:'Letter', w_mm: 215.9, h_mm: 279.4, margin_mm: 10 }),
  A3:     Object.freeze({ id:'A3',     w_mm: 297,   h_mm: 420,   margin_mm: 10 }),
});
export const PAPER_IDS = Object.freeze(['A4','Letter','A3']);
export const TILE_OVERLAP_MM = 10;
/** @param {Paper} paper @returns {{w_mm:number, h_mm:number}}  A4 → 190 × 277, Letter → 195.9 × 259.4, A3 → 277 × 400 */
export function printableArea(paper)
/** @param {Paper} paper @returns {{w_mm:number, h_mm:number}}  printable − overlap: A4 → 180 × 267, Letter → 185.9 × 249.4, A3 → 267 × 390 */
export function tileStep(paper)
/**
 * Number of tiles needed for a layout of W × H mm: ceil((W − overlap) / step.w) × ceil((H − overlap) / step.h), min 1 × 1.
 * @returns {{cols:number, rows:number, pages:number}}
 */
export function tileCount(paper, W_mm, H_mm)
```

`tileCount` is the formula the export module (section 10) and the acceptance suite (section 13) both use; nothing else may re-derive page counts. Example: an 800 × 1000 mm sheet on A4 → cols = ceil(790/180) = 5, rows = ceil(990/267) = 4, pages = 20.

#### 3.5.2 `ids.js`

```js
/**
 * Unique id: prefix + '_' + counter.toString(36) + 4 random base36 chars. Counter starts at 1 per page load
 * and is module-global (shared by every prefix). Example: uid('piece') → 'piece_1k7x2q'.
 * Randomness: Math.random (no crypto dependency), 4 chars from '0123456789abcdefghijklmnopqrstuvwxyz'.
 * Sample ids are fixed literals ('front', 'back', 'sleeve_l', 'sleeve_r', 'main', 's_shoulder_l', ...) and never produced by uid.
 * @param {string} prefix  non-empty, matches /^[a-z][a-z0-9]*$/ (throws Error{code:'BadPrefix'} otherwise)
 * @returns {string}
 */
export function uid(prefix)
/** Reset the counter (tests only) so ids are reproducible: resetUidCounter(); uid('p') === 'p_1' + 4 random chars. @param {number} [n=0] */
export function resetUidCounter(n)
/** Seed the 4 random chars from a deterministic 32-bit LCG instead of Math.random (tests only; pass null to restore Math.random). @param {number|null} seed */
export function seedUidRandom(seed)
/** True for any non-empty string of [A-Za-z0-9_-] up to 64 chars. */
export function isValidId(s)
/**
 * FNV-1a 32-bit over the UTF-8 bytes of `s`; returns an unsigned integer (0 .. 2^32−1).
 * hashString('') === 2166136261; hashString('a') === 3826002220; hashString('front') === 3782859736; hashString('hello') === 1335831723.
 * Used to seed geometry/prng.js per piece (jittered lattice, section 4) and to give seams a stable hue in the editor.
 * @param {string} s @returns {number}
 */
export function hashString(s)
```

Implementation note for `hashString`: `h = 0x811c9dc5; for each byte b of new TextEncoder().encode(s): h ^= b; h = Math.imul(h, 0x01000193) >>> 0;` return `h >>> 0`. The `TextEncoder` instance is created once at module load.

#### 3.5.3 Self-checks (acceptance group `core.units`)

1. `mmToM(1500) === 1.5`, `mToMm(0.015) === 15` (within 1e-12), `cmToMm(8.8) === 88`, `mmToCm(88) === 8.8`, `cmToM(165) === 1.65`.
2. `fmtMm(123.456) === '123.5 mm'`, `fmtCm(88) === '88.0 cm'`, `fmtMm(NaN) === '—'`.
3. `printableArea(PAPER.A4)` = `{190, 277}`; `tileStep(PAPER.A4)` = `{180, 267}`; `tileCount(PAPER.A4, 800, 1000).pages === 20`; `tileCount(PAPER.A4, 100, 100).pages === 1`.
4. `uid('piece')` matches `/^piece_[0-9a-z]+[0-9a-z]{4}$/`; 10 000 calls produce 10 000 distinct strings; `uid('Bad Prefix')` throws `BadPrefix`.
5. `hashString` values above; `hashString` of a 10 000-char string runs in < 1 ms.

---

### 3.6 `src/core/fabrics.js` — API surface

`fabrics.js` imports only `types.js`. The seven preset rows (ids `cotton`, `denim`, `silk`, `jersey`, `wool`, `leather`, `chiffon`) with every numeric value (`density_kgm2`, `bend_Nm`, `membrane_Nm`, `friction`, `damping`, `thickness_mm`, `meshSpacing_mm`, `roughness`, `sheen`, `sheenRoughness`, `clearcoat`, `opacity`, default `color`, default `texture`) are specified in **section 9.1** and pasted into this file verbatim; this section only fixes the shape and the functions.

```js
/** @type {ReadonlyArray<import('./types.js').FabricPreset>}  order: cotton, denim, silk, jersey, wool, leather, chiffon (section 9.1) */
export const FABRIC_PRESETS
/** @type {ReadonlyArray<string>} the ids in the same order */
export const FABRIC_PRESET_IDS
/** @type {ReadonlyArray<keyof import('./types.js').FabricPhysics>} ['density_kgm2','bend_Nm','membrane_Nm','friction','damping','thickness_mm','meshSpacing_mm'] */
export const PHYSICS_KEYS
/** @type {ReadonlyArray<'solid'|'stripes'|'gingham'|'dots'|'twill'|'knit'>} */
export const TEXTURE_KINDS = Object.freeze(['solid','stripes','gingham','dots','twill','knit']);
/** @type {Readonly<{kind:'solid', scale_mm:20, color2:'#ffffff'}>}  the texture a fabric gets when its preset defines none */
export const DEFAULT_TEXTURE
/** Body skin colour and roughness used by viewer3d/bodyMesh.js: '#c9a58a', 0.8 */
export const BODY_LOOK = Object.freeze({ color: '#c9a58a', roughness: 0.8 });

/** @param {string} id @returns {import('./types.js').FabricPreset}  throws Error{code:'UnknownFabric'} for an unknown id */
export function getPreset(id)
/** @param {string} id @returns {boolean} */
export function hasPreset(id)
/** True for '#rrggbb' (6 hex digits, case-insensitive). Never accepts 3-digit or 8-digit forms. */
export function isHexColor(s)
/**
 * Resolve an instance against its preset:
 *   physics = { ...preset.physics, ...pick(instance.overrides, PHYSICS_KEYS, finite numbers only) }
 *   look    = { ...preset.look, color: instance.color, texture: { ...instance.texture } }   (texture cloned; kind/scale_mm/color2 validated, falling back to preset.look.texture fields)
 *   id, name from the instance.
 * The result is a NEW object every call (safe to keep); throws UnknownFabric if instance.preset is unknown.
 * @param {import('./types.js').FabricInstance} instance @returns {import('./types.js').FabricResolved}
 */
export function resolveFabric(instance)
/** Resolve every instance of a doc. @param {import('./types.js').ProjectDoc} doc @returns {Map<string, import('./types.js').FabricResolved>} keyed by instance id */
export function resolveAll(doc)
/**
 * Compare two resolutions: physicsChanged = any PHYSICS_KEYS value differs (strict !==);
 * lookChanged = color, roughness, sheen, sheenRoughness, clearcoat, opacity or any texture field differs.
 * @returns {{physicsChanged:boolean, lookChanged:boolean}}
 */
export function diffResolved(a, b)
/** Effective fabric for a piece: resolveFabric of doc.fabrics entry with id === piece.fabricId; throws Error{code:'PieceFabric'} when missing. */
export function fabricForPiece(doc, piece)
/** Effective mesh spacing for a piece: clamp(piece.meshSpacing_mm, 8, 40) — the fabric's meshSpacing_mm is only the value the Fabric panel proposes when a preset is applied; it never overrides the piece. */
export function effectiveMeshSpacing(piece)
/**
 * Mix two '#rrggbb' colours in sRGB space: t=0 → a, t=1 → b; components rounded; result lower-case. Used for seam hues and sheenColor.
 */
export function mixHex(a, b, t)
```

Rules:

* `FABRIC_PRESETS` and each preset object are frozen (`Object.freeze` deep); consumers never mutate them. `resolveFabric` output is not frozen.
* `sim.bendScale` / `sim.stretchScale` are **not** applied here; `cloth/state.js` multiplies them into `bAlpha` / `eAlpha` at build and `cloth/index.js setFabric` rewrites those arrays in place on `fabric:changed` (section 7).
* Unknown texture kinds fall back to the preset's texture kind; an unknown preset id is an error (validateShape reports `FabricPreset` before the store accepts it, so `resolveFabric` throwing is a programming error in practice).
* Colour strings are stored lower-case `#rrggbb`; `isHexColor` is the single validator used by schema, the Fabric panel and debugApi.

Self-checks (acceptance group `core.fabrics`): `FABRIC_PRESET_IDS.length === 7` in the order above; every preset passes `isHexColor(look.color)` and `TEXTURE_KINDS.includes(look.texture.kind)`; `resolveFabric({id:'x', name:'x', preset:'denim', color:'#112233', texture:{kind:'solid', scale_mm:20, color2:'#ffffff'}, overrides:{friction:0.9}})` returns `physics.friction === 0.9`, every other physics value equal to the denim preset, `look.color === '#112233'`, `look.texture.kind === 'solid'`, and `look.roughness` equal to the preset's; overrides with non-physics keys or NaN are ignored; `getPreset('nope')` throws `UnknownFabric`; `mixHex('#000000','#ffffff',0.5) === '#808080'`.

---

### 3.7 `src/core/sdf.js` — SdfGrid helpers

`sdf.js` imports only `types.js`. It is consumed by `cloth/collide.js` (per vertex per substep), `body/bake.js` (grid construction, section 6), `body/measure.js`, `cloth/testfields.js` and `debugApi.body.sdf`. The `SdfGrid` layout (section 3.1): `data[i + nx*(j + ny*k)]` is the signed distance in metres at world point `origin + cell*[i, j, k]`, negative inside the body.

```js
export const SDF_OUTSIDE = 1;        // distance returned outside the grid (metres)
export const SDF_EPS_GRAD = 1e-9;    // gradient norm below which (0,1,0) is returned

/** Flat index of node (i,j,k). No bounds check. @returns {number} i + nx*(j + ny*k) */
export function gridIndex(grid, i, j, k)
/**
 * True when the point lies inside the sampled box [origin, origin + cell*(n-1)] on all three axes (closed interval).
 * Used by collide.js as the broad phase: vertices outside are skipped entirely.
 */
export function gridContains(grid, x, y, z)
/** @returns {{min: import('./types.js').Vec3, max: import('./types.js').Vec3}}  world AABB of the sampled box (new arrays; not for per-frame use) */
export function gridBounds(grid)
/**
 * Trilinear signed distance at (x,y,z) with the ANALYTIC gradient of the same trilinear interpolant.
 * @param {import('./types.js').SdfGrid} grid
 * @param {number} x @param {number} y @param {number} z   metres
 * @param {Float32Array|Float64Array|number[]|null} outGrad   if non-null, receives the UNIT gradient at [0],[1],[2]
 * @returns {number} distance in metres; +SDF_OUTSIDE with outGrad = (0,1,0) when !gridContains(grid,x,y,z)
 */
export function sampleSdf(grid, x, y, z, outGrad)
/**
 * Fill a grid from an analytic function (test fields and body bake). fn(x,y,z) → metres. Allocates the grid.
 * @param {import('./types.js').Vec3} origin @param {number} cell @param {number} nx @param {number} ny @param {number} nz
 * @param {(x:number, y:number, z:number) => number} fn
 * @returns {import('./types.js').SdfGrid}
 */
export function makeGridFromFn(origin, cell, nx, ny, nz, fn)
/**
 * Exact sphere field on a grid: origin = centre − (radius + pad) per axis, n = ceil(2(radius + pad)/cell) + 1 per axis,
 * data = |p − centre| − radius. makeSphereGrid([0,0,0], 0.5, 0.015, 0.05) → 75³ nodes (421 875 floats, 1.7 MB).
 * @param {import('./types.js').Vec3} centre @param {number} radius @param {number} cell @param {number} pad
 */
export function makeSphereGrid(centre, radius, cell, pad)
/**
 * Exact capsule field (segment a→b, radius r): AABB of the segment expanded by radius + pad; data = |p − closestPointOnSegment(p)| − r.
 * @param {import('./types.js').Vec3} a @param {import('./types.js').Vec3} b @param {number} radius @param {number} cell @param {number} pad
 */
export function makeCapsuleGrid(a, b, radius, cell, pad)
/**
 * Exact analytic sphere distance — the reference sampleSdf is tested against. @returns {number}
 */
export function sphereDistance(centre, radius, x, y, z, outGrad)
```

#### 3.7.1 `sampleSdf` algorithm (per call, zero allocation)

1. `u = (x − ox)/cell, v = (y − oy)/cell, w = (z − oz)/cell`. If `u < 0 || v < 0 || w < 0 || u > nx−1 || v > ny−1 || w > nz−1` → if `outGrad`: `outGrad[0]=0; outGrad[1]=1; outGrad[2]=0`; return `SDF_OUTSIDE`. (This is exactly `!gridContains`.)
2. `i = min(floor(u), nx−2)`, `j = min(floor(v), ny−2)`, `k = min(floor(w), nz−2)` (the `min` handles a point exactly on the far face); `fx = u − i, fy = v − j, fz = w − k` (each in [0,1]).
3. Corner reads (eight `data[]` loads, `s = nx`, `t = nx*ny`, `base = i + s*j + t*k`):
   `c000 = data[base]`, `c100 = data[base+1]`, `c010 = data[base+s]`, `c110 = data[base+s+1]`, `c001 = data[base+t]`, `c101 = data[base+t+1]`, `c011 = data[base+t+s]`, `c111 = data[base+t+s+1]`.
4. Interpolate along x: `c00 = c000 + (c100−c000)fx; c10 = c010 + (c110−c010)fx; c01 = c001 + (c101−c001)fx; c11 = c011 + (c111−c011)fx`; along y: `c0 = c00 + (c10−c00)fy; c1 = c01 + (c11−c01)fy`; along z: `d = c0 + (c1−c0)fz`.
5. If `outGrad` is null return `d`. Otherwise the partial derivatives of the same trilinear form (exact, no extra samples):
   * `gx = ( ((c100−c000)(1−fy) + (c110−c010)fy)(1−fz) + ((c101−c001)(1−fy) + (c111−c011)fy)fz ) / cell`
   * `gy = ( (c10−c00)(1−fz) + (c11−c01)fz ) / cell`
   * `gz = (c1 − c0) / cell`
6. `n2 = gx²+gy²+gz²`; if `n2 < SDF_EPS_GRAD²` → `outGrad = (0,1,0)`; else `inv = 1/sqrt(n2)`; `outGrad = (gx·inv, gy·inv, gz·inv)`. Return `d`.

Properties the implementation relies on: the value is C0 across cell faces and the gradient is the exact derivative of the interpolant inside each cell (it jumps across faces, which is acceptable because the body bake smooths joints with `smin`, section 6.3). Central differences are **not** used (7× the cost for a coarser result — judge correction). Cost: 8 loads, ~40 flops.

#### 3.7.2 Zero-allocation rule

`sampleSdf`, `gridIndex`, `gridContains` and `sphereDistance` must not allocate: no object/array literals, no closures, no destructuring, no `Math.hypot`; `outGrad` is caller-owned. Callers that sample per vertex per substep (`cloth/collide.js`) keep one module-level `Float32Array(3)` scratch. `gridBounds`, `makeGridFromFn`, `makeSphereGrid`, `makeCapsuleGrid` allocate and are called only at build time. A `SdfGrid` is immutable once built; a rebuild produces a **new** grid object that the owner swaps in atomically (`ClothState` collides with the old grid until then — section 7).

#### 3.7.3 Self-checks (acceptance group `core.sdf`)

1. `g = makeSphereGrid([0,0,0], 0.5, 0.015, 0.05)`: `g.nx === g.ny === g.nz === 75`, `g.origin` = `[-0.55,-0.55,-0.55]`, `g.data.length === 421875`.
2. For 1000 deterministic points (LCG seed 7) inside the sphere box: `|sampleSdf(g, p) − sphereDistance(p)| < 0.6 mm` (trilinear error bound for a 15 mm cell on a 0.5 m sphere is `cell²/(8R)` ≈ 0.06 mm away from the centre; the 0.6 mm tolerance covers cells near the centre).
3. Gradient: for the same points at distance > 2 cells from the centre, the angle between `outGrad` and `p/|p|` is < 2°; `|outGrad| === 1` within 1e-6.
4. `sampleSdf(g, 0, 0, 0)` ≈ −0.5 (within 1 mm); `sampleSdf(g, 5, 5, 5, grad) === 1` and `grad` = `(0,1,0)`; `gridContains(g, 0.55, 0, 0) === true`, `gridContains(g, 0.5501, 0, 0) === false`.
5. Analytic gradient equals a central finite difference of `sampleSdf` (ε = 1e-4 m) within 1e-4 at 100 interior points not on cell faces — this is the check that the derivative formulas were transcribed correctly.
6. `makeCapsuleGrid([0,-0.2,0],[0,0.2,0], 0.03, 0.01, 0.02)`: value at `(0,0,0)` ≈ −0.03, at `(0,0.3,0)` ≈ +0.07 (within 1 mm each).
7. 1 000 000 `sampleSdf` calls with gradient run in < 60 ms on the reference laptop (guards the zero-allocation rule; measured with `performance.now()`).

---

**PROPOSED types.js amendment:** none. All payload typedefs (`DocChanged`, `Selection`, `ToolName`, `HoverChanged`, `SeamPreview`, `BodyBuilt`, `MeshBuilt`, `SimPhase`, `FabricChanged`, `UiStatus`, …) live in `events.js`; `TransientState` and `Batch` live in `store.js`; `Paper` lives in `units.js`. No field is added to any section 3.1 typedef.
