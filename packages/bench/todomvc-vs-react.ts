#!/usr/bin/env bun
// apps/examples/todomvc.handwritten.js (ADR-0005 keyed reuse, M5の目標出力) vs
// 同等機能のReact版TodoMVC(apps/examples/todomvc.react.tsx)で、同一シナリオの
// 処理時間を比較するベンチマーク。ADR-0005の見立て(keyed reuseのMapの
// 帳簿コストはReact Fiberと同種のコスト)を実測で検証する。
//
// 実行: bun run bench
//
// 注意: packages/bench/listener-strategy.tsと同じ割り切りで、jsdom上の相対比較に
// 留める(実ブラウザの絶対値ではない)。「完了トグル」シナリオは1件ずつ
// state配列を丸ごと複製して再描画する実装のため、handwritten・React
// いずれもO(N)(1回の更新)×N回 = O(N^2)になる。TOGGLE_SIZESで実測した
// 傾向から、N=10,000/100,000は現実的な時間で終わらないため計測対象から
// 外し、結果レポート側で外挿する(詳細はpackages/bench/todomvc-vs-react.results.md)。

process.env.NODE_ENV = 'production' // devビルドの警告チェックコストを除く

import { JSDOM } from 'jsdom'

const SIZES = [100, 1_000, 10_000, 100_000]
const TOGGLE_SIZES = [100, 1_000] // O(N^2)のため大きいNは対象外(上記注意参照)

interface Todo {
  id: number
  text: string
  completed: boolean
}

function makeTodos(n: number): Todo[] {
  const todos: Todo[] = []
  for (let i = 0; i < n; i++) {
    todos.push({ id: i + 1, text: `todo ${i + 1}`, completed: false })
  }
  return todos
}

// GCを挟んでからヒープを測る(listener-strategy.tsと同じ割り切り。
// --smolなしだとglobal.gcが無く、ノイズが乗る目安値になる)。
function heapUsedKb(): number {
  const g = globalThis as unknown as { gc?: () => void }
  g.gc?.()
  return process.memoryUsage().heapUsed / 1024
}

// jsdomのグローバルを1回だけ用意する。react-dom/clientはモジュール評価時に
// windowを参照するため、globalThisへの登録を先に済ませてから動的import
// で読み込む(静的importだとホイストされてこの代入より先に評価される)。
const dom = new JSDOM('<!doctype html><body></body>', {
  url: 'http://localhost/',
})
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Event: dom.window.Event,
  KeyboardEvent: dom.window.KeyboardEvent,
  requestAnimationFrame:
    dom.window.requestAnimationFrame ?? ((cb: () => void) => setTimeout(cb, 0)),
  cancelAnimationFrame: dom.window.cancelAnimationFrame ?? clearTimeout,
})

// @ts-expect-error 手書きfixtureは型宣言を持たないJSモジュール
const { mountComponent } = await import('../../apps/examples/todomvc.handwritten.js')
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const { TodoApp } = await import('../../apps/examples/todomvc.react.tsx')

function freshContainer(): HTMLElement {
  const container = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(container)
  return container
}

interface HandwrittenHandle {
  kind: 'handwritten'
  container: HTMLElement
}
interface ReactHandle {
  kind: 'react'
  container: HTMLElement
  root: ReturnType<typeof createRoot>
}
type Handle = HandwrittenHandle | ReactHandle

function mountHandwritten(todos: Todo[]) {
  const container = freshContainer()
  const beforeKb = heapUsedKb()
  const t0 = performance.now()
  mountComponent(container, todos)
  const mountMs = performance.now() - t0
  const heapDeltaKb = heapUsedKb() - beforeKb
  return {
    handle: { kind: 'handwritten', container } as Handle,
    mountMs,
    heapDeltaKb,
  }
}

function mountReact(todos: Todo[]) {
  const container = freshContainer()
  const root = createRoot(container)
  const beforeKb = heapUsedKb()
  const t0 = performance.now()
  flushSync(() => root.render(React.createElement(TodoApp, { initialTodos: todos })))
  const mountMs = performance.now() - t0
  const heapDeltaKb = heapUsedKb() - beforeKb
  return {
    handle: { kind: 'react', container, root } as Handle,
    mountMs,
    heapDeltaKb,
  }
}

function unmount(handle: Handle): void {
  if (handle.kind === 'react') handle.root.unmount()
  handle.container.remove()
}

// Reactはデフォルトでイベント内のstate更新をバッチする。handwritten版と
// 同じ「1イベント = 1回のフル再描画」で比較するため、Reactのdispatchは
// flushSyncで包んで即座にコミットさせる(そうしないとtoggleAll等でN回
// 分の更新が1回のレンダーにまとめられ、Reactだけ有利になってしまう)。
function dispatch(handle: Handle, el: Element, type: string): void {
  const fire = () => el.dispatchEvent(new dom.window.Event(type, { bubbles: true }))
  if (handle.kind === 'react') flushSync(fire)
  else fire()
}

// checkbox/buttonの疑似ユーザー操作は`.click()`(ネイティブのactivation
// behavior)で行う。jsdomでは合成dispatchEvent(new Event('change'))だけ
// ではcheckboxのchecked切り替えも後続のchangeイベント発火も起きない
// (実ブラウザのクリックのみがこの既定動作を持つ)。
function fireClick(handle: Handle, el: HTMLElement): void {
  if (handle.kind === 'react') flushSync(() => el.click())
  else el.click()
}

function setNativeInputValue(el: HTMLInputElement, value: string): void {
  // Reactのcontrolled inputはネイティブの value setter を上書きしている
  // ため、`el.value = x`だけだとReact側の内部トラッキング値とズレて
  // onChangeが正しく発火しない。プロトタイプのsetterを直接呼ぶ。
  const proto = Object.getPrototypeOf(el)
  const desc = Object.getOwnPropertyDescriptor(proto, 'value')
  desc?.set?.call(el, value)
}

function checkboxesOf(handle: Handle): HTMLInputElement[] {
  return Array.from(
    handle.container.querySelectorAll('.todo-list input[type="checkbox"]'),
  ) as HTMLInputElement[]
}

function toggleAll(handle: Handle): number {
  const t0 = performance.now()
  for (const cb of checkboxesOf(handle)) fireClick(handle, cb)
  return performance.now() - t0
}

function switchFilters(handle: Handle): number {
  const active = handle.container.querySelector('[data-filter="active"]') as HTMLElement | null
  const completed = handle.container.querySelector(
    '[data-filter="completed"]',
  ) as HTMLElement | null
  if (!active || !completed) throw new Error('filter buttons not found')
  const t0 = performance.now()
  fireClick(handle, active)
  fireClick(handle, completed)
  return performance.now() - t0
}

function addOne(handle: Handle): { ms: number; preservedExisting: boolean } {
  const existingLis = Array.from(handle.container.querySelectorAll('.todo-list li'))
  const input = handle.container.querySelector('.todoapp > input') as HTMLInputElement
  if (!input) throw new Error('add input not found')

  const fireEnter = () =>
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  const t0 = performance.now()
  if (handle.kind === 'react') {
    setNativeInputValue(input, 'new item')
    dispatch(handle, input, 'input')
    flushSync(fireEnter)
  } else {
    input.value = 'new item'
    fireEnter()
  }
  const ms = performance.now() - t0

  const nowLis = Array.from(handle.container.querySelectorAll('.todo-list li'))
  const preservedExisting =
    nowLis.length === existingLis.length + 1 && existingLis.every((li, i) => nowLis[i] === li)
  return { ms, preservedExisting }
}

function removeOne(handle: Handle): number {
  // React版はテキスト部分も<button>(編集トリガー)なので、削除ボタンは
  // li内で最後の<button>として区別する(:last-of-type)。handwritten版は
  // <button>が1つしかないので影響なし。
  const btn = handle.container.querySelector(
    '.todo-list li:last-child button:last-of-type',
  ) as HTMLElement | null
  if (!btn) throw new Error('remove button not found')
  const t0 = performance.now()
  fireClick(handle, btn)
  return performance.now() - t0
}

interface ScenarioResult {
  n: number
  mountMs: number
  mountHeapDeltaKb: number
  filterSwitchMs: number
  addOneMs: number
  addOnePreservedExisting: boolean
  removeOneMs: number
}

type Mounter = (todos: Todo[]) => {
  handle: Handle
  mountMs: number
  heapDeltaKb: number
}

function runScenarios(n: number, mount: Mounter): ScenarioResult {
  const { handle, mountMs, heapDeltaKb } = mount(makeTodos(n))
  // addOne・removeOneは filter='all' のうちに行う(toggleAllは別枠の
  // runToggleAllに切り出したため、ここでは1件もcompleted状態にならない
  // ― filterSwitchを先にやると'completed'フィルタでリストが空になり
  // removeOneが要素を見つけられなくなる)。
  const { ms: addOneMs, preservedExisting } = addOne(handle)
  const removeOneMs = removeOne(handle)
  const filterSwitchMs = switchFilters(handle)
  unmount(handle)
  return {
    n,
    mountMs,
    mountHeapDeltaKb: heapDeltaKb,
    filterSwitchMs,
    addOneMs,
    addOnePreservedExisting: preservedExisting,
    removeOneMs,
  }
}

// toggleAllだけ独立して計測する(O(N^2)なのでTOGGLE_SIZESに絞るため)。
function runToggleAll(n: number, mount: Mounter): number {
  const { handle } = mount(makeTodos(n))
  const ms = toggleAll(handle)
  unmount(handle)
  return ms
}

const handwrittenResults: ScenarioResult[] = []
const reactResults: ScenarioResult[] = []
const handwrittenToggleMs = new Map<number, number>()
const reactToggleMs = new Map<number, number>()

for (const n of SIZES) {
  console.log(`\n=== N = ${n} ===`)

  console.log('  handwritten...')
  const hw = runScenarios(n, mountHandwritten)
  handwrittenResults.push(hw)

  console.log('  react...')
  const rx = runScenarios(n, mountReact)
  reactResults.push(rx)

  console.log(
    '  scenario'.padEnd(18),
    'handwritten (ms)'.padEnd(20),
    'react (ms)'.padEnd(15),
    'react / handwritten',
  )
  const rows: [string, number, number][] = [
    ['mount', hw.mountMs, rx.mountMs],
    ['filterSwitch', hw.filterSwitchMs, rx.filterSwitchMs],
    ['addOne', hw.addOneMs, rx.addOneMs],
    ['removeOne', hw.removeOneMs, rx.removeOneMs],
  ]
  for (const [name, hwMs, rxMs] of rows) {
    console.log(
      `  ${name}`.padEnd(18),
      hwMs.toFixed(2).padEnd(20),
      rxMs.toFixed(2).padEnd(15),
      `${(rxMs / hwMs).toFixed(2)}x`,
    )
  }
  if (!hw.addOnePreservedExisting) {
    console.log('  WARNING: handwritten did not preserve existing <li> identity on add')
  }

  if (TOGGLE_SIZES.includes(n)) {
    console.log('  toggleAll (handwritten)...')
    const hwToggleMs = runToggleAll(n, mountHandwritten)
    console.log('  toggleAll (react)...')
    const rxToggleMs = runToggleAll(n, mountReact)
    handwrittenToggleMs.set(n, hwToggleMs)
    reactToggleMs.set(n, rxToggleMs)
    console.log(
      '  toggleAll'.padEnd(18),
      hwToggleMs.toFixed(2).padEnd(20),
      rxToggleMs.toFixed(2).padEnd(15),
      `${(rxToggleMs / hwToggleMs).toFixed(2)}x`,
    )
  }
}

console.log('\n=== 生データ (JSON) ===')
console.log(
  JSON.stringify(
    {
      handwrittenResults,
      reactResults,
      handwrittenToggleMs: Object.fromEntries(handwrittenToggleMs),
      reactToggleMs: Object.fromEntries(reactToggleMs),
    },
    null,
    2,
  ),
)
