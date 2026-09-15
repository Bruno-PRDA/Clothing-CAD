// src/viewer3d/index.js — public surface of the 3D viewer (SPEC section 8): re-exports of every file, the pop-out
// bridge (8.8) and the Viewer3D facade (8.9). Never imports the store or the bus; reads ClothState / BodyModel /
// FabricResolved by shape only.

import { uid } from '../core/ids.js';
import { VIEWER_DEFAULTS, DEFAULT_BODY_BOX, createViewer } from './scene.js';
import { BODY_SKIN, createBodyMesh } from './bodyMesh.js';
import { UV_UNIT_MM, topologyFromState, accumulateNormals, createClothMesh } from './clothMesh.js';
import { fabricMaterial, updateMaterial, materialFor, materialCacheSize, disposeMaterials } from './materials.js';
import { TEXTURE_SIZE, textureKey, drawTextureCanvas, fabricTexture, textureCacheSize, disposeTextures } from './textures.js';
import { createLoop } from './loop.js';
import { GIZMO_COLORS, createAnchorsGizmo } from './anchorsGizmo.js';

export { VIEWER_DEFAULTS, DEFAULT_BODY_BOX, createViewer };
export { BODY_SKIN, createBodyMesh };
export { UV_UNIT_MM, topologyFromState, accumulateNormals, createClothMesh };
export { fabricMaterial, updateMaterial, materialFor, materialCacheSize, disposeMaterials };
export { TEXTURE_SIZE, textureKey, drawTextureCanvas, fabricTexture, textureCacheSize, disposeTextures };
export { createLoop };
export { GIZMO_COLORS, createAnchorsGizmo };

/** @typedef {import('../core/types.js').ClothState} ClothState */
/** @typedef {import('../core/types.js').BodyModel} BodyModel */
/** @typedef {import('../core/types.js').FabricResolved} FabricResolved */
/** @typedef {import('../core/types.js').Anchor} Anchor */
/** @typedef {import('./scene.js').Viewer} Viewer */
/** @typedef {import('./bodyMesh.js').BodyMeshHandle} BodyMeshHandle */
/** @typedef {import('./clothMesh.js').ClothMeshHandle} ClothMeshHandle */
/** @typedef {import('./clothMesh.js').ClothTopology} ClothTopology */
/** @typedef {import('./loop.js').Loop} Loop */
/** @typedef {import('./anchorsGizmo.js').AnchorsGizmoHandle} AnchorsGizmoHandle */

// ---------------------------------------------------------------- 8.8 pop-out bridge

export const POPOUT_CHANNEL = 'clothing-app-3d';
export const POPOUT_URL = 'popout.html';
export const POPOUT_HZ = 30;
export const POPOUT_WINDOW_FEATURES = 'popup=yes,width=960,height=800';
const POPOUT_WINDOW_NAME = 'clothing-app-3d';

/**
 * Messages on BroadcastChannel(POPOUT_CHANNEL); every message carries `session`.
 * @typedef {{type:'hello', session:string}} PopoutHello
 * @typedef {{type:'closed', session:string}} PopoutClosed
 * @typedef {{type:'body', session:string, hasBody:boolean, positions:Float32Array, normals:Float32Array, indices:Uint32Array, chestY:number}} PopoutBody
 * @typedef {{type:'cloth:init', session:string, topology:ClothTopology|null}} PopoutClothInit
 * @typedef {{type:'cloth:pos', session:string, pos:Float32Array, frame:number}} PopoutClothPos
 * @typedef {{type:'close', session:string}} PopoutClose
 */

/**
 * @typedef {Object} PopoutBridge
 * @property {string} sessionId
 * @property {() => boolean} open
 * @property {() => boolean} isOpen
 * @property {() => void} close
 * @property {(model:BodyModel|null) => void} sendBody
 * @property {(topology:ClothTopology|null) => void} sendClothInit
 * @property {(pos:Float32Array, frame:number, force?:boolean) => void} sendPositions
 * @property {(fn:() => void) => void} onOpened
 * @property {(fn:() => void) => void} onClosed
 * @property {() => void} dispose
 */

const EMPTY_F32 = new Float32Array(0);
const EMPTY_U32 = new Uint32Array(0);

/**
 * Main-window side of the BroadcastChannel bridge. Never touches the bus; wiring turns onOpened/onClosed into popout:open/close.
 * @param {{getBody: () => BodyModel|null, getTopology: () => ClothTopology|null, getPositions: () => {pos: Float32Array, frame: number}|null}} opts
 * @returns {PopoutBridge}
 */
export function createPopoutBridge(opts) {
  const getBody = opts && typeof opts.getBody === 'function' ? opts.getBody : () => null;
  const getTopology = opts && typeof opts.getTopology === 'function' ? opts.getTopology : () => null;
  const getPositions = opts && typeof opts.getPositions === 'function' ? opts.getPositions : () => null;

  const sessionId = uid('sess');
  /** @type {BroadcastChannel|null} */
  let channel = null;
  /** @type {Window|null} */
  let win = null;
  let open = false;
  let lastSent = -Infinity;
  let pollId = 0;
  let disposed = false;
  /** @type {(() => void)[]} */
  const openedCbs = [];
  /** @type {(() => void)[]} */
  const closedCbs = [];
  const hasWindow = typeof window !== 'undefined';

  /** @param {(() => void)[]} cbs */
  function fire(cbs) {
    for (const fn of cbs.slice()) {
      try { fn(); } catch (err) { console.error('viewer3d/popout: callback error', err); }
    }
  }

  /** @param {object} msg */
  function post(msg) {
    if (!channel) return;
    try { channel.postMessage(msg); } catch (err) { console.warn('viewer3d/popout: postMessage failed', err); }
  }

  function ensureChannel() {
    if (channel || typeof BroadcastChannel === 'undefined') return;
    channel = new BroadcastChannel(POPOUT_CHANNEL);
    channel.onmessage = (ev) => {
      const m = ev && ev.data;
      if (!m || m.session !== sessionId) return;
      if (m.type === 'hello') onHello();
      else if (m.type === 'closed') markClosed();
    };
  }

  function clearPoll() {
    if (pollId) { clearInterval(pollId); pollId = 0; }
  }

  function onHello() {
    if (disposed) return;
    open = true;
    sendBody(getBody());
    sendClothInit(getTopology());
    const p = getPositions();
    if (p && p.pos) sendPositions(p.pos, p.frame | 0, true);
    fire(openedCbs);
  }

  function markClosed() {
    const had = open || !!win;
    open = false;
    win = null;
    clearPoll();
    if (had) fire(closedCbs);
  }

  function openWindow() {
    if (disposed || !hasWindow) return false;
    ensureChannel();
    if (win && !win.closed) {
      try { win.focus(); } catch (_e) { /* ignore */ }
      return true;
    }
    let w = null;
    try {
      w = window.open(POPOUT_URL + '?session=' + encodeURIComponent(sessionId), POPOUT_WINDOW_NAME, POPOUT_WINDOW_FEATURES);
    } catch (_e) {
      w = null;
    }
    if (!w) return false;
    win = w;
    clearPoll();
    pollId = setInterval(() => {
      if (!win || win.closed) markClosed();
    }, 1000);
    return true;
  }

  function isOpen() {
    return open;
  }

  function close() {
    if (win || open) post({ type: 'close', session: sessionId });
    if (win && !win.closed) {
      try { win.close(); } catch (_e) { /* ignore */ }
    }
    markClosed();
  }

  /** @param {BodyModel|null} model */
  function sendBody(model) {
    if (!open || !channel) return;
    const g = model && model.geometry ? model.geometry : null;
    const cc = model && model.landmarks ? model.landmarks.chestCenter : null;
    post({
      type: 'body', session: sessionId, hasBody: !!(model && g),
      positions: g && g.positions ? g.positions : EMPTY_F32,
      normals: g && g.normals ? g.normals : EMPTY_F32,
      indices: g && g.indices ? g.indices : EMPTY_U32,
      chestY: Array.isArray(cc) && Number.isFinite(cc[1]) ? cc[1] : 0,
    });
  }

  /** @param {ClothTopology|null} topology */
  function sendClothInit(topology) {
    if (!open || !channel) return;
    post({ type: 'cloth:init', session: sessionId, topology: topology || null });
  }

  /** @param {Float32Array} pos @param {number} frame @param {boolean} [force] */
  function sendPositions(pos, frame, force = false) {
    if (!open || !channel) return;
    const now = performance.now();
    if (!force && now - lastSent < 1000 / POPOUT_HZ) return;
    lastSent = now;
    post({ type: 'cloth:pos', session: sessionId, pos, frame });
  }

  /** @param {() => void} fn */
  function onOpened(fn) { if (typeof fn === 'function') openedCbs.push(fn); }
  /** @param {() => void} fn */
  function onClosed(fn) { if (typeof fn === 'function') closedCbs.push(fn); }

  function onPageHide() {
    if (win || open) post({ type: 'close', session: sessionId });
  }
  if (hasWindow) window.addEventListener('pagehide', onPageHide);

  function dispose() {
    if (disposed) return;
    close();
    disposed = true;
    clearPoll();
    if (hasWindow) window.removeEventListener('pagehide', onPageHide);
    if (channel) { try { channel.close(); } catch (_e) { /* ignore */ } channel = null; }
    openedCbs.length = 0;
    closedCbs.length = 0;
  }

  return { sessionId, open: openWindow, isOpen, close, sendBody, sendClothInit, sendPositions, onOpened, onClosed, dispose };
}

// ---------------------------------------------------------------- 8.9 facade

/**
 * @typedef {Object} Viewer3D
 * @property {Viewer} viewer
 * @property {BodyMeshHandle} body
 * @property {ClothMeshHandle} cloth
 * @property {AnchorsGizmoHandle} gizmo
 * @property {Loop} loop
 * @property {PopoutBridge} popout
 * @property {(model:BodyModel|null) => void} setBody
 * @property {(state:ClothState|null, fabricsByPiece?:Record<string,FabricResolved>|null) => void} setCloth
 * @property {(state:ClothState, force?:boolean) => void} sync
 * @property {(pieceId:string, fabric:FabricResolved) => void} setPieceFabric
 * @property {() => void} fit
 * @property {() => void} render
 * @property {() => string} screenshot
 * @property {(on:boolean) => void} setWireframe
 * @property {(on:boolean) => void} setLandmarks
 * @property {(on:boolean) => void} setGizmo
 * @property {(a:number) => void} setBodyOpacity
 * @property {() => {fps:number, frames:number, drawCalls:number, triangles:number, V:number, T:number, lastFrameMs:number}} stats
 * @property {() => void} dispose
 */

/**
 * Composes viewer + body/cloth/gizmo handles + a started loop + the pop-out bridge. Throws code 'WebGLUnavailable'.
 * @param {HTMLElement} container  #view-3d
 * @param {{tick?: ((dtMs: number, frame: number) => void)|null, viewer?: Partial<typeof VIEWER_DEFAULTS>, onFps?: (fps: number) => void}} [opts]
 * @returns {Viewer3D}
 */
export function createViewer3D(container, opts = {}) {
  const viewer = createViewer(container, opts.viewer || {});
  const body = createBodyMesh();
  const cloth = createClothMesh();
  const gizmo = createAnchorsGizmo();
  viewer.root.add(body.object, cloth.object, cloth.wire, gizmo.object);

  /** @type {BodyModel|null} */
  let currentBody = null;
  /** @type {ClothState|null} */
  let currentState = null;
  let lastFrame = -1;
  /** @type {Float32Array|null} */
  let lastPosRef = null;
  let fittedOnce = false;
  let disposed = false;

  const popout = createPopoutBridge({
    getBody: () => currentBody,
    getTopology: () => cloth.topology(),
    getPositions: () => (currentState ? { pos: currentState.pos, frame: currentState.frame | 0 } : null),
  });

  function render() {
    viewer.controls.update();
    viewer.render();
  }

  const loop = createLoop({ tick: opts.tick || null, render, onFps: opts.onFps });
  loop.start();

  /** @param {BodyModel|null} model */
  function setBody(model) {
    body.setBody(model || null);
    currentBody = model || null;
    gizmo.setAnchors(model && model.anchors ? model.anchors : null);
    popout.sendBody(currentBody);
    if (model && !fittedOnce) {
      fittedOnce = true;
      viewer.fit(model, { resetDir: true });
    }
  }

  /** @param {ClothState|null} state @param {Record<string,FabricResolved>|null} [fabricsByPiece] */
  function setCloth(state, fabricsByPiece = null) {
    if (state) {
      const topology = topologyFromState(state, fabricsByPiece);
      cloth.build(topology);
      currentState = state;
      lastFrame = state.frame | 0;
      lastPosRef = state.pos;
      gizmo.setPlacements(state);
      popout.sendClothInit(topology);
    } else {
      cloth.clear();
      currentState = null;
      lastFrame = -1;
      lastPosRef = null;
      gizmo.setPlacements(null);
      popout.sendClothInit(null);
    }
  }

  /** @param {ClothState} state @param {boolean} [force] */
  function sync(state, force = false) {
    if (!state || cloth.vertexCount() === 0) return;
    if (force || (state.frame | 0) !== lastFrame || state.pos !== lastPosRef) {
      cloth.updatePositions(state.pos);
      lastFrame = state.frame | 0;
      lastPosRef = state.pos;
      currentState = state;
      popout.sendPositions(state.pos, state.frame | 0, force);
    }
  }

  /** @param {string} pieceId @param {FabricResolved} fabric */
  function setPieceFabric(pieceId, fabric) {
    if (cloth.setPieceFabric(pieceId, fabric)) popout.sendClothInit(cloth.topology());
  }

  function fit() {
    viewer.fit(currentBody);
  }

  function screenshot() {
    viewer.controls.update();
    return viewer.screenshot();
  }

  /** @param {boolean} on */
  function setWireframe(on) {
    body.setWireframe(on);
    cloth.setWireframe(on);
  }

  /** @param {boolean} on */
  function setLandmarks(on) { body.setLandmarksVisible(on); }
  /** @param {boolean} on */
  function setGizmo(on) { gizmo.setVisible(on); }
  /** @param {number} a */
  function setBodyOpacity(a) { body.setOpacity(a); }

  function stats() {
    const ri = viewer.renderInfo();
    return {
      fps: loop.fps, frames: loop.frameCount, drawCalls: ri.calls, triangles: ri.triangles,
      V: cloth.vertexCount(), T: cloth.triangleCount(), lastFrameMs: loop.lastFrameMs,
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    loop.dispose();
    popout.dispose();
    gizmo.dispose();
    cloth.dispose();
    body.dispose();
    disposeMaterials();
    disposeTextures();
    viewer.dispose();
    currentBody = null;
    currentState = null;
  }

  return {
    viewer, body, cloth, gizmo, loop, popout,
    setBody, setCloth, sync, setPieceFabric, fit, render, screenshot,
    setWireframe, setLandmarks, setGizmo, setBodyOpacity, stats, dispose,
  };
}
