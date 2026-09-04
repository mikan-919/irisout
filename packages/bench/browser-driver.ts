// bench/todomvc-vs-react.playwright.ts が Bun.build でバンドルし、実Chromium
// のページ内に注入するベンチ本体。シナリオ定義は bench/todomvc-vs-react.ts
// (jsdom版)と同一(mount / filterSwitch / addOne / removeOne / toggleAll)。
// 計測はすべてページ内の performance.now() で行い、CDPの往復レイテンシを
// 一切含めない(Node側で計測すると1操作あたり数msの通信時間が乗り、DOM処理
// ではなくプロトコル往復を測ることになる)。
//
// jsdom版との差分:
// - heap計測は行わない(Nodeプロセスのheapはブラウザと無関係なため削除)
// - グローバル(Event / KeyboardEvent / document)は本物のブラウザのものを使う

import * as React from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
// @ts-expect-error 手書きfixtureは型宣言を持たないJSモジュール
import { mountComponent } from '../../apps/examples/todomvc.handwritten.js'
import { TodoApp } from '../../apps/examples/todomvc.react.tsx'

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

function freshContainer(): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
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
  const t0 = performance.now()
  mountComponent(container, todos)
  return {
    handle: { kind: 'handwritten', container } as Handle,
    mountMs: performance.now() - t0,
  }
}

function mountReact(todos: Todo[]) {
  const container = freshContainer()
  const root = createRoot(container)
  const t0 = performance.now()
  flushSync(() => root.render(React.createElement(TodoApp, { initialTodos: todos })))
  return {
    handle: { kind: 'react', container, root } as Handle,
    mountMs: performance.now() - t0,
  }
}

function unmount(handle: Handle): void {
  if (handle.kind === 'react') handle.root.unmount()
  handle.container.remove()
}

// Reactはデフォルトでイベント内のstate更新をバッチする。handwritten版と
// 同じ「1イベント = 1回のフル再描画」で比較するため、Reactのdispatchは
// flushSyncで包んで即座にコミットさせる(jsdom版と同じ理由)。
function dispatch(handle: Handle, el: Element, type: string): void {
  const fire = () => el.dispatchEvent(new Event(type, { bubbles: true }))
  if (handle.kind === 'react') flushSync(fire)
  else fire()
}

// checkbox/buttonの疑似ユーザー操作は`.click()`(ネイティブのactivation
// behavior)で行う(jsdom版と同じ理由: checkedの切り替えと後続のchange
// イベント発火が既定動作として起きるのはクリックのみ)。
function fireClick(handle: Handle, el: HTMLElement): void {
  if (handle.kind === 'react') flushSync(() => el.click())
  else el.click()
}

function setNativeInputValue(el: HTMLInputElement, value: string): void {
  // Reactのcontrolled inputはネイティブの value setter を上書きしている
  // ため、プロトタイプのsetterを直接呼ぶ(jsdom版と同じ)。
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
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
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
  // li内で最後の<button>として区別する(jsdom版と同じ)。
  const btn = handle.container.querySelector(
    '.todo-list li:last-child button:last-of-type',
  ) as HTMLElement | null
  if (!btn) throw new Error('remove button not found')
  const t0 = performance.now()
  fireClick(handle, btn)
  return performance.now() - t0
}

export interface ScenarioResult {
  n: number
  mountMs: number
  filterSwitchMs: number
  addOneMs: number
  addOnePreservedExisting: boolean
  removeOneMs: number
}

type Impl = 'handwritten' | 'react'

function mounterOf(impl: Impl) {
  return impl === 'react' ? mountReact : mountHandwritten
}

function runScenarios(impl: Impl, n: number): ScenarioResult {
  const { handle, mountMs } = mounterOf(impl)(makeTodos(n))
  // addOne・removeOneは filter='all' のうちに行う(jsdom版と同じ順序)。
  const { ms: addOneMs, preservedExisting } = addOne(handle)
  const removeOneMs = removeOne(handle)
  const filterSwitchMs = switchFilters(handle)
  unmount(handle)
  return {
    n,
    mountMs,
    filterSwitchMs,
    addOneMs,
    addOnePreservedExisting: preservedExisting,
    removeOneMs,
  }
}

function runToggleAll(impl: Impl, n: number): number {
  const { handle } = mounterOf(impl)(makeTodos(n))
  const ms = toggleAll(handle)
  unmount(handle)
  return ms
}

declare global {
  interface Window {
    __bench: {
      runScenarios: typeof runScenarios
      runToggleAll: typeof runToggleAll
    }
  }
}

window.__bench = { runScenarios, runToggleAll }
