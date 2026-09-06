import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import { compileProject } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

const ENTRY = fileURLToPath(new URL('../../../apps/examples/heatmap.jsx', import.meta.url))

function click(container: Element, selector: string): void {
  const element = container.querySelector(selector) as HTMLElement | null
  if (!element) throw new Error(`element not found: ${selector}`)
  element.click()
}

describe('apps/examples/heatmap.jsx', () => {
  it('connects input, metric selection, paragraph selection, and overview links', async () => {
    const { code } = compileProject(ENTRY)
    const executableCode = `const IrisM0_analysisDictionaryUrl = 'data:application/json,%7B%22terms%22%3A%5B%5D%7D';
const IrisM0_suzumeWasmUrl = '';
const IrisM0_Suzume = { create: () => Promise.reject(new Error('test resource')) };
class IrisM0_HeatmapWorker { postMessage() {} terminate() {} }
${code
  .split('\n')
  .filter((line) => !line.startsWith('import ') || line.includes("'@irisout/runtime'"))
  .join('\n')}`
    const mod = await loadGenerated(executableCode)
    const container = createContainer()
    ;(mod.mountComponent as (container: Element) => unknown)(container)

    expect(container.querySelectorAll('.paragraph-list article')).toHaveLength(3)
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toContain('概要')
    expect(container.querySelector('.metric-controls .active')?.textContent).toContain('長さ')

    click(container, '.metric-controls button:nth-of-type(2)')
    expect(container.querySelector('.metric-controls .active')?.textContent).toContain('割合')

    const overviewLinks = container.querySelectorAll('.overview a')
    expect(overviewLinks[1]?.getAttribute('href')).toBe('#paragraph-2')
    ;(overviewLinks[1] as HTMLElement).click()
    expect(overviewLinks[1]?.className).toContain('selected')
    expect(container.querySelector('#paragraph-2')?.className).toContain('selected')
    expect(container.querySelector('.detail')?.textContent).toContain('数値 42')

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    textarea.value = '新しい本文です。\n\n99'
    textarea.dispatchEvent(
      new textarea.ownerDocument.defaultView!.Event('input', { bubbles: true }),
    )
    expect(container.querySelectorAll('.paragraph-list article')).toHaveLength(2)
    expect(container.querySelector('#paragraph-2')?.textContent).toContain('99')
  })

  it('builds library, dictionary URL, CSS, and worker assets under a base path', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'irisout-heatmap-build-'))
    const result = spawnSync(
      path.resolve('node_modules/.bin/vp'),
      ['-C', 'apps/examples', 'build'],
      {
        env: {
          ...process.env,
          IRISOUT_ENTRY: 'heatmap.jsx',
          IRISOUT_MINIFY: 'false',
          IRISOUT_BASE: '/heatmap/',
          IRISOUT_OUT_DIR: outDir,
        },
        encoding: 'utf8',
      },
    )
    expect(result.status, result.stderr).toBe(0)

    const html = readFileSync(path.join(outDir, 'index.html'), 'utf8')
    const app = readFileSync(path.join(outDir, 'app.js'), 'utf8')
    const assets = readdirSync(path.join(outDir, 'assets'))
    expect(html).toContain('/heatmap/app.js')
    expect(html).toMatch(/\/heatmap\/assets\/.*\.css/)
    expect(app).toMatch(/\/heatmap\/assets\/suzume-.*\.wasm/)
    expect(app).toMatch(/\/heatmap\/assets\/heatmap\.worker-.*\.js/)
    expect(assets.some((name) => name.endsWith('.wasm'))).toBe(true)
    expect(assets.some((name) => name.startsWith('heatmap.worker-'))).toBe(true)
  })
})
