# Roadmap

Where Clothing CAD is going, and in what order. `docs/SPEC.md` stays the single source of truth for what is
built. Each item below gets its own design and SPEC amendment before any code, as every change so far has.

## Direction

**Clothing CAD is for fashion designers: an open-source, in-browser alternative to CLO 3D and Marvelous Designer.**
A designer should be able to draft any garment, see it on a body they trust, and send it to the cutting room,
without installing anything.

The ground rules do not change: plain JavaScript modules, no build step, no Node.js, three.js as the only
dependency, everything running in the browser.

## Where it stands (September 2026)

| Works today | Not yet |
|---|---|
| 2D pattern editor: straight and curved edges, seams, notches, darts (a dart tool and a Darts list), grainlines, fold edges, per-edge seam allowance | Tools for internal lines; darts pointed at both ends, inside a piece (every dart opens onto an edge) |
| XPBD cloth simulation: sewing, gravity, body collision with friction, self-collision; darts sewn shut, seams that compare sewn lengths | Gathers, pleats, elastic; seams across several edges or part of one |
| MakeHuman CC0 body fitted to 24 measurements, 9 presets | Posing (the arm and leg angle sliders do not move the template body), animation |
| Size chart and grading (darts keep their width); drapes the size you pick; warns before a size too small tears, checking each part of a garment against the body it covers | Men's and children's size charts (the default chart is a women's S–XL) |
| 7 fabric presets, 6 procedural textures, 7 scene presets; three built-in garments (T-shirt, A-line skirt, fitted dress) | Fabric textures from image files; warp/weft anisotropy |
| Export: 1:1 SVG, tiled print, CSV/JSON, OBJ, DXF-AAMA in and out; darts included | More than one garment at a time; collars, cuffs, plackets, pockets |
| 205 self-tests and 34 acceptance checks on every push | A cloth solver off the main thread (it is designed for a Web Worker but does not use one) |

Visible limits of the drape today:

* Woven cotton stretches about 8 % under its own weight; real cotton stretches 1–2 %. Acceptance check 10 stays
  red on purpose until that is fixed rather than tuned away (SPEC section 13).
* A piece without darts can follow the bust or the waist only by stretching or standing away from it; the T-shirt and the skirt have none.
* Collision uses a 15 mm distance grid, so body details smaller than that (nipples) show through close-fitting
  cloth, visible in the pictures in the README.
* On a laptop GPU the 4 000-vertex benchmark takes about 22 ms a frame, against a 16 ms budget.

## The plan

### 1. Darts and a fitted dress — *done*

The first garment beyond the T-shirt and skirt: a **sleeveless dress with a waist seam**. The bodice has bust
darts opening into the side seams and waist darts opening into the waist seam, the back is cut in two halves with
a centre-back zip, and the skirt has waist darts. Every dart opens onto an edge, so the mesher needs no holes, and
there are no sleeves, so no arm collisions.

* **Darts are real objects** on a piece: the edge they open onto, their position along it, their width, and
  their point. The outline stays clean; the dart is cut in when the piece is meshed and its legs are sewn
  automatically.
* **Seams pair by sewn length**, skipping dart openings, so the bodice waist and the skirt waist stay one seam
  even when their darts do not line up.
* A **dart tool** in the editor (`T`) and a Darts list in the Pieces tab; grading keeps each dart's position and
  width; export draws darts the way a pattern-maker does (legs and a drill hole) in SVG, print and DXF-AAMA.
* The fit check now measures each part of a garment against the body it covers (the bodice against bust and
  waist, the skirt against waist and hips), so the dress and the A-line skirt no longer get false "will tear"
  warnings.

### 2. Speed

Move the cloth solver into a **Web Worker** (it was written for that: typed arrays, no DOM), so the page stays
responsive while bigger garments simulate. The dress is about 6 000 vertices; layered outfits will be more. Add a
performance check that fails on a real regression instead of only warning.

### 3. Shirts

Set-in sleeves, a **collar and stand**, **cuffs**, and a button **placket** that overlaps. This needs seams
across several edges and on part of an edge, **gathers and pleats**, and **elastic**.

### 4. Outfits on a posed body

**Several garments at once**, layered (a shirt under a jacket). **Pose** the body: the arm and leg angles should
move the template body, not just the old mannequin. Later, a simple walk to see the garment move.

### 5. Trousers

Crotch curve, inseam, waistband and fly; the legs apart; cloth between the legs, which is the hardest collision
case.

### 6. A drape you can trust

* **Calibrated woven stretch**, closing acceptance check 10 honestly.
* **Anisotropy**: fabric behaves differently along the grain, across it and on the bias.
* Edge-to-triangle self-collision; a **finer collision field near the body** so small details stop showing
  through.
* **Pin and drag cloth in 3D.**

### 7. A one-piece sheath dress

Darts pointed at both ends, inside the piece: the mesher learns to cut holes and sew around them. This extends
the dart model of step 1.

### Later and ideas

* Dart manipulation: pivot and transfer darts; dart caps on the cut line.
* Drafting from measurements: pattern points that follow the body.
* Men's and children's size charts.
* Fabric textures from your own images.
* Place fold pieces freely in 2D (today a fold must lie on x = 0, so front and back overlap).
* Install as an offline app; share a project by link.

### Housekeeping

Small, independent and worth doing soon:

* `src/geometry/remesh.js` contains a raw NUL character, so git treats the mesher as a binary file and its diffs
  do not show.
* Bring SPEC.md and CONTRACTS.md back in line with the code (self-collision every 4th substep, friction floor,
  test counts, section 6 still describing the primitive body).
* Remove the Phase-1 "module not implemented yet" skip paths from the sizing and export tests.
* Split `src/app/wiring.js` (1 800 lines) and `src/app/debugApi.js` (1 900 lines) by concern.
