// src/cloth/selftest.js — the 12 cases of SPEC section 7.13 (plus arrange.frame). Pure; runs under node and in the browser.

import { resolveFabric } from '../core/fabrics.js';
import { makeSphereGrid } from '../core/sdf.js';
import {
  buildCloth, arrange, step, stats, setFabricParams, snapshot, restore, selfMaskedPairCount,
  bendingCoefficients, bendingC, solveDistance, solveBending,
  makeHangingSheet, makeSphereDrape, makeSeamFixture, makeSlopeFixture, makeLatticeMesh,
  findTears, TEAR_STRAIN, TEAR_GAP_M, CLUSTER_M,
} from './index.js';

/** @typedef {import('../core/types.js').SelfTestResult} SelfTestResult */
/** @typedef {import('../core/types.js').FabricResolved} FabricResolved */

const SQRT3 = Math.sqrt(3);

/** @param {string} preset @returns {FabricResolved} */
function fab(preset) {
  return resolveFabric({ id: 'fx', name: 'fx', preset, color: '#888888', texture: { kind: 'solid', scale_mm: 20, color2: '#888888' }, overrides: {} });
}

/** @param {number} v @param {number} d @returns {string} */
function f(v, d = 2) { return Number.isFinite(v) ? v.toFixed(d) : String(v); }

/** @param {boolean} c @param {string} msg */
function assert(c, msg) { if (!c) throw new Error(msg); }

/** @param {import('../core/types.js').ClothState} st @returns {number} max edge strain */
function maxStrain(st) {
  let m = 0;
  const E = st.eRest.length;
  for (let e = 0; e < E; e++) {
    const i = st.eIdx[2 * e]; const j = st.eIdx[2 * e + 1];
    const dx = st.pos[3 * i] - st.pos[3 * j]; const dy = st.pos[3 * i + 1] - st.pos[3 * j + 1]; const dz = st.pos[3 * i + 2] - st.pos[3 * j + 2];
    const s = Math.abs(Math.sqrt(dx * dx + dy * dy + dz * dz) - st.eRest[e]) / st.eRest[e];
    if (s > m) m = s;
  }
  return m;
}

/** @param {import('../core/types.js').ClothState} st @returns {boolean} */
function allFinite(st) {
  for (let i = 0; i < st.pos.length; i++) if (!Number.isFinite(st.pos[i])) return false;
  return true;
}

/** @param {import('../core/types.js').ClothState} st @returns {[number, number, number]} */
function centreOfMass(st) {
  let x = 0; let y = 0; let z = 0;
  for (let v = 0; v < st.V; v++) { x += st.pos[3 * v]; y += st.pos[3 * v + 1]; z += st.pos[3 * v + 2]; }
  return [x / st.V, y / st.V, z / st.V];
}

/** Section 13.4 sag measurement. @param {string} preset @param {number} [spacing] @param {number} [frames] */
function sagOf(preset, spacing = 10, frames = 600) {
  const st = makeHangingSheet({ fabric: fab(preset), width_m: 0.3, height_m: 0.3, spacing_mm: spacing, pinTopCorners: true, selfCollision: true });
  for (let i = 0; i < frames; i++) step(st, null);
  const nx = Math.round(300 / spacing) + 1;
  const last = nx - 1;
  const bl = last * nx; const br = last * nx + last; const bm = last * nx + (last >> 1);
  const yBL = st.pos[3 * bl + 1]; const yBR = st.pos[3 * br + 1]; const yBM = st.pos[3 * bm + 1];
  const spread = Math.hypot(st.pos[3 * br] - st.pos[3 * bl], st.pos[3 * br + 1] - yBL, st.pos[3 * br + 2] - st.pos[3 * bl + 2]);
  return { sag_mm: ((yBL + yBR) / 2 - yBM) * 1000, spread_mm: spread * 1000, nan: st.nanCount, strain: maxStrain(st), maxSpeed: stats(st).maxSpeed };
}

/** @returns {Promise<SelfTestResult[]>} */
export async function runSelfTest() {
  /** @type {SelfTestResult[]} */
  const results = [];
  const nowMs = (typeof performance !== 'undefined') ? () => performance.now() : () => Date.now();
  /** @param {string} name @param {() => string|void} fn */
  function check(name, fn) {
    const t0 = nowMs();
    try {
      const d = fn();
      results.push({ name, pass: true, details: (d || 'ok') + ' [' + (nowMs() - t0).toFixed(0) + ' ms]' });
    } catch (e) {
      results.push({ name, pass: false, details: (e && e.message) ? e.message : String(e) });
    }
  }

  check('bend.flat', () => {
    const h = 0.015;
    const y = h * SQRT3 / 2;
    // stencil x0, x1 (shared edge), x2 (opposite in A), x3 (opposite in B)
    const pos = new Float32Array([0, 0, 0, h, 0, 0, h / 2, y, 0, h / 2, -y, 0]);
    const bIdx = new Uint32Array([0, 1, 2, 3]);
    const bK = new Float32Array(4);
    const s = bendingCoefficients(0, 0, h, 0, h / 2, y, h / 2, -y, bK, 0);
    const bS = new Float32Array([s]);
    const c0 = bendingC(pos, bIdx, bK, bS, 0);
    assert(Math.abs(c0) < 1e-6, 'flat stencil C = ' + c0);
    // a non-symmetric flat stencil must also give C = 0 (K annihilates affine maps)
    const bK2 = new Float32Array(4);
    const s2 = bendingCoefficients(0, 0, 0.02, 0, 0.005, 0.01, 0.015, -0.02, bK2, 0);
    const pos2 = new Float32Array([0, 0, 0, 0.02, 0, 0, 0.005, 0.01, 0, 0.015, -0.02, 0]);
    const c2 = bendingC(pos2, bIdx, bK2, new Float32Array([s2]), 0);
    assert(Math.abs(c2) < 1e-6, 'skewed flat stencil C = ' + c2);
    pos[11] = 0.005;
    const c1 = bendingC(pos, bIdx, bK, bS, 0);
    assert(c1 > 0, 'lifted stencil C = ' + c1);
    const invMass = new Float32Array([1, 1, 1, 1]);
    solveBending(pos, invMass, bIdx, bK, bS, new Float32Array([0]), 360000);
    const c3 = bendingC(pos, bIdx, bK, bS, 0);
    assert(Math.abs(c3) <= 0.1 * c1, 'projection left ' + c3 + ' of ' + c1);
    return 'C_flat=' + c0.toExponential(1) + ' C_lift=' + c1.toExponential(2) + ' after=' + c3.toExponential(2) + ' K=' + Array.from(bK).map((k) => f(k, 3)).join(',');
  });

  check('distance.rigid', () => {
    const cotton = fab('cotton');
    const h = 0.015;
    const A = SQRT3 / 2 * h * h;
    const w = 1 / (cotton.physics.density_kgm2 * A);
    const L = h;
    const pos = new Float32Array([0, 0, 0, 1.1 * L, 0, 0]);
    const eIdx = new Uint32Array([0, 1]);
    const eRest = new Float32Array([L]);
    const eAlpha = new Float32Array([2 / (SQRT3 * cotton.physics.membrane_Nm)]);
    solveDistance(pos, new Float32Array([w, w]), eIdx, eRest, eAlpha, 360000);
    const d = Math.abs(pos[3] - pos[0]);
    const strain = Math.abs(d - L) / L;
    assert(strain < 0.005, 'strain after one substep ' + strain);
    return 'strain=' + (strain * 100).toExponential(2) + ' %';
  });

  check('sheet.cotton', () => {
    const st = makeHangingSheet({ fabric: fab('cotton'), width_m: 0.3, height_m: 0.3, spacing_mm: 10, pinTopCorners: true, selfCollision: true });
    let s = stats(st);
    for (let i = 0; i < 300; i++) s = step(st, null);
    const strain = maxStrain(st);
    assert(st.nanCount === 0, 'nanCount ' + st.nanCount);
    assert(strain < 0.03, 'max strain ' + strain);
    assert(s.maxSpeed < 0.3, 'maxSpeed ' + s.maxSpeed);
    return 'V=' + st.V + ' strain=' + (strain * 100).toFixed(2) + '% maxSpeed=' + f(s.maxSpeed, 3) + ' msAvg=' + f(s.msAvg, 2);
  });

  // Fabric drape ordering. NOTE (lead, 2026-09-14): this check used to run on makeHangingSheet, but a rectangle
  // pinned at its own two top corners is a degenerate fixture — the top chord equals its rest length, gravity lies in
  // the sheet's plane, and for an inextensible sheet the flat rectangle IS the exact gravitational minimum, so sag is
  // ~0.1 mm for every preset and is independent of bend_Nm (a bendScale sweep over 1e-3..1e2 moves it 0.16 -> 0.13 mm).
  // It could never order fabrics by stiffness. The physically meaningful test of drape stiffness is a sheet falling
  // over a sphere: the hem depth is set by the bending wavelength, and it orders by B/rho as SPEC 9.1 intends.
  // Thresholds are unchanged in spirit (ordering + a >= 10 mm spread); only the fixture is corrected.
  check('drape.ordering', () => {
    const names = ['chiffon', 'silk', 'cotton', 'denim'];
    const r = names.map((n) => {
      const { state: st, sdf } = makeSphereDrape({ fabric: fab(n), width_m: 0.4, spacing_mm: 12, sphereRadius: 0.15, dropHeight: 0.25 });
      for (let i = 0; i < 500; i++) step(st, sdf);
      let minY = Infinity;
      for (let v = 0; v < st.V; v++) { const y = st.pos[3 * v + 1]; if (y < minY) minY = y; }
      return { name: n, hem_mm: (0.25 - minY) * 1000, nan: st.nanCount, pen: stats(st).maxPenetration_mm };
    });
    const det = r.map((x) => x.name + ' hem=' + f(x.hem_mm, 1)).join('; ');
    for (const x of r) assert(x.nan === 0, 'nan in ' + x.name + ': ' + det);
    for (const x of r) assert(x.pen < 2, 'penetration ' + f(x.pen, 2) + ' mm in ' + x.name);
    assert(r[0].hem_mm > r[1].hem_mm && r[1].hem_mm > r[2].hem_mm && r[2].hem_mm > r[3].hem_mm, 'ordering failed: ' + det);
    assert(r[0].hem_mm - r[3].hem_mm >= 10, 'chiffon - denim < 10 mm: ' + det);
    return det;
  });

  check('sphere.penetration', () => {
    const { state: st, sdf } = makeSphereDrape({ fabric: fab('cotton'), width_m: 0.4, spacing_mm: 12, sphereRadius: 0.15, dropHeight: 0.25 });
    let s = stats(st);
    let worst = 0;
    for (let i = 0; i < 240; i++) { s = step(st, sdf); if (i > 60 && s.maxPenetration_mm > worst) worst = s.maxPenetration_mm; }
    assert(st.nanCount === 0, 'nanCount ' + st.nanCount);
    assert(s.maxPenetration_mm < 2, 'maxPenetration_mm ' + s.maxPenetration_mm);
    return 'V=' + st.V + ' pen=' + f(s.maxPenetration_mm, 3) + ' mm (worst after 1 s ' + f(worst, 2) + ') maxSpeed=' + f(s.maxSpeed, 3) + ' msAvg=' + f(s.msAvg, 2);
  });

  check('seam.close', () => {
    const { state: st } = makeSeamFixture({ fabric: fab('cotton'), spacing_mm: 10 });
    assert(st.params.sewTime === 1, 'sewTime ' + st.params.sewTime);
    assert(st.sRest0.length === 11, 'seam pairs ' + st.sRest0.length);
    let s = stats(st);
    const gap0 = (() => { const i = st.sIdx[0]; const j = st.sIdx[1]; return Math.abs(st.pos[3 * i] - st.pos[3 * j]) * 1000; })();
    for (let i = 0; i < 120; i++) s = step(st, null);
    assert(st.nanCount === 0, 'nanCount ' + st.nanCount);
    assert(s.seamGapMax_mm < 2, 'seamGapMax_mm ' + s.seamGapMax_mm);
    return 'gap0=' + f(gap0, 1) + ' mm -> gapMax=' + f(s.seamGapMax_mm, 3) + ' mean=' + f(s.seamGapMean_mm, 3) + ' strain=' + (maxStrain(st) * 100).toFixed(2) + '%';
  });

  check('friction.slope', () => {
    const run = (mu) => {
      const { state: st, sdf } = makeSlopeFixture({ fabric: fab('cotton'), mu, size_m: 0.2, spacing_mm: 10 });
      const c0 = centreOfMass(st);
      for (let i = 0; i < 120; i++) step(st, sdf);
      const c1 = centreOfMass(st);
      return { move: Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]) * 1000, nan: st.nanCount };
    };
    const a = run(0.6);
    const b = run(0.05);
    assert(a.nan === 0 && b.nan === 0, 'nan');
    assert(a.move < 5, 'mu 0.6 moved ' + a.move + ' mm');
    assert(b.move > 50, 'mu 0.05 moved ' + b.move + ' mm');
    return 'mu0.6=' + f(a.move, 2) + ' mm, mu0.05=' + f(b.move, 1) + ' mm';
  });

  check('determinism', () => {
    const mk = () => makeHangingSheet({ fabric: fab('silk'), width_m: 0.2, height_m: 0.2, spacing_mm: 10, pinTopCorners: true, selfCollision: true });
    const a = mk();
    const b = mk();
    for (let i = 0; i < 60; i++) { step(a, null); step(b, null); }
    for (let i = 0; i < a.pos.length; i++) assert(a.pos[i] === b.pos[i], 'pos differs at ' + i);
    return 'bit-identical over ' + a.pos.length + ' floats';
  });

  check('nan.recovery', () => {
    const st = makeHangingSheet({ fabric: fab('cotton'), width_m: 0.2, height_m: 0.2, spacing_mm: 10, pinTopCorners: true, selfCollision: true });
    for (let i = 0; i < 5; i++) step(st, null);
    const victims = [40, 95, 150, 207, 301];
    for (const v of victims) st.pos[3 * v] = NaN;
    const s = step(st, null);
    assert(st.nanCount === 5, 'nanCount ' + st.nanCount);
    assert(s.nanCount === 5, 'stats.nanCount ' + s.nanCount);
    assert(allFinite(st), 'pos not finite');
    step(st, null);
    assert(st.nanCount === 5 && allFinite(st), 'second frame nanCount ' + st.nanCount);
    return 'nanCount=' + st.nanCount + ' pos finite';
  });

  check('fabric.switch', () => {
    const st = makeHangingSheet({ fabric: fab('cotton'), width_m: 0.2, height_m: 0.2, spacing_mm: 10, pinTopCorners: true, selfCollision: true });
    for (let i = 0; i < 30; i++) step(st, null);
    setFabricParams(st, 0, fab('leather'));
    const want = 2 / (SQRT3 * 50000);
    for (let e = 0; e < st.eAlpha.length; e++) assert(Math.abs(st.eAlpha[e] - want) <= 1e-6 * want, 'eAlpha[' + e + '] = ' + st.eAlpha[e]);
    for (let b = 0; b < st.bAlpha.length; b++) assert(Math.abs(st.bAlpha[b] - 1 / 5e-3) <= 1e-6 * 200, 'bAlpha');
    assert(st.invMass[0] === 0 && st.invMass[1] > 0, 'pins kept');
    for (let i = 0; i < 120; i++) step(st, null);
    assert(st.nanCount === 0, 'nanCount ' + st.nanCount);
    return 'eAlpha=' + want.toExponential(4) + ' strain=' + (maxStrain(st) * 100).toFixed(2) + '%';
  });

  check('perf.4k', () => {
    const st = makeHangingSheet({ fabric: fab('cotton'), width_m: 0.63, height_m: 0.62, spacing_mm: 10, pinTopCorners: true, selfCollision: true });
    let s = stats(st);
    for (let i = 0; i < 60; i++) s = step(st, null);
    assert(s.msAvg < 12, 'msAvg ' + s.msAvg);
    const sec = s.sectionMs;
    return 'V=' + st.V + ' msAvg=' + f(s.msAvg, 2) + ' last=' + f(s.ms, 2) + ' [int ' + f(sec.integrate, 2) + ' dist ' + f(sec.distance, 2) + ' bend ' + f(sec.bend, 2) + ' seam ' + f(sec.seam, 2) + ' self ' + f(sec.self, 2) + ']';
  });

  check('selfcollision.mask', () => {
    const { state: st } = makeSeamFixture({ fabric: fab('cotton'), spacing_mm: 10 });
    let s = stats(st);
    for (let i = 0; i < 120; i++) s = step(st, null);
    const n = selfMaskedPairCount(st);
    assert(n === 0, 'masked pairs processed: ' + n);
    assert(s.seamGapMax_mm < 2, 'seam did not close: ' + s.seamGapMax_mm);
    return 'masked pairs=0, excl entries=' + st.exclList.length + ', gapMax=' + f(s.seamGapMax_mm, 3);
  });

  check('arrange.frame', () => {
    // torso anchor: front → +z half-space, pattern +x → +x; back → −z, pattern +x → −x; top of the outline at the origin
    const mesh = makeLatticeMesh({ nx: 5, ny: 5, spacing_mm: 20, x0_mm: -40, y0_mm: 0, pieceId: 'p', stagger: false });
    const anchors = {
      torso: { origin: [0, 1.4, 0], axis: [0, -1, 0], front: [0, 0, 1], radius: 0.2, length: 0.8 },
    };
    const body = /** @type {any} */ ({ anchors, sdf: makeSphereGrid([0, 1.0, 0], 0.15, 0.02, 0.05) });
    const mk = (side, wrap, flip) => {
      const doc = /** @type {any} */ ({ pieces: [{ id: 'p', fabricId: 'fx', layer: 0, simulate: true, pinnedEdges: [], placement: { anchor: 'torso', side, offset_mm: [0, 0], wrap, flip } }], seams: [], sim: { substeps: 10, gravity_ms2: 9.81, selfCollision: true, sewTime_s: 1, collisionOffset_mm: 5, bendScale: 1, stretchScale: 1 } });
      const st = buildCloth({ meshes: [mesh], doc, fabrics: new Map([['fx', fab('cotton')]]) });
      arrange(st, body, doc);
      return st;
    };
    const fr = mk('front', 1, false);
    // vertex 0 is row 0 (top), col 0 (x = −40); vertex 4 is top-right (x = +40)
    assert(fr.pos[2] > 0 && fr.pos[3 * 4 + 2] > 0, 'front not on +z');
    assert(fr.pos[3 * 4] > fr.pos[0], 'pattern +x is not 3D +x on the front');
    assert(Math.abs(fr.pos[3 * 2 + 1] - 1.4) < 1e-6, 'top row not at the origin height: ' + fr.pos[3 * 2 + 1]);
    assert(fr.pos[3 * 22 + 1] < 1.4 - 0.079, 'rows do not go down the axis');
    const bk = mk('back', 1, false);
    assert(bk.pos[2] < 0, 'back not on −z');
    assert(bk.pos[3 * 4] < bk.pos[0], 'pattern +x is not 3D −x on the back');
    const lf = mk('left', 0, false);
    assert(lf.pos[3 * 2] > 0.19, 'left not on +x: ' + lf.pos[3 * 2]);
    assert(lf.pos[3 * 4 + 2] < lf.pos[2], 'pattern +x is not −z on the left side');
    const fl = mk('front', 0.5, true);
    assert(fl.pos[3 * 4] < fl.pos[0], 'flip did not mirror x');
    assert(fr.frame === 0 && fr.time === 0 && fr.pIdx.length === 0, 'state not reset');
    return 'front z=' + f(fr.pos[3 * 2 + 2], 3) + ' back z=' + f(bk.pos[3 * 2 + 2], 3) + ' left x=' + f(lf.pos[3 * 2], 3);
  });


  check('tears.find', () => {
    // Four vertices: an edge stretched to twice its rest length, an edge at rest, and a seam pair 20 mm apart.
    const pos = new Float32Array([0, 0, 0, 0.10, 0, 0, 0, 0.5, 0, 0.02, 0.5, 0]);
    const state = /** @type {any} */ ({
      pos, eIdx: new Uint32Array([0, 1, 2, 3]), eRest: new Float32Array([0.05, 0.02]), sIdx: new Uint32Array([2, 3]),
    });
    const r = findTears(state);
    assert(r.strainCount === 1 && r.seamCount === 1, 'expected one strain and one seam, got ' + r.strainCount + '/' + r.seamCount);
    assert(r.marks.length === 2, 'two separate marks expected, got ' + r.marks.length);
    assert(Math.abs(r.worstStrain - 1) < 1e-6 && Math.abs(r.worstGap_mm - 20) < 1e-3, 'worst ' + r.worstStrain + ' / ' + r.worstGap_mm + ' mm');
    const kinds = r.marks.map((m) => m.kind).sort().join(',');
    assert(kinds === 'seam,strain', 'kinds ' + kinds);
    for (const m of r.marks) assert(m.severity > 0 && m.severity <= 1, 'severity out of range: ' + m.severity);
    // below both limits: nothing to show
    pos[3] = 0.05 * (1 + TEAR_STRAIN * 0.5);
    pos[9] = TEAR_GAP_M * 0.5;
    const calm = findTears(state);
    assert(calm.marks.length === 0, 'a relaxed state must have no marks, got ' + calm.marks.length);
    // marks closer than CLUSTER_M merge into the worst one
    const near = /** @type {any} */ ({
      pos: new Float32Array([0, 0, 0, 0.10, 0, 0, 0, 0.01, 0, 0.08, 0.01, 0]),
      eIdx: new Uint32Array([0, 1, 2, 3]), eRest: new Float32Array([0.05, 0.08 / 1.4]), sIdx: null,
    });
    const merged = findTears(near);
    assert(CLUSTER_M > 0.02 && merged.strainCount === 2 && merged.marks.length === 1, 'two nearby strains must merge into one mark, got ' + merged.marks.length);
    assert(Math.abs(merged.marks[0].value - 1) < 1e-6, 'the merged mark must keep the worse strain, got ' + merged.marks[0].value);
    return 'strain + seam found, relaxed state clean, nearby marks merged';
  });
  return results;
}
