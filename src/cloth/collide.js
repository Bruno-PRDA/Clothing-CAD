// src/cloth/collide.js — body collision against the trilinear SDF with CCD-lite and PBD friction (SPEC section 7.5).
// One module-level Float32Array(3) gradient scratch; nothing else allocated.

import { sampleSdf } from '../core/sdf.js';

/** @typedef {import('../core/types.js').ClothState} ClothState */
/** @typedef {import('../core/types.js').SdfGrid} SdfGrid */

const grad = new Float32Array(3);

/**
 * Friction "normal displacement" floor (metres). The spec text says 0.5 mm; that is ~20× the per-substep gravity
 * penetration of a resting vertex (h²·g ≈ 2.7e-5 m) and would freeze every sliding contact, so the floor is set to
 * 2e-5 m — resting vertices still see friction, sliding ones decelerate at ≈ μ·g. See the implementation notes.
 */
export const FRICTION_FLOOR = 2e-5;

/**
 * @param {ClothState} state @param {SdfGrid} sdf
 */
export function collideBody(state, sdf) {
  const { V, pos, prev, invMass, clearance, mu, dCache } = state;
  for (let v = 0; v < V; v++) {
    if (invMass[v] === 0) continue;
    const v3 = 3 * v;
    let x = pos[v3];
    let y = pos[v3 + 1];
    let z = pos[v3 + 2];
    let d = sampleSdf(sdf, x, y, z, grad);
    if (dCache[v] > 0 && d < 0) {
      // CCD-lite: the vertex crossed the surface in this substep — go back to where it was.
      x = prev[v3];
      y = prev[v3 + 1];
      z = prev[v3 + 2];
      pos[v3] = x;
      pos[v3 + 1] = y;
      pos[v3 + 2] = z;
      d = sampleSdf(sdf, x, y, z, grad);
    }
    const c = clearance[v];
    let corr = 0;
    if (d < c) {
      corr = c - d;
      x += corr * grad[0];
      y += corr * grad[1];
      z += corr * grad[2];
      pos[v3] = x;
      pos[v3 + 1] = y;
      pos[v3 + 2] = z;
    }
    if (d < c + 0.001) {
      const dx = x - prev[v3];
      const dy = y - prev[v3 + 1];
      const dz = z - prev[v3 + 2];
      const dn = dx * grad[0] + dy * grad[1] + dz * grad[2];
      const tx = dx - dn * grad[0];
      const ty = dy - dn * grad[1];
      const tz = dz - dn * grad[2];
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tl > 0) {
        const m = corr > FRICTION_FLOOR ? corr : FRICTION_FLOOR;
        const cap = mu[v] * m;
        if (tl <= cap) {
          pos[v3] = x - tx;
          pos[v3 + 1] = y - ty;
          pos[v3 + 2] = z - tz;
        } else {
          const k = cap / tl;
          pos[v3] = x - tx * k;
          pos[v3 + 1] = y - ty * k;
          pos[v3 + 2] = z - tz * k;
        }
      }
    }
    dCache[v] = d;
  }
}
