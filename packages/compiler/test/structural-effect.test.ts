import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

type EffectLog = string[]

function setEffectLog(log: EffectLog): void {
  ;(globalThis as typeof globalThis & { __irisoutStructuralEffectLog?: EffectLog })
    .__irisoutStructuralEffectLog = log
}

function effectLog(): EffectLog {
  const log = (globalThis as typeof globalThis & { __irisoutStructuralEffectLog?: EffectLog })
    .__irisoutStructuralEffectLog
  if (!log) throw new Error('structural effect test log is not initialized')
  return log
}

describe('structural and inlined component effect lifecycle', () => {
  it('reruns an item effect from a local signal and cleans it on removal', async () => {
    setEffectLog([])
    const { code } = compile(`
export function App() {
  const items = signal([{ id: 1 }]);
  render(<main><button onClick={remove}>remove</button><ul>{items().map((item) => {
    const ready = signal(false);
    effect(() => {
      const value = ready();
      globalThis.__irisoutStructuralEffectLog.push('effect-' + item.id + '-' + value);
      return () => { globalThis.__irisoutStructuralEffectLog.push('cleanup-' + item.id + '-' + value); };
    });
    function toggle() { ready(!ready()); }
    return <li key={item.id}><button onClick={toggle}>toggle</button></li>;
  })}</ul></main>);
  function remove() { items([]); }
}
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    expect(effectLog()).toEqual(['effect-1-false'])

    const EventCtor = container.ownerDocument.defaultView!.Event
    container.querySelectorAll('button')[1]!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    expect(effectLog()).toEqual(['effect-1-false', 'cleanup-1-false', 'effect-1-true'])

    container.querySelectorAll('button')[0]!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    expect(effectLog()).toEqual([
      'effect-1-false',
      'cleanup-1-false',
      'effect-1-true',
      'cleanup-1-true',
    ])
    instance.unmount()
    expect(effectLog()).toHaveLength(4)
  })

  it('reruns structural effects for a root dependency without rerunning unrelated items', async () => {
    setEffectLog([])
    const { code } = compile(`
export function App() {
  const items = signal([{ id: 1 }, { id: 2 }]);
  const tick = signal(0);
  render(<main><button onClick={increment}>tick</button><button onClick={remove}>remove</button><ul>{items().map((item) => {
    effect(() => {
      globalThis.__irisoutStructuralEffectLog.push('effect-' + item.id + '-' + tick());
      return () => { globalThis.__irisoutStructuralEffectLog.push('cleanup-' + item.id); };
    });
    return <li key={item.id}>{item.id}</li>;
  })}</ul></main>);
  function increment() { tick(tick() + 1); }
  function remove() { items(items().filter((item) => item.id !== 1)); }
}
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    expect(effectLog()).toEqual(['effect-1-0', 'effect-2-0'])
    const EventCtor = container.ownerDocument.defaultView!.Event
    container.querySelectorAll('button')[0]!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    expect(effectLog()).toEqual([
      'effect-1-0',
      'effect-2-0',
      'cleanup-1',
      'effect-1-1',
      'cleanup-2',
      'effect-2-1',
    ])
    container.querySelectorAll('button')[1]!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    expect(effectLog()).toEqual([
      'effect-1-0',
      'effect-2-0',
      'cleanup-1',
      'effect-1-1',
      'cleanup-2',
      'effect-2-1',
      'cleanup-1',
    ])
    instance.unmount()
    expect(effectLog()).toEqual([
      'effect-1-0',
      'effect-2-0',
      'cleanup-1',
      'effect-1-1',
      'cleanup-2',
      'effect-2-1',
      'cleanup-1',
      'cleanup-2',
    ])
  })

  it('owns an inlined child effect per list item', async () => {
    setEffectLog([])
    const { code } = compile(`
function Row({ item }) {
  render(<li key={item.id}>{item.label}</li>);
  effect(() => {
    globalThis.__irisoutStructuralEffectLog.push('mount-' + item.id);
    return () => { globalThis.__irisoutStructuralEffectLog.push('cleanup-' + item.id); };
  });
}
export function App() {
  const items = signal([{ id: 1, label: 'a' }, { id: 2, label: 'b' }]);
  render(<main><button onClick={remove}>remove</button><ul>{items().map((item) => <Row key={item.id} item={item} />)}</ul></main>);
  function remove() { items(items().filter((item) => item.id !== 1)); }
}
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    expect(effectLog()).toEqual(['mount-1', 'mount-2'])
    const EventCtor = container.ownerDocument.defaultView!.Event
    container.querySelector('button')!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    expect(effectLog()).toEqual(['mount-1', 'mount-2', 'cleanup-1'])
    instance.unmount()
    expect(effectLog()).toEqual(['mount-1', 'mount-2', 'cleanup-1', 'cleanup-2'])
  })

  it('mounts and destroys an inlined child effect in a conditional branch', async () => {
    setEffectLog([])
    const { code } = compile(`
function Child() {
  render(<span>child</span>);
  effect(() => () => { globalThis.__irisoutStructuralEffectLog.push('cleanup'); });
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
    expect(container.textContent).toBe('showchild')
    instance.unmount()
    expect(effectLog()).toEqual(['cleanup'])
  })

  it('promotes a root-scope inline child effect to the root instance', async () => {
    setEffectLog([])
    const { code } = compile(`
function Child() {
  render(<span>child</span>);
  effect(() => () => { globalThis.__irisoutStructuralEffectLog.push('cleanup'); });
}
export function App() { render(<main><Child /></main>); }
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    instance.unmount()
    expect(effectLog()).toEqual(['cleanup'])
  })

  it('does not emit structural effect machinery when unused', () => {
    const { code } = compile(`
export function App() {
  const items = signal([1]);
  render(<ul>{items().map((item) => <li key={item}>{item}</li>)}</ul>);
}
`)
    expect(code).not.toContain('__run_unit_effect_')
    expect(code).not.toContain('__unit_effect_cleanup_')
  })
})
