// src/popout/main.js — entry module of popout.html (SPEC 8.8). View-only mirror of the main window's 3D scene
// over BroadcastChannel(POPOUT_CHANNEL). Imports only src/viewer3d/index.js and src/core/*; owns a private
// EventBus (never the shared `bus`); installs window.__popout for manual inspection.

import { EventBus } from '../core/events.js';
import { createViewer3D, POPOUT_CHANNEL } from '../viewer3d/index.js';

const localBus = new EventBus();
const statusEl = document.getElementById('popout-status');
const rootEl = document.getElementById('popout-root');
const viewEl = document.getElementById('view-3d') || rootEl;

/** @param {string} text */
function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

const session = new URLSearchParams(location.search).get('session');

let frames = 0;
let lastFrame = -1;
let fps = 0;
/** @type {ReturnType<typeof createViewer3D>|null} */
let v = null;
/** @type {BroadcastChannel|null} */
let ch = null;

window.__popout = {
  frames: () => frames,
  V: () => (v ? v.cloth.vertexCount() : 0),
  get lastFrame() { return lastFrame; },
  get session() { return session; },
  get viewer() { return v; },
  bus: localBus,
};

function updateStatus() {
  if (frames > 0 && v) setStatus(`3D mirror · ${fps} fps · ${v.cloth.vertexCount()} vertices`);
}

function main() {
  if (!session) {
    setStatus("Open this window from the app's Pop-out button.");
    return;
  }
  if (!viewEl) {
    setStatus('popout.html is missing #popout-root.');
    return;
  }
  try {
    v = createViewer3D(viewEl, { tick: null, onFps: (f) => { fps = f; updateStatus(); } });
  } catch (err) {
    setStatus('3D view unavailable: ' + String(err && err.message ? err.message : err));
    return;
  }
  if (typeof BroadcastChannel === 'undefined') {
    setStatus('BroadcastChannel is not supported by this browser.');
    return;
  }

  let gotAnyMessage = false;
  let firstBody = true;
  ch = new BroadcastChannel(POPOUT_CHANNEL);
  ch.onmessage = (ev) => {
    const m = ev && ev.data;
    if (!m || m.session !== session || !v) return;
    gotAnyMessage = true;
    switch (m.type) {
      case 'body': {
        if (m.hasBody) {
          const model = { geometry: { positions: m.positions, normals: m.normals, indices: m.indices }, landmarks: { chestCenter: [0, m.chestY, 0] } };
          try {
            v.body.setBody(model);
            if (firstBody) {
              firstBody = false;
              v.viewer.fit(model, { resetDir: true });
            }
          } catch (err) {
            setStatus('Bad body data: ' + String(err && err.message ? err.message : err));
          }
        } else {
          v.body.setBody(null);
        }
        break;
      }
      case 'stage': {
        try {
          if (typeof v.setStage === 'function') v.setStage({ preset: m.preset, background: m.background || null });
        } catch (err) {
          setStatus('Bad scene data: ' + String(err && err.message ? err.message : err));
        }
        break;
      }
      case 'cloth:init': {
        try {
          if (m.topology) v.cloth.build(m.topology);
          else v.cloth.clear();
        } catch (err) {
          setStatus('Bad cloth data: ' + String(err && err.message ? err.message : err));
        }
        break;
      }
      case 'cloth:pos': {
        const pos = m.pos;
        if (pos && pos.length === 3 * v.cloth.vertexCount() && pos.length > 0) {
          v.cloth.updatePositions(pos);
          frames++;
          lastFrame = m.frame | 0;
          updateStatus();
        }
        break;
      }
      case 'close':
        window.close();
        break;
      default:
        break;
    }
  };

  ch.postMessage({ type: 'hello', session });
  setStatus('Waiting for the main window…');
  setTimeout(() => {
    if (!gotAnyMessage) setStatus('No data from the main window — is the app still open?');
  }, 3000);

  window.addEventListener('pagehide', () => {
    try { if (ch) ch.postMessage({ type: 'closed', session }); } catch (_e) { /* ignore */ }
    try { if (ch) ch.close(); } catch (_e) { /* ignore */ }
    ch = null;
    try { if (v) v.dispose(); } catch (_e) { /* ignore */ }
    v = null;
  });
}

main();
