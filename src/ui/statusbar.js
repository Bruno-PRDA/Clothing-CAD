// src/ui/statusbar.js — the six readouts of #statusbar (SPEC 11.6). Listens to the bus only; never writes the store.

import { EVENT } from '../core/events.js';
import { TOOL_HINTS, formatEase } from '../pattern/index.js';
import { byId } from './ids.js';

/** @typedef {import('../core/events.js').EventBus} EventBus */
/** @typedef {import('../core/types.js').SimStats} SimStats */

export const LOG_LIMIT = 200;
/** Default lifetime of a message per level (SPEC 11.6); 0 = sticky until the next message. */
export const TTL_MS = Object.freeze({ info: 4000, warn: 8000, error: 0 });
/** Number of SIM_STATS arrivals used for the fps estimate. */
export const FPS_WINDOW = 30;
/** #status-sim is written at most this often (the event arrives every frame). */
export const SIM_WRITE_MS = 250;

/**
 * @param {EventBus} bus @param {Document|HTMLElement} [root=document]
 * @returns {object} statusbar controller (SPEC 11.6)
 */
export function createStatusbar(bus, root = document) {
  const elTool = byId(root, 'status-tool');
  const elMsg = byId(root, 'status-msg');
  const elCursor = byId(root, 'status-cursor');
  const elEase = byId(root, 'status-seam-ease');
  const elQuality = byId(root, 'status-quality');
  const elSim = byId(root, 'status-sim');

  /** @type {Array<() => void>} */
  const offs = [];
  let destroyed = false;

  /** @type {{t:number, level:string, text:string}[]} */
  const log = [];
  /** @type {any} */
  let msgTimer = null;

  // ------------------------------------------------------------------ messages

  /**
   * @param {string} text @param {'info'|'warn'|'error'} [level='info'] @param {number} [ttl_ms]
   */
  function setMessage(text, level = 'info', ttl_ms) {
    const lvl = (level === 'warn' || level === 'error') ? level : 'info';
    const s = text == null ? '' : String(text);
    if (elMsg) { elMsg.textContent = s; elMsg.dataset.level = lvl; }
    log.push({ t: Date.now(), level: lvl, text: s });
    while (log.length > LOG_LIMIT) log.shift();
    if (lvl === 'warn') console.warn('[ui]', s);
    else if (lvl === 'error') console.error('[ui]', s);
    if (msgTimer) { clearTimeout(msgTimer); msgTimer = null; }
    const ttl = Number.isFinite(ttl_ms) ? Number(ttl_ms) : TTL_MS[lvl];
    if (ttl > 0 && s) {
      msgTimer = setTimeout(() => {
        msgTimer = null;
        if (elMsg && elMsg.textContent === s) elMsg.textContent = '';
      }, ttl);
    }
  }

  function getLog() { return log.slice(); }

  // ------------------------------------------------------------------ tool hint

  /** @param {string} text */
  function setToolHint(text) { if (elTool) elTool.textContent = text == null ? '' : String(text); }

  // ------------------------------------------------------------------ cursor (one write per animation frame)

  /** @type {{x:number, y:number}|null} */
  let cursorPending = null;
  let cursorDirty = false;
  let cursorRaf = 0;

  function flushCursor() {
    cursorRaf = 0;
    cursorDirty = false;
    if (!elCursor) return;
    elCursor.textContent = cursorPending
      ? 'x ' + cursorPending.x.toFixed(1) + '  y ' + cursorPending.y.toFixed(1)
      : '';
  }

  /** @param {number|null} x_mm @param {number} [y_mm] */
  function setCursor(x_mm, y_mm) {
    cursorPending = (x_mm == null || !Number.isFinite(Number(x_mm)))
      ? null
      : { x: Number(x_mm), y: Number(y_mm) || 0 };
    if (cursorDirty) return;
    cursorDirty = true;
    if (typeof requestAnimationFrame === 'function') cursorRaf = requestAnimationFrame(flushCursor);
    else flushCursor();
  }

  // ------------------------------------------------------------------ seam ease / quality

  /** @param {string|null} text @param {boolean} [warn=false] */
  function setSeamEase(text, warn = false) {
    if (!elEase) return;
    elEase.textContent = text == null ? '' : String(text);
    elEase.dataset.warn = String(!!warn && text != null);
  }

  /** @param {string|null} text @param {'info'|'warn'|'error'} [level='info'] */
  function setQuality(text, level = 'info') {
    if (!elQuality) return;
    elQuality.textContent = text == null ? '' : String(text);
    elQuality.dataset.level = (level === 'warn' || level === 'error') ? level : 'info';
  }

  // ------------------------------------------------------------------ sim stats

  /** @type {number[]} */
  const arrivals = [];
  let lastSimWrite = 0;
  /** @type {any} */
  let simTimer = null;
  /** @type {string} */
  let simText = '';
  let paused = false;

  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  function writeSim() {
    if (simTimer) { clearTimeout(simTimer); simTimer = null; }
    lastSimWrite = now();
    if (elSim) elSim.textContent = simText + (paused && simText ? ' · paused' : (paused ? 'paused' : ''));
  }

  /** @param {SimStats|null} stats */
  function setSim(stats) {
    if (!stats) {
      arrivals.length = 0;
      simText = '';
      writeSim();
      return;
    }
    const t = now();
    arrivals.push(t);
    while (arrivals.length > FPS_WINDOW) arrivals.shift();
    let fps = 0;
    if (arrivals.length >= 2) {
      const span = arrivals[arrivals.length - 1] - arrivals[0];
      if (span > 0) fps = 1000 / (span / (arrivals.length - 1));
    }
    const msAvg = Number.isFinite(stats.msAvg) ? stats.msAvg : 0;
    simText = fps.toFixed(0) + ' fps · ' + msAvg.toFixed(1) + ' ms · ' + (stats.verts | 0) + ' v · f ' + (stats.frame | 0);
    const dt = t - lastSimWrite;
    if (dt >= SIM_WRITE_MS) writeSim();
    else if (!simTimer) simTimer = setTimeout(writeSim, SIM_WRITE_MS - dt);
  }

  // ------------------------------------------------------------------ convenience wrappers (A8 facade)

  /** @param {{meshes?:any[], issues?:any[]}|null} built */
  function setMesh(built) {
    if (!built) { setQuality(null); return; }
    const meshes = built.meshes || [];
    const issues = built.issues || [];
    let verts = 0; let tris = 0; let minAngle = Infinity;
    for (const m of meshes) {
      verts += m.vertexCount || 0;
      tris += (m.quality && m.quality.triangles) || (m.triangles ? m.triangles.length / 3 : 0);
      const a = m.quality && m.quality.minAngleDeg;
      if (Number.isFinite(a)) minAngle = Math.min(minAngle, a);
    }
    const hasError = issues.some((/** @type {any} */ i) => i && i.level === 'error');
    const hasWarn = issues.some((/** @type {any} */ i) => i && i.level === 'warn');
    const angle = Number.isFinite(minAngle) ? Math.round(minAngle) : 0;
    setQuality('min∠ ' + angle + '° · ' + verts + ' v · ' + Math.round(tris) + ' t', hasError ? 'error' : (hasWarn ? 'warn' : 'info'));
  }

  let lastIssueCount = -1;
  /** @param {any[]} issues */
  function setIssues(issues) {
    const list = Array.isArray(issues) ? issues : [];
    if (list.length === lastIssueCount) return;
    lastIssueCount = list.length;
    if (list.length === 0) return;
    const errors = list.filter((i) => i && i.level === 'error').length;
    setMessage(list.length + ' issue' + (list.length === 1 ? '' : 's'), errors ? 'error' : 'warn');
  }

  // ------------------------------------------------------------------ bus wiring

  offs.push(bus.on(EVENT.UI_STATUS, (p) => { if (p) setMessage(p.text, p.level, p.ttl_ms); }));
  offs.push(bus.on(EVENT.TOOL_CHANGED, (p) => {
    const hint = p && TOOL_HINTS && TOOL_HINTS[p.tool];
    setToolHint(hint || (p && p.tool) || '');
  }));
  offs.push(bus.on(EVENT.HOVER_CHANGED, (p) => {
    const mm = p && p.mm;
    setCursor(mm ? mm[0] : null, mm ? mm[1] : undefined);
  }));
  offs.push(bus.on(EVENT.SEAM_PREVIEW, (p) => {
    if (!p || !p.a || !p.b) { setSeamEase(null); return; }
    let text;
    try { text = formatEase({ lenA_mm: p.lenA_mm, lenB_mm: p.lenB_mm, easePct: p.easePct }); }
    catch { text = p.lenA_mm.toFixed(0) + ' / ' + p.lenB_mm.toFixed(0) + ' mm · ease ' + p.easePct.toFixed(1) + '%'; }
    setSeamEase(text, p.level !== 'ok');
  }));
  offs.push(bus.on(EVENT.MESH_BUILT, (p) => setMesh(p)));
  offs.push(bus.on(EVENT.SIM_STATS, (p) => setSim(p)));
  offs.push(bus.on(EVENT.SIM_PHASE, (p) => {
    paused = !!p && p.phase === 'paused';
    writeSim();
  }));
  offs.push(bus.on(EVENT.SIM_NAN, (p) => setMessage('Simulation instability at frame ' + (p && p.frame) + ' — restored from ' + (p && p.restored), 'warn')));
  offs.push(bus.on(EVENT.PATTERN_ISSUES, (p) => setIssues(p && p.issues)));
  offs.push(bus.on(EVENT.SIM_BUILT, (p) => setMessage('Cloth built in ' + Math.round((p && p.ms) || 0) + ' ms', 'info')));
  offs.push(bus.on(EVENT.BODY_BUILT, (p) => {
    if (p && p.quality === 'coarse') return;
    setMessage('Body built in ' + Math.round((p && p.ms) || 0) + ' ms', 'info');
  }));
  offs.push(bus.on(EVENT.SIZE_ACTIVE, (p) => setMessage('Active size: ' + (p && p.size), 'info')));
  // Only a clean boot says "Ready": after an error or a warning the app has already put that message up, and
  // replacing it with an info line (which then fades) hid every boot problem from the user.
  offs.push(bus.on(EVENT.APP_READY, (p) => {
    if (p && ((p.errors || 0) > 0 || (p.warnings || 0) > 0)) return;
    setMessage('Ready (' + (p && p.version) + ') in ' + Math.round((p && p.ms) || 0) + ' ms', 'info');
  }));
  offs.push(bus.on(EVENT.POPOUT_CLOSE, (p) => setMessage('Pop-out closed (' + ((p && p.reason) || 'user') + ')', p && p.reason === 'blocked' ? 'warn' : 'info')));

  return {
    setMessage,
    message: setMessage,
    setToolHint,
    setCursor,
    setSeamEase,
    setQuality,
    setMesh,
    setIssues,
    setSim,
    getLog,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (msgTimer) clearTimeout(msgTimer);
      if (simTimer) clearTimeout(simTimer);
      if (cursorRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(cursorRaf);
      for (const off of offs) { try { off(); } catch { /* ignore */ } }
      offs.length = 0;
    },
  };
}
