// 所有配列の構造操作が保持行を再評価せず、基点と副作用の条件を外れた場合は通常照合へ戻ることを確認する。
import { describe, expect, it, vi } from 'vite-plus/test'
import { compile } from '../src/compiler.ts'
import { createContainer, loadGenerated } from './helpers.ts'
import {
  appendListValues,
  copyListValues,
  createListRuntime,
  filterListValues,
  reconcileListMap,
} from '../../runtime/src/index.ts'

async function application(size: number, first: number, second: number, extra = '') {
  const { code } = compile(`export function App() {
    const rows = signal([]); const selected = signal(0);
    render(<main><ul><li id="before">before</li>{rows().map(row => <li data-row="" key={row.id} class={selected() === row.id ? 'on' : ''}><span>{row.label}</span><button onClick={() => rows(rows().filter(item => item.id !== row.id))}>remove</button></li>)}<li id="after">after</li></ul>
      <button id="run" onClick={run}>run</button><button id="swap" onClick={swap}>swap</button><button id="add" onClick={add}>add</button><button id="partial" onClick={partial}>partial</button><button id="other" onClick={other}>other</button></main>);
    function build(count, offset) { const data = []; for (let i=0; i<count; i++) data.push({id: offset + i + 1, label: 'a'}); return data; }
    function run() { rows(build(${size}, 0)); }
    function swap() { const data = rows().slice(); const temp = data[${first}]; data[${first}] = data[${second}]; data[${second}] = temp; rows(data); }
    function add() { rows([...rows(), ...build(2, ${size})]); }
    function partial() { rows(rows().map((row, index) => index === 0 ? {...row, label: row.label + '!'} : row)); }
    function other() { ${extra} }
  }`)
  const mod = await loadGenerated(code)
  const container = createContainer()
  ;(mod.mountComponent as (element: Element) => void)(container)
  const button = (id: string) => container.querySelector('#' + id)!
  const click = (target: Element) =>
    target.dispatchEvent(new container.ownerDocument.defaultView!.Event('click', { bubbles: true }))
  click(button('run'))
  return {
    container,
    button,
    click,
    code,
    rows: () => [...container.querySelectorAll('[data-row]')],
  }
}

function work(container: Element, run: () => void) {
  let lookups = 0
  const get = Reflect.get(Map.prototype, 'get') as (
    this: Map<unknown, unknown>,
    key: unknown,
  ) => unknown
  const map = vi.spyOn(Map.prototype, 'get').mockImplementation(function (
    this: Map<unknown, unknown>,
    key: unknown,
  ) {
    if (typeof key === 'number') lookups++
    return get.call(this, key)
  })
  const same = vi.spyOn(Object, 'is')
  const next = vi.spyOn(container.ownerDocument.defaultView!.Node.prototype, 'nextSibling', 'get')
  try {
    run()
    return { lookups, compares: same.mock.calls.length, siblings: next.mock.calls.length }
  } finally {
    map.mockRestore()
    same.mockRestore()
    next.mockRestore()
  }
}

describe('owned list operations', () => {
  it.each([100, 1000, 10000])(
    'keeps swap work constant for %i rows and preserves siblings and item identity',
    async (size) => {
      const app = await application(size, 0, size - 1)
      const before = app.rows()
      const staticBefore = app.button('before')
      const staticAfter = app.button('after')
      const swap = app.button('swap')
      expect(work(app.container, () => app.click(swap))).toEqual({
        lookups: 2,
        compares: 0,
        siblings: 2,
      })
      expect(app.rows()).toEqual([before.at(-1), ...before.slice(1, -1), before[0]])
      app.click(swap)
      expect(app.rows()).toEqual(before)
      expect(app.button('before')).toBe(staticBefore)
      expect(app.button('after')).toBe(staticAfter)
    },
  )

  it('handles adjacent and equal positions', async () => {
    for (const [first, second] of [
      [0, 1],
      [1, 1],
      [1, 2],
    ]) {
      const app = await application(3, first!, second!)
      const expected = app.rows()
      ;[expected[first!], expected[second!]] = [expected[second!]!, expected[first!]!]
      app.click(app.button('swap'))
      expect(app.rows()).toEqual(expected)
    }
  })

  it('creates appended rows without comparing retained values and removes only the requested row', async () => {
    const app = await application(1000, 1, 998)
    expect(app.code).toContain('__appendListValues__(')
    expect(app.code).toContain('__filterListValues__(')
    const before = app.rows()
    const add = app.button('add')
    expect(work(app.container, () => app.click(add))).toEqual({
      lookups: 0,
      compares: 0,
      siblings: 0,
    })
    expect(app.rows().slice(0, 1000)).toEqual(before)
    app.click(app.button('partial'))
    const remove = before[0]!.querySelector('button')!
    expect(work(app.container, () => app.click(remove))).toEqual({
      lookups: 1,
      compares: 0,
      siblings: 0,
    })
    expect(app.rows()).toHaveLength(1001)
    expect(app.rows()[0]).toBe(before[1])
  })

  it('falls back for multiple writes and simultaneous selection changes', async () => {
    const app = await application(
      3,
      0,
      1,
      `rows(rows().filter(row => row.id !== 2)); rows(rows().map((row,index) => index === 0 ? {...row,label:'b'} : row)); selected(3);`,
    )
    app.click(app.button('other'))
    expect(app.rows().map((row) => row.textContent)).toEqual(['bremove', 'aremove'])
    expect(app.rows()[1]?.className).toBe('on')
    app.click(app.button('swap'))
    expect(app.rows()).toHaveLength(2)
    expect(app.rows()[0]?.className).toBe('on')
  })

  it('does not treat filter calls or inherited properties as pure', async () => {
    for (const predicate of ['read(row.id)', 'row.constructor !== 0']) {
      const { code } = compile(
        `export function App() { const rows=signal([{id:1,label:'a'}]); render(<main><ul>{rows().map(row=><li key={row.id}>{row.label}</li>)}</ul><button onClick={()=>rows(rows().filter(row=>${predicate}))}>filter</button></main>); function read(value) { return value !== 2; } }`,
      )
      expect(code).not.toContain('__filterListValues__(')
      const mod = await loadGenerated(code)
      const container = createContainer()
      ;(mod.mountComponent as (element: Element) => void)(container)
      container
        .querySelector('button')!
        .dispatchEvent(new container.ownerDocument.defaultView!.Event('click'))
      expect(container.querySelector('li')?.textContent).toBe('a')
    }
  })

  it('preserves filter evaluation and recovers from duplicate append and invalid permutation', () => {
    const container = createContainer()
    const data = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const runtime = createListRuntime<(typeof data)[number]>('ops')
    const render = (values: typeof data) =>
      reconcileListMap(
        runtime,
        container,
        values,
        (row) => row.id,
        () => ({ el: container.ownerDocument.createElement('li') }),
        () => {},
        true,
      )
    render(data)
    expect(() => render(appendListValues(data, [data[0]!]))).toThrow('duplicate key 1')
    render(data)
    const copy = copyListValues(data, 0, 2)
    copy[0] = copy[2]!
    expect(() => render(copy)).toThrow('duplicate key 3')
    render(data)
    const seen: number[] = []
    expect(() =>
      filterListValues(data, (row, index) => {
        seen.push(index)
        if (row.id === 2) throw Error('stop')
        return true
      }),
    ).toThrow('stop')
    expect(seen).toEqual([0, 1])
    expect(data.map((row) => row.id)).toEqual([1, 2, 3])
    const retained = filterListValues(data, (row) => row.id !== 2)
    render(retained)
    expect(runtime.items.size).toBe(2)
    expect(container.children).toHaveLength(2)
  })
})
