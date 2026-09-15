// src/viewer3d/scene.js — renderer, camera, OrbitControls, lights, ground, resize, framing (SPEC 8.1).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Tunables; every constructor option defaults to these. */
export const VIEWER_DEFAULTS = Object.freeze({
  background: '#2a2e35', fov: 40, near: 0.02, far: 100, pixelRatioMax: 2, shadows: true, environment: true,
  environmentIntensity: 0.5, toneMappingExposure: 1.0, gridSize_m: 4, gridDivisions: 40, shadowPlaneSize_m: 6,
  shadowOpacity: 0.35, frameMargin: 1.05, defaultDir: Object.freeze([0, 0.17, 1]),
});

/** Box framed before any body exists: a 1.75 m body in A-pose, metres. */
export const DEFAULT_BODY_BOX = Object.freeze({ min: Object.freeze([-0.55, 0, -0.25]), max: Object.freeze([0.55, 1.75, 0.25]) });

/** @param {string} message @returns {Error & {code:string}} */
function webglUnavailable(message) {
  const err = /** @type {Error & {code:string}} */ (new Error('WebGLUnavailable: ' + message));
  err.code = 'WebGLUnavailable';
  return err;
}

/**
 * @typedef {Object} Viewer
 * @property {HTMLElement} container
 * @property {THREE.WebGLRenderer} renderer
 * @property {THREE.Scene} scene
 * @property {THREE.PerspectiveCamera} camera
 * @property {OrbitControls} controls   (a minimal {target, update, dispose} stand-in when opts.orbit === false)
 * @property {THREE.Group} root
 * @property {{hemi:THREE.HemisphereLight, key:THREE.DirectionalLight, fill:THREE.DirectionalLight}} lights
 * @property {{grid:THREE.GridHelper, shadowPlane:THREE.Mesh}} ground
 * @property {boolean} contextLost
 * @property {() => void} resize
 * @property {() => void} render
 * @property {(box:{min:number[],max:number[]}, opts?:{targetY?:number, dir?:number[], margin?:number}) => void} frame
 * @property {(bodyModel?: {geometry:{positions:Float32Array}, landmarks?:Record<string,number[]>}|null, opts?:{resetDir?:boolean}) => void} fit
 * @property {(hex:string) => void} setBackground
 * @property {() => string} screenshot
 * @property {() => {width:number, height:number, dpr:number}} size
 * @property {() => {calls:number, triangles:number}} renderInfo
 * @property {() => void} dispose
 */

/**
 * Creates the WebGL renderer inside `container`.
 * @param {HTMLElement} container
 * @param {Partial<typeof VIEWER_DEFAULTS> & {orbit?:boolean}} [opts]
 * @returns {Viewer}
 * @throws {Error} code 'WebGLUnavailable'
 */
export function createViewer(container, opts = {}) {
  if (!container || typeof container !== 'object') throw webglUnavailable('no container element');
  const o = { ...VIEWER_DEFAULTS, ...(opts || {}) };
  const useOrbit = opts.orbit !== false;

  // 1. renderer
  /** @type {THREE.WebGLRenderer} */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  } catch (err) {
    throw webglUnavailable(String(err && err.message ? err.message : err));
  }
  if (!renderer.getContext()) {
    try { renderer.dispose(); } catch (_e) { /* ignore */ }
    throw webglUnavailable('renderer.getContext() returned null');
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = o.toneMappingExposure;
  renderer.shadowMap.enabled = !!o.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, o.pixelRatioMax);
  renderer.setPixelRatio(dpr);
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);

  const state = { contextLost: false, width: 0, height: 0 };
  const info = { calls: 0, triangles: 0 };

  /** @param {Event} ev */
  function onContextLost(ev) {
    ev.preventDefault();
    state.contextLost = true;
  }
  function onContextRestored() {
    state.contextLost = false;
    render();
  }
  canvas.addEventListener('webglcontextlost', onContextLost, false);
  canvas.addEventListener('webglcontextrestored', onContextRestored, false);

  // 2. scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(o.background);
  const root = new THREE.Group();
  root.name = 'root';
  scene.add(root);
  if (o.environment) {
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = o.environmentIntensity;
      pmrem.dispose();
    } catch (err) {
      console.warn('viewer3d/scene: environment map failed', err);
      scene.environment = null;
    }
  }

  // 3. camera
  const camera = new THREE.PerspectiveCamera(o.fov, 1, o.near, o.far);
  camera.position.set(0, 1.26, 3.74);

  // 4. controls
  /** @type {any} */
  let controls;
  if (useOrbit) {
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.3;
    controls.maxDistance = 15;
    controls.maxPolarAngle = 0.95 * Math.PI;
    controls.screenSpacePanning = true;
  } else {
    const target = new THREE.Vector3(0, 1.26, 0);
    controls = { target, update() { camera.lookAt(target); return true; }, dispose() {} };
  }

  // 5. lights
  const hemi = new THREE.HemisphereLight(0xdfe8f0, 0x4a4036, 0.9);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1.6, 3.2, 2.4);
  key.target.position.set(0, 0.9, 0);
  key.castShadow = !!o.shadows;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -1.6;
  key.shadow.camera.right = 1.6;
  key.shadow.camera.bottom = -1.6;
  key.shadow.camera.top = 1.6;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 10;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.015;
  const fill = new THREE.DirectionalLight(0xb0c4de, 0.6);
  fill.position.set(-2.0, 1.5, -1.5);
  scene.add(hemi, key, key.target, fill);

  // 6. ground
  const grid = new THREE.GridHelper(o.gridSize_m, o.gridDivisions, 0x666b73, 0x3a3f47);
  grid.position.y = 0.001;
  const gridMat = /** @type {THREE.Material} */ (grid.material);
  gridMat.transparent = true;
  gridMat.opacity = 0.6;
  const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(o.shadowPlaneSize_m, o.shadowPlaneSize_m), new THREE.ShadowMaterial({ opacity: o.shadowOpacity }));
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.receiveShadow = true;
  shadowPlane.name = 'shadowPlane';
  scene.add(grid, shadowPlane);

  // 7. resize
  function resize() {
    const w = Math.max(1, container.clientWidth | 0);
    const h = Math.max(1, container.clientHeight | 0);
    state.width = container.clientWidth | 0;
    state.height = container.clientHeight | 0;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  /** @type {ResizeObserver|null} */
  let observer = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => { resize(); render(); });
    observer.observe(container);
  }

  function render() {
    if (state.contextLost) return;
    if ((container.clientWidth | 0) === 0 || (container.clientHeight | 0) === 0) return;
    if (state.width !== (container.clientWidth | 0) || state.height !== (container.clientHeight | 0)) resize();
    renderer.render(scene, camera);
    info.calls = renderer.info.render.calls;
    info.triangles = renderer.info.render.triangles;
  }

  // 8. frame
  const _target = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _q = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  /**
   * @param {{min:number[], max:number[]}} box
   * @param {{targetY?:number, dir?:number[], margin?:number}} [fopts]
   */
  function frame(box, fopts = {}) {
    const min = box.min, max = box.max;
    _target.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    if (typeof fopts.targetY === 'number' && Number.isFinite(fopts.targetY)) _target.y = fopts.targetY;
    if (Array.isArray(fopts.dir)) {
      _dir.set(fopts.dir[0], fopts.dir[1], fopts.dir[2]);
    } else {
      _dir.copy(camera.position).sub(controls.target);
    }
    if (_dir.length() < 1e-6) _dir.set(o.defaultDir[0], o.defaultDir[1], o.defaultDir[2]);
    _dir.normalize();
    _right.crossVectors(UP, _dir);
    if (_right.length() < 1e-6) _right.set(1, 0, 0);
    else _right.normalize();
    _up.crossVectors(_dir, _right);
    const tv = Math.tan((camera.fov * Math.PI) / 360);
    const th = tv * camera.aspect;
    let dmax = 0;
    for (let i = 0; i < 8; i++) {
      _p.set(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]);
      _q.copy(_p).sub(_target);
      const along = _q.dot(_dir);
      const dV = along + Math.abs(_q.dot(_up)) / tv;
      const dH = along + Math.abs(_q.dot(_right)) / th;
      dmax = Math.max(dmax, dV, dH);
    }
    const margin = typeof fopts.margin === 'number' && Number.isFinite(fopts.margin) ? fopts.margin : o.frameMargin;
    const d = Math.min(20, Math.max(0.5, margin * dmax));
    camera.position.copy(_target).addScaledVector(_dir, d);
    controls.target.copy(_target);
    camera.lookAt(_target);
    controls.update();
  }

  // 9. fit
  const _box3 = new THREE.Box3();
  /**
   * @param {{geometry:{positions:Float32Array}, landmarks?:Record<string,number[]>}|null} [bodyModel]
   * @param {{resetDir?:boolean}} [fopts]
   */
  function fit(bodyModel = null, fopts = {}) {
    let box;
    const positions = bodyModel && bodyModel.geometry ? bodyModel.geometry.positions : null;
    if (positions && positions.length >= 3) {
      _box3.setFromArray(positions);
      box = { min: [_box3.min.x, _box3.min.y, _box3.min.z], max: [_box3.max.x, _box3.max.y, _box3.max.z] };
    } else {
      box = DEFAULT_BODY_BOX;
    }
    const cc = bodyModel && bodyModel.landmarks ? bodyModel.landmarks.chestCenter : null;
    const targetY = Array.isArray(cc) && Number.isFinite(cc[1]) ? cc[1] : box.min[1] + 0.72 * (box.max[1] - box.min[1]);
    frame(box, { targetY, dir: fopts.resetDir === true ? Array.from(o.defaultDir) : undefined });
  }

  /** @param {string} hex */
  function setBackground(hex) {
    if (scene.background && scene.background.isColor) scene.background.set(hex);
    else scene.background = new THREE.Color(hex);
  }

  function screenshot() {
    if (state.contextLost || (container.clientWidth | 0) === 0 || (container.clientHeight | 0) === 0) return 'data:,';
    render();
    try {
      return canvas.toDataURL('image/png');
    } catch (_e) {
      return 'data:,';
    }
  }

  function size() {
    return { width: container.clientWidth | 0, height: container.clientHeight | 0, dpr: renderer.getPixelRatio() };
  }

  function renderInfo() {
    return { calls: info.calls, triangles: info.triangles };
  }

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (observer) { observer.disconnect(); observer = null; }
    try { controls.dispose(); } catch (_e) { /* ignore */ }
    canvas.removeEventListener('webglcontextlost', onContextLost, false);
    canvas.removeEventListener('webglcontextrestored', onContextRestored, false);
    grid.geometry.dispose();
    gridMat.dispose();
    shadowPlane.geometry.dispose();
    /** @type {THREE.Material} */ (shadowPlane.material).dispose();
    if (scene.environment) { scene.environment.dispose(); scene.environment = null; }
    try { renderer.dispose(); } catch (_e) { /* ignore */ }
    try { renderer.forceContextLoss(); } catch (_e) { /* ignore */ }
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  // initial size + camera placement
  resize();
  frame(DEFAULT_BODY_BOX, { targetY: 0.72 * 1.75, dir: Array.from(o.defaultDir) });

  /** @type {Viewer} */
  const viewer = {
    container, renderer, scene, camera, controls, root,
    lights: { hemi, key, fill },
    ground: { grid, shadowPlane },
    get contextLost() { return state.contextLost; },
    resize, render, frame, fit, setBackground, screenshot, size, renderInfo, dispose,
  };
  return viewer;
}
