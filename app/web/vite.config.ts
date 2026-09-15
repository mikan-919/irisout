import path from 'node:path'
import { defineConfig, type Plugin } from 'vite-plus'
import { compileProject, type CompileResult } from 'irisout'
import { irisout } from 'irisout/vite'
import { createControllerCsp, validateSeparateOrigins } from './src/playground/origin.js'

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
        const pathname = request.url?.split('?')[0] ?? ''
        if (pathname === '/playground-controller.html' || pathname.startsWith('/src/playground/')) {
          response.setHeader('Content-Security-Policy', playgroundDevCsp)
          response.setHeader('Referrer-Policy', 'no-referrer')
          response.setHeader('X-Content-Type-Options', 'nosniff')
          response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()')
          if (
            pathname === '/src/playground/runtime.js' ||
            pathname.startsWith('/node_modules/.vite/deps/')
          ) {
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
          return 'assets/[name]-[hash].js'
        },
      },
    },
  },
})
