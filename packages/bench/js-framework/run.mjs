// 公式サーバーと測定器を順に実行し、検査結果・測定値・環境情報を保存する。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { benchmarks, checkout, frameworks, root, upstreamCommit, workspace } from './config.mjs'

const count = Number(process.env.JSFB_COUNT ?? 3)
if (!Number.isSafeInteger(count) || count < 1)
  throw new Error('JSFB_COUNT must be a positive integer')
const memoryCount = Number(process.env.JSFB_MEMORY_COUNT ?? 1)
if (!Number.isSafeInteger(memoryCount) || memoryCount < 1)
  throw new Error('JSFB_MEMORY_COUNT must be a positive integer')
const chrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? chromium.executablePath()
const env = { ...process.env, PORT: process.env.JSFB_PORT ?? '8080' }
const output = path.join(root, 'results')
if (fs.existsSync(output)) fs.renameSync(output, `${output}-${Date.now()}`)
fs.mkdirSync(output, { recursive: true })
const driver = path.join(checkout, 'webdriver-ts')
const selected = frameworks.map((name) => `keyed/${name}`)
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
if (git(checkout, 'rev-parse', 'HEAD') !== upstreamCommit)
  throw new Error('Run setup.mjs to prepare the pinned upstream commit')
execFileSync('git', ['diff', '--exit-code', 'HEAD'], { cwd: checkout, stdio: 'inherit' })
// 前回の値が混入しないよう、測定器の出力先を試行ごとに分ける。
const raw = path.join(driver, 'results')
if (fs.existsSync(raw) && fs.readdirSync(raw).length)
  fs.renameSync(raw, path.join(driver, `results-${Date.now()}`))
const log = fs.openSync(path.join(output, 'server.log'), 'w')
try {
  const response = await fetch(`http://localhost:${env.PORT}/ls`)
  if (response.ok)
    throw new Error(`Port ${env.PORT} is already serving a benchmark; choose JSFB_PORT`)
} catch (error) {
  if (error instanceof Error && error.message.startsWith('Port ')) throw error
}
const server = spawn(process.execPath, ['index.ts'], {
  cwd: path.join(checkout, 'server'),
  env,
  stdio: ['ignore', log, log],
})
function run(args, file) {
  const fd = fs.openSync(path.join(output, file), 'w')
  try {
    execFileSync('node', args, { cwd: driver, env, stdio: ['ignore', fd, fd] })
  } finally {
    fs.closeSync(fd)
  }
}
try {
  let ready = false
  for (let retry = 0; retry < 100; retry++) {
    if (server.exitCode !== null) throw new Error('Benchmark server exited; see results/server.log')
    try {
      const response = await fetch(`http://localhost:${env.PORT}/ls`)
      if (response.ok) {
        ready = true
        break
      }
    } catch {
      /* 起動中は接続を再試行する。 */
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!ready) throw new Error('Benchmark server did not become ready')
  const common = ['--headless', '--chromeBinary', chrome, '--framework', ...selected]
  console.log('Checking official keyed/HTML rules')
  run(['dist/isKeyed.js', ...common], 'keyed.log')
  const keyed = fs.readFileSync(path.join(output, 'keyed.log'), 'utf8')
  // 上流の検査は失敗時にも終了番号0を返すため、全実装の成功行を確認する。
  if (
    /ERROR|Error in isKeyed/.test(keyed) ||
    frameworks.some(
      (name) =>
        !keyed
          .split('\n')
          .some(
            (line) =>
              line.startsWith(name + '-') &&
              line.includes(
                " is keyed for 'run benchmark' and keyed for 'remove row benchmark' and keyed for 'swap rows benchmark'",
              ),
          ),
    )
  ) {
    throw new Error('Official keyed check failed; see results/keyed.log')
  }
  fs.writeFileSync(
    path.join(output, 'environment.json'),
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        upstreamCommit,
        irisoutCommit: git(workspace, 'rev-parse', 'HEAD'),
        irisoutWorkingTree: git(workspace, 'status', '--short'),
        sourceSha256: createHash('sha256')
          .update(fs.readFileSync(path.join(root, 'irisout/main.jsx')))
          .digest('hex'),
        irisoutAssets: Object.fromEntries(
          [
            'index.html',
            ...fs
              .readdirSync(path.join(checkout, 'frameworks/keyed/irisout/dist/assets'))
              .map((file) => `assets/${file}`),
          ].map((file) => [
            file,
            createHash('sha256')
              .update(fs.readFileSync(path.join(checkout, 'frameworks/keyed/irisout/dist', file)))
              .digest('hex'),
          ]),
        ),
        keyedChecks: keyed.split('\n').filter((line) => line.includes(' is keyed for ')),
        node: execFileSync('node', ['--version'], { encoding: 'utf8' }).trim(),
        bun: process.versions.bun,
        browser: execFileSync(chrome, ['--version'], { encoding: 'utf8' }).trim(),
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        cpu: os.cpus()[0]?.model,
        logicalCpus: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
        count,
        memoryCount,
        headless: true,
        throttling: 'upstream defaults (03/04/05/09: 4x, 06: 2x)',
        frameworks,
        benchmarks,
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`Measuring ${frameworks.join(', ')}; see results/{cpu,memory,size}.log`)
  run(
    [
      'dist/benchmarkRunner.js',
      ...common,
      '--count',
      String(count),
      '--benchmark',
      ...benchmarks.filter((id) => id.startsWith('0')),
    ],
    'cpu.log',
  )
  run(
    [
      'dist/benchmarkRunner.js',
      ...common,
      '--count',
      String(memoryCount),
      '--benchmark',
      ...benchmarks.filter((id) => id.startsWith('2')),
    ],
    'memory.log',
  )
  run(['dist/benchmarkRunner.js', ...common, '--benchmark', '40_'], 'size.log')
  for (const file of fs.readdirSync(raw))
    fs.copyFileSync(path.join(raw, file), path.join(output, file))
} finally {
  server.kill('SIGTERM')
  fs.closeSync(log)
}
console.log('Results saved; run report.mjs')
