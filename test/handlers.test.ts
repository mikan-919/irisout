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
  render(
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
  render(<div><span>{doubled()}</span><button onClick={() => doubled(5)}>+</button></div>);
}
`
    expect(() => compile(source)).toThrow(/cannot write to derived/)
  })

  it('throws a scope-limit error when a signal write takes more than one argument', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={() => count(1, 2)}>+</button></div>);
}
`
    expect(() => compile(source)).toThrow(/scope limit/)
  })
})

// ADR-0008: ゾーン構造(変数→UI(render())→動き(function宣言))。ハンドラの
// 識別子参照は render 後方の function宣言に解決し、配置違反は compile error。
describe('ADR-0008: zone authoring API', () => {
  // 変数→render()→function宣言。onClick は後方 function 宣言への識別子参照。
  const IDENT_HANDLER_SOURCE = `
export function Counter() {
  const count = signal(0);
  render(
    <div>
      <span>{count()}</span>
      <button onClick={inc}>+</button>
    </div>
  );
  function inc() { count(count() + 1); }
}
`

  it('wires an identifier-reference handler to a hoisted function declaration', async () => {
    const { code } = compile(IDENT_HANDLER_SOURCE)
    expect(code).toContain('count = count + 1')
    expect(code).toContain('update_count();')
    expect(code).toContain('addEventListener("click"')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const span = container.querySelector('span')
    expect(span?.textContent).toBe('0')
    dispatchClick(container, container.querySelector('button'))
    expect(span?.textContent).toBe('1')
  })

  it('rejects a handler reference to a variable-zone arrow (movement before UI)', () => {
    const source = `
export function App() {
  const count = signal(0);
  const inc = () => count(count() + 1);
  render(<div><span>{count()}</span><button onClick={inc}>+</button></div>);
}
`
    // 変数ゾーンの const 宣言(signal/derived 以外)は processDeclarationStatement が拒否する。
    expect(() => compile(source)).toThrow(/scope limit/)
  })

  it('rejects a handler reference that resolves to no function after render()', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={inc}>+</button></div>);
}
`
    expect(() => compile(source)).toThrow(
      /must reference a function declared after render/,
    )
  })

  it('rejects a handler function declaration with a multi-statement body (ADR-0009 scope)', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={inc}>+</button></div>);
  function inc() { const n = count(); count(n + 1); }
}
`
    expect(() => compile(source)).toThrow(
      /function body must be a single expression statement/,
    )
  })

  it('rejects a function declaration placed before render() (variable zone)', () => {
    const source = `
export function App() {
  const count = signal(0);
  function inc() { count(count() + 1); }
  render(<div><span>{count()}</span><button onClick={inc}>+</button></div>);
}
`
    expect(() => compile(source)).toThrow(/scope limit/)
  })

  it('rejects a const declaration placed after render() (movement zone)', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span></div>);
  const doubled = count() * 2;
}
`
    expect(() => compile(source)).toThrow(
      /only function declarations are allowed after render/,
    )
  })

  it('rejects a component with no render() call', () => {
    const source = `
export function App() {
  const count = signal(0);
}
`
    expect(() => compile(source)).toThrow(/must contain a render/)
  })

  it('rejects a component with two render() calls', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span></div>);
  render(<p>{count()}</p>);
}
`
    expect(() => compile(source)).toThrow(/exactly one render/)
  })
})
