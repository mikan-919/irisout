import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { build } from 'vite-plus'
import { chromium, type Page } from 'playwright'
import type { ListRuntimeResult } from './list-runtime-driver.ts'

const SIZES = (process.env.IRISOUT_BENCH_SIZES ?? '100,1000,10000')
  .split(',')
  .map(Number)
  .filter((size) => Number.isSafeInteger(size) && size > 0)
const REPEATS = Number(process.env.IRISOUT_BENCH_REPEATS ?? 7)
const IMPLEMENTATIONS = ['legacy', 'addressed'] as const
const SCENARIOS = ['mount', 'updateOne', 'appendOne', 'removeOne', 'reverse', 'updateAll'] as const

type Implementation = (typeof IMPLEMENTATIONS)[number]
type Scenario = (typeof SCENARIOS)[number]

interface MedianResult extends Omit<ListRuntimeResult, 'elapsedMs' | 'mutationCount'> {
  elapsedMs: number
  mutationCount: number
}

const built = await build({
  configFile: false,
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
if (!output || !('output' in output)) throw new Error('List benchmark bundle failed')
const chunk = output.output.find((entry) => entry.type === 'chunk')
if (!chunk || chunk.type !== 'chunk') throw new Error('List benchmark chunk missing')
const bundle = chunk.code

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]!
}

async function createPage(): Promise<Page> {
  const page = await browser.newPage()
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>')
  await page.addScriptTag({ content: bundle, type: 'module' })
  await page.waitForFunction(() => window.__listRuntimeBench !== undefined)
  return page
}

async function measure(
  implementation: Implementation,
  scenario: Scenario,
  size: number,
): Promise<MedianResult> {
  const page = await createPage()
  const run = () =>
    page.evaluate(
      ([implementation, scenario, size]) =>
        scenario === 'mount'
          ? window.__listRuntimeBench.measureMount(implementation, size)
          : window.__listRuntimeBench.measureUpdate(implementation, size, scenario),
      [implementation, scenario, size] as const,
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

if (!Number.isSafeInteger(REPEATS) || REPEATS < 1) {
  throw new Error(`IRISOUT_BENCH_REPEATS must be a positive integer: ${REPEATS}`)
}
if (SIZES.length === 0) throw new Error('IRISOUT_BENCH_SIZES must contain a positive integer')

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

const browser = await chromium.launch({
  headless: true,
  executablePath: resolveChromiumExecutable(),
})
const results: Record<string, Record<string, Record<string, MedianResult>>> = {}

try {
  for (const size of SIZES) {
    console.log(`\n=== List runtime N=${size} (${REPEATS} repeats, median) ===`)
    results[size] = {}
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
      const ratio = legacy.elapsedMs / addressed.elapsedMs
      console.log(
        scenario.padEnd(12),
        `legacy=${legacy.elapsedMs.toFixed(3)}ms/${legacy.mutationCount} mutations`.padEnd(36),
        `addressed=${addressed.elapsedMs.toFixed(3)}ms/${addressed.mutationCount} mutations`.padEnd(
          39,
        ),
        `${ratio.toFixed(2)}x`,
      )
    }
  }
} finally {
  await browser.close()
}

console.log('\n=== JSON ===')
console.log(
  JSON.stringify({ repeats: REPEATS, sizes: SIZES, bundleBytes: bundle.length, results }, null, 2),
)
