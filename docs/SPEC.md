# Clothing App — v1 Specification (single source of truth)

Status: FROZEN after Phase 0. Reconciled 2026-09-12 (Phase-0 audit): consumer sections 10-14 now use the owner names of sections 3-8 and 11; `EVENT` gained `UI_ACTION` and `PATTERN_ISSUES` (3.2.2); the cheat sheet is `docs/CONTRACTS.md`. Only the lead edits this file and `src/core/`. Every implementation agent builds from this document; where code and this document disagree, the document wins and the code is fixed. Nothing in here is "TBD".

## 0. What we are building

A desktop-style, self-contained web application for designing clothing (in the spirit of Marvelous Designer / CLO 3D, but small):

* **View A — 3D physics view**: an XPBD cloth simulation (our own solver, typed arrays, main thread, Worker-ready) drapes the garment on a procedural parametric human body.
* **View B — 2D pattern view**: a canvas editor for pattern pieces (outlines with straight and cubic-bezier edges, seams, notches, grainlines, fold edges, seam allowance).
* Body presets and fully customisable morphology (20 parameters).
* Export: size chart (CSV/JSON), sewing patterns per size as 1:1 SVG and as tiled print pages (A4/Letter/A3, printed to PDF by the browser), with seam allowance, notches, grainline, fold labels.
* Fabric presets (cotton, denim, silk, jersey, wool, leather, chiffon) with matching physical parameters and rendered look; colour and procedural texture per fabric.
* Built-in samples (T-shirt, A-line skirt); project save/load as JSON; undo/redo.
* Full automation hook `window.__app` and an in-page acceptance suite.

**Hard environment constraints (verbatim, non-negotiable):**

* Windows 11 machine. Node.js/npm are NOT installed and must not be required. Python 3.14 exists and is used only to serve static files (`serve.py`, port 8710; `run.bat`). There is NO build step.
* Language: modern vanilla JavaScript ES modules (ES2022+) with JSDoc type annotations. No TypeScript, no bundler, no UI framework (no React/Vue/Svelte). Plain DOM + CSS.
* 3D rendering: three.js 0.180.0 loaded via an import map from `https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js` and `https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/` (mapped as `three/addons/`). WebGL2 baseline; WebGPU must NOT be assumed.
* Any other runtime dependency must be ES-module-loadable from cdn.jsdelivr.net and strongly justified; we implement small algorithms ourselves (triangulation, polygon offset, bezier sampling, SVG writing, CSV writing). **Decision: v1 has no dependency other than three.js.**
* The cloth solver is implemented by us (XPBD family), on the main thread with typed arrays, structured so it could move to a Web Worker later (`src/cloth/` imports nothing from `three` or the DOM).
* Verifiable by driving Chromium with automation: controls have stable ids / data-attributes; `window.__app` exposes state and imperative actions.
* v1 fully working by the end of the session, built by 8 parallel implementation agents after the shared contracts (Phase 0) are written.
* Real-world units: metres internally in 3D, millimetres in the 2D pattern space; body height 1.75 m default.

## 1. Conventions that every module obeys

| Topic | Rule |
|---|---|
| Pattern space | millimetres, **y up**, right-handed. Outlines are closed loops stored **CCW = positive signed area** (`signedArea > 0`). "Outward" normal of an edge direction `d` is `(d.y, -d.x)` (right-hand side of the direction of travel) — derived from the sign of the stored polygon's area, never from a named winding. SVG export flips y exactly once. |
| Body / size measurements | centimetres, keys suffixed `_cm` (`chest_cm`). Angles `_deg`. Unitless 0..1 blends have no suffix (`bustFullness`). Size-chart rows use the **same keys and unit** as body params, so "Fit body to size" is a plain copy. |
| Pattern scalars | mm, keys suffixed `_mm` (`seamAllowance_mm`, `meshSpacing_mm`, `offset_mm`). |
| 3D / solver | metres, **y up**, the model faces **+z** (toward the default camera), **+x is the model's LEFT** (the viewer's right when looking at the model's front). Gravity is -y. |
| Time | fixed `dt = 1/60 s` per frame, `substeps = 10` (`h = 1/600 s`); one Gauss-Seidel iteration per substep; no adaptive substepping (determinism). |
| Angles | radians in code; degrees only in JSON (`_deg`) and UI. |
| Ids | strings; `uid(prefix)` from `src/core/ids.js` returns `prefix + "_" + base36 counter + 4 random base36 chars`; sample ids are fixed (`front`, `back`, `sleeve_l`, `sleeve_r`). |
| Colours | `#rrggbb` strings in JSON; three.js `renderer.outputColorSpace = SRGBColorSpace`; `material.color.set(hex)`. |
| Numbers in JSON | plain numbers, never strings; the serialiser sorts object keys (`serializeDoc`) so round trips are byte-identical. |
| Errors | modules throw `Error` with a `code` property (`RemeshError`, `ValidationError`); the wiring layer catches, shows a status-bar warning and keeps the app alive; the app never leaves a blank screen. |
| Allocation | no allocation inside per-frame loops (solver, renderer upload, spatial hash). |
| DOM | only `src/pattern/`, `src/viewer3d/`, `src/ui/`, `src/app/`, `src/popout/` touch the DOM. `src/cloth/`, `src/geometry/`, `src/body/` (except `body/mesh.js`, which builds three.js geometry), `src/sizing/`, `src/export/` are pure. |

## 2. File layout and ownership

```
index.html                 app shell: import map, all element ids (section 11), loads src/app/main.js   [Lead, Phase 0]
popout.html                optional pop-out 3D window, loads src/popout/main.js                          [A5]
serve.py, run.bat          static server (already exist)                                                 [Lead]
styles/shell.css           grid layout skeleton: pane/dock/status geometry only (frozen)                 [Lead, Phase 0]
styles/app.css             all other styling                                                             [A7]
docs/SPEC.md               this document                                                                 [Lead]
src/core/                  SHARED CONTRACTS — frozen after Phase 0                                       [Lead]
  types.js                 every JSDoc typedef (section 3.1) — paste verbatim
  events.js                EventBus + EVENT name constants (section 3.2)
  store.js                 document holder, update/undo/redo, subscribe (section 3.3)
  schema.js                normalizeDoc (defaults), serializeDoc (sorted keys), validateShape
  units.js                 MM_PER_M, mmToM, mToMm, cmToM, mToCm, cmToMm, mmToCm, fmtMm, fmtCm, PAPER
  ids.js                   uid(prefix), hashString(s) -> uint32
  fabrics.js               FABRIC_PRESETS (section 9.1), resolveFabric(instance), TEXTURE_KINDS, DEFAULT_TEXTURE
  sdf.js                   SdfGrid helpers: sampleSdf, makeSphereGrid (test field), gridIndex, gridContains
src/samples/               pure data (section 4.4): tshirt.js, skirt.js, index.js                        [Lead, Phase 0]
src/geometry/              2D math: bezier.js polygon.js mirror.js prng.js delaunay.js remesh.js
                           offset.js pack.js index.js selftest.js                                        [A1]
src/pattern/               2D editor: editor.js view.js hit.js render2d.js validate.js seams.js
                           tools/{select,draw,edit,split,seam,notch,grainline,measure}.js index.js selftest.js  [A2]
src/body/                  params.js presets.js skeleton.js primitives.js loft.js bake.js measure.js
                           anchors.js mesh.js index.js selftest.js                                       [A3]
src/cloth/                 state.js arrange.js solver.js constraints.js collide.js selfcollide.js
                           hash.js safety.js stats.js testfields.js fixtures.js index.js selftest.js     [A4]
src/viewer3d/              scene.js clothMesh.js bodyMesh.js materials.js textures.js loop.js
                           anchorsGizmo.js index.js selftest.js  + popout.html, src/popout/main.js       [A5]
src/sizing/                chart.js grading.js index.js selftest.js                                      [A6]
src/export/                svg.js sheet.js print.js csv.js download.js index.js selftest.js              [A6]
src/ui/                    layout.js toolbar.js dock.js statusbar.js shortcuts.js ids.js (REQUIRED_IDS)
                           panels/{pieces,body,fabric,sizes}.js index.js selftest.js                     [A7]
src/app/                   main.js wiring.js debugApi.js                                                 [A8]
tests/acceptance.js        in-page acceptance suite (section 13), imported lazily by debugApi            [A8]
```

**Dependency rules (imports only along the arrows; no cycles; violations are contract bugs):**

```
samples   -> (nothing; pure data literals)
geometry  -> core
pattern   -> core, geometry
body      -> core, geometry          (body/mesh.js is the only body file importing three)
cloth     -> core                    (core/sdf.js, core/fabrics.js, core/types.js only; NEVER three or DOM)
viewer3d  -> core, three, three/addons  (reads ClothState / BodyModel / FabricResolved by shape only)
sizing    -> core, geometry
export    -> core, geometry, sizing
ui        -> core + every module's public index.js
app       -> everything
popout    -> core, viewer3d
```

Cross-module communication at runtime goes through the store (state) and the bus (events); `src/app/wiring.js` is the **only** file that calls one module's API in reaction to another module's event.

## 3. Shared contracts (`src/core/`)

### 3.1 `src/core/types.js` — paste verbatim

```js
// src/core/types.js — SHARED CONTRACTS. Frozen after Phase 0; only the lead edits this file.
// Units: pattern = mm, y up. Body/sizes = cm (_cm keys). 3D/solver = metres, y up, model faces +z, +x = model's LEFT.
export {};

/** @typedef {[number, number]} Vec2  point/vector in mm (pattern space) */
/** @typedef {[number, number, number]} Vec3  point/vector in metres (3D) */

/**
 * Outline edge i runs from Piece.vertices[i] to Piece.vertices[(i + 1) % n].
 * @typedef {Object} Edge
 * @property {'line'|'cubic'} type
 * @property {Vec2} [c1]   first cubic control point, absolute mm (required when type === 'cubic')
 * @property {Vec2} [c2]   second cubic control point, absolute mm (required when type === 'cubic')
 * @property {number} [allowance_mm]  seam allowance for this edge; default Piece.seamAllowance_mm; forced to 0 on the fold edge
 * @property {string} [label]  'hem' | 'side' | 'neck' | free text; shown in the editor and in the export label block
 */

/**
 * @typedef {Object} Notch
 * @property {number} edge   outline edge index
 * @property {number} t      arc-length fraction along the edge, strictly inside (0, 1)
 * @property {'single'|'double'} kind
 */

/**
 * @typedef {Object} Grainline
 * @property {Vec2} a  start (mm)
 * @property {Vec2} b  end (mm); the arrow points a -> b
 */

/**
 * @typedef {Object} InternalLine
 * @property {'fold'|'dart'|'mark'} kind
 * @property {Vec2[]} points  polyline in mm; drawn in the editor and exported; NOT simulated
 */

/**
 * Initial 3D placement of a piece (SPEC section 7.4).
 * @typedef {Object} Placement
 * @property {'torso'|'armL'|'armR'|'legL'|'legR'|'skirt'|'head'} anchor
 * @property {'front'|'back'|'left'|'right'} side   angle around the anchor axis where the piece centre sits
 * @property {Vec2} offset_mm   [dx, dy]; dx = arc shift around the cylinder, dy = shift along the axis (positive = up, toward the anchor origin)
 * @property {number} wrap      0..1; 1 = wrapped on the cylinder, 0 = flat on the tangent plane
 * @property {boolean} flip     mirror the piece's local x before mapping
 */

/**
 * @typedef {Object} GradeRule
 * @property {number} vertex   vertex index in Piece.vertices
 * @property {number} dx_mm    added per size step: delta = (sizeIndex - baseIndex) * dx_mm
 * @property {number} dy_mm
 */

/**
 * @typedef {Object} Grading
 * @property {string|null} widthRef    size-chart key driving x scaling ('chest_cm', 'hips_cm', ...) or null (no x scaling)
 * @property {string|null} lengthRef   size-chart key driving y scaling ('height_cm', 'torsoLength_cm', ...) or null
 * @property {'fold'|'center'|'left'|'right'} anchorX   x pivot; 'fold' = x of vertices[foldEdge] (falls back to 'center' when foldEdge is null)
 * @property {'top'|'center'|'bottom'} anchorY
 * @property {GradeRule[]} vertexRules
 */

/**
 * @typedef {Object} Piece
 * @property {string} id
 * @property {string} name
 * @property {Vec2[]} vertices        closed loop, CCW (signedArea > 0), simple (no self-intersection), length >= 3
 * @property {Edge[]} edges           edges.length === vertices.length
 * @property {number|null} foldEdge   index of a straight edge lying on the fold line; the stored half is mirrored across it at mesh time and exported as the half with 'PLACE ON FOLD'
 * @property {Notch[]} notches
 * @property {Grainline} grainline
 * @property {InternalLine[]} internalLines
 * @property {number} seamAllowance_mm   default allowance for edges without allowance_mm
 * @property {string} fabricId           id of a FabricInstance in ProjectDoc.fabrics
 * @property {number} layer              0 = innermost; each layer adds 3 mm collision clearance and 20 mm arrangement radius
 * @property {number} cutQty             label only ('CUT 2'); the simulation only uses pieces actually listed
 * @property {boolean} exportHidden      true for a mirrored duplicate already covered by another piece's cutQty
 * @property {boolean} simulate          false = export-only piece (waistband, facing)
 * @property {number[]} pinnedEdges      outline edge indices whose mesh vertices are pinned to the body surface after arrangement
 * @property {Placement} placement
 * @property {Grading} grade
 * @property {number} meshSpacing_mm     target triangle edge length, 8..40 (default 15)
 */

/**
 * One side of a seam. Vertices along an edge are always listed from the edge's start vertex to its end vertex,
 * for the original copy and for the mirrored copy alike.
 * @typedef {Object} SeamSide
 * @property {string} pieceId
 * @property {number} edge       single outline edge index (never the fold edge). Use the Split Edge tool for partial seams.
 * @property {boolean} mirror    true = the mirrored copy of a fold piece's edge; must be false when the piece has no foldEdge
 * @property {boolean} reverse   pairing: vertex i of side a pairs with vertex (reverse ? N - i : i) of side b (N + 1 vertices per side)
 */

/**
 * @typedef {Object} Seam
 * @property {string} id
 * @property {SeamSide} a
 * @property {SeamSide} b
 * @property {'plain'} kind
 */

/**
 * Physical fabric parameters (SPEC section 9.1). Compliances are derived at build time, never stored.
 * @typedef {Object} FabricPhysics
 * @property {number} density_kgm2     areal density
 * @property {number} bend_Nm          bending rigidity B (Kawabata), N*m
 * @property {number} membrane_Nm      in-plane (tensile) stiffness Y, N/m
 * @property {number} friction         Coulomb coefficient vs body and vs self, 0..1
 * @property {number} damping          viscous damping, 1/s
 * @property {number} thickness_mm
 * @property {number} meshSpacing_mm   recommended mesh spacing for this fabric
 */

/**
 * @typedef {Object} FabricLook
 * @property {string} color            '#rrggbb'
 * @property {number} roughness
 * @property {number} sheen            0..1
 * @property {number} sheenRoughness
 * @property {number} clearcoat
 * @property {number} opacity          1 = opaque
 * @property {{kind:'solid'|'stripes'|'gingham'|'dots'|'twill'|'knit', scale_mm:number, color2:string}} texture
 */

/** @typedef {{id:string, name:string, physics:FabricPhysics, look:FabricLook}} FabricPreset */

/**
 * A fabric as used by a project (references a preset, overrides some fields).
 * @typedef {Object} FabricInstance
 * @property {string} id        e.g. 'main'
 * @property {string} name
 * @property {string} preset    FabricPreset id
 * @property {string} color     '#rrggbb' (overrides preset look.color)
 * @property {{kind:'solid'|'stripes'|'gingham'|'dots'|'twill'|'knit', scale_mm:number, color2:string}} texture
 * @property {Partial<FabricPhysics>} overrides
 */

/** @typedef {{id:string, name:string, physics:FabricPhysics, look:FabricLook}} FabricResolved */

/**
 * All lengths cm, angles degrees, bustFullness unitless 0..1. Defaults/ranges/presets: SPEC section 6.1.
 * @typedef {Object} BodyParams
 * @property {number} height_cm
 * @property {number} chest_cm
 * @property {number} underbust_cm
 * @property {number} waist_cm
 * @property {number} hips_cm
 * @property {number} shoulderWidth_cm   biacromial width
 * @property {number} neck_cm
 * @property {number} upperArm_cm
 * @property {number} forearm_cm
 * @property {number} wrist_cm
 * @property {number} thigh_cm
 * @property {number} calf_cm
 * @property {number} ankle_cm
 * @property {number} armLength_cm       shoulder joint to wrist
 * @property {number} inseam_cm          floor to crotch
 * @property {number} torsoLength_cm     neck base to waist (back length)
 * @property {number} headHeight_cm
 * @property {number} bustFullness       0..1
 * @property {number} armAbduction_deg   A-pose angle of the upper arm from vertical
 * @property {number} legSpread_deg
 */

/** @typedef {{name:string} & Record<string, number|string>} SizeRow  measurement keys as in BodyParams, values cm */

/**
 * @typedef {Object} SizeChart
 * @property {string[]} measurements   ordered keys, e.g. ['chest_cm','waist_cm','hips_cm','height_cm','torsoLength_cm','armLength_cm']
 * @property {string} baseSize         row name the pattern is drafted for
 * @property {SizeRow[]} rows          ordered S..XL
 */

/**
 * @typedef {Object} SimSettings
 * @property {number} substeps            10
 * @property {number} gravity_ms2         9.81
 * @property {boolean} selfCollision      true
 * @property {number} sewTime_s           1.0
 * @property {number} collisionOffset_mm  5
 * @property {number} bendScale           multiplies bend_Nm for all fabrics (default 1)
 * @property {number} stretchScale        multiplies membrane_Nm for all fabrics (default 1)
 */

/**
 * @typedef {Object} UiState
 * @property {number} split                0..1 fraction of the main area given to the left pane
 * @property {'split'|'2d'|'3d'} layout
 * @property {boolean} swapped             true = 3D pane on the left
 * @property {string} activeSize
 * @property {'pieces'|'body'|'fabric'|'sizes'} dockTab
 */

/**
 * @typedef {Object} ProjectDoc
 * @property {number} version              1
 * @property {string} name
 * @property {{preset:string, params:BodyParams}} body
 * @property {FabricInstance[]} fabrics
 * @property {Piece[]} pieces
 * @property {Seam[]} seams
 * @property {SizeChart} sizes
 * @property {SimSettings} sim
 * @property {UiState} ui
 */

/** @typedef {{level:'error'|'warn', code:string, message:string, pieceId?:string, seamId?:string, edge?:number}} Issue */

/**
 * Triangulated piece for simulation. Coordinates are the FULL outline (fold pieces already mirrored).
 * @typedef {Object} PieceMesh
 * @property {string} pieceId
 * @property {number} vertexCount
 * @property {Float32Array} positions2d   2*V, mm
 * @property {Uint32Array} triangles      3*T, each CCW in 2D
 * @property {Uint32Array} edges          2*E unique undirected edges, i < j
 * @property {Uint32Array} bendPairs      4*B, one per interior edge: [v0, v1 (shared edge), v2 (opposite in tri A), v3 (opposite in tri B)]
 * @property {Uint32Array} boundary       closed CCW loop of boundary vertex ids
 * @property {Uint32Array[][]} edgeVerts  edgeVerts[mirror][edgeIndex]: ordered vertex ids from the edge start vertex to its end vertex; edgeVerts[1] = [] for non-fold pieces; edgeVerts[*][foldEdge] = empty Uint32Array
 * @property {Uint32Array[]} notchVerts   notchVerts[mirror][k] = vertex id at Piece.notches[k] (forced boundary sample)
 * @property {number} area_mm2
 * @property {{minAngleDeg:number, pctAbove20:number, medianEdge_mm:number, triangles:number}} quality
 * @property {string[]} warnings
 */

/**
 * Uniform signed-distance grid, metres. data[i + nx*(j + ny*k)] = distance at origin + cell*[i,j,k]. Negative inside the body.
 * @typedef {Object} SdfGrid
 * @property {Vec3} origin
 * @property {number} cell
 * @property {number} nx
 * @property {number} ny
 * @property {number} nz
 * @property {Float32Array} data
 */

/**
 * Arrangement cylinder attached to the body.
 * @typedef {Object} Anchor
 * @property {Vec3} origin   top of the cylinder (where a piece's top edge lands at dy = 0)
 * @property {Vec3} axis     unit vector pointing DOWN the cylinder (direction of increasing piece depth)
 * @property {Vec3} front    unit vector perpendicular to axis; direction of side 'front' (theta = 0)
 * @property {number} radius metres, already includes the base clearance
 * @property {number} length usable length along axis, metres
 */

/**
 * @typedef {Object} BodyModel
 * @property {BodyParams} params
 * @property {Record<string, Vec3>} landmarks    headTop, chin, neckBase, shoulderL, shoulderR, elbowL, elbowR, wristL, wristR, chestCenter, waistCenter, hipCenter, crotch, hipJointL, hipJointR, kneeL, kneeR, ankleL, ankleR
 * @property {Record<string, Anchor>} anchors    torso, armL, armR, legL, legR, skirt, head
 * @property {Record<string, {y:number, a:number, b:number, n:number, cz:number}>} rings   crotch, hip, waist, underbust, chest, armpit, shoulder, neckBase
 * @property {SdfGrid} sdf
 * @property {{positions:Float32Array, normals:Float32Array, indices:Uint32Array}} geometry  render mesh, metres
 * @property {{chest_cm:number, waist_cm:number, hips_cm:number}} measured   ray-cast from the baked SDF
 * @property {number} buildMs
 */

/**
 * @typedef {Object} SimParams
 * @property {number} dt          1/60
 * @property {number} substeps    10
 * @property {number} gravity     9.81
 * @property {number} sewTime     seconds
 * @property {boolean} selfCollision
 * @property {number} selfDist    metres, vertex-vertex separation for self-collision
 * @property {number} maxSpeed    5 m/s
 * @property {number} maxStep     metres per substep = min(0.5 * meshSpacing, 0.008)
 * @property {number} bendScale
 * @property {number} stretchScale
 */

/**
 * Solver state — flat typed arrays, no DOM/three references (Worker-transferable).
 * @typedef {Object} ClothState
 * @property {number} V
 * @property {Float32Array} pos        3V metres
 * @property {Float32Array} prev       3V
 * @property {Float32Array} vel        3V
 * @property {Float32Array} invMass    V (0 = pinned)
 * @property {Float32Array} restPos    3V arranged positions (reset target)
 * @property {Uint16Array} pieceOf     V index into pieces[]
 * @property {Float32Array} clearance  V metres: collisionOffset + thickness/2 + 0.003 * layer
 * @property {Float32Array} mu         V friction coefficient
 * @property {Float32Array} damp       V damping 1/s
 * @property {Float32Array} dCache     V last sampled body distance (for CCD-lite and stats)
 * @property {Uint32Array} tris        3T (global vertex ids)
 * @property {Uint32Array} eIdx        2E
 * @property {Float32Array} eRest      E metres
 * @property {Float32Array} eAlpha     E compliance m/N (already includes stretchScale)
 * @property {Uint32Array} bIdx        4B
 * @property {Float32Array} bK         4B Bergou K vector per constraint
 * @property {Float32Array} bS         B  sqrt(3 / (A0 + A1)), 1/m
 * @property {Float32Array} bAlpha     B  compliance 1/(N*m) (already includes bendScale)
 * @property {Uint32Array} sIdx        2S seam pairs
 * @property {Float32Array} sRest0     S  pair distance at reset time, metres
 * @property {Float32Array} sStart     S  sim time (s) when the pair starts closing
 * @property {Uint32Array} pIdx        P  pinned vertex ids
 * @property {Float32Array} pTarget    3P
 * @property {Uint32Array} exclStart   V+1 CSR offsets of self-collision exclusion lists
 * @property {Uint32Array} exclList    sorted vertex ids excluded from self-collision per vertex
 * @property {{start:number, count:number, pieceId:string, mesh:PieceMesh, fabric:FabricResolved, layer:number}[]} pieces
 * @property {SimParams} params
 * @property {number} time
 * @property {number} frame
 * @property {number} nanCount
 */

/**
 * @typedef {Object} SimStats
 * @property {number} frame
 * @property {number} time
 * @property {number} ms                  last frame solver time
 * @property {number} msAvg               moving average over the last 60 frames
 * @property {number} verts
 * @property {number} tris
 * @property {number} constraints         E + B + S
 * @property {number} maxSpeed            m/s
 * @property {number} maxPenetration_mm   max over vertices of (clearance - d), clamped >= 0
 * @property {number} seamGapMax_mm
 * @property {number} seamGapMean_mm
 * @property {number} nanCount
 * @property {boolean} running
 * @property {number} substeps
 * @property {{integrate:number, distance:number, bend:number, seam:number, collide:number, self:number}} sectionMs
 */

/** @typedef {{name:string, pass:boolean, details:string}} SelfTestResult */
```

---

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
  PATTERN_ISSUES:     'pattern:issues',
  // body (emitted by src/ui/panels/body.js and src/app/wiring.js)
  BODY_PARAMS_DRAG:   'body:params:drag',
  BODY_PARAMS_COMMIT: 'body:params:commit',
  BODY_BUILT:         'body:built',
  // mesh (emitted by src/app/wiring.js)
  MESH_BUILT:         'mesh:built',
  // cloth (emitted by src/app/wiring.js; the viewer never touches the bus, section 8)
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
  UI_ACTION:          'ui:action',
  // pop-out (emitted by src/app/wiring.js from the bridge's onOpened/onClosed callbacks, section 8.8)
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

/**
 * Every toolbar button, shortcut and panel intent (tables in 11.1.2 and 11.7). Only src/app/wiring.js listens.
 * @typedef {{action:string, [k:string]:any}} UiAction
 */

/** Result of pattern/validate.js validateDoc after a doc change (coalesced to one animation frame). @typedef {{issues: import('./types.js').Issue[]}} PatternIssues */

/** @typedef {{at:number}} PopoutOpen */
/** @typedef {{reason:'user'|'unload'|'timeout'|'blocked', at:number}} PopoutClose  blocked = window.open returned null (popup blocker) */

/** @typedef {{version:string, ms:number, sample:string}} AppReady  ms since module evaluation started; sample = id of the sample drawn ('tshirt') */
```

#### 3.2.3 Emitters, listeners and the wiring rule

`src/app/wiring.js` is the **only** file that calls one module's API in reaction to another module's event. Every other listener is confined to updating the listener's own module (a panel re-rendering itself, the status bar showing text, the 2D canvas repainting). The table is normative; an emitter or listener not listed here is a contract bug.

| Event | Emitted by | When | Frequency | Listeners allowed |
|---|---|---|---|---|
| `doc:changed` | `core/store.js` | after every accepted update, batch step/commit/cancel, undo, redo, replace | per edit; up to 60 Hz during drags (origin `'drag'`) | wiring.js (remesh / rebuild body / rebuild sim / fabric resolve / size derive, all gated on hints and origin), `pattern/editor.js` (repaint), every `ui/panels/*.js` and `ui/toolbar.js` (re-render, undo/redo button state), `app/debugApi.js` (log) |
| `selection:changed` | `pattern/editor.js` | selection set/cleared by any tool, by `pieces` panel clicks (`ui:action selectPiece` → wiring → `editor.select`), by debugApi | per interaction | `ui/panels/pieces.js`, `ui/statusbar.js`, `viewer3d/anchorsGizmo.js` via wiring.js (show anchor cylinder of the selected piece) |
| `tool:changed` | `pattern/editor.js` | `setTool` (toolbar, shortcut, debugApi, Esc) | per interaction | `ui/toolbar.js`, `ui/statusbar.js` (tool hint) |
| `hover:changed` | `pattern/editor.js` | pointer move over the 2D canvas, throttled to rAF | ≤ 60 Hz | `ui/statusbar.js` (cursor mm) |
| `seam:preview` | `pattern/tools/seam.js` | first click, second click (after store write), cancel | per interaction | `ui/statusbar.js` (ease readout), `ui/panels/pieces.js` (seam list highlight) |
| `view2d:changed` | `pattern/view.js` (through the editor's `onChange`) | pan/zoom/resize of the 2D canvas | ≤ 60 Hz | `ui/statusbar.js` (zoom %), debugApi `pattern.mmToPx` cache |
| `pattern:issues` | `pattern/editor.js` | after `validateDoc` ran for a doc change (coalesced to one rAF) | per non-drag doc change | `ui/panels/pieces.js` (issues list), `ui/statusbar.js` (`n issues`), wiring.js (pieces/seams with error issues are excluded from meshing) |
| `body:params:drag` | `ui/panels/body.js` | each `input` event of a param slider while the pointer is down; the store is not written | ≤ 60 Hz | wiring.js only (debounce 150 ms → coarse `buildBody` → `body:built` quality `'coarse'`) |
| `body:params:commit` | `ui/panels/body.js` | pointer-up / `change` of a slider or numeric field, preset selection — emitted after `store.update` | per interaction | `ui/statusbar.js` ("Body rebuilt"), `ui/panels/body.js` (measured readout refresh); wiring.js does NOT rebuild on it — the full rebuild is driven by `doc:changed` with `body` hint |
| `body:built` | `app/wiring.js` | after `buildBody()` returned (coarse or full) | per rebuild | `viewer3d/index.js` via wiring.js (`setBody`), cloth grid swap via wiring.js, `ui/panels/body.js` (measured vs target readout), `ui/statusbar.js` |
| `mesh:built` | `app/wiring.js` | after remeshing the pieces affected by a `doc:changed` (or all on replace) | per non-drag doc change touching pieces/seams | wiring.js (→ build sim), `ui/panels/pieces.js` (vertex counts, warnings), `ui/statusbar.js` |
| `sim:built` | `app/wiring.js` | after `cloth.buildState()` and arrangement | per mesh/body rebuild | `viewer3d/index.js` via wiring.js (`setCloth`), `ui/statusbar.js`, `ui/toolbar.js` (enable play) |
| `sim:stats` | `app/wiring.js` (inside the loop `tick`) | once per rendered frame after `step()`; once at the end of `debugApi.sim.step(n)` | 60 Hz | `ui/statusbar.js` (DOM update throttled to 4 Hz), `app/debugApi.js` (last stats), pop-out bridge (forward at ≤ 10 Hz) |
| `sim:phase` | `app/wiring.js` | play/pause/reset and the automatic sewing→draping transition | per transition | `ui/toolbar.js` (play button state), `ui/statusbar.js` |
| `sim:nan` | `app/wiring.js` (compares `stats.nanCount` between frames; cloth is pure) | the NaN guard fired during a frame | rare | `ui/statusbar.js` (error text), `app/debugApi.js` (counter) |
| `fabric:changed` | `app/wiring.js` | after a `doc:changed` with a `fabrics` hint, once per affected fabric id, or after a piece's `fabricId` changed | per edit | wiring.js (viewer `setMaterial`, cloth `setFabric` in place), `ui/panels/fabric.js`, `pattern/editor.js` (piece fill colour) |
| `size:active` | `app/wiring.js` | after a `doc:changed` where `doc.ui.activeSize` differs from the last value wiring saw (covers undo/replace) | per change | `pattern/editor.js` (graded preview outline), `ui/panels/sizes.js`, `ui/toolbar.js` (size dropdown), `ui/statusbar.js` |
| `ui:layout` | `ui/layout.js` | after the DOM was updated for a layout/swap/split change, and when the pop-out opens/closes | per interaction | `pattern/view.js` and `viewer3d/scene.js` (both also use ResizeObserver; this event is for "frame all" on layout switches), `ui/toolbar.js` |
| `ui:dock` | `ui/dock.js` | dock tab switched (click, shortcut F1–F4, debugApi) — after `store.update` of `ui.dockTab` | per interaction | `ui/panels/*.js` (lazy first render) |
| `ui:status` | any DOM-touching module, wiring.js (for caught module errors), the bus itself | as needed | as needed | `ui/statusbar.js`, `app/debugApi.js` (`__app.log`, last 200 entries) |
| `ui:action` | `ui/toolbar.js`, `ui/shortcuts.js`, `ui/panels/*.js` | a button click, shortcut or panel intent (`{action, ...}` tables in 11.1.2 / 11.7) | per interaction | wiring.js only (dispatches to the module APIs) |
| `popout:open` | `app/wiring.js` (bridge `onOpened` callback) | the pop-out window answered `hello` | rare | wiring.js (switch layout to `'2d'`, pause the in-page loop), `ui/toolbar.js` |
| `popout:close` | `app/wiring.js` (bridge `onClosed` callback / `open()` returned false) | `closed` message, `beforeunload`, 3 s heartbeat timeout, or `window.open` returned null | rare | wiring.js (restore layout, resume loop), `ui/toolbar.js`, `ui/statusbar.js` |
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
 * Owned by src/pattern/editor.js (tool, selection, hover, seamPick) and src/app/wiring.js (running, phase, popoutId).
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

---

## 4. Built-in sample garments (`src/samples/`)

> **Amendment (lead, 2026-09-14) — sample T-shirt neck and shoulder.** Two drafting faults made the garment
> unwearable on the default body, and no solver setting could compensate for either.
> (a) The neckline opening was 374 mm while the body's neck-base ring, where that neckline rests (y = 1.410 m on
> `female_m`), measures 459 mm — the shirt could only go on by stretching the fabric ~23%, which showed up as 124% edge
> strain at the neckline corners.
> (b) The shoulder seam must lie along the body from the neck-base edge to the acromion, about 128 mm; widening the
> neckline by moving the neck point outboard shortens that seam and simply moves the strain from the neck to the
> shoulder (at neck point x = 112 the seam fell to 93 mm and peak strain rose to 150%).
> Both are satisfied by keeping the neck point near the original x and gaining the opening from DEPTH instead: the neck
> point is `[75, 590]` on front and back (shoulder seam 130.0 mm on each, still exactly matched), the centre-front neck
> drops from `y = 510` to `430` and the centre-back from `570` to `545`, with the neck curve control points re-fitted.
> The opening is now 535 mm (17% ease over the ring). Peak strain fell 124% -> 70% and edges above 10% strain fell from
> 485 to 148 of 10 564. Seam parity is untouched (0 of 10 records mismatch by more than 3%); every piece stays CCW and
> simple.
> Rule for any new sample garment: check each OPENING (neck, armhole, hem, waist) against the body ring it rests on,
> AND each seam against the body distance it must span — not just seam-partner lengths against each other.
## 4.1 Authoring rules

All rules are mandatory for the two shipped samples and are the reference for any future sample.

1. **Draft target.** Every sample is drafted for body preset `female_m` (section 6.1; values repeated in 4.4) at size `M` of the default size chart, with wearing ease: T-shirt chest = 88 + 8 = 96 cm, sleeve bicep = 27 + 7 = 34 cm; skirt top edge = hips 96 + 4 = 100 cm. `doc.body.preset === 'female_m'`, `doc.body.params` equals the preset, `doc.sizes.baseSize === 'M'`, row `M` equals the preset for its six keys.
2. **Units and frame.** Pattern coordinates in mm, y up, integers or at most one decimal. Fold pieces have their hem at `y = 0` and the centre line on `x = 0`; sleeves are centred on `x = 0`.
3. **Outline.** `Piece.vertices` is a closed simple loop, CCW (`signedArea > 0` for the polygon of vertices and for the curve-sampled outline), `vertices.length >= 3`, `edges.length === vertices.length`, edge `i` runs `vertices[i] -> vertices[(i+1) % n]`.
4. **Fold pieces.** Stored as the `x >= 0` half only. `foldEdge` indexes a `'line'` edge whose two endpoints have `x === 0`; every vertex and every cubic control point of the piece has `x >= 0`. The fold edge carries `allowance_mm: 0` and `label: 'fold'`. Mesh time mirrors the half across `x = 0` (full outline, the fold line becomes interior); export prints the half with `PLACE ON FOLD` (export section). Never reference a fold edge from a seam or a notch.
5. **Cubic edges.** `type: 'cubic'` with **absolute** control points `c1`, `c2` (mm). Where a curve meets the fold line the last control point is horizontal (`c2.y === end.y`) so the mirrored curve is C1-continuous across the fold; where two cubic halves meet at a piece apex (sleeve cap) both tangents are horizontal.
6. **Per-edge allowance and labels** (grafted from the patternmaking design): `Piece.seamAllowance_mm = 10` and every edge sets `allowance_mm` explicitly:

   | edge role | `allowance_mm` | `label` |
   |---|---|---|
   | hem (T-shirt body, sleeve, skirt) | 25 | `'hem'` |
   | neckline | 6 | `'neck'` |
   | side, shoulder, armhole, sleeve cap, sleeve underarm, skirt waist | 10 | `'side'`, `'shoulder'`, `'armhole'`, `'cap front'`, `'cap back'`, `'underarm'`, `'waist'` |
   | fold edge | 0 | `'fold'` |

7. **Notches.** `t` strictly inside `(0, 1)`, measured as arc-length fraction from the edge start. Convention: front armhole / front sleeve cap / skirt front side = `'single'`; back armhole / back sleeve cap / skirt back side = `'double'`. Notches on seam partners sit at the same `t` so they meet after sewing.
8. **Grainline.** `a -> b` vertical (`a.x === b.x`, `b.y > a.y`, arrow points up), both endpoints strictly inside the stored outline.
9. **Placement** (`Piece.placement`, semantics in section 7.4). Torso pieces: `anchor 'torso'`, `wrap 0.8`, `offset_mm [0, 0]`; sleeves: `anchor 'armL'/'armR'`, `wrap 1`, `offset_mm [0, 20]`; skirt panels: `anchor 'skirt'`, `wrap 0.8`. `flip` is `true` only on `sleeve_r`. Back panels use `side 'back'` with `flip false` (symmetric pieces need no flip; see the pairing tables for which mirror copy lands on which side of the body).
10. **Requirements the samples place on section 7.4** (the seam records in 4.2 are correct only under these; the lead reconciles 7.4 with them):
    * (a) `side 'front'` is the `+z` half-space, `'back'` is `-z`, `'left'` is `+x` (the model's left), `'right'` is `-x`, for every anchor.
    * (b) **Outside view:** with `flip === false` a piece is arranged as seen from outside the body: pattern `+x` maps to the 3D direction `f x (0,1,0)` where `f` is the unit vector from the piece centre toward the anchor axis. Concretely: torso/front -> `+x`; torso/back -> `-x`; armL/left -> `-z`; armR/right -> `+z`; skirt/front -> `+x`; skirt/back -> `-x`. `flip === true` negates pattern x before this mapping (types.js).
    * (c) `offset_mm[1] === 0` places the top of the piece's **full** outline (max y after mirroring) at `Anchor.origin`; the `'torso'` origin is at the neck-base level, the `'skirt'` origin at the waist level, `'armL'/'armR'` origins at the shoulder joints (section 6.1 landmarks).
11. **Grading** (`Piece.grade`): torso pieces `widthRef 'chest_cm'`, `lengthRef 'torsoLength_cm'`, `anchorX 'fold'`, `anchorY 'top'`; sleeves `widthRef 'chest_cm'`, `lengthRef 'armLength_cm'`, `anchorX 'center'`, `anchorY 'top'`; skirt panels `widthRef 'hips_cm'`, `lengthRef 'height_cm'`, `anchorX 'fold'`, `anchorY 'top'`. Seam partners share identical `vertexRules` on paired vertices so graded seam lengths stay matched (verified in 4.2/4.3 for S, M, L, XL).
12. **Simulation defaults.** `meshSpacing_mm 15`, `layer 0`, `simulate true`, `pinnedEdges []` except the skirt waist edge, `fabricId 'main'` (one fabric per sample).
13. **Ids.** Fixed strings (section 1): pieces `front`, `back`, `sleeve_l`, `sleeve_r`; seam ids as listed in the tables; `L`/`R` in an id always means the **model's** left/right (3D `+x` / `-x`).
14. **Seam records vs garment seams.** `SeamSide.edge` is a single outline edge (types.js; no chains), so a garment seam that runs across two pieces on one side needs one `Seam` record per piece it touches. The T-shirt has **8 garment seams** (2 shoulder, 2 side, 2 sleeve underarm, 2 sleeve-cap-to-armhole) encoded as **10 `Seam` records** (each sleeve cap is sewn to the front armhole and to the back armhole by two records). `TSHIRT.seams.length === 10`, `SKIRT.seams.length === 2`. Section 13 must assert these numbers.
15. **Seam direction rule.** For each record, `reverse` is `false` when both edges run the same physical way along the seam (start vertex meets start vertex) and `true` when they run opposite ways; `mirror` selects the mirrored copy of a fold piece's edge. The "runs from -> to" columns in the tables below are the proof for every record.
16. **Verification before fan-out.** The lead checks every rule above and the seam-length tables with the Python procedure of 4.5 (cubic arc length = sum of 200 chords) and the acceptance suite re-asserts them at runtime.

### 4.2 T-shirt (`id: 'tshirt'`)

Basic short-sleeved set-in-sleeve tee. Pieces: `front` (fold), `back` (fold), `sleeve_l`, `sleeve_r`. Design measurements at size M:

| quantity | value | derivation |
|---|---|---|
| garment chest | 960 mm | 4 x 240 (front + back full width 480 each); body 880 + 80 ease |
| length, CB neck to hem | 570 mm | back fold edge; hem lands between hip and crotch on `female_m` |
| length, CF neck to hem | 510 mm | front fold edge (front neck drop 80, back 20 below the neck point) |
| neck opening width | 140 mm | 2 x 70 |
| across shoulders | 400 mm | 2 x 200; biacromial 380 + 20 |
| shoulder seam | 134.63 mm | (200,555) -> (70,590) |
| armhole (each of front/back) | 200.74 mm | armhole circumference 401.5 mm |
| sleeve bicep | 340 mm | 2 x 170; upper arm 270 + 70 ease |
| sleeve hem | 320 mm | 2 x 160 |
| sleeve underarm | 190.26 mm | cap height 100 mm above the bicep line |
| sleeve cap | 2 x 200.63 = 401.3 mm | cap ease at M: -0.05 % (0 %; grows to +2.2 % at XL, -1.3 % at S) |

**`front`** — stored half, `x >= 0`, fold on `x = 0`, hem on `y = 0`.

| i | vertex (mm) | meaning |
|---|---|---|
| 0 | `[0, 0]` | CF hem (on fold) |
| 1 | `[240, 0]` | side hem |
| 2 | `[240, 360]` | armpit (top of side seam) |
| 3 | `[200, 555]` | shoulder tip |
| 4 | `[70, 590]` | neck point (top of the piece) |
| 5 | `[0, 510]` | CF neck (on fold) |

| edge | from -> to | type | control points | allowance | label | length (mm) |
|---|---|---|---|---|---|---|
| e0 | v0 -> v1 | line | – | 25 | hem | 240.00 |
| e1 | v1 -> v2 (hem -> armpit) | line | – | 10 | side | 360.00 |
| e2 | v2 -> v3 (armpit -> shoulder tip) | cubic | `c1 [248, 445]`, `c2 [210, 505]` | 10 | armhole | 200.74 |
| e3 | v3 -> v4 (shoulder tip -> neck point) | line | – | 10 | shoulder | 134.63 |
| e4 | v4 -> v5 (neck point -> CF neck) | cubic | `c1 [60, 550]`, `c2 [35, 510]` | 6 | neck | 113.87 |
| e5 | v5 -> v0 (CF neck -> CF hem) | line | – | 0 | fold | 510.00 |

`foldEdge 5`; notch `{edge 2, t 0.5, single}`; grainline `[120,100] -> [120,450]`; stored-half area 131 280 mm², full piece 262 561 mm²; `cutQty 1`.

**`back`** — identical to `front` except the neckline: v5 = `[0, 570]`, e4 = cubic `c1 [50, 582]`, `c2 [25, 570]` (length 73.29 mm), e5 length 570.00 mm; notch `{edge 2, t 0.5, double}`; full area 268 885 mm².

**`sleeve_l`** — full outline (no fold), centred on `x = 0`, hem on `y = 0`, bicep line `y = 190`, apex `y = 290`.

| i | vertex (mm) | meaning |
|---|---|---|
| 0 | `[-160, 0]` | hem, x<0 end |
| 1 | `[160, 0]` | hem, x>0 end |
| 2 | `[170, 190]` | armpit corner, x>0 (back side when arranged) |
| 3 | `[0, 290]` | cap apex (meets the shoulder seam) |
| 4 | `[-170, 190]` | armpit corner, x<0 (front side when arranged) |

| edge | from -> to | type | control points | allowance | label | length (mm) |
|---|---|---|---|---|---|---|
| e0 | v0 -> v1 | line | – | 25 | hem | 320.00 |
| e1 | v1 -> v2 (hem -> armpit, x>0) | line | – | 10 | underarm | 190.26 |
| e2 | v2 -> v3 (armpit x>0 -> apex) | cubic | `c1 [120, 195]`, `c2 [60, 290]` | 10 | cap back | 200.63 |
| e3 | v3 -> v4 (apex -> armpit x<0) | cubic | `c1 [-60, 290]`, `c2 [-120, 195]` | 10 | cap front | 200.63 |
| e4 | v4 -> v0 (armpit x<0 -> hem) | line | – | 10 | underarm | 190.26 |

`foldEdge null`; notches `{edge 2, t 0.5, double}` (back cap), `{edge 3, t 0.5, single}` (front cap); grainline `[0,30] -> [0,250]`; area 80 720 mm²; `cutQty 2`, `exportHidden false`. Under rule 4.1-10(b) pattern `+x` of `sleeve_l` (armL, side left, flip false) maps to `-z`, so e2 is the **back** cap half and e3 the **front** cap half.

**`sleeve_r`** — same vertices, edges, notches, grainline and grade as `sleeve_l`; `id 'sleeve_r'`, `name 'Sleeve (mirror)'`, `cutQty 2`, `exportHidden true` (the export prints `sleeve_l` once with `CUT 2`), placement `anchor 'armR'`, `side 'right'`, `flip true`. With `flip true` on armR pattern `+x` again maps to `-z`, so e2 is again the back cap: the two sleeves are a mirrored pair exactly as cut.

**Placement**

| piece | anchor | side | offset_mm | wrap | flip |
|---|---|---|---|---|---|
| front | torso | front | [0, 0] | 0.8 | false |
| back | torso | back | [0, 0] | 0.8 | false |
| sleeve_l | armL | left | [0, 20] | 1 | false |
| sleeve_r | armR | right | [0, 20] | 1 | true |

Which copy of a fold piece lands on which side of the body (rule 4.1-10): `front` original half (`mirror false`) -> model's left (`+x`), mirrored half -> model's right; `back` original half -> model's **right**, mirrored half -> model's left.

**Grading**

| piece | widthRef | lengthRef | anchorX | anchorY | vertexRules |
|---|---|---|---|---|---|
| front, back | chest_cm | torsoLength_cm | fold | top | `[{vertex: 4, dx_mm: -1.5, dy_mm: 0}]` (neck point drifts inward 1.5 mm per size step so the neck opening grows 1.4 mm/size instead of 3.2 mm; identical on front and back so the shoulder seam stays matched) |
| sleeve_l, sleeve_r | chest_cm | armLength_cm | center | top | `[]` |

**Seam records (10)** — `L`/`R` = model's left/right. "runs" gives the physical start -> end of each edge as listed (start vertex -> end vertex, identical for the mirrored copy).

| id | side a: piece.edge (mirror) runs | side b: piece.edge (mirror) runs | reverse | why |
|---|---|---|---|---|
| `shoulder_L` | front.e3 (false): shoulder tip -> neck point | back.e3 (**true**): shoulder tip -> neck point | false | both tip -> neck; the back's copy on the model's left is its mirrored half |
| `shoulder_R` | front.e3 (**true**) | back.e3 (false) | false | same, other side |
| `side_L` | front.e1 (false): hem -> armpit | back.e1 (**true**): hem -> armpit | false | both hem -> armpit |
| `side_R` | front.e1 (**true**) | back.e1 (false) | false | |
| `underarm_L` | sleeve_l.e1 (false): hem -> armpit | sleeve_l.e4 (false): armpit -> hem | **true** | opposite directions: vertex 0 of e1 (hem) pairs with vertex N of e4 (hem) |
| `underarm_R` | sleeve_r.e1 (false) | sleeve_r.e4 (false) | **true** | |
| `cap_front_L` | sleeve_l.e3 (false): apex -> armpit | front.e2 (false): armpit -> shoulder tip | **true** | apex meets the shoulder tip, armpit meets armpit; front's left copy is the original |
| `cap_back_L` | sleeve_l.e2 (false): armpit -> apex | back.e2 (**true**): armpit -> shoulder tip | false | same direction; back's left copy is the mirrored half |
| `cap_front_R` | sleeve_r.e3 (false): apex -> armpit | front.e2 (**true**): armpit -> shoulder tip | **true** | |
| `cap_back_R` | sleeve_r.e2 (false): armpit -> apex | back.e2 (false): armpit -> shoulder tip | false | |

All `kind: 'plain'`. Every seam side has `mirror false` on the sleeves (no `foldEdge`), and no record references e5 of front/back (fold).

**Verified seam lengths** (cubic arc length by 200-chord sum; grading per rule 4.1-11 applied to vertices and control points, then vertex rules; `n = max(2, ceil(max(A,B)/15))` is the mesher's sample count at `meshSpacing_mm 15`):

| seam | S: A / B (mm), diff | M: A / B, diff | L: A / B, diff | XL: A / B, diff | n at M |
|---|---|---|---|---|---|
| shoulder_L/R | 127.3 / 127.3, 0.00 % | 134.6 / 134.6, 0.00 % | 142.0 / 142.0, 0.00 % | 149.4 / 149.4, 0.00 % | 9 |
| side_L/R | 351.0 / 351.0, 0.00 % | 360.0 / 360.0, 0.00 % | 369.0 / 369.0, 0.00 % | 378.0 / 378.0, 0.00 % | 24 |
| underarm_L/R | 186.9 / 186.9, 0.00 % | 190.3 / 190.3, 0.00 % | 193.7 / 193.7, 0.00 % | 197.1 / 197.1, 0.00 % | 13 |
| cap_front_L/R, cap_back_L/R | 193.1 / 195.5, 1.26 % | 200.6 / 200.7, 0.05 % | 208.2 / 206.0, 1.09 % | 215.9 / 211.2, 2.19 % | 14 |

Maximum mismatch over all seams and sizes: 2.19 % (< 3 %). Graded bounding boxes (w x h, mm): front/back S 229.1 x 575.2, M 240.0 x 590.0, L 250.9 x 604.8, XL 261.8 x 619.5; sleeve S 324.5 x 284.8, M 340.0 x 290.0, L 355.5 x 295.2, XL 370.9 x 300.4 (front width ratio S/M = 0.9545 = 84/88).

Expected mesh size at `h = 15` (area / (h² √3 / 2), informational): front ≈ 1350, back ≈ 1380, each sleeve ≈ 415, total ≈ 3550 vertices — under the 8000 cap.

### 4.3 A-line skirt (`id: 'skirt'`)

Pull-on knee-length A-line skirt: `front` (fold) and `back` (fold), identical outlines, two side seams. The top edge (waist) is 4 x 250.64 = 1002.6 mm ≈ hips 960 + 40 ease so the skirt can be pulled over the hips; it is listed in `pinnedEdges`, so after arrangement its mesh vertices are pinned to the body surface at the `'skirt'` anchor origin level (the waist). The pinned edge is longer than the body waist (700 mm) and therefore gathers like an elastic waist — intended.

| quantity | value |
|---|---|
| waist edge | 1002.6 mm (4 x 250.64) |
| hem | 1286.7 mm (4 x 321.67) |
| length CF | 550 mm (waist at 0.62 H = 102 cm on `female_m` puts the hem at knee level, 0.28 H) |
| side seam | 539.56 mm, hem raised 30 mm and waist raised 15 mm at the side so hem and waist are perpendicular to the flared side seam |

**`front`** (and **`back`**, same outline)

| i | vertex (mm) | meaning |
|---|---|---|
| 0 | `[0, 0]` | CF hem (on fold) |
| 1 | `[320, 30]` | side hem |
| 2 | `[250, 565]` | side waist |
| 3 | `[0, 550]` | CF waist (on fold) |

| edge | from -> to | type | control points | allowance | label | length (mm) |
|---|---|---|---|---|---|---|
| e0 | v0 -> v1 (CF hem -> side hem) | cubic | `c1 [110, 0]`, `c2 [215, 16]` | 25 | hem | 321.67 |
| e1 | v1 -> v2 (side hem -> side waist) | line | – | 10 | side | 539.56 |
| e2 | v2 -> v3 (side waist -> CF waist) | cubic | `c1 [170, 554]`, `c2 [85, 550]` | 10 | waist | 250.64 |
| e3 | v3 -> v0 (CF waist -> CF hem) | line | – | 0 | fold | 550.00 |

`foldEdge 3`; `pinnedEdges [2]`; notch on e1 at `t 0.5` (`single` on front, `double` on back); grainline `[120,80] -> [120,480]`; stored-half area 155 850 mm², full 311 701 mm²; `cutQty 1`.

**Placement:** front `anchor 'skirt'`, `side 'front'`, `offset_mm [0,0]`, `wrap 0.8`, `flip false`; back `side 'back'`, otherwise identical. **Grading:** `widthRef 'hips_cm'`, `lengthRef 'height_cm'`, `anchorX 'fold'`, `anchorY 'top'`, `vertexRules []` (both panels).

**Seam records (2)**

| id | side a runs | side b runs | reverse | why |
|---|---|---|---|---|
| `side_L` | front.e1 (mirror false): hem -> waist | back.e1 (mirror **true**): hem -> waist | false | same direction; back's left copy is the mirrored half |
| `side_R` | front.e1 (mirror **true**) | back.e1 (mirror false) | false | |

**Verified seam lengths:** side_L/R: S 523.1 / 523.1, M 539.6 / 539.6, L 556.0 / 556.0, XL 572.5 / 572.5 mm, all 0.00 % (identical outlines and grade); `n` at M = 36. Graded bounding boxes: S 306.7 x 547.9, M 320.0 x 565.0, L 333.3 x 582.1, XL 346.7 x 599.2 mm. Expected mesh: ≈ 1600 vertices per panel, ≈ 3200 total.

### 4.4 The data: `src/samples/tshirt.js`, `src/samples/skirt.js`, `src/samples/index.js`

Both documents share the same `body`, `sizes`, `sim` and `ui` blocks; they differ in `name`, `fabrics`, `pieces`, `seams`. The literals below are complete: copy them verbatim.

**`src/samples/tshirt.js`**

```js
// src/samples/tshirt.js — built-in sample: basic set-in-sleeve T-shirt (SPEC section 4.2).
// Pure data; imports nothing. Drafted for body preset female_m at size M with 8 cm chest ease.
// Pattern space: mm, y up, outlines CCW; fold pieces store the x >= 0 half with the fold edge on x = 0.
// Seam ids: L/R = the MODEL's left/right (3D +x / -x).

/** @type {import('../core/types.js').ProjectDoc} */
export const TSHIRT = {
  version: 1,
  name: 'Basic T-shirt',
  body: {
    preset: 'female_m',
    params: {
      height_cm: 165, chest_cm: 88, underbust_cm: 76, waist_cm: 70, hips_cm: 96,
      shoulderWidth_cm: 38, neck_cm: 34, upperArm_cm: 27, forearm_cm: 23, wrist_cm: 15.5,
      thigh_cm: 54, calf_cm: 36, ankle_cm: 22, armLength_cm: 56, inseam_cm: 76,
      torsoLength_cm: 40, headHeight_cm: 22, bustFullness: 0.4, armAbduction_deg: 30, legSpread_deg: 6,
    },
  },
  fabrics: [
    {
      id: 'main', name: 'Main (cotton)', preset: 'cotton', color: '#c8102e',
      texture: { kind: 'solid', scale_mm: 20, color2: '#ffffff' },
      overrides: {},
    },
  ],
  pieces: [
    {
      id: 'front', name: 'Front',
      vertices: [[0, 0], [240, 0], [240, 360], [200, 555], [70, 590], [0, 510]],
      edges: [
        { type: 'line', allowance_mm: 25, label: 'hem' },                                       // e0 CF hem -> side hem
        { type: 'line', allowance_mm: 10, label: 'side' },                                      // e1 side hem -> armpit
        { type: 'cubic', c1: [248, 445], c2: [210, 505], allowance_mm: 10, label: 'armhole' },  // e2 armpit -> shoulder tip
        { type: 'line', allowance_mm: 10, label: 'shoulder' },                                  // e3 shoulder tip -> neck point
        { type: 'cubic', c1: [60, 550], c2: [35, 510], allowance_mm: 6, label: 'neck' },        // e4 neck point -> CF neck
        { type: 'line', allowance_mm: 0, label: 'fold' },                                       // e5 CF neck -> CF hem (fold)
      ],
      foldEdge: 5,
      notches: [{ edge: 2, t: 0.5, kind: 'single' }],
      grainline: { a: [120, 100], b: [120, 450] },
      internalLines: [],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 1,
      exportHidden: false,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'torso', side: 'front', offset_mm: [0, 0], wrap: 0.8, flip: false },
      grade: {
        widthRef: 'chest_cm', lengthRef: 'torsoLength_cm', anchorX: 'fold', anchorY: 'top',
        vertexRules: [{ vertex: 4, dx_mm: -1.5, dy_mm: 0 }],
      },
      meshSpacing_mm: 15,
    },
    {
      id: 'back', name: 'Back',
      vertices: [[0, 0], [240, 0], [240, 360], [200, 555], [70, 590], [0, 570]],
      edges: [
        { type: 'line', allowance_mm: 25, label: 'hem' },                                       // e0
        { type: 'line', allowance_mm: 10, label: 'side' },                                      // e1 side hem -> armpit
        { type: 'cubic', c1: [248, 445], c2: [210, 505], allowance_mm: 10, label: 'armhole' },  // e2 armpit -> shoulder tip
        { type: 'line', allowance_mm: 10, label: 'shoulder' },                                  // e3 shoulder tip -> neck point
        { type: 'cubic', c1: [50, 582], c2: [25, 570], allowance_mm: 6, label: 'neck' },        // e4 neck point -> CB neck
        { type: 'line', allowance_mm: 0, label: 'fold' },                                       // e5 CB neck -> CB hem (fold)
      ],
      foldEdge: 5,
      notches: [{ edge: 2, t: 0.5, kind: 'double' }],
      grainline: { a: [120, 100], b: [120, 450] },
      internalLines: [],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 1,
      exportHidden: false,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'torso', side: 'back', offset_mm: [0, 0], wrap: 0.8, flip: false },
      grade: {
        widthRef: 'chest_cm', lengthRef: 'torsoLength_cm', anchorX: 'fold', anchorY: 'top',
        vertexRules: [{ vertex: 4, dx_mm: -1.5, dy_mm: 0 }],
      },
      meshSpacing_mm: 15,
    },
    {
      id: 'sleeve_l', name: 'Sleeve',
      vertices: [[-160, 0], [160, 0], [170, 190], [0, 290], [-170, 190]],
      edges: [
        { type: 'line', allowance_mm: 25, label: 'hem' },                                          // e0 hem
        { type: 'line', allowance_mm: 10, label: 'underarm' },                                     // e1 hem -> armpit (x>0)
        { type: 'cubic', c1: [120, 195], c2: [60, 290], allowance_mm: 10, label: 'cap back' },     // e2 armpit (x>0) -> apex
        { type: 'cubic', c1: [-60, 290], c2: [-120, 195], allowance_mm: 10, label: 'cap front' },  // e3 apex -> armpit (x<0)
        { type: 'line', allowance_mm: 10, label: 'underarm' },                                     // e4 armpit (x<0) -> hem
      ],
      foldEdge: null,
      notches: [{ edge: 2, t: 0.5, kind: 'double' }, { edge: 3, t: 0.5, kind: 'single' }],
      grainline: { a: [0, 30], b: [0, 250] },
      internalLines: [],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 2,
      exportHidden: false,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'armL', side: 'left', offset_mm: [0, 20], wrap: 1, flip: false },
      grade: { widthRef: 'chest_cm', lengthRef: 'armLength_cm', anchorX: 'center', anchorY: 'top', vertexRules: [] },
      meshSpacing_mm: 15,
    },
    {
      id: 'sleeve_r', name: 'Sleeve (mirror)',
      vertices: [[-160, 0], [160, 0], [170, 190], [0, 290], [-170, 190]],
      edges: [
        { type: 'line', allowance_mm: 25, label: 'hem' },
        { type: 'line', allowance_mm: 10, label: 'underarm' },
        { type: 'cubic', c1: [120, 195], c2: [60, 290], allowance_mm: 10, label: 'cap back' },
        { type: 'cubic', c1: [-60, 290], c2: [-120, 195], allowance_mm: 10, label: 'cap front' },
        { type: 'line', allowance_mm: 10, label: 'underarm' },
      ],
      foldEdge: null,
      notches: [{ edge: 2, t: 0.5, kind: 'double' }, { edge: 3, t: 0.5, kind: 'single' }],
      grainline: { a: [0, 30], b: [0, 250] },
      internalLines: [],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 2,
      exportHidden: true,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'armR', side: 'right', offset_mm: [0, 20], wrap: 1, flip: true },
      grade: { widthRef: 'chest_cm', lengthRef: 'armLength_cm', anchorX: 'center', anchorY: 'top', vertexRules: [] },
      meshSpacing_mm: 15,
    },
  ],
  seams: [
    // shoulder: front.e3 and back.e3 both run shoulder tip -> neck point
    { id: 'shoulder_L', kind: 'plain',
      a: { pieceId: 'front', edge: 3, mirror: false, reverse: false },
      b: { pieceId: 'back',  edge: 3, mirror: true,  reverse: false } },
    { id: 'shoulder_R', kind: 'plain',
      a: { pieceId: 'front', edge: 3, mirror: true,  reverse: false },
      b: { pieceId: 'back',  edge: 3, mirror: false, reverse: false } },
    // side: front.e1 and back.e1 both run hem -> armpit
    { id: 'side_L', kind: 'plain',
      a: { pieceId: 'front', edge: 1, mirror: false, reverse: false },
      b: { pieceId: 'back',  edge: 1, mirror: true,  reverse: false } },
    { id: 'side_R', kind: 'plain',
      a: { pieceId: 'front', edge: 1, mirror: true,  reverse: false },
      b: { pieceId: 'back',  edge: 1, mirror: false, reverse: false } },
    // sleeve underarm: e1 runs hem -> armpit, e4 runs armpit -> hem => reverse
    { id: 'underarm_L', kind: 'plain',
      a: { pieceId: 'sleeve_l', edge: 1, mirror: false, reverse: false },
      b: { pieceId: 'sleeve_l', edge: 4, mirror: false, reverse: true } },
    { id: 'underarm_R', kind: 'plain',
      a: { pieceId: 'sleeve_r', edge: 1, mirror: false, reverse: false },
      b: { pieceId: 'sleeve_r', edge: 4, mirror: false, reverse: true } },
    // sleeve cap to armhole: front cap e3 runs apex -> armpit vs armhole armpit -> tip => reverse;
    // back cap e2 runs armpit -> apex, same direction as the armhole => no reverse
    { id: 'cap_front_L', kind: 'plain',
      a: { pieceId: 'sleeve_l', edge: 3, mirror: false, reverse: false },
      b: { pieceId: 'front',    edge: 2, mirror: false, reverse: true } },
    { id: 'cap_back_L', kind: 'plain',
      a: { pieceId: 'sleeve_l', edge: 2, mirror: false, reverse: false },
      b: { pieceId: 'back',     edge: 2, mirror: true,  reverse: false } },
    { id: 'cap_front_R', kind: 'plain',
      a: { pieceId: 'sleeve_r', edge: 3, mirror: false, reverse: false },
      b: { pieceId: 'front',    edge: 2, mirror: true,  reverse: true } },
    { id: 'cap_back_R', kind: 'plain',
      a: { pieceId: 'sleeve_r', edge: 2, mirror: false, reverse: false },
      b: { pieceId: 'back',     edge: 2, mirror: false, reverse: false } },
  ],
  sizes: {
    measurements: ['chest_cm', 'waist_cm', 'hips_cm', 'height_cm', 'torsoLength_cm', 'armLength_cm'],
    baseSize: 'M',
    rows: [
      { name: 'S',  chest_cm: 84, waist_cm: 66, hips_cm: 92,  height_cm: 160, torsoLength_cm: 39, armLength_cm: 55 },
      { name: 'M',  chest_cm: 88, waist_cm: 70, hips_cm: 96,  height_cm: 165, torsoLength_cm: 40, armLength_cm: 56 },
      { name: 'L',  chest_cm: 92, waist_cm: 74, hips_cm: 100, height_cm: 170, torsoLength_cm: 41, armLength_cm: 57 },
      { name: 'XL', chest_cm: 96, waist_cm: 78, hips_cm: 104, height_cm: 175, torsoLength_cm: 42, armLength_cm: 58 },
    ],
  },
  sim: { substeps: 10, gravity_ms2: 9.81, selfCollision: true, sewTime_s: 1.0, collisionOffset_mm: 5, bendScale: 1, stretchScale: 1 },
  ui: { split: 0.5, layout: 'split', swapped: false, activeSize: 'M', dockTab: 'pieces' },
};
```

Note on `SeamSide.reverse`: types.js defines the pairing by the flag on the record; the samples set it on side `b` and keep `a.reverse === false` on every record. Consumers must treat the pairing as reversed when **either** side's flag is true (`reverse = a.reverse !== b.reverse`), so the convention is robust to either placement.

**`src/samples/skirt.js`**

```js
// src/samples/skirt.js — built-in sample: pull-on A-line skirt (SPEC section 4.3).
// Pure data; imports nothing. Drafted for body preset female_m at size M; top edge = hips + 4 cm ease,
// pinned to the body at the 'skirt' anchor origin (waist) after arrangement.

/** @type {import('../core/types.js').ProjectDoc} */
export const SKIRT = {
  version: 1,
  name: 'A-line skirt',
  body: {
    preset: 'female_m',
    params: {
      height_cm: 165, chest_cm: 88, underbust_cm: 76, waist_cm: 70, hips_cm: 96,
      shoulderWidth_cm: 38, neck_cm: 34, upperArm_cm: 27, forearm_cm: 23, wrist_cm: 15.5,
      thigh_cm: 54, calf_cm: 36, ankle_cm: 22, armLength_cm: 56, inseam_cm: 76,
      torsoLength_cm: 40, headHeight_cm: 22, bustFullness: 0.4, armAbduction_deg: 30, legSpread_deg: 6,
    },
  },
  fabrics: [
    {
      id: 'main', name: 'Main (denim)', preset: 'denim', color: '#3b5b8c',
      texture: { kind: 'twill', scale_mm: 4, color2: '#2c4468' },
      overrides: {},
    },
  ],
  pieces: [
    {
      id: 'front', name: 'Front',
      vertices: [[0, 0], [320, 30], [250, 565], [0, 550]],
      edges: [
        { type: 'cubic', c1: [110, 0], c2: [215, 16], allowance_mm: 25, label: 'hem' },     // e0 CF hem -> side hem
        { type: 'line', allowance_mm: 10, label: 'side' },                                    // e1 side hem -> side waist
        { type: 'cubic', c1: [170, 554], c2: [85, 550], allowance_mm: 10, label: 'waist' },  // e2 side waist -> CF waist
        { type: 'line', allowance_mm: 0, label: 'fold' },                                     // e3 CF waist -> CF hem (fold)
      ],
      foldEdge: 3,
      notches: [{ edge: 1, t: 0.5, kind: 'single' }],
      grainline: { a: [120, 80], b: [120, 480] },
      internalLines: [],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 1,
      exportHidden: false,
      simulate: true,
      pinnedEdges: [2],
      placement: { anchor: 'skirt', side: 'front', offset_mm: [0, 0], wrap: 0.8, flip: false },
      grade: { widthRef: 'hips_cm', lengthRef: 'height_cm', anchorX: 'fold', anchorY: 'top', vertexRules: [] },
      meshSpacing_mm: 15,
    },
    {
      id: 'back', name: 'Back',
      vertices: [[0, 0], [320, 30], [250, 565], [0, 550]],
      edges: [
        { type: 'cubic', c1: [110, 0], c2: [215, 16], allowance_mm: 25, label: 'hem' },
        { type: 'line', allowance_mm: 10, label: 'side' },
        { type: 'cubic', c1: [170, 554], c2: [85, 550], allowance_mm: 10, label: 'waist' },
        { type: 'line', allowance_mm: 0, label: 'fold' },
      ],
      foldEdge: 3,
      notches: [{ edge: 1, t: 0.5, kind: 'double' }],
      grainline: { a: [120, 80], b: [120, 480] },
      internalLines: [],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 1,
      exportHidden: false,
      simulate: true,
      pinnedEdges: [2],
      placement: { anchor: 'skirt', side: 'back', offset_mm: [0, 0], wrap: 0.8, flip: false },
      grade: { widthRef: 'hips_cm', lengthRef: 'height_cm', anchorX: 'fold', anchorY: 'top', vertexRules: [] },
      meshSpacing_mm: 15,
    },
  ],
  seams: [
    // side seams: front.e1 and back.e1 both run hem -> waist
    { id: 'side_L', kind: 'plain',
      a: { pieceId: 'front', edge: 1, mirror: false, reverse: false },
      b: { pieceId: 'back',  edge: 1, mirror: true,  reverse: false } },
    { id: 'side_R', kind: 'plain',
      a: { pieceId: 'front', edge: 1, mirror: true,  reverse: false },
      b: { pieceId: 'back',  edge: 1, mirror: false, reverse: false } },
  ],
  sizes: {
    measurements: ['chest_cm', 'waist_cm', 'hips_cm', 'height_cm', 'torsoLength_cm', 'armLength_cm'],
    baseSize: 'M',
    rows: [
      { name: 'S',  chest_cm: 84, waist_cm: 66, hips_cm: 92,  height_cm: 160, torsoLength_cm: 39, armLength_cm: 55 },
      { name: 'M',  chest_cm: 88, waist_cm: 70, hips_cm: 96,  height_cm: 165, torsoLength_cm: 40, armLength_cm: 56 },
      { name: 'L',  chest_cm: 92, waist_cm: 74, hips_cm: 100, height_cm: 170, torsoLength_cm: 41, armLength_cm: 57 },
      { name: 'XL', chest_cm: 96, waist_cm: 78, hips_cm: 104, height_cm: 175, torsoLength_cm: 42, armLength_cm: 58 },
    ],
  },
  sim: { substeps: 10, gravity_ms2: 9.81, selfCollision: true, sewTime_s: 1.0, collisionOffset_mm: 5, bendScale: 1, stretchScale: 1 },
  ui: { split: 0.5, layout: 'split', swapped: false, activeSize: 'M', dockTab: 'pieces' },
};
```

**`src/samples/index.js`** — the registry. It imports only its two sibling modules (the "samples -> nothing" rule of section 2 refers to other packages; JSDoc `import('../core/types.js')` in comments is not a runtime import). It deep-freezes the literals at module load so an accidental mutation of shared data throws (modules are strict), and hands out fresh clones.

```js
// src/samples/index.js — registry of built-in sample garments (SPEC section 4.4). Imports nothing outside src/samples/.
import { TSHIRT } from './tshirt.js';
import { SKIRT } from './skirt.js';

/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */
/** @typedef {{id:string, name:string, doc:ProjectDoc}} SampleEntry */

/**
 * Recursively Object.freeze a plain data tree (objects and arrays). Returns its argument.
 * @template T
 * @param {T} o
 * @returns {T}
 */
export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(/** @type {any} */ (o)[k]);
  }
  return o;
}

/** Id of the sample the app loads at start-up when no project is restored. */
export const DEFAULT_SAMPLE_ID = 'tshirt';

/**
 * Ordered list of built-in samples; order = order in the toolbar "Samples" menu (section 11).
 * `doc` is the frozen master copy — never hand it to the store; use getSample().
 * @type {readonly SampleEntry[]}
 */
export const SAMPLES = Object.freeze([
  Object.freeze({ id: 'tshirt', name: 'Basic T-shirt', doc: deepFreeze(TSHIRT) }),
  Object.freeze({ id: 'skirt',  name: 'A-line skirt',  doc: deepFreeze(SKIRT) }),
]);

/**
 * Ids and display names of all samples, in menu order.
 * @returns {{id:string, name:string}[]}
 */
export function listSamples() {
  return SAMPLES.map((s) => ({ id: s.id, name: s.name }));
}

/**
 * Deep clone of a sample ProjectDoc, safe to hand to store.replace(). Every call returns a new, unfrozen object
 * graph (structuredClone drops the freeze). The literals are authored fully normalised, so
 * normalizeDoc(getSample(id)) (section 3.3) is deep-equal to getSample(id).
 * @param {string} id  'tshirt' | 'skirt'
 * @returns {ProjectDoc}
 * @throws {Error & {code:'UNKNOWN_SAMPLE'}} when id is not a registered sample
 */
export function getSample(id) {
  const entry = SAMPLES.find((s) => s.id === id);
  if (!entry) {
    const err = /** @type {Error & {code:string}} */ (new Error(`Unknown sample '${id}'; known: ${SAMPLES.map((s) => s.id).join(', ')}`));
    err.code = 'UNKNOWN_SAMPLE';
    throw err;
  }
  return structuredClone(entry.doc);
}
```

Consumers: `src/app/wiring.js` calls `getSample(DEFAULT_SAMPLE_ID)` at start-up and `getSample(id)` from the Samples menu / `__app.loadSample(id)`, always followed by `store.replace(doc, 'Load sample: ' + id)` (section 3.3; `replace` normalises and validates); `src/ui/toolbar.js` builds the menu from `listSamples()`. Nobody imports `TSHIRT`/`SKIRT` directly except `index.js` and the tests.

### 4.5 Sample invariants and how they are checked

`src/samples/` ships no `selftest.js` (file layout, section 2); its invariants are checked (i) once by the lead in Phase 0 with the Python procedure below, and (ii) at runtime by `tests/acceptance.js` (section 13, item "samples") using the public APIs of the geometry, pattern and sizing modules. Every check below is a hard failure.

**Phase-0 procedure (Python, lead).** Cubic length `L(e) = sum over k=0..199 of |P((k+1)/200) - P(k/200)|` with `P(t) = (1-t)^3 v_i + 3(1-t)^2 t c1 + 3(1-t) t^2 c2 + t^3 v_{i+1}`; line length = Euclidean distance. Outline sampled at 40 points per cubic for the area and simplicity tests. Grading as in rule 4.1-11 (scale about the anchor, control points included, then vertex rules with `k = sizeIndex - baseIndex`). Output = the tables in 4.2/4.3.

**Assertions (both samples, every piece unless stated):**

1. `normalizeDoc(getSample(id))` deep-equals `getSample(id)`; `validateShape` (section 3.3) reports no issues; `serializeDoc` round-trips byte-identically.
2. `getSample(id) !== getSample(id)` (fresh clone) and `Object.isFrozen(SAMPLES[i].doc.pieces[0].vertices)` is true; `getSample('nope')` throws with `code === 'UNKNOWN_SAMPLE'`; `listSamples()` deep-equals `[{id:'tshirt',name:'Basic T-shirt'},{id:'skirt',name:'A-line skirt'}]`.
3. `edges.length === vertices.length`; signed area of `vertices` > 0 and of the curve-sampled outline > 0; the sampled outline is simple; every cubic edge has `c1` and `c2`.
4. Fold pieces: `vertices[foldEdge].x === 0`, `vertices[(foldEdge+1) % n].x === 0`, `edges[foldEdge].type === 'line'`, `edges[foldEdge].allowance_mm === 0`, all vertices and control points have `x >= 0`.
5. Every notch: `0 < t < 1`, `edge !== foldEdge`; every grainline endpoint is strictly inside the stored outline and `a.x === b.x`, `b.y > a.y`.
6. Seams: every `pieceId` exists; `edge` is a valid index and never the piece's `foldEdge`; `mirror === false` on pieces with `foldEdge === null`; ids unique; `TSHIRT.seams.length === 10`, `SKIRT.seams.length === 2`; for every seam and every size row, `|L_a - L_b| / min(L_a, L_b) <= 0.03` (expected maxima: T-shirt 2.19 % at XL on the cap seams, skirt 0 %).
7. Piece ids `['front','back','sleeve_l','sleeve_r']` (T-shirt) and `['front','back']` (skirt); `sleeve_r.exportHidden === true`, `sleeve_l.cutQty === 2`; `SKIRT.pieces[*].pinnedEdges` deep-equals `[2]`; every `fabricId` is `'main'` and `fabrics[0].id === 'main'`.
8. Full front width at M = 480 mm (2 x max x of `front`), so front + back = 960 mm = chest 88 cm + 8 cm; skirt top edge 4 x `L(front.e2)` = 1002.6 ± 0.5 mm.
9. After meshing at `meshSpacing_mm 15` (geometry module): every seam's two sides have equal vertex counts; total T-shirt vertices in `[2500, 5000]`, skirt in `[2200, 4500]`.

**PROPOSED types.js amendment:** none. (Section 13 note: the T-shirt encodes 8 garment seams as 10 `Seam` records — see rule 4.1-14; any acceptance item counting seams must use 10.)

---

## 5. 2D geometry (`src/geometry/`) — agent A1

Pure module: imports only `src/core/types.js`, `src/core/ids.js` (`hashString`) and `src/core/fabrics.js` (`effectiveMeshSpacing`); `selftest.js` may additionally import `src/samples/index.js` as a fixture source. No DOM, no three.js, no allocation-heavy per-frame paths (everything here runs on edits, not per frame). All coordinates are **mm, y up**; outlines are **CCW (signedArea > 0)**; the outward normal of edge direction `d` is `[d[1], -d[0]]`. Every function is synchronous. Errors are `Error` objects with a `code` property (`'RemeshError'`, `'GeometryError'`). Consumers: `pattern/` (drawing, hit-testing, validation, seam readouts), `sizing/` and `export/` (offset, packing, flattening), `cloth/state.js` (via `PieceMesh`), `app/wiring.js` (`remeshPiece`).

Files: `bezier.js`, `polygon.js`, `mirror.js`, `prng.js`, `delaunay.js`, `remesh.js`, `offset.js`, `pack.js`, `index.js` (re-exports everything below), `selftest.js`.

### 5.1 `bezier.js` — edges, arc length, sampling

An outline edge `i` runs from `piece.vertices[i]` (= `p0`) to `piece.vertices[(i+1) % n]` (= `p1`); a `'cubic'` edge has absolute control points `c1`, `c2`. Two API forms exist: the **piece form** `(piece, edgeIndex, ...)` used by `export/`, `sizing/`, `remesh.js`, and the **segment form** `(p0, edge, p1, ...)` used by the editor while a drag is in progress (the piece object is not yet updated). Both are exported; they share one implementation.

```js
/** Point on a cubic at parameter u ∈ [0,1]. @returns {Vec2} */
export function cubicPoint(p0, c1, c2, p1, u)
/** Unnormalised derivative dP/du at u. @returns {Vec2} */
export function cubicTangent(p0, c1, c2, p1, u)
/** Arc-length table: 64 chords, cumulative lengths; cached on the edge object under the non-enumerable key __lenTable keyed by a hash of the 4 points. @returns {Float64Array} 65 entries, [0] = 0 */
export function cubicLengthTable(p0, c1, c2, p1)
/** Total length of a segment: |p1 - p0| for 'line', last entry of cubicLengthTable for 'cubic'. */
export function segmentLength(p0, edge, p1)
/** Piece form of segmentLength. */
export function edgeLength(piece, edgeIndex)
/** Bezier parameter u at arc-length fraction t ∈ [0,1] (linear interpolation of the inverted table; u === t for lines). */
export function paramAtArcFraction(p0, edge, p1, t)
/** Point at arc-length fraction t. @returns {Vec2} */
export function pointAtArcFraction(p0, edge, p1, t)
/** Unit tangent (direction of travel p0 → p1) at arc-length fraction t. @returns {Vec2} */
export function tangentAtArcFraction(p0, edge, p1, t)
/** n + 1 points at arc-length fractions 0, 1/n, ..., 1 (both endpoints exact copies of p0/p1). n ≥ 1. @returns {Vec2[]} */
export function sampleSegment(p0, edge, p1, n)
/** Piece form: sampleSegment(vertices[i], edges[i], vertices[(i+1)%n], n). */
export function sampleEdge(piece, edgeIndex, n)
/** Points at the given sorted arc-length fractions (each in [0,1]); fractions 0 and 1 return exact endpoints. @returns {Vec2[]} */
export function sampleSegmentAt(p0, edge, p1, fractions)
/** de Casteljau split at parameter u. @returns {[[p0,c1a,c2a,m],[m,c1b,c2b,p1]]} */
export function splitCubic(p0, c1, c2, p1, u)
/**
 * Split outline edge `edgeIndex` of a piece at arc-length fraction t (0 < t < 1). Returns a NEW piece (deep copy) with
 * one more vertex and edge, and an `edgeMap` old → new index for edges ≥ edgeIndex + 1 (shifted by +1). Notches on the
 * split edge are re-parametrised (t' = t/tSplit on the first part or (t - tSplit)/(1 - tSplit) on the second); notches on
 * later edges get edge + 1; foldEdge, pinnedEdges and seams referencing later edges must be shifted by the CALLER using
 * edgeMap (the editor does this in tools/split.js; seams live in doc.seams, not on the piece).
 * @returns {{piece: Piece, edgeMap: number[], newVertex: number}}
 */
export function splitEdge(piece, edgeIndex, t)
/** Polyline of an edge for drawing: 1 chord for 'line'; for 'cubic' the smallest n ≤ 64 with chord error ≤ tol_mm (flatness test on control polygon). @returns {Vec2[]} n+1 points */
export function flattenSegment(p0, edge, p1, tol_mm)
/**
 * Whole outline as a closed polyline: `points` (corners exactly once, CCW as stored), `edgeStart[e]` = index of the first
 * point of edge e (so edge e covers points[edgeStart[e] .. edgeStart[e+1]] with wrap-around).
 * @returns {{points: Vec2[], edgeStart: number[]}}
 */
export function flattenPiece(piece, tol_mm = 0.5)
```

Arc-length inversion: `paramAtArcFraction` finds the table interval `k` with `T[k] ≤ t·L ≤ T[k+1]` by binary search and returns `(k + (t·L − T[k])/(T[k+1] − T[k]))/64`. Error ≤ 0.02 % of length for any garment curve (64 chords).

### 5.2 `polygon.js` — predicates and distances

```js
export function signedArea(pts)                 // shoelace; > 0 for CCW; mm²
export function isCCW(pts)                      // signedArea(pts) > 0
export function ensureCCW(pts)                  // returns pts (same array) or a reversed COPY when signedArea < 0
export function reverseOutline(piece)           // NEW piece with vertices/edges reversed (cubic c1/c2 swapped), notches t → 1 - t and edge remapped, foldEdge/pinnedEdges remapped; used by the editor to fix CW drawings
export function segmentsIntersect(a, b, c, d)   // proper or touching intersection of segments ab and cd; eps 1e-9 mm² on the cross products
export function isSimplePolygon(pts)            // O(n²) pairwise test skipping adjacent segments; returns false if any two non-adjacent segments intersect or if a vertex repeats within 1e-6 mm
export function pointInPolygon(pt, pts)         // even-odd ray crossing; points ON the boundary count as inside (tolerance 1e-6 mm via distToPolyline when the crossing test is ambiguous)
export function distToSegment(pt, a, b)         // {dist, t, point}
export function distToPolyline(pt, pts, closed) // {dist, seg, t, point}  nearest segment index `seg` and its parameter
export function bbox(pts)                       // {minX, minY, maxX, maxY}
export function centroid(pts)                   // area-weighted centroid {x, y} (falls back to vertex mean when |area| < 1e-9)
export function polylineLength(pts, closed)
export function resamplePolyline(pts, closed, spacing_mm)  // points every ≤ spacing_mm along the polyline, corners kept
export function translatePoints(pts, dx, dy)    // new array
export function scalePoints(pts, sx, sy, ox, oy) // new array, about (ox, oy)
```

`isSimplePolygon` and `pointInPolygon` work on flattened polylines; callers pass `flattenPiece(piece).points` for curved outlines. Validation of a piece (`pattern/validate.js`) uses `flattenPiece(piece, 0.2)`.

### 5.3 `mirror.js` — fold pieces

A fold piece stores the half with `x ≥ foldX` where `foldX = vertices[foldEdge][0]` (both fold vertices share this x; validation enforces `|Δx| < 1e-6` and that the edge is `'line'`). `M(p) = [2·foldX − p[0], p[1]]`.

```js
/**
 * Full outline of a piece. Non-fold pieces: {vertices: copy, edges: copy, edgeOf: [[0..n-1]], mirroredEdgeOf: [], n}.
 * Fold pieces: the closed loop that starts at vertices[foldEdge + 1], follows the original edges foldEdge+1, ..., foldEdge−1
 * (mod n), reaches vertices[foldEdge] (on the fold), then follows the MIRRORED original edges in reverse order
 * (foldEdge−1, ..., foldEdge+1) back to vertices[foldEdge + 1]. The fold edge itself disappears; the two fold vertices are
 * shared. Cubic control points of a mirrored edge are M(c2), M(c1) (order swapped because the edge is traversed backwards).
 * Result is CCW (asserted; if the stored half was CCW the loop is CCW by construction).
 *   fullEdgeOf[mirror][e]  → index of outline edge (mirror ? mirrored : original) e in the full loop, or -1 for the fold edge
 *   fullEdgeReversed[e]    → true for mirrored edges (traversed p1 → p0 relative to the original direction)
 * @returns {{vertices: Vec2[], edges: Edge[], fullEdgeOf: number[][], fullEdgeReversed: boolean[], foldX: number|null}}
 */
export function fullOutline(piece)
export function mirrorPoint(p, foldX)           // M(p)
export function mirrorPiece(piece)              // NEW non-fold piece whose vertices/edges are the full outline (used by export for CUT-2 previews and by the 2D ghost)
```

### 5.4 `prng.js`

```js
export function mulberry32(seed)   // returns () => number in [0,1); deterministic
export function jitterSeed(piece)  // hashString(piece.id) ^ (Math.round(effectiveMeshSpacing(piece) * 1000)) >>> 0
```

### 5.5 `delaunay.js` — Bowyer–Watson with constraint recovery

```js
/**
 * Delaunay triangulation of 2D points (Float64Array 2N or Vec2[]). Bowyer–Watson with a super-triangle 1000× the bbox,
 * points inserted in x-sorted order, candidate bad triangles found by a full scan (T ≈ 2N; N ≤ 4500 → ≤ 50 ms), incircle test
 * on coordinates normalised to the unit square with eps = 1e-12. Returns CCW triangles as a Uint32Array (3T).
 * Degenerate (duplicate within 1e-9, or all collinear) → GeometryError 'Delaunay'.
 */
export function delaunay(points)
/**
 * Constrained recovery (Sloan 1993): for every constraint edge (a,b) missing from `tris`, collect the triangulation edges
 * crossing segment ab, and flip each crossing edge whose quadrilateral is convex; repeat until (a,b) exists (max 4N flips,
 * else GeometryError 'Constraint'). Edges are never split — vertex count is preserved, which is what keeps seam parity.
 * Afterwards restores the Delaunay property for non-constraint edges by flips (optional quality pass, max 2 sweeps).
 * @param {Uint32Array} tris in/out (returns a new array) @param {Uint32Array|number[]} constraints 2C vertex pairs
 */
export function recoverEdges(points, tris, constraints)
/** Half-edge adjacency: for each undirected edge (i<j) the two triangle ids (or -1). @returns {{edges: Uint32Array, triA: Int32Array, triB: Int32Array, edgeIndex: Map<number, number>}} key = i * 2^21 + j */
export function buildAdjacency(vertexCount, tris)
```

### 5.6 `remesh.js` — outline → `PieceMesh`

```js
/** Effective spacing used for the piece and, symmetrically, for its seam partners. Pure function of the piece + factor. */
export function effectiveSpacing(piece, spacingFactor = 1)
  // h0 = effectiveMeshSpacing(piece) * spacingFactor  (clamp 8..40 applied before the factor)
  // full-outline area A (mm²) via fullOutline + flattenPiece; estimated V = A / (0.866 h0²) + perimeter / h0
  // if V > 4000: h = h0 * sqrt(V / 4000) (rounded up to 0.5 mm) and a 'spacing-raised' warning is recorded; else h = h0
/**
 * Seam-consistent sample fractions for one outline edge (before mirroring). For a free edge: n = max(1, ceil(L / h)),
 * fractions i/n plus the piece's notch fractions on that edge (a uniform fraction within 0.35/n of a notch fraction is
 * dropped, the notch fraction inserted). For an edge that is side a or b of a seam in doc.seams: partner (pieceP, edgeP);
 * n = max(2, ceil(max(L / h, LP / hP))) with hP = effectiveSpacing(pieceP, spacingFactor); the fraction set is the union of
 * uniform i/n, this edge's notch fractions, and the partner's notch fractions mapped through the pairing
 * (t ↦ reverse ? 1 − t : t, where reverse = a.reverse || b.reverse), deduplicated with the same 0.35/n rule. Both partners
 * compute IDENTICAL sets because the rule is symmetric — that is the seam-parity invariant (checked by cloth/state.js).
 * An edge in more than one seam (allowed: a side edge sewn to a partner and a mirrored partner) uses the union over all seams.
 * @returns {number[]} sorted, starts with 0 and ends with 1
 */
export function seamSampleFractions(piece, edgeIndex, doc, spacingFactor = 1)
/**
 * @param {Piece} piece  @param {ProjectDoc} doc (for seams; may be {seams: []})  @param {{spacingFactor?: number}} [opts]
 * @returns {PieceMesh}  throws Error{code:'RemeshError', pieceId, reason}
 */
export function remeshPiece(piece, doc, opts)
```

Algorithm of `remeshPiece` (all in mm):

1. **Validate**: `n ≥ 3`, `edges.length === n`, signedArea of `flattenPiece(piece, 0.2).points` > 0 and `isSimplePolygon` true, fold edge (if any) vertical and `'line'` → else `RemeshError` with `reason` `'outline'` / `'fold'`.
2. **h** = `effectiveSpacing(piece, opts.spacingFactor)`.
3. **Boundary samples** per original edge `e` (skip the fold edge): `F_e = seamSampleFractions(piece, e, doc, factor)`; `P_e = sampleSegmentAt(p0, edge, p1, F_e)`. The full outline is walked as in `fullOutline`: for original edges the points are appended in order; for mirrored edges the mirrored points `M(P_e)` are appended in reverse. Consecutive duplicates (shared corners) are merged: each corner appears once. Vertex ids are assigned in walk order: boundary ids `0 .. Nb − 1`. `edgeVerts[0][e]` = ids of `P_e` from the edge's start to its end (Nb-cyclic lookup); `edgeVerts[1][e]` = ids of the mirrored samples ordered from `M(p0)` to `M(p1)` (so the direction convention of `SeamSide` holds: "from the edge's start vertex to its end vertex, for the original copy and for the mirrored copy alike"); `edgeVerts[*][foldEdge]` = empty `Uint32Array`; `edgeVerts[1] = []` for non-fold pieces. `notchVerts[m][k]` = the boundary id at notch k's fraction on copy m (the fraction was forced into `F_e`).
4. **Interior lattice**: bbox of the boundary polygon; rows `y_j = minY + j·h·√3/2`, columns `x_i = minX + i·h + (j odd ? h/2 : 0)`; jitter each point by `(rnd()·2 − 1)·0.15h` per axis with `mulberry32(jitterSeed(piece))`; keep points with `pointInPolygon` true and `distToPolyline(pt, boundary, true).dist ≥ 0.6h`. Ids continue after the boundary ids.
5. **Delaunay** on all points, then **`recoverEdges`** with the boundary segments `(b_k, b_{k+1})` as constraints (so every boundary segment is a triangulation edge without adding vertices).
6. **Trim**: drop triangles whose centroid is outside the boundary polygon (`pointInPolygon`) — removes the super-triangle fan and concave-pocket triangles; orient every remaining triangle CCW (swap two indices when its signed area < 0). Drop unused interior points (never happens for boundary points) and compact ids (boundary ids keep `0..Nb−1`).
7. **Quality**: min angle over all triangles, `pctAbove20` = % of triangles with min angle > 20°, median edge length, T. If `pctAbove20 < 95` → retry once from step 4 with `jitterSeed + 1`; if still < 95 keep the better and add warning `'quality'`. If step 5 threw (`'Constraint'`), retry from step 4 with the interior points within `1.0h` of the failing segment removed; if it throws again, fallback **ear clipping** of the boundary polygon alone (no interior points) with warning `'fallback-earclip'` (valid, coarse; the sim still runs).
8. **Arrays**: `positions2d` (Float32Array 2V), `triangles` (Uint32Array), `edges` from `buildAdjacency` (unique, `i < j`, sorted by `(i, j)`), `bendPairs` for every edge with `triA ≥ 0 && triB ≥ 0`: `[v0, v1, v2, v3]` with `v2` the vertex of `triA` not on the edge and `v3` that of `triB`; `boundary` = ids `0..Nb−1` (already a closed CCW loop); `area_mm2` = |signedArea(boundary polygon)|; `vertexCount = V`.
9. **Invariants** (assert, else `RemeshError 'internal'`): Euler `V − E + T = 1`; every boundary segment is an edge with exactly one adjacent triangle; all interior edges have two; `edgeVerts[m][e].length === F_e.length` for every non-fold edge.

Costs (T-shirt front at h = 15: full outline 480 × 620 mm → V ≈ 1500): step 4 ≈ 2 ms, step 5 ≈ 40 ms, rest < 5 ms. `remeshPiece` must finish in ≤ 200 ms for the largest sample piece (acceptance).

### 5.7 `offset.js` — seam allowance

```js
/**
 * Offset a closed CCW polyline outward by a per-point allowance. allowance[k] applies to segment k → k+1. Algorithm:
 *  1. resample the polyline at ≤ 2 mm chords, carrying each point's allowance (the segment it came from);
 *  2. for each segment compute the outward-offset segment (normal [d.y, −d.x]);
 *  3. join consecutive offset segments: equal allowances → intersection of the two offset lines (mitre) when the turn is
 *     convex and the mitre length ≤ 4·allowance, else a round join (arc with 5° steps); concave turns → intersection
 *     (trimmed); DIFFERENT allowances (discontinuity, e.g. hem 25 next to side 10) → "hem square-off": the larger offset
 *     segment is extended to the line perpendicular to the smaller-allowance edge through the corner, i.e. the cut line steps
 *     straight across; a zero allowance keeps the corner on the stitch line (the fold edge);
 *  4. loop removal: full O(n²) segment-pair scan over the offset polyline; every self-intersection loop that has NEGATIVE
 *     orientation (an inverted pocket at a sharp concave corner) is cut out (n ≤ 4000 → ≤ 8 M cheap tests);
 *  5. validate: isSimplePolygon and signedArea(result) > signedArea(input); on failure fall back to round joins everywhere
 *     and re-run once, then throw GeometryError 'Offset'.
 * @param {Vec2[]} stitch closed CCW polyline @param {number[]} allowance per point (mm; ≤ 0 → 0)
 * @param {{join?: 'mitre'|'round', mitreLimit?: number}} [opts]
 * @returns {Vec2[]} closed CCW cut polygon (corners once; no trailing duplicate)
 */
export function offsetPolygon(stitch, allowance, opts)
/**
 * Piece convenience used by the editor's allowance ghost and the export: flattenPiece at 0.5 mm, per-point allowance from
 * piece.edges[e].allowance_mm ?? piece.seamAllowance_mm with the fold edge forced to 0; returns offsetPolygon(...).
 * For fold pieces the result is the HALF outline's cut line (the fold edge stays on x = foldX).
 */
export function offsetOutline(piece, opts)
```

### 5.8 `pack.js` — sheet packing

```js
/**
 * Shelf packer for the print sheet: items sorted by height desc, placed left-to-right on shelves of the sheet width
 * with `gap` between items; a new shelf starts when the next item does not fit. Rotation by 90° is tried for an item that
 * does not fit the remaining shelf width but fits rotated (only when allowRotate). Returns placements in item order.
 * @param {{id:string, w:number, h:number}[]} items mm @param {number} sheetWidth mm @param {{gap?: number, allowRotate?: boolean}} [opts] gap default 10
 * @returns {{placements: {id:string, x:number, y:number, rotated:boolean}[], width:number, height:number}}
 */
export function packRects(items, sheetWidth, opts)
```

### 5.9 `index.js` and `selftest.js`

`index.js` re-exports every name above. `selftest.js` exports `runSelfTest(): Promise<SelfTestResult[]>` with these cases (names are the `name` fields):

1. `bezier.length` — the cubic `[0,0] [0,100] [100,100] [100,0]` has length 200.0 ± 0.5 (analytic 200.0 for this symmetric case is ≈ 199.9); `sampleSegment(..., 4)` returns 5 points with the 1st and last exact.
2. `bezier.split` — `splitEdge` on a 4-edge square at edge 1, t 0.5 → 5 vertices, `edgeMap[3] === 4`, notch on edge 3 moves to 4.
3. `polygon.predicates` — `signedArea` of the unit CCW square = 1; `isSimplePolygon` false for a bow-tie; `pointInPolygon` true at the centre, false outside, true on an edge.
4. `mirror.fullOutline` — a fold piece with 4 vertices (fold edge on x = 0) yields a full loop with 6 edges, CCW, and `fullEdgeOf[1][foldEdge] === -1`.
5. `delaunay.basic` — 200 random points → Euler characteristic of the hull triangulation holds; every triangle CCW; no point inside any circumcircle (sampled check on 50 triangles).
6. `delaunay.recover` — a constraint edge crossing 3 triangulation edges is recovered with no vertex added.
7. `remesh.square` — 100 × 100 mm square, h 15 → `pctAbove20 ≥ 98`, V ∈ [40, 70], `boundary.length === 28` (4 edges × 7 segments), Euler holds.
8. `remesh.seamParity` — two pieces sharing a seam whose edges are 300 mm and 315 mm long, h 15 → both sides have exactly `max(2, ceil(315/15)) + 1 = 22` vertices.
9. `remesh.fold` — the T-shirt sample front (`getSample('tshirt')`) → `edgeVerts[1]` present, `edgeVerts[1][foldEdge].length === 0`, V ∈ [1100, 2000], `pctAbove20 ≥ 98`.
10. `remesh.notch` — a notch at t 0.5 on a 100 mm edge with h 15 → the boundary contains the point at 50 mm exactly (a vertex id in `notchVerts[0]`).
11. `offset.square` — 100 × 100 square with allowance 10 → cut bbox 120 × 120 ± 0.01, simple, `signedArea` 14400 ± 1 (mitre joins).
12. `offset.discontinuity` — square with allowances [25, 10, 10, 10] (hem on edge 0) → the cut polygon has the hem corners squared off: its bbox is 120 wide and 135 tall.
13. `offset.fold` — T-shirt front: `offsetOutline` keeps `minX ≥ −0.05` (no allowance across the fold).
14. `pack.shelf` — 5 items on a 1000 mm sheet: no overlaps, `height` ≤ sum of the two tallest.
15. `remesh.performance` — T-shirt front `remeshPiece` < 200 ms (details: ms).

---

**PROPOSED types.js amendment:** none. `PieceMesh` is produced exactly as typed; the recovery of boundary edges by flipping (never by insertion) means `edgeVerts` counts are fixed by `seamSampleFractions` alone.

---

## 6. Parametric body (`src/body/`) — agent A3

Procedural human body from 20 parameters, no assets. Outputs a `BodyModel` (section 3.1): landmarks, anchors, torso rings, a baked `SdfGrid` for collision, a render mesh, and measured circumferences. Imports: `core/types.js`, `core/sdf.js` (`makeGridFromFn`, `sampleSdf`), `core/units.js`; `body/mesh.js` is the only file that imports `three` (`BufferGeometryUtils.mergeGeometries` from `three/addons/utils/BufferGeometryUtils.js`). Everything is in **metres, y up, model faces +z, +x = the model's LEFT**; parameters are cm (`_cm`), converted once in `skeleton.js`.

Files: `params.js`, `presets.js`, `skeleton.js`, `primitives.js`, `loft.js`, `bake.js`, `measure.js`, `anchors.js`, `mesh.js`, `index.js`, `selftest.js`.

### 6.1 Parameters and presets (`params.js`, `presets.js`)

`PARAM_DEFS` (ordered array; the Body panel renders sliders in this order; ids `body-<key>` per section 11):

| key | label | default (female_m) | min | max | step | drives |
|---|---|---|---|---|---|---|
| `height_cm` | Height | 165 | 120 | 210 | 0.5 | every landmark height (fractions of H), head/limb scale factor `s = H / 175` |
| `chest_cm` | Chest / bust | 88 | 60 | 150 | 0.5 | chest + armpit ring perimeters |
| `underbust_cm` | Underbust | 76 | 55 | 130 | 0.5 | underbust ring |
| `waist_cm` | Waist | 70 | 50 | 140 | 0.5 | waist ring |
| `hips_cm` | Hips | 96 | 65 | 160 | 0.5 | hip + crotch ring, buttocks, pelvis |
| `shoulderWidth_cm` | Shoulder width | 38 | 28 | 56 | 0.5 | shoulder joint x, shoulder ring half-width |
| `neck_cm` | Neck | 34 | 26 | 50 | 0.5 | neck capsule radius, neck-base ring |
| `upperArm_cm` | Upper arm | 27 | 18 | 50 | 0.5 | upper-arm cone radius |
| `forearm_cm` | Forearm | 23 | 16 | 40 | 0.5 | forearm cone radius |
| `wrist_cm` | Wrist | 15.5 | 12 | 24 | 0.5 | wrist radius |
| `thigh_cm` | Thigh | 54 | 35 | 85 | 0.5 | thigh cone radius |
| `calf_cm` | Calf | 36 | 25 | 55 | 0.5 | calf radius |
| `ankle_cm` | Ankle | 22 | 16 | 32 | 0.5 | ankle radius |
| `armLength_cm` | Arm length | 56 | 40 | 80 | 0.5 | shoulder joint → wrist |
| `inseam_cm` | Inseam | 76 | 50 | 100 | 0.5 | crotch height |
| `torsoLength_cm` | Back length | 40 | 30 | 55 | 0.5 | neck base → waist |
| `headHeight_cm` | Head height | 22 | 17 | 27 | 0.5 | head ellipsoid, chin height |
| `bustFullness` | Bust fullness | 0.4 | 0 | 1 | 0.01 | breast ellipsoid scale, chest ring reduction |
| `armAbduction_deg` | Arm angle (A-pose) | 30 | 15 | 60 | 1 | upper/forearm direction |
| `legSpread_deg` | Leg spread | 6 | 0 | 20 | 1 | leg direction |

```js
export const PARAM_DEFS            // [{key, label, min, max, step, unit:'cm'|''|'deg'}]
export const PARAM_KEYS            // keys in table order (20)
export function clampParams(p)     // NEW BodyParams: each key clamped to [min,max] and rounded to step; missing keys → female_m default; extra keys dropped
export function paramsEqual(a, b)  // strict equality on all 20 keys
```

`presets.js`:

```js
export const DEFAULT_PRESET_ID = 'female_m'
export const BODY_PRESETS      // Record<string, BodyParams>, frozen, insertion order = UI order below
export const PRESET_LABELS     // Record<string, string>
export function listPresets()  // [{id, label}]
```

| id | label | height | chest | underbust | waist | hips | shoulderW | neck | upperArm | forearm | wrist | thigh | calf | ankle | armLen | inseam | torsoLen | head | bust | armAbd | legSpr |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `female_s` | Female S | 160 | 84 | 72 | 66 | 92 | 37 | 33 | 25.5 | 22 | 15 | 51 | 34.5 | 21.5 | 54 | 74 | 39 | 21.5 | 0.35 | 30 | 6 |
| `female_m` | Female M | 165 | 88 | 76 | 70 | 96 | 38 | 34 | 27 | 23 | 15.5 | 54 | 36 | 22 | 56 | 76 | 40 | 22 | 0.4 | 30 | 6 |
| `female_l` | Female L | 170 | 96 | 82 | 78 | 104 | 40 | 35.5 | 30 | 25 | 16.5 | 58 | 38 | 23 | 58 | 78 | 41.5 | 22.5 | 0.5 | 30 | 6 |
| `male_s` | Male S | 172 | 92 | 85 | 78 | 94 | 44 | 37.5 | 28 | 25.5 | 17 | 53 | 36.5 | 23 | 60 | 80 | 43 | 22.5 | 0 | 30 | 6 |
| `male_m` | Male M | 178 | 98 | 90 | 84 | 98 | 46 | 39 | 30 | 27 | 17.5 | 56 | 38 | 23.5 | 62 | 82 | 44 | 23 | 0 | 30 | 6 |
| `male_l` | Male L | 184 | 108 | 98 | 96 | 106 | 48 | 41 | 33 | 29 | 18.5 | 61 | 40.5 | 24.5 | 64 | 84 | 46 | 23.5 | 0 | 30 | 6 |
| `child_10` | Child (10 y) | 140 | 68 | 62 | 60 | 72 | 31 | 28 | 20 | 18 | 13 | 40 | 28 | 19 | 47 | 65 | 33 | 20 | 0 | 30 | 6 |
| `plus_f` | Female plus | 168 | 112 | 98 | 100 | 122 | 41 | 38 | 36 | 28 | 17.5 | 68 | 43 | 25 | 57 | 76 | 41 | 22.5 | 0.7 | 32 | 8 |
| `athletic_m` | Male athletic | 182 | 104 | 94 | 82 | 98 | 49 | 40 | 34 | 29 | 18 | 60 | 40 | 24 | 64 | 84 | 45 | 23 | 0 | 30 | 6 |

### 6.2 Skeleton and landmarks (`skeleton.js`)

`buildSkeleton(params) → {H, s, y: {...}, landmarks, joints, dirs}` (all metres). With `H = height_cm/100`, `s = H / 1.75`, and the parameters converted (`T = torsoLength_cm/100`, etc.):

| height (y) | formula (female_m value) |
|---|---|
| `headTop` | `H` (1.650) |
| `chin` | `H − headHeight` (1.430) |
| `neckBase` | `chin − 0.012·H` (1.410) — the C7 / shoulder-neck point, reference for `torsoLength` |
| `shoulder` (acromion) | `neckBase − 0.035·H` (1.352) |
| `armpit` | `shoulder − 0.060·H` (1.253) |
| `waist` | `neckBase − T` (1.010) |
| `chest` | `waist + 0.45·T` (1.190) |
| `underbust` | `waist + 0.28·T` (1.122) |
| `crotch` | `inseam` (0.760) |
| `hip` | `crotch + 0.40·(waist − crotch)` (0.860) |
| `knee` | `0.285·H` (0.470) |
| `ankle` | `0.040·H` (0.066) |

Joints and directions (`+x` = model's left; the left side is `+`, the right side `−`):

* `shoulderL/R = [±(shoulderWidth/2), shoulder − 0.02·H, 0.0]`.
* Upper-arm direction `dUA = normalize([±sin(abd), −cos(abd), 0.087])` (5° forward, `abd = armAbduction_deg`); `elbowL/R = shoulder + 0.53·armLength·dUA`; forearm direction `dFA = normalize([±sin(abd − 5°), −cos(abd − 5°), 0.12])`; `wristL/R = elbow + 0.47·armLength·dFA`; hand centre `= wrist + 0.09·s·dFA`.
* `hipJointL/R = [±0.095·s·(hips_cm/96)^0.5, crotch + 0.03·H, 0]`; leg direction `dLeg = normalize([±sin(legSpread/2), −cos(legSpread/2), 0])`; `kneeL/R = hipJoint + (hipJoint.y − knee)/cos(legSpread/2)·dLeg`… i.e. the knee lies at height `knee` along `dLeg`; `ankleL/R` likewise at height `ankle`; foot from ankle to `ankle + [0, −0.03, 0.20·s]`.
* Landmarks record (all keys of `BodyModel.landmarks`): `headTop [0,H,0.01]`, `chin [0,chin,0.03]`, `neckBase [0,neckBase,−0.01]`, `shoulderL/R`, `elbowL/R`, `wristL/R`, `chestCenter [0,chest,0]`, `waistCenter [0,waist,0]`, `hipCenter [0,hip,0]`, `crotch [0,crotch,0]`, `hipJointL/R`, `kneeL/R`, `ankleL/R`.

### 6.3 Primitives and the analytic SDF (`primitives.js`, `loft.js`)

Distance functions (Quilez), all returning metres, `p` in world space:

* `sdSphere(p, c, r) = |p − c| − r`
* `sdEllipsoid(p, c, r)`: `q = (p − c)/r`, `k0 = |q|`, `k1 = |(p − c)/r²|`, `d = k0·(k0 − 1)/k1` (k1 → 0 guard: return `|p − c| − min(r)`).
* `sdRoundCone(p, a, b, r1, r2)`: exact round cone between centres `a` (radius `r1`) and `b` (radius `r2`) (Quilez `sdRoundCone`); a capsule is the special case `r1 = r2`.
* `sdCapsuleZ` for feet is `sdRoundCone` with equal radii.
* **Torso loft** (`loft.js`): rings from bottom to top `crotch, hip, waist, underbust, chest, armpit, shoulder, neckBase`, each `{y, a, b, n: 2.4, cz}` (half-width `a` along x, half-depth `b` along z, superellipse exponent `n`, z-centre `cz`). For a query `p`: `(a, b, cz)` at height `p.y` by Catmull-Rom over the rings (clamped beyond the ends); `θ = atan2(p.z − cz, p.x)`; `R(θ) = (|cosθ/a|ⁿ + |sinθ/b|ⁿ)^(−1/n)`; `d2 = hypot(p.x, p.z − cz) − R(θ)`; caps: `dy = |p.y − ymid| − halfLen` with `ymid = (y_crotch + y_neckBase)/2`, `halfLen = (y_neckBase − y_crotch)/2`; `d = min(max(d2, dy), 0) + hypot(max(d2, 0), max(dy, 0))`. (`d2` is not an exact Euclidean distance for a superellipse; it is within 3 % of it for aspect ratios ≥ 0.5, which the 15 mm grid + `smin` absorb; the cloth only needs a consistent signed field with a good gradient.)

Ring dimensions from circumferences: for a ring with aspect `k = b/a` (below), the superellipse perimeter is homogeneous of degree 1, so `a = C / P₁(k, n)` where `P₁(k, n)` is the perimeter of the unit superellipse `(1, k)` summed over 256 samples of `θ` (cached per `(k, n)`), `b = k·a`. Ring table (C in metres = `_cm/100`; the "reduction" terms compensate the volume that the blended breasts/buttocks add, so that `measure.js` lands within tolerance — **A3 tunes these constants against the measured values in the self-test; they are starting points, not law**):

| ring | y | C | k = b/a | cz |
|---|---|---|---|---|
| crotch | `crotch` | `0.90·hips` | 0.72 | −0.010 |
| hip | `hip` | `hips − 0.03` | 0.72 | −0.015 |
| waist | `waist` | `waist` | 0.74 | 0.000 |
| underbust | `underbust` | `underbust` | 0.68 | 0.010 |
| chest | `chest` | `chest − 0.14·bustFullness` | 0.66 | 0.010 |
| armpit | `armpit` | `0.98·chest − 0.10·bustFullness` | 0.62 | 0.005 |
| shoulder | `shoulder` | `2·P₁(0.55)·(shoulderWidth/2 − 0.045·s)` (i.e. `a = shoulderWidth/2 − 0.045·s`) | 0.55 | 0.000 |
| neckBase | `neckBase` | `1.35·neck` | 0.85 | −0.005 |

Other primitives (`s = H/1.75`; radii from circumferences `r = C/(2π)`):

| # | part | primitive | placement / size |
|---|---|---|---|
| 1 | head | ellipsoid | centre `[0, chin + headHeight/2, 0.01]`, radii `[0.34, 0.5, 0.41]·headHeight` |
| 2 | neck | round cone | `[0, shoulder + 0.01, 0.00]` r `neck/2π·1.05` → `[0, chin − 0.005, 0.015]` r `neck/2π` |
| 3–4 | shoulders | sphere | at `shoulderL/R`, r `0.055·s·(shoulderWidth_cm/38)^0.5` |
| 5–6 | breasts | ellipsoid | centre `[±0.085·(chest_cm/88), chest + 0.01, cz_chest + b_chest − 0.025]`, radii `[0.070, 0.060, 0.045]·(0.5 + bustFullness)` |
| 7–8 | buttocks | ellipsoid | centre `[±0.080·(hips_cm/96), hip − 0.02, cz_hip − b_hip + 0.03]`, radii `[0.090, 0.080, 0.060]·(hips_cm/96)` |
| 9 | pelvis fill | ellipsoid | centre `[0, crotch + 0.06, 0]`, radii `[hipJointL.x + 0.03, 0.09, 0.85·b_hip]` |
| 10–11 | upper arms | round cone | `shoulder` r `upperArm/2π` → `elbow` r `(upperArm + forearm)/2/2π` |
| 12–13 | forearms | round cone | `elbow` r `forearm/2π` → `wrist` r `wrist/2π` |
| 14–15 | hands | ellipsoid | centre `wrist + 0.09·s·dFA`, radii `[0.045, 0.09, 0.02]·s` rotated so the long axis follows `dFA` (implement as a point transform into the hand frame before `sdEllipsoid`) |
| 16–17 | thighs | round cone | `hipJoint` r `thigh/2π` → `knee` r `(thigh + calf)/2/2π` |
| 18–19 | shanks | round cone | `knee` r `calf/2π` → `ankle` r `ankle/2π` |
| 20–21 | feet | capsule | `ankle + [0, −0.03, −0.03]` → `ankle + [0, −0.03, 0.20·s]`, r `0.035·s` |

`smin(a, b, k) = min(a, b) − h²·k/4` with `h = max(k − |a − b|, 0)/k`, `k = 0.04`. **Evaluation order** (`sdBody(p)` in `primitives.js`): `d = loft(p)`; then `smin` with pelvis, each breast, each buttock, each shoulder sphere, neck, head, each upper arm, each thigh; then plain `min` with forearms, hands, shanks, feet. Every primitive carries a bounding sphere `(c, R)`; `sdBody` skips a primitive when `|p − c| − R > d + k` (a lower bound on its distance cannot change the result) — this is the per-cell cull the bake relies on.

`export function analyticBody(params) → {sd: (x,y,z) => number, prims: Primitive[], skeleton, rings, aabb}` builds the closure once per `buildBody`.

### 6.4 Baking (`bake.js`)

```js
/** @returns {SdfGrid} */
export function bakeSdf(analytic, cell)
```

Grid extent: union of primitive AABBs (bounding spheres) padded by 0.10 m; `origin = min`, `nx = ceil((max − min).x / cell) + 1` etc. `cell = 0.015` (full; female_m ≈ 78 × 126 × 36 ≈ 354 k nodes) or `0.030` (coarse; ≈ 45 k nodes). `data = Float32Array`, filled by `makeGridFromFn(origin, cell, nx, ny, nz, analytic.sd)`. Budget: full ≤ 400 ms, coarse ≤ 80 ms on the reference laptop (the cull in 6.3 gives ≈ 6 evaluated primitives per node). Nodes outside every bounding sphere by more than `0.10 m` may take the cheapest lower bound (`min over prims of |p − c| − R`) instead of the exact value — the cloth never reaches them and it halves bake time. Result is a NEW object every bake (the app swaps the reference atomically).

### 6.5 Measuring (`measure.js`)

```js
/** @returns {{chest_cm:number, waist_cm:number, hips_cm:number}} */
export function measureBody(grid, rings)
```

For each of `chest`, `waist`, `hip` rings: from the ring centre `[0, y, cz]`, cast 180 rays in the xz-plane (`θ = 2πi/180`); march outward from `r = 0.01` in 5 mm steps until `sampleSdf ≥ 0` (limit `1.5·a` — beyond that the ray has left the torso and would hit an arm; take the last point where the field was negative), then bisect 8 times; sum the chord lengths between consecutive hit points → circumference; convert to cm (1 decimal). Report only (no correction loop in v1); shown in the Body panel as "measured" next to the parameter (section 11) and used by acceptance `body_female_m` (`|measured.chest − 88| ≤ 1.5`, `|waist − 70| ≤ 1.5`, `|hips − 96| ≤ 2.0`).

### 6.6 Anchors (`anchors.js`)

```js
/** @returns {Record<'torso'|'armL'|'armR'|'legL'|'legR'|'skirt'|'head', Anchor>} */
export function buildAnchors(skeleton, rings, params)
```

`CLEARANCE = 0.02` m (already included in `radius`; cloth adds `0.02·layer` on top).

| anchor | origin | axis (down) | front | radius | length |
|---|---|---|---|---|---|
| `torso` | `[0, neckBase, 0]` | `[0,−1,0]` | `[0,0,1]` | `max(a_chest + 0.5·breastRadiusX·(0.5+bust), a_hip) + CLEARANCE` | `neckBase − crotch + 0.15` |
| `skirt` | `[0, waist + 0.02, 0]` | `[0,−1,0]` | `[0,0,1]` | `a_hip + CLEARANCE` | `waist − ankle` |
| `armL` / `armR` | `shoulderL/R − 0.04·dUA` (slightly above the joint so a sleeve cap sits over the shoulder) | `dUA` | `normalize([0,0,1] − (dUA·[0,0,1])·dUA)` | `upperArm/2π + CLEARANCE` | `armLength + 0.06` |
| `legL` / `legR` | `hipJointL/R` | `dLeg` | `normalize([0,0,1] − (dLeg·[0,0,1])·dLeg)` | `thigh/2π + CLEARANCE` | `hipJoint.y − ankle` |
| `head` | `[0, H, 0.01]` | `[0,−1,0]` | `[0,0,1]` | `0.41·headHeight + CLEARANCE` | `headHeight + 0.05` |

`rings` on the model (`BodyModel.rings`) = the loft ring table `{y, a, b, n, cz}` keyed `crotch, hip, waist, underbust, chest, armpit, shoulder, neckBase`.

### 6.7 Render mesh (`mesh.js`)

```js
/** @returns {{positions: Float32Array, normals: Float32Array, indices: Uint32Array}} */
export function buildRenderMesh(analytic)
```

No MarchingCubes. Geometries built with three.js and merged with `BufferGeometryUtils.mergeGeometries([...], false)` (indexed), then `computeVertexNormals()`; arrays copied out (`Float32Array` positions/normals, `Uint32Array` indices) so the model is plain data:

* Torso loft: a `BufferGeometry` lofted from the rings: 1 ring per cm from `crotch − 0.03` to `neckBase`, 48 segments around, evaluating `R(θ)` of the interpolated `(a, b, cz)`; closed with a fan cap at each end.
* Ellipsoids: `SphereGeometry(1, 24, 16)` scaled `(rx, ry, rz)` and positioned (hands: additionally rotated into the `dFA` frame).
* Round cones: `CylinderGeometry(r2, r1, L, 20, 1)` aligned from `a` to `b` (quaternion from `[0,1,0]` to `normalize(a − b)`), plus `SphereGeometry(r, 16, 12)` at each end.
* Feet: `CapsuleGeometry(r, L, 4, 12)` aligned along +z.

Overlaps at joints are accepted (the union renders correctly with depth testing; the `smin` blends exist only in the SDF). Vertex budget ≈ 25 k; built once per full bake (skipped for coarse builds — the coarse `BodyModel.geometry` reuses the previous full mesh if the caller passes it in `opts.reuseGeometry`, else it is built too).

### 6.8 `index.js`

```js
export { PARAM_DEFS, PARAM_KEYS, clampParams, paramsEqual } from './params.js'
export { BODY_PRESETS, DEFAULT_PRESET_ID, PRESET_LABELS, listPresets } from './presets.js'
/**
 * Build the whole model synchronously. cell 0.015 = full (default), 0.030 = coarse.
 * opts.reuseGeometry: a previous BodyModel.geometry to reuse when cell > 0.02 (skips the render mesh).
 * Throws Error{code:'BodyError'} only for non-finite results (never for out-of-range params: they are clamped).
 * @param {BodyParams} params @param {{cell?: number, reuseGeometry?: object}} [opts] @returns {BodyModel}
 */
export function buildBody(params, opts)
export function sampleBody(model, x, y, z, outGrad)   // = sampleSdf(model.sdf, ...)
```

`buildBody` steps: `p = clampParams(params)` → `skeleton` → `analytic` (rings + prims) → `sdf = bakeSdf(analytic, cell)` → `measured = measureBody(sdf, rings)` → `anchors` → `geometry` → `{params: p, landmarks, anchors, rings, sdf, geometry, measured, buildMs}`.

### 6.9 `selftest.js` (`runSelfTest()`)

1. `presets.clamp` — every preset passes `clampParams` unchanged (`paramsEqual`).
2. `skeleton.heights` — female_m: `chin.y = 1.43 ± 1e-6`, `waist = 1.01 ± 1e-6`, `chest ≈ 1.19`, `crotch = 0.76`; `+x` shoulder is `shoulderL`.
3. `sdf.signs` — female_m full: `sampleBody(chestCenter) < −0.05`; `sampleBody(chestCenter + [0,0,0.30]) > 0.15`; `sampleBody(headTop + [0,0.05,0]) > 0.03`; `sampleBody(elbowL) < 0`.
4. `sdf.armpitClearance` — the point midway between the upper-arm axis and the torso surface at `armpit − 0.05` height has `d ≥ +0.025` (arms are clear of the torso so sleeves can drape).
5. `sdf.gradient` — at 200 deterministic points with `0 < d < 0.1`, `|outGrad| = 1 ± 1e-6` and a 2 mm step along `outGrad` increases `d` by `≥ 1.5 mm`.
6. `measure.female_m` — `|measured.chest_cm − 88| ≤ 1.5`, `|waist − 70| ≤ 1.5`, `|hips − 96| ≤ 2.0`.
7. `measure.male_m` — same tolerances for male_m.
8. `measure.allPresets` — every preset: `|measured.chest − chest_cm| ≤ 2.5`, no NaN in `sdf.data`.
9. `anchors.torso` — `radius ∈ [0.16, 0.24]` for female_m; `origin.y = neckBase`; arm anchors' `axis` has negative y and `|axis| = 1`.
10. `mesh.valid` — `indices.length % 3 === 0`, every index `< positions.length/3`, no NaN, ≥ 10 000 vertices.
11. `perf.full` — full build `buildMs < 400`; `perf.coarse` — coarse build `< 80` (details: ms).
12. `stability.range` — building with every parameter at its min and then at its max produces finite grids and `measured` values.

---

**PROPOSED types.js amendment:** none. (`BodyModel.geometry` holds plain arrays as typed; the three.js `BufferGeometry` used during merging is not retained.)

---

## 7. Cloth simulation (`src/cloth/`) — agent A4

> **Amendment (A4 + lead, 2026-09-14) — what actually makes a garment drape.** Four changes beyond the section-7 text,
> each kept because it was measured, not assumed. (1) `arrange()` maps pattern arc length onto the body's own SDF
> cross-section at each height, radially scaled so the section's circumference equals the fabric available there, and the
> `wrap` blend interpolates in polar (angle, radius) rather than Cartesian — chord blending re-opens what the wrap
> closed. This alone took the T-shirt's worst seam gap from 163 mm to 5.4 mm. (2) Pinned seam pairs are welded before pin
> targets are projected, and pinned vertices are placed on the surface with the ease removed; the skirt waist went from a
> permanent 90% strain (its constraint had zero effective mass) to -1%. (3) A one-sided Provot strain limiter at 5%,
> alternated five times with the seam solve inside each substep so the seams still have the last word. (4) Bending runs
> two passes at omega = 0.6 instead of one full pass, paid for by running self-collision every 4th substep instead of
> every 2nd. Rejected on measurement: extra distance passes, more substeps, extra damping, and long-range attachments
> driven by contact anchors — the failure was local and seam-adjacent, not long-range.
>
> Note for section 7.9: `SimStats.maxSpeed` is a projection magnitude, not observed motion. A settled-state check should
> measure vertex drift between frames instead.

> **Amendment (lead, 2026-09-14) — fabric drape ordering fixture.** The ordering check (self-test `cloth/drape.ordering`
> and acceptance check 12 `fabric_ordering`) runs on `makeSphereDrape`, **not** `makeHangingSheet`. A rectangle pinned at
> its own two top corners is a degenerate fixture: the top chord equals its rest length and gravity lies in the sheet's
> plane, so for an inextensible sheet the flat rectangle is the exact gravitational minimum. Measured sag is then ~0.1 mm
> for every preset and is independent of `bend_Nm` (a `bendScale` sweep over 1e-3..1e2 moves it 0.16 -> 0.13 mm), so the
> check could never order fabrics however the table was tuned. A square dropped over a sphere orders by `B/rho` as
> intended: hem depth chiffon 301.2 > silk 300.3 > cotton 292.1 > denim 286.4 mm (spread 14.8 mm >= 10 mm) with the
> section 9.1 table unchanged. Thresholds (strict ordering, >= 10 mm spread, no NaN, penetration < 2 mm) are unchanged.
>
> **Amendment (A4) — long-range attachments.** `src/cloth/lra.js` adds Kim-2012 long-range attachments
> (`|x_v - x_a| <= geodesic(v, a)`, Dijkstra over a 4-ring rest stencil). With one Gauss-Seidel pass per substep a
> distance constraint's steady state carries an artificial compliance `h^2 * sum(w)` (0.37 m/N vs the real 1.44e-4 for
> cotton at 10 mm), which is fabric-independent and made every preset stretch identically; LRA restores inextensibility
> (sheet strain 103% -> 2.7%) for ~0.4 ms/frame at 4k vertices without resisting folding.

Small-step XPBD (Macklin 2019): `dt = 1/60`, `substeps = 10` (`h = 1/600`), **one Gauss–Seidel pass per substep, λ reset every substep**. Pure module: imports only `core/types.js`, `core/sdf.js`, `core/fabrics.js`, `core/units.js`; never `three` or the DOM; flat typed arrays only (`ClothState`, section 3.1); no allocation inside `step`. All lengths metres, time seconds; the SDF is passed to `step` per call so the app can swap grids atomically.

Files: `state.js` (build), `arrange.js`, `solver.js` (`step`), `constraints.js`, `collide.js`, `selfcollide.js`, `hash.js`, `safety.js`, `stats.js`, `testfields.js`, `fixtures.js`, `index.js`, `selftest.js`.

### 7.1 Building the state (`state.js`)

```js
/**
 * @param {{meshes: PieceMesh[], doc: ProjectDoc, fabrics: Map<string, FabricResolved>}} args
 *   meshes: one per piece with simulate === true (order = doc.pieces order); fabrics keyed by FabricInstance id.
 * @returns {ClothState}  throws Error{code:'ClothBuildError', reason}
 */
export function buildCloth({meshes, doc, fabrics})
```

1. **Vertices**: global id = `start_k + localId`; `pieces[k] = {start, count, pieceId, mesh, fabric, layer}`; `V = Σ count`; `pieceOf[v] = k`.
2. **Per-vertex area** `A_v` (m²) = one third of the incident triangle areas from `positions2d` (kept in a side table `aux.get(state).vertexArea`, a `WeakMap` inside `state.js`, so `ClothState` stays exactly as typed). `invMass[v] = 1 / (density_kgm2 · A_v)`; `clearance[v] = collisionOffset_mm/1000 + thickness_mm/2000 + 0.003·layer`; `mu[v] = friction`; `damp[v] = damping`.
3. **Edges** from `mesh.edges`: `eIdx`, `eRest` = 2D rest length (mm → m), `eAlpha[e] = stretchScale · 2 / (√3 · membrane_Nm)` (7.2).
4. **Bending** from `mesh.bendPairs`: `bIdx`, and from the 2D rest positions `bK[4b..4b+3]` (Bergou K vector), `bS[b] = sqrt(3 / (A0 + A1))` (A in m²), `bAlpha[b] = bendScale / bend_Nm`.
5. **Seams**: for each `Seam` `{a, b}`: `va = meshOf(a.pieceId).edgeVerts[a.mirror ? 1 : 0][a.edge]`, `vb` likewise; `reverse = a.reverse || b.reverse`; assert `va.length === vb.length ≥ 2` (else `ClothBuildError 'seam-parity'` naming the seam id); pair `va[i]` with `vb[reverse ? N − 1 − i : i]` → append to `sIdx` (global ids). `sRest0`, `sStart` are filled by `arrange`. Pairs where both vertices are the same id (shared fold vertex) are skipped.
6. **Pins**: `pIdx` = global ids of every vertex in `edgeVerts[m][e]` for `e ∈ piece.pinnedEdges`, both copies `m`; `pTarget` filled by `arrange`. `invMass[pinned] = 0`.
7. **Self-collision exclusions** (`exclStart/exclList`, CSR, sorted): for every vertex its 1-ring (edge neighbours); plus, for every seam pair `(i, j)`: `i ↔ j`, and every vertex within 2 edge-rings of `i` is excluded from every vertex within 2 rings of `j` (and vice versa) — the "seam-neighbour mask" that stops self-collision fighting the sewing.
8. `params` from `doc.sim`: `{dt: 1/60, substeps, gravity: gravity_ms2, sewTime: sewTime_s, selfCollision, selfDist: max(0.004, max over pieces of (thickness_mm + 3)/1000), maxSpeed: 5, maxStep: min(0.5·h_mesh_min, 0.008), bendScale, stretchScale}`; `time = frame = nanCount = 0`; `pos = prev = restPos = 0` until `arrange`.

Also exported from `state.js`: `setFabricParams(state, pieceIndex, fabric)` (rewrites `invMass` (keeping 0 for pins), `clearance`, `mu`, `damp`, `eAlpha`, `bAlpha` of that piece in place), `setSettings(state, simSettings)` (substeps, gravity, sewTime, selfCollision, collisionOffset → clearance rewrite, bendScale/stretchScale → `setScale`), `setScale(state, bend, stretch)` (rewrites every `bAlpha`/`eAlpha` from the fabric values), `setPin(state, v, target)`.

### 7.2 Constraints (`constraints.js`)

XPBD update for a constraint `C` with gradient `∇_i C`, compliance `α`, `α̃ = α/h²`, λ reset to 0 each substep (so `Δλ = −C / (Σ_i w_i|∇_iC|² + α̃)`), `Δx_i = w_i · Δλ · ∇_iC`.

* **Distance** (`eIdx`): `C = |x_i − x_j| − L`, `∇_i C = n = (x_i − x_j)/|x_i − x_j|`, `Σ w|∇C|² = w_i + w_j`. Compliance per edge `α_e = 2/(√3·Y)` where `Y = membrane_Nm` (N/m): in an equilateral lattice an edge spring `k_e = (√3/2)·Y` reproduces the membrane stiffness `Y` independently of the edge length, so **`α_e` is NOT scaled by the rest length**. Skip when `|x_i − x_j| < 1e-9`.
* **Bending** (Bergou/Wardetzky isometric bending, linear form): stencil `x0, x1` (shared edge), `x2` (opposite in triangle A), `x3` (opposite in B). Rest-state cotangents from the 2D positions with `e0 = x1−x0, e1 = x2−x0, e2 = x3−x0, e3 = x2−x1, e4 = x3−x1`, `cot(a,b) = (a·b)/|a×b|`: `c01 = cot(e0,e1), c02 = cot(e0,e2), c03 = cot(−e0,e3), c04 = cot(−e0,e4)`; `K = [c03 + c04, c01 + c02, −c01 − c03, −c02 − c04]` (stored in `bK`); `s = sqrt(3/(A0 + A1))` (stored in `bS`). Runtime: `L = Σ_i K_i x_i` (a 3-vector), `C = s·|L|` (rest state flat ⇒ `C_rest = 0`), `∇_i C = s·K_i·L/|L|`, `Σ w|∇C|² = s²·Σ_i w_i K_i²`. Skip when `|L| < 1e-9`. Energy `½·C²/α` equals the discrete bending energy with `α_b = 1/B`, `B = bend_Nm` (N·m) — so the table values are bending rigidities and the model is mesh-consistent (no `(h/h_ref)²` rescaling).
* **Seam** (`sIdx`): distance constraint with rest length `L(t) = sRest0 · max(0, 1 − (time − sStart)/sewTime)` and `α = 1e-8` m/N; skip when `|x_i − x_j| < 1e-9`. This is a **rest-length ramp**, never a stiffness ramp; sewn pairs are never welded by averaging.
* **Pins** (`pIdx`): `pos = pTarget` (their `invMass` is 0 so no other constraint moves them; the assignment guards against drift from the integrator's damping/clamps).

Order inside a substep: distance → bending → seams → pins → body collision → self-collision.

### 7.3 `step(state, sdf)` (`solver.js`) — exactly one frame

```
g = params.gravity;  sewing = time < params.sewTime
gScale  = sewing ? clamp(time / params.sewTime, 0.15, 1) : 1        // gravity ramp while seams close
dampMul = sewing ? 5 : 1
for s in 0 .. substeps-1:
  // integrate
  for v (invMass > 0): vel.y -= h·g·gScale ; vel *= max(0, 1 − damp[v]·dampMul·h)
                      clamp |vel| ≤ maxSpeed ; prev = pos ; pos += h·vel ; clamp |pos − prev| ≤ maxStep
  solveDistance ; solveBending ; solveSeams ; applyPins
  if sdf: collideBody(state, sdf)                                    // 7.5 (includes CCD-lite + friction)
  if params.selfCollision && (s % 2 === 1): collideSelf(state)     // 7.6
  for v: vel = (pos − prev) / h
time += dt ; frame += 1
safety.check(state) ; return stats.compute(state, sectionTimers)
```

`step` is deterministic for a given state (no `Math.random`, fixed iteration order) — acceptance depends on this. Phase (exported `phase(state)`): `'arranged'` while `frame === 0`, `'sewing'` while `time < sewTime`, else `'draping'` (`'paused'` is an app-level notion).

### 7.4 Arrangement (`arrange.js`)

```js
export function arrange(state, body, doc)   // writes pos/prev/restPos/pTarget, zeroes vel, time = frame = 0, sRest0/sStart
export function pushOut(state, sdf)          // every vertex with d < clearance is moved to d = clearance along the gradient (≤ 3 passes)
```

For piece `k` with `Placement {anchor, side, offset_mm, wrap, flip}` and anchor `A = body.anchors[anchor]` (`O` origin, `â` axis pointing down, `f̂` front): `ŝ = f̂ × â` (points to the model's LEFT for the torso: `[0,0,1] × [0,−1,0] = [1,0,0]`), `dir(θ) = cosθ·f̂ + sinθ·ŝ`, `tan(θ) = −sinθ·f̂ + cosθ·ŝ`; `θ_side` = front 0, left +π/2, back π, right −π/2. `R = A.radius + 0.02·layer`. From the mesh's 2D positions (mm): `cx = (minX + maxX)/2`, `top = maxY`; `sx = flip ? −1 : 1`; for each vertex `(x, y)`:

* `u = (sx·(x − cx) + offset_mm[0]) / 1000` (m along the circumference), `t = (top − y − offset_mm[1]) / 1000` (m down the axis).
* Cylinder position `P_c = O + t·â + R·dir(θ_side + u/R)`; tangent-plane position `P_p = O + t·â + R·dir(θ_side) + u·tan(θ_side)`.
* `pos = (1 − wrap)·P_p + wrap·P_c`.

This maps pattern `+x` to the direction "rightward as seen from outside the body" for every side (the frame `(f̂, ŝ, −â)` is right-handed), which is the samples' convention (section 4.1 rule 10). Then `pushOut(state, body.sdf)`; `prev = restPos = pos`; `vel = 0`; for each seam pair `sRest0 = |x_i − x_j|`, `sStart = 0`; for each pinned vertex `pTarget` = its position projected onto the body surface at `d = clearance + 0.001` (3 Newton steps along the gradient). Pinned vertices are placed after the push-out so the target is collision-free.

### 7.5 Body collision and friction (`collide.js`)

Per vertex with `invMass > 0`: `d = sampleSdf(sdf, x, y, z, grad)` (module-level `Float32Array(3)` scratch; `gridContains` false ⇒ skip). Let `c = clearance[v]`.

1. **CCD-lite**: if `dCache[v] > 0` (was outside last substep) and `d < 0` (now inside) → the vertex crossed the surface: set `pos = prev`, resample `d`, `grad`.
2. **Projection**: if `d < c`: `pos += (c − d)·grad`, `corr = c − d`; else `corr = 0`.
3. **Friction** when `d < c + 0.001` (contact active within 1 mm of the clearance surface, so resting vertices still see friction): `Δ = pos − prev`; `Δn = (Δ·grad)·grad`; `Δt = Δ − Δn`; `m = max(corr, 0.0005)` (0.5 mm floor); if `|Δt| ≤ mu[v]·m` → `pos −= Δt` (static: no tangential slip this substep) else `pos −= Δt·(mu[v]·m/|Δt|)` (kinetic, Macklin 2014).
4. `dCache[v] = d` (post-projection sample not needed; store the pre-projection `d` — stats use `max(c − d, 0)` as penetration).

### 7.6 Self-collision (`selfcollide.js`, `hash.js`)

Vertex–vertex only. `hash.js`: uniform grid with cell size `selfDist`, counting sort into `cellStart/cellEntries` (preallocated for `V`, table size `2·V` rounded to a power of two, hash `(ix·73856093 ^ iy·19349663 ^ iz·83492791) & (size − 1)`), rebuilt each self-collision pass (every 2nd substep). For each vertex `i` and each vertex `j > i` in the 27 neighbouring cells, skip if `j` is in `i`'s exclusion list (binary search in `exclList[exclStart[i] .. exclStart[i+1])`) or both have `invMass = 0`; if `|x_i − x_j| < selfDist` push them apart to `selfDist` weighted by `w_i, w_j` (a hard distance inequality constraint, `α = 0`). At most 16 pairs are processed per vertex per pass. `sectionMs.self` records the time; it is exactly 0 when `selfCollision` is off.

### 7.7 Phases

* `arranged` (after `arrange`): nothing moves until the app calls `drape`.
* `sewing` (`time < sewTime`, default 1 s): seam rest lengths shrink linearly to 0, gravity ramps from 15 % to 100 %, damping ×5. Layers: `clearance` includes `0.003·layer` so an outer layer settles on top of an inner one.
* `draping` afterwards; the app pauses/plays by not calling `step`.

`drape(state)` = `time = 0; frame = 0; sStart = 0` for all seams (re-arms the ramp); the app sets its own `running` flag. `reset(state)` = `pos = prev = restPos`, `vel = 0`, `time = frame = 0`, `nanCount` kept.

### 7.8 Safety (`safety.js`)

* Velocity clamp `maxSpeed = 5 m/s` (8.3 mm per substep) and displacement clamp `maxStep = min(0.5·h_mesh, 8 mm)`, both smaller than the thinnest limb's medial radius (wrist ≈ 25 mm), so tunnelling through a limb in one substep is impossible; CCD-lite covers the remaining sign-flip cases.
* **NaN guard** at the end of `step`: scan `pos`; every non-finite vertex is restored from the last snapshot (or from `restPos` if none) with `vel = 0`; `state.nanCount += count`. If a frame had NaNs, the whole state is restored from the snapshot when the next frame also has NaNs (two in a row). The app detects a NaN event by comparing `stats.nanCount` between frames (there is no event from here; cloth is pure).
* **Snapshot**: every 60 frames with `nanCount` unchanged and `maxSpeed < maxSpeed·0.9`, copy `pos, vel, time, frame` into the side table (`WeakMap`); `snapshot(state)` returns a copy `{frame, time, pos, vel}`; `restore(state, snap)` copies it back (`E_BAD_ARG` if `snap.pos.length !== 3V`).

### 7.9 Stats (`stats.js`)

`compute(state, timers) → SimStats`: `frame, time`; `ms` (sum of the section timers of this frame) and `msAvg` (ring buffer of 60); `verts = V`, `tris = tris.length/3`, `constraints = E + B + S`; `maxSpeed` over `vel`; `maxPenetration_mm = max_v max(clearance[v] − dCache[v], 0)·1000` (0 when no sdf); `seamGapMax_mm` / `seamGapMean_mm` over all seam pairs of `|x_i − x_j|·1000` (regardless of phase — during sewing they simply report the remaining gap); `nanCount`; `running` = the value the caller passed in (`step` sets `true`); `substeps`; `sectionMs = {integrate, distance, bend, seam, collide, self}` from `performance.now()` around each section. `stats(state)` returns the last computed object (or a zeroed one before the first step).

### 7.10 Compliance calibration (the numbers behind section 9.1)

With `h = 15 mm`, `A_v = (√3/2)h² = 1.95·10⁻⁴ m²`, `h_sub = 1/600 s`, and `w = 1/(ρ·A_v)`, the per-substep stiffness ratio `r = α̃ / Σ w|∇C|²` decides how much of a constraint is resolved per substep (`r ≪ 1` rigid, `r ≫ 1` soft; XPBD converges to the same compliance either way, `r` only changes how fast):

* Distance: `Σ w|∇C|² = 2w`, `α̃ = 2·h_sub⁻²/(√3·Y) = 4.16·10⁵/Y` ⇒ `r_stretch = 40.6·ρ/Y`.
* Bending (equilateral stencil: all cotangents 0.577, `K = ±1.155`, `ΣK² = 5.33`, `s² = 3/(2·0.433·h²) = 1.54·10⁴ m⁻²`): `Σ w|∇C|² = w·s²·ΣK² = 4.2·10⁸/ρ`, `α̃ = 3.6·10⁵/B` ⇒ `r_bend = 8.6·10⁻⁴·ρ/B`.

Targets (judges' calibration): `r_stretch ≤ 0.05` for every woven and ≈ 0.02–0.3 for jersey; `r_bend`: denim/leather 0.05–0.3, cotton 0.3–1, jersey/wool 1–3, silk 3–8, chiffon 10–30. Physical Kawabata rigidities (`B_phys`, N·m: cotton 5e-6, denim 1.5e-4, silk 1e-6, jersey 2e-6, wool 2e-5, leather 1e-3, chiffon 3e-7) are 5–30× too soft at a 15 mm mesh (sub-resolution buckling is missing, so real values look crumpled); the table stores **effective** `bend_Nm` values tuned for 15 mm and keeps `B_phys` as a reference column. `sim.bendScale` / `sim.stretchScale` multiply the table globally (Fabric panel sliders, log scale 0.1–10).

| preset | ρ kg/m² | Y N/m | `r_stretch` | `bend_Nm` (eff.) | `B_phys` | `r_bend` |
|---|---|---|---|---|---|---|
| cotton | 0.15 | 8000 | 7.6e-4 | 2.5e-4 | 5e-6 | 0.52 |
| denim | 0.45 | 20000 | 9.1e-4 | 2.0e-3 | 1.5e-4 | 0.19 |
| silk | 0.06 | 3000 | 8.1e-4 | 1.0e-5 | 1e-6 | 5.2 |
| jersey | 0.20 | 400 | 2.0e-2 | 8.0e-5 | 2e-6 | 2.2 |
| wool | 0.28 | 5000 | 2.3e-3 | 1.2e-4 | 2e-5 | 2.0 |
| leather | 0.80 | 50000 | 6.5e-4 | 5.0e-3 | 1e-3 | 0.14 |
| chiffon | 0.035 | 1000 | 1.4e-3 | 1.5e-6 | 3e-7 | 20 |

Sag ordering on the hanging-sheet fixture follows `B/ρ`: chiffon 4.3e-5 < silk 1.7e-4 < cotton 1.7e-3 < denim 4.4e-3 (m³/s² units aside), i.e. sag(chiffon) > sag(silk) > sag(cotton) > sag(denim) as acceptance #12 requires.

### 7.11 Test fields and fixtures (`testfields.js`, `fixtures.js`)

`testfields.js`: `sphereField(centre, radius, cell)` → `makeSphereGrid`; `capsuleField(a, b, r, cell)`; `floorField(y0, cell, extent)` (half-space `d = y − y0`). `fixtures.js`:

```js
/** Flat rectangular sheet in the xy plane, top edge on y = 0 (x from −width/2 to +width/2), hanging in −y; optionally pinned at its two top corners.
 *  Builds a synthetic PieceMesh via geometry-free lattice code local to this file (a regular triangle lattice at `spacing_mm`) so A4 never depends on A1.
 *  Vertex layout (section 13.4 indexes it): row-major, nx = round(width_m*1000/spacing_mm) + 1 columns, ny = round(height_m*1000/spacing_mm) + 1 rows,
 *  vertex id = row*nx + col, row 0 = the top edge (y = 0, pinned corners are ids 0 and nx-1), row ny-1 = the bottom edge.
 *  @returns {ClothState} arranged, with sewTime 0 (no seams) */
export function makeHangingSheet({fabric, width_m, height_m, spacing_mm, pinTopCorners, selfCollision})
/** A width × width sheet dropped from height y0 onto a sphere field (radius r) — penetration fixture. @returns {{state: ClothState, sdf: SdfGrid}} */
export function makeSphereDrape({fabric, width_m, spacing_mm, sphereRadius, dropHeight})
/** Two 100 × 100 mm squares side by side (gap 60 mm) whose facing edges are sewn — seam fixture. @returns {{state: ClothState}} */
export function makeSeamFixture({fabric, spacing_mm})
```

### 7.12 Performance budget (4000 vertices, 10 substeps, reference laptop, main thread)

| section | per frame |
|---|---|
| integrate | 0.4 ms |
| distance (≈ 12 k) | 1.6 ms |
| bending (≈ 8 k) | 2.4 ms |
| seams + pins | 0.1 ms |
| body collision (4 k × 10) | 1.6 ms |
| self-collision (5 passes) | 1.2 ms |
| stats + safety | 0.2 ms |
| **total** | **≈ 7.5 ms** (`msAvg < 16` is the acceptance bar) |

### 7.13 `index.js` and `selftest.js`

`index.js` exports: `buildCloth, arrange, pushOut, step, drape, reset, phase, setFabricParams, setSettings, setScale, setPin, stats, snapshot, restore` and re-exports `fixtures.js` and `testfields.js`.

`runSelfTest()` cases:

1. `bend.flat` — an equilateral 4-vertex stencil in a plane: `C = 0`; the same stencil with `x3` lifted 5 mm: `C > 0`, and one projection with `α = 0` reduces `|C|` by ≥ 90 %.
2. `distance.rigid` — two vertices pulled 10 % apart, cotton α: after one substep the strain is < 0.5 %.
3. `sheet.cotton` — `makeHangingSheet({cotton, 0.3, 0.3, 10, true, true})`, 300 frames: `nanCount 0`, every edge strain < 3 %, `maxSpeed < 0.3` at the end.
4. `sheet.ordering` — sag (bottom-edge midpoint below the bottom corners) chiffon > silk > cotton > denim, difference chiffon − denim ≥ 10 mm.
5. `sphere.penetration` — `makeSphereDrape({cotton, 0.4, 12, 0.15, 0.25})`, 240 frames: `maxPenetration_mm < 2`, `nanCount 0`.
6. `seam.close` — `makeSeamFixture({cotton, 10})`, sewTime 1 s, 120 frames: `seamGapMax_mm < 2`.
7. `friction.slope` — a 0.2 m sheet on a 30° capsule-free floor field (tilted by rotating gravity in the fixture): with `mu = 0.6` its centre of mass moves < 5 mm in 120 frames; with `mu = 0.05` it moves > 50 mm.
8. `determinism` — two identical states stepped 60 frames produce bit-identical `pos`.
9. `nan.recovery` — inject `NaN` into 5 positions: after `step`, `nanCount === 5` and `pos` finite.
10. `fabric.switch` — `setFabricParams` to leather then 120 frames: `nanCount 0`, `eAlpha` values match `2/(√3·50000)`.
11. `perf.4k` — a 4000-vertex sheet, 60 frames: `msAvg < 12` (details: ms).
12. `selfcollision.mask` — in `makeSeamFixture`, no self-collision pair is processed between vertices within 2 rings of the seam (instrumented counter = 0).

---

---

## 8. 3D viewer (`src/viewer3d/`), pop-out (`popout.html`, `src/popout/main.js`) — agent A5

The viewer is a **passive mirror** of data owned by other modules: it reads `BodyModel.geometry` (section 6), `ClothState` (section 7) and `FabricResolved` (section 9.1) **by shape only**, never mutates them, never imports the store or the bus, and never steps the simulation itself. The wiring layer (`src/app/wiring.js`) owns the per-frame `tick` callback (step solver → `sync`), reacts to the events of section 3.2 and calls the API below. Imports allowed: `three`, `three/addons/`, `src/core/` (`types.js`, `fabrics.js`, `ids.js`). DOM access is limited to the container element handed in, `ResizeObserver`, `document.visibilityState`, and (bridge only) `window.open` / `BroadcastChannel`.

Files and exported names (every file also re-exported by `src/viewer3d/index.js`):

| File | Exports |
|---|---|
| `scene.js` | `VIEWER_DEFAULTS`, `DEFAULT_BODY_BOX`, `createViewer(container, opts)` |
| `bodyMesh.js` | `BODY_SKIN`, `createBodyMesh(opts)` |
| `clothMesh.js` | `UV_UNIT_MM`, `topologyFromState(state, fabricsByPiece)`, `accumulateNormals(pos, tris, out, V)`, `createClothMesh(opts)` |
| `materials.js` | `fabricMaterial(fabric)`, `updateMaterial(mat, fabric)`, `materialFor(id)`, `materialCacheSize()`, `disposeMaterials()` |
| `textures.js` | `TEXTURE_SIZE`, `textureKey(texture, color)`, `drawTextureCanvas(kind, color, color2, size)`, `fabricTexture(texture, color)`, `textureCacheSize()`, `disposeTextures()` |
| `loop.js` | `createLoop(opts)` |
| `anchorsGizmo.js` | `GIZMO_COLORS`, `createAnchorsGizmo()` |
| `index.js` | re-exports above + `POPOUT_CHANNEL`, `POPOUT_URL`, `POPOUT_HZ`, `POPOUT_WINDOW_FEATURES`, `createPopoutBridge(opts)`, `createViewer3D(container, opts)` |
| `selftest.js` | `runSelfTest()` |
| `src/popout/main.js` | (entry module, no exports; installs `window.__popout` for manual inspection) |

Conventions repeated from section 1 that this module relies on: 3D is metres, y up, model faces +z, +x is the model's LEFT (the viewer's right when the default camera looks at the model's front); colours are `#rrggbb` strings applied with `material.color.set(hex)` under `renderer.outputColorSpace = SRGBColorSpace` (`THREE.ColorManagement.enabled` stays at its default `true`, so `color.getHexString()` returns the same sRGB hex that was set); no allocation inside per-frame code paths (`updatePositions`, `accumulateNormals`, `sendPositions`, the rAF handler).

Error codes thrown by this module (all `Error` objects with a `code` property, per section 1): `WebGLUnavailable` (renderer creation failed), `ViewerBadState` (cloth arrays inconsistent), `ViewerBadBody` (body arrays inconsistent). The wiring layer catches them, writes a status-bar warning and keeps the 2D editor alive; the app never shows a blank screen because `createViewer3D` is called inside the wiring's `try/catch` and a failed viewer leaves `#pane-3d` (section 11) with a plain-text message.

### 8.1 `scene.js` — renderer, camera, lights, ground, resize, framing

```js
/** Tunables; every constructor option defaults to these. Frozen object. */
export const VIEWER_DEFAULTS = Object.freeze({
  background: '#2a2e35',   // scene.background
  fov: 40,                 // vertical, degrees
  near: 0.02, far: 100,    // metres
  pixelRatioMax: 2,        // renderer.setPixelRatio(min(devicePixelRatio, pixelRatioMax))
  shadows: true,           // renderer.shadowMap.enabled
  environment: true,       // RoomEnvironment PMREM as scene.environment (sheen/clearcoat reflections)
  environmentIntensity: 0.5,
  toneMappingExposure: 1.0,
  gridSize_m: 4, gridDivisions: 40,      // 10 cm cells
  shadowPlaneSize_m: 6, shadowOpacity: 0.35,
  frameMargin: 1.05,
  defaultDir: [0, 0.17, 1],              // from target toward camera, normalised at use; ~10 deg elevation, looking at the model's front
});

/** Box framed before any body exists: a 1.75 m body in A-pose. metres. */
export const DEFAULT_BODY_BOX = Object.freeze({ min: [-0.55, 0, -0.25], max: [0.55, 1.75, 0.25] });

/**
 * @typedef {Object} Viewer
 * @property {HTMLElement} container
 * @property {import('three').WebGLRenderer} renderer
 * @property {import('three').Scene} scene
 * @property {import('three').PerspectiveCamera} camera
 * @property {import('three/addons/controls/OrbitControls.js').OrbitControls} controls
 * @property {import('three').Group} root      every content object (body, cloth, gizmo) is added here, never to scene directly
 * @property {{hemi:import('three').HemisphereLight, key:import('three').DirectionalLight, fill:import('three').DirectionalLight}} lights
 * @property {{grid:import('three').GridHelper, shadowPlane:import('three').Mesh}} ground
 * @property {boolean} contextLost            true between webglcontextlost and webglcontextrestored
 * @property {() => void} resize              reads container.clientWidth/Height; called by the ResizeObserver
 * @property {() => void} render              renderer.render(scene, camera); no-op when size is 0 or contextLost
 * @property {(box:{min:number[],max:number[]}, opts?:{targetY?:number, dir?:number[], margin?:number}) => void} frame
 * @property {(bodyModel?: {geometry:{positions:Float32Array}, landmarks?:Record<string,number[]>}|null, opts?:{resetDir?:boolean}) => void} fit
 * @property {(hex:string) => void} setBackground
 * @property {() => string} screenshot        renders synchronously, returns renderer.domElement.toDataURL('image/png')
 * @property {() => {width:number, height:number, dpr:number}} size   CSS pixels and the applied pixel ratio
 * @property {() => {calls:number, triangles:number}} renderInfo     copy of renderer.info.render after the last render
 * @property {() => void} dispose
 */

/**
 * Creates the WebGL renderer inside `container` (a block element; the wiring passes the 3D pane of section 11).
 * @param {HTMLElement} container
 * @param {Partial<typeof VIEWER_DEFAULTS> & {orbit?:boolean}} [opts]   orbit=false skips OrbitControls (never used by the app; kept for tests)
 * @returns {Viewer}
 * @throws {Error} code 'WebGLUnavailable' when `new WebGLRenderer` throws or `renderer.getContext()` is null
 */
export function createViewer(container, opts = {})
```

Construction, in order:

1. **Renderer**: `new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false })` inside `try/catch`; on failure throw `WebGLUnavailable` (the message includes the original error text). Then `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`, `toneMappingExposure`, `shadowMap.enabled = shadows`, `shadowMap.type = PCFSoftShadowMap`, `setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioMax))`. The canvas gets `style.display = 'block'; style.width = '100%'; style.height = '100%'; style.touchAction = 'none'` and is appended to `container`. The container must have `position: relative` or be a grid/flex cell with a definite size (styles/shell.css, section 11 guarantees this for `#pane-3d`). Listeners on the canvas: `webglcontextlost` (calls `event.preventDefault()`, sets `contextLost = true`) and `webglcontextrestored` (`contextLost = false`, then `render()`).
2. **Scene**: `scene.background = new Color(background)`; `root = new Group(); root.name = 'root'; scene.add(root)`. If `environment` is true: `const pmrem = new PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = environmentIntensity; pmrem.dispose()` (imports `three/addons/environments/RoomEnvironment.js`), wrapped in `try/catch` — an environment failure is logged with `console.warn` and ignored.
3. **Camera**: `new PerspectiveCamera(fov, 1, near, far)`; initial placement by `frame(DEFAULT_BODY_BOX, { targetY: 0.72 * 1.75 })`.
4. **OrbitControls** (`three/addons/controls/OrbitControls.js`): `enableDamping = true; dampingFactor = 0.08; minDistance = 0.3; maxDistance = 15; maxPolarAngle = 0.95 * Math.PI; screenSpacePanning = true`. `controls.update()` is called by the loop's render callback (8.6), not inside `render()`.
5. **Lights** (three r155+ physical intensities, no legacy lights):
   * `hemi = new HemisphereLight(0xdfe8f0, 0x4a4036, 0.9)`.
   * `key = new DirectionalLight(0xffffff, 2.2)`, `position.set(1.6, 3.2, 2.4)` (above, in front, on the model's left), `target.position.set(0, 0.9, 0)` (`scene.add(key.target)`), `castShadow = shadows`, `shadow.mapSize.set(2048, 2048)`, shadow camera orthographic `left/right/bottom/top = -1.6/1.6/-1.6/1.6`, `near = 0.1`, `far = 10`, `shadow.bias = -0.0004`, `shadow.normalBias = 0.015`.
   * `fill = new DirectionalLight(0xb0c4de, 0.6)`, `position.set(-2.0, 1.5, -1.5)`, no shadow.
6. **Ground** at y = 0: `grid = new GridHelper(gridSize_m, gridDivisions, 0x666b73, 0x3a3f47)`, `grid.position.y = 0.001` (avoids z-fighting with the shadow plane), `grid.material.transparent = true; grid.material.opacity = 0.6`; `shadowPlane = new Mesh(new PlaneGeometry(shadowPlaneSize_m, shadowPlaneSize_m), new ShadowMaterial({ opacity: shadowOpacity }))`, `rotation.x = -Math.PI / 2`, `receiveShadow = true`. Both are added to `scene` (not `root`).
7. **Resize**: `resize()` reads `w = Math.max(1, container.clientWidth)`, `h = Math.max(1, container.clientHeight)`; sets `renderer.setSize(w, h, false)`, `camera.aspect = w / h`, `camera.updateProjectionMatrix()`. A `ResizeObserver` on `container` calls `resize()` then `render()`. When `container.clientWidth === 0 || clientHeight === 0` (pane hidden by layout `'2d'`, section 3.1 `UiState.layout`), `render()` returns immediately; the observer fires again when the pane reappears.
8. **`frame(box, opts)`** — exact fit of an axis-aligned box into the frustum, keeping the current orbit direction:
   1. `target = centre(box)`; if `opts.targetY` is given, `target.y = opts.targetY`.
   2. `dir` = `opts.dir` normalised if given, else the current `normalize(camera.position - controls.target)` (falls back to `VIEWER_DEFAULTS.defaultDir` when the length is < 1e-6).
   3. `right = normalize(cross((0,1,0), dir))` (if `|right| < 1e-6` use `right = (1,0,0)`), `up = cross(dir, right)`; `tv = tan(fov/2)`, `th = tv * camera.aspect`.
   4. For each of the 8 corners `p` of `box`: `q = p - target`, `dV = q·dir + |q·up| / tv`, `dH = q·dir + |q·right| / th`; `d = margin * max over corners of max(dV, dH)`, clamped to `[0.5, 20]`.
   5. `camera.position = target + dir * d`; `controls.target = target`; `controls.update()`.
   * Worked default (checked numerically): `DEFAULT_BODY_BOX`, `targetY = 1.26`, `dir = normalize(0, 0.17, 1)`, `fov = 40`, `margin = 1.05` gives `d = 3.74 m` for every aspect ratio ≥ 0.75 (the vertical extent dominates).
9. **`fit(bodyModel, opts)`**: `box` = `Box3.setFromArray(bodyModel.geometry.positions)` when a body is given (else `DEFAULT_BODY_BOX`); `targetY = bodyModel.landmarks?.chestCenter ? bodyModel.landmarks.chestCenter[1] : box.min.y + 0.72 * (box.max.y - box.min.y)` ("chest height" per the assignment; `landmarks.chestCenter` is a `Vec3` array, section 3.1); `dir` = default direction when `opts.resetDir === true`, else the current one. The wiring calls `fit(model, { resetDir: true })` after the first body build and plain `fit(model)` for the toolbar "Frame" action / `F` shortcut (section 11).
10. **`screenshot()`**: `render()` then `renderer.domElement.toDataURL('image/png')` in the same synchronous call (no `preserveDrawingBuffer` needed). Returns `'data:,'` when the size is 0 or the context is lost.
11. **`dispose()`**: disconnect the observer, `controls.dispose()`, remove the context-loss listeners, dispose grid/shadow-plane geometries and materials, dispose `scene.environment`, `renderer.dispose()`, `renderer.forceContextLoss()`, remove the canvas. Content under `root` is disposed by its own handles (8.2, 8.3, 8.7), not here.

### 8.2 `bodyMesh.js` — the body render mesh

```js
import { BODY_LOOK } from '../core/fabrics.js';   // '#c9a58a', 0.8 (section 3.6) — the single source of the skin look
export const BODY_SKIN = Object.freeze({ color: BODY_LOOK.color, roughness: BODY_LOOK.roughness, metalness: 0 });

/**
 * @typedef {Object} BodyMeshHandle
 * @property {import('three').Group} object        add to viewer.root; contains mesh, wire, landmarks
 * @property {import('three').Mesh} mesh
 * @property {import('three').Mesh} wire           wireframe overlay sharing mesh.geometry (visible=false by default)
 * @property {import('three').Group} landmarks     debug spheres (visible=false by default)
 * @property {(model:{geometry:{positions:Float32Array,normals?:Float32Array,indices:Uint32Array}, landmarks?:Record<string,number[]>}|null) => void} setBody
 * @property {(on:boolean) => void} setWireframe
 * @property {(on:boolean) => void} setLandmarksVisible
 * @property {(alpha:number) => void} setOpacity   0..1; < 1 makes the skin material transparent (body opacity slider)
 * @property {(on:boolean) => void} setVisible
 * @property {() => number} vertexCount            0 when no body
 * @property {() => {min:number[],max:number[]}|null} bounds   from the current geometry's bounding box
 * @property {() => void} dispose
 */

/** @param {{color?:string, roughness?:number}} [opts] @returns {BodyMeshHandle} */
export function createBodyMesh(opts = {})
```

* `setBody(model)` reads **only** `model.geometry` and `model.landmarks` (so the pop-out can pass a partial object). Validation: `positions.length % 3 === 0`, `indices.length % 3 === 0`, every index `< positions.length / 3` (single pass over `indices`); otherwise throw `ViewerBadBody`. `null` hides `object` and keeps the old geometry disposed.
* Rebuild strategy: **always a fresh `BufferGeometry`** wrapping the arrays directly (`new BufferAttribute(positions, 3)`, `new BufferAttribute(normals, 3)`, `setIndex(new BufferAttribute(indices, 1))` — `Uint32Array` indices are native in WebGL2). No copy: the body module allocates new arrays on every bake (section 6) and never mutates a published one. If `normals` is missing or its length differs from `positions.length`, call `geometry.computeVertexNormals()`. Then `geometry.computeBoundingBox(); geometry.computeBoundingSphere()`, assign `mesh.geometry = wire.geometry = geo`, dispose the previous geometry. Body rebuilds happen on slider release (section 6), so the cost (< 20k triangles) is irrelevant.
* Skin material: `new MeshStandardMaterial({ color, roughness, metalness: 0, side: FrontSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })`; `mesh.castShadow = mesh.receiveShadow = true`; `mesh.name = 'body'`.
* Wireframe overlay: `wire = new Mesh(sameGeometry, new MeshBasicMaterial({ wireframe: true, color: '#3c2f28', transparent: true, opacity: 0.35 }))`, `wire.visible = false`; `setWireframe(on)` toggles `wire.visible`.
* Landmarks: one `Mesh(new SphereGeometry(0.012, 12, 8), new MeshBasicMaterial({ color: '#ff3b30', depthTest: false }))` per key of `model.landmarks`, `mesh.name = key`, positioned at the `Vec3`; the shared sphere geometry/material are created once. On `setBody` the group is rebuilt (children reused when the key set is unchanged, otherwise disposed and recreated). `setLandmarksVisible(on)` toggles `landmarks.visible`; default hidden. Absent `model.landmarks` → group emptied.
* `setOpacity(a)`: `material.transparent = a < 1; material.opacity = a; material.depthWrite = a >= 1 ? true : true` (depth write stays on so cloth behind the body is still occluded correctly; only the skin becomes see-through). `a` is clamped to `[0.05, 1]`.
* `dispose()`: geometry, skin material, wire material, landmark geometry/material.

### 8.3 `clothMesh.js` — one dynamic `BufferGeometry` for the whole garment

```js
export const UV_UNIT_MM = 100;   // 1 uv unit = 100 mm of pattern space (textures set repeat = 100 / scale_mm, 8.5)

/**
 * Render topology derived from a ClothState. This object is also the exact payload of the pop-out 'cloth:init' message (8.8).
 * @typedef {Object} ClothTopology
 * @property {number} V
 * @property {Uint32Array} tris     3T, REORDERED so that the triangles of pieces[0] come first, then pieces[1], ... (ClothState.tris is not assumed sorted)
 * @property {Float32Array} uv      2V: uv[2v] = positions2d[2i] / UV_UNIT_MM, uv[2v+1] = positions2d[2i+1] / UV_UNIT_MM, where i = v - piece.start
 * @property {{start:number, count:number, materialIndex:number, pieceId:string}[]} groups   start/count in index elements (3 per triangle); materialIndex = position in ClothState.pieces
 * @property {string[]} pieceIds    pieceIds[materialIndex]
 * @property {FabricResolved[]} fabrics   fabrics[materialIndex] (plain data, structured-clone safe)
 * @property {Float32Array} pos     3V copy of ClothState.pos at build time
 */

/**
 * @param {ClothState} state
 * @param {Record<string, FabricResolved>|null} [fabricsByPiece]   optional override keyed by pieceId; default state.pieces[k].fabric
 * @returns {ClothTopology}
 * @throws {Error} code 'ViewerBadState'
 */
export function topologyFromState(state, fabricsByPiece = null)

/**
 * Area-weighted vertex normals, allocation-free. out (3V) is zeroed, accumulated with the unnormalised
 * cross product of each triangle, then each vertex normal is normalised (a zero vector becomes (0,1,0)).
 * @param {Float32Array} pos 3V @param {Uint32Array} tris 3T @param {Float32Array} out 3V @param {number} V
 */
export function accumulateNormals(pos, tris, out, V)

/**
 * @typedef {Object} ClothMeshHandle
 * @property {import('three').Mesh} object            add to viewer.root; frustumCulled = false
 * @property {import('three').Mesh} wire              wireframe overlay sharing the geometry (visible=false by default)
 * @property {import('three').BufferGeometry|null} geometry
 * @property {(topology:ClothTopology) => void} build
 * @property {(state:ClothState, fabricsByPiece?:Record<string,FabricResolved>|null) => void} setCloth   = build(topologyFromState(state, fabricsByPiece))
 * @property {(pos:Float32Array) => void} updatePositions   copies pos into the position attribute, recomputes normals (see normalsEvery), flags both needsUpdate
 * @property {(pieceId:string, fabric:FabricResolved) => boolean} setPieceFabric   swaps/updates the material of that piece's group; false if pieceId unknown
 * @property {number} normalsEvery                    1 (default) or 2: recompute normals every n-th updatePositions call
 * @property {(on:boolean) => void} setWireframe
 * @property {(on:boolean) => void} setVisible
 * @property {() => number} vertexCount               V of the current topology, 0 when empty
 * @property {() => number} triangleCount
 * @property {() => ClothTopology|null} topology      the topology passed to the last build (shared reference, read-only)
 * @property {() => void} clear                       disposes the geometry, hides the mesh
 * @property {() => void} dispose
 */

/** @returns {ClothMeshHandle} */
export function createClothMesh(opts = {})
```

**`topologyFromState` algorithm** (runs once per sim build/reset, allocation allowed):

1. `V = state.V`, `T = state.tris.length / 3`, `K = state.pieces.length`. Validate: `state.pos.length === 3V`, `state.pieceOf.length === V`, every `tris[i] < V`, and for every triangle `pieceOf[a] === pieceOf[b] === pieceOf[c]` (pieces are separate meshes, seams are constraints, section 7) and `pieceOf < K`; for every piece `start + count <= V` and `mesh.positions2d.length === 2 * count`. Any violation → `ViewerBadState` with a message naming the first offending index.
2. Counting sort of triangles by piece: `counts[k]` = number of triangles whose first vertex has `pieceOf === k`; `offsets` = exclusive prefix sum; second pass writes the three ids of each triangle into `tris` at `3 * (offsets[k] + fill[k]++)` — stable, so within a piece the original order is preserved.
3. `groups[k] = { start: 3 * offsets[k], count: 3 * counts[k], materialIndex: k, pieceId: pieces[k].pieceId }` (pieces with 0 triangles still get a group with `count: 0`).
4. `uv` from each piece's `mesh.positions2d` divided by `UV_UNIT_MM` (fold pieces are already the full mirrored outline, section 3.1 `PieceMesh`), so a texture with `scale_mm = 20` shows a 20 mm period aligned with the pattern grain regardless of drape.
5. `fabrics[k] = fabricsByPiece?.[pieceId] ?? pieces[k].fabric`; `pos = state.pos.slice()`.

**`build(topology)`**:

1. `clear()` if a geometry exists.
2. `geo = new BufferGeometry()`; `position = new BufferAttribute(new Float32Array(3V), 3)` with `setUsage(DynamicDrawUsage)`; `normal = new BufferAttribute(new Float32Array(3V), 3)` with `DynamicDrawUsage`; `uv = new BufferAttribute(topology.uv, 2)` (static); `setIndex(new BufferAttribute(topology.tris, 1))`; `geo.addGroup(g.start, g.count, g.materialIndex)` for every group.
3. `object.material = topology.fabrics.map(f => fabricMaterial(f))` (8.4; pieces that share a fabric id share one material object, which is the intended semantics because colour lives on the `FabricInstance`).
4. `updatePositions(topology.pos)` (forces a normal computation regardless of `normalsEvery`).
5. `object.visible = V > 0`; `object.castShadow = object.receiveShadow = true`; `object.frustumCulled = false` (the bounding sphere is never recomputed for dynamic positions; the cloth is always drawn). `wire.geometry = geo`.

**`updatePositions(pos)`** (per frame, allocation-free): throw `ViewerBadState` if `pos.length !== 3V`; `positionAttr.array.set(pos); positionAttr.needsUpdate = true`; `if (++callCounter % normalsEvery === 0) { accumulateNormals(array, tris, normalAttr.array, V); normalAttr.needsUpdate = true; }`. **Decision: copy, not a shared view** — the solver may replace `state.pos` on rebuild/reset and may later live in a Worker with transferred buffers; copying 3V floats (≤ 96 KB at the 8k-vertex cap) costs < 0.05 ms. Normal accumulation at 16k triangles costs ≈ 0.3 ms; the wiring sets `normalsEvery = 2` when `SimStats.msAvg > 12` and back to 1 when it drops below 8 (hysteresis).

**`setPieceFabric(pieceId, fabric)`**: finds the group by `pieceId`, calls `fabricMaterial(fabric)` (which updates the cached material in place when the id is already known) and assigns it to `object.material[materialIndex]`; also updates `topology.fabrics[materialIndex]` so a later `cloth:init` resend (8.8) carries the change. No geometry rebuild.

**Wireframe overlay**: `wire = new Mesh(geo, new MeshBasicMaterial({ wireframe: true, color: '#101418', transparent: true, opacity: 0.35 }))`, `frustumCulled = false`, hidden by default. Fabric materials carry `polygonOffset` (8.4) so the overlay never z-fights.

### 8.4 `materials.js` — fabric look → `MeshPhysicalMaterial`, cached by fabric id

```js
/**
 * Returns the material for fabric.id, creating it on first use and otherwise updating the cached one IN PLACE
 * (so every mesh group already holding it sees the change with no rebuild).
 * @param {FabricResolved} fabric
 * @returns {import('three').MeshPhysicalMaterial}
 */
export function fabricMaterial(fabric)

/** Applies fabric.look to an existing material (see field table). @param {import('three').MeshPhysicalMaterial} mat @param {FabricResolved} fabric */
export function updateMaterial(mat, fabric)

/** @param {string} id @returns {import('three').MeshPhysicalMaterial|undefined} */
export function materialFor(id)
export function materialCacheSize()
/** Disposes and empties the cache (used by selftest and Viewer3D.dispose). */
export function disposeMaterials()
```

Constructor: `new MeshPhysicalMaterial({ side: DoubleSide, flatShading: false, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })`, `mat.name = fabric.id`, `mat.userData.fabricId = fabric.id`. `updateMaterial` mapping from `FabricLook` (section 3.1 / 9.1):

| Material field | Value |
|---|---|
| `color` | `look.texture.kind === 'solid'` → `color.set(look.color)`; otherwise `color.set('#ffffff')` (the texture pixels already carry `color` and `color2`, a non-white base would darken them) |
| `map` | `fabricTexture(look.texture, look.color)` (8.5): `null` for solid |
| `roughness` | `look.roughness` |
| `metalness` | 0 |
| `sheen` | `look.sheen` |
| `sheenRoughness` | `look.sheenRoughness` |
| `sheenColor` | `new Color(look.color).lerp(new Color('#ffffff'), 0.6)` (white-tinted base colour) |
| `clearcoat` | `look.clearcoat`; `clearcoatRoughness = 0.4` |
| `opacity` | `look.opacity`; `transparent = look.opacity < 1`; `depthWrite = true` always (a double-sided transparent chiffon with depth write off loses whole faces; slight sorting artefacts are accepted) |
| `envMapIntensity` | 0.5 (matches `VIEWER_DEFAULTS.environmentIntensity`) |
| `needsUpdate` | set to `true` whenever `map` changes between `null` and non-`null` or `transparent` changes (three does not detect these program changes by itself) |

`disposeMaterials()` calls `mat.dispose()` on every cached material (textures are owned by 8.5 and disposed there).

### 8.5 `textures.js` — procedural `CanvasTexture`s

```js
export const TEXTURE_SIZE = 512;

/** Cache key: `${kind}|${color}|${color2}|${scale_mm}` (scale_mm clamped to [2, 500] before keying). */
export function textureKey(texture, color)

/**
 * Draws one pattern period on a size x size canvas; pure drawing, no three import (testable without WebGL).
 * @param {'solid'|'stripes'|'gingham'|'dots'|'twill'|'knit'} kind
 * @param {string} color   base colour '#rrggbb'
 * @param {string} color2  accent colour '#rrggbb'
 * @param {number} [size=TEXTURE_SIZE]
 * @returns {HTMLCanvasElement}
 */
export function drawTextureCanvas(kind, color, color2, size = TEXTURE_SIZE)

/**
 * @param {{kind:string, scale_mm:number, color2:string}} texture   FabricLook.texture
 * @param {string} color   FabricLook.color
 * @returns {import('three').CanvasTexture|null}   null for kind 'solid' (and for unknown kinds, with one console.warn per kind)
 */
export function fabricTexture(texture, color)
export function textureCacheSize()
export function disposeTextures()
```

Texture object settings: `wrapS = wrapT = RepeatWrapping`, `colorSpace = SRGBColorSpace`, `anisotropy = 4` (three clamps to the device maximum), `generateMipmaps = true`, `minFilter = LinearMipmapLinearFilter`, `magFilter = LinearFilter`, `repeat.set(UV_UNIT_MM / scale_mm, UV_UNIT_MM / scale_mm)` — with uv = mm / 100 (8.3) one canvas tile therefore covers exactly `scale_mm × scale_mm` of pattern space, and a canvas tile holds **one period** of the pattern. `flipY` stays at its default `true`. `needsUpdate = true` once after creation.

Drawing rules (`ctx = canvas.getContext('2d')`, `S = size`; every pattern is seamless because all periods used divide `S`):

| kind | Drawing on a canvas pre-filled with `color` |
|---|---|
| `solid` | canvas filled with `color` only (function still returns a canvas; `fabricTexture` returns `null` for it) |
| `stripes` | `fillStyle = color2; fillRect(0, 0, S/2, S)` — one stripe pair per tile, stripes run along the pattern's y (grain) direction |
| `gingham` | `globalAlpha = 0.5; fillStyle = color2; fillRect(0, 0, S/2, S); fillRect(0, 0, S, S/2)` — bands at 50 %, the overlap at 75 % |
| `dots` | `fillStyle = color2`; two discs of radius `0.12·S` centred at `(S/4, S/4)` and `(3S/4, 3S/4)` (staggered lattice) |
| `twill` | `strokeStyle = color2; globalAlpha = 0.55; lineWidth = 0.045·S`; for `c = -S; c <= 2S; c += S/8` draw the line from `(c, 0)` to `(c - S, S)` (all points satisfy `x + y = c`, 45° diagonals, period `S/8` divides `S`) |
| `knit` | `globalAlpha = 0.45; strokeStyle = color2; lineWidth = 0.023·S`; for 8 rows `r = 0..7`: path `y = r·S/8 + S/16 + 0.028·S·sin(2π x / (S/8))` for `x = 0..S` step 4 px, stroked; then the same paths shifted down by `S/64` with `strokeStyle = 'rgba(0,0,0,0.12)'` (shadow line) |

`disposeTextures()` disposes every cached texture and empties the map. Unknown kinds are treated as `solid`.

### 8.6 `loop.js` — requestAnimationFrame driver

```js
/**
 * @typedef {Object} Loop
 * @property {() => void} start
 * @property {() => void} stop
 * @property {() => boolean} isRunning       true while a frame is scheduled (false when stopped or the document is hidden)
 * @property {boolean} renderSuppressed      settable; true = frames are skipped entirely (no tick, no render) — used by __app.runAcceptance()
 * @property {() => void} renderNow          synchronous render ignoring renderSuppressed (used by __app.sim.step(n) after its last step so screenshots are current)
 * @property {number} fps                    rendered frames in the last completed 1 s window (0 until the first window completes)
 * @property {number} frameCount             rendered frames since start()
 * @property {number} lastFrameMs            wall-clock ms between the last two rAF callbacks (clamped to 100)
 * @property {() => void} dispose            stop + remove the visibilitychange listener
 */

/**
 * @param {{ tick?: ((dtMs:number, frame:number) => void)|null, render: () => void, onFps?: (fps:number) => void }} opts
 * @returns {Loop}
 */
export function createLoop(opts)
```

Frame handler (`onFrame(now)`):

1. If not `running` return (a late callback after `stop()`).
2. `dtMs = min(now - lastNow, 100); lastNow = now`.
3. If `!renderSuppressed`: `tick?.(dtMs, frameCount)`; `render()`; `frameCount++`; `windowFrames++`.
4. If `now - windowStart >= 1000`: `fps = windowFrames; windowFrames = 0; windowStart = now; onFps?.(fps)`.
5. `rafId = requestAnimationFrame(onFrame)`.

`tick` is supplied by the wiring and, when the sim is playing, calls `solver.step()` **exactly once per frame regardless of `dtMs`** (fixed `dt = 1/60`, section 1 — slow machines slow the sim, never destabilise it), then `Viewer3D.sync(state)`. `dtMs` is informational (status bar). `render` = `controls.update(); viewer.render()`.

Visibility: on `document.visibilitychange`, hidden → `cancelAnimationFrame(rafId)`, `paused = true`; visible → if `running` re-request a frame and reset `lastNow`/`windowStart` to `performance.now()`. `isRunning()` = `running && !paused`.

Automation contract (for section 12/13 writers): `__app.sim.step(n)` is synchronous and therefore never interleaves with rAF; it must end with `Viewer3D.sync(state, true)` and `loop.renderNow()`. `__app.runAcceptance()` sets `loop.renderSuppressed = true` for its whole duration (it yields with `await` between checks) and restores it in `finally`.

### 8.7 `anchorsGizmo.js` — anchor cylinders and placement outlines

```js
export const GIZMO_COLORS = Object.freeze({ anchor: '#55aaff', anchorHighlight: '#ffd400', frontTick: '#ffd400', outline: '#ff8800' });

/**
 * @typedef {Object} AnchorsGizmoHandle
 * @property {import('three').Group} object     add to viewer.root; visible=false by default
 * @property {(anchors:Record<string,Anchor>|null) => void} setAnchors
 * @property {(state:ClothState|null) => void} setPlacements   one closed outline per piece from restPos + mesh.boundary
 * @property {(name:string|null) => void} highlight             anchor name ('torso', 'armL', ...) drawn in anchorHighlight
 * @property {(on:boolean) => void} setVisible
 * @property {() => void} dispose
 */
export function createAnchorsGizmo()
```

* `setAnchors`: for every `Anchor` (section 3.1: `origin` = top, `axis` = unit vector pointing down the cylinder, `front` = unit vector for side `'front'`, `radius`, `length`) build one `LineSegments` named by the anchor key with `LineBasicMaterial({ color, transparent: true, opacity: 0.6, depthTest: false })` from world-space points computed exactly like the arrangement formula of section 7.4, so the gizmo and the arrangement can never disagree: `u = front`, `w = cross(front, axis)` (= `ŝ` of section 7.4); ring at depth `s ∈ {0, length/2, length}`: 48 segments of `origin + axis·s + radius·(cos θ·u + sin θ·w)`; 8 longitudinal segments at `θ = k·π/4` from `s = 0` to `s = length`; plus a **front tick** (`frontTick` colour): from `origin + radius·u` to `origin + (radius + 0.03)·u` marking `θ = 0` (side `'front'`). With `axis = (0,-1,0)` and `front = (0,0,1)`, `w = (1, 0, 0)`, so `θ = +π/2` (side `'left'`, section 7.4) lies at +x = the model's LEFT, consistent with section 1 and with `arrange()`. `null` removes everything.
* `setPlacements(state)`: for each `state.pieces[k]`, a `LineLoop` of `mesh.boundary.length` points read from `state.restPos` at `3·(start + boundary[i])`, `LineBasicMaterial({ color: outline, depthTest: false })`, named `pieceId`. Allocation happens here (called on sim build/reset only, never per frame). `null` removes the outlines.
* `highlight(name)`: sets the named anchor's material colour to `anchorHighlight` and opacity 1, all others back to `anchor` / 0.6. The wiring calls it with the selected piece's `placement.anchor` (Pieces panel) and `setVisible(true)` while a piece is selected, `setVisible(false)` otherwise; a toolbar toggle (section 11) can force it on.
* `dispose()`: geometries and materials of all children.

### 8.8 Pop-out window — `popout.html`, `src/popout/main.js`, bridge in `src/viewer3d/index.js`

Design (winning design, corrected per the judges): the pop-out is **view-only**; the main window remains the single simulation owner and keeps rendering its own in-pane viewer (automation and screenshots are unaffected by a pop-out). It is opened **only from a user click on `#btn-popout`** (section 11); no acceptance check (section 13) and no `__app` call opens it, because Chromium blocks `window.open` without user activation. If the wiring wants to give the 2D editor the full width while the pop-out is open it may set `UiState.layout = '2d'` and restore the previous value on close — that is wiring policy, not part of this module.

```js
export const POPOUT_CHANNEL = 'clothing-app-3d';
export const POPOUT_URL = 'popout.html';
export const POPOUT_HZ = 30;                                  // max rate of 'cloth:pos'
export const POPOUT_WINDOW_FEATURES = 'popup=yes,width=960,height=800';

/**
 * Messages on BroadcastChannel(POPOUT_CHANNEL). Every message carries `session` (the bridge's sessionId, also
 * passed to the pop-out as ?session=); receivers ignore other sessions so two app tabs never feed one pop-out.
 * @typedef {{type:'hello', session:string}} PopoutHello                              pop-out -> main, on load
 * @typedef {{type:'closed', session:string}} PopoutClosed                            pop-out -> main, on pagehide
 * @typedef {{type:'body', session:string, hasBody:boolean, positions:Float32Array, normals:Float32Array, indices:Uint32Array, chestY:number}} PopoutBody   main -> pop-out
 * @typedef {{type:'cloth:init', session:string, topology:ClothTopology|null}} PopoutClothInit   main -> pop-out (also resent on any fabric/colour change)
 * @typedef {{type:'cloth:pos', session:string, pos:Float32Array, frame:number}} PopoutClothPos   main -> pop-out, <= POPOUT_HZ
 * @typedef {{type:'close', session:string}} PopoutClose                              main -> pop-out (app unloading or "bring back")
 */

/**
 * @typedef {Object} PopoutBridge
 * @property {string} sessionId
 * @property {() => boolean} open          window.open(POPOUT_URL + '?session=' + sessionId, 'clothing-app-3d', POPOUT_WINDOW_FEATURES); focuses the existing window if already open; returns false when blocked (null return)
 * @property {() => boolean} isOpen
 * @property {() => void} close            posts 'close', calls win.close() if the reference is alive
 * @property {(model:BodyModel|null) => void} sendBody
 * @property {(topology:ClothTopology|null) => void} sendClothInit
 * @property {(pos:Float32Array, frame:number, force?:boolean) => void} sendPositions   no-op when closed; throttled to POPOUT_HZ unless force
 * @property {(fn:() => void) => void} onOpened   after 'hello'
 * @property {(fn:() => void) => void} onClosed   after 'closed' or when the 1 s win.closed poll trips
 * @property {() => void} dispose          close(), clear the poll, channel.close()
 */

/**
 * @param {{ getBody: () => BodyModel|null, getTopology: () => ClothTopology|null, getPositions: () => {pos:Float32Array, frame:number}|null }} opts
 * @returns {PopoutBridge}
 */
export function createPopoutBridge(opts)
```

Bridge behaviour (main window):

1. `sessionId = uid('sess')` (section 3, `src/core/ids.js`); the channel is created lazily on the first `open()`.
2. On `hello` (matching session): mark open, send `body` (`getBody()`), `cloth:init` (`getTopology()`), `cloth:pos` (`getPositions()`, forced), call the `onOpened` callbacks.
3. `sendPositions(pos, frame, force)`: `if (!open) return; const now = performance.now(); if (!force && now - lastSent < 1000 / POPOUT_HZ) return; lastSent = now; channel.postMessage({ type: 'cloth:pos', session, pos, frame })`. `postMessage` structured-clones the array (≤ 96 KB at 30 Hz ≈ 2.9 MB/s — acceptable); no allocation on the sender beyond the clone the platform performs.
4. `sendBody(model)`: `hasBody = !!model`; arrays from `model.geometry`; `chestY = model.landmarks.chestCenter[1]`.
5. A `setInterval(1000)` poll checks `win.closed`; on true (or on the `closed` message) it marks closed, clears the poll and calls `onClosed`. On the main page's `pagehide`, `close()` is posted so the pop-out closes with the app.
6. **Blocked pop-ups**: `open()` returns `false`; the wiring shows the status-bar message `Pop-out blocked by the browser. Allow pop-ups for this site, or use Swap / the 3D-only layout.` and nothing else changes.

`popout.html`: same import map as `index.html` (section 2), `<title>Clothing App – 3D</title>`, `<div id="popout-root"></div><div id="popout-status"></div>` (root fills the viewport: `position:fixed; inset:0`; status is a small overlay top-left), `<script type="module" src="src/popout/main.js">`. It imports only `src/viewer3d/index.js` and `src/core/` (dependency rule of section 2: `popout -> core, viewer3d`).

`src/popout/main.js` flow:

1. Read `session` from `location.search`; if absent, show `Open this window from the app's Pop-out button.` in `#popout-status` and stop.
2. `const v = createViewer3D(document.getElementById('popout-root'), { tick: null })` (8.9; the loop only renders). Failures show the error text in the status div.
3. `const ch = new BroadcastChannel(POPOUT_CHANNEL)`; `onmessage` ignores messages whose `session` differs; handlers: `body` → `v.body.setBody(hasBody ? { geometry: { positions, normals, indices }, landmarks: { chestCenter: [0, chestY, 0] } } : null)` then `v.viewer.fit(...)` on the first body only; `cloth:init` → `topology ? v.cloth.build(topology) : v.cloth.clear()`; `cloth:pos` → if `pos.length === 3 * v.cloth.vertexCount()` then `v.cloth.updatePositions(pos)` else ignore (a stale frame from before a rebuild); `close` → `window.close()`.
4. Post `hello`; status shows `Waiting for the main window…`; a 3 s timer without any message changes it to `No data from the main window — is the app still open?` (listening continues). After the first `cloth:pos` the status shows `3D mirror · {fps} fps · {V} vertices` (updated via `onFps`).
5. `pagehide` → post `closed`, `ch.close()`, `v.dispose()`.
6. `window.__popout = { frames: () => count of cloth:pos received, V: () => v.cloth.vertexCount(), lastFrame }` for manual inspection only.

### 8.9 `index.js` — the `Viewer3D` facade, and `selftest.js`

```js
/**
 * @typedef {Object} Viewer3D
 * @property {Viewer} viewer
 * @property {BodyMeshHandle} body
 * @property {ClothMeshHandle} cloth
 * @property {AnchorsGizmoHandle} gizmo
 * @property {Loop} loop                         started by createViewer3D
 * @property {PopoutBridge} popout               its getters read this facade's current body/topology/positions
 * @property {(model:BodyModel|null) => void} setBody          body.setBody + gizmo.setAnchors(model?.anchors ?? null) + popout.sendBody; fits the camera (resetDir) on the FIRST body only
 * @property {(state:ClothState|null, fabricsByPiece?:Record<string,FabricResolved>|null) => void} setCloth   cloth.setCloth/clear + gizmo.setPlacements(state) + popout.sendClothInit(topology); remembers `state`
 * @property {(state:ClothState, force?:boolean) => void} sync   if force or state.frame !== lastFrame or state.pos !== lastPosRef: cloth.updatePositions(state.pos); popout.sendPositions(state.pos, state.frame, force)
 * @property {(pieceId:string, fabric:FabricResolved) => void} setPieceFabric   cloth.setPieceFabric + popout.sendClothInit(cloth.topology())
 * @property {() => void} fit                    viewer.fit(currentBody)
 * @property {() => void} render                 viewer.controls.update(); viewer.render()
 * @property {() => string} screenshot
 * @property {(on:boolean) => void} setWireframe body + cloth overlays
 * @property {(on:boolean) => void} setLandmarks
 * @property {(on:boolean) => void} setGizmo
 * @property {(a:number) => void} setBodyOpacity
 * @property {() => {fps:number, frames:number, drawCalls:number, triangles:number, V:number, T:number, lastFrameMs:number}} stats
 * @property {() => void} dispose                loop, popout, gizmo, cloth, body, disposeMaterials(), disposeTextures(), viewer
 */

/**
 * Composes everything: createViewer, body/cloth/gizmo handles added to viewer.root, a started loop whose render
 * callback is `controls.update(); viewer.render()`, and the pop-out bridge.
 * @param {HTMLElement} container
 * @param {{ tick?: ((dtMs:number, frame:number) => void)|null, viewer?: Partial<typeof VIEWER_DEFAULTS>, onFps?: (fps:number) => void }} [opts]
 * @returns {Viewer3D}
 * @throws {Error} code 'WebGLUnavailable'
 */
export function createViewer3D(container, opts = {})
```

Wiring contract (what `src/app/wiring.js` does with this facade, listed here so A5 and A8 agree): on the body-built event of section 3.2 → `v.setBody(model)`; on sim build/reset → `v.setCloth(state)` then `v.sync(state, true)`; per frame inside `tick` → `if (playing) solver.step(); v.sync(state)`; on a fabric edit (Fabric panel, section 11) → for every simulated piece using that `FabricInstance`: `v.setPieceFabric(pieceId, resolveFabric(instance))`; on piece selection → `v.gizmo.highlight(piece.placement.anchor); v.setGizmo(true)` / `v.setGizmo(false)`; `#btn-popout` click → `if (!v.popout.open()) statusbar.warn(...)`; the debug API exposes the facade as `__app.viewer` and its stats feed the status bar (`fps`, section 11).

`selftest.js`:

```js
/** @returns {Promise<SelfTestResult[]>}  (section 3.1 SelfTestResult) */
export async function runSelfTest()
```

Runs in the page (needs WebGL2). It appends a hidden container `div` (`position:fixed; left:-10000px; top:0; width:320px; height:240px`) to `document.body`, runs the checks below in order, and always removes the container and disposes everything in `finally`. Each check is one `SelfTestResult` with the exact `name` given; a thrown exception inside a check makes that check fail with `details = String(error)` and the remaining checks still run. Fixtures are built inline: a 10×10 vertex sheet (`V = 100`, `T = 162`, 2D spacing 15 mm) shaped like a `ClothState` (`V, pos, prev, vel, invMass, restPos, pieceOf (all 0), tris, pieces:[{start:0, count:100, pieceId:'sheet', mesh:{positions2d, boundary: the 36 boundary ids CCW, ...}, fabric, layer:0}], frame:0, time:0`); the fabric is `resolveFabric({ id:'main', name:'Main', preset:'cotton', color:'#c8102e', texture:{ kind:'solid', scale_mm:20, color2:'#ffffff' }, overrides:{} })` from `src/core/fabrics.js`; a body fixture uses a three `SphereGeometry(0.3, 24, 16)` translated to y = 1.0 converted to `{ positions, normals, indices: Uint32Array }` with `landmarks: { chestCenter: [0, 1.0, 0] }` and `anchors: { torso: { origin:[0,1.3,0], axis:[0,-1,0], front:[0,0,1], radius:0.36, length:0.6 } }`.

| # | name | pass condition |
|---|---|---|
| 1 | `viewer.create` | `createViewer` returns; `renderer.getContext()` non-null; `viewer.size().width === 320` |
| 2 | `viewer.render.noGlError` | after `viewer.render()`, `gl.getError() === gl.NO_ERROR` and `renderInfo().calls >= 1` |
| 3 | `viewer.frame.default` | after construction `controls.target.y` within 0.001 of `1.26` and `camera.position.distanceTo(target)` in `[3.5, 4.0]` |
| 4 | `body.setBody` | `body.vertexCount() === positions.length / 3`; `bounds()` max y within 1e-3 of 1.3; landmarks group has 1 child named `chestCenter` |
| 5 | `body.badIndices` | `setBody` with an index `>= vertexCount` throws an error whose `code === 'ViewerBadBody'` |
| 6 | `cloth.setCloth.counts` | `cloth.vertexCount() === state.V`, `cloth.triangleCount() === state.tris.length / 3`, `geometry.groups.length === 1`, `geometry.index.count === 3T` |
| 7 | `cloth.material.color` | `object.material[0].color.getHexString() === 'c8102e'` and `map === null` and `side === DoubleSide` |
| 8 | `cloth.updatePositions` | add 0.1 to every y of `state.pos`, call `updatePositions`; position attribute array equals `state.pos` element-wise; every normal component finite and each normal length within 1e-4 of 1 |
| 9 | `cloth.setPieceFabric.texture` | with a stripes fabric (`scale_mm 20`, `color2 '#ffffff'`): `material.map` is a `CanvasTexture` with `image.width === 512`, `repeat.x === 5`, `material.color.getHexString() === 'ffffff'`; `textureCacheSize() === 1`; calling again with the same fabric keeps `textureCacheSize() === 1` and returns the same material object |
| 10 | `materials.allPresets` | `fabricMaterial(resolveFabric(instance))` for each of the 7 preset ids in `FABRIC_PRESETS` (section 9.1) succeeds; `materialCacheSize() === 7` (plus 'main' = 8 total counted before dispose → assert `>= 7`); for every one `transparent === (look.opacity < 1)`, `opacity === look.opacity`, `sheen === look.sheen`, `roughness === look.roughness`, `clearcoat === look.clearcoat` |
| 11 | `textures.kinds` | `drawTextureCanvas(kind, '#336699', '#ffffff')` returns a 512×512 canvas for all six kinds; `fabricTexture({kind:'solid',...})` returns `null`; the pixel at (10, 10) of the `stripes` canvas is `#ffffff` and the pixel at (500, 10) is `#336699` |
| 12 | `cloth.badState` | a copy of the state with `tris[0] = V` makes `setCloth` throw with `code === 'ViewerBadState'` |
| 13 | `topology.clone` | `topologyFromState(state)`: `tris.length === 3T`, `groups[0].count === 3T`, `uv[2] === positions2d[2] / 100`; `structuredClone(topology)` round-trips with equal `V` and `tris` byte length |
| 14 | `gizmo.anchors` | `setAnchors(fixture.anchors)` → `object.children.length === 1`, child named `torso`; `setPlacements(state)` adds one `LineLoop` with 36 points named `sheet`; `highlight('torso')` changes that child's material colour hex to `ffd400` |
| 15 | `loop.frames` | `createLoop({ render })` started; after `await` of 4 animation frames (`requestAnimationFrame` chained) `frameCount >= 2` and `isRunning() === true`; with `renderSuppressed = true` two more frames do not change `frameCount`; `stop()` → `isRunning() === false`. When `document.visibilityState !== 'visible'` the check passes with `details: 'skipped: document hidden'` |
| 16 | `viewer.screenshot` | `screenshot()` starts with `'data:image/png'` and has length > 1000 |
| 17 | `viewer.dispose` | `dispose()` of everything throws nothing; `materialCacheSize() === 0` and `textureCacheSize() === 0` afterwards; the container has no `canvas` child |

Section 13 (acceptance) should include, from the viewer side: after `loadSample('tshirt')` and the first drape, `__app.viewer.stats().V === sim state V`, `stats().triangles > 0` after one rendered frame, and `__app.viewer.screenshot()` returns a PNG data URL longer than 1000 characters. The pop-out is explicitly **not** part of section 13.

**PROPOSED types.js amendment**: none. `ClothTopology`, `Viewer`, `Viewer3D`, the handle typedefs and the pop-out message typedefs are viewer-local contracts declared in `src/viewer3d/index.js` (consumed only by `viewer3d`, `popout` and `app/wiring.js`), so `src/core/types.js` stays unchanged.

---

## 9. Fabric presets and looks (`src/core/fabrics.js` data; section 3.6 defines the API)

### 9.1 `FABRIC_PRESETS`

Physics columns are the effective simulation values of 7.10 (`bend_Nm` effective; the physical reference is in 7.10's table); look columns feed `viewer3d/materials.js` (section 8.4). `meshSpacing_mm` is only the value the Fabric panel proposes for a piece when the preset is applied.

| id | name | density_kgm2 | bend_Nm | membrane_Nm | friction | damping (1/s) | thickness_mm | meshSpacing_mm | color | roughness | sheen | sheenRoughness | clearcoat | opacity | texture |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `cotton` | Cotton poplin | 0.15 | 2.5e-4 | 8000 | 0.45 | 1.0 | 0.4 | 15 | `#d8d3c5` | 0.85 | 0.15 | 0.8 | 0.0 | 1.0 | `{kind:'solid', scale_mm:20, color2:'#ffffff'}` |
| `denim` | Denim 12 oz | 0.45 | 2.0e-3 | 20000 | 0.55 | 1.5 | 1.0 | 15 | `#3b5a86` | 0.9 | 0.1 | 0.9 | 0.0 | 1.0 | `{kind:'twill', scale_mm:4, color2:'#2a4266'}` |
| `silk` | Silk charmeuse | 0.06 | 1.0e-5 | 3000 | 0.25 | 0.6 | 0.15 | 12 | `#c9a7c2` | 0.35 | 0.9 | 0.3 | 0.0 | 1.0 | `{kind:'solid', scale_mm:20, color2:'#ffffff'}` |
| `jersey` | Cotton jersey | 0.20 | 8.0e-5 | 400 | 0.50 | 1.2 | 0.8 | 15 | `#8a9a5b` | 0.9 | 0.2 | 0.9 | 0.0 | 1.0 | `{kind:'knit', scale_mm:3, color2:'#7a8a4b'}` |
| `wool` | Wool suiting | 0.28 | 1.2e-4 | 5000 | 0.50 | 1.5 | 0.7 | 15 | `#5a5650` | 0.95 | 0.3 | 0.9 | 0.0 | 1.0 | `{kind:'solid', scale_mm:20, color2:'#ffffff'}` |
| `leather` | Leather | 0.80 | 5.0e-3 | 50000 | 0.60 | 2.0 | 1.4 | 18 | `#6b3f2a` | 0.45 | 0.0 | 1.0 | 0.6 | 1.0 | `{kind:'solid', scale_mm:20, color2:'#ffffff'}` |
| `chiffon` | Silk chiffon | 0.035 | 1.5e-6 | 1000 | 0.20 | 0.4 | 0.1 | 12 | `#e8c9d6` | 0.5 | 0.6 | 0.5 | 0.0 | 0.55 | `{kind:'solid', scale_mm:20, color2:'#ffffff'}` |

`density_kgm2`, `bend_Nm`, `membrane_Nm`, `friction`, `damping`, `thickness_mm`, `meshSpacing_mm` form `FabricPhysics`; `color, roughness, sheen, sheenRoughness, clearcoat, opacity, texture` form `FabricLook`. The sample garments use `{id:'main', preset:'cotton', color:'#c8102e'}` (T-shirt) and `{id:'main', preset:'denim', color:'#3b5b8c', texture:{kind:'twill', scale_mm:4, color2:'#2c4468'}}` (skirt, section 4.4) as their `FabricInstance`.

### 9.2 Texture kinds

`texture = {kind, scale_mm, color2}` on every `FabricInstance` / `FabricLook`; `scale_mm` is the pattern period in millimetres on the garment (the viewer maps it through the mesh's 2D uv, section 8.5); `color2` is the secondary colour (ignored for `solid`).

| kind | meaning |
|---|---|
| `solid` | flat `color`; no texture map |
| `stripes` | vertical stripes in pattern space: `color`/`color2` alternating every `scale_mm/2` |
| `gingham` | two-colour check: squares of `scale_mm/2`, mixed colour (`mixHex(color, color2, 0.5)`) where both overlap |
| `dots` | `color2` dots of diameter `0.4·scale_mm` on `color`, square lattice of period `scale_mm` |
| `twill` | diagonal 45° lines of `color2`, period `scale_mm` (denim look) |
| `knit` | small V-shaped stitches of `color2` on `color`, period `scale_mm` (jersey look) |

`sim.bendScale` and `sim.stretchScale` (SimSettings) are global multipliers applied by `cloth/state.js`; they are exposed in the Fabric panel as `range-bend-scale` / `range-stretch-scale` (log scale 0.1–10, default 1).

---

**PROPOSED types.js amendment:** none. Per-vertex areas, snapshots and section timers live in a `WeakMap` side table inside `src/cloth/`, so `ClothState` keeps exactly the fields of section 3.1.

---

## 10. Sizing and export (`src/sizing/`, `src/export/`) — agent A6

> **Amendment (lead, 2026-09-17) — the simulation drapes the ACTIVE SIZE.** Section 12.2 originally left the
> simulation untouched on `size:active`: the size selector drove the 2D ghost outline and the exported pattern, while
> the 3D view always draped the base pieces. Choosing L or XL therefore changed the printed pattern but not the
> garment on the model, and a body bigger than the draft body had no way to wear the garment at all.
>
> `wiring.js` now has `simDoc(doc)`, which returns the document with its pieces graded to `doc.ui.activeSize`
> (`sizing.gradeDoc`), and `remesh`, `remeshAllForced`, `buildClothState` and `arrangeState` all work from it, so the
> piece the solver reads is the piece its mesh came from. `meshKeyOf` includes the active size and the piece's grade
> rules, so switching size invalidates the cached meshes, and `setActiveSize` schedules a remesh of every simulated
> piece. At the base size `gradeDoc` returns copies equal to `doc.pieces`, so nothing changes there; grading preserves
> piece ids and edge counts, so `doc.seams` still resolves and seam parity holds.
>
> Verified: the simulated pattern width now grows 534.5 / 560.0 / 585.5 / 610.9 mm across S / M / L / XL (acceptance
> check 26b, `size_drapes`). The point of it is fit — draping the sample T-shirt at its closest size instead of the
> base size, on the body presets that are far from the draft body:
>
> | body | base size M | closest size | p99 strain | peak | penetration |
> |---|---|---|---|---|---|
> | male_m | 13.3% / 53% / 3.79 mm | XL | 8.7% | 23% | 2.20 mm |
> | male_l | 19.3% / 65% / 5.15 mm | XL | 10.6% | 34% | 2.94 mm |
> | plus_f | 15.9% / 77% / 5.07 mm | XL | 8.6% | 27% | 2.81 mm |
> | athletic_m | 21.3% / 55% / 5.19 mm | XL | 11.2% | 36% | 2.95 mm |
>
> Penetration returns under the 5 mm bar on every preset, and the strain roughly halves. Note that the default chart
> tops out at a 96 cm chest, so `male_m` (98 cm) and `male_l` (108 cm) still pick XL as merely the closest row rather
> than a true fit; a chart with more rows, or `sizes.fitBody`, is the answer for those bodies.

Both directories are **pure**: no DOM, no `three`, no store, no bus. Every function takes plain data (`ProjectDoc`, `Piece`, `SizeChart`, `BodyParams`, `ClothState`) and returns plain data or strings. The single exception is `src/export/download.js`, which touches `document`/`URL`/`Blob` only inside the four functions that exist for that purpose (10.6) and throws `Error{code:'NO_DOM'}` when `typeof document === 'undefined'`. Wiring (section 12) is the only place that calls these modules in reaction to events; the UI (section 11) wraps returned strings in downloads. **Every exporter returns its string; nothing here ever opens a window or triggers a download by itself**, so automation asserts on strings.

Imports allowed: `sizing -> core, geometry`; `export -> core, geometry, sizing` (section 2). Errors: `throw Object.assign(new Error(message), { name: 'ValidationError', code })`; the codes are listed per function below.

**Consumed from `src/geometry/index.js` (section 5).** The names below are the ones sizing/export call; their semantics are fixed by section 5 — this table only records the subset A6 relies on, so that a mismatch is a contract bug caught in Phase 2, not a silent divergence.

| Function | Used for |
|---|---|
| `edgeLength(piece, i) -> number` mm | edge lengths (CSV, ease %, sample counts) |
| `sampleEdge(piece, i, n) -> Vec2[]` (n+1 points, arc-length uniform, first = `vertices[i]`, last = `vertices[(i+1)%n]`) | stitch polyline, notch positions, ghost outline |
| `offsetPolygon(stitch, allowance, opts) -> Vec2[]` (`stitch` closed CCW polyline; `allowance` is ALWAYS an array, one mm value per segment `stitch[k] -> stitch[k+1]` (build it with `stitch.map(...)`); mitre/round joins, hem square-off at allowance discontinuities, loop removal; `opts.join: 'mitre'|'round'`, export passes `'round'`) | cut line |
| `packRects(items, sheetWidth_mm, {gap, allowRotate:false}) -> {placements:{id,x,y,rotated}[], width, height}` (shelf packer, section 5.8; items `{id,w,h}`; `placements` is in item order, y down, origin 0,0; export never allows rotation; an item wider than the sheet is placed alone on its own shelf and `width` grows) | sheet nesting, fabric estimate |
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

Grading is deterministic measurement-driven scaling about a pivot, followed by per-vertex grade rules (`Piece.grade`, section 3.1). Graded pieces are ordinary `Piece` objects: they feed the export (10.3–10.5), the 2D view's **ghost outline** when `ui.activeSize !== sizes.baseSize` (the pattern renderer draws it itself with `gradePiece(piece, doc.sizes, ui.activeSize)`, section 11.9.4 layer 7, repainting on `size:active`), and — when the user asks to drape a size — the remesh step together with `rowToBodyParams`. The simulation uses the base-size pieces unless section 12 explicitly requests otherwise; sizing itself never touches the solver.

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
2. Items `{id: geom.piece.id + '@' + sizeName, w: bbox.maxX - bbox.minX, h: bbox.maxY - bbox.minY}`; `pack = packRects(items, sheetWidth - 2 * margin, { gap: opts.gap_mm, allowRotate: false })`. `opts.sheetWidth_mm === null` (per-piece export) → pack width = `max(item widths)` so the sheet fits the content.
3. `placed[k] = {geom, x: margin + pack.placements[k].x, y: contentTop + pack.placements[k].y, w, h}`; `width_mm = max(opts.sheetWidth_mm ?? 0, pack.width + 2 * margin, 10 + 100 + 10 + 150 /* header min */)`; `height_mm = contentTop + pack.height + margin`. Pieces are never rotated (grainline is respected).
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

Formulas (identical to `tileCount` in `src/core/units.js`, section 3.5.1 — `sheet.js` calls it, nothing re-derives page counts): `printableW = paperW - 2·margin`, `printableH = paperH - 2·margin`, `stepX = printableW - overlap`, `stepY = printableH - overlap`, `cols = max(1, ceil((width_mm - overlap) / stepX))`, `rows = max(1, ceil((height_mm - overlap) / stepY))`, tile `(r, c)`: `x0 = c·stepX`, `y0 = r·stepY`, `w = printableW`, `h = printableH` (sheet mm). Consecutive tiles overlap by exactly `overlap_mm`; `cols` tiles cover `cols·stepX + overlap ≥ width_mm`. Unknown paper → `ValidationError` `PRINT_PAPER_UNKNOWN`; `cols·rows > 400` → `PRINT_TOO_MANY_PAGES`; `margin_mm` must be in `[0, 25]` and `overlap_mm` in `[0, 30]` (`PRINT_OPTS_INVALID`).

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

`fabricEstimate`: items are the cut bboxes of `buildPieceGeometry` (`w` doubled for fold pieces because the cut is unfolded), repeated `cutQty` times; `packRects(items, fabricWidth_mm, { gap: gap_mm, allowRotate: false })`; `length_m = pack.height / 1000`. A 2-piece doc with 4 edges each and the default chart yields `1 + 4 × (2 × 5 + 1) = 45` lines.

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

`sizeName` defaults to `doc.ui.activeSize` when omitted; an unknown size throws `SIZE_UNKNOWN`. UI actions (section 11 buttons) → calls → filenames: *Export SVG sheet* → `exportDocSvg` → `FILENAMES.sheetSvg`; *Export selected piece SVG* → `exportDocPieceSvg` (selected piece, or the first piece when nothing is selected); *Grade nest* → `exportDocGradeNestSvg`; *Print tiles* → `exportDocPrintHtml` then `window.open` on the click (10.4); *Sizes CSV / JSON* → `exportDocSizesCsv/Json`; *Measurements CSV* → `exportDocMeasurementsCsv`; *Save project* → `saveProject` (filename `projectFilename(doc)`); *Open project* → `<input type="file">` → `readProjectFile` → store load; *Export OBJ* → `downloadClothObj(state)` with the live `ClothState` (section 7).

**Self-tests.** `runSelfTest(): Promise<SelfTestResult[]>` (section 3.1; `async` like every other module's, section 14.2, though nothing inside awaits; every check is one entry `{name, pass, details}`; a thrown exception inside a check becomes a failed entry, never an uncaught error). Section 12 exposes both under `window.__app` and the acceptance suite (section 13) requires every entry `pass === true`. Fixtures are built inline (no DOM): `SQ` = the 100 × 100 square above with `seamAllowance_mm: 10`, all edges `'line'`, `foldEdge: null`, one notch `{edge: 1, t: 0.5, kind: 'single'}`, grainline `{a:[50,20], b:[50,80]}`, `grade {widthRef:'chest_cm', lengthRef:null, anchorX:'fold', anchorY:'bottom', vertexRules:[]}`; `SQF` = same with `foldEdge: 3`; `CUB` = `SQ` with edge 2 cubic (`c1:[80,120]`, `c2:[20,120]`); `DOC2` = a `ProjectDoc` (through `normalizeDoc`) with pieces `A` (`SQ`, `widthRef 'chest_cm'`) and `B` (`SQ` translated by `[200,0]`, `widthRef null`), one seam `A.edge1 ↔ B.edge3`, `sizes = defaultChart()`, `ui.activeSize 'M'`, one fabric `main`.

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

---

## 11. App shell, UI, and the 2D pattern editor

This section owns `index.html` and `styles/shell.css` (Lead, Phase 0), `src/ui/` (A7) and `src/pattern/` (A2). The pattern editor *is* the left window, so it is specified here as 11.9–11.12.

**Contracts this section consumes (names must match the owning sections; where a name differs, the owning section's name wins and the semantics written here stay):**

| From | Names used here |
|---|---|
| 3.2 `src/core/events.js` | `EventBus` with `on(name, fn) -> unsubscribe`, `off(name, fn)`, `emit(name, payload)` (synchronous; **an unknown name throws**, so only names of the 3.2.2 table exist). `EVENT` constants used by this section are listed in 11.12.2 with their payloads. |
| 3.3 `src/core/store.js` | `store.get() -> ProjectDoc` (live object, never mutate outside `update`); `store.update(mutator, label)` — **mutator first, label second** — applied to a structuredClone; changes whose only hint is `ui` never create an undo entry (so there is no `undoable` option: `ui:*` labels are automatically not undoable); `store.batch(label)` for drags (steps emit `origin:'drag'`, one undo entry on `commit()`); `store.subscribe(listener) -> unsubscribe` — listener receives the `DocChanged` payload `(change)` with `change.doc`, `change.label`, `change.origin` (`'update'|'drag'|'commit'|'cancel'|'undo'|'redo'|'replace'`) and hint keys, before the bus emit; `store.undo()`, `store.redo()`, `store.canUndo()`, `store.canRedo()`, `store.replace(doc, label)` (a load; emits `origin:'replace'`); `store.transient` (tool/selection/hover/running, 3.3.5). Every `store.update('label', d => …, {undoable:false})` spelling in this section reads as `store.update(d => …, 'label')`. |
| 3.3 `src/core/schema.js` | `normalizeDoc(doc)` (fills every default of section 3.1). |
| `src/core/ids.js` | `uid(prefix)`, `hashString(s)`. |
| `src/core/fabrics.js` | `FABRIC_PRESETS`, `resolveFabric(instance)`, `TEXTURE_KINDS`, `DEFAULT_TEXTURE`. |
| `src/core/units.js` | `fmtMm`, `fmtCm`, `PAPER`. |
| 5 `src/geometry/index.js` | `edgeLength(piece, edgeIndex) -> mm` and `segmentLength(p0, edge, p1) -> mm`; `sampleEdge(piece, edgeIndex, n) -> Vec2[]` and `sampleSegment(p0, edge, p1, n) -> Vec2[]` (n+1 points, arc-length uniform; the segment forms are for in-progress drags); `pointAtArcFraction(p0, edge, p1, t) -> Vec2`; `paramAtArcFraction(p0, edge, p1, t) -> u` (bezier parameter, `u === t` for lines); `splitCubic(p0, c1, c2, p1, u) -> [[p0,c1a,c2a,m],[m,c1b,c2b,p1]]`; `signedArea(pts)`; `isSimplePolygon(pts)`; `pointInPolygon(pt, pts)`; `distToPolyline(pt, pts, closed) -> {dist, seg, t}`; `bbox(pts) -> {minX,minY,maxX,maxY}`; `flattenPiece(piece, tol_mm) -> {points:Vec2[], edgeStart:number[]}` (closed polyline, `edgeStart[e]` = index of the first point of edge e); `offsetOutline(piece) -> Vec2[]` (cut line, allowance discontinuities and fold edge handled). |
| 6.1 `src/body/index.js` | `BODY_PRESETS` (`Record<string, BodyParams>`, default preset `DEFAULT_PRESET_ID = 'female_m'`), `PRESET_LABELS` (`Record<string,string>`), `PARAM_DEFS` (`{key, label, min, max, step, unit}[]` in panel order — this replaces the `PARAM_RANGES`/`PARAM_ORDER` spellings used below: `PARAM_ORDER` = `PARAM_KEYS`, `PARAM_RANGES[k]` = the `PARAM_DEFS` entry with that key), `PARAM_KEYS` (`string[]`, the 20 keys). |
| 10 `src/sizing/index.js` | `gradePiece(piece, chart, sizeName) -> Piece` (graded copy; base size returns an equal copy); `rowByName(chart, name)`. |
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
| `btn-save` | button | `{action:'save'}` — wiring calls `saveProject(doc)` (section 10.6; filename `projectFilename(doc)`) |
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
| `body-params` | div | container of one `.param-row[data-param]` per entry of `PARAM_DEFS` (section 6.1) |
| `body-<param>` (e.g. `body-chest_cm`, `body-bustFullness`, `body-armAbduction_deg`) | input:range | min/max/step from the `PARAM_DEFS` entry of that key; value `doc.body.params[param]` |
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
| `range-bend-scale` (+`-val`) | input:range −1..1 | log10 of `doc.sim.bendScale` (0.1..10); `input` → batch step (3.3.6), `change` → batch commit `sim:bendScale` |
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
 * @property {(f:number)=>void} setSplit        clamps to [0.2, 0.8], applies, commits doc.ui.split (label 'ui:split'; ui-only, so never an undo entry)
 * @property {()=>number} getSplit
 * @property {(mode:'split'|'2d'|'3d')=>void} setLayout   commits doc.ui.layout (label 'ui:layout'; ui-only) and applies
 * @property {()=>'split'|'2d'|'3d'} getLayout
 * @property {()=>void} swap                    toggles doc.ui.swapped (label 'ui:swap'; ui-only) and applies
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
- `pointerup`/`pointercancel`: release capture, remove classes, commit `store.update(d => { d.ui.split = Math.round(f*1000)/1000; }, 'ui:split')`.
- `dblclick` on `#resizer`: `setSplit(0.5)`.
- Keyboard on the focused resizer: ArrowLeft/ArrowRight move the split by 0.02 (commit).

**Resize**: no resize event is emitted (there is no `ui:resize` in 3.2.2). The pattern editor (11.9.2) and the viewer (8.1) each own a `ResizeObserver` on their own container; layout changes are announced by `ui:layout`, which both use to "frame all".

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
3. `sel-sample` initial options are static in `index.html`; `refresh()` re-syncs them from `listSamples()` (`src/samples/index.js`, section 4.4) in case a sample is added.
4. `sel-size`: options rebuilt from `doc.sizes.rows` on every store notification (preserving the selected value); `change` → `store.update(d => { d.ui.activeSize = value; }, 'ui:activeSize')`.
5. `chk-selfcollision`: `change` → `store.update(d => { d.sim.selfCollision = checked; }, 'sim:selfCollision')`; value re-read from `doc.sim.selfCollision` on notification.
6. Tool buttons: `setTool(name)` sets `aria-pressed`/`active` and `#app.dataset.tool`; the toolbar listens to `EVENT.TOOL_CHANGED {tool}` (emitted by the editor) and never assumes the click succeeded.
7. `btn-undo`/`btn-redo` `disabled = !store.canUndo()` / `!store.canRedo()` after every notification.
8. Play/Pause: `setRunning(b)` toggles `btn-play.hidden = b`, `btn-pause.hidden = !b`; driven by `EVENT.SIM_PHASE {phase}` with `b = phase === 'sewing' || phase === 'draping'`.
9. Layout buttons mirror `EVENT.UI_LAYOUT` (`aria-pressed` on the matching `data-layout`); `btn-swap` gets `aria-pressed = swapped`; `btn-popout.disabled = popout` and `btn-popin` emits `{action:'popin'}`.
10. Export buttons pass `paper: sel-paper.value` on `print`; the SVG/CSV/JSON/OBJ actions pass nothing else (wiring reads `doc.ui.activeSize`).

---

### 11.5 `src/ui/dock.js`

```js
/** @returns {{setTab(name:'pieces'|'body'|'fabric'|'sizes'):void, getTab():string, destroy():void}} */
export function createDock(store, bus, root = document)
```

- Tabs are `#dock-tabs [role=tab][data-tab]`; panels are `#dock .dock-panel[data-panel]`.
- `setTab(name)`: for every tab set `aria-selected = (tab.dataset.tab === name)` and class `active`; for every panel set `panel.hidden = (panel.dataset.panel !== name)`; if `doc.ui.dockTab !== name` commit `store.update(d => { d.ui.dockTab = name; }, 'ui:dockTab')`; emit `EVENT.UI_DOCK {tab:name, prev}`. Unknown names throw `Error` (`code 'UI_BAD_TAB'`).
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
- Listens: `EVENT.UI_STATUS {level, text, ttl_ms?, code?}` → `setMessage`; `EVENT.TOOL_CHANGED` → `setToolHint(TOOL_HINTS[tool])` where `TOOL_HINTS` is exported from `src/pattern/index.js` (11.12.1); `EVENT.HOVER_CHANGED {mm}` → `setCursor(mm ? mm[0] : null, mm ? mm[1] : undefined)`; `EVENT.SEAM_PREVIEW` → `setSeamEase(a && b ? formatEase({lenA_mm, lenB_mm, easePct}) : null, level !== 'ok')` (`formatEase` from `src/pattern/index.js`); `EVENT.MESH_BUILT {meshes, issues}` → `setQuality(`min∠ ${minAngle}° · ${verts} v · ${tris} t`, issues.some(error) ? 'error' : warn ? 'warn' : 'info')`; `EVENT.SIM_STATS` → `setSim`; `EVENT.SIM_PHASE` → appends ` · paused` when `phase === 'paused'`; `EVENT.PATTERN_ISSUES` → message `n issues` (only when the count changes); `EVENT.SIZE_ACTIVE`, `EVENT.SIM_BUILT`, `EVENT.BODY_BUILT`, `EVENT.APP_READY`, `EVENT.POPOUT_CLOSE` → short info messages.
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

Every panel factory has the signature `createXPanel(store, bus, root = document) -> {refresh():void, destroy():void}`, subscribes to the store (`store.subscribe(change => …)`; full re-render of that panel on every notification — panels are small; keep focus: a panel never rebuilds an element that currently has focus, it only updates its value), and listens to `EVENT.SELECTION_CHANGED {selection}` (11.9.1) to know the primary piece / edge / seam. Panels write to the store with the labels in 11.1.2 and never call other modules' APIs directly; intent that needs the editor (`selectPiece`, `selectSeam`) goes through `EVENT.UI_ACTION`.

Common rules: numeric inputs commit on `change` (not on `input`) with the value parsed by `Number()`, clamped to the input's `min`/`max`; `NaN` reverts the field to the stored value. Text inputs commit on `change`. Checkboxes and selects commit on `change`.

#### 11.8.1 `panels/pieces.js`

- Renders `#list-pieces` rows in `doc.pieces` order; `selected` class from `selection.pieceIds`. Row click emits `{action:'selectPiece', pieceId, additive: e.shiftKey}`; double-click focuses `#inp-piece-name`.
- Piece fieldsets show the **primary** piece (`selection.pieceId`); `disabled` when none. Multi-selection: only the primary is edited.
- `piece:placement` writes the whole `placement` object rebuilt from the six controls (one label for all six).
- `piece:grade` likewise rebuilds `grade` keeping `vertexRules` untouched.
- Edge fieldset: shown when `selection.edge !== null`; `chk-edge-pinned` toggles membership in `pinnedEdges` (kept sorted ascending).
- Seam list: rows in `doc.seams` order; `selected` when `selection.seamId` matches; the swatch colour is `hsl(hueOf(seam.id) 70% 55%)` (11.9.4). Row text uses `formatSeamRow(doc, seam)` from `src/pattern/seams.js`.
- Issues list: from the last `EVENT.PATTERN_ISSUES {issues}` (3.2.2); rows show `⛔`/`⚠` + message; `data-code` = `issue.code`.
- `btn-piece-delete`: `store.update(d => { d.pieces = d.pieces.filter(p => !ids.has(p.id)); d.seams = d.seams.filter(s => !ids.has(s.a.pieceId) && !ids.has(s.b.pieceId)); }, 'piece:delete')`.

#### 11.8.2 `panels/body.js`

- On creation builds `#body-params` rows from `PARAM_DEFS` (section 6.1; `unit` is `'cm'|'deg'|''`): `<div class="param-row" data-param="<key>"><label for="body-<key>">${label} (${unit})</label><input id="body-<key>" type="range" min max step><input id="body-<key>-num" type="number" min max step></div>`; unit = `cm` for `_cm`, `°` for `_deg`, empty for `bustFullness`.
- `sel-body-preset` options: every key of `BODY_PRESETS` plus `custom`; `change` → `store.update(d => { d.body.preset = id; d.body.params = structuredClone(BODY_PRESETS[id]); }, 'body:preset')` (no-op for `custom`), then `bus.emit(EVENT.BODY_PARAMS_COMMIT, {key:null, preset:id, params})`.
- **Drag coalescing** (per slider):
  - `input` (fires continuously while dragging): update the twin number input, update a local `draft = {...doc.body.params, [key]: value}`, and emit `EVENT.BODY_PARAMS_DRAG {key, params: draft}` **at most once per animation frame** (a pending flag + `requestAnimationFrame`). No store write. Wiring rebuilds the body on a coarse grid (section 6) from this event.
  - `change` (pointer released or number typed): `store.update(d => { d.body.params[key] = value; d.body.preset = 'custom'; }, 'body:param')` — one undo step per gesture — followed by `bus.emit(EVENT.BODY_PARAMS_COMMIT, {key, preset:'custom', params})` (3.2.3). Wiring performs the full-resolution rebuild from the store notification.
  - Number input: `change` → same commit; `input` on the number field does nothing (typing partial numbers must not rebake).
- Store notification: write all 20 values into both inputs (skipping the focused one), set `sel-body-preset`.
- `EVENT.BODY_BUILT {model}`: fill `#body-measured` (`chest`, `waist`, `hips` target `model.params.<k>` vs `model.measured.<k>`, one decimal, `data-warn` when `|Δ| > 1.5`), `#body-build-ms` (`build ${model.buildMs.toFixed(0)} ms`), and `#body-closest-size`: for each row of `doc.sizes.rows`, `Δ = Σ_k |row[k] − params[k]|` over `doc.sizes.measurements` that exist in `params`; text `closest size: ${name} (Δ ${Δ.toFixed(1)} cm)`.
- `btn-body-fit-size`: `store.update(d => { const row = rowByName(d.sizes, d.ui.activeSize); for (const k of d.sizes.measurements) if (typeof row[k] === 'number' && k in d.body.params) d.body.params[k] = row[k]; d.body.preset = 'custom'; }, 'body:fitSize')`, then `BODY_PARAMS_COMMIT {key:null, preset:'custom', params}`.

#### 11.8.3 `panels/fabric.js`

- `sel-fabric-piece` options from `doc.pieces`; when `EVENT.SELECTION_CHANGED` carries a primary piece and the select is not focused, it follows the selection. The edited instance is `doc.fabrics.find(f => f.id === piece.fabricId)`; `#fabric-id` shows `${f.id} — ${f.name}`.
- `sel-fabric-preset`: `change` → `store.update(d => { inst.preset = id; }, 'fabric:preset')` (overrides are kept; colour is kept).
- `input-color`: a store **batch** (3.3.6 rule 5): the first `input` opens `b = store.batch('fabric:color')`, each `input` (coalesced per animation frame) is `b.update(d => { inst.color = hex; })` (origin `'drag'`; wiring's `fabric:changed` reaction is cheap and runs on every origin, so the 3D material and the 2D fill follow live), `change` → `b.commit()` (one undo entry). There is no `fabric:preview` event.
- `sel-texture` (options `TEXTURE_KINDS`), `input-color2` (`input` batch step, `change` commit), `range-texture-scale` (`input` updates `-val` and steps the batch, `change` commits) → all commit with label `fabric:texture` writing the whole `texture` object.
- `range-bend-scale`, `range-stretch-scale`: slider value `v ∈ [−1, 1]` ↔ scale `10^v` (0.1..10); `-val` shows `×${(10**v).toFixed(2)}`; `input` → batch step `b.update(d => { d.sim.bendScale = 10**v; })` (wiring's `applySimSettings` is in place and runs on every origin, section 7 `setScale`); `change` → `b.commit()` with batch label `'sim:bendScale'` | `'sim:stretchScale'` (value rounded to 3 significant digits). There is no `sim:scale:drag` event.
- `#fabric-physics`: rebuilt from `resolveFabric(inst)` on every notification.

#### 11.8.4 `panels/sizes.js`

- Table rebuilt on every notification from `doc.sizes` (11.1.2 markup). Base row `data-base="true"`; the row clicked last has class `selected` (local state, defaults to the base row).
- Cell `change`: `store.update(d => { rowByName(d.sizes, size)[key] = value; }, 'sizes:cell')`. Name cell `change`: `store.update(d => { row.name = newName; if (d.sizes.baseSize === old) d.sizes.baseSize = newName; if (d.ui.activeSize === old) d.ui.activeSize = newName; }, 'sizes:rename')`; an empty or duplicate name is rejected (status warn, field reverted).
- `btn-size-add`: `store.update(..., 'sizes:add')` appends a row: name = first of `['XS','S','M','L','XL','XXL','3XL']` not in use, else `size${rows.length+1}`; values = last row + `SIZE_STEP_CM[key]` where `SIZE_STEP_CM = {chest_cm:4, waist_cm:4, hips_cm:4, height_cm:5, torsoLength_cm:1, armLength_cm:1}` and `0` for any other key (matches the default chart's L → XL step). The new row becomes `selected`.
- `btn-size-remove`: refuses when the selected row is the base or the only row (`EVENT.UI_STATUS` warn `Cannot remove the base size`); otherwise `store.update(..., 'sizes:remove')`; if `ui.activeSize` pointed at it, `activeSize = baseSize`.
- `sel-base-size` → `store.update(d => { d.sizes.baseSize = name; }, 'sizes:baseSize')`.
- `btn-size-from-body` → `store.update(d => { let row = rowByName(d.sizes, 'Body'); if (!row) d.sizes.rows.push(row = {name:'Body'}); for (const k of d.sizes.measurements) row[k] = d.body.params[k] ?? row[k] ?? 0; }, 'sizes:fromBody')`.
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

`src/ui/selftest.js` — `export async function runSelfTest() -> SelfTestResult[]` runs **in the live page** (it needs `index.html`), snapshots the document with `serializeDoc`, and restores it with `store.replace(parseDoc(snapshot), 'selftest restore')` at the end. Checks:

1. `ids-present`: every id in `REQUIRED_IDS` resolves with `document.getElementById`.
2. `split`: `layout.setSplit(0.3)` → `#pane-left.getBoundingClientRect().width` equals `0.3 · (mainWidth − 306)` ± 2 px and `store.get().ui.split === 0.3`; `setSplit(0.05)` clamps to 0.2.
3. `swap`: `layout.swap()` → `#pane-left.firstElementChild.id === 'pane-3d'` and `#app.dataset.swapped === 'true'`; swap again restores.
4. `layout-modes`: `setLayout('2d')` → `#main.dataset.solo === slotOf('2d')` and `#pane-3d`'s slot has `display:none`; `setLayout('split')` clears `data-solo`.
5. `dock`: `dock.setTab('body')` → only `#panel-body` is not hidden, `tab-body.aria-selected === 'true'`, `doc.ui.dockTab === 'body'`.
6. `statusbar`: `setMessage('hello', 'warn')` → `#status-msg.textContent === 'hello'`, `data-level === 'warn'`; `getLog()` last entry text `hello`.
7. `shortcut-tool`: dispatching `new KeyboardEvent('keydown', {key:'s', bubbles:true})` on `window` emits `EVENT.UI_ACTION {action:'tool', tool:'seam'}` (3.2.2; captured with a one-shot listener).
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
 * The editor's selection IS the shared `Selection` of section 3.2 (`store.transient.selection`, payload of `selection:changed`),
 * extended with three editor-local optional fields. Readers use the 3.2 names; the older spellings below map as:
 *   pieceIds → `pieces`; pieceId (primary) → `pieces[pieces.length - 1] ?? null`; seamId → `seams[0] ?? null`;
 *   vertex (index) → `vertex.index` (with `vertex.pieceId` = the primary piece); edge (index) → `edge.edge` (with `edge.pieceId`).
 * @typedef {Object} Selection
 * @property {string[]} pieces         selected piece ids (order of selection; the LAST one is the primary piece)
 * @property {string[]} seams          selected seam ids (0 or 1 in v1)
 * @property {{pieceId:string, index:number}|null} vertex   single selected outline vertex
 * @property {{pieceId:string, edge:number}|null} edge      single selected outline edge
 * @property {boolean} [edgeMirror]    editor-local: true when the selected edge is the mirrored ghost copy of a fold piece
 * @property {{pieceId:string, edge:number, which:'c1'|'c2'}|null} [handle]   editor-local
 * @property {{pieceId:string, index:number}|null} [notch]                    editor-local
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
2. Compute `w = view.screenToWorld(ev.x, ev.y)`; emit `EVENT.HOVER_CHANGED {mm: w, pieceId, edge, vertex, seamId}` on `move` (from the hit, throttled per animation frame; `mm: null` on `pointerleave`).
3. `hit = hitTest(doc, view, ev.x, ev.y, {selection, tool})` (11.9.3).
4. Build `ToolEvent = {type, x_mm, y_mm, px, py, shift, alt, ctrl, button, hit}` and call `tool.onDown/onMove/onUp/onDblClick`.
5. Hover = the hit on `move` when no button is pressed; on change → `requestRender()` and `onHover` callbacks. Canvas cursor = `tool.cursor(hoverHit)`.

**Store subscription** (`store.subscribe(change => …)`, 3.3): on every notification: drop selection ids/indices that no longer exist (the store already reset `transient.selection` on `replace`; the editor then emits `selection:changed`); if `change.origin === 'replace'` and `opts.autoFit`, `view.fitToPieces()`; unless `change.origin === 'drag'`, schedule validation (11.11.2) and always `requestRender()`. The editor writes `tool`, `selection`, `hover` and `seamPick` into `store.transient` (3.3.5) and emits the matching event right after each write; `view.js`'s `onChange` emits `view2d:changed`.

**Tool interface** (`tools/*.js`, each `export function createXTool(ctx) -> Tool`, `ctx = {store, bus, editor, view, commit(label, mutator), status(text, level), setSeamEase(text|null, warn)}`; `commit` = `store.update(mutator, label)`; `status` emits `EVENT.UI_STATUS {level, text, source:'pattern'}`; `setSeamEase` emits `EVENT.SEAM_PREVIEW` (3.2.2) — the text form is derived by the status bar):

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

Conventions: "commit(label, fn)" = `store.update(fn, label)`; previews use the tool's `transient` and never write to the store until the gesture ends; a drag starts only after the pointer moved ≥ 3 px from the down point (below that a down/up pair is a click). `status(text)` writes `EVENT.UI_STATUS` info messages; errors use level `warn` (nothing in the editor is fatal).

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
- `onMove` in `FIRST` over a candidate edge `b ≠ a` → live readout: `setSeamEase(formatEase(seamEaseOf(doc, a, b)), ease > 8)` (emitted as `EVENT.SEAM_PREVIEW {a, b, lenA_mm, lenB_mm, easePct, level, seamId:null}`); otherwise `setSeamEase(null)` (`SEAM_PREVIEW` with `b:null`).
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

`edgeLengthOf` uses `geometry.segmentLength(p0, edge, p1)` (= `geometry.edgeLength(piece, e)`); results are cached per `(piece object identity, e)` in a `WeakMap` (pieces are replaced, not mutated, by the store, so identity is a valid cache key).

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

Issues carry `pieceId`, `seamId`, `edge` where applicable. The editor runs `validateDoc` after every store notification, coalesced to the next animation frame, and emits `EVENT.PATTERN_ISSUES {issues}` (3.2.2); the status bar shows `n issues` (level `error` if any error) only when the count changes. `error`-level issues do not block editing; the wiring layer (section 12) decides which pieces are excluded from meshing (`PIECE_*`/`FOLD_*` errors exclude the piece; `SEAM_*` errors exclude the seam).

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

**Labels** (`store.update(mutator, label)`; the `ui:*` labels touch only `doc.ui`, so the store creates no undo entry for them, 3.3.2 step 7). Wiring (section 12) uses the prefix to decide what to rebuild: `piece:*`, `vertex:*`, `handle:*`, `edge:*`, `notch:*`, `seam:*`, `grainline:*` → re-mesh + re-arrange; `body:*` → rebuild body; `fabric:*`, `sim:*` → in-place updates; `sizes:*`, `ui:*` → no simulation change.

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

**Events** (constant names, string values and payloads are the ones of 3.2.2 — that table is normative; this one only lists what section 11 touches. Names that earlier drafts of this section used and that do NOT exist: `UI_RESIZE`, `UI_DOCK_TAB`, `STATUS`, `PATTERN_CURSOR`, `SEAM_EASE`, `FABRIC_PREVIEW`, `SIM_SCALE_DRAG`, `SIM_STATE`, `QUALITY`):

| `EVENT.*` | name | payload (3.2.2) | emitter → consumers |
|---|---|---|---|
| `UI_ACTION` | `ui:action` | `{action, ...}` (tables in 11.1.2 and 11.7) | toolbar, shortcuts, panels → wiring only |
| `UI_LAYOUT` | `ui:layout` | `{layout, swapped, split, popout}` | layout → toolbar, pattern/view, viewer3d/scene (via wiring) |
| `UI_DOCK` | `ui:dock` | `{tab, prev}` | dock → panels (lazy work) |
| `UI_STATUS` | `ui:status` | `{level, text, source?, ttl_ms?, code?}` | anyone → statusbar, debugApi |
| `TOOL_CHANGED` | `tool:changed` | `{tool, prev}` | editor → toolbar, statusbar |
| `SELECTION_CHANGED` | `selection:changed` | `{selection, prev}` (`Selection` = `{pieces, seams, vertex, edge}`) | editor → panels, statusbar; wiring (anchor gizmo) |
| `HOVER_CHANGED` | `hover:changed` | `{mm, pieceId, edge, vertex, seamId}` (`mm` null when off-canvas) | editor → statusbar |
| `PATTERN_ISSUES` | `pattern:issues` | `{issues:Issue[]}` | editor → pieces panel, statusbar, wiring |
| `SEAM_PREVIEW` | `seam:preview` | `{a, b, lenA_mm, lenB_mm, easePct, level, seamId}` | seam tool → statusbar, pieces panel |
| `VIEW2D_CHANGED` | `view2d:changed` | `{pxPerMm, panMm, width, height}` | view → statusbar |
| `BODY_PARAMS_DRAG` | `body:params:drag` | `{key, params:BodyParams}` | body panel → wiring (coarse rebake) |
| `BODY_PARAMS_COMMIT` | `body:params:commit` | `{key, preset, params}` | body panel → statusbar, body panel |
| `BODY_BUILT` | `body:built` | `{model, quality, ms}` | wiring → body panel, statusbar |
| `MESH_BUILT` | `mesh:built` | `{meshes, issues, ms}` | wiring → pieces panel, statusbar |
| `SIM_BUILT` | `sim:built` | `{state, meshes, ms}` | wiring → toolbar (enable play), statusbar |
| `SIM_STATS` | `sim:stats` | `SimStats` (one object reused per frame — copy fields) | wiring tick → statusbar (4 Hz DOM) |
| `SIM_PHASE` | `sim:phase` | `{phase, prev, time, frame}` | wiring → toolbar (`setRunning`), statusbar |
| `SIM_NAN` | `sim:nan` | `{frame, nanCount, restored}` | wiring → statusbar |
| `FABRIC_CHANGED` | `fabric:changed` | `{fabricId, resolved, physicsChanged, lookChanged, pieceIds}` | wiring → fabric panel, editor (fill colour) |
| `SIZE_ACTIVE` | `size:active` | `{size, prev, row}` | wiring → editor (ghost), sizes panel, toolbar (`sel-size`), statusbar |
| `POPOUT_OPEN` / `POPOUT_CLOSE` | `popout:open` / `popout:close` | `{at}` / `{reason, at}` | wiring → toolbar, statusbar |
| `APP_READY` | `app:ready` | `{version, ms, sample}` | main → statusbar, debugApi |

#### 11.12.3 `src/pattern/selftest.js`

`export async function runSelfTest() -> SelfTestResult[]`. Runs headless in the page or in a bare document: creates `canvas = document.createElement('canvas')` (800×600 CSS px, appended to a hidden `div` so `getBoundingClientRect` works), a fresh store from `src/core/store.js` loaded with `normalizeDoc({name:'selftest'})` (which yields the default fabric `main` and the default size chart), a fresh `EventBus`, and `createEditor(canvas, store, bus, {autoFit:false})`. Helper `clickWorld(x, y, mods)` = `injectPointer(down)` + `injectPointer(up)` at `view.worldToScreen(x, y)`. Every check returns `{name, pass, details}`; the suite never throws.

1. `view-roundtrip`: `view.set({cx:50, cy:50, pxPerMm:2})`; for `(0,0)`, `(100,100)`, `(−37.5, 12.25)`: `screenToWorld(worldToScreen(p))` within `1e-9` mm; `worldToScreen(50,50)` equals `(400, 300)`; `worldToScreen(100, 100)` equals `(500, 200)` (y flipped).
2. `view-zoom-anchor`: `zoomBy(2, 100, 100)` keeps `screenToWorld(100,100)` unchanged within `1e-9`; `set({pxPerMm: 100})` clamps to `20`.
3. `draw-square-ccw`: `setTool('draw')`; `clickWorld(0,0)`, `(100,0)`, `(100,100)`, `(0,100)`, then `clickWorld(0,0)` (closing on the first vertex) → `doc.pieces.length === 1`, 4 vertices equal to the clicked points in that order, `signedArea === 10000`, `edges` all `line`, `foldEdge === null`, `grainline.a[0] === 50`, `fabricId === doc.fabrics[0].id`, `getTool() === 'draw'`, selection = the new piece, `store.canUndo() === true`.
4. `draw-clockwise-fixed`: draw `(0,0)`, `(0,100)`, `(100,100)`, `(100,0)` + Enter (`editor.confirm()`) → vertices reversed to CCW (`signedArea === 10000`), `vertices[0]` equals `[0,0]`... (order after reversal: `[0,0],[100,0],[100,100],[0,100]`).
5. `draw-reject`: draw the bowtie `(0,0)`, `(100,100)`, `(100,0)`, `(0,100)` + Enter → no piece added, tool still placing; `editor.cancel()` returns true and clears.
6. `seam-api-reverse`: pieces A = square `(0..100)`, B = square `(120..220, 0..100)` via `addPiece`; `id = addSeam({pieceId:A, edge:1, mirror:false}, {pieceId:B, edge:3, mirror:false})` → `seam.b.reverse === true`, `seam.a.reverse === false`, `seam.kind === 'plain'`, `seamEase(doc, seam).easePct === 0`.
7. `seam-pointer`: fresh doc with the same A and B; `setTool('seam')`; `clickWorld(100, 50)` (A edge 1 midpoint) → transient `seamFirst` is `{pieceId:A, edge:1}`; `injectPointer(move)` over `(120, 50)` → last `EVENT.SEAM_PREVIEW` has `lenA_mm 100`, `lenB_mm 100`, `easePct 0` and `formatEase` of it is `'A 100 mm / B 100 mm - ease 0.0%'`; `clickWorld(120, 50)` → `doc.seams.length === 1`, `b.reverse === true`, selection.seamId set.
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

---

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

**Module functions that `src/app/` calls.** Each row names the capability A8 relies on and the export name of the owning module's `index.js` **as reconciled in Phase 0** (the owning section stays authoritative; `docs/CONTRACTS.md` is the cheat sheet). Where the prose of 12.1–12.5 still uses an older spelling (`store.load`, `doc:loaded`, `editor.fit`, `viewer.clothMesh.setState`, `ui.statusbar.message`, `pattern-canvas`, …), the mapping in this table wins and A8 adapts the call site. The *semantics* in the third column are what A8 depends on and must hold.

| Module (section) | Expected export | Semantics A8 relies on |
|---|---|---|
| `src/core/store.js` (3.3) | `createStore(doc, bus)` → `store` with `get()`, `update(mutator, label)`, `batch(label)`, `undo()`, `redo()`, `replace(doc, label, {keepHistory?})`, `subscribe(fn)`, `canUndo()`, `canRedo()`, `history()`, `transient`, `revision`; also `diffHints`, `makeTransient`, `TOOL_NAMES`, `HISTORY_LIMIT` | `update` clones, applies the mutator, normalises + validates, computes hints itself (3.3.4), pushes history and emits `EVENT.DOC_CHANGED` with `{label, origin, doc, warnings, pieces?, seams?, fabrics?, body?, sizes?, sim?, ui?, name?}`. There is NO `doc:loaded` event: `replace` emits `doc:changed` with `origin:'replace'` (treat as "everything changed"). `origin:'drag'` = batch step (expensive reactions skip it). Synchronous. |
| `src/core/events.js` (3.2) | `bus` (the shared instance), `EventBus` (class; the pop-out makes its own), `EVENT` name constants | `bus.on(name, fn)` returns an unsubscribe function; `bus.emit(name, payload)` is synchronous; a throwing listener is caught by the bus, logged, and does not stop other listeners; **an unknown name throws** — only the 3.2.2 names exist (`ui:action`, `pattern:issues` included; `doc:loaded`, `cloth:built`, `status:message`, `popout:changed` do not: use `doc:changed` origin `replace`, `sim:built`, `ui:status`, `popout:open`/`popout:close`). |
| `src/core/schema.js` (3.4) | `normalizeDoc(partial)` → `ProjectDoc`, `serializeDoc(doc)` → string, `parseDoc(text)` (JSON.parse + migrate + normalize; `ParseError`), `validateShape(doc)` → `Issue[]`, `migrate(doc)` | `normalizeDoc({})` yields a complete empty document: `name:'Untitled'`, body preset `female_m` with its params, one fabric `{id:'main', preset:'cotton'}`, no pieces, no seams, the default size chart (S/M/L/XL, base M), default `SimSettings`, default `UiState` (`layout:'split'`, `split:0.5`, `activeSize:'M'`, `dockTab:'pieces'`). |
| `src/core/fabrics.js` (3.6, 9.1) | `FABRIC_PRESETS`, `FABRIC_PRESET_IDS`, `getPreset(id)`, `hasPreset(id)`, `isHexColor(s)`, `resolveFabric(instance)` → `FabricResolved`, `resolveAll(doc)` → `Map`, `diffResolved(a, b)`, `fabricForPiece(doc, piece)`, `effectiveMeshSpacing(piece)`, `TEXTURE_KINDS`, `PHYSICS_KEYS` | Pure. |
| `src/core/sdf.js` (3.7) | `sampleSdf(grid, x, y, z, outGrad)` → `number` | returns the signed distance (m); `outGrad[0..2]` receives the UNIT gradient when non-null; outside the grid `d = +1` (`SDF_OUTSIDE`) and grad = (0,1,0). |
| `src/core/ids.js` | `uid(prefix)`, `hashString(s)` → uint32 | Deterministic hash (used for fingerprints). |
| `src/samples/index.js` (4.4) | `SAMPLES`, `DEFAULT_SAMPLE_ID`, `listSamples()` → `{id,name}[]`, `getSample(id)` → `ProjectDoc` | Returns a fresh deep copy each call; unknown id **throws** `Error{code:'UNKNOWN_SAMPLE'}` (debugApi maps it to `E_NO_SAMPLE`). |
| `src/geometry/index.js` (remesh, section 5) | `remeshPiece(piece, doc, {spacingFactor})` → `PieceMesh`; throws `Error` with `code:'RemeshError'` | Uses `doc.seams` for seam-consistent boundary sampling (partner edge lengths), mirrors fold pieces, honours `piece.meshSpacing_mm`. Pure, synchronous, ≤ 200 ms for the largest sample piece. The vertex cap (12.2.5) is applied by passing `opts.spacingFactor = ctx.mesh.spacingFactor` to EVERY piece (seam partners must see the same factor) — the doc is never modified. |
| `src/pattern/index.js` (11.9) | `createEditor(canvasEl, store, bus, {autoFit})` → `editor` with `view.resize()`, `view.fitToPieces()`, `view.worldToScreen(x_mm, y_mm)` → `[px, py]`, `view.screenToWorld(px, py)` → `[x_mm, y_mm]`, `view.zoomBy`, `setTool(name)` (throws `PATTERN_BAD_TOOL`), `getTool()`, `select({pieces, seams, vertex, edge}, {additive})`, `getSelection()`, `clearSelection()`, `injectPointer(ev)`, `cancel()`, `confirm()`, `deleteSelection()`, `nudge(dx, dy)`, `mirror()`, `addPiece(vertices, partial)` → id, `addSeam(a, b, reverse?)` → id, `removeSeam(id)`, `getIssues()`, `requestRender()`, `renderNow()`, `destroy()`; `validateDoc(doc)` → `Issue[]`; `seamEase(doc, seam)` → `{lenA_mm, lenB_mm, easePct, longer}`; `chooseReverse(doc, a, b)` → boolean; `formatEase`, `TOOL_HINTS`, `TOOL_NAMES` | There is no `setGhost`/`setIssues`: the editor validates itself (emits `pattern:issues`) and draws the graded ghost itself on `size:active`. The editor writes to the store only on pointer-up (one undoable entry per drag via `store.batch`), never per pointer-move. `px, py` are CSS pixels relative to `#canvas-2d`'s top-left. Tool names: `select, draw, edit, split, seam, notch, grainline, measure`. |
| `src/body/index.js` (6.8) | `buildBody(params, {cell, reuseGeometry?})` → `BodyModel`; `sampleBody(model, x, y, z, outGrad)`; `BODY_PRESETS` (`Record<string, BodyParams>`), `PRESET_LABELS`, `listPresets()`, `DEFAULT_PRESET_ID` (`'female_m'`), `clampParams(params)` → `BodyParams`, `PARAM_DEFS`, `PARAM_KEYS` | Synchronous. `cell = 0.015` (full) or `0.030` (coarse). Full build of `female_m` ≤ 400 ms; coarse ≤ 80 ms. |
| `src/cloth/index.js` (7.13) | `buildCloth({meshes, doc, fabrics})` → `ClothState` (`fabrics` = `resolveAll(doc)` from `core/fabrics.js`, a `Map` keyed by instance id); `arrange(state, body, doc)`; `pushOut(state, sdf)`; `step(state, sdf)` → `SimStats`; `drape(state)`; `reset(state)`; `phase(state)`; `setFabricParams(state, pieceIndex, fabric)`; `setSettings(state, simSettings)`; `setScale(state, bend, stretch)`; `setPin(state, v, target)`; `stats(state)` → `SimStats`; `snapshot(state)` → `{frame,time,pos,vel}`; `restore(state, snap)`; fixtures/testfields re-exported | `step` advances exactly one frame (`dt = 1/60`, `substeps` from `state.params`) and is deterministic. `arrange` writes `pos`, `prev`, `restPos`, `pTarget`, zeroes `vel`, sets `time = 0`, `frame = 0`, `sStart` per seam. NaN guard inside `step` restores the solver's own periodic snapshot and increments `state.nanCount`. The SDF is passed per call so A8 can swap grids atomically by changing one reference (`ctx.body.model.sdf`). |
| `src/viewer3d/index.js` (8.9) | `createViewer3D(containerEl, {tick, viewer?, onFps?})` → `v` with `setBody(model)`, `setCloth(state, fabricsByPiece?)`, `sync(state, force?)`, `setPieceFabric(pieceId, fabric)`, `fit()`, `render()`, `screenshot()`, `setWireframe(on)`, `setLandmarks(on)`, `setGizmo(on)`, `setBodyOpacity(a)`, `stats()`, `dispose()`; sub-handles `v.viewer` (`resize()`, `frame(box)`, `fit(model)`), `v.loop` (`start()`, `stop()`, `isRunning()`, `renderSuppressed`, `renderNow()`, `fps`), `v.cloth` (`updatePositions(pos)`, `setPieceFabric`, `topology()`), `v.body`, `v.gizmo` (`highlight(name)`, `setVisible(on)`), `v.popout` (`open()`, `close()`, `isOpen()`, `onOpened(fn)`, `onClosed(fn)`) | The container is `#view-3d` (11.1.2). `tick(dtMs, frame)` is given at creation and runs once per rAF **before** the render; the wiring's tick steps the solver and calls `v.sync(state)`. `renderNow()` renders synchronously even while `renderSuppressed`. `screenshot()` renders then reads the canvas in the same task. There is no piece highlight in v1 (the gizmo highlight stands in). `stats()` → `{fps, frames, drawCalls, triangles, V, T, lastFrameMs}`. |
| `src/sizing/index.js` (10) | `gradeDoc(doc, sizeName)` → `Piece[]` (all pieces, graded, same ids); `gradePiece(piece, chart, sizeName)`; `closestSize(body, chart)` → `{name, index, score, deltas}` (**body first, chart second**); `rowByName(chart, name)`; `rowToBodyParams(chart, name, body)`; `seamEasePct(pieces, seam)`; `sizeNames(chart)` | Pure. `gradeDoc(doc, chart.baseSize)` returns deep copies equal to `doc.pieces`. Unknown size → `ValidationError` code `SIZE_UNKNOWN` (debugApi maps to `E_NO_SIZE`). |
| `src/export/index.js` (10.7) | `exportDocSvg(doc, size)` → string; `exportDocPieceSvg(doc, pieceId, size)` → string; `exportDocGradeNestSvg(doc, pieceId)`; `exportDocPrintHtml(doc, size, {paper, orientation?})` → `{html, plan}` (page count = `plan.tiles.length`); `exportDocSizesCsv(doc)` / `sizeChartCsv(chart)` → string (header `size,chest_cm,…`); `exportDocMeasurementsCsv(doc)` → string; `exportDocSizesJson(doc)` / `sizeChartJson(chart)`; `clothObj(state, {name?})` → string; `buildPieceGeometry(piece, size)` → `{cut, stitch, …}` (the cut line for `__app.export.cutLine`); `saveProject(doc)`, `downloadText(filename, mime, text)`, `downloadSvg(filename, svg)`, `parseProjectText(text)`, `readProjectFile(file)`, `FILENAMES` | All return strings; only `download*`/`saveProject` touch the DOM. `paper ∈ {'A4','Letter','A3'}`. Errors are `ValidationError`s with the codes of section 10 (debugApi wraps them as `E_EXPORT`). |
| `src/ui/index.js` (11.8.5) | `createUi({store, bus, root})` → `ui` with `layout` (`setLayout(mode)`, `swap()`, `setSplit(f)`, `setPopout(on)`, `getState()`), `toolbar` (`setRunning(b)`, `setTool(name)`, `refresh()`), `dock` (`setTab(tab)`, `getTab()`), `statusbar` (`setMessage(text, level, ttl_ms)`, `setSim(stats)`, `setQuality(text, level)`, `setToolHint`, `setCursor`, `setSeamEase`, `getLog()`), `panels` (`pieces`, `body`, `fabric`, `sizes`, each `{refresh(), destroy()}`), `shortcuts`, `destroy()`; `REQUIRED_IDS` (`string[]`, every id of section 11 — `__app.ui.elements()` returns it) | Panels write to the store themselves via `store.update` and re-render from `store.subscribe` and the 3.2 events (`body:built`, `mesh:built`, `selection:changed`, `pattern:issues`, …) — wiring never pushes data into panels (no `setModel`/`setIssues`/`setSelection`). All UI intents reach wiring as `ui:action` payloads (11.1.2, 11.7); the body panel additionally emits `EVENT.BODY_PARAMS_DRAG` on every slider `input` event (doc untouched) and `EVENT.BODY_PARAMS_COMMIT` on `change`/pointer-up **after** its `store.update`. |

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
| 2 | `store` | `doc = getSample(id)` or `normalizeDoc({})`; apply `?size`; `ctx.store = createStore(doc, bus)` (it normalises and validates; a `ValidationError` → `E_BAD_DOC`). On failure fall back to `createStore(normalizeDoc({}), bus)` so the app still boots empty. | — | < 10 ms |
| 3 | `api` | `installDebugApi(ctx, wiring)` (12.3) — installs `window.__app` with `ready` pending. Actually done before stage 1 (see 12.1.4); listed here for the stage table only. | — | < 1 ms |
| 4 | `ui` | `ctx.mods.ui = createUi({store, bus, root: document})`: builds toolbar/dock/statusbar/shortcuts behaviour on the static `index.html` skeleton (ids of section 11); applies `doc.ui.layout/split/swapped/dockTab`. | store | < 30 ms |
| 5 | `editor` | `ctx.mods.editor = createEditor(document.getElementById('canvas-2d'), store, bus)`; `editor.view.fitToPieces()`. | ui (canvas element exists in the skeleton even if `ui` failed, so this stage only depends on `store`) | < 30 ms |
| 6 | `viewer` | `const viewer3d = await import('../viewer3d/index.js')` (dynamic, inside the stage, so a CDN failure of `three` is a stage error, not a blank page); `ctx.mods.viewer = viewer3d.createViewer3D(document.getElementById('view-3d'), { tick: wiring.tick })`: WebGL2 renderer, camera, controls, lights; the loop starts rendering an empty scene immediately (a frame renders even if everything after fails). | store | < 150 ms (+ CDN fetch of three, outside the budget) |
| 7 | `body` | `wiring.buildBody('full')` → `ctx.body.model`; `viewer.setBody(model)` (fits the camera on the first body); emits `body:built` (the Body panel updates itself). | viewer (mesh update is skipped, not failed, if viewer is null) | ≤ 400 ms |
| 8 | `remesh` | `wiring.remesh(null, {force:true})` — all `simulate` pieces; `RemeshError` on a piece excludes that piece and records `ctx.mesh.failed`; the stage itself fails only if *every* piece failed. | store | ≤ 250 ms (T-shirt sample) |
| 9 | `cloth` | `wiring.rebuildCloth()` → `ctx.cloth.state`; `viewer.setCloth(state)` then `viewer.sync(state, true)`. | remesh (≥ 1 mesh), body (arrangement needs anchors; without a body the stage is skipped) | ≤ 100 ms |
| 10 | `arrange` | `wiring.arrange()` — `cloth.arrange(state, body, doc)` then `cloth.pushOut(state, sdf)` (every vertex with `d < clearance` is moved out along the SDF normal before the first step — graft from patternmaking-first). | cloth | ≤ 20 ms |
| 11 | `drape` | Unless `ctx.cloth.userPaused`: `wiring.drape()` — `time = 0`, `running = true`, phase `sewing`, `EVENT.SIM_PHASE`. With `?nosim=1`: phase `arranged`, not running. | arrange | < 1 ms |
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
* `showStatus(ctx, level, text, code)` emits `EVENT.UI_STATUS` (the status bar listens); when `ui` is null it writes to `#status-msg` directly (id from section 11); when that element is missing it creates `<div id="boot-error">` fixed at the bottom of `document.body` (red background, monospace, the message and the stage name). Every message is also appended to `ctx.log`.
* A `window.addEventListener('error')` / `'unhandledrejection'` pair installed at the top of `boot()` routes uncaught errors to `showStatus('error', …, 'E_UNCAUGHT')` and `ctx.log`; the loop keeps running.
* `index.html` carries no inline script besides the import map (11.1). So that a CDN failure can never blank the page, `main.js` must not import `three` (or any module that does — `src/viewer3d/index.js`, `src/body/index.js` via `mesh.js`) statically: those two are loaded with `await import()` inside their boot stages; a rejected import becomes a stage error shown as "three.js failed to load from cdn.jsdelivr.net — check the network (or run `python vendor.py` and open index.local.html)" in `#status-msg`.

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
 * @property {(dtMs: number, frame: number) => void} tick   the per-frame tick (12.2.6; signature of section 8.6); exported so tests can call it
 * @property {(doc: ProjectDoc) => Keys} computeKeys  fingerprints (12.2.3)
 */
```

`start()` subscribes with `bus.on` and keeps the unsubscribe functions; `stop()` calls them and `clearTimeout`s every pending timer. All handlers are wrapped by `guard(name, fn)`: any exception is caught, logged (`ctx.log`, `console.error`), shown in the status bar as `level:'error'` with the error's `.code` (or `E_REACTION`), and the app continues; the cloth state in use before the handler ran stays in use (`ctx.cloth.stale = true` when the handler was a rebuild).

#### 12.2.1 Event → handler table

Event names are the `EVENT` constants of section 3.2 (string values shown for readability). Payload columns state what wiring **reads**; extra payload fields are ignored.

| Event (emitter) | Payload read | Handler (wiring) |
|---|---|---|
| `doc:changed` (store, every origin) | `{doc, origin, label, pieces?, seams?, fabrics?, body?, sizes?, sim?, ui?, name?}` | `onDocChanged` (12.2.2): `origin === 'replace'` → the load path below; otherwise diff fingerprints (restricted to the hint keys present), then schedule remesh/rebuild (debounced 120 ms; skipped for `origin:'drag'`), body full build (debounced 150 ms; skipped for `'drag'`), in-place fabric/sim updates (immediate, every origin, then emit `fabric:changed`), `size:active` (immediate). |
| `doc:changed` with `origin:'replace'` (store, on `replace`) | `{doc}` | Reset all fingerprints and caches (`ctx.mesh.byPiece.clear()`, `failed.clear()`, `spacingFactor = 1`), cancel pending timers, `ctx.cloth.userPaused = ctx.params.nosim` (a load re-enables auto-drape unless `?nosim=1`), `buildBody('full')` (only if the body fingerprint changed), `rebuildAll()`, `viewer.fit()`, `setActiveSize(doc.ui.activeSize)`. The editor fits itself (`autoFit`) and `ui/layout.js` re-applies `doc.ui` from its own store subscription. |
| `body:params:drag` (body panel, per slider `input`) | `{key, params}` | `ctx.pending.dragParams = clampParams(params)`; throttle **100 ms leading + trailing**: if no coarse build ran in the last 100 ms build now, else arm `dragTimer` for the remainder. Build = `buildBody('coarse', params)` → `ctx.body.model` swap (atomic: single reference assignment; the solver reads `ctx.body.model.sdf` at the next `step`), `viewer.setBody(model)`, emit `body:built {model, quality:'coarse', ms}`. The cloth keeps running; the solver's gentle re-projection (section 7: at most 5 mm per frame) pushes vertices out of the enlarged body. No arrange, no remesh. |
| `body:params:commit` (body panel, on release, after its `store.update`) | `{key, preset, params}` | Cancel `dragTimer` only (3.2.3: the full rebuild is driven by the `doc:changed` `body` hint that arrived from the same `store.update`, `requestBodyBuild('full')`, debounced 150 ms). After the build: SDF swap as above, `viewer.setBody(model)`, emit `body:built {model, quality:'full', ms}` (the Body and Sizes panels update themselves; the closest size is `closestSize(params, chart)`). Never re-arranges the cloth; the new anchors are used by the next `arrange()`. |
| (`doc:changed` with a `fabrics` hint, or a piece whose `fabricId` changed — wiring EMITS `fabric:changed`, nobody else does) | `{fabrics:[ids]}` | `applyFabric(fabricId)`: `resolved = resolveFabric(instance)`; for every `state.pieces[k]` with `pieceId`'s `fabricId === id`: `cloth.setFabricParams(state, k, resolved)` (rewrites `invMass`, `mu`, `damp`, `clearance`, `eAlpha`, `bAlpha` slices in place, section 7); `viewer.setPieceFabric(pieceId, resolved)`; then `bus.emit(EVENT.FABRIC_CHANGED, {fabricId, resolved, physicsChanged, lookChanged, pieceIds})` (`diffResolved` against the previous resolution) — the fabric panel and the editor (fill colour) listen to it. Immediate, every origin including `'drag'` (colour picker batch); no rebuild. |
| (`doc:changed` where `doc.ui.activeSize !== ctx.lastActiveSize` — wiring EMITS `size:active`) | — | `setActiveSize(name)`: `bus.emit(EVENT.SIZE_ACTIVE, {size:name, prev, row: rowByName(doc.sizes, name)})`; the editor draws the graded ghost itself (11.9.4), the toolbar/sizes panel re-render. Never affects the simulation (it always simulates the base size on the current body). |
| `selection:changed` (editor) | `{selection:{pieces, seams, vertex, edge}, prev}` | if exactly one piece selected and a body exists: `viewer.gizmo.highlight(piece.placement.anchor); viewer.setGizmo(true)` else `viewer.setGizmo(false)`. Panels and the status bar listen to the event themselves (selection text `Front · 4 vertices · seams 3`, or for a seam the ease readout `A 312 mm / B 328 mm - ease 5.1%`). |
| `tool:changed` (editor) | `{tool, prev}` | nothing in wiring: `ui/toolbar.js` (`setTool`) and `ui/statusbar.js` (`TOOL_HINTS`) listen themselves (3.2.3). |
| `sim:phase` (emitted by wiring itself) | `{phase, prev, time, frame}` | nothing in wiring: `ui/toolbar.js` (`setRunning(phase === 'sewing' || phase === 'draping')`) and the status bar listen themselves. |
| `sim:nan` (emitted by wiring's tick when `stats.nanCount` grew; cloth is pure and emits nothing) | `{frame, nanCount, restored}` | Push `performance.now()` to `ctx.cloth.nanEvents` (keep last 10); status `warn` "Solver recovered from NaN (frame F, restored snapshot R)"; if ≥ 3 events within 10 s: `pause()`, status `error` "Simulation paused: repeated instability — press Reset or Drape", phase `error`. |
| `ui:layout` (ui/layout.js, after divider drag / swap / layout mode / popout) | `{layout, swapped, split, popout}` | `editor.view.resize()`; `viewer.viewer.resize()`; if `layout === '2d'` or `popout` → `viewer.loop.stop()` (no hidden rendering and no stepping — see 12.2.6) else `viewer.loop.start()`. Also called once at the end of boot. |
| `window` `resize` (DOM) | — | Same as `ui:layout` (resize only). |
| `ui:action {action:'popout'}` → `viewer.popout.open()`; the bridge's `onOpened`/`onClosed` callbacks (8.8) make wiring EMIT `popout:open {at}` / `popout:close {reason, at}` | — | open → `ui.layout.setPopout(true)` (2D pane solo, `doc.ui` untouched) and `viewer.loop.stop()`; close → `ui.layout.setPopout(false)`, `viewer.loop.start()`; `open()` returning false → `popout:close {reason:'blocked'}` + the status message of 8.8. Not part of the automated acceptance (judges' correction: popups are not automatable). |
| `ui:action` (toolbar, shortcuts, panels) | `{action, ...}` | the dispatcher: `tool` → `editor.setTool`; `mirror` → `editor.mirror()`; `fit2d` → `editor.view.fitToPieces()`; `zoom` → `editor.view.zoomBy` / `fitToPieces`; `delete`/`cancel`/`confirm`/`nudge` → the editor; `selectPiece`/`selectSeam` → `editor.select`; `undo`/`redo` → `store`; `new` → `store.replace(normalizeDoc({}), 'New project')`; `loadSample` → `store.replace(getSample(name), …)`; `open` → `parseProjectText(text)` → `store.replace`; `save` → `saveProject(doc)`; `arrange`/`drape`/`play`/`pause`/`togglePlay`/`reset` → wiring; `frame3d` → `viewer.fit()`; `layout`/`swap` → `ui.layout`; `dockTab` → `ui.dock.setTab`; `popout`/`popin` → the bridge; `export` → the section-10 exporters + `download*` (`print` opens the window on this click). |

Events **emitted by wiring** (3.2.2 names and payloads, consumed by ui panels, the status bar, `tests/acceptance.js`): `body:built {model, quality, ms}`, `mesh:built {meshes, issues, ms}`, `sim:built {state, meshes, ms}`, `sim:phase {phase, prev, time, frame}`, `sim:stats SimStats` (once per rendered frame while running or stepping; ONE object reused), `sim:nan`, `fabric:changed`, `size:active`, `popout:open`/`popout:close`, `ui:status {level, text, source, code}` (for caught module errors). No other names exist; the bus throws on unknown names.

#### 12.2.2 `onDocChanged` decision procedure

```
onDocChanged({doc, hints, source}):
  1. groups = origin === 'replace' ? ['pieces','seams','body','fabrics','sim','sizes','ui'] : the hint keys present on the payload (pieces, seams, fabrics, body, sizes, sim, ui, name)
     if origin === 'drag': only steps 6-8 run (cheap in-place work); remesh/rebuild/body wait for the batch commit
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
  viewer.setCloth(newState); viewer.sync(newState, true)                    // atomic swap for rendering
  if (!ctx.cloth.userPaused) drape() else { phase='arranged'; emit sim:phase }
  emit mesh:built, sim:built ; status info "Remeshed front, back (1 812 v) · rebuilt 2 612 v / 5 020 tris in 138 ms"
```

"Keep the old cloth running until the new one is built" means exactly: `ctx.cloth.state` and the viewer's cloth geometry are replaced **only** at the swap line, after `rebuildCloth()` and `arrange()` succeeded; frames rendered meanwhile (the debounce window, and any frame in which a reaction threw) show and step the previous state. The rebuild itself is synchronous (< 200 ms for the samples) inside one task.

#### 12.2.3 Fingerprints (`computeKeys`)

All keys are `hashString(JSON.stringify(...))` (uint32; `hashString` from `core/ids.js`). Numbers are stringified as-is (no rounding) except where noted.

| Key | Input | Consequence when changed |
|---|---|---|
| `mesh[pieceId]` | `{v: vertices, e: edges, f: foldEdge, n: notches, h: meshSpacing_mm, sf: spacingFactor, s: seamsTouching}` where `seamsTouching` = for every seam with a side on this piece, sorted by seam id: `[seam.id, thisSide.edge, thisSide.mirror, thisSide.reverse, other.pieceId, other.edge, other.mirror, round(otherEdgeLength_mm * 100)]` (`otherEdgeLength_mm` from `pattern.seamEase(doc, seam)`) | remesh this piece (+ rebuild) — includes the seam-partner case: when a partner's edge length changes, this piece's boundary sampling changes too |
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

After any remesh, if `Σ vertexCount` over cached meshes `> 8000`: `ctx.mesh.spacingFactor = min(4, spacingFactor * sqrt(total / 8000) * 1.05)`; all pieces are remeshed with `remeshPiece(piece, doc, {spacingFactor})` (section 5.6 `effectiveSpacing`; the doc is **not** modified); status `warn` "Mesh spacing raised ×1.23 to stay under 8 000 vertices". When a later remesh with `spacingFactor = 1` would fit (checked by estimating `Σ area_mm2 / (0.433 * h²)` per piece — the hex-lattice vertex density), the factor is reset to 1 and pieces are remeshed at their stored spacing.

#### 12.2.6 The frame tick

Registered once via `viewer.loop.setTick(wiring.tick)`; called before each render.

```
tick(dtMs, frame):                                                // section 8.6 signature; dtMs is informational only
  state = ctx.cloth.state ; if (!state) return
  if (ctx.cloth.running && !ctx.cloth.stepping):
      sdf = ctx.body.model ? ctx.body.model.sdf : null          // null → cloth skips collision (section 7 safety)
      stats = cloth.step(state, sdf)                              // exactly one frame, dt = 1/60, fixed substeps
      ctx.cloth.lastStats = stats
      if (stats.nanCount > prevNan) bus.emit(EVENT.SIM_NAN, {frame, nanCount, restored})   // cloth is pure; wiring emits
      updatePhase(state)                                          // sewing → draping when state.time ≥ sim.sewTime_s + 0.5 → emit sim:phase once
      dirty = true
  if (dirty || ctx.cloth.dirty): viewer.sync(state, ctx.cloth.dirty) ; ctx.cloth.dirty = false
  if (dirty): bus.emit(EVENT.SIM_STATS, ctx.cloth.lastStats)     // every frame, the ONE reused object (3.2.3); the status bar throttles its own DOM writes
```

* `ctx.cloth.dirty` is set by `arrange`, `reset`, `restore` and the SDF swap so a paused cloth is re-uploaded once.
* When the 3D pane is hidden (`layout === '2d'`) the viewer loop is stopped, so the sim does not advance; `sim.step(n)` still works (it never depends on rAF).
* No adaptive substepping (section 1: determinism). If `msAvg > 20` for 60 consecutive frames the status bar shows `warn` "Simulation slow (23 ms/frame) — raise mesh spacing" once per minute; nothing else changes.
* Status bar sim text format: `sewing · f 312 · 8.4 ms · 2 612 v · pen 0.8 mm · gap 2.1 mm · 60 fps`.

#### 12.2.7 Body build helper

```
buildBody(quality, params = doc.body.params):
  cell = quality === 'full' ? 0.015 : 0.030
  model = body.buildBody(clampParams(params), {cell})        // throws → status error 'E_BODY', keep old model, return null
  ctx.body.model = model ; ctx.body.quality = quality        // atomic swap: the solver reads ctx.body.model.sdf per step
  ctx.body.key = keys.body(params)
  viewer?.setBody(model)                                     // also refreshes the anchor gizmo
  ctx.cloth.dirty = true
  emit body:built {model, quality, ms: model.buildMs}         // Body / Sizes panels and the status bar update themselves
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
 |            |--store.update(d => d.pieces[i].vertices[2] = [x,y], 'vertex:move')  (a batch.commit() for a drag)-->|
 |            |                             |--emit doc:changed {doc, pieces:['front'], origin:'update'|'commit'}-->|
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
 |            |                             |             |-----viewer.setCloth(state); viewer.sync(state, true) [swap]----------->|
 |            |                             |             |     if (!userPaused) drape(): time=0, running=true, phase='sewing'
 |            |                             |             |--emit sim:phase-->|                                                    |--toolbar Pause state
 |            |                             |             |--emit mesh:built, sim:built-->|                                       |--pieces panel counts
 |            |                             |             |     status info "Remeshed front (912 v) · rebuilt 2 612 v in 138 ms"--------------------->|
 next rAF:  viewer.loop → wiring.tick → cloth.step(state, sdf) → viewer.sync(state) → emit sim:stats → render (statusbar writes at 4 Hz)
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
                                                      // store.replace → doc:changed (origin 'replace') → full pipeline runs synchronously; returns the normalised doc
  loadSample(id: 'tshirt'|'skirt'): ProjectDoc,       // E_NO_SAMPLE; same path as load()
  idle(): Promise<void>,                              // resolves on the next macrotask after wiring.flush() (every mutator already flushes; kept for readable test code)
  save(): string,                                     // serializeDoc(doc) (sorted keys, 2-space indent); load(save()) then save() is byte-identical

  pattern: {
    pieces(): Piece[],
    addPiece(piece: Partial<Piece> & {vertices: Vec2[]}): string,
        // = editor.addPiece(vertices, partial) (11.10.2 defaults): id = uid('piece'), name = id, edges = all 'line', foldEdge null, notches [], grainline = vertical arrow through the bbox centre
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
    deletePiece(id: string): void,                       // E_NO_PIECE; removes the piece and every seam referencing it (label 'piece:delete')
    movePiece(id: string, dx_mm: number, dy_mm: number): void,   // E_NO_PIECE; opTranslate (label 'piece:move')
    seamEase(id: string, sizeName?: string): {lenA_mm:number, lenB_mm:number, easePct:number, longer:'a'|'b'|'equal'},
        // easePct = (max - min) / min * 100, 2 decimals; E_NO_SEAM; with sizeName the graded pieces (gradeDoc) are measured (E_NO_SIZE)
    validate(): Issue[],                                  // validateDoc(doc) + validateShape(doc), errors first
    fit(): void,                                          // editor.view.fitToPieces()
    worldToScreen(x_mm: number, y_mm: number): [number, number],   // CSS px relative to #canvas-2d top-left (clientX = canvas.getBoundingClientRect().left + px)
    screenToWorld(px: number, py: number): [number, number],       // inverse; mm, y up
    setTool(name: 'select'|'draw'|'edit'|'split'|'seam'|'notch'|'grainline'|'measure'): void,   // E_BAD_ARG on unknown name
    click(x_mm: number, y_mm: number, opts?: {button?:0|2, shift?:boolean, ctrl?:boolean, alt?:boolean, double?:boolean}): [number, number],
        // dispatches REAL events on #canvas-2d at worldToScreen(x_mm, y_mm): pointerdown, pointerup, click (and dblclick when opts.double),
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
    all(): PieceMesh[],                      // live cached meshes in doc.pieces order (simulate pieces that meshed)
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
    modelLive(): BodyModel,                    // LIVE model (typed arrays; read-only by convention) for NaN scans; E_NO_BODY
    measured(): {chest_cm:number, waist_cm:number, hips_cm:number},   // model.measured; E_NO_BODY
    sdf(x: number, y: number, z: number): {d:number, n:Vec3},   // signed distance in metres + unit gradient from the CURRENT grid (coarse or full); d = +1 outside the grid; E_NO_BODY
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
    play(): void,                              // running = true, userPaused = false; if phase was 'arranged' or 'error' it behaves like drape(); emits sim:phase
    pause(): void,                             // running = false, userPaused = true; emits sim:phase
    reset(): SimStats,                         // cloth.reset(state): pos = restPos, vel = 0, time = 0, seams re-armed; running unchanged; dirty = true
    arrange(): SimStats,                       // wiring.arrange(): re-derive restPos from the current body anchors + placements, pushOut, then reset semantics
    drape(): SimStats,                         // wiring.drape(): arrange + time = 0 + running = true (userPaused = false); phase 'sewing'
    stats(): SimStats,                         // last stats, or cloth.stats(state) when never stepped; E_NO_CLOTH
    phase(): 'empty'|'arranged'|'sewing'|'draping'|'paused'|'error',   // the 3.2 SimPhase names plus 'empty' and 'error'
        // empty: no state; arranged: time = 0, not running; sewing: running && time < sewTime_s + 0.5; draping: running && time >= sewTime_s + 0.5;
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
    closest(): {name: string, score: number},  // closestSize(doc.body.params, doc.sizes) — body first (10.1)
    setCell(name: string, key: string, value_cm: number): void,   // E_NO_SIZE; E_BAD_ARG if key not in chart.measurements or value not finite > 0
    addRow(row: SizeRow, index?: number): void,                   // E_BAD_ARG on duplicate name or missing measurement keys
    removeRow(name: string): void,                                // E_BAD_ARG when removing the base size
    fitBody(name: string): BodyModelSummary,   // copies the row's measurement keys into doc.body.params (plain copy, same keys/units) + full build; E_NO_SIZE
  },

  export: {
    svg(size?: string, pieceId?: string): string,   // size default doc.ui.activeSize; pieceId given → pieceSvg(doc, pieceId, size); omitted → sheetSvg(doc, size)
    sheetSvg(size?: string): string,                // exportDocSvg: packed sheet, all export pieces (exportHidden pieces excluded), 1 user unit = 1 mm, width/height in mm
    printHtml(size?: string, paper?: 'A4'|'Letter'|'A3'): string,   // exportDocPrintHtml(...).html; paper default 'A4'; complete HTML document string (the UI opens it in a new window; __app never does)
    pageCount(size?: string, paper?: 'A4'|'Letter'|'A3'): number,   // exportDocPrintHtml(...).plan.tiles.length; must equal the number of `.page` elements in printHtml(size, paper)
    csv(): string,                                  // exportDocSizesCsv(doc): header `size,chest_cm,...` + one row per size, values cm (10.5)
    pieceCsv(): string,                             // exportDocMeasurementsCsv(doc): per piece × size edge lengths, seam ease %, area (10.5)
    cutLine(pieceId: string, size?: string): Vec2[],   // buildPieceGeometry(gradedPiece, size).cut — closed CCW cut polygon, mm, pattern space; E_NO_PIECE, E_NO_SIZE
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
    run(filter?: string|RegExp): Promise<{pass:boolean, passed:number, failed:number, total:number, ms:number, results:{id:string, name:string, pass:boolean, ms:number, details:string}[], errors:string[]}>,
        // ASYNC. Lazily imports ../../tests/acceptance.js (section 13) and runs the checks whose id/name matches `filter` (all when omitted).
        // = runAcceptance(filter) of tests/acceptance.js (13.1). Runs on the live app: it loads samples and mutates the document; the doc is restored to what it was before the run (store.replace of a saved copy).
    list(): Promise<{id:string, name:string}[]>,
  },

  viewer: {
    screenshotDataUrl(): string,                    // 'data:image/png;base64,...' of the 3D canvas after a synchronous render; E_NOT_READY if the viewer failed
    frame(): void,                                  // camera fit to body + cloth bounds
    fps(): number,                                  // moving average over the last 60 rendered frames (0 while paused)
    resize(): void,
    materialOf(pieceId: string): object,            // the LIVE three.js material rendering that piece (`__app.viewer` facade `cloth.object.material[k]`); E_NO_PIECE, E_NOT_READY
  },
};
```

**Determinism contract for tests.** `sim.step(n)` after `loadSample(id)` on the same machine produces bit-identical `SimStats` across runs: fixed `dt`, fixed substeps, seeded jitter in remesh (section 5), no time-dependent code paths in the solver, and `flush()` removing every debounce from the automation path.

**Broken-state guarantee.** Every `__app` mutator either (a) throws before touching the store, or (b) commits one undoable `store.update`/`store.replace` and then runs the pipeline under `guard`. Hence `__app.undo()` always returns the document to the previous state, and a pipeline failure leaves the previous cloth/body in use with `ctx.cloth.stale === true` and a status-bar error; the next successful pipeline run clears `stale`.

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
2. With `?nosim=1`: `__app.sim.phase() === 'arranged'`, `running() === false`, `mesh.stats().verts > 0`; `__app.sim.drape()` → `phase() === 'sewing'`.
3. Simulated module failure (`__app.ctx.mods.viewer = null; __app.loadSample('tshirt')`) still resolves the pipeline: `mesh.stats().verts > 0`, the status bar contains a message, no uncaught exception.
4. `__app.pattern.setVertices('front', movedVerts)` returns synchronously with `__app.mesh.stats().perPiece` updated (flush works) and `__app.undo()` restores the vertices and remeshes back (`mesh.stats()` equal to before, `seamPairsEqual === true`).
5. `__app.body.setParam('chest_cm', 100, {commit:false})` → `body.model().quality === 'coarse'`; `__app.body.setParam('chest_cm', 100)` → `'full'`; `sim.step(120)` → `maxPenetration_mm < 5`, `nanCount === 0`.
6. `__app.sim.step(60)` called twice from the same loaded sample (reload in between) yields identical `SimStats.seamGapMean_mm` and `maxSpeed` (determinism).
7. `for (const id of __app.ui.elements()) document.getElementById(id) !== null`; `__app.ui.click('btn-play')` then `__app.ui.click('btn-pause')` toggles `sim.running()`; `__app.ui.setValue('body-chest_cm', 95)` (ids per section 11) changes `body.params().chest_cm` to 95 and `body.model().quality === 'full'`.
8. Every `__app` function with a bad argument throws an `ApiError` whose `code` is in `ERROR_CODES`, and `__app.doc()` deep-equals the document from before the call.

### PROPOSED additions outside `types.js` (reviewer decides)

No amendment to `src/core/types.js` is required by this section (`AppContext`, `BootResult`, `BodyModelSummary` and `ApiError` are app-local).

Resolved in Phase 0 (no additions to 3.2 beyond `UI_ACTION` and `PATTERN_ISSUES`): `DOC_LOADED` → `DOC_CHANGED` with `origin:'replace'`; `CLOTH_BUILT` → `SIM_BUILT`; `STATUS_MESSAGE` → `UI_STATUS`; `POPOUT_CHANGED` → `POPOUT_OPEN`/`POPOUT_CLOSE`. Every other name above exists in 3.2.2.

Store contract (section 3.3, authoritative): `update(mutator, label)` emits `doc:changed {label, origin, doc, warnings, ...hints}` with hints computed by the store (`pieces`, `seams`, `fabrics` = id arrays; `body`, `sizes`, `sim`, `ui`, `name` = `true`); `replace(doc, label)` emits `origin:'replace'` (wiring treats it as "everything changed"); `batch(label)` steps emit `origin:'drag'`.

---

## 13. Acceptance suite (`tests/acceptance.js`)

> **Known flake (lead, 2026-09-17) — check 14 `color_change` intermittently reports 76-79 s.** The suite has run
> clean end to end in 58.8 s with every check but 10 passing; on other runs of the identical build this one check
> stalls and the 90 s runtime check fails with it. The application is not at fault, and this was measured rather than
> assumed: the same operation takes 128-372 ms when driven directly, running check 13 and then 14 back to back takes
> 13.0 s and 224 ms, the event bus holds 37 listeners before and after five sample reloads, and fourteen consecutive
> `loadSample` calls each take about 150 ms with the renderer's geometry, texture and program counts flat at 1 / 1 / 3
> and the heap steady at 22-42 MB. Instrumenting the check itself shows its own steps total about 1.4 s
> (`reloadSample` internals 1.26 s, `setColor` 1 ms, the two `idle()` calls 75 and 58 ms) while the outer measurement
> reads 76 s — that is, the main thread is blocked while the check is suspended at an await, which points at the host
> (a hidden browser pane is throttled, and these runs shared the machine with four other simulations) rather than at
> anything the suite or the app does.
>
> Two real defects WERE found and fixed while chasing it, both in the runner: `Promise.race` abandons a timed-out
> check without stopping it, so its synchronous solver steps then blocked the next check (the runner now waits for an
> abandoned check to settle, and check 13's budget is sized to the ~13 s of simulation it actually runs); and several
> checks restart the drape when they reload a sample, so the animation loop competed with later checks (the runner now
> pauses the solver before every check, not only once in the preamble).

> **Amendment (lead, 2026-09-15) — the shoulder strain, and how it was reduced.** Peak tensile strain on the sample
> T-shirt fell from 124% to 19% and the 99th percentile from 11.4% to 8.1%, by two independent changes that compose.
> Check 10 (`strain_cotton`) still FAILS at p99 8.1% against a 5% target and is left failing on purpose: a woven
> shows 1-2%, so the gap is real and should not be tuned away.
>
> Mechanism, established by measurement. Instrumenting p99 strain every 30 frames shows it is CREATED in the last 30
> frames of sewing (7.2% at frame 30 with the seams still 80 mm apart, 11.3% at frame 60 as the seam ramp reaches
> L = 0) and then never decays — identical at every frame from 90 to 780, with maxSpeed pinned at 0.270 m/s. It is
> trapped rather than required: relaxing the settled state at mu = 0 for 300 frames takes the peak from 68.7% to
> 40.4%, and it stays there when friction is restored. The cause is the ORDER of events — the seam weld goes rigid at
> the same instant the gravity ramp reaches full weight and the sewing damping drops 5x, so the fabric is pressed
> hardest onto the body exactly when it can no longer slide.
>
> Fix 1, solver (`src/cloth/solver.js`, MU_RELEASE and friends): a release window after the seams reach L = 0 — for
> 0.5 s friction is scaled by 0.2 and gravity by 0.05, both ramped back to 1 over 1.5 s. Nothing is softened; only the
> load and the stiction are held back until the fabric has found its length. Peak 70% -> 22%, p99 11.39% -> 8.48%, and
> the seam gap and penetration IMPROVE (1.7 -> 0.9 mm, 3.99 -> 3.01 mm) because the panels slide into their closed
> configuration instead of being dragged into it. The window is gated to states that have seams, so the fixtures of
> 7.11 keep their own friction and gravity. It must NOT be opened during sewing: at a friction scale of 0.25 a
> sleeve-cap seam slips past its partner and never closes (68.8 mm).
>
> Fix 2, pattern (`src/samples/tshirt.js`): a band-by-band SDF analysis showed the deficit is the NECK OPENING, which
> belongs to no seam record — the front half-neck was stretching 179.3 -> 211.6 mm (+18.0%) and the back 88.1 -> 104.6
> (+18.7%) — plus tight bands at the hem and armscye. Widening the hem and chest, moving the neck point to [95, 588],
> redrafting the neck as a quarter-ellipse and growing the armhole from 200.7 to 218.7 mm with the cap re-cut to match
> (0.01%) takes the combination to peak 19%, p99 8.13%, seam gap 0.0 mm, penetration 2.26 mm. All 10 seam records stay
> matched, every piece stays CCW and simple, and the draped silhouette still reads as a T-shirt: it hangs 15-76 mm
> clear of the body, the neckline sits at 91 mm half-width against a 76 mm neck and a 190 mm shoulder joint, and the
> hem falls at y = 843 mm, above the crotch.
>
> Also measured and rejected, with numbers: contact as a compliant XPBD inequality converging with the fabric (it
> trades about 0.3 p99-points per mm of penetration and the 5 mm cap binds first — alpha 0.07 already breaks it); a
> second full constraint sweep per substep (p99 9.63% but the skirt stops resting, 224-415 of 3294 vertices above
> 0.5 m/s, at every seam split tried); pre-relaxing the arrangement (fixes the START — arranged p99 66.6% -> 5.69% —
> and changes the outcome by 0.04 points, because the bad initial configuration relaxes away on its own by frame 30);
> and widening the shoulder tip beyond x = 206, which is a bifurcation: the armhole's top folds over the shoulder
> ridge and the cap seams tear open (43-53 mm), regardless of cap length, corner shape or sleeve offset.



The acceptance suite is the definition of "v1 works". It runs **inside the app page** against `window.__app` (section 12), is owned by A8, and is imported lazily — `src/app/debugApi.js` does `await import('../../tests/acceptance.js')` the first time `__app.acceptance.run()` is called, so the suite costs nothing at boot and can never break the app.

### 13.1 Runner contract

```js
// tests/acceptance.js — imports: ../src/core/schema.js (normalizeDoc, serializeDoc), ../src/core/units.js (PAPER),
// ../src/cloth/index.js + ../src/cloth/fixtures.js (hanging-sheet fixture), every module's selftest.js (lazy).
// Never imports three or the DOM API beyond document.getElementById / DOMParser.

/** @typedef {{id:string, name:string, pass:boolean, ms:number, details:string}} AcceptanceResult */
/** @typedef {{pass:boolean, passed:number, failed:number, total:number, ms:number, results:AcceptanceResult[], errors:string[]}} AcceptanceSummary */

/** Ordered list of checks; each entry is {id, name, timeoutMs, fn: () => Promise<string>} — fn resolves with the details string
 *  on success and throws (any Error, or an AssertionError from expect()) on failure. id = zero-padded number ('01'), name as in 13.3. */
export const CHECKS;

/**
 * Runs the whole suite (or the checks whose id or name matches `filter`) and NEVER throws. This is what
 * `__app.acceptance.run(filter)` (12.3) calls; `__app.acceptance.list()` reads CHECKS.
 * @param {string|RegExp} [filter]   undefined = every check; a string is a substring match on id/name
 * @param {{log?:boolean}} [opts]    log=true (default) prints console.table(results)
 * @returns {Promise<AcceptanceSummary>}
 */
export async function runAcceptance(filter, opts);
```

Runner rules (A8 implements exactly these):

1. **Preamble** (once per `run`): `errorsAtStart = errorsNow().length`; `__app.sim.pause()` (the rAF loop must not step the solver while a check steps it synchronously); remember `document.title`.
2. **Per check**: `const t0 = performance.now()`; `Promise.race([fn(), timeout(check.timeoutMs)])` inside `try/catch`; a throw or timeout yields `{name, pass:false, details:'threw: ' + err.message}` (timeout message: `'timeout after N ms'`). A resolved value yields `{name, pass:true, details}`. The elapsed ms are appended to `details` as ` [123 ms]`. Default `timeoutMs = 20000`; the `selftests` check gets 30000.
3. **Isolation**: every check that mutates the document starts with `await reloadSample('tshirt')` (helper below) and the runner calls `reloadSample('tshirt')` once more at the end, then `__app.sim.play()` to restore the live loop and `document.title` is set to `ACCEPTANCE PASS n/n` or `ACCEPTANCE FAIL k/n`.
4. **Postamble**: `errors = errorsNow().slice(errorsAtStart).map(e => e.message)`; `summary.errors = errors`; the summary is stored in `__app.acceptance.last` and in `window.__acceptanceResult`; `document.body.dataset.acceptance = summary.pass ? 'pass' : 'fail'`; `console.log('ACCEPTANCE_RESULT ' + JSON.stringify({pass, passed, failed, total, ms, failedNames}))` (one line, greppable from `--enable-logging=stderr`).
5. **`?acceptance=1`**: `src/app/main.js` checks `new URLSearchParams(location.search).get('acceptance') === '1'` and, after `__app.ready`, calls `__app.acceptance.run()` automatically (nothing else changes).
6. **Runtime target**: the whole suite completes in **< 90 s** on the test machine (budget below: ≈ 30 s of solver stepping, ≈ 5 s body bakes, ≈ 10 s self-tests, the rest DOM/export work). A summary `ms > 90000` is reported in `details` of the last synthetic result `runtime` (pass = ms < 90000).

Helpers inside the file (no other file may import them):

```js
function expect(cond, msg)                 // throws Error('ASSERT: ' + msg) when !cond
function near(a, b, tol, label)            // expect(Math.abs(a-b) <= tol, `${label}: ${a} vs ${b} ±${tol}`)
async function reloadSample(id)            // __app.loadSample(id); await __app.idle(); __app.sim.pause(); returns __app.doc()
function errorsNow()                       // __app.log().filter(l => l.level === 'error')  (the app has no `errors` array; 12.3 `log()`)
function timeout(ms)                       // Promise that rejects after ms
function signedArea(pts)                   // shoelace, mm²; pts: Vec2[]
function isSimplePolygon(pts)              // O(n²) proper-intersection test between non-adjacent segments (n ≤ 4000)
function bboxOf(pts)                       // {minX,minY,maxX,maxY,w,h}
function parseSvg(str)                     // DOMParser 'image/svg+xml'; throws if a <parsererror> element exists
function svgSizeMm(doc)                    // {w,h} from width/height attributes; throws unless both match /^(\d+(\.\d+)?)mm$/
function gpuRenderer()                     // UNMASKED_RENDERER_WEBGL string from a scratch webgl2 canvas ('' if unavailable)
function stateOf()                         // __app.sim.state()  (live ClothState, section 3.1)
function landmark(name)                    // __app.body.modelLive().landmarks[name]  (Vec3, metres)
```

### 13.2 Surface consumed by the suite

The suite touches only the following members of `window.__app` (section 12, whose spellings are used below after the Phase-0 reconciliation) and module exports. If a frozen section spells one differently, **A8 adapts the suite** (rule 14.4) — never the module. Older spellings that still appear in the check texts of 13.3 map as: `__app.errors` → `errorsNow()`; `__app.bootMs` → `(await __app.ready).ms`; `__app.store.getDoc()/undo()/redo()` → `__app.doc()/undo()/redo()`; `saveProject()`/`loadProject(s)` → `save()`/`load(s)`; `pattern.getMeshes()` → `mesh.all()`; `pattern.remesh(id)` → `mesh.remesh(id)`; `body.getParams()/getModel()/getMeasurements()/listPresets()` → `body.params()/modelLive()/measured()/presets()`; `await body.rebuild()` → the synchronous return of `setPreset`/`setParam` (a `BodyModelSummary`; use `modelLive()` for arrays); `sim.getState()/isRunning()/setSelfCollision(b)` → `sim.state()/running()/setSetting('selfCollision', b)`; `sizes.gradedOutline(id, size)` → `sizes.grade(size).find(p => p.id === id).vertices`; `export.svgSheet({size})/printHtml({size, paper})/sizeChartCsv()/offsetPolygon(id, size)` → `export.sheetSvg(size)/printHtml(size, paper)/csv()/cutLine(id, size)`; `ui.getLayout()` → `ui.state().layout`; `selftest.runAll()` → `selftest.run()` grouped by the `module/` prefix.

| Member | Used as |
|---|---|
| `__app.ready` (Promise of `BootResult {ok, ms, errors, stages}`), `__app.version` | boot check (`(await __app.ready).ms < 8000`) |
| `__app.log()` (`{t, level, message, code}[]`, last 200; debugApi also records `window.onerror`, `unhandledrejection` and every `console.error` call as `level:'error'`) — helper `errorsNow()` | boot / postamble |
| `__app.doc()`, `__app.undo()`, `__app.redo()`, `__app.update(fn, label)`, `__app.bus` | doc access, undo check |
| `__app.loadSample(id)`, `__app.save(): string`, `__app.load(docOrJsonString)` | isolation, JSON round trip |
| `__app.idle(): Promise<void>` — every `__app` mutator already flushes; `idle()` only yields a macrotask | after every store mutation |
| `__app.pattern.addPiece(partialPiece): string`, `deletePiece(id)`, `movePiece(id, dx_mm, dy_mm)`, `addSeam(sideA, sideB): string`, `removeSeam(id)`, `seamEase(seamId, sizeName?): {lenA_mm, lenB_mm, easePct, longer}`, `validate(): Issue[]`; `__app.mesh.remesh(pieceId?): PieceMesh[]`, `mesh.all(): PieceMesh[]`, `mesh.get(id)`, `mesh.stats()` | mesh, editor, grading checks |
| `__app.body.setPreset(id): BodyModelSummary` (synchronous full build), `setParam(key, value): BodyModelSummary`, `params()`, `model(): BodyModelSummary`, `modelLive(): BodyModel` (live arrays for NaN scans), `measured(): {chest_cm, waist_cm, hips_cm}`, `sdf(x, y, z): {d:number, n:Vec3}`, `presets(): string[]` | body checks |
| `__app.sim.pause()`, `play()`, `reset()`, `drape()`, `step(n): SimStats` (n frames synchronously, rendering suppressed), `stats(): SimStats`, `state(): ClothState` (live references), `setSetting('selfCollision', bool)`, `running(): boolean`, `centerOfMass(): Vec3` | drape checks |
| `__app.fabric.setPreset(fabricInstanceId, presetId)`, `setColor(fabricInstanceId, hex)`, `resolved(fabricInstanceId)` | fabric checks |
| `__app.viewer.materialOf(pieceId)` (the live three.js material rendering that piece) | colour check |
| `__app.sizes.setActive(name)`, `grade(sizeName): Piece[]` (graded copies; `.find(p => p.id === pieceId).vertices` = the graded outline) | grading |
| `__app.export.sheetSvg(size): string`, `printHtml(size, paper): string`, `pageCount(size, paper)`, `csv(): string`, `cutLine(pieceId, sizeName): Vec2[]` (cut line, mm, pattern space, CCW) | export checks |
| `__app.ui.click(id)` (dispatches a `click` MouseEvent on `#id`; throws `E_NO_ELEMENT` if missing), `ui.state().layout`, `ui.elements()` | UI checks |
| `__app.selftest.run(): Promise<SelfTestResult[]>` (names prefixed `module/`; the suite groups them by prefix into the 8 keys geometry, pattern, body, cloth, viewer3d, sizing, export, ui; each module's `selftest.js` exports `runSelfTest(): Promise<SelfTestResult[]>`) | self-tests |
| `src/cloth/fixtures.js`: `makeHangingSheet({fabric: FabricResolved, width_m, height_m, spacing_mm, pinTopCorners: true, selfCollision: boolean}): ClothState` — a flat sheet in the xy plane, top edge at y = 0, hanging in −y, top-left and top-right corners pinned; `src/cloth/index.js`: `step(state)` (one frame = 10 substeps), `resolveFabric` from `src/core/fabrics.js` | fabric-ordering check |

Element ids used by the UI checks live in one constant at the top of the file and are the section 11 names: `IDS = { layoutSplit:'btn-layout-split', layout2d:'btn-layout-2d', layout3d:'btn-layout-3d', swap:'btn-swap', tabPieces:'tab-pieces', tabBody:'tab-body', tabFabric:'tab-fabric', tabSizes:'tab-sizes', play:'btn-play', pause:'btn-pause', pane2d:'pane-2d', pane3d:'pane-3d' }`. `REQUIRED_IDS` is the literal list of every id in section 11, copied verbatim (it must equal `__app.ui.elements()`, i.e. `src/ui/ids.js`).

### 13.3 The checks

All numbers below are the assertion thresholds; `s` denotes the `SimStats` returned by `__app.sim.step(n)`; the document is the T-shirt sample on body preset `female_m` unless stated. Runtime is the budget per check on the test machine.

| # | name | budget | what passes |
|---|---|---|---|
| 1 | `boot` | 0.01 s | `(await __app.ready).ms < 8000` and `.ok === true`; `errorsNow().length === 0` at suite start; `__app.version` is a non-empty string; `document.querySelector('#pane-3d canvas')` and `#pane-2d canvas` exist. |
| 2 | `ids` | 0.01 s | every id in `REQUIRED_IDS` resolves via `getElementById` and `document.querySelectorAll('#'+id).length === 1`. Details list the missing/duplicate ids. |
| 3 | `selftests` | ≤ 30 s | `await __app.selftest.run()` grouped by the `module/` prefix; every module key present (8 keys), every `SelfTestResult.pass === true`; details: `geometry 12/12, pattern 9/9, …` and the names of failures. |
| 4 | `tshirt_mesh` | 1 s | `reloadSample('tshirt')`; `m = __app.mesh.all()`: `m.length === 4` (front, back, sleeve_l, sleeve_r — pieces with `simulate === true`); `2500 ≤ ΣvertexCount ≤ 6000`; for every mesh `quality.pctAbove20 ≥ 98`, `quality.minAngleDeg > 10`, `12 ≤ quality.medianEdge_mm ≤ 18` (meshSpacing 15), `warnings.length === 0`, no NaN in `positions2d`, every triangle CCW in 2D (signed area > 0), every boundary edge (consecutive `boundary` ids) occurs in exactly one triangle. |
| 5 | `tshirt_seams` | 0.1 s | for every `Seam` in the doc: `edgeVerts[+a.mirror][a.edge].length === edgeVerts[+b.mirror][b.edge].length ≥ 3`; `__app.pattern.seamEase(id).easePct ≤ 8` (`easePct = 100·|lenA−lenB|/min(lenA,lenB)`); `__app.pattern.validate()` has no `level:'error'` issue; `state.sIdx.length/2 === Σ(N+1)` over seams minus the pairs skipped because both ids coincide (shared fold vertices, 7.1 step 5) (`N+1` = per-side vertex count). The doc has exactly **10** `Seam` records (8 garment seams, section 4.1 rule 14). |
| 6 | `body_female_m` | 1 s | `__app.body.setPreset('female_m'); model = __app.body.modelLive()`; `measured.chest_cm` within **1.5 cm** of 88, `measured.waist_cm` within 1.5 of 70, `measured.hips_cm` within 2.0 of 96; `model.buildMs < 1500`; no NaN in `model.sdf.data` and `model.geometry.positions`; SDF signs: `sdf(chestCenter).d < −0.05`, `sdf(waistCenter).d < −0.04`, `sdf(1,1,1).d > 0.3`, `p = chestCenter + (0, 0, rings.chest.b + 0.05)` → `0.03 < d < 0.07` and `n·(0,0,1) > 0.7`, `q = headTop + (0, 0.05, 0)` → `0.03 < d < 0.07`; `landmarks.headTop[1]` within 0.02 of 1.65; `landmarks.shoulderL[0] > 0` (+x is the model's left). |
| 7 | `body_presets` | 5 s | for each id of `__app.body.presets()` (9 presets, section 6.1): `setPreset(id); m = __app.body.modelLive()`; `buildMs < 1500`; no NaN; `|measured.chest_cm − params.chest_cm| ≤ 2.5`; `landmarks.headTop[1]` within 0.03 of `params.height_cm/100`; every anchor has unit `axis`/`front` (|len−1| < 1e-3) and `radius > 0`. Ends with `reloadSample('tshirt')`. |
| 8 | `drape_tshirt` | 4 s | `reloadSample('tshirt'); __app.sim.reset(); s = __app.sim.step(300)` (5 s of sim; sew time 1 s): `s.nanCount === 0`; `s.maxPenetration_mm < 5`; `s.seamGapMax_mm < 8`; `s.seamGapMean_mm < 3`; `s.maxSpeed < 2`; `s.verts === ΣvertexCount` of the 4 meshes; mean y of all cloth vertices `> landmarks.hipCenter[1]` (shirt did not slide off); every vertex within 0.8 m of `landmarks.chestCenter`. |
| 9 | `drape_rest` | 4 s | continues from 8: `__app.sim.step(240)`; `c0 = centreOfMass(); s = step(60); c1 = centreOfMass()`: `|c1−c0| < 0.03 m` (≤ 0.5 mm/frame); `s.maxSpeed < 0.5`; `s.maxPenetration_mm < 5`; `s.seamGapMax_mm < 8`. |
| 10 | `strain_cotton` | 0.1 s | on the state of 9: over all edges `e` whose `pieceOf` piece uses a fabric resolving to preset `cotton`: `strain = |pos_i − pos_j| / eRest[e] − 1`; `max(strain) < 0.04`, `max(−strain) < 0.06`; details report the 99th percentile. |
| 11 | `perf` | 0.1 s | on the state of 9: `s = __app.sim.stats()`: `s.msAvg < 16` (average solver ms over the last 60 frames) and `s.substeps === 10`. **Skipped (pass, details `'skipped: software renderer'`) when `gpuRenderer()` contains `SwiftShader` or `llvmpipe`.** |
| 12 | `fabric_ordering` | 5 s | hanging-sheet fixture (13.4): `sag(chiffon) > sag(silk) > sag(cotton) > sag(denim)` and `sag(chiffon) − sag(denim) ≥ 10 mm`, all four runs `nanCount === 0`. |
| 13 | `fabric_switch` | 10 s | `reloadSample('tshirt'); fab = doc.pieces[0].fabricId`; for `preset` of `['silk','leather','jersey']`: `__app.fabric.setPreset(fab, preset); await __app.idle(); __app.sim.reset(); s = step(300)`: `nanCount === 0`, `maxPenetration_mm < 8`, `seamGapMax_mm < 8`; for silk additionally `resolveFabric(doc.fabrics[fab]).physics.bend_Nm === FABRIC_PRESETS.silk.physics.bend_Nm` (compliance rewritten from the preset). |
| 14 | `color_change` | 0.5 s | `reloadSample('tshirt'); __app.fabric.setColor(fab, '#ff0000'); await __app.idle()`; `__app.viewer.materialOf('front').color.getHexString() === 'ff0000'`; `doc.fabrics.find(f => f.id === fab).color === '#ff0000'`; `__app.undo(); await idle()` → hex string equals the original colour. |
| 15 | `body_change_live` | 2 s | `reloadSample('tshirt'); step(120)` (settled during sewing); `t0 = performance.now(); m = __app.body.setParam('chest_cm', 100); dt = performance.now() − t0`: `dt < 500`; `|m.measured.chest_cm − 100| ≤ 2`; `s = step(120)`: `nanCount === 0`, `maxPenetration_mm ≤ 8`, `seamGapMax_mm < 8`. |
| 16 | `selfcollision_toggle` | 3 s | `reloadSample('tshirt'); __app.sim.setSetting('selfCollision', false); s1 = step(120)`: `nanCount 0`, `s1.sectionMs.self === 0`; `setSetting('selfCollision', true); s2 = step(120)`: `nanCount 0`, `s2.sectionMs.self > 0`, `maxPenetration_mm < 8`. |
| 17 | `skirt_drape` | 4 s | `reloadSample('skirt'); __app.sim.reset(); s = step(300)`: `nanCount 0`, `maxPenetration_mm < 5`, `seamGapMax_mm < 8`, `seamGapMean_mm < 3`; `state.pIdx.length > 0` (waist edge pinned); mean y of `pTarget` within 0.04 m of `landmarks.waistCenter[1]`; mean y of all vertices `> landmarks.kneeL[1]` (skirt hangs, did not fall). |
| 18 | `grading` | 0.5 s | `reloadSample('tshirt')`; `outline = (id, sz) => __app.sizes.grade(sz).find(p => p.id === id).vertices`; `M = outline('front','M')`, `L = outline('front','L')`, `S = outline('front','S')`: `M` deep-equals `doc.pieces.front.vertices` (base size unchanged); `bboxOf(L).w / bboxOf(M).w` within ±0.5 % of `92/88 = 1.04545`; `bboxOf(S).w / bboxOf(M).w` within ±0.5 % of `84/88`; both vertices of the front's `foldEdge` keep their x exactly (`|dx| < 1e-6` mm) in S, L, XL (scaling about the fold); `bboxOf(L).h / bboxOf(M).h` within ±0.5 % of `41/40` (lengthRef torsoLength_cm); for every seam `seamEase(id,'XL').easePct − seamEase(id,'M').easePct` within ±3. |
| 19 | `export_svg` | 1 s | `svg = __app.export.sheetSvg('M')`: `parseSvg` succeeds; `svgSizeMm` gives `w,h` and root `viewBox === '0 0 ${w} ${h}'`; `svg.includes('PLACE ON FOLD')`; one `g.piece[data-piece-id]` per piece with `exportHidden === false` (3 for the T-shirt: front, back, sleeve_l — `sleeve_r` is `exportHidden`, printed once with `CUT 2`; accept `≥ 3`); the front group contains ≥ 1 `<path>` and the text `CUT 1 ON FOLD`; `xl = svgSizeMm(parseSvg(sheetSvg('XL')))`, `s = svgSizeMm(parseSvg(sheetSvg('S')))`: `xl.w > s.w && xl.h > s.h`. |
| 20 | `export_offset` | 0.5 s | `cut = __app.export.cutLine('front','M')`: `isSimplePolygon(cut)`, `signedArea(cut) > signedArea(doc.pieces.front.vertices)`, `min x of cut ≥ −0.05` mm (no allowance on the fold edge; the half piece is stored with x ≥ 0 and the fold on x = 0), `cut.length ≥ 20`. Same for `'sleeve_l'` (no fold): simple, area larger, and the stitch vertices all inside the cut polygon (`pointInPolygon` re-implemented in the suite, 8 lines). |
| 21 | `export_print` | 1 s | `html = __app.export.printHtml('M', 'A4')`; `d = new DOMParser().parseFromString(html,'text/html')`; `pages = d.querySelectorAll('.page').length`; with `{w,h}` of the M sheet: `cols = max(1, ceil((w − 10)/180))`, `rows = max(1, ceil((h − 10)/267))` (A4 window 190×277 mm = 210×297 minus 10 mm margins, 10 mm overlap ⇒ step 180×267); `pages === cols·rows`; every `.page` contains one `<svg>` with a `viewBox`; `html.includes('100 mm')` (calibration square label) and every page's svg contains `rect.calibration` (10.4). Repeat for `paper:'Letter'` (window 195.9×259.4 mm = 215.9×279.4 − 20; step 185.9×249.4) and `'A3'` (window 277×400; step 267×390): page counts match. |
| 22 | `export_csv` | 0.1 s | `csv = __app.export.csv()`: `lines = csv.trimEnd().split(/\r?\n/)`; `lines.length === 5`; `lines[0] === 'size,chest_cm,waist_cm,hips_cm,height_cm,torsoLength_cm,armLength_cm'`; row `M` equals `M,88,70,96,165,40,56`; row `XL` equals `XL,96,78,104,175,42,58`; no line contains `"`. |
| 23 | `json_roundtrip` | 0.2 s | `s1 = __app.save()`; `s2 = serializeDoc(normalizeDoc(JSON.parse(s1)))`; `s1 === s2` (byte-identical); `__app.load(s1); await idle(); __app.save() === s1`; `JSON.parse(s1).version === 1`; keys of the parsed root are sorted (`Object.keys(o).join() === Object.keys(o).sort().join()`). |
| 24 | `undo_redo` | 0.5 s | `reloadSample('tshirt'); v0 = structuredClone(doc.pieces.sleeve_l.vertices)`; `__app.pattern.movePiece('sleeve_l', 50, −20); await idle()`: every vertex moved by exactly (50, −20); `__app.undo(); await idle()`: vertices deep-equal `v0`; `__app.redo(); await idle()`: moved again; after undo+redo `__app.mesh.all().length === 4` (remesh re-ran) and `step(60).nanCount === 0`. |
| 25 | `editor_api` | 1 s | `reloadSample('tshirt')`; `a = addPiece({name:'Sq A', vertices:[[0,0],[200,0],[200,200],[0,200]]})`, `b = addPiece({name:'Sq B', vertices:[[300,0],[500,0],[500,200],[300,200]]})` (defaults from `normalizeDoc`: line edges, first fabric, `simulate:true`, placement torso/front); `sid = addSeam({pieceId:a, edge:1, mirror:false, reverse:false}, {pieceId:b, edge:3, mirror:false, reverse:true})`; `await idle(); mesh = remesh(a)[0]`: `120 ≤ vertexCount ≤ 320`, `edgeVerts[0][1].length === 15` (`ceil(200/15) + 1`), equals the partner's `edgeVerts[0][3].length`; `validate()` has no error for a, b, sid; `removeSeam(sid); deletePiece(a); deletePiece(b); await idle()`: doc back to 4 pieces / 10 seam records. |
| 26 | `ui_clicks` | 0.5 s | `reloadSample('tshirt')`; `__app.ui.click(IDS.layout2d)` → `doc.ui.layout === '2d'`, `__app.ui.state().layout === '2d'`, `#pane-3d` has `hidden === true`; `click(IDS.layout3d)` → `'3d'`; `click(IDS.layoutSplit)` → `'split'`, both panes visible; `click(IDS.swap)` → `doc.ui.swapped` flipped and the DOM order of `#pane-2d`/`#pane-3d` inside their parent reversed; click again → restored; `click(IDS.tabBody)` → `doc.ui.dockTab === 'body'` and `#tab-body` has `aria-selected="true"`; `click(IDS.tabPieces)` → `'pieces'`; `click(IDS.play)` → `__app.sim.running() === true`; `click(IDS.pause)` → `false`. |
| 27 | `runtime` | — | synthetic, appended by the runner: total `ms < 90000`; details `'total 47.3 s'`. |

Excluded from the automated suite (manual, 13.6): pop-out window, print-to-PDF at 100 %, visual drape quality, drag interactions on the canvases.

### 13.4 Hanging-sheet fixture (check 12)

```js
import { makeHangingSheet } from '../src/cloth/fixtures.js';
import { step } from '../src/cloth/index.js';
import { resolveFabric } from '../src/core/fabrics.js';

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
| `src/core/store.js` | section 3.3: `createStore(doc, bus)`, `get/update/batch/undo/redo/replace/subscribe`, 100-deep structuredClone history, `diffHints`, `transient`. |
| `src/core/schema.js` | `normalizeDoc` (all defaults of sections 3.1/4.4), `serializeDoc` (sorted keys, 2-space indent, `\n` line ends, trailing newline), `validateShape(doc): Issue[]`. |
| `src/core/units.js`, `src/core/ids.js`, `src/core/fabrics.js` (section 9.1 table), `src/core/sdf.js` (`sampleSdf`, `makeSphereGrid`, `gridIndex`, `gridContains`) | as named in section 2. |
| `src/samples/tshirt.js`, `src/samples/skirt.js`, `src/samples/index.js` | section 4.4. Each sample is `export const TSHIRT = /*SAMPLE-JSON-BEGIN*/ { … } /*SAMPLE-JSON-END*/;` where the literal between the markers is **strict JSON** (double-quoted keys, no trailing commas, no comments, no expressions) so Python can load it. |
| `index.html` | import map (three 0.180.0 from cdn.jsdelivr.net, `three/addons/`), the complete element-id skeleton of section 11, `<link rel=stylesheet href=styles/shell.css>` + `styles/app.css`, `<script type=module src=src/app/main.js>`, a `<noscript>`/error banner `#boot-error` that `main.js` fills when a module import fails. |
| `styles/shell.css` | grid geometry only: toolbar 44 px / main / statusbar 24 px; main = `[pane-left] [divider 6 px] [pane-right] [dock 300 px]`; `--split` variable; `[hidden]{display:none!important}`. |
| `popout.html` | skeleton only (title "Clothing App — 3D", import map, `<script type=module src=src/popout/main.js>`); A5 fills `src/popout/main.js`. |
| **Throwing stubs**: `src/geometry/index.js`, `src/pattern/index.js`, `src/body/index.js`, `src/cloth/index.js` (+ `fixtures.js`), `src/viewer3d/index.js`, `src/sizing/index.js`, `src/export/index.js`, `src/ui/index.js`, `src/popout/main.js` | each exports **every public name of its section with the final signature**, body `throw new Error('NotImplemented: geometry.remeshPiece')` with `err.code = 'NotImplemented'` (constants export placeholders of the right shape); plus `src/<module>/selftest.js` exporting `async runSelfTest()` that resolves `[{name:'stub', pass:false, details:'module not implemented'}]`. These are the only files the lead writes inside agent directories; agents replace them wholesale. `docs/CONTRACTS.md` lists every stubbed name. |
| `src/app/main.js`, `src/app/debugApi.js`, `src/app/wiring.js` (Phase-0 versions) | boot: import every `src/core/*.js`, `src/samples/index.js` and every module `index.js` (so the import graph is exercised), `createStore(getSample('tshirt'), bus)`, and set `window.__app = { version:'phase0', ready: Promise.resolve(true), stubs:true, doc: () => store.get(), store, bus, modules:{geometry, pattern, body, cloth, viewer3d, sizing, exportMod, ui} }` inside a try/catch that writes any error to `#status-msg` and `console.error`; `wiring.js`/`debugApi.js` are throwing stubs of the section-12 names. A8 replaces these. |
| `tests/acceptance.js` (Phase-0 version) | a stub: `export async function runAcceptance(filter)` resolving `{pass:false, results:[{name:'stub', pass:false, details:'not implemented'}]}` and an empty `CHECKS`. A8 writes the runner of 13.1 and every check. |
| `tools/vendor.py`, `tools/check_samples.py` | see 14.5 row 7 and the verification below. |

**Phase-0 verification (must pass before fan-out):**

1. `python tools/check_samples.py` — parses the JSON between the markers of both samples and asserts, in Python (no browser): ids unique; every piece `signedArea > 0`, `edges.length === vertices.length`, cubic edges have `c1,c2`; outline simple (segments of the outline sampled at 32 points per cubic edge, O(n²) proper-intersection test); `foldEdge` is a `line` edge and all vertices lie on the non-negative side of its line (fold pieces stored as a half, |x| ≥ −0.01 mm off the fold); `notches[].t ∈ (0,1)`; `fabricId` exists in `fabrics`; `seams[].a/b.edge !== foldEdge`, `mirror` only on fold pieces; every `SeamSide` references an existing piece/edge; **for every seam the two side lengths (cubics integrated with 200 segments) agree within 3 %** (`|lenA − lenB| / min ≤ 0.03`); the T-shirt has exactly 10 `Seam` records = 8 garment seams (2 shoulder, 2 side, 2 sleeve underarm, 2 sleeve cap each split into a front and a back record; section 4.1 rule 14) and the skirt 2 side seams; size chart rows S/M/L/XL with the six keys and M equal to `female_m`; estimated vertex count `Σ(area/(h²√3/2) + perimeter/h)` over simulated pieces is within [2500, 6000] for the T-shirt (expected ≈ 3800 at h = 15) and [1500, 5000] for the skirt. Prints a table of piece areas, edge lengths and seam ease %.
2. Browser: `run.bat`, open `http://localhost:8710/` — no uncaught error in the console, `window.__app.stubs === true`, `__app.doc().name === 'Basic T-shirt'`, `validateShape(__app.doc())` returns `[]` for both samples (`__app.store.replace(getSample('skirt'), 'skirt')` from the console), and every `__app.modules.<m>.<fn>()` throws `code === 'NotImplemented'`.
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
| **A7 UI shell** | `src/ui/`, `styles/app.css` | layout (split, divider drag, swap, 2d/3d/split), toolbar, dock tabs, status bar, keyboard shortcuts (no Tab), panels (pieces, body, fabric, sizes) bound to the store (section 11) | `core/*` and every module's public `index.js` (through stubs until they land) | `index.html` (ids are frozen), `styles/shell.css`, module internals | the store loaded with the T-shirt sample and the stubs: panels must render and write back to the store even when every module throws `ENOTIMPL` (they show the warning, nothing else) | every section-11 id exists once; clicking `#btn-layout-2d/3d/split` and `#btn-swap` updates `doc.ui` and DOM order/visibility; dock tabs set `doc.ui.dockTab` and `aria-selected`; body sliders write `body.params` (input event → store update, `preset` becomes `custom`); fabric colour input writes `fabrics[].color`; sizes table cell edit writes `sizes.rows`; shortcuts: `Space` toggles play, `Ctrl+Z/Y` undo/redo, `Esc` cancels the tool, `F1–F4` dock tabs, `1/2/3` layouts; status bar shows tool hint / cursor mm / sim stats fields; no shortcut uses `Tab`. |
| **A8 Integration + QA** | `src/app/`, `tests/acceptance.js` | `main.js` boot order, `wiring.js` (the only event → module-call file), `debugApi.js` (`window.__app`, section 12, including `log`, `idle`, `ui.click`, `selftest.run`, `acceptance.run`), `?acceptance=1`, the full acceptance suite (section 13) | everything | module internals; A8 never fixes a module — files a bug to its owner (14.4) | Phase-0 stubs first (wiring must survive every module throwing), then real modules as they land | `__app` exposes every member of the section-12 table; `wiring.js` reacts to each section-3.2 event exactly as specified and to nothing else; checks 1, 2, 22, 23 pass on the stubs; the complete suite passes on the integrated app. |

Blocking relationships and how they are broken: A2, A6 and A4 consume A1's geometry names but start against the stub signatures (A2 draws straight-edge pieces first; A6 exports the samples' vertex polygons with a straight-edge offset first; A4 uses `fixtures.js` meshes). A4 never waits for A3 (`testfields.js`). A5 never waits for A4/A3 (fake state). A7 never waits for anyone (stubs throw, panels still bind). A8 integrates modules in the order they turn green.

### 14.3 Phase 2 — integration (A8 + lead, ≈ 2 h)

Modules are enabled in `src/app/main.js` one at a time, in this order, each step verified in the browser console before the next; a step that fails is reverted (the stub is restored by `git`-less copy from `docs/stubs/` — the lead keeps a copy of every Phase-0 stub there) and the owner is notified.

| Step | Enable | Verify (console) |
|---|---|---|
| 1 | core + samples (Phase 0) | `await __app.ready`; `__app.log().filter(l => l.level === 'error').length === 0`. |
| 2 | `geometry` | `__app.pattern.remesh()` → 4 `PieceMesh`, `pctAbove20 ≥ 98`, seam parity; `console.table(meshes.map(m => m.quality))`. |
| 3 | `sizing`, `export` | `parseSvg(__app.export.sheetSvg('M'))`, `__app.export.csv().split('\n').length === 5`, `printHtml` page count. |
| 4 | `body` + `viewer3d` (body only) | `m = __app.body.setPreset('female_m')`; `m.measured`; the body renders in `#pane-3d`; `sdf` sign checks of 13.3 #6. |
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
__app.body.setParam('chest_cm', 100)                          // BodyModelSummary, measured.chest_cm ≈ 100
__app.sim.step(120).maxPenetration_mm                         // ≤ 8
__app.fabric.setPreset('main', 'silk'); await __app.idle(); __app.sim.step(300).nanCount   // 0
__app.fabric.setColor('main', '#ff0000'); await __app.idle(); __app.viewer.materialOf('front').color.getHexString()   // 'ff0000'
__app.ui.click('btn-layout-2d'); __app.ui.state().layout      // '2d'
__app.ui.click('btn-layout-split')
__app.export.sheetSvg('L').slice(0, 120)                      // '<svg xmlns=… width="…mm" height="…mm" viewBox="0 0 … …">'
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
| 11 | Undo memory: 100 snapshots of a document with many pieces exhaust memory or make `update` slow | core store (lead), A2 | snapshots are the previous document objects themselves (never mutated, 3.3.3; ≈ 25 kB of JSON each → ≤ 2.5 MB), history capped at `HISTORY_LIMIT = 100` with FIFO eviction, drag interactions coalesce into one entry per pointer-up (`store.batch` steps during the drag, one undoable `commit()` on release), no entry for ui-only changes (lead, A2, A7) | check 24; store self-check 3.3.8 #5 |
| 12 | Fabric table dynamically flat: every fabric drapes like cardboard or like tissue | A4, lead (9.1) | bending in the linear form `C = |L|·sqrt(3/(A0+A1))` with `alpha = 1/B`, B in N·m from Kawabata ranges; membrane `alpha_edge = L/Y`; `bendScale`/`stretchScale` global multipliers exposed in the Fabric panel (A4) | check 12 (`fabric_ordering`), check 10 (`strain_cotton`) |
| 13 | Contract drift between agents (renamed fields, different units) | all | `src/core/` frozen, stubs carry final signatures, `_cm`/`_mm` suffixes everywhere, conversions only in `units.js`, A8 integrates against the stubs from hour 2, consumer-adapts rule 14.4 (lead) | checks 3 (self-tests), 23 (`json_roundtrip`) |
| 14 | Print scale wrong (printer "fit to page") | A6 | `@page { margin:0 }`, explicit `width="…mm"`, 100 mm calibration square and "Scale 100 %, no fit-to-page" header on every tile (A6) | check 21, manual 13.6 #2 |
| 15 | Body change with cloth present: vertices trapped inside the new body | A4 | on `body:built` the solver pushes vertices out with at most `min(pen, 5 mm)` per frame (gentle re-projection), CCD-lite sign-flip check against the new grid (A4) | check 15 (`maxPenetration_mm ≤ 8` after 120 frames) |

**PROPOSED types.js amendment** (reviewer decides; none of the checks above depend on it): none. The suite only reads fields that already exist on `ClothState`, `SimStats`, `BodyModel`, `PieceMesh`, `ProjectDoc` and `SelfTestResult`. The additional runtime members it needs (`__app.log`, `__app.idle`, `__app.viewer.materialOf`, `__app.selftest.run`, `makeHangingSheet` in `src/cloth/fixtures.js`) are section-12 / section-7 API surface, not typedefs.
