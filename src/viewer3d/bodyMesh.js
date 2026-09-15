// src/viewer3d/bodyMesh.js — the body render mesh (SPEC 8.2).

import * as THREE from 'three';
import { BODY_LOOK } from '../core/fabrics.js';

/** Skin look = core BODY_LOOK ('#c9a58a', 0.8) plus metalness 0. */
export const BODY_SKIN = Object.freeze({ color: BODY_LOOK.color, roughness: BODY_LOOK.roughness, metalness: 0 });

/** @param {string} message @returns {Error & {code:string}} */
function badBody(message) {
  const err = /** @type {Error & {code:string}} */ (new Error('ViewerBadBody: ' + message));
  err.code = 'ViewerBadBody';
  return err;
}

/**
 * @typedef {Object} BodyMeshHandle
 * @property {THREE.Group} object
 * @property {THREE.Mesh} mesh
 * @property {THREE.Mesh} wire
 * @property {THREE.Group} landmarks
 * @property {(model:{geometry:{positions:Float32Array,normals?:Float32Array,indices:Uint32Array}, landmarks?:Record<string,number[]>}|null) => void} setBody
 * @property {(on:boolean) => void} setWireframe
 * @property {(on:boolean) => void} setLandmarksVisible
 * @property {(alpha:number) => void} setOpacity
 * @property {(on:boolean) => void} setVisible
 * @property {() => number} vertexCount
 * @property {() => {min:number[],max:number[]}|null} bounds
 * @property {() => void} dispose
 */

/** @param {{color?:string, roughness?:number}} [opts] @returns {BodyMeshHandle} */
export function createBodyMesh(opts = {}) {
  const color = typeof opts.color === 'string' ? opts.color : BODY_SKIN.color;
  const roughness = typeof opts.roughness === 'number' ? opts.roughness : BODY_SKIN.roughness;

  const object = new THREE.Group();
  object.name = 'bodyGroup';

  const skin = new THREE.MeshStandardMaterial({
    color, roughness, metalness: 0, side: THREE.FrontSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const wireMaterial = new THREE.MeshBasicMaterial({ wireframe: true, color: '#3c2f28', transparent: true, opacity: 0.35 });
  const emptyGeo = new THREE.BufferGeometry();

  const mesh = new THREE.Mesh(emptyGeo, skin);
  mesh.name = 'body';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const wire = new THREE.Mesh(emptyGeo, wireMaterial);
  wire.name = 'body-wire';
  wire.visible = false;
  const landmarks = new THREE.Group();
  landmarks.name = 'landmarks';
  landmarks.visible = false;
  object.add(mesh);
  object.add(wire);
  object.add(landmarks);

  const lmGeo = new THREE.SphereGeometry(0.012, 12, 8);
  const lmMat = new THREE.MeshBasicMaterial({ color: '#ff3b30', depthTest: false });

  /** @type {THREE.BufferGeometry|null} */
  let geometry = null;
  let wireOn = false;
  let landmarksOn = false;
  let visibleOn = true;
  let hasBody = false;

  function applyVisibility() {
    object.visible = visibleOn && hasBody;
    wire.visible = wireOn;
    landmarks.visible = landmarksOn;
  }

  function disposeGeometry() {
    if (geometry) {
      mesh.geometry = emptyGeo;
      wire.geometry = emptyGeo;
      geometry.dispose();
      geometry = null;
    }
  }

  /** @param {Record<string, number[]>|undefined|null} lm */
  function rebuildLandmarks(lm) {
    const keys = lm && typeof lm === 'object' ? Object.keys(lm) : [];
    const existing = landmarks.children;
    const sameSet = existing.length === keys.length && keys.every((k, i) => existing[i].name === k);
    if (!sameSet) {
      while (landmarks.children.length) landmarks.remove(landmarks.children[0]);
      for (const key of keys) {
        const m = new THREE.Mesh(lmGeo, lmMat);
        m.name = key;
        m.renderOrder = 10;
        landmarks.add(m);
      }
    }
    for (const child of landmarks.children) {
      const p = lm ? lm[child.name] : null;
      if (Array.isArray(p) && p.length >= 3) child.position.set(p[0], p[1], p[2]);
    }
  }

  /** @param {{geometry:{positions:Float32Array,normals?:Float32Array,indices:Uint32Array}, landmarks?:Record<string,number[]>}|null} model */
  function setBody(model) {
    if (!model) {
      disposeGeometry();
      hasBody = false;
      rebuildLandmarks(null);
      applyVisibility();
      return;
    }
    const g = model.geometry;
    if (!g || !g.positions || !g.indices) throw badBody('geometry.positions / geometry.indices missing');
    const positions = g.positions;
    const indices = g.indices;
    if (positions.length % 3 !== 0) throw badBody(`positions.length ${positions.length} is not a multiple of 3`);
    if (indices.length % 3 !== 0) throw badBody(`indices.length ${indices.length} is not a multiple of 3`);
    const vc = positions.length / 3;
    for (let i = 0; i < indices.length; i++) {
      if (!(indices[i] < vc) || indices[i] < 0) throw badBody(`indices[${i}] = ${indices[i]} >= vertexCount ${vc}`);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const idx = indices instanceof Uint32Array ? indices : new Uint32Array(indices);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    if (g.normals && g.normals.length === positions.length) {
      geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
    } else {
      geo.computeVertexNormals();
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    disposeGeometry();
    geometry = geo;
    mesh.geometry = geo;
    wire.geometry = geo;
    hasBody = true;
    rebuildLandmarks(model.landmarks);
    applyVisibility();
  }

  /** @param {boolean} on */
  function setWireframe(on) { wireOn = !!on; applyVisibility(); }
  /** @param {boolean} on */
  function setLandmarksVisible(on) { landmarksOn = !!on; applyVisibility(); }
  /** @param {boolean} on */
  function setVisible(on) { visibleOn = !!on; applyVisibility(); }

  /** @param {number} alpha */
  function setOpacity(alpha) {
    const a = Math.min(1, Math.max(0.05, Number.isFinite(alpha) ? alpha : 1));
    const wasTransparent = skin.transparent;
    skin.transparent = a < 1;
    skin.opacity = a;
    skin.depthWrite = true;
    if (wasTransparent !== skin.transparent) skin.needsUpdate = true;
  }

  function vertexCount() {
    return geometry ? geometry.attributes.position.count : 0;
  }

  function bounds() {
    if (!geometry) return null;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const b = geometry.boundingBox;
    if (!b) return null;
    return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
  }

  function dispose() {
    disposeGeometry();
    while (landmarks.children.length) landmarks.remove(landmarks.children[0]);
    emptyGeo.dispose();
    skin.dispose();
    wireMaterial.dispose();
    lmGeo.dispose();
    lmMat.dispose();
    if (object.parent) object.parent.remove(object);
  }

  return { object, mesh, wire, landmarks, setBody, setWireframe, setLandmarksVisible, setOpacity, setVisible, vertexCount, bounds, dispose };
}
