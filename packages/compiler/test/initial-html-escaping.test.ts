import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

// escape-initial-html: ビルド時実行で焼き込まれる初期 HTML のテキスト式値が
// HTML エスケープされ、実行時 textContent 更新と同一表示になることを検証する
// (openspec: initial-html-escaping)。

const injectionSource = (initial: string) => `
export function App() {
  const msg = signal(${JSON.stringify(initial)});
  render(<div>{msg()}</div>);
}
`

describe('initial-html-escaping: 初期 HTML への式値焼き込み', () => {
  it('HTML 文字列の初期値は <img タグとして initialHtml に現れない', () => {
    const { initialHtml } = compile(injectionSource('<img src=x onerror=alert(1)>'))
    expect(initialHtml).not.toContain('<img')
    expect(initialHtml).toContain('&lt;img src=x onerror=alert(1)>')
  })

  it('アンパサンドを含む初期値は &amp; にエスケープされる', () => {
    const { initialHtml } = compile(injectionSource('a & b'))
    expect(initialHtml).toContain('a &amp; b')
  })
})

describe('initial-html-escaping: 初期表示と実行時更新の表示同一性', () => {
  it('特殊文字値の mountComponent 後、update_* を呼んでも textContent が変わらない', async () => {
    const value = '<img src=x onerror=alert(1)> & more'
    const { code } = compile(injectionSource(value))
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)

    const before = container.textContent
    expect(before).toContain(value)
    ;(mod.update_msg as () => void)()
    expect(container.textContent).toBe(before)
  })
})
