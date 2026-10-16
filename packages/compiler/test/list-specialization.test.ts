// 一覧の保存領域・添字順と、明示したclick委譲の寿命を実DOMで確認する。
import { describe, expect, it, vi } from 'vite-plus/test'
import { compile } from '../src/compiler.ts'
import { FlatListHandle } from '../../runtime/src/index.ts'
import { createContainer, loadGenerated } from './helpers.ts'

const source = `export function App() {
  const rows = signal([{id:1,label:'a'},{id:2,label:'b'},{id:3,label:'c'}]);
  const selected = signal(0);
  render(<main><output>{selected()}</output><ul>{rows().map(row =>
    <li key={row.id} class={selected()===row.id?'on':''}><b>{row.id}</b><a onClick={()=>selected(row.id)}>{row.label}</a><button onClick={()=>rows(rows().filter(item=>item.id!==row.id))}><i>remove</i></button></li>
  )}</ul><button id="update" onClick={()=>rows(rows().map((row,index)=>index===0?{...row,label:row.label+'!'}:row))}>update</button><button id="replace" onClick={()=>rows([{id:4,label:'d'},{id:5,label:'e'}])}>replace</button><button id="filter" onClick={()=>rows(rows().filter(row=>row.id!==2 && row.id!==4))}>filter</button></main>);
}`

async function application(listEvents: 'direct' | 'delegated' = 'direct') {
  const { code } = compile(source, { listEvents })
  const container = createContainer()
  const mod = await loadGenerated(code)
  const instance = (mod.createComponent as () => { mount(el: Element): void; unmount(): void })()
  const add = vi.spyOn(
    container.ownerDocument.defaultView!.EventTarget.prototype,
    'addEventListener',
  )
  instance.mount(container)
  const rowRegistrations = add.mock.instances.filter(
    (target) =>
      target instanceof container.ownerDocument.defaultView!.Element && target.closest('li'),
  ).length
  add.mockRestore()
  const click = (selector: string) =>
    container
      .querySelector(selector)!
      .dispatchEvent(new container.ownerDocument.defaultView!.Event('click', { bubbles: true }))
  return { container, click, instance, rowRegistrations }
}

describe('list specialization', () => {
  it('routes nested targets from the child to the root without retaining handler-only elements', async () => {
    const { code } = compile(
      `export function App(){const rows=signal([{id:1}]);const seen=signal(0);render(<main><output>{seen()}</output><ul>{rows().map(row=><li key={row.id} onClick={()=>seen(seen()+10)}><button onClick={()=>seen(seen()+1)}><i>click</i></button></li>)}</ul></main>);}`,
      { listEvents: 'delegated' },
    )
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (el: Element) => void)(container)
    container
      .querySelector('i')!
      .dispatchEvent(new container.ownerDocument.defaultView!.Event('click', { bubbles: true }))
    expect(container.querySelector('output')?.textContent).toBe('11')
  })

  it('uses one record per row and retains only the root and changing display reference', async () => {
    const app = await application()
    const li = app.container.querySelector('li')!
    const anchor = li.querySelector('a')!
    const handle = Object.getOwnPropertySymbols(anchor)
      .map((key) => Reflect.get(anchor, key))
      .find((value) => value instanceof FlatListHandle) as FlatListHandle<unknown>
    expect(handle).toBeInstanceOf(FlatListHandle)
    expect(handle.handle).toBe(handle)
    expect(handle.state).toBe(handle.state)
    expect([handle.state.listId, handle.state.itemId]).toEqual([expect.any(String), 1])
    expect(
      Object.values(handle).filter(
        (value) => value instanceof app.container.ownerDocument.defaultView!.Element,
      ),
    ).toEqual([li, anchor])
    expect(Object.keys(handle).filter((key) => key.startsWith('text_'))).toHaveLength(1)
    app.click('#update')
    app.click('li a')
    expect(anchor.textContent).toBe('a!')
    expect(li.className).toBe('on')
    expect(app.container.querySelector('output')?.textContent).toBe('1')
    expect(app.rowRegistrations).toBe(6)
  })

  it.each(['direct', 'delegated'] as const)(
    'keeps index updates correct after filtering and replacing in %s mode',
    async (mode) => {
      const app = await application(mode)
      app.click('#filter')
      app.click('#update')
      expect([...app.container.querySelectorAll('li a')].map((el) => el.textContent)).toEqual([
        'a!',
        'c',
      ])
      app.click('#replace')
      app.click('#filter')
      app.click('#update')
      expect([...app.container.querySelectorAll('li')].map((el) => el.textContent)).toEqual([
        '5e!remove',
      ])
      app.click('li a')
      expect(app.container.querySelector('output')?.textContent).toBe('5')
    },
  )

  it('delegates child clicks, rejects removed records and removes the parent listener on unmount', async () => {
    const app = await application('delegated')
    expect(app.rowRegistrations).toBe(0)
    const parent = app.container.querySelector('ul')!
    const removed = parent.querySelector('li')!
    removed
      .querySelector('a')!
      .dispatchEvent(new app.container.ownerDocument.defaultView!.Event('click'))
    expect(app.container.querySelector('output')?.textContent).toBe('0')
    app.click('li a')
    expect(removed.className).toBe('on')
    app.click('li i')
    expect(parent.children).toHaveLength(2)
    app.click('li a')
    expect(app.container.querySelector('output')?.textContent).toBe('2')
    parent.append(removed)
    removed
      .querySelector('a')!
      .dispatchEvent(new app.container.ownerDocument.defaultView!.Event('click', { bubbles: true }))
    // 削除済みの要素を戻しても、そのイベントから状態を書き換えない。
    expect(app.container.querySelector('output')?.textContent).toBe('2')
    const remove = vi.spyOn(parent, 'removeEventListener')
    app.instance.unmount()
    expect(remove).toHaveBeenCalledWith('click', expect.any(Function))
    remove.mockRestore()
  })

  it('keeps parameterized click and non-bubbling blur on native direct listeners', async () => {
    const { code } = compile(
      `export function App(){const rows=signal([{id:1}]);const seen=signal('');render(<main><output>{seen()}</output><ul>{rows().map(row=><li key={row.id}><button onClick={(event)=>seen(event.currentTarget.tagName)}>click</button><input onBlur={()=>seen('blur')} /></li>)}</ul></main>);}`,
      { listEvents: 'delegated' },
    )
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (el: Element) => void)(container)
    container
      .querySelector('button')!
      .dispatchEvent(new container.ownerDocument.defaultView!.Event('click'))
    expect(container.querySelector('output')?.textContent).toBe('BUTTON')
    container
      .querySelector('input')!
      .dispatchEvent(new container.ownerDocument.defaultView!.Event('blur'))
    expect(container.querySelector('output')?.textContent).toBe('blur')
  })
})
