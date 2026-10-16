// 所有配列の構造操作が保持行を再評価せず、基点と副作用の条件を外れた場合は通常照合へ戻ることを確認する。
import { describe, expect, it, vi } from 'vite-plus/test'
import { compile } from '../src/compiler.ts'
import { createContainer, loadGenerated } from './helpers.ts'
import {
  appendListValues,
  copyListValues,
  createListRuntime,
  filterListValues,
  mapListValues,
  reconcileListMap,
} from '../../runtime/src/index.ts'

async function application(
  size: number,
  first: number,
  second: number,
  extra = '',
  builderPrefix = '',
  helpers = '',
) {
  const { code } = compile(`export function App() {
    const rows = signal([]); const selected = signal(0);
    render(<main><ul><li id="before">before</li>{rows().map(row => <li data-row="" key={row.id} class={selected() === row.id ? 'on' : ''}><span>{row.label}</span><button onClick={() => rows(rows().filter(item => item.id !== row.id))}>remove</button></li>)}<li id="after">after</li></ul>
      <button id="run" onClick={run}>run</button><button id="swap" onClick={swap}>swap</button><button id="add" onClick={add}>add</button><button id="partial" onClick={partial}>partial</button><button id="other" onClick={other}>other</button></main>);
    function build(count, offset) { ${builderPrefix} const data = []; for (let i=0; i<count; i++) data.push({id: offset + i + 1, label: 'a'}); return data; }
    function run() { rows(build(${size}, 0)); }
    function swap() { const data = rows().slice(); const temp = data[${first}]; data[${first}] = data[${second}]; data[${second}] = temp; rows(data); }
    function add() { rows([...rows(), ...build(2, ${size})]); }
    function partial() { rows(rows().map((row, index) => index === 0 ? {...row, label: row.label + '!'} : row)); }
    function other() { ${extra} }
    ${helpers}
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
  it('keeps empty class attributes and resolves references from an earlier sibling', async () => {
    const app = await application(3, 0, 2, 'selected(2);')
    expect(app.rows().map((row) => row.getAttribute('class'))).toEqual(['', '', ''])
    app.click(app.button('other'))
    expect(app.rows().map((row) => row.getAttribute('class'))).toEqual(['', 'on', ''])
    app.click(app.button('partial'))
    expect(app.rows()[0]?.querySelector('span')?.textContent).toBe('a!')
    app.click(app.rows()[1]!.querySelector('button')!)
    expect(app.rows()).toHaveLength(2)
  })

  it('resolves nested siblings and root attributes without changing custom-element initialization', async () => {
    for (const tag of ['li', 'x-row']) {
      const { code } = compile(
        `export function App(){const rows=signal([{id:1,label:'a'},{id:2,label:'b'}]);const selected=signal(2);render(<main>{rows().map(row=><${tag} key={row.id} class={selected()===row.id?'on':''}><div><b>{row.id}</b><i>{row.label}</i></div><button onClick={()=>selected(row.id)}>select</button></${tag}>)}</main>);}`,
      )
      if (tag === 'x-row') expect(code).not.toContain('if (__handle__.attr_0 !== "")')
      const mod = await loadGenerated(code)
      const container = createContainer()
      ;(mod.mountComponent as (element: Element) => void)(container)
      const elements = [...container.querySelectorAll(tag)]
      expect(elements.map((row) => row.getAttribute('class'))).toEqual(['', 'on'])
      expect(elements.map((row) => row.querySelector('b')?.textContent)).toEqual(['1', '2'])
      expect(elements.map((row) => row.querySelector('i')?.textContent)).toEqual(['a', 'b'])
      elements[0]!
        .querySelector('button')!
        .dispatchEvent(new container.ownerDocument.defaultView!.Event('click'))
      expect(elements.map((row) => row.getAttribute('class'))).toEqual(['on', ''])
    }
  })

  it('updates only the changed field and retains the array copy', async () => {
    const app = await application(1000, 1, 998)
    const button = app.button('partial')
    const slice = Reflect.get(Array.prototype, 'slice') as (
      this: unknown[],
      start?: number,
      end?: number,
    ) => unknown[]
    let largeCopies = 0
    const spy = vi.spyOn(Array.prototype, 'slice').mockImplementation(function (
      this: unknown[],
      start?: number,
      end?: number,
    ) {
      if (this.length >= 1000) largeCopies++
      return slice.call(this, start, end)
    })
    let measured: ReturnType<typeof work>
    try {
      measured = work(app.container, () => app.click(button))
    } finally {
      spy.mockRestore()
    }
    expect(measured!).toEqual({ lookups: 0, compares: 1, siblings: 0 })
    expect(largeCopies).toBe(1)
    expect(app.rows()[0]?.querySelector('span')?.textContent).toBe('a!')
  })

  it('keeps the source array and old row objects intact when evaluating updates', () => {
    const input = [
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ]
    const before = [...input]
    expect(() =>
      mapListValues(
        input,
        (row, index) => {
          if (index === 1) throw Error('stop')
          return { ...row, label: 'c' }
        },
        undefined,
        0,
        ['label'],
      ),
    ).toThrow('stop')
    expect(input).toEqual(before)
    expect(input[0]).toBe(before[0])
    expect(
      mapListValues(input, (row) => ({ ...row, label: 'c' }), undefined, 0, ['label']),
    ).not.toBe(input)
    expect(before.map((row) => row.label)).toEqual(['a', 'b'])
    expect(input.map((row) => row.label)).toEqual(['a', 'b'])
  })

  it('copies swaps with a call before the setter so a thrown call leaves state intact', async () => {
    const app = await application(
      3,
      0,
      2,
      `try { const data=rows().slice(); const temp=data[0]; data[0]=data[2]; data[2]=temp; fail(); rows(data); } catch {} selected(1);`,
      '',
      `function fail(){throw Error('stop');}`,
    )
    expect(app.code).toContain('__copyListValues__(rows, 0, 2, false)')
    const before = app.rows()
    app.click(app.button('other'))
    expect(app.rows()).toEqual(before)
    expect(app.rows()[0]?.className).toBe('on')
  })

  it('retains copied arrays used after a write and copies inside loops', async () => {
    const alias = await application(
      3,
      0,
      2,
      `const saved=rows().slice(); rows(saved); rows(rows().map(row=>({...row,label:'b'}))); rows(saved);`,
    )
    expect(alias.code).toContain('["label"]')
    alias.click(alias.button('other'))
    expect(alias.rows().map((row) => row.querySelector('span')?.textContent)).toEqual([
      'a',
      'a',
      'a',
    ])
    const loop = await application(
      3,
      0,
      2,
      `const saved=rows().slice(); for(let index=0;index<2;index++){ rows(saved); rows(rows().map(row=>({...row,label:'b'}))); }`,
    )
    expect(loop.code).toContain('["label"]')
  })

  it('snapshots an appended prefix before a builder can change the current array', async () => {
    const app = await application(3, 0, 2, '', 'bump();', `function bump(){swap();}`)
    expect(app.code).toContain('["label"]')
    const prefix = app.rows()
    app.click(app.button('add'))
    expect(app.rows().slice(0, 3)).toEqual(prefix)
    expect(app.rows().map((row) => row.querySelector('span')?.textContent)).toEqual([
      'a',
      'a',
      'a',
      'a',
      'a',
    ])
  })

  it('keeps row references read after a map in an active event unchanged', async () => {
    const { code } = compile(
      `export function App(){const rows=signal([{id:1,label:'a'}]);const seen=signal('');render(<main><p>{seen()}</p><ul>{rows().map(row=><li key={row.id}><span>{row.label}</span><button onClick={()=>{rows(rows().map((item,index)=>index===0?{...item,label:item.label+'!'}:item));seen(row.label);}}>update</button></li>)}</ul></main>);}`,
    )
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (element: Element) => void)(container)
    container
      .querySelector('button')!
      .dispatchEvent(new container.ownerDocument.defaultView!.Event('click'))
    expect(container.querySelector('span')?.textContent).toBe('a!')
    expect(container.querySelector('p')?.textContent).toBe('a')
  })

  it('keeps side-effecting filter callbacks on an immutable input array', async () => {
    const app = await application(
      3,
      0,
      2,
      `rows(rows().filter(row=>retain(row.id)));`,
      '',
      `function retain(id){partial();return id>0;}`,
    )
    expect(app.code).toContain('["label"]')
    app.click(app.button('other'))
    expect(app.rows().map((row) => row.querySelector('span')?.textContent)).toEqual(['a', 'a', 'a'])
  })
  it.each([100, 1000, 10000])(
    'keeps swap work constant for %i rows and preserves siblings and item identity',
    async (size) => {
      const app = await application(size, 0, size - 1)
      const before = app.rows()
      const staticBefore = app.button('before')
      const staticAfter = app.button('after')
      const swap = app.button('swap')
      expect(app.code).toContain(`__copyListValues__(rows, 0, ${size - 1}, true)`)
      expect(work(app.container, () => app.click(swap))).toEqual({
        lookups: 0,
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

  it('keeps invalid or equal swap positions on copied arrays', () => {
    for (const [first, second] of [
      [0, 4],
      [-1, 1],
      [1, 1],
    ]) {
      const values = ['a', 'b', 'c']
      const copy = copyListValues(values, first!, second!, true)
      expect(copy).not.toBe(values)
      copy[0] = 'changed'
      expect(values).toEqual(['a', 'b', 'c'])
    }
  })

  it('applies an in-place swap independently to multiple lists', () => {
    const container = createContainer()
    const values = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const lists = ['first', 'second'].map((id) => ({
      runtime: createListRuntime<(typeof values)[number]>(id),
      parent: container.appendChild(container.ownerDocument.createElement('ul')),
    }))
    const update = vi.fn()
    const render = () => {
      for (const { runtime, parent } of lists)
        reconcileListMap(
          runtime,
          parent,
          values,
          (row) => row.id,
          (row) => {
            const el = container.ownerDocument.createElement('li')
            el.textContent = String(row.id)
            return { el }
          },
          update,
          true,
        )
    }
    render()
    const originals = lists.map(({ parent }) => [...parent.children])
    const next = copyListValues(values, 0, 2, true)
    ;[next[0], next[2]] = [next[2]!, next[0]!]
    render()
    expect(update).not.toHaveBeenCalled()
    for (const [index, { parent }] of lists.entries())
      expect([...parent.children]).toEqual([...originals[index]!].reverse())
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
      lookups: 0,
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
