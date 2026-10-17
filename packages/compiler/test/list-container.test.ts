// 表の親を専有する一覧のDOM操作と、外部参照がある場合の境界保持を検証する。
import { describe, expect, it, vi } from 'vite-plus/test'
import { compile, compileSSR } from '../src/compiler.ts'
import { createContainer, loadGenerated } from './helpers.ts'
import { filterOwnedListValues, observeDomUpdates } from '../../runtime/src/index.ts'

const source = `export function App() {
  const rows = signal([]); const selected = signal(0);
  render(<main><table><tbody>{rows().map(row => <tr key={row.id} class={selected()===row.id?'on':''}><td><a onClick={()=>selected(row.id)}>{row.label}</a></td><td><a onClick={()=>rows(rows().filter(item=>item.id!==row.id))}>remove</a></td></tr>)}</tbody></table>
    <button id="run" onClick={()=>rows(build())}>run</button>
    <button id="swap" onClick={swap}>swap</button>
    <button id="add" onClick={()=>rows([...rows(),{id:4,label:'d'}])}>add</button>
    <button id="clear" onClick={()=>rows([])}>clear</button>
    <button id="replace" onClick={()=>rows([{id:5,label:'e'}])}>replace</button>
  </main>);
  function build() { const data=[]; for(let i=0;i<3;i++) data.push({id:i+1,label:''+(i+1)}); return data; }
  function swap() { const data=rows().slice(); const row=data[0]; data[0]=data[2]; data[2]=row; rows(data); }
}`

async function application(input = source) {
  const result = compile(input, { listEvents: 'delegated' })
  const mod = await loadGenerated(result.code)
  const container = createContainer()
  ;(mod.mountComponent as (element: Element) => void)(container)
  const click = (selector: string) =>
    container
      .querySelector(selector)!
      .dispatchEvent(new container.ownerDocument.defaultView!.Event('click', { bubbles: true }))
  return { ...result, container, click }
}

describe('exclusive table list container', () => {
  it('routes text targets through local ancestors and ignores events from detached rows', async () => {
    const input = source
      .replace('const rows =', 'const seen=signal(0); const rows =')
      .replace('<main>', '<main><output>{seen()}</output>')
      .replace('<tr key=', '<tr onClick={()=>seen(seen()+10)} key=')
      .replace('onClick={()=>selected(row.id)}', 'onClick={()=>{selected(row.id);seen(seen()+1)}}')
    const app = await application(input)
    app.click('#run')
    const old = app.container.querySelector('tr')!
    old
      .querySelector('a')!
      .firstChild!.dispatchEvent(
        new app.container.ownerDocument.defaultView!.Event('click', { bubbles: true }),
      )
    expect(app.container.querySelector('output')?.textContent).toBe('11')
    app.click('#clear')
    old
      .querySelector('a')!
      .dispatchEvent(new app.container.ownerDocument.defaultView!.Event('click', { bubbles: true }))
    expect(app.container.querySelector('output')?.textContent).toBe('11')
  })

  it('recreates one copy after a native clear fails', async () => {
    const app = await application()
    app.click('#run')
    const parent = app.container.querySelector('tbody')!
    const errors: unknown[] = []
    app.container.ownerDocument.defaultView!.addEventListener('error', (event) => {
      errors.push(event.error)
      event.preventDefault()
    })
    const failure = new Error('native clear')
    const text = vi.spyOn(parent, 'textContent', 'set').mockImplementationOnce(() => {
      throw failure
    })
    try {
      app.click('#clear')
    } finally {
      text.mockRestore()
    }
    expect(errors).toEqual([failure])
    app.click('#run')
    expect(parent.children.length).toBe(3)
    expect([...parent.querySelectorAll('td:first-child')].map((cell) => cell.textContent)).toEqual([
      '1',
      '2',
      '3',
    ])
  })

  it('falls back when an observer reenters before a prepared swap is reflected', async () => {
    const app = await application()
    app.click('#run')
    let nested = true
    const stop = observeDomUpdates({
      before() {
        if (nested) {
          nested = false
          app.click('#swap')
        }
      },
      after() {},
    })
    try {
      app.click('#swap')
    } finally {
      stop()
    }
    expect(
      [...app.container.querySelectorAll('tr td:first-child')].map((cell) => cell.textContent),
    ).toEqual(['1', '2', '3'])
    app.click('#swap')
    expect(
      [...app.container.querySelectorAll('tr td:first-child')].map((cell) => cell.textContent),
    ).toEqual(['3', '2', '1'])
  })

  it('repairs a failed native swap before a later append', async () => {
    const app = await application()
    app.click('#run')
    const parent = app.container.querySelector('tbody')!
    const failure = new Error('native swap')
    const errors: unknown[] = []
    app.container.ownerDocument.defaultView!.addEventListener('error', (event) => {
      errors.push(event.error)
      event.preventDefault()
    })
    const insert = parent.insertBefore.bind(parent)
    const spy = vi
      .spyOn(parent, 'insertBefore')
      .mockImplementationOnce((node, before) => insert(node, before))
      .mockImplementationOnce(() => {
        throw failure
      })
    try {
      app.click('#swap')
    } finally {
      spy.mockRestore()
    }
    expect(errors).toEqual([failure])
    app.click('#add')
    expect([...parent.querySelectorAll('td:first-child')].map((cell) => cell.textContent)).toEqual([
      '3',
      '2',
      '1',
      'd',
    ])
  })

  it('preserves independent swaps for two views of one array', async () => {
    const table = source.match(/<table>.*<\/table>/)![0]
    const app = await application(source.replace(table, table + table))
    app.click('#run')
    app.click('#swap')
    for (const parent of app.container.querySelectorAll('tbody'))
      expect(
        [...parent.querySelectorAll('td:first-child')].map((cell) => cell.textContent),
      ).toEqual(['3', '2', '1'])
  })

  it('keeps the section identity, swaps without sibling reads and clears with one native write', async () => {
    const app = await application()
    const parent = app.container.querySelector('tbody')!
    expect(app.code).toContain('__swapOwnedListRecords__(')
    expect(parent.childNodes.length).toBe(0)
    app.click('#run')
    const rows = [...parent.children]
    expect(parent.childNodes).toHaveLength(3)
    const siblings = vi.spyOn(
      app.container.ownerDocument.defaultView!.Node.prototype,
      'nextSibling',
      'get',
    )
    app.click('#swap')
    expect(siblings.mock.calls.length).toBe(0)
    siblings.mockRestore()
    expect([...parent.children].map((row) => rows.indexOf(row))).toEqual([2, 1, 0])
    app.click('#add')
    expect(parent.children).toHaveLength(4)
    app.click('tr a')
    expect(rows[2]?.className).toBe('on')
    app.click('tr td:nth-child(2) a')
    expect(parent.children).toHaveLength(3)
    app.click('tr a')
    expect(rows[1]?.className).toBe('on')
    const text = vi.spyOn(parent, 'textContent', 'set')
    app.click('#clear')
    expect(text.mock.calls).toEqual([['']])
    text.mockRestore()
    expect(app.container.querySelector('tbody')).toBe(parent)
    expect(parent.childNodes).toHaveLength(0)
    app.click('#run')
    app.click('tr a')
    expect(parent.firstElementChild?.className).toBe('on')
    app.click('#replace')
    expect(parent.textContent).toBe('eremove')
    app.click('tr a')
    expect(parent.firstElementChild?.className).toBe('on')
  })

  it.each([
    ['static sibling', source.replace('<tbody>', '<tbody><tr><td>static</td></tr>')],
    [
      'event parameter',
      source.replace('onClick={()=>selected(row.id)}', 'onClick={(event)=>selected(row.id)}'),
    ],
    [
      'DOM global',
      source.replace(
        'onClick={()=>rows(build())}',
        "onClick={()=>{rows(build()); document.title='x'}}",
      ),
    ],
    ['custom element', source.replace('<main>', '<main><x-widget />')],
    ['action', source.replace('<tbody>', '<tbody use={(element)=>{}}>')],
    ['focusable row', source.replace('<tr key=', '<tr tabIndex="0" key=')],
    [
      'reflection',
      source.replace('const data=[]', "const name='constructor'; const fn=[][name]; const data=[]"),
    ],
  ])('retains range boundaries for %s', async (_name, input) => {
    const app = await application(input)
    const parent = app.container.querySelector('tbody')!
    expect([...parent.childNodes].filter((node) => node.nodeType === 8)).toHaveLength(2)
    app.click('#run')
    app.click('#clear')
    expect([...parent.childNodes].filter((node) => node.nodeType === 8)).toHaveLength(2)
  })

  it('retains range boundaries for request SSR', () => {
    expect(compileSSR(source).code).toContain('__RANGE_IDS__')
  })
})

describe('owned filter', () => {
  it('preserves sparse traversal, source length and predicate exceptions', () => {
    const values = [1, 2, 3]
    Reflect.deleteProperty(values, 1)
    const visited: number[] = []
    expect(
      filterOwnedListValues(values, (value, index) => {
        visited.push(index)
        if (index === 0) values.push(4)
        return value === 3
      }),
    ).toEqual([3])
    expect(visited).toEqual([0, 2])
    const failure = new Error('predicate')
    expect(() =>
      filterOwnedListValues([1, 2], () => {
        throw failure
      }),
    ).toThrow(failure)
  })
})
