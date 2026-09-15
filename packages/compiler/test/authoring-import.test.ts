import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

describe('authoring API import', () => {
  it('removes the root import and keeps the compiled component executable', async () => {
    const source = `
import { signal, render } from 'irisout'

export function App() {
  const count = signal(1)
  render(<button onClick={increment}>{count()}</button>)

  function increment() {
    count(count() + 1)
  }
}
`
    const { code, initialHtml } = compile(source)

    expect(initialHtml).toBe('<button data-iris-id="m0">1</button>')
    expect(code).not.toContain("from 'irisout';")

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (element: Element) => void)(container)
    const button = container.querySelector('button')!
    expect(button.textContent).toBe('1')
    button.click()
    expect(button.textContent).toBe('2')
  })

  it('normalizes aliases to the names recognized by the compiler', () => {
    const source = `
import { signal as state, render as view } from 'irisout'

export function App() {
  const count = state(1)
  view(<div>{count()}</div>)
}
`
    const { code, initialHtml } = compile(source)

    expect(initialHtml).toBe('<div data-iris-id="m0">1</div>')
    expect(code).toContain('let count = 1;')
    expect(code).not.toContain("from 'irisout';")
  })

  it('rejects non-named authoring imports', () => {
    expect(() =>
      compile(`
import irisout from 'irisout'
export function App() {
  irisout(<div />)
}
`),
    ).toThrow(/default or namespace bindings/)
  })
})
