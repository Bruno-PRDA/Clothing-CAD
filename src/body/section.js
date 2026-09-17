// src/body/section.js — cut the template mesh with a plane and measure the resulting loop.
//
// This is how every girth on the template body is measured: slice, keep the loop that belongs to the
// part we are measuring, and take its convex perimeter. The convex hull is deliberate — a tailor's
// tape bridges the gap between the breasts and the hollow of the back rather than sinking into it,
// so the hull is a better model of a real measurement than the raw section outline.
//
// Note on provenance: MakeHuman's own measurement plugin is AGPL, so none of it is used or copied
// here. The planes below are defined from the joint landmarks in the CC0 mesh, which is our own
// construction; the only consequence is that our numbers need not agree with MakeHuman's UI to the
// millimetre. Nothing depends on them agreeing — `fit.js` solves against OUR measurement.
//
// Pure: no three.js, no DOM. Metres in, metres out.

/** @typedef {import('./template.js').Template} Template */

/**
 * Triangles bucketed by height so a horizontal cut touches ~1 % of the mesh instead of all of it.
 * Build once per mesh topology; it does not depend on the vertex positions being current, only on
 * the buckets being rebuilt when they move, so `buildIndex` is called after each morph.
 * @typedef {Object} SectionIndex
 * @property {Float32Array} pos
 * @property {Uint32Array} indices
 * @property {number} nTris
 * @property {number} y0
 * @property {number} dy
 * @property {number} nBuckets
 * @property {Uint32Array} bucketStart
 * @property {Uint32Array} bucketTris
 */

const BUCKETS = 256;

/**
 * @param {Template} tpl @param {Float32Array} pos @returns {SectionIndex}
 */
export function buildIndex(tpl, pos) {
  const idx = tpl.indices;
  const nTris = tpl.nTris;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < tpl.nBodyVerts; i++) {
    const y = pos[i * 3 + 1];
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  const dy = (hi - lo) / BUCKETS || 1;
  const counts = new Uint32Array(BUCKETS + 1);
  const bucketOf = (y) => Math.min(BUCKETS - 1, Math.max(0, Math.floor((y - lo) / dy)));

  // pass 1: count (a triangle lands in every bucket its y-range spans)
  for (let t = 0; t < nTris; t++) {
    const a = idx[t * 3] * 3 + 1, b = idx[t * 3 + 1] * 3 + 1, c = idx[t * 3 + 2] * 3 + 1;
    const ymin = Math.min(pos[a], pos[b], pos[c]), ymax = Math.max(pos[a], pos[b], pos[c]);
    for (let k = bucketOf(ymin), e = bucketOf(ymax); k <= e; k++) counts[k + 1]++;
  }
  const start = new Uint32Array(BUCKETS + 1);
  for (let k = 0; k < BUCKETS; k++) start[k + 1] = start[k] + counts[k + 1];
  const tris = new Uint32Array(start[BUCKETS]);
  const cursor = start.slice();
  for (let t = 0; t < nTris; t++) {
    const a = idx[t * 3] * 3 + 1, b = idx[t * 3 + 1] * 3 + 1, c = idx[t * 3 + 2] * 3 + 1;
    const ymin = Math.min(pos[a], pos[b], pos[c]), ymax = Math.max(pos[a], pos[b], pos[c]);
    for (let k = bucketOf(ymin), e = bucketOf(ymax); k <= e; k++) tris[cursor[k]++] = t;
  }
  return { pos, indices: idx, nTris, y0: lo, dy, nBuckets: BUCKETS, bucketStart: start, bucketTris: tris };
}

/**
 * Segments where the plane y = `y` crosses the mesh, as a flat [x0,z0,x1,z1, ...] array.
 * @param {SectionIndex} ix @param {number} y @returns {Float64Array}
 */
export function horizontalSegments(ix, y) {
  const k = Math.min(ix.nBuckets - 1, Math.max(0, Math.floor((y - ix.y0) / ix.dy)));
  const from = ix.bucketStart[k], to = ix.bucketStart[k + 1];
  const pos = ix.pos, idx = ix.indices;
  const out = [];
  const px = [0, 0, 0], pz = [0, 0, 0];
  for (let s = from; s < to; s++) {
    const t = ix.bucketTris[s] * 3;
    const va = idx[t] * 3, vb = idx[t + 1] * 3, vc = idx[t + 2] * 3;
    let n = 0;
    // for each edge, does it straddle the plane?
    for (const [p, q] of [[va, vb], [vb, vc], [vc, va]]) {
      const ya = pos[p + 1], yb = pos[q + 1];
      if ((ya <= y && yb > y) || (yb <= y && ya > y)) {
        const f = (y - ya) / (yb - ya);
        if (n < 3) {
          px[n] = pos[p] + (pos[q] - pos[p]) * f;
          pz[n] = pos[p + 2] + (pos[q + 2] - pos[p + 2]) * f;
          n++;
        }
      }
    }
    if (n === 2) out.push(px[0], pz[0], px[1], pz[1]);
  }
  return Float64Array.from(out);
}

/**
 * Group segments into connected components (the torso and the two arms come out separately).
 * Endpoints are matched on a grid of `tol` metres, which is far below the mesh's edge length and far
 * above float noise.
 * @param {Float64Array} seg @param {number} [tol]
 * @returns {Array<{pts: number[], cx: number, cz: number, n: number}>}
 */
export function components(seg, tol = 1e-4) {
  const n = seg.length / 4;
  if (n === 0) return [];
  const key = (x, z) => `${Math.round(x / tol)},${Math.round(z / tol)}`;
  /** @type {Map<string, number[]>} */
  const at = new Map();
  for (let i = 0; i < n; i++) {
    for (const j of [0, 1]) {
      const k = key(seg[i * 4 + j * 2], seg[i * 4 + j * 2 + 1]);
      let list = at.get(k);
      if (!list) at.set(k, (list = []));
      list.push(i);
    }
  }
  const seen = new Uint8Array(n);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    const pts = [];
    while (stack.length) {
      const s = stack.pop();
      pts.push(seg[s * 4], seg[s * 4 + 1], seg[s * 4 + 2], seg[s * 4 + 3]);
      for (const j of [0, 1]) {
        const list = at.get(key(seg[s * 4 + j * 2], seg[s * 4 + j * 2 + 1]));
        if (!list) continue;
        for (const m of list) if (!seen[m]) { seen[m] = 1; stack.push(m); }
      }
    }
    let cx = 0, cz = 0;
    for (let k = 0; k < pts.length; k += 2) { cx += pts[k]; cz += pts[k + 1]; }
    out.push({ pts, cx: cx / (pts.length / 2), cz: cz / (pts.length / 2), n: pts.length / 2 });
  }
  return out;
}

/**
 * Convex hull (monotone chain) of a flat [x,z,...] point list -> hull points, same layout.
 * @param {number[]|Float64Array} pts @returns {number[]}
 */
export function convexHull(pts) {
  const n = pts.length / 2;
  if (n < 3) return Array.from(pts);
  const order = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => (pts[a * 2] - pts[b * 2]) || (pts[a * 2 + 1] - pts[b * 2 + 1]));
  const cross = (o, a, b) =>
    (pts[a * 2] - pts[o * 2]) * (pts[b * 2 + 1] - pts[o * 2 + 1]) -
    (pts[a * 2 + 1] - pts[o * 2 + 1]) * (pts[b * 2] - pts[o * 2]);
  /** @param {number[]} src @returns {number[]} */
  const build = (src) => {
    const h = [];
    for (const i of src) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], i) <= 0) h.pop();
      h.push(i);
    }
    h.pop();
    return h;
  };
  const hull = build(order).concat(build(order.slice().reverse()));
  const out = [];
  for (const i of hull) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

/**
 * Is (x, z) inside this convex polygon? `convexHull` returns counter-clockwise order, so the point is
 * inside when it is left of every edge. A point exactly on an edge counts as inside.
 * @param {number[]} hull flat [x,z,...] @param {number} x @param {number} z @returns {boolean}
 */
export function hullContains(hull, x, z) {
  const n = hull.length / 2;
  if (n < 3) return false;
  let pos = 0, neg = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cr = (hull[j * 2] - hull[i * 2]) * (z - hull[i * 2 + 1]) -
               (hull[j * 2 + 1] - hull[i * 2 + 1]) * (x - hull[i * 2]);
    if (cr > 1e-12) pos++; else if (cr < -1e-12) neg++;
    if (pos && neg) return false;
  }
  return true;
}

/** @param {number[]} hull flat [x,z,...] closed polygon @returns {number} perimeter */
export function perimeter(hull) {
  const n = hull.length / 2;
  if (n < 2) return 0;
  let p = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    p += Math.hypot(hull[j * 2] - hull[i * 2], hull[j * 2 + 1] - hull[i * 2 + 1]);
  }
  return p;
}

/**
 * Girth of the body at height `y`, measured as a tape would lie: the convex perimeter of the piece of
 * the section nearest `nearX` (0 = the torso; ±0.2 or so picks an arm).
 * @param {SectionIndex} ix @param {number} y @param {{nearX?: number, nearZ?: number}} [opts]
 * @returns {{girth: number, width: number, depth: number, cx: number, cz: number, hull: number[]}|null}
 */
export function girthAt(ix, y, opts = {}) {
  const comps = components(horizontalSegments(ix, y));
  if (!comps.length) return null;
  const nx = opts.nearX || 0, nz = opts.nearZ || 0;

  // Pick the loop that actually ENCLOSES the point we are measuring around. Choosing the loop with
  // the nearest centroid instead looks equivalent but is not: a calf's own loop is offset backwards
  // from the knee-ankle axis by the muscle belly, so a small neighbouring sliver can have the nearer
  // centroid and get measured instead — a 36 cm calf reported as 12 cm. Among enclosing loops (there
  // is normally exactly one) take the largest; if none encloses, fall back to the nearest centroid.
  let best = null, bestScore = -Infinity, fallback = comps[0], fallbackD = Infinity;
  for (const c of comps) {
    const d = (c.cx - nx) ** 2 + (c.cz - nz) ** 2;
    if (d < fallbackD) { fallbackD = d; fallback = c; }
    if (c.n < 8) continue;                       // stray slivers
    const h = convexHull(c.pts);
    if (!hullContains(h, nx, nz)) continue;
    if (c.n > bestScore) { bestScore = c.n; best = c; }
  }
  const chosen = best || fallback;
  const hull = convexHull(chosen.pts);
  let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < hull.length; i += 2) {
    if (hull[i] < xmin) xmin = hull[i];
    if (hull[i] > xmax) xmax = hull[i];
    if (hull[i + 1] < zmin) zmin = hull[i + 1];
    if (hull[i + 1] > zmax) zmax = hull[i + 1];
  }
  return { girth: perimeter(hull), width: xmax - xmin, depth: zmax - zmin, cx: chosen.cx, cz: chosen.cz, hull };
}

/**
 * Girth on a plane that is NOT horizontal — needed for the limbs, which are angled in the A-pose, so a
 * horizontal cut through an upper arm reports an ellipse much larger than the arm.
 *
 * Rather than a general oblique section (which would need its own bucket index), the mesh is rotated
 * about the limb's midpoint so the limb axis becomes vertical, and the fast horizontal path is reused
 * on the rotated copy of just the vertices near that limb.
 *
 * @param {Template} tpl @param {Float32Array} pos
 * @param {[number,number,number]} a joint at one end @param {[number,number,number]} b joint at the other
 * The vertex filter is deliberately tight in BOTH directions. A generous radius around the arm axis
 * reaches the ribs, and then the arm and the torso come back as one connected loop whose perimeter is
 * meaningless — that is how an upper arm measures 75 cm. Keeping only a thin band either side of the
 * cut plane means the torso can only intrude if it is literally within `radius` of the cut, which it
 * is not for any of the limb stations we measure at.
 *
 * @param {number} t 0..1 along a->b
 * @param {number} [radius] only vertices within this distance of the axis are considered
 * @param {number} [band] only vertices within this distance of the cut plane are considered
 * @returns {{girth: number, width: number, depth: number}|null}
 */
export function limbGirth(tpl, pos, a, b, t, radius = 0.12, band = 0.035) {
  const ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2];
  const len = Math.hypot(ax, ay, az) || 1;
  const ux = ax / len, uy = ay / len, uz = az / len;
  // Rotation taking the limb axis u to +Y: Rodrigues about k = u x Y, by the angle between them.
  // u x (0,1,0) = (-uz, 0, ux). Getting this backwards tilts the cut plane instead of squaring it to
  // the limb, which quietly reports a slanted, fragmented section.
  const wx = -uz, wy = 0, wz = ux;
  const s = Math.hypot(wx, wy, wz);
  const c = uy;
  let R;
  if (s < 1e-9) {
    R = c > 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, -1, 0, 0, 0, -1];
  } else {
    const kx = wx / s, ky = wy / s, kz = wz / s;
    const C = 1 - c;
    R = [
      c + kx * kx * C, kx * ky * C - kz * s, kx * kz * C + ky * s,
      ky * kx * C + kz * s, c + ky * ky * C, ky * kz * C - kx * s,
      kz * kx * C - ky * s, kz * ky * C + kx * s, c + kz * kz * C,
    ];
  }
  const px = a[0] + ax * t, py = a[1] + ay * t, pz = a[2] + az * t;

  // Seed vertices: inside the band and within `radius` of the axis.
  const seed = new Uint8Array(tpl.nBodyVerts);
  for (let i = 0; i < tpl.nBodyVerts; i++) {
    const dx = pos[i * 3] - px, dy = pos[i * 3 + 1] - py, dz = pos[i * 3 + 2] - pz;
    const along = dx * ux + dy * uy + dz * uz;
    if (Math.abs(along) > band) continue;
    const rx = dx - along * ux, ry = dy - along * uy, rz = dz - along * uz;
    if (rx * rx + ry * ry + rz * rz > radius * radius) continue;
    seed[i] = 1;
  }
  // Take every triangle that TOUCHES a seed, and keep all three of its vertices. Requiring all three
  // to be seeds instead lets the radius test bite mid-triangle and tear the section loop into arcs —
  // which is how a 36 cm calf came back as 12 cm, because only an arc of it survived.
  const idx = tpl.indices;
  const keep = new Int32Array(tpl.nBodyVerts).fill(-1);
  const rot = [];
  const tri = [];
  const take = (v) => {
    if (keep[v] >= 0) return keep[v];
    const dx = pos[v * 3] - px, dy = pos[v * 3 + 1] - py, dz = pos[v * 3 + 2] - pz;
    keep[v] = rot.length / 3;
    rot.push(R[0] * dx + R[1] * dy + R[2] * dz, R[3] * dx + R[4] * dy + R[5] * dz, R[6] * dx + R[7] * dy + R[8] * dz);
    return keep[v];
  };
  for (let k = 0; k < idx.length; k += 3) {
    const v0 = idx[k], v1 = idx[k + 1], v2 = idx[k + 2];
    if (!seed[v0] && !seed[v1] && !seed[v2]) continue;
    tri.push(take(v0), take(v1), take(v2));
  }
  const rp = Float32Array.from(rot);
  if (tri.length < 3) return null;
  const sub = /** @type {Template} */ ({
    indices: Uint32Array.from(tri), nTris: tri.length / 3, nBodyVerts: rp.length / 3,
  });
  const ix = buildIndex(sub, rp);
  const g = girthAt(ix, 0, {});
  return g ? { girth: g.girth, width: g.width, depth: g.depth } : null;
}
