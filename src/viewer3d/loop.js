// src/viewer3d/loop.js — requestAnimationFrame driver (SPEC 8.6). No three import.

/**
 * @typedef {Object} Loop
 * @property {() => void} start
 * @property {() => void} stop
 * @property {() => boolean} isRunning       true while a frame is scheduled (false when stopped or the document is hidden)
 * @property {boolean} renderSuppressed      settable; true = frames are skipped entirely (no tick, no render)
 * @property {() => void} renderNow          synchronous render ignoring renderSuppressed
 * @property {number} fps                    rendered frames in the last completed 1 s window
 * @property {number} frameCount             rendered frames since start()
 * @property {number} lastFrameMs            wall-clock ms between the last two rAF callbacks (clamped to 100)
 * @property {() => void} dispose            stop + remove the visibilitychange listener
 */

/** @returns {number} */
function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/**
 * @param {{ tick?: ((dtMs:number, frame:number) => void)|null, render: () => void, onFps?: (fps:number) => void }} opts
 * @returns {Loop}
 */
export function createLoop(opts) {
  const tick = opts && typeof opts.tick === 'function' ? opts.tick : null;
  const render = opts && typeof opts.render === 'function' ? opts.render : () => {};
  const onFps = opts && typeof opts.onFps === 'function' ? opts.onFps : null;

  let running = false;
  let paused = false;
  let rafId = 0;
  let lastNow = 0;
  let windowStart = 0;
  let windowFrames = 0;
  let disposed = false;

  const hasRaf = typeof requestAnimationFrame === 'function';
  const doc = typeof document !== 'undefined' ? document : null;

  /** @type {Loop} */
  const loop = {
    renderSuppressed: false,
    fps: 0,
    frameCount: 0,
    lastFrameMs: 0,
    start,
    stop,
    isRunning: () => running && !paused,
    renderNow,
    dispose,
  };

  function schedule() {
    if (!hasRaf) return;
    rafId = requestAnimationFrame(onFrame);
  }

  /** @param {number} now */
  function onFrame(now) {
    if (!running || paused) return;
    const dtMs = Math.min(Math.max(0, now - lastNow), 100);
    lastNow = now;
    loop.lastFrameMs = dtMs;
    if (!loop.renderSuppressed) {
      try {
        if (tick) tick(dtMs, loop.frameCount);
        render();
      } catch (err) {
        // keep the loop alive; the wiring's tick is expected to catch its own errors
        console.error('viewer3d/loop: frame error', err);
      }
      loop.frameCount++;
      windowFrames++;
    }
    if (now - windowStart >= 1000) {
      loop.fps = windowFrames;
      windowFrames = 0;
      windowStart = now;
      if (onFps) {
        try { onFps(loop.fps); } catch (err) { console.error('viewer3d/loop: onFps error', err); }
      }
    }
    schedule();
  }

  function start() {
    if (disposed || running) return;
    running = true;
    paused = doc ? doc.visibilityState === 'hidden' : false;
    lastNow = nowMs();
    windowStart = lastNow;
    windowFrames = 0;
    if (!paused) schedule();
  }

  function stop() {
    if (!running) return;
    running = false;
    if (hasRaf && rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function renderNow() {
    render();
  }

  function onVisibility() {
    if (!doc) return;
    if (doc.visibilityState === 'hidden') {
      if (hasRaf && rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      paused = true;
    } else {
      const wasPaused = paused;
      paused = false;
      if (running && wasPaused) {
        lastNow = nowMs();
        windowStart = lastNow;
        windowFrames = 0;
        schedule();
      }
    }
  }

  if (doc) doc.addEventListener('visibilitychange', onVisibility);

  function dispose() {
    stop();
    disposed = true;
    if (doc) doc.removeEventListener('visibilitychange', onVisibility);
  }

  return loop;
}
