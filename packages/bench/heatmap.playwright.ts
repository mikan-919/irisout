#!/usr/bin/env bun

// ヒートマップの本番生成物を実Chromiumへ読み込み、Worker解析、連続入力、
// 日本語入力、キーボード操作、長文時の時間とページ側ヒープを確認する。
// ヒープ値はWorkerとDOMのnative memoryを含まないため、対応上限の判断材料の
// 一つとして扱い、測定条件と一緒に記録する。

import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, type CDPSession, type Page } from 'playwright'

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..')
const PARAGRAPH_SIZES = [3, 30, 100, 300]
const REPEATS = Number(process.env.IRISOUT_HEATMAP_REPEATS ?? 3)
const MAX_PARAGRAPHS = 300
const MAX_CHARS = 25_000
const MAX_INPUT_TO_DISPLAY_MS = 1_000
const MAX_DISPLAY_UPDATE_MS = 100
const MAX_PAGE_HEAP_DELTA_BYTES = 32 * 1024 * 1024
const MAX_KEYBOARD_RESPONSE_MS = 16

interface Measurement {
  paragraphs: number
  chars: number
  tokenCount: number
  workerAnalysisMs: number
  inputToDisplayMs: number
  displayUpdateMs: number
  pageHeapDeltaBytes: number
}

interface ServerHandle {
  origin: string
  close(): Promise<void>
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]!
}

function makeSource(paragraphCount: number): string {
  const sentence = '情報量と解析の指標を確認します。数値42と記号#を含む日本語の文章です。'
  return Array.from(
    { length: paragraphCount },
    (_, index) => `第${index + 1}段落です。${sentence}${sentence}`,
  ).join('\n\n')
}

function resolveChromiumExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  }
  if (!existsSync('/etc/NIXOS')) return undefined
  const outputPath = execFileSync(
    'nix',
    ['build', '--no-link', '--print-out-paths', 'nixpkgs#chromium'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  )
    .trim()
    .split('\n')
    .at(-1)
  if (!outputPath) throw new Error('Chromiumの出力先がありません')
  const executablePath = path.join(outputPath, 'bin/chromium')
  if (!existsSync(executablePath)) throw new Error(`Chromiumがありません: ${executablePath}`)
  return executablePath
}

function buildProduction(outDir: string): void {
  const result = spawnSync(
    path.resolve(PROJECT_ROOT, 'node_modules/.bin/vp'),
    ['-C', 'apps/examples', 'build'],
    {
      cwd: PROJECT_ROOT,
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
  if (result.status !== 0) {
    throw new Error(`ヒートマップの本番生成に失敗しました\n${result.stdout}\n${result.stderr}`)
  }
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath)
  if (extension === '.html') return 'text/html; charset=utf-8'
  if (extension === '.js') return 'text/javascript; charset=utf-8'
  if (extension === '.css') return 'text/css; charset=utf-8'
  if (extension === '.wasm') return 'application/wasm'
  if (extension === '.json') return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

async function serveProduction(outDir: string): Promise<ServerHandle> {
  const root = path.resolve(outDir)
  const server = createServer((request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      const prefix = '/heatmap'
      const relativePath =
        pathname === prefix || pathname === `${prefix}/`
          ? 'index.html'
          : pathname.startsWith(`${prefix}/`)
            ? decodeURIComponent(pathname.slice(prefix.length + 1))
            : null
      if (relativePath == null) {
        response.statusCode = 404
        response.end('not found')
        return
      }
      const filePath = path.resolve(root, relativePath)
      if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
        response.statusCode = 403
        response.end('forbidden')
        return
      }
      const body = readFileSync(filePath)
      response.statusCode = 200
      response.setHeader('content-type', contentType(filePath))
      response.end(body)
    } catch {
      response.statusCode = 404
      response.end('not found')
    }
  })
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('HTTPサーバーのアドレスがありません')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

async function waitForCompleted(page: Page, paragraphCount: number): Promise<void> {
  await page.waitForFunction((expectedParagraphCount) => {
    const status = document.querySelector('.analysis-status')?.textContent ?? ''
    return (
      status.includes('解析完了') &&
      document.querySelectorAll('.paragraph-list article').length === expectedParagraphCount
    )
  }, paragraphCount)
}

async function pageHeapBytes(session: CDPSession): Promise<number> {
  await session.send('HeapProfiler.collectGarbage')
  const usage = (await session.send('Runtime.getHeapUsage')) as unknown as { usedSize: number }
  return usage.usedSize
}

async function openHeatmapPage(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  origin: string,
) {
  const page = await browser.newPage()
  await page.goto(`${origin}/heatmap/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.heatmap-app')
  await waitForCompleted(page, 3)
  return page
}

async function measureSource(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  origin: string,
  paragraphCount: number,
): Promise<Measurement> {
  const page = await openHeatmapPage(browser, origin)
  const session = await page.context().newCDPSession(page)
  try {
    const beforeHeap = await pageHeapBytes(session)
    const source = makeSource(paragraphCount)
    const startedAt = await page.evaluate((value) => {
      const textarea = document.querySelector('textarea')
      if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('textareaがありません')
      textarea.value = value
      const start = performance.now()
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      return start
    }, source)
    await waitForCompleted(page, paragraphCount)
    const finishedAt = await page.evaluate(() => performance.now())
    const status = (await page.locator('.analysis-status').textContent()) ?? ''
    const match = status.match(/解析完了 \(([0-9.]+)ms\)/)
    if (!match) throw new Error(`解析時間を取得できません: ${status}`)
    const workerAnalysisMs = Number(match[1])
    const inputToDisplayMs = finishedAt - startedAt
    const afterHeap = await pageHeapBytes(session)
    return {
      paragraphs: paragraphCount,
      chars: source.length,
      tokenCount: Number(status.match(/単語数 ([0-9]+)/)?.[1] ?? 0),
      workerAnalysisMs,
      inputToDisplayMs,
      displayUpdateMs: Math.max(0, inputToDisplayMs - workerAnalysisMs),
      pageHeapDeltaBytes: afterHeap - beforeHeap,
    }
  } finally {
    await session.detach()
    await page.close()
  }
}

async function checkInteractions(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  origin: string,
): Promise<{ keyboardResponseMs: number; statusDuringComposition: string; scoreText: string }> {
  const page = await openHeatmapPage(browser, origin)
  try {
    const keyboardResponseMs = await page.evaluate(() => {
      const first = document.querySelector('#paragraph-1')
      if (!(first instanceof HTMLElement)) throw new Error('第1段落がありません')
      first.focus()
      const startedAt = performance.now()
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      if (document.querySelector('#paragraph-2')?.getAttribute('aria-selected') !== 'true') {
        throw new Error('キーボードによる段落移動に失敗しました')
      }
      return performance.now() - startedAt
    })
    const score = page.locator('.paragraph-score').first()
    if (!(await score.isVisible())) throw new Error('色以外の指標が表示されていません')
    const scoreText = (await score.textContent()) ?? ''
    const statusDuringComposition = await page.evaluate(() => {
      const textarea = document.querySelector('textarea')
      if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('textareaがありません')
      textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      textarea.value = '確定前の入力'
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      return document.querySelector('.analysis-status')?.textContent ?? ''
    })
    if (!statusDuringComposition.includes('解析完了')) {
      throw new Error(`文字確定前に解析状態が変わりました: ${statusDuringComposition}`)
    }
    await page.evaluate(() => {
      const textarea = document.querySelector('textarea')
      if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('textareaがありません')
      textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    })
    await waitForCompleted(page, 1)
    return { keyboardResponseMs, statusDuringComposition, scoreText }
  } finally {
    await page.close()
  }
}

if (!Number.isSafeInteger(REPEATS) || REPEATS < 1) {
  throw new Error(`IRISOUT_HEATMAP_REPEATSは正の整数にしてください: ${REPEATS}`)
}

const outDir = mkdtempSync(path.join(tmpdir(), 'irisout-heatmap-browser-'))
buildProduction(outDir)
const server = await serveProduction(outDir)
const browser = await chromium.launch({
  headless: true,
  executablePath: resolveChromiumExecutable(),
})

try {
  const measurements: Measurement[] = []
  for (const paragraphCount of PARAGRAPH_SIZES) {
    const runs: Measurement[] = []
    for (let repeat = 0; repeat < REPEATS; repeat += 1) {
      runs.push(await measureSource(browser, server.origin, paragraphCount))
    }
    const reference = runs[0]!
    measurements.push({
      paragraphs: paragraphCount,
      chars: reference.chars,
      tokenCount: reference.tokenCount,
      workerAnalysisMs: median(runs.map((run) => run.workerAnalysisMs)),
      inputToDisplayMs: median(runs.map((run) => run.inputToDisplayMs)),
      displayUpdateMs: median(runs.map((run) => run.displayUpdateMs)),
      pageHeapDeltaBytes: Math.round(median(runs.map((run) => run.pageHeapDeltaBytes))),
    })
  }
  const interactions = await checkInteractions(browser, server.origin)
  const largest = measurements.at(-1)!
  const criteria = {
    maxParagraphs: MAX_PARAGRAPHS,
    maxChars: MAX_CHARS,
    maxInputToDisplayMs: MAX_INPUT_TO_DISPLAY_MS,
    maxDisplayUpdateMs: MAX_DISPLAY_UPDATE_MS,
    maxPageHeapDeltaBytes: MAX_PAGE_HEAP_DELTA_BYTES,
    maxKeyboardResponseMs: MAX_KEYBOARD_RESPONSE_MS,
  }
  const passed =
    largest.paragraphs <= criteria.maxParagraphs &&
    largest.chars <= criteria.maxChars &&
    largest.inputToDisplayMs <= criteria.maxInputToDisplayMs &&
    largest.displayUpdateMs <= criteria.maxDisplayUpdateMs &&
    largest.pageHeapDeltaBytes <= criteria.maxPageHeapDeltaBytes &&
    interactions.keyboardResponseMs <= criteria.maxKeyboardResponseMs
  console.log(
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        chromium: browser.version(),
        repeats: REPEATS,
        measurements,
        interactions,
        criteria,
        passed,
      },
      null,
      2,
    ),
  )
  if (!passed) throw new Error('ヒートマップの対応上限に対する完了基準を満たしません')
} finally {
  await browser.close()
  await server.close()
}
