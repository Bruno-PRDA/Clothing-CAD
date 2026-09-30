# Darts and a fitted dress — design

*Date: 2026-09-30. Roadmap item 1 (`docs/ROADMAP.md`). Status: approved in conversation, awaiting written review.*

## 1. Goal

A fashion designer can shape a garment with **darts** and see them work: sewn shut in 3D, taking in the
waist, printed and exported correctly. This is proven end to end by a new built-in sample, a **sleeveless
fitted dress with a waist seam**.

Decisions already taken:

* The audience is fashion designers, and the first goal is "make any garment".
* The first garment is a waist-seam dress. Every dart opens onto an edge, so the mesher needs no holes, and
  there are no sleeves, so there are no arm collisions.
* Darts are modelled as **objects on a piece, applied when meshing** ("model B"). The alternatives were a tool
  that cuts a V into the outline ("A") and holes cut out of the mesh ("C"). C remains the route to darts pointed
  at both ends, roadmap item 7.

### In scope

The data model, geometry, simulation, editor tool and panel, grading, SVG/print/CSV/DXF export, DXF import, the
dress sample, the tests, the SPEC amendment, CONTRACTS.md, the in-app guide, and the README picture.

### Out of scope (on the roadmap)

* Darts pointed at both ends (fish-eye darts), and darts that do not reach an edge.
* Dart caps (the peaked cut line across a dart mouth).
* Pivoting or transferring darts, and per-size dart widths.
* Facings, sleeves, and seams across several edges.
* A fit check for the skirt part of a dress (the fit check only looks at torso panels, as today).

## 2. Process

`docs/SPEC.md` is the single source of truth. Work happens in this order:

1. Write the SPEC amendments of section 11 below, with a dated line on SPEC's "Status" line.
2. Change `src/core/` (`types.js`, `schema.js`, `events.js`).
3. Change the modules, each keeping its self-test green.
4. Update the acceptance suite.

Contracts change only through that route, and the consumer adapts to the contract as written.

## 3. Data model

### 3.1 `Dart` (new typedef in `src/core/types.js`)

```js
/**
 * A dart that opens onto an outline edge. The outline itself stays undarted: the V is cut in when the piece
 * is meshed, and its two legs are sewn together.
 * @typedef {Object} Dart
 * @property {string} id        unique within the piece (uid('dart'))
 * @property {number} edge      outline edge index the dart opens onto; never the fold edge
 * @property {number} t         arc-length fraction of the mouth's centre along that edge, strictly inside (0, 1)
 * @property {number} width_mm  intake, measured as arc length along the edge; > 0
 * @property {Vec2} apex        the dart point, mm, strictly inside the piece
 */
```

`Piece` gains `@property {Dart[]} darts` (default `[]`).

**Geometry of a dart.** Let `L` be the edge's arc length and `c = t·L`.

* The **mouth points** are the edge points at arc lengths `c − width/2` (point **A**) and `c + width/2`
  (point **B**), in the edge's direction of travel.
* The **legs** are the straight segments A→apex and B→apex.
* The **sewn length** of an edge is `L − Σ width` over the darts on that edge.
* The **length** of a dart is the distance from the mouth centre (the edge point at `c`) to the apex.

### 3.2 Document version

* `DOC_VERSION` becomes **2**.
* `migrate()` turns a v1 document into v2 by giving every piece `darts: []`. v0 migration is unchanged and then
  continues to v2.
* A version greater than 2 throws `UnsupportedVersion`, as today.
* `normalizeDoc` defaults `darts` to `[]`. `serializeDoc` sorts dart keys like every other object, so round trips
  stay byte-identical.
* All three samples declare `version: 2`.
* Autosaved v1 records restore through `migrate`.

### 3.3 Validation

`validateDarts(piece)` lives in `src/geometry/darts.js`. It is called by `validateShape` and by the pattern
editor's `validate()`. Its error codes:

| Code | Level | Condition |
|---|---|---|
| `DART_EDGE` | error | `edge` is out of range or is the fold edge |
| `DART_MOUTH` | error | the mouth is not inside the edge with at least 2 mm to spare at each corner: `c − w/2 < 2` or `c + w/2 > L − 2` |
| `DART_WIDTH` | error | `width_mm` is not finite or is < 1 |
| `DART_APEX` | error | the apex is not inside the undarted outline, or is within 1 mm of it |
| `DART_CROSSES` | error | a leg meets the outline anywhere but its own mouth point, or meets another dart's leg or wedge |
| `DART_OVERLAP` | error | two mouths on the same edge overlap or are closer than 2 mm |
| `DART_NOTCH` | warn | a notch lies inside a dart mouth; the notch is ignored when meshing and exporting |
| `DART_ID` | error | duplicate dart id within a piece |

The mesher **ignores a dart that fails validation**. It meshes the piece without that dart and adds a line to
`PieceMesh.warnings`, so one bad dart never stops the simulation.

## 4. Geometry (`src/geometry/`)

### 4.1 `darts.js` (new, pure)

| Export | Returns |
|---|---|
| `dartMouth(piece, dart)` | `{a: Vec2, b: Vec2, ta, tb}` — mouth points and their arc-length fractions on the edge |
| `sewnLength(piece, edge)` | `L − Σ width` of the valid darts on that edge |
| `edgeToSewn(piece, edge, t)` | the sewn fraction `u` of an edge point outside every mouth |
| `sewnToEdge(piece, edge, u)` | `[t]`, or `[tA, tB]` when `u` is exactly a mouth of this edge (A first) |
| `applyDarts(piece)` | the **derived piece**: the outline with each valid dart's V cut in, plus a map from derived edges back to `{edge, from, to}` or `{dart, leg: 'a'\|'b'}` |
| `validateDarts(piece)` | `Issue[]` (section 3.3) |

A cubic edge is split at the mouth points exactly, by de Casteljau subdivision, so the derived outline follows
the original curve.

### 4.2 Seam sampling by sewn length (`remesh.js`)

`seamSampleFractions` works in **sewn fractions** `u ∈ [0, 1]` instead of edge fractions.

* **Count.** `n = max(2, ceil(max L_sewn,i / h_i))` over the connected component of seamed edges. A free edge
  uses `max(1, ceil(L_sewn / h))`.
* **Forced samples.** Every mouth of every edge in the component is a forced sample, at its sewn fraction,
  mapped through the pairing (`u ↦ 1 − u` for each reversed link). Notches are forced samples exactly as today,
  converted to `u`.
* **Uniform fractions** within `0.35/n` of a forced sample are dropped, as notch fractions are today.

The mesher turns each `u` back into points on the edge with `sewnToEdge`:

* one vertex for an ordinary `u`, or for a partner's mouth;
* **two** vertices (A, then B) for a mouth of this edge.

The legs are sampled uniformly with `m = max(2, ceil(max(|A − apex|, |B − apex|) / h))` segments each. Both legs
end at one shared apex vertex.

### 4.3 `PieceMesh` additions (`types.js`)

* `edgeVerts[mirror][e]` keeps the **original** edge numbering. On a darted edge it lists one extra vertex per
  dart (A and B both appear), in order from the edge's start to its end.
* **New** `edgeFrac: Float32Array[][]`, parallel to `edgeVerts`: the sewn fraction `u` of each listed vertex.
  A and B of one dart carry the same `u`.
* **New** `dartVerts: {a: Uint32Array, b: Uint32Array}[][]`. `dartVerts[mirror][k]` gives the vertices of dart
  `k`'s legs from its mouth to the apex. Both lists have `m + 1` entries and end at the same apex vertex. An
  invalid (ignored) dart gets empty arrays. For a non-fold piece `dartVerts[1]` is `[]`.
* Fold pieces: the derived half is mirrored as today, so darts on the stored half appear on the mirrored half
  too.

## 5. Simulation (`src/cloth/state.js`)

**Seam pairing by fraction.**

1. Walk both sides' `edgeVerts` lists together, by `u`. On a reversed seam, side b is read backwards with
   `u ↦ 1 − u`.
2. At equal `u` (within 1e-6):
   * one vertex on each side forms a pair;
   * a mouth (two vertices) against one vertex pairs **both** with it;
   * a mouth against a mouth pairs A↔A′ and B↔B′ in walk order.
3. A walk that finds a `u` on one side with no match on the other throws `seam-parity`, as unequal counts do
   today.

**Dart seams.** For every dart of every simulated piece and mirror, `dartVerts.a[i]` pairs with `dartVerts.b[i]`.
The shared apex pair is skipped by the existing `gi === gj` rule. Dart pairs are appended to `sIdx` after the
seam pairs, so they get the same sewing ramp, self-collision exclusions, seam mask, gap statistics and tear
detection.

`ClothState` and `SimStats` do not change shape.

## 6. Editor (`src/pattern/`, `src/ui/`)

### 6.1 Dart tool — `tools/dart.js`, key `T`, button `#tool-dart` ("Dart", title "Dart (T)")

States: `IDLE`, `DRAG_APEX`, `DRAG_END`, `DRAG_MOUTH`.

**Clicking an outline edge** adds a dart. The mirrored half and the fold edge are not clickable.

* The dart is centred at the clicked `t`, 20 mm wide, with its apex 80 mm inward along the edge's inward normal
  at that point.
* If that dart is invalid, the length is shortened in 10 mm steps down to 20 mm. If it is still invalid, the
  width is halved once to 10 mm and the lengths are tried again.
* If nothing fits, nothing is added and the status bar says *"No room for a dart here."*
* A successful add is one undo step (`dart:add`) and selects the new dart.

**Handles on the selected dart** (the hit kinds `dartApex`, `dartEnd` with `end: 'a'|'b'`, and `dartMouth`):

* **apex** — drag anywhere;
* **either mouth point** — drag along the edge; the width changes symmetrically about the centre;
* **mouth centre** — drag along the edge; `t` changes.

Drags work like other tools:

* The drag previews through `transient()`, drawn in the error colour while invalid.
* Pointer-up commits one undo step (`dart:move`) only if the result is valid. Otherwise the drag reverts and the
  status bar says why.
* `Esc` cancels the drag. `Delete` removes the selected dart (`dart:delete`).

Dart handles take hit-test priority after vertex handles and before notches.

`Selection` gains `dart: {pieceId, index} | null`, like `notch`. `ToolName` gains `'dart'`.

### 6.2 Drawing (`render2d.js`)

* The two legs in `STYLE.internalDart`.
* The wedge filled at 15 % opacity.
* A drill-hole mark: a 2 mm circle with a cross, 10 mm back from the apex along the dart's centre line.
* Ticks where the legs meet the edge.
* Handles when the dart is selected.
* On a fold piece, the mirrored half's darts are dashed, like the rest of that half.

### 6.3 Pieces panel (`ui/panels/pieces.js`)

A **Darts** list for the selected piece. Each row shows the edge label or index and four numeric fields:

* **position** — mm from the edge start to the mouth centre, along the edge;
* **width** (mm);
* **length** (mm);
* **angle** (degrees; 0 = along the inward normal at the mouth centre; positive turns toward the edge's end).

A valid edit commits one undo step. An invalid one marks the field and reverts. Each row has a delete button.

### 6.4 Other tools

* **Split edge.**
  * Darts wholly on one side of the split point move to that half, with `t` remapped by arc length (as notches
    are). Edge indices after the split shift, as for notches and seams.
  * A split point inside a mouth is refused: *"Split point is inside a dart."*
* **Deleting a vertex or an edge** drops the darts on the edges that disappear, as it already drops their seams.
  Undo restores them.
* **Moving a vertex or control point** keeps darts as they are. An edit that makes one invalid is committed, and
  `validate()` reports it. Its behaviour is the same as for any other invalid geometry today.
* **Reflect (mirror)** mirrors apexes and remaps each dart's edge and `t` the same way it remaps notches.
* **Duplicate** copies darts with new ids.

### 6.5 Sewn length wherever seam lengths are compared

* `pattern/seams.js` `seamLengths` and `seamEase` (the editor's ease readout).
* `sizing/grading.js` `seamEaseDrift`.
* `export/csv.js` piece measurements: per-edge rows report **sewn** length in the length and partner-length
  columns, and ease uses sewn lengths. The piece total row keeps the raw outline length. Columns are unchanged.
  An edge without darts reads exactly as today.
* `sizing/fit.js` `checkFit` is **unchanged**. It compares each panel's widest point with the body's largest
  girth, and bust and waist darts do not take in fabric there.

## 7. Grading (`src/sizing/grading.js`)

For each dart, grading:

* keeps `t` (as it keeps notch `t`);
* moves `apex` with the piece's grading transform (as grainlines and internal lines move);
* keeps `width_mm` the same in every size;
* applies no per-vertex grade rule to the apex.

## 8. Export

The fabric inside a dart is folded, not cut away, so **cut and stitch lines follow the undarted outline**.

### 8.1 SVG and print (`svg.js`, `sheet.js`, `print.js`)

Each dart is drawn as:

* its two legs, stroked as stitch lines;
* one notch at each leg's mouth point on the cut line;
* a drill-hole mark 10 mm back from the apex along the centre line.

### 8.2 DXF-AAMA export (`dxf/aama.js`)

Per dart:

* the legs as one open polyline (A → apex → B) on **layer 8** (internal lines);
* the drill hole as a `POINT` on **layer 13**;
* a notch at each mouth point on **layer 4**, written like other notches.

Fold pieces are written whole, so mirrored darts are written too.

### 8.3 DXF-AAMA import

A layer-8 open polyline of exactly three points is recognised as a dart when:

* both ends lie within 0.5 mm of the sew line (or of the cut line, when the piece has no sew line);
* both ends are on the same edge after the curve fit;
* a layer-13 point lies within 15 mm of its middle point.

Recognised darts become `Dart` records, and their mouth notches are not also imported as notches. Every other
internal line stays an internal line. Exporting and re-importing returns every dart within 0.1 mm.

## 9. The dress sample (`src/samples/dress.js`, "Fitted dress")

It is drafted for body `female_m` at size M (bust 88, waist 70, hips 96 cm), with ease +6 / +3 / +5 cm. It is
pure data in the same form as `tshirt.js` and `skirt.js`, and is listed in `samples/index.js` and in the sample
menu as `dress`.

### 9.1 Pieces

| id | Fold | Placement | Darts |
|---|---|---|---|
| `bodice_front` | centre front | torso, front | bust dart into the side edge, apex 20 mm short of the bust point; waist dart into the waist edge directly below the bust point, apex 20 mm below it |
| `bodice_back_l`, `bodice_back_r` | — | torso, back, either side of centre back | waist dart |
| `skirt_front` | centre front | skirt, front | waist dart |
| `skirt_back_l`, `skirt_back_r` | — | skirt, back, either side of centre back | waist dart |

The `_r` pieces are mirrored duplicates of the `_l` pieces: `exportHidden: true`, `cutQty: 2` on both, and
`placement.flip: true` on `_r`. That is how the T-shirt defines its two sleeves.

* Edges carry labels (`shoulder`, `neck`, `armhole`, `side`, `waist`, `hem`, `cb`, `fold`).
* The bodice back's centre-back edge is labelled `zip`, with a double notch where the zip ends.

### 9.2 Seams

Front ↔ back, on both sides of the body, using the front's mirrored half for the other side:

* shoulders;
* bodice sides;
* skirt sides;
* the waist: `bodice_front` ↔ `skirt_front` (both halves), and each `bodice_back_*` ↔ its `skirt_back_*`.

Also the centre-back seams `bodice_back_l` ↔ `bodice_back_r` and `skirt_back_l` ↔ `skirt_back_r`.

* Every seam is `kind: 'plain'`. The zip is a closed seam in the simulation.
* The neckline, armholes and hem are free edges.
* No edge is pinned: the dress hangs from the shoulders.

### 9.3 Grading, fabric and sizes

* **Grading:**
  * bodice pieces: `widthRef: 'chest_cm'`, `lengthRef: 'torsoLength_cm'`;
  * skirt pieces: `widthRef: 'hips_cm'`, `lengthRef: 'height_cm'`;
  * the waist corners of all six panels carry per-vertex rules with `ref: 'waist_cm'`, `refAxis: 'x'`, so both
    sides of the waist seam grade with the waist.
* **Fabric:** cotton, a single instance `main`.
* **Size chart:** the same S–XL rows as the other samples.

### 9.4 Drafting targets

Checked by the tests in section 10:

* For every seam, the two sides' sewn lengths agree within 3 % at size M, and within 1 % ease drift at S, L and
  XL.
* Each bodice panel's waist intake equals its skirt panel's (the darts line up across the waist seam, as is
  usual). Removing every dart then leaves the waist seam matched, which check 26h relies on.
* Mesh estimate: 4 500 to 7 000 vertices at 15 mm spacing, under the 8 000 cap.

## 10. Tests

### 10.1 Self-tests

| Module | New self-tests |
|---|---|
| core | v1 → v2 migration adds `darts: []`; a v2 document round-trips byte-identical; version 3 throws `UnsupportedVersion` |
| geometry | mouth points on a straight and on a cubic edge (on the curve within 0.01 mm); `applyDarts` outline simple and CCW; each code of section 3.3 triggered by its own fixture; a **20 × 100 mm dart** meshes with `pctAbove20 ≥ 98`, boundary edges exactly once, equal leg counts; seam sampling with darts on one side and on both sides gives equal `u` sets and one extra vertex per own mouth |
| cloth | with gravity 0 and no body contact, a 200 × 300 mm rectangle with a 30 × 120 mm dart sews shut (all dart pairs < 2 mm apart at frame 120) and stops being flat (out-of-plane spread of its vertices > 10 mm); two darted rectangles sewn along their darted edges close (< 2 mm) |
| pattern | tool click adds a valid dart at the clicked `t`; apex drag commits when valid and reverts when not; split outside a mouth remaps `t`, split inside is refused; reflect and duplicate carry darts; delete removes; `validate()` reports each error code |
| sizing | graded dart keeps `t` and width, and its apex equals the grading transform of the base apex; a darted edge against an undarted edge of the same sewn length reads 0 % ease; the dress's seam drift is ≤ 1 % at every size |
| export | the dress's SVG sheet contains each dart's legs, drill hole and mouth notches; the cut polygon equals the undarted outline's cut polygon |
| dxf | the dress exports darts on layers 8, 13 and 4; export → import returns every dart within 0.1 mm and no extra notches or internal lines |

### 10.2 Acceptance (`tests/acceptance.js`)

**26g `dress_drape`.**

1. Load `dress`, reset, and step 300 + 240 + 60 frames, as `drape_tshirt` does.
2. Check the same bars as the T-shirt and skirt: `nanCount 0`, `maxPenetration_mm < 5`, `seamGapMax_mm < 8`,
   `seamGapMean_mm < 3`.
3. Also check that **every dart pair is closed to < 3 mm**. This is read from `__app.sim.state()` and
   `__app.mesh.get(id).dartVerts`.

**26h `dart_shaping`.** This proves the darts shape the dress.

1. Reuse 26g's drape, the way `drape_rest` (09) reuses `drape_tshirt` (08). If 26g did not run, drape as 26g
   does.
2. Measure the mean distance to the body of the bodice's vertices in the waist band (the waist ring ± 30 mm).
3. Remove every dart from the document and drape again (300 + 240 + 60 frames).
4. The darted dress must sit closer by at least `0.5 × I / 2π`, where `I` is the bodice's total waist intake
   around the whole body. A fold piece's dart counts twice. That is half the radius the darts remove, so the
   threshold follows from geometry, not tuning.

**Extended checks.** `json_roundtrip`, `export_svg` and `dxf` (26f) also run on the dress, and any check that
lists the built-in samples expects three.

**Runtime budget.** Check 27 (`runtime`) limits the whole suite to 90 s. The two new drapes of about 6 000
vertices add roughly 20–40 s depending on the machine.

* The limit is raised by the measured cost of 26g + 26h on the reference laptop, rounded up to the next 10 s.
* As SPEC 14.4 rule 3 requires for any threshold change, the reason is recorded in the check's details string.

**CI.** No new expected failures. Both new checks get timeouts sized like `drape_tshirt`'s, times the CI
timeout scale.

## 11. Documentation

### 11.1 SPEC.md amendments

Each is a `> **Amendment (lead, YYYY-MM-DD) — Darts.**` block in its section, dated the day it is written:

* §3.1 (`Dart`, `Piece.darts`, `PieceMesh.edgeFrac` / `dartVerts`);
* §3.2 (Selection, ToolName);
* schema / `DOC_VERSION`;
* §4 (dress sample);
* §5.6 and a new §5.10 `darts.js`;
* §7.1 (pairing by fraction, dart seams);
* §10.2 (grading);
* §10.3–10.5 (export and CSV);
* the DXF amendment;
* §11.10 (a new §11.10.10 Dart tool) and the panel;
* §13 (checks 26g, 26h).

### 11.2 Other documentation

* **CONTRACTS.md:** new names, the check count, and the stale counts fixed while there.
* **In-app guide:** a *Darts* page, the Dart tool in the tools page, and `T` in the shortcut table (generated).
* **README:** a `dress` shot in `tools/screenshots.py` and a picture in "What it does today"; `docs/ROADMAP.md`
  item 1 marked done.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Poor triangles or failed boundary recovery near a narrow dart point | The 20 × 100 mm fixture must meet the sample pieces' quality bar; the existing ear-clip fallback still applies; an invalid dart is skipped, never fatal |
| Dart legs catch on the body while sewing (the wedge closes across the bust) | Dart pairs get the same rest-length ramp and weightless start as seams; 26g's dart-gap bar catches a failure |
| Waist seam pairing breaks when bodice and skirt darts do not line up | Pairing by `u` is independent of dart positions; a geometry self-test covers mouths on one side, on both sides, and misaligned |
| The dress runs at about 30 fps on a laptop (≈ 6 000 vertices) | Accepted for this slice; roadmap item 2 moves the solver to a Worker |
| The acceptance suite outgrows its 90 s runtime budget | 26h reuses 26g's drape; the budget is raised by the measured cost with the reason recorded (section 10.2) |
| A saved v2 project opened by an older cached app | It refuses the file with `UnsupportedVersion` instead of silently dropping darts |
