import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { build, createServer } from 'vite-plus'
import { describe, expect, it } from 'vite-plus/test'
import { createFileRouter } from '../../hono/src/index.ts'
import { irisoutHono } from '../../vite-plugin/src/hono.ts'

function writePage(root: string, relative: string, source: string): string {
  const filePath = path.join(root, relative, 'page.tsx')
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, source)
  return filePath
}

describe('irisoutHono Vite連携', () => {
  it('開発時のHTMLと起動スクリプトの変換で指定した仮想入口を解決する', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-hono-vite-dev-'))
    const virtualModuleId = 'virtual:custom-routes'
    writePage(
      root,
      '[id]',
      'export function Page() { return <html><head><meta charset="utf-8" /></head><body><p>page</p></body></html> }',
    )
    const app = new Hono().route('/', createFileRouter(root))
    const server = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      plugins: [irisoutHono(app, { virtualModuleId })],
      resolve: {
        alias: {
          'irisout/routes': path.resolve(import.meta.dirname, '../../routes/src/index.ts'),
          'irisout/runtime': path.resolve(import.meta.dirname, '../../runtime/src/index.ts'),
        },
      },
      server: { middlewareMode: true, ws: false },
    })
    try {
      const document = await app.request('/item')
      expect(document.status).toBe(200)
      const html = await server.transformIndexHtml('/item', await document.text(), '/item')
      expect(html).toContain('src="/irisout-client.js"')

      // HTMLの事前変換はHTTPミドルウェアを経由しない。
      const transformed = await server.transformRequest('/irisout-client.js')
      expect(transformed?.code).toContain(virtualModuleId)
      const entry = await server.transformRequest('/irisout-client.js?v=test')
      expect(entry?.code).toContain('routeNavigator.start()')
    } finally {
      await server.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('ブラウザー入口のないSSRページは編集時に文書を再読み込みする', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-hono-ssr-hmr-'))
    try {
      const page = writePage(root, '', 'export function Page() { render(<p>before</p>); }')
      const app = new Hono().route('/', createFileRouter(root))
      const plugin = irisoutHono(app)
      const configResolved = plugin.configResolved as unknown as (config: {
        root: string
        command: 'serve'
      }) => void
      configResolved({ root, command: 'serve' })
      const buildStart = plugin.buildStart as unknown as (this: {
        addWatchFile(filePath: string): void
      }) => void
      buildStart.call({ addWatchFile: () => {} })
      expect(await (await app.request('/')).text()).toContain('before')

      writeFileSync(page, 'export function Page() { render(<p>after</p>); }')
      const messages: unknown[] = []
      const server = {
        watcher: { add: () => {} },
        moduleGraph: { getModuleById: () => undefined },
        ws: { send: (message: unknown) => messages.push(message) },
      }
      const handleHotUpdate = plugin.handleHotUpdate as unknown as (context: {
        file: string
        server: typeof server
      }) => Promise<unknown>
      expect(await handleHotUpdate({ file: page, server })).toEqual([])
      expect(messages).toEqual([{ type: 'full-reload', path: '*' }])
      expect(await (await app.request('/')).text()).toContain('after')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('mount後のHono経路をSSOTとして動的page入口を生成する', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-hono-vite-'))
    try {
      writePage(root, '', 'export function Page() { render(<p>home</p>); }')
      const userPage = writePage(
        root,
        'users/[id]',
        'export function Page({ name }) { render(<p>{name}</p>); }',
      )
      const app = new Hono()
      app.get('/health', (context) => context.text('ok'))
      app.route('/apps', createFileRouter(root))

      const plugin = irisoutHono(app)
      const configResolved = plugin.configResolved as unknown as (config: {
        root: string
        command: 'build' | 'serve'
      }) => void
      configResolved({ root, command: 'build' })
      const watched: string[] = []
      const buildStart = plugin.buildStart as unknown as (this: {
        addWatchFile(filePath: string): void
        emitFile(file: unknown): string
      }) => void
      const emitted: unknown[] = []
      buildStart.call({
        addWatchFile: (filePath) => watched.push(filePath),
        emitFile: (file) => {
          emitted.push(file)
          return 'irisout-client'
        },
      })
      expect(watched).toContain(userPage)
      expect(emitted).toEqual([
        { type: 'chunk', id: 'virtual:irisout-routes', fileName: 'irisout-client.js' },
      ])

      const resolveId = plugin.resolveId as unknown as (id: string) => string | null
      const mainId = resolveId('virtual:irisout-routes')
      if (!mainId) throw new Error('Hono routes virtual module did not resolve')
      const load = plugin.load as unknown as (id: string) => { code: string } | null
      const source = load(mainId)?.code ?? ''
      expect(source).toContain('"path":"/apps"')
      expect(source).toContain('"path":"/apps/users/:id"')
      expect(source).not.toContain('/health')
      expect(source).toContain('() => import(')
      expect(source).not.toContain('import * as __irisout_page_')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('onErrorを持つ子ルーターを重ねても元のページ経路を検出する', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-hono-on-error-'))
    try {
      writePage(root, '', 'export function Page() { render(<p>home</p>); }')
      const pages = createFileRouter(root)
      pages.onError((error, context) => context.text(error.message, 500))
      const group = new Hono().route('/pages', pages)
      group.onError((error, context) => context.text(error.message, 500))
      const app = new Hono().route('/apps', group)
      const plugin = irisoutHono(app)
      const resolveId = plugin.resolveId as unknown as (id: string) => string | null
      const load = plugin.load as unknown as (id: string) => { code: string } | null
      expect(load(resolveId('virtual:irisout-routes')!)?.code).toContain('"path":"/apps/pages"')
      const response = await app.request('/apps/pages')
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('home')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('irisout以外のHono appを拒否する', () => {
    expect(() => irisoutHono(new Hono())).toThrow(
      'compile: irisoutHono found no createFileRouter routes (scope limit)',
    )
  })

  it('ページごとの動的importをViteのチャンクへ分割する', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-hono-vite-build-'))
    try {
      writePage(root, '', 'export function Page() { render(<p>home</p>); }')
      writePage(
        root,
        'about',
        `import { onMount, signal } from 'irisout'
import { loadBrowserLibrary } from 'browser-loader'
export function Page() {
  const message = signal('loading')
  onMount(() => {
    void loadBrowserLibrary().then((library) => message(library.label))
  })
  return <html><head><title>About</title></head><body><p>{message()}</p></body></html>
}`,
      )
      const loader = path.join(root, 'browser-loader.mjs')
      writeFileSync(
        loader,
        "export const loadBrowserLibrary = () => import('./browser-library.mjs')",
      )
      writeFileSync(
        path.join(root, 'browser-library.mjs'),
        "export const label = window.location.href + ' browser-library-marker'",
      )
      writeFileSync(
        path.join(root, 'index.html'),
        '<!doctype html><div id="app"></div><script type="module" src="/main.js"></script>',
      )
      writeFileSync(path.join(root, 'main.js'), "console.log('application entry')\n")
      const app = new Hono().route('/', createFileRouter(root))
      const response = await app.request('/about')
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('loading')

      await build({
        configFile: false,
        root,
        logLevel: 'silent',
        plugins: [irisoutHono(app)],
        resolve: {
          alias: {
            'irisout/routes': path.resolve(import.meta.dirname, '../../routes/src/index.ts'),
            'irisout/runtime': path.resolve(import.meta.dirname, '../../runtime/src/index.ts'),
            'browser-loader': loader,
          },
        },
        build: { outDir: 'dist' },
      })

      const scripts = readdirSync(path.join(root, 'dist', 'assets')).filter((file) =>
        file.endsWith('.js'),
      )
      expect(scripts.length).toBeGreaterThanOrEqual(3)
      expect(scripts).toContainEqual(expect.stringMatching(/^browser-library-.*\.js$/))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
