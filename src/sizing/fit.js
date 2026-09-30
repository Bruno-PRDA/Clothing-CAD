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
//   GIRTH     a part of the garment is narrower than the part of the body it has to wrap. Each part is
//             measured on its own, as the summed width of its graded panels: the TORSO panels against the
//             chest and waist (and the hips too when nothing below them covers the hips, because a top has
//             to pass over the widest part to be worn at all), the SKIRT panels against the waist and the
//             hips. A fitted dress is a bodice that stops at the waist plus a skirt that covers the hips;
//             comparing the bodice with the hips, or a skirt alone with the chest, would cry "tear" on a
//             garment that fits.
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

/**
 * Is this piece a simulated panel anchored at `anchor`?
 * @param {Piece} p @param {'torso'|'skirt'} anchor @returns {boolean}
 */
function anchoredAt(p, anchor) {
  return !!p && p.simulate !== false && !!p.placement && p.placement.anchor === anchor;
}

/** Is this piece one of the ones that wraps the torso? @param {Piece} p @returns {boolean} */
function wrapsTorso(p) { return anchoredAt(p, 'torso'); }

/** Is this piece one of the ones that wraps the hips, a skirt panel? @param {Piece} p @returns {boolean} */
function wrapsSkirt(p) { return anchoredAt(p, 'skirt'); }

/**
 * Summed outline width of the pieces `wraps` picks, in cm, a fold piece counted twice.
 * @param {Piece[]} pieces @param {(p: Piece) => boolean} wraps @returns {number}
 */
function panelGirth(pieces, wraps) {
  let mm = 0;
  for (const p of pieces) {
    if (!wraps(p)) continue;
    const w = outlineWidth(p);
    // a fold piece stores half the panel; the mirrored half is the same width
    mm += (p.foldEdge !== null && p.foldEdge !== undefined) ? w * 2 : w;
  }
  return mm / 10;
}

/**
 * Finished circumference of the torso panels, in cm.
 * @param {Piece[]} pieces already graded @returns {number}
 */
export function torsoGirth(pieces) {
  return panelGirth(pieces, wrapsTorso);
}

/**
 * Finished circumference of the skirt panels, in cm.
 * @param {Piece[]} pieces already graded @returns {number}
 */
export function skirtGirth(pieces) {
  return panelGirth(pieces, wrapsSkirt);
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
 * @typedef {Object} PartCheck
 * @property {'torso'|'skirt'} part
 * @property {number} garment_cm   finished girth of the part's panels
 * @property {number} body_cm      the largest body girth the part has to pass over
 * @property {string} key          which body measurement that was
 * @property {number} ease_cm      garment - body
 */

/**
 * The girth check of each part of a graded garment against the part of the body it covers. This is the one
 * place the rule lives: `checkFit` and its search for a better size both come here.
 *
 *   torso panels   against max(chest, waist), and the hips too when the garment has no skirt panels — a top
 *                  has to pass over the hips, a bodice does not because the skirt covers them
 *   skirt panels   against max(waist, hips)
 *
 * A part the garment does not have is left out, so a garment with neither (only sleeves, say) gets [].
 * @param {Piece[]} graded already graded @param {BodyParams} body @returns {PartCheck[]}
 */
function partChecks(graded, body) {
  const hasTorso = graded.some(wrapsTorso);
  const hasSkirt = graded.some(wrapsSkirt);
  /** @type {PartCheck[]} */
  const checks = [];
  /** @param {'torso'|'skirt'} part @param {number} garment @param {string[]} keys the body girths it covers */
  const add = (part, garment, keys) => {
    let body_cm = 0, key = keys[0];
    for (const k of keys) {
      const v = body && body[k];
      if (typeof v === 'number' && Number.isFinite(v) && v > body_cm) { body_cm = v; key = k; }
    }
    checks.push({ part, garment_cm: garment, body_cm, key, ease_cm: garment - body_cm });
  };
  if (hasTorso) add('torso', torsoGirth(graded), hasSkirt ? ['chest_cm', 'waist_cm'] : ['chest_cm', 'waist_cm', 'hips_cm']);
  if (hasSkirt) add('skirt', skirtGirth(graded), ['waist_cm', 'hips_cm']);
  return checks;
}

/** The part that runs out of cloth first, or null when there is nothing to check. @param {PartCheck[]} checks @returns {PartCheck|null} */
function tightestPart(checks) {
  /** @type {PartCheck|null} */
  let t = null;
  for (const c of checks) if (t === null || c.ease_cm < t.ease_cm) t = c;
  return t;
}

/**
 * @typedef {Object} FitReport
 * @property {'ok'|'snug'|'tight'} level          'tight' = cannot close without stretching
 * @property {string} size                        the size that was checked
 * @property {number} garmentGirth_cm             the girth of the part that governs (0 when there is no torso or skirt panel)
 * @property {number} bodyGirth_cm                the girth of the body that part must pass over
 * @property {string} bodyGirthKey                which measurement that was ('' when there is nothing to check)
 * @property {number} ease_cm                     garment - body for the tightest part; negative means it cannot close; 0 when there is nothing to check
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

  // Each part of the garment against the part of the body it covers; the tightest one decides. A tee that
  // clears a 113 cm bust still will not go over 125 cm hips, but a fitted dress's bodice is not asked to.
  const governing = tightestPart(partChecks(graded, body));
  const garment = governing ? governing.garment_cm : 0;
  const bodyGirth = governing ? governing.body_cm : 0;
  const bodyKey = governing ? governing.key : '';

  // Grading can also break a garment against ITSELF: move a shoulder point and the armhole it bounds
  // changes length while the sleeve cap does not, so the cap seam arrives too long. That has nothing
  // to do with the body, but it tears in exactly the same place, so it belongs in the same warning.
  let seamDrift = 0;
  try { seamDrift = (seamEaseDrift(doc, sizeName) || []).length; } catch { seamDrift = 0; }

  const ease = governing ? governing.ease_cm : 0;
  const span = shoulderSpan(graded);
  const bodyShoulder = body && Number.isFinite(body.shoulderWidth_cm) ? body.shoulderWidth_cm : null;
  const shoulderShort = (span !== null && bodyShoulder !== null && bodyShoulder - span > SHOULDER_LIMIT)
    ? bodyShoulder - span : null;

  /** @type {'ok'|'snug'|'tight'} */
  let level = 'ok';
  if (governing && ease < EASE_LIMITS.tight) level = 'tight';
  else if (governing && ease < EASE_LIMITS.snug) level = 'snug';
  if (level === 'ok' && shoulderShort !== null) level = 'snug';
  if (level === 'ok' && seamDrift > 0) level = 'snug';

  // the smallest size in the chart that clears the body with room to spare
  /** @type {{name: string, ease_cm: number}|null} */
  let better = null;
  if (level !== 'ok') {
    for (const row of (doc.sizes && doc.sizes.rows) || []) {
      if (row.name === sizeName) continue;
      let t;
      try { t = tightestPart(partChecks(gradeDoc(doc, row.name), body)); } catch { continue; }
      if (!t) continue;
      const e = t.ease_cm;   // the tightest part, so a size that clears it clears them all
      if (e >= EASE_LIMITS.snug && (better === null || e < better.ease_cm)) better = { name: row.name, ease_cm: e };
    }
  }

  const round = (v) => Math.round(v * 10) / 10;
  let message;
  if (!governing) {
    message = 'No torso or skirt panels to check.';
  } else if (level === 'tight') {
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
