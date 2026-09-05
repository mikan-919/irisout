import { describe, expect, it } from 'vite-plus/test'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

// jsdom はグローバルの Event を受け付けないので、コンテナ自身の window の
// Event で発火する(list-conditional.test.ts と同じイディオム)。
function dispatch(container: Element, el: Element | null, type: string): void {
  if (!el) throw new Error(`dispatch: element not found for "${type}"`)
  const Event = (
    container.ownerDocument as unknown as {
      defaultView: { Event: typeof globalThis.Event }
    }
  ).defaultView.Event
  el.dispatchEvent(new Event(type))
}

// M6: 全マイルストーン横断の no-wrapper 検証(ADR-0006)。
// 個別機能の動作は per-milestone テストが既にカバーしているので、ここでは
// 全機能が同居する1つのフィクスチャで (a) 生成コードに signal()/derived()
// ラッパーが残らない、(b) runtime import は1本で使用機能だけを含む、(c) 実 DOM で
// イベント駆動更新が横断的に動く、の3点だけを固定する
// (change m6-no-wrapper-verification design D1-D3)。
//
// フィクスチャに含む機能: signal / derived / テキストマーカー / 静的属性 /
// inline arrow・識別子参照ハンドラ / イベント引数 e / リスト+ネスト条件分岐 /
// 条件分岐(三項) / use= アクション+返り値クロージャ。
const ALL_FEATURES_SOURCE = `
export function App() {
  const items = signal([
    { id: 1, label: 'alpha', done: false },
    { id: 2, label: 'beta', done: true },
  ]);
  const query = signal('');
  const visible = derived(() => items().filter((i) => i.label.includes(query())));
  const total = derived(() => items().length);

  render(
    <div class="app">
      <p>total: {total()}</p>
      <input type="text" onInput={setQuery} />
      <ul>
        {visible().map((item) => (
          <li key={item.id}>
            <span>{item.label}</span>
            <em>{item.done && <b>ok</b>}</em>
          </li>
        ))}
      </ul>
      <section>{visible().length ? <p>some</p> : <p>none</p>}</section>
      <button type="button" onClick={() => items([...items(), { id: 3, label: 'gamma', done: false }])}>
        add
      </button>
      <output use={report}></output>
    </div>,
  );

  function setQuery(e) {
    query(e.target.value);
  }
  function report(el) {
    el.dataset.ready = 'yes';
    return () => {
      el.dataset.total = String(total());
    };
  }
}
`

describe('M6: cross-milestone no-wrapper verification (ADR-0006)', () => {
  it('compiles the all-features fixture without wrapper calls in the output', () => {
    const { code } = compile(ALL_FEATURES_SOURCE)
    expect(code).not.toContain('signal(')
    expect(code).not.toContain('derived(')
    expect(code).not.toContain('registry')
  })

  it('imports one runtime entry containing only the helpers required by used features', () => {
    const { code } = compile(ALL_FEATURES_SOURCE)
    const imports = code.match(/^import .*$/gm) ?? []
    expect(imports).toEqual([
      "import { mount as __mount__, hydrate as __hydrate__, normalizeUseActionResult as __normalizeUseActionResult__, createListRuntime as __createListRuntime__, reconcileList as __reconcileList__, updateListBinding as __updateListBinding__ } from '@irisout/runtime';",
    ])

    const withoutList = compile(`
      export function App() {
        const count = signal(0);
        render(<p>{count()}</p>);
      }
    `).code
    expect(withoutList.match(/^import .*$/gm)).toEqual([
      "import { mount as __mount__, hydrate as __hydrate__ } from '@irisout/runtime';",
    ])
  })

  it('drives every feature end to end in a real DOM', async () => {
    const { code } = compile(ALL_FEATURES_SOURCE)
    const mod = await loadGenerated(code)
    const container = createContainer()
    ;(mod.mountComponent as (c: Element) => void)(container)

    const textOf = (sel: string) => container.querySelector(sel)?.textContent
    const output = container.querySelector('output') as HTMLElement

    // 初期状態: テキスト・リスト・ネスト条件分岐・三項・action クロージャ
    expect(textOf('p')).toBe('total: 2')
    expect(container.querySelectorAll('li').length).toBe(2)
    expect(container.querySelectorAll('li b').length).toBe(1) // beta のみ done
    expect(textOf('section p')).toBe('some')
    expect(output.dataset.ready).toBe('yes')
    expect(output.dataset.total).toBe('2')

    // inline arrow ハンドラ: 追加 → derived 再計算・keyed diff・クロージャ再実行
    dispatch(container, container.querySelector('button'), 'click')
    expect(textOf('p')).toBe('total: 3')
    expect(container.querySelectorAll('li').length).toBe(3)
    expect(output.dataset.total).toBe('3')

    // 識別子参照ハンドラ+イベント引数: フィルタ全除外 → リスト空・三項切替
    const input = container.querySelector('input') as HTMLInputElement
    input.value = 'zzz'
    dispatch(container, input, 'input')
    expect(container.querySelectorAll('li').length).toBe(0)
    expect(textOf('section p')).toBe('none')

    // フィルタ解除 → リスト復帰・三項再切替
    input.value = ''
    dispatch(container, input, 'input')
    expect(container.querySelectorAll('li').length).toBe(3)
    expect(textOf('section p')).toBe('some')
  })
})
