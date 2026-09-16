// URL経路の定義・照合とブラウザー遷移を提供する。Nodeのファイル処理と
// Honoはこのモジュールへ持ち込まず、生成された経路表だけで動く範囲に限る。

export interface RouteSegment {
  readonly kind: 'static' | 'param'
  readonly value: string
}

export interface RouteDefinition {
  readonly id: string
  readonly path: string
  readonly segments: readonly RouteSegment[]
  readonly params: readonly string[]
  readonly filePath?: string
}

export interface ClientRouteDefinition {
  readonly id: string
  readonly path: string
  readonly segments: readonly RouteSegment[]
  readonly params: readonly string[]
}

export interface RouteTable<Route extends RouteDefinition = RouteDefinition> {
  readonly basePath: string
  readonly routes: readonly Route[]
}

export interface RouteMatch<Route extends RouteDefinition = RouteDefinition> {
  readonly route: Route
  readonly pathname: string
  readonly search: string
  readonly searchParams: URLSearchParams
  readonly params: Readonly<Record<string, string>>
}

export interface RouteTableOptions {
  readonly prefix?: string
  readonly basePath?: string
}

function fail(message: string): never {
  throw new Error(`compile: ${message} (scope limit)`)
}

/** 経路定義とURLの接頭辞を一つの表記へそろえる。 */
export function normalizeRoutePath(value: string): string {
  if (typeof value !== 'string' || value.length === 0) fail('route path must be a non-empty string')
  const path = value.startsWith('/') ? value : `/${value}`
  if (path.includes('?') || path.includes('#')) {
    fail(`route path must not contain a query or fragment: ${value}`)
  }
  if (path !== '/' && path.endsWith('/')) return path.replace(/\/+$/, '') || '/'
  return path
}

function normalizeBasePath(value: string | undefined): string {
  if (value == null || value === '') return '/'
  return normalizeRoutePath(value)
}

function parseSegments(path: string): { segments: RouteSegment[]; params: string[] } {
  const normalized = normalizeRoutePath(path)
  if (normalized === '/') return { segments: [], params: [] }

  const params: string[] = []
  const seenParams = new Set<string>()
  const segments = normalized
    .slice(1)
    .split('/')
    .map((segment) => {
      if (segment.length === 0) fail(`route path contains an empty segment: ${path}`)
      if (segment.startsWith(':')) {
        const name = segment.slice(1)
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
          fail(`route parameter "${name}" is not a valid identifier`)
        }
        if (seenParams.has(name)) fail(`route parameter "${name}" is duplicated in ${path}`)
        seenParams.add(name)
        params.push(name)
        return { kind: 'param' as const, value: name }
      }
      if (segment.includes('[') || segment.includes(']')) {
        fail(`route segment "${segment}" uses unsupported bracket syntax`)
      }
      return { kind: 'static' as const, value: segment }
    })
  return { segments, params }
}

/** ファイル経路またはテスト用の文字列から一つの経路定義を作る。 */
export function createRouteDefinition(
  path: string,
  id = normalizeRoutePath(path),
  filePath?: string,
): RouteDefinition {
  const normalized = normalizeRoutePath(path)
  const { segments, params } = parseSegments(normalized)
  return { id, path: normalized, segments, params, ...(filePath ? { filePath } : {}) }
}

function routeSignature(route: RouteDefinition): string {
  return route.segments
    .map((segment) => (segment.kind === 'param' ? ':' : `=${segment.value}`))
    .join('/')
}

function routeOrder(a: RouteDefinition, b: RouteDefinition): number {
  const length = Math.min(a.segments.length, b.segments.length)
  for (let index = 0; index < length; index += 1) {
    const left = a.segments[index]!
    const right = b.segments[index]!
    if (left.kind !== right.kind) return left.kind === 'static' ? -1 : 1
    if (left.kind === 'static' && left.value !== right.value) {
      return left.value < right.value ? -1 : 1
    }
  }
  if (a.segments.length !== b.segments.length) {
    return a.segments.length - b.segments.length
  }
  return a.path < b.path ? -1 : a.path > b.path ? 1 : a.id.localeCompare(b.id)
}

function validateRoutes<Route extends RouteDefinition>(routes: readonly Route[]): Route[] {
  const signatures = new Map<string, RouteDefinition>()
  const result = routes.map((route) => {
    const normalized = createRouteDefinition(route.path, route.id, route.filePath)
    const existing = signatures.get(routeSignature(normalized))
    if (existing) {
      const files = [existing.filePath, normalized.filePath].filter(Boolean)
      const suffix = files.length > 0 ? `: ${files.join(' and ')}` : ''
      fail(`route collision for "${normalized.path}"${suffix}`)
    }
    signatures.set(routeSignature(normalized), normalized)
    return normalized as Route
  })
  return result.sort(routeOrder)
}

/** 共通経路定義を静的優先の照合表へ変換する。 */
export function createRouteTable<Route extends RouteDefinition>(
  routes: readonly Route[],
  options: RouteTableOptions = {},
): RouteTable<Route> {
  return {
    basePath: normalizeBasePath(options.basePath ?? options.prefix),
    routes: validateRoutes(routes),
  }
}

/** サーバー情報を除いたブラウザー用経路表を作る。 */
export function toClientRouteTable(table: RouteTable): RouteTable<ClientRouteDefinition> {
  return {
    basePath: table.basePath,
    routes: table.routes.map(({ id, path, segments, params }) => ({
      id,
      path,
      segments: segments.map((segment) => ({ ...segment })),
      params: [...params],
    })),
  }
}

/** `basePath`とページ経路を結合する。 */
export function joinRoutePath(basePath: string | undefined, routePath: string): string {
  const base = normalizeBasePath(basePath)
  const route = normalizeRoutePath(routePath)
  if (base === '/') return route
  return route === '/' ? base : `${base}${route}`
}

function parseLocation(input: string | URL): { pathname: string; search: string } | null {
  try {
    if (input instanceof URL) return { pathname: input.pathname, search: input.search }
    const value = String(input)
    const url = new URL(value, 'http://irisout.invalid')
    return { pathname: url.pathname, search: url.search }
  } catch {
    return null
  }
}

function normalizePathname(value: string): string {
  if (!value.startsWith('/')) return `/${value}`
  if (value === '/') return value
  return value.replace(/\/+$/, '') || '/'
}

function stripBasePath(pathname: string, basePath: string): string | null {
  if (basePath === '/') return pathname
  if (pathname === basePath) return '/'
  const prefix = `${basePath}/`
  return pathname.startsWith(prefix) ? pathname.slice(basePath.length) || '/' : null
}

function matchSegments(
  route: RouteDefinition,
  pathname: string,
): Readonly<Record<string, string>> | null {
  const normalized = normalizePathname(pathname)
  const actual = normalized === '/' ? [] : normalized.slice(1).split('/')
  if (actual.length !== route.segments.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < route.segments.length; index += 1) {
    const expected = route.segments[index]!
    const value = actual[index]!
    if (expected.kind === 'static') {
      if (value !== expected.value) return null
      continue
    }
    let decoded: string
    try {
      decoded = decodeURIComponent(value)
    } catch {
      return null
    }
    // 経路区切りを復号後に作る値は、照合対象を増やすため一度も受理しない。
    if (decoded.includes('/')) return null
    params[expected.value] = decoded
  }
  return params
}

/** サーバーとブラウザーで共有する経路照合。引数の復号はここで一度だけ行う。 */
export function matchRoute<Route extends RouteDefinition>(
  table: RouteTable<Route>,
  input: string | URL,
): RouteMatch<Route> | null {
  const parsed = parseLocation(input)
  if (!parsed) return null
  const pathname = normalizePathname(parsed.pathname)
  const relativePath = stripBasePath(pathname, table.basePath)
  if (!relativePath) return null
  for (const route of table.routes) {
    const params = matchSegments(route, relativePath)
    if (!params) continue
    return {
      route,
      pathname,
      search: parsed.search,
      searchParams: new URLSearchParams(parsed.search),
      params,
    }
  }
  return null
}

export interface NavigationPageResponse {
  readonly type: 'page'
  readonly routeId: string
  readonly html: string
  readonly state: unknown
}

export interface NavigationNotFoundResponse {
  readonly type: 'not-found'
  readonly status: number
}

export interface NavigationRedirectResponse {
  readonly type: 'redirect'
  readonly status: number
  readonly location: string
}

export interface NavigationErrorResponse {
  readonly type: 'error'
  readonly status: number
}

export type NavigationResponse =
  | NavigationPageResponse
  | NavigationNotFoundResponse
  | NavigationRedirectResponse
  | NavigationErrorResponse

/** 遷移応答の外形だけを検査する。サーバー内部の値を例外文へ入れない。 */
export function parseNavigationResponse(value: unknown): NavigationResponse {
  if (!value || typeof value !== 'object')
    throw new TypeError('invalid irisout navigation response')
  const record = value as Record<string, unknown>
  const type = record.type
  if (type === 'page') {
    if (
      typeof record.routeId !== 'string' ||
      typeof record.html !== 'string' ||
      !('state' in record)
    ) {
      throw new TypeError('invalid irisout page response')
    }
    return {
      type,
      routeId: record.routeId,
      html: record.html,
      state: record.state,
    }
  }
  if (type === 'not-found' || type === 'error') {
    if (typeof record.status !== 'number') throw new TypeError('invalid irisout error response')
    return { type, status: record.status }
  }
  if (type === 'redirect') {
    if (typeof record.status !== 'number' || typeof record.location !== 'string') {
      throw new TypeError('invalid irisout redirect response')
    }
    return { type, status: record.status, location: record.location }
  }
  throw new TypeError('invalid irisout navigation response type')
}

export interface ClientPageHandle {
  readonly unmount?: () => void
}

export interface RouteNavigatorOptions<Route extends RouteDefinition = ClientRouteDefinition> {
  readonly table: RouteTable<Route>
  readonly container: Element | (() => Element | null)
  readonly fetchPage?: (
    url: URL,
    match: RouteMatch<Route>,
    signal: AbortSignal,
  ) => Promise<NavigationResponse>
  readonly renderPage: (
    response: NavigationPageResponse,
    match: RouteMatch<Route>,
    container: Element,
  ) => ClientPageHandle | void | Promise<ClientPageHandle | void>
  readonly hydrateInitial?: (
    match: RouteMatch<Route>,
    container: Element,
  ) => ClientPageHandle | void | Promise<ClientPageHandle | void>
  readonly fallback?: (url: URL) => void
  readonly window?: Window
  readonly document?: Document
}

export interface RouteNavigator {
  start(): Promise<void>
  stop(): void
  navigate(input: string | URL, options?: { readonly replace?: boolean }): Promise<boolean>
}

function resolveUrl(input: string | URL, base: string): URL | null {
  try {
    return input instanceof URL ? new URL(input.href) : new URL(input, base)
  } catch {
    return null
  }
}

function hasModifiedClick(event: MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
}

function linkFromEvent(event: MouseEvent): HTMLAnchorElement | null {
  const target = event.target
  const element =
    target && typeof target === 'object' && 'nodeType' in target && 'closest' in target
      ? (target as Element)
      : target && typeof target === 'object' && 'parentElement' in target
        ? (target as Node).parentElement
        : null
  const link = element?.closest('a[href]')
  return link && link.tagName.toLowerCase() === 'a' ? (link as HTMLAnchorElement) : null
}

function isManagedLink(
  event: MouseEvent,
  link: HTMLAnchorElement,
  currentUrl: URL,
  table: RouteTable,
): URL | null {
  if (event.defaultPrevented || hasModifiedClick(event)) return null
  if (link.hasAttribute('download')) return null
  const target = link.getAttribute('target')
  if (target && target.toLowerCase() !== '_self') return null
  const url = resolveUrl(link.href, currentUrl.href)
  if (!url || url.origin !== currentUrl.origin) return null
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const nextRoute = matchRoute(table, url)
  if (!nextRoute) return null
  if (
    currentUrl.pathname === url.pathname &&
    currentUrl.search === url.search &&
    currentUrl.hash !== url.hash
  ) {
    return null
  }
  return nextRoute ? url : null
}

/** 管理対象のリンクと履歴だけを捕捉する。失敗時は標準の文書遷移へ戻す。 */
export function createRouteNavigator<Route extends RouteDefinition = ClientRouteDefinition>(
  options: RouteNavigatorOptions<Route>,
): RouteNavigator {
  const win = options.window ?? globalThis.window
  const doc = options.document ?? win?.document ?? globalThis.document
  if (!win || !doc) throw new Error('irisout route navigation requires a browser document')
  const getContainer = (): Element | null =>
    typeof options.container === 'function' ? options.container() : options.container
  const fallback = options.fallback ?? ((url: URL) => win.location.assign(url.href))
  const fetchPage =
    options.fetchPage ??
    (async (
      url: URL,
      _match: RouteMatch<Route>,
      signal: AbortSignal,
    ): Promise<NavigationResponse> => {
      const response = await win.fetch(url.href, {
        headers: { Accept: 'application/json', 'X-Irisout-Navigation': '1' },
        redirect: 'manual',
        signal,
      })
      return parseNavigationResponse(await response.json())
    })

  let started = false
  let sequence = 0
  let controller: AbortController | null = null
  let active: ClientPageHandle | void
  let commit = Promise.resolve()

  const getMatch = (url: URL): RouteMatch<Route> | null => matchRoute(options.table, url)
  const stopActive = (): void => {
    const current = active
    active = undefined
    current?.unmount?.()
  }
  const loadFallback = (url: URL): void => {
    try {
      fallback(url)
    } catch {
      // jsdomなど、文書遷移を実装しないテスト環境でも元の例外を増やさない。
    }
  }

  const navigate = async (
    input: string | URL,
    navigationOptions: { readonly replace?: boolean } = {},
  ): Promise<boolean> => {
    const url = resolveUrl(input, win.location.href)
    if (!url) return false
    const match = getMatch(url)
    if (!match) {
      loadFallback(url)
      return false
    }

    const currentSequence = ++sequence
    controller?.abort()
    const nextController = new AbortController()
    controller = nextController
    let response: NavigationResponse
    try {
      response = await fetchPage(url, match, nextController.signal)
      if (currentSequence !== sequence) return false
      if (response.type !== 'page') {
        if (response.type === 'redirect') {
          const target = resolveUrl(response.location, url.href)
          if (target) loadFallback(target)
        } else {
          loadFallback(url)
        }
        return false
      }
      if (response.routeId !== match.route.id) throw new Error('irisout navigation route mismatch')
    } catch {
      if (currentSequence === sequence) loadFallback(url)
      return false
    }

    const apply = async (): Promise<boolean> => {
      if (currentSequence !== sequence) return false
      const container = getContainer()
      if (!container) throw new Error('irisout route navigation container was not found')
      stopActive()
      const next = await options.renderPage(response as NavigationPageResponse, match, container)
      if (currentSequence !== sequence) {
        next?.unmount?.()
        return false
      }
      active = next
      if (navigationOptions.replace) win.history.replaceState({}, '', url.href)
      else win.history.pushState({}, '', url.href)
      return true
    }

    const nextCommit = commit.then(apply, apply)
    commit = nextCommit.then(
      () => undefined,
      () => undefined,
    )
    try {
      return await nextCommit
    } catch {
      if (currentSequence === sequence) loadFallback(url)
      return false
    }
  }

  const onClick = (event: MouseEvent): void => {
    const link = linkFromEvent(event)
    if (!link) return
    const current = resolveUrl(win.location.href, win.location.href)
    if (!current) return
    const url = isManagedLink(event, link, current, options.table)
    if (!url) return
    event.preventDefault()
    void navigate(url)
  }

  const onPopState = (): void => {
    void navigate(win.location.href, { replace: true })
  }

  return {
    async start(): Promise<void> {
      if (started) return
      started = true
      doc.addEventListener('click', onClick)
      win.addEventListener('popstate', onPopState)
      const initialUrl = resolveUrl(win.location.href, win.location.href)
      try {
        const match = initialUrl ? getMatch(initialUrl) : null
        if (!match || !options.hydrateInitial) return
        const container = getContainer()
        if (!container) throw new Error('irisout route navigation container was not found')
        active = await options.hydrateInitial(match, container)
      } catch {
        doc.removeEventListener('click', onClick)
        win.removeEventListener('popstate', onPopState)
        started = false
        sequence += 1
        stopActive()
        if (initialUrl) loadFallback(initialUrl)
      }
    },
    stop(): void {
      if (!started) return
      started = false
      doc.removeEventListener('click', onClick)
      win.removeEventListener('popstate', onPopState)
      controller?.abort()
      controller = null
      sequence += 1
      stopActive()
    },
    navigate,
  }
}

export const resolveRoute = matchRoute
export const createClientRouteTable = toClientRouteTable
export const createFileRouteDefinition = createRouteDefinition
