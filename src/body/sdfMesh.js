// src/body/sdfMesh.js — bake a triangle mesh into the same SdfGrid the analytic body produced.
//
// The template body (template.js) is a mesh, but the cloth solver collides against a signed distance
// grid, so the mesh has to become one. This is Bridson's construction, which is the right shape for
// the job: exact where it matters and cheap where it does not.
//
//   1. UNSIGNED distance, exact, in a narrow band around every triangle. The band is what the cloth
//      actually samples — contact happens within a centimetre of the surface — so this is where the
//      distances and therefore the gradients have to be right.
//   2. SIGN by ray parity. For each grid line along z we count how many triangles a ray crosses before
//      each node; odd means inside. The MakeHuman body mesh is watertight and genus 0 (40 134 edges,
//      every one shared by exactly two triangles, V - E + F = 2), so parity is exact — no winding
//      numbers, no pseudonormals, no flood fill.
//   3. SWEEP the band outward, so far-field nodes get a monotone approximation rather than a wall of
//      "infinity". `pushOut` samples out there and only needs to know which way is out.
//
// Pure: no three.js, no DOM. Metres in, metres out.

/** @typedef {import('../core/types.js').SdfGrid} SdfGrid */

/** Padding around the mesh bounds, metres. Matches bake.js so anchors and arrange see the same room. */
export const BAKE_PAD = 0.10;
/** Exact-distance band, in cells, either side of a triangle. 2 cells at 15 mm is ±30 mm of exact field. */
export const BAND_CELLS = 2;

/** Squared distance from p to triangle abc, and nothing else — the inner loop of the whole bake. */
function pointTriDist2(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;

  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    const qx = apx - abx * t, qy = apy - aby * t, qz = apz - abz * t;
    return qx * qx + qy * qy + qz * qz;
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    const qx = apx - acx * t, qy = apy - acy * t, qz = apz - acz * t;
    return qx * qx + qy * qy + qz * qz;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const qx = apx - abx - (acx - abx) * t;
    const qy = apy - aby - (acy - aby) * t;
    const qz = apz - abz - (acz - abz) * t;
    return qx * qx + qy * qy + qz * qz;
  }
  // interior: distance to the plane
  const den = 1 / (va + vb + vc);
  const v = vb * den, w = vc * den;
  const qx = apx - (abx * v + acx * w);
  const qy = apy - (aby * v + acy * w);
  const qz = apz - (abz * v + acz * w);
  return qx * qx + qy * qy + qz * qz;
}

/**
 * Bake `indices` over `pos` into a signed distance grid.
 *
 * @param {Float32Array} pos          vertex positions, metres
 * @param {Uint32Array} indices       triangle list
 * @param {{cell?: number, pad?: number, nVerts?: number, band?: number}} [opts]
 *        nVerts bounds which vertices define the box (the template carries joint cubes past the surface)
 * @returns {SdfGrid}
 */
export function bakeMeshSdf(pos, indices, opts = {}) {
  const cell = Number.isFinite(opts.cell) && opts.cell > 0 ? Number(opts.cell) : 0.015;
  const pad = Number.isFinite(opts.pad) ? Number(opts.pad) : BAKE_PAD;
  const band = Number.isFinite(opts.band) ? Math.max(1, Math.trunc(Number(opts.band))) : BAND_CELLS;
  const nV = Number.isFinite(opts.nVerts) ? Number(opts.nVerts) : pos.length / 3;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < nV; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  // x origin snapped so the mid-sagittal plane x = 0 lands exactly on a node plane: the body is
  // bilaterally symmetric, so the true field has a crease at x = 0 wherever the legs face each other,
  // and a cell straddling a crease interpolates a gradient of almost nothing. Same reason as bake.js.
  const ox = -Math.ceil((pad - minX) / cell) * cell;
  const oy = minY - pad;
  const oz = minZ - pad;
  const nx = Math.ceil((maxX + pad - ox) / cell) + 1;
  const ny = Math.ceil((maxY + pad - oy) / cell) + 1;
  const nz = Math.ceil((maxZ + pad - oz) / cell) + 1;
  const n = nx * ny * nz;

  const data = new Float32Array(n);
  const FAR = (maxX - minX) + (maxY - minY) + (maxZ - minZ) + pad * 2;
  data.fill(FAR);
  // crossings[i + nx*(j + ny*k)] — how many triangles a +z ray from node (i,j,0) passes at or before k
  const crossings = new Int32Array(n);

  const nTris = (indices.length / 3) | 0;
  const invCell = 1 / cell;

  for (let t = 0; t < nTris; t++) {
    const ia = indices[t * 3] * 3, ib = indices[t * 3 + 1] * 3, ic = indices[t * 3 + 2] * 3;
    const ax = pos[ia], ay = pos[ia + 1], az = pos[ia + 2];
    const bx = pos[ib], by = pos[ib + 1], bz = pos[ib + 2];
    const cx = pos[ic], cy = pos[ic + 1], cz = pos[ic + 2];

    // --- 1. exact unsigned distance in the band -----------------------------------------------------
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - ox) * invCell) - band);
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - ox) * invCell) + band);
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - oy) * invCell) - band);
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) - oy) * invCell) + band);
    const k0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - oz) * invCell) - band);
    const k1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) - oz) * invCell) + band);
    for (let k = k0; k <= k1; k++) {
      const pz = oz + k * cell;
      const kOff = nx * ny * k;
      for (let j = j0; j <= j1; j++) {
        const py = oy + j * cell;
        const row = kOff + nx * j;
        for (let i = i0; i <= i1; i++) {
          const px = ox + i * cell;
          const d2 = pointTriDist2(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz);
          const idx = row + i;
          const cur = data[idx];
          if (d2 < cur * cur) data[idx] = Math.sqrt(d2);
        }
      }
    }

    // --- 2. z-ray crossings, for the sign -----------------------------------------------------------
    // Project onto (x, y) and, for every grid line strictly inside the triangle, record where the ray
    // pierces it. Barycentrics are computed in 2D; the pierce point's z follows from them.
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (d !== 0) {
      const inv = 1 / d;
      const gi0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - ox) * invCell));
      const gi1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - ox) * invCell));
      const gj0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - oy) * invCell));
      const gj1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - oy) * invCell));
      for (let j = gj0; j <= gj1; j++) {
        const py = oy + j * cell;
        for (let i = gi0; i <= gi1; i++) {
          const px = ox + i * cell;
          const l0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) * inv;
          if (l0 < 0 || l0 > 1) continue;
          const l1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) * inv;
          if (l1 < 0 || l1 > 1) continue;
          const l2 = 1 - l0 - l1;
          if (l2 < 0 || l2 > 1) continue;
          const hitZ = l0 * az + l1 * bz + l2 * cz;
          let k = Math.ceil((hitZ - oz) * invCell);
          if (k < 0) k = 0;
          if (k < nz) crossings[nx * ny * k + nx * j + i]++;
        }
      }
    }
  }

  // --- 3. apply the sign: prefix-sum the crossings along z, odd = inside --------------------------
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let total = 0;
      for (let k = 0; k < nz; k++) {
        const idx = nx * ny * k + nx * j + i;
        total += crossings[idx];
        if (total & 1) data[idx] = -data[idx];
      }
    }
  }

  sweep(data, nx, ny, nz, cell);
  return { origin: [ox, oy, oz], cell, nx, ny, nz, data };
}

/**
 * Fast sweep: propagate |distance| out of the band with eight directional passes, keeping each node's
 * sign. The result is a monotone approximation, not an exact distance — which is all the far field is
 * asked for. Nodes in the band are already exact and only ever win the min, so the band is preserved.
 * @param {Float32Array} d @param {number} nx @param {number} ny @param {number} nz @param {number} cell
 */
function sweep(d, nx, ny, nz, cell) {
  const at = (i, j, k) => nx * ny * k + nx * j + i;
  /** Relax one node against a neighbour that is `cell` away. */
  const relax = (idx, from) => {
    const cand = Math.abs(d[from]) + cell;
    const cur = d[idx];
    if (cand < Math.abs(cur)) d[idx] = cur < 0 ? -cand : cand;
  };
  const dirs = [
    [1, 1, 1], [-1, 1, 1], [1, -1, 1], [-1, -1, 1],
    [1, 1, -1], [-1, 1, -1], [1, -1, -1], [-1, -1, -1],
  ];
  for (const [sx, sy, sz] of dirs) {
    const iStart = sx > 0 ? 1 : nx - 2, iEnd = sx > 0 ? nx : -1;
    const jStart = sy > 0 ? 1 : ny - 2, jEnd = sy > 0 ? ny : -1;
    const kStart = sz > 0 ? 1 : nz - 2, kEnd = sz > 0 ? nz : -1;
    for (let k = kStart; k !== kEnd; k += sz) {
      for (let j = jStart; j !== jEnd; j += sy) {
        for (let i = iStart; i !== iEnd; i += sx) {
          const idx = at(i, j, k);
          relax(idx, at(i - sx, j, k));
          relax(idx, at(i, j - sy, k));
          relax(idx, at(i, j, k - sz));
        }
      }
    }
  }
}
