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
