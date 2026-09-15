## 13. Acceptance suite (`tests/acceptance.js`)

The acceptance suite is the definition of "v1 works". It runs **inside the app page** against `window.__app` (section 12), is owned by A8, and is imported lazily — `src/app/debugApi.js` does `await import('../../tests/acceptance.js')` the first time `__app.acceptance.run()` is called, so the suite costs nothing at boot and can never break the app.

### 13.1 Runner contract

```js
// tests/acceptance.js — imports: ../src/core/schema.js (normalizeDoc, serializeDoc), ../src/core/units.js (PAPER),
// ../src/cloth/index.js + ../src/cloth/fixtures.js (hanging-sheet fixture), every module's selftest.js (lazy).
// Never imports three or the DOM API beyond document.getElementById / DOMParser.

/** @typedef {{name:string, pass:boolean, details:string}} AcceptanceResult */
/** @typedef {{pass:boolean, passed:number, failed:number, total:number, ms:number, results:AcceptanceResult[], errors:string[]}} AcceptanceSummary */

/** Ordered list of checks; each entry is {name, timeoutMs, fn: () => Promise<string>} — fn resolves with the details string
 *  on success and throws (any Error, or an AssertionError from expect()) on failure. */
export const CHECKS;

/**
 * Runs the whole suite (or the named subset) and NEVER throws.
 * @param {{only?:string[], skip?:string[], log?:boolean}} [opts]  log=true (default) prints console.table(results)
 * @returns {Promise<AcceptanceSummary>}
 */
export async function run(opts);

/** Runs one check by name; never throws. @returns {Promise<AcceptanceResult>} */
export async function runOne(name);
```

Runner rules (A8 implements exactly these):

1. **Preamble** (once per `run`): `errorsAtStart = __app.errors.length`; `__app.sim.pause()` (the rAF loop must not step the solver while a check steps it synchronously); remember `document.title`.
2. **Per check**: `const t0 = performance.now()`; `Promise.race([fn(), timeout(check.timeoutMs)])` inside `try/catch`; a throw or timeout yields `{name, pass:false, details:'threw: ' + err.message}` (timeout message: `'timeout after N ms'`). A resolved value yields `{name, pass:true, details}`. The elapsed ms are appended to `details` as ` [123 ms]`. Default `timeoutMs = 20000`; the `selftests` check gets 30000.
3. **Isolation**: every check that mutates the document starts with `await reloadSample('tshirt')` (helper below) and the runner calls `reloadSample('tshirt')` once more at the end, then `__app.sim.play()` to restore the live loop and `document.title` is set to `ACCEPTANCE PASS n/n` or `ACCEPTANCE FAIL k/n`.
4. **Postamble**: `errors = __app.errors.slice(errorsAtStart).map(e => e.message)`; `summary.errors = errors`; the summary is stored in `__app.acceptance.last` and in `window.__acceptanceResult`; `document.body.dataset.acceptance = summary.pass ? 'pass' : 'fail'`; `console.log('ACCEPTANCE_RESULT ' + JSON.stringify({pass, passed, failed, total, ms, failedNames}))` (one line, greppable from `--enable-logging=stderr`).
5. **`?acceptance=1`**: `src/app/main.js` checks `new URLSearchParams(location.search).get('acceptance') === '1'` and, after `__app.ready`, calls `__app.acceptance.run()` automatically (nothing else changes).
6. **Runtime target**: the whole suite completes in **< 90 s** on the test machine (budget below: ≈ 30 s of solver stepping, ≈ 5 s body bakes, ≈ 10 s self-tests, the rest DOM/export work). A summary `ms > 90000` is reported in `details` of the last synthetic result `runtime` (pass = ms < 90000).

Helpers inside the file (no other file may import them):

```js
function expect(cond, msg)                 // throws Error('ASSERT: ' + msg) when !cond
function near(a, b, tol, label)            // expect(Math.abs(a-b) <= tol, `${label}: ${a} vs ${b} ±${tol}`)
async function reloadSample(id)            // __app.loadSample(id); await __app.idle(); __app.sim.pause(); returns __app.store.getDoc()
function timeout(ms)                       // Promise that rejects after ms
function signedArea(pts)                   // shoelace, mm²; pts: Vec2[]
function isSimplePolygon(pts)              // O(n²) proper-intersection test between non-adjacent segments (n ≤ 4000)
function bboxOf(pts)                       // {minX,minY,maxX,maxY,w,h}
function parseSvg(str)                     // DOMParser 'image/svg+xml'; throws if a <parsererror> element exists
function svgSizeMm(doc)                    // {w,h} from width/height attributes; throws unless both match /^(\d+(\.\d+)?)mm$/
function gpuRenderer()                     // UNMASKED_RENDERER_WEBGL string from a scratch webgl2 canvas ('' if unavailable)
function stateOf()                         // __app.sim.getState()  (live ClothState, section 3.1)
function landmark(name)                    // __app.body.getModel().landmarks[name]  (Vec3, metres)
```

### 13.2 Surface consumed by the suite

The suite touches only the following members of `window.__app` (section 12) and module exports. These are the section 8/12 names; if a frozen section spells one differently, **A8 adapts the suite** (rule 14.4) — never the module.

| Member | Used as |
|---|---|
| `__app.ready` (Promise), `__app.bootMs` (number: `performance.now()` at the moment `ready` resolved), `__app.version` | boot check |
| `__app.errors` (`{time:number, message:string}[]`; debugApi records `window.onerror`, `unhandledrejection` and every `console.error` call) | boot / postamble |
| `__app.store.getDoc()`, `__app.store.undo()`, `__app.store.redo()`, `__app.bus` | doc access, undo check |
| `__app.loadSample(id)`, `__app.saveProject(): string`, `__app.loadProject(jsonOrString)` | isolation, JSON round trip |
| `__app.idle(): Promise<void>` — resolves when no debounced work (remesh, body bake, sim build, material update) is pending; resolves immediately when idle | after every store mutation |
| `__app.pattern.addPiece(partialPiece): string`, `deletePiece(id)`, `movePiece(id, dx_mm, dy_mm)`, `addSeam(sideA, sideB): string`, `removeSeam(id)`, `remesh(pieceId?): PieceMesh[]`, `getMeshes(): PieceMesh[]`, `seamEase(seamId, sizeName?): {lenA_mm, lenB_mm, easePct}`, `validate(): Issue[]` | mesh, editor, grading checks |
| `__app.body.setPreset(id)`, `setParam(key, value)`, `getParams()`, `rebuild(): Promise<BodyModel>` (forces a full-resolution bake now, resolves after `body:built`), `getModel(): BodyModel`, `getMeasurements(): {chest_cm, waist_cm, hips_cm}`, `sdf(x, y, z): {d:number, n:Vec3}`, `listPresets(): string[]` | body checks |
| `__app.sim.pause()`, `play()`, `reset()`, `step(n): SimStats` (n frames synchronously, rendering suppressed, returns `stats()`), `stats(): SimStats`, `getState(): ClothState` (live references), `setSelfCollision(bool)`, `isRunning(): boolean` | drape checks |
| `__app.fabric.setPreset(fabricInstanceId, presetId)`, `setColor(fabricInstanceId, hex)` | fabric checks |
| `__app.viewer.materialOf(pieceId): THREE.Material` (the live material rendering that piece) | colour check |
| `__app.sizes.setActive(name)`, `gradedOutline(pieceId, sizeName): Vec2[]` (graded vertices, mm, same order as `Piece.vertices`) | grading |
| `__app.export.svgSheet({size}): string`, `printHtml({size, paper}): string`, `sizeChartCsv(): string`, `offsetPolygon(pieceId, sizeName): Vec2[]` (cut line, mm, pattern space, CCW) | export checks |
| `__app.ui.click(id)` (dispatches a `click` MouseEvent on `#id`; throws if missing), `getLayout(): UiState['layout']` | UI checks |
| `__app.selftest.runAll(): Promise<Record<string, SelfTestResult[]>>` (keys: geometry, pattern, body, cloth, viewer3d, sizing, export, ui; each module's `selftest.js` exports `runSelfTest(): Promise<SelfTestResult[]>`) | self-tests |
| `src/cloth/fixtures.js`: `makeHangingSheet({fabric: FabricResolved, width_m, height_m, spacing_mm, pinTopCorners: true, selfCollision: boolean}): ClothState` — a flat sheet in the xy plane, top edge at y = 0, hanging in −y, top-left and top-right corners pinned; `src/cloth/index.js`: `step(state)` (one frame = 10 substeps), `resolveFabric` from `src/core/fabrics.js` | fabric-ordering check |

Element ids used by the UI checks live in one constant at the top of the file and are the section 11 names: `IDS = { layoutSplit:'btn-layout-split', layout2d:'btn-layout-2d', layout3d:'btn-layout-3d', swap:'btn-swap', tabPieces:'tab-pieces', tabBody:'tab-body', tabFabric:'tab-fabric', tabSizes:'tab-sizes', play:'btn-sim-play', pane2d:'pane-2d', pane3d:'pane-3d' }`. `REQUIRED_IDS` is the literal list of every id in section 11, copied verbatim.

### 13.3 The checks

All numbers below are the assertion thresholds; `s` denotes the `SimStats` returned by `__app.sim.step(n)`; the document is the T-shirt sample on body preset `female_m` unless stated. Runtime is the budget per check on the test machine.

| # | name | budget | what passes |
|---|---|---|---|
| 1 | `boot` | 0.01 s | `__app.bootMs < 8000`; `__app.errors.length === 0` at suite start; `__app.version` is a non-empty string; `document.querySelector('#pane-3d canvas')` and `#pane-2d canvas` exist. |
| 2 | `ids` | 0.01 s | every id in `REQUIRED_IDS` resolves via `getElementById` and `document.querySelectorAll('#'+id).length === 1`. Details list the missing/duplicate ids. |
| 3 | `selftests` | ≤ 30 s | `await __app.selftest.runAll()`; every module key present (8 keys), every `SelfTestResult.pass === true`; details: `geometry 12/12, pattern 9/9, …` and the names of failures. |
| 4 | `tshirt_mesh` | 1 s | `reloadSample('tshirt')`; `m = __app.pattern.getMeshes()`: `m.length === 4` (front, back, sleeve_l, sleeve_r — pieces with `simulate === true`); `2500 ≤ ΣvertexCount ≤ 6000`; for every mesh `quality.pctAbove20 ≥ 98`, `quality.minAngleDeg > 10`, `12 ≤ quality.medianEdge_mm ≤ 18` (meshSpacing 15), `warnings.length === 0`, no NaN in `positions2d`, every triangle CCW in 2D (signed area > 0), every boundary edge (consecutive `boundary` ids) occurs in exactly one triangle. |
| 5 | `tshirt_seams` | 0.1 s | for every `Seam` in the doc: `edgeVerts[+a.mirror][a.edge].length === edgeVerts[+b.mirror][b.edge].length ≥ 3`; `__app.pattern.seamEase(id).easePct ≤ 8` (`easePct = 100·|lenA−lenB|/min(lenA,lenB)`); `__app.pattern.validate()` has no `level:'error'` issue; `state.sIdx.length/2 === Σ(N+1)` over seams (`N+1` = per-side vertex count). Doc has exactly 8 seams. |
| 6 | `body_female_m` | 1 s | `__app.body.setPreset('female_m'); model = await __app.body.rebuild()`; `measured.chest_cm` within **1.5 cm** of 88, `measured.waist_cm` within 1.5 of 70, `measured.hips_cm` within 2.0 of 96; `model.buildMs < 1500`; no NaN in `model.sdf.data` and `model.geometry.positions`; SDF signs: `sdf(chestCenter).d < −0.05`, `sdf(waistCenter).d < −0.04`, `sdf(1,1,1).d > 0.3`, `p = chestCenter + (0, 0, rings.chest.b + 0.05)` → `0.03 < d < 0.07` and `n·(0,0,1) > 0.7`, `q = headTop + (0, 0.05, 0)` → `0.03 < d < 0.07`; `landmarks.headTop[1]` within 0.02 of 1.65; `landmarks.shoulderL[0] > 0` (+x is the model's left). |
| 7 | `body_presets` | 5 s | for each id of `__app.body.listPresets()` (9 presets, section 6.1): `setPreset(id); m = await rebuild()`; `buildMs < 1500`; no NaN; `|measured.chest_cm − params.chest_cm| ≤ 2.5`; `landmarks.headTop[1]` within 0.03 of `params.height_cm/100`; every anchor has unit `axis`/`front` (|len−1| < 1e-3) and `radius > 0`. Ends with `reloadSample('tshirt')`. |
| 8 | `drape_tshirt` | 4 s | `reloadSample('tshirt'); __app.sim.reset(); s = __app.sim.step(300)` (5 s of sim; sew time 1 s): `s.nanCount === 0`; `s.maxPenetration_mm < 5`; `s.seamGapMax_mm < 8`; `s.seamGapMean_mm < 3`; `s.maxSpeed < 2`; `s.verts === ΣvertexCount` of the 4 meshes; mean y of all cloth vertices `> landmarks.hipCenter[1]` (shirt did not slide off); every vertex within 0.8 m of `landmarks.chestCenter`. |
| 9 | `drape_rest` | 4 s | continues from 8: `__app.sim.step(240)`; `c0 = centreOfMass(); s = step(60); c1 = centreOfMass()`: `|c1−c0| < 0.03 m` (≤ 0.5 mm/frame); `s.maxSpeed < 0.5`; `s.maxPenetration_mm < 5`; `s.seamGapMax_mm < 8`. |
| 10 | `strain_cotton` | 0.1 s | on the state of 9: over all edges `e` whose `pieceOf` piece uses a fabric resolving to preset `cotton`: `strain = |pos_i − pos_j| / eRest[e] − 1`; `max(strain) < 0.04`, `max(−strain) < 0.06`; details report the 99th percentile. |
| 11 | `perf` | 0.1 s | on the state of 9: `s = __app.sim.stats()`: `s.msAvg < 16` (average solver ms over the last 60 frames) and `s.substeps === 10`. **Skipped (pass, details `'skipped: software renderer'`) when `gpuRenderer()` contains `SwiftShader` or `llvmpipe`.** |
| 12 | `fabric_ordering` | 5 s | hanging-sheet fixture (13.4): `sag(chiffon) > sag(silk) > sag(cotton) > sag(denim)` and `sag(chiffon) − sag(denim) ≥ 10 mm`, all four runs `nanCount === 0`. |
| 13 | `fabric_switch` | 10 s | `reloadSample('tshirt'); fab = doc.pieces[0].fabricId`; for `preset` of `['silk','leather','jersey']`: `__app.fabric.setPreset(fab, preset); await __app.idle(); __app.sim.reset(); s = step(300)`: `nanCount === 0`, `maxPenetration_mm < 8`, `seamGapMax_mm < 8`; for silk additionally `resolveFabric(doc.fabrics[fab]).physics.bend_Nm === FABRIC_PRESETS.silk.physics.bend_Nm` (compliance rewritten from the preset). |
| 14 | `color_change` | 0.5 s | `reloadSample('tshirt'); __app.fabric.setColor(fab, '#ff0000'); await __app.idle()`; `__app.viewer.materialOf('front').color.getHexString() === 'ff0000'`; `doc.fabrics.find(f => f.id === fab).color === '#ff0000'`; `__app.store.undo(); await idle()` → hex string equals the original colour. |
| 15 | `body_change_live` | 2 s | `reloadSample('tshirt'); step(120)` (settled during sewing); `t0 = performance.now(); __app.body.setParam('chest_cm', 100); m = await __app.body.rebuild(); dt = performance.now() − t0`: `dt < 500`; `|m.measured.chest_cm − 100| ≤ 2`; `s = step(120)`: `nanCount === 0`, `maxPenetration_mm ≤ 8`, `seamGapMax_mm < 8`. |
| 16 | `selfcollision_toggle` | 3 s | `reloadSample('tshirt'); __app.sim.setSelfCollision(false); s1 = step(120)`: `nanCount 0`, `s1.sectionMs.self === 0`; `setSelfCollision(true); s2 = step(120)`: `nanCount 0`, `s2.sectionMs.self > 0`, `maxPenetration_mm < 8`. |
| 17 | `skirt_drape` | 4 s | `reloadSample('skirt'); __app.sim.reset(); s = step(300)`: `nanCount 0`, `maxPenetration_mm < 5`, `seamGapMax_mm < 8`, `seamGapMean_mm < 3`; `state.pIdx.length > 0` (waist edge pinned); mean y of `pTarget` within 0.04 m of `landmarks.waistCenter[1]`; mean y of all vertices `> landmarks.kneeL[1]` (skirt hangs, did not fall). |
| 18 | `grading` | 0.5 s | `reloadSample('tshirt')`; `M = gradedOutline('front','M')`, `L = gradedOutline('front','L')`, `S = gradedOutline('front','S')`: `M` deep-equals `doc.pieces.front.vertices` (base size unchanged); `bboxOf(L).w / bboxOf(M).w` within ±0.5 % of `92/88 = 1.04545`; `bboxOf(S).w / bboxOf(M).w` within ±0.5 % of `84/88`; both vertices of the front's `foldEdge` keep their x exactly (`|dx| < 1e-6` mm) in S, L, XL (scaling about the fold); `bboxOf(L).h / bboxOf(M).h` within ±0.5 % of `41/40` (lengthRef torsoLength_cm); for every seam `seamEase(id,'XL').easePct − seamEase(id,'M').easePct` within ±3. |
| 19 | `export_svg` | 1 s | `svg = __app.export.svgSheet({size:'M'})`: `parseSvg` succeeds; `svgSizeMm` gives `w,h` and root `viewBox === '0 0 ${w} ${h}'`; `svg.includes('PLACE ON FOLD')`; one `g[data-piece]` per piece with `exportHidden === false` (4 for the T-shirt: front, back, sleeve_l, sleeve_r; sleeves may be one group with `CUT 2` — accept `≥ 3`); the front group contains ≥ 1 `<path>` and the text `CUT 1 ON FOLD`; `xl = svgSizeMm(parseSvg(svgSheet({size:'XL'})))`, `s = svgSizeMm(parseSvg(svgSheet({size:'S'})))`: `xl.w > s.w && xl.h > s.h`. |
| 20 | `export_offset` | 0.5 s | `cut = __app.export.offsetPolygon('front','M')`: `isSimplePolygon(cut)`, `signedArea(cut) > signedArea(doc.pieces.front.vertices)`, `min x of cut ≥ −0.05` mm (no allowance on the fold edge; the half piece is stored with x ≥ 0 and the fold on x = 0), `cut.length ≥ 20`. Same for `'sleeve_l'` (no fold): simple, area larger, and the stitch vertices all inside the cut polygon (`pointInPolygon` re-implemented in the suite, 8 lines). |
| 21 | `export_print` | 1 s | `html = __app.export.printHtml({size:'M', paper:'A4'})`; `d = new DOMParser().parseFromString(html,'text/html')`; `pages = d.querySelectorAll('.page').length`; with `{w,h}` of the M sheet: `cols = max(1, ceil((w − 10)/180))`, `rows = max(1, ceil((h − 10)/267))` (A4 window 190×277 mm = 210×297 minus 10 mm margins, 10 mm overlap ⇒ step 180×267); `pages === cols·rows`; every `.page` contains one `<svg>` with a `viewBox`; `html.includes('100 mm')` (calibration square label) and the first page's svg contains `rect[data-calib]`. Repeat for `paper:'Letter'` (window 195.9×259.4 mm = 215.9×279.4 − 20; step 185.9×249.4) and `'A3'` (window 277×400; step 267×390): page counts match. |
| 22 | `export_csv` | 0.1 s | `csv = __app.export.sizeChartCsv()`: `lines = csv.trimEnd().split(/\r?\n/)`; `lines.length === 5`; `lines[0] === 'size,chest_cm,waist_cm,hips_cm,height_cm,torsoLength_cm,armLength_cm'`; row `M` equals `M,88,70,96,165,40,56`; row `XL` equals `XL,96,78,104,175,42,58`; no line contains `"`. |
| 23 | `json_roundtrip` | 0.2 s | `s1 = __app.saveProject()`; `s2 = serializeDoc(normalizeDoc(JSON.parse(s1)))`; `s1 === s2` (byte-identical); `__app.loadProject(s1); await idle(); __app.saveProject() === s1`; `JSON.parse(s1).version === 1`; keys of the parsed root are sorted (`Object.keys(o).join() === Object.keys(o).sort().join()`). |
| 24 | `undo_redo` | 0.5 s | `reloadSample('tshirt'); v0 = structuredClone(doc.pieces.sleeve_l.vertices)`; `__app.pattern.movePiece('sleeve_l', 50, −20); await idle()`: every vertex moved by exactly (50, −20); `__app.store.undo(); await idle()`: vertices deep-equal `v0`; `__app.store.redo(); await idle()`: moved again; after undo+redo `__app.pattern.getMeshes().length === 4` (remesh re-ran) and `step(60).nanCount === 0`. |
| 25 | `editor_api` | 1 s | `reloadSample('tshirt')`; `a = addPiece({name:'Sq A', vertices:[[0,0],[200,0],[200,200],[0,200]]})`, `b = addPiece({name:'Sq B', vertices:[[300,0],[500,0],[500,200],[300,200]]})` (defaults from `normalizeDoc`: line edges, first fabric, `simulate:true`, placement torso/front); `sid = addSeam({pieceId:a, edge:1, mirror:false, reverse:false}, {pieceId:b, edge:3, mirror:false, reverse:true})`; `await idle(); mesh = remesh(a)[0]`: `120 ≤ vertexCount ≤ 320`, `edgeVerts[0][1].length === 15` (`ceil(200/15) + 1`), equals the partner's `edgeVerts[0][3].length`; `validate()` has no error for a, b, sid; `removeSeam(sid); deletePiece(a); deletePiece(b); await idle()`: doc back to 4 pieces / 8 seams. |
| 26 | `ui_clicks` | 0.5 s | `reloadSample('tshirt')`; `__app.ui.click(IDS.layout2d)` → `doc.ui.layout === '2d'`, `getLayout() === '2d'`, `#pane-3d` has `hidden === true`; `click(IDS.layout3d)` → `'3d'`; `click(IDS.layoutSplit)` → `'split'`, both panes visible; `click(IDS.swap)` → `doc.ui.swapped` flipped and the DOM order of `#pane-2d`/`#pane-3d` inside their parent reversed; click again → restored; `click(IDS.tabBody)` → `doc.ui.dockTab === 'body'` and `#tab-body` has `aria-selected="true"`; `click(IDS.tabPieces)` → `'pieces'`; `click(IDS.play)` → `__app.sim.isRunning() === true`; `click(IDS.play)` → `false`. |
| 27 | `runtime` | — | synthetic, appended by the runner: total `ms < 90000`; details `'total 47.3 s'`. |

Excluded from the automated suite (manual, 13.6): pop-out window, print-to-PDF at 100 %, visual drape quality, drag interactions on the canvases.

### 13.4 Hanging-sheet fixture (check 12)

```js
import { makeHangingSheet } from '../src/cloth/fixtures.js';
import { step } from '../src/cloth/index.js';
import { FABRIC_PRESETS, resolveFabric } from '../src/core/fabrics.js';

function sagOf(presetId) {
  const fabric = resolveFabric({ id:'fx', name:'fx', preset:presetId, color:'#888888',
                                 texture:{kind:'solid', scale_mm:20, color2:'#888888'}, overrides:{} });
  const st = makeHangingSheet({ fabric, width_m:0.3, height_m:0.3, spacing_mm:10, pinTopCorners:true, selfCollision:true });
  for (let i = 0; i < 600; i++) step(st);               // 10 s of simulated time, 961 vertices, ≈ 1–2 ms per frame
  // vertex ids: the fixture lays vertices row-major, row 0 = top edge (pinned corners), row 30 = bottom edge
  const nx = 31, bl = 30*nx, br = 30*nx + 30, bm = 30*nx + 15;
  const yBL = st.pos[3*bl+1], yBR = st.pos[3*br+1], yBM = st.pos[3*bm+1];
  const spread = Math.hypot(st.pos[3*br]-st.pos[3*bl], st.pos[3*br+1]-yBL, st.pos[3*br+2]-st.pos[3*bl+2]);
  return { sag_mm: ((yBL + yBR)/2 - yBM) * 1000, spread_mm: spread * 1000, nan: st.nanCount };
}
```

`sag_mm` = how far the bottom-edge midpoint hangs below the two bottom corners. A stiff sheet pinned at its two top corners hangs as a flat rectangle (sag ≈ 0); a soft one lets its free sides curl inward and its hem sag into a "U", so sag is monotone in bending compliance (bending lengths at these presets: chiffon 1.0 cm, silk 1.3 cm, cotton 1.5 cm, denim 3.4 cm). Pass: `chiffon > silk > cotton > denim`, `chiffon − denim ≥ 10 mm`, all `nan === 0`; details list the four sag and spread values. If silk and chiffon tie at the mesh limit, A4 lowers the fixture spacing to 8 mm (the fixture parameters are the acceptance suite's; the fabric table is not tuned to pass this check — the check is there to catch a flat table).

### 13.5 Running under Chromium automation

```
run.bat                                             (serve.py on http://localhost:8710/)
chrome --new-window "http://localhost:8710/?acceptance=1"          # interactive: title becomes 'ACCEPTANCE PASS 27/27'
chrome --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --enable-logging=stderr ^
       --virtual-time-budget=120000 "http://localhost:8710/?acceptance=1" 2>&1 | findstr ACCEPTANCE_RESULT
```

Headless runs use the software renderer, so `perf` self-skips; every other threshold is renderer-independent (the solver is main-thread JS). Popups are never opened by the suite, so no `--disable-popup-blocking` is needed. A driver (Playwright-less: DevTools protocol via `python -m websockets` or any CDP client) reads `window.__acceptanceResult` after `document.body.dataset.acceptance` is set.

### 13.6 Manual checklist (not automated)

1. Pop-out: click `#btn-popout` → a second window titled "Clothing App — 3D" opens, shows the draped garment within 2 s, orbits independently; closing it restores the in-page 3D pane; the main window's `ui.layout` returns to its previous value.
2. Print: Sizes/Export → Print tiles (A4) → Ctrl+P → Save as PDF at 100 % → the calibration square on every page measures 100 mm with a ruler; tiles align on the 10 mm overlap strips.
3. Visual: T-shirt drapes with shoulders seated, sleeves hanging along the arms, no visible tunnelling at the armpit; changing fabric to silk visibly softens folds; chiffon is semi-transparent.
4. Editor: draw a piece with the Draw tool, add a seam with the Seam tool, watch the 3D view re-drape within 2 s; status bar shows `A 312 mm / B 328 mm — ease 5.1 %` while pairing edges.
5. Body sliders: dragging `chest_cm` shows a coarse rebuild while dragging and a full-resolution one on release, cloth stays outside the body.

## 14. Build plan

Eight implementation agents work in parallel after the lead has frozen the contracts. Directory ownership is section 2; nothing below overrides it.

### 14.1 Phase 0 — Lead (before fan-out; budget 2–3 h, not 1 h)

Files written by the lead, in this order:

| File | Content |
|---|---|
| `docs/SPEC.md` | this document, complete (sections 0–14). |
| `src/core/types.js` | section 3.1 verbatim. |
| `src/core/events.js` | section 3.2: `EventBus` (`on/off/emit/once`), `EVENT` constants. |
| `src/core/store.js` | section 3.3: `createStore`, `getDoc/update/undo/redo/load/subscribe`, 50-deep JSON snapshot history. |
| `src/core/schema.js` | `normalizeDoc` (all defaults of sections 3.1/4.4), `serializeDoc` (sorted keys, 2-space indent, `\n` line ends, trailing newline), `validateShape(doc): Issue[]`. |
| `src/core/units.js`, `src/core/ids.js`, `src/core/fabrics.js` (section 9.1 table), `src/core/sdf.js` (`sampleSdf`, `makeSphereGrid`, `gridIndex`, `gridContains`) | as named in section 2. |
| `src/samples/tshirt.js`, `src/samples/skirt.js`, `src/samples/index.js` | section 4.4. Each sample is `export const TSHIRT = /*SAMPLE-JSON-BEGIN*/ { … } /*SAMPLE-JSON-END*/;` where the literal between the markers is **strict JSON** (double-quoted keys, no trailing commas, no comments, no expressions) so Python can load it. |
| `index.html` | import map (three 0.180.0 from cdn.jsdelivr.net, `three/addons/`), the complete element-id skeleton of section 11, `<link rel=stylesheet href=styles/shell.css>` + `styles/app.css`, `<script type=module src=src/app/main.js>`, a `<noscript>`/error banner `#boot-error` that `main.js` fills when a module import fails. |
| `styles/shell.css` | grid geometry only: toolbar 44 px / main / statusbar 24 px; main = `[pane-left] [divider 6 px] [pane-right] [dock 300 px]`; `--split` variable; `[hidden]{display:none!important}`. |
| `popout.html` | skeleton only (title "Clothing App — 3D", import map, `<script type=module src=src/popout/main.js>`); A5 fills `src/popout/main.js`. |
| **Throwing stubs**: `src/geometry/index.js`, `src/pattern/index.js`, `src/body/index.js`, `src/cloth/index.js`, `src/viewer3d/index.js`, `src/sizing/index.js`, `src/export/index.js`, `src/ui/index.js` | each exports **every public name of its section with the final signature**, body `throw notImplemented('geometry.remesh')` (`Error` with `code:'ENOTIMPL'`); plus `src/<module>/selftest.js` exporting `runSelfTest()` that resolves `[{name:'stub', pass:false, details:'not implemented'}]`. These are the only files the lead writes inside agent directories; agents replace them wholesale. |
| `src/app/main.js`, `src/app/debugApi.js`, `src/app/wiring.js` (Phase-0 versions) | boot: create store + bus, `normalizeDoc(TSHIRT)` into the store, install `window.__app` with `version, ready, bootMs, errors, store, bus, loadSample, saveProject, loadProject, idle, acceptance.run` working and every module namespace present but delegating to the stubs; each module call is wrapped so `ENOTIMPL` shows `module X: not implemented` in `#status-warn` instead of breaking boot. A8 replaces these. |
| `tests/acceptance.js` (Phase-0 version) | the runner of 13.1 with checks 1, 2, 22, 23 implemented (they need only core + samples) and the others registered as `{pass:false, details:'not implemented'}`. A8 completes it. |
| `tools/vendor.py`, `tools/check_samples.py` | see 14.5 row 7 and the verification below. |

**Phase-0 verification (must pass before fan-out):**

1. `python tools/check_samples.py` — parses the JSON between the markers of both samples and asserts, in Python (no browser): ids unique; every piece `signedArea > 0`, `edges.length === vertices.length`, cubic edges have `c1,c2`; outline simple (segments of the outline sampled at 32 points per cubic edge, O(n²) proper-intersection test); `foldEdge` is a `line` edge and all vertices lie on the non-negative side of its line (fold pieces stored as a half, |x| ≥ −0.01 mm off the fold); `notches[].t ∈ (0,1)`; `fabricId` exists in `fabrics`; `seams[].a/b.edge !== foldEdge`, `mirror` only on fold pieces; every `SeamSide` references an existing piece/edge; **for every seam the two side lengths (cubics integrated with 200 segments) agree within 3 %** (`|lenA − lenB| / min ≤ 0.03`); the T-shirt has exactly 8 seams (2 shoulder, 2 side, 2 sleeve cap, 2 underarm) and the skirt 2 side seams (+ waistband export-only piece); size chart rows S/M/L/XL with the six keys and M equal to `female_m`; estimated vertex count `Σ(area/(h²√3/2) + perimeter/h)` over simulated pieces is within [2500, 6000] for the T-shirt (expected ≈ 3800 at h = 15) and [1500, 5000] for the skirt. Prints a table of piece areas, edge lengths and seam ease %.
2. Browser: `run.bat`, open `http://localhost:8710/` — no uncaught error in the console, `#status-warn` lists the 8 stubbed modules, `await __app.ready` resolves, `validateShape(__app.store.getDoc())` returns `[]` for both samples (`__app.loadSample('skirt')`), `__app.acceptance.run()` reports checks 1, 2, 22, 23 passing and the rest `not implemented`.
3. `serializeDoc(normalizeDoc(TSHIRT)) === serializeDoc(normalizeDoc(JSON.parse(serializeDoc(normalizeDoc(TSHIRT)))))` (idempotent normalisation) — checked in the same console session.

Only after all three pass are `src/core/`, `src/samples/`, `index.html`, `styles/shell.css` and `docs/SPEC.md` declared frozen and the agents launched.

### 14.2 Phase 1 — eight parallel agents

Common rules for every agent: work only inside the owned directory (plus the files listed); import only along the arrows of section 2; keep every public signature exactly as the Phase-0 stub declares it; ship `src/<module>/selftest.js` exporting `runSelfTest(): Promise<SelfTestResult[]>` that runs in **< 5 s**, allocates its own fixtures and touches no app state (pure modules must not touch the DOM in the self-test either); never edit `src/core/`, `src/samples/`, `index.html`, `styles/shell.css`, `docs/SPEC.md` — a needed change is a message to the lead. An agent is "done" when its selftest is green in the browser console (`(await (await import('./src/geometry/selftest.js')).runSelfTest()).every(r => r.pass)`) and the deliverable check below holds.

| Agent | Directory | Responsibilities (spec sections) | Consumes | Must NOT touch | Tests in isolation with | Selftest gate (all must pass) |
|---|---|---|---|---|---|---|
| **A1 Geometry** | `src/geometry/` | bezier sampling/length, polygon predicates, mirror, seeded PRNG, Bowyer–Watson Delaunay with boundary repair (both seam partners), remesh → `PieceMesh`, polygon offset with round/mitre joins and loop removal, shelf packer (section 5) | `core/types`, `core/ids.hashString`, `src/samples` (read-only fixtures) | DOM, three, any other `src/*` | the two samples plus hand-written fixtures (200 mm square, concave "C", 60° wedge, a piece with a cubic neckline) | flat rectangle mesh count within ±10 % of the analytic estimate; every sample piece: `pctAbove20 ≥ 98`, boundary edges present exactly once, seam partners equal counts including after a forced midpoint insertion; offset of the "C" and wedge fixtures is simple with area > input; `sampleByArcLength` spacing error < 1 %; deterministic (same seed → byte-equal `positions2d`). |
| **A2 Pattern editor** | `src/pattern/` | canvas editor, view transform, hit testing, render2d, tools (select/draw/edit/split/seam/notch/grainline/measure), `validate`, seam ease readout (section 5/7 of the editor spec) | `core/*`, `geometry` public API (through the stub until A1 lands) | `src/ui/` DOM outside `#pane-2d`, the store's history internals | a detached `<canvas>` created by the selftest + the store loaded with the T-shirt sample; tool calls driven programmatically (`tool.onDown/onMove/onUp` with mm coordinates through `pxToMm`) | draw tool closes a 4-vertex square into a valid CCW piece; split tool preserves the curve (max deviation < 0.1 mm) and renumbers seams/notches; seam tool creates a seam with auto `reverse`; `mmToPx(pxToMm(p)) ≈ p` within 1e-6; hit test finds a vertex within 6 px and nothing at 20 px; `validate()` reports CW outlines and self-intersections. |
| **A3 Body** | `src/body/` | params/presets (section 6.1), skeleton landmarks, primitives (SDF formulas), superellipse loft with closed-form perimeter scaling, SDF bake (15 mm full / 30 mm drag) with per-cell primitive cull and smin joints, ray-cast `measure`, anchors, render mesh via `BufferGeometryUtils.mergeGeometries` (`body/mesh.js` only) | `core/types`, `core/sdf`, `core/units`, `geometry` (2D helpers only), three (mesh.js only) | `src/cloth/`, `src/viewer3d/`, DOM | nothing external: builds presets from `presets.js` in the selftest | every preset builds without NaN in < 1500 ms; `female_m` measured chest/waist/hips within 1.5/1.5/2.0 cm; SDF negative at chestCenter/waistCenter, positive 5 cm in front of the chest with `n·z > 0.7`, `+1` outside the grid; `sampleSdf` gradient norm within 1e-3 of 1 at 1000 random near-surface points; landmarks ordered (`headTop.y > chin.y > neckBase.y > … > ankleL.y`); anchor axes/front unit and orthogonal; `+x` is the model's left (`shoulderL.x > 0`). |
| **A4 Cloth** | `src/cloth/` | `ClothState` builder (`state.js`), arrangement on anchor cylinders, XPBD solver with 10 substeps, distance/bend (linear Bergou form)/seam ramp/pin constraints, SDF collision + friction + CCD-lite, vertex–vertex self-collision with spatial hash and seam mask, safety (clamps, NaN snapshot restore), stats, `testfields.js` (sphere/plane SDF grids), `fixtures.js` (hanging sheet, sheet-on-sphere, two rectangles sewn) (section 8) | `core/types`, `core/sdf`, `core/fabrics`, `core/units` **only** | three, DOM, `src/body/` (uses `makeSphereGrid` / `testfields.js` instead), `src/geometry/` (fixtures build their own `PieceMesh` literals) | `testfields.js` sphere grid + `fixtures.js` meshes; never the real body | hanging 0.3 m sheet stable 1200 frames (`nanCount 0`, `maxSpeed < 0.5` at the end, top pins unmoved); sheet dropped on the unit-sphere grid: `maxPenetration_mm < 2` after 300 frames; two 100 mm rectangles 80 mm apart sew shut: `seamGapMax_mm < 2` at frame 120; flat bending patch `C = 0`, bent patch `C > 0` and one projection reduces `|L|`; strain of a cotton sheet under its own weight < 2 %; `step` allocates nothing (compare `performance.memory` when available, else instrument with a counter in debug mode); determinism: two identical runs give byte-equal `pos` after 300 frames; fabric ordering on the hanging sheet as in 13.4. |
| **A5 Viewer3D + pop-out** | `src/viewer3d/`, `src/popout/main.js`, `popout.html` | scene (renderer, camera, OrbitControls, lights, ground grid), cloth `BufferGeometry` bound to `ClothState.pos`, body mesh from `BodyModel.geometry`, fabric → `MeshPhysicalMaterial`, procedural `CanvasTexture`s, render loop with frame stepping, anchor gizmos, BroadcastChannel bridge for the pop-out (section 9) | `core/types`, `core/fabrics`, three, `three/addons/` | `src/cloth/` internals (reads `ClothState` by shape only), `src/body/`, DOM outside `#pane-3d` and `popout.html` | a **fake `ClothState`** built in `selftest.js` (a 10×10 grid sheet with `tris`, `pieces[]`, `pos` animated by a sine) and a fake `BodyModel.geometry` (a capsule) | renders 60 frames without WebGL errors on an offscreen 256×256 canvas; positions upload each frame (`geometry.attributes.position.array === state.pos`); all 7 presets produce a material with the right `color.getHexString()`, `opacity`, `transparent`, `sheen`, `clearcoat`; textures generate for the 6 kinds in < 20 ms each; `setColor` changes the material without reallocating geometry; renderer `outputColorSpace === SRGBColorSpace`. |
| **A6 Sizing + Export** | `src/sizing/`, `src/export/` | size chart model, grading (measurement-driven scaling about the anchor + vertex rules, notches keep `t`), per-size seam-ease drift, SVG sheet / per piece / grade nest, print tiles HTML (A4/Letter/A3, 10 mm margins, 10 mm overlap, calibration square and crop marks per tile), CSV (cm), download helper (section 10) | `core/*`, `geometry` (bezier, offset, pack), `src/samples` (fixtures) | DOM except `download.js` (`Blob` + `<a download>`), `src/pattern/`, `src/cloth/` | the samples directly (`TSHIRT`, `SKIRT`) and the default size chart | `gradedOutline('front','L')` width ratio `92/88` ± 0.5 % with the fold x unchanged; SVG parses with `DOMParser`, `width`/`height` in mm, `viewBox` consistent, contains `PLACE ON FOLD` and `CUT 1 ON FOLD` for fold pieces and `CUT 2` for sleeves; y flipped exactly once (a vertex at pattern (0, 100) lands 100 mm above a vertex at (0, 0) in SVG user units); cut polygon simple for every sample piece and every size; print page count equals the 13.3 formula for A4/Letter/A3 for both samples; CSV = 5 lines, header exactly as in check 22; all exporters return strings and never touch `document` (except `download.js`). |
| **A7 UI shell** | `src/ui/`, `styles/app.css` | layout (split, divider drag, swap, 2d/3d/split), toolbar, dock tabs, status bar, keyboard shortcuts (no Tab), panels (pieces, body, fabric, sizes) bound to the store (section 11) | `core/*` and every module's public `index.js` (through stubs until they land) | `index.html` (ids are frozen), `styles/shell.css`, module internals | the store loaded with the T-shirt sample and the stubs: panels must render and write back to the store even when every module throws `ENOTIMPL` (they show the warning, nothing else) | every section-11 id exists once; clicking `#btn-layout-2d/3d/split` and `#btn-swap` updates `doc.ui` and DOM order/visibility; dock tabs set `doc.ui.dockTab` and `aria-selected`; body sliders write `body.params` (input event → store update, `preset` becomes `custom`); fabric colour input writes `fabrics[].color`; sizes table cell edit writes `sizes.rows`; shortcuts: `Space` toggles play, `Ctrl+Z/Y` undo/redo, `Esc` cancels the tool, `1–4` dock tabs; status bar shows tool hint / cursor mm / sim stats fields; no shortcut uses `Tab`. |
| **A8 Integration + QA** | `src/app/`, `tests/acceptance.js` | `main.js` boot order, `wiring.js` (the only event → module-call file), `debugApi.js` (`window.__app`, section 12, including `errors`, `bootMs`, `idle`, `ui.click`, `selftest.runAll`, `acceptance.run`), `?acceptance=1`, the full acceptance suite (section 13) | everything | module internals; A8 never fixes a module — files a bug to its owner (14.4) | Phase-0 stubs first (wiring must survive every module throwing), then real modules as they land | `__app` exposes every member of the section-12 table; `wiring.js` reacts to each section-3.2 event exactly as specified and to nothing else; checks 1, 2, 22, 23 pass on the stubs; the complete suite passes on the integrated app. |

Blocking relationships and how they are broken: A2, A6 and A4 consume A1's geometry names but start against the stub signatures (A2 draws straight-edge pieces first; A6 exports the samples' vertex polygons with a straight-edge offset first; A4 uses `fixtures.js` meshes). A4 never waits for A3 (`testfields.js`). A5 never waits for A4/A3 (fake state). A7 never waits for anyone (stubs throw, panels still bind). A8 integrates modules in the order they turn green.

### 14.3 Phase 2 — integration (A8 + lead, ≈ 2 h)

Modules are enabled in `src/app/main.js` one at a time, in this order, each step verified in the browser console before the next; a step that fails is reverted (the stub is restored by `git`-less copy from `docs/stubs/` — the lead keeps a copy of every Phase-0 stub there) and the owner is notified.

| Step | Enable | Verify (console) |
|---|---|---|
| 1 | core + samples (Phase 0) | `await __app.ready`; `__app.errors.length === 0`. |
| 2 | `geometry` | `__app.pattern.remesh()` → 4 `PieceMesh`, `pctAbove20 ≥ 98`, seam parity; `console.table(meshes.map(m => m.quality))`. |
| 3 | `sizing`, `export` | `parseSvg(__app.export.svgSheet({size:'M'}))`, `sizeChartCsv().split('\n').length === 5`, `printHtml` page count. |
| 4 | `body` + `viewer3d` (body only) | `m = await __app.body.rebuild()`; `m.measured`; the body renders in `#pane-3d`; `sdf` sign checks of 13.3 #6. |
| 5 | `cloth` + viewer cloth mesh | `__app.sim.reset(); __app.sim.step(300)` → thresholds of 13.3 #8; the draped shirt is visible; `__app.sim.play()` runs at 60 fps with `stats().msAvg < 16`. |
| 6 | `pattern` editor | the 2D pane shows the sample; `__app.pattern.movePiece('sleeve_l', 50, 0)` re-draws and (via wiring) re-meshes + re-drapes within 2 s. |
| 7 | `ui` panels + shortcuts | 13.3 #26; body slider drag → coarse bake while dragging, full bake on release; fabric colour input → material. |
| 8 | `debugApi` complete + `tests/acceptance.js` complete | `await __app.acceptance.run()` → all 27 results present, failures triaged in Phase 3. |
| 9 | `popout` | manual 13.6 #1. |

Smoke script (run after step 8; each line is pasted into the console, expected result on the right):

```
await __app.ready                                             // undefined, bootMs < 8000
__app.loadSample('tshirt'); await __app.idle()                // 4 meshes, drape starts automatically
__app.sim.pause(); __app.sim.step(300)                        // {nanCount:0, maxPenetration_mm:<5, seamGapMax_mm:<8, ...}
__app.body.setParam('chest_cm', 100); await __app.body.rebuild()   // BodyModel, measured.chest_cm ≈ 100
__app.sim.step(120).maxPenetration_mm                         // ≤ 8
__app.fabric.setPreset('main', 'silk'); await __app.idle(); __app.sim.step(300).nanCount   // 0
__app.fabric.setColor('main', '#ff0000'); await __app.idle(); __app.viewer.materialOf('front').color.getHexString()   // 'ff0000'
__app.ui.click('btn-layout-2d'); __app.ui.getLayout()         // '2d'
__app.ui.click('btn-layout-split')
__app.export.svgSheet({size:'L'}).slice(0, 120)               // '<svg xmlns=… width="…mm" height="…mm" viewBox="0 0 … …">'
__app.loadSample('skirt'); await __app.idle(); __app.sim.pause(); __app.sim.step(300)   // thresholds of 13.3 #17
(await __app.acceptance.run()).pass                           // true
```

(`'main'` above is the T-shirt's `FabricInstance.id` from section 4.4; the suite itself reads it from the document.)

### 14.4 Phase 3 — review / fix loop

1. A8 runs `__app.acceptance.run()` in an interactive Chromium and in headless mode (13.5); the summary is posted to the lead with the failing names and details.
2. **Triage** — each failing check is assigned to exactly one owner by the rule: the check's first failing assertion names a module (mesh → A1, body → A3, drape/strain/perf/fabric-ordering → A4, colour/material → A5, grading/export → A6, ui/ids → A7, boot/roundtrip/undo/wiring → A8); a threshold failing because two modules disagree about a contract (e.g. cloth expects `edgeVerts[1]` non-empty for a non-fold piece) goes to the **consumer**.
3. **Bug-fix ownership rule**: only the owner edits the files in its directory; A8 edits only `src/app/` and `tests/`; **the consumer adapts** to the contract as written in this document — a module that reads another module's output changes its own reading, never asks the producer to change shape. **Contracts (`src/core/*`, section 3, 4.4, 11) change only by the lead**, who edits SPEC.md first, bumps the "Status" line with a dated note, then edits the core file, then notifies every agent whose section cites the changed name. Thresholds in section 13 are not tuned to make a check pass; a threshold change also requires the lead and a one-line justification in the check's details string (e.g. `perf: msAvg < 16 (test machine: i5-1135G7)`).
4. The loop repeats until `summary.pass === true` twice in a row (interactive) and the headless run agrees on every non-perf check; a check that cannot be made to pass in the session is recorded as a **waiver** in `docs/SPEC.md` section 13 (name, measured value, owner, reason) — waivers are the only permitted red results at v1 sign-off, and `runtime`, `boot`, `drape_tshirt`, `skirt_drape`, `json_roundtrip`, `export_svg` may never be waived.
5. Sign-off: the lead runs `python tools/check_samples.py`, `?acceptance=1` interactive, the manual checklist 13.6, and `python tools/vendor.py --check` (import map still resolves), then tags the tree as v1 (copy to `dist/v1/` — no git required).

### 14.5 Risks and mitigations

| # | Risk | Where it bites | Mitigation (owner) | Detected by |
|---|---|---|---|---|
| 1 | Mesher fails on concave/curved outlines (armhole, neckline): missing boundary edges, slivers, holes | A1 remesh | interior clearance ≥ 0.6 h with `max(1, ceil(L/h))` boundary sampling (Gabriel condition), deterministic seeded jitter ±0.15 h with up to 3 re-seeds, midpoint insertion mirrored onto the seam partner, sliver drop, `h *= 1.3` retry, ear-clip + midpoint-subdivision fallback so a piece never fails to mesh; `RemeshError` isolates one piece, the rest simulates (A1, A8 wiring) | checks 4, 5, 25; A1 selftest on the "C"/wedge fixtures |
| 2 | Sim instability: sewing explosions, pieces flipping through the body, NaN | A4 | rest-length seam ramp (never stiffness ramp), gravity ramp 0→1 over 0.5 s and 5× damping during sewing, 5 m/s velocity clamp applied before prediction and a `maxStep = min(0.5·spacing, 8 mm)` per-substep displacement clamp, collision every substep, arranged vertices pushed out of the body before frame 0, NaN snapshot restore (every 60 sane frames) before escalating to reset (A4) | checks 8, 9, 13, 15, 16, 17 (`nanCount`, `maxSpeed`) |
| 3 | SDF gradient discontinuities at armpit/crotch/neck cause jitter and creeping | A3 bake, A4 collide | polynomial smin (k = 0.04 m) at every joint pair during the bake; analytic trilinear gradient (no central differences); friction evaluated against the pre-projection normal displacement with a 1 mm active band so resting vertices keep static friction (A3, A4) | checks 8/9 (`maxSpeed < 0.5` at rest, CoM drift), manual 13.6 #3 |
| 4 | Performance: > 16 ms solver frames, UI stalls, bake stalls | A4, A3, A5 | typed arrays, no per-frame allocation, 1 GS iteration × 10 substeps, self-collision every 2nd substep, vertex cap 8000 (mesh spacing auto-raised with a warning), per-cell primitive cull in the bake, coarse 30 mm grid during slider drag, debounced 150 ms full bake with the old grid kept until atomic swap; fixed `dt`/substeps (no adaptive substepping — determinism for the suite) (A4, A3) | check 11 (`msAvg < 16`), check 15 (rebuild < 500 ms), `sectionMs` in the status bar |
| 5 | Seam parity: partner edges end up with different vertex counts or mismatched pairing direction | A1, A2 | counts fixed by `max(2, ceil(max(LA, LB)/h))` on both sides, insertion mirrored, `reverse` chosen by the editor by nearest endpoints, `validateShape` rejects seams on fold edges, `check_samples.py` verifies partner lengths within 3 % before fan-out (lead, A1, A2) | check 5, 25; Phase-0 verification 1 |
| 6 | Popup blocking: `window.open` from script is blocked; pop-out loses sync | A5, A8 | pop-out opened only from a user click, excluded from the automated suite (manual 13.6 #1), "Swap" gives the same benefit in one window; heartbeat `{type:'hello'}` every 1 s, main window restores the in-page pane if none for 3 s; the suite never opens windows (A5) | manual 13.6 #1 |
| 7 | CDN offline / blocked network: three.js does not load, blank page | everyone | `tools/vendor.py` (lead, Phase 0): downloads the exact file list `VENDOR_FILES = ['build/three.module.js', 'examples/jsm/controls/OrbitControls.js', 'examples/jsm/utils/BufferGeometryUtils.js']` (agents append any addon they import) from `https://cdn.jsdelivr.net/npm/three@0.180.0/` into `vendor/three/`, then writes `index.local.html` and `popout.local.html` — copies of the shell pages whose import map is the **second import map** `{"three":"./vendor/three/build/three.module.js","three/addons/":"./vendor/three/examples/jsm/"}`; `--check` verifies both HTML files reference existing paths. `main.js` shows `#boot-error` with the text "three.js failed to load — run `python tools/vendor.py` and open index.local.html" when the dynamic `import('three')` rejects | boot check (`errors`), `#boot-error` visible |
| 8 | Windows MIME types: `.js` served as `text/plain` breaks ES modules | everyone | `serve.py` already forces `application/javascript` for `.js/.mjs`, `text/css`, `image/svg+xml`, `no-store` caching; `run.bat` is the only documented way to serve; never open `index.html` from `file://` (import maps + modules need http) (lead) | boot check |
| 9 | Colour-space mismatch: `#ff0000` renders as a different hex, textures look washed out | A5 | `renderer.outputColorSpace = SRGBColorSpace`, `material.color.set(hex)` (three converts to linear internally), `CanvasTexture.colorSpace = SRGBColorSpace`, no manual gamma; the 2D editor and 3D use the same `FabricInstance.color` string (A5, A2) | check 14 (`getHexString() === 'ff0000'`), manual 13.6 #3 |
| 10 | Browser autoplay / hidden-tab throttling: rAF stops in background tabs, `sim.step(n)` in a hidden headless tab is slow, timers throttled | A5 loop, A8 suite | the sim advances only inside rAF (no `setInterval` catch-up, so a hidden tab simply pauses — deterministic); the suite steps synchronously via `step(n)` and never waits on timers except `idle()`; `idle()` is promise-based on events, not `setTimeout`; headless runs pass `--virtual-time-budget`; `perf` self-skips on software renderers (A5, A8) | check 27 (`runtime`), check 11 |
| 11 | Undo memory: 50 JSON snapshots of a document with many pieces exhaust memory or make `update` slow | core store (lead), A2 | snapshots are serialised strings (`serializeDoc`, ≈ 20–50 kB each → ≤ 2.5 MB), history capped at 50 with FIFO eviction, drag interactions coalesce into one snapshot per pointer-up (`update(fn, {undoable:false})` during the drag, one undoable commit on release), no snapshot for `ui.*` changes (lead, A2, A7) | check 24; A2 selftest (`history.length ≤ 50` after 200 drags) |
| 12 | Fabric table dynamically flat: every fabric drapes like cardboard or like tissue | A4, lead (9.1) | bending in the linear form `C = |L|·sqrt(3/(A0+A1))` with `alpha = 1/B`, B in N·m from Kawabata ranges; membrane `alpha_edge = L/Y`; `bendScale`/`stretchScale` global multipliers exposed in the Fabric panel (A4) | check 12 (`fabric_ordering`), check 10 (`strain_cotton`) |
| 13 | Contract drift between agents (renamed fields, different units) | all | `src/core/` frozen, stubs carry final signatures, `_cm`/`_mm` suffixes everywhere, conversions only in `units.js`, A8 integrates against the stubs from hour 2, consumer-adapts rule 14.4 (lead) | checks 3 (self-tests), 23 (`json_roundtrip`) |
| 14 | Print scale wrong (printer "fit to page") | A6 | `@page { margin:0 }`, explicit `width="…mm"`, 100 mm calibration square and "Scale 100 %, no fit-to-page" header on every tile (A6) | check 21, manual 13.6 #2 |
| 15 | Body change with cloth present: vertices trapped inside the new body | A4 | on `body:built` the solver pushes vertices out with at most `min(pen, 5 mm)` per frame (gentle re-projection), CCD-lite sign-flip check against the new grid (A4) | check 15 (`maxPenetration_mm ≤ 8` after 120 frames) |

**PROPOSED types.js amendment** (reviewer decides; none of the checks above depend on it): none. The suite only reads fields that already exist on `ClothState`, `SimStats`, `BodyModel`, `PieceMesh`, `ProjectDoc` and `SelfTestResult`. The additional runtime members it needs (`__app.errors`, `__app.bootMs`, `__app.idle`, `__app.viewer.materialOf`, `__app.selftest.runAll`, `makeHangingSheet` in `src/cloth/fixtures.js`) are section-12 / section-8 API surface, not typedefs.
