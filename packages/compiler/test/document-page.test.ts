// JSXで文書を所有し、状態とJavaScriptだけを注入する経路を実行して検証する。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { Hono } from 'hono'
import { describe, expect, it } from 'vite-plus/test'
import { compile, compileProject } from '../src/compiler.ts'
import { createFileRouter } from '../../hono/src/index.ts'
import { irisoutHono } from '../../vite-plugin/src/hono.ts'
import { loadGenerated } from './helpers.ts'
import { replaceDocument } from '../../runtime/src/index.ts'

const layout = `import { onMount } from 'irisout';
export function Layout({ title, lang, children }) {
  onMount(() => () => {});
  return <html lang={lang}><head><title>{title}</title><meta name="description" content={title}/></head><body>{children}</body></html>;
}`
function writePage(root: string, relative: string, name: string): string {
  const file = path.join(root, relative, 'page.jsx')
  mkdirSync(path.dirname(file), { recursive: true })
  const layoutImport = relative ? '../Layout.jsx' : './Layout.jsx'
  writeFileSync(
    file,
    `import { signal } from 'irisout';
    import { Layout } from '${layoutImport}';
    export function Page(input) {
      const count = signal(input.count);
      return <Layout title={input.title} lang={input.lang}>
        <main><h1>${name}</h1><button onClick={() => count(count() + 1)}>{count()}</button><a href="/apps/next">Next</a></main>
      </Layout>;
    }`,
  )
  return file
}

function stateOf(document: Document): unknown {
  return JSON.parse(document.querySelector('script[data-irisout-route-state]')!.textContent!)
}

describe('JSX文書ページ', () => {
  it('return JSXの文書をmountし、html属性の更新と破棄を行う', async () => {
    const compiled = compile(`export function Page() {
      const lang = signal('ja');
      function change() { lang('en'); }
      onMount(() => () => {});
      return <html lang={lang()}><head><title>Counter</title></head><body><button onClick={change}>Change</button></body></html>;
    }`)
    const dom = new JSDOM(
      '<!doctype html><html><head><title>old</title></head><body>old</body></html>',
    )
    const client = await loadGenerated(compiled.code)
    const handle = (client.mountComponent as (container: Element) => { unmount(): void })(
      dom.window.document.documentElement,
    )
    expect(compiled.isDocument).toBe(true)
    expect(dom.window.document.title).toBe('Counter')
    expect(dom.window.document.documentElement.lang).toBe('ja')
    const button = dom.window.document.querySelector('button')!
    button.click()
    expect(dom.window.document.documentElement.lang).toBe('en')
    handle.unmount()
    button.click()
    expect(dom.window.document.documentElement.children.length).toBe(0)
  })

  it('相対importのLayoutを展開し、document指定なしで状態とJSを注入してhydrateする', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-document-'))
    try {
      writeFileSync(path.join(root, 'Layout.jsx'), layout)
      const page = writePage(root, '', 'Home')
      const title = '</script><script>throw new Error("injected")</script>'
      const app = new Hono().route(
        '/apps',
        createFileRouter(root, {
          loaders: { '/': () => ({ title, count: 7, lang: 'ja' }) },
        }),
      )
      const response = await app.request('/apps')
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html.startsWith('<!doctype html><html')).toBe(true)
      const dom = new JSDOM(html)
      expect(dom.window.document.title).toBe(title)
      expect(
        dom.window.document.querySelector('meta[name="description"]')?.getAttribute('content'),
      ).toBe(title)
      const scripts = dom.window.document.querySelectorAll('script')
      expect(scripts.length).toBe(2)
      expect(scripts[0]!.type).toBe('application/json')
      expect(scripts[1]!.getAttribute('src')).toBe('/irisout-client.js')
      expect(scripts[1]!.parentElement).toBe(dom.window.document.body)
      const compiled = compileProject(page, { target: 'ssr' })
      expect(compiled.dependencies).toContain(path.join(root, 'Layout.jsx'))
      const client = await loadGenerated(compiled.code)
      const button = dom.window.document.querySelector('button')!
      const handle = (
        client.hydrateComponent as (container: Element, state: unknown) => { unmount(): void }
      )(dom.window.document.documentElement, stateOf(dom.window.document as unknown as Document))
      expect(dom.window.document.querySelector('button')).toBe(button)
      button.click()
      expect(button.textContent).toBe('8')
      const navigation = await app.request('/apps', { headers: { 'X-Irisout-Navigation': '1' } })
      const payload = await navigation.json()
      expect(payload.html).toContain('<html')
      expect(payload.html).not.toContain('data-irisout-route-state')
      expect(payload.html).not.toContain('/irisout-client.js')
      handle.unmount()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('生成した経路入口で初回hydrate、文書間遷移、戻る操作を実行する', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'irisout-document-navigation-'))
    const previousWindow = globalThis.window
    const previousDocument = globalThis.document
    try {
      writeFileSync(path.join(root, 'Layout.jsx'), layout)
      const home = writePage(root, '', 'Home')
      const next = writePage(root, 'next', 'Next')
      const app = new Hono().route(
        '/apps',
        createFileRouter(root, {
          loaders: {
            '/': () => ({ title: 'Home title', count: 1, lang: 'ja' }),
            '/next': () => ({ title: 'Next title', count: 10, lang: 'en' }),
          },
        }),
      )
      const dom = new JSDOM(await (await app.request('/apps')).text(), {
        url: 'http://example.test/apps',
      })
      globalThis.window = dom.window as unknown as Window & typeof globalThis
      globalThis.document = dom.window.document as unknown as Document
      dom.window.fetch = (async (input, init) =>
        app.request(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
          init,
        )) as typeof fetch
      const plugin = irisoutHono(app)
      ;(plugin.configResolved as unknown as (config: unknown) => void)({ root, command: 'serve' })
      ;(plugin.buildStart as unknown as (this: unknown) => void).call({ addWatchFile() {} })
      const resolve = plugin.resolveId as unknown as (id: string) => string
      const load = plugin.load as unknown as (id: string) => { code: string }
      let code = load(resolve('virtual:irisout-routes')).code
      code = code.replaceAll(
        "'irisout/routes'",
        JSON.stringify(path.resolve(import.meta.dirname, '../../routes/src/index.ts')),
      )
      for (const [id, source] of [
        ['/', home],
        ['/next', next],
      ]) {
        const file = path.join(root, id === '/' ? 'home.mjs' : 'next.mjs')
        const generated = compileProject(source!, { target: 'ssr' })
        writeFileSync(
          file,
          generated.code.replace(
            "'irisout/runtime'",
            JSON.stringify(path.resolve(import.meta.dirname, '../../runtime/src/index.ts')),
          ),
        )
        code = code.replaceAll(
          JSON.stringify('virtual:irisout-routes:page:' + encodeURIComponent(id!)),
          JSON.stringify(file),
        )
      }
      const driver = await loadGenerated(code + '\nexport { __irisout_started__ as ready };')
      await driver.ready
      const navigator = driver.routeNavigator as {
        navigate(url: string, options?: { replace?: boolean }): Promise<boolean>
        stop(): void
      }
      const oldButton = dom.window.document.querySelector('button')!
      oldButton.click()
      expect(oldButton.textContent).toBe('2')
      expect(await navigator.navigate('/apps/next')).toBe(true)
      expect(dom.window.document.title).toBe('Next title')
      expect(dom.window.document.documentElement.lang).toBe('en')
      oldButton.click()
      expect(oldButton.textContent).toBe('2')
      dom.window.document.querySelector('button')!.click()
      expect(dom.window.document.querySelector('button')!.textContent).toBe('11')
      expect(await navigator.navigate('/apps', { replace: true })).toBe(true)
      expect(dom.window.document.title).toBe('Home title')
      expect(dom.window.document.documentElement.lang).toBe('ja')
      expect(dom.window.document.querySelector('button')!.textContent).toBe('1')
      navigator.stop()
    } finally {
      globalThis.window = previousWindow
      globalThis.document = previousDocument
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('曖昧なUI、到達しないlifecycle、文書構造の不足を拒否する', () => {
    expect(() => compile('export function Page(){render(<div/>);return <div/>}')).toThrow(
      /exactly one render/,
    )
    expect(() => compile('export function Page(){return <div/>;onMount(() => {})}')).toThrow(
      /after return JSX.*scope limit/,
    )
    expect(() => compile('export function Page(){return <html><body/></html>}')).toThrow(
      /head followed by body.*scope limit/,
    )
    expect(() => compile('export function Page(){return <html><body/><head/></html>}')).toThrow(
      /head followed by body.*scope limit/,
    )
  })

  it('文書置換で実行可能scriptを拒否し、旧文書を保持する', () => {
    const dom = new JSDOM('<!doctype html><html><head><title>Old</title></head><body/></html>')
    const root = dom.window.document.documentElement
    expect(() =>
      replaceDocument(
        root,
        '<html><head><script src="/custom.js"></script></head><body>New</body></html>',
      ),
    ).toThrow(/executable scripts require document navigation/)
    expect(dom.window.document.title).toBe('Old')
    replaceDocument(
      root,
      '<html lang="en"><head><title>New</title></head><body><script type="application/json">{}</script></body></html>',
    )
    expect(dom.window.document.title).toBe('New')
    expect(root.lang).toBe('en')
  })
})
