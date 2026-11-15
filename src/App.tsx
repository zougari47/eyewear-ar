import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Glasses, ImageUp, Info, ScanFace, Settings2, Sparkles } from 'lucide-react'
import type { GlassesInfo } from '@/core'
import { AboutPanel } from '@/components/AboutPanel'
import { FramesPanel } from '@/components/FramesPanel'
import { ReferenceView } from '@/components/ReferenceView'
import { SettingsPanel } from '@/components/SettingsPanel'
import { StatsOverlay } from '@/components/StatsOverlay'
import { TryOnView, type Stats } from '@/components/TryOnView'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { BASE, frameFromFile, loadFrames, type Frame } from '@/lib/models'
import { initialSettings, type Settings } from '@/lib/settings'

type View = 'camera' | 'photo' | 'reference'

const params = new URLSearchParams(location.search)

export default function App() {
  const [view, setView] = useState<View>(params.get('view') === 'reference' ? 'reference' : params.get('photo') ? 'photo' : 'camera')
  const [photo, setPhoto] = useState<Blob | string | null>(params.get('photo'))
  const [hasSample, setHasSample] = useState(false)
  const [settings, setSettings] = useState<Settings>(initialSettings)
  const [frames, setFrames] = useState<Frame[]>([])
  const [framesError, setFramesError] = useState('')
  const [selected, setSelected] = useState('')
  const [info, setInfo] = useState<GlassesInfo | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadFrames()
      .then((list) => {
        setFrames(list)
        const wanted = params.get('model')
        setSelected((list.find((f) => f.id === wanted) ?? list[0])?.id ?? '')
      })
      .catch(() => setFramesError('No frames in public/models/models.json. Upload a .glb below.'))
    // the sample photo is optional (kept out of the repository)
    fetch(`${BASE}sample.jpg`, { method: 'HEAD' })
      .then((r) => setHasSample(r.ok && (r.headers.get('content-type') ?? '').startsWith('image/')))
      .catch(() => undefined)
  }, [])

  const pickPhoto = useCallback(() => photoInput.current?.click(), [])

  const onUpload = useCallback((files: File[]) => {
    const added = files.map(frameFromFile)
    setFrames((list) => [...list, ...added])
    setSelected(added[added.length - 1].id)
  }, [])

  const onRemove = useCallback(
    (id: string) => {
      const f = frames.find((x) => x.id === id)
      if (f?.uploaded) setTimeout(() => URL.revokeObjectURL(f.url), 1000)
      const rest = frames.filter((x) => x.id !== id)
      setFrames(rest)
      if (selected === id) setSelected(rest[0]?.id ?? '')
    },
    [frames, selected],
  )

  const frame = frames.find((f) => f.id === selected) ?? null

  return (
    <div className="bg-background text-foreground flex h-dvh flex-col lg:flex-row">
      <main className="flex min-h-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-lg">
              <Glasses className="size-4" />
            </div>
            <span className="font-semibold tracking-tight">Eyewear AR</span>
          </div>
          <Badge variant="outline" className="hidden sm:inline-flex">
            <Sparkles /> open source
          </Badge>
          <ToggleGroup
            type="single"
            variant="outline"
            className="ml-auto"
            value={view}
            onValueChange={(v) => {
              if (!v) return
              if (v === 'photo' && !photo) pickPhoto()
              setView(v as View)
            }}
          >
            <ToggleGroupItem value="camera" aria-label="Camera">
              <Camera /> <span className="hidden sm:inline">Camera</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="photo" aria-label="Photo">
              <ImageUp /> <span className="hidden sm:inline">Photo</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="reference" aria-label="Reference head">
              <ScanFace /> <span className="hidden sm:inline">Reference head</span>
            </ToggleGroupItem>
          </ToggleGroup>
          {view === 'photo' && (
            <div className="flex gap-3 text-sm">
              <button className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline" onClick={pickPhoto}>
                Another photo
              </button>
              {hasSample && (
                <button
                  className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                  onClick={() => setPhoto(`${BASE}sample.jpg`)}
                >
                  Sample
                </button>
              )}
            </div>
          )}
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              setPhoto(file)
              setView('photo')
            }}
          />
        </header>

        <div className="relative min-h-[50vh] flex-1 bg-black">
          {view === 'reference' ? (
            <ReferenceView settings={settings} frameUrl={frame?.url ?? null} onModelInfo={setInfo} />
          ) : (
            <TryOnView
              settings={settings}
              frameUrl={frame?.url ?? null}
              source={view}
              photo={photo}
              onPickPhoto={pickPhoto}
              onStats={setStats}
              onModelInfo={setInfo}
            />
          )}
          {settings.stats && view !== 'reference' && <StatsOverlay stats={stats} />}
        </div>
      </main>

      <aside className="flex max-h-[45vh] flex-col border-t lg:max-h-none lg:w-96 lg:border-t-0 lg:border-l">
        <Tabs defaultValue="frames" className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="border-b p-3">
            <TabsList className="w-full">
              <TabsTrigger value="frames">
                <Glasses /> Frames
              </TabsTrigger>
              <TabsTrigger value="settings">
                <Settings2 /> Settings
              </TabsTrigger>
              <TabsTrigger value="about">
                <Info /> How it works
              </TabsTrigger>
            </TabsList>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-4">
              <TabsContent value="frames">
                <FramesPanel
                  frames={frames}
                  error={framesError}
                  selected={selected}
                  onSelect={setSelected}
                  onUpload={onUpload}
                  onRemove={onRemove}
                  info={info}
                />
              </TabsContent>
              <TabsContent value="settings">
                <SettingsPanel settings={settings} onChange={setSettings} />
              </TabsContent>
              <TabsContent value="about">
                <AboutPanel />
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </aside>
    </div>
  )
}
