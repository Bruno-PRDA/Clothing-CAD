// src/pattern/index.js — public surface of the 2D pattern editor (SPEC 11.9–11.12).
// Imports only src/core/* and src/geometry/index.js. Owns the DOM inside #pane-2d (#canvas-2d).

/** @typedef {import('../core/types.js').Vec2} Vec2 */
/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').Seam} Seam */
/** @typedef {import('../core/types.js').SeamSide} SeamSide */
/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */
/** @typedef {import('../core/types.js').Issue} Issue */
/** @typedef {import('../core/events.js').ToolName} ToolName */

export {
  createEditor, opTranslate, opSplitEdge, opInsertVertex, opDeleteVertex, opReflectX, opSetFold, opClearFold,
  makeCcw, snapPoint, clonePieceLocal, EDITOR_TOOLS, DRAG_THRESHOLD_PX, SNAP_VERTEX_PX,
} from './editor.js';

export { createView, docBbox, MIN_PX_PER_MM, MAX_PX_PER_MM, FIT_MARGIN_PX } from './view.js';

export { hitTest, flattenCache, notchPoint, edgeOfSegment, HIT_TOL_PX, FLATTEN_TOL_MM } from './hit.js';

export { render, STYLE, hueOf, seamColor } from './render2d.js';

export { validateDoc, validatePiece, validateSeam, formatIssue, ISSUE_CODES } from './validate.js';

export {
  edgeLengthOf, sideEndpoints, chooseReverse, autoReverse, seamEase, seamEaseOf, seamLengths, formatEase,
  formatSeamRow, seamOfEdge, seamsOfPiece, makeSeam, remapAfterEdgeChange, seamEaseGraded, easeLevel,
  pieceById, EASE_WARN_PCT, EASE_ERROR_PCT,
} from './seams.js';

/** @type {ReadonlyArray<ToolName>} */
export const TOOL_NAMES = Object.freeze(['select', 'draw', 'edit', 'split', 'seam', 'notch', 'grainline', 'measure']);

/** Status-bar hint per tool (SPEC 11.12.1). @type {Readonly<Record<string, string>>} */
export const TOOL_HINTS = Object.freeze({
  select: 'Select: click / drag pieces · Shift adds · drag on empty = box',
  draw: 'Draw: click to add points · click the first point or Enter to close · Esc cancels · Shift = 45°',
  edit: 'Edit: drag points/handles · double-click edge = line/curve · Alt-click edge inserts · Delete removes',
  split: 'Split: click an edge to split it at the cursor',
  seam: 'Seam: click edge A (click an existing seam to select it)',
  notch: 'Notch: click an edge · Shift = double notch · drag to move · Delete removes',
  grainline: 'Grainline: drag inside a piece (arrow points a → b) · Shift = 45° · drag an end to adjust',
  measure: 'Measure: drag to measure · click an edge for its length',
});

export { runSelfTest } from './selftest.js';
