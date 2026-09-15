// src/cloth/lra.js — long-range attachments (SPEC 7.2 "pins", extended).
//
// Why this exists. With λ reset every substep and one Gauss–Seidel pass (SPEC 7.3) an XPBD distance constraint
// reaches its steady state when the per-substep correction cancels gravity, i.e. when
//     C = (α + h²·Σw|∇C|²) · T        (T = tension carried by the edge)
// so the solver behaves as if every edge had an EXTRA compliance α_num = h²·Σw on top of the material α = 2/(√3·Y).
// For the 10 mm cotton sheet of 7.11, α = 1.44e-4 m/N while α_num = h²·2/(ρ·A_v) = 0.37 m/N — 2500× larger.
// Under a point pin (T ≈ W/2) that is ~11 mm of stretch on an 11 mm edge: the 103 % strain of acceptance #3.
// More Gauss–Seidel passes only shrink it as ~1/iterations (60 passes per substep are needed for < 3 %), and more
// substeps only as h², so neither fits the 7.12 budget.
//
// The fix is the standard long-range attachment (Kim et al. 2012): for a vertex v and an attachment a the
// inextensibility of the sheet implies the HARD inequality |x_v − x_a| ≤ geo(v, a), where geo is the geodesic
// distance in the flat rest mesh. Projecting it costs one sqrt per vertex per anchor, the attachment has w = 0 so a
// single projection satisfies it exactly, and being one-sided it never resists folding, buckling or wrinkling —
// it only removes stretch the material could not have. geo is computed with Dijkstra over the mesh graph augmented
// with every pair inside LRA_RINGS edge-rings: restricting paths to graph edges can only OVERestimate the true
// geodesic, so the bound stays valid for concave pieces, while the wide stencil removes almost all of the lattice
// anisotropy that makes a 1-ring Dijkstra useless here (12 % too long down the staggered column of 7.11).
//
// Measured on the 7.11 hanging sheet (cotton, 10 mm, 300 frames): max edge strain 103 % without this pass, 2.7 %
// with it, against 2.3 % for a 60-Gauss-Seidel-pass reference solver that costs 60x more.

/** @typedef {import('../core/types.js').ClothState} ClothState */

/** Maximum number of attachment anchors kept per state (cost is K sqrt per vertex per substep). */
export const LRA_ANCHORS = 4;
/** Slack on the geodesic bound, so genuinely elastic fabrics keep their own stretch. */
export const LRA_SLACK = 0.002;
/** Edge-ring radius of the stencil Dijkstra runs on; wider = closer to the true planar geodesic. */
export const LRA_RINGS = 4;

/**
 * Binary min-heap of [key, value] pairs. Preprocessing only (never called from `step`).
 * @returns {{push:(k:number, v:number)=>void, pop:()=>number, size:()=>number, keyOfLastPop:()=>number}}
 */
function makeHeap() {
  /** @type {number[]} */
  const key = [];
  /** @type {number[]} */
  const val = [];
  let lastKey = 0;
  return {
    size: () => key.length,
    keyOfLastPop: () => lastKey,
    push(k, v) {
      key.push(k); val.push(v);
      let i = key.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (key[p] <= key[i]) break;
        const tk = key[p]; key[p] = key[i]; key[i] = tk;
        const tv = val[p]; val[p] = val[i]; val[i] = tv;
        i = p;
      }
    },
    pop() {
      lastKey = key[0];
      const out = val[0];
      const lk = /** @type {number} */ (key.pop());
      const lv = /** @type {number} */ (val.pop());
      if (key.length > 0) {
        key[0] = lk; val[0] = lv;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < key.length && key[l] < key[m]) m = l;
          if (r < key.length && key[r] < key[m]) m = r;
          if (m === i) break;
          const tk = key[m]; key[m] = key[i]; key[i] = tk;
          const tv = val[m]; val[m] = val[i]; val[i] = tv;
          i = m;
        }
      }
      return out;
    },
  };
}

/**
 * CSR of the mesh graph augmented with every pair within `LRA_RINGS` edge-rings, weighted by the straight 2D rest
 * distance in metres. Edges never cross pieces (seams are constraints, not edges), so the graph is per-piece by
 * construction. A wider stencil is what makes Dijkstra's answer close to the true planar geodesic: a 1-ring path
 * down the staggered column of 7.11 overestimates by 11.8 %, 2 rings by 4.5 %, 4 rings by about 1 %.
 * @param {ClothState} state @returns {{start:Uint32Array, list:Uint32Array, w:Float32Array}}
 */
export function buildRestGraph(state) {
  const V = state.V;
  const E = state.eRest.length;
  // 1-ring CSR first.
  const deg = new Uint32Array(V + 1);
  for (let e = 0; e < E; e++) { deg[state.eIdx[2 * e] + 1]++; deg[state.eIdx[2 * e + 1] + 1]++; }
  for (let v = 0; v < V; v++) deg[v + 1] += deg[v];
  const one = new Uint32Array(2 * E);
  const fill = deg.slice(0, V);
  for (let e = 0; e < E; e++) {
    const i = state.eIdx[2 * e];
    const j = state.eIdx[2 * e + 1];
    one[fill[i]++] = j;
    one[fill[j]++] = i;
  }
  // BFS to LRA_RINGS, deduplicated with a stamp array; the frontier is reused between vertices.
  const stamp = new Int32Array(V).fill(-1);
  const frontier = new Uint32Array(V);
  const next = new Uint32Array(V);
  /** @type {number[]} */
  const list = [];
  const start = new Uint32Array(V + 1);
  for (let v = 0; v < V; v++) {
    start[v] = list.length;
    stamp[v] = v;
    let fN = 1;
    frontier[0] = v;
    for (let ring = 0; ring < LRA_RINGS; ring++) {
      let nN = 0;
      for (let f = 0; f < fN; f++) {
        const x = frontier[f];
        for (let a = deg[x]; a < deg[x + 1]; a++) {
          const u = one[a];
          if (stamp[u] === v) continue;
          stamp[u] = v;
          list.push(u);
          next[nN++] = u;
        }
      }
      if (nN === 0) break;
      frontier.set(next.subarray(0, nN));
      fN = nN;
    }
  }
  start[V] = list.length;
  const adj = Uint32Array.from(list);
  const w = new Float32Array(adj.length);
  for (let v = 0; v < V; v++) {
    const pc = state.pieces[state.pieceOf[v]];
    const p2 = pc.mesh.positions2d;
    const lv = 2 * (v - pc.start);
    const xv = p2[lv];
    const yv = p2[lv + 1];
    for (let a = start[v]; a < start[v + 1]; a++) {
      const u = adj[a];
      const lu = 2 * (u - pc.start);
      w[a] = Math.hypot(p2[lu] - xv, p2[lu + 1] - yv) / 1000;
    }
  }
  return { start, list: adj, w };
}

/**
 * Pick up to LRA_ANCHORS pinned vertices, spread out by farthest-point sampling on the pin targets
 * (deterministic: starts at the lowest pin index, ties broken by index).
 * @param {ClothState} state @returns {Uint32Array}
 */
export function pickAnchors(state) {
  const P = state.pIdx.length;
  if (P === 0) return new Uint32Array(0);
  const K = Math.min(LRA_ANCHORS, P);
  const out = new Uint32Array(K);
  const slot = new Uint32Array(K);
  out[0] = state.pIdx[0];
  slot[0] = 0;
  const best = new Float64Array(P);
  for (let p = 0; p < P; p++) {
    const dx = state.pTarget[3 * p] - state.pTarget[0];
    const dy = state.pTarget[3 * p + 1] - state.pTarget[1];
    const dz = state.pTarget[3 * p + 2] - state.pTarget[2];
    best[p] = dx * dx + dy * dy + dz * dz;
  }
  for (let k = 1; k < K; k++) {
    let bp = -1;
    let bd = -1;
    for (let p = 0; p < P; p++) if (best[p] > bd) { bd = best[p]; bp = p; }
    if (bp < 0 || bd <= 0) return out.slice(0, k);
    out[k] = state.pIdx[bp];
    slot[k] = bp;
    const ax = state.pTarget[3 * bp];
    const ay = state.pTarget[3 * bp + 1];
    const az = state.pTarget[3 * bp + 2];
    for (let p = 0; p < P; p++) {
      const dx = state.pTarget[3 * p] - ax;
      const dy = state.pTarget[3 * p + 1] - ay;
      const dz = state.pTarget[3 * p + 2] - az;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best[p]) best[p] = d;
    }
  }
  return out;
}

/**
 * Geodesic rest distance (metres) from every vertex to every anchor, Infinity when unreachable (other piece).
 * @param {ClothState} state @param {{start:Uint32Array, list:Uint32Array, w:Float32Array}} graph
 * @param {Uint32Array} anchors @returns {Float32Array} V*K, row-major by vertex
 */
export function geodesicToAnchors(state, graph, anchors) {
  const V = state.V;
  const K = anchors.length;
  const out = new Float32Array(V * K);
  out.fill(Infinity);
  const d = new Float64Array(V);
  for (let k = 0; k < K; k++) {
    d.fill(Infinity);
    const heap = makeHeap();
    d[anchors[k]] = 0;
    heap.push(0, anchors[k]);
    while (heap.size() > 0) {
      const v = heap.pop();
      const dv = heap.keyOfLastPop();
      if (dv > d[v]) continue;
      for (let a = graph.start[v]; a < graph.start[v + 1]; a++) {
        const u = graph.list[a];
        const nd = dv + graph.w[a];
        if (nd < d[u]) { d[u] = nd; heap.push(nd, u); }
      }
    }
    for (let v = 0; v < V; v++) out[v * K + k] = d[v] < Infinity ? d[v] * (1 + LRA_SLACK) : Infinity;
  }
  return out;
}

/**
 * Project every vertex back onto the ball of radius `dist` around each anchor (the anchors are pinned, w = 0, so one
 * assignment satisfies the constraint exactly). One-sided: a vertex closer than the bound is never touched.
 * @param {Float32Array} pos @param {Float32Array} invMass @param {Uint32Array} anchors @param {Float32Array} dist
 * @param {number} V
 */
export function solveLra(pos, invMass, anchors, dist, V) {
  const K = anchors.length;
  if (K === 0) return;
  for (let v = 0; v < V; v++) {
    if (invMass[v] === 0) continue;
    const v3 = 3 * v;
    const row = v * K;
    for (let k = 0; k < K; k++) {
      const D = dist[row + k];
      if (!(D < Infinity)) continue;
      const a3 = 3 * anchors[k];
      const ax = pos[a3];
      const ay = pos[a3 + 1];
      const az = pos[a3 + 2];
      const dx = pos[v3] - ax;
      const dy = pos[v3 + 1] - ay;
      const dz = pos[v3 + 2] - az;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(d > D) || d < 1e-9) continue;
      const s = D / d;
      pos[v3] = ax + dx * s;
      pos[v3 + 1] = ay + dy * s;
      pos[v3 + 2] = az + dz * s;
    }
  }
}
