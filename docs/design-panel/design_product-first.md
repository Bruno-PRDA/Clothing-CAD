# Clothing App v1 — Architecture & Design

Target: a person opens `index.html` (served by `python -m http.server`), sees a T-shirt draped on a body in the right pane and its pattern pieces in the left pane, edits a piece, sews an edge, drapes, recolours, exports an SVG — in 10 minutes. Everything is vanilla ES2022 modules + JSDoc, three.js 0.180.0 from jsDelivr via import map, no other runtime dependency.

---

## 1. Module breakdown, ownership, dependency graph

```
index.html            app shell markup (all element ids live here)   [A0]
popout.html           standalone 3D renderer window                  [A6]
serve.py              python -m http.server wrapper (optional)       [A0]
styles/app.css                                                       [A8]
src/core/      types.js events.js store.js geometry.js units.js ids.js   [A0 contracts; geometry by A1]
src/project/   schema.js serialize.js undo.js samples/tshirt.js samples/skirt.js   [A1]
src/pattern2d/ editor.js renderer.js hit.js tools/{select,draw,move,notch,seam,grainline,mirror}.js  [A2]
src/mesher/    sampler.js delaunay.js mesher.js                      [A3]
src/body/      params.js presets.js build.js sdf.js arrange.js       [A4]
src/physics/   solver.js constraints.js collision.js hash.js placement.js  [A5]
src/render3d/  scene.js clothMesh.js bodyMesh.js materials.js popout.js   [A6]
src/fabric/    presets.js textures.js                                [A8]
src/sizing/    sizes.js grading.js                                   [A7]
src/export/    svg.js offset.js tiled.js csv.js                      [A7]
src/ui/        layout.js toolbar.js shortcuts.js statusbar.js panels/{pieces,body,fabric,sizes}.js  [A8]
src/app/       main.js wiring.js debugApi.js                         [A9]
```

Dependency graph (arrows = imports; only downward, no cycles):

```
core ← project ← {pattern2d, mesher, sizing, export, ui}
core ← fabric ← {physics(compliance), render3d(materials), ui}
core ← body ← {physics(sdf, arrange cylinders), render3d(body mesh)}
core, mesher ← physics
core, physics, body, fabric ← render3d
everything ← app (main.js/wiring.js is the only place modules are connected; via store + events)
```

Rule: modules never import each other sideways except along the arrows above. Cross-module communication is `store` reads and `events` emits. `app/wiring.js` subscribes to store changes and calls module APIs (e.g. `project changed → mesher.build → physics.load → render3d.setCloth`).

**Shared contracts (written first, by A0, frozen before parallel work):**

- `src/core/types.js` — all JSDoc `@typedef`s: `Project, Piece, Vertex, Seam, SeamSide, Placement, Grading, BodyParams, SizeTable, FabricPreset, ClothMesh, BodyModel (mesh + SDF grid + arrangement cylinders), SimStats, ToolName, Event map`. Every other module imports types from here only.
- `src/core/events.js` — `bus.on(type, fn)`, `bus.off`, `bus.emit(type, payload)`. Event names enumerated as constants: `project:loaded, project:changed (with {reason, pieceIds}), selection:changed, tool:changed, body:changed, mesh:built, sim:stats, sim:reset, layout:changed, popout:opened/closed`.
- `src/core/store.js` — single state `{project, ui:{tool, selection, layout, activeSize}, sim:{running, frame}}`. API: `store.get()`, `store.update(reason, mutatorFn)` (structuredClone snapshot for undo, then emit `project:changed`), `store.subscribe(fn)`, `store.undo()`, `store.redo()` (50 deep).
- `src/core/geometry.js` — 2D math used by A2, A3, A7: `sampleCubic(p0,h0,h1,p1,tol)`, `edgeLength`, `polygonArea`, `pointInPolygon`, `distPointSegment`, `polylineResample(pts, n)`, `bbox`.
- `src/project/samples/tshirt.js` — the canonical example document (also the acceptance fixture). Written by A0 with the schema; A1 refines.
- `index.html` — all ids/data-attributes for controls (A8 fills behaviour, A9 wires; ids never change).

---

## 2. Data model — the JSON project document

Units: pattern space mm (y down like SVG; piece origin = its bbox top-left at authoring time), 3D metres. `Vertex.hIn/hOut` are absolute mm positions of cubic-bezier handles; if both handles of segment i (v_i→v_{i+1}) are absent the segment is a straight line, otherwise it is a cubic with `hOut` of v_i and `hIn` of v_{i+1}` (a missing one defaults to the endpoint). Outlines are closed, CCW, no self-intersection (validated).

```json
{
  "version": 1,
  "name": "Basic T-shirt",
  "body": {
    "preset": "female_M",
    "params": { "height_cm": 175, "chest_cm": 92, "waist_cm": 76, "hip_cm": 98,
      "shoulderWidth_cm": 42, "neck_cm": 36, "upperArm_cm": 28, "forearm_cm": 24, "wrist_cm": 16,
      "thigh_cm": 56, "calf_cm": 36, "ankle_cm": 22, "armLength_cm": 60, "inseam_cm": 82,
      "torsoLength_cm": 44, "headHeight_cm": 23, "chestDepthRatio": 0.72, "armAbduction_deg": 25 }
  },
  "pieces": [
    { "id": "front", "name": "Front",
      "outline": [ {"x":0,"y":0}, {"x":250,"y":0,"hOut":{"x":280,"y":0}}, {"x":300,"y":40,"hIn":{"x":300,"y":15}},
                   {"x":300,"y":650}, {"x":0,"y":650} ],
      "notches": [ {"edge": 2, "t": 0.5} ],
      "grainline": { "x1": 150, "y1": 100, "x2": 150, "y2": 550 },
      "internalLines": [],
      "symmetry": { "enabled": false, "axisX": 150 },
      "fabricId": "cotton", "color": "#3b6fd6", "pattern": null,
      "seamAllowance_mm": 10, "quantity": 1,
      "placement": { "region": "torsoFront", "offset_mm": {"x": 0, "y": -40}, "clearance_mm": 60, "rotation_deg": 0, "flip": false },
      "grading": { "widthRef": "chest", "lengthRef": "height", "pivot": "centerTop" } }
  ],
  "seams": [
    { "id": "s1", "a": { "piece": "front", "edges": [3] }, "b": { "piece": "back", "edges": [3], "reverse": true }, "ease": 0 }
  ],
  "fabricOverrides": {},
  "sizes": {
    "base": "M",
    "measures": ["chest_cm", "waist_cm", "hip_cm", "height_cm"],
    "table": { "S": {"chest_cm": 84, "waist_cm": 68, "hip_cm": 90, "height_cm": 165},
               "M": {"chest_cm": 92, "waist_cm": 76, "hip_cm": 98, "height_cm": 175},
               "L": {"chest_cm": 100, "waist_cm": 84, "hip_cm": 106, "height_cm": 180},
               "XL": {"chest_cm": 110, "waist_cm": 94, "hip_cm": 114, "height_cm": 185} }
  },
  "sim": { "targetEdge_mm": 15, "thickness_mm": 4, "substeps": 6, "selfCollision": true, "gravity": 9.81 }
}
```

`pattern` may be `{ "type": "stripes"|"plaid"|"dots"|"twill", "color2": "#fff", "scale_mm": 20 }`. `quantity: 2` with `placement.flip` on the mirrored copy is how left/right sleeves work without duplicating geometry (mesher instantiates copies; export prints "Cut 2").

---

## 3. 2D pattern editor

**Representation.** Path with optional bezier handles (above). Edge index = start vertex index; edges are the seam/notch addressable unit. Splitting an edge (double-click) inserts a vertex and renumbers; a `project:changed` reason `edgesRenumbered` carries an index map so seams/notches referencing later edges are shifted by the editor before commit (done inside `pattern2d/editor.js` so other modules never see dangling references).

**Canvas.** HTML `<canvas id="pattern-canvas">` with a 2D context, world = mm, view = pan/zoom transform (mm → px). Grid every 10 mm/50 mm, rulers on the edges, piece labels, seam edges coloured by seam id (matching hue on both pieces), grainline arrow, notch ticks, handles when a vertex is selected.

**Tools** (`store.ui.tool`; ids `tool-select`, `tool-draw`, `tool-move`, `tool-notch`, `tool-seam`, `tool-grainline`, `tool-mirror`):
- *select/edit points*: click vertex/handle, drag; Alt-drag a vertex pulls out symmetric handles (converts adjacent edges to curves); Delete removes vertex (min 3); double-click edge inserts vertex at t.
- *draw*: click to place vertices; click first vertex or Enter closes → new piece; Esc cancels. Snap to 5 mm grid (toggle) and to existing vertices within 3 mm.
- *move*: drag piece; Ctrl-D duplicate; R rotates 90°.
- *mirror/symmetry*: "Mirror piece" duplicates flipped about the vertical axis at the piece's right edge (produces a full front from a half). "Symmetric edit" toggle (`symmetry.enabled`): moving vertex v also moves the vertex nearest to `mirror(v)` (within 1 mm) by the mirrored delta.
- *notch*: click on edge → `{edge,t}`.
- *seam (UX: click edge A then edge B)*: first click selects an edge chain (Shift-click extends along consecutive edges of the same piece); second click on another piece (or same piece, for darts/side seams) creates the seam. Direction: the editor draws start markers; the `reverse` flag is auto-set so the two chains run the same physical direction (heuristic: chains oriented so their first points are the closest pair; user can flip with the "Flip" button in the seam list). Length mismatch > 15 % shows a warning in the status bar.
- *grainline*: drag to draw the arrow.
- *internal lines/darts*: v1 stores `internalLines` for export only (drawn as dashed lines in SVG); not simulated.

**Hit testing** (`hit.js`): flatten curves at 1 mm tolerance once per piece (cached by piece revision), distance-to-polyline in px.

### Meshing (mesher module): outline → simulation triangles

Input: `pieces + seams + targetEdge h (default 15 mm)`. Output `ClothMesh`:

```
{ pos2d: Float32Array(2n) mm, tris: Uint32Array(3t), edges: Uint32Array(2e),
  bendPairs: Uint32Array(4b) [v0,v1 shared edge, v2,v3 opposite],
  seamPairs: Uint32Array(2s), pieceOfVertex: Uint16Array(n), pieceRange: {pieceInstanceId:[start,end]},
  boundary: Uint8Array(n), uv: Float32Array(2n) [0..1 per piece bbox],
  edgeSamples: Map<"piece:edge", Uint32Array> (vertex ids along each edge, for notches/pins) }
```

Algorithm, per piece instance:
1. **Boundary sampling** (`sampler.js`). Flatten each edge to a polyline at 0.5 mm chord tolerance to get its arc length L. Sample count: for an edge that belongs to seam side S with total chain length L_S and partner length L_T: `n_S = max(2, ceil(max(L_S, L_T)/h))` samples over the whole chain, distributed along the chain by arclength (each edge gets its share, chain interior corners forced as samples); for free edges `n = max(1, ceil(L/h))`. Notch parameters are forced as sample points. Every outline vertex is a sample. Result: closed polygon P of m boundary points, roughly h-spaced. **Seam sides therefore have exactly n_S+1 samples each; `seamPairs[k] = (A_k, B_k)` by index, with B reversed if `reverse`.** Mismatched lengths (ease/gathering) are handled by proportional-arclength matching — the longer side is compressed uniformly by the zero-length seam constraints, which is physically what gathering does.
2. **Interior points.** Hexagonal lattice: rows at spacing `h·√3/2`, points spaced h, odd rows offset h/2, lattice jittered by ±0.05 mm to avoid co-circular degeneracy. Keep points where `pointInPolygon(P)` and `distToPolyline(P) ≥ 0.6h`.
3. **Delaunay (Bowyer–Watson)** on boundary + interior points (`delaunay.js`, ~150 lines): super-triangle 10× bbox; insert points in random order; for each, collect triangles whose circumcircle contains it (walk from the last triangle via adjacency, else brute force — fine for ≤ 3000 pts/piece), remove, re-triangulate the cavity polygon. Circumcircle test with the standard `incircle` determinant in doubles; coordinates are ≤ 2000 mm so precision is fine.
4. **Boundary preservation.** A boundary segment (a,b) is guaranteed Delaunay when its diametral circle is empty (Gabriel condition). Interior points are ≥ 0.6h from the boundary while the diametral radius is ≤ 0.5h, so only other boundary points at sharp concave corners can violate it. Check: for every consecutive boundary pair, is the edge present? If not, insert the segment midpoint into the boundary samples (and, if it was a seam edge, also on the partner chain at the same fraction — keeps pairing intact) and re-run steps 3–4, max 3 rounds; after that keep the mesh and log a warning.
5. **Classification.** Remove super-triangle triangles and any triangle whose centroid is outside P (point-in-polygon). Build unique edge list, adjacency, `bendPairs` from every interior edge's two triangles.
6. **Smoothing.** Two Laplacian passes on interior vertices (blend 0.5), then reject any pass that flips a triangle orientation (revert that vertex).
7. Quality target: median edge 15 mm, min angle > 20° on the samples (assert in tests). Piece with 300×650 mm gives ≈ 1000 vertices; a T-shirt ≈ 3500, a skirt ≈ 2500.

---

## 4. Parametric body

**Skeleton from params** (`params.js`). All lengths derive from `height_cm` (H) through fixed fractions, then are overridden by explicit params where given. Landmark heights (fraction of H): crotch 0.47, hip 0.52, waist 0.62, underbust 0.68, chest 0.72, armpit 0.77, shoulder 0.82, neck base 0.845, chin 0.87, head top 1.0. `inseam_cm` moves the crotch; `torsoLength_cm` (neck base to waist) moves waist/chest proportionally; `armLength_cm` = shoulder to wrist.

**Cross-sections from circumferences.** Each torso section is an ellipse with semi-axes a (half-width, x) and b (half-depth, z), `b = r·a` where r = `chestDepthRatio` (0.72 at chest, 0.75 waist, 0.72 hip, 0.8 armpit). Given circumference C, solve a from Ramanujan: `C ≈ π[3(a+b) − √((3a+b)(a+3b))]` — bisection on a (5 iterations, error < 0.1 %). Measurements are therefore *enforced by construction*; `body.measure(params)` recomputes them numerically (sum of ring edge lengths of the render mesh at that height) and the Body panel shows both. Shoulder section: a = shoulderWidth/2, b = 0.55·a_chest. Centre z of each section shifts slightly (chest +0.5 cm, hip −1 cm) for a natural profile.

**Primitive list (`BodyModel.primitives`, in metres, body-local space, y up, x to the model's left):**
| # | Part | Primitive |
|---|---|---|
| 1 | Torso | Loft of elliptic sections: crotch, hip, waist, underbust, chest, armpit, shoulder, neckBase (Catmull-Rom interpolated table of (a,b,cz) every 1 cm) |
| 2 | Neck | Round cone neckBase→chin, r = neck_cm/2π |
| 3 | Head | Ellipsoid, centre y = 0.935H, radii (0.075, 0.115, 0.09)·(H/1.75) |
| 4,5 | Shoulders | Spheres at (±sw/2, y_shoulder, 0), r = upperArm/2π·1.1 |
| 6,7 | Upper arms | Round cone shoulder→elbow, r1 = upperArm/2π, r2 = 0.85·r1; direction: A-pose, rotated `armAbduction_deg` (25°) outward from −y, 5° forward |
| 8,9 | Forearms | Round cone elbow→wrist, r1 = forearm/2π, r2 = wrist/2π |
| 10,11 | Hands | Ellipsoid (0.045, 0.09, 0.02) along the forearm axis |
| 12,13 | Thighs | Round cone hip joint (±0.085·(chest a/0.16), y_crotch+0.03) → knee, splayed 4°, r1 = thigh/2π, r2 = 0.8·r1 |
| 14,15 | Shins | Round cone knee→ankle, r1 = calf/2π, r2 = ankle/2π |
| 16,17 | Feet | Ellipsoid (0.045, 0.035, 0.12) forward of the ankle |

Elbow = shoulder + 0.47·armLength along the arm axis; knee = hip joint + 0.5·inseam·1.1 downward.

**SDF (`sdf.js`).** Analytic per primitive: sphere/ellipsoid via first-order approximation `d ≈ f/|∇f|` with `f = √(Σ(p_i/r_i)²) − 1`; round cone = Quilez `sdRoundCone(p, a, b, r1, r2)`; loft: look up (a,b,cz) at clamp(y) from the table, `f = √((x/a)²+((z−cz)/b)²) − 1`, `d_xz = f/|∇f|`, then `d = max(d_xz, y_crotch − y, y − y_neckBase)`. Body SDF = min over primitives. **Baked to a uniform grid**: cell 10 mm, box = body bounds + 5 cm margin (≈ 80×195×60 = 0.94 M floats = 3.7 MB Float32Array), baked in ~150 ms with a coarse pre-cull (skip primitives whose bounding sphere is > 15 cm from the cell). The solver only ever calls `sdf.sample(x,y,z) → {d, nx,ny,nz}` = trilinear value + central-difference gradient (6 extra trilinear samples, normalised). Re-baked (debounced 150 ms) on `body:changed`; the physics keeps colliding with the old grid until the new one is swapped in.

**Presets (`presets.js`)** are `BodyParams` objects: `female_S/M/L`, `male_S/M/L`, `child_10y`, `tall_slim`, `plus`. Choosing a preset copies its params; edits after that set `preset: "custom"`.

**Render mesh (`build.js`).** Torso loft: 32 segments × one ring per cm; capsules/round cones: 16×8; ellipsoids: 16×12; merged with `BufferGeometryUtils.mergeGeometries` from three addons into one indexed geometry with smooth normals (regenerated on param change; < 20 k triangles).

**Arrangement cylinders (`arrange.js`)** for piece placement, all derived from the body: `torsoFront/torsoBack` (axis crotch→neckBase, R = a_chest), `armL/armR` (axis shoulder→wrist, R = r upperArm), `legL/legR`, `skirtFront/skirtBack` (axis crotch−0.6 m→waist, R = a_hip). Each region has a facing angle (front 0°, back 180°, left/right arm = outward normal).

---

## 5. Cloth physics (XPBD)

**State** (`solver.js`): `x, xPrev, v: Float32Array(3n)` metres; `invMass: Float32Array(n)`; constraint arrays as typed arrays (`distIdx Uint32Array(2c), distRest Float32Array(c), distCompliance Float32Array(c)`, same for bend, seams, pins). Everything lives in one `SimState` object, no closures over DOM, so it can be moved into a Worker later by transferring the buffers. `stepFrame(dt=1/60)` runs `substeps` (default 6) of one Gauss–Seidel pass each (XPBD small-steps: many substeps, 1 iteration is more accurate than 1 substep × many iterations).

Per substep h = dt/substeps:
```
for i: xPrev=x; v += g·h; |v| clamped ≤ vMax (8 m/s); x += v·h
solve distance → bend → seams → pins (each XPBD: Δλ = (−C − α̃λ)/(Σw|∇C|² + α̃), α̃ = α/h²; λ reset each substep)
collide with body SDF (with friction), self-collision (if enabled)
v = (x − xPrev)/h; v *= max(0, 1 − damping·h)
```

**Mass**: `m_i = ρ_fabric · (Σ area of incident triangles)/3`, area from `pos2d` in m². Pinned vertices `invMass = 0`.

**Constraints:**
- *Distance* on every mesh edge, rest = 2D length (mm→m). Compliance `α_stretch` from fabric (m/N).
- *Bending — cross-edge distance constraint* (Müller 2007 "distance bending"): for each `bendPair`, a distance constraint between the two opposite vertices v2,v3 with rest = their 2D distance and compliance `α_bend`. Justification: it is two lines of code on the existing distance solver, has no singularities (dihedral-angle bending has `atan2`/`acos` derivatives that blow up on flat triangles and is the single most common source of NaNs), and at 15 mm triangle size the stiffness/drape difference from isometric bending is invisible in a demo. Weakness: it also resists in-plane shear slightly; we compensate by giving `α_bend` values 50–500× `α_stretch`.
- *Seams*: distance constraint rest 0 between `seamPairs`, compliance `1e-9`. **Sewing ramp:** when `sew()` is triggered (or on load), each seam stores `d0 = |x_A − x_B|` and for T = 1.0 s uses `rest(t) = d0·(1 − t/T)` — a progressive rest length pulls pieces together at constant speed without an initial explosion; after T the rest is 0. During the ramp, gravity on boundary vertices is unchanged but `vMax` is reduced to 3 m/s. Piece–piece collision between seam neighbours is skipped for pairs within 2 rings of a seam (mask built once).
- *Pins*: `pinIdx, pinTarget`; vertex snapped to target each substep, `invMass=0`. Used by the "pin to body" tool and by the automated tests.

**Compliance mapping**: `α = fabric.stretchCompliance` directly (values in §7 are tuned so that with ρ≈0.15–0.6 kg/m² and 15 mm edges the visible stretch under self-weight is 0–3 %). Fabric changes rewrite the compliance arrays in place; no rebuild.

**Damping**: per-fabric `damping` (1/s) applied as above plus XPBD's own implicit damping; no separate drag model.

**Body collision with friction** (`collision.js`): for each vertex, `s = sdf.sample(x)`; if `s.d < r` (r = thickness/2 + 2 mm margin = 4 mm): `x += (r − s.d)·n`. Friction (PBD, Macklin 2014): tangential displacement this substep `Δt = (x − xPrev) − ((x − xPrev)·n)n`; if `|Δt| < μ_s·(r − s.d)` remove it entirely (static), else scale by `μ_k·(r−s.d)/|Δt|`. μ from fabric (`friction`) combined with body friction 0.5 by mean. Because the SDF is a grid, one trilinear sample per vertex per substep: 3500 verts × 6 = 21 k samples/frame, sub-millisecond.

**Self-collision (v1: yes, vertex–vertex, spatial hash)** (`hash.js`): cell = 2·r_self with r_self = 6 mm; hash `(⌊x/c⌋·73856093 ^ ⌊y/c⌋·19349663 ^ ⌊z/c⌋·83492791) mod tableSize` with a counting-sort layout (two Int32Arrays: cellStart, entries) rebuilt every substep (O(n)). For each vertex, check the 27 neighbour cells; for pairs with `|d| < 2r_self` not in each other's 1-ring (checked via a sorted neighbour table) and not seam-masked, push apart along d by `(2r_self − |d|)` weighted by inverse mass. Vertex-only means thin edge–triangle tunnelling is possible; acceptable for v1 (toggle `sim.selfCollision`, and a "Reset" button exists).

**Initial arrangement** (`placement.js`): for each piece instance, take the arrangement cylinder of `placement.region` (§4). Map piece 2D point (u,v) relative to the piece's bbox centre: `θ = facing + rotation + (u + offset.x)/R'`, `y = y_axisTop − (v + offset.y)`, `R' = R + clearance_mm`; position = axisPoint(y) + R'·(cosθ·e1 + sinθ·e2) where e1,e2 span the plane ⟂ to the cylinder axis. `flip` negates u. Pieces wider than πR' wrap further around (still fine). `arrange()` sets `x` from this and zeroes v; `sew()` starts the ramp; `drape()` = arrange + sew + play. The app's default on load is `drape()`.

**Performance budget**: ≤ 8 000 vertices, ≤ 16 000 triangles, ≤ 24 000 distance + 12 000 bend constraints; 6 substeps → ≈ 250 k constraint projections/frame ≈ 4–7 ms on a laptop; target ≤ 12 ms sim + ≤ 4 ms render at 60 Hz. If `msPerFrame > 20` for 30 consecutive frames the solver drops to 4 substeps and the status bar shows "reduced quality".

**Stability safeguards**: velocity clamp (above); per-substep displacement clamp 2 cm; NaN guard every frame (`x.some(isNaN)` is ~0.1 ms) → restore last snapshot (taken every 60 frames when stats are sane), emit `sim:reset` with reason; `reset()` re-arranges from the project; on `mesh:built` the solver is fully rebuilt (no incremental topology edits in v1 — a piece edit re-meshes that piece and re-drapes, which at ~100 ms is fine).

**Stats** (`sim:stats` every 10 frames): `{frame, msStep, maxSpeed, maxPenetration_mm (= max(0, r − d) over vertices), seamMaxGap_mm, seamMeanGap_mm, nanCount, vertexCount, triCount}`.

---

## 6. Sizing & export

**Size chart** (`sizing/sizes.js`): `sizes.table[size][measure]`, editable grid in the Sizes panel (`#sizes-table`, inputs `data-size="M" data-measure="chest_cm"`); add/remove size columns; base size marked. The body panel's "Fit size" button copies a size's measures into `body.params`.

**Grading (global anisotropic scaling from base size)** (`grading.js`): for piece p and size s,
`sx = table[s][p.grading.widthRef] / table[base][widthRef]`, `sy = table[s][lengthRef] / table[base][lengthRef]`, applied about the piece pivot (`centerTop`: bbox centre x, bbox top y) to vertices and handles; notches keep `t`; grainline scales with the piece. Sleeves use `widthRef: "chest"`, skirts `hip`, waistbands `waist`. This is exactly what the industry calls "proportional grading" and is one function of ~20 lines; per-point grade rules are explicitly out of v1 (schema reserves `piece.gradeRules` for later). `gradedProject(project, size)` returns a new project whose pieces are scaled — used by export and by "simulate size S" (which also sets the body to that size's measures).

**SVG export at 1:1 mm** (`export/svg.js`): `<svg width="{W}mm" height="{H}mm" viewBox="0 0 W H">` — user units = mm, so printing at 100 % is 1:1. Pieces laid out by a simple shelf packer (sorted by height, rows of 1 200 mm max width, 20 mm gaps) or one piece per file. Per piece: cut line = offset outline (solid, 0.5 mm), stitch line = original (dashed), grainline arrow, notches as 5 mm ticks perpendicular to the edge extending into the allowance, internal lines dashed, label `<text>` with piece name, size, "Cut 2 (1 mirrored)", fabric, seam allowance. Outline curves are emitted as `C` commands, so the SVG is exact; the offset polygon is a polyline from the 1 mm-flattened outline.

**Polygon offset** (`offset.js`), outline flattened at 0.5 mm: for each edge compute the outward normal (CCW polygon → right-hand normal), offset segment by `sa`; join consecutive offset segments: if the corner is convex (cross product > 0 for outward), add an arc (round join, 5° steps) between the two offset endpoints about the original vertex; if concave, intersect the two offset lines (miter) — a concave miter never overshoots. Then remove self-intersecting loops with a single pass: walk the offset polyline, test each segment against the next 30 segments, and if they intersect, cut out the loop between them (handles the small "ear" loops that appear at sharp concave corners). Good enough for garment shapes; tested on the T-shirt neckline and the skirt hem.

**Tiled PDF via print CSS** (`export/tiled.js`): returns an HTML document string opened in a new window (`about:blank` + `document.write`) containing one `<svg>` per page, each with `viewBox="tx ty pw ph"` = a window onto the full layout; page size A4 or Letter (`#export-page-size`) minus 10 mm margins, 10 mm overlap between tiles, crop marks at the corners, page label "row B col 3 — size M — align mark ▲". `@page { size: A4 portrait; margin: 0 } .page { page-break-after: always; width: 210mm; height: 297mm }`. The user presses Ctrl-P → Save as PDF; no library. `__app.export.tiledHtml(size)` returns the string so tests can count pages.

**Size-chart export**: CSV (`size,chest_cm,waist_cm,hip_cm,height_cm` rows) and JSON (the `sizes` object plus derived per-piece bbox per size). Downloads use `Blob` + `<a download>`; every exporter also *returns the string* so automation can assert on content.

---

## 7. Fabric presets and colours

`src/fabric/presets.js` (`FabricPreset` typedef). Compliances in m/N for the 15 mm-edge discretisation; density kg/m²; thickness mm; damping 1/s.

| id | density | stretchCompliance | bendCompliance | friction | damping | roughness | sheen | thickness |
|---|---|---|---|---|---|---|---|---|
| cotton | 0.15 | 2e-6 | 4e-4 | 0.45 | 1.5 | 0.85 | 0.05 | 0.4 |
| denim | 0.45 | 5e-7 | 5e-5 | 0.55 | 2.5 | 0.9 | 0.0 | 0.9 |
| silk | 0.05 | 4e-6 | 5e-3 | 0.20 | 0.8 | 0.35 | 0.8 | 0.15 |
| jersey | 0.20 | 4e-5 | 2e-3 | 0.50 | 2.0 | 0.8 | 0.1 | 0.6 |
| wool | 0.30 | 1e-6 | 2e-4 | 0.60 | 3.0 | 0.95 | 0.15 | 1.2 |
| leather | 0.90 | 2e-7 | 1e-5 | 0.40 | 4.0 | 0.45 | 0.0 | 1.5 |
| chiffon | 0.04 | 6e-6 | 8e-3 | 0.25 | 0.6 | 0.5 | 0.4 | 0.1 |

`sim.thickness_mm` uses `max(fabric.thickness, 3)` for collision radius. `fabricOverrides` in the project lets users tweak any number (Fabric panel sliders, ids `fabric-<field>`).

**Materials** (`render3d/materials.js`): one `MeshPhysicalMaterial` per piece instance, `side: DoubleSide`, `color` = piece colour (sRGB → `material.color.set(hex)`, renderer `outputColorSpace = SRGBColorSpace`), `roughness`, `sheen`, `sheenColor = color.lerp(white, 0.5)`, `metalness 0`, `flatShading false`, optional `map` from a procedural `CanvasTexture` (512² canvas, `RepeatWrapping`, repeat = pieceBbox_mm / scale_mm) for `stripes`, `plaid`, `dots`, `twill` (twill: diagonal 2-px lines, used as denim default with `color2` a darker shade). Cloth UVs come from the mesher (`uv` = normalised 2D coordinates), so patterns follow the grain. Scene: hemisphere + directional light with shadow map (2048), soft grey ground, `OrbitControls` from addons, body `MeshStandardMaterial` skin colour (`#d9b99b`, roughness 0.7), optional wireframe overlay toggle (`#view-wireframe`).

---

## 8. UI layout

`index.html` grid: `#toolbar` (top, 40 px) / `#main` (three columns: `#pane-2d`, `#divider`, `#pane-3d`) / `#side-panels` (right, 300 px, tabs `#tab-pieces #tab-body #tab-fabric #tab-sizes`) / `#statusbar` (bottom, 24 px). Divider: pointer drag sets `--split` CSS variable (fraction), persisted in localStorage; both panes resize their canvases on `ResizeObserver`. Swap button `#btn-swap-panes` flips the panes (`layout:changed` → `ui.layout ∈ {'split','2d','3d','popout'}`); `1`/`2` maximise one pane, `3` restores split.

**Pop-out** (`render3d/popout.js`): `#btn-popout` → `window.open('popout.html','cloth3d','width=900,height=800')`. The main window stays the single source of truth (sim runs there); it posts on `BroadcastChannel('clothing-app-3d')`: `{type:'topology', tris, uvs, pieceRanges, bodyPositions, bodyIndices}` once (and on rebuild), `{type:'materials', perPiece}` on change, `{type:'frame', positions: Float32Array}` at 30 Hz (structured clone of 3500×3 floats = 42 kB, fine), `{type:'body', positions}` on body change. The pop-out replies `{type:'hello'}`/`{type:'closed'}`; while open, the main 3D pane shows "3D view is in a separate window — [bring back]" and stops rendering. Closing the pop-out (or `beforeunload`) restores the pane. `popout.html` imports only `render3d/*` and `core/types.js`.

**Toolbar**: sample dropdown (`#sample-select`), Open/Save (`#btn-open`, `#btn-save`, hidden `<input type=file id=file-open>`), tools (`#tool-*`), Undo/Redo, sim controls (`#btn-arrange #btn-sew #btn-drape #btn-play #btn-reset`), size dropdown (`#size-select`), pop-out/swap.

**Panels**: Pieces (list `#pieces-list li[data-piece-id]`, seam list `#seams-list li[data-seam-id]` with flip/delete, placement region select `#placement-region`, seam allowance `#piece-seam-allowance`); Body (preset select `#body-preset`, one range+number pair per param `#body-<param>`, measured values readout `#body-measured-<name>`); Fabric/Colour (`#fabric-select`, colour input `#piece-color`, pattern select `#piece-pattern`, override sliders); Sizes/Export (`#sizes-table`, `#btn-export-svg`, `#btn-export-tiled`, `#btn-export-csv`, `#btn-export-json`, `#export-page-size`). Status bar: tool hint, cursor mm, vertex/tri count, ms/frame, seam gap, warnings.

**Shortcuts** (`ui/shortcuts.js`): V select, D draw, M move, N notch, S seam, G grainline, Delete, Ctrl-Z/Y, Ctrl-D duplicate, Ctrl-M mirror piece, Space play/pause, R reset drape, F frame all (active pane), 1/2/3 layout, Ctrl-S save, Ctrl-O open, Esc cancel tool, +/- zoom.

---

## 9. `window.__app` automation API (`app/debugApi.js`)

```js
window.__app = {
  version: '1.0.0', ready: Promise<void>,           // resolves after first mesh+drape
  store, bus,                                        // raw access
  getState(): State, getProject(): Project,
  project: { load(json|string), save(): string, loadSample(name:'tshirt'|'skirt'), listSamples(): string[], undo(), redo() },
  pattern: { addPiece(outline, opts): id, setOutline(id, outline), movePiece(id, dx, dy), deletePiece(id),
             addSeam(sideA, sideB, opts): id, removeSeam(id), addNotch(id, edge, t), setPlacement(id, placement),
             select(ids), getMesh(): ClothMesh, getMeshStats(): {pieces, vertices, tris, minAngleDeg, medianEdge_mm} },
  body: { setPreset(name), setParam(name, value), setParams(obj), getParams(), getMeasurements(): {chest_cm,...},
          sdfAt(x,y,z): number, listPresets() },
  sim: { arrange(), sew(), drape(), play(), pause(), reset(), step(n=1), setSubsteps(n), setSelfCollision(bool),
         getStats(): SimStats, getPositions(): Float32Array, pin(vertexIdx, [x,y,z]), unpinAll() },
  fabric: { list(), setPieceFabric(id, fabricId), setPieceColor(id, hex), setPiecePattern(id, patternOrNull), setOverride(fabricId, field, value) },
  sizing: { getTable(), setMeasure(size, measure, value), addSize(name, measures), removeSize(name), setActiveSize(name), gradedProject(size) },
  export: { svg(size='M', opts): string, tiledHtml(size, page='A4'): string, sizeChartCsv(): string, sizeChartJson(): string, projectJson(): string },
  ui: { setTool(name), setLayout(name), popout(), closePopout(), getLayout(), click(id) /* dispatches click on #id */ },
  perf: { lastFrameMs, avgFrameMs },
};
```

`sim.step(n)` runs n frames synchronously (rendering suppressed) and returns the stats — the backbone of the acceptance tests.

---

## 10. Build order for parallel agents

**Phase 0 (A0, sequential, ~first hour):** `index.html` skeleton with every id above + import map; `core/types.js` complete typedefs; `core/events.js`; `core/store.js`; `core/units.js`, `core/ids.js`; `project/samples/tshirt.js` (front, back, 2 sleeves; 5 seams: shoulders ×2, sides ×2, sleeve heads ×2, sleeve underarm ×2) and `skirt.js` (front, back, 2 side seams, waist elastic pins); `app/main.js` stub that imports every module's `index.js` and calls `init(ctx)` — each module exports `init({store,bus,root})` and its public API. A0 also writes `docs/CONTRACTS.md` = this document's §1–2 + API signatures per module.

**Phase 1 (parallel, each agent owns one directory, each ships its own `selftest.js` runnable from the console):**
| Agent | Owns | Needs from contracts | Deliverable check |
|---|---|---|---|
| A1 | core/geometry, project/ | types | schema validation rejects bad docs; samples validate; undo 50-deep |
| A2 | pattern2d/ | types, store, events, geometry | draws samples; all tools mutate store via `update()`; seam creation emits changed |
| A3 | mesher/ | types, geometry, samples | `buildMesh(project)` on tshirt: minAngle > 20°, seam pair counts equal, all boundary edges present |
| A4 | body/ | types, three (addons merge) | presets build in < 200 ms; `measure()` within 1 % of params; SDF grid negative inside, positive outside |
| A5 | physics/ | types, ClothMesh, BodyModel SDF interface, FabricPreset | with a synthetic 20×20 quad mesh and sphere SDF: no NaN over 1000 steps, rests on sphere |
| A6 | render3d/ + popout.html | types, ClothMesh, BodyModel mesh, FabricPreset | renders samples; popout protocol round-trips |
| A7 | sizing/, export/ | types, geometry, samples | SVG parses (`DOMParser`), offset polygon has no self-intersection on samples, tiled page count correct |
| A8 | fabric/, ui/, styles | types, store, events, ids in index.html | panels reflect store and write back; shortcuts |
| A9 | app/ (wiring, debugApi), integration | everything | acceptance checklist below |

Until real modules land, A5 uses a hand-built mesh and a sphere SDF, A6 uses a static mesh, A9 uses stubs; all follow the typedefs so swapping is mechanical.

**Phase 2 (A9 integration):** wire `project:changed → mesher.build → physics.load(mesh, body, fabrics) → render3d.setCloth`; `body:changed → body.rebuild → physics.setBody → render3d.setBody`; fabric/colour → in-place updates; export buttons; `__app`. Fix interface mismatches by editing the *consumer*, never the contract, unless A0 approves.

**Phase 3 acceptance checklist** (run by A9 in Chromium via automation, all against `window.__app`):
1. `await __app.ready` resolves in < 5 s; no console errors.
2. `project.loadSample('tshirt')`; `pattern.getMeshStats()`: 2 500 ≤ vertices ≤ 8 000, `minAngleDeg ≥ 15`, every seam has equal sample counts (`getMesh().seamPairs.length > 0`).
3. `sim.drape(); const s = sim.step(300)`: `s.nanCount === 0`, `s.maxPenetration_mm < 5`, `s.seamMaxGap_mm < 8`, `s.maxSpeed < 0.5`, `s.msStep < 25`.
4. `body.setParam('chest_cm', 110); sim.step(200)` → same asserts; `body.getMeasurements().chest_cm` within 1 % of 110.
5. `body.setPreset('male_L')` → `sdfAt(0, 1.2, 0) < 0` (inside torso) and `sdfAt(0.5, 1.2, 0.5) > 0`.
6. `pattern.setOutline('front', …shorter hem)` → re-mesh and drape automatically; `step(300)` passes 3.
7. `fabric.setPieceFabric('front','silk'); fabric.setPieceColor('front','#ff0000')` → step 120, no NaN; render3d material colour reads `#ff0000`.
8. `export.svg('L')` → parses, contains `width="…mm"`, one `<g data-piece>` per piece instance, path count ≥ 2 per piece (cut + stitch), text includes "Cut 2"; bbox of size L front is ≈ 100/92 × size M width (±1 %).
9. `export.tiledHtml('M','A4')` → page count = ceil(W/190)·ceil(H/277) for the layout bbox; `sizeChartCsv()` has 5 lines.
10. `project.save()` → `project.load()` round-trip deep-equals; `undo()` after a move restores coordinates.
11. `project.loadSample('skirt')` → checks 3 (skirt has waist pins) and also `seamMaxGap_mm < 8`.
12. `ui.popout()` → a second window exists, receives ≥ 1 frame within 2 s (popout posts `{type:'ack', frames}` counted by the main window: `ui.getLayout() === 'popout'`); `closePopout()` restores `'split'`.
13. UI drive: click `#tool-seam`, click two edges on the canvas at known mm→px coordinates, assert `getProject().seams.length` incremented; `#body-chest_cm` input set + `input` event changes `body.getParams()`.

---

## 11. Top risks and mitigations

1. **Delaunay/boundary-recovery bugs produce holes or flipped triangles.** Mitigate: Gabriel-safe sampling (0.6h clearance), midpoint insertion loop, post-validation (every boundary edge present, all triangles CCW, Euler check per piece), and a fallback of `h *= 1.3` retry before failing loudly. A3 ships a visual self-test page (`mesher/selftest.html`).
2. **Sewing explodes** (pieces far apart, zero-length constraints, high mass ratio). Mitigate: progressive rest-length ramp, reduced vMax during the ramp, arrangement clearance 60 mm keeps initial gaps < 25 cm, seam-neighbour self-collision mask, NaN snapshot restore.
3. **Cloth tunnels into the body / jitter on the SDF.** Mitigate: 10 mm grid with 4 mm collision radius and 6 substeps (max displacement per substep ≤ 2 cm but relative to a smooth field); continuous check: if `d` sign flips between `xPrev` and `x`, project to the surface at `xPrev`'s side; penetration stat surfaced in the status bar.
4. **Performance on the main thread stalls the UI.** Mitigate: vertex cap (mesher raises `h` automatically to keep ≤ 8 000 verts), adaptive substeps, sim runs in `requestAnimationFrame` with a 16 ms budget, no allocations in the hot loop (all typed arrays preallocated); the `SimState` design lets a later agent move it into a Worker with `postMessage` transfer.
5. **Bending model too soft/stiff → unconvincing drape.** Mitigate: the table values were chosen for 15 mm edges; `bendCompliance` exposed as a slider so the demo can be tuned live; A5's self-test hangs a 30×30 cm square from two corners and reports sag.
6. **Parallel agents diverge from contracts.** Mitigate: contracts frozen in Phase 0 with JSDoc typedefs and `docs/CONTRACTS.md`; each module's `init(ctx)` signature identical; A9 integrates against the stubs early (hour 2) rather than at the end; the consumer adapts, never the contract.
7. **Polygon offset self-intersections on sharp concave corners (necklines, armholes).** Mitigate: round joins on convex, miter on concave (never overshoots), loop-removal pass; export tests on both samples; worst case the stitch line is still correct and the user can lower seam allowance.
8. **Popout window blocked or loses sync.** Mitigate: opened only from a user click (popup blockers allow it), heartbeat `ack` every second, main window falls back to inline rendering if no ack within 3 s; Swap is the no-risk alternative to Pop-out.
9. **Seam length mismatch creates permanent stretch/wrinkles.** Mitigate: proportional pairing distributes ease; > 15 % mismatch warned in the status bar and seam list; sample garments authored with matched lengths (A0 verifies with the mesher's edge lengths).
10. **Curve editing complexity eats A2's time.** Mitigate: v1 handles are optional; the samples use straight edges plus a few curves (neckline, sleeve head); draw tool produces straight edges only, curves come from Alt-drag on a vertex — one interaction to implement.