// src/core/schema.js — normalize, serialize, validate, migrate (SPEC section 3.4).
// Imports types.js, ids.js and fabrics.js only; never geometry/ (the little geometry it needs is inlined).

import { uid } from './ids.js';
import { getPreset, hasPreset, TEXTURE_KINDS, PHYSICS_KEYS, isHexColor, FABRIC_PRESET_IDS } from './fabrics.js';

/** @typedef {import('./types.js').ProjectDoc} ProjectDoc */
/** @typedef {import('./types.js').Piece} Piece */
/** @typedef {import('./types.js').Edge} Edge */
/** @typedef {import('./types.js').Seam} Seam */
/** @typedef {import('./types.js').SeamSide} SeamSide */
/** @typedef {import('./types.js').FabricInstance} FabricInstance */
/** @typedef {import('./types.js').BodyParams} BodyParams */
/** @typedef {import('./types.js').SizeChart} SizeChart */
/** @typedef {import('./types.js').SizeRow} SizeRow */
/** @typedef {import('./types.js').SimSettings} SimSettings */
/** @typedef {import('./types.js').UiState} UiState */
/** @typedef {import('./types.js').Placement} Placement */
/** @typedef {import('./types.js').Grading} Grading */
/** @typedef {import('./types.js').Issue} Issue */
/** @typedef {import('./types.js').Vec2} Vec2 */

export const DOC_VERSION = 1;
export const DEFAULT_BODY_PRESET = 'female_m';

/** @type {Readonly<BodyParams>} MUST equal body/presets.js female_m (section 6.1); body/selftest.js asserts this. */
export const DEFAULT_BODY_PARAMS = Object.freeze({
  height_cm: 165, chest_cm: 88, underbust_cm: 76, waist_cm: 70, hips_cm: 96, shoulderWidth_cm: 38, neck_cm: 34,
  upperArm_cm: 27, forearm_cm: 23, wrist_cm: 15.5, thigh_cm: 54, calf_cm: 36, ankle_cm: 22, armLength_cm: 56,
  inseam_cm: 76, torsoLength_cm: 40, headHeight_cm: 22, bustFullness: 0.4, armAbduction_deg: 30, legSpread_deg: 6,
  weight_kg: 58.5, muscle: 0.35, age_y: 30, sex: 1,
});
/** @type {ReadonlyArray<string>} the 24 keys, in the order above */
export const BODY_PARAM_KEYS = Object.freeze(Object.keys(DEFAULT_BODY_PARAMS));
export const DEFAULT_SIZE_MEASUREMENTS = Object.freeze([
  'chest_cm', 'waist_cm', 'hips_cm', 'height_cm', 'torsoLength_cm', 'armLength_cm', 'shoulderWidth_cm',
]);

const ANCHORS = Object.freeze(['torso', 'armL', 'armR', 'legL', 'legR', 'skirt', 'head']);
const SIDES = Object.freeze(['front', 'back', 'left', 'right']);
const ANCHOR_X = Object.freeze(['fold', 'center', 'left', 'right']);
const ANCHOR_Y = Object.freeze(['top', 'center', 'bottom']);
const LAYOUTS = Object.freeze(['split', '2d', '3d']);

/**
 * Scene presets of the 3D view: ids and labels only (pure data, so the UI can list them without three.js).
 * The look of each one — backdrop, floor, props — is src/viewer3d/stage.js STAGE_PRESETS, keyed by the same
 * ids; the viewer self-test `stage.presets` asserts the two lists match.
 */
export const SCENE_PRESETS = Object.freeze([
  Object.freeze({ id: 'workshop', label: 'Workshop grid' }),
  Object.freeze({ id: 'studio', label: 'Light studio' }),
  Object.freeze({ id: 'dark', label: 'Dark studio' }),
  Object.freeze({ id: 'pedestal', label: 'Pedestal' }),
  Object.freeze({ id: 'runway', label: 'Runway' }),
  Object.freeze({ id: 'wood', label: 'Wooden floor' }),
  Object.freeze({ id: 'terrace', label: 'Terrace' }),
]);
export const DEFAULT_SCENE = 'workshop';
const SCENE_IDS = Object.freeze(SCENE_PRESETS.map((p) => p.id));
const HEX6 = /^#[0-9a-fA-F]{6}$/;

/**
 * @param {*} v @returns {{preset: string, background: string|null}} a valid scene: unknown preset -> default,
 * a background that is not #rrggbb -> null (= the preset's own backdrop)
 */
function normalizeScene(v) {
  const s = isObj(v) ? v : {};
  return {
    preset: oneOf(s.preset, SCENE_IDS, DEFAULT_SCENE),
    background: typeof s.background === 'string' && HEX6.test(s.background) ? s.background.toLowerCase() : null,
  };
}
const DOCK_TABS = Object.freeze(['pieces', 'body', 'fabric', 'sizes']);
const EDGE_TYPES = Object.freeze(['line', 'cubic']);
const NOTCH_KINDS = Object.freeze(['single', 'double']);
const LINE_KINDS = Object.freeze(['fold', 'dart', 'mark']);

// ---------------------------------------------------------------------------------------------------------
// Local helpers (section 3.4.1)
// ---------------------------------------------------------------------------------------------------------

/** @param {*} v @param {number} def @returns {number} */
function num(v, def) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return def;
}
/** @param {*} v @param {number} def @returns {number} */
function int(v, def) {
  return Math.trunc(num(v, def));
}
/** @param {*} v @param {boolean} def @returns {boolean} */
function bool(v, def) {
  return typeof v === 'boolean' ? v : def;
}
/** @param {*} v @param {string} def @returns {string} */
function str(v, def) {
  return (typeof v === 'string' && v !== '') ? v : def;
}
/** @param {*} v @returns {boolean} */
function isVec2(v) {
  return Array.isArray(v) && v.length === 2
    && typeof v[0] === 'number' && Number.isFinite(v[0])
    && typeof v[1] === 'number' && Number.isFinite(v[1]);
}
/** @param {*} v @param {Vec2|null} def @returns {Vec2|null} */
function vec2(v, def) {
  if (isVec2(v)) return [v[0], v[1]];
  return def ? [def[0], def[1]] : null;
}
/**
 * @template T
 * @param {*} v @param {ReadonlyArray<T>} list @param {T} def @returns {T}
 */
function oneOf(v, list, def) {
  return list.includes(v) ? v : def;
}
/** @param {*} v @param {string} def @returns {string} */
function hex(v, def) {
  return isHexColor(v) ? v.toLowerCase() : def;
}
/** @param {*} v @returns {boolean} */
function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
/** @param {number} v @param {number} lo @param {number} hi @returns {number} */
function clampNum(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}
/** @param {string} code @param {string} message @returns {Error} */
function codedError(code, message) {
  const err = new Error(message);
  // @ts-ignore
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------------------------------------
// Fresh defaults
// ---------------------------------------------------------------------------------------------------------

/** @returns {SizeChart} fresh default chart (rows S/M/L/XL, base M) */
export function defaultSizeChart() {
  return {
    measurements: DEFAULT_SIZE_MEASUREMENTS.slice(),
    baseSize: 'M',
    rows: [
      { name: 'S', chest_cm: 84, waist_cm: 66, hips_cm: 92, height_cm: 160, torsoLength_cm: 39, armLength_cm: 55, shoulderWidth_cm: 37 },
      { name: 'M', chest_cm: 88, waist_cm: 70, hips_cm: 96, height_cm: 165, torsoLength_cm: 40, armLength_cm: 56, shoulderWidth_cm: 38 },
      { name: 'L', chest_cm: 92, waist_cm: 74, hips_cm: 100, height_cm: 170, torsoLength_cm: 41, armLength_cm: 57, shoulderWidth_cm: 39 },
      { name: 'XL', chest_cm: 96, waist_cm: 78, hips_cm: 104, height_cm: 175, torsoLength_cm: 42, armLength_cm: 58, shoulderWidth_cm: 40 },
    ],
  };
}

/** @returns {SimSettings} */
export function defaultSimSettings() {
  return {
    substeps: 10, gravity_ms2: 9.81, selfCollision: true, sewTime_s: 1.0,
    collisionOffset_mm: 5, bendScale: 1, stretchScale: 1,
  };
}

/** @param {string} [baseSize='M'] @returns {UiState} */
export function defaultUiState(baseSize = 'M') {
  return { split: 0.5, layout: 'split', swapped: false, activeSize: baseSize, dockTab: 'pieces', scene: { preset: DEFAULT_SCENE, background: null } };
}

/** @returns {Placement} */
export function defaultPlacement() {
  return { anchor: 'torso', side: 'front', offset_mm: [0, 0], wrap: 1, flip: false };
}

/** @returns {Grading} */
export function defaultGrading() {
  return { widthRef: 'chest_cm', lengthRef: 'torsoLength_cm', anchorX: 'center', anchorY: 'top', vertexRules: [] };
}

// ---------------------------------------------------------------------------------------------------------
// normalize
// ---------------------------------------------------------------------------------------------------------

/** @param {*} v @returns {BodyParams} */
function normalizeBodyParams(v, presetId) {
  const src = isObj(v) ? v : {};
  /** @type {any} */
  const out = {};
  for (const key of BODY_PARAM_KEYS) out[key] = num(src[key], DEFAULT_BODY_PARAMS[key]);
  // `sex` did not exist before 2026-09-18, so every document saved earlier lacks it, and filling it
  // from DEFAULT_BODY_PARAMS (female_m, sex 1) silently loaded every saved MALE body as a fully
  // female template blend — chest, waist and hips then solved to the right numbers on the wrong
  // frame, so nothing looked broken. Infer it instead.
  if (!(typeof src.sex === 'number' && Number.isFinite(src.sex))) out.sex = inferSex(src, presetId);
  return out;
}

/**
 * Sex for a body that never recorded one. The preset name is decisive when it names a sex; otherwise
 * bust fullness is the only clue the old model carried (its macro layer used exactly this test), and a
 * flat-chested woman saved without a preset loads male — the least-wrong reading of no information.
 * @param {any} src @param {string} [presetId] @returns {number}
 */
function inferSex(src, presetId) {
  const p = typeof presetId === 'string' ? presetId : '';
  if (/^(female|plus)/.test(p)) return 1;
  if (/^(male|athletic)/.test(p)) return 0;
  if (/^child/.test(p)) return 0.5;
  const bust = isObj(src) ? num(src.bustFullness, NaN) : NaN;
  return Number.isFinite(bust) && bust > 0.05 ? 1 : 0;
}

/**
 * @param {*} partial @returns {FabricInstance}
 */
export function normalizeFabricInstance(partial) {
  const p = isObj(partial) ? partial : {};
  const id = str(p.id, '') || uid('fab');
  const presetId = hasPreset(p.preset) ? p.preset : 'cotton';
  const preset = getPreset(presetId);
  const tex = isObj(p.texture) ? p.texture : {};
  /** @type {any} */
  const overrides = {};
  if (isObj(p.overrides)) {
    for (const key of PHYSICS_KEYS) {
      const val = p.overrides[key];
      if (typeof val === 'number' && Number.isFinite(val)) overrides[key] = val;
    }
  }
  return {
    id,
    name: str(p.name, id),
    preset: presetId,
    color: hex(p.color, preset.look.color),
    texture: {
      kind: oneOf(tex.kind, TEXTURE_KINDS, preset.look.texture.kind),
      scale_mm: num(tex.scale_mm, preset.look.texture.scale_mm),
      color2: hex(tex.color2, preset.look.texture.color2),
    },
    overrides,
  };
}

/** @returns {FabricInstance} the single default fabric */
function defaultFabricInstance() {
  return normalizeFabricInstance({ id: 'main', name: 'Main', preset: 'cotton' });
}

/**
 * @param {*} e @returns {Edge}
 */
function normalizeEdge(e) {
  const src = isObj(e) ? e : {};
  /** @type {Edge} */
  const out = { type: oneOf(src.type, EDGE_TYPES, 'line') };
  if (out.type === 'cubic') {
    if (isVec2(src.c1)) out.c1 = [src.c1[0], src.c1[1]];
    if (isVec2(src.c2)) out.c2 = [src.c2[0], src.c2[1]];
  }
  if (typeof src.allowance_mm === 'number' && Number.isFinite(src.allowance_mm)) out.allowance_mm = src.allowance_mm;
  if (typeof src.label === 'string' && src.label !== '') out.label = src.label;
  return out;
}

/**
 * @param {Vec2[]} vertices @returns {{a:Vec2, b:Vec2}}
 */
function defaultGrainline(vertices) {
  if (vertices.length === 0) return { a: [0, 0], b: [0, 100] };
  let minx = Infinity; let miny = Infinity; let maxx = -Infinity; let maxy = -Infinity;
  for (const v of vertices) {
    if (v[0] < minx) minx = v[0];
    if (v[0] > maxx) maxx = v[0];
    if (v[1] < miny) miny = v[1];
    if (v[1] > maxy) maxy = v[1];
  }
  const h = maxy - miny;
  if (!(h >= 1)) return { a: [0, 0], b: [0, 100] };
  const cx = (minx + maxx) / 2;
  const cy = (miny + maxy) / 2;
  return { a: [cx, cy - 0.25 * h], b: [cx, cy + 0.25 * h] };
}

/**
 * @param {*} partial @param {{fabricIds:string[], defaultFabricId:string}} ctx
 * @returns {Piece}
 */
export function normalizePiece(partial, ctx) {
  const p = isObj(partial) ? partial : {};
  const fabricIds = (ctx && Array.isArray(ctx.fabricIds)) ? ctx.fabricIds : [];
  const defaultFabricId = (ctx && typeof ctx.defaultFabricId === 'string') ? ctx.defaultFabricId : (fabricIds[0] || 'main');
  const id = str(p.id, '') || uid('piece');

  /** @type {Vec2[]} */
  const vertices = Array.isArray(p.vertices) ? p.vertices.map((v) => /** @type {Vec2} */ (vec2(v, [0, 0]))) : [];
  const n = vertices.length;
  /** @type {Edge[]} */
  const edges = [];
  const srcEdges = Array.isArray(p.edges) ? p.edges : [];
  for (let i = 0; i < n; i++) edges.push(normalizeEdge(i < srcEdges.length ? srcEdges[i] : null));

  const foldEdgeRaw = p.foldEdge;
  const foldEdge = (foldEdgeRaw === null || foldEdgeRaw === undefined) ? null : int(foldEdgeRaw, NaN);

  const notches = (Array.isArray(p.notches) ? p.notches : []).map((nt) => {
    const s = isObj(nt) ? nt : {};
    return { edge: int(s.edge, 0), t: num(s.t, 0.5), kind: oneOf(s.kind, NOTCH_KINDS, 'single') };
  });

  const gl = defaultGrainline(vertices);
  const gsrc = isObj(p.grainline) ? p.grainline : {};
  const grainline = { a: /** @type {Vec2} */ (vec2(gsrc.a, gl.a)), b: /** @type {Vec2} */ (vec2(gsrc.b, gl.b)) };

  const internalLines = (Array.isArray(p.internalLines) ? p.internalLines : []).map((il) => {
    const s = isObj(il) ? il : {};
    const points = (Array.isArray(s.points) ? s.points : []).filter(isVec2).map((v) => [v[0], v[1]]);
    return { kind: oneOf(s.kind, LINE_KINDS, 'mark'), points };
  });

  const pinnedSet = new Set();
  for (const e of (Array.isArray(p.pinnedEdges) ? p.pinnedEdges : [])) {
    const v = num(e, NaN);
    if (Number.isFinite(v)) pinnedSet.add(Math.trunc(v));
  }
  const pinnedEdges = Array.from(pinnedSet).sort((a, b) => a - b);

  const pl = isObj(p.placement) ? p.placement : {};
  const dpl = defaultPlacement();
  /** @type {Placement} */
  const placement = {
    anchor: oneOf(pl.anchor, ANCHORS, dpl.anchor),
    side: oneOf(pl.side, SIDES, dpl.side),
    offset_mm: /** @type {Vec2} */ (vec2(pl.offset_mm, dpl.offset_mm)),
    wrap: clampNum(num(pl.wrap, dpl.wrap), 0, 1),
    flip: bool(pl.flip, dpl.flip),
  };

  const gr = isObj(p.grade) ? p.grade : {};
  const dgr = defaultGrading();
  /** @param {*} v @param {string|null} def @returns {string|null} */
  const ref = (v, def) => (v === null ? null : (typeof v === 'string' && v !== '' ? v : def));
  /** @type {Grading} */
  const grade = {
    widthRef: ref(gr.widthRef, dgr.widthRef),
    lengthRef: ref(gr.lengthRef, dgr.lengthRef),
    anchorX: oneOf(gr.anchorX, ANCHOR_X, dgr.anchorX),
    anchorY: oneOf(gr.anchorY, ANCHOR_Y, dgr.anchorY),
    vertexRules: (Array.isArray(gr.vertexRules) ? gr.vertexRules : []).map((r) => {
      const s = isObj(r) ? r : {};
      /** @type {any} */
      const rule = { vertex: int(s.vertex, 0), dx_mm: num(s.dx_mm, 0), dy_mm: num(s.dy_mm, 0) };
      // Optional per-vertex measurement tracking. Carried through only when the key looks like a size
      // key, so a malformed document cannot smuggle an arbitrary property into the grading maths.
      if (typeof s.ref === 'string' && /^[a-z][A-Za-z]*_cm$/.test(s.ref)) {
        rule.ref = s.ref;
        rule.refAxis = (s.refAxis === 'y' || s.refAxis === 'both') ? s.refAxis : 'x';
      }
      return rule;
    }),
  };

  const fabricId = (typeof p.fabricId === 'string' && fabricIds.includes(p.fabricId)) ? p.fabricId : defaultFabricId;

  return {
    id,
    name: str(p.name, id),
    vertices,
    edges,
    foldEdge: Number.isFinite(foldEdge) ? foldEdge : null,
    notches,
    grainline,
    internalLines,
    seamAllowance_mm: num(p.seamAllowance_mm, 10),
    fabricId,
    layer: clampNum(int(p.layer, 0), 0, 4),
    cutQty: Math.max(1, int(p.cutQty, 1)),
    exportHidden: bool(p.exportHidden, false),
    simulate: bool(p.simulate, true),
    pinnedEdges,
    placement,
    grade,
    meshSpacing_mm: num(p.meshSpacing_mm, 15),
  };
}

/** @param {*} s @returns {SeamSide} */
function normalizeSeamSide(s) {
  const src = isObj(s) ? s : {};
  return {
    pieceId: str(src.pieceId, ''),
    edge: int(src.edge, 0),
    mirror: bool(src.mirror, false),
    reverse: bool(src.reverse, false),
  };
}

/** @param {*} partial @returns {Seam} */
export function normalizeSeam(partial) {
  const p = isObj(partial) ? partial : {};
  return {
    id: str(p.id, '') || uid('seam'),
    a: normalizeSeamSide(p.a),
    b: normalizeSeamSide(p.b),
    kind: 'plain',
  };
}

/** @param {*} v @returns {SizeChart} */
function normalizeSizes(v) {
  if (!isObj(v) || !Array.isArray(v.rows) || v.rows.length === 0) return defaultSizeChart();
  /** @type {string[]} */
  let measurements;
  if (Array.isArray(v.measurements)) {
    measurements = [];
    for (const m of v.measurements) {
      if (typeof m === 'string' && m !== '' && !measurements.includes(m)) measurements.push(m);
    }
  } else {
    measurements = DEFAULT_SIZE_MEASUREMENTS.slice();
  }
  /** @type {SizeRow[]} */
  const rows = v.rows.map((r, i) => {
    const src = isObj(r) ? r : {};
    /** @type {any} */
    const row = { name: str(src.name, 'Size ' + (i + 1)) };
    for (const key of measurements) {
      const n = num(src[key], NaN);
      row[key] = Number.isFinite(n) ? n : null;
    }
    return row;
  });
  const names = rows.map((r) => r.name);
  let baseSize;
  if (typeof v.baseSize === 'string' && names.includes(v.baseSize)) baseSize = v.baseSize;
  else if (names.includes('M')) baseSize = 'M';
  else baseSize = names[0];
  return { measurements, baseSize, rows };
}

/** @param {*} v @returns {SimSettings} */
function normalizeSim(v) {
  const s = isObj(v) ? v : {};
  const d = defaultSimSettings();
  return {
    substeps: int(s.substeps, d.substeps),
    gravity_ms2: num(s.gravity_ms2, d.gravity_ms2),
    selfCollision: bool(s.selfCollision, d.selfCollision),
    sewTime_s: num(s.sewTime_s, d.sewTime_s),
    collisionOffset_mm: num(s.collisionOffset_mm, d.collisionOffset_mm),
    bendScale: num(s.bendScale, d.bendScale),
    stretchScale: num(s.stretchScale, d.stretchScale),
  };
}

/** @param {*} v @param {SizeChart} sizes @returns {UiState} */
function normalizeUi(v, sizes) {
  const u = isObj(v) ? v : {};
  const d = defaultUiState(sizes.baseSize);
  const names = sizes.rows.map((r) => r.name);
  const active = (typeof u.activeSize === 'string' && names.includes(u.activeSize)) ? u.activeSize : sizes.baseSize;
  return {
    split: clampNum(num(u.split, d.split), 0.15, 0.85),
    layout: oneOf(u.layout, LAYOUTS, d.layout),
    swapped: bool(u.swapped, d.swapped),
    activeSize: active,
    dockTab: oneOf(u.dockTab, DOCK_TABS, d.dockTab),
    scene: normalizeScene(u.scene),
  };
}

/**
 * Fill every default of section 3.4.1. Returns a NEW object; the input is not mutated. Unknown keys are dropped.
 * @param {*} partial @returns {ProjectDoc}
 */
export function normalizeDoc(partial) {
  let p = isObj(partial) ? partial : {};
  const rawVersion = num(p.version, NaN);
  if (!(rawVersion >= 1)) p = migrate(p);
  const version = num(p.version, 1);

  const bodySrc = isObj(p.body) ? p.body : {};
  const body = {
    preset: str(bodySrc.preset, DEFAULT_BODY_PRESET),
    params: normalizeBodyParams(bodySrc.params, str(bodySrc.preset, DEFAULT_BODY_PRESET)),
  };

  /** @type {FabricInstance[]} */
  let fabrics = (Array.isArray(p.fabrics) ? p.fabrics : []).map(normalizeFabricInstance);
  if (fabrics.length === 0) fabrics = [defaultFabricInstance()];
  const fabricIds = fabrics.map((f) => f.id);
  const ctx = { fabricIds, defaultFabricId: fabricIds[0] };

  const pieces = (Array.isArray(p.pieces) ? p.pieces : []).map((pc) => normalizePiece(pc, ctx));
  const seams = (Array.isArray(p.seams) ? p.seams : []).map(normalizeSeam);
  const sizes = normalizeSizes(p.sizes);
  const sim = normalizeSim(p.sim);
  const ui = normalizeUi(p.ui, sizes);

  return { version, name: str(p.name, 'Untitled'), body, fabrics, pieces, seams, sizes, sim, ui };
}

// ---------------------------------------------------------------------------------------------------------
// serialize / parse
// ---------------------------------------------------------------------------------------------------------

/**
 * @param {*} v @param {number} indent @param {number} depth
 * @returns {string|undefined} undefined for values JSON.stringify would omit
 */
function stringifyValue(v, indent, depth) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'number' || t === 'string' || t === 'boolean') return JSON.stringify(v);
  if (t === 'undefined' || t === 'function' || t === 'symbol') return undefined;
  if (t === 'bigint') throw new TypeError('stableStringify: BigInt is not JSON-serialisable');
  if (typeof v.toJSON === 'function') return stringifyValue(v.toJSON(), indent, depth);
  const pad = indent > 0 ? ' '.repeat(indent * (depth + 1)) : '';
  const padEnd = indent > 0 ? ' '.repeat(indent * depth) : '';
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const items = new Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const s = stringifyValue(v[i], indent, depth + 1);
      items[i] = s === undefined ? 'null' : s;
    }
    if (indent === 0) return '[' + items.join(',') + ']';
    return '[\n' + pad + items.join(',\n' + pad) + '\n' + padEnd + ']';
  }
  const keys = Object.keys(v).sort();
  const parts = [];
  for (const key of keys) {
    const s = stringifyValue(v[key], indent, depth + 1);
    if (s === undefined) continue;
    parts.push(JSON.stringify(key) + (indent > 0 ? ': ' : ':') + s);
  }
  if (parts.length === 0) return '{}';
  if (indent === 0) return '{' + parts.join(',') + '}';
  return '{\n' + pad + parts.join(',\n' + pad) + '\n' + padEnd + '}';
}

/**
 * Deterministic JSON: object keys sorted (plain sort), arrays in order, numbers via JSON.stringify.
 * indent = 0 -> single line without spaces; indent = 2 -> like JSON.stringify(v, null, 2) of the sorted tree.
 * @param {*} value @param {number} [indent=0] @returns {string}
 */
export function stableStringify(value, indent = 0) {
  const s = stringifyValue(value, indent, 0);
  return s === undefined ? 'null' : s;
}

/** @param {*} doc @returns {string} sorted keys, 2-space indent, trailing newline */
export function serializeDoc(doc) {
  return stableStringify(normalizeDoc(doc), 2) + '\n';
}

/**
 * JSON.parse -> migrate -> normalizeDoc. Does not validate.
 * @param {string} text @returns {ProjectDoc} throws Error{code:'ParseError'} on invalid JSON
 */
export function parseDoc(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw codedError('ParseError', 'Invalid project JSON: ' + (e && e.message ? e.message : String(e)));
  }
  return normalizeDoc(migrate(raw));
}

// ---------------------------------------------------------------------------------------------------------
// geometry helper
// ---------------------------------------------------------------------------------------------------------

/**
 * Signed area (mm^2) of the control polygon: vertices plus cubic control points in travel order.
 * @param {Piece} piece @returns {number}
 */
export function controlPolygonArea(piece) {
  const verts = (piece && Array.isArray(piece.vertices)) ? piece.vertices : [];
  const edges = (piece && Array.isArray(piece.edges)) ? piece.edges : [];
  const n = verts.length;
  if (n < 3) return 0;
  /** @type {Vec2[]} */
  const poly = [];
  for (let i = 0; i < n; i++) {
    poly.push(verts[i]);
    const e = edges[i];
    if (e && e.type === 'cubic') {
      if (isVec2(e.c1)) poly.push(e.c1);
      if (isVec2(e.c2)) poly.push(e.c2);
    }
  }
  let area = 0;
  const m = poly.length;
  for (let i = 0; i < m; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % m];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

// ---------------------------------------------------------------------------------------------------------
// validateShape
// ---------------------------------------------------------------------------------------------------------

/** @type {Record<string, [number, number]>} */
const OVERRIDE_RANGES = {
  density_kgm2: [0.005, 5], bend_Nm: [1e-8, 1e-1], membrane_Nm: [1, 1e6], friction: [0, 1],
  damping: [0, 20], thickness_mm: [0.02, 10], meshSpacing_mm: [8, 40],
};

/** @param {string} key @returns {[number, number]} section 6.1 sanity range for validateShape */
function bodyRange(key) {
  switch (key) {
    case 'height_cm': return [80, 230];
    case 'sex': return [0, 1];
    case 'shoulderWidth_cm': return [20, 70];
    case 'armLength_cm': return [30, 100];
    case 'inseam_cm': return [30, 120];
    case 'torsoLength_cm': return [20, 70];
    case 'headHeight_cm': return [12, 35];
    case 'bustFullness': return [0, 1];
    case 'weight_kg': return [15, 300];
    case 'muscle': return [0, 1];
    case 'age_y': return [2, 110];
    case 'armAbduction_deg': return [10, 60];
    case 'legSpread_deg': return [0, 20];
    default: return [5, 250]; // girths
  }
}

/** @param {*} v @returns {boolean} */
function isInt(v) {
  return typeof v === 'number' && Number.isInteger(v);
}
/** @param {*} v @returns {boolean} */
function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}
/** @param {*} v @returns {string} */
function show(v) {
  try {
    return JSON.stringify(v);
  } catch (_e) {
    return String(v);
  }
}

/**
 * @param {Issue[]} issues @param {'error'|'warn'} level @param {string} code @param {string} message
 * @param {{pieceId?:string, seamId?:string, edge?:number}} [where]
 */
function push(issues, level, code, message, where) {
  /** @type {Issue} */
  const issue = { level, code, message };
  if (where) {
    if (where.pieceId !== undefined) issue.pieceId = where.pieceId;
    if (where.seamId !== undefined) issue.seamId = where.seamId;
    if (where.edge !== undefined) issue.edge = where.edge;
  }
  issues.push(issue);
}

/**
 * @param {Issue[]} issues @param {any[]} list @param {string} collection
 * @returns {Set<string>} the valid ids
 */
function checkIds(issues, list, collection) {
  const seen = new Set();
  for (const item of list) {
    const id = item ? item.id : undefined;
    if (typeof id !== 'string' || id === '') {
      push(issues, 'error', 'DuplicateId', 'Empty or non-string id in ' + collection + ': ' + show(id));
      continue;
    }
    if (seen.has(id)) push(issues, 'error', 'DuplicateId', 'Duplicate id ' + show(id) + ' in ' + collection);
    seen.add(id);
  }
  return seen;
}

/**
 * @param {Issue[]} issues @param {FabricInstance} f
 */
function validateFabric(issues, f) {
  if (!hasPreset(f.preset)) {
    push(issues, 'error', 'FabricPreset', 'Fabric ' + show(f.id) + ' uses unknown preset ' + show(f.preset));
  }
  if (!isHexColor(f.color)) {
    push(issues, 'error', 'FabricColor', 'Fabric ' + show(f.id) + ' color ' + show(f.color) + ' is not #rrggbb');
  }
  const tex = f.texture;
  if (!tex || !isHexColor(tex.color2)) {
    push(issues, 'error', 'FabricColor', 'Fabric ' + show(f.id) + ' texture.color2 ' + show(tex ? tex.color2 : tex) + ' is not #rrggbb');
  }
  const ov = f.overrides || {};
  for (const key of PHYSICS_KEYS) {
    const v = ov[key];
    if (v === undefined) continue;
    const r = OVERRIDE_RANGES[key];
    if (!isFiniteNum(v) || v < r[0] || v > r[1]) {
      push(issues, 'warn', 'FabricOverrideRange', 'Fabric ' + show(f.id) + ' override ' + key + ' = ' + show(v) + ' outside ' + r[0] + '..' + r[1]);
    }
  }
}

/**
 * @param {Issue[]} issues @param {Piece} pc @param {Set<string>} fabricIds @param {string[]} measurements
 */
function validatePiece(issues, pc, fabricIds, measurements) {
  const pid = pc.id;
  const verts = Array.isArray(pc.vertices) ? pc.vertices : [];
  const edges = Array.isArray(pc.edges) ? pc.edges : [];
  const nv = verts.length;
  const ne = edges.length;
  if (nv < 3) push(issues, 'error', 'PieceVertices', 'Piece ' + show(pid) + ' has ' + nv + ' vertices (min 3)', { pieceId: pid });
  if (ne !== nv) push(issues, 'error', 'PieceEdgesCount', 'Piece ' + show(pid) + ' has ' + ne + ' edges for ' + nv + ' vertices', { pieceId: pid });
  for (let i = 0; i < ne; i++) {
    const e = edges[i];
    if (e && e.type === 'cubic' && (!isVec2(e.c1) || !isVec2(e.c2))) {
      push(issues, 'error', 'EdgeCubicControls', 'Piece ' + show(pid) + ' edge ' + i + ' is cubic without valid c1/c2', { pieceId: pid, edge: i });
    }
  }
  for (let i = 0; i < ne; i++) {
    const e = edges[i];
    if (e && e.allowance_mm !== undefined && (!isFiniteNum(e.allowance_mm) || e.allowance_mm < 0 || e.allowance_mm > 100)) {
      push(issues, 'warn', 'EdgeAllowance', 'Piece ' + show(pid) + ' edge ' + i + ' allowance_mm ' + show(e.allowance_mm) + ' outside 0..100', { pieceId: pid, edge: i });
    }
  }
  if (!isFiniteNum(pc.seamAllowance_mm) || pc.seamAllowance_mm < 0 || pc.seamAllowance_mm > 100) {
    push(issues, 'warn', 'EdgeAllowance', 'Piece ' + show(pid) + ' seamAllowance_mm ' + show(pc.seamAllowance_mm) + ' outside 0..100', { pieceId: pid });
  }
  if (nv >= 3 && controlPolygonArea(pc) <= 0) {
    push(issues, 'warn', 'PieceOrientation', 'Piece ' + show(pid) + ' outline is clockwise or degenerate (area ' + controlPolygonArea(pc).toFixed(1) + ' mm2)', { pieceId: pid });
  }
  const fe = pc.foldEdge;
  let foldOk = false;
  if (fe !== null && fe !== undefined) {
    if (!isInt(fe) || fe < 0 || fe >= ne) {
      push(issues, 'error', 'FoldEdgeIndex', 'Piece ' + show(pid) + ' foldEdge ' + show(fe) + ' is not an edge index 0..' + (ne - 1), { pieceId: pid });
    } else {
      foldOk = true;
      if (edges[fe].type !== 'line') {
        push(issues, 'error', 'FoldEdgeCurved', 'Piece ' + show(pid) + ' foldEdge ' + fe + ' is not a line edge', { pieceId: pid, edge: fe });
      }
      if (edges[fe].allowance_mm !== undefined && edges[fe].allowance_mm !== 0) {
        push(issues, 'warn', 'FoldEdgeAllowance', 'Piece ' + show(pid) + ' fold edge ' + fe + ' has allowance_mm ' + show(edges[fe].allowance_mm) + ' (export forces 0)', { pieceId: pid, edge: fe });
      }
    }
  }
  const notches = Array.isArray(pc.notches) ? pc.notches : [];
  for (let k = 0; k < notches.length; k++) {
    const nt = notches[k];
    if (!isInt(nt.edge) || nt.edge < 0 || nt.edge >= ne) {
      push(issues, 'error', 'NotchEdge', 'Piece ' + show(pid) + ' notch ' + k + ' edge ' + show(nt.edge) + ' outside 0..' + (ne - 1), { pieceId: pid });
    }
    if (!(nt.t > 0 && nt.t < 1)) {
      push(issues, 'error', 'NotchT', 'Piece ' + show(pid) + ' notch ' + k + ' t ' + show(nt.t) + ' is not strictly inside (0, 1)', { pieceId: pid, edge: nt.edge });
    }
    if (foldOk && nt.edge === fe) {
      push(issues, 'warn', 'NotchOnFold', 'Piece ' + show(pid) + ' notch ' + k + ' lies on the fold edge ' + fe, { pieceId: pid, edge: fe });
    }
  }
  const g = pc.grainline;
  if (!g || !isVec2(g.a) || !isVec2(g.b) || Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) < 1) {
    push(issues, 'warn', 'GrainlineDegenerate', 'Piece ' + show(pid) + ' grainline is shorter than 1 mm', { pieceId: pid });
  }
  const lines = Array.isArray(pc.internalLines) ? pc.internalLines : [];
  for (let k = 0; k < lines.length; k++) {
    const pts = lines[k] && Array.isArray(lines[k].points) ? lines[k].points : [];
    if (pts.length < 2) {
      push(issues, 'warn', 'InternalLinePoints', 'Piece ' + show(pid) + ' internal line ' + k + ' has ' + pts.length + ' points (min 2)', { pieceId: pid });
    }
  }
  if (!fabricIds.has(pc.fabricId)) {
    push(issues, 'error', 'PieceFabric', 'Piece ' + show(pid) + ' references unknown fabric ' + show(pc.fabricId), { pieceId: pid });
  }
  if (!isInt(pc.layer) || pc.layer < 0 || pc.layer > 4) {
    push(issues, 'error', 'PieceLayer', 'Piece ' + show(pid) + ' layer ' + show(pc.layer) + ' is not an integer 0..4', { pieceId: pid });
  }
  if (!isInt(pc.cutQty) || pc.cutQty < 1) {
    push(issues, 'error', 'PieceCutQty', 'Piece ' + show(pid) + ' cutQty ' + show(pc.cutQty) + ' is not an integer >= 1', { pieceId: pid });
  }
  const pinned = Array.isArray(pc.pinnedEdges) ? pc.pinnedEdges : [];
  for (const e of pinned) {
    if (!isInt(e) || e < 0 || e >= ne) {
      push(issues, 'error', 'PinnedEdge', 'Piece ' + show(pid) + ' pinnedEdges entry ' + show(e) + ' outside 0..' + (ne - 1), { pieceId: pid });
    }
  }
  const pl = pc.placement || /** @type {any} */ ({});
  if (!ANCHORS.includes(pl.anchor) || !SIDES.includes(pl.side) || !isFiniteNum(pl.wrap) || pl.wrap < 0 || pl.wrap > 1) {
    push(issues, 'error', 'PlacementAnchor', 'Piece ' + show(pid) + ' placement ' + show(pl) + ' has an invalid anchor/side/wrap', { pieceId: pid });
  }
  if (!isFiniteNum(pc.meshSpacing_mm) || pc.meshSpacing_mm < 8 || pc.meshSpacing_mm > 40) {
    push(issues, 'warn', 'MeshSpacing', 'Piece ' + show(pid) + ' meshSpacing_mm ' + show(pc.meshSpacing_mm) + ' outside 8..40 (remesh clamps)', { pieceId: pid });
  }
  const gr = pc.grade || /** @type {any} */ ({});
  for (const refKey of ['widthRef', 'lengthRef']) {
    const v = gr[refKey];
    if (v !== null && v !== undefined && !measurements.includes(v)) {
      push(issues, 'warn', 'GradeRef', 'Piece ' + show(pid) + ' grade.' + refKey + ' ' + show(v) + ' is not in sizes.measurements', { pieceId: pid });
    }
  }
  const rules = Array.isArray(gr.vertexRules) ? gr.vertexRules : [];
  for (let k = 0; k < rules.length; k++) {
    const r = rules[k];
    if (!isInt(r.vertex) || r.vertex < 0 || r.vertex >= nv) {
      push(issues, 'error', 'GradeRuleVertex', 'Piece ' + show(pid) + ' grade rule ' + k + ' vertex ' + show(r.vertex) + ' outside 0..' + (nv - 1), { pieceId: pid });
    }
    if (r.ref !== null && r.ref !== undefined && !measurements.includes(r.ref)) {
      push(issues, 'warn', 'GradeRef', 'Piece ' + show(pid) + ' grade rule ' + k + ' tracks ' + show(r.ref) + ', which is not in sizes.measurements', { pieceId: pid });
    }
  }
}

/**
 * @param {Issue[]} issues @param {Seam} sm @param {Map<string, Piece>} pieceById
 * @param {Map<string, string>} sideUse   key '(pieceId|edge|mirror)' -> seam id already using it
 */
function validateSeam(issues, sm, pieceById, sideUse) {
  const sid = sm.id;
  const sides = [['a', sm.a], ['b', sm.b]];
  let simulateMismatch = false;
  for (const [label, side] of sides) {
    const s = side || /** @type {any} */ ({});
    const pc = pieceById.get(s.pieceId);
    if (!pc) {
      push(issues, 'error', 'SeamPiece', 'Seam ' + show(sid) + ' side ' + label + ' references unknown piece ' + show(s.pieceId), { seamId: sid });
      continue;
    }
    const ne = Array.isArray(pc.edges) ? pc.edges.length : 0;
    if (!isInt(s.edge) || s.edge < 0 || s.edge >= ne) {
      push(issues, 'error', 'SeamEdge', 'Seam ' + show(sid) + ' side ' + label + ' edge ' + show(s.edge) + ' outside 0..' + (ne - 1) + ' of piece ' + show(pc.id), { seamId: sid, pieceId: pc.id });
    } else if (pc.foldEdge !== null && s.edge === pc.foldEdge) {
      push(issues, 'error', 'SeamOnFold', 'Seam ' + show(sid) + ' side ' + label + ' uses the fold edge ' + s.edge + ' of piece ' + show(pc.id), { seamId: sid, pieceId: pc.id, edge: s.edge });
    }
    if (s.mirror === true && pc.foldEdge === null) {
      push(issues, 'error', 'SeamMirrorNoFold', 'Seam ' + show(sid) + ' side ' + label + ' has mirror = true but piece ' + show(pc.id) + ' has no fold edge', { seamId: sid, pieceId: pc.id });
    }
    if (pc.simulate === false) simulateMismatch = true;
  }
  const a = sm.a || /** @type {any} */ ({});
  const b = sm.b || /** @type {any} */ ({});
  if (a.pieceId === b.pieceId && a.edge === b.edge && a.mirror === b.mirror) {
    push(issues, 'error', 'SeamSelf', 'Seam ' + show(sid) + ' joins a side to itself (' + show(a) + ')', { seamId: sid });
  }
  for (const [, side] of sides) {
    const s = side || /** @type {any} */ ({});
    const key = String(s.pieceId) + '|' + String(s.edge) + '|' + String(s.mirror === true);
    const other = sideUse.get(key);
    if (other !== undefined && other !== sid) {
      push(issues, 'warn', 'SeamDuplicateSide', 'Seam ' + show(sid) + ' sews (' + key + ') already used by seam ' + show(other), { seamId: sid });
    } else {
      sideUse.set(key, sid);
    }
  }
  if (simulateMismatch) {
    push(issues, 'warn', 'SeamSimulateMismatch', 'Seam ' + show(sid) + ' joins a piece with simulate = false (ignored by the sim)', { seamId: sid });
  }
}

/**
 * @param {Issue[]} issues @param {SizeChart} sizes
 */
function validateSizes(issues, sizes) {
  const meas = (sizes && Array.isArray(sizes.measurements)) ? sizes.measurements : [];
  if (meas.length === 0) {
    push(issues, 'error', 'SizesMeasurements', 'sizes.measurements is empty');
  } else {
    for (const m of meas) {
      if (!BODY_PARAM_KEYS.includes(m)) push(issues, 'error', 'SizesMeasurements', 'sizes.measurements entry ' + show(m) + ' is not a body parameter key');
    }
  }
  const rows = (sizes && Array.isArray(sizes.rows)) ? sizes.rows : [];
  if (rows.length === 0) {
    push(issues, 'error', 'SizesRows', 'sizes.rows is empty');
    return;
  }
  const names = new Set();
  for (const r of rows) {
    const name = r ? r.name : undefined;
    if (typeof name !== 'string' || name === '' || names.has(name)) {
      push(issues, 'error', 'SizesRows', 'Duplicate or invalid size row name ' + show(name));
    }
    names.add(name);
  }
  if (!names.has(sizes.baseSize)) {
    push(issues, 'error', 'SizesRows', 'sizes.baseSize ' + show(sizes.baseSize) + ' is not a row name');
  }
  for (const r of rows) {
    for (const key of meas) {
      const v = r ? r[key] : undefined;
      if (!isFiniteNum(v) || v <= 0) {
        push(issues, 'error', 'SizeCell', 'Size ' + show(r ? r.name : r) + ' ' + key + ' = ' + show(v) + ' is not a positive number');
      }
    }
  }
}

/**
 * @param {Issue[]} issues @param {{preset:string, params:BodyParams}} body
 */
function validateBody(issues, body) {
  const params = (body && isObj(body.params)) ? body.params : {};
  for (const key of BODY_PARAM_KEYS) {
    const v = params[key];
    const r = bodyRange(key);
    if (!isFiniteNum(v) || v < r[0] || v > r[1]) {
      push(issues, 'warn', 'BodyParam', 'body.params.' + key + ' = ' + show(v) + ' outside ' + r[0] + '..' + r[1] + ' (body module clamps)');
    }
  }
}

/**
 * @param {Issue[]} issues @param {SimSettings} sim
 */
function validateSim(issues, sim) {
  const s = sim || /** @type {any} */ ({});
  const bad = [];
  if (!isInt(s.substeps) || s.substeps < 1 || s.substeps > 40) bad.push('substeps = ' + show(s.substeps));
  if (!isFiniteNum(s.gravity_ms2) || s.gravity_ms2 < 0 || s.gravity_ms2 > 30) bad.push('gravity_ms2 = ' + show(s.gravity_ms2));
  if (!isFiniteNum(s.sewTime_s) || s.sewTime_s < 0.1 || s.sewTime_s > 20) bad.push('sewTime_s = ' + show(s.sewTime_s));
  if (!isFiniteNum(s.collisionOffset_mm) || s.collisionOffset_mm < 0 || s.collisionOffset_mm > 30) bad.push('collisionOffset_mm = ' + show(s.collisionOffset_mm));
  if (!isFiniteNum(s.bendScale) || s.bendScale <= 0 || s.bendScale > 1000) bad.push('bendScale = ' + show(s.bendScale));
  if (!isFiniteNum(s.stretchScale) || s.stretchScale <= 0 || s.stretchScale > 1000) bad.push('stretchScale = ' + show(s.stretchScale));
  for (const b of bad) push(issues, 'error', 'SimSetting', 'sim.' + b + ' is out of range');
}

/**
 * @param {Issue[]} issues @param {UiState} ui @param {SizeChart} sizes
 */
function validateUi(issues, ui, sizes) {
  const u = ui || /** @type {any} */ ({});
  const names = (sizes && Array.isArray(sizes.rows)) ? sizes.rows.map((r) => (r ? r.name : undefined)) : [];
  const bad = [];
  if (!isFiniteNum(u.split) || u.split < 0.15 || u.split > 0.85) bad.push('split = ' + show(u.split));
  if (!names.includes(u.activeSize)) bad.push('activeSize = ' + show(u.activeSize) + ' is not a row name');
  if (!LAYOUTS.includes(u.layout)) bad.push('layout = ' + show(u.layout));
  if (typeof u.swapped !== 'boolean') bad.push('swapped = ' + show(u.swapped));
  if (!DOCK_TABS.includes(u.dockTab)) bad.push('dockTab = ' + show(u.dockTab));
  if (u.scene !== undefined) {
    const sc = isObj(u.scene) ? u.scene : {};
    if (!SCENE_IDS.includes(sc.preset)) bad.push('scene.preset = ' + show(sc.preset));
    if (!(sc.background === null || (typeof sc.background === 'string' && HEX6.test(sc.background)))) bad.push('scene.background = ' + show(sc.background));
  }
  for (const b of bad) push(issues, 'error', 'UiState', 'ui.' + b);
}

/**
 * Structural and referential checks (section 3.4.3). Assumes a normalized doc but never throws on a hand-built one.
 * @param {ProjectDoc} doc @returns {Issue[]}
 */
export function validateShape(doc) {
  /** @type {Issue[]} */
  const issues = [];
  const d = isObj(doc) ? doc : /** @type {any} */ ({});
  const fabrics = Array.isArray(d.fabrics) ? d.fabrics : [];
  const pieces = Array.isArray(d.pieces) ? d.pieces : [];
  const seams = Array.isArray(d.seams) ? d.seams : [];
  const sizes = isObj(d.sizes) ? d.sizes : { measurements: [], baseSize: '', rows: [] };
  const measurements = Array.isArray(sizes.measurements) ? sizes.measurements : [];

  if (d.version !== DOC_VERSION) push(issues, 'error', 'DocVersion', 'Document version ' + show(d.version) + ' is not ' + DOC_VERSION);
  if (fabrics.length === 0) push(issues, 'error', 'NoFabrics', 'Document has no fabric instances');
  const pieceIds = checkIds(issues, pieces, 'pieces');
  checkIds(issues, seams, 'seams');
  const fabricIds = checkIds(issues, fabrics, 'fabrics');

  for (const f of fabrics) validateFabric(issues, f);
  for (const pc of pieces) validatePiece(issues, pc, fabricIds, measurements);

  /** @type {Map<string, Piece>} */
  const pieceById = new Map();
  for (const pc of pieces) if (pieceIds.has(pc.id) && !pieceById.has(pc.id)) pieceById.set(pc.id, pc);
  /** @type {Map<string, string>} */
  const sideUse = new Map();
  for (const sm of seams) validateSeam(issues, sm, pieceById, sideUse);

  validateSizes(issues, sizes);
  validateBody(issues, d.body);
  validateSim(issues, d.sim);
  validateUi(issues, d.ui, sizes);
  return issues;
}

// ---------------------------------------------------------------------------------------------------------
// migrate (section 3.4.4)
// ---------------------------------------------------------------------------------------------------------

/** @param {*} v @returns {*} deep copy of JSON-like data */
function deepCopy(v) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(v);
    } catch (_e) {
      // fall through to the JSON copy
    }
  }
  return JSON.parse(JSON.stringify(v));
}

/** @param {any} obj @param {string} from @param {string} to */
function rename(obj, from, to) {
  if (!isObj(obj) || !(from in obj)) return;
  if (!(to in obj)) obj[to] = obj[from];
  delete obj[from];
}

const BODY_RENAMES = Object.freeze({
  height: 'height_cm', chest: 'chest_cm', bustCirc: 'chest_cm', underbust: 'underbust_cm', waist: 'waist_cm',
  hips: 'hips_cm', hip: 'hips_cm', shoulderWidth: 'shoulderWidth_cm', neck: 'neck_cm', neckCirc: 'neck_cm',
  upperArm: 'upperArm_cm', upperArmCirc: 'upperArm_cm', forearm: 'forearm_cm', forearmCirc: 'forearm_cm',
  wrist: 'wrist_cm', wristCirc: 'wrist_cm', thigh: 'thigh_cm', thighCirc: 'thigh_cm', calf: 'calf_cm',
  calfCirc: 'calf_cm', ankle: 'ankle_cm', ankleCirc: 'ankle_cm', armLength: 'armLength_cm', inseam: 'inseam_cm',
  torsoLength: 'torsoLength_cm', backLength: 'torsoLength_cm', headHeight: 'headHeight_cm', bust: 'bustFullness',
  armAbductionDeg: 'armAbduction_deg', armAbduction: 'armAbduction_deg', legSpreadDeg: 'legSpread_deg',
  legSpread: 'legSpread_deg',
});
// 'sex' used to be dropped here as a v0 leftover. It is a real parameter again (SPEC 6.1): the template
// body needs a gender blend, and bust fullness cannot stand in for one — a flat-chested woman and a
// ten-year-old both read 0. A v0 document carrying the old key now keeps it, which is the right outcome:
// it meant the same thing then as it does now.
const BODY_DROPS = Object.freeze(['masculinity', 'chestDepthRatio', 'headCirc', 'kneeCirc']);

/** @param {any} params @returns {any} renamed measurement keys (body params and size rows) */
function renameMeasurementKeys(params) {
  if (!isObj(params)) return params;
  for (const key of Object.keys(params)) {
    if (Object.prototype.hasOwnProperty.call(BODY_RENAMES, key)) rename(params, key, BODY_RENAMES[key]);
  }
  return params;
}

/** @param {any} doc  step 1: top-level renames */
function migrateTopLevel(doc) {
  rename(doc, 'schemaVersion', 'version');
  rename(doc, 'sizeChart', 'sizes');
  if (isObj(doc.sizes)) {
    const s = doc.sizes;
    if (Array.isArray(s.sizes)) rename(s, 'sizes', 'rows');
    if (isObj(s.table) && !Array.isArray(s.rows)) {
      s.rows = Object.keys(s.table).map((name) => Object.assign({ name }, isObj(s.table[name]) ? s.table[name] : {}));
      delete s.table;
    }
    rename(s, 'base', 'baseSize');
    rename(s, 'measures', 'measurements');
  }
}

/** @param {any} pc  step 2 for one piece */
function migratePiece(pc) {
  if (!isObj(pc)) return;
  rename(pc, 'seamAllowanceMm', 'seamAllowance_mm');
  rename(pc, 'meshSpacingMm', 'meshSpacing_mm');
  rename(pc, 'quantity', 'cutQty');
  rename(pc, 'grading', 'grade');
  if (isObj(pc.placement)) rename(pc.placement, 'offsetMm', 'offset_mm');
  if (isObj(pc.grade)) {
    const g = pc.grade;
    rename(g, 'x', 'widthRef');
    rename(g, 'y', 'lengthRef');
    rename(g, 'xAnchor', 'anchorX');
    rename(g, 'yAnchor', 'anchorY');
    if (Array.isArray(g.vertexRules)) {
      for (const r of g.vertexRules) {
        rename(r, 'dx', 'dx_mm');
        rename(r, 'dy', 'dy_mm');
      }
    }
  }
  if (Array.isArray(pc.internalLines)) {
    for (const il of pc.internalLines) if (isObj(il) && il.kind === undefined) il.kind = 'mark';
  }
}

/** @param {any} sim  step 2 for sim */
function migrateSim(sim) {
  if (!isObj(sim)) return;
  rename(sim, 'sewTimeS', 'sewTime_s');
  rename(sim, 'sewDurationS', 'sewTime_s');
  rename(sim, 'collisionOffsetMm', 'collisionOffset_mm');
  if ('gravity' in sim) {
    const g = num(sim.gravity, NaN);
    if (!('gravity_ms2' in sim) && Number.isFinite(g)) sim.gravity_ms2 = Math.abs(g);
    delete sim.gravity;
  }
}

/** @param {any} doc  step 3: body params */
function migrateBody(doc) {
  if (!isObj(doc.body)) return;
  let body = doc.body;
  if (!isObj(body.params)) {
    // v0 sometimes stored the params directly on body
    const preset = typeof body.preset === 'string' ? body.preset : undefined;
    const params = Object.assign({}, body);
    delete params.preset;
    body = { params };
    if (preset !== undefined) body.preset = preset;
    doc.body = body;
  }
  const params = body.params;
  for (const key of BODY_DROPS) delete params[key];
  // The pre-freeze design stored sex as 'm' | 'f' | 'n'. The body now has a 0 (male) .. 1 (female) blend,
  // so the letter converts; anything else is deleted and normalizeBodyParams infers it from the preset.
  if (typeof params.sex === 'string') {
    const s = { m: 0, f: 1, n: 0.5 }[params.sex.trim().charAt(0).toLowerCase()];
    if (s === undefined) delete params.sex; else params.sex = s;
  }
  renameMeasurementKeys(params);
  for (const key of Object.keys(params)) {
    if (key.endsWith('_cm')) {
      const v = num(params[key], NaN);
      if (Number.isFinite(v) && v < 3) params[key] = v * 100;
    }
  }
}

/** @param {any} doc  step 4: size rows */
function migrateSizes(doc) {
  const s = doc.sizes;
  if (!isObj(s) || !Array.isArray(s.rows)) return;
  for (const r of s.rows) renameMeasurementKeys(r);
  if (Array.isArray(s.measurements)) {
    s.measurements = s.measurements.map((m) => (typeof m === 'string' && BODY_RENAMES[m]) ? BODY_RENAMES[m] : m);
  }
  const base = s.rows.find((r) => isObj(r) && r.name === s.baseSize) || s.rows.find(isObj);
  if (!isObj(base)) return;
  let count = 0;
  let allLarge = true;
  for (const key of Object.keys(base)) {
    if (key === 'name') continue;
    const v = base[key];
    if (typeof v !== 'number') continue;
    count++;
    if (!(v > 300)) allLarge = false;
  }
  if (count === 0 || !allLarge) return;
  for (const r of s.rows) {
    if (!isObj(r)) continue;
    for (const key of Object.keys(r)) {
      if (key !== 'name' && typeof r[key] === 'number') r[key] = r[key] / 10;
    }
  }
}

/** @param {any} doc  step 5: seam sides */
function migrateSeams(doc) {
  if (!Array.isArray(doc.seams)) return;
  for (const sm of doc.seams) {
    if (!isObj(sm)) continue;
    for (const label of ['a', 'b']) {
      const side = sm[label];
      if (!isObj(side)) continue;
      rename(side, 'piece', 'pieceId');
      if (Array.isArray(side.edges)) {
        if (side.edges.length > 1) {
          migrate.warnings.push('Seam ' + show(sm.id) + ' side ' + label + ' had an edge chain of ' + side.edges.length + ' edges; truncated to edge ' + show(side.edges[0]));
        }
        if (side.edge === undefined && side.edges.length > 0) side.edge = side.edges[0];
        delete side.edges;
      }
    }
  }
}

/** @param {any} doc  step 6: fabric instances from per-piece preset + colour */
function migrateFabrics(doc) {
  if (Array.isArray(doc.fabrics) && doc.fabrics.length > 0) return;
  if (!Array.isArray(doc.pieces)) return;
  /** @type {Map<string, any>} key preset|color -> instance */
  const instances = new Map();
  /** @type {Record<string, number>} */
  const perPreset = {};
  const overridesByPreset = isObj(doc.fabricOverrides) ? doc.fabricOverrides : {};
  for (const pc of doc.pieces) {
    if (!isObj(pc)) continue;
    const presetId = FABRIC_PRESET_IDS.includes(pc.fabricId) ? pc.fabricId : 'cotton';
    const color = isHexColor(pc.color) ? pc.color.toLowerCase() : getPreset(presetId).look.color;
    const key = presetId + '|' + color;
    let inst = instances.get(key);
    if (!inst) {
      perPreset[presetId] = (perPreset[presetId] || 0) + 1;
      inst = {
        id: instances.size === 0 ? 'main' : 'fab_' + presetId + '_' + perPreset[presetId],  // first instance is 'main' (matches normalizeDoc({}))
        name: getPreset(presetId).name,
        preset: presetId,
        color,
        texture: Object.assign({}, getPreset(presetId).look.texture),
        overrides: isObj(overridesByPreset[presetId]) ? Object.assign({}, overridesByPreset[presetId]) : {},
      };
      instances.set(key, inst);
    }
    pc.fabricId = inst.id;
    delete pc.color;
  }
  doc.fabrics = Array.from(instances.values());
  delete doc.fabricOverrides;
}

/**
 * Bring a document to DOC_VERSION. version 1 -> same object; missing / < 1 -> v0 migration on a deep copy;
 * > 1 -> Error{code:'UnsupportedVersion'}. `migrate.warnings` is reset at each call.
 * @param {*} doc @returns {*}
 */
export function migrate(doc) {
  migrate.warnings = [];
  const src = isObj(doc) ? doc : {};
  const v = num(src.version, NaN);
  if (v === DOC_VERSION) return doc;
  if (Number.isFinite(v) && v > DOC_VERSION) {
    throw codedError('UnsupportedVersion', 'Document version ' + v + ' is newer than this app (' + DOC_VERSION + ')');
  }
  const d = deepCopy(src);
  migrateTopLevel(d);
  if (Array.isArray(d.pieces)) for (const pc of d.pieces) migratePiece(pc);
  migrateSim(d.sim);
  migrateBody(d);
  migrateSizes(d);
  migrateSeams(d);
  migrateFabrics(d);
  d.version = DOC_VERSION;
  return d;
}
/** @type {string[]} populated during the last migrate() call */
migrate.warnings = [];
