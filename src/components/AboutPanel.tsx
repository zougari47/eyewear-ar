import { Contrast, Crosshair, Eye, Glasses, Layers, Ruler, ScanFace, Sun, Waves } from 'lucide-react'

const FEATURES = [
  {
    icon: ScanFace,
    title: 'Face tracking',
    text: 'MediaPipe Face Landmarker finds 478 points on the face and the turn of the head, in the browser. Nothing is sent to a server.',
  },
  {
    icon: Crosshair,
    title: 'Placed on the nose',
    text: 'The scene is drawn with the same virtual camera MediaPipe assumes, so the glasses line up with the picture. Every model sits where a bridge rests on the nose.',
  },
  {
    icon: Ruler,
    title: 'Real size',
    text: 'The iris is about 11.7 mm in adults. Measuring it gives the real size of the face, so a 140 mm frame looks 140 mm wide.',
  },
  {
    icon: Glasses,
    title: 'Fitted to the face',
    text: 'The shape of the face is measured over the first good frames: the bridge moves to the nose and the temples reach for the ears.',
  },
  {
    icon: Layers,
    title: 'Hidden behind the head',
    text: 'An invisible head hides the temples where they pass behind it; they also fade out before the ear.',
  },
  {
    icon: Contrast,
    title: 'Shadow on the face',
    text: 'The frame drops a soft shadow on the cheeks, from a light placed just above the camera.',
  },
  {
    icon: Sun,
    title: 'Matched to the room',
    text: 'Brightness, colour and the side the light comes from are read from the face and applied to the glasses.',
  },
  {
    icon: Eye,
    title: 'Matched to the camera',
    text: 'The glasses are softened to the sharpness of the video or photo under them.',
  },
  {
    icon: Waves,
    title: 'Steady',
    text: 'A One Euro filter smooths the movement: still when the head is still, quick when it moves.',
  },
]

export function AboutPanel() {
  return (
    <div className="space-y-5">
      <p className="text-muted-foreground text-sm">
        Everything runs in the browser with MediaPipe and Three.js. Each part can be switched off in Settings to see what it does.
      </p>
      <ul className="space-y-4">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3">
            <Icon className="text-primary mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{title}</p>
              <p className="text-muted-foreground text-xs">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
