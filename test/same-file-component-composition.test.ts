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
