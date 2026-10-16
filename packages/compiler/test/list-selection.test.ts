// 選択状態の更新が行キーの直接通知を使い、構造変更との同期を保つことを検証する。
import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.ts'
import { createContainer, loadGenerated } from './helpers.ts'

const source = `export function App() {
  const rows = signal([{id: 1, label: 'a'}, {id: 2, label: 'b'}, {id: 3, label: 'c'}]);
  const selected = signal(1);
  render(<div><ul>{rows().map((row) => <li key={row.id} class={selected() === row.id ? 'chosen' : ''}><span>{row.label}</span><button onClick={() => selected(row.id)}>select</button></li>)}</ul>
    <button id="unknown" onClick={() => selected(99)}>unknown</button>
    <button id="replace" onClick={() => rows([{id: 2, label: 'B'}, {id: 4, label: 'd'}])}>replace</button>
    <button id="reset" onClick={() => {rows([{id: 3, label: 'C'}]); selected(3)}}>reset</button>
    <button id="clear" onClick={() => rows([])}>clear</button>
  </div>);
}`
function click(container: Element, selector: string) {
  container
    .querySelector(selector)!
    .dispatchEvent(new container.ownerDocument.defaultView!.Event('click'))
}

describe('keyed selection updates', () => {
  it('initializes rows when the selection is also read before the list', async () => {
    const input = source.replace('render(<div><ul>', 'render(<div><p>{selected()}</p><ul>')
    const mod = await loadGenerated(compile(input).code)
    const container = createContainer()
    ;(mod.mountComponent as (element: Element) => void)(container)
    expect(container.querySelectorAll('li')).toHaveLength(3)
    expect(container.querySelector('li.chosen span')?.textContent).toBe('a')
    expect(container.querySelector('p')?.textContent).toBe('1')
  })

  it('updates only the previous and next selection and synchronizes replacement and batches', async () => {
    const { code } = compile(source)
    expect(code).toContain('function __select_')
    const selectedUpdate = code.slice(
      code.indexOf('function update_selected()'),
      code.indexOf('function update_selected()') + 700,
    )
    expect(selectedUpdate.split('function ')[1]).not.toContain('__reconcileList__')
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (element: Element) => void)(container)
    expect(container.querySelector('li.chosen span')?.textContent).toBe('a')
    const first = container.querySelector('li')!
    const second = container.querySelectorAll('li')[1]!
    const observer = new container.ownerDocument.defaultView!.MutationObserver(() => {})
    observer.observe(container.querySelector('ul')!, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    })
    click(container, 'li:nth-child(2) button')
    expect(container.querySelector('li.chosen')).toBe(second)
    expect(observer.takeRecords().map((record) => record.attributeName)).toEqual(['class', 'class'])
    click(container, 'li:nth-child(2) button')
    expect(observer.takeRecords()).toHaveLength(0)
    click(container, '#replace')
    expect(container.querySelector('li.chosen')).toBe(second)
    expect(container.contains(first)).toBe(false)
    click(container, '#unknown')
    expect(container.querySelector('li.chosen')).toBeNull()
    click(container, '#reset')
    expect(container.querySelector('li.chosen span')?.textContent).toBe('C')
    click(container, '#clear')
    click(container, '#unknown')
    expect(container.querySelectorAll('li')).toHaveLength(0)
    click(container, '#reset')
    expect(container.querySelector('li.chosen span')?.textContent).toBe('C')
  })

  it.each([
    source.replace('selected() === row.id', 'selected() == row.id'),
    source.replace('selected() === row.id', 'selected() === row.id + 0'),
    source.replace('{row.label}', '{row.label.toUpperCase()}'),
    source.replace('{row.label}', '{selected()}'),
    source.replace(
      'class={selected() === row.id',
      'title={String(selected())} class={selected() === row.id',
    ),
  ])('keeps general expressions on the reconciliation path', (input) => {
    expect(compile(input).code).not.toContain('function __select_')
  })

  it('refreshes mutated items even when their object and array references are unchanged', async () => {
    const input = source
      .replace(
        '<button id="unknown"',
        '<button id="mutate" onClick={mutate}>mutate</button><button id="unknown"',
      )
      .replace(
        '\n}',
        '\n function mutate() { const data = rows(); data[0].label = "A"; rows(data); }\n}',
      )
    const mod = await loadGenerated(compile(input).code)
    const container = createContainer()
    ;(mod.mountComponent as (element: Element) => void)(container)
    const first = container.querySelector('li')
    click(container, '#mutate')
    expect(container.querySelector('li')).toBe(first)
    expect(container.querySelector('li span')?.textContent).toBe('A')
  })

  it('reconciles when the selected signal changes a derived list', async () => {
    const input = source
      .replace(
        '  render(',
        '  const filtered = derived(() => rows().filter((row) => row.id !== selected()));\n  render(',
      )
      .replace('rows().map', 'filtered().map')
    const { code } = compile(input)
    expect(code).not.toContain('function __select_')
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (element: Element) => void)(container)
    expect(container.querySelectorAll('li')).toHaveLength(2)
    click(container, '#unknown')
    expect(container.querySelectorAll('li')).toHaveLength(3)
  })

  it('reuses marker paths across nested instances and remounted branches', async () => {
    const input = `export function App() {
      const visible = signal(true);
      const groups = signal([{id: 1, items: [{id: 1, text: 'a'}]}, {id: 2, items: [{id: 2, text: 'b'}]}]);
      const clicked = signal(0);
      render(<main><p>{clicked()}</p><button id="toggle" onClick={() => visible(!visible())}>toggle</button>
        {visible() ? <section>{groups().map((group) => <div key={group.id}><ul>{group.items.map((item) => <li key={item.id}><span>{item.text}</span><button onClick={() => clicked(item.id)}>click</button></li>)}</ul></div>)}</section> : null}
      </main>);
    }`
    const mod = await loadGenerated(compile(input).code)
    const container = createContainer()
    ;(mod.mountComponent as (element: Element) => void)(container)
    expect(Array.from(container.querySelectorAll('li span'), (el) => el.textContent)).toEqual([
      'a',
      'b',
    ])
    expect(container.querySelectorAll('li [data-iris-id]')).toHaveLength(0)
    click(container, 'section > div:nth-child(2) li button')
    expect(container.querySelector('p')?.textContent).toBe('2')
    click(container, '#toggle')
    click(container, '#toggle')
    click(container, 'li button')
    expect(container.querySelector('p')?.textContent).toBe('1')
    expect(container.querySelectorAll('li [data-iris-id]')).toHaveLength(0)
  })
})
