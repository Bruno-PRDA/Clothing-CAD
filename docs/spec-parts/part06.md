## 7. Cloth simulation (`src/cloth/`) — agent A4

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

`density_kgm2`, `bend_Nm`, `membrane_Nm`, `friction`, `damping`, `thickness_mm`, `meshSpacing_mm` form `FabricPhysics`; `color, roughness, sheen, sheenRoughness, clearcoat, opacity, texture` form `FabricLook`. The sample garments use `{id:'main', preset:'cotton', color:'#c8102e'}` (T-shirt) and `{id:'main', preset:'denim', color:'#3b5a86'}` (skirt) as their `FabricInstance`.

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
