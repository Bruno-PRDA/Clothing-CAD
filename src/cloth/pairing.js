// src/cloth/pairing.js — which vertex of one seam side is sewn to which vertex of the other (SPEC 7.1, amendment
// "Darts"). Pure; no imports.
//
// Without darts both sides of a seam have the same number of samples and vertex i meets vertex i (or N−1−i when the
// seam is reversed). A dart mouth on a side is ONE sewn position carried by TWO vertices (its corners A and B, which the
// dart's own seam pulls together), so the sides are walked by sewn fraction instead: equal fractions meet, and a corner
// pair meets whatever the other side has at that position.

/** Two sewn fractions closer than this are the same position. */
export const FRACTION_EPS = 1e-6;

/**
 * Index pairing of two equal-length sides (meshes without edgeFrac, such as the lattice fixtures).
 * @param {ArrayLike<number>} va @param {ArrayLike<number>} vb @param {boolean} reverse
 * @returns {number[]|null} flat [a0, b0, a1, b1, …] local ids; null when the lengths differ
 */
export function pairByIndex(va, vb, reverse) {
  const N = va.length;
  if (N !== vb.length || N < 2) return null;
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < N; i++) out.push(va[i], vb[reverse ? N - 1 - i : i]);
  return out;
}

/**
 * Pair two seam sides by their sewn fractions (PieceMesh.edgeFrac). Side b is read backwards, with u ↦ 1 − u, when the
 * seam is reversed. At each shared fraction: one vertex each → one pair; a mouth against one vertex → both corners to
 * that vertex; a mouth against a mouth → corner to corner in walk order.
 * @param {ArrayLike<number>} va @param {ArrayLike<number>} fa @param {ArrayLike<number>} vb @param {ArrayLike<number>} fb
 * @param {boolean} reverse
 * @returns {number[]|null} flat [a, b, a, b, …] local ids; null when the fraction lists do not match
 */
export function pairByFraction(va, fa, vb, fb, reverse) {
  const na = va.length;
  const nb = vb.length;
  if (na < 2 || nb < 2 || fa.length !== na || fb.length !== nb) return null;
  /** @param {number} j @returns {number} */
  const bId = (j) => vb[reverse ? nb - 1 - j : j];
  /** @param {number} j @returns {number} */
  const bU = (j) => (reverse ? 1 - fb[nb - 1 - j] : fb[j]);
  /** @type {number[]} */
  const out = [];
  let i = 0;
  let j = 0;
  while (i < na && j < nb) {
    const u = fa[i];
    if (Math.abs(u - bU(j)) > FRACTION_EPS) return null;
    const twoA = i + 1 < na && Math.abs(fa[i + 1] - u) <= FRACTION_EPS;
    const twoB = j + 1 < nb && Math.abs(bU(j + 1) - u) <= FRACTION_EPS;
    if (twoA && twoB) out.push(va[i], bId(j), va[i + 1], bId(j + 1));
    else if (twoA) out.push(va[i], bId(j), va[i + 1], bId(j));
    else if (twoB) out.push(va[i], bId(j), va[i], bId(j + 1));
    else out.push(va[i], bId(j));
    i += twoA ? 2 : 1;
    j += twoB ? 2 : 1;
  }
  return (i === na && j === nb) ? out : null;
}
