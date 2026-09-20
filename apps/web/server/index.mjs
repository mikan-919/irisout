// 公式サイト用の最小Bunサーバー。
// 静的配信と共有保存APIを同一Originで扱い、実行管理画面は別配信器へ残す。

import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { PlaygroundStore } from './playground-store.mjs'
import { createPlaygroundApi } from './playground-api.mjs'
import { createPlaygroundPageHandler } from './playground-ssr.mjs'
import { parseTrustedProxyAddresses, resolveClientAddress } from './client-address.mjs'
import { decodeRequestPath, resolveDecodedPublicPath } from './static-files.mjs'

const root = path.resolve(import.meta.dirname, '../dist')
const dataDirectory = path.resolve(
  process.env.IRISOUT_PLAYGROUND_DATA ?? path.join(import.meta.dirname, '../.data'),
)
const databasePath = path.join(dataDirectory, 'playgrounds.sqlite')
const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '127.0.0.1'
const officialOrigin = process.env.IRISOUT_SITE_ORIGIN ?? `http://${host}:${port}`
const trustedProxyAddresses = parseTrustedProxyAddresses(process.env.IRISOUT_TRUSTED_PROXY)

await mkdir(dataDirectory, { recursive: true })
const store = new PlaygroundStore(databasePath)
const api = createPlaygroundApi({ store, officialOrigin })
const playgroundRender = await loadPlaygroundRender(root)
const playgroundPage = createPlaygroundPageHandler({
  store,
  render:
    playgroundRender ??
    (() => {
      throw new Error('Playground SSR生成物がありません')
    }),
  officialOrigin,
})

const server = Bun.serve({
  hostname: host,
  port,
  async fetch(request) {
    const pageResponse = await playgroundPage(request)
    if (pageResponse) return pageResponse
    const socketAddress = server.requestIP(request)?.address
    const apiResponse = await api.handle(request, {
      clientAddress: resolveClientAddress({
        socketAddress,
        forwardedFor: request.headers.get('x-forwarded-for'),
        trustedProxyAddresses,
      }),
    })
    if (apiResponse) return apiResponse
    return serveStatic(request)
  },
})

console.log(`irisout web server: http://${host}:${server.port}`)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    store.close()
    server.stop()
    process.exit(0)
  })
}

async function serveStatic(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  const url = new URL(request.url)
  const rawPathname = extractRawPathname(request.url)
  let decodedPath
  try {
    decodedPath = decodeRequestPath(rawPathname)
  } catch {
    return new Response('bad request', { status: 400 })
  }

  if (isControllerOnlyPath(decodedPath)) {
    return new Response('not found', { status: 404 })
  }
  if (decodedPath === '/server' || decodedPath.startsWith('/server/')) {
    return new Response('not found', { status: 404 })
  }

  const canonicalPath = canonicalDocumentPath(decodedPath)
  if (canonicalPath) {
    try {
      await resolveDecodedPublicPath(root, canonicalPath, staticCandidates)
      return new Response(null, {
        status: 308,
        headers: { location: `${canonicalPath}${url.search}` },
      })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  let filePath
  try {
    filePath = await resolveDecodedPublicPath(root, decodedPath, staticCandidates)
  } catch (error) {
    if (error?.code === 'EINVAL') return new Response('bad request', { status: 400 })
    if (error?.code === 'ENOENT') return new Response('not found', { status: 404 })
    throw error
  }
  const file = Bun.file(filePath)
  if (!(await file.exists())) return new Response('not found', { status: 404 })
  return new Response(request.method === 'HEAD' ? null : file, {
    headers: {
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  })
}

function extractRawPathname(requestUrl) {
  const absolute = /^(?:[a-z][a-z\d+.-]*:\/\/[^/]*)([^?#]*)/i.exec(requestUrl)
  if (absolute) return absolute[1] || '/'
  return requestUrl.split(/[?#]/, 1)[0] || '/'
}

function isControllerOnlyPath(decodedPath) {
  // 連続slashや符号化slashを解決した後も、実行管理専用資産を公式Originから隠す。
  const normalizedPath = decodedPath.replaceAll(/\/{2,}/g, '/')
  return (
    normalizedPath === '/playground-controller.html' ||
    normalizedPath.startsWith('/assets/controller/')
  )
}

function canonicalDocumentPath(decodedPath) {
  if (decodedPath === '/docs/') return '/docs'
  if (decodedPath === '/examples/') return '/examples'
  const match = /^\/docs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/.exec(decodedPath)
  return match ? `/docs/${match[1]}` : null
}

function staticCandidates(decodedPath) {
  if (decodedPath === '/') return ['index.html']
  if (decodedPath === '/playground') return ['playground.html']
  if (decodedPath === '/docs') return ['docs/index.html']
  if (decodedPath === '/examples') return ['examples/index.html']
  if (decodedPath === '/examples/bcf-copy-button') {
    return ['examples/bcf-copy-button.html']
  }
  if (decodedPath.startsWith('/docs/')) {
    const relative = decodedPath.slice(1)
    return [relative, path.join(relative, 'index.html'), `${relative}.html`]
  }
  return [decodedPath.slice(1)]
}

async function loadPlaygroundRender(distRoot) {
  const serverModule = path.join(distRoot, 'server', 'playground-page.js')
  try {
    const module = await import(serverModule)
    return typeof module.render === 'function' ? module.render : null
  } catch {
    // SSR生成物がない開発状態では共有ページだけ503にする。
    return null
  }
}
