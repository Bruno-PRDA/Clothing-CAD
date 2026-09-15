// src/body/mesh.js — render mesh of the analytic body (SPEC 6.7), tessellated in plain JS (no three.js, so the whole
// body module runs under node). One indexed mesh: positions / area-weighted unit normals (Float32Array), indices
// (Uint32Array). Overlaps at joints are accepted (depth testing renders the union; smin blends exist only in the SDF).

/** @typedef {import('../core/types.js').Vec3} Vec3 */
/** @typedef {import('./primitives.js').AnalyticBody} AnalyticBody */
/** @typedef {import('./primitives.js').Primitive} Primitive */

const ELLIPSOID_W = 24;
const ELLIPSOID_H = 16;
const CONE_SEGMENTS = 20;
const CONE_CAP_W = 16;
const CONE_CAP_H = 12;
const LOFT_SEGMENTS = 48;
const LOFT_STEP = 0.01;
const FOOT_SEGMENTS = 12;
const FOOT_CAP_W = 12;
const FOOT_CAP_H = 8;

/** Growable mesh accumulator. */
class MeshBuilder {
  constructor() {
    /** @type {number[]} */
    this.pos = [];
    /** @type {number[]} */
    this.idx = [];
  }
  /** @returns {number} vertex count */
  get count() { return this.pos.length / 3; }
  /** @param {number} x @param {number} y @param {number} z @returns {number} index */
  vertex(x, y, z) {
    this.pos.push(x, y, z);
    return this.pos.length / 3 - 1;
  }
  /** @param {number} a @param {number} b @param {number} c */
  tri(a, b, c) { this.idx.push(a, b, c); }

  /**
   * Flip the winding of the triangles added since `triStart` when their signed volume about `centre` is negative,
   * so every closed primitive ends up with outward-facing triangles.
   * @param {number} triStart index into idx @param {Vec3} centre
   */
  orient(triStart, centre) {
    const p = this.pos;
    const ix = this.idx;
    let vol = 0;
    for (let t = triStart; t < ix.length; t += 3) {
      const a = ix[t] * 3;
      const b = ix[t + 1] * 3;
      const c = ix[t + 2] * 3;
      const ax = p[a] - centre[0], ay = p[a + 1] - centre[1], az = p[a + 2] - centre[2];
      const bx = p[b] - centre[0], by = p[b + 1] - centre[1], bz = p[b + 2] - centre[2];
      const cx = p[c] - centre[0], cy = p[c + 1] - centre[1], cz = p[c + 2] - centre[2];
      vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    }
    if (vol < 0) {
      for (let t = triStart; t < ix.length; t += 3) {
        const tmp = ix[t + 1];
        ix[t + 1] = ix[t + 2];
        ix[t + 2] = tmp;
      }
    }
  }
}

/** @param {number} x @param {number} y @param {number} z @returns {Vec3} */
function norm3(x, y, z) {
  const l = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / l, y / l, z / l];
}

/**
 * Orthonormal frame (ex, ey, ez as world vectors) with ey = axis and ez as close to world +z as possible.
 * @param {Vec3} axis @returns {Float64Array} row-major rows = ex, ey, ez
 */
function frameFor(axis) {
  const ey = norm3(axis[0], axis[1], axis[2]);
  let zx = -ey[2] * ey[0];
  let zy = -ey[2] * ey[1];
  let zz = 1 - ey[2] * ey[2];
  if (Math.abs(zx) + Math.abs(zy) + Math.abs(zz) < 1e-9) { zx = 1 - ey[0] * ey[0]; zy = -ey[0] * ey[1]; zz = -ey[0] * ey[2]; }
  const ez = norm3(zx, zy, zz);
  const ex = [ey[1] * ez[2] - ey[2] * ez[1], ey[2] * ez[0] - ey[0] * ez[2], ey[0] * ez[1] - ey[1] * ez[0]];
  return new Float64Array([ex[0], ex[1], ex[2], ey[0], ey[1], ey[2], ez[0], ez[1], ez[2]]);
}

/**
 * UV sphere / ellipsoid: (w + 1) x (h + 1) vertices, local point (rx sin(phi) cos(th), ry cos(phi), rz sin(phi) sin(th))
 * rotated by the frame rows (local axes in world coordinates) and translated to c.
 * @param {MeshBuilder} mb @param {Vec3} c @param {Vec3} radii @param {Float64Array|null} frame @param {number} w @param {number} h
 */
function addEllipsoid(mb, c, radii, frame, w, h) {
  const base = mb.count;
  const triStart = mb.idx.length;
  const f = frame;
  for (let iy = 0; iy <= h; iy++) {
    const phi = Math.PI * iy / h;
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    for (let ix = 0; ix <= w; ix++) {
      const th = 2 * Math.PI * ix / w;
      const lx = radii[0] * sp * Math.cos(th);
      const ly = radii[1] * cp;
      const lz = radii[2] * sp * Math.sin(th);
      if (f) {
        // frame rows are world->local; world = M^T local = ex*lx + ey*ly + ez*lz
        mb.vertex(
          c[0] + f[0] * lx + f[3] * ly + f[6] * lz,
          c[1] + f[1] * lx + f[4] * ly + f[7] * lz,
          c[2] + f[2] * lx + f[5] * ly + f[8] * lz,
        );
      } else {
        mb.vertex(c[0] + lx, c[1] + ly, c[2] + lz);
      }
    }
  }
  const stride = w + 1;
  for (let iy = 0; iy < h; iy++) {
    for (let ix = 0; ix < w; ix++) {
      const a = base + iy * stride + ix;
      const b = a + stride;
      const cc = b + 1;
      const d = a + 1;
      if (iy !== 0) mb.tri(a, b, d);
      if (iy !== h - 1) mb.tri(b, cc, d);
    }
  }
  mb.orient(triStart, c);
}

/**
 * Open cylinder / cone shell from centre a (radius r1) to centre b (radius r2), `seg` segments around.
 * @param {MeshBuilder} mb @param {Vec3} a @param {number} r1 @param {Vec3} b @param {number} r2 @param {number} seg
 */
function addTube(mb, a, r1, b, r2, seg) {
  const axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const f = frameFor(axis);
  const base = mb.count;
  const triStart = mb.idx.length;
  const ends = [[a, r1], [b, r2]];
  for (let e = 0; e < 2; e++) {
    const c = /** @type {Vec3} */ (ends[e][0]);
    const r = /** @type {number} */ (ends[e][1]);
    for (let i = 0; i <= seg; i++) {
      const th = 2 * Math.PI * i / seg;
      const lx = r * Math.cos(th);
      const lz = r * Math.sin(th);
      mb.vertex(c[0] + f[0] * lx + f[6] * lz, c[1] + f[1] * lx + f[7] * lz, c[2] + f[2] * lx + f[8] * lz);
    }
  }
  const stride = seg + 1;
  for (let i = 0; i < seg; i++) {
    const p0 = base + i;
    const p1 = base + i + 1;
    const q0 = base + stride + i;
    const q1 = base + stride + i + 1;
    mb.tri(p0, q0, p1);
    mb.tri(p1, q0, q1);
  }
  mb.orient(triStart, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
}

/**
 * Round cone = tube between the centres plus a sphere cap at each end.
 * @param {MeshBuilder} mb @param {Primitive} p @param {number} seg @param {number} capW @param {number} capH
 */
function addRoundCone(mb, p, seg, capW, capH) {
  const a = /** @type {Vec3} */ (p.a);
  const b = /** @type {Vec3} */ (p.b);
  const r1 = /** @type {number} */ (p.r1);
  const r2 = /** @type {number} */ (p.r2);
  addTube(mb, a, r1, b, r2, seg);
  addEllipsoid(mb, a, [r1, r1, r1], null, capW, capH);
  addEllipsoid(mb, b, [r2, r2, r2], null, capW, capH);
}

/**
 * Torso loft: one ring per cm from crotch - 0.03 to neckBase, 48 segments, fan caps.
 * @param {MeshBuilder} mb @param {AnalyticBody} analytic
 */
function addLoft(mb, analytic) {
  const loft = analytic.loft;
  const y0 = loft.yMin - 0.03;
  const y1 = loft.yMax;
  const nRings = Math.max(2, Math.floor((y1 - y0) / LOFT_STEP + 1e-9) + 1);
  const n = loft.list[0].n;
  const invN = -1 / n;
  const ring = new Float64Array(6);
  const base = mb.count;
  const triStart = mb.idx.length;
  const seg = LOFT_SEGMENTS;
  const stride = seg + 1;
  let firstCz = 0;
  let lastCz = 0;
  for (let r = 0; r < nRings; r++) {
    const y = r === nRings - 1 ? y1 : y0 + r * LOFT_STEP;
    loft.ringAt(y, ring);
    const a = ring[0];
    const b = ring[1];
    const cz = ring[2];
    if (r === 0) firstCz = cz;
    lastCz = cz;
    for (let i = 0; i <= seg; i++) {
      const th = 2 * Math.PI * i / seg;
      const ct = Math.cos(th);
      const st = Math.sin(th);
      const R = Math.pow(Math.pow(Math.abs(ct / a), n) + Math.pow(Math.abs(st / b), n), invN);
      mb.vertex(R * ct, y, cz + R * st);
    }
  }
  for (let r = 0; r < nRings - 1; r++) {
    for (let i = 0; i < seg; i++) {
      const p0 = base + r * stride + i;
      const p1 = p0 + 1;
      const q0 = p0 + stride;
      const q1 = q0 + 1;
      mb.tri(p0, p1, q0);
      mb.tri(p1, q1, q0);
    }
  }
  const bottom = mb.vertex(0, y0, firstCz);
  const top = mb.vertex(0, y1, lastCz);
  for (let i = 0; i < seg; i++) {
    mb.tri(bottom, base + i + 1, base + i);
    const t0 = base + (nRings - 1) * stride + i;
    mb.tri(top, t0, t0 + 1);
  }
  mb.orient(triStart, [0, (y0 + y1) / 2, 0]);
}

/**
 * Area-weighted vertex normals, normalised.
 * @param {Float32Array} positions @param {Uint32Array} indices @returns {Float32Array}
 */
export function computeNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz;
    normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz;
    normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i];
    const y = normals[i + 1];
    const z = normals[i + 2];
    const l = Math.sqrt(x * x + y * y + z * z);
    if (l > 1e-20) {
      normals[i] = x / l; normals[i + 1] = y / l; normals[i + 2] = z / l;
    } else {
      normals[i] = 0; normals[i + 1] = 1; normals[i + 2] = 0;
    }
  }
  return normals;
}

/**
 * Build the render mesh of the analytic body (metres). Plain data; no three.js.
 * @param {AnalyticBody} analytic
 * @returns {{positions: Float32Array, normals: Float32Array, indices: Uint32Array}}
 */
export function buildRenderMesh(analytic) {
  const mb = new MeshBuilder();
  addLoft(mb, analytic);
  const prims = analytic.prims;
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i];
    if (p.kind === 'ellipsoid') {
      addEllipsoid(mb, p.c, /** @type {Vec3} */ (p.radii), p.frame || null, ELLIPSOID_W, ELLIPSOID_H);
    } else if (p.kind === 'sphere') {
      const r = /** @type {number} */ (p.r);
      addEllipsoid(mb, p.c, [r, r, r], null, ELLIPSOID_W, ELLIPSOID_H);
    } else if (p.kind === 'roundCone') {
      const foot = p.name === 'footL' || p.name === 'footR';
      if (foot) addRoundCone(mb, p, FOOT_SEGMENTS, FOOT_CAP_W, FOOT_CAP_H);
      else addRoundCone(mb, p, CONE_SEGMENTS, CONE_CAP_W, CONE_CAP_H);
    }
  }
  const positions = new Float32Array(mb.pos);
  const indices = new Uint32Array(mb.idx);
  const normals = computeNormals(positions, indices);
  return { positions, normals, indices };
}
