#!/usr/bin/env bun

// apps/examples/todomvc.jsx の現在のコンパイラ出力、手書き版、React版を、
// 同一Chromium内で機能試験・転送量・初期化・更新・DOM変更・JavaScriptヒープの
// 6軸で比較する。authoringファイルは編集しない。

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { build } from 'vite-plus'
import { chromium, type CDPSession, type Page } from 'playwright'
import { compile, type CompileResult } from '../../packages/compiler/src/compiler.ts'
import type {
  Implementation,
  MountInternalsResult,
  Scenario,
  ScenarioResult,
} from './todomvc-compiler-driver.ts'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const examplesRoot = path.join(repoRoot, 'apps/examples')
const authoredPath = path.join(examplesRoot, 'todomvc.jsx')
const handwrittenPath = path.join(examplesRoot, 'todomvc.handwritten.js')
const reactPath = path.join(examplesRoot, 'todomvc.react.tsx')
const driverPath = path.resolve(import.meta.dirname, 'todomvc-compiler-driver.ts')

const SIZES = parseSizes(process.env.IRISOUT_TODOMVC_SIZES ?? '100,1000,10000')
const REPEATS = parsePositiveInt('IRISOUT_TODOMVC_REPEATS', 7)
const WARMUPS = parsePositiveInt('IRISOUT_TODOMVC_WARMUPS', 2)
const HEAP_SIZE = parsePositiveInt('IRISOUT_TODOMVC_HEAP_SIZE', 1000)
const HEAP_REPEATS = parsePositiveInt('IRISOUT_TODOMVC_HEAP_REPEATS', 3)
const IMPLEMENTATIONS: Implementation[] = ['generated', 'handwritten', 'react']
const SCENARIOS: Scenario[] = ['mount', 'toggleOne', 'textEdit', 'addOne', 'removeOne', 'filter']

interface Todo {
  id: number
  text: string
  completed: boolean
}

interface Bundle {
  code: string
  bytes: number
  gzipBytes: number
}

interface TransferResult extends Bundle {
  htmlBytes: number
  htmlGzipBytes: number
  totalGzipBytes: number
  combinedGzipBytes: number
}

interface CellResult {
  implementation: Implementation
  scenario: Scenario
  n: number
  elapsedMs: number
  finalTodoCount: number
  finalSignature: string
  mutationRecords: number
  childListRecords: number
  attributeRecords: number
  characterDataRecords: number
  liAttached: number
  liDetached: number
  createdLis: number
  destroyedLis: number
  changedTodoCount: number
  unrelatedTodoDomChanged: boolean
  listMovedCount: number
  listRepositioned: boolean
}

interface HeapResult {
  implementation: Implementation
  n: number
  afterMountBytes: number
  afterUpdateBytes: number
  afterDeleteAllBytes: number
  afterUnmountBytes: number
}

interface CodeMetrics {
  generatedCodeBytes: number
  generatedInitialHtmlBytes: number
  handwrittenSourceBytes: number
  reactSourceBytes: number
  generatedFunctionDefinitions: number
  generatedComponentFactoryDefinitions: number
  generatedItemFindCalls: number
  generatedItemListenerRegistrations: number
  generatedTopLevelListenerRegistrations: number
  generatedTemplateSetups: number
  generatedVisibleTodoRecomputations: number
  generatedActiveCountExpressions: number
  generatedListBindingExpressions: number
  generatedRangeSearchDefinitions: number
  generatedRangeSearchCalls: number
  generatedRuntimeHelpers: string[]
  generatedProductionContainsCompiler: boolean
}

interface BuildChunk {
  type: 'chunk'
  fileName: string
  code: string
}

interface BuildAsset {
  type: 'asset'
  fileName: string
  source: string | Uint8Array
}

interface ProductionBuild {
  bundle: Bundle
  html: string
}

interface VirtualModuleMap {
  [id: string]: string
}

function parsePositiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer: ${value}`)
  }
  return value
}

function parseSizes(value: string): number[] {
  const sizes = value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((size) => Number.isSafeInteger(size) && size > 0)
  if (sizes.length === 0) throw new Error('IRISOUT_TODOMVC_SIZES must contain a positive integer')
  return sizes
}

function makeTodos(n: number): Todo[] {
  return Array.from({ length: n }, (_, index) => ({
    id: index + 1,
    text: `todo ${index + 1}`,
    completed: false,
  }))
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function bundleMetrics(code: string): Bundle {
  return {
    code,
    bytes: byteLength(code),
    gzipBytes: gzipSync(code).byteLength,
  }
}

function textFromAsset(asset: BuildAsset): string {
  return typeof asset.source === 'string' ? asset.source : new TextDecoder().decode(asset.source)
}

function buildOutputs(value: unknown): (BuildChunk | BuildAsset)[] {
  const outputs = Array.isArray(value) ? value : [value]
  const result: (BuildChunk | BuildAsset)[] = []
  for (const output of outputs) {
    if (!output || typeof output !== 'object' || !('output' in output)) continue
    const entries = (output as { output: unknown }).output
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || !('type' in entry)) continue
      if ((entry as { type: string }).type === 'chunk') {
        const chunk = entry as { type: 'chunk'; fileName: string; code: string }
        result.push(chunk)
      } else if ((entry as { type: string }).type === 'asset') {
        const asset = entry as { type: 'asset'; fileName: string; source: string | Uint8Array }
        result.push(asset)
      }
    }
  }
  return result
}

function findChunk(outputs: (BuildChunk | BuildAsset)[], label: string): BuildChunk {
  const chunks = outputs.filter((entry): entry is BuildChunk => entry.type === 'chunk')
  if (chunks.length !== 1) throw new Error(`${label}: expected one chunk, found ${chunks.length}`)
  return chunks[0]!
}

function findAsset(outputs: (BuildChunk | BuildAsset)[], fileName: string): BuildAsset {
  const asset = outputs.find(
    (entry): entry is BuildAsset => entry.type === 'asset' && entry.fileName === fileName,
  )
  if (!asset) throw new Error(`missing build asset: ${fileName}`)
  return asset
}

function virtualModules(modules: VirtualModuleMap) {
  const resolved = new Map<string, string>()
  for (const id of Object.keys(modules)) resolved.set(`\0${id}`, id)
  return {
    name: 'irisout-todomvc-benchmark-virtual-modules',
    resolveId(id: string) {
      return modules[id] !== undefined ? `\0${id}` : null
    },
    load(id: string) {
      const sourceId = resolved.get(id)
      return sourceId === undefined ? null : modules[sourceId]
    },
  }
}

async function buildVirtualEntry(
  entry: string,
  modules: VirtualModuleMap,
  label: string,
  entryFileName: string,
): Promise<Bundle> {
  const built = await build({
    root: examplesRoot,
    configFile: false,
    plugins: [virtualModules(modules)],
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      write: false,
      minify: true,
      rollupOptions: {
        input: entry,
        external: [],
        output: {
          format: 'es',
          entryFileNames: entryFileName,
          inlineDynamicImports: true,
        },
      },
    },
  })
  return bundleMetrics(findChunk(buildOutputs(built), label).code)
}

function withRestoredEnv<T>(name: string, value: string, action: () => Promise<T>): Promise<T> {
  const previous = process.env[name]
  process.env[name] = value
  return action().finally(() => {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  })
}

async function buildGeneratedProduction(generated: CompileResult): Promise<ProductionBuild> {
  const generatedEntry = 'virtual:irisout-todomvc-generated-production'
  const bundle = await buildVirtualEntry(
    generatedEntry,
    {
      [generatedEntry]: `${generated.code}\nhydrateComponent(document.getElementById('app'));`,
    },
    'generated production',
    'app.js',
  )
  const html = await withRestoredEnv('IRISOUT_ENTRY', authoredPath, async () => {
    const built = await build({
      root: examplesRoot,
      configFile: path.join(examplesRoot, 'vite.config.ts'),
      build: { write: false },
    })
    const outputs = buildOutputs(built)
    return textFromAsset(findAsset(outputs, 'index.html'))
  })
  return { bundle, html }
}

function compileBenchVariant(source: string): CompileResult {
  const startToken = 'const todos = signal(['
  const start = source.indexOf(startToken)
  if (start < 0) throw new Error('could not locate TodoMVC initial signal')
  const end = source.indexOf('  ])', start)
  if (end < 0) throw new Error('could not locate TodoMVC initial signal end')
  const replacement = 'const todos = signal(globalThis.__IRISOUT_BENCH_INITIAL_TODOS__)'
  const benchSource = `${source.slice(0, start)}${replacement}${source.slice(end + '  ])'.length)}`
  const globalState = globalThis as typeof globalThis & {
    __IRISOUT_BENCH_INITIAL_TODOS__?: Todo[]
  }
  globalState.__IRISOUT_BENCH_INITIAL_TODOS__ = makeTodos(2)
  try {
    return compile(benchSource)
  } finally {
    globalState.__IRISOUT_BENCH_INITIAL_TODOS__ = undefined
  }
}

function generatedModuleSource(result: CompileResult): string {
  return `${result.code}\nexport const generatedInitialHtml = ${JSON.stringify(result.initialHtml)};`
}

async function buildBenchmarkDriver(
  generatedActual: CompileResult,
  generatedBench: CompileResult,
): Promise<Bundle> {
  const modules: VirtualModuleMap = {
    'virtual:irisout-todomvc-generated-actual': generatedModuleSource(generatedActual),
    'virtual:irisout-todomvc-generated-bench': generatedModuleSource(generatedBench),
  }
  const built = await build({
    root: examplesRoot,
    configFile: false,
    plugins: [virtualModules(modules)],
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      write: false,
      minify: true,
      rollupOptions: {
        input: driverPath,
        external: [],
        output: {
          format: 'es',
          entryFileNames: 'todomvc-compiler-driver.js',
          inlineDynamicImports: true,
        },
      },
    },
  })
  return bundleMetrics(findChunk(buildOutputs(built), 'benchmark driver').code)
}

function emptyAppHtml(generatedHtml: string, initialHtml: string): string {
  const generatedApp = `<div id="app">${initialHtml}</div>`
  if (!generatedHtml.includes(generatedApp)) {
    throw new Error('production HTML does not contain the compiler-generated app shell')
  }
  return generatedHtml.replace(generatedApp, '<div id="app"></div>')
}

async function buildProductionBundles(
  generated: CompileResult,
  generatedProduction: ProductionBuild,
): Promise<Record<Implementation, TransferResult>> {
  const handwrittenEntry = 'virtual:irisout-todomvc-handwritten-production'
  const reactEntry = 'virtual:irisout-todomvc-react-production'
  const generatedBundle = generatedProduction.bundle
  const handwrittenBundle = await buildVirtualEntry(
    handwrittenEntry,
    {
      [handwrittenEntry]: `import { mountComponent } from ${JSON.stringify(handwrittenPath)}; mountComponent(document.getElementById('app'));`,
    },
    'handwritten production',
    'app.js',
  )
  const reactBundle = await buildVirtualEntry(
    reactEntry,
    {
      [reactEntry]: `import * as React from 'react'; import { createRoot } from 'react-dom/client'; import { TodoApp } from ${JSON.stringify(reactPath)}; const initialTodos = ${JSON.stringify(
        [
          { id: 1, text: 'irisout を書く', completed: false },
          { id: 2, text: '牛乳を買う', completed: true },
        ],
      )}; createRoot(document.getElementById('app')).render(React.createElement(TodoApp, { initialTodos }));`,
    },
    'react production',
    'app.js',
  )
  const emptyHtml = emptyAppHtml(generatedProduction.html, generated.initialHtml)
  const makeTransfer = (bundle: Bundle, html: string): TransferResult => ({
    ...bundle,
    htmlBytes: byteLength(html),
    htmlGzipBytes: gzipSync(html).byteLength,
    totalGzipBytes: bundle.gzipBytes + gzipSync(html).byteLength,
    combinedGzipBytes: gzipSync(`${html}${bundle.code}`).byteLength,
  })
  return {
    generated: makeTransfer(generatedBundle, generatedProduction.html),
    handwritten: makeTransfer(handwrittenBundle, emptyHtml),
    react: makeTransfer(reactBundle, emptyHtml),
  }
}

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0
}

function generatedRuntimeHelpers(code: string): string[] {
  const line = code.match(/^import \{ (.+) \} from '@irisout\/runtime';$/m)?.[1]
  if (!line) return []
  return line.split(',').map((part) => part.trim().replace(/ as __.+__$/, ''))
}

function collectCodeMetrics(
  generated: CompileResult,
  generatedProduction: ProductionBuild,
  handwrittenSource: string,
  reactSource: string,
): CodeMetrics {
  const code = generated.code
  return {
    generatedCodeBytes: byteLength(code),
    generatedInitialHtmlBytes: byteLength(generated.initialHtml),
    handwrittenSourceBytes: byteLength(handwrittenSource),
    reactSourceBytes: byteLength(reactSource),
    generatedFunctionDefinitions: countMatches(code, /\bfunction [A-Za-z_$][\w$]*\s*\(/g),
    generatedComponentFactoryDefinitions: countMatches(
      code,
      /\bfunction __create_[A-Za-z0-9_$]+__\(/g,
    ),
    generatedItemFindCalls: countMatches(code, /__find__\(__el__,/g),
    generatedItemListenerRegistrations: countMatches(
      code,
      /__find__\(__el__,[^\n]+?\)\.addEventListener/g,
    ),
    generatedTopLevelListenerRegistrations: countMatches(
      code,
      /__markers__\.get\([^\n]+?\)\?\.addEventListener/g,
    ),
    generatedTemplateSetups: countMatches(code, /createElement\('template'\)/g),
    generatedVisibleTodoRecomputations: countMatches(code, /visibleTodos\s*=/g),
    generatedActiveCountExpressions: countMatches(
      code,
      /todos\.filter\(\(t\) => !t\.completed\)\.length/g,
    ),
    generatedListBindingExpressions: countMatches(code, /__updateListBinding__\(__item__/g),
    generatedRangeSearchDefinitions: countMatches(code, /function __findRange__\(/g),
    generatedRangeSearchCalls: Math.max(0, countMatches(code, /__findRange__\(/g) - 1),
    generatedRuntimeHelpers: generatedRuntimeHelpers(code),
    generatedProductionContainsCompiler:
      generatedProduction.bundle.code.includes('@babel/') ||
      generatedProduction.bundle.code.includes('parseExpression'),
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]!
}

function stableBoolean(values: boolean[], label: string): boolean {
  if (!values.every((value) => value === values[0])) {
    throw new Error(`unstable boolean result: ${label}`)
  }
  return values[0]!
}

function summarizeCell(runs: ScenarioResult[]): CellResult {
  const first = runs[0]
  if (!first) throw new Error('empty scenario result')
  if (!runs.every((run) => run.finalSignature === first.finalSignature)) {
    throw new Error(`unstable final DOM: ${first.implementation}/${first.scenario}/N=${first.n}`)
  }
  return {
    implementation: first.implementation,
    scenario: first.scenario,
    n: first.n,
    elapsedMs: median(runs.map((run) => run.elapsedMs)),
    finalTodoCount: first.finalTodoCount,
    finalSignature: first.finalSignature,
    mutationRecords: median(runs.map((run) => run.mutationRecords)),
    childListRecords: median(runs.map((run) => run.childListRecords)),
    attributeRecords: median(runs.map((run) => run.attributeRecords)),
    characterDataRecords: median(runs.map((run) => run.characterDataRecords)),
    liAttached: median(runs.map((run) => run.liAttached)),
    liDetached: median(runs.map((run) => run.liDetached)),
    createdLis: median(runs.map((run) => run.createdLis)),
    destroyedLis: median(runs.map((run) => run.destroyedLis)),
    changedTodoCount: median(runs.map((run) => run.changedTodoCount)),
    unrelatedTodoDomChanged: stableBoolean(
      runs.map((run) => run.unrelatedTodoDomChanged),
      `${first.implementation}/${first.scenario}/unrelated`,
    ),
    listMovedCount: median(runs.map((run) => run.listMovedCount)),
    listRepositioned: stableBoolean(
      runs.map((run) => run.listRepositioned),
      `${first.implementation}/${first.scenario}/list-repositioned`,
    ),
  }
}

async function newBenchPage(driver: Bundle): Promise<Page> {
  const page = await browser.newPage()
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>')
  await page.addScriptTag({ content: driver.code, type: 'module' })
  await page.waitForFunction(() => window.__todomvcCompilerBench !== undefined)
  return page
}

async function measureCell(
  driver: Bundle,
  implementation: Implementation,
  n: number,
  scenario: Scenario,
): Promise<CellResult> {
  const page = await newBenchPage(driver)
  const run = () =>
    page.evaluate(
      ([implementation, n, scenario]) =>
        window.__todomvcCompilerBench.runScenario(implementation, n, scenario),
      [implementation, n, scenario] as const,
    )
  try {
    for (let i = 0; i < WARMUPS; i++) await run()
    const runs: ScenarioResult[] = []
    for (let i = 0; i < REPEATS; i++) runs.push(await run())
    return summarizeCell(runs)
  } finally {
    await page.close()
  }
}

async function measureMountInternals(
  driver: Bundle,
  implementation: Implementation,
  n: number,
): Promise<MountInternalsResult> {
  const page = await newBenchPage(driver)
  try {
    return await page.evaluate(
      ([implementation, n]) =>
        window.__todomvcCompilerBench.measureMountInternals(implementation, n),
      [implementation, n] as const,
    )
  } finally {
    await page.close()
  }
}

async function collectHeap(session: CDPSession): Promise<number> {
  await session.send('HeapProfiler.collectGarbage')
  const usage = (await session.send('Runtime.getHeapUsage')) as unknown as { usedSize: number }
  return usage.usedSize
}

async function measureHeap(driver: Bundle, implementation: Implementation): Promise<HeapResult> {
  const runs: Omit<HeapResult, 'implementation' | 'n'>[] = []
  for (let repeat = 0; repeat < HEAP_REPEATS; repeat++) {
    const page = await newBenchPage(driver)
    const session = await page.context().newCDPSession(page)
    try {
      const baseline = await collectHeap(session)
      await page.evaluate(
        ([implementation, n]) => window.__todomvcCompilerBench.prepareHeap(implementation, n),
        [implementation, HEAP_SIZE] as const,
      )
      const afterMountBytes = (await collectHeap(session)) - baseline
      await page.evaluate(() => window.__todomvcCompilerBench.updateHeld())
      const afterUpdateBytes = (await collectHeap(session)) - baseline
      await page.evaluate(() => window.__todomvcCompilerBench.deleteAllHeld())
      const afterDeleteAllBytes = (await collectHeap(session)) - baseline
      await page.evaluate(() => window.__todomvcCompilerBench.releaseHeap())
      const afterUnmountBytes = (await collectHeap(session)) - baseline
      runs.push({
        afterMountBytes,
        afterUpdateBytes,
        afterDeleteAllBytes,
        afterUnmountBytes,
      })
    } finally {
      await page.close()
    }
  }
  return {
    implementation,
    n: HEAP_SIZE,
    afterMountBytes: Math.round(median(runs.map((run) => run.afterMountBytes))),
    afterUpdateBytes: Math.round(median(runs.map((run) => run.afterUpdateBytes))),
    afterDeleteAllBytes: Math.round(median(runs.map((run) => run.afterDeleteAllBytes))),
    afterUnmountBytes: Math.round(median(runs.map((run) => run.afterUnmountBytes))),
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

const authoredSource = readFileSync(authoredPath, 'utf8')
const handwrittenSource = readFileSync(handwrittenPath, 'utf8')
const reactSource = readFileSync(reactPath, 'utf8')
const generated = compile(authoredSource)
const generatedBench = compileBenchVariant(authoredSource)
const generatedProduction = await buildGeneratedProduction(generated)
const transfers = await buildProductionBundles(generated, generatedProduction)
const driver = await buildBenchmarkDriver(generated, generatedBench)
const codeMetrics = collectCodeMetrics(
  generated,
  generatedProduction,
  handwrittenSource,
  reactSource,
)

const chromiumExecutable = resolveChromiumExecutable()
const browser = await chromium.launch({
  headless: true,
  executablePath: chromiumExecutable,
})

const parity: Record<Implementation, unknown> = {} as Record<Implementation, unknown>
const cells: CellResult[] = []
const internals: MountInternalsResult[] = []
const heaps: HeapResult[] = []

try {
  console.log('\n=== browser parity ===')
  for (const implementation of IMPLEMENTATIONS) {
    const page = await newBenchPage(driver)
    try {
      const result = await page.evaluate(
        (value) => window.__todomvcCompilerBench.runParity(value),
        implementation,
      )
      parity[implementation] = result
      console.log(`${implementation}: initial/add/toggle/filter/edit/remove OK`)
    } finally {
      await page.close()
    }
  }

  console.log(`\n=== update measurements (${WARMUPS} warmups + ${REPEATS} repeats, median) ===`)
  for (const n of SIZES) {
    for (const scenario of SCENARIOS) {
      for (const implementation of IMPLEMENTATIONS) {
        const result = await measureCell(driver, implementation, n, scenario)
        cells.push(result)
      }
      const row = cells.filter((cell) => cell.n === n && cell.scenario === scenario)
      console.log(
        `N=${n} ${scenario}: ${row.map((cell) => `${cell.implementation}=${cell.elapsedMs.toFixed(3)}ms`).join(' ')}`,
      )
    }
  }

  console.log('\n=== mount internals ===')
  for (const n of SIZES) {
    for (const implementation of IMPLEMENTATIONS) {
      const result = await measureMountInternals(driver, implementation, n)
      internals.push(result)
      console.log(
        `N=${n} ${implementation}: listeners=${result.listenerCount} querySelector=${result.querySelectorCalls}`,
      )
    }
  }

  console.log(`\n=== JavaScript heap (${HEAP_REPEATS} repeats, N=${HEAP_SIZE}) ===`)
  for (const implementation of IMPLEMENTATIONS) {
    const result = await measureHeap(driver, implementation)
    heaps.push(result)
    console.log(
      `${implementation}: mount=${result.afterMountBytes} update=${result.afterUpdateBytes} delete=${result.afterDeleteAllBytes} unmount=${result.afterUnmountBytes} bytes`,
    )
  }
} finally {
  await browser.close()
}

console.log('\n=== production transfer ===')
for (const implementation of IMPLEMENTATIONS) {
  const result = transfers[implementation]
  console.log(
    `${implementation}: JS ${result.bytes} (${result.gzipBytes} gzip), HTML ${result.htmlBytes} (${result.htmlGzipBytes} gzip), total gzip ${result.totalGzipBytes}`,
  )
}

console.log('\n=== JSON ===')
const report = {
  date: new Date().toISOString(),
  chromium: chromiumExecutable ?? 'playwright-managed',
  sizes: SIZES,
  repeats: REPEATS,
  warmups: WARMUPS,
  heapSize: HEAP_SIZE,
  heapRepeats: HEAP_REPEATS,
  parity,
  transfers: Object.fromEntries(
    IMPLEMENTATIONS.map((implementation) => {
      const { code: _code, ...result } = transfers[implementation]
      return [implementation, result]
    }),
  ),
  driver: {
    bytes: driver.bytes,
    gzipBytes: driver.gzipBytes,
  },
  codeMetrics,
  cells,
  internals,
  heaps,
}
const reportJson = JSON.stringify(report, null, 2)
if (process.env.IRISOUT_TODOMVC_JSON_PATH) {
  writeFileSync(process.env.IRISOUT_TODOMVC_JSON_PATH, `${reportJson}\n`)
}
console.log(reportJson)
