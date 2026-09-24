// src/core/types.js — SHARED CONTRACTS. Frozen after Phase 0; only the lead edits this file.
// Units: pattern = mm, y up. Body/sizes = cm (_cm keys). 3D/solver = metres, y up, model faces +z, +x = model's LEFT.
export {};

/** @typedef {[number, number]} Vec2  point/vector in mm (pattern space) */
/** @typedef {[number, number, number]} Vec3  point/vector in metres (3D) */

/**
 * Outline edge i runs from Piece.vertices[i] to Piece.vertices[(i + 1) % n].
 * @typedef {Object} Edge
 * @property {'line'|'cubic'} type
 * @property {Vec2} [c1]   first cubic control point, absolute mm (required when type === 'cubic')
 * @property {Vec2} [c2]   second cubic control point, absolute mm (required when type === 'cubic')
 * @property {number} [allowance_mm]  seam allowance for this edge; default Piece.seamAllowance_mm; forced to 0 on the fold edge
 * @property {string} [label]  'hem' | 'side' | 'neck' | free text; shown in the editor and in the export label block
 */

/**
 * @typedef {Object} Notch
 * @property {number} edge   outline edge index
 * @property {number} t      arc-length fraction along the edge, strictly inside (0, 1)
 * @property {'single'|'double'} kind
 */

/**
 * @typedef {Object} Grainline
 * @property {Vec2} a  start (mm)
 * @property {Vec2} b  end (mm); the arrow points a -> b
 */

/**
 * @typedef {Object} InternalLine
 * @property {'fold'|'dart'|'mark'} kind
 * @property {Vec2[]} points  polyline in mm; drawn in the editor and exported; NOT simulated
 */

/**
 * Initial 3D placement of a piece (SPEC section 7.4).
 * @typedef {Object} Placement
 * @property {'torso'|'armL'|'armR'|'legL'|'legR'|'skirt'|'head'} anchor
 * @property {'front'|'back'|'left'|'right'} side   angle around the anchor axis where the piece centre sits
 * @property {Vec2} offset_mm   [dx, dy]; dx = arc shift around the cylinder, dy = shift along the axis (positive = up, toward the anchor origin)
 * @property {number} wrap      0..1; 1 = wrapped on the cylinder, 0 = flat on the tangent plane
 * @property {boolean} flip     mirror the piece's local x before mapping
 */

/**
 * @typedef {Object} GradeRule
 * @property {number} vertex   vertex index in Piece.vertices
 * @property {number} dx_mm    added per size step: delta = (sizeIndex - baseIndex) * dx_mm
 * @property {number} dy_mm
 * @property {string} [ref]    a size-chart key this ONE vertex tracks instead of the piece's own
 *                             widthRef/lengthRef: its offset from the grading pivot is scaled by
 *                             row[ref] / base[ref]. Lets a shoulder point follow shoulder width while
 *                             the rest of the panel follows the chest, which is what real grading does
 *                             and what a single uniform scale cannot express.
 * @property {'x'|'y'|'both'} [refAxis]   which axis `ref` drives; default 'x'
 */

/**
 * @typedef {Object} Grading
 * @property {string|null} widthRef    size-chart key driving x scaling ('chest_cm', 'hips_cm', ...) or null (no x scaling)
 * @property {string|null} lengthRef   size-chart key driving y scaling ('height_cm', 'torsoLength_cm', ...) or null
 * @property {'fold'|'center'|'left'|'right'} anchorX   x pivot; 'fold' = x of vertices[foldEdge] (falls back to 'center' when foldEdge is null)
 * @property {'top'|'center'|'bottom'} anchorY
 * @property {GradeRule[]} vertexRules
 */

/**
 * @typedef {Object} Piece
 * @property {string} id
 * @property {string} name
 * @property {Vec2[]} vertices        closed loop, CCW (signedArea > 0), simple (no self-intersection), length >= 3
 * @property {Edge[]} edges           edges.length === vertices.length
 * @property {number|null} foldEdge   index of a straight edge lying on the fold line; the stored half is mirrored across it at mesh time and exported as the half with 'PLACE ON FOLD'
 * @property {Notch[]} notches
 * @property {Grainline} grainline
 * @property {InternalLine[]} internalLines
 * @property {number} seamAllowance_mm   default allowance for edges without allowance_mm
 * @property {string} fabricId           id of a FabricInstance in ProjectDoc.fabrics
 * @property {number} layer              0 = innermost; each layer adds 3 mm collision clearance and 20 mm arrangement radius
 * @property {number} cutQty             label only ('CUT 2'); the simulation only uses pieces actually listed
 * @property {boolean} exportHidden      true for a mirrored duplicate already covered by another piece's cutQty
 * @property {boolean} simulate          false = export-only piece (waistband, facing)
 * @property {number[]} pinnedEdges      outline edge indices whose mesh vertices are pinned to the body surface after arrangement
 * @property {Placement} placement
 * @property {Grading} grade
 * @property {number} meshSpacing_mm     target triangle edge length, 8..40 (default 15)
 */

/**
 * One side of a seam. Vertices along an edge are always listed from the edge's start vertex to its end vertex,
 * for the original copy and for the mirrored copy alike.
 * @typedef {Object} SeamSide
 * @property {string} pieceId
 * @property {number} edge       single outline edge index (never the fold edge). Use the Split Edge tool for partial seams.
 * @property {boolean} mirror    true = the mirrored copy of a fold piece's edge; must be false when the piece has no foldEdge
 * @property {boolean} reverse   pairing: vertex i of side a pairs with vertex (reverse ? N - i : i) of side b (N + 1 vertices per side)
 */

/**
 * @typedef {Object} Seam
 * @property {string} id
 * @property {SeamSide} a
 * @property {SeamSide} b
 * @property {'plain'} kind
 */

/**
 * Physical fabric parameters (SPEC section 9.1). Compliances are derived at build time, never stored.
 * @typedef {Object} FabricPhysics
 * @property {number} density_kgm2     areal density
 * @property {number} bend_Nm          bending rigidity B (Kawabata), N*m
 * @property {number} membrane_Nm      in-plane (tensile) stiffness Y, N/m
 * @property {number} friction         Coulomb coefficient vs body and vs self, 0..1
 * @property {number} damping          viscous damping, 1/s
 * @property {number} thickness_mm
 * @property {number} meshSpacing_mm   recommended mesh spacing for this fabric
 */

/**
 * @typedef {Object} FabricLook
 * @property {string} color            '#rrggbb'
 * @property {number} roughness
 * @property {number} sheen            0..1
 * @property {number} sheenRoughness
 * @property {number} clearcoat
 * @property {number} opacity          1 = opaque
 * @property {{kind:'solid'|'stripes'|'gingham'|'dots'|'twill'|'knit', scale_mm:number, color2:string}} texture
 */

/** @typedef {{id:string, name:string, physics:FabricPhysics, look:FabricLook}} FabricPreset */

/**
 * A fabric as used by a project (references a preset, overrides some fields).
 * @typedef {Object} FabricInstance
 * @property {string} id        e.g. 'main'
 * @property {string} name
 * @property {string} preset    FabricPreset id
 * @property {string} color     '#rrggbb' (overrides preset look.color)
 * @property {{kind:'solid'|'stripes'|'gingham'|'dots'|'twill'|'knit', scale_mm:number, color2:string}} texture
 * @property {Partial<FabricPhysics>} overrides
 */

/** @typedef {{id:string, name:string, physics:FabricPhysics, look:FabricLook}} FabricResolved */

/**
 * All lengths cm, angles degrees, bustFullness unitless 0..1. Defaults/ranges/presets: SPEC section 6.1.
 * @typedef {Object} BodyParams
 * @property {number} height_cm
 * @property {number} chest_cm
 * @property {number} underbust_cm
 * @property {number} waist_cm
 * @property {number} hips_cm
 * @property {number} shoulderWidth_cm   biacromial width
 * @property {number} neck_cm
 * @property {number} upperArm_cm
 * @property {number} forearm_cm
 * @property {number} wrist_cm
 * @property {number} thigh_cm
 * @property {number} calf_cm
 * @property {number} ankle_cm
 * @property {number} armLength_cm       shoulder joint to wrist
 * @property {number} inseam_cm          floor to crotch
 * @property {number} torsoLength_cm     neck base to waist (back length)
 * @property {number} headHeight_cm
 * @property {number} weight_kg          body mass; with height_cm it gives the BMI that drives soft-tissue shape
 * @property {number} muscle             0..1 build / exercise level: broadens the shoulders and limbs, keeps the waist
 * @property {number} age_y              years; small posture and soft-tissue effects
 * @property {number} sex                0 fully male .. 1 fully female. Drives the template body's
 *                                      gender blend directly; bust fullness is a separate, purely
 *                                      local shape control and is a poor proxy for it (a flat-chested
 *                                      woman and a ten-year-old both read 0).
 * @property {number} bustFullness       0..1
 * @property {number} armAbduction_deg   A-pose angle of the upper arm from vertical
 * @property {number} legSpread_deg
 */

/** @typedef {{name:string} & Record<string, number|string>} SizeRow  measurement keys as in BodyParams, values cm */

/**
 * @typedef {Object} SizeChart
 * @property {string[]} measurements   ordered keys, e.g. ['chest_cm','waist_cm','hips_cm','height_cm','torsoLength_cm','armLength_cm']
 * @property {string} baseSize         row name the pattern is drafted for
 * @property {SizeRow[]} rows          ordered S..XL
 */

/**
 * @typedef {Object} SimSettings
 * @property {number} substeps            10
 * @property {number} gravity_ms2         9.81
 * @property {boolean} selfCollision      true
 * @property {number} sewTime_s           1.0
 * @property {number} collisionOffset_mm  5
 * @property {number} bendScale           multiplies bend_Nm for all fabrics (default 1)
 * @property {number} stretchScale        multiplies membrane_Nm for all fabrics (default 1)
 */

/**
 * @typedef {Object} UiState
 * @property {number} split                0..1 fraction of the main area given to the left pane
 * @property {'split'|'2d'|'3d'} layout
 * @property {boolean} swapped             true = 3D pane on the left
 * @property {string} activeSize
 * @property {'pieces'|'body'|'fabric'|'sizes'} dockTab
 * @property {{preset: string, background: string|null}} scene   3D backdrop and floor (schema SCENE_PRESETS); background #rrggbb or null
 */

/**
 * @typedef {Object} ProjectDoc
 * @property {number} version              1
 * @property {string} name
 * @property {{preset:string, params:BodyParams}} body
 * @property {FabricInstance[]} fabrics
 * @property {Piece[]} pieces
 * @property {Seam[]} seams
 * @property {SizeChart} sizes
 * @property {SimSettings} sim
 * @property {UiState} ui
 */

/** @typedef {{level:'error'|'warn', code:string, message:string, pieceId?:string, seamId?:string, edge?:number}} Issue */

/**
 * Triangulated piece for simulation. Coordinates are the FULL outline (fold pieces already mirrored).
 * @typedef {Object} PieceMesh
 * @property {string} pieceId
 * @property {number} vertexCount
 * @property {Float32Array} positions2d   2*V, mm
 * @property {Uint32Array} triangles      3*T, each CCW in 2D
 * @property {Uint32Array} edges          2*E unique undirected edges, i < j
 * @property {Uint32Array} bendPairs      4*B, one per interior edge: [v0, v1 (shared edge), v2 (opposite in tri A), v3 (opposite in tri B)]
 * @property {Uint32Array} boundary       closed CCW loop of boundary vertex ids
 * @property {Uint32Array[][]} edgeVerts  edgeVerts[mirror][edgeIndex]: ordered vertex ids from the edge start vertex to its end vertex; edgeVerts[1] = [] for non-fold pieces; edgeVerts[*][foldEdge] = empty Uint32Array
 * @property {Uint32Array[]} notchVerts   notchVerts[mirror][k] = vertex id at Piece.notches[k] (forced boundary sample)
 * @property {number} area_mm2
 * @property {{minAngleDeg:number, pctAbove20:number, medianEdge_mm:number, triangles:number}} quality
 * @property {string[]} warnings
 */

/**
 * Uniform signed-distance grid, metres. data[i + nx*(j + ny*k)] = distance at origin + cell*[i,j,k]. Negative inside the body.
 * @typedef {Object} SdfGrid
 * @property {Vec3} origin
 * @property {number} cell
 * @property {number} nx
 * @property {number} ny
 * @property {number} nz
 * @property {Float32Array} data
 */

/**
 * Arrangement cylinder attached to the body.
 * @typedef {Object} Anchor
 * @property {Vec3} origin   top of the cylinder (where a piece's top edge lands at dy = 0)
 * @property {Vec3} axis     unit vector pointing DOWN the cylinder (direction of increasing piece depth)
 * @property {Vec3} front    unit vector perpendicular to axis; direction of side 'front' (theta = 0)
 * @property {number} radius metres, already includes the base clearance
 * @property {number} length usable length along axis, metres
 */

/**
 * @typedef {Object} BodyModel
 * @property {BodyParams} params
 * @property {Record<string, Vec3>} landmarks    headTop, chin, neckBase, shoulderL, shoulderR, elbowL, elbowR, wristL, wristR, chestCenter, waistCenter, hipCenter, crotch, hipJointL, hipJointR, kneeL, kneeR, ankleL, ankleR
 * @property {Record<string, Anchor>} anchors    torso, armL, armR, legL, legR, skirt, head
 * @property {Record<string, {y:number, a:number, b:number, n:number, cz:number}>} rings   crotch, hip, waist, underbust, chest, armpit, shoulder, neckBase
 * @property {SdfGrid} sdf
 * @property {{positions:Float32Array, normals:Float32Array, indices:Uint32Array}} geometry  render mesh, metres
 * @property {{chest_cm:number, waist_cm:number, hips_cm:number}} measured   template body: convex-hull girths of the fitted mesh; analytic body: ray-cast from the baked SDF
 * @property {number} buildMs
 * @property {'template'} [source]   set when the scanned template built the body; absent on the analytic fallback
 * @property {any} [fit]              template body: the fit result (sliders, residual per measurement, clamped controls, variant)
 * @property {any} [measuredFull]     template body: every TemplateMeasurements value, levels grounded
 * @property {any} [skeleton]         template body: joints and derived lengths the anchors were built from
 * @property {Record<string, number>} [timing]  template body: ms per build stage (fit, measure, anchors, sdf, geometry)
 */

/**
 * @typedef {Object} SimParams
 * @property {number} dt          1/60
 * @property {number} substeps    10
 * @property {number} gravity     9.81
 * @property {number} sewTime     seconds
 * @property {boolean} selfCollision
 * @property {number} selfDist    metres, vertex-vertex separation for self-collision
 * @property {number} maxSpeed    5 m/s
 * @property {number} maxStep     metres per substep = min(0.5 * meshSpacing, 0.008)
 * @property {number} bendScale
 * @property {number} stretchScale
 */

/**
 * Solver state — flat typed arrays, no DOM/three references (Worker-transferable).
 * @typedef {Object} ClothState
 * @property {number} V
 * @property {Float32Array} pos        3V metres
 * @property {Float32Array} prev       3V
 * @property {Float32Array} vel        3V
 * @property {Float32Array} invMass    V (0 = pinned)
 * @property {Float32Array} restPos    3V arranged positions (reset target)
 * @property {Uint16Array} pieceOf     V index into pieces[]
 * @property {Float32Array} clearance  V metres: collisionOffset + thickness/2 + 0.003 * layer
 * @property {Float32Array} mu         V friction coefficient
 * @property {Float32Array} damp       V damping 1/s
 * @property {Float32Array} dCache     V last sampled body distance (for CCD-lite and stats)
 * @property {Uint32Array} tris        3T (global vertex ids)
 * @property {Uint32Array} eIdx        2E
 * @property {Float32Array} eRest      E metres
 * @property {Float32Array} eAlpha     E compliance m/N (already includes stretchScale)
 * @property {Uint32Array} bIdx        4B
 * @property {Float32Array} bK         4B Bergou K vector per constraint
 * @property {Float32Array} bS         B  sqrt(3 / (A0 + A1)), 1/m
 * @property {Float32Array} bAlpha     B  compliance 1/(N*m) (already includes bendScale)
 * @property {Uint32Array} sIdx        2S seam pairs
 * @property {Float32Array} sRest0     S  pair distance at reset time, metres
 * @property {Float32Array} sStart     S  sim time (s) when the pair starts closing
 * @property {Uint32Array} pIdx        P  pinned vertex ids
 * @property {Float32Array} pTarget    3P
 * @property {Uint32Array} exclStart   V+1 CSR offsets of self-collision exclusion lists
 * @property {Uint32Array} exclList    sorted vertex ids excluded from self-collision per vertex
 * @property {{start:number, count:number, pieceId:string, mesh:PieceMesh, fabric:FabricResolved, layer:number}[]} pieces
 * @property {SimParams} params
 * @property {number} time
 * @property {number} frame
 * @property {number} nanCount
 */

/**
 * @typedef {Object} SimStats
 * @property {number} frame
 * @property {number} time
 * @property {number} ms                  last frame solver time
 * @property {number} msAvg               moving average over the last 60 frames
 * @property {number} verts
 * @property {number} tris
 * @property {number} constraints         E + B + S
 * @property {number} maxSpeed            m/s
 * @property {number} maxPenetration_mm   max over vertices of (clearance - d), clamped >= 0
 * @property {number} seamGapMax_mm
 * @property {number} seamGapMean_mm
 * @property {number} nanCount
 * @property {boolean} running
 * @property {number} substeps
 * @property {{integrate:number, distance:number, bend:number, seam:number, collide:number, self:number}} sectionMs
 */

/** @typedef {{name:string, pass:boolean, details:string}} SelfTestResult */
