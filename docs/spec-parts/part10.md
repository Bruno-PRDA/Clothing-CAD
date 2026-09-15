## 12. Application layer — `src/app/` (agent A8)

`src/app/` is the composition root. It owns three files and nothing else:

| File | Role |
|---|---|
| `src/app/main.js` | Boot sequence: URL params, store creation, module init in a fixed order, first drape, `window.__app.ready`, console banner, never-blank-screen error handling. |
| `src/app/wiring.js` | **The reaction table.** The only file in the repository that calls one module's API in reaction to another module's event (section 2). Also owns the per-frame tick and the debounced rebuild pipeline. |
| `src/app/debugApi.js` | `window.__app` — the automation/debug surface used by `tests/acceptance.js` (section 13), by Chromium automation and by the user from devtools. |

`src/app/` imports everything (section 2 dependency rules: `app -> everything`). No other module imports `src/app/`.

Vocabulary used below:

* **doc** — the current `ProjectDoc` held by the store (section 3.3).
* **ctx** — the `AppContext` object (12.0) shared by the three files.
* **pipeline** — validate → remesh → build cloth → arrange → drape. Every path that changes simulated geometry goes through the same functions in `wiring.js`, whether triggered by the boot, by a UI event or by `__app`.
* **flush** — running every pending debounced pipeline step synchronously, now. Every `__app` mutation flushes before it returns, so automation never observes a half-updated app.

### 12.0 The `AppContext` and the module surface A8 consumes

`wiring.js` declares one app-internal typedef (it is **not** added to `src/core/types.js`; nothing outside `src/app/` and `tests/` sees it):

```js
/**
 * App-internal composition state (src/app only). Not part of the frozen core contracts.
 * @typedef {Object} AppContext
 * @property {import('../core/store.js').Store} store
 * @property {import('../core/events.js').EventBus} bus
 * @property {{sample:string|null, nosim:boolean, size:string|null}} params   parsed URL params (12.1.2)
 * @property {HTMLElement} root                                  document.body
 * @property {Object} mods                                       module handles; a failed module is null
 * @property {Object|null} mods.ui        return value of src/ui/index.js createUi()
 * @property {Object|null} mods.editor    return value of src/pattern/index.js createEditor()
 * @property {Object|null} mods.viewer    return value of src/viewer3d/index.js createViewer()
 * @property {{model: BodyModel|null, quality:'full'|'coarse'|null, key:number}} body
 * @property {{byPiece: Map<string, PieceMesh>, failed: Map<string, string>, keys: Map<string, number>, spacingFactor:number}} mesh
 * @property {{state: ClothState|null, stale:boolean, lastStats: SimStats|null, running:boolean, userPaused:boolean, phase:string, stepping:boolean, nanEvents:number[]}} cloth
 * @property {{build: Map<string, number>, arrange: Map<string, number>, seams:number, body:number, fabrics: Map<string, number>, sim:number, sizes:number}} keys   fingerprints (12.2.3)
 * @property {{remeshTimer:number, remeshSet:Set<string>, remeshAll:boolean, bodyTimer:number, bodyQuality:'full'|'coarse'|null, dragTimer:number, dragParams:BodyParams|null}} pending
 * @property {{stage:string, code:string, message:string}[]} bootErrors
 * @property {{t:number, level:'info'|'warn'|'error', message:string, code:string|null}[]} log   ring buffer, last 200 entries
 * @property {number} lastStatsPush   performance.now() of the last status-bar stats push
 * @property {number} bootStartMs
 */
```

**Module functions that `src/app/` calls.** Each row names the capability A8 relies on and the export name expected from the owning module's `index.js`. The owning section is authoritative for the exact name and argument order; if it differs, **A8 adapts the call site in `wiring.js`/`debugApi.js`** (the consumer adapts, never the contract). The *semantics* in the third column are what A8 depends on and must hold.

| Module (section) | Expected export | Semantics A8 relies on |
|---|---|---|
| `src/core/store.js` (3.3) | `createStore(doc)` → `store` with `get()`, `update(fn, {label, hints})`, `undo()`, `redo()`, `load(doc)`, `subscribe(fn)`, `canUndo()`, `canRedo()` | `update` clones, applies `fn`, pushes history, emits `EVENT.DOC_CHANGED` with `{doc, label, hints, source}`; `load` replaces the doc, clears history and emits `EVENT.DOC_LOADED`. Synchronous. |
| `src/core/events.js` (3.2) | `bus` (or `createBus()`), `EVENT` name constants | `bus.on(name, fn)` returns an unsubscribe function; `bus.emit(name, payload)` is synchronous; a throwing listener is caught by the bus, logged, and does not stop other listeners. |
| `src/core/schema.js` (3.3) | `normalizeDoc(partial)` → `ProjectDoc`, `serializeDoc(doc)` → string, `validateShape(doc)` → `Issue[]` | `normalizeDoc({})` yields a complete empty document: `name:'Untitled'`, body preset `female_m` with its params, one fabric `{id:'main', preset:'cotton'}`, no pieces, no seams, the default size chart (S/M/L/XL, base M), default `SimSettings`, default `UiState` (`layout:'split'`, `split:0.5`, `activeSize:'M'`, `dockTab:'pieces'`). |
| `src/core/fabrics.js` (9.1) | `FABRIC_PRESETS`, `resolveFabric(instance)` → `FabricResolved` | Pure. |
| `src/core/sdf.js` | `sampleSdf(grid, x, y, z, out)` | `out[0]` = signed distance (m), `out[1..3]` = gradient; outside the grid `d = +1`. |
| `src/core/ids.js` | `uid(prefix)`, `hashString(s)` → uint32 | Deterministic hash (used for fingerprints). |
| `src/samples/index.js` (4.4) | `SAMPLE_IDS` (`['tshirt','skirt']`), `getSample(id)` → `ProjectDoc` | Returns a fresh deep copy each call; unknown id → `undefined`. |
| `src/geometry/index.js` (remesh, section 5) | `remeshPiece(piece, doc)` → `PieceMesh`; throws `Error` with `code:'RemeshError'` | Uses `doc.seams` for seam-consistent boundary sampling (partner edge lengths), mirrors fold pieces, honours `piece.meshSpacing_mm`. Pure, synchronous, ≤ 200 ms for the largest sample piece. A8 passes an *effective* piece whose `meshSpacing_mm` may have been raised (12.2.5). |
| `src/pattern/index.js` (4) | `createEditor(canvasEl, store, bus)` → `editor` with `resize()`, `fit()`, `worldToScreen(x_mm, y_mm)` → `[px, py]`, `screenToWorld(px, py)` → `[x_mm, y_mm]`, `setTool(name)`, `getTool()`, `select(ids)`, `getSelection()`, `setGhost(pieces|null)`, `setIssues(issues)`, `destroy()`; `validateDoc(doc)` → `Issue[]`; `seamLengths(seam, doc)` → `{lenA_mm, lenB_mm}`; `autoReverse(a, b, doc)` → boolean | The editor writes to the store only on pointer-up (one undoable `update` per drag), never per pointer-move; per-move feedback is drawn locally. `px, py` are CSS pixels relative to the canvas top-left. Tool names: `select, draw, edit, split, seam, notch, grainline, measure`. |
| `src/body/index.js` (6) | `buildBody(params, {cell})` → `BodyModel`; `BODY_PRESETS` (`Record<string, BodyParams>`), `DEFAULT_PRESET_ID` (`'female_m'`), `clampParams(params)` → `BodyParams` | Synchronous. `cell = 0.015` (full) or `0.030` (coarse). Full build of `female_m` ≤ 400 ms; coarse ≤ 80 ms. |
| `src/cloth/index.js` (7) | `buildCloth({meshes, doc, fabrics})` → `ClothState`; `arrange(state, body, doc)`; `pushOut(state, sdf)`; `step(state, sdf)` → `SimStats`; `reset(state)`; `setFabricParams(state, pieceIndex, fabric)`; `setSettings(state, simSettings)`; `setScale(state, bend, stretch)`; `stats(state)` → `SimStats`; `snapshot(state)` → `{frame,time,pos,vel}`; `restore(state, snap)` | `step` advances exactly one frame (`dt = 1/60`, `substeps` from `state.params`) and is deterministic. `arrange` writes `pos`, `prev`, `restPos`, `pTarget`, zeroes `vel`, sets `time = 0`, `frame = 0`, `sStart` per seam. NaN guard inside `step` restores the solver's own periodic snapshot and increments `state.nanCount`. The SDF is passed per call so A8 can swap grids atomically by changing one reference (`ctx.body.model.sdf`). |
| `src/viewer3d/index.js` (8) | `createViewer(containerEl)` → `viewer` with `resize()`, `frame(bounds)`, `screenshotDataUrl()`, `fps()`, `dispose()`; `viewer.loop` with `setTick(fn)`, `pause()`, `resume()`, `renderOnce()`, `isPaused()`; `viewer.clothMesh` with `setState(state, fabricsById)`, `updatePositions(state)`, `setMaterial(pieceId, resolved)`, `highlight(pieceIds)`; `viewer.bodyMesh` with `update(bodyModel)`; `viewer.anchorsGizmo` with `show(anchors, selectedAnchor|null)`, `hide()` | `loop.setTick(fn)` calls `fn(nowMs)` once per rAF **before** the render. `renderOnce()` renders synchronously even while paused. `screenshotDataUrl()` renders once then reads the canvas in the same task (no `preserveDrawingBuffer`). |
| `src/sizing/index.js` (10) | `gradeDoc(doc, sizeName)` → `Piece[]` (all pieces, graded, same ids); `closestSize(chart, params)` → `{name, score}`; `sizeRow(chart, name)` | Pure. `gradeDoc(doc, chart.baseSize)` returns deep copies equal to `doc.pieces`. |
| `src/export/index.js` (10) | `sheetSvg(doc, size)` → string; `pieceSvg(doc, pieceId, size)` → string; `printHtml(doc, size, paper)` → string; `pageCount(doc, size, paper)` → number; `sizeChartCsv(chart)` → string; `pieceCsv(doc)` → string; `sizeChartJson(chart)` → string; `clothObj(state, body)` → string; `download(filename, text, mime)` | All return strings; only `download` touches the DOM. `paper ∈ {'A4','Letter','A3'}`. |
| `src/ui/index.js` (11) | `createUi(root, store, bus)` → `ui` with `layout` (`set(mode)`, `swap()`, `setSplit(f)`, `get()`), `toolbar` (`setSimPhase(phase, running)`, `setTool(name)`), `dock` (`show(tab)`, `get()`), `statusbar` (`message(level, text, code)`, `setSim(stats, fps)`, `setIssues(issues)`, `setMesh(meshSummary)`), `panels` (`body.setModel(model, quality)`, `pieces.refresh()`, `sizes.setClosest(name)`), `setSelection(sel)`, `elements()` → `string[]` (every id of section 11) | Panels write to the store themselves via `store.update`; the body panel additionally emits `EVENT.BODY_PARAMS_DRAG` on every slider `input` event (doc untouched) and `EVENT.BODY_PARAMS_COMMIT` on `change`/pointer-up **after** its `store.update`. |

### 12.1 `src/app/main.js` — boot sequence

```js
export const APP_VERSION = '1.0.0';
/** @type {{version:string, built:string, three:string, url:string}} filled at boot */
export const BUILD_INFO;
/**
 * Boots the application into document.body. Idempotent: a second call returns the first promise.
 * @param {{root?: HTMLElement, search?: string}} [opts]  defaults: document.body, location.search
 * @returns {Promise<BootResult>}  never rejects
 */
export function boot(opts);
/** @typedef {{ok:boolean, ms:number, errors:{stage:string, code:string, message:string}[], stages:Record<string, number>}} BootResult  stages = ms per stage */
```

`index.html` loads `main.js` with `<script type="module" src="src/app/main.js">`; the module calls `boot()` at import time (after `DOMContentLoaded` if the document is still loading). `window.__app` is installed **before** any stage runs (12.1.4) so automation can `await __app.ready` even when a stage fails.

#### 12.1.1 Console banner

First statement of `boot()`:

```
console.info('%cClothing App %s', 'font-weight:bold', APP_VERSION,
  { built: BUILD_INFO.built, three: THREE.REVISION, params: ctx.params, ua: navigator.userAgent });
```

`BUILD_INFO.built` is a literal ISO date string maintained by hand in `main.js` (`'2026-09-11'` for v1; there is no build step). At the end of the boot a second line is printed: `Clothing App ready in 1234 ms — verts 2612, body full 312 ms, errors 0` (or `errors N: <stage: message>` lines at `console.warn` level). Boot never writes `console.error` unless a stage failed; acceptance (section 13) asserts "no console errors on a clean boot".

#### 12.1.2 URL parameters

Parsed with `new URLSearchParams(location.search)`; unknown parameters are ignored.

| Param | Values | Default | Effect |
|---|---|---|---|
| `sample` | `tshirt`, `skirt`, `none` | `tshirt` | Initial document: `getSample(id)`; `none` = `normalizeDoc({})` (empty doc); an unknown id logs a warning and falls back to `tshirt`. |
| `nosim` | `1` | absent | `ctx.cloth.userPaused = true`: the pipeline still meshes, builds and arranges, but does not start the drape; the toolbar shows the Play state. |
| `size` | a row name of the doc's size chart | doc's `ui.activeSize` | Overrides `ui.activeSize` after normalisation (unknown name → warning, ignored). |

Examples: `http://localhost:8710/?sample=skirt`, `http://localhost:8710/?nosim=1&size=L`.

#### 12.1.3 Stage order

Every stage runs inside `stage(name, fn)`:

```js
function stage(ctx, name, fn) {
  const t0 = performance.now();
  try { const r = fn(); ctx.stagesMs[name] = performance.now() - t0; return r; }
  catch (e) {
    const code = e && e.code ? String(e.code) : 'E_BOOT_STAGE';
    ctx.bootErrors.push({ stage: name, code, message: String(e && e.message || e) });
    console.error(`[boot] stage "${name}" failed:`, e);
    showStatus(ctx, 'error', `${name} failed: ${e.message || e}`, code);
    return null;
  }
}
```

Stages, in order, each skipped (with a `bootErrors` entry `code:'E_SKIPPED'`) when a stage it depends on returned `null`:

| # | Stage name | What it does | Depends on | Budget (desktop Chromium) |
|---|---|---|---|---|
| 1 | `params` | Parse URL params → `ctx.params`. | — | < 1 ms |
| 2 | `store` | `doc = getSample(id)` or `normalizeDoc({})`; apply `?size`; `normalizeDoc` + `validateShape` (issues with `level:'error'` → throw `E_BAD_DOC`); `ctx.store = createStore(doc)`. On failure fall back to `createStore(normalizeDoc({}))` so the app still boots empty. | — | < 10 ms |
| 3 | `api` | `installDebugApi(ctx, wiring)` (12.3) — installs `window.__app` with `ready` pending. Actually done before stage 1 (see 12.1.4); listed here for the stage table only. | — | < 1 ms |
| 4 | `ui` | `ctx.mods.ui = createUi(document.body, store, bus)`: builds toolbar/dock/statusbar/shortcuts behaviour on the static `index.html` skeleton (ids of section 11); applies `doc.ui.layout/split/swapped/dockTab`. | store | < 30 ms |
| 5 | `editor` | `ctx.mods.editor = createEditor(document.getElementById('pattern-canvas'), store, bus)`; `editor.fit()`. | ui (canvas element exists in the skeleton even if `ui` failed, so this stage only depends on `store`) | < 30 ms |
| 6 | `viewer` | `ctx.mods.viewer = createViewer(document.getElementById('pane-3d'))`: WebGL2 renderer, camera, controls, lights; `loop.setTick(wiring.tick)`; loop starts rendering an empty scene immediately (a frame renders even if everything after fails). | store | < 150 ms (+ CDN fetch of three, outside the budget) |
| 7 | `body` | `wiring.buildBody('full')` → `ctx.body.model`; `viewer.bodyMesh.update(model)`; `ui.panels.body.setModel(model,'full')`; `viewer.frame(body bounds)`. | viewer (mesh update is skipped, not failed, if viewer is null) | ≤ 400 ms |
| 8 | `remesh` | `wiring.remesh(null, {force:true})` — all `simulate` pieces; `RemeshError` on a piece excludes that piece and records `ctx.mesh.failed`; the stage itself fails only if *every* piece failed. | store | ≤ 250 ms (T-shirt sample) |
| 9 | `cloth` | `wiring.rebuildCloth()` → `ctx.cloth.state`; `viewer.clothMesh.setState(state, fabrics)`. | remesh (≥ 1 mesh), body (arrangement needs anchors; without a body the stage is skipped) | ≤ 100 ms |
| 10 | `arrange` | `wiring.arrange()` — `cloth.arrange(state, body, doc)` then `cloth.pushOut(state, sdf)` (every vertex with `d < clearance` is moved out along the SDF normal before the first step — graft from patternmaking-first). | cloth | ≤ 20 ms |
| 11 | `drape` | Unless `ctx.cloth.userPaused`: `wiring.drape()` — `time = 0`, `running = true`, phase `sewing`, `EVENT.SIM_PHASE`. With `?nosim=1`: phase `ready`, paused. | arrange | < 1 ms |
| 12 | `wire` | `wiring.start()` — subscribes to every event of 12.2. Done last so that no reaction fires during the boot's own pipeline calls. | store | < 1 ms |

Total budget from `boot()` entry to `ready` resolution: **≤ 1.5 s** on the target machine excluding network; acceptance (section 13) allows 5 s including the CDN fetch.

After stage 12, `boot()` waits for the **first rendered frame after the drape started** (`viewer.loop` resolves a one-shot promise on the next rAF that completed a render; if the viewer failed, a `setTimeout(0)` substitute) and then resolves `ready`.

#### 12.1.4 `window.__app.ready`

* Installed synchronously at the top of `boot()` as `new Promise(resolve => ctx.resolveReady = resolve)`; `__app.ready` **never rejects**.
* Resolves with the `BootResult` (`{ok, ms, errors, stages}`) when either (a) stage 12 finished and the first frame rendered, or (b) the watchdog fires: `setTimeout(20000)` from `boot()` entry → resolves with `ok:false` and an extra error `{stage:'watchdog', code:'E_BOOT_TIMEOUT'}`.
* `ok === (errors.length === 0)`.
* Also mirrored on `document.documentElement.dataset.appReady = 'true'|'error'` and the status bar shows `Ready — <sample> · <V> verts · <ms> ms` (or the first error) so a human sees the same thing.

#### 12.1.5 Never a blank screen

* `index.html` (section 11) contains the full static shell; `main.js` only attaches behaviour. A failing stage therefore leaves the skeleton, the status bar and whatever earlier stages built (an empty 3D scene still renders after stage 6).
* `showStatus(ctx, level, text, code)` prefers `ui.statusbar.message`; when `ui` is null it writes to `#status-message` directly (id from section 11); when that element is missing it creates `<div id="boot-error">` fixed at the bottom of `document.body` (red background, monospace, the message and the stage name). Every message is also appended to `ctx.log`.
* A `window.addEventListener('error')` / `'unhandledrejection'` pair installed at the top of `boot()` routes uncaught errors to `showStatus('error', …, 'E_UNCAUGHT')` and `ctx.log`; the loop keeps running.
* The `three` import is the only thing that can fail before `boot()` runs (CDN unreachable). `index.html` therefore carries a 6 s inline `<script>` watchdog (Lead, Phase 0) that writes "three.js failed to load from cdn.jsdelivr.net — check the network" into `#status-message` if `window.__app` is still undefined; `main.js` clears it.

### 12.2 `src/app/wiring.js` — the reaction table

```js
/**
 * @param {AppContext} ctx
 * @returns {Wiring}
 */
export function createWiring(ctx);

/**
 * @typedef {Object} Wiring
 * @property {() => void} start                 subscribe to bus + install the loop tick (idempotent)
 * @property {() => void} stop                  unsubscribe everything, cancel timers
 * @property {() => void} flush                 run every pending debounced job now (remesh/rebuild, body full/coarse)
 * @property {() => {remesh:boolean, body:'full'|'coarse'|null}} pending
 * @property {(opts?: {drape?: boolean}) => void} rebuildAll   validate + remesh all + rebuildCloth + arrange (+ drape unless userPaused or opts.drape === false)
 * @property {(pieceIds: string[]|null, opts?: {force?: boolean}) => PieceMesh[]} remesh   null = all simulate pieces; force ignores fingerprints
 * @property {() => ClothState|null} rebuildCloth
 * @property {() => void} arrange
 * @property {() => void} drape                 arrange-if-needed + time=0 + running=true (sets userPaused=false)
 * @property {() => void} play
 * @property {() => void} pause                 sets userPaused=true
 * @property {() => void} reset                 cloth.reset(state) (positions=restPos, time=0), running unchanged
 * @property {(quality:'full'|'coarse', params?: BodyParams) => BodyModel|null} buildBody
 * @property {(fabricId: string) => void} applyFabric
 * @property {() => void} applySimSettings
 * @property {(name: string) => void} setActiveSize
 * @property {(n: number) => SimStats} stepFrames     synchronous, rendering suppressed (12.3 sim.step)
 * @property {(nowMs: number) => void} tick           the per-frame tick (12.2.6); exported so tests can call it
 * @property {(doc: ProjectDoc) => Keys} computeKeys  fingerprints (12.2.3)
 */
```

`start()` subscribes with `bus.on` and keeps the unsubscribe functions; `stop()` calls them and `clearTimeout`s every pending timer. All handlers are wrapped by `guard(name, fn)`: any exception is caught, logged (`ctx.log`, `console.error`), shown in the status bar as `level:'error'` with the error's `.code` (or `E_REACTION`), and the app continues; the cloth state in use before the handler ran stays in use (`ctx.cloth.stale = true` when the handler was a rebuild).

#### 12.2.1 Event → handler table

Event names are the `EVENT` constants of section 3.2 (string values shown for readability). Payload columns state what wiring **reads**; extra payload fields are ignored.

| Event (emitter) | Payload read | Handler (wiring) |
|---|---|---|
| `doc:changed` (store, on `update`/`undo`/`redo`) | `{doc, hints, source, label}` | `onDocChanged` (12.2.2): diff fingerprints (restricted to `hints` groups when present), then schedule remesh/rebuild (debounced 120 ms), body full build (debounced 150 ms), in-place fabric/sim updates (immediate), size ghost refresh (immediate). |
| `doc:loaded` (store, on `load`) | `{doc}` | Reset all fingerprints and caches (`ctx.mesh.byPiece.clear()`, `failed.clear()`, `spacingFactor = 1`), cancel pending timers, `ctx.cloth.userPaused = ctx.params.nosim` (a load re-enables auto-drape unless `?nosim=1`), `buildBody('full')` (only if the body fingerprint changed), `rebuildAll()`, `editor.fit()`, `viewer.frame()`, `ui.layout.set(doc.ui.layout)`, `setActiveSize(doc.ui.activeSize)`. |
| `body:params:drag` (body panel, per slider `input`) | `{params}` | `ctx.pending.dragParams = clampParams(params)`; throttle **100 ms leading + trailing**: if no coarse build ran in the last 100 ms build now, else arm `dragTimer` for the remainder. Build = `buildBody('coarse', params)` → `ctx.body.model` swap (atomic: single reference assignment; the solver reads `ctx.body.model.sdf` at the next `step`), `viewer.bodyMesh.update(model)`, `ui.panels.body.setModel(model,'coarse')`. The cloth keeps running; the solver's gentle re-projection (section 7: at most 5 mm per frame) pushes vertices out of the enlarged body. No arrange, no remesh. |
| `body:params:commit` (body panel, on release, after its `store.update`) | `{params}` | Cancel `dragTimer`; `requestBodyBuild('full')` (debounced 150 ms, coalesced with the `doc:changed` body diff that arrives from the same `store.update`). After the build: SDF swap as above, `ui.panels.body.setModel(model,'full')`, `ui.panels.sizes.setClosest(closestSize(chart, params).name)`, emit `body:built {quality:'full', buildMs, measured}`. Never re-arranges the cloth; the new anchors are used by the next `arrange()`. |
| `fabric:changed` (fabric panel, after its `store.update`) | `{fabricId}` | `applyFabric(fabricId)`: `resolved = resolveFabric(instance)`; for every `state.pieces[k]` with `pieceId`'s `fabricId === id`: `cloth.setFabricParams(state, k, resolved)` (rewrites `invMass`, `mu`, `damp`, `clearance`, `eAlpha`, `bAlpha` slices in place, section 7); `viewer.clothMesh.setMaterial(pieceId, resolved)`; `editor` fill colour refresh happens through its own store subscription. Immediate; no rebuild. (Also reached from `doc:changed` when the fabric fingerprint differs, e.g. undo.) |
| `size:active` (sizes panel / size dropdown, after `store.update` of `ui.activeSize`) | `{name}` | `setActiveSize(name)`: `graded = name === chart.baseSize ? null : gradeDoc(doc, name)`; `editor.setGhost(graded)` (graded outlines drawn as a dashed ghost behind the base pieces); the export buttons' size label is read from `doc.ui.activeSize` by the UI itself. Never affects the simulation (it always simulates the base size on the current body). |
| `selection:changed` (editor) | `{pieceIds, seamIds}` | `ui.setSelection(sel)`; `viewer.clothMesh.highlight(pieceIds)`; if exactly one piece selected and a body exists: `viewer.anchorsGizmo.show(body.anchors, piece.placement.anchor)` else `hide()`; status bar selection text (`Front · 4 vertices · seams 3`, or for a seam the ease readout `A 312 mm / B 328 mm — ease 5.1 %`, graft from patternmaking-first). |
| `tool:changed` (editor) | `{tool}` | `ui.toolbar.setTool(tool)`; status-bar hint text per tool (section 11 table of hints). |
| `sim:phase` (wiring itself, cloth) | `{phase, running}` | `ui.toolbar.setSimPhase(phase, running)` (Play/Pause/Reset/Drape button enabled states and the play icon). |
| `sim:nan` (cloth, from inside `step`) | `{frame, restoredFrame}` | Push `performance.now()` to `ctx.cloth.nanEvents` (keep last 10); status `warn` "Solver recovered from NaN (frame F, restored snapshot R)"; if ≥ 3 events within 10 s: `pause()`, status `error` "Simulation paused: repeated instability — press Reset or Drape", phase `error`. |
| `ui:layout` (ui/layout.js, after divider drag / swap / layout mode / popout) | `{layout, swapped, split}` | `editor.resize()`; `viewer.resize()`; if `layout === '2d'` → `viewer.loop.pause()` (no hidden rendering; the sim still steps — see 12.2.6) else `viewer.loop.resume()`. Also called once at the end of boot. |
| `window` `resize` (DOM) | — | Same as `ui:layout` (resize only). |
| `popout:changed` (viewer3d/popout bridge, optional feature) | `{open}` | `open` → `ui.layout.set('2d')` and pause the in-window loop; `!open` → restore `doc.ui.layout`. Not part of the automated acceptance (judges' correction: popups are not automatable). |

Events **emitted by wiring** (consumed by ui panels, the status bar, `tests/acceptance.js`): `body:built {quality, buildMs, measured}`, `mesh:built {summary}` (12.3 `mesh.stats()` shape), `cloth:built {V, tris, constraints}`, `sim:phase {phase, running, time}`, `sim:stats SimStats` (10 Hz, only while running or stepping), `status:message {level, text, code}`. These names must exist in section 3.2's `EVENT` table; if one is missing it is a proposed addition (end of this section).

#### 12.2.2 `onDocChanged` decision procedure

```
onDocChanged({doc, hints, source}):
  1. groups = hints && !hints.all ? Object.keys(hints) : ['pieces','seams','body','fabrics','sim','sizes','ui']
  2. keys = computeKeys(doc)                                   // 12.2.3, restricted to groups
  3. remeshSet = ∅ ; rebuild = false ; rearrange = false
     if 'pieces' ∈ groups or 'seams' ∈ groups:
        for each piece p with p.simulate:
           if keys.mesh[p.id] !== ctx.mesh.keys[p.id]           → remeshSet += p.id ; rebuild = true
           else if keys.build[p.id] !== ctx.keys.build[p.id]    → rebuild = true
           else if keys.arrange[p.id] !== ctx.keys.arrange[p.id]→ rearrange = true
        for each cached mesh whose piece was removed or has simulate === false → drop it ; rebuild = true
        if keys.seams !== ctx.keys.seams                         → rebuild = true   (mesh keys already cover pieces whose sampling changed)
  4. if rebuild or remeshSet ≠ ∅:   scheduleRemesh(remeshSet)  // debounce 120 ms trailing; sets pending.remeshSet ∪= remeshSet
     else if rearrange:             arrange(); if (!userPaused) drape()
  5. if 'body' ∈ groups and keys.body !== ctx.keys.body:        requestBodyBuild('full')   // 150 ms debounce
  6. if 'fabrics' ∈ groups: for each fabric f with keys.fabrics[f.id] !== ctx.keys.fabrics[f.id]: applyFabric(f.id)
     (a fabric removed from doc.fabrics while pieces still reference it → validate() reports E_NO_FABRIC and the piece is excluded at the next rebuild)
  7. if 'sim' ∈ groups and keys.sim !== ctx.keys.sim:            applySimSettings()  // in place: cloth.setSettings + cloth.setScale
  8. if ('sizes' ∈ groups and keys.sizes !== ctx.keys.sizes) or doc.ui.activeSize !== ctx.lastActiveSize: setActiveSize(doc.ui.activeSize)
  9. 'ui' only: nothing (ui/layout.js owns it and emits ui:layout)
  10. ctx.keys ← keys for every group examined (mesh keys are committed only when the remesh actually ran, so a failed remesh is retried on the next change)
```

The debounced remesh job (`runPendingRemesh`):

```
runPendingRemesh():
  issues = validateDoc(doc) ; ui.statusbar.setIssues(issues) ; editor.setIssues(issues)
  excluded = pieces with an issue of level 'error'
  meshes = remesh([...pending.remeshSet] minus excluded, {force:false})   // RemeshError per piece → ctx.mesh.failed, status warn, piece excluded
  applyVertexCap()                                                          // 12.2.5
  newState = rebuildCloth()                                                 // throws → keep ctx.cloth.state, stale=true, status error, return
  arrange()                                                                 // new state
  viewer.clothMesh.setState(newState, fabrics)                              // atomic swap for rendering
  if (!ctx.cloth.userPaused) drape() else { phase='ready'; emit sim:phase }
  emit mesh:built, cloth:built ; status info "Remeshed front, back (1 812 v) · rebuilt 2 612 v / 5 020 tris in 138 ms"
```

"Keep the old cloth running until the new one is built" means exactly: `ctx.cloth.state` and the viewer's cloth geometry are replaced **only** at the swap line, after `rebuildCloth()` and `arrange()` succeeded; frames rendered meanwhile (the debounce window, and any frame in which a reaction threw) show and step the previous state. The rebuild itself is synchronous (< 200 ms for the samples) inside one task.

#### 12.2.3 Fingerprints (`computeKeys`)

All keys are `hashString(JSON.stringify(...))` (uint32; `hashString` from `core/ids.js`). Numbers are stringified as-is (no rounding) except where noted.

| Key | Input | Consequence when changed |
|---|---|---|
| `mesh[pieceId]` | `{v: vertices, e: edges, f: foldEdge, n: notches, h: meshSpacing_mm, s: seamsTouching}` where `seamsTouching` = for every seam with a side on this piece, sorted by seam id: `[seam.id, thisSide.edge, thisSide.mirror, thisSide.reverse, other.pieceId, other.edge, other.mirror, round(otherEdgeLength_mm * 100)]` (`otherEdgeLength_mm` from `seamLengths`) | remesh this piece (+ rebuild) — includes the seam-partner case: when a partner's edge length changes, this piece's boundary sampling changes too |
| `build[pieceId]` | `{fabricId, layer, pinnedEdges, simulate}` | rebuild cloth (no remesh) |
| `arrange[pieceId]` | `placement` | re-arrange (+ drape unless paused) |
| `seams` | `doc.seams` sorted by id | rebuild cloth |
| `body` | `doc.body.params` (key-sorted) | full body build |
| `fabrics[id]` | the `FabricInstance` | in-place fabric update + material |
| `sim` | `doc.sim` | in-place settings update |
| `sizes` | `doc.sizes` | ghost outline refresh |

Cost: one `JSON.stringify` of the pieces/seams per `doc:changed` — < 1 ms for the samples (< 100 vertices per piece), negligible against the 120 ms debounce.

#### 12.2.4 Debounce, throttle and flush rules

| Job | Trigger | Timing | Coalescing |
|---|---|---|---|
| remesh + rebuild | `doc:changed` diff | trailing debounce **120 ms** | `pending.remeshSet` accumulates piece ids; `remeshAll` if a load happened |
| body full build | `body:params:commit`, `doc:changed` body diff | trailing debounce **150 ms** | one build; the coarse drag timer is cancelled |
| body coarse build | `body:params:drag` | throttle **100 ms**, leading + trailing | latest params win |
| status stats | loop tick | ≤ **10 Hz** | see 12.2.6 |

`flush()` runs, in order: pending coarse drag build (only if no full build is pending), pending full body build, pending remesh/rebuild. `flush()` is called by every `__app` mutation before it returns and by `stepFrames()` before stepping, so automation is deterministic; UI interactions keep the debounces. `flush()` is also called on `beforeunload` (no-op safety) and before every export function.

#### 12.2.5 Vertex cap

After any remesh, if `Σ vertexCount` over cached meshes `> 8000`: `ctx.mesh.spacingFactor = min(4, spacingFactor * sqrt(total / 8000) * 1.05)`; all pieces are remeshed with effective `meshSpacing_mm = min(40, piece.meshSpacing_mm * spacingFactor)` (the doc is **not** modified); status `warn` "Mesh spacing raised ×1.23 to stay under 8 000 vertices". When a later remesh with `spacingFactor = 1` would fit (checked by estimating `Σ area_mm2 / (0.433 * h²)` per piece — the hex-lattice vertex density), the factor is reset to 1 and pieces are remeshed at their stored spacing.

#### 12.2.6 The frame tick

Registered once via `viewer.loop.setTick(wiring.tick)`; called before each render.

```
tick(nowMs):
  state = ctx.cloth.state ; if (!state) → push stats (verts 0) at 10 Hz ; return
  if (ctx.cloth.running && !ctx.cloth.stepping):
      sdf = ctx.body.model ? ctx.body.model.sdf : null          // null → cloth skips collision (section 7 safety)
      stats = cloth.step(state, sdf)                              // exactly one frame, dt = 1/60, fixed substeps
      ctx.cloth.lastStats = stats
      if (stats.nanCount > prevNan) bus.emit(EVENT.SIM_NAN, {...})   // if cloth does not emit it itself
      updatePhase(state)                                          // sewing → draping when state.time ≥ sim.sewTime_s + 0.5 → emit sim:phase once
      dirty = true
  if (dirty || ctx.cloth.dirty): viewer.clothMesh.updatePositions(state) ; ctx.cloth.dirty = false
  if (nowMs - ctx.lastStatsPush ≥ 100):
      ctx.lastStatsPush = nowMs
      ui.statusbar.setSim(ctx.cloth.lastStats || cloth.stats(state), viewer.fps())
      if (ctx.cloth.running) bus.emit(EVENT.SIM_STATS, ctx.cloth.lastStats)
```

* `ctx.cloth.dirty` is set by `arrange`, `reset`, `restore` and the SDF swap so a paused cloth is re-uploaded once.
* When the 3D pane is hidden (`layout === '2d'`) the viewer loop is paused, so the sim does not advance; `sim.step(n)` still works (it never depends on rAF).
* No adaptive substepping (section 1: determinism). If `msAvg > 20` for 60 consecutive frames the status bar shows `warn` "Simulation slow (23 ms/frame) — raise mesh spacing" once per minute; nothing else changes.
* Status bar sim text format: `sewing · f 312 · 8.4 ms · 2 612 v · pen 0.8 mm · gap 2.1 mm · 60 fps`.

#### 12.2.7 Body build helper

```
buildBody(quality, params = doc.body.params):
  cell = quality === 'full' ? 0.015 : 0.030
  model = body.buildBody(clampParams(params), {cell})        // throws → status error 'E_BODY', keep old model, return null
  ctx.body.model = model ; ctx.body.quality = quality        // atomic swap: the solver reads ctx.body.model.sdf per step
  ctx.body.key = keys.body(params)
  viewer?.bodyMesh.update(model) ; viewer?.anchorsGizmo refresh if shown
  ctx.cloth.dirty = true
  ui?.panels.body.setModel(model, quality)
  emit body:built {quality, buildMs: model.buildMs, measured: model.measured}
```

A coarse model is never left as the final state: a `commit` (or a `doc:changed` body diff) always follows a drag and requests a full build; if the drag ended without a commit (pointer cancelled) the body panel still emits `commit` with the last value.

#### 12.2.8 Sequence: user drags a vertex

Participants: **User**, **edit tool** (`src/pattern/tools/edit.js`), **store**, **bus**, **wiring**, **remesh** (`src/geometry/remesh.js`), **cloth** (`src/cloth/`), **viewer** (`src/viewer3d/`), **ui** (status bar).

```
User        edit tool           store        bus            wiring              remesh       cloth        viewer          ui
 |--pointerdown (on vertex 2 of 'front')-->|
 |            | hit test (6 px), begin drag; no store write
 |--pointermove x N----------------------->|
 |            | redraw canvas with the vertex at the cursor (local preview);
 |            | status: cursor mm + live edge lengths (ui.statusbar.setCursor)
 |--pointerup------------------------------>|
 |            |--store.update(d => d.pieces[i].vertices[2] = [x,y], {label:'Move vertex', hints:{pieces:['front']}})-->|
 |            |                             |--emit doc:changed {doc, hints:{pieces:['front']}, source:'update'}-->|
 |            |                             |             |--onDocChanged---->|
 |            |                             |             |   computeKeys: mesh['front'] changed; if a seam joins front.edge k to back.edge j and
 |            |                             |             |   the length of edge k changed, mesh['back'] changed too (partner length in its key)
 |            |                             |             |   scheduleRemesh({'front'[, 'back']}) ; timer 120 ms ; old cloth keeps stepping
 |  (editor re-renders from its own store subscription; the 3D view keeps draping the previous mesh)
 ~ 120 ms later (or immediately when __app.* calls wiring.flush()) ~
 |            |                             |             |   runPendingRemesh():
 |            |                             |             |     validateDoc(doc) → issues → ui.statusbar.setIssues / editor.setIssues
 |            |                             |             |-----remeshPiece(front, doc)------->|
 |            |                             |             |<----PieceMesh (912 v, minAngle 27°)|
 |            |                             |             |     applyVertexCap()
 |            |                             |             |-----buildCloth({meshes, doc, fabrics})------------------>|
 |            |                             |             |<----ClothState (2 612 v)--------------------------------|
 |            |                             |             |-----arrange(state, body, doc); pushOut(state, sdf)------>|
 |            |                             |             |-----clothMesh.setState(state, fabrics) [swap]------------------------->|
 |            |                             |             |     if (!userPaused) drape(): time=0, running=true, phase='sewing'
 |            |                             |             |--emit sim:phase-->|                                                    |--toolbar Pause state
 |            |                             |             |--emit mesh:built, cloth:built-->|                                     |--pieces panel counts
 |            |                             |             |     status info "Remeshed front (912 v) · rebuilt 2 612 v in 138 ms"--------------------->|
 next rAF:  viewer.loop → wiring.tick → cloth.step(state, sdf) → clothMesh.updatePositions → render → (every 100 ms) statusbar.setSim
```

If `remeshPiece` throws `RemeshError` for `front`: `front` is recorded in `ctx.mesh.failed` with the message, the status bar shows `warn` "front: <message> — piece excluded from simulation", and the pipeline continues with the remaining meshes (the previous `front` mesh is dropped, not reused, because its geometry no longer matches the doc). If `buildCloth` throws: the old state stays (`stale = true`), status `error`.

### 12.3 `src/app/debugApi.js` — `window.__app`

```js
/**
 * Installs window.__app. Called once by main.js before any boot stage.
 * @param {AppContext} ctx
 * @param {Wiring} wiring
 * @returns {AppApi}
 */
export function installDebugApi(ctx, wiring);

/** Error thrown by every __app function on bad input or unavailable state. */
export class ApiError extends Error { /** @type {string} */ code; /** @type {any} */ detail; }

export const ERROR_CODES = /** @type {const} */ ([
  'E_NOT_READY',    // module needed by the call failed to boot (ctx.mods.x === null) or no doc
  'E_BAD_ARG',      // wrong type/range; message names the argument
  'E_BAD_DOC',      // load(): validateShape reported errors (detail = Issue[])
  'E_BAD_POLY',     // setVertices/addPiece: < 3 vertices, signedArea <= 0 (must be CCW), or self-intersecting
  'E_BAD_EDGE',     // edge index out of range, or the fold edge used as a seam side
  'E_SEAM_DUP',     // that edge side already belongs to a seam
  'E_NO_PIECE', 'E_NO_SEAM', 'E_NO_FABRIC', 'E_NO_PRESET', 'E_NO_SAMPLE', 'E_NO_SIZE', 'E_NO_ELEMENT',
  'E_NO_CLOTH',     // sim.* needs a built ClothState and there is none (all pieces failed or none simulate)
  'E_NO_BODY',      // body.* needs a BodyModel and the body stage failed
  'E_EXPORT',       // export module threw (detail = original error)
  'E_SELFTEST',     // selftest module missing or its runSelfTest threw
]);
```

**General semantics (apply to every function):**

* Synchronous unless marked **async**. Synchronous mutators call `wiring.flush()` before returning, so the returned state and the next `sim.step` reflect the change.
* Arguments are validated **before** any mutation; on failure an `ApiError` with `code` from `ERROR_CODES` is thrown and the app is unchanged. Errors inside the pipeline that follows a valid mutation (e.g. `RemeshError` on one piece) do **not** throw from `__app`; they surface in the status bar, `__app.log()`, and `mesh.stats().failed` — the document change itself is kept (undoable).
* Returned documents/pieces/params are **deep copies** (`structuredClone`); mutating them has no effect. Exceptions returning live objects are marked *live*.
* Nothing in `__app` ever `alert`s, opens windows, or downloads; export functions return strings.
* `__app` is frozen (`Object.freeze`) after installation; sub-objects are frozen too.

```js
/** @typedef {Object} AppApi */
window.__app = {
  version: '1.0.0',                 // === APP_VERSION
  ready: Promise<BootResult>,       // 12.1.4
  bus,                              // live EventBus (debug only, no stability guarantee)
  ctx,                              // live AppContext (debug only, no stability guarantee)
  log(): {t:number, level:string, message:string, code:string|null}[],   // last 200 status/console messages, oldest first (copy)

  // ---- document ----
  doc(): ProjectDoc,                                  // deep copy of the current document
  update(fn: (d: ProjectDoc) => void, label?: string, hints?: object): ProjectDoc,
                                                      // store.update(fn, {label: label ?? 'API update', hints}); returns the new doc (copy); flushes
  undo(): boolean, redo(): boolean,                   // false when nothing to undo/redo; flushes
  load(doc: ProjectDoc|string): ProjectDoc,           // string → JSON.parse (SyntaxError → E_BAD_DOC); normalizeDoc; validateShape errors → E_BAD_DOC (detail);
                                                      // store.load → doc:loaded → full pipeline runs synchronously; returns the normalised doc
  loadSample(id: 'tshirt'|'skirt'): ProjectDoc,       // E_NO_SAMPLE; same path as load()
  save(): string,                                     // serializeDoc(doc) (sorted keys, 2-space indent); load(save()) then save() is byte-identical

  pattern: {
    pieces(): Piece[],
    addPiece(piece: Partial<Piece> & {vertices: Vec2[]}): string,
        // fills defaults: id = uid('piece'), name = id, edges = all 'line', foldEdge null, notches [], grainline = vertical arrow through the bbox centre
        // (a = [cx, cy-50], b = [cx, cy+50]), internalLines [], seamAllowance_mm 10, fabricId = doc.fabrics[0].id, layer 0, cutQty 1,
        // exportHidden false, simulate true, pinnedEdges [], placement {anchor:'torso', side:'front', offset_mm:[0,0], wrap:0.8, flip:false},
        // grade {widthRef:'chest_cm', lengthRef:'torsoLength_cm', anchorX:'center', anchorY:'top', vertexRules:[]}, meshSpacing_mm 15.
        // E_BAD_POLY on < 3 vertices / signedArea <= 0 / self-intersection; E_BAD_ARG if edges.length !== vertices.length or id already used; returns the id
    setVertices(id: string, verts: Vec2[], edges?: Edge[]): void,
        // E_NO_PIECE, E_BAD_POLY. If verts.length === current length and edges omitted: edges/notches/foldEdge/seams are kept.
        // If the count changes: edges = given or all 'line'; notches cleared; foldEdge kept only if < n and its edge is a line; seams whose side references
        // an edge >= n are removed (they are listed in the status bar); pinnedEdges filtered.
    addSeam(a: {pieceId:string, edge:number, mirror?:boolean}, b: {pieceId:string, edge:number, mirror?:boolean, reverse?:boolean}): string,
        // mirror defaults false; reverse defaults to autoReverse(a, b, doc) (closest-endpoints heuristic of section 4); kind 'plain'; id = uid('seam').
        // E_NO_PIECE, E_BAD_EDGE (index out of range, fold edge, or mirror:true on a piece without foldEdge), E_SEAM_DUP (either side already used).
        // A seam side may reference the same piece as the other side (side seam of a fold piece: a.mirror=false, b.mirror=true).
    removeSeam(id: string): boolean,                     // false if no such seam (no throw)
    seamEase(id: string): {lenA_mm:number, lenB_mm:number, easePct:number, longer:'a'|'b'|'equal'},
        // easePct = (max - min) / min * 100, 2 decimals; E_NO_SEAM
    validate(): Issue[],                                  // validateDoc(doc) + validateShape(doc), errors first
    fit(): void,                                          // editor.fit(): zoom to all pieces with 5 % margin
    worldToScreen(x_mm: number, y_mm: number): [number, number],   // CSS px relative to #pattern-canvas top-left (clientX = canvas.getBoundingClientRect().left + px)
    screenToWorld(px: number, py: number): [number, number],       // inverse; mm, y up
    setTool(name: 'select'|'draw'|'edit'|'split'|'seam'|'notch'|'grainline'|'measure'): void,   // E_BAD_ARG on unknown name
    click(x_mm: number, y_mm: number, opts?: {button?:0|2, shift?:boolean, ctrl?:boolean, alt?:boolean, double?:boolean}): [number, number],
        // dispatches REAL events on #pattern-canvas at worldToScreen(x_mm, y_mm): pointerdown, pointerup, click (and dblclick when opts.double),
        // with clientX/clientY, buttons, pointerId 1, pointerType 'mouse', isPrimary true, bubbles true; the active tool reacts exactly as to a user click.
        // Returns the screen point used. Flushes afterwards.
    drag(x0_mm: number, y0_mm: number, x1_mm: number, y1_mm: number, opts?: {steps?:number, shift?:boolean}): void,
        // pointerdown at p0, `steps` (default 8) pointermove events on the straight line, pointerup at p1; flushes afterwards
    select(id: string|string[]|null): void,               // piece or seam ids; null clears; E_NO_PIECE/E_NO_SEAM for unknown ids
    selection(): {pieceIds: string[], seamIds: string[]},
  },

  mesh: {
    stats(): {
      pieces: number, verts: number, tris: number, minAngleDeg: number, pctAbove20: number, medianEdge_mm: number,
      spacingFactor: number,
      perPiece: {pieceId:string, verts:number, tris:number, minAngleDeg:number, pctAbove20:number, medianEdge_mm:number, area_mm2:number, warnings:string[]}[],
      failed: {pieceId:string, message:string}[],
      seamPairsEqual: boolean,     // for every seam: edgeVerts[a.mirror][a.edge].length === edgeVerts[b.mirror][b.edge].length
    },
    remesh(pieceId?: string): PieceMesh[],   // live meshes; forces remesh (ignores fingerprints) of one or all simulate pieces, then rebuild+arrange(+drape unless paused); E_NO_PIECE
    get(pieceId: string): PieceMesh|null,    // live cached mesh or null (not meshed / failed)
  },

  body: {
    params(): BodyParams,
    setParam(key: keyof BodyParams, value: number, opts?: {commit?: boolean}): BodyModelSummary,
        // E_BAD_ARG on unknown key / non-finite value; value is clamped to the range of section 6.1 (the clamped value is what is stored).
        // commit (default true): store.update(doc.body.params[key] = v; doc.body.preset = 'custom') then emits body:params:commit → full build, synchronously (flush).
        // commit:false: the slider-drag path — doc untouched, emits body:params:drag and runs the coarse (30 mm) build immediately (bypassing the throttle).
    setParams(patch: Partial<BodyParams>, opts?: {commit?: boolean}): BodyModelSummary,   // same, several keys in one update
    setPreset(id: string): BodyModelSummary,   // E_NO_PRESET; copies BODY_PRESETS[id] into doc.body.params, sets doc.body.preset = id; full build
    presets(): string[],                       // Object.keys(BODY_PRESETS)
    model(): BodyModelSummary,                 // E_NO_BODY
    measured(): {chest_cm:number, waist_cm:number, hips_cm:number},   // model.measured; E_NO_BODY
    sdf(x: number, y: number, z: number): number,   // signed distance in metres from the CURRENT grid (coarse or full); +1 outside the grid; E_NO_BODY
    landmark(name: string): Vec3,              // copy of model.landmarks[name]; E_BAD_ARG on unknown name
  },
  /** @typedef {{params:BodyParams, quality:'full'|'coarse', buildMs:number, measured:{chest_cm:number,waist_cm:number,hips_cm:number},
   *   landmarks:Record<string,Vec3>, anchors:Record<string,Anchor>, rings:Record<string,{y:number,a:number,b:number,n:number,cz:number}>,
   *   sdf:{origin:Vec3, cell:number, nx:number, ny:number, nz:number}, geometry:{verts:number, tris:number}}} BodyModelSummary  (no large arrays) */

  sim: {
    state(): ClothState|null,                  // LIVE solver state (typed arrays); read-only by convention
    step(n?: number): SimStats,
        // SYNCHRONOUS. n default 1; E_BAD_ARG unless 1 <= n <= 100000 integer; E_NO_CLOTH.
        // wiring.flush() first; then viewer.loop.pause(); ctx.cloth.stepping = true; runs cloth.step(state, sdf) n times with the fixed dt = 1/60
        // and the substeps of doc.sim (no rAF, no rendering, no stats push in between; sim:phase transitions are still emitted);
        // then one clothMesh.updatePositions + viewer.loop.renderOnce(); loop resumed to its previous state; returns the SimStats of the last frame.
        // Does not change `running`: a paused sim stays paused after step(n). n > 3000 logs a console warning (takes seconds).
    play(): void,                              // running = true, userPaused = false; if phase was 'ready' or 'error' it behaves like drape(); emits sim:phase
    pause(): void,                             // running = false, userPaused = true; emits sim:phase
    reset(): SimStats,                         // cloth.reset(state): pos = restPos, vel = 0, time = 0, seams re-armed; running unchanged; dirty = true
    arrange(): SimStats,                       // wiring.arrange(): re-derive restPos from the current body anchors + placements, pushOut, then reset semantics
    drape(): SimStats,                         // wiring.drape(): arrange + time = 0 + running = true (userPaused = false); phase 'sewing'
    stats(): SimStats,                         // last stats, or cloth.stats(state) when never stepped; E_NO_CLOTH
    phase(): 'empty'|'ready'|'sewing'|'draping'|'paused'|'error',
        // empty: no state; ready: arranged, time = 0, not running; sewing: running && time < sewTime_s + 0.5; draping: running && time >= sewTime_s + 0.5;
        // paused: not running && time > 0; error: paused by the repeated-NaN rule (12.2.1)
    running(): boolean,
    setSetting(key: keyof SimSettings, value: number|boolean): SimSettings,
        // E_BAD_ARG on unknown key/type; ranges: substeps 1..30 (integer), gravity_ms2 0..30, sewTime_s 0.1..10, collisionOffset_mm 0..20,
        // bendScale/stretchScale 1e-3..1e3, selfCollision boolean. store.update(doc.sim[key] = value) → in-place apply (12.2.2 step 7). Returns doc.sim copy.
    snapshot(): {frame:number, time:number, V:number, pos:Float32Array, vel:Float32Array},   // copies; E_NO_CLOTH
    restore(snap): void,                       // cloth.restore(state, snap); E_BAD_ARG if snap.V !== state.V
    centerOfMass(): Vec3,                      // mass-weighted mean of pos over free vertices, metres; E_NO_CLOTH
    pin(vertex: number, target?: Vec3): void,  // invMass = 0, pTarget = target ?? current pos (appends to pIdx/pTarget via cloth.setPin); E_BAD_ARG
    unpin(vertex: number): void,
  },

  fabric: {
    presets(): FabricPreset[],                                   // copy of FABRIC_PRESETS
    list(): FabricInstance[],                                    // doc.fabrics copy
    resolved(fabricId: string): FabricResolved,                  // resolveFabric(instance); E_NO_FABRIC
    setPreset(fabricId: string, presetId: string): FabricResolved,   // E_NO_FABRIC, E_NO_PRESET; keeps color/texture/overrides; in-place physics + material
    setColor(fabricId: string, hex: string): void,               // E_BAD_ARG unless /^#[0-9a-f]{6}$/i (stored lower-case); material update only
    setTexture(fabricId: string, kind: 'solid'|'stripes'|'gingham'|'dots'|'twill'|'knit', opts?: {scale_mm?: number, color2?: string}): void,
                                                                 // E_BAD_ARG on unknown kind (TEXTURE_KINDS) / bad colour / scale_mm outside 1..500
    setOverride(fabricId: string, key: keyof FabricPhysics, value: number|null): void,   // null deletes the override; in-place physics update
    setScale(bend: number, stretch: number): void,               // = setSetting('bendScale', bend) + setSetting('stretchScale', stretch)
    addFabric(instance: Partial<FabricInstance> & {preset: string}): string,   // id = uid('fab') unless given; E_NO_PRESET
  },

  sizes: {
    chart(): SizeChart,
    setActive(name: string): void,             // E_NO_SIZE; store.update(doc.ui.activeSize = name) → size:active
    active(): string,
    grade(name: string): Piece[],              // gradeDoc(doc, name) (copies); E_NO_SIZE
    closest(): {name: string, score: number},  // closestSize(doc.sizes, doc.body.params)
    setCell(name: string, key: string, value_cm: number): void,   // E_NO_SIZE; E_BAD_ARG if key not in chart.measurements or value not finite > 0
    addRow(row: SizeRow, index?: number): void,                   // E_BAD_ARG on duplicate name or missing measurement keys
    removeRow(name: string): void,                                // E_BAD_ARG when removing the base size
    fitBody(name: string): BodyModelSummary,   // copies the row's measurement keys into doc.body.params (plain copy, same keys/units) + full build; E_NO_SIZE
  },

  export: {
    svg(size?: string, pieceId?: string): string,   // size default doc.ui.activeSize; pieceId given → pieceSvg(doc, pieceId, size); omitted → sheetSvg(doc, size)
    sheetSvg(size?: string): string,                // packed sheet, all export pieces (exportHidden pieces excluded), 1 user unit = 1 mm, width/height in mm
    printHtml(size?: string, paper?: 'A4'|'Letter'|'A3'): string,   // paper default 'A4'; complete HTML document string (the UI opens it in a new window; __app never does)
    pageCount(size?: string, paper?: 'A4'|'Letter'|'A3'): number,   // must equal the number of `.page` elements in printHtml(size, paper)
    csv(): string,                                  // sizeChartCsv(doc.sizes): header `name,chest_cm,...` + one row per size, values cm
    pieceCsv(): string,                             // pieceCsv(doc): per piece × size edge lengths, seam ease %, area — as defined in the export section
    json(): string,                                 // sizeChartJson(doc.sizes): the SizeChart object, sorted keys
    obj(opts?: {body?: boolean}): string,           // clothObj(state, opts.body ? model : null): `o <pieceId>` groups, v in metres, f 1-based; E_NO_CLOTH
    // every function: E_NO_SIZE for an unknown size; E_EXPORT wrapping any error thrown by src/export
  },

  ui: {
    click(id: string): void,                        // el = document.getElementById(id) (E_NO_ELEMENT); el.click() → real click event through the UI's handlers; flushes
    setValue(id: string, value: string|number|boolean): void,
        // E_NO_ELEMENT; checkbox/radio → .checked = !!value; select → .value (E_BAD_ARG if no such option); input/textarea → .value = String(value);
        // then dispatches new Event('input', {bubbles:true}) and new Event('change', {bubbles:true}); flushes (a range input on the body panel therefore
        // triggers drag (input) then commit (change) — the full build runs before setValue returns)
    layout(mode: 'split'|'2d'|'3d'): void,          // ui.layout.set(mode) → store + ui:layout
    dock(tab: 'pieces'|'body'|'fabric'|'sizes'): void,
    swap(): void,                                   // toggles doc.ui.swapped
    setSplit(f: number): void,                      // 0.15..0.85
    state(): UiState & {tool: string, selection: {pieceIds:string[], seamIds:string[]}, panes: {left:{w:number,h:number}, right:{w:number,h:number}}, popout: boolean},
    elements(): string[],                           // every element id the UI promises (section 11); acceptance checks each exists
    key(key: string, opts?: {ctrl?:boolean, shift?:boolean, alt?:boolean, target?: string}): void,
        // dispatches keydown+keyup KeyboardEvent {key, code, bubbles:true} on document.getElementById(target) or document.body (shortcuts test)
  },

  selftest: {
    list(): string[],                               // ['geometry','pattern','body','cloth','viewer3d','sizing','export','ui']
    run(module?: string): Promise<SelfTestResult[]>,   // ASYNC. import(`../${module}/selftest.js`) then await runSelfTest(); module omitted or 'all' → every module,
                                                    // names prefixed 'module/'; a module whose selftest.js fails to import yields one failing result {name:'module/import', pass:false}
  },

  acceptance: {
    run(filter?: string|RegExp): Promise<{pass:boolean, results:{id:string, name:string, pass:boolean, ms:number, details:string}[]}>,
        // ASYNC. Lazily imports ../../tests/acceptance.js (section 13) and runs the checks whose id/name matches `filter` (all when omitted).
        // Runs on the live app: it loads samples and mutates the document; the doc is restored to what it was before the run (store.load of a saved copy).
    list(): Promise<{id:string, name:string}[]>,
  },

  viewer: {
    screenshotDataUrl(): string,                    // 'data:image/png;base64,...' of the 3D canvas after a synchronous render; E_NOT_READY if the viewer failed
    frame(): void,                                  // camera fit to body + cloth bounds
    fps(): number,                                  // moving average over the last 60 rendered frames (0 while paused)
    resize(): void,
  },
};
```

**Determinism contract for tests.** `sim.step(n)` after `loadSample(id)` on the same machine produces bit-identical `SimStats` across runs: fixed `dt`, fixed substeps, seeded jitter in remesh (section 5), no time-dependent code paths in the solver, and `flush()` removing every debounce from the automation path.

**Broken-state guarantee.** Every `__app` mutator either (a) throws before touching the store, or (b) commits one undoable `store.update`/`store.load` and then runs the pipeline under `guard`. Hence `__app.undo()` always returns the document to the previous state, and a pipeline failure leaves the previous cloth/body in use with `ctx.cloth.stale === true` and a status-bar error; the next successful pipeline run clears `stale`.

### 12.4 Using `__app` from the browser devtools

Open the app (`run.bat` → `http://localhost:8710/`), press F12, Console tab. Everything is synchronous unless it returns a Promise:

```js
await __app.ready                       // {ok:true, ms:1234, errors:[], stages:{...}}
__app.loadSample('skirt')               // switch sample; drapes automatically
__app.sim.step(300).seamGapMax_mm       // advance 5 s of simulation instantly, read a number
__app.body.setParam('chest_cm', 100)    // rebuilds the body; the cloth is pushed out over the next frames
__app.body.setParam('hips_cm', 110, {commit:false})   // the slider-drag path (coarse body, doc unchanged)
__app.fabric.setPreset('main', 'silk'); __app.fabric.setColor('main', '#c0392b')
__app.pattern.setTool('seam'); __app.pattern.click(240, -300); __app.pattern.click(-240, -300)   // drive the editor like a mouse
__app.pattern.seamEase(__app.doc().seams[0].id)                                                    // {lenA_mm, lenB_mm, easePct, longer}
copy(__app.export.svg('L'))             // devtools copy(): the SVG is on the clipboard — paste into a .svg file
copy(__app.save())                      // project JSON; __app.load(JSON.parse(...)) brings it back
__app.mesh.stats(); __app.sim.stats(); __app.log()        // numbers behind the status bar
await __app.selftest.run('cloth')       // one module's green/red gate
await __app.acceptance.run()            // the whole section-13 suite; results table in the console
__app.bus.on('sim:stats', s => console.log(s.ms))         // watch live values (returns an unsubscribe function)
```

Tips: `__app.ctx` is the live composition state (inspect `__app.ctx.cloth.state.pos` in the console's typed-array viewer); `__app.sim.pause()` then repeated `__app.sim.step(1)` single-steps the solver; `__app.viewer.screenshotDataUrl()` pasted into the address bar shows the current 3D frame; `?nosim=1` in the URL boots with the garment arranged but not sewn so you can inspect the arrangement. Errors thrown by `__app` carry `.code` (`try { … } catch (e) { e.code }`), listed in 12.3.

### 12.5 A8 verification gate

`src/app/` has no `selftest.js`; its gate is the acceptance suite (section 13) plus these boot assertions, which `tests/acceptance.js` runs first and which A8 must see green before integration is declared done:

1. `await __app.ready` resolves in < 5 s with `ok === true` on `?sample=tshirt`, `?sample=skirt` and `?sample=none`; `__app.log().filter(l => l.level === 'error').length === 0`.
2. With `?nosim=1`: `__app.sim.phase() === 'ready'`, `running() === false`, `mesh.stats().verts > 0`; `__app.sim.drape()` → `phase() === 'sewing'`.
3. Simulated module failure (`__app.ctx.mods.viewer = null; __app.loadSample('tshirt')`) still resolves the pipeline: `mesh.stats().verts > 0`, the status bar contains a message, no uncaught exception.
4. `__app.pattern.setVertices('front', movedVerts)` returns synchronously with `__app.mesh.stats().perPiece` updated (flush works) and `__app.undo()` restores the vertices and remeshes back (`mesh.stats()` equal to before, `seamPairsEqual === true`).
5. `__app.body.setParam('chest_cm', 100, {commit:false})` → `body.model().quality === 'coarse'`; `__app.body.setParam('chest_cm', 100)` → `'full'`; `sim.step(120)` → `maxPenetration_mm < 5`, `nanCount === 0`.
6. `__app.sim.step(60)` called twice from the same loaded sample (reload in between) yields identical `SimStats.seamGapMean_mm` and `maxSpeed` (determinism).
7. `for (const id of __app.ui.elements()) document.getElementById(id) !== null`; `__app.ui.click('btn-sim-play')` toggles `sim.running()`; `__app.ui.setValue('body-chest_cm', 95)` (ids per section 11) changes `body.params().chest_cm` to 95 and `body.model().quality === 'full'`.
8. Every `__app` function with a bad argument throws an `ApiError` whose `code` is in `ERROR_CODES`, and `__app.doc()` deep-equals the document from before the call.

### PROPOSED additions outside `types.js` (reviewer decides)

No amendment to `src/core/types.js` is required by this section (`AppContext`, `BootResult`, `BodyModelSummary` and `ApiError` are app-local).

Event constants this section relies on and that must appear in section 3.2's `EVENT` table (any missing one is proposed here): `DOC_CHANGED 'doc:changed'`, `DOC_LOADED 'doc:loaded'`, `SELECTION_CHANGED 'selection:changed'`, `TOOL_CHANGED 'tool:changed'`, `BODY_PARAMS_DRAG 'body:params:drag'`, `BODY_PARAMS_COMMIT 'body:params:commit'`, `BODY_BUILT 'body:built'`, `FABRIC_CHANGED 'fabric:changed'`, `SIZE_ACTIVE 'size:active'`, `MESH_BUILT 'mesh:built'`, `CLOTH_BUILT 'cloth:built'`, `SIM_PHASE 'sim:phase'`, `SIM_STATS 'sim:stats'`, `SIM_NAN 'sim:nan'`, `UI_LAYOUT 'ui:layout'`, `STATUS_MESSAGE 'status:message'`, `POPOUT_CHANGED 'popout:changed'`.

Store contract this section relies on (section 3.3): `update(fn, {label, hints})` emits `doc:changed {doc, label, hints, source:'update'|'undo'|'redo'}`; `load(doc)` emits `doc:loaded {doc}`; `hints` is an optional `{pieces?:string[], seams?:string[], body?:true, fabrics?:string[], sim?:true, sizes?:true, ui?:true, all?:true}` — wiring treats a missing `hints` as `all`.
