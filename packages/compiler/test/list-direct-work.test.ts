// 行の保存領域とテキスト節点を再利用し、DOM更新の通知とイベントの意味を保つ。
import { describe, expect, it } from 'vite-plus/test'
import { compile, compileSSR } from '../src/compiler.ts'
import {
  createListRuntime,
  createFlatListRecord,
  observeDomUpdates,
  reconcileList,
  updateListBinding,
  type ListItemState,
} from '../../runtime/src/index.ts'
import { createContainer, loadGenerated } from './helpers.ts'

describe('direct list work', () => {
  it('does not pass unused state to a flat factory and lazily preserves item state identity', () => {
    const container = createContainer()
    const calls: number[] = []
    const runtime = createListRuntime<number>('flat')
    function create(_value: number) {
      calls.push(arguments.length)
      return { el: container.ownerDocument.createElement('li') }
    }
    reconcileList(
      runtime,
      container,
      [1, 2],
      (value) => value,
      create,
      undefined,
      createFlatListRecord,
    )
    expect(calls).toEqual([1, 1])
    const first = runtime.items.get(1)!
    const second = runtime.items.get(2)!
    expect(Object.hasOwn(first, 'state')).toBe(false)
    expect(first.state).toBe(first.state)
    expect([first.state.listId, first.state.itemId]).toEqual(['flat', 1])
    expect(first.state.bindings).toBe(first.state.bindings)
    expect(first.state.bindings).not.toBe(second.state.bindings)
    reconcileList(
      runtime,
      container,
      [2, 1],
      (value) => value,
      create,
      () => {},
      createFlatListRecord,
    )
    expect(runtime.items.get(1)).toBe(first)
  })

  it('keeps each item binding map independent and caches an initial undefined value', () => {
    const container = createContainer()
    const states: ListItemState[] = []
    reconcileList(
      createListRuntime('list'),
      container,
      [1, 2],
      (value) => value,
      (_value, state) => {
        states.push(state)
        return { el: container.ownerDocument.createElement('div') }
      },
    )
    expect(states.map((state) => [state.listId, state.itemId])).toEqual([
      ['list', 1],
      ['list', 2],
    ])
    expect(updateListBinding(states[0]!, 'text', undefined)).toBe(true)
    expect(updateListBinding(states[0]!, 'text', undefined)).toBe(false)
    expect(updateListBinding(states[1]!, 'text', undefined)).toBe(true)
    expect(states[0]!.bindings).toBe(states[0]!.bindings)
    expect(states[0]!.bindings).not.toBe(states[1]!.bindings)
  })

  it('reuses text nodes across empty values and restores externally changed children', async () => {
    const { code } = compile(`export function App() {
      const rows = signal([{id: 1, text: 'a'}]);
      render(<ul>{rows().map((row) => <li key={row.id}><span>{row.text}</span><button onClick={() => rows([{id: 1, text: row.text === 'a' ? '' : 'a'}])}>change</button></li>)}</ul>);
    }`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (element: Element) => void)(container)
    const span = container.querySelector('span')!
    const text = span.firstChild
    const click = () =>
      container
        .querySelector('button')!
        .dispatchEvent(new container.ownerDocument.defaultView!.Event('click'))
    click()
    expect(span.textContent).toBe('')
    expect(span.firstChild).toBe(text)
    click()
    expect(span.textContent).toBe('a')
    expect(span.firstChild).toBe(text)
    span.append(container.ownerDocument.createElement('b'))
    click()
    expect(span.textContent).toBe('')
    expect(span.children).toHaveLength(0)
    click()
    expect(span.textContent).toBe('a')
  })

  it('keeps currentTarget, bubbling control, and the latest item in shared handlers', async () => {
    const mod = await loadGenerated(
      compile(`export function App() {
      const rows = signal([{id: 1, text: 'a'}]);
      const value = signal('');
      const parentClicks = signal(0);
      render(<main onClick={() => parentClicks(parentClicks() + 1)}><p>{value()}</p><output>{parentClicks()}</output>
        <ul>{rows().map((row) => <li key={row.id}><button onClick={(event) => { event.stopPropagation(); value(row.text + ':' + event.currentTarget.tagName + ':' + event.target.tagName); }}><span>click</span></button></li>)}</ul>
        <button id="replace" onClick={() => rows([{id: 1, text: 'b'}])}>replace</button>
      </main>);
    }`).code,
    )
    const container = createContainer()
    ;(mod.mountComponent as (element: Element) => void)(container)
    const click = (selector: string) =>
      container
        .querySelector(selector)!
        .dispatchEvent(new container.ownerDocument.defaultView!.Event('click', { bubbles: true }))
    const original = container.querySelector('li button')
    click('li span')
    expect(container.querySelector('p')?.textContent).toBe('a:BUTTON:SPAN')
    expect(container.querySelector('output')?.textContent).toBe('0')
    click('#replace')
    expect(container.querySelector('li button')).toBe(original)
    click('li span')
    expect(container.querySelector('p')?.textContent).toBe('b:BUTTON:SPAN')
    expect(container.querySelector('output')?.textContent).toBe('1')
  })

  it('notifies observers around a list changed through local state', async () => {
    const { code } = compile(`export function App() {
      const groups = signal([{id: 1}]);
      render(<main>{groups().map((group) => {
        const rows = signal([{id: 1, text: 'a'}]);
        return <section key={group.id}><ul>{rows().map((row) => <li key={row.id}>{row.text}</li>)}</ul>
        <button id="change" onClick={() => rows([{id: 1, text: 'b'}, {id: 2, text: 'c'}])}>change</button>
        </section>;
      })}</main>);
    }`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (element: Element) => void)(container)
    const calls: string[] = []
    const stop = observeDomUpdates({
      before: () => calls.push('before:' + container.querySelector('ul')!.textContent),
      after: () => calls.push('after:' + container.querySelector('ul')!.textContent),
    })
    try {
      container
        .querySelector('#change')!
        .dispatchEvent(new container.ownerDocument.defaultView!.Event('click'))
      expect(calls).toEqual(['before:a', 'after:bc'])
    } finally {
      stop()
    }
  })

  it('notifies observers around SSR list initialization as one transaction', async () => {
    const result = compileSSR(`export function App({ rows }) {
      render(<ul>{rows.map((row) => <li key={row.id}>{row.text}</li>)}</ul>);
    }`)
    const server = await loadGenerated(result.ssrCode!)
    const rendered = (server.render as (input: unknown) => { html: string; state: unknown })({
      rows: [
        { id: 1, text: 'a' },
        { id: 2, text: 'b' },
      ],
    })
    const client = await loadGenerated(result.code)
    const container = createContainer()
    container.innerHTML = rendered.html
    const calls: string[] = []
    const stop = observeDomUpdates({
      before: () => calls.push('before'),
      after: () => calls.push('after'),
    })
    try {
      ;(client.hydrateComponent as (element: Element, state: unknown) => unknown)(
        container,
        rendered.state,
      )
      expect(calls).toEqual(['before', 'after'])
      expect(container.textContent).toBe('ab')
    } finally {
      stop()
    }
  })
})
