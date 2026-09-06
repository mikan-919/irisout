// authored JSXを再利用可能なirisout Vite連携へ渡すexamples設定。
import { defineConfig } from 'vite-plus'
import { irisout } from '@irisout/vite-plugin'

export default defineConfig(() => {
  return {
    plugins: [
      irisout({
        entry: process.env.IRISOUT_ENTRY ?? 'counter.jsx',
        container: '#app',
      }),
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
