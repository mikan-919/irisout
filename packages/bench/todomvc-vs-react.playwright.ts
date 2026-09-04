#!/usr/bin/env bun

// bench/todomvc-vs-react.ts(jsdom版)と同一シナリオを実Chromium上で計測
// する。jsdomはDOM APIを全部遅いJSで実装しているため「DOMを触るほど損」
// という実ブラウザと逆のコストモデルを持ち、直接DOM操作の多いhandwritten版
// を系統的に不利にする。実ブラウザでの再計測がこのスクリプトの目的。
//
// 実行: bun bench/todomvc-vs-react.playwright.ts
// (要: bunx playwright install chromium)
//
// 方法:
// - fixture(handwritten / React)とシナリオ本体(bench/browser-driver.ts)
//   を Bun.build で1本のESMバンドルにし、addScriptTagでページに注入する。
//   NODE_ENV=production は define で焼き込む(react-dom を productionビルド
//   で動かすため)。
// - 計測はすべてページ内の performance.now()(browser-driver.ts)。Node側
//   で計るとCDP往復(1操作あたり数ms)を測ることになるため。
// - 各セルはウォームアップ1回(捨てる)+ REPEATS回の中央値。jsdom版の
//   「1回計測・ウォームアップなし」はコールドスタート費が支配的だった
//   (N=100→1,000でmountが2倍強にしか増えない = 固定費汚染)。
// - heap計測はしない(Nodeプロセスのheapはブラウザと無関係)。

import path from 'node:path'
import { build } from 'vite-plus'
import type { Page } from 'playwright'
import { chromium } from 'playwright'
import type { ScenarioResult } from './browser-driver.ts'

const SIZES = [100, 1_000, 10_000, 100_000]
const TOGGLE_SIZES = [100, 1_000] // O(N^2)のため大きいNは対象外(jsdom版と同じ)
const REPEATS = 5

type Impl = 'handwritten' | 'react'

const built = await build({
  configFile: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    write: false,
    lib: {
      entry: path.resolve(import.meta.dirname, 'browser-driver.ts'),
      formats: ['es'],
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
})
const outputs = Array.isArray(built) ? built : [built]
const output = outputs[0]
if (!output || !('output' in output)) {
  throw new Error('driver bundle failed: no build output')
}
const chunk = output.output.find((entry) => entry.type === 'chunk')
if (!chunk || chunk.type !== 'chunk') {
  throw new Error('driver bundle failed: no output chunk')
}
const bundle = chunk.code

const browser = await chromium.launch({ headless: true })

async function newBenchPage(): Promise<Page> {
  const page = await browser.newPage()
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>')
  await page.addScriptTag({ content: bundle, type: 'module' })
  await page.waitForFunction(() => window.__bench !== undefined)
  return page
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

// 1つの(impl, N)セルをウォームアップ1回 + REPEATS回計測し、シナリオごとの
// 中央値を返す。ページはセルごとに使い捨て(impl間・N間の汚染を避ける)。
// 繰り返しは同一ページ内で行う(JITが温まった状態を測るため)。
async function measureCell(impl: Impl, n: number) {
  const page = await newBenchPage()
  const run = () =>
    page.evaluate(([impl, n]) => window.__bench.runScenarios(impl as Impl, n as number), [
      impl,
      n,
    ] as const) as Promise<ScenarioResult>
  await run() // warm-up(捨てる)
  const runs: ScenarioResult[] = []
  for (let i = 0; i < REPEATS; i++) runs.push(await run())
  await page.close()
  return {
    n,
    mountMs: median(runs.map((r) => r.mountMs)),
    filterSwitchMs: median(runs.map((r) => r.filterSwitchMs)),
    addOneMs: median(runs.map((r) => r.addOneMs)),
    removeOneMs: median(runs.map((r) => r.removeOneMs)),
    addOnePreservedExisting: runs.every((r) => r.addOnePreservedExisting),
    raw: runs,
  }
}

async function measureToggleCell(impl: Impl, n: number): Promise<number> {
  const page = await newBenchPage()
  const run = () =>
    page.evaluate(([impl, n]) => window.__bench.runToggleAll(impl as Impl, n as number), [
      impl,
      n,
    ] as const) as Promise<number>
  await run() // warm-up(捨てる)
  const runs: number[] = []
  for (let i = 0; i < REPEATS; i++) runs.push(await run())
  await page.close()
  return median(runs)
}

type CellResult = Awaited<ReturnType<typeof measureCell>>
const handwrittenResults: CellResult[] = []
const reactResults: CellResult[] = []
const handwrittenToggleMs = new Map<number, number>()
const reactToggleMs = new Map<number, number>()

for (const n of SIZES) {
  console.log(`\n=== N = ${n} ===`)

  console.log('  handwritten...')
  const hw = await measureCell('handwritten', n)
  handwrittenResults.push(hw)

  console.log('  react...')
  const rx = await measureCell('react', n)
  reactResults.push(rx)

  console.log(
    '  scenario'.padEnd(18),
    'handwritten (ms)'.padEnd(20),
    'react (ms)'.padEnd(15),
    'react / handwritten',
  )
  const rows: [string, number, number][] = [
    ['mount', hw.mountMs, rx.mountMs],
    ['filterSwitch', hw.filterSwitchMs, rx.filterSwitchMs],
    ['addOne', hw.addOneMs, rx.addOneMs],
    ['removeOne', hw.removeOneMs, rx.removeOneMs],
  ]
  for (const [name, hwMs, rxMs] of rows) {
    console.log(
      `  ${name}`.padEnd(18),
      hwMs.toFixed(2).padEnd(20),
      rxMs.toFixed(2).padEnd(15),
      `${(rxMs / hwMs).toFixed(2)}x`,
    )
  }
  if (!hw.addOnePreservedExisting) {
    console.log('  WARNING: handwritten did not preserve existing <li> identity on add')
  }

  if (TOGGLE_SIZES.includes(n)) {
    console.log('  toggleAll (handwritten)...')
    const hwToggleMs = await measureToggleCell('handwritten', n)
    console.log('  toggleAll (react)...')
    const rxToggleMs = await measureToggleCell('react', n)
    handwrittenToggleMs.set(n, hwToggleMs)
    reactToggleMs.set(n, rxToggleMs)
    console.log(
      '  toggleAll'.padEnd(18),
      hwToggleMs.toFixed(2).padEnd(20),
      rxToggleMs.toFixed(2).padEnd(15),
      `${(rxToggleMs / hwToggleMs).toFixed(2)}x`,
    )
  }
}

await browser.close()

console.log('\n=== 生データ (JSON, 各セルはREPEATS回の全計測値) ===')
console.log(
  JSON.stringify(
    {
      repeats: REPEATS,
      handwrittenResults,
      reactResults,
      handwrittenToggleMs: Object.fromEntries(handwrittenToggleMs),
      reactToggleMs: Object.fromEntries(reactToggleMs),
    },
    null,
    2,
  ),
)
