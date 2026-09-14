// 公式サイト用の最小Bunサーバー。
// 静的配信と共有保存APIを同一Originで扱い、実行管理画面は別配信器へ残す。

import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { PlaygroundStore } from './playground-store.mjs'
import { createPlaygroundApi } from './playground-api.mjs'
import { createPlaygroundPageHandler } from './playground-ssr.mjs'

const root = path.resolve(import.meta.dirname, '../dist')
const dataDirectory = path.resolve(
  process.env.IRISOUT_PLAYGROUND_DATA ?? path.join(import.meta.dirname, '../.data'),
)
const databasePath = path.join(dataDirectory, 'playgrounds.sqlite')
const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '127.0.0.1'
const officialOrigin = process.env.IRISOUT_SITE_ORIGIN ?? `http://${host}:${port}`

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
    const apiResponse = await api.handle(request)
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
  let decodedPath
  try {
    decodedPath = decodeURIComponent(url.pathname)
  } catch {
    return new Response('bad request', { status: 400 })
  }
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.slice(1)
  const staticPath = decodedPath === '/playground' ? 'index.html' : relativePath
  const filePath = path.resolve(root, staticPath)
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    return new Response('bad request', { status: 400 })
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
