import path from 'node:path'
import { defineConfig, type Plugin } from 'vite-plus'
import { irisout } from 'irisout/vite'

const playgroundDevCsp = [
  "default-src 'none'",
  "script-src 'self' data: 'unsafe-inline' 'unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "frame-src 'self'",
  "connect-src 'self' ws:",
  "img-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  'frame-ancestors http://127.0.0.1:* http://localhost:*',
].join('; ')

function playgroundHeaders(): Plugin {
  return {
    name: 'irisout-playground-headers',
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

export default defineConfig({
  base: '/',
  plugins: [irisout({ entry: 'src/App.jsx', container: '#app' }), playgroundHeaders()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: true,
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        controller: path.resolve(import.meta.dirname, 'playground-controller.html'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'main') return 'app.js'
          return 'assets/[name]-[hash].js'
        },
      },
    },
  },
})
