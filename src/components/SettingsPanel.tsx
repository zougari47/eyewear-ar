import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { isDefault, type DebugHead, type Settings } from '@/lib/settings'

interface Props {
  settings: Settings
  onChange: (settings: Settings) => void
  /** Back to the defaults, forgetting what was remembered. */
  onReset: () => void
}

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings]

const LOOK: { key: BoolKey; title: string; text: string }[] = [
  {
    key: 'occlusion',
    title: 'Hide behind the head',
    text: 'An invisible head hides the parts of the temples that pass behind it.',
  },
  {
    key: 'faceShadow',
    title: 'Shadow on the face',
    text: 'The frame drops a soft shadow on the cheeks, so it does not look pasted on.',
  },
  {
    key: 'matchCamera',
    title: 'Match the picture',
    text: 'Reads brightness and colour of the room five times a second and lights the glasses the same way; softens them to the sharpness of the camera.',
  },
]

const TRACKING: { key: BoolKey; title: string; text: string }[] = [
  {
    key: 'fitToFace',
    title: 'Fit to the face',
    text: 'Measures the shape of this face (nose, ears) and moves the bridge and temples to it.',
  },
  {
    key: 'scaleFromIris',
    title: 'True size from the eyes',
    text: 'The iris is about 11.7 mm in adults; measuring it gives the real size of the face, so the glasses show at their real size.',
  },
]

export function SettingsPanel({ settings, onChange, onReset }: Props) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value })

  return (
    <div className="space-y-6">
      <Section title="Debug">
        <Row title="Show the head" text="Draws the invisible head that hides the temples, to check how it fits the face.">
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[settings.debugHead]}
            onValueChange={([v]) => v && set('debugHead', v as DebugHead)}
          >
            <ToggleGroupItem value="off">Off</ToggleGroupItem>
            <ToggleGroupItem value="wire">Wire</ToggleGroupItem>
            <ToggleGroupItem value="solid">Solid</ToggleGroupItem>
          </ToggleGroup>
        </Row>
        <SwitchRow
          id="stats"
          title="Show measurements"
          text="Frame rate, face size, distance to the camera and the face fit, live."
          checked={settings.stats}
          onChange={(v) => set('stats', v)}
        />
      </Section>

      <Separator />
      <Section title="Look">
        {LOOK.map((o) => (
          <SwitchRow key={o.key} id={o.key} title={o.title} text={o.text} checked={settings[o.key]} onChange={(v) => set(o.key, v)} />
        ))}
      </Section>

      <Separator />
      <Section title="Tracking">
        {TRACKING.map((o) => (
          <SwitchRow key={o.key} id={o.key} title={o.title} text={o.text} checked={settings[o.key]} onChange={(v) => set(o.key, v)} />
        ))}
        <Row title="Run the tracker on" text="The graphics card is faster; the processor works everywhere. Falls back to the processor by itself.">
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[settings.delegate]}
            onValueChange={([v]) => v && set('delegate', v as 'GPU' | 'CPU')}
          >
            <ToggleGroupItem value="GPU">GPU</ToggleGroupItem>
            <ToggleGroupItem value="CPU">CPU</ToggleGroupItem>
          </ToggleGroup>
        </Row>
      </Section>

      <Separator />
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-xs">Your changes are remembered on this device.</p>
        <Button variant="outline" size="sm" onClick={onReset} disabled={isDefault(settings)}>
          <RotateCcw data-icon="inline-start" /> Reset to defaults
        </Button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</h3>
      {children}
    </section>
  )
}

function Row({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground text-xs">{text}</p>
      </div>
      {children}
    </div>
  )
}

function SwitchRow(props: { id: string; title: string; text: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor={props.id} className="text-sm">
          {props.title}
        </Label>
        <p className="text-muted-foreground text-xs">{props.text}</p>
      </div>
      <Switch id={props.id} checked={props.checked} onCheckedChange={props.onChange} />
    </div>
  )
}
