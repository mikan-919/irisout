import path from 'node:path'
import { defineConfig } from 'vite-plus'
import { irisoutSsr } from 'irisout/ssr'

export default defineConfig({
  plugins: [
    irisoutSsr({
      entry: 'src/PlaygroundPage.jsx',
      virtualModuleId: 'virtual:irisout-playground-ssr',
    }),
  ],
  build: {
    ssr: path.resolve(import.meta.dirname, 'src/playground-page-server.js'),
    outDir: 'dist/server',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: 'playground-page.js',
      },
    },
  },
})
