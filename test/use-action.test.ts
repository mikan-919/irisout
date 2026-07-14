import { describe, expect, it } from 'bun:test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

// ADR-0011/change use-action-impl: `use={fn}` でtop-level要素にactionを
// 接続する。mount時1回呼び出し・返り値クロージャのリアクティブ配線・
// ネストした関数本体への再帰(design.md Decision 4/5)を検証する。
// specs/element-use-action/spec.md の各 Scenario、tasks.md 4.1〜4.3 に対応。

function dispatchClick(container: Element, el: Element | null): void {
  if (!el) throw new Error('dispatchClick: element not found')
  const Event = (
    container.ownerDocument as unknown as {
      defaultView: { Event: typeof globalThis.Event }
    }
  ).defaultView.Event
  el.dispatchEvent(new Event('click'))
}

describe('ADR-0011: use= action attribute (acceptance)', () => {
  it('calls the action once at mount time with the element, already connected and populated', async () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><canvas use={setup}></canvas></div>);
  function setup(el) {
    el.setAttribute('data-parent-tag', el.parentElement.tagName);
    el.setAttribute('data-span-text', el.parentElement.querySelector('span').textContent);
  }
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const canvas = container.querySelector('canvas')!
    expect(canvas.getAttribute('data-parent-tag')).toBe('DIV')
    expect(canvas.getAttribute('data-span-text')).toBe('0')
  })

  it('wires a nested listener write to an assignment + update_* call', async () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><button use={setup}>go</button></div>);
  function setup(btn) {
    btn.addEventListener('click', () => {
      count(count() + 1);
    });
  }
}
`
    const { code } = compile(source)
    expect(code).toContain('count = count + 1')
    expect(code).toContain('update_count()')
    expect(code).not.toContain('count(count() + 1)')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const span = container.querySelector('span')
    expect(span?.textContent).toBe('0')
    dispatchClick(container, container.querySelector('button'))
    expect(span?.textContent).toBe('1')
  })

  it('wires the returned closure to update_* and runs it once right after the action call', async () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><button onClick={inc}>+</button><canvas use={setup}></canvas></div>);
  function inc() { count(count() + 1); }
  function setup(el) {
    return () => { el.setAttribute('data-count', String(count())); };
  }
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const canvas = container.querySelector('canvas')!
    expect(canvas.getAttribute('data-count')).toBe('0')
    dispatchClick(container, container.querySelector('button'))
    expect(canvas.getAttribute('data-count')).toBe('1')
  })

  it('generates no wiring/guard code for an action with no return value', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><span>{count()}</span><canvas use={setup}></canvas></div>);
  function setup(el) { el.setAttribute('data-ready', 'true'); }
}
`
    const { code } = compile(source)
    expect(code).not.toContain('__use_')
  })
})

describe('ADR-0011: use= action attribute (rejection)', () => {
  it('rejects use= inside a list item (scope limit)', () => {
    const source = `
export function App() {
  const items = signal([{ id: 1 }]);
  render(
    <ul>
      {items().map((item) => (
        <li key={item.id} use={setup}></li>
      ))}
    </ul>
  );
  function setup(el) {}
}
`
    expect(() => compile(source)).toThrow(
      /use= inside list\/conditional units.*scope limit/,
    )
  })

  it('rejects use= inside a conditional branch (scope limit)', () => {
    const source = `
export function App() {
  const show = signal(true);
  render(<div>{show() ? <span use={setup}></span> : null}</div>);
  function setup(el) {}
}
`
    expect(() => compile(source)).toThrow(
      /use= inside list\/conditional units.*scope limit/,
    )
  })

  it('rejects a reference that resolves to no function declared after render()', () => {
    const source = `
export function App() {
  render(<canvas use={setup}></canvas>);
}
`
    expect(() => compile(source)).toThrow(/scope limit/)
  })

  it('rejects returning a function that takes arguments', () => {
    const source = `
export function App() {
  render(<canvas use={setup}></canvas>);
  function setup(el) {
    return (x) => { el.setAttribute('x', x); };
  }
}
`
    expect(() => compile(source)).toThrow(/scope limit/)
  })

  it('rejects returning a non-function value', () => {
    const source = `
export function App() {
  render(<canvas use={setup}></canvas>);
  function setup(el) {
    return 42;
  }
}
`
    expect(() => compile(source)).toThrow(/scope limit/)
  })

  it('rejects an unsupported statement kind inside a nested listener body', () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<canvas use={setup}></canvas>);
  function setup(el) {
    el.addEventListener('click', () => {
      for (let i = 0; i < 1; i++) { count(1); }
    });
  }
}
`
    expect(() => compile(source)).toThrow(/scope limit/)
  })
})

describe('ADR-0011: positional reactivity (design D4-1)', () => {
  it('does not wire a nested non-returned function to update_* (only the return closure is reactive)', async () => {
    const source = `
export function App() {
  const count = signal(0);
  const other = signal(0);
  render(<div><button onClick={inc}>+</button><canvas use={setup}></canvas></div>);
  function inc() { other(other() + 1); }
  function setup(el) {
    el.addEventListener('mouseenter', () => {
      el.setAttribute('data-seen-count', String(count()));
    });
  }
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)
    const canvas = container.querySelector('canvas')!
    expect(canvas.hasAttribute('data-seen-count')).toBe(false)
    dispatchClick(container, container.querySelector('button'))
    // other の update_* は canvas の action と一切無関係(bare readのみ、
    // マーカーに登録されるのは返り値クロージャだけ)。
    expect(canvas.hasAttribute('data-seen-count')).toBe(false)
    expect(code).not.toContain('update_other();\n  el.setAttribute')
  })
})
