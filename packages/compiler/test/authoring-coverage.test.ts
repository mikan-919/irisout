import { describe, expect, it } from 'vite-plus/test'
import { readFileSync } from 'node:fs'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

const source = readFileSync(new URL('../../../apps/examples/notes.jsx', import.meta.url), 'utf8')

function event(container: Element, target: Element, type: string): void {
  const Event = (
    container.ownerDocument as unknown as {
      defaultView: { Event: typeof globalThis.Event }
    }
  ).defaultView.Event
  target.dispatchEvent(new Event(type, { bubbles: true }))
}

describe('authoring coverage fixture', () => {
  it('supports a form, tabs, local state, nested conditionals and nested lists', async () => {
    const { code } = compile(source)
    expect(code).not.toContain('@typedef')
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (element: Element) => void)(container)

    const article = container.querySelector('.note-list article')!
    expect(article.querySelector('p')?.textContent).toBe('交通と宿泊を確認する')

    const expand = article.querySelector('header button')!
    event(container, expand, 'click')
    expect(article.querySelector('p')?.textContent).toBe('新幹線の予約番号をチームへ共有する。')
    expect([...article.querySelectorAll('ul li')].map((item) => item.textContent)).toEqual([
      '交通',
      '共有',
    ])

    event(container, expand, 'click')
    expect(article.querySelector('ul')).toBeNull()
    expect(article.querySelector('p')?.textContent).toBe('交通と宿泊を確認する')

    event(container, container.querySelector('.notes-app > header button')!, 'click')
    const form = container.querySelector('form')!
    expect(form).not.toBeNull()
    const input = form.querySelector('input') as HTMLInputElement
    expect(container.ownerDocument.activeElement).toBe(input)
    input.value = '新しいメモ'
    event(container, input, 'input')
    event(container, form.querySelector('button')!, 'click')
    expect(container.querySelector('form')).toBeNull()
    expect(
      [...container.querySelectorAll('.note-list article h2')].map((item) => item.textContent),
    ).toEqual(['出張の準備', '新しいメモ'])

    const originalArticle = container.querySelector('.note-list article')!
    const pulse = new container.ownerDocument.defaultView!.Event('notes-pulse')
    container.ownerDocument.dispatchEvent(pulse)
    expect(originalArticle.getAttribute('data-pulse-count')).toBe('1')
    event(container, originalArticle.querySelectorAll('button')[1]!, 'click')
    expect(container.querySelectorAll('.note-list article')).toHaveLength(1)
    container.ownerDocument.dispatchEvent(
      new container.ownerDocument.defaultView!.Event('notes-pulse'),
    )
    expect(originalArticle.getAttribute('data-pulse-count')).toBe('1')
    expect(container.querySelector('.note-list article')?.getAttribute('data-pulse-count')).toBe(
      '2',
    )

    event(container, container.querySelectorAll('.tabs button')[1]!, 'click')
    expect(
      [...container.querySelectorAll('.note-list article h2')].map((item) => item.textContent),
    ).toEqual(['出張の準備', '読書メモ'])
  })
})
