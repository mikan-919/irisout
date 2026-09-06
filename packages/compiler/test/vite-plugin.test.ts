import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { irisout } from '../../vite-plugin/src/index.ts'

interface FakeServer {
  watcher: { add(files: string[]): void }
  ws: { send(payload: unknown): void }
}

function writeProject(files: Record<string, string>): { root: string; entry: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'irisout-vite-plugin-'))
  for (const [relative, source] of Object.entries(files)) {
    const filePath = path.join(root, relative)
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, source)
  }
  return { root, entry: path.join(root, 'main.jsx') }
}

describe('irisout Vite連携', () => {
  it('shares the compiler dependency list with Vite and rebuilds on dependency edits', async () => {
    const project = writeProject({
      'main.jsx': `import { label } from './helper.js'; export function App() { render(<span>{label}</span>); }`,
      'helper.js': `export const label = 'before'`,
    })
    const plugin = irisout({
      entry: project.entry,
      container: '#target',
      virtualModuleId: 'virtual:test-entry',
    })

    const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void
    configResolved({ root: project.root })

    const addedByBuild: string[] = []
    const buildStart = plugin.buildStart as unknown as (this: {
      addWatchFile(filePath: string): void
    }) => void
    buildStart.call({ addWatchFile: (filePath) => addedByBuild.push(filePath) })

    const helperPath = path.join(project.root, 'helper.js')
    expect(new Set(addedByBuild)).toEqual(new Set([project.entry, helperPath]))

    const addedByServer: string[] = []
    const sent: unknown[] = []
    const server: FakeServer = {
      watcher: { add: (files) => addedByServer.push(...files) },
      ws: { send: (payload) => sent.push(payload) },
    }
    const configureServer = plugin.configureServer as unknown as (server: FakeServer) => void
    configureServer(server)
    expect(new Set(addedByServer)).toEqual(new Set([project.entry, helperPath]))

    const resolveId = plugin.resolveId as unknown as (id: string) => string | null
    const resolvedId = resolveId('virtual:test-entry')
    expect(resolvedId).toBe('\0virtual:test-entry')

    const transformIndexHtml = plugin.transformIndexHtml as unknown as (html: string) => string
    expect(transformIndexHtml('<div id="target"><!--irisout-html--></div>')).toContain(
      '<span data-iris-id="m0">before</span>',
    )

    const load = plugin.load as unknown as (id: string) => string | null
    const initialModule = load(resolvedId!)
    expect(initialModule).toContain('document.querySelector("#target")')

    writeFileSync(helperPath, `export const label = 'after'`)
    const handleHotUpdate = plugin.handleHotUpdate as unknown as (context: {
      file: string
      server: FakeServer
    }) => Promise<unknown>
    expect(await handleHotUpdate({ file: helperPath, server })).toEqual([])
    expect(sent).toEqual([{ type: 'full-reload', path: '*' }])
    expect(transformIndexHtml('<!--irisout-html-->')).toContain(
      '<span data-iris-id="m0">after</span>',
    )

    writeFileSync(path.join(project.root, 'main.jsx'), `export function App() { render(<span>`)
    await expect(handleHotUpdate({ file: project.entry, server })).rejects.toThrow(/compile:/)
    expect(transformIndexHtml('<!--irisout-html-->')).toContain(
      '<span data-iris-id="m0">after</span>',
    )

    writeFileSync(
      path.join(project.root, 'main.jsx'),
      `export function App() { render(<span>fixed</span>); }`,
    )
    expect(await handleHotUpdate({ file: project.entry, server })).toEqual([])
    expect(sent).toEqual([
      { type: 'full-reload', path: '*' },
      { type: 'full-reload', path: '*' },
    ])
    expect(transformIndexHtml('<!--irisout-html-->')).toContain('>fixed</span>')
  })

  it('ignores files outside the compiler dependency graph', async () => {
    const project = writeProject({
      'main.jsx': `export function App() { render(<span>ready</span>); }`,
    })
    const plugin = irisout({ entry: project.entry })
    const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void
    configResolved({ root: project.root })
    const buildStart = plugin.buildStart as unknown as (this: {
      addWatchFile(filePath: string): void
    }) => void
    buildStart.call({ addWatchFile: () => {} })

    const sent: unknown[] = []
    const server: FakeServer = {
      watcher: { add: () => {} },
      ws: { send: (payload) => sent.push(payload) },
    }
    const handleHotUpdate = plugin.handleHotUpdate as unknown as (context: {
      file: string
      server: FakeServer
    }) => Promise<unknown>
    expect(
      await handleHotUpdate({ file: path.join(project.root, 'unrelated.js'), server }),
    ).toBeUndefined()
    expect(sent).toHaveLength(0)
  })
})
