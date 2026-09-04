import { describe, expect, it } from 'vite-plus/test'
// examples/ は tsconfig.json の include 対象外(スコープ外)で型定義もない
// プレーンJSなので、このimport自体がTS7016を出す。tsconfigは変更できない
// ため、ここだけ抑制する。
// @ts-expect-error: examples/ 配下は型チェック対象外(tsconfig.jsonはスコープ外)
import { mountComponent } from '../../../apps/examples/todomvc.handwritten.js'
import { createContainer } from './helpers.js'

// examples/todomvc.handwritten.js(ADR-0005の手書き目標出力)が実際に
// jsdom上で動くことを固定するスモークテスト。plan 002 ステップ3。

function windowOf(container: Element) {
  return (container.ownerDocument as unknown as { defaultView: typeof window }).defaultView
}

function dispatchKeydown(el: Element, key: string): void {
  const win = windowOf(el.ownerDocument!.documentElement)
  el.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true }))
}

function dispatchDomEvent(el: Element, type: string): void {
  const win = windowOf(el.ownerDocument!.documentElement)
  el.dispatchEvent(new win.Event(type, { bubbles: true }))
}

function itemByText(container: Element, text: string): Element {
  const li = Array.from(container.querySelectorAll('li')).find(
    (el) => el.querySelector('span')?.textContent === text,
  )
  if (!li) throw new Error(`itemByText: no <li> with text "${text}"`)
  return li
}

describe('examples/todomvc.handwritten.js smoke test', () => {
  it('renders the initial todos as <li> on mount', () => {
    const container = createContainer()
    mountComponent(container)

    const items = container.querySelectorAll('.todo-list li')
    expect(items.length).toBe(2)
    expect(itemByText(container, 'irisout を書く')).toBeTruthy()
    expect(itemByText(container, '牛乳を買う')).toBeTruthy()
  })

  it('adds a todo on Enter and clears the input', () => {
    const container = createContainer()
    mountComponent(container)
    const input = container.querySelector('input') as HTMLInputElement

    input.value = '牛乳を買う2'
    dispatchKeydown(input, 'Enter')

    expect(container.querySelectorAll('.todo-list li').length).toBe(3)
    expect(itemByText(container, '牛乳を買う2')).toBeTruthy()
    expect(input.value).toBe('')
  })

  it('toggles completed via checkbox and updates the remaining count', () => {
    const container = createContainer()
    mountComponent(container)
    const countEl = container.querySelector('.todoapp > span') as Element
    expect(countEl.textContent).toBe('1 items left')

    const activeItem = itemByText(container, 'irisout を書く')
    const checkbox = activeItem.querySelector('input[type="checkbox"]') as HTMLInputElement
    checkbox.checked = true
    dispatchDomEvent(checkbox, 'change')

    expect(activeItem.classList.contains('completed')).toBe(true)
    expect(countEl.textContent).toBe('0 items left')
  })

  it('hides inactive items on filter switch and keeps keyed-reuse state across a round trip', () => {
    const container = createContainer()
    mountComponent(container)

    // アクティブなアイテムの編集を開始する。
    const activeItem = itemByText(container, 'irisout を書く')
    dispatchDomEvent(activeItem.querySelector('span') as Element, 'dblclick')
    expect(
      (activeItem.querySelector('input:not([type="checkbox"])') as HTMLInputElement).style.display,
    ).not.toBe('none')

    // completed フィルタへ切り替え: active なアイテムはリストから消える。
    ;(container.querySelector('[data-filter="completed"]') as HTMLButtonElement).click()
    expect(container.querySelectorAll('.todo-list li').length).toBe(1)
    expect(container.contains(activeItem)).toBe(false)

    // all フィルタへ戻す(往復): 編集状態を保ったまま復帰する。
    ;(container.querySelector('[data-filter="all"]') as HTMLButtonElement).click()
    expect(container.querySelectorAll('.todo-list li').length).toBe(2)
    expect(container.contains(activeItem)).toBe(true)
    const editInput = activeItem.querySelector('input:not([type="checkbox"])') as HTMLInputElement
    expect(editInput.style.display).not.toBe('none')
  })
})
