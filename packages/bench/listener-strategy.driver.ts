// 実Chromium内で、リストアイテムの直接リスナーと親要素へのイベント委譲を
// 同じDOM・同じitem identity処理で比較するclick候補fixture。直接方式はアイテム
// ごとのクロージャ、委譲方式はitem identityを引くMap帳簿を保持する。native
// event.currentTargetの互換性やnon-bubbling eventはこのfixtureの対象外。

type Strategy = 'direct' | 'delegated'

declare const __LISTENER_STRATEGY__: Strategy

const strategy = __LISTENER_STRATEGY__

interface ItemRecord {
  id: number
  button: HTMLButtonElement
  handled: number
  identityChecksum: number
}

interface Fixture {
  root: HTMLUListElement
  records: ItemRecord[]
}

interface TimingResult {
  elapsedMs: number
  itemCount: number
  firstId: number | null
  middleId: number | null
  lastId: number | null
}

interface DispatchResult extends TimingResult {
  eventCount: number
  handledCount: number
  identityChecksum: number
}

interface HeapFixtureResult {
  itemCount: number
}

function makeFixture(size: number): Fixture {
  const root = document.createElement('ul')
  root.dataset.listenerBenchRoot = ''
  const records: ItemRecord[] = []

  for (let index = 0; index < size; index++) {
    const id = index + 1
    const li = document.createElement('li')
    const button = document.createElement('button')
    const label = document.createElement('span')
    button.type = 'button'
    button.dataset.listenerBenchItem = ''
    button.dataset.itemId = String(id)
    label.textContent = `item ${id}`
    button.append(label)
    li.append(button)
    root.append(li)
    records.push({ id, button, handled: 0, identityChecksum: 0 })
  }

  document.body.append(root)
  return { root, records }
}

// 直接方式と委譲方式で共有する意味的なハンドラ本体。アイテム識別子と
// clickイベントを受けてアイテム固有の状態を更新するため、単なる空関数の
// 呼び出しではなく、委譲側のMap lookupも結果に反映される。
function runItemHandler(record: ItemRecord, event: Event): void {
  if (event.type !== 'click') return
  record.handled += 1
  record.identityChecksum += record.id
}

function attachDirect(fixture: Fixture): void {
  for (const record of fixture.records) {
    // 直接方式の比較対象: item identityをクロージャで保持するリスナーを
    // 1アイテムずつ登録する。
    record.button.addEventListener('click', (event) => runItemHandler(record, event))
  }
}

function attachDelegated(fixture: Fixture): void {
  // 委譲方式の帳簿コスト: targetからitem identityとハンドラ対象を引くため、
  // 各buttonをItemRecordへ対応付けるMapを構築して保持する。Mapの構築・保持は
  // attach/mount/retained heapの計測に含める。
  const byElement = new Map<HTMLButtonElement, ItemRecord>()
  for (const record of fixture.records) byElement.set(record.button, record)

  fixture.root.addEventListener('click', (event) => {
    const origin = event.target
    if (!(origin instanceof Element)) return
    const button = origin.closest<HTMLButtonElement>('[data-listener-bench-item]')
    if (!button || !fixture.root.contains(button)) return
    const record = byElement.get(button)
    if (!record) return
    runItemHandler(record, event)
  })
}

function attach(fixture: Fixture): void {
  if (strategy === 'direct') attachDirect(fixture)
  else attachDelegated(fixture)
}

function resetCounters(fixture: Fixture): void {
  for (const record of fixture.records) {
    record.handled = 0
    record.identityChecksum = 0
  }
}

function dispatchEvents(fixture: Fixture, rounds: number): number {
  let eventCount = 0
  for (let round = 0; round < rounds; round++) {
    for (const record of fixture.records) {
      // 子要素をtargetにして、委譲側がclosest()でitemを特定する必要を残す。
      const target = record.button.firstElementChild ?? record.button
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      eventCount++
    }
  }
  return eventCount
}

function timingResult(fixture: Fixture): TimingResult {
  const { records } = fixture
  return {
    elapsedMs: 0,
    itemCount: records.length,
    firstId: records[0]?.id ?? null,
    middleId: records[Math.floor(records.length / 2)]?.id ?? null,
    lastId: records.at(-1)?.id ?? null,
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

  // 計測区間外で1イベントを通し、attachが意味的に有効であることを検査する。
  dispatchEvents(fixture, 1)
  fixture.root.remove()
  return result
}

function measureDispatch(size: number, rounds: number): DispatchResult {
  document.body.replaceChildren()
  const fixture = makeFixture(size)
  attach(fixture)

  // 最初のdispatchでブラウザのイベント経路をwarm upしてから時間を測る。
  dispatchEvents(fixture, 1)
  resetCounters(fixture)
  const start = performance.now()
  const eventCount = dispatchEvents(fixture, rounds)
  const elapsedMs = performance.now() - start
  const handledCount = fixture.records.reduce((sum, record) => sum + record.handled, 0)
  const identityChecksum = fixture.records.reduce((sum, record) => sum + record.identityChecksum, 0)
  const result = {
    ...timingResult(fixture),
    elapsedMs,
    eventCount,
    handledCount,
    identityChecksum,
  }
  fixture.root.remove()
  return result
}

let retainedFixture: Fixture | undefined

function prepareHeap(size: number): HeapFixtureResult {
  document.body.replaceChildren()
  retainedFixture = makeFixture(size)
  attach(retainedFixture)
  return { itemCount: retainedFixture.records.length }
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
