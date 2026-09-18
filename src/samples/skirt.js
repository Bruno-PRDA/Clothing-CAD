// src/samples/skirt.js — built-in sample: pull-on A-line skirt (SPEC section 4.3).
// Pure data; imports nothing. Drafted for body preset female_m at size M; top edge = hips + 4 cm ease,
// pinned to the body at the 'skirt' anchor origin (waist) after arrangement.

/** @type {import('../core/types.js').ProjectDoc} */
export const SKIRT = {
  version: 1,
  name: 'A-line skirt',
  body: {
    preset: 'female_m',
    params: {
      height_cm: 165, chest_cm: 88, underbust_cm: 76, waist_cm: 70, hips_cm: 96,
      shoulderWidth_cm: 38, neck_cm: 34, upperArm_cm: 27, forearm_cm: 23, wrist_cm: 15.5,
      thigh_cm: 54, calf_cm: 36, ankle_cm: 22, armLength_cm: 56, inseam_cm: 76,
      torsoLength_cm: 40, headHeight_cm: 22, bustFullness: 0.4, armAbduction_deg: 30, legSpread_deg: 6,
      weight_kg: 58.5, muscle: 0.35, age_y: 30, sex: 1,
    },
  },
  fabrics: [
    {
      id: 'main', name: 'Main (denim)', preset: 'denim', color: '#3b5b8c',
      texture: { kind: 'twill', scale_mm: 4, color2: '#2c4468' },
      overrides: {},
    },
  ],
  pieces: [
    {
      id: 'front', name: 'Front',
      vertices: [[0, 0], [320, 30], [250, 565], [0, 550]],
      edges: [
        { type: 'cubic', c1: [110, 0], c2: [215, 16], allowance_mm: 25, label: 'hem' },     // e0 CF hem -> side hem
        { type: 'line', allowance_mm: 10, label: 'side' },                                    // e1 side hem -> side waist
        { type: 'cubic', c1: [170, 554], c2: [85, 550], allowance_mm: 10, label: 'waist' },  // e2 side waist -> CF waist
        { type: 'line', allowance_mm: 0, label: 'fold' },                                     // e3 CF waist -> CF hem (fold)
      ],
      foldEdge: 3,
      notches: [{ edge: 1, t: 0.5, kind: 'single' }],
      grainline: { a: [120, 80], b: [120, 480] },
      internalLines: [],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 1,
      exportHidden: false,
      simulate: true,
      pinnedEdges: [2],
      placement: { anchor: 'skirt', side: 'front', offset_mm: [0, 0], wrap: 0.8, flip: false },
      grade: { widthRef: 'hips_cm', lengthRef: 'height_cm', anchorX: 'fold', anchorY: 'top', vertexRules: [] },
      meshSpacing_mm: 15,
    },
    {
      id: 'back', name: 'Back',
      vertices: [[0, 0], [320, 30], [250, 565], [0, 550]],
      edges: [
        { type: 'cubic', c1: [110, 0], c2: [215, 16], allowance_mm: 25, label: 'hem' },     // e0 CB hem -> side hem
        { type: 'line', allowance_mm: 10, label: 'side' },                                    // e1 side hem -> side waist
        { type: 'cubic', c1: [170, 554], c2: [85, 550], allowance_mm: 10, label: 'waist' },  // e2 side waist -> CB waist
        { type: 'line', allowance_mm: 0, label: 'fold' },                                     // e3 CB waist -> CB hem (fold)
      ],
      foldEdge: 3,
      notches: [{ edge: 1, t: 0.5, kind: 'double' }],
      grainline: { a: [120, 80], b: [120, 480] },
      internalLines: [],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 1,
      exportHidden: false,
      simulate: true,
      pinnedEdges: [2],
      placement: { anchor: 'skirt', side: 'back', offset_mm: [0, 0], wrap: 0.8, flip: false },
      grade: { widthRef: 'hips_cm', lengthRef: 'height_cm', anchorX: 'fold', anchorY: 'top', vertexRules: [] },
      meshSpacing_mm: 15,
    },
  ],
  seams: [
    // side seams: front.e1 and back.e1 both run hem -> waist
    { id: 'side_L', kind: 'plain',
      a: { pieceId: 'front', edge: 1, mirror: false, reverse: false },
      b: { pieceId: 'back', edge: 1, mirror: true, reverse: false } },
    { id: 'side_R', kind: 'plain',
      a: { pieceId: 'front', edge: 1, mirror: true, reverse: false },
      b: { pieceId: 'back', edge: 1, mirror: false, reverse: false } },
  ],
  sizes: {
    measurements: ['chest_cm', 'waist_cm', 'hips_cm', 'height_cm', 'torsoLength_cm', 'armLength_cm', 'shoulderWidth_cm'],
    baseSize: 'M',
    rows: [
      { name: 'S', chest_cm: 84, waist_cm: 66, hips_cm: 92, height_cm: 160, torsoLength_cm: 39, armLength_cm: 55, shoulderWidth_cm: 37 },
      { name: 'M', chest_cm: 88, waist_cm: 70, hips_cm: 96, height_cm: 165, torsoLength_cm: 40, armLength_cm: 56, shoulderWidth_cm: 38 },
      { name: 'L', chest_cm: 92, waist_cm: 74, hips_cm: 100, height_cm: 170, torsoLength_cm: 41, armLength_cm: 57, shoulderWidth_cm: 39 },
      { name: 'XL', chest_cm: 96, waist_cm: 78, hips_cm: 104, height_cm: 175, torsoLength_cm: 42, armLength_cm: 58, shoulderWidth_cm: 40 },
    ],
  },
  sim: { substeps: 10, gravity_ms2: 9.81, selfCollision: true, sewTime_s: 1.0, collisionOffset_mm: 5, bendScale: 1, stretchScale: 1 },
  ui: { split: 0.5, layout: 'split', swapped: false, activeSize: 'M', dockTab: 'pieces' },
};
