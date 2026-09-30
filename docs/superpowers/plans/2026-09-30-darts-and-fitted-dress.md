# Darts and a Fitted Dress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Darts become first-class objects on a pattern piece: cut in when meshing, sewn shut in 3D, editable with a Dart tool, graded, and exported. A new built-in sleeveless waist-seam dress proves it end to end.

**Architecture:** A piece keeps its clean outline plus `darts: [{id, edge, t, width_mm, apex}]`.

- **Geometry:** a new pure module, `src/geometry/darts.js`, converts between an edge's arc-length fraction `t` and its *sewn* fraction `u` (arc length with the dart mouths removed). It also validates darts.
- **Mesher:** samples every seamed edge at shared sewn fractions. It inserts each dart's V into the boundary and reports `edgeFrac` and `dartVerts` on the `PieceMesh`.
- **Cloth:** the cloth state pairs seam vertices by sewn fraction (a dart mouth is one position carried by two vertices) and sews every dart's legs.
- **Everything else:** editor, grading, export and DXF all read darts through the same geometry helpers.

**Tech Stack:** Vanilla JavaScript ES modules with JSDoc, no build step, three.js 0.180 only. Tests run inside the app page, through `window.__app.selftest.run(module)` and `__app.acceptance.run(filter)`, driven by `tests/ci/run_browser_tests.py` (Playwright, Python).

**Design spec:** `docs/superpowers/specs/2026-09-30-darts-and-fitted-dress-design.md`. Read it before Task 1.

## Global Constraints

- No Node.js, npm, bundler, TypeScript or UI framework. Plain ES modules and JSDoc only; three.js 0.180.0 is the only dependency (SPEC §0).
- Dependency arrows (SPEC §2) are hard rules:
  - `geometry` imports only `core`.
  - `cloth` imports only `core` (never `geometry`, `three` or the DOM).
  - `sizing` and `export` import `core`, `geometry`, `sizing`.
  - `pattern` imports `core` and `geometry`.
  - `ui` imports `core` and every module's public `index.js`.
  - `app` imports everything.
- `core/schema.js` must NOT import `geometry`. That is why darts are validated in two layers: structural checks in `validateShape`, geometric checks in `geometry/darts.js`.
- `docs/SPEC.md` is the single source of truth: amend it before the code in each task. Amendment blocks look like `> **Amendment (lead, YYYY-MM-DD) — Darts: <topic>.** …`, dated the day you write them, and the SPEC "Status" line (line 3) gains a dated note in Task 1.
- Units: pattern mm, y up, outlines CCW. The outward normal of travel direction `d` is `(d.y, −d.x)`, so the inward normal is `(−d.y, d.x)`.
- No allocation inside per-frame loops (solver, renderer). Everything added here runs at build time.
- Thresholds in acceptance checks are never tuned to make a check pass (SPEC 14.4 rule 3). A check that cannot pass is reported, not loosened.
- Dart constants (used everywhere; defined once in `src/geometry/darts.js`):

  | Constant | Value |
  |---|---|
  | `DART_CORNER_MM` | 2 |
  | `DART_GAP_MM` | 2 |
  | `DART_APEX_CLEAR_MM` | 1 |
  | `DART_MIN_WIDTH_MM` | 1 |
  | `DART_DRILL_BACK_MM` | 10 |
- Dart error codes (spec §3.3), all of level `error` except `DART_NOTCH` (`warn`): `DART_EDGE`, `DART_MOUTH`, `DART_WIDTH`, `DART_APEX`, `DART_CROSSES`, `DART_OVERLAP`, `DART_NOTCH`, `DART_ID`.
- The Dart tool uses the key `T` and the button `#tool-dart`. Default dart: 20 mm wide, 80 mm long; it shortens to 20 mm, then halves the width once, before giving up.
- `DOC_VERSION` becomes `2`.
- Commit with the repo's style (a plain sentence subject), ending every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on the branch `darts-and-dress`, which already holds the spec.

## Deviations from the spec, decided while planning

1. **Where darts are validated (spec §3.3).** The spec says `validateShape` calls `validateDarts`, but `core` may not import `geometry`. Instead:
   - `validateShape` (core) checks the structural codes: `DART_ID`, `DART_EDGE`, `DART_MOUTH` for `t ∉ (0,1)`, `DART_WIDTH`, and `DART_APEX` for a non-point.
   - `geometry.checkDarts` checks everything, including the geometric codes. The pattern editor's `validateDoc` reports it.
2. **The cloth self-test (spec §10.1).** Cloth tests may not import geometry, so they cannot build a real V-cut mesh. The cloth self-test instead:
   - checks the fraction-pairing function case by case;
   - checks that a lattice sheet whose side edges are declared as a dart's legs sews into a tube (legs < 2 mm apart at frame 120, out-of-plane spread > 10 mm).

   A real V dart closing on a real mesh is covered by acceptance 26g on the dress.
3. **The fit check.** `sizing/fit.js checkFit` is unchanged (spec §6.5 as corrected).

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/geometry/darts.js` | **create** | Dart mouths; sewn-fraction conversion; validation (`checkDarts`); `applyDarts` (derived V-cut outline); drill point |
| `src/cloth/pairing.js` | **create** | Pair two seam sides by index or by sewn fraction |
| `src/pattern/tools/dart.js` | **create** | The Dart tool state machine |
| `src/samples/dress.js` | **create** | The fitted dress sample |
| `src/core/types.js`, `schema.js`, `events.js` | modify | Contracts, `DOC_VERSION` 2, normalisation and migration, structural validation |
| `src/geometry/remesh.js` | modify | Sewn-fraction seam sampling; darted boundary; `edgeFrac` and `dartVerts`; NUL byte fixed |
| `src/geometry/bezier.js` (`splitEdge`), `mirror.js` (`mirrorPiece`), `index.js` | modify | Carry darts through a split and a mirror; export the dart API |
| `src/cloth/state.js`, `fixtures.js`, `index.js` | modify | Fraction pairing, dart seams, tube fixture |
| `src/pattern/seams.js`, `validate.js`, `editor.js`, `hit.js`, `render2d.js`, `index.js` | modify | Sewn-length ease; dart issues; ops carry darts; selection; hit test, drawing and registration of the tool |
| `src/sizing/grading.js` | modify | Grade darts; sewn lengths in ease and drift |
| `src/export/svg.js`, `csv.js` | modify | Dart legs, mouth notches and drill hole; sewn lengths |
| `src/dxf/aama.js` | modify | Write darts (layers 8, 13, 4); recognise them on import |
| `src/ui/panels/pieces.js`, `ids.js`, `toolbar.js`, `shortcuts.js`, `guideContent.js` | modify | Darts list, tool button, `T` key, guide page, duplicate moves apexes |
| `src/app/debugApi.js`, `wiring.js` | modify | Translate apexes when moving or importing pieces |
| `index.html` | modify | `#tool-dart`, `#piece-darts`, `#list-darts`, the dress in `#sel-sample` |
| `src/samples/tshirt.js`, `skirt.js`, `index.js` | modify | `version: 2`, `darts: []`; register the dress |
| `tests/acceptance.js`, `tests/ci/run_browser_tests.py` | modify | Checks 26g and 26h, extended checks, runtime budget; runner flags `--module`, `--checks`, `--gpu` |
| `tools/screenshots.py` | modify | Reuse the runner's `GPU_ARGS`; new `dress` shot |
| `docs/SPEC.md`, `docs/CONTRACTS.md`, `docs/ROADMAP.md`, `README.md` | modify | Amendments and docs |

## How to run the tests (after Task 1)

```bash
python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module geometry
python tests/ci/run_browser_tests.py --serve --gpu --timing warn --only acceptance --checks "^26[gh]$"
python tests/ci/run_browser_tests.py --serve --gpu --timing warn
```

- The runner prints every non-passing row and exits 1 on any failure. `--timing warn` is needed on laptops, where `cloth/perf.4k` is slower than its 16 ms budget.
- On CI the workflow keeps running without `--gpu`.
- Baseline before Task 1: every self-test passes except timing warnings, and acceptance passes except check 10 (red on purpose).

---

### Task 1: Test-runner options, dart contracts, DOC_VERSION 2

**Files:**
- Modify: `tests/ci/run_browser_tests.py`
- Modify: `tools/screenshots.py:26-33` (import `GPU_ARGS` instead of defining it)
- Modify: `docs/SPEC.md` (Status line; §3.1 after the `Piece` typedef; §3.4 at `export const DOC_VERSION = 1;`)
- Modify: `src/core/types.js`, `src/core/events.js:216-225`, `src/core/schema.js`
- Modify: `src/samples/tshirt.js`, `src/samples/skirt.js`, `src/cloth/fixtures.js:135`, `src/sizing/selftest.js:79`
- Modify: `tests/acceptance.js:902`
- Test: `src/core/selftest.js`

**Interfaces:**
- Produces:
  - typedef `Dart {id:string, edge:number, t:number, width_mm:number, apex:Vec2}`
  - `Piece.darts: Dart[]`
  - `PieceMesh.edgeFrac: Float64Array[][]`
  - `PieceMesh.dartVerts: {a:Uint32Array, b:Uint32Array}[][]`
  - `DOC_VERSION = 2`
  - `migrate()` turns v1 into v2
  - `normalizePiece` returns `darts`
  - `ToolName` includes `'dart'`
  - `Selection` may carry `dart: {pieceId, index}|null`
  - Runner flags `--module NAME` (repeatable), `--checks REGEX`, `--gpu`
  - `GPU_ARGS` exported from `tests/ci/run_browser_tests.py`

- [ ] **Step 1: Add the runner flags**

In `tests/ci/run_browser_tests.py`, below `CHROMIUM_ARGS`, add:

```python
# Local runs can render on the machine's GPU through ANGLE (Direct3D 11 on Windows); CI keeps SwiftShader.
GPU_ARGS = ['--use-angle=d3d11' if sys.platform == 'win32' else '--use-angle=default', '--ignore-gpu-blocklist',
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows']
```

In `main()`, after the `--only` argument, add:

```python
    ap.add_argument('--module', action='append', default=[], metavar='NAME',
                    help="run only this module's self-tests (repeatable; skips the acceptance suite)")
    ap.add_argument('--checks', metavar='REGEX', help='acceptance checks to run: a regex over check ids and names')
    ap.add_argument('--gpu', action='store_true', help='render WebGL on the GPU instead of SwiftShader (local runs)')
```

Change the launch line to `browser = p.chromium.launch(headless=not args.headed, args=GPU_ARGS if args.gpu else CHROMIUM_ARGS)`.

Replace the self-test block with:

```python
            if boot['ok'] and (args.module or args.only in (None, 'selftests')):
                print('Running the self-tests…', flush=True)
                if args.module:
                    res = []
                    for m in args.module:
                        res += page.evaluate('async (m) => await window.__app.selftest.run(m)', m)
                else:
                    res = page.evaluate('async () => await window.__app.selftest.run()')
                for r in res:
                    rows.append({'kind': 'selftest', 'key': r['name'], 'name': r['name'],
                                 'pass': bool(r['pass']), 'details': str(r['details'])})
```

Change the acceptance condition to `if boot['ok'] and not args.module and args.only in (None, 'acceptance'):`. Pass `[args.checks or ACCEPTANCE_FILTER, args.timeout_scale]` in place of `[ACCEPTANCE_FILTER, args.timeout_scale]`.

In `tools/screenshots.py`:
- change the import line to `from run_browser_tests import CHROMIUM_ARGS, GPU_ARGS, free_port, start_server  # noqa: E402`;
- delete the local `GPU_ARGS = [...]` assignment and its comment.

- [ ] **Step 2: Check the runner still works**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module core`

Expected: `N passed, 0 failed` (N ≈ 30). Exit code 0.

- [ ] **Step 3: Write the failing core tests**

In `src/core/selftest.js`:
- Add `DOC_VERSION` to the import from `./schema.js`.
- Change line 215 to `assert(s.get().version === DOC_VERSION && s.canUndo() === false, 'fresh store: current version, nothing to undo');`.
- In `schema/validate-codes`, change the `DocVersion` case to `(d) => { d.version = 3; }`.

Replace lines 554-558 (inside `schema/migrate-v0`) with:

```js
    let code = null;
    try { migrate({ version: 3 }); } catch (e) { code = e.code; }
    assert(code === 'UnsupportedVersion', 'version 3 -> UnsupportedVersion');
    const same = { version: 2 };
    assert(migrate(same) === same, 'version 2 returned unchanged');
    const v1 = { version: 1, pieces: [{ id: 'p' }] };
    const m1 = migrate(v1);
    assert(m1 !== v1 && m1.version === 2 && Array.isArray(m1.pieces[0].darts) && m1.pieces[0].darts.length === 0
      && v1.pieces[0].darts === undefined, 'v1 -> v2 on a copy, every piece gets darts: []');
    assert(d.pieces.every((pc) => Array.isArray(pc.darts)), 'a v0 document ends with darts on every piece');
```

After `schema/migrate-v0`, add:

```js
  await check('schema/darts', () => {
    const base = normalizeDoc(fixtureDoc());
    assert(base.version === DOC_VERSION && base.pieces.every((p) => Array.isArray(p.darts) && p.darts.length === 0),
      'normalised pieces carry darts: []');
    const withDart = structuredClone(base);
    withDart.pieces[1].darts = [{ id: 'd1', edge: 0, t: 0.5, width_mm: 10, apex: [50, 30] }];
    assert(validateShape(withDart).length === 0, 'a valid dart raises nothing: ' + stableStringify(validateShape(withDart)));
    const again = normalizeDoc(JSON.parse(serializeDoc(withDart)));
    assert(serializeDoc(again) === serializeDoc(withDart), 'darts round-trip byte-identical');
    /** @type {[string, (d: any) => void][]} */
    const cases = [
      ['DART_ID', (d) => { d.pieces[1].darts.push({ ...d.pieces[1].darts[0], edge: 1 }); }],
      ['DART_EDGE', (d) => { d.pieces[1].darts[0].edge = 5; }],
      ['DART_EDGE', (d) => { d.pieces[0].darts = [{ id: 'f', edge: 3, t: 0.5, width_mm: 10, apex: [50, 50] }]; }],
      ['DART_MOUTH', (d) => { d.pieces[1].darts[0].t = 1; }],
      ['DART_WIDTH', (d) => { d.pieces[1].darts[0].width_mm = 0.5; }],
      ['DART_APEX', (d) => { d.pieces[1].darts[0].apex = [50]; }],
    ];
    const failed = [];
    for (const [code, mutate] of cases) {
      const d = structuredClone(withDart);
      mutate(d);
      if (!validateShape(d).some((i) => i.code === code)) failed.push(code);
    }
    assert(failed.length === 0, 'codes not fired: ' + failed.join(', '));
    return cases.length + ' structural dart codes';
  });
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module core`

Expected: FAIL in `schema/migrate-v0` ("version 3 -> UnsupportedVersion" or "version 2 returned unchanged") and in `schema/darts`.

- [ ] **Step 5: Amend SPEC.md**

- Append to the Status line (line 3): ` Amended YYYY-MM-DD (Darts, roadmap item 1): DOC_VERSION 2; Dart, Piece.darts, PieceMesh.edgeFrac/dartVerts; seams pair by sewn fraction; the Dart tool; the fitted dress sample. Design: docs/superpowers/specs/2026-09-30-darts-and-fitted-dress-design.md.`
- Change `export const DOC_VERSION = 1;` in §3.4 to `2`.
- In §3.1, directly after the `Piece` typedef (search `@property {number} meshSpacing_mm`), add:

```markdown
> **Amendment (lead, YYYY-MM-DD) — Darts: contracts.** `Piece.darts: Dart[]` (default `[]`), where
> `Dart = {id, edge, t, width_mm, apex}`. A dart opens onto outline edge `edge` (never the fold edge). Its mouth runs from
> arc length `t·L − width_mm/2` (point A) to `t·L + width_mm/2` (point B), and its legs are A→apex and B→apex. The
> stored outline stays undarted: the V is cut in only when meshing. The *sewn length* of an edge is its arc length
> minus its darts' widths, and a *sewn fraction* `u` is a position along it measured the same way; a mouth is one `u`.
> `PieceMesh.edgeVerts[m][e]` lists A and B both (one extra id per dart). `PieceMesh.edgeFrac[m][e]` (Float64Array,
> parallel) gives each listed vertex's `u`. `PieceMesh.dartVerts[m][k] = {a, b}` gives dart k's legs from the mouth to
> the shared apex, or empty arrays for a dart the mesher ignored. `DOC_VERSION` is 2: `migrate` adds `darts: []` to v1
> pieces. `validateShape` checks darts structurally (`DART_ID`, `DART_EDGE`, `DART_MOUTH` for t ∉ (0,1),
> `DART_WIDTH` for width < 1 mm, `DART_APEX` for a non-point). The geometric checks live in `src/geometry/darts.js`
> (§5.10).
```

- [ ] **Step 6: Change the core contracts**

`src/core/types.js`: before `Piece`, add:

```js
/**
 * A dart that opens onto an outline edge (SPEC 3.1, amendment "Darts"). The outline itself stays undarted: the V is
 * cut in when the piece is meshed, and its two legs are sewn together.
 * @typedef {Object} Dart
 * @property {string} id        unique within the piece (uid('dart'))
 * @property {number} edge      outline edge index the dart opens onto; never the fold edge
 * @property {number} t         arc-length fraction of the mouth's centre along that edge, strictly inside (0, 1)
 * @property {number} width_mm  intake, measured as arc length along the edge; >= 1
 * @property {Vec2} apex        the dart point, mm, strictly inside the piece
 */
```

In `Piece` add `* @property {Dart[]} darts   darts opening onto outline edges (SPEC 3.1 amendment "Darts")` after `internalLines`.

In `PieceMesh`:
- change the `edgeVerts` comment to end `…; on an edge with darts each mouth adds a vertex (A then B)`;
- add:

```js
 * @property {Float64Array[][]} edgeFrac  parallel to edgeVerts: the sewn fraction u of each listed vertex (a dart mouth's A and B share one u); empty for the fold edge
 * @property {{a:Uint32Array, b:Uint32Array}[][]} dartVerts  dartVerts[mirror][k]: dart k's legs, mouth -> apex, equal length, sharing the apex id; empty arrays for an ignored dart; dartVerts[1] = [] for non-fold pieces
```

`src/core/events.js`, in the `Selection` typedef, add:

```js
 * @property {{pieceId:string, index:number}|null} [notch]  single selected notch (notch tool)
 * @property {{pieceId:string, index:number}|null} [dart]   single selected dart (dart tool)
```

and change `ToolName` to `'select'|'draw'|'edit'|'split'|'seam'|'notch'|'dart'|'grainline'|'measure'`.

`src/core/schema.js`:
- `export const DOC_VERSION = 2;`
- In `normalizePiece`, after `internalLines`, add:

```js
  const darts = (Array.isArray(p.darts) ? p.darts : []).map((dt) => {
    const s = isObj(dt) ? dt : {};
    return {
      id: str(s.id, '') || uid('dart'),
      edge: int(s.edge, 0),
      t: num(s.t, 0.5),
      width_mm: num(s.width_mm, 20),
      apex: /** @type {Vec2} */ (vec2(s.apex, [0, 0])),
    };
  });
```

and add `darts,` after `internalLines,` in the returned object.
- In the private `validatePiece(issues, pc, …)`, after the notch loop, add:

```js
  const darts = Array.isArray(pc.darts) ? pc.darts : [];
  const dartIds = new Set();
  for (let k = 0; k < darts.length; k++) {
    const dt = darts[k] || /** @type {any} */ ({});
    if (typeof dt.id !== 'string' || dt.id === '' || dartIds.has(dt.id)) {
      push(issues, 'error', 'DART_ID', 'Piece ' + show(pid) + ' dart ' + k + ' id ' + show(dt.id) + ' is empty or repeated', { pieceId: pid });
    }
    dartIds.add(dt.id);
    if (!isInt(dt.edge) || dt.edge < 0 || dt.edge >= ne || (foldOk && dt.edge === fe)) {
      push(issues, 'error', 'DART_EDGE', 'Piece ' + show(pid) + ' dart ' + k + ' edge ' + show(dt.edge) + ' is not a sewable outline edge', { pieceId: pid });
    }
    if (!(isFiniteNum(dt.t) && dt.t > 0 && dt.t < 1)) {
      push(issues, 'error', 'DART_MOUTH', 'Piece ' + show(pid) + ' dart ' + k + ' t ' + show(dt.t) + ' is not strictly inside (0, 1)', { pieceId: pid, edge: dt.edge });
    }
    if (!(isFiniteNum(dt.width_mm) && dt.width_mm >= 1)) {
      push(issues, 'error', 'DART_WIDTH', 'Piece ' + show(pid) + ' dart ' + k + ' width_mm ' + show(dt.width_mm) + ' is below 1 mm', { pieceId: pid, edge: dt.edge });
    }
    if (!isVec2(dt.apex)) {
      push(issues, 'error', 'DART_APEX', 'Piece ' + show(pid) + ' dart ' + k + ' apex ' + show(dt.apex) + ' is not a point', { pieceId: pid });
    }
  }
```

- In `normalizeDoc`, replace `if (!(rawVersion >= 1)) p = migrate(p);` with `if (!(rawVersion >= DOC_VERSION)) p = migrate(p);`, and replace `const version = num(p.version, 1);` with `const version = num(p.version, DOC_VERSION);`.
- Replace `migrate` and its doc comment with:

```js
/**
 * Bring a document to DOC_VERSION. version 2 -> same object; version 1 -> darts added on a deep copy; missing / < 1 ->
 * v0 migration then the v1 step, on a deep copy; > 2 -> Error{code:'UnsupportedVersion'}. `migrate.warnings` is reset
 * at each call.
 * @param {*} doc @returns {*}
 */
export function migrate(doc) {
  migrate.warnings = [];
  const src = isObj(doc) ? doc : {};
  const v = num(src.version, NaN);
  if (v === DOC_VERSION) return doc;
  if (Number.isFinite(v) && v > DOC_VERSION) {
    throw codedError('UnsupportedVersion', 'Document version ' + v + ' is newer than this app (' + DOC_VERSION + ')');
  }
  const d = deepCopy(src);
  if (v !== 1) {
    migrateTopLevel(d);
    if (Array.isArray(d.pieces)) for (const pc of d.pieces) migratePiece(pc);
    migrateSim(d.sim);
    migrateBody(d);
    migrateSizes(d);
    migrateSeams(d);
    migrateFabrics(d);
  }
  migrateV1(d);
  d.version = DOC_VERSION;
  return d;
}
/** @type {string[]} populated during the last migrate() call */
migrate.warnings = [];

/** v1 -> v2 (SPEC 3.1 amendment "Darts"): every piece gets an empty dart list. @param {any} d */
function migrateV1(d) {
  if (!Array.isArray(d.pieces)) return;
  for (const pc of d.pieces) if (isObj(pc) && !Array.isArray(pc.darts)) pc.darts = [];
}
```

Also:
- Samples: in `src/samples/tshirt.js` and `src/samples/skirt.js`, set `version: 2`, and add `darts: [],` after every `internalLines: [],`.
- Set `version: 2` in `src/cloth/fixtures.js:135` and `src/sizing/selftest.js:79`.
- In `tests/acceptance.js:902`, use ``expect(o.version === 2, `version ${o.version} !== 2`);``.

- [ ] **Step 7: Run the tests to see them pass**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module core --module geometry --module sizing --module export`

Expected: PASS, including `schema/darts`, `schema/migrate-v0` and the samples round-trip check.

- [ ] **Step 8: Update CONTRACTS.md and commit**

In `docs/CONTRACTS.md`, add to the `src/core` section: `DOC_VERSION = 2; Dart {id, edge, t, width_mm, apex}; Piece.darts; PieceMesh.edgeFrac / dartVerts; migrate v1 -> v2 adds darts: []` and `ToolName includes 'dart'`.

```bash
git add tests/ci/run_browser_tests.py tools/screenshots.py docs/SPEC.md docs/CONTRACTS.md src/core src/samples/tshirt.js src/samples/skirt.js src/cloth/fixtures.js src/sizing/selftest.js tests/acceptance.js
git commit -m "Add darts to the document contract (DOC_VERSION 2), and let the test runner pick modules and checks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `src/geometry/darts.js` — mouths, sewn fractions, validation

**Files:**
- Create: `src/geometry/darts.js`
- Modify: `src/geometry/index.js`, `src/geometry/mirror.js:90-122` (`mirrorPiece`), `src/geometry/bezier.js:235-284` (`splitEdge`)
- Modify: `docs/SPEC.md` (§5: new §5.10 after §5.9)
- Test: `src/geometry/selftest.js`

**Interfaces:**
- Consumes: `Dart`, `Piece.darts` (Task 1).
- Produces (all exported from `src/geometry/index.js`):
  - `DART_CORNER_MM`, `DART_GAP_MM`, `DART_APEX_CLEAR_MM`, `DART_MIN_WIDTH_MM`, `DART_DRILL_BACK_MM`
  - `dartMouth(piece, dart) → {a:Vec2, b:Vec2, ta:number, tb:number, L:number}`
  - `checkDarts(piece) → {issues: Issue[], bad: Set<number>}`
  - `validDartIndices(piece) → number[]`
  - `mouthsOn(piece, e) → Mouth[]` (sorted along the edge), where `Mouth = {k, dart, s0, s1, ta, tb, a, b, apex}`
  - `sewnLength(piece, e) → number`
  - `edgeToSewn(piece, e, t) → number`
  - `sewnToEdge(piece, e, u) → number[]` (one t, or `[tA, tB]` at a mouth)
  - `mouthFractions(piece, e) → number[]`
  - `insideMouth(piece, e, t) → boolean`
  - `applyDarts(piece, ks?) → {piece, map}`
  - `dartDrillPoint(a, b, apex) → Vec2`
  - `mirrorPiece` also mirrors darts; `splitEdge` also remaps darts.

- [ ] **Step 1: Write the failing geometry tests**

In `src/geometry/selftest.js`, extend the `./index.js` import with `dartMouth, checkDarts, validDartIndices, sewnLength, edgeToSewn, sewnToEdge, mouthFractions, applyDarts, mirrorPiece, edgeLength`. Add these cases before the `// ---- run` banner:

```js
/** 100 x 100 square with one dart on its bottom edge: mouth 40..60, point (50, 60). @param {Partial<Piece>} [extra] @returns {Piece} */
function dartedSquare(extra) {
  return squarePiece({ darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 20, apex: [50, 60] }], ...extra });
}

/** @returns {SelfTestResult} */
function caseDartsMouth() {
  const p = dartedSquare();
  const m = dartMouth(p, p.darts[0]);
  const okMouth = Math.abs(m.a[0] - 40) < 1e-9 && Math.abs(m.b[0] - 60) < 1e-9 && m.a[1] === 0 && m.b[1] === 0;
  const Ls = sewnLength(p, 0);
  const u03 = edgeToSewn(p, 0, 0.3);
  const uIn = edgeToSewn(p, 0, 0.5);
  const back = sewnToEdge(p, 0, 0.5);
  const low = sewnToEdge(p, 0, 0.25);
  const high = sewnToEdge(p, 0, 0.75);
  const fr = mouthFractions(p, 0);
  // a cubic edge: the mouth sits on the curve, symmetric about x = 50, and the pieces either side sum to L - 20
  const c = makePiece({ id: 'cu', vertices: [[0, 0], [100, 0], [100, 100], [0, 100]],
    edges: [{ type: 'cubic', c1: [30, -20], c2: [70, -20] }, { type: 'line' }, { type: 'line' }, { type: 'line' }],
    darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 20, apex: [50, 60] }] });
  const mc = dartMouth(c, c.darts[0]);
  const derived = applyDarts(c).piece;
  const parts = edgeLength(derived, 0) + edgeLength(derived, 3);
  const pass = okMouth && Math.abs(Ls - 80) < 1e-9 && Math.abs(u03 - 0.375) < 1e-12 && Math.abs(uIn - 0.5) < 1e-12
    && back.length === 2 && Math.abs(back[0] - 0.4) < 1e-12 && Math.abs(back[1] - 0.6) < 1e-12
    && low.length === 1 && Math.abs(low[0] - 0.2) < 1e-12 && high.length === 1 && Math.abs(high[0] - 0.8) < 1e-12
    && fr.length === 1 && Math.abs(fr[0] - 0.5) < 1e-12
    && Math.abs(mc.a[0] + mc.b[0] - 100) < 0.01 && Math.abs(mc.a[1] - mc.b[1]) < 0.01
    && Math.abs(parts - (edgeLength(c, 0) - 20)) < 0.05;
  return { name: 'darts.mouth', pass, details: `L_sewn ${f(Ls)}, u(0.3) ${f(u03)}, mouth -> [${back.map((x) => f(x)).join(', ')}], cubic parts ${f(parts)} vs ${f(edgeLength(c, 0) - 20)}` };
}

/** @returns {SelfTestResult} */
function caseDartsApply() {
  const p = dartedSquare();
  const { piece: d, map } = applyDarts(p);
  const legs = map.filter((x) => 'dart' in x).length;
  const area = signedArea(d.vertices);
  const pass = d.vertices.length === 7 && legs === 2 && area > 0 && isSimplePolygon(d.vertices) && Math.abs(area - (10000 - 600)) < 1e-6;
  return { name: 'darts.apply', pass, details: `${d.vertices.length} vertices, ${legs} legs, area ${f(area)} (want 9400)` };
}

/** @returns {SelfTestResult} */
function caseDartsCheck() {
  /** @type {[string, Piece][]} */
  const cases = [
    ['DART_EDGE', dartedSquare({ darts: [{ id: 'd', edge: 9, t: 0.5, width_mm: 20, apex: [50, 60] }] })],
    ['DART_EDGE', dartedSquare({ foldEdge: 3, vertices: [[0, 0], [100, 0], [100, 100], [0, 100]], darts: [{ id: 'd', edge: 3, t: 0.5, width_mm: 20, apex: [50, 50] }] })],
    ['DART_WIDTH', dartedSquare({ darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 0.5, apex: [50, 60] }] })],
    ['DART_MOUTH', dartedSquare({ darts: [{ id: 'd', edge: 0, t: 0.05, width_mm: 20, apex: [50, 60] }] })],
    ['DART_APEX', dartedSquare({ darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 20, apex: [50, 150] }] })],
    ['DART_APEX', dartedSquare({ darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 20, apex: [50, 99.5] }] })],
    ['DART_OVERLAP', dartedSquare({ darts: [{ id: 'd', edge: 0, t: 0.3, width_mm: 20, apex: [30, 60] }, { id: 'e', edge: 0, t: 0.4, width_mm: 20, apex: [40, 60] }] })],
    ['DART_CROSSES', makePiece({ id: 'L', vertices: [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]],
      darts: [{ id: 'd', edge: 0, t: 0.8, width_mm: 10, apex: [20, 80] }] })],
    ['DART_CROSSES', dartedSquare({ darts: [{ id: 'd', edge: 0, t: 0.25, width_mm: 10, apex: [75, 60] }, { id: 'e', edge: 0, t: 0.75, width_mm: 10, apex: [25, 60] }] })],
    ['DART_ID', dartedSquare({ darts: [{ id: 'd', edge: 0, t: 0.25, width_mm: 10, apex: [25, 40] }, { id: 'd', edge: 2, t: 0.5, width_mm: 10, apex: [50, 50] }] })],
    ['DART_NOTCH', dartedSquare({ notches: [{ edge: 0, t: 0.5, kind: 'single' }] })],
  ];
  const missed = [];
  for (const [code, piece] of cases) if (!checkDarts(piece).issues.some((i) => i.code === code)) missed.push(code);
  const clean = checkDarts(dartedSquare()).issues.length === 0;
  const mixed = dartedSquare({ darts: [{ id: 'ok', edge: 0, t: 0.5, width_mm: 20, apex: [50, 60] }, { id: 'bad', edge: 2, t: 0.5, width_mm: 20, apex: [50, 150] }] });
  const valid = validDartIndices(mixed);
  const pass = missed.length === 0 && clean && valid.length === 1 && valid[0] === 0;
  return { name: 'darts.check', pass, details: (missed.length ? 'codes not fired: ' + missed.join(', ') : cases.length + ' codes fired') + '; clean ' + clean + '; valid ' + JSON.stringify(valid) };
}

/** @returns {SelfTestResult} */
function caseDartsCarry() {
  const p = squarePiece({ darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 20, apex: [50, 60] }, { id: 'e', edge: 2, t: 0.5, width_mm: 10, apex: [50, 40] }] });
  const { piece: s } = splitEdge(p, 0, 0.25);
  const moved = s.darts[0];
  const later = s.darts[1];
  const splitOk = moved.edge === 1 && Math.abs(moved.t - 0.25 / 0.75) < 1e-9 && moved.width_mm === 20 && later.edge === 3;
  const fold = makePiece({ id: 'fh', vertices: [[0, 0], [100, 0], [100, 100], [0, 100]], foldEdge: 3,
    darts: [{ id: 'd', edge: 0, t: 0.6, width_mm: 10, apex: [60, 40] }] });
  const m = mirrorPiece(fold);
  const twin = m.darts.find((dd) => dd.id === 'd_m');
  const mirrorOk = m.darts.length === 2 && !!twin && Math.abs(twin.apex[0] + 60) < 1e-9 && Math.abs(twin.t - 0.4) < 1e-9
    && checkDarts(m).issues.length === 0;
  return { name: 'darts.carry', pass: splitOk && mirrorOk, details: `split: edge ${moved.edge} t ${f(moved.t)}; mirror: ${m.darts.length} darts, twin apex ${twin ? twin.apex.join(',') : 'none'}` };
}
```

Add `caseDartsMouth, caseDartsApply, caseDartsCheck, caseDartsCarry` to the end of `CASES`, and `'darts.mouth', 'darts.apply', 'darts.check', 'darts.carry'` to the end of `listSelfTests()`. Update the header comment count.

- [ ] **Step 2: Run the tests to see them fail**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module geometry`

Expected: FAIL. `geometry/import` fails, or the new cases throw, because `./index.js` does not export `dartMouth`.

- [ ] **Step 3: Write `src/geometry/darts.js`**

```js
// src/geometry/darts.js — darts that open onto an outline edge (SPEC 5.10, amendment "Darts"). Pure; mm.
//
// A dart is stored against the CLEAN outline as {id, edge, t, width_mm, apex}. Its mouth is the stretch of that edge
// between arc lengths c − w/2 (point A) and c + w/2 (point B), c = t·L, and its legs are A→apex and B→apex. The
// fabric inside is folded away, not cut, so everything that compares seam lengths uses the SEWN length of an edge: its
// arc length with the mouths taken out. `edgeToSewn` / `sewnToEdge` convert between the arc-length fraction t and the
// sewn fraction u; a whole mouth is ONE u, carried by two points.
//
// Only valid darts count (`validDartIndices`): a dart `checkDarts` rejects is ignored by the mesher, the seam sampling
// and the exports, and reported by the validators, so one bad dart never stops a drape.

import { edgeLength, pointAtArcFraction, paramAtArcFraction, splitCubic, flattenPiece } from './bezier.js';
import { isSimplePolygon, pointInPolygon, distToPolyline } from './polygon.js';

/** @typedef {import('../core/types.js').Vec2} Vec2 */
/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').Dart} Dart */
/** @typedef {import('../core/types.js').Edge} Edge */
/** @typedef {import('../core/types.js').Issue} Issue */
/**
 * @typedef {Object} Mouth
 * @property {number} k      index into piece.darts
 * @property {Dart} dart
 * @property {number} s0     arc length of A along the edge, mm
 * @property {number} s1     arc length of B, mm
 * @property {number} ta     s0 / L
 * @property {number} tb     s1 / L
 * @property {Vec2} a
 * @property {Vec2} b
 * @property {Vec2} apex
 */

/** A mouth keeps at least this far (mm) from the corners of its edge. */
export const DART_CORNER_MM = 2;
/** Two mouths on one edge keep at least this far (mm) apart. */
export const DART_GAP_MM = 2;
/** The apex keeps at least this far (mm) inside the outline. */
export const DART_APEX_CLEAR_MM = 1;
/** Narrowest dart, mm. */
export const DART_MIN_WIDTH_MM = 1;
/** The drill hole sits this far (mm) back from the point, along the centre line (at most half way to the mouth). */
export const DART_DRILL_BACK_MM = 10;
/** Flattening tolerance of the crossing test, mm. */
const FLAT_TOL_MM = 0.5;

/** @param {Piece} piece @returns {Dart[]} */
function dartsOf(piece) {
  return piece && Array.isArray(piece.darts) ? piece.darts : [];
}

/** @param {Piece} piece @param {number} e @returns {[Vec2, Edge, Vec2]} */
function segOf(piece, e) {
  const n = piece.vertices.length;
  return [piece.vertices[e], piece.edges[e], piece.vertices[(e + 1) % n]];
}

/**
 * Mouth of one dart, valid or not (the editor previews invalid darts too).
 * @param {Piece} piece @param {Dart} dart @returns {{a: Vec2, b: Vec2, ta: number, tb: number, L: number}}
 */
export function dartMouth(piece, dart) {
  const [p0, edge, p1] = segOf(piece, dart.edge);
  const L = edgeLength(piece, dart.edge);
  const c = dart.t * L;
  const ta = L > 0 ? (c - dart.width_mm / 2) / L : 0;
  const tb = L > 0 ? (c + dart.width_mm / 2) / L : 0;
  return { a: pointAtArcFraction(p0, edge, p1, ta), b: pointAtArcFraction(p0, edge, p1, tb), ta, tb, L };
}

/**
 * The drill hole: on the dart's centre line, DART_DRILL_BACK_MM back from the point, at most half way to the mouth.
 * @param {Vec2} a @param {Vec2} b @param {Vec2} apex @returns {Vec2}
 */
export function dartDrillPoint(a, b, apex) {
  const mx = (a[0] + b[0]) / 2 - apex[0];
  const my = (a[1] + b[1]) / 2 - apex[1];
  const len = Math.hypot(mx, my) || 1;
  const back = Math.min(DART_DRILL_BACK_MM, len / 2);
  return [apex[0] + mx * back / len, apex[1] + my * back / len];
}

/** Part [t0, t1] (arc-length fractions) of an edge, as an edge starting at its t0 point. @param {Vec2} p0 @param {Edge} edge @param {Vec2} p1 @param {number} t0 @param {number} t1 @returns {Edge} */
function subEdge(p0, edge, p1, t0, t1) {
  /** @type {Edge} */
  const out = { type: edge.type === 'cubic' ? 'cubic' : 'line' };
  if (edge.label !== undefined) out.label = edge.label;
  if (edge.allowance_mm !== undefined) out.allowance_mm = edge.allowance_mm;
  if (out.type === 'cubic' && edge.c1 && edge.c2) {
    const u0 = paramAtArcFraction(p0, edge, p1, t0);
    const u1 = paramAtArcFraction(p0, edge, p1, t1);
    const left = splitCubic(p0, edge.c1, edge.c2, p1, u1)[0];
    const part = u0 > 0 ? splitCubic(left[0], left[1], left[2], left[3], u0 / u1)[1] : left;
    out.c1 = part[1];
    out.c2 = part[2];
  }
  return out;
}

/**
 * The outline with darts cut in: every mouth becomes A → apex → B. `ks` picks the darts (default: the valid ones); the
 * caller vouches for them. `map[j]` says what derived edge j is: part of original edge `edge` from arc-length fraction
 * `t0` to `t1`, or leg 'a' / 'b' of dart `dart`. `foldEdge` follows the fold edge (which carries no darts).
 * @param {Piece} piece @param {number[]} [ks]
 * @returns {{piece: Piece, map: Array<{edge:number, t0:number, t1:number}|{dart:number, leg:'a'|'b'}>}}
 */
export function applyDarts(piece, ks) {
  const darts = dartsOf(piece);
  const use = Array.isArray(ks) ? ks : validDartIndices(piece);
  const n = piece.vertices.length;
  /** @type {Vec2[]} */
  const vertices = [];
  /** @type {Edge[]} */
  const edges = [];
  /** @type {Array<{edge:number, t0:number, t1:number}|{dart:number, leg:'a'|'b'}>} */
  const map = [];
  /** @type {number|null} */
  let foldEdge = null;
  for (let e = 0; e < n; e++) {
    const [p0, edge, p1] = segOf(piece, e);
    const here = use.filter((k) => darts[k] && darts[k].edge === e)
      .map((k) => ({ k, m: dartMouth(piece, darts[k]) }))
      .sort((x, y) => x.m.ta - y.m.ta);
    if (e === piece.foldEdge) foldEdge = edges.length;
    let t0 = 0;
    vertices.push([p0[0], p0[1]]);
    for (const { k, m } of here) {
      edges.push(subEdge(p0, edge, p1, t0, m.ta));
      map.push({ edge: e, t0, t1: m.ta });
      vertices.push([m.a[0], m.a[1]]);
      edges.push({ type: 'line', label: 'dart' });
      map.push({ dart: k, leg: 'a' });
      vertices.push([darts[k].apex[0], darts[k].apex[1]]);
      edges.push({ type: 'line', label: 'dart' });
      map.push({ dart: k, leg: 'b' });
      vertices.push([m.b[0], m.b[1]]);
      t0 = m.tb;
    }
    edges.push(subEdge(p0, edge, p1, t0, 1));
    map.push({ edge: e, t0, t1: 1 });
  }
  const out = /** @type {Piece} */ ({ ...piece, vertices, edges, foldEdge, darts: [], notches: [] });
  return { piece: out, map };
}

/** @type {WeakMap<object, {sig: string, res: {issues: Issue[], bad: Set<number>}}>} */
const CHECK_CACHE = new WeakMap();

/** Everything the checks read. @param {Piece} piece @returns {string} */
function signature(piece) {
  return JSON.stringify([piece.vertices, piece.edges, piece.foldEdge, piece.darts, piece.notches]);
}

/**
 * Every dart problem of a piece (spec §3.3 codes) and the indices of the darts that must be ignored. Cached per piece
 * object and content, so the mesher's seam sampling and every validator can call it freely.
 * @param {Piece} piece @returns {{issues: Issue[], bad: Set<number>}}
 */
export function checkDarts(piece) {
  const darts = dartsOf(piece);
  if (darts.length === 0) return { issues: [], bad: new Set() };
  const sig = signature(piece);
  const hit = CHECK_CACHE.get(piece);
  if (hit && hit.sig === sig) return hit.res;
  /** @type {Issue[]} */
  const issues = [];
  /** @type {Set<number>} */
  const bad = new Set();
  const name = piece.name || piece.id;
  const n = piece.vertices.length;
  /** @param {string} code @param {number} k @param {string} what */
  const fail = (code, k, what) => {
    const dt = darts[k];
    issues.push({ level: 'error', code, pieceId: piece.id, edge: dt && Number.isInteger(dt.edge) ? dt.edge : undefined, message: `${name}: dart ${k + 1} ${what}` });
    bad.add(k);
  };
  const outline = flattenPiece(piece, FLAT_TOL_MM).points;
  const ids = new Set();
  /** @type {(Mouth|null)[]} */
  const mouths = darts.map(() => null);
  for (let k = 0; k < darts.length; k++) {
    const dt = darts[k];
    if (!dt || typeof dt.id !== 'string' || dt.id === '' || ids.has(dt.id)) fail('DART_ID', k, 'has an empty or repeated id');
    if (dt) ids.add(dt.id);
    if (!dt || !Number.isInteger(dt.edge) || dt.edge < 0 || dt.edge >= n || dt.edge === piece.foldEdge) {
      fail('DART_EDGE', k, 'is not on a sewable outline edge');
      continue;
    }
    if (!(Number.isFinite(dt.width_mm) && dt.width_mm >= DART_MIN_WIDTH_MM)) {
      fail('DART_WIDTH', k, `is narrower than ${DART_MIN_WIDTH_MM} mm`);
      continue;
    }
    const L = edgeLength(piece, dt.edge);
    const c = dt.t * L;
    if (!(dt.t > 0 && dt.t < 1) || c - dt.width_mm / 2 < DART_CORNER_MM || c + dt.width_mm / 2 > L - DART_CORNER_MM) {
      fail('DART_MOUTH', k, `does not fit on its edge (keep ${DART_CORNER_MM} mm from the corners)`);
      continue;
    }
    if (!Array.isArray(dt.apex) || !Number.isFinite(dt.apex[0]) || !Number.isFinite(dt.apex[1])
      || !pointInPolygon(dt.apex, outline) || distToPolyline(dt.apex, outline, true).dist < DART_APEX_CLEAR_MM) {
      fail('DART_APEX', k, 'has its point outside the piece or on its edge');
      continue;
    }
    if (bad.has(k)) continue;
    const m = dartMouth(piece, dt);
    mouths[k] = { k, dart: dt, s0: c - dt.width_mm / 2, s1: c + dt.width_mm / 2, ta: m.ta, tb: m.tb, a: m.a, b: m.b, apex: dt.apex };
  }
  for (let i = 0; i < darts.length; i++) {
    const mi = mouths[i];
    if (!mi) continue;
    for (let j = i + 1; j < darts.length; j++) {
      const mj = mouths[j];
      if (!mj || mj.dart.edge !== mi.dart.edge) continue;
      if (mi.s0 < mj.s1 + DART_GAP_MM && mj.s0 < mi.s1 + DART_GAP_MM) {
        fail('DART_OVERLAP', j, `overlaps dart ${i + 1} on the same edge`);
        mouths[j] = null;
      }
    }
  }
  /** @param {number[]} ks */
  const simpleWith = (ks) => isSimplePolygon(flattenPiece(applyDarts(piece, ks).piece, FLAT_TOL_MM).points);
  for (let k = 0; k < darts.length; k++) {
    if (mouths[k] && !simpleWith([k])) { fail('DART_CROSSES', k, 'crosses the outline'); mouths[k] = null; }
  }
  for (let i = 0; i < darts.length; i++) {
    for (let j = i + 1; j < darts.length; j++) {
      if (mouths[i] && mouths[j] && !simpleWith([i, j])) { fail('DART_CROSSES', j, `crosses dart ${i + 1}`); mouths[j] = null; }
    }
  }
  for (const nt of (piece.notches || [])) {
    for (const m of mouths) {
      if (m && nt.edge === m.dart.edge && nt.t > m.ta && nt.t < m.tb) {
        issues.push({ level: 'warn', code: 'DART_NOTCH', pieceId: piece.id, edge: nt.edge, message: `${name}: a notch lies inside dart ${m.k + 1} and is ignored` });
      }
    }
  }
  const res = { issues, bad };
  CHECK_CACHE.set(piece, { sig, res });
  return res;
}

/** Indices of the darts everything uses: the ones checkDarts accepts. @param {Piece} piece @returns {number[]} */
export function validDartIndices(piece) {
  const darts = dartsOf(piece);
  if (darts.length === 0) return [];
  const { bad } = checkDarts(piece);
  /** @type {number[]} */
  const out = [];
  for (let k = 0; k < darts.length; k++) if (!bad.has(k)) out.push(k);
  return out;
}

/** The valid darts of edge e with their mouths, sorted along the edge. @param {Piece} piece @param {number} e @returns {Mouth[]} */
export function mouthsOn(piece, e) {
  const darts = dartsOf(piece);
  if (darts.length === 0) return [];
  /** @type {Mouth[]} */
  const out = [];
  for (const k of validDartIndices(piece)) {
    const dt = darts[k];
    if (dt.edge !== e) continue;
    const m = dartMouth(piece, dt);
    out.push({ k, dart: dt, s0: m.ta * m.L, s1: m.tb * m.L, ta: m.ta, tb: m.tb, a: m.a, b: m.b, apex: [dt.apex[0], dt.apex[1]] });
  }
  out.sort((p, q) => p.s0 - q.s0);
  return out;
}

/** Arc length of edge e less the intake of its valid darts, mm. @param {Piece} piece @param {number} e @returns {number} */
export function sewnLength(piece, e) {
  let L = edgeLength(piece, e);
  for (const m of mouthsOn(piece, e)) L -= m.s1 - m.s0;
  return L;
}

/**
 * Sewn fraction u of the edge point at arc-length fraction t. A point inside a mouth maps to the mouth's u.
 * @param {Piece} piece @param {number} e @param {number} t @returns {number}
 */
export function edgeToSewn(piece, e, t) {
  const mouths = mouthsOn(piece, e);
  if (mouths.length === 0) return t;
  const L = edgeLength(piece, e);
  let Ls = L;
  for (const m of mouths) Ls -= m.s1 - m.s0;
  const s = t * L;
  let removed = 0;
  for (const m of mouths) {
    if (s <= m.s0) break;
    if (s < m.s1) return Ls > 0 ? (m.s0 - removed) / Ls : 0;
    removed += m.s1 - m.s0;
  }
  return Ls > 0 ? Math.min(1, Math.max(0, (s - removed) / Ls)) : 0;
}

/**
 * Arc-length fraction(s) of the edge point at sewn fraction u: one, or [A, B] when u is exactly a mouth of this edge.
 * @param {Piece} piece @param {number} e @param {number} u @returns {number[]}
 */
export function sewnToEdge(piece, e, u) {
  const mouths = mouthsOn(piece, e);
  if (mouths.length === 0) return [u];
  const L = edgeLength(piece, e);
  let Ls = L;
  for (const m of mouths) Ls -= m.s1 - m.s0;
  const target = u * Ls;
  const tol = 1e-9 * Math.max(1, Ls);
  let removed = 0;
  for (const m of mouths) {
    const sm = m.s0 - removed;
    if (Math.abs(target - sm) <= tol) return [m.ta, m.tb];
    if (target < sm) return [(target + removed) / L];
    removed += m.s1 - m.s0;
  }
  return [Math.min(1, (target + removed) / L)];
}

/** Sewn fractions of the valid mouths of edge e, in order. @param {Piece} piece @param {number} e @returns {number[]} */
export function mouthFractions(piece, e) {
  const mouths = mouthsOn(piece, e);
  if (mouths.length === 0) return [];
  let Ls = edgeLength(piece, e);
  for (const m of mouths) Ls -= m.s1 - m.s0;
  /** @type {number[]} */
  const out = [];
  let removed = 0;
  for (const m of mouths) {
    out.push(Ls > 0 ? (m.s0 - removed) / Ls : 0);
    removed += m.s1 - m.s0;
  }
  return out;
}

/** Is arc-length fraction t strictly inside a valid mouth of edge e? @param {Piece} piece @param {number} e @param {number} t @returns {boolean} */
export function insideMouth(piece, e, t) {
  for (const m of mouthsOn(piece, e)) if (t > m.ta && t < m.tb) return true;
  return false;
}
```

- [ ] **Step 4: Export the API and carry darts through a split and a mirror**

`src/geometry/index.js`, add:

```js
export {
  dartMouth, dartDrillPoint, checkDarts, validDartIndices, mouthsOn, sewnLength, edgeToSewn, sewnToEdge, mouthFractions,
  insideMouth, applyDarts, DART_CORNER_MM, DART_GAP_MM, DART_APEX_CLEAR_MM, DART_MIN_WIDTH_MM, DART_DRILL_BACK_MM,
} from './darts.js';
```

`src/geometry/bezier.js` `splitEdge`: after the `out.notches = …;` statement, add:

```js
  // darts follow their edge like notches: a mouth's centre keeps its arc length, so t rescales (SPEC 5.10)
  out.darts = (piece.darts || []).map((dt) => {
    const copy = { id: dt.id, edge: dt.edge, t: dt.t, width_mm: dt.width_mm, apex: /** @type {Vec2} */ ([dt.apex[0], dt.apex[1]]) };
    if (dt.edge === e) {
      if (dt.t <= tt) copy.t = tt > 0 ? dt.t / tt : 0;
      else { copy.edge = e + 1; copy.t = (dt.t - tt) / (1 - tt); }
    } else if (dt.edge > e) {
      copy.edge = dt.edge + 1;
    }
    return copy;
  });
```

Also update its doc comment: `notches and darts re-parametrised`.

`src/geometry/mirror.js` `mirrorPiece`, before `return out;`:

```js
  /** @type {import('../core/types.js').Dart[]} */
  const darts = [];
  for (const dt of (piece.darts || [])) {
    if (of0[dt.edge] !== undefined && of0[dt.edge] >= 0) darts.push({ ...dt, edge: of0[dt.edge], apex: [dt.apex[0], dt.apex[1]] });
    if (full.foldX !== null && of1[dt.edge] !== undefined && of1[dt.edge] >= 0) {
      darts.push({ ...dt, id: dt.id + '_m', edge: of1[dt.edge], t: 1 - dt.t, apex: mirrorPoint(dt.apex, full.foldX) });
    }
  }
  out.darts = darts;
```

and extend its doc comment to say darts are duplicated onto the mirrored copies too.

- [ ] **Step 5: Run the tests to see them pass**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module geometry`

Expected: PASS for `darts.mouth`, `darts.apply`, `darts.check`, `darts.carry` and every earlier geometry case.

- [ ] **Step 6: Amend SPEC.md and commit**

Add `### 5.10 darts.js — darts on an outline edge (amendment YYYY-MM-DD "Darts")` after §5.9. Its body:
- the export list of the Interfaces block above, with one line each;
- the validation rules of spec §3.3 (codes and constants);
- "only valid darts are used anywhere".

```bash
git add src/geometry/darts.js src/geometry/index.js src/geometry/bezier.js src/geometry/mirror.js src/geometry/selftest.js docs/SPEC.md
git commit -m "Add the geometry of darts: mouths, sewn lengths and validation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Mesh darted pieces — sewn-fraction seam sampling, V in the boundary, `edgeFrac` / `dartVerts`

**Files:**
- Modify: `src/geometry/remesh.js` (imports, `nodeKey`, `seamSampleFractions`, `remeshPiece` sections 3 and 9 and the return value; new helper `edgeChain`)
- Modify: `docs/SPEC.md` §5.6 (amendment block)
- Test: `src/geometry/selftest.js`

**Interfaces:**
- Consumes: `mouthsOn`, `sewnLength`, `edgeToSewn`, `sewnToEdge`, `mouthFractions`, `insideMouth`, `checkDarts` (Task 2).
- Produces:
  - `seamSampleFractions(piece, edge, doc, spacingFactor)` now returns **sewn** fractions (same signature).
  - `remeshPiece` returns `edgeFrac` and `dartVerts` (Task 1 typedefs). On darted edges `edgeVerts` holds A and B.

- [ ] **Step 1: Write the failing tests**

In `src/geometry/selftest.js` add `seamSampleFractions` to the index import and add:

```js
/** @returns {SelfTestResult} */
function caseRemeshDartNarrow() {
  const p = makePiece({ id: 'nd', vertices: [[0, 0], [200, 0], [200, 300], [0, 300]],
    darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 20, apex: [100, 100] }] });
  const m = remeshPiece(p, { pieces: [p], seams: [] });
  const { euler } = eulerOf(m);
  const legs = m.dartVerts[0][0];
  const F = seamSampleFractions(p, 0, { pieces: [p], seams: [] });
  const apexShared = legs.a.length === legs.b.length && legs.a.length >= 3 && legs.a[legs.a.length - 1] === legs.b[legs.b.length - 1] && legs.a[0] !== legs.b[0];
  const counts = m.edgeVerts[0][0].length === F.length + 1 && m.edgeFrac[0][0].length === F.length + 1;
  const area = Math.abs(m.area_mm2 - (60000 - 1000)) < 50;
  const pass = euler === 1 && m.quality.pctAbove20 >= 98 && apexShared && counts && area;
  return { name: 'remesh.dartNarrow', pass, details: `Euler ${euler}, pctAbove20 ${f(m.quality.pctAbove20, 1)}, legs ${legs.a.length}/${legs.b.length}, edge samples ${m.edgeVerts[0][0].length} (F ${F.length}), area ${f(m.area_mm2, 0)}` };
}

/** @returns {SelfTestResult} */
function caseRemeshDartSeam() {
  // A's top edge (e2, right -> left) carries a dart; B's bottom edge (e0, left -> right) is 180 mm = A's sewn length
  const A = makePiece({ id: 'A', vertices: [[0, 0], [200, 0], [200, 100], [0, 100]],
    darts: [{ id: 'd', edge: 2, t: 0.4, width_mm: 20, apex: [120, 40] }] });
  const B = makePiece({ id: 'B', vertices: [[0, 150], [180, 150], [180, 250], [0, 250]] });
  const seams = [{ id: 's', kind: 'plain', a: { pieceId: 'A', edge: 2, mirror: false, reverse: false }, b: { pieceId: 'B', edge: 0, mirror: false, reverse: true } }];
  const doc = { pieces: [A, B], seams };
  const FA = seamSampleFractions(A, 2, doc);
  const FB = seamSampleFractions(B, 0, doc);
  const mirrored = FA.length === FB.length && FA.every((u, i) => Math.abs(u - (1 - FB[FB.length - 1 - i])) < 1e-9);
  const mA = remeshPiece(A, doc);
  const mB = remeshPiece(B, doc);
  const fr = Array.from(mA.edgeFrac[0][2]);
  const doubled = fr.filter((u, i) => i > 0 && Math.abs(u - fr[i - 1]) < 1e-12).length;
  // a dart on B too, somewhere else: both sides get one extra vertex, and the u sets still agree
  const B2 = { ...B, darts: [{ id: 'e', edge: 0, t: 0.25, width_mm: 10, apex: [45, 200] }] };
  const A2 = { ...A, vertices: [[0, 0], [210, 0], [210, 100], [0, 100]], darts: [{ id: 'd', edge: 2, t: 0.4, width_mm: 20, apex: [126, 40] }] };
  const doc2 = { pieces: [A2, B2], seams };
  const mA2 = remeshPiece(A2, doc2);
  const mB2 = remeshPiece(B2, doc2);
  /** @param {ArrayLike<number>} fa @returns {number[]} the distinct fractions (a mouth's two corners share one) */
  const distinct = (fa) => Array.from(fa).filter((u, i, all) => i === 0 || Math.abs(u - all[i - 1]) > 1e-12);
  const uA = distinct(mA2.edgeFrac[0][2]);
  const uB = distinct(mB2.edgeFrac[0][0]).map((u) => 1 - u).reverse();
  const both = mA2.edgeVerts[0][2].length === uA.length + 1 && mB2.edgeVerts[0][0].length === uB.length + 1
    && uA.length === uB.length && uA.every((u, i) => Math.abs(u - uB[i]) < 1e-9);
  const pass = mirrored && mA.edgeVerts[0][2].length === mB.edgeVerts[0][0].length + 1 && doubled === 1 && both;
  return { name: 'remesh.dartSeam', pass, details: `fractions mirror ${mirrored}; A ${mA.edgeVerts[0][2].length} vs B ${mB.edgeVerts[0][0].length}; doubled u ${doubled}; darts on both sides agree ${both}` };
}
```

Add both to `CASES` and their names to `listSelfTests()`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module geometry`

Expected: FAIL in `remesh.dartNarrow` ("Cannot read properties of undefined (reading '0')" on `m.dartVerts`) and in `remesh.dartSeam`.

- [ ] **Step 3: Change `remesh.js`**

- Imports: add `import { mouthsOn, sewnLength, edgeToSewn, sewnToEdge, mouthFractions, insideMouth, checkDarts } from './darts.js';` and add `pointAtArcFraction` to the `./bezier.js` import.
- `nodeKey`: the separator on line 66 is a raw NUL byte, which makes git treat the file as binary. Replace the function body with `return pieceId + '\u0000' + edge;` (the same character, now escaped).
- `seamSampleFractions`:
  - Replace the doc comment's first sentence with `Seam-consistent SEWN fractions u (arc length with dart mouths removed, SPEC 5.6 amendment "Darts") for one outline edge (sorted, starts with 0, ends with 1).`
  - Replace `const L = edgeLength(piece, edgeIndex);` with `const L = sewnLength(piece, edgeIndex);`.
  - Replace everything from `let count;` down to (but not including) `const tol = NOTCH_MERGE / count;` with:

```js
  let count;
  /** @type {number[]} forced samples: notches and dart mouths of every edge of the component, in this edge's u */
  const forced = [];
  /** @param {Piece} pc @param {number} e @param {boolean} rev */
  const addForced = (pc, e, rev) => {
    for (const nt of (pc.notches || [])) {
      if (nt.edge !== e || !(nt.t > 0 && nt.t < 1) || insideMouth(pc, e, nt.t)) continue;
      const u = edgeToSewn(pc, e, nt.t);
      forced.push(rev ? 1 - u : u);
    }
    for (const u of mouthFractions(pc, e)) forced.push(rev ? 1 - u : u);
  };
  if (visited.size === 1) {
    count = Math.max(1, Math.ceil(L / h - 1e-9));
    addForced(piece, edgeIndex, false);
  } else {
    let maxRatio = 0;
    for (const node of visited.values()) {
      const Li = (node.piece === piece && node.edge === edgeIndex) ? L : sewnLength(node.piece, node.edge);
      const hi = node.piece === piece ? h : effectiveSpacing(node.piece, spacingFactor);
      const ratio = Li / hi;
      if (ratio > maxRatio) maxRatio = ratio;
      addForced(node.piece, node.edge, node.reverse);
    }
    count = Math.max(2, Math.ceil(maxRatio - 1e-9));
  }
  void n;
  const notchFractions = forced;
```

The rest of the function (`const tol = …` to the end) stays as it is: it already keeps forced samples and drops uniform ones near them. Change the push loop `for (let k = 0; k < notchFractions.length; k++) set.push(notchFractions[k]);` to `for (const fu of notchFractions) if (fu > 0 && fu < 1) set.push(fu);`.

- Add this helper above `remeshPiece`:

```js
/**
 * Samples of one outline edge from its start to its end at the sewn fractions `fr`. A fraction that is a mouth of one
 * of the edge's own darts gives A, the leg down to the apex, the apex, the other leg back up, and B (SPEC 5.6,
 * amendment "Darts"). `edgePos` / `frac` list the positions that are edge samples (A and B both) and their u; `legs`
 * give each dart's leg positions, mouth -> apex.
 * @param {Piece} piece @param {number} e @param {number[]} fr @param {number} h
 * @returns {{pts: Vec2[], edgePos: number[], frac: number[], legs: {k:number, a:number[], b:number[]}[]}}
 */
function edgeChain(piece, e, fr, h) {
  const n = piece.vertices.length;
  const p0 = piece.vertices[e];
  const edge = piece.edges[e];
  const p1 = piece.vertices[(e + 1) % n];
  const mouths = mouthsOn(piece, e);
  /** @type {Vec2[]} */
  const pts = [];
  /** @type {number[]} */
  const edgePos = [];
  /** @type {number[]} */
  const frac = [];
  /** @type {{k:number, a:number[], b:number[]}[]} */
  const legs = [];
  for (const u of fr) {
    const ts = sewnToEdge(piece, e, u);
    if (ts.length === 1) {
      edgePos.push(pts.length);
      frac.push(u);
      pts.push(pointAtArcFraction(p0, edge, p1, ts[0]));
      continue;
    }
    const m = mouths.find((mm) => Math.abs(mm.ta - ts[0]) < 1e-12);
    if (!m) throw remeshError(piece.id, 'internal', 'no dart mouth at u = ' + u + ' on edge ' + e);
    const A = m.a;
    const B = m.b;
    const X = m.apex;
    const nLeg = Math.max(2, Math.ceil(Math.max(Math.hypot(X[0] - A[0], X[1] - A[1]), Math.hypot(X[0] - B[0], X[1] - B[1])) / h - 1e-9));
    /** @type {number[]} */
    const legA = [];
    /** @type {number[]} */
    const legB = [];
    edgePos.push(pts.length); frac.push(u); legA.push(pts.length); pts.push([A[0], A[1]]);
    for (let i = 1; i < nLeg; i++) {
      legA.push(pts.length);
      pts.push([A[0] + (X[0] - A[0]) * i / nLeg, A[1] + (X[1] - A[1]) * i / nLeg]);
    }
    const apexPos = pts.length;
    legA.push(apexPos);
    pts.push([X[0], X[1]]);
    for (let i = nLeg - 1; i >= 1; i--) {
      legB.push(pts.length);
      pts.push([B[0] + (X[0] - B[0]) * i / nLeg, B[1] + (X[1] - B[1]) * i / nLeg]);
    }
    edgePos.push(pts.length); frac.push(u); legB.push(pts.length); pts.push([B[0], B[1]]);
    legB.reverse();
    legB.push(apexPos);
    legs.push({ k: m.k, a: legA, b: legB });
  }
  return { pts, edgePos, frac, legs };
}
```

- In `remeshPiece`:
  - Replace section 3 (from `// 3. boundary samples` to the line before `const notches =`) with the block below.
  - Replace the notch lookup that follows with the second block below.

```js
  // 3. boundary samples: each edge at its seam-consistent sewn fractions; a mouth of the edge's own darts becomes
  //    A → leg → apex → leg → B (SPEC 5.6, amendment "Darts"). An invalid dart is ignored and named in warnings.
  for (const issue of checkDarts(piece).issues) if (issue.level === 'error') warnings.push('dart-ignored: ' + issue.message);
  const F = new Array(n);
  /** @type {ReturnType<typeof edgeChain>[]} */
  const C = new Array(n);
  for (let e = 0; e < n; e++) {
    if (e === f) continue;
    F[e] = seamSampleFractions(piece, e, doc, factor);
    C[e] = edgeChain(piece, e, F[e], h);
  }
  /** @type {number[]} */
  const bxs = [];
  /** @type {number[]} */
  const bys = [];
  const start = new Int32Array(n).fill(-1);
  const startM = new Int32Array(n).fill(-1);
  if (f === null) {
    for (let e = 0; e < n; e++) {
      start[e] = bxs.length;
      const pts = C[e].pts;
      for (let j = 0; j < pts.length - 1; j++) { bxs.push(pts[j][0]); bys.push(pts[j][1]); }
    }
  } else {
    const foldX = piece.vertices[f][0];
    for (let k = 0; k < n - 1; k++) {
      const e = (f + 1 + k) % n;
      start[e] = bxs.length;
      const pts = C[e].pts;
      for (let j = 0; j < pts.length - 1; j++) { bxs.push(pts[j][0]); bys.push(pts[j][1]); }
    }
    for (let k = 0; k < n - 1; k++) {
      const e = (f - 1 - k + n) % n;
      startM[e] = bxs.length;
      const pts = C[e].pts;
      for (let j = pts.length - 1; j >= 1; j--) {
        const m = mirrorPoint(pts[j], foldX);
        bxs.push(m[0]); bys.push(m[1]);
      }
    }
  }
  const Nb = bxs.length;
  if (Nb < 3) throw remeshError(pieceId, 'outline', 'boundary has fewer than 3 samples');
  const bx = Float64Array.from(bxs);
  const by = Float64Array.from(bys);
  /** @type {Vec2[]} */
  const bpoly = new Array(Nb);
  for (let i = 0; i < Nb; i++) bpoly[i] = [bx[i], by[i]];
  if (!(signedArea(bpoly) > 0)) throw remeshError(pieceId, 'outline', 'full outline is not CCW');
  if (!isSimplePolygon(bpoly)) throw remeshError(pieceId, f !== null ? 'fold' : 'outline', 'full outline self-intersects');
  /** @param {number} e @param {number} j chain position @returns {number} */
  const idOf = (e, j) => (start[e] + j) % Nb;
  /** @param {number} e @param {number} j @returns {number} the mirrored copy's id (the copy is walked backwards) */
  const idOfM = (e, j) => (startM[e] + (C[e].pts.length - 1 - j)) % Nb;
  /** @type {Uint32Array[][]} */
  const edgeVerts = [new Array(n), f === null ? [] : new Array(n)];
  /** @type {Float64Array[][]} */
  const edgeFrac = [new Array(n), f === null ? [] : new Array(n)];
  for (let e = 0; e < n; e++) {
    if (e === f) {
      edgeVerts[0][e] = new Uint32Array(0);
      edgeFrac[0][e] = new Float64Array(0);
      if (f !== null) { edgeVerts[1][e] = new Uint32Array(0); edgeFrac[1][e] = new Float64Array(0); }
      continue;
    }
    const pos = C[e].edgePos;
    edgeVerts[0][e] = Uint32Array.from(pos, (j) => idOf(e, j));
    edgeFrac[0][e] = Float64Array.from(C[e].frac);
    if (f !== null) {
      edgeVerts[1][e] = Uint32Array.from(pos, (j) => idOfM(e, j));
      edgeFrac[1][e] = Float64Array.from(C[e].frac);
    }
  }
  const dartList = Array.isArray(piece.darts) ? piece.darts : [];
  const noLegs = () => ({ a: new Uint32Array(0), b: new Uint32Array(0) });
  /** @type {{a:Uint32Array, b:Uint32Array}[][]} */
  const dartVerts = [dartList.map(noLegs), f === null ? [] : dartList.map(noLegs)];
  for (let e = 0; e < n; e++) {
    if (e === f) continue;
    for (const leg of C[e].legs) {
      dartVerts[0][leg.k] = { a: Uint32Array.from(leg.a, (j) => idOf(e, j)), b: Uint32Array.from(leg.b, (j) => idOf(e, j)) };
      if (f !== null) dartVerts[1][leg.k] = { a: Uint32Array.from(leg.a, (j) => idOfM(e, j)), b: Uint32Array.from(leg.b, (j) => idOfM(e, j)) };
    }
  }
```

```js
  const notches = Array.isArray(piece.notches) ? piece.notches : [];
  /** @type {Uint32Array[]} */
  const notchVerts = [new Uint32Array(notches.length), new Uint32Array(f === null ? 0 : notches.length)];
  for (let k = 0; k < notches.length; k++) {
    const nt = notches[k];
    const e = nt.edge;
    if (typeof e !== 'number' || e < 0 || e >= n || e === f || !F[e]) {
      warnings.push('notch-on-fold');
      notchVerts[0][k] = 0;
      if (f !== null) notchVerts[1][k] = 0;
      continue;
    }
    const u = edgeToSewn(piece, e, nt.t);
    const fr = C[e].frac;
    let best = 0;
    let bestD = Infinity;
    for (let j = 0; j < fr.length; j++) {
      const d = Math.abs(fr[j] - u);
      if (d < bestD) { bestD = d; best = j; }
    }
    notchVerts[0][k] = edgeVerts[0][e][best];
    if (f !== null) notchVerts[1][k] = edgeVerts[1][e][best];
  }
```

  - In the invariants, replace the `edgeVerts count mismatch` loop with:

```js
  for (let e = 0; e < n; e++) {
    if (e === f) continue;
    const want = F[e].length + C[e].legs.length;
    if (edgeVerts[0][e].length !== want) throw remeshError(pieceId, 'internal', 'edgeVerts count mismatch on edge ' + e);
    if (f !== null && edgeVerts[1][e].length !== want) throw remeshError(pieceId, 'internal', 'mirrored edgeVerts count mismatch on edge ' + e);
  }
```

  - In the returned object add `edgeFrac,` after `edgeVerts,` and `dartVerts,` after `notchVerts,`.
  - Delete the now-unused `P` array and the `edgeLength` / `sampleSegmentAt` imports if nothing else uses them. Run a search in the file first.

- [ ] **Step 4: Run the tests to see them pass**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module geometry`

Expected: PASS for `remesh.dartNarrow`, `remesh.dartSeam`, and every earlier case, especially `remesh.seamParity`, `remesh.allSamples` and `remesh.sleeve`, which must be unchanged.
- If `remesh.dartNarrow` fails only on `pctAbove20`, do NOT lower 98. Print the per-triangle angles near the apex, then fix the sampling. For example, sample each leg with `nLeg = ceil(len / (0.8·h))` so the leg points match the lattice's 0.6h clearance. Then re-run.

- [ ] **Step 5: Check git sees the mesher as text, amend SPEC.md, commit**

Run: `git diff --stat -- src/geometry/remesh.js`

Expected: a line count such as `src/geometry/remesh.js | 180 ++++---`, not `Bin`.

Add to SPEC §5.6 an amendment block. It says:
- `seamSampleFractions` returns sewn fractions;
- an edge's own mouths are forced samples, as are the component's other mouths and notches;
- a mouth adds A, the legs and B to the boundary (legs sampled uniformly, `nLeg = max(2, ceil(max leg length / h))`, sharing the apex);
- `edgeFrac` and `dartVerts` are filled as typed;
- invalid darts are ignored with a `dart-ignored:` warning.

```bash
git add src/geometry/remesh.js src/geometry/selftest.js docs/SPEC.md
git commit -m "Mesh darted pieces: sample seams by sewn length and cut each dart's V into the boundary" -m "The mesher's node key held a raw NUL byte, which made git treat the file as binary; it is now written as an escape." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Sew by sewn fraction, and sew every dart (cloth)

**Files:**
- Create: `src/cloth/pairing.js`
- Modify: `src/cloth/state.js:303-329` (section 5, seams), `src/cloth/fixtures.js` (new `makeDartTubeFixture`), `src/cloth/index.js` (exports)
- Modify: `docs/SPEC.md` §7.1 (amendment block)
- Test: `src/cloth/selftest.js`

**Interfaces:**
- Consumes: `PieceMesh.edgeFrac`, `PieceMesh.dartVerts` (Task 3); the lattice fixtures have neither and keep index pairing.
- Produces:
  - `pairByIndex(va, vb, reverse) → number[]|null`
  - `pairByFraction(va, fa, vb, fb, reverse) → number[]|null`
  - `FRACTION_EPS = 1e-6`
  - `makeDartTubeFixture({fabric, spacing_mm}) → {state, legs}`
  - dart pairs appended to `sIdx` after the seam pairs.

- [ ] **Step 1: Write the failing tests**

In `src/cloth/selftest.js` add `pairByFraction, pairByIndex, makeDartTubeFixture` to the `./index.js` import. Before the final `return results;` add:

```js
  check('seam.pairByFraction', () => {
    const p0 = pairByFraction([0, 1, 2], [0, 0.5, 1], [10, 11, 12], [0, 0.5, 1], false);
    assert(!!p0 && p0.join() === '0,10,1,11,2,12', 'plain: ' + p0);
    assert(pairByFraction([0, 1, 2], [0, 0.5, 1], [10, 11, 12], [0, 0.25, 1], true) === null, 'mismatched fractions must not pair');
    const p2 = pairByFraction([0, 1, 2], [0, 0.25, 1], [10, 11, 12], [0, 0.75, 1], true);
    assert(!!p2 && p2.join() === '0,12,1,11,2,10', 'reversed: ' + p2);
    const p3 = pairByFraction([0, 1, 2, 3], [0, 0.5, 0.5, 1], [10, 11, 12], [0, 0.5, 1], false);
    assert(!!p3 && p3.join() === '0,10,1,11,2,11,3,12', 'mouth on a: ' + p3);
    const p4 = pairByFraction([0, 1, 2, 3], [0, 0.5, 0.5, 1], [10, 11, 12, 13], [0, 0.5, 0.5, 1], false);
    assert(!!p4 && p4.join() === '0,10,1,11,2,12,3,13', 'mouths on both: ' + p4);
    const p5 = pairByFraction([0, 1, 2], [0, 0.4, 1], [10, 11, 12, 13], [0, 0.6, 0.6, 1], true);
    assert(!!p5 && p5.join() === '0,13,1,12,1,11,2,10', 'mouth on reversed b: ' + p5);
    assert(pairByIndex([0, 1], [5, 6, 7], false) === null, 'index pairing needs equal lengths');
    return '6 pairings';
  });

  check('dart.tube', () => {
    const { state, legs } = makeDartTubeFixture({ fabric: fab('cotton'), spacing_mm: 10 });
    const S = state.sIdx.length / 2;
    assert(S === legs.a.length, 'dart legs give ' + S + ' seam pairs, want ' + legs.a.length);
    for (let i = 0; i < 120; i++) step(state, null);
    let worst = 0;
    for (let s = 0; s < S; s++) {
      const a = state.sIdx[2 * s]; const b = state.sIdx[2 * s + 1];
      const d = Math.hypot(state.pos[3 * a] - state.pos[3 * b], state.pos[3 * a + 1] - state.pos[3 * b + 1], state.pos[3 * a + 2] - state.pos[3 * b + 2]);
      if (d > worst) worst = d;
    }
    let zMin = Infinity; let zMax = -Infinity;
    for (let v = 0; v < state.V; v++) { const z = state.pos[3 * v + 2]; if (z < zMin) zMin = z; if (z > zMax) zMax = z; }
    assert(state.nanCount === 0 && allFinite(state), 'NaN in the tube');
    assert(worst < 0.002, 'dart legs still ' + f(worst * 1000) + ' mm apart at frame 120 (want < 2)');
    assert(zMax - zMin > 0.010, 'the sheet stayed flat: out-of-plane spread ' + f((zMax - zMin) * 1000) + ' mm (want > 10)');
    return 'gap ' + f(worst * 1000) + ' mm, spread ' + f((zMax - zMin) * 1000) + ' mm';
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module cloth`

Expected: FAIL. `cloth/import` fails because `pairByFraction` is not exported.

- [ ] **Step 3: Write `src/cloth/pairing.js`**

```js
// src/cloth/pairing.js — which vertex of one seam side is sewn to which vertex of the other (SPEC 7.1, amendment
// "Darts"). Pure; no imports.
//
// Without darts both sides of a seam have the same number of samples and vertex i meets vertex i (or N−1−i when the
// seam is reversed). A dart mouth on a side is ONE sewn position carried by TWO vertices (its corners A and B, which the
// dart's own seam pulls together), so the sides are walked by sewn fraction instead: equal fractions meet, and a corner
// pair meets whatever the other side has at that position.

/** Two sewn fractions closer than this are the same position. */
export const FRACTION_EPS = 1e-6;

/**
 * Index pairing of two equal-length sides (meshes without edgeFrac, such as the lattice fixtures).
 * @param {ArrayLike<number>} va @param {ArrayLike<number>} vb @param {boolean} reverse
 * @returns {number[]|null} flat [a0, b0, a1, b1, …] local ids; null when the lengths differ
 */
export function pairByIndex(va, vb, reverse) {
  const N = va.length;
  if (N !== vb.length || N < 2) return null;
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < N; i++) out.push(va[i], vb[reverse ? N - 1 - i : i]);
  return out;
}

/**
 * Pair two seam sides by their sewn fractions (PieceMesh.edgeFrac). Side b is read backwards, with u ↦ 1 − u, when the
 * seam is reversed. At each shared fraction: one vertex each → one pair; a mouth against one vertex → both corners to
 * that vertex; a mouth against a mouth → corner to corner in walk order.
 * @param {ArrayLike<number>} va @param {ArrayLike<number>} fa @param {ArrayLike<number>} vb @param {ArrayLike<number>} fb
 * @param {boolean} reverse
 * @returns {number[]|null} flat [a, b, a, b, …] local ids; null when the fraction lists do not match
 */
export function pairByFraction(va, fa, vb, fb, reverse) {
  const na = va.length;
  const nb = vb.length;
  if (na < 2 || nb < 2 || fa.length !== na || fb.length !== nb) return null;
  /** @param {number} j @returns {number} */
  const bId = (j) => vb[reverse ? nb - 1 - j : j];
  /** @param {number} j @returns {number} */
  const bU = (j) => (reverse ? 1 - fb[nb - 1 - j] : fb[j]);
  /** @type {number[]} */
  const out = [];
  let i = 0;
  let j = 0;
  while (i < na && j < nb) {
    const u = fa[i];
    if (Math.abs(u - bU(j)) > FRACTION_EPS) return null;
    const twoA = i + 1 < na && Math.abs(fa[i + 1] - u) <= FRACTION_EPS;
    const twoB = j + 1 < nb && Math.abs(bU(j + 1) - u) <= FRACTION_EPS;
    if (twoA && twoB) out.push(va[i], bId(j), va[i + 1], bId(j + 1));
    else if (twoA) out.push(va[i], bId(j), va[i + 1], bId(j));
    else if (twoB) out.push(va[i], bId(j), va[i], bId(j + 1));
    else out.push(va[i], bId(j));
    i += twoA ? 2 : 1;
    j += twoB ? 2 : 1;
  }
  return (i === na && j === nb) ? out : null;
}
```

- [ ] **Step 4: Use it in `state.js`, add the fixture, export**

- `src/cloth/state.js`: add `import { pairByFraction, pairByIndex } from './pairing.js';`.
- Replace the body of section 5 from `const seamPairs = [];` down to `const S = seamPairs.length / 2;` (exclusive) with:

```js
  // 5. seams — paired by sewn fraction when the meshes carry it (SPEC 7.1, amendment "Darts"), else by index; then
  //    every dart's legs, corner to corner, down to the shared apex (identical ids are skipped)
  /** @type {number[]} */
  const seamPairs = [];
  for (const seam of docSeams) {
    if (!seam || !seam.a || !seam.b) continue;
    const ka = pieceIndexById.get(seam.a.pieceId);
    const kb = pieceIndexById.get(seam.b.pieceId);
    if (ka === undefined || kb === undefined) continue; // a side is not simulated
    const ma = pieces[ka].mesh;
    const mb = pieces[kb].mesh;
    const ia = seam.a.mirror ? 1 : 0;
    const ib = seam.b.mirror ? 1 : 0;
    const va = (ma.edgeVerts[ia] || [])[seam.a.edge];
    const vb = (mb.edgeVerts[ib] || [])[seam.b.edge];
    if (!va || !vb) {
      throw clothError('seam-edge', 'buildCloth: seam ' + seam.id + ' references a missing edge sample list', { seamId: seam.id });
    }
    const fa = ma.edgeFrac ? (ma.edgeFrac[ia] || [])[seam.a.edge] : null;
    const fb = mb.edgeFrac ? (mb.edgeFrac[ib] || [])[seam.b.edge] : null;
    const reverse = !!(seam.a.reverse || seam.b.reverse);
    const local = (fa && fb) ? pairByFraction(va, fa, vb, fb, reverse) : pairByIndex(va, vb, reverse);
    if (!local) {
      throw clothError('seam-parity', 'buildCloth: seam ' + seam.id + ' sides have ' + va.length + ' / ' + vb.length + ' vertices at different sewn positions', { seamId: seam.id });
    }
    for (let i = 0; i < local.length; i += 2) {
      const gi = pieces[ka].start + local[i];
      const gj = pieces[kb].start + local[i + 1];
      if (gi === gj) continue;
      seamPairs.push(gi, gj);
    }
  }
  for (const pc of pieces) {
    const dv = pc.mesh.dartVerts;
    if (!Array.isArray(dv)) continue;
    for (const list of dv) {
      for (const legs of (list || [])) {
        if (!legs || legs.a.length < 2 || legs.a.length !== legs.b.length) continue;
        for (let i = 0; i < legs.a.length; i++) {
          const gi = pc.start + legs.a[i];
          const gj = pc.start + legs.b[i];
          if (gi !== gj) seamPairs.push(gi, gj);
        }
      }
    }
  }
```

- `src/cloth/fixtures.js`, after `makeSeamFixture`:

```js
/**
 * A 100 × 150 mm sheet whose left and right columns are declared as the two legs of one dart (`dartVerts`), floating
 * with gravity 0: sewing the legs rolls the sheet into a tube. Dart fixture — the legs must meet and the sheet must stop
 * being flat. A 1 mm sine bulge picks the side it rolls to. Self-collision off.
 * @param {{fabric: FabricResolved, spacing_mm: number}} args
 * @returns {{state: ClothState, legs: {a: Uint32Array, b: Uint32Array}}}
 */
export function makeDartTubeFixture(args) {
  const { fabric, spacing_mm } = args;
  const nx = Math.round(100 / spacing_mm) + 1;
  const ny = Math.round(150 / spacing_mm) + 1;
  const base = makeLatticeMesh({ nx, ny, spacing_mm, x0_mm: -50, y0_mm: 75, pieceId: 'tube', stagger: false });
  const a = new Uint32Array(ny);
  const b = new Uint32Array(ny);
  for (let r = 0; r < ny; r++) { a[r] = r * nx; b[r] = r * nx + nx - 1; }
  const legs = { a, b };
  const mesh = /** @type {PieceMesh} */ ({ ...base, dartVerts: [[legs], []] });
  const state = buildFromLattices([mesh], fabric, { selfCollision: false, sewTime_s: 1, gravity_ms2: 0 }, []);
  const pos = state.pos;
  const p2 = mesh.positions2d;
  for (let v = 0; v < mesh.vertexCount; v++) {
    pos[3 * v] = p2[2 * v] / 1000;
    pos[3 * v + 1] = p2[2 * v + 1] / 1000;
    pos[3 * v + 2] = 0.001 * Math.sin(Math.PI * (v % nx) / (nx - 1));
  }
  commitPositions(state, null);
  return { state, legs };
}
```

- `src/cloth/index.js`: export `pairByFraction, pairByIndex, FRACTION_EPS` from `./pairing.js`, and `makeDartTubeFixture` alongside the other fixtures. Follow the existing export blocks.

- [ ] **Step 5: Run the tests to see them pass**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module cloth --module geometry`

Expected: PASS for `seam.pairByFraction`, `dart.tube`, and every earlier cloth case (the seam fixture still uses index pairing).

Then run the drape checks, which must be unchanged:

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --only acceptance --checks "^(08|09|17)$"`

Expected: PASS.

- [ ] **Step 6: Amend SPEC.md and commit**

§7.1 amendment block. It covers:
- the pairing rule (pairs by `edgeFrac` when present, else by index; the walking rules; `seam-parity` when the u lists differ);
- dart legs pair `a[i]` with `b[i]`, appended after the seam pairs;
- dart pairs share the sewing ramp, exclusions, mask, statistics and tear detection.

```bash
git add src/cloth/pairing.js src/cloth/state.js src/cloth/fixtures.js src/cloth/index.js src/cloth/selftest.js docs/SPEC.md
git commit -m "Pair seams by sewn fraction and sew every dart's legs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Pattern model — sewn-length ease, dart issues, piece operations carry darts

**Files:**
- Modify: `src/pattern/seams.js:108-113` (`sideLength`) and add `sewnLengthOf`
- Modify: `src/pattern/validate.js:71-166` (`validatePiece`)
- Modify: `src/pattern/editor.js`: `clonePieceLocal` 72-84, `opTranslate` 95-122, `opSplitEdge` 128-152, `opDeleteVertex` 163-209, `opReflectX` 215-257, and selection handling at 374-376, 496-506, 558-572, 592-614
- Modify: `src/pattern/render2d.js:77-148` (`applyOverrides`, dragOffset)
- Modify: `src/pattern/index.js` (export `sewnLengthOf`)
- Modify: `src/ui/panels/pieces.js:229-256` (Duplicate), `src/app/debugApi.js:396-417` (`translatePiece`), `src/app/wiring.js:1102-1109` (`importDxf` layout)
- Modify: `docs/SPEC.md` §11.11 (amendment block)
- Test: `src/pattern/selftest.js`

**Interfaces:**
- Consumes: `sewnLength`, `checkDarts`, `dartMouth` (Task 2); `splitEdge` remaps darts (Task 2).
- Produces:
  - `sewnLengthOf(piece, e)` (cached like `edgeLengthOf`); `seamEase` and `seamLengths` use sewn lengths.
  - `validatePiece` includes `checkDarts` issues.
  - The piece ops keep darts consistent. `opSplitEdge` throws `PATTERN_SPLIT_IN_DART` when the split point is inside a mouth.
  - The editor selection carries `dart: {pieceId, index}|null`.

- [ ] **Step 1: Write the failing tests**

In `src/pattern/selftest.js` extend the imports: `opTranslate, opDeleteVertex, opReflectX` from `./editor.js` and `sewnLengthOf` from `./seams.js`. Before the last `return results;` of `runSelfTest`, add:

```js
  await run('darts-model', (h) => {
    const id = addRect(h, 0, 0, 200, 300);
    h.store.update((d) => { d.pieces[0].darts = [{ id: 'd', edge: 0, t: 0.5, width_mm: 20, apex: [100, 100] }]; }, 'test:dart');
    let p = pieceOf(h.doc(), id);
    near(sewnLengthOf(p, 0), 180, 1e-9, 'sewn length of the darted edge');
    const b = addRect(h, 0, 400, 180, 100);
    h.editor.addSeam({ pieceId: id, edge: 0, mirror: false, reverse: false }, { pieceId: b, edge: 0, mirror: false, reverse: false });
    const seam = h.doc().seams[0];
    near(seamEase(h.doc(), seam).easePct, 0, 1e-9, 'darted 200 vs plain 180: ease 0');
    const moved = opTranslate(p, 10, -5);
    near(moved.darts[0].apex[0], 110, 1e-9, 'translate moves the apex x');
    near(moved.darts[0].apex[1], 95, 1e-9, 'translate moves the apex y');
    assert(p.darts[0].apex[0] === 100, 'translate must not mutate the original');
    const split = opSplitEdge(p, 0, 0.25);
    assert(split.piece.darts[0].edge === 1, 'a split before the dart moves it to the second half');
    let refused = null;
    try { opSplitEdge(p, 0, 0.5); } catch (e) { refused = e.code; }
    assert(refused === 'PATTERN_SPLIT_IN_DART', 'a split inside a mouth is refused, got ' + refused);
    const del = opDeleteVertex(p, 1);
    assert(del.piece.darts.length === 0, 'deleting a corner of the darted edge drops the dart');
    const r = opReflectX(p).piece;
    const rd = r.darts[0];
    near(rd.apex[0], -100, 1e-9, 'reflect mirrors the apex');
    near(rd.t, 0.5, 1e-9, 'reflect keeps a centred dart centred');
    assert(r.edges.length === 4 && rd.edge === 3, 'reflect maps the edge (n-1-e): got ' + rd.edge);
    h.store.update((d) => { d.pieces[0].darts[0].apex = [100, 400]; }, 'test:bad dart');
    p = pieceOf(h.doc(), id);
    assert(validateDoc(h.doc()).some((i) => i.code === 'DART_APEX' && i.pieceId === id), 'validateDoc reports DART_APEX');
    return 'sewn ease, translate, split, delete, reflect, validate';
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module pattern`

Expected: FAIL. Either `pattern/import` fails (`sewnLengthOf` is not exported) or `darts-model` fails.

- [ ] **Step 3: Implement**

`src/pattern/seams.js`: import `sewnLength` from `../geometry/index.js`, then add after `edgeLengthOf`:

```js
/** @type {WeakMap<object, Map<number, number>>} */
const SEWN_CACHE = new WeakMap();

/**
 * Sewn length of outline edge e: its arc length less the intake of its valid darts (SPEC 11.11 amendment "Darts"). This
 * is what a seam compares. Cached per piece object identity.
 * @param {Piece} piece @param {number} e @returns {number}
 */
export function sewnLengthOf(piece, e) {
  if (!piece || !Array.isArray(piece.vertices)) return 0;
  const n = piece.vertices.length;
  if (!(e >= 0 && e < n)) return 0;
  if (!Array.isArray(piece.darts) || piece.darts.length === 0) return edgeLengthOf(piece, e);
  let map = SEWN_CACHE.get(piece);
  if (!map) { map = new Map(); SEWN_CACHE.set(piece, map); }
  const cached = map.get(e);
  if (cached !== undefined) return cached;
  const len = sewnLength(piece, e);
  map.set(e, len);
  return len;
}
```

and in `sideLength` replace `return edgeLengthOf(piece, side.edge);` with `return sewnLengthOf(piece, side.edge);`.

`src/pattern/validate.js`:
- import `checkDarts` from `../geometry/index.js`;
- in `validatePiece`, just before `return out;`, add `for (const issue of checkDarts(piece).issues) out.push(issue);`.

`src/pattern/editor.js`:
- Add `validDartIndices, dartMouth` to the geometry import.
- In `clonePieceLocal` add `darts: (piece.darts || []).map((d) => ({ id: d.id, edge: d.edge, t: d.t, width_mm: d.width_mm, apex: cp(d.apex) })),`.
- In `opTranslate`, after the internal-lines loop, add:

```js
  for (const d of out.darts) {
    d.apex[0] += dx;
    d.apex[1] += dy;
  }
```

- In `opSplitEdge`, directly after the line `const tt = clamp(t, 0.02, 0.98);`, add:

```js
  for (const k of validDartIndices(piece)) {
    const dt = piece.darts[k];
    if (dt.edge !== e) continue;
    const m = dartMouth(piece, dt);
    if (tt > m.ta - 1e-9 && tt < m.tb + 1e-9) throw patternError('PATTERN_SPLIT_IN_DART', 'Split point is inside a dart');
  }
```
- In `opDeleteVertex`, after the `out.notches = …` assignment, add:

```js
  out.darts = (piece.darts || [])
    .filter((d) => d.edge !== i && d.edge !== prev)
    .map((d) => ({ id: d.id, edge: map[d.edge], t: d.t, width_mm: d.width_mm, apex: cp(d.apex) }));
```

- In `opReflectX`, after `out.notches = …`, add:

```js
  out.darts = (piece.darts || []).map((d) => ({ id: d.id, edge: map[d.edge], t: 1 - d.t, width_mm: d.width_mm, apex: /** @type {Vec2} */ ([-d.apex[0], d.apex[1]]) }));
```

- Selection:
  - `emptySelection()` returns `{ …, notch: null, dart: null }`.
  - `freezeSelection` adds `dart: sel.dart ? Object.freeze({ ...sel.dart }) : null,`.
  - In `select()` add `const dart = ('dart' in p) ? point(p.dart, 'index') : prev.dart;` and `dart: (dart && known.has(dart.pieceId)) ? dart : null,` in `next`.
  - In `pruneSelection` add `dart: selection.dart,` to `next` and:

```js
    const dk = next.dart;
    if (dk && (!byId.has(dk.pieceId) || dk.index >= (byId.get(dk.pieceId).darts || []).length)) next.dart = null;
```

`src/pattern/render2d.js` `applyOverrides`:
- in the `copy` literal add `darts: (piece.darts || []).map((d) => ({ ...d, apex: [d.apex[0], d.apex[1]] })),`;
- inside `if (moved) { … }`, after the internal lines, add `for (const d of copy.darts) { d.apex[0] += dx; d.apex[1] += dy; }`.

`src/pattern/index.js`: add `sewnLengthOf` to the `./seams.js` export list.

`src/ui/panels/pieces.js` Duplicate, after the internal-lines loop: `for (const d of copy.darts || []) d.apex[0] += dx;`.

`src/app/debugApi.js` `translatePiece` fallback, before `return q;`: `q.darts = (q.darts || []).map((d) => ({ ...d, apex: [d.apex[0] + dx, d.apex[1] + dy] }));`.

`src/app/wiring.js` `importDxf` layout map, in the returned object: `darts: (dr.darts || []).map((dt) => ({ ...dt, apex: T(dt.apex) })),`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module pattern --module ui`

Expected: PASS, including `darts-model` and every earlier pattern and UI case.

- [ ] **Step 5: Amend SPEC.md and commit**

§11.11 amendment block. It says:
- seam ease uses sewn length (`sewnLengthOf`);
- `validateDoc` includes the dart issues;
- `opTranslate`, `opSplitEdge` (with `PATTERN_SPLIT_IN_DART`), `opDeleteVertex` (drops darts on the removed edges), `opReflectX` (mirrors) and Duplicate carry darts;
- the selection gains `dart`.

```bash
git add src/pattern src/ui/panels/pieces.js src/app/debugApi.js src/app/wiring.js docs/SPEC.md
git commit -m "Keep darts consistent through piece edits, and measure seams by sewn length" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Grade darts; sewn lengths in grading and the piece CSV

**Files:**
- Modify: `src/sizing/grading.js` (import; `gradePieceDetailed` non-identity block 136-155; `sideLength` 235-241)
- Modify: `src/export/csv.js:152-199` (`pieceMeasurementsCsv`)
- Modify: `docs/SPEC.md` §10.2 and §10.5 (amendment blocks)
- Test: `src/sizing/selftest.js`, `src/export/selftest.js`

**Interfaces:**
- Consumes: `sewnLength` (Task 2).
- Produces:
  - A graded dart keeps `t` and `width_mm`, and its `apex` goes through the piece transform `T`.
  - `seamEasePct` and `seamEaseDrift` use sewn lengths.
  - In the CSV, per-edge `length_mm` and `partner_len_mm` are sewn lengths; the piece total row keeps the raw perimeter.

- [ ] **Step 1: Write the failing tests**

In `src/sizing/selftest.js`, near the other grading cases, add (import `gradePieceDetailed` and `seamEasePct` from `./grading.js` if they are not already imported):

```js
  out.push(runCase('grade.darts', () => {
    const chart = defaultChart();
    const piece = { ...makeSQ({ id: 'dp', name: 'Darted' }), darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 20, apex: [50, 60] }] };
    piece.grade = { widthRef: 'chest_cm', lengthRef: 'height_cm', anchorX: 'left', anchorY: 'bottom', vertexRules: [] };
    const r = gradePieceDetailed(piece, chart, 'XL');
    const d = r.piece.darts[0];
    near(d.t, 0.5, 1e-12, 'graded dart keeps t');
    near(d.width_mm, 20, 1e-12, 'graded dart keeps its width');
    near(d.apex[0], r.pivot[0] + (50 - r.pivot[0]) * r.sx, 1e-9, 'apex x follows the transform');
    near(d.apex[1], r.pivot[1] + (60 - r.pivot[1]) * r.sy, 1e-9, 'apex y follows the transform');
    const A = { ...makeSQ({ id: 'A', name: 'A' }), darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 20, apex: [50, 60] }] };
    const bLen = 100 - 20;
    const B = makeSQ({ id: 'B', name: 'B' });
    B.vertices = B.vertices.map((v) => [v[0] * bLen / 100, v[1]]);
    const seam = { id: 's', kind: 'plain', a: { pieceId: 'A', edge: 0, mirror: false, reverse: false }, b: { pieceId: 'B', edge: 0, mirror: false, reverse: false } };
    near(seamEasePct([A, B], seam).easePct, 0, 1e-9, 'darted edge vs plain edge of the same sewn length');
    return 'apex ' + d.apex.map((x) => x.toFixed(2)).join(', ');
  }));
```

(`makeSQ` is the 100 × 100 square at the top of the file, with bottom edge `e0` from `(0,0)` to `(100,0)`.)

In `src/export/selftest.js` add:

```js
  out.push(runCase('csv.sewn', () => {
    const doc = normalizeDoc({ version: 2, pieces: [
      { id: 'A', name: 'A', vertices: [[0, 0], [100, 0], [100, 100], [0, 100]], darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 20, apex: [50, 60] }] },
      { id: 'B', name: 'B', vertices: [[0, 200], [80, 200], [80, 300], [0, 300]] },
    ], seams: [{ id: 's', kind: 'plain', a: { pieceId: 'A', edge: 0, mirror: false, reverse: false }, b: { pieceId: 'B', edge: 0, mirror: false, reverse: false } }] });
    const csv = pieceMeasurementsCsv(doc, doc.sizes);
    const rowA0 = csv.split('\n').find((l) => l.startsWith('M,A,') && l.split(',')[4] === '0');
    assert(!!rowA0, 'row for A edge 0 at size M');
    const cols = rowA0.split(',');
    assert(cols[6] === '80', 'A e0 sewn length 80, got ' + cols[6]);
    assert(cols[11] === '0', 'ease 0, got ' + cols[11]);
    return rowA0;
  }));
```

(Column indices follow `MEASUREMENTS_HEADER` in `csv.js`: `size,piece,cut_qty,on_fold,edge,label,length_mm,allowance_mm,seam,partner,partner_length_mm,ease_pct,…`, so 4 is the edge, 6 the length and 11 the ease.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module sizing --module export`

Expected: FAIL in `grade.darts` ("apex x follows the transform") and in `csv.sewn` ("A e0 sewn length 80, got 100").

- [ ] **Step 3: Implement**

`src/sizing/grading.js`:
- Add `sewnLength` to its `../geometry/index.js` import.
- Inside `if (!identity) { … }`, after the internal lines:

```js
    // darts keep t and width in every size; the point moves with the piece (SPEC 10.2 amendment "Darts")
    if (Array.isArray(out.darts)) {
      for (const d of out.darts) if (Array.isArray(d.apex)) d.apex = T(d.apex);
    }
```

- In `sideLength` replace `return edgeLength(piece, side.edge);` with `return sewnLength(piece, side.edge);`, and update both doc comments to say "sewn length".

`src/export/csv.js`:
- import `sewnLength` from `../geometry/index.js`.
- In the per-edge loop keep `const len = edgeLength(piece, i); perimeter += len;` but push `fmtCsv(round(sewnLength(piece, i), 1))` in the length column.
- Set `partnerLen = fmtCsv(round(sewnLength(otherPiece, other.edge), 1));`.
- Leave the `total` row on `totalLen`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module sizing --module export`

Expected: PASS, including every earlier case. Samples without darts give identical numbers.

- [ ] **Step 5: Amend SPEC.md and commit**

Amendment blocks:
- §10.2: darts keep `t` and width; the apex follows `T`; no vertex rule touches the apex; ease and drift use sewn length.
- §10.5: edge rows report sewn lengths; the total row keeps the raw perimeter.

```bash
git add src/sizing/grading.js src/sizing/selftest.js src/export/csv.js src/export/selftest.js docs/SPEC.md
git commit -m "Grade darts with their piece, and measure seams by sewn length in grading and the CSV" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The Dart tool — hit testing, drawing, toolbar and `T`

**Files:**
- Create: `src/pattern/tools/dart.js`
- Modify: `src/pattern/hit.js` (Hit typedef line 16-25; a new section 2b after the bezier handles)
- Modify: `src/pattern/render2d.js`: imports; `applyOverrides` (`dartOverride`); drawing in sections 4-6; handles in section 9
- Modify: `src/pattern/editor.js`: `EDITOR_TOOLS` at 35, import and `tools` registry at 663-672
- Modify: `src/pattern/index.js` (`TOOL_NAMES`, `TOOL_HINTS`)
- Modify: `index.html:45` (button after `tool-notch`), `src/ui/ids.js:16-17` (`'tool-dart'`), `src/ui/toolbar.js:118` (id list), `src/ui/shortcuts.js` (key `t`)
- Modify: `docs/SPEC.md` §11.10 (new §11.10.10)
- Test: `src/pattern/selftest.js`

**Interfaces:**
- Consumes: `checkDarts`, `dartMouth`, `dartDrillPoint`, `edgeLength`, `pointAtArcFraction`, `tangentAtArcFraction`, `sampleEdge` (geometry); the editor ctx (`store`, `commit`, `status`, `editor.select`, `getSelection`); `Selection.dart` (Task 5).
- Produces:
  - `createDartTool(ctx)`; `proposeDart(piece, e, t) → Dart|null`
  - hit kinds `'dartApex'`, `'dartEnd'` (`which: 'a'|'b'`), `'dartMouth'`, tested only when the tool is `'dart'`
  - the transient `dartOverride: {pieceId, index, dart, ok}`
  - the tool name `'dart'`

- [ ] **Step 1: Write the failing test**

In `src/pattern/selftest.js`, before the final `return results;`:

```js
  await run('dart-tool', (h) => {
    const id = addRect(h, -100, -150, 200, 300);
    h.editor.setTool('dart');
    clickWorld(h, 0, -150);
    let p = pieceOf(h.doc(), id);
    assert(Array.isArray(p.darts) && p.darts.length === 1, 'one dart added, got ' + (p.darts || []).length);
    const dt = p.darts[0];
    assert(dt.edge === 0, 'dart on the bottom edge, got edge ' + dt.edge);
    near(dt.t, 0.5, 0.01, 'dart centred where clicked');
    near(dt.width_mm, 20, 1e-9, 'default width');
    near(Math.hypot(dt.apex[0], dt.apex[1] + 150), 80, 0.5, 'default length');
    assert(dt.apex[1] > -150, 'the point is inside the piece');
    dragWorld(h, dt.apex, [10, -40]);
    p = pieceOf(h.doc(), id);
    near(p.darts[0].apex[0], 10, 1e-6, 'apex x after the drag');
    near(p.darts[0].apex[1], -40, 1e-6, 'apex y after the drag');
    dragWorld(h, [10, -40], [10, 280]);
    p = pieceOf(h.doc(), id);
    near(p.darts[0].apex[1], -40, 1e-6, 'a drag outside the piece must not commit');
    h.editor.deleteSelection();
    assert(pieceOf(h.doc(), id).darts.length === 0, 'Delete removes the selected dart');
    return 'add, drag, refuse, delete';
  });
```

- [ ] **Step 2: Run the test to see it fail**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module pattern`

Expected: FAIL in `dart-tool` with "Unknown tool: dart" (`PATTERN_BAD_TOOL`).

- [ ] **Step 3: Write `src/pattern/tools/dart.js`**

```js
// src/pattern/tools/dart.js — Dart tool (T), SPEC 11.10.10 (amendment "Darts"). States: IDLE, DRAG_APEX, DRAG_END, DRAG_MOUTH.
// Click an outline edge to add a dart there; drag its point, a mouth corner (width) or the mouth centre (slide). A drag
// that would make the dart invalid previews in the error colour and is not committed.

import { uid } from '../../core/ids.js';
import { checkDarts, edgeLength, pointAtArcFraction, tangentAtArcFraction, sampleEdge } from '../../geometry/index.js';
import { DRAG_THRESHOLD_PX } from '../editor.js';

/** @typedef {import('../../core/types.js').Vec2} Vec2 */
/** @typedef {import('../../core/types.js').Piece} Piece */
/** @typedef {import('../../core/types.js').Dart} Dart */

export const DART_DEFAULT_WIDTH_MM = 20;
export const DART_DEFAULT_LENGTH_MM = 80;
export const DART_MIN_LENGTH_MM = 20;

/** @param {Piece} piece @param {number} k @param {Dart} dart @returns {Piece} a copy with dart k replaced (or appended) */
function withDart(piece, k, dart) {
  const darts = (piece.darts || []).slice();
  darts[k] = dart;
  return /** @type {Piece} */ ({ ...piece, darts });
}

/** @param {Piece} piece @param {number} k @returns {boolean} */
function dartOk(piece, k) {
  return !checkDarts(piece).bad.has(k);
}

/** Edge point at t and the inward normal there. @param {Piece} piece @param {number} e @param {number} t @returns {{p: Vec2, d: Vec2, nIn: Vec2}} */
function frameAt(piece, e, t) {
  const n = piece.vertices.length;
  const p0 = piece.vertices[e];
  const edge = piece.edges[e];
  const p1 = piece.vertices[(e + 1) % n];
  const p = pointAtArcFraction(p0, edge, p1, t);
  const d = tangentAtArcFraction(p0, edge, p1, t);
  return { p, d, nIn: [-d[1], d[0]] };
}

/** Arc-length fraction of the point of edge e nearest to q (1/400 of the edge resolution). @param {Piece} piece @param {number} e @param {Vec2} q @returns {number} */
export function nearestT(piece, e, q) {
  const pts = sampleEdge(piece, e, 400);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - q[0], pts[i][1] - q[1]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best / (pts.length - 1);
}

/**
 * The first valid dart centred at t on edge e: 20 mm wide and 80 mm long, shortened in 10 mm steps to 20 mm, then half
 * as wide once; null when nothing fits.
 * @param {Piece} piece @param {number} e @param {number} t @returns {Dart|null}
 */
export function proposeDart(piece, e, t) {
  const k = (piece.darts || []).length;
  const id = uid('dart');
  const { p, nIn } = frameAt(piece, e, t);
  for (const width of [DART_DEFAULT_WIDTH_MM, DART_DEFAULT_WIDTH_MM / 2]) {
    for (let len = DART_DEFAULT_LENGTH_MM; len >= DART_MIN_LENGTH_MM; len -= 10) {
      /** @type {Dart} */
      const dart = { id, edge: e, t, width_mm: width, apex: [p[0] + nIn[0] * len, p[1] + nIn[1] * len] };
      if (dartOk(withDart(piece, k, dart), k)) return dart;
    }
  }
  return null;
}

/**
 * The dart after a drag to pattern point q: the point follows q; a corner sets the width symmetrically; the mouth
 * centre slides the dart along its edge, its point moving with it.
 * @param {Piece} piece @param {Dart} dt @param {string} state @param {Vec2} q @returns {Dart}
 */
function movedDart(piece, dt, state, q) {
  if (state === 'DRAG_APEX') return { ...dt, apex: [q[0], q[1]] };
  const t = nearestT(piece, dt.edge, q);
  if (state === 'DRAG_END') {
    const w = 2 * Math.abs(t - dt.t) * edgeLength(piece, dt.edge);
    return { ...dt, width_mm: Math.max(1, Math.round(w * 10) / 10) };
  }
  const from = frameAt(piece, dt.edge, dt.t).p;
  const to = frameAt(piece, dt.edge, t).p;
  return { ...dt, t, apex: [dt.apex[0] + to[0] - from[0], dt.apex[1] + to[1] - from[1]] };
}

/** @param {object} ctx @returns {object} Tool */
export function createDartTool(ctx) {
  let state = 'IDLE';
  /** @type {{pieceId:string, index:number, x0:number, y0:number}|null} */
  let drag = null;
  /** @type {{pieceId:string, index:number, dart:Dart, ok:boolean}|null} */
  let preview = null;
  /** @type {{pieceId:string, edge:number, t:number}|null} */
  let marker = null;

  function reset() {
    state = 'IDLE';
    drag = null;
    preview = null;
  }

  /** @param {string} id @returns {Piece|null} */
  function pieceOf(id) {
    return ctx.store.get().pieces.find((/** @type {Piece} */ p) => p.id === id) || null;
  }

  /** @param {any} hit @returns {boolean} */
  const isHandle = (hit) => !!hit && (hit.kind === 'dartApex' || hit.kind === 'dartEnd' || hit.kind === 'dartMouth');

  return {
    name: 'dart',

    cursor(hit) {
      if (isHandle(hit)) return 'move';
      if (hit && hit.kind === 'edge' && hit.mirror !== true) return 'crosshair';
      return 'default';
    },

    onDown(e) {
      if (e.button !== 0) return;
      const hit = e.hit;
      if (!hit) return;
      if (isHandle(hit)) {
        ctx.editor.select({ pieces: [hit.pieceId], dart: { pieceId: hit.pieceId, index: hit.index }, notch: null, vertex: null, edge: null });
        state = hit.kind === 'dartApex' ? 'DRAG_APEX' : (hit.kind === 'dartEnd' ? 'DRAG_END' : 'DRAG_MOUTH');
        drag = { pieceId: hit.pieceId, index: hit.index, x0: e.px, y0: e.py };
        return;
      }
      if (hit.kind !== 'edge' || hit.mirror === true) return;
      const piece = pieceOf(hit.pieceId);
      if (!piece) return;
      if (piece.foldEdge === hit.index) { ctx.status('No darts on the fold edge', 'warn'); return; }
      const dart = proposeDart(piece, hit.index, hit.t === undefined ? 0.5 : hit.t);
      if (!dart) { ctx.status('No room for a dart here', 'warn'); return; }
      let index = -1;
      ctx.commit('dart:add', (/** @type {any} */ d) => {
        const p = d.pieces.find((/** @type {Piece} */ x) => x.id === piece.id);
        if (!p) return;
        if (!Array.isArray(p.darts)) p.darts = [];
        p.darts.push(dart);
        index = p.darts.length - 1;
      });
      if (index >= 0) ctx.editor.select({ pieces: [piece.id], dart: { pieceId: piece.id, index }, notch: null, vertex: null, edge: null });
      marker = null;
    },

    onMove(e) {
      if (state !== 'IDLE' && drag) {
        if (!preview && Math.hypot(e.px - drag.x0, e.py - drag.y0) < DRAG_THRESHOLD_PX) return;
        const piece = pieceOf(drag.pieceId);
        const dt = piece && piece.darts ? piece.darts[drag.index] : null;
        if (!piece || !dt) return;
        const moved = movedDart(piece, dt, state, [e.x_mm, e.y_mm]);
        preview = { pieceId: drag.pieceId, index: drag.index, dart: moved, ok: dartOk(withDart(piece, drag.index, moved), drag.index) };
        return;
      }
      const hit = e.hit;
      marker = (hit && hit.kind === 'edge' && hit.mirror !== true)
        ? { pieceId: hit.pieceId, edge: hit.index, t: hit.t === undefined ? 0.5 : hit.t }
        : null;
    },

    onUp() {
      if (preview) {
        const { pieceId, index, dart, ok } = preview;
        if (ok) {
          ctx.commit('dart:move', (/** @type {any} */ d) => {
            const p = d.pieces.find((/** @type {Piece} */ x) => x.id === pieceId);
            if (p && p.darts && p.darts[index]) p.darts[index] = dart;
          });
        } else {
          ctx.status('That would make the dart invalid — it stays where it was', 'warn');
        }
      }
      reset();
    },

    onDblClick() { /* no double-click behaviour */ },

    onDelete() {
      const sel = ctx.getSelection();
      if (!sel.dart) return false;
      const { pieceId, index } = sel.dart;
      ctx.commit('dart:delete', (/** @type {any} */ d) => {
        const p = d.pieces.find((/** @type {Piece} */ x) => x.id === pieceId);
        if (p && p.darts && p.darts[index]) p.darts.splice(index, 1);
      });
      ctx.editor.select({ dart: null });
      return true;
    },

    cancel() {
      if (state === 'IDLE' && !marker) return false;
      reset();
      marker = null;
      return true;
    },

    confirm() { /* nothing to confirm */ },
    activate() { reset(); marker = null; },
    deactivate() { reset(); marker = null; },

    transient() {
      /** @type {any} */
      const t = {};
      if (marker && state === 'IDLE') t.edgeMarker = marker;
      if (preview) t.dartOverride = preview;
      return t;
    },
  };
}
```

- [ ] **Step 4: Hit testing, drawing, registration**

`src/pattern/hit.js`:
- Import `dartMouth` from `../geometry/index.js`.
- Extend the `Hit.kind` union with `'dartApex'|'dartEnd'|'dartMouth'`.
- After section 2 (bezier handles) and its `if (best) return best;`, add:

```js
  // ---- 2b. dart handles (dart tool only): the point, the two mouth corners, the mouth centre ------------------
  if (tool === 'dart') {
    for (let i = last; i >= 0; i--) {
      const piece = pieces[i];
      if (!piece || !Array.isArray(piece.darts)) continue;
      const n = piece.vertices.length;
      for (let k = 0; k < piece.darts.length; k++) {
        const dt = piece.darts[k];
        if (!dt || !(dt.edge >= 0 && dt.edge < n) || !Array.isArray(dt.apex)) continue;
        const m = dartMouth(piece, dt);
        const c = pointAtArcFraction(piece.vertices[dt.edge], piece.edges[dt.edge], piece.vertices[(dt.edge + 1) % n], dt.t);
        /** @type {[string, Vec2, ('a'|'b'|undefined)][]} */
        const handles = [['dartApex', dt.apex, undefined], ['dartEnd', m.a, 'a'], ['dartEnd', m.b, 'b'], ['dartMouth', c, undefined]];
        for (const [kind, w, which] of handles) {
          const s = view.worldToScreen(w[0], w[1]);
          const d = Math.hypot(s[0] - px, s[1] - py);
          if (d <= HIT_TOL_PX.handle && (!best || d < best.dist_px)) {
            best = /** @type {Hit} */ ({ kind, pieceId: piece.id, index: k, mirror: false, dist_px: d, ...(which ? { which } : {}) });
          }
        }
      }
    }
  }
  if (best) return best;
```

`src/pattern/render2d.js`:
- Import `checkDarts, dartMouth, dartDrillPoint` from `../geometry/index.js`.
- In `applyOverrides`:
  - add `const dov = t.dartOverride && t.dartOverride.pieceId === piece.id ? t.dartOverride : null;`;
  - include `!dov` in the early-return condition;
  - after the `go` block add `if (dov && copy.darts[dov.index]) copy.darts[dov.index] = { ...dov.dart, apex: [dov.dart.apex[0], dov.dart.apex[1]] };`.
- Add this helper after `ring`:

```js
/**
 * One dart: the wedge lightly filled, the legs, and the drill-hole mark. `bad` darts are drawn in the warning colour.
 * @param {CanvasRenderingContext2D} ctx @param {View} view @param {Vec2} a @param {Vec2} b @param {Vec2} apex
 * @param {boolean} bad @param {number|null} foldX mirror copy when not null
 */
function drawDart(ctx, view, a, b, apex, bad, foldX) {
  const A = view.worldToScreen(...maybeMirror(a, foldX));
  const B = view.worldToScreen(...maybeMirror(b, foldX));
  const X = view.worldToScreen(...maybeMirror(apex, foldX));
  const colour = bad ? STYLE.seamWarn : STYLE.internalDart;
  ctx.save();
  if (foldX !== null) ctx.setLineDash([5, 4]);
  ctx.fillStyle = withAlpha(bad ? '#ff5a5a' : '#ff9f43', 0.15);
  ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(X[0], X[1]); ctx.lineTo(B[0], B[1]); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(X[0], X[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
  const D = view.worldToScreen(...maybeMirror(dartDrillPoint(a, b, apex), foldX));
  const r = Math.max(2, 2 * view.get().pxPerMm);
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  ring(ctx, D[0], D[1], r);
  ctx.beginPath(); ctx.moveTo(D[0] - r, D[1]); ctx.lineTo(D[0] + r, D[1]); ctx.moveTo(D[0], D[1] - r); ctx.lineTo(D[0], D[1] + r); ctx.stroke();
  ctx.restore();
}
```

  (`ring` strokes a circle with the current `strokeStyle`; `maybeMirror(p, fx)` returns `p` when `fx` is null.)
- In section "4..6", after the internal-lines loop, add:

```js
    const dartBad = checkDarts(piece).bad;
    for (let k = 0; k < (piece.darts || []).length; k++) {
      const dt = piece.darts[k];
      if (!dt || !(dt.edge >= 0 && dt.edge < n) || !Array.isArray(dt.apex)) continue;
      const m = dartMouth(piece, dt);
      for (const fx of (foldX !== null ? [null, foldX] : [null])) drawDart(ctx, view, m.a, m.b, dt.apex, dartBad.has(k), fx);
    }
```

- In section 9 (selection handles), after the notch handle block, add:

```js
    if (sel.dart && sel.dart.pieceId === piece.id && piece.darts && piece.darts[sel.dart.index]) {
      const dt = piece.darts[sel.dart.index];
      const m = dartMouth(piece, dt);
      const n2 = piece.vertices.length;
      const c = pointAtArcFraction(piece.vertices[dt.edge], piece.edges[dt.edge], piece.vertices[(dt.edge + 1) % n2], dt.t);
      ctx.fillStyle = STYLE.handleFill;
      ctx.strokeStyle = STYLE.selection;
      for (const w of [dt.apex, m.a, m.b, c]) {
        const s = view.worldToScreen(w[0], w[1]);
        ctx.fillRect(s[0] - 3.5, s[1] - 3.5, 7, 7);
        ctx.strokeRect(s[0] - 3.5, s[1] - 3.5, 7, 7);
      }
    }
```

`src/pattern/editor.js`:
- `EDITOR_TOOLS` becomes `['select', 'draw', 'edit', 'split', 'seam', 'notch', 'dart', 'grainline', 'measure']`;
- import `createDartTool` from `./tools/dart.js`;
- add `dart: createDartTool(ctx),` after `notch` in `tools`.

`src/pattern/index.js`:
- `TOOL_NAMES` becomes `['select', 'draw', 'edit', 'split', 'seam', 'notch', 'dart', 'grainline', 'measure']`;
- `TOOL_HINTS` gains `dart: 'Dart: click an edge to add a dart · drag its point, a corner (width) or the middle of the mouth (slide) · Delete removes',`.

`index.html`, after the `tool-notch` button line:

```html
      <button id="tool-dart"      type="button" class="tool" data-tool="dart"      aria-pressed="false" title="Dart (T)">Dart</button>
```

Also:
- `src/ui/ids.js`: add `'tool-dart'` after `'tool-notch'`, and change the comment's count to include it.
- `src/ui/toolbar.js:118`: add `'tool-dart'` after `'tool-notch'`.
- `src/ui/shortcuts.js`, after the `n` entry: `{ key: 't', ctrl: false, shift: false, action: 'tool', payload: { action: 'tool', tool: 'dart' } },`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module pattern --module ui`

Then: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --only acceptance --checks "^(02|25|26)$"`

Expected: PASS. `ids-present` and check 02 now include `tool-dart`.

- [ ] **Step 6: Amend SPEC.md and commit**

Add §11.10.10 `tools/dart.js — Dart (T)`. It covers:
- the four states and the three handles;
- the defaults and the shortening rule;
- "an invalid drag previews red and is not committed";
- the undo labels `dart:add`, `dart:move`, `dart:delete`;
- the hit kinds (dart tool only);
- the drawing (legs, 15 % wedge, drill mark, dashed mirrored copies);
- the `#tool-dart` id and the `T` shortcut.

```bash
git add src/pattern src/ui/ids.js src/ui/toolbar.js src/ui/shortcuts.js index.html docs/SPEC.md
git commit -m "Add the Dart tool: add, drag and delete darts in the pattern editor" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The Darts list in the Pieces panel

**Files:**
- Modify: `index.html` (a `#piece-darts` fieldset after `#edge-props`), `src/ui/ids.js` (`'piece-darts'`, `'list-darts'`)
- Modify: `src/ui/panels/pieces.js`: element lookups; new `renderDarts`; call it from `refresh`
- Modify: `styles/app.css` (row layout for `#list-darts`)
- Modify: `docs/SPEC.md` §11.8.1 (amendment block)
- Test: `src/ui/selftest.js`

**Interfaces:**
- Consumes: `checkDarts`, `edgeLength`, `pointAtArcFraction`, `tangentAtArcFraction` (geometry index); `store.update`.
- Produces:
  - Per dart, a row `li[data-testid="dart-row"][data-index]` with inputs `input[data-field="position|width|length|angle"]` and a `button[data-action="delete"]`.
  - Undo labels `dart:edit` and `dart:delete`.
  - An invalid edit sets `data-invalid="true"` on the input and reverts it.

- [ ] **Step 1: Write the failing test**

In `src/ui/selftest.js`, before the restore at the end of `runSelfTest`, add:

```js
  await run('darts-panel', async () => {
    const doc = structuredClone(store.get());
    const idx = doc.pieces.findIndex((p) => p.foldEdge === null);
    assert(idx >= 0, 'need a piece without a fold in the live document');
    const pid = doc.pieces[idx].id;
    const n = doc.pieces[idx].vertices.length;
    const v0 = doc.pieces[idx].vertices[0];
    const v1 = doc.pieces[idx].vertices[1 % n];
    const mid = [(v0[0] + v1[0]) / 2, (v0[1] + v1[1]) / 2];
    const cx = doc.pieces[idx].vertices.reduce((s, v) => s + v[0], 0) / n;
    const cy = doc.pieces[idx].vertices.reduce((s, v) => s + v[1], 0) / n;
    store.update((d) => { d.pieces[idx].darts = [{ id: 'dt', edge: 0, t: 0.5, width_mm: 12, apex: [(mid[0] + cx) / 2, (mid[1] + cy) / 2] }]; }, 'selftest:dart');
    ui.panels.pieces.setSelection({ pieces: [pid], seams: [], vertex: null, edge: null });
    await nextFrame(2);
    const row = document.querySelector('#list-darts li[data-testid="dart-row"]');
    assert(!!row, 'a dart row renders for the selected piece');
    const width = /** @type {HTMLInputElement} */ (row.querySelector('input[data-field="width"]'));
    assert(Math.abs(Number(width.value) - 12) < 1e-6, 'width field shows 12, got ' + width.value);
    width.value = '8';
    width.dispatchEvent(new Event('change', { bubbles: true }));
    await nextFrame(1);
    assert(store.get().pieces[idx].darts[0].width_mm === 8, 'a valid width edit commits');
    const apexBefore = store.get().pieces[idx].darts[0].apex.slice();
    const len = /** @type {HTMLInputElement} */ (document.querySelector('#list-darts input[data-field="length"]'));
    len.value = '5000';
    len.dispatchEvent(new Event('change', { bubbles: true }));
    await nextFrame(1);
    const apexAfter = store.get().pieces[idx].darts[0].apex;
    assert(apexAfter[0] === apexBefore[0] && apexAfter[1] === apexBefore[1], 'an invalid length is refused (the point did not move)');
    assert(len.dataset.invalid === 'true', 'the refused field is marked invalid');
    return 'row, valid edit, refused edit';
  });
```

- [ ] **Step 2: Run the test to see it fail**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module ui`

Expected: FAIL in `ids-present` ("missing ids: piece-darts, list-darts") and in `darts-panel`.

- [ ] **Step 3: Implement**

`index.html`, after the `edge-props` fieldset:

```html
        <fieldset id="piece-darts" disabled>
          <legend>Darts</legend>
          <ul id="list-darts" class="list"></ul>
        </fieldset>
```

`src/ui/ids.js`: add `'piece-darts', 'list-darts'` after `'chk-edge-pinned'`.

`src/ui/panels/pieces.js`:
- Extend the geometry import: `import { bbox, checkDarts, edgeLength, pointAtArcFraction, tangentAtArcFraction } from '../../geometry/index.js';`.
- Add the lookups `const fsDarts = /** @type {HTMLFieldSetElement|null} */ (byId(root, 'piece-darts'));` and `const listDarts = byId(root, 'list-darts');`.
- Add, before `function refresh()`:

```js
  // ------------------------------------------------------------------ darts (SPEC 11.8.1 amendment "Darts")

  /** Edge frame of a dart: centre point, tangent, inward normal, edge length. @param {any} p @param {any} dt */
  function dartFrame(p, dt) {
    const n = p.vertices.length;
    const p0 = p.vertices[dt.edge], edge = p.edges[dt.edge], p1 = p.vertices[(dt.edge + 1) % n];
    const c = pointAtArcFraction(p0, edge, p1, dt.t);
    const d = tangentAtArcFraction(p0, edge, p1, dt.t);
    return { c, d, nIn: [-d[1], d[0]], L: edgeLength(p, dt.edge) };
  }

  /** Field values of a dart: position (mm), width, length, angle (deg; 0 = inward normal, + toward the edge end). */
  function dartFields(p, dt) {
    const f = dartFrame(p, dt);
    const v = [dt.apex[0] - f.c[0], dt.apex[1] - f.c[1]];
    return {
      position: dt.t * f.L,
      width: dt.width_mm,
      length: Math.hypot(v[0], v[1]),
      angle: Math.atan2(v[0] * f.d[0] + v[1] * f.d[1], v[0] * f.nIn[0] + v[1] * f.nIn[1]) * 180 / Math.PI,
    };
  }

  /** The dart rebuilt from edited field values; position moves the mouth, length/angle place the point. */
  function dartFromFields(p, dt, vals) {
    const L = edgeLength(p, dt.edge);
    const t = vals.position / L;
    const f = dartFrame(p, { ...dt, t });
    const a = vals.angle * Math.PI / 180;
    const dir = [Math.cos(a) * f.nIn[0] + Math.sin(a) * f.d[0], Math.cos(a) * f.nIn[1] + Math.sin(a) * f.d[1]];
    return { ...dt, t, width_mm: vals.width, apex: [f.c[0] + dir[0] * vals.length, f.c[1] + dir[1] * vals.length] };
  }

  /** @param {any} doc */
  function renderDarts(doc) {
    if (!listDarts) return;
    const p = primaryPiece();
    if (fsDarts) fsDarts.disabled = !p;
    const focused = doc0.activeElement;
    if (focused && listDarts.contains(focused)) return; // never rebuild under the user's cursor
    listDarts.textContent = '';
    if (!p) return;
    (p.darts || []).forEach((dt, k) => {
      const li = doc0.createElement('li');
      li.dataset.testid = 'dart-row';
      li.dataset.index = String(k);
      const lab = p.edges[dt.edge] && p.edges[dt.edge].label ? p.edges[dt.edge].label : 'edge ' + dt.edge;
      const title = doc0.createElement('span');
      title.textContent = 'Dart ' + (k + 1) + ' · ' + lab + ' ';
      li.appendChild(title);
      let vals;
      try { vals = dartFields(p, dt); } catch { vals = { position: 0, width: dt.width_mm, length: 0, angle: 0 }; }
      for (const [field, label, step] of [['position', 'Pos', 1], ['width', 'W', 0.5], ['length', 'Len', 1], ['angle', '∠', 1]]) {
        const lab2 = doc0.createElement('label');
        lab2.textContent = label + ' ';
        const inp = doc0.createElement('input');
        inp.type = 'number';
        inp.step = String(step);
        inp.dataset.field = field;
        inp.value = String(Math.round(vals[field] * 10) / 10);
        inp.addEventListener('change', () => {
          const cur = primaryPiece();
          const now = cur && cur.darts ? cur.darts[k] : null;
          if (!now) return;
          const next = { ...dartFields(cur, now), [field]: Number(inp.value) };
          let cand;
          try { cand = dartFromFields(cur, now, next); } catch { cand = null; }
          const darts = (cur.darts || []).slice();
          if (cand) darts[k] = cand;
          if (!cand || !Number.isFinite(Number(inp.value)) || checkDarts({ ...cur, darts }).bad.has(k)) {
            inp.dataset.invalid = 'true';
            inp.value = String(Math.round(dartFields(cur, now)[field] * 10) / 10);
            bus.emit(EVENT.UI_STATUS, { level: 'warn', text: 'That would make the dart invalid', source: 'ui/pieces' });
            return;
          }
          delete inp.dataset.invalid;
          updatePiece((piece) => { piece.darts[k] = cand; }, 'dart:edit');
        });
        lab2.appendChild(inp);
        li.appendChild(lab2);
      }
      const del = doc0.createElement('button');
      del.type = 'button';
      del.dataset.action = 'delete';
      del.textContent = 'Delete';
      del.addEventListener('click', () => updatePiece((piece) => { piece.darts.splice(k, 1); }, 'dart:delete'));
      li.appendChild(del);
      listDarts.appendChild(li);
    });
  }
```

- In `refresh()` add `renderDarts(doc);` after `renderFields(doc);`.

`styles/app.css`: add

```css
#list-darts li { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }
#list-darts input { width: 5em; }
#list-darts input[data-invalid="true"] { outline: 1px solid #ff5a5a; }
```

- [ ] **Step 4: Run the test to see it pass**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module ui`

Expected: PASS for `ids-present`, `darts-panel`, and the rest. The self-test restores the document afterwards.

- [ ] **Step 5: Amend SPEC.md and commit**

§11.8.1 amendment block: the `#piece-darts` / `#list-darts` ids, the four fields and their meaning, commit-or-refuse, and the undo labels.

```bash
git add index.html src/ui/ids.js src/ui/panels/pieces.js src/ui/selftest.js styles/app.css docs/SPEC.md
git commit -m "Add a Darts list to the Pieces panel for exact dart edits" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Darts in the SVG sheet and the print tiles

**Files:**
- Modify: `src/export/svg.js`: import; `PieceGeometry` typedef (add `darts`); `buildPieceGeometry` (a new step after the notches); `pieceMarkup` (a darts group after the internal lines)
- Modify: `docs/SPEC.md` §10.3 (amendment block)
- Test: `src/export/selftest.js`

**Interfaces:**
- Consumes: `validDartIndices`, `dartMouth`, `dartDrillPoint`.
- Produces:
  - `PieceGeometry.darts: {a, b, apex, drill}[]`
  - a mouth notch per leg in `PieceGeometry.notches`
  - markup `<g class="darts">` holding `path.dart`, `circle.drill` and `path.drill`

- [ ] **Step 1: Write the failing test**

In `src/export/selftest.js`:

```js
  out.push(runCase('svg.darts', () => {
    const base = { id: 'dp', name: 'Darted', vertices: [[0, 0], [200, 0], [200, 300], [0, 300]], edges: [{ type: 'line' }, { type: 'line' }, { type: 'line' }, { type: 'line' }],
      foldEdge: null, notches: [], grainline: { a: [100, 50], b: [100, 250] }, internalLines: [], seamAllowance_mm: 10, fabricId: 'main', cutQty: 1 };
    const withDart = { ...base, darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 20, apex: [100, 100] }] };
    const g0 = buildPieceGeometry({ ...base, darts: [] }, 'M', { date: '2026-01-01' });
    const g1 = buildPieceGeometry(withDart, 'M', { date: '2026-01-01' });
    assert(g1.darts.length === 1, 'one dart in the geometry');
    assert(g1.notches.length === 2, 'a notch at each leg, got ' + g1.notches.length);
    assert(JSON.stringify(g1.cut) === JSON.stringify(g0.cut), 'the cut line ignores the dart (the fabric is folded, not cut)');
    near(g1.darts[0].drill[1], 90, 1e-9, 'drill hole 10 mm back from the point');
    const svg = exportPieceSvg(withDart, { sizeName: 'M', date: '2026-01-01' });
    assert(count(svg, 'class="dart"') === 1 && count(svg, 'class="drill"') === 2, 'dart legs and drill mark in the SVG');
    checkSvgFrame(svg);
    return 'legs, 2 mouth notches, drill at y ' + g1.darts[0].drill[1];
  }));
```

- [ ] **Step 2: Run the test to see it fail**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module export`

Expected: FAIL: "Cannot read properties of undefined (reading 'length')" (no `g1.darts`).

- [ ] **Step 3: Implement**

`src/export/svg.js`:
- Add `validDartIndices, dartMouth, dartDrillPoint` to the geometry import.
- Typedef: `* @property {{a:Vec2, b:Vec2, apex:Vec2, drill:Vec2}[]} darts   valid darts: legs A→apex→B and the drill hole`.
- In `buildPieceGeometry`, after the notches loop:

```js
  // 5. darts (SPEC 10.3 amendment "Darts"): the fabric in a dart is folded, not cut away, so the cut and stitch lines
  //    above follow the clean outline; each valid dart adds its legs, a notch at each leg and a drill hole
  /** @type {PieceGeometry['darts']} */
  const darts = [];
  for (const k of validDartIndices(piece)) {
    const dt = piece.darts[k];
    const m = dartMouth(piece, dt);
    /** @type {Vec2} */
    const apex = [dt.apex[0], dt.apex[1]];
    darts.push({ a: m.a, b: m.b, apex, drill: dartDrillPoint(m.a, m.b, apex) });
    for (const t of [m.ta, m.tb]) {
      const { p, d } = edgePointAt(piece, dt.edge, t);
      /** @type {Vec2} */
      const nrm = [d[1], -d[0]];
      const a = allowances[dt.edge];
      /** @type {Vec2} */
      const q = a > 0 ? [p[0] + nrm[0] * a, p[1] + nrm[1] * a] : [p[0] - nrm[0] * 5, p[1] - nrm[1] * 5];
      notches.push({ kind: 'single', p, q });
    }
  }
```

  and add `darts,` to the returned object.
- In `pieceMarkup`, after `parts.push('</g>');` of the internal group:

```js
  // darts: legs as stitching, drill hole as a 2 mm circle with a cross
  parts.push('<g class="darts" stroke-width="0.25">');
  for (const dt of g.darts || []) {
    parts.push(`<path class="dart" d="M ${pt(S(dt.a))} L ${pt(S(dt.apex))} L ${pt(S(dt.b))}"/>`);
    const c = S(dt.drill);
    parts.push(`<circle class="drill" cx="${fmt(c[0])}" cy="${fmt(c[1])}" r="2"/>`);
    parts.push(`<path class="drill" d="M ${fmt(c[0] - 2)} ${fmt(c[1])} L ${fmt(c[0] + 2)} ${fmt(c[1])} M ${fmt(c[0])} ${fmt(c[1] - 2)} L ${fmt(c[0])} ${fmt(c[1] + 2)}"/>`);
  }
  parts.push('</g>');
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module export`

Then: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --only acceptance --checks "^(19|20|21|22)$"`

Expected: PASS. Print tiles reuse the sheet markup, so they carry darts with no extra code.

- [ ] **Step 5: Amend SPEC.md and commit**

§10.3 amendment: `PieceGeometry.darts`, the mouth notches, "the cut line follows the clean outline", the markup classes, and the drill position (`DART_DRILL_BACK_MM`).

```bash
git add src/export/svg.js src/export/selftest.js docs/SPEC.md
git commit -m "Print darts on the pattern sheet: legs, mouth notches and a drill hole" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Darts in DXF-AAMA, both ways

**Files:**
- Modify: `src/dxf/aama.js`:
  - import;
  - in `exportAama`, the notch computation at 307-316 and a darts step after the internal lines at 364-369;
  - in `importAama`, a darts block after the allowance block at ~841, a notch skip at 843-866, and an entity skip at 873-887
- Modify: `docs/SPEC.md` (the DXF-AAMA amendment in §10, search `DXF-AAMA`)
- Test: `src/dxf/selftest.js`

**Interfaces:**
- Consumes: `validDartIndices`, `dartMouth`, `dartDrillPoint`, `edgeLength`; `mirrorPiece` mirrors darts (Task 2).
- Produces:
  - Export: per dart, an open 3-point POLYLINE (A, apex, B) on layer 8 with turn points, a POINT on layer 13 (drill), and mouth notches on layer 4.
  - Import: `piece.darts` from exactly that shape; mouth notches are not imported as notches, and dart polylines and drill points not as marks.

- [ ] **Step 1: Write the failing test**

In `src/dxf/selftest.js`, before `return results;`:

```js
  check('dxf.darts', () => {
    const doc = normalizeDoc({ version: 2, name: 'Darts', pieces: [
      { id: 'panel', name: 'Panel', vertices: [[0, 0], [200, 0], [200, 300], [0, 300]], seamAllowance_mm: 10,
        darts: [{ id: 'd', edge: 0, t: 0.5, width_mm: 20, apex: [100, 120] }] },
      { id: 'half', name: 'Half', vertices: [[0, 0], [150, 0], [150, 300], [0, 300]], foldEdge: 3, seamAllowance_mm: 10,
        edges: [{ type: 'line' }, { type: 'line' }, { type: 'line' }, { type: 'line', allowance_mm: 0 }],
        darts: [{ id: 'e', edge: 0, t: 0.6, width_mm: 16, apex: [90, 110] }] },
    ] });
    const text = exportAama(doc, { sizes: ['M'] });
    assert(/\n\s*13\r?\n/.test(text), 'a drill hole on layer 13');
    const { pieces } = importAama(text);
    const byName = (nm) => pieces.find((p) => p.name === nm);
    for (const [src, got] of [[doc.pieces[0], byName('Panel')], [doc.pieces[1], byName('Half')]]) {
      assert(!!got, src.name + ' imported');
      assert(Array.isArray(got.darts) && got.darts.length === 1, src.name + ': one dart back, got ' + (got.darts || []).length);
      assert(got.notches.length === src.notches.length, src.name + ': the mouth notches are not notches (' + got.notches.length + ')');
      assert(got.internalLines.length === 0, src.name + ': no stray internal lines (' + got.internalLines.length + ')');
      const ms = dartMouth(src, src.darts[0]);
      const mg = dartMouth(got, got.darts[0]);
      const dA = Math.min(Math.hypot(ms.a[0] - mg.a[0], ms.a[1] - mg.a[1]), Math.hypot(ms.a[0] - mg.b[0], ms.a[1] - mg.b[1]));
      const dX = Math.hypot(src.darts[0].apex[0] - got.darts[0].apex[0], src.darts[0].apex[1] - got.darts[0].apex[1]);
      assert(dA < 0.1 && dX < 0.1 && Math.abs(src.darts[0].width_mm - got.darts[0].width_mm) < 0.1,
        src.name + ': mouth ' + dA.toFixed(3) + ' mm, apex ' + dX.toFixed(3) + ' mm, width ' + got.darts[0].width_mm);
    }
    return 'both pieces keep their dart within 0.1 mm';
  });
```

Add `import { dartMouth } from '../geometry/darts.js';` at the top.

- [ ] **Step 2: Run the test to see it fail**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module dxf`

Expected: FAIL with "Panel: one dart back, got 0".

- [ ] **Step 3: Implement export**

In `src/dxf/aama.js`:
- Import `validDartIndices, dartMouth, dartDrillPoint` from `../geometry/darts.js` (and `edgeLength` from `../geometry/bezier.js` if it is not already imported).
- In `exportAama`, replace `const notches = notchPoints(p, allowanceOf).map(` with:

```js
    // darts (SPEC 10 amendment "Darts"): every valid dart's mouth corners are notches too
    const dartList = validDartIndices(p).map((k) => ({ dt: p.darts[k], m: dartMouth(p, p.darts[k]) }));
    const withMouths = dartList.length
      ? { ...p, notches: (p.notches || []).concat(dartList.flatMap(({ dt, m }) => [
        { edge: dt.edge, t: m.ta, kind: 'single' }, { edge: dt.edge, t: m.tb, kind: 'single' }])) }
      : p;
    const notches = notchPoints(withMouths, allowanceOf).map(
```

- After the internal-lines loop:

```js
    // darts: the legs as one open line through the point (layer 8, every point a turn), the drill hole on layer 13
    for (const { dt, m } of dartList) {
      const legs = [m.a, dt.apex, m.b];
      polyline(LAYER.internal, legs, false);
      marks(legs, [true, true, true]);
      const dr = dartDrillPoint(m.a, m.b, dt.apex);
      w.entity('POINT', LAYER.drill).point(X(dr[0]), X(dr[1]));
    }
```

- [ ] **Step 4: Implement import**

In `importAama`, add a constant near the other tolerances at the top of the file: `const DART_END_TOL_MM = 0.5; const DART_DRILL_TOL_MM = 15; const DART_NOTCH_TOL_MM = 1.5;`.

After the seam-allowance block (`piece.seamAllowance_mm = allowance;`), add:

```js
    // darts: an open layer-8 line of exactly three points whose ends lie on the sew line of one edge, with a drill hole
    // near its middle point — the shape exportAama writes (SPEC 10 amendment "Darts")
    const outline = /** @type {any} */ ({ vertices, edges });
    const drills = g.ents.filter((e) => layerNo(e.layer) === LAYER.drill && (e.type === 'POINT' || e.type === 'CIRCLE'));
    const dartEnts = new Set();
    const usedDrills = new Set();
    piece.darts = [];
    for (const e of g.ents) {
      if (layerNo(e.layer) !== LAYER.internal || e.type !== 'POLYLINE' || e.closed || e.points.length !== 3) continue;
      const raw3 = e.points.map(S);
      if (!raw3.every(kept)) continue;
      const [A, Xp, B] = raw3.map(Tq);
      if (nearestOnRing(ring, A).d > DART_END_TOL_MM || nearestOnRing(ring, B).d > DART_END_TOL_MM) continue;
      const pa = edgeParamOf(outline, A);
      const pb = edgeParamOf(outline, B);
      if (pa.edge !== pb.edge) continue;
      const drill = drills.find((d) => {
        if (usedDrills.has(d)) return false;
        const q = Tq(S(d.p));
        return Math.hypot(q[0] - Xp[0], q[1] - Xp[1]) <= DART_DRILL_TOL_MM;
      });
      if (!drill) continue;
      const L = edgeLength(outline, pa.edge);
      const ta = Math.min(pa.t, pb.t);
      const tb = Math.max(pa.t, pb.t);
      piece.darts.push({ id: 'dart_' + (piece.darts.length + 1), edge: pa.edge, t: (ta + tb) / 2, width_mm: (tb - ta) * L, apex: [Xp[0], Xp[1]] });
      dartEnts.add(e);
      usedDrills.add(drill);
    }
    /** @param {{edge:number, t:number}} par @returns {boolean} a notch candidate that is a recognised dart's mouth corner */
    const isMouth = (par) => piece.darts.some((dt) => {
      if (dt.edge !== par.edge) return false;
      const L = edgeLength(outline, dt.edge);
      const c = dt.t * L;
      const s = par.t * L;
      return Math.abs(s - (c - dt.width_mm / 2)) < DART_NOTCH_TOL_MM || Math.abs(s - (c + dt.width_mm / 2)) < DART_NOTCH_TOL_MM;
    });
```

In the notch loop replace `raw.push(edgeParamOf({ vertices, edges }, best.c));` with:

```js
      const par = edgeParamOf({ vertices, edges }, best.c);
      if (!isMouth(par)) raw.push(par);
```

In the internal-lines loop, change `if (centreLines.includes(e)) continue;` to `if (centreLines.includes(e) || dartEnts.has(e) || usedDrills.has(e)) continue;`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module dxf`

Then: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --only acceptance --checks "^26f$"`

Expected: PASS. `dxf.roundtrip` still passes on the T-shirt.

- [ ] **Step 6: Amend SPEC.md and commit**

Add to the DXF amendment:
- the export shape (layers 8, 13 and 4);
- the import rule (3-point open polyline, ends ≤ 0.5 mm from the sew line on one edge, drill ≤ 15 mm from the point);
- "mouth notches are not notches".

```bash
git add src/dxf/aama.js src/dxf/selftest.js docs/SPEC.md
git commit -m "Write darts to DXF-AAMA and read them back" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The fitted dress sample

**Files:**
- Create: `src/samples/dress.js`
- Modify: `src/samples/index.js` (import, `SAMPLE_IDS`, `SAMPLES`), `index.html:27-30` (`#sel-sample` option)
- Modify: `src/core/selftest.js:105` (the sample list includes `'dress'`), `src/geometry/selftest.js:408` (`remesh.allSamples` includes `'dress'`)
- Modify: `docs/SPEC.md` §4 (amendment block: the dress)
- Test: `src/geometry/selftest.js` (new `remesh.dress`), `src/sizing/selftest.js` (new `dress.seams`)

**Interfaces:**
- Consumes: everything above.
- Produces: `getSample('dress')` → a fully normalised v2 document named "Fitted dress" with 6 pieces, 14 seams and 6 darts.

- [ ] **Step 1: Write the failing tests**

In `src/geometry/selftest.js` add:

```js
/** @returns {SelfTestResult} */
function caseRemeshDress() {
  const doc = getSample('dress');
  let V = 0;
  const notes = [];
  let ok = true;
  for (const p of doc.pieces) {
    const m = remeshPiece(p, doc);
    V += m.vertexCount;
    const { euler } = eulerOf(m);
    const legsOk = (p.darts || []).every((_, k) => m.dartVerts[0][k].a.length >= 3);
    if (euler !== 1 || m.quality.pctAbove20 < 98 || !legsOk || m.warnings.some((w) => w.startsWith('dart-ignored'))) ok = false;
    notes.push(`${p.id} ${m.vertexCount}v ${f(m.quality.pctAbove20, 1)}%`);
  }
  const pass = ok && V >= 4500 && V <= 7000;
  return { name: 'remesh.dress', pass, details: `total ${V} vertices (want 4500..7000); ` + notes.join(', ') };
}
```

Add it to `CASES` and `listSelfTests()`. Also add `'dress'` to the `for (const sampleId of ['tshirt', 'skirt'])` list at line 408.

In `src/sizing/selftest.js` add (import `getSample` from `../samples/index.js` and `seamEasePct`, `gradeDoc` from `./grading.js` if missing):

```js
  out.push(runCase('dress.seams', () => {
    const doc = normalizeDoc(getSample('dress'));
    const base = gradeDoc(doc, 'M');
    const worst = [];
    for (const seam of doc.seams) {
      const e0 = seamEasePct(base, seam).easePct;
      assert(e0 <= 3, `seam ${seam.id}: ${e0.toFixed(2)}% at M (> 3%)`);
      for (const size of ['S', 'L', 'XL']) {
        const e1 = seamEasePct(gradeDoc(doc, size), seam).easePct;
        assert(Math.abs(e1 - e0) <= 1, `seam ${seam.id}: ease drifts ${(e1 - e0).toFixed(2)} pp at ${size} (> 1)`);
      }
      worst.push(e0);
    }
    return doc.seams.length + ' seams, worst ease ' + Math.max(...worst).toFixed(2) + '% at M';
  }));
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module geometry --module sizing`

Expected: FAIL with "Unknown sample 'dress'" (`UNKNOWN_SAMPLE`).

- [ ] **Step 3: Write `src/samples/dress.js`**

```js
// src/samples/dress.js — built-in sample: sleeveless fitted dress with a waist seam (SPEC section 4, amendment "Darts").
// Pure data; imports nothing. Drafted for body preset female_m at size M: bust 88 + 6, waist 70 + 3, hips 96 + 5 cm.
// Pattern space: mm, y up, outlines CCW. Fold pieces store the x >= 0 half with the fold on x = 0; the backs are cut
// in two at centre back (CB at x = 0) with a zip, the '_l' piece a mirrored duplicate placed with flip.
// The bodice reuses the T-shirt's neck and shoulder draft (shifted so the waist is y = 0). L/R = the MODEL's left/right:
// on the front, the stored half is the model's left; an unflipped back half lies on the model's right.
// Every dart opens onto an edge. Each bodice panel's waist intake equals its skirt panel's (25 mm), so the waist seams
// match with and without the darts, and the waist corners grade with waist_cm on both sides of the seam.

/** @type {import('../core/types.js').ProjectDoc} */
export const DRESS = {
  version: 2,
  name: 'Fitted dress',
  body: {
    preset: 'female_m',
    params: {
      height_cm: 165, chest_cm: 88, underbust_cm: 76, waist_cm: 70, hips_cm: 96,
      shoulderWidth_cm: 38, neck_cm: 34, upperArm_cm: 27, forearm_cm: 23, wrist_cm: 15.5,
      thigh_cm: 54, calf_cm: 36, ankle_cm: 22, armLength_cm: 56, inseam_cm: 76,
      torsoLength_cm: 40, headHeight_cm: 22, bustFullness: 0.4, armAbduction_deg: 30, legSpread_deg: 6,
      weight_kg: 58.5, muscle: 0.35, age_y: 30, sex: 1,
    },
  },
  fabrics: [
    {
      id: 'main', name: 'Main (cotton)', preset: 'cotton', color: '#1f3a5f',
      texture: { kind: 'solid', scale_mm: 20, color2: '#ffffff' },
      overrides: {},
    },
  ],
  pieces: [
    {
      id: 'bodice_front', name: 'Bodice front',
      vertices: [[0, 0], [217.5, 0], [245, 215], [190, 370], [95, 400], [0, 242]],
      edges: [
        { type: 'line', allowance_mm: 10, label: 'waist' },                                     // e0 CF waist -> side waist
        { type: 'line', allowance_mm: 10, label: 'side' },                                      // e1 side waist -> armpit (bust dart)
        { type: 'cubic', c1: [205, 225], c2: [180, 300], allowance_mm: 6, label: 'armhole' },   // e2 armpit -> shoulder tip
        { type: 'line', allowance_mm: 10, label: 'shoulder' },                                  // e3 shoulder tip -> neck point
        { type: 'cubic', c1: [95, 313.1], c2: [42.8, 242], allowance_mm: 6, label: 'neck' },    // e4 neck point -> CF neck
        { type: 'line', allowance_mm: 0, label: 'fold' },                                       // e5 CF neck -> CF waist (fold)
      ],
      foldEdge: 5,
      notches: [],
      grainline: { a: [120, 20], b: [120, 200] },
      internalLines: [],
      darts: [
        { id: 'waist_dart', edge: 0, t: 0.4, width_mm: 25, apex: [87, 140] },
        { id: 'bust_dart', edge: 1, t: 0.68, width_mm: 25, apex: [107, 158] },
      ],
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
        vertexRules: [
          { vertex: 1, dx_mm: 0, dy_mm: 0, ref: 'waist_cm', refAxis: 'x' },
          { vertex: 3, dx_mm: 0, dy_mm: 0, ref: 'shoulderWidth_cm', refAxis: 'x' },
        ],
      },
      meshSpacing_mm: 15,
    },
    {
      id: 'bodice_back_r', name: 'Bodice back',
      vertices: [[0, 0], [197.5, 0], [225, 190], [190, 370], [95, 400], [0, 357]],
      edges: [
        { type: 'line', allowance_mm: 10, label: 'waist' },                                     // e0 CB waist -> side waist
        { type: 'line', allowance_mm: 10, label: 'side' },                                      // e1 side waist -> armpit
        { type: 'cubic', c1: [200, 205], c2: [185, 300], allowance_mm: 6, label: 'armhole' },   // e2 armpit -> shoulder tip
        { type: 'line', allowance_mm: 10, label: 'shoulder' },                                  // e3 shoulder tip -> neck point
        { type: 'cubic', c1: [95, 376.4], c2: [42.8, 357], allowance_mm: 6, label: 'neck' },    // e4 neck point -> CB neck
        { type: 'line', allowance_mm: 15, label: 'zip' },                                       // e5 CB neck -> CB waist
      ],
      foldEdge: null,
      notches: [],
      grainline: { a: [110, 20], b: [110, 200] },
      internalLines: [],
      darts: [{ id: 'waist_dart', edge: 0, t: 0.45, width_mm: 25, apex: [89, 150] }],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 2,
      exportHidden: false,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'torso', side: 'back', offset_mm: [112.5, 0], wrap: 0.8, flip: false },
      grade: {
        widthRef: 'chest_cm', lengthRef: 'torsoLength_cm', anchorX: 'left', anchorY: 'top',
        vertexRules: [
          { vertex: 1, dx_mm: 0, dy_mm: 0, ref: 'waist_cm', refAxis: 'x' },
          { vertex: 3, dx_mm: 0, dy_mm: 0, ref: 'shoulderWidth_cm', refAxis: 'x' },
        ],
      },
      meshSpacing_mm: 15,
    },
    {
      id: 'bodice_back_l', name: 'Bodice back (mirror)',
      vertices: [[0, 0], [197.5, 0], [225, 190], [190, 370], [95, 400], [0, 357]],
      edges: [
        { type: 'line', allowance_mm: 10, label: 'waist' },
        { type: 'line', allowance_mm: 10, label: 'side' },
        { type: 'cubic', c1: [200, 205], c2: [185, 300], allowance_mm: 6, label: 'armhole' },
        { type: 'line', allowance_mm: 10, label: 'shoulder' },
        { type: 'cubic', c1: [95, 376.4], c2: [42.8, 357], allowance_mm: 6, label: 'neck' },
        { type: 'line', allowance_mm: 15, label: 'zip' },
      ],
      foldEdge: null,
      notches: [],
      grainline: { a: [110, 20], b: [110, 200] },
      internalLines: [],
      darts: [{ id: 'waist_dart', edge: 0, t: 0.45, width_mm: 25, apex: [89, 150] }],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 2,
      exportHidden: true,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'torso', side: 'back', offset_mm: [-112.5, 0], wrap: 0.8, flip: true },
      grade: {
        widthRef: 'chest_cm', lengthRef: 'torsoLength_cm', anchorX: 'left', anchorY: 'top',
        vertexRules: [
          { vertex: 1, dx_mm: 0, dy_mm: 0, ref: 'waist_cm', refAxis: 'x' },
          { vertex: 3, dx_mm: 0, dy_mm: 0, ref: 'shoulderWidth_cm', refAxis: 'x' },
        ],
      },
      meshSpacing_mm: 15,
    },
    {
      id: 'skirt_front', name: 'Skirt front',
      vertices: [[0, 0], [272, 0], [262.5, 350], [217.5, 550], [0, 550]],
      edges: [
        { type: 'line', allowance_mm: 25, label: 'hem' },                                       // e0 CF hem -> side hem
        { type: 'line', allowance_mm: 10, label: 'side' },                                      // e1 side hem -> hip
        { type: 'cubic', c1: [262.5, 440], c2: [237.5, 530], allowance_mm: 10, label: 'side' }, // e2 hip -> side waist
        { type: 'line', allowance_mm: 10, label: 'waist' },                                     // e3 side waist -> CF waist
        { type: 'line', allowance_mm: 0, label: 'fold' },                                       // e4 CF waist -> CF hem (fold)
      ],
      foldEdge: 4,
      notches: [],
      grainline: { a: [130, 60], b: [130, 480] },
      internalLines: [],
      darts: [{ id: 'waist_dart', edge: 3, t: 0.6, width_mm: 25, apex: [87, 450] }],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 1,
      exportHidden: false,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'skirt', side: 'front', offset_mm: [0, 0], wrap: 0.8, flip: false },
      grade: {
        widthRef: 'hips_cm', lengthRef: 'height_cm', anchorX: 'fold', anchorY: 'top',
        vertexRules: [{ vertex: 3, dx_mm: 0, dy_mm: 0, ref: 'waist_cm', refAxis: 'x' }],
      },
      meshSpacing_mm: 15,
    },
    {
      id: 'skirt_back_r', name: 'Skirt back',
      vertices: [[0, 0], [252, 0], [242.5, 350], [197.5, 550], [0, 550]],
      edges: [
        { type: 'line', allowance_mm: 25, label: 'hem' },                                       // e0 CB hem -> side hem
        { type: 'line', allowance_mm: 10, label: 'side' },                                      // e1 side hem -> hip
        { type: 'cubic', c1: [242.5, 440], c2: [217.5, 530], allowance_mm: 10, label: 'side' }, // e2 hip -> side waist
        { type: 'line', allowance_mm: 10, label: 'waist' },                                     // e3 side waist -> CB waist
        { type: 'line', allowance_mm: 15, label: 'cb' },                                        // e4 CB waist -> CB hem
      ],
      foldEdge: null,
      notches: [{ edge: 4, t: 0.35, kind: 'double' }],
      grainline: { a: [120, 60], b: [120, 480] },
      internalLines: [],
      darts: [{ id: 'waist_dart', edge: 3, t: 0.55, width_mm: 25, apex: [89, 420] }],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 2,
      exportHidden: false,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'skirt', side: 'back', offset_mm: [126, 0], wrap: 0.8, flip: false },
      grade: {
        widthRef: 'hips_cm', lengthRef: 'height_cm', anchorX: 'left', anchorY: 'top',
        vertexRules: [{ vertex: 3, dx_mm: 0, dy_mm: 0, ref: 'waist_cm', refAxis: 'x' }],
      },
      meshSpacing_mm: 15,
    },
    {
      id: 'skirt_back_l', name: 'Skirt back (mirror)',
      vertices: [[0, 0], [252, 0], [242.5, 350], [197.5, 550], [0, 550]],
      edges: [
        { type: 'line', allowance_mm: 25, label: 'hem' },
        { type: 'line', allowance_mm: 10, label: 'side' },
        { type: 'cubic', c1: [242.5, 440], c2: [217.5, 530], allowance_mm: 10, label: 'side' },
        { type: 'line', allowance_mm: 10, label: 'waist' },
        { type: 'line', allowance_mm: 15, label: 'cb' },
      ],
      foldEdge: null,
      notches: [{ edge: 4, t: 0.35, kind: 'double' }],
      grainline: { a: [120, 60], b: [120, 480] },
      internalLines: [],
      darts: [{ id: 'waist_dart', edge: 3, t: 0.55, width_mm: 25, apex: [89, 420] }],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 2,
      exportHidden: true,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'skirt', side: 'back', offset_mm: [-126, 0], wrap: 0.8, flip: true },
      grade: {
        widthRef: 'hips_cm', lengthRef: 'height_cm', anchorX: 'left', anchorY: 'top',
        vertexRules: [{ vertex: 3, dx_mm: 0, dy_mm: 0, ref: 'waist_cm', refAxis: 'x' }],
      },
      meshSpacing_mm: 15,
    },
  ],
  seams: [
    // shoulders: e3 runs shoulder tip -> neck point on every bodice piece
    { id: 'shoulder_L', kind: 'plain',
      a: { pieceId: 'bodice_front', edge: 3, mirror: false, reverse: false },
      b: { pieceId: 'bodice_back_l', edge: 3, mirror: false, reverse: false } },
    { id: 'shoulder_R', kind: 'plain',
      a: { pieceId: 'bodice_front', edge: 3, mirror: true, reverse: false },
      b: { pieceId: 'bodice_back_r', edge: 3, mirror: false, reverse: false } },
    // bodice sides: e1 runs waist -> armpit (the front's sewn length is 25 mm shorter than its cut length: the bust dart)
    { id: 'bodice_side_L', kind: 'plain',
      a: { pieceId: 'bodice_front', edge: 1, mirror: false, reverse: false },
      b: { pieceId: 'bodice_back_l', edge: 1, mirror: false, reverse: false } },
    { id: 'bodice_side_R', kind: 'plain',
      a: { pieceId: 'bodice_front', edge: 1, mirror: true, reverse: false },
      b: { pieceId: 'bodice_back_r', edge: 1, mirror: false, reverse: false } },
    // waist: the bodice waist runs toward the side, the skirt waist toward the centre => reverse
    { id: 'waist_front_L', kind: 'plain',
      a: { pieceId: 'bodice_front', edge: 0, mirror: false, reverse: false },
      b: { pieceId: 'skirt_front', edge: 3, mirror: false, reverse: true } },
    { id: 'waist_front_R', kind: 'plain',
      a: { pieceId: 'bodice_front', edge: 0, mirror: true, reverse: false },
      b: { pieceId: 'skirt_front', edge: 3, mirror: true, reverse: true } },
    { id: 'waist_back_L', kind: 'plain',
      a: { pieceId: 'bodice_back_l', edge: 0, mirror: false, reverse: false },
      b: { pieceId: 'skirt_back_l', edge: 3, mirror: false, reverse: true } },
    { id: 'waist_back_R', kind: 'plain',
      a: { pieceId: 'bodice_back_r', edge: 0, mirror: false, reverse: false },
      b: { pieceId: 'skirt_back_r', edge: 3, mirror: false, reverse: true } },
    // skirt sides: e1 hem -> hip and e2 hip -> waist on every skirt piece
    { id: 'skirt_side_low_L', kind: 'plain',
      a: { pieceId: 'skirt_front', edge: 1, mirror: false, reverse: false },
      b: { pieceId: 'skirt_back_l', edge: 1, mirror: false, reverse: false } },
    { id: 'skirt_side_up_L', kind: 'plain',
      a: { pieceId: 'skirt_front', edge: 2, mirror: false, reverse: false },
      b: { pieceId: 'skirt_back_l', edge: 2, mirror: false, reverse: false } },
    { id: 'skirt_side_low_R', kind: 'plain',
      a: { pieceId: 'skirt_front', edge: 1, mirror: true, reverse: false },
      b: { pieceId: 'skirt_back_r', edge: 1, mirror: false, reverse: false } },
    { id: 'skirt_side_up_R', kind: 'plain',
      a: { pieceId: 'skirt_front', edge: 2, mirror: true, reverse: false },
      b: { pieceId: 'skirt_back_r', edge: 2, mirror: false, reverse: false } },
    // centre back: both halves' CB edges run downwards => no reverse; the bodice's is the zip
    { id: 'cb_bodice', kind: 'plain',
      a: { pieceId: 'bodice_back_r', edge: 5, mirror: false, reverse: false },
      b: { pieceId: 'bodice_back_l', edge: 5, mirror: false, reverse: false } },
    { id: 'cb_skirt', kind: 'plain',
      a: { pieceId: 'skirt_back_r', edge: 4, mirror: false, reverse: false },
      b: { pieceId: 'skirt_back_l', edge: 4, mirror: false, reverse: false } },
  ],
  sizes: {
    measurements: ['chest_cm', 'waist_cm', 'hips_cm', 'height_cm', 'torsoLength_cm', 'armLength_cm', 'shoulderWidth_cm'],
    baseSize: 'M',
    rows: [
      { name: 'S', chest_cm: 84, waist_cm: 66, hips_cm: 92, height_cm: 160, torsoLength_cm: 39, armLength_cm: 55, shoulderWidth_cm: 37 },
      { name: 'M', chest_cm: 88, waist_cm: 70, hips_cm: 96, height_cm: 165, torsoLength_cm: 40, armLength_cm: 56, shoulderWidth_cm: 38 },
      { name: 'L', chest_cm: 92, waist_cm: 74, hips_cm: 100, height_cm: 170, torsoLength_cm: 41, armLength_cm: 57, shoulderWidth_cm: 39 },
      { name: 'XL', chest_cm: 96, waist_cm: 78, hips_cm: 104, height_cm: 175, torsoLength_cm: 42, armLength_cm: 58, shoulderWidth_cm: 40 },
    ],
  },
  sim: { substeps: 10, gravity_ms2: 9.81, selfCollision: true, sewTime_s: 1.0, collisionOffset_mm: 5, bendScale: 1, stretchScale: 1 },
  ui: { split: 0.5, layout: 'split', swapped: false, activeSize: 'M', dockTab: 'pieces', scene: { preset: 'workshop', background: null } },
};
```

- [ ] **Step 4: Register it**

`src/samples/index.js`:
- `import { DRESS } from './dress.js';`
- `SAMPLE_IDS = Object.freeze(['tshirt', 'skirt', 'dress'])`
- append `Object.freeze({ id: 'dress', name: 'Fitted dress', doc: deepFreeze(DRESS) }),` to `SAMPLES`.

`index.html`, after the skirt option: `<option value="dress">Fitted dress</option>`.

`src/core/selftest.js:105`: `for (const id of ['tshirt', 'skirt', 'dress'])`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module core --module geometry --module sizing`

Expected: PASS for `remesh.dress`, `dress.seams`, `remesh.allSamples` (now three samples), and the core sample round trip ("normalizeDoc(sample) deep-equals sample"). If the round trip fails, a field is missing or has a non-normalised value: fix the literal, never the normaliser.

- [ ] **Step 6: Look at it, amend SPEC.md, commit**

1. Open the app on the dress: `python serve.py` then `http://localhost:8710/?sample=dress`.
2. In the 2D view, check the six pieces, their darts and drill marks.
3. Wait for the drape, and note the status bar's seam-gap readout. Task 12 turns this into a check.

§4 amendment: the dress, its pieces, seams, darts, ease and grading rules, as in the design spec §9.

```bash
git add src/samples/dress.js src/samples/index.js index.html src/core/selftest.js src/geometry/selftest.js src/sizing/selftest.js docs/SPEC.md
git commit -m "Add a fitted dress sample: bodice and skirt with darts, joined at the waist" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Acceptance — the dress drapes, and the darts shape it

**Files:**
- Modify: `tests/acceptance.js`:
  - helpers after `landmark`;
  - `reloadSample` resets a new `dressDraped` flag;
  - new checks `checkDressDrape` and `checkDartShaping`;
  - `CHECKS` entries 26g and 26h;
  - `checkJsonRoundtrip`, `checkExportSvg` and `checkDxf` also run on the dress;
  - `checkRuntime` budget
- Modify: `docs/SPEC.md` §13 (amendment block), `docs/CONTRACTS.md` (check count)

**Interfaces:**
- Consumes: `__app.loadSample('dress')`, `__app.sim.*`, `__app.sim.state()` (with `pieces[k].mesh.dartVerts` and `.start`), `__app.body.modelLive().rings.waist.y`, `__app.body.sdf(x, y, z)`, `__app.update(fn, label)`.
- Produces: checks `26g dress_drape` and `26h dart_shaping`.

- [ ] **Step 1: Add the checks (they are the tests)**

In `tests/acceptance.js`:
- next to `let drapeStage`, add `let dressDraped = false;`, and set `dressDraped = false;` inside `reloadSample`;
- after `landmark()`, add:

```js
/** Largest distance between the two vertices of any dart pair in the live cloth, mm. */
function dartGapMax_mm() {
  const st = stateOf();
  let worst = 0;
  for (const pc of st.pieces) {
    for (const list of (pc.mesh.dartVerts || [])) {
      for (const legs of (list || [])) {
        for (let i = 0; i < legs.a.length; i++) {
          const a = pc.start + legs.a[i];
          const b = pc.start + legs.b[i];
          const d = Math.hypot(st.pos[3 * a] - st.pos[3 * b], st.pos[3 * a + 1] - st.pos[3 * b + 1], st.pos[3 * a + 2] - st.pos[3 * b + 2]);
          if (d > worst) worst = d;
        }
      }
    }
  }
  return worst * 1000;
}

/** Mean distance from the body of the bodice's vertices within 30 mm of the waist ring, mm. */
function waistBandGap_mm() {
  const st = stateOf();
  const y0 = app().body.modelLive().rings.waist.y;
  let sum = 0;
  let count = 0;
  for (const pc of st.pieces) {
    if (!String(pc.pieceId).startsWith('bodice')) continue;
    for (let v = pc.start; v < pc.start + pc.count; v++) {
      const y = st.pos[3 * v + 1];
      if (Math.abs(y - y0) > 0.03) continue;
      sum += app().body.sdf(st.pos[3 * v], y, st.pos[3 * v + 2]).d;
      count++;
    }
  }
  expect(count > 0, 'no bodice vertex within 30 mm of the waist ring');
  return (sum / count) * 1000;
}

/** Total bodice waist intake around the body, mm (a fold piece's darts count twice). @param {any} doc */
function bodiceWaistIntake_mm(doc) {
  let I = 0;
  for (const p of doc.pieces) {
    if (!String(p.id).startsWith('bodice') || !Array.isArray(p.darts)) continue;
    for (const d of p.darts) {
      if (p.edges[d.edge] && p.edges[d.edge].label === 'waist') I += d.width_mm * (p.foldEdge !== null ? 2 : 1);
    }
  }
  return I;
}

/** Load the dress and drape it 300 + 240 + 60 frames, as drape_tshirt + drape_rest do. @returns {any} last stats */
async function drapeDress() {
  await reloadSample('dress');
  app().sim.reset();
  app().sim.step(300);
  app().sim.step(240);
  const s = app().sim.step(60);
  dressDraped = true;
  return s;
}
```

Add the checks:

```js
/** @returns {Promise<string>} */
async function checkDressDrape() {
  const s = await drapeDress();
  expect(s.nanCount === 0, `nanCount ${s.nanCount}`);
  expect(s.maxPenetration_mm < 5, `maxPenetration_mm ${fmt(s.maxPenetration_mm)} >= 5`);
  expect(s.seamGapMax_mm < 8, `seamGapMax_mm ${fmt(s.seamGapMax_mm)} >= 8`);
  expect(s.seamGapMean_mm < 3, `seamGapMean_mm ${fmt(s.seamGapMean_mm)} >= 3`);
  const dart = dartGapMax_mm();
  expect(dart < 3, `a dart is still ${fmt(dart)} mm open (>= 3)`);
  return `pen ${fmt(s.maxPenetration_mm)} mm, seam gap max ${fmt(s.seamGapMax_mm)} / mean ${fmt(s.seamGapMean_mm)} mm, dart gap ${fmt(dart)} mm`;
}

/** @returns {Promise<string>} */
async function checkDartShaping() {
  if (!dressDraped) await drapeDress();
  const withDarts = waistBandGap_mm();
  const I = bodiceWaistIntake_mm(app().doc());
  expect(I > 0, 'the dress has no bodice waist darts');
  app().update((d) => { for (const p of d.pieces) p.darts = []; }, 'acceptance: no darts');
  await app().idle();
  app().sim.pause();
  app().sim.reset();
  app().sim.step(300);
  app().sim.step(240);
  app().sim.step(60);
  const without = waistBandGap_mm();
  dressDraped = false;
  const need = 0.5 * I / (2 * Math.PI);
  expect(without - withDarts >= need,
    `darts bring the waist ${fmt(without - withDarts)} mm closer (need >= ${fmt(need)}: half of intake ${fmt(I)} / 2π)`);
  return `waist band ${fmt(withDarts)} mm with darts, ${fmt(without)} without (need ${fmt(need)} closer)`;
}
```

Register after `26f`:

```js
  { id: '26g', name: 'dress_drape', timeoutMs: 40000, fn: checkDressDrape },
  { id: '26h', name: 'dart_shaping', timeoutMs: 40000, fn: checkDartShaping },
```

Extend the existing checks:
- In `checkJsonRoundtrip`, after the T-shirt assertions, repeat the round trip for the dress:

```js
  await reloadSample('dress');
  const d1 = app().save();
  expect(d1 === serializeDoc(normalizeDoc(JSON.parse(d1))), 'dress: save() is not a fixed point');
  app().load(d1);
  await app().idle();
  expect(app().save() === d1, 'dress: load(save()) then save() is not byte-identical');
```

- In `checkExportSvg`, before its `return`:

```js
  const dress = await reloadSample('dress');
  const dressSvg = app().export.sheetSvg('M');
  const legs = (dressSvg.match(/class="dart"/g) || []).length;
  // exported pieces only (the mirrored duplicates are hidden); a fold piece exports its stored half: 2 + 1 + 1 + 1
  const wantLegs = dress.pieces.filter((p) => !p.exportHidden).reduce((n, p) => n + p.darts.length, 0);
  expect(wantLegs === 5 && legs === wantLegs, `dress sheet has ${legs} dart paths, want ${wantLegs} (5)`);
```
- In `checkDxf`, after the undo check, run the same export/import on the dress. Assert every exported dress piece comes back with as many darts as it had (fold pieces: the stored half's count). Then undo.

Raise the runtime budget:
1. Run the full acceptance suite once (Step 2).
2. Read the `ms` of 26g and 26h from `tests/ci/report/results.json`.
3. Set `LIMIT_S = 90 + ceil((ms26g + ms26h) / 10000) * 10`.
4. In `checkRuntime`, replace the literal `90000` and `90 s` with the new limit. Put the reason in the details string, e.g. ``return `total ${…} s (limit ${LIMIT_S} s: 90 + the dress drapes of 26g/26h, measured on <machine>)`;``.
5. In `tests/ci/run_browser_tests.py`, update `TIMING_ACCEPTANCE['27']` to match the new message: `r'the suite took [\d.]+ s \(limit \d+ s'`.

- [ ] **Step 2: Run the checks**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --only acceptance --checks "^(26g|26h)$"`

Expected: PASS for both.

If 26g fails, diagnose before changing anything. Open `http://localhost:8710/?sample=dress&nosim=1` and step it from the console:

```js
__app.sim.reset(); for (let i = 0; i < 6; i++) console.log(__app.sim.step(100))
```

Then fix the **draft**, never the thresholds. Adjust one thing at a time:
1. Pieces start inside the body (`maxPenetration_mm` high at frame 0): increase `placement.wrap` toward 1, or move the bodice down with `offset_mm[1]` = −10.
2. A seam stays open: read which one with `__app.sim.stats()` and the tear markers. Check that seam's sewn lengths at M are within 3 % (`dress.seams` passes), then check its `reverse` flag.
3. A dart stays open: shorten it by 10 mm, keeping the apex on the same line.
4. The dress slides down: the shoulder seams did not close first. Compare with the T-shirt, whose shoulder geometry this draft copies.

Re-run `--module geometry --module sizing` after any draft change.

If 26h fails on the margin only (darts help, but by less than the threshold), report the measured numbers to the user instead of changing the threshold.

- [ ] **Step 3: Run the whole suite**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn`

Expected: every self-test passes (timing rows may warn). Acceptance passes except check 10 (expected failure), including 26g, 26h, 19, 23, 26f and 27.

- [ ] **Step 4: Amend SPEC.md, CONTRACTS.md and commit**

- §13: add 26g and 26h with their bars and the geometric threshold, the extended checks, and the new runtime budget with its reason.
- CONTRACTS.md: the check count is now 34 (01-27 plus 26b-26h).

```bash
git add tests/acceptance.js tests/ci/run_browser_tests.py docs/SPEC.md docs/CONTRACTS.md
git commit -m "Accept the dress: it drapes, its darts close, and they take in the waist" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Guide, README picture, roadmap

**Files:**
- Modify: `src/ui/guideContent.js` (a `darts` section after `seams`; the tools page mentions the Dart tool)
- Modify: `tools/screenshots.py` (a new `dress` shot), `README.md` (a picture and a paragraph), `docs/ROADMAP.md` (item 1 done)
- Test: `src/ui/selftest.js` (the existing guide checks find the new section)

**Interfaces:**
- Consumes: the finished feature.
- Produces: the guide section `id: "darts"`; `docs/images/dress.jpg`.

- [ ] **Step 1: Add the guide page**

In `src/ui/guideContent.js`, after the `seams` entry:

```js
  {
    id: "darts",
    title: "Darts",
    keywords: ["dart", "darts", "dart tool", "T key", "bust dart", "waist dart", "intake", "dart point", "apex", "drill hole", "fitted", "shaping"],
    html: `
<p>A dart folds away a wedge of fabric so a flat piece can follow the body: over the bust, into the waist. In Clothing CAD a dart opens onto an edge of a piece; the piece's outline stays as drawn, and the dart is sewn shut in 3D.</p>
<h3>Add a dart</h3>
<ol>
<li>Click <span class="guide-ui">Dart</span> or press <kbd>T</kbd>.</li>
<li>Click the edge where the dart should open. A 20 mm dart appears there, pointing 80 mm into the piece (shorter when that does not fit).</li>
</ol>
<h3>Shape it</h3>
<p>With the Dart tool, drag the <strong>point</strong> anywhere inside the piece, drag a <strong>corner of the mouth</strong> to change the width, or drag the <strong>middle of the mouth</strong> to slide the dart along its edge. A drag that would make the dart invalid — its point outside the piece, its legs crossing the outline or another dart — shows in red and snaps back. For exact values use the <span class="guide-ui">Darts</span> list in the <a data-guide="pieces-panel">Pieces tab</a>: position along the edge, width, length and angle. <kbd>Delete</kbd> removes the selected dart.</p>
<h3>Seams and darts</h3>
<p>A seam compares the <em>sewn</em> lengths of its edges: an edge's length less the width of its darts. A 200 mm waist with a 20 mm dart sews to a 180 mm waist with no ease. The darts on the two sides of a seam do not have to line up.</p>
<h3>Printing and exporting</h3>
<p>The cut line ignores darts (the fabric is folded, not cut). The pattern sheet draws each dart's legs, a notch where each leg meets the edge, and a drill hole 10 mm back from the point. DXF-AAMA carries darts both ways.</p>
<p>Try the <strong>Fitted dress</strong> sample: bust and waist darts on the bodice, waist darts on the skirt.</p>
`,
  },
```

In the tools section (search `id: "tools"` or the page that lists Notch), add a sentence that mentions the Dart tool (`T`) and links `data-guide="darts"`.

- [ ] **Step 2: Run the UI self-test**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn --module ui`

Expected: PASS. The guide checks (the sanitizer, search and links) cover the new section. The shortcut table picks up `T` from `SHORTCUTS` automatically.

- [ ] **Step 3: Add the README picture**

In `tools/screenshots.py`, add a shot:

```python
def shot_dress(page) -> None:
    """The fitted dress: bust and waist darts, a waist seam, a centre-back zip."""
    page.evaluate("(o) => window.__shot.drape(o)", {'sample': 'dress', 'scene': 'studio'})
    full_body(page, 25)
    img = png_from_data_url(page.evaluate('() => window.__shot.canvasPng()'))
    save(shrink(center_crop(img, round(img.height * 0.55), img.height)), 'dress.jpg')
```

and register `'dress': shot_dress` in `SHOTS`.

Run: `python tools/screenshots.py dress`, then open `docs/images/dress.jpg` and check the dress is draped and closed.

In `README.md`, under "What it does today", after "Pick the fabric", add a section "### Shape it with darts" with the picture (`![The fitted dress sample: a navy cotton sheath with bust and waist darts, a waist seam and a centre-back zip](docs/images/dress.jpg)`) and two sentences on the Dart tool and sewn lengths.

Also:
- In "Where it's heading", mark item 1 done.
- Update the "Two garments are built in" sentence to three.
- In `docs/ROADMAP.md`, mark item 1 as done and move the darts from "Not yet" to "Works today".

Finally, update `docs/CONTRACTS.md` for every export this plan added:
- `src/geometry`: the dart API of Task 2, and `seamSampleFractions` now returning sewn fractions.
- `src/cloth`: `pairByIndex`, `pairByFraction`, `FRACTION_EPS`, `makeDartTubeFixture`.
- `src/pattern`: `sewnLengthOf`; `'dart'` in `TOOL_NAMES` and `EDITOR_TOOLS`; `createDartTool`, `proposeDart`.
- `src/ui`: `tool-dart`, `piece-darts`, `list-darts`.
- The self-test counts per module, from the last full run.

- [ ] **Step 4: Full run and commit**

Run: `python tests/ci/run_browser_tests.py --serve --gpu --timing warn`

Expected: the same result as Task 12 Step 3.

```bash
git add src/ui/guideContent.js tools/screenshots.py docs/images/dress.jpg README.md docs/ROADMAP.md docs/CONTRACTS.md
git commit -m "Document darts in the guide and the README, and mark roadmap item 1 done" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
