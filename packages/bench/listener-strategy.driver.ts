// 実Chromium内で、リスト項目の直接リスナーと親要素へのイベント委譲を
// 同じDOM・同じイベント列で比較するfixture。clickだけでなく、非バブルの
// blur、入力要素、子要素をtargetにするclick/dblclickを含める。

type Strategy = 'direct' | 'delegated' | 'capture' | 'adapter'

declare const __LISTENER_STRATEGY__: Strategy

const strategy = __LISTENER_STRATEGY__
const EVENT_TYPES = ['click', 'change', 'input', 'keydown', 'dblclick', 'blur'] as const
type EventType = (typeof EVENT_TYPES)[number]

interface ItemRecord {
  id: number
  clickControl: HTMLButtonElement
  changeControl: HTMLInputElement
  inputControl: HTMLInputElement
  doubleClickControl: HTMLButtonElement
  handled: number
  handledByEvent: Record<EventType, number>
  currentTargetMatches: number
  nativeEventIdentityMatches: number
  targetMatches: number
  phaseCounts: Record<EventType, Record<string, number>>
}

interface Fixture {
  root: HTMLUListElement
  records: ItemRecord[]
  listenerCount: number
}

interface TimingResult {
  elapsedMs: number
  itemCount: number
  listenerCount: number
  firstId: number | null
  middleId: number | null
  lastId: number | null
}

interface DispatchResult extends TimingResult {
  eventCount: number
  handledCount: number
  handledByEvent: Record<EventType, number>
  currentTargetMatches: number
  nativeEventIdentityMatches: number
  targetMatches: number
  phaseCounts: Record<EventType, Record<string, number>>
  identityChecksum: number
}

interface HeapFixtureResult {
  itemCount: number
  listenerCount: number
}

function emptyEventCounts(): Record<EventType, number> {
  return Object.fromEntries(EVENT_TYPES.map((type) => [type, 0])) as Record<EventType, number>
}

function emptyPhaseCounts(): Record<EventType, Record<string, number>> {
  return Object.fromEntries(EVENT_TYPES.map((type) => [type, {}])) as Record<
    EventType,
    Record<string, number>
  >
}

function makeFixture(size: number): Fixture {
  const root = document.createElement('ul')
  root.dataset.listenerBenchRoot = ''
  const records: ItemRecord[] = []

  for (let index = 0; index < size; index++) {
    const id = index + 1
    const li = document.createElement('li')
    const clickControl = document.createElement('button')
    const clickTarget = document.createElement('span')
    const changeControl = document.createElement('input')
    const inputControl = document.createElement('input')
    const doubleClickControl = document.createElement('button')
    const doubleClickTarget = document.createElement('span')

    clickControl.type = 'button'
    clickControl.dataset.listenerBenchControl = 'click'
    clickTarget.textContent = `toggle ${id}`
    clickControl.append(clickTarget)

    changeControl.type = 'checkbox'
    changeControl.dataset.listenerBenchControl = 'change'

    inputControl.type = 'text'
    inputControl.dataset.listenerBenchControl = 'input'
    inputControl.value = `item ${id}`

    doubleClickControl.type = 'button'
    doubleClickControl.dataset.listenerBenchControl = 'dblclick'
    doubleClickTarget.textContent = `edit ${id}`
    doubleClickControl.append(doubleClickTarget)

    li.append(clickControl, changeControl, inputControl, doubleClickControl)
    root.append(li)
    records.push({
      id,
      clickControl,
      changeControl,
      inputControl,
      doubleClickControl,
      handled: 0,
      handledByEvent: emptyEventCounts(),
      currentTargetMatches: 0,
      nativeEventIdentityMatches: 0,
      targetMatches: 0,
      phaseCounts: emptyPhaseCounts(),
    })
  }

  document.body.append(root)
  return { root, records, listenerCount: 0 }
}

function listen(
  fixture: Fixture,
  target: EventTarget,
  type: EventType,
  handler: EventListener,
  capture = false,
): void {
  target.addEventListener(type, handler, capture)
  fixture.listenerCount++
}

// 直接方式と他方式で共有する意味的なハンドラ本体。eventは直接方式では
// ネイティブイベント、adapter方式ではcurrentTargetを差し替えたProxyになる。
function runItemHandler(
  record: ItemRecord,
  event: Event,
  control: Element,
  nativeEvent: Event,
): void {
  const type = event.type as EventType
  if (!EVENT_TYPES.includes(type)) return
  record.handled++
  record.handledByEvent[type]++
  record.currentTargetMatches += event.currentTarget === control ? 1 : 0
  record.nativeEventIdentityMatches += event === nativeEvent ? 1 : 0
  record.targetMatches += event.target === nativeEvent.target ? 1 : 0
  const phase = String(event.eventPhase)
  record.phaseCounts[type][phase] = (record.phaseCounts[type][phase] ?? 0) + 1
}

function controls(record: ItemRecord): [EventType, HTMLElement][] {
  return [
    ['click', record.clickControl],
    ['change', record.changeControl],
    ['input', record.inputControl],
    ['keydown', record.inputControl],
    ['dblclick', record.doubleClickControl],
    ['blur', record.inputControl],
  ]
}

function attachDirect(fixture: Fixture): void {
  for (const record of fixture.records) {
    for (const [type, control] of controls(record)) {
      listen(fixture, control, type, (event) => {
        runItemHandler(record, event, control, event)
      })
    }
  }
}

function findControl(root: Element, event: Event): HTMLElement | null {
  const origin = event.target
  if (!(origin instanceof Element)) return null
  const control = origin.closest<HTMLElement>('[data-listener-bench-control]')
  return control && root.contains(control) ? control : null
}

function attachDelegated(fixture: Fixture, capture: boolean, adaptCurrentTarget: boolean): void {
  const byElement = new Map<Element, ItemRecord>()
  for (const record of fixture.records) {
    for (const [, control] of controls(record)) byElement.set(control, record)
  }

  const handle = (event: Event): void => {
    const control = findControl(fixture.root, event)
    if (!control) return
    const record = byElement.get(control)
    if (!record) return
    if (!adaptCurrentTarget) {
      runItemHandler(record, event, control, event)
      return
    }
    const adapted = new Proxy(event, {
      get(target, property) {
        if (property === 'currentTarget') return control
        return Reflect.get(target, property, target)
      },
    })
    runItemHandler(record, adapted, control, event)
  }

  for (const type of EVENT_TYPES) {
    // blurはbubbleしないため、adapter方式だけはblurをcaptureで拾い、他の
    // イベントはbubble経路を維持する。capture方式は全イベントをcaptureする。
    const eventCapture = capture || (adaptCurrentTarget && type === 'blur')
    listen(fixture, fixture.root, type, handle, eventCapture)
  }
}

function attach(fixture: Fixture): void {
  if (strategy === 'direct') attachDirect(fixture)
  else if (strategy === 'delegated') attachDelegated(fixture, false, false)
  else if (strategy === 'capture') attachDelegated(fixture, true, false)
  else attachDelegated(fixture, false, true)
}

function resetCounters(fixture: Fixture): void {
  for (const record of fixture.records) {
    record.handled = 0
    record.handledByEvent = emptyEventCounts()
    record.currentTargetMatches = 0
    record.nativeEventIdentityMatches = 0
    record.targetMatches = 0
    record.phaseCounts = emptyPhaseCounts()
  }
}

function makeEvent(type: EventType): Event {
  if (type === 'click' || type === 'dblclick') {
    return new MouseEvent(type, { bubbles: true, cancelable: true })
  }
  if (type === 'keydown') return new KeyboardEvent(type, { bubbles: true, key: 'Enter' })
  if (type === 'blur') return new FocusEvent(type)
  return new Event(type, { bubbles: true, cancelable: true })
}

function eventTarget(record: ItemRecord, type: EventType): HTMLElement {
  if (type === 'click') return record.clickControl.firstElementChild as HTMLElement
  if (type === 'dblclick') return record.doubleClickControl.firstElementChild as HTMLElement
  if (type === 'change') return record.changeControl
  return record.inputControl
}

function dispatchEvents(fixture: Fixture, rounds: number): number {
  let eventCount = 0
  for (let round = 0; round < rounds; round++) {
    for (const record of fixture.records) {
      for (const type of EVENT_TYPES) {
        eventTarget(record, type).dispatchEvent(makeEvent(type))
        eventCount++
      }
    }
  }
  return eventCount
}

function timingResult(fixture: Fixture): TimingResult {
  const { records } = fixture
  return {
    elapsedMs: 0,
    itemCount: records.length,
    listenerCount: fixture.listenerCount,
    firstId: records[0]?.id ?? null,
    middleId: records[Math.floor(records.length / 2)]?.id ?? null,
    lastId: records.at(-1)?.id ?? null,
  }
}

function aggregateDispatch(fixture: Fixture): DispatchResult {
  const handledByEvent = emptyEventCounts()
  const phaseCounts = emptyPhaseCounts()
  let handledCount = 0
  let currentTargetMatches = 0
  let nativeEventIdentityMatches = 0
  let targetMatches = 0
  let identityChecksum = 0
  for (const record of fixture.records) {
    handledCount += record.handled
    currentTargetMatches += record.currentTargetMatches
    nativeEventIdentityMatches += record.nativeEventIdentityMatches
    targetMatches += record.targetMatches
    identityChecksum += record.handled * record.id
    for (const type of EVENT_TYPES) {
      handledByEvent[type] += record.handledByEvent[type]
      for (const [phase, count] of Object.entries(record.phaseCounts[type])) {
        phaseCounts[type][phase] = (phaseCounts[type][phase] ?? 0) + count
      }
    }
  }
  return {
    ...timingResult(fixture),
    elapsedMs: 0,
    eventCount: 0,
    handledCount,
    handledByEvent,
    currentTargetMatches,
    nativeEventIdentityMatches,
    targetMatches,
    phaseCounts,
    identityChecksum,
  }
}

function measureMount(size: number): TimingResult {
  document.body.replaceChildren()
  const start = performance.now()
  const fixture = makeFixture(size)
  attach(fixture)
  const result = timingResult(fixture)
  result.elapsedMs = performance.now() - start
  fixture.root.remove()
  return result
}

function measureAttach(size: number): TimingResult {
  document.body.replaceChildren()
  const fixture = makeFixture(size)
  const start = performance.now()
  attach(fixture)
  const result = timingResult(fixture)
  result.elapsedMs = performance.now() - start
  dispatchEvents(fixture, 1)
  fixture.root.remove()
  return result
}

function measureDispatch(size: number, rounds: number): DispatchResult {
  document.body.replaceChildren()
  const fixture = makeFixture(size)
  attach(fixture)
  dispatchEvents(fixture, 1)
  resetCounters(fixture)
  const start = performance.now()
  const eventCount = dispatchEvents(fixture, rounds)
  const elapsedMs = performance.now() - start
  const result = aggregateDispatch(fixture)
  result.elapsedMs = elapsedMs
  result.eventCount = eventCount
  fixture.root.remove()
  return result
}

let retainedFixture: Fixture | undefined

function prepareHeap(size: number): HeapFixtureResult {
  document.body.replaceChildren()
  retainedFixture = makeFixture(size)
  attach(retainedFixture)
  return { itemCount: retainedFixture.records.length, listenerCount: retainedFixture.listenerCount }
}

function releaseHeap(): void {
  retainedFixture = undefined
  document.body.replaceChildren()
}

declare global {
  interface Window {
    __listenerStrategyBench: {
      measureMount: typeof measureMount
      measureAttach: typeof measureAttach
      measureDispatch: typeof measureDispatch
      prepareHeap: typeof prepareHeap
      releaseHeap: typeof releaseHeap
    }
  }
}

window.__listenerStrategyBench = {
  measureMount,
  measureAttach,
  measureDispatch,
  prepareHeap,
  releaseHeap,
}

export {}
