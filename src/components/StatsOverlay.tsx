import type { Stats } from './TryOnView'

export function StatsOverlay({ stats }: { stats: Stats | null }) {
  const rows: [string, string][] = stats
    ? [
        ['Frame rate', stats.fps ? `${stats.fps.toFixed(0)} fps` : 'photo'],
        ['Tracker on', stats.delegate],
        ['Face size', `${(stats.faceScale * 100).toFixed(1)} % of average`],
        ['Distance', `${stats.distanceCm.toFixed(1)} cm`],
        ['Position', `x ${stats.x.toFixed(1)} · y ${stats.y.toFixed(1)} cm`],
        ...(stats.fit
          ? ([
              ['Face fit', `${Math.round(stats.fit.strength * 100)} %`],
              ['Bridge moved', stats.fit.bridgeMm.map((v) => v.toFixed(1)).join(' · ') + ' mm'],
              ['Ear at', `${stats.fit.earMm.toFixed(1)} mm from centre`],
              ['Fit error', `${stats.fit.rmsMm.toFixed(1)} mm`],
            ] as [string, string][])
          : ([['Face fit', 'off or measuring']] as [string, string][])),
      ]
    : [['Face', 'none in view']]

  return (
    <div className="bg-background/85 pointer-events-none absolute top-4 left-4 w-64 rounded-lg border p-3 font-mono text-[11px] backdrop-blur">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
