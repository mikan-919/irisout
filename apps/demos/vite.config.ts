// authored JSXを再利用可能なirisout Vite連携へ渡すデモ設定。
import { defineConfig } from 'vite-plus'
import { irisoutMotion } from 'irisout/motion/vite'
import { irisout } from 'irisout/vite'

export default defineConfig(() => {
  return {
    base: process.env.IRISOUT_BASE ?? '/',
    plugins: [
      (process.env.IRISOUT_MOTION === 'true' ? irisoutMotion : irisout)({
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
