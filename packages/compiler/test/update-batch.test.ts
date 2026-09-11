import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

function click(container: Element, selector: string): void {
  const element = container.querySelector(selector)
  if (!element) throw new Error(`click: ${selector} not found`)
  const Event = (
    container.ownerDocument as unknown as {
      defaultView: { Event: typeof globalThis.Event }
    }
  ).defaultView.Event
  element.dispatchEvent(new Event('click'))
}

function countTextContentWrites(container: Element): { get: () => number; restore: () => void } {
  const view = container.ownerDocument.defaultView
  if (!view) throw new Error('countTextContentWrites: document has no defaultView')
  const prototype = view.Node.prototype
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'textContent')
  if (!descriptor?.set || !descriptor.get) {
    throw new Error('countTextContentWrites: textContent descriptor is unavailable')
  }
  let count = 0
  Object.defineProperty(prototype, 'textContent', {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get(this: Node) {
      return descriptor.get!.call(this)
    },
    set(this: Node, value: string | null) {
      count += 1
      descriptor.set!.call(this, value)
    },
  })
  return {
    get: () => count,
    restore: () => Object.defineProperty(prototype, 'textContent', descriptor),
  }
}

describe('synchronous update batches', () => {
  it('updates a marker shared by two root writes exactly once', async () => {
    const source = `
export function App() {
  const left = signal(0);
  const right = signal(0);
  render(
    <div>
      <p>{left()}:{right()}</p>
      <button onClick={() => { left(1); right(2); }}>set</button>
    </div>
  );
}
`
    const { code } = compile(source)
    expect(code).toContain('__update_batch_0__()')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => void)(container)
    const writes = countTextContentWrites(container)
    try {
      click(container, 'button')
      expect(container.querySelector('p')?.textContent).toBe('1:2')
      expect(writes.get()).toBe(1)
    } finally {
      writes.restore()
    }
  })

  it('recomputes a derived value after all root writes and updates its marker once', async () => {
    const source = `
export function App() {
  const left = signal(1);
  const right = signal(2);
  const total = derived(() => left() + right());
  render(
    <div>
      <p>{total()}</p>
      <button onClick={() => { left(10); right(20); }}>set</button>
    </div>
  );
}
`
    const { code } = compile(source)
    expect(code).toContain('__update_batch_0__()')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => void)(container)
    const writes = countTextContentWrites(container)
    try {
      click(container, 'button')
      expect(container.querySelector('p')?.textContent).toBe('30')
      expect(writes.get()).toBe(1)
    } finally {
      writes.restore()
    }
  })

  it('keeps separate markers on the ordinary individual update path', async () => {
    const source = `
export function App() {
  const left = signal(0);
  const right = signal(0);
  render(
    <div>
      <p class="left">{left()}</p>
      <p class="right">{right()}</p>
      <button onClick={() => { left(1); right(2); }}>set</button>
    </div>
  );
}
`
    const { code } = compile(source)
    expect(code).not.toContain('__update_batch_')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => void)(container)
    click(container, 'button')
    expect(container.querySelector('.left')?.textContent).toBe('1')
    expect(container.querySelector('.right')?.textContent).toBe('2')
  })

  it('deduplicates repeated writes to one root without emitting a batch', async () => {
    const source = `
export function App() {
  const count = signal(0);
  render(
    <div>
      <p>{count()}</p>
      <button onClick={() => { count(1); count(2); }}>set</button>
    </div>
  );
}
`
    const { code } = compile(source)
    expect(code).not.toContain('__update_batch_')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => void)(container)
    const writes = countTextContentWrites(container)
    try {
      click(container, 'button')
      expect(container.querySelector('p')?.textContent).toBe('2')
      expect(writes.get()).toBe(1)
    } finally {
      writes.restore()
    }
  })

  it('evaluates a shared conditional marker once after two writes settle', async () => {
    const source = `
export function App() {
  const left = signal(true);
  const right = signal(true);
  render(
    <div>
      <section>{left() === right() ? <span>same</span> : <p>different</p>}</section>
      <button onClick={() => { left(false); right(false); }}>set</button>
    </div>
  );
}
`
    const { code } = compile(source)
    expect(code).toContain('__update_batch_0__()')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => void)(container)
    const branch = container.querySelector('span')!
    const originalRemove = branch.remove.bind(branch)
    let removeCalls = 0
    branch.remove = (() => {
      removeCalls += 1
      return originalRemove()
    }) as typeof branch.remove
    try {
      click(container, 'button')
      expect(container.querySelector('span')).toBe(branch)
      expect(container.querySelector('p')).toBeNull()
      expect(removeCalls).toBe(0)
    } finally {
      branch.remove = originalRemove
    }
  })

  it('runs a shared List marker once after its array and filter roots settle', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1 }]);
  const visible = signal(true);
  render(
    <div>
      <ul>{items().filter(() => visible()).map((item) => <li key={item.id}>{item.id}</li>)}</ul>
      <button onClick={() => { items([...items(), { id: 2 }]); visible(false); }}>set</button>
    </div>
  );
}
`
    const { code } = compile(source)
    expect(code).toContain('__update_batch_0__()')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => void)(container)
    const list = container.querySelector('ul')!
    const originalInsertBefore = list.insertBefore.bind(list)
    let insertCalls = 0
    list.insertBefore = ((node: Node, reference: Node | null) => {
      insertCalls += 1
      return originalInsertBefore(node, reference)
    }) as typeof list.insertBefore
    try {
      click(container, 'button')
      expect(list.querySelectorAll('li')).toHaveLength(0)
      // 個別更新なら items setter 時点で一度 li を追加してから、visible setter
      // で全件を除去する。batchでは最終的な空配列だけをreconcileする。
      expect(insertCalls).toBe(0)
    } finally {
      list.insertBefore = originalInsertBefore
    }
  })

  it('batches writes discovered through a tracked movement-zone function', async () => {
    const source = `
export function App() {
  const left = signal(0);
  const right = signal(0);
  render(
    <div>
      <p>{left()}:{right()}</p>
      <button onClick={() => setBoth()}>set</button>
    </div>
  );
  function setBoth() { left(1); right(2); }
}
`
    const { code } = compile(source)
    expect(code).toContain('__update_batch_0__()')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => void)(container)
    const writes = countTextContentWrites(container)
    try {
      click(container, 'button')
      expect(container.querySelector('p')?.textContent).toBe('1:2')
      expect(writes.get()).toBe(1)
    } finally {
      writes.restore()
    }
  })

  it('batches writes in an action return closure', async () => {
    const source = `
export function App() {
  const left = signal(0);
  const right = signal(0);
  render(
    <div>
      <p>{left()}:{right()}</p>
      <canvas use={setup}></canvas>
    </div>
  );
  function setup(el) { return () => { left(1); right(2); }; }
}
`
    const { code } = compile(source)
    expect(code).toContain('__update_batch_0__()')

    const mod = await loadGenerated(code)
    const container = createContainer()
    const writes = countTextContentWrites(container)
    try {
      ;(mod.mountComponent as (container: Element) => void)(container)
      expect(container.querySelector('p')?.textContent).toBe('1:2')
      expect(writes.get()).toBe(1)
    } finally {
      writes.restore()
    }
  })

  it('updates two attributes sharing one host marker once per binding', async () => {
    const source = `
export function App() {
  const left = signal(0);
  const right = signal(0);
  render(
    <div>
      <p class={left() ? 'on' : 'off'} title={right() ? 'new' : 'old'}>text</p>
      <button onClick={() => { left(1); right(1); }}>set</button>
    </div>
  );
}
`
    const { code } = compile(source)
    expect(code).toContain('__update_batch_0__()')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => void)(container)
    const element = container.querySelector('p')!
    const originalSetAttribute = element.setAttribute.bind(element)
    let classWrites = 0
    let titleWrites = 0
    element.setAttribute = ((name: string, value: string) => {
      if (name === 'class') classWrites += 1
      if (name === 'title') titleWrites += 1
      return originalSetAttribute(name, value)
    }) as typeof element.setAttribute
    try {
      click(container, 'button')
      expect(element.getAttribute('class')).toBe('on')
      expect(element.getAttribute('title')).toBe('new')
      expect(classWrites).toBe(1)
      expect(titleWrites).toBe(1)
    } finally {
      element.setAttribute = originalSetAttribute
    }
  })

  it('batches a functional signal update when another root shares its marker', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1, text: 'a' }]);
  const suffix = signal('');
  render(
    <div>
      <p>{items().map((item) => item.text).join(',')}{suffix()}</p>
      <button onClick={() => { items((previous) => previous.map((item) => ({ ...item, text: 'b' }))); suffix('!'); }}>set</button>
    </div>
  );
}
`
    const { code } = compile(source)
    expect(code).toContain('__update_batch_0__()')
    expect(code).not.toContain('__update_batch_depth__')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => void)(container)
    const writes = countTextContentWrites(container)
    try {
      click(container, 'button')
      expect(container.querySelector('p')?.textContent).toBe('b!')
      expect(writes.get()).toBe(1)
    } finally {
      writes.restore()
    }
  })

  it('uses the normal update path for one functional signal write', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1, text: 'a' }]);
  render(
    <div>
      <p>{items().map((item) => item.text).join(',')}</p>
      <button onClick={() => items((previous) => previous.map((item) => ({ ...item, text: 'b' })))}>set</button>
    </div>
  );
}
`
    const { code } = compile(source)
    expect(code).not.toContain('__update_batch_')
    expect(code).toContain('update_items();')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => void)(container)
    click(container, 'button')
    expect(container.querySelector('p')?.textContent).toBe('b')
  })

  it('batches a functional signal update from an action closure', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1, text: 'a' }]);
  const suffix = signal('');
  render(
    <div>
      <p>{items().map((item) => item.text).join(',')}{suffix()}</p>
      <canvas use={setup}></canvas>
    </div>
  );
  function setup(el) { return () => { items((previous) => previous.map((item) => ({ ...item, text: 'b' }))); suffix('!'); }; }
}
`
    const { code } = compile(source)
    expect(code).toContain('__update_batch_0__()')
    expect(code).not.toContain('__update_batch_depth__')

    const mod = await loadGenerated(code)
    const container = createContainer()
    const writes = countTextContentWrites(container)
    try {
      ;(mod.mountComponent as (container: Element) => void)(container)
      expect(container.querySelector('p')?.textContent).toBe('b!')
      expect(writes.get()).toBe(1)
    } finally {
      writes.restore()
    }
  })

  it('uses one batch for value and functional setters with a shared marker', async () => {
    const source = `
export function App() {
  const items = signal([{ id: 1, text: 'a' }]);
  const suffix = signal('');
  render(
    <div>
      <p>{items().map((item) => item.text).join(',')}{suffix()}</p>
      <button class="replace" onClick={() => { items([{ id: 1, text: 'r' }]); suffix('!'); }}>replace</button>
      <button class="update" onClick={() => { items((previous) => previous.map((item) => ({ ...item, text: 'u' }))); suffix('?'); }}>update</button>
    </div>
  );
}
`
    const { code } = compile(source)
    expect(code).not.toContain('__update_batch_depth__')

    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => void)(container)
    const writes = countTextContentWrites(container)
    let writesRestored = false
    try {
      click(container, '.replace')
      expect(container.querySelector('p')?.textContent).toBe('r!')
      expect(writes.get()).toBe(1)

      writes.restore()
      writesRestored = true
      const updateWrites = countTextContentWrites(container)
      try {
        click(container, '.update')
        expect(container.querySelector('p')?.textContent).toBe('u?')
        expect(updateWrites.get()).toBe(1)
      } finally {
        updateWrites.restore()
      }
    } finally {
      if (!writesRestored) writes.restore()
    }
  })
})
