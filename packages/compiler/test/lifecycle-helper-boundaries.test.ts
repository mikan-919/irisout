// 補助関数を実行する依存と、後始末だけが呼ぶ補助関数の更新境界を実DOMで検証する。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

interface Instance {
  unmount(): void
}

function log(): string[] {
  return (globalThis as typeof globalThis & { __lifecycleHelperLog: string[] }).__lifecycleHelperLog
}

async function mount(source: string): Promise<{ container: Element; instance: Instance }> {
  const result = compile(source)
  const module = await loadGenerated(result.code)
  const container = createContainer()
  const instance = (module.mountComponent as (container: Element) => Instance)(container)
  return { container, instance }
}

function click(container: Element, selector = 'button'): void {
  container
    .querySelector(selector)!
    .dispatchEvent(new container.ownerDocument.defaultView!.Event('click', { bubbles: true }))
}

beforeEach(() => vi.stubGlobal('__lifecycleHelperLog', []))
afterEach(() => vi.unstubAllGlobals())

describe('呼び出した補助関数の読み取り依存', () => {
  it.each([
    ['関数宣言', 'function read() { return count(); }', 'read()'],
    ['即時実行する矢印関数', '', '(() => count())()'],
    ['補助関数内の即時実行', 'function read() { return (() => count())(); }', 'read()'],
    ['矢印関数', 'const read = () => count();', 'read()'],
    [
      '推移呼出し',
      'function outer() { return read(); } function read() { return count(); }',
      'outer()',
    ],
    [
      '相互再帰',
      'function read(n) { if (n > 0) return other(n - 1); return count(); } function other(n) { return read(n); }',
      'read(2)',
    ],
  ])('effectは%sの実行が読む状態で再実行する', async (_, declaration, expression) => {
    const { container, instance } = await mount(`export function App() {
      const count = signal(0);
      render(<button onClick={() => count(count() + 1)}>{count()}</button>);
      effect(() => { ${declaration} globalThis.__lifecycleHelperLog.push('body:' + ${expression}); });
    }`)
    expect(log()).toEqual(['body:0'])
    click(container)
    expect(log()).toEqual(['body:0', 'body:1'])
    instance.unmount()
  })

  it('useの更新関数から呼ぶ局所関数の読み取りを更新依存へ合流する', async () => {
    const { container, instance } = await mount(`export function App() {
      const count = signal(0);
      render(<div><button onClick={() => count(count() + 1)}>increment</button><span use={setup}>fixed</span></div>);
      function setup(el) { function read() { return count(); } return () => {
        globalThis.__lifecycleHelperLog.push('update:' + read());
      }; }
    }`)
    expect(log()).toEqual(['update:0'])
    click(container)
    expect(log()).toEqual(['update:0', 'update:1'])
    instance.unmount()
  })

  it.each([
    ['作成だけ', 'const read = () => count();'],
    [
      '後始末だけの直接参照',
      'return () => { globalThis.__lifecycleHelperLog.push("cleanup:" + count()); };',
    ],
    [
      '後始末内の局所関数',
      'return () => { function read() { return count(); } globalThis.__lifecycleHelperLog.push("cleanup:" + read()); };',
    ],
    [
      '初期化で作成し後始末だけで呼出し',
      'function read() { return count(); } return () => { globalThis.__lifecycleHelperLog.push("cleanup:" + read()); };',
    ],
  ])('effectは%sの読み取りで再実行しない', async (_, body) => {
    const { container, instance } = await mount(`export function App() {
      const count = signal(0);
      render(<button onClick={() => count(count() + 1)}>{count()}</button>);
      effect(() => { globalThis.__lifecycleHelperLog.push('setup'); ${body} });
    }`)
    click(container)
    expect(log()).toEqual(['setup'])
    instance.unmount()
    expect(log()).toEqual(body.includes('cleanup:') ? ['setup', 'cleanup:1'] : ['setup'])
  })

  it('destroyだけが読む状態はuse更新の依存へ合流しない', async () => {
    const { container, instance } = await mount(`export function App() {
      const count = signal(0);
      render(<button use={setup} onClick={() => count(count() + 1)}>{count()}</button>);
      function setup(el) { globalThis.__lifecycleHelperLog.push('setup'); return {
        destroy() { function read() { return count(); } globalThis.__lifecycleHelperLog.push('destroy:' + read()); }
      }; }
    }`)
    click(container)
    expect(log()).toEqual(['setup'])
    instance.unmount()
    expect(log()).toEqual(['setup', 'destroy:1'])
  })
})

describe('後始末専用の補助関数', () => {
  it.each([
    ['同期', 'function cleanupHelper() { count(count() + 1); }'],
    ['同期矢印の呼出し', 'function cleanupHelper() { (() => count(count() + 1))(); }'],
    [
      '局所関数の呼出し',
      'function cleanupHelper() { function write() { count(count() + 1); } write(); }',
    ],
    [
      'Promiseの継続',
      'function cleanupHelper() { Promise.resolve().then(() => count(count() + 1)); }',
    ],
    [
      '非同期関数',
      'async function cleanupHelper() { await Promise.resolve(); count(count() + 1); }',
    ],
    [
      '別の補助関数への推移呼出し',
      'function cleanupHelper() { deferred(); } function deferred() { Promise.resolve().then(() => count(count() + 1)); }',
    ],
    [
      '内部の非同期補助関数への呼出し',
      'function cleanupHelper() { Promise.resolve().then(() => deferred()); } async function deferred() { await Promise.resolve(); count(count() + 1); }',
    ],
  ])('削除された項目の%sは生存DOMへ更新を発火しない', async (_, helper) => {
    const { container, instance } = await mount(`export function App() {
      const count = signal(0); const items = signal([{ id: 1 }]);
      render(<div><span>{count()}</span><button onClick={() => items([])}>remove</button><ul>{items().map(item => {
        onMount(() => () => cleanupHelper()); ${helper} return <li key={item.id}>item</li>;
      })}</ul><button class="read" onClick={() => globalThis.__lifecycleHelperLog.push('state:' + count())}>read</button></div>);
    }`)
    click(container)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(container.querySelectorAll('li')).toHaveLength(0)
    expect(container.querySelector('span')!.textContent).toBe('0')
    click(container, '.read')
    expect(log()).toEqual(['state:1'])
    instance.unmount()
  })

  it('項目の局所状態を補助関数が後始末中にも閉包する', async () => {
    const { container, instance } = await mount(`export function App() {
      const items = signal([{ id: 1 }]);
      render(<div><button onClick={() => items([])}>remove</button><ul>{items().map(item => {
        const local = signal(0);
        onMount(() => () => cleanupHelper());
        function cleanupHelper() { local(1); globalThis.__lifecycleHelperLog.push('local:' + local()); }
        return <li key={item.id}>{local()}</li>;
      })}</ul></div>);
    }`)
    const errors: unknown[] = []
    container.ownerDocument.defaultView!.addEventListener('error', (event) => {
      errors.push(event.error)
      event.preventDefault()
    })
    click(container)
    expect(errors).toEqual([])
    expect(log()).toEqual(['local:1'])
    expect(container.querySelectorAll('li')).toHaveLength(0)
    instance.unmount()
  })

  it.each([
    ['関数宣言', 'function local() { helper(); }'],
    ['矢印関数', 'const local = () => helper();'],
  ])('初期化で作成した%s経由でも後始末専用経路を使う', async (_, declaration) => {
    const { container, instance } = await mount(`export function App() {
      const count = signal(0); const items = signal([{ id: 1 }]);
      render(<div><span>{count()}</span><button onClick={() => items([])}>remove</button><ul>{items().map(item => {
        onMount(() => { ${declaration} return () => local(); });
        function helper() { Promise.resolve().then(() => count(count() + 1)); }
        return <li key={item.id}>item</li>;
      })}</ul></div>);
    }`)
    click(container)
    await Promise.resolve()
    await Promise.resolve()
    expect(container.querySelector('span')!.textContent).toBe('0')
    instance.unmount()
  })

  it('元の補助関数が読むroot状態を初期化の同名変数で遮蔽しない', async () => {
    const { container, instance } = await mount(`export function App() {
      const value = signal(0); const visible = signal(true); const prefix = signal('root');
      render(<div><span>{value()}</span><button onClick={() => visible(false)}>hide</button>{visible() && <Child write={write} />}</div>);
      function write() { value(9); globalThis.__lifecycleHelperLog.push(prefix()); }
    }
    function Child({write}) {
      render(<span>child</span>);
      onMount(() => { const prefix = 'initializer'; return () => { write(); }; });
    }`)
    click(container)
    expect(log()).toEqual(['root'])
    expect(container.querySelector('span')!.textContent).toBe('0')
    instance.unmount()
  })

  it('解除へ渡すlistenerは登録時と同じ関数参照を保持する', async () => {
    const target = createContainer()
    vi.stubGlobal('__lifecycleHelperTarget', target)
    const { container, instance } = await mount(`export function App() {
      const value = signal(0); const visible = signal(true);
      render(<div><span>{value()}</span><button onClick={() => visible(false)}>hide</button>{visible() && <Child />}</div>);
    }
    function Child() {
      render(<span>child</span>);
      onMount(() => {
        function listener() { globalThis.__lifecycleHelperLog.push('event'); }
        globalThis.__lifecycleHelperTarget.addEventListener('ping', listener);
        return () => { globalThis.__lifecycleHelperTarget.removeEventListener('ping', listener); };
      });
    }`)
    const ping = () => target.dispatchEvent(new target.ownerDocument.defaultView!.Event('ping'))
    ping()
    expect(log()).toEqual(['event'])
    click(container)
    ping()
    expect(log()).toEqual(['event'])
    instance.unmount()
  })

  it.each([
    ['初期化で作成した局所関数', 'function helper() { count(1); }', 'helper'],
    ['動きゾーンの関数', '', 'write'],
  ])('後始末で%sを遅延実行へ渡す境界は位置付き診断で拒否する', (_, declaration, name) => {
    expect(() =>
      compile(`export function App() {
      const count = signal(0);
      render(<span>{count()}</span>);
      onMount(() => { ${declaration} return () => { Promise.resolve().then(${name}); }; });
      function write() { count(1); }
    }`),
    ).toThrow(/passing tracked function values.*\[<source>:4:/)
  })

  it('通常の動きゾーンの関数値も変換せず受理しない', () => {
    expect(() =>
      compile(`export function App() {
      const count = signal(0);
      render(<button onClick={() => Promise.resolve().then(write)}>{count()}</button>);
      function write() { count(1); }
    }`),
    ).toThrow(/passing tracked function values.*\[<source>:3:/)
  })

  it.each([
    ['name', 'helper.name', 'helper'],
    ['length', 'helper.length', '0'],
    ['typeof', 'typeof helper', 'function'],
    ['参照の比較', 'helper === globalThis.__lifecycleRegistered', 'true'],
  ])('後始末の補助関数の%s読み取りは元の関数を保持する', async (_, expression, expected) => {
    const { instance } = await mount(`export function App() {
      render(<span>ready</span>);
      onMount(() => {
        function helper() { }
        globalThis.__lifecycleRegistered = helper;
        return () => { globalThis.__lifecycleHelperLog.push(String(${expression})); };
      });
    }`)
    instance.unmount()
    expect(log()).toEqual([expected])
    Reflect.deleteProperty(globalThis, '__lifecycleRegistered')
  })

  it('返却後のconst矢印関数宣言は後始末でも未初期化のままにする', async () => {
    const { instance } = await mount(`export function App() {
      render(<span>ready</span>);
      onMount(() => {
        if (globalThis.__lifecycleHelperLog.length === 0) return () => helper();
        const helper = () => { globalThis.__lifecycleHelperLog.push('unexpected'); };
      });
    }`)
    expect(() => instance.unmount()).toThrow(ReferenceError)
    expect(log()).toEqual([])
  })

  it('分岐の中で宣言した矢印関数は同じ分岐の局所変数を閉包する', async () => {
    const { instance } = await mount(`export function App() {
      render(<span>ready</span>);
      onMount(() => {
        if (globalThis.__lifecycleHelperLog.length === 0) {
          const prefix = 'branch';
          const helper = () => { globalThis.__lifecycleHelperLog.push(prefix); };
          return () => helper();
        }
      });
    }`)
    instance.unmount()
    expect(log()).toEqual(['branch'])
  })

  it('分岐の中の関数宣言は同じブロックで巻き上げられる', async () => {
    const { instance } = await mount(`export function App() {
      render(<span>ready</span>);
      onMount(() => {
        if (globalThis.__lifecycleHelperLog.length === 0) {
          const prefix = 'branch';
          return () => helper();
          function helper() { globalThis.__lifecycleHelperLog.push(prefix); }
        }
      });
    }`)
    instance.unmount()
    expect(log()).toEqual(['branch'])
  })

  it('再代入される関数の後始末呼出しは位置付き診断で拒否する', () => {
    expect(() =>
      compile(`export function App() {
      render(<span>ready</span>);
      onMount(() => {
        let helper = () => { globalThis.__lifecycleHelperLog.push('first'); };
        helper = () => { globalThis.__lifecycleHelperLog.push('second'); };
        return () => helper();
      });
    }`),
    ).toThrow(/calling reassigned functions from cleanup.*\[<source>:6:/)
  })

  it('インライン化した子のAST生成でもconst補助関数の未初期化を保つ', async () => {
    const { instance } = await mount(`export function App() {
      const count = signal(0);
      render(<Child write={write} />);
      function write() { count(1); globalThis.__lifecycleHelperLog.push('unexpected'); }
    }
    function Child({write}) {
      render(<span>ready</span>);
      onMount(() => {
        if (globalThis.__lifecycleHelperLog.length === 0) return () => helper();
        const helper = () => write();
      });
    }`)
    expect(() => instance.unmount()).toThrow(ReferenceError)
    expect(log()).toEqual([])
  })

  it('インライン化した子でも分岐内の関数宣言は同じブロックで巻き上げる', async () => {
    const { instance } = await mount(`export function App() {
      render(<Child report={report} />);
      function report(value) { globalThis.__lifecycleHelperLog.push(value); }
    }
    function Child({report}) {
      render(<span>ready</span>);
      onMount(() => {
        if (globalThis.__lifecycleHelperLog.length === 0) {
          const value = 'branch';
          return () => helper();
          function helper() { report(value); }
        }
      });
    }`)
    instance.unmount()
    expect(log()).toEqual(['branch'])
  })
})
