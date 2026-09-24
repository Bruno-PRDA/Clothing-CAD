// src/dxf/index.js — public API of the DXF module: pattern exchange with other apparel CAD (DXF-AAMA / ASTM D6673).
// Pure; no DOM. The app wiring turns the text into a download and imported drafts into document pieces.

export { parseDxf, placeBlock, unbulge, createWriter, fnum } from './dxfio.js';
export { fitCubics, ringToEdges, guessTurns } from './fitcurve.js';
export { LAYER, NOTCH_SHAPE_LAYERS, TEXT_KEY, FIT_TOL_MM, FLATTEN_TOL_MM, layerNo, exportAama, importAama } from './aama.js';
export { runSelfTest } from './selftest.js';
