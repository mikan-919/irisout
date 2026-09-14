import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vite-plus/test'
import { compileSSR } from '../src/compiler.ts'
import { serializeSsrState } from '../../vite-plugin/src/ssr.ts'
import { loadGenerated } from './helpers.ts'

describe('Irisout SSR入口', () => {
  it('要求ごとの入力からHTMLとhydrate stateを分けて生成する', async () => {
    const result = compileSSR(`
      export function Page({ title, count }) {
        const value = signal(count);
        render(<main><h1>{title}</h1><p>{value()}</p></main>);
      }
    `)
    if (!result.ssrCode) throw new Error('SSR code was not generated')
    const server = await loadGenerated(result.ssrCode)
    const first = (server.render as (input: unknown) => { html: string; state: unknown })({
      title: 'A & <',
      count: 2,
    })
    const second = (server.render as (input: unknown) => { html: string; state: unknown })({
      title: 'B',
      count: 7,
    })

    expect(first.html).toContain('A &amp; &lt;')
    expect(first.html).toContain('>2</p>')
    expect(second.html).toContain('>7</p>')
    expect(first.state).not.toBe(second.state)
    expect(JSON.stringify(first.state)).toContain('A & <')
  })

  it('必須入力を要求時に評価し、空入力でcompile時実行しない', async () => {
    const result = compileSSR(`
      export function Page({ title }) {
        render(<h1>{title.toUpperCase()}</h1>);
      }
    `)
    if (!result.ssrCode) throw new Error('SSR code was not generated')
    const server = await loadGenerated(result.ssrCode)
    const rendered = (server.render as (input: unknown) => { html: string })({ title: 'ready' })
    expect(rendered.html).toContain('>READY</h1>')
  })

  it('ルート入力bindingの生成内部名との衝突を拒否する', () => {
    for (const name of ['__input__', '__rawInput__', '__state__', '__signal_state__']) {
      expect(() => compileSSR(`export function Page(${name}) { render(<p>ready</p>); }`)).toThrow(
        new RegExp(`SSR root input binding "${name}" conflicts`),
      )
    }
  })

  it('構造unit内のsignal()を初期SSRで拒否する', () => {
    expect(() =>
      compileSSR(`
        function Child() {
          const stamp = signal(Date.now());
          render(<p>{stamp()}</p>);
        }
        export function Page({ show }) {
          render(<main>{show && <Child />}</main>);
        }
      `),
    ).toThrow(/signal\(\) and derived\(\) inside structural units.*scope limit/)
  })

  it('条件分岐をSSRし、生成済みHTMLをstate付きでhydrateする', async () => {
    const result = compileSSR(`
      export function Page({ show }) {
        render(<main>{show ? <h1>yes</h1> : <p>no</p>}</main>);
      }
    `)
    if (!result.ssrCode) throw new Error('SSR code was not generated')
    const server = await loadGenerated(result.ssrCode)
    const client = await loadGenerated(result.code)
    const rendered = (server.render as (input: unknown) => { html: string; state: unknown })({
      show: true,
    })
    const dom = new JSDOM(`<!doctype html><div id="app">${rendered.html}</div>`)
    const container = dom.window.document.querySelector('#app')
    if (!container) throw new Error('SSR container was not created')

    ;(client.hydrateComponent as (container: Element, state: unknown) => unknown)(
      container,
      rendered.state,
    )

    expect(container.innerHTML).toContain('<h1>yes</h1>')
  })

  it('hydrateとmountはrender()のstateだけを受け取り、予約キーをstate.inputから復元する', async () => {
    const result = compileSSR(`
      export function Page(input) {
        render(<p>{input.__irisout_state__ ? input.title.toUpperCase() : 'missing'}</p>);
      }
    `)
    if (!result.ssrCode) throw new Error('SSR code was not generated')
    const server = await loadGenerated(result.ssrCode)
    const client = await loadGenerated(result.code)
    const rendered = (server.render as (input: unknown) => { html: string; state: unknown })({
      __irisout_state__: true,
      title: 'ready',
    })
    const rawInput = { __irisout_state__: true, title: 'ready' }
    const rawStateLikeInput = { __irisout_state__: true, input: rawInput }
    const rejected = new JSDOM('<!doctype html><div id="app"></div>')
    const rejectedContainer = rejected.window.document.querySelector('#app')
    if (!rejectedContainer) throw new Error('SSR container was not created')
    expect(() =>
      (client.hydrateComponent as (container: Element, state: unknown) => unknown)(
        rejectedContainer,
        rawInput,
      ),
    ).toThrow(/SSR hydration requires state returned by render\(input\)/)
    expect(() =>
      (client.mountComponent as (container: Element, state: unknown) => unknown)(
        rejectedContainer,
        rawStateLikeInput,
      ),
    ).toThrow(/SSR hydration requires state returned by render\(input\)/)

    const dom = new JSDOM(`<!doctype html><div id="app">${rendered.html}</div>`)
    const container = dom.window.document.querySelector('#app')
    if (!container) throw new Error('SSR container was not created')
    ;(client.hydrateComponent as (container: Element, state: unknown) => unknown)(
      container,
      rendered.state,
    )
    expect(container.innerHTML).toContain('>READY</p>')
  })

  it('SSRではイベント、onMount、effect、use actionを実行しない', async () => {
    const result = compileSSR(`
      export function Page() {
        render(<button onClick={() => {}} use={(el) => {}}>ok</button>);
        onMount(() => {});
        effect(() => {});
      }
    `)
    if (!result.ssrCode) throw new Error('SSR code was not generated')
    const server = await loadGenerated(result.ssrCode)
    expect((server.render as (input?: unknown) => { html: string })().html).toContain(
      '>ok</button>',
    )
  })

  it('局所signalの初期値をstateからhydrateへ引き継ぐ', async () => {
    const result = compileSSR(`
      export function Page() {
        const stamp = signal(Date.now());
        render(<p>{stamp()}</p>);
      }
    `)
    if (!result.ssrCode) throw new Error('SSR code was not generated')
    const server = await loadGenerated(result.ssrCode)
    const client = await loadGenerated(result.code)
    const originalNow = Date.now
    try {
      Date.now = () => 111
      const rendered = (server.render as (input?: unknown) => { html: string; state: unknown })()
      expect(JSON.stringify(rendered.state)).toContain('111')

      Date.now = () => 222
      const dom = new JSDOM(`<!doctype html><div id="app">${rendered.html}</div>`)
      const container = dom.window.document.querySelector('#app')
      if (!container) throw new Error('SSR container was not created')
      ;(client.hydrateComponent as (container: Element, state: unknown) => unknown)(
        container,
        rendered.state,
      )
      expect(container.innerHTML).toContain('>111</p>')
      expect(container.innerHTML).not.toContain('>222</p>')
    } finally {
      Date.now = originalNow
    }
  })

  it('A/Bの並行要求と失敗後の正常要求でstateを共有しない', async () => {
    const result = compileSSR(`
      export function Page({ title }) {
        const value = signal(title);
        render(<p>{value()}</p>);
      }
    `)
    if (!result.ssrCode) throw new Error('SSR code was not generated')
    const server = await loadGenerated(result.ssrCode)
    const renderRequest = async (input: unknown) =>
      (server.render as (value: unknown) => { html: string; state: unknown })(input)
    const [first, second] = await Promise.all([
      renderRequest({ title: 'A' }),
      renderRequest({ title: 'B' }),
    ])

    expect(first.html).toContain('>A</p>')
    expect(second.html).toContain('>B</p>')
    expect(first.state).not.toBe(second.state)

    await expect(renderRequest({ title: Number.NaN })).rejects.toThrow(/finite JSON numbers/)
    const recovered = await renderRequest({ title: 'recovered' })
    expect(recovered.html).toContain('>recovered</p>')
    expect(JSON.stringify(recovered.state)).not.toContain('A')
    expect(JSON.stringify(recovered.state)).not.toContain('B')
  })

  it('入力をJSON値へ限定し、安全なscript用state直列化を提供する', async () => {
    const result = compileSSR('export function Page() { render(<p>ready</p>); }')
    if (!result.ssrCode) throw new Error('SSR code was not generated')
    const server = await loadGenerated(result.ssrCode)
    const nullPrototype = Object.create(null) as Record<string, unknown>
    nullPrototype.ok = true
    for (const input of [null, true, 'text', 1, [null, false], nullPrototype]) {
      expect(() => (server.render as (value: unknown) => unknown)(input)).not.toThrow()
    }

    for (const input of [
      new Date(),
      new Map(),
      new Set(),
      { toJSON: () => 'unsafe' },
      { toJSON: 'unsafe' },
      Number.NaN,
      Number.POSITIVE_INFINITY,
      undefined,
    ]) {
      expect(() => (server.render as (value: unknown) => unknown)(input)).toThrow(/SSR input/)
    }

    const serialized = serializeSsrState({ value: '</script><script>alert(1)</script>' })
    expect(serialized).not.toContain('</script>')
    expect(serialized).toContain('\\u003C/script\\u003E')
    expect(JSON.parse(serialized)).toEqual({ value: '</script><script>alert(1)</script>' })
    for (const value of [new Date(), new Map(), new Set(), { toJSON: 'unsafe' }, Number.NaN]) {
      expect(() => serializeSsrState(value)).toThrow(/SSR state/)
    }
  })
})
