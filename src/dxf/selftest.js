// src/dxf/selftest.js — the DXF module's self-tests. Pure; runs in the browser and under node.

import { normalizeDoc } from '../core/schema.js';
import { getSample } from '../samples/index.js';
import { flattenPiece } from '../geometry/bezier.js';
import { signedArea, polylineLength, pointInPolygon } from '../geometry/polygon.js';
import { sizeNames } from '../sizing/index.js';
import { parseDxf, placeBlock, unbulge } from './dxfio.js';
import { fitCubics } from './fitcurve.js';
import { exportAama, importAama, layerNo } from './aama.js';

/** @typedef {import('../core/types.js').SelfTestResult} SelfTestResult */

/** @param {boolean} c @param {string} m */
function assert(c, m) { if (!c) throw new Error(m); }

/** DXF text from [code, value] pairs. @param {Array<[number, string|number]>} ps */
const dxfText = (ps) => ps.map(([c, v]) => `${c}\n${v}`).join('\n') + '\n';

/** Area and perimeter of a piece's outline, mm. @param {any} p */
function measure(p) {
  const { points } = flattenPiece(p, 0.05);
  return { area: Math.abs(signedArea(points)), perim: polylineLength(points, true) };
}

/** Point of a piece's notch, for comparing notches across a round trip. @param {any} p @param {any} nt */
function notchPoint(p, nt) {
  const { points, edgeStart } = flattenPiece(p, 0.05);
  const n = p.vertices.length;
  const s = edgeStart[nt.edge], e = nt.edge + 1 < n ? edgeStart[nt.edge + 1] : points.length;
  const run = points.slice(s, e).concat([points[e % points.length]]);
  const L = polylineLength(run, false);
  let acc = 0;
  for (let i = 1; i < run.length; i++) {
    const d = Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
    if (acc + d >= nt.t * L) { const f = d > 0 ? (nt.t * L - acc) / d : 0; return [run[i - 1][0] + (run[i][0] - run[i - 1][0]) * f, run[i - 1][1] + (run[i][1] - run[i - 1][1]) * f]; }
    acc += d;
  }
  return run[run.length - 1];
}

/** @returns {Promise<SelfTestResult[]>} */
export async function runSelfTest() {
  /** @type {SelfTestResult[]} */
  const results = [];
  /** @param {string} name @param {() => string|void} fn */
  function check(name, fn) {
    try { const d = fn(); results.push({ name, pass: true, details: d || 'ok' }); }
    catch (e) { results.push({ name, pass: false, details: String(e && e.message ? e.message : e) }); }
  }

  check('dxf.parse', () => {
    const text = dxfText([
      [0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, 1], [0, 'ENDSEC'],
      [0, 'SECTION'], [2, 'BLOCKS'],
      [0, 'BLOCK'], [8, '0'], [2, 'P1'], [70, 0], [10, 5], [20, 5], [30, 0], [3, 'P1'],
      [0, 'POLYLINE'], [8, '1'], [66, 1], [70, 1], [10, 0], [20, 0], [30, 0],
      [0, 'VERTEX'], [8, '1'], [10, 5], [20, 5],
      [0, 'VERTEX'], [8, '1'], [10, 15], [20, 5],
      [0, 'VERTEX'], [8, '1'], [10, 15], [20, 25],
      [0, 'SEQEND'], [8, '1'],
      [0, 'TEXT'], [8, '1'], [10, 6], [20, 6], [40, 1], [1, 'Piece Name: BACK'],
      [0, 'ENDBLK'], [8, '0'],
      [0, 'ENDSEC'],
      [0, 'SECTION'], [2, 'ENTITIES'],
      [0, 'INSERT'], [8, '0'], [2, 'P1'], [10, 100], [20, 0], [41, 2], [42, 2], [50, 90],
      [0, 'LWPOLYLINE'], [8, 'L14'], [90, 3], [70, 1], [10, 0], [20, 0], [10, 1], [20, 0], [42, 0.5], [10, 1], [20, 1],
      [0, 'SPLINE'], [8, '8'],
      [0, 'ENDSEC'], [0, 'EOF'],
    ]);
    const d = parseDxf('﻿' + text.replace(/\n/g, '\r\n'));
    assert(d.header.$INSUNITS === 1, 'header $INSUNITS = ' + d.header.$INSUNITS);
    assert(d.blocks.has('P1') && d.blocks.get('P1').entities.length === 2, 'block P1 with a polyline and a text');
    const blk = d.blocks.get('P1');
    assert(blk.base[0] === 5 && blk.entities[0].points.length === 3 && blk.entities[0].closed, 'polyline vertices and closed flag');
    const ins = d.entities.find((e) => e.type === 'INSERT');
    const placed = placeBlock(blk, ins);
    // base (5,5) -> origin, scale 2, rotate 90 degrees, move to (100, 0): (15,5) -> (20,0) -> (0,20) -> (100,20)
    const q = placed[0].points[1];
    assert(Math.abs(q[0] - 100) < 1e-9 && Math.abs(q[1] - 20) < 1e-9, 'placed vertex ' + q);
    const lw = d.entities.find((e) => e.type === 'POLYLINE');
    assert(lw && lw.points.length === 3 && lw.points[1][2] === 0.5 && lw.closed && layerNo(lw.layer) === '14', 'LWPOLYLINE with a bulge on layer L14');
    assert(d.skipped.SPLINE === 1, 'unknown entities are counted, not fatal');
    return '2 blocks entities, INSERT scale+rotation, LWPOLYLINE bulge, BOM and CRLF';
  });

  check('dxf.unbulge', () => {
    // a segment from (1,0) to (-1,0) with bulge 1 is a half circle of radius 1 around the origin
    const pts = unbulge([[1, 0, 1], [-1, 0, 0]], false, 5);
    const worst = Math.max(...pts.map((q) => Math.abs(Math.hypot(q[0], q[1]) - 1)));
    assert(pts.length > 20 && worst < 1e-9, 'half circle: ' + pts.length + ' points, radius error ' + worst);
    assert(pts.every((q) => q[1] >= -1e-9), 'a positive bulge turns counter-clockwise (through +y)');
    return pts.length + ' points on the arc';
  });

  check('dxf.fitCubics', () => {
    const pts = [];
    for (let i = 0; i <= 60; i++) { const a = (Math.PI / 2) * (i / 60); pts.push([100 * Math.cos(a), 100 * Math.sin(a)]); }
    const cubics = fitCubics(pts, 0.25);
    let worst = 0;
    for (const [p0, c1, c2, p1] of cubics) {
      for (let s = 0; s <= 50; s++) {
        const t = s / 50, u = 1 - t;
        const x = u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0];
        const y = u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1];
        worst = Math.max(worst, Math.abs(Math.hypot(x, y) - 100));
      }
    }
    assert(cubics.length <= 2 && worst < 0.3, cubics.length + ' cubics, radius error ' + worst.toFixed(3) + ' mm');
    return 'quarter circle r 100 mm: ' + cubics.length + ' cubic(s), max error ' + worst.toFixed(3) + ' mm';
  });

  const tshirt = normalizeDoc(getSample('tshirt'));
  // pieces marked "Hide in export" (the T-shirt's mirrored sleeve) are, correctly, not in the file
  const exported = tshirt.pieces.filter((p) => p.exportHidden !== true);

  check('dxf.roundtrip', () => {
    const text = exportAama(tshirt, { sizes: ['M'] });
    assert(/AC1009/.test(text) && /Piece Name: Front/.test(text), 'R12 header and piece text');
    const { pieces, report } = importAama(text);
    assert(report.units === 'mm' && pieces.length === exported.length, `units ${report.units}, pieces ${pieces.length} of ${exported.length}`);
    assert(/Clothing CAD/.test(report.author || ''), 'the file names its author: ' + report.author);
    const parts = [];
    for (const src of exported) {
      const got = pieces.find((p) => p.name === src.name);
      assert(got, 'missing piece ' + src.name);
      const a = measure(src), b = measure(got);
      assert(Math.abs(a.area - b.area) / a.area < 0.003 && Math.abs(a.perim - b.perim) < 2,
        `${src.name}: area ${a.area.toFixed(0)} -> ${b.area.toFixed(0)} mm2, perimeter ${a.perim.toFixed(1)} -> ${b.perim.toFixed(1)} mm`);
      assert((src.foldEdge === null) === (got.foldEdge === undefined || got.foldEdge === null), `${src.name}: fold ${src.foldEdge} -> ${got.foldEdge}`);
      assert(got.cutQty === src.cutQty, `${src.name}: quantity ${src.cutQty} -> ${got.cutQty}`);
      assert(got.notches.length === src.notches.length, `${src.name}: ${src.notches.length} notches -> ${got.notches.length}`);
      for (const nt of src.notches) {
        const p = notchPoint(src, nt);
        const near = got.notches.some((g) => { const q = notchPoint(got, g); return Math.hypot(q[0] - p[0], q[1] - p[1]) < 1.5 && g.kind === nt.kind; });
        assert(near, `${src.name}: notch on edge ${nt.edge} at ${nt.t} not found after the round trip`);
      }
      const ga = got.grainline, sa = src.grainline;
      assert(ga && Math.hypot(ga.a[0] - sa.a[0], ga.a[1] - sa.a[1]) < 0.01 && Math.hypot(ga.b[0] - sa.b[0], ga.b[1] - sa.b[1]) < 0.01, src.name + ': grainline');
      assert(Math.abs(got.seamAllowance_mm - src.seamAllowance_mm) <= 0.5, `${src.name}: allowance ${src.seamAllowance_mm} -> ${got.seamAllowance_mm}`);
      // the hem (25 mm) must keep its own allowance
      const hemSrc = src.edges.find((e) => e.label === 'hem');
      if (hemSrc) {
        const gotAllow = got.edges.map((e) => (Number.isFinite(e.allowance_mm) ? e.allowance_mm : got.seamAllowance_mm));
        assert(gotAllow.some((v) => Math.abs(v - hemSrc.allowance_mm) <= 0.5), `${src.name}: hem allowance ${hemSrc.allowance_mm} lost: ${gotAllow.join(',')}`);
      }
      // every corner comes back as a corner and every cubic as one cubic: the same points, no more
      assert(got.vertices.length === src.vertices.length, `${src.name}: ${src.vertices.length} vertices -> ${got.vertices.length}`);
      parts.push(`${src.name} ${(100 * Math.abs(a.area - b.area) / a.area).toFixed(2)}% (${src.vertices.length}->${got.vertices.length} pts)`);
    }
    return 'area error ' + parts.join(', ');
  });

  check('dxf.container', () => {
    // what every reader accepts (docs/SPEC.md, DXF-AAMA): R12 with $ACADVER only, no TABLES, safe block names,
    // INSERTs on layer 1, 7-bit ASCII, the standard's style text, every boundary vertex marked turn or curve,
    // notches as POINTs on a cut-line vertex with a depth and an angle into the piece
    const doc = normalizeDoc(JSON.parse(JSON.stringify(getSample('tshirt'))));
    doc.pieces[0].name = 'Épaule dos/avant';
    const text = exportAama(doc, { sizes: ['M'] });
    const header = text.slice(0, text.indexOf('ENDSEC'));
    assert(!/TABLES|LWPOLYLINE|MTEXT|SPLINE/.test(text), 'R12 entities only, no TABLES');
    assert(/\$ACADVER\r\n  1\r\nAC1009/.test(header) && (header.match(/\r\n  9\r\n/g) || []).length === 1, 'the header holds $ACADVER only');
    assert(/^[\t\n\r\x20-\x7e]*$/.test(text), '7-bit ASCII only');
    const d = parseDxf(text);
    const names = [...d.blocks.keys()];
    assert(names.every((nm) => /^[A-Za-z0-9_-]{1,31}$/.test(nm)) && names.includes('Epaule_dos_avant_M'), 'block names: ' + names.join(', '));
    assert(d.entities.filter((e) => e.type === 'INSERT').every((e) => layerNo(e.layer) === '1'), 'INSERTs on layer 1');
    const style = d.entities.filter((e) => e.type === 'TEXT').map((e) => e.text);
    for (const key of ['Style Name:', 'Creation Time:', 'Author:', 'Sample Size: M', 'Grade Rule Table:', 'Units: METRIC']) {
      assert(style.some((t) => t.startsWith(key)), 'style text ' + key);
    }
    assert(style.some((t) => /^Creation Date: \d\d-\d\d-\d{4}$/.test(t)), 'Creation Date as dd-mm-yyyy');
    let marked = 0, total = 0, notches = 0;
    for (const [, blk] of d.blocks) {
      const at = (list, q) => list.some((t) => Math.abs(t[0] - q[0]) < 1e-6 && Math.abs(t[1] - q[1]) < 1e-6);
      const markPts = blk.entities.filter((e) => e.type === 'POINT' && ['2', '3'].includes(layerNo(e.layer))).map((e) => e.p);
      for (const pl of blk.entities.filter((e) => e.type === 'POLYLINE' && ['1', '14'].includes(layerNo(e.layer)))) {
        for (const q of pl.points) { total++; if (at(markPts, q)) marked++; }
      }
      const cut = blk.entities.find((e) => e.type === 'POLYLINE' && layerNo(e.layer) === '1').points.map((q) => [q[0], q[1]]);
      for (const nt of blk.entities.filter((e) => e.type === 'POINT' && layerNo(e.layer) === '4')) {
        notches++;
        assert(at(cut, nt.p), 'notch at ' + nt.p + ' is not on a cut-line vertex');
        const a = (nt.angle || 0) * Math.PI / 180;
        assert(pointInPolygon([nt.p[0] + Math.cos(a), nt.p[1] + Math.sin(a)], cut), 'notch at ' + nt.p + ' points out of the piece');
      }
    }
    assert(marked === total, `${total - marked} of ${total} boundary vertices have no turn or curve point`);
    const depths = [...text.matchAll(/POINT\r\n  8\r\n4\r\n 10\r\n[-\d.]+\r\n 20\r\n[-\d.]+\r\n 30\r\n([-\d.]+)\r\n 39\r\n0\r\n 50\r\n/g)].map((m) => +m[1]);
    assert(depths.length === notches && depths.every((v) => v >= 3 && v <= 6), 'notch depths ' + depths.join(', '));
    return `${names.length} blocks, ${total} boundary vertices all marked, ${notches} notch POINTs on cut-line vertices`;
  });

  check('dxf.mirrorOption', () => {
    // fold: 'mirror' writes the stored half with the standard's mirror line, vertex to vertex along the cut line
    const text = exportAama(tshirt, { sizes: ['M'], fold: 'mirror' });
    const ents = parseDxf(text).blocks.get('Front_M').entities;
    const mirror = ents.filter((e) => e.type === 'LINE' && layerNo(e.layer) === '6');
    const cut = ents.find((e) => e.type === 'POLYLINE' && layerNo(e.layer) === '1').points;
    assert(mirror.length === 1 && [mirror[0].a, mirror[0].b].every((m) => Math.abs(m[0]) < 1e-9 && cut.some((q) => Math.hypot(q[0] - m[0], q[1] - m[1]) < 1e-6)),
      'one mirror line on x = 0, from cut-line vertex to cut-line vertex');
    assert(cut.every((q) => q[0] >= -1e-6), 'only the stored half is written');
    const got = importAama(text).pieces.find((p) => p.name === 'Front'), src = tshirt.pieces.find((p) => p.name === 'Front');
    const a = measure(src), b = measure(got);
    assert(Number.isInteger(got.foldEdge) && Math.abs(a.area - b.area) / a.area < 0.003 && got.vertices.length === src.vertices.length,
      `fold ${got.foldEdge}, area ${a.area.toFixed(0)} -> ${b.area.toFixed(0)}, ${src.vertices.length} -> ${got.vertices.length} points`);
    // the default writes the whole piece: its cut line crosses the fold
    const whole = parseDxf(exportAama(tshirt, { sizes: ['M'] })).blocks.get('Front_M').entities;
    const wcut = whole.find((e) => e.type === 'POLYLINE' && layerNo(e.layer) === '1').points;
    assert(wcut.some((q) => q[0] < -100) && !whole.some((e) => layerNo(e.layer) === '6'), 'the default writes fold pieces whole, with no mirror line');
    return 'half piece and mirror line on request, folded back on import; whole pieces by default';
  });

  check('dxf.gerberStyle', () => {
    // AccuMark's way: an empty header, the boundary as open polylines meeting end to start (one written
    // backwards), notch POINTs with a negative depth and no angle, "SIZE:", "Quantity: R,L", and a double
    // notch as two notches 11 mm apart
    const poly = (pts) => {
      const out = [[0, 'POLYLINE'], [8, '1'], [66, 1], [70, 0]];
      for (const q of pts) out.push([0, 'VERTEX'], [8, '1'], [10, q[0]], [20, q[1]]);
      return out.concat([[0, 'SEQEND'], [8, '1']]);
    };
    const notch = (x, y) => [[0, 'POINT'], [8, '4'], [10, x], [20, y], [30, -3.998], [39, 2.9998]];
    const text = (t, y) => [[0, 'TEXT'], [8, '1'], [10, 10], [20, y], [40, 0.25], [1, t]];
    const ps = [[0, 'SECTION'], [2, 'HEADER'], [0, 'ENDSEC'], [0, 'SECTION'], [2, 'BLOCKS'], [0, 'BLOCK'], [8, '0'], [2, 'YOKE_40'], [70, 64], [10, 0], [20, 0],
      ...poly([[0, 0], [400, 0], [400, 300]]), ...poly([[0, 300], [200, 360], [400, 300]]), ...poly([[0, 300], [0, 0]]),
      ...notch(400, 144.5), ...notch(400, 155.5), ...notch(200, 0),
      ...text('Piece Name: YOKE', 10), ...text('SIZE: 40', 20), ...text('Quantity: 1,1', 30),
      [0, 'ENDBLK'], [8, '0'], [0, 'ENDSEC'], [0, 'SECTION'], [2, 'ENTITIES'], [0, 'INSERT'], [8, '1'], [2, 'YOKE_40'], [10, 0], [20, 0],
      ...text('Units: METRIC', 0), ...text('Sample Size: 40', -5), [0, 'ENDSEC'], [0, 'EOF']];
    const { pieces, report } = importAama(dxfText(ps));
    assert(pieces.length === 1 && pieces[0].name === 'YOKE' && pieces[0].cutQty === 2, 'one piece YOKE, quantity 1 right + 1 left = 2');
    assert(report.units === 'mm' && /says/.test(report.unitsFrom), 'units from the Units text: ' + report.unitsFrom);
    const p = pieces[0], m = measure(p);
    assert(p.vertices.length === 5 && Math.abs(m.area - (400 * 300 + 400 * 60 / 2)) < 5, `chained outline: ${p.vertices.length} points, area ${m.area.toFixed(0)}`);
    const kinds = p.notches.map((nt) => nt.kind).sort().join(',');
    assert(kinds === 'double,single', 'a double notch (two 11 mm apart) and a single one, got ' + kinds);
    return 'boundary chained from 3 open polylines, POINT notches, double notch and R,L quantity read';
  });

  check('dxf.gradedTransfer', () => {
    // A graded nest as the standard writes it: turn / curve points and notches in the sample size only, the
    // other size with the same outline points in the same order. The corner where a side meets the top curve
    // is too shallow to guess, so it survives only if the sample's marks are carried over.
    const shape = (s) => {
      const pts = [[0, 0], [400 * s, 0], [400 * s, 300 * s]];
      for (let i = 1; i < 12; i++) { const a = Math.PI * i / 12; pts.push([200 * s + 200 * s * Math.cos(a), 300 * s + 60 * s * Math.sin(a)]); }
      pts.push([0, 300 * s]);
      return pts;
    };
    const block = (name, size, s, marks) => {
      const out = [[0, 'BLOCK'], [8, '0'], [2, name], [70, 0], [10, 0], [20, 0], [0, 'POLYLINE'], [8, '1'], [66, 1], [70, 1]];
      const ring = shape(s);
      for (const q of ring) out.push([0, 'VERTEX'], [8, '1'], [10, q[0]], [20, q[1]]);
      out.push([0, 'SEQEND'], [8, '1']);
      if (marks) {
        ring.forEach((q, i) => out.push([0, 'POINT'], [8, [0, 1, 2, 14].includes(i) ? '2' : '3'], [10, q[0]], [20, q[1]]));
        out.push([0, 'POINT'], [8, '4'], [10, ring[8][0]], [20, ring[8][1]]);
      }
      out.push([0, 'TEXT'], [8, '1'], [10, 5], [20, 5], [40, 3], [1, 'Piece Name: TOP'], [0, 'TEXT'], [8, '1'], [10, 5], [20, 10], [40, 3], [1, 'Size: ' + size]);
      return out.concat([[0, 'ENDBLK'], [8, '0']]);
    };
    const ps = [[0, 'SECTION'], [2, 'BLOCKS'], ...block('TOP_40', '40', 1, true), ...block('TOP_42', '42', 1.05, false), [0, 'ENDSEC'],
      [0, 'SECTION'], [2, 'ENTITIES'], [0, 'INSERT'], [8, '1'], [2, 'TOP_40'], [10, 0], [20, 0], [0, 'INSERT'], [8, '1'], [2, 'TOP_42'], [10, 0], [20, 0],
      [0, 'TEXT'], [8, '1'], [10, 0], [20, -5], [40, 3], [1, 'Sample Size: 40'], [0, 'TEXT'], [8, '1'], [10, 0], [20, -10], [40, 3], [1, 'Units: METRIC'], [0, 'ENDSEC'], [0, 'EOF']];
    const { pieces, report } = importAama(dxfText(ps), { size: '42' });
    assert(report.size === '42' && pieces.length === 1, 'size 42 imported');
    const p = pieces[0];
    assert(p.vertices.some((v) => Math.hypot(v[0] - 420, v[1] - 315) < 0.01), 'the shallow corner at (420, 315) came from the sample size');
    assert(p.notches.length === 1, 'the notch came from the sample size: ' + p.notches.length);
    const want = shape(1.05)[8];
    const q = notchPoint(p, p.notches[0]);
    assert(Math.hypot(q[0] - want[0], q[1] - want[1]) < 0.5, `notch at ${q.map((v) => v.toFixed(1))}, expected ${want.map((v) => v.toFixed(1))}`);
    assert(/sample size/.test(report.pieces[0].from), 'the report says where they came from: ' + report.pieces[0].from);
    return 'corner and notch carried from the sample size to size 42 by point order';
  });

  check('dxf.cmMetric', () => {
    // CLO has written centimetres under "Units: METRIC": pieces tens of units across are read as cm, with a warning
    const ps = [[0, 'SECTION'], [2, 'BLOCKS'], [0, 'BLOCK'], [8, '0'], [2, 'P_M'], [70, 0], [10, 0], [20, 0],
      [0, 'POLYLINE'], [8, '1'], [66, 1], [70, 1]];
    for (const q of [[0, 0], [40, 0], [40, 30], [0, 30]]) ps.push([0, 'VERTEX'], [8, '1'], [10, q[0]], [20, q[1]]);
    ps.push([0, 'SEQEND'], [8, '1'], [0, 'TEXT'], [8, '1'], [10, 1], [20, 1], [40, 1], [1, 'PIECE NAME: Panel'], [0, 'ENDBLK'], [8, '0'], [0, 'ENDSEC'],
      [0, 'SECTION'], [2, 'ENTITIES'], [0, 'INSERT'], [8, '1'], [2, 'P_M'], [10, 0], [20, 0], [0, 'TEXT'], [8, '1'], [10, 0], [20, -5], [40, 1], [1, 'UNITS: METRIC'], [0, 'ENDSEC'], [0, 'EOF']);
    const { pieces, report } = importAama(dxfText(ps));
    assert(report.units === 'cm' && report.warnings.some((w) => /centimetres/.test(w)), 'read as cm with a warning: ' + report.unitsFrom);
    assert(Math.abs(measure(pieces[0]).area - 400 * 300) < 1, 'a 400 x 300 mm panel');
    const mm = importAama(dxfText(ps), { units: 'mm' });
    assert(mm.report.units === 'mm' && Math.abs(measure(mm.pieces[0]).area - 40 * 30) < 1, 'the caller can override the units');
    return 'METRIC in centimetres detected; override honoured';
  });

  check('dxf.inches', () => {
    const { pieces, report } = importAama(exportAama(tshirt, { sizes: ['M'], units: 'in' }));
    assert(report.units === 'in' && /says/.test(report.unitsFrom), 'units ' + report.units + ' from ' + report.unitsFrom);
    const a = measure(tshirt.pieces[0]), b = measure(pieces.find((p) => p.name === tshirt.pieces[0].name));
    assert(Math.abs(a.area - b.area) / a.area < 0.003, `inch round trip area ${a.area.toFixed(0)} -> ${b.area.toFixed(0)}`);
    return 'ENGLISH units read back as mm within ' + (100 * Math.abs(a.area - b.area) / a.area).toFixed(2) + '%';
  });

  check('dxf.gradedNest', () => {
    const all = sizeNames(tshirt.sizes);
    const text = exportAama(tshirt, { sizes: all });
    const { pieces, report } = importAama(text);
    assert(report.sizes.length === all.length && report.size === tshirt.sizes.baseSize, 'sizes ' + report.sizes.join(',') + ' -> imported ' + report.size);
    assert(pieces.length === exported.length, 'one piece per name for the sample size, got ' + pieces.length);
    assert(report.warnings.some((w) => /sizes/.test(w)), 'the report must say other sizes were not imported');
    const other = importAama(text, { size: all[all.length - 1] });
    const big = measure(other.pieces.find((p) => p.name === 'Front')), base = measure(pieces.find((p) => p.name === 'Front'));
    assert(big.area > base.area, 'a larger size must import larger');
    return all.length + ' sizes in one file; sample size ' + report.size + ' imported, others on request';
  });

  check('dxf.vendorVariant', () => {
    // What a minimal writer produces: an LWPOLYLINE cut line only (no sew line, no turn/curve points), notch
    // lines, a grain line, text in the block, inches without a declaration, and the piece in model space via INSERT.
    const inch = (v) => v / 25.4;
    const ring = [[0, 0], [400, 0], [400, 300], [200, 360], [0, 300]].map((q) => [inch(q[0]), inch(q[1])]);
    const ps = [[0, 'SECTION'], [2, 'BLOCKS'], [0, 'BLOCK'], [8, '0'], [2, 'SHAPE'], [70, 0], [10, 0], [20, 0],
      [0, 'LWPOLYLINE'], [8, '1'], [90, ring.length], [70, 1]];
    for (const q of ring) ps.push([10, q[0]], [20, q[1]]);
    ps.push([0, 'LINE'], [8, '4'], [10, inch(400)], [20, inch(150)], [11, inch(394)], [21, inch(150)]);
    ps.push([0, 'LINE'], [8, '7'], [10, inch(200)], [20, inch(50)], [11, inch(200)], [21, inch(250)]);
    ps.push([0, 'TEXT'], [8, '1'], [10, 1], [20, 1], [40, 0.2], [1, 'PIECE NAME: Yoke']);
    ps.push([0, 'TEXT'], [8, '1'], [10, 1], [20, 1], [40, 0.2], [1, 'QUANTITY: 2']);
    ps.push([0, 'ENDBLK'], [0, 'ENDSEC'], [0, 'SECTION'], [2, 'ENTITIES'], [0, 'INSERT'], [8, '0'], [2, 'SHAPE'], [10, 0], [20, 0], [0, 'ENDSEC'], [0, 'EOF']);
    const { pieces, report } = importAama(dxfText(ps));
    assert(pieces.length === 1 && pieces[0].name === 'Yoke' && pieces[0].cutQty === 2, 'name and quantity from upper-case keys');
    assert(report.units === 'in' && /guessed/.test(report.unitsFrom), 'undeclared small units read as inches: ' + report.unitsFrom);
    assert(report.warnings.some((w) => /no sew line/.test(w)) && pieces[0].seamAllowance_mm === 0, 'no sew line: allowance 0 and a warning');
    const m = measure(pieces[0]);
    assert(Math.abs(m.area - (400 * 300 + 400 * 60 / 2)) < 5, 'area ' + m.area.toFixed(0) + ' mm2');
    assert(pieces[0].vertices.length === 5 && pieces[0].edges.every((e) => e.type === 'line'), 'a polygon with long straight sides stays 5 line edges');
    assert(pieces[0].notches.length === 1 && pieces[0].grainline && Math.abs(pieces[0].grainline.b[1] - 250) < 0.01, 'notch and grainline');
    return 'inches guessed, upper-case text keys, notch and grain found, no-sew-line warning';
  });

  check('dxf.garbage', () => {
    const r = importAama('this is not a DXF file\nat all');
    assert(r.pieces.length === 0 && r.report.warnings.some((w) => /No pattern pieces/.test(w)), 'no pieces and a clear warning');
    return 'rejected with a message';
  });

  return results;
}
