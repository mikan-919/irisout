import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

function click(container: Element, selector: string): void {
  const element = container.querySelector(selector)
  if (!element) throw new Error(`click: ${selector} not found`)
  const Event = container.ownerDocument.defaultView!.Event
  element.dispatchEvent(new Event('click'))
}

const SOURCE = `
export function App() {
  const items = signal([{ id: 1, text: 'a' }, { id: 2, text: 'b' }]);
  render(
    <div>
      <p>{items().map((item) => item.text).join(',')}</p>
      <ul>{items().map((item) => <li key={item.id}>{item.text}</li>)}</ul>
      <button class="update" onClick={() => items((previous) => previous.map((item) => item.id === 1 ? { ...item, text: item.text + '!' } : item))}>update</button>
      <button class="filter" onClick={() => items((previous) => previous.filter((item) => item.id !== 1))}>filter</button>
    </div>
  );
}
`

describe('functional signal updates', () => {
  it('updates arrays through reconciliation and reuses keyed elements', async () => {
    const { code } = compile(SOURCE)
    expect(code).toContain('items = ((previous) =>')
    expect(code).toContain(')(items)')
    expect(code).toContain('__reconcileList__(')
    expect(code).not.toContain('__updateCollectionItem__')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => void)(container)
    const second = container.querySelectorAll('li')[1]

    click(container, '.update')
    expect(container.querySelector('p')?.textContent).toBe('a!,b')
    expect(container.querySelectorAll('li')[1]).toBe(second)

    click(container, '.filter')
    expect(container.querySelector('p')?.textContent).toBe('b')
    expect(container.querySelector('li')).toBe(second)
  })

  it('supports functional updates for scalar signals', async () => {
    const source = `export function App() { const count = signal(0); render(<button onClick={() => count((previous) => previous + 1)}>{count()}</button>); }`
    const mod = await loadGenerated(compile(source).code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => void)(container)
    click(container, 'button')
    expect(container.textContent).toBe('1')
  })

  it('rejects the removed two-argument signal declaration', () => {
    expect(() =>
      compile(
        `export function App() { const items = signal([], (item) => item.id); render(<div />); }`,
      ),
    ).toThrow('signal() takes exactly one initial value')
  })
})
