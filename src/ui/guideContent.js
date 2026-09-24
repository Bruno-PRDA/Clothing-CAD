// src/ui/guideContent.js — the text of the in-app user guide (rendered by src/ui/guide.js).
// Pure data. Each section: {id, title, keywords, html}. The HTML contract is in guide.js (ALLOWED/CLASSES):
// h3 h4 p ul ol li strong em code kbd table thead tbody tr th td br, div.guide-tip, div.guide-warn,
// span.guide-ui for a visible control label, a[data-guide="<section id>"] for a cross-link. Anything else
// is stripped when it is rendered.
//
// Drafted from the code by four writers and fact-checked against it (2026-09-23). When a control, label or
// behaviour changes, change the matching section here; the UI self-test `guide` catches broken cross-links.

/** @type {ReadonlyArray<{id: string, title: string, keywords: string[], html: string}>} */
export const GUIDE_SECTIONS = Object.freeze([
  {
    id: "getting-started",
    title: "Getting started",
    keywords: ["tour", "first steps", "quick start", "tutorial", "t-shirt", "sample", "drape", "body", "size", "export", "print", "save", "beginner"],
    html: `
<p>This five-minute tour uses the built-in T-shirt to walk through the whole loop: pattern, body, drape, size and export.</p>
<ol>
<li><strong>Load the T-shirt.</strong> The app opens with the T-shirt already loaded and starts draping it straight away. To get a fresh copy at any time, choose <span class="guide-ui">T-shirt</span> in the sample list on the toolbar and click <span class="guide-ui">Load sample</span>.</li>
<li><strong>Look at the pattern.</strong> The 2D pane (left) shows the flat pieces, drawn on top of one another: <strong>Front</strong> and <strong>Back</strong> share the same fold, and the two sleeves overlap them. Click a name in the <span class="guide-ui">Pieces</span> tab to highlight that piece and show its edge names. The yellow <em>FOLD</em> line marks a fold, with the mirrored half drawn faintly. Dashed outlines show the seam allowance, and coloured lines show which edges are sewn together. Scroll to zoom; press <kbd>F</kbd> to fit everything in view.</li>
<li><strong>Look at the body.</strong> The 3D pane (right) shows a scanned human body shaped to the measurements in the <span class="guide-ui">Body</span> tab, wearing the T-shirt. Left-drag to orbit, right-drag to pan, scroll to zoom. <span class="guide-ui">Frame</span> (<kbd>Shift</kbd>+<kbd>F</kbd>) re-centres the view.</li>
<li><strong>Drape.</strong> Click <span class="guide-ui">Drape</span> (<kbd>D</kbd>). The pieces jump to their places around the body, the seams pull shut over a second or two, and the fabric settles under gravity. It keeps simulating until you click <span class="guide-ui">❚❚ Pause</span> or press <kbd>Space</kbd>.</li>
<li><strong>Change the body.</strong> In the <span class="guide-ui">Body</span> tab, pick another <span class="guide-ui">Preset</span> such as <em>Female L</em>, or drag a slider such as <span class="guide-ui">Chest / bust (cm)</span>. The body rebuilds as you go. Click <span class="guide-ui">Drape</span> again to sew the garment onto the new body from scratch.</li>
<li><strong>Change the size.</strong> Choose <em>L</em> in the toolbar's <span class="guide-ui">Size</span> list. Unless you have paused the simulation, the garment is graded to that size and re-draped automatically. The 2D pane keeps the pattern as you drew it and adds a dashed green outline of the chosen size; the 3D garment and the exports use that size. If the size is too small for the body, a banner at the top-left of the work area says so and offers a size that fits.</li>
<li><strong>Export and save.</strong> Pick your paper (<span class="guide-ui">A4</span>, <span class="guide-ui">Letter</span> or <span class="guide-ui">A3</span>) and click <span class="guide-ui">Print</span>. A new browser tab opens with the active size tiled across pages, each with a 100 mm test square; print at 100&nbsp;% scale or save as PDF. Then click <span class="guide-ui">Save</span> to download the project so you can reopen it later.</li>
</ol>
<div class="guide-warn"><span class="guide-ui">Load sample</span> replaces whatever is open without asking. Click <span class="guide-ui">Save</span> first if you want to keep your own work.</div>
<div class="guide-tip">Next, read <a data-guide="workspace">The workspace</a> for a tour of the screen, or <a data-guide="drawing-pieces">Drawing pieces</a> to start your own pattern.</div>
`,
  },
  {
    id: "workspace",
    title: "The workspace",
    keywords: ["screen", "layout", "toolbar", "pane", "2D", "3D", "split", "swap", "pop-out", "resize", "dock", "tabs", "status bar", "zoom", "pan", "orbit", "camera", "navigate"],
    html: `
<p>The screen has five parts: the toolbar across the top, the 2D pattern pane, the 3D pane, the dock on the right and the status bar at the bottom.</p>
<h4>Toolbar</h4>
<p>From left to right: <span class="guide-ui">New</span>, <span class="guide-ui">Open</span>, <span class="guide-ui">Save</span>, the sample list and <span class="guide-ui">Load sample</span>; <span class="guide-ui">↶ Undo</span> and <span class="guide-ui">↷ Redo</span>; the pattern tools (<span class="guide-ui">Select</span> to <span class="guide-ui">Measure</span>, then <span class="guide-ui">Fold</span> and <span class="guide-ui">Fit</span>); the simulation controls (<span class="guide-ui">Arrange</span>, <span class="guide-ui">Drape</span>, <span class="guide-ui">▶ Play</span>/<span class="guide-ui">❚❚ Pause</span>, <span class="guide-ui">Reset</span>, <span class="guide-ui">Self-collision</span>, <span class="guide-ui">Frame</span>); the <span class="guide-ui">Size</span> list; the view buttons; the paper list and <a data-guide="exporting">export buttons</a>; and <span class="guide-ui">? Guide</span> at the far right. Hover over a button for a short description and, where there is one, its <a data-guide="shortcuts">shortcut</a>.</p>
<h4>Moving around</h4>
<p><strong>2D pane:</strong> scroll to zoom around the pointer; drag with the middle mouse button, or hold <kbd>Space</kbd> and drag, to pan. <kbd>+</kbd> and <kbd>-</kbd> zoom; <kbd>0</kbd> or <kbd>F</kbd> fits all pieces.</p>
<p><strong>3D pane:</strong> left-drag orbits around the body, right-drag (or <kbd>Shift</kbd>+left-drag) pans, and scrolling or middle-dragging zooms. <span class="guide-ui">Frame</span> (<kbd>Shift</kbd>+<kbd>F</kbd>) re-centres. The <span class="guide-ui">Scene</span> control at the pane's bottom right changes the backdrop and floor (see <a data-guide="scene">The 3D scene</a>). With a single piece selected, placement guides appear around the body, with that piece's zone highlighted.</p>
<div class="guide-warn"><kbd>Space</kbd> also plays and pauses the simulation, so panning with it toggles the drape. The middle button pans without side effects.</div>
<h4>Arranging the panes</h4>
<p>Drag the bar between the panes to resize them; double-click it to return to half and half. <span class="guide-ui">Split</span>, <span class="guide-ui">2D</span> and <span class="guide-ui">3D</span> (keys <kbd>3</kbd>, <kbd>1</kbd>, <kbd>2</kbd>) show both panes or just one, and <span class="guide-ui">⇆ Swap</span> exchanges their sides. <span class="guide-ui">Pop-out 3D</span> moves the 3D view into its own window, for example on a second monitor, where you can orbit it too. Click <span class="guide-ui">Bring back</span>, or close that window, to return it.</p>
<div class="guide-warn">The cloth simulates while a 3D view is showing, in the main window or in the pop-out. In the 2D layout with no pop-out open, or with the browser tab in the background, the drape waits, and it carries on when a 3D view is back.</div>
<h4>The dock</h4>
<p>Four tabs, also on <kbd>F1</kbd> to <kbd>F4</kbd>: <a data-guide="pieces-panel">Pieces</a> (piece, edge and seam settings), <a data-guide="body">Body</a> (measurements), <a data-guide="fabric">Fabric</a> (material and look) and <a data-guide="sizes-grading">Sizes</a> (the size chart).</p>
<h4>Status bar</h4>
<p>From left to right:</p>
<ul>
<li>a hint for the active tool;</li>
<li>messages (information fades after a few seconds; errors stay until the next message);</li>
<li>the pointer position on the pattern, x and y in mm;</li>
<li>while you pick edges with the Seam tool, both edge lengths and the ease;</li>
<li>mesh quality: smallest triangle angle, vertices (v) and triangles (t);</li>
<li>the simulation: frames per second, time per step, vertices and frame number, plus "paused" when paused.</li>
</ul>
`,
  },
  {
    id: "scene",
    title: "The 3D scene",
    keywords: ["scene", "background", "backdrop", "colour", "color", "floor", "stand", "pedestal", "runway", "catwalk", "studio", "wood", "terrace", "environment", "shadow"],
    html: `
<p>The <span class="guide-ui">Scene</span> control at the bottom right of the 3D pane sets what the body stands in: the backdrop behind it and the floor under its feet. It only changes the picture. The fit, the drape, the warnings and the exports are the same in every scene.</p>
<table>
<thead><tr><th>Scene</th><th>What you get</th></tr></thead>
<tbody>
<tr><td>Workshop grid</td><td>The default: a dark backdrop and a measuring grid on the floor. Best for checking where pieces sit.</td></tr>
<tr><td>Light studio</td><td>A white seamless studio, like a product photo.</td></tr>
<tr><td>Dark studio</td><td>The same in charcoal, which makes pale fabrics stand out.</td></tr>
<tr><td>Pedestal</td><td>The body stands on a round white platform.</td></tr>
<tr><td>Runway</td><td>A raised catwalk with lit edges, in a dark room.</td></tr>
<tr><td>Wooden floor</td><td>Oak planks in a warm room.</td></tr>
<tr><td>Terrace</td><td>Stone paving under a pale sky.</td></tr>
</tbody>
</table>
<p>In every scene the feet rest on the floor or platform, and the body casts its shadow on it. Except in Workshop grid, the floor fades into the backdrop, so there is no edge to see however you orbit.</p>
<h4>Your own background colour</h4>
<p>Click the colour swatch next to the list to choose a backdrop colour; the floor fades into it as well. Click <span class="guide-ui">↺</span> to go back to the scene's own backdrop.</p>
<p>The scene is saved with the project, like the layout, and the pop-out window shows the same one. Choosing a scene is not an undo step.</p>
<div class="guide-tip">With a solid floor the camera can't go below it, whether you orbit or pan. To look at a garment from underneath, switch to Workshop grid.</div>
`,
  },
  {
    id: "projects-files",
    title: "Projects and files",
    keywords: ["save", "open", "new", "project file", "json", "load sample", "samples", "skirt", "undo", "redo", "history", "autosave", "unsaved", "reload", "recover", "restore", "crash", "url options"],
    html: `
<p>A project holds everything you work on: pattern pieces, seams, fabrics, body measurements, the size chart, simulation settings, and the layout, active size and scene. Save it to a file to keep it, share it or move it to another computer.</p>
<h4>Saving</h4>
<p>Click <span class="guide-ui">Save</span> (<kbd>Ctrl</kbd>+<kbd>S</kbd>). Your browser downloads a project file named after the project, such as <code>basic-t-shirt.clothing.json</code>, or <code>untitled.clothing.json</code> for a new one, into its usual downloads location. You can rename the file; keep the <code>.json</code> ending so <span class="guide-ui">Open</span> can find it. The draped shape is not stored: the garment is draped again when you open the file.</p>
<h4>Opening</h4>
<p>Click <span class="guide-ui">Open</span> (<kbd>Ctrl</kbd>+<kbd>O</kbd>) and choose a project <code>.json</code> file. It replaces the current project, including the layout and active size saved with it. If the file is not a valid project, an error appears in the status bar and your current work is left as it was.</p>
<h4>New projects and samples</h4>
<p><span class="guide-ui">New</span> starts an empty project called <em>Untitled</em>: no pieces, the <em>Female M</em> body, a size chart from S to XL with M as the base size, and one cotton fabric. The sample list offers <span class="guide-ui">T-shirt</span> (front and back on the fold, two sleeves) and <span class="guide-ui">A-line skirt</span> (front and back, waist pinned to the body). Choose one and click <span class="guide-ui">Load sample</span>. Unless you ask for something else (see the tip below), the app starts with the T-shirt.</p>
<h4>Autosave and recovery</h4>
<p>While you work, the app keeps a copy of the project in this browser, a second or two after each change and again when you close or leave the tab. If the tab closes, the browser crashes or you reload before saving, the next time you open the app a banner at the top offers your unsaved work back: <span class="guide-ui">Restore</span> brings it back, <span class="guide-ui">Discard</span> forgets it. Autosave pauses until you choose.</p>
<p>The copy lives in this browser only. It is not a file, it does not follow you to another browser or computer, and clearing the browser's site data deletes it. Only changes to the work itself count as unsaved: moving the pane divider or changing the scene does not bring up the banner.</p>
<div class="guide-warn"><span class="guide-ui">New</span>, <span class="guide-ui">Open</span> and <span class="guide-ui">Load sample</span> replace the project straight away, with no "save changes?" question, and clear the undo history. Unsaved work is not recoverable after that, so click <span class="guide-ui">Save</span> first if you want to keep it.</div>
<h4>Undo and redo</h4>
<p><span class="guide-ui">↶ Undo</span> (<kbd>Ctrl</kbd>+<kbd>Z</kbd>) and <span class="guide-ui">↷ Redo</span> (<kbd>Ctrl</kbd>+<kbd>Y</kbd> or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>) cover the last 100 changes to the pattern, seams, body, fabrics, size chart and simulation settings. A drag counts as one step once you let go. View changes (layout, pane sizes, dock tab and the active size) are not steps, and undo leaves them alone. Making a new change after undoing discards the redo steps.</p>
<div class="guide-tip">Start-up options: add <code>?sample=skirt</code> to the app's address to open with the skirt, <code>?sample=none</code> to start empty, <code>?size=L</code> to start in size L, or <code>?nosim=1</code> to start with the garment arranged but not simulating (handy on a slow computer). Combine them with <code>&amp;</code>, for example <code>?sample=skirt&amp;size=L</code>.</div>
`,
  },
  {
    id: "drawing-pieces",
    title: "Drawing pieces",
    keywords: ["draw", "draw tool", "new piece", "outline", "points", "close piece", "snap", "snapping", "grid", "45 degrees", "shift", "ctrl", "cancel", "undo point", "piece too small", "crosses itself", "P key"],
    html: `
<p>Pieces are closed outlines that you draw in the 2D pattern view. Everything is in millimetres: the fine grid lines are 10 mm apart and the stronger ones 50 mm, and the status bar at the bottom shows the cursor position as x and y.</p>
<h3>Draw an outline</h3>
<ol>
<li>Click <span class="guide-ui">Draw</span> in the toolbar, or press <kbd>P</kbd>.</li>
<li>Click where the first corner goes, then click each next corner in turn. A line follows the cursor from the last point.</li>
<li>Close the outline: click the first point again (a blue ring appears around it once there are three points), double-click to place the last point and close in one go, or press <kbd>Enter</kbd>.</li>
</ol>
<p>The new piece is selected and named <em>Piece</em> plus a number, one more than the number of pieces already in the project (so the first piece of an empty project is <em>Piece 1</em>). Draw stays active, so you can start the next piece straight away.</p>
<h3>Straight edges only</h3>
<p>Draw makes straight edges. To curve one, such as a neckline or armhole, switch to <span class="guide-ui">Edit</span> and double-click the edge; see <a data-guide="editing-shapes">Editing shapes</a>.</p>
<h3>Snapping</h3>
<ul>
<li>Points snap to whole millimetres. Hold <kbd>Ctrl</kbd> while clicking to place a point without rounding.</li>
<li>Clicking within a few pixels of a corner of any piece snaps onto that corner, including the corners of the dashed mirrored half of a folded piece.</li>
<li>Hold <kbd>Shift</kbd> to keep the new edge at 0°, 45°, 90° and so on from the previous point, which gives exactly vertical centre lines.</li>
</ul>
<h3>Fix mistakes while drawing</h3>
<ul>
<li><kbd>Delete</kbd> or <kbd>Backspace</kbd> removes the last point you placed.</li>
<li><kbd>Esc</kbd> discards the unfinished outline. Switching to another tool does the same.</li>
</ul>
<h3>What a valid piece needs</h3>
<p>A piece is only created when the outline has at least 3 points, covers at least 1 cm² and does not cross itself. If not, the status bar says why and you can carry on adding or removing points.</p>
<div class="guide-tip">For a piece cut on the fold, draw only half of it with the centre line as a straight vertical edge, then use <span class="guide-ui">Fold</span>. See <a data-guide="pattern-tools">Pattern tools</a>.</div>
<p>A new piece gets a 10 mm seam allowance, the first fabric and a vertical grainline through its middle, and it is placed on the front of the torso in 3D. Until it is sewn to something, the Issues list warns that it has no seams and will fall. Set it up in the <a data-guide="pieces-panel">Pieces tab</a> and join it with the <a data-guide="seams">Seam tool</a>.</p>
`,
  },
  {
    id: "editing-shapes",
    title: "Editing shapes",
    keywords: ["select", "edit", "move piece", "move point", "vertex", "curve", "bezier", "handles", "nudge", "arrow keys", "box select", "delete point", "delete piece", "insert point", "alt click", "rotate", "flip", "undo"],
    html: `
<p>Two tools change pieces after you have drawn them: <span class="guide-ui">Select</span> (<kbd>V</kbd>) moves whole pieces and <span class="guide-ui">Edit</span> (<kbd>E</kbd>) reshapes outlines.</p>
<h3>Select and move pieces</h3>
<ul>
<li>Click inside a piece or on its outline to select it. The outline turns blue and its corners get small square markers.</li>
<li><kbd>Shift</kbd>+click adds a piece to the selection, or takes it out.</li>
<li>Drag across empty space to draw a box: every piece it touches is selected (hold <kbd>Shift</kbd> to add them). A plain click on empty space clears the selection.</li>
<li>Drag a selected piece to move it with the rest of the selection. It moves in whole millimetres (<kbd>Ctrl</kbd> for free movement); hold <kbd>Shift</kbd> to move only horizontally or only vertically.</li>
<li>Clicking an edge also selects that edge for the Edge box in the Pieces tab. If the edge is sewn, its seam is selected too.</li>
<li>Double-click a piece to switch to Edit.</li>
</ul>
<p>Arrow keys nudge the selected pieces by 1 mm, <kbd>Shift</kbd>+arrow by 10 mm. Click the pattern first so the arrows do not go to a panel field.</p>
<h3>Move points and shape curves</h3>
<ul>
<li>With Edit, drag any corner point to move it. It snaps like Draw: to whole millimetres and onto other corners. With a point selected, the arrow keys nudge that point instead of the piece.</li>
<li>Double-click an edge to turn it into a curve, and again to make it straight. A new curve starts straight, with two handles (white dots) a third of the way in from each end. Drag them to bend the curve.</li>
<li>Hold <kbd>Shift</kbd> while dragging a handle to keep the curve smooth through the corner: if the neighbouring edge is curved too, its handle swings into line.</li>
<li><kbd>Alt</kbd>+click an edge to add a new point on it.</li>
</ul>
<h3>Delete</h3>
<p>In Edit, select a point and press <kbd>Delete</kbd>. The two edges beside it merge into one straight edge and lose their notches; a seam on them can be removed too, so check the Seams list. A piece always keeps at least 3 points.</p>
<p>In Select, <kbd>Delete</kbd> removes the selected pieces and their seams. If you clicked a sewn edge, it removes only that seam.</p>
<div class="guide-warn">In Edit, <kbd>Delete</kbd> with no point or notch selected removes the whole selected piece. <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes it.</div>
<div class="guide-tip">If a dragged point makes the outline cross itself, the piece gets a red outline and an entry under Issues. Drag the point back or undo.</div>
<p>There is no rotate command. For the other side of the body, duplicate the piece and tick <span class="guide-ui">Flip</span> under Placement in the <a data-guide="pieces-panel">Pieces tab</a>: the 2D shape stays as it is and is mirrored when placed in 3D.</p>
`,
  },
  {
    id: "pattern-tools",
    title: "Pattern tools",
    keywords: ["split", "notch", "double notch", "grain", "grainline", "measure", "distance", "area", "fold", "cut on fold", "mirror", "fit", "zoom", "shift+m", "X", "N", "G", "M", "F"],
    html: `
<p>These toolbar tools add construction details. While one is active, the status bar shows a short reminder of how to use it.</p>
<h3>Split (<kbd>X</kbd>)</h3>
<p>Hover over an edge (a small yellow cross marks the spot) and click to add a point there, dividing the edge in two. Use it when only part of an edge should be sewn. If the edge was sewn, that seam is removed; re-create it on the half you need. The fold edge cannot be split.</p>
<h3>Notch (<kbd>N</kbd>)</h3>
<p>Click an edge to add a notch; <kbd>Shift</kbd>+click adds a double notch. Drag a notch to slide it along its edge, double-click it to switch between single and double, and press <kbd>Delete</kbd> to remove the selected one. On a folded piece, place notches on the solid half; they are repeated on the dashed half.</p>
<h3>Grain (<kbd>G</kbd>)</h3>
<p>Every piece has a grainline, drawn as an orange arrow. To redraw it, press on the piece and drag along the grain; the arrowhead goes where you let go. Hold <kbd>Shift</kbd> for 45° steps. Drags under 5 mm are ignored, so a click only selects the piece. To adjust the line instead, select the piece and drag either end.</p>
<p>The grainline is a cutting mark on the exported pattern; the 3D simulation does not use it.</p>
<h3>Measure (<kbd>M</kbd>)</h3>
<p>Drag between two points to read the distance in millimetres, the horizontal and vertical difference and the angle, on the canvas and in the status bar. It snaps like Draw. Click an edge without dragging for its length, or inside a piece for its area in cm² and its width × height. <kbd>Esc</kbd> clears the reading.</p>
<h3>Fold (<kbd>Shift</kbd>+<kbd>M</kbd>)</h3>
<p>For a piece cut on the fold:</p>
<ol>
<li>Draw half the piece, with the centre line as a straight vertical edge.</li>
<li>With <span class="guide-ui">Select</span>, click that edge.</li>
<li>Click <span class="guide-ui">Fold</span>.</li>
</ol>
<p>The piece moves so the fold edge lies on the grid's vertical axis line, mirrored if needed so the half sits to the right. The fold edge becomes a dashed yellow line marked FOLD with 0 allowance, and the other half appears as a dashed outline. The simulation uses the whole piece, and you can sew to the dashed half's edges. Click <span class="guide-ui">Fold</span> again with the piece selected to remove the fold.</p>
<div class="guide-warn">The fold edge cannot be curved, split or sewn, and must stay on the axis line. A seam already on that edge is removed when you set the fold.</div>
<h3>Fit (<kbd>F</kbd>)</h3>
<p>Zooms and pans the 2D view so every piece is visible. <kbd>0</kbd> does the same, and <kbd>+</kbd> and <kbd>-</kbd> zoom in and out.</p>
`,
  },
  {
    id: "seams",
    title: "Sewing seams",
    keywords: ["seam", "sew", "seam tool", "edge A", "edge B", "ease", "flip seam", "reverse", "direction", "seam list", "delete seam", "mirrored edge", "fold seam", "S key", "twisted seam"],
    html: `
<p>A seam tells the simulation which two edges to sew together. Each edge can belong to only one seam.</p>
<h3>Create a seam</h3>
<ol>
<li>Click <span class="guide-ui">Seam</span> or press <kbd>S</kbd>.</li>
<li>Click the first edge (A). It lights up white and the status bar asks for edge B.</li>
<li>Move over the second edge (B). The status bar shows both lengths and the ease as you go, for example <code>A 312 mm / B 328 mm - ease 5.1%</code>.</li>
<li>Click edge B. Both edges are drawn with a thick line in the seam's own colour.</li>
</ol>
<p>The edges can be on different pieces or on the same piece, like a sleeve's two underarm edges. On a folded piece you can also pick edges of the dashed mirrored half, to sew the other side of the body. Press <kbd>Esc</kbd> after the first click to start over.</p>
<p>The cursor shows a “not allowed” sign over edges that cannot be sewn: the fold edge and any edge that is already in a seam.</p>
<h3>Direction and Flip</h3>
<p>A dot in the seam's colour sits at one end of each edge; the two dots mark the ends that are joined. The app pairs each end with the nearer end of the other edge on your layout, so it helps to lay pieces out the way they meet. If the dots sit on ends that should not meet, click <span class="guide-ui">Flip</span>; otherwise the seam is sewn crosswise and twists in 3D.</p>
<h3>Ease</h3>
<p>Ease is how much longer the longer edge is, as a percentage of the shorter one. Up to 8% passes without comment. Above 8% the seam is drawn red, its row in the list turns yellow and a warning appears under Issues; above 50% it is an error, which usually means the wrong edge was picked.</p>
<h3>The Seams list</h3>
<p>The Seams section of the <a data-guide="pieces-panel">Pieces tab</a> lists every seam, for example <code>Front e2 ↔ Sleeve e3 · 312 / 328 mm · ease 5.1%</code>. The number after <em>e</em> is the edge number; click an edge to see its number in the Edge box. An apostrophe (<code>e1'</code>) means the mirrored half of a folded piece. Click a row to select that seam. Each row has its own <span class="guide-ui">Flip</span> and <span class="guide-ui">Delete</span> buttons, and the selected seam's ease is repeated under the list beside another pair.</p>
<h3>Select and delete</h3>
<p>Click a sewn edge with Seam or Select to select its seam (a thin white line runs along it), then press <kbd>Delete</kbd>. Deleting a piece deletes its seams. Splitting a sewn edge removes that seam with a note in the status bar, and setting a fold on an edge removes any seam on it.</p>
`,
  },
  {
    id: "pieces-panel",
    title: "The Pieces tab",
    keywords: ["pieces tab", "piece list", "duplicate", "delete piece", "name", "cut qty", "layer", "mesh spacing", "seam allowance", "fabric", "simulate", "hide in export", "placement", "anchor", "side", "offset", "wrap", "flip", "grading", "width ref", "length ref", "edge label", "allowance", "pin to body", "issues", "F1"],
    html: `
<p>The <span class="guide-ui">Pieces</span> tab (<kbd>F1</kbd>) holds each piece's settings. Select a single piece to edit them; the boxes are greyed out until you do.</p>
<h3>Piece list</h3>
<p>Each row shows the name, cut quantity (×2), FOLD for folded pieces and a ⚠ count if the piece has issues. Click a row to select the piece (<kbd>Shift</kbd>+click adds it), or double-click to jump to its <span class="guide-ui">Name</span>. <span class="guide-ui">Duplicate</span> copies the selected pieces to the right of the originals, without their seams. <span class="guide-ui">Delete</span> removes them and their seams.</p>
<h3>Piece</h3>
<table>
<thead><tr><th>Field</th><th>What it does</th></tr></thead>
<tbody>
<tr><td><span class="guide-ui">Cut qty</span></td><td>1–8. Printed on the pattern sheet (CUT 2). It does not add copies in 3D.</td></tr>
<tr><td><span class="guide-ui">Layer</span></td><td>0–4. Higher layers sit further out, for garments worn over others.</td></tr>
<tr><td><span class="guide-ui">Mesh spacing (mm)</span></td><td>8–40. Triangle size in 3D: smaller drapes in finer detail but runs slower.</td></tr>
<tr><td><span class="guide-ui">Seam allowance (mm)</span></td><td>Added outside the outline, shown dashed. The outline itself is the stitching line.</td></tr>
<tr><td><span class="guide-ui">Fabric</span></td><td>Which fabric from the <a data-guide="fabric">Fabric tab</a> the piece uses.</td></tr>
<tr><td><span class="guide-ui">Simulate</span></td><td>Untick for export-only pieces such as facings; they are left out of 3D.</td></tr>
<tr><td><span class="guide-ui">Hide in export</span></td><td>Leaves the piece off the SVG and Print sheets, such as a mirrored copy already counted in Cut qty.</td></tr>
</tbody>
</table>
<h3>Placement</h3>
<p>Where the piece starts on the body:</p>
<ul>
<li><span class="guide-ui">Anchor</span>: the body part it wraps around (torso, armL, armR, legL, legR, skirt, head; L and R are the model's left and right). The top of the piece starts at the top end of the anchor.</li>
<li><span class="guide-ui">Side</span>: which way it faces: front, back, left or right.</li>
<li><span class="guide-ui">Offset dx (mm)</span> slides it sideways around the body; <span class="guide-ui">Offset dy (mm)</span> moves it up (positive) or down.</li>
<li><span class="guide-ui">Wrap</span>: 0 places it flat, 1 curves it fully around the body.</li>
<li><span class="guide-ui">Flip</span>: mirrors it left to right, for the second piece of a pair.</li>
</ul>
<p>Changing these re-places the garment in 3D. With one piece selected, the 3D view outlines the anchors and shows that piece's anchor in yellow.</p>
<h3>Grading</h3>
<p><span class="guide-ui">Width ref</span> and <span class="guide-ui">Length ref</span> pick the size chart measurement that scales the piece's width and length between sizes; <em>(none)</em> keeps that direction fixed. <span class="guide-ui">Anchor X</span> and <span class="guide-ui">Anchor Y</span> pick the point that stays put. See <a data-guide="sizes-grading">Sizes and grading</a>.</p>
<h3>Edge</h3>
<p>Click an edge to fill this box; its heading shows the edge number, piece and length. <span class="guide-ui">Label</span> names the edge; it is shown along the edge while the piece is selected. <span class="guide-ui">Allowance (mm)</span> overrides the piece's allowance for this edge; leave it empty for the piece default. <span class="guide-ui">Pin to body</span> holds the edge fixed on the body, like a skirt waistband.</p>
<h3>Issues</h3>
<p>Problems in the pattern: ⛔ for errors, ⚠ for warnings. Click one that names a piece to select it. Pieces with errors also get a red outline.</p>
`,
  },
  {
    id: "body",
    title: "The Body tab",
    keywords: ["body", "mannequin", "measurements", "preset", "height", "weight", "bust", "chest", "waist", "hips", "BMI", "estimate", "fit body to active size", "closest size", "A-pose", "leg spread", "MakeHuman", "avatar", "figure"],
    html: `
<p>The <span class="guide-ui">Body</span> tab (<kbd>F2</kbd>) sets the figure your garment drapes on: a scanned human template (MakeHuman, CC0) reshaped to your measurements. If the template can't load, a simpler mannequin is used instead, and a note under the sliders says so.</p>
<h4>Presets</h4>
<p><span class="guide-ui">Preset</span> offers Female S, M and L, Male S, M and L, Child (10 y), Female plus and Male athletic. A preset replaces every value; once you change a value yourself, the list shows <span class="guide-ui">Custom</span>.</p>
<h4>The rows</h4>
<p>Each row has a slider and a number box.</p>
<table><thead><tr><th>Rows</th><th>Notes</th></tr></thead><tbody>
<tr><td><span class="guide-ui">Height (cm)</span>, <span class="guide-ui">Weight (kg)</span></td><td>Overall size; together they give the BMI.</td></tr>
<tr><td><span class="guide-ui">Build / exercise</span>, <span class="guide-ui">Age (years)</span>, <span class="guide-ui">Sex (male → female)</span></td><td>Body type. Build and Sex run from 0 to 1; Sex 0 is male, 1 is female, values between blend the two.</td></tr>
<tr><td>Chest / bust, Underbust, Waist, Hips, Neck, Upper arm, Forearm, Wrist, Thigh, Calf, Ankle</td><td>Girths, in cm.</td></tr>
<tr><td>Shoulder width, Arm length, Inseam, Back length, Head height</td><td>Widths and lengths, in cm.</td></tr>
<tr><td><span class="guide-ui">Bust fullness</span></td><td>0 to 1. Used by Estimate: higher means a smaller waist and fuller hips.</td></tr>
<tr><td><span class="guide-ui">Arm angle (A-pose) (°)</span>, <span class="guide-ui">Leg spread (°)</span></td><td>Pose, in degrees. Disabled on the scanned body, which keeps its own A-pose (hover for the note); they only shape the fallback mannequin.</td></tr>
</tbody></table>
<h4>Dragging and typing</h4>
<p>While you drag, the 3D body follows with a quick, rougher preview. When you let go, a full-quality body is built and the status bar shows <em>Body built in … ms</em>. A number box applies when you press <kbd>Enter</kbd> or leave it.</p>
<h4>Readouts</h4>
<p>Below the rows: the BMI with a word for the build (lean, average, full or heavy; at the same weight, more Build / exercise reads leaner), then chest, waist and hips as <em>typed → measured</em>, e.g. <code>waist 70.0 → 70.3 cm</code>. Some combinations are beyond what the body can reach, so the measured value shows what was actually built. A line more than 1.5 cm off turns yellow.</p>
<p><strong>closest size</strong> names the size chart row nearest this body (Δ is the total difference in cm). <strong>build … ms</strong> is how long the last body build took.</p>
<h4>Buttons</h4>
<ul>
<li><span class="guide-ui">Estimate from height &amp; weight</span> overwrites every girth plus Shoulder width, Arm length, Inseam, Back length and Head height with values worked out from Height, Weight, Build / exercise and Bust fullness (and Age, for Head height). Set those first, estimate, then correct the girths you actually measured.</li>
<li><span class="guide-ui">Fit body to active size</span> copies the active size's row of the size chart (in the samples: chest, waist, hips, height, back length, arm length, shoulder width) into the body. <span class="guide-ui">Size from body</span> on the <a data-guide="sizes-grading">Sizes tab</a> does the reverse.</li>
</ul>
<div class="guide-warn">Body changes don't restart a drape: click <span class="guide-ui">Drape</span> for a fresh fit (see <a data-guide="simulation">Simulation</a>). If the active size is too small for this body, a banner warns you (see <a data-guide="fit-warnings">Fit warnings</a>).</div>
`,
  },
  {
    id: "fabric",
    title: "The Fabric tab",
    keywords: ["fabric", "material", "cotton", "denim", "silk", "jersey", "wool", "leather", "chiffon", "colour", "color", "texture", "print", "stripes", "gingham", "bend scale", "stretch scale", "stiffness", "physics", "drape"],
    html: `
<p>The <span class="guide-ui">Fabric</span> tab (<kbd>F3</kbd>) sets what the garment is made of: how it looks in 3D and how it hangs.</p>
<h4>What you are editing</h4>
<p><span class="guide-ui">Piece</span> picks a pattern piece; it also follows the piece you select in the pattern. <strong>Fabric instance</strong> shows the fabric that piece uses, e.g. <code>main — Main (cotton)</code>. The controls above the Simulation heading change that fabric, so all pieces sharing it change together; in the built-in samples every piece shares one fabric. A piece's fabric is chosen with its <span class="guide-ui">Fabric</span> field on the <a data-guide="pieces-panel">Pieces tab</a>.</p>
<h4>Presets</h4>
<p><span class="guide-ui">Preset</span> sets how the fabric behaves plus its surface finish (sheen, gloss, transparency). Your colour and print are kept.</p>
<ul>
<li><strong>Cotton poplin</strong> – light, crisp everyday woven; the default for a new project.</li>
<li><strong>Denim 12 oz</strong> – heavy and stiff.</li>
<li><strong>Silk charmeuse</strong> – very light, fluid and slippery, with a satin sheen.</li>
<li><strong>Cotton jersey</strong> – a soft knit that stretches far more easily than the wovens.</li>
<li><strong>Wool suiting</strong> – medium weight, soft and matte.</li>
<li><strong>Leather</strong> – the heaviest and stiffest; grips the body, slight gloss.</li>
<li><strong>Silk chiffon</strong> – the lightest and floatiest; shown semi-transparent.</li>
</ul>
<div class="guide-tip">A fabric's name is only a label and doesn't follow the preset: "Main (cotton)" can be set to silk. The <span class="guide-ui">Preset</span> list shows what it really is.</div>
<h4>Colour and print</h4>
<p><span class="guide-ui">Colour</span> is the main colour. <span class="guide-ui">Texture</span> adds a print: solid, stripes, gingham, dots, twill or knit. <span class="guide-ui">Colour 2</span> is the print's second colour (no effect on solid). <span class="guide-ui">Texture scale (mm)</span> is the size of one repeat of the print, from 2 to 100 mm. These change only the look, never the drape.</p>
<h4>Simulation sliders</h4>
<p>These apply to <em>every</em> fabric in the project, on top of the presets, and act on a running drape straight away. Each runs from ×0.10 to ×10.00, with ×1.00 in the middle.</p>
<ul>
<li><span class="guide-ui">Bend scale</span> multiplies bending stiffness: higher is stiffer, with broader folds; lower is limper.</li>
<li><span class="guide-ui">Stretch scale</span> multiplies resistance to stretching: lower lets the fabric stretch more.</li>
</ul>
<h4>The physics table</h4>
<p>This read-only table shows the chosen fabric's preset values, before the two sliders above.</p>
<table><thead><tr><th>Row</th><th>Meaning</th></tr></thead><tbody>
<tr><td><code>density_kgm2</code></td><td>Weight in kg per m² (0.15 = 150 g/m²).</td></tr>
<tr><td><code>bend_Nm</code></td><td>Bending stiffness.</td></tr>
<tr><td><code>membrane_Nm</code></td><td>Stretch stiffness; low means stretchy.</td></tr>
<tr><td><code>friction</code></td><td>How much it grips the body, 0 to 1.</td></tr>
<tr><td><code>damping</code></td><td>How quickly movement dies down.</td></tr>
<tr><td><code>thickness_mm</code></td><td>Fabric thickness; it also affects how far the cloth stays off the body and off itself.</td></tr>
<tr><td><code>meshSpacing_mm</code></td><td>The preset's suggested triangle size. The simulation uses each piece's own <span class="guide-ui">Mesh spacing (mm)</span> instead.</td></tr>
</tbody></table>
<p>The table rounds to four decimal places, so very small values, such as silk's bending stiffness, show as 0.</p>
`,
  },
  {
    id: "simulation",
    title: "Simulation",
    keywords: ["simulation", "drape", "play", "pause", "reset", "arrange", "self-collision", "frame", "sewing", "sew", "physics", "cloth", "fps", "status bar", "slow", "markers", "3D"],
    html: `
<p>The simulation sews your pieces together around the body and lets the garment settle under its own weight. Loading a sample or opening a project starts a drape automatically.</p>
<table><thead><tr><th>Control</th><th>What it does</th></tr></thead><tbody>
<tr><td><span class="guide-ui">Drape</span> (<kbd>D</kbd>)</td><td>Places the pieces around the body, restarts the sewing and plays. Use it for a fresh fit.</td></tr>
<tr><td><span class="guide-ui">▶ Play</span> / <span class="guide-ui">❚❚ Pause</span> (<kbd>Space</kbd>)</td><td>Pauses and resumes. If the pieces are still at their starting position, Play works like Drape.</td></tr>
<tr><td><span class="guide-ui">Arrange</span></td><td>Recalculates each piece's starting position from the current body and the piece's Placement settings.</td></tr>
<tr><td><span class="guide-ui">Reset</span> (<kbd>R</kbd>)</td><td>Returns the cloth to its last starting position without recalculating it.</td></tr>
<tr><td><span class="guide-ui">Self-collision</span></td><td>Keeps the garment from passing through itself. Unticked, each frame is cheaper.</td></tr>
<tr><td><span class="guide-ui">Frame</span> (<kbd>Shift</kbd>+<kbd>F</kbd>)</td><td>Fits the body in the 3D view.</td></tr>
</tbody></table>
<p>After Arrange or Reset, a running simulation starts sewing again; a paused one waits.</p>
<h4>What a drape goes through</h4>
<ol>
<li><strong>Arranged</strong> – pieces placed around the body, seams open.</li>
<li><strong>Sewing</strong> – about the first 90 frames. The seams pull shut during the first second while the fabric's weight is brought in only gradually; then, briefly, the fabric is made almost weightless and slippery so it can slide into place.</li>
<li><strong>Draping</strong> – gravity and friction return to full strength by about frame 180, and the garment settles.</li>
</ol>
<p>Each displayed frame is one fixed step, so at a steady 60 fps sewing takes about 1.5 seconds and full weight arrives after about 3; a slower computer takes longer. The simulation keeps running until you pause it. After sewing, red or orange markers show over-stretched fabric or seams that couldn't close (see <a data-guide="fit-warnings">Fit warnings</a>).</p>
<h4>Status bar readout</h4>
<p>At the right of the status bar, e.g. <code>58 fps · 11.2 ms · 3713 v · f 540</code>: frames per second, average time to compute one frame, number of cloth points, and frames since the drape started. <em>· paused</em> is added while paused.</p>
<h4>Editing while it runs</h4>
<ul>
<li>Changes to piece outlines, seams, Mesh spacing, Placement or the active size re-drape the garment from the start a moment later.</li>
<li>Fabric settings, Bend scale, Stretch scale and Self-collision apply to the moving cloth without a restart.</li>
<li>Body changes don't restart anything: the garment settles onto the new body from where it is.</li>
</ul>
<p>If you paused, a rebuilt garment waits at its starting position until you press Play or Drape.</p>
<h4>Tips</h4>
<ul>
<li>Fix any fit warning first: a size too small for the body over-stretches or leaves seams open.</li>
<li>After a big body change, press Drape, not Reset.</li>
<li>If frames are slow, raise Mesh spacing (mm) on the <a data-guide="pieces-panel">Pieces tab</a>. Above 8000 points in total the app coarsens the mesh itself and says so.</li>
<li>If the status bar says the simulation paused after repeated instability, press Reset or Drape.</li>
</ul>
`,
  },
  {
    id: "sizes-grading",
    title: "Sizes and grading",
    keywords: ["size chart", "sizes tab", "grading", "grade", "base size", "active size", "add size", "remove size", "size from body", "width ref", "length ref", "anchor", "shoulder width", "ease drift", "size issues", "XS", "F4"],
    html: `
<p>You draw each piece once, at the <strong>base size</strong>, and the app scales it for every other size in the chart. Open the <span class="guide-ui">Sizes</span> tab (<kbd>F4</kbd>) to edit the chart.</p>
<h3>The size chart</h3>
<p>Each row is a size and each column a measurement in cm. Click a cell, type a value and press <kbd>Enter</kbd>. Edit a size's name to rename it; names must be unique. The base size's name is in bold.</p>
<ul>
<li><span class="guide-ui">Add size</span> adds a row at the bottom, stepped up from the last one: +4 cm chest, waist and hips, +5 cm height, +1 cm torsoLength and armLength. Other columns are copied.</li>
<li><span class="guide-ui">Remove size</span> deletes the highlighted row (click a row to highlight it). The base size and the last remaining size can't be removed.</li>
<li><span class="guide-ui">Base</span> sets which size your drawn pieces represent.</li>
<li><span class="guide-ui">Size from body</span> adds or updates a row named <em>Body</em> with the current <a data-guide="body">Body tab</a> measurements.</li>
</ul>
<div class="guide-warn">A new size takes the first unused name from XS, S, M, L, XL, XXL, 3XL. On the usual S–XL chart that is <em>XS</em>, even though its values are bigger than XL, so rename it.</div>
<h3>The active size</h3>
<p>The toolbar <span class="guide-ui">Size</span> menu picks the active size. The 3D garment is rebuilt at that size and drapes again (unless paused), the <a data-guide="fit-warnings">fit check</a> tests it, and SVG and Print export it. Chart edits rebuild the 3D garment too. The 2D editor shows the pieces as drawn, at the base size, with a dashed green outline of the active size on top (there is none at the base size itself).</p>
<h3>How a piece grades</h3>
<p>In the <span class="guide-ui">Pieces</span> tab, each piece's <span class="guide-ui">Grading</span> box has:</p>
<ul>
<li><span class="guide-ui">Width ref</span> and <span class="guide-ui">Length ref</span>: the columns that scale the piece. With Width ref <em>chest_cm</em>, a size whose chest is 5 % bigger than the base gets a piece 5 % wider. <em>(none)</em> leaves that direction alone.</li>
<li><span class="guide-ui">Anchor X</span> and <span class="guide-ui">Anchor Y</span>: the point that stays put while the piece grows. <em>fold</em> keeps the fold line in place, <em>top</em> the top edge.</li>
</ul>
<p>Curves, notches, grainline and internal lines follow the outline; seam allowances keep their width. In the built-in T-shirt the front and back shoulder tips follow the shoulderWidth column instead of chest, so the shoulders widen with that column (about 1 cm a size in the sample chart) rather than in proportion to the chest, which grows 4 cm a size. These point rules are saved with the project but can't be edited in the panels.</p>
<h3>Size issues</h3>
<p>The list under the table flags seams that stop matching. Seam ease is how much longer one side is than the other; when it shifts more than 3 percentage points from the base size you'll see a line like <em>L: Seam … ease 2.0% (M) -&gt; 6.1% (L)</em>. Usually grading moved one side only, e.g. a shoulder point that reshapes the armhole but not the sleeve cap. It updates while this tab is open.</p>
`,
  },
  {
    id: "fit-warnings",
    title: "Fit warnings",
    keywords: ["fit", "fit banner", "warning", "too small", "tight", "snug", "ease", "tear", "tearing", "tear markers", "red rings", "stretch", "strain", "open seam", "use size", "dismiss", "shoulder narrow"],
    html: `
<p>Before anything is simulated, the app checks whether the active size can go round the body. If it can't, a banner appears at the top-left of the work area.</p>
<h3>What ease means</h3>
<p><strong>Ease</strong> is how much bigger the garment is around than the body. The app adds up the widths of the pieces placed on the torso (a piece cut on the fold counts twice) and subtracts the body's largest torso measurement: chest, waist or hips, whichever is biggest, because the garment has to pass over it.</p>
<div class="guide-tip">Only pieces with <span class="guide-ui">Simulate</span> ticked and Placement <span class="guide-ui">Anchor</span> set to <em>torso</em> count. New pieces start on the torso, so move sleeves to <em>armL</em> or <em>armR</em> for an honest reading.</div>
<h3>The three levels</h3>
<ul>
<li><strong>No banner</strong>: 4 cm of ease or more, shoulders wide enough, every seam still matching.</li>
<li><strong>Amber</strong>: under 4 cm of ease (expect visible tension), a pattern shoulder more than 1.5 cm narrower than the body's <span class="guide-ui">Shoulder width</span>, or seams that no longer match at this size (see <a data-guide="sizes-grading">Sizes and grading</a>).</li>
<li><strong>Red</strong>: the garment is smaller than the body. The banner says by how many cm and warns that the seams will tear.</li>
</ul>
<p>The shoulder check uses edges labelled <em>shoulder</em> in the edge <span class="guide-ui">Label</span> field; patterns without one, like a skirt, skip it.</p>
<h3>Taking the suggestion or dismissing</h3>
<p>If other sizes have at least 4 cm of ease, the banner offers the snuggest of them, e.g. <span class="guide-ui">Use L</span>. Clicking it makes that the active size and the garment drapes again (unless paused). The suggestion looks at girth only, so read the banner again afterwards. If nothing is big enough, the red banner ends with <em>No size in the chart is large enough</em>.</p>
<p>Click <span class="guide-ui">×</span> to hide the banner. It stays hidden only while its message is unchanged; another size or body brings a fresh warning.</p>
<h3>Tear markers in 3D</h3>
<p>While the cloth simulates, rings mark where the garment is failing:</p>
<ul>
<li><strong>Over-stretched fabric</strong>: stretched 30 % or more beyond its cut length.</li>
<li><strong>Open seam</strong>: the two sides are still 3 mm or more apart.</li>
</ul>
<p>The colour shows how bad it is, not which kind: amber is just past the limit, full red is 60 % stretch or a 12 mm gap. Rings are drawn on top of the body, so failures on the far side show through, and nearby problems merge into one ring. They appear only once sewing has finished, clear when you press <span class="guide-ui">Reset</span> or <span class="guide-ui">Drape</span>, and show in the main window only, not in the pop-out.</p>
`,
  },
  {
    id: "exporting",
    title: "Exporting",
    keywords: ["export", "svg", "print", "pdf", "tiles", "tiled", "paper", "A4", "Letter", "A3", "100 mm square", "scale", "csv", "json", "obj", "size chart", "download", "notches", "grainline", "seam allowance", "label"],
    html: `
<p>The export buttons sit near the right end of the toolbar. <span class="guide-ui">SVG</span> and <span class="guide-ui">Print</span> use the active size from the toolbar <span class="guide-ui">Size</span> menu, so choose it first.</p>
<h3>SVG pattern sheet</h3>
<p><span class="guide-ui">SVG</span> downloads one sheet at true size in millimetres, with every piece graded to the active size and packed side by side, unrotated. The sheet is at least 1 m wide. At the top are a 100 mm check square and a title block with the project name, size, piece count and sheet size. Each piece has:</p>
<ul>
<li>a solid <strong>cut line</strong> (seam allowance included) and a dashed <strong>stitching line</strong>;</li>
<li>on fold pieces, a dash-dot fold line marked <em>PLACE ON FOLD</em>;</li>
<li><strong>notches</strong> as ticks across the allowance (two for a double notch);</li>
<li>the <strong>grainline</strong> with arrows at both ends, and any internal lines;</li>
<li>a label: piece name, project, size, cut quantity (<em>ON FOLD</em> if folded), fabric, seam allowances such as <em>SA 10 mm; hem 25; neck 6</em>, and the date.</li>
</ul>
<p>Pieces with <span class="guide-ui">Hide in export</span> ticked are left out.</p>
<h3>Print tiled pages</h3>
<p>Choose <em>A4</em>, <em>Letter</em> or <em>A3</em> in the paper menu next to the export buttons (it only affects Print), then click <span class="guide-ui">Print</span>. The sheet opens in a new tab as portrait pages, and the status bar says how many. Press <kbd>Ctrl</kbd>+<kbd>P</kbd> there to print or save a PDF.</p>
<ol>
<li>Set the scale to 100 % (actual size), never "fit to page".</li>
<li>Print one page and measure the grey 100 mm square in its bottom-left corner before printing the rest.</li>
<li>Pages are named like a map: rows A, B, C… and columns 1, 2, 3…, so A2 is right of A1 and B1 is below it. Labels at each edge name the neighbour.</li>
<li>Trim each page's right and bottom edges at the corner crop marks, lay it over the shaded strip of the next page so the trimmed edge sits on the dashed line, and tape.</li>
</ol>
<div class="guide-tip">If the browser blocks the new tab, the pages download as an HTML file instead. Open it in your browser and print from there.</div>
<h3>Size chart and 3D garment</h3>
<ul>
<li><span class="guide-ui">CSV</span>: the size chart for a spreadsheet, one row per size, values in cm.</li>
<li><span class="guide-ui">JSON</span>: the same chart as data, including the base size. It isn't your project; use <span class="guide-ui">Save</span> for that (see <a data-guide="projects-files">saving projects</a>).</li>
<li><span class="guide-ui">OBJ</span>: the simulated garment exactly as it is in 3D now, one object per piece, in metres, without the body. With no cloth you'll see <em>Nothing to export: no simulated cloth</em>.</li>
</ul>
`,
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    keywords: ["keys", "keyboard", "hotkeys", "shortcut"],
    html: `
<p>Shortcuts work whenever the keyboard focus is not in a text or number field. Inside a field only
<kbd>Esc</kbd> is handled: it leaves the field. On a focused button, <kbd>Space</kbd> and <kbd>Enter</kbd>
press the button instead.</p>
<div class="guide-shortcuts"></div>
<div class="guide-tip">This table is built from the app's own shortcut list, so it is always current.</div>
`,
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    keywords: ["problem", "help", "not working", "tears", "seam won't create", "cannot be sewn", "wrong place", "placement", "explodes", "unstable", "frozen", "paused", "slow", "pop-out blocked", "popup", "blank 3D", "WebGL", "print scale", "wrong size", "body measurements", "clamped", "reset"],
    html: `
<h4>The garment tears or won't close</h4>
<p>The size is usually too small for the body. Read the <a data-guide="fit-warnings">fit banner</a>: click its <span class="guide-ui">Use …</span> button or pick a larger size in the toolbar <span class="guide-ui">Size</span> menu. Also check the <span class="guide-ui">Sizes</span> tab's issues list for seams that stop matching at that size.</p>
<h4>A seam won't create</h4>
<p><em>That edge cannot be sewn</em> or <em>That edge is already sewn or is the fold edge</em> means you picked a fold edge, which can't be sewn, or an edge that already has a seam. To re-pair an edge, select its seam under <span class="guide-ui">Seams</span> and click <span class="guide-ui">Delete</span> first. See <a data-guide="seams">Seams</a>.</p>
<h4>A piece lands in the wrong place</h4>
<p>Check <span class="guide-ui">Placement</span> in the Pieces tab. New pieces start on the torso front, so a back panel needs <span class="guide-ui">Side</span> <em>back</em> and a sleeve needs <em>armL</em> or <em>armR</em> as its <span class="guide-ui">Anchor</span>. Changes re-arrange at once; <span class="guide-ui">Arrange</span> does it again on demand.</p>
<h4>The drape explodes or stops</h4>
<p>After repeated instability the simulation pauses and asks you to <em>press Reset or Drape</em>. <span class="guide-ui">Reset</span> (<kbd>R</kbd>) returns the cloth to its arranged start; <span class="guide-ui">Drape</span> (<kbd>D</kbd>) arranges, sews and plays again. If the status bar ends in <em>paused</em>, press <kbd>Space</kbd>. A piece with <span class="guide-ui">Simulate</span> unticked, or with an error in the Issues list, is left out when the garment is rebuilt.</p>
<h4>It runs slowly</h4>
<p>On <em>Simulation slow … raise mesh spacing</em>, increase <span class="guide-ui">Mesh spacing (mm)</span> on the large pieces, or untick <span class="guide-ui">Self-collision</span> (layers may then pass through each other).</p>
<h4>The pop-out is blocked</h4>
<p>Allow pop-ups for this site in your browser, then click <span class="guide-ui">Pop-out 3D</span> again.</p>
<h4>The 3D view is blank</h4>
<p>If it says the view is open in a separate window, click <span class="guide-ui">Bring back</span> or close that window. If the 3D pane stays empty, the 3D engine could not start: it loads from the internet and needs WebGL, so check your connection or try another browser. 2D editing still works.</p>
<h4>The print is the wrong size</h4>
<p>Print at 100 % (actual size), not "fit to page", and measure the 100 mm square. Make sure the paper menu matches the paper in your printer.</p>
<h4>The body doesn't match my numbers</h4>
<p>Each value is held within its slider's range, and some combinations are beyond what the scanned body can reach. Compare the readout under the sliders, e.g. <em>chest 96.0 → 93.2 cm</em>; lines more than 1.5 cm off are highlighted. <span class="guide-ui">Arm angle (A-pose) (°)</span> and <span class="guide-ui">Leg spread (°)</span> only shape the fallback mannequin. See <a data-guide="body">Body</a>.</p>
`,
  },
]);
