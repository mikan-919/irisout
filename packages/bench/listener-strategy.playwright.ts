// 実Chromiumで、リスト項目ごとの直接リスナーと親要素へのイベント委譲を
// 複数イベントの同一fixtureで比較するrunner。attach/mount/dispatchとCDP強制GC後の
// retained JS heapを方式別・サイズ別に中央値で出力し、意味論の差もJSONへ残す。

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { build } from 'vite-plus'
import { chromium, type CDPSession, type Page } from 'playwright'

const SIZES = (process.env.IRISOUT_BENCH_LISTENER_SIZES ?? '100,1000,10000')
  .split(',')
  .map(Number)
  .filter((size) => Number.isSafeInteger(size) && size > 0)
const REPEATS = Number(process.env.IRISOUT_BENCH_LISTENER_REPEATS ?? 7)
const HEAP_REPEATS = Number(process.env.IRISOUT_BENCH_LISTENER_HEAP_REPEATS ?? 3)
const DISPATCH_ROUNDS = Number(process.env.IRISOUT_BENCH_LISTENER_DISPATCH_ROUNDS ?? 1)
const STRATEGIES = ['direct', 'delegated', 'capture', 'adapter'] as const
const METRICS = ['mount', 'attach', 'dispatch'] as const

type Strategy = (typeof STRATEGIES)[number]
type Metric = (typeof METRICS)[number]

interface TimingResult {
  elapsedMs: number
  itemCount: number
  listenerCount: number
  firstId: number | null
  middleId: number | null
  lastId: number | null
}

interface DispatchResult extends TimingResult {
  eventCount: number
  handledCount: number
  handledByEvent: Record<string, number>
  currentTargetMatches: number
  nativeEventIdentityMatches: number
  targetMatches: number
  phaseCounts: Record<string, Record<string, number>>
  identityChecksum: number
}

interface Bundle {
  code: string
  bytes: number
  gzipBytes: number
}

interface HeapResult {
  retainedJsHeapBytes: number
}

interface EnvironmentInfo {
  measuredAt: string
  chromiumVersion: string
  userAgent: string
  platform: string
  nodeVersion: string
  hostPlatform: string
  hostArch: string
}

const bundles = Object.fromEntries(
  await Promise.all(STRATEGIES.map(async (strategy) => [strategy, await buildBundle(strategy)])),
) as Record<Strategy, Bundle>

async function buildBundle(strategy: Strategy): Promise<Bundle> {
  const built = await build({
    configFile: false,
    define: { __LISTENER_STRATEGY__: JSON.stringify(strategy) },
    build: {
      write: false,
      minify: true,
      lib: {
        entry: path.resolve(import.meta.dirname, 'listener-strategy.driver.ts'),
        formats: ['es'],
      },
    },
  })
  const outputs = Array.isArray(built) ? built : [built]
  const output = outputs[0]
  if (!output || !('output' in output)) throw new Error(`${strategy} bundle failed`)
  const chunk = output.output.find((entry) => entry.type === 'chunk')
  if (!chunk || chunk.type !== 'chunk') throw new Error(`${strategy} bundle chunk missing`)
  return {
    code: chunk.code,
    bytes: Buffer.byteLength(chunk.code),
    gzipBytes: gzipSync(chunk.code).byteLength,
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]!
}

async function createPage(strategy: Strategy): Promise<Page> {
  const page = await browser.newPage()
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>')
  await page.addScriptTag({ content: bundles[strategy].code, type: 'module' })
  await page.waitForFunction(() => window.__listenerStrategyBench !== undefined)
  return page
}

function assertStable<T extends TimingResult>(
  runs: T[],
  strategy: Strategy,
  metric: Metric,
  size: number,
): void {
  const reference = runs[0]
  if (!reference) throw new Error(`No ${metric} result: ${strategy}/N=${size}`)
  if (
    !runs.every(
      (run) =>
        run.itemCount === reference.itemCount &&
        run.listenerCount === reference.listenerCount &&
        run.firstId === reference.firstId &&
        run.middleId === reference.middleId &&
        run.lastId === reference.lastId,
    )
  ) {
    throw new Error(`Unstable ${metric} result: ${strategy}/N=${size}`)
  }
}

async function measure(
  strategy: Strategy,
  metric: Metric,
  size: number,
): Promise<TimingResult | DispatchResult> {
  const page = await createPage(strategy)
  const run = () =>
    page.evaluate(
      ([metric, size, rounds]) => {
        if (metric === 'mount') return window.__listenerStrategyBench.measureMount(size)
        if (metric === 'attach') return window.__listenerStrategyBench.measureAttach(size)
        return window.__listenerStrategyBench.measureDispatch(size, rounds)
      },
      [metric, size, DISPATCH_ROUNDS] as const,
    )

  await run()
  const runs: Array<TimingResult | DispatchResult> = []
  for (let repeat = 0; repeat < REPEATS; repeat++) runs.push(await run())
  await page.close()
  assertStable(runs, strategy, metric, size)

  if (metric === 'dispatch') {
    const dispatchRuns = runs as DispatchResult[]
    const reference = dispatchRuns[0]!
    if (
      !dispatchRuns.every(
        (run) =>
          run.eventCount === reference.eventCount &&
          run.handledCount === reference.handledCount &&
          JSON.stringify(run.handledByEvent) === JSON.stringify(reference.handledByEvent) &&
          run.currentTargetMatches === reference.currentTargetMatches &&
          run.nativeEventIdentityMatches === reference.nativeEventIdentityMatches &&
          run.targetMatches === reference.targetMatches &&
          JSON.stringify(run.phaseCounts) === JSON.stringify(reference.phaseCounts) &&
          run.identityChecksum === reference.identityChecksum,
      )
    ) {
      throw new Error(`Unstable dispatch semantics: ${strategy}/N=${size}`)
    }
    return {
      ...reference,
      elapsedMs: median(dispatchRuns.map((run) => run.elapsedMs)),
    }
  }

  return {
    ...runs[0]!,
    elapsedMs: median(runs.map((run) => run.elapsedMs)),
  }
}

async function collectHeap(session: CDPSession): Promise<number> {
  await session.send('HeapProfiler.collectGarbage')
  const heap = (await session.send('Runtime.getHeapUsage')) as unknown as { usedSize: number }
  return heap.usedSize
}

async function measureHeap(strategy: Strategy, size: number): Promise<HeapResult> {
  const runs: HeapResult[] = []
  for (let repeat = 0; repeat < HEAP_REPEATS; repeat++) {
    const page = await createPage(strategy)
    const session = await page.context().newCDPSession(page)
    await page.evaluate(() => {
      window.__listenerStrategyBench.prepareHeap(1)
      window.__listenerStrategyBench.releaseHeap()
    })
    const baseline = await collectHeap(session)
    await page.evaluate((heapSize) => window.__listenerStrategyBench.prepareHeap(heapSize), size)
    const retained = await collectHeap(session)
    await page.close()
    runs.push({ retainedJsHeapBytes: retained - baseline })
  }
  return {
    retainedJsHeapBytes: median(runs.map((run) => run.retainedJsHeapBytes)),
  }
}

function resolveChromiumExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  }
  if (!existsSync('/etc/NIXOS')) return undefined

  try {
    const outputPath = execFileSync(
      'nix',
      ['build', '--no-link', '--print-out-paths', 'nixpkgs#chromium'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    )
      .trim()
      .split('\n')
      .at(-1)
    if (!outputPath) throw new Error('nix build returned no output path')

    const executablePath = path.join(outputPath, 'bin/chromium')
    if (!existsSync(executablePath)) throw new Error(`Chromium not found at ${executablePath}`)
    console.error(`Using NixOS Chromium: ${executablePath}`)
    return executablePath
  } catch (error) {
    throw new Error(
      'Could not resolve Chromium on NixOS. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH explicitly.',
      { cause: error },
    )
  }
}

if (!Number.isSafeInteger(REPEATS) || REPEATS < 1) {
  throw new Error(`IRISOUT_BENCH_LISTENER_REPEATS must be a positive integer: ${REPEATS}`)
}
if (!Number.isSafeInteger(HEAP_REPEATS) || HEAP_REPEATS < 1) {
  throw new Error(`IRISOUT_BENCH_LISTENER_HEAP_REPEATS must be a positive integer: ${HEAP_REPEATS}`)
}
if (!Number.isSafeInteger(DISPATCH_ROUNDS) || DISPATCH_ROUNDS < 1) {
  throw new Error(
    `IRISOUT_BENCH_LISTENER_DISPATCH_ROUNDS must be a positive integer: ${DISPATCH_ROUNDS}`,
  )
}
if (SIZES.length === 0) {
  throw new Error('IRISOUT_BENCH_LISTENER_SIZES must contain a positive integer')
}

const browser = await chromium.launch({
  headless: true,
  executablePath: resolveChromiumExecutable(),
})

try {
  const environmentPage = await browser.newPage()
  await environmentPage.setContent('<!doctype html><meta charset="utf-8"><body></body>')
  const browserEnvironment = await environmentPage.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
  }))
  await environmentPage.close()
  const environment: EnvironmentInfo = {
    measuredAt: new Date().toISOString(),
    chromiumVersion: browser.version(),
    userAgent: browserEnvironment.userAgent,
    platform: browserEnvironment.platform,
    nodeVersion: process.version,
    hostPlatform: process.platform,
    hostArch: process.arch,
  }

  console.log('\n=== Listener strategy bundle size ===')
  for (const strategy of STRATEGIES) {
    const bundle = bundles[strategy]
    console.log(
      strategy.padEnd(12),
      `${bundle.bytes} bytes minified, ${bundle.gzipBytes} bytes gzip`,
    )
  }
  console.log(`Chromium ${environment.chromiumVersion} (${environment.userAgent})`)
  console.log(
    `sizes=${SIZES.join(',')} repeats=${REPEATS} heapRepeats=${HEAP_REPEATS} dispatchRounds=${DISPATCH_ROUNDS}`,
  )

  const results: Record<
    string,
    Record<Metric, Record<Strategy, TimingResult | DispatchResult>>
  > = {}
  const heap: Record<string, Record<Strategy, HeapResult>> = {}

  for (const size of SIZES) {
    console.log(
      `\n=== Listener strategy N=${size} (${REPEATS} time / ${HEAP_REPEATS} heap repeats) ===`,
    )
    results[size] = {} as Record<Metric, Record<Strategy, TimingResult | DispatchResult>>
    heap[size] = {} as Record<Strategy, HeapResult>

    for (const metric of METRICS) {
      const measured = {} as Record<Strategy, TimingResult | DispatchResult>
      for (const strategy of STRATEGIES) {
        measured[strategy] = await measure(strategy, metric, size)
      }
      const direct = measured.direct
      if (!STRATEGIES.every((candidate) => measured[candidate].itemCount === direct.itemCount)) {
        throw new Error(`Strategies disagree on fixture: ${metric}/N=${size}`)
      }
      if (metric === 'dispatch') {
        const dispatch = Object.fromEntries(
          STRATEGIES.map((candidate) => {
            const result = measured[candidate] as DispatchResult
            return [
              candidate,
              {
                handled: result.handledByEvent,
                currentTargetMatches: result.currentTargetMatches,
                nativeEventIdentityMatches: result.nativeEventIdentityMatches,
                targetMatches: result.targetMatches,
                phaseCounts: result.phaseCounts,
              },
            ]
          }),
        )
        console.log(`semantics ${JSON.stringify(dispatch)}`)
      }
      results[size][metric] = measured
      const timings = STRATEGIES.map(
        (candidate) => `${candidate}=${measured[candidate].elapsedMs.toFixed(3)}ms`,
      ).join(' ')
      const listeners = STRATEGIES.map(
        (candidate) => `${candidate}=${measured[candidate].listenerCount}`,
      ).join(' ')
      console.log(metric.padEnd(12), timings, `listeners ${listeners}`)
    }

    const measuredHeap = {} as Record<Strategy, HeapResult>
    for (const strategy of STRATEGIES) measuredHeap[strategy] = await measureHeap(strategy, size)
    heap[size] = measuredHeap
    console.log(
      'heap'.padEnd(12),
      STRATEGIES.map(
        (strategy) => `${strategy}=${measuredHeap[strategy].retainedJsHeapBytes} bytes`,
      ).join(' '),
    )
  }

  console.log('\n=== JSON ===')
  console.log(
    JSON.stringify(
      {
        environment,
        repeats: REPEATS,
        heapRepeats: HEAP_REPEATS,
        dispatchRounds: DISPATCH_ROUNDS,
        sizes: SIZES,
        bundles: Object.fromEntries(
          STRATEGIES.map((strategy) => [
            strategy,
            {
              bytes: bundles[strategy].bytes,
              gzipBytes: bundles[strategy].gzipBytes,
            },
          ]),
        ),
        results,
        heap,
      },
      null,
      2,
    ),
  )
} finally {
  await browser.close()
}
