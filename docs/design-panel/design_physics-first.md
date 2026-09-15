# Clothing App — Architecture & Design (v1)

Desktop-style, no-build, vanilla ES2022 web app: 2D pattern editor + XPBD cloth draped on a procedural parametric body. Metres in 3D, millimetres in 2D. Served by `python -m http.server`; three.js 0.180 via import map. Everything else is ours.

---

## 1. Modules, file layout, dependency graph

```
index.html            import map, app shell markup (stable ids), loads src/main.js
viewer.html           pop-out 3D window (loads src/popout/main.js)
styles/app.css
src/main.js           wires modules, installs window.__app
src/core/             SHARED CONTRACTS (written first, then frozen)
  types.js            all JSDoc typedefs (ProjectDoc, Piece, Seam, BodyParams, Fabric, PieceMesh, ClothState, SdfGrid, BodyModel, Landmark...)
  events.js           EventBus: on/off/emit; canonical event names (§1.3)
  store.js            project document holder, mutation API, undo/redo (JSON snapshots), persistence (localStorage autosave, JSON download/upload)
  units.js            MM_PER_M, mmToM(), mToMm(), fmt helpers
  fabrics.js          fabric preset table (§7) + colour utilities
  ids.js              uid(), stable id helpers
src/geometry/         2D math: bezier.js, polygon.js (area, orientation, pointInPolygon, distToPolyline), offset.js (seam allowance), delaunay.js (Bowyer-Watson), remesh.js (outline→PieceMesh), pack.js (shelf packing)
src/pattern/          2D editor: canvas.js (view transform, grid, render), tools/*.js (select, draw, editPoints, seam, notch, grainline, mirror, splitEdge), editor.js (tool manager, selection, hit-testing)
src/body/             params.js (defaults, presets, derived proportions), primitives.js (SDF primitives + smin), skeleton.js (params→primitive list+landmarks), sdfgrid.js (bake, sample, gradient), mesh.js (MarchingCubes → BufferGeometry, fallback primitive mesh), measure.js (tape measure from SDF), index.js (buildBody)
src/cloth/            state.js (typed-array ClothState builder from PieceMesh[] + seams + arrangement), solver.js (step: XPBD substeps), constraints.js (distance/bend/seam/pin kernels), collide.js (SDF collision+friction), selfcollide.js (spatial hash), arrange.js (initial placement), safety.js (clamp, NaN guard)
src/viewer3d/         scene.js (renderer, camera, OrbitControls, lights, grid), clothMesh.js (BufferGeometry mirror of ClothState), bodyMesh.js, materials.js (fabric→MeshPhysicalMaterial, procedural CanvasTexture), loop.js (rAF: step sim → upload positions → render), picking.js (drag vertex = temporary pin)
src/sizing/           chart.js (size table model), grading.js (graded piece outlines)
src/export/           svg.js, printSheet.js (tiled print HTML), csv.js, json.js, download.js
src/ui/               layout.js (split view, divider, swap), panels/{pieces,body,fabric,sizes,export}.js, toolbar.js, statusbar.js, shortcuts.js, popout.js (BroadcastChannel bridge)
src/popout/main.js    stand-alone 3D+sim instance for viewer.html
src/samples/          tshirt.js, skirt.js (ProjectDoc literals), index.js
src/debug/api.js      window.__app implementation
tests/acceptance.js   browser-runnable checks (§10.4), loaded via ?test=1
```

### 1.1 Dependency graph (arrows = imports)
```
core ← geometry ← pattern
core, geometry ← body
core, geometry, body(types only: SdfGrid, Landmark) ← cloth
core, cloth, body ← viewer3d
core, geometry, sizing ← export ;  core, geometry ← sizing
core, + everything ← ui, debug, popout, main
samples ← core only (pure data)
```
`cloth/` must import nothing from three or DOM (Worker-ready). `body/mesh.js` is the only body file touching three.

### 1.2 Shared contracts (write before parallel work; changes require lead approval)
1. `src/core/types.js` — every typedef in §2, plus runtime interfaces:
   - `PieceMesh { pieceId, positions2d: Float32Array /*mm, xy*/, indices: Uint32Array, boundary: Uint32Array, edgeVerts: Uint32Array[] /*per outline edge, ordered start→end*/, notchVerts: Uint32Array, area_mm2 }`
   - `BodyModel { params, sdf: SdfGrid, landmarks: Record<string,Landmark>, anchors: Record<string,Anchor>, measurements: {chest,waist,hips,...}/*cm*/, geometry: {positions:Float32Array, indices:Uint32Array, normals} }`
   - `SdfGrid { origin:[x,y,z], cell:number, nx,ny,nz, data: Float32Array }` + `sampleSdf(grid,x,y,z,out)` writes `out[0]=d, out[1..3]=grad`.
   - `Anchor { origin:[3], axis:[3] /*unit, "down" of piece*/, front:[3] /*unit, θ=0 direction*/, radius:number }`
   - `ClothState` (§5.1), `ClothSimAPI { build(doc, body, meshes), step(dt), reset(), setPin(i,on), stats() }`.
2. `src/core/events.js` — event names: `project:changed {scope}`, `project:loaded`, `selection:changed`, `tool:changed`, `body:built`, `sim:built`, `sim:reset`, `sim:step {frame,ms}`, `sim:nan`, `ui:layout`.
3. `src/core/store.js` — `getDoc()`, `update(mutatorFn, {scope, undoable=true})` (clones doc, applies fn, pushes history, emits), `undo()`, `redo()`, `load(doc)`, `toJSON()`.
4. `src/core/fabrics.js` — preset table (§7).
5. `src/samples/tshirt.js` — the canonical ProjectDoc example; every agent tests against it.
6. `index.html` id conventions: every control `id="ctl-<panel>-<name>"`, `data-action="..."`, `data-tool="..."`.

---

## 2. Data model — ProjectDoc (JSON)

```jsonc
{
  "version": 1, "name": "Basic T-shirt", "baseSize": "M",
  "body": { "preset": "female_m",
    "params": { "height": 1.65, "chest": 88, "waist": 70, "hips": 96, "shoulderWidth": 38,
      "neck": 34, "armLength": 56, "inseam": 76, "torsoLength": 40, "thigh": 54,
      "upperArm": 27, "bust": 0.4, "masculinity": 0.2, "armAbductionDeg": 30 } },   // cm except height(m), bust/masc 0..1
  "pieces": [
    { "id": "front", "name": "Front", "quantity": 1, "mirrorAxis": "x",           // "x": half-piece mirrored about x=0 at mesh time; null = none
      "vertices": [[-240,0],[240,0],[240,-620],[-240,-620]],                     // mm, closed loop, CCW, y up
      "edges": [ {"type":"line"}, {"type":"line"},
                 {"type":"cubic","c1":[200,-660],"c2":[-200,-660]}, {"type":"line"} ], // edge i: vertices[i]→vertices[(i+1)%n]
      "notches": [ {"edge":1,"t":0.5} ],
      "internalLines": [ {"points":[[0,-100],[0,-500]], "kind":"fold"} ],         // decorative in v1
      "grainline": {"origin":[0,-300],"angleDeg":90,"length":200},
      "seamAllowanceMm": 10, "fabricId": "cotton", "color": "#c8102e", "layer": 0,
      "placement": { "anchor": "torso", "side": "front", "offsetMm": [0,-40], "wrap": 0.8, "flip": false },
      "grade": { "x": "chest", "y": "torsoLength", "xAnchor": "center", "yAnchor": "top",
                 "vertexRules": [ {"vertex": 2, "dx": 0, "dy": 0} ] },            // override per size step (mm), optional
      "meshSpacingMm": 15 }
  ],
  "seams": [ { "id": "s-side-r", "a": {"pieceId":"front","edge":1,"reverse":false},
               "b": {"pieceId":"back","edge":3,"reverse":true}, "kind": "sew" } ], // kind: "sew" | "zip"
  "sizes": { "measurements": ["height","chest","waist","hips","shoulderWidth","torsoLength","armLength"],
    "rows": [ { "name":"S", "height":1600, "chest":840, "waist":660, "hips":900, "shoulderWidth":370, "torsoLength":390, "armLength":550 },
              { "name":"M", "height":1650, "chest":880, ... }, { "name":"L", ... }, { "name":"XL", ... } ] },  // mm
  "sim": { "substeps": 10, "gravity": 9.81, "selfCollision": true, "sewTimeS": 1.0, "collisionOffsetMm": 5 },
  "ui": { "split": 0.5, "activeSize": "M" }
}
```
Rules: outlines are simple polygons (no self-intersection), CCW; seams reference whole edges (use Split Edge tool for partial seams); `mirrorAxis` pieces have their mirror seam implied (vertices on x=0 are shared, no seam needed).

---

## 3. 2D pattern editor

**Representation.** Closed loop of vertices; each edge is `line` or `cubic` bezier (absolute control points, mm). Curves keep exact export; simulation and offset use sampled polylines. Bezier arc-length via 32-segment Gauss-free cumulative chord table (`bezier.js: sampleByArcLength(edge, n)` returns n+1 points equally spaced by arc length; also `lengthOf(edge)`).

**Canvas.** `<canvas id="pattern-canvas">`, 2D context, view = {panMm, pxPerMm}; grid 10/50 mm; y-up in mm (flip in transform). Hit-test tolerance 6 px. Rendering order: fill (piece colour 25% alpha), stitch outline, seam highlights (each seam gets a hue; both edges drawn thick with matching colour and small arrow showing direction), notches, grainline, vertices/handles when selected, seam allowance preview (dashed offset).

**Tools** (`data-tool`): `select` (click/drag-box; drag moves pieces; Shift adds), `draw` (click adds vertex, Enter/double-click closes ≥3 verts, Esc cancels; Alt-drag while placing makes the edge cubic), `edit` (drag vertices/handles; double-click edge toggles line↔cubic with handles at ⅓/⅔; click edge with Ctrl inserts vertex; Delete removes vertex), `split` (click on edge at t → splits edge, preserves curve via de Casteljau), `seam` (click edge A → highlighted; click edge B → seam created; orientation auto: reverse chosen so the endpoints closest to each other in the 2D canvas pair up; click a seam to select, `R` toggles reverse, Delete removes), `notch` (click on edge → notch at t; snaps to 0.25/0.5/0.75 with Shift), `grainline` (drag arrow), `mirror` (button: sets `mirrorAxis:"x"` and snaps the two vertices nearest x=0 onto it; or "Duplicate mirrored" makes a new piece). Undo via store snapshots.

**Outline → simulation mesh (`geometry/remesh.js`).** Target spacing h = `meshSpacingMm` (default 15; 12 for silk/chiffon).
1. *Seam-consistent boundary sampling.* For each seam, `n = max(2, round(max(LA, LB)/h))`; both edges get exactly n segments (n+1 points, arc-length uniform). Free edges: `round(L/h)`. Mirror pieces: build the full outline by reflecting, then sample; the x=0 vertices are interior. Result: boundary polyline P (no duplicate corner points; each corner vertex appears once; `edgeVerts[e]` lists indices along edge e).
2. *Interior points.* Hex lattice with spacing h (rows at h·√3/2, alternate rows offset h/2), clipped to `pointInPolygon(P)` and rejected if `distToPolyline(P) < 0.55h`.
3. *Triangulation.* Bowyer-Watson Delaunay on all points (super-triangle; O(n²) is fine, n ≤ 4000). Remove triangles whose centroid is outside P. *Boundary repair:* for each consecutive boundary pair (i,i+1) check the edge exists in the triangle set; if any missing, insert the midpoint into that edge's point list and re-run (max 4 rounds; the 0.55h clearance makes misses rare). Finally drop triangles with area < 0.02h² (slivers), and if any boundary vertex ends up with degree < 2, throw `RemeshError` (UI shows it; piece excluded from sim).
4. Output `PieceMesh`; notch positions map to the nearest boundary vertex.

**Mismatched seam lengths.** Both sides have n+1 vertices paired i↔i (or reversed); rest edge lengths differ, so the longer side gathers when sewn — physically "ease". UI warns when ratio > 1.15 (yellow) and refuses > 1.5 (red, seam still created but flagged).

---

## 4. Parametric body

No assets: an analytic SDF made of primitives placed by a proportion table, baked to a voxel grid for collision and polygonised for display.

**Proportions** (fraction of height H unless a param overrides): top 1.0, chin 0.87, neckBase 0.85, shoulder (acromion) 0.82, chest 0.72, underbust 0.68, waist 0.62, hip 0.52, crotch 0.47, knee 0.28, ankle 0.04; arm lengths upper 0.17H, fore 0.15H, hand 0.10H; biacromial width = shoulderWidth param; `masculinity` blends shoulder/hip aspect and torso ring depth ratios; `bust` scales two breast ellipsoids.

**Primitive list (A-pose; all in m, y up, z toward viewer/front):**
| # | Part | Primitive | Params |
|---|---|---|---|
| 1 | Head | ellipsoid r=(0.075,0.11,0.09)·s | s=H/1.75 |
| 2 | Neck | round cone (capsule with r1=0.055, r2=0.06) chin→neckBase | neck circ |
| 3 | Torso | **superellipse loft**: rings at hip, waist, underbust, chest, shoulder; each ring = (halfWidth a, halfDepth b), exponent n=2.4; a,b interpolated with Catmull-Rom in y; capped with round caps at hip−0.04 and shoulder | chest/waist/hips circ, masculinity |
| 4–5 | Shoulders | spheres r=0.06 at shoulder joints | shoulderWidth |
| 6–7 | Breasts | ellipsoids (0.07,0.06,0.05)·bust, at chest level, ±0.09 x, z=+b_chest·0.7 | bust |
| 8–9 | Buttocks | spheres r=0.10 at hip level, ±0.08 x, z=−0.05 | hips |
| 10–13 | Upper/fore arms | round cones r 0.05→0.04, 0.04→0.03 | upperArm circ, armLength |
| 14–15 | Hands | ellipsoids (0.045,0.09,0.02) | — |
| 16–19 | Thighs/shanks | round cones 0.09→0.06, 0.06→0.045 | thigh circ, inseam |
| 20–21 | Feet | capsules r=0.04 pointing +z, 0.24 long | — |
| 22–23 | Pelvis fill | ellipsoid between hips (0.5·hipWidth, 0.09, 0.9·b_hip) | — |

A-pose: upper-arm direction = down vector rotated 30° (param) outward about z and 5° forward about x; legs 6° apart. This leaves ≥ 8 cm between arm and torso at the armpit so sleeves drape.

**SDFs.** Sphere/ellipsoid/round-cone: Inigo Quilez formulas (ellipsoid: `k0=|p/r|, k1=|p/r²|, d=k0(k0−1)/k1`). Loft: at height y get (a,b); 2D radial distance `d2 = ‖(x,z)‖ − R(θ)`, `R(θ)=(|cosθ/a|ⁿ+|sinθ/b|ⁿ)^(−1/n)`; combine with cap distance `dy=|y−ymid|−halfLen`: `d = min(max(d2,dy),0) + ‖max((d2,dy),0)‖`. Union: polynomial smooth-min `smin(a,b,k)=min(a,b)−h²k/4, h=max(k−|a−b|,0)/k`, k=0.04 for joint pairs (arm–shoulder, thigh–pelvis, neck–torso, breast–torso, buttock–torso), plain min elsewhere.

**Circumference enforcement.** For ring r with preset aspect b/a: perimeter `P(a,b)` by summing 256 samples of the superellipse; set a=b·aspect such that P = target (closed form: scale linearly, P is homogeneous degree 1). Limb circumferences → radius = circ/2π. After baking, `measure.js` re-measures: at y_chest/y_waist/y_hip cast 180 rays in the xz-plane from the torso axis, bisect the grid SDF for the zero crossing (excluding arms by limiting the ray to 1.5·a), sum chord lengths → cm; shown in the Body panel as "actual" next to "target"; if |actual−target| > 1 cm (breasts/buttocks blending), scale the ring by target/actual once and rebake (one correction pass, on release only).

**Baking (`sdfgrid.js`).** AABB of primitives padded 0.10 m; cell 15 mm (≈ 74×130×60 ≈ 580k cells; ~25 primitives → 150–300 ms). During slider drag: cell 30 mm (~30 ms); full-res on pointer-up. Emits `body:built`. `sampleSdf`: locate cell, read 8 corners, trilinear value; gradient analytically from the same 8 values (∂/∂x of the trilinear form), normalised; outside the grid returns d=+1, grad=(0,1,0).

**Visual mesh.** `three/addons/objects/MarchingCubes.js`, resolution 128 over a cube of side 2.0 m centred on the body (15.6 mm voxel); fill `mc.field[i] = −sdf(p)`, `isolation = 0`, `maxPolyCount` 400k; extract once per bake into a static `BufferGeometry` (positions/normals) so the render loop doesn't re-polygonise. Fallback (implement first, day 1): render the primitives directly with `SphereGeometry`/`CapsuleGeometry` scaled — guaranteed to work.

**Presets** (`params.js`): female_s/m/l, male_s/m/l, child_10 — e.g. `female_m {height 1.65, chest 88, waist 70, hips 96, shoulderWidth 38, neck 34, armLength 56, inseam 76, torsoLength 40, thigh 54, upperArm 27, bust 0.4, masculinity 0.2}`, `male_m {1.78, 98, 84, 98, 46, 39, 62, 82, 44, 56, 30, 0, 0.9}`. Presets are just parameter sets; selecting one copies values into `body.params`.

**Landmarks/Anchors** (`Landmark {pos}`; `Anchor` per §1.2): `torso` (origin = neckBase point, axis −y, front +z, radius = a_chest + 0.06), `armL/armR` (origin shoulder joint, axis = bone direction, radius 0.05+0.04), `forearmL/R`, `legL/R` (origin hip joint, axis down the leg), `head`, `waist` (for skirts: origin waist centre, axis −y, radius a_hip+0.06).

---

## 5. Cloth physics (XPBD, small steps)

Design goals: unconditional stability at fixed dt, convincing drape on 3–6k vertices at 60 fps, seam closing that never explodes.

### 5.1 State (`ClothState`, all typed arrays, no allocations in the loop)
```
V verts: pos(3V) prev(3V) vel(3V) invMass(V) restPos(3V, arranged) pieceOf(Uint16 V) layer(Uint8 V)
E edges: eIdx(2E) eRest(E) eAlpha(E)                        // rest in m from 2D
B bends: bIdx(4B) bK(4B) bCoef(B) bAlpha(B)                  // Bergou K vector + 3/(2(A0+A1))
S seams: sIdx(2S) sRest0(S) sStart(S, seconds) sKind(Uint8)  // rest0 = distance at build time
P pins:  pIdx, pTarget(3P)
tris: tIdx(3T) (for normals/render), nbr CSR (for self-collision exclusion)
params: dt=1/60, substeps=10, gravity, damping per piece, mu per piece, offset per layer, time, frame
```
Masses: `m_i = ρ_fabric · Σ_{tri∋i} A_tri/3` (A from 2D rest, m²); invMass = 1/m (0 for pins). Edge constraints are the triangle edges (deduplicated). Bending constraints: one per interior edge (two adjacent triangles). Pieces sharing a seam are separate meshes; seams are constraints, never merged vertices.

### 5.2 Step (`step(dt=1/60)`), substep h = dt/substeps
```
for s in substeps:
  for i: if invMass>0: vel += g·h·gravityRamp; vel *= max(0, 1−c_damp·h); clamp |vel|≤5 m/s; prev=pos; pos += vel·h
  solveDistance(edges)        // 1 Gauss-Seidel pass, permuted fixed order
  solveBending(bends)
  solveSeams(time)
  solvePins()
  collideBody() (+friction)   // §5.5
  if selfCollision && (s%2==0): selfCollide()  // §5.6
  for i: vel = (pos−prev)/h
  time += h
frame++; nanGuard()
```
One iteration per substep (Macklin, Storey, Lu, Macklin 2019: many substeps ≫ many iterations). λ is reset each substep (α̃ = α/h²), i.e. the standard "XPBD without λ accumulation across substeps"; with 1 iteration λ=0 at solve time so `Δλ = −C /(Σ w_i|∇_iC|² + α̃)`. `dt` is fixed; the render loop calls `step()` once per rAF regardless of frame time (deterministic; slow machines slow the sim, never destabilise it).

### 5.3 Constraints
- **Distance:** `C=|x_i−x_j|−L0`, `∇_i=n, ∇_j=−n`. Guard `|x_i−x_j|<1e-9 → skip`.
- **Bending — isometric/quadratic bending (Bergou et al. 2006), justified:** patterns are flat, so the rest bending energy is exactly zero and the model is exact for inextensible surfaces; constraint is quadratic (no atan2, no singularity at flat, unlike the dihedral-angle constraint) and its coefficients are constant, precomputed from the 2D rest mesh: 4 floats per constraint. Cost ≈ that of two distance constraints. For stencil [x0,x1] = shared edge, [x2,x3] = opposite vertices, from rest 2D positions: `e0=x1−x0, e1=x2−x0, e2=x3−x0, e3=x2−x1, e4=x3−x1; c01=cot(e0,e1), c02=cot(e0,e2), c03=cot(−e0,e3), c04=cot(−e0,e4); A0=½|e0×e1|, A1=½|e0×e2|; K=[c03+c04, c01+c02, −c01−c03, −c02−c04]; coef=3/(2(A0+A1))`. Runtime: `L = Σ_i K_i x_i` (3-vector, = 0 when the patch is flat), `C = ½·coef·|L|²`, `∇_i C = coef·K_i·L`, XPBD update with `bAlpha`. Skip constraint if A0+A1 < 1e-10.
- **Seam:** distance constraint with `L(t) = sRest0·(1 − clamp((t − sStart)/T_sew, 0, 1))`, α = 1e-5 (effectively rigid; rest-length ramp — not stiffness ramp — keeps the constraint satisfied at every substep, so sewing is a smooth motion rather than an impulse). `T_sew = sim.sewTimeS` (1.0 s). `kind:"zip"`: pair k of n gets `sStart = k/n · T_sew` (closes progressively from one end). Vertices with pairs on two seams (corners) are handled naturally by two constraints. Pieces are attracted flat-to-flat; layer offsets (§5.5) avoid z-fighting at seams between layers.
- **Pins:** invMass=0, position held at `pTarget` (set from current position; drag-in-3D creates a temporary pin at the pointer's ray/plane intersection).
- **Fabric → compliance:** per piece from `fabrics.js`: `eAlpha = stretchCompliance`, `bAlpha = bendCompliance`, damping `c_damp`, friction μ, ρ. Rationale for stretch values: α = 1/K_membrane (N/m); with h_sub = 1.67 ms, α̃ = α/h² ≈ 3.6e5·α, vertex w ≈ 3e4 (cotton, 15 mm mesh) so α ≈ 1e-4 is ~1% strain under garment weight (woven), 1e-2 is knit-like. A global `__app.sim.setStiffnessScale(k)` multiplies all α for tuning. Anisotropy (warp/weft/bias) is v2: edges could take α by angle to the grainline; slot reserved.

### 5.4 Initial arrangement (`arrange.js`)
Each piece maps its 2D coordinates (relative to piece bbox centre, mm→m) to an anchor cylinder: `θ = θ_side + wrap·(x / R)`, `p = origin + axis·(−y + offsetY) + R·(cosθ·front + sinθ·(axis×front)) + (x·(1−wrap))·(right)`, with θ_side ∈ {front 0, right π/2, back π, left −π/2}, `R = anchor.radius + 0.02·layer`. `flip` mirrors x (for a back piece drawn as seen from outside). This is a cylinder wrap at wrap=1 and a flat plane at wrap=0. Arrangement points are listed in the Pieces panel as a dropdown; the 3D view shows the anchor cylinders as wireframes while a piece is selected. `restPos` stores the arranged positions for reset.

### 5.5 Body collision + friction (`collide.js`)
For each free vertex after the constraint pass: `sampleSdf(grid, pos)` → d, n. Required clearance `r = offset(layer) = collisionOffsetMm + 3·layer (mm→m) + thickness/2`. If `d < r`: `pen = r − d; pos += pen·n`. Friction (Macklin 2014 style): `Δ = pos − prev; Δt = Δ − (Δ·n)n; if |Δt| < μ_s·pen: pos −= Δt (static) else pos −= Δt·min(μ_k·pen/|Δt|, 1)` with μ_s = μ, μ_k = 0.8μ. Broad phase: skip vertices outside the grid AABB. Tunneling is impossible by construction: |vel| ≤ 5 m/s ⇒ ≤ 8.3 mm/substep < thinnest limb (≈ 60 mm). When the body is rebuilt while cloth exists, vertices are pushed out with `min(pen, 5 mm)` per frame (gentle re-projection). Grid resolution 15 mm with trilinear interpolation gives sub-mm surface error on smooth regions; concave creases (armpit, crotch) are smoothed by smin(k=0.04), which also removes SDF gradient discontinuities that cause jitter.

### 5.6 Self-collision (v1: vertex–vertex only)
Uniform spatial hash (cell = 2·r_self, hash = (73856093·ix ^ 19349663·iy ^ 83492791·iz) mod tableSize, CSR-style counting sort into `cellStart/cellEntries` — no per-step allocations). r_self = 0.6·h (9 mm at 15 mm spacing; 4 mm ≤ r_self ≤ 10 mm). For each pair within r_self not in the 1-ring/2-ring exclusion (CSR neighbour list, precomputed) : push apart along their connecting direction by `(r_self − dist)/2` weighted by invMass (standard PBD contact with α=0), plus friction as above with μ. Runs every 2nd substep (≈ 1–2 ms at 5k verts). Vertex–triangle proximity and CCD are v2; a `selfCollision` toggle exists and the sample garments are built so v1 looks right without it (sleeves are separate anchor cylinders; layer offsets keep front/back apart at collars).

### 5.7 Sewing/drape phases & damping
`reset()` → positions = restPos, vel=0, time=0, all seams start at t=0 (zip per-pair delays). Phase "sew" (t < T_sew+0.5): gravityRamp ramps 0→1 over the first 0.5 s, damping ×5, self-collision on. Phase "drape": normal. "Freeze" toggles stepping; "Reset arrangement" re-runs `arrange`. Damping: `c_damp` 0.5–2.5 s⁻¹ per fabric (viscous global; cheap and adequate). Optional in v2: air drag ∝ normal velocity.

### 5.8 Performance budget (desktop Chromium, JS main thread)
T-shirt at h=15 mm ≈ 2.6k verts (front/back ≈ 900 each, sleeves ≈ 400); skirt ≈ 1.5k. Cap: 8k verts total (`meshSpacingMm` auto-raised with a warning if exceeded). Per frame at 5k verts, 10 substeps: distance 15k×10 ≈ 2.5 ms, bending 15k×10 ≈ 3 ms, collision 50k trilinear ≈ 1 ms, self-collision ≈ 1.5 ms, normals+upload ≈ 0.5 ms → ≈ 8–9 ms, target ≤ 10 ms; render ≤ 4 ms. `stats()` reports ms per section; the status bar shows sim ms, verts, fps. Everything in flat typed arrays, closure-free inner loops, Math.hypot avoided (manual sqrt).

### 5.9 Safety
Velocity clamp 5 m/s; per-substep displacement clamp 0.5·h_mesh (applied in the integrate step); `nanGuard()` every frame: if `!isFinite(Σpos)` → emit `sim:nan`, `reset()`, status bar error (counter exposed in stats); guards on zero-length edges, degenerate bending stencils, SDF gradient norm < 1e-6 (use (0,1,0)); mass floor 1e-6 kg; seam `sRest0` ≥ 0; if body grid missing → collision skipped, not crashed.

---

## 6. Sizing, grading & export

**Size chart** (`sizing/chart.js`): editable table (`sizes.rows`), mm, columns from `sizes.measurements` (add/remove columns; body params provide the "M" row by default: chest/waist/hips/height/shoulderWidth/torsoLength/armLength). Selecting the active size in the Sizes panel (a) grades pieces for export/preview and (b) optionally applies the row to body params ("Fit body to size").

**Grading (simple, deterministic):** measurement-driven per-piece axis scaling. For piece p and size k: `sx = row_k[p.grade.x] / row_base[p.grade.x]`, `sy = row_k[p.grade.y] / row_base[p.grade.y]` (missing axis → 1). Scale vertices and bezier control points about the anchor (`xAnchor` center|left|right, `yAnchor` top|center|bottom of the base bbox). Then add `vertexRules` deltas: `Δ = (dx,dy)·(k − k_base)` (size index difference) — used e.g. to hold neckline width. Seam validation: after grading, if seam partner edge lengths differ by > 3% more than in the base size, flag in the Sizes panel. Graded outlines never touch the sim (which always uses the base size and the current body).

**SVG export (`export/svg.js`)**, 1:1: `<svg xmlns width="{W}mm" height="{H}mm" viewBox="0 0 W H">`, y flipped (`transform="scale(1,-1)"` per piece group), 1 user unit = 1 mm. Per piece (per selected size, quantity noted): stitch line as exact path (`M/L/C`, dashed), cut line = offset polygon (solid), notches = 5 mm ticks perpendicular to the edge spanning stitch→cut line, grainline arrow, label (`name — size — Cut ×qty — fabric — SA 10 mm`), 50 mm test square + title block on the sheet. Layout: shelf packing (`pack.js`) of piece bboxes (with SA) into rows on a 900 mm-wide sheet, 20 mm gaps; or one SVG per piece (option). `exportSvg({sizes:['S','M'], layout:'sheet'|'perPiece'}) → string[]`.

**Polygon offset (`geometry/offset.js`)**: sample outline at ≤ 2 mm; CCW polygon; for each edge compute outward normal (right-hand of the direction for CCW), offset segment by d; at each corner: convex → round join (arc sampled every 10°, matches how allowance is cut) with `mitre` option (mitre if the mitre length ≤ 3d), concave → intersection of the two offset lines. Then remove local loops: scan segment pairs (i, j>i+1) with O(n²) segment-intersection (n ≤ 600); on intersection, replace vertices i+1..j with the intersection point; repeat until none. Notches use the same normals.

**Print/PDF (no deps):** `export/printSheet.js` opens a new document (`window.open`, or hidden iframe) with `@page { size: A4; margin: 0 } .page { width:210mm; height:297mm; page-break-after: always; }`; the sheet is tiled into windows of 190×277 mm with 10 mm overlap; each page contains the full sheet SVG inside a clipped `<svg viewBox="x y 190 277" width="190mm" height="277mm">`, plus corner registration marks, page label "r{row}c{col}", and the 50 mm test square on page 1. User prints with Chromium's "Save as PDF" at 100% scale (instructions shown). A4/Letter/A0 selectable.

**CSV/JSON:** `exportSizeChartCsv()` → header row = name + measurements, one row per size (mm; option cm); `exportProjectJson()` → the ProjectDoc pretty-printed; `download.js` uses Blob + `<a download>`. All export functions return strings (automation-friendly) and the UI wraps them in downloads.

---

## 7. Fabric presets & colours (`core/fabrics.js`)

| id | ρ kg/m² | α_stretch m/N | α_bend | μ | damping s⁻¹ | thickness mm | roughness | sheen | extra | default colour |
|---|---|---|---|---|---|---|---|---|---|---|
| cotton | 0.15 | 2e-4 | 5 | 0.35 | 1.0 | 0.4 | 0.85 | 0 | — | #d9cbb1 |
| denim | 0.40 | 5e-5 | 0.5 | 0.45 | 1.5 | 0.9 | 0.9 | 0 | twill texture | #3b5b8c |
| silk | 0.05 | 3e-4 | 60 | 0.15 | 0.6 | 0.15 | 0.35 | 0.6 | sheenColor #fff | #c9a7d6 |
| jersey | 0.20 | 3e-3 | 20 | 0.40 | 1.2 | 0.6 | 0.8 | 0.1 | knit texture | #888e99 |
| wool | 0.30 | 1.5e-4 | 2 | 0.50 | 1.5 | 1.2 | 0.95 | 0.2 | — | #6b5d4f |
| leather | 0.90 | 1e-5 | 0.05 | 0.60 | 2.5 | 1.2 | 0.5 | 0 | clearcoat 0.3 | #3a2a20 |
| chiffon | 0.03 | 5e-4 | 300 | 0.20 | 0.5 | 0.1 | 0.5 | 0.3 | opacity 0.65, transparent | #e8d4e0 |

Bend compliance is dimensionless relative to the §5.3 formulation at h_mesh=15 mm (scale by (h/15)² when spacing changes — done automatically in `state.js`). Piece `color` overrides the fabric default; optional `color2` for patterns.

**three.js:** `MeshPhysicalMaterial({ color, roughness, metalness:0, sheen, sheenRoughness:0.5, sheenColor, clearcoat, transparent, opacity, side: DoubleSide })`, `flatShading:false`, normals recomputed each frame (`computeVertexNormals`). UVs = piece 2D coords / 100 mm (texture aligned with the pattern grain). Procedural textures (`materials.js`, 512² `CanvasTexture`, RepeatWrapping): `solid`, `stripes(width,color2)`, `gingham`, `twill` (45° lines, denim), `knit` (fine sinusoidal rows, jersey), `dots`. Pattern choice per piece: `texture: {kind, scaleMm, color2}` (optional field). Body material: MeshStandardMaterial #c9a58a, roughness 0.8. Lighting: hemisphere + directional with shadow (2048 map), ground grid.

---

## 8. UI layout

CSS grid: `toolbar (44px) / main / statusbar (24px)`; main = `[pane-left] [divider 6px] [pane-right] [dock 300px]`. Default left = 2D editor (`#pane-2d`), right = 3D (`#pane-3d`); `data-layout="2d-3d|3d-2d|2d-only|3d-only"`. Divider: pointerdown/move on `#divider` sets `--split` (persisted `ui.split`); double-click resets to 0.5. `Tab` swaps panes. Both canvases use `ResizeObserver`.

**Toolbar:** file (New, Open JSON, Save JSON, Samples ▾), edit tools (data-tool buttons), sim (Play/Pause `#ctl-sim-play`, Reset `#ctl-sim-reset`, Sew again, Self-collision toggle), view (Swap, Pop-out 3D `#ctl-popout`, Frame).
**Dock tabs:** Pieces (list, name, qty, mirror, placement anchor/side/wrap/offset, layer, mesh spacing, fabric, colour), Body (preset select, sliders for each param with numeric inputs, "actual" measurements readout, rebuild button), Fabric/Colour (preset gallery applied to selected pieces, colour picker, texture kind), Sizes/Export (size table editor, active size, grade axes per piece, export buttons: SVG sheet, SVG per piece, Print tiles, CSV, JSON).
**Status bar:** tool hint, cursor mm coords, selection info, sim: state/frame/ms/verts, warnings.

**Pop-out 3D:** `viewer.html` runs a full viewer3d+cloth+body instance (`src/popout/main.js`). Bridge = `BroadcastChannel('clothing-app')`: main sends `{type:'doc', doc}` on every `project:changed` (debounced 100 ms) and `{type:'sim', cmd:'play'|'pause'|'reset'|'step', n}`; pop-out sends `{type:'hello'}`, `{type:'stats'}`. While popped out, main switches to `2d-only` and its own 3D loop pauses; closing the pop-out (`unload` message) restores. Same code paths ⇒ same behaviour; automation stays in-window (pop-out is optional for verification).

**Shortcuts:** V select, P draw, E edit points, X split edge, S seam, N notch, G grainline, M mirror, R reverse seam, Delete, Ctrl+Z/Ctrl+Y, Ctrl+S save JSON, Ctrl+O open, Space play/pause, Shift+R reset sim, F frame, Tab swap, 1–4 dock tabs, Esc cancel tool.

---

## 9. `window.__app` automation API (`src/debug/api.js`)

```
__app.version
__app.store            // getDoc(), update(fn), undo(), redo(), load(doc), toJSON()
__app.loadSample(name: 'tshirt'|'skirt')
__app.loadProject(json: string|object) ; __app.saveProject(): string
__app.pattern: { setTool(name), select(ids[]), addPiece(piece), movePiece(id, dx, dy), setVertex(id, i, x, y),
                 addSeam(pieceA, edgeA, pieceB, edgeB, reverse), removeSeam(id), remesh(pieceId?) → PieceMesh[], getMeshStats() }
__app.body:    { setPreset(id), setParam(name, value), setParams(obj), getParams(), rebuild(), getMeasurements(),
                 sdf(x,y,z) → {d, n}, getLandmarks() }
__app.sim:     { build(), reset(), play(), pause(), step(n=1), getState() → ClothState (live refs), stats(),
                 setSelfCollision(b), setStiffnessScale(k), maxPenetrationMm(), seamGapsMm() → {max, mean},
                 hasNaN(), setPin(vertex, on), setSubsteps(n) }
__app.sizes:   { setActive(name), setCell(name, key, mm), addSize(name), removeSize(name), gradedOutline(pieceId, size) }
__app.export:  { svgSheet(opts) → string, svgPerPiece(opts) → string[], sizeChartCsv() → string, projectJson() → string,
                 printHtml(opts) → string, offsetPolygon(points, d) → points }
__app.fabric:  { setFabric(pieceId, fabricId), setColor(pieceId, hex), presets() }
__app.ui:      { setLayout(mode), setSplit(f), openPanel(name), popout(), closePopout() }
__app.events   // the EventBus (on/off) ; __app.log: last 200 status/warning messages
__app.runAcceptance() → Promise<{pass, results[]}>   // tests/acceptance.js
```

---

## 10. Build order & agents

**Phase 0 — Lead (before parallel work, ~1 h):** `index.html` skeleton with all ids/layout stubs, `styles/app.css`, `src/core/*` (types, events, store, units, fabrics, ids), `src/samples/tshirt.js` + `skirt.js` (hand-authored ProjectDocs: T-shirt = front (mirror x), back (mirror x), sleeve ×2, 6 seams: 2 shoulder, 2 side, 2 sleeve-cap + 2 underarm; skirt = front/back panels + waistband, 3 seams), `src/main.js` stub that loads modules behind `try/catch` so partial integration runs, `src/debug/api.js` skeleton with TODO throws. Freeze contracts.

**Phase 1 — parallel (8 agents):**
| Agent | Owns | Needs from contracts | Deliverable check |
|---|---|---|---|
| A1 Geometry | `src/geometry/` | Piece/Edge types, PieceMesh | `remesh(tshirt.front)` → ~900 verts, all boundary edges present, no sliver tris; `offset` on a concave test polygon has no loops |
| A2 Pattern editor | `src/pattern/` | store, events, geometry API names (bezier sampling, hit-test) | draws sample, all tools work via `__app.pattern` |
| A3 Body | `src/body/` | BodyParams, BodyModel, SdfGrid, Anchor | `buildBody(female_m)` < 400 ms; `sdf` at chest centre < 0; measured chest within 1 cm of target |
| A4 Cloth | `src/cloth/` | ClothState, PieceMesh, SdfGrid+sampleSdf, Anchor, fabrics | a 40×40 test sheet hangs from 2 pins stably 600 steps; a sheet on a unit-sphere SDF has penetration < 2 mm |
| A5 Viewer3D | `src/viewer3d/` | ClothState layout, BodyModel.geometry, fabrics | renders body + a dummy cloth state at 60 fps; materials for all 7 fabrics |
| A6 Sizing+Export | `src/sizing/`, `src/export/` | Piece, sizes, geometry.offset/bezier/pack | SVG opens in a browser at correct mm size; CSV round-trips |
| A7 UI shell | `src/ui/`, `src/popout/`, `viewer.html` | events, store, all module entry names | layout/divider/swap/pop-out/shortcuts/panels bound to store |
| A8 Integration/QA | `src/main.js`, `src/debug/api.js`, `tests/acceptance.js` | everything | acceptance suite passes |

A4 and A3 agree on `sampleSdf` in `core/types.js` (A3 implements; A4 develops against an analytic sphere-grid stub). A4 ships `cloth/testfields.js` (sphere SDF grid) so it never blocks on A3.

**Phase 2 — Integration (A8 + lead):** wire `main.js` (load sample → remesh → buildBody → sim.build → viewer), run acceptance, fix contract violations (only lead edits `core/`). Then A2/A5/A7 polish while A4 tunes fabrics.

**Acceptance checklist (`__app.runAcceptance()`, each returns pass/fail with numbers):**
1. `loadSample('tshirt')`; remesh all pieces: every piece has ≥ 200 verts, every seam pair has equal vertex counts, no NaN in positions2d, every boundary edge appears in exactly one triangle.
2. `body.setPreset('female_m'); rebuild()`; measurements chest/waist/hips within ±1.5 cm of params; `sdf` at chest centre < −0.05; at (1,1,1) > 0.3.
3. `sim.build(); sim.step(300)`: `hasNaN()==false`; `maxPenetrationMm() < 5`; `seamGapsMm().max < 8` after step 300 (T_sew=1 s = 60 steps); max |vel| < 5 m/s; mean vertex y after 300 steps > y at hip landmark (shirt hasn't slid off).
4. `sim.step(600)` more: max per-frame drift of centre of mass < 1 mm/frame (rested); stats.ms < 16 average at ≤ 5k verts.
5. `body.setParam('chest', 100); rebuild(); sim.step(120)`: no NaN, penetration < 5 mm, seams still < 8 mm.
6. `loadSample('skirt')` → same as 3 with waistband pins: waistband mean y within 2 cm of waist landmark.
7. Fabric switch: set all pieces to `silk`, step 300, no NaN; to `leather`, step 300, no NaN.
8. Export: `svgSheet()` parses with `DOMParser` without errors, width attribute ends in `mm`, contains one `<path>` per piece stitch line and one cut polygon; `sizeChartCsv()` has 5 lines (header + 4 sizes); `projectJson()` round-trips through `loadProject` deep-equal.
9. Grading: S front-piece bbox width / M width ≈ 840/880 ± 0.5%.
10. UI: all `#ctl-*` ids from a fixed list exist; `setLayout('3d-2d')` swaps DOM order; keyboard `Space` toggles `sim.stats().running`.
11. Self-collision toggle on/off both give no NaN over 300 steps.

---

## 11. Top risks & mitigations

1. **Triangulation failures on curved/concave pieces** → boundary clearance 0.55h + midpoint-insertion repair; deterministic test corpus (T-shirt sleeve cap, skirt); `RemeshError` isolates a piece instead of breaking the sim.
2. **Seam sewing instability / pieces flipping through the body** → rest-length ramp (no impulses), gravity ramp, 5× damping during sew, collision active from step 0, arrangement radius ≥ body radius + 6 cm, velocity clamp.
3. **Penetration/jitter at concave body regions (armpit, crotch)** → smin blending, 15 mm grid + trilinear gradient, 5 mm offset, gentle re-projection on body change; acceptance check #3/#5 quantifies.
4. **JS performance** → typed arrays, 1 iteration × 10 substeps, vertex cap 8k, self-collision every 2nd substep, per-section timers; Worker migration path kept open (cloth has no DOM/three imports).
5. **three MarchingCubes quirks (isolation sign, poly cap, normals)** → primitive-mesh fallback implemented first; MC is an upgrade, toggled via `body.useMarchingCubes`.
6. **Bending sign/convention errors** → unit test: flat patch gives C=0; bent patch gives C>0 and the projection reduces |L|; if the agent's cot convention flips the sign, flip `coef` (C must be ≥ 0).
7. **Contract drift between 8 agents** → `core/` frozen after Phase 0; only lead edits; A8 runs acceptance continuously; every module exports an `index.js` with exactly the functions named in types.js.
8. **Grading breaks seam consistency** → measurement-axis rules shared by seam partners + 3% validation warning; v1 samples verified for S–XL.
9. **Print scale wrong** → 50 mm test square on page 1, `@page margin 0`, explicit `width="…mm"`; instructions to print at 100%.
10. **Pop-out complexity** → optional feature; "swap" always available; pop-out re-uses the same modules with a message bridge only, no per-frame streaming.
11. **Ease/gathering on mismatched seams looks bad** → warn at 1.15 ratio; sample garments designed with matched lengths (≤ 3% ease on sleeve cap).