import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

// M5(ADR-0005): リスト(`.map()`)・条件分岐(三項/`&&`)の factory-per-unit
// クロージャ実装。specs/list-conditional-rendering/spec.md の各 Scenario と
// tasks.md 3.3/4.1/4.2/6.2 に対応する。

function dispatchClick(container: Element, el: Element | null): void {
  if (!el) throw new Error('dispatchClick: element not found')
  const Event = (
    container.ownerDocument as unknown as {
      defaultView: { Event: typeof globalThis.Event }
    }
  ).defaultView.Event
  el.dispatchEvent(new Event('click'))
}

const LIST_SOURCE = `
export function App() {
  const items = signal([
    { id: 1, text: 'a' },
    { id: 2, text: 'b' },
  ]);
  render(
    <div>
      <ul>
        {items().map((item) => (
          <li key={item.id}>
            <span>{item.text}</span>
            <button class="rename" onClick={() => items(items().map((i) => (i.id === item.id ? { ...i, text: i.text + '!' } : i)))}>r</button>
            <button class="remove" onClick={() => items(items().filter((i) => i.id !== item.id))}>x</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
`

describe('M5: list rendering (keyed reuse factory)', () => {
  it('stamps items via <template>+cloneNode with no wrapper element, as direct children of <ul>', async () => {
    const { code } = compile(LIST_SOURCE)
    expect(code).toContain('.content.cloneNode(true)')
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)

    const ul = container.querySelector('ul')
    expect(ul?.children.length).toBe(2)
    expect(Array.from(ul!.children).every((c) => c.tagName === 'LI')).toBe(true)
    expect(ul?.children[0]?.querySelector('span')?.textContent).toBe('a')
    expect(ul?.children[1]?.querySelector('span')?.textContent).toBe('b')
  })

  it('reuses the DOM/handle for an existing key (value-only diff, no regen)', async () => {
    const { code } = compile(LIST_SOURCE)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)

    const firstLi = container.querySelectorAll('li')[0]!
    const secondLi = container.querySelectorAll('li')[1]!

    dispatchClick(container, firstLi.querySelector('.rename'))
    // 同じ key の item は DOM 要素が再生成されない -- 参照が同一のまま。
    expect(container.querySelectorAll('li')[0]).toBe(firstLi)
    expect(firstLi.querySelector('span')?.textContent).toBe('a!')
    expect(secondLi.querySelector('span')?.textContent).toBe('b')

    // 貼り直しされていなければ、2回目のクリックでも同じリスナーが働く。
    dispatchClick(container, firstLi.querySelector('.rename'))
    expect(firstLi.querySelector('span')?.textContent).toBe('a!!')
  })

  it('updates only the changed item binding without reordering stable DOM', async () => {
    const { code } = compile(LIST_SOURCE)
    expect(code).toContain('createListRuntime as __createListRuntime__')
    expect(code).toContain('__updateListBinding__(__item__')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)

    const ul = container.querySelector('ul')!
    const firstLi = container.querySelectorAll('li')[0]!
    const secondSpan = container.querySelectorAll('li')[1]!.querySelector('span')!
    const MutationObserver = (
      container.ownerDocument.defaultView as unknown as {
        MutationObserver: typeof globalThis.MutationObserver
      }
    ).MutationObserver
    const listObserver = new MutationObserver(() => {})
    const unchangedBindingObserver = new MutationObserver(() => {})
    listObserver.observe(ul, { childList: true })
    unchangedBindingObserver.observe(secondSpan, {
      childList: true,
      characterData: true,
      subtree: true,
    })

    dispatchClick(container, firstLi.querySelector('.rename'))

    expect(firstLi.querySelector('span')?.textContent).toBe('a!')
    expect(listObserver.takeRecords()).toHaveLength(0)
    expect(unchangedBindingObserver.takeRecords()).toHaveLength(0)
  })

  it('drops the keyed Map entry and removes the DOM element when a key leaves the array', async () => {
    const { code } = compile(LIST_SOURCE)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)

    const firstLi = container.querySelectorAll('li')[0]!
    const secondLi = container.querySelectorAll('li')[1]!

    dispatchClick(container, firstLi.querySelector('.remove'))

    expect(container.querySelectorAll('li').length).toBe(1)
    expect(container.contains(firstLi)).toBe(false)
    // 削除に無関係な key の要素・リスナーはそのまま残る。
    expect(container.querySelectorAll('li')[0]).toBe(secondLi)
    dispatchClick(container, secondLi.querySelector('.rename'))
    expect(secondLi.querySelector('span')?.textContent).toBe('b!')
  })

  it('adds a factory-created element for a new key', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1, text: 'a' }]);
  render(
    <div>
      <ul>
        {items().map((item) => (
          <li key={item.id}>{item.text}</li>
        ))}
      </ul>
      <button onClick={() => items([...items(), { id: 2, text: 'b' }])}>add</button>
    </div>
  );
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    expect(container.querySelectorAll('li').length).toBe(1)
    dispatchClick(container, container.querySelector('button'))
    expect(container.querySelectorAll('li').length).toBe(2)
    expect(container.querySelectorAll('li')[1]?.textContent).toBe('b')
  })

  it('rejects duplicate keys instead of silently collapsing items onto one DOM handle', async () => {
    const source = `
export function App() {
  const items = signal([
    { id: 1, text: 'a' },
    { id: 1, text: 'b' },
  ]);
  render(
    <ul>
      {items().map((item) => <li key={item.id}>{item.text}</li>)}
    </ul>
  );
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()

    expect(() => (mod.mountComponent as (c: Element) => void)(container)).toThrow(
      'reconcileList: duplicate key 1',
    )
  })

  it('resolves a text marker on the item root itself (no wrapping span)', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1, text: 'a' }]);
  render(
    <ul>
      {items().map((item) => (
        <li key={item.id}>{item.text}</li>
      ))}
    </ul>
  );
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    expect(container.querySelector('li')?.textContent).toBe('a')
  })

  it('does not generate an explicit teardown call for removed items', () => {
    const { code } = compile(LIST_SOURCE)
    expect(code).not.toMatch(/teardown/i)
  })
})

describe('M5: conditional rendering (&& / ternary factory)', () => {
  const LOGICAL_SOURCE = `
export function App() {
  const show = signal(true);
  render(
    <div>
      <div>{show() && <span>hello</span>}</div>
      <button onClick={() => show(!show())}>toggle</button>
    </div>
  );
}
`

  it('mounts the branch when the condition is initially true, and removes it on toggle', async () => {
    const { code } = compile(LOGICAL_SOURCE)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)

    expect(container.querySelector('span')?.textContent).toBe('hello')
    dispatchClick(container, container.querySelector('button'))
    expect(container.querySelector('span')).toBeNull()
    dispatchClick(container, container.querySelector('button'))
    expect(container.querySelector('span')?.textContent).toBe('hello')
  })

  it('switches between ternary branches', async () => {
    const source = `
export function App() {
  const cond = signal(true);
  render(
    <div>
      <div>{cond() ? <span>yes</span> : <p>no</p>}</div>
      <button onClick={() => cond(!cond())}>toggle</button>
    </div>
  );
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)

    expect(container.querySelector('span')?.textContent).toBe('yes')
    expect(container.querySelector('p')).toBeNull()
    dispatchClick(container, container.querySelector('button'))
    expect(container.querySelector('span')).toBeNull()
    expect(container.querySelector('p')?.textContent).toBe('no')
  })
})

// M5.5(change `m5-5-nested-structural-units`): 1階層ネストした構造ユニット。
// specs「ネストした構造ユニットのスコープ制限 / factory生成 / ライフサイクル」
// と「配列脱落とフィルタ除外の区別」の境界条件 Scenario に対応する。
describe('M5.5: nested structural units (1 level)', () => {
  it('compiles and renders a list nested inside a conditional branch (UNRESOLVED-06)', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1, text: 'a' }]);
  const show = signal(true);
  render(
    <div>
      <div>
        {show() && (
          <ul>{items().map((item) => <li key={item.id}>{item.text}</li>)}</ul>
        )}
      </div>
      <button class="toggle" onClick={() => show(!show())}>t</button>
      <button class="add" onClick={() => items([...items(), { id: 2, text: 'b' }])}>a</button>
    </div>
  );
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)

    expect(container.querySelectorAll('li').length).toBe(1)
    expect(container.querySelector('li')?.textContent).toBe('a')

    // ブランチがマウントされたまま内側リストが更新される(依存のバブル
    // アップ: items -> 外側条件分岐 update -> handle.update() -> keyed diff)。
    dispatchClick(container, container.querySelector('.add'))
    expect(container.querySelectorAll('li').length).toBe(2)
    expect(container.querySelectorAll('li')[1]?.textContent).toBe('b')

    // 外側条件分岐の切り替えで <ul> ごと実DOMから着脱される。
    dispatchClick(container, container.querySelector('.toggle'))
    expect(container.querySelector('ul')).toBeNull()
    dispatchClick(container, container.querySelector('.toggle'))
    expect(container.querySelectorAll('li').length).toBe(2)
  })

  it('compiles and renders a conditional nested inside a list item (UNRESOLVED-07)', async () => {
    const source = `
export function App() {
  const items = signal([
    { id: 1, text: 'a' },
    { id: 2, text: 'b' },
  ]);
  const editingId = signal(null);
  render(
    <div>
      <ul>
        {items().map((item) => (
          <li key={item.id}>
            <div>{editingId() === item.id ? <input /> : <span>{item.text}</span>}</div>
            <button class="edit" onClick={() => editingId(item.id)}>e</button>
          </li>
        ))}
      </ul>
      <button class="done" onClick={() => editingId(null)}>d</button>
      <button class="rename" onClick={() => items(items().map((i) => (i.id === 1 ? { ...i, text: 'a!' } : i)))}>r</button>
    </div>
  );
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)

    const lis = container.querySelectorAll('li')
    expect(lis.length).toBe(2)
    expect(lis[0]?.querySelector('span')?.textContent).toBe('a')
    expect(container.querySelector('input')).toBeNull()

    // 内側条件分岐がアイテムごとに独立して切り替わる(specs「リストアイテム
    // 内の条件分岐のfactory生成」)。
    dispatchClick(container, lis[0]!.querySelector('.edit'))
    expect(lis[0]?.querySelector('input')).not.toBeNull()
    expect(lis[0]?.querySelector('span')).toBeNull()
    expect(lis[1]?.querySelector('span')?.textContent).toBe('b')

    // 選択が変わらない間のテキスト再描画は handle.update() 経由で届く
    // (item 1 は編集中 = input ブランチのまま、item 2 の span は残る)。
    dispatchClick(container, container.querySelector('.rename'))
    expect(lis[0]?.querySelector('input')).not.toBeNull()

    dispatchClick(container, container.querySelector('.done'))
    expect(container.querySelector('input')).toBeNull()
    expect(lis[0]?.querySelector('span')?.textContent).toBe('a!')
  })

  it('destroys the inner keyed Map when the outer conditional unmounts the list (spec boundary)', async () => {
    const source = `
export function App() {
  const todos = signal([{ id: 1, text: 'a', done: false }]);
  const visible = derived(() => todos().filter((t) => !t.done));
  render(
    <div>
      <div>
        {visible().length > 0 && (
          <ul>{visible().map((t) => <li key={t.id}>{t.text}</li>)}</ul>
        )}
      </div>
      <button class="hide" onClick={() => todos(todos().map((t) => ({ ...t, done: true })))}>h</button>
      <button class="show" onClick={() => todos(todos().map((t) => ({ ...t, done: false })))}>s</button>
    </div>
  );
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)

    const originalLi = container.querySelector('li')
    expect(originalLi?.textContent).toBe('a')

    // 可視集合が全件0 -> 外側条件分岐がリスト全体を非マウントにする。
    dispatchClick(container, container.querySelector('.hide'))
    expect(container.querySelector('ul')).toBeNull()

    // 再マウント時、keyed Map は破棄済みなので同じ key でも要素は再生成
    // される(specs「外側条件分岐によるリスト全体の非マウント」: 保持保証は
    // 及ばない)。
    dispatchClick(container, container.querySelector('.show'))
    const remountedLi = container.querySelector('li')
    expect(remountedLi?.textContent).toBe('a')
    expect(remountedLi).not.toBe(originalLi as Element)
  })

  it('rejects a structural unit nested 2 levels deep (scope limit)', () => {
    const source = `
export function App() {
  const items = signal([{ id: 1, ok: true, xs: [1] }]);
  render(
    <ul>
      {items().map((item) => (
        <li key={item.id}>
          <div>
            {item.ok && (
              <ol>{item.xs.map((x) => <li key={x}>{x}</li>)}</ol>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
`
    expect(() => compile(source)).toThrow(/exceeds 1 level of nesting.*scope limit/)
  })
})

describe('M5: structural unit scope limits', () => {
  it('rejects a list item missing a `key` attribute', () => {
    const source = `
export function App() {
  const items = signal([{ id: 1, text: 'a' }]);
  render(<ul>{items().map((item) => <li>{item.text}</li>)}</ul>);
}
`
    expect(() => compile(source)).toThrow(/key.*scope limit/s)
  })

  it('rejects a tracked signal referenced inside a list item body', () => {
    const source = `
export function App() {
  const items = signal([{ id: 1 }]);
  const label = signal('x');
  render(<ul>{items().map((item) => <li key={item.id}>{label()}</li>)}</ul>);
}
`
    expect(() => compile(source)).toThrow(/referencing a tracked signal.*scope limit/)
  })

  it('rejects list/conditional rendering mixed with sibling children', () => {
    const source = `
export function App() {
  const items = signal([]);
  render(
    <div>
      <span>a</span>
      {items().map((item) => <li key={item.id}>{item.id}</li>)}
    </div>
  );
}
`
    expect(() => compile(source)).toThrow(/sole child.*scope limit/)
  })
})
