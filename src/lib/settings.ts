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

const params = new URLSearchParams(location.search)

/** Defaults, with the same URL switches as the original test app (?debug, ?fit=0, ...). */
export const initialSettings: Settings = {
  debugHead: params.has('debug') ? (params.get('debug') === 'solid' ? 'solid' : 'wire') : 'off',
  stats: params.has('debug'),
  occlusion: params.get('occlusion') !== '0',
  faceShadow: params.get('shadow') !== '0',
  matchCamera: params.get('match') !== '0',
  fitToFace: params.get('fit') !== '0',
  scaleFromIris: params.get('iris') !== '0',
  delegate: params.get('delegate') === 'CPU' ? 'CPU' : 'GPU',
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
