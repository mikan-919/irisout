import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

describe('ADR-0027: instance-scoped context', () => {
  it('resolves a root provider and falls back to the declared default', async () => {
    const { code, initialHtml } = compile(`
const Theme = createContext('light');
function Child() { render(<span>{useContext(Theme)}</span>); }
export function App() {
  provideContext(Theme, 'dark');
  render(<div><Child /></div>);
}
`)
    expect(initialHtml).toBe('<div><span data-iris-id="m0">dark</span></div>')
    expect(code).not.toContain('useContext(')
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    expect(container.textContent).toBe('dark')
    instance.unmount()

    const fallback = compile(`
const Theme = createContext('light');
export function App() { render(<span>{useContext(Theme)}</span>); }
`)
    expect(fallback.initialHtml).toBe('<span data-iris-id="m0">light</span>')
  })

  it('connects a root provider signal to the consumer marker update', async () => {
    const { code } = compile(`
const Theme = createContext('light');
function Child() { render(<span>{useContext(Theme)}</span>); }
export function App() {
  const theme = signal('dark');
  provideContext(Theme, theme());
  render(<div><button onClick={toggle}>toggle</button><Child /></div>);
  function toggle() { theme(theme() === 'dark' ? 'light' : 'dark'); }
}
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    expect(container.textContent).toBe('toggledark')
    const EventCtor = container.ownerDocument.defaultView!.Event
    container.querySelector('button')!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    expect(container.textContent).toBe('togglelight')
    instance.unmount()
  })

  it('keeps provider values isolated in keyed item factories', async () => {
    const { code } = compile(`
const Theme = createContext('default');
function Row({ item }) { render(<li key={item.id}>{useContext(Theme)}</li>); }
export function App() {
  const items = signal([{ id: 1, label: 'one' }, { id: 2, label: 'two' }]);
  render(<ul>{items().map((item) => {
    const local = signal(item.label);
    provideContext(Theme, local());
    return <Row key={item.id} item={item} />;
  })}</ul>);
}
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    expect([...container.querySelectorAll('li')].map((el) => el.textContent)).toEqual([
      'one',
      'two',
    ])
    instance.unmount()
  })

  it('updates only the owning item when a local provider signal changes', async () => {
    const { code } = compile(`
const Theme = createContext('default');
function Row({ item, toggle }) { render(<li key={item.id} onClick={toggle}>{useContext(Theme)}</li>); }
export function App() {
  const items = signal([{ id: 1, label: 'one' }, { id: 2, label: 'two' }]);
  render(<ul>{items().map((item) => {
    const local = signal(item.label);
    provideContext(Theme, local());
    function toggle() { local(local() + '!'); }
    return <Row key={item.id} item={item} toggle={toggle} />;
  })}</ul>);
}
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    const EventCtor = container.ownerDocument.defaultView!.Event
    container.querySelectorAll('li')[0]!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    expect([...container.querySelectorAll('li')].map((el) => el.textContent)).toEqual([
      'one!',
      'two',
    ])
    instance.unmount()
  })

  it('keeps an inlined conditional provider inside the branch factory', async () => {
    const { code } = compile(`
const Theme = createContext('default');
function Child() {
  provideContext(Theme, 'branch');
  render(<span>{useContext(Theme)}</span>);
}
export function App() {
  const visible = signal(false);
  render(<main><button onClick={show}>show</button>{visible() && <Child />}</main>);
  function show() { visible(true); }
}
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    const EventCtor = container.ownerDocument.defaultView!.Event
    container.querySelector('button')!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    expect(container.textContent).toBe('showbranch')
    instance.unmount()
  })

  it('switches a provider tree with conditional branches', async () => {
    const { code } = compile(`
const Theme = createContext('default');
function Child() { render(<span>{useContext(Theme)}</span>); }
export function App() {
  const dark = signal(false);
  render(<main><button onClick={toggle}>toggle</button>{dark() ? <section>{provideContext(Theme, 'dark')}<Child /></section> : <section>{provideContext(Theme, 'light')}<Child /></section>}</main>);
  function toggle() { dark(!dark()); }
}
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    expect(container.textContent).toBe('togglelight')
    const EventCtor = container.ownerDocument.defaultView!.Event
    container.querySelector('button')!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    expect(container.textContent).toBe('toggledark')
    instance.unmount()
  })

  it('does not emit context machinery when unused', () => {
    const { code } = compile('export function App() { render(<div>ready</div>); }')
    expect(code).not.toContain('createContext')
    expect(code).not.toContain('provideContext')
    expect(code).not.toContain('useContext')
  })
})
