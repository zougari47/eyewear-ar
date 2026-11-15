// Copies the MediaPipe WASM runtime next to the app and fetches the face model
// once, so the try-on works without a CDN (and can be hosted from WordPress).
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'public', 'mediapipe')
mkdirSync(dest, { recursive: true })
cpSync(join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'), join(dest, 'wasm'), {
  recursive: true,
})
const model = join(dest, 'face_landmarker.task')
if (!existsSync(model)) {
  const url =
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task'
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    writeFileSync(model, Buffer.from(await res.arrayBuffer()))
    console.log('downloaded face_landmarker.task')
  } catch (err) {
    console.warn(`could not download the face model (${err.message}); get it from\n  ${url}\nand save it as ${model}`)
  }
}
