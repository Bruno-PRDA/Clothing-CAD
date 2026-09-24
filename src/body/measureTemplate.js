// src/body/measureTemplate.js — take a tailor's measurements off the template mesh.
//
// Each measurement is a plane (or a pair of landmarks) defined from the CC0 mesh's own joint cubes,
// so the definitions travel with the body as it morphs. Girths are convex perimeters — see
// section.js for why. Everything is returned in CENTIMETRES to match BodyParams.
//
// The bands below are searched rather than fixed: a bust is "the largest girth between the armpit and
// the underbust", a waist is "the smallest girth between the underbust and the hip". That is what a
// tailor does, and it keeps working when a morph moves the anatomy up or down.

import { buildIndex, girthAt, limbGirth } from './section.js';
import { jointAt } from './template.js';

/** @typedef {import('./template.js').Template} Template */

const M2CM = 100;

/**
 * Girth of a band at its extreme, as a SOFT extremum: every sample within about a centimetre of the
 * best one contributes, weighted by exp(-|g - g_ext| / SOFT_TAU).
 *
 * A hard argmin is not a continuous function of the body. Move a slider a hundredth and the waist's
 * narrowest level can switch from one local minimum to another a few centimetres away — the girth
 * barely changes, but every measurement DEFINED off that level (back length is nape-to-waist) jumps
 * by the distance between them. Measured while fitting: back length swinging +1.8 → −10.7 cm between
 * rounds whose sliders moved by hundredths, and a Jacobian solver dutifully learning the cliff as a
 * derivative. The soft blend sits within SOFT_TAU of the true extremum and is continuous in the
 * morphs, so both the number and the level it was taken at move smoothly under the sliders.
 *
 * @param {import('./section.js').SectionIndex} ix
 * @param {number} yLo @param {number} yHi @param {'max'|'min'} want @param {number} [steps]
 * @returns {{y: number, girth: number, width: number, depth: number}}
 */
function extremeGirth(ix, yLo, yHi, want, steps = 16) {
  const ys = [], gs = [], ws = [], ds = [];
  let ext = want === 'max' ? -Infinity : Infinity;
  for (let i = 0; i <= steps; i++) {
    const y = yLo + (yHi - yLo) * (i / steps);
    const g = girthAt(ix, y, {});
    if (!g) continue;
    ys.push(y); gs.push(g.girth); ws.push(g.width); ds.push(g.depth);
    if (want === 'max' ? g.girth > ext : g.girth < ext) ext = g.girth;
  }
  if (!gs.length) return { y: (yLo + yHi) / 2, girth: 0, width: 0, depth: 0 };
  let W = 0, y = 0, girth = 0, width = 0, depth = 0;
  for (let i = 0; i < gs.length; i++) {
    const w = Math.exp(-Math.abs(gs[i] - ext) / SOFT_TAU);
    W += w; y += w * ys[i]; girth += w * gs[i]; width += w * ws[i]; depth += w * ds[i];
  }
  return { y: y / W, girth: girth / W, width: width / W, depth: depth / W };
}
/** Girth scale of the soft extremum, metres. 4 mm: a sample 1.2 cm off the extremum weighs 5 %. */
const SOFT_TAU = 0.004;

/**
 * The crotch vertex: found ONCE on the rest mesh and then tracked by index, so the inseam is a
 * continuous function of the morphs.
 *
 * The previous definition — bisect for the lowest height at which the section is still one loop —
 * is anatomically right and numerically treacherous: wherever the inner thighs touch below the true
 * crotch the "one loop" region extends downward, and as a slider moves them a millimetre apart or
 * together the detected crotch jumps by the whole overlap. Measured while fitting: the inseam error
 * alternating −9.8, +1.0, −8.7, +0.7 cm on consecutive rounds. On the mid-sagittal plane the body's
 * lowest point IS the crotch (the legs are off-axis at |x| ≈ 9 cm), and on the rest mesh the legs
 * stand apart, so the lowest rest vertex near x = 0 in the pelvic band identifies it unambiguously.
 * The mesh topology never changes, so the same index is the crotch on every morphed body.
 *
 * @param {Template} tpl @returns {number} vertex index
 */
function crotchVertex(tpl) {
  if (typeof tpl.__crotchVertex === 'number') return tpl.__crotchVertex;
  const r = tpl.rest;
  let top = -Infinity, floor = Infinity;
  for (let i = 0; i < tpl.nBodyVerts; i++) { const y = r[i * 3 + 1]; if (y > top) top = y; if (y < floor) floor = y; }
  const H = top - floor;
  let best = -1, bestY = Infinity;
  for (let i = 0; i < tpl.nBodyVerts; i++) {
    const x = r[i * 3], y = r[i * 3 + 1];
    if (Math.abs(x) > 0.012 || y < floor + 0.30 * H || y > floor + 0.60 * H) continue;
    if (y < bestY) { bestY = y; best = i; }
  }
  Object.defineProperty(tpl, '__crotchVertex', { value: best, enumerable: false });
  return best;
}

/**
 * @typedef {Object} TemplateMeasurements
 * @property {number} height_cm
 * @property {number} chest_cm @property {number} underbust_cm @property {number} waist_cm @property {number} hips_cm
 * @property {number} neck_cm @property {number} shoulderWidth_cm
 * @property {number} upperArm_cm @property {number} forearm_cm @property {number} wrist_cm
 * @property {number} thigh_cm @property {number} calf_cm @property {number} ankle_cm
 * @property {number} armLength_cm @property {number} inseam_cm @property {number} torsoLength_cm @property {number} headHeight_cm
 * @property {Record<string, number>} levels the heights (metres) the girths were taken at
 */

/**
 * @param {Template} tpl @param {Float32Array} pos
 * @param {{index?: import('./section.js').SectionIndex}} [opts]
 * @returns {TemplateMeasurements}
 */
export function measureTemplate(tpl, pos, opts = {}) {
  const ix = opts.index || buildIndex(tpl, pos);
  const J = (n) => jointAt(tpl, pos, n);

  let top = -Infinity, floor = Infinity;
  for (let i = 0; i < tpl.nBodyVerts; i++) {
    const y = pos[i * 3 + 1];
    if (y > top) top = y;
    if (y < floor) floor = y;
  }
  const height = top - floor;

  const neckJ = J('neck') || [0, height * 0.86, 0];
  const shoulderL = J('l-shoulder') || [height * 0.11, height * 0.82, 0];
  const shoulderR = J('r-shoulder') || [-shoulderL[0], shoulderL[1], shoulderL[2]];
  const elbowL = J('l-elbow') || [height * 0.2, height * 0.7, 0];
  const handL = J('l-hand') || [height * 0.28, height * 0.62, 0];
  const pelvisJ = J('pelvis') || [0, height * 0.55, 0];
  const upperLegL = J('l-upper-leg') || [height * 0.06, height * 0.54, 0];
  const kneeL = J('l-knee') || [height * 0.09, height * 0.3, 0];
  const ankleL = J('l-ankle') || [height * 0.11, height * 0.04, 0];
  const spine3 = J('spine-3') || [0, height * 0.72, 0];

  // --- torso girths -------------------------------------------------------------------------------
  // bust: fullest between the armpit (just under the shoulder joint) and mid-chest. On a man the girth
  // rises all the way to the top of the band (the lats flare out under the arm) and the maximum lands on
  // the edge — which is right: a man's chest is measured under the arms. Checked 2026-09-24 with
  // tools/bodycheck.html?do=bustband: the section is three separate loops at every level of the band, so the
  // arm is never counted; women peak mid-band (female_m 72 %, plus_f 63 % of the way up).
  const yArmpit = shoulderL[1] - height * 0.055;
  const bust = extremeGirth(ix, yArmpit - height * 0.09, yArmpit - height * 0.005, 'max');
  // underbust: tightest in the band below the bust
  const underbust = extremeGirth(ix, bust.y - height * 0.075, bust.y - height * 0.015, 'min');
  // waist: tightest between the underbust and the hip bones
  const waist = extremeGirth(ix, underbust.y - height * 0.11, underbust.y - height * 0.015, 'min');
  // hips: fullest between the crotch and the waist
  const cv = crotchVertex(tpl);
  const yCrotch = cv >= 0 ? pos[cv * 3 + 1] : pelvisJ[1] - height * 0.07;
  const hips = extremeGirth(ix, yCrotch + height * 0.005, waist.y - height * 0.02, 'max');
  // Neck: tightest slice of the neck column. MakeHuman's `neck` joint marks the BASE of the neck (the
  // nape), not the top — anchoring the band between the shoulder and the neck joint collapses it to a
  // single slice down in the trapezius flare and reports a 40 cm neck on a 34 cm body. The column runs
  // from just above the nape to just below the jaw, and its minimum is the measurement.
  const jawJ = J('jaw');
  const neckTop = jawJ ? jawJ[1] - height * 0.013 : neckJ[1] + height * 0.030;
  const neck = extremeGirth(ix, neckJ[1] + height * 0.008, Math.max(neckJ[1] + height * 0.012, neckTop), 'min', 16);

  // --- limb girths, on planes perpendicular to each limb ------------------------------------------
  const g = (a, b, t, r, band) => {
    const v = limbGirth(tpl, pos, a, b, t, r, band);
    return v ? v.girth : 0;
  };
  // stations chosen where a tailor measures: biceps near the top of the upper arm, forearm at its
  // fullest, wrist just above the hand, thigh below the crotch, calf at its belly, ankle above the
  // malleolus. Radii are just wide enough to contain the limb at that station.
  const upperArm = g(shoulderL, elbowL, 0.30, 0.09, 0.030);
  const forearm = g(elbowL, handL, 0.22, 0.08, 0.030);
  const wrist = g(elbowL, handL, 0.88, 0.06, 0.020);
  const thigh = g(upperLegL, kneeL, 0.20, 0.12, 0.030);
  const calf = g(kneeL, ankleL, 0.28, 0.10, 0.030);
  const ankle = g(kneeL, ankleL, 0.90, 0.07, 0.020);

  // Across-shoulder (biacromial). The joint cubes sit at the GLENOHUMERAL joint, which is medial to
  // the acromion by roughly half the upper arm's radius on each side, so joint-to-joint alone reads
  // about 4 cm narrow. Adding one arm radius in total puts it back on the acromion, and it stays
  // right as the arm thickens because it is derived from the arm we just measured.
  const shoulderWidth = Math.abs(shoulderL[0] - shoulderR[0]) + upperArm / (2 * Math.PI);

  // --- lengths -------------------------------------------------------------------------------------
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // from the acromion, not the joint centre — the same offset the shoulder width uses
  const armLength = dist(shoulderL, elbowL) + dist(elbowL, handL) + upperArm / (2 * Math.PI);
  const inseam = yCrotch - floor;
  const torsoLength = neckJ[1] - waist.y;
  const headHeight = top - (jawJ ? jawJ[1] - height * 0.022 : neckJ[1]);

  return {
    height_cm: height * M2CM,
    chest_cm: bust.girth * M2CM,
    underbust_cm: underbust.girth * M2CM,
    waist_cm: waist.girth * M2CM,
    hips_cm: hips.girth * M2CM,
    neck_cm: neck.girth * M2CM,
    shoulderWidth_cm: shoulderWidth * M2CM,
    upperArm_cm: upperArm * M2CM,
    forearm_cm: forearm * M2CM,
    wrist_cm: wrist * M2CM,
    thigh_cm: thigh * M2CM,
    calf_cm: calf * M2CM,
    ankle_cm: ankle * M2CM,
    armLength_cm: armLength * M2CM,
    inseam_cm: inseam * M2CM,
    torsoLength_cm: torsoLength * M2CM,
    headHeight_cm: headHeight * M2CM,
    levels: {
      bust: bust.y, underbust: underbust.y, waist: waist.y, hips: hips.y,
      neck: neck.y, crotch: yCrotch, shoulder: shoulderL[1], armpit: yArmpit, spine3: spine3[1],
    },
  };
}
