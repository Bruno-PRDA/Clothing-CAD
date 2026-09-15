// src/cloth/state.js — build the solver state (SPEC section 7.1) and the in-place parameter rewrites.
// Pure: imports only src/core. Flat typed arrays; the side table (WeakMap) keeps everything ClothState does not type.

import { sampleSdf } from '../core/sdf.js';
import { bendingCoefficients } from './constraints.js';
import { createHash } from './hash.js';
import { createStats } from './stats.js';
import { buildRestGraph, pickAnchors, geodesicToAnchors } from './lra.js';

/** @typedef {import('../core/types.js').ClothState} ClothState */
/** @typedef {import('../core/types.js').PieceMesh} PieceMesh */
/** @typedef {import('../core/types.js').ProjectDoc} ProjectDoc */
/** @typedef {import('../core/types.js').FabricResolved} FabricResolved */
/** @typedef {import('../core/types.js').SimSettings} SimSettings */
/** @typedef {import('../core/types.js').SimStats} SimStats */
/** @typedef {import('../core/types.js').SdfGrid} SdfGrid */
/** @typedef {import('../core/types.js').Vec3} Vec3 */

const SQRT3 = Math.sqrt(3);
export const SEAM_ALPHA = 1e-8;

/**
 * Side table entry: everything the solver needs that ClothState does not type (SPEC 7.1 step 2, 7.8, 7.9).
 * @typedef {Object} ClothAux
 * @property {Float32Array} vertexArea        V, m²
 * @property {number} collisionOffset_mm
 * @property {Float32Array} gravityDir        unit vector (default 0,-1,0); fixtures may rotate it
 * @property {Uint8Array} pinMask             V, 1 = pinned
 * @property {Uint8Array} seamMask            V, 1 = within 2 edge-rings of a seam vertex
 * @property {number} selfMaskedPairs         instrumented counter: self-collision pairs processed with both vertices masked
 * @property {{valid:boolean, frame:number, time:number, pos:Float32Array, vel:Float32Array}} snap
 * @property {number} nanStreak
 * @property {number} nanAtLastCheck
 * @property {ReturnType<typeof createHash>} hash
 * @property {Uint8Array} pairCount
 * @property {SimStats} stats
 * @property {Float64Array} msRing
 * @property {number} msRingN
 * @property {number} msRingI
 * @property {{integrate:number, distance:number, bend:number, seam:number, collide:number, self:number}} timers
 * @property {boolean} hadSdf
 * @property {Float32Array} grad
 * @property {{start:Uint32Array, list:Uint32Array, w:Float32Array}|null} restGraph  2-ring rest graph (lazy, lra.js)
 * @property {Uint32Array} lraAnchors     up to LRA_ANCHORS pinned vertices
 * @property {Float32Array} lraDist       V*anchors geodesic rest bounds, Infinity = unreachable
 * @property {boolean} lraDirty           rebuild the two above before the next step
 */

/** @type {WeakMap<ClothState, ClothAux>} */
const AUX = new WeakMap();

/**
 * @param {string} reason @param {string} message @param {Object} [extra]
 * @returns {Error & {code:string, reason:string}}
 */
export function clothError(reason, message, extra) {
  const err = /** @type {Error & {code:string, reason:string}} */ (new Error(message));
  err.code = 'ClothBuildError';
  err.reason = reason;
  if (extra) Object.assign(err, extra);
  return err;
}

/** @param {ClothState} state @returns {ClothAux} */
export function getAux(state) {
  const a = AUX.get(state);
  if (!a) throw clothError('bad-state', 'cloth: state was not produced by buildCloth');
  return a;
}

/**
 * The long-range-attachment table depends on the pin set and on the pin targets; anything that touches either
 * marks it stale and `refreshLra` rebuilds it once, before the next step.
 * @param {ClothAux} aux
 */
function markLraDirty(aux) { aux.lraDirty = true; }

/**
 * Rebuild `aux.lraAnchors` / `aux.lraDist` when stale (no work when the pin set is unchanged). The rest graph
 * itself never changes, so it is built once per state.
 * @param {ClothState} state @param {ClothAux} aux
 */
export function refreshLra(state, aux) {
  if (!aux.lraDirty) return;
  aux.lraDirty = false;
  if (state.pIdx.length === 0) {
    aux.lraAnchors = new Uint32Array(0);
    aux.lraDist = new Float32Array(0);
    return;
  }
  if (!aux.restGraph) aux.restGraph = buildRestGraph(state);
  aux.lraAnchors = pickAnchors(state);
  aux.lraDist = geodesicToAnchors(state, aux.restGraph, aux.lraAnchors);
}

/** @returns {SimSettings} */
function defaultSim() {
  return { substeps: 10, gravity_ms2: 9.81, selfCollision: true, sewTime_s: 1.0, collisionOffset_mm: 5, bendScale: 1, stretchScale: 1 };
}

/** @param {*} v @param {number} d @returns {number} */
function num(v, d) { return (typeof v === 'number' && Number.isFinite(v)) ? v : d; }

/** @param {ClothState} state @param {number} pieceIndex @param {FabricResolved} fabric @returns {number} clearance metres */
function clearanceOf(aux, fabric, layer) {
  return aux.collisionOffset_mm / 1000 + fabric.physics.thickness_mm / 2000 + 0.003 * layer;
}

/** @param {number} Y @param {number} stretchScale @returns {number} */
function edgeAlpha(Y, stretchScale) {
  const y = Math.max(1e-6, Y * Math.max(1e-6, stretchScale));
  return 2 / (SQRT3 * y);
}

/** @param {number} B @param {number} bendScale @returns {number} */
function bendAlpha(B, bendScale) {
  const b = Math.max(1e-12, B * Math.max(1e-6, bendScale));
  return 1 / b;
}

/**
 * @param {{meshes: PieceMesh[], doc: ProjectDoc, fabrics: Map<string, FabricResolved>}} args
 * @returns {ClothState}
 */
export function buildCloth(args) {
  if (!args || !Array.isArray(args.meshes) || !args.doc || !args.fabrics || typeof args.fabrics.get !== 'function') {
    throw clothError('args', 'buildCloth: expected {meshes, doc, fabrics}');
  }
  const { meshes, doc, fabrics } = args;
  const sim = Object.assign(defaultSim(), doc.sim || {});
  const docPieces = Array.isArray(doc.pieces) ? doc.pieces : [];
  const docSeams = Array.isArray(doc.seams) ? doc.seams : [];

  // 1. pieces and vertex ranges
  /** @type {ClothState['pieces']} */
  const pieces = [];
  /** @type {Map<string, number>} */
  const pieceIndexById = new Map();
  /** @type {Map<string, import('../core/types.js').Piece>} */
  const docPieceById = new Map();
  let V = 0;
  for (const mesh of meshes) {
    if (!mesh || typeof mesh.pieceId !== 'string') throw clothError('mesh', 'buildCloth: bad PieceMesh');
    const piece = docPieces.find((p) => p.id === mesh.pieceId);
    if (!piece) throw clothError('piece', 'buildCloth: no piece ' + mesh.pieceId + ' in doc', { pieceId: mesh.pieceId });
    const fabric = fabrics.get(piece.fabricId);
    if (!fabric) throw clothError('fabric', 'buildCloth: piece ' + piece.id + ' has no resolved fabric ' + String(piece.fabricId), { pieceId: piece.id });
    const count = mesh.vertexCount | 0;
    if (count <= 0 || mesh.positions2d.length < 2 * count) throw clothError('mesh', 'buildCloth: empty mesh for ' + piece.id, { pieceId: piece.id });
    pieceIndexById.set(piece.id, pieces.length);
    docPieceById.set(piece.id, piece);
    pieces.push({ start: V, count, pieceId: piece.id, mesh, fabric, layer: Math.max(0, num(piece.layer, 0) | 0) });
    V += count;
  }
  if (V === 0) throw clothError('empty', 'buildCloth: no simulated pieces');
  if (V > 65535) throw clothError('too-large', 'buildCloth: more than 65535 vertices');

  const pos = new Float32Array(3 * V);
  const prev = new Float32Array(3 * V);
  const vel = new Float32Array(3 * V);
  const invMass = new Float32Array(V);
  const restPos = new Float32Array(3 * V);
  const pieceOf = new Uint16Array(V);
  const clearance = new Float32Array(V);
  const mu = new Float32Array(V);
  const damp = new Float32Array(V);
  const dCache = new Float32Array(V);
  const vertexArea = new Float32Array(V);
  dCache.fill(1);

  // 2. per-vertex area, masses, per-vertex fabric scalars; 3/4/tris counts
  let T = 0;
  let E = 0;
  let B = 0;
  for (let k = 0; k < pieces.length; k++) {
    const pc = pieces[k];
    const m = pc.mesh;
    const p2 = m.positions2d;
    const tri = m.triangles;
    for (let v = 0; v < pc.count; v++) pieceOf[pc.start + v] = k;
    for (let t = 0; t < tri.length; t += 3) {
      const a = tri[t];
      const b = tri[t + 1];
      const c = tri[t + 2];
      const ax = p2[2 * a];
      const ay = p2[2 * a + 1];
      const area = Math.abs((p2[2 * b] - ax) * (p2[2 * c + 1] - ay) - (p2[2 * c] - ax) * (p2[2 * b + 1] - ay)) * 0.5 * 1e-6;
      vertexArea[pc.start + a] += area / 3;
      vertexArea[pc.start + b] += area / 3;
      vertexArea[pc.start + c] += area / 3;
    }
    T += tri.length / 3;
    E += m.edges.length / 2;
    B += (m.bendPairs ? m.bendPairs.length : 0) / 4;
  }
  const meanArea = (() => { let s = 0; for (let v = 0; v < V; v++) s += vertexArea[v]; return s / V; })();
  for (let v = 0; v < V; v++) if (!(vertexArea[v] > 0)) vertexArea[v] = meanArea > 0 ? meanArea : 1e-6;

  /** @type {ClothAux} */
  const aux = {
    vertexArea,
    collisionOffset_mm: num(sim.collisionOffset_mm, 5),
    gravityDir: new Float32Array([0, -1, 0]),
    pinMask: new Uint8Array(V),
    seamMask: new Uint8Array(V),
    selfMaskedPairs: 0,
    snap: { valid: false, frame: 0, time: 0, pos: new Float32Array(3 * V), vel: new Float32Array(3 * V) },
    nanStreak: 0,
    nanAtLastCheck: 0,
    hash: createHash(V),
    pairCount: new Uint8Array(V),
    stats: createStats(),
    msRing: new Float64Array(60),
    msRingN: 0,
    msRingI: 0,
    timers: { integrate: 0, distance: 0, bend: 0, seam: 0, collide: 0, self: 0 },
    hadSdf: false,
    grad: new Float32Array(3),
    restGraph: null,
    lraAnchors: new Uint32Array(0),
    lraDist: new Float32Array(0),
    lraDirty: true,
    /** per-edge XPBD Lagrange multiplier, zeroed at the start of every substep (SPEC 7.2 amendment) */
    eLambda: new Float32Array(E),
  };

  const bendScale = num(sim.bendScale, 1);
  const stretchScale = num(sim.stretchScale, 1);
  for (let k = 0; k < pieces.length; k++) {
    const pc = pieces[k];
    const ph = pc.fabric.physics;
    const cl = clearanceOf(aux, pc.fabric, pc.layer);
    for (let v = pc.start; v < pc.start + pc.count; v++) {
      invMass[v] = 1 / (Math.max(1e-6, ph.density_kgm2) * vertexArea[v]);
      clearance[v] = cl;
      mu[v] = ph.friction;
      damp[v] = ph.damping;
    }
  }

  // 3. edges, 4. bending, triangles (global ids)
  const tris = new Uint32Array(3 * T);
  const eIdx = new Uint32Array(2 * E);
  const eRest = new Float32Array(E);
  const eAlpha = new Float32Array(E);
  const bIdx = new Uint32Array(4 * B);
  const bK = new Float32Array(4 * B);
  const bS = new Float32Array(B);
  const bAlpha = new Float32Array(B);
  let ti = 0;
  let ei = 0;
  let bi = 0;
  let hMin = Infinity;
  for (let k = 0; k < pieces.length; k++) {
    const pc = pieces[k];
    const m = pc.mesh;
    const p2 = m.positions2d;
    const s0 = pc.start;
    const ph = pc.fabric.physics;
    const ea = edgeAlpha(ph.membrane_Nm, stretchScale);
    const ba = bendAlpha(ph.bend_Nm, bendScale);
    for (let t = 0; t < m.triangles.length; t++) tris[ti++] = s0 + m.triangles[t];
    const med = (m.quality && Number.isFinite(m.quality.medianEdge_mm) && m.quality.medianEdge_mm > 0) ? m.quality.medianEdge_mm / 1000 : 0;
    let sumLen = 0;
    let nLen = 0;
    for (let e = 0; e < m.edges.length; e += 2) {
      const a = m.edges[e];
      const b = m.edges[e + 1];
      const dx = p2[2 * a] - p2[2 * b];
      const dy = p2[2 * a + 1] - p2[2 * b + 1];
      const L = Math.sqrt(dx * dx + dy * dy) / 1000;
      eIdx[2 * ei] = s0 + a;
      eIdx[2 * ei + 1] = s0 + b;
      eRest[ei] = L;
      eAlpha[ei] = ea;
      sumLen += L;
      nLen++;
      ei++;
    }
    const hPiece = med > 0 ? med : (nLen > 0 ? sumLen / nLen : 0.015);
    if (hPiece < hMin) hMin = hPiece;
    const bp = m.bendPairs || new Uint32Array(0);
    for (let b = 0; b < bp.length; b += 4) {
      const v0 = bp[b];
      const v1 = bp[b + 1];
      const v2 = bp[b + 2];
      const v3 = bp[b + 3];
      bIdx[4 * bi] = s0 + v0;
      bIdx[4 * bi + 1] = s0 + v1;
      bIdx[4 * bi + 2] = s0 + v2;
      bIdx[4 * bi + 3] = s0 + v3;
      const s = bendingCoefficients(
        p2[2 * v0] / 1000, p2[2 * v0 + 1] / 1000, p2[2 * v1] / 1000, p2[2 * v1 + 1] / 1000,
        p2[2 * v2] / 1000, p2[2 * v2 + 1] / 1000, p2[2 * v3] / 1000, p2[2 * v3 + 1] / 1000,
        bK, 4 * bi);
      bS[bi] = s;
      bAlpha[bi] = ba;
      bi++;
    }
  }
  if (!Number.isFinite(hMin)) hMin = 0.015;

  // 5. seams
  /** @type {number[]} */
  const seamPairs = [];
  for (const seam of docSeams) {
    if (!seam || !seam.a || !seam.b) continue;
    const ka = pieceIndexById.get(seam.a.pieceId);
    const kb = pieceIndexById.get(seam.b.pieceId);
    if (ka === undefined || kb === undefined) continue; // a side is not simulated
    const ma = pieces[ka].mesh;
    const mb = pieces[kb].mesh;
    const va = (ma.edgeVerts[seam.a.mirror ? 1 : 0] || [])[seam.a.edge];
    const vb = (mb.edgeVerts[seam.b.mirror ? 1 : 0] || [])[seam.b.edge];
    if (!va || !vb) {
      throw clothError('seam-edge', 'buildCloth: seam ' + seam.id + ' references a missing edge sample list', { seamId: seam.id });
    }
    if (va.length !== vb.length || va.length < 2) {
      throw clothError('seam-parity', 'buildCloth: seam ' + seam.id + ' sides have ' + va.length + ' / ' + vb.length + ' vertices', { seamId: seam.id });
    }
    const reverse = !!(seam.a.reverse || seam.b.reverse);
    const N = va.length;
    for (let i = 0; i < N; i++) {
      const gi = pieces[ka].start + va[i];
      const gj = pieces[kb].start + vb[reverse ? N - 1 - i : i];
      if (gi === gj) continue;
      seamPairs.push(gi, gj);
    }
  }
  const S = seamPairs.length / 2;
  const sIdx = new Uint32Array(seamPairs);
  const sRest0 = new Float32Array(S);
  const sStart = new Float32Array(S);

  // 6. pins
  /** @type {number[]} */
  const pinList = [];
  for (let k = 0; k < pieces.length; k++) {
    const pc = pieces[k];
    const piece = docPieceById.get(pc.pieceId);
    const pe = (piece && Array.isArray(piece.pinnedEdges)) ? piece.pinnedEdges : [];
    for (const e of pe) {
      for (let mIdx = 0; mIdx < 2; mIdx++) {
        const list = (pc.mesh.edgeVerts[mIdx] || [])[e];
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const g = pc.start + list[i];
          if (!aux.pinMask[g]) { aux.pinMask[g] = 1; pinList.push(g); }
        }
      }
    }
  }
  const pIdx = new Uint32Array(pinList);
  const pTarget = new Float32Array(3 * pinList.length);
  for (let i = 0; i < pIdx.length; i++) invMass[pIdx[i]] = 0;

  // 7. self-collision exclusions (CSR, sorted)
  /** @type {number[][]} */
  const nbr = new Array(V);
  for (let v = 0; v < V; v++) nbr[v] = [];
  for (let e = 0; e < E; e++) {
    const a = eIdx[2 * e];
    const b = eIdx[2 * e + 1];
    nbr[a].push(b);
    nbr[b].push(a);
  }
  /** @type {Set<number>[]} */
  const excl = new Array(V);
  for (let v = 0; v < V; v++) excl[v] = new Set(nbr[v]);
  /** @param {number} v @returns {number[]} */
  const ring2 = (v) => {
    const set = new Set([v]);
    for (const a of nbr[v]) { set.add(a); for (const b of nbr[a]) set.add(b); }
    return Array.from(set);
  };
  for (let s = 0; s < S; s++) {
    const i = sIdx[2 * s];
    const j = sIdx[2 * s + 1];
    excl[i].add(j);
    excl[j].add(i);
    const ri = ring2(i);
    const rj = ring2(j);
    for (const a of ri) aux.seamMask[a] = 1;
    for (const b of rj) aux.seamMask[b] = 1;
    for (const a of ri) {
      const ea = excl[a];
      for (const b of rj) {
        if (a === b) continue;
        ea.add(b);
        excl[b].add(a);
      }
    }
  }
  const exclStart = new Uint32Array(V + 1);
  let total = 0;
  for (let v = 0; v < V; v++) { exclStart[v] = total; total += excl[v].size; }
  exclStart[V] = total;
  const exclList = new Uint32Array(total);
  for (let v = 0; v < V; v++) {
    const arr = Array.from(excl[v]).sort((a, b) => a - b);
    exclList.set(arr, exclStart[v]);
  }

  // 8. params
  let selfDist = 0.004;
  for (const pc of pieces) selfDist = Math.max(selfDist, (pc.fabric.physics.thickness_mm + 3) / 1000);
  const params = {
    dt: 1 / 60,
    substeps: Math.max(1, num(sim.substeps, 10) | 0),
    gravity: num(sim.gravity_ms2, 9.81),
    sewTime: Math.max(0, num(sim.sewTime_s, 1)),
    selfCollision: !!sim.selfCollision,
    selfDist,
    maxSpeed: 5,
    maxStep: Math.min(0.5 * hMin, 0.008),
    bendScale,
    stretchScale,
  };

  /** @type {ClothState} */
  const state = {
    V, pos, prev, vel, invMass, restPos, pieceOf, clearance, mu, damp, dCache,
    tris, eIdx, eRest, eAlpha, bIdx, bK, bS, bAlpha, sIdx, sRest0, sStart, pIdx, pTarget,
    exclStart, exclList, pieces, params, time: 0, frame: 0, nanCount: 0,
  };
  AUX.set(state, aux);
  aux.stats.verts = V;
  aux.stats.tris = T;
  aux.stats.constraints = E + B + S;
  aux.stats.substeps = params.substeps;
  return state;
}

/**
 * Rewrites invMass (keeping 0 for pins), clearance, mu, damp, eAlpha, bAlpha of that piece in place.
 * @param {ClothState} state @param {number} pieceIndex @param {FabricResolved} fabric
 */
export function setFabricParams(state, pieceIndex, fabric) {
  const aux = getAux(state);
  const pc = state.pieces[pieceIndex];
  if (!pc) throw clothError('piece', 'setFabricParams: no piece index ' + pieceIndex);
  if (!fabric || !fabric.physics) throw clothError('fabric', 'setFabricParams: bad fabric');
  pc.fabric = fabric;
  const ph = fabric.physics;
  const cl = clearanceOf(aux, fabric, pc.layer);
  const end = pc.start + pc.count;
  for (let v = pc.start; v < end; v++) {
    state.invMass[v] = aux.pinMask[v] ? 0 : 1 / (Math.max(1e-6, ph.density_kgm2) * aux.vertexArea[v]);
    state.clearance[v] = cl;
    state.mu[v] = ph.friction;
    state.damp[v] = ph.damping;
  }
  const ea = edgeAlpha(ph.membrane_Nm, state.params.stretchScale);
  const ba = bendAlpha(ph.bend_Nm, state.params.bendScale);
  const E = state.eRest.length;
  for (let e = 0; e < E; e++) if (state.pieceOf[state.eIdx[2 * e]] === pieceIndex) state.eAlpha[e] = ea;
  const B = state.bS.length;
  for (let b = 0; b < B; b++) if (state.pieceOf[state.bIdx[4 * b]] === pieceIndex) state.bAlpha[b] = ba;
  let selfDist = 0.004;
  for (const p of state.pieces) selfDist = Math.max(selfDist, (p.fabric.physics.thickness_mm + 3) / 1000);
  state.params.selfDist = selfDist;
}

/**
 * substeps, gravity, sewTime, selfCollision, collisionOffset → clearance rewrite, bendScale/stretchScale → setScale.
 * @param {ClothState} state @param {SimSettings} simSettings
 */
export function setSettings(state, simSettings) {
  const aux = getAux(state);
  const s = simSettings || {};
  const p = state.params;
  if (Number.isFinite(s.substeps)) p.substeps = Math.max(1, s.substeps | 0);
  if (Number.isFinite(s.gravity_ms2)) p.gravity = s.gravity_ms2;
  if (Number.isFinite(s.sewTime_s)) p.sewTime = Math.max(0, s.sewTime_s);
  if (typeof s.selfCollision === 'boolean') p.selfCollision = s.selfCollision;
  if (Number.isFinite(s.collisionOffset_mm) && s.collisionOffset_mm !== aux.collisionOffset_mm) {
    aux.collisionOffset_mm = s.collisionOffset_mm;
    for (const pc of state.pieces) {
      const cl = clearanceOf(aux, pc.fabric, pc.layer);
      for (let v = pc.start; v < pc.start + pc.count; v++) state.clearance[v] = cl;
    }
  }
  const bend = Number.isFinite(s.bendScale) ? s.bendScale : p.bendScale;
  const stretch = Number.isFinite(s.stretchScale) ? s.stretchScale : p.stretchScale;
  if (bend !== p.bendScale || stretch !== p.stretchScale) setScale(state, bend, stretch);
  aux.stats.substeps = p.substeps;
}

/**
 * Rewrites every bAlpha/eAlpha from the fabric values (scale semantics of types.js: the scales multiply the stiffness).
 * @param {ClothState} state @param {number} bend @param {number} stretch
 */
export function setScale(state, bend, stretch) {
  getAux(state);
  const p = state.params;
  p.bendScale = Number.isFinite(bend) && bend > 0 ? bend : 1;
  p.stretchScale = Number.isFinite(stretch) && stretch > 0 ? stretch : 1;
  const E = state.eRest.length;
  const B = state.bS.length;
  for (let k = 0; k < state.pieces.length; k++) {
    const ph = state.pieces[k].fabric.physics;
    const ea = edgeAlpha(ph.membrane_Nm, p.stretchScale);
    const ba = bendAlpha(ph.bend_Nm, p.bendScale);
    for (let e = 0; e < E; e++) if (state.pieceOf[state.eIdx[2 * e]] === k) state.eAlpha[e] = ea;
    for (let b = 0; b < B; b++) if (state.pieceOf[state.bIdx[4 * b]] === k) state.bAlpha[b] = ba;
  }
}

/**
 * Pin vertex v to target (invMass = 0; appended to pIdx/pTarget, or the target is updated when already pinned).
 * @param {ClothState} state @param {number} v @param {Vec3} target
 */
export function setPin(state, v, target) {
  const aux = getAux(state);
  if (!(v >= 0 && v < state.V)) throw clothError('E_BAD_ARG', 'setPin: bad vertex ' + v);
  if (!target || target.length < 3) throw clothError('E_BAD_ARG', 'setPin: bad target');
  let slot = -1;
  for (let i = 0; i < state.pIdx.length; i++) if (state.pIdx[i] === v) { slot = i; break; }
  if (slot < 0) {
    const P = state.pIdx.length;
    const nIdx = new Uint32Array(P + 1);
    const nT = new Float32Array(3 * (P + 1));
    nIdx.set(state.pIdx);
    nT.set(state.pTarget);
    nIdx[P] = v;
    state.pIdx = nIdx;
    state.pTarget = nT;
    slot = P;
  }
  state.pTarget[3 * slot] = target[0];
  state.pTarget[3 * slot + 1] = target[1];
  state.pTarget[3 * slot + 2] = target[2];
  state.invMass[v] = 0;
  aux.pinMask[v] = 1;
  markLraDirty(aux);
  state.pos[3 * v] = target[0];
  state.pos[3 * v + 1] = target[1];
  state.pos[3 * v + 2] = target[2];
  state.prev[3 * v] = target[0];
  state.prev[3 * v + 1] = target[1];
  state.prev[3 * v + 2] = target[2];
  state.restPos[3 * v] = target[0];
  state.restPos[3 * v + 1] = target[1];
  state.restPos[3 * v + 2] = target[2];
  state.vel[3 * v] = 0;
  state.vel[3 * v + 1] = 0;
  state.vel[3 * v + 2] = 0;
}

/**
 * Release a pinned vertex (invMass restored from the fabric density). Extra export used by debugApi.sim.unpin.
 * @param {ClothState} state @param {number} v
 */
export function clearPin(state, v) {
  const aux = getAux(state);
  let slot = -1;
  for (let i = 0; i < state.pIdx.length; i++) if (state.pIdx[i] === v) { slot = i; break; }
  if (slot < 0) return;
  const P = state.pIdx.length;
  const nIdx = new Uint32Array(P - 1);
  const nT = new Float32Array(3 * (P - 1));
  let w = 0;
  for (let i = 0; i < P; i++) {
    if (i === slot) continue;
    nIdx[w] = state.pIdx[i];
    nT[3 * w] = state.pTarget[3 * i];
    nT[3 * w + 1] = state.pTarget[3 * i + 1];
    nT[3 * w + 2] = state.pTarget[3 * i + 2];
    w++;
  }
  state.pIdx = nIdx;
  state.pTarget = nT;
  aux.pinMask[v] = 0;
  markLraDirty(aux);
  const pc = state.pieces[state.pieceOf[v]];
  state.invMass[v] = 1 / (Math.max(1e-6, pc.fabric.physics.density_kgm2) * aux.vertexArea[v]);
}

/**
 * Set the gravity direction (unit vector; default [0,-1,0]). Extra export used by the slope fixture.
 * @param {ClothState} state @param {Vec3} dir
 */
export function setGravityDir(state, dir) {
  const aux = getAux(state);
  const n = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  aux.gravityDir[0] = dir[0] / n;
  aux.gravityDir[1] = dir[1] / n;
  aux.gravityDir[2] = dir[2] / n;
}

/**
 * Finish an arrangement whose positions are already in state.pos: prev = restPos = pos, vel = 0, time = frame = 0,
 * sRest0 = pair distance, sStart = 0, pTarget = pinned positions (projected to d = clearance + 1 mm when an sdf is given),
 * dCache = sampled distance (1 without sdf). Used by arrange() and by the fixtures.
 * @param {ClothState} state @param {SdfGrid|null} sdf
 */
export function commitPositions(state, sdf) {
  const aux = getAux(state);
  const { V, pos, prev, vel, restPos } = state;
  prev.set(pos);
  restPos.set(pos);
  vel.fill(0);
  state.time = 0;
  state.frame = 0;
  aux.nanStreak = 0;
  aux.snap.valid = false;
  // A seam pair whose two vertices are both pinned can never be closed by the solver: `solveSeams` skips it
  // (Σw = 0) and `applyPins` then holds the two halves apart at whatever distance the arrangement left — on the
  // sample skirt that pinned the two ends of the waist seam 74.5 mm apart forever, which alone was the whole of
  // `seamGapMax_mm`. Such a pair is welded here, before the pin targets are projected onto the body, so both ends
  // project from the same point and land on the same target.
  const grad = aux.grad;
  if (state.pIdx.length > 0) {
    const slot = new Int32Array(V).fill(-1);
    for (let p = 0; p < state.pIdx.length; p++) slot[state.pIdx[p]] = p;
    for (let s = 0; s < state.sRest0.length; s++) {
      const i = state.sIdx[2 * s];
      const j = state.sIdx[2 * s + 1];
      if (slot[i] < 0 || slot[j] < 0) continue;
      const mx = 0.5 * (pos[3 * i] + pos[3 * j]);
      const my = 0.5 * (pos[3 * i + 1] + pos[3 * j + 1]);
      const mz = 0.5 * (pos[3 * i + 2] + pos[3 * j + 2]);
      pos[3 * i] = mx; pos[3 * i + 1] = my; pos[3 * i + 2] = mz;
      pos[3 * j] = mx; pos[3 * j + 1] = my; pos[3 * j + 2] = mz;
    }
  }
  for (let p = 0; p < state.pIdx.length; p++) {
    const v = state.pIdx[p];
    let x = pos[3 * v];
    let y = pos[3 * v + 1];
    let z = pos[3 * v + 2];
    if (sdf) {
      const target = state.clearance[v] + 0.001;
      for (let it = 0; it < 3; it++) {
        const d = sampleSdf(sdf, x, y, z, grad);
        if (d >= 1) break;
        x -= (d - target) * grad[0];
        y -= (d - target) * grad[1];
        z -= (d - target) * grad[2];
      }
    }
    state.pTarget[3 * p] = x;
    state.pTarget[3 * p + 1] = y;
    state.pTarget[3 * p + 2] = z;
    pos[3 * v] = x; pos[3 * v + 1] = y; pos[3 * v + 2] = z;
    prev[3 * v] = x; prev[3 * v + 1] = y; prev[3 * v + 2] = z;
    restPos[3 * v] = x; restPos[3 * v + 1] = y; restPos[3 * v + 2] = z;
  }
  for (let s = 0; s < state.sRest0.length; s++) {
    const i = state.sIdx[2 * s];
    const j = state.sIdx[2 * s + 1];
    const dx = pos[3 * i] - pos[3 * j];
    const dy = pos[3 * i + 1] - pos[3 * j + 1];
    const dz = pos[3 * i + 2] - pos[3 * j + 2];
    state.sRest0[s] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    state.sStart[s] = 0;
  }
  for (let v = 0; v < V; v++) {
    state.dCache[v] = sdf ? sampleSdf(sdf, pos[3 * v], pos[3 * v + 1], pos[3 * v + 2], null) : 1;
  }
  markLraDirty(aux);
}
