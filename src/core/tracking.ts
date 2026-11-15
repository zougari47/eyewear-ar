/**
 * Face tracking and glasses placement. No React, no DOM beyond the image
 * source: a video frame or an image goes in, the pose of the glasses comes out.
 *
 * Coordinate systems (from MediaPipe's face geometry pipeline, see
 * face_geometry_from_landmarks_graph.cc and geometry_pipeline.cc):
 *
 *  - FaceLandmarker's facial transformation matrix maps the *canonical face
 *    model* (centimetres, Y up, +Z out of the face, +X to the subject's left)
 *    into *camera space*: right-handed, centimetres, camera at the origin
 *    looking down -Z, Y up.
 *  - That camera is a fixed virtual one: perspective, 63 degrees vertical field
 *    of view, aspect ratio of the input image, near plane 1 cm. It is not the
 *    real webcam; the pose is only consistent when rendered with this camera.
 *  - Distance is recovered by assuming the face has the size of the canonical
 *    model, so the matrix carries no information about how big this person's
 *    face really is. The iris does: its diameter is nearly constant in adults
 *    (11.7 mm), so the tracked iris gives the true scale when it is large
 *    enough in the image to measure (see faceScale).
 *
 * The glasses models are in metres with the same axes as the canonical face
 * (Y up, front towards +Z, origin at the centre of the bridge), so placing a
 * frame is: scale metres to centimetres, move the origin to the point on the
 * nose where a bridge sits, then apply the facial transformation matrix.
 *
 * The matrix only moves the canonical face rigidly; it says nothing about the
 * shape of this face. The shape comes from the landmarks: each one is a ray
 * through the virtual camera plus a relative depth, which puts it in camera
 * space and, through the inverse of the matrix, in canonical face coordinates
 * (see measureShape). Averaged over frontal frames this gives the person's own
 * nose bridge, face width and face surface (FaceFit).
 */
import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { CANONICAL_POSITIONS } from './canonicalFace'
import { OneEuroQuaternion, OneEuroVector, RollingMedian } from './smoothing'

/** The virtual camera MediaPipe assumes for the facial transformation matrix. */
export const TRACKING_CAMERA = { verticalFovDeg: 63, near: 1, far: 10000 } as const

/**
 * Where the centre of a bridge rests, in canonical face coordinates (cm).
 * On the canonical face the eyes are at y = 2.6, the corneas at z = 3.9 and the
 * ridge of the nose at this height at z = 5.3. This point puts the bridge about
 * 5 mm above the pupils and the lenses about 13 mm in front of the corneas.
 */
export const BRIDGE_ANCHOR_CM = new Vector3(0, 3.15, 5.6)

/** Side of the head at the top of the ear on the canonical face (cm). */
export const EAR_CM = { x: 7.85, z: -2.0 } as const

/** Landmarks that are vertices of the canonical face (the rest are the irises). */
const FACE_VERTICES = 468
/** Ridge of the nose between the eyes, where a bridge rests. */
const RIDGE = [168, 6]
/** Inner and outer corners of both eyes. */
const EYE_CORNERS = [33, 133, 362, 263]
/** Sides of the face in front of the ears. */
const FACE_SIDES = [234, 454]
/** The shape is only measured on a head turned less than this, and a face at least this wide. */
const FIT_MAX_TURN_DEG = 15
const FIT_MIN_FACE_PX = 110
/** A sample further than this from the canonical face (RMS, cm) is a bad detection. */
const FIT_MAX_RESIDUAL_CM = 1.2
/** Samples averaged before the fit is shown, and after which it is locked. */
const FIT_MIN_SAMPLES = 12
const FIT_LOCK_SAMPLES = 300
/** Time over which the glasses move from the average face to the fitted one. */
const FIT_EASE_S = 0.5
/** A face gone for longer than this may be another person: measure again. */
const FIT_LOST_RESET_S = 2
/** Limits on how far the fit may leave the canonical face. */
const FIT_MAX_VERTEX_CM = 1.5
const FIT_MAX_BRIDGE_CM = 0.8
const FIT_MAX_BRIDGE_X_CM = 0.3
const FIT_MAX_EAR = 0.15

/** Average adult horizontal iris diameter. */
const IRIS_DIAMETER_CM = 1.17
/** Iris size in pixels below which it is ignored, and from which it is fully trusted. */
const IRIS_MIN_PX = 10
const IRIS_FULL_PX = 30
/** Centre of the eyes in canonical face coordinates (cm). */
const EYE_CM = [new Vector3(-3.15, 2.62, 3.6), new Vector3(3.15, 2.62, 3.6)]
/** Iris landmarks: centre followed by four points on the rim, for each eye. */
const IRIS = [
  [468, 469, 470, 471, 472],
  [473, 474, 475, 476, 477],
]

export type TrackingSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap

/** What is known about the shape of this face, in canonical face coordinates (cm). */
export interface FaceFit {
  /** Where the centre of the bridge rests on this face. */
  bridge: Vector3
  /** Half the width of the head at the ears. */
  earX: number
  /** The 468 face vertices fitted to this face, or null for the canonical face. */
  positions: Float32Array | null
  /** Changes whenever the fit does. */
  version: number
  /** 0 = canonical face, 1 = fully fitted. */
  strength: number
  /** RMS distance of the measured face from the canonical one (cm), for diagnostics. */
  residual: number
}

/** The canonical face: used until, or instead of, a measured fit. */
export const CANONICAL_FIT: FaceFit = {
  bridge: BRIDGE_ANCHOR_CM,
  earX: EAR_CM.x,
  positions: null,
  version: 0,
  strength: 0,
  residual: 0,
}

export interface GlassesPose {
  /** Glasses model space (metres) to camera space (cm). Render with TRACKING_CAMERA. */
  matrix: Matrix4
  /** Canonical face space (cm) to camera space (cm), smoothed. */
  faceMatrix: Matrix4
  /** Size of this face relative to the canonical face, from the iris (1 when unknown). */
  faceScale: number
  /** The 478 normalised image landmarks of the face. */
  landmarks: NormalizedLandmark[]
  /** Shape of this face; the canonical face when absent. */
  fit?: FaceFit
}

export interface FaceTrackerOptions {
  /** Folder that holds the MediaPipe vision WASM files. */
  wasmPath: string
  /** URL of face_landmarker.task. */
  modelPath: string
  /** "GPU" is faster; falls back to "CPU" automatically if it cannot start. */
  delegate?: 'GPU' | 'CPU'
  /** Correct the scale with the iris size (default true). */
  scaleFromIris?: boolean
  /** Fit the bridge, temples and head occluder to the shape of this face (default true). */
  fitToFace?: boolean
}

function sourceSize(source: TrackingSource): [number, number] {
  if (source instanceof HTMLVideoElement) return [source.videoWidth, source.videoHeight]
  if (source instanceof HTMLImageElement) return [source.naturalWidth, source.naturalHeight]
  return [source.width, source.height]
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/**
 * The face vertices of one frame in canonical face coordinates (cm), or null
 * when the frame is not good enough to measure a shape from.
 *
 * A landmark's x and y fix a ray through the virtual camera. Its z is a depth
 * relative to the head, in an arbitrary unit, so the distance along the ray is
 * a + b * z for some a and b; they are the two numbers that bring the points
 * closest to the canonical face as the matrix placed it (linear least squares).
 * What is left after that is the difference in shape between this face and the
 * canonical one. This is the unprojection MediaPipe's geometry_pipeline.cc does
 * before it solves for the matrix.
 */
function measureShape(
  landmarks: NormalizedLandmark[],
  faceMatrix: Matrix4,
  source: TrackingSource,
): { positions: Float32Array; residual: number } | null {
  if (landmarks.length < FACE_VERTICES) return null
  const [w, h] = sourceSize(source)
  if (!w || !h) return null
  const e = faceMatrix.elements
  const forward = new Vector3(e[8], e[9], e[10]).normalize()
  if (forward.z < Math.cos((FIT_MAX_TURN_DEG * Math.PI) / 180)) return null
  const [l, r] = FACE_SIDES.map((i) => landmarks[i])
  if (Math.hypot((l.x - r.x) * w, (l.y - r.y) * h) < FIT_MIN_FACE_PX) return null

  const ty = Math.tan((TRACKING_CAMERA.verticalFovDeg * Math.PI) / 360)
  const tx = (ty * w) / h
  const n = FACE_VERTICES
  const rays = new Float32Array(n * 2)
  const target = new Float32Array(n * 3)
  const c = new Vector3()
  let s0 = 0
  let s1 = 0
  let s2 = 0
  let p0 = 0
  let p1 = 0
  for (let i = 0; i < n; i++) {
    const lm = landmarks[i]
    const dx = (lm.x - 0.5) * 2 * tx
    const dy = (0.5 - lm.y) * 2 * ty // the ray is (dx, dy, -1)
    c.fromArray(CANONICAL_POSITIONS, i * 3).applyMatrix4(faceMatrix)
    rays[i * 2] = dx
    rays[i * 2 + 1] = dy
    c.toArray(target, i * 3)
    const len2 = dx * dx + dy * dy + 1
    const along = dx * c.x + dy * c.y - c.z
    s0 += len2
    s1 += len2 * lm.z
    s2 += len2 * lm.z * lm.z
    p0 += along
    p1 += along * lm.z
  }
  const det = s0 * s2 - s1 * s1
  if (!(Math.abs(det) > 1e-9)) return null
  const a = (p0 * s2 - p1 * s1) / det
  const b = (s0 * p1 - s1 * p0) / det

  const toFace = faceMatrix.clone().invert()
  const positions = new Float32Array(n * 3)
  let err = 0
  for (let i = 0; i < n; i++) {
    const t = a + b * landmarks[i].z
    if (!(t > 1)) return null
    c.set(rays[i * 2] * t, rays[i * 2 + 1] * t, -t)
    err +=
      (c.x - target[i * 3]) ** 2 + (c.y - target[i * 3 + 1]) ** 2 + (c.z - target[i * 3 + 2]) ** 2
    c.applyMatrix4(toFace).toArray(positions, i * 3)
  }
  const residual = Math.sqrt(err / n)
  if (!(residual < FIT_MAX_RESIDUAL_CM)) return null
  return { positions, residual }
}

let fitVersion = 0

/**
 * Fit for a measured face. strength blends from the canonical face (0) to the
 * measured one (1); every result stays within fixed limits of the canonical
 * face, so a bad measurement cannot put the glasses somewhere absurd.
 */
function buildFit(measured: Float32Array, strength: number, residual: number): FaceFit {
  const positions = new Float32Array(measured.length)
  for (let j = 0; j < measured.length; j++) {
    const d = clamp(measured[j] - CANONICAL_POSITIONS[j], -FIT_MAX_VERTEX_CM, FIT_MAX_VERTEX_CM)
    positions[j] = CANONICAL_POSITIONS[j] + strength * d
  }
  // mean offset of some vertices from their canonical place, along one axis
  const offset = (ids: number[], axis: number) =>
    ids.reduce((sum, i) => sum + positions[i * 3 + axis] - CANONICAL_POSITIONS[i * 3 + axis], 0) / ids.length
  // The bridge rests on the ridge of the nose (sideways and in depth) and is
  // worn at a height relative to the eyes.
  const bridge = BRIDGE_ANCHOR_CM.clone()
  bridge.x += clamp(offset(RIDGE, 0), -FIT_MAX_BRIDGE_X_CM, FIT_MAX_BRIDGE_X_CM)
  bridge.y += clamp(offset(EYE_CORNERS, 1), -FIT_MAX_BRIDGE_CM, FIT_MAX_BRIDGE_CM)
  bridge.z += clamp(offset(RIDGE, 2), -FIT_MAX_BRIDGE_CM, FIT_MAX_BRIDGE_CM)
  // The ears are not tracked: take them to be as much wider or narrower than
  // the canonical ones as the face is in front of them.
  const [l, r] = FACE_SIDES
  const width = Math.abs(positions[l * 3] - positions[r * 3])
  const canonicalWidth = Math.abs(CANONICAL_POSITIONS[l * 3] - CANONICAL_POSITIONS[r * 3])
  const earX = EAR_CM.x * clamp(width / canonicalWidth, 1 - FIT_MAX_EAR, 1 + FIT_MAX_EAR)
  return { bridge, earX, positions, version: ++fitVersion, strength, residual }
}

export class FaceTracker {
  private video: FaceLandmarker | null = null
  private image: FaceLandmarker | null = null
  private fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null
  private delegate: 'GPU' | 'CPU'
  private lastTime = -1

  // Tuned on centimetres and radians: steady at rest, a few ms of lag in motion.
  private posFilter = new OneEuroVector(1.2, 0.35)
  private rotFilter = new OneEuroQuaternion(1.2, 5.0)
  private irisScale = new RollingMedian(45)

  // Shape of the face in view: mean of the good samples, locked once there are enough.
  private shape: Float32Array | null = null
  private shapeSamples = 0
  private shapeResidual = 0
  private fitEase = 0
  private fit: FaceFit = CANONICAL_FIT
  private lostFor = 0

  private readonly pos = new Vector3()
  private readonly quat = new Quaternion()
  private readonly scl = new Vector3()

  private constructor(private opts: FaceTrackerOptions) {
    this.delegate = opts.delegate ?? 'GPU'
  }

  static async create(opts: FaceTrackerOptions): Promise<FaceTracker> {
    const tracker = new FaceTracker(opts)
    tracker.fileset = await FilesetResolver.forVisionTasks(opts.wasmPath)
    return tracker
  }

  private async make(runningMode: 'VIDEO' | 'IMAGE'): Promise<FaceLandmarker> {
    const build = (delegate: 'GPU' | 'CPU') =>
      FaceLandmarker.createFromOptions(this.fileset!, {
        baseOptions: { modelAssetPath: this.opts.modelPath, delegate },
        runningMode,
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
        outputFaceBlendshapes: false,
      })
    try {
      return await build(this.delegate)
    } catch (err) {
      if (this.delegate === 'CPU') throw err
      this.delegate = 'CPU'
      return build('CPU')
    }
  }

  /** Load the model for live video (call once before trackVideo). */
  async prepareVideo(): Promise<void> {
    this.video ??= await this.make('VIDEO')
  }

  /** Load the model for still images (call once before trackImage). */
  async prepareImage(): Promise<void> {
    this.image ??= await this.make('IMAGE')
  }

  /** The delegate in use: "CPU" when the GPU was asked for but could not start. */
  get activeDelegate(): 'GPU' | 'CPU' {
    return this.delegate
  }

  /** Change the scale and fit options while running; the face is measured again. */
  setOptions(opts: Pick<FaceTrackerOptions, 'scaleFromIris' | 'fitToFace'>): void {
    this.opts = { ...this.opts, ...opts }
    this.reset()
  }

  /** Switch between GPU and CPU. The models are rebuilt by the next prepareVideo / prepareImage. */
  setDelegate(delegate: 'GPU' | 'CPU'): void {
    this.opts = { ...this.opts, delegate }
    this.delegate = delegate
    this.dispose()
    this.reset()
  }

  /** Forget the smoothing history, e.g. when the camera restarts. */
  reset(): void {
    this.posFilter.reset()
    this.rotFilter.reset()
    this.irisScale.reset()
    this.resetShape()
    this.lastTime = -1
  }

  private resetShape(): void {
    this.shape = null
    this.shapeSamples = 0
    this.fitEase = 0
    this.fit = CANONICAL_FIT
  }

  /** Add a sample (if any) to the shape of the face in view and return the fit to use now. */
  private updateFit(sample: { positions: Float32Array; residual: number } | null, dt: number): FaceFit {
    let changed = false
    if (sample && this.shapeSamples < FIT_LOCK_SAMPLES) {
      const k = 1 / ++this.shapeSamples
      if (!this.shape) this.shape = new Float32Array(sample.positions.length)
      for (let j = 0; j < this.shape.length; j++) this.shape[j] += (sample.positions[j] - this.shape[j]) * k
      this.shapeResidual += (sample.residual - this.shapeResidual) * k
      changed = true
    }
    if (!this.shape || this.shapeSamples < FIT_MIN_SAMPLES) return this.fit
    if (this.fitEase < 1) {
      this.fitEase = Math.min(1, this.fitEase + (dt > 0 ? dt : 1 / 30) / FIT_EASE_S)
      changed = true
    }
    if (changed) {
      const s = this.fitEase
      this.fit = buildFit(this.shape, s * s * (3 - 2 * s), this.shapeResidual)
    }
    return this.fit
  }

  /** Track one video frame. timestampMs must increase from call to call. */
  trackVideo(source: TrackingSource, timestampMs: number): GlassesPose | null {
    if (!this.video) throw new Error('call prepareVideo() first')
    if (timestampMs <= this.lastTime) timestampMs = this.lastTime + 1
    const dt = this.lastTime < 0 ? 0 : (timestampMs - this.lastTime) / 1000
    this.lastTime = timestampMs
    const result = this.video.detectForVideo(source, timestampMs)
    const pose = this.poseFrom(result, source, dt > 0.5 ? 0 : dt, true)
    if (pose) {
      this.lostFor = 0
    } else {
      this.posFilter.reset()
      this.rotFilter.reset()
      this.lostFor += dt
      if (this.lostFor > FIT_LOST_RESET_S) this.resetShape()
    }
    return pose
  }

  /** Detect the face in a still image (no smoothing). */
  trackImage(source: TrackingSource): GlassesPose | null {
    if (!this.image) throw new Error('call prepareImage() first')
    return this.poseFrom(this.image.detect(source), source, 0, false)
  }

  private poseFrom(
    result: FaceLandmarkerResult,
    source: TrackingSource,
    dt: number,
    smooth: boolean,
  ): GlassesPose | null {
    const m = result.facialTransformationMatrixes?.[0]
    const landmarks = result.faceLandmarks?.[0]
    if (!m || !landmarks || m.data.length !== 16) return null

    const faceMatrix = new Matrix4().fromArray(m.data) // column-major, like three.js
    if (m.data[12] === 0 && m.data[13] === 0 && m.data[14] === 0 && m.data[11] !== 0) {
      faceMatrix.transpose() // defensive: a row-major build of the library
    }
    // the landmarks belong to the unsmoothed matrix, so measure the shape first
    const sample = this.opts.fitToFace !== false ? measureShape(landmarks, faceMatrix, source) : null
    if (smooth) {
      faceMatrix.decompose(this.pos, this.quat, this.scl)
      this.posFilter.filter(this.pos, dt)
      this.rotFilter.filter(this.quat, dt)
      faceMatrix.compose(this.pos, this.quat, this.scl)
    }

    let faceScale = 1
    if (this.opts.scaleFromIris !== false) {
      const measured = this.measureIrisScale(landmarks, faceMatrix, source)
      if (smooth) {
        if (measured !== null) this.irisScale.push(measured)
        faceScale = this.irisScale.value(1)
      } else if (measured !== null) {
        faceScale = measured
      }
    }

    let fit = CANONICAL_FIT
    if (this.opts.fitToFace !== false) {
      if (smooth) fit = this.updateFit(sample, dt)
      // one sample is noisy: a still image only goes half way to what it measured
      else if (sample) fit = buildFit(sample.positions, 0.5, sample.residual)
    }

    return {
      matrix: glassesMatrix(faceMatrix, faceScale, fit.bridge),
      faceMatrix,
      faceScale,
      landmarks,
      fit,
    }
  }

  /**
   * Real size of the face relative to the canonical face.
   *
   * The pipeline places every face at the distance where it would have the
   * canonical size. Measuring the iris at that distance and comparing it with
   * the true iris diameter tells how much larger or smaller the real face is.
   */
  private measureIrisScale(
    landmarks: NormalizedLandmark[],
    faceMatrix: Matrix4,
    source: TrackingSource,
  ): number | null {
    if (landmarks.length < 478) return null
    const [w, h] = sourceSize(source)
    if (!w || !h) return null
    // skip when the head is turned: the iris is foreshortened and half hidden
    const e = faceMatrix.elements
    const forward = new Vector3(e[8], e[9], e[10]).normalize()
    if (forward.z < Math.cos((22 * Math.PI) / 180)) return null

    const cmPerPixelAtUnitDepth = (2 * Math.tan((TRACKING_CAMERA.verticalFovDeg * Math.PI) / 360)) / h
    const depths = EYE_CM.map((p) => -p.clone().applyMatrix4(faceMatrix).z)
    const depth = (depths[0] + depths[1]) / 2
    if (!(depth > 1)) return null
    // horizontal diameter of each iris (the eyelids hide the vertical one)
    let sum = 0
    for (const ids of IRIS) {
      const p = ids.map((i) => landmarks[i])
      const d1 = Math.hypot((p[1].x - p[3].x) * w, (p[1].y - p[3].y) * h)
      const d2 = Math.hypot((p[2].x - p[4].x) * w, (p[2].y - p[4].y) * h)
      sum += Math.max(d1, d2)
    }
    const irisPx = sum / IRIS.length
    const irisCm = irisPx * cmPerPixelAtUnitDepth * depth
    const scale = IRIS_DIAMETER_CM / irisCm
    if (!Number.isFinite(scale)) return null
    // A small iris cannot be measured to better than about a pixel, which is
    // worse than simply assuming an average face. Trust the measurement in
    // proportion to its resolution: not at all below 10 px, fully from 30 px.
    const trust = Math.min(1, Math.max(0, (irisPx - IRIS_MIN_PX) / (IRIS_FULL_PX - IRIS_MIN_PX)))
    return 1 + trust * (Math.min(1.15, Math.max(0.87, scale)) - 1)
  }

  dispose(): void {
    this.video?.close()
    this.image?.close()
    this.video = this.image = null
  }
}

/**
 * Glasses model space (metres) to camera space, for a face matrix.
 * faceScale > 1 means the real face is larger than the canonical one, so
 * glasses of a given real size must be drawn smaller relative to it. bridge is
 * where the centre of the bridge rests, in canonical face coordinates.
 */
export function glassesMatrix(faceMatrix: Matrix4, faceScale = 1, bridge: Vector3 = BRIDGE_ANCHOR_CM): Matrix4 {
  const metresToFace = 100 / faceScale
  const local = new Matrix4()
    .makeTranslation(bridge.x, bridge.y, bridge.z)
    .multiply(new Matrix4().makeScale(metresToFace, metresToFace, metresToFace))
  return new Matrix4().multiplyMatrices(faceMatrix, local)
}
