import { randomBytes } from 'node:crypto'
import path from 'node:path'
import type { IncomingMessage } from 'node:http'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite-plus'
import { compileProject, type CompileResult } from 'irisout'
import { irisout } from 'irisout/vite'
import { PLAYGROUND_BODY_MAX_BYTES, createPlaygroundApi } from './server/playground-api.mjs'
import { parseTrustedProxyAddresses, resolveClientAddress } from './server/client-address.mjs'
import { createControllerCsp, validateSeparateOrigins } from './src/playground/origin.js'

const cacheDir = process.env.IRISOUT_VITE_CACHE_DIR
const developmentRole = process.env.IRISOUT_PLAYGROUND_DEV_ROLE
const runtimeDependencyPath = `/@fs${path.resolve(import.meta.dirname, '../../packages/irisout/dist/runtime.js')}`

type DevelopmentPlaygroundInput = {
  schemaVersion: number
  title: string
  description: string
  source: string
  compilerVersion: string
  visibility: string
  requestId: string
}

type DevelopmentPlaygroundRecord = {
  id: string
  input: DevelopmentPlaygroundInput
  deleteToken: string
  createdAt: string
  deletedAt: string | null
}

type DevelopmentPlaygroundStore = {
  save(options: {
    input: DevelopmentPlaygroundInput
    deleteToken: string
    now?: Date
  }):
    | { kind: 'created' | 'existing'; id: string; createdAt: string }
    | { kind: 'not-found' | 'deleted' | 'conflict' }
  delete(id: string, deleteToken: string): 'not-found' | 'deleted'
}

type CreatePlaygroundApi = (options: {
  store: DevelopmentPlaygroundStore
  officialOrigin: string
}) => ReturnType<typeof createPlaygroundApi>

const createPlaygroundApiForDevelopment = createPlaygroundApi as unknown as CreatePlaygroundApi

function playgroundHeaders(): Plugin {
  let playgroundDevCsp = createControllerCsp(null)
  let playgroundDevSiteOrigin: string | null = null
  return {
    name: 'irisout-playground-headers',
    configResolved(config) {
      const siteOrigin = config.env.VITE_IRISOUT_PLAYGROUND_SITE_ORIGIN
      const controllerOrigin = config.env.VITE_IRISOUT_PLAYGROUND_CONTROLLER_ORIGIN
      if (typeof siteOrigin === 'string' && typeof controllerOrigin === 'string') {
        playgroundDevSiteOrigin = validateSeparateOrigins(siteOrigin, controllerOrigin).siteOrigin
        playgroundDevCsp = createControllerCsp(playgroundDevSiteOrigin)
      } else if (typeof siteOrigin === 'string') {
        playgroundDevSiteOrigin = new URL(siteOrigin).origin
        playgroundDevCsp = createControllerCsp(siteOrigin)
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const redirect = playgroundDevelopmentRedirect(
          developmentRole,
          playgroundDevSiteOrigin,
          request.headers?.host,
          request.url,
        )
        if (redirect) {
          response.statusCode = 307
          response.setHeader('Location', redirect)
          response.end()
          return
        }
        const [pathname, search] = (request.url ?? '').split('?', 2)
        if (pathname === '/playground/') {
          response.statusCode = 308
          response.setHeader('Location', `/playground${search ? `?${search}` : ''}`)
          response.end()
          return
        }
        // /playgroundはLPと別の編集画面へ接続する。
        if (pathname === '/playground') {
          request.url = `/playground.html${search ? `?${search}` : ''}`
        }
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

export function playgroundSaveApi(): Plugin {
  let configuredSiteOrigin: string | null = null

  return {
    name: 'irisout-playground-save-api',
    apply: 'serve',
    configResolved(config) {
      const value = config.env.VITE_IRISOUT_PLAYGROUND_SITE_ORIGIN
      configuredSiteOrigin =
        typeof value === 'string' && value.trim().length > 0 ? new URL(value).origin : null
    },
    configureServer(server) {
      // 実行管理Originには保存APIとSQLiteを置かない。
      if (process.env.IRISOUT_PLAYGROUND_DEV_ROLE === 'controller') return

      const store = createDevelopmentPlaygroundStore()
      const apiByOrigin = new Map<string, ReturnType<typeof createPlaygroundApi>>()
      const trustedProxyAddresses = parseTrustedProxyAddresses(process.env.IRISOUT_TRUSTED_PROXY)

      server.middlewares.use(async (request, response, next) => {
        if (!isPlaygroundApiRequest(request)) {
          next()
          return
        }

        try {
          const officialOrigin = configuredSiteOrigin ?? requestOrigin(request, server)
          let api = apiByOrigin.get(officialOrigin)
          if (!api) {
            api = createPlaygroundApiForDevelopment({ store, officialOrigin })
            apiByOrigin.set(officialOrigin, api)
          }
          const fetchRequest = await createFetchRequest(request, server)
          const result = await api.handle(fetchRequest, {
            clientAddress: resolveClientAddress({
              socketAddress: request.socket?.remoteAddress ?? request.connection?.remoteAddress,
              forwardedFor: headerValue(request.headers['x-forwarded-for']),
              trustedProxyAddresses,
            }),
          })
          if (!result) {
            next()
            return
          }
          response.statusCode = result.status
          result.headers.forEach((value: string, name: string) => response.setHeader(name, value))
          response.end(Buffer.from(await result.arrayBuffer()))
        } catch {
          response.statusCode = 500
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ error: '保存APIでエラーが発生しました' }))
        }
      })
    },
  }
}

function createDevelopmentPlaygroundStore() {
  // ponytail: 開発再起動で消えるメモリ保存。永続確認はBunサーバーで行う。
  const records = new Map<string, DevelopmentPlaygroundRecord>()
  const store: DevelopmentPlaygroundStore = {
    save({ input, deleteToken, now = new Date() }) {
      const existing = [...records.values()].find(
        (record) => record.input.requestId === input.requestId,
      )
      if (existing) {
        if (existing.deleteToken !== deleteToken) return { kind: 'not-found' }
        if (existing.deletedAt !== null) return { kind: 'deleted' }
        if (!samePlaygroundInput(existing.input, input)) return { kind: 'conflict' }
        return { kind: 'existing', id: existing.id, createdAt: existing.createdAt }
      }

      const record = {
        id: randomBytes(16).toString('base64url'),
        input,
        deleteToken,
        createdAt: now.toISOString(),
        deletedAt: null,
      }
      records.set(record.id, record)
      return { kind: 'created', id: record.id, createdAt: record.createdAt }
    },
    delete(id, deleteToken) {
      const record = records.get(id)
      if (!record || record.deleteToken !== deleteToken) return 'not-found'
      if (record.deletedAt !== null) return 'deleted'
      record.deletedAt = new Date().toISOString()
      return 'deleted'
    },
  }
  return store
}

function samePlaygroundInput(left: DevelopmentPlaygroundInput, right: DevelopmentPlaygroundInput) {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.title === right.title &&
    left.description === right.description &&
    left.source === right.source &&
    left.compilerVersion === right.compilerVersion &&
    left.visibility === right.visibility &&
    left.requestId === right.requestId
  )
}

function isPlaygroundApiRequest(request: IncomingMessage) {
  if (request.method !== 'POST' && request.method !== 'DELETE') return false
  const pathname = new URL(request.url ?? '/', 'http://playground.local').pathname
  return pathname === '/api/playgrounds' || /^\/api\/playgrounds\/[^/]+$/.test(pathname)
}

function requestOrigin(request: IncomingMessage, server: ViteDevServer) {
  const host = request.headers.host
  if (!host) throw new Error('開発サーバーのHostがありません')
  const protocol = server.config.server.https ? 'https' : 'http'
  return new URL(`${protocol}://${host}`).origin
}

async function createFetchRequest(request: IncomingMessage, server: ViteDevServer) {
  const host = request.headers.host
  if (!host) throw new Error('開発サーバーのHostがありません')
  const protocol = server.config.server.https ? 'https' : 'http'
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total <= PLAYGROUND_BODY_MAX_BYTES) chunks.push(buffer)
  }
  const body =
    total > PLAYGROUND_BODY_MAX_BYTES
      ? new Uint8Array(PLAYGROUND_BODY_MAX_BYTES + 1)
      : Buffer.concat(chunks, total)
  return new Request(new URL(request.url ?? '/', `${protocol}://${host}`), {
    method: request.method,
    headers,
    body,
  })
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(', ') : value
}

export function playgroundDevelopmentRedirect(
  role: string | undefined,
  siteOrigin: string | null,
  host: string | undefined,
  requestUrl: string | undefined,
) {
  if (role !== 'site' || !siteOrigin || !host) return null
  if (new URL(`http://${host}`).origin === siteOrigin) return null
  return `${siteOrigin}${requestUrl?.startsWith('/') ? requestUrl : '/'}`
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
    playgroundSaveApi(),
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
        'shared-playground': path.resolve(import.meta.dirname, 'src/playground-page-client.js'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'main') return 'app.js'
          if (chunk.name === 'playground') return 'playground.js'
          if (chunk.name === 'shared-playground') return 'shared-playground.js'
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
        entryFileNames: (chunk) =>
          isControllerChunk(chunk)
            ? 'assets/controller/[name]-[hash].js'
            : 'assets/[name]-[hash].js',
        chunkFileNames: (chunk) =>
          isControllerChunk(chunk)
            ? 'assets/controller/[name]-[hash].js'
            : 'assets/[name]-[hash].js',
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
