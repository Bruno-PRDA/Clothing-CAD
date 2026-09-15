## 10. Sizing and export (`src/sizing/`, `src/export/`) — agent A6

Both directories are **pure**: no DOM, no `three`, no store, no bus. Every function takes plain data (`ProjectDoc`, `Piece`, `SizeChart`, `BodyParams`, `ClothState`) and returns plain data or strings. The single exception is `src/export/download.js`, which touches `document`/`URL`/`Blob` only inside the four functions that exist for that purpose (10.6) and throws `Error{code:'NO_DOM'}` when `typeof document === 'undefined'`. Wiring (section 12) is the only place that calls these modules in reaction to events; the UI (section 11) wraps returned strings in downloads. **Every exporter returns its string; nothing here ever opens a window or triggers a download by itself**, so automation asserts on strings.

Imports allowed: `sizing -> core, geometry`; `export -> core, geometry, sizing` (section 2). Errors: `throw Object.assign(new Error(message), { name: 'ValidationError', code })`; the codes are listed per function below.

**Consumed from `src/geometry/index.js` (section 5).** The names below are the ones sizing/export call; their semantics are fixed by section 5 — this table only records the subset A6 relies on, so that a mismatch is a contract bug caught in Phase 2, not a silent divergence.

| Function | Used for |
|---|---|
| `edgeLength(piece, i) -> number` mm | edge lengths (CSV, ease %, sample counts) |
| `sampleEdge(piece, i, n) -> Vec2[]` (n+1 points, arc-length uniform, first = `vertices[i]`, last = `vertices[(i+1)%n]`) | stitch polyline, notch positions, ghost outline |
| `offsetPolygon(points, dist, opts) -> Vec2[]` (`points` closed CCW polyline; `dist` a number or one number per segment `points[k] -> points[k+1]`; round joins on convex corners, line intersection on concave, hem square-off at allowance discontinuities, loop removal; `opts.join: 'round'|'miter'`, default `'round'`) | cut line |
| `packRects(items, sheetWidth_mm, gap_mm) -> {placed:{id,x,y,w,h}[], width, height}` (shelf packer, items `{id,w,h}`, no rotation, y down, origin 0,0; an item wider than the sheet is placed alone on its own shelf and `width` grows) | sheet nesting, fabric estimate |
| `signedArea(points) -> number`, `bbox(points) -> {minX,minY,maxX,maxY}` | area, layout |

Unit reminders (section 1): pattern mm, y **up**, CCW outlines; size chart and body cm with `_cm` keys; the SVG writer flips y **exactly once** (10.3 step 5); 3D metres.

### 10.1 `src/sizing/chart.js` — size chart model

All functions are **pure and non-mutating**: they return a new `SizeChart` (rows and row objects copied; `structuredClone`) and never touch the input. The UI applies them inside `store.update(doc => { doc.sizes = addRow(doc.sizes, ...) })` (section 3.3).

```js
export const DEFAULT_MEASUREMENTS = ['chest_cm', 'waist_cm', 'hips_cm', 'height_cm', 'torsoLength_cm', 'armLength_cm'];

/** The app default chart (section 4.4 samples reference it). Row M equals body preset female_m (section 6.1). */
export function defaultChart(): SizeChart
```

`defaultChart()` returns exactly:

| name | chest_cm | waist_cm | hips_cm | height_cm | torsoLength_cm | armLength_cm |
|---|---|---|---|---|---|---|
| S | 84 | 66 | 92 | 160 | 39 | 55 |
| M | 88 | 70 | 96 | 165 | 40 | 56 |
| L | 92 | 74 | 100 | 170 | 41 | 57 |
| XL | 96 | 78 | 104 | 175 | 42 | 58 |

`measurements = DEFAULT_MEASUREMENTS`, `baseSize = 'M'`, rows in the order S, M, L, XL. (S = M − (4,4,4,5,1,1); L = M + (4,4,4,5,1,1); XL = M + (8,8,8,10,2,2).)

```js
export function cloneChart(chart: SizeChart): SizeChart
export function rowByName(chart: SizeChart, name: string): SizeRow | null
export function sizeIndex(chart: SizeChart, name: string): number      // index into chart.rows, -1 when absent
export function baseIndex(chart: SizeChart): number                    // sizeIndex(chart, chart.baseSize)
export function sizeNames(chart: SizeChart): string[]

/**
 * Append (or insert at `at`) a row. `values` maps measurement key -> cm; keys missing from `values` are copied
 * from the base row (so a new size never has holes); keys not in chart.measurements are ignored.
 * Throws ValidationError SIZE_NAME_INVALID (empty after trim, or > 16 chars), SIZE_DUP_NAME.
 */
export function addRow(chart, name: string, values?: Record<string, number>, at?: number): SizeChart

/** Throws SIZE_UNKNOWN (no such row), SIZE_BASE_ROW (cannot remove the base row), SIZE_LAST_ROW (cannot remove the only row). */
export function removeRow(chart, name: string): SizeChart

/** Renames a row; if it is the base row, chart.baseSize follows. Throws SIZE_UNKNOWN, SIZE_NAME_INVALID, SIZE_DUP_NAME (case-sensitive compare, trimmed). */
export function renameRow(chart, oldName: string, newName: string): SizeChart

/** Sets one cell in cm. Throws SIZE_UNKNOWN, SIZE_KEY_UNKNOWN (key not in chart.measurements), SIZE_VALUE_INVALID (not finite or <= 0). Value is rounded to 0.01 cm. */
export function setValue(chart, name: string, key: string, value_cm: number): SizeChart

/** Sets the base row. Throws SIZE_UNKNOWN. (Pieces are drafted for the base; changing it re-bases grading — the UI confirms.) */
export function setBaseSize(chart, name: string): SizeChart

/** Adds a measurement column; every row receives `fill_cm` (the UI passes the current body value). Key must match /^[a-z][A-Za-z]*_cm$/ (SIZE_KEY_INVALID); duplicate -> SIZE_DUP_KEY. */
export function addMeasurement(chart, key: string, fill_cm: number): SizeChart

/** Removes a column and that key from every row. Throws SIZE_KEY_UNKNOWN, SIZE_LAST_KEY (at least one measurement must remain). */
export function removeMeasurement(chart, key: string): SizeChart

/** Moves a row to a new index (clamped). Throws SIZE_UNKNOWN. */
export function moveRow(chart, name: string, toIndex: number): SizeChart
```

**Validation.**

```js
/** Returns Issue[] (section 3.1 Issue); `[]` means valid. Never throws. */
export function validateChart(chart: SizeChart): Issue[]
```

Checks, in this order (all issues are collected, not just the first):

| code | level | condition / message |
|---|---|---|
| `SIZE_EMPTY` | error | `rows.length === 0` or `measurements.length === 0` |
| `SIZE_BASE_MISSING` | error | `rowByName(chart, chart.baseSize) === null` |
| `SIZE_DUP_NAME` | error | two rows share a trimmed name |
| `SIZE_KEY_MISSING` | error | row `r` lacks a key of `measurements`; message `Size ${r.name}: missing ${key}` |
| `SIZE_VALUE_INVALID` | error | a cell is not a finite number `> 0`; message `Size ${r.name}: ${key} must be a positive number` |
| `SIZE_NONMONOTONE` | warn | for some key, `rows[i][key] > rows[i+1][key]` for some `i` (rows are ordered small → large); message `${key} decreases from ${rows[i].name} to ${rows[i+1].name}` (one issue per key) |

**Body ⇄ chart.**

```js
/**
 * 'Closest size' readout (Body panel, section 11). Compares every key of chart.measurements that also exists
 * as a finite number in `body`. score(row) = sum_k ((row[k] - body[k]) / body[k])^2 (relative, unit-free).
 * Returns the row with the smallest score; ties -> lowest index. `deltas[k] = row[k] - body[k]` in cm, rounded to 0.1.
 * Throws SIZE_NO_COMMON_KEYS when no key is shared, SIZE_EMPTY when the chart has no rows.
 */
export function closestSize(body: BodyParams, chart: SizeChart): { name: string, index: number, score: number, deltas: Record<string, number> }

/**
 * 'Size from body': a SizeRow named `name` whose measurement values are copied from `body` (rounded to 0.1 cm).
 * Throws SIZE_KEY_UNKNOWN when a chart measurement has no finite value in `body`. Does NOT add it to the chart
 * (the UI calls addRow(chart, name, row) — addRow ignores `row.name`).
 */
export function rowFromBody(body: BodyParams, chart: SizeChart, name: string): SizeRow

/**
 * 'Fit body to size': a new BodyParams = { ...body, ...(row's measurement keys) } — a plain copy, same keys, same unit (section 1).
 * Non-measurement keys of the row (`name`) are never copied. Throws SIZE_UNKNOWN.
 */
export function rowToBodyParams(chart: SizeChart, name: string, body: BodyParams): BodyParams
```

Example: `closestSize({...female_m, chest_cm: 91, waist_cm: 73, hips_cm: 99, height_cm: 169, torsoLength_cm: 40.8, armLength_cm: 56.8}, defaultChart())` → `{ name: 'L', index: 2, score: 0.000482, deltas: { chest_cm: 1, waist_cm: 1, hips_cm: 1, height_cm: 1, torsoLength_cm: 0.2, armLength_cm: 0.2 } }` (scores: S 0.0259, M 0.0048, L 0.00048, XL 0.0128).

### 10.2 `src/sizing/grading.js` — graded pieces

Grading is deterministic measurement-driven scaling about a pivot, followed by per-vertex grade rules (`Piece.grade`, section 3.1). Graded pieces are ordinary `Piece` objects: they feed the export (10.3–10.5), the 2D view's **ghost outline** when `ui.activeSize !== sizes.baseSize` (section 12 calls `gradeDoc(doc, doc.ui.activeSize)` on every store change that touches `pieces`, `sizes` or `ui.activeSize` and hands the result to the pattern view), and — when the user asks to drape a size — the remesh step together with `rowToBodyParams`. The simulation uses the base-size pieces unless section 12 explicitly requests otherwise; sizing itself never touches the solver.

```js
/**
 * @typedef {Object} GradeResult
 * @property {Piece}  piece    graded deep copy (same id, name, seams unaffected)
 * @property {number} sx       x scale (1 when widthRef is null or unusable)
 * @property {number} sy       y scale
 * @property {Vec2}   pivot    [px, py] in mm (base-size coordinates)
 * @property {number} step     sizeIndex(size) - baseIndex
 * @property {Issue[]} issues  warnings raised while grading this piece
 */
export function gradePieceDetailed(piece: Piece, chart: SizeChart, sizeName: string): GradeResult
export function gradePiece(piece: Piece, chart: SizeChart, sizeName: string): Piece      // = gradePieceDetailed(...).piece
export function gradeDoc(doc: ProjectDoc, sizeName: string): Piece[]                      // every doc.pieces entry, same order (exportHidden pieces included; exporters filter)
export function gradeDocDetailed(doc: ProjectDoc, sizeName: string): { pieces: Piece[], issues: Issue[] }  // issues = per-piece issues + seamEaseDrift(doc, sizeName)
export function gradeScale(piece: Piece, chart: SizeChart, sizeName: string): { sx: number, sy: number } // steps 2–3 only
```

**Algorithm `gradePieceDetailed(piece, chart, sizeName)`** (all coordinates mm, y up):

1. `row = rowByName(chart, sizeName)`, `base = rowByName(chart, chart.baseSize)`. Either missing → throw `ValidationError` `SIZE_UNKNOWN` (`Unknown size "${sizeName}"`) / `SIZE_BASE_MISSING`. `step = sizeIndex(chart, sizeName) - baseIndex(chart)`.
2. `sx`: if `piece.grade.widthRef === null` → 1. Else `b = base[widthRef]`, `r = row[widthRef]`; if both are finite and `> 0` → `sx = r / b`; otherwise `sx = 1` and push Issue `{level:'warn', code:'GRADE_REF_MISSING', pieceId, message:'widthRef chest_cm not in size chart'}`.
3. `sy` identically from `lengthRef`.
4. Pivot from the **base** vertices only (control points excluded): `bb = bbox(piece.vertices)`.
   * `anchorX`: `'left'` → `bb.minX`; `'right'` → `bb.maxX`; `'center'` → `(bb.minX + bb.maxX) / 2`; `'fold'` → `piece.vertices[piece.foldEdge][0]` when `piece.foldEdge !== null`, else fall back to `'center'` (no issue). A fold edge is vertical (both endpoints share x within 0.01 mm — validated by section 5/pattern validate), so scaling about its x leaves it on the fold line.
   * `anchorY`: `'top'` → `bb.maxY`; `'bottom'` → `bb.minY`; `'center'` → midpoint.
5. Affine map `T(p) = [px + (p[0] - px) * sx, py + (p[1] - py) * sy]` applied to: every `vertices[i]`, every `edges[i].c1` / `.c2` (cubic edges only), `grainline.a`, `grainline.b`, every point of every `internalLines[k].points`. `notches` are copied unchanged (**notches keep `t`**, so they stay at the same arc-length fraction of the graded edge). Everything else is deep-copied unchanged: `id`, `name`, `foldEdge`, `edges[i].type/allowance_mm/label` (**allowances are mm constants and never scale**), `seamAllowance_mm`, `fabricId`, `layer`, `cutQty`, `exportHidden`, `simulate`, `pinnedEdges`, `placement`, `grade`, `meshSpacing_mm`.
6. Vertex rules: for each `rule` of `piece.grade.vertexRules`: `d = [step * rule.dx_mm, step * rule.dy_mm]`; if `rule.vertex` is not an integer in `[0, n)` → Issue warn `GRADE_RULE_INDEX` and skip. Else `vertices[rule.vertex] += d`, and the two handles attached to that vertex move with it so cubic shapes are preserved: `edges[rule.vertex].c1 += d` (edge leaving the vertex) and `edges[(rule.vertex - 1 + n) % n].c2 += d` (edge arriving), each only if that edge is cubic. Rules are applied after scaling, in array order; two rules on the same vertex accumulate.
7. Sanity: if `signedArea(graded.vertices) <= 0` (a rule folded the outline) → Issue **error** `GRADE_DEGENERATE` (`Piece ${name} size ${sizeName}: outline collapsed`); the piece is still returned so the ghost shows the problem.
8. When `step === 0` and `sx === sy === 1` the result is a plain deep copy (the base size grades to itself; the function is still total).

Worked example (selftest): square `[[0,0],[100,0],[100,100],[0,100]]`, `foldEdge: 3` (edge from `(0,100)` to `(0,0)`, on `x = 0`), `grade {widthRef:'chest_cm', lengthRef:null, anchorX:'fold', anchorY:'bottom', vertexRules:[]}`, default chart, size L: `sx = 92/88 = 1.045454…`, `sy = 1`, pivot `[0, 0]`, vertices `[[0,0],[104.5455,0],[104.5455,100],[0,100]]`; the fold stays on `x = 0`. With rule `{vertex:1, dx_mm:5, dy_mm:0}`: L → `x1 = 109.5455`, S (`sx = 84/88`, `step = -1`) → `x1 = 95.4545 - 5 = 90.4545`.

**Seam-ease drift check.**

```js
/** Ease of a seam in percent: (longer side / shorter side - 1) * 100, using edgeLength on the given pieces (base or graded). */
export function seamEasePct(pieces: Piece[], seam: Seam): { lenA: number, lenB: number, easePct: number }

/**
 * For every seam: easePct in the base size vs in `sizeName`. |drift| > 3 (percentage points) -> Issue
 * {level:'warn', code:'GRADE_EASE_DRIFT', seamId, pieceId: seam.a.pieceId, message:'Seam s_side_l: ease 0.0% (M) -> 4.5% (L)'}.
 * A seam whose side references a missing piece/edge -> Issue error GRADE_SEAM_REF. Never throws.
 */
export function seamEaseDrift(doc: ProjectDoc, sizeName: string): Issue[]
```

`seamEasePct` uses the *stored* edge (mirror copies have the same length by construction). The Sizes panel (section 11) lists `seamEaseDrift` results for the active size; the status bar shows `A 312 mm / B 328 mm — ease 5.1%` from the same function when a seam is selected. Example: piece A (`widthRef 'chest_cm'`) and piece B (`widthRef null`) share a 100 mm seam edge: base ease 0 %, size L ease 4.5 % → drift 4.5 → warn.

### 10.3 `src/export/svg.js` — 1:1 SVG

**Coordinate convention.** One SVG user unit = 1 mm. The root element is
`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" data-units="mm" data-size="${size}">`.
Sheet space is mm, origin top-left, **y down** (SVG). The only y flip in the whole export pipeline is the placement map (step 5 below); pattern points are never negated anywhere else. Text is written upright in sheet space.

Numbers are written with `fmt(n)`: round to 3 decimals, strip trailing zeros and a trailing dot, `-0` → `0`. Text is XML-escaped (`& < > "`). Stroke widths in mm: cut `0.35` solid black; stitch `0.25` dashed `4 2`; fold edge `0.35` dash-dot `6 2 1 2`; notch `0.35`; grainline `0.35`; internal `fold` dash-dot, `dart` solid `0.25`, `mark` dashed `2 1`; calibration `0.35`; all `fill="none"`, `stroke="#000"` unless stated. Font `font-family="Arial, Helvetica, sans-serif"`, sizes in mm (`font-size="4"` = 4 mm cap-to-descender box).

**Typedefs (local to export, exported for tests):**

```js
/**
 * @typedef {Object} PieceGeometry   everything about one (graded) piece in pattern mm, y up
 * @property {Piece}    piece
 * @property {string}   sizeName
 * @property {Vec2[]}   stitch        closed CCW polyline (each corner once, no duplicated closing point), chord spacing <= 2 mm
 * @property {number[]} stitchEdgeOf  outline edge index of segment stitch[k] -> stitch[k+1]
 * @property {number[]} allowances    per outline edge, mm (fold edge forced 0)
 * @property {Vec2[]}   cut           closed polygon from offsetPolygon(stitch, per-segment allowance)
 * @property {{p:Vec2, q:Vec2, kind:'single'|'double', p2?:Vec2, q2?:Vec2}[]} notches   ticks stitch->cut
 * @property {{minX:number,minY:number,maxX:number,maxY:number}} bbox   of `cut` (label/grainline never enlarge it)
 * @property {Vec2}     labelAnchor   interior point for the label block
 * @property {number}   area_mm2      |signedArea(stitch)| (one stored half for fold pieces)
 * @property {string[]} labelLines    the label block text lines (see step 7)
 */
/**
 * @typedef {Object} SheetLayout
 * @property {number} width_mm
 * @property {number} height_mm
 * @property {string} sizeName
 * @property {string} title
 * @property {{geom:PieceGeometry, x:number, y:number, w:number, h:number}[]} placed   sheet-space rect of each cut bbox
 * @property {number} contentTop_mm   y where the pieces region starts (120 with calibration, 10 without)
 */
/** @typedef {{svg:string, inner:string, layout:SheetLayout}} SheetResult   inner = markup between the root <svg> tags (used by print.js) */
```

```js
/** opts: { spacing_mm = 2, join = 'round', garmentName = '', fabricName = '', date = today 'YYYY-MM-DD' } */
export function buildPieceGeometry(piece: Piece, sizeName: string, opts?): PieceGeometry
export function layoutSheet(geoms: PieceGeometry[], opts?): SheetLayout
export function renderSheet(layout: SheetLayout, opts?): SheetResult
export function exportSheet(pieces: Piece[], sizeName: string, opts?): SheetResult
export function exportSheetSvg(pieces: Piece[], sizeName: string, opts?): string      // exportSheet(...).svg
export function exportPieceSvg(piece: Piece, opts?): string                            // one piece; opts.sizeName default 'M'; sheetWidth_mm = null (fit)
export function exportGradeNestSvg(pieceBySize: {sizeName:string, piece:Piece}[], baseSize: string, opts?): string
export const SIZE_COLORS = ['#1f77b4', '#d62728', '#2ca02c', '#ff7f0e', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f'];
export function fmt(n: number): string
export function escapeXml(s: string): string
```

`opts` for `exportSheet` / `exportSheetSvg` / `exportPieceSvg`: `{ sheetWidth_mm = 1000, gap_mm = 20, margin_mm = 10, calibration = true, garmentName = '', fabricNames = {} /* fabricId -> name */, date = today, spacing_mm = 2, join = 'round' }`. `date` is injectable so selftests are deterministic. Pieces with `exportHidden === true` are skipped by `exportSheet`; `exportPieceSvg` exports whatever it is given. An empty piece list → throw `ValidationError` `EXPORT_NO_PIECES`.

**Algorithm `buildPieceGeometry`:**

1. Allowances: `allowances[i] = piece.edges[i].allowance_mm ?? piece.seamAllowance_mm`; `allowances[piece.foldEdge] = 0`. Negative or non-finite → treated as 0 with no error (validation lives in the pattern module).
2. Stitch polyline: for each edge `i`, `n_i = max(1, ceil(edgeLength(piece, i) / spacing_mm))`, `pts = sampleEdge(piece, i, n_i)`; append `pts[0 .. n_i - 1]` (drop the last point — it is the next edge's first) and push `i` into `stitchEdgeOf` for each appended point. Result: closed CCW polyline with corners exactly once. If `signedArea(stitch) <= 0` → throw `ValidationError` `EXPORT_BAD_OUTLINE` (`Piece ${name}: outline is not CCW/simple`).
3. Cut polygon: `cut = offsetPolygon(stitch, stitch.map((_, k) => allowances[stitchEdgeOf[k]]), { join })`. Along the fold edge the cut line coincides with the stitch line; the adjacent hem/shoulder allowances square off against the fold line (section 5 hem square-off), so the cut polygon of a fold piece never crosses the fold.
4. Notches: for `{edge, t, kind}`: `p = edgePointAt(piece, edge, t)` where `edgePointAt` linearly interpolates `sampleEdge(piece, edge, 64)` at arc-length fraction `t` and also returns the unit tangent `d`. Outward normal `nrm = [d[1], -d[0]]` (section 1; valid because the outline is CCW — step 2 guarantees it). `a = allowances[edge]`; tick `q = p + nrm * a` when `a > 0` (the tick spans stitch → cut line and is perpendicular to both, the cut line being the parallel offset of this edge); when `a === 0`, `q = p - nrm * 5` (5 mm into the piece). `'double'`: a second tick at `p2 = p + d * 2`, `q2 = q + d * 2` and the first moved to `p - d * 2`, `q - d * 2` (two ticks 4 mm apart).
5. (placement map, done in `renderSheet`): `toSheet(P, place, geom) = [place.x + (P[0] - geom.bbox.minX), place.y + (geom.bbox.maxY - P[1])]`. This is the single y flip; it is affine, so cubic control points map with the same function.
6. `bbox = bbox(cut)`; `area_mm2 = signedArea(stitch)`.
7. Label block lines (`labelLines`):
   1. `piece.name` (rendered `font-size 6`, `font-weight bold`)
   2. `opts.garmentName` (omitted when empty)
   3. `SIZE ${sizeName}`
   4. `CUT ${piece.cutQty}` + (`piece.foldEdge !== null` ? ` ON FOLD` : ``) — e.g. `CUT 1 ON FOLD`, `CUT 2`
   5. fabric name: `opts.fabricNames[piece.fabricId] ?? piece.fabricId`
   6. allowance summary: let `mode` = the most frequent value among `allowances` of non-fold edges (ties → the larger value). If all equal: `SA ${mode} mm`. Else `SA ${mode} mm; ` followed by, for each other distinct value in descending order, `${labels} ${value}` where `labels` = the edges' `label`s (or `e${i}` when unlabeled) joined by `/` — e.g. `SA 10 mm; hem 25; neck 6`.
   7. `opts.date`
   Label anchor: intersect the horizontal line `y = (bbox.minY + bbox.maxY) / 2` with the stitch polygon, sort the crossing x values, take the widest consecutive pair, anchor = its midpoint; no crossings → bbox centre. Lines are rendered `text-anchor="middle"`, `font-size 4`, 5 mm line pitch, the block vertically centred on the anchor. Text may overflow a narrow piece; that is accepted.

**Algorithm `layoutSheet(geoms, opts)`:**

1. `margin = opts.margin_mm` (10). Header band: when `opts.calibration` the 100 × 100 mm calibration square sits at sheet `(10, 10)` and the title block to its right; `contentTop = 120`. Without calibration `contentTop = 10`.
2. Items `{id: geom.piece.id + '@' + sizeName, w: bbox.maxX - bbox.minX, h: bbox.maxY - bbox.minY}`; `packRects(items, sheetWidth - 2 * margin, opts.gap_mm)`. `opts.sheetWidth_mm === null` (per-piece export) → pack width = `max(item widths)` so the sheet fits the content.
3. `placed[k] = {geom, x: margin + placed.x, y: contentTop + placed.y, w, h}`; `width_mm = max(opts.sheetWidth_mm ?? 0, pack.width + 2 * margin, 10 + 100 + 10 + 150 /* header min */)`; `height_mm = contentTop + pack.height + margin`. Pieces are never rotated (grainline is respected).
4. `title = ${garmentName || 'Pattern'} — size ${sizeName}`.

**Algorithm `renderSheet(layout, opts)`** — emits, in this order:

1. `<g class="calibration">` (when enabled): `<rect class="calibration" x="10" y="10" width="100" height="100"/>` and `<text x="60" y="65" text-anchor="middle" font-size="6">100 mm</text>`.
2. `<g class="title">` at `x = 120, y = 20`: garment name (font 8), `Size ${sizeName} — ${n} pieces — sheet ${W} × ${H} mm`, `Print at 100% (scale 1:1, no fit-to-page); check the 100 mm square`, `date` (font 4, 6 mm pitch). The title is also `<title>` of the root svg.
3. For each placed piece, `<g class="piece" data-piece-id="${id}" data-size="${sizeName}" transform="translate(0 0)">` containing, in order:
   * `<path class="cut" d="M x y L … Z"/>` from `cut`;
   * `<path class="stitch" d="…"/>` — the **exact** outline: `M v0`, then per edge `L v` or `C c1 c2 v`, `Z`, using `piece.vertices` / control points mapped with `toSheet`;
   * `<path class="fold" d="M a L b"/>` on the fold edge (when `foldEdge !== null`) plus `<text class="fold-label" font-size="4" text-anchor="middle" transform="translate(mx my) rotate(angle)">PLACE ON FOLD</text>` where `(mx, my)` is the fold edge midpoint shifted 4 mm into the piece (opposite the outward normal) and `angle = atan2(dy, dx)` of the edge direction in sheet space, normalised to `(-90, 90]` so the text is never upside down;
   * `<g class="notches">` with one `<path d="M p L q"/>` per tick;
   * `<path class="grainline" d="…"/>`: line `a → b` plus open arrowheads at **both** ends (two 5 mm strokes at ±30° from the line direction);
   * `<g class="internal">` with one `<path class="internal-${kind}">` per internal line (`M … L …`, not closed);
   * `<g class="label">` with the `labelLines` as `<text>` elements (first line bold 6 mm).
4. Root: `<svg …><title>…</title>` + `inner` + `</svg>`. `inner` is everything between the root tags (used verbatim by print.js). Ids are **not** used inside `inner` (classes only), so it can be embedded several times.

**Grade nest.** `exportGradeNestSvg(pieceBySize, baseSize, opts)`: every entry is `buildPieceGeometry(piece, sizeName)`; all sizes are drawn in the **same** pattern frame (grading scales about a pivot that is invariant, so no alignment step is needed); `bbox` = union of all cut bboxes; one `<g class="size" data-size="…" stroke="${SIZE_COLORS[i % 8]}">` per size (index = position in `pieceBySize`) holding its `cut` (solid) and `stitch` (dashed) paths and notches; the base size uses stroke width 0.5, others 0.35; a legend at the top-left lists `size — colour`; the piece name and `opts.garmentName` are the title. Calibration square and margins as in a sheet. Section 12's `__app.export` builds `pieceBySize` from `gradePiece(piece, chart, name)` over `sizeNames(chart)`.

### 10.4 `src/export/sheet.js` and `src/export/print.js` — tiled print pages

**`sheet.js` (pure tiling math).** Paper sizes come from `PAPER` in `src/core/units.js` (section 3): A4 210 × 297, Letter 215.9 × 279.4, A3 297 × 420 mm, portrait. `orientation: 'landscape'` swaps width and height.

```js
/**
 * @typedef {Object} TilePlan
 * @property {'A4'|'Letter'|'A3'} paper
 * @property {'portrait'|'landscape'} orientation
 * @property {number} paperW_mm, paperH_mm
 * @property {number} margin_mm        default 10
 * @property {number} overlap_mm       default 10
 * @property {number} printableW_mm    paperW - 2*margin
 * @property {number} printableH_mm    paperH - 2*margin
 * @property {number} stepX_mm         printableW - overlap
 * @property {number} stepY_mm         printableH - overlap
 * @property {number} cols, rows
 * @property {{row:number, col:number, label:string, x0:number, y0:number, w:number, h:number, index:number}[]} tiles  row-major
 */
export function tileSheet(sheet: {width_mm:number, height_mm:number}, opts?: {paper?, orientation?, margin_mm?, overlap_mm?}): TilePlan
export function tileLabel(row: number, col: number): string     // 'A1' = row 0 col 0; rows A..Z, AA..; cols 1..
export const PAPER_SIZES = ['A4', 'Letter', 'A3'];
```

Formulas: `printableW = paperW - 2·margin`, `printableH = paperH - 2·margin`, `stepX = printableW - overlap`, `stepY = printableH - overlap`, `cols = max(1, ceil(width_mm / stepX))`, `rows = max(1, ceil(height_mm / stepY))`, tile `(r, c)`: `x0 = c·stepX`, `y0 = r·stepY`, `w = printableW`, `h = printableH` (sheet mm). Consecutive tiles overlap by exactly `overlap_mm`; `cols` tiles cover `cols·stepX + overlap ≥ width_mm`. Unknown paper → `ValidationError` `PRINT_PAPER_UNKNOWN`; `cols·rows > 400` → `PRINT_TOO_MANY_PAGES`; `margin_mm` must be in `[0, 25]` and `overlap_mm` in `[0, 30]` (`PRINT_OPTS_INVALID`).

| paper | printable | step | 500 × 700 mm sheet → tiles |
|---|---|---|---|
| A4 | 190 × 277 | 180 × 267 | `ceil(500/180) × ceil(700/267)` = 3 × 3 = **9** |
| Letter | 195.9 × 259.4 | 185.9 × 249.4 | 3 × 3 = 9 |
| A3 | 277 × 400 | 267 × 390 | 2 × 2 = 4 |

**`print.js`.**

```js
/**
 * Builds a complete self-contained HTML document (string) with one printable page per tile.
 * opts: { paper='A4', orientation='portrait', margin_mm=10, overlap_mm=10, garmentName='', calibration=true }
 * Returns { html, plan }.
 */
export function buildPrintDocument(sheet: SheetResult, opts?): { html: string, plan: TilePlan }
export function printHtml(sheet: SheetResult, opts?): string        // buildPrintDocument(...).html
```

Document structure (exact strings matter for automation):

```html
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title} — ${paper} tiles</title>
<style>
@page { size: A4 portrait; margin: 0; }
html, body { margin: 0; padding: 0; }
.page { position: relative; width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; break-after: page; }
.page:last-child { page-break-after: auto; break-after: auto; }
.page > svg { position: absolute; left: 10mm; top: 10mm; width: 190mm; height: 277mm; }
@media screen { body { background: #777; } .page { background: #fff; margin: 8px auto; box-shadow: 0 0 6px rgba(0,0,0,.5); } }
</style></head><body>
<div class="page" data-tile="A1" data-row="0" data-col="0" data-index="0">
  <svg xmlns="http://www.w3.org/2000/svg" width="190mm" height="277mm" viewBox="0 0 190 277" data-units="mm">
    <g class="sheet" transform="translate(-x0 -y0)">${inner}</g>
    …overlays…
  </svg>
</div>
…
</body></html>
```

`size:` in `@page` is `${paper} ${orientation}` (`Letter` → `letter`); `.page` width/height and the svg `left/top/width/height` are the paper / margin / printable numbers of the plan. Every page's svg has `viewBox="0 0 printableW printableH"` (tile-local mm) and the whole sheet markup translated by `(-x0, -y0)`; content outside is clipped by the viewport. Overlays, drawn after the sheet content in tile-local coordinates, per tile:

1. **Crop marks** `<g class="crop">`: four L-shaped marks, 5 mm legs, stroke 0.2, at the four printable corners.
2. **Glue strips** `<g class="glue">`: for `col > 0` a `<rect x="0" y="0" width="${overlap}" height="${h}" fill="#000" fill-opacity="0.06"/>` plus a dashed trim line at `x = overlap` (`stroke-dasharray="3 2"`, stroke 0.2); for `row > 0` the same across the top. The strip repeats the neighbouring tile's last 10 mm: cut the previous tile on its right/bottom edge and glue it onto the shaded strip up to the dashed line.
3. **Calibration square** on **every** tile: `<rect class="calibration" x="12" y="${h - 112}" width="100" height="100" fill="none" stroke="#888" stroke-width="0.35"/>` + `<text x="62" y="${h - 60}" text-anchor="middle" font-size="5" fill="#888">100 mm</text>` (bottom-left of the tile, grey so it is not mistaken for a cut line).
4. **Tile header** `<text class="tile-header" x="${overlap + 2}" y="${overlap + 5}" font-size="3.5">`: `Print at 100% — no fit-to-page — Tile ${label} (${index+1}/${count}) — ${title} — ${paper} ${cols}×${rows}` and a second line `Row ${row+1}/${rows}, column ${col+1}/${cols}. Align on the dashed lines; check the 100 mm square.`
5. **Neighbour hints** (small arrows with the label of the tile to the right / below), font 3.

Page count = `plan.tiles.length` = number of `<div class="page"` occurrences. The document has no `<script>`. The UI (section 11) opens it **only on a user click**: `const w = window.open('', '_blank'); w.document.open(); w.document.write(html); w.document.close();` — then the user prints with Chromium's *Save as PDF* at 100 %. Automation never opens it; the acceptance suite (section 13) parses the string (page count, `Print at 100%`, `rect.calibration` per page). `download.js` can alternatively save the HTML file.

### 10.5 `src/export/csv.js` — size chart and piece measurements

CSV rules (`csvLine(fields)`): fields joined by `,`; a field containing `,`, `"`, `\r` or `\n` is wrapped in double quotes with inner quotes doubled; lines joined by `\n`; **no trailing newline** (so `text.split('\n').length` = row count + 1). Numbers: `fmtCsv(v)` = `Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '')`; unit is in the header, never in the cell.

```js
/** Header 'size,' + chart.measurements joined; one line per row in chart order; values in cm. */
export function sizeChartCsv(chart: SizeChart): string
/** Inverse of sizeChartCsv: baseSize = 'M' when present else the first row. Throws CSV_PARSE (bad header/row length/non-number). */
export function parseSizeChartCsv(text: string): SizeChart
/** JSON.stringify({measurements, baseSize, rows}, null, 2) with row keys ordered name, then chart.measurements. */
export function sizeChartJson(chart: SizeChart): string
export function csvLine(fields: (string|number)[]): string
export function fmtCsv(v: number): string
```

`sizeChartCsv(defaultChart())` is exactly:

```
size,chest_cm,waist_cm,hips_cm,height_cm,torsoLength_cm,armLength_cm
S,84,66,92,160,39,55
M,88,70,96,165,40,56
L,92,74,100,170,41,57
XL,96,78,104,175,42,58
```

**Piece measurements.**

```js
/** opts: { fabricWidth_mm = 1400, gap_mm = 10, spacing_mm = 2 } */
export function pieceMeasurementsCsv(doc: ProjectDoc, chart: SizeChart, opts?): string
export function fabricEstimate(pieces: Piece[], sizeName: string, opts?): { length_m: number, width_mm: number, area_cm2: number, items: number }
```

Header (exact):
`size,piece,cut_qty,on_fold,edge,label,length_mm,allowance_mm,seam,partner,partner_length_mm,ease_pct,area_cm2,fabric_length_m`

For every size (chart row order) → `pieces = gradeDoc(doc, size)` filtered to `exportHidden === false`, in doc order:

1. one line per outline edge `i`: `size, piece.name, cutQty, on_fold (1|0), i, edges[i].label ?? '', length (edgeLength, 1 decimal), allowances[i], seamId|'', partner 'pieceId:edge'|'', partner length|'', ease_pct (seamEasePct, 1 decimal)|'', '', ''` — the seam is the first `doc.seams` entry whose `a` or `b` is `{pieceId, edge}` (mirror flag ignored; the mirrored copy has equal length);
2. one summary line per piece: `edge = 'total'`, `length_mm` = perimeter (sum of edge lengths, doubled minus 2×fold-edge length for fold pieces), `area_cm2` = `area_mm2 / 100` of one **cut** piece (fold pieces doubled), other cells empty;
3. one line per size after its pieces: `piece = '*'`, `edge = 'fabric'`, `area_cm2` = Σ area × cutQty, `fabric_length_m` = `fabricEstimate(...).length_m` (2 decimals).

`fabricEstimate`: items are the cut bboxes of `buildPieceGeometry` (`w` doubled for fold pieces because the cut is unfolded), repeated `cutQty` times; `packRects(items, fabricWidth_mm, gap_mm)`; `length_m = pack.height / 1000`. A 2-piece doc with 4 edges each and the default chart yields `1 + 4 × (2 × 5 + 1) = 45` lines.

### 10.6 `src/export/download.js` — browser side, project files, OBJ

```js
export function downloadBlob(filename: string, blob: Blob): void
export function downloadText(filename: string, mime: string, text: string): void   // new Blob([text], {type: mime + ';charset=utf-8'})
export function downloadSvg(filename: string, svg: string): void                    // mime 'image/svg+xml'
export function slug(s: string): string        // lower-case, [a-z0-9]+ runs joined by '-', trimmed; '' -> 'project'
export function projectFilename(doc: ProjectDoc): string                            // `${slug(doc.name)}.clothing.json`
export function saveProject(doc: ProjectDoc): string                                // json = serializeDoc(doc) (section 3, sorted keys); downloads it; returns json
export function parseProjectText(text: string): ProjectDoc                          // JSON.parse -> normalizeDoc -> validateShape
export function readProjectFile(file: File): Promise<ProjectDoc>                    // file.text().then(parseProjectText)
export function clothObj(state: ClothState, opts?: {name?: string}): string
export function downloadClothObj(state: ClothState, filename?: string): string      // returns the OBJ text
export const FILENAMES = {
  sheetSvg: (garment, size) => `${slug(garment)}_${size}_sheet.svg`,
  pieceSvg: (garment, pieceId, size) => `${slug(garment)}_${pieceId}_${size}.svg`,
  nestSvg: (garment, pieceId) => `${slug(garment)}_${pieceId}_nest.svg`,
  printHtml: (garment, size, paper) => `${slug(garment)}_${size}_${paper}_tiles.html`,
  sizesCsv: (garment) => `${slug(garment)}_sizes.csv`,
  sizesJson: (garment) => `${slug(garment)}_sizes.json`,
  measurementsCsv: (garment) => `${slug(garment)}_measurements.csv`,
  clothObj: (garment) => `${slug(garment)}_cloth.obj`,
};
```

`downloadBlob`: `const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);`. When `typeof document === 'undefined'` every download function throws `Error{code:'NO_DOM'}`; nothing else in `src/export/` references `document`, `window`, `Blob` or `URL`.

`parseProjectText`: `JSON.parse` failure → `ValidationError` `PROJECT_JSON` (`Not a JSON file: ${err.message}`); parsed value not a plain object → `PROJECT_SHAPE`; then `normalizeDoc(raw)` (fills defaults) and `validateShape(doc)` (section 3, `core/schema.js`) — any error-level issue, or a throw, → `ValidationError` `PROJECT_INVALID` with the first message; returns the normalised doc. Wiring loads it through the store (section 3.3), which emits the load event (section 3.2). Round trip guarantee: `parseProjectText(saveProject(doc))` deep-equals `normalizeDoc(doc)`, and `serializeDoc` of both is byte-identical (sorted keys).

`clothObj(state)`: text in **metres**, y up:

```
# Clothing App cloth export (metres, y up)
o front
v 0.12345 1.23456 0.05000      ← state.pos[3i..3i+2] for i in [start, start+count), 5 decimals
…
f 1 2 3                        ← state.tris triples whose first vertex lies in this piece's range, 1-based GLOBAL ids (vertex id + 1)
o back
…
```

One `o` block per `state.pieces` entry with `count > 0`, in order; vertex ids are global and consecutive per piece (ClothState layout, section 3.1), so global 1-based face indices are correct across blocks. No normals or UVs. Lines end with `\n`; the text ends with `\n`.

### 10.7 `index.js` exports, wiring contract and self-tests

**`src/sizing/index.js`** re-exports every name of 10.1 and 10.2 plus `runSelfTest` from `selftest.js`:
`DEFAULT_MEASUREMENTS, defaultChart, cloneChart, rowByName, sizeIndex, baseIndex, sizeNames, addRow, removeRow, renameRow, setValue, setBaseSize, addMeasurement, removeMeasurement, moveRow, validateChart, closestSize, rowFromBody, rowToBodyParams, gradePieceDetailed, gradePiece, gradeDoc, gradeDocDetailed, gradeScale, seamEasePct, seamEaseDrift, runSelfTest`.

**`src/export/index.js`** re-exports every name of 10.3–10.6 (`buildPieceGeometry, layoutSheet, renderSheet, exportSheet, exportSheetSvg, exportPieceSvg, exportGradeNestSvg, SIZE_COLORS, fmt, escapeXml, tileSheet, tileLabel, PAPER_SIZES, buildPrintDocument, printHtml, sizeChartCsv, parseSizeChartCsv, sizeChartJson, csvLine, fmtCsv, pieceMeasurementsCsv, fabricEstimate, downloadBlob, downloadText, downloadSvg, slug, projectFilename, saveProject, parseProjectText, readProjectFile, clothObj, downloadClothObj, FILENAMES, runSelfTest`) and adds the document-level conveniences that section 12 maps 1:1 onto `__app.export`:

```js
/** fabricNames from doc.fabrics ({id -> name}); garmentName = doc.name; pieces = gradeDoc(doc, sizeName) minus exportHidden. */
export function exportDocSheet(doc: ProjectDoc, sizeName: string, opts?): SheetResult
export function exportDocSvg(doc: ProjectDoc, sizeName: string, opts?): string                       // exportDocSheet(...).svg
export function exportDocPieceSvg(doc: ProjectDoc, pieceId: string, sizeName: string, opts?): string // throws EXPORT_PIECE_UNKNOWN
export function exportDocGradeNestSvg(doc: ProjectDoc, pieceId: string, opts?): string               // all sizes of doc.sizes
export function exportDocPrintHtml(doc: ProjectDoc, sizeName: string, opts?): { html: string, plan: TilePlan }   // exportDocSheet + buildPrintDocument
export function exportDocSizesCsv(doc: ProjectDoc): string          // sizeChartCsv(doc.sizes)
export function exportDocSizesJson(doc: ProjectDoc): string
export function exportDocMeasurementsCsv(doc: ProjectDoc, opts?): string
```

`sizeName` defaults to `doc.ui.activeSize` when omitted; an unknown size throws `SIZE_UNKNOWN`. UI actions (section 11 buttons) → calls → filenames: *Export SVG sheet* → `exportDocSvg` → `FILENAMES.sheetSvg`; *Export selected piece SVG* → `exportDocPieceSvg` (selected piece, or the first piece when nothing is selected); *Grade nest* → `exportDocGradeNestSvg`; *Print tiles* → `exportDocPrintHtml` then `window.open` on the click (10.4); *Sizes CSV / JSON* → `exportDocSizesCsv/Json`; *Measurements CSV* → `exportDocMeasurementsCsv`; *Save project* → `saveProject`; *Open project* → `<input type="file">` → `readProjectFile` → store load; *Export OBJ* → `downloadClothObj(state)` with the live `ClothState` (section 7).

**Self-tests.** `runSelfTest(): SelfTestResult[]` (section 3.1; synchronous; every check is one entry `{name, pass, details}`; a thrown exception inside a check becomes a failed entry, never an uncaught error). Section 12 exposes both under `window.__app` and the acceptance suite (section 13) requires every entry `pass === true`. Fixtures are built inline (no DOM): `SQ` = the 100 × 100 square above with `seamAllowance_mm: 10`, all edges `'line'`, `foldEdge: null`, one notch `{edge: 1, t: 0.5, kind: 'single'}`, grainline `{a:[50,20], b:[50,80]}`, `grade {widthRef:'chest_cm', lengthRef:null, anchorX:'fold', anchorY:'bottom', vertexRules:[]}`; `SQF` = same with `foldEdge: 3`; `CUB` = `SQ` with edge 2 cubic (`c1:[80,120]`, `c2:[20,120]`); `DOC2` = a `ProjectDoc` (through `normalizeDoc`) with pieces `A` (`SQ`, `widthRef 'chest_cm'`) and `B` (`SQ` translated by `[200,0]`, `widthRef null`), one seam `A.edge1 ↔ B.edge3`, `sizes = defaultChart()`, `ui.activeSize 'M'`, one fabric `main`.

`src/sizing/selftest.js` must check:

1. `validateChart(defaultChart())` → `[]`; 4 rows; `baseSize 'M'`; `sizeIndex('L') === 2`; `baseIndex === 1`.
2. `addRow(chart,'XXL',{chest_cm:100})` → 5 rows, `XXL.waist_cm === 70` (copied from base); `removeRow(chart,'M')` throws `SIZE_BASE_ROW`; `renameRow(chart,'M','Medium').baseSize === 'Medium'`; `setValue(chart,'S','chest_cm',-1)` throws `SIZE_VALUE_INVALID`; `setValue(chart,'S','foo_cm',1)` throws `SIZE_KEY_UNKNOWN`; inputs are unchanged after each call (non-mutating).
3. `validateChart(setValue(chart,'S','chest_cm',95))` contains one `SIZE_NONMONOTONE` warn and no errors.
4. `closestSize(female_m, chart).name === 'M'` with all deltas 0; the 10.1 example returns `'L'`.
5. `rowFromBody(female_m, chart, 'M')` deep-equals row M; `rowToBodyParams(chart,'L', female_m).chest_cm === 92` and `.neck_cm === 34` (untouched).
6. `gradePiece(SQF, chart, 'L')` vertices equal `[[0,0],[104.5455,0],[104.5455,100],[0,100]]` within 1e-6; fold vertices stay at `x = 0`; `gradeScale(...)` → `sx = 92/88, sy = 1`.
7. With `vertexRules:[{vertex:1,dx_mm:5,dy_mm:0}]`: L → `x1 = 109.5455`, S → `90.4545`; M → deep-equal to the input.
8. `gradePiece(CUB, chart, 'L')` scales `c1`/`c2` x by `92/88`; notches unchanged (`t === 0.5`); grainline `a[0] === 50·92/88`; `edges[i].allowance_mm` and `seamAllowance_mm` unchanged.
9. `gradePiece(SQ, {...chart, rows: rows without chest_cm ... })` → `sx = 1` and one `GRADE_REF_MISSING` issue (via `gradePieceDetailed`); unknown size throws `SIZE_UNKNOWN`.
10. `seamEaseDrift(DOC2, 'M')` → `[]`; `seamEaseDrift(DOC2, 'L')` → one `GRADE_EASE_DRIFT` warn (4.5 pp); `gradeDoc(DOC2,'L').length === 2`.

`src/export/selftest.js` must check:

1. `buildPieceGeometry(SQ, 'M')`: `bbox(cut)` is `120 × 120` (`minX = -10, maxX = 110`, ±0.05); `area_mm2 === 10000`; `stitch.length === 200` (4 edges × 50 samples at 2 mm); one notch with `p = [100, 50]`, `q = [110, 50]` (±1e-6).
2. `exportPieceSvg(SQ, {date:'2026-01-01'})`: starts with `<svg`, has `width="…mm"` and `height="…mm"` whose numbers equal the `viewBox` width/height; contains exactly one `class="cut"`, one `class="stitch"`, one `class="calibration"`, the strings `CUT 1`, `SIZE M`, `SA 10 mm`, `2026-01-01`; no `NaN`; when `globalThis.DOMParser` exists, parsing as `image/svg+xml` yields no `parsererror`.
3. `exportPieceSvg(SQF)`: contains `PLACE ON FOLD`, `CUT 1 ON FOLD`, `class="fold"`; `buildPieceGeometry(SQF).bbox.minX >= -0.5` and `maxX - minX <= 110.5` (zero allowance on the fold).
4. `exportSheet([SQ, {...SQ, id:'b'}], 'M')`: `width="1000mm"`; two `g.piece` occurrences; the two placed rects are disjoint with a gap `>= 20 mm`; `layout.contentTop_mm === 120`; a hidden piece (`exportHidden:true`) is skipped; `exportSheet([], 'M')` throws `EXPORT_NO_PIECES`.
5. `exportGradeNestSvg` over S/M/L/XL of `SQ`: four `class="size"` groups with four distinct `SIZE_COLORS`.
6. `tileSheet({width_mm:500,height_mm:700},{paper:'A4'})`: `cols 3, rows 3, tiles.length 9`, labels `A1 … C3`, `tiles[4]` (B2) has `x0 180, y0 267, w 190, h 277`; Letter → 9; A3 → 4; `tileSheet({width_mm:100,height_mm:100})` → 1 tile; unknown paper throws `PRINT_PAPER_UNKNOWN`.
7. `printHtml(exportSheet([SQ],'M',{sheetWidth_mm:500}), {paper:'A4'})` on a layout forced to 500 × 700 (`layout.height_mm` overridden in the fixture): 9 `class="page"`, 9 `class="calibration"`, contains `@page { size: A4 portrait; margin: 0; }`, `Print at 100%`, `data-tile="C3"`, no `<script`.
8. `sizeChartCsv(defaultChart())` equals the 5-line block in 10.5 byte for byte; `parseSizeChartCsv(sizeChartCsv(chart))` deep-equals `chart`; `JSON.parse(sizeChartJson(chart)).rows.length === 4`; `csvLine(['a,b','c"d'])` → `"a,b","c""d"`.
9. `pieceMeasurementsCsv(DOC2, DOC2.sizes)` has 45 lines; the `A,…,1,…` edge-1 line at size M has `ease_pct 0` and partner `B:3`; at size L `ease_pct 4.5`; every `fabric` line has a positive `fabric_length_m`.
10. `clothObj` on a synthetic state (`V 3`, `pos` = a unit triangle, `tris [0,1,2]`, `pieces [{start:0,count:3,pieceId:'t'}]`) → three `v ` lines, one `f 1 2 3`, one `o t`.
11. `parseProjectText(saveProject-equivalent text)`: `parseProjectText(serializeDoc(DOC2))` deep-equals `normalizeDoc(DOC2)`; `parseProjectText('{')` throws `PROJECT_JSON`; `parseProjectText('[]')` throws `PROJECT_SHAPE`. (`saveProject` itself is not called — it needs a DOM.)
12. `slug('Basic T-shirt!')` → `basic-t-shirt`; `FILENAMES.sheetSvg('Basic T-shirt','M')` → `basic-t-shirt_M_sheet.svg`.

Acceptance hooks (section 13) built on these: sheet SVG parses, `width` ends in `mm`, one `path.stitch` and one `path.cut` per non-hidden piece; graded S front width / M width = 84/88 ± 0.5 %; sizes CSV = 5 lines; A4 tile count = `ceil(W/180)·ceil(H/267)`; project JSON round-trips byte-identical.

**No `types.js` amendment is required** by this section: every field used (`Grading.widthRef/lengthRef/anchorX/anchorY/vertexRules`, `Edge.allowance_mm/label`, `Piece.foldEdge/cutQty/exportHidden`, `SizeChart.measurements/baseSize/rows`, `ClothState.pos/tris/pieces`) exists in section 3.1; the local typedefs `GradeResult`, `PieceGeometry`, `SheetLayout`, `SheetResult`, `TilePlan` live in their own files, not in `core/types.js`.
