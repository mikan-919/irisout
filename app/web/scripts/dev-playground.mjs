// 公式サイトと実行管理画面を異なる配信元で起動する開発入口。
// cookieとpostMessageの境界を開発中から本番に近い形で確認する。

import { spawn } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../../..')
const vp = path.join(root, 'node_modules/.bin/vp')
const children = []

function start(args, env) {
  const child = spawn(vp, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  })
  children.push(child)
  child.once('exit', (code, signal) => {
    if (code !== 0 && signal === null) process.exitCode = code ?? 1
    stop()
  })
}

start(['-C', 'app/web', 'dev', '--host', '127.0.0.1', '--port', '5173'], {
  VITE_IRISOUT_PLAYGROUND_CONTROLLER_ORIGIN: 'http://localhost:5174',
  VITE_IRISOUT_PLAYGROUND_SITE_ORIGIN: 'http://127.0.0.1:5173',
})
start(['-C', 'app/web', 'dev', '--host', 'localhost', '--port', '5174'], {
  VITE_IRISOUT_PLAYGROUND_CONTROLLER_ORIGIN: 'http://localhost:5174',
  VITE_IRISOUT_PLAYGROUND_SITE_ORIGIN: 'http://127.0.0.1:5173',
})

function stop() {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
}

process.once('SIGINT', () => {
  stop()
  process.exit(130)
})
process.once('SIGTERM', () => {
  stop()
  process.exit(143)
})
