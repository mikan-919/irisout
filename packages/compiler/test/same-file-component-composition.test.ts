import { describe, expect, it } from 'vite-plus/test'
import { parse } from '@babel/parser'
import { collectTopLevelComponents } from '../src/compiler/inline-components.js'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

// same-file-component-composition (ADR-0014): 同一ファイル内の
// <Component/> 参照をコンパイル時ASTインライン化する。この test では
// まずローカルsignal(構造ユニットへインライン化された変数ゾーン宣言、
// design.md D5/D6)を、コンポーネント合成の前段としてリスト item の
// block body 直書きで検証する ― `.map()` アイテムの arrow 本体が
// bare JSX に加えてブロック本体も受理するようになったのは、インライン化
// パスがコンポーネントの変数ゾーンをこの形へ展開するため。

function dispatch(container: Element, el: Element | null, type: string): void {
  if (!el) throw new Error('dispatch: element not found')
  const Event = (
    container.ownerDocument as unknown as {
      defaultView: { Event: typeof globalThis.Event }
    }
  ).defaultView.Event
  el.dispatchEvent(new Event(type))
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
    dispatch(container, lis[0]!.querySelector('span'), 'click')
    expect([...lis].map((li) => li.className)).toEqual(['editing', ''])
  })

  it('アイテムごとにローカルsignalが独立している(1件のトグルが他に影響しない)', async () => {
    const { code } = compile(TODO_SOURCE)
    const container = await mount(code)
    const lis = container.querySelectorAll('li')
    dispatch(container, lis[0]!.querySelector('span'), 'click')
    dispatch(container, lis[1]!.querySelector('span'), 'click')
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
    dispatch(container2, lis2[0]!.querySelector('span'), 'click')
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

describe('collectTopLevelComponents', () => {
  it('複数コンポーネントが宣言されたソースから正しい名前→NodePath表が得られる(task 1.2)', () => {
    const source = `
export function App() {
  render(<div><Foo /></div>);
}
function Foo() {
  render(<span>foo</span>);
}
function Bar() {
  render(<span>bar</span>);
}
`
    const ast = parse(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    })
    const table = collectTopLevelComponents(ast)
    expect([...table.keys()].sort()).toEqual(['App', 'Bar', 'Foo'])
    expect(table.get('App')!.node.id?.name).toBe('App')
    expect(table.get('Foo')!.node.id?.name).toBe('Foo')
    expect(table.get('Bar')!.node.id?.name).toBe('Bar')
  })
})

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
    expect(code).not.toContain('compile: component references (<Footer/>) are not supported yet')
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
    expect([...lis].map((li) => li.querySelector('span')?.textContent)).toEqual(['a', 'b'])
    expect([...lis].map((li) => (li.querySelector('input') as HTMLInputElement).checked)).toEqual([
      false,
      true,
    ])

    dispatch(container, lis[0]!.querySelector('span'), 'dblclick')
    expect([...lis].map((li) => li.className)).toEqual(['editing', ''])

    dispatch(container, lis[0]!.querySelector('input'), 'change')
    expect([...lis].map((li) => (li.querySelector('input') as HTMLInputElement).checked)).toEqual([
      true,
      true,
    ])
  })

  it('apps/examples/todomvc.jsxのTodoItem相当: propが直接ハンドラ参照のまま素通しされ、コミット+編集終了+削除が動く', async () => {
    // apps/examples/todomvc.jsx のTodoItemと同じ構造(propをこのコンポーネント
    // 自身の文で包まず、ハンドラ属性値としてそのまま素通しする形)。
    // `(e) => { onCommitEdit(...); ...; }`のように追加の文で包むと
    // 置換後の呼び出しがソース位置ベースの書き換え検出に乗らない
    // (実装前調査で確認した既知の制約、apps/examples/todomvc.jsx参照)。
    const source = `
export function TodoApp() {
  const todos = signal([{ id: 1, text: 'a', completed: false }]);
  render(
    <ul>
      {todos().map((todo) => (
        <TodoItem
          todo={todo}
          onCommitEdit={(e) => e.key === 'Enter' && commitEdit(todo.id, e.target.value)}
          onRemove={() => removeTodo(todo.id)}
        />
      ))}
    </ul>
  );
  function commitEdit(id, text) {
    const t = text.trim();
    if (t !== '') {
      todos(todos().map((x) => (x.id === id ? { ...x, text: t } : x)));
    }
  }
  function removeTodo(id) {
    todos(todos().filter((t) => t.id !== id));
  }
}

function TodoItem({ todo, onCommitEdit, onRemove }) {
  const editing = signal(false);
  render(
    <li key={todo.id} class={editing() ? 'editing' : ''}>
      <span onDblClick={() => editing(true)}>{todo.text}</span>
      <input value={todo.text} onKeyDown={onCommitEdit} onBlur={() => editing(false)} />
      <button type='button' onClick={onRemove}>x</button>
    </li>
  );
}
`
    const { code } = compile(source)
    expect(code).toContain('commitEdit(todo.id, e.target.value)')
    const container = await mount(code)
    const li = container.querySelector('li')!

    dispatch(container, li.querySelector('span'), 'dblclick')
    expect(li.className.trim()).toBe('editing')

    const editInput = li.querySelector('input') as HTMLInputElement
    editInput.value = 'edited'
    const KeyboardEvent = (
      container.ownerDocument as unknown as {
        defaultView: { KeyboardEvent: typeof globalThis.KeyboardEvent }
      }
    ).defaultView.KeyboardEvent
    editInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(li.querySelector('span')?.textContent).toBe('edited')

    dispatch(container, editInput, 'blur')
    expect(li.className.trim()).toBe('')

    dispatch(container, li.querySelector('button'), 'click')
    expect(container.querySelectorAll('li').length).toBe(0)
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
    expect(() => compile(source)).toThrow(/recursive component reference "Item".*scope limit/)
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
    expect(() => compile(source)).toThrow(/recursive component reference "A".*scope limit/)
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

  it('2つの異なるコンポーネントの同名動きゾーン関数は衝突時のみリネームされ、両方が独立して動く', async () => {
    const source = `
export function App() {
  render(<div><A /><B /></div>);
}
function A() {
  const count = signal(0);
  render(<span onClick={() => inc()}>{count()}</span>);
  function inc() { count(count() + 1); }
}
function B() {
  const count = signal(0);
  render(<em onClick={() => inc()}>{count()}</em>);
  function inc() { count(count() + 1); }
}
`
    const { code } = compile(source)
    expect(code).toContain('function inc()')
    expect(code).toContain('function B_inc()')
    const container = await mount(code)
    const span = container.querySelector('span')
    const em = container.querySelector('em')
    dispatch(container, em, 'click')
    expect(span?.textContent).toBe('0')
    expect(em?.textContent).toBe('1')
  })

  it('ローカル状態を持つコンポーネントを条件分岐ブランチへインライン化することは拒否する', () => {
    // ローカルsignalの受け皿はlist itemのみ(design.md参照、三項/`&&`の
    // 式位置はブロック文を構文的に置けないため)。変数ゾーン宣言を持つ
    // コンポーネントが条件分岐ブランチに来た場合、ルートスコープへ黙って
    // 昇格させると本来インスタンスごとのはずの状態がモジュールスコープで
    // 共有されてしまうため、明示的に拒否する。
    const source = `
export function App() {
  const show = signal(true);
  render(<div>{show() ? <Foo /> : <span>none</span>}</div>);
}
function Foo() {
  const count = signal(0);
  render(<button onClick={() => count(count() + 1)}>click</button>);
}
`
    expect(() => compile(source)).toThrow(
      /variable-zone declarations into a conditional branch.*scope limit/,
    )
  })

  it('状態を持たないコンポーネントを条件分岐ブランチへインライン化するのは許可する(回帰確認)', async () => {
    const source = `
export function App() {
  const show = signal(true);
  render(<div>{show() ? <Foo label="hi" /> : <span>none</span>}</div>);
}
function Foo({ label }) {
  render(<span>{label}</span>);
}
`
    const { code } = compile(source)
    const container = await mount(code)
    expect(container.querySelector('span')?.textContent).toBe('hi')
  })

  it('spread props(`{...props}`)を拒否する', () => {
    const source = `
export function App() {
  const p = signal({ count: 1 });
  render(<div><Foo {...p()} /></div>);
}
function Foo({ count }) {
  render(<span>{count}</span>);
}
`
    expect(() => compile(source)).toThrow(/spread props.*scope limit/)
  })

  it('複数の仮引数を取るコンポーネントを拒否する', () => {
    const source = `
export function App() {
  render(<div><Foo a="1" b="2" /></div>);
}
function Foo(a, b) {
  render(<span>{a}</span>);
}
`
    expect(() => compile(source)).toThrow(/single destructured parameter.*scope limit/)
  })

  it('動きゾーン関数を持つコンポーネントをリストアイテムへインライン化することは拒否する', () => {
    const source = `
export function App() {
  const todos = signal([{ id: 1 }]);
  render(
    <ul>
      {todos().map((todo) => (
        <Item todo={todo} />
      ))}
    </ul>
  );
}
function Item({ todo }) {
  render(<li key={todo.id} onClick={helper}>{todo.id}</li>);
  function helper() {}
}
`
    expect(() => compile(source)).toThrow(/its own handler functions into a list item.*scope limit/)
  })

  it('リストアイテムのブロック本体でsignal/derived宣言以外の文を拒否する', () => {
    const source = `
export function App() {
  const todos = signal([{ id: 1 }]);
  render(
    <ul>
      {todos().map((todo) => {
        console.log(todo);
        return <li key={todo.id}>{todo.id}</li>;
      })}
    </ul>
  );
}
`
    expect(() => compile(source)).toThrow(
      /only signal\(\)\/derived\(\) declarations are allowed before the return.*scope limit/,
    )
  })

  it('rest要素を含む分割代入props(`{ count, ...rest }`)を拒否する', () => {
    const source = `
export function App() {
  render(<div><Foo count="1" /></div>);
}
function Foo({ count, ...rest }) {
  render(<span>{count}</span>);
}
`
    expect(() => compile(source)).toThrow(/shorthand destructured props/)
  })

  it('サポート外のprop値の形(JSX要素をそのままpropに渡す)を拒否する', () => {
    const source = `
export function App() {
  render(<div><Foo label=<span>hi</span> /></div>);
}
function Foo({ label }) {
  render(<span>{label}</span>);
}
`
    expect(() => compile(source)).toThrow(/unsupported prop value form/)
  })

  it('値なしのboolean-shorthand prop(`<Foo enabled />`)をtrueとして扱う', async () => {
    const source = `
export function App() {
  render(<div><Foo enabled /></div>);
}
function Foo({ enabled }) {
  render(<span>{enabled ? 'on' : 'off'}</span>);
}
`
    const { code } = compile(source)
    const container = await mount(code)
    expect(container.querySelector('span')?.textContent).toBe('on')
    expect(code).not.toContain('enabled ?')
  })

  it('明示的な値を持つboolean prop(`<Foo enabled={true} />`)はトップレベル位置で渡せる', async () => {
    const source = `
export function App() {
  render(<div><Foo enabled={true} /></div>);
}
function Foo({ enabled }) {
  render(<span>{enabled}</span>);
}
`
    const { code } = compile(source)
    const container = await mount(code)
    expect(container.querySelector('span')?.textContent).toBe('true')
  })

  it('別名で渡されたpropを三項演算子の内部で置換して実行できる', async () => {
    const source = `
export function App() {
  const flag = signal(true);
  render(<div><Foo enabled={flag()} /></div>);
}
function Foo({ enabled }) {
  render(<span>{enabled ? 'on' : 'off'}</span>);
}
`
    const { code } = compile(source)
    const container = await mount(code)
    expect(container.querySelector('span')?.textContent).toBe('on')
    expect(code).not.toContain('enabled ?')
  })

  it('別名で渡されたpropをリストアイテム内のメンバー式で置換して実行できる', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1, done: true }]);
  render(
    <ul>
      {items().map((t) => (
        <Foo item={t} />
      ))}
    </ul>
  );
}
function Foo({ item }) {
  render(<li key={item.id}>{item.done ? 'y' : 'n'}</li>);
}
`
    const { code } = compile(source)
    const container = await mount(code)
    expect(container.querySelector('li')?.textContent).toBe('y')
    expect(code).not.toContain('item.done')
    expect(code).not.toContain('item.id')
  })

  it('メンバー式・添字式・呼び出し式の実引数をASTから置換して実行できる', async () => {
    const source = `
export function App() {
  const items = signal([{ done: false }, { done: true }]);
  const index = signal(1);
  const getValue = signal(41);
  render(<div><Foo item={items()[index()]} value={getValue()} /></div>);
}
function Foo({ item, value }) {
  render(<span>{item.done ? String(value + 1) : 0}</span>);
}
`
    const { code } = compile(source)
    const container = await mount(code)
    expect(container.querySelector('span')?.textContent).toBe('42')
    expect(code).not.toContain('item.done')
    expect(code).not.toContain('value + 1')
  })

  it('置換後のpropsをハンドラ式の内部で使える', async () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<Foo enabled={true} count={count()} onActivate={() => count(count() + 1)} />);
}
function Foo({ enabled, count, onActivate }) {
  render(
    <button onClick={() => enabled ? onActivate() : null}>
      {enabled ? count : 0}
    </button>
  );
}
`
    const { code } = compile(source)
    const container = await mount(code)
    const button = container.querySelector('button')
    expect(button?.textContent).toBe('0')
    dispatch(container, button, 'click')
    expect(button?.textContent).toBe('1')
    expect(code).not.toContain('enabled ?')
    expect(code).not.toContain('onActivate()')
  })

  it('置換後のpropsをブロック形式ハンドラの式内部で使える', async () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<Foo enabled={true} count={count()} onActivate={() => count(count() + 1)} />);
}
function Foo({ enabled, count, onActivate }) {
  render(
    <button onClick={(event) => { if (enabled) onActivate(event); }}>
      {count}
    </button>
  );
}
`
    const { code } = compile(source)
    const container = await mount(code)
    const button = container.querySelector('button')
    expect(button?.textContent).toBe('0')
    dispatch(container, button, 'click')
    expect(button?.textContent).toBe('1')
    expect(code).not.toContain('if (enabled)')
    expect(code).not.toContain('onActivate(event)')
  })

  it('置換後のpropsをaction本体の式内部で使える', async () => {
    const source = `
export function App() {
  const count = signal(0);
  render(
    <div>
      <span>{count()}</span>
      <Foo enabled onActivate={() => count(count() + 1)} />
    </div>
  );
}
function Foo({ enabled, onActivate }) {
  render(<button use={() => { if (enabled) onActivate(); }}>activate</button>);
}
`
    const { code } = compile(source)
    const container = await mount(code)
    expect(container.querySelector('span')?.textContent).toBe('1')
    expect(code).not.toContain('if (enabled)')
    expect(code).not.toContain('onActivate()')
  })

  it('インライン化後も静的兄弟とリストを同じ親へ配置できる', async () => {
    const source = `
export function App() {
  const todos = signal([{ id: 1 }]);
  render(
    <div>
      <Foo />
      {todos().map((t) => <span key={t.id}>{t.id}</span>)}
    </div>
  );
}
function Foo() {
  render(<span>hi</span>);
}
`
    const { code, initialHtml } = compile(source)
    expect(initialHtml).toContain('<span>hi</span>')
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    expect(container.querySelector('span')?.textContent).toBe('hi')
    expect(container.querySelectorAll('span')).toHaveLength(2)
    expect(container.querySelector('span + span')?.textContent).toBe('1')
  })
})
