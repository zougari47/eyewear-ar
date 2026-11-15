import { Quaternion, Vector3 } from 'three'

// One Euro filter (Casiez et al. 2012): a low-pass whose cutoff rises with
// speed, so a still head is steady and a moving head is not lagged.

function alpha(cutoffHz: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz)
  return 1 / (1 + tau / dt)
}

export class OneEuroVector {
  private value: Vector3 | null = null
  private speed = new Vector3()
  private readonly tmp = new Vector3()

  constructor(
    private minCutoff: number,
    private beta: number,
    private dCutoff = 1,
  ) {}

  reset(): void {
    this.value = null
    this.speed.set(0, 0, 0)
  }

  filter(x: Vector3, dt: number): Vector3 {
    if (!this.value || dt <= 0) {
      this.value = x.clone()
      return x
    }
    this.tmp.copy(x).sub(this.value).divideScalar(dt)
    this.speed.lerp(this.tmp, alpha(this.dCutoff, dt))
    const cutoff = this.minCutoff + this.beta * this.speed.length()
    this.value.lerp(x, alpha(cutoff, dt))
    return x.copy(this.value)
  }
}

export class OneEuroQuaternion {
  private value: Quaternion | null = null
  private speed = 0

  constructor(
    private minCutoff: number,
    private beta: number,
    private dCutoff = 1,
  ) {}

  reset(): void {
    this.value = null
    this.speed = 0
  }

  filter(q: Quaternion, dt: number): Quaternion {
    if (!this.value || dt <= 0) {
      this.value = q.clone()
      return q
    }
    const angle = this.value.angleTo(q)
    this.speed += (angle / dt - this.speed) * alpha(this.dCutoff, dt)
    const cutoff = this.minCutoff + this.beta * this.speed
    this.value.slerp(q, alpha(cutoff, dt))
    return q.copy(this.value)
  }
}

/** Median of the most recent samples: for quantities that are constant per person. */
export class RollingMedian {
  private samples: number[] = []
  constructor(private size: number) {}
  reset(): void {
    this.samples = []
  }
  push(x: number): void {
    this.samples.push(x)
    if (this.samples.length > this.size) this.samples.shift()
  }
  /** Current median, or the fallback while there are no samples. */
  value(fallback: number): number {
    if (!this.samples.length) return fallback
    const s = [...this.samples].sort((a, b) => a - b)
    return s[s.length >> 1]
  }
}
