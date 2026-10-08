// Hono文書ページのブラウザー入口を構築する。開発APIの配信は含めない。
import { defineConfig } from 'vite-plus'
import { irisoutHono } from 'irisout/hono/vite'
import { app } from './server/app.ts'

export default defineConfig({
  plugins: [irisoutHono(app)],
  build: { rollupOptions: { input: {} } },
})
