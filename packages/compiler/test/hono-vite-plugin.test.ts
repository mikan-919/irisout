import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { build } from 'vite-plus'
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

  it('irisout以外のHono appを拒否する', () => {
    expect(() => irisoutHono(new Hono())).toThrow(
      'compile: irisoutHono found no createFileRouter routes (scope limit)',
    )
  })

  it('ページごとの動的importをViteのチャンクへ分割する', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-hono-vite-build-'))
    try {
      writePage(root, '', 'export function Page() { render(<p>home</p>); }')
      writePage(root, 'about', 'export function Page() { render(<p>about</p>); }')
      writeFileSync(
        path.join(root, 'index.html'),
        '<!doctype html><div id="app"></div><script type="module" src="/main.js"></script>',
      )
      writeFileSync(path.join(root, 'main.js'), "console.log('application entry')\n")
      const app = new Hono().route('/', createFileRouter(root))

      await build({
        configFile: false,
        root,
        logLevel: 'silent',
        plugins: [irisoutHono(app)],
        resolve: {
          alias: {
            'irisout/routes': path.resolve(import.meta.dirname, '../../routes/src/index.ts'),
            'irisout/runtime': path.resolve(import.meta.dirname, '../../runtime/src/index.ts'),
          },
        },
        build: { outDir: 'dist' },
      })

      const scripts = readdirSync(path.join(root, 'dist', 'assets')).filter((file) =>
        file.endsWith('.js'),
      )
      expect(scripts.length).toBeGreaterThanOrEqual(3)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
