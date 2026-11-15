import { useEffect, useRef, useState } from 'react'
import { CameraOff, ImageUp, Loader2, ScanFace, TriangleAlert } from 'lucide-react'
import { BRIDGE_ANCHOR_CM, TryOn, type GlassesInfo, type GlassesPose, type TryOnStatus } from '@/core'
import { Button } from '@/components/ui/button'
import { BASE } from '@/lib/models'
import { toTryOn, type Settings } from '@/lib/settings'

export interface Stats {
  fps: number
  delegate: string
  faceScale: number
  distanceCm: number
  x: number
  y: number
  fit: { strength: number; bridgeMm: [number, number, number]; earMm: number; rmsMm: number } | null
}

interface Props {
  settings: Settings
  frameUrl: string | null
  source: 'camera' | 'photo'
  photo: Blob | string | null
  onPickPhoto: () => void
  onStats: (stats: Stats | null) => void
  onModelInfo: (info: GlassesInfo | null) => void
}

const STATS_INTERVAL_MS = 250

export function TryOnView({ settings, frameUrl, source, photo, onPickPhoto, onStats, onModelInfo }: Props) {
  const holder = useRef<HTMLDivElement>(null)
  const [tryOn, setTryOn] = useState<TryOn | null>(null)
  const [status, setStatus] = useState<TryOnStatus>('idle')
  const [detail, setDetail] = useState('')
  const applied = useRef(settings)
  const callbacks = useRef({ onStats, onModelInfo })
  callbacks.current = { onStats, onModelInfo }

  // the widget, created once
  useEffect(() => {
    let frames = 0
    let since = performance.now()
    let fps = 0
    let lastReport = 0
    let delegate = '…'
    let lastPose: GlassesPose | null = null
    const widget = new TryOn(holder.current!, {
      wasmPath: `${BASE}mediapipe/wasm`,
      modelPath: `${BASE}mediapipe/face_landmarker.task`,
      ...toTryOn(applied.current),
      onStatus: (s, d) => {
        setStatus(s)
        setDetail(d ?? '')
        if (s === 'tracking')
          void widget.activeDelegate().then((d) => {
            if (d === delegate) return
            delegate = d
            if (lastPose) callbacks.current.onStats(statsOf(lastPose, widget.source === 'photo' ? 0 : fps, delegate))
          })
      },
      onPose: (pose) => {
        lastPose = pose
        frames++
        const now = performance.now()
        if (now - since >= 1000) {
          fps = (frames * 1000) / (now - since)
          frames = 0
          since = now
        }
        if (widget.source === 'photo' || now - lastReport >= STATS_INTERVAL_MS) {
          lastReport = now
          callbacks.current.onStats(pose ? statsOf(pose, widget.source === 'photo' ? 0 : fps, delegate) : null)
        }
      },
    })
    setTryOn(widget)
    return () => {
      widget.dispose()
      setTryOn(null)
      callbacks.current.onStats(null)
    }
  }, [])

  // settings: send only what changed
  useEffect(() => {
    if (!tryOn) return
    const before = toTryOn(applied.current)
    const now = toTryOn(settings)
    const changed = Object.fromEntries(
      Object.entries(now).filter(([k, v]) => before[k as keyof typeof before] !== v),
    )
    applied.current = settings
    if (Object.keys(changed).length) void tryOn.update(changed)
  }, [tryOn, settings])

  useEffect(() => {
    if (!tryOn || !frameUrl) return
    let live = true
    callbacks.current.onModelInfo(null)
    tryOn
      .setGlasses(frameUrl)
      .then(() => live && callbacks.current.onModelInfo(tryOn.glassesInfo))
      .catch((err) => {
        console.error(err)
        if (live) {
          setStatus('error')
          setDetail('This model could not be loaded. Is it a valid .glb file?')
        }
      })
    return () => {
      live = false
    }
  }, [tryOn, frameUrl])

  useEffect(() => {
    if (!tryOn) return
    if (source === 'camera') void tryOn.startCamera()
    else if (photo) void tryOn.showPhoto(photo)
  }, [tryOn, source, photo])

  let message: { icon: React.ReactNode; title: string; text: string; photo?: boolean } | null = null
  if (status === 'camera-denied') {
    message = {
      icon: <CameraOff />,
      title: 'Camera access is blocked',
      text: 'Allow the camera for this site and reload, or try the glasses on a photo.',
      photo: true,
    }
  } else if (status === 'camera-unavailable') {
    message = {
      icon: <CameraOff />,
      title: 'No camera available',
      text: (detail ? detail + ' ' : '') + 'You can try the glasses on a photo instead.',
      photo: true,
    }
  } else if (status === 'error') {
    message = { icon: <TriangleAlert />, title: 'Something went wrong', text: detail || 'Please reload the page.' }
  } else if (source === 'photo' && !photo) {
    message = { icon: <ImageUp />, title: 'Try on a photo', text: 'Choose a photo of a face looking at the camera.', photo: true }
  }

  return (
    <div className="relative size-full">
      <div ref={holder} className="absolute inset-0" />
      {status === 'loading' && !message && (
        <Hint>
          <Loader2 className="size-4 animate-spin" /> Loading the face tracker…
        </Hint>
      )}
      {status === 'no-face' && !message && (
        <Hint>
          <ScanFace className="size-4" />
          {source === 'photo' ? 'No face found in this photo. Try another one.' : 'Looking for a face…'}
        </Hint>
      )}
      {message && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="bg-card/95 max-w-sm space-y-3 rounded-xl border p-6 text-center shadow-lg backdrop-blur">
            <div className="text-muted-foreground mx-auto w-fit [&_svg]:size-8">{message.icon}</div>
            <h2 className="text-lg font-semibold">{message.title}</h2>
            <p className="text-muted-foreground text-sm">{message.text}</p>
            {message.photo && (
              <Button onClick={onPickPhoto}>
                <ImageUp /> Upload a photo
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background/80 absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-1.5 text-sm backdrop-blur">
      {children}
    </div>
  )
}

function statsOf(pose: GlassesPose, fps: number, delegate: string): Stats {
  const e = pose.faceMatrix.elements
  const f = pose.fit
  const mm = (cm: number) => cm * 10
  return {
    fps,
    delegate,
    faceScale: pose.faceScale,
    distanceCm: -e[14],
    x: e[12],
    y: e[13],
    fit: f?.positions
      ? {
          strength: f.strength,
          bridgeMm: [
            mm(f.bridge.x - BRIDGE_ANCHOR_CM.x),
            mm(f.bridge.y - BRIDGE_ANCHOR_CM.y),
            mm(f.bridge.z - BRIDGE_ANCHOR_CM.z),
          ],
          earMm: mm(f.earX),
          rmsMm: mm(f.residual),
        }
      : null,
  }
}
