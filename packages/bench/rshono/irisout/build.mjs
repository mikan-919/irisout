// 公式Hono連携プラグインでブラウザー生成物を作る。静的ページだけHTMLを保存する。
import fs from 'node:fs'
import { build } from 'vite-plus'
import { irisoutHono } from 'irisout/hono/vite'
import { app, document } from './app.mjs'
const root = import.meta.dirname
await build({
  root,
  configFile: false,
  plugins: [irisoutHono(app)],
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: 'virtual:irisout-routes' } },
})
fs.copyFileSync(root + '/styles.css', root + '/dist/styles.css')
fs.writeFileSync(
  root + '/dist/index.html',
  document(
    '<main><h1>Benchmark Suite</h1><p class="subtitle">One app, three frameworks, identical output.</p><div class="cards"><div class="card"><h2>Server Components</h2><p>Pages run on the server and read data with plain async/await. Nothing static ships JavaScript.</p></div><div class="card"><h2>Server Actions</h2><p>Server functions callable from the browser, with the result rendered where it was requested.</p></div><div class="card"><h2>HTTP Endpoints</h2><p>A JSON route with no React on the path, for measuring the HTTP layer on its own.</p></div></div></main>',
    '',
    false,
    'Benchmark Suite',
  ),
)
