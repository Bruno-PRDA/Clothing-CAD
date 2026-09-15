// src/viewer3d/clothMesh.js — one dynamic BufferGeometry for the whole garment (SPEC 8.3).

import * as THREE from 'three';
import { fabricMaterial } from './materials.js';
import { UV_UNIT_MM } from './textures.js';

/** @typedef {import('../core/types.js').ClothState} ClothState */
/** @typedef {import('../core/types.js').FabricResolved} FabricResolved */

/** 1 uv unit = 100 mm of pattern space (single source in textures.js; re-exported here per the contract). */
export { UV_UNIT_MM };

/**
 * Render topology derived from a ClothState (also the exact 'cloth:init' pop-out payload, SPEC 8.8).
 * @typedef {Object} ClothTopology
 * @property {number} V
 * @property {Uint32Array} tris     3T, reordered so the triangles of pieces[0] come first, then pieces[1], ...
 * @property {Float32Array} uv      2V, positions2d / UV_UNIT_MM
 * @property {{start:number, count:number, materialIndex:number, pieceId:string}[]} groups   start/count in index elements
 * @property {string[]} pieceIds    pieceIds[materialIndex]
 * @property {FabricResolved[]} fabrics   fabrics[materialIndex] (plain data, structured-clone safe)
 * @property {Float32Array} pos     3V copy of ClothState.pos at build time
 */

/** @param {string} message @returns {Error & {code:string}} */
function badState(message) {
  const err = /** @type {Error & {code:string}} */ (new Error('ViewerBadState: ' + message));
  err.code = 'ViewerBadState';
  return err;
}

/** Plain-data copy of a FabricResolved so the topology is structured-clone safe. @param {FabricResolved} f */
function plainFabric(f) {
  if (!f || typeof f !== 'object') {
    return { id: '__default', name: 'default', physics: {}, look: { color: '#ffffff', roughness: 0.8, sheen: 0, sheenRoughness: 1, clearcoat: 0, opacity: 1, texture: { kind: 'solid', scale_mm: 20, color2: '#ffffff' } } };
  }
  const look = f.look || {};
  const tex = look.texture || { kind: 'solid', scale_mm: 20, color2: '#ffffff' };
  return {
    id: f.id,
    name: f.name,
    physics: { ...(f.physics || {}) },
    look: { ...look, texture: { kind: tex.kind, scale_mm: tex.scale_mm, color2: tex.color2 } },
  };
}

/**
 * @param {ClothState} state
 * @param {Record<string, FabricResolved>|null} [fabricsByPiece]   optional override keyed by pieceId
 * @returns {ClothTopology}
 * @throws {Error} code 'ViewerBadState'
 */
export function topologyFromState(state, fabricsByPiece = null) {
  if (!state || typeof state !== 'object') throw badState('state is not an object');
  const V = state.V | 0;
  if (!(V >= 0)) throw badState('state.V is not a non-negative integer');
  const pos = state.pos;
  const srcTris = state.tris;
  const pieceOf = state.pieceOf;
  const pieces = Array.isArray(state.pieces) ? state.pieces : null;
  if (!pos || pos.length !== 3 * V) throw badState(`pos.length ${pos ? pos.length : 'undefined'} !== 3 * V (${3 * V})`);
  if (!srcTris || srcTris.length % 3 !== 0) throw badState('tris.length is not a multiple of 3');
  if (!pieceOf || pieceOf.length !== V) throw badState(`pieceOf.length ${pieceOf ? pieceOf.length : 'undefined'} !== V (${V})`);
  if (!pieces) throw badState('pieces is not an array');
  const K = pieces.length;
  const T = srcTris.length / 3;

  for (let i = 0; i < srcTris.length; i++) {
    if (!(srcTris[i] < V)) throw badState(`tris[${i}] = ${srcTris[i]} out of range (V = ${V})`);
  }
  for (let v = 0; v < V; v++) {
    if (!(pieceOf[v] < K)) throw badState(`pieceOf[${v}] = ${pieceOf[v]} out of range (K = ${K})`);
  }
  for (let t = 0; t < T; t++) {
    const a = srcTris[3 * t], b = srcTris[3 * t + 1], c = srcTris[3 * t + 2];
    const pa = pieceOf[a];
    if (pieceOf[b] !== pa || pieceOf[c] !== pa) throw badState(`triangle ${t} spans pieces`);
  }
  for (let k = 0; k < K; k++) {
    const p = pieces[k];
    if (!p || !p.mesh) throw badState(`pieces[${k}] has no mesh`);
    const start = p.start | 0, count = p.count | 0;
    if (start < 0 || count < 0 || start + count > V) throw badState(`pieces[${k}] start+count ${start + count} > V (${V})`);
    const p2 = p.mesh.positions2d;
    if (!p2 || p2.length !== 2 * count) throw badState(`pieces[${k}].mesh.positions2d.length ${p2 ? p2.length : 'undefined'} !== 2 * count (${2 * count})`);
  }

  // counting sort of triangles by piece (stable)
  const counts = new Uint32Array(K);
  for (let t = 0; t < T; t++) counts[pieceOf[srcTris[3 * t]]]++;
  const offsets = new Uint32Array(K);
  let acc = 0;
  for (let k = 0; k < K; k++) { offsets[k] = acc; acc += counts[k]; }
  const fill = new Uint32Array(K);
  const tris = new Uint32Array(3 * T);
  for (let t = 0; t < T; t++) {
    const k = pieceOf[srcTris[3 * t]];
    const dst = 3 * (offsets[k] + fill[k]++);
    tris[dst] = srcTris[3 * t];
    tris[dst + 1] = srcTris[3 * t + 1];
    tris[dst + 2] = srcTris[3 * t + 2];
  }

  const groups = new Array(K);
  const pieceIds = new Array(K);
  const fabrics = new Array(K);
  const uv = new Float32Array(2 * V);
  for (let k = 0; k < K; k++) {
    const p = pieces[k];
    groups[k] = { start: 3 * offsets[k], count: 3 * counts[k], materialIndex: k, pieceId: p.pieceId };
    pieceIds[k] = p.pieceId;
    const p2 = p.mesh.positions2d;
    const base = 2 * p.start;
    for (let i = 0; i < p2.length; i++) uv[base + i] = p2[i] / UV_UNIT_MM;
    const override = fabricsByPiece && Object.prototype.hasOwnProperty.call(fabricsByPiece, p.pieceId) ? fabricsByPiece[p.pieceId] : null;
    fabrics[k] = plainFabric(override || p.fabric);
  }

  return { V, tris, uv, groups, pieceIds, fabrics, pos: Float32Array.prototype.slice.call(pos) };
}

/**
 * Area-weighted vertex normals, allocation-free. A zero accumulated vector becomes (0, 1, 0).
 * @param {Float32Array} pos 3V @param {Uint32Array} tris 3T @param {Float32Array} out 3V @param {number} V
 */
export function accumulateNormals(pos, tris, out, V) {
  const n3 = 3 * V;
  for (let i = 0; i < n3; i++) out[i] = 0;
  const T3 = tris.length;
  for (let i = 0; i < T3; i += 3) {
    const a = 3 * tris[i], b = 3 * tris[i + 1], c = 3 * tris[i + 2];
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const e1x = pos[b] - ax, e1y = pos[b + 1] - ay, e1z = pos[b + 2] - az;
    const e2x = pos[c] - ax, e2y = pos[c + 1] - ay, e2z = pos[c + 2] - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
    out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
  }
  for (let i = 0; i < n3; i += 3) {
    const x = out[i], y = out[i + 1], z = out[i + 2];
    const l2 = x * x + y * y + z * z;
    if (l2 > 1e-30 && Number.isFinite(l2)) {
      const inv = 1 / Math.sqrt(l2);
      out[i] = x * inv; out[i + 1] = y * inv; out[i + 2] = z * inv;
    } else {
      out[i] = 0; out[i + 1] = 1; out[i + 2] = 0;
    }
  }
}

/**
 * @typedef {Object} ClothMeshHandle
 * @property {THREE.Mesh} object
 * @property {THREE.Mesh} wire
 * @property {THREE.BufferGeometry|null} geometry
 * @property {(topology:ClothTopology) => void} build
 * @property {(state:ClothState, fabricsByPiece?:Record<string,FabricResolved>|null) => void} setCloth
 * @property {(pos:Float32Array) => void} updatePositions
 * @property {(pieceId:string, fabric:FabricResolved) => boolean} setPieceFabric
 * @property {number} normalsEvery
 * @property {(on:boolean) => void} setWireframe
 * @property {(on:boolean) => void} setVisible
 * @property {() => number} vertexCount
 * @property {() => number} triangleCount
 * @property {() => ClothTopology|null} topology
 * @property {() => void} clear
 * @property {() => void} dispose
 */

/** @param {object} [opts] @returns {ClothMeshHandle} */
export function createClothMesh(opts = {}) {
  const emptyGeo = new THREE.BufferGeometry();
  const object = new THREE.Mesh(emptyGeo, []);
  object.name = 'cloth';
  object.frustumCulled = false;
  object.castShadow = true;
  object.receiveShadow = true;
  object.visible = false;

  const wireMaterial = new THREE.MeshBasicMaterial({ wireframe: true, color: '#101418', transparent: true, opacity: 0.35 });
  const wire = new THREE.Mesh(emptyGeo, wireMaterial);
  wire.name = 'cloth-wire';
  wire.frustumCulled = false;
  wire.visible = false;
  let wireOn = false;
  let visibleOn = true;

  /** @type {THREE.BufferGeometry|null} */
  let geometry = null;
  /** @type {ClothTopology|null} */
  let topo = null;
  /** @type {THREE.BufferAttribute|null} */
  let positionAttr = null;
  /** @type {THREE.BufferAttribute|null} */
  let normalAttr = null;
  let callCounter = 0;

  /** @type {ClothMeshHandle} */
  const handle = {
    object,
    wire,
    get geometry() { return geometry; },
    normalsEvery: 1,
    build,
    setCloth,
    updatePositions,
    setPieceFabric,
    setWireframe,
    setVisible,
    vertexCount: () => (topo ? topo.V : 0),
    triangleCount: () => (topo ? topo.tris.length / 3 : 0),
    topology: () => topo,
    clear,
    dispose,
  };

  function applyVisibility() {
    const has = !!topo && topo.V > 0;
    object.visible = visibleOn && has;
    wire.visible = visibleOn && has && wireOn;
  }

  /** @param {ClothTopology} topology */
  function build(topology) {
    if (!topology || typeof topology !== 'object') throw badState('topology is not an object');
    if (geometry) clear();
    const V = topology.V | 0;
    const geo = new THREE.BufferGeometry();
    positionAttr = new THREE.BufferAttribute(new Float32Array(3 * V), 3);
    positionAttr.setUsage(THREE.DynamicDrawUsage);
    normalAttr = new THREE.BufferAttribute(new Float32Array(3 * V), 3);
    normalAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', positionAttr);
    geo.setAttribute('normal', normalAttr);
    geo.setAttribute('uv', new THREE.BufferAttribute(topology.uv, 2));
    geo.setIndex(new THREE.BufferAttribute(topology.tris, 1));
    for (const g of topology.groups) geo.addGroup(g.start, g.count, g.materialIndex);
    geometry = geo;
    topo = topology;
    object.geometry = geo;
    wire.geometry = geo;
    object.material = topology.fabrics.map((f) => fabricMaterial(f));
    callCounter = 0;
    const saved = handle.normalsEvery;
    handle.normalsEvery = 1;
    updatePositions(topology.pos);
    handle.normalsEvery = saved;
    callCounter = 0;
    applyVisibility();
  }

  /** @param {ClothState} state @param {Record<string,FabricResolved>|null} [fabricsByPiece] */
  function setCloth(state, fabricsByPiece = null) {
    build(topologyFromState(state, fabricsByPiece));
  }

  /** @param {Float32Array} pos */
  function updatePositions(pos) {
    if (!geometry || !topo || !positionAttr || !normalAttr) throw badState('no cloth geometry built');
    if (!pos || pos.length !== 3 * topo.V) throw badState(`pos.length ${pos ? pos.length : 'undefined'} !== 3 * V (${3 * topo.V})`);
    const arr = /** @type {Float32Array} */ (positionAttr.array);
    arr.set(pos);
    positionAttr.needsUpdate = true;
    const every = handle.normalsEvery >= 2 ? 2 : 1;
    if (++callCounter % every === 0) {
      accumulateNormals(arr, topo.tris, /** @type {Float32Array} */ (normalAttr.array), topo.V);
      normalAttr.needsUpdate = true;
    }
  }

  /** @param {string} pieceId @param {FabricResolved} fabric @returns {boolean} */
  function setPieceFabric(pieceId, fabric) {
    if (!topo) return false;
    const g = topo.groups.find((x) => x.pieceId === pieceId);
    if (!g) return false;
    const mat = fabricMaterial(fabric);
    const mats = /** @type {THREE.Material[]} */ (Array.isArray(object.material) ? object.material : [object.material]);
    mats[g.materialIndex] = mat;
    object.material = mats;
    topo.fabrics[g.materialIndex] = plainFabric(fabric);
    return true;
  }

  /** @param {boolean} on */
  function setWireframe(on) {
    wireOn = !!on;
    applyVisibility();
  }

  /** @param {boolean} on */
  function setVisible(on) {
    visibleOn = !!on;
    applyVisibility();
  }

  function clear() {
    if (geometry) {
      object.geometry = emptyGeo;
      wire.geometry = emptyGeo;
      geometry.dispose();
    }
    geometry = null;
    topo = null;
    positionAttr = null;
    normalAttr = null;
    object.material = [];
    callCounter = 0;
    applyVisibility();
  }

  function dispose() {
    clear();
    emptyGeo.dispose();
    wireMaterial.dispose();
    if (object.parent) object.parent.remove(object);
    if (wire.parent) wire.parent.remove(wire);
  }

  return handle;
}
