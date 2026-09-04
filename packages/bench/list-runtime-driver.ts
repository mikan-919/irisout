import {
  createListRuntime,
  reconcileList,
  updateListBinding,
  type ListItemHandle,
  type ListItemState,
} from '@irisout/runtime'

interface Item {
  id: number
  text: string
}

type Implementation = 'legacy' | 'addressed'
type UpdateScenario = 'updateOne' | 'appendOne' | 'removeOne' | 'reverse' | 'updateAll'
type Scenario = 'mount' | UpdateScenario

declare const __LIST_RUNTIME_IMPLEMENTATION__: Implementation
const implementation = __LIST_RUNTIME_IMPLEMENTATION__

interface MountedList {
  container: HTMLElement
  update(items: readonly Item[]): void
}

export interface ListRuntimeResult {
  elapsedMs: number
  mutationCount: number
  itemCount: number
  firstText: string | null
  lastText: string | null
}

function makeItems(size: number): Item[] {
  return Array.from({ length: size }, (_, index) => ({
    id: index + 1,
    text: `item ${index + 1}`,
  }))
}

function createItem(_item: Item): ListItemHandle<Item> {
  const el = document.createElement('li')
  return {
    el,
    update(next) {
      el.textContent = next.text
    },
  }
}

// ADR-0005時点の方式: 全keyを走査し、全handleを更新した後、順序に関係なく
// appendChild()する。比較専用fixtureであり、製品コードからは使用しない。
function mountLegacy(items: readonly Item[]): MountedList {
  const container = document.createElement('ul')
  document.body.appendChild(container)
  const handles = new Map<number, ListItemHandle<Item>>()

  function update(nextItems: readonly Item[]) {
    const seen = new Set<number>()
    for (const item of nextItems) {
      seen.add(item.id)
      let handle = handles.get(item.id)
      if (!handle) {
        handle = createItem(item)
        handles.set(item.id, handle)
      }
      handle.update(item)
    }
    for (const [id, handle] of handles) {
      if (seen.has(id)) continue
      handle.el.remove()
      handles.delete(id)
    }
    for (const item of nextItems) container.appendChild(handles.get(item.id)!.el)
  }

  update(items)
  return { container, update }
}

function createAddressedItem(item: Item, state: ListItemState): ListItemHandle<Item> {
  const el = document.createElement('li')
  const handle = {
    el,
    update(next: Item) {
      if (updateListBinding(state, 'text', next.text)) el.textContent = next.text
    },
  }
  handle.update(item)
  return handle
}

function mountAddressed(items: readonly Item[]): MountedList {
  const container = document.createElement('ul')
  document.body.appendChild(container)
  const runtime = createListRuntime<Item>('bench-list')
  const update = (nextItems: readonly Item[]) =>
    reconcileList(runtime, container, nextItems, (item) => item.id, createAddressedItem)
  update(items)
  return { container, update }
}

function nextItemsFor(items: readonly Item[], scenario: UpdateScenario): Item[] {
  switch (scenario) {
    case 'updateOne':
      return items.map((item, index) =>
        index === Math.floor(items.length / 2) ? { ...item, text: `${item.text}!` } : item,
      )
    case 'appendOne':
      return [...items, { id: items.length + 1, text: `item ${items.length + 1}` }]
    case 'removeOne':
      return items.slice(0, -1)
    case 'reverse':
      return [...items].reverse()
    case 'updateAll':
      return items.map((item) => ({ ...item, text: `${item.text}!` }))
  }
}

function mount(items: readonly Item[]): MountedList {
  return implementation === 'legacy' ? mountLegacy(items) : mountAddressed(items)
}

function measureMount(size: number): ListRuntimeResult {
  document.body.textContent = ''
  const items = makeItems(size)
  const start = performance.now()
  const mounted = mount(items)
  const elapsedMs = performance.now() - start
  const elements = mounted.container.children
  const result = {
    elapsedMs,
    mutationCount: 0,
    itemCount: elements.length,
    firstText: elements[0]?.textContent ?? null,
    lastText: elements[elements.length - 1]?.textContent ?? null,
  }
  mounted.container.remove()
  return result
}

function measureUpdate(size: number, scenario: UpdateScenario): ListRuntimeResult {
  document.body.textContent = ''
  const items = makeItems(size)
  const nextItems = nextItemsFor(items, scenario)
  const mounted = mount(items)
  const observer = new MutationObserver(() => {})
  observer.observe(mounted.container, { childList: true, characterData: true, subtree: true })

  const start = performance.now()
  mounted.update(nextItems)
  const elapsedMs = performance.now() - start
  const mutationCount = observer.takeRecords().length
  observer.disconnect()

  const elements = mounted.container.children
  const result = {
    elapsedMs,
    mutationCount,
    itemCount: elements.length,
    firstText: elements[0]?.textContent ?? null,
    lastText: elements[elements.length - 1]?.textContent ?? null,
  }
  mounted.container.remove()
  return result
}

let retainedList: MountedList | undefined

function prepareHeap(size: number, scenario: Scenario): ListRuntimeResult {
  document.body.textContent = ''
  const items = makeItems(size)
  retainedList = mount(items)
  if (scenario !== 'mount') retainedList.update(nextItemsFor(items, scenario))

  const elements = retainedList.container.children
  return {
    elapsedMs: 0,
    mutationCount: 0,
    itemCount: elements.length,
    firstText: elements[0]?.textContent ?? null,
    lastText: elements[elements.length - 1]?.textContent ?? null,
  }
}

function releaseHeap(): void {
  retainedList = undefined
  document.body.textContent = ''
}

declare global {
  interface Window {
    __listRuntimeBench: {
      measureMount: typeof measureMount
      measureUpdate: typeof measureUpdate
      prepareHeap: typeof prepareHeap
      releaseHeap: typeof releaseHeap
    }
  }
}

window.__listRuntimeBench = { measureMount, measureUpdate, prepareHeap, releaseHeap }
