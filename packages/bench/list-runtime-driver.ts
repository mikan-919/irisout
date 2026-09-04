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

type Implementation = 'legacy' | 'addressed' | 'direct'
type UpdateScenario = 'updateOne' | 'appendOne' | 'removeOne' | 'reverse' | 'updateAll'
type Scenario = 'mount' | UpdateScenario

declare const __LIST_RUNTIME_IMPLEMENTATION__: Implementation
const implementation = __LIST_RUNTIME_IMPLEMENTATION__

interface MountedList {
  container: HTMLElement
  update(items: readonly Item[]): void
  updateItem?(item: Item): void
}

export interface ListRuntimeResult {
  elapsedMs: number
  mutationCount: number
  itemCount: number
  firstText: string | null
  middleText: string | null
  lastText: string | null
}

export interface DirectNotificationResult {
  elapsedMs: number
  elapsedPerUpdateMs: number
  middleText: string | null
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
      handle.update!(item)
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

type AddressedItemHandle = ListItemHandle<Item> & { state: ListItemState }

function updateAddressedItem(handle: ListItemHandle<Item>, next: Item): void {
  const addressed = handle as AddressedItemHandle
  if (updateListBinding(addressed.state, 'text', next.text)) addressed.el.textContent = next.text
}

function createAddressedItem(item: Item, state: ListItemState): AddressedItemHandle {
  const handle = { el: document.createElement('li'), state }
  updateAddressedItem(handle, item)
  return handle
}

function mountAddressed(items: readonly Item[], direct: boolean): MountedList {
  const container = document.createElement('ul')
  document.body.appendChild(container)
  const runtime = createListRuntime<Item>('bench-list')
  const update = (nextItems: readonly Item[]) =>
    reconcileList(
      runtime,
      container,
      nextItems,
      (item) => item.id,
      createAddressedItem,
      updateAddressedItem,
    )
  update(items)
  if (!direct) return { container, update }

  return {
    container,
    update,
    updateItem(item) {
      const record = runtime.items.get(item.id)
      if (!record) throw new Error(`direct List update: unknown item ${item.id}`)
      updateAddressedItem(record.handle, item)
    },
  }
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
  if (implementation === 'legacy') return mountLegacy(items)
  return mountAddressed(items, implementation === 'direct')
}

function update(mounted: MountedList, nextItems: readonly Item[], scenario: UpdateScenario): void {
  if (
    implementation !== 'direct' ||
    scenario === 'appendOne' ||
    scenario === 'removeOne' ||
    scenario === 'reverse'
  ) {
    mounted.update(nextItems)
    return
  }

  if (scenario === 'updateOne') {
    mounted.updateItem!(nextItems[Math.floor(nextItems.length / 2)]!)
    return
  }
  for (const item of nextItems) mounted.updateItem!(item)
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
    middleText: elements[Math.floor(elements.length / 2)]?.textContent ?? null,
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
  update(mounted, nextItems, scenario)
  const elapsedMs = performance.now() - start
  const mutationCount = observer.takeRecords().length
  observer.disconnect()

  const elements = mounted.container.children
  const result = {
    elapsedMs,
    mutationCount,
    itemCount: elements.length,
    firstText: elements[0]?.textContent ?? null,
    middleText: elements[Math.floor(elements.length / 2)]?.textContent ?? null,
    lastText: elements[elements.length - 1]?.textContent ?? null,
  }
  mounted.container.remove()
  return result
}

function measureRepeatedUpdateOne(size: number, iterations: number): DirectNotificationResult {
  document.body.textContent = ''
  const items = makeItems(size)
  const target = Math.floor(items.length / 2)
  const changedItems = nextItemsFor(items, 'updateOne')
  const mounted = mount(items)

  const start = performance.now()
  for (let iteration = 0; iteration < iterations; iteration++) {
    const nextItems = iteration % 2 === 0 ? changedItems : items
    update(mounted, nextItems, 'updateOne')
  }
  const elapsedMs = performance.now() - start
  const middleText = mounted.container.children[target]?.textContent ?? null
  mounted.container.remove()
  return { elapsedMs, elapsedPerUpdateMs: elapsedMs / iterations, middleText }
}

let retainedList: MountedList | undefined

function prepareHeap(size: number, scenario: Scenario): ListRuntimeResult {
  document.body.textContent = ''
  const items = makeItems(size)
  retainedList = mount(items)
  if (scenario !== 'mount') update(retainedList, nextItemsFor(items, scenario), scenario)

  const elements = retainedList.container.children
  return {
    elapsedMs: 0,
    mutationCount: 0,
    itemCount: elements.length,
    firstText: elements[0]?.textContent ?? null,
    middleText: elements[Math.floor(elements.length / 2)]?.textContent ?? null,
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
      measureRepeatedUpdateOne: typeof measureRepeatedUpdateOne
      prepareHeap: typeof prepareHeap
      releaseHeap: typeof releaseHeap
    }
  }
}

window.__listRuntimeBench = {
  measureMount,
  measureUpdate,
  measureRepeatedUpdateOne,
  prepareHeap,
  releaseHeap,
}
