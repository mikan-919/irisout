import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

// ADR-0012: 動的属性バインディング(UNRESOLVED 02/03 の解消)。
// specs/dynamic-attribute-bindings/spec.md の各 Scenario に対応。

function dispatch(container: Element, el: Element | null, type: string): void {
  if (!el) throw new Error(`dispatch: element not found for "${type}"`)
  const Event = (
    container.ownerDocument as unknown as {
      defaultView: { Event: typeof globalThis.Event }
    }
  ).defaultView.Event
  el.dispatchEvent(new Event(type))
}

describe('ADR-0012: dynamic attribute bindings', () => {
  it('bakes the initial value of a dynamic class and updates it via setAttribute', async () => {
    const source = `export function App() {
      const done = signal(false);
      render(
        <div>
          <p class={done() ? 'completed' : 'open'}>task</p>
          <button onClick={() => done(true)}>x</button>
        </div>
      );
    }`
    const { code, initialHtml } = compile(source)
    expect(initialHtml).toContain('class="open"')
    expect(code).toContain('setAttribute("class"')
    expect(code).not.toContain('signal(')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const p = container.querySelector('p')!
    expect(p.getAttribute('class')).toBe('open')
    dispatch(container, container.querySelector('button'), 'click')
    expect(p.getAttribute('class')).toBe('completed')
  })

  it('bakes checked as presence and updates it as a DOM property', async () => {
    const source = `export function App() {
      const on = signal(false);
      render(
        <div>
          <input type="checkbox" checked={on()} />
          <button onClick={() => on(true)}>t</button>
        </div>
      );
    }`
    const { code, initialHtml } = compile(source)
    // 初期 false → presence 属性なし
    expect(initialHtml).not.toContain('checked')
    expect(code).toContain('.checked = ')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.checked).toBe(false)
    dispatch(container, container.querySelector('button'), 'click')
    expect(input.checked).toBe(true)
  })

  it('bakes checked presence when the initial value is true', () => {
    const source = `export function App() {
      const on = signal(true);
      render(<div><input type="checkbox" checked={on()} /></div>);
    }`
    const { initialHtml } = compile(source)
    expect(initialHtml).toContain('<input type="checkbox" checked')
  })

  it('escapes baked attribute values (quotes and ampersands)', () => {
    const source = `export function App() {
      const title = signal('a"&b');
      render(<div title={title()}></div>);
    }`
    const { initialHtml } = compile(source)
    expect(initialHtml).toContain('title="a&quot;&amp;b"')
  })

  it('updates item-scoped class/checked through keyed reuse', async () => {
    const source = `export function App() {
      const todos = signal([
        { id: 1, text: 'a', done: false },
        { id: 2, text: 'b', done: true },
      ]);
      render(
        <div>
          <ul>
            {todos().map((todo) => (
              <li key={todo.id} class={todo.done ? 'completed' : ''}>
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() => todos(todos().map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)))}
                />
                <span>{todo.text}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    }`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)

    const lis = container.querySelectorAll('li')
    expect(lis.length).toBe(2)
    const firstLi = lis[0] as HTMLElement
    const firstBox = firstLi.querySelector('input') as HTMLInputElement
    expect(firstLi.getAttribute('class')).toBe('')
    expect(firstBox.checked).toBe(false)
    expect((lis[1] as HTMLElement).getAttribute('class')).toBe('completed')

    // keyed reuse: 同一 DOM 要素のまま属性/プロパティが追随する
    dispatch(container, firstBox, 'change')
    expect(container.querySelectorAll('li')[0] as HTMLElement).toBe(firstLi)
    expect(firstLi.getAttribute('class')).toBe('completed')
    expect(firstBox.checked).toBe(true)
  })

  it('updates an item-scoped attribute expression referencing a root signal', async () => {
    const source = `export function App() {
      const mode = signal(1);
      const items = signal([{ id: 1 }]);
      render(
        <div>
          <button onClick={() => mode(mode() + 1)}>next</button>
          <ul>
            {items().map((item) => (
              <li key={item.id} class={mode() === item.id ? 'a' : ''}><span>x</span></li>
            ))}
          </ul>
        </div>
      );
    }`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => unknown)(container)
    expect(container.querySelector('li')?.className).toBe('a')
    dispatch(container, container.querySelector('button'), 'click')
    expect(container.querySelector('li')?.className).toBe('')
  })

  it('wires handlers on a unit-host element instead of dropping them silently', async () => {
    const source = `export function App() {
      const items = signal([{ id: 1, t: 'a' }]);
      render(
        <div>
          <p>{items().length}</p>
          <ul onClick={() => items([])}>
            {items().map((i) => (
              <li key={i.id}><span>{i.t}</span></li>
            ))}
          </ul>
        </div>
      );
    }`
    const { code } = compile(source)
    expect(code).toContain('addEventListener("click"')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    expect(container.querySelectorAll('li').length).toBe(1)
    dispatch(container, container.querySelector('ul'), 'click')
    expect(container.querySelectorAll('li').length).toBe(0)
    expect(container.querySelector('p')?.textContent).toBe('0')
  })

  it('binds an input value to a signal and updates the signal from input events', async () => {
    const source = `export function App() {
      const text = signal('start');
      render(
        <main>
          <input bind:value={text} />
          <p>{text()}</p>
        </main>
      );
    }`
    const { code, initialHtml } = compile(source)
    expect(initialHtml).toContain('value="start"')
    expect(code).toContain('addEventListener("input"')
    expect(code).toContain('text = event.currentTarget.value')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('start')
    expect(container.querySelector('p')?.textContent).toBe('start')

    input.value = 'changed'
    dispatch(container, input, 'input')
    expect(input.value).toBe('changed')
    expect(container.querySelector('p')?.textContent).toBe('changed')
  })

  it('rejects bind:value on unsupported targets and conflicting attributes', () => {
    expect(() =>
      compile(`export function App() {
        const text = signal('start');
        render(<div bind:value={text}></div>);
      }`),
    ).toThrow(/bind:value.*input, select, and textarea.*scope limit/)
    expect(() =>
      compile(`export function App() {
        const text = signal('start');
        render(<input bind:value={text()} />);
      }`),
    ).toThrow(/bind:value.*signal identifier.*scope limit/)
    expect(() =>
      compile(`export function App() {
        const text = signal('start');
        render(<input bind:value={text} onInput={() => text('next')} />);
      }`),
    ).toThrow(/bind:value.*onInput.*scope limit/)
  })

  it('keeps bind:value local to each keyed item factory', async () => {
    const source = `export function App() {
      const items = signal([{ id: 1, text: 'a' }, { id: 2, text: 'b' }]);
      render(
        <ul>
          {items().map((item) => {
            const draft = signal(item.text);
            return <li key={item.id}><input bind:value={draft} /><span>{draft()}</span></li>;
          })}
        </ul>
      );
    }`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const inputs = [...container.querySelectorAll('input')] as HTMLInputElement[]
    const spans = [...container.querySelectorAll('span')]
    expect(inputs.map((input) => input.value)).toEqual(['a', 'b'])
    expect(spans.map((span) => span.textContent)).toEqual(['a', 'b'])

    inputs[0]!.value = 'changed'
    dispatch(container, inputs[0]!, 'input')
    expect(inputs.map((input) => input.value)).toEqual(['changed', 'b'])
    expect(spans.map((span) => span.textContent)).toEqual(['changed', 'b'])
  })
})
