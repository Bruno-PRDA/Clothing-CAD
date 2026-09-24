// src/viewer3d/stage.js — the set the body stands in: backdrop, floor, props, fog and light balance.
//
// Presets are chosen by id (the list of ids and labels is data in src/core/schema.js, SCENE_PRESETS, so the
// UI can offer them without loading three.js); the look of each one lives here. Every preset keeps the
// surface the mannequin stands on at y = 0, because the body is grounded there (templateModel.ground):
// flat floors sit at 0, and a pedestal or runway puts its TOP at 0 and drops the floor under it.
//
// The backdrop is a large inverted dome coloured by height and the floor a disc of the same radius; fog of
// the horizon colour makes the floor fade into the backdrop, so there is no visible edge anywhere a camera
// can go. The fog starts at 8 m — the body at the default framing is ~3.7-4.4 m away and never fogs.
// Two details keep the seam invisible: the dome is NOT tone-mapped (fog and the background colour are
// applied after tone mapping, so a tone-mapped dome is always a shade darker than the fogged floor meeting
// it), and floors reflect the room environment at FLOOR_ENV strength (a glossy floor mirrors it at grazing
// angles, which is exactly where it meets the horizon). The floor materials carry scene.environment as their
// OWN envMap for that: with only the scene's environment, three.js r163+ ignores material.envMapIntensity
// and uses scene.environmentIntensity, so the setting silently did nothing (found in review, 2026-09-24).
//
// With a solid floor the camera is kept above it: the orbit limit stops it circling under, and clampCamera
// (called by the facade every frame) stops a pan from carrying the target and the camera below the floor.

import * as THREE from 'three';

/** @typedef {{preset: string, background: string|null}} SceneSpec */

/** Radius of the backdrop dome and of the floor disc, metres. */
export const DOME_R = 40;
/** Fog range, metres from the camera. */
export const FOG_NEAR = 8;
export const FOG_FAR = 30;
/** Height of the pedestal and of the runway; their top is at y = 0. */
export const PEDESTAL_H = 0.10;
export const RUNWAY_H = 0.14;
/**
 * Orbit limit with a solid floor (fraction of pi): horizontal, so the camera stays at or above the orbit
 * target (chest height) and cannot pass under the floor at any zoom. 0.56 looked fine at the default
 * distance but put the camera 1.6 m under the floor when zoomed out to the 15 m limit.
 */
export const MAX_POLAR_SOLID = 0.5;
export const MAX_POLAR_OPEN = 0.95;
/** How much of the environment map the floors reflect (see the header). */
const FLOOR_ENV = 0.35;
/** Lowest the camera and the orbit target may go above a solid floor, metres. */
export const CAMERA_CLEARANCE = 0.05;

/**
 * @typedef {Object} StagePreset
 * @property {[string, string]|null} sky   [zenith, horizon] of the dome, or null for a flat colour
 * @property {string} background          flat background colour (the horizon colour when there is a sky)
 * @property {'grid'|'plain'|'pedestal'|'runway'|'wood'|'paving'} floor
 * @property {string} [floorColor]
 * @property {number} [roughness]
 * @property {string} [propColor]
 * @property {number} exposure            renderer tone-mapping exposure
 * @property {number} hemi                hemisphere light intensity
 */

/** @type {Readonly<Record<string, StagePreset>>} */
export const STAGE_PRESETS = Object.freeze({
  // The original look, byte for byte: flat backdrop, grid, shadow catcher.
  workshop: Object.freeze({ sky: null, background: '#2a2e35', floor: 'grid', exposure: 1.0, hemi: 0.9 }),
  studio: Object.freeze({
    sky: ['#fbfbfc', '#dde0e5'], background: '#dde0e5', floor: 'plain', floorColor: '#e2e4e8', roughness: 0.92,
    exposure: 0.95, hemi: 1.0,
  }),
  dark: Object.freeze({
    sky: ['#3b404a', '#121418'], background: '#121418', floor: 'plain', floorColor: '#1c1e23', roughness: 0.55,
    exposure: 1.05, hemi: 0.7,
  }),
  pedestal: Object.freeze({
    sky: ['#f5f3f0', '#d6d1ca'], background: '#d6d1ca', floor: 'pedestal', floorColor: '#cbc6be', roughness: 0.9,
    propColor: '#f3f1ed', exposure: 0.95, hemi: 1.0,
  }),
  runway: Object.freeze({
    sky: ['#22252d', '#060709'], background: '#060709', floor: 'runway', floorColor: '#0c0d10', roughness: 0.6,
    propColor: '#cfcfd4', exposure: 1.1, hemi: 0.6,
  }),
  wood: Object.freeze({
    sky: ['#f3ece2', '#cfc0ab'], background: '#cfc0ab', floor: 'wood', roughness: 0.62, exposure: 1.0, hemi: 1.0,
  }),
  terrace: Object.freeze({
    sky: ['#5ea8ff', '#dbeeff'], background: '#dbeeff', floor: 'paving', roughness: 0.85, exposure: 1.05, hemi: 1.1,
  }),
});

export const DEFAULT_STAGE = 'workshop';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * A valid spec for any input: unknown presets fall back to the default, a background that is not #rrggbb is dropped.
 * @param {any} spec @returns {SceneSpec}
 */
export function normalizeStageSpec(spec) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const preset = typeof s.preset === 'string' && Object.prototype.hasOwnProperty.call(STAGE_PRESETS, s.preset) ? s.preset : DEFAULT_STAGE;
  const background = typeof s.background === 'string' && HEX_RE.test(s.background) ? s.background.toLowerCase() : null;
  return { preset, background };
}

// ------------------------------------------------------------------------------------------ textures

/** Small deterministic PRNG, so a floor looks the same on every load. @param {number} seed */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {number} r @param {number} g @param {number} b @returns {string} */
const rgb = (r, g, b) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

/** Oak planks, 8 rows of 64 px, staggered joints and grain. One texture covers 1.6 m. */
function woodCanvas() {
  const N = 512, rows = 8, h = N / rows;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const rand = rng(7);
  for (let r = 0; r < rows; r++) {
    let x = -Math.floor(rand() * 200);
    while (x < N) {
      const len = 180 + Math.floor(rand() * 220);
      const tone = 0.9 + rand() * 0.2;
      g.fillStyle = rgb(176 * tone, 128 * tone, 84 * tone);
      g.fillRect(x, r * h, len, h);
      // grain: a few long wavering darker lines along the plank
      g.strokeStyle = rgb(130 * tone, 90 * tone, 56 * tone);
      g.globalAlpha = 0.35;
      g.lineWidth = 1;
      for (let k = 0; k < 7; k++) {
        const y0 = r * h + 4 + rand() * (h - 8);
        const amp = 1 + rand() * 2.5, ph = rand() * 6, fr = 0.01 + rand() * 0.02;
        g.beginPath();
        for (let xx = Math.max(0, x); xx <= Math.min(N, x + len); xx += 6) {
          const yy = y0 + amp * Math.sin(ph + xx * fr);
          if (xx === Math.max(0, x)) g.moveTo(xx, yy); else g.lineTo(xx, yy);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
      // end joint
      g.fillStyle = 'rgba(60,40,22,0.35)';
      g.fillRect(x, r * h, 2, h);
      x += len;
    }
    // long seam between rows
    g.fillStyle = 'rgba(60,40,22,0.4)';
    g.fillRect(0, r * h, N, 2);
  }
  return cv;
}

/** Stone paving, 4 x 4 slabs of 128 px with grout. One texture covers 2 m. */
function pavingCanvas() {
  const N = 512, n = 4, s = N / n;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const rand = rng(11);
  g.fillStyle = '#8d8a84';
  g.fillRect(0, 0, N, N);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const tone = 0.88 + rand() * 0.2;
      g.fillStyle = rgb(196 * tone, 191 * tone, 182 * tone);
      g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
      // speckle
      for (let k = 0; k < 220; k++) {
        const t = 0.8 + rand() * 0.35;
        g.fillStyle = rgb(170 * t, 166 * t, 158 * t);
        g.fillRect(i * s + 3 + rand() * (s - 7), j * s + 3 + rand() * (s - 7), 2, 2);
      }
    }
  }
  return cv;
}

/**
 * @param {HTMLCanvasElement} cv @param {number} repeat @param {THREE.WebGLRenderer|null} renderer
 * @returns {THREE.CanvasTexture}
 */
function tiled(cv, repeat, renderer) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer && renderer.capabilities ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  return t;
}

// ------------------------------------------------------------------------------------------ the stage

/**
 * @typedef {Object} StageHandle
 * @property {THREE.Group} object          the props (dome, floor, pedestal, runway), added to viewer.scene
 * @property {(spec: any) => SceneSpec} set  apply a preset (+ optional background colour); returns the normalised spec
 * @property {() => SceneSpec} current
 * @property {() => number} floorY         height of the lowest floor (below the pedestal/runway), metres
 * @property {(camera: THREE.Camera, controls: any) => void} clampCamera  keep camera and target above a solid floor
 * @property {() => void} dispose
 */

/**
 * @param {{scene: THREE.Scene, renderer?: THREE.WebGLRenderer, lights?: any, ground?: any, controls?: any}} viewer
 * @returns {StageHandle}
 */
export function createStage(viewer) {
  const scene = viewer.scene;
  const renderer = viewer.renderer || null;
  const group = new THREE.Group();
  group.name = 'stage';
  scene.add(group);
  /** @type {SceneSpec} */
  let spec = { preset: DEFAULT_STAGE, background: null };
  let floorLevel = 0;
  /** @type {{geometries: THREE.BufferGeometry[], materials: THREE.Material[], textures: THREE.Texture[]}} */
  let owned = { geometries: [], materials: [], textures: [] };

  function clear() {
    for (const c of group.children.slice()) group.remove(c);
    for (const g of owned.geometries) g.dispose();
    for (const m of owned.materials) m.dispose();
    for (const t of owned.textures) t.dispose();
    owned = { geometries: [], materials: [], textures: [] };
  }

  /** @template {THREE.BufferGeometry} G @param {G} g @returns {G} */
  const geo = (g) => { owned.geometries.push(g); return g; };
  /** @template {THREE.Material} M @param {M} m @returns {M} */
  const mat = (m) => { owned.materials.push(m); return m; };

  /**
   * Lighten (+) or darken (-) by f of the way to white/black, in sRGB, as the eye sees it. THREE.Color works in
   * linear light, where the same 14 % turned a black backdrop into a #686868 zenith.
   * @param {string} hex @param {number} f
   */
  function shade(hex, f) {
    const o = { r: 0, g: 0, b: 0 };
    new THREE.Color(hex).getRGB(o, THREE.SRGBColorSpace);
    const t = f >= 0 ? 1 : 0, k = Math.abs(f);
    return new THREE.Color().setRGB(o.r + (t - o.r) * k, o.g + (t - o.g) * k, o.b + (t - o.b) * k, THREE.SRGBColorSpace);
  }

  /** Inverted dome, coloured by height: horizon colour at and below 0, easing to the zenith colour. */
  function dome(top, horizon) {
    const g = geo(new THREE.SphereGeometry(DOME_R, 48, 24));
    const pos = g.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const cTop = new THREE.Color(top), cHor = new THREE.Color(horizon), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / DOME_R);
      const s = Math.min(1, t / 0.6);
      c.copy(cHor).lerp(cTop, s * s * (3 - 2 * s));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = mat(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false }));
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'stage-dome';
    mesh.renderOrder = -1000;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Floor disc at height y. @param {number} y @param {THREE.MeshStandardMaterialParameters} params */
  function floorDisc(y, params) {
    const m = mat(new THREE.MeshStandardMaterial(Object.assign({ metalness: 0, envMap: scene.environment || null, envMapIntensity: FLOOR_ENV }, params)));
    const mesh = new THREE.Mesh(geo(new THREE.CircleGeometry(DOME_R - 0.5, 128)), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.receiveShadow = true;
    mesh.name = 'stage-floor';
    return mesh;
  }

  /** @param {any} next @returns {SceneSpec} */
  function set(next) {
    spec = normalizeStageSpec(next);
    const P = STAGE_PRESETS[spec.preset];
    clear();

    const grid = viewer.ground && viewer.ground.grid;
    const shadowPlane = viewer.ground && viewer.ground.shadowPlane;
    const isGrid = P.floor === 'grid';
    if (grid) grid.visible = isGrid;
    if (shadowPlane) shadowPlane.visible = isGrid;
    floorLevel = 0;

    // backdrop
    const bg = spec.background;
    if (P.sky && !bg) {
      group.add(dome(P.sky[0], P.sky[1]));
      scene.background = new THREE.Color(P.sky[1]);
    } else if (P.sky && bg) {
      // a custom colour keeps the dome, horizon = the colour, zenith a little lighter
      group.add(dome('#' + shade(bg, 0.14).getHexString(), bg));
      scene.background = new THREE.Color(bg);
    } else {
      scene.background = new THREE.Color(bg || P.background);
    }
    const horizon = bg || (P.sky ? P.sky[1] : P.background);
    scene.fog = isGrid ? null : new THREE.Fog(horizon, FOG_NEAR, FOG_FAR);

    // floor and props
    const diam = 2 * (DOME_R - 0.5);
    if (P.floor === 'plain') {
      group.add(floorDisc(0, { color: P.floorColor, roughness: P.roughness }));
    } else if (P.floor === 'wood') {
      const t = tiled(woodCanvas(), diam / 1.6, renderer);
      owned.textures.push(t);
      group.add(floorDisc(0, { color: '#ffffff', map: t, roughness: P.roughness }));
    } else if (P.floor === 'paving') {
      const t = tiled(pavingCanvas(), diam / 2.0, renderer);
      owned.textures.push(t);
      group.add(floorDisc(0, { color: '#ffffff', map: t, roughness: P.roughness }));
    } else if (P.floor === 'pedestal') {
      floorLevel = -PEDESTAL_H;
      group.add(floorDisc(floorLevel, { color: P.floorColor, roughness: P.roughness }));
      const top = mat(new THREE.MeshStandardMaterial({ color: P.propColor, roughness: 0.45, metalness: 0 }));
      const dais = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.42, 0.46, PEDESTAL_H, 96)), top);
      dais.position.y = -PEDESTAL_H / 2;
      dais.castShadow = true;
      dais.receiveShadow = true;
      dais.name = 'stage-pedestal';
      group.add(dais);
    } else if (P.floor === 'runway') {
      floorLevel = -RUNWAY_H;
      group.add(floorDisc(floorLevel, { color: P.floorColor, roughness: P.roughness }));
      const top = mat(new THREE.MeshStandardMaterial({ color: P.propColor, roughness: 0.35, metalness: 0, envMap: scene.environment || null, envMapIntensity: FLOOR_ENV }));
      const deck = new THREE.Mesh(geo(new THREE.BoxGeometry(1.3, RUNWAY_H, 14)), top);
      deck.position.set(0, -RUNWAY_H / 2, 3);
      deck.castShadow = true;
      deck.receiveShadow = true;
      deck.name = 'stage-runway';
      group.add(deck);
      const glow = mat(new THREE.MeshBasicMaterial({ color: '#fff4dc' }));
      for (const x of [-0.655, 0.655]) {
        const strip = new THREE.Mesh(geo(new THREE.BoxGeometry(0.012, 0.012, 14)), glow);
        strip.position.set(x, -0.006, 3);
        strip.name = 'stage-runway-light';
        group.add(strip);
      }
    }

    // light balance and camera limit
    if (renderer) renderer.toneMappingExposure = P.exposure;
    if (viewer.lights && viewer.lights.hemi) viewer.lights.hemi.intensity = P.hemi;
    if (viewer.controls && typeof viewer.controls.maxPolarAngle === 'number') {
      viewer.controls.maxPolarAngle = (isGrid ? MAX_POLAR_OPEN : MAX_POLAR_SOLID) * Math.PI;
    }
    return { ...spec };
  }

  /**
   * Keep the orbit target and the camera above a solid floor (no-op on the grid scene, where looking at a
   * garment from underneath is allowed). Called every frame before rendering.
   * @param {THREE.Camera} camera @param {{target?: THREE.Vector3}} controls
   */
  function clampCamera(camera, controls) {
    if (STAGE_PRESETS[spec.preset].floor === 'grid') return;
    const minY = floorLevel + CAMERA_CLEARANCE;
    if (controls && controls.target && controls.target.y < minY) controls.target.y = minY;
    if (camera.position.y < minY) camera.position.y = minY;
  }

  function dispose() {
    clear();
    scene.remove(group);
    scene.fog = null;
  }

  set(spec);
  return { object: group, set, clampCamera, current: () => ({ ...spec }), floorY: () => floorLevel, dispose };
}
