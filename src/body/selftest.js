// src/body/selftest.js — the 12 cases of SPEC 6.9. Pure; runs under node (no three, no DOM).

import { DEFAULT_BODY_PARAMS } from '../core/schema.js';
import { gridBounds } from '../core/sdf.js';
import { PARAM_DEFS, clampParams, paramsEqual } from './params.js';
import { BODY_PRESETS } from './presets.js';
import { buildSkeleton } from './skeleton.js';
import { buildBody, sampleBody } from './index.js';
import { CELL_FULL, CELL_COARSE } from './bake.js';

/** @typedef {import('../core/types.js').SelfTestResult} SelfTestResult */
/** @typedef {import('../core/types.js').BodyModel} BodyModel */

/** @param {string} name @param {() => string|void} fn @returns {SelfTestResult} */
function runCase(name, fn) {
  try {
    const details = fn();
    return { name, pass: true, details: typeof details === 'string' ? details : 'ok' };
  } catch (err) {
    return { name, pass: false, details: String(err && err.message ? err.message : err) };
  }
}

/** @param {boolean} cond @param {string} msg */
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** @param {number} v @returns {string} */
const f3 = (v) => v.toFixed(3);

/** @returns {Promise<SelfTestResult[]>} */
export async function runSelfTest() {
  /** @type {SelfTestResult[]} */
  const results = [];
  /** @type {BodyModel|null} */
  let femaleM = null;
  /** @type {BodyModel|null} */
  let maleM = null;

  results.push(runCase('presets.clamp', () => {
    assert(paramsEqual(DEFAULT_BODY_PARAMS, BODY_PRESETS.female_m), 'schema.DEFAULT_BODY_PARAMS must equal BODY_PRESETS.female_m');
    assert(PARAM_DEFS.length === 20, 'PARAM_DEFS has 20 entries');
    for (const id of Object.keys(BODY_PRESETS)) {
      const p = BODY_PRESETS[id];
      assert(paramsEqual(clampParams(p), p), 'preset ' + id + ' changed by clampParams');
    }
    const c = clampParams({ height_cm: 999, chest_cm: 88.26, extra: 5 });
    assert(c.height_cm === 210 && c.chest_cm === 88.5 && !('extra' in c) && c.waist_cm === 70, 'clamp/round/default/drop');
    return Object.keys(BODY_PRESETS).length + ' presets';
  }));

  results.push(runCase('skeleton.heights', () => {
    const sk = buildSkeleton(BODY_PRESETS.female_m);
    assert(Math.abs(sk.landmarks.chin[1] - 1.43) <= 1e-6, 'chin.y = ' + sk.landmarks.chin[1]);
    // waist = neckBase - T = (1.43 - 0.012 * 1.65) - 0.40 = 1.0102 (SPEC 6.2 table rounds it to 1.01)
    assert(Math.abs(sk.y.waist - 1.01) <= 1e-3, 'waist = ' + sk.y.waist);
    assert(Math.abs(sk.y.chest - 1.19) <= 1e-3, 'chest = ' + sk.y.chest);
    assert(Math.abs(sk.y.crotch - 0.76) <= 1e-6, 'crotch = ' + sk.y.crotch);
    assert(sk.landmarks.shoulderL[0] > 0 && sk.landmarks.shoulderR[0] < 0, '+x shoulder is shoulderL');
    return 'chin ' + f3(sk.y.chin) + ' waist ' + f3(sk.y.waist) + ' chest ' + f3(sk.y.chest) + ' crotch ' + f3(sk.y.crotch);
  }));

  results.push(runCase('sdf.signs', () => {
    femaleM = buildBody(BODY_PRESETS.female_m, { cell: CELL_FULL });
    const m = femaleM;
    const L = m.landmarks;
    const dChest = sampleBody(m, L.chestCenter[0], L.chestCenter[1], L.chestCenter[2]);
    const dFront = sampleBody(m, L.chestCenter[0], L.chestCenter[1], L.chestCenter[2] + 0.30);
    const dHead = sampleBody(m, L.headTop[0], L.headTop[1] + 0.05, L.headTop[2]);
    const dElbow = sampleBody(m, L.elbowL[0], L.elbowL[1], L.elbowL[2]);
    assert(dChest < -0.05, 'chestCenter d = ' + dChest);
    assert(dFront > 0.15, 'chestCenter + 0.30 z d = ' + dFront);
    assert(dHead > 0.03, 'headTop + 0.05 d = ' + dHead);
    assert(dElbow < 0, 'elbowL d = ' + dElbow);
    return 'chest ' + f3(dChest) + ' front ' + f3(dFront) + ' head ' + f3(dHead) + ' elbow ' + f3(dElbow);
  }));

  results.push(runCase('sdf.armpitClearance', () => {
    assert(femaleM, 'needs female_m');
    const m = /** @type {BodyModel} */ (femaleM);
    const sk = buildSkeleton(m.params);
    const y = sk.y.armpit - 0.05;
    // Upper-arm axis point at that height.
    const d = sk.dirs.dUAL;
    const t = (sk.joints.shoulderL[1] - y) / -d[1];
    const ax = sk.joints.shoulderL[0] + d[0] * t;
    const az = sk.joints.shoulderL[2] + d[2] * t;
    // Torso surface at that height, on the model's left side, found by marching the field from the axis inward.
    let x = ax;
    let inArm = true;
    let torsoX = NaN;
    let armInnerX = NaN;
    while (x > 0) {
      const v = sampleBody(m, x, y, az);
      if (inArm && v > 0) { inArm = false; armInnerX = x; }
      if (!inArm && v <= 0) { torsoX = x; break; }
      x -= 0.001;
    }
    assert(Number.isFinite(torsoX) && Number.isFinite(armInnerX), 'could not find the gap (armInner ' + armInnerX + ', torso ' + torsoX + ')');
    const midX = (armInnerX + torsoX) / 2;
    const dMid = sampleBody(m, midX, y, az);
    assert(dMid >= 0.025, 'midpoint d = ' + f3(dMid) + ' (gap ' + f3(armInnerX - torsoX) + ' m)');
    return 'gap ' + f3(armInnerX - torsoX) + ' m, mid d ' + f3(dMid);
  }));

  results.push(runCase('sdf.gradient', () => {
    assert(femaleM, 'needs female_m');
    const m = /** @type {BodyModel} */ (femaleM);
    const b = gridBounds(m.sdf);
    let seed = 12345;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const g = new Float32Array(3);
    let n = 0;
    let tries = 0;
    let worstNorm = 0;
    let worstStep = Infinity;
    while (n < 200 && tries < 200000) {
      tries++;
      const x = b.min[0] + (b.max[0] - b.min[0]) * rnd();
      const y = b.min[1] + (b.max[1] - b.min[1]) * rnd();
      const z = b.min[2] + (b.max[2] - b.min[2]) * rnd();
      const d = sampleBody(m, x, y, z, g);
      if (!(d > 0 && d < 0.1)) continue;
      n++;
      const norm = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]);
      if (Math.abs(norm - 1) > worstNorm) worstNorm = Math.abs(norm - 1);
      const d2 = sampleBody(m, x + 0.002 * g[0], y + 0.002 * g[1], z + 0.002 * g[2]);
      const inc = d2 - d;
      if (inc < worstStep) worstStep = inc;
      assert(Math.abs(norm - 1) <= 1e-6, '|grad| = ' + norm + ' at ' + [x, y, z].map(f3).join(','));
      assert(inc >= 0.0015, '2 mm step increased d by ' + (inc * 1000).toFixed(2) + ' mm at ' + [x, y, z].map(f3).join(',') + ' (d ' + f3(d) + ')');
    }
    assert(n === 200, 'only ' + n + ' points found');
    return '200 points, worst |grad|-1 ' + worstNorm.toExponential(1) + ', min increase ' + (worstStep * 1000).toFixed(2) + ' mm';
  }));

  results.push(runCase('measure.female_m', () => {
    assert(femaleM, 'needs female_m');
    const m = /** @type {BodyModel} */ (femaleM).measured;
    assert(Math.abs(m.chest_cm - 88) <= 1.5, 'chest ' + m.chest_cm);
    assert(Math.abs(m.waist_cm - 70) <= 1.5, 'waist ' + m.waist_cm);
    assert(Math.abs(m.hips_cm - 96) <= 2.0, 'hips ' + m.hips_cm);
    return 'chest ' + m.chest_cm + ' waist ' + m.waist_cm + ' hips ' + m.hips_cm;
  }));

  results.push(runCase('measure.male_m', () => {
    maleM = buildBody(BODY_PRESETS.male_m, { cell: CELL_FULL });
    const m = maleM.measured;
    assert(Math.abs(m.chest_cm - 98) <= 1.5, 'chest ' + m.chest_cm);
    assert(Math.abs(m.waist_cm - 84) <= 1.5, 'waist ' + m.waist_cm);
    assert(Math.abs(m.hips_cm - 98) <= 2.0, 'hips ' + m.hips_cm);
    return 'chest ' + m.chest_cm + ' waist ' + m.waist_cm + ' hips ' + m.hips_cm;
  }));

  results.push(runCase('measure.allPresets', () => {
    const parts = [];
    for (const id of Object.keys(BODY_PRESETS)) {
      const p = BODY_PRESETS[id];
      const model = id === 'female_m' && femaleM ? femaleM : id === 'male_m' && maleM ? maleM : buildBody(p, { cell: CELL_FULL });
      const data = model.sdf.data;
      for (let i = 0; i < data.length; i++) assert(data[i] === data[i], id + ': NaN in sdf.data at ' + i);
      const dc = model.measured.chest_cm - p.chest_cm;
      assert(Math.abs(dc) <= 2.5, id + ': chest ' + model.measured.chest_cm + ' vs ' + p.chest_cm);
      parts.push(id + ' ' + (dc >= 0 ? '+' : '') + dc.toFixed(1));
    }
    return parts.join(', ');
  }));

  results.push(runCase('anchors.torso', () => {
    assert(femaleM, 'needs female_m');
    const m = /** @type {BodyModel} */ (femaleM);
    const t = m.anchors.torso;
    assert(t.radius >= 0.16 && t.radius <= 0.24, 'torso radius ' + t.radius);
    assert(Math.abs(t.origin[1] - m.landmarks.neckBase[1]) <= 1e-9, 'torso origin.y ' + t.origin[1]);
    for (const name of ['armL', 'armR']) {
      const a = m.anchors[name].axis;
      const len = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
      assert(a[1] < 0, name + ' axis.y = ' + a[1]);
      assert(Math.abs(len - 1) <= 1e-6, name + ' |axis| = ' + len);
    }
    for (const name of ['torso', 'armL', 'armR', 'legL', 'legR', 'skirt', 'head']) {
      const a = m.anchors[name];
      const dot = a.axis[0] * a.front[0] + a.axis[1] * a.front[1] + a.axis[2] * a.front[2];
      assert(Math.abs(dot) <= 1e-6, name + ' front not perpendicular to axis');
      assert(a.length > 0 && a.radius > 0, name + ' bad size');
    }
    return 'torso radius ' + f3(t.radius) + ' length ' + f3(t.length);
  }));

  results.push(runCase('mesh.valid', () => {
    assert(femaleM, 'needs female_m');
    const g = /** @type {BodyModel} */ (femaleM).geometry;
    const nv = g.positions.length / 3;
    assert(g.indices.length % 3 === 0, 'indices % 3');
    assert(nv >= 10000, 'vertices ' + nv);
    assert(g.normals.length === g.positions.length, 'normals length');
    for (let i = 0; i < g.indices.length; i++) assert(g.indices[i] < nv, 'index out of range at ' + i);
    for (let i = 0; i < g.positions.length; i++) {
      assert(g.positions[i] === g.positions[i] && g.normals[i] === g.normals[i], 'NaN in geometry at ' + i);
    }
    return nv + ' vertices, ' + g.indices.length / 3 + ' triangles';
  }));

  results.push(runCase('perf.full', () => {
    const m = buildBody(BODY_PRESETS.female_m, { cell: CELL_FULL });
    const coarse = buildBody(BODY_PRESETS.female_m, { cell: CELL_COARSE, reuseGeometry: m.geometry });
    const coarseNoReuse = buildBody(BODY_PRESETS.female_m, { cell: CELL_COARSE });
    const nodes = m.sdf.nx * m.sdf.ny * m.sdf.nz;
    assert(m.buildMs < 400, 'full build ' + m.buildMs.toFixed(0) + ' ms');
    assert(coarse.buildMs < 80, 'coarse build ' + coarse.buildMs.toFixed(0) + ' ms');
    assert(coarse.geometry === m.geometry, 'coarse build must reuse the geometry');
    return 'full ' + m.buildMs.toFixed(0) + ' ms (' + m.sdf.nx + 'x' + m.sdf.ny + 'x' + m.sdf.nz + ' = ' + nodes + ' nodes), coarse '
      + coarse.buildMs.toFixed(0) + ' ms (reused mesh), coarse+mesh ' + coarseNoReuse.buildMs.toFixed(0) + ' ms';
  }));

  results.push(runCase('stability.range', () => {
    /** @type {any} */
    const lo = {};
    /** @type {any} */
    const hi = {};
    for (const d of PARAM_DEFS) { lo[d.key] = d.min; hi[d.key] = d.max; }
    const parts = [];
    for (const [label, p] of [['min', lo], ['max', hi]]) {
      const m = buildBody(p, { cell: CELL_COARSE });
      const data = m.sdf.data;
      for (let i = 0; i < data.length; i++) assert(Number.isFinite(data[i]), label + ': non-finite grid value at ' + i);
      const me = m.measured;
      assert(Number.isFinite(me.chest_cm) && Number.isFinite(me.waist_cm) && Number.isFinite(me.hips_cm), label + ': non-finite measured');
      for (let i = 0; i < m.geometry.positions.length; i++) assert(Number.isFinite(m.geometry.positions[i]), label + ': non-finite mesh');
      parts.push(label + ': chest ' + me.chest_cm + ' waist ' + me.waist_cm + ' hips ' + me.hips_cm);
    }
    return parts.join('; ');
  }));

  return results;
}
