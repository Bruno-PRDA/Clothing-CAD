// src/viewer3d/textures.js — procedural CanvasTextures for fabric looks (SPEC 8.5, texture kinds 9.2).
// drawTextureCanvas is pure 2D drawing (no three usage) so it can be tested without WebGL; fabricTexture wraps
// the canvas in a three CanvasTexture and caches it by textureKey.

import * as THREE from 'three';

/** 1 uv unit = 100 mm of pattern space (SPEC 8.3). clothMesh.js re-exports this as its UV_UNIT_MM. */
export const UV_UNIT_MM = 100;
export const TEXTURE_SIZE = 512;

const KNOWN_KINDS = new Set(['solid', 'stripes', 'gingham', 'dots', 'twill', 'knit']);
const SCALE_MIN = 2;
const SCALE_MAX = 500;

/** @type {Map<string, THREE.CanvasTexture>} */
const cache = new Map();
/** @type {Set<string>} kinds already warned about */
const warnedKinds = new Set();

/** @param {number} scale_mm @returns {number} */
function clampScale(scale_mm) {
  const s = Number(scale_mm);
  if (!Number.isFinite(s)) return 20;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, s));
}

/**
 * Cache key `${kind}|${color}|${color2}|${scale_mm}` (scale_mm clamped to [2, 500] before keying).
 * @param {{kind:string, scale_mm:number, color2:string}} texture
 * @param {string} color
 * @returns {string}
 */
export function textureKey(texture, color) {
  const kind = texture && typeof texture.kind === 'string' ? texture.kind : 'solid';
  const color2 = texture && typeof texture.color2 === 'string' ? texture.color2 : '#ffffff';
  const scale = clampScale(texture ? texture.scale_mm : 20);
  return `${kind}|${color}|${color2}|${scale}`;
}

/**
 * Draws one pattern period on a size x size canvas (SPEC 8.5 drawing rules). Unknown kinds draw as 'solid'.
 * @param {'solid'|'stripes'|'gingham'|'dots'|'twill'|'knit'} kind
 * @param {string} color   base colour '#rrggbb'
 * @param {string} color2  accent colour '#rrggbb'
 * @param {number} [size=TEXTURE_SIZE]
 * @returns {HTMLCanvasElement}
 */
export function drawTextureCanvas(kind, color, color2, size = TEXTURE_SIZE) {
  const S = Math.max(1, Math.floor(size));
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, S, S);
  switch (kind) {
    case 'stripes': {
      ctx.fillStyle = color2;
      ctx.fillRect(0, 0, S / 2, S);
      break;
    }
    case 'gingham': {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = color2;
      ctx.fillRect(0, 0, S / 2, S);
      ctx.fillRect(0, 0, S, S / 2);
      ctx.globalAlpha = 1;
      break;
    }
    case 'dots': {
      ctx.fillStyle = color2;
      const r = 0.12 * S;
      ctx.beginPath();
      ctx.arc(S / 4, S / 4, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc((3 * S) / 4, (3 * S) / 4, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'twill': {
      ctx.strokeStyle = color2;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 0.045 * S;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      for (let c = -S; c <= 2 * S; c += S / 8) {
        ctx.moveTo(c, 0);
        ctx.lineTo(c - S, S);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'knit': {
      const period = S / 8;
      const amp = 0.028 * S;
      const drawRows = (dy) => {
        for (let r = 0; r < 8; r++) {
          const y0 = r * period + S / 16 + dy;
          ctx.beginPath();
          for (let x = 0; x <= S; x += 4) {
            const y = y0 + amp * Math.sin((2 * Math.PI * x) / period);
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      };
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = color2;
      ctx.lineWidth = 0.023 * S;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      drawRows(0);
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      drawRows(S / 64);
      ctx.globalAlpha = 1;
      break;
    }
    default:
      // 'solid' and unknown kinds: base colour only
      break;
  }
  return canvas;
}

/**
 * Cached CanvasTexture for a FabricLook texture; null for 'solid' and for unknown kinds (one console.warn per kind).
 * @param {{kind:string, scale_mm:number, color2:string}} texture
 * @param {string} color
 * @returns {THREE.CanvasTexture|null}
 */
export function fabricTexture(texture, color) {
  const kind = texture && typeof texture.kind === 'string' ? texture.kind : 'solid';
  if (kind === 'solid') return null;
  if (!KNOWN_KINDS.has(kind)) {
    if (!warnedKinds.has(kind)) {
      warnedKinds.add(kind);
      console.warn(`viewer3d/textures: unknown texture kind '${kind}', treated as solid`);
    }
    return null;
  }
  const key = textureKey(texture, color);
  let tex = cache.get(key);
  if (tex) return tex;
  const color2 = typeof texture.color2 === 'string' ? texture.color2 : '#ffffff';
  const scale = clampScale(texture.scale_mm);
  const canvas = drawTextureCanvas(/** @type {any} */ (kind), color, color2, TEXTURE_SIZE);
  tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.repeat.set(UV_UNIT_MM / scale, UV_UNIT_MM / scale);
  tex.name = key;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/** @returns {number} */
export function textureCacheSize() {
  return cache.size;
}

/** Disposes every cached texture and empties the cache. */
export function disposeTextures() {
  for (const tex of cache.values()) {
    try { tex.dispose(); } catch (_e) { /* ignore */ }
  }
  cache.clear();
}
