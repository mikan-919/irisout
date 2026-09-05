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

  it('does not reinterpret a function result as destroy on unmount', async () => {
    const source = `
export function App() {
  render(<div><output use={setup}></output></div>);
  function setup(el) {
    return () => {
      el.textContent = String(Number(el.textContent || '0') + 1);
    };
  }
}
`
    const mod = await loadGenerated(compile(source).code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    const output = container.querySelector('output')!
    expect(output.textContent).toBe('1')
    instance.unmount()
    expect(output.textContent).toBe('1')
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

describe('ADR-0011: use= action attribute in structural units', () => {
  it('initializes, updates, reuses, and destroys keyed list item actions', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1, label: 'one' }, { id: 2, label: 'two' }]);
  const active = signal(false);
  render(
    <div>
      <button onClick={shuffle}>shuffle</button>
      <button onClick={removeFirst}>remove</button>
      <button onClick={toggleActive}>active</button>
      <ul>
      {items().map((item) => (
        <li key={item.id} use={setup}>{item.label}</li>
      ))}
      </ul>
    </div>
  );
  function setup(el) {
    el.setAttribute('data-inits', String(Number(el.getAttribute('data-inits') || '0') + 1));
    const itemId = el.textContent;
    let log = el.ownerDocument.body.querySelector('[data-log]');
    if (!log) {
      log = el.ownerDocument.createElement('aside');
      log.setAttribute('data-log', 'true');
      el.ownerDocument.body.appendChild(log);
    }
    return {
      update() {
        el.setAttribute('data-updates', String(Number(el.getAttribute('data-updates') || '0') + 1));
        el.setAttribute('data-active', String(active()));
      },
      destroy() { log.textContent += 'destroy-' + itemId + ';'; },
    };
  }
  function shuffle() { items([{ id: 2, label: 'two' }, { id: 1, label: 'one' }]); }
  function removeFirst() { items([{ id: 2, label: 'two' }]); }
  function toggleActive() { active(!active()); }
}
`
    const { code } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    const items = [...container.querySelectorAll('li')]
    expect(items.map((el) => el.getAttribute('data-inits'))).toEqual(['1', '1'])
    expect(items.map((el) => el.getAttribute('data-updates'))).toEqual(['1', '1'])

    dispatchClick(container, container.querySelector('button'))
    const reordered = [...container.querySelectorAll('li')]
    expect(reordered.map((el) => el.textContent)).toEqual(['two', 'one'])
    expect(reordered.map((el) => el.getAttribute('data-inits'))).toEqual(['1', '1'])
    expect(reordered.map((el) => el.getAttribute('data-updates'))).toEqual(['2', '2'])
    dispatchClick(container, container.querySelectorAll('button')[2]!)
    expect(reordered.map((el) => el.getAttribute('data-active'))).toEqual(['true', 'true'])

    dispatchClick(container, container.querySelectorAll('button')[1]!)
    expect(container.querySelectorAll('li')).toHaveLength(1)
    expect(container.ownerDocument.body.querySelector('[data-log]')?.textContent).toBe(
      'destroy-one;',
    )
    instance.unmount()
    expect(container.ownerDocument.body.querySelector('[data-log]')?.textContent).toBe(
      'destroy-one;destroy-two;',
    )
  })

  it('keeps tracked writes from an item action listener connected to root updates', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1 }]);
  const clicks = signal(0);
  render(
    <div>
      <output>{clicks()}</output>
      <ul>{items().map((item) => <li key={item.id} use={setup}>{item.id}</li>)}</ul>
    </div>
  );
  function setup(el) {
    el.addEventListener('click', () => { clicks(clicks() + 1); });
  }
}
`
    const { code } = compile(source)
    expect(code).toContain('clicks = clicks + 1')
    expect(code).toContain('update_clicks()')
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => void)(container)
    const output = container.querySelector('output')!
    dispatchClick(container, container.querySelector('li'))
    expect(output.textContent).toBe('1')
  })

  it('mounts conditional branch actions after insertion and destroys on branch switch', async () => {
    const source = `
export function App() {
  const show = signal(true);
  const count = signal(0);
  render(<div><button onClick={toggle}>toggle</button><button onClick={increment}>increment</button>{show() ? <input use={setup}></input> : <span use={other}>off</span>}</div>);
  function toggle() { show(!show()); }
  function increment() { count(count() + 1); }
  function setup(el) {
    el.setAttribute('data-ready', String(el.isConnected));
    el.focus();
    return {
      update() { el.setAttribute('data-count', String(count())); },
      destroy() { el.ownerDocument.body.setAttribute('data-branch-destroyed', 'yes'); },
    };
  }
  function other(el) {
    el.setAttribute('data-ready', String(el.isConnected));
    return {
      update() { el.setAttribute('data-count', String(count())); },
      destroy() { el.ownerDocument.body.setAttribute('data-other-destroyed', 'yes'); },
    };
  }
}
`
    const mod = await loadGenerated(compile(source).code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    const input = container.querySelector('input')!
    expect(input.getAttribute('data-ready')).toBe('true')
    expect(input.getAttribute('data-count')).toBe('0')
    expect(container.ownerDocument.activeElement).toBe(input)
    dispatchClick(container, container.querySelectorAll('button')[1]!)
    expect(input.getAttribute('data-count')).toBe('1')
    dispatchClick(container, container.querySelector('button'))
    const span = container.querySelector('span')!
    expect(span.getAttribute('data-ready')).toBe('true')
    expect(span.getAttribute('data-count')).toBe('1')
    expect(container.ownerDocument.body.getAttribute('data-branch-destroyed')).toBe('yes')
    instance.unmount()
    expect(container.ownerDocument.body.getAttribute('data-other-destroyed')).toBe('yes')
  })

  it('hydrates a structural unit and initializes its action after the existing range is reused', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1, label: 'hydrated' }]);
  render(<ul>{items().map((item) => <li key={item.id} use={setup}>{item.label}</li>)}</ul>);
  function setup(el) {
    el.setAttribute('data-hydrated', String(el.isConnected));
    return { destroy() { el.setAttribute('data-destroyed', 'true'); } };
  }
}
`
    const { code, initialHtml } = compile(source)
    const mod = await loadGenerated(code)
    const container = createContainer()
    container.innerHTML = initialHtml
    const instance = (mod.hydrateComponent as (container: Element) => { unmount(): void })(
      container,
    )
    const item = container.querySelector('li')!
    expect(item.getAttribute('data-hydrated')).toBe('true')
    instance.unmount()
    expect(item.getAttribute('data-destroyed')).toBe('true')
  })

  it('connects an action update to an item-local signal without sharing instances', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1 }, { id: 2 }]);
  render(
    <ul>
      {items().map((item) => {
        const selected = signal(false);
        return (
          <li key={item.id} use={(el) => ({
            update: () => { el.setAttribute('data-selected', String(selected())); },
          })}>
            <button onClick={() => selected(!selected())}>select</button>
          </li>
        );
      })}
    </ul>
  );
}
`
    const mod = await loadGenerated(compile(source).code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => void)(container)
    const rows = [...container.querySelectorAll('li')]
    expect(rows.map((row) => row.getAttribute('data-selected'))).toEqual(['false', 'false'])
    dispatchClick(container, rows[0]!.querySelector('button'))
    expect(rows.map((row) => row.getAttribute('data-selected'))).toEqual(['true', 'false'])
  })

  it('routes an ancestor local signal to an action in a nested branch', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1 }]);
  render(
    <ul>
      {items().map((item) => {
        const selected = signal(false);
        return (
          <li key={item.id}>
            {selected() ? <span use={(el) => ({ update: () => { el.setAttribute('data-selected', String(selected())); } })}>selected</span> : <span>idle</span>}
            <button onClick={() => selected(!selected())}>toggle</button>
          </li>
        );
      })}
    </ul>
  );
}
`
    const mod = await loadGenerated(compile(source).code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => void)(container)
    expect(container.querySelector('li span')?.textContent).toBe('idle')
    dispatchClick(container, container.querySelector('button'))
    const selected = container.querySelector('li span')!
    expect(selected.textContent).toBe('selected')
    expect(selected.getAttribute('data-selected')).toBe('true')
  })

  it('keeps list action instances independent across two mounts of one module', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1, label: 'item' }]);
  render(<ul>{items().map((item) => <li key={item.id} use={setup}>{item.label}</li>)}</ul>);
  function setup(el) {
    el.setAttribute('data-inits', String(Number(el.getAttribute('data-inits') || '0') + 1));
    return { destroy() { el.setAttribute('data-destroyed', 'true'); } };
  }
}
`
    const mod = await loadGenerated(compile(source).code)
    const first = createContainer()
    const second = createContainer()
    const firstInstance = (mod.mountComponent as (container: Element) => { unmount(): void })(first)
    const secondInstance = (mod.mountComponent as (container: Element) => { unmount(): void })(
      second,
    )
    const firstItem = first.querySelector('li')!
    const secondItem = second.querySelector('li')!

    expect(firstItem.getAttribute('data-inits')).toBe('1')
    expect(secondItem.getAttribute('data-inits')).toBe('1')
    firstInstance.unmount()
    expect(first.childElementCount).toBe(0)
    expect(secondItem.getAttribute('data-destroyed')).toBeNull()
    secondInstance.unmount()
    expect(secondItem.getAttribute('data-destroyed')).toBe('true')
  })

  it('owns actions through three nested structural levels and releases descendants', async () => {
    const source = `
export function App() {
  const groups = signal([
    { id: 1, children: [{ id: 'a', show: true }] },
    { id: 2, children: [{ id: 'a', show: true }] },
  ]);
  const tick = signal(0);
  render(
    <div>
      <button onClick={change}>change</button>
      <button onClick={removeFirst}>remove</button>
      <button onClick={tickUp}>tick</button>
      {groups().map((group) => (
        <section key={group.id} use={outerAction}>
          {group.children.map((child) => (
            <div key={child.id} use={innerAction}>
              {child.show ? <span use={branchAction}>on</span> : <span>off</span>}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
  function change() {
    groups([
      { id: 1, children: [{ id: 'a', show: false }, { id: 'b', show: true }] },
      { id: 2, children: [{ id: 'a', show: false }, { id: 'b', show: true }] },
    ]);
  }
  function removeFirst() {
    groups([{ id: 2, children: [{ id: 'a', show: false }, { id: 'b', show: true }] }]);
  }
  function tickUp() { tick(tick() + 1); }
  function outerAction(el) {
    el.setAttribute('data-outer-init', 'true');
    return { destroy() { el.setAttribute('data-outer-destroyed', 'true'); } };
  }
  function innerAction(el) {
    el.setAttribute('data-inner-init', 'true');
    const onPing = () => el.setAttribute('data-ping', 'true');
    el.ownerDocument.addEventListener('ping', onPing);
    return {
      update() { el.setAttribute('data-tick', String(tick())); },
      destroy() { el.ownerDocument.removeEventListener('ping', onPing); },
    };
  }
  function branchAction(el) {
    el.setAttribute('data-branch-init', 'true');
    return { destroy() { el.setAttribute('data-branch-destroyed', 'true'); } };
  }
}
`
    const mod = await loadGenerated(compile(source).code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    const firstOuter = container.querySelectorAll('section')[0]!
    const firstInner = firstOuter.querySelector('div')!
    const firstBranch = firstInner.querySelector('[data-branch-init]')!
    expect(container.querySelectorAll('[data-outer-init]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-inner-init]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-branch-init]')).toHaveLength(2)
    expect(firstInner.getAttribute('data-tick')).toBe('0')

    dispatchClick(container, container.querySelector('button'))
    expect(container.querySelectorAll('[data-outer-init]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-inner-init]')).toHaveLength(4)
    expect(container.querySelectorAll('[data-branch-init]')).toHaveLength(2)
    expect(firstBranch.getAttribute('data-branch-destroyed')).toBe('true')

    dispatchClick(container, container.querySelectorAll('button')[2]!)
    expect(firstInner.getAttribute('data-tick')).toBe('1')

    dispatchClick(container, container.querySelectorAll('button')[1]!)
    expect(container.querySelectorAll('section')).toHaveLength(1)
    expect(firstOuter.getAttribute('data-outer-destroyed')).toBe('true')
    expect(firstInner.getAttribute('data-ping')).toBeNull()
    firstInner.ownerDocument.dispatchEvent(new firstInner.ownerDocument.defaultView!.Event('ping'))
    expect(firstInner.getAttribute('data-ping')).toBeNull()
    instance.unmount()
  })

  it('continues all item cleanup when one destroy throws and rethrows the first error', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1 }, { id: 2 }, { id: 3 }]);
  render(
    <ul>
      {items().map((item) => <li key={item.id} use={setup}>{item.id}</li>)}
    </ul>
  );
  function setup(el) {
    const id = el.textContent;
    return {
      destroy() {
        el.setAttribute('data-destroyed', 'true');
        if (id === '2') throw new Error('destroy-2');
      },
    };
  }
}
`
    const mod = await loadGenerated(compile(source).code)
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)
    const items = [...container.querySelectorAll('li')]
    expect(() => instance.unmount()).toThrow('destroy-2')
    expect(container.childElementCount).toBe(0)
    expect(items.map((item) => item.getAttribute('data-destroyed'))).toEqual([
      'true',
      'true',
      'true',
    ])
    expect(() => instance.unmount()).not.toThrow()
  })

  it('recovers already-mounted items when a later item action initialization fails', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1 }, { id: 2 }, { id: 3 }]);
  render(<ul>{items().map((item) => <li key={item.id} use={setup}>{item.id}</li>)}</ul>);
  function setup(el) {
    const id = el.textContent;
    if (id === '2') throw new Error('init-2');
    let log = el.ownerDocument.body.querySelector('[data-init-log]');
    if (!log) {
      log = el.ownerDocument.createElement('aside');
      log.setAttribute('data-init-log', 'true');
      el.ownerDocument.body.appendChild(log);
    }
    return { destroy() { log.textContent += 'destroy-' + id + ';'; } };
  }
}
`
    const mod = await loadGenerated(compile(source).code)
    const container = createContainer()
    const instance = (
      mod.createComponent as () => { mount(container: Element): void; unmount(): void }
    )()
    expect(() => instance.mount(container)).toThrow('init-2')
    expect(container.childElementCount).toBe(0)
    expect(container.ownerDocument.body.querySelector('[data-init-log]')?.textContent).toBe(
      'destroy-1;',
    )
    expect(() => instance.unmount()).not.toThrow()
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
