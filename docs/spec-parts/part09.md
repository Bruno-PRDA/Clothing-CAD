## 11. App shell, UI, and the 2D pattern editor

This section owns `index.html` and `styles/shell.css` (Lead, Phase 0), `src/ui/` (A7) and `src/pattern/` (A2). The pattern editor *is* the left window, so it is specified here as 11.9–11.12.

**Contracts this section consumes (names must match the owning sections; where a name differs, the owning section's name wins and the semantics written here stay):**

| From | Names used here |
|---|---|
| 3.2 `src/core/events.js` | `EventBus` with `on(name, fn) -> unsubscribe`, `off(name, fn)`, `emit(name, payload)` (synchronous). `EVENT` constants used by this section are listed in 11.12.2 with their payloads. |
| 3.3 `src/core/store.js` | `store.get() -> ProjectDoc` (live object, never mutate outside `update`); `store.update(label, mutator, opts?)` with `mutator(doc)` applied to a working copy, `opts.undoable` default `true`; `store.subscribe(listener) -> unsubscribe` — listener receives `(doc, label)` after every commit, undo, redo and load; `store.undo()`, `store.redo()`, `store.canUndo()`, `store.canRedo()`, `store.load(doc)` (label `'doc:load'`). |
| 3.3 `src/core/schema.js` | `normalizeDoc(doc)` (fills every default of section 3.1). |
| `src/core/ids.js` | `uid(prefix)`, `hashString(s)`. |
| `src/core/fabrics.js` | `FABRIC_PRESETS`, `resolveFabric(instance)`, `TEXTURE_KINDS`, `DEFAULT_TEXTURE`. |
| `src/core/units.js` | `fmtMm`, `fmtCm`, `PAPER`. |
| 5 `src/geometry/index.js` | `edgeLength(piece, edgeIndex) -> mm` and `segmentLength(p0, edge, p1) -> mm`; `sampleEdge(piece, edgeIndex, n) -> Vec2[]` and `sampleSegment(p0, edge, p1, n) -> Vec2[]` (n+1 points, arc-length uniform; the segment forms are for in-progress drags); `pointAtArcFraction(p0, edge, p1, t) -> Vec2`; `paramAtArcFraction(p0, edge, p1, t) -> u` (bezier parameter, `u === t` for lines); `splitCubic(p0, c1, c2, p1, u) -> [[p0,c1a,c2a,m],[m,c1b,c2b,p1]]`; `signedArea(pts)`; `isSimplePolygon(pts)`; `pointInPolygon(pt, pts)`; `distToPolyline(pt, pts, closed) -> {dist, seg, t}`; `bbox(pts) -> {minX,minY,maxX,maxY}`; `flattenPiece(piece, tol_mm) -> {points:Vec2[], edgeStart:number[]}` (closed polyline, `edgeStart[e]` = index of the first point of edge e); `offsetOutline(piece) -> Vec2[]` (cut line, allowance discontinuities and fold edge handled). |
| 6.1 `src/body/index.js` | `BODY_PRESETS` (`Record<string, BodyParams>`, default preset `female_m`), `PARAM_RANGES` (`Record<keyof BodyParams, {min:number, max:number, step:number, label:string}>`), `PARAM_ORDER` (`string[]`, the 20 keys in panel order). |
| 8 `src/sizing/index.js` | `gradePiece(piece, chart, sizeName) -> Piece` (graded copy; base size returns an equal copy). |
| 11.9 `src/pattern/index.js` | everything below. |

All ids in this section are **stable**: automation, `tests/acceptance.js` (13) and `src/app/debugApi.js` address controls by these ids only.

---

### 11.1 `index.html`

Owned by the Lead, written in Phase 0, never renamed. Contains: the import map, the grid skeleton, every static element id, and the module entry `src/app/main.js`. No inline scripts other than the import map, no inline styles.

#### 11.1.1 Skeleton (complete)

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clothing App</title>
<link rel="stylesheet" href="styles/shell.css">
<link rel="stylesheet" href="styles/app.css">
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/"
  }
}
</script>
</head>
<body>
<div id="app" data-layout="split" data-swapped="false" data-popout="false" data-tool="select">

  <header id="toolbar" role="toolbar" aria-label="Main toolbar">
    <div class="tb-group" id="tb-file">
      <button id="btn-new" type="button" title="New project">New</button>
      <button id="btn-open" type="button" title="Open project JSON (Ctrl+O)">Open</button>
      <input id="input-file" type="file" accept=".json,application/json" hidden>
      <button id="btn-save" type="button" title="Save project JSON (Ctrl+S)">Save</button>
      <select id="sel-sample" title="Built-in sample">
        <option value="tshirt" selected>T-shirt</option>
        <option value="skirt">A-line skirt</option>
      </select>
      <button id="btn-load-sample" type="button">Load sample</button>
    </div>
    <div class="tb-group" id="tb-edit">
      <button id="btn-undo" type="button" title="Undo (Ctrl+Z)" disabled>Undo</button>
      <button id="btn-redo" type="button" title="Redo (Ctrl+Y)" disabled>Redo</button>
    </div>
    <div class="tb-group" id="tb-tools" role="radiogroup" aria-label="Pattern tools">
      <button id="tool-select"    type="button" class="tool" data-tool="select"    aria-pressed="true"  title="Select (V)">Select</button>
      <button id="tool-draw"      type="button" class="tool" data-tool="draw"      aria-pressed="false" title="Draw piece (P)">Draw</button>
      <button id="tool-edit"      type="button" class="tool" data-tool="edit"      aria-pressed="false" title="Edit points (E)">Edit</button>
      <button id="tool-split"     type="button" class="tool" data-tool="split"     aria-pressed="false" title="Split edge (X)">Split</button>
      <button id="tool-seam"      type="button" class="tool" data-tool="seam"      aria-pressed="false" title="Seam (S)">Seam</button>
      <button id="tool-notch"     type="button" class="tool" data-tool="notch"     aria-pressed="false" title="Notch (N)">Notch</button>
      <button id="tool-grainline" type="button" class="tool" data-tool="grainline" aria-pressed="false" title="Grainline (G)">Grain</button>
      <button id="tool-measure"   type="button" class="tool" data-tool="measure"   aria-pressed="false" title="Measure (M)">Measure</button>
      <button id="btn-mirror" type="button" title="Set or clear the fold edge (Shift+M)">Fold</button>
      <button id="btn-fit-2d" type="button" title="Fit pieces in view (F)">Fit</button>
    </div>
    <div class="tb-group" id="tb-sim">
      <button id="btn-arrange" type="button" title="Re-arrange pieces on the body">Arrange</button>
      <button id="btn-drape" type="button" title="Arrange + sew + play (D)">Drape</button>
      <button id="btn-play" type="button" title="Play (Space)">Play</button>
      <button id="btn-pause" type="button" title="Pause (Space)" hidden>Pause</button>
      <button id="btn-reset" type="button" title="Reset simulation (R)">Reset</button>
      <label class="tb-check"><input id="chk-selfcollision" type="checkbox" checked> Self-collision</label>
      <button id="btn-frame-3d" type="button" title="Frame the body in 3D (Shift+F)">Frame</button>
    </div>
    <div class="tb-group" id="tb-size">
      <label for="sel-size">Size</label>
      <select id="sel-size" title="Active size (graded export and ghost outline)"></select>
    </div>
    <div class="tb-group" id="tb-view">
      <button id="btn-layout-split" type="button" data-layout="split" aria-pressed="true"  title="Split view (3)">Split</button>
      <button id="btn-layout-2d"    type="button" data-layout="2d"    aria-pressed="false" title="2D only (1)">2D</button>
      <button id="btn-layout-3d"    type="button" data-layout="3d"    aria-pressed="false" title="3D only (2)">3D</button>
      <button id="btn-swap" type="button" title="Swap panes">Swap</button>
      <button id="btn-popout" type="button" title="Open the 3D view in a separate window">Pop-out 3D</button>
    </div>
    <div class="tb-group" id="tb-export">
      <select id="sel-paper" title="Paper for tiled print">
        <option value="A4" selected>A4</option><option value="Letter">Letter</option><option value="A3">A3</option>
      </select>
      <button id="btn-export-svg"   type="button" title="Download 1:1 SVG sheet of the active size">SVG</button>
      <button id="btn-export-print" type="button" title="Open tiled print pages (Ctrl+P → Save as PDF)">Print</button>
      <button id="btn-export-csv"   type="button" title="Download size chart CSV">CSV</button>
      <button id="btn-export-json"  type="button" title="Download size chart JSON">JSON</button>
      <button id="btn-export-obj"   type="button" title="Download the draped garment as OBJ">OBJ</button>
    </div>
  </header>

  <main id="main">
    <section id="pane-left" class="pane" data-slot="left">
      <div id="pane-2d" class="pane-content" data-pane="2d">
        <canvas id="canvas-2d" tabindex="0" aria-label="2D pattern editor"></canvas>
      </div>
    </section>
    <div id="resizer" role="separator" aria-orientation="vertical" aria-valuemin="20" aria-valuemax="80" aria-valuenow="50"
         title="Drag to resize, double-click to reset"></div>
    <section id="pane-right" class="pane" data-slot="right">
      <div id="pane-3d" class="pane-content" data-pane="3d">
        <div id="view-3d" aria-label="3D view"></div>
        <div id="msg-3d-popout" class="pane-msg" hidden>
          The 3D view is open in a separate window. <button id="btn-popin" type="button">Bring back</button>
        </div>
      </div>
    </section>

    <aside id="dock" aria-label="Panels">
      <nav id="dock-tabs" role="tablist">
        <button id="tab-pieces" type="button" role="tab" data-tab="pieces" aria-controls="panel-pieces" aria-selected="true">Pieces</button>
        <button id="tab-body"   type="button" role="tab" data-tab="body"   aria-controls="panel-body"   aria-selected="false">Body</button>
        <button id="tab-fabric" type="button" role="tab" data-tab="fabric" aria-controls="panel-fabric" aria-selected="false">Fabric</button>
        <button id="tab-sizes"  type="button" role="tab" data-tab="sizes"  aria-controls="panel-sizes"  aria-selected="false">Sizes</button>
      </nav>

      <section id="panel-pieces" class="dock-panel" role="tabpanel" data-panel="pieces">
        <h3>Pieces</h3>
        <ul id="list-pieces" class="list"></ul>
        <div class="row">
          <button id="btn-piece-duplicate" type="button" disabled>Duplicate</button>
          <button id="btn-piece-delete" type="button" disabled>Delete</button>
        </div>
        <fieldset id="piece-props" disabled>
          <legend>Piece <span id="piece-fold" data-testid="piece-fold"></span></legend>
          <label>Name <input id="inp-piece-name" type="text"></label>
          <label>Cut qty <input id="num-piece-qty" type="number" min="1" max="8" step="1"></label>
          <label>Layer <input id="num-piece-layer" type="number" min="0" max="4" step="1"></label>
          <label>Mesh spacing (mm) <input id="num-piece-mesh" type="number" min="8" max="40" step="1"></label>
          <label>Seam allowance (mm) <input id="num-piece-allowance" type="number" min="0" max="60" step="0.5"></label>
          <label>Fabric <select id="sel-piece-fabric"></select></label>
          <label><input id="chk-piece-simulate" type="checkbox"> Simulate</label>
          <label><input id="chk-piece-exporthidden" type="checkbox"> Hide in export</label>
        </fieldset>
        <fieldset id="piece-placement" disabled>
          <legend>Placement</legend>
          <label>Anchor
            <select id="sel-placement-anchor">
              <option value="torso">torso</option><option value="armL">armL</option><option value="armR">armR</option>
              <option value="legL">legL</option><option value="legR">legR</option><option value="skirt">skirt</option><option value="head">head</option>
            </select></label>
          <label>Side
            <select id="sel-placement-side">
              <option value="front">front</option><option value="back">back</option><option value="left">left</option><option value="right">right</option>
            </select></label>
          <label>Offset dx (mm) <input id="num-placement-dx" type="number" step="5"></label>
          <label>Offset dy (mm) <input id="num-placement-dy" type="number" step="5"></label>
          <label>Wrap <input id="range-placement-wrap" type="range" min="0" max="1" step="0.05"> <output id="range-placement-wrap-val"></output></label>
          <label><input id="chk-placement-flip" type="checkbox"> Flip</label>
        </fieldset>
        <fieldset id="piece-grade" disabled>
          <legend>Grading</legend>
          <label>Width ref <select id="sel-grade-width"></select></label>
          <label>Length ref <select id="sel-grade-length"></select></label>
          <label>Anchor X
            <select id="sel-grade-anchorx"><option value="fold">fold</option><option value="center">center</option><option value="left">left</option><option value="right">right</option></select></label>
          <label>Anchor Y
            <select id="sel-grade-anchory"><option value="top">top</option><option value="center">center</option><option value="bottom">bottom</option></select></label>
        </fieldset>
        <fieldset id="edge-props" disabled>
          <legend>Edge <span id="edge-index" data-testid="edge-index"></span></legend>
          <label>Label <input id="inp-edge-label" type="text" list="edge-labels"></label>
          <datalist id="edge-labels">
            <option value="hem"><option value="side"><option value="neck"><option value="shoulder"><option value="armhole"><option value="sleeve"><option value="waist">
          </datalist>
          <label>Allowance (mm) <input id="num-edge-allowance" type="number" min="0" max="60" step="0.5" placeholder="piece default"></label>
          <label><input id="chk-edge-pinned" type="checkbox"> Pin to body</label>
        </fieldset>
        <h3>Seams</h3>
        <ul id="list-seams" class="list"></ul>
        <div class="row">
          <span id="seam-ease" data-testid="seam-ease" data-warn="false"></span>
          <button id="btn-seam-flip" type="button" disabled title="Toggle pairing direction (reverse)">Flip</button>
          <button id="btn-seam-delete" type="button" disabled>Delete</button>
        </div>
        <h3>Issues</h3>
        <ul id="list-issues" class="list"></ul>
      </section>

      <section id="panel-body" class="dock-panel" role="tabpanel" data-panel="body" hidden>
        <label>Preset <select id="sel-body-preset"></select></label>
        <div id="body-params"></div>
        <div id="body-measured" data-testid="body-measured"></div>
        <div id="body-closest-size" data-testid="body-closest-size"></div>
        <div class="row">
          <button id="btn-body-fit-size" type="button" title="Copy the active size row into the body parameters">Fit body to active size</button>
          <span id="body-build-ms" data-testid="body-build-ms"></span>
        </div>
      </section>

      <section id="panel-fabric" class="dock-panel" role="tabpanel" data-panel="fabric" hidden>
        <label>Piece <select id="sel-fabric-piece"></select></label>
        <div>Fabric instance: <span id="fabric-id" data-testid="fabric-id"></span></div>
        <label>Preset <select id="sel-fabric-preset"></select></label>
        <label>Colour <input id="input-color" type="color"></label>
        <label>Texture <select id="sel-texture"></select></label>
        <label>Colour 2 <input id="input-color2" type="color"></label>
        <label>Texture scale (mm) <input id="range-texture-scale" type="range" min="2" max="100" step="1"> <output id="range-texture-scale-val"></output></label>
        <h3>Simulation</h3>
        <label>Bend scale <input id="range-bend-scale" type="range" min="-1" max="1" step="0.05"> <output id="range-bend-scale-val"></output></label>
        <label>Stretch scale <input id="range-stretch-scale" type="range" min="-1" max="1" step="0.05"> <output id="range-stretch-scale-val"></output></label>
        <table id="fabric-physics" data-testid="fabric-physics"></table>
      </section>

      <section id="panel-sizes" class="dock-panel" role="tabpanel" data-panel="sizes" hidden>
        <table id="table-sizes"></table>
        <div class="row">
          <button id="btn-size-add" type="button">Add size</button>
          <button id="btn-size-remove" type="button">Remove size</button>
          <label>Base <select id="sel-base-size"></select></label>
          <button id="btn-size-from-body" type="button" title="Create or update the row 'Body' from the current body parameters">Size from body</button>
        </div>
        <ul id="list-size-issues" class="list"></ul>
      </section>
    </aside>
  </main>

  <footer id="statusbar">
    <span id="status-tool" data-testid="status-tool"></span>
    <span id="status-msg" data-level="info"></span>
    <span id="status-cursor"></span>
    <span id="status-seam-ease" data-warn="false"></span>
    <span id="status-quality" data-level="info"></span>
    <span id="status-sim"></span>
  </footer>
</div>
<script type="module" src="src/app/main.js"></script>
</body>
</html>
```

#### 11.1.2 Element id table (complete; every id above)

Types: `button`, `select`, `input:<type>`, `div`/`section`/`span` (containers/readouts), `canvas`, `ul` (list). "Owner" is the module that binds behaviour.

**Root and panes**

| id | type | purpose | owner |
|---|---|---|---|
| `app` | div | root; `data-layout` (`split`/`2d`/`3d`), `data-swapped` (`true`/`false`), `data-popout`, `data-tool` (active tool name) mirror the state for CSS and tests | ui/layout, ui/toolbar |
| `toolbar` | header | grid row 1 | shell |
| `main` | main | grid row 2; `data-solo` = `left`/`right` when one pane is maximised (absent in split) | ui/layout |
| `pane-left`, `pane-right` | section | the two pane **slots** (fixed DOM positions); `data-slot` | ui/layout |
| `resizer` | div | drag handle between the slots; `aria-valuenow` = split % | ui/layout |
| `pane-2d` | div | 2D pane **content** (moved between slots on swap); `data-pane="2d"` | ui/layout |
| `canvas-2d` | canvas | the pattern editor canvas (`tabindex=0`) | pattern/editor |
| `pane-3d` | div | 3D pane content; `data-pane="3d"` | ui/layout |
| `view-3d` | div | container the three.js renderer canvas is appended to | viewer3d |
| `msg-3d-popout` | div | shown while the 3D view is popped out | ui/layout |
| `btn-popin` | button | action `popin` | ui/toolbar |
| `dock` | aside | right dock | shell |
| `dock-tabs` | nav | tab strip | ui/dock |
| `statusbar` | footer | grid row 3 | ui/statusbar |

**Toolbar** (all emit `EVENT.UI_ACTION`, see 11.4)

| id | type | action / purpose |
|---|---|---|
| `btn-new` | button | `{action:'new'}` — replace the document with `normalizeDoc({})` (empty project, default body) |
| `btn-open` | button | clicks `input-file` |
| `input-file` | input:file (hidden) | on `change` reads the file as text and emits `{action:'open', text, filename}` |
| `btn-save` | button | `{action:'save'}` — download `serializeDoc(doc)` as `<doc.name>.json` |
| `btn-undo`, `btn-redo` | button | `{action:'undo'}` / `{action:'redo'}`; `disabled` mirrors `store.canUndo()/canRedo()` |
| `sel-sample` | select | sample id (`tshirt`, `skirt`) |
| `btn-load-sample` | button | `{action:'loadSample', name: sel-sample.value}` |
| `tool-select` … `tool-measure` | button (`.tool`, `data-tool`) | `{action:'tool', tool}`; `aria-pressed="true"` and class `active` on the active one |
| `btn-mirror` | button | `{action:'mirror'}` → `editor.mirror()` (11.10.9) |
| `btn-fit-2d` | button | `{action:'fit2d'}` → `editor.view.fitToPieces()` |
| `btn-arrange` | button | `{action:'arrange'}` |
| `btn-drape` | button | `{action:'drape'}` (arrange + sew + play) |
| `btn-play` | button | `{action:'play'}`; hidden while running |
| `btn-pause` | button | `{action:'pause'}`; hidden while not running |
| `btn-reset` | button | `{action:'reset'}` |
| `chk-selfcollision` | input:checkbox | writes `doc.sim.selfCollision` (label `sim:selfCollision`) |
| `btn-frame-3d` | button | `{action:'frame3d'}` |
| `sel-size` | select | options = `doc.sizes.rows[].name`; writes `doc.ui.activeSize` (label `ui:activeSize`, not undoable) |
| `btn-layout-split`, `btn-layout-2d`, `btn-layout-3d` | button (`data-layout`) | `{action:'layout', mode}`; `aria-pressed` mirrors `doc.ui.layout` |
| `btn-swap` | button | `{action:'swap'}` |
| `btn-popout` | button | `{action:'popout'}` (emitted synchronously inside the click handler so `window.open` keeps user activation) |
| `sel-paper` | select | `A4`/`Letter`/`A3`; read by the export action |
| `btn-export-svg` | button | `{action:'export', kind:'svg'}` |
| `btn-export-print` | button | `{action:'export', kind:'print', paper: sel-paper.value}` |
| `btn-export-csv` | button | `{action:'export', kind:'csv'}` |
| `btn-export-json` | button | `{action:'export', kind:'json'}` (size chart JSON) |
| `btn-export-obj` | button | `{action:'export', kind:'obj'}` |

**Dock tabs and panels** (11.5, 11.8)

| id | type | purpose |
|---|---|---|
| `tab-pieces`, `tab-body`, `tab-fabric`, `tab-sizes` | button role=tab (`data-tab`) | switch panel; `aria-selected` |
| `panel-pieces`, `panel-body`, `panel-fabric`, `panel-sizes` | section role=tabpanel | panel roots; exactly one is not `hidden` |

**Pieces panel**

| id | type | reads | writes (label) |
|---|---|---|---|
| `list-pieces` | ul | `doc.pieces`; rows `<li data-piece-id data-testid="piece-row">` with `class="selected"` on selected pieces; row text: name, `×cutQty`, `FOLD` badge, `⚠n` issue count | click → `{action:'selectPiece', pieceId, additive: shiftKey}` |
| `btn-piece-duplicate` | button | selection | `piece:duplicate` — deep copy, id `uid('piece')`, name `<name> copy`, translated +bbox width + 30 mm in x, seams not copied |
| `btn-piece-delete` | button | selection | `piece:delete` — removes the selected pieces and every seam referencing them |
| `piece-props` | fieldset | `disabled` when no primary piece | — |
| `piece-fold` | span | `"on fold (edge k)"` or empty | — |
| `inp-piece-name` | input:text | `piece.name` | `piece:name` (on `change`) |
| `num-piece-qty` | input:number | `piece.cutQty` | `piece:cutQty` |
| `num-piece-layer` | input:number | `piece.layer` | `piece:layer` |
| `num-piece-mesh` | input:number | `piece.meshSpacing_mm` | `piece:meshSpacing` (clamped 8..40) |
| `num-piece-allowance` | input:number | `piece.seamAllowance_mm` | `piece:allowance` |
| `sel-piece-fabric` | select | options `doc.fabrics[].id` (text = name) | `piece:fabric` |
| `chk-piece-simulate` | input:checkbox | `piece.simulate` | `piece:simulate` |
| `chk-piece-exporthidden` | input:checkbox | `piece.exportHidden` | `piece:exportHidden` |
| `piece-placement` | fieldset | `piece.placement` | — |
| `sel-placement-anchor` | select | `placement.anchor` | `piece:placement` |
| `sel-placement-side` | select | `placement.side` | `piece:placement` |
| `num-placement-dx`, `num-placement-dy` | input:number | `placement.offset_mm[0]`, `[1]` | `piece:placement` |
| `range-placement-wrap` (+ `-val` output) | input:range | `placement.wrap` | `piece:placement` on `change`; `-val` shows the value on `input` |
| `chk-placement-flip` | input:checkbox | `placement.flip` | `piece:placement` |
| `piece-grade` | fieldset | `piece.grade` | — |
| `sel-grade-width`, `sel-grade-length` | select | options: `(none)` = `null` + `doc.sizes.measurements` | `piece:grade` |
| `sel-grade-anchorx`, `sel-grade-anchory` | select | `grade.anchorX/anchorY` | `piece:grade` |
| `edge-props` | fieldset | `disabled` unless `selection.edge !== null` | — |
| `edge-index` | span | `"k of <piece name>  (312.4 mm)"` | — |
| `inp-edge-label` | input:text | `edge.label ?? ''` | `edge:label` (empty string deletes the property) |
| `num-edge-allowance` | input:number | `edge.allowance_mm ?? ''` (placeholder = piece default) | `edge:allowance` (empty deletes the property; forced `0` and disabled on the fold edge) |
| `chk-edge-pinned` | input:checkbox | `piece.pinnedEdges.includes(edge)` | `piece:pinnedEdges` |
| `list-seams` | ul | `doc.seams`; rows `<li data-seam-id data-testid="seam-row">` with a colour swatch (11.9.4 hue), text `Front e1 ↔ Back e3 · 312 / 328 mm · ease 5.1%`, `data-warn="true"` when ease > 8 %; two inline buttons `data-action="flip"`, `data-action="delete"` | row click → `{action:'selectSeam', seamId}`; buttons → `seam:flip` (toggle `b.reverse`), `seam:delete` |
| `seam-ease` | span | readout for the selected seam, format 11.11.1; `data-warn` | — |
| `btn-seam-flip`, `btn-seam-delete` | button | selected seam | `seam:flip`, `seam:delete` |
| `list-issues` | ul | `EVENT.PATTERN_ISSUES`; rows `<li data-testid="issue" data-level data-code data-piece-id>` | row click → `{action:'selectPiece', pieceId}` when the issue has one |

**Body panel** (generated rows; 11.8.2)

| id / pattern | type | purpose |
|---|---|---|
| `sel-body-preset` | select | options = `Object.keys(BODY_PRESETS)` + `custom`; value `doc.body.preset` |
| `body-params` | div | container of one `.param-row[data-param]` per key of `PARAM_ORDER` |
| `body-<param>` (e.g. `body-chest_cm`, `body-bustFullness`, `body-armAbduction_deg`) | input:range | min/max/step from `PARAM_RANGES[param]`; value `doc.body.params[param]` |
| `body-<param>-num` | input:number | same value, typed entry |
| `body-measured` | div | three spans `data-testid="body-measured-chest_cm"`, `…-waist_cm`, `…-hips_cm`, text `chest 88.0 → 88.4 cm` (target → measured from the baked SDF), `data-warn="true"` when `|Δ| > 1.5` |
| `body-closest-size` | div | `closest size: M (Δ 0.0 cm)` |
| `btn-body-fit-size` | button | copies the active size row's keys into `doc.body.params` (label `body:fitSize`) |
| `body-build-ms` | span | `build 212 ms` from `EVENT.BODY_BUILT` |

**Fabric panel** (11.8.3)

| id | type | purpose |
|---|---|---|
| `sel-fabric-piece` | select | which piece's fabric instance is edited; options `doc.pieces[].id` (text = name); defaults to the primary selected piece |
| `fabric-id` | span | id and name of the FabricInstance being edited |
| `sel-fabric-preset` | select | options `FABRIC_PRESETS[].id`; writes `instance.preset` (`fabric:preset`) |
| `input-color` | input:color | `instance.color`; `input` → live preview, `change` → `fabric:color` |
| `sel-texture` | select | options `TEXTURE_KINDS`; writes `instance.texture.kind` (`fabric:texture`) |
| `input-color2` | input:color | `instance.texture.color2` (`fabric:texture`) |
| `range-texture-scale` (+`-val`) | input:range 2..100 mm | `instance.texture.scale_mm` (`fabric:texture`) |
| `range-bend-scale` (+`-val`) | input:range −1..1 | log10 of `doc.sim.bendScale` (0.1..10); `input` → live `EVENT.SIM_SCALE_DRAG`, `change` → `sim:bendScale` |
| `range-stretch-scale` (+`-val`) | input:range −1..1 | log10 of `doc.sim.stretchScale`; `sim:stretchScale` |
| `fabric-physics` | table | read-only rows `density_kgm2, bend_Nm, membrane_Nm, friction, damping, thickness_mm, meshSpacing_mm` of `resolveFabric(instance)`; cells `data-testid="fabric-physics-<key>"` |

**Sizes panel** (11.8.4)

| id | type | purpose |
|---|---|---|
| `table-sizes` | table | `thead`: `<th></th>` + one `<th data-key>` per `doc.sizes.measurements`; `tbody`: one `<tr data-size data-testid="size-row">` per row (`data-base="true"` on the base row, `class="selected"` on the row last clicked), first cell `<input type="text" data-size data-key="name">`, then `<input type="number" step="0.5" data-size="M" data-key="chest_cm" data-testid="size-cell">` per key. `change` on a cell → `sizes:cell`; renaming → `sizes:rename` (also renames `baseSize`/`ui.activeSize` if they pointed at it) |
| `btn-size-add` | button | `sizes:add` — appends a row (11.8.4) |
| `btn-size-remove` | button | `sizes:remove` — removes the selected row; refuses (status warn) for the base row or the last row |
| `sel-base-size` | select | `doc.sizes.baseSize` (`sizes:baseSize`) |
| `btn-size-from-body` | button | `sizes:fromBody` |
| `list-size-issues` | ul | per non-base size, seams whose ease differs from the base ease by more than 3 percentage points (rows `data-testid="size-issue" data-size data-seam-id`) |

**Status bar** (11.6)

| id | purpose |
|---|---|
| `status-tool` | current tool hint, e.g. `Seam: click edge A` |
| `status-msg` | last message; `data-level` = `info`/`warn`/`error` |
| `status-cursor` | cursor position in pattern mm: `x 123.4  y -56.0` (empty when the cursor is outside the canvas) |
| `status-seam-ease` | live seam readout (11.11.1); `data-warn="true"` above 8 % |
| `status-quality` | mesh / solver quality text (`min∠ 24° · 2612 v · 4988 t`, or `reduced quality`); `data-level` |
| `status-sim` | `60 fps · 8.4 ms · 2612 v · f 300` (fps, solver ms avg, vertices, frame) and `paused` |

`data-testid` values are used only where the element is dynamic: `piece-row`, `seam-row`, `issue`, `size-row`, `size-cell`, `size-issue`, `body-measured-<key>`, `fabric-physics-<key>`, plus the ones shown in the skeleton.

---

### 11.2 `styles/shell.css` (frozen geometry + theme tokens)

Only the grid geometry, sizing variables and the dark theme tokens live here. Fonts for widgets, list styling, button looks etc. are in `styles/app.css` (A7) and must not change the rules below.

```css
/* styles/shell.css — FROZEN after Phase 0 (Lead). Grid geometry, pane sizing, theme tokens only. */
:root {
  --toolbar-h: 44px;
  --status-h: 24px;
  --dock-w: 300px;
  --resizer-w: 6px;
  --split: 0.5;            /* fraction of the main area given to the LEFT slot (doc.ui.split); set by layout.js */
  --split-min: 0.2;
  --split-max: 0.8;

  --bg-0: #141518;  --bg-1: #1c1e22;  --bg-2: #25282e;  --bg-3: #2f333a;
  --fg: #e6e6e6;    --fg-dim: #9aa0a6; --border: #3a3f47;
  --accent: #4da3ff; --accent-2: #ff9f43;
  --ok: #3ddc84;    --warn: #ffcc3d;   --err: #ff5c5c;
  --font: system-ui, "Segoe UI", Roboto, sans-serif;
  --mono: Consolas, "Cascadia Mono", "Courier New", monospace;
}
html, body { height: 100%; margin: 0; overflow: hidden; background: var(--bg-0); color: var(--fg); font: 13px/1.3 var(--font); }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }

#app { display: grid; grid-template-rows: var(--toolbar-h) minmax(0, 1fr) var(--status-h); grid-template-columns: 100%; height: 100vh; width: 100vw; }

#toolbar { grid-row: 1; display: flex; align-items: center; gap: 4px; padding: 0 8px; min-width: 0; overflow-x: auto; overflow-y: hidden;
           white-space: nowrap; background: var(--bg-1); border-bottom: 1px solid var(--border); }
.tb-group { display: inline-flex; align-items: center; gap: 2px; padding: 0 6px; border-right: 1px solid var(--border); }
.tb-group:last-child { border-right: none; }

#main { grid-row: 2; display: grid; min-height: 0; min-width: 0;
        grid-template-rows: minmax(0, 1fr);
        grid-template-columns: calc((100% - var(--dock-w) - var(--resizer-w)) * var(--split)) var(--resizer-w) minmax(0, 1fr) var(--dock-w); }
#main[data-solo="left"]  { grid-template-columns: minmax(0, 1fr) 0 0 var(--dock-w); }
#main[data-solo="right"] { grid-template-columns: 0 0 minmax(0, 1fr) var(--dock-w); }
#main[data-solo] #resizer { display: none; }
#main[data-solo="left"]  #pane-right { display: none; }
#main[data-solo="right"] #pane-left  { display: none; }

.pane { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: var(--bg-0); }
.pane-content { position: absolute; inset: 0; }
.pane-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px; background: var(--bg-1); color: var(--fg-dim); }
#canvas-2d { display: block; width: 100%; height: 100%; touch-action: none; outline: none; }
#view-3d { position: absolute; inset: 0; }
#view-3d canvas { display: block; width: 100% !important; height: 100% !important; }

#resizer { cursor: col-resize; background: var(--border); touch-action: none; user-select: none; }
#resizer:hover, #resizer.dragging { background: var(--accent); }
body.resizing { cursor: col-resize; user-select: none; }
body.resizing .pane { pointer-events: none; }

#dock { display: flex; flex-direction: column; min-height: 0; min-width: 0; border-left: 1px solid var(--border); background: var(--bg-1); }
#dock-tabs { display: flex; flex: 0 0 32px; border-bottom: 1px solid var(--border); }
#dock-tabs [role="tab"] { flex: 1 1 0; }
.dock-panel { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 8px; }

#statusbar { grid-row: 3; display: flex; align-items: center; gap: 16px; padding: 0 8px; min-width: 0; overflow: hidden; white-space: nowrap;
             background: var(--bg-1); border-top: 1px solid var(--border); font: 12px/1 var(--mono); color: var(--fg-dim); }
#statusbar > span { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; }
#status-msg { flex: 1 1 auto; color: var(--fg); }
#status-msg[data-level="warn"], #status-quality[data-level="warn"], [data-warn="true"] { color: var(--warn); }
#status-msg[data-level="error"], #status-quality[data-level="error"] { color: var(--err); }
```

Geometry facts other sections rely on: the toolbar is 44 px, the status bar 24 px, the dock 300 px, the resizer 6 px; the left slot width is `(mainWidth − 306) · split` px in split mode; in solo mode the visible pane gets `mainWidth − 300` px.

---

### 11.3 `src/ui/layout.js`

```js
/**
 * @param {Store} store  @param {EventBus} bus  @param {Document|HTMLElement} [root=document]
 * @returns {LayoutController}
 */
export function createLayout(store, bus, root = document)
/**
 * @typedef {Object} LayoutController
 * @property {(f:number)=>void} setSplit        clamps to [0.2, 0.8], applies, commits doc.ui.split (label 'ui:split', undoable:false)
 * @property {()=>number} getSplit
 * @property {(mode:'split'|'2d'|'3d')=>void} setLayout   commits doc.ui.layout (label 'ui:layout', undoable:false) and applies
 * @property {()=>'split'|'2d'|'3d'} getLayout
 * @property {()=>void} swap                    toggles doc.ui.swapped (label 'ui:swap', undoable:false) and applies
 * @property {()=>boolean} isSwapped
 * @property {(pane:'2d'|'3d')=>'left'|'right'} slotOf
 * @property {(on:boolean)=>void} setPopout     true: force the 2D pane solo without touching doc.ui; false: re-apply doc.ui
 * @property {()=>{split:number, layout:string, swapped:boolean, leftWidth:number, rightWidth:number}} getState
 * @property {()=>void} destroy
 */
```

**Applying state** (`apply(doc.ui)`, idempotent, called on creation, on every store notification and after popout changes):

1. `#main.style.setProperty('--split', split)`; `#resizer.aria-valuenow = Math.round(split*100)`.
2. Slots: if `swapped`, `#pane-left` must contain `#pane-3d` and `#pane-right` must contain `#pane-2d`; otherwise the reverse. Move with `slot.appendChild(paneContent)` only when the pane is not already there (DOM moves keep the WebGL context and the 2D context alive). `#app.dataset.swapped = String(swapped)`.
3. `#app.dataset.layout = layout`. `#main.dataset.solo`: removed for `split`; `slotOf('2d')` for `2d`; `slotOf('3d')` for `3d`. While `popout` is on, `solo = slotOf('2d')` regardless of `layout` and `#app.dataset.popout = 'true'`, `#msg-3d-popout.hidden = false`.
4. Toolbar mirrors: handled by toolbar.js on `EVENT.UI_LAYOUT`.
5. Emit `EVENT.UI_LAYOUT {layout, swapped, split, popout}`.

**Resizer drag** (pointer events, pointer capture, `touch-action:none`):

- `pointerdown` on `#resizer` (button 0): `setPointerCapture`, add `dragging` class to the resizer and `resizing` to `body`, remember `mainRect = #main.getBoundingClientRect()`, `avail = mainRect.width − dockW − resizerW` (read `--dock-w`/`--resizer-w` via `getComputedStyle` once at creation, px).
- `pointermove` while captured: `f = clamp((e.clientX − mainRect.left − resizerW/2) / avail, 0.2, 0.8)`; set `--split` and `aria-valuenow` only (no store writes during the drag). The `ResizeObserver` below fires naturally.
- `pointerup`/`pointercancel`: release capture, remove classes, commit `store.update('ui:split', d => { d.ui.split = Math.round(f*1000)/1000; }, {undoable:false})`.
- `dblclick` on `#resizer`: `setSplit(0.5)`.
- Keyboard on the focused resizer: ArrowLeft/ArrowRight move the split by 0.02 (commit).

**ResizeObserver**: one observer on `#pane-2d` and `#pane-3d`. On each entry emit `EVENT.UI_RESIZE {pane:'2d'|'3d', width, height}` (CSS px, `contentRect`) — coalesced to one emit per pane per animation frame. Both the pattern editor (11.9.2) and the viewer also own a `ResizeObserver` on their own containers so they work without the shell; the event exists for wiring/popout logic and tests.

**Store subscription**: on every notification compare `(doc.ui.split, doc.ui.layout, doc.ui.swapped)` with the applied values and re-apply when any differs (this covers `doc:load`, undo/redo and `__app.ui` calls).

**Errors**: if `#pane-left`, `#pane-right`, `#pane-2d`, `#pane-3d` or `#resizer` is missing, throw `Error` with `code = 'UI_MISSING_ELEMENT'` naming the id (Phase 0 skeleton bug; must never happen at runtime).

---

### 11.4 `src/ui/toolbar.js`

```js
/** @returns {{setTool(name:string):void, setRunning(b:boolean):void, refresh():void, destroy():void}} */
export function createToolbar(store, bus, root = document)
```

Rules:

1. Every button click calls `button.blur()` first (so Space/Enter afterwards go to the shortcut layer, 11.7), then emits exactly one `EVENT.UI_ACTION` payload from the table in 11.1.2. The toolbar never calls another module's API; `src/app/wiring.js` dispatches `ui:action`.
2. `input-file`: on `change`, `file.text().then(text => bus.emit(EVENT.UI_ACTION, {action:'open', text, filename:file.name}))`, then `input.value = ''` so the same file can be re-opened.
3. `sel-sample` initial options are static in `index.html`; `refresh()` re-syncs them from `SAMPLES` (`src/samples/index.js`, section 4.4) in case a sample is added.
4. `sel-size`: options rebuilt from `doc.sizes.rows` on every store notification (preserving the selected value); `change` → `store.update('ui:activeSize', d => { d.ui.activeSize = value; }, {undoable:false})`.
5. `chk-selfcollision`: `change` → `store.update('sim:selfCollision', d => { d.sim.selfCollision = checked; })`; value re-read from `doc.sim.selfCollision` on notification.
6. Tool buttons: `setTool(name)` sets `aria-pressed`/`active` and `#app.dataset.tool`; the toolbar listens to `EVENT.TOOL_CHANGED {tool}` (emitted by the editor) and never assumes the click succeeded.
7. `btn-undo`/`btn-redo` `disabled = !store.canUndo()` / `!store.canRedo()` after every notification.
8. Play/Pause: `setRunning(b)` toggles `btn-play.hidden = b`, `btn-pause.hidden = !b`; driven by `EVENT.SIM_STATE {running}`.
9. Layout buttons mirror `EVENT.UI_LAYOUT` (`aria-pressed` on the matching `data-layout`); `btn-swap` gets `aria-pressed = swapped`; `btn-popout.disabled = popout` and `btn-popin` emits `{action:'popin'}`.
10. Export buttons pass `paper: sel-paper.value` on `print`; the SVG/CSV/JSON/OBJ actions pass nothing else (wiring reads `doc.ui.activeSize`).

---

### 11.5 `src/ui/dock.js`

```js
/** @returns {{setTab(name:'pieces'|'body'|'fabric'|'sizes'):void, getTab():string, destroy():void}} */
export function createDock(store, bus, root = document)
```

- Tabs are `#dock-tabs [role=tab][data-tab]`; panels are `#dock .dock-panel[data-panel]`.
- `setTab(name)`: for every tab set `aria-selected = (tab.dataset.tab === name)` and class `active`; for every panel set `panel.hidden = (panel.dataset.panel !== name)`; if `doc.ui.dockTab !== name` commit `store.update('ui:dockTab', d => { d.ui.dockTab = name; }, {undoable:false})`; emit `EVENT.UI_DOCK_TAB {tab:name}`. Unknown names throw `Error` (`code 'UI_BAD_TAB'`).
- Click on a tab → `setTab`; keyboard on a focused tab: ArrowLeft/ArrowRight cycle.
- Store subscription: apply `doc.ui.dockTab` when it differs from the applied tab (load/undo).
- Initial state = `doc.ui.dockTab` (default `pieces`).

---

### 11.6 `src/ui/statusbar.js`

```js
/**
 * @returns {{
 *   setMessage(text:string, level?:'info'|'warn'|'error', ttl_ms?:number):void,
 *   setToolHint(text:string):void,
 *   setCursor(x_mm:number|null, y_mm?:number):void,
 *   setSeamEase(text:string|null, warn?:boolean):void,
 *   setQuality(text:string|null, level?:'info'|'warn'|'error'):void,
 *   setSim(stats:SimStats|null):void,
 *   getLog():{t:number, level:string, text:string}[],
 *   destroy():void }}
 */
export function createStatusbar(bus, root = document)
```

- `setMessage`: writes `#status-msg.textContent` and `data-level`; default `ttl_ms` = 4000 for `info`, 8000 for `warn`, `0` (sticky until the next message) for `error`; after the ttl the text is cleared (timer reset on each call). Every message is appended to a ring buffer of 200 entries (`getLog()`; exposed as `__app.log` by A8). Also `console.warn`/`console.error` for `warn`/`error`.
- Listens: `EVENT.STATUS {text, level, ttl_ms}` → `setMessage`; `EVENT.TOOL_CHANGED` → `setToolHint(TOOL_HINTS[tool])` where `TOOL_HINTS` is exported from `src/pattern/index.js` (11.12.1); `EVENT.PATTERN_CURSOR` → `setCursor`; `EVENT.SEAM_EASE` → `setSeamEase`; `EVENT.QUALITY` → `setQuality`; `EVENT.SIM_STATS` → `setSim`; `EVENT.SIM_STATE` → appends ` · paused` when not running.
- `setSim(stats)`: fps is measured by the status bar itself as `1000 / mean(interval)` over the last 30 `EVENT.SIM_STATS` arrival times (`performance.now()`); text `${fps.toFixed(0)} fps · ${stats.msAvg.toFixed(1)} ms · ${stats.verts} v · f ${stats.frame}`. DOM writes are throttled to 4 Hz (the event arrives every frame); `null` clears.
- `setCursor(x, y)`: `x ${x.toFixed(1)}  y ${y.toFixed(1)}`; `setCursor(null)` clears. Throttled to one write per animation frame.
- `setSeamEase(text, warn)`: text + `data-warn`; `null` clears.

---

### 11.7 `src/ui/shortcuts.js`

```js
/** @returns {{enable():void, disable():void, isEnabled():boolean, destroy():void}} */
export function createShortcuts(bus, root = window)
export const SHORTCUTS  // the table below as [{key, ctrl, shift, action}], for the help tooltip and selftest
```

One `keydown` listener on `window` (bubble phase). Every match emits `EVENT.UI_ACTION` and calls `preventDefault()`; wiring dispatches. Binding table (keys compared on `e.key` case-insensitively for letters, `e.code` for `Space`; `ctrl` means `ctrlKey || metaKey`):

| Key | Modifiers | action payload |
|---|---|---|
| `V` | — | `{action:'tool', tool:'select'}` |
| `P` | — | `{action:'tool', tool:'draw'}` |
| `E` | — | `{action:'tool', tool:'edit'}` |
| `X` | — | `{action:'tool', tool:'split'}` |
| `S` | — | `{action:'tool', tool:'seam'}` |
| `N` | — | `{action:'tool', tool:'notch'}` |
| `G` | — | `{action:'tool', tool:'grainline'}` |
| `M` | — | `{action:'tool', tool:'measure'}` |
| `M` | Shift | `{action:'mirror'}` |
| `Space` | — | `{action:'togglePlay'}` |
| `R` | — | `{action:'reset'}` |
| `D` | — | `{action:'drape'}` |
| `F` | — | `{action:'fit2d'}` |
| `F` | Shift | `{action:'frame3d'}` |
| `Z` | Ctrl | `{action:'undo'}` |
| `Y` | Ctrl, or `Z` Ctrl+Shift | `{action:'redo'}` |
| `S` | Ctrl | `{action:'save'}` |
| `O` | Ctrl | `{action:'open'}` (clicks `#btn-open`) |
| `Delete`, `Backspace` | — | `{action:'delete'}` → `editor.deleteSelection()` |
| `Escape` | — | `{action:'cancel'}` → `editor.cancel()` (also blurs a focused form field) |
| `Enter` | — | `{action:'confirm'}` → `editor.confirm()` |
| `ArrowLeft/Right/Up/Down` | (Shift = ×10) | `{action:'nudge', dx, dy}` in mm (1 or 10) → `editor.nudge(dx, dy)` |
| `1`, `2`, `3` | — | `{action:'layout', mode:'2d'|'3d'|'split'}` |
| `+`/`=`, `-`, `0` | — | `{action:'zoom', factor: 1.25 / 0.8 / 'fit'}` → `editor.view.zoomBy` / `fitToPieces` |
| `F1`…`F4` | — | `{action:'dockTab', tab:'pieces'|'body'|'fabric'|'sizes'}` |

Guards (in this order):

1. **`Tab` is never handled** — no binding, no `preventDefault`, no `stopPropagation` (browser focus navigation and automation must keep working).
2. Ignore when `e.isComposing`, when `e.repeat` for non-arrow keys, or when `disable()` was called (e.g. while a modal print window is being prepared).
3. If `e.target` is an `input`, `textarea`, `select` or `[contenteditable]`: only `Escape` is handled (it calls `e.target.blur()` and emits `cancel`); everything else is left to the field (native undo, typing letters, arrows).
4. If `e.target` is a `button`: `Space` and `Enter` are left to the browser (the toolbar blurs buttons after click, so this only matters for keyboard users).
5. A binding matches only with exactly its modifier set (`Ctrl+V` is not `select`; `Alt+anything` is never handled).

---

### 11.8 `src/ui/panels/*.js`, `src/ui/index.js`, `src/ui/selftest.js`

Every panel factory has the signature `createXPanel(store, bus, root = document) -> {refresh():void, destroy():void}`, subscribes to the store (full re-render of that panel on every notification — panels are small; keep focus: a panel never rebuilds an element that currently has focus, it only updates its value), and listens to `EVENT.SELECTION_CHANGED {selection}` (11.9.1) to know the primary piece / edge / seam. Panels write to the store with the labels in 11.1.2 and never call other modules' APIs directly; intent that needs the editor (`selectPiece`, `selectSeam`) goes through `EVENT.UI_ACTION`.

Common rules: numeric inputs commit on `change` (not on `input`) with the value parsed by `Number()`, clamped to the input's `min`/`max`; `NaN` reverts the field to the stored value. Text inputs commit on `change`. Checkboxes and selects commit on `change`.

#### 11.8.1 `panels/pieces.js`

- Renders `#list-pieces` rows in `doc.pieces` order; `selected` class from `selection.pieceIds`. Row click emits `{action:'selectPiece', pieceId, additive: e.shiftKey}`; double-click focuses `#inp-piece-name`.
- Piece fieldsets show the **primary** piece (`selection.pieceId`); `disabled` when none. Multi-selection: only the primary is edited.
- `piece:placement` writes the whole `placement` object rebuilt from the six controls (one label for all six).
- `piece:grade` likewise rebuilds `grade` keeping `vertexRules` untouched.
- Edge fieldset: shown when `selection.edge !== null`; `chk-edge-pinned` toggles membership in `pinnedEdges` (kept sorted ascending).
- Seam list: rows in `doc.seams` order; `selected` when `selection.seamId` matches; the swatch colour is `hsl(hueOf(seam.id) 70% 55%)` (11.9.4). Row text uses `formatSeamRow(doc, seam)` from `src/pattern/seams.js`.
- Issues list: from the last `EVENT.PATTERN_ISSUES {issues}`; rows show `⛔`/`⚠` + message; `data-code` = `issue.code`.
- `btn-piece-delete`: `store.update('piece:delete', d => { d.pieces = d.pieces.filter(p => !ids.has(p.id)); d.seams = d.seams.filter(s => !ids.has(s.a.pieceId) && !ids.has(s.b.pieceId)); })`.

#### 11.8.2 `panels/body.js`

- On creation builds `#body-params` rows from `PARAM_ORDER`/`PARAM_RANGES`: `<div class="param-row" data-param="<key>"><label for="body-<key>">${label} (${unit})</label><input id="body-<key>" type="range" min max step><input id="body-<key>-num" type="number" min max step></div>`; unit = `cm` for `_cm`, `°` for `_deg`, empty for `bustFullness`.
- `sel-body-preset` options: every key of `BODY_PRESETS` plus `custom`; `change` → `store.update('body:preset', d => { d.body.preset = id; d.body.params = structuredClone(BODY_PRESETS[id]); })` (no-op for `custom`).
- **Drag coalescing** (per slider):
  - `input` (fires continuously while dragging): update the twin number input, update a local `draft = {...doc.body.params, [key]: value}`, and emit `EVENT.BODY_PARAMS_DRAG {params: draft}` **at most once per animation frame** (a pending flag + `requestAnimationFrame`). No store write. Wiring rebuilds the body on a coarse grid (section 6) from this event.
  - `change` (pointer released or number typed): `store.update('body:param', d => { d.body.params[key] = value; d.body.preset = 'custom'; })` — one undo step per gesture. Wiring performs the full-resolution rebuild from the store notification.
  - Number input: `change` → same commit; `input` on the number field does nothing (typing partial numbers must not rebake).
- Store notification: write all 20 values into both inputs (skipping the focused one), set `sel-body-preset`.
- `EVENT.BODY_BUILT {model}`: fill `#body-measured` (`chest`, `waist`, `hips` target `model.params.<k>` vs `model.measured.<k>`, one decimal, `data-warn` when `|Δ| > 1.5`), `#body-build-ms` (`build ${model.buildMs.toFixed(0)} ms`), and `#body-closest-size`: for each row of `doc.sizes.rows`, `Δ = Σ_k |row[k] − params[k]|` over `doc.sizes.measurements` that exist in `params`; text `closest size: ${name} (Δ ${Δ.toFixed(1)} cm)`.
- `btn-body-fit-size`: `store.update('body:fitSize', d => { const row = rowByName(d.sizes, d.ui.activeSize); for (const k of d.sizes.measurements) if (typeof row[k] === 'number' && k in d.body.params) d.body.params[k] = row[k]; d.body.preset = 'custom'; })`.

#### 11.8.3 `panels/fabric.js`

- `sel-fabric-piece` options from `doc.pieces`; when `EVENT.SELECTION_CHANGED` carries a primary piece and the select is not focused, it follows the selection. The edited instance is `doc.fabrics.find(f => f.id === piece.fabricId)`; `#fabric-id` shows `${f.id} — ${f.name}`.
- `sel-fabric-preset`: `change` → `store.update('fabric:preset', d => { inst.preset = id; })` (overrides are kept; colour is kept).
- `input-color`: `input` → `bus.emit(EVENT.FABRIC_PREVIEW, {fabricId, color})` coalesced per animation frame (viewer3d recolours the material in place; the editor repaints fills using the preview via wiring); `change` → `store.update('fabric:color', d => { inst.color = hex; })`.
- `sel-texture` (options `TEXTURE_KINDS`), `input-color2` (`input` preview, `change` commit), `range-texture-scale` (`input` updates `-val` and previews, `change` commits) → all commit with label `fabric:texture` writing the whole `texture` object.
- `range-bend-scale`, `range-stretch-scale`: slider value `v ∈ [−1, 1]` ↔ scale `10^v` (0.1..10); `-val` shows `×${(10**v).toFixed(2)}`; `input` → `EVENT.SIM_SCALE_DRAG {bendScale, stretchScale}` (solver rewrites compliance arrays in place, section 7); `change` → `store.update('sim:bendScale' | 'sim:stretchScale', d => { d.sim.bendScale = 10**v; })` (value rounded to 3 significant digits).
- `#fabric-physics`: rebuilt from `resolveFabric(inst)` on every notification.

#### 11.8.4 `panels/sizes.js`

- Table rebuilt on every notification from `doc.sizes` (11.1.2 markup). Base row `data-base="true"`; the row clicked last has class `selected` (local state, defaults to the base row).
- Cell `change`: `store.update('sizes:cell', d => { rowByName(d.sizes, size)[key] = value; })`. Name cell `change`: `store.update('sizes:rename', d => { row.name = newName; if (d.sizes.baseSize === old) d.sizes.baseSize = newName; if (d.ui.activeSize === old) d.ui.activeSize = newName; })`; an empty or duplicate name is rejected (status warn, field reverted).
- `btn-size-add`: `store.update('sizes:add', ...)` appends a row: name = first of `['XS','S','M','L','XL','XXL','3XL']` not in use, else `size${rows.length+1}`; values = last row + `SIZE_STEP_CM[key]` where `SIZE_STEP_CM = {chest_cm:4, waist_cm:4, hips_cm:4, height_cm:5, torsoLength_cm:1, armLength_cm:1}` and `0` for any other key (matches the default chart's L → XL step). The new row becomes `selected`.
- `btn-size-remove`: refuses when the selected row is the base or the only row (`EVENT.STATUS` warn `Cannot remove the base size`); otherwise `store.update('sizes:remove', ...)`; if `ui.activeSize` pointed at it, `activeSize = baseSize`.
- `sel-base-size` → `store.update('sizes:baseSize', d => { d.sizes.baseSize = name; })`.
- `btn-size-from-body` → `store.update('sizes:fromBody', d => { let row = rowByName(d.sizes, 'Body'); if (!row) d.sizes.rows.push(row = {name:'Body'}); for (const k of d.sizes.measurements) row[k] = d.body.params[k] ?? row[k] ?? 0; })`.
- `#list-size-issues`: for each row `s ≠ baseSize` and each seam: `easeBase = seamEase(doc, seam).easePct`, `easeS = seamEase(gradedDoc, seam).easePct` where `gradedDoc.pieces = doc.pieces.map(p => gradePiece(p, doc.sizes, s))`; list when `|easeS − easeBase| > 3` with text `${s}: ${seamLabel} ease ${easeS.toFixed(1)}% (base ${easeBase.toFixed(1)}%)`. Computed lazily only while the Sizes tab is visible.

#### 11.8.5 `src/ui/index.js` and `src/ui/selftest.js`

```js
// src/ui/index.js
export { createLayout } from './layout.js';  export { createToolbar } from './toolbar.js';
export { createDock } from './dock.js';        export { createStatusbar } from './statusbar.js';
export { createShortcuts, SHORTCUTS } from './shortcuts.js';
export { createPiecesPanel } from './panels/pieces.js'; export { createBodyPanel } from './panels/body.js';
export { createFabricPanel } from './panels/fabric.js'; export { createSizesPanel } from './panels/sizes.js';
export { REQUIRED_IDS } from './ids.js';   // NOTE: ids.js is a data-only helper inside src/ui/ (A7); the string[] of every id in 11.1.2
/** Creates every UI piece in order layout, toolbar, dock, statusbar, panels, shortcuts. */
export function createUi({store, bus, root = document}) -> {layout, toolbar, dock, statusbar, shortcuts, panels:{pieces, body, fabric, sizes}, destroy()}
export { runSelfTest } from './selftest.js';
```

`src/ui/selftest.js` — `export async function runSelfTest() -> SelfTestResult[]` runs **in the live page** (it needs `index.html`), snapshots the document with `serializeDoc`, and restores it with `store.load` at the end. Checks:

1. `ids-present`: every id in `REQUIRED_IDS` resolves with `document.getElementById`.
2. `split`: `layout.setSplit(0.3)` → `#pane-left.getBoundingClientRect().width` equals `0.3 · (mainWidth − 306)` ± 2 px and `store.get().ui.split === 0.3`; `setSplit(0.05)` clamps to 0.2.
3. `swap`: `layout.swap()` → `#pane-left.firstElementChild.id === 'pane-3d'` and `#app.dataset.swapped === 'true'`; swap again restores.
4. `layout-modes`: `setLayout('2d')` → `#main.dataset.solo === slotOf('2d')` and `#pane-3d`'s slot has `display:none`; `setLayout('split')` clears `data-solo`.
5. `dock`: `dock.setTab('body')` → only `#panel-body` is not hidden, `tab-body.aria-selected === 'true'`, `doc.ui.dockTab === 'body'`.
6. `statusbar`: `setMessage('hello', 'warn')` → `#status-msg.textContent === 'hello'`, `data-level === 'warn'`; `getLog()` last entry text `hello`.
7. `shortcut-tool`: dispatching `new KeyboardEvent('keydown', {key:'s', bubbles:true})` on `window` emits `EVENT.UI_ACTION {action:'tool', tool:'seam'}` (captured with a one-shot listener).
8. `shortcut-tab-untouched`: dispatching `keydown` `Tab` yields `defaultPrevented === false` and no `ui:action`.
9. `shortcut-in-input`: with `#inp-piece-name` focused, `keydown 'v'` emits nothing.
10. `body-drag`: set `#body-chest_cm.value = 90`, dispatch `input` → exactly one `EVENT.BODY_PARAMS_DRAG` after the next animation frame with `params.chest_cm === 90`, and `store.get().body.params.chest_cm` unchanged; dispatch `change` → store value `90`, `body.preset === 'custom'`, `store.canUndo() === true`.
11. `sizes-add`: click `#btn-size-add` → `rows.length + 1`, new row name is the first unused of the list, its `chest_cm` = previous last + 4.
12. `sel-size`: options equal `doc.sizes.rows.map(r => r.name)`; setting the value and dispatching `change` writes `doc.ui.activeSize`.
13. `toolbar-action`: `#btn-drape.click()` emits `{action:'drape'}`; `#btn-export-print.click()` emits `{action:'export', kind:'print', paper:'A4'}`.

---

### 11.9 Pattern editor — `src/pattern/` (A2)

Files: `editor.js` (controller, selection, pointer/key routing, piece ops), `view.js` (view transform), `hit.js` (hit testing), `render2d.js` (drawing), `validate.js` (Issue[]), `seams.js` (seam helpers, ease, index remapping), `tools/{select,draw,edit,split,seam,notch,grainline,measure}.js`, `index.js`, `selftest.js`. Imports only `src/core/*` and `src/geometry/index.js`. All coordinates in the document are mm, y up (section 1); screen coordinates are CSS px relative to the canvas top-left, y down.

#### 11.9.1 `editor.js` — `createEditor(canvas, store, bus, opts?)`

```js
/**
 * @param {HTMLCanvasElement} canvas   normally #canvas-2d; any canvas works (selftest uses a detached 800x600 canvas)
 * @param {Store} store  @param {EventBus} bus
 * @param {{autoFit?:boolean}} [opts]   autoFit (default true): fitToPieces() after 'doc:load' notifications
 * @returns {Editor}
 */
export function createEditor(canvas, store, bus, opts = {})

/**
 * @typedef {Object} Selection
 * @property {string[]} pieceIds       selected pieces (order of selection)
 * @property {string|null} pieceId     primary piece = last of pieceIds
 * @property {number|null} vertex      vertex index in the primary piece
 * @property {number|null} edge        edge index in the primary piece
 * @property {boolean} edgeMirror      true when the selected edge is the mirrored ghost copy of a fold piece
 * @property {{edge:number, which:'c1'|'c2'}|null} handle
 * @property {number|null} notch       notch index in the primary piece
 * @property {string|null} seamId
 */

/**
 * @typedef {Object} Editor
 * @property {(name:ToolName)=>void} setTool        throws Error code 'PATTERN_BAD_TOOL' for unknown names; cancels the current tool first
 * @property {()=>ToolName} getTool
 * @property {()=>Selection} getSelection           returns a frozen copy
 * @property {(sel:Partial<Selection>, opts?:{additive?:boolean})=>void} select   normalises (pieceId = last of pieceIds; unknown ids dropped) and emits selection:changed
 * @property {()=>void} clearSelection
 * @property {View} view                            11.9.2
 * @property {(ev:PointerLike)=>void} injectPointer   feeds a synthetic pointer event through the same path as DOM events (automation / selftest)
 * @property {()=>void} cancel                       Escape: tool.cancel(); if the tool had nothing to cancel, clearSelection()
 * @property {()=>void} confirm                      Enter: tool.confirm()
 * @property {()=>void} deleteSelection              Delete: tool.onDelete() if the tool handles it, else the select-tool rule (11.10.1)
 * @property {(dx_mm:number, dy_mm:number)=>void} nudge   arrow keys (11.10.1 / 11.10.3)
 * @property {()=>void} mirror                        the Fold button (11.10.9)
 * @property {(vertices:Vec2[], partial?:Partial<Piece>)=>string} addPiece   validates + makes CCW, fills defaults (11.10.2), commits 'piece:add', returns the id
 * @property {(a:SeamSide, b:SeamSide, reverse?:boolean)=>string} addSeam    seams.makeSeam + commit 'seam:add'; reverse auto when omitted; returns the id
 * @property {(seamId:string)=>void} removeSeam        commit 'seam:delete'
 * @property {()=>Issue[]} getIssues                   last validation result
 * @property {()=>void} requestRender                  coalesced to the next animation frame
 * @property {()=>void} renderNow                      synchronous full redraw (tests)
 * @property {()=>Transient} getTransient              tool preview state (11.9.4), read-only
 * @property {(cb:(hit:Hit|null)=>void)=>()=>void} onHover   subscribe to hover changes
 * @property {()=>void} destroy
 */
/** @typedef {'select'|'draw'|'edit'|'split'|'seam'|'notch'|'grainline'|'measure'} ToolName */
/** @typedef {{type:'down'|'move'|'up'|'dblclick'|'wheel', x:number, y:number, button?:0|1|2, shift?:boolean, alt?:boolean, ctrl?:boolean, deltaY?:number}} PointerLike  x,y = CSS px relative to the canvas */
```

**DOM wiring** (in `createEditor`): `pointerdown/move/up/cancel`, `dblclick`, `wheel` (passive:false), `contextmenu` (prevented), `pointerleave` (cursor readout cleared) on the canvas; pointer capture on `pointerdown`. DOM events are converted to `PointerLike` (`x = e.clientX − rect.left`, `y = e.clientY − rect.top`) and passed to `handlePointer`, the same function `injectPointer` calls. `pointerdown` also calls `canvas.focus({preventScroll:true})`. Keyboard is **not** handled here (11.7 routes keys to `cancel/confirm/deleteSelection/nudge`).

**Pointer routing** (`handlePointer(ev)`):

1. Middle button (`button === 1`) down/move/up → view pan (11.9.2), never reaches the tool. `wheel` → view zoom.
2. Compute `w = view.screenToWorld(ev.x, ev.y)`; emit `EVENT.PATTERN_CURSOR {x_mm: w[0], y_mm: w[1]}` on `move` (throttled per animation frame).
3. `hit = hitTest(doc, view, ev.x, ev.y, {selection, tool})` (11.9.3).
4. Build `ToolEvent = {type, x_mm, y_mm, px, py, shift, alt, ctrl, button, hit}` and call `tool.onDown/onMove/onUp/onDblClick`.
5. Hover = the hit on `move` when no button is pressed; on change → `requestRender()` and `onHover` callbacks. Canvas cursor = `tool.cursor(hoverHit)`.

**Store subscription**: on every notification `(doc, label)`: drop selection ids/indices that no longer exist; if `label === 'doc:load'` and `opts.autoFit`, `view.fitToPieces()`; schedule validation (11.11.2) and `requestRender()`.

**Tool interface** (`tools/*.js`, each `export function createXTool(ctx) -> Tool`, `ctx = {store, bus, editor, view, commit(label, mutator), status(text, level), setSeamEase(text|null, warn)}`):

```js
/** @typedef {Object} Tool
 * @property {ToolName} name
 * @property {(hit:Hit|null)=>string} cursor       CSS cursor
 * @property {(e:ToolEvent)=>void} onDown
 * @property {(e:ToolEvent)=>void} onMove
 * @property {(e:ToolEvent)=>void} onUp
 * @property {(e:ToolEvent)=>void} onDblClick
 * @property {()=>boolean} cancel                   returns true when it had a pending operation to cancel
 * @property {()=>void} confirm
 * @property {()=>boolean} [onDelete]               returns true when handled
 * @property {()=>void} activate                    called by setTool; tools reset state here
 * @property {()=>void} deactivate
 * @property {()=>Transient} transient              preview state for render2d
 */
```

**Snapping** (used by draw, select-move, edit, grainline): `snap(p, {ctrl, shift, anchor})`: unless `ctrl`, round to the 1 mm grid; then if a vertex of any piece (including mirrored ghosts) lies within 6 px, snap to it (vertex snap wins over grid); if `shift` and `anchor` are given, project onto the nearest of the 8 directions at 45° from `anchor` (after grid snap). Export `snapPoint` from `editor.js` for the tools.

**Piece ops** (pure functions exported from `editor.js`; each returns `{piece, map}` where `map` is the edge index map `oldEdge -> newEdge|-1` used by `seams.remapAfterEdgeChange`; they never touch the store):

- `opTranslate(piece, dx, dy) -> Piece` (vertices, control points, grainline, internalLines).
- `opSplitEdge(piece, e, t)` — line: insert `pointAtArcFraction` at `t`; cubic: `u = paramAtArcFraction(...)`, `splitCubic` gives two cubics. New vertex index `e + 1`; edges after `e` shift by +1; notches on `e`: `t' = t/ts` on edge `e` if `t < ts`, else `(t − ts)/(1 − ts)` on edge `e+1` where `ts` is the split fraction; `pinnedEdges` containing `e` get both halves; `foldEdge > e` shifts. `map[k] = k` for `k ≤ e`, `k+1` for `k > e`. Refuses (`Error` code `PATTERN_FOLD_SPLIT`) when `e === foldEdge`.
- `opInsertVertex(piece, e, t)` — same as split (alias used by the edit tool).
- `opDeleteVertex(piece, i)` — requires `vertices.length > 3` else `Error` code `PATTERN_MIN_VERTICES`; removes vertex `i`; edges `i−1` and `i` merge into one `'line'` edge at index `i−1` (mod n); notches on either removed; `pinnedEdges` remapped; `foldEdge` becomes `null` if it was one of the two. `map[i−1] = i−1`, `map[i] = -1`, later edges −1.
- `opReflectX(piece)` — `x → −x` for vertices and control points, grainline, internal lines; vertex order reversed so the loop stays CCW; edges remapped: new edge `j` = old edge `n−1−j` with `c1`/`c2` swapped; notches: `edge' = n−1−edge`, `t' = 1 − t`; `map[k] = n−1−k`; `foldEdge` remapped by the same map.
- `opSetFold(piece, e)` — sets `foldEdge = e`, `edges[e].allowance_mm = 0`, `grade.anchorX = 'fold'`; requires `edges[e].type === 'line'` and both endpoints `|x| ≤ 0.01` mm (`Error` code `PATTERN_FOLD_NOT_ON_AXIS`).
- `opClearFold(piece)` — `foldEdge = null`; deletes `edges[old].allowance_mm` when it is `0`; `grade.anchorX = 'center'` if it was `'fold'`.
- `makeCcw(vertices, edges) -> {vertices, edges}` — if `signedArea(vertices) < 0`, reverse both (edges remapped as in `opReflectX` but without the x flip).

Every op that changes edge indices is committed together with `seams.remapAfterEdgeChange(doc, pieceId, map)` inside the same `store.update` so the document is never observed with dangling indices.

#### 11.9.2 `view.js` — view transform

```js
/** @returns {View} */
export function createView(canvas, onChange)
/**
 * @typedef {Object} View
 * @property {()=>{cx:number, cy:number, pxPerMm:number, width:number, height:number, dpr:number}} get   cx,cy = world mm at the canvas centre
 * @property {(v:{cx?:number, cy?:number, pxPerMm?:number})=>void} set    pxPerMm clamped to [0.05, 20]
 * @property {(x_mm:number, y_mm:number)=>[number, number]} worldToScreen
 * @property {(px:number, py:number)=>[number, number]} screenToWorld
 * @property {(factor:number, px?:number, py?:number)=>void} zoomBy   about the screen point (default centre)
 * @property {(dx_px:number, dy_px:number)=>void} panBy
 * @property {(bbox:{minX,minY,maxX,maxY}, margin_px?:number)=>void} fit   margin default 40
 * @property {()=>void} fitToPieces        bbox of all pieces (fold pieces include the mirrored half); empty doc → cx=cy=0, pxPerMm=1
 * @property {()=>void} resize             re-reads clientWidth/Height and devicePixelRatio, sets canvas.width/height = css*dpr
 * @property {()=>void} destroy
 */
```

Formulas (`W`,`H` = CSS px size, `s = pxPerMm`): `px = (x − cx)·s + W/2`, `py = H/2 − (y − cy)·s`; inverse `x = (px − W/2)/s + cx`, `y = cy − (py − H/2)/s`. `zoomBy(f, px, py)`: `w = screenToWorld(px,py)`; `s' = clamp(s·f)`; then set `cx, cy` so that `worldToScreen(w) === (px,py)` again. Wheel: `zoomBy(1.1 ** (−deltaY/100), x, y)`. Middle-drag pan: `panBy(dx, dy)` → `cx −= dx/s`, `cy += dy/s`. `fit(bbox, m)`: `s = clamp(min((W−2m)/bw, (H−2m)/bh))` (bw/bh ≥ 1 mm), centre on the bbox centre. A `ResizeObserver` on `canvas.parentElement` calls `resize()` then `onChange()`; the drawing context is set up with `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` so all drawing code works in CSS px. Initial view: `cx = 0, cy = 0, pxPerMm = 1`, then `fitToPieces()` once the first document arrives.

`editor.view` is exactly this object; `__app.pattern.worldToScreen/screenToWorld/setView/getView` (section 12) forward to it, which is what canvas-driving acceptance tests use.

#### 11.9.3 `hit.js` — hit testing

```js
export const HIT_TOL_PX = { vertex: 8, handle: 8, notch: 8, grainline: 8, edge: 6 };
/**
 * @typedef {Object} Hit
 * @property {'vertex'|'handle'|'notch'|'grainline'|'edge'|'piece'} kind
 * @property {string} pieceId
 * @property {number} index      vertex / notch / edge index (edge index for 'handle')
 * @property {'c1'|'c2'|'a'|'b'} [which]   handle control point, or grainline endpoint
 * @property {number} [t]        for 'edge': arc-length fraction of the closest point, in [0,1]
 * @property {boolean} mirror    true when the hit is on the mirrored ghost of a fold piece (edges and pieces only)
 * @property {number} dist_px
 */
/** @param {{selection:Selection, tool:ToolName, handlesVisible?:boolean}} opts */
export function hitTest(doc, view, px, py, opts) -> Hit|null
export function flattenCache(piece) -> {points:Vec2[], edgeStart:number[], mirrored:{points, edgeStart}|null}   // flattenPiece(piece, 0.25) cached per piece object identity (WeakMap)
```

Priority order (first match wins; pieces are scanned from the last in `doc.pieces` to the first so the top-most drawn piece wins):

1. `vertex` — only on selected pieces, or on every piece when `opts.tool === 'edit'` or `'draw'`; nearest within `vertex` tolerance.
2. `handle` — only when `handlesVisible` (edit tool, or a selected vertex): `c1`/`c2` of cubic edges adjacent to the selected vertex, or all handles of the primary piece in the edit tool.
3. `notch` — every notch of every piece (position `pointAtArcFraction`).
4. `grainline` — endpoints `a`/`b` of the primary piece's grainline (tool `grainline` only).
5. `edge` — `distToPolyline` on the cached flattened outline of every piece **and** of the mirrored ghost of fold pieces (`mirror:true`); `index` = edge containing the closest segment (from `edgeStart`), `t` = arc-length fraction of the closest point within that edge (segment lengths summed). The fold edge itself is reported with `kind:'edge'` too; tools decide whether it is allowed.
6. `piece` — `pointInPolygon` on the outline (or the ghost, `mirror:true`).
7. `null`.

Distances are computed in screen px (points transformed with `view.worldToScreen`). Ties resolved by smaller `dist_px`.

#### 11.9.4 `render2d.js` — drawing

```js
export const STYLE = {
  bg:'#141518', gridMinor:'#1f2227', gridMajor:'#2b2f36', axis:'#3d4450',
  outline:'#e6e6e6', outlineWidth:1.5, fillAlpha:0.18,
  selection:'#4da3ff', selectionWidth:2.5, hover:'rgba(77,163,255,0.45)',
  handleFill:'#ffffff', handleLine:'rgba(255,255,255,0.5)',
  fold:'#ffcc3d', foldDash:[8,3,2,3], ghostAlpha:0.35,
  notch:'#ffffff', grainline:'#ff9f43', internalDart:'#ff9f43', internalMark:'#9aa0a6',
  allowance:'rgba(230,230,230,0.35)', allowanceDash:[4,3],
  graded:'#3ddc84', gradedDash:[6,4],
  seamWidth:4, seamAlpha:0.85, seamWarn:'#ff5c5c',
  label:'#e6e6e6', labelFont:'12px system-ui', edgeLabelFont:'10px system-ui',
  measure:'#ffcc3d', box:'rgba(77,163,255,0.15)', boxStroke:'#4da3ff'
};
export function hueOf(seamId) -> number          // hashString(seamId) % 360
export function seamColor(seamId, warn=false) -> string   // warn ? STYLE.seamWarn : `hsl(${hueOf(id)} 70% 55%)`
/**
 * @param {CanvasRenderingContext2D} ctx  (already scaled by dpr)
 * @param {View} view  @param {ProjectDoc} doc
 * @param {{selection:Selection, hover:Hit|null, transient:Transient, issues:Issue[], fabricPreview:Record<string,string>, activeSize:string}} ui
 */
export function render(ctx, view, doc, ui)
/** @typedef {Object} Transient   tool preview state, all optional
 * @property {{pieceIds:string[], dx:number, dy:number}} [dragOffset]          select-tool move preview
 * @property {{pieceId:string, index:number, pos:Vec2}} [vertexOverride]       edit-tool vertex drag
 * @property {{pieceId:string, edge:number, which:'c1'|'c2', pos:Vec2}} [handleOverride]
 * @property {{pieceId:string, index:number, t:number}} [notchOverride]
 * @property {Vec2[]} [drawPoints]  @property {Vec2} [rubber]                 draw tool
 * @property {{x0:number,y0:number,x1:number,y1:number}} [box]                 box select (px)
 * @property {{pieceId:string, edge:number, mirror:boolean}} [seamFirst]       seam tool first pick
 * @property {{pieceId:string, edge:number, t:number}} [edgeMarker]            split / notch hover marker
 * @property {{a:Vec2, b:Vec2}} [grainPreview]
 * @property {{a:Vec2, b:Vec2, text:string}} [measure]
 */
```

Layer order (all drawing in screen px via `view.worldToScreen`; curves drawn with `ctx.bezierCurveTo` on transformed control points — the transform is affine so this is exact):

1. Background `STYLE.bg`. Grid: minor lines every 10 mm when `pxPerMm ≥ 0.4`, major every 50 mm always (only lines inside the viewport are drawn); the axes `x = 0` (fold line) and `y = 0` in `STYLE.axis`, 1 px.
2. Per piece (document order), applying `dragOffset`/`vertexOverride`/`handleOverride` to a **working copy** of the piece used for this frame:
   1. Seam allowance ghost: `offsetOutline(piece)` polyline, `allowance` colour, dashed, 1 px. Cached per piece object identity (`WeakMap`); pieces with an override are not cached.
   2. Fill: `resolveFabric(fabric).look.color` (or `ui.fabricPreview[fabricId]` when present) at `fillAlpha`; fold pieces also fill the mirrored half at `fillAlpha·0.5`.
   3. Outline `outline`/`outlineWidth`; the fold edge in `fold` colour with `foldDash` and a `FOLD` label; for fold pieces the mirrored half outline dashed at `ghostAlpha`.
   4. Selected piece: outline in `selection`/`selectionWidth` instead; edge labels (`edge.label`) at edge midpoints offset 6 px outward in `edgeLabelFont`.
3. Seams: for each seam, both sides stroked with `seamColor(id, easePct > 8)` at `seamWidth` and `seamAlpha` (mirror sides on the ghost); a filled 5 px dot at the **paired start** of each side: vertex `start` of side a, and of side b the start vertex when `!b.reverse` or the end vertex when `b.reverse`; the selected seam gets an extra 1 px white outline. Ease from `seams.seamEase` (cached per frame).
4. Notches: 5 mm tick from the outline outward along the outward normal (`(d.y, −d.x)` for the CCW loop, section 1); double = two ticks 4 mm apart along the edge; `notch` colour, 1.5 px; also on the mirrored ghost.
5. Grainline: line `a → b`, arrow head (8 px, 30°) at `b`, a 6 px bar at `a`; `grainline` colour, 1.5 px.
6. Internal lines: `fold` kind dash-dot in `fold` colour, `dart` solid 1 px `internalDart`, `mark` dashed `internalMark`.
7. Graded ghost: when `ui.activeSize !== doc.sizes.baseSize` and the row exists, `gradePiece(piece, doc.sizes, ui.activeSize)` outline dashed 1 px in `graded` (cached per piece identity + activeSize).
8. Hover: hovered vertex (10 px ring), edge (stroke 4 px `hover`), piece (outline 3 px `hover`).
9. Selection handles: on selected pieces, 7 px squares at every vertex (`handleFill` fill, `selection` stroke); the selected vertex filled `selection`; the selected edge stroked 3 px `selection`; selected notch ring. Bezier handles (edit tool: all cubic edges of the primary piece; otherwise cubic edges adjacent to the selected vertex): `handleLine` from vertex to `c1`/`c2`, 6 px circles.
10. Tool overlay from `transient`: `drawPoints` polyline + `rubber` segment + first-vertex ring (10 px) when ≥ 3 points; `box` rectangle; `seamFirst` edge stroked 5 px white at 60 %; `edgeMarker` 6 px cross; `grainPreview`; `measure` line with the text drawn at the midpoint on a dark pill (`labelFont`).
11. Piece names in `labelFont` at the bbox centre when `bboxWidth·pxPerMm > 40` px; issues: a piece with an `error` issue gets a 2 px `STYLE.seamWarn` outline under the normal outline.

`render` allocates nothing per piece except the working copy when an override applies; the flattened outlines come from `hit.flattenCache`.

---

### 11.10 Tools — interaction state machines

Conventions: "commit(label, fn)" = `store.update(label, fn)`; previews use the tool's `transient` and never write to the store until the gesture ends; a drag starts only after the pointer moved ≥ 3 px from the down point (below that a down/up pair is a click). `status(text)` writes `EVENT.STATUS` info messages; errors use level `warn` (nothing in the editor is fatal).

#### 11.10.1 `tools/select.js` — Select (V)

States: `IDLE`, `PRESSED{hit, x0, y0}`, `DRAG_PIECE{pieceIds, x0, y0}`, `BOX{x0, y0}`.

- `onDown` (button 0): `hit` of kind `piece`/`edge`/`vertex`/`notch` on piece P → if `shift`: toggle P in `pieceIds` (additive), else if P not selected: `select({pieceIds:[P], edge: hit.kind==='edge' ? hit.index : null, edgeMirror: hit.mirror, vertex: hit.kind==='vertex' ? hit.index : null, seamId: seamOfEdge(P, hit) })`, else (already selected) keep the selection but update `edge`/`vertex`/`seamId` from the hit. State `PRESSED`. `hit === null` → state `BOX` (rubber band from the down point); without shift the selection is cleared on `onUp` if the box is empty and the pointer did not move.
- `onMove` in `PRESSED` with movement ≥ 3 px → `DRAG_PIECE` for all selected pieces; in `DRAG_PIECE`: `d = snap(w) − snap(w0)` in mm (Shift: constrain to the dominant axis, Ctrl: no grid snap) → `transient.dragOffset = {pieceIds, dx, dy}`. In `BOX`: update `transient.box`.
- `onUp`: `DRAG_PIECE` → if `dx || dy`: `commit('piece:move', d => pieces.forEach(p => opTranslate in place))`; `BOX` → pieces whose bbox intersects the box (mm) become the selection (shift = union); `PRESSED` → nothing (click already handled). Back to `IDLE`.
- `onDblClick` on a piece → `editor.setTool('edit')` keeping the selection.
- `onDelete`: if `selection.seamId` and the down-hit was an edge (i.e. `selection.edge !== null`) → `commit('seam:delete')` of that seam and keep pieces; otherwise delete all selected pieces and their seams (`piece:delete`). Returns true.
- `nudge(dx, dy)`: translate selected pieces (`piece:move`).
- `cancel()`: aborts a drag/box (returns true) else false.
- Cursor: `move` over a selected piece, `default` otherwise. Hint: `Select: click / drag pieces · Shift adds · drag on empty = box`.

#### 11.10.2 `tools/draw.js` — Draw (P)

States: `IDLE`, `PLACING{points:Vec2[]}`.

- `onDown` (button 0): `p = snap(w, {ctrl, shift, anchor: last point})`. `IDLE` → `PLACING` with `[p]`. `PLACING`: if `points.length ≥ 3` and the down point is within 8 px of `points[0]` → close (below); else if `p` equals the last point (< 0.5 mm) ignore; else push `p`.
- `onMove`: `transient.rubber = snap(w, …)`, `transient.drawPoints = points`.
- `confirm()` (Enter) → close when `points.length ≥ 3`, else status warn `Need at least 3 points`.
- `onDblClick` → close (the double-click's own down is not added).
- `cancel()` → discard, `IDLE`, returns true when it was placing. Backspace (`deleteSelection`/`onDelete` while placing) removes the last point (returns true).
- **Close**: `{vertices, edges} = makeCcw(points, points.map(() => ({type:'line'})))`; reject with status warn and stay `PLACING` when `|signedArea| < 100 mm²` or `!isSimplePolygon(vertices)`; otherwise `editor.addPiece(vertices)` → commit `piece:add`, select the new piece, state `IDLE` (tool stays `draw`).
- `addPiece(vertices, partial)` defaults (identical to the `normalizeDoc` defaults of 3.3 except the ones marked *): `id = uid('piece')`, `name = 'Piece ' + (pieces.length + 1)`*, `edges` all `{type:'line'}`, `foldEdge: null`, `notches: []`, `grainline`*: vertical through the bbox centre, `a = [cx, cy − 0.3·h]`, `b = [cx, cy + 0.3·h]` (`h` = bbox height, minimum length 20 mm), `internalLines: []`, `seamAllowance_mm: 10`, `fabricId = doc.fabrics[0].id`*, `layer: 0`, `cutQty: 1`, `exportHidden: false`, `simulate: true`, `pinnedEdges: []`, `placement: {anchor:'torso', side:'front', offset_mm:[0,0], wrap:0.8, flip:false}`, `grade: {widthRef:'chest_cm', lengthRef:'torsoLength_cm', anchorX:'center', anchorY:'top', vertexRules:[]}`, `meshSpacing_mm: 15`. `partial` overrides any field; the result is validated (`vertices.length ≥ 3`, simple, CCW after `makeCcw`) or `Error` code `PATTERN_BAD_OUTLINE` is thrown.
- Cursor `crosshair`. Hint: `Draw: click to add points · click the first point or Enter to close · Esc cancels · Shift = 45°`.

#### 11.10.3 `tools/edit.js` — Edit points (E)

States: `IDLE`, `DRAG_VERTEX{pieceId, index, start}`, `DRAG_HANDLE{pieceId, edge, which}`.

- `onDown` on `vertex` → select `{pieceIds:[P], vertex:i}`, state `DRAG_VERTEX`. On `handle` → `DRAG_HANDLE`. On `edge`: with `alt` → **insert vertex** at `hit.t` (`opInsertVertex`, commit `vertex:insert`, remap seams, select the new vertex); without alt → select `{pieceIds:[P], edge: hit.index, edgeMirror: hit.mirror}`. On `piece` → select the piece. On empty → nothing.
- `onMove` in `DRAG_VERTEX`: `pos = snap(w, {ctrl})` → `transient.vertexOverride`; the control points attached to that vertex (`edges[i].c1` and `edges[i−1].c2` when cubic) move by the same delta (render applies this from the override). In `DRAG_HANDLE`: `transient.handleOverride = {…, pos: w}` (no grid snap); with `shift`, the opposite handle at the shared vertex is kept collinear: `opp = v − (pos − v) · |opp − v| / |pos − v|`.
- `onUp`: commit `vertex:move` / `handle:move` when the position changed (writes the vertex and attached control points, or the handle and — with shift — the opposite handle).
- `onDblClick` on `edge` → toggle type (commit `edge:type`): `line → cubic` with `c1 = p0 + (p1 − p0)/3`, `c2 = p0 + 2(p1 − p0)/3` (shape unchanged, handles now draggable); `cubic → line` deletes `c1`,`c2`. Refused on the fold edge (status warn).
- `onDelete`: selected vertex → `opDeleteVertex` (commit `vertex:delete`, remap seams; status warn `A piece needs at least 3 vertices` when refused); selected notch → `notch:delete`; else false (falls back to the select rule).
- `nudge(dx, dy)`: moves the selected vertex (and attached control points) — commit `vertex:move`; without a selected vertex, moves the selected pieces (`piece:move`).
- Cursor: `grab` over vertex/handle, `copy` over an edge with Alt, `default`. Hint: `Edit: drag points/handles · double-click edge = line/curve · Alt-click edge inserts · Delete removes`.

#### 11.10.4 `tools/split.js` — Split edge (X)

- `onMove` over an `edge` (not the fold edge) → `transient.edgeMarker = {pieceId, edge, t}`.
- `onDown` on such an edge → `{piece, map} = opSplitEdge(piece, e, t)` (`t` clamped to `[0.02, 0.98]`), commit `piece:splitEdge` together with `remapAfterEdgeChange`; a seam that referenced edge `e` is removed inside the same commit and a status warn `Seam removed by split (re-create it on the half you need)` is shown; the new vertex is selected. On the fold edge: status warn `The fold edge cannot be split`.
- Hint: `Split: click an edge to split it at the cursor`.

#### 11.10.5 `tools/seam.js` — Seam (S)

States: `IDLE`, `FIRST{a:SeamSide}`.

- Candidate rule for an edge hit `h` on piece P: not the fold edge (`h.index !== P.foldEdge`), `h.mirror` only allowed when `P.foldEdge !== null`, and the edge (with that `mirror` flag) is not already used by a seam (`seams.seamOfEdge(doc, P.id, h.index, h.mirror)` is null).
- `onDown` in `IDLE`: on an edge already in a seam → `select({seamId})`, `setSeamEase(formatEase(seamEase(doc, seam)), ease > 8)`; Delete then removes it (`onDelete` → `seam:delete`). On a candidate edge → `a = {pieceId, edge, mirror}`, state `FIRST`, `transient.seamFirst = a`, hint `Seam: click edge B`. On anything else → nothing.
- `onMove` in `FIRST` over a candidate edge `b ≠ a` → live readout: `setSeamEase(formatEase(seamEaseOf(doc, a, b)), ease > 8)` (also mirrored into `EVENT.SEAM_EASE`); otherwise `setSeamEase(null)`.
- `onDown` in `FIRST`: on candidate `b` (may be the same piece; must not be the same `(pieceId, edge, mirror)`) → `editor.addSeam(a, b)` (reverse chosen by `chooseReverse`, 11.11.1), commit `seam:add`, `select({seamId})`, status `Seam created: A 312 mm / B 328 mm - ease 5.1%`; on the fold edge or a taken edge → status warn, stay in `FIRST`; on empty → stay.
- `cancel()`: `FIRST → IDLE` (returns true), `setSeamEase(null)`. `deactivate()` does the same.
- Cursor `crosshair` over candidate edges, `not-allowed` over the fold edge or a taken edge. Hint (IDLE): `Seam: click edge A (click an existing seam to select it)`.

#### 11.10.6 `tools/notch.js` — Notch (N)

States: `IDLE`, `DRAG_NOTCH{pieceId, index}`.

- `onMove` over an edge (including the fold edge, mirrored ghosts excluded — a notch on the mirrored copy is the same notch) → `transient.edgeMarker`.
- `onDown` on an edge → `commit('notch:add', d => piece.notches.push({edge, t: clamp(t, 0.02, 0.98), kind: shift ? 'double' : 'single'}))`, select the notch. On an existing `notch` hit → select it, state `DRAG_NOTCH`.
- `onMove` in `DRAG_NOTCH`: project the cursor onto the notch's edge (nearest point, `t` from the flattened edge) → `transient.notchOverride`. `onUp` → commit `notch:move`.
- `onDelete`: selected notch → `notch:delete`. `onDblClick` on a notch toggles `kind` (`notch:kind`).
- Hint: `Notch: click an edge · Shift = double notch · drag to move · Delete removes`.

#### 11.10.7 `tools/grainline.js` — Grainline (G)

States: `IDLE`, `DRAG_NEW{pieceId, a}`, `DRAG_END{pieceId, which}`.

- `onDown` on a grainline endpoint of the primary piece → `DRAG_END`; on a `piece` (or any hit on a piece) → `DRAG_NEW` with `a = snap(w)` and that piece selected.
- `onMove`: `b = snap(w, {shift, anchor:a})` → `transient.grainPreview = {a, b}` (for `DRAG_END`, the other endpoint stays).
- `onUp`: `DRAG_NEW` → if `|b − a| ≥ 5 mm` commit `grainline:set` `{a, b}`, else ignore; `DRAG_END` → commit `grainline:set`.
- Hint: `Grainline: drag inside a piece (arrow points a → b) · Shift = 45° · drag an end to adjust`.

#### 11.10.8 `tools/measure.js` — Measure (M)

- `onDown` → `a = snap(w)` (vertex snap active, grid snap only with Ctrl off); `onMove` → `b = snap(w)`, `transient.measure = {a, b, text}` with `text = \`${len.toFixed(1)} mm  dx ${dx.toFixed(1)}  dy ${dy.toFixed(1)}  ${angleDeg.toFixed(1)}°\`` (`angle = atan2(dy, dx)` in degrees); the same text goes to `status(text)`.
- `onUp`: keeps the readout until the next `onDown`; a click without drag on an `edge` shows `edge ${index} of ${piece.name}: ${edgeLength.toFixed(1)} mm` (`mirror` noted), on a `piece` shows `${name}: area ${area_cm2.toFixed(1)} cm² · bbox ${w.toFixed(0)} × ${h.toFixed(0)} mm`.
- No store writes. `cancel()` clears the readout. Hint: `Measure: drag to measure · click an edge for its length`.

#### 11.10.9 Fold button — `editor.mirror()`

Preconditions: exactly one selected piece P (`selection.pieceIds.length === 1`), otherwise status warn `Select one piece`.

1. If `P.foldEdge !== null` → `commit('piece:foldClear', d => opClearFold(p))`, status `Fold cleared`. Done.
2. Else require `selection.edge !== null` and `edges[e].type === 'line'`, otherwise status warn `Select a straight edge to place on the fold`.
3. Let `(x0, y0) = vertices[e]`, `(x1, y1) = vertices[(e+1)%n]`. Require `|x1 − x0| ≤ 0.5 mm` (vertical), otherwise status warn `The fold edge must be vertical`.
4. In one commit `piece:foldSet`: `opTranslate(p, −x0, 0)` (edge now on `x = 0`); then if any vertex has `x < −0.01` after the translation (the piece lies on the negative side) → `{piece, map} = opReflectX(p)` and `remapAfterEdgeChange(doc, p.id, map)` (edge `e` becomes `n−1−e`); set both endpoints' x to exactly `0`; `opSetFold(p, e')`; seams referencing edge `e'` are removed (status warn). Status `Fold set on edge ${e'} — the piece is mirrored across x = 0 at mesh time`.

Automation: `__app.pattern.setFold(pieceId, edge|null)` (section 12) calls the same ops without the selection preconditions.

---

### 11.11 `seams.js` and `validate.js`

#### 11.11.1 `seams.js` (pure)

```js
/** mm length of outline edge e of piece (mirror does not change length). */
export function edgeLengthOf(piece, e) -> number
/** Endpoints of a seam side in pattern mm, mirror applied (x negated); [start, end] in the side's traversal order. */
export function sideEndpoints(doc, side) -> [Vec2, Vec2]
/**
 * Nearest-endpoint heuristic. Let A0,A1 = sideEndpoints(a), B0,B1 = sideEndpoints(b).
 * reverse = |A0-B1| + |A1-B0| < |A0-B0| + |A1-B1|   (ties -> false).
 * Rationale: two CCW pieces sharing a seam traverse the shared edge in opposite directions, so the physically
 * adjacent endpoints are A0~B1 and A1~B0 → pairing i ↔ N-i.
 */
export function chooseReverse(doc, a, b) -> boolean
/** @returns {{lenA_mm:number, lenB_mm:number, easePct:number, longer:'a'|'b'|null}}  easePct = (max-min)/min*100 */
export function seamEase(doc, seam) -> object
export function seamEaseOf(doc, a, b) -> object          // same, for a not-yet-created pair
/** 'A 312 mm / B 328 mm - ease 5.1%'  (lengths rounded to integers, ease one decimal; 'ease 0.0%' when equal) */
export function formatEase(ease) -> string
/** 'Front e1 ↔ Back e3 · 312 / 328 mm · ease 5.1%'  (piece names, 'e<k>' edge index, "'" appended to k for mirror sides) */
export function formatSeamRow(doc, seam) -> string
export function seamOfEdge(doc, pieceId, edge, mirror=false) -> Seam|null
export function seamsOfPiece(doc, pieceId) -> Seam[]
/** Builds a Seam; throws Error with code:
 *  'SEAM_SAME_EDGE' (a and b identical), 'SEAM_ON_FOLD_EDGE', 'SEAM_MIRROR_WITHOUT_FOLD', 'SEAM_EDGE_TAKEN', 'SEAM_DANGLING' (piece/edge missing).
 *  reverse defaults to chooseReverse(doc, a, b). id = uid('seam'), kind 'plain', a.reverse is always false (b carries the flag). */
export function makeSeam(doc, a, b, reverse) -> Seam
/**
 * Rewrites every seam side, notch, pinnedEdges entry and foldEdge of pieceId through map (oldEdge -> newEdge, -1 = removed).
 * Seams whose side maps to -1 are deleted. Mutates doc in place (call inside store.update). Returns the ids of removed seams.
 * Notches are NOT remapped here (the ops do that with the t split); only their edge index is passed through map.
 */
export function remapAfterEdgeChange(doc, pieceId, map) -> string[]
/** Vertex ids-free helper for the sizes panel and validate: ease of a seam in a graded document (pieces replaced by gradePiece copies). */
export function seamEaseGraded(doc, seam, gradedPieces) -> object
```

`edgeLengthOf` uses `geometry.edgeLength(p0, edge, p1)`; results are cached per `(piece object identity, e)` in a `WeakMap` (pieces are replaced, not mutated, by the store, so identity is a valid cache key).

#### 11.11.2 `validate.js`

```js
/** All issues of the document, pieces first (document order), then seams. */
export function validateDoc(doc) -> Issue[]
export function validatePiece(doc, piece) -> Issue[]
export function validateSeam(doc, seam) -> Issue[]
export const ISSUE_CODES  // the table below, code -> {level, message template}
```

| code | level | condition | message (template) |
|---|---|---|---|
| `PIECE_TOO_FEW_VERTICES` | error | `vertices.length < 3` or `edges.length !== vertices.length` | `${name}: outline needs at least 3 vertices` |
| `PIECE_NOT_CCW` | error | `signedArea(vertices) <= 0` (flattened outline) | `${name}: outline is not counter-clockwise` |
| `PIECE_SELF_INTERSECTING` | error | `!isSimplePolygon(flatten(piece, 0.25).points)` | `${name}: outline crosses itself` |
| `PIECE_TINY` | warn | area < 100 mm² | `${name}: piece is smaller than 1 cm²` |
| `FOLD_EDGE_INVALID` | error | `foldEdge` not in range or `edges[foldEdge].type !== 'line'` | `${name}: fold edge must be a straight edge` |
| `FOLD_EDGE_NOT_VERTICAL` | error | either endpoint of the fold edge has `|x| > 0.01` mm | `${name}: fold edge must lie on x = 0` |
| `FOLD_PIECE_CROSSES_AXIS` | warn | fold piece with any vertex or control point `x < −0.01` | `${name}: the half piece crosses the fold line` |
| `FOLD_EDGE_ALLOWANCE` | error | fold edge with `allowance_mm` other than `0` or undefined... (undefined is treated as 0 by offset; explicit non-zero is the error) | `${name}: the fold edge must have 0 allowance` |
| `EDGE_CUBIC_MISSING_HANDLES` | error | cubic edge without `c1`/`c2` | `${name}: edge ${e} is cubic without handles` |
| `NOTCH_RANGE` | error | notch `edge` out of range or `t` not in `(0,1)` | `${name}: notch ${k} is outside its edge` |
| `GRAINLINE_DEGENERATE` | warn | `|b − a| < 1 mm` | `${name}: grainline is degenerate` |
| `MESH_SPACING_RANGE` | error | `meshSpacing_mm` not in `[8, 40]` | `${name}: mesh spacing must be 8..40 mm` |
| `ALLOWANCE_OVERLAP` | warn | `!isSimplePolygon(offsetOutline(piece))` or `signedArea(offset) <= signedArea(outline)` | `${name}: seam allowance overlaps itself (reduce the allowance)` |
| `FABRIC_MISSING` | error | `fabricId` not in `doc.fabrics` | `${name}: fabric '${fabricId}' does not exist` |
| `EDGES_UNSEWN` | warn | `simulate` piece with no seam on any edge (original or mirror) and `pinnedEdges.length === 0` | `${name}: no seams and no pinned edges — it will fall` |
| `SEAM_DANGLING` | error | piece or edge index missing on either side | `Seam ${id}: references a missing piece or edge` |
| `SEAM_ON_FOLD_EDGE` | error | a side's edge is that piece's `foldEdge` | `Seam ${id}: cannot sew the fold edge` |
| `SEAM_MIRROR_WITHOUT_FOLD` | error | `mirror === true` on a piece without `foldEdge` | `Seam ${id}: mirror side on a piece without a fold` |
| `SEAM_EDGE_REUSED` | error | the same `(pieceId, edge, mirror)` appears in two seams | `Seam ${id}: edge already used by seam ${other}` |
| `SEAM_EASE_HIGH` | warn | `8 < easePct <= 50` | `Seam ${id}: A ${lenA} mm / B ${lenB} mm - ease ${e}% (> 8%)` |
| `SEAM_EASE_EXTREME` | error | `easePct > 50` | `Seam ${id}: seam lengths differ by ${e}%` |

Issues carry `pieceId`, `seamId`, `edge` where applicable. The editor runs `validateDoc` after every store notification, coalesced to the next animation frame, and emits `EVENT.PATTERN_ISSUES {issues}`; the status bar shows `n issues` (level `error` if any error) via `EVENT.STATUS` only when the count changes. `error`-level issues do not block editing; the wiring layer (section 12) decides which pieces are excluded from meshing (`PIECE_*`/`FOLD_*` errors exclude the piece; `SEAM_*` errors exclude the seam).

---

### 11.12 `index.js`, labels, events, `selftest.js`

#### 11.12.1 `src/pattern/index.js`

```js
export { createEditor, opTranslate, opSplitEdge, opInsertVertex, opDeleteVertex, opReflectX, opSetFold, opClearFold, makeCcw, snapPoint } from './editor.js';
export { createView } from './view.js';
export { hitTest, flattenCache, HIT_TOL_PX } from './hit.js';
export { render, STYLE, hueOf, seamColor } from './render2d.js';
export { validateDoc, validatePiece, validateSeam, ISSUE_CODES } from './validate.js';
export { edgeLengthOf, sideEndpoints, chooseReverse, seamEase, seamEaseOf, formatEase, formatSeamRow, seamOfEdge, seamsOfPiece, makeSeam, remapAfterEdgeChange, seamEaseGraded } from './seams.js';
export const TOOL_NAMES = ['select','draw','edit','split','seam','notch','grainline','measure'];
export const TOOL_HINTS = { select: 'Select: click / drag pieces · Shift adds · drag on empty = box', draw: 'Draw: click to add points · click the first point or Enter to close · Esc cancels · Shift = 45°', edit: 'Edit: drag points/handles · double-click edge = line/curve · Alt-click edge inserts · Delete removes', split: 'Split: click an edge to split it at the cursor', seam: 'Seam: click edge A (click an existing seam to select it)', notch: 'Notch: click an edge · Shift = double notch · drag to move · Delete removes', grainline: 'Grainline: drag inside a piece (arrow points a → b) · Shift = 45° · drag an end to adjust', measure: 'Measure: drag to measure · click an edge for its length' };
export { runSelfTest } from './selftest.js';
```

#### 11.12.2 Store update labels and bus events used by section 11

**Labels** (`store.update(label, …)`; `undoable:false` only where marked). Wiring (section 12) uses the prefix to decide what to rebuild: `piece:*`, `vertex:*`, `handle:*`, `edge:*`, `notch:*`, `seam:*`, `grainline:*` → re-mesh + re-arrange; `body:*` → rebuild body; `fabric:*`, `sim:*` → in-place updates; `sizes:*`, `ui:*` → no simulation change.

| Label | Source | Undoable |
|---|---|---|
| `piece:add`, `piece:delete`, `piece:duplicate`, `piece:move`, `piece:splitEdge`, `piece:foldSet`, `piece:foldClear`, `piece:name`, `piece:cutQty`, `piece:layer`, `piece:meshSpacing`, `piece:allowance`, `piece:fabric`, `piece:simulate`, `piece:exportHidden`, `piece:placement`, `piece:grade`, `piece:pinnedEdges` | editor / pieces panel | yes |
| `vertex:move`, `vertex:insert`, `vertex:delete`, `handle:move`, `edge:type`, `edge:label`, `edge:allowance` | editor | yes |
| `notch:add`, `notch:move`, `notch:delete`, `notch:kind` | editor | yes |
| `seam:add`, `seam:delete`, `seam:flip` | editor / pieces panel | yes |
| `grainline:set` | editor | yes |
| `body:param`, `body:preset`, `body:fitSize` | body panel | yes |
| `fabric:preset`, `fabric:color`, `fabric:texture` | fabric panel | yes |
| `sim:selfCollision`, `sim:bendScale`, `sim:stretchScale` | toolbar / fabric panel | yes |
| `sizes:cell`, `sizes:rename`, `sizes:add`, `sizes:remove`, `sizes:baseSize`, `sizes:fromBody` | sizes panel | yes |
| `ui:split`, `ui:layout`, `ui:swap`, `ui:dockTab`, `ui:activeSize` | layout / dock / toolbar | **no** |

**Events** (constant names as in 3.2; payloads normative here):

| `EVENT.*` | name | payload | emitter → consumers |
|---|---|---|---|
| `UI_ACTION` | `ui:action` | `{action, ...}` (tables in 11.1.2 and 11.7) | toolbar, shortcuts, panels → wiring |
| `UI_LAYOUT` | `ui:layout` | `{layout, swapped, split, popout}` | layout → toolbar, wiring |
| `UI_RESIZE` | `ui:resize` | `{pane:'2d'|'3d', width, height}` | layout → viewer3d, wiring |
| `UI_DOCK_TAB` | `ui:dockTab` | `{tab}` | dock → sizes panel (lazy work) |
| `STATUS` | `status` | `{text, level?, ttl_ms?}` | anyone → statusbar |
| `TOOL_CHANGED` | `tool:changed` | `{tool}` | editor → toolbar, statusbar |
| `SELECTION_CHANGED` | `selection:changed` | `{selection}` | editor → panels, viewer3d (anchor gizmo) |
| `PATTERN_CURSOR` | `pattern:cursor` | `{x_mm, y_mm}` or `null` | editor → statusbar |
| `PATTERN_ISSUES` | `pattern:issues` | `{issues:Issue[]}` | editor → pieces panel, wiring |
| `SEAM_EASE` | `pattern:seamEase` | `{text, warn}` or `null` | editor → statusbar |
| `BODY_PARAMS_DRAG` | `body:params:drag` | `{params:BodyParams}` | body panel → wiring (coarse rebake) |
| `BODY_BUILT` | `body:built` | `{model:BodyModel}` | wiring → body panel |
| `FABRIC_PREVIEW` | `fabric:preview` | `{fabricId, color?, texture?}` | fabric panel → viewer3d, editor (via wiring) |
| `SIM_SCALE_DRAG` | `sim:scale:drag` | `{bendScale, stretchScale}` | fabric panel → cloth (via wiring) |
| `SIM_STATS` | `sim:stats` | `SimStats` | loop → statusbar |
| `SIM_STATE` | `sim:state` | `{running}` | loop → toolbar, statusbar |
| `QUALITY` | `sim:quality` | `{text, level}` | wiring / loop → statusbar |

#### 11.12.3 `src/pattern/selftest.js`

`export async function runSelfTest() -> SelfTestResult[]`. Runs headless in the page or in a bare document: creates `canvas = document.createElement('canvas')` (800×600 CSS px, appended to a hidden `div` so `getBoundingClientRect` works), a fresh store from `src/core/store.js` loaded with `normalizeDoc({name:'selftest'})` (which yields the default fabric `main` and the default size chart), a fresh `EventBus`, and `createEditor(canvas, store, bus, {autoFit:false})`. Helper `clickWorld(x, y, mods)` = `injectPointer(down)` + `injectPointer(up)` at `view.worldToScreen(x, y)`. Every check returns `{name, pass, details}`; the suite never throws.

1. `view-roundtrip`: `view.set({cx:50, cy:50, pxPerMm:2})`; for `(0,0)`, `(100,100)`, `(−37.5, 12.25)`: `screenToWorld(worldToScreen(p))` within `1e-9` mm; `worldToScreen(50,50)` equals `(400, 300)`; `worldToScreen(100, 100)` equals `(500, 200)` (y flipped).
2. `view-zoom-anchor`: `zoomBy(2, 100, 100)` keeps `screenToWorld(100,100)` unchanged within `1e-9`; `set({pxPerMm: 100})` clamps to `20`.
3. `draw-square-ccw`: `setTool('draw')`; `clickWorld(0,0)`, `(100,0)`, `(100,100)`, `(0,100)`, then `clickWorld(0,0)` (closing on the first vertex) → `doc.pieces.length === 1`, 4 vertices equal to the clicked points in that order, `signedArea === 10000`, `edges` all `line`, `foldEdge === null`, `grainline.a[0] === 50`, `fabricId === doc.fabrics[0].id`, `getTool() === 'draw'`, selection = the new piece, `store.canUndo() === true`.
4. `draw-clockwise-fixed`: draw `(0,0)`, `(0,100)`, `(100,100)`, `(100,0)` + Enter (`editor.confirm()`) → vertices reversed to CCW (`signedArea === 10000`), `vertices[0]` equals `[0,0]`... (order after reversal: `[0,0],[100,0],[100,100],[0,100]`).
5. `draw-reject`: draw the bowtie `(0,0)`, `(100,100)`, `(100,0)`, `(0,100)` + Enter → no piece added, tool still placing; `editor.cancel()` returns true and clears.
6. `seam-api-reverse`: pieces A = square `(0..100)`, B = square `(120..220, 0..100)` via `addPiece`; `id = addSeam({pieceId:A, edge:1, mirror:false}, {pieceId:B, edge:3, mirror:false})` → `seam.b.reverse === true`, `seam.a.reverse === false`, `seam.kind === 'plain'`, `seamEase(doc, seam).easePct === 0`.
7. `seam-pointer`: fresh doc with the same A and B; `setTool('seam')`; `clickWorld(100, 50)` (A edge 1 midpoint) → transient `seamFirst` is `{pieceId:A, edge:1}`; `injectPointer(move)` over `(120, 50)` → last `EVENT.SEAM_EASE` text `'A 100 mm / B 100 mm - ease 0.0%'`; `clickWorld(120, 50)` → `doc.seams.length === 1`, `b.reverse === true`, selection.seamId set.
8. `seam-refusals`: `addSeam` with identical sides throws code `SEAM_SAME_EDGE`; a second seam on A edge 1 throws `SEAM_EDGE_TAKEN`; `mirror:true` on a piece without fold throws `SEAM_MIRROR_WITHOUT_FOLD`.
9. `ease-format`: rectangle A 100×312 (edge 1 = 312 mm) and rectangle B 100×328 → `formatEase(seamEaseOf(...))` equals `'A 312 mm / B 328 mm - ease 5.1%'`, `easePct` within `1e-9` of `5.128205128…`, `longer === 'b'`; `validateDoc` after `addSeam` contains no `SEAM_EASE_HIGH` (5.1 < 8); with B 100×340 (ease 9.0 %) it contains one `SEAM_EASE_HIGH` warn.
10. `split-remap`: square A with a notch `{edge:2, t:0.75}` and a seam on edge 3 with B; `opSplitEdge` via `setTool('split')` + `clickWorld(100, 50)` on edge 1 → 5 vertices, new vertex `[100,50]` at index 2, the notch now on edge 3 with `t` unchanged (0.75), the seam side now references edge 4, `store.canUndo()`; `undo()` restores 4 vertices and edge 3.
11. `split-notch-t`: notch `{edge:1, t:0.25}` then split edge 1 at `t = 0.5` → notch on edge 1 with `t = 0.5`; a notch at `t = 0.75` → edge 2, `t = 0.5`.
12. `edit-vertex-drag`: `setTool('edit')`; `injectPointer(down)` at vertex 2 of A, `move` to world `(130, 120)`, `up` → `vertices[2]` equals `[130,120]` (grid-snapped), label of the last update `vertex:move`; `nudge(1, 0)` → `[131,120]`.
13. `edit-toggle-cubic`: double-click on edge 0 midpoint → `edges[0].type === 'cubic'`, `c1 ≈ [33.333, 0]`, `c2 ≈ [66.667, 0]` (within 1e-6), `edgeLengthOf` unchanged within `1e-6`; double-click again → `line` without `c1/c2`.
14. `edit-insert-delete`: Alt-click on edge 0 at `t ≈ 0.5` → 5 vertices; `deleteSelection()` (the inserted vertex is selected) → 4 vertices again; on a triangle `deleteSelection()` is refused (3 vertices remain).
15. `fold-set`: square at `x ∈ [50, 150]`; select the piece and edge 3 (left, vertical) → `editor.mirror()` → all vertices `x ∈ [0, 100]`, `foldEdge === 3`, `edges[3].allowance_mm === 0`, `grade.anchorX === 'fold'`; `mirror()` again → `foldEdge === null`. Square at `x ∈ [−150, −50]` with edge 1 (right, vertical) selected → after `mirror()` the piece lies in `x ∈ [0, 100]`, `signedArea > 0`, `foldEdge === 0` (edge `n−1−1 = 2`? — no: `opReflectX` maps edge 1 to `n−1−1 = 2`; assert `foldEdge === 2` and that `vertices[2]` and `vertices[3]` have `x === 0`).
16. `hit-test`: with `pxPerMm = 2` and A selected: `hitTest` 5 px from vertex 1's screen position → `{kind:'vertex', index:1}`; on edge 1's midpoint offset 4 px outward → `{kind:'edge', index:1, t ≈ 0.5 ± 0.02}`; inside the piece → `kind:'piece'`; 30 px outside → `null`; for a fold piece the mirrored ghost edge reports `mirror:true`.
17. `validate`: bowtie piece (added with `partial` bypass through the store directly) → `PIECE_SELF_INTERSECTING`; fold edge with endpoint `x = 5` → `FOLD_EDGE_NOT_VERTICAL`; piece with `simulate:true` and no seams → `EDGES_UNSEWN` warn; `meshSpacing_mm = 50` → `MESH_SPACING_RANGE`.
18. `notch-tool`: `setTool('notch')`, `clickWorld(50, 0, {shift:true})` on edge 0 → notch `{edge:0, t ≈ 0.5, kind:'double'}`; `deleteSelection()` removes it.
19. `grainline-tool`: `setTool('grainline')`, drag from `(30, 20)` to `(30, 80)` inside A → `grainline` equals `{a:[30,20], b:[30,80]}`.
20. `select-move-undo`: `setTool('select')`, drag A from `(50,50)` to `(80, 70)` → all vertices translated by `(30, 20)`; `store.undo()` restores; `store.redo()` re-applies.
21. `render-smoke`: `renderNow()` on the T-shirt sample (`SAMPLES.tshirt` from `src/samples/index.js`, section 4.4) throws nothing and `ctx.getImageData` at the canvas centre is not the background colour after `fitToPieces()`.
22. `events`: during the whole run `tool:changed` fired once per `setTool` with a different name, and `selection:changed` never carried an id absent from the document.

The suite leaves the page store untouched (it uses its own store instance) and removes its hidden `div`.

---

**PROPOSED types.js amendment:** none. Selection, hover, tool state and view transform are editor-local (not part of `ProjectDoc`); every persisted UI value maps to an existing `UiState` field.
