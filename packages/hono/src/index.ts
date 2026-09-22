// `page.tsx`または`page.jsx`を要求単位のSSRへ接続するHono入口。経路照合はroutesの共通表を
// 使い、loader・要求・SSR stateはhandler呼び出しごとの値として閉じ込める。

import { Hono } from 'hono'
import type { Context } from 'hono'
import { compileProject } from '../../compiler/src/compiler.ts'
import {
  createRouteTable,
  joinRoutePath,
  matchRoute,
  toClientRouteTable,
} from '../../routes/src/index.ts'
import { scanFileRoutes } from '../../routes/src/node.ts'
import { derived, signal } from '../../runtime/src/index.ts'
import { serializeSsrState } from '../../vite-plugin/src/ssr.ts'

export interface IrisoutRouteSegment {
  readonly kind: 'static' | 'param'
  readonly value: string
}

export interface IrisoutRouteDefinition {
  readonly id: string
  readonly path: string
  readonly segments: readonly IrisoutRouteSegment[]
  readonly params: readonly string[]
  readonly filePath?: string
}

export interface IrisoutClientRouteDefinition extends IrisoutRouteDefinition {
  readonly filePath?: never
}

export interface IrisoutFileRouteDefinition extends IrisoutRouteDefinition {
  readonly filePath: string
}

export interface IrisoutRouteTable<Route extends IrisoutRouteDefinition = IrisoutRouteDefinition> {
  readonly basePath: string
  readonly routes: readonly Route[]
}

export interface IrisoutRouteMatch<Route extends IrisoutRouteDefinition = IrisoutRouteDefinition> {
  readonly route: Route
  readonly pathname: string
  readonly search: string
  readonly searchParams: URLSearchParams
  readonly params: Readonly<Record<string, string>>
}

export interface IrisoutFileRouteManifest extends IrisoutRouteTable<IrisoutFileRouteDefinition> {
  readonly rootDirectory: string
  readonly dependencies: readonly string[]
}

type FileRouteDefinition = IrisoutFileRouteDefinition
type FileRouteManifest = IrisoutFileRouteManifest
type ClientRouteDefinition = IrisoutClientRouteDefinition
type RouteMatch<Route extends IrisoutRouteDefinition = IrisoutRouteDefinition> =
  IrisoutRouteMatch<Route>
type RouteTable<Route extends IrisoutRouteDefinition = IrisoutRouteDefinition> =
  IrisoutRouteTable<Route>

export type IrisoutLoaderValue =
  | null
  | boolean
  | number
  | string
  | IrisoutLoaderValue[]
  | { [key: string]: IrisoutLoaderValue }

export interface IrisoutLoaderContext {
  /** 共通照合で一度だけ復号された経路引数。 */
  readonly params: Readonly<Record<string, string>>
  /** fragmentを含まない検索引数。loaderごとに新しいインスタンスを渡す。 */
  readonly search: URLSearchParams
  /** Honoが受け取った要求。ブラウザー応答へは搬送しない。 */
  readonly request: Request
}

export type IrisoutLoaderResult = IrisoutLoaderValue | IrisoutNotFoundResult | IrisoutRedirectResult

export type IrisoutRouteLoader = (
  context: IrisoutLoaderContext,
) => IrisoutLoaderResult | Promise<IrisoutLoaderResult>

export type IrisoutLoaderResolver = (route: FileRouteDefinition) => IrisoutRouteLoader | undefined

export interface IrisoutNotFoundResult {
  readonly type: 'not-found'
}

export interface IrisoutRedirectResult {
  readonly type: 'redirect'
  readonly location: string
  readonly status: 301 | 302 | 303 | 307 | 308
}

const loaderControl = Symbol('irisout loader control')

/** loaderから正常pageではなく404を返す。 */
export function notFound(): IrisoutNotFoundResult {
  return { type: 'not-found', [loaderControl]: true } as IrisoutNotFoundResult
}

/** loaderからHTTP redirectを返す。 */
export function redirect(
  location: string,
  status: IrisoutRedirectResult['status'] = 302,
): IrisoutRedirectResult {
  return { type: 'redirect', location, status, [loaderControl]: true } as IrisoutRedirectResult
}

function isLoaderControl(value: unknown): value is IrisoutNotFoundResult | IrisoutRedirectResult {
  if (!value || typeof value !== 'object') return false
  return (value as Record<PropertyKey, unknown>)[loaderControl] === true
}

function isRedirectResult(
  value: IrisoutNotFoundResult | IrisoutRedirectResult,
): value is IrisoutRedirectResult {
  return value.type === 'redirect'
}

export interface IrisoutRenderedPage<Route extends FileRouteDefinition = FileRouteDefinition> {
  readonly route: Route
  readonly match: RouteMatch<Route>
  readonly html: string
  readonly state: unknown
}

export interface IrisoutDocumentInput extends Omit<IrisoutRenderedPage, 'state'> {
  readonly state: unknown
  readonly request: Request
  /** 利用側のHTMLへそのまま置ける、page id付きの初期state script。 */
  readonly stateScript: string
}

export type IrisoutDocumentRenderer = (
  page: IrisoutDocumentInput,
) => string | Response | Promise<string | Response>

export interface IrisoutFileRouterOptions {
  /** Honoへmountする経路と対応する接頭辞。未指定時は`/`。 */
  readonly prefix?: string
  /** prefixの別名。両方を指定した場合はbasePathを使う。 */
  readonly basePath?: string
  /** route idまたはroute pathをキーにしたpage別loader。 */
  readonly loaders?:
    | Readonly<Record<string, IrisoutRouteLoader | undefined>>
    | IrisoutLoaderResolver
  /** loadersの別名。関数形式はrouteを受け取るresolver。 */
  readonly loader?: Readonly<Record<string, IrisoutRouteLoader | undefined>> | IrisoutLoaderResolver
  /** HTML文書の外枠を利用側で組み立てる関数。 */
  readonly document?: IrisoutDocumentRenderer
  /** documentの別名。 */
  readonly renderDocument?: IrisoutDocumentRenderer
  /** pageを標準irisout記法へ下げるファイル単位の前処理。 */
  readonly transformSource?: (source: string, filePath: string) => string
}

export interface IrisoutFileRouter extends Hono {
  readonly manifest: FileRouteManifest
  readonly routeTable: RouteTable<FileRouteDefinition>
  readonly clientRoutes: RouteTable<ClientRouteDefinition>
  readonly dependencies: readonly string[]
}

interface CompiledPage {
  readonly route: FileRouteDefinition
  readonly render: (input?: unknown) => { html: string; state: unknown }
}

function compileRender(ssrCode: string): CompiledPage['render'] {
  const source = ssrCode
    .replace(/^import \{ signal, derived \} from 'irisout\/runtime';\s*/m, '')
    .replace(/^export function render\(/m, 'function render(')
  const factory = new Function('signal', 'derived', `${source}\nreturn render;`) as (
    signalFn: typeof signal,
    derivedFn: typeof derived,
  ) => CompiledPage['render']
  return factory(signal, derived)
}

function resolveLoader(
  source:
    | Readonly<Record<string, IrisoutRouteLoader | undefined>>
    | IrisoutLoaderResolver
    | undefined,
  route: FileRouteDefinition,
): IrisoutRouteLoader | undefined {
  if (!source) return undefined
  if (typeof source === 'function') return source(route)
  return source[route.id] ?? source[route.path] ?? source[route.filePath]
}

function jsonResponse(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  })
}

function htmlResponse(value: string): Response {
  return new Response(value, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=UTF-8' },
  })
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** SSR stateを初回hydrate用のscript要素へ安全に変換する。 */
export function createRouteStateScript(routeId: string, state: unknown): string {
  return `<script type="application/json" data-irisout-route-state data-irisout-route-id="${escapeHtmlAttribute(routeId)}">${serializeSsrState(state)}</script>`
}

function redirectResponse(location: string, status: number): Response {
  return new Response(null, { status, headers: { location } })
}

function errorResponse(navigation: boolean): Response {
  return navigation
    ? jsonResponse({ type: 'error', status: 500 }, 500)
    : new Response('Internal Server Error', {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=UTF-8' },
      })
}

function isNavigationRequest(request: Request): boolean {
  return (
    request.headers.get('X-Irisout-Navigation') === '1' ||
    request.headers
      .get('Accept')
      ?.split(',')
      .some((value) => value.trim() === 'application/json') === true
  )
}

function setRouterMetadata(
  router: Hono,
  manifest: FileRouteManifest,
  routeTable: RouteTable<FileRouteDefinition>,
  clientRoutes: RouteTable<ClientRouteDefinition>,
): IrisoutFileRouter {
  const dependencies = [...new Set(manifest.dependencies)]
  Object.defineProperties(router, {
    manifest: { value: manifest, enumerable: true },
    routeTable: { value: routeTable, enumerable: true },
    clientRoutes: { value: clientRoutes, enumerable: true },
    dependencies: { value: dependencies, enumerable: true },
  })
  return router as IrisoutFileRouter
}

function routeRequestUrl(
  request: Request,
  route: FileRouteDefinition,
  routeTable: RouteTable<FileRouteDefinition>,
): string {
  const requestUrl = new URL(request.url)
  const rawSegments =
    requestUrl.pathname === '/' ? [] : requestUrl.pathname.replace(/^\/+|\/+$/g, '').split('/')
  const relativeSegments = route.segments.length ? rawSegments.slice(-route.segments.length) : []
  const relativePath = relativeSegments.length === 0 ? '/' : `/${relativeSegments.join('/')}`
  const pathname = joinRoutePath(routeTable.basePath, relativePath)
  return new URL(`${pathname}${requestUrl.search}`, request.url).href
}

/** 指定ディレクトリの`page.tsx`または`page.jsx`をHonoサブルーターへ接続する。 */
export function createFileRouter(
  directory: string,
  options: IrisoutFileRouterOptions = {},
): IrisoutFileRouter {
  const manifest = scanFileRoutes(directory)
  const routeTable = createRouteTable(manifest.routes, {
    basePath: options.basePath ?? options.prefix,
  })
  const clientRoutes = toClientRouteTable(routeTable)
  const pages = new Map<string, CompiledPage>()
  for (const route of routeTable.routes) {
    const result = compileProject(route.filePath, {
      target: 'ssr',
      transformSource: options.transformSource,
    })
    if (!result.ssrCode) throw new Error(`compile: missing SSR module for "${route.filePath}"`)
    pages.set(route.id, { route, render: compileRender(result.ssrCode) })
  }

  const loaderSource = options.loaders ?? options.loader
  const documentRenderer = options.document ?? options.renderDocument
  const router = new Hono()
  const handleRequest = async (
    context: Context,
    expectedRoute?: FileRouteDefinition,
  ): Promise<Response> => {
    const request = context.req.raw
    const navigation = isNavigationRequest(request)
    const match = matchRoute(
      routeTable,
      expectedRoute ? routeRequestUrl(request, expectedRoute, routeTable) : request.url,
    )
    if (!match) {
      return navigation ? jsonResponse({ type: 'not-found', status: 404 }, 404) : context.notFound()
    }

    try {
      const page = pages.get(match.route.id)
      if (!page) throw new Error('missing compiled page')
      const loader = resolveLoader(loaderSource, match.route)
      let input: unknown
      if (loader) {
        input = await loader({
          params: { ...match.params },
          search: new URLSearchParams(match.search),
          request,
        })
        if (isLoaderControl(input)) {
          if (isRedirectResult(input)) {
            return navigation
              ? jsonResponse(
                  { type: 'redirect', status: input.status, location: input.location },
                  input.status,
                )
              : redirectResponse(input.location, input.status)
          }
          return navigation
            ? jsonResponse({ type: 'not-found', status: 404 }, 404)
            : context.notFound()
        }
      }

      const rendered = loader ? page.render(input) : page.render()
      // 既存SSRと同じJSON境界をstateにも適用し、要求・loaderの参照を返さない。
      serializeSsrState(rendered.state)
      if (navigation) {
        return jsonResponse(
          {
            type: 'page',
            routeId: match.route.id,
            html: rendered.html,
            state: rendered.state,
          },
          200,
        )
      }

      const pageInput: IrisoutRenderedPage = {
        route: match.route,
        match,
        html: rendered.html,
        state: rendered.state,
      }
      if (documentRenderer) {
        const document = await documentRenderer({
          ...pageInput,
          request,
          stateScript: createRouteStateScript(match.route.id, rendered.state),
        })
        if (document instanceof Response) return document
        if (typeof document !== 'string') throw new Error('document renderer must return HTML')
        return htmlResponse(document)
      }
      return htmlResponse(rendered.html)
    } catch {
      return errorResponse(navigation)
    }
  }
  for (const route of routeTable.routes) {
    router.all(joinRoutePath(routeTable.basePath, route.path), (context) =>
      handleRequest(context, route),
    )
  }
  // 未一致URLも遷移JSONの契約へ入れる。ページ経路以外のAPIは利用側の
  // Honoへ登録し、このサブルーターへmountする順序で分離する。
  router.all('*', (context) => handleRequest(context))

  return setRouterMetadata(router, manifest, routeTable, clientRoutes)
}

export const createIrisoutRouter = createFileRouter
export const irisoutRouter = createFileRouter
export const irisout = createFileRouter

export default createFileRouter
