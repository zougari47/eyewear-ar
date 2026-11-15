// Builds only the framework-free core (src/core) as one plain script that
// defines a global `EyewearAR`, and an ES module.
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist-lib',
    lib: {
      entry: 'src/core/index.ts',
      name: 'EyewearAR',
      formats: ['iife', 'es'],
      fileName: (format) => (format === 'iife' ? 'eyewear-ar.js' : 'eyewear-ar.mjs'),
    },
  },
})
