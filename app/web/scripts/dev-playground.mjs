// 公式サイトと実行管理画面を異なる配信元で起動する開発入口。
// cookieとpostMessageの境界を開発中から本番に近い形で確認する。

import { spawn } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../../..')
const vp = path.join(root, 'node_modules/.bin/vp')
const children = []
const sitePort = readPort('IRISOUT_PLAYGROUND_SITE_PORT', 5173)
const controllerPort = readPort('IRISOUT_PLAYGROUND_CONTROLLER_PORT', 5174)
if (sitePort === controllerPort) throw new Error('公式サイトと実行管理画面のポートを分けてください')
const siteOrigin = `http://127.0.0.1:${sitePort}`
const controllerOrigin = `http://localhost:${controllerPort}`

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

start(['-C', 'app/web', 'dev', '--host', '127.0.0.1', '--port', String(sitePort), '--strictPort'], {
  IRISOUT_PLAYGROUND_DEV_ROLE: 'site',
  IRISOUT_VITE_CACHE_DIR: path.join(root, 'app/web/node_modules/.vite-site'),
  VITE_IRISOUT_PLAYGROUND_CONTROLLER_ORIGIN: controllerOrigin,
  VITE_IRISOUT_PLAYGROUND_SITE_ORIGIN: siteOrigin,
})
start(
  ['-C', 'app/web', 'dev', '--host', 'localhost', '--port', String(controllerPort), '--strictPort'],
  {
    IRISOUT_PLAYGROUND_DEV_ROLE: 'controller',
    IRISOUT_VITE_CACHE_DIR: path.join(root, 'app/web/node_modules/.vite-controller'),
    VITE_IRISOUT_PLAYGROUND_CONTROLLER_ORIGIN: controllerOrigin,
    VITE_IRISOUT_PLAYGROUND_SITE_ORIGIN: siteOrigin,
  },
)

function readPort(name, fallback) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name}は1から65535の整数で指定してください`)
  }
  return value
}

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
