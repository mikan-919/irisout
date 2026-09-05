import { describe, expect, it } from 'vite-plus/test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { compile, compileProject } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

const FIXTURE = path.resolve('apps/examples/multi-file/App.jsx')

function fixtureCards(container: Element): Element[] {
  return [...container.querySelectorAll('.note-card')]
}

function button(container: Element, className: string): HTMLElement {
  const found = container.querySelector(`.${className}`)
  if (!(found instanceof container.ownerDocument.defaultView!.HTMLElement)) {
    throw new Error(`button not found: .${className}`)
  }
  return found
}

function writeProject(files: Record<string, string>, entry = 'main.jsx'): string {
  const root = mkdtempSync(path.join(tmpdir(), 'irisout-module-test-'))
  for (const [relative, source] of Object.entries(files)) {
    const filePath = path.join(root, relative)
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, source)
  }
  return path.join(root, entry)
}

describe('compileProject: static multi-file module composition', () => {
  it('compiles a split fixture into static HTML and runtime-free component code', async () => {
    const { code, initialHtml } = compileProject(FIXTURE)

    expect(initialHtml).toContain('<main class="multi-file-notes">')
    expect(initialHtml).toContain('irisout / ノート')
    expect(initialHtml).not.toContain('note-card')
    expect(code).not.toContain('SplitCard')
    expect(code).not.toContain('signal(')
    expect(code).not.toContain('derived(')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (element: Element) => void)(container)

    expect(fixtureCards(container)).toHaveLength(2)
    expect(container.querySelector('.count')?.textContent).toBe('2 件')

    const first = fixtureCards(container)[0]!
    button(first, 'toggle').click()
    expect(first.className).toContain('expanded')
    expect(first.querySelector('.detail')?.textContent).toBe('irisout: AST の境界を確認する')
    expect([...first.querySelectorAll('.tags li')].map((item) => item.textContent)).toEqual([
      'code',
      'design',
    ])
    expect(fixtureCards(container)[1]?.className).not.toContain('expanded')

    button(container, 'next-filter').click()
    expect(container.querySelector('.next-filter')?.textContent?.trim()).toBe('filter: archived')
    expect(fixtureCards(container)).toHaveLength(1)
    expect(fixtureCards(container)[0]?.querySelector('h2')?.textContent).toBe(
      'irisout / 牛乳を買う',
    )

    button(container, 'remove').click()
    expect(fixtureCards(container)).toHaveLength(0)
    expect(container.querySelector('.count')?.textContent).toBe('0 件')
  })

  it('hydrates the split fixture over its build-time HTML and wires local state', async () => {
    const { code, initialHtml } = compileProject(FIXTURE)
    const dom = new JSDOM(`<!doctype html><div id="app">${initialHtml}</div>`)
    const container = dom.window.document.getElementById('app')
    if (!container) throw new Error('container not found')

    const mod = await loadGenerated(code)
    ;(mod.hydrateComponent as (element: Element) => void)(container)
    expect(fixtureCards(container)).toHaveLength(2)

    button(fixtureCards(container)[0]!, 'toggle').click()
    expect(fixtureCards(container)[0]?.querySelector('.tags')).not.toBeNull()
    expect(fixtureCards(container)[1]?.querySelector('.tags')).toBeNull()
  })

  it('keeps compile(source) as the single-file API', () => {
    expect(() =>
      compile(`import { helper } from './helper.js'; export function App() { render(<div />) }`),
    ).toThrow(/only top-level function declarations are supported.*scope limit/)
  })
})

describe('compileProject: module boundary errors', () => {
  it('rejects non-relative imports, dynamic imports, and cycles', () => {
    const external = writeProject({
      'main.jsx': `import { value } from 'external-package'; export function App() { render(<div>{value}</div>) }`,
    })
    expect(() => compileProject(external)).toThrow(/non-relative import.*scope limit/)

    const dynamic = writeProject({
      'main.jsx': `export function App() { render(<div />) } export function load() { return import('./dep.js') }`,
      'dep.js': `export const value = 1`,
    })
    expect(() => compileProject(dynamic)).toThrow(/dynamic import.*scope limit/)

    const cycle = writeProject({
      'main.jsx': `import { child } from './child.js'; export function App() { render(<div>{child}</div>) }`,
      'child.js': `import { value } from './main.jsx'; export const child = value`,
    })
    expect(() => compileProject(cycle)).toThrow(/circular module dependency.*scope limit/)
  })

  it('rejects side-effect imports, namespace imports, and re-exports', () => {
    const sideEffect = writeProject({
      'main.jsx': `import './side-effect.js'; export function App() { render(<div />) }`,
      'side-effect.js': `export const value = 1`,
    })
    expect(() => compileProject(sideEffect)).toThrow(/side-effect imports.*scope limit/)

    const namespace = writeProject({
      'main.jsx': `import * as helpers from './helpers.js'; export function App() { render(<div>{helpers.value}</div>) }`,
      'helpers.js': `export const value = 1`,
    })
    expect(() => compileProject(namespace)).toThrow(/namespace imports.*scope limit/)

    const reExport = writeProject({
      'main.jsx': `export { value } from './value.js'; export function App() { render(<div />) }`,
      'value.js': `export const value = 1`,
    })
    expect(() => compileProject(reExport)).toThrow(/re-exports.*scope limit/)
  })

  it('rejects unresolved paths and module-scope state or statements', () => {
    const unresolved = writeProject({
      'main.jsx': `import { missing } from './missing.js'; export function App() { render(<div>{missing}</div>) }`,
    })
    expect(() => compileProject(unresolved)).toThrow(/cannot resolve relative import.*scope limit/)

    const moduleState = writeProject({
      'main.jsx': `const count = signal(0); export function App() { render(<div />) }`,
    })
    expect(() => compileProject(moduleState)).toThrow(/module-scope signal.*scope limit/)

    const topLevelStatement = writeProject({
      'main.jsx': `console.log('not allowed'); export function App() { render(<div />) }`,
    })
    expect(() => compileProject(topLevelStatement)).toThrow(/top-level statement.*scope limit/)
  })
})

describe('multi-file Vite fixture', () => {
  it('runs through the normal examples build path', () => {
    const source = readFileSync(FIXTURE, 'utf8')
    expect(source).toContain("import SplitCard from './components/SplitCard.jsx'")

    const outRoot = mkdtempSync(path.join(tmpdir(), 'irisout-module-build-'))
    const outDir = path.join(outRoot, 'dist')
    const result = spawnSync(
      path.resolve('node_modules/.bin/vp'),
      ['-C', 'apps/examples', 'build'],
      {
        env: {
          ...process.env,
          IRISOUT_ENTRY: FIXTURE,
          IRISOUT_OUT_DIR: outDir,
        },
      },
    )
    expect(result.status).toBe(0)

    const html = readFileSync(path.join(outDir, 'index.html'), 'utf8')
    expect(html).toContain('irisout / ノート')
    const appJs = readFileSync(path.join(outDir, 'app.js'), 'utf8')
    expect(appJs).toContain('hydrate: missing marker(s)')
    expect(appJs).not.toContain('SplitCard')
    expect(appJs).not.toContain('signal(')
    expect(appJs).not.toContain('derived(')
  })
})
