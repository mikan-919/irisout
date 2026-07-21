import { describe, expect, it } from 'bun:test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

// cross-function-handler-writes: inline arrow ハンドラ/action 本体から動きゾーン
// 補助関数を呼ぶと、その関数の signal 書き込みが解析されず update_*() が黙って
// 落ちていた(ROADMAP 論点0)。binding 確認つきの呼び出し追跡で解消する。

function dispatchClick(container: Element, el: Element | null): void {
  if (!el) throw new Error('dispatchClick: element not found')
  const Event = (
    container.ownerDocument as unknown as {
      defaultView: { Event: typeof globalThis.Event }
    }
  ).defaultView.Event
  el.dispatchEvent(new Event('click'))
}

async function mount(code: string): Promise<Element> {
  const mod = await loadGenerated(code)
  const container = createContainer()
  ;(mod.mountComponent as (c: Element) => void)(container)
  return container
}

describe('cross-function-handler-writes: 追跡と発火', () => {
  // 発見時の再現形: リストアイテムの `onClick={() => toggle(todo.id)}`。
  const TODO_SOURCE = `
export function App() {
  const todos = signal([{ id: 1, done: false }, { id: 2, done: false }]);
  const doneCount = derived(() => todos().filter((t) => t.done).length);
  render(
    <div>
      <span>{doneCount()}</span>
      <ul>
        {todos().map((todo) => (
          <li key={todo.id}>
            <button onClick={() => toggle(todo.id)}>toggle</button>
          </li>
        ))}
      </ul>
    </div>
  );
  function toggle(id) {
    todos(todos().map((t) => (t.id === id ? { id: t.id, done: !t.done } : t)));
  }
}
`

  it('リストアイテム内の引数つき呼び出しでクリック→表示更新まで動く(黙って落ちない)', async () => {
    const { code } = compile(TODO_SOURCE)
    const container = await mount(code)
    const span = container.querySelector('span')
    expect(span?.textContent).toBe('0')
    dispatchClick(container, container.querySelector('button'))
    expect(span?.textContent).toBe('1')
  })

  it('呼び出し先関数を authored 名のままモジュールスコープへ emit し、呼び出しは書き換えない', () => {
    const { code } = compile(TODO_SOURCE)
    expect(code).toContain('function toggle(id) {')
    expect(code).toContain('toggle(todo.id); update_todos();')
    // 書き込みは代入化、signal ラッパーは残らない。
    expect(code).toContain('todos = todos.map(')
    expect(code).not.toContain('signal(')
  })

  it('書き込みの update は呼び出し元ハンドラ末尾のみ、emit 本体には入れない', () => {
    const { code } = compile(TODO_SOURCE)
    const fnBody = code.slice(
      code.indexOf('function toggle(id) {'),
      code.indexOf('const __INITIAL_HTML__'),
    )
    expect(fnBody).not.toContain('update_todos()')
  })

  it('追跡対象呼び出しの後ろの return は拒否(ADR-0009 D3)', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={inc}>+</button></div>);
  function inc() { bump(); if (true) { return; } }
  function bump() { count(count() + 1); }
}
`
    expect(() => compile(source)).toThrow(/scope limit/)
  })
})

describe('cross-function-handler-writes: 再帰追跡', () => {
  it('2階層の呼び出しでも更新が届く', async () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={() => save()}>go</button></div>);
  function save() { toggle(); }
  function toggle() { count(count() + 1); }
}
`
    const { code } = compile(source)
    expect(code).toContain('function save()')
    expect(code).toContain('function toggle()')
    expect(code).toContain('save(); update_count();')
    const container = await mount(code)
    const span = container.querySelector('span')
    expect(span?.textContent).toBe('0')
    dispatchClick(container, container.querySelector('button'))
    expect(span?.textContent).toBe('1')
  })

  it('相互再帰でもコンパイルが停止し、両関数の書き込みが合流する', () => {
    const source = `
export function App() {
  const count = signal(0);
  const flag = signal(false);
  render(<div><span>{count()}</span><em>{flag()}</em><button onClick={() => a()}>go</button></div>);
  function a() { count(1); b(); }
  function b() { flag(true); a(); }
}
`
    const { code } = compile(source)
    // 無限再帰せずに完了し、a→b の両書き込みがハンドラ末尾へ合流する。
    expect(code).toContain('function a()')
    expect(code).toContain('function b()')
    expect(code).toContain('update_count();')
    expect(code).toContain('update_flag();')
  })
})

describe('cross-function-handler-writes: emit の単一性と拒否', () => {
  it('複数ハンドラから呼ばれても emit は1回', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={() => inc()}>a</button><button onClick={() => inc()}>b</button></div>);
  function inc() { count(count() + 1); }
}
`
    const { code } = compile(source)
    const occurrences = code.split('function inc()').length - 1
    expect(occurrences).toBe(1)
  })

  it('未使用の動きゾーン関数は emit されない', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={() => inc()}>+</button></div>);
  function inc() { count(count() + 1); }
  function unused() { count(999); }
}
`
    const { code } = compile(source)
    expect(code).toContain('function inc()')
    expect(code).not.toContain('function unused()')
  })

  it('生成側予約名(update_ 接頭辞)と衝突する authored 名は拒否', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={() => update_thing()}>+</button></div>);
  function update_thing() { count(1); }
}
`
    expect(() => compile(source)).toThrow(/scope limit/)
  })

  it('生成側予約名(__ 接頭辞)と衝突する authored 名は拒否', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={() => __helper()}>+</button></div>);
  function __helper() { count(1); }
}
`
    expect(() => compile(source)).toThrow(/scope limit/)
  })
})

describe('cross-function-handler-writes: 追跡できない呼び出しの線引き', () => {
  it('グローバル呼び出し(binding 未解決)は素通し', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={() => notify(count())}>+</button></div>);
}
`
    const { code } = compile(source)
    // binding 未解決なので追跡せずそのまま出力(read は裸の識別子へ書き換え)。
    expect(code).toContain('notify(count)')
  })

  it('ハンドラ内ローカル束縛の呼び出しは拒否', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={run}>+</button></div>);
  function run() { const f = () => count(1); f(); }
}
`
    expect(() => compile(source)).toThrow(/scope limit/)
  })

  it('仮引数の呼び出しは拒否', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button onClick={run}>+</button></div>);
  function run(cb) { cb(); }
}
`
    expect(() => compile(source)).toThrow(/scope limit/)
  })
})
