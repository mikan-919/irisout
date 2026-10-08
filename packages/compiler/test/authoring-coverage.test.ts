import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { compileProject } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

function compileNotes(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'irisout-notes-test-'))
  const app = readFileSync(
    new URL('../../../apps/demos/notes.jsx', import.meta.url),
    'utf8',
  ).replace(/^import '\.\/notes\.css'\s*$/m, '')
  const storage = readFileSync(
    new URL('../../../apps/demos/notes-storage.js', import.meta.url),
    'utf8',
  )
  const entry = path.join(root, 'notes.jsx')
  writeFileSync(entry, app)
  writeFileSync(path.join(root, 'notes-storage.js'), storage)
  return compileProject(entry).code
}

function dispatch(container: Element, target: Element, type: string): void {
  const Event = (
    container.ownerDocument.defaultView as unknown as { Event: typeof globalThis.Event }
  ).Event
  target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
}

function fill(container: Element, selector: string, value: string): void {
  const input = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement
  input.value = value
  dispatch(container, input, 'input')
}

describe('検証ログの利用例', () => {
  it('記録を作成・検索・編集・解決し、保存値から再表示する', async () => {
    const values = new Map<string, string>()
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    })
    try {
      const code = compileNotes()
      const mod = await loadGenerated(code)
      const mount = mod.mountComponent as (container: Element) => void
      const first = createContainer()
      mount(first)
      expect(first.querySelector('.empty-state')?.textContent).toContain('最初の記録')
      fill(first, 'input[placeholder^="例:"]', '   ')
      dispatch(first, first.querySelector('form')!, 'submit')
      expect(first.querySelector('[role="status"]')?.textContent).toContain('タイトルを入力')
      expect(values.size).toBe(0)

      fill(first, 'input[placeholder^="例:"]', 'List update fails')
      fill(first, 'textarea[placeholder^="再現"]', 'Render <List />')
      fill(first, '.result-fields textarea:first-child', 'List stays visible')
      fill(first, '.result-fields textarea:last-child', 'List disappears')
      dispatch(first, first.querySelector('form')!, 'submit')
      expect(first.querySelector('.note-card h3')?.textContent).toBe('List update fails')
      expect(values.size).toBe(1)

      fill(first, 'input[type="search"]', 'render <list')
      expect(first.querySelectorAll('.note-card')).toHaveLength(1)
      fill(first, 'input[type="search"]', 'missing')
      expect(first.querySelector('.empty-state')?.textContent).toContain('一致する')
      fill(first, 'input[type="search"]', '')

      dispatch(first, first.querySelector('.note-actions button')!, 'click')
      fill(first, 'input[placeholder^="例:"]', 'List update fixed')
      dispatch(first, first.querySelector('form')!, 'submit')
      expect(first.querySelector('.note-card h3')?.textContent).toBe('List update fixed')

      dispatch(first, first.querySelectorAll('.note-actions button')[1]!, 'click')
      expect(first.querySelector('.empty-state')?.textContent).toContain('未解決')
      expect(first.querySelector('[role="status"]')?.textContent).toContain(
        '解決済み一覧に移動しました',
      )
      expect(first.querySelector('.tabs button')?.getAttribute('aria-pressed')).toBe('true')
      expect(first.querySelectorAll('.tabs button')[1]?.getAttribute('aria-pressed')).toBe('false')
      dispatch(first, first.querySelectorAll('.tabs button')[1]!, 'click')
      expect(first.querySelector('.note-card h3')?.textContent).toBe('List update fixed')
      expect(first.querySelectorAll('.tabs button')[1]?.getAttribute('aria-pressed')).toBe('true')

      const reloaded = createContainer()
      mount(reloaded)
      dispatch(reloaded, reloaded.querySelectorAll('.tabs button')[1]!, 'click')
      expect(reloaded.querySelector('.note-card h3')?.textContent).toBe('List update fixed')
      expect(reloaded.querySelectorAll('.tabs button')[1]?.getAttribute('aria-pressed')).toBe(
        'true',
      )
      expect(reloaded.querySelector('.note-card pre')?.textContent).toBe('Render <List />')
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })

  it('保存先が使えない場合はフォーム入力を保持して知らせる', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota exceeded')
        },
      },
    })
    try {
      const code = compileNotes()
      const mod = await loadGenerated(code)
      const container = createContainer()
      ;(mod.mountComponent as (container: Element) => void)(container)
      fill(container, 'input[placeholder^="例:"]', 'Keep this title')
      dispatch(container, container.querySelector('form')!, 'submit')
      expect((container.querySelector('input[placeholder^="例:"]') as HTMLInputElement).value).toBe(
        'Keep this title',
      )
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        '保存できませんでした',
      )
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })

  it('読取り失敗を知らせた後もフォーム入力を受け付ける', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('storage disabled')
        },
        setItem: () => {},
      },
    })
    try {
      const code = compileNotes()
      const mod = await loadGenerated(code)
      const container = createContainer()
      ;(mod.mountComponent as (container: Element) => void)(container)
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        '読み込めませんでした',
      )
      fill(container, 'input[placeholder^="例:"]', 'Input after read failure')
      expect((container.querySelector('input[placeholder^="例:"]') as HTMLInputElement).value).toBe(
        'Input after read failure',
      )
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })
})
