import { useEffect, useRef, useState } from 'react'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { GlassesRenderer, glassesMatrix, type GlassesInfo } from '@/core'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { Settings } from '@/lib/settings'

interface Props {
  settings: Settings
  frameUrl: string | null
  onModelInfo: (info: GlassesInfo | null) => void
}

type Head = 'solid' | 'wire' | 'none'

/**
 * The glasses on MediaPipe's reference face, turned by hand: checks the
 * bridge, the true-size scale, the temples and the head occluder without a camera.
 */
export function ReferenceView({ settings, frameUrl, onModelInfo }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [renderer, setRenderer] = useState<GlassesRenderer | null>(null)
  const [yaw, setYaw] = useState(25)
  const [pitch, setPitch] = useState(0)
  const [distance, setDistance] = useState(34)
  const [head, setHead] = useState<Head>('solid')
  const [loaded, setLoaded] = useState(0)
  const infoCb = useRef(onModelInfo)
  infoCb.current = onModelInfo

  useEffect(() => {
    const r = new GlassesRenderer(canvas.current!)
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = box.current!
      if (w && h) r.setSize(w, h, w / h)
      r.render()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(box.current!)
    resize()
    setRenderer(r)
    return () => {
      ro.disconnect()
      r.dispose()
      setRenderer(null)
    }
  }, [])

  useEffect(() => {
    if (!renderer || !frameUrl) return
    let live = true
    infoCb.current(null)
    renderer
      .setGlasses(frameUrl)
      .then(() => {
        if (!live) return
        infoCb.current(renderer.glassesInfo)
        setLoaded((n) => n + 1)
      })
      .catch((err) => console.error(err))
    return () => {
      live = false
    }
  }, [renderer, frameUrl])

  useEffect(() => {
    if (!renderer) return
    renderer.setDebug(head === 'none' ? false : head === 'solid' ? 'solid' : true)
    renderer.setOccluderEnabled(settings.occlusion)
    renderer.setFaceShadow(settings.faceShadow)
    const q = new Quaternion().setFromEuler(new Euler((pitch * Math.PI) / 180, (yaw * Math.PI) / 180, 0, 'YXZ'))
    const face = new Matrix4().compose(new Vector3(0, -1.5, -distance), q, new Vector3(1, 1, 1))
    renderer.setPose({ faceMatrix: face, matrix: glassesMatrix(face, 1), faceScale: 1, landmarks: [] })
    renderer.render()
  }, [renderer, yaw, pitch, distance, head, settings.occlusion, settings.faceShadow, loaded])

  return (
    <div className="relative size-full">
      <div ref={box} className="absolute inset-0 bg-gradient-to-b from-neutral-500 to-neutral-700">
        <canvas ref={canvas} className="block size-full" />
      </div>
      <div className="bg-background/85 absolute right-4 bottom-4 left-4 mx-auto grid max-w-2xl gap-4 rounded-xl border p-4 backdrop-blur sm:grid-cols-[1fr_1fr_1fr_auto]">
        <Control label="Turn" value={`${yaw}°`}>
          <Slider min={-90} max={90} step={1} value={[yaw]} onValueChange={([v]) => setYaw(v)} />
        </Control>
        <Control label="Tilt" value={`${pitch}°`}>
          <Slider min={-30} max={30} step={1} value={[pitch]} onValueChange={([v]) => setPitch(v)} />
        </Control>
        <Control label="Distance" value={`${distance} cm`}>
          <Slider min={20} max={70} step={1} value={[distance]} onValueChange={([v]) => setDistance(v)} />
        </Control>
        <div className="space-y-2">
          <Label className="text-xs">Head</Label>
          <ToggleGroup type="single" variant="outline" size="sm" value={head} onValueChange={(v) => v && setHead(v as Head)}>
            <ToggleGroupItem value="solid">Solid</ToggleGroupItem>
            <ToggleGroupItem value="wire">Wire</ToggleGroupItem>
            <ToggleGroupItem value="none">None</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
    </div>
  )
}

function Control({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-between text-xs">
        <Label className="text-xs">{label}</Label>
        <span className="text-muted-foreground tabular-nums">{value}</span>
      </div>
      {children}
    </div>
  )
}
