import { describe, expect, it } from 'bun:test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

// マイルストーン4: host 要素の静的属性(文字列リテラル・値なし真偽属性)を
// 初期 HTML テンプレートへそのまま反映する。動的(式コンテナ)値・spread は
// 明示的な compile error で拒否する。specs/static-host-attributes/spec.md の
// 各 Scenario に対応。
function wrap(returnJsx: string): string {
  return `export function App() { return ${returnJsx}; }`
}

describe('milestone 4: static host attributes', () => {
  it('reflects a single string-literal attribute into the initial HTML', () => {
    const { initialHtml } = compile(wrap(`<button type="button">go</button>`))
    expect(initialHtml).toBe('<button type="button">go</button>')
  })

  it('reflects multiple string-literal attributes into the initial HTML', () => {
    const { initialHtml } = compile(
      wrap(`<div class="todoapp" id="root"></div>`),
    )
    expect(initialHtml).toBe('<div class="todoapp" id="root"></div>')
  })

  it('escapes special characters in attribute values', () => {
    const { initialHtml } = compile(wrap(`<div title='a"&b'></div>`))
    expect(initialHtml).toBe('<div title="a&quot;&amp;b"></div>')
  })

  it('reflects a valueless boolean attribute without ="..."', () => {
    const { initialHtml } = compile(wrap(`<input disabled/>`))
    expect(initialHtml).toBe('<input disabled></input>')
  })

  it('rejects an expression-container value that depends on a signal', () => {
    const source = `export function App() {
      const active = signal(false);
      return <div class={active() ? 'a' : 'b'}></div>;
    }`
    expect(() => compile(source)).toThrow(/scope limit/)
  })

  it('rejects an expression-container value that is a constant expression', () => {
    expect(() => compile(wrap(`<div tabIndex={0}></div>`))).toThrow(
      /scope limit/,
    )
  })

  it('rejects a spread attribute', () => {
    expect(() => compile(wrap(`<div {...props}></div>`))).toThrow(/scope limit/)
  })

  it('coexists with a handler on the same element, keeping the static attr and wiring the listener', async () => {
    const source = `export function App() {
      const count = signal(0);
      return (
        <div>
          <span>{count()}</span>
          <button type="button" onClick={() => count(count() + 1)}>+</button>
        </div>
      );
    }`
    const { code, initialHtml } = compile(source)
    // 静的属性が焼き込まれ、かつハンドラ配線も生成される。
    expect(initialHtml).toContain('type="button"')
    expect(code).toContain('addEventListener("click"')

    // 挙動確認: type="button" が付いてもクリックで状態更新が動く。
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const span = container.querySelector('span')
    const button = container.querySelector('button')
    expect(button?.getAttribute('type')).toBe('button')
    expect(span?.textContent).toBe('0')
    const Event = (
      container.ownerDocument as unknown as {
        defaultView: { Event: typeof globalThis.Event }
      }
    ).defaultView.Event
    button?.dispatchEvent(new Event('click'))
    expect(span?.textContent).toBe('1')
  })
})
