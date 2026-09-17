// src/sizing/fit.js — will the active size actually go round this body? (SPEC 10.4)
//
// The solver has no way to say "this garment is too small". Asked to sew a seam whose two sides cannot
// reach each other, XPBD does the only thing it can: it stretches the fabric until they meet, and where
// it cannot, the seam stays open. On a body several centimetres bigger than the draft that shows up as
// 200 % strain across the front armhole and a torn shoulder seam — which reads as a physics bug rather
// than as "you picked the wrong size".
//
// So we check it up front, geometrically, before a single frame is simulated. Two independent ways a
// garment runs out of cloth:
//
//   GIRTH     the torso panels together are narrower than the body they have to wrap. Measured as the
//             summed width of the graded pieces anchored to the torso, against the body's largest torso
//             girth, because the garment has to pass over the widest part to be worn at all.
//   SHOULDER  the shoulder seam is shorter than the body's shoulder. This one does NOT go away by
//             choosing a bigger size unless the chart grades shoulder width, which is why it is
//             reported separately (see chart.js DEFAULT_MEASUREMENTS).
//
// Pure: geometry and arithmetic only, no DOM and no simulation.

import { gradeDoc, seamEaseDrift } from './grading.js';
import { closestSize } from './chart.js';

/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */
/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').BodyParams} BodyParams */

/**
 * Ease thresholds in cm of garment circumference minus body girth.
 * Below `tight` the fabric must stretch just to close, which is where seams start to open; between
 * `tight` and `snug` it closes but the drape is under visible tension. These are not style choices —
 * a negative number is a physical impossibility for an inextensible woven, and the measured failures
 * (14 mm of open seam at -6.5 cm, 2.6 mm at -1.4 cm, nothing at +8.8 cm) sit either side of zero.
 */
export const EASE_LIMITS = Object.freeze({ tight: 0, snug: 4 });

/** Shoulder span shortfall in cm before it is called out; below this the cap seam copes. */
export const SHOULDER_LIMIT = 1.5;

/**
 * Width of a piece's outline along x, in mm. For a piece cut on the fold this is the HALF panel, so
 * the caller doubles it — `torsoGirth` does.
 * @param {Piece} piece @returns {number}
 */
function outlineWidth(piece) {
  let lo = Infinity, hi = -Infinity;
  for (const v of piece.vertices) {
    if (v[0] < lo) lo = v[0];
    if (v[0] > hi) hi = v[0];
  }
  // control points of cubic edges can bulge past the vertices
  for (const e of piece.edges || []) {
    for (const c of [e.c1, e.c2]) {
      if (!c) continue;
      if (c[0] < lo) lo = c[0];
      if (c[0] > hi) hi = c[0];
    }
  }
  return hi > lo ? hi - lo : 0;
}

/** Is this piece one of the ones that wraps the torso? @param {Piece} p @returns {boolean} */
function wrapsTorso(p) {
  return !!p && p.simulate !== false && !!p.placement && p.placement.anchor === 'torso';
}

/**
 * Finished circumference of the torso panels, in cm.
 * @param {Piece[]} pieces already graded @returns {number}
 */
export function torsoGirth(pieces) {
  let mm = 0;
  for (const p of pieces) {
    if (!wrapsTorso(p)) continue;
    const w = outlineWidth(p);
    // a fold piece stores half the panel; the mirrored half is the same width
    mm += (p.foldEdge !== null && p.foldEdge !== undefined) ? w * 2 : w;
  }
  return mm / 10;
}

/**
 * Shoulder span the pattern provides, in cm: twice the largest x reached by an edge labelled
 * 'shoulder', for pieces cut on the fold (the fold is the centre front/back). Returns null when the
 * pattern has no labelled shoulder, which is the honest answer for a skirt.
 * @param {Piece[]} pieces already graded @returns {number|null}
 */
export function shoulderSpan(pieces) {
  let best = null;
  for (const p of pieces) {
    if (!wrapsTorso(p)) continue;
    const onFold = p.foldEdge !== null && p.foldEdge !== undefined;
    const n = p.vertices.length;
    for (let e = 0; e < (p.edges || []).length; e++) {
      if (!p.edges[e] || p.edges[e].label !== 'shoulder') continue;
      // the edge runs from vertices[e] to vertices[e+1]; the shoulder TIP is the outer end
      const x = Math.max(Math.abs(p.vertices[e][0]), Math.abs(p.vertices[(e + 1) % n][0]));
      const span = onFold ? x * 2 : x;
      if (best === null || span > best) best = span;
    }
  }
  return best === null ? null : best / 10;
}

/**
 * @typedef {Object} FitReport
 * @property {'ok'|'snug'|'tight'} level          'tight' = cannot close without stretching
 * @property {string} size                        the size that was checked
 * @property {number} garmentGirth_cm
 * @property {number} bodyGirth_cm                the largest torso girth the garment must pass over
 * @property {string} bodyGirthKey                which measurement that was
 * @property {number} ease_cm                     garment - body; negative means it cannot close
 * @property {number|null} shoulderSpan_cm        null when the pattern has no shoulder seam
 * @property {number|null} bodyShoulder_cm
 * @property {number|null} shoulderShort_cm       body - pattern, when positive and past SHOULDER_LIMIT
 * @property {{name: string, ease_cm: number}|null} better  a size in the chart that would close
 * @property {number} seamDrift                   seams whose two sides no longer match at this size
 * @property {string} message                     one line, ready for the UI
 */

/**
 * @param {ProjectDoc} doc @param {string} sizeName @param {BodyParams} body
 * @returns {FitReport}
 */
export function checkFit(doc, sizeName, body) {
  const graded = gradeDoc(doc, sizeName);
  const garment = torsoGirth(graded);

  // The garment has to pass over the widest part of the torso it covers, not just the chest: a straight
  // tee that clears a 113 cm bust still will not go over 125 cm hips.
  let bodyGirth = 0, bodyKey = 'chest_cm';
  for (const k of ['chest_cm', 'waist_cm', 'hips_cm']) {
    const v = body && body[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > bodyGirth) { bodyGirth = v; bodyKey = k; }
  }

  // Grading can also break a garment against ITSELF: move a shoulder point and the armhole it bounds
  // changes length while the sleeve cap does not, so the cap seam arrives too long. That has nothing
  // to do with the body, but it tears in exactly the same place, so it belongs in the same warning.
  let seamDrift = 0;
  try { seamDrift = (seamEaseDrift(doc, sizeName) || []).length; } catch { seamDrift = 0; }

  const ease = garment - bodyGirth;
  const span = shoulderSpan(graded);
  const bodyShoulder = body && Number.isFinite(body.shoulderWidth_cm) ? body.shoulderWidth_cm : null;
  const shoulderShort = (span !== null && bodyShoulder !== null && bodyShoulder - span > SHOULDER_LIMIT)
    ? bodyShoulder - span : null;

  /** @type {'ok'|'snug'|'tight'} */
  let level = 'ok';
  if (ease < EASE_LIMITS.tight) level = 'tight';
  else if (ease < EASE_LIMITS.snug) level = 'snug';
  if (level === 'ok' && shoulderShort !== null) level = 'snug';
  if (level === 'ok' && seamDrift > 0) level = 'snug';

  // the smallest size in the chart that clears the body with room to spare
  /** @type {{name: string, ease_cm: number}|null} */
  let better = null;
  if (level !== 'ok') {
    for (const row of (doc.sizes && doc.sizes.rows) || []) {
      if (row.name === sizeName) continue;
      let g;
      try { g = torsoGirth(gradeDoc(doc, row.name)); } catch { continue; }
      const e = g - bodyGirth;
      if (e >= EASE_LIMITS.snug && (better === null || e < better.ease_cm)) better = { name: row.name, ease_cm: e };
    }
  }

  const round = (v) => Math.round(v * 10) / 10;
  let message;
  if (level === 'tight') {
    message = `Size ${sizeName} is ${round(-ease)} cm smaller than the body — the seams will tear.`;
  } else if (ease < EASE_LIMITS.snug) {
    message = `Size ${sizeName} has only ${round(ease)} cm of ease — expect visible tension.`;
  } else if (shoulderShort !== null) {
    message = `Size ${sizeName} fits the body but its shoulder is ${round(shoulderShort)} cm narrow.`;
  } else {
    message = `Size ${sizeName} fits: ${round(ease)} cm of ease.`;
  }
  if (level !== 'ok' && shoulderShort !== null && level === 'tight') {
    message += ` Shoulder ${round(shoulderShort)} cm narrow.`;
  }
  if (seamDrift > 0) {
    message += ` ${seamDrift} seam${seamDrift === 1 ? '' : 's'} no longer match at this size — check the Sizes panel.`;
  }
  if (better) message += ` ${better.name} would fit (${round(better.ease_cm)} cm ease).`;
  else if (level === 'tight') message += ' No size in the chart is large enough.';

  return {
    level, size: sizeName,
    garmentGirth_cm: round(garment),
    bodyGirth_cm: round(bodyGirth),
    bodyGirthKey: bodyKey,
    ease_cm: round(ease),
    shoulderSpan_cm: span === null ? null : round(span),
    bodyShoulder_cm: bodyShoulder === null ? null : round(bodyShoulder),
    shoulderShort_cm: shoulderShort === null ? null : round(shoulderShort),
    better,
    seamDrift,
    message,
  };
}

/**
 * The chart row nearest the body, with the same shape `closestSize` returns; re-exported here so the UI
 * has one import for everything fit-related.
 * @param {BodyParams} body @param {import('../core/types.js').SizeChart} chart
 */
export function closestRow(body, chart) {
  return closestSize(body, chart);
}
