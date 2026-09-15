// src/viewer3d/anchorsGizmo.js — anchor cylinders and placement outlines (SPEC 8.7).
// Frame per anchor: u = front, w = cross(front, axis) (= s-hat of SPEC 7.4); point at depth s and angle theta is
// origin + axis*s + radius*(cos(theta)*u + sin(theta)*w). With axis (0,-1,0), front (0,0,1): w = (1,0,0), so
// theta = +pi/2 (side 'left') lies at +x = the model's LEFT, matching arrange().

import * as THREE from 'three';

/** @typedef {import('../core/types.js').Anchor} Anchor */
/** @typedef {import('../core/types.js').ClothState} ClothState */

export const GIZMO_COLORS = Object.freeze({ anchor: '#55aaff', anchorHighlight: '#ffd400', frontTick: '#ffd400', outline: '#ff8800' });

const RING_SEGMENTS = 48;
const LONGITUDINALS = 8;
const TICK_LENGTH = 0.03;

/** @param {number[]} a @param {number[]} b @returns {number[]} */
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** @param {number[]} v @returns {number[]} */
function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0];
}

/**
 * @typedef {Object} AnchorsGizmoHandle
 * @property {THREE.Group} object
 * @property {(anchors:Record<string,Anchor>|null) => void} setAnchors
 * @property {(state:ClothState|null) => void} setPlacements
 * @property {(name:string|null) => void} highlight
 * @property {(on:boolean) => void} setVisible
 * @property {() => void} dispose
 */

/** @returns {AnchorsGizmoHandle} */
export function createAnchorsGizmo() {
  const object = new THREE.Group();
  object.name = 'anchorsGizmo';
  object.visible = false;

  /** @type {THREE.LineSegments[]} */
  let anchorObjects = [];
  /** @type {THREE.LineLoop[]} */
  let outlineObjects = [];
  /** @type {string|null} */
  let highlighted = null;

  /** @param {THREE.Object3D} o */
  function disposeObject(o) {
    o.traverse((child) => {
      const c = /** @type {any} */ (child);
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
    if (o.parent) o.parent.remove(o);
  }

  function clearAnchors() {
    for (const o of anchorObjects) disposeObject(o);
    anchorObjects = [];
  }

  function clearOutlines() {
    for (const o of outlineObjects) disposeObject(o);
    outlineObjects = [];
  }

  /** @param {string} name @param {Anchor} a @returns {THREE.LineSegments} */
  function buildAnchor(name, a) {
    const origin = a.origin;
    const axis = normalize(a.axis);
    const u = normalize(a.front);
    const w = normalize(cross(u, axis));
    const r = a.radius;
    const L = a.length;
    const pt = (s, theta, extra = 0) => [
      origin[0] + axis[0] * s + (r + extra) * (Math.cos(theta) * u[0] + Math.sin(theta) * w[0]),
      origin[1] + axis[1] * s + (r + extra) * (Math.cos(theta) * u[1] + Math.sin(theta) * w[1]),
      origin[2] + axis[2] * s + (r + extra) * (Math.cos(theta) * u[2] + Math.sin(theta) * w[2]),
    ];
    /** @type {number[]} */
    const pts = [];
    const push = (p, q) => { pts.push(p[0], p[1], p[2], q[0], q[1], q[2]); };
    for (const s of [0, L / 2, L]) {
      for (let i = 0; i < RING_SEGMENTS; i++) {
        const t0 = (2 * Math.PI * i) / RING_SEGMENTS;
        const t1 = (2 * Math.PI * (i + 1)) / RING_SEGMENTS;
        push(pt(s, t0), pt(s, t1));
      }
    }
    for (let k = 0; k < LONGITUDINALS; k++) {
      const theta = (k * Math.PI) / 4;
      push(pt(0, theta), pt(L, theta));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    const mat = new THREE.LineBasicMaterial({ color: GIZMO_COLORS.anchor, transparent: true, opacity: 0.6, depthTest: false });
    const lines = new THREE.LineSegments(geo, mat);
    lines.name = name;
    lines.frustumCulled = false;
    lines.renderOrder = 20;

    // front tick, nested under the anchor object so the gizmo group has one child per anchor
    const tickGeo = new THREE.BufferGeometry();
    const p0 = pt(0, 0), p1 = pt(0, 0, TICK_LENGTH);
    tickGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]]), 3));
    const tickMat = new THREE.LineBasicMaterial({ color: GIZMO_COLORS.frontTick, depthTest: false });
    const tick = new THREE.LineSegments(tickGeo, tickMat);
    tick.name = name + ':frontTick';
    tick.frustumCulled = false;
    tick.renderOrder = 21;
    lines.add(tick);
    return lines;
  }

  function applyHighlight() {
    for (const o of anchorObjects) {
      const mat = /** @type {THREE.LineBasicMaterial} */ (o.material);
      if (highlighted !== null && o.name === highlighted) {
        mat.color.set(GIZMO_COLORS.anchorHighlight);
        mat.opacity = 1;
      } else {
        mat.color.set(GIZMO_COLORS.anchor);
        mat.opacity = 0.6;
      }
    }
  }

  /** @param {Record<string, Anchor>|null} anchors */
  function setAnchors(anchors) {
    clearAnchors();
    if (!anchors || typeof anchors !== 'object') return;
    for (const name of Object.keys(anchors)) {
      const a = anchors[name];
      if (!a || !Array.isArray(a.origin) || !Array.isArray(a.axis) || !Array.isArray(a.front)) continue;
      const lines = buildAnchor(name, a);
      object.add(lines);
      anchorObjects.push(lines);
    }
    applyHighlight();
  }

  /** @param {ClothState|null} state */
  function setPlacements(state) {
    clearOutlines();
    if (!state || !Array.isArray(state.pieces) || !state.restPos) return;
    const rest = state.restPos;
    for (const piece of state.pieces) {
      const boundary = piece && piece.mesh ? piece.mesh.boundary : null;
      if (!boundary || boundary.length < 2) continue;
      const arr = new Float32Array(3 * boundary.length);
      for (let i = 0; i < boundary.length; i++) {
        const v = 3 * (piece.start + boundary[i]);
        arr[3 * i] = rest[v];
        arr[3 * i + 1] = rest[v + 1];
        arr[3 * i + 2] = rest[v + 2];
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const mat = new THREE.LineBasicMaterial({ color: GIZMO_COLORS.outline, depthTest: false });
      const loop = new THREE.LineLoop(geo, mat);
      loop.name = piece.pieceId;
      loop.frustumCulled = false;
      loop.renderOrder = 22;
      object.add(loop);
      outlineObjects.push(loop);
    }
  }

  /** @param {string|null} name */
  function highlight(name) {
    highlighted = typeof name === 'string' ? name : null;
    applyHighlight();
  }

  /** @param {boolean} on */
  function setVisible(on) {
    object.visible = !!on;
  }

  function dispose() {
    clearAnchors();
    clearOutlines();
    if (object.parent) object.parent.remove(object);
  }

  return { object, setAnchors, setPlacements, highlight, setVisible, dispose };
}
