// 一覧の配置最適化がDOMの同一性、範囲境界、一括削除を保つことを検証する。
import { describe, expect, it } from 'vite-plus/test'
import { createListRuntime, reconcileList, type DomRange } from '../../runtime/src/index.ts'
import { createContainer } from './helpers.ts'

function fixture(exclusive = false) {
  const container = createContainer()
  const document = container.ownerDocument
  const start = document.createComment('start')
  const end = document.createComment('end')
  container.append(start, end)
  if (!exclusive) {
    container.prepend(document.createTextNode('before'))
    container.append(document.createTextNode('after'))
  }
  const range: DomRange = { start, end }
  const runtime = createListRuntime<number>('test')
  const update = (values: number[]) =>
    reconcileList(
      runtime,
      range,
      values,
      (value) => value,
      (value) => {
        const el = document.createElement('div')
        el.textContent = String(value)
        return { el, update() {} }
      },
    )
  return { container, range, runtime, update }
}

describe('List DOM ordering', () => {
  it('moves only the exchanged elements and inserts appended rows as one fragment', () => {
    const { container, update } = fixture()
    const values = Array.from({ length: 1000 }, (_, i) => i)
    update(values)
    const elements = Array.from(container.children)
    const insert = container.insertBefore.bind(container)
    let calls = 0
    container.insertBefore = ((node: Node, before: Node | null) => {
      calls++
      return insert(node, before)
    }) as typeof container.insertBefore
    ;[values[1], values[998]] = [values[998]!, values[1]!]
    update(values)
    expect(calls).toBe(2)
    expect(container.children[1]).toBe(elements[998])
    expect(container.children[998]).toBe(elements[1])
    calls = 0
    update([...values, 1000, 1001, 1002])
    expect(calls).toBe(1)
    expect(container.firstChild?.textContent).toBe('before')
    expect(container.lastChild?.textContent).toBe('after')
  })

  it('preserves identity across all permutations, insertion, and deletion', () => {
    const { container, runtime, update } = fixture()
    const permutations = (values: number[]): number[][] =>
      values.length === 0
        ? [[]]
        : values.flatMap((value, index) =>
            permutations(values.filter((_, i) => i !== index)).map((rest) => [value, ...rest]),
          )
    update([0, 1, 2, 3, 4])
    const elements = new Map([...runtime.items].map(([key, record]) => [key, record.handle.el]))
    for (const values of permutations([0, 1, 2, 3, 4])) {
      update(values)
      expect(Array.from(container.children)).toEqual(values.map((key) => elements.get(key)))
    }
    update([5, 4, 6, 2, 7])
    expect(Array.from(container.children, (el) => el.textContent)).toEqual([
      '5',
      '4',
      '6',
      '2',
      '7',
    ])
    expect(container.children[1]).toBe(elements.get(4))
    expect(container.children[3]).toBe(elements.get(2))
    update([])
    expect(container.textContent).toBe('beforeafter')
  })

  it('bulk replaces an exclusively owned range while keeping its anchors', () => {
    const { container, range, runtime, update } = fixture(true)
    update([0, 1, 2])
    let removals = 0
    for (const el of Array.from(container.children))
      el.remove = () => {
        removals++
      }
    update([3, 4, 5])
    expect(removals).toBe(0)
    expect(container.textContent).toBe('345')
    expect(runtime.items.size).toBe(3)
    for (const el of Array.from(container.children))
      el.remove = () => {
        removals++
      }
    update([])
    expect(removals).toBe(0)
    expect(runtime.items.size).toBe(0)
    expect(Array.from(container.childNodes)).toEqual([range.start, range.end])
    update([6])
    expect(container.textContent).toBe('6')
  })
})
