# Clothing App — module contracts cheat sheet (Phase 0, reconciled 2026-09-12)

This is the fan-out cheat sheet: the exact export list of every module `index.js` (as stubbed in Phase 0), the events each module emits/listens (SPEC 3.2), and the element ids each module owns (SPEC 11.1). It is derived from `docs/SPEC.md` after the Phase-0 reconciliation; where the two disagree, SPEC.md wins — tell the lead.

**Conventions (SPEC 1):** pattern space mm, y up, outlines CCW (`signedArea > 0`), outward normal of direction `d` = `[d[1], -d[0]]`; body/sizes cm with `_cm` keys; 3D metres, y up, model faces +z, **+x = model's LEFT**; radians in code; errors are `Error` with a `code` property; pure modules (`geometry`, `body` except `mesh.js`, `cloth`, `sizing`, `export` except `download.js`) never touch the DOM, `three`, the store or the bus; only `src/app/wiring.js` calls one module's API in reaction to another module's event.

**Dependency arrows (SPEC 2):** samples → nothing · geometry → core · pattern → core, geometry · body → core, geometry (+ three in `mesh.js`) · cloth → core only · viewer3d → core, three · sizing → core, geometry · export → core, geometry, sizing · ui → core + every module's `index.js` · app → everything · popout → core, viewer3d.

**Store API (SPEC 3.3) — the spelling every consumer uses:** `createStore(doc, bus, opts?)`; `store.get()`, `store.update(mutator, label)` (mutator FIRST; hints computed by the store; ui-only changes never create history — there is no `undoable` option), `store.batch(label)` → `{update, commit, cancel, active, lastError, label}` for drags (steps emit `origin:'drag'`), `store.undo()/redo()/canUndo()/canRedo()/history()`, `store.replace(doc, label, {keepHistory?})` (a load; emits `origin:'replace'`; there is no `store.load` and no `doc:loaded`), `store.subscribe(change => …)` (same payload as `doc:changed`, before the bus emit), `store.transient` (`tool, selection, hover, seamPick, running, phase, popoutId`), `store.revision`. Also exported: `diffHints`, `makeTransient`, `TOOL_NAMES`, `HISTORY_LIMIT`.

**`doc:changed` payload:** `{label, origin:'update'|'drag'|'commit'|'cancel'|'undo'|'redo'|'replace', doc, warnings, pieces?:string[], seams?:string[], fabrics?:string[], body?:true, sizes?:true, sim?:true, ui?:true, name?:true}`. Expensive reactions skip `origin:'drag'`.

---

## EVENT table (SPEC 3.2.2) — the only names the bus accepts

| constant | name | payload | emitter → listeners |
|---|---|---|---|
| `DOC_CHANGED` | `doc:changed` | `DocChanged` (above) | store → wiring, pattern/editor, ui/panels/*, ui/toolbar, debugApi |
| `SELECTION_CHANGED` | `selection:changed` | `{selection:{pieces, seams, vertex:{pieceId,index}|null, edge:{pieceId,edge}|null}, prev}` | pattern/editor → ui/panels/pieces, ui/statusbar, wiring (anchor gizmo) |
| `TOOL_CHANGED` | `tool:changed` | `{tool, prev}` | pattern/editor → ui/toolbar, ui/statusbar |
| `HOVER_CHANGED` | `hover:changed` | `{mm:Vec2|null, pieceId, edge, vertex, seamId}` (≤ 60 Hz) | pattern/editor → ui/statusbar |
| `SEAM_PREVIEW` | `seam:preview` | `{a, b, lenA_mm, lenB_mm, easePct, level:'ok'|'warn'|'error', seamId}` | pattern/tools/seam → ui/statusbar, ui/panels/pieces |
| `VIEW2D_CHANGED` | `view2d:changed` | `{pxPerMm, panMm, width, height}` | pattern/view (via editor) → ui/statusbar, debugApi |
| `PATTERN_ISSUES` | `pattern:issues` | `{issues:Issue[]}` | pattern/editor → ui/panels/pieces, ui/statusbar, wiring |
| `BODY_PARAMS_DRAG` | `body:params:drag` | `{key, params}` (store NOT written) | ui/panels/body → wiring only (coarse build, 100 ms throttle) |
| `BODY_PARAMS_COMMIT` | `body:params:commit` | `{key|null, preset, params}` (after `store.update`) | ui/panels/body → ui/statusbar, ui/panels/body |
| `BODY_BUILT` | `body:built` | `{model, quality:'coarse'|'full', ms}` | wiring → ui/panels/body, ui/statusbar (viewer via wiring `setBody`) |
| `MESH_BUILT` | `mesh:built` | `{meshes, issues, ms}` | wiring → ui/panels/pieces, ui/statusbar |
| `SIM_BUILT` | `sim:built` | `{state, meshes, ms}` | wiring → ui/toolbar (enable play), ui/statusbar |
| `SIM_STATS` | `sim:stats` | `SimStats` — ONE object reused every frame; copy fields | wiring tick (60 Hz) → ui/statusbar (4 Hz DOM), debugApi |
| `SIM_PHASE` | `sim:phase` | `{phase:'arranged'|'sewing'|'draping'|'paused', prev, time, frame}` | wiring → ui/toolbar (`setRunning`), ui/statusbar |
| `SIM_NAN` | `sim:nan` | `{frame, nanCount, restored:'snapshot'|'reset'}` | wiring → ui/statusbar, debugApi |
| `FABRIC_CHANGED` | `fabric:changed` | `{fabricId, resolved, physicsChanged, lookChanged, pieceIds}` | wiring → ui/panels/fabric, pattern/editor (fill colour) |
| `SIZE_ACTIVE` | `size:active` | `{size, prev, row|null}` | wiring → pattern/editor (ghost), ui/panels/sizes, ui/toolbar, ui/statusbar |
| `UI_LAYOUT` | `ui:layout` | `{layout, swapped, split, popout}` | ui/layout → ui/toolbar, pattern/view + viewer3d/scene (frame all, via wiring) |
| `UI_DOCK` | `ui:dock` | `{tab, prev}` | ui/dock → ui/panels/* |
| `UI_STATUS` | `ui:status` | `{level:'info'|'warn'|'error', text, source?, ttl_ms?, code?}` | anyone DOM-side, wiring, the bus itself → ui/statusbar, debugApi |
| `UI_ACTION` | `ui:action` | `{action, ...}` (SPEC 11.1.2 toolbar table, 11.7 shortcuts, panel intents `selectPiece`/`selectSeam`) | ui/toolbar, ui/shortcuts, ui/panels/* → **wiring only** |
| `POPOUT_OPEN` / `POPOUT_CLOSE` | `popout:open` / `popout:close` | `{at}` / `{reason:'user'|'unload'|'timeout'|'blocked', at}` | wiring (from the bridge callbacks) → ui/toolbar, ui/statusbar |
| `APP_READY` | `app:ready` | `{version, ms, sample}` | app/main → debugApi, ui/statusbar |

Names that do NOT exist (older drafts): `doc:loaded`, `cloth:built`, `status`, `status:message`, `ui:resize`, `ui:dockTab`, `pattern:cursor`, `pattern:seamEase`, `fabric:preview`, `sim:scale:drag`, `sim:state`, `sim:quality`, `popout:changed`. `bus.emit`/`on` of an unknown name throws `UnknownEvent`.

---

## src/core (Lead, frozen)

- `types.js` — every typedef (SPEC 3.1). No runtime exports.
- `events.js` — `class EventBus {on, once, off, emit, listenerCount, clear, errors, errorCount}`, `bus`, `EVENT`.
- `store.js` — `createStore(doc, bus, opts?)`, `HISTORY_LIMIT`, `TOOL_NAMES`, `makeTransient()`, `diffHints(prev, next)`.
- `schema.js` — `DOC_VERSION`, `DEFAULT_BODY_PRESET`, `DEFAULT_BODY_PARAMS`, `BODY_PARAM_KEYS`, `DEFAULT_SIZE_MEASUREMENTS`, `defaultSizeChart()`, `defaultSimSettings()`, `defaultUiState(baseSize)`, `defaultPlacement()`, `defaultGrading()`, `normalizeDoc(partial)`, `normalizePiece(partial, ctx)`, `normalizeSeam(partial)`, `normalizeFabricInstance(partial)`, `serializeDoc(doc)`, `stableStringify(value, indent)`, `parseDoc(text)`, `validateShape(doc)`, `migrate(doc)`, `controlPolygonArea(piece)`.
- `units.js` — `MM_PER_M, MM_PER_CM, CM_PER_M, DEG_PER_RAD, mmToM, mToMm, cmToM, mToCm, cmToMm, mmToCm, degToRad, radToDeg, clamp, roundTo, fmtMm, fmtCm, fmtM, fmtPct, PAPER, PAPER_IDS, TILE_OVERLAP_MM, printableArea(paper), tileStep(paper), tileCount(paper, W_mm, H_mm)`.
- `ids.js` — `uid(prefix)`, `resetUidCounter(n)`, `seedUidRandom(seed)`, `isValidId(s)`, `hashString(s)`.
- `fabrics.js` — `FABRIC_PRESETS, FABRIC_PRESET_IDS, PHYSICS_KEYS, TEXTURE_KINDS, DEFAULT_TEXTURE, BODY_LOOK, getPreset(id), hasPreset(id), isHexColor(s), resolveFabric(instance), resolveAll(doc) → Map, diffResolved(a, b), fabricForPiece(doc, piece), effectiveMeshSpacing(piece), mixHex(a, b, t)`.
- `sdf.js` — `SDF_OUTSIDE, SDF_EPS_GRAD, gridIndex(grid, i, j, k), gridContains(grid, x, y, z), gridBounds(grid), sampleSdf(grid, x, y, z, outGrad) → number, makeGridFromFn(origin, cell, nx, ny, nz, fn), makeSphereGrid(centre, radius, cell, pad), makeCapsuleGrid(a, b, radius, cell, pad), sphereDistance(centre, radius, x, y, z, outGrad)`.

## src/samples (Lead, frozen; imports nothing)

`deepFreeze(o)`, `DEFAULT_SAMPLE_ID = 'tshirt'`, `SAMPLES` (frozen `{id, name, doc}[]`), `listSamples() → {id, name}[]`, `getSample(id) → ProjectDoc` (fresh clone; unknown id throws `code 'UNKNOWN_SAMPLE'`). T-shirt: pieces `front, back, sleeve_l, sleeve_r`, **10 `Seam` records** (8 garment seams), fabric `main` (cotton `#c8102e`). Skirt: `front, back`, 2 seams, `pinnedEdges [2]`, fabric `main` (denim `#3b5b8c`, twill 4 mm).

---

## src/geometry (A1) — `index.js` exports (SPEC 5); pure, mm

```js
// bezier.js
cubicPoint(p0, c1, c2, p1, u) → Vec2
cubicTangent(p0, c1, c2, p1, u) → Vec2
cubicLengthTable(p0, c1, c2, p1) → Float64Array(65)
segmentLength(p0, edge, p1) → mm            edgeLength(piece, edgeIndex) → mm
paramAtArcFraction(p0, edge, p1, t) → u     pointAtArcFraction(p0, edge, p1, t) → Vec2
tangentAtArcFraction(p0, edge, p1, t) → Vec2 (unit)
sampleSegment(p0, edge, p1, n) → Vec2[n+1]  sampleEdge(piece, edgeIndex, n) → Vec2[n+1]
sampleSegmentAt(p0, edge, p1, fractions) → Vec2[]
splitCubic(p0, c1, c2, p1, u) → [[p0,c1a,c2a,m],[m,c1b,c2b,p1]]
splitEdge(piece, edgeIndex, t) → {piece, edgeMap, newVertex}
flattenSegment(p0, edge, p1, tol_mm) → Vec2[]
flattenPiece(piece, tol_mm = 0.5) → {points, edgeStart}
// polygon.js
signedArea(pts), isCCW(pts), ensureCCW(pts), reverseOutline(piece), segmentsIntersect(a, b, c, d), isSimplePolygon(pts),
pointInPolygon(pt, pts), distToSegment(pt, a, b) → {dist, t, point}, distToPolyline(pt, pts, closed) → {dist, seg, t, point},
bbox(pts) → {minX, minY, maxX, maxY}, centroid(pts) → {x, y}, polylineLength(pts, closed), resamplePolyline(pts, closed, spacing_mm),
translatePoints(pts, dx, dy), scalePoints(pts, sx, sy, ox, oy)
// mirror.js
fullOutline(piece) → {vertices, edges, fullEdgeOf[mirror][e], fullEdgeReversed[e], foldX}
mirrorPoint(p, foldX) → Vec2                mirrorPiece(piece) → Piece (non-fold, full outline)
// prng.js
mulberry32(seed) → () => number             jitterSeed(piece) → uint32
// delaunay.js
delaunay(points) → Uint32Array 3T           recoverEdges(points, tris, constraints) → Uint32Array (flips only, no insertion)
buildAdjacency(vertexCount, tris) → {edges, triA, triB, edgeIndex}
// remesh.js
effectiveSpacing(piece, spacingFactor = 1) → mm
seamSampleFractions(piece, edgeIndex, doc, spacingFactor = 1) → number[]   (symmetric on seam partners = parity)
remeshPiece(piece, doc, {spacingFactor?}) → PieceMesh   throws Error{code:'RemeshError', pieceId, reason}
// offset.js
offsetPolygon(stitch, allowance[], {join?:'mitre'|'round', mitreLimit?}) → Vec2[]   (allowance is ALWAYS an array, per segment)
offsetOutline(piece, opts?) → Vec2[]        (half outline for fold pieces; fold edge allowance 0)
// pack.js
packRects(items{id,w,h}[], sheetWidth, {gap?=10, allowRotate?}) → {placements:{id,x,y,rotated}[], width, height}
```
Errors: `RemeshError` (reason `'outline'|'fold'|'internal'`), `GeometryError` (`'Delaunay'|'Constraint'|'Offset'`). Emits/listens: nothing. Element ids: none. `selftest.js`: `runSelfTest()` (15 cases, 5.9; may import `src/samples`).

---

## src/pattern (A2) — `index.js` exports (SPEC 11.9–11.12); DOM = `#canvas-2d` only

```js
createEditor(canvas, store, bus, {autoFit?}) → Editor {
  setTool(name), getTool(), getSelection() /* frozen 3.2 Selection + editor-local edgeMirror/handle/notch */,
  select(partialSelection, {additive?}), clearSelection(), view /* View */, injectPointer(PointerLike), cancel(), confirm(),
  deleteSelection(), nudge(dx_mm, dy_mm), mirror(), addPiece(vertices, partial?) → id, addSeam(a, b, reverse?) → id,
  removeSeam(seamId), getIssues() → Issue[], requestRender(), renderNow(), getTransient(), onHover(cb) → unsub, destroy() }
opTranslate(piece, dx, dy) → Piece
opSplitEdge(piece, e, t) / opInsertVertex(piece, e, t) / opDeleteVertex(piece, i) / opReflectX(piece) / opSetFold(piece, e) / opClearFold(piece) → {piece, map}
makeCcw(vertices, edges) → {vertices, edges}          snapPoint(p, {ctrl?, shift?, anchor?}) → Vec2
createView(canvas, onChange) → View { get(), set({cx?, cy?, pxPerMm?}), worldToScreen(x_mm, y_mm), screenToWorld(px, py),
  zoomBy(factor, px?, py?), panBy(dx_px, dy_px), fit(bbox, margin_px?), fitToPieces(), resize(), destroy() }
HIT_TOL_PX, hitTest(doc, view, px, py, {selection, tool, handlesVisible?}) → Hit|null, flattenCache(piece)
STYLE, hueOf(seamId), seamColor(seamId, warn?), render(ctx, view, doc, ui)
validateDoc(doc) → Issue[], validatePiece(doc, piece), validateSeam(doc, seam), ISSUE_CODES
edgeLengthOf(piece, e), sideEndpoints(doc, side), chooseReverse(doc, a, b), seamEase(doc, seam) → {lenA_mm, lenB_mm, easePct, longer},
seamEaseOf(doc, a, b), formatEase(ease) → 'A 312 mm / B 328 mm - ease 5.1%', formatSeamRow(doc, seam), seamOfEdge(doc, pieceId, edge, mirror?),
seamsOfPiece(doc, pieceId), makeSeam(doc, a, b, reverse?) → Seam, remapAfterEdgeChange(doc, pieceId, map) → removedSeamIds, seamEaseGraded(doc, seam, gradedPieces)
TOOL_NAMES, TOOL_HINTS, runSelfTest()
```
Store: writes only with `store.update(fn, label)` / `store.batch(label)` on pointer-up (labels 11.12.2: `piece:*`, `vertex:*`, `handle:*`, `edge:*`, `notch:*`, `seam:*`, `grainline:*`); writes `store.transient.{tool, selection, hover, seamPick}`. Emits: `selection:changed`, `tool:changed`, `hover:changed`, `seam:preview`, `view2d:changed`, `pattern:issues`, `ui:status`. Listens: `doc:changed` (via `store.subscribe`; repaint; validate unless `drag`; fit on `replace`), `size:active` (graded ghost), `fabric:changed` (fill colour), `ui:layout` (frame). Element ids owned: `canvas-2d`. Error codes: `PATTERN_BAD_TOOL, PATTERN_FOLD_SPLIT, PATTERN_MIN_VERTICES, PATTERN_FOLD_NOT_ON_AXIS, PATTERN_BAD_OUTLINE, SEAM_SAME_EDGE, SEAM_ON_FOLD_EDGE, SEAM_MIRROR_WITHOUT_FOLD, SEAM_EDGE_TAKEN, SEAM_DANGLING`.

---

## src/body (A3) — `index.js` exports (SPEC 6); pure except `mesh.js` (three)

```js
PARAM_DEFS   // [{key, label, min, max, step, unit:'cm'|'deg'|''}] × 20, panel order (real values in the stub)
PARAM_KEYS   // the 20 keys
clampParams(p) → BodyParams        paramsEqual(a, b) → boolean
DEFAULT_PRESET_ID = 'female_m'     BODY_PRESETS /* Record<id, BodyParams>, 9 presets, real values in the stub */
PRESET_LABELS                      listPresets() → {id, label}[]
buildBody(params, {cell? = 0.015 | 0.030 coarse, reuseGeometry?}) → BodyModel   // throws code 'BodyError' only on non-finite
sampleBody(model, x, y, z, outGrad?) → metres
```
`BodyModel = {params, landmarks, anchors{torso, armL, armR, legL, legR, skirt, head}, rings, sdf, geometry{positions, normals, indices}, measured{chest_cm, waist_cm, hips_cm}, buildMs}`; `schema.DEFAULT_BODY_PARAMS` must equal `BODY_PRESETS.female_m`. Emits/listens: nothing. Element ids: none. `selftest.js`: 12 cases (6.9).

---

## src/cloth (A4) — `index.js` exports (SPEC 7.13); pure, metres, NEVER three/DOM/body/geometry

```js
buildCloth({meshes, doc, fabrics: Map<id, FabricResolved>}) → ClothState   // throws code 'ClothBuildError' (reason 'seam-parity' …)
arrange(state, body, doc)          pushOut(state, sdf)
step(state, sdf|null) → SimStats   // exactly one frame, dt 1/60, params.substeps, deterministic, no allocation
drape(state)  reset(state)  phase(state) → 'arranged'|'sewing'|'draping'
setFabricParams(state, pieceIndex, fabric)   setSettings(state, simSettings)   setScale(state, bend, stretch)   setPin(state, v, target)
stats(state) → SimStats   snapshot(state) → {frame, time, pos, vel}   restore(state, snap)
// testfields.js
sphereField(centre, radius, cell)  capsuleField(a, b, r, cell)  floorField(y0, cell, extent)
// fixtures.js
makeHangingSheet({fabric, width_m, height_m, spacing_mm, pinTopCorners, selfCollision}) → ClothState   // row-major, row 0 = top edge
makeSphereDrape({fabric, width_m, spacing_mm, sphereRadius, dropHeight}) → {state, sdf}
makeSeamFixture({fabric, spacing_mm}) → {state}
```
Arrangement (7.4): `ŝ = f̂ × â`, `θ_side` front 0 / left +π/2 / back π / right −π/2; pattern +x = "rightward as seen from outside"; `dy = 0` puts the top of the full outline at `Anchor.origin`. Emits/listens: nothing (wiring turns `nanCount` growth into `sim:nan`). Element ids: none. `selftest.js`: 12 cases (7.13).

---

## src/viewer3d (A5) — `index.js` exports (SPEC 8); three allowed; never store/bus; DOM = `#view-3d` (+ popout.html)

```js
VIEWER_DEFAULTS, DEFAULT_BODY_BOX, createViewer(container, opts?) → Viewer {container, renderer, scene, camera, controls, root, lights, ground,
  contextLost, resize(), render(), frame(box, {targetY?, dir?, margin?}), fit(bodyModel?, {resetDir?}), setBackground(hex), screenshot(), size(), renderInfo(), dispose()}
BODY_SKIN /* = core BODY_LOOK + metalness 0 */, createBodyMesh(opts?) → {object, mesh, wire, landmarks, setBody(model|null), setWireframe, setLandmarksVisible, setOpacity, setVisible, vertexCount, bounds, dispose}
UV_UNIT_MM = 100, topologyFromState(state, fabricsByPiece?) → ClothTopology, accumulateNormals(pos, tris, out, V),
createClothMesh(opts?) → {object, wire, geometry, build(topology), setCloth(state, fabricsByPiece?), updatePositions(pos), setPieceFabric(pieceId, fabric), normalsEvery, setWireframe, setVisible, vertexCount, triangleCount, topology, clear, dispose}
fabricMaterial(fabric), updateMaterial(mat, fabric), materialFor(id), materialCacheSize(), disposeMaterials()
TEXTURE_SIZE = 512, textureKey(texture, color), drawTextureCanvas(kind, color, color2, size?), fabricTexture(texture, color), textureCacheSize(), disposeTextures()
createLoop({tick?, render, onFps?}) → Loop {start, stop, isRunning, renderSuppressed, renderNow, fps, frameCount, lastFrameMs, dispose}   // tick(dtMs, frame)
GIZMO_COLORS, createAnchorsGizmo() → {object, setAnchors(anchors|null), setPlacements(state|null), highlight(name|null), setVisible, dispose}
POPOUT_CHANNEL, POPOUT_URL, POPOUT_HZ, POPOUT_WINDOW_FEATURES, createPopoutBridge({getBody, getTopology, getPositions}) → {sessionId, open() → boolean, isOpen, close, sendBody, sendClothInit, sendPositions(pos, frame, force?), onOpened(fn), onClosed(fn), dispose}
createViewer3D(container, {tick?, viewer?, onFps?}) → Viewer3D {viewer, body, cloth, gizmo, loop, popout, setBody(model|null), setCloth(state|null, fabricsByPiece?), sync(state, force?), setPieceFabric(pieceId, fabric), fit(), render(), screenshot(), setWireframe(on), setLandmarks(on), setGizmo(on), setBodyOpacity(a), stats(), dispose()}
```
Errors: `WebGLUnavailable`, `ViewerBadState`, `ViewerBadBody`. Gizmo frame: `w = cross(front, axis)` (= `ŝ` of 7.4; θ = +π/2 is the model's left, +x). Emits/listens: nothing (the bridge exposes `onOpened/onClosed` callbacks; wiring emits `popout:*`). Element ids owned: `view-3d` (renderer canvas appended inside), `popout-root`, `popout-status` (popout.html). `src/popout/main.js`: entry module, own `new EventBus()`, `window.__popout`. `selftest.js`: 17 cases (8.9).

---

## src/sizing (A6) — `index.js` exports (SPEC 10.1–10.2, 10.7); pure, cm

```js
DEFAULT_MEASUREMENTS, defaultChart(), cloneChart(chart), rowByName(chart, name) → SizeRow|null, sizeIndex(chart, name), baseIndex(chart), sizeNames(chart)
addRow(chart, name, values?, at?), removeRow(chart, name), renameRow(chart, oldName, newName), setValue(chart, name, key, value_cm),
setBaseSize(chart, name), addMeasurement(chart, key, fill_cm), removeMeasurement(chart, key), moveRow(chart, name, toIndex)   // all return a NEW chart
validateChart(chart) → Issue[]
closestSize(body, chart) → {name, index, score, deltas}      // BODY FIRST
rowFromBody(body, chart, name) → SizeRow                     rowToBodyParams(chart, name, body) → BodyParams
gradePieceDetailed(piece, chart, sizeName) → {piece, sx, sy, pivot, step, issues}   gradePiece(piece, chart, sizeName) → Piece
gradeDoc(doc, sizeName) → Piece[]   gradeDocDetailed(doc, sizeName) → {pieces, issues}   gradeScale(piece, chart, sizeName) → {sx, sy}
seamEasePct(pieces, seam) → {lenA, lenB, easePct}   seamEaseDrift(doc, sizeName) → Issue[]
runSelfTest()
```
Errors: `ValidationError` with codes `SIZE_*`, `GRADE_*`. Emits/listens: nothing. Element ids: none.

---

## src/export (A6) — `index.js` exports (SPEC 10.3–10.7); pure except `download.js`

```js
buildPieceGeometry(piece, sizeName, opts?) → PieceGeometry {piece, sizeName, stitch, stitchEdgeOf, allowances, cut, notches, bbox, labelAnchor, area_mm2, labelLines}
layoutSheet(geoms, opts?) → SheetLayout   renderSheet(layout, opts?) → SheetResult {svg, inner, layout}
exportSheet(pieces, sizeName, opts?) → SheetResult   exportSheetSvg(pieces, sizeName, opts?) → string   exportPieceSvg(piece, opts?) → string
exportGradeNestSvg(pieceBySize, baseSize, opts?) → string   SIZE_COLORS   fmt(n)   escapeXml(s)
tileSheet({width_mm, height_mm}, {paper?, orientation?, margin_mm?, overlap_mm?}) → TilePlan   // uses core tileCount: cols = ceil((W − overlap)/stepX)
tileLabel(row, col) → 'A1'   PAPER_SIZES   buildPrintDocument(sheetResult, opts?) → {html, plan}   printHtml(sheetResult, opts?) → string
sizeChartCsv(chart) → 'size,chest_cm,…'   parseSizeChartCsv(text)   sizeChartJson(chart)   csvLine(fields)   fmtCsv(v)
pieceMeasurementsCsv(doc, chart, opts?)   fabricEstimate(pieces, sizeName, opts?) → {length_m, width_mm, area_cm2, items}
downloadBlob(filename, blob)   downloadText(filename, mime, text)   downloadSvg(filename, svg)   slug(s)   projectFilename(doc)
saveProject(doc) → json   parseProjectText(text) → ProjectDoc   readProjectFile(file) → Promise<ProjectDoc>   clothObj(state, {name?}) → string
downloadClothObj(state, filename?) → string   FILENAMES {sheetSvg, pieceSvg, nestSvg, printHtml, sizesCsv, sizesJson, measurementsCsv, clothObj}
// document-level (1:1 onto __app.export); sizeName defaults to doc.ui.activeSize
exportDocSheet(doc, sizeName?, opts?) → SheetResult   exportDocSvg(doc, sizeName?, opts?) → string   exportDocPieceSvg(doc, pieceId, sizeName?, opts?)
exportDocGradeNestSvg(doc, pieceId, opts?)   exportDocPrintHtml(doc, sizeName?, {paper?, orientation?}) → {html, plan}
exportDocSizesCsv(doc)   exportDocSizesJson(doc)   exportDocMeasurementsCsv(doc, opts?)   runSelfTest()
```
SVG: 1 unit = 1 mm, single y flip in `toSheet`; `g.piece[data-piece-id][data-size]`, `path.cut`, `path.stitch`, `path.fold`, `rect.calibration`. Print: `<div class="page" data-tile>` per tile, `@page { size: A4 portrait; margin: 0; }`. Errors: `ValidationError` codes `EXPORT_*`, `PRINT_*`, `CSV_PARSE`, `PROJECT_*`, `NO_DOM`. Emits/listens: nothing. Element ids: none.

---

## src/ui (A7) — `index.js` exports (SPEC 11.3–11.8); owns index.html except `#canvas-2d` / `#view-3d` internals

```js
createLayout(store, bus, root?) → {setSplit(f), getSplit(), setLayout(mode), getLayout(), swap(), isSwapped(), slotOf(pane), setPopout(on), getState(), destroy()}
createToolbar(store, bus, root?) → {setTool(name), setRunning(b), refresh(), destroy()}
createDock(store, bus, root?) → {setTab(name), getTab(), destroy()}
createStatusbar(bus, root?) → {setMessage(text, level?, ttl_ms?), setToolHint(text), setCursor(x_mm|null, y_mm?), setSeamEase(text|null, warn?), setQuality(text|null, level?), setSim(stats|null), getLog(), destroy()}
createShortcuts(bus, root?) → {enable(), disable(), isEnabled(), destroy()}   SHORTCUTS   // Tab never handled; 1/2/3 layouts, F1–F4 dock tabs
createPiecesPanel / createBodyPanel / createFabricPanel / createSizesPanel (store, bus, root?) → {refresh(), destroy()}
REQUIRED_IDS   // the 135 ids of 11.1.1 (kept in src/ui/ids.js)
createUi({store, bus, root?}) → {layout, toolbar, dock, statusbar, shortcuts, panels:{pieces, body, fabric, sizes}, destroy()}
runSelfTest()
```
Store: `store.update(fn, label)` with the 11.12.2 labels (`body:*`, `fabric:*`, `sim:*`, `sizes:*`, `ui:*`, `piece:*`, `seam:*`); the fabric colour/texture/scale sliders and bend/stretch sliders use `store.batch` (input = step, change = commit); the Body panel does NOT write during a drag (emits `body:params:drag`, one `store.update` on release then `body:params:commit`). Emits: `ui:action` (all intents), `ui:layout`, `ui:dock`, `ui:status`, `body:params:drag`, `body:params:commit`. Listens: `doc:changed` (via `store.subscribe`), `selection:changed`, `tool:changed`, `hover:changed`, `seam:preview`, `view2d:changed`, `pattern:issues`, `body:built`, `mesh:built`, `sim:built`, `sim:stats`, `sim:phase`, `sim:nan`, `fabric:changed`, `size:active`, `ui:layout`, `ui:dock`, `ui:status`, `popout:open/close`, `app:ready`. Element ids owned (by file): layout → `app`(data-*), `main`, `pane-left`, `pane-right`, `pane-2d`, `pane-3d`, `resizer`, `msg-3d-popout`; toolbar → every `btn-*`/`tool-*`/`sel-*`/`chk-selfcollision`/`input-file` in `#toolbar` + `btn-popin`; dock → `dock-tabs`, `tab-*`, `panel-*` visibility; statusbar → `status-tool`, `status-msg`, `status-cursor`, `status-seam-ease`, `status-quality`, `status-sim`; panels/pieces → `list-pieces`, `btn-piece-*`, `piece-props`, `piece-fold`, `inp-piece-name`, `num-piece-*`, `sel-piece-fabric`, `chk-piece-*`, `piece-placement`, `sel-placement-*`, `num-placement-*`, `range-placement-wrap(-val)`, `chk-placement-flip`, `piece-grade`, `sel-grade-*`, `edge-props`, `edge-index`, `inp-edge-label`, `edge-labels`, `num-edge-allowance`, `chk-edge-pinned`, `list-seams`, `seam-ease`, `btn-seam-*`, `list-issues`; panels/body → `sel-body-preset`, `body-params` (generated `body-<key>`, `body-<key>-num`), `body-measured`, `body-closest-size`, `btn-body-fit-size`, `body-build-ms`; panels/fabric → `sel-fabric-piece`, `fabric-id`, `sel-fabric-preset`, `input-color`, `sel-texture`, `input-color2`, `range-texture-scale(-val)`, `range-bend-scale(-val)`, `range-stretch-scale(-val)`, `fabric-physics`; panels/sizes → `table-sizes`, `btn-size-*`, `sel-base-size`, `list-size-issues`. `styles/app.css` is A7's; `styles/shell.css` is frozen.

---

## src/app (A8) — SPEC 12

- `main.js`: `APP_VERSION`, `BUILD_INFO`, `boot(opts?) → Promise<BootResult>`; stages `params, store, api, ui, editor, viewer, body, remesh, cloth, arrange, drape, wire`; `viewer3d` (and `body`, via `mesh.js`) are loaded with `await import()` inside their stages; installs `window.__app` before any stage; `?sample=`, `?nosim=1`, `?size=`, `?acceptance=1`.
- `wiring.js`: `createWiring(ctx) → Wiring {start, stop, flush, pending, rebuildAll, remesh, rebuildCloth, arrange, drape, play, pause, reset, buildBody, applyFabric, applySimSettings, setActiveSize, stepFrames, tick(dtMs, frame), computeKeys}`; the only listener of `ui:action`; emits `body:built, mesh:built, sim:built, sim:phase, sim:stats, sim:nan, fabric:changed, size:active, popout:open/close, ui:status`.
- `debugApi.js`: `installDebugApi(ctx, wiring)`, `class ApiError {code, detail}`, `ERROR_CODES`. `window.__app` = `{version, ready, bus, ctx, log(), doc(), update(), undo(), redo(), load(), loadSample(), idle(), save(), pattern{pieces, addPiece, setVertices, addSeam, removeSeam, deletePiece, movePiece, seamEase(id, size?), validate, fit, worldToScreen, screenToWorld, setTool, click, drag, select, selection}, mesh{stats, remesh, get, all}, body{params, setParam, setParams, setPreset, presets, model, modelLive, measured, sdf → {d, n}, landmark}, sim{state, step, play, pause, reset, arrange, drape, stats, phase ('empty'|'arranged'|'sewing'|'draping'|'paused'|'error'), running, setSetting, snapshot, restore, centerOfMass, pin, unpin}, fabric{presets, list, resolved, setPreset, setColor, setTexture, setOverride, setScale, addFabric}, sizes{chart, setActive, active, grade, closest, setCell, addRow, removeRow, fitBody}, export{svg, sheetSvg, printHtml, pageCount, csv, pieceCsv, cutLine, json, obj}, ui{click, setValue, layout, dock, swap, setSplit, state, elements, key}, selftest{list, run}, acceptance{run, list}, viewer{screenshotDataUrl, frame, fps, resize, materialOf}}`.
- `tests/acceptance.js`: `CHECKS`, `runAcceptance(filter?, opts?) → AcceptanceSummary {pass, passed, failed, total, ms, results[{id, name, pass, ms, details}], errors}`; 27 checks of 13.3 (T-shirt = **10 seam records**; `IDS.play = 'btn-play'`, `IDS.pause = 'btn-pause'`).

Phase-0 `window.__app` (until A8 lands): `{version:'phase0', ready: Promise.resolve(true), stubs:true, doc(), store, bus, modules:{geometry, pattern, body, cloth, viewer3d, sizing, exportMod, ui}, core:{…}}`.
