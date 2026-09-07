import { defineConfig } from 'vite-plus'
import { irisout } from '@irisout/vite-plugin'

export default defineConfig({
  base: '/',
  plugins: [irisout({ entry: 'src/App.jsx', container: '#app' })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: true,
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
      },
    },
  },
})
