// 関数値の別名・引数・返却を、生成物の実行と更新の所有期間で検証する。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { compile } from '../src/compiler.ts'
import { createContainer, loadGenerated } from './helpers.ts'

async function mount(body: string) {
  const result = compile(`export function App() { ${body} }`)
  const module = await loadGenerated(result.code)
  const container = createContainer()
  const instance = (module.mountComponent as (container: Element) => { unmount(): void })(container)
  return { container, instance }
}
function click(container: Element) {
  container
    .querySelector('button')!
    .dispatchEvent(new container.ownerDocument.defaultView!.Event('click'))
}
function log(): unknown[] {
  return (globalThis as typeof globalThis & { __boundaries: unknown[] }).__boundaries
}
beforeEach(() => vi.stubGlobal('__boundaries', []))
afterEach(() => vi.unstubAllGlobals())

describe('静的な関数値', () => {
  it.each([
    [
      '局所関数',
      'function write() { count(count() + 1); }',
      'const first = write; const second = first; second();',
    ],
    ['動きゾーン関数', '', 'const first = write; const second = first; second();'],
    [
      '引数',
      'function invoke(fn) { return fn(); } function write() { count(count() + 1); }',
      'invoke(write);',
    ],
    [
      '引数の転送',
      'function invoke(fn) { return forward(fn); } function forward(fn) { return fn(); }',
      'invoke(write);',
    ],
  ])('%sを経由して書込みと返却を実行する', async (_, declarations, calls) => {
    const { container, instance } = await mount(`
      const count = signal(0);
      render(<button onClick={run}>{count()}</button>);
      function run() { ${declarations} ${calls} }
      function write() { count(count() + 1); return count(); }
    `)
    click(container)
    expect(container.textContent).toBe('1')
    instance.unmount()
  })

  it.each([
    'function read() { return count(); } const alias = read; const again = alias; globalThis.__boundaries.push(again());',
    'function invoke(fn) { return fn(); } function read() { return count(); } globalThis.__boundaries.push(invoke(read));',
  ])('effectは実行する関数値の読取りへ依存する: %s', async (body) => {
    const { container, instance } = await mount(`
      const count = signal(0);
      render(<button onClick={() => count(1)}>{count()}</button>);
      effect(() => { ${body} });
    `)
    click(container)
    expect(log()).toEqual([0, 1])
    instance.unmount()
  })

  it('引数経由の書込みもeffectで拒否する', () => {
    expect(() =>
      compile(`export function App() {
      const count = signal(0);
      render(<p>{count()}</p>);
      effect(() => { function invoke(fn) { fn(); } invoke(write); });
      function write() { count(1); }
    }`),
    ).toThrow(/effect.*scope limit/)
  })

  it('constへ保存した後始末は閉包とfinallyを保持する', async () => {
    const { instance } = await mount(`
      render(<p>ready</p>);
      onMount(() => {
        const prefix = 'cleanup';
        const cleanup = () => globalThis.__boundaries.push(prefix);
        const alias = cleanup;
        try { return alias; } finally { globalThis.__boundaries.push('finally'); }
      });
    `)
    expect(log()).toEqual(['finally'])
    instance.unmount()
    expect(log()).toEqual(['finally', 'cleanup'])
  })

  it('後始末での別名・引数経由の書込みは生存中のDOMを反映しない', async () => {
    const { container, instance } = await mount(`
      const count = signal(0);
      const show = signal(true);
      render(<div><span>{count()}</span><button onClick={() => show(false)}>remove</button>{show() && <Child write={write} />}</div>);
      function write() { count(1); Promise.resolve().then(() => count(2)); }
    }
    function Child({write}) {
      render(<p>child</p>);
      onMount(() => {
        function invoke(fn) { fn(); }
        const alias = write;
        return () => invoke(alias);
      });
    `)
    click(container)
    await Promise.resolve()
    expect(container.querySelector('span')?.textContent).toBe('0')
    instance.unmount()
  })
})

describe('関数値の意味と残る境界', () => {
  it.each([
    'function invoke(fn) { fn(); } function one() { count(1); } function two() { count(2); } invoke(one); invoke(two);',
    'function invoke(fn) { fn(); } function one() { count(1); } globalThis.__boundaries.push(invoke); invoke(one);',
    'function invoke(fn) { fn = () => count(2); fn(); } function one() { count(1); } invoke(one);',
    'function one() { count(1); } one = () => count(2); const alias = one; alias();',
    'let one = () => count(1); const alias = one; one = () => count(2); alias();',
    'const fn = globalThis.choose ? () => count(1) : () => count(2); fn();',
  ])('一つに解決できない関数値を拒否する: %s', (body) => {
    expect(() =>
      compile(`export function App() {
      const count = signal(0);
      render(<button onClick={run}>{count()}</button>);
      function run() { ${body} }
    }`),
    ).toThrow(/scope limit/)
  })

  it('引数評価で起きた例外を同じ値として再送出する', async () => {
    const { container, instance } = await mount(`
      const count = signal(0);
      render(<button onClick={run}>{count()}</button>);
      function run() {
        function invoke(fn, value) { return fn(value); }
        function fail() { throw 'original'; }
        try { invoke(write, fail()); } catch (error) { globalThis.__boundaries.push(error); }
      }
      function write(value) { count(value); }
    `)
    click(container)
    expect(log()).toEqual(['original'])
    expect(container.textContent).toBe('0')
    instance.unmount()
  })

  it('別名の宣言前参照は実行時の例外を保つ', async () => {
    const { container, instance } = await mount(`
      render(<button onClick={run}>ready</button>);
      function run() {
        function read() { return 'unexpected'; }
        try { alias(); } catch (error) { globalThis.__boundaries.push(error.name); }
        const alias = read;
      }
    `)
    click(container)
    expect(log()).toEqual(['ReferenceError'])
    instance.unmount()
  })

  it('後始末で呼ぶ別名の宣言を実行しなければ宣言前参照になる', async () => {
    const { instance } = await mount(`
      render(<p>ready</p>);
      onMount(() => {
        function helper() { globalThis.__boundaries.push('unexpected'); }
        return () => alias();
        const alias = helper;
      });
    `)
    expect(() => instance.unmount()).toThrow(ReferenceError)
    expect(log()).toEqual([])
  })

  it('初期化と後始末で共用する関数は通常実行時の書込みを保持する', async () => {
    const { container, instance } = await mount(`
      const count = signal(0);
      const show = signal(true);
      render(<div><span>{count()}</span><button onClick={() => show(false)}>remove</button>{show() && <Child write={write} />}</div>);
      function write() { count(count() + 1); }
    }
    function Child({write}) {
      render(<p>child</p>);
      onMount(() => {
        const helper = () => write();
        const alias = helper;
        alias();
        return alias;
      });
    `)
    expect(container.querySelector('span')?.textContent).toBe('1')
    click(container)
    expect(container.querySelector('span')?.textContent).toBe('1')
    instance.unmount()
  })

  it('useの保存した更新・後始末を省略形のキーで返す', async () => {
    const { container, instance } = await mount(`
      const count = signal(0);
      render(<button onClick={() => count(1)} use={setup}>{count()}</button>);
      function setup(element) {
        const update = () => { globalThis.__boundaries.push('update:' + count()); };
        const destroy = () => { globalThis.__boundaries.push('destroy'); };
        return { update, destroy };
      }
    `)
    expect(log()).toEqual(['update:0'])
    click(container)
    expect(log()).toEqual(['update:0', 'update:1'])
    instance.unmount()
    expect(log()).toEqual(['update:0', 'update:1', 'destroy'])
  })

  it('後始末へ渡した引数の同一性観測を診断する', () => {
    expect(() =>
      compile(`export function App() {
      render(<p>ready</p>);
      onMount(() => {
        function invoke(fn) { globalThis.__boundaries.push(fn.name); fn(); }
        function cleanup() {}
        return () => invoke(cleanup);
      });
    }`),
    ).toThrow(/observing function parameter identity.*scope limit/)
  })

  it('別名・引数経由の非同期補助関数は完了後に反映する', async () => {
    const { container, instance } = await mount(`
      const count = signal(0);
      render(<button onClick={run}>{count()}</button>);
      function run() {
        function invoke(fn) { fn(); }
        const alias = write;
        invoke(alias);
      }
      async function write() { await Promise.resolve(); count(1); }
    `)
    click(container)
    await Promise.resolve()
    await Promise.resolve()
    expect(container.textContent).toBe('1')
    instance.unmount()
  })

  it.each([
    '__container__',
    '__mount__',
    '__markers__',
    'update_count',
    'mount',
    'unmount',
    'hydrateComponentInstance',
  ])('内部名と衝突しても関数名・引数数・省略形キーを保持する: %s', async (name) => {
    const { container, instance } = await mount(`
        const count = signal(0);
        render(<button onClick={run}>{count()}</button>);
        function run() {
          globalThis.__boundaries.push(${name}.name, ${name}.length);
          { const ${name} = 'key'; const object = { ${name} };
            globalThis.__boundaries.push(Object.keys(object)[0], object.${name}); }
          globalThis.__boundaries.push(${name} === ${name});
          ${name}(2);
        }
        function ${name}(value) { count(value); }
      `)
    click(container)
    expect(log()).toEqual([name, 1, name, 'key', true])
    expect(container.textContent).toBe('2')
    instance.unmount()
  })
})

describe('実行境界の検査', () => {
  it('内部名が大域の関数や初期値を捕捉しない', async () => {
    vi.stubGlobal('__container__', () => 3)
    vi.stubGlobal('__seed__', 1)
    const { container, instance } = await mount(`
      const count = signal(__seed__);
      render(<button onClick={() => count(__container__())}>{count()}</button>);
    `)
    expect(container.textContent).toBe('1')
    click(container)
    expect(container.textContent).toBe('3')
    instance.unmount()
  })

  it.each([
    'function read() { return count(); } function nested(value = read()) { return value; } nested();',
    'function read() { return count(); } const alias = read; function nested(value = alias()) { return value; } nested();',
    'function write() { count(1); } function nested(value = write()) { return value; } nested();',
    'function read() { return count(); } class Value { field = read(); } new Value();',
    'function read() { return count(); } const value = { [read()]() {} };',
    'function* values() { yield count(); } values();',
  ])('関数本体外の状態実行と中断する関数を拒否する: %s', (body) => {
    expect(() =>
      compile(`export function App() {
      const count = signal(0);
      render(<button onClick={run}>{count()}</button>);
      function run() { ${body} }
    }`),
    ).toThrow(/(?:outside function bodies|generator).*scope limit/)
  })
})

describe('生成名と後始末の交差', () => {
  it('後始末用の矢印関数でも予約名の引数を保持する', async () => {
    const { instance } = await mount(`
      render(<p>ready</p>);
      onMount(() => {
        const helper = (__container__) => globalThis.__boundaries.push(__container__);
        return () => helper('kept');
      });
    `)
    instance.unmount()
    expect(log()).toEqual(['kept'])
  })

  it('状態名とイベント引数が内部名と同じでも更新する', async () => {
    const { container, instance } = await mount(`
      const __container__ = signal(0);
      render(<button onClick={run}>{__container__()}</button>);
      function run(__markers__) { __container__(Number(__markers__.currentTarget.textContent) + 1); }
    `)
    click(container)
    expect(container.textContent).toBe('1')
    instance.unmount()
  })
})

describe('保存した返却関数の拒否境界', () => {
  it.each(['return write;', 'return {update: write};'])(
    '動きゾーンの同期関数を単独の更新関数にしない: %s',
    (result) => {
      expect(() =>
        compile(`export function App() {
        const count = signal(0);
        render(<p use={setup}>{count()}</p>);
        function setup(element) { ${result} }
        function write() { count(1); }
      }`),
      ).toThrow(/action can only return.*scope limit/)
    },
  )
})

describe('後始末の参照同一性', () => {
  it('後始末中に作る別名も元の関数名と同一性を保持する', async () => {
    const { instance } = await mount(`
      render(<p>ready</p>);
      onMount(() => {
        function helper() { globalThis.__boundaries.push('called'); }
        return () => { const alias = helper; globalThis.__boundaries.push(alias.name, alias === helper); alias(); };
      });
    `)
    instance.unmount()
    expect(log()).toEqual(['helper', true, 'called'])
  })

  it('後始末内のconst別名で登録した監視を解除する', async () => {
    const target = createContainer()
    vi.stubGlobal('__boundaryTarget', target)
    const { instance } = await mount(`
      render(<p>ready</p>);
      onMount(() => {
        function listener() { globalThis.__boundaries.push('event'); }
        globalThis.__boundaryTarget.addEventListener('ping', listener);
        return () => { const alias = listener; globalThis.__boundaryTarget.removeEventListener('ping', alias); };
      });
    `)
    const ping = () => target.dispatchEvent(new target.ownerDocument.defaultView!.Event('ping'))
    ping()
    instance.unmount()
    ping()
    expect(log()).toEqual(['event'])
  })

  it('監視解除を関数引数へ隠す後始末は診断する', () => {
    expect(() =>
      compile(`export function App() {
      render(<p>ready</p>);
      onMount(() => {
        function listener() {}
        function remove(fn) { globalThis.__boundaryTarget.removeEventListener('ping', fn); }
        return () => remove(listener);
      });
    }`),
    ).toThrow(/observing function parameter identity.*scope limit/)
  })
})

describe('宣言初期値にある予約名', () => {
  it('コンテキストの既定値の内部関数名を保持する', async () => {
    const result = compile(`
      const Name = createContext((() => { function __container__(value) {return value;} return __container__.name; })());
      export function App() { render(<p>{useContext(Name)}</p>); }
    `)
    expect(result.initialHtml).toContain('>__container__</p>')
    const module = await loadGenerated(result.code)
    const container = createContainer()
    ;(module.mountComponent as (element: Element) => void)(container)
    expect(container.textContent).toBe('__container__')
  })
})

describe('残す宣言の境界', () => {
  it('別名importをAPI名へ戻す際のトップレベル衝突は診断する', () => {
    expect(() =>
      compile(`import {signal as state, render} from 'irisout';
      function signal() { return 'helper'; }
      export function App() { const count = state(0); render(<p>{count()}</p>); }
    `),
    ).toThrow(/authoring import.*conflicts.*scope limit/)
  })

  it('保存した結果オブジェクト全体の返却は診断する', () => {
    expect(() =>
      compile(`export function App() {
      render(<p use={setup}>ready</p>);
      function setup(element) { const result = {destroy() {}}; return result; }
    }`),
    ).toThrow(/action can only return.*scope limit/)
  })
})

describe('部品展開と予約名', () => {
  it('親と子の同名状態を別々に保持する', async () => {
    const { container, instance } = await mount(`
      const __container__ = signal(0);
      render(<main><span>{__container__()}</span><Child /></main>);
    }
    function Child() {
      const __container__ = signal(3);
      render(<button onClick={() => __container__(__container__() + 1)}>{__container__()}</button>);
    `)
    expect(container.querySelector('span')?.textContent).toBe('0')
    expect(container.querySelector('button')?.textContent).toBe('3')
    click(container)
    expect(container.querySelector('span')?.textContent).toBe('0')
    expect(container.querySelector('button')?.textContent).toBe('4')
    instance.unmount()
  })
})
