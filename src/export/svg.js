// src/export/svg.js — 1:1 SVG sewing patterns (SPEC section 10.3). Pure. One SVG user unit = 1 mm; sheet space is
// y DOWN and the ONLY y flip of the export pipeline is `toSheet` (step 5). Pattern points are never negated elsewhere.

import { edgeLength, sampleEdge, offsetPolygon, packRects, signedArea, bbox } from '../geometry/index.js';
import { validationError } from '../sizing/index.js';

/** @typedef {import('../core/types.js').Piece} Piece */
/** @typedef {import('../core/types.js').Vec2} Vec2 */

/**
 * @typedef {Object} PieceGeometry   everything about one (graded) piece in pattern mm, y up
 * @property {Piece}    piece
 * @property {string}   sizeName
 * @property {Vec2[]}   stitch        closed CCW polyline (each corner once), chord spacing <= spacing_mm
 * @property {number[]} stitchEdgeOf  outline edge index of segment stitch[k] -> stitch[k+1]
 * @property {number[]} allowances    per outline edge, mm (fold edge forced 0)
 * @property {Vec2[]}   cut           closed polygon from offsetPolygon(stitch, per-segment allowance)
 * @property {{p:Vec2, q:Vec2, kind:'single'|'double', p2?:Vec2, q2?:Vec2}[]} notches   ticks stitch -> cut
 * @property {{minX:number, minY:number, maxX:number, maxY:number}} bbox   of `cut`
 * @property {Vec2}     labelAnchor   interior point for the label block
 * @property {number}   area_mm2      |signedArea(stitch)|
 * @property {string[]} labelLines
 */
/**
 * @typedef {Object} SheetLayout
 * @property {number} width_mm
 * @property {number} height_mm
 * @property {string} sizeName
 * @property {string} title
 * @property {{geom:PieceGeometry, x:number, y:number, w:number, h:number}[]} placed
 * @property {number} contentTop_mm   120 with calibration, 10 without
 * @property {boolean} calibration
 * @property {string} garmentName
 * @property {string} date
 * @property {number} margin_mm
 */
/** @typedef {{svg:string, inner:string, layout:SheetLayout}} SheetResult */

/** @type {ReadonlyArray<string>} */
export const SIZE_COLORS = Object.freeze(['#1f77b4', '#d62728', '#2ca02c', '#ff7f0e', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f']);

const FONT = 'Arial, Helvetica, sans-serif';
const HEADER_MIN_W = 10 + 100 + 10 + 150;
const CALIB_CLASS = 'sheet-calibration'; // the group; print.js strips it (each tile carries its own square)

/** 3 decimals, trailing zeros stripped, -0 → 0; non-finite → 0 (never 'NaN' in the output). @param {number} n @returns {string} */
export function fmt(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  if (r === 0) return '0';
  return String(r);
}

/** XML-escapes & < > ". @param {string} s @returns {string} */
export function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** @returns {string} today as 'YYYY-MM-DD' */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** @param {Vec2} p @returns {string} */
function pt(p) {
  return fmt(p[0]) + ' ' + fmt(p[1]);
}

/** @param {Vec2[]} pts @param {boolean} close @returns {string} */
function polyPath(pts, close) {
  if (pts.length === 0) return '';
  let d = 'M ' + pt(pts[0]);
  for (let i = 1; i < pts.length; i++) d += ' L ' + pt(pts[i]);
  return close ? d + ' Z' : d;
}

/**
 * Point + unit tangent at arc-length fraction t of an edge: linear interpolation of sampleEdge(piece, edge, 64).
 * @param {Piece} piece @param {number} edge @param {number} t @returns {{p: Vec2, d: Vec2}}
 */
function edgePointAt(piece, edge, t) {
  const pts = sampleEdge(piece, edge, 64);
  const cum = new Array(pts.length);
  cum[0] = 0;
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  const L = cum[pts.length - 1];
  const target = Math.max(0, Math.min(1, t)) * L;
  let k = 0;
  while (k < pts.length - 2 && cum[k + 1] < target) k++;
  const a = pts[k];
  const b = pts[k + 1];
  const segLen = cum[k + 1] - cum[k];
  const u = segLen > 0 ? (target - cum[k]) / segLen : 0;
  /** @type {Vec2} */
  const p = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len > 0) { dx /= len; dy /= len; } else { dx = 1; dy = 0; }
  return { p, d: [dx, dy] };
}

/**
 * Allowance summary line: `SA 10 mm` or `SA 10 mm; hem 25; neck 6`.
 * @param {Piece} piece @param {number[]} allowances @returns {string}
 */
function allowanceSummary(piece, allowances) {
  /** @type {Map<number, number[]>} value -> edge indices */
  const groups = new Map();
  for (let i = 0; i < allowances.length; i++) {
    if (i === piece.foldEdge) continue;
    const v = allowances[i];
    if (!groups.has(v)) groups.set(v, []);
    /** @type {number[]} */ (groups.get(v)).push(i);
  }
  if (groups.size === 0) return 'SA 0 mm';
  let mode = NaN;
  let modeCount = -1;
  for (const [v, edges] of groups) {
    if (edges.length > modeCount || (edges.length === modeCount && v > mode)) { mode = v; modeCount = edges.length; }
  }
  let s = `SA ${fmt(mode)} mm`;
  if (groups.size === 1) return s;
  const others = [...groups.keys()].filter((v) => v !== mode).sort((a, b) => b - a);
  const parts = others.map((v) => {
    const labels = /** @type {number[]} */ (groups.get(v)).map((i) => {
      const lab = piece.edges[i] && piece.edges[i].label;
      return lab ? lab : `e${i}`;
    });
    return `${labels.join('/')} ${fmt(v)}`;
  });
  return s + '; ' + parts.join('; ');
}

/**
 * Interior label anchor: midline crossings of the stitch polygon, widest inside span, else bbox centre.
 * @param {Vec2[]} stitch @param {{minX:number, minY:number, maxX:number, maxY:number}} bb @returns {Vec2}
 */
function labelAnchorOf(stitch, bb) {
  const ym = (bb.minY + bb.maxY) / 2;
  /** @type {number[]} */
  const xs = [];
  const n = stitch.length;
  for (let k = 0; k < n; k++) {
    const a = stitch[k];
    const b = stitch[(k + 1) % n];
    if ((a[1] <= ym) !== (b[1] <= ym)) {
      xs.push(a[0] + (ym - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
  }
  xs.sort((p, q) => p - q);
  if (xs.length < 2) return [(bb.minX + bb.maxX) / 2, ym];
  let best = -1;
  let bestW = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const w = xs[i + 1] - xs[i];
    if (w > bestW) { bestW = w; best = i; }
  }
  return [(xs[best] + xs[best + 1]) / 2, ym];
}

/**
 * opts: { spacing_mm = 2, join = 'round', garmentName = '', fabricName = '', fabricNames = {}, date = today }.
 * @param {Piece} piece @param {string} sizeName @param {object} [opts] @returns {PieceGeometry}
 */
export function buildPieceGeometry(piece, sizeName, opts) {
  const o = opts || {};
  const spacing = Number.isFinite(o.spacing_mm) && o.spacing_mm > 0 ? o.spacing_mm : 2;
  const join = o.join === 'mitre' ? 'mitre' : 'round';
  const n = piece.vertices.length;
  if (!Array.isArray(piece.edges) || piece.edges.length !== n || n < 3) {
    throw validationError('EXPORT_BAD_OUTLINE', `Piece ${piece.name}: outline is not CCW/simple`);
  }

  // 1. allowances
  /** @type {number[]} */
  const allowances = new Array(n);
  for (let i = 0; i < n; i++) {
    const e = piece.edges[i];
    let a = (e && typeof e.allowance_mm === 'number') ? e.allowance_mm : piece.seamAllowance_mm;
    if (typeof a !== 'number' || !Number.isFinite(a) || a < 0) a = 0;
    allowances[i] = a;
  }
  if (piece.foldEdge !== null && piece.foldEdge !== undefined && piece.foldEdge >= 0 && piece.foldEdge < n) {
    allowances[piece.foldEdge] = 0;
  }

  // 2. stitch polyline
  /** @type {Vec2[]} */
  const stitch = [];
  /** @type {number[]} */
  const stitchEdgeOf = [];
  for (let i = 0; i < n; i++) {
    const ni = Math.max(1, Math.ceil(edgeLength(piece, i) / spacing));
    const pts = sampleEdge(piece, i, ni);
    for (let k = 0; k < ni; k++) {
      stitch.push([pts[k][0], pts[k][1]]);
      stitchEdgeOf.push(i);
    }
  }
  const area = signedArea(stitch);
  if (!(area > 0)) throw validationError('EXPORT_BAD_OUTLINE', `Piece ${piece.name}: outline is not CCW/simple`);

  // 3. cut polygon
  const hasFold = piece.foldEdge !== null && piece.foldEdge !== undefined && !!piece.edges[piece.foldEdge];
  const cut = offsetPolygon(stitch, stitch.map((_, k) => allowances[stitchEdgeOf[k]]),
    hasFold ? { join, foldX: piece.vertices[piece.foldEdge][0] } : { join });

  // 4. notches
  /** @type {PieceGeometry['notches']} */
  const notches = [];
  for (const nt of piece.notches || []) {
    if (!Number.isInteger(nt.edge) || nt.edge < 0 || nt.edge >= n) continue;
    const { p, d } = edgePointAt(piece, nt.edge, nt.t);
    /** @type {Vec2} */
    const nrm = [d[1], -d[0]];
    const a = allowances[nt.edge];
    /** @type {Vec2} */
    const q = a > 0 ? [p[0] + nrm[0] * a, p[1] + nrm[1] * a] : [p[0] - nrm[0] * 5, p[1] - nrm[1] * 5];
    if (nt.kind === 'double') {
      notches.push({
        kind: 'double',
        p: [p[0] - d[0] * 2, p[1] - d[1] * 2], q: [q[0] - d[0] * 2, q[1] - d[1] * 2],
        p2: [p[0] + d[0] * 2, p[1] + d[1] * 2], q2: [q[0] + d[0] * 2, q[1] + d[1] * 2],
      });
    } else {
      notches.push({ kind: 'single', p, q });
    }
  }

  // 6. bbox / area
  const bb = bbox(cut);

  // 7. label block
  const fabricNames = o.fabricNames && typeof o.fabricNames === 'object' ? o.fabricNames : {};
  const fabricName = o.fabricName || fabricNames[piece.fabricId] || piece.fabricId;
  /** @type {string[]} */
  const labelLines = [piece.name];
  if (o.garmentName) labelLines.push(String(o.garmentName));
  labelLines.push(`SIZE ${sizeName}`);
  labelLines.push(`CUT ${piece.cutQty}` + (piece.foldEdge !== null && piece.foldEdge !== undefined ? ' ON FOLD' : ''));
  labelLines.push(String(fabricName));
  labelLines.push(allowanceSummary(piece, allowances));
  labelLines.push(o.date !== undefined && o.date !== null ? String(o.date) : today());

  return {
    piece, sizeName, stitch, stitchEdgeOf, allowances, cut, notches,
    bbox: bb, labelAnchor: labelAnchorOf(stitch, bb), area_mm2: Math.abs(area), labelLines,
  };
}

/** @param {object} [opts] @returns {{sheetWidth_mm: number|null, gap_mm: number, margin_mm: number, calibration: boolean, garmentName: string, fabricNames: object, date: string, spacing_mm: number, join: string}} */
function sheetOpts(opts) {
  const o = opts || {};
  return {
    sheetWidth_mm: o.sheetWidth_mm === null ? null : (Number.isFinite(o.sheetWidth_mm) ? o.sheetWidth_mm : 1000),
    gap_mm: Number.isFinite(o.gap_mm) ? o.gap_mm : 20,
    margin_mm: Number.isFinite(o.margin_mm) ? o.margin_mm : 10,
    calibration: o.calibration !== false,
    garmentName: o.garmentName ? String(o.garmentName) : '',
    fabricNames: o.fabricNames || {},
    date: o.date !== undefined && o.date !== null ? String(o.date) : today(),
    spacing_mm: o.spacing_mm,
    join: o.join,
  };
}

/** @param {PieceGeometry[]} geoms @param {object} [opts] @returns {SheetLayout} */
export function layoutSheet(geoms, opts) {
  const o = sheetOpts(opts);
  const margin = o.margin_mm;
  const contentTop = o.calibration ? 120 : 10;
  const sizeName = (opts && opts.sizeName) || (geoms[0] ? geoms[0].sizeName : '');
  const items = geoms.map((g) => ({
    id: g.piece.id + '@' + g.sizeName,
    w: g.bbox.maxX - g.bbox.minX,
    h: g.bbox.maxY - g.bbox.minY,
  }));
  const packWidth = o.sheetWidth_mm === null
    ? items.reduce((m, it) => Math.max(m, it.w), 0)
    : o.sheetWidth_mm - 2 * margin;
  const pack = items.length > 0
    ? packRects(items, packWidth, { gap: o.gap_mm, allowRotate: false })
    : { placements: [], width: 0, height: 0 };
  const placed = geoms.map((g, k) => ({
    geom: g,
    x: margin + pack.placements[k].x,
    y: contentTop + pack.placements[k].y,
    w: items[k].w,
    h: items[k].h,
  }));
  const width_mm = Math.max(o.sheetWidth_mm === null ? 0 : o.sheetWidth_mm, pack.width + 2 * margin, HEADER_MIN_W);
  const height_mm = contentTop + pack.height + margin;
  return {
    width_mm, height_mm, sizeName,
    title: `${o.garmentName || 'Pattern'} — size ${sizeName}`,
    placed, contentTop_mm: contentTop,
    calibration: o.calibration, garmentName: o.garmentName, date: o.date, margin_mm: margin,
  };
}

/**
 * The single y flip of the pipeline (affine, so control points map with it too).
 * @param {Vec2} P @param {{x:number, y:number}} place @param {PieceGeometry} geom @returns {Vec2}
 */
function toSheet(P, place, geom) {
  return [place.x + (P[0] - geom.bbox.minX), place.y + (geom.bbox.maxY - P[1])];
}

/** @param {number} deg @returns {number} normalised to (-90, 90] */
function uprightAngle(deg) {
  let a = deg;
  while (a > 90) a -= 180;
  while (a <= -90) a += 180;
  return a;
}

/**
 * Open arrowhead at `tip` for a line arriving along unit direction `d`: two 5 mm strokes at ±30° back from the tip.
 * @param {Vec2} tip @param {Vec2} d @returns {string} path data
 */
function arrowHead(tip, d) {
  const c = Math.cos(Math.PI / 6);
  const s = Math.sin(Math.PI / 6);
  const bx = -d[0];
  const by = -d[1];
  /** @type {Vec2} */
  const l = [tip[0] + 5 * (bx * c - by * s), tip[1] + 5 * (bx * s + by * c)];
  /** @type {Vec2} */
  const r = [tip[0] + 5 * (bx * c + by * s), tip[1] + 5 * (-bx * s + by * c)];
  return `M ${pt(l)} L ${pt(tip)} L ${pt(r)}`;
}

/**
 * Markup of one placed piece (SPEC 10.3 renderSheet step 3).
 * @param {{geom:PieceGeometry, x:number, y:number}} place @param {string} sizeName @returns {string}
 */
function pieceMarkup(place, sizeName) {
  const g = place.geom;
  const piece = g.piece;
  /** @param {Vec2} P @returns {Vec2} */
  const S = (P) => toSheet(P, place, g);
  const n = piece.vertices.length;
  const parts = [];
  parts.push(`<g class="piece" data-piece-id="${escapeXml(piece.id)}" data-size="${escapeXml(sizeName)}" transform="translate(0 0)" fill="none" stroke="#000" stroke-width="0.35" stroke-linejoin="round" stroke-linecap="round">`);
  // cut
  parts.push(`<path class="cut" stroke-width="0.35" d="${polyPath(g.cut.map(S), true)}"/>`);
  // stitch: exact outline
  let d = 'M ' + pt(S(piece.vertices[0]));
  for (let i = 0; i < n; i++) {
    const e = piece.edges[i];
    const v = piece.vertices[(i + 1) % n];
    if (e.type === 'cubic' && e.c1 && e.c2) d += ` C ${pt(S(e.c1))} ${pt(S(e.c2))} ${pt(S(v))}`;
    else d += ' L ' + pt(S(v));
  }
  d += ' Z';
  parts.push(`<path class="stitch" stroke-width="0.25" stroke-dasharray="4 2" d="${d}"/>`);
  // fold
  if (piece.foldEdge !== null && piece.foldEdge !== undefined && piece.foldEdge >= 0 && piece.foldEdge < n) {
    const a = piece.vertices[piece.foldEdge];
    const b = piece.vertices[(piece.foldEdge + 1) % n];
    const sa = S(a);
    const sb = S(b);
    parts.push(`<path class="fold" stroke-width="0.35" stroke-dasharray="6 2 1 2" d="M ${pt(sa)} L ${pt(sb)}"/>`);
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    // outward normal [dy, -dx]; shift 4 mm inward (opposite) in pattern space
    /** @type {Vec2} */
    const mid = [(a[0] + b[0]) / 2 - dy * 4, (a[1] + b[1]) / 2 + dx * 4];
    const sm = S(mid);
    const angle = uprightAngle(Math.atan2(sb[1] - sa[1], sb[0] - sa[0]) * 180 / Math.PI);
    parts.push(`<text class="fold-label" font-family="${FONT}" font-size="4" text-anchor="middle" fill="#000" stroke="none" transform="translate(${fmt(sm[0])} ${fmt(sm[1])}) rotate(${fmt(angle)})">PLACE ON FOLD</text>`);
  }
  // notches
  parts.push('<g class="notches" stroke-width="0.35">');
  for (const nt of g.notches) {
    parts.push(`<path d="M ${pt(S(nt.p))} L ${pt(S(nt.q))}"/>`);
    if (nt.kind === 'double' && nt.p2 && nt.q2) parts.push(`<path d="M ${pt(S(nt.p2))} L ${pt(S(nt.q2))}"/>`);
  }
  parts.push('</g>');
  // grainline
  if (piece.grainline && piece.grainline.a && piece.grainline.b) {
    const ga = S(piece.grainline.a);
    const gb = S(piece.grainline.b);
    let dx = gb[0] - ga[0];
    let dy = gb[1] - ga[1];
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      dx /= len; dy /= len;
      parts.push(`<path class="grainline" stroke-width="0.35" d="M ${pt(ga)} L ${pt(gb)} ${arrowHead(gb, [dx, dy])} ${arrowHead(ga, [-dx, -dy])}"/>`);
    }
  }
  // internal lines
  parts.push('<g class="internal">');
  for (const line of piece.internalLines || []) {
    if (!Array.isArray(line.points) || line.points.length < 2) continue;
    const kind = line.kind === 'fold' || line.kind === 'dart' ? line.kind : 'mark';
    const attrs = kind === 'fold' ? 'stroke-width="0.35" stroke-dasharray="6 2 1 2"'
      : kind === 'dart' ? 'stroke-width="0.25"' : 'stroke-width="0.25" stroke-dasharray="2 1"';
    parts.push(`<path class="internal-${kind}" ${attrs} d="${polyPath(line.points.map(S), false)}"/>`);
  }
  parts.push('</g>');
  // label block
  const anchor = S(g.labelAnchor);
  const lines = g.labelLines;
  const pitch = 5;
  const y0 = anchor[1] - ((lines.length - 1) * pitch) / 2 + 1.5;
  parts.push(`<g class="label" font-family="${FONT}" fill="#000" stroke="none" text-anchor="middle">`);
  for (let i = 0; i < lines.length; i++) {
    const bold = i === 0 ? ' font-size="6" font-weight="bold"' : ' font-size="4"';
    parts.push(`<text x="${fmt(anchor[0])}" y="${fmt(y0 + i * pitch)}"${bold}>${escapeXml(lines[i])}</text>`);
  }
  parts.push('</g>');
  parts.push('</g>');
  return parts.join('\n');
}

/** @param {boolean} enabled @returns {string} */
function calibrationMarkup(enabled) {
  if (!enabled) return '';
  return `<g class="${CALIB_CLASS}" fill="none" stroke="#000" stroke-width="0.35">\n<rect class="calibration" x="10" y="10" width="100" height="100"/>\n<text x="60" y="65" text-anchor="middle" font-family="${FONT}" font-size="6" fill="#000" stroke="none">100 mm</text>\n</g>`;
}

/**
 * @param {string[]} lines first line font 8, the rest font 4 at 6 mm pitch
 * @param {number} x @param {number} y @returns {string}
 */
function titleMarkup(lines, x, y) {
  const parts = [`<g class="title" font-family="${FONT}" fill="#000" stroke="none">`];
  let yy = y;
  for (let i = 0; i < lines.length; i++) {
    parts.push(`<text x="${fmt(x)}" y="${fmt(yy)}" font-size="${i === 0 ? 8 : 4}">${escapeXml(lines[i])}</text>`);
    yy += i === 0 ? 8 : 6;
  }
  parts.push('</g>');
  return parts.join('\n');
}

/** @param {number} W @param {number} H @param {string} sizeName @param {string} title @param {string} inner @returns {string} */
function rootSvg(W, H, sizeName, title, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W)}mm" height="${fmt(H)}mm" viewBox="0 0 ${fmt(W)} ${fmt(H)}" data-units="mm" data-size="${escapeXml(sizeName)}">\n<title>${escapeXml(title)}</title>\n${inner}\n</svg>`;
}

/** @param {SheetLayout} layout @param {object} [opts] @returns {SheetResult} */
export function renderSheet(layout, opts) {
  const o = opts || {};
  const calibration = o.calibration !== undefined ? o.calibration !== false : layout.calibration !== false;
  const garmentName = o.garmentName !== undefined ? String(o.garmentName) : (layout.garmentName || '');
  const date = o.date !== undefined && o.date !== null ? String(o.date) : (layout.date || today());
  const W = layout.width_mm;
  const H = layout.height_mm;
  const parts = [];
  parts.push(calibrationMarkup(calibration));
  parts.push(titleMarkup([
    garmentName || 'Pattern',
    `Size ${layout.sizeName} — ${layout.placed.length} pieces — sheet ${fmt(W)} × ${fmt(H)} mm`,
    'Print at 100% (scale 1:1, no fit-to-page); check the 100 mm square',
    date,
  ], 120, 20));
  for (const place of layout.placed) parts.push(pieceMarkup(place, layout.sizeName));
  const inner = parts.filter((s) => s !== '').join('\n');
  return { svg: rootSvg(W, H, layout.sizeName, layout.title, inner), inner, layout };
}

/** exportHidden pieces skipped; empty list throws EXPORT_NO_PIECES. @param {Piece[]} pieces @param {string} sizeName @param {object} [opts] @returns {SheetResult} */
export function exportSheet(pieces, sizeName, opts) {
  const o = sheetOpts(opts);
  const visible = (pieces || []).filter((p) => p && p.exportHidden !== true);
  if (visible.length === 0) throw validationError('EXPORT_NO_PIECES', 'No pieces to export');
  const geoms = visible.map((p) => buildPieceGeometry(p, sizeName, {
    spacing_mm: o.spacing_mm, join: o.join, garmentName: o.garmentName, fabricNames: o.fabricNames, date: o.date,
  }));
  const layout = layoutSheet(geoms, { ...(opts || {}), sizeName });
  return renderSheet(layout);
}

/** exportSheet(...).svg. @param {Piece[]} pieces @param {string} sizeName @param {object} [opts] @returns {string} */
export function exportSheetSvg(pieces, sizeName, opts) {
  return exportSheet(pieces, sizeName, opts).svg;
}

/** One piece; opts.sizeName default 'M'; sheetWidth_mm = null (fit). @param {Piece} piece @param {object} [opts] @returns {string} */
export function exportPieceSvg(piece, opts) {
  const o = opts || {};
  const sizeName = o.sizeName || 'M';
  if (!piece) throw validationError('EXPORT_NO_PIECES', 'No piece to export');
  const so = sheetOpts(o);
  const geom = buildPieceGeometry(piece, sizeName, {
    spacing_mm: so.spacing_mm, join: so.join, garmentName: so.garmentName, fabricNames: so.fabricNames, date: so.date,
  });
  const layout = layoutSheet([geom], { ...o, sizeName, sheetWidth_mm: o.sheetWidth_mm === undefined ? null : o.sheetWidth_mm });
  return renderSheet(layout).svg;
}

/**
 * All sizes of one piece in one SVG, one colour per size, same pattern frame.
 * @param {{sizeName: string, piece: Piece}[]} pieceBySize @param {string} baseSize @param {object} [opts] @returns {string}
 */
export function exportGradeNestSvg(pieceBySize, baseSize, opts) {
  const o = sheetOpts(opts);
  if (!Array.isArray(pieceBySize) || pieceBySize.length === 0) throw validationError('EXPORT_NO_PIECES', 'No pieces to export');
  const geoms = pieceBySize.map((e) => buildPieceGeometry(e.piece, e.sizeName, {
    spacing_mm: o.spacing_mm, join: o.join, garmentName: o.garmentName, fabricNames: o.fabricNames, date: o.date,
  }));
  const ub = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const g of geoms) {
    ub.minX = Math.min(ub.minX, g.bbox.minX);
    ub.minY = Math.min(ub.minY, g.bbox.minY);
    ub.maxX = Math.max(ub.maxX, g.bbox.maxX);
    ub.maxY = Math.max(ub.maxY, g.bbox.maxY);
  }
  const margin = o.margin_mm;
  const contentTop = o.calibration ? 120 : 10;
  const place = { x: margin, y: contentTop };
  const frame = { bbox: ub };
  /** @param {Vec2} P @returns {Vec2} */
  const S = (P) => toSheet(P, place, /** @type {PieceGeometry} */ (frame));
  const legendH = 6 * pieceBySize.length;
  const W = Math.max(ub.maxX - ub.minX + 2 * margin, HEADER_MIN_W);
  const H = Math.max(contentTop, 20 + 8 + 6 * 2 + legendH + 10) + (ub.maxY - ub.minY) + margin;
  const pieceName = pieceBySize[0].piece.name;
  const title = `${o.garmentName ? o.garmentName + ' — ' : ''}${pieceName} — grade nest`;
  const parts = [];
  parts.push(calibrationMarkup(o.calibration));
  parts.push(titleMarkup([title, `Base size ${baseSize} — ${pieceBySize.length} sizes`, o.date], 120, 20));
  parts.push(`<g class="legend" font-family="${FONT}" font-size="4" fill="#000" stroke="none">`);
  pieceBySize.forEach((e, i) => {
    const y = 20 + 8 + 12 + i * 6;
    const color = SIZE_COLORS[i % SIZE_COLORS.length];
    parts.push(`<rect x="120" y="${fmt(y - 3.5)}" width="8" height="4" fill="${color}"/>`);
    parts.push(`<text x="131" y="${fmt(y)}">${escapeXml(e.sizeName)} — ${color}${e.sizeName === baseSize ? ' (base)' : ''}</text>`);
  });
  parts.push('</g>');
  geoms.forEach((g, i) => {
    const color = SIZE_COLORS[i % SIZE_COLORS.length];
    const sw = g.sizeName === baseSize ? 0.5 : 0.35;
    parts.push(`<g class="size" data-size="${escapeXml(g.sizeName)}" stroke="${color}" fill="none" stroke-width="${fmt(sw)}" stroke-linejoin="round">`);
    parts.push(`<path class="cut" d="${polyPath(g.cut.map(S), true)}"/>`);
    parts.push(`<path class="stitch" stroke-dasharray="4 2" d="${polyPath(g.stitch.map(S), true)}"/>`);
    parts.push('<g class="notches">');
    for (const nt of g.notches) {
      parts.push(`<path d="M ${pt(S(nt.p))} L ${pt(S(nt.q))}"/>`);
      if (nt.kind === 'double' && nt.p2 && nt.q2) parts.push(`<path d="M ${pt(S(nt.p2))} L ${pt(S(nt.q2))}"/>`);
    }
    parts.push('</g>');
    parts.push('</g>');
  });
  const sizeAttr = pieceBySize.map((e) => e.sizeName).join(' ');
  return rootSvg(W, H, sizeAttr, title, parts.filter((s) => s !== '').join('\n'));
}

/** Class name of the sheet-level calibration group (stripped by print.js). */
export const SHEET_CALIBRATION_CLASS = CALIB_CLASS;
