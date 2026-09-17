// src/cloth/tears.js — find where a garment is failing, so the viewer can point at it.
//
// Two kinds of failure, both of which happen when the pattern is smaller than the body it is being
// sewn onto (see sizing/fit.js for the check that predicts it):
//
//   STRETCHED  fabric held far past its rest length. A settled garment that fits sits around 8 % p99;
//              anything past ~30 % is fabric doing work it physically could not do, and on screen the
//              triangles are large enough that it reads as a tear.
//   OPEN SEAM  a welded pair the solver could not bring together. Body collision runs after the seam
//              solve in the substep, so on a convex ridge like the shoulder the body wins and the
//              seam simply stays open.
//
// Points are clustered so a 200-vertex failure produces a handful of markers rather than a swarm.
// Pure: reads a ClothState, allocates its own output, touches nothing.

/** @typedef {import('../core/types.js').ClothState} ClothState */

/** Tensile strain at which fabric is called torn rather than merely taut. */
export const TEAR_STRAIN = 0.30;
/** Seam gap in metres at which a seam is called open. */
export const TEAR_GAP_M = 0.003;
/** Markers closer together than this (metres) are merged into one. */
export const CLUSTER_M = 0.035;
/** Never return more than this many markers. */
export const MAX_MARKS = 64;

/**
 * @typedef {Object} TearMark
 * @property {number} x @property {number} y @property {number} z
 * @property {number} severity   0..1, where 1 is twice the threshold
 * @property {'strain'|'seam'} kind
 * @property {number} value      strain as a fraction, or gap in mm
 */

/**
 * @typedef {Object} TearReport
 * @property {TearMark[]} marks
 * @property {number} strainCount   vertices over TEAR_STRAIN before clustering
 * @property {number} seamCount     seam pairs over TEAR_GAP_M
 * @property {number} worstStrain   0..n as a fraction
 * @property {number} worstGap_mm
 */

/**
 * @param {ClothState} state
 * @param {{strain?: number, gap_m?: number, cluster_m?: number, max?: number}} [opts]
 * @returns {TearReport}
 */
export function findTears(state, opts = {}) {
  const empty = { marks: [], strainCount: 0, seamCount: 0, worstStrain: 0, worstGap_mm: 0 };
  if (!state || !state.pos) return empty;
  const strainLimit = Number.isFinite(opts.strain) ? Number(opts.strain) : TEAR_STRAIN;
  const gapLimit = Number.isFinite(opts.gap_m) ? Number(opts.gap_m) : TEAR_GAP_M;
  const cluster = Number.isFinite(opts.cluster_m) ? Number(opts.cluster_m) : CLUSTER_M;
  const max = Number.isFinite(opts.max) ? Number(opts.max) : MAX_MARKS;

  const { pos, eIdx, eRest, sIdx } = state;

  /** @type {TearMark[]} */
  const raw = [];
  let worstStrain = 0, worstGap = 0, strainCount = 0, seamCount = 0;

  // --- over-stretched edges ---------------------------------------------------------------------
  if (eIdx && eRest) {
    for (let e = 0, E = eRest.length; e < E; e++) {
      const rest = eRest[e];
      if (!(rest > 1e-9)) continue;
      const i = eIdx[e * 2] * 3, j = eIdx[e * 2 + 1] * 3;
      const dx = pos[i] - pos[j], dy = pos[i + 1] - pos[j + 1], dz = pos[i + 2] - pos[j + 2];
      const s = (Math.sqrt(dx * dx + dy * dy + dz * dz) - rest) / rest;
      if (s > worstStrain) worstStrain = s;
      if (s < strainLimit) continue;
      strainCount++;
      raw.push({
        x: (pos[i] + pos[j]) / 2, y: (pos[i + 1] + pos[j + 1]) / 2, z: (pos[i + 2] + pos[j + 2]) / 2,
        severity: Math.min(1, (s - strainLimit) / strainLimit), kind: 'strain', value: s,
      });
    }
  }

  // --- seams the solver could not close ----------------------------------------------------------
  if (sIdx) {
    for (let k = 0, S = sIdx.length / 2; k < S; k++) {
      const i = sIdx[k * 2] * 3, j = sIdx[k * 2 + 1] * 3;
      const dx = pos[i] - pos[j], dy = pos[i + 1] - pos[j + 1], dz = pos[i + 2] - pos[j + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d * 1000 > worstGap) worstGap = d * 1000;
      if (d < gapLimit) continue;
      seamCount++;
      raw.push({
        x: (pos[i] + pos[j]) / 2, y: (pos[i + 1] + pos[j + 1]) / 2, z: (pos[i + 2] + pos[j + 2]) / 2,
        severity: Math.min(1, (d - gapLimit) / (gapLimit * 3)), kind: 'seam', value: d * 1000,
      });
    }
  }

  // --- cluster, worst first so a merged marker keeps the worst severity and kind ------------------
  raw.sort((a, b) => b.severity - a.severity);
  /** @type {TearMark[]} */
  const marks = [];
  const c2 = cluster * cluster;
  for (const m of raw) {
    let merged = false;
    for (const k of marks) {
      const dx = k.x - m.x, dy = k.y - m.y, dz = k.z - m.z;
      if (dx * dx + dy * dy + dz * dz < c2) { merged = true; break; }
    }
    if (merged) continue;
    marks.push(m);
    if (marks.length >= max) break;
  }

  return { marks, strainCount, seamCount, worstStrain, worstGap_mm: worstGap };
}
