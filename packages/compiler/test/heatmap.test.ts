import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import { compileProject } from '../src/compiler.js'
import { createContainer, loadGenerated } from './helpers.js'

const ENTRY = fileURLToPath(new URL('../../../apps/examples/heatmap.jsx', import.meta.url))

const HEATMAP_TEST_STUBS = `
const IrisM0_analysisDictionaryUrl = 'data:application/json,%7B%22terms%22%3A%5B%22情報量%22%5D%7D';
globalThis.__irisoutHeatmapWorkers = [];
class IrisM0_HeatmapWorker {
  constructor() {
    this.listeners = new Map();
    this.messages = [];
    this.terminated = false;
    globalThis.__irisoutHeatmapWorkers.push(this);
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  postMessage(message) {
    this.messages.push(message);
  }
  emit(data) {
    for (const listener of this.listeners.get('message') ?? []) listener({ data });
  }
  emitError() {
    for (const listener of this.listeners.get('error') ?? []) listener(new Error('worker failed'));
  }
  terminate() {
    this.terminated = true;
  }
}
`

function heatmapExecutableCode(): string {
  const { code } = compileProject(ENTRY)
  return `${HEATMAP_TEST_STUBS}
${code
  .split('\n')
  .filter((line) => !line.startsWith('import ') || line.includes("'@irisout/runtime'"))
  .join('\n')}`
}

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function click(container: Element, selector: string): void {
  const element = container.querySelector(selector) as HTMLElement | null
  if (!element) throw new Error(`element not found: ${selector}`)
  element.click()
}

describe('apps/examples/heatmap.jsx', () => {
  it('connects input, metric selection, paragraph selection, and overview links', async () => {
    const mod = await loadGenerated(heatmapExecutableCode())
    const container = createContainer()
    const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(container)

    expect(container.querySelectorAll('.paragraph-list article')).toHaveLength(3)
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toContain('概要')
    expect(container.querySelector('.metric-controls .active')?.textContent).toContain('長さ')
    expect(container.querySelectorAll('.paragraph-score')).toHaveLength(3)

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
    const secondParagraph = container.querySelector('#paragraph-2') as HTMLElement
    secondParagraph.dispatchEvent(
      new secondParagraph.ownerDocument.defaultView!.KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true,
      }),
    )
    expect(container.querySelector('#paragraph-1')?.getAttribute('aria-selected')).toBe('true')
    instance.unmount()
  })

  it('analyzes in a worker, drops stale results, and pauses during composition', async () => {
    const mod = await loadGenerated(heatmapExecutableCode())
    const container = createContainer()
    const globalWithDocument = globalThis as typeof globalThis & { document?: Document }
    const hadDocument = 'document' in globalWithDocument
    const previousDocument = globalWithDocument.document
    globalWithDocument.document = container.ownerDocument

    try {
      const instance = (mod.mountComponent as (container: Element) => { unmount(): void })(
        container,
      )
      await flushAsync()

      type WorkerStub = {
        messages: { type: string; requestId?: number; source?: string }[]
        emit(data: unknown): void
        emitError(): void
        terminated: boolean
      }
      const worker = (globalThis as typeof globalThis & { __irisoutHeatmapWorkers: WorkerStub[] })
        .__irisoutHeatmapWorkers[0]
      if (!worker) throw new Error('heatmap worker stub was not created')
      expect(worker.messages[0]).toMatchObject({ type: 'initialize', terms: ['情報量'] })

      worker.emit({ type: 'ready' })
      const initialRequest = worker.messages.at(-1)
      expect(initialRequest).toMatchObject({ type: 'analyze', requestId: 1 })
      expect(container.querySelector('.analysis-status')?.textContent).toContain('解析中')

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement
      textarea.value = '先の要求'
      textarea.dispatchEvent(new textarea.ownerDocument.defaultView!.Event('input'))
      const firstInputRequest = worker.messages.at(-1)
      textarea.value = '後の要求'
      textarea.dispatchEvent(new textarea.ownerDocument.defaultView!.Event('input'))
      const secondInputRequest = worker.messages.at(-1)
      expect(firstInputRequest?.requestId).toBe(2)
      expect(secondInputRequest?.requestId).toBe(3)

      worker.emit({ type: 'result', requestId: 3, tokenCount: 12, elapsedMs: 2 })
      expect(container.querySelector('.analysis-status')?.textContent).toContain('単語数 12')
      expect(container.querySelector('.analysis-status')?.textContent).toContain('解析完了')
      worker.emit({ type: 'result', requestId: 2, tokenCount: 1, elapsedMs: 1 })
      expect(container.querySelector('.analysis-status')?.textContent).toContain('単語数 12')

      const analyzeCountBeforeComposition = worker.messages.filter(
        (message) => message.type === 'analyze',
      ).length
      textarea.dispatchEvent(new textarea.ownerDocument.defaultView!.Event('compositionstart'))
      textarea.value = '確定前一'
      textarea.dispatchEvent(new textarea.ownerDocument.defaultView!.Event('input'))
      textarea.value = '確定前二'
      textarea.dispatchEvent(new textarea.ownerDocument.defaultView!.Event('input'))
      expect(worker.messages.filter((message) => message.type === 'analyze')).toHaveLength(
        analyzeCountBeforeComposition,
      )
      textarea.dispatchEvent(new textarea.ownerDocument.defaultView!.Event('compositionend'))
      const compositionRequest = worker.messages.at(-1)
      expect(compositionRequest).toMatchObject({
        type: 'analyze',
        requestId: 4,
        source: '確定前二',
      })

      worker.emit({ type: 'result', requestId: 4, tokenCount: 14, elapsedMs: 3 })
      worker.emit({ type: 'error', requestId: 999 })
      expect(container.querySelector('.analysis-status')?.textContent).toContain('解析完了')
      worker.emit({ type: 'error', requestId: 4 })
      expect(container.querySelector('.analysis-status')?.textContent).toContain('解析に失敗')
      worker.emitError()
      expect(container.querySelector('.analysis-status')?.textContent).toContain('解析に失敗')

      instance.unmount()
      expect(worker.messages.at(-1)).toEqual({ type: 'dispose' })
      expect(worker.terminated).toBe(true)
    } finally {
      if (hadDocument) globalWithDocument.document = previousDocument
      else Reflect.deleteProperty(globalWithDocument, 'document')
    }
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
    const workerAsset = assets.find((name) => name.startsWith('heatmap.worker-'))
    expect(workerAsset).toBeDefined()
    const worker = readFileSync(path.join(outDir, 'assets', workerAsset!), 'utf8')
    expect(html).toContain('/heatmap/app.js')
    expect(html).toMatch(/\/heatmap\/assets\/.*\.css/)
    expect(worker).toMatch(/\/heatmap\/assets\/suzume-.*\.wasm/)
    expect(app).toMatch(/\/heatmap\/assets\/heatmap\.worker-.*\.js/)
    expect(assets.some((name) => name.endsWith('.wasm'))).toBe(true)
    expect(assets.some((name) => name.startsWith('heatmap.worker-'))).toBe(true)
  })
})
