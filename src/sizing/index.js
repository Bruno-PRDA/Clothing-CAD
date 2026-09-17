// src/sizing/index.js — public API of the sizing module (SPEC section 10.1–10.2, 10.7).
// Pure module: imports only src/core and src/geometry. Errors are ValidationError {name:'ValidationError', code}.

export {
  DEFAULT_MEASUREMENTS, defaultChart, cloneChart, rowByName, sizeIndex, baseIndex, sizeNames,
  addRow, removeRow, renameRow, setValue, setBaseSize, addMeasurement, removeMeasurement, moveRow,
  validateChart, closestSize, rowFromBody, rowToBodyParams,
  validationError,
} from './chart.js';

export {
  gradePieceDetailed, gradePiece, gradeDoc, gradeDocDetailed, gradeScale, seamEasePct, seamEaseDrift,
} from './grading.js';

export {
  EASE_LIMITS, SHOULDER_LIMIT, checkFit, torsoGirth, shoulderSpan, closestRow,
} from './fit.js';

export { runSelfTest } from './selftest.js';
