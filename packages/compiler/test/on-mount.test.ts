import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

type MountLog = string[]

function setMountLog(log: MountLog): void {
  ;(globalThis as typeof globalThis & { __irisoutMountLog?: MountLog }).__irisoutMountLog = log
}

function mountLog(): MountLog {
  const log = (globalThis as typeof globalThis & { __irisoutMountLog?: MountLog }).__irisoutMountLog
  if (!log) throw new Error('on-mount test log is not initialized')
  return log
}

describe('ADR-0025: root component onMount lifecycle', () => {
  it('runs each callback after mount and hydrate, and cleans up in reverse order once', async () => {
    setMountLog([])
    const { code, initialHtml } = compile(`
export function App() {
  render(<div>ready</div>);
  onMount(() => {
    globalThis.__irisoutMountLog.push('mount-first');
    return () => { globalThis.__irisoutMountLog.push('cleanup-first'); };
  });
  onMount(() => {
    globalThis.__irisoutMountLog.push('mount-second');
    return () => { globalThis.__irisoutMountLog.push('cleanup-second'); };
  });
}
`)
    const mod = await loadGenerated(code)
    const mountedContainer = createContainer()
    const mounted = (mod.mountComponent as (container: Element) => { unmount(): void })(
      mountedContainer,
    )
    expect(mountedContainer.textContent).toBe('ready')
    expect(mountLog()).toEqual(['mount-first', 'mount-second'])

    mounted.unmount()
    mounted.unmount()
    expect(mountLog()).toEqual(['mount-first', 'mount-second', 'cleanup-second', 'cleanup-first'])

    const hydratedContainer = createContainer()
    hydratedContainer.innerHTML = initialHtml
    const hydrated = (mod.hydrateComponent as (container: Element) => { unmount(): void })(
      hydratedContainer,
    )
    expect(hydratedContainer.textContent).toBe('ready')
    expect(mountLog()).toEqual([
      'mount-first',
      'mount-second',
      'cleanup-second',
      'cleanup-first',
      'mount-first',
      'mount-second',
    ])
    hydrated.unmount()
    expect(mountLog()).toEqual([
      'mount-first',
      'mount-second',
      'cleanup-second',
      'cleanup-first',
      'mount-first',
      'mount-second',
      'cleanup-second',
      'cleanup-first',
    ])
  })

  it('runs callback signal writes after the initial DOM is ready', async () => {
    const { code } = compile(`
export function App() {
  const count = signal(0);
  render(<span>{count()}</span>);
  onMount(() => { count(count() + 1); });
}
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    expect(container.textContent).toBe('1')
    instance.unmount()
  })

  it('cleans up callbacks already registered when a later callback fails', async () => {
    setMountLog([])
    const { code } = compile(`
export function App() {
  render(<div>ready</div>);
  onMount(() => () => { globalThis.__irisoutMountLog.push('cleanup'); });
  onMount(() => { throw new Error('mount-failed'); });
}
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (
      mod.createComponent as () => { mount(container: Element): void; unmount(): void }
    )()
    expect(() => instance.mount(container)).toThrow('mount-failed')
    expect(mountLog()).toEqual(['cleanup'])
    expect(container.childElementCount).toBe(0)
    expect(() => instance.unmount()).not.toThrow()
  })

  it('continues reverse cleanup after an error and rethrows the first cleanup error', async () => {
    setMountLog([])
    const { code } = compile(`
export function App() {
  render(<div>ready</div>);
  onMount(() => () => { globalThis.__irisoutMountLog.push('first'); });
  onMount(() => () => {
    globalThis.__irisoutMountLog.push('second');
    throw new Error('cleanup-second');
  });
}
`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    expect(() => instance.unmount()).toThrow('cleanup-second')
    expect(mountLog()).toEqual(['second', 'first'])
    expect(() => instance.unmount()).not.toThrow()
  })

  it('does not emit onMount lifecycle code when the API is unused', () => {
    const { code } = compile('export function App() { render(<div>ready</div>); }')
    expect(code).not.toContain('__on_mount_')
    expect(code).not.toContain('onMount(')
  })

  it('rejects onMount in an inlined child component', () => {
    expect(() =>
      compile(`
function Child() {
  render(<span>child</span>);
  onMount(() => {});
}
export function App() {
  render(<div><Child /></div>);
}
`),
    ).toThrow(/onMount\(\) is supported only in the root component.*scope limit/)
  })

  it('rejects callbacks with parameters or non-function cleanup values', () => {
    expect(() =>
      compile('export function App() { render(<div />); onMount((value) => {}); }'),
    ).toThrow(/onMount\(\) callback must not take parameters.*scope limit/)
    expect(() =>
      compile('export function App() { render(<div />); onMount(() => { return 1; }); }'),
    ).toThrow(/onMount\(\) may only return a zero-argument cleanup function.*scope limit/)
  })
})
