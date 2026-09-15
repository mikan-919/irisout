// ルートの開発入口。サイト、Playground、examplesを一つの引数体系で起動する。

import { spawn } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const vp = path.join(root, 'node_modules/.bin/vp')
const examples = {
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
  run(['-C', 'apps/examples', 'dev'])
} else if (target === 'site') {
  run(['-C', 'apps/web', 'dev'])
} else if (target === 'playground') {
  run([path.join(root, 'apps/web/scripts/dev-playground.mjs')], process.execPath)
} else if (target === 'example' && name && examples[name]) {
  run(['-C', 'apps/examples', 'dev'], vp, { IRISOUT_ENTRY: examples[name] })
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

function printUsage() {
  console.log(`使い方:
  bun run dev
  bun run dev site
  bun run dev playground
  bun run dev example <counter|list|notes|heatmap|todomvc|multi-file>`)
}
