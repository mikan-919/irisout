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
    const { code, initialHtml, dependencies } = compileProject(FIXTURE)

    expect(initialHtml).toContain('<main class="multi-file-notes">')
    expect(initialHtml).toContain('irisout / ノート')
    expect(new Set(dependencies)).toEqual(
      new Set([
        path.resolve('apps/examples/multi-file/lib/constants.js'),
        path.resolve('apps/examples/multi-file/lib/format.js'),
        path.resolve('apps/examples/multi-file/components/SplitCard.jsx'),
        FIXTURE,
      ]),
    )
    expect(initialHtml).not.toContain('note-card')
    expect(code).not.toContain('SplitCard')
    expect(code).not.toContain('signal(')
    expect(code).not.toContain('derived(')
    expect(code).not.toContain('@typedef')

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

  it('keeps a shared context key compile-time-only across modules', () => {
    const entry = writeProject({
      'main.jsx': `import Child from './Child.jsx'; import { Theme } from './context.js'; export function App() { provideContext(Theme, 'dark'); render(<div><Child /></div>); }`,
      'Child.jsx': `import { Theme } from './context.js'; export default function Child() { render(<span>{useContext(Theme)}</span>); }`,
      'context.js': `export const Theme = createContext('light');`,
    })
    const { code, initialHtml } = compileProject(entry)
    expect(initialHtml).toContain('<span data-iris-id="m0">dark</span>')
    expect(code).not.toContain('createContext')
    expect(code).not.toContain('useContext')
    expect(code).not.toContain('provideContext')
  })

  it('keeps an async context key compile-time-only across modules', () => {
    const entry = writeProject({
      'main.jsx': `import Child from './Child.jsx'; import { Request } from './context.js'; export function App() { provideContext(Request, Promise.resolve('dark')); render(<div><Child /></div>); }`,
      'Child.jsx': `import { Request } from './context.js'; export default function Child() { render(<span>{String(useContext(Request))}</span>); }`,
      'context.js': `export const Request = createAsyncContext(Promise.resolve('light'));`,
    })
    const { code } = compileProject(entry)
    expect(code).not.toContain('createAsyncContext')
    expect(code).not.toContain('useContext')
    expect(code).not.toContain('provideContext')
  })

  it('shares a module signal across component instances and unsubscribes on unmount', async () => {
    const entry = writeProject({
      'main.jsx': `import { count } from './state.js'; export function App() { render(<div><button onClick={increment}>inc</button><span>{count()}</span></div>); function increment() { count(count() + 1); } }`,
      'state.js': `export const count = signal(0);`,
    })
    const { code, initialHtml } = compileProject(entry)
    expect(initialHtml).toContain('<span data-iris-id="m1">0</span>')
    expect(code).toContain('sharedSignal')
    expect(code).toContain('.subscribe(update_IrisM0_count)')
    expect(code).not.toContain('const IrisM0_count = signal(')

    const mod = await loadGenerated(code)
    const first = createContainer()
    const second = createContainer()
    const firstInstance = (mod.mountComponent as (container: Element) => { unmount(): void })(first)
    const secondInstance = (mod.mountComponent as (container: Element) => { unmount(): void })(
      second,
    )
    expect(first.textContent).toBe('inc0')
    expect(second.textContent).toBe('inc0')

    const EventCtor = first.ownerDocument.defaultView!.Event
    first.querySelector('button')!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    expect(first.textContent).toBe('inc1')
    expect(second.textContent).toBe('inc1')

    firstInstance.unmount()
    second.querySelector('button')!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    expect(first.textContent).toBe('')
    expect(second.textContent).toBe('inc2')
    secondInstance.unmount()
  })

  it('shares a module derived value and recomputes it through the shared signal', async () => {
    const entry = writeProject({
      'main.jsx': `import { count, quadrupled } from './state.js'; export function App() { render(<div><button onClick={increment}>inc</button><span>{quadrupled()}</span></div>); function increment() { count(count() + 1); } }`,
      'state.js': `export const quadrupled = derived(() => doubled() * 2); export const count = signal(0); export const doubled = derived(() => count() * 2);`,
    })
    const { code, initialHtml } = compileProject(entry)
    expect(initialHtml).toContain('<span data-iris-id="m1">0</span>')
    expect(code).toContain('const IrisM0_quadrupled = () => IrisM0_doubled() * 2;')
    expect(code).toContain('const IrisM0_doubled = () => IrisM0_count() * 2;')
    expect(code).not.toMatch(/\n\s+IrisM0_(doubled|quadrupled) =/)
    expect(code).toContain('sharedSignal as __sharedSignal__')

    const mod = await loadGenerated(code)
    const first = createContainer()
    const second = createContainer()
    const firstInstance = (mod.mountComponent as (container: Element) => { unmount(): void })(first)
    const secondInstance = (mod.mountComponent as (container: Element) => { unmount(): void })(
      second,
    )
    expect(first.textContent).toBe('inc0')
    expect(second.textContent).toBe('inc0')

    const EventCtor = first.ownerDocument.defaultView!.Event
    first.querySelector('button')!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    expect(first.textContent).toBe('inc4')
    expect(second.textContent).toBe('inc4')

    firstInstance.unmount()
    secondInstance.unmount()
  })

  it('shares a module collection across component instances and unsubscribes on unmount', async () => {
    const entry = writeProject({
      'main.jsx': `import { items } from './state.js'; export function App() { render(<div><button class="update" onClick={update}>update</button><button class="replace" onClick={replace}>replace</button><p>{items().map((item) => item.text).join(',')}</p><ul>{items().map((item) => <li key={item.id}>{item.text}</li>)}</ul></div>); function update() { items.update(1, (item) => ({ ...item, text: item.text + '!' })); } function replace() { items([...items(), { id: 3, text: 'c' }]); } }`,
      'state.js': `export const items = collection([{ id: 1, text: 'a' }, { id: 2, text: 'b' }], (item) => item.id);`,
    })
    const { code } = compileProject(entry)
    expect(code).toContain('sharedCollection as __sharedCollection__')
    expect(code).toContain('.subscribe(update_IrisM0_items)')
    expect(code).toContain('IrisM0_items.keyOf')
    expect(code).not.toContain('__createCollectionState__')

    const mod = await loadGenerated(code)
    const first = createContainer()
    const second = createContainer()
    const firstInstance = (mod.mountComponent as (container: Element) => { unmount(): void })(first)
    const secondInstance = (mod.mountComponent as (container: Element) => { unmount(): void })(
      second,
    )
    expect(first.textContent).toBe('updatereplacea,bab')
    expect(second.textContent).toBe('updatereplacea,bab')

    const EventCtor = first.ownerDocument.defaultView!.Event
    first.querySelector('.update')!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    expect(first.textContent).toBe('updatereplacea!,ba!b')
    expect(second.textContent).toBe('updatereplacea!,ba!b')

    firstInstance.unmount()
    second.querySelector('.replace')!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    expect(first.textContent).toBe('')
    expect(second.textContent).toBe('updatereplacea!,b,ca!bc')
    secondInstance.unmount()
  })

  it('omits an unused module derived chain and its shared dependencies', () => {
    const entry = writeProject({
      'main.jsx': `import { unused } from './state.js'; export function App() { render(<span>ready</span>); }`,
      'state.js': `export const count = signal(0); export const unused = derived(() => count() + 1);`,
    })
    const { code, initialHtml } = compileProject(entry)
    expect(initialHtml).toBe('<span>ready</span>')
    expect(code).not.toContain('sharedSignal')
    expect(code).not.toContain('IrisM0_count')
    expect(code).not.toContain('IrisM0_unused')
  })

  it('omits runtime output for an unused module signal', () => {
    const entry = writeProject({
      'main.jsx': `import { unused } from './state.js'; export function App() { render(<span>ready</span>); }`,
      'state.js': `export const unused = signal(0);`,
    })
    const { code, initialHtml } = compileProject(entry)
    expect(initialHtml).toBe('<span>ready</span>')
    expect(code).not.toContain('sharedSignal')
    expect(code).not.toContain('IrisM0_unused')
  })

  it('keeps compile(source) as the single-file API', () => {
    expect(() =>
      compile(`import { helper } from './helper.js'; export function App() { render(<div />) }`),
    ).toThrow(/only top-level function declarations are supported.*scope limit/)
  })
})

describe('compileProject: module boundary errors', () => {
  it('passes external imports through and still rejects dynamic imports and cycles', () => {
    const external = writeProject({
      'main.jsx': `import { value } from 'external-package'; export function App() { const text = signal('ready'); render(<button onClick={() => text(value)}>{text()}</button>) }`,
    })
    const externalResult = compileProject(external)
    expect(externalResult.code).toContain("from 'external-package'")
    expect(externalResult.code).toContain('IrisM0_value')

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

  it('passes CSS, URL, and worker resource imports to Vite and watches local resources', () => {
    const entry = writeProject({
      'main.jsx': `import analyzer from 'external-analyzer'; import termsUrl from './terms.json?url'; import Worker from './analysis.worker.js?worker'; import './heatmap.css'; export function App() { const status = signal('ready'); render(<button onClick={() => status(analyzer.name)}>{status()}</button>); onMount(() => { const worker = new Worker(); worker.postMessage(termsUrl); return () => worker.terminate(); }); }`,
      'terms.json': '{"terms":["情報量"]}',
      'analysis.worker.js': 'self.onmessage = () => {}',
      'heatmap.css': '.heatmap { color: red; }',
    })
    const result = compileProject(entry)
    expect(result.code).toContain("from 'external-analyzer'")
    expect(result.code).toContain("from './terms.json?url'")
    expect(result.code).toContain("from './analysis.worker.js?worker'")
    expect(result.code).toContain("import './heatmap.css'")
    expect(new Set(result.dependencies)).toEqual(
      new Set([
        entry,
        path.join(path.dirname(entry), 'terms.json'),
        path.join(path.dirname(entry), 'analysis.worker.js'),
        path.join(path.dirname(entry), 'heatmap.css'),
      ]),
    )
  })

  it('omits an unused external binding from the generated module', () => {
    const entry = writeProject({
      'main.jsx': `import { unused } from 'unused-package'; export function App() { render(<span>ready</span>) }`,
    })
    const result = compileProject(entry)
    expect(result.code).not.toContain('unused-package')
    expect(result.code).not.toContain('IrisM0_unused')
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

  it('rejects unresolved paths, unsupported module state, or statements', () => {
    const unresolved = writeProject({
      'main.jsx': `import { missing } from './missing.js'; export function App() { render(<div>{missing}</div>) }`,
    })
    expect(() => compileProject(unresolved)).toThrow(/cannot resolve relative import.*scope limit/)

    const moduleState = writeProject({
      'main.jsx': `const items = collection([], (item) => { return item.id }); export function App() { render(<div />) }`,
    })
    expect(() => compileProject(moduleState)).toThrow(
      /cannot declare module-scope collection.*scope limit/,
    )

    const readOnlyDerived = writeProject({
      'main.jsx': `import { doubled } from './state.js'; export function App() { render(<button onClick={() => doubled(1)}>{doubled()}</button>) }`,
      'state.js': `export const doubled = derived(() => 0);`,
    })
    expect(() => compileProject(readOnlyDerived)).toThrow(
      /module shared derived.*read-only.*scope limit/,
    )

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
