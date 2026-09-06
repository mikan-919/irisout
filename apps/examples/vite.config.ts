// authored JSXをirisout compilerで処理し、初期HTMLとhydrate専用モジュールを
// Viteの標準ビルドへ渡す。module graphの読込はcompilerへ委譲し、アプリ側は
// compiler/runtimeの内部配置を知らない。
import path from 'node:path'
import { compileProject } from '@irisout/compiler'
import { defineConfig } from 'vite-plus'

const virtualEntry = 'virtual:irisout-entry'
const resolvedEntry = `\0${virtualEntry}`

export default defineConfig(() => {
  const input = path.resolve(process.env.IRISOUT_ENTRY ?? 'counter.jsx')
  const { code, initialHtml } = compileProject(input)

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
      minify: process.env.IRISOUT_MINIFY !== 'false',
      modulePreload: true,
      rollupOptions: {
        output: {
          entryFileNames: 'app.js',
        },
      },
    },
  }
})
