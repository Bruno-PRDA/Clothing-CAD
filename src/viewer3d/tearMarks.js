// src/viewer3d/tearMarks.js — the markers that point at where a garment is failing.
//
// Drawn as screen-facing sprites with depth testing OFF and a high render order, so a tear on the far
// side of the body is still visible. That is deliberate: this is a diagnostic overlay, and a marker
// you have to orbit around to discover does not do its job. Colour runs amber -> red with severity.

import * as THREE from 'three';

/** @typedef {import('../cloth/tears.js').TearMark} TearMark */

export const MARK_COLORS = Object.freeze({ low: '#ffcc3d', high: '#ff3b30' });
/**
 * World size of a marker, in metres. Sized to be legible at the default framing, where the whole body
 * is only a few hundred pixels tall: at 30 mm a marker is about four pixels and invisible, which is
 * how a working overlay can look like a broken one. Size attenuation keeps it proportionate as you
 * zoom in on the failure.
 */
export const MARK_SIZE = 0.055;

let sprite = null;

/** A soft ring: reads as "look here" rather than as a particle. Built once, shared. */
function ringTexture() {
  if (sprite) return sprite;
  const N = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, N, N);
  g.strokeStyle = '#ffffff';
  g.lineWidth = N * 0.16;
  g.beginPath();
  g.arc(N / 2, N / 2, N * 0.32, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 0.35;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(N / 2, N / 2, N * 0.18, 0, Math.PI * 2);
  g.fill();
  sprite = new THREE.CanvasTexture(cv);
  sprite.colorSpace = THREE.SRGBColorSpace;
  return sprite;
}

/**
 * @typedef {Object} TearMarksHandle
 * @property {THREE.Points} object
 * @property {(marks: TearMark[]|null) => void} setMarks
 * @property {(on: boolean) => void} setVisible
 * @property {() => number} count
 * @property {() => void} dispose
 */

/** @param {{size?: number}} [opts] @returns {TearMarksHandle} */
export function createTearMarks(opts = {}) {
  const size = Number.isFinite(opts.size) ? Number(opts.size) : MARK_SIZE;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
  const mat = new THREE.PointsMaterial({
    size, sizeAttenuation: true, map: ringTexture(), transparent: true,
    alphaTest: 0.05, depthTest: false, depthWrite: false, vertexColors: true,
  });
  const object = new THREE.Points(geo, mat);
  object.name = 'tearMarks';
  object.renderOrder = 999;
  object.frustumCulled = false;
  object.visible = false;

  const lo = new THREE.Color(MARK_COLORS.low);
  const hi = new THREE.Color(MARK_COLORS.high);
  const tmp = new THREE.Color();
  let n = 0;

  /** @param {TearMark[]|null} marks */
  function setMarks(marks) {
    const list = Array.isArray(marks) ? marks : [];
    n = list.length;
    if (n === 0) { object.visible = false; return; }
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const m = list[i];
      pos[i * 3] = m.x; pos[i * 3 + 1] = m.y; pos[i * 3 + 2] = m.z;
      tmp.copy(lo).lerp(hi, Math.min(1, Math.max(0, m.severity)));
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    object.visible = true;
  }

  return {
    object, setMarks,
    setVisible: (on) => { object.visible = !!on && n > 0; },
    count: () => n,
    dispose: () => { geo.dispose(); mat.dispose(); },
  };
}
