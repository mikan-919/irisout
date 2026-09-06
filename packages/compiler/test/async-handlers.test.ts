import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

function dispatchClick(container: Element, el: Element | null): void {
  if (!el) throw new Error('dispatchClick: element not found')
  const Event = (
    container.ownerDocument as unknown as {
      defaultView: { Event: typeof globalThis.Event }
    }
  ).defaultView.Event
  el.dispatchEvent(new Event('click'))
}

async function flushPromiseCallbacks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('async handlers', () => {
  it('keeps an async handler async and updates after await completes', async () => {
    const source = `
export function App() {
  const value = signal('before');
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  async function run() {
    const next = await Promise.resolve('after');
    value(next);
  }
}
`
    const { code } = compile(source)
    expect(code).toContain('async (...__args) =>')
    expect(code).toContain('await Promise.resolve')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const span = container.querySelector('span')
    expect(span?.textContent).toBe('before')
    dispatchClick(container, container.querySelector('button'))
    await flushPromiseCallbacks()
    expect(span?.textContent).toBe('after')
  })

  it('updates from a signal write inside a Promise completion callback', async () => {
    const source = `
export function App() {
  const value = signal('before');
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run() {
    Promise.resolve('after').then((next) => {
      value(next);
    });
  }
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const span = container.querySelector('span')
    expect(span?.textContent).toBe('before')
    dispatchClick(container, container.querySelector('button'))
    await flushPromiseCallbacks()
    expect(span?.textContent).toBe('after')
  })

  it('supports a concise Promise completion callback', async () => {
    const source = `
export function App() {
  const value = signal('before');
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run() {
    Promise.resolve('after').then((next) => value(next));
  }
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    dispatchClick(container, container.querySelector('button'))
    await flushPromiseCallbacks()
    expect(container.querySelector('span')?.textContent).toBe('after')
  })

  it('shows start, result, and failure states through Promise callbacks', async () => {
    const source = `
export function App() {
  const phase = signal('idle');
  render(
    <div>
      <span>{phase()}</span>
      <button class="success" onClick={runSuccess}>success</button>
      <button class="failure" onClick={runFailure}>failure</button>
    </div>
  );
  function runSuccess() {
    phase('start');
    Promise.resolve('result').then(
      (value) => { phase(value); },
      () => { phase('error'); },
    );
  }
  function runFailure() {
    phase('start');
    Promise.reject(new Error('failed')).then(
      (value) => { phase(value); },
      () => { phase('error'); },
    );
  }
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const span = container.querySelector('span')

    dispatchClick(container, container.querySelector('.success'))
    expect(span?.textContent).toBe('start')
    await flushPromiseCallbacks()
    expect(span?.textContent).toBe('result')

    dispatchClick(container, container.querySelector('.failure'))
    expect(span?.textContent).toBe('start')
    await flushPromiseCallbacks()
    expect(span?.textContent).toBe('error')
  })

  it('rejects try/catch in a handler until its update ordering is specified', () => {
    const source = `
export function App() {
  const value = signal('before');
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  async function run() {
    try {
      value(await Promise.resolve('after'));
    } catch {
      value('error');
    }
  }
}
`
    expect(() => compile(source)).toThrow(/TryStatement.*scope limit/)
  })
})
