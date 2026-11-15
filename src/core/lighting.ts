/**
 * Estimates the light on the face from the camera image, so the glasses can be
 * lit like the picture they are drawn on. No React.
 *
 * It is deliberately coarse. A camera's automatic exposure and white balance
 * already remove most of what could be measured, and skin tone and the colours
 * of the scene are mixed into the rest, so every value is limited to a moderate
 * range around the neutral studio light the renderer starts with.
 */
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { TrackingSource } from './tracking'

export interface LightEstimate {
  /** Brightness of the light relative to the neutral setup (1 = neutral). */
  exposure: number
  /** Colour of the light, linear RGB with a luminance of 1. */
  tint: [number, number, number]
  /** Which side the light comes from: -1 = image left, +1 = image right (unmirrored image). */
  side: number
}

export const NEUTRAL_LIGHT: LightEstimate = { exposure: 1, tint: [1, 1, 1], side: 0 }

/** Width of the copy of the image that is read back. */
const PROBE_WIDTH = 64
/** Middle of the forehead and the two cheeks: skin that glasses do not cover. */
const FOREHEAD = 151
const CHEEKS = [50, 280]
/** Linear luminance of a normally exposed face and of a normally exposed frame. */
const FACE_LUMINANCE = 0.3
const FRAME_LUMINANCE = 0.2
const EXPOSURE_RANGE = [0.6, 1.3]
/** How much of the colour cast of the image is taken over, and its limit per channel. */
const TINT_STRENGTH = 0.3
const TINT_RANGE = [0.87, 1.15]
/** Cheek contrast (difference over sum) at which the light counts as fully from one side. */
const SIDE_FULL_CONTRAST = 0.4
/** Time constant of the smoothing in video (seconds). */
const SMOOTHING_S = 0.8

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const luminance = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

// sRGB byte to linear light
const LINEAR = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export class LightProbe {
  private canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })
  private current: LightEstimate | null = null

  /** Forget the smoothing history. */
  reset(): void {
    this.current = null
  }

  /**
   * Estimate the light in this image. dt is the time since the previous call in
   * seconds; 0 returns the measurement unsmoothed (a still image, or the first frame).
   * Returns null when the image cannot be read.
   */
  sample(source: TrackingSource, landmarks: NormalizedLandmark[], dt: number): LightEstimate | null {
    const measured = this.measure(source, landmarks)
    if (!measured) return this.current
    const prev = this.current
    if (!prev || dt <= 0) return (this.current = measured)
    const k = 1 - Math.exp(-dt / SMOOTHING_S)
    const mix = (a: number, b: number) => a + (b - a) * k
    return (this.current = {
      exposure: mix(prev.exposure, measured.exposure),
      tint: [mix(prev.tint[0], measured.tint[0]), mix(prev.tint[1], measured.tint[1]), mix(prev.tint[2], measured.tint[2])],
      side: mix(prev.side, measured.side),
    })
  }

  private measure(source: TrackingSource, landmarks: NormalizedLandmark[]): LightEstimate | null {
    const ctx = this.ctx
    const sw = source instanceof HTMLVideoElement ? source.videoWidth : source instanceof HTMLImageElement ? source.naturalWidth : source.width
    const sh = source instanceof HTMLVideoElement ? source.videoHeight : source instanceof HTMLImageElement ? source.naturalHeight : source.height
    if (!ctx || !sw || !sh || landmarks.length <= Math.max(FOREHEAD, ...CHEEKS)) return null
    const w = PROBE_WIDTH
    const h = Math.max(1, Math.round((PROBE_WIDTH * sh) / sw))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    let data: Uint8ClampedArray
    try {
      ctx.drawImage(source, 0, 0, w, h)
      data = ctx.getImageData(0, 0, w, h).data
    } catch {
      return null // e.g. an image from another origin
    }

    // mean colour of the whole image, and of a small patch around a landmark
    const frame = [0, 0, 0]
    for (let i = 0; i < data.length; i += 4) {
      frame[0] += LINEAR[data[i]]
      frame[1] += LINEAR[data[i + 1]]
      frame[2] += LINEAR[data[i + 2]]
    }
    const pixels = data.length / 4
    for (let k = 0; k < 3; k++) frame[k] /= pixels
    const patch = (lm: NormalizedLandmark): number => {
      const cx = Math.round(lm.x * w)
      const cy = Math.round(lm.y * h)
      let sum = 0
      let count = 0
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (let x = cx - 1; x <= cx + 1; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue
          const i = (y * w + x) * 4
          sum += luminance([LINEAR[data[i]], LINEAR[data[i + 1]], LINEAR[data[i + 2]]])
          count++
        }
      }
      return count ? sum / count : -1
    }

    const forehead = patch(landmarks[FOREHEAD])
    const [a, b] = CHEEKS.map((i) => landmarks[i])
    const left = patch(a.x < b.x ? a : b)
    const right = patch(a.x < b.x ? b : a)
    if (forehead < 0 || left < 0 || right < 0) return null
    const face = (forehead + left + right) / 3
    const frameLum = Math.max(luminance(frame), 1e-4)

    // skin tone biases the face and the scene biases the frame: use both, gently
    const exposure = clamp(
      ((Math.max(face, 1e-4) / FACE_LUMINANCE) * (frameLum / FRAME_LUMINANCE)) ** 0.25,
      EXPOSURE_RANGE[0],
      EXPOSURE_RANGE[1],
    )
    const tint = frame.map((c) => clamp(1 + TINT_STRENGTH * (c / frameLum - 1), TINT_RANGE[0], TINT_RANGE[1]))
    const tintLum = luminance(tint)
    const side = clamp((right - left) / Math.max(right + left, 1e-4) / SIDE_FULL_CONTRAST, -1, 1)
    return { exposure, tint: [tint[0] / tintLum, tint[1] / tintLum, tint[2] / tintLum], side }
  }
}
