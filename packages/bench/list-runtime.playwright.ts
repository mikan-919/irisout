import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { build } from 'vite-plus'
import { chromium, type CDPSession, type Page } from 'playwright'
import type { ListRuntimeResult } from './list-runtime-driver.ts'

const SIZES = (process.env.IRISOUT_BENCH_SIZES ?? '100,1000,10000')
  .split(',')
  .map(Number)
  .filter((size) => Number.isSafeInteger(size) && size > 0)
const REPEATS = Number(process.env.IRISOUT_BENCH_REPEATS ?? 7)
const HEAP_REPEATS = Number(process.env.IRISOUT_BENCH_HEAP_REPEATS ?? 3)
const IMPLEMENTATIONS = ['legacy', 'addressed'] as const
const SCENARIOS = ['mount', 'updateOne', 'appendOne', 'removeOne', 'reverse', 'updateAll'] as const

type Implementation = (typeof IMPLEMENTATIONS)[number]
type Scenario = (typeof SCENARIOS)[number]

interface MedianResult extends Omit<ListRuntimeResult, 'elapsedMs' | 'mutationCount'> {
  elapsedMs: number
  mutationCount: number
}

interface HeapResult {
  retainedJsHeapBytes: number
}

interface Bundle {
  code: string
  bytes: number
  gzipBytes: number
}

async function buildBundle(implementation: Implementation): Promise<Bundle> {
  const built = await build({
    configFile: false,
    define: { __LIST_RUNTIME_IMPLEMENTATION__: JSON.stringify(implementation) },
    build: {
      write: false,
      minify: true,
      lib: {
        entry: path.resolve(import.meta.dirname, 'list-runtime-driver.ts'),
        formats: ['es'],
      },
    },
  })
  const outputs = Array.isArray(built) ? built : [built]
  const output = outputs[0]
  if (!output || !('output' in output)) throw new Error(`${implementation} bundle failed`)
  const chunk = output.output.find((entry) => entry.type === 'chunk')
  if (!chunk || chunk.type !== 'chunk') throw new Error(`${implementation} bundle chunk missing`)
  return {
    code: chunk.code,
    bytes: Buffer.byteLength(chunk.code),
    gzipBytes: gzipSync(chunk.code).byteLength,
  }
}

const bundles = Object.fromEntries(
  await Promise.all(
    IMPLEMENTATIONS.map(async (implementation) => [
      implementation,
      await buildBundle(implementation),
    ]),
  ),
) as Record<Implementation, Bundle>

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]!
}

async function createPage(implementation: Implementation): Promise<Page> {
  const page = await browser.newPage()
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>')
  await page.addScriptTag({ content: bundles[implementation].code, type: 'module' })
  await page.waitForFunction(() => window.__listRuntimeBench !== undefined)
  return page
}

async function measure(
  implementation: Implementation,
  scenario: Scenario,
  size: number,
): Promise<MedianResult> {
  const page = await createPage(implementation)
  const run = () =>
    page.evaluate(
      ([scenario, size]) =>
        scenario === 'mount'
          ? window.__listRuntimeBench.measureMount(size)
          : window.__listRuntimeBench.measureUpdate(size, scenario),
      [scenario, size] as const,
    )

  await run()
  const runs: ListRuntimeResult[] = []
  for (let repeat = 0; repeat < REPEATS; repeat++) runs.push(await run())
  await page.close()

  const reference = runs[0]!
  if (
    !runs.every(
      (run) =>
        run.itemCount === reference.itemCount &&
        run.firstText === reference.firstText &&
        run.lastText === reference.lastText,
    )
  ) {
    throw new Error(`Unstable List result: ${implementation}/${scenario}/N=${size}`)
  }
  return {
    elapsedMs: median(runs.map((run) => run.elapsedMs)),
    mutationCount: median(runs.map((run) => run.mutationCount)),
    itemCount: reference.itemCount,
    firstText: reference.firstText,
    lastText: reference.lastText,
  }
}

async function collectHeap(session: CDPSession): Promise<number> {
  await session.send('HeapProfiler.collectGarbage')
  const heap = (await session.send('Runtime.getHeapUsage')) as unknown as { usedSize: number }
  return heap.usedSize
}

async function measureHeap(
  implementation: Implementation,
  scenario: Scenario,
  size: number,
): Promise<HeapResult> {
  const runs: HeapResult[] = []
  for (let repeat = 0; repeat < HEAP_REPEATS; repeat++) {
    const page = await createPage(implementation)
    const session = await page.context().newCDPSession(page)
    await page.evaluate((scenario) => {
      window.__listRuntimeBench.prepareHeap(1, scenario)
      window.__listRuntimeBench.releaseHeap()
    }, scenario)
    const baseline = await collectHeap(session)
    await page.evaluate(
      ([size, scenario]) => window.__listRuntimeBench.prepareHeap(size, scenario),
      [size, scenario] as const,
    )
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
  throw new Error(`IRISOUT_BENCH_REPEATS must be a positive integer: ${REPEATS}`)
}
if (!Number.isSafeInteger(HEAP_REPEATS) || HEAP_REPEATS < 1) {
  throw new Error(`IRISOUT_BENCH_HEAP_REPEATS must be a positive integer: ${HEAP_REPEATS}`)
}
if (SIZES.length === 0) throw new Error('IRISOUT_BENCH_SIZES must contain a positive integer')

const browser = await chromium.launch({
  headless: true,
  executablePath: resolveChromiumExecutable(),
})
const results: Record<string, Record<string, Record<string, MedianResult>>> = {}
const heap: Record<string, Record<string, Record<string, HeapResult>>> = {}

console.log('\n=== List runtime bundle size ===')
for (const implementation of IMPLEMENTATIONS) {
  const bundle = bundles[implementation]
  console.log(
    implementation.padEnd(12),
    `${bundle.bytes} bytes minified, ${bundle.gzipBytes} bytes gzip`,
  )
}

try {
  for (const size of SIZES) {
    console.log(`\n=== List runtime N=${size} (${REPEATS} time / ${HEAP_REPEATS} heap repeats) ===`)
    results[size] = {}
    heap[size] = {}
    for (const scenario of SCENARIOS) {
      const legacy = await measure('legacy', scenario, size)
      const addressed = await measure('addressed', scenario, size)
      if (
        legacy.itemCount !== addressed.itemCount ||
        legacy.firstText !== addressed.firstText ||
        legacy.lastText !== addressed.lastText
      ) {
        throw new Error(`Implementations disagree: ${scenario}/N=${size}`)
      }
      results[size]![scenario] = { legacy, addressed }

      const legacyHeap = await measureHeap('legacy', scenario, size)
      const addressedHeap = await measureHeap('addressed', scenario, size)
      heap[size]![scenario] = { legacy: legacyHeap, addressed: addressedHeap }

      const ratio = legacy.elapsedMs / addressed.elapsedMs
      const heapRatio = legacyHeap.retainedJsHeapBytes / addressedHeap.retainedJsHeapBytes
      console.log(
        scenario.padEnd(12),
        `time ${legacy.elapsedMs.toFixed(3)}→${addressed.elapsedMs.toFixed(3)}ms (${ratio.toFixed(2)}x)`.padEnd(
          34,
        ),
        `mutations ${legacy.mutationCount}→${addressed.mutationCount}`.padEnd(25),
        `JS heap ${legacyHeap.retainedJsHeapBytes}→${addressedHeap.retainedJsHeapBytes} bytes (${heapRatio.toFixed(2)}x)`,
      )
    }
  }
} finally {
  await browser.close()
}

console.log('\n=== JSON ===')
console.log(
  JSON.stringify(
    {
      repeats: REPEATS,
      heapRepeats: HEAP_REPEATS,
      sizes: SIZES,
      bundles: Object.fromEntries(
        IMPLEMENTATIONS.map((implementation) => [
          implementation,
          {
            bytes: bundles[implementation].bytes,
            gzipBytes: bundles[implementation].gzipBytes,
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
