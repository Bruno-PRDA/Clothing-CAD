// src/samples/dress.js — built-in sample: sleeveless fitted dress with a waist seam (SPEC section 4, amendment "Darts").
// Pure data; imports nothing. Drafted for body preset female_m at size M: bust 88 + 6, waist 70 + 3, hips 96 + 5 cm.
// Pattern space: mm, y up, outlines CCW. Fold pieces store the x >= 0 half with the fold on x = 0; the backs are cut
// in two at centre back (CB at x = 0) with a zip, the '_l' piece a mirrored duplicate placed with flip.
// The bodice reuses the T-shirt's neck and shoulder draft (shifted so the waist is y = 0). L/R = the MODEL's left/right:
// on the front, the stored half is the model's left; an unflipped back half lies on the model's right.
// Every dart opens onto an edge. Each bodice panel's waist intake equals its skirt panel's (25 mm), so the waist seams
// match with and without the darts, and the waist corners grade with waist_cm on both sides of the seam.

/** @type {import('../core/types.js').ProjectDoc} */
export const DRESS = {
  version: 2,
  name: 'Fitted dress',
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
      id: 'main', name: 'Main (cotton)', preset: 'cotton', color: '#1f3a5f',
      texture: { kind: 'solid', scale_mm: 20, color2: '#ffffff' },
      overrides: {},
    },
  ],
  pieces: [
    {
      id: 'bodice_front', name: 'Bodice front',
      vertices: [[0, 0], [217.5, 0], [245, 215], [190, 370], [95, 400], [0, 242]],
      edges: [
        { type: 'line', allowance_mm: 10, label: 'waist' },                                     // e0 CF waist -> side waist
        { type: 'line', allowance_mm: 10, label: 'side' },                                      // e1 side waist -> armpit (bust dart)
        { type: 'cubic', c1: [205, 225], c2: [180, 300], allowance_mm: 6, label: 'armhole' },   // e2 armpit -> shoulder tip
        { type: 'line', allowance_mm: 10, label: 'shoulder' },                                  // e3 shoulder tip -> neck point
        { type: 'cubic', c1: [95, 313.1], c2: [42.8, 242], allowance_mm: 6, label: 'neck' },    // e4 neck point -> CF neck
        { type: 'line', allowance_mm: 0, label: 'fold' },                                       // e5 CF neck -> CF waist (fold)
      ],
      foldEdge: 5,
      notches: [],
      grainline: { a: [120, 20], b: [120, 200] },
      internalLines: [],
      darts: [
        { id: 'waist_dart', edge: 0, t: 0.4, width_mm: 25, apex: [87, 140] },
        { id: 'bust_dart', edge: 1, t: 0.68, width_mm: 25, apex: [107, 158] },
      ],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 1,
      exportHidden: false,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'torso', side: 'front', offset_mm: [0, 0], wrap: 0.8, flip: false },
      grade: {
        widthRef: 'chest_cm', lengthRef: 'torsoLength_cm', anchorX: 'fold', anchorY: 'top',
        vertexRules: [
          { vertex: 1, dx_mm: 0, dy_mm: 0, ref: 'waist_cm', refAxis: 'x' },
          { vertex: 3, dx_mm: 0, dy_mm: 0, ref: 'shoulderWidth_cm', refAxis: 'x' },
        ],
      },
      meshSpacing_mm: 15,
    },
    {
      id: 'bodice_back_r', name: 'Bodice back',
      vertices: [[0, 0], [197.5, 0], [225, 190], [190, 370], [95, 400], [0, 357]],
      edges: [
        { type: 'line', allowance_mm: 10, label: 'waist' },                                     // e0 CB waist -> side waist
        { type: 'line', allowance_mm: 10, label: 'side' },                                      // e1 side waist -> armpit
        { type: 'cubic', c1: [200, 205], c2: [185, 300], allowance_mm: 6, label: 'armhole' },   // e2 armpit -> shoulder tip
        { type: 'line', allowance_mm: 10, label: 'shoulder' },                                  // e3 shoulder tip -> neck point
        { type: 'cubic', c1: [95, 376.4], c2: [42.8, 357], allowance_mm: 6, label: 'neck' },    // e4 neck point -> CB neck
        { type: 'line', allowance_mm: 15, label: 'zip' },                                       // e5 CB neck -> CB waist
      ],
      foldEdge: null,
      notches: [],
      grainline: { a: [110, 20], b: [110, 200] },
      internalLines: [],
      darts: [{ id: 'waist_dart', edge: 0, t: 0.45, width_mm: 25, apex: [89, 150] }],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 2,
      exportHidden: false,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'torso', side: 'back', offset_mm: [112.5, 0], wrap: 0.8, flip: false },
      grade: {
        widthRef: 'chest_cm', lengthRef: 'torsoLength_cm', anchorX: 'left', anchorY: 'top',
        vertexRules: [
          { vertex: 1, dx_mm: 0, dy_mm: 0, ref: 'waist_cm', refAxis: 'x' },
          { vertex: 3, dx_mm: 0, dy_mm: 0, ref: 'shoulderWidth_cm', refAxis: 'x' },
        ],
      },
      meshSpacing_mm: 15,
    },
    {
      id: 'bodice_back_l', name: 'Bodice back (mirror)',
      vertices: [[0, 0], [197.5, 0], [225, 190], [190, 370], [95, 400], [0, 357]],
      edges: [
        { type: 'line', allowance_mm: 10, label: 'waist' },
        { type: 'line', allowance_mm: 10, label: 'side' },
        { type: 'cubic', c1: [200, 205], c2: [185, 300], allowance_mm: 6, label: 'armhole' },
        { type: 'line', allowance_mm: 10, label: 'shoulder' },
        { type: 'cubic', c1: [95, 376.4], c2: [42.8, 357], allowance_mm: 6, label: 'neck' },
        { type: 'line', allowance_mm: 15, label: 'zip' },
      ],
      foldEdge: null,
      notches: [],
      grainline: { a: [110, 20], b: [110, 200] },
      internalLines: [],
      darts: [{ id: 'waist_dart', edge: 0, t: 0.45, width_mm: 25, apex: [89, 150] }],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 2,
      exportHidden: true,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'torso', side: 'back', offset_mm: [-112.5, 0], wrap: 0.8, flip: true },
      grade: {
        widthRef: 'chest_cm', lengthRef: 'torsoLength_cm', anchorX: 'left', anchorY: 'top',
        vertexRules: [
          { vertex: 1, dx_mm: 0, dy_mm: 0, ref: 'waist_cm', refAxis: 'x' },
          { vertex: 3, dx_mm: 0, dy_mm: 0, ref: 'shoulderWidth_cm', refAxis: 'x' },
        ],
      },
      meshSpacing_mm: 15,
    },
    {
      id: 'skirt_front', name: 'Skirt front',
      vertices: [[0, 0], [272, 0], [262.5, 350], [217.5, 550], [0, 550]],
      edges: [
        { type: 'line', allowance_mm: 25, label: 'hem' },                                       // e0 CF hem -> side hem
        { type: 'line', allowance_mm: 10, label: 'side' },                                      // e1 side hem -> hip
        { type: 'cubic', c1: [262.5, 440], c2: [237.5, 530], allowance_mm: 10, label: 'side' }, // e2 hip -> side waist
        { type: 'line', allowance_mm: 10, label: 'waist' },                                     // e3 side waist -> CF waist
        { type: 'line', allowance_mm: 0, label: 'fold' },                                       // e4 CF waist -> CF hem (fold)
      ],
      foldEdge: 4,
      notches: [],
      grainline: { a: [130, 60], b: [130, 480] },
      internalLines: [],
      darts: [{ id: 'waist_dart', edge: 3, t: 0.6, width_mm: 25, apex: [87, 450] }],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 1,
      exportHidden: false,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'skirt', side: 'front', offset_mm: [0, 0], wrap: 0.8, flip: false },
      grade: {
        widthRef: 'hips_cm', lengthRef: 'height_cm', anchorX: 'fold', anchorY: 'top',
        vertexRules: [{ vertex: 3, dx_mm: 0, dy_mm: 0, ref: 'waist_cm', refAxis: 'x' }],
      },
      meshSpacing_mm: 15,
    },
    {
      id: 'skirt_back_r', name: 'Skirt back',
      vertices: [[0, 0], [252, 0], [242.5, 350], [197.5, 550], [0, 550]],
      edges: [
        { type: 'line', allowance_mm: 25, label: 'hem' },                                       // e0 CB hem -> side hem
        { type: 'line', allowance_mm: 10, label: 'side' },                                      // e1 side hem -> hip
        { type: 'cubic', c1: [242.5, 440], c2: [217.5, 530], allowance_mm: 10, label: 'side' }, // e2 hip -> side waist
        { type: 'line', allowance_mm: 10, label: 'waist' },                                     // e3 side waist -> CB waist
        { type: 'line', allowance_mm: 15, label: 'cb' },                                        // e4 CB waist -> CB hem
      ],
      foldEdge: null,
      notches: [{ edge: 4, t: 0.35, kind: 'double' }],
      grainline: { a: [120, 60], b: [120, 480] },
      internalLines: [],
      darts: [{ id: 'waist_dart', edge: 3, t: 0.55, width_mm: 25, apex: [89, 420] }],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 2,
      exportHidden: false,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'skirt', side: 'back', offset_mm: [126, 0], wrap: 0.8, flip: false },
      grade: {
        widthRef: 'hips_cm', lengthRef: 'height_cm', anchorX: 'left', anchorY: 'top',
        vertexRules: [{ vertex: 3, dx_mm: 0, dy_mm: 0, ref: 'waist_cm', refAxis: 'x' }],
      },
      meshSpacing_mm: 15,
    },
    {
      id: 'skirt_back_l', name: 'Skirt back (mirror)',
      vertices: [[0, 0], [252, 0], [242.5, 350], [197.5, 550], [0, 550]],
      edges: [
        { type: 'line', allowance_mm: 25, label: 'hem' },
        { type: 'line', allowance_mm: 10, label: 'side' },
        { type: 'cubic', c1: [242.5, 440], c2: [217.5, 530], allowance_mm: 10, label: 'side' },
        { type: 'line', allowance_mm: 10, label: 'waist' },
        { type: 'line', allowance_mm: 15, label: 'cb' },
      ],
      foldEdge: null,
      notches: [{ edge: 4, t: 0.35, kind: 'double' }],
      grainline: { a: [120, 60], b: [120, 480] },
      internalLines: [],
      darts: [{ id: 'waist_dart', edge: 3, t: 0.55, width_mm: 25, apex: [89, 420] }],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 2,
      exportHidden: true,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'skirt', side: 'back', offset_mm: [-126, 0], wrap: 0.8, flip: true },
      grade: {
        widthRef: 'hips_cm', lengthRef: 'height_cm', anchorX: 'left', anchorY: 'top',
        vertexRules: [{ vertex: 3, dx_mm: 0, dy_mm: 0, ref: 'waist_cm', refAxis: 'x' }],
      },
      meshSpacing_mm: 15,
    },
  ],
  seams: [
    // shoulders: e3 runs shoulder tip -> neck point on every bodice piece
    { id: 'shoulder_L', kind: 'plain',
      a: { pieceId: 'bodice_front', edge: 3, mirror: false, reverse: false },
      b: { pieceId: 'bodice_back_l', edge: 3, mirror: false, reverse: false } },
    { id: 'shoulder_R', kind: 'plain',
      a: { pieceId: 'bodice_front', edge: 3, mirror: true, reverse: false },
      b: { pieceId: 'bodice_back_r', edge: 3, mirror: false, reverse: false } },
    // bodice sides: e1 runs waist -> armpit (the front's sewn length is 25 mm shorter than its cut length: the bust dart)
    { id: 'bodice_side_L', kind: 'plain',
      a: { pieceId: 'bodice_front', edge: 1, mirror: false, reverse: false },
      b: { pieceId: 'bodice_back_l', edge: 1, mirror: false, reverse: false } },
    { id: 'bodice_side_R', kind: 'plain',
      a: { pieceId: 'bodice_front', edge: 1, mirror: true, reverse: false },
      b: { pieceId: 'bodice_back_r', edge: 1, mirror: false, reverse: false } },
    // waist: the bodice waist runs toward the side, the skirt waist toward the centre => reverse
    { id: 'waist_front_L', kind: 'plain',
      a: { pieceId: 'bodice_front', edge: 0, mirror: false, reverse: false },
      b: { pieceId: 'skirt_front', edge: 3, mirror: false, reverse: true } },
    { id: 'waist_front_R', kind: 'plain',
      a: { pieceId: 'bodice_front', edge: 0, mirror: true, reverse: false },
      b: { pieceId: 'skirt_front', edge: 3, mirror: true, reverse: true } },
    { id: 'waist_back_L', kind: 'plain',
      a: { pieceId: 'bodice_back_l', edge: 0, mirror: false, reverse: false },
      b: { pieceId: 'skirt_back_l', edge: 3, mirror: false, reverse: true } },
    { id: 'waist_back_R', kind: 'plain',
      a: { pieceId: 'bodice_back_r', edge: 0, mirror: false, reverse: false },
      b: { pieceId: 'skirt_back_r', edge: 3, mirror: false, reverse: true } },
    // skirt sides: e1 hem -> hip and e2 hip -> waist on every skirt piece
    { id: 'skirt_side_low_L', kind: 'plain',
      a: { pieceId: 'skirt_front', edge: 1, mirror: false, reverse: false },
      b: { pieceId: 'skirt_back_l', edge: 1, mirror: false, reverse: false } },
    { id: 'skirt_side_up_L', kind: 'plain',
      a: { pieceId: 'skirt_front', edge: 2, mirror: false, reverse: false },
      b: { pieceId: 'skirt_back_l', edge: 2, mirror: false, reverse: false } },
    { id: 'skirt_side_low_R', kind: 'plain',
      a: { pieceId: 'skirt_front', edge: 1, mirror: true, reverse: false },
      b: { pieceId: 'skirt_back_r', edge: 1, mirror: false, reverse: false } },
    { id: 'skirt_side_up_R', kind: 'plain',
      a: { pieceId: 'skirt_front', edge: 2, mirror: true, reverse: false },
      b: { pieceId: 'skirt_back_r', edge: 2, mirror: false, reverse: false } },
    // centre back: both halves' CB edges run downwards => no reverse; the bodice's is the zip
    { id: 'cb_bodice', kind: 'plain',
      a: { pieceId: 'bodice_back_r', edge: 5, mirror: false, reverse: false },
      b: { pieceId: 'bodice_back_l', edge: 5, mirror: false, reverse: false } },
    { id: 'cb_skirt', kind: 'plain',
      a: { pieceId: 'skirt_back_r', edge: 4, mirror: false, reverse: false },
      b: { pieceId: 'skirt_back_l', edge: 4, mirror: false, reverse: false } },
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
  ui: { split: 0.5, layout: 'split', swapped: false, activeSize: 'M', dockTab: 'pieces', scene: { preset: 'workshop', background: null } },
};
