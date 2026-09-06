import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

type EffectLog = string[]

function setEffectLog(log: EffectLog): void {
  ;(globalThis as typeof globalThis & { __irisoutEffectLog?: EffectLog }).__irisoutEffectLog = log
}

function effectLog(): EffectLog {
  const log = (globalThis as typeof globalThis & { __irisoutEffectLog?: EffectLog })
    .__irisoutEffectLog
  if (!log) throw new Error('effect test log is not initialized')
  return log
}

describe('ADR-0026: root component effect lifecycle', () => {
  it('runs initially, cleans before dependency rerun, and cleans current value on unmount', async () => {
    setEffectLog([])
    const { code } = compile(`
export function App() {
  const count = signal(0);
  render(<button onClick={increment}>ready</button>);
  effect(() => {
    const value = count();
    globalThis.__irisoutEffectLog.push('effect-' + value);
    return () => { globalThis.__irisoutEffectLog.push('cleanup-' + value); };
  });
  function increment() { count(count() + 1); }
}
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    expect(effectLog()).toEqual(['effect-0'])

    const EventCtor = container.ownerDocument.defaultView!.Event
    container.querySelector('button')!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    expect(effectLog()).toEqual(['effect-0', 'cleanup-0', 'effect-1'])

    instance.unmount()
    instance.unmount()
    expect(effectLog()).toEqual(['effect-0', 'cleanup-0', 'effect-1', 'cleanup-1'])
  })

  it('connects an effect-only dependency to a generated signal update', async () => {
    setEffectLog([])
    const { code } = compile(`
export function App() {
  const count = signal(0);
  render(<button onClick={increment}>ready</button>);
  effect(() => { globalThis.__irisoutEffectLog.push(String(count())); });
  function increment() { count(count() + 1); }
}
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    const EventCtor = container.ownerDocument.defaultView!.Event
    container.querySelector('button')!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    expect(effectLog()).toEqual(['0', '1'])
    instance.unmount()
  })

  it('runs only once after onMount changes a dependency during initialization', async () => {
    setEffectLog([])
    const { code } = compile(`
export function App() {
  const count = signal(0);
  render(<div>ready</div>);
  onMount(() => { count(1); });
  effect(() => { globalThis.__irisoutEffectLog.push(String(count())); });
}
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    expect(effectLog()).toEqual(['1'])
    instance.unmount()
  })

  it('does not emit effect-specific code when unused', () => {
    const { code } = compile('export function App() { render(<div>ready</div>); }')
    expect(code).not.toContain('__run_effect_')
    expect(code).not.toContain('__effect_cleanup_')
    expect(code).not.toContain('effect(')
  })

  it('rejects tracked signal writes and accepts structural effect callbacks', () => {
    expect(() =>
      compile(`
export function App() {
  const count = signal(0);
  render(<div />);
  effect(() => { count(1); });
}
`),
    ).toThrow(/effect\(\) cannot write tracked signals.*scope limit/)

    expect(() =>
      compile(`
function Child() {
  render(<span>child</span>);
  effect(() => {});
}
export function App() { render(<div><Child /></div>); }
`),
    ).not.toThrow()
  })
})
