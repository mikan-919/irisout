import { describe, expect, it } from 'vite-plus/test'
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

  it('supports object update/destroy results and reverse-order cleanup', async () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><button onClick={inc}>+</button><canvas use={first}></canvas><output use={second}></output></div>);
  function inc() { count(count() + 1); }
  function first(el) {
    let log = el.ownerDocument.body.querySelector('[data-log]');
    if (!log) {
      log = el.ownerDocument.createElement('aside');
      log.setAttribute('data-log', 'true');
      el.ownerDocument.body.appendChild(log);
    }
    return {
      destroy() { log.textContent += 'first'; },
    };
  }
  function second(el) {
    let log = el.ownerDocument.body.querySelector('[data-log]');
    if (!log) {
      log = el.ownerDocument.createElement('aside');
      log.setAttribute('data-log', 'true');
      el.ownerDocument.body.appendChild(log);
    }
    const onDocumentClick = () => { log.textContent += 'event'; };
    el.ownerDocument.addEventListener('click', onDocumentClick);
    return {
      update() { el.setAttribute('data-count', String(count())); },
      destroy() {
        el.ownerDocument.removeEventListener('click', onDocumentClick);
        log.textContent += 'second';
      },
    };
  }
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (
      mod.mountComponent as (container: Element) => {
        unmount(): void
        update_count(): void
      }
    )(container)
    const output = container.querySelector('output')!
    expect(output.getAttribute('data-count')).toBe('0')
    dispatchClick(container, container.querySelector('button'))
    expect(output.getAttribute('data-count')).toBe('1')

    const document = container.ownerDocument
    instance.unmount()
    expect(container.childElementCount).toBe(0)
    expect(document.body.querySelector('aside')?.textContent).toBe('secondfirst')
    document.dispatchEvent(new document.defaultView!.Event('click'))
    expect(document.body.querySelector('aside')?.textContent).toBe('secondfirst')
    expect(() => instance.update_count()).not.toThrow()
    expect(() => instance.unmount()).not.toThrow()
  })

  it('supports an object result with update only', async () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><button onClick={inc}>+</button><output use={setup}></output></div>);
  function inc() { count(count() + 1); }
  function setup(el) {
    return { update: () => { el.textContent = String(count()); } };
  }
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    const output = container.querySelector('output')!
    expect(output.textContent).toBe('0')
    dispatchClick(container, container.querySelector('button'))
    expect(output.textContent).toBe('1')
    instance.unmount()
  })

  it('supports the same object result from a concise inline use arrow', async () => {
    const source = `
export function App() {
  const count = signal(0);
  render(<div><button onClick={() => count(count() + 1)}>+</button><output use={(el) => ({ update: () => { el.textContent = String(count()); } })}></output></div>);
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    const output = container.querySelector('output')!
    expect(output.textContent).toBe('0')
    dispatchClick(container, container.querySelector('button'))
    expect(output.textContent).toBe('1')
    instance.unmount()
  })

  it('exposes idempotent unmount for mount and hydrate and rejects remounting an instance', async () => {
    const source = `
export function App() {
  render(<div><span>ready</span></div>);
}
`
    const { code, initialHtml } = compile(source)
    const mod = await loadGenerated(code)
    const mountedContainer = createContainer()
    const mounted = (
      mod.mountComponent as (container: Element) => {
        mount(container: Element): void
        unmount(): void
      }
    )(mountedContainer)
    expect(mountedContainer.textContent).toBe('ready')
    expect(() => mounted.mount(mountedContainer)).toThrow(/mounted or hydrated once/)
    mounted.unmount()
    expect(mountedContainer.childElementCount).toBe(0)
    expect(() => mounted.unmount()).not.toThrow()
    expect(() => mounted.mount(mountedContainer)).toThrow(/mounted or hydrated once/)

    const hydratedContainer = createContainer()
    hydratedContainer.innerHTML = initialHtml
    const hydrated = (mod.hydrateComponent as (container: Element) => { unmount(): void })(
      hydratedContainer,
    )
    expect(hydratedContainer.textContent).toBe('ready')
    hydrated.unmount()
    expect(hydratedContainer.childElementCount).toBe(0)
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
    expect(() => compile(source)).toThrow(/use= inside list\/conditional units.*scope limit/)
  })

  it('rejects use= inside a conditional branch (scope limit)', () => {
    const source = `
export function App() {
  const show = signal(true);
  render(<div>{show() ? <span use={setup}></span> : null}</div>);
  function setup(el) {}
}
`
    expect(() => compile(source)).toThrow(/use= inside list\/conditional units.*scope limit/)
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

  it('rejects an invalid object action result shape', () => {
    const source = `
export function App() {
  render(<canvas use={setup}></canvas>);
  function setup(el) {
    return { update: 42 };
  }
}
`
    expect(() => compile(source)).toThrow(/zero-argument function.*scope limit/)
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
