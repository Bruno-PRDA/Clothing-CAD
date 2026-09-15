// src/cloth/constraints.js — XPBD constraint projections (SPEC section 7.2). λ is reset every substep, so
// Δλ = −C / (Σ w|∇C|² + α/h²) and Δx_i = w_i · Δλ · ∇_i C. No allocation; all functions take flat typed arrays.

const SEAM_ALPHA = 1e-8; // m/N

/**
 * Cotangent of the angle between (ax,ay) and (bx,by): (a·b)/|a×b|.
 * @param {number} ax @param {number} ay @param {number} bx @param {number} by @returns {number}
 */
function cot(ax, ay, bx, by) {
  const cross = Math.abs(ax * by - ay * bx);
  if (cross < 1e-18) return 0;
  return (ax * bx + ay * by) / cross;
}

/**
 * Bergou/Wardetzky K vector of a bending stencil from its 2D rest positions (any consistent unit; s uses the same unit):
 * e0 = x1−x0, e1 = x2−x0, e2 = x3−x0, e3 = x2−x1, e4 = x3−x1, c01 = cot(e0,e1), c02 = cot(e0,e2), c03 = cot(−e0,e3),
 * c04 = cot(−e0,e4); K = [c03 + c04, c01 + c02, −c01 − c03, −c02 − c04]. Writes K to outK[off..off+3].
 * @returns {number} s = sqrt(3 / (A0 + A1)) (1/unit)
 */
export function bendingCoefficients(x0, y0, x1, y1, x2, y2, x3, y3, outK, off) {
  const e0x = x1 - x0; const e0y = y1 - y0;
  const e1x = x2 - x0; const e1y = y2 - y0;
  const e2x = x3 - x0; const e2y = y3 - y0;
  const e3x = x2 - x1; const e3y = y2 - y1;
  const e4x = x3 - x1; const e4y = y3 - y1;
  const c01 = cot(e0x, e0y, e1x, e1y);
  const c02 = cot(e0x, e0y, e2x, e2y);
  const c03 = cot(-e0x, -e0y, e3x, e3y);
  const c04 = cot(-e0x, -e0y, e4x, e4y);
  outK[off] = c03 + c04;
  outK[off + 1] = c01 + c02;
  outK[off + 2] = -c01 - c03;
  outK[off + 3] = -c02 - c04;
  const A0 = Math.abs(e0x * e1y - e0y * e1x) * 0.5;
  const A1 = Math.abs(e0x * e2y - e0y * e2x) * 0.5;
  const A = A0 + A1;
  return A > 1e-18 ? Math.sqrt(3 / A) : 0;
}

/**
 * Bending constraint value C = s·|Σ K_i x_i| of stencil b (for tests and diagnostics).
 * @param {Float32Array} pos @param {Uint32Array} bIdx @param {Float32Array} bK @param {Float32Array} bS @param {number} b
 * @returns {number}
 */
export function bendingC(pos, bIdx, bK, bS, b) {
  const i0 = bIdx[4 * b]; const i1 = bIdx[4 * b + 1]; const i2 = bIdx[4 * b + 2]; const i3 = bIdx[4 * b + 3];
  const k1 = bK[4 * b + 1]; const k2 = bK[4 * b + 2]; const k3 = bK[4 * b + 3];
  const x0 = pos[3 * i0]; const y0 = pos[3 * i0 + 1]; const z0 = pos[3 * i0 + 2];
  const Lx = k1 * (pos[3 * i1] - x0) + k2 * (pos[3 * i2] - x0) + k3 * (pos[3 * i3] - x0);
  const Ly = k1 * (pos[3 * i1 + 1] - y0) + k2 * (pos[3 * i2 + 1] - y0) + k3 * (pos[3 * i3 + 1] - y0);
  const Lz = k1 * (pos[3 * i1 + 2] - z0) + k2 * (pos[3 * i2 + 2] - z0) + k3 * (pos[3 * i3 + 2] - z0);
  return bS[b] * Math.sqrt(Lx * Lx + Ly * Ly + Lz * Lz);
}

/**
 * Distance constraints: C = |x_i − x_j| − L, α_e not scaled by the length.
 * @param {Float32Array} pos @param {Float32Array} invMass @param {Uint32Array} eIdx @param {Float32Array} eRest
 * @param {Float32Array} eAlpha @param {number} invH2
 * @param {Float32Array} [lambda] per-edge Lagrange multiplier, zeroed by the caller at the start of each substep;
 *   omit it for a single-pass solve (the multiplier would be zero throughout anyway)  1/h²
 */
export function solveDistance(pos, invMass, eIdx, eRest, eAlpha, invH2, lambda) {
  const E = eRest.length;
  for (let e = 0; e < E; e++) {
    const i = eIdx[2 * e];
    const j = eIdx[2 * e + 1];
    const wi = invMass[i];
    const wj = invMass[j];
    const wsum = wi + wj;
    if (wsum === 0) continue;
    const i3 = 3 * i;
    const j3 = 3 * j;
    const dx = pos[i3] - pos[j3];
    const dy = pos[i3 + 1] - pos[j3 + 1];
    const dz = pos[i3 + 2] - pos[j3 + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-9) continue;
    const C = d - eRest[e];
    // XPBD with the Lagrange multiplier carried ACROSS the passes of this substep (Macklin 2016, eq. 18).
    // With lambda reset on every pass the steady state of a distance constraint keeps an artificial compliance of
    // h^2 * sum(w) — for cotton on a 15 mm mesh that is 0.39 m/N against the fabric's own 1.44e-4, i.e. 2700x too
    // soft, and extra passes cannot remove it (measured: 5 passes moved p99 strain only 11.4% -> 10.5%). Accumulating
    // lambda makes successive passes actually converge on the tabulated compliance.
    const at = eAlpha[e] * invH2;
    const dl = lambda
      ? (-C - at * lambda[e]) / (wsum + at)
      : -C / (wsum + at);
    if (lambda) lambda[e] += dl;
    const k = dl / d;
    const ki = wi * k;
    const kj = wj * k;
    pos[i3] += ki * dx;
    pos[i3 + 1] += ki * dy;
    pos[i3 + 2] += ki * dz;
    pos[j3] -= kj * dx;
    pos[j3 + 1] -= kj * dy;
    pos[j3 + 2] -= kj * dz;
  }
}

/**
 * One-sided strain limiting (Provot 1995): every edge longer than (1 + limit)·L is projected straight back to that
 * length with α = 0 and the usual mass weights. It is an INEQUALITY — an edge shorter than the bound is untouched —
 * so it never resists folding, buckling or wrinkling, and it conserves momentum (both ends move by w_i/(w_i+w_j)).
 *
 * Why it is needed on top of the distance constraints. With λ reset every substep and one Gauss–Seidel pass the
 * distance constraint carries an artificial compliance h²·Σw (0.37 m/N at a 10 mm cotton mesh against the material's
 * 1.44e-4), so wherever the cloth is loaded by something rigid — a seam ramp, or the body pushing back — the edges
 * stretch until that fake compliance balances the load and simply stay there. On the sample T-shirt the neckline,
 * which is 374 mm around a 417 mm neck, settled into a frozen equilibrium with single edges at 250 % strain while
 * its neighbours were slack. Adding Gauss–Seidel passes only shrinks that as ~1/passes and adding substeps as h²;
 * a hard one-sided bound removes it outright for the cost of one pass over the edges.
 * @param {Float32Array} pos @param {Float32Array} invMass @param {Uint32Array} eIdx @param {Float32Array} eRest
 * @param {number} limit  maximum tensile strain, e.g. 0.1
 */
export function solveStrainLimit(pos, invMass, eIdx, eRest, limit, relax) {
  const E = eRest.length;
  const f = 1 + limit;
  const w = relax === undefined ? 1 : relax;
  for (let e = 0; e < E; e++) {
    const i = eIdx[2 * e];
    const j = eIdx[2 * e + 1];
    const wi = invMass[i];
    const wj = invMass[j];
    const wsum = wi + wj;
    if (wsum === 0) continue;
    const L = eRest[e] * f;
    const i3 = 3 * i;
    const j3 = 3 * j;
    const dx = pos[i3] - pos[j3];
    const dy = pos[i3 + 1] - pos[j3 + 1];
    const dz = pos[i3 + 2] - pos[j3 + 2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= L * L) continue;
    const d = Math.sqrt(d2);
    if (d < 1e-9) continue;
    const k = w * (d - L) / (d * wsum);
    const ki = wi * k;
    const kj = wj * k;
    pos[i3] -= ki * dx;
    pos[i3 + 1] -= ki * dy;
    pos[i3 + 2] -= ki * dz;
    pos[j3] += kj * dx;
    pos[j3 + 1] += kj * dy;
    pos[j3 + 2] += kj * dz;
  }
}

/**
 * Bergou linear bending: L = Σ K_i x_i, C = s|L|, ∇_i C = s K_i L/|L|.
 * @param {Float32Array} pos @param {Float32Array} invMass @param {Uint32Array} bIdx @param {Float32Array} bK
 * @param {Float32Array} bS @param {Float32Array} bAlpha @param {number} invH2
 */
export function solveBending(pos, invMass, bIdx, bK, bS, bAlpha, invH2, relax) {
  const w = relax === undefined ? 1 : relax;
  const B = bS.length;
  for (let b = 0; b < B; b++) {
    const b4 = 4 * b;
    const i0 = bIdx[b4];
    const i1 = bIdx[b4 + 1];
    const i2 = bIdx[b4 + 2];
    const i3 = bIdx[b4 + 3];
    const w0 = invMass[i0];
    const w1 = invMass[i1];
    const w2 = invMass[i2];
    const w3 = invMass[i3];
    const k0 = bK[b4];
    const k1 = bK[b4 + 1];
    const k2 = bK[b4 + 2];
    const k3 = bK[b4 + 3];
    const s = bS[b];
    const sumW = s * s * (w0 * k0 * k0 + w1 * k1 * k1 + w2 * k2 * k2 + w3 * k3 * k3);
    if (sumW === 0) continue;
    const p0 = 3 * i0;
    const p1 = 3 * i1;
    const p2 = 3 * i2;
    const p3 = 3 * i3;
    const x0 = pos[p0];
    const y0 = pos[p0 + 1];
    const z0 = pos[p0 + 2];
    const Lx = k1 * (pos[p1] - x0) + k2 * (pos[p2] - x0) + k3 * (pos[p3] - x0);
    const Ly = k1 * (pos[p1 + 1] - y0) + k2 * (pos[p2 + 1] - y0) + k3 * (pos[p3 + 1] - y0);
    const Lz = k1 * (pos[p1 + 2] - z0) + k2 * (pos[p2 + 2] - z0) + k3 * (pos[p3 + 2] - z0);
    const l = Math.sqrt(Lx * Lx + Ly * Ly + Lz * Lz);
    if (l < 1e-9) continue;
    const C = s * l;
    const dl = -C / (sumW + bAlpha[b] * invH2);
    const f = w * dl * s / l; // Δx_i = w_i k_i f L
    const f0 = w0 * k0 * f;
    const f1 = w1 * k1 * f;
    const f2 = w2 * k2 * f;
    const f3 = w3 * k3 * f;
    pos[p0] += f0 * Lx; pos[p0 + 1] += f0 * Ly; pos[p0 + 2] += f0 * Lz;
    pos[p1] += f1 * Lx; pos[p1 + 1] += f1 * Ly; pos[p1 + 2] += f1 * Lz;
    pos[p2] += f2 * Lx; pos[p2 + 1] += f2 * Ly; pos[p2 + 2] += f2 * Lz;
    pos[p3] += f3 * Lx; pos[p3 + 1] += f3 * Ly; pos[p3 + 2] += f3 * Lz;
  }
}

/**
 * Seam pairs: distance constraint with the rest-length ramp L(t) = sRest0 · max(0, 1 − (t − sStart)/sewTime), α = 1e-8.
 * @param {Float32Array} pos @param {Float32Array} invMass @param {Uint32Array} sIdx @param {Float32Array} sRest0
 * @param {Float32Array} sStart @param {number} invH2 @param {number} time @param {number} sewTime
 */
export function solveSeams(pos, invMass, sIdx, sRest0, sStart, invH2, time, sewTime) {
  const S = sRest0.length;
  const alphaT = SEAM_ALPHA * invH2;
  const invSew = sewTime > 0 ? 1 / sewTime : 0;
  for (let s = 0; s < S; s++) {
    const i = sIdx[2 * s];
    const j = sIdx[2 * s + 1];
    const wi = invMass[i];
    const wj = invMass[j];
    const wsum = wi + wj;
    if (wsum === 0) continue;
    let ramp = sewTime > 0 ? 1 - (time - sStart[s]) * invSew : 0;
    if (ramp < 0) ramp = 0;
    const L = sRest0[s] * ramp;
    const i3 = 3 * i;
    const j3 = 3 * j;
    const dx = pos[i3] - pos[j3];
    const dy = pos[i3 + 1] - pos[j3 + 1];
    const dz = pos[i3 + 2] - pos[j3 + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-9) continue;
    const C = d - L;
    const dl = -C / (wsum + alphaT);
    const k = dl / d;
    const ki = wi * k;
    const kj = wj * k;
    pos[i3] += ki * dx;
    pos[i3 + 1] += ki * dy;
    pos[i3 + 2] += ki * dz;
    pos[j3] -= kj * dx;
    pos[j3 + 1] -= kj * dy;
    pos[j3 + 2] -= kj * dz;
  }
}

/**
 * Pins: pos = pTarget.
 * @param {Float32Array} pos @param {Uint32Array} pIdx @param {Float32Array} pTarget
 */
export function applyPins(pos, pIdx, pTarget) {
  const P = pIdx.length;
  for (let p = 0; p < P; p++) {
    const v3 = 3 * pIdx[p];
    pos[v3] = pTarget[3 * p];
    pos[v3 + 1] = pTarget[3 * p + 1];
    pos[v3 + 2] = pTarget[3 * p + 2];
  }
}
