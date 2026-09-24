// src/viewer3d/selftest.js — the 17 in-page checks of SPEC 8.9 (needs WebGL2; run in the browser via __app).

import * as THREE from 'three';
import { FABRIC_PRESETS, resolveFabric } from '../core/fabrics.js';
import {
  createViewer3D, createLoop, topologyFromState, fabricMaterial, materialFor, materialCacheSize,
  drawTextureCanvas, fabricTexture, textureCacheSize, createTearMarks, MARK_COLORS,
  STAGE_PRESETS, PEDESTAL_H, RUNWAY_H,
} from './index.js';
import { SCENE_PRESETS } from '../core/schema.js';

/** @typedef {import('../core/types.js').SelfTestResult} SelfTestResult */

const N = 10;
const SPACING_MM = 15;

/** Builds the 10x10 sheet fixture shaped like a ClothState (V = 100, T = 162, 36 boundary ids CCW). */
function makeSheet(fabric) {
  const V = N * N;
  const positions2d = new Float32Array(2 * V);
  const pos = new Float32Array(3 * V);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const v = j * N + i;
      positions2d[2 * v] = i * SPACING_MM;
      positions2d[2 * v + 1] = j * SPACING_MM;
      pos[3 * v] = (i - (N - 1) / 2) * SPACING_MM / 1000;
      pos[3 * v + 1] = 1.0 + j * SPACING_MM / 1000;
      pos[3 * v + 2] = 0.2;
    }
  }
  const T = 2 * (N - 1) * (N - 1);
  const tris = new Uint32Array(3 * T);
  let t = 0;
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, c = a + N + 1, d = a + N;
      tris[t++] = a; tris[t++] = b; tris[t++] = c;
      tris[t++] = a; tris[t++] = c; tris[t++] = d;
    }
  }
  const boundary = [];
  for (let i = 0; i < N; i++) boundary.push(i);
  for (let j = 1; j < N; j++) boundary.push(j * N + N - 1);
  for (let i = N - 2; i >= 0; i--) boundary.push((N - 1) * N + i);
  for (let j = N - 2; j >= 1; j--) boundary.push(j * N);
  const mesh = {
    pieceId: 'sheet', vertexCount: V, positions2d, triangles: tris.slice(), edges: new Uint32Array(0), bendPairs: new Uint32Array(0),
    boundary: new Uint32Array(boundary), edgeVerts: [[], []], notchVerts: [[], []], area_mm2: (N - 1) * (N - 1) * SPACING_MM * SPACING_MM,
    quality: { minAngleDeg: 45, pctAbove20: 100, medianEdge_mm: SPACING_MM, triangles: T }, warnings: [],
  };
  return {
    V, pos, prev: pos.slice(), vel: new Float32Array(3 * V), invMass: new Float32Array(V).fill(1), restPos: pos.slice(),
    pieceOf: new Uint16Array(V), tris,
    pieces: [{ start: 0, count: V, pieceId: 'sheet', mesh, fabric, layer: 0 }],
    frame: 0, time: 0, nanCount: 0,
  };
}

function makeBodyFixture() {
  const g = new THREE.SphereGeometry(0.3, 24, 16);
  g.translate(0, 1.0, 0);
  const positions = new Float32Array(g.attributes.position.array);
  const normals = new Float32Array(g.attributes.normal.array);
  const indices = new Uint32Array(g.index.array);
  g.dispose();
  return {
    geometry: { positions, normals, indices },
    landmarks: { chestCenter: [0, 1.0, 0] },
    anchors: { torso: { origin: [0, 1.3, 0], axis: [0, -1, 0], front: [0, 0, 1], radius: 0.36, length: 0.6 } },
  };
}

/** @param {boolean} cond @param {string} msg */
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
}

/** @returns {Promise<SelfTestResult[]>} */
export async function runSelfTest() {
  /** @type {SelfTestResult[]} */
  const results = [];
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:240px;margin:0;padding:0;border:0;';
  document.body.appendChild(container);

  // The material/texture caches are module-global and shared with a live viewer. When this self-test runs inside the
  // running app (the acceptance suite does exactly that) they are already populated, and viewer.dispose() clears them
  // globally — the app rebuilds its materials lazily afterwards, but the "caches are empty" assertions below only hold
  // when this self-test started from a clean slate. `ownsCaches` records which situation we are in.
  const ownsCaches = materialCacheSize() === 0 && textureCacheSize() === 0;

  /** @type {ReturnType<typeof createViewer3D>|null} */
  let v = null;
  const fabric = resolveFabric({ id: 'main', name: 'Main', preset: 'cotton', color: '#c8102e', texture: { kind: 'solid', scale_mm: 20, color2: '#ffffff' }, overrides: {} });
  const state = /** @type {any} */ (makeSheet(fabric));
  const bodyFixture = makeBodyFixture();

  /** @param {string} name @param {() => (void|string|Promise<void|string>)} fn */
  async function check(name, fn) {
    try {
      const details = await fn();
      results.push({ name, pass: true, details: typeof details === 'string' ? details : 'ok' });
    } catch (err) {
      results.push({ name, pass: false, details: String(err && err.stack ? err.message : err) });
    }
  }

  try {
    await check('viewer.create', () => {
      v = createViewer3D(container, { tick: null });
      assert(!!v.viewer.renderer.getContext(), 'no WebGL context');
      const s = v.viewer.size();
      assert(s.width === 320, `size().width ${s.width} !== 320`);
      return `${s.width}x${s.height} dpr ${s.dpr}`;
    });

    await check('viewer.render.noGlError', () => {
      assert(v, 'no viewer');
      v.viewer.render();
      const gl = v.viewer.renderer.getContext();
      const err = gl.getError();
      assert(err === gl.NO_ERROR, `gl.getError() = ${err}`);
      const ri = v.viewer.renderInfo();
      assert(ri.calls >= 1, `renderInfo().calls ${ri.calls} < 1`);
      return `calls ${ri.calls}, triangles ${ri.triangles}`;
    });

    await check('viewer.frame.default', () => {
      assert(v, 'no viewer');
      const ty = v.viewer.controls.target.y;
      assert(Math.abs(ty - 1.26) < 0.001, `controls.target.y ${ty} not within 0.001 of 1.26`);
      const d = v.viewer.camera.position.distanceTo(v.viewer.controls.target);
      assert(d >= 3.5 && d <= 4.0, `camera distance ${d} not in [3.5, 4.0]`);
      return `target.y ${ty.toFixed(3)}, distance ${d.toFixed(3)}`;
    });

    await check('body.setBody', () => {
      assert(v, 'no viewer');
      v.setBody(/** @type {any} */ (bodyFixture));
      const vc = v.body.vertexCount();
      const expected = bodyFixture.geometry.positions.length / 3;
      assert(vc === expected, `vertexCount ${vc} !== ${expected}`);
      const b = v.body.bounds();
      assert(b && Math.abs(b.max[1] - 1.3) < 1e-3, `bounds max y ${b ? b.max[1] : 'null'} not within 1e-3 of 1.3`);
      assert(v.body.landmarks.children.length === 1, `landmarks children ${v.body.landmarks.children.length} !== 1`);
      assert(v.body.landmarks.children[0].name === 'chestCenter', 'landmark not named chestCenter');
      v.viewer.render();
      return `V ${vc}, max y ${b.max[1].toFixed(4)}`;
    });

    await check('body.badIndices', () => {
      assert(v, 'no viewer');
      const bad = new Uint32Array(bodyFixture.geometry.indices);
      bad[0] = bodyFixture.geometry.positions.length / 3;
      let code = null;
      try {
        v.body.setBody({ geometry: { positions: bodyFixture.geometry.positions, normals: bodyFixture.geometry.normals, indices: bad } });
      } catch (err) {
        code = err && err.code;
      }
      assert(code === 'ViewerBadBody', `expected code ViewerBadBody, got ${code}`);
      assert(v.body.vertexCount() === bodyFixture.geometry.positions.length / 3, 'previous body lost after a bad setBody');
    });

    await check('cloth.setCloth.counts', () => {
      assert(v, 'no viewer');
      v.setCloth(state);
      const T = state.tris.length / 3;
      assert(v.cloth.vertexCount() === state.V, `vertexCount ${v.cloth.vertexCount()} !== ${state.V}`);
      assert(v.cloth.triangleCount() === T, `triangleCount ${v.cloth.triangleCount()} !== ${T}`);
      const geo = v.cloth.geometry;
      assert(geo && geo.groups.length === 1, `groups.length ${geo ? geo.groups.length : 'none'} !== 1`);
      assert(geo.index && geo.index.count === 3 * T, `index.count ${geo.index ? geo.index.count : 'none'} !== ${3 * T}`);
      v.viewer.render();
      return `V ${state.V}, T ${T}`;
    });

    await check('cloth.material.color', () => {
      assert(v, 'no viewer');
      const mat = /** @type {any} */ (v.cloth.object.material)[0];
      assert(mat, 'no material[0]');
      const hex = mat.color.getHexString();
      assert(hex === 'c8102e', `color ${hex} !== c8102e`);
      assert(mat.map === null, 'map is not null for a solid fabric');
      assert(mat.side === THREE.DoubleSide, 'side is not DoubleSide');
      return `#${hex}`;
    });

    await check('cloth.updatePositions', () => {
      assert(v, 'no viewer');
      for (let i = 1; i < state.pos.length; i += 3) state.pos[i] += 0.1;
      v.cloth.updatePositions(state.pos);
      const geo = v.cloth.geometry;
      const arr = geo.attributes.position.array;
      assert(arr.length === state.pos.length, 'position array length mismatch');
      for (let i = 0; i < arr.length; i++) assert(arr[i] === state.pos[i], `position[${i}] ${arr[i]} !== ${state.pos[i]}`);
      const nrm = geo.attributes.normal.array;
      for (let i = 0; i < nrm.length; i += 3) {
        assert(Number.isFinite(nrm[i]) && Number.isFinite(nrm[i + 1]) && Number.isFinite(nrm[i + 2]), `normal ${i / 3} not finite`);
        const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]);
        assert(Math.abs(l - 1) < 1e-4, `normal ${i / 3} length ${l}`);
      }
      v.viewer.render();
    });

    await check('cloth.setPieceFabric.texture', () => {
      assert(v, 'no viewer');
      const stripes = resolveFabric({ id: 'main', name: 'Main', preset: 'cotton', color: '#c8102e', texture: { kind: 'stripes', scale_mm: 20, color2: '#ffffff' }, overrides: {} });
      v.setPieceFabric('sheet', stripes);
      const mat = /** @type {any} */ (v.cloth.object.material)[0];
      assert(mat.map && mat.map.isCanvasTexture, 'map is not a CanvasTexture');
      assert(mat.map.image.width === 512, `image.width ${mat.map.image.width} !== 512`);
      assert(mat.map.repeat.x === 5, `repeat.x ${mat.map.repeat.x} !== 5`);
      const hex = mat.color.getHexString();
      assert(hex === 'ffffff', `color ${hex} !== ffffff`);
      // The texture cache is module-global and may already hold entries when this self-test runs inside the live app
      // (the acceptance suite calls it with a draped garment on screen), so assert that re-sending the SAME fabric adds
      // nothing, rather than asserting an absolute cache size.
      const cacheAfterFirst = textureCacheSize();
      assert(cacheAfterFirst >= 1, `textureCacheSize ${cacheAfterFirst} < 1`);
      const before = mat;
      v.setPieceFabric('sheet', stripes);
      assert(textureCacheSize() === cacheAfterFirst,
        `textureCacheSize grew on resend: ${cacheAfterFirst} -> ${textureCacheSize()}`);
      const after = /** @type {any} */ (v.cloth.object.material)[0];
      assert(after === before && fabricMaterial(stripes) === before && materialFor('main') === before, 'material object changed');
      v.viewer.render();
    });

    await check('materials.allPresets', () => {
      let n = 0;
      for (const preset of FABRIC_PRESETS) {
        const f = resolveFabric({ id: preset.id, name: preset.name, preset: preset.id, color: preset.look.color, texture: { ...preset.look.texture }, overrides: {} });
        const mat = fabricMaterial(f);
        assert(mat.transparent === (f.look.opacity < 1), `${preset.id}: transparent ${mat.transparent}`);
        assert(mat.opacity === f.look.opacity, `${preset.id}: opacity ${mat.opacity} !== ${f.look.opacity}`);
        assert(mat.sheen === f.look.sheen, `${preset.id}: sheen ${mat.sheen} !== ${f.look.sheen}`);
        assert(mat.roughness === f.look.roughness, `${preset.id}: roughness ${mat.roughness} !== ${f.look.roughness}`);
        assert(mat.clearcoat === f.look.clearcoat, `${preset.id}: clearcoat ${mat.clearcoat} !== ${f.look.clearcoat}`);
        n++;
      }
      assert(n === 7, `presets ${n} !== 7`);
      assert(materialCacheSize() >= 7, `materialCacheSize ${materialCacheSize()} < 7`);
      return `materials ${materialCacheSize()}, textures ${textureCacheSize()}`;
    });

    await check('textures.kinds', () => {
      const kinds = ['solid', 'stripes', 'gingham', 'dots', 'twill', 'knit'];
      let stripesCanvas = null;
      for (const kind of kinds) {
        const c = drawTextureCanvas(/** @type {any} */ (kind), '#336699', '#ffffff');
        assert(c && c.width === 512 && c.height === 512, `${kind}: canvas ${c ? c.width + 'x' + c.height : 'null'}`);
        if (kind === 'stripes') stripesCanvas = c;
      }
      assert(fabricTexture({ kind: 'solid', scale_mm: 20, color2: '#ffffff' }, '#336699') === null, 'solid texture is not null');
      const ctx = stripesCanvas.getContext('2d');
      const px = (x, y) => {
        const d = ctx.getImageData(x, y, 1, 1).data;
        return '#' + [d[0], d[1], d[2]].map((c) => c.toString(16).padStart(2, '0')).join('');
      };
      assert(px(10, 10) === '#ffffff', `stripes pixel (10,10) ${px(10, 10)} !== #ffffff`);
      assert(px(500, 10) === '#336699', `stripes pixel (500,10) ${px(500, 10)} !== #336699`);
    });

    await check('cloth.badState', () => {
      assert(v, 'no viewer');
      const bad = { ...state, tris: new Uint32Array(state.tris) };
      bad.tris[0] = state.V;
      let code = null;
      try {
        v.cloth.setCloth(/** @type {any} */ (bad));
      } catch (err) {
        code = err && err.code;
      }
      assert(code === 'ViewerBadState', `expected code ViewerBadState, got ${code}`);
      // restore a valid cloth for the remaining checks
      v.setCloth(state);
    });

    await check('topology.clone', () => {
      const topo = topologyFromState(state);
      const T = state.tris.length / 3;
      assert(topo.tris.length === 3 * T, `tris.length ${topo.tris.length} !== ${3 * T}`);
      assert(topo.groups[0].count === 3 * T, `groups[0].count ${topo.groups[0].count} !== ${3 * T}`);
      const p2 = state.pieces[0].mesh.positions2d;
      // uv is a Float32Array, so the comparison is made at float32 precision
      assert(topo.uv[2] === Math.fround(p2[2] / 100), `uv[2] ${topo.uv[2]} !== ${Math.fround(p2[2] / 100)}`);
      const clone = structuredClone(topo);
      assert(clone.V === topo.V, 'clone V differs');
      assert(clone.tris.byteLength === topo.tris.byteLength, 'clone tris byteLength differs');
      assert(clone.fabrics[0].id === 'main', 'clone fabric id differs');
    });

    await check('gizmo.anchors', () => {
      assert(v, 'no viewer');
      const g = v.gizmo;
      g.setPlacements(null);
      g.setAnchors(bodyFixture.anchors);
      assert(g.object.children.length === 1, `children ${g.object.children.length} !== 1`);
      const torso = g.object.children[0];
      assert(torso.name === 'torso', `child name ${torso.name} !== torso`);
      g.setPlacements(state);
      const loop = g.object.children.find((c) => c.name === 'sheet');
      assert(loop && loop.isLineLoop, 'no LineLoop named sheet');
      assert(loop.geometry.attributes.position.count === 36, `loop points ${loop.geometry.attributes.position.count} !== 36`);
      g.highlight('torso');
      const hex = /** @type {any} */ (torso).material.color.getHexString();
      assert(hex === 'ffd400', `highlight colour ${hex} !== ffd400`);
      g.setVisible(true);
      v.viewer.render();
      g.setVisible(false);
    });

    await check('loop.frames', async () => {
      if (document.visibilityState !== 'visible') return 'skipped: document hidden';
      let renders = 0;
      const loop = createLoop({ render: () => { renders++; } });
      try {
        loop.start();
        for (let i = 0; i < 4; i++) await nextFrame();
        assert(loop.frameCount >= 2, `frameCount ${loop.frameCount} < 2`);
        assert(loop.isRunning() === true, 'isRunning() !== true');
        loop.renderSuppressed = true;
        const fc = loop.frameCount;
        for (let i = 0; i < 2; i++) await nextFrame();
        assert(loop.frameCount === fc, `frameCount changed while suppressed (${fc} -> ${loop.frameCount})`);
        loop.stop();
        assert(loop.isRunning() === false, 'isRunning() !== false after stop');
        return `frames ${fc}, renders ${renders}`;
      } finally {
        loop.dispose();
      }
    });

    await check('stage.presets', () => {
      // The UI lists scenes from core (no three.js there); the looks live in stage.js. Same ids, both ways.
      const core = SCENE_PRESETS.map((p) => p.id).sort().join(',');
      const view = Object.keys(STAGE_PRESETS).sort().join(',');
      assert(core === view, 'scene ids differ: core [' + core + '] vs viewer [' + view + ']');
      assert(v && typeof v.setStage === 'function', 'viewer has no setStage');
      const scene = v.viewer.scene;
      const ray = new THREE.Raycaster();
      const down = new THREE.Vector3(0, -1, 0);
      /** Height of the first surface straight below (x, 0.5, z) among the stage props and the grid's shadow catcher. */
      const surfaceAt = (/** @type {number} */ x, /** @type {number} */ z) => {
        const targets = [...v.stage.object.children.filter((o) => o.name !== 'stage-dome')];
        if (v.viewer.ground.shadowPlane.visible) targets.push(v.viewer.ground.shadowPlane);
        scene.updateMatrixWorld(true);
        ray.set(new THREE.Vector3(x, 0.5, z), down);
        const hit = ray.intersectObjects(targets, false)[0];
        return hit ? hit.point.y : NaN;
      };
      const gl = v.viewer.renderer.getContext();
      const parts = [];
      try {
        for (const { id } of SCENE_PRESETS) {
          const applied = v.setStage({ preset: id });
          assert(applied.preset === id && applied.background === null, id + ': applied ' + JSON.stringify(applied));
          // the mannequin stands at y = 0 whatever the scene
          const y = surfaceAt(0, 0);
          assert(Math.abs(y) < 1e-3, id + ': the surface under the feet is at y = ' + y);
          const isGrid = STAGE_PRESETS[id].floor === 'grid';
          assert(v.viewer.ground.grid.visible === isGrid && v.viewer.ground.shadowPlane.visible === isGrid, id + ': grid visibility');
          assert(isGrid ? scene.fog === null : (scene.fog && scene.fog.near > 5), id + ': fog must be off on the grid and start past the body elsewhere');
          const expectFloor = id === 'pedestal' ? -PEDESTAL_H : id === 'runway' ? -RUNWAY_H : 0;
          assert(Math.abs(v.stage.floorY() - expectFloor) < 1e-9, id + ': floorY ' + v.stage.floorY());
          if (!isGrid) {
            const yAway = surfaceAt(3, -3);                              // off the pedestal / runway
            assert(Math.abs(yAway - expectFloor) < 1e-3, id + ': floor away from the body at y = ' + yAway);
          }
          v.viewer.render();
          assert(gl.getError() === gl.NO_ERROR, id + ': GL error after render');
          parts.push(id);
        }
        // a custom colour becomes the backdrop and the fog, so the floor still fades into it
        const c = v.setStage({ preset: 'studio', background: '#123456' });
        assert(c.background === '#123456' && scene.background.getHexString() === '123456' && scene.fog.color.getHexString() === '123456', 'custom background');
        const w = v.setStage({ preset: 'workshop', background: '#654321' });
        assert(scene.background.getHexString() === '654321' && scene.fog === null, 'custom background on the grid scene');
        // a dark custom colour stays dark at the zenith (the 14 % lightening is in sRGB, not linear light)
        v.setStage({ preset: 'dark', background: '#000000' });
        const dome = v.stage.object.getObjectByName('stage-dome');
        const col = dome.geometry.getAttribute('color'), dp = dome.geometry.getAttribute('position');
        let top = 0;
        for (let i = 1; i < dp.count; i++) if (dp.getY(i) > dp.getY(top)) top = i;
        const zen = new THREE.Color(col.getX(top), col.getY(top), col.getZ(top)).getHexString();
        assert(parseInt(zen.slice(0, 2), 16) < 0x30, 'a black backdrop must keep a dark zenith, got #' + zen);
        // a pan cannot carry the orbit target or the camera below a solid floor
        v.setStage({ preset: 'studio' });
        const cam = v.viewer.camera, ctl = v.viewer.controls;
        const keepT = ctl.target.clone(), keepP = cam.position.clone();
        ctl.target.set(0, -1.2, 0); cam.position.set(0, -0.6, 3);
        v.render();
        assert(ctl.target.y >= 0.049 && cam.position.y >= 0.049, 'camera under the floor: target ' + ctl.target.y.toFixed(3) + ', camera ' + cam.position.y.toFixed(3));
        v.setStage({ preset: 'workshop' });
        ctl.target.set(0, -1.2, 0); cam.position.set(0, -0.6, 3);
        v.render();
        assert(ctl.target.y < 0, 'the grid scene must still allow looking from below');
        ctl.target.copy(keepT); cam.position.copy(keepP); ctl.update();
        // anything unknown falls back to the default rather than failing
        const bad = v.setStage({ preset: 'moon', background: 'red' });
        assert(bad.preset === 'workshop' && bad.background === null && v.viewer.ground.grid.visible, 'unknown preset must fall back: ' + JSON.stringify(bad));
        assert(w.preset === 'workshop', 'workshop');
      } finally {
        v.setStage({ preset: 'workshop' });
      }
      return parts.length + ' scenes, all standing at y = 0';
    });

    await check('tears.overlay', () => {
      // Markers are a diagnostic: always drawn on top (no depth test), coloured amber -> red by severity,
      // hidden when there is nothing to show.
      const t = createTearMarks();
      try {
        assert(t.object.visible === false && t.count() === 0, 'a fresh overlay must be empty and hidden');
        t.setMarks([
          { x: 0, y: 1.2, z: 0.1, severity: 0, kind: 'strain', value: 0.31 },
          { x: 0.1, y: 1.1, z: 0.1, severity: 1, kind: 'seam', value: 12 },
        ]);
        assert(t.count() === 2 && t.object.visible === true, 'two marks must show, count ' + t.count());
        const mat = /** @type {any} */ (t.object.material);
        assert(mat.depthTest === false, 'markers must draw through the body (depthTest off)');
        const col = /** @type {any} */ (t.object.geometry.getAttribute('color')).array;
        const lo = new THREE.Color(MARK_COLORS.low), hi = new THREE.Color(MARK_COLORS.high);
        assert(Math.abs(col[0] - lo.r) < 1e-6 && Math.abs(col[1] - lo.g) < 1e-6 && Math.abs(col[3] - hi.r) < 1e-6 && Math.abs(col[4] - hi.g) < 1e-6,
          'severity 0 must be the low colour and 1 the high colour');
        t.setVisible(false);
        assert(t.object.visible === false, 'setVisible(false) must hide');
        t.setVisible(true);
        assert(t.object.visible === true, 'setVisible(true) must show marks again');
        t.setMarks([]);
        assert(t.count() === 0 && t.object.visible === false, 'clearing must hide');
        t.setVisible(true);
        assert(t.object.visible === false, 'setVisible(true) with no marks must stay hidden');
        if (v && typeof v.setTears === 'function') {
          v.setTears([{ x: 0, y: 1, z: 0.2, severity: 0.5, kind: 'strain', value: 0.4 }]);
          v.render();
          v.setTears(null);
        }
      } finally {
        t.dispose();
      }
      return 'visibility, colours, depthTest off, viewer.setTears';
    });

    await check('viewer.screenshot', () => {
      assert(v, 'no viewer');
      const url = v.screenshot();
      assert(url.startsWith('data:image/png'), `screenshot does not start with data:image/png (${url.slice(0, 20)})`);
      assert(url.length > 1000, `screenshot length ${url.length} <= 1000`);
      return `length ${url.length}`;
    });

    await check('viewer.dispose', () => {
      assert(v, 'no viewer');
      v.dispose();
      const vv = v;
      v = null;
      if (ownsCaches) {
        assert(materialCacheSize() === 0, `materialCacheSize ${materialCacheSize()} !== 0`);
        assert(textureCacheSize() === 0, `textureCacheSize ${textureCacheSize()} !== 0`);
      }
      assert(!container.querySelector('canvas'), 'container still has a canvas child');
      assert(vv.loop.isRunning() === false, 'loop still running');
    });
  } finally {
    try { if (v) v.dispose(); } catch (_e) { /* ignore */ }
    if (container.parentNode) container.parentNode.removeChild(container);
  }
  return results;
}
