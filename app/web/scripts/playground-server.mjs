// 公式サイトと実行管理画面を別配信元で確認するための静的配信器。
// 実運用でも同じ責務を持つ配信設定へ移せるよう、管理APIや保存領域は提供しない。

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createControllerCsp, validateSeparateOrigins } from '../src/playground/origin.js'
import { resolvePublicPath } from '../server/static-files.mjs'

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

export function createPlaygroundServer({
  root,
  kind = 'site',
  host = '127.0.0.1',
  port = 0,
  officialOrigin,
} = {}) {
  const absoluteRoot = path.resolve(root)
  const controllerCsp =
    kind === 'controller' ? createControllerServerConfig({ host, officialOrigin }) : null
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (kind === 'controller' && !isControllerPath(pathname)) {
      response.writeHead(404)
      response.end('not found')
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' })
      response.end('method not allowed')
      return
    }

    if (kind === 'site' && pathname === '/playground/') {
      response.writeHead(308, {
        location: `/playground${new URL(request.url ?? '/', 'http://127.0.0.1').search}`,
      })
      response.end()
      return
    }

    try {
      const filePath = await resolvePublicPath(absoluteRoot, pathname, staticCandidates)
      const body = await readFile(filePath)
      const headers = {
        'content-type': MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      }
      if (kind === 'controller') {
        headers['content-security-policy'] = controllerCsp.csp
        headers['permissions-policy'] = 'camera=(), geolocation=(), microphone=()'
        headers['cross-origin-opener-policy'] = 'same-origin'
        if (pathname.startsWith('/assets/')) {
          headers['access-control-allow-origin'] = '*'
          headers['cross-origin-resource-policy'] = 'cross-origin'
        } else {
          headers['cross-origin-resource-policy'] = 'same-origin'
        }
      }
      response.writeHead(200, headers)
      if (request.method === 'HEAD') response.end()
      else response.end(body)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        response.writeHead(404)
        response.end('not found')
        return
      }
      response.writeHead(400)
      response.end('bad request')
    }
  })

  return {
    server,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, resolve)
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('配信先を取得できません')
      const visibleHost = host.includes(':') ? `[${host}]` : host
      return { origin: `http://${visibleHost}:${address.port}` }
    },
    async close() {
      if (!server.listening) return
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}

function createControllerServerConfig({ host, officialOrigin }) {
  if (typeof officialOrigin !== 'string' || officialOrigin.length === 0) {
    throw new Error('実行管理画面には公式Originの設定が必要です')
  }
  const controllerOrigin = `http://${host.includes(':') ? `[${host}]` : host}:0`
  const origins = validateSeparateOrigins(officialOrigin, controllerOrigin)
  return {
    csp: createControllerCsp(origins.siteOrigin),
  }
}

function isControllerPath(pathname) {
  return pathname === '/playground-controller.html' || pathname.startsWith('/assets/')
}

function staticCandidates(pathname) {
  if (pathname === '/playground') return ['index.html']
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1)
  return [relative, path.join(relative, 'index.html'), `${relative}.html`]
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const kind = process.env.IRISOUT_PLAYGROUND_SERVER_KIND === 'controller' ? 'controller' : 'site'
  const port = Number(process.env.PORT ?? (kind === 'controller' ? 4174 : 4173))
  const host = process.env.HOST ?? (kind === 'controller' ? 'localhost' : '127.0.0.1')
  const handle = createPlaygroundServer({
    root: path.resolve(import.meta.dirname, '../dist'),
    kind,
    host,
    port,
    officialOrigin:
      process.env.IRISOUT_SITE_ORIGIN ??
      (kind === 'controller' ? 'http://127.0.0.1:4173' : undefined),
  })
  const { origin } = await handle.listen()
  console.log(`${kind} server: ${origin}`)
  const close = () => void handle.close().then(() => process.exit(0))
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}
