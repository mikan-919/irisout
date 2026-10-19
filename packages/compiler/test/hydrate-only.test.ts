import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

const SOURCE = `
export function App() {
  const count = signal(0);
  render(<button onClick={() => count(count() + 1)}>{count()}</button>);
}
`

describe('hydrate専用のclient出力', () => {
  it('mountと初期HTMLを省き、静的HTMLからhydrateできる', async () => {
    const full = compile(SOURCE)
    const client = compile(SOURCE, { clientEntry: 'hydrate' })

    expect(full.code).toContain('mountComponent')
    expect(full.code).toContain('__INITIAL_HTML__')
    expect(client.code).not.toContain('mountComponent')
    expect(client.code).not.toContain('__INITIAL_HTML__')
    expect(client.code).not.toContain('function mount(')

    const mod = await loadGenerated(client.code)
    expect(mod.mountComponent).toBeUndefined()
    const container = createContainer()
    container.innerHTML = full.initialHtml

    const instance = (mod.hydrateComponent as (container: Element) => { unmount(): void })(
      container,
    )
    const button = container.querySelector('button')
    if (!button) throw new Error('hydrated button was not created')
    expect(button.textContent).toBe('0')

    const Event = (
      container.ownerDocument.defaultView as unknown as { Event: typeof globalThis.Event }
    ).Event
    button.dispatchEvent(new Event('click', { bubbles: true }))
    expect(button.textContent).toBe('1')
    instance.unmount()
    expect(container.textContent).toBe('')
  })
})
