import * as React from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'

// これら2つのモジュールは todomvc-compiler.playwright.ts がコンパイラ出力を
// 仮想モジュールとして注入する。実行時にこのファイルを単独で読み込むことはない。
// @ts-expect-error ベンチマークビルド専用の仮想モジュール
import * as generatedActualModule from 'virtual:irisout-todomvc-generated-actual'
// @ts-expect-error ベンチマークビルド専用の仮想モジュール
import * as generatedBenchModule from 'virtual:irisout-todomvc-generated-bench'

// @ts-expect-error 比較用のJavaScript fixtureは型宣言を持たない
import { mountComponent as mountHandwritten } from '../../apps/examples/todomvc.handwritten.js'
import { TodoApp } from '../../apps/examples/todomvc.react.tsx'

interface Todo {
  id: number
  text: string
  completed: boolean
}

export type Implementation = 'generated' | 'handwritten' | 'react'
export type Scenario = 'mount' | 'toggleOne' | 'textEdit' | 'addOne' | 'removeOne' | 'filter'

interface GeneratedInstance {
  unmount(): void
}

type GeneratedHydrate = (container: Element) => GeneratedInstance

interface Mounted {
  implementation: Implementation
  container: HTMLElement
  generated?: GeneratedInstance
  root?: Root
}

interface MutationMetrics {
  mutationRecords: number
  childListRecords: number
  attributeRecords: number
  characterDataRecords: number
  liAttached: number
  liDetached: number
  createdLis: number
  destroyedLis: number
  changedTodoCount: number
  unrelatedTodoDomChanged: boolean
  listMovedCount: number
  listRepositioned: boolean
}

export interface ScenarioResult {
  implementation: Implementation
  scenario: Scenario
  n: number
  elapsedMs: number
  finalTodoCount: number
  finalSignature: string
  mutationRecords: number
  childListRecords: number
  attributeRecords: number
  characterDataRecords: number
  liAttached: number
  liDetached: number
  createdLis: number
  destroyedLis: number
  changedTodoCount: number
  unrelatedTodoDomChanged: boolean
  listMovedCount: number
  listRepositioned: boolean
}

export interface MountInternalsResult {
  implementation: Implementation
  n: number
  listenerCount: number
  listenersInContainer: number
  listenersOnContainer: number
  listenersOnItems: number
  listenersOutsideContainer: number
  listenerTypes: Record<string, number>
  querySelectorCalls: number
  querySelectorAllCalls: number
  itemCount: number
}

interface ParityResult {
  implementation: Implementation
  initialTodoCount: number
  finalTodoCount: number
  finalTexts: string[]
}

declare global {
  var __IRISOUT_BENCH_INITIAL_TODOS__: Todo[] | undefined
}

const generatedActualInitialHtml = generatedActualModule.generatedInitialHtml
const generatedBenchInitialHtml = generatedBenchModule.generatedInitialHtml
const actualHydrate = generatedActualModule.hydrateComponent as unknown as GeneratedHydrate
const benchHydrate = generatedBenchModule.hydrateComponent as unknown as GeneratedHydrate

function makeTodos(n: number, alternating = false): Todo[] {
  return Array.from({ length: n }, (_, index) => ({
    id: index + 1,
    text: `todo ${index + 1}`,
    completed: alternating ? index % 2 === 1 : false,
  }))
}

function parityTodos(): Todo[] {
  return [
    { id: 1, text: 'irisout を書く', completed: false },
    { id: 2, text: '牛乳を買う', completed: true },
  ]
}

function freshContainer(): HTMLElement {
  document.body.replaceChildren()
  const container = document.createElement('div')
  document.body.appendChild(container)
  return container
}

function prepareContainer(
  implementation: Implementation,
  todos: Todo[],
  useActualGeneratedHtml = false,
): HTMLElement {
  const container = freshContainer()
  if (implementation === 'generated') {
    // 生成版のrootは外部から初期配列を受け取るAPIをまだ持たない。元の
    // authoringファイルは変更せず、計測用コンパイル出力だけがこの値を読む。
    globalThis.__IRISOUT_BENCH_INITIAL_TODOS__ = todos
    container.innerHTML = String(
      useActualGeneratedHtml ? generatedActualInitialHtml : generatedBenchInitialHtml,
    )
  }
  return container
}

function mountPrepared(
  implementation: Implementation,
  container: HTMLElement,
  todos: Todo[],
  useActualGenerated = false,
): Mounted {
  if (implementation === 'generated') {
    const generated = (useActualGenerated ? actualHydrate : benchHydrate)(container)
    // 計測用の外部初期配列はcomponentがstateとして保持しているため、
    // component外の参照を残さない。残すと更新後の古い配列までヒープに残る。
    globalThis.__IRISOUT_BENCH_INITIAL_TODOS__ = undefined
    return { implementation, container, generated }
  }
  if (implementation === 'handwritten') {
    mountHandwritten(container, todos)
    return { implementation, container }
  }
  const root = createRoot(container)
  flushSync(() => root.render(React.createElement(TodoApp, { initialTodos: todos })))
  return { implementation, container, root }
}

function cleanup(mounted: Mounted): void {
  if (mounted.generated) mounted.generated.unmount()
  if (mounted.root) mounted.root.unmount()
  mounted.container.remove()
}

function runWithFlush(mounted: Mounted, callback: () => void): void {
  if (mounted.implementation === 'react') flushSync(callback)
  else callback()
}

function click(mounted: Mounted, element: HTMLElement): void {
  runWithFlush(mounted, () => element.click())
}

function keydown(mounted: Mounted, element: HTMLElement, key: string): void {
  runWithFlush(mounted, () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

function doubleClick(mounted: Mounted, element: HTMLElement): void {
  runWithFlush(mounted, () => {
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  })
}

function setReactInputValue(element: HTMLInputElement, value: string): void {
  const prototype = Object.getPrototypeOf(element) as HTMLInputElement
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
  descriptor?.set?.call(element, value)
}

function setNewTodoInput(mounted: Mounted, value: string): void {
  const input = mounted.container.querySelector('.todoapp > input') as HTMLInputElement | null
  if (!input) throw new Error(`${mounted.implementation}: new-todo input not found`)
  if (mounted.implementation === 'react') {
    setReactInputValue(input, value)
    runWithFlush(mounted, () => input.dispatchEvent(new Event('input', { bubbles: true })))
  } else {
    input.value = value
  }
  keydown(mounted, input, 'Enter')
}

function listItems(container: Element): HTMLElement[] {
  return Array.from(container.querySelectorAll('.todo-list li')) as HTMLElement[]
}

function listText(item: HTMLElement): string {
  const span = item.querySelector('span')
  if (span) return span.textContent ?? ''
  const textButton = Array.from(item.querySelectorAll('button')).find(
    (button) => (button.textContent ?? '').trim() !== 'x',
  )
  return textButton?.textContent ?? ''
}

function listTexts(container: Element): string[] {
  return listItems(container).map(listText)
}

function activeCount(container: Element): string {
  return container.querySelector('.todoapp > span')?.textContent ?? ''
}

function todoTrigger(item: HTMLElement): HTMLElement {
  const span = item.querySelector('span') as HTMLElement | null
  if (span) return span
  const button = Array.from(item.querySelectorAll('button')).find(
    (candidate) => (candidate.textContent ?? '').trim() !== 'x',
  )
  if (!button) throw new Error('edit trigger not found')
  return button
}

function editInput(item: HTMLElement): HTMLInputElement {
  const input = item.querySelector('input:not([type="checkbox"])') as HTMLInputElement | null
  if (!input) throw new Error('edit input not found')
  return input
}

function removeButton(item: HTMLElement): HTMLElement {
  const buttons = Array.from(item.querySelectorAll('button')) as HTMLElement[]
  const button = buttons.at(-1)
  if (!button) throw new Error('remove button not found')
  return button
}

function filterButton(container: Element, name: 'all' | 'active' | 'completed'): HTMLElement {
  const button =
    (container.querySelector(`[data-filter="${name}"]`) as HTMLElement | null) ??
    (Array.from(container.querySelectorAll('.filters button')).find(
      (candidate) => (candidate.textContent ?? '').trim().toLowerCase() === name,
    ) as HTMLElement | undefined)
  if (!button) throw new Error(`filter button not found: ${name}`)
  return button
}

function scenarioSignature(container: Element): string {
  const texts = listTexts(container)
  return JSON.stringify({
    count: texts.length,
    first: texts[0] ?? null,
    middle: texts[Math.floor(texts.length / 2)] ?? null,
    last: texts.at(-1) ?? null,
    activeCount: activeCount(container),
  })
}

function allLisIn(node: Node): HTMLElement[] {
  const result: HTMLElement[] = []
  const visit = (current: Node): void => {
    if (current.nodeType === 1 && (current as Element).tagName === 'LI') {
      result.push(current as HTMLElement)
    }
    for (let child = current.firstChild; child; child = child.nextSibling) visit(child)
  }
  visit(node)
  return result
}

function markAncestor(node: Node, before: Set<HTMLElement>, changed: Set<HTMLElement>): void {
  let current: Node | null = node.nodeType === 1 ? node : node.parentNode
  while (current) {
    if (current.nodeType === 1 && before.has(current as HTMLElement)) {
      changed.add(current as HTMLElement)
      return
    }
    current = current.parentNode
  }
}

function mutationMetrics(
  observer: MutationObserver,
  container: HTMLElement,
  beforeItems: HTMLElement[],
  beforeList: Element | null,
  targetIndex: number | undefined,
): MutationMetrics {
  const records = observer.takeRecords()
  const before = new Set(beforeItems)
  const afterItems = listItems(container)
  const after = new Set(afterItems)
  const changed = new Set<HTMLElement>()
  const moved = new Set<HTMLElement>()
  let childListRecords = 0
  let attributeRecords = 0
  let characterDataRecords = 0
  let liAttached = 0
  let liDetached = 0

  for (const record of records) {
    if (record.type === 'childList') childListRecords++
    if (record.type === 'attributes') attributeRecords++
    if (record.type === 'characterData') characterDataRecords++
    markAncestor(record.target, before, changed)

    for (const node of record.addedNodes) {
      const lis = allLisIn(node)
      liAttached += lis.length
      for (const item of lis) {
        if (before.has(item)) changed.add(item)
        if (record.target === beforeList && before.has(item) && after.has(item)) moved.add(item)
      }
    }
    for (const node of record.removedNodes) {
      const lis = allLisIn(node)
      liDetached += lis.length
      for (const item of lis) {
        if (before.has(item)) changed.add(item)
      }
    }
  }

  const createdLis = afterItems.filter((item) => !before.has(item)).length
  const destroyedLis = beforeItems.filter((item) => !after.has(item)).length
  const target = targetIndex === undefined ? undefined : beforeItems[targetIndex]
  const unrelatedTodoDomChanged = target
    ? [...changed].some((item) => item !== target)
    : changed.size > 0
  const afterList = container.querySelector('.todo-list')
  const listRepositioned = moved.size > 0 || (!!beforeList && beforeList !== afterList)

  return {
    mutationRecords: records.length,
    childListRecords,
    attributeRecords,
    characterDataRecords,
    liAttached,
    liDetached,
    createdLis,
    destroyedLis,
    changedTodoCount: changed.size,
    unrelatedTodoDomChanged,
    listMovedCount: moved.size,
    listRepositioned,
  }
}

function emptyMutationMetrics(): MutationMetrics {
  return {
    mutationRecords: 0,
    childListRecords: 0,
    attributeRecords: 0,
    characterDataRecords: 0,
    liAttached: 0,
    liDetached: 0,
    createdLis: 0,
    destroyedLis: 0,
    changedTodoCount: 0,
    unrelatedTodoDomChanged: false,
    listMovedCount: 0,
    listRepositioned: false,
  }
}

function toScenarioResult(
  implementation: Implementation,
  scenario: Scenario,
  n: number,
  elapsedMs: number,
  container: HTMLElement,
  metrics: MutationMetrics,
): ScenarioResult {
  return {
    implementation,
    scenario,
    n,
    elapsedMs,
    finalTodoCount: listItems(container).length,
    finalSignature: scenarioSignature(container),
    ...metrics,
  }
}

export function runScenario(
  implementation: Implementation,
  n: number,
  scenario: Scenario,
): ScenarioResult {
  const todos = makeTodos(n, scenario === 'filter')
  const container = prepareContainer(implementation, todos)

  if (scenario === 'mount') {
    const start = performance.now()
    const mounted = mountPrepared(implementation, container, todos)
    const elapsedMs = performance.now() - start
    const result = toScenarioResult(
      implementation,
      scenario,
      n,
      elapsedMs,
      container,
      emptyMutationMetrics(),
    )
    cleanup(mounted)
    return result
  }

  const mounted = mountPrepared(implementation, container, todos)
  const beforeItems = listItems(container)
  const beforeList = container.querySelector('.todo-list')
  const targetIndex =
    scenario === 'toggleOne' || scenario === 'textEdit'
      ? Math.floor(n / 2)
      : scenario === 'removeOne'
        ? n - 1
        : undefined

  if (scenario === 'textEdit') {
    const item = beforeItems[targetIndex ?? 0]
    if (!item) throw new Error('text-edit target not found')
    doubleClick(mounted, todoTrigger(item))
    editInput(item).value = 'edited item'
  }

  const observer = new MutationObserver(() => {})
  observer.observe(container, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  })

  const start = performance.now()
  switch (scenario) {
    case 'toggleOne': {
      const item = beforeItems[targetIndex ?? 0]
      const checkbox = item?.querySelector('input[type="checkbox"]') as HTMLElement | null
      if (!checkbox) throw new Error('toggle target not found')
      click(mounted, checkbox)
      break
    }
    case 'textEdit': {
      const item = beforeItems[targetIndex ?? 0]
      if (!item) throw new Error('text-edit target disappeared')
      keydown(mounted, editInput(item), 'Enter')
      break
    }
    case 'addOne':
      setNewTodoInput(mounted, 'new item')
      break
    case 'removeOne': {
      const item = beforeItems.at(-1)
      if (!item) throw new Error('remove target not found')
      click(mounted, removeButton(item))
      break
    }
    case 'filter':
      click(mounted, filterButton(container, 'active'))
      click(mounted, filterButton(container, 'completed'))
      break
  }
  const elapsedMs = performance.now() - start
  const metrics = mutationMetrics(observer, container, beforeItems, beforeList, targetIndex)
  observer.disconnect()
  const result = toScenarioResult(implementation, scenario, n, elapsedMs, container, metrics)
  cleanup(mounted)
  return result
}

function assertState(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function expectTexts(container: Element, expected: string[], label: string): void {
  const actual = listTexts(container)
  assertState(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  )
}

export function runParity(implementation: Implementation): ParityResult {
  const todos = parityTodos()
  const container = prepareContainer(implementation, todos, implementation === 'generated')
  const mounted = mountPrepared(implementation, container, todos, implementation === 'generated')

  try {
    expectTexts(container, ['irisout を書く', '牛乳を買う'], `${implementation}/initial`)
    assertState(listItems(container).length === 2, `${implementation}/initial count`)

    setNewTodoInput(mounted, 'new item')
    expectTexts(container, ['irisout を書く', '牛乳を買う', 'new item'], `${implementation}/add`)

    const first = listItems(container)[0]
    const checkbox = first?.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    assertState(!!checkbox, `${implementation}/toggle target`)
    click(mounted, checkbox)
    assertState(checkbox.checked, `${implementation}/toggle checked`)
    assertState(activeCount(container) === '1 items left', `${implementation}/toggle count`)

    click(mounted, filterButton(container, 'all'))
    expectTexts(container, ['irisout を書く', '牛乳を買う', 'new item'], `${implementation}/all`)
    click(mounted, filterButton(container, 'active'))
    expectTexts(container, ['new item'], `${implementation}/active`)
    click(mounted, filterButton(container, 'completed'))
    expectTexts(container, ['irisout を書く', '牛乳を買う'], `${implementation}/completed`)
    click(mounted, filterButton(container, 'all'))

    const editTarget = listItems(container)[0]
    assertState(!!editTarget, `${implementation}/edit target`)
    doubleClick(mounted, todoTrigger(editTarget))
    const input = editInput(editTarget)
    input.value = 'edited item'
    keydown(mounted, input, 'Enter')
    assertState(listTexts(container)[0] === 'edited item', `${implementation}/edit commit`)

    const last = listItems(container).at(-1)
    assertState(!!last, `${implementation}/remove target`)
    click(mounted, removeButton(last))
    expectTexts(container, ['edited item', '牛乳を買う'], `${implementation}/remove`)
    return {
      implementation,
      initialTodoCount: 2,
      finalTodoCount: listItems(container).length,
      finalTexts: listTexts(container),
    }
  } finally {
    cleanup(mounted)
  }
}

type AddEventListener = (
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | AddEventListenerOptions,
) => void

type QuerySelector = (selectors: string) => Element | null
type QuerySelectorAll = (selectors: string) => NodeListOf<Element>

export function measureMountInternals(
  implementation: Implementation,
  n: number,
): MountInternalsResult {
  const todos = makeTodos(n)
  const container = prepareContainer(implementation, todos)
  const eventTargetPrototype = EventTarget.prototype as unknown as {
    addEventListener: AddEventListener
  }
  const elementPrototype = Element.prototype as unknown as {
    querySelector: QuerySelector
    querySelectorAll: QuerySelectorAll
  }
  const originalAddEventListener = eventTargetPrototype.addEventListener
  const originalQuerySelector = elementPrototype.querySelector
  const originalQuerySelectorAll = elementPrototype.querySelectorAll
  const listeners: { target: EventTarget; type: string }[] = []
  let querySelectorCalls = 0
  let querySelectorAllCalls = 0

  eventTargetPrototype.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    listeners.push({ target: this, type })
    originalAddEventListener.call(this, type, listener, options)
  }
  elementPrototype.querySelector = function (this: Element, selectors: string): Element | null {
    querySelectorCalls++
    return originalQuerySelector.call(this, selectors)
  }
  elementPrototype.querySelectorAll = function (
    this: Element,
    selectors: string,
  ): NodeListOf<Element> {
    querySelectorAllCalls++
    return originalQuerySelectorAll.call(this, selectors)
  }

  let mounted: Mounted | undefined
  try {
    mounted = mountPrepared(implementation, container, todos)
  } finally {
    eventTargetPrototype.addEventListener = originalAddEventListener
    elementPrototype.querySelector = originalQuerySelector
    elementPrototype.querySelectorAll = originalQuerySelectorAll
  }

  const items = listItems(container)
  const itemSet = new Set(items)
  const isInContainer = (target: EventTarget): boolean =>
    target === container || (target instanceof Node && container.contains(target))
  const isOnItem = (target: EventTarget): boolean => {
    if (!(target instanceof Element)) return false
    return !!target.closest('li') && itemSet.has(target.closest('li') as HTMLElement)
  }
  const listenersInContainer = listeners.filter(({ target }) => isInContainer(target)).length
  const listenersOnContainer = listeners.filter(({ target }) => target === container).length
  const listenersOnItems = listeners.filter(({ target }) => isOnItem(target)).length
  const listenerTypeCounts = new Map<string, number>()
  for (const { type } of listeners) {
    listenerTypeCounts.set(type, (listenerTypeCounts.get(type) ?? 0) + 1)
  }
  const listenerTypes = Object.fromEntries(
    [...listenerTypeCounts].sort(([left], [right]) => left.localeCompare(right)),
  ) as Record<string, number>
  const result = {
    implementation,
    n,
    listenerCount: listeners.length,
    listenersInContainer,
    listenersOnContainer,
    listenersOnItems,
    listenersOutsideContainer: listeners.length - listenersInContainer,
    listenerTypes,
    querySelectorCalls,
    querySelectorAllCalls,
    itemCount: items.length,
  }
  if (mounted) cleanup(mounted)
  return result
}

let held: Mounted | undefined

export function prepareHeap(implementation: Implementation, n: number): void {
  if (held) cleanup(held)
  const todos = makeTodos(n)
  const container = prepareContainer(implementation, todos)
  held = mountPrepared(implementation, container, todos)
}

export function updateHeld(): void {
  if (!held) throw new Error('heap fixture is not mounted')
  const item = listItems(held.container)[Math.floor(listItems(held.container).length / 2)]
  const checkbox = item?.querySelector('input[type="checkbox"]') as HTMLElement | null
  if (!checkbox) throw new Error('heap toggle target not found')
  click(held, checkbox)
}

export function deleteAllHeld(): void {
  if (!held) throw new Error('heap fixture is not mounted')
  while (listItems(held.container).length > 0) {
    const item = listItems(held.container).at(-1)
    if (!item) throw new Error('heap delete target not found')
    click(held, removeButton(item))
  }
  globalThis.__IRISOUT_BENCH_INITIAL_TODOS__ = undefined
}

export function releaseHeap(): void {
  if (held) cleanup(held)
  held = undefined
  globalThis.__IRISOUT_BENCH_INITIAL_TODOS__ = undefined
  document.body.replaceChildren()
}

declare global {
  interface Window {
    __todomvcCompilerBench: {
      runScenario: typeof runScenario
      runParity: typeof runParity
      measureMountInternals: typeof measureMountInternals
      prepareHeap: typeof prepareHeap
      updateHeld: typeof updateHeld
      deleteAllHeld: typeof deleteAllHeld
      releaseHeap: typeof releaseHeap
    }
  }
}

window.__todomvcCompilerBench = {
  runScenario,
  runParity,
  measureMountInternals,
  prepareHeap,
  updateHeld,
  deleteAllHeld,
  releaseHeap,
}
