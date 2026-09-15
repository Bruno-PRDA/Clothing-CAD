## 4. Built-in sample garments (`src/samples/`)

Owner: Lead, Phase 0. Files: `src/samples/tshirt.js`, `src/samples/skirt.js`, `src/samples/index.js`. Pure data literals plus a four-function registry; **imports nothing outside `src/samples/`** (dependency table, section 2). Every other agent tests against these documents, so they are authored fully normalised (every field of every typedef in section 3.1 is present, no defaults left implicit) and they are verified numerically below.

### 4.1 Authoring rules

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
 * Deep clone of a sample ProjectDoc, safe to hand to store.load(). Every call returns a new, unfrozen object
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

Consumers: `src/app/wiring.js` calls `getSample(DEFAULT_SAMPLE_ID)` at start-up and `getSample(id)` from the Samples menu / `__app.loadSample(id)`, always followed by `store.load(normalizeDoc(doc))` (section 3.3); `src/ui/toolbar.js` builds the menu from `listSamples()`. Nobody imports `TSHIRT`/`SKIRT` directly except `index.js` and the tests.

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
