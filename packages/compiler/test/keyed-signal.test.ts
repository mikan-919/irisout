import { createCollectionState, replaceCollection, updateCollectionItem } from '@irisout/runtime'
import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

function dispatchClick(container: Element, selector: string): void {
  const el = container.querySelector(selector)
  if (!el) throw new Error(`dispatchClick: ${selector} not found`)
  const Event = (
    container.ownerDocument as unknown as {
      defaultView: { Event: typeof globalThis.Event }
    }
  ).defaultView.Event
  el.dispatchEvent(new Event('click'))
}

const SOURCE = `
export function App() {
  const items = signal(
    [
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
    ],
    (item) => item.id,
  );
  render(
    <div>
      <p>{items().map((item) => item.text).join(',')}</p>
      <ul class="first">
        {items().map((item) => <li key={item.id}>{item.text}</li>)}
      </ul>
      <ol class="second">
        {items().map((item) => <li key={item.id}>{item.text}</li>)}
      </ol>
      <button class="update" onClick={() => items.update(1, (item) => ({ ...item, text: item.text + '!' }))}>update</button>
      <button class="replace" onClick={() => items([...items(), { id: 3, text: 'c' }])}>replace</button>
    </div>
  );
}
`

describe('keyed signal item updates', () => {
  it('updates one keyed item directly across multiple Lists and refreshes non-List dependents', async () => {
    const { code } = compile(SOURCE)
    expect(code).toContain('function update_items_item(__key__, __updater__)')
    expect(code.match(/__updateListItem__\(/g)).toHaveLength(2)
    const directUpdate = code.slice(
      code.indexOf('function update_items_item'),
      code.indexOf('return { mount'),
    )
    expect(directUpdate).not.toContain('__reconcileList__(')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => void)(container)
    const firstListItem = container.querySelector('.first li')
    const secondListItem = container.querySelector('.second li')

    dispatchClick(container, '.update')

    expect(container.querySelector('.first li')?.textContent).toBe('a!')
    expect(container.querySelector('.second li')?.textContent).toBe('a!')
    expect(container.querySelector('p')?.textContent).toBe('a!,b')
    expect(container.querySelector('.first li')).toBe(firstListItem)
    expect(container.querySelector('.second li')).toBe(secondListItem)
  })

  it('keeps the full replacement setter on the reconcile path', async () => {
    const { code } = compile(SOURCE)
    expect(code).toContain('items = __replaceCollection__(__collection_items__, ')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => void)(container)
    dispatchClick(container, '.replace')

    expect(container.querySelectorAll('.first li')).toHaveLength(3)
    expect(container.querySelectorAll('.second li')).toHaveLength(3)
  })

  it('rejects unknown keys and identity changes', () => {
    const state = createCollectionState([{ id: 1, text: 'a' }], (item) => item.id)

    expect(() => updateCollectionItem(state, 2, (item) => item)).toThrow(
      'signal.update: unknown key 2',
    )
    expect(() => updateCollectionItem(state, 1, (item) => ({ ...item, id: 2 }))).toThrow(
      'signal.update: key must remain 1, received 2',
    )
  })

  it('keeps the previous values when a replacement has duplicate identities', () => {
    const state = createCollectionState([{ id: 1 }], (item) => item.id)
    expect(() => replaceCollection(state, [{ id: 2 }, { id: 2 }])).toThrow(
      'signal: duplicate key 2',
    )
    expect(state.values).toEqual([{ id: 1 }])
  })

  it('rejects a List key that differs from the signal identity', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1, other: 'x' }], (item) => item.id);
  render(<ul>{items().map((item) => <li key={item.other}>{item.id}</li>)}</ul>);
}
`
    const mod = await loadGenerated(compile(source).code)
    const container = createContainer()
    expect(() => (mod.mountComponent as (container: Element) => void)(container)).toThrow(
      'keyed signal List key does not match signal identity',
    )
  })

  it('rejects duplicate signal identities during instance creation', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1 }, { id: 1 }], (item) => item.id);
  render(<ul>{items().map((item) => <li key={item.id}>{item.id}</li>)}</ul>);
}
`
    const mod = await loadGenerated(compile(source).code)
    expect(() => (mod.createComponent as () => unknown)()).toThrow('signal: duplicate key 1')
  })

  it('rejects the removed collection declaration', () => {
    expect(() =>
      compile(
        `export function App() { const items = collection([], (item) => item.id); render(<div />); }`,
      ),
    ).toThrow(/only top-level `signal\(\)`\/`derived\(\)` declarations.*scope limit/)
  })
})
