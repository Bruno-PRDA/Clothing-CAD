# Clothing App

A self-contained web application for designing clothing: draw pattern pieces in 2D, sew them
together, and drape them on a 3D human body fitted to your measurements, with a real cloth simulation
(XPBD). Export size charts and print-ready sewing patterns.

**New here? Click `? Guide` at the right end of the toolbar, or press `?`.** The built-in user guide walks
through the whole app — a five-minute tour, every tool and panel, sizes and fit warnings, exporting, keyboard
shortcuts and troubleshooting — and the small `?` buttons on the panels open it at the matching section.

No installation, no build step, no Node.js. Everything is plain JavaScript ES modules; three.js is
loaded from a CDN import map (run `python vendor.py` once if you want it to work offline).

## Run

```bash
python serve.py
```

This starts a local server on http://localhost:8710/ and opens it in your default browser
(Chrome, Edge or Firefox). Double-clicking `run.bat` does the same on Windows.

## Windows

| Pane | What it does |
|---|---|
| Left: **2D pattern editor** | Draw pieces (lines and bezier curves), edit points, split edges, define seams (click edge A then edge B), notches, grainlines, fold edges, seam allowance. |
| Right: **3D physics view** | The garment is arranged around the body, sewn (seams pull together) and draped with an XPBD cloth solver. Orbit with the mouse. `Pop out` opens the 3D view in its own window. |
| Dock: **Pieces / Body / Fabric / Sizes** | Piece properties and placement; body presets and 24 sliders (measurements plus height, weight, build, age and sex); fabric presets, colour and texture; size chart and grading. |

The body is MakeHuman's CC0 template mesh (`assets/body/`, see its `LICENSE.md`), reshaped by morph targets until its
measurements match the Body tab. If those files cannot be loaded, a simpler analytic mannequin is used instead.
A banner warns when the active size is too small for the body, and markers show where the cloth over-stretches.

Keyboard: `V` select, `P` draw, `E` edit, `S` seam, `N` notch, `G` grainline, `M` measure,
`Space` play/pause, `D` drape, `R` reset, `Ctrl+Z`/`Ctrl+Y` undo/redo, `Delete`, `Esc`, `?` guide.
The guide's *Keyboard shortcuts* page lists every binding.

## Export

* **SVG** pattern sheet at 1:1 scale in millimetres, per size, with cut line, stitch line,
  notches, grainline, fold labels and a 100 mm calibration square.
* **Print** tiled pages (A4 / Letter / A3) for printing at 100 %, then taping together.
* **CSV / JSON** size chart and piece measurements.
* **JSON** project save / load; **OBJ** of the draped garment.

## Project layout

```
index.html, popout.html    app shell and pop-out window
serve.py, run.bat          dev server (Python standard library only)
vendor.py                  optional: vendor three.js locally for offline use
styles/                    CSS
src/core/                  shared contracts: types, events, store, schema, units, fabrics, sdf
src/samples/               built-in garments (T-shirt, A-line skirt)
src/geometry/              2D maths: beziers, polygons, Delaunay remesh, offset, packing
src/pattern/               2D pattern editor
src/body/                  body: MakeHuman template, measurements, fit to the sliders, SDF bake (+ analytic fallback)
assets/body/               the template mesh and morph targets (CC0), built by tools/build_body_assets.py
src/cloth/                 XPBD cloth solver, collision, seams, fixtures
src/viewer3d/              three.js scene, cloth/body meshes, materials, textures
src/sizing/, src/export/   size charts, grading, SVG / print / CSV / OBJ export
src/ui/                    toolbar, dock panels, status bar, shortcuts, fit banner, user guide (guideContent.js)
src/app/                   boot, wiring, window.__app automation API
tests/acceptance.js        in-page acceptance suite: __app.acceptance.run()
docs/SPEC.md               the full specification (single source of truth)
docs/CONTRACTS.md          per-module API cheat sheet
```

## Automation / debugging

Open the browser console and use `window.__app` (see `docs/SPEC.md` section 12), e.g.

```js
__app.loadSample('tshirt'); __app.sim.step(300)      // simulate 5 s synchronously, returns stats
__app.body.setParam('chest_cm', 100)                  // rebuild the body
__app.export.sheetSvg('L')                            // SVG string for size L
__app.acceptance.run()                                // run the acceptance suite
```
