// src/body/measure.js — ray-cast circumferences from the baked SDF (SPEC 6.5). Pure; grid metres, result cm.

import { sampleSdf } from '../core/sdf.js';

/** @typedef {import('../core/types.js').SdfGrid} SdfGrid */
/** @typedef {import('./loft.js').Ring} Ring */

export const MEASURE_RAYS = 180;
const STEP = 0.005;
const R0 = 0.01;
const BISECT = 8;

/**
 * Circumference (metres) of the field's cross-section at the ring centre [0, y, cz] in the xz-plane:
 * 180 rays, 5 mm march from r = 0.01 until sampleSdf >= 0 (limit 1.5 a; beyond that the last negative point is
 * taken), 8 bisections, chord sum.
 * @param {SdfGrid} grid @param {Ring} ring @returns {number}
 */
export function ringCircumference(grid, ring) {
  const y = ring.y;
  const cz = ring.cz;
  const limit = 1.5 * ring.a;
  let sum = 0;
  let firstX = 0;
  let firstZ = 0;
  let prevX = 0;
  let prevZ = 0;
  for (let i = 0; i < MEASURE_RAYS; i++) {
    const th = (2 * Math.PI * i) / MEASURE_RAYS;
    const dx = Math.cos(th);
    const dz = Math.sin(th);
    let rIn = R0;
    let rOut = -1;
    let r = R0;
    let dIn = sampleSdf(grid, dx * r, y, cz + dz * r, null);
    if (dIn >= 0) {
      rIn = 0;
      rOut = R0;
    } else {
      while (r < limit) {
        const rn = r + STEP;
        const d = sampleSdf(grid, dx * rn, y, cz + dz * rn, null);
        if (d >= 0) { rOut = rn; break; }
        rIn = rn;
        dIn = d;
        r = rn;
      }
    }
    let hit = rIn;
    if (rOut > 0) {
      let lo = rIn;
      let hi = rOut;
      for (let b = 0; b < BISECT; b++) {
        const mid = (lo + hi) / 2;
        const d = sampleSdf(grid, dx * mid, y, cz + dz * mid, null);
        if (d >= 0) hi = mid; else lo = mid;
      }
      hit = (lo + hi) / 2;
    }
    const px = dx * hit;
    const pz = dz * hit;
    if (i === 0) {
      firstX = px; firstZ = pz;
    } else {
      sum += Math.hypot(px - prevX, pz - prevZ);
    }
    prevX = px;
    prevZ = pz;
  }
  sum += Math.hypot(firstX - prevX, firstZ - prevZ);
  return sum;
}

/**
 * Measured chest / waist / hip circumferences in cm (1 decimal).
 * @param {SdfGrid} grid @param {Record<string, Ring>} rings
 * @returns {{chest_cm:number, waist_cm:number, hips_cm:number}}
 */
export function measureBody(grid, rings) {
  const cm = (m) => Math.round(m * 1000) / 10;
  return {
    chest_cm: cm(ringCircumference(grid, rings.chest)),
    waist_cm: cm(ringCircumference(grid, rings.waist)),
    hips_cm: cm(ringCircumference(grid, rings.hip)),
  };
}
