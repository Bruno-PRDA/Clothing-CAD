# Cloth Studio — Architecture & Design (v1)

Desktop-style web app for garment design: 2D pattern editor (mm) + 3D XPBD drape on a parametric body (m). Vanilla ES2022 modules, JSDoc types, three.js 0.180 via import map, no build step, served by `python -m http.server`. Pattern-making correctness is a first-class requirement: every piece carries real units, grainline, notches, seam allowance, and grades to a size chart before it drapes.

---

## 1. Module breakdown and dependency graph

```
index.html                    import map, <div id="app">, loads src/main.js
src/main.js                   composition root: creates store, bus, panels, views, window.__app
src/core/        (CONTRACT)   types.js  events.js  store.js  units.js  geom.js  ids.js
src/pattern/     (agent P)    model.js (piece ops)  sampler.js (bezier→polyline)  seams.js
                              grading.js  offset.js (polygon offset)  samples/{tshirt,skirt}.js
src/editor2d/    (agent E)    editor.js (canvas, viewport)  tools/*.js  render2d.js  snap.js
src/mesh/        (agent M)    boundary.js  delaunay.js (Bowyer-Watson + edge recovery)
                              mesher.js (piece→ClothMesh)  seampairs.js
src/body/        (agent B)    params.js  presets.js  loft.js (render mesh)  sdf.js  measure.js
src/physics/     (agent S)    solver.js (XPBD)  constraints.js  collision.js  arrange.js  fabrics.js
src/view3d/      (agent V)    scene.js  clothRenderer.js  bodyRenderer.js  materials.js  popout.js
src/export/      (agent X)    svg.js  tiles.js (print CSS/PDF)  csv.js  sizechart.js
src/ui/          (agent U)    layout.js  panels/{body,fabric,sizes,pieces}.js  toolbar.js
                              statusbar.js  shortcuts.js  styles.css
src/app/         (agent U or lead)  debugApi.js (window.__app)  session.js (save/load, undo)
```

Dependency graph (arrows = imports):

```
core ← pattern ← mesh ← physics ← view3d
core ← body   ← physics
core ← pattern ← editor2d
core ← pattern ← export        (export also reads body/measure for size chart)
core ← ui  (ui imports every module's public API; nothing imports ui)
main.js imports everything; app/debugApi.js imports main's registry
```

Rules: no module imports `ui/` or `editor2d/`; `physics/` never touches DOM; `body/` and `pattern/` are pure data + math (unit-testable in Node-less browser console). Cross-module communication is through `store` (state) and `bus` (events), never direct DOM queries.

**Shared contracts written first (lead agent, ~1 h, frozen before fan-out):**

- `src/core/types.js` — all JSDoc `@typedef`s below (Project, Piece, Segment, Seam, Notch, Grainline, Placement, BodyParams, Fabric, SizeChart, ClothMesh, SeamPairing, ConstraintSet, SdfPrimitive).
- `src/core/events.js` — `bus.on(name, fn)`, `bus.emit(name, payload)`; event names enumerated: `project:loaded`, `piece:changed`, `seam:changed`, `body:changed`, `fabric:changed`, `sim:step`, `sim:reset`, `sim:nan`, `size:changed`, `layout:changed`.
- `src/core/store.js` — single mutable `project` object + `store.get()`, `store.update(fn)` (runs `fn(project)`, bumps `revision`, emits `project:changed` with a `changed` tag list), `store.undo()/redo()` via JSON snapshots (max 50).
- `src/core/units.js` — `MM_PER_M = 1000`, `mmToM`, `mToMm`, `cmToMm`, paper sizes in mm.
- `src/core/geom.js` — `Vec2` helpers, `cubicBezierPoint`, `polylineLength`, `pointInPolygon`, `segmentIntersect`, `polygonArea` (sign = winding).
- `src/pattern/samples/tshirt.js` and `skirt.js` — canonical sample projects; every other agent tests against them.

---

## 2. Data model (project JSON, `schemaVersion: 1`)

All 2D coordinates are **mm**, Y up (pattern convention: grainline vertical). 3D is metres, Y up.

```json
{
  "schemaVersion": 1, "name": "Basic Tee", "baseSize": "M",
  "units": { "pattern": "mm", "world": "m" },
  "body": { "preset": "female_average",
    "params": { "height": 1.68, "chest": 0.90, "underbust": 0.76, "waist": 0.72, "hip": 0.96,
      "shoulderWidth": 0.39, "neckCirc": 0.36, "backLength": 0.40, "armLength": 0.58,
      "upperArmCirc": 0.28, "wristCirc": 0.16, "thighCirc": 0.56, "inseam": 0.78,
      "torsoLength": 0.62, "headCirc": 0.55, "armAbductionDeg": 25 } },
  "sizeChart": {
    "measurements": ["chest","waist","hip","height","backLength","armLength"],
    "sizes": [
      { "name": "S",  "chest": 860, "waist": 680, "hip": 920,  "height": 1650, "backLength": 390, "armLength": 570 },
      { "name": "M",  "chest": 900, "waist": 720, "hip": 960,  "height": 1680, "backLength": 400, "armLength": 580 },
      { "name": "L",  "chest": 960, "waist": 780, "hip": 1020, "height": 1710, "backLength": 410, "armLength": 590 },
      { "name": "XL", "chest": 1020,"waist": 840, "hip": 1080, "height": 1740, "backLength": 420, "armLength": 600 } ] },
  "pieces": [ {
      "id": "p_front", "name": "Front", "cutQty": 1, "cutOnFold": true, "fabricId": "fab_main",
      "segments": [
        { "type": "line",  "p0": [0,0],    "p1": [240,0],  "allowance": 25, "label": "hem" },
        { "type": "line",  "p0": [240,0],  "p1": [250,380], "allowance": 10, "label": "side" },
        { "type": "cubic", "p0": [250,380],"c0": [250,460],"c1": [180,520],"p1": [120,540], "allowance": 10, "label": "armhole" },
        { "type": "line",  "p0": [120,540],"p1": [30,560],  "allowance": 10, "label": "shoulder" },
        { "type": "cubic", "p0": [30,560], "c0": [10,540], "c1": [0,500],  "p1": [0,480],  "allowance": 6,  "label": "neck" },
        { "type": "line",  "p0": [0,480],  "p1": [0,0],     "allowance": 0,  "label": "CF", "fold": true } ],
      "notches": [ { "edge": 2, "t": 0.5, "kind": "single" } ],
      "grainline": { "a": [120,80], "b": [120,460] },
      "internalLines": [ { "kind": "dart", "points": [[200,120],[230,60],[210,120]] } ],
      "grading": { "origin": [0,0], "widthDriver": "chest", "lengthDriver": "backLength",
                   "pointDeltas": {} },
      "placement": { "anchor": "torsoFront", "offset": [0, 0.02], "rotationDeg": 0,
                     "flip": false, "radiusOffset": 0.03 },
      "meshSpacingMm": 15
  } ],
  "seams": [
    { "id": "s_side_L", "a": { "piece": "p_front", "edge": 1, "reverse": false },
      "b": { "piece": "p_back", "edge": 1, "reverse": true }, "type": "plain", "stiffness": 1.0 } ],
  "fabrics": [ { "id": "fab_main", "preset": "cotton", "color": "#3b6ea5", "pattern": "none",
                 "overrides": {} } ],
  "sim": { "gravity": -9.81, "substeps": 8, "iterations": 1, "dt": 0.016667, "sewDurationS": 1.5,
           "selfCollision": false },
  "ui": { "split": 0.5, "popout": false }
}
```

Notes for correctness: `cutOnFold` + an edge with `fold:true` means the piece stored is a half; meshing mirrors it about that edge into a full piece; export prints the half with a "PLACE ON FOLD" label and a mirror-preview option. `allowance` is per edge (hem 25, neckline 6 for facing/binding, plain 10, fold 0). Size-chart values are mm. `pointDeltas` maps `"segIdx.pointKey"` → `{ "S": [dx,dy], "L": [dx,dy], ... }` for professional per-point grading (optional; see §6).

---

## 3. 2D pattern editor

**Outline representation.** A piece is a closed, counter-clockwise loop of segments; each is `line` or `cubic` (cubic Bezier). Consecutive segments share endpoints (invariant enforced by `pattern/model.js`; editing a shared point updates both). Bezier handles are the pattern-maker's French curve; lines everywhere else. No arcs, no quadratics. Sampling (`sampler.js`): adaptive subdivision until chord error ≤ 0.25 mm, then resample by arc length to the requested spacing; every derived polyline keeps `edgeIndex` and parameter `t` per vertex so notches and seam sub-ranges survive.

**Tools** (each in `editor2d/tools/*.js`, implements `{onDown, onMove, onUp, onKey, cursor}`; active tool stored in `store.ui.tool`):

- `select` (V): click/drag-box points and segments; drag moves; Shift adds. Arrow keys nudge 1 mm (Shift 10 mm).
- `draw` (D): click to add line points; click-drag to pull a Bezier handle; click first point or Enter to close. Snaps to 1 mm grid, to existing points, and to horizontal/vertical (Shift).
- `pen` (P): convert line↔cubic, drag handles, Alt breaks handle symmetry.
- `move/rotate` (M/R) whole piece; rotation typed in degrees.
- `mirror` (Shift+M): mirror piece about an edge (creates full piece) or toggle `cutOnFold` with fold edge selection.
- `notch` (N): click an edge → notch at that `t`; type `single|double`. Drag along edge.
- `seam` (S): click edge A, then edge B. Direction handling: the editor draws an arrow along each edge; the second click's arrow is auto-oriented so the two start points are nearest; the user can press `F` to flip `reverse`. The status bar shows lengths `A 312 mm / B 328 mm — ease 5.1%`. Ease > 8% shows a warning badge but is allowed (sleeve caps routinely have 3–6%). Sub-range seams (part of an edge) are v1.5; v1 requires seams to span full edges — split an edge with the `split` tool (X) first, which is how real pattern edges are structured anyway.
- `grainline` (G): drag two points; default vertical.
- `internal` (I): polyline for darts/fold lines/pocket placement (export only, not simulated in v1; a dart line is drawn as two lines to the apex).
- `measure` (Tab): distance between clicked points/edge length readout.

Rendering: single `<canvas>` with a view transform (pan: middle drag/space; zoom: wheel, 0.05–20 px/mm), mm grid (1/10/100 mm adaptive), rulers, piece fill by fabric colour at 20 % alpha, stitch line solid, cut line (offset by allowance) dashed grey, notches as 5 mm ticks, grainline with arrowheads, seam pairs colour-coded with matching hue on both edges. All canvas hit-testing in mm space with a 6 px tolerance.

**2D outline → simulation mesh** (`mesh/mesher.js`), target spacing `h` = `piece.meshSpacingMm` (15 mm default; 10 mm for silk/chiffon):

1. **Boundary sampling with seam parity** (`seampairs.js`). For every seam, `N = max(2, round(max(lenA, lenB)/h))` samples on both edges (arc-length uniform on each). Non-seam edges use `round(len/h)`. Result: each edge has an ordered vertex list; adjacent edges share the corner vertex. Seam edge vertex counts are identical by construction, so pairing is index `i ↔ (reverse ? N-1-i : i)`. Length mismatch is absorbed as ease: the seam constraint pulls vertex-to-vertex; the longer side compresses slightly (which is exactly what steaming a sleeve cap does).
2. **Interior points**: triangular lattice with spacing `h` (rows `h·√3/2`), jittered by ±0.15h with a deterministic PRNG (seeded by piece id) to avoid degenerate Delaunay; keep points that are inside the polygon (even-odd) and ≥ 0.6h from every boundary vertex/segment.
3. **Delaunay** (`delaunay.js`): Bowyer-Watson with a super-triangle, O(n²) naive point location is fine for ≤ 3000 points/piece; use `float64` and the robust-enough incircle determinant with the points pre-normalised to [0,1].
4. **Boundary edge recovery** (Sloan 1993): for each boundary edge (a,b) not present, walk the triangles crossed by segment ab, collect their intersecting diagonals, and flip each (repeat flips until ab appears; guaranteed to terminate for non-degenerate input). With ≥0.6h clearance this fires rarely, but it must exist so concave armholes/necklines are never chorded.
5. **Outside removal**: drop triangles whose centroid is outside the polygon; drop super-triangle triangles.
6. Output `ClothMesh { positions2d: Float32Array(n×2) mm, triangles: Uint32Array, boundaryLoop: Uint32Array, edgeVertexLists: Uint32Array[][], bendPairs: Uint32Array (opposite vertices across each interior edge), area_mm2 }`. Fold pieces are mirrored before step 2 and the fold edge becomes interior (no seam needed).

Quality gate: min angle > 20° for > 98 % of triangles on the samples; otherwise increase jitter and retry once (max 3 attempts, different seeds).

---

## 4. Parametric body

**Parameters** (`body/params.js`, SI): `height, chest, underbust, waist, hip, shoulderWidth, neckCirc, backLength, torsoLength, armLength, upperArmCirc, wristCirc, thighCirc, kneeCirc, calfCirc, ankleCirc, inseam, headCirc, armAbductionDeg (default 25), legSpreadDeg (8), sex ('m'|'f'|'n')`. All are stored explicitly; presets are just full param sets. Landmark heights are derived proportionally from `height` and `inseam` (e.g. crotch at `inseam`, waist at `inseam + 0.16·height`, chest at `inseam + 0.27·height`, shoulder at `inseam + 0.36·height`, chin at `height − headCirc·0.36`) and can be overridden by `backLength`/`torsoLength`.

**Presets** (`presets.js`): `male_average` (1.75 m, chest 0.98, waist 0.86, hip 0.98), `female_average` (1.68, 0.90/0.72/0.96), `child_10y` (1.38, 0.68/0.62/0.72), `tall_slim`, `plus_size`, `athletic`. A preset click sets all params; individual sliders then override; the panel shows the derived size chart row that best matches ("closest size: M").

**Procedural mesh** (`loft.js`) with no assets, built as a union of lofted primitives:

- **Torso loft**: 12 horizontal sections from crotch to neck base; each section is an ellipse with centre offset `(cx, cz)` (slight forward belly/back curve), radii `(rx, rz)`, and squareness exponent for a superellipse (2.0 hip, 2.4 chest for flatter back). Sections at landmark heights get radii **solved from circumferences**: aspect `k = rz/rx` fixed per level (chest 0.70, underbust 0.72, waist 0.78, hip 0.76), Ramanujan perimeter `P = π[3(a+b) − √((3a+b)(a+3b))]` with `b = k·a` is linear in `a`, so `a = P / (π[3(1+k) − √((3+k)(1+3k))])` — exact, no iteration. Intermediate sections are Catmull-Rom interpolated. 32 segments around, closed at the neck with a neck capsule.
- **Limbs**: capsules (tubes with hemispherical caps) sampled 12 around: upper arm (radius from `upperArmCirc/2π`), forearm tapering to wrist, hand (flattened capsule), thigh, shin, foot. Arms rotated by `armAbductionDeg` about the shoulder in the coronal plane — **A-pose** — so sleeves drape; legs spread by `legSpreadDeg`.
- **Head**: ellipsoid (radius from `headCirc`), neck capsule. Shoulders: two ellipsoids blending the torso top into the arm capsules.

The render mesh is simply the concatenation of these primitives (overlaps are hidden inside the body; smooth normals per primitive, `MeshStandardMaterial` skin tone). Regenerated in < 20 ms on any param change.

**Collision representation** (`sdf.js`): the **same primitive list**, as analytical SDFs with union by min:

```
type SdfPrimitive =
 | { kind:'capsule',   a:[x,y,z], b:[x,y,z], r0:number, r1:number }   // tapered capsule
 | { kind:'ellipsoid', c:[x,y,z], r:[rx,ry,rz], q:quat }
 | { kind:'loft', ySamples:Float32Array, cx:Float32Array, cz:Float32Array, rx:Float32Array, rz:Float32Array, e:Float32Array }
```

- Capsule: `t = clamp(dot(p−a, b−a)/|b−a|², 0,1)`, `q = a + t(b−a)`, `d = |p−q| − lerp(r0,r1,t)`, normal `(p−q)/|p−q|`.
- Ellipsoid: scaled-space approximation `k0 = |p/r|, k1 = |p/r²|, d = k0(k0−1)/k1` (Iñigo Quílez), normal = normalised gradient by 3-tap finite difference (ε = 2 mm).
- Loft: find section band by `y` (binary search), lerp `cx,cz,rx,rz,e`, then 2D superellipse pseudo-distance `d = (( |x'/rx|^e + |z'/rz|^e )^(1/e) − 1) · min(rx,rz)`; above/below the loft clamp to the end caps by combining with the capsule/ellipsoid there. Normal from finite difference.
- `sdf.query(p, out)` returns signed distance and normal; `sdf.queryBatch(positions, out)` loops the typed array. A coarse per-primitive AABB test (expanded by 0.1 m) skips primitives early; typical cost ~6 primitives × 6000 particles × 8 substeps ≈ 0.3 M evaluations/frame — under 2 ms.

**Measurements** (`measure.js`): `measureCircumference(y)` slices the render mesh (or analytic loft) and returns perimeter; used to display "chest 90.0 cm" and to verify the solved radii within 0.5 %.

---

## 5. Cloth physics (XPBD, `src/physics/`)

**State** (SoA `Float32Array`): `x` (n×3, m), `xPrev`, `v`, `invMass`, `flags` (pinned bit, sewn-in bit). One global particle pool across all pieces; each piece owns an index range.

**Loop** (Macklin et al. 2019 small steps): frame `dt = 1/60`, `substeps = 8` (`h = dt/8`), **1 Gauss-Seidel iteration per substep** (order: distance → bending → seams → pins → collision). Per substep:

```
v += g·h ; v *= (1 − damping·h) ; xPrev = x ; x += v·h
solve constraints (XPBD with λ reset each substep, compliance α̃ = α / h²)
collide with body (position projection + friction)
v = (x − xPrev)/h ; clamp |v| ≤ vMax (4 m/s)
```

**Constraints** (`constraints.js`, each a typed-array batch):

- **Distance** on every triangle edge: `C = |x_i − x_j| − L0`, `L0` from 2D mm → m. Compliance `α_stretch` from fabric (`stretch`), scaled by `1/edgeLength` (so stiffness is per-unit-length, mesh-resolution independent). Warp/weft anisotropy v1.5: multiply α by `1 + anisotropy·|sin 2θ|` where θ is the edge angle to the grainline — the grainline is stored precisely for this.
- **Bending: cross-vertex distance** (Müller 2007 "bending as distance"): for each interior edge with opposite vertices (k, l), a distance constraint `|x_k − x_l| = L0_kl` with compliance `α_bend`. Chosen over dihedral-angle (gradient-heavy, singular at flat) and isometric bending (needs 4×4 Q per quad, more code) because it is 15 lines, unconditionally stable, and visually adequate for garments; its known artifact (resisting in-plane compression across the pair) is negligible at 15 mm spacing. It is expressed with the same distance kernel, so agent S writes one kernel. Optional `bendingModel:'isometric'` flag reserved for later.
- **Seam**: per seam pair a distance constraint with rest length ramping `L(t) = L_initial · max(0, 1 − t/sewDuration)` over `sewDurationS = 1.5 s` and compliance `0` (rigid). Ramping the rest length instead of stiffness keeps the constraint stiff from the start (no snap-through on completion) while moving the pieces smoothly. After `L = 0`, the pair is additionally welded: masses/positions averaged each substep (equivalent, cheaper). v1.5: cross-seam bending pairs to stop seam creasing.
- **Pins**: `invMass = 0` particles, optional target position (drag in 3D view with a ray-plane picker).
- **Zip/gather** = seam with `stiffness < 1` (adds compliance) — supported by the same kernel.

**Fabric → compliance mapping** (`fabrics.js`): particle mass `m = density_kg_m2 · area_m2 / 3` per triangle summed. `α_stretch = stretchCompliance` (m/N), `α_bend = bendCompliance`; both tabulated in §7, tuned so cotton stretches ~1 % under its own weight at 1 m hang.

**Collision with friction** (`collision.js`): for each particle, `d = sdf(x)`; if `d < thickness/2 + 2 mm`: `x += n·(thickness/2 + 2mm − d)`. Friction: tangential displacement this substep `Δx_t = (x − xPrev) − n·dot(x − xPrev, n)`; scale it by `max(0, 1 − μ·|Δx_n| / |Δx_t|)` (Coulomb-like in position space), where μ = fabric friction × body friction (0.5). Prevents cloth sliding off shoulders.

**Self-collision**: **not in v1** (documented limitation; layers interpenetrate). v1.5 design ready: uniform spatial hash (cell = 2h, `Int32Array` heads + next lists, rebuilt each substep), vertex–vertex repulsion when `|x_i − x_j| < thickness` and not topologically adjacent (≤2 edges), plus vertex–triangle only if needed.

**Arrangement** (`arrange.js`): anchors are body-attached cylinders: `torsoFront, torsoBack, torsoLeft, torsoRight, leftArm, rightArm, leftLeg, rightLeg, head`. Each anchor has an axis (a,b), radius `R` (from the loft at that height + `radiusOffset`, default 30 mm gap), and a centre angle `φ0`. A piece's 2D point `(u,v)` (mm, relative to the piece's bounding-box centre) maps to `angle = φ0 + rotation + u/R`, position `= axisPoint(v) + R·(cos, sin)`; pieces are therefore pre-curved around the body, so seams are already close (typically < 8 cm apart) when sewing begins and no piece is initialised inside the body (the SDF is checked; any particle with `d < 0` at arrangement is pushed out along the normal). "Reset" re-arranges.

**Performance budget**: T-shirt ≈ 2.2k particles / 13k constraints; dress ≈ 6k / 36k. Target ≤ 6 ms sim per frame at 6k particles on the main thread, ≤ 6 000 particles total (UI warns beyond). No allocations in the hot loop; all constraint batches are typed arrays built once at `sim.rebuild()`. `solver.js` exposes `step(dt)`, `stepN(n)`, `rebuild(project)`, `reset()`, `getPositions()` and has no DOM/three imports, so it drops into a Worker by moving the typed arrays (`SharedArrayBuffer` not required).

**Safeguards**: per-substep displacement clamp (`|x − xPrev| ≤ 0.05 m`); velocity clamp; NaN guard after each substep (`if (!isFinite(x[i]))` → restore `xPrev`, count; > 10 NaNs in a frame → `sim:nan` event, pause, statusbar red, `__app.sim.reset()` recovers); particles further than 5 m from origin are pinned back to the body surface; constraint counts/mesh checks before rebuild (no zero-length edges).

---

## 6. Sizing, grading and export

**Size chart** (`sizeChart` in the project; `ui/panels/sizes.js`): editable grid, measurements as columns (add/remove column), sizes as rows (add/rename/delete/reorder), values in mm displayed in cm with one decimal. Base size row highlighted; "Fit body to size" button sets body params from a row; "Size from body" creates a row from the current body.

**Grading** (`pattern/grading.js`), two layers, both simple and deterministic:

1. **Measurement-driven scaling (default).** Each piece declares `grading.widthDriver` (chest|waist|hip|none) and `lengthDriver` (height|backLength|armLength|none) and a `grading.origin` (mm, e.g. CF/hem corner so CF stays on the fold). For target size `s`: `sx = chart[s][widthDriver] / chart[base][widthDriver]`, `sy = chart[s][lengthDriver] / chart[base][lengthDriver]`; every outline point, handle, notch position (recomputed by `t`, so it keeps its edge fraction), grainline, and internal line is scaled about the origin by `(sx, sy)`. Seam allowances are **not** scaled (they are constants in mm). This gives industry-plausible grades (a 6 cm chest step scales a half-front by ~1.5 cm) with zero per-point work.
2. **Per-point grade deltas (pro).** `grading.pointDeltas["segIdx.p1"] = { "S": [−15, −5], "L": [15, 5] }` in mm, applied after scaling; sizes not listed are linearly interpolated by row index. The Sizes panel has a "grade point" mode: pick a size, drag a point, delta is recorded.

Seam length checks run per size and flag any seam whose ease drifts > 3 % from the base size. The 3D view can drape any size (body from that row, pieces graded) via the size dropdown.

**SVG export** (`export/svg.js`), per size or nested all sizes per piece (classic grade nest with colour per size):

- `<svg width="{W}mm" height="{H}mm" viewBox="0 0 W H">`, y flipped (pattern Y-up → SVG Y-down), 1 user unit = 1 mm, so the file is 1:1 in Inkscape/plotters.
- Layers (`<g id="cut">`, `stitch`, `notches`, `grain`, `labels`, `internal`): cut line 0.35 mm black solid; stitch line 0.25 mm dashed; notches as 5 mm ticks perpendicular to the cut line, extended into the allowance (double notch = two ticks 4 mm apart); grainline with arrowheads both ends; fold edge drawn as dash-dot with "PLACE ON FOLD"; label block: piece name, garment name, size, `CUT 2 / CUT 1 ON FOLD`, fabric, allowance summary, date; a 100 mm calibration square on page 1.
- **Polygon offset** (`pattern/offset.js`): input the sampled stitch polyline (0.5 mm chord) with per-vertex allowance (per edge, discontinuities at edge corners). For each segment build the offset segment `p + n·a`; at each corner: if convex (offset lines diverge) insert a round arc (or a miter when the angle < 30°, mitered corners are how paper patterns are drafted — user option `cornerStyle: 'miter'|'round'`, miter limit 4×); if reflex, intersect the two offset lines. Then clean self-intersections: scan non-adjacent segment pairs (O(n²) on ~600 segments is fine), and when a crossing is found remove the loop between them (keep the outer path — the loop with negative orientation relative to the polygon). Allowance changes between adjacent edges are handled by extending the larger-allowance edge to the other edge's offset line (standard "square-off" at hems). Notches are re-projected onto the cut line.
- Validation: output cut polygon must be simple and its area > stitch area; otherwise fall back to miter-only and warn.

**Tiled PDF** (`export/tiles.js`): no dependency — a print document. Choose paper (A4, Letter, A3, A0 single sheet) and margins (10 mm); compute the page grid over the layout bounding box; generate an HTML page (opened via `window.open`, same origin) with `@page { size: A4; margin: 0 }`, one `<div class="page">` per tile with `page-break-after: always`, each containing the full SVG with a `viewBox` window for that tile and printed at `width: 190mm; height: 277mm`. Add 10 mm overlap glue strips, crop marks, tile labels `A1..C4`, and the calibration square on every page. The user presses Ctrl+P → "Save as PDF" (Chromium's PDF engine is exact at mm scale, as verified by the calibration square). A "layout" step packs pieces on a virtual sheet with a greedy shelf packer (sort by height, place left-to-right in rows, respect grainline: no rotation unless `allowRotate`), width = roll width (1500 mm default) or the chosen paper.

**Size chart CSV/JSON**: `sizechart.js` → CSV with header row, values in cm; JSON is the `sizeChart` object; also a "piece measurements" CSV (per size: each edge length, seam ease %, piece area, estimated fabric consumption from the packer).

---

## 7. Fabric presets and colours

| id | density kg/m² | stretch α (m/N) | bend α | friction μ | damping /s | roughness | sheen | thickness mm | notes |
|---|---|---|---|---|---|---|---|---|---|
| cotton | 0.15 | 2e-4 | 5e-2 | 0.45 | 0.5 | 0.85 | 0.05 | 0.5 | poplin baseline |
| denim | 0.40 | 5e-5 | 5e-3 | 0.55 | 0.8 | 0.9 | 0.02 | 1.2 | stiff, heavy, twill texture |
| silk | 0.05 | 6e-4 | 1e0 | 0.25 | 0.25 | 0.25 | 0.6 | 0.15 | 10 mm spacing recommended |
| jersey | 0.20 | 2e-3 | 3e-1 | 0.50 | 0.6 | 0.8 | 0.05 | 0.8 | high stretch, anisotropy 0.5 |
| wool | 0.30 | 1.5e-4 | 2e-2 | 0.55 | 0.9 | 0.95 | 0.0 | 1.5 | fuzzy, high damping |
| leather | 0.90 | 2e-5 | 1e-3 | 0.60 | 1.2 | 0.35 | 0.4 | 1.5 | clearcoat |
| chiffon | 0.03 | 8e-4 | 3e0 | 0.20 | 0.15 | 0.4 | 0.3 | 0.1 | semi-transparent, opacity 0.6 |

Stretch compliance is per unit length as described in §5; bend compliance is applied to the cross-vertex distance constraint. `overrides` in the project can replace any cell. The Fabric panel exposes sliders "Stiffness", "Drape", "Weight" that map log-linearly to these fields so non-physicists can tune.

**Rendering** (`view3d/materials.js`): one `MeshPhysicalMaterial` per fabric, `side: DoubleSide`, `color` from hex, `roughness` and `sheen`/`sheenColor` (white-tinted colour) from the table, `clearcoat` for leather, `transparent + opacity` for chiffon, `flatShading:false` with per-frame recomputed normals. Cloth `BufferGeometry` has `position` (`DynamicDrawUsage`) bound directly to the solver's Float32Array (`array` shared, `needsUpdate` each frame), `index` from triangles, `uv` from 2D mm coordinates / 100 (10 cm texture tiles). Procedural textures (`CanvasTexture`, 512²): `none`, `stripes` (width mm, two colours), `gingham`, `dots`, `denim twill` (diagonal line noise), `herringbone`; generated on a canvas 2D context, so no image assets. A fabric's `color` is the base; textures multiply it. The 2D editor uses the same colour for piece fills.

---

## 8. UI layout and interaction

`ui/layout.js` builds:

```
+-----------------------------------------------------------------------------+
| Toolbar: New Open Save | Undo Redo | Tools (V D P M R S N G I X Tab) | Size ▾ | ▶ ⏸ ⟲ Sew | Pop-out ⤢ Swap |
+--------------------------------+-----+--------------------------------------+
| 2D editor (canvas)             |  ║  | 3D view (three.js canvas)            |
|                                |  ║  |                                      |
+--------------------------------+-----+--------------------------------------+
| Side dock (right, tabs): Pieces | Body | Fabric & Colour | Sizes & Export     |
+-----------------------------------------------------------------------------+
| Status: tool hint | cursor mm | seam ease | particles / constraints | ms/frame | sim state |
+-----------------------------------------------------------------------------+
```

- **Split view**: CSS grid `grid-template-columns: var(--split) 6px 1fr`; the divider (`#divider`) drags with pointer capture and writes `--split`; both canvases resize via `ResizeObserver`. `Swap` (Ctrl+Tab) exchanges panes.
- **Pop-out 3D** (`view3d/popout.js`): `Pop-out` calls `window.open('popout.html', 'clothstudio3d', 'width=1200,height=900')`. The popout runs its own three.js scene and a **read-only mirror** of the sim: the main window remains the simulation owner and posts, via `BroadcastChannel('clothstudio')`, `{type:'frame', positions: Float32Array}` each frame (structured-clone copy; ~70 KB at 6k particles, fine at 60 Hz) plus `{type:'topology', triangles, pieceRanges, fabrics}` on rebuild and `{type:'body', params}`. Camera events from the popout go back the same channel (`orbit` is local; only `pick`/`pin` are forwarded). While popped out, the main 3D pane collapses and 2D takes full width; closing the popup (`beforeunload` message or `closed` poll) restores it. Same origin, so the static server needs nothing special.
- **Panels**: Pieces (list, visibility, fabric assignment, cut qty, fold, mesh spacing, placement anchor/rotation/offset); Body (preset dropdown + one slider per parameter with numeric input, cm display, live circumference readout, "closest size"); Fabric & Colour (preset dropdown per fabric, colour input `<input type=color>`, pattern + colours, physical sliders); Sizes & Export (size chart grid, base size, grading drivers per piece, export buttons: SVG size / SVG nest / Print tiles / CSV / JSON / Project JSON, paper and margin selectors).
- **3D view**: OrbitControls, ground grid, three-point lighting, body, cloth, gizmo for arrangement (drag piece in 3D before sewing: move along anchor cylinder), display modes (shaded / wire / stress heat map from stretch ratio), body opacity slider.
- **Shortcuts** (`ui/shortcuts.js`): tools as listed; `Ctrl+Z/Y`, `Ctrl+S` (download JSON), `Ctrl+O`, `Space` (play/pause sim), `Enter` (sew), `Backspace` (reset sim), `Ctrl+E` (export SVG), `F` (flip seam direction), `Delete`, `Ctrl+D` (duplicate piece), `Ctrl+M` (mirror), `1/2/3` (focus 2D / 3D / both), `+/−/0` zoom, `Esc` cancel tool.
- Every control has `id` (`btn-play`, `sel-size`, `inp-body-chest`, `tab-panel-body`, …) and `data-testid`; lists use `data-piece-id`/`data-seam-id`.

---

## 9. `window.__app` automation API (`app/debugApi.js`)

```js
window.__app = {
  version, store, bus,                          // raw access
  project: { get(), set(json), loadSample('tshirt'|'skirt'|'dress'), toJSON(), fromJSON(str), undo(), redo() },
  pattern: { addPiece(piece), updatePiece(id, patch), deletePiece(id), addSeam(a, b, opts), deleteSeam(id),
             addNotch(pieceId, edge, t), setGrainline(pieceId, a, b), setAllowance(pieceId, edge, mm),
             seamEase(seamId) /* {lenA,lenB,easePct} */, validate() /* [{level,msg,pieceId}] */ },
  mesh:    { rebuild(), stats() /* {particles, triangles, minAngleDeg, perPiece} */, getMesh(pieceId) },
  body:    { setPreset(name), setParam(name, value), getParams(), measure(name) /* metres */,
             sdf(x,y,z) /* {d, n} */, primitives() },
  sim:     { play(), pause(), reset(), sew(), step(n=1), isRunning(), stats() /* {msPerFrame, nanCount, substeps} */,
             positions() /* Float32Array */, maxPenetrationM(), seamGapM() /* {max, mean} */,
             setFabricParam(fabricId, key, value), pin(index|null), hasNaN() },
  size:    { list(), select(name), setChart(rows), gradePiece(pieceId, sizeName) /* graded piece json */ },
  fabric:  { setPreset(fabricId, name), setColor(fabricId, hex), setPattern(fabricId, name, opts), list() },
  export:  { svg(pieceId, size) /* string */, svgAll(size), svgNest(pieceId), tilesHTML(opts) /* string */,
             csvSizeChart(), jsonSizeChart(), csvPieceMeasurements(), offsetPolygon(pieceId, size) /* [[x,y]] */ },
  ui:      { setTool(name), setSplit(f), swap(), popout(), popin(), selectPiece(id), zoomToFit(), screenshot3d() /* dataURL */ },
  ready:   Promise
};
```

All exported strings are returned, never only downloaded; downloads are a thin wrapper (`ui/download.js`) the tests skip.

---

## 10. Build order, ownership, integration, acceptance

**Phase 0 (lead, sequential, ~1 h):** `index.html`, `popout.html`, import map, `src/core/*`, `src/pattern/samples/tshirt.js` (front on fold, back on fold, sleeve ×2; 5 seams: 2 shoulders, 2 sides, sleeve seams ×2, sleeve-to-armhole ×2 = 8 seams), `skirt.js` (A-line: front/back on fold, 2 side seams), `main.js` skeleton with stub registrations, `app/debugApi.js` with stubs that throw "not implemented". Freeze `types.js`.

**Phase 1 (parallel, 8 agents):**

| Agent | Owns | Needs from contracts | Done when |
|---|---|---|---|
| P pattern | `src/pattern/` (model, sampler, seams, grading, offset) | types, geom | `sampler` within 0.25 mm; `offset` produces simple polygon for both samples; grading round-trips |
| M mesh | `src/mesh/` | types, pattern/sampler API signature (`samplePiece(piece,h)`) | T-shirt meshes < 200 ms, seam counts equal, min angle stats |
| B body | `src/body/` | types (BodyParams, SdfPrimitive) | presets generate; `measure('chest')` within 0.5 % of param; SDF outside points positive |
| S physics | `src/physics/` | types (ClothMesh, SeamPairing, Fabric), body/sdf interface `query(p,out)` | a hanging 30×30 sheet test (own fixture) is stable 2 000 steps; seam ramp closes two rectangles |
| V view3d | `src/view3d/` | types, solver `positions()`, body loft mesh format | renders body + cloth from arrays; popout mirror works with synthetic frames |
| E editor2d | `src/editor2d/` | types, pattern/model API, store/bus | draw/edit/seam/notch/grain tools on the samples; hit tests |
| X export | `src/export/` | types, pattern (sampler, offset, grading) | SVG opens in Inkscape at 1:1; tiles print with calibration square 100 mm |
| U ui | `src/ui/`, `src/app/session.js`, `debugApi.js` wiring | everything's public API names (from stubs) | panels bound to store; shortcuts; layout |

Each agent works against the frozen sample data and stubs; each ships a `src/<module>/selftest.js` exporting `runSelfTest()` (console assertions) callable from `__app`.

**Phase 2 (integration, lead + U, ~2 h):** wire `main.js` (order: store → body → pattern → mesh → physics → view3d → editor2d → ui → debugApi), replace stubs, run the acceptance list, fix contract drift.

**Acceptance checklist** (each runnable via Chromium automation on `http://localhost:8000`, checks against `window.__app` after `await __app.ready`):

1. `project.loadSample('tshirt')`; `mesh.stats().particles` in [1500, 4000]; `minAngleDeg > 15`.
2. For every seam: `mesh` edge vertex lists have equal length; `pattern.seamEase(id).easePct < 8`.
3. `sim.reset(); sim.step(60)` (pre-sew): `hasNaN() === false`; `maxPenetrationM() < 0.005`.
4. `sim.sew(); sim.step(300)`: `seamGapM().max < 0.008`; `hasNaN()===false`; `maxPenetrationM() < 0.005`; `stats().msPerFrame < 12`.
5. `body.setParam('chest', 1.10); sim.step(120)`: no NaN; `body.measure('chest')` within 0.5 % of 1.10; cloth still not penetrating > 5 mm.
6. `body.setPreset('child_10y')` then `sim.reset(); sim.sew(); sim.step(300)`: same invariants (garment too big, must still drape).
7. `size.select('XL')`: `size.gradePiece('p_front','XL')` width scaled by 1020/900 ± 1 mm at the chest line; notches keep `t`.
8. `export.svg('p_front','M')` parses with `DOMParser`; root `width` ends with `mm`; `#cut` path exists; `offsetPolygon` is simple (no self-intersections, area > stitch area); a 25 mm hem allowance measured between stitch and cut hem lines = 25 ± 0.3 mm.
9. `export.csvSizeChart()` has 5 lines, header `size,chest,...`; `export.jsonSizeChart()` round-trips.
10. `fabric.setPreset('fab_main','silk'); sim.reset(); sim.sew(); sim.step(300)`: no NaN; `sim.stats().msPerFrame < 15`.
11. `project.toJSON()` → `fromJSON` → `toJSON` is byte-identical; undo after `pattern.updatePiece` restores revision.
12. UI: `document.querySelector('#btn-play').click()` toggles `sim.isRunning()`; `ui.setSplit(0.3)` changes `#pane2d` width; `ui.popout()` opens a window whose `document.title` includes "3D" and receives a `topology` message (check via `__app.bus` counter).
13. Skirt sample passes 1–4 with `seamGapM().max < 0.008`.

---

## 11. Top risks and mitigations

1. **Seam sewing explodes or tunnels through the body.** Mitigation: cylinder-wrap arrangement puts seams < 8 cm apart; rest-length ramp (not stiffness ramp); displacement clamp 5 cm/substep; collision solved last every substep; 8 substeps. Fallback flag: `sewDurationS` up to 4 s.
2. **Delaunay edge recovery bugs on concave edges (armhole, neckline).** Mitigation: 0.6h clearance makes recovery rare; retry with new jitter seed; last-resort fallback meshing by ear-clipping the boundary polygon plus midpoint subdivision (uglier but always valid) so the app never fails to mesh.
3. **Polygon offset self-intersections (deep necklines, sharp dart tips).** Mitigation: loop-removal pass, miter fallback, validation before export, and hem "square-off" rule; darts are internal lines in v1 (never offset).
4. **Bending model too soft/visibly wrinkly for denim/leather.** Mitigation: bend compliance table tuned per preset; `bendingModel` flag reserved for isometric bending; larger mesh spacing (20 mm) for stiff fabrics.
5. **Body/cloth mismatch after morphology changes mid-simulation.** Mitigation: `body:changed` triggers SDF rebuild only; cloth particles inside the new body are pushed out along the SDF normal over 10 substeps rather than instantly.
6. **Main-thread frame budget at 6k particles + 2D canvas + three.js.** Mitigation: hard particle cap with warning, typed arrays, no per-frame allocation, render normals computed only on frames actually drawn, 2D canvas redraw only on `piece:changed`/viewport change; solver already Worker-shaped.
7. **Contract drift between 8 agents.** Mitigation: types.js frozen; every module has a stub with final signatures before fan-out; selftests; integration lead only merges modules that pass their own selftest.
8. **Print scale wrong (printer "fit to page").** Mitigation: 100 mm calibration square on every tile, `@page margin:0` and explicit mm sizes, instructions on the print page header ("Scale 100 %, no fit-to-page").
9. **Grading gives implausible shapes (necklines growing with chest).** Mitigation: per-piece drivers, grading origin at CF/CB, and per-point deltas for professionals; the seam ease check per size flags drift.
10. **Popout window blocked or loses sync.** Mitigation: popout is optional and read-only; `Swap` gives the same benefit in one window; heartbeat message every second, main window reverts to in-pane 3D if none is answered for 3 s.
