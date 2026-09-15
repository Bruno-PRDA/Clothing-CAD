// src/viewer3d/materials.js — fabric look -> MeshPhysicalMaterial, cached by fabric id (SPEC 8.4).

import * as THREE from 'three';
import { fabricTexture } from './textures.js';

/** @typedef {import('../core/types.js').FabricResolved} FabricResolved */
/** @typedef {import('../core/types.js').FabricLook} FabricLook */

/** @type {Map<string, THREE.MeshPhysicalMaterial>} */
const cache = new Map();

const WHITE = new THREE.Color('#ffffff');
const tmpColor = new THREE.Color();

/** @param {number} v @param {number} fallback @returns {number} */
function num(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Applies fabric.look to an existing material (SPEC 8.4 field table).
 * @param {THREE.MeshPhysicalMaterial} mat
 * @param {FabricResolved} fabric
 */
export function updateMaterial(mat, fabric) {
  /** @type {FabricLook} */
  const look = (fabric && fabric.look) || /** @type {any} */ ({});
  const texture = look.texture || { kind: 'solid', scale_mm: 20, color2: '#ffffff' };
  const color = typeof look.color === 'string' ? look.color : '#ffffff';
  const hadMap = !!mat.map;
  const wasTransparent = mat.transparent === true;

  const map = fabricTexture(texture, color);
  if (map) {
    mat.color.set('#ffffff');
  } else {
    mat.color.set(color);
  }
  mat.map = map;
  mat.roughness = num(look.roughness, 0.8);
  mat.metalness = 0;
  mat.sheen = num(look.sheen, 0);
  mat.sheenRoughness = num(look.sheenRoughness, 1);
  tmpColor.set(color).lerp(WHITE, 0.6);
  mat.sheenColor.copy(tmpColor);
  mat.clearcoat = num(look.clearcoat, 0);
  mat.clearcoatRoughness = 0.4;
  const opacity = Math.min(1, Math.max(0, num(look.opacity, 1)));
  mat.opacity = opacity;
  mat.transparent = opacity < 1;
  mat.depthWrite = true;
  mat.envMapIntensity = 0.5;
  mat.side = THREE.DoubleSide;
  if (hadMap !== !!map || wasTransparent !== mat.transparent) mat.needsUpdate = true;
}

/**
 * Material for fabric.id: created on first use, otherwise updated IN PLACE (every group holding it sees the change).
 * @param {FabricResolved} fabric
 * @returns {THREE.MeshPhysicalMaterial}
 */
export function fabricMaterial(fabric) {
  const id = fabric && typeof fabric.id === 'string' ? fabric.id : '__default';
  let mat = cache.get(id);
  if (!mat) {
    mat = new THREE.MeshPhysicalMaterial({
      side: THREE.DoubleSide,
      flatShading: false,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    mat.name = id;
    mat.userData.fabricId = id;
    cache.set(id, mat);
  }
  updateMaterial(mat, fabric);
  return mat;
}

/** @param {string} id @returns {THREE.MeshPhysicalMaterial|undefined} */
export function materialFor(id) {
  return cache.get(id);
}

/** @returns {number} */
export function materialCacheSize() {
  return cache.size;
}

/** Disposes every cached material and empties the cache (textures are owned and disposed by textures.js). */
export function disposeMaterials() {
  for (const mat of cache.values()) {
    try { mat.dispose(); } catch (_e) { /* ignore */ }
  }
  cache.clear();
}
