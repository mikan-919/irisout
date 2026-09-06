import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

const SOURCE = readFileSync(new URL('../../../apps/examples/heatmap.jsx', import.meta.url), 'utf8')

function click(container: Element, selector: string): void {
  const element = container.querySelector(selector) as HTMLElement | null
  if (!element) throw new Error(`element not found: ${selector}`)
  element.click()
}

describe('apps/examples/heatmap.jsx', () => {
  it('connects input, metric selection, paragraph selection, and overview links', async () => {
    const { code } = compile(SOURCE)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => unknown)(container)

    expect(container.querySelectorAll('.paragraph-list article')).toHaveLength(3)
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toContain('概要')
    expect(container.querySelector('.metric-controls .active')?.textContent).toContain('長さ')

    click(container, '.metric-controls button:nth-of-type(2)')
    expect(container.querySelector('.metric-controls .active')?.textContent).toContain('割合')

    const overviewLinks = container.querySelectorAll('.overview a')
    expect(overviewLinks[1]?.getAttribute('href')).toBe('#paragraph-2')
    ;(overviewLinks[1] as HTMLElement).click()
    expect(overviewLinks[1]?.className).toContain('selected')
    expect(container.querySelector('#paragraph-2')?.className).toContain('selected')
    expect(container.querySelector('.detail')?.textContent).toContain('数値 42')

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    textarea.value = '新しい本文です。\n\n99'
    textarea.dispatchEvent(
      new textarea.ownerDocument.defaultView!.Event('input', { bubbles: true }),
    )
    expect(container.querySelectorAll('.paragraph-list article')).toHaveLength(2)
    expect(container.querySelector('#paragraph-2')?.textContent).toContain('99')
  })
})
