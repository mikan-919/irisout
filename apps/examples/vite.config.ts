// authored JSXをirisout compilerで処理し、初期HTMLとhydrate専用モジュールを
// Viteの標準ビルドへ渡す。アプリ側はcompiler/runtimeの内部配置を知らない。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { compile } from '@irisout/compiler'
import { defineConfig } from 'vite-plus'

const virtualEntry = 'virtual:irisout-entry'
const resolvedEntry = `\0${virtualEntry}`

export default defineConfig(() => {
  const input = path.resolve(process.env.IRISOUT_ENTRY ?? 'list.jsx')
  const { code, initialHtml } = compile(readFileSync(input, 'utf8'))

  return {
    plugins: [
      {
        name: 'irisout-example',
        resolveId(id) {
          return id === virtualEntry ? resolvedEntry : null
        },
        load(id) {
          if (id !== resolvedEntry) return null
          return `${code}\nhydrateComponent(document.getElementById('app'));`
        },
        transformIndexHtml(html) {
          return html.replace('<!--irisout-html-->', initialHtml)
        },
      },
    ],
    build: {
      outDir: process.env.IRISOUT_OUT_DIR ?? 'dist',
      emptyOutDir: true,
      // productionのbundle/tree-shakingは維持しつつ、生成コードを確認できるようにする。
      minify: true,
      modulePreload: true,
      rollupOptions: {
        output: {
          entryFileNames: 'app.js',
        },
      },
    },
  }
})
