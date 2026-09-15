// src/cloth/fixtures.js — self-contained test fixtures (SPEC section 7.11). Builds its own regular-lattice PieceMesh
// (no geometry import) so the cloth module can be tested alone. Pure: imports only src/core and sibling cloth files.

import { buildCloth, commitPositions, setPin, setGravityDir } from './state.js';
import { sphereField, floorField } from './testfields.js';

/** @typedef {import('../core/types.js').ClothState} ClothState */
/** @typedef {import('../core/types.js').SdfGrid} SdfGrid */
/** @typedef {import('../core/types.js').FabricResolved} FabricResolved */
/** @typedef {import('../core/types.js').PieceMesh} PieceMesh */
/** @typedef {import('../core/types.js').SimSettings} SimSettings */

/**
 * Regular triangle lattice as a PieceMesh. Rows are `spacing_mm` apart (row 0 = top = max y, y decreasing with the row),
 * columns `spacing_mm` apart; with `stagger` odd rows are shifted by +spacing/2 (isoceles triangles), otherwise the
 * square cells are split along alternating diagonals. Vertex id = row*nx + col. Outline edges (CCW, y up):
 * 0 = bottom row (left→right), 1 = right column (bottom→top), 2 = top row (right→left), 3 = left column (top→bottom).
 * @param {{nx:number, ny:number, spacing_mm:number, x0_mm?:number, y0_mm?:number, pieceId?:string, stagger?:boolean}} o
 * @returns {PieceMesh}
 */
export function makeLatticeMesh(o) {
  const nx = Math.max(2, o.nx | 0);
  const ny = Math.max(2, o.ny | 0);
  const s = o.spacing_mm;
  const x0 = o.x0_mm || 0;
  const y0 = o.y0_mm || 0;
  const stagger = !!o.stagger;
  const V = nx * ny;
  const positions2d = new Float32Array(2 * V);
  for (let r = 0; r < ny; r++) {
    const shift = (stagger && (r & 1)) ? s / 2 : 0;
    for (let c = 0; c < nx; c++) {
      const v = r * nx + c;
      positions2d[2 * v] = x0 + c * s + shift;
      positions2d[2 * v + 1] = y0 - r * s;
    }
  }
  /** @type {number[]} */
  const tri = [];
  /** @param {number} a @param {number} b @param {number} c */
  const pushTri = (a, b, c) => {
    const ax = positions2d[2 * a]; const ay = positions2d[2 * a + 1];
    const area = (positions2d[2 * b] - ax) * (positions2d[2 * c + 1] - ay) - (positions2d[2 * c] - ax) * (positions2d[2 * b + 1] - ay);
    if (area >= 0) tri.push(a, b, c); else tri.push(a, c, b);
  };
  for (let r = 0; r < ny - 1; r++) {
    for (let c = 0; c < nx - 1; c++) {
      const a = r * nx + c; const b = a + 1; const d = a + nx; const e = d + 1;
      if (stagger) {
        if ((r & 1) === 0) { pushTri(a, b, d); pushTri(b, e, d); } else { pushTri(a, e, d); pushTri(a, b, e); }
      } else if (((r + c) & 1) === 0) { pushTri(a, b, e); pushTri(a, e, d); } else { pushTri(a, b, d); pushTri(b, e, d); }
    }
  }
  const T = tri.length / 3;
  const triangles = new Uint32Array(tri);
  // unique edges with adjacent triangles
  /** @type {Map<number, {a:number, b:number, t0:number, t1:number}>} */
  const edgeMap = new Map();
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < 3; k++) {
      const i = triangles[3 * t + k];
      const j = triangles[3 * t + ((k + 1) % 3)];
      const a = i < j ? i : j;
      const b = i < j ? j : i;
      const key = a * V + b;
      const rec = edgeMap.get(key);
      if (rec) rec.t1 = t; else edgeMap.set(key, { a, b, t0: t, t1: -1 });
    }
  }
  const recs = Array.from(edgeMap.values()).sort((p, q) => (p.a - q.a) || (p.b - q.b));
  const edges = new Uint32Array(2 * recs.length);
  /** @type {number[]} */
  const bend = [];
  /** @param {number} t @param {number} a @param {number} b @returns {number} */
  const opposite = (t, a, b) => {
    for (let k = 0; k < 3; k++) { const v = triangles[3 * t + k]; if (v !== a && v !== b) return v; }
    return a;
  };
  for (let e = 0; e < recs.length; e++) {
    const rec = recs[e];
    edges[2 * e] = rec.a;
    edges[2 * e + 1] = rec.b;
    if (rec.t1 >= 0) bend.push(rec.a, rec.b, opposite(rec.t0, rec.a, rec.b), opposite(rec.t1, rec.a, rec.b));
  }
  const bendPairs = new Uint32Array(bend);
  // outline
  /** @type {number[]} */
  const bottom = []; const right = []; const top = []; const left = [];
  for (let c = 0; c < nx; c++) bottom.push((ny - 1) * nx + c);
  for (let r = ny - 1; r >= 0; r--) right.push(r * nx + nx - 1);
  for (let c = nx - 1; c >= 0; c--) top.push(c);
  for (let r = 0; r < ny; r++) left.push(r * nx);
  const loop = bottom.slice(0, -1).concat(right.slice(0, -1), top.slice(0, -1), left.slice(0, -1));
  const boundary = new Uint32Array(loop);
  const edgeVerts = [[new Uint32Array(bottom), new Uint32Array(right), new Uint32Array(top), new Uint32Array(left)], []];
  let area = 0;
  for (let t = 0; t < T; t++) {
    const a = triangles[3 * t]; const b = triangles[3 * t + 1]; const c = triangles[3 * t + 2];
    const ax = positions2d[2 * a]; const ay = positions2d[2 * a + 1];
    area += Math.abs((positions2d[2 * b] - ax) * (positions2d[2 * c + 1] - ay) - (positions2d[2 * c] - ax) * (positions2d[2 * b + 1] - ay)) / 2;
  }
  const minAngleDeg = stagger ? 2 * Math.atan(0.5) * 180 / Math.PI : 45;
  return {
    pieceId: o.pieceId || 'lattice',
    vertexCount: V,
    positions2d,
    triangles,
    edges,
    bendPairs,
    boundary,
    edgeVerts,
    notchVerts: [[], []],
    area_mm2: area,
    quality: { minAngleDeg, pctAbove20: 100, medianEdge_mm: s, triangles: T },
    warnings: [],
  };
}

/**
 * @param {Partial<SimSettings>} over @returns {SimSettings}
 */
function simSettings(over) {
  return Object.assign({ substeps: 10, gravity_ms2: 9.81, selfCollision: true, sewTime_s: 0, collisionOffset_mm: 5, bendScale: 1, stretchScale: 1 }, over);
}

/**
 * Build a state from lattice meshes and one fabric.
 * @param {PieceMesh[]} meshes @param {FabricResolved} fabric @param {Partial<SimSettings>} sim
 * @param {import('../core/types.js').Seam[]} seams @param {Record<string, number[]>} [pinnedEdges]
 * @returns {ClothState}
 */
function buildFromLattices(meshes, fabric, sim, seams, pinnedEdges) {
  const fab = Object.assign({}, fabric, { id: fabric.id || 'fx' });
  const doc = /** @type {any} */ ({
    version: 1,
    name: 'fixture',
    fabrics: [],
    pieces: meshes.map((m) => ({
      id: m.pieceId, name: m.pieceId, fabricId: fab.id, layer: 0, simulate: true, pinnedEdges: (pinnedEdges && pinnedEdges[m.pieceId]) || [],
      placement: { anchor: 'torso', side: 'front', offset_mm: [0, 0], wrap: 0, flip: false },
    })),
    seams,
    sim: simSettings(sim),
  });
  const fabrics = new Map([[fab.id, fab]]);
  return buildCloth({ meshes, doc, fabrics });
}

/**
 * Flat rectangular sheet in the xy plane, top edge on y = 0 (x from −width/2 to +width/2), hanging in −y; optionally pinned
 * at its two top corners. Row-major, nx = round(width_m*1000/spacing_mm) + 1 columns, ny = round(height_m*1000/spacing_mm) + 1
 * rows, id = row*nx + col, row 0 = top edge (pinned corners ids 0 and nx−1), row ny−1 = bottom edge. A deterministic
 * 2 mm out-of-plane bulge (zero at the top row) seeds the buckling that a perfectly planar sheet would never start.
 * @param {{fabric: FabricResolved, width_m: number, height_m: number, spacing_mm: number, pinTopCorners: boolean, selfCollision: boolean}} args
 * @returns {ClothState} arranged, sewTime 0 (no seams)
 */
export function makeHangingSheet(args) {
  const { fabric, width_m, height_m, spacing_mm } = args;
  const nx = Math.round(width_m * 1000 / spacing_mm) + 1;
  const ny = Math.round(height_m * 1000 / spacing_mm) + 1;
  const mesh = makeLatticeMesh({ nx, ny, spacing_mm, x0_mm: -width_m * 500, y0_mm: 0, pieceId: 'sheet', stagger: true });
  const state = buildFromLattices([mesh], fabric, { selfCollision: !!args.selfCollision, sewTime_s: 0 }, []);
  const pos = state.pos;
  const p2 = mesh.positions2d;
  for (let r = 0; r < ny; r++) {
    for (let c = 0; c < nx; c++) {
      const v = r * nx + c;
      pos[3 * v] = p2[2 * v] / 1000;
      pos[3 * v + 1] = p2[2 * v + 1] / 1000;
      pos[3 * v + 2] = 0.002 * Math.sin(Math.PI * c / (nx - 1)) * (r / (ny - 1));
    }
  }
  commitPositions(state, null);
  if (args.pinTopCorners) {
    setPin(state, 0, [pos[0], pos[1], pos[2]]);
    const c = nx - 1;
    setPin(state, c, [pos[3 * c], pos[3 * c + 1], pos[3 * c + 2]]);
  }
  return state;
}

/**
 * A width × width sheet, horizontal, centred above the origin at y = dropHeight, dropped onto a sphere of radius
 * sphereRadius centred at the origin (cell 10 mm) — penetration fixture.
 * @param {{fabric: FabricResolved, width_m: number, spacing_mm: number, sphereRadius: number, dropHeight: number}} args
 * @returns {{state: ClothState, sdf: SdfGrid}}
 */
export function makeSphereDrape(args) {
  const { fabric, width_m, spacing_mm, sphereRadius, dropHeight } = args;
  const nx = Math.round(width_m * 1000 / spacing_mm) + 1;
  const mesh = makeLatticeMesh({ nx, ny: nx, spacing_mm, x0_mm: -width_m * 500, y0_mm: width_m * 500, pieceId: 'sheet', stagger: true });
  const state = buildFromLattices([mesh], fabric, { selfCollision: true, sewTime_s: 0 }, []);
  const pos = state.pos;
  const p2 = mesh.positions2d;
  for (let v = 0; v < mesh.vertexCount; v++) {
    pos[3 * v] = p2[2 * v] / 1000;
    pos[3 * v + 1] = dropHeight;
    pos[3 * v + 2] = -p2[2 * v + 1] / 1000;
  }
  const sdf = sphereField([0, 0, 0], sphereRadius, 0.01);
  commitPositions(state, sdf);
  return { state, sdf };
}

/**
 * Two 100 × 100 mm squares side by side (gap 60 mm) whose facing edges are sewn — seam fixture. Gravity is 0 so the
 * squares float and the seam pulls them together; sewTime 1 s; self-collision on.
 * @param {{fabric: FabricResolved, spacing_mm: number}} args @returns {{state: ClothState}}
 */
export function makeSeamFixture(args) {
  const { fabric, spacing_mm } = args;
  const n = Math.round(100 / spacing_mm) + 1;
  const a = makeLatticeMesh({ nx: n, ny: n, spacing_mm, x0_mm: -130, y0_mm: 100, pieceId: 'sqA', stagger: false });
  const b = makeLatticeMesh({ nx: n, ny: n, spacing_mm, x0_mm: 30, y0_mm: 100, pieceId: 'sqB', stagger: false });
  const seams = /** @type {any} */ ([{
    id: 'seam_ab', kind: 'plain',
    a: { pieceId: 'sqA', edge: 1, mirror: false, reverse: false },
    b: { pieceId: 'sqB', edge: 3, mirror: false, reverse: true },
  }]);
  const state = buildFromLattices([a, b], fabric, { selfCollision: true, sewTime_s: 1, gravity_ms2: 0 }, seams);
  const pos = state.pos;
  for (const pc of state.pieces) {
    const p2 = pc.mesh.positions2d;
    for (let v = 0; v < pc.count; v++) {
      const g = 3 * (pc.start + v);
      pos[g] = p2[2 * v] / 1000;
      pos[g + 1] = p2[2 * v + 1] / 1000;
      pos[g + 2] = 0;
    }
  }
  commitPositions(state, null);
  return { state };
}

/**
 * A size_m × size_m sheet resting on a horizontal floor field (y = 0) with gravity rotated by `angle_rad` about z
 * (tilted floor) and the fabric's friction overridden by `mu` — friction fixture.
 * @param {{fabric: FabricResolved, mu: number, size_m?: number, spacing_mm?: number, angle_rad?: number}} args
 * @returns {{state: ClothState, sdf: SdfGrid}}
 */
export function makeSlopeFixture(args) {
  const size = args.size_m || 0.2;
  const spacing = args.spacing_mm || 10;
  const angle = Number.isFinite(args.angle_rad) ? /** @type {number} */ (args.angle_rad) : Math.PI / 6;
  const fabric = Object.assign({}, args.fabric, { physics: Object.assign({}, args.fabric.physics, { friction: args.mu }) });
  const nx = Math.round(size * 1000 / spacing) + 1;
  const mesh = makeLatticeMesh({ nx, ny: nx, spacing_mm: spacing, x0_mm: -size * 500, y0_mm: size * 500, pieceId: 'sheet', stagger: true });
  const state = buildFromLattices([mesh], fabric, { selfCollision: false, sewTime_s: 0 }, []);
  const pos = state.pos;
  const p2 = mesh.positions2d;
  const y = state.clearance[0];
  for (let v = 0; v < mesh.vertexCount; v++) {
    pos[3 * v] = p2[2 * v] / 1000;
    pos[3 * v + 1] = y;
    pos[3 * v + 2] = -p2[2 * v + 1] / 1000;
  }
  const sdf = floorField(0, 0.05, 2);
  commitPositions(state, sdf);
  setGravityDir(state, [Math.sin(angle), -Math.cos(angle), 0]);
  return { state, sdf };
}
