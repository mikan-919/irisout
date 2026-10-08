// 文種の制限を外しても、返り値・例外・更新時点がJavaScriptの意味を保持するかを検証する。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

interface ControlFlowState {
  result: unknown
  error: Error
  log: unknown[]
  pending?: Promise<unknown>
}

function state(): ControlFlowState {
  return (globalThis as typeof globalThis & { __irisoutHandlerControl: ControlFlowState })
    .__irisoutHandlerControl
}

async function mount(source: string): Promise<Element> {
  const { code } = compile(source)
  const mod = await loadGenerated(code)
  const container = createContainer()
  ;(mod.mountComponent as (container: Element) => unknown)(container)
  return container
}

function click(container: Element, selector = 'button'): void {
  const element = container.querySelector(selector)
  if (!element) throw new Error(`control flow test element missing: ${selector}`)
  const EventCtor = container.ownerDocument.defaultView!.Event
  element.dispatchEvent(new EventCtor('click', { bubbles: true }))
}

beforeEach(() => {
  vi.stubGlobal('__irisoutHandlerControl', {
    result: 'unset',
    error: new Error('authored failure'),
    log: [],
  } satisfies ControlFlowState)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ハンドラ内のJavaScript制御フロー', () => {
  it('補助関数の書込みと返り値を保持する', async () => {
    const container = await mount(`
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run() { globalThis.__irisoutHandlerControl.result = write(3); }
  function write(next) { value(next); return { value: next, kind: 'result' }; }
}
`)
    click(container)
    expect(container.querySelector('span')!.textContent).toBe('3')
    expect(state().result).toEqual({ value: 3, kind: 'result' })
  })

  it('書込みを含む式本体の返り値をPromiseの次の処理へ渡す', async () => {
    const container = await mount(`
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run() {
    globalThis.__irisoutHandlerControl.pending = Promise.resolve(4)
      .then(next => value(next))
      .then(next => { globalThis.__irisoutHandlerControl.result = next; });
  }
}
`)
    click(container)
    await state().pending
    expect(container.querySelector('span')!.textContent).toBe('4')
    expect(state().result).toBe(4)
  })

  it('書込みを含むブロック本体の返り値をPromiseの次の処理へ渡す', async () => {
    const container = await mount(`
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run() {
    globalThis.__irisoutHandlerControl.pending = Promise.resolve(4)
      .then(next => { value(next); return next * 2; })
      .then(next => { globalThis.__irisoutHandlerControl.result = next; });
  }
}
`)
    click(container)
    await state().pending
    expect(container.querySelector('span')!.textContent).toBe('4')
    expect(state().result).toBe(8)
  })

  it('signal書込みを含む式の演算子の優先順位を保持する', async () => {
    const container = await mount(`
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run() {
    globalThis.__irisoutHandlerControl.result = [value(2) + 3, value(5) === 5];
  }
}
`)
    click(container)
    expect(state().result).toEqual([5, true])
    expect(container.querySelector('span')!.textContent).toBe('5')
  })

  it('局所関数宣言の呼出しと返り値を保持する', async () => {
    const container = await mount(`
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run() {
    function write(next) { value(next); return next + 1; }
    globalThis.__irisoutHandlerControl.result = write(2);
  }
}
`)
    click(container)
    expect(state().result).toBe(3)
    expect(container.querySelector('span')!.textContent).toBe('2')
  })

  it('局所関数宣言のリスナーは発火時に更新する', async () => {
    const container = await mount(`
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><button use={setup}>run</button></div>);
  function setup(el) {
    function onClick() { value(7); return 9; }
    el.addEventListener('click', onClick);
  }
}
`)
    expect(container.querySelector('span')!.textContent).toBe('0')
    click(container)
    expect(container.querySelector('span')!.textContent).toBe('7')
  })

  it('ループのbreakとcontinueとラベルを保持する', async () => {
    const container = await mount(`
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run() {
    var total = 0;
    outer: for (let i = 0; i < 4; i++) {
      if (i === 1) continue outer;
      for (let j = 0; j < 3; j++) {
        if (j === 1) break;
        total += i;
      }
    }
    while (total < 7) total++;
    do { total++; } while (false);
    for (const next of [1, 2]) total += next;
    for (const key in { one: 1 }) total += key === 'one' ? 1 : 0;
    value(total);
    return total;
  }
}
`)
    click(container)
    expect(container.querySelector('span')!.textContent).toBe('12')
  })

  it('switchの分岐とbreakを保持する', async () => {
    const container = await mount(`
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run(event) {
    switch (event.type) {
      case 'click': value(7); break;
      default: value(9);
    }
  }
}
`)
    click(container)
    expect(container.querySelector('span')!.textContent).toBe('7')
  })

  it('書込み後のreturnでも更新し作者のfinallyを先に実行する', async () => {
    const container = await mount(`
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run() {
    try { value(1); return 8; }
    finally { value(value() + 1); globalThis.__irisoutHandlerControl.log.push('finally'); }
  }
}
`)
    click(container)
    expect(container.querySelector('span')!.textContent).toBe('2')
    expect(state().log).toEqual(['finally'])
  })

  it('try-catch-finallyの例外と書込みの順序を保持する', async () => {
    const container = await mount(`
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run() {
    try { value(1); throw globalThis.__irisoutHandlerControl.error; }
    catch (error) { globalThis.__irisoutHandlerControl.result = error; value(2); }
    finally { value(value() + 1); }
  }
}
`)
    click(container)
    expect(container.querySelector('span')!.textContent).toBe('3')
    expect(state().result).toBe(state().error)
  })

  it('書込み後のthrowでもDOMを更新し例外を保持する', async () => {
    const container = await mount(`
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run() { value(3); throw globalThis.__irisoutHandlerControl.error; }
}
`)
    const errors: unknown[] = []
    container.ownerDocument.defaultView!.addEventListener('error', (event) => {
      errors.push(event.error)
      event.preventDefault()
    })
    click(container)
    expect(container.querySelector('span')!.textContent).toBe('3')
    expect(errors).toEqual([state().error])
  })

  it('書込み前のreturnではeffectを再実行しない', async () => {
    const container = await mount(`
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  effect(() => { globalThis.__irisoutHandlerControl.log.push(value()); });
  function run() { if (value() === 0) return; value(1); }
}
`)
    expect(state().log).toEqual([0])
    click(container)
    expect(container.querySelector('span')!.textContent).toBe('0')
    expect(state().log).toEqual([0])
  })

  it('非同期補助関数はawait後の書込みを更新する', async () => {
    const container = await mount(`
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run() { globalThis.__irisoutHandlerControl.pending = load(); }
  async function load() { const next = await Promise.resolve(5); value(next); }
}
`)
    click(container)
    expect(container.querySelector('span')!.textContent).toBe('0')
    await state().pending
    expect(container.querySelector('span')!.textContent).toBe('5')
  })

  it('補助関数内のPromise完了処理は実行時に更新する', async () => {
    const container = await mount(`
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run() { load(); }
  function load() {
    globalThis.__irisoutHandlerControl.pending = Promise.resolve(6).then(next => { value(next); });
  }
}
`)
    click(container)
    expect(container.querySelector('span')!.textContent).toBe('0')
    await state().pending
    expect(container.querySelector('span')!.textContent).toBe('6')
  })

  it('actionの返り値は初期化本体の局所変数を閉包する', async () => {
    const container = await mount(`
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><button use={setup}>run</button></div>);
  function setup(el) {
    const label = 'captured';
    value(1);
    return () => { el.setAttribute('data-label', label); };
  }
}
`)
    expect(container.querySelector('span')!.textContent).toBe('1')
    expect(container.querySelector('button')!.getAttribute('data-label')).toBe('captured')
  })

  it('部品の引数を置換した非同期完了処理でもawaitと返り値を保持する', async () => {
    const container = await mount(`
function Child({ step }) {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run() {
    globalThis.__irisoutHandlerControl.pending = Promise.resolve(step)
      .then(async next => { await Promise.resolve(); value(next); return next + step; })
      .then(next => { globalThis.__irisoutHandlerControl.result = next; });
  }
}
export function App() { render(<Child step={2} />); }
`)
    click(container)
    await state().pending
    expect(container.querySelector('span')!.textContent).toBe('2')
    expect(state().result).toBe(4)
  })

  it('局所クラスのメソッドは呼出し時に更新し返り値を保持する', async () => {
    const container = await mount(`
export function App() {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run() {
    class Writer { write(next) { value(next); return next + 1; } }
    const writer = new Writer();
    globalThis.__irisoutHandlerControl.result = writer.write(2);
  }
}
`)
    click(container)
    expect(container.querySelector('span')!.textContent).toBe('2')
    expect(state().result).toBe(3)
  })

  it('部品の引数を置換したクラスメソッドでもsuperを保持する', async () => {
    const container = await mount(`
function Child({ step }) {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run() {
    class Base { write(next) { return next + 1; } }
    class Writer extends Base {
      write(next) { value(next); return super.write(next) + step; }
    }
    const writer = new Writer();
    globalThis.__irisoutHandlerControl.result = writer.write(2);
  }
}
export function App() { render(<Child step={2} />); }
`)
    click(container)
    expect(container.querySelector('span')!.textContent).toBe('2')
    expect(state().result).toBe(5)
  })

  it('部品の引数を置換したオブジェクトメソッドでもsuperを保持する', async () => {
    const container = await mount(`
function Child({ step }) {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run() {
    const base = { write(next) { return next + 1; } };
    const writer = {
      __proto__: base,
      write(next) { value(next); return super.write(next) + step; }
    };
    globalThis.__irisoutHandlerControl.result = writer.write(2);
  }
}
export function App() { render(<Child step={2} />); }
`)
    click(container)
    expect(container.querySelector('span')!.textContent).toBe('2')
    expect(state().result).toBe(5)
  })

  it('部品の引数を置換したコンストラクターでもsuper呼出しを保持する', async () => {
    const container = await mount(`
function Child({ step }) {
  const value = signal(0);
  render(<div><span>{value()}</span><button onClick={run}>run</button></div>);
  function run() {
    class Base { constructor() { this.tag = 'base'; } }
    class Writer extends Base {
      constructor(next) { super(); value(next); this.result = next + step; }
    }
    const writer = new Writer(2);
    globalThis.__irisoutHandlerControl.result = [writer.tag, writer.result];
  }
}
export function App() { render(<Child step={2} />); }
`)
    click(container)
    expect(container.querySelector('span')!.textContent).toBe('2')
    expect(state().result).toEqual(['base', 4])
  })
})
