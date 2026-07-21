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

  it('accepts a handler function declaration with a multi-statement body (ADR-0009)', async () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={inc}>+</button></div>);
  function inc() { const n = count() + 1; count(n); }
}
`
    const { code } = compile(source)
    expect(code).toContain('count = n')
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const span = container.querySelector('span')
    expect(span?.textContent).toBe('0')
    dispatchClick(container, container.querySelector('button'))
    expect(span?.textContent).toBe('1')
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

// ADR-0009: ハンドラのブロック本体(4文種)・第1引数(イベントオブジェクト)の
// 受け渡し・文中の signal 書き込み検出を M4.5(単一式のみ)から広げる。
describe('ADR-0009: handler statement bodies', () => {
  function windowOf(container: Element) {
    return (
      container.ownerDocument as unknown as { defaultView: typeof window }
    ).defaultView
  }

  it('compiles the ADR-0008 decision example (block body, no args)', async () => {
    const source = `
export function App() {
  const state = signal(0);
  render(<div><span>{state()}</span><button onClick={handleCountUp}>+</button></div>);
  function handleCountUp() { state(state() + 1) }
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const span = container.querySelector('span')
    expect(span?.textContent).toBe('0')
    dispatchClick(container, container.querySelector('button'))
    expect(span?.textContent).toBe('1')
  })

  it('compiles a body containing all 4 statement kinds (handleInputKeyDown shape)', async () => {
    const source = `
export function App() {
  const todos = signal([]);
  render(
    <div>
      <span>{todos().length}</span>
      <input onKeyDown={handleInputKeyDown} />
    </div>
  );
  function handleInputKeyDown(e) {
    if (e.key !== 'Enter') return;
    const text = e.target.value;
    if (text === '') return;
    todos([...todos(), text]);
  }
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const input = container.querySelector('input') as HTMLInputElement
    const span = container.querySelector('span')
    const KeyboardEvent = windowOf(container).KeyboardEvent
    expect(span?.textContent).toBe('0')

    input.value = ''
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(span?.textContent).toBe('0') // 空テキスト -> ガードで抜ける

    input.value = 'buy milk'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(span?.textContent).toBe('1')

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(span?.textContent).toBe('1') // Enter以外 -> ガードで抜ける
  })

  it('compiles an inline arrow with a block body', async () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={() => { const n = count() + 1; count(n); }}>+</button></div>);
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const span = container.querySelector('span')
    dispatchClick(container, container.querySelector('button'))
    expect(span?.textContent).toBe('1')
  })

  it('passes the real event object through as the authored first parameter', async () => {
    const source = `
export function App() {
  const lastKey = signal('');
  render(<div><span>{lastKey()}</span><input onKeyDown={handleKeyDown} /></div>);
  function handleKeyDown(e) { lastKey(e.key); }
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const input = container.querySelector('input') as HTMLInputElement
    const span = container.querySelector('span')
    const KeyboardEvent = windowOf(container).KeyboardEvent
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }))
    expect(span?.textContent).toBe('x')
  })

  it('lets the handler parameter shadow a same-named tracked signal', () => {
    const source = `
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={handle}>go</button></div>);
  function handle(value) { const x = value; }
}
`
    const { code } = compile(source)
    // 引数の value はローカルとして扱われ、signal への書き込みとして
    // 解決されない(update_value() の呼び出しがハンドラ内に生成されない)。
    expect(code).not.toContain('update_value();')
  })

  it('does not treat a local const with a signal-shadowing name as a signal', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={inc}>+</button></div>);
  function inc() { const count = 99; count; }
}
`
    const { code } = compile(source)
    expect(code).not.toContain('update_count();')
  })

  it('converts a write inside a spread expression to a plain assignment (no call form left)', () => {
    const source = `
export function App() {
  const todos = signal([]);
  render(<div><span>{todos().length}</span><button onClick={add}>+</button></div>);
  function add() { todos([...todos(), 'x']); }
}
`
    const { code } = compile(source)
    expect(code).toContain("todos = [...todos, 'x']")
    expect(code).not.toContain('todos([')
  })

  it('generates a tail update_* for a write inside an if branch (static over-approximation)', async () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={inc}>+</button></div>);
  function inc() { if (true) { count(1); } }
}
`
    const { code } = compile(source)
    expect(code).toContain('update_count();')
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const span = container.querySelector('span')
    dispatchClick(container, container.querySelector('button'))
    expect(span?.textContent).toBe('1')
  })

  it('rejects a loop inside a handler body', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={inc}>+</button></div>);
  function inc() { for (let i = 0; i < 1; i++) { count(1); } }
}
`
    expect(() => compile(source)).toThrow(/scope limit/)
  })

  it('rejects a var declaration inside a handler body', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={inc}>+</button></div>);
  function inc() { var x = 1; count(x); }
}
`
    expect(() => compile(source)).toThrow(/scope limit/)
  })

  it('rejects a return that returns a value', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={inc}>+</button></div>);
  function inc() { count(1); return false; }
}
`
    expect(() => compile(source)).toThrow(/scope limit/)
  })

  it('rejects a return after a tracked write (D3: the write would be lost)', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={inc}>+</button></div>);
  function inc() { count(1); if (true) { return; } }
}
`
    expect(() => compile(source)).toThrow(/scope limit/)
  })

  it('rejects a destructured handler parameter', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={handle}>+</button></div>);
  function handle({ target }) { count(1); }
}
`
    expect(() => compile(source)).toThrow(/scope limit/)
  })
})
