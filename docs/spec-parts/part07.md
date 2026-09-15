## 8. 3D viewer (`src/viewer3d/`), pop-out (`popout.html`, `src/popout/main.js`) — agent A5

The viewer is a **passive mirror** of data owned by other modules: it reads `BodyModel.geometry` (section 6), `ClothState` (section 7) and `FabricResolved` (section 9.1) **by shape only**, never mutates them, never imports the store or the bus, and never steps the simulation itself. The wiring layer (`src/app/wiring.js`) owns the per-frame `tick` callback (step solver → `sync`), reacts to the events of section 3.2 and calls the API below. Imports allowed: `three`, `three/addons/`, `src/core/` (`types.js`, `fabrics.js`, `ids.js`). DOM access is limited to the container element handed in, `ResizeObserver`, `document.visibilityState`, and (bridge only) `window.open` / `BroadcastChannel`.

Files and exported names (every file also re-exported by `src/viewer3d/index.js`):

| File | Exports |
|---|---|
| `scene.js` | `VIEWER_DEFAULTS`, `DEFAULT_BODY_BOX`, `createViewer(container, opts)` |
| `bodyMesh.js` | `BODY_SKIN`, `createBodyMesh(opts)` |
| `clothMesh.js` | `UV_UNIT_MM`, `topologyFromState(state, fabricsByPiece)`, `accumulateNormals(pos, tris, out, V)`, `createClothMesh(opts)` |
| `materials.js` | `fabricMaterial(fabric)`, `updateMaterial(mat, fabric)`, `materialFor(id)`, `materialCacheSize()`, `disposeMaterials()` |
| `textures.js` | `TEXTURE_SIZE`, `textureKey(texture, color)`, `drawTextureCanvas(kind, color, color2, size)`, `fabricTexture(texture, color)`, `textureCacheSize()`, `disposeTextures()` |
| `loop.js` | `createLoop(opts)` |
| `anchorsGizmo.js` | `GIZMO_COLORS`, `createAnchorsGizmo()` |
| `index.js` | re-exports above + `POPOUT_CHANNEL`, `POPOUT_URL`, `POPOUT_HZ`, `POPOUT_WINDOW_FEATURES`, `createPopoutBridge(opts)`, `createViewer3D(container, opts)` |
| `selftest.js` | `runSelfTest()` |
| `src/popout/main.js` | (entry module, no exports; installs `window.__popout` for manual inspection) |

Conventions repeated from section 1 that this module relies on: 3D is metres, y up, model faces +z, +x is the model's LEFT (the viewer's right when the default camera looks at the model's front); colours are `#rrggbb` strings applied with `material.color.set(hex)` under `renderer.outputColorSpace = SRGBColorSpace` (`THREE.ColorManagement.enabled` stays at its default `true`, so `color.getHexString()` returns the same sRGB hex that was set); no allocation inside per-frame code paths (`updatePositions`, `accumulateNormals`, `sendPositions`, the rAF handler).

Error codes thrown by this module (all `Error` objects with a `code` property, per section 1): `WebGLUnavailable` (renderer creation failed), `ViewerBadState` (cloth arrays inconsistent), `ViewerBadBody` (body arrays inconsistent). The wiring layer catches them, writes a status-bar warning and keeps the 2D editor alive; the app never shows a blank screen because `createViewer3D` is called inside the wiring's `try/catch` and a failed viewer leaves `#pane-3d` (section 11) with a plain-text message.

### 8.1 `scene.js` — renderer, camera, lights, ground, resize, framing

```js
/** Tunables; every constructor option defaults to these. Frozen object. */
export const VIEWER_DEFAULTS = Object.freeze({
  background: '#2a2e35',   // scene.background
  fov: 40,                 // vertical, degrees
  near: 0.02, far: 100,    // metres
  pixelRatioMax: 2,        // renderer.setPixelRatio(min(devicePixelRatio, pixelRatioMax))
  shadows: true,           // renderer.shadowMap.enabled
  environment: true,       // RoomEnvironment PMREM as scene.environment (sheen/clearcoat reflections)
  environmentIntensity: 0.5,
  toneMappingExposure: 1.0,
  gridSize_m: 4, gridDivisions: 40,      // 10 cm cells
  shadowPlaneSize_m: 6, shadowOpacity: 0.35,
  frameMargin: 1.05,
  defaultDir: [0, 0.17, 1],              // from target toward camera, normalised at use; ~10 deg elevation, looking at the model's front
});

/** Box framed before any body exists: a 1.75 m body in A-pose. metres. */
export const DEFAULT_BODY_BOX = Object.freeze({ min: [-0.55, 0, -0.25], max: [0.55, 1.75, 0.25] });

/**
 * @typedef {Object} Viewer
 * @property {HTMLElement} container
 * @property {import('three').WebGLRenderer} renderer
 * @property {import('three').Scene} scene
 * @property {import('three').PerspectiveCamera} camera
 * @property {import('three/addons/controls/OrbitControls.js').OrbitControls} controls
 * @property {import('three').Group} root      every content object (body, cloth, gizmo) is added here, never to scene directly
 * @property {{hemi:import('three').HemisphereLight, key:import('three').DirectionalLight, fill:import('three').DirectionalLight}} lights
 * @property {{grid:import('three').GridHelper, shadowPlane:import('three').Mesh}} ground
 * @property {boolean} contextLost            true between webglcontextlost and webglcontextrestored
 * @property {() => void} resize              reads container.clientWidth/Height; called by the ResizeObserver
 * @property {() => void} render              renderer.render(scene, camera); no-op when size is 0 or contextLost
 * @property {(box:{min:number[],max:number[]}, opts?:{targetY?:number, dir?:number[], margin?:number}) => void} frame
 * @property {(bodyModel?: {geometry:{positions:Float32Array}, landmarks?:Record<string,number[]>}|null, opts?:{resetDir?:boolean}) => void} fit
 * @property {(hex:string) => void} setBackground
 * @property {() => string} screenshot        renders synchronously, returns renderer.domElement.toDataURL('image/png')
 * @property {() => {width:number, height:number, dpr:number}} size   CSS pixels and the applied pixel ratio
 * @property {() => {calls:number, triangles:number}} renderInfo     copy of renderer.info.render after the last render
 * @property {() => void} dispose
 */

/**
 * Creates the WebGL renderer inside `container` (a block element; the wiring passes the 3D pane of section 11).
 * @param {HTMLElement} container
 * @param {Partial<typeof VIEWER_DEFAULTS> & {orbit?:boolean}} [opts]   orbit=false skips OrbitControls (never used by the app; kept for tests)
 * @returns {Viewer}
 * @throws {Error} code 'WebGLUnavailable' when `new WebGLRenderer` throws or `renderer.getContext()` is null
 */
export function createViewer(container, opts = {})
```

Construction, in order:

1. **Renderer**: `new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false })` inside `try/catch`; on failure throw `WebGLUnavailable` (the message includes the original error text). Then `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`, `toneMappingExposure`, `shadowMap.enabled = shadows`, `shadowMap.type = PCFSoftShadowMap`, `setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioMax))`. The canvas gets `style.display = 'block'; style.width = '100%'; style.height = '100%'; style.touchAction = 'none'` and is appended to `container`. The container must have `position: relative` or be a grid/flex cell with a definite size (styles/shell.css, section 11 guarantees this for `#pane-3d`). Listeners on the canvas: `webglcontextlost` (calls `event.preventDefault()`, sets `contextLost = true`) and `webglcontextrestored` (`contextLost = false`, then `render()`).
2. **Scene**: `scene.background = new Color(background)`; `root = new Group(); root.name = 'root'; scene.add(root)`. If `environment` is true: `const pmrem = new PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = environmentIntensity; pmrem.dispose()` (imports `three/addons/environments/RoomEnvironment.js`), wrapped in `try/catch` — an environment failure is logged with `console.warn` and ignored.
3. **Camera**: `new PerspectiveCamera(fov, 1, near, far)`; initial placement by `frame(DEFAULT_BODY_BOX, { targetY: 0.72 * 1.75 })`.
4. **OrbitControls** (`three/addons/controls/OrbitControls.js`): `enableDamping = true; dampingFactor = 0.08; minDistance = 0.3; maxDistance = 15; maxPolarAngle = 0.95 * Math.PI; screenSpacePanning = true`. `controls.update()` is called by the loop's render callback (8.6), not inside `render()`.
5. **Lights** (three r155+ physical intensities, no legacy lights):
   * `hemi = new HemisphereLight(0xdfe8f0, 0x4a4036, 0.9)`.
   * `key = new DirectionalLight(0xffffff, 2.2)`, `position.set(1.6, 3.2, 2.4)` (above, in front, on the model's left), `target.position.set(0, 0.9, 0)` (`scene.add(key.target)`), `castShadow = shadows`, `shadow.mapSize.set(2048, 2048)`, shadow camera orthographic `left/right/bottom/top = -1.6/1.6/-1.6/1.6`, `near = 0.1`, `far = 10`, `shadow.bias = -0.0004`, `shadow.normalBias = 0.015`.
   * `fill = new DirectionalLight(0xb0c4de, 0.6)`, `position.set(-2.0, 1.5, -1.5)`, no shadow.
6. **Ground** at y = 0: `grid = new GridHelper(gridSize_m, gridDivisions, 0x666b73, 0x3a3f47)`, `grid.position.y = 0.001` (avoids z-fighting with the shadow plane), `grid.material.transparent = true; grid.material.opacity = 0.6`; `shadowPlane = new Mesh(new PlaneGeometry(shadowPlaneSize_m, shadowPlaneSize_m), new ShadowMaterial({ opacity: shadowOpacity }))`, `rotation.x = -Math.PI / 2`, `receiveShadow = true`. Both are added to `scene` (not `root`).
7. **Resize**: `resize()` reads `w = Math.max(1, container.clientWidth)`, `h = Math.max(1, container.clientHeight)`; sets `renderer.setSize(w, h, false)`, `camera.aspect = w / h`, `camera.updateProjectionMatrix()`. A `ResizeObserver` on `container` calls `resize()` then `render()`. When `container.clientWidth === 0 || clientHeight === 0` (pane hidden by layout `'2d'`, section 3.1 `UiState.layout`), `render()` returns immediately; the observer fires again when the pane reappears.
8. **`frame(box, opts)`** — exact fit of an axis-aligned box into the frustum, keeping the current orbit direction:
   1. `target = centre(box)`; if `opts.targetY` is given, `target.y = opts.targetY`.
   2. `dir` = `opts.dir` normalised if given, else the current `normalize(camera.position - controls.target)` (falls back to `VIEWER_DEFAULTS.defaultDir` when the length is < 1e-6).
   3. `right = normalize(cross((0,1,0), dir))` (if `|right| < 1e-6` use `right = (1,0,0)`), `up = cross(dir, right)`; `tv = tan(fov/2)`, `th = tv * camera.aspect`.
   4. For each of the 8 corners `p` of `box`: `q = p - target`, `dV = q·dir + |q·up| / tv`, `dH = q·dir + |q·right| / th`; `d = margin * max over corners of max(dV, dH)`, clamped to `[0.5, 20]`.
   5. `camera.position = target + dir * d`; `controls.target = target`; `controls.update()`.
   * Worked default (checked numerically): `DEFAULT_BODY_BOX`, `targetY = 1.26`, `dir = normalize(0, 0.17, 1)`, `fov = 40`, `margin = 1.05` gives `d = 3.74 m` for every aspect ratio ≥ 0.75 (the vertical extent dominates).
9. **`fit(bodyModel, opts)`**: `box` = `Box3.setFromArray(bodyModel.geometry.positions)` when a body is given (else `DEFAULT_BODY_BOX`); `targetY = bodyModel.landmarks?.chestCenter ? bodyModel.landmarks.chestCenter[1] : box.min.y + 0.72 * (box.max.y - box.min.y)` ("chest height" per the assignment; `landmarks.chestCenter` is a `Vec3` array, section 3.1); `dir` = default direction when `opts.resetDir === true`, else the current one. The wiring calls `fit(model, { resetDir: true })` after the first body build and plain `fit(model)` for the toolbar "Frame" action / `F` shortcut (section 11).
10. **`screenshot()`**: `render()` then `renderer.domElement.toDataURL('image/png')` in the same synchronous call (no `preserveDrawingBuffer` needed). Returns `'data:,'` when the size is 0 or the context is lost.
11. **`dispose()`**: disconnect the observer, `controls.dispose()`, remove the context-loss listeners, dispose grid/shadow-plane geometries and materials, dispose `scene.environment`, `renderer.dispose()`, `renderer.forceContextLoss()`, remove the canvas. Content under `root` is disposed by its own handles (8.2, 8.3, 8.7), not here.

### 8.2 `bodyMesh.js` — the body render mesh

```js
export const BODY_SKIN = Object.freeze({ color: '#d9b99b', roughness: 0.75, metalness: 0 });

/**
 * @typedef {Object} BodyMeshHandle
 * @property {import('three').Group} object        add to viewer.root; contains mesh, wire, landmarks
 * @property {import('three').Mesh} mesh
 * @property {import('three').Mesh} wire           wireframe overlay sharing mesh.geometry (visible=false by default)
 * @property {import('three').Group} landmarks     debug spheres (visible=false by default)
 * @property {(model:{geometry:{positions:Float32Array,normals?:Float32Array,indices:Uint32Array}, landmarks?:Record<string,number[]>}|null) => void} setBody
 * @property {(on:boolean) => void} setWireframe
 * @property {(on:boolean) => void} setLandmarksVisible
 * @property {(alpha:number) => void} setOpacity   0..1; < 1 makes the skin material transparent (body opacity slider)
 * @property {(on:boolean) => void} setVisible
 * @property {() => number} vertexCount            0 when no body
 * @property {() => {min:number[],max:number[]}|null} bounds   from the current geometry's bounding box
 * @property {() => void} dispose
 */

/** @param {{color?:string, roughness?:number}} [opts] @returns {BodyMeshHandle} */
export function createBodyMesh(opts = {})
```

* `setBody(model)` reads **only** `model.geometry` and `model.landmarks` (so the pop-out can pass a partial object). Validation: `positions.length % 3 === 0`, `indices.length % 3 === 0`, every index `< positions.length / 3` (single pass over `indices`); otherwise throw `ViewerBadBody`. `null` hides `object` and keeps the old geometry disposed.
* Rebuild strategy: **always a fresh `BufferGeometry`** wrapping the arrays directly (`new BufferAttribute(positions, 3)`, `new BufferAttribute(normals, 3)`, `setIndex(new BufferAttribute(indices, 1))` — `Uint32Array` indices are native in WebGL2). No copy: the body module allocates new arrays on every bake (section 6) and never mutates a published one. If `normals` is missing or its length differs from `positions.length`, call `geometry.computeVertexNormals()`. Then `geometry.computeBoundingBox(); geometry.computeBoundingSphere()`, assign `mesh.geometry = wire.geometry = geo`, dispose the previous geometry. Body rebuilds happen on slider release (section 6), so the cost (< 20k triangles) is irrelevant.
* Skin material: `new MeshStandardMaterial({ color, roughness, metalness: 0, side: FrontSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })`; `mesh.castShadow = mesh.receiveShadow = true`; `mesh.name = 'body'`.
* Wireframe overlay: `wire = new Mesh(sameGeometry, new MeshBasicMaterial({ wireframe: true, color: '#3c2f28', transparent: true, opacity: 0.35 }))`, `wire.visible = false`; `setWireframe(on)` toggles `wire.visible`.
* Landmarks: one `Mesh(new SphereGeometry(0.012, 12, 8), new MeshBasicMaterial({ color: '#ff3b30', depthTest: false }))` per key of `model.landmarks`, `mesh.name = key`, positioned at the `Vec3`; the shared sphere geometry/material are created once. On `setBody` the group is rebuilt (children reused when the key set is unchanged, otherwise disposed and recreated). `setLandmarksVisible(on)` toggles `landmarks.visible`; default hidden. Absent `model.landmarks` → group emptied.
* `setOpacity(a)`: `material.transparent = a < 1; material.opacity = a; material.depthWrite = a >= 1 ? true : true` (depth write stays on so cloth behind the body is still occluded correctly; only the skin becomes see-through). `a` is clamped to `[0.05, 1]`.
* `dispose()`: geometry, skin material, wire material, landmark geometry/material.

### 8.3 `clothMesh.js` — one dynamic `BufferGeometry` for the whole garment

```js
export const UV_UNIT_MM = 100;   // 1 uv unit = 100 mm of pattern space (textures set repeat = 100 / scale_mm, 8.5)

/**
 * Render topology derived from a ClothState. This object is also the exact payload of the pop-out 'cloth:init' message (8.8).
 * @typedef {Object} ClothTopology
 * @property {number} V
 * @property {Uint32Array} tris     3T, REORDERED so that the triangles of pieces[0] come first, then pieces[1], ... (ClothState.tris is not assumed sorted)
 * @property {Float32Array} uv      2V: uv[2v] = positions2d[2i] / UV_UNIT_MM, uv[2v+1] = positions2d[2i+1] / UV_UNIT_MM, where i = v - piece.start
 * @property {{start:number, count:number, materialIndex:number, pieceId:string}[]} groups   start/count in index elements (3 per triangle); materialIndex = position in ClothState.pieces
 * @property {string[]} pieceIds    pieceIds[materialIndex]
 * @property {FabricResolved[]} fabrics   fabrics[materialIndex] (plain data, structured-clone safe)
 * @property {Float32Array} pos     3V copy of ClothState.pos at build time
 */

/**
 * @param {ClothState} state
 * @param {Record<string, FabricResolved>|null} [fabricsByPiece]   optional override keyed by pieceId; default state.pieces[k].fabric
 * @returns {ClothTopology}
 * @throws {Error} code 'ViewerBadState'
 */
export function topologyFromState(state, fabricsByPiece = null)

/**
 * Area-weighted vertex normals, allocation-free. out (3V) is zeroed, accumulated with the unnormalised
 * cross product of each triangle, then each vertex normal is normalised (a zero vector becomes (0,1,0)).
 * @param {Float32Array} pos 3V @param {Uint32Array} tris 3T @param {Float32Array} out 3V @param {number} V
 */
export function accumulateNormals(pos, tris, out, V)

/**
 * @typedef {Object} ClothMeshHandle
 * @property {import('three').Mesh} object            add to viewer.root; frustumCulled = false
 * @property {import('three').Mesh} wire              wireframe overlay sharing the geometry (visible=false by default)
 * @property {import('three').BufferGeometry|null} geometry
 * @property {(topology:ClothTopology) => void} build
 * @property {(state:ClothState, fabricsByPiece?:Record<string,FabricResolved>|null) => void} setCloth   = build(topologyFromState(state, fabricsByPiece))
 * @property {(pos:Float32Array) => void} updatePositions   copies pos into the position attribute, recomputes normals (see normalsEvery), flags both needsUpdate
 * @property {(pieceId:string, fabric:FabricResolved) => boolean} setPieceFabric   swaps/updates the material of that piece's group; false if pieceId unknown
 * @property {number} normalsEvery                    1 (default) or 2: recompute normals every n-th updatePositions call
 * @property {(on:boolean) => void} setWireframe
 * @property {(on:boolean) => void} setVisible
 * @property {() => number} vertexCount               V of the current topology, 0 when empty
 * @property {() => number} triangleCount
 * @property {() => ClothTopology|null} topology      the topology passed to the last build (shared reference, read-only)
 * @property {() => void} clear                       disposes the geometry, hides the mesh
 * @property {() => void} dispose
 */

/** @returns {ClothMeshHandle} */
export function createClothMesh(opts = {})
```

**`topologyFromState` algorithm** (runs once per sim build/reset, allocation allowed):

1. `V = state.V`, `T = state.tris.length / 3`, `K = state.pieces.length`. Validate: `state.pos.length === 3V`, `state.pieceOf.length === V`, every `tris[i] < V`, and for every triangle `pieceOf[a] === pieceOf[b] === pieceOf[c]` (pieces are separate meshes, seams are constraints, section 7) and `pieceOf < K`; for every piece `start + count <= V` and `mesh.positions2d.length === 2 * count`. Any violation → `ViewerBadState` with a message naming the first offending index.
2. Counting sort of triangles by piece: `counts[k]` = number of triangles whose first vertex has `pieceOf === k`; `offsets` = exclusive prefix sum; second pass writes the three ids of each triangle into `tris` at `3 * (offsets[k] + fill[k]++)` — stable, so within a piece the original order is preserved.
3. `groups[k] = { start: 3 * offsets[k], count: 3 * counts[k], materialIndex: k, pieceId: pieces[k].pieceId }` (pieces with 0 triangles still get a group with `count: 0`).
4. `uv` from each piece's `mesh.positions2d` divided by `UV_UNIT_MM` (fold pieces are already the full mirrored outline, section 3.1 `PieceMesh`), so a texture with `scale_mm = 20` shows a 20 mm period aligned with the pattern grain regardless of drape.
5. `fabrics[k] = fabricsByPiece?.[pieceId] ?? pieces[k].fabric`; `pos = state.pos.slice()`.

**`build(topology)`**:

1. `clear()` if a geometry exists.
2. `geo = new BufferGeometry()`; `position = new BufferAttribute(new Float32Array(3V), 3)` with `setUsage(DynamicDrawUsage)`; `normal = new BufferAttribute(new Float32Array(3V), 3)` with `DynamicDrawUsage`; `uv = new BufferAttribute(topology.uv, 2)` (static); `setIndex(new BufferAttribute(topology.tris, 1))`; `geo.addGroup(g.start, g.count, g.materialIndex)` for every group.
3. `object.material = topology.fabrics.map(f => fabricMaterial(f))` (8.4; pieces that share a fabric id share one material object, which is the intended semantics because colour lives on the `FabricInstance`).
4. `updatePositions(topology.pos)` (forces a normal computation regardless of `normalsEvery`).
5. `object.visible = V > 0`; `object.castShadow = object.receiveShadow = true`; `object.frustumCulled = false` (the bounding sphere is never recomputed for dynamic positions; the cloth is always drawn). `wire.geometry = geo`.

**`updatePositions(pos)`** (per frame, allocation-free): throw `ViewerBadState` if `pos.length !== 3V`; `positionAttr.array.set(pos); positionAttr.needsUpdate = true`; `if (++callCounter % normalsEvery === 0) { accumulateNormals(array, tris, normalAttr.array, V); normalAttr.needsUpdate = true; }`. **Decision: copy, not a shared view** — the solver may replace `state.pos` on rebuild/reset and may later live in a Worker with transferred buffers; copying 3V floats (≤ 96 KB at the 8k-vertex cap) costs < 0.05 ms. Normal accumulation at 16k triangles costs ≈ 0.3 ms; the wiring sets `normalsEvery = 2` when `SimStats.msAvg > 12` and back to 1 when it drops below 8 (hysteresis).

**`setPieceFabric(pieceId, fabric)`**: finds the group by `pieceId`, calls `fabricMaterial(fabric)` (which updates the cached material in place when the id is already known) and assigns it to `object.material[materialIndex]`; also updates `topology.fabrics[materialIndex]` so a later `cloth:init` resend (8.8) carries the change. No geometry rebuild.

**Wireframe overlay**: `wire = new Mesh(geo, new MeshBasicMaterial({ wireframe: true, color: '#101418', transparent: true, opacity: 0.35 }))`, `frustumCulled = false`, hidden by default. Fabric materials carry `polygonOffset` (8.4) so the overlay never z-fights.

### 8.4 `materials.js` — fabric look → `MeshPhysicalMaterial`, cached by fabric id

```js
/**
 * Returns the material for fabric.id, creating it on first use and otherwise updating the cached one IN PLACE
 * (so every mesh group already holding it sees the change with no rebuild).
 * @param {FabricResolved} fabric
 * @returns {import('three').MeshPhysicalMaterial}
 */
export function fabricMaterial(fabric)

/** Applies fabric.look to an existing material (see field table). @param {import('three').MeshPhysicalMaterial} mat @param {FabricResolved} fabric */
export function updateMaterial(mat, fabric)

/** @param {string} id @returns {import('three').MeshPhysicalMaterial|undefined} */
export function materialFor(id)
export function materialCacheSize()
/** Disposes and empties the cache (used by selftest and Viewer3D.dispose). */
export function disposeMaterials()
```

Constructor: `new MeshPhysicalMaterial({ side: DoubleSide, flatShading: false, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })`, `mat.name = fabric.id`, `mat.userData.fabricId = fabric.id`. `updateMaterial` mapping from `FabricLook` (section 3.1 / 9.1):

| Material field | Value |
|---|---|
| `color` | `look.texture.kind === 'solid'` → `color.set(look.color)`; otherwise `color.set('#ffffff')` (the texture pixels already carry `color` and `color2`, a non-white base would darken them) |
| `map` | `fabricTexture(look.texture, look.color)` (8.5): `null` for solid |
| `roughness` | `look.roughness` |
| `metalness` | 0 |
| `sheen` | `look.sheen` |
| `sheenRoughness` | `look.sheenRoughness` |
| `sheenColor` | `new Color(look.color).lerp(new Color('#ffffff'), 0.6)` (white-tinted base colour) |
| `clearcoat` | `look.clearcoat`; `clearcoatRoughness = 0.4` |
| `opacity` | `look.opacity`; `transparent = look.opacity < 1`; `depthWrite = true` always (a double-sided transparent chiffon with depth write off loses whole faces; slight sorting artefacts are accepted) |
| `envMapIntensity` | 0.5 (matches `VIEWER_DEFAULTS.environmentIntensity`) |
| `needsUpdate` | set to `true` whenever `map` changes between `null` and non-`null` or `transparent` changes (three does not detect these program changes by itself) |

`disposeMaterials()` calls `mat.dispose()` on every cached material (textures are owned by 8.5 and disposed there).

### 8.5 `textures.js` — procedural `CanvasTexture`s

```js
export const TEXTURE_SIZE = 512;

/** Cache key: `${kind}|${color}|${color2}|${scale_mm}` (scale_mm clamped to [2, 500] before keying). */
export function textureKey(texture, color)

/**
 * Draws one pattern period on a size x size canvas; pure drawing, no three import (testable without WebGL).
 * @param {'solid'|'stripes'|'gingham'|'dots'|'twill'|'knit'} kind
 * @param {string} color   base colour '#rrggbb'
 * @param {string} color2  accent colour '#rrggbb'
 * @param {number} [size=TEXTURE_SIZE]
 * @returns {HTMLCanvasElement}
 */
export function drawTextureCanvas(kind, color, color2, size = TEXTURE_SIZE)

/**
 * @param {{kind:string, scale_mm:number, color2:string}} texture   FabricLook.texture
 * @param {string} color   FabricLook.color
 * @returns {import('three').CanvasTexture|null}   null for kind 'solid' (and for unknown kinds, with one console.warn per kind)
 */
export function fabricTexture(texture, color)
export function textureCacheSize()
export function disposeTextures()
```

Texture object settings: `wrapS = wrapT = RepeatWrapping`, `colorSpace = SRGBColorSpace`, `anisotropy = 4` (three clamps to the device maximum), `generateMipmaps = true`, `minFilter = LinearMipmapLinearFilter`, `magFilter = LinearFilter`, `repeat.set(UV_UNIT_MM / scale_mm, UV_UNIT_MM / scale_mm)` — with uv = mm / 100 (8.3) one canvas tile therefore covers exactly `scale_mm × scale_mm` of pattern space, and a canvas tile holds **one period** of the pattern. `flipY` stays at its default `true`. `needsUpdate = true` once after creation.

Drawing rules (`ctx = canvas.getContext('2d')`, `S = size`; every pattern is seamless because all periods used divide `S`):

| kind | Drawing on a canvas pre-filled with `color` |
|---|---|
| `solid` | canvas filled with `color` only (function still returns a canvas; `fabricTexture` returns `null` for it) |
| `stripes` | `fillStyle = color2; fillRect(0, 0, S/2, S)` — one stripe pair per tile, stripes run along the pattern's y (grain) direction |
| `gingham` | `globalAlpha = 0.5; fillStyle = color2; fillRect(0, 0, S/2, S); fillRect(0, 0, S, S/2)` — bands at 50 %, the overlap at 75 % |
| `dots` | `fillStyle = color2`; two discs of radius `0.12·S` centred at `(S/4, S/4)` and `(3S/4, 3S/4)` (staggered lattice) |
| `twill` | `strokeStyle = color2; globalAlpha = 0.55; lineWidth = 0.045·S`; for `c = -S; c <= 2S; c += S/8` draw the line from `(c, 0)` to `(c - S, S)` (all points satisfy `x + y = c`, 45° diagonals, period `S/8` divides `S`) |
| `knit` | `globalAlpha = 0.45; strokeStyle = color2; lineWidth = 0.023·S`; for 8 rows `r = 0..7`: path `y = r·S/8 + S/16 + 0.028·S·sin(2π x / (S/8))` for `x = 0..S` step 4 px, stroked; then the same paths shifted down by `S/64` with `strokeStyle = 'rgba(0,0,0,0.12)'` (shadow line) |

`disposeTextures()` disposes every cached texture and empties the map. Unknown kinds are treated as `solid`.

### 8.6 `loop.js` — requestAnimationFrame driver

```js
/**
 * @typedef {Object} Loop
 * @property {() => void} start
 * @property {() => void} stop
 * @property {() => boolean} isRunning       true while a frame is scheduled (false when stopped or the document is hidden)
 * @property {boolean} renderSuppressed      settable; true = frames are skipped entirely (no tick, no render) — used by __app.runAcceptance()
 * @property {() => void} renderNow          synchronous render ignoring renderSuppressed (used by __app.sim.step(n) after its last step so screenshots are current)
 * @property {number} fps                    rendered frames in the last completed 1 s window (0 until the first window completes)
 * @property {number} frameCount             rendered frames since start()
 * @property {number} lastFrameMs            wall-clock ms between the last two rAF callbacks (clamped to 100)
 * @property {() => void} dispose            stop + remove the visibilitychange listener
 */

/**
 * @param {{ tick?: ((dtMs:number, frame:number) => void)|null, render: () => void, onFps?: (fps:number) => void }} opts
 * @returns {Loop}
 */
export function createLoop(opts)
```

Frame handler (`onFrame(now)`):

1. If not `running` return (a late callback after `stop()`).
2. `dtMs = min(now - lastNow, 100); lastNow = now`.
3. If `!renderSuppressed`: `tick?.(dtMs, frameCount)`; `render()`; `frameCount++`; `windowFrames++`.
4. If `now - windowStart >= 1000`: `fps = windowFrames; windowFrames = 0; windowStart = now; onFps?.(fps)`.
5. `rafId = requestAnimationFrame(onFrame)`.

`tick` is supplied by the wiring and, when the sim is playing, calls `solver.step()` **exactly once per frame regardless of `dtMs`** (fixed `dt = 1/60`, section 1 — slow machines slow the sim, never destabilise it), then `Viewer3D.sync(state)`. `dtMs` is informational (status bar). `render` = `controls.update(); viewer.render()`.

Visibility: on `document.visibilitychange`, hidden → `cancelAnimationFrame(rafId)`, `paused = true`; visible → if `running` re-request a frame and reset `lastNow`/`windowStart` to `performance.now()`. `isRunning()` = `running && !paused`.

Automation contract (for section 12/13 writers): `__app.sim.step(n)` is synchronous and therefore never interleaves with rAF; it must end with `Viewer3D.sync(state, true)` and `loop.renderNow()`. `__app.runAcceptance()` sets `loop.renderSuppressed = true` for its whole duration (it yields with `await` between checks) and restores it in `finally`.

### 8.7 `anchorsGizmo.js` — anchor cylinders and placement outlines

```js
export const GIZMO_COLORS = Object.freeze({ anchor: '#55aaff', anchorHighlight: '#ffd400', frontTick: '#ffd400', outline: '#ff8800' });

/**
 * @typedef {Object} AnchorsGizmoHandle
 * @property {import('three').Group} object     add to viewer.root; visible=false by default
 * @property {(anchors:Record<string,Anchor>|null) => void} setAnchors
 * @property {(state:ClothState|null) => void} setPlacements   one closed outline per piece from restPos + mesh.boundary
 * @property {(name:string|null) => void} highlight             anchor name ('torso', 'armL', ...) drawn in anchorHighlight
 * @property {(on:boolean) => void} setVisible
 * @property {() => void} dispose
 */
export function createAnchorsGizmo()
```

* `setAnchors`: for every `Anchor` (section 3.1: `origin` = top, `axis` = unit vector pointing down the cylinder, `front` = unit vector for side `'front'`, `radius`, `length`) build one `LineSegments` named by the anchor key with `LineBasicMaterial({ color, transparent: true, opacity: 0.6, depthTest: false })` from world-space points computed exactly like the arrangement formula of section 7.4, so the gizmo and the arrangement can never disagree: `u = front`, `w = cross(axis, front)`; ring at depth `s ∈ {0, length/2, length}`: 48 segments of `origin + axis·s + radius·(cos θ·u + sin θ·w)`; 8 longitudinal segments at `θ = k·π/4` from `s = 0` to `s = length`; plus a **front tick** (`frontTick` colour): from `origin + radius·u` to `origin + (radius + 0.03)·u` marking `θ = 0` (side `'front'`). With `axis = (0,-1,0)` and `front = (0,0,1)`, `w = (-1, 0, 0)`, so `θ = +π/2` (side `'right'`) lies at −x = the model's right, consistent with section 1 (+x = model's LEFT). `null` removes everything.
* `setPlacements(state)`: for each `state.pieces[k]`, a `LineLoop` of `mesh.boundary.length` points read from `state.restPos` at `3·(start + boundary[i])`, `LineBasicMaterial({ color: outline, depthTest: false })`, named `pieceId`. Allocation happens here (called on sim build/reset only, never per frame). `null` removes the outlines.
* `highlight(name)`: sets the named anchor's material colour to `anchorHighlight` and opacity 1, all others back to `anchor` / 0.6. The wiring calls it with the selected piece's `placement.anchor` (Pieces panel) and `setVisible(true)` while a piece is selected, `setVisible(false)` otherwise; a toolbar toggle (section 11) can force it on.
* `dispose()`: geometries and materials of all children.

### 8.8 Pop-out window — `popout.html`, `src/popout/main.js`, bridge in `src/viewer3d/index.js`

Design (winning design, corrected per the judges): the pop-out is **view-only**; the main window remains the single simulation owner and keeps rendering its own in-pane viewer (automation and screenshots are unaffected by a pop-out). It is opened **only from a user click on `#btn-popout`** (section 11); no acceptance check (section 13) and no `__app` call opens it, because Chromium blocks `window.open` without user activation. If the wiring wants to give the 2D editor the full width while the pop-out is open it may set `UiState.layout = '2d'` and restore the previous value on close — that is wiring policy, not part of this module.

```js
export const POPOUT_CHANNEL = 'clothing-app-3d';
export const POPOUT_URL = 'popout.html';
export const POPOUT_HZ = 30;                                  // max rate of 'cloth:pos'
export const POPOUT_WINDOW_FEATURES = 'popup=yes,width=960,height=800';

/**
 * Messages on BroadcastChannel(POPOUT_CHANNEL). Every message carries `session` (the bridge's sessionId, also
 * passed to the pop-out as ?session=); receivers ignore other sessions so two app tabs never feed one pop-out.
 * @typedef {{type:'hello', session:string}} PopoutHello                              pop-out -> main, on load
 * @typedef {{type:'closed', session:string}} PopoutClosed                            pop-out -> main, on pagehide
 * @typedef {{type:'body', session:string, hasBody:boolean, positions:Float32Array, normals:Float32Array, indices:Uint32Array, chestY:number}} PopoutBody   main -> pop-out
 * @typedef {{type:'cloth:init', session:string, topology:ClothTopology|null}} PopoutClothInit   main -> pop-out (also resent on any fabric/colour change)
 * @typedef {{type:'cloth:pos', session:string, pos:Float32Array, frame:number}} PopoutClothPos   main -> pop-out, <= POPOUT_HZ
 * @typedef {{type:'close', session:string}} PopoutClose                              main -> pop-out (app unloading or "bring back")
 */

/**
 * @typedef {Object} PopoutBridge
 * @property {string} sessionId
 * @property {() => boolean} open          window.open(POPOUT_URL + '?session=' + sessionId, 'clothing-app-3d', POPOUT_WINDOW_FEATURES); focuses the existing window if already open; returns false when blocked (null return)
 * @property {() => boolean} isOpen
 * @property {() => void} close            posts 'close', calls win.close() if the reference is alive
 * @property {(model:BodyModel|null) => void} sendBody
 * @property {(topology:ClothTopology|null) => void} sendClothInit
 * @property {(pos:Float32Array, frame:number, force?:boolean) => void} sendPositions   no-op when closed; throttled to POPOUT_HZ unless force
 * @property {(fn:() => void) => void} onOpened   after 'hello'
 * @property {(fn:() => void) => void} onClosed   after 'closed' or when the 1 s win.closed poll trips
 * @property {() => void} dispose          close(), clear the poll, channel.close()
 */

/**
 * @param {{ getBody: () => BodyModel|null, getTopology: () => ClothTopology|null, getPositions: () => {pos:Float32Array, frame:number}|null }} opts
 * @returns {PopoutBridge}
 */
export function createPopoutBridge(opts)
```

Bridge behaviour (main window):

1. `sessionId = uid('sess')` (section 3, `src/core/ids.js`); the channel is created lazily on the first `open()`.
2. On `hello` (matching session): mark open, send `body` (`getBody()`), `cloth:init` (`getTopology()`), `cloth:pos` (`getPositions()`, forced), call the `onOpened` callbacks.
3. `sendPositions(pos, frame, force)`: `if (!open) return; const now = performance.now(); if (!force && now - lastSent < 1000 / POPOUT_HZ) return; lastSent = now; channel.postMessage({ type: 'cloth:pos', session, pos, frame })`. `postMessage` structured-clones the array (≤ 96 KB at 30 Hz ≈ 2.9 MB/s — acceptable); no allocation on the sender beyond the clone the platform performs.
4. `sendBody(model)`: `hasBody = !!model`; arrays from `model.geometry`; `chestY = model.landmarks.chestCenter[1]`.
5. A `setInterval(1000)` poll checks `win.closed`; on true (or on the `closed` message) it marks closed, clears the poll and calls `onClosed`. On the main page's `pagehide`, `close()` is posted so the pop-out closes with the app.
6. **Blocked pop-ups**: `open()` returns `false`; the wiring shows the status-bar message `Pop-out blocked by the browser. Allow pop-ups for this site, or use Swap / the 3D-only layout.` and nothing else changes.

`popout.html`: same import map as `index.html` (section 2), `<title>Clothing App – 3D</title>`, `<div id="popout-root"></div><div id="popout-status"></div>` (root fills the viewport: `position:fixed; inset:0`; status is a small overlay top-left), `<script type="module" src="src/popout/main.js">`. It imports only `src/viewer3d/index.js` and `src/core/` (dependency rule of section 2: `popout -> core, viewer3d`).

`src/popout/main.js` flow:

1. Read `session` from `location.search`; if absent, show `Open this window from the app's Pop-out button.` in `#popout-status` and stop.
2. `const v = createViewer3D(document.getElementById('popout-root'), { tick: null })` (8.9; the loop only renders). Failures show the error text in the status div.
3. `const ch = new BroadcastChannel(POPOUT_CHANNEL)`; `onmessage` ignores messages whose `session` differs; handlers: `body` → `v.body.setBody(hasBody ? { geometry: { positions, normals, indices }, landmarks: { chestCenter: [0, chestY, 0] } } : null)` then `v.viewer.fit(...)` on the first body only; `cloth:init` → `topology ? v.cloth.build(topology) : v.cloth.clear()`; `cloth:pos` → if `pos.length === 3 * v.cloth.vertexCount()` then `v.cloth.updatePositions(pos)` else ignore (a stale frame from before a rebuild); `close` → `window.close()`.
4. Post `hello`; status shows `Waiting for the main window…`; a 3 s timer without any message changes it to `No data from the main window — is the app still open?` (listening continues). After the first `cloth:pos` the status shows `3D mirror · {fps} fps · {V} vertices` (updated via `onFps`).
5. `pagehide` → post `closed`, `ch.close()`, `v.dispose()`.
6. `window.__popout = { frames: () => count of cloth:pos received, V: () => v.cloth.vertexCount(), lastFrame }` for manual inspection only.

### 8.9 `index.js` — the `Viewer3D` facade, and `selftest.js`

```js
/**
 * @typedef {Object} Viewer3D
 * @property {Viewer} viewer
 * @property {BodyMeshHandle} body
 * @property {ClothMeshHandle} cloth
 * @property {AnchorsGizmoHandle} gizmo
 * @property {Loop} loop                         started by createViewer3D
 * @property {PopoutBridge} popout               its getters read this facade's current body/topology/positions
 * @property {(model:BodyModel|null) => void} setBody          body.setBody + gizmo.setAnchors(model?.anchors ?? null) + popout.sendBody; fits the camera (resetDir) on the FIRST body only
 * @property {(state:ClothState|null, fabricsByPiece?:Record<string,FabricResolved>|null) => void} setCloth   cloth.setCloth/clear + gizmo.setPlacements(state) + popout.sendClothInit(topology); remembers `state`
 * @property {(state:ClothState, force?:boolean) => void} sync   if force or state.frame !== lastFrame or state.pos !== lastPosRef: cloth.updatePositions(state.pos); popout.sendPositions(state.pos, state.frame, force)
 * @property {(pieceId:string, fabric:FabricResolved) => void} setPieceFabric   cloth.setPieceFabric + popout.sendClothInit(cloth.topology())
 * @property {() => void} fit                    viewer.fit(currentBody)
 * @property {() => void} render                 viewer.controls.update(); viewer.render()
 * @property {() => string} screenshot
 * @property {(on:boolean) => void} setWireframe body + cloth overlays
 * @property {(on:boolean) => void} setLandmarks
 * @property {(on:boolean) => void} setGizmo
 * @property {(a:number) => void} setBodyOpacity
 * @property {() => {fps:number, frames:number, drawCalls:number, triangles:number, V:number, T:number, lastFrameMs:number}} stats
 * @property {() => void} dispose                loop, popout, gizmo, cloth, body, disposeMaterials(), disposeTextures(), viewer
 */

/**
 * Composes everything: createViewer, body/cloth/gizmo handles added to viewer.root, a started loop whose render
 * callback is `controls.update(); viewer.render()`, and the pop-out bridge.
 * @param {HTMLElement} container
 * @param {{ tick?: ((dtMs:number, frame:number) => void)|null, viewer?: Partial<typeof VIEWER_DEFAULTS>, onFps?: (fps:number) => void }} [opts]
 * @returns {Viewer3D}
 * @throws {Error} code 'WebGLUnavailable'
 */
export function createViewer3D(container, opts = {})
```

Wiring contract (what `src/app/wiring.js` does with this facade, listed here so A5 and A8 agree): on the body-built event of section 3.2 → `v.setBody(model)`; on sim build/reset → `v.setCloth(state)` then `v.sync(state, true)`; per frame inside `tick` → `if (playing) solver.step(); v.sync(state)`; on a fabric edit (Fabric panel, section 11) → for every simulated piece using that `FabricInstance`: `v.setPieceFabric(pieceId, resolveFabric(instance))`; on piece selection → `v.gizmo.highlight(piece.placement.anchor); v.setGizmo(true)` / `v.setGizmo(false)`; `#btn-popout` click → `if (!v.popout.open()) statusbar.warn(...)`; the debug API exposes the facade as `__app.viewer` and its stats feed the status bar (`fps`, section 11).

`selftest.js`:

```js
/** @returns {Promise<SelfTestResult[]>}  (section 3.1 SelfTestResult) */
export async function runSelfTest()
```

Runs in the page (needs WebGL2). It appends a hidden container `div` (`position:fixed; left:-10000px; top:0; width:320px; height:240px`) to `document.body`, runs the checks below in order, and always removes the container and disposes everything in `finally`. Each check is one `SelfTestResult` with the exact `name` given; a thrown exception inside a check makes that check fail with `details = String(error)` and the remaining checks still run. Fixtures are built inline: a 10×10 vertex sheet (`V = 100`, `T = 162`, 2D spacing 15 mm) shaped like a `ClothState` (`V, pos, prev, vel, invMass, restPos, pieceOf (all 0), tris, pieces:[{start:0, count:100, pieceId:'sheet', mesh:{positions2d, boundary: the 36 boundary ids CCW, ...}, fabric, layer:0}], frame:0, time:0`); the fabric is `resolveFabric({ id:'main', name:'Main', preset:'cotton', color:'#c8102e', texture:{ kind:'solid', scale_mm:20, color2:'#ffffff' }, overrides:{} })` from `src/core/fabrics.js`; a body fixture uses a three `SphereGeometry(0.3, 24, 16)` translated to y = 1.0 converted to `{ positions, normals, indices: Uint32Array }` with `landmarks: { chestCenter: [0, 1.0, 0] }` and `anchors: { torso: { origin:[0,1.3,0], axis:[0,-1,0], front:[0,0,1], radius:0.36, length:0.6 } }`.

| # | name | pass condition |
|---|---|---|
| 1 | `viewer.create` | `createViewer` returns; `renderer.getContext()` non-null; `viewer.size().width === 320` |
| 2 | `viewer.render.noGlError` | after `viewer.render()`, `gl.getError() === gl.NO_ERROR` and `renderInfo().calls >= 1` |
| 3 | `viewer.frame.default` | after construction `controls.target.y` within 0.001 of `1.26` and `camera.position.distanceTo(target)` in `[3.5, 4.0]` |
| 4 | `body.setBody` | `body.vertexCount() === positions.length / 3`; `bounds()` max y within 1e-3 of 1.3; landmarks group has 1 child named `chestCenter` |
| 5 | `body.badIndices` | `setBody` with an index `>= vertexCount` throws an error whose `code === 'ViewerBadBody'` |
| 6 | `cloth.setCloth.counts` | `cloth.vertexCount() === state.V`, `cloth.triangleCount() === state.tris.length / 3`, `geometry.groups.length === 1`, `geometry.index.count === 3T` |
| 7 | `cloth.material.color` | `object.material[0].color.getHexString() === 'c8102e'` and `map === null` and `side === DoubleSide` |
| 8 | `cloth.updatePositions` | add 0.1 to every y of `state.pos`, call `updatePositions`; position attribute array equals `state.pos` element-wise; every normal component finite and each normal length within 1e-4 of 1 |
| 9 | `cloth.setPieceFabric.texture` | with a stripes fabric (`scale_mm 20`, `color2 '#ffffff'`): `material.map` is a `CanvasTexture` with `image.width === 512`, `repeat.x === 5`, `material.color.getHexString() === 'ffffff'`; `textureCacheSize() === 1`; calling again with the same fabric keeps `textureCacheSize() === 1` and returns the same material object |
| 10 | `materials.allPresets` | `fabricMaterial(resolveFabric(instance))` for each of the 7 preset ids in `FABRIC_PRESETS` (section 9.1) succeeds; `materialCacheSize() === 7` (plus 'main' = 8 total counted before dispose → assert `>= 7`); for every one `transparent === (look.opacity < 1)`, `opacity === look.opacity`, `sheen === look.sheen`, `roughness === look.roughness`, `clearcoat === look.clearcoat` |
| 11 | `textures.kinds` | `drawTextureCanvas(kind, '#336699', '#ffffff')` returns a 512×512 canvas for all six kinds; `fabricTexture({kind:'solid',...})` returns `null`; the pixel at (10, 10) of the `stripes` canvas is `#ffffff` and the pixel at (500, 10) is `#336699` |
| 12 | `cloth.badState` | a copy of the state with `tris[0] = V` makes `setCloth` throw with `code === 'ViewerBadState'` |
| 13 | `topology.clone` | `topologyFromState(state)`: `tris.length === 3T`, `groups[0].count === 3T`, `uv[2] === positions2d[2] / 100`; `structuredClone(topology)` round-trips with equal `V` and `tris` byte length |
| 14 | `gizmo.anchors` | `setAnchors(fixture.anchors)` → `object.children.length === 1`, child named `torso`; `setPlacements(state)` adds one `LineLoop` with 36 points named `sheet`; `highlight('torso')` changes that child's material colour hex to `ffd400` |
| 15 | `loop.frames` | `createLoop({ render })` started; after `await` of 4 animation frames (`requestAnimationFrame` chained) `frameCount >= 2` and `isRunning() === true`; with `renderSuppressed = true` two more frames do not change `frameCount`; `stop()` → `isRunning() === false`. When `document.visibilityState !== 'visible'` the check passes with `details: 'skipped: document hidden'` |
| 16 | `viewer.screenshot` | `screenshot()` starts with `'data:image/png'` and has length > 1000 |
| 17 | `viewer.dispose` | `dispose()` of everything throws nothing; `materialCacheSize() === 0` and `textureCacheSize() === 0` afterwards; the container has no `canvas` child |

Section 13 (acceptance) should include, from the viewer side: after `loadSample('tshirt')` and the first drape, `__app.viewer.stats().V === sim state V`, `stats().triangles > 0` after one rendered frame, and `__app.viewer.screenshot()` returns a PNG data URL longer than 1000 characters. The pop-out is explicitly **not** part of section 13.

**PROPOSED types.js amendment**: none. `ClothTopology`, `Viewer`, `Viewer3D`, the handle typedefs and the pop-out message typedefs are viewer-local contracts declared in `src/viewer3d/index.js` (consumed only by `viewer3d`, `popout` and `app/wiring.js`), so `src/core/types.js` stays unchanged.
