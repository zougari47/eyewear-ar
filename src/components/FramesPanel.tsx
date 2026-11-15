import { useRef, useState } from 'react'
import { Box, Check, TriangleAlert, Upload, X } from 'lucide-react'
import type { GlassesInfo } from '@/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Frame } from '@/lib/models'

interface Props {
  frames: Frame[]
  error: string
  selected: string
  onSelect: (id: string) => void
  onUpload: (files: File[]) => void
  onRemove: (id: string) => void
  info: GlassesInfo | null
}

export function FramesPanel({ frames, error, selected, onSelect, onUpload, onRemove, info }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => /\.glb$/i.test(f.name))
    if (files.length) onUpload(files)
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-2">
        {error && <p className="text-muted-foreground text-sm">{error}</p>}
        {frames.map((f) => (
          <div
            key={f.id}
            role="button"
            tabIndex={0}
            aria-pressed={f.id === selected}
            onClick={() => onSelect(f.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(f.id)}
            className={cn(
              'hover:bg-accent flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-colors',
              f.id === selected && 'border-primary bg-accent',
            )}
          >
            <span
              className="grid size-9 shrink-0 place-items-center rounded-full border"
              style={{ background: f.color ?? 'transparent' }}
            >
              {!f.color && <Box className="text-muted-foreground size-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{f.label}</span>
              <span className="text-muted-foreground block text-xs">
                {f.lens_width ? `${f.lens_width} □ ${f.bridge_width} – ${f.temple_length} mm` : f.uploaded ? 'Your model' : 'No size given'}
              </span>
            </span>
            {f.material && <Badge variant="secondary">{f.material}</Badge>}
            {f.uploaded && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`Remove ${f.label}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(f.id)
                }}
              >
                <X />
              </Button>
            )}
          </div>
        ))}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          take(e.dataTransfer.files)
        }}
        className={cn(
          'flex flex-col items-center gap-3 rounded-lg border border-dashed p-5 text-center transition-colors',
          dragging && 'border-primary bg-accent',
        )}
      >
        <Upload className="text-muted-foreground size-6" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Try your own 3D model</p>
          <p className="text-muted-foreground text-xs">
            Drop a .glb file here. Metres, Y up, front facing +Z, origin at the centre of the bridge.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
          Choose a .glb file
        </Button>
        <input
          ref={input}
          type="file"
          accept=".glb,model/gltf-binary"
          multiple
          hidden
          onChange={(e) => {
            take(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      <ModelCheck info={info} />
    </div>
  )
}

/** Checks the model on show against the convention the placement relies on. */
function ModelCheck({ info }: { info: GlassesInfo | null }) {
  if (!info) return null
  const { size, center } = info
  const checks: { ok: boolean; text: string }[] = [
    {
      ok: size.x > 100 && size.x < 175,
      text:
        size.x > 100 && size.x < 175
          ? `Width ${size.x.toFixed(1)} mm: a real size`
          : `Width ${size.x.toFixed(1)} mm: expected about 120–160 mm. Is the model in metres?`,
    },
    {
      ok: Math.abs(center.x) < 3,
      text: Math.abs(center.x) < 3 ? 'Centred left to right' : `Off centre by ${center.x.toFixed(1)} mm left to right`,
    },
    {
      ok: info.temples === 2,
      text:
        info.temples === 2
          ? 'Temples are separate: they reach the ears and fade behind the head'
          : 'No separate temple_left / temple_right: temples cannot swing or fade',
    },
    {
      ok: info.lenses > 0,
      text: info.lenses > 0 ? `${info.lenses} lens part${info.lenses > 1 ? 's' : ''} (named lens…)` : 'No parts named lens…: lenses get the frame material',
    },
  ]
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">Model check</p>
      <ul className="space-y-2">
        {checks.map((c) => (
          <li key={c.text} className="flex gap-2 text-xs">
            {c.ok ? (
              <Check className="size-4 shrink-0 text-emerald-500" />
            ) : (
              <TriangleAlert className="size-4 shrink-0 text-amber-500" />
            )}
            <span className={c.ok ? 'text-muted-foreground' : ''}>{c.text}</span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs tabular-nums">
        {size.x.toFixed(1)} × {size.y.toFixed(1)} × {size.z.toFixed(1)} mm · {info.meshes} parts ·{' '}
        {info.triangles.toLocaleString()} triangles
      </p>
    </div>
  )
}
