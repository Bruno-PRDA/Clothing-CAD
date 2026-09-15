## 5. 2D geometry (`src/geometry/`) — agent A1

Pure module: imports only `src/core/types.js`, `src/core/ids.js` (`hashString`) and `src/core/fabrics.js` (`effectiveMeshSpacing`). No DOM, no three.js, no allocation-heavy per-frame paths (everything here runs on edits, not per frame). All coordinates are **mm, y up**; outlines are **CCW (signedArea > 0)**; the outward normal of edge direction `d` is `[d[1], -d[0]]`. Every function is synchronous. Errors are `Error` objects with a `code` property (`'RemeshError'`, `'GeometryError'`). Consumers: `pattern/` (drawing, hit-testing, validation, seam readouts), `sizing/` and `export/` (offset, packing, flattening), `cloth/state.js` (via `PieceMesh`), `app/wiring.js` (`remeshPiece`).

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
