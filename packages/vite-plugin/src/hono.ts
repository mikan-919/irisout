// Honoへmount済みのirisout page処理関数から経路情報を読み、Viteのclient生成へ渡す。
// ファイル探索や経路接頭辞の再指定は行わず、Honoの登録済み経路をSSOTとして扱う。

import type { Hono } from 'hono'
import type { Plugin } from 'vite-plus'
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
    })
  }
  return routes
}

/** Hono appの登録済みirisout経路をViteのclient生成へ接続する。 */
export function irisoutHono(app: Hono, options: IrisoutHonoOptions = {}): Plugin {
  const routes = collectRoutes(app)
  if (routes.length === 0) {
    throw new Error('compile: irisoutHono found no createFileRouter routes (scope limit)')
  }
  return irisoutExplicitRoutes({ ...options, routes, emitEntry: true })
}

export default irisoutHono
