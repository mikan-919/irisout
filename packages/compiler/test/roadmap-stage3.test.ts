import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

function click(container: Element, selector: string): void {
  const element = container.querySelector(selector) as HTMLElement | null
  if (!element) throw new Error(`element not found: ${selector}`)
  element.click()
}

describe('roadmap stage 3: derived chains', () => {
  it('recomputes a derived chain in dependency order after multiple input writes', async () => {
    const source = `
export function App() {
  const text = signal('a bb');
  const words = derived(() => text().split(' '));
  const wordCount = derived(() => words().length);
  const left = signal(1);
  const right = signal(2);
  const total = derived(() => left() + right());
  const doubled = derived(() => total() * 2);
  render(
    <main>
      <p class="words">{words().join('|')}</p>
      <p class="count">{wordCount()}</p>
      <p class="total">{doubled()}</p>
      <button onClick={() => { text('a bb ccc'); left(3); right(4); }}>update</button>
    </main>
  );
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => unknown)(container)

    expect(container.querySelector('.words')?.textContent).toBe('a|bb')
    expect(container.querySelector('.count')?.textContent).toBe('2')
    expect(container.querySelector('.total')?.textContent).toBe('6')

    click(container, 'button')
    expect(container.querySelector('.words')?.textContent).toBe('a|bb|ccc')
    expect(container.querySelector('.count')?.textContent).toBe('3')
    expect(container.querySelector('.total')?.textContent).toBe('14')
  })

  it('rejects a cycle in the derived dependency graph', () => {
    const source = `
export function App() {
  const first = derived(() => second());
  const second = derived(() => first());
  render(<div>{first()}</div>);
}
`
    expect(() => compile(source)).toThrow(/derived dependency cycle/)
  })
})

describe('roadmap stage 3: root state in structural units', () => {
  it('updates root references in list and conditional branches, including inlined props', async () => {
    const source = `
function Label({ label }) {
  render(<span class="label">{label}</span>);
}
export function App() {
  const mode = signal('short');
  const selected = signal(1);
  const visible = signal(true);
  const items = signal([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
  render(
    <main>
      <button class="mode" onClick={() => mode(mode() === 'short' ? 'long' : 'short')}>mode</button>
      <button class="selected" onClick={() => selected(selected() === 1 ? 2 : 1)}>selected</button>
      <button class="visible" onClick={() => visible(!visible())}>visible</button>
      <ul>{items().map((item) => <li key={item.id} class={selected() === item.id ? 'selected' : ''}>{mode()}:{item.name}</li>)}</ul>
      <div>{visible() ? <Label label={mode()} /> : <p class="hidden">hidden</p>}</div>
    </main>
  );
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => unknown)(container)

    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'short:a',
      'short:b',
    ])
    expect([...container.querySelectorAll('li')].map((li) => li.className)).toEqual([
      'selected',
      '',
    ])
    expect(container.querySelector('.label')?.textContent).toBe('short')

    click(container, '.mode')
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'long:a',
      'long:b',
    ])
    expect(container.querySelector('.label')?.textContent).toBe('long')

    click(container, '.selected')
    expect([...container.querySelectorAll('li')].map((li) => li.className)).toEqual([
      '',
      'selected',
    ])

    click(container, '.visible')
    expect(container.querySelector('.label')).toBeNull()
    expect(container.querySelector('.hidden')?.textContent).toBe('hidden')

    click(container, '.visible')
    expect(container.querySelector('.label')?.textContent).toBe('long')
  })
})

describe('roadmap stage 3: stateful conditional child ownership', () => {
  it('creates, updates, and destroys each conditional child instance', async () => {
    ;(
      globalThis as typeof globalThis & { __irisoutStage3Lifecycle?: string[] }
    ).__irisoutStage3Lifecycle = []
    const source = `
function Detail() {
  const expanded = signal(false);
  render(<article><button class="expand" onClick={() => expanded(!expanded())}>{expanded() ? 'open' : 'closed'}</button></article>);
  onMount(() => {
    globalThis.__irisoutStage3Lifecycle.push('mount');
    return () => { globalThis.__irisoutStage3Lifecycle.push('destroy'); };
  });
}
export function App() {
  const show = signal(false);
  render(<main><button class="toggle" onClick={() => show(!show())}>toggle</button>{show() ? <Detail /> : <span class="empty">empty</span>}</main>);
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => unknown)(container)

    expect(container.querySelector('.empty')).not.toBeNull()
    click(container, '.toggle')
    expect(container.querySelector('.expand')?.textContent).toBe('closed')
    click(container, '.expand')
    expect(container.querySelector('.expand')?.textContent).toBe('open')

    click(container, '.toggle')
    expect(container.querySelector('.empty')).not.toBeNull()
    click(container, '.toggle')
    expect(container.querySelector('.expand')?.textContent).toBe('closed')

    const lifecycle = (globalThis as typeof globalThis & { __irisoutStage3Lifecycle: string[] })
      .__irisoutStage3Lifecycle
    expect(lifecycle).toEqual(['mount', 'destroy', 'mount'])
  })
})
