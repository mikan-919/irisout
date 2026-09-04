import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

const INSTANCE_SOURCE = `
export function App() {
  const count = signal(0);
  const doubled = derived(() => count() * 2);
  const show = signal(true);
  const items = signal([{ id: 1, text: 'a' }]);
  render(
    <section class={count() % 2 ? 'odd' : 'even'}>
      <span class="count">{count() + doubled()}</span>
      <button class="increment" onClick={() => count(count() + 1)}>increment</button>
      <button class="toggle" onClick={() => show(!show())}>toggle</button>
      <button class="add" onClick={() => items([...items(), { id: items().length + 1, text: 'b' }])}>add</button>
      <div>{show() && <strong>shown</strong>}</div>
      <ul>{items().map((item) => <li key={item.id}>{item.text}</li>)}</ul>
    </section>
  );
}
`

function click(container: Element, selector: string): void {
  const element = container.querySelector(selector) as HTMLElement | null
  if (!element) throw new Error(`element not found: ${selector}`)
  element.click()
}

function expectInitial(container: Element): void {
  expect(container.querySelector('.count')?.textContent).toBe('0')
  expect(container.querySelector('section')?.getAttribute('class')).toBe('even')
  expect(container.querySelector('strong')?.textContent).toBe('shown')
  expect(container.querySelectorAll('li')).toHaveLength(1)
}

describe('component instance boundary', () => {
  it('creates independent state, markers, List runtime, and conditional state for every mount', async () => {
    const { code } = compile(INSTANCE_SOURCE)
    const mod = await loadGenerated(code)
    const first = createContainer()
    const second = createContainer()

    const firstInstance = (mod.mountComponent as (container: Element) => unknown)(first)
    const secondInstance = (mod.mountComponent as (container: Element) => unknown)(second)

    expect(firstInstance).not.toBe(secondInstance)
    expectInitial(first)
    expectInitial(second)

    click(first, '.increment')
    expect(first.querySelector('.count')?.textContent).toBe('3')
    expect(first.querySelector('section')?.getAttribute('class')).toBe('odd')
    expect(second.querySelector('.count')?.textContent).toBe('0')
    expect(second.querySelector('section')?.getAttribute('class')).toBe('even')

    click(first, '.toggle')
    expect(first.querySelector('strong')).toBeNull()
    expect(second.querySelector('strong')?.textContent).toBe('shown')

    click(first, '.add')
    expect(first.querySelectorAll('li')).toHaveLength(2)
    expect(second.querySelectorAll('li')).toHaveLength(1)

    click(second, '.increment')
    expect(first.querySelector('.count')?.textContent).toBe('3')
    expect(second.querySelector('.count')?.textContent).toBe('3')
  })

  it('creates independent instances when the same generated module hydrates two roots', async () => {
    const { code, initialHtml } = compile(INSTANCE_SOURCE)
    const first = createContainer()
    const second = createContainer()
    first.innerHTML = initialHtml
    second.innerHTML = initialHtml

    const mod = await loadGenerated(code)
    const firstInstance = (mod.hydrateComponent as (container: Element) => unknown)(first)
    const secondInstance = (mod.hydrateComponent as (container: Element) => unknown)(second)

    expect(firstInstance).not.toBe(secondInstance)
    expectInitial(first)
    expectInitial(second)

    click(first, '.increment')
    click(first, '.add')
    expect(first.querySelector('.count')?.textContent).toBe('3')
    expect(first.querySelectorAll('li')).toHaveLength(2)
    expect(second.querySelector('.count')?.textContent).toBe('0')
    expect(second.querySelectorAll('li')).toHaveLength(1)
  })

  it('keeps local state independent when the same child component is used twice', async () => {
    const source = `
export function App() {
  render(<div><Counter /><Counter /></div>);
}
function Counter() {
  const count = signal(0);
  render(
    <section>
      <span>{count()}</span>
      <button onClick={() => count(count() + 1)}>increment</button>
    </section>
  );
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => unknown)(container)

    const sections = container.querySelectorAll('section')
    expect([...sections].map((section) => section.querySelector('span')?.textContent)).toEqual([
      '0',
      '0',
    ])

    ;(sections[0]!.querySelector('button') as HTMLElement).click()
    expect([...sections].map((section) => section.querySelector('span')?.textContent)).toEqual([
      '1',
      '0',
    ])

    ;(sections[1]!.querySelector('button') as HTMLElement).click()
    expect([...sections].map((section) => section.querySelector('span')?.textContent)).toEqual([
      '1',
      '1',
    ])
  })

  it('exposes createComponent for explicit instance ownership', async () => {
    const { code } = compile(INSTANCE_SOURCE)
    const mod = await loadGenerated(code)
    const instance = (
      mod.createComponent as () => {
        mount(container: Element): void
        update_count(): void
      }
    )()
    const container = createContainer()

    instance.mount(container)
    expectInitial(container)
    expect(() => instance.update_count()).not.toThrow()
  })
})
