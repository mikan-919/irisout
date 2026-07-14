import { describe, expect, it } from 'bun:test'
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

describe('M5: nested structural unit scope limit (design.md Decision 1)', () => {
  it('rejects a list item missing a `key` attribute', () => {
    const source = `
export function App() {
  const items = signal([{ id: 1, text: 'a' }]);
  render(<ul>{items().map((item) => <li>{item.text}</li>)}</ul>);
}
`
    expect(() => compile(source)).toThrow(/key.*scope limit/s)
  })

  it('rejects a list nested inside a conditional branch (UNRESOLVED-06)', () => {
    const source = `
export function App() {
  const items = signal([]);
  const show = signal(true);
  render(
    <div>
      <div>
        {show() && (
          <ul>{items().map((item) => <li key={item.id}>{item.id}</li>)}</ul>
        )}
      </div>
    </div>
  );
}
`
    expect(() => compile(source)).toThrow(
      /nested list\/conditional.*scope limit/,
    )
  })

  it('rejects a conditional nested inside a list item body (UNRESOLVED-07)', () => {
    const source = `
export function App() {
  const items = signal([{ id: 1, editing: true }]);
  render(
    <ul>
      {items().map((item) => (
        <li key={item.id}>{item.editing && <span>editing</span>}</li>
      ))}
    </ul>
  );
}
`
    expect(() => compile(source)).toThrow(
      /nested list\/conditional.*scope limit/,
    )
  })

  it('rejects a tracked signal referenced inside a list item body', () => {
    const source = `
export function App() {
  const items = signal([{ id: 1 }]);
  const label = signal('x');
  render(<ul>{items().map((item) => <li key={item.id}>{label()}</li>)}</ul>);
}
`
    expect(() => compile(source)).toThrow(
      /referencing a tracked signal.*scope limit/,
    )
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
