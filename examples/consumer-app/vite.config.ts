import { defineConfig } from 'vite-plus'
import { irisout } from 'irisout/vite'

export default defineConfig({
  plugins: [irisout({ entry: 'src/App.jsx', container: '#app' })],
  build: {
    outDir: process.env.IRISOUT_OUT_DIR ?? 'dist',
    emptyOutDir: true,
    sourcemap: process.env.IRISOUT_SOURCEMAP === 'true',
    minify: process.env.IRISOUT_SOURCEMAP === 'true' ? false : undefined,
  },
})
