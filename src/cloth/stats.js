// src/cloth/stats.js — SimStats (SPEC section 7.9). One object per state, reused every frame; the consumer copies fields.

/** @typedef {import('../core/types.js').ClothState} ClothState */
/** @typedef {import('../core/types.js').SimStats} SimStats */

/** @returns {number} milliseconds */
export const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
  ? () => performance.now()
  : () => Date.now();

/** @returns {SimStats} zeroed */
export function createStats() {
  return {
    frame: 0, time: 0, ms: 0, msAvg: 0, verts: 0, tris: 0, constraints: 0, maxSpeed: 0, maxPenetration_mm: 0,
    seamGapMax_mm: 0, seamGapMean_mm: 0, nanCount: 0, running: false, substeps: 10,
    sectionMs: { integrate: 0, distance: 0, bend: 0, seam: 0, collide: 0, self: 0 },
  };
}

/**
 * Fill aux.stats from the state and this frame's section timers. Allocation-free.
 * @param {ClothState} state @param {import('./state.js').ClothAux} aux @param {boolean} hadSdf @param {boolean} running
 * @returns {SimStats}
 */
export function computeStats(state, aux, hadSdf, running) {
  const st = aux.stats;
  const t = aux.timers;
  const ms = t.integrate + t.distance + t.bend + t.seam + t.collide + t.self;
  st.frame = state.frame;
  st.time = state.time;
  st.ms = ms;
  aux.msRing[aux.msRingI] = ms;
  aux.msRingI = (aux.msRingI + 1) % aux.msRing.length;
  if (aux.msRingN < aux.msRing.length) aux.msRingN++;
  let sum = 0;
  for (let i = 0; i < aux.msRingN; i++) sum += aux.msRing[i];
  st.msAvg = aux.msRingN > 0 ? sum / aux.msRingN : 0;
  st.verts = state.V;
  st.tris = state.tris.length / 3;
  st.constraints = state.eRest.length + state.bS.length + state.sRest0.length;
  const vel = state.vel;
  let maxV2 = 0;
  for (let v = 0; v < state.V; v++) {
    const vx = vel[3 * v];
    const vy = vel[3 * v + 1];
    const vz = vel[3 * v + 2];
    const s2 = vx * vx + vy * vy + vz * vz;
    if (s2 > maxV2) maxV2 = s2;
  }
  st.maxSpeed = Math.sqrt(maxV2);
  let pen = 0;
  if (hadSdf) {
    const dc = state.dCache;
    const cl = state.clearance;
    for (let v = 0; v < state.V; v++) {
      const p = cl[v] - dc[v];
      if (p > pen) pen = p;
    }
  }
  st.maxPenetration_mm = pen * 1000;
  const S = state.sRest0.length;
  let gMax = 0;
  let gSum = 0;
  const pos = state.pos;
  for (let s = 0; s < S; s++) {
    const i = state.sIdx[2 * s];
    const j = state.sIdx[2 * s + 1];
    const dx = pos[3 * i] - pos[3 * j];
    const dy = pos[3 * i + 1] - pos[3 * j + 1];
    const dz = pos[3 * i + 2] - pos[3 * j + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > gMax) gMax = d;
    gSum += d;
  }
  st.seamGapMax_mm = gMax * 1000;
  st.seamGapMean_mm = S > 0 ? (gSum / S) * 1000 : 0;
  st.nanCount = state.nanCount;
  st.running = running;
  st.substeps = state.params.substeps;
  st.sectionMs.integrate = t.integrate;
  st.sectionMs.distance = t.distance;
  st.sectionMs.bend = t.bend;
  st.sectionMs.seam = t.seam;
  st.sectionMs.collide = t.collide;
  st.sectionMs.self = t.self;
  return st;
}
