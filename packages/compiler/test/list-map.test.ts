// 変更行だけの反映と、所有権・キー・同期更新を証明できない場合の通常照合を確認する。
import { describe, expect, it, vi } from 'vite-plus/test'
import { compile } from '../src/compiler.ts'
import { createContainer, loadGenerated } from './helpers.ts'
import { createListRuntime, mapListValues, reconcileListMap } from '../../runtime/src/index.ts'

async function app(
  actions: string,
  initial = `[{id: 1, label: 'a'}, {id: 2, label: 'b'}]`,
  extra = '',
) {
  const result = compile(`export function App() {
    const rows = signal(${initial});
    const selected = signal(0);
    render(<main><ul>{rows().map(row => <li key={row.id} class={selected() === row.id ? 'on' : ''}><span>{row.label}</span></li>)}</ul>
    <button id="partial" onClick={partial}>partial</button><button id="other" onClick={other}>other</button></main>);
    function partial() { rows(rows().map((row, index) => index === 0 ? {...row, label: row.label + '!'} : row)); }
    ${actions}
    ${extra}
  }`)
  const mod = await loadGenerated(result.code)
  const container = createContainer()
  ;(mod.mountComponent as (element: Element) => void)(container)
  const click = (id: string) =>
    container
      .querySelector('#' + id)!
      .dispatchEvent(new container.ownerDocument.defaultView!.Event('click'))
  return { container, click, code: result.code }
}

function itemLookups(run: () => void): number {
  const get = Reflect.get(Map.prototype, 'get') as (
    this: Map<unknown, unknown>,
    key: unknown,
  ) => unknown
  let count = 0
  const spy = vi.spyOn(Map.prototype, 'get').mockImplementation(function (
    this: Map<unknown, unknown>,
    key: unknown,
  ) {
    const value = get.call(this, key)
    if (value && typeof value === 'object' && 'state' in value && 'handle' in value) count++
    return value
  })
  try {
    run()
  } finally {
    spy.mockRestore()
  }
  return count
}

describe('compiled list map changes', () => {
  it('updates 100 changed rows with 100 item lookups and preserves all elements', async () => {
    const data = JSON.stringify(
      Array.from({ length: 1000 }, (_, index) => ({ id: index + 1, label: 'a' })),
    )
    const { code } = compile(`export function App() {
      const rows = signal([]);
      render(<main><ul>{rows().map(row => <li key={row.id}>{row.label}</li>)}</ul><button id="run" onClick={run}>run</button><button id="update" onClick={update}>update</button></main>);
      function run() { rows(${data}); }
      function update() { rows(rows().map((row, index) => index % 10 === 0 ? {...row, label: row.label + '!'} : row)); }
    }`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (element: Element) => void)(container)
    const click = (id: string) =>
      container
        .querySelector('#' + id)!
        .dispatchEvent(new container.ownerDocument.defaultView!.Event('click'))
    click('run')
    const elements = [...container.querySelectorAll('li')]
    expect(itemLookups(() => click('update'))).toBe(100)
    expect([...container.querySelectorAll('li')]).toEqual(elements)
    expect(elements.map((el) => el.textContent)).toEqual(
      elements.map((_, index) => (index % 10 === 0 ? 'a!' : 'a')),
    )
    expect(itemLookups(() => click('update'))).toBe(100)
    expect(elements[0]?.textContent).toBe('a!!')
    click('run')
    expect(itemLookups(() => click('update'))).toBe(100)
  })

  it('keeps the map base after permutation, removal, clear, and replacement', async () => {
    const { container, click } = await app(`function other() {
      if (rows().length > 1) { const copy = rows().slice(); const temp = copy[0]; copy[0] = copy[1]; copy[1] = temp; rows(copy); }
    }`)
    const first = container.querySelector('li')
    click('partial')
    click('other')
    expect(container.querySelectorAll('li')[1]).toBe(first)
    expect(itemLookups(() => click('partial'))).toBe(1)
    expect(container.textContent).toContain('b!a!')
    const replacement = await app(
      `function other() { rows([{id: 1, label: 'c'}, {id: 2, label: 'd'}]); }`,
    )
    replacement.click('other')
    expect(itemLookups(() => replacement.click('partial'))).toBe(1)
    expect(replacement.container.querySelector('span')?.textContent).toBe('c!')
    const removal = await app(`function other() { rows(rows().filter(row => row.id !== 2)); }`)
    removal.click('other')
    expect(itemLookups(() => removal.click('partial'))).toBe(1)
    const empty = await app(`function other() { rows([]); }`)
    empty.click('other')
    expect(itemLookups(() => empty.click('partial'))).toBe(0)
  })

  it('reconciles changed keys and still rejects duplicate keys', async () => {
    const { container, click } = await app(
      `function other() { rows(rows().map(row => ({...row, id: row.id + 10}))); }`,
    )
    const before = container.querySelector('li')
    click('other')
    expect(container.querySelector('li')).not.toBe(before)
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(itemLookups(() => click('partial'))).toBe(1)
  })

  it('falls back when several map writes or another dependency change share an update', async () => {
    const two = await app(
      `function other() { rows(rows().map((row, index) => index === 0 ? {...row, label: 'c'} : row)); rows(rows().map((row, index) => index === 1 ? {...row, label: 'd'} : row)); }`,
    )
    two.click('other')
    expect(two.container.querySelector('ul')?.textContent).toBe('cd')
    const selection = await app(
      `function other() { rows(rows().map((row, index) => index === 0 ? {...row, label: 'c'} : row)); selected(2); }`,
    )
    selection.click('other')
    expect(selection.container.querySelector('ul')?.textContent).toBe('cb')
    expect(selection.container.querySelectorAll('li')[1]?.className).toBe('on')
  })

  it.each([
    `function other() { const copy = rows().slice(); copy[1].label = 'c'; rows(copy); }`,
    `function other() { change(rows()); }`,
    `function other() { rows(rows().map(row => { row.label = 'c'; return row; })); }`,
    `function other() { const alias = rows(rows().map(row => row)); alias[1].label = 'c'; }`,
    `function other() { const copy = rows().slice(); const alias = (copy[1] = copy[1]); alias.label = 'c'; rows(copy); }`,
  ])('preserves mutations through aliases or calls: %s', async (other) => {
    const { code, click, container } = await app(
      other,
      undefined,
      `function change(rows) { rows[1].label = 'c'; }`,
    )
    expect(code).not.toContain('__mapListValues__(')
    click('other')
    click('partial')
    expect(container.querySelectorAll('span')[1]?.textContent).toBe('c')
  })

  it('keeps externally supplied rows and arbitrary map calls on the full path', async () => {
    const { code } = compile(`export function App() {
      const source = signal([{id: 1, label: 'a'}]); const rows = signal(source());
      render(<main><ul>{rows().map(row => <li key={row.id}>{row.label}</li>)}</ul><button onClick={() => { source()[0].label = 'b'; rows(rows().map(row => row)); }}>update</button></main>);
    }`)
    expect(code).not.toContain('__mapListValues__(')
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (element: Element) => void)(container)
    container
      .querySelector('button')!
      .dispatchEvent(new container.ownerDocument.defaultView!.Event('click'))
    expect(container.querySelector('li')?.textContent).toBe('b')
  })

  it.each([
    `function other() { rows(rows().map(row => ({...row, label: row.constructor}))); }`,
    `function other() { const value = {text: 'c'}; rows(rows().map(row => ({...row, label: value}))); }`,
    `function other() { const copy = rows().slice(); setTimeout(() => { const row = copy[0]; copy[0] = copy[1]; copy[1] = row; }, 0); rows(copy); }`,
  ])(
    'does not infer ownership for inherited values, objects, or deferred aliases: %s',
    async (other) => {
      expect((await app(other)).code).not.toContain('__mapListValues__(')
    },
  )

  it('does not hide mutations in destructuring targets', async () => {
    const { code } = compile(`export function App() {
      const rows = signal([{id: 1, label: 'a'}]);
      render(<ul>{rows().map(row => <li key={row.id}><span>{row.label}</span><button onClick={() => {
        [row.label] = ['b']; rows(rows().map(row => ({...row, label: row.label + '!'})));
      }}>update</button></li>)}</ul>);
    }`)
    expect(code).not.toContain('__mapListValues__(')
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (element: Element) => void)(container)
    container
      .querySelector('button')!
      .dispatchEvent(new container.ownerDocument.defaultView!.Event('click'))
    expect(container.querySelector('span')?.textContent).toBe('b!')
  })

  it('still evaluates general display expressions for unchanged rows', async () => {
    const read = vi.fn((text: string) => text)
    vi.stubGlobal('__irisoutMapRead__', read)
    try {
      const { code } = compile(`export function App() {
        const rows = signal([{id: 1, label: 'a'}, {id: 2, label: 'b'}]);
        render(<main><ul>{rows().map(row => <li key={row.id}>{__irisoutMapRead__(row.label)}</li>)}</ul><button onClick={() => rows(rows().map((row, index) => index === 0 ? {...row, label: 'c'} : row))}>update</button></main>);
      }`)
      const mod = await loadGenerated(code)
      expect(code).toContain('["label"]')
      const container = createContainer()
      ;(mod.mountComponent as (element: Element) => void)(container)
      read.mockClear()
      container
        .querySelector('button')!
        .dispatchEvent(new container.ownerDocument.defaultView!.Event('click'))
      expect(read.mock.calls).toEqual([['c'], ['b']])
      expect(container.querySelector('ul')?.textContent).toBe('cb')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('also transforms map writes in an inlined component', async () => {
    const { code } = compile(`function Child({ title }) {
      const rows = signal([{id: 1, label: 'a'}]);
      render(<main><h1>{title}</h1><ul>{rows().map(row => <li key={row.id}>{row.label}</li>)}</ul><button onClick={() => rows(rows().map(row => ({...row, label: row.label + '!'})))}>update</button></main>);
    }
    export function App() { render(<Child title="rows"/>); }`)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (element: Element) => void)(container)
    expect(
      itemLookups(() =>
        container
          .querySelector('button')!
          .dispatchEvent(new container.ownerDocument.defaultView!.Event('click')),
      ),
    ).toBe(1)
    expect(container.querySelector('li')?.textContent).toBe('a!')
  })

  it('executes an index range only at matching positions and preserves holes', () => {
    const data = Array.from({ length: 23 }, (_, id) => ({ id, label: 'a' }))
    const calls: number[] = []
    const next = mapListValues(
      data,
      (row, index) => {
        calls.push(index)
        return { ...row, label: 'b' }
      },
      7,
      3,
    )
    expect(calls).toEqual([3, 10, 17])
    expect(next[0]).toBe(data[0])
    expect(next[3]).not.toBe(data[3])
    const sparse: typeof data = []
    sparse.length = 4
    sparse[2] = data[0]!
    const mapped = mapListValues(sparse, (row) => ({ ...row }), 1)
    expect(Object.keys(mapped)).toEqual(['2'])
    calls.length = 0
    mapListValues(
      data,
      (row, index) => {
        calls.push(index)
        return row
      },
      0,
      4,
    )
    expect(calls).toEqual([4])
  })

  it('shares changes between lists, falls back on duplicate keys, and recovers after failure', () => {
    const data = [
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ]
    const container = createContainer()
    const key = (row: (typeof data)[number]) => row.id
    const create = () => ({ el: container.ownerDocument.createElement('li') })
    const update = vi.fn()
    const first = createListRuntime<(typeof data)[number]>('first')
    const second = createListRuntime<(typeof data)[number]>('second')
    const render = (list: typeof first, values: typeof data) =>
      reconcileListMap(list, undefined, values, key, create, update, true)
    render(first, data)
    render(second, data)
    const next = mapListValues(
      data,
      (row, index) => (index === 0 ? { ...row, label: 'c' } : row),
      0,
      0,
    )
    render(first, next)
    render(second, next)
    expect(update).toHaveBeenCalledTimes(2)
    const duplicate = mapListValues(next, (row) => ({ ...row, id: 1 }))
    expect(() => render(first, duplicate)).toThrow('duplicate key 1')
    render(first, next)
    expect(first.items.size).toBe(2)
  })
})
