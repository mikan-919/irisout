import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

type AsyncContextLog = string[]

function setAsyncContextLog(log: AsyncContextLog): void {
  ;(
    globalThis as typeof globalThis & { __irisoutAsyncContextLog?: AsyncContextLog }
  ).__irisoutAsyncContextLog = log
}

function asyncContextLog(): AsyncContextLog {
  const log = (globalThis as typeof globalThis & { __irisoutAsyncContextLog?: AsyncContextLog })
    .__irisoutAsyncContextLog
  if (!log) throw new Error('async context test log is not initialized')
  return log
}

describe('async context value contract', () => {
  it('statically replaces an async context value and leaves resolution to authored code', async () => {
    setAsyncContextLog([])
    const { code } = compile(`
const Request = createAsyncContext(Promise.resolve('default'));
export function App() {
  const value = signal('one');
  provideContext(Request, Promise.resolve(value()));
  render(<button onClick={change}>ready</button>);
  effect(() => {
    useContext(Request).then((resolved) => { globalThis.__irisoutAsyncContextLog.push(resolved); });
    return () => { globalThis.__irisoutAsyncContextLog.push('cleanup'); };
  });
  function change() { value('two'); }
}
`)
    expect(code).not.toContain('createAsyncContext')
    expect(code).not.toContain('useContext(')
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    await Promise.resolve()
    expect(asyncContextLog()).toEqual(['one'])

    const EventCtor = container.ownerDocument.defaultView!.Event
    container.querySelector('button')!.dispatchEvent(new EventCtor('click', { bubbles: true }))
    await Promise.resolve()
    expect(asyncContextLog()).toEqual(['one', 'cleanup', 'two'])
    instance.unmount()
    expect(asyncContextLog()).toEqual(['one', 'cleanup', 'two', 'cleanup'])
  })

  it('does not emit async context runtime machinery when unused', () => {
    const { code } = compile('export function App() { render(<div>ready</div>); }')
    expect(code).not.toContain('createAsyncContext')
    expect(code).not.toContain('IrisAsyncContext')
  })
})
