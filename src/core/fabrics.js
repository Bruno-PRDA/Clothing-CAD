// src/core/fabrics.js — fabric presets (SPEC section 9.1) and the resolve API (section 3.6). Imports only types.js.

/** @typedef {import('./types.js').FabricPreset} FabricPreset */
/** @typedef {import('./types.js').FabricPhysics} FabricPhysics */
/** @typedef {import('./types.js').FabricLook} FabricLook */
/** @typedef {import('./types.js').FabricInstance} FabricInstance */
/** @typedef {import('./types.js').FabricResolved} FabricResolved */
/** @typedef {import('./types.js').ProjectDoc} ProjectDoc */
/** @typedef {import('./types.js').Piece} Piece */

/** @type {ReadonlyArray<'solid'|'stripes'|'gingham'|'dots'|'twill'|'knit'>} */
export const TEXTURE_KINDS = Object.freeze(['solid', 'stripes', 'gingham', 'dots', 'twill', 'knit']);

/** @type {Readonly<{kind:'solid', scale_mm:number, color2:string}>} */
export const DEFAULT_TEXTURE = Object.freeze({ kind: 'solid', scale_mm: 20, color2: '#ffffff' });

/** @type {ReadonlyArray<keyof FabricPhysics>} */
export const PHYSICS_KEYS = Object.freeze([
  'density_kgm2', 'bend_Nm', 'membrane_Nm', 'friction', 'damping', 'thickness_mm', 'meshSpacing_mm',
]);

const LOOK_KEYS = Object.freeze(['color', 'roughness', 'sheen', 'sheenRoughness', 'clearcoat', 'opacity']);

/** Body skin colour and roughness used by viewer3d/bodyMesh.js. */
export const BODY_LOOK = Object.freeze({ color: '#c9a58a', roughness: 0.8 });

/**
 * @param {string} id @param {string} name
 * @param {number[]} phys  [density_kgm2, bend_Nm, membrane_Nm, friction, damping, thickness_mm, meshSpacing_mm]
 * @param {string} color
 * @param {number[]} look  [roughness, sheen, sheenRoughness, clearcoat, opacity]
 * @param {{kind:string, scale_mm:number, color2:string}} texture
 * @returns {FabricPreset}
 */
function preset(id, name, phys, color, look, texture) {
  return Object.freeze({
    id,
    name,
    physics: Object.freeze({
      density_kgm2: phys[0], bend_Nm: phys[1], membrane_Nm: phys[2], friction: phys[3],
      damping: phys[4], thickness_mm: phys[5], meshSpacing_mm: phys[6],
    }),
    look: Object.freeze({
      color,
      roughness: look[0], sheen: look[1], sheenRoughness: look[2], clearcoat: look[3], opacity: look[4],
      texture: Object.freeze({ kind: /** @type {any} */ (texture.kind), scale_mm: texture.scale_mm, color2: texture.color2 }),
    }),
  });
}

/** @type {ReadonlyArray<FabricPreset>} order: cotton, denim, silk, jersey, wool, leather, chiffon (section 9.1) */
export const FABRIC_PRESETS = Object.freeze([
  preset('cotton', 'Cotton poplin', [0.15, 2.5e-4, 8000, 0.45, 1.0, 0.4, 15], '#d8d3c5',
    [0.85, 0.15, 0.8, 0.0, 1.0], { kind: 'solid', scale_mm: 20, color2: '#ffffff' }),
  preset('denim', 'Denim 12 oz', [0.45, 2.0e-3, 20000, 0.55, 1.5, 1.0, 15], '#3b5a86',
    [0.9, 0.1, 0.9, 0.0, 1.0], { kind: 'twill', scale_mm: 4, color2: '#2a4266' }),
  preset('silk', 'Silk charmeuse', [0.06, 1.0e-5, 3000, 0.25, 0.6, 0.15, 12], '#c9a7c2',
    [0.35, 0.9, 0.3, 0.0, 1.0], { kind: 'solid', scale_mm: 20, color2: '#ffffff' }),
  preset('jersey', 'Cotton jersey', [0.20, 8.0e-5, 400, 0.50, 1.2, 0.8, 15], '#8a9a5b',
    [0.9, 0.2, 0.9, 0.0, 1.0], { kind: 'knit', scale_mm: 3, color2: '#7a8a4b' }),
  preset('wool', 'Wool suiting', [0.28, 1.2e-4, 5000, 0.50, 1.5, 0.7, 15], '#5a5650',
    [0.95, 0.3, 0.9, 0.0, 1.0], { kind: 'solid', scale_mm: 20, color2: '#ffffff' }),
  preset('leather', 'Leather', [0.80, 5.0e-3, 50000, 0.60, 2.0, 1.4, 18], '#6b3f2a',
    [0.45, 0.0, 1.0, 0.6, 1.0], { kind: 'solid', scale_mm: 20, color2: '#ffffff' }),
  preset('chiffon', 'Silk chiffon', [0.035, 1.5e-6, 1000, 0.20, 0.4, 0.1, 12], '#e8c9d6',
    [0.5, 0.6, 0.5, 0.0, 0.55], { kind: 'solid', scale_mm: 20, color2: '#ffffff' }),
]);

/** @type {ReadonlyArray<string>} */
export const FABRIC_PRESET_IDS = Object.freeze(FABRIC_PRESETS.map((p) => p.id));

/** @type {Map<string, FabricPreset>} */
const PRESET_BY_ID = new Map(FABRIC_PRESETS.map((p) => [p.id, p]));

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * @param {string} code @param {string} message @returns {Error}
 */
function codedError(code, message) {
  const err = new Error(message);
  // @ts-ignore
  err.code = code;
  return err;
}

/** @param {string} id @returns {FabricPreset} throws Error{code:'UnknownFabric'} */
export function getPreset(id) {
  const p = PRESET_BY_ID.get(id);
  if (!p) throw codedError('UnknownFabric', 'Unknown fabric preset: ' + String(id));
  return p;
}

/** @param {string} id @returns {boolean} */
export function hasPreset(id) {
  return typeof id === 'string' && PRESET_BY_ID.has(id);
}

/** True for '#rrggbb' (6 hex digits, case-insensitive). @param {*} s @returns {boolean} */
export function isHexColor(s) {
  return typeof s === 'string' && HEX_RE.test(s);
}

/**
 * @param {*} overrides
 * @returns {Partial<FabricPhysics>} only PHYSICS_KEYS with finite numeric values
 */
function pickPhysics(overrides) {
  /** @type {Partial<FabricPhysics>} */
  const out = {};
  if (!overrides || typeof overrides !== 'object') return out;
  for (const key of PHYSICS_KEYS) {
    const v = overrides[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

/**
 * @param {*} tex @param {{kind:string, scale_mm:number, color2:string}} fallback
 * @returns {{kind:any, scale_mm:number, color2:string}}
 */
function cleanTexture(tex, fallback) {
  const t = (tex && typeof tex === 'object') ? tex : {};
  const kind = TEXTURE_KINDS.includes(t.kind) ? t.kind : fallback.kind;
  const scale = (typeof t.scale_mm === 'number' && Number.isFinite(t.scale_mm)) ? t.scale_mm : fallback.scale_mm;
  const color2 = isHexColor(t.color2) ? t.color2.toLowerCase() : fallback.color2;
  return { kind, scale_mm: scale, color2 };
}

/**
 * Resolve an instance against its preset. New object every call.
 * @param {FabricInstance} instance @returns {FabricResolved}
 */
export function resolveFabric(instance) {
  const p = getPreset(instance.preset);
  const physics = Object.assign({}, p.physics, pickPhysics(instance.overrides));
  const color = isHexColor(instance.color) ? instance.color.toLowerCase() : p.look.color;
  const look = Object.assign({}, p.look, { color, texture: cleanTexture(instance.texture, p.look.texture) });
  return { id: instance.id, name: instance.name, physics, look };
}

/**
 * Resolve every instance of a doc.
 * @param {ProjectDoc} doc @returns {Map<string, FabricResolved>}
 */
export function resolveAll(doc) {
  /** @type {Map<string, FabricResolved>} */
  const out = new Map();
  const list = (doc && Array.isArray(doc.fabrics)) ? doc.fabrics : [];
  for (const inst of list) out.set(inst.id, resolveFabric(inst));
  return out;
}

/**
 * @param {FabricResolved} a @param {FabricResolved} b
 * @returns {{physicsChanged:boolean, lookChanged:boolean}}
 */
export function diffResolved(a, b) {
  let physicsChanged = false;
  for (const key of PHYSICS_KEYS) {
    if (a.physics[key] !== b.physics[key]) { physicsChanged = true; break; }
  }
  let lookChanged = false;
  for (const key of LOOK_KEYS) {
    if (a.look[key] !== b.look[key]) { lookChanged = true; break; }
  }
  if (!lookChanged) {
    const ta = a.look.texture;
    const tb = b.look.texture;
    if (ta.kind !== tb.kind || ta.scale_mm !== tb.scale_mm || ta.color2 !== tb.color2) lookChanged = true;
  }
  return { physicsChanged, lookChanged };
}

/**
 * Effective fabric for a piece; throws Error{code:'PieceFabric'} when missing.
 * @param {ProjectDoc} doc @param {Piece} piece @returns {FabricResolved}
 */
export function fabricForPiece(doc, piece) {
  const inst = doc.fabrics.find((f) => f.id === piece.fabricId);
  if (!inst) throw codedError('PieceFabric', 'Piece ' + piece.id + ' references unknown fabric ' + String(piece.fabricId));
  return resolveFabric(inst);
}

/** Effective mesh spacing for a piece: clamp(piece.meshSpacing_mm, 8, 40). @param {Piece} piece @returns {number} */
export function effectiveMeshSpacing(piece) {
  const v = piece.meshSpacing_mm;
  if (typeof v !== 'number' || !Number.isFinite(v)) return 15;
  return v < 8 ? 8 : (v > 40 ? 40 : v);
}

/** @param {number} n @returns {string} two lower-case hex digits */
function hex2(n) {
  const c = Math.max(0, Math.min(255, Math.round(n)));
  return (c < 16 ? '0' : '') + c.toString(16);
}

/**
 * Mix two '#rrggbb' colours in sRGB space: t=0 -> a, t=1 -> b; result lower-case.
 * @param {string} a @param {string} b @param {number} t @returns {string}
 */
export function mixHex(a, b, t) {
  const ca = isHexColor(a) ? a : '#000000';
  const cb = isHexColor(b) ? b : '#000000';
  const k = (typeof t === 'number' && Number.isFinite(t)) ? Math.max(0, Math.min(1, t)) : 0;
  let out = '#';
  for (let i = 0; i < 3; i++) {
    const va = parseInt(ca.slice(1 + 2 * i, 3 + 2 * i), 16);
    const vb = parseInt(cb.slice(1 + 2 * i, 3 + 2 * i), 16);
    out += hex2(va + (vb - va) * k);
  }
  return out;
}
