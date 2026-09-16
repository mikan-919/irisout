// `page.jsx`のclient生成物と純粋な経路表をViteの仮想moduleへまとめる。
// Node側の走査とcompileProjectはplugin実行中だけに留まり、仮想moduleが
// ブラウザーへ渡すのはroutes表とhydrate可能なpage moduleだけにする。

import path from 'node:path'
import { compileProject, type CompileResult } from '../../compiler/src/compiler.ts'
import {
  createRouteTable,
  toClientRouteTable,
  type ClientRouteDefinition,
  type RouteTable,
} from '../../routes/src/index.ts'
import { scanFileRoutes, type FileRouteManifest } from '../../routes/src/node.ts'
import type { HmrContext, Plugin, ResolvedConfig } from 'vite-plus'

const DEFAULT_VIRTUAL_MODULE_ID = 'virtual:irisout-routes'
const DEFAULT_CONTAINER = '#app'
const PAGE_MODULE_MARKER = ':page:'

export interface IrisoutRoutesPluginOptions {
  /** Viteのrootから解決するpage.jsxディレクトリ。絶対pathも受け付ける。 */
  directory?: string
  /** directoryの別名。 */
  routes?: string
  /** サーバーのHono経路表と同じ接頭辞。 */
  prefix?: string
  /** prefixの別名。両方を指定した場合はbasePathを使う。 */
  basePath?: string
  /** SSR文書内のhydrate対象。 */
  container?: string
  /** main.jsからimportする仮想module名。 */
  virtualModuleId?: string
}

interface RoutePage {
  readonly route: FileRouteManifest['routes'][number]
  readonly filePath: string
  readonly result: CompileResult
  readonly rawId: string
  readonly resolvedId: string
}

interface RouteBuild {
  readonly manifest: FileRouteManifest
  readonly table: RouteTable
  readonly clientTable: RouteTable<ClientRouteDefinition>
  readonly pages: readonly RoutePage[]
  readonly dependencies: ReadonlySet<string>
}

function normalizePath(filePath: string): string {
  return path.normalize(path.resolve(filePath))
}

function isWithin(directory: string, filePath: string): boolean {
  const relative = path.relative(directory, filePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function requireDirectory(options: IrisoutRoutesPluginOptions): string {
  const directory = options.directory ?? options.routes
  if (!directory) {
    throw new Error('compile: irisoutRoutes requires directory or routes (scope limit)')
  }
  return directory
}

function pageModuleSource(
  clientTable: RouteTable<ClientRouteDefinition>,
  pages: readonly RoutePage[],
  containerSelector: string,
): string {
  const imports = pages.map(
    (page, index) => `import * as __irisout_page_${index}__ from ${JSON.stringify(page.rawId)};`,
  )
  const pagesByRoute = clientTable.routes
    .map((route) => {
      const page = pages.find((candidate) => candidate.route.id === route.id)
      if (!page) return null
      const index = pages.indexOf(page)
      return `${JSON.stringify(route.id)}: __irisout_page_${index}__,`
    })
    .filter((entry): entry is string => entry != null)
  const container = JSON.stringify(containerSelector)
  const missingContainer = JSON.stringify(`irisout route container not found: ${containerSelector}`)

  return [
    ...imports,
    "import { createRouteNavigator } from 'irisout/routes';",
    '',
    `const __irisout_route_table__ = ${JSON.stringify(clientTable)};`,
    `const __irisout_pages__ = { ${pagesByRoute.join(' ')} };`,
    `const __irisout_container__ = () => ${
      containerSelector === '#app'
        ? "document.getElementById('app')"
        : `document.querySelector(${container})`
    };`,
    `const __irisout_read_initial__ = () => {`,
    `  const __script__ = document.querySelector('script[data-irisout-route-state]');`,
    `  if (!__script__) return null;`,
    `  const __route_id__ = __script__.getAttribute('data-irisout-route-id');`,
    `  if (!__route_id__) throw new Error('irisout initial route state has no route id');`,
    `  return { routeId: __route_id__, state: JSON.parse(__script__.textContent ?? '') };`,
    `};`,
    `const __irisout_page_for__ = (routeId) => {`,
    `  const __page__ = __irisout_pages__[routeId];`,
    `  if (!__page__ || typeof __page__.hydrateComponent !== 'function') throw new Error('irisout route page module not found');`,
    `  return __page__;`,
    `};`,
    `const __irisout_render__ = async (response, match, containerElement) => {`,
    `  const __page__ = __irisout_page_for__(response.routeId);`,
    `  containerElement.innerHTML = response.html;`,
    `  return __page__.hydrateComponent(containerElement, response.state);`,
    `};`,
    `const __irisout_hydrate_initial__ = async (match, containerElement) => {`,
    `  const __initial__ = __irisout_read_initial__();`,
    `  if (!__initial__) throw new Error('irisout initial route state was not found');`,
    `  if (__initial__.routeId !== match.route.id) throw new Error('irisout initial route state does not match URL');`,
    `  return __irisout_page_for__(__initial__.routeId).hydrateComponent(containerElement, __initial__.state);`,
    `};`,
    `const __irisout_fallback__ = (url) => window.location.assign(url.href);`,
    `export const routeTable = __irisout_route_table__;`,
    `export const routeNavigator = createRouteNavigator({`,
    `  table: __irisout_route_table__,`,
    `  container: () => { const __element__ = __irisout_container__(); if (!__element__) throw new Error(${missingContainer}); return __element__; },`,
    `  renderPage: __irisout_render__,`,
    `  hydrateInitial: __irisout_hydrate_initial__,`,
    `  fallback: __irisout_fallback__,`,
    `});`,
    `void routeNavigator.start();`,
    '',
  ].join('\n')
}

/** page.jsx群からclient経路表とhydrate入口を生成するVite plugin。 */
export function irisoutRoutes(options: IrisoutRoutesPluginOptions): Plugin {
  const virtualModuleId = options.virtualModuleId ?? DEFAULT_VIRTUAL_MODULE_ID
  const containerSelector = options.container ?? DEFAULT_CONTAINER
  let root = process.cwd()
  let directoryPath = normalizePath(path.resolve(root, requireDirectory(options)))
  let resolvedVirtualModuleId = path.join(
    root,
    `.irisout-${encodeURIComponent(virtualModuleId)}.js`,
  )
  let result: RouteBuild | null = null
  let pageIds = new Map<string, string>()

  const pageRawId = (filePath: string): string =>
    `${virtualModuleId}${PAGE_MODULE_MARKER}${encodeURIComponent(filePath)}`
  const pageResolvedId = (rawId: string): string =>
    path.join(root, `.irisout-${encodeURIComponent(rawId)}.js`)

  const compile = (): RouteBuild => {
    const manifest = scanFileRoutes(directoryPath)
    const table = createRouteTable(manifest.routes, {
      basePath: options.basePath ?? options.prefix,
    })
    const clientTable = toClientRouteTable(table)
    const nextPageIds = new Map<string, string>()
    const pages: RoutePage[] = []
    const dependencies = new Set<string>([directoryPath, ...manifest.dependencies])
    for (const route of manifest.routes) {
      const compiled = compileProject(route.filePath, { target: 'ssr' })
      const rawId = pageRawId(route.filePath)
      const resolvedId = pageResolvedId(rawId)
      nextPageIds.set(resolvedId, route.filePath)
      pages.push({ route, filePath: route.filePath, result: compiled, rawId, resolvedId })
      for (const dependency of compiled.dependencies) dependencies.add(normalizePath(dependency))
    }
    const next: RouteBuild = { manifest, table, clientTable, pages, dependencies }
    result = next
    pageIds = nextPageIds
    return next
  }

  const ensureCompiled = (): RouteBuild => result ?? compile()
  const watch = (add: (filePath: string) => void): void => {
    for (const filePath of ensureCompiled().dependencies) {
      if (filePath !== directoryPath) add(filePath)
    }
  }

  return {
    name: 'irisout-routes',
    configResolved(config: ResolvedConfig) {
      root = config.root
      directoryPath = normalizePath(path.resolve(root, requireDirectory(options)))
      resolvedVirtualModuleId =
        config.command === 'serve'
          ? `\0${virtualModuleId}`
          : path.join(root, `.irisout-${encodeURIComponent(virtualModuleId)}.js`)
      result = null
      pageIds = new Map()
    },
    buildStart() {
      compile()
      watch((filePath) => this.addWatchFile(filePath))
    },
    configureServer(server) {
      const current = ensureCompiled()
      server.watcher.add([directoryPath, ...current.dependencies])
    },
    resolveId(id: string) {
      if (id === virtualModuleId) return resolvedVirtualModuleId
      if (id.startsWith(`${virtualModuleId}${PAGE_MODULE_MARKER}`)) {
        return pageResolvedId(id)
      }
      return null
    },
    load(id: string) {
      const current = ensureCompiled()
      if (id === resolvedVirtualModuleId) {
        return {
          code: pageModuleSource(current.clientTable, current.pages, containerSelector),
          map: null,
        }
      }
      const filePath = pageIds.get(id)
      if (!filePath) return null
      const page = current.pages.find((candidate) => candidate.filePath === filePath)
      if (!page) return null
      return { code: page.result.code, map: page.result.map }
    },
    async handleHotUpdate(context: HmrContext) {
      const changedPath = normalizePath(context.file)
      const current = ensureCompiled()
      if (!isWithin(directoryPath, changedPath) && !current.dependencies.has(changedPath)) return
      const previous = result
      try {
        compile()
        context.server.watcher.add([directoryPath, ...ensureCompiled().dependencies])
      } catch (error) {
        result = previous
        throw error
      }
      context.server.ws.send({ type: 'full-reload', path: '*' })
      return []
    },
  }
}

export const irisoutFileRoutes = irisoutRoutes
