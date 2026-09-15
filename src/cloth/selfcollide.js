// src/cloth/selfcollide.js — vertex–vertex self-collision on the spatial hash (SPEC section 7.6).
// Exclusions: 1-ring + seam-neighbour mask (CSR, binary search). At most 16 pairs per vertex per pass. No allocation.

import { buildHash, hashCell } from './hash.js';

/** @typedef {import('../core/types.js').ClothState} ClothState */

/**
 * True when j is in i's exclusion list.
 * @param {Uint32Array} exclStart @param {Uint32Array} exclList @param {number} i @param {number} j @returns {boolean}
 */
function isExcluded(exclStart, exclList, i, j) {
  let lo = exclStart[i];
  let hi = exclStart[i + 1] - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = exclList[mid];
    if (v === j) return true;
    if (v < j) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}

/**
 * @param {ClothState} state @param {import('./state.js').ClothAux} aux
 */
export function collideSelf(state, aux) {
  const { V, pos, invMass, exclStart, exclList } = state;
  const selfDist = state.params.selfDist;
  const h = aux.hash;
  buildHash(h, pos, V, selfDist);
  const { cellStart, entries, cellIx, cellIy, cellIz, mask } = h;
  const seamMask = aux.seamMask;
  const d2max = selfDist * selfDist;
  let masked = 0;
  for (let i = 0; i < V; i++) {
    const wi = invMass[i];
    const ix = cellIx[i];
    const iy = cellIy[i];
    const iz = cellIz[i];
    const i3 = 3 * i;
    let count = 0;
    outer:
    for (let dz = -1; dz <= 1; dz++) {
      const cz = iz + dz;
      for (let dy = -1; dy <= 1; dy++) {
        const cy = iy + dy;
        for (let dx = -1; dx <= 1; dx++) {
          const cx = ix + dx;
          const hh = hashCell(cx, cy, cz, mask);
          const end = cellStart[hh + 1];
          for (let k = cellStart[hh]; k < end; k++) {
            const j = entries[k];
            if (j <= i) continue;
            if (cellIx[j] !== cx || cellIy[j] !== cy || cellIz[j] !== cz) continue;
            const wj = invMass[j];
            const wsum = wi + wj;
            if (wsum === 0) continue;
            if (isExcluded(exclStart, exclList, i, j)) continue;
            const j3 = 3 * j;
            const ddx = pos[i3] - pos[j3];
            const ddy = pos[i3 + 1] - pos[j3 + 1];
            const ddz = pos[i3 + 2] - pos[j3 + 2];
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 >= d2max) continue;
            if (seamMask[i] && seamMask[j]) masked++;
            const d = Math.sqrt(d2);
            if (d < 1e-9) continue;
            const push = (selfDist - d) / (d * wsum);
            const ki = wi * push;
            const kj = wj * push;
            pos[i3] += ki * ddx;
            pos[i3 + 1] += ki * ddy;
            pos[i3 + 2] += ki * ddz;
            pos[j3] -= kj * ddx;
            pos[j3 + 1] -= kj * ddy;
            pos[j3 + 2] -= kj * ddz;
            count++;
            if (count >= 16) break outer;
          }
        }
      }
    }
  }
  aux.selfMaskedPairs += masked;
}
