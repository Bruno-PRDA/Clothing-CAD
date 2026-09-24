// src/dxf/dxfio.js — reading and writing the DXF text format itself (group-code pairs), with no apparel meaning.
// Pure; no DOM. aama.js gives the entities their pattern meaning.
//
// The reader is deliberately forgiving: apparel CAD systems write anything from strict R12 (AC1009) to AutoCAD
// 2000+ files, with POLYLINE/VERTEX or LWPOLYLINE, text as TEXT, MTEXT or block ATTRIBs, CRLF or LF line ends,
// and sometimes a byte-order mark. Entities it does not use are skipped and counted, never fatal.

/**
 * @typedef {{x: number, y: number}} P
 * @typedef {Object} DxfEntity
 * @property {string} type        'LINE' | 'POINT' | 'POLYLINE' | 'TEXT' | 'CIRCLE' | 'ARC' | 'INSERT'
 * @property {string} layer
 * @property {[number, number]} [a]          LINE start
 * @property {[number, number]} [b]          LINE end
 * @property {[number, number]} [p]          POINT / TEXT / CIRCLE / ARC / INSERT position
 * @property {number[][]} [points]           POLYLINE / LWPOLYLINE vertices [x, y, bulge]
 * @property {boolean} [closed]
 * @property {string} [text]                 TEXT / MTEXT / ATTRIB value
 * @property {string} [tag]                  ATTRIB tag
 * @property {number} [angle]                degrees (POINT 50, TEXT 50, INSERT 50)
 * @property {number} [r]                    CIRCLE / ARC radius
 * @property {number} [a0]                   ARC start angle, degrees
 * @property {number} [a1]                   ARC end angle, degrees
 * @property {string} [name]                 INSERT block name
 * @property {number} [sx]                   INSERT scales
 * @property {number} [sy]
 */

/**
 * @typedef {Object} DxfDocument
 * @property {Record<string, any>} header             $VARIABLE -> first value (number when numeric)
 * @property {Map<string, {name: string, base: [number, number], entities: DxfEntity[]}>} blocks
 * @property {DxfEntity[]} entities                   model-space entities
 * @property {Record<string, number>} skipped         entity type -> count of entities not understood
 */

/** @param {string} text @returns {Array<[number, string]>} */
function pairs(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/);
  /** @type {Array<[number, string]>} */
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (!Number.isFinite(code)) {
      // A stray blank line (some writers end the file with one) would shift every later pair; resynchronise
      // by skipping one line.
      i -= 1;
      continue;
    }
    out.push([code, lines[i + 1].replace(/\s+$/, '')]);
  }
  return out;
}

const num = (s) => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0; };

/** MTEXT formatting codes out: \P paragraph, \~ space, {\f...;x} fonts, \S stacks. @param {string} s */
function plainMtext(s) {
  return s
    .replace(/\\P/g, '\n').replace(/\\~/g, ' ')
    .replace(/\\[A-Za-z][^;\\{}]*;/g, '')
    .replace(/\\S([^;]*);/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\\\\/g, '\\');
}

/**
 * Parse DXF text.
 * @param {string} text @returns {DxfDocument}
 */
export function parseDxf(text) {
  const g = pairs(text);
  /** @type {DxfDocument} */
  const doc = { header: {}, blocks: new Map(), entities: [], skipped: {} };
  let i = 0;
  const at = () => g[i];

  /** Read one entity starting at g[i] (code 0, type), leaving i on the next code-0 pair. */
  function readEntity() {
    const type = at()[1].toUpperCase();
    i++;
    /** @type {any} */
    const e = { type, layer: '0' };
    /** @type {number[][]} */
    const lw = [];
    let lwCur = null;
    let mtext = '';
    while (i < g.length && g[i][0] !== 0) {
      const [c, v] = g[i];
      switch (c) {
        case 8: e.layer = v.trim(); break;
        case 1: if (type === 'MTEXT') mtext += v; else e.text = v; break;
        case 3: if (type === 'MTEXT') mtext += v; break;
        case 2: if (type === 'INSERT') e.name = v; else if (type === 'ATTRIB') e.tag = v; break;
        case 10: if (type === 'LWPOLYLINE') { lwCur = [num(v), 0, 0]; lw.push(lwCur); } else (e._p = e._p || [0, 0])[0] = num(v); break;
        case 20: if (type === 'LWPOLYLINE') { if (lwCur) lwCur[1] = num(v); } else (e._p = e._p || [0, 0])[1] = num(v); break;
        case 11: (e._q = e._q || [0, 0])[0] = num(v); break;
        case 21: (e._q = e._q || [0, 0])[1] = num(v); break;
        case 42: if (type === 'LWPOLYLINE') { if (lwCur) lwCur[2] = num(v); } else if (type === 'VERTEX') e.bulge = num(v); else if (type === 'INSERT') e.sy = num(v); break;
        case 41: if (type === 'INSERT') e.sx = num(v); break;
        case 40: e.r = num(v); e.height = num(v); break;
        case 50: e.angle = num(v); e.a0 = num(v); break;
        case 51: e.a1 = num(v); break;
        case 70: e.flags = parseInt(v, 10) || 0; break;
        default: break;
      }
      i++;
    }
    if (type === 'LWPOLYLINE') { e.type = 'POLYLINE'; e.points = lw; e.closed = ((e.flags || 0) & 1) === 1; }
    if (type === 'MTEXT') { e.type = 'TEXT'; e.text = plainMtext(mtext); }
    if (type === 'ATTRIB' || type === 'ATTDEF') e.type = 'TEXT';
    if (type === 'LINE') { e.a = e._p || [0, 0]; e.b = e._q || [0, 0]; }
    else e.p = e._p || [0, 0];
    delete e._p; delete e._q;
    return e;
  }

  /**
   * Read entities until a code-0 pair whose value is in `stop`, merging POLYLINE/VERTEX/SEQEND into one entity.
   * @param {string[]} stop @returns {DxfEntity[]}
   */
  function readEntities(stop) {
    /** @type {DxfEntity[]} */
    const list = [];
    while (i < g.length) {
      const [c, v] = at();
      if (c !== 0) { i++; continue; }
      const t = v.toUpperCase();
      if (stop.includes(t)) break;
      const e = readEntity();
      if (e.type === 'POLYLINE' && t === 'POLYLINE') {
        const pts = [];
        while (i < g.length && at()[0] === 0 && at()[1].toUpperCase() === 'VERTEX') {
          const vx = readEntity();
          pts.push([vx.p[0], vx.p[1], vx.bulge || 0]);
        }
        if (i < g.length && at()[0] === 0 && at()[1].toUpperCase() === 'SEQEND') readEntity();
        e.points = pts;
        e.closed = ((e.flags || 0) & 1) === 1;
        list.push(e);
      } else if (['LINE', 'POINT', 'POLYLINE', 'TEXT', 'CIRCLE', 'ARC', 'INSERT'].includes(e.type)) {
        list.push(e);
      } else if (e.type !== 'SEQEND' && e.type !== 'VERTEX') {
        doc.skipped[e.type] = (doc.skipped[e.type] || 0) + 1;
      }
    }
    return list;
  }

  while (i < g.length) {
    const [c, v] = at();
    if (c === 0 && v.toUpperCase() === 'SECTION') {
      i++;
      const name = i < g.length && g[i][0] === 2 ? g[i][1].toUpperCase() : '';
      i++;
      if (name === 'HEADER') {
        while (i < g.length && !(g[i][0] === 0 && g[i][1].toUpperCase() === 'ENDSEC')) {
          if (g[i][0] === 9) {
            const key = g[i][1];
            i++;
            if (i < g.length && g[i][0] !== 9 && g[i][0] !== 0) {
              const raw = g[i][1];
              doc.header[key] = /^-?\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : raw;
            }
          } else i++;
        }
      } else if (name === 'BLOCKS') {
        while (i < g.length && !(g[i][0] === 0 && g[i][1].toUpperCase() === 'ENDSEC')) {
          if (g[i][0] === 0 && g[i][1].toUpperCase() === 'BLOCK') {
            const head = readEntity();
            // BLOCK's own name is group 2, which readEntity only keeps for INSERT; re-read it.
            let j = i - 1;
            let bname = '';
            while (j >= 0 && !(g[j][0] === 0 && g[j][1].toUpperCase() === 'BLOCK')) { if (g[j][0] === 2) bname = g[j][1]; j--; }
            const ents = readEntities(['ENDBLK', 'ENDSEC']);
            if (i < g.length && g[i][1].toUpperCase() === 'ENDBLK') readEntity();
            if (!bname.startsWith('*')) doc.blocks.set(bname, { name: bname, base: head.p || [0, 0], entities: ents });
          } else i++;
        }
      } else if (name === 'ENTITIES') {
        doc.entities = readEntities(['ENDSEC']);
      } else {
        while (i < g.length && !(g[i][0] === 0 && g[i][1].toUpperCase() === 'ENDSEC')) i++;
      }
      continue;
    }
    i++;
  }
  return doc;
}

/**
 * Entities of a block as placed by an INSERT: base point subtracted, scaled, rotated, translated.
 * @param {{base: [number, number], entities: DxfEntity[]}} block @param {DxfEntity} ins @returns {DxfEntity[]}
 */
export function placeBlock(block, ins) {
  const sx = Number.isFinite(ins.sx) && ins.sx !== 0 ? ins.sx : 1;
  const sy = Number.isFinite(ins.sy) && ins.sy !== 0 ? ins.sy : 1;
  const rot = ((ins.angle || 0) * Math.PI) / 180;
  const c = Math.cos(rot), s = Math.sin(rot);
  const [bx, by] = block.base;
  const [tx, ty] = ins.p || [0, 0];
  const T = (/** @type {number[]} */ q) => {
    const x = (q[0] - bx) * sx, y = (q[1] - by) * sy;
    return [tx + x * c - y * s, ty + x * s + y * c];
  };
  const mirrored = sx * sy < 0;
  return block.entities.map((e) => {
    /** @type {any} */
    const o = { ...e };
    if (e.a) o.a = T(e.a);
    if (e.b) o.b = T(e.b);
    if (e.p) o.p = T(e.p);
    if (e.points) o.points = e.points.map((q) => { const t = T(q); return [t[0], t[1], mirrored ? -(q[2] || 0) : (q[2] || 0)]; });
    if (Number.isFinite(e.angle)) o.angle = e.angle + (ins.angle || 0);
    if (Number.isFinite(e.r)) o.r = e.r * Math.abs(sx);
    return o;
  });
}

/**
 * A polyline with bulges (arc segments) as plain points: each bulged segment becomes an arc sampled at `stepDeg`.
 * @param {number[][]} pts [x, y, bulge] @param {boolean} closed @param {number} [stepDeg] @returns {Array<[number, number]>}
 */
export function unbulge(pts, closed, stepDeg = 10) {
  /** @type {Array<[number, number]>} */
  const out = [];
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let k = 0; k < n; k++) out.push([pts[k][0], pts[k][1]]);
  if (!pts.some((q) => q[2])) return out;
  /** @type {Array<[number, number]>} */
  const res = [];
  for (let k = 0; k < segs; k++) {
    const a = pts[k], b = pts[(k + 1) % n];
    res.push([a[0], a[1]]);
    const bulge = a[2] || 0;
    if (!bulge) continue;
    const theta = 4 * Math.atan(bulge);                 // included angle, signed
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-9) continue;
    const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const h = r * Math.cos(Math.abs(theta) / 2);         // centre offset from the chord midpoint
    const sgn = theta > 0 ? 1 : -1;
    const cx = mx - sgn * h * (dy / chord), cy = my + sgn * h * (dx / chord);
    const a0 = Math.atan2(a[1] - cy, a[0] - cx);
    const steps = Math.max(2, Math.ceil(Math.abs(theta) * 180 / Math.PI / stepDeg));
    for (let s = 1; s < steps; s++) {
      const t = a0 + theta * (s / steps);
      res.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
  }
  if (!closed) res.push([pts[n - 1][0], pts[n - 1][1]]);
  return res;
}

// ------------------------------------------------------------------------------------------ writer

/** A number as DXF writes it: fixed decimals, no exponent, no "-0". @param {number} v @param {number} [d] */
export function fnum(v, d = 4) {
  const s = (Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v).toFixed(d);
  return s.indexOf('.') >= 0 ? (s.replace(/\.?0+$/, '') || '0') : s;
}

/**
 * Accumulates group-code pairs. Every line ends in CRLF: some Windows CAD readers accept nothing else, and
 * every other reader accepts it.
 */
export function createWriter() {
  /** @type {string[]} */
  const out = [];
  const w = {
    /** @param {number} code @param {string|number} value */
    pair(code, value) { out.push(String(code).padStart(3, ' '), String(value)); return w; },
    /** @param {string} type @param {string} layer */
    entity(type, layer) { return w.pair(0, type).pair(8, layer); },
    /** @param {number} x @param {number} y @param {number} [base] 10 for the first point, 11 for the second */
    point(x, y, base = 10) { return w.pair(base, fnum(x)).pair(base + 10, fnum(y)).pair(base + 20, '0'); },
    text() { return out.join('\r\n') + '\r\n'; },
  };
  return w;
}
