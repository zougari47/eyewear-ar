/**
 * Draws a glasses model over a video or photo with Three.js. No React.
 *
 * The scene is in MediaPipe's camera space (centimetres) and is viewed through
 * the same virtual camera the tracker assumes, so the overlay lines up with the
 * image as long as the canvas covers it exactly.
 */
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
  VSMShadowMap,
  WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CANONICAL_BOUNDARY, CANONICAL_POSITIONS, CANONICAL_TRIANGLES } from './canonicalFace'
import { NEUTRAL_LIGHT, type LightEstimate } from './lighting'
import { CANONICAL_FIT, EAR_CM, TRACKING_CAMERA, type FaceFit, type GlassesPose } from './tracking'

/** How far behind the face the head occluder extends (cm). */
const HEAD_DEPTH_CM = 16
/**
 * The occluder sits this far behind the tracked skin (cm). The canonical face
 * is only an approximation of the real one; without the margin its brow and
 * cheeks cut into rims that really rest in front of them.
 */
const OCCLUDER_RECESS_CM = 0.6

interface LoadedGlasses {
  root: Group
  temples: { node: Object3D; side: 1 | -1; splay: number; hinge: Vector3; fade: { value: number }[] }[]
  info: GlassesInfo
}

/** What a loaded model looks like, to check it follows the model convention. */
export interface GlassesInfo {
  /** Size of the front (without the temples) in millimetres (x: width, y: height, z: depth). */
  size: { x: number; y: number; z: number }
  /** Centre of the front in millimetres; the origin should sit on the bridge. */
  center: { x: number; y: number; z: number }
  /** Separate temples named temple_left / temple_right were found (they swing and fade). */
  temples: number
  /** Meshes whose name starts with "lens". */
  lenses: number
  meshes: number
  triangles: number
}

/** How dark the shadow of the frame on the face gets (0 to 1). */
const SHADOW_STRENGTH = 0.26
/**
 * The shadow-casting light sits this far from the face (cm), a little above
 * the line from the face to the camera. Seen from the camera the shadow then
 * shows as a soft band just below the rims, on both cheeks alike, whichever
 * way the head is turned. (A light fixed in front of the scene put the whole
 * shadow on one cheek as soon as the head turned.)
 */
const SHADOW_LIGHT_DISTANCE_CM = 65
const SHADOW_LIGHT_ELEVATION = (14 * Math.PI) / 180
/** How far to the side the measured light moves the shadow light, and the key light (cm). */
const SHADOW_LIGHT_SIDE = (6 * Math.PI) / 180
const KEY_LIGHT_POSITION = new Vector3(-20, 60, 80)
const FILL_LIGHT_POSITION = new Vector3(-5, 26, 64)
const KEY_LIGHT_SIDE_CM = 45
const SKY_COLOR = new Color(0xffffff)
const GROUND_COLOR = new Color(0x8a8f99)

export interface GlassesRendererOptions {
  /** Let the frame drop a soft shadow on the face (default true). */
  faceShadow?: boolean
}

/**
 * Vertices of the head occluder for a face surface (468 vertices): the face,
 * then a copy of its boundary pushed back, all set back by the recess. The
 * first 468 are also the vertices of the shadow catcher.
 */
function occluderPositions(face: Float32Array): Float32Array {
  const n = face.length / 3
  const ring = CANONICAL_BOUNDARY.length
  const pos = new Float32Array((n + ring) * 3)
  pos.set(face)
  for (let i = 0; i < ring; i++) {
    const v = CANONICAL_BOUNDARY[i] * 3
    pos[(n + i) * 3] = face[v]
    pos[(n + i) * 3 + 1] = face[v + 1]
    pos[(n + i) * 3 + 2] = face[v + 2] - HEAD_DEPTH_CM
  }
  for (let i = 2; i < pos.length; i += 3) pos[i] -= OCCLUDER_RECESS_CM
  return pos
}

/** The tracked face surface alone, set back like the occluder: it receives the frame's shadow. */
function buildShadowCatcher(): BufferGeometry {
  const pos = occluderPositions(CANONICAL_POSITIONS).slice(0, CANONICAL_POSITIONS.length)
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setIndex(Array.from(CANONICAL_TRIANGLES))
  return geo
}

/** Canonical face plus a tube running back from its edge: stands in for the head. */
function buildOccluder(): BufferGeometry {
  const n = CANONICAL_POSITIONS.length / 3
  const ring = CANONICAL_BOUNDARY.length
  const pos = occluderPositions(CANONICAL_POSITIONS)
  const idx: number[] = Array.from(CANONICAL_TRIANGLES)
  for (let i = 0; i < ring; i++) {
    const a = CANONICAL_BOUNDARY[i]
    const b = CANONICAL_BOUNDARY[(i + 1) % ring]
    const a2 = n + i
    const b2 = n + ((i + 1) % ring)
    idx.push(a, a2, b, b, a2, b2)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setIndex(idx)
  return geo
}

export class GlassesRenderer {
  readonly renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(TRACKING_CAMERA.verticalFovDeg, 1, 1, 1000)
  private faceGroup = new Group()
  private glassesGroup = new Group()
  private occluder: Mesh
  private catcher: Mesh
  private fitVersion = CANONICAL_FIT.version
  private shadowLight: DirectionalLight
  private keyLight: DirectionalLight
  private fillLight: DirectionalLight
  private hemiLight: HemisphereLight
  private ambientLight: AmbientLight
  private light: LightEstimate = NEUTRAL_LIGHT
  private readonly tint = new Color()
  private readonly toCamera = new Vector3()
  private debugMesh: Mesh | null = null
  private loader = new GLTFLoader()
  private cache = new Map<string, Promise<LoadedGlasses>>()
  private current: LoadedGlasses | null = null
  private wanted = ''

  constructor(canvas: HTMLCanvasElement, opts: GlassesRendererOptions = {}) {
    const faceShadow = opts.faceShadow !== false
    this.renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = NeutralToneMapping
    this.renderer.toneMappingExposure = 1.0

    // Soft neutral studio lighting; the same environment gives the reflections
    // on lenses and metal.
    const pmrem = new PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.4
    pmrem.dispose()
    this.hemiLight = new HemisphereLight(SKY_COLOR, GROUND_COLOR, 1.1)
    this.ambientLight = new AmbientLight(0xffffff, 0.25)
    this.keyLight = new DirectionalLight(0xffffff, 0.6)
    this.keyLight.position.copy(KEY_LIGHT_POSITION)
    this.scene.add(this.hemiLight, this.ambientLight, this.keyLight)

    // A second light only for the shadow the frame drops on the face. Without
    // that shadow the glasses look pasted onto the picture.
    // always on: setFaceShadow switches the shadow by its light, which needs no shader rebuild
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = VSMShadowMap
    // It sits almost on the line of sight, where any light it gave would
    // mirror straight back off the lenses as a bright dot: it has no intensity
    // and only casts the shadow. The fill light gives the light it used to.
    const fill = new DirectionalLight(0xffffff, 0.35)
    fill.position.copy(FILL_LIGHT_POSITION)
    this.fillLight = fill
    this.scene.add(fill)
    const shadowLight = new DirectionalLight(0xffffff, 0)
    shadowLight.shadow.mapSize.set(512, 512)
    const sc = shadowLight.shadow.camera
    sc.left = sc.bottom = -13
    sc.right = sc.top = 13
    sc.near = 20
    sc.far = 130
    shadowLight.shadow.radius = 8
    shadowLight.shadow.blurSamples = 16
    shadowLight.shadow.bias = -0.0008
    this.shadowLight = shadowLight
    this.scene.add(shadowLight, shadowLight.target)

    this.faceGroup.matrixAutoUpdate = false
    this.glassesGroup.matrixAutoUpdate = false
    this.faceGroup.visible = this.glassesGroup.visible = false

    // Depth-only head: hides whatever passes behind the face without drawing anything.
    const occluderMaterial = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide })
    this.occluder = new Mesh(buildOccluder(), occluderMaterial)
    this.occluder.renderOrder = -1
    this.faceGroup.add(this.occluder)
    const catcher = new Mesh(
      buildShadowCatcher(),
      new ShadowMaterial({ opacity: SHADOW_STRENGTH, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    )
    catcher.receiveShadow = true
    catcher.renderOrder = 1
    this.catcher = catcher
    this.faceGroup.add(catcher)
    this.scene.add(this.faceGroup, this.glassesGroup)
    this.setFaceShadow(faceShadow)
  }

  /** Switch the soft shadow of the frame on the face. */
  setFaceShadow(on: boolean): void {
    this.shadowLight.castShadow = on
    this.catcher.visible = on
  }

  /** Size and parts of the model on show, or null when none is loaded. */
  get glassesInfo(): GlassesInfo | null {
    return this.current?.info ?? null
  }

  /** Make the head occluder visible, as a wireframe or a solid head (for checking the fit). */
  setDebug(mode: boolean | 'solid'): void {
    if (mode && !this.debugMesh) {
      const geometry = this.occluder.geometry.clone()
      geometry.computeVertexNormals()
      this.debugMesh = new Mesh(geometry)
      this.faceGroup.add(this.debugMesh)
    }
    if (!this.debugMesh) return
    this.fitVersion = -1 // the new mesh starts as the canonical head: fit it on the next pose
    this.debugMesh.visible = !!mode
    this.debugMesh.material =
      mode === 'solid'
        ? new MeshStandardMaterial({ color: 0xc9a48c, roughness: 0.8, side: DoubleSide })
        : new MeshBasicMaterial({ color: 0x00ff88, wireframe: true, transparent: true, opacity: 0.35 })
  }

  /** Turn the head occluder off to see the whole model (for checking only). */
  setOccluderEnabled(on: boolean): void {
    this.occluder.visible = on
  }

  /** Match the canvas to the displayed size and the aspect ratio of the source image. */
  setSize(cssWidth: number, cssHeight: number, sourceAspect: number): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(cssWidth, cssHeight, false)
    this.camera.aspect = sourceAspect
    this.camera.updateProjectionMatrix()
  }

  /** Start loading a model so that switching to it later is instant. */
  preload(url: string): Promise<unknown> {
    return this.load(url)
  }

  async setGlasses(url: string): Promise<void> {
    this.wanted = url
    const loaded = await this.load(url)
    if (this.wanted !== url) return // a newer choice won
    if (this.current) this.glassesGroup.remove(this.current.root)
    this.current = loaded
    this.glassesGroup.add(loaded.root)
  }

  private load(url: string): Promise<LoadedGlasses> {
    let p = this.cache.get(url)
    if (!p) {
      p = this.loader.loadAsync(url).then((gltf) => this.prepare(gltf.scene))
      p.catch(() => this.cache.delete(url))
      this.cache.set(url, p)
    }
    return p
  }

  private prepare(root: Group): LoadedGlasses {
    const temples: LoadedGlasses['temples'] = []
    let lenses = 0
    let meshes = 0
    let triangles = 0
    root.traverse((obj) => {
      const mesh = obj as Mesh
      if (!mesh.isMesh) return
      meshes++
      const g = mesh.geometry
      triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3
      if (mesh.name.startsWith('lens')) lenses++
      const isTemple = mesh.name === 'temple_left' || mesh.name === 'temple_right'
      const isLens = mesh.name.startsWith('lens')
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) =>
        isLens ? m.clone() : frameMaterial(m as MeshStandardMaterial),
      )
      // temples run along the head; their shadows smear over the cheeks, so only the front casts
      mesh.castShadow = !isLens && !isTemple
      mesh.material = Array.isArray(mesh.material) ? materials : materials[0]
      if (isLens) {
        mesh.renderOrder = 2
        materials.forEach((m) => lensMaterial(m as MeshStandardMaterial))
      }
      if (isTemple) {
        mesh.geometry.computeBoundingBox()
        const box = mesh.geometry.boundingBox as Box3
        const length = -box.min.z
        // outward slope of the temple as built, from the middle of its length
        const posAttr = mesh.geometry.getAttribute('position')
        let sx = 0
        let sz = 0
        let count = 0
        for (let i = 0; i < posAttr.count; i++) {
          const z = posAttr.getZ(i)
          if (z < -0.5 * length && z > -0.7 * length) {
            sx += posAttr.getX(i)
            sz += z
            count++
          }
        }
        const side: 1 | -1 = mesh.name === 'temple_left' ? 1 : -1
        const splay = count ? Math.atan2((side * sx) / count, -sz / count) : 0
        const fade = materials.map((m) => templeFade(m))
        temples.push({ node: mesh, side, splay, hinge: mesh.position.clone(), fade })
      }
    })
    // the front alone: temples splay out and would add to the width
    root.updateMatrixWorld(true)
    const box = new Box3()
    root.traverse((obj) => {
      const mesh = obj as Mesh
      if (mesh.isMesh && mesh.name !== 'temple_left' && mesh.name !== 'temple_right') box.expandByObject(mesh, true)
    })
    const size = box.getSize(new Vector3()).multiplyScalar(1000)
    const center = box.getCenter(new Vector3()).multiplyScalar(1000)
    const info: GlassesInfo = {
      size: { x: size.x, y: size.y, z: size.z },
      center: { x: center.x, y: center.y, z: center.z },
      temples: temples.length,
      lenses,
      meshes,
      triangles: Math.round(triangles),
    }
    return { root, temples, info }
  }

  /** Light the glasses like the picture they are drawn on; null goes back to the neutral studio light. */
  setLighting(light: LightEstimate | null): void {
    const l = (this.light = light ?? NEUTRAL_LIGHT)
    this.renderer.toneMappingExposure = l.exposure
    this.tint.setRGB(l.tint[0], l.tint[1], l.tint[2])
    this.hemiLight.color.copy(SKY_COLOR).multiply(this.tint)
    this.hemiLight.groundColor.copy(GROUND_COLOR).multiply(this.tint)
    this.ambientLight.color.copy(this.tint)
    this.keyLight.color.copy(this.tint)
    this.fillLight.color.copy(this.tint)
    this.keyLight.position.copy(KEY_LIGHT_POSITION)
    this.keyLight.position.x += l.side * KEY_LIGHT_SIDE_CM
  }

  /** Place the glasses, or hide them when pose is null (no face). */
  setPose(pose: GlassesPose | null): void {
    const visible = !!pose && !!this.current
    this.faceGroup.visible = !!pose
    this.glassesGroup.visible = visible
    if (!pose) return
    this.faceGroup.matrix.copy(pose.faceMatrix)
    this.glassesGroup.matrix.copy(pose.matrix)
    // shadow light: from the face towards the camera (at the origin), raised
    // a little and moved to the side the light in the picture comes from
    const e = pose.faceMatrix.elements
    const face = this.shadowLight.target.position.set(e[12], e[13], e[14])
    const distance = face.length()
    this.toCamera
      .set(
        Math.tan(SHADOW_LIGHT_SIDE * this.light.side) * distance,
        Math.tan(SHADOW_LIGHT_ELEVATION) * distance,
        0,
      )
      .sub(face)
      .normalize()
    this.shadowLight.position.copy(face).addScaledVector(this.toCamera, SHADOW_LIGHT_DISTANCE_CM)
    this.shadowLight.target.updateMatrixWorld()
    const fit = pose.fit ?? CANONICAL_FIT
    if (fit.version !== this.fitVersion) {
      this.fitVersion = fit.version
      this.fitHead(fit.positions ?? CANONICAL_POSITIONS)
    }
    if (this.current) this.fitTemples(this.current, pose.faceScale, fit)
  }

  /** Give the head occluder and the shadow catcher the shape of this face. */
  private fitHead(face: Float32Array): void {
    const pos = occluderPositions(face)
    const meshes = [this.occluder, this.catcher]
    if (this.debugMesh) meshes.push(this.debugMesh)
    for (const mesh of meshes) {
      const attr = mesh.geometry.getAttribute('position') as BufferAttribute
      ;(attr.array as Float32Array).set(pos.subarray(0, attr.array.length))
      attr.needsUpdate = true
      mesh.geometry.computeBoundingSphere()
    }
    this.debugMesh?.geometry.computeVertexNormals()
  }

  /**
   * Real temples flex to the width of the head. Swing each temple about its
   * hinge so it runs to the side of the head above the ear, and fade it out
   * there, where hair and the ear take over.
   */
  private fitTemples(glasses: LoadedGlasses, faceScale: number, fit: FaceFit): void {
    const cmPerMetre = 100 / faceScale
    for (const t of glasses.temples) {
      // how far out from the middle of the face the hinge is, on its own side
      const hx = Math.abs(t.hinge.x) * cmPerMetre + t.side * fit.bridge.x
      const hz = t.hinge.z * cmPerMetre + fit.bridge.z
      const back = Math.max(1, hz - EAR_CM.z)
      const wanted = Math.atan2(fit.earX - hx, back)
      const delta = Math.min(0.21, Math.max(-0.1, wanted - t.splay))
      t.node.rotation.y = -t.side * delta // +Y rotation swings a backward-pointing temple towards -X
      const earDistance = back / cmPerMetre // metres behind the hinge
      for (const u of t.fade) u.value = earDistance
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.renderer.dispose()
  }
}

/**
 * Polished acetate has a clear glossy skin over the colour; metal keeps its own
 * finish. Either way the material is a private copy, so it can be patched.
 * Everything the GLB material carries that matters here is copied over: add new
 * properties to this list when the generator starts writing them.
 */
function frameMaterial(m: MeshStandardMaterial): Material {
  if (!m.isMeshStandardMaterial || m.metalness > 0.5) return m.clone()
  const clear = m.transparent && m.opacity < 0.95
  const p = new MeshPhysicalMaterial({
    name: m.name,
    color: m.color,
    map: m.map,
    normalMap: m.normalMap,
    roughness: Math.max(m.roughness, clear ? 0.12 : 0.3),
    metalness: m.metalness,
    transparent: m.transparent,
    opacity: m.opacity,
    side: m.side,
    depthWrite: clear ? true : m.depthWrite,
    alphaTest: m.alphaTest,
    clearcoat: 1,
    clearcoatRoughness: clear ? 0.03 : 0.06,
  })
  if (clear) clearAcetate(p)
  return p
}

/**
 * See-through (crystal) acetate: a clear body that thickens to its colour where
 * it is seen edge-on, as a solid clear block does, and keeps its highlights
 * whatever its opacity. Real refraction (three.js transmission) cannot work
 * here: the video is a separate element behind a transparent canvas, so there is
 * nothing in the scene to refract.
 */
function clearAcetate(m: MeshPhysicalMaterial): void {
  addShaderPatch(m, 'clear-acetate', (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float acetateEdge = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
       float acetateSpec = dot(totalSpecular, vec3(0.299, 0.587, 0.114));
       diffuseColor.a = clamp(diffuseColor.a * 0.6 + (1.0 - diffuseColor.a) * pow(acetateEdge, 3.0) * 0.6
                              + acetateSpec * 0.5, 0.0, 1.0);
       #include <opaque_fragment>`,
    )
  })
}

type ShaderHook = (shader: Parameters<Material['onBeforeCompile']>[0]) => void

/**
 * Several patches on one material (a clear temple also fades behind the ear):
 * each adds its hook and its share of the program cache key.
 */
function addShaderPatch(m: Material, key: string, hook: ShaderHook): void {
  const data = m.userData as { hooks?: ShaderHook[]; keys?: string[] }
  if (!data.hooks) {
    data.hooks = []
    data.keys = []
    m.onBeforeCompile = (shader) => {
      for (const h of data.hooks as ShaderHook[]) h(shader)
    }
    m.customProgramCacheKey = () => (data.keys as string[]).join('+')
  }
  data.hooks.push(hook)
  data.keys?.push(key)
  m.needsUpdate = true
}

/**
 * Lenses are nearly transparent, which would also wash out their reflections.
 * Let the reflected light raise the opacity so highlights stay visible.
 */
function lensMaterial(m: MeshStandardMaterial): void {
  // a mirror coating is written as a metallic lens: it shows the room, nearly opaque
  const mirror = m.metalness > 0.5
  m.transparent = true
  m.depthWrite = false
  m.side = DoubleSide
  m.roughness = Math.min(m.roughness, mirror ? 0.05 : 0.08)
  m.envMapIntensity = mirror ? 1.4 : 0.8
  addShaderPatch(m, 'lens', (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float lensSpec = dot(totalSpecular, vec3(0.299, 0.587, 0.114));
       diffuseColor.a = clamp(diffuseColor.a + lensSpec * 0.35, 0.0, 1.0);
       #include <opaque_fragment>`,
    )
  })
}

/** Dissolve a temple around the given distance behind its hinge (metres, mesh space). */
function templeFade(m: Material): { value: number } {
  const uniform = { value: 0.1 }
  addShaderPatch(m, 'temple-fade', (shader) => {
    shader.uniforms.uEarDistance = uniform
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vBehindHinge;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBehindHinge = -position.z;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBehindHinge;\nuniform float uEarDistance;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         float templeFade = smoothstep(uEarDistance * 0.72, uEarDistance * 1.02, vBehindHinge);
         float templeNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
         if (templeFade > templeNoise) discard;`,
      )
  })
  return uniform
}
