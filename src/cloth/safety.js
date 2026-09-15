// src/cloth/safety.js — NaN guard, snapshots (SPEC section 7.8). Clamps live in solver.js (integration).

/** @typedef {import('../core/types.js').ClothState} ClothState */

/**
 * Restore every non-finite vertex (pos or vel) from the last snapshot (or restPos when none), vel = 0.
 * Adds the count to state.nanCount and returns it.
 * @param {ClothState} state @param {import('./state.js').ClothAux} aux @returns {number}
 */
export function guardNaN(state, aux) {
  const { V, pos, prev, vel, restPos } = state;
  const snap = aux.snap;
  const src = snap.valid ? snap.pos : restPos;
  let count = 0;
  for (let v = 0; v < V; v++) {
    const v3 = 3 * v;
    const x = pos[v3];
    const y = pos[v3 + 1];
    const z = pos[v3 + 2];
    const vx = vel[v3];
    const vy = vel[v3 + 1];
    const vz = vel[v3 + 2];
    if (x - x === 0 && y - y === 0 && z - z === 0 && vx - vx === 0 && vy - vy === 0 && vz - vz === 0) continue;
    pos[v3] = src[v3];
    pos[v3 + 1] = src[v3 + 1];
    pos[v3 + 2] = src[v3 + 2];
    prev[v3] = src[v3];
    prev[v3 + 1] = src[v3 + 1];
    prev[v3 + 2] = src[v3 + 2];
    vel[v3] = 0;
    vel[v3 + 1] = 0;
    vel[v3 + 2] = 0;
    count++;
  }
  state.nanCount += count;
  return count;
}

/**
 * Whole-state restore from the internal snapshot (or restPos when none). Used after two NaN frames in a row.
 * @param {ClothState} state @param {import('./state.js').ClothAux} aux
 */
export function restoreWhole(state, aux) {
  const snap = aux.snap;
  if (snap.valid) {
    state.pos.set(snap.pos);
    state.prev.set(snap.pos);
    state.vel.set(snap.vel);
    state.time = snap.time;
    state.frame = snap.frame;
  } else {
    state.pos.set(state.restPos);
    state.prev.set(state.restPos);
    state.vel.fill(0);
  }
}

/**
 * Every 60 frames, with nanCount unchanged since the last check and maxSpeed < 0.9·params.maxSpeed, copy the state
 * into the internal snapshot.
 * @param {ClothState} state @param {import('./state.js').ClothAux} aux @param {number} maxSpeed
 */
export function maybeSnapshot(state, aux, maxSpeed) {
  if (state.frame % 60 !== 0) return;
  const unchanged = state.nanCount === aux.nanAtLastCheck;
  aux.nanAtLastCheck = state.nanCount;
  if (!unchanged) return;
  if (!(maxSpeed < 0.9 * state.params.maxSpeed)) return;
  const snap = aux.snap;
  snap.pos.set(state.pos);
  snap.vel.set(state.vel);
  snap.time = state.time;
  snap.frame = state.frame;
  snap.valid = true;
}

/**
 * Copy of the live {frame, time, pos, vel}.
 * @param {ClothState} state @returns {{frame:number, time:number, pos:Float32Array, vel:Float32Array}}
 */
export function snapshot(state) {
  return { frame: state.frame, time: state.time, pos: new Float32Array(state.pos), vel: new Float32Array(state.vel) };
}

/**
 * Copies a snapshot back (E_BAD_ARG if snap.pos.length !== 3V); it also becomes the internal recovery snapshot.
 * @param {ClothState} state @param {import('./state.js').ClothAux} aux
 * @param {{frame:number, time:number, pos:Float32Array, vel:Float32Array}} snap
 */
export function restore(state, aux, snap) {
  if (!snap || !snap.pos || snap.pos.length !== 3 * state.V || !snap.vel || snap.vel.length !== 3 * state.V) {
    const err = /** @type {Error & {code:string}} */ (new Error('restore: snapshot does not match the state (3V = ' + 3 * state.V + ')'));
    err.code = 'E_BAD_ARG';
    throw err;
  }
  state.pos.set(snap.pos);
  state.prev.set(snap.pos);
  state.vel.set(snap.vel);
  state.frame = Number.isFinite(snap.frame) ? snap.frame : 0;
  state.time = Number.isFinite(snap.time) ? snap.time : 0;
  aux.snap.pos.set(snap.pos);
  aux.snap.vel.set(snap.vel);
  aux.snap.frame = state.frame;
  aux.snap.time = state.time;
  aux.snap.valid = true;
  aux.nanStreak = 0;
  guardNaN(state, aux);
}
