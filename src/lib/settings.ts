import type { TryOnSettings } from '@/core'

export type DebugHead = 'off' | 'wire' | 'solid'

/** Everything the settings panel controls. */
export interface Settings {
  debugHead: DebugHead
  stats: boolean
  occlusion: boolean
  faceShadow: boolean
  matchCamera: boolean
  fitToFace: boolean
  scaleFromIris: boolean
  delegate: 'GPU' | 'CPU'
}

/** What "Reset to defaults" goes back to. */
export const defaultSettings: Settings = {
  debugHead: 'off',
  stats: false,
  occlusion: true,
  faceShadow: true,
  matchCamera: true,
  fitToFace: true,
  scaleFromIris: true,
  delegate: 'GPU',
}

const CHOICES: Partial<Record<keyof Settings, readonly string[]>> = {
  debugHead: ['off', 'wire', 'solid'],
  delegate: ['GPU', 'CPU'],
}

/** The URL switches of the original test app (?debug, ?fit=0, ...), only those present. */
function fromUrl(): Partial<Settings> {
  const params = new URLSearchParams(location.search)
  const s: Partial<Settings> = {}
  if (params.has('debug')) {
    s.debugHead = params.get('debug') === 'solid' ? 'solid' : 'wire'
    s.stats = true
  }
  const off = (name: string, key: 'occlusion' | 'faceShadow' | 'matchCamera' | 'fitToFace' | 'scaleFromIris') => {
    if (params.has(name)) s[key] = params.get(name) !== '0'
  }
  off('occlusion', 'occlusion')
  off('shadow', 'faceShadow')
  off('match', 'matchCamera')
  off('fit', 'fitToFace')
  off('iris', 'scaleFromIris')
  if (params.has('delegate')) s.delegate = params.get('delegate') === 'CPU' ? 'CPU' : 'GPU'
  return s
}

// Saved: only the settings changed in the panel that differ from the defaults,
// so a later change of a default still reaches people who never touched it.
const STORAGE_KEY = 'eyewear-ar:settings'

function isValid<K extends keyof Settings>(key: K, value: unknown): value is Settings[K] {
  if (typeof value !== typeof defaultSettings[key]) return false
  const choices = CHOICES[key]
  return !choices || choices.includes(value as string)
}

function loadSaved(): Partial<Settings> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (!raw || typeof raw !== 'object') return {}
    const s: Partial<Settings> = {}
    for (const key of Object.keys(defaultSettings) as (keyof Settings)[]) {
      const value = (raw as Record<string, unknown>)[key]
      if (isValid(key, value)) (s as Record<string, unknown>)[key] = value
    }
    return s
  } catch {
    return {} // unreadable, or storage blocked
  }
}

let saved = loadSaved()

function writeSaved() {
  try {
    if (Object.keys(saved).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // storage blocked (private mode in some browsers): settings just are not remembered
  }
}

/** Defaults, then what was saved, then the URL switches (which win for this visit). */
export const initialSettings: Settings = { ...defaultSettings, ...saved, ...fromUrl() }

/** Remembers what the user changed in the panel between `before` and `after`. */
export function rememberChanges(before: Settings, after: Settings) {
  for (const key of Object.keys(after) as (keyof Settings)[]) {
    if (after[key] === before[key]) continue
    if (after[key] === defaultSettings[key]) delete saved[key]
    else (saved as Record<string, unknown>)[key] = after[key]
  }
  writeSaved()
}

/** Forgets everything remembered. */
export function forgetSettings() {
  saved = {}
  writeSaved()
}

export function isDefault(s: Settings): boolean {
  return (Object.keys(defaultSettings) as (keyof Settings)[]).every((key) => s[key] === defaultSettings[key])
}

export function toTryOn(s: Settings): TryOnSettings {
  return {
    debug: s.debugHead === 'off' ? false : s.debugHead === 'solid' ? 'solid' : true,
    occlusion: s.occlusion,
    faceShadow: s.faceShadow,
    matchCamera: s.matchCamera,
    fitToFace: s.fitToFace,
    scaleFromIris: s.scaleFromIris,
    delegate: s.delegate,
  }
}
