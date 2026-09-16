import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { irisoutRoutes } from '../../vite-plugin/src/index.ts'

function writePage(root: string, relative: string, text: string): string {
  const filePath = path.join(root, relative, 'page.jsx')
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, text)
  return filePath
}

describe('irisoutRoutes Vite連携', () => {
  it('page群からclient表とhydrate moduleを生成し、server依存を出力しない', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-routes-plugin-'))
    try {
      writePage(
        root,
        '',
        "import { render } from 'irisout'; export function Page() { render(<p>home</p>); }",
      )
      writePage(
        root,
        'users/[id]',
        "import { render } from 'irisout'; export function Page({ name }) { render(<p>{name}</p>); }",
      )
      const plugin = irisoutRoutes({ routes: root, prefix: '/apps', container: '#target' })
      const configResolved = plugin.configResolved as unknown as (config: {
        root: string
        command: 'build' | 'serve'
      }) => void
      configResolved({ root, command: 'build' })
      const watched: string[] = []
      const buildStart = plugin.buildStart as unknown as (this: {
        addWatchFile(filePath: string): void
      }) => void
      buildStart.call({ addWatchFile: (filePath) => watched.push(filePath) })
      expect(watched).toContain(path.join(root, 'page.jsx'))
      expect(watched).toContain(path.join(root, 'users', '[id]', 'page.jsx'))

      const resolveId = plugin.resolveId as unknown as (id: string) => string | null
      const mainId = resolveId('virtual:irisout-routes')
      expect(mainId).toBe(path.join(root, '.irisout-virtual%3Airisout-routes.js'))
      if (!mainId) throw new Error('routes virtual module did not resolve')
      const load = plugin.load as unknown as (id: string) => { code: string; map: unknown } | null
      const main = load(mainId)
      expect(main?.code).toContain('basePath":"/apps"')
      expect(main?.code).toContain('data-irisout-route-state')
      expect(main?.code).not.toContain('node:fs')
      expect(main?.code).not.toContain("from 'hono'")

      const pageRawId =
        'virtual:irisout-routes:page:' + encodeURIComponent(path.join(root, 'page.jsx'))
      const pageId = resolveId(pageRawId)
      expect(pageId).not.toBeNull()
      const page = load(pageId!)
      if (!page) throw new Error('routes page module did not load')
      expect(page.code).toContain('hydrateComponent')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('pageの追加・削除をHMR時の次の表へ反映する', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-routes-plugin-hmr-'))
    try {
      const oldPage = writePage(
        root,
        'old',
        "import { render } from 'irisout'; export function Page() { render(<p>old</p>); }",
      )
      const plugin = irisoutRoutes({ directory: root })
      const configResolved = plugin.configResolved as unknown as (config: {
        root: string
        command: 'build' | 'serve'
      }) => void
      configResolved({ root, command: 'build' })
      const buildStart = plugin.buildStart as unknown as (this: {
        addWatchFile(filePath: string): void
      }) => void
      buildStart.call({ addWatchFile: () => {} })
      const resolveId = plugin.resolveId as unknown as (id: string) => string | null
      const mainId = resolveId('virtual:irisout-routes')
      if (!mainId) throw new Error('routes virtual module did not resolve')
      const load = plugin.load as unknown as (id: string) => { code: string } | null
      expect(load(mainId)?.code).toContain('"/old"')

      const sent: unknown[] = []
      const server = {
        watcher: { add: (_files: string[]) => {} },
        ws: { send: (payload: unknown) => sent.push(payload) },
      }
      rmSync(oldPage)
      const newPage = writePage(
        root,
        'new',
        "import { render } from 'irisout'; export function Page() { render(<p>new</p>); }",
      )
      const handleHotUpdate = plugin.handleHotUpdate as unknown as (context: {
        file: string
        server: typeof server
      }) => Promise<unknown>
      expect(await handleHotUpdate({ file: newPage, server })).toEqual([])
      expect(load(mainId)?.code).toContain('"/new"')
      expect(load(mainId)?.code).not.toContain('"/old"')
      expect(sent).toEqual([{ type: 'full-reload', path: '*' }])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
