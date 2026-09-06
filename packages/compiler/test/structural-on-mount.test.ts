import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

type LifecycleLog = string[]

function setLifecycleLog(log: LifecycleLog): void {
  ;(
    globalThis as typeof globalThis & { __irisoutUnitMountLog?: LifecycleLog }
  ).__irisoutUnitMountLog = log
}

function lifecycleLog(): LifecycleLog {
  const log = (globalThis as typeof globalThis & { __irisoutUnitMountLog?: LifecycleLog })
    .__irisoutUnitMountLog
  if (!log) throw new Error('structural onMount test log is not initialized')
  return log
}

describe('structural and inlined component onMount lifecycle', () => {
  it('owns an inlined child cleanup per keyed list item', async () => {
    setLifecycleLog([])
    const { code } = compile(`
function Row({ item }) {
  render(<li key={item.id}>{item.label}</li>);
  onMount(() => {
    globalThis.__irisoutUnitMountLog.push('mount-' + item.id);
    return () => { globalThis.__irisoutUnitMountLog.push('cleanup-' + item.id); };
  });
}
export function App() {
  const items = signal([{ id: 1, label: 'a' }, { id: 2, label: 'b' }]);
  render(<div><button onClick={remove}>remove</button><ul>{items().map((item) => <Row key={item.id} item={item} />)}</ul></div>);
  function remove() { items(items().filter((item) => item.id !== 1)); }
}
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    expect(lifecycleLog()).toEqual(['mount-1', 'mount-2'])
    expect(container.textContent).toBe('removeab')
    const EventCtor = container.ownerDocument.defaultView!.Event
    container.querySelector('button')!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    expect(lifecycleLog()).toEqual(['mount-1', 'mount-2', 'cleanup-1'])
    instance.unmount()
    expect(lifecycleLog()).toEqual(['mount-1', 'mount-2', 'cleanup-1', 'cleanup-2'])
  })

  it('supports an authored onMount statement in a list item block', async () => {
    setLifecycleLog([])
    const { code } = compile(`
export function App() {
  const items = signal([1]);
  render(<ul>{items().map((item) => {
    onMount(() => () => { globalThis.__irisoutUnitMountLog.push('cleanup-' + item); });
    return <li key={item}>{item}</li>;
  })}</ul>);
}
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    expect(container.textContent).toBe('1')
    instance.unmount()
    expect(lifecycleLog()).toEqual(['cleanup-1'])
  })

  it('routes a structural onMount signal write to its factory update', async () => {
    const { code } = compile(`
export function App() {
  const items = signal([1]);
  render(<ul>{items().map((item) => {
    const ready = signal(false);
    onMount(() => { ready(true); });
    return <li key={item}>{ready() ? 'ready' : 'pending'}</li>;
  })}</ul>);
}
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    expect(container.textContent).toBe('ready')
    instance.unmount()
  })

  it('promotes a root-scope inlined child onMount into the root instance', async () => {
    setLifecycleLog([])
    const { code } = compile(`
function Child() {
  render(<span>child</span>);
  onMount(() => () => { globalThis.__irisoutUnitMountLog.push('child-cleanup'); });
}
export function App() { render(<div><Child /></div>); }
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    expect(container.textContent).toBe('child')
    instance.unmount()
    expect(lifecycleLog()).toEqual(['child-cleanup'])
  })

  it('collects a child onMount in a conditional branch factory', async () => {
    setLifecycleLog([])
    const { code } = compile(`
function Child() {
  render(<span>child</span>);
  onMount(() => () => { globalThis.__irisoutUnitMountLog.push('branch-cleanup'); });
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
    expect(container.textContent).toBe('show')
    const EventCtor = container.ownerDocument.defaultView!.Event
    container.querySelector('button')!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    expect(container.textContent).toBe('showchild')
    instance.unmount()
    expect(lifecycleLog()).toEqual(['branch-cleanup'])
  })

  it('does not emit unit lifecycle machinery when no unit onMount is authored', () => {
    const { code } = compile(`
export function App() {
  const items = signal([1]);
  render(<ul>{items().map((item) => <li key={item}>{item}</li>)}</ul>);
}
`)
    expect(code).not.toContain('__unit_mount_cleanup_')
  })
})
