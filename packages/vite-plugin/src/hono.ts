// Honoへmount済みのirisout page処理関数から経路情報を読み、Viteのclient生成へ渡す。
// ファイル探索や経路接頭辞の再指定は行わず、Honoの登録済み経路をSSOTとして扱う。

import type { Hono } from 'hono'
import type { IncomingMessage } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite-plus'
import { irisoutExplicitRoutes, type IrisoutExplicitRouteDefinition } from './routes.ts'

const irisoutHonoPageMetadata = Symbol.for('irisout.hono.page-metadata')

interface HonoPageMetadata {
  readonly route: {
    readonly id: string
    readonly filePath: string
  }
  readonly dependencies: readonly string[]
  readonly rootDirectory: string
  readonly transformSource?: (source: string, filePath: string) => string
  readonly refreshPage?: (filePath: string) => void
}

export interface IrisoutHonoOptions {
  /** SSR文書内のhydrate対象。 */
  readonly container?: string
  /** client入口からimportする仮想module名。 */
  readonly virtualModuleId?: string
}

function readMetadata(handler: unknown): HonoPageMetadata | undefined {
  if (typeof handler !== 'function') return undefined
  return (handler as unknown as Record<PropertyKey, HonoPageMetadata | undefined>)[
    irisoutHonoPageMetadata
  ]
}

function collectRoutes(app: Hono): IrisoutExplicitRouteDefinition[] {
  const routes: IrisoutExplicitRouteDefinition[] = []
  const ids = new Map<string, string>()
  for (const registered of app.routes) {
    const metadata = readMetadata(registered.handler)
    if (!metadata) continue
    const existing = ids.get(metadata.route.id)
    if (existing && existing !== metadata.route.filePath) {
      throw new Error(
        `compile: irisout Hono route id "${metadata.route.id}" is used by ${existing} and ${metadata.route.filePath} (scope limit)`,
      )
    }
    ids.set(metadata.route.id, metadata.route.filePath)
    routes.push({
      id: metadata.route.id,
      path: registered.path,
      filePath: metadata.route.filePath,
      rootDirectory: metadata.rootDirectory,
      dependencies: metadata.dependencies,
      transformSource: metadata.transformSource,
      refreshSsr: metadata.refreshPage,
    })
  }
  return routes
}

function routePattern(pathname: string): RegExp {
  const source = pathname
    .split('/')
    .map((segment) =>
      segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/')
  return new RegExp(`^${source}/?$`)
}

function createRequest(request: IncomingMessage, server: ViteDevServer): Request {
  const host = request.headers.host
  if (!host) throw new Error('開発サーバーのHostがありません')
  const protocol = server.config.server.https ? 'https' : 'http'
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  return new Request(new URL(request.url ?? '/', `${protocol}://${host}`), {
    method: request.method,
    headers,
  })
}

function developmentPages(app: Hono, routes: readonly IrisoutExplicitRouteDefinition[]): Plugin {
  const patterns = routes.map((route) => routePattern(route.path))
  return {
    name: 'irisout-hono-development-pages',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (new URL(request.url ?? '/', 'http://irisout.local').pathname === '/irisout-client.js') {
          request.url = '/@id/virtual:irisout-routes'
        }
        next()
      })
      server.middlewares.use(async (request, response, next) => {
        if (request.method !== 'GET') return next()
        const pathname = new URL(request.url ?? '/', 'http://irisout.local').pathname
        if (!patterns.some((pattern) => pattern.test(pathname))) return next()

        const result = await app.fetch(createRequest(request, server))
        response.statusCode = result.status
        result.headers.forEach((value, name) => response.setHeader(name, value))
        response.end(Buffer.from(await result.arrayBuffer()))
      })
    },
  }
}

/** Hono appの登録済みirisout経路をViteのclient生成へ接続する。 */
export function irisoutHono(app: Hono, options: IrisoutHonoOptions = {}): Plugin {
  const routes = collectRoutes(app)
  if (routes.length === 0) {
    throw new Error('compile: irisoutHono found no createFileRouter routes (scope limit)')
  }
  const routesPlugin = irisoutExplicitRoutes({ ...options, routes, emitEntry: true })
  const pagesPlugin = developmentPages(app, routes)
  const configureRoutes = routesPlugin.configureServer
  const configurePages = pagesPlugin.configureServer
  return {
    ...routesPlugin,
    configureServer(server) {
      if (typeof configureRoutes === 'function') void configureRoutes.call(this, server)
      else void configureRoutes?.handler.call(this, server)
      if (typeof configurePages === 'function') void configurePages.call(this, server)
      else void configurePages?.handler.call(this, server)
    },
  }
}

export default irisoutHono
