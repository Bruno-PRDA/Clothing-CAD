// src/body/selftest.js — the 12 cases of SPEC 6.9, plus three for the build model (weight_kg / muscle / age_y).
// Pure; runs under node (no three, no DOM).

import { DEFAULT_BODY_PARAMS } from '../core/schema.js';
import { gridBounds } from '../core/sdf.js';
import { PARAM_DEFS, clampParams, paramsEqual } from './params.js';
import { BODY_PRESETS } from './presets.js';
import { buildSkeleton } from './skeleton.js';
import { describeBuild } from './build.js';
import { analyticBody } from './primitives.js';
import { unitPerimeter, RING_TUNING } from './loft.js';
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
    assert(PARAM_DEFS.length === 23, 'PARAM_DEFS has 23 entries');
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

  results.push(runCase('build.factors', () => {
    const at = (over) => describeBuild({ ...BODY_PRESETS.female_m, ...over });
    const bmi25 = at({ height_cm: 170, weight_kg: 72.25 });
    assert(Math.abs(bmi25.bmi - 25) < 1e-9, 'BMI = weight / height^2, got ' + bmi25.bmi);
    const neutral = at({ height_cm: 170, weight_kg: 63.58, muscle: 0.35 });
    assert(Math.abs(neutral.bmi - 22) < 0.01 && Math.abs(neutral.adiposity) < 0.002, 'BMI 22 at the neutral build must give adiposity 0, got ' + neutral.adiposity);
    assert(at({ muscle: 1 }).tone === 1, 'muscle 1 must reach tone exactly +1, got ' + at({ muscle: 1 }).tone);
    assert(at({ muscle: 0 }).tone < -0.4, 'muscle 0 tone = ' + at({ muscle: 0 }).tone);
    // Muscle displaces fat at equal mass: same weight, more build => less adiposity, more tone.
    const soft = at({ weight_kg: 80, muscle: 0.1 });
    const hard = at({ weight_kg: 80, muscle: 0.9 });
    assert(hard.adiposity < soft.adiposity - 0.1 && hard.tone > soft.tone, 'build must lower adiposity at equal mass ('
      + soft.adiposity.toFixed(2) + ' -> ' + hard.adiposity.toFixed(2) + ')');
    // Never saturates: the shape has to keep moving past the obese anchor (a hard clamp made 95 kg and 120 kg equal
    // on a 1.65 m frame). Strictly monotone everywhere, and still visibly moving across the plausible range.
    let prev = -Infinity;
    for (const w of [40, 55, 70, 85, 100, 120, 160, 200]) {
      const a = at({ weight_kg: w }).adiposity;
      assert(a > prev, 'adiposity must be strictly increasing in weight: ' + w + ' kg gave ' + a.toFixed(5));
      if (w <= 120) assert(a > prev + 0.005, 'adiposity must keep rising with weight: ' + w + ' kg gave ' + a.toFixed(3));
      assert(a > -1 && a < 1, 'adiposity out of range at ' + w + ' kg: ' + a);
      prev = a;
    }
    const P = (id) => describeBuild(BODY_PRESETS[id]);
    assert(P('plus_f').adiposity > P('male_l').adiposity && P('male_l').adiposity > P('female_m').adiposity
      && P('female_m').adiposity > P('child_10').adiposity, 'preset adiposity ordering');
    assert(P('athletic_m').tone === Math.max(...Object.keys(BODY_PRESETS).map((id) => P(id).tone)), 'athletic_m must be the most toned preset');
    assert(P('athletic_m').adiposity < P('female_l').adiposity, 'athletic_m (BMI 24.2, trained) must be leaner than female_l (BMI 24.2, not)');
    return 'child_10 ' + P('child_10').adiposity.toFixed(2) + ', female_m ' + P('female_m').adiposity.toFixed(2)
      + ', male_l ' + P('male_l').adiposity.toFixed(2) + ', plus_f ' + P('plus_f').adiposity.toFixed(2)
      + '; athletic_m tone ' + P('athletic_m').tone.toFixed(2);
  }));

  results.push(runCase('build.shape', () => {
    // Analytic only (no bake): the rings are the shape model, and this is what must actually move.
    const ring = (over, name) => analyticBody(clampParams({ ...BODY_PRESETS.female_m, ...over })).rings[name];
    const front = (r) => r.cz + r.b;
    const back = (r) => r.cz - r.b;
    let pk = -Infinity;
    let pcz = -Infinity;
    let pf = -Infinity;
    const lo = ring({ weight_kg: 45 }, 'abdomen');
    let hi = lo;
    for (const w of [45, 60, 75, 95, 120]) {
      const wr = ring({ weight_kg: w }, 'waist');
      const ab = ring({ weight_kg: w }, 'abdomen');
      const k = wr.b / wr.a;
      assert(k > pk + 0.005, 'waist k must rise with weight: ' + w + ' kg gave ' + k.toFixed(3));
      assert(wr.cz > pcz + 0.0002, 'waist cz must move forward with weight: ' + w + ' kg gave ' + wr.cz.toFixed(4));
      assert(front(ab) > pf + 0.002, 'abdomen front must move forward with weight: ' + w + ' kg gave ' + f3(front(ab)));
      // Constant perimeter: the measured girth is an input, so `a` is re-solved for the new k.
      const C = wr.a * unitPerimeter(wr.b / wr.a, wr.n);
      assert(Math.abs(C - (BODY_PRESETS.female_m.waist_cm / 100 - RING_TUNING.waistReduce)) < 1e-9,
        'waist ring perimeter drifted to ' + C.toFixed(6) + ' m at ' + w + ' kg');
      pk = k; pcz = wr.cz; pf = front(ab); hi = ab;
    }
    const dFront = front(hi) - front(lo);
    const dBack = back(lo) - back(hi);
    assert(dFront > 0.040, 'abdomen only moved forward ' + (dFront * 1000).toFixed(1) + ' mm over 45 -> 120 kg');
    assert(dBack < 0.35 * dFront, 'a belly protrudes forward: front +' + (dFront * 1000).toFixed(1)
      + ' mm but back -' + (dBack * 1000).toFixed(1) + ' mm');
    // Muscle broadens the shoulders and flattens (widens) the chest at the same circumference.
    const sh0 = ring({ muscle: 0 }, 'shoulder');
    const sh1 = ring({ muscle: 1 }, 'shoulder');
    const ch0 = ring({ muscle: 0 }, 'chest');
    const ch1 = ring({ muscle: 1 }, 'chest');
    assert(sh1.a > sh0.a + 0.005, 'muscle must broaden the shoulder ring: ' + f3(sh0.a) + ' -> ' + f3(sh1.a));
    assert(ch1.b / ch1.a < ch0.b / ch0.a - 0.05, 'muscle must flatten the chest section');
    assert(ch1.a > ch0.a, 'flatter at the same circumference means wider: ' + f3(ch0.a) + ' -> ' + f3(ch1.a));
    return 'abdomen front +' + (dFront * 1000).toFixed(0) + ' mm / back -' + (dBack * 1000).toFixed(0)
      + ' mm over 45-120 kg; shoulder a ' + f3(sh0.a) + ' -> ' + f3(sh1.a) + ' m over the build slider';
  }));

  results.push(runCase('build.girthInvariance', () => {
    // The point of the whole model: weight and build reshape the body WITHOUT moving a measured girth. Same
    // tolerances as measure.female_m — this case may never be loosened below them.
    const parts = [];
    for (const over of [{ weight_kg: 45 }, { weight_kg: 95 }, { muscle: 0 }, { muscle: 1 }, { age_y: 75, weight_kg: 78 }]) {
      const p = clampParams({ ...BODY_PRESETS.female_m, ...over });
      const me = buildBody(p, { cell: CELL_FULL }).measured;
      const label = Object.keys(over).map((k) => k + ' ' + over[k]).join('/');
      assert(Math.abs(me.chest_cm - 88) <= 1.5, label + ': chest ' + me.chest_cm);
      assert(Math.abs(me.waist_cm - 70) <= 1.5, label + ': waist ' + me.waist_cm);
      assert(Math.abs(me.hips_cm - 96) <= 2.0, label + ': hips ' + me.hips_cm);
      parts.push(label + ' ' + me.chest_cm + '/' + me.waist_cm + '/' + me.hips_cm);
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
