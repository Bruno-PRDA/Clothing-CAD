// src/cloth/hash.js — uniform spatial hash for vertex–vertex self-collision (SPEC section 7.6).
// Counting sort into cellStart/entries; every buffer is preallocated for V at build time; buildHash allocates nothing.

/**
 * @typedef {Object} SpatialHash
 * @property {number} size        table size (power of two ≥ 2V)
 * @property {number} mask        size − 1
 * @property {Uint32Array} cellStart   size + 1
 * @property {Uint32Array} cursor      size (scatter cursors)
 * @property {Uint32Array} entries     V vertex ids sorted by cell
 * @property {Uint32Array} hashOf      V
 * @property {Int32Array} cellIx       V integer cell coordinates (exact neighbour test)
 * @property {Int32Array} cellIy
 * @property {Int32Array} cellIz
 */

/** @param {number} n @returns {number} smallest power of two ≥ n (min 16) */
function nextPow2(n) {
  let p = 16;
  while (p < n) p *= 2;
  return p;
}

/** @param {number} V @returns {SpatialHash} */
export function createHash(V) {
  const size = nextPow2(2 * V);
  return {
    size,
    mask: size - 1,
    cellStart: new Uint32Array(size + 1),
    cursor: new Uint32Array(size),
    entries: new Uint32Array(V),
    hashOf: new Uint32Array(V),
    cellIx: new Int32Array(V),
    cellIy: new Int32Array(V),
    cellIz: new Int32Array(V),
  };
}

/**
 * Hash of an integer cell coordinate.
 * @param {number} ix @param {number} iy @param {number} iz @param {number} mask @returns {number}
 */
export function hashCell(ix, iy, iz, mask) {
  return ((Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & mask) >>> 0;
}

/**
 * Rebuild the table from positions (cell size = cellSize). Non-finite positions land in cell 0.
 * @param {SpatialHash} h @param {Float32Array} pos @param {number} V @param {number} cellSize
 */
export function buildHash(h, pos, V, cellSize) {
  const { cellStart, cursor, entries, hashOf, cellIx, cellIy, cellIz, mask, size } = h;
  const inv = 1 / cellSize;
  cellStart.fill(0);
  for (let v = 0; v < V; v++) {
    let ix = Math.floor(pos[3 * v] * inv);
    let iy = Math.floor(pos[3 * v + 1] * inv);
    let iz = Math.floor(pos[3 * v + 2] * inv);
    if (ix !== ix) ix = 0;
    if (iy !== iy) iy = 0;
    if (iz !== iz) iz = 0;
    cellIx[v] = ix;
    cellIy[v] = iy;
    cellIz[v] = iz;
    const hh = hashCell(ix, iy, iz, mask);
    hashOf[v] = hh;
    cellStart[hh + 1]++;
  }
  for (let c = 1; c <= size; c++) cellStart[c] += cellStart[c - 1];
  for (let c = 0; c < size; c++) cursor[c] = cellStart[c];
  for (let v = 0; v < V; v++) {
    const hh = hashOf[v];
    entries[cursor[hh]++] = v;
  }
}
