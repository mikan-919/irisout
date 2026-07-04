import { describe, expect, it } from 'bun:test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

// マイルストーン2:onClick={...} の中の signal 書き込みを静的解析し、
// クリックだけで対応する update_* が自動的に呼ばれ DOM が更新されることを
// 確認する。M1 の counter.test.ts で「手動 update_count() は動くが、
// production ではそれを叩く手段がない」と書いていた欠落を埋めるテスト。
const COUNTER_SOURCE = `
export function Counter() {
  const count = signal(0);
  const doubled = derived(() => count() * 2);
  return (
    <div>
      <span>{count() + doubled()}</span>
      <button onClick={() => count(count() + 1)}>+</button>
    </div>
  );
}
`

function dispatchClick(container: Element, el: Element | null): void {
  if (!el) throw new Error('dispatchClick: element not found')
  const Event = (
    container.ownerDocument as unknown as {
      defaultView: { Event: typeof globalThis.Event }
    }
  ).defaultView.Event
  el.dispatchEvent(new Event('click'))
}

describe('milestone 2: handlers -> write-triggered updates', () => {
  it('a click on the button updates the DOM with no manual update_* call', async () => {
    const { code } = compile(COUNTER_SOURCE)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)

    const span = container.querySelector('span')
    expect(span?.textContent).toBe('0')
    dispatchClick(container, container.querySelector('button'))
    // count: 0 -> 1, doubled: 0 -> 2, span shows count()+doubled() = 3
    expect(span?.textContent).toBe('3')
  })

  it('emits a plain assignment for the write, not a re-invoked call, and no signal(/derived( wrapper', () => {
    const { code } = compile(COUNTER_SOURCE)
    expect(code).toContain('count = count + 1')
    expect(code).not.toContain('count(count + 1)')
    expect(code).not.toContain('signal(')
    expect(code).not.toContain('derived(')
    expect(code).toContain('addEventListener("click"')
    expect(code).toContain('update_count();')
  })

  it('throws at compile time when a handler writes to a derived', () => {
    const source = `
export function App() {
  const count = signal(0);
  const doubled = derived(() => count() * 2);
  return <div><span>{doubled()}</span><button onClick={() => doubled(5)}>+</button></div>;
}
`
    expect(() => compile(source)).toThrow(/cannot write to derived/)
  })

  it('throws a scope-limit error when a signal write takes more than one argument', () => {
    const source = `
export function App() {
  const count = signal(0);
  return <div><span>{count()}</span><button onClick={() => count(1, 2)}>+</button></div>;
}
`
    expect(() => compile(source)).toThrow(/scope limit/)
  })
})
