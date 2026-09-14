import { describe, expect, it } from 'vite-plus/test'
import { compile as compileClient } from '../src/compiler.js'
import { compile as compileBrowser, compileBrowser as compileBrowserNamed } from '../src/browser.js'

const COUNTER_SOURCE = `
export function Counter() {
  const count = signal(0);
  const doubled = derived(() => count() * 2);
  render(<button>{count()} / {doubled()}</button>);
}
`

const LIST_SOURCE = `
export function List() {
  const items = signal([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
  render(<ul>{items().map((item) => <li key={item.id}>{item.label}</li>)}</ul>);
}
`

const SVG_SOURCE = `
export function Icon() {
  render(<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg>);
}
`

describe('browser compiler entry', () => {
  it.each([
    ['Counter', COUNTER_SOURCE],
    ['List', LIST_SOURCE],
    ['SVG', SVG_SOURCE],
  ])('既存compileと%sの結果が一致する', (_name, source) => {
    const client = compileClient(source)
    const browser = compileBrowser(source)
    expect(browser.initialHtml).toBe(client.initialHtml)
    expect(browser.code).toBe(client.code)
    expect(browser.map).toEqual(client.map)
    expect(browser.markers).toEqual(client.markers)
  })

  it('公開入口はcompileBrowserとcompileの両方を提供する', () => {
    expect(compileBrowserNamed(COUNTER_SOURCE).initialHtml).toBe(
      compileBrowser(COUNTER_SOURCE).initialHtml,
    )
  })

  it('既存compileと構文診断の形式が一致する', () => {
    const source = `export function App() {
  render(<div>
}`
    let clientMessage = ''
    let browserMessage = ''
    try {
      compileClient(source)
    } catch (error) {
      clientMessage = error instanceof Error ? error.message : String(error)
    }
    try {
      compileBrowser(source)
    } catch (error) {
      browserMessage = error instanceof Error ? error.message : String(error)
    }
    expect(browserMessage).toBe(clientMessage)
    expect(browserMessage).toMatch(/^compile:/)
  })

  it.each([
    [
      'static import',
      `import { value } from 'external-package'; export function App() { render(<div>{value}</div>); }`,
      /browser source does not support static import.*scope limit/,
    ],
    [
      'dynamic import',
      `export function App() { render(<div />); async function load() { return import('external-package'); } }`,
      /browser source does not support dynamic import.*scope limit/,
    ],
    [
      'external resource',
      `import icon from './icon.svg'; export function App() { render(<img src={icon} />); }`,
      /browser source does not support external resource import.*scope limit/,
    ],
  ])('%sを実行せずscope limit診断にする', (_name, source, expected) => {
    expect(() => compileBrowser(source)).toThrow(expected)
  })
})
