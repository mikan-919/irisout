import { describe, expect, it } from 'vite-plus/test'
import { toMarkerId } from '../src/compiler/state.js'
import { compile } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

// マイルストーン1の唯一のサンプル:単一コンポーネント、単一 signal、そして
// 複数の自由変数依存(count + doubled)を持つ JSX 式。doubled 自体は count
// から derive されている。パイプライン全体を end to end で通す
// (docs/adr/0001-first-milestone.md)。
const COUNTER_SOURCE = `
export function Counter() {
  const count = signal(0);
  const doubled = derived(() => count() * 2);
  render(<div>{count() + doubled()}</div>);
}
`

describe('milestone 1: expression dependency analysis -> update_* codegen', () => {
  it('bakes the real initial HTML from build-time execution', () => {
    const { initialHtml } = compile(COUNTER_SOURCE)
    expect(initialHtml).toBe('<div data-iris-id="m0">0</div>')
  })

  it('resolves the derived dependency transitively onto the root signal', () => {
    const { signalToMarkers, declName } = compile(COUNTER_SOURCE)
    const names = [...signalToMarkers.keys()].map((id) => declName.get(id))
    expect(names).toEqual(['count'])
    expect([...signalToMarkers.values()][0]).toEqual(new Set([toMarkerId('m0')]))
  })

  // ADR-0006: 出力はプレーン変数で、signal()/derived() ランタイム呼び出しは
  // 生成コードのどこにも現れない(M6 で全マイルストーンを横断して再確認する)。
  it('emits plain variables, not signal()/derived() runtime calls', () => {
    const { code } = compile(COUNTER_SOURCE)
    expect(code).toContain('let count = 0;')
    expect(code).not.toContain('signal(')
    expect(code).not.toContain('derived(')
  })

  it('mounts the baked HTML and exposes a callable, idempotent update_count()', async () => {
    const { code } = compile(COUNTER_SOURCE)
    const mod = await loadGenerated(code)

    expect(mod.update_count).toBeUndefined()
    expect(mod.update_doubled).toBeUndefined()

    const container = createContainer()
    const instance = (mod.mountComponent as (c: Element) => { update_count(): void })(container)
    expect(typeof instance.update_count).toBe('function')
    expect(container.querySelector('[data-iris-id="m0"]')?.textContent).toBe('0')

    // M1 has no handler wiring yet (that lands in M2), so there is no
    // production way to mutate `count` from outside the module -- the
    // meaningful "write, then observe the DOM update" test belongs to
    // M2's handler tests, driven by a real dispatched DOM event. Here we
    // only confirm update_count() runs without throwing and stays
    // consistent with the current (unchanged) state.
    instance.update_count()
    expect(container.querySelector('[data-iris-id="m0"]')?.textContent).toBe('0')
  })

  it('throws if the component declares UI with return instead of render() (ADR-0008)', () => {
    expect(() => compile('export function Bad() { return null; }')).toThrow(
      /render\(<JSX>\), not return/,
    )
  })
})
