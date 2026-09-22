// ルートの開発入口。サイト、Playground、デモを一つの引数体系で起動する。

import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const vp = path.join(root, 'node_modules/.bin/vp')
const demos = {
  counter: 'counter.jsx',
  list: 'list.jsx',
  notes: 'notes.jsx',
  heatmap: 'heatmap.jsx',
  todomvc: 'todomvc.jsx',
  'multi-file': 'multi-file/App.jsx',
}

const [target, name] = process.argv.slice(2)

if (target === '--help' || target === '-h') {
  printUsage()
  process.exit(0)
}

if (!target) {
  run(['-C', 'apps/demos', 'dev'])
} else if (target === 'site') {
  buildWeb()
  run([path.join(root, 'apps/web/server/index.mjs')], 'bun', {
    HOST: '127.0.0.1',
    PORT: process.env.PORT ?? '5173',
  })
} else if (target === 'playground') {
  run([path.join(root, 'apps/web/scripts/dev-playground.mjs')], process.execPath)
} else if (target === 'demo' && name && demos[name]) {
  run(['-C', 'apps/demos', 'dev'], vp, { IRISOUT_ENTRY: demos[name] })
} else {
  printUsage()
  process.exitCode = 1
}

function run(args, command = vp, extraEnvironment = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnvironment },
    stdio: 'inherit',
  })
  child.once('error', (error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  child.once('exit', (code) => {
    process.exitCode = code ?? 1
  })
}

function buildWeb() {
  const result = spawnSync('bun', ['run', 'build:web'], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function printUsage() {
  console.log(`使い方:
  bun run dev
  bun run dev site
  bun run dev playground
  bun run dev demo <counter|list|notes|heatmap|todomvc|multi-file>`)
}
