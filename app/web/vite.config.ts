import path from 'node:path'
import { defineConfig, type Plugin } from 'vite-plus'
import { compileProject, type CompileResult } from 'irisout'
import { irisout } from 'irisout/vite'
import { createControllerCsp, validateSeparateOrigins } from './src/playground/origin.js'

const cacheDir = process.env.IRISOUT_VITE_CACHE_DIR
const runtimeDependencyPath = `/@fs${path.resolve(import.meta.dirname, '../../packages/irisout/dist/runtime.js')}`

function playgroundHeaders(): Plugin {
  let playgroundDevCsp = createControllerCsp(null)
  return {
    name: 'irisout-playground-headers',
    configResolved(config) {
      const siteOrigin = config.env.VITE_IRISOUT_PLAYGROUND_SITE_ORIGIN
      const controllerOrigin = config.env.VITE_IRISOUT_PLAYGROUND_CONTROLLER_ORIGIN
      if (typeof siteOrigin === 'string' && typeof controllerOrigin === 'string') {
        playgroundDevCsp = createControllerCsp(
          validateSeparateOrigins(siteOrigin, controllerOrigin).siteOrigin,
        )
      } else if (typeof siteOrigin === 'string') {
        playgroundDevCsp = createControllerCsp(siteOrigin)
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const [pathname, search] = (request.url ?? '').split('?', 2)
        if (pathname === '/playground/') {
          response.statusCode = 308
          response.setHeader('Location', `/playground${search ? `?${search}` : ''}`)
          response.end()
          return
        }
        // playground.htmlは共有ページの接続用なので、編集画面にはトップのHTMLを使う。
        if (pathname === '/playground') request.url = `/${search ? `?${search}` : ''}`
        const runtimeResource = isPlaygroundRuntimeResource(pathname)
        if (
          pathname === '/playground-controller.html' ||
          pathname.startsWith('/src/playground/') ||
          runtimeResource
        ) {
          response.setHeader('Content-Security-Policy', playgroundDevCsp)
          response.setHeader('Referrer-Policy', 'no-referrer')
          response.setHeader('X-Content-Type-Options', 'nosniff')
          response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()')
          if (runtimeResource) {
            response.setHeader('Access-Control-Allow-Origin', '*')
            response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
          } else {
            response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
          }
        }
        next()
      })
    },
  }
}

function isPlaygroundRuntimeResource(pathname: string) {
  return (
    pathname === '/src/playground/runtime.js' ||
    pathname === runtimeDependencyPath ||
    /^\/node_modules\/\.vite(?:-[^/]+)?\/deps\/irisout_runtime\.js$/.test(pathname)
  )
}

// SSRと同じ解析結果からhydrate用moduleを作る。投稿sourceはこの入口へ渡さない。
function playgroundPageClient(): Plugin {
  const virtualModuleId = 'virtual:irisout-playground-page'
  let root = process.cwd()
  let entryPath = path.resolve(root, 'src/PlaygroundPage.jsx')
  let resolvedId = `\0${virtualModuleId}`
  let result: CompileResult | null = null

  const compile = () => {
    result = compileProject(entryPath, { target: 'ssr' })
    return result
  }

  return {
    name: 'irisout-playground-page-client',
    configResolved(config) {
      root = config.root
      entryPath = path.resolve(root, 'src/PlaygroundPage.jsx')
      resolvedId =
        config.command === 'serve'
          ? `\0${virtualModuleId}`
          : path.join(root, `.irisout-${encodeURIComponent(virtualModuleId)}.js`)
      result = null
    },
    buildStart() {
      const current = compile()
      for (const dependency of current.dependencies) this.addWatchFile(dependency)
    },
    resolveId(id) {
      return id === virtualModuleId ? resolvedId : null
    },
    load(id) {
      if (id !== resolvedId) return null
      const current = result ?? compile()
      return { code: current.code, map: current.map }
    },
  }
}

export default defineConfig({
  base: '/',
  // Playground開発時は二つのVite+を同時に起動するため、依存最適化の保存先を分ける。
  ...(cacheDir ? { cacheDir } : {}),
  plugins: [
    irisout({ entry: 'src/App.jsx', container: '#app' }),
    playgroundPageClient(),
    playgroundHeaders(),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: true,
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        controller: path.resolve(import.meta.dirname, 'playground-controller.html'),
        playground: path.resolve(import.meta.dirname, 'playground.html'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'main') return 'app.js'
          if (chunk.name === 'playground') return 'playground.js'
          if (chunk.name === 'controller') return 'assets/controller/[name]-[hash].js'
          return 'assets/[name]-[hash].js'
        },
        chunkFileNames: (chunk) =>
          isControllerChunk(chunk)
            ? 'assets/controller/[name]-[hash].js'
            : 'assets/[name]-[hash].js',
        assetFileNames: (asset) =>
          asset.name?.startsWith('controller')
            ? 'assets/controller/[name]-[hash][extname]'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
  worker: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/controller/[name]-[hash].js',
        chunkFileNames: 'assets/controller/[name]-[hash].js',
      },
    },
  },
})

function isControllerChunk(chunk: { name: string; facadeModuleId?: string | null }) {
  return (
    chunk.name === 'controller' ||
    chunk.name === 'compiler.worker' ||
    chunk.facadeModuleId?.endsWith('/src/playground/controller.js') === true ||
    chunk.facadeModuleId?.endsWith('/src/playground/runtime.js') === true
  )
}
