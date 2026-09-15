// src/core/sdf.js — SdfGrid helpers (SPEC section 3.7). Imports only types.js.
// Layout: data[i + nx*(j + ny*k)] = signed distance (metres) at origin + cell*[i, j, k]; negative inside.
// sampleSdf, gridIndex, gridContains and sphereDistance allocate nothing (section 3.7.2).

/** @typedef {import('./types.js').SdfGrid} SdfGrid */
/** @typedef {import('./types.js').Vec3} Vec3 */

export const SDF_OUTSIDE = 1;
export const SDF_EPS_GRAD = 1e-9;
const EPS_GRAD_SQ = SDF_EPS_GRAD * SDF_EPS_GRAD;

/**
 * Flat index of node (i,j,k). No bounds check.
 * @param {SdfGrid} grid @param {number} i @param {number} j @param {number} k @returns {number}
 */
export function gridIndex(grid, i, j, k) {
  return i + grid.nx * (j + grid.ny * k);
}

/**
 * True when the point lies inside the sampled box [origin, origin + cell*(n-1)] on all three axes.
 * @param {SdfGrid} grid @param {number} x @param {number} y @param {number} z @returns {boolean}
 */
export function gridContains(grid, x, y, z) {
  const origin = grid.origin;
  const cell = grid.cell;
  const u = (x - origin[0]) / cell;
  const v = (y - origin[1]) / cell;
  const w = (z - origin[2]) / cell;
  if (u < 0 || v < 0 || w < 0) return false;
  if (u > grid.nx - 1 || v > grid.ny - 1 || w > grid.nz - 1) return false;
  return true;
}

/**
 * World AABB of the sampled box (new arrays; not for per-frame use).
 * @param {SdfGrid} grid @returns {{min: Vec3, max: Vec3}}
 */
export function gridBounds(grid) {
  const o = grid.origin;
  const c = grid.cell;
  return {
    min: [o[0], o[1], o[2]],
    max: [o[0] + c * (grid.nx - 1), o[1] + c * (grid.ny - 1), o[2] + c * (grid.nz - 1)],
  };
}

/**
 * Trilinear signed distance at (x,y,z) with the analytic gradient of the same interpolant.
 * @param {SdfGrid} grid
 * @param {number} x @param {number} y @param {number} z   metres
 * @param {Float32Array|Float64Array|number[]|null} [outGrad]   receives the UNIT gradient when non-null
 * @returns {number} distance in metres; SDF_OUTSIDE (grad (0,1,0)) when outside the grid
 */
export function sampleSdf(grid, x, y, z, outGrad) {
  const origin = grid.origin;
  const cell = grid.cell;
  const nx = grid.nx;
  const ny = grid.ny;
  const nz = grid.nz;
  const u = (x - origin[0]) / cell;
  const v = (y - origin[1]) / cell;
  const w = (z - origin[2]) / cell;
  if (u < 0 || v < 0 || w < 0 || u > nx - 1 || v > ny - 1 || w > nz - 1 || u !== u || v !== v || w !== w) {
    if (outGrad) { outGrad[0] = 0; outGrad[1] = 1; outGrad[2] = 0; }
    return SDF_OUTSIDE;
  }
  let i = Math.floor(u);
  let j = Math.floor(v);
  let k = Math.floor(w);
  if (i > nx - 2) i = nx - 2;
  if (j > ny - 2) j = ny - 2;
  if (k > nz - 2) k = nz - 2;
  const fx = u - i;
  const fy = v - j;
  const fz = w - k;
  const data = grid.data;
  const s = nx;
  const t = nx * ny;
  const base = i + s * j + t * k;
  const c000 = data[base];
  const c100 = data[base + 1];
  const c010 = data[base + s];
  const c110 = data[base + s + 1];
  const c001 = data[base + t];
  const c101 = data[base + t + 1];
  const c011 = data[base + t + s];
  const c111 = data[base + t + s + 1];
  const c00 = c000 + (c100 - c000) * fx;
  const c10 = c010 + (c110 - c010) * fx;
  const c01 = c001 + (c101 - c001) * fx;
  const c11 = c011 + (c111 - c011) * fx;
  const c0 = c00 + (c10 - c00) * fy;
  const c1 = c01 + (c11 - c01) * fy;
  const d = c0 + (c1 - c0) * fz;
  if (!outGrad) return d;
  const gx = (((c100 - c000) * (1 - fy) + (c110 - c010) * fy) * (1 - fz)
    + ((c101 - c001) * (1 - fy) + (c111 - c011) * fy) * fz) / cell;
  const gy = ((c10 - c00) * (1 - fz) + (c11 - c01) * fz) / cell;
  const gz = (c1 - c0) / cell;
  const n2 = gx * gx + gy * gy + gz * gz;
  if (n2 < EPS_GRAD_SQ) {
    outGrad[0] = 0; outGrad[1] = 1; outGrad[2] = 0;
  } else {
    const inv = 1 / Math.sqrt(n2);
    outGrad[0] = gx * inv; outGrad[1] = gy * inv; outGrad[2] = gz * inv;
  }
  return d;
}

/**
 * Fill a grid from an analytic function fn(x,y,z) -> metres. Allocates the grid.
 * @param {Vec3} origin @param {number} cell @param {number} nx @param {number} ny @param {number} nz
 * @param {(x:number, y:number, z:number) => number} fn
 * @returns {SdfGrid}
 */
export function makeGridFromFn(origin, cell, nx, ny, nz, fn) {
  const data = new Float32Array(nx * ny * nz);
  const ox = origin[0];
  const oy = origin[1];
  const oz = origin[2];
  let idx = 0;
  for (let k = 0; k < nz; k++) {
    const z = oz + cell * k;
    for (let j = 0; j < ny; j++) {
      const y = oy + cell * j;
      for (let i = 0; i < nx; i++) {
        data[idx++] = fn(ox + cell * i, y, z);
      }
    }
  }
  return { origin: [ox, oy, oz], cell, nx, ny, nz, data };
}

/**
 * Exact analytic sphere distance (reference for sampleSdf tests).
 * @param {Vec3} centre @param {number} radius @param {number} x @param {number} y @param {number} z
 * @param {Float32Array|Float64Array|number[]|null} [outGrad]
 * @returns {number}
 */
export function sphereDistance(centre, radius, x, y, z, outGrad) {
  const dx = x - centre[0];
  const dy = y - centre[1];
  const dz = z - centre[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (outGrad) {
    if (len < SDF_EPS_GRAD) {
      outGrad[0] = 0; outGrad[1] = 1; outGrad[2] = 0;
    } else {
      const inv = 1 / len;
      outGrad[0] = dx * inv; outGrad[1] = dy * inv; outGrad[2] = dz * inv;
    }
  }
  return len - radius;
}

/**
 * Exact sphere field: origin = centre - (radius + pad), n = ceil(2(radius + pad)/cell) + 1 per axis.
 * @param {Vec3} centre @param {number} radius @param {number} cell @param {number} pad
 * @returns {SdfGrid}
 */
export function makeSphereGrid(centre, radius, cell, pad) {
  const half = radius + pad;
  const n = Math.ceil(2 * half / cell - 1e-9) + 1;
  const origin = [centre[0] - half, centre[1] - half, centre[2] - half];
  return makeGridFromFn(origin, cell, n, n, n, function sphereFn(x, y, z) {
    return sphereDistance(centre, radius, x, y, z, null);
  });
}

/**
 * Exact capsule field (segment a->b, radius r): AABB of the segment expanded by radius + pad.
 * @param {Vec3} a @param {Vec3} b @param {number} radius @param {number} cell @param {number} pad
 * @returns {SdfGrid}
 */
export function makeCapsuleGrid(a, b, radius, cell, pad) {
  const ext = radius + pad;
  const minX = Math.min(a[0], b[0]) - ext;
  const minY = Math.min(a[1], b[1]) - ext;
  const minZ = Math.min(a[2], b[2]) - ext;
  const maxX = Math.max(a[0], b[0]) + ext;
  const maxY = Math.max(a[1], b[1]) + ext;
  const maxZ = Math.max(a[2], b[2]) + ext;
  const nx = Math.ceil((maxX - minX) / cell - 1e-9) + 1;
  const ny = Math.ceil((maxY - minY) / cell - 1e-9) + 1;
  const nz = Math.ceil((maxZ - minZ) / cell - 1e-9) + 1;
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const ab2 = abx * abx + aby * aby + abz * abz;
  return makeGridFromFn([minX, minY, minZ], cell, nx, ny, nz, function capsuleFn(x, y, z) {
    const apx = x - a[0];
    const apy = y - a[1];
    const apz = z - a[2];
    let t = ab2 > 0 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    const dx = apx - abx * t;
    const dy = apy - aby * t;
    const dz = apz - abz * t;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;
  });
}
