// src/body/template.js — the MakeHuman CC0 template mesh and its morph targets.
//
// This replaces the analytic primitive body for RENDERING and for measurement: instead of lofting
// superellipse rings and blending ellipsoids, we start from a real human mesh (13 380 body vertices
// scanned-and-sculpted, with hands, feet and a face) and reshape it with morph targets — the same
// construction body-visualizer.com uses. See assets/body/LICENSE.md for provenance.
//
// Everything here is pure data + arithmetic; no three.js, no DOM. Positions are METRES with the
// feet on y = 0 and the body centred on x = 0, matching the rest of the app (SPEC 6.1).

/** @typedef {{idx: Uint16Array, delta: Int16Array, scale: number}} MorphTarget */

/**
 * @typedef {Object} Template
 * @property {Float32Array} rest        nVerts*3, metres, feet at y=0
 * @property {Uint32Array} indices      nTris*3, body triangles only
 * @property {number} nVerts
 * @property {number} nBodyVerts        vertices [0, nBodyVerts) are the body surface; the rest are joint cubes
 * @property {number} nTris
 * @property {number} restHeight_m
 * @property {Map<string, MorphTarget>} targets
 * @property {Record<string, [number, number]>} joints   landmark name -> inclusive vertex range
 * @property {(name: string) => boolean} has
 */

const MAGIC = 'MHBODY01';

/** @param {string} message @returns {Error & {code: string}} */
function templateError(message) {
  const err = /** @type {Error & {code: string}} */ (new Error('BodyTemplate: ' + message));
  err.code = 'BodyTemplate';
  return err;
}

/**
 * Fetch and decode the template. Call once; the result is immutable and shareable.
 * @param {string} [baseUrl] directory holding base.bin / targets.bin / index.json
 * @param {{fetch?: typeof fetch}} [opts]
 * @returns {Promise<Template>}
 */
export async function loadTemplate(baseUrl = 'assets/body/', opts = {}) {
  const f = opts.fetch || fetch;
  const url = (name) => new URL(baseUrl.replace(/\/?$/, '/') + name, typeof location !== 'undefined' ? location.href : 'http://localhost/').href;

  const [baseRes, metaRes, tgtRes] = await Promise.all([f(url('base.bin')), f(url('index.json')), f(url('targets.bin'))]);
  for (const [r, n] of [[baseRes, 'base.bin'], [metaRes, 'index.json'], [tgtRes, 'targets.bin']]) {
    if (!r.ok) throw templateError(`${n}: HTTP ${r.status}`);
  }
  const [baseBuf, meta, tgtBuf] = await Promise.all([baseRes.arrayBuffer(), metaRes.json(), tgtRes.arrayBuffer()]);

  return decodeTemplate(baseBuf, meta, tgtBuf);
}

/**
 * Pure decoder — separated from the fetching so tests can drive it from local buffers.
 * @param {ArrayBuffer} baseBuf @param {any} meta @param {ArrayBuffer} tgtBuf @returns {Template}
 */
export function decodeTemplate(baseBuf, meta, tgtBuf) {
  const magic = new TextDecoder().decode(new Uint8Array(baseBuf, 0, 8));
  if (magic !== MAGIC) throw templateError(`bad magic ${JSON.stringify(magic)}`);
  const head = new DataView(baseBuf, 8, 12);
  const nVerts = head.getUint32(0, true);
  const nTris = head.getUint32(4, true);
  const toMetres = head.getFloat32(8, true);
  if (nVerts !== meta.nVerts || nTris !== meta.nTris) throw templateError('base.bin disagrees with index.json');

  const posOff = 20;
  const raw = new Float32Array(baseBuf.slice(posOff, posOff + nVerts * 12));
  const indices = new Uint32Array(baseBuf.slice(posOff + nVerts * 12, posOff + nVerts * 12 + nTris * 12));

  // MakeHuman is decimetres with the body straddling y=0; we want metres with the feet on the floor
  // and x centred, because every anchor, measurement and the SDF bake assume that (SPEC 6.1).
  let minY = Infinity, sumX = 0;
  for (let i = 0; i < meta.nBodyVerts; i++) {
    const y = raw[i * 3 + 1];
    if (y < minY) minY = y;
    sumX += raw[i * 3];
  }
  const cx = sumX / meta.nBodyVerts;
  const rest = new Float32Array(nVerts * 3);
  for (let i = 0; i < nVerts; i++) {
    rest[i * 3] = (raw[i * 3] - cx) * toMetres;
    rest[i * 3 + 1] = (raw[i * 3 + 1] - minY) * toMetres;
    rest[i * 3 + 2] = raw[i * 3 + 2] * toMetres;
  }

  /** @type {Map<string, MorphTarget>} */
  const targets = new Map();
  for (const name of Object.keys(meta.targets)) {
    const t = meta.targets[name];
    targets.set(name, {
      idx: new Uint16Array(tgtBuf, t.off, t.n),
      delta: new Int16Array(tgtBuf, t.off + t.n * 2 + ((t.n * 2) % 2), t.n * 3),
      // deltas are stored in MakeHuman units; fold the unit conversion in once, here
      scale: t.scale * toMetres,
    });
  }

  return {
    rest, indices, nVerts, nTris,
    nBodyVerts: meta.nBodyVerts,
    restHeight_m: meta.restHeight_m,
    targets,
    joints: meta.joints,
    has: (name) => targets.has(name),
  };
}

/**
 * out = rest + sum(weight_i * target_i). Weights below `eps` are skipped, which matters: a macro
 * blend touches 6 of ~200 targets but the caller passes the whole dictionary.
 * @param {Template} tpl
 * @param {Iterable<[string, number]>} weights
 * @param {Float32Array} [out] reused buffer, nVerts*3
 * @returns {Float32Array}
 */
export function applyTargets(tpl, weights, out) {
  const dst = out && out.length === tpl.rest.length ? out : new Float32Array(tpl.rest.length);
  dst.set(tpl.rest);
  for (const [name, w] of weights) {
    if (!(w > 1e-6) && !(w < -1e-6)) continue;
    const t = tpl.targets.get(name);
    if (!t) continue;
    const { idx, delta, scale } = t;
    const s = w * scale;
    for (let k = 0, n = idx.length; k < n; k++) {
      const v = idx[k] * 3, d = k * 3;
      dst[v] += delta[d] * s;
      dst[v + 1] += delta[d + 1] * s;
      dst[v + 2] += delta[d + 2] * s;
    }
  }
  return dst;
}

/**
 * Centroid of a joint cube = the anatomical landmark it marks (MakeHuman ships one 8-vertex cube per
 * joint, and the morphs carry them along, so these stay correct for every body shape).
 * @param {Template} tpl @param {Float32Array} pos @param {string} joint @returns {[number, number, number]|null}
 */
export function jointAt(tpl, pos, joint) {
  const range = tpl.joints[joint];
  if (!range) return null;
  let x = 0, y = 0, z = 0;
  const [a, b] = range;
  const n = b - a + 1;
  for (let i = a; i <= b; i++) { x += pos[i * 3]; y += pos[i * 3 + 1]; z += pos[i * 3 + 2]; }
  return [x / n, y / n, z / n];
}

/**
 * Per-vertex normals from the body triangles, area-weighted (the classic accumulate-and-normalise).
 * @param {Template} tpl @param {Float32Array} pos @param {Float32Array} [out] @returns {Float32Array}
 */
export function computeNormals(tpl, pos, out) {
  const n = out && out.length === pos.length ? out : new Float32Array(pos.length);
  n.fill(0);
  const idx = tpl.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const ux = pos[b] - ax, uy = pos[b + 1] - ay, uz = pos[b + 2] - az;
    const vx = pos[c] - ax, vy = pos[c + 1] - ay, vz = pos[c + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
    n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
    n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}
