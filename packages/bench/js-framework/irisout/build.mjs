// リポジトリのirisoutを本番用に構築し、公式測定器から開ける位置へ出力する。
import { build } from 'vite-plus'
import { irisout } from '../../../irisout/dist/vite.js'
import path from 'node:path'
const root = import.meta.dirname
const checkout = process.env.JSFB_CHECKOUT ?? '/tmp/irisout-js-framework-benchmark'
await build({
  root,
  configFile: false,
  base: '/frameworks/keyed/irisout/dist/',
  plugins: [
    irisout({
      entry: 'main.jsx',
      container: '#main',
      listEvents: process.env.JSFB_LIST_EVENTS === 'direct' ? 'direct' : 'delegated',
    }),
  ],
  resolve: { alias: { 'irisout/runtime': path.resolve(root, '../../../irisout/dist/runtime.js') } },
  build: {
    outDir: path.join(checkout, 'frameworks/keyed/irisout/dist'),
    emptyOutDir: true,
    minify: true,
  },
})
