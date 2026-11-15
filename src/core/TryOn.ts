/**
 * Virtual try-on widget without any framework: give it an element, it shows a
 * mirrored webcam (or an uploaded photo) with a glasses model on the face.
 *
 *   const tryOn = new TryOn(element, { wasmPath, modelPath })
 *   await tryOn.setGlasses('/models/round-01.glb')
 *   await tryOn.startCamera()        // or: await tryOn.showPhoto(fileOrUrl)
 */
import { LightProbe } from './lighting'
import { GlassesRenderer, type GlassesInfo } from './renderer'
import { FaceTracker, type FaceTrackerOptions, type GlassesPose } from './tracking'

export type TryOnStatus =
  | 'idle'
  | 'loading'
  | 'tracking'
  | 'no-face'
  | 'camera-denied'
  | 'camera-unavailable'
  | 'error'

export interface TryOnOptions extends FaceTrackerOptions {
  onStatus?: (status: TryOnStatus, detail?: string) => void
  /** Called after every tracked frame (for diagnostics). */
  onPose?: (pose: GlassesPose | null) => void
  /** Draw the head occluder so its fit can be checked: a wireframe (true) or a solid head. */
  debug?: boolean | 'solid'
  /** Hide what passes behind the head (default true). */
  occlusion?: boolean
  /** Let the frame drop a soft shadow on the face (default true). */
  faceShadow?: boolean
  /**
   * Match the glasses to the camera image: light them like the face in it and
   * soften them to its sharpness (default true).
   */
  matchCamera?: boolean
}

/** The options that can be changed while the widget runs, with TryOn.update. */
export type TryOnSettings = Required<
  Pick<TryOnOptions, 'debug' | 'occlusion' | 'faceShadow' | 'matchCamera' | 'scaleFromIris' | 'fitToFace' | 'delegate'>
>

/** How often the light in the video is measured. */
const LIGHT_INTERVAL_MS = 200
/**
 * Blur that brings the glasses down to the sharpness of the picture, in pixels
 * of the source: video is softer than its resolution, a photo less so.
 */
const VIDEO_BLUR_PX = 0.7
const PHOTO_BLUR_PX = 0.4
const MAX_BLUR_CSS_PX = 1.2

const STYLE = 'position:absolute;inset:0;width:100%;height:100%;display:block;'

export class TryOn {
  private stage: HTMLDivElement
  private video: HTMLVideoElement
  private photo: HTMLImageElement
  private canvas: HTMLCanvasElement
  private renderer: GlassesRenderer
  private tracker: Promise<FaceTracker>
  private stream: MediaStream | null = null
  private mode: 'none' | 'camera' | 'photo' = 'none'
  private raf = 0
  private frameCb = 0
  private lastVideoTime = -1
  private status: TryOnStatus = 'idle'
  private resizeObserver: ResizeObserver
  private sourceAspect = 4 / 3
  private sourceWidth = 0
  private probe = new LightProbe()
  private lastLight = 0
  private generation = 0
  private disposed = false
  private lastPhoto: Blob | string | null = null

  constructor(
    private container: HTMLElement,
    private opts: TryOnOptions,
  ) {
    this.stage = document.createElement('div')
    this.stage.style.cssText = 'position:absolute;overflow:hidden;background:#000;'
    this.video = document.createElement('video')
    this.video.playsInline = true
    this.video.muted = true
    this.video.autoplay = true
    this.video.style.cssText = STYLE + 'object-fit:fill;'
    this.photo = document.createElement('img')
    this.photo.alt = ''
    this.photo.style.cssText = STYLE + 'object-fit:fill;'
    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = STYLE + 'pointer-events:none;'
    this.stage.append(this.video, this.photo, this.canvas)
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
    container.append(this.stage)

    this.renderer = new GlassesRenderer(this.canvas, { faceShadow: opts.faceShadow })
    this.renderer.setDebug(opts.debug ?? false)
    this.renderer.setOccluderEnabled(opts.occlusion !== false)
    this.tracker = FaceTracker.create(opts)
    this.tracker.catch((err) => this.setStatus('error', String(err?.message ?? err)))
    this.resizeObserver = new ResizeObserver(() => this.layout())
    this.resizeObserver.observe(container)
    this.showSource('none')
    this.layout()
  }

  private setStatus(status: TryOnStatus, detail?: string): void {
    if (status === this.status && !detail) return
    this.status = status
    this.opts.onStatus?.(status, detail)
  }

  /** Fit the stage inside the container with the aspect ratio of the source. */
  private layout(): void {
    const cw = this.container.clientWidth
    const ch = this.container.clientHeight
    if (!cw || !ch) return
    let w = cw
    let h = cw / this.sourceAspect
    if (h > ch) {
      h = ch
      w = ch * this.sourceAspect
    }
    Object.assign(this.stage.style, {
      width: `${Math.round(w)}px`,
      height: `${Math.round(h)}px`,
      left: `${Math.round((cw - w) / 2)}px`,
      top: `${Math.round((ch - h) / 2)}px`,
    })
    this.renderer.setSize(Math.round(w), Math.round(h), this.sourceAspect)
    this.renderer.render()
    // the overlay is rendered sharper than the picture under it was taken
    let blur = 0
    if (this.opts.matchCamera !== false && this.sourceWidth && this.mode !== 'none') {
      const sourcePx = this.mode === 'photo' ? PHOTO_BLUR_PX : VIDEO_BLUR_PX
      blur = Math.min(MAX_BLUR_CSS_PX, (sourcePx * w) / this.sourceWidth)
    }
    this.canvas.style.filter = blur > 0.15 ? `blur(${blur.toFixed(2)}px)` : ''
  }

  /** Measure the light on the face and hand it to the renderer. dt = 0: no smoothing. */
  private matchLight(source: HTMLVideoElement | ImageBitmap, pose: GlassesPose | null, dt: number): void {
    if (this.opts.matchCamera === false || !pose) return
    this.renderer.setLighting(this.probe.sample(source, pose.landmarks, dt))
  }

  private showSource(which: 'none' | 'camera' | 'photo'): void {
    this.video.style.display = which === 'camera' ? 'block' : 'none'
    this.photo.style.display = which === 'photo' ? 'block' : 'none'
    // the camera view is a mirror; a photo is shown as taken
    this.stage.style.transform = which === 'camera' ? 'scaleX(-1)' : 'none'
  }

  /** What is shown now. */
  get source(): 'none' | 'camera' | 'photo' {
    return this.mode
  }

  /** Size and parts of the glasses on show (to check a model), or null. */
  get glassesInfo(): GlassesInfo | null {
    return this.renderer.glassesInfo
  }

  /** The face tracker's delegate in use ("CPU" when the GPU could not start). */
  async activeDelegate(): Promise<'GPU' | 'CPU'> {
    return (await this.tracker).activeDelegate
  }

  /**
   * Change settings while running. Drawing settings apply at once; tracking
   * settings measure the face again (a photo is tracked again).
   */
  async update(settings: Partial<TryOnSettings>): Promise<void> {
    const before = { ...this.opts }
    Object.assign(this.opts, settings)
    const o = this.opts
    if ('debug' in settings) this.renderer.setDebug(o.debug ?? false)
    if ('occlusion' in settings) this.renderer.setOccluderEnabled(o.occlusion !== false)
    if ('faceShadow' in settings) this.renderer.setFaceShadow(o.faceShadow !== false)
    if ('matchCamera' in settings && o.matchCamera === false) {
      this.probe.reset()
      this.renderer.setLighting(null)
    }
    const tracker = await this.tracker
    let retrack = false
    if ((o.delegate ?? 'GPU') !== (before.delegate ?? 'GPU')) {
      tracker.setDelegate(o.delegate ?? 'GPU')
      retrack = true
    } else if (o.scaleFromIris !== before.scaleFromIris || o.fitToFace !== before.fitToFace) {
      tracker.setOptions({ scaleFromIris: o.scaleFromIris, fitToFace: o.fitToFace })
      retrack = true
    }
    if (retrack && this.mode === 'camera') return this.startCamera()
    if ((retrack || 'matchCamera' in settings || 'debug' in settings) && this.mode === 'photo' && this.lastPhoto) {
      return this.showPhoto(this.lastPhoto)
    }
    this.layout()
  }

  preload(urls: string[]): void {
    urls.forEach((u) => void this.renderer.preload(u).catch(() => undefined))
  }

  async setGlasses(url: string): Promise<void> {
    await this.renderer.setGlasses(url)
    if (this.mode === 'photo') this.renderer.render()
  }

  /** Start the front camera and follow the face. */
  async startCamera(): Promise<void> {
    const gen = ++this.generation
    this.stopSources()
    this.setStatus('loading')
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setStatus('camera-unavailable', 'This browser cannot open a camera here (HTTPS is required).')
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
    } catch (err) {
      const name = (err as DOMException)?.name
      if (name === 'NotAllowedError' || name === 'SecurityError') this.setStatus('camera-denied')
      else this.setStatus('camera-unavailable', (err as Error)?.message)
      return
    }
    if (gen !== this.generation || this.disposed) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    this.stream = stream
    this.video.srcObject = stream
    try {
      await this.video.play()
      const tracker = await this.tracker
      await tracker.prepareVideo()
      if (gen !== this.generation) return
      tracker.reset()
      this.mode = 'camera'
      this.showSource('camera')
      this.lastVideoTime = -1
      this.loop(tracker, gen)
    } catch (err) {
      this.setStatus('error', String((err as Error)?.message ?? err))
    }
  }

  private loop(tracker: FaceTracker, gen: number): void {
    const step = () => {
      if (gen !== this.generation || this.disposed) return
      const v = this.video
      if (v.readyState >= 2 && v.videoWidth && v.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = v.currentTime
        const aspect = v.videoWidth / v.videoHeight
        if (Math.abs(aspect - this.sourceAspect) > 1e-3 || v.videoWidth !== this.sourceWidth) {
          // also covers a phone being rotated between portrait and landscape
          this.sourceAspect = aspect
          this.sourceWidth = v.videoWidth
          this.layout()
        }
        let pose: GlassesPose | null = null
        try {
          pose = tracker.trackVideo(v, performance.now())
        } catch (err) {
          this.setStatus('error', String((err as Error)?.message ?? err))
          return
        }
        const now = performance.now()
        if (now - this.lastLight >= LIGHT_INTERVAL_MS) {
          this.matchLight(v, pose, this.lastLight ? (now - this.lastLight) / 1000 : 0)
          this.lastLight = now
        }
        this.renderer.setPose(pose)
        this.renderer.render()
        this.setStatus(pose ? 'tracking' : 'no-face')
        this.opts.onPose?.(pose)
      }
      schedule()
    }
    const schedule = () => {
      if ('requestVideoFrameCallback' in this.video) {
        this.frameCb = this.video.requestVideoFrameCallback(step)
      } else {
        this.raf = requestAnimationFrame(step)
      }
    }
    schedule()
  }

  /** Show a still photo (File, Blob or URL) with the glasses on it. */
  async showPhoto(source: Blob | string): Promise<void> {
    const gen = ++this.generation
    this.stopSources()
    this.setStatus('loading')
    this.lastPhoto = source
    const url = typeof source === 'string' ? source : URL.createObjectURL(source)
    try {
      const img = this.photo
      img.src = url
      await img.decode()
      if (gen !== this.generation) return
      // work on an upright bitmap so phone photos with EXIF rotation are handled
      const bitmap = await createImageBitmap(img)
      const tracker = await this.tracker
      await tracker.prepareImage()
      if (gen !== this.generation) return
      this.mode = 'photo'
      this.sourceAspect = bitmap.width / bitmap.height
      this.sourceWidth = bitmap.width
      this.showSource('photo')
      this.layout()
      const pose = tracker.trackImage(bitmap)
      this.matchLight(bitmap, pose, 0)
      bitmap.close()
      this.renderer.setPose(pose)
      this.renderer.render()
      this.setStatus(pose ? 'tracking' : 'no-face')
      this.opts.onPose?.(pose)
    } catch (err) {
      this.setStatus('error', 'Could not read that image.')
      console.error(err)
    } finally {
      if (typeof source !== 'string') setTimeout(() => URL.revokeObjectURL(url), 30_000)
    }
  }

  private stopSources(): void {
    if (this.mode === 'camera') this.lastPhoto = null
    cancelAnimationFrame(this.raf)
    if (this.frameCb && 'cancelVideoFrameCallback' in this.video) {
      this.video.cancelVideoFrameCallback(this.frameCb)
    }
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.video.srcObject = null
    this.mode = 'none'
    this.sourceWidth = 0
    this.lastLight = 0
    this.probe.reset()
    this.renderer.setLighting(null)
    this.renderer.setPose(null)
    this.renderer.render()
  }

  dispose(): void {
    this.disposed = true
    this.generation++
    this.stopSources()
    this.resizeObserver.disconnect()
    this.renderer.dispose()
    void this.tracker.then((t) => t.dispose()).catch(() => undefined)
    this.stage.remove()
  }
}
