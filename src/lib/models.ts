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

/**
 * Where models.json and the .glb files live: VITE_MODELS_URL (a Vercel Blob
 * store, set in .env.local and in the Vercel project), else public/models/.
 */
const MODELS_URL: string = import.meta.env.VITE_MODELS_URL || `${BASE}models/`

/** The frames listed in models.json. */
export async function loadFrames(): Promise<Frame[]> {
  // revalidate every visit: Blob serves files with a 30-day cache, and the
  // list is what changes when frames are added or removed
  const r = await fetch(`${MODELS_URL}models.json`, { cache: 'no-cache' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = (await r.json()) as { models: ListedFrame[] }
  return data.models.map(({ file, ...m }) => ({ ...m, url: `${MODELS_URL}${file}` }))
}

export function frameFromFile(file: File): Frame {
  const name = file.name.replace(/\.glb$/i, '')
  return { id: `upload-${name}-${file.size}-${file.lastModified}`, label: name, url: URL.createObjectURL(file), uploaded: true }
}
