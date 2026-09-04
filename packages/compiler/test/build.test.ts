import { describe, expect, it } from 'vite-plus/test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { compile } from '../src/compiler.js'
import { loadGenerated } from './helpers.js'

// plans/001-browser-build-target.md: ブラウザに届くのは静的 HTML と
// hydrate 用の app.js だけであるべき、という CONCEPT.v2.md の主張を検証する。
const COUNTER_SOURCE = `
export function Counter() {
  const count = signal(0);
  const doubled = derived(() => count() * 2);
  render(
    <div>
      <span>{count() + doubled()}</span>
      <button onClick={() => count(count() + 1)}>+</button>
    </div>
  );
}
`

describe('hydrate over statically baked HTML (no mount(), no innerHTML write)', () => {
  it('hydrateComponent discovers markers on pre-existing HTML and handlers still update it', async () => {
    const { code, initialHtml } = compile(COUNTER_SOURCE)

    // mountComponent/mount() を一切呼ばず、DOM に直接 initialHtml を焼き込む -
    // これがビルド出力 (dist/index.html) が行うことそのもの。
    const dom = new JSDOM(`<!doctype html><div id="app">${initialHtml}</div>`)
    const container = dom.window.document.getElementById('app')
    if (!container) throw new Error('container not found')
    expect(container.textContent).toContain('0')

    const mod = await loadGenerated(code)
    ;(mod.hydrateComponent as (c: Element) => void)(container)

    const button = container.querySelector('button')
    if (!button) throw new Error('button not found')
    const Event = dom.window.Event
    button.dispatchEvent(new Event('click'))

    // count: 0 -> 1, doubled: 0 -> 2, span shows count()+doubled() = 3
    expect(container.querySelector('span')?.textContent).toBe('3')
  })

  // hydration-marker-verification: DOM と生成コードの不一致は黙って no-op に
  // せず、mount/hydrate の時点で欠落 ID を列挙して throw する。
  it('hydrateComponent throws with missing marker ids when initial HTML was tampered', async () => {
    const { code, initialHtml } = compile(COUNTER_SOURCE)

    const dom = new JSDOM(`<!doctype html><div id="app">${initialHtml}</div>`)
    const container = dom.window.document.getElementById('app')
    if (!container) throw new Error('container not found')

    // マーカー要素を1つ削除して「改変済み初期 HTML」を再現する。
    const tampered = container.querySelector('[data-iris-id]')
    if (!tampered) throw new Error('marker element not found')
    const missingId = tampered.getAttribute('data-iris-id')
    tampered.remove()

    const mod = await loadGenerated(code)
    expect(() => (mod.hydrateComponent as (c: Element) => void)(container)).toThrow(
      new RegExp(`missing marker\\(s\\).*${missingId}`),
    )
  })
})

describe('Vite+ example build end to end', () => {
  it('produces dist/index.html with baked HTML and a hydrate-only dist/app.js', () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'irisout-build-test-'))
    const fixturePath = path.join(tmpDir, 'counter.jsx')
    writeFileSync(fixturePath, COUNTER_SOURCE)

    const outDir = path.join(tmpDir, 'dist')
    const result = spawnSync(
      path.resolve('node_modules/.bin/vp'),
      ['-C', 'apps/examples', 'build'],
      {
        env: {
          ...process.env,
          IRISOUT_ENTRY: fixturePath,
          IRISOUT_OUT_DIR: outDir,
        },
      },
    )
    expect(result.status).toBe(0)

    const html = readFileSync(path.join(outDir, 'index.html'), 'utf8')
    expect(html).toContain('<div id="app">')
    expect(html).toContain('>0</span>')

    const appJs = readFileSync(path.join(outDir, 'app.js'), 'utf8')
    expect(appJs).toContain('hydrate: missing marker(s)')
    expect(appJs).toContain('addEventListener')
    // ADR-0006 の回帰チェック: signal()/derived() ラッパーは生成コードにも
    // ビルド成果物にも現れない。
    expect(appJs).not.toContain('signal(')
    expect(appJs).not.toContain('derived(')
  })
})
