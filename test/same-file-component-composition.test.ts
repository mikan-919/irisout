import { describe, expect, it } from 'bun:test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

// same-file-component-composition (ADR-0014): 同一ファイル内の
// <Component/> 参照をコンパイル時ASTインライン化する。この test では
// まずローカルsignal(構造ユニットへインライン化された変数ゾーン宣言、
// design.md D5/D6)を、コンポーネント合成の前段としてリスト item の
// block body 直書きで検証する ― `.map()` アイテムの arrow 本体が
// bare JSX に加えてブロック本体も受理するようになったのは、インライン化
// パスがコンポーネントの変数ゾーンをこの形へ展開するため。

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

describe('same-file-component-composition: ローカルsignal(リストアイテムのブロック本体)', () => {
  const TODO_SOURCE = `
export function App() {
  const todos = signal([{ id: 1, text: 'a' }, { id: 2, text: 'b' }]);
  render(
    <ul>
      {todos().map((todo) => {
        const editing = signal(false);
        return (
          <li key={todo.id} class={editing() ? 'editing' : ''}>
            <span onClick={() => editing(true)}>{todo.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
`

  it('モジュールスコープにローカルsignal変数・update関数が一切現れない', () => {
    const { code } = compile(TODO_SOURCE)
    expect(code).not.toMatch(/^export let editing/m)
    expect(code).not.toMatch(/^let editing/m)
    expect(code).not.toContain('function update_editing')
    // factory クロージャ内には現れる。
    expect(code).toContain('let editing = false;')
  })

  it('同一ユニット直下の動的class属性バインディングがローカルsignalの書き換え後に切り替わる', async () => {
    const { code } = compile(TODO_SOURCE)
    const container = await mount(code)
    const lis = container.querySelectorAll('li')
    expect([...lis].map((li) => li.className)).toEqual(['', ''])
    dispatchClick(container, lis[0]!.querySelector('span'))
    expect([...lis].map((li) => li.className)).toEqual(['editing', ''])
  })

  it('アイテムごとにローカルsignalが独立している(1件のトグルが他に影響しない)', async () => {
    const { code } = compile(TODO_SOURCE)
    const container = await mount(code)
    const lis = container.querySelectorAll('li')
    dispatchClick(container, lis[0]!.querySelector('span'))
    dispatchClick(container, lis[1]!.querySelector('span'))
    expect([...lis].map((li) => li.className)).toEqual(['editing', 'editing'])
    // item1 だけ元に戻すような書き込みは無いが、少なくとも item0 の状態が
    // item1 の書き換えで壊れていないことを別途確認する。
    const onlyFirst = `
export function App() {
  const todos = signal([{ id: 1, text: 'a' }, { id: 2, text: 'b' }]);
  render(
    <ul>
      {todos().map((todo) => {
        const editing = signal(false);
        return (
          <li key={todo.id} class={editing() ? 'editing' : ''}>
            <span onClick={() => editing(true)}>{todo.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
`
    const { code: code2 } = compile(onlyFirst)
    const container2 = await mount(code2)
    const lis2 = container2.querySelectorAll('li')
    dispatchClick(container2, lis2[0]!.querySelector('span'))
    expect([...lis2].map((li) => li.className)).toEqual(['editing', ''])
  })

  it('ネストした構造ユニットが祖先のローカルsignalに依存する場合は拒否する', () => {
    const source = `
export function App() {
  const todos = signal([{ id: 1, text: 'a' }]);
  render(
    <ul>
      {todos().map((todo) => {
        const editing = signal(false);
        return (
          <li key={todo.id}>
            {editing() ? <input /> : <span>{todo.text}</span>}
          </li>
        );
      })}
    </ul>
  );
}
`
    expect(() => compile(source)).toThrow(
      /nested structural unit depending on a local signal.*scope limit/,
    )
  })

  it('ルートsignalへの依存は引き続きscope limitで拒否する(回帰確認)', () => {
    const source = `
export function App() {
  const todos = signal([{ id: 1, text: 'a' }]);
  const filter = signal('all');
  render(
    <ul>
      {todos().map((todo) => (
        <li key={todo.id}>{filter()}</li>
      ))}
    </ul>
  );
}
`
    expect(() => compile(source)).toThrow(/scope limit/)
  })
})

function dispatch(container: Element, el: Element | null, type: string): void {
  if (!el) throw new Error('dispatch: element not found')
  const Event = (
    container.ownerDocument as unknown as {
      defaultView: { Event: typeof globalThis.Event }
    }
  ).defaultView.Event
  el.dispatchEvent(new Event(type))
}

describe('same-file-component-composition: コンポーネント参照のASTインライン化', () => {
  it('トップレベルの子コンポーネント参照を展開してコンパイル・実行できる', async () => {
    const source = `
export function App() {
  const count = signal(0);
  render(
    <div>
      <Footer count={count()} />
      <button onClick={inc}>+</button>
    </div>
  );
  function inc() { count(count() + 1); }
}

function Footer({ count }) {
  render(<span>{count} items</span>);
}
`
    const { code } = compile(source)
    expect(code).not.toContain(
      'compile: component references (<Footer/>) are not supported yet',
    )
    const container = await mount(code)
    const span = container.querySelector('span')
    expect(span?.textContent).toBe('0 items')
    dispatch(container, container.querySelector('button'), 'click')
    expect(span?.textContent).toBe('1 items')
  })

  it('シャドーイングされた同名ローカル変数(ハンドラ自身のイベント引数)は誤って置換されない', () => {
    // ADR-0009: ハンドラの第1仮引数は任意の識別子名を受理する。ここでは
    // 意図的にpropsと同名の"count"を使い、ハンドラ本体からの"count"参照が
    // props置換(プロパティ"count" -> 呼び出し元の実引数式)の対象に
    // ならず、ハンドラ自身の引数のまま残ることを検証する。
    const source = `
export function App() {
  render(<div><Foo count="caller-value" /></div>);
}
function Foo({ count }) {
  render(<span onClick={(count) => count}>{count}</span>);
}
`
    const { code } = compile(source)
    // render JSX 側のプロパティ参照は呼び出し元の実引数へ置換される。
    expect(code).toContain('caller-value')
    // ハンドラ自身のイベント引数への参照はシャドーイングされ、
    // "caller-value" へ置換されずに残る。
    expect(code).toMatch(/\(count, \.\.\.__args\) => \{ count; {1,2}\}/)
  })

  it('リストアイテムへインライン化されたTodoItemがproxy propsとローカルsignalの両方で動く', async () => {
    const source = `
export function TodoApp() {
  const todos = signal([
    { id: 1, text: 'a', completed: false },
    { id: 2, text: 'b', completed: true },
  ]);
  render(
    <ul>
      {todos().map((todo) => (
        <TodoItem todo={todo} onToggle={() => toggleTodo(todo.id)} />
      ))}
    </ul>
  );
  function toggleTodo(id) {
    todos(todos().map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)));
  }
}

function TodoItem({ todo, onToggle }) {
  const editing = signal(false);
  render(
    <li key={todo.id} class={editing() ? 'editing' : ''}>
      <input type="checkbox" checked={todo.completed} onChange={onToggle} />
      <span onDblClick={() => editing(true)}>{todo.text}</span>
    </li>
  );
}
`
    const { code } = compile(source)
    expect(code).not.toMatch(/^export let editing/m)
    const container = await mount(code)
    const lis = container.querySelectorAll('li')
    expect(lis.length).toBe(2)
    expect([...lis].map((li) => li.querySelector('span')?.textContent)).toEqual(
      ['a', 'b'],
    )
    expect(
      [...lis].map(
        (li) => (li.querySelector('input') as HTMLInputElement).checked,
      ),
    ).toEqual([false, true])

    dispatch(container, lis[0]!.querySelector('span'), 'dblclick')
    expect([...lis].map((li) => li.className)).toEqual(['editing', ''])

    dispatch(container, lis[0]!.querySelector('input'), 'change')
    expect(
      [...lis].map(
        (li) => (li.querySelector('input') as HTMLInputElement).checked,
      ),
    ).toEqual([true, true])
  })

  it('子要素を持つコンポーネント参照を拒否する', () => {
    const source = `
export function App() {
  render(<div><Wrapper><span>hi</span></Wrapper></div>);
}
function Wrapper({ children }) {
  render(<div>wrap</div>);
}
`
    expect(() => compile(source)).toThrow(/component children.*scope limit/)
  })

  it('自己再帰参照を拒否する', () => {
    const source = `
export function App() {
  render(<div><Item /></div>);
}
function Item() {
  render(<Item />);
}
`
    expect(() => compile(source)).toThrow(
      /recursive component reference "Item".*scope limit/,
    )
  })

  it('相互再帰参照を拒否する(無限展開せずに停止する)', () => {
    const source = `
export function App() {
  render(<div><A /></div>);
}
function A() {
  render(<B />);
}
function B() {
  render(<A />);
}
`
    expect(() => compile(source)).toThrow(
      /recursive component reference "A".*scope limit/,
    )
  })

  it('必須propが渡されていない場合は拒否する', () => {
    const source = `
export function App() {
  render(<div><Foo /></div>);
}
function Foo({ count }) {
  render(<span>{count}</span>);
}
`
    expect(() => compile(source)).toThrow(/missing prop "count"/)
  })

  it('shorthand以外の分割代入props(`{ count: c }`)を拒否する', () => {
    const source = `
export function App() {
  const x = signal(1);
  render(<div><Foo count={x()} /></div>);
}
function Foo({ count: c }) {
  render(<span>{c}</span>);
}
`
    expect(() => compile(source)).toThrow(/shorthand destructured props/)
  })

  it('2つの異なるコンポーネントの同名signalは衝突時のみリネームされ、独立して動く', async () => {
    const source = `
export function App() {
  render(<div><A /><B /></div>);
}
function A() {
  const count = signal(1);
  render(<span onClick={() => count(count() + 1)}>{count()}</span>);
}
function B() {
  const count = signal(2);
  render(<em onClick={() => count(count() + 1)}>{count()}</em>);
}
`
    const { code } = compile(source)
    const container = await mount(code)
    const span = container.querySelector('span')
    const em = container.querySelector('em')
    expect(span?.textContent).toBe('1')
    expect(em?.textContent).toBe('2')
    dispatch(container, span, 'click')
    expect(span?.textContent).toBe('2')
    expect(em?.textContent).toBe('2')
  })
})
