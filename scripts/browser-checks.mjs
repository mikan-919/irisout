// 保存済みの操作検査と、梱包物を導入した障害対応ボードを直列に検証する。
// 公開版の原記録は変更せず、一時コピーだけを現在のソース版へ差し替える。
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  closeSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { parseArgs } from 'node:util'

const root = path.resolve(import.meta.dirname, '..')
const { values } = parseArgs({ options: { 'incident-app': { type: 'string' } } })
const source = path.resolve(
  root,
  values['incident-app'] ?? 'skills/irisout/assets/incident-dogfood',
)
const output = path.resolve(process.env.IRISOUT_BROWSER_ARTIFACTS ?? '.artifacts/browser-checks')
mkdirSync(output, { recursive: true })
const artifacts = mkdtempSync(path.join(output, 'run-'))
const temporary = mkdtempSync(path.join(tmpdir(), 'irisout-browser-checks-'))
const bun = process.execPath
// 作業場所で版を切り替えるshimを避け、子のpackage scriptにも実行中のBunを使う。
mkdirSync(path.join(temporary, 'bin'))
symlinkSync(bun, path.join(temporary, 'bin/bun'))
const env = { ...process.env, PATH: `${temporary}/bin:${process.env.PATH}` }
const summary = {
  startedAt: new Date().toISOString(),
  bun: Bun.version,
  source,
  artifacts,
  steps: [],
}
const children = new Set()

function terminate(child, signal = 'SIGTERM') {
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

function start(name, args, cwd = root, extra = {}) {
  const log = path.join(artifacts, `${name}.log`)
  const fd = openSync(log, 'w')
  let child
  try {
    child = spawn(bun, args, {
      cwd,
      env: { ...env, ...extra },
      detached: true,
      stdio: ['ignore', fd, fd],
    })
  } finally {
    closeSync(fd)
  }
  children.add(child)
  const step = { name, args, cwd, log, pid: child.pid }
  summary.steps.push(step)
  const finished = once(child, 'exit').then(([code, signal]) => {
    Object.assign(step, { code, signal })
    return code
  })
  // 起動失敗は準備待ちの途中でも処理し、未処理のPromiseを残さない。
  finished.catch(() => {})
  console.log(`${name}: ${log}`)
  return { child, finished, step }
}

async function run(name, args, cwd = root, extra = {}) {
  abort.signal.throwIfAborted()
  const { child, finished } = start(name, args, cwd, extra)
  try {
    if ((await finished) !== 0) throw new Error(`${name} failed; see ${artifacts}/${name}.log`)
  } finally {
    terminate(child)
    children.delete(child)
  }
}

// 中断時もfinallyへ進め、サーバーと実行中の検査器を停止する。
const abort = new AbortController()
const interrupt = () => {
  abort.abort(new Error('browser checks interrupted'))
  for (const child of children) terminate(child)
}
process.once('SIGTERM', interrupt)
process.once('SIGINT', interrupt)
try {
  for (const { name, fixture, extra } of [
    {
      name: 'handlers',
      fixture: 'handler-control-flow',
      extra: {
        IRISOUT_HANDLER_BROWSER_ARTIFACTS: `${artifacts}/handlers`,
        IRISOUT_HANDLER_BROWSER_RESULT: `${artifacts}/handlers.json`,
      },
    },
    {
      name: 'lifecycle',
      fixture: 'lifecycle-control-flow',
      extra: {
        IRISOUT_LIFECYCLE_ARTIFACTS: `${artifacts}/lifecycle`,
        IRISOUT_LIFECYCLE_RESULT: `${artifacts}/lifecycle.json`,
      },
    },
    {
      name: 'boundaries',
      fixture: 'javascript-boundaries',
      extra: {
        IRISOUT_BOUNDARY_ARTIFACTS: `${artifacts}/boundaries`,
        IRISOUT_BOUNDARY_BROWSER_RESULT: `${artifacts}/boundaries.json`,
      },
    },
  ]) {
    abort.signal.throwIfAborted()
    await run(name, [`fixtures/${fixture}/verify.mjs`], root, extra)
  }
  await run('build-packages', ['scripts/build-packages.mjs'])
  const pack = path.join(temporary, 'pack')
  mkdirSync(pack)
  await run(
    'pack',
    ['pm', 'pack', '--destination', pack, '--quiet'],
    path.join(root, 'packages/irisout'),
  )
  const version = JSON.parse(
    readFileSync(path.join(root, 'packages/irisout/package.json'), 'utf8'),
  ).version
  const app = path.join(temporary, 'app')
  cpSync(source, app, {
    recursive: true,
    filter: (file) => !['node_modules', 'dist'].includes(path.basename(file)),
  })
  const manifestPath = path.join(app, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dependencies.irisout = `file:${pack}/irisout-${version}.tgz`
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  // 依存を差し替えたコピー先だけで再解決する。公開版の形式2のlockは保持する。
  rmSync(path.join(app, 'bun.lock'), { force: true })
  await run('install', ['install', '--no-progress'], app)
  await run('typecheck', ['run', 'typecheck'], app)
  await run('build-app', ['run', 'build'], app)
  const server = start('server', ['server/start.ts'], app, { DOGFOOD_PORT: '0' })
  let base
  const deadline = Date.now() + 30000
  while (!base) {
    abort.signal.throwIfAborted()
    if (server.step.code !== undefined) throw new Error('server exited before becoming ready')
    if (Date.now() > deadline) throw new Error('server readiness timed out')
    const url = readFileSync(server.step.log, 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/?/)?.[0]
    if (url) {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) }).catch(() => null)
      if (response?.ok) base = url
    }
    if (!base) await setTimeout(100, undefined, { signal: abort.signal })
  }
  summary.base = base
  await run('incident', ['fixtures/incident-dogfood/verify.mjs'], root, {
    DOGFOOD_BASE_URL: base,
    DOGFOOD_ARTIFACT_DIR: artifacts,
    DOGFOOD_RESULT_PATH: `${artifacts}/incident.json`,
    DOGFOOD_FEEDBACK_PATH: `${artifacts}/incident-feedback.md`,
  })
  summary.passed = true
} catch (error) {
  summary.passed = false
  summary.error = String(error)
  console.error(error)
  process.exitCode = 1
} finally {
  for (const child of children) terminate(child)
  await Promise.all(
    [...children].map(async (child) => {
      if (child.exitCode === null && child.signalCode === null) {
        await Promise.race([once(child, 'exit'), setTimeout(3000)])
      }
      terminate(child, 'SIGKILL')
    }),
  )
  rmSync(temporary, { recursive: true, force: true })
  summary.finishedAt = new Date().toISOString()
  writeFileSync(path.join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  console.log(`browser checks ${summary.passed ? 'passed' : 'failed'}: ${artifacts}`)
}
