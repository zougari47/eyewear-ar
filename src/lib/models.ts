/** One pair of glasses in the picker. */
export interface Frame {
  id: string
  label: string
  url: string
  color?: string
  material?: string
  lens_width?: number
  bridge_width?: number
  temple_length?: number
  /** Uploaded by the user in this session (an object URL). */
  uploaded?: boolean
}

interface ListedFrame extends Omit<Frame, 'url'> {
  file: string
}

export const BASE = import.meta.env.BASE_URL

/** The frames listed in public/models/models.json. */
export async function loadFrames(): Promise<Frame[]> {
  const r = await fetch(`${BASE}models/models.json`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = (await r.json()) as { models: ListedFrame[] }
  return data.models.map(({ file, ...m }) => ({ ...m, url: `${BASE}models/${file}` }))
}

export function frameFromFile(file: File): Frame {
  const name = file.name.replace(/\.glb$/i, '')
  return { id: `upload-${name}-${file.size}-${file.lastModified}`, label: name, url: URL.createObjectURL(file), uploaded: true }
}
