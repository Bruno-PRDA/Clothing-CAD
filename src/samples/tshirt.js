// src/samples/tshirt.js — built-in sample: basic set-in-sleeve T-shirt (SPEC section 4.2).
// Pure data; imports nothing. Drafted for body preset female_m at size M with 8 cm chest ease.
// Pattern space: mm, y up, outlines CCW; fold pieces store the x >= 0 half with the fold edge on x = 0.
// Seam ids: L/R = the MODEL's left/right (3D +x / -x).

/** @type {import('../core/types.js').ProjectDoc} */
export const TSHIRT = {
  version: 1,
  name: 'Basic T-shirt',
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
      id: 'main', name: 'Main (cotton)', preset: 'cotton', color: '#c8102e',
      texture: { kind: 'solid', scale_mm: 20, color2: '#ffffff' },
      overrides: {},
    },
  ],
  pieces: [
    {
      id: 'front', name: 'Front',
      vertices: [[0, 0], [280, 0], [264, 360], [200, 555], [95, 588], [0, 430]],
      edges: [
        { type: 'line', allowance_mm: 25, label: 'hem' },                                       // e0 CF hem -> side hem
        { type: 'line', allowance_mm: 10, label: 'side' },                                      // e1 side hem -> armpit
        { type: 'cubic', c1: [184, 445], c2: [178, 505], allowance_mm: 10, label: 'armhole' },  // e2 armpit -> shoulder tip
        { type: 'line', allowance_mm: 10, label: 'shoulder' },                                  // e3 shoulder tip -> neck point
        { type: 'cubic', c1: [95, 501.1], c2: [42.8, 430], allowance_mm: 6, label: 'neck' },    // e4 neck point -> CF neck
        { type: 'line', allowance_mm: 0, label: 'fold' },                                       // e5 CF neck -> CF hem (fold)
      ],
      foldEdge: 5,
      notches: [{ edge: 2, t: 0.5, kind: 'single' }],
      grainline: { a: [120, 100], b: [120, 450] },
      internalLines: [],
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
        // v3 is the shoulder tip: it follows SHOULDER width, not chest width. Chest grades 4 cm a size
        // and shoulders about 1 cm, so scaling the whole panel by the chest throws the shoulder seam
        // out by roughly 1.5 cm a size — outward here, which sounds harmless but drags the armhole
        // over the shoulder ridge where the cap seam then cannot stay closed.
        vertexRules: [
          { vertex: 3, dx_mm: 0, dy_mm: 0, ref: 'shoulderWidth_cm', refAxis: 'x' },
          { vertex: 4, dx_mm: -1.5, dy_mm: 0 },
        ],
      },
      meshSpacing_mm: 15,
    },
    {
      id: 'back', name: 'Back',
      vertices: [[0, 0], [280, 0], [264, 360], [200, 555], [95, 588], [0, 545]],
      edges: [
        { type: 'line', allowance_mm: 25, label: 'hem' },                                       // e0 CB hem -> side hem
        { type: 'line', allowance_mm: 10, label: 'side' },                                      // e1 side hem -> armpit
        { type: 'cubic', c1: [184, 445], c2: [178, 505], allowance_mm: 10, label: 'armhole' },  // e2 armpit -> shoulder tip
        { type: 'line', allowance_mm: 10, label: 'shoulder' },                                  // e3 shoulder tip -> neck point
        { type: 'cubic', c1: [95, 564.4], c2: [42.8, 545], allowance_mm: 6, label: 'neck' },    // e4 neck point -> CB neck
        { type: 'line', allowance_mm: 0, label: 'fold' },                                       // e5 CB neck -> CB hem (fold)
      ],
      foldEdge: 5,
      notches: [{ edge: 2, t: 0.5, kind: 'double' }],
      grainline: { a: [120, 100], b: [120, 450] },
      internalLines: [],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 1,
      exportHidden: false,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'torso', side: 'back', offset_mm: [0, 0], wrap: 0.8, flip: false },
      grade: {
        widthRef: 'chest_cm', lengthRef: 'torsoLength_cm', anchorX: 'fold', anchorY: 'top',
        // v3 is the shoulder tip: it follows SHOULDER width, not chest width. Chest grades 4 cm a size
        // and shoulders about 1 cm, so scaling the whole panel by the chest throws the shoulder seam
        // out by roughly 1.5 cm a size — outward here, which sounds harmless but drags the armhole
        // over the shoulder ridge where the cap seam then cannot stay closed.
        vertexRules: [
          { vertex: 3, dx_mm: 0, dy_mm: 0, ref: 'shoulderWidth_cm', refAxis: 'x' },
          { vertex: 4, dx_mm: -1.5, dy_mm: 0 },
        ],
      },
      meshSpacing_mm: 15,
    },
    {
      id: 'sleeve_l', name: 'Sleeve',
      vertices: [[-160, 0], [160, 0], [170, 190], [0, 323.3], [-170, 190]],
      edges: [
        { type: 'line', allowance_mm: 25, label: 'hem' },                                          // e0 hem
        { type: 'line', allowance_mm: 10, label: 'underarm' },                                     // e1 hem -> armpit (x>0)
        { type: 'cubic', c1: [120, 206.1], c2: [60, 312.2], allowance_mm: 10, label: 'cap back' },     // e2 armpit (x>0) -> apex
        { type: 'cubic', c1: [-60, 312.2], c2: [-120, 206.1], allowance_mm: 10, label: 'cap front' },  // e3 apex -> armpit (x<0)
        { type: 'line', allowance_mm: 10, label: 'underarm' },                                     // e4 armpit (x<0) -> hem
      ],
      foldEdge: null,
      notches: [{ edge: 2, t: 0.5, kind: 'double' }, { edge: 3, t: 0.5, kind: 'single' }],
      grainline: { a: [0, 30], b: [0, 250] },
      internalLines: [],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 2,
      exportHidden: false,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'armL', side: 'left', offset_mm: [0, 20], wrap: 1, flip: false },
      grade: { widthRef: 'chest_cm', lengthRef: 'armLength_cm', anchorX: 'center', anchorY: 'top', vertexRules: [] },
      meshSpacing_mm: 15,
    },
    {
      id: 'sleeve_r', name: 'Sleeve (mirror)',
      vertices: [[-160, 0], [160, 0], [170, 190], [0, 323.3], [-170, 190]],
      edges: [
        { type: 'line', allowance_mm: 25, label: 'hem' },                                          // e0 hem
        { type: 'line', allowance_mm: 10, label: 'underarm' },                                     // e1 hem -> armpit (x>0)
        { type: 'cubic', c1: [120, 206.1], c2: [60, 312.2], allowance_mm: 10, label: 'cap back' },     // e2 armpit (x>0) -> apex
        { type: 'cubic', c1: [-60, 312.2], c2: [-120, 206.1], allowance_mm: 10, label: 'cap front' },  // e3 apex -> armpit (x<0)
        { type: 'line', allowance_mm: 10, label: 'underarm' },                                     // e4 armpit (x<0) -> hem
      ],
      foldEdge: null,
      notches: [{ edge: 2, t: 0.5, kind: 'double' }, { edge: 3, t: 0.5, kind: 'single' }],
      grainline: { a: [0, 30], b: [0, 250] },
      internalLines: [],
      seamAllowance_mm: 10,
      fabricId: 'main',
      layer: 0,
      cutQty: 2,
      exportHidden: true,
      simulate: true,
      pinnedEdges: [],
      placement: { anchor: 'armR', side: 'right', offset_mm: [0, 20], wrap: 1, flip: true },
      grade: { widthRef: 'chest_cm', lengthRef: 'armLength_cm', anchorX: 'center', anchorY: 'top', vertexRules: [] },
      meshSpacing_mm: 15,
    },
  ],
  seams: [
    // shoulder: front.e3 and back.e3 both run shoulder tip -> neck point
    { id: 'shoulder_L', kind: 'plain',
      a: { pieceId: 'front', edge: 3, mirror: false, reverse: false },
      b: { pieceId: 'back', edge: 3, mirror: true, reverse: false } },
    { id: 'shoulder_R', kind: 'plain',
      a: { pieceId: 'front', edge: 3, mirror: true, reverse: false },
      b: { pieceId: 'back', edge: 3, mirror: false, reverse: false } },
    // side: front.e1 and back.e1 both run hem -> armpit
    { id: 'side_L', kind: 'plain',
      a: { pieceId: 'front', edge: 1, mirror: false, reverse: false },
      b: { pieceId: 'back', edge: 1, mirror: true, reverse: false } },
    { id: 'side_R', kind: 'plain',
      a: { pieceId: 'front', edge: 1, mirror: true, reverse: false },
      b: { pieceId: 'back', edge: 1, mirror: false, reverse: false } },
    // sleeve underarm: e1 runs hem -> armpit, e4 runs armpit -> hem => reverse
    { id: 'underarm_L', kind: 'plain',
      a: { pieceId: 'sleeve_l', edge: 1, mirror: false, reverse: false },
      b: { pieceId: 'sleeve_l', edge: 4, mirror: false, reverse: true } },
    { id: 'underarm_R', kind: 'plain',
      a: { pieceId: 'sleeve_r', edge: 1, mirror: false, reverse: false },
      b: { pieceId: 'sleeve_r', edge: 4, mirror: false, reverse: true } },
    // sleeve cap to armhole: front cap e3 runs apex -> armpit vs armhole armpit -> tip => reverse;
    // back cap e2 runs armpit -> apex, same direction as the armhole => no reverse
    { id: 'cap_front_L', kind: 'plain',
      a: { pieceId: 'sleeve_l', edge: 3, mirror: false, reverse: false },
      b: { pieceId: 'front', edge: 2, mirror: false, reverse: true } },
    { id: 'cap_back_L', kind: 'plain',
      a: { pieceId: 'sleeve_l', edge: 2, mirror: false, reverse: false },
      b: { pieceId: 'back', edge: 2, mirror: true, reverse: false } },
    { id: 'cap_front_R', kind: 'plain',
      a: { pieceId: 'sleeve_r', edge: 3, mirror: false, reverse: false },
      b: { pieceId: 'front', edge: 2, mirror: true, reverse: true } },
    { id: 'cap_back_R', kind: 'plain',
      a: { pieceId: 'sleeve_r', edge: 2, mirror: false, reverse: false },
      b: { pieceId: 'back', edge: 2, mirror: false, reverse: false } },
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
