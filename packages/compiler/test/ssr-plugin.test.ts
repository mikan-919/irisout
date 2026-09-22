import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { compileProject } from '../src/compiler.ts'
import { irisoutSsr } from '../../vite-plugin/src/index.ts'

describe('irisoutSsr Vite+連携', () => {
  it('SSR用virtual moduleへrender(input)を出力し、依存を監視する', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-ssr-plugin-'))
    const entry = path.join(root, 'Page.jsx')
    writeFileSync(entry, 'export function Page({ title }) { render(<h1>{title}</h1>); }')
    const plugin = irisoutSsr({ entry })
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

    expect(watched).toEqual([entry])
    const resolveId = plugin.resolveId as unknown as (id: string) => string | null
    const resolved = resolveId('virtual:irisout-ssr')
    expect(resolved).toBe(path.join(root, '.irisout-virtual%3Airisout-ssr.js'))
    if (!resolved) throw new Error('SSR virtual module did not resolve')
    const load = plugin.load as unknown as (id: string) => { code: string; map: null } | null
    expect(load(resolved)?.code).toContain('export function render(__rawInput__')
    expect(load(resolved)?.map).toBeNull()
  })

  it('開発時はSSR仮想moduleをNUL idへ解決する', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-ssr-plugin-dev-'))
    const entry = path.join(root, 'Page.jsx')
    mkdirSync(root, { recursive: true })
    writeFileSync(entry, 'export function Page() { render(<h1>ready</h1>); }')
    const plugin = irisoutSsr({ entry })
    const configResolved = plugin.configResolved as unknown as (config: {
      root: string
      command: 'build' | 'serve'
    }) => void
    configResolved({ root, command: 'serve' })
    const resolveId = plugin.resolveId as unknown as (id: string) => string | null
    expect(resolveId('virtual:irisout-ssr')).toBe('\0virtual:irisout-ssr')
  })

  it('相対moduleの補助値を要求ごとに作る', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-ssr-module-state-'))
    const entry = path.join(root, 'Page.jsx')
    writeFileSync(path.join(root, 'state.js'), 'export const state = { value: 0 }')
    writeFileSync(
      entry,
      "import { state } from './state.js'; export function Page() { render(<p>{state.value}</p>); }",
    )

    const result = compileProject(entry, { target: 'ssr' })
    expect(result.ssrCode).toContain('export function render')
    expect(result.ssrCode).toContain('const IrisM0_state =')
    expect(result.ssrCode?.indexOf('const IrisM0_state =')).toBeGreaterThan(
      result.ssrCode?.indexOf('export function render') ?? Number.POSITIVE_INFINITY,
    )
  })

  it('相対moduleの関数宣言をSSR入口で使う', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-ssr-relative-function-'))
    const entry = path.join(root, 'Page.jsx')
    writeFileSync(path.join(root, 'helper.js'), 'export function label() { return "ready" }')
    writeFileSync(
      entry,
      "import { label } from './helper.js'; export function Page() { render(<p>{label()}</p>); }",
    )

    const result = compileProject(entry, { target: 'ssr' })
    expect(result.ssrCode).toContain('function IrisM0_label')
    expect(result.ssrCode).toContain('${__esc__(IrisM0_label())}')
  })

  it('client専用処理だけが使う外部importをSSR生成物から除外する', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-ssr-client-import-'))
    const entry = path.join(root, 'Page.jsx')
    writeFileSync(
      entry,
      "import { browserOnly } from 'client-helper'; export function Page() { render(<button onClick={run}>run</button>); function run() { browserOnly(); } }",
    )
    const result = compileProject(entry, { target: 'ssr' })
    expect(result.ssrCode).not.toContain('client-helper')
    expect(result.code).toContain('client-helper')
  })

  it('SSR描画が使う外部importを拒否する', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-ssr-render-import-'))
    const entry = path.join(root, 'Page.jsx')
    writeFileSync(
      entry,
      "import { label } from 'server-helper'; export function Page() { render(<p>{label()}</p>); }",
    )
    expect(() => compileProject(entry, { target: 'ssr' })).toThrow(
      /external module "server-helper" is used during SSR render/,
    )
  })
})
