import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

function dispatch(container: Element, element: Element | null, type: string): void {
  if (!element) throw new Error('dispatch: element not found')
  const Event = (
    container.ownerDocument as unknown as {
      defaultView: { Event: typeof globalThis.Event }
    }
  ).defaultView.Event
  element.dispatchEvent(new Event(type))
}

describe('SVG authoring', () => {
  it('SVG要素をSVG名前空間で描画し、静的・動的属性を扱う', async () => {
    const source = `
export function App() {
  const active = signal(false);
  const radius = signal(2);
  render(
    <svg viewBox="0 0 20 20" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs><path id="dot" d="M0 0" /></defs>
      <use xlink:href="#dot" class={active() ? 'active' : 'idle'} />
      <circle r={radius()} onClick={() => { active(true); radius(4); }} />
    </svg>
  );
}
`
    const { code, initialHtml } = compile(source)
    expect(initialHtml).toContain('xlink:href="#dot"')
    expect(initialHtml).toContain('class="idle"')
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)

    const svg = container.querySelector('svg')!
    const use = container.querySelector('use')!
    const circle = container.querySelector('circle')!
    expect(svg.namespaceURI).toBe(SVG_NS)
    expect(use.namespaceURI).toBe(SVG_NS)
    expect(circle.namespaceURI).toBe(SVG_NS)
    expect(use.getAttributeNS(XLINK_NS, 'href')).toBe('#dot')
    expect(circle.getAttribute('r')).toBe('2')

    dispatch(container, circle, 'click')
    expect(use.getAttribute('class')).toBe('active')
    expect(circle.getAttribute('r')).toBe('4')
  })

  it('foreignObjectの子をHTML名前空間へ戻せる', async () => {
    const source = `
export function App() {
  render(<svg><foreignObject><div class="html-content">text</div></foreignObject></svg>);
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const div = container.querySelector('.html-content')!
    expect(div.namespaceURI).toBe('http://www.w3.org/1999/xhtml')
  })

  it('SVG名前空間属性の動的値は拒否する', () => {
    const source = `
export function App() {
  const href = signal('#dot');
  render(<svg><use xlink:href={href()} /></svg>);
}
`
    expect(() => compile(source)).toThrow(
      /SVG namespace attribute.*static string value.*scope limit/,
    )
  })

  it('HTML要素のSVG名前空間属性は拒否する', () => {
    const source = `
export function App() {
  render(<div xlink:href="#dot" />);
}
`
    expect(() => compile(source)).toThrow(/SVG namespace attributes.*scope limit/)
  })
})
